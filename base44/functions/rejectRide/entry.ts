import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';
import { findNextDriverInZone } from '../../shared/driverSelection.ts';
import { getNextQueueTailAt, getNextQueuePosition, withQueueLock, compactQueueUnlocked } from '../../shared/queueOrder.ts';

Deno.serve(async (req) => {
  let b44: any = null;
  let lockOwner: string | null = null;
  let lockOrderId: string | null = null;
  let currentReleased = false;
  let lockedOrder: any = null;

  try {
    const base44 = createClientFromRequest(req);
    b44 = base44.asServiceRole;
    const payload = await req.json();
    const { orderId, driverId, assignmentAttempt } = payload;
    const source = payload.source === 'delivery_unconfirmed'
      ? 'delivery_unconfirmed'
      : (payload.source === 'timeout'
        ? 'timeout'
        : (payload.source === 'legacy_client' || payload.source === 'explicit_reject'
          ? 'legacy_client'
          : 'driver'));
    const legacyQueueEnteredAt = payload.legacyQueueEnteredAt || null;

    if (!orderId || !driverId || assignmentAttempt == null) {
      return Response.json({ success:false, reason:'missing_params' }, { status:400 });
    }
    if (!(await verifyRequestAuth(b44, payload, { allowDriverId:driverId }))) {
      return Response.json({ success:false, reason:'unauthorized' }, { status:401 });
    }

    const order = await b44.entities.RideOrder.get(orderId);
    if (!order) return Response.json({ success:false, reason:'ORDER_NOT_FOUND' });
    if (
      order.status !== 'ofrecido' ||
      order.reserved_driver_id !== driverId ||
      Number(order.assignment_attempt) !== Number(assignmentAttempt)
    ) {
      return Response.json({ success:false, reason:'STALE_OR_EXPIRED' });
    }

    // BARRERA ABSOLUTA DE TIEMPO: ningún worker, cron ni instancia vieja puede
    // procesar timeout/delivery_unconfirmed antes del offerExpiresAt autoritativo.
    // El rechazo explícito del chofer no usa esta barrera porque sí debe ser inmediato.
    if (source === 'timeout' || source === 'delivery_unconfirmed') {
      const authoritativeExpiry = Number(order.offerExpiresAt);
      if (Number.isFinite(authoritativeExpiry) && Date.now() < authoritativeExpiry) {
        const remainingMs = Math.max(0, authoritativeExpiry - Date.now());
        await b44.entities.AuditLog.create({
          action:'PREMATURE_REJECT_ENGINE_BLOCKED',
          user_type:'sistema',
          user_name:'rejectRide',
          details:`Bloqueada reasignación prematura de ${orderId}; faltaban ${remainingMs} ms.`,
          metadata:{
            orderId,
            driverId,
            assignmentAttempt:Number(assignmentAttempt),
            source,
            offerExpiresAt:authoritativeExpiry,
            remainingMs
          }
        }).catch(()=>{});

        b44.functions.invoke('autoReassignOnTimeout', {
          orderId,
          driverId,
          assignmentAttempt:Number(assignmentAttempt),
          internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
        }).catch(e=>console.error('Premature reject blocked re-chain error:',e));

        return Response.json({
          success:false,
          reason:'OFFER_STILL_ACTIVE',
          remainingMs,
          offerExpiresAt:authoritativeExpiry
        });
      }
    }

    // RECHAZAR y TIMEOUT usan exactamente el mismo motor. Primero tomamos un lease
    // atómico sobre ESTA oferta; así aceptar/rechazar/vencer nunca pueden procesarla
    // simultáneamente.
    lockOwner = `${source}:${orderId}:${driverId}:${assignmentAttempt}:${crypto.randomUUID()}`;
    lockOrderId = orderId;
    const leaseUntil = Date.now() + 30000;
    const lockRes = await b44.entities.RideOrder.updateMany(
      {
        id: orderId,
        status: 'ofrecido',
        reserved_driver_id: driverId,
        reservation_token: order.reservation_token,
        assignment_attempt: assignmentAttempt,
        $or: [
          { processingOwnerId:null },
          { processingOwnerId:{ $exists:false } },
          { processingLeaseExpiresAt:{ $lt:Date.now() } }
        ]
      },
      {
        $set: {
          processingOwnerId: lockOwner,
          processingAction: (source === 'timeout' || source === 'delivery_unconfirmed') ? 'TIMEOUT' : 'REJECT',
          processingOperationKey: `${source}:${orderId}:${assignmentAttempt}`,
          processingLeaseExpiresAt: leaseUntil,
          processingPhase: 'REASSIGNING'
        }
      }
    );
    if ((lockRes.matchedCount ?? lockRes.modifiedCount ?? lockRes.updated ?? 0) !== 1) {
      return Response.json({ success:false, reason:'PROCESSING_IN_PROGRESS' });
    }
    lockedOrder = order;

    // Determinamos si el chofer ya fue liberado previamente (APK legacy)
    let legacyAlreadyReleased = false;
    let actualDriver = null;
    let releaseSet:any = {
      status: 'disponible',
      dispatch_status: 'normal',
      active_order_id: null,
      active_ride_id: null,
      reserved_order_id: null,
      reservation_token: null,
      manual_reservation_token: null,
      driver_reservation_key: null
    };

    const releasedCurrent = await b44.entities.Driver.updateMany(
      {
        id: driverId,
        status: 'disponible',
        dispatch_status: 'automatic_pending',
        reserved_order_id: orderId,
        reservation_token: order.reservation_token
      },
      { $set: releaseSet }
    );
    const releasedCount = releasedCurrent.matchedCount ?? releasedCurrent.modifiedCount ?? releasedCurrent.updated ?? 0;
    
    if (releasedCount !== 1) {
      actualDriver = await b44.entities.Driver.get(driverId).catch(() => null);
      // Permitir que timeout también adopte una liberación previa.
      // Si el móvil perdió la reserva por algún bug/desconexión, el viaje no debe quedar atascado.
      legacyAlreadyReleased = Boolean(
        actualDriver &&
        actualDriver.reserved_order_id !== orderId &&
        actualDriver.reservation_token !== order.reservation_token
      );

      if (legacyAlreadyReleased) {
        currentReleased = true;
        await b44.entities.AuditLog.create({
          action:'LEGACY_DRIVER_RELEASE_ADOPTED',
          user_type:'sistema',
          user_name:'rejectRide',
          details:`Central adoptó liberación previa de APK vieja para ${driverId} / ${orderId}`,
          metadata:{ orderId, driverId, assignmentAttempt:Number(assignmentAttempt), legacyQueueEnteredAt }
        }).catch(()=>{});
      } else {
        await b44.entities.RideOrder.updateMany(
          { id:orderId, processingOwnerId:lockOwner },
          { $set:{ processingOwnerId:null, processingAction:null, processingOperationKey:null, processingLeaseExpiresAt:null, processingPhase:null } }
        ).catch(()=>{});
        lockOwner = null;
        return Response.json({ success:false, reason:'STALE_OR_EXPIRED' });
      }
    } else {
      currentReleased = true;
      actualDriver = await b44.entities.Driver.get(driverId).catch(() => null);
    }

    // El móvil ha sido liberado del viaje. Ahora DEBE ir al final de la cola, tanto si 
    // fue un release nuestro como un release legacy.
    // EXCEPCIÓN: Si es delivery_unconfirmed, el móvil NO debe perder su lugar.
    const isDeliveryUnconfirmed = source === 'delivery_unconfirmed';
    const queueBase = order.assigned_base || order.zone || actualDriver?.current_base || actualDriver?.queue_authoritative_base || null;
    if (queueBase && !isDeliveryUnconfirmed) {
      // Bloqueamos la cola para posicionarlo último
      await withQueueLock(b44, queueBase, async () => {
        const nextPos = await getNextQueuePosition(b44, queueBase, driverId);
        const nextQueueAt = await getNextQueueTailAt(b44, queueBase, driverId);
        
        const placed = await b44.entities.Driver.updateMany(
          {
            id: driverId,
            status: 'disponible',
            $or: [
              { dispatch_status: 'normal' },
              { dispatch_status: null }
            ],
            reserved_order_id: null,
            active_order_id: null,
            active_ride_id: null
          },
          { $set: {
            current_base: queueBase,
            queue_authoritative_base: queueBase,
            queue_position: nextPos,
            queue_authority_marker: nextPos,
            queue_entered_at: nextQueueAt,
            queue_authoritative_at: nextQueueAt,
            queue_left_at: null
          } }
        );
        
        if ((placed?.updated ?? placed?.matchedCount ?? placed?.modifiedCount ?? 0) === 1) {
            await b44.entities.AuditLog.create({
              action:'DRIVER_SENT_TO_TAIL',
              user_type:'sistema',
              user_name:'rejectRide',
              details:`Chofer ${driverId} pasó al último lugar en la base ${queueBase} (posición ${nextPos}) tras soltar oferta ${orderId}`,
              metadata:{ orderId, driverId, baseName: queueBase, newPosition: nextPos, queueAt: nextQueueAt }
            }).catch(()=>{});
            
            await compactQueueUnlocked(b44, queueBase).catch(e => console.error("Error compacting queue after tail placement", e));
        }
      });
    }

    // Cerrar la oferta anterior EN PARALELO. Un rechazo explícito o un timeout ya
    // confirmado no puede quedar esperando la latencia de FCM antes de saltar al
    // siguiente móvil. El cierre está dirigido únicamente al driver + attempt viejo,
    // por lo que es seguro que termine después de comprometer la nueva oferta.
    b44.functions.invoke('sendPushNotification', {
      action:'cancel_multiple',
      orderId:order.id,
      driversToCancel:[driverId],
      orderData:{ assignmentAttempt:Number(assignmentAttempt) },
      internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
    }).then(async (closeRes:any) => {
      const closeData = closeRes?.data || closeRes;
      const ok = closeData?.ok !== false && !closeData?.error;
      await b44.entities.AuditLog.create({
        action: ok ? 'OFFER_CLOSE_CONFIRMED' : 'OFFER_CLOSE_FAILED',
        user_type:'sistema',
        user_name:'rejectRide',
        details: ok
          ? `Oferta ${order.id} cerrada en móvil anterior`
          : `No se pudo confirmar cierre de oferta ${order.id} en móvil anterior`,
        metadata:{ orderId:order.id, driverId, assignmentAttempt:Number(assignmentAttempt), error:closeData?.error || closeData?.reason || null }
      }).catch(()=>{});
    }).catch(async (e:any) => {
      await b44.entities.AuditLog.create({
        action:'OFFER_CLOSE_FAILED',
        user_type:'sistema',
        user_name:'rejectRide',
        details:`Falló cierre FCM de oferta ${order.id} en móvil anterior`,
        metadata:{ orderId:order.id, driverId, assignmentAttempt:Number(assignmentAttempt), error:e?.message || String(e) }
      }).catch(()=>{});
    });

    const config = (await b44.entities.TarifaConfig.list())[0] || {};
    // Compatibilidad: cada nueva oferta nace con los 30 s históricos.
    // La v12.31 nueva puede ampliar sólo el techo de ENTREGA cuando confirme
    // explícitamente soporte de ALERT_PRESENTED.
    const timeoutSeconds = 30;
    const autoReassignActive = config.auto_reasignacion_activa ?? true;
    const excluded = new Set<string>([...(order.offered_driver_ids || []), driverId].filter(Boolean));

    if (autoReassignActive) {
      for (let i=0; i<100; i++) {
        const selectionOrder = { ...order, offered_driver_ids:[...excluded] };
        const nextDriver = await findNextDriverInZone(b44, selectionOrder, driverId);
        if (!nextDriver) break;
        excluded.add(nextDriver.id);

        const token = crypto.randomUUID();
        const reserve = await b44.entities.Driver.updateMany(
          { id:nextDriver.id, status:'disponible', dispatch_status:'normal', reserved_order_id:null, active_order_id:null, active_ride_id:null },
          { $set:{ dispatch_status:'automatic_pending', reserved_order_id:orderId, reservation_token:token } }
        );
        if ((reserve.matchedCount ?? reserve.modifiedCount ?? reserve.updated ?? 0) !== 1) continue;

        const newAttempt = Number(assignmentAttempt) + 1;
        const assignedAt = new Date().toISOString();
        const expiresAt = Date.now() + timeoutSeconds*1000;
        // Cada salto es una oferta NUEVA. offered_driver_ids queda sólo como historial
        // para no volver a ofrecer a quienes ya pasaron; la identidad activa se
        // reemplaza por completo con nextDriver + token + newAttempt.
        const offeredIds = [...new Set([...(order.offered_driver_ids || []), driverId, nextDriver.id].filter(Boolean))];
        const commit = await b44.entities.RideOrder.updateMany(
          {
            id:orderId,
            status:'ofrecido',
            reserved_driver_id:driverId,
            reservation_token:order.reservation_token,
            assignment_attempt:assignmentAttempt,
            processingOwnerId:lockOwner
          },
          {
            $set:{
              status:'ofrecido',
              driver_id:nextDriver.id,
              driver_name:nextDriver.name,
              reserved_driver_id:nextDriver.id,
              reservation_token:token,
              manual_reservation_token:null,
              assigned_base:nextDriver.current_base || nextDriver.queue_authoritative_base || order.zone || null,
              offerExpiresAt:expiresAt,
              assignment_attempt:newAttempt,
              assigned_at:assignedAt,
              push_ack_at:null,
              push_ack_assignment_attempt:null,
              alert_presented_at:null,
              alert_presented_assignment_attempt:null,
              alert_presented_protocol_attempt:null,
              delivery_retry_count:0,
              processingAction:null,
              processingOperationKey:null,
              processingOwnerId:null,
              processingLeaseExpiresAt:null,
              processingPhase:null,
              offered_driver_ids:offeredIds
            }
          }
        );
        if ((commit.matchedCount ?? commit.modifiedCount ?? commit.updated ?? 0) !== 1) {
          await b44.entities.Driver.updateMany(
            { id:nextDriver.id, reserved_order_id:orderId, reservation_token:token },
            { $set:{ dispatch_status:'normal', reserved_order_id:null, reservation_token:null } }
          ).catch(()=>{});
          continue;
        }

        lockOwner = null;
        await b44.functions.invoke('sendPushNotification', {
          action:'send',
          driverId:nextDriver.id,
          orderId,
          orderData:{
            pickup_address:order.pickup_address,
            dropoff_address:order.dropoff_address,
            fare:order.fare,
            notes:order.notes,
            assignmentAttempt:newAttempt
          },
          internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
        }).catch(e=>console.error('Error push rejectRide:',e));

        // Lanzamos el watchdog sin await para que el operador/chofer no se quede
        // bloqueado 8 segundos esperando que el worker termine su primer ciclo.
        // Si el entorno serverless lo aborta, el cron de respaldo lo levantará.
        b44.functions.invoke('autoReassignOnTimeout', {
          orderId,
          driverId:nextDriver.id,
          assignmentAttempt:newAttempt,
          internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
        }).catch(e=>console.error('AutoReassign Trigger Error:',e));

        const deliveryUnconfirmed = source === 'delivery_unconfirmed';
        await b44.entities.AuditLog.create({
          action: deliveryUnconfirmed ? 'DELIVERY_UNCONFIRMED_REASSIGNED' : (source === 'timeout' ? 'timeout_viaje' : 'rechazar_viaje'),
          user_type: (source === 'timeout' || deliveryUnconfirmed) ? 'sistema' : 'chofer',
          user_name: (source === 'timeout' || deliveryUnconfirmed) ? 'Sistema' : 'Chofer',
          details: `${deliveryUnconfirmed ? 'Teléfono sin ACK; chofer conservó su posición' : (source === 'timeout' ? 'Venció el tiempo' : 'Rechazó')}. Reasignado a ${nextDriver.name}`,
          metadata:{ orderId, driverId, assignmentAttempt:Number(assignmentAttempt), nextDriverId:nextDriver.id, queuePreserved:deliveryUnconfirmed }
        }).catch(()=>{});
        return Response.json({ success:true, reassigned_to:nextDriver.name, source });
      }
    }

    const pending = await b44.entities.RideOrder.updateMany(
      {
        id:orderId,
        status:'ofrecido',
        reserved_driver_id:driverId,
        reservation_token:order.reservation_token,
        assignment_attempt:assignmentAttempt,
        processingOwnerId:lockOwner
      },
      {
        $set:{
          status:'pendiente',
          driver_id:null,
          driver_name:null,
          reserved_driver_id:null,
          reservation_token:null,
          manual_reservation_token:null,
          assigned_at:null,
          offerExpiresAt:null,
          push_ack_at:null,
          push_ack_assignment_attempt:null,
          alert_presented_at:null,
          alert_presented_assignment_attempt:null,
          alert_presented_protocol_attempt:null,
          delivery_retry_count:0,
          assigned_base:null,
          // Marca explícita de Pendiente REAL: sólo la escribe Central después de
          // que el selector autoritativo recorrió la zona y no encontró candidato.
          processingAction:'PENDING_AUTHORIZED',
          processingOperationKey:null,
          processingOwnerId:null,
          processingLeaseExpiresAt:null,
          processingPhase:null
        },
        $addToSet:{ offered_driver_ids:driverId }
      }
    );
    if ((pending.matchedCount ?? pending.modifiedCount ?? pending.updated ?? 0) !== 1) {
      throw new Error('ORDER_CHANGED_BEFORE_PENDING');
    }

    lockOwner = null;
    const deliveryUnconfirmed = source === 'delivery_unconfirmed';
    await b44.entities.AuditLog.create({
      action: deliveryUnconfirmed ? 'DELIVERY_UNCONFIRMED_PENDING' : (source === 'timeout' ? 'timeout_viaje' : 'rechazar_viaje'),
      user_type: (source === 'timeout' || deliveryUnconfirmed) ? 'sistema' : 'chofer',
      user_name: (source === 'timeout' || deliveryUnconfirmed) ? 'Sistema' : 'Chofer',
      details: `${deliveryUnconfirmed ? 'Teléfono sin ACK; chofer conservó su posición' : (source === 'timeout' ? 'Venció el tiempo' : 'Rechazó')}. Sin candidatos válidos en la zona, quedó pendiente.`,
      metadata:{ orderId, driverId, assignmentAttempt:Number(assignmentAttempt), queuePreserved:deliveryUnconfirmed }
    }).catch(()=>{});
    return Response.json({ success:true, reassigned_to:null, source });
  } catch (error:any) {
    console.error('RejectRide Error:',error);

    // Una falla interna NO convierte una reasignación activa en Pendientes.
    // Si el móvil anterior ya fue liberado, conservamos la oferta y relanzamos
    // el mismo motor autoritativo. Pendiente queda reservado a cadena agotada.
    if (b44 && lockOwner && lockOrderId && lockedOrder) {
      if (currentReleased) {
        const retryOwner = lockOwner;
        await b44.entities.RideOrder.updateMany(
          {
            id:lockOrderId,
            status:'ofrecido',
            reserved_driver_id:lockedOrder.reserved_driver_id,
            reservation_token:lockedOrder.reservation_token,
            assignment_attempt:lockedOrder.assignment_attempt,
            processingOwnerId:retryOwner
          },
          { $set:{ processingLeaseExpiresAt:Date.now()+30000, processingPhase:'REASSIGNING' } }
        ).catch(()=>{});
        await b44.entities.RideOrder.updateMany(
          { id:lockOrderId, processingOwnerId:retryOwner, processingPhase:'REASSIGNING' },
          { $set:{ processingOwnerId:null, processingAction:null, processingOperationKey:null, processingLeaseExpiresAt:null, processingPhase:null } }
        ).catch(()=>{});
        lockOwner = null;
        b44.functions.invoke('rejectRide', {
          orderId:lockOrderId,
          driverId:lockedOrder.reserved_driver_id,
          assignmentAttempt:Number(lockedOrder.assignment_attempt),
          source: source === 'timeout' ? 'timeout' : 'explicit_reject',
          legacyQueueEnteredAt,
          internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
        }).catch(()=>{});
      } else {
        await b44.entities.RideOrder.updateMany(
          { id:lockOrderId, processingOwnerId:lockOwner },
          { $set:{ processingOwnerId:null, processingAction:null, processingOperationKey:null, processingLeaseExpiresAt:null, processingPhase:null } }
        ).catch(()=>{});
      }
    }

    return Response.json({ success:false, error:error.message }, { status:500 });
  }
});