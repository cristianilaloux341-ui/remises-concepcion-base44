import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { findNextDriverInZone } from '../../shared/driverSelection.ts';

const CENTRAL_REVIEW_MARKER = '[REVISION_CENTRAL_CANCELADO_CHOFER]';
const PROTECTED_ACTIONS = new Set(['ACCEPT', 'START', 'FINISH']);

// Defensa para APK instaladas que todavía contienen lógica vieja de limpieza local.
// Si un Driver pierde su reserva mientras el RideOrder sigue `ofrecido`, restauramos
// el vínculo desde la autoridad server-side. Si la oferta ya venció, la cerramos de
// forma CAS. Así nunca queda el estado partido Driver libre / RideOrder ofrecido.
async function guardOfferedReservationIntegrity(b44:any, driverId:string) {
  const driver = await b44.entities.Driver.get(driverId).catch(() => null);
  if (!driver) return { repaired:false, reason:'DRIVER_NOT_FOUND' };

  const offers = await b44.entities.RideOrder.filter({
    reserved_driver_id: driverId,
    status: 'ofrecido'
  }).catch(() => []);
  if (!offers.length) return { repaired:false, reason:'NO_ACTIVE_OFFER' };

  const exact = offers.find((o:any) =>
    driver.dispatch_status === 'automatic_pending' &&
    driver.reserved_order_id === o.id &&
    driver.reservation_token === o.reservation_token
  );
  if (exact) return { repaired:false, reason:'ALREADY_CONSISTENT' };

  const order = [...offers].sort((a:any,b:any) =>
    new Date(b.assigned_at || b.updated_date || 0).getTime() - new Date(a.assigned_at || a.updated_date || 0).getTime()
  )[0];
  const now = Date.now();
  const expiresAt = Number(order.offerExpiresAt);
  const expired = Number.isFinite(expiresAt) && expiresAt <= now;
  const driverBusyElsewhere =
    driver.status === 'en_viaje' ||
    Boolean(driver.active_order_id) ||
    Boolean(driver.active_ride_id) ||
    Boolean(driver.reserved_order_id && driver.reserved_order_id !== order.id);

  // Si la oferta venció y el móvil simplemente perdió su vínculo local (caso
  // compatible con v12.27), NO mandarla directo a Pendiente: eso salteaba el
  // motor único rejectRide y podía omitir al siguiente móvil válido de la zona.
  // Restauramos primero la reserva exacta por CAS y dejamos que rejectRide procese
  // el timeout, con su selección FIFO, nuevo attempt/token y exclusiones.
  if (expired && !driverBusyElsewhere) {
    const restoredForTimeout = await b44.entities.Driver.updateMany(
      {
        id: driverId,
        status: driver.status,
        dispatch_status: driver.dispatch_status,
        reserved_order_id: driver.reserved_order_id ?? null,
        active_order_id: driver.active_order_id ?? null,
        active_ride_id: driver.active_ride_id ?? null,
        reservation_token: driver.reservation_token ?? null
      },
      { $set: {
        status:'disponible',
        dispatch_status:'automatic_pending',
        reserved_order_id:order.id,
        reservation_token:order.reservation_token,
        active_order_id:null,
        active_ride_id:null,
        current_base:order.assigned_base || driver.current_base
      } }
    ).catch(() => ({ updated:0 }));
    const restoredCount = restoredForTimeout?.updated ?? restoredForTimeout?.matchedCount ?? restoredForTimeout?.modifiedCount ?? 0;
    if (restoredCount !== 1) return { repaired:false, reason:'CONCURRENT_CHANGE' };

    const timeoutRes = await b44.functions.invoke('rejectRide', {
      orderId:order.id,
      driverId,
      assignmentAttempt:Number(order.assignment_attempt || 1),
      source:'timeout',
      internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
    }).catch((error:any) => ({ data:{ success:false, reason:error?.message || 'INVOKE_FAILED' } }));
    const timeoutData = timeoutRes?.data || timeoutRes;
    await b44.entities.AuditLog.create({
      action:'ORPHAN_EXPIRED_OFFER_ROUTED_TO_REJECT_ENGINE',
      user_type:'sistema',
      user_name:'DriverStateGuard',
      details:`Oferta vencida ${order.id} enviada al motor único de timeout/reasignación`,
      metadata:{ orderId:order.id, driverId, assignmentAttempt:order.assignment_attempt, timeoutResult:timeoutData?.reason || null }
    }).catch(()=>{});
    return { repaired:true, action:'EXPIRED_OFFER_ROUTED_TO_REJECT_ENGINE', timeoutResult:timeoutData };
  }

  if (driverBusyElsewhere) {
    const closed = await b44.entities.RideOrder.updateMany(
      {
        id: order.id,
        status: 'ofrecido',
        reserved_driver_id: driverId,
        reservation_token: order.reservation_token,
        assignment_attempt: order.assignment_attempt,
        offerExpiresAt: order.offerExpiresAt
      },
      { $set: {
        status:'pendiente', driver_id:null, driver_name:null, reserved_driver_id:null,
        reservation_token:null, manual_reservation_token:null, assigned_at:null,
        offerExpiresAt:null, assigned_base:null, processingOwnerId:null,
        processingAction:null, processingOperationKey:null, processingLeaseExpiresAt:null,
        processingPhase:null
      } }
    ).catch(() => ({ updated:0 }));
    if ((closed.updated ?? closed.matchedCount ?? closed.modifiedCount ?? 0) === 1) {
      await b44.functions.invoke('sendPushNotification', {
        action:'cancel_multiple', orderId:order.id, driversToCancel:[driverId],
        orderData:{ assignmentAttempt:Number(order.assignment_attempt) },
        internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
      }).catch(() => {});
      await b44.entities.AuditLog.create({
        action:'ORPHAN_OFFER_CLOSED_BY_DRIVER_GUARD', user_type:'sistema', user_name:'DriverStateGuard',
        details:`Oferta ${order.id} cerrada al detectar vínculo roto con ${driverId}`,
        metadata:{ orderId:order.id, driverId, expired, driverBusyElsewhere }
      }).catch(() => {});
      return { repaired:true, action:'ORDER_TO_PENDING' };
    }
    return { repaired:false, reason:'CONCURRENT_CHANGE' };
  }

  // Oferta todavía vigente y móvil sin otro viaje: el RideOrder es la autoridad.
  // Restauramos exactamente su orderId/token. El filtro usa el snapshot fresco del
  // Driver, por lo que una asignación/aceptación concurrente hace fallar el CAS.
  const restored = await b44.entities.Driver.updateMany(
    {
      id: driverId,
      status: driver.status,
      dispatch_status: driver.dispatch_status,
      reserved_order_id: driver.reserved_order_id ?? null,
      active_order_id: driver.active_order_id ?? null,
      active_ride_id: driver.active_ride_id ?? null,
      reservation_token: driver.reservation_token ?? null
    },
    { $set: {
      status:'disponible',
      dispatch_status:'automatic_pending',
      reserved_order_id:order.id,
      active_order_id:null,
      active_ride_id:null,
      reservation_token:order.reservation_token,
      manual_reservation_token:null,
      current_base:order.assigned_base || driver.current_base
    } }
  ).catch(() => ({ updated:0 }));
  if ((restored.updated ?? restored.matchedCount ?? restored.modifiedCount ?? 0) === 1) {
    await b44.entities.AuditLog.create({
      action:'DRIVER_OFFER_LINK_RESTORED', user_type:'sistema', user_name:'DriverStateGuard',
      details:`Restaurado vínculo del móvil ${driverId} con oferta vigente ${order.id}`,
      metadata:{ orderId:order.id, driverId, assignmentAttempt:order.assignment_attempt }
    }).catch(() => {});
    return { repaired:true, action:'DRIVER_RESERVATION_RESTORED' };
  }
  return { repaired:false, reason:'CONCURRENT_CHANGE' };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;

  try {
    const body = await req.json().catch(() => ({}));
    const eventData = body?.data || null;
    const oldData = body?.old_data || null;
    const directDriverId = body?.driverId || null;

    // Esta función está pensada para el workflow de Driver. También acepta
    // driverId directo para poder verificarla de forma controlada sin duplicar lógica.
    if (body?.event && body.event.entity_name !== 'Driver') {
      return Response.json({ success: true, skipped: true, reason: 'NOT_DRIVER_EVENT' });
    }

    const driverId = eventData?.id || directDriverId;
    if (!driverId) {
      return Response.json({ success: true, skipped: true, reason: 'MISSING_DRIVER_ID' });
    }

    // CORTE DE CONSUMO: este workflow recibe también heartbeats/GPS de todos los
    // móviles. Si no cambió ningún campo operativo de cola/oferta, salir ANTES de
    // hacer Driver.get, consultas de RideOrder o reconciliaciones. Con ~50 móviles
    // evita que cada latido dispare trabajo de despacho innecesario.
    if (eventData && oldData) {
      const operationalFields = [
        'status', 'dispatch_status', 'current_base', 'queue_entered_at',
        'queue_position', 'queue_authoritative_base', 'queue_authoritative_at',
        'queue_authority_marker', 'reserved_order_id', 'reservation_token',
        'active_order_id', 'active_ride_id'
      ];
      const operationalChange = operationalFields.some((field) =>
        String(eventData?.[field] ?? '') !== String(oldData?.[field] ?? '')
      );
      if (!operationalChange) {
        return Response.json({ success:true, skipped:true, reason:'NON_OPERATIONAL_DRIVER_UPDATE' });
      }
    }

    // BLINDAJE ABSOLUTO DE POSICIÓN: un móvil LIBRE no puede salir solo de su base.
    // Cierres de app, reconexiones, heartbeats, refrescos o estados locales atrasados
    // pueden llegar a escribir current_base=null sin que el chofer haya perdido turno.
    // Esa transición NO es operativa y se revierte conservando exactamente base + antigüedad.
    // Las salidas legítimas no caen acá: cambio real de base es A->B; salir de servicio
    // cambia status a no_disponible; aceptar/finalizar/rechazar tienen sus propios estados.
    const technicalBaseDrop = Boolean(
      eventData && oldData &&
      oldData.status === 'disponible' &&
      eventData.status === 'disponible' &&
      oldData.current_base &&
      !eventData.current_base &&
      (oldData.dispatch_status == null || oldData.dispatch_status === 'normal') &&
      (eventData.dispatch_status == null || eventData.dispatch_status === 'normal') &&
      !oldData.reserved_order_id && !eventData.reserved_order_id &&
      !oldData.active_order_id && !eventData.active_order_id &&
      !oldData.active_ride_id && !eventData.active_ride_id &&
      oldData.queue_entered_at
    );

    if (technicalBaseDrop) {
      const restoreQuery:any = {
        id: driverId,
        status: 'disponible',
        current_base: eventData.current_base ?? null,
        dispatch_status: eventData.dispatch_status ?? 'normal',
        reserved_order_id: eventData.reserved_order_id ?? null,
        active_order_id: eventData.active_order_id ?? null,
        active_ride_id: eventData.active_ride_id ?? null
      };
      // Si la escritura técnica también tocó la antigüedad, exigimos ese mismo valor
      // en el CAS para no pisar una operación válida concurrente.
      if (eventData.queue_entered_at !== undefined) {
        restoreQuery.queue_entered_at = eventData.queue_entered_at ?? null;
      }

      const restored = await b44.entities.Driver.updateMany(
        restoreQuery,
        { $set: {
          current_base: oldData.current_base,
          queue_entered_at: oldData.queue_entered_at
        } }
      ).catch(() => ({ updated:0 }));
      const restoredCount = restored?.updated ?? restored?.modifiedCount ?? restored?.matchedCount ?? 0;
      if (restoredCount === 1) {
        await b44.entities.AuditLog.create({
          action:'QUEUE_TECHNICAL_BASE_DROP_REVERTED',
          user_type:'sistema',
          user_name:eventData.name || oldData.name || 'Driver',
          details:`Salida técnica de base revertida para ${eventData.name || oldData.name || driverId}; se preservó su posición`,
          metadata:{
            driverId,
            restoredBase:oldData.current_base,
            restoredQueueEnteredAt:oldData.queue_entered_at,
            attemptedBase:eventData.current_base ?? null,
            attemptedQueueEnteredAt:eventData.queue_entered_at ?? null
          }
        }).catch(()=>{});
        return Response.json({ success:true, repaired:true, reason:'TECHNICAL_BASE_DROP_REVERTED' });
      }
      return Response.json({ success:true, skipped:true, reason:'BASE_CHANGED_DURING_TECHNICAL_DROP_GUARD' });
    }

    // Compatibilidad v12.27/v12.29: esas APK todavía implementan RECHAZAR liberando
    // primero el Driver directamente y pidiendo la reasignación después. Ese cambio
    // NO es una limpieza fantasma: si lo restauramos desde el guard, Central y el
    // teléfono compiten por la misma oferta y pueden dejar driver_id/reserved_driver_id
    // cruzados. Reconocemos únicamente la transición exacta de rechazo viejo.
    const legacyDirectReject = Boolean(
      eventData && oldData &&
      oldData.status === 'disponible' &&
      oldData.dispatch_status === 'automatic_pending' &&
      oldData.reserved_order_id &&
      oldData.reservation_token &&
      eventData.status === 'disponible' &&
      (eventData.dispatch_status == null || eventData.dispatch_status === 'normal') &&
      !eventData.reserved_order_id &&
      !eventData.active_order_id &&
      !eventData.active_ride_id &&
      eventData.queue_entered_at &&
      eventData.queue_entered_at !== oldData.queue_entered_at
    );

    if (legacyDirectReject) {
      const legacyOrderId = oldData.reserved_order_id;
      const legacyOrder = await b44.entities.RideOrder.get(legacyOrderId).catch(() => null);
      const stillSameOffer = Boolean(
        legacyOrder &&
        legacyOrder.status === 'ofrecido' &&
        legacyOrder.reserved_driver_id === driverId &&
        legacyOrder.reservation_token === oldData.reservation_token
      );

      if (stillSameOffer) {
        const expiresAt = Number(legacyOrder.offerExpiresAt);
        const offerStillLive = !Number.isFinite(expiresAt) || Date.now() < expiresAt;

        if (offerStillLive) {
          // Una APK legacy puede liberar el Driver por lógica local vieja aunque el
          // chofer NO haya rechazado. Mientras la oferta siga vigente, esa escritura
          // jamás es autoridad para reasignar: restauramos exactamente la reserva.
          const restored = await b44.entities.Driver.updateMany(
            {
              id: driverId,
              status: 'disponible',
              $or: [
                { dispatch_status: 'normal' },
                { dispatch_status: null },
                { dispatch_status: { $exists:false } }
              ],
              reserved_order_id: null,
              active_order_id: null,
              active_ride_id: null
            },
            { $set: {
              dispatch_status: 'automatic_pending',
              reserved_order_id: legacyOrder.id,
              reservation_token: legacyOrder.reservation_token,
              current_base: legacyOrder.assigned_base || oldData.current_base || eventData.current_base || null,
              queue_entered_at: oldData.queue_entered_at || eventData.queue_entered_at || null
            } }
          ).catch(() => ({ updated:0 }));
          const restoredCount = restored?.updated ?? restored?.modifiedCount ?? restored?.matchedCount ?? 0;

          await b44.entities.AuditLog.create({
            action:'LEGACY_PREMATURE_RELEASE_RESTORED',
            user_type:'sistema',
            user_name:eventData.name || oldData.name || 'Driver',
            details:`Se bloqueó una liberación legacy antes de vencer la oferta ${legacyOrder.id}`,
            metadata:{
              orderId:legacyOrder.id,
              driverId,
              assignmentAttempt:legacyOrder.assignment_attempt,
              offerExpiresAt:legacyOrder.offerExpiresAt ?? null,
              remainingMs:Number.isFinite(expiresAt) ? Math.max(0, expiresAt - Date.now()) : null,
              restored:restoredCount === 1
            }
          }).catch(()=>{});

          return Response.json({
            success:true,
            repaired:restoredCount === 1,
            reason:'LEGACY_PREMATURE_RELEASE_RESTORED'
          });
        }

        // Si ya venció de verdad, primero restauramos la propiedad exacta y luego
        // dejamos que el motor server-side procese el timeout. Así la APK nunca
        // decide por sí sola cuándo saltar al siguiente móvil.
        await b44.entities.Driver.updateMany(
          { id:driverId, status:'disponible', reserved_order_id:null, active_order_id:null, active_ride_id:null },
          { $set:{
            dispatch_status:'automatic_pending',
            reserved_order_id:legacyOrder.id,
            reservation_token:legacyOrder.reservation_token,
            current_base:legacyOrder.assigned_base || oldData.current_base || eventData.current_base || null,
            queue_entered_at:oldData.queue_entered_at || eventData.queue_entered_at || null
          } }
        ).catch(()=>{});

        const timeoutRes = await b44.functions.invoke('rejectRide', {
          orderId: legacyOrder.id,
          driverId,
          assignmentAttempt: Number(legacyOrder.assignment_attempt || 1),
          source: 'timeout',
          internalKey: Deno.env.get('INTERNAL_SERVICE_KEY')
        }).catch((error:any) => ({ data:{ success:false, reason:error?.message || 'INVOKE_FAILED' } }));
        const timeoutData = timeoutRes?.data || timeoutRes;
        return Response.json({
          success:timeoutData?.success !== false,
          repaired:true,
          reason:'LEGACY_RELEASE_CONVERTED_TO_SERVER_TIMEOUT',
          timeoutResult:timeoutData
        });
      }

      // La oferta ya cambió de dueño/estado antes de que corriera el workflow.
      return Response.json({ success:true, skipped:true, reason:'LEGACY_RELEASE_ALREADY_ADVANCED' });
    }

    // AUTORIDAD SERVER-SIDE DE COLA.
    // queue_entered_at/current_base siguen existiendo por compatibilidad con APK viejas,
    // pero ya no son autoridad suficiente para cambiar una posición. La pareja
    // queue_authoritative_base + queue_authoritative_at conserva el orden real.
    const freshQueueDriver = await b44.entities.Driver.get(driverId).catch(() => null);
    if (freshQueueDriver) {
      const currentBase = freshQueueDriver.current_base || null;
      const authoritativeBase = freshQueueDriver.queue_authoritative_base || null;
      const currentAt = freshQueueDriver.queue_entered_at || null;
      const authoritativeAt = freshQueueDriver.queue_authoritative_at || null;
      const marker = freshQueueDriver.queue_position ?? null;
      const acceptedMarker = freshQueueDriver.queue_authority_marker ?? null;
      const explicitManualMove = marker != null && String(marker) !== String(acceptedMarker);
      const queueIdle =
        freshQueueDriver.status === 'disponible' &&
        (freshQueueDriver.dispatch_status == null || freshQueueDriver.dispatch_status === 'normal') &&
        !freshQueueDriver.reserved_order_id &&
        !freshQueueDriver.active_order_id &&
        !freshQueueDriver.active_ride_id;

      // Salir de servicio sí abandona la cola: borrar la autoridad para que al volver
      // a servicio tenga que elegir/entrar de nuevo a una base.
      if (freshQueueDriver.status === 'no_disponible' && (authoritativeBase || authoritativeAt)) {
        await b44.entities.Driver.updateMany(
          { id:driverId, status:'no_disponible' },
          { $set:{ queue_authoritative_base:null, queue_authoritative_at:null } }
        ).catch(()=>{});
        return Response.json({ success:true, repaired:true, reason:'QUEUE_AUTHORITY_CLEARED_OFF_SERVICE' });
      }

      if (queueIdle) {
        // Primera migración: congelar exactamente la posición que ya tiene, sin moverla.
        if (!authoritativeBase && currentBase) {
          const seedAt = currentAt || new Date().toISOString();
          await b44.entities.Driver.updateMany(
            { id:driverId, status:'disponible', current_base:currentBase },
            { $set:{
              queue_authoritative_base:currentBase,
              queue_authoritative_at:seedAt,
              queue_authority_marker:marker
            } }
          ).catch(()=>{});
          await b44.entities.AuditLog.create({
            action:'QUEUE_AUTHORITY_INITIALIZED', user_type:'sistema', user_name:freshQueueDriver.name || 'Driver',
            details:`Se congeló la posición actual de ${freshQueueDriver.name || driverId} sin modificar su orden`,
            metadata:{ driverId, baseName:currentBase, queueAt:seedAt }
          }).catch(()=>{});
          return Response.json({ success:true, repaired:true, reason:'QUEUE_AUTHORITY_INITIALIZED' });
        }

        // Cierre/reconexión/estado atrasado: un móvil libre no puede salir solo de
        // una base en la que conserva autoridad. Restaurar base y hora exactas.
        if (authoritativeBase && !currentBase) {
          const restored = await b44.entities.Driver.updateMany(
            { id:driverId, status:'disponible', current_base:null, reserved_order_id:null, active_order_id:null, active_ride_id:null },
            { $set:{ current_base:authoritativeBase, queue_entered_at:authoritativeAt } }
          ).catch(()=>({updated:0}));
          const count = restored?.updated ?? restored?.modifiedCount ?? restored?.matchedCount ?? 0;
          if (count === 1) {
            await b44.entities.AuditLog.create({
              action:'QUEUE_AUTHORITY_RESTORED_BASE', user_type:'sistema', user_name:freshQueueDriver.name || 'Driver',
              details:`Se restauró ${freshQueueDriver.name || driverId} a ${authoritativeBase} sin perder posición`,
              metadata:{ driverId, baseName:authoritativeBase, queueAt:authoritativeAt }
            }).catch(()=>{});
          }
          return Response.json({ success:true, repaired:count === 1, reason:'QUEUE_AUTHORITY_RESTORED_BASE' });
        }

        // Cambio A->B: las APK instaladas hacen el cambio voluntario escribiendo
        // current_base Y una nueva queue_entered_at en la misma acción. Esa pareja
        // es nuestra señal compatible de intención sin exigir campos nuevos al APK.
        // Un heartbeat/reconexión/cache que sólo haga oscilar current_base NO puede
        // mover al chofer ni renovar su posición: se revierte a la autoridad previa.
        if (authoritativeBase && currentBase && authoritativeBase !== currentBase) {
          const explicitDriverBaseEntry = Boolean(
            eventData && oldData &&
            oldData.current_base === authoritativeBase &&
            eventData.current_base === currentBase &&
            eventData.queue_entered_at &&
            eventData.queue_entered_at !== oldData.queue_entered_at
          );

          if (explicitDriverBaseEntry) {
            const newAuthoritativeAt = currentAt || eventData.queue_entered_at;
            await b44.entities.Driver.updateMany(
              { id:driverId, status:'disponible', current_base:currentBase, queue_entered_at:currentAt },
              { $set:{
                queue_authoritative_base:currentBase,
                queue_authoritative_at:newAuthoritativeAt
              } }
            ).catch(()=>{});
            await b44.entities.AuditLog.create({
              action:'QUEUE_AUTHORITY_BASE_CHANGED', user_type:'sistema', user_name:freshQueueDriver.name || 'Driver',
              details:`Entrada voluntaria de base aceptada para ${freshQueueDriver.name || driverId}: ${authoritativeBase} → ${currentBase}`,
              metadata:{ driverId, oldBase:authoritativeBase, newBase:currentBase, queueAt:newAuthoritativeAt }
            }).catch(()=>{});
          } else {
            const restored = await b44.entities.Driver.updateMany(
              { id:driverId, status:'disponible', current_base:currentBase, reserved_order_id:null, active_order_id:null, active_ride_id:null },
              { $set:{ current_base:authoritativeBase, queue_entered_at:authoritativeAt } }
            ).catch(()=>({updated:0}));
            const count = restored?.updated ?? restored?.modifiedCount ?? restored?.matchedCount ?? 0;
            if (count === 1) {
              await b44.entities.AuditLog.create({
                action:'QUEUE_GHOST_BASE_CHANGE_REVERTED', user_type:'sistema', user_name:freshQueueDriver.name || 'Driver',
                details:`Cambio técnico de base revertido para ${freshQueueDriver.name || driverId}; posición preservada`,
                metadata:{ driverId, attemptedBase:currentBase, restoredBase:authoritativeBase, restoredQueueAt:authoritativeAt }
              }).catch(()=>{});
            }
            return Response.json({ success:true, repaired:count === 1, reason:'GHOST_BASE_CHANGE_REVERTED' });
          }
        } else if (authoritativeBase && currentBase === authoritativeBase) {
          // Movimiento explícito del operador: queue_position cambia y queda como
          // marcador auditable. Adoptar la nueva hora como autoridad.
          if (explicitManualMove && currentAt) {
            await b44.entities.Driver.updateMany(
              { id:driverId, status:'disponible', current_base:currentBase, queue_position:marker },
              { $set:{ queue_authoritative_at:currentAt, queue_authority_marker:marker } }
            ).catch(()=>{});
            await b44.entities.AuditLog.create({
              action:'QUEUE_AUTHORITY_MANUAL_MOVE_ACCEPTED', user_type:'sistema', user_name:freshQueueDriver.name || 'Driver',
              details:`Movimiento manual de cola aceptado para ${freshQueueDriver.name || driverId}`,
              metadata:{ driverId, baseName:currentBase, queueAt:currentAt, marker }
            }).catch(()=>{});
            return Response.json({ success:true, repaired:true, reason:'QUEUE_AUTHORITY_MANUAL_MOVE_ACCEPTED' });
          }

          // Mismo móvil, misma base, sin acción de operador: la antigüedad NO cambia.
          if (authoritativeAt && currentAt !== authoritativeAt) {
            const restored = await b44.entities.Driver.updateMany(
              { id:driverId, status:'disponible', current_base:currentBase, queue_entered_at:currentAt },
              { $set:{ queue_entered_at:authoritativeAt } }
            ).catch(()=>({updated:0}));
            const count = restored?.updated ?? restored?.modifiedCount ?? restored?.matchedCount ?? 0;
            if (count === 1) {
              await b44.entities.AuditLog.create({
                action:'QUEUE_AUTHORITY_TIMESTAMP_RESTORED', user_type:'sistema', user_name:freshQueueDriver.name || 'Driver',
                details:`Se bloqueó un cambio no autorizado de posición de ${freshQueueDriver.name || driverId}`,
                metadata:{ driverId, baseName:currentBase, attemptedQueueAt:currentAt, restoredQueueAt:authoritativeAt }
              }).catch(()=>{});
            }
            return Response.json({ success:true, repaired:count === 1, reason:'QUEUE_AUTHORITY_TIMESTAMP_RESTORED' });
          }
        }
      }
    }

    // Primero proteger la integridad Driver ↔ RideOrder. Este chequeo corre también
    // cuando queue_entered_at no cambió, porque una APK vieja puede borrar la reserva
    // desde un heartbeat GPS sin tocar la posición de cola.
    await guardOfferedReservationIntegrity(b44, driverId);

    // BLINDAJE ESTRICTO DE COLA.
    // Una vez que un móvil está DISPONIBLE dentro de una base, su antigüedad es
    // INMUTABLE salvo tres casos explícitos:
    //   1) el operador lo reordena (queue_position cambia en la misma escritura),
    //   2) el móvil pierde/rechaza/vence una oferta (se libera una reserva real),
    //   3) el móvil sale/cambia/entra de base (cambia base o estado; no cae aquí).
    // Cualquier otra escritura de queue_entered_at en la MISMA base se revierte.
    const oldDispatch = oldData?.dispatch_status ?? 'normal';
    const newDispatch = eventData?.dispatch_status ?? 'normal';
    const queueTimestampChanged = Boolean(
      eventData && oldData &&
      eventData.queue_entered_at !== oldData.queue_entered_at
    );
    const sameBase = Boolean(
      eventData?.current_base &&
      eventData.current_base === oldData?.current_base
    );
    const explicitOperatorMove = Boolean(
      eventData && oldData &&
      eventData.queue_position !== oldData.queue_position
    );
    const lostOffer = Boolean(
      oldData?.reserved_order_id &&
      !eventData?.reserved_order_id &&
      oldDispatch !== 'normal' &&
      newDispatch === 'normal'
    );
    const unauthorizedSameBaseMove = Boolean(
      queueTimestampChanged &&
      sameBase &&
      oldData?.queue_entered_at &&
      oldData?.status === 'disponible' &&
      eventData?.status === 'disponible' &&
      !explicitOperatorMove &&
      !lostOffer
    );

    if (unauthorizedSameBaseMove) {
      const marker = Date.now();
      const reverted = await b44.entities.Driver.updateMany(
        {
          id: driverId,
          current_base: eventData.current_base,
          status: 'disponible',
          queue_entered_at: eventData.queue_entered_at
        },
        { $set: {
          queue_entered_at: oldData.queue_entered_at,
          // Marcador técnico anti-bucle. No representa posición; sólo identifica
          // que esta segunda escritura es la restauración hecha por el servidor.
          queue_position: marker
        } }
      );
      const changed = reverted?.updated ?? reverted?.modifiedCount ?? reverted?.matchedCount ?? 0;
      if (changed === 1) {
        await b44.entities.AuditLog.create({
          action: 'QUEUE_UNAUTHORIZED_MOVE_REVERTED',
          user_type: 'sistema',
          user_name: eventData.name || oldData.name || 'Driver',
          details: `Movimiento de cola no autorizado revertido para ${eventData.name || oldData.name || driverId}`,
          metadata: {
            driverId,
            baseName: eventData.current_base,
            attemptedQueueEnteredAt: eventData.queue_entered_at ?? null,
            restoredQueueEnteredAt: oldData.queue_entered_at ?? null,
            oldDispatchStatus: oldDispatch,
            newDispatchStatus: newDispatch,
            oldReservedOrderId: oldData.reserved_order_id ?? null,
            newReservedOrderId: eventData.reserved_order_id ?? null
          }
        }).catch(() => {});
        return Response.json({ success:true, repaired:true, reason:'UNAUTHORIZED_SAME_BASE_MOVE_REVERTED' });
      }
      // Si el CAS no matcheó, otra operación legítima ganó la carrera: no tocarla.
      return Response.json({ success:true, skipped:true, reason:'QUEUE_CHANGED_DURING_STRICT_GUARD' });
    }

    // La entrada REAL a la lista se identifica por queue_entered_at. El móvil puede
    // volver a entrar en la misma base que ya tenía guardada, por lo que mirar solo
    // current_base deja pasar exactamente ese caso sin disparar Pendientes.
    // Heartbeats y otros cambios no modifican queue_entered_at.
    if (eventData && oldData && eventData.queue_entered_at === oldData.queue_entered_at) {
      return Response.json({ success: true, skipped: true, reason: 'QUEUE_ENTRY_DID_NOT_CHANGE' });
    }

    // Trazabilidad de cola: registrar toda modificación REAL de antigüedad. Esto no
    // cambia posiciones; solo permite saber si vino de una entrada, rechazo, timeout
    // o una acción manual y detectar cualquier escritura inesperada en producción.
    if (eventData && oldData && eventData.queue_entered_at !== oldData.queue_entered_at) {
      await b44.entities.AuditLog.create({
        action: 'QUEUE_TIMESTAMP_CHANGED',
        user_type: 'sistema',
        user_name: eventData.name || oldData.name || 'Driver',
        details: `Cambió antigüedad de cola de ${eventData.name || oldData.name || driverId}`,
        metadata: {
          driverId,
          oldQueueEnteredAt: oldData.queue_entered_at ?? null,
          newQueueEnteredAt: eventData.queue_entered_at ?? null,
          oldBase: oldData.current_base ?? null,
          newBase: eventData.current_base ?? null,
          oldStatus: oldData.status ?? null,
          newStatus: eventData.status ?? null,
          oldDispatchStatus: oldData.dispatch_status ?? null,
          newDispatchStatus: eventData.dispatch_status ?? null
        }
      }).catch(() => {});
    }

    const triggerDriver = await b44.entities.Driver.get(driverId).catch(() => null);
    if (!triggerDriver) {
      return Response.json({ success: true, skipped: true, reason: 'DRIVER_NOT_FOUND' });
    }

    const zone = triggerDriver.current_base;
    const triggerIsAvailable =
      triggerDriver.status === 'disponible' &&
      Boolean(zone) &&
      (triggerDriver.dispatch_status == null || triggerDriver.dispatch_status === 'normal') &&
      !triggerDriver.active_order_id &&
      !triggerDriver.active_ride_id &&
      !triggerDriver.reserved_order_id;

    // Si el móvil ya recibió otro viaje entre que entró a la base y corrió el
    // workflow, no hay capacidad nueva que drenar y no tocamos nada.
    if (!triggerIsAvailable) {
      return Response.json({ success: true, skipped: true, reason: 'TRIGGER_DRIVER_NOT_AVAILABLE' });
    }

    // Una entrada de móvil habilita como máximo UNA nueva asignación. El candidato
    // real se vuelve a elegir por la cola oficial de la zona; no se fuerza al móvil
    // que disparó el evento. Así se conserva estrictamente el orden de lista.
    // Si otro trigger gana una carrera, reintentamos unas pocas veces sobre el
    // estado fresco sin duplicar el motor de reservas de assignRide.
    const failedByOrder = new Map<string, Set<string>>();
    const MAX_RACE_RETRIES = 8;

    for (let retry = 0; retry < MAX_RACE_RETRIES; retry++) {
      const pendings = await b44.entities.RideOrder.filter(
        { status: 'pendiente', zone },
        'created_date',
        12
      ).catch(() => []);

      const eligiblePendings = pendings.filter((order: any) => {
        const heldForReview = String(order.notes || '').includes(CENTRAL_REVIEW_MARKER);
        const lifecycleAlreadyAdvanced = PROTECTED_ACTIONS.has(String(order.lastCompletedAction || ''));
        return !heldForReview && !lifecycleAlreadyAdvanced;
      });

      if (eligiblePendings.length === 0) {
        return Response.json({ success: true, assigned: false, reason: 'NO_PENDING_IN_ZONE', zone });
      }

      // Prioridad FIFO: intentamos desde el pendiente más antiguo. Si ese pasaje
      // ya agotó candidatos válidos (por rechazos previos), probamos el siguiente
      // sin volver a ofrecerlo a un chofer que ya lo tuvo.
      let chosenOrder: any = null;
      let chosenDriver: any = null;

      for (const order of eligiblePendings) {
        const excluded = failedByOrder.get(order.id) || new Set<string>();
        const candidate = await findNextDriverInZone(b44, order, excluded);
        if (candidate) {
          chosenOrder = order;
          chosenDriver = candidate;
          break;
        }
      }

      if (!chosenOrder || !chosenDriver) {
        return Response.json({ success: true, assigned: false, reason: 'NO_ELIGIBLE_DRIVER_FOR_PENDING', zone });
      }

      const res = await b44.functions.invoke('assignRide', {
        orderId: chosenOrder.id,
        driverId: chosenDriver.id,
        requireDriverConfirmation: true,
        internalKey: Deno.env.get('INTERNAL_SERVICE_KEY')
      }).catch((error: any) => ({ data: { success: false, reason: error?.message || 'INVOKE_FAILED' } }));

      if (res?.data?.success === true) {
        await b44.entities.AuditLog.create({
          action: 'PENDING_AUTO_DISPATCH_ON_QUEUE_ENTRY',
          user_type: 'sistema',
          user_name: 'Pendientes',
          details: `Pendiente ${chosenOrder.id} asignado automáticamente al entrar capacidad en ${zone}`,
          metadata: {
            orderId: chosenOrder.id,
            driverId: chosenDriver.id,
            triggerDriverId: driverId,
            zone
          }
        }).catch(() => {});

        return Response.json({
          success: true,
          assigned: true,
          orderId: chosenOrder.id,
          driverId: chosenDriver.id,
          zone
        });
      }

      // Carrera legítima: otro despacho pudo tomar el viaje o el móvil entre la
      // selección y el CAS. No tocamos estados; solo evitamos repetir el mismo par.
      const excluded = failedByOrder.get(chosenOrder.id) || new Set<string>();
      excluded.add(chosenDriver.id);
      failedByOrder.set(chosenOrder.id, excluded);
    }

    return Response.json({ success: true, assigned: false, reason: 'RACE_RETRY_LIMIT', zone });
  } catch (error: any) {
    console.error('dispatchPendingOnDriverQueueEntry error:', error);
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});
