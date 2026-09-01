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
    const offerOrders = await b44.entities.RideOrder.filter({ status: "ofrecido" });

    // 1.5 Buscar viajes asignados abandonados por más de 2 horas O cancelados/rechazados que tengan choferes colgados
    const abandonedOrders = await b44.entities.RideOrder.filter({
      status: { $in: ["aceptado", "en_camino", "en_viaje"] },
      updated_date: { $lt: twoHoursAgoStr }
    });

    const recentlyCancelledOrders = await b44.entities.RideOrder.filter({
      status: { $in: ["cancelado", "rechazado"] },
      updated_date: { $gte: twoHoursAgoStr } // solo recientes para no barrer el histórico entero
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
               active_order_id: null,
               active_ride_id: null
            }
         }).catch(()=>{ return { matchedCount: 0, updated: 0 }; });
         
         if (res && (res.matchedCount > 0 || res.updated > 0)) {
             count++;
         }
      }
    }

    // --- NUEVO BLOQUE A: Vencimiento estricto de ofertas ---
    for (const order of offerOrders) {
      if (!order.assigned_at) continue; // Si no tiene assigned_at, ignorar (legacy o procesado por autoReassignOnTimeout)
      
      const elapsedMs = Date.now() - new Date(order.assigned_at).getTime();
      if (elapsedMs < (tiempoMaximo * 1000)) continue; // Aún no venció desde la última reasignación real

      // Re-lectura estricta para evitar carreras
      const freshOrder = await b44.entities.RideOrder.get(order.id).catch(() => null);
      if (!freshOrder) continue;
      
      if (
        freshOrder.status !== "ofrecido" ||
        freshOrder.assignment_attempt !== order.assignment_attempt ||
        freshOrder.reserved_driver_id !== order.reserved_driver_id ||
        freshOrder.driver_id !== order.driver_id ||
        freshOrder.assigned_at !== order.assigned_at
      ) {
        continue;
      }

      // CAS Fuerte sobre RideOrder
      const casQuery: any = {
        id: freshOrder.id,
        status: "ofrecido",
        assignment_attempt: freshOrder.assignment_attempt,
        reserved_driver_id: freshOrder.reserved_driver_id,
        driver_id: freshOrder.driver_id,
        assigned_at: freshOrder.assigned_at
      };
      if (freshOrder.reservation_token) casQuery.reservation_token = freshOrder.reservation_token;

      try {
        const updateRes = await b44.entities.RideOrder.updateMany(casQuery, {
          $set: { 
             status: 'pendiente', 
             driver_id: null,
             driver_name: null,
             reserved_driver_id: null,
             assigned_base: null,
             reservation_token: null,
             manual_reservation_token: null,
             offerExpiresAt: null,
             processingAction: null,
             processingOperationKey: null,
             processingOwnerId: null,
             processingLeaseExpiresAt: null,
             processingPhase: null
          }
        });

        // SOLO si el CAS actualizó exactamente la oferta vigente se libera al chofer
        if (updateRes && updateRes.updated > 0) {
          const driverToFree = freshOrder.reserved_driver_id || freshOrder.driver_id;
          if (driverToFree) {
            try {
              await b44.entities.Driver.updateMany(
                { id: driverToFree, $or: [
                  { reserved_order_id: freshOrder.id },
                  { active_order_id: freshOrder.id },
                  { active_ride_id: freshOrder.id }
                ] },
                { $set: { 
                    status: "disponible", 
                    dispatch_status: "normal", 
                    reserved_order_id: null,
                    active_order_id: null,
                    active_ride_id: null,
                    reservation_token: null,
                    manual_reservation_token: null,
                    driver_reservation_key: null
                } }
              );
            } catch(e) {
              console.error("Error liberando driver", driverToFree, e);
            }
          }
          count++;
        }
      } catch(e) {
        console.error("Error CAS reseteando viaje", freshOrder.id, e);
      }
    }

    // --- BLOQUE B (Existente): Abandonos y Cancelados ---
    // Procesar los abandonados que quedaron en aceptado/en_camino/en_viaje por más de 2 horas
    // + los cancelados/rechazados recientes que pudieran haber dejado al chofer colgado.
    const allToReset = [...abandonedOrders, ...recentlyCancelledOrders];
    
    for (const order of allToReset) {
      if (order.status === 'completado') continue;
      
      const isCancelled = order.status === 'cancelado' || order.status === 'rechazado';
      
      if (order.driver_id || order.reserved_driver_id || (isCancelled && order.offered_driver_ids?.length > 0)) {
        // offered_driver_ids es historial, NO propiedad del viaje actual.
        // Un rechazo anterior no autoriza a liberar ese móvil: podría estar ya
        // reservado/ocupado con otro pasaje. Solo se liberan los vínculos actuales.
        const driversToFree = [...new Set([
          order.driver_id,
          order.reserved_driver_id
        ].filter(Boolean))];

        for (const dId of driversToFree) {
          try {
            // Si era un abandono > 2 horas (aceptado/en_viaje), además lo sacamos de servicio para que no estorbe
            const isAbandonment = ['aceptado', 'en_camino', 'en_viaje'].includes(order.status);
            const newDriverStatus = isAbandonment ? "no_disponible" : "disponible";
            
            // CAS: liberar únicamente si el móvil todavía apunta a ESTA orden.
            // Evita que el cron borre una reserva nueva creada por otro operador.
            await b44.entities.Driver.updateMany(
              { id: dId, $or: [
                { reserved_order_id: order.id },
                { active_order_id: order.id },
                { active_ride_id: order.id }
              ] },
              { $set: { 
                  status: newDriverStatus, 
                  dispatch_status: "normal", 
                  reserved_order_id: null,
                  active_order_id: null,
                  active_ride_id: null,
                  reservation_token: null,
                  manual_reservation_token: null,
                  driver_reservation_key: null,
                  ...(isAbandonment ? { current_base: null, queue_entered_at: null } : {})
              } }
            );
            count++;
          } catch(e) {
            console.error("Error liberando driver", dId, e);
          }
        }
        
        // Re-marcar la orden a pendiente y eliminar driver (solo si no estaba ya cancelada o rechazada)
        if (!isCancelled) {
          try {
            const query = { id: order.id };
            if (order.reservation_token) query.reservation_token = order.reservation_token;
            await b44.entities.RideOrder.updateMany(query, {
              $set: { 
                 status: 'pendiente', 
                 driver_id: null,
                 driver_name: null,
                 reserved_driver_id: null,
                 assigned_base: null,
                 reservation_token: null,
                 manual_reservation_token: null,
                 offerExpiresAt: null,
                 processingAction: null,
                 processingOperationKey: null,
                 processingOwnerId: null,
                 processingLeaseExpiresAt: null,
                 processingPhase: null
              }
            });
          } catch(e) {
            console.error("Error reseteando viaje atascado", order.id, e);
          }
        }
      }
    }

    if (count > 0 || ghostsDisconnected > 0) {
      console.log(`AutoReassignCron liberó: ${count} viajes/choferes trabados y ${ghostsDisconnected} choferes desconectados.`);
    }

    return Response.json({ 
      success: true, 
      resetCount: count,
      ghostsDisconnected
    });
  } catch (error) {
    console.error("Error en autoReassignCron:", error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});