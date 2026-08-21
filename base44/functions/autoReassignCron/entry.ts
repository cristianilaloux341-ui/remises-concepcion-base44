import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;

  try {
    const tarifaConfigs = await b44.entities.TarifaConfig.list();
    const tiempoMaximo = tarifaConfigs[0]?.tiempo_maximo_respuesta_segundos || 60;
    const thresholdDate = new Date(Date.now() - (tiempoMaximo * 1000));
    const twoHoursAgoTime = Date.now() - (120 * 60 * 1000);
    const twoHoursAgoStr = new Date(twoHoursAgoTime).toISOString();

    // 1. Buscar viajes automáticos trabados en "ofrecido"
    // Los viajes en estado "ofrecido" son asignaciones automáticas y deben vencer a los 60s, sin importar su origen.
    const stuckOrders = await b44.entities.RideOrder.filter({ 
      status: "ofrecido",
      updated_date: { $lt: thresholdDate.toISOString() }
    });

    // 1.5 Buscar viajes asignados (aceptado, en_camino, en_viaje) abandonados por más de 2 horas
    const abandonedOrders = await b44.entities.RideOrder.filter({
      status: { $in: ["aceptado", "en_camino", "en_viaje"] },
      updated_date: { $lt: twoHoursAgoStr }
    });

    // La falta de heartbeat no cambia el estado operativo del chofer.
    // Android puede suspender JavaScript durante horas aunque el servicio nativo siga activo.
    // Un móvil sale de servicio únicamente por una acción explícita del chofer.
    const ghostsDisconnected = 0;

    let count = 0;
    
    // Limpieza de red de seguridad: choferes colgados con reservas a viajes muertos atómicamente
    const allDrivers = await b44.entities.Driver.list();
    const stuckDrivers = allDrivers.filter(d => d.reserved_order_id || d.active_ride_id || d.dispatch_status === 'automatic_pending' || d.dispatch_status === 'manual_pending' || d.driver_reservation_key || d.reservation_token || d.manual_reservation_token);
    for (const driver of stuckDrivers) {
      const ghostOrderId = driver.reserved_order_id || driver.active_ride_id;
      let isDead = false;
      if (ghostOrderId) {
         try {
            const order = await b44.entities.RideOrder.get(ghostOrderId);
            if (!order || !["ofrecido", "aceptado", "en_camino", "en_viaje"].includes(order.status)) {
               isDead = true;
            }
         } catch(e) { isDead = true; } // Si no se encuentra
      } else {
         // Si solo tenia dispatch_status colgado o key, y no tiene viaje activo
         isDead = true;
      }

      if (isDead) {
         const newStatus = driver.status === "no_disponible" ? "no_disponible" : "disponible";
         const query = { id: driver.id };
         if (driver.reservation_token) query.reservation_token = driver.reservation_token;
         if (driver.manual_reservation_token) query.manual_reservation_token = driver.manual_reservation_token;
         if (driver.reserved_order_id) query.reserved_order_id = driver.reserved_order_id;
         if (driver.active_ride_id) query.active_ride_id = driver.active_ride_id;
         
         const res = await b44.entities.Driver.updateMany(query, {
            $set: {
               status: newStatus,
               dispatch_status: "normal", 
               reserved_order_id: null, 
               reservation_token: null,
               manual_reservation_token: null,
               driver_reservation_key: null,
               active_ride_id: null
            }
         }).catch(()=>{ return { matchedCount: 0, updated: 0 }; });
         
         if (res && (res.matchedCount > 0 || res.updated > 0)) {
             count++;
         }
      }
    }

    // Procesar todos los trabados (los que superaron el tiempo de auto-reasignación o las 2 horas manuales)
    // + los abandonados que quedaron en aceptado/en_camino/en_viaje por más de 2 horas.
    const allToReset = [...stuckOrders, ...abandonedOrders];
    
    for (const order of allToReset) {
      if (order.status === 'completado' || order.status === 'cancelado') continue;
      
      if (order.driver_id || order.reserved_driver_id) {
        const dId = order.driver_id || order.reserved_driver_id;
        try {
          // Si era un abandono > 2 horas (aceptado/en_viaje), además lo sacamos de servicio para que no estorbe
          const isAbandonment = ['aceptado', 'en_camino', 'en_viaje'].includes(order.status);
          const newDriverStatus = isAbandonment ? "no_disponible" : "disponible";
          
          await b44.entities.Driver.updateMany(
            { id: dId },
            { $set: { 
                status: newDriverStatus, 
                dispatch_status: "normal", 
                reserved_order_id: null, 
                reservation_token: null,
                ...(isAbandonment ? { current_base: null, queue_entered_at: null } : {})
            } }
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
            reservation_token: null,
            manual_reservation_token: null,
            processingPhase: null,
            processingOwnerId: null,
            processingOperationKey: null,
            lastCompletedOperationKey: null,
            pendingEffectKey: null,
            pendingEffectStatus: null
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