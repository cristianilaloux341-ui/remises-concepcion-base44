import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  try {
    const { orderId, sessionToken, operatorName } = await req.json();
    if (!orderId) return Response.json({ success:false, reason:'ORDER_ID_REQUIRED' }, { status:400 });

    // Misma autenticación operativa que el resto de comandos de Central:
    // la sesión se valida por la función de acción antes de tocar estado.
    const cancel = await b44.functions.invoke('operatorOrderAction', {
      action: 'cancel',
      orderId,
      sessionToken
    });
    if (!cancel?.data?.success) {
      return Response.json({ success:false, reason: cancel?.data?.reason || 'CANCEL_FAILED' }, { status:409 });
    }

    const fresh = await b44.entities.RideOrder.get(orderId).catch(() => null);
    if (!fresh) return Response.json({ success:true, alreadyDeleted:true });

    // Limpiar únicamente vínculos que todavía pertenecen a ESTA orden.
    if (fresh.preassigned_driver_id) {
      await b44.entities.Driver.updateMany(
        { id: fresh.preassigned_driver_id, next_order_id: orderId },
        { $set: { next_order_id:null, next_order_token:null } }
      ).catch(() => {});
    }

    const linked = [...new Set([fresh.driver_id, fresh.reserved_driver_id].filter(Boolean))];
    for (const driverId of linked) {
      const driver = await b44.entities.Driver.get(driverId).catch(() => null);
      if (!driver) continue;

      const set:any = {};
      const query:any = { id: driverId };
      let ownsCurrent = false;

      if (driver.active_order_id === orderId) {
        query.active_order_id = orderId;
        set.active_order_id = null;
        ownsCurrent = true;
      }
      if (driver.active_ride_id === orderId) {
        query.active_ride_id = orderId;
        set.active_ride_id = null;
        ownsCurrent = true;
      }
      if (driver.reserved_order_id === orderId) {
        query.reserved_order_id = orderId;
        set.reserved_order_id = null;
        set.reservation_token = null;
        set.manual_reservation_token = null;
        set.driver_reservation_key = null;
        ownsCurrent = true;
      }

      // Nunca borrar el otro slot. Si queda un segundo viaje confirmado, tampoco
      // declarar al móvil libre: su promoción pertenece al motor canónico.
      if (ownsCurrent) {
        if (!driver.next_order_id) {
          set.status = 'disponible';
          set.dispatch_status = 'normal';
        }
        await b44.entities.Driver.updateMany(query, { $set:set }).catch(() => {});
      }
    }

    await b44.entities.RideOrder.delete(orderId);
    await b44.entities.AuditLog.create({
      action:'eliminar_viaje',
      user_type:'operador',
      user_name: operatorName || 'Central',
      details:`Eliminó la orden de viaje ID ${orderId}`,
      metadata:{ orderId, canonical:true }
    }).catch(() => {});

    return Response.json({ success:true });
  } catch (e) {
    console.error('operatorDeleteRide error', e);
    return Response.json({ success:false, reason:e?.message || 'DELETE_FAILED' }, { status:500 });
  }
});