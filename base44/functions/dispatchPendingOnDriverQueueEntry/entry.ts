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

  if (expired || driverBusyElsewhere) {
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
        const rejectRes = await b44.functions.invoke('rejectRide', {
          orderId: legacyOrder.id,
          driverId,
          assignmentAttempt: Number(legacyOrder.assignment_attempt || 1),
          source: 'legacy_client',
          legacyQueueEnteredAt: eventData.queue_entered_at,
          internalKey: Deno.env.get('INTERNAL_SERVICE_KEY')
        }).catch((error:any) => ({ data:{ success:false, reason:error?.message || 'INVOKE_FAILED' } }));
        const rejectData = rejectRes?.data || rejectRes;

        if (rejectData?.success) {
          await b44.entities.AuditLog.create({
            action:'LEGACY_REJECT_SERVER_HANDLED',
            user_type:'sistema',
            user_name:eventData.name || oldData.name || 'Driver',
            details:`Rechazo de APK vieja procesado atómicamente por Central para ${legacyOrder.id}`,
            metadata:{ orderId:legacyOrder.id, driverId, assignmentAttempt:legacyOrder.assignment_attempt }
          }).catch(()=>{});
          return Response.json({ success:true, repaired:true, reason:'LEGACY_REJECT_SERVER_HANDLED' });
        }

        // Si otra operación ganó la carrera, no restaurar la reserva vieja. Releer
        // y dejar que la autoridad que ya posee el viaje termine la transición.
        const freshOrder = await b44.entities.RideOrder.get(legacyOrder.id).catch(() => null);
        await b44.entities.AuditLog.create({
          action:'LEGACY_REJECT_DEFERRED',
          user_type:'sistema',
          user_name:eventData.name || oldData.name || 'Driver',
          details:`Rechazo legacy no restaurado; Central detectó carrera controlada (${rejectData?.reason || 'sin detalle'})`,
          metadata:{ orderId:legacyOrder.id, driverId, reason:rejectData?.reason || null, freshStatus:freshOrder?.status || null, freshReservedDriverId:freshOrder?.reserved_driver_id || null }
        }).catch(()=>{});
        return Response.json({ success:true, skipped:true, reason:'LEGACY_REJECT_DEFERRED' });
      }

      // La oferta ya cambió de dueño/estado antes de que corriera el workflow.
      // Es exactamente el caso seguro: jamás restaurar la reserva anterior.
      return Response.json({ success:true, skipped:true, reason:'LEGACY_REJECT_ALREADY_ADVANCED' });
    }

    // Primero proteger la integridad Driver ↔ RideOrder. Este chequeo corre también
    // cuando queue_entered_at no cambió, porque una APK vieja puede borrar la reserva
    // desde un heartbeat GPS sin tocar la posición de cola.
    await guardOfferedReservationIntegrity(b44, driverId);

    // BLINDAJE DE COLA: una reconexión, una copia local atrasada o una APK vieja no
    // puede "reingresar" a un móvil que YA estaba libre en la misma base. Ese falso
    // reingreso solo cambia queue_entered_at y lo manda al final sin motivo.
    //
    // Los cambios intencionales de orden (drag de Central / cancelación ajena) marcan
    // queue_position en la MISMA escritura. Rechazo/timeout también quedan afuera de
    // esta condición porque cambian dispatch_status/reserva al liberar la oferta.
    const oldDispatch = oldData?.dispatch_status ?? 'normal';
    const newDispatch = eventData?.dispatch_status ?? 'normal';
    const duplicateSameBaseEntry = Boolean(
      eventData && oldData &&
      eventData.queue_entered_at !== oldData.queue_entered_at &&
      eventData.current_base &&
      eventData.current_base === oldData.current_base &&
      eventData.status === 'disponible' && oldData.status === 'disponible' &&
      newDispatch === 'normal' && oldDispatch === 'normal' &&
      !eventData.reserved_order_id && !oldData.reserved_order_id &&
      !eventData.active_order_id && !oldData.active_order_id &&
      !eventData.active_ride_id && !oldData.active_ride_id &&
      eventData.queue_position === oldData.queue_position
    );

    if (duplicateSameBaseEntry) {
      const marker = Date.now();
      const reverted = await b44.entities.Driver.updateMany(
        {
          id: driverId,
          current_base: eventData.current_base,
          status: 'disponible',
          dispatch_status: 'normal',
          reserved_order_id: null,
          active_order_id: null,
          active_ride_id: null,
          queue_entered_at: eventData.queue_entered_at
        },
        { $set: {
          queue_entered_at: oldData.queue_entered_at ?? null,
          // Marcador técnico para que el evento de restauración no se interprete
          // a sí mismo como otro reingreso y genere un bucle.
          queue_position: marker
        } }
      );
      const changed = reverted?.updated ?? reverted?.modifiedCount ?? reverted?.matchedCount ?? 0;
      if (changed === 1) {
        await b44.entities.AuditLog.create({
          action: 'QUEUE_DUPLICATE_ENTRY_REVERTED',
          user_type: 'sistema',
          user_name: eventData.name || oldData.name || 'Driver',
          details: `Se restauró la antigüedad de ${eventData.name || oldData.name || driverId} en ${eventData.current_base}`,
          metadata: {
            driverId,
            baseName: eventData.current_base,
            attemptedQueueEnteredAt: eventData.queue_entered_at ?? null,
            restoredQueueEnteredAt: oldData.queue_entered_at ?? null
          }
        }).catch(() => {});
        return Response.json({ success:true, repaired:true, reason:'DUPLICATE_SAME_BASE_ENTRY_REVERTED' });
      }
      // Si el CAS no matcheó, otra operación legítima ganó la carrera: no tocarla.
      return Response.json({ success:true, skipped:true, reason:'QUEUE_CHANGED_DURING_DUPLICATE_GUARD' });
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
