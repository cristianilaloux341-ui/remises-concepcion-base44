import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';
import { compactQueue } from '../../shared/queueOrder.ts';

// Trazado detallado retirado del camino crítico de ACEPTAR.
// Las carreras se protegen con CAS y se validan con las pruebas canónicas.

async function releaseLeaseCAS(b44: any, rideOrderId: string, ownerId: string, acquiredLeaseVersion: number, operationKey: string, correlationId: string) {
  const filter = {
    id: rideOrderId,
    processingOwnerId: ownerId,
    processingLeaseVersion: acquiredLeaseVersion,
    processingOperationKey: operationKey
  };
  const update = {
    $set: {
      processingOwnerId: null,
      processingPhase: null,
      processingAction: null,
      processingOperationKey: null,
      processingLeaseExpiresAt: null
    }
  };
  
  let release;
  try {
    release = await b44.entities.RideOrder.updateMany(filter, update);
  } catch (e: any) {
    throw e;
  }

  return mutationCount(release) === 1 ? "RELEASED" : "STILL_OWNED_BUT_NOT_RELEASED";
}

async function compensateDriverCAS(b44: any, driverId: string, rideOrderId: string, reservationKey: string, reservedDriverVersion: number, correlationId: string) {
  const filter = {
    id: driverId,
    driver_reservation_key: reservationKey,
    driver_reservation_version: reservedDriverVersion
  };
  // Para la compensación, no tocamos status 'en_viaje' si ya estaba, solo liberamos la reserva atómica
  // Wait: in step 5 we set status="en_viaje" and dispatch_status wasn't changed.
  // We revert to disponible.
  const update = {
    $set: {
      status: "disponible",
      dispatch_status: "normal",
      active_ride_id: null,
      reserved_order_id: null,
      driver_reservation_key: null
    }
  };

  let comp;
  try {
    comp = await b44.entities.Driver.updateMany(filter, update);
  } catch (e: any) {
    throw e;
  }

  return comp;
}

export async function acceptRideV2(b44: any, rideOrderId: string, driverId: string, operationKey: string, assignmentAttempt: number, invocationId: string) {
  const correlationId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  let order = await b44.entities.RideOrder.get(rideOrderId);

  // 1. IDEMPOTENCIA
  if (!order) return { status: "ORDER_NOT_FOUND", correlationId };
  if (order.lastCompletedOperationKey === operationKey) {
    if (
      order.lastCompletedAction === "ACCEPT" &&
      order.driver_id === driverId &&
      order.lastCompletedOfferVersion === assignmentAttempt &&
      order.lastCompletedResult === "SUCCESS"
    ) {
      return { status: "SUCCESS_ALREADY_PROCESSED", result: order.lastCompletedResult, correlationId };
    } else {
      return { status: "CONFLICT_PARAMETER_MISMATCH", correlationId };
    }
  }

  // 1.5. PRE-VALIDACIÓN (Fast fail)
  // Los Pendientes se toman exclusivamente por claimNextRide. acceptRide sólo
  // puede confirmar una oferta directa vigente; así una notificación vieja no
  // puede aceptar un viaje que ya volvió a Pendientes.
  const isDirectOffer = order.status === "ofrecido" && order.reserved_driver_id === driverId;

  const preValidationNow = Date.now();
  let preValStatus = null;
  
  // Idempotency check: if already accepted by this driver, just return success
  if (order.status === "aceptado" && order.driver_id === driverId) {
     return { status: "SUCCESS_ALREADY_PROCESSED", correlationId };
  }

  if (order.status === "cancelado") preValStatus = "ORDER_CANCELLED";
  else if (!isDirectOffer) preValStatus = "INVALID_STATE";
  else if (order.assignment_attempt !== assignmentAttempt) preValStatus = "STALE_ASSIGNMENT_ATTEMPT";
  else if (order.offerExpiresAt != null && order.offerExpiresAt <= preValidationNow) preValStatus = "OFFER_EXPIRED";

  if (preValStatus) {
     return { status: preValStatus, correlationId };
  }

  // Oferta del segundo cupo para un móvil requerido: el móvil ya tiene su viaje
  // actual, por eso NO puede pasar por la reserva normal de Driver. Aceptar sólo
  // confirma el next_order_id que assignRide dejó reservado. El CAS sobre RideOrder
  // compite de forma monotónica contra rechazo/timeout: uno solo puede ganar.
  if (order.second_slot_offer === true) {
    const driverSecond = await b44.entities.Driver.get(driverId).catch(() => null);
    if (!driverSecond || driverSecond.next_order_id !== rideOrderId || !driverSecond.next_order_token ||
        driverSecond.next_order_token !== order.reservation_token) {
      return {status:'SECOND_SLOT_RESERVATION_LOST',correlationId};
    }
    const acceptedSecond = await b44.entities.RideOrder.updateMany(
      {id:rideOrderId,status:'ofrecido',reserved_driver_id:driverId,reservation_token:order.reservation_token,
       assignment_attempt:assignmentAttempt,second_slot_offer:true,
       $or:[{processingOwnerId:null},{processingOwnerId:{$exists:false}}]},
      {$set:{status:'preasignado_proximo',preassigned_driver_id:driverId,preassignment_token:order.reservation_token,
        preassigned_at:new Date().toISOString(),second_slot_offer:false,reserved_driver_id:null,
        offerExpiresAt:null,processingAction:null,processingOwnerId:null,processingLeaseExpiresAt:null,processingPhase:null,
        lastCompletedOperationKey:operationKey,lastCompletedAction:'ACCEPT',lastCompletedResult:'SUCCESS',
        lastCompletedOfferVersion:assignmentAttempt}}
    );
    if (mutationCount(acceptedSecond) !== 1) return {status:'OPERATION_IN_PROGRESS',correlationId};
    await b44.entities.AuditLog.create({action:'SECOND_RIDE_ACCEPTED_REQUIRED',user_type:'chofer',user_name:driverSecond.name || driverId,
      details:`Móvil requerido aceptó segundo pasaje ${rideOrderId}.`,metadata:{orderId:rideOrderId,driverId,assignmentAttempt}}).catch(()=>{});
    return {status:'SUCCESS',mode:'next',correlationId};
  }

  // 2. ADQUISICIÓN DEL LEASE
  const expectedLeaseVersion = order.processingLeaseVersion ?? 0;
  let acquiredLeaseVersion = expectedLeaseVersion + 1;
  const acquireFilter = {
    id: rideOrderId,
    status: "ofrecido",
    reserved_driver_id: driverId,
    assignment_attempt: assignmentAttempt,
    $and: [
      { $or: [
        { processingLeaseVersion: expectedLeaseVersion },
        ...(expectedLeaseVersion === 0 ? [
          { processingLeaseVersion: null },
          { processingLeaseVersion: { $exists: false } }
        ] : [])
      ] },
      { $or: [
        { processingOwnerId: null },
        { processingOwnerId: { $exists: false } },
        { processingLeaseExpiresAt: { $lt: Date.now() } }
      ] }
    ]
  };
  const acquireUpdate = {
    $set: {
      processingOwnerId: ownerId,
      processingLeaseExpiresAt: Date.now() + 30000,
      processingAction: "ACCEPT",
      processingPhase: "ACQUIRED",
      processingOperationKey: operationKey
    },
    $inc: { processingLeaseVersion: 1 }
  };
  let acquired;
  try {
    acquired = await b44.entities.RideOrder.updateMany(acquireFilter, acquireUpdate);
  } catch (e: any) { 
    throw e;
  }
  

  if (mutationCount(acquired) === 0) {
    // Si otro proceso tiene un lease muy corto sobre ESTA MISMA oferta, ACEPTAR
    // espera una sola vez y reintenta. No libera locks ajenos ni modifica la cola.
    const blocked = await b44.entities.RideOrder.get(rideOrderId).catch(() => null);
    const sameLiveOffer = Boolean(
      blocked &&
      blocked.status === "ofrecido" &&
      blocked.reserved_driver_id === driverId &&
      Number(blocked.assignment_attempt) === Number(assignmentAttempt) &&
      (blocked.offerExpiresAt == null || Number(blocked.offerExpiresAt) > Date.now())
    );

    if (sameLiveOffer && blocked.processingOwnerId && Number(blocked.processingLeaseExpiresAt || 0) > Date.now()) {
      const waitMs = Math.min(1200, Math.max(150, Number(blocked.processingLeaseExpiresAt) - Date.now() + 25));
      await new Promise(r => setTimeout(r, waitMs));

      const retryOrder = await b44.entities.RideOrder.get(rideOrderId).catch(() => null);
      if (
        retryOrder &&
        retryOrder.status === "ofrecido" &&
        retryOrder.reserved_driver_id === driverId &&
        Number(retryOrder.assignment_attempt) === Number(assignmentAttempt) &&
        (retryOrder.offerExpiresAt == null || Number(retryOrder.offerExpiresAt) > Date.now())
      ) {
        const retryExpectedVersion = retryOrder.processingLeaseVersion ?? 0;
        const retryAcquiredVersion = retryExpectedVersion + 1;
        const retry = await b44.entities.RideOrder.updateMany(
          {
            id: rideOrderId,
            status: "ofrecido",
            reserved_driver_id: driverId,
            assignment_attempt: assignmentAttempt,
            $and: [
              { $or: [
                { processingLeaseVersion: retryExpectedVersion },
                ...(retryExpectedVersion === 0 ? [
                  { processingLeaseVersion: null },
                  { processingLeaseVersion: { $exists: false } }
                ] : [])
              ] },
              { $or: [
                { processingOwnerId: null },
                { processingOwnerId: { $exists: false } },
                { processingLeaseExpiresAt: { $lt: Date.now() } }
              ] }
            ]
          },
          { $set: {
              processingOwnerId: ownerId,
              processingLeaseExpiresAt: Date.now() + 30000,
              processingAction: "ACCEPT",
              processingPhase: "ACQUIRED",
              processingOperationKey: operationKey
            },
            $inc: { processingLeaseVersion: 1 }
          }
        ).catch(() => null);

        if (mutationCount(retry) === 1) {
          acquiredLeaseVersion = retryAcquiredVersion;
          acquired = retry;
        }
      }
    }

    if (mutationCount(acquired) === 0) {
      return { status: "OPERATION_IN_PROGRESS", correlationId };
    }
  }

  // 3. VALIDACIÓN POST-LEASE
  order = await b44.entities.RideOrder.get(rideOrderId);
  const validationNow = Date.now();
  
  const isNowDirectOffer = order.status === "ofrecido" && order.reserved_driver_id === driverId;

  if (
    !order ||
    !isNowDirectOffer ||
    order.assignment_attempt !== assignmentAttempt ||
    (order.offerExpiresAt != null && order.offerExpiresAt <= validationNow) ||
    order.processingOwnerId !== ownerId ||
    order.processingLeaseVersion !== acquiredLeaseVersion ||
    order.processingAction !== "ACCEPT" ||
    order.processingOperationKey !== operationKey ||
    order.processingPhase !== "ACQUIRED" ||
    order.processingLeaseExpiresAt <= validationNow
  ) {
    const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId);
    let status;
    if (!order) status = "ORDER_NOT_FOUND";
    else if (order.status === "cancelado") status = "ORDER_CANCELLED";
    else if (order.driver_id === driverId && order.status === "aceptado") status = "ALREADY_ACCEPTED_BY_SAME_DRIVER";
    else if (order.status === "aceptado") status = "ALREADY_ACCEPTED_BY_OTHER_DRIVER";
    else if (order.offerExpiresAt != null && order.offerExpiresAt <= validationNow) status = "OFFER_EXPIRED";
    else if (order.assignment_attempt !== assignmentAttempt) status = "STALE_ASSIGNMENT_ATTEMPT";
    else if (order.driver_id !== driverId && order.reserved_driver_id !== driverId) status = "INVALID_DRIVER";
    else if (order.processingOwnerId !== ownerId || order.processingLeaseVersion !== acquiredLeaseVersion || order.processingLeaseExpiresAt <= validationNow) status = "LEASE_LOST";
    else status = "INVALID_STATE";
    
    return { status, leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
  }

  // 4. TRANSICIÓN A VALIDATED
  const valFilter = { 
    id: rideOrderId, 
    processingOwnerId: ownerId, 
    processingPhase: "ACQUIRED", 
    processingLeaseVersion: acquiredLeaseVersion, 
    processingAction: "ACCEPT", 
    processingOperationKey: operationKey, 
    processingLeaseExpiresAt: { $gt: Date.now() } 
  };
  let validated;
  try {
    validated = await b44.entities.RideOrder.updateMany(valFilter, { $set: { processingPhase: "VALIDATED" } });
  } catch(e) {
    throw e;
  }
  
  if (mutationCount(validated) === 0) {
    const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId);
    return { status: "LEASE_LOST", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
  }

  // 5. RESERVA DEL DRIVER
  const driver = await b44.entities.Driver.get(driverId);
  if (!driver) {
      const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId);
      return { status: "DRIVER_NOT_FOUND", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
  }
  const expectedDriverVersion = driver.driver_reservation_version ?? 0;
  const reservedDriverVersion = expectedDriverVersion + 1;
  const reservationKey = crypto.randomUUID();

  // Configuración de bloqueo post-aceptación
  const tarifas = await b44.entities.TarifaConfig.list();
  const config = tarifas && tarifas.length > 0 ? tarifas[0] : null;
  const minutosBloqueo = Number(config?.minutos_bloqueo_post_aceptacion) || 0;
  const bloqueoHasta = minutosBloqueo > 0 ? Date.now() + (minutosBloqueo * 60000) : null;

  // Un chofer solamente puede aceptar si está realmente disponible y sin otro viaje activo.
  // Esto impide que una asignación manual o un doble toque pisen un viaje en curso.
  const reserveDriverFilter = {
      id: driverId,
      status: "disponible",
      driver_reservation_version: expectedDriverVersion,
      $and: [
        { $or: [{ active_ride_id: null }, { active_ride_id: { $exists: false } }] },
        { $or: [{ reserved_order_id: null }, { reserved_order_id: { $exists: false } }, { reserved_order_id: rideOrderId }] }
      ]
  };
  const reserveDriverUpdate = { 
      $set: { 
        status: "en_viaje",
        dispatch_status: "normal", 
        active_ride_id: rideOrderId, 
        reserved_order_id: rideOrderId, 
        driver_reservation_key: reservationKey, 
        driver_reservation_version: reservedDriverVersion,
        bloqueo_post_aceptacion_hasta: bloqueoHasta
      } 
  };
  let resDriver;
  try {
    resDriver = await b44.entities.Driver.updateMany(reserveDriverFilter, reserveDriverUpdate);
    // No compactar la cola al aceptar: la oferta ya había reservado/sacado a este
    // móvil de la cola efectiva. Aceptar no cambia el orden relativo de los demás.
    // Evita tomar el lock de base y reescribir posiciones en plena ráfaga de accepts.
  } catch (e: any) { 
    throw e;
  }
  

  if (mutationCount(resDriver) === 0) {
    const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId);
    return { status: "DRIVER_ALREADY_BUSY", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
  }

  // 6. TRANSICIÓN DRIVER_RESERVED
  const driverResTransFilter = { 
      id: rideOrderId, 
      processingOwnerId: ownerId, 
      processingPhase: "VALIDATED", 
      processingLeaseVersion: acquiredLeaseVersion, 
      processingAction: "ACCEPT", 
      processingOperationKey: operationKey, 
      processingLeaseExpiresAt: { $gt: Date.now() } 
  };
  const driverResTransUpdate = { $set: { processingPhase: "DRIVER_RESERVED" } };
  let reservedPhase;
  try {
    reservedPhase = await b44.entities.RideOrder.updateMany(driverResTransFilter, driverResTransUpdate);
  } catch (e: any) { 
    throw e;
  }
  

  if (mutationCount(reservedPhase) === 0) {
    const comp = await compensateDriverCAS(b44, driverId, rideOrderId, reservationKey, reservedDriverVersion, correlationId);
    const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId);
    return { status: "INTERNAL_INCONSISTENCY", compensationStatus: mutationCount(comp) === 1 ? "COMPENSATION_COMPLETED" : "COMPENSATION_REQUIRED", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
  }

  // 7. COMMIT COMERCIAL
  const commitNow = Date.now();
  const commitFilter = { 
      id: rideOrderId, 
      // Aceptación única absoluta: el commit final sólo puede ganar mientras la
      // orden siga exactamente OFRECIDA al mismo móvil e intento. Una vez que
      // cualquier aceptación cambia el estado, ningún segundo móvil puede
      // confirmar esa misma orden aunque conserve una pantalla/notificación vieja.
      status: "ofrecido",
      driver_id: driverId, reserved_driver_id: driverId, 
      assignment_attempt: assignmentAttempt, 
      processingOwnerId: ownerId, 
      processingPhase: "DRIVER_RESERVED", 
      processingLeaseVersion: acquiredLeaseVersion, 
      processingAction: "ACCEPT", 
      processingOperationKey: operationKey, 
      processingLeaseExpiresAt: { $gt: commitNow } 
  };
  const commitUpdate = { 
      $set: { 
        status: "aceptado", 
        accepted_at: new Date(commitNow).toISOString(),
        driver_id: driverId,
        driver_name: driver.name,
        // La base del pasaje pertenece a la orden/zona, no a la posición actual del móvil.
        // Evita que aceptar reescriba Cementerio como Plaza/otra base.
        assigned_base: order.zone || order.assigned_base || null,
        updated_date: new Date().toISOString(), // TRIGGER REALTIME UI UPDATE
        // El commit comercial ya es definitivo: liberar el lease en la MISMA
        // escritura evita otra ida y vuelta al backend antes de responder al chofer.
        processingOwnerId: null,
        processingPhase: null,
        processingAction: null,
        processingOperationKey: null,
        processingLeaseExpiresAt: null,
        lastCompletedOperationKey: operationKey, 
        lastCompletedAction: "ACCEPT", 
        lastCompletedResult: "SUCCESS", 
        lastCompletedOfferVersion: assignmentAttempt
      }
  };
  let commit;
  try {
    commit = await b44.entities.RideOrder.updateMany(commitFilter, commitUpdate);
  } catch (e: any) { 
    throw e;
  }
  

  // 8. FALLO Y CLASIFICACIÓN DEL COMMIT
  if (mutationCount(commit) === 0) {
    const check = await b44.entities.RideOrder.get(rideOrderId);
    
    if (!check) {
      const comp = await compensateDriverCAS(b44, driverId, rideOrderId, reservationKey, reservedDriverVersion, correlationId);
      const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId);
      return { 
        status: "ORDER_NOT_FOUND", 
        compensationStatus: mutationCount(comp) === 1 ? "COMPENSATION_COMPLETED" : "COMPENSATION_REQUIRED", 
        leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", 
        correlationId 
      };
    }
    
    if (check.status === "aceptado" && check.lastCompletedOperationKey === operationKey) {
      const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId);
      return { status: "SUCCESS_ALREADY_PROCESSED", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
    }
    
    let commercialStatus;
    if (check.status === "aceptado" && check.driver_id === driverId) commercialStatus = "ALREADY_ACCEPTED_BY_SAME_DRIVER";
    else if (check.status === "aceptado" && check.driver_id !== driverId) commercialStatus = "ALREADY_ACCEPTED_BY_OTHER_DRIVER";
    else if (check.status === "cancelado") commercialStatus = "ORDER_CANCELLED";
    else if (check.assignment_attempt !== assignmentAttempt) commercialStatus = "STALE_ASSIGNMENT_ATTEMPT";
    else if (check.driver_id !== driverId && check.reserved_driver_id !== driverId) commercialStatus = "INVALID_DRIVER";
    else if (check.processingOwnerId !== ownerId || check.processingLeaseVersion !== acquiredLeaseVersion || check.processingAction !== "ACCEPT" || check.processingOperationKey !== operationKey || check.processingLeaseExpiresAt <= commitNow) commercialStatus = "LEASE_LOST";
    else if (!["ofrecido", "aceptado", "en_camino", "en_viaje"].includes(check.status)) commercialStatus = "INVALID_STATE";
    else commercialStatus = "INTERNAL_INCONSISTENCY";

    const comp = await compensateDriverCAS(b44, driverId, rideOrderId, reservationKey, reservedDriverVersion, correlationId);
    const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId);
    return { status: commercialStatus, compensationStatus: mutationCount(comp) === 1 ? "COMPENSATION_COMPLETED" : "COMPENSATION_REQUIRED", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
  }

  // AUDIT LOG DE PRODUCCIÓN (EFECTO FINAL REAL)
  try {
    await b44.entities.AuditLog.create({
       action: 'viaje_aceptado',
       user_type: 'chofer',
       user_name: driver.name,
       details: `Chofer aceptó viaje ${order.id} mediante protocolo V2 (Key: ${operationKey})`
    });
    if (bloqueoHasta) {
      await b44.entities.AuditLog.create({
         action: 'DRIVER_POST_ACCEPT_BLOCK_STARTED',
         user_type: 'chofer',
         user_name: driver.name,
         details: `Inició ventana de bloqueo de ${minutosBloqueo} minutos tras aceptar viaje`,
         metadata: { driverId, orderId: rideOrderId, minutos: minutosBloqueo, origin: 'aceptacion' }
      });
    }
  } catch (e) {
    console.error("No se pudo escribir el AuditLog final", e);
  }

  // 9. El lease ya quedó liberado dentro del commit comercial.
  return { status: "SUCCESS", leaseReleasePending: false, correlationId };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const b44 = base44.asServiceRole;
    
    const payload = await req.json();
    const { orderId, driverId, assignmentAttempt, sessionToken, internalKey } = payload;
    
    if (!orderId || !driverId) {
      return Response.json({ accepted: false, reason: "missing_params" });
    }

    // Middleware de seguridad: Exigimos Internal Key o que el sessionToken coincida exactamente con este driverId
    const isAuthorized = await verifyRequestAuth(b44, payload, { allowDriverId: driverId });
    if (!isAuthorized) {
      return Response.json({ accepted: false, reason: "unauthorized" }, { status: 401 });
    }

    // acceptRideV2 valida y reserva el Driver atómicamente; evitar una lectura
    // duplicada acá reduce latencia sin relajar la seguridad.
    const invocationId = crypto.randomUUID();
    const operationKey = `ACCEPT_${orderId}_${driverId}_${assignmentAttempt || 1}_${invocationId.slice(0, 8)}`;
    
    const result = await acceptRideV2(b44, orderId, driverId, operationKey, assignmentAttempt || 1, invocationId);
    
    const isAccepted = result.status === "SUCCESS" || 
                       result.status === "SUCCESS_ALREADY_PROCESSED" || 
                       result.status === "ALREADY_ACCEPTED_BY_SAME_DRIVER";
    
    return Response.json({ 
        accepted: isAccepted, 
        idempotent: result.status === "SUCCESS_ALREADY_PROCESSED" || result.status === "ALREADY_ACCEPTED_BY_SAME_DRIVER",
        reason: result.status
    });
  } catch (error: any) {
    return Response.json({ error: error.message, accepted: false }, { status: 500 });
  }
});
