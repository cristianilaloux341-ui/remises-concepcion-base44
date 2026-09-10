import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const b44 = base44.asServiceRole;
    const payload = await req.json();
    const { orderId, driverId, timeoutSeconds = 60, assignmentAttempt } = payload;

    if (!(await verifyRequestAuth(b44, payload))) {
      return Response.json({ success: false, reason: 'unauthorized' }, { status: 401 });
    }
    if (!orderId || !driverId) return Response.json({ error: 'Missing parameters' }, { status: 400 });

    const maxSleep = 25;
    if (timeoutSeconds > maxSleep) {
      await new Promise(resolve => setTimeout(resolve, maxSleep * 1000));
      const order = (await b44.entities.RideOrder.filter({ id: orderId }))[0];
      if (!order || ['aceptado','en_camino','en_viaje','completado','cancelado','rechazado'].includes(order.status)) return Response.json({ ok:true, skipped:true });
      if (order.driver_id && order.driver_id !== driverId) return Response.json({ ok:true, skipped:true });
      const freshOrder = await b44.entities.RideOrder.get(orderId);
      if (freshOrder && freshOrder.assignment_attempt !== assignmentAttempt) return Response.json({ ok:true, skipped:true, reason:'attempt_changed' });
      b44.functions.invoke('autoReassignOnTimeout', { orderId, driverId, timeoutSeconds: timeoutSeconds-maxSleep, assignmentAttempt, internalKey:Deno.env.get('INTERNAL_SERVICE_KEY') }).catch(e=>console.error('Chain Error:',e));
      return Response.json({ ok:true, chained:true, remaining:timeoutSeconds-maxSleep });
    }

    await new Promise(resolve => setTimeout(resolve, timeoutSeconds * 1000));

    const order = (await b44.entities.RideOrder.filter({ id: orderId }))[0];
    if (!order || ['aceptado','en_camino','en_viaje','completado','cancelado','rechazado'].includes(order.status)) return Response.json({ ok:true, skipped:true });
    if (order.driver_id && order.driver_id !== driverId) return Response.json({ ok:true, skipped:true });
    if (order.assignment_attempt !== assignmentAttempt) return Response.json({ ok:true, skipped:true, reason:'attempt_changed' });

    const authoritativeExpiresAt = Number(order.offerExpiresAt);
    const remainingMs = Number.isFinite(authoritativeExpiresAt) ? authoritativeExpiresAt-Date.now() : 0;
    if (remainingMs > 0) {
      b44.functions.invoke('autoReassignOnTimeout', { orderId, driverId, timeoutSeconds:Math.max(1,Math.ceil(remainingMs/1000)), assignmentAttempt, internalKey:Deno.env.get('INTERNAL_SERVICE_KEY') }).catch(e=>console.error('Extended Timeout Chain Error:',e));
      return Response.json({ ok:true, extended_for_device_receipt:true, remainingSeconds:Math.ceil(remainingMs/1000) });
    }

    const currentDriver = (await b44.entities.Driver.filter({ id:driverId }))[0];
    const tarifaConfigs = await b44.entities.TarifaConfig.list();
    const autoReassignActive = tarifaConfigs[0]?.auto_reasignacion_activa ?? true;
    const originalTimeoutSeconds = tarifaConfigs[0]?.tiempo_maximo_respuesta_segundos ?? 60;

    // La oferta vencida ya no debe volver al mismo móvil. Lo colocamos al final de su cola.
    if (currentDriver) {
      await b44.entities.Driver.updateMany(
        { id:currentDriver.id, reserved_order_id:order.id, reservation_token:order.reservation_token },
        { $set:{ status:'disponible', dispatch_status:'normal', reserved_order_id:null, active_order_id:null, active_ride_id:null, reservation_token:null, manual_reservation_token:null, driver_reservation_key:null, queue_entered_at:new Date().toISOString() } }
      ).catch(()=>{});
      b44.functions.invoke('sendPushNotification', { action:'cancel_multiple', orderId:order.id, driversToCancel:[currentDriver.id], internalKey:Deno.env.get('INTERNAL_SERVICE_KEY') }).catch(e=>console.error('Error cancelando push anterior:',e));
    }

    const { findNextDriverInZone } = await import('../../shared/driverSelection.ts');
    const locallyExcluded = new Set<string>([...(order.offered_driver_ids || []), driverId].filter(Boolean));
    const maxCandidates = 100;

    if (autoReassignActive) {
      for (let i=0; i<maxCandidates; i++) {
        // findNextDriverInZone usa offered_driver_ids; agregamos sólo exclusiones locales de candidatos que perdieron carrera.
        const selectionOrder = { ...order, offered_driver_ids:[...locallyExcluded] };
        const nextDriver = await findNextDriverInZone(b44, selectionOrder, driverId);
        if (!nextDriver) break;
        locallyExcluded.add(nextDriver.id);

        // CRÍTICO: primero reservar Driver. Hasta este punto RideOrder sigue perteneciendo a la oferta vencida.
        const nextReservationToken = crypto.randomUUID();
        const reserveNext = await b44.entities.Driver.updateMany(
          { id:nextDriver.id, status:'disponible', dispatch_status:'normal', reserved_order_id:null, active_order_id:null, active_ride_id:null },
          { $set:{ dispatch_status:'automatic_pending', reserved_order_id:order.id, reservation_token:nextReservationToken } }
        );
        if ((reserveNext.matchedCount ?? reserveNext.modifiedCount ?? reserveNext.updated ?? 0) !== 1) continue;

        const newAttempt = (order.assignment_attempt || 0)+1;
        const assignedAt = new Date().toISOString();
        const offerExpiresAt = Date.now() + originalTimeoutSeconds*1000;
        const offeredIds = [...new Set([...(order.offered_driver_ids || []), driverId, nextDriver.id].filter(Boolean))];

        // Sólo después de tener la reserva real publicamos la nueva oferta.
        const commit = await b44.entities.RideOrder.updateMany(
          { id:orderId, status:'ofrecido', reserved_driver_id:driverId, reservation_token:order.reservation_token, assignment_attempt:assignmentAttempt },
          { $set:{ status:'ofrecido', driver_id:nextDriver.id, driver_name:nextDriver.name, reserved_driver_id:nextDriver.id, reservation_token:nextReservationToken, manual_reservation_token:null, assigned_base:nextDriver.current_base, offerExpiresAt, processingAction:null, processingOperationKey:null, processingOwnerId:null, processingLeaseExpiresAt:null, processingPhase:null, assignment_attempt:newAttempt, assigned_at:assignedAt, offered_driver_ids:offeredIds } }
        );

        if (commit.updated !== 1) {
          // El viaje cambió mientras reservábamos: liberar únicamente nuestra reserva y no enviar push viejo.
          await b44.entities.Driver.updateMany(
            { id:nextDriver.id, reserved_order_id:order.id, reservation_token:nextReservationToken },
            { $set:{ dispatch_status:'normal', reserved_order_id:null, reservation_token:null } }
          ).catch(()=>{});
          return Response.json({ ok:true, skipped:true, reason:'order_changed_during_candidate_reservation' });
        }

        await b44.functions.invoke('sendPushNotification', {
          action:'send', driverId:nextDriver.id, orderId:order.id,
          orderData:{ pickup_address:order.pickup_address, dropoff_address:order.dropoff_address, fare:order.fare, notes:order.notes, assignmentAttempt:newAttempt },
          internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
        }).catch(e=>console.error('Error push autoReassign:',e));

        b44.functions.invoke('autoReassignOnTimeout', { orderId, driverId:nextDriver.id, timeoutSeconds:originalTimeoutSeconds, assignmentAttempt:newAttempt, internalKey:Deno.env.get('INTERNAL_SERVICE_KEY') }).catch(e=>console.error('AutoReassign Trigger Error:',e));
        return Response.json({ ok:true, reassigned_to:nextDriver.name });
      }
    }

    // Sólo queda pendiente cuando no existe ningún candidato reservable de la misma zona.
    const pending = await b44.entities.RideOrder.updateMany(
      { id:orderId, status:'ofrecido', reserved_driver_id:driverId, reservation_token:order.reservation_token, assignment_attempt:assignmentAttempt },
      { $set:{ status:'pendiente', driver_id:null, driver_name:null, reserved_driver_id:null, reservation_token:null, manual_reservation_token:null, assigned_base:null, assigned_at:null, offerExpiresAt:null, processingAction:null, processingOperationKey:null, processingOwnerId:null, processingLeaseExpiresAt:null, processingPhase:null }, $addToSet:{ offered_driver_ids:driverId } }
    );
    if (pending.updated !== 1) return Response.json({ ok:true, skipped:true, reason:'order_changed_before_pending' });
    return Response.json({ ok:true, reassigned_to:null });
  } catch (err:any) {
    console.error('Auto-reassign error:',err);
    return Response.json({ error:err.message }, { status:500 });
  }
});