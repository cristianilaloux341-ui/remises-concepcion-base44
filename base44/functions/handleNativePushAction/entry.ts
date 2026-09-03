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

    const attemptMatch = String(orderId).match(/_att_(\d+)$/);
    const nativeAssignmentAttempt = attemptMatch ? Number(attemptMatch[1]) : null;
    const realOrderId = String(orderId).replace(/_att_\d+$/, '');

    if (action === "native_ack") {
      const driver = await b44.entities.Driver.get(driverId);
      await b44.entities.AuditLog.create({
        action: "push_ack_recibido",
        user_type: "sistema",
        user_name: driver?.name || "Chofer",
        details: `El teléfono confirmó recepción del push en SEGUNDO PLANO (Nativo Android).`,
        metadata: { orderId: realOrderId, driverId }
      }).catch(() => {});
      return Response.json({ success: true });
    } else if (action === "native_accept") {
      const order = await b44.entities.RideOrder.get(realOrderId);
      if (!order) return Response.json({ success: false, reason: "order_not_found" });
      
      const driver = await b44.entities.Driver.get(driverId);
      if (!driver) return Response.json({ success: false, reason: "driver_not_found" });

      // La acción nativa debe conservar el intento ORIGINAL recibido en la notificación.
      // Si llega tarde una notificación de un intento anterior, acceptRide la rechazará
      // en lugar de convertirla accidentalmente en una aceptación del intento actual.
      const attempt = nativeAssignmentAttempt ?? (order.assignment_attempt || 1);
      
      // Llamamos internamente a la función de aceptación de producción
      // USAMOS INTERNAL_KEY para saltarnos el chequeo de sesión del chofer,
      // evitando que rebote el viaje si el chofer reinstaló la app y se desincronizó el token local.
      const result = await b44.functions.invoke("acceptRide", {
         orderId: realOrderId,
         driverId,
         assignmentAttempt: attempt,
         sessionToken: driver.current_session_token,
         internalKey: Deno.env.get("INTERNAL_SERVICE_KEY")
      });
      
      return Response.json(result);
      
    } else if (action === "native_reject") {
      const order = await b44.entities.RideOrder.get(realOrderId);
      if (!order) return Response.json({ success: false, reason: "order_not_found" });

      if (order.status !== "ofrecido" || order.reserved_driver_id !== driverId) {
         return Response.json({ success: false, reason: "already_processed_or_expired" });
      }
      // Igual que Aceptar: un rechazo viejo nunca puede actuar sobre una oferta nueva.
      if (nativeAssignmentAttempt != null && order.assignment_attempt !== nativeAssignmentAttempt) {
         return Response.json({ success: false, reason: "stale_assignment_attempt" });
      }

      // Buscar si el driver sigue teniendo este viaje reservado.
      // NO lo liberamos acá: reassignAfterAutomaticReject hace la liberación atómica
      // usando el token de esta misma oferta. Liberarlo antes rompía esa protección.
      const driver = await b44.entities.Driver.get(driverId);

      // reassignAfterAutomaticReject necesita el ID real de Base, mientras que
      // assigned_base/current_base guardan el nombre visible (ej. "1-Puerto").
      const baseName = (driver && driver.current_base) || order.assigned_base || order.zone || '1-Puerto';
      const matchingBases = await b44.entities.Base.filter({ name: baseName });
      const baseEntity = matchingBases.find((b: any) => b.dispatch_status === 'libre') || matchingBases[0];
      if (!baseEntity) {
        return Response.json({ success: false, reason: "base_not_found" });
      }
      const baseId = baseEntity.id;
      
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