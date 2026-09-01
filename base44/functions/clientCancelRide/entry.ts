import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

const CANCELLABLE = new Set(['procesando_despacho','pendiente','ofrecido','aceptado','en_camino']);

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;

  try {
    const payload = await req.json();
    const { orderId, clientId, sessionToken } = payload || {};
    if (!orderId || !clientId || !sessionToken) {
      return Response.json({ success:false, reason:'missing_fields' }, { status:400 });
    }

    const order = await b44.entities.RideOrder.get(orderId).catch(() => null);
    if (!order) return Response.json({ success:false, reason:'order_not_found' }, { status:404 });
    if (String(order.client_id || '') !== String(clientId)) {
      return Response.json({ success:false, reason:'client_mismatch' }, { status:403 });
    }

    const clients = await b44.entities.Client.filter({ id: clientId }).catch(() => []);
    const client = clients?.[0] || null;
    const storedToken = client?.session_token || client?.client_session_token || client?.token || null;
    if (!client || !storedToken || String(storedToken) !== String(sessionToken)) {
      return Response.json({ success:false, reason:'invalid_session' }, { status:401 });
    }

    if (order.status === 'cancelado') return Response.json({ success:true, alreadyCancelled:true });
    if (!CANCELLABLE.has(order.status)) {
      return Response.json({ success:false, reason:'ride_not_cancellable', status:order.status }, { status:409 });
    }

    const driverId = order.reserved_driver_id || order.driver_id || null;
    const token = order.reservation_token || order.assignment_token || null;

    // CAS: sólo cancela si el viaje sigue en el mismo estado observado.
    const changed = await b44.entities.RideOrder.updateMany(
      { id: orderId, status: order.status },
      { $set: {
        status:'cancelado',
        cancelled_by:'cliente',
        cancelled_at:new Date().toISOString(),
        reserved_driver_id:null,
        reservation_token:null
      }}
    );
    const modified = Number(changed?.modifiedCount ?? changed?.modified_count ?? 0);
    if (modified < 1) {
      const current = await b44.entities.RideOrder.get(orderId).catch(() => null);
      if (current?.status === 'cancelado') return Response.json({ success:true, alreadyCancelled:true });
      return Response.json({ success:false, reason:'ride_changed', status:current?.status || null }, { status:409 });
    }

    // Libera únicamente al móvil que todavía apunta a ESTE viaje. No toca current_base:
    // el móvil conserva su zona y vuelve disponible allí.
    if (driverId) {
      const driver = await b44.entities.Driver.get(driverId).catch(() => null);
      if (driver) {
        const stillOwnsRide = driver.reserved_order_id === orderId || driver.active_order_id === orderId || driver.active_ride_id === orderId;
        const tokenMatches = !token || !driver.reservation_token || driver.reservation_token === token;
        if (stillOwnsRide && tokenMatches) {
          await b44.entities.Driver.updateMany(
            { id: driverId },
            { $set: {
              status:'disponible', dispatch_status:'normal',
              reserved_order_id:null, active_order_id:null, active_ride_id:null,
              reservation_token:null, manual_reservation_token:null, driver_reservation_key:null,
              queue_entered_at:null
            }}
          );
        }
      }
    }

    await b44.entities.AuditLog.create({
      action:'CLIENT_RIDE_CANCELLED', user_type:'cliente', user_name: order.client_name || 'Cliente',
      details:`Cliente canceló viaje ${orderId}`,
      metadata:{ orderId, driverId, previousStatus:order.status }
    }).catch(() => {});

    return Response.json({ success:true, orderId });
  } catch (e:any) {
    console.error('clientCancelRide error', e);
    return Response.json({ success:false, reason:e?.message || 'error' }, { status:500 });
  }
});