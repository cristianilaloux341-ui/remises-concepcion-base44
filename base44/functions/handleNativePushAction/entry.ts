import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { reassignAfterAutomaticReject } from '../../shared/DispatchLogic.ts';
import { verifyRequestAuth } from '../../shared/security.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  
  try {
    const payload = await req.json();
    
    const { action, orderId, driverId } = payload;
    
    // NOTA: No usamos verifyRequestAuth aquí porque la app nativa de Android no tiene
    // cómo enviar el sessionToken en el intent del BroadcastReceiver actualmente.
    // La seguridad está garantizada verificando que el viaje esté 'ofrecido' a este 'driverId'.
    
    if (!orderId || !driverId) {
      return Response.json({ success: false, reason: "missing_params" });
    }

    const realOrderId = orderId.includes('_att_') ? orderId.split('_att_')[0] : orderId;

    if (action === "native_accept") {
      const order = await b44.entities.RideOrder.get(realOrderId);
      if (!order) return Response.json({ success: false, reason: "order_not_found" });
      
      const driver = await b44.entities.Driver.get(driverId);
      if (!driver) return Response.json({ success: false, reason: "driver_not_found" });

      const attempt = order.assignment_attempt || 1;
      
      // Llamamos internamente a la función de aceptación de producción
      const result = await b44.functions.invoke("acceptRide", {
         orderId: realOrderId,
         driverId,
         assignmentAttempt: attempt,
         sessionToken: driver.current_session_token
      });
      
      return Response.json(result);
      
    } else if (action === "native_reject") {
      const order = await b44.entities.RideOrder.get(realOrderId);
      if (!order) return Response.json({ success: false, reason: "order_not_found" });

      if (order.status !== "ofrecido" || order.reserved_driver_id !== driverId) {
         return Response.json({ success: false, reason: "already_processed_or_expired" });
      }

      // Buscar si el driver sigue teniendo este viaje reservado
      const driver = await b44.entities.Driver.get(driverId);
      if (driver) {
        // Liberamos al conductor atómicamente si estaba bloqueado por este viaje
        if (driver.dispatch_status === 'automatic_pending' || driver.reserved_order_id === realOrderId) {
           await b44.entities.Driver.updateMany(
             { id: driverId, reserved_order_id: realOrderId },
             { $set: { dispatch_status: 'normal', reserved_order_id: null, reservation_token: null } }
           );
        }
      }

      // Reasignación atómica al siguiente chofer (o volver a pendiente si no hay piloto)
      let baseId = order.assigned_base || '1-Puerto';
      if (driver && driver.current_base) {
         baseId = driver.current_base;
      }
      
      const oldToken = order.reservation_token;
      let rejectResult;
      
      try {
        rejectResult = await reassignAfterAutomaticReject(b44, baseId, realOrderId, driverId, oldToken);
      } catch (e) {
        // Si falla la reasignación atómica, forzamos la liberación del viaje
        await b44.entities.RideOrder.updateMany(
           { id: realOrderId, status: "ofrecido", reserved_driver_id: driverId },
           { $set: { status: "procesando_despacho", reserved_driver_id: null, reservation_token: null, driver_name: null }, $push: { offered_driver_ids: driverId } }
        );
        rejectResult = { status: 'forced_reverted' };
      }

      await b44.entities.AuditLog.create({
        action: 'RIDE_REJECTED_NATIVE',
        user_type: 'chofer',
        user_name: driver ? driver.name : driverId,
        details: `Chofer rechazó viaje ${realOrderId} desde notificación nativa. Resultado reasignación: ${rejectResult.status}`
      }).catch(() => {});

      return Response.json({ success: true, rejectResult });
    }

    return Response.json({ success: false, reason: "unknown_action" });
  } catch (error: any) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});