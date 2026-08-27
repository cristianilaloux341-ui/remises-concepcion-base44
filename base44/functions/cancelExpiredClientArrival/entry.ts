import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { validateInternalKey } from '../../shared/security.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  try {
    const payload = await req.json();
    const { orderId, internalKey } = payload || {};
    if (!orderId) return Response.json({ success:false, reason:'missing_order' }, { status:400 });
    if (!validateInternalKey(internalKey)) return Response.json({ success:false, reason:'unauthorized' }, { status:401 });

    let order = await b44.entities.RideOrder.get(orderId).catch(() => null);
    if (!order) return Response.json({ success:false, reason:'order_not_found' }, { status:404 });
    if (order.status === 'cancelado' && order.client_arrival_cancel_reason === 'cliente_no_responde') return Response.json({ success:true, alreadyCancelled:true });
    if (order.status !== 'en_camino') return Response.json({ success:false, reason:'invalid_status', status:order.status }, { status:409 });
    if (order.client_arrival_acknowledged === true) return Response.json({ success:false, reason:'client_acknowledged' }, { status:409 });
    if (Number(order.client_arrival_notice_count || 0) < 2 || !order.client_arrival_second_notice_at || !order.client_arrival_expires_at) return Response.json({ success:false, reason:'second_notice_not_completed' }, { status:409 });
    const expiresAt = Date.parse(order.client_arrival_expires_at);
    if (!Number.isFinite(expiresAt) || Date.now() < expiresAt) return Response.json({ success:false, reason:'not_expired', expiresAt:order.client_arrival_expires_at }, { status:409 });

    order = await b44.entities.RideOrder.get(orderId).catch(() => null);
    if (!order || order.status !== 'en_camino' || order.client_arrival_acknowledged === true) return Response.json({ success:false, reason:'state_changed_before_cancel' }, { status:409 });

    const driverId = order.driver_id;
    const driver = driverId ? await b44.entities.Driver.get(driverId).catch(() => null) : null;

    await b44.entities.RideOrder.update(orderId, {
      status:'cancelado', client_arrival_cancel_reason:'cliente_no_responde', client_arrival_expires_at:null,
      reservation_token:null, manual_reservation_token:null, reserved_driver_id:null
    });

    let returnedFirst = false;
    let queueEnteredAt:string|null = null;
    if (driver) {
      const patch:any = {};
      if (driver.active_order_id === orderId) patch.active_order_id = null;
      if (driver.active_ride_id === orderId) patch.active_ride_id = null;
      if (driver.reserved_order_id === orderId) patch.reserved_order_id = null;
      const stillOwnsThisRide = driver.active_order_id === orderId || driver.active_ride_id === orderId || driver.reserved_order_id === orderId;
      if (stillOwnsThisRide) {
        patch.status = 'disponible'; patch.dispatch_status = 'normal';
        patch.reservation_token = null; patch.manual_reservation_token = null; patch.driver_reservation_key = null;
        if (driver.current_base) {
          queueEnteredAt = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
          patch.queue_entered_at = queueEnteredAt; patch.queue_position = 1; returnedFirst = true;
        }
        await b44.entities.Driver.updateMany({ id:driverId }, { $set:patch });
      }
    }

    await b44.entities.AuditLog.create({
      action:'CLIENT_NO_RESPONSE_AUTO_CANCEL', user_type:'sistema', user_name:'Sistema',
      details:`Viaje ${orderId} cancelado: cliente no respondió luego del segundo aviso.`,
      metadata:{ orderId, driverId:driverId || null, base:driver?.current_base || null, returnedFirst, queueEnteredAt }
    }).catch(() => {});

    return Response.json({ success:true, cancelled:true, driverId:driverId || null, returnedFirst });
  } catch (e:any) {
    return Response.json({ success:false, reason:e?.message || 'error' }, { status:500 });
  }
});
