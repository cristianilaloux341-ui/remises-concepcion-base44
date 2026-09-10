import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { findNextDriverInZone } from '../../shared/driverSelection.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  
  try {
    const body = await req.json();
    const { orderData, sessionToken } = body;
    
    // 1. Crear el viaje en estado técnico de despacho. Así la Central no muestra
    // "pendiente" durante los milisegundos en que todavía estamos buscando candidato.
    const order = await b44.entities.RideOrder.create({
      ...orderData,
      status: "procesando_despacho"
    });

    // 2. Resolver el candidato en el servidor con la misma regla oficial:
    // misma zona, FIFO por queue_entered_at, móvil real habilitado.
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

    // Si no hay candidato válido, recién ahí pasa a Pendientes.
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