import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { withQueueLock, compactQueueUnlocked } from '../../shared/queueOrder.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;

  try {
    const twoHoursAgoTime = Date.now() - (120 * 60 * 1000);
    const twoHoursAgoStr = new Date(twoHoursAgoTime).toISOString();

    // 1. Buscar viajes ofrecidos. El cron es sólo red de seguridad: nunca inventa
    // vencimientos ni decide por assigned_at; sólo actúa sobre ALERT_PRESENTED vencido.
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
    // Consultar únicamente móviles con señales de reserva/estado transitorio.
    // Evita barrer la flota completa cada 15 minutos durante horas pico.
    const stuckDriverGroups = await Promise.all([
      b44.entities.Driver.filter({ reserved_order_id: { $ne: null } }).catch(() => []),
      b44.entities.Driver.filter({ active_ride_id: { $ne: null } }).catch(() => []),
      b44.entities.Driver.filter({ active_ride_id: { $ne: null } }).catch(() => []),
      b44.entities.Driver.filter({ dispatch_status: 'automatic_pending' }).catch(() => []),
      b44.entities.Driver.filter({ driver_reservation_key: { $ne: null } }).catch(() => []),
      b44.entities.Driver.filter({ reservation_token: { $ne: null } }).catch(() => []),
    ]);
    const stuckDrivers = [...new Map(
      stuckDriverGroups.flat().filter(Boolean).map((d:any) => [d.id, d])
    ).values()];
    for (const driver of stuckDrivers) {
      // El segundo slot tiene su propio ciclo (confirmación/promoción/cancelación).
      // Este cron de limpieza jamás debe tocar el primer viaje de un móvil mientras
      // exista next_order_id: finishRide/checkAndRepairDriver son la autoridad allí.
      if (driver.next_order_id) continue;

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
         const query = { id: driver.id, next_order_id: driver.next_order_id ?? null, next_order_token: driver.next_order_token ?? null };
         if (driver.reservation_token) query.reservation_token = driver.reservation_token;
         if (driver.reserved_order_id) query.reserved_order_id = driver.reserved_order_id;
         if (driver.active_ride_id) query.active_ride_id = driver.active_ride_id;
         if (driver.active_ride_id) query.active_ride_id = driver.active_ride_id;
         
         const res = await b44.entities.Driver.updateMany(query, {
            $set: {
               status: newStatus,
               dispatch_status: "normal", 
               reserved_order_id: null, 
               reservation_token: null,
               driver_reservation_key: null,
               active_ride_id: null,
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
      // Barrera absoluta: sin PRESENTED del intento actual no existe timeout comercial.
      // La recuperación técnica (reintento único y avance sin penalizar) pertenece al
      // watchdog, no al cron.
      const presentedCurrentAttempt = Boolean(
        order.alert_presented_at &&
        Number(order.alert_presented_assignment_attempt) === Number(order.assignment_attempt)
      );
      if (!presentedCurrentAttempt) continue;
      const expiresAt = Number(order.offerExpiresAt);
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
        !freshOrder.alert_presented_at ||
        Number(freshOrder.alert_presented_assignment_attempt) !== Number(freshOrder.assignment_attempt) ||
        !Number.isFinite(Number(freshOrder.offerExpiresAt)) ||
        Number(freshOrder.offerExpiresAt) > Date.now() ||
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
            // Nunca convertir un huérfano ofrecido a Pendientes desde el cron.
            // Restauramos la propiedad exacta sólo si el Driver sigue libre y luego
            // delegamos en rejectRide, que recorre la cola completa y es la única
            // autoridad para decidir que no quedan candidatos.
            if (!orphanDriver) throw new Error('ORPHAN_DRIVER_NOT_FOUND');
            const driverBusyElsewhere =
              orphanDriver.status === 'en_viaje' ||
              Boolean(orphanDriver.active_ride_id) ||
              Boolean(orphanDriver.active_ride_id) ||
              Boolean(orphanDriver.next_order_id) ||
              Boolean(orphanDriver.reserved_order_id && orphanDriver.reserved_order_id !== orphanOrder.id);
            if (driverBusyElsewhere) throw new Error('ORPHAN_DRIVER_BUSY');

            const restoredDriver = await b44.entities.Driver.updateMany(
              {
                id: driverToExpire,
                status: orphanDriver.status,
                dispatch_status: orphanDriver.dispatch_status,
                reserved_order_id: orphanDriver.reserved_order_id ?? null,
                active_ride_id: orphanDriver.active_ride_id ?? null,
                active_ride_id: orphanDriver.active_ride_id ?? null,
                next_order_id: orphanDriver.next_order_id ?? null,
                next_order_token: orphanDriver.next_order_token ?? null,
                reservation_token: orphanDriver.reservation_token ?? null
              },
              { $set: {
                status:'disponible',
                dispatch_status:'automatic_pending',
                reserved_order_id:orphanOrder.id,
                reservation_token:orphanOrder.reservation_token,
                active_ride_id:null,
                active_ride_id:null
              } }
            );
            const restoredCount = restoredDriver?.updated ?? restoredDriver?.modifiedCount ?? restoredDriver?.matchedCount ?? 0;
            if (restoredCount !== 1) throw new Error('ORPHAN_RESTORE_CONCURRENT_CHANGE');

            const routed = await b44.functions.invoke('rejectRide', {
              orderId: orphanOrder.id,
              driverId: driverToExpire,
              assignmentAttempt: Number(orphanOrder.assignment_attempt),
              source: 'timeout',
              internalKey: Deno.env.get('INTERNAL_SERVICE_KEY')
            });
            const routedData = routed?.data || routed;
            if (routedData?.success !== true) throw new Error(routedData?.error || 'ORPHAN_REJECT_ENGINE_FAILED');
            count++;
            await b44.entities.AuditLog.create({
              action: 'ORPHAN_EXPIRED_OFFER_ROUTED',
              user_type: 'sistema',
              user_name: 'autoReassignCron',
              details: `Oferta vencida huérfana ${orphanOrder.id} restaurada y enviada al motor autoritativo`,
              metadata: { orderId: orphanOrder.id, driverId: driverToExpire, assignmentAttempt: orphanOrder.assignment_attempt }
            }).catch(() => {});
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
            const currentDriver = await b44.entities.Driver.get(dId).catch(() => null);
            if (!currentDriver) continue;
            const set:any = {
              
              queue_authoritative_base:null,
              queue_position:null,
              queue_authority_marker:null
            };
            const query:any = { id:dId };
            let ownsCurrent = false;

            if (currentDriver.reserved_order_id === order.id) {
              query.reserved_order_id = order.id;
              set.reserved_order_id = null;
              set.reservation_token = null;
              
              set.driver_reservation_key = null;
              ownsCurrent = true;
            }
            if (currentDriver.active_ride_id === order.id) {
              query.active_ride_id = order.id;
              set.active_ride_id = null;
              ownsCurrent = true;
            }
            if (currentDriver.active_ride_id === order.id) {
              query.active_ride_id = order.id;
              set.active_ride_id = null;
              ownsCurrent = true;
            }
            if (!ownsCurrent) continue;

            // Un segundo slot distinto nunca se borra ni convierte al móvil en libre.
            if (!currentDriver.next_order_id) {
              set.status = currentDriver.status === 'no_disponible' ? 'no_disponible' : 'disponible';
              set.dispatch_status = 'normal';
            }

            // Si este vínculo viejo todavía figura dentro de una cola, la salida y
            // compactación deben ocurrir bajo el mismo lock de esa base. El cron
            // jamás lo reingresa: sólo evita dejar huecos o carreras de posición.
            const oldBase = currentDriver.queue_authoritative_base || null;
            const releaseAndCompact = async () => {
              const released = await b44.entities.Driver.updateMany(query, { $set:set });
              const releasedCount = released?.updated ?? released?.modifiedCount ?? released?.matchedCount ?? 0;
              if (releasedCount === 1 && oldBase) await compactQueueUnlocked(b44, oldBase);
              return releasedCount;
            };
            const releasedCount = oldBase
              ? await withQueueLock(b44, oldBase, releaseAndCompact)
              : await releaseAndCompact();
            if (releasedCount === 1) count++;
          } catch(e) {
            console.error("Error liberando driver", dId, e);
          }
        }
        
        // Esta rama procesa únicamente cancelados/rechazados; nunca reabre el viaje como pendiente.
      }
    }


    // El cron NO drena Pendientes y NO invoca reconciliadores de despacho.
    // PENDING_AUTHORIZED es un estado público final del ciclo actual; sólo una acción
    // explícita del motor (p. ej. entrada real de un móvil a la base) puede iniciar
    // un nuevo intento. Así evitamos un segundo despachador paralelo.
    const pendingAssigned = 0;

    if (count > 0 || ghostsDisconnected > 0) {
      console.log(`AutoReassignCron recuperó: ${count}; desconectados: ${ghostsDisconnected}.`);
    }

    return Response.json({
      success:true,
      resetCount:count,
      ghostsDisconnected,
      pendingAssigned:0,
      dispatchReconcilerInvoked:false
    });
  } catch (error) {
    console.error("Error en autoReassignCron:", error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});