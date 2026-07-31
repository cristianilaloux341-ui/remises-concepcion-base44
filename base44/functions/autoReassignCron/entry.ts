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

    // 2. Limpieza de choferes fantasma (desconectados o sin señal por más de 10 mins)
    const tenMinsAgo = new Date(Date.now() - (10 * 60 * 1000)).toISOString();
    const ghostDrivers = await b44.entities.Driver.filter({
      status: "disponible",
      $or: [
        { last_active: { $lt: tenMinsAgo } },
        { last_active: null }
      ]
    });

    let ghostsDisconnected = 0;
    for (const driver of ghostDrivers) {
      // Si el móvil está agendado en una base, le damos 2 horas de gracia en vez de 10 min
      if (driver.current_base) {
        const twoHoursAgoTime = Date.now() - (120 * 60 * 1000);
        const driverLastActive = driver.last_active ? new Date(driver.last_active).getTime() : 0;
        if (driverLastActive > twoHoursAgoTime) {
          continue;
        }
      }

      // Verificar doblemente que no estén en medio de un viaje
      const activeRides = await b44.entities.RideOrder.filter({
        status: { $in: ["ofrecido", "aceptado", "en_camino", "en_viaje"] },
        $or: [{ driver_id: driver.id }, { reserved_driver_id: driver.id }]
      });
      
      if (activeRides.length === 0) {
        await b44.entities.Driver.updateMany(
          { id: driver.id },
          { $set: { status: "no_disponible", current_base: null, queue_entered_at: null } }
        );
        ghostsDisconnected++;
      }
    }

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

    return Response.json({ success: true, fixedCount: count, ghostsDisconnected });
  } catch(e) {
    return Response.json({ success: false, error: e.message }, { status: 500 });
  }
});