import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';
import { findNextDriverInZone } from '../../shared/driverSelection.ts';
import { withQueueLock, compactQueueUnlocked } from '../../shared/queueOrder.ts';
import { canProcessCommercialTimeout } from '../../shared/dispatchAuthority.ts';

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
      : (payload.source === 'delivery_unconfirmed_exhausted'
        ? 'delivery_unconfirmed_exhausted'
        : (payload.source === 'timeout'
          ? 'timeout'
          : (payload.source === 'explicit_reject'
            ? 'explicit_reject'
            : 'driver')));

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

    // El timeout comercial existe ÚNICAMENTE después de ALERT_PRESENTED + la ventana configurada.
    // delivery_unconfirmed es transporte: jamás libera al móvil ni avanza la cadena.
    if (source === 'delivery_unconfirmed') {
      return Response.json({ success:false, reason:'DELIVERY_RECOVERY_SAME_DRIVER' });
    }
    const deliveryExhausted = source === 'delivery_unconfirmed_exhausted';
    if (source === 'timeout') {
      const authoritativeExpiry = Number(order.offerExpiresAt);
      if (!canProcessCommercialTimeout(order, driverId, Number(assignmentAttempt))) {
        const remainingMs = Number.isFinite(authoritativeExpiry) ? Math.max(0, authoritativeExpiry - Date.now()) : null;
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
          processingAction: source === 'timeout' ? 'TIMEOUT' : (deliveryExhausted ? 'DELIVERY_FAILED' : 'REJECT'),
          processingOperationKey: `${source}:${orderId}:${assignmentAttempt}`,
          processingLeaseExpiresAt: leaseUntil,
          processingPhase: 'REASSIGNING'
        }
      }
    );
    if ((lockRes.matchedCount ?? lockRes.modifiedCount ?? lockRes.updated ?? 0) !== 1) {
      if (source !== 'timeout' && !deliveryExhausted) {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 250));
          const fresh = await b44.entities.RideOrder.get(orderId).catch(() => null);
          if (!fresh || fresh.status !== 'ofrecido' || fresh.reserved_driver_id !== driverId ||
              Number(fresh.assignment_attempt) !== Number(assignmentAttempt)) {
            return Response.json({ success:true, alreadyResolved:true, reason:'EXPLICIT_REJECT_ALREADY_RESOLVED' });
          }
          const leaseExpired = !fresh.processingOwnerId || !Number(fresh.processingLeaseExpiresAt) ||
            Number(fresh.processingLeaseExpiresAt) < Date.now();
          if (!leaseExpired) continue;
          const retryOwner = `explicit_reject_retry:${orderId}:${driverId}:${assignmentAttempt}:${crypto.randomUUID()}`;
          const retryLease = await b44.entities.RideOrder.updateMany(
            { id:orderId, status:'ofrecido', reserved_driver_id:driverId, reservation_token:fresh.reservation_token,
              assignment_attempt:assignmentAttempt,
              $or:[{processingOwnerId:null},{processingOwnerId:{$exists:false}},{processingLeaseExpiresAt:{$lt:Date.now()}}] },
            { $set:{ processingOwnerId:retryOwner, processingAction:'REJECT',
              processingOperationKey:`explicit_reject:${orderId}:${assignmentAttempt}`,
              processingLeaseExpiresAt:Date.now()+30000, processingPhase:'REASSIGNING' } }
          ).catch(()=>({updated:0}));
          if ((retryLease?.matchedCount ?? retryLease?.modifiedCount ?? retryLease?.updated ?? 0) === 1) {
            lockOwner = retryOwner; lockedOrder = fresh; break;
          }
        }
        if (!lockOwner || !lockedOrder) {
          await b44.entities.AuditLog.create({
            action:'EXPLICIT_REJECT_DEFERRED_RETRY', user_type:'sistema', user_name:'rejectRide',
            details:`Rechazo explícito ${orderId} quedó detrás de lease; se relanza sin esperar timeout`,
            metadata:{orderId,driverId,assignmentAttempt:Number(assignmentAttempt)}
          }).catch(()=>{});
          b44.functions.invoke('rejectRide',{
            orderId,driverId,assignmentAttempt:Number(assignmentAttempt),source:'explicit_reject',
            internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
          }).catch(()=>{});
          return Response.json({success:true,deferred:true,reason:'EXPLICIT_REJECT_DEFERRED_RETRY'});
        }
      } else {
        return Response.json({ success:false, reason:'PROCESSING_IN_PROGRESS' });
      }
    } else {
      lockedOrder = order;
    }

    // El backend es la única autoridad: una oferta sólo puede liberarse si el móvil
    // conserva exactamente la reserva de este intento. No se adoptan liberaciones
    // locales ni estados incompletos del cliente.
    let actualDriver = null;
    let releaseSet:any = {
      status: 'disponible',
      dispatch_status: 'normal',
      active_ride_id: null,
      reserved_order_id: null,
      reservation_token: null,
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
      await b44.entities.RideOrder.updateMany(
        { id:orderId, processingOwnerId:lockOwner },
        { $set:{ processingOwnerId:null, processingAction:null, processingOperationKey:null, processingLeaseExpiresAt:null, processingPhase:null } }
      ).catch(()=>{});
      lockOwner = null;
      await b44.entities.AuditLog.create({
        action:'DRIVER_RELEASE_STATE_MISMATCH',
        user_type:'sistema',
        user_name:'rejectRide',
        details:`No se liberó ${driverId} / ${orderId}: la reserva ya no coincide con el intento autoritativo.`,
        metadata:{orderId,driverId,assignmentAttempt:Number(assignmentAttempt),reserved_order_id:actualDriver?.reserved_order_id || null}
      }).catch(()=>{});
      return Response.json({ success:false, reason:'STALE_OR_EXPIRED' });
    } else {
      currentReleased = true;
      actualDriver = await b44.entities.Driver.get(driverId).catch(() => null);
    }

    // RECHAZO o TIMEOUT PRESENTADO saca al móvil de la cola.
    // No existe "mandarlo al último" automáticamente. Para volver, el chofer debe
    // entrar explícitamente a una base y allí obtiene una posición nueva al final.
    const queueBase = actualDriver?.queue_authoritative_base || order.assigned_base || order.zone || null;
    if (queueBase && !deliveryExhausted) {
      await withQueueLock(b44, queueBase, async () => {
        await b44.entities.Driver.updateMany(
          { id:driverId, status:'disponible', reserved_order_id:null, active_ride_id:null, next_order_id:null, queue_authoritative_base:queueBase },
          { $set:{
            queue_authoritative_base:null,
            queue_position:null,
          } }
        );
        await compactQueueUnlocked(b44, queueBase);
      });
      await b44.entities.AuditLog.create({
        action:'DRIVER_LEFT_QUEUE_AFTER_OFFER', user_type:source === 'timeout' ? 'sistema' : 'chofer',
        user_name:source === 'timeout' ? 'Sistema' : 'Chofer',
        details:`Chofer ${driverId} salió de la cola ${queueBase} tras ${source === 'timeout' ? 'timeout' : 'rechazo'}.`,
        metadata:{orderId,driverId,assignmentAttempt:Number(assignmentAttempt),baseName:queueBase,source}
      }).catch(()=>{});
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

    // Un móvil pedido expresamente por el cliente es una ruta distinta de una
    // asignación manual común de Central. Si no lo toma, NO recorrer A→B→C y NO
    // publicar en Pendientes de choferes: queda retenido sólo para el operador.
    const requestedDriverFailed = order.requested_driver_only === true && order.requested_driver_id === driverId;
    if (requestedDriverFailed) {
      const held = await b44.entities.RideOrder.updateMany(
        {
          id:orderId,
          status:'ofrecido',
          reserved_driver_id:driverId,
          reservation_token:order.reservation_token,
          assignment_attempt:assignmentAttempt,
          processingOwnerId:lockOwner
        },
        { $set:{
          status:'pendiente',
          driver_id:null,
          driver_name:null,
          reserved_driver_id:null,
          reservation_token:null,
          assigned_at:null,
          assigned_base:null,
          offerExpiresAt:null,
          push_ack_at:null,
          push_ack_assignment_attempt:null,
          alert_presented_at:null,
          alert_presented_assignment_attempt:null,
          alert_presented_protocol_attempt:null,
          delivery_retry_count:0,
          processingAction:'CENTRAL_REVIEW_REQUIRED_DRIVER',
          pending_reason:'REQUESTED_DRIVER_NOT_ACCEPTED',
          processingOperationKey:null,
          processingOwnerId:null,
          processingLeaseExpiresAt:null,
          processingPhase:null
        }, $addToSet:{ offered_driver_ids:driverId } }
      );
      if ((held.matchedCount ?? held.modifiedCount ?? held.updated ?? 0) !== 1) {
        throw new Error('ORDER_CHANGED_BEFORE_REQUESTED_DRIVER_HOLD');
      }
      // Si era una oferta del segundo cupo, liberar sólo esa reserva provisional.
      if (order.second_slot_offer === true) {
        const clearedNext = await b44.entities.Driver.updateMany(
          {id:driverId,next_order_id:orderId,next_order_token:order.reservation_token},
          {$set:{next_order_id:null,next_order_token:null}}
        ).catch(()=>null);
        if ((clearedNext?.matchedCount ?? clearedNext?.modifiedCount ?? clearedNext?.updated ?? 0) !== 1) {
          await b44.entities.AuditLog.create({action:'REQUESTED_SECOND_SLOT_CLEANUP_FAILED',user_type:'sistema',user_name:'rejectRide',details:`No se pudo liberar segundo cupo requerido ${orderId} tras ${source}`,metadata:{orderId,driverId,assignmentAttempt:Number(assignmentAttempt),reservationToken:order.reservation_token}}).catch(()=>{});
          throw new Error('REQUESTED_SECOND_SLOT_CLEANUP_FAILED');
        }
        const clearedFlag = await b44.entities.RideOrder.updateMany(
          {id:orderId,status:'pendiente',pending_reason:'REQUESTED_DRIVER_NOT_ACCEPTED',second_slot_offer:true},
          {$set:{second_slot_offer:false}}
        ).catch(()=>null);
        if ((clearedFlag?.matchedCount ?? clearedFlag?.modifiedCount ?? clearedFlag?.updated ?? 0) !== 1) {
          await b44.entities.AuditLog.create({action:'REQUESTED_SECOND_SLOT_FLAG_CLEANUP_FAILED',user_type:'sistema',user_name:'rejectRide',details:`No se pudo cerrar marca second_slot_offer de ${orderId}`,metadata:{orderId,driverId,assignmentAttempt:Number(assignmentAttempt)}}).catch(()=>{});
          throw new Error('REQUESTED_SECOND_SLOT_FLAG_CLEANUP_FAILED');
        }
      }
      lockOwner = null;
      await b44.entities.AuditLog.create({
        action:'REQUESTED_DRIVER_NOT_ACCEPTED',
        user_type:'sistema',
        user_name:'rejectRide',
        details:`El móvil requerido no tomó ${orderId}; retenido exclusivamente para decisión de Central.`,
        metadata:{orderId,driverId,assignmentAttempt:Number(assignmentAttempt),source,visibleToDrivers:false}
      }).catch(()=>{});
      return Response.json({success:true,reassigned_to:null,centralReview:true,reason:'REQUESTED_DRIVER_NOT_ACCEPTED',source});
    }

    const config = (await b44.entities.TarifaConfig.list())[0] || {};
    // La nueva oferta nace sin reloj comercial. La duración configurada se aplica
    // únicamente cuando el siguiente teléfono confirme ALERT_PRESENTED.
    const autoReassignActive = config.auto_reasignacion_activa ?? true;
    const excluded = new Set<string>([...(order.offered_driver_ids || []), driverId].filter(Boolean));

    if (autoReassignActive) {
      // Nunca tiene sentido intentar más veces que la cantidad real de móviles
      // disponibles en la zona. El límite fijo de 100 podía multiplicar consultas
      // en una ráfaga de rechazos/timeouts. Tomamos una foto sólo para acotar los
      // CAS fallidos; findNextDriverInZone sigue releyendo y decide el candidato real.
      const zoneSnapshot = await b44.entities.Driver.filter({
        status:'disponible',
        queue_authoritative_base:order.zone
      }).catch(()=>[]);
      const maxCandidateAttempts = Math.max(1, Math.min(
        100,
        Array.isArray(zoneSnapshot) ? zoneSnapshot.length : 0
      ));
      for (let i=0; i<maxCandidateAttempts; i++) {
        const selectionOrder = { ...order, offered_driver_ids:[...excluded] };
        const nextDriver = await findNextDriverInZone(b44, selectionOrder, driverId);
        if (!nextDriver) break;
        excluded.add(nextDriver.id);

        const token = crypto.randomUUID();
        const reserve = await b44.entities.Driver.updateMany(
          { id:nextDriver.id, status:'disponible', dispatch_status:'normal', reserved_order_id:null, active_ride_id:null, next_order_id:null },
          { $set:{ dispatch_status:'automatic_pending', reserved_order_id:orderId, reservation_token:token } }
        );
        if ((reserve.matchedCount ?? reserve.modifiedCount ?? reserve.updated ?? 0) !== 1) continue;

        const newAttempt = Number(assignmentAttempt) + 1;
        const assignedAt = new Date().toISOString();
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
              assigned_base:nextDriver.queue_authoritative_base || order.zone || null,
              offerExpiresAt:null,
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

        const deliveryUnconfirmed = deliveryExhausted;
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
          pending_reason:'CHAIN_EXHAUSTED',
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
    const deliveryUnconfirmed = deliveryExhausted;
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
          source,
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