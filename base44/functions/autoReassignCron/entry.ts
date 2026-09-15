import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { findNextDriverInZone } from '../../shared/driverSelection.ts';

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

    // 1.5 Solo limpiar cancelados/rechazados recientes.
    // NUNCA considerar "abandonado" un aceptado/en_camino/en_viaje por antigüedad:
    // un viaje legítimo puede durar más de 2 horas y jamás debe volver a Pendientes.
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
      
      // Misma autoridad que acceptRide y la pantalla del chofer: offerExpiresAt.
      // Así el cron nunca vence una oferta antes de la ventana real asignada.
      const expiresAt = order.offerExpiresAt != null
        ? Number(order.offerExpiresAt)
        : (new Date(order.assigned_at).getTime() + (tiempoMaximo * 1000));
      if (!Number.isFinite(expiresAt) || Date.now() < expiresAt) continue;

      // Re-lectura estricta para evitar carreras
      const freshOrder = await b44.entities.RideOrder.get(order.id).catch(() => null);
      if (!freshOrder) continue;
      
      if (
        freshOrder.status !== "ofrecido" ||
        freshOrder.assignment_attempt !== order.assignment_attempt ||
        freshOrder.reserved_driver_id !== order.reserved_driver_id ||
        freshOrder.driver_id !== order.driver_id ||
        freshOrder.assigned_at !== order.assigned_at ||
        (freshOrder.processingOwnerId && Number(freshOrder.processingLeaseExpiresAt || 0) > Date.now())
      ) {
        continue;
      }

      // Red de seguridad: el cron NO tiene un motor de reasignación propio.
      // Una oferta vencida entra al mismo rechazo atómico que usa el botón RECHAZAR
      // y autoReassignOnTimeout. Así hay una sola autoridad para cola, cancelación,
      // misma zona y nueva ventana de respuesta.
      const driverToExpire = freshOrder.reserved_driver_id || freshOrder.driver_id;
      if (!driverToExpire) continue;
      try {
        const timeoutRes = await b44.functions.invoke('rejectRide', {
          orderId: freshOrder.id,
          driverId: driverToExpire,
          assignmentAttempt: freshOrder.assignment_attempt,
          source: 'timeout',
          internalKey: Deno.env.get('INTERNAL_SERVICE_KEY')
        });
        const timeoutData = timeoutRes?.data || timeoutRes;
        if (timeoutData?.success) {
          count++;
        } else if (timeoutData?.reason === 'STALE_OR_EXPIRED') {
          // Failsafe para oferta huérfana vencida: puede ocurrir que el Driver ya
          // haya perdido su reserved_order_id/token y haya vuelto a normal, mientras
          // el RideOrder todavía conserva la oferta. rejectRide, correctamente,
          // no puede liberar un Driver que ya no posee esa reserva; pero en ese caso
          // sí debemos cerrar la oferta huérfana de forma CAS y devolverla a pendiente.
          const orphanOrder = await b44.entities.RideOrder.get(freshOrder.id).catch(() => null);
          const orphanDriver = await b44.entities.Driver.get(driverToExpire).catch(() => null);
          const stillExpired = orphanOrder?.offerExpiresAt != null && Number(orphanOrder.offerExpiresAt) <= Date.now();
          const driverOwnsOffer = Boolean(
            orphanDriver &&
            orphanDriver.reserved_order_id === orphanOrder?.id &&
            orphanDriver.reservation_token === orphanOrder?.reservation_token &&
            orphanDriver.dispatch_status === 'automatic_pending'
          );

          if (
            orphanOrder &&
            orphanOrder.status === 'ofrecido' &&
            orphanOrder.reserved_driver_id === driverToExpire &&
            Number(orphanOrder.assignment_attempt) === Number(freshOrder.assignment_attempt) &&
            stillExpired &&
            !driverOwnsOffer &&
            !(orphanOrder.processingOwnerId && Number(orphanOrder.processingLeaseExpiresAt || 0) > Date.now())
          ) {
            const orphanRes = await b44.entities.RideOrder.updateMany(
              {
                id: orphanOrder.id,
                status: 'ofrecido',
                reserved_driver_id: driverToExpire,
                reservation_token: orphanOrder.reservation_token,
                assignment_attempt: orphanOrder.assignment_attempt,
                offerExpiresAt: orphanOrder.offerExpiresAt
              },
              {
                $set: {
                  status: 'pendiente',
                  driver_id: null,
                  driver_name: null,
                  reserved_driver_id: null,
                  reservation_token: null,
                  manual_reservation_token: null,
                  assigned_at: null,
                  offerExpiresAt: null,
                  assigned_base: null,
                  processingAction: null,
                  processingOperationKey: null,
                  processingOwnerId: null,
                  processingLeaseExpiresAt: null,
                  processingPhase: null
                }
              }
            ).catch(() => ({ matchedCount: 0, updated: 0 }));
            const repaired = (orphanRes?.matchedCount ?? orphanRes?.modifiedCount ?? orphanRes?.updated ?? 0) === 1;
            if (repaired) {
              count++;
              await b44.functions.invoke('sendPushNotification', {
                action: 'cancel_multiple',
                orderId: orphanOrder.id,
                driversToCancel: [driverToExpire],
                orderData: { assignmentAttempt: Number(orphanOrder.assignment_attempt) },
                internalKey: Deno.env.get('INTERNAL_SERVICE_KEY')
              }).catch(() => {});
              await b44.entities.AuditLog.create({
                action: 'ORPHAN_EXPIRED_OFFER_RECOVERED',
                user_type: 'sistema',
                user_name: 'autoReassignCron',
                details: `Oferta vencida huérfana ${orphanOrder.id} devuelta a pendiente`,
                metadata: { orderId: orphanOrder.id, driverId: driverToExpire, assignmentAttempt: orphanOrder.assignment_attempt }
              }).catch(() => {});
            }
          }
        }
      } catch(e) {
        console.error("Error procesando oferta vencida por motor único", freshOrder.id, e);
      }
    }

    // --- BLOQUE B: solo Cancelados/Rechazados ---
    // Los viajes aceptados o iniciados nunca se resetean automáticamente por antigüedad.
    const allToReset = [...recentlyCancelledOrders];
    
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
            const newDriverStatus = "disponible";
            
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
                  driver_reservation_key: null
              } }
            );
            count++;
          } catch(e) {
            console.error("Error liberando driver", dId, e);
          }
        }
        
        // Esta rama procesa únicamente cancelados/rechazados; nunca reabre el viaje como pendiente.
      }
    }

    // --- BLOQUE C: drenar Pendientes con capacidad real de la misma zona ---
    // Este barrido es deliberadamente server-side y usa el MISMO selector + assignRide
    // que el despacho normal. No depende de que un workflow nuevo de Driver se dispare.
    // Si un móvil entra/cambia de base y queda disponible, el próximo barrido lo toma.
    let pendingAssigned = 0;
    const pendingOrders = await b44.entities.RideOrder.filter({ status: 'pendiente' }).catch(() => []);
    const eligiblePendings = pendingOrders
      .filter((order: any) =>
        Boolean(order.zone) &&
        !String(order.notes || '').includes('[REVISION_CENTRAL_CANCELADO_CHOFER]') &&
        !['ACCEPT', 'START', 'FINISH'].includes(String(order.lastCompletedAction || ''))
      )
      .sort((a: any, b: any) => new Date(a.created_date || 0).getTime() - new Date(b.created_date || 0).getTime());

    for (const order of eligiblePendings.slice(0, 100)) {
      const excluded = new Set<string>();

      // Reintento corto solo por carreras legítimas: si el primer candidato fue
      // tomado por otro pasaje entre selección y CAS, buscamos el siguiente de
      // ESA MISMA zona. Nunca hay fallback global.
      for (let attempt = 0; attempt < 5; attempt++) {
        const nextDriver = await findNextDriverInZone(b44, order, excluded);
        if (!nextDriver) break;
        excluded.add(nextDriver.id);

        const assignRes = await b44.functions.invoke('assignRide', {
          orderId: order.id,
          driverId: nextDriver.id,
          requireDriverConfirmation: true,
          internalKey: Deno.env.get('INTERNAL_SERVICE_KEY')
        }).catch((e: any) => ({ data: { success: false, reason: e?.message || 'INVOKE_FAILED' } }));

        if (assignRes?.data?.success === true) {
          pendingAssigned++;
          await b44.entities.AuditLog.create({
            action: 'PENDING_AUTO_DISPATCH_SWEEP',
            user_type: 'sistema',
            user_name: 'autoReassignCron',
            details: `Pendiente ${order.id} despachado automáticamente en ${order.zone}`,
            metadata: { orderId: order.id, driverId: nextDriver.id, zone: order.zone }
          }).catch(() => {});
          break;
        }
      }
    }

    // Conservamos el reconciliador profundo cada 15 minutos desde ESTE cron.
    // El workflow que antes lo ejecutaba se reutiliza para detectar entrada real
    // de móviles en lista sin perder esta red de seguridad.
    await b44.functions.invoke('dispatchReconciler', {
      internalKey: Deno.env.get('INTERNAL_SERVICE_KEY')
    }).catch((e: any) => console.error('Deep reconciler backup error:', e));

    if (count > 0 || ghostsDisconnected > 0 || pendingAssigned > 0) {
      console.log(`AutoReassignCron liberó: ${count}; desconectados: ${ghostsDisconnected}; pendientes despachados: ${pendingAssigned}.`);
    }

    return Response.json({ 
      success: true, 
      resetCount: count,
      ghostsDisconnected,
      pendingAssigned
    });
  } catch (error) {
    console.error("Error en autoReassignCron:", error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});