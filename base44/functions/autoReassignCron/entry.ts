import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;

  try {
    const tarifaConfigs = await b44.entities.TarifaConfig.list();
    const tiempoMaximo = tarifaConfigs[0]?.tiempo_maximo_respuesta_segundos || 60;
    const thresholdDate = new Date(Date.now() - (tiempoMaximo * 1000));

    // Buscar viajes trabados en "ofrecido" o "procesando_despacho"
    const stuckOrders = await b44.entities.RideOrder.filter({ 
      status: "ofrecido",
      updated_date: { $lt: thresholdDate.toISOString() }
    });

    let count = 0;
    for (const order of stuckOrders) {
      if (order.driver_id || order.reserved_driver_id) {
        const dId = order.driver_id || order.reserved_driver_id;
        try {
          await b44.entities.Driver.updateMany(
            { id: dId },
            { $set: { status: "disponible", dispatch_status: "normal", reserved_order_id: null, reservation_token: null } }
          );
        } catch(e) {}
      }

      await b44.entities.RideOrder.updateMany(
        { id: order.id },
        { 
          $set: { 
            status: "pendiente", 
            driver_id: null, 
            driver_name: null, 
            reserved_driver_id: null, 
            reservation_token: null 
          } 
        }
      );
      count++;
    }

    return Response.json({ success: true, fixedCount: count });
  } catch(e) {
    return Response.json({ success: false, error: e.message }, { status: 500 });
  }
});