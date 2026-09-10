import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { findNextDriverInZone } from '../../shared/driverSelection.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  
  try {
    const body = await req.json();
    const { orderData, sessionToken } = body;
    
    // Crear el viaje y resolver el primer candidato únicamente dentro de su zona.
    const order = await b44.entities.RideOrder.create({
      ...orderData,
      status: "procesando_despacho"
    });

    let assigned = false;
    if (order.zone) {
      const nextDriver = await findNextDriverInZone(b44, order, null);
      if (nextDriver) {
        const res = await b44.functions.invoke("assignRide", {
          orderId: order.id,
          driverId: nextDriver.id,
          sessionToken: sessionToken || "client_demo_token",
          internalKey: Deno.env.get("INTERNAL_SERVICE_KEY")
        });
        assigned = res?.data?.success === true;
      }
    }

    // Si no hay móvil disponible en esa zona, queda en Pendientes.
    if (!assigned) {
      await b44.entities.RideOrder.update(order.id, {
        status: "pendiente",
        driver_id: null,
        driver_name: null,
        reserved_driver_id: null,
        assigned_base: null,
        reservation_token: null,
        offerExpiresAt: null
      });
    }

    return Response.json({
      success: true,
      orderId: order.id,
      assigned,
      status: assigned ? "ofrecido" : "pendiente"
    });
  } catch(e) {
    console.error("Error en clientCreateAndDispatchRide", e);
    return Response.json({ success: false, error: e.message }, { status: 500 });
  }
});