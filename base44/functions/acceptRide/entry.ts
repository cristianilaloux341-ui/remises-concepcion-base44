import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();
    const { orderId, driverId, assignmentAttempt, sessionToken } = payload;

    if (!orderId || !driverId || !sessionToken) {
      return Response.json({ accepted: false, reason: "missing_params" });
    }

    // Identificar de manera segura al chofer comparando tokens locales
    const drivers = await base44.asServiceRole.entities.Driver.filter({ id: driverId });
    const driver = drivers[0];
    if (!driver || driver.current_session_token !== sessionToken) {
       return Response.json({ accepted: false, reason: "unauthorized" });
    }

    // Leer la orden actual para verificar la idempotencia
    const orders = await base44.asServiceRole.entities.RideOrder.filter({ id: orderId });
    const currentOrder = orders[0];
    if (!currentOrder) {
       return Response.json({ accepted: false, reason: "not_found" });
    }

    // Idempotencia: el chofer ya lo había aceptado exitosamente
    if (currentOrder.status === "aceptado" && currentOrder.driver_id === driverId) {
      return Response.json({ accepted: true, idempotent: true });
    }

    // Actualización Transaccional Condicional
    const result = await base44.asServiceRole.entities.RideOrder.updateMany(
      {
        id: orderId,
        // Permite aceptar tanto una orden ofrecida como un broadcast masivo
        $or: [
          { status: "ofrecido", driver_id: driverId },
          { status: "pendiente", driver_id: null }
        ],
        $and: [
          {
            $or: [
              { assignment_attempt: assignmentAttempt },
              { assignment_attempt: null } // Fallback para órdenes antiguas, a eliminar cuando no queden nulls en prod
            ]
          }
        ]
      },
      {
        $set: {
          status: "aceptado",
          driver_id: driverId,
          driver_name: driver.name,
          assigned_base: driver.current_base,
          updated_date: new Date().toISOString()
        }
      }
    );

    if (result.updated === 1) {
      // Secundario: Actualizar el estado del chofer (falla no revierte la orden)
      try {
         await base44.asServiceRole.entities.Driver.update(driverId, { status: "en_viaje" });
      } catch (e) {
         console.error(`Failed to update driver ${driverId} status to en_viaje (Order remained accepted):`, e);
      }
      return Response.json({ accepted: true });
    } else {
      return Response.json({ accepted: false, reason: "already_taken_or_expired" });
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});