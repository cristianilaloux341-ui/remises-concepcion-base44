import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

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

    const authorized = await verifyRequestAuth(b44, payload, { allowClientId: clientId });
    if (!authorized) return Response.json({ success:false, reason:'unauthorized' }, { status:401 });

    const order = await b44.entities.RideOrder.get(orderId).catch(() => null);
    if (!order) return Response.json({ success:false, reason:'order_not_found' }, { status:404 });
    if (String(order.client_id || '') !== String(clientId)) {
      return Response.json({ success:false, reason:'client_mismatch' }, { status:403 });
    }

    if (order.status === 'cancelado') return Response.json({ success:true, alreadyCancelled:true });
    if (!CANCELLABLE.has(order.status)) {
      return Response.json({ success:false, reason:'ride_not_cancellable', status:order.status }, { status:409 });
    }

    const toCancel = [...new Set([order.driver_id, order.reserved_driver_id])].filter(Boolean);

    // CAS: no pisa una aceptación/inicio/completado que haya ocurrido mientras se cancelaba.
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

    if (toCancel.length > 0) {
      // Misma regla del botón Cancelar del Operador: sólo libera móviles que TODAVÍA
      // apuntan a esta orden. No toca current_base, por lo que conserva su zona.
      await b44.entities.Driver.updateMany(
        {
          id: { $in: toCancel },
          $or: [
            { active_order_id: orderId },
            { active_ride_id: orderId },
            { reserved_order_id: orderId }
          ]
        },
        { $set: {
          status:'disponible',
          dispatch_status:'normal',
          active_order_id:null,
          active_ride_id:null,
          reserved_order_id:null,
          reservation_token:null,
          manual_reservation_token:null,
          driver_reservation_key:null
        }}
      ).catch(() => {});

      // Cancelación desde central devuelve primero a la cola. Conservamos esa semántica
      // también para el cliente, pero sólo sobre el móvil realmente asignado.
      if (order.driver_id) {
        await b44.entities.Driver.updateMany(
          {
            id: order.driver_id,
            $or: [
              { active_order_id: null },
              { active_ride_id: null },
              { reserved_order_id: null }
            ]
          },
          { $set: { queue_entered_at: new Date(Date.now() - 31536000000).toISOString() } }
        ).catch(() => {});
      }

      base44.functions.invoke('sendPushNotification', {
        action:'cancel_multiple',
        driversToCancel:toCancel,
        orderId,
        sessionToken
      }).catch(() => {});
    }

    await b44.entities.AuditLog.create({
      action:'CLIENT_RIDE_CANCELLED',
      user_type:'cliente',
      user_name:order.client_name || 'Cliente',
      details:`Cliente canceló viaje ${orderId}`,
      metadata:{ orderId, driversToCancel:toCancel, previousStatus:order.status }
    }).catch(() => {});

    return Response.json({ success:true, orderId });
  } catch (e:any) {
    console.error('clientCancelRide error', e);
    return Response.json({ success:false, reason:e?.message || 'error' }, { status:500 });
  }
});