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
    const allStuckOrders = await b44.entities.RideOrder.filter({ 
      status: "ofrecido",
      updated_date: { $lt: thresholdDate.toISOString() }
    });
    
    // Filtrar: los manuales ("operador") solo se limpian si pasaron > 2 horas. Los automáticos a los 60s.
    const stuckOrders = allStuckOrders.filter(o => {
       if (o.source === 'operador') {
          return new Date(o.updated_date || 0).getTime() < twoHoursAgoTime;
       }
       return true;
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