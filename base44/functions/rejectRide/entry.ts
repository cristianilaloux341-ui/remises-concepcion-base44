import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';
import { findNextDriverInZone } from '../../shared/driverSelection.ts';

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
        : (payload.source === 'legacy_client' ? 'legacy_client' : 'driver'));
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
          processingAction: source === 'timeout' ? 'TIMEOUT' : 'REJECT',
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

    // REGLA DE COLA MANUAL: rechazo o timeout NO reinsertan al móvil en ninguna
    // posición. Se libera la oferta y el móvil queda sin base/posición hasta que
    // el propio chofer vuelva a entrar a una base o el operador lo acomode.
    // Conservamos queueNow/queueBase sólo para auditoría/compatibilidad del flujo legacy.
    const queueNow = new Date().toISOString();
    const queueBase = order.assigned_base || order.zone || null;
    const releasedCurrent = await b44.entities.Driver.updateMany(
      {
        id: driverId,
        status: 'disponible',
        dispatch_status: 'automatic_pending',
        reserved_order_id: orderId,
        reservation_token: order.reservation_token
      },
      {
        $set: {
          status:'disponible',
          dispatch_status:'normal',
          // Rechazo/timeout: fuera de cola. No existe reingreso automático.
          current_base:null,
          queue_entered_at:null,
          queue_authoritative_base:null,
          queue_authoritative_at:null,
          queue_authority_marker:null,
          queue_position:null,
          active_order_id:null,
          active_ride_id:null,
          reserved_order_id:null,
          reservation_token:null,
          manual_reservation_token:null,
          driver_reservation_key:null
        }
      }
    );
    const releasedCount = releasedCurrent.matchedCount ?? releasedCurrent.modifiedCount ?? releasedCurrent.updated ?? 0;
    if (releasedCount !== 1) {
      // Compatibilidad con v12.27/v12.29: esas APK primero liberan el Driver y
      // recién después piden la reasignación. Si el workflow nos trae exactamente
      // ese evento, adoptamos la liberación ya hecha en vez de restaurarla y competir
      // con el teléfono. La validación exige que el Driver siga libre, sin otro viaje
      // y con el mismo queue_entered_at observado en el evento que disparó esta llamada.
      const currentDriver = source === 'legacy_client'
        ? await b44.entities.Driver.get(driverId).catch(() => null)
        : null;
      const legacyAlreadyReleased = Boolean(
        source === 'legacy_client' &&
        currentDriver &&
        currentDriver.status === 'disponible' &&
        (currentDriver.dispatch_status == null || currentDriver.dispatch_status === 'normal') &&
        !currentDriver.reserved_order_id &&
        !currentDriver.active_order_id &&
        !currentDriver.active_ride_id &&
        (!legacyQueueEnteredAt || String(currentDriver.queue_entered_at || '') === String(legacyQueueEnteredAt))
      );

      if (legacyAlreadyReleased) {
        currentReleased = true;
        await b44.entities.Driver.updateMany(
          { id:driverId, status:'disponible', reserved_order_id:null, active_order_id:null, active_ride_id:null },
          { $set:{
            current_base:null,
            queue_entered_at:null,
            queue_authoritative_base:null,
            queue_authoritative_at:null,
            queue_authority_marker:null,
            queue_position:null
          } }
        ).catch(()=>{});
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
    }

    // Primero apagar/cerrar la oferta anterior. La cancelación conserva el intento
    // exacto que recibió ese teléfono, aunque el RideOrder cambie después.
    // No dependemos de un único intento de red: si falla el primer cierre, repetimos
    // una vez y dejamos auditoría explícita. La reasignación puede continuar, pero
    // queda trazado si el móvil anterior no pudo recibir la orden de cierre.
    let closePushOk = false;
    let closePushError = null;
    for (let closeAttempt = 1; closeAttempt <= 2 && !closePushOk; closeAttempt++) {
      try {
        const closeRes = await b44.functions.invoke('sendPushNotification', {
          action:'cancel_multiple',
          orderId:order.id,
          driversToCancel:[driverId],
          orderData:{ assignmentAttempt:Number(assignmentAttempt) },
          internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
        });
        const closeData = closeRes?.data || closeRes;
        closePushOk = closeData?.ok !== false && !closeData?.error;
        if (!closePushOk) closePushError = closeData?.error || closeData?.reason || 'cancel_push_failed';
      } catch (e) {
        closePushError = e?.message || String(e);
      }
    }

    await b44.entities.AuditLog.create({
      action: closePushOk ? 'OFFER_CLOSE_CONFIRMED_BEFORE_REASSIGN' : 'OFFER_CLOSE_FAILED_BEFORE_REASSIGN',
      user_type:'sistema',
      user_name:'rejectRide',
      details: closePushOk
        ? `Oferta ${order.id} cerrada en móvil anterior antes de reasignar`
        : `No se pudo confirmar cierre de oferta ${order.id} en móvil anterior antes de reasignar`,
      metadata:{ orderId:order.id, driverId, assignmentAttempt:Number(assignmentAttempt), error:closePushError }
    }).catch(()=>{});

    const config = (await b44.entities.TarifaConfig.list())[0] || {};
    // Regla comercial: cada NUEVA oferta tiene 30 s desde que llega al teléfono.
    // El valor inicial sólo protege el tránsito hasta el ACK; native_ack lo vuelve
    // a fijar a 30 s completos desde la recepción real del nuevo móvil.
    const configuredSeconds = Number(config.tiempo_maximo_respuesta_segundos ?? 30);
    const timeoutSeconds = Number.isFinite(configuredSeconds) && configuredSeconds > 0 ? configuredSeconds : 30;
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
              assigned_base:nextDriver.current_base,
              offerExpiresAt:expiresAt,
              assignment_attempt:newAttempt,
              assigned_at:assignedAt,
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

        b44.functions.invoke('autoReassignOnTimeout', {
          orderId,
          driverId:nextDriver.id,
          assignmentAttempt:newAttempt,
          internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
        }).catch(e=>console.error('AutoReassign Trigger Error:',e));

        await b44.entities.AuditLog.create({
          action: source === 'timeout' ? 'timeout_viaje' : 'rechazar_viaje',
          user_type: source === 'timeout' ? 'sistema' : 'chofer',
          user_name: source === 'timeout' ? 'Sistema' : 'Chofer',
          details: `${source === 'timeout' ? 'Venció el tiempo' : 'Rechazó'}. Reasignado a ${nextDriver.name}`,
          metadata:{ orderId, driverId, assignmentAttempt:Number(assignmentAttempt), nextDriverId:nextDriver.id }
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
          assigned_base:null,
          processingAction:null,
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
    await b44.entities.AuditLog.create({
      action: source === 'timeout' ? 'timeout_viaje' : 'rechazar_viaje',
      user_type: source === 'timeout' ? 'sistema' : 'chofer',
      user_name: source === 'timeout' ? 'Sistema' : 'Chofer',
      details: `${source === 'timeout' ? 'Venció el tiempo' : 'Rechazó'}. Sin candidatos válidos en la zona, quedó pendiente.`,
      metadata:{ orderId, driverId, assignmentAttempt:Number(assignmentAttempt) }
    }).catch(()=>{});
    return Response.json({ success:true, reassigned_to:null, source });
  } catch (error:any) {
    console.error('RejectRide Error:',error);

    // Si ya liberamos al móvil anterior y algo excepcional falló, el estado más
    // seguro es Pendiente; nunca dejar una oferta activa apuntando a un móvil libre.
    if (b44 && lockOwner && lockOrderId && lockedOrder) {
      if (currentReleased) {
        await b44.entities.RideOrder.updateMany(
          {
            id:lockOrderId,
            status:'ofrecido',
            reserved_driver_id:lockedOrder.reserved_driver_id,
            reservation_token:lockedOrder.reservation_token,
            assignment_attempt:lockedOrder.assignment_attempt,
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
              assigned_base:null,
              processingAction:null,
              processingOperationKey:null,
              processingOwnerId:null,
              processingLeaseExpiresAt:null,
              processingPhase:null
            }
          }
        ).catch(()=>{});
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