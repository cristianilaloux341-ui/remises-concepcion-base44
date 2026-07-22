import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();
    const { orderId, driverId, importeFinal, sessionToken } = payload;

    if (!orderId || !driverId || !sessionToken) {
      return Response.json({ success: false, reason: "missing_params" });
    }

    const b44 = base44.asServiceRole;

    // Verificar identidad y sesión
    const drivers = await b44.entities.Driver.filter({ id: driverId });
    const driver = drivers[0];
    if (!driver || driver.current_session_token !== sessionToken) {
       return Response.json({ success: false, reason: "unauthorized" });
    }

    // Leer orden para comprobación de idempotencia
    const orders = await b44.entities.RideOrder.filter({ id: orderId });
    const currentOrder = orders[0];
    if (!currentOrder) {
       return Response.json({ success: false, reason: "not_found" });
    }

    // Idempotencia: ¿Ya está completado por el mismo chofer?
    if (currentOrder.status === "completado" && currentOrder.driver_id === driverId) {
      return Response.json({ success: true, idempotent: true });
    }

    // Actualización Condicional: Solo lo actualiza si está "en_viaje" y pertenece al chofer
    const rideResult = await b44.entities.RideOrder.updateMany(
      {
        id: orderId,
        status: "en_viaje",
        driver_id: driverId
      },
      {
        $set: {
          status: "completado",
          importe_real_actual: importeFinal !== undefined ? importeFinal : currentOrder.importe_real_actual,
          updated_date: new Date().toISOString()
        }
      }
    );

    const matched = rideResult.matchedCount ?? rideResult.modifiedCount ?? 0;
    
    if (matched === 1) {
      // Éxito: Marcar al chofer como libre
      try {
         await b44.entities.Driver.updateMany(
           { id: driverId, status: "en_viaje" }, 
           { $set: { status: "disponible", queue_entered_at: new Date().toISOString() } }
         );
      } catch (e) {
         console.error(`Error al liberar chofer ${driverId}:`, e);
      }

      // Log de Auditoría
      await b44.entities.AuditLog.create({
        action: "FINISH_RIDE_COMMITTED",
        user_type: "chofer",
        user_name: driver.name || "Chofer",
        details: `Viaje ${orderId} finalizado condicionalmente por el chofer. Importe final: ${importeFinal}`,
        metadata: { orderId, driverId, importeFinal, matched }
      }).catch(() => {});

      return Response.json({ success: true, idempotent: false });
    } else {
      // El viaje no estaba en estado "en_viaje" para este chofer
      return Response.json({ success: false, reason: "race_condition_or_invalid_state" });
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});