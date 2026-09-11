import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';
import { findNextDriverInZone } from '../../shared/driverSelection.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const b44 = base44.asServiceRole;
    const payload = await req.json();
    const { orderId, driverId, assignmentAttempt } = payload;
    if (!orderId || !driverId) return Response.json({ success:false, reason:'missing_params' }, { status:400 });
    if (!(await verifyRequestAuth(b44, payload, { allowDriverId:driverId }))) return Response.json({ success:false, reason:'unauthorized' }, { status:401 });

    const order = await b44.entities.RideOrder.get(orderId);
    if (!order) return Response.json({ success:false, reason:'ORDER_NOT_FOUND' });
    if (order.status !== 'ofrecido' || order.reserved_driver_id !== driverId || order.assignment_attempt !== assignmentAttempt) return Response.json({ success:false, reason:'STALE_OR_EXPIRED' });

    await b44.entities.Driver.updateMany(
      { id:driverId, reserved_order_id:orderId, reservation_token:order.reservation_token },
      { $set:{ status:'disponible', dispatch_status:'normal', queue_entered_at:new Date().toISOString(), active_order_id:null, active_ride_id:null, reserved_order_id:null, reservation_token:null, manual_reservation_token:null, driver_reservation_key:null } }
    );
    b44.functions.invoke('sendPushNotification', { action:'cancel_multiple', orderId:order.id, driversToCancel:[driverId], orderData:{ assignmentAttempt }, internalKey:Deno.env.get('INTERNAL_SERVICE_KEY') }).catch(e=>console.error('Error cancelando push:',e));

    const config = (await b44.entities.TarifaConfig.list())[0] || {};
    const timeoutSeconds = config.tiempo_maximo_respuesta_segundos ?? 60;
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

        const newAttempt = assignmentAttempt + 1;
        const assignedAt = new Date().toISOString();
        const expiresAt = Date.now() + timeoutSeconds*1000;
        const offeredIds = [...new Set([...(order.offered_driver_ids || []), driverId, nextDriver.id].filter(Boolean))];
        const commit = await b44.entities.RideOrder.updateMany(
          { id:orderId, status:'ofrecido', reserved_driver_id:driverId, reservation_token:order.reservation_token, assignment_attempt:assignmentAttempt },
          { $set:{ status:'ofrecido', driver_id:nextDriver.id, driver_name:nextDriver.name, reserved_driver_id:nextDriver.id, reservation_token:token, manual_reservation_token:null, assigned_base:nextDriver.current_base, offerExpiresAt:expiresAt, assignment_attempt:newAttempt, assigned_at:assignedAt, processingAction:null, processingOperationKey:null, processingOwnerId:null, processingLeaseExpiresAt:null, processingPhase:null, offered_driver_ids:offeredIds } }
        );
        if (commit.updated !== 1) {
          await b44.entities.Driver.updateMany({ id:nextDriver.id, reserved_order_id:orderId, reservation_token:token }, { $set:{ dispatch_status:'normal', reserved_order_id:null, reservation_token:null } }).catch(()=>{});
          return Response.json({ success:true, skipped:true, reason:'order_changed_during_candidate_reservation' });
        }

        b44.functions.invoke('sendPushNotification', { action:'send', driverId:nextDriver.id, orderId, orderData:{ pickup_address:order.pickup_address, dropoff_address:order.dropoff_address, fare:order.fare, notes:order.notes, assignmentAttempt:newAttempt }, internalKey:Deno.env.get('INTERNAL_SERVICE_KEY') }).catch(e=>console.error('Error push rejectRide:',e));
        b44.functions.invoke('autoReassignOnTimeout', { orderId, driverId:nextDriver.id, timeoutSeconds, assignmentAttempt:newAttempt, internalKey:Deno.env.get('INTERNAL_SERVICE_KEY') }).catch(e=>console.error('AutoReassign Trigger Error:',e));
        await b44.entities.AuditLog.create({ action:'rechazar_viaje', user_type:'chofer', user_name:'Chofer', details:`Rechazó. Reasignado a ${nextDriver.name}` }).catch(()=>{});
        return Response.json({ success:true, reassigned_to:nextDriver.name });
      }
    }

    await b44.entities.RideOrder.updateMany(
      { id:orderId, status:'ofrecido', reserved_driver_id:driverId, reservation_token:order.reservation_token, assignment_attempt:assignmentAttempt },
      { $set:{ status:'pendiente', driver_id:null, driver_name:null, reserved_driver_id:null, reservation_token:null, manual_reservation_token:null, assigned_at:null, offerExpiresAt:null, assigned_base:null, processingAction:null, processingOperationKey:null, processingOwnerId:null, processingLeaseExpiresAt:null, processingPhase:null }, $addToSet:{ offered_driver_ids:driverId } }
    );
    await b44.entities.AuditLog.create({ action:'rechazar_viaje', user_type:'chofer', user_name:'Chofer', details:'Rechazó. Sin candidatos válidos en la zona, quedó pendiente.' }).catch(()=>{});
    return Response.json({ success:true, reassigned_to:null });
  } catch (error:any) {
    console.error('RejectRide Error:',error);
    return Response.json({ success:false, error:error.message }, { status:500 });
  }
});