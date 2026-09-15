import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { findNextDriverInZone } from '../../shared/driverSelection.ts';
import { getNextQueueTailAt, getNextQueuePosition, compactQueue, compactQueueUnlocked, withQueueLock } from '../../shared/queueOrder.ts';
import { verifyReorderToken } from '../../shared/reorderToken.ts';

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

  const placeDriverLastLocked = async (
    baseName:string,
    targetDriverId:string,
    filter:any,
    extraSet:any = {}
  ) => withQueueLock(b44, baseName, async () => {
    const queueAt = await getNextQueueTailAt(b44, baseName, targetDriverId);
    const nextPos = await getNextQueuePosition(b44, baseName, targetDriverId);
    const result = await b44.entities.Driver.updateMany(
      filter,
      { $set:{
        ...extraSet,
        queue_entered_at:queueAt,
        queue_authoritative_base:baseName,
        queue_authoritative_at:queueAt,
        queue_position:nextPos,
        queue_left_at:null
      } }
    ).catch(()=>({updated:0}));
    const count = result?.updated ?? result?.modifiedCount ?? result?.matchedCount ?? 0;
    if (count === 1) await compactQueueUnlocked(b44, baseName);
    return { result, count, queueAt, nextPos };
  });

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

    // REGLA OPERATIVA ABSOLUTA DE SALIDA/ENTRADA DE BASE:
    // current_base=null significa que el móvil abandonó la cola EN ESE INSTANTE.
    // No existe gracia ni conservación de antigüedad. Si luego entra a cualquier base
    // —la misma, otra o al volver de fuera de servicio— el servidor le asigna una
    // nueva autoridad detrás del último móvil existente.

    // Marca una entrada NUEVA que ya fue normalizada con hora autoritativa del servidor.
    // Debe seguir hasta el drenaje de Pendientes; una entrada real crea capacidad.
    let normalizedExplicitQueueEntry = false;

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
      (oldData.queue_authoritative_at || oldData.queue_entered_at)
    );

    if (technicalBaseDrop) {
      const previousBase = oldData.queue_authoritative_base || oldData.current_base;
      const previousAt = oldData.queue_authoritative_at || oldData.queue_entered_at || null;
      const cleared = await b44.entities.Driver.updateMany(
        {
          id:driverId,
          status:'disponible',
          current_base:null,
          reserved_order_id:null,
          active_order_id:null,
          active_ride_id:null
        },
        { $set:{
          queue_entered_at:null,
          queue_authoritative_base:null,
          queue_authoritative_at:null,
          queue_authority_marker:null,
          queue_position:null,
          queue_left_at:null
        } }
      ).catch(()=>({updated:0}));
      const clearedCount = cleared?.updated ?? cleared?.modifiedCount ?? cleared?.matchedCount ?? 0;

      if (clearedCount === 1) {
        if (previousBase) compactQueue(b44, previousBase).catch(()=>null);
        await b44.entities.AuditLog.create({
          action:'QUEUE_POSITION_CLEARED_ON_BASE_EXIT',
          user_type:'sistema',
          user_name:eventData.name || oldData.name || 'Driver',
          details:`${eventData.name || oldData.name || driverId} salió de ${previousBase}; perdió la posición inmediatamente`,
          metadata:{ driverId, previousBase, previousQueueAt:previousAt }
        }).catch(()=>{});
      }

      return Response.json({ success:true, repaired:clearedCount === 1, reason:'QUEUE_POSITION_CLEARED_ON_BASE_EXIT' });
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

      // La oferta ya cambió de dueño/estado antes de que corriera este evento legacy.
      // NO borrar la reinserción que rejectRide pudo haber hecho server-side. La regla
      // actual es rechazo/timeout = último de la misma base. Si todavía no existe una
      // reinserción autoritativa, la completamos acá con cola fresca del servidor.
      const releasedDriver = await b44.entities.Driver.get(driverId).catch(()=>null);
      const queueBase = legacyOrder?.assigned_base || legacyOrder?.zone || oldData.current_base || eventData.current_base || null;
      const previousAuthorityAt = oldData.queue_authoritative_at || oldData.queue_entered_at || null;
      const alreadyQueuedAtTailAuthority = Boolean(
        releasedDriver && queueBase &&
        releasedDriver.status === 'disponible' &&
        (releasedDriver.dispatch_status == null || releasedDriver.dispatch_status === 'normal') &&
        !releasedDriver.reserved_order_id && !releasedDriver.active_order_id && !releasedDriver.active_ride_id &&
        releasedDriver.current_base === queueBase &&
        releasedDriver.queue_authoritative_base === queueBase &&
        releasedDriver.queue_authoritative_at &&
        (!previousAuthorityAt || String(releasedDriver.queue_authoritative_at) !== String(previousAuthorityAt))
      );

      let reconciled = alreadyQueuedAtTailAuthority;
      let queueAt = releasedDriver?.queue_authoritative_at || null;
      if (!reconciled && releasedDriver && queueBase &&
          releasedDriver.status === 'disponible' &&
          (releasedDriver.dispatch_status == null || releasedDriver.dispatch_status === 'normal') &&
          !releasedDriver.reserved_order_id && !releasedDriver.active_order_id && !releasedDriver.active_ride_id &&
          (!releasedDriver.current_base || releasedDriver.current_base === queueBase)) {
        const placed = await placeDriverLastLocked(
          queueBase,
          driverId,
          {
            id:driverId,
            status:'disponible',
            $or:[{ current_base:null }, { current_base:queueBase }],
            reserved_order_id:null,
            active_order_id:null,
            active_ride_id:null
          },
          { current_base:queueBase, queue_authority_marker:null }
        );
        queueAt = placed.queueAt;
        reconciled = placed.count === 1;
      }

      await b44.entities.AuditLog.create({
        action:'LEGACY_RELEASE_RECONCILED_TO_QUEUE_TAIL',
        user_type:'sistema',
        user_name:eventData.name || oldData.name || 'Driver',
        details:`Cierre legacy conciliado sin borrar la cola server-side de ${driverId}`,
        metadata:{
          driverId,
          orderId:legacyOrderId,
          baseName:queueBase,
          queueAt,
          preservedExistingServerRequeue:alreadyQueuedAtTailAuthority,
          reconciled
        }
      }).catch(()=>{});

      return Response.json({ success:true, repaired:reconciled, reason:'LEGACY_RELEASE_RECONCILED_TO_QUEUE_TAIL' });
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

      // Salir de servicio explícitamente sí abandona la cola. Pero NO alcanza con ver
      // status=no_disponible: una APK/reconexión puede publicar ese estado transitorio
      // mientras todavía conserva base + antigüedad. Si borramos autoridad en ese caso,
      // al siguiente disponible se reinicializa con una hora nueva y el móvil salta solo
      // hacia atrás en la cola. Exigimos además la proyección legacy vacía, que es la
      // señal compatible de una salida real de servicio en las APK instaladas.
      const explicitOffServiceExit = Boolean(
        freshQueueDriver.status === 'no_disponible' &&
        !freshQueueDriver.current_base &&
        !freshQueueDriver.queue_entered_at
      );
      if (explicitOffServiceExit && (authoritativeBase || authoritativeAt)) {
        await b44.entities.Driver.updateMany(
          { id:driverId, status:'no_disponible', current_base:null, queue_entered_at:null },
          { $set:{ queue_authoritative_base:null, queue_authoritative_at:null, queue_left_at:null } }
        ).catch(()=>{});
        if (authoritativeBase) compactQueue(b44, authoritativeBase).catch(()=>null);
        return Response.json({ success:true, repaired:true, reason:'QUEUE_AUTHORITY_CLEARED_EXPLICIT_OFF_SERVICE' });
      }

      if (freshQueueDriver && oldData && eventData) {
        const hadValidAuthority = Boolean(
          oldData.status === 'disponible' && oldData.current_base &&
          oldData.queue_authoritative_base && oldData.queue_authoritative_at
        );
        const writeKeepsIdleInSameBase = Boolean(
          eventData.status === 'disponible' && eventData.current_base &&
          eventData.current_base === oldData.current_base &&
          (eventData.dispatch_status == null || eventData.dispatch_status === 'normal') &&
          !eventData.reserved_order_id && !eventData.active_order_id && !eventData.active_ride_id
        );
        const commercialAction = Boolean(
          oldData.reserved_order_id || eventData.reserved_order_id ||
          (oldData.dispatch_status && oldData.dispatch_status !== 'normal') ||
          (eventData.dispatch_status && eventData.dispatch_status !== 'normal') ||
          oldData.current_base !== eventData.current_base ||
          oldData.status !== eventData.status
        );

        const attemptedAt = (eventData.queue_authoritative_at || eventData.queue_entered_at) ?? null;
        const manualAuthorized = await verifyReorderToken(
          eventData.manual_reorder_token ?? null,
          driverId, eventData.current_base ?? null, attemptedAt
        );

        if (hadValidAuthority && writeKeepsIdleInSameBase && !commercialAction) {
          if (manualAuthorized) {
            return Response.json({ success:true, reason:'MANUAL_REORDER_AUTHORIZED' });
          }

          const restoreRes = await b44.entities.Driver.updateMany(
            {
              id: driverId,
              status: 'disponible',
              current_base: oldData.current_base,
              $or: [
                { queue_authoritative_base: null }, { queue_authoritative_base: { $exists:false } },
                { queue_authoritative_at: null }, { queue_authoritative_at: { $exists:false } },
                { queue_authoritative_at: { $ne: oldData.queue_authoritative_at } },
                { queue_entered_at: { $ne: oldData.queue_authoritative_at } },
                { manual_reorder_token: { $ne: oldData.manual_reorder_token ?? null } }
              ]
            },
            { $set: {
              current_base: oldData.current_base,
              queue_entered_at: oldData.queue_authoritative_at,
              queue_authoritative_base: oldData.queue_authoritative_base,
              queue_authoritative_at: oldData.queue_authoritative_at,
              queue_authority_marker: oldData.queue_authority_marker ?? null,
              queue_position: oldData.queue_position ?? null,
              manual_reorder_token: oldData.manual_reorder_token ?? null,
              manual_reorder_at: oldData.manual_reorder_at ?? null
            } }
          ).catch(()=>({updated:0}));
          const restoredCount = restoreRes?.updated ?? restoreRes?.modifiedCount ?? restoreRes?.matchedCount ?? 0;
          
          if (restoredCount === 1) {
            await b44.entities.AuditLog.create({
              action: 'QUEUE_AUTHORITY_IMMUTABLE_RESTORED',
              user_type: 'sistema',
              user_name: freshQueueDriver.name || oldData.name || 'Driver',
              details: `Se preservó la antigüedad de ${freshQueueDriver.name || driverId} en ${oldData.current_base} frente a una escritura técnica`,
              metadata: {
                driverId, baseName: oldData.current_base,
                preservedAuthoritativeAt: oldData.queue_authoritative_at,
                attemptedAuthoritativeBase: freshQueueDriver.queue_authoritative_base ?? null,
                attemptedAuthoritativeAt: freshQueueDriver.queue_authoritative_at ?? null,
                attemptedQueueEnteredAt: freshQueueDriver.queue_entered_at ?? null,
                attemptedQueuePosition: freshQueueDriver.queue_position ?? null,
                oldDispatchStatus: oldData.dispatch_status ?? null,
                newDispatchStatus: eventData.dispatch_status ?? null,
                oldReservedOrderId: oldData.reserved_order_id ?? null,
                newReservedOrderId: eventData.reserved_order_id ?? null,
                hadManualReorderToken: Boolean(eventData.manual_reorder_token),
                origin: eventData.device_id ? 'apk' : (eventData.fcm_token ? 'mobile' : 'unknown')
              }
            }).catch(()=>{});
          }
          return Response.json({ success:true, repaired: restoredCount===1, reason:'QUEUE_AUTHORITY_IMMUTABLE_RESTORED' });
        }
      }

      if (queueIdle) {
        // Entrar en servicio también es una entrada NUEVA aunque la APK conserve
        // current_base/queue_entered_at viejos en caché. Nunca se hereda antigüedad.
        const enteredService = Boolean(
          currentBase && oldData && eventData &&
          oldData.status !== 'disponible' && eventData.status === 'disponible'
        );
        if (enteredService) {
          const serviceEntryAt = await getNextQueueTailAt(b44, currentBase, driverId);
          const nextPos = await getNextQueuePosition(b44, currentBase, driverId);
          const serviceEntry = await b44.entities.Driver.updateMany(
            { id:driverId, status:'disponible', current_base:currentBase },
            { $set:{
              queue_entered_at:serviceEntryAt,
              queue_authoritative_base:currentBase,
              queue_authoritative_at:serviceEntryAt,
              queue_authority_marker:null,
              queue_position:nextPos,
              queue_left_at:null
            } }
          ).catch(()=>({updated:0}));
          const serviceEntryCount = serviceEntry?.updated ?? serviceEntry?.modifiedCount ?? serviceEntry?.matchedCount ?? 0;
          if (serviceEntryCount !== 1) {
            return Response.json({ success:true, repaired:false, reason:'QUEUE_SERVICE_ENTRY_CHANGED_CONCURRENTLY' });
          }
          await b44.entities.AuditLog.create({
            action:'QUEUE_SERVICE_ENTRY_AT_TAIL', user_type:'sistema', user_name:freshQueueDriver.name || 'Driver',
            details:`${freshQueueDriver.name || driverId} entró en servicio y quedó último en ${currentBase}`,
            metadata:{ driverId, baseName:currentBase, queueAt:serviceEntryAt }
          }).catch(()=>{});
          normalizedExplicitQueueEntry = true;
        }

        // Reingreso desde "sin base": SIEMPRE es una entrada nueva.
        // No existe gracia: al tocar cualquier base, incluso la misma, queda detrás del último.
        const returnedFromNoBase = Boolean(
          !normalizedExplicitQueueEntry && currentBase && oldData && !oldData.current_base
        );
        if (returnedFromNoBase) {
          const newEntryAt = await getNextQueueTailAt(b44, currentBase, driverId);
          const nextPos = await getNextQueuePosition(b44, currentBase, driverId);
          const reset = await b44.entities.Driver.updateMany(
            { id:driverId, status:'disponible', current_base:currentBase },
            { $set:{
              queue_entered_at:newEntryAt,
              queue_authoritative_base:currentBase,
              queue_authoritative_at:newEntryAt,
              queue_authority_marker:null,
              queue_position:nextPos,
              queue_left_at:null
            } }
          ).catch(()=>({updated:0}));
          const resetCount = reset?.updated ?? reset?.modifiedCount ?? reset?.matchedCount ?? 0;
          if (resetCount === 1) {
            await b44.entities.AuditLog.create({
              action:'QUEUE_REENTRY_AT_TAIL',
              user_type:'sistema',
              user_name:freshQueueDriver.name || 'Driver',
              details:`${freshQueueDriver.name || driverId} reingresó y quedó último en ${currentBase}`,
              metadata:{ driverId, previousBase:authoritativeBase, newBase:currentBase, queueAt:newEntryAt, graceStillActive:false }
            }).catch(()=>{});
          }
          if (resetCount !== 1) {
            return Response.json({ success:true, repaired:false, reason:'QUEUE_REENTRY_CHANGED_CONCURRENTLY' });
          }
          normalizedExplicitQueueEntry = true;
          // No retornar: esta entrada nueva creó capacidad real y debe intentar
          // despachar un Pendiente de la misma zona en este mismo evento.
        }

        // Primera entrada sin autoridad: NUNCA confiar en queue_entered_at enviado por
        // la APK (puede ser viejo y meter al móvil primero). La entrada nace detrás
        // del último snapshot autoritativo de la base.
        if (!normalizedExplicitQueueEntry && !authoritativeBase && currentBase) {
          const seedAt = await getNextQueueTailAt(b44, currentBase, driverId);
          const nextPos = await getNextQueuePosition(b44, currentBase, driverId);
          const seeded = await b44.entities.Driver.updateMany(
            { id:driverId, status:'disponible', current_base:currentBase },
            { $set:{
              queue_entered_at:seedAt,
              queue_authoritative_base:currentBase,
              queue_authoritative_at:seedAt,
              queue_position:nextPos,
              queue_authority_marker:null,
              queue_left_at:null
            } }
          ).catch(()=>({updated:0}));
          const seededCount = seeded?.updated ?? seeded?.modifiedCount ?? seeded?.matchedCount ?? 0;
          if (seededCount !== 1) {
            return Response.json({ success:true, repaired:false, reason:'QUEUE_AUTHORITY_INITIALIZE_CHANGED_CONCURRENTLY' });
          }
          await b44.entities.AuditLog.create({
            action:'QUEUE_AUTHORITY_INITIALIZED', user_type:'sistema', user_name:freshQueueDriver.name || 'Driver',
            details:`Entrada de ${freshQueueDriver.name || driverId} registrada al final de ${currentBase} con hora autoritativa del servidor`,
            metadata:{ driverId, baseName:currentBase, queueAt:seedAt }
          }).catch(()=>{});
          normalizedExplicitQueueEntry = true;
          // No retornar: la misma entrada autoritativa debe continuar hasta el motor
          // de Pendientes en lugar de depender de un segundo evento realtime.
        }

        // Si por compatibilidad quedó autoridad vieja mientras current_base ya es null,
        // se elimina inmediatamente. Nunca se conserva turno fuera de una base.
        if (!normalizedExplicitQueueEntry && authoritativeBase && !currentBase) {
          const cleared = await b44.entities.Driver.updateMany(
            {
              id:driverId,
              status:'disponible',
              current_base:null,
              reserved_order_id:null,
              active_order_id:null,
              active_ride_id:null
            },
            { $set:{
              queue_entered_at:null,
              queue_authoritative_base:null,
              queue_authoritative_at:null,
              queue_authority_marker:null,
              queue_position:null,
              queue_left_at:null
            } }
          ).catch(()=>({updated:0}));
          const clearedCount = cleared?.updated ?? cleared?.modifiedCount ?? cleared?.matchedCount ?? 0;
          if (clearedCount === 1) {
            if (authoritativeBase) compactQueue(b44, authoritativeBase).catch(()=>null);
            await b44.entities.AuditLog.create({
              action:'STALE_QUEUE_AUTHORITY_CLEARED_OUTSIDE_BASE',
              user_type:'sistema',
              user_name:freshQueueDriver.name || 'Driver',
              details:`${freshQueueDriver.name || driverId} quedó fuera de ${authoritativeBase}; se eliminó su antigüedad inmediatamente`,
              metadata:{ driverId, previousBase:authoritativeBase, previousQueueAt:authoritativeAt }
            }).catch(()=>{});
          }
          return Response.json({ success:true, repaired:clearedCount === 1, reason:'STALE_QUEUE_AUTHORITY_CLEARED_OUTSIDE_BASE' });
        }

        // Cambio A->B: las APK instaladas hacen el cambio voluntario escribiendo
        // current_base Y una nueva queue_entered_at en la misma acción. Esa pareja
        // es nuestra señal compatible de intención sin exigir campos nuevos al APK.
        // Un heartbeat/reconexión/cache que sólo haga oscilar current_base NO puede
        // mover al chofer ni renovar su posición: se revierte a la autoridad previa.
        if (!normalizedExplicitQueueEntry && authoritativeBase && currentBase && authoritativeBase !== currentBase) {
          const explicitDriverBaseEntry = Boolean(
            eventData && oldData &&
            oldData.current_base === authoritativeBase &&
            eventData.current_base === currentBase &&
            eventData.queue_entered_at &&
            eventData.queue_entered_at !== oldData.queue_entered_at
          );

          if (explicitDriverBaseEntry) {
            // Cambio/entrada real de base: la hora del teléfono NO define la posición.
            // El servidor sella la entrada ahora, garantizando que el móvil quede último.
            const newAuthoritativeAt = await getNextQueueTailAt(b44, currentBase, driverId);
            const nextPos = await getNextQueuePosition(b44, currentBase, driverId);
            await b44.entities.Driver.updateMany(
              { id:driverId, status:'disponible', current_base:currentBase, queue_entered_at:currentAt },
              { $set:{
                queue_entered_at:newAuthoritativeAt,
                queue_authoritative_base:currentBase,
                queue_authoritative_at:newAuthoritativeAt,
                queue_position:nextPos,
                queue_left_at:null
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
        } else if (!normalizedExplicitQueueEntry && authoritativeBase && currentBase === authoritativeBase) {
          // Mismo móvil, misma base, sin acción de operador: la antigüedad NO cambia.
          if (authoritativeAt && currentAt !== authoritativeAt) {
            const restored = await b44.entities.Driver.updateMany(
              { id:driverId, status:'disponible', current_base:currentBase, queue_entered_at:currentAt },
              { $set:{ queue_entered_at:authoritativeAt, queue_left_at:null } }
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
    // INMUTABLE. El operador sólo puede reordenarlo mediante el flujo firmado
    // manualReorderDriverQueue, que fue validado arriba y retorna antes de llegar acá.
    // Rechazos, vencimientos, reconexiones, GPS, heartbeat o cualquier escritura
    // técnica de una APK legacy NO pueden cambiar su lugar dentro de la misma base.
    // Salir/cambiar/entrar de base tampoco cae en este guard porque cambia base/estado.
    // Por lo tanto, cualquier cambio de queue_entered_at que llegue hasta aquí mientras
    // sigue disponible en la MISMA base se revierte sin excepciones.
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
    // IMPORTANTE v12.27: perder/rechazar/vencer una oferta NO autoriza una nueva
    // antigüedad de cola. La APK legacy escribe queue_entered_at al liberar, pero
    // esa hora es un efecto técnico de su código viejo, no una entrada voluntaria.
    // El caso se procesa arriba por legacyDirectReject/rejectRide y queda fuera de
    // cola hasta una entrada explícita posterior. Por eso lostOffer NO se exceptúa
    // del guard de misma base.
    const unauthorizedSameBaseMove = Boolean(
      queueTimestampChanged &&
      sameBase &&
      oldData?.queue_entered_at &&
      oldData?.status === 'disponible' &&
      eventData?.status === 'disponible'
    );

    if (unauthorizedSameBaseMove) {
      const reverted = await b44.entities.Driver.updateMany(
        {
          id: driverId,
          current_base: eventData.current_base,
          status: 'disponible',
          queue_entered_at: eventData.queue_entered_at
        },
        { $set: {
          queue_entered_at: oldData.queue_entered_at
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

    // CORTE OPERATIVO URGENTE: este workflow NO debe despachar Pendientes a partir
    // de una simple escritura de queue_entered_at. Las APK legacy/reconexiones pueden
    // tocar esa proyección y eso estaba creando capacidad falsa, moviendo posiciones
    // y entregando un pendiente a un móvil que no correspondía. Sólo una entrada o
    // cambio REAL de base, o un movimiento manual explícito del operador, habilita
    // el drenaje automático de un pendiente. El despacho normal/rechazo/timeout
    // sigue siendo autoridad de assignRide/rejectRide y no depende de este trigger.
    const explicitQueueEntryOrMove = Boolean(
      normalizedExplicitQueueEntry ||
      (eventData && oldData && (
        (
          eventData.status === 'disponible' &&
          eventData.current_base &&
          eventData.current_base !== oldData.current_base &&
          eventData.queue_entered_at &&
          eventData.queue_entered_at !== oldData.queue_entered_at
        ) ||
        (
          eventData.status === 'disponible' &&
          eventData.current_base &&
          eventData.current_base === oldData.current_base &&
          eventData.queue_position !== oldData.queue_position &&
          eventData.queue_entered_at &&
          eventData.queue_entered_at !== oldData.queue_entered_at
        )
      ))
    );
    if (!explicitQueueEntryOrMove) {
      return Response.json({ success: true, skipped: true, reason: 'NO_EXPLICIT_QUEUE_ENTRY_FOR_PENDING_DISPATCH' });
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