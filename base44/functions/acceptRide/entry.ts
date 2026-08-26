import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

async function captureState(b44: any, rideOrderId: string, driverId: string) {
  const [order, driver] = await Promise.all([
    b44.entities.RideOrder.get(rideOrderId).catch(() => null),
    b44.entities.Driver.get(driverId).catch(() => null)
  ]);
  return {
    order: order ? { 
      status: order.status, 
      driver_id: order.driver_id, 
      assignment_attempt: order.assignment_attempt, 
      processingOwnerId: order.processingOwnerId, 
      processingPhase: order.processingPhase, 
      processingAction: order.processingAction, 
      processingOperationKey: order.processingOperationKey, 
      processingLeaseVersion: order.processingLeaseVersion, 
      processingLeaseExpiresAt: order.processingLeaseExpiresAt, 
      lastCompletedOperationKey: order.lastCompletedOperationKey, 
      pendingEffectStatus: order.pendingEffectStatus 
    } : null,
    driver: driver ? { 
      status: driver.status, 
      dispatch_status: driver.dispatch_status, 
      active_ride_id: driver.active_ride_id, 
      reserved_order_id: driver.reserved_order_id, 
      driver_reservation_key: driver.driver_reservation_key, 
      driver_reservation_version: driver.driver_reservation_version 
    } : null
  };
}

async function logStep(ctx: any, step: string, start: number, filterCAS: any, resultObj: any, errorMsg: string | null, snapshotBefore: any, snapshotAfter: any, explicitResult?: string) {
  const executionDurationMs = Date.now() - start;
  ctx.seq++;
  
  const casUpdatedCount = resultObj ? resultObj.updated : 0;
  const casUpdateSucceeded = casUpdatedCount === 1;
  
  const executionResult = explicitResult || (errorMsg ? "FAILED" : (casUpdateSucceeded ? "SUCCESS" : "SKIPPED"));
  
  try {
    await ctx.b44.entities.ProtocolTrace.create({
      correlationId: ctx.correlationId,
      invocationId: ctx.invocationId,
      traceSequence: ctx.seq,
      timestamp: new Date().toISOString(),
      step,
      operationKey: ctx.operationKey,
      filterCAS: filterCAS || {},
      casUpdatedCount,
      casUpdateSucceeded,
      executionResult,
      executionDurationMs,
      error: errorMsg,
      snapshotBefore,
      snapshotAfter
    });
  } catch (e) {
    console.error("ProtocolTrace error:", e);
  }
}

async function releaseLeaseCAS(b44: any, rideOrderId: string, ownerId: string, acquiredLeaseVersion: number, operationKey: string, correlationId: string, ctx?: any) {
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
  
  let snapshotBefore = null;
  let start = Date.now();
  if (ctx) {
    snapshotBefore = await captureState(b44, rideOrderId, ctx.driverId);
    await logStep(ctx, "RELEASE_LEASE_BEFORE", start, filter, null, null, snapshotBefore, null, "SUCCESS");
  }

  start = Date.now();
  let release;
  try {
    release = await b44.entities.RideOrder.updateMany(filter, update);
  } catch (e: any) {
    if (ctx) await logStep(ctx, "RELEASE_LEASE_AFTER", start, filter, null, e.message, snapshotBefore, null, "FAILED");
    throw e;
  }
  
  if (ctx) {
    let snapshotAfter = await captureState(b44, rideOrderId, ctx.driverId);
    await logStep(ctx, "RELEASE_LEASE_AFTER", start, filter, release, null, snapshotBefore, snapshotAfter);
  }

  return release.updated === 1 ? "RELEASED" : "STILL_OWNED_BUT_NOT_RELEASED";
}

async function compensateDriverCAS(b44: any, driverId: string, rideOrderId: string, reservationKey: string, reservedDriverVersion: number, correlationId: string, ctx?: any) {
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

  let snapshotBefore = null;
  let start = Date.now();
  if (ctx) {
    snapshotBefore = await captureState(b44, rideOrderId, driverId);
    await logStep(ctx, "COMPENSATE_DRIVER_BEFORE", start, filter, null, null, snapshotBefore, null, "SUCCESS");
  }

  start = Date.now();
  let comp;
  try {
    comp = await b44.entities.Driver.updateMany(filter, update);
  } catch (e: any) {
    if (ctx) await logStep(ctx, "COMPENSATE_DRIVER_AFTER", start, filter, null, e.message, snapshotBefore, null, "FAILED");
    throw e;
  }

  if (ctx) {
    let snapshotAfter = await captureState(b44, rideOrderId, driverId);
    await logStep(ctx, "COMPENSATE_DRIVER_AFTER", start, filter, comp, null, snapshotBefore, snapshotAfter);
  }
  
  return comp;
}

export async function acceptRideV2(b44: any, rideOrderId: string, driverId: string, operationKey: string, assignmentAttempt: number, invocationId: string) {
  const correlationId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const invId = invocationId;
  
  const ctx = { b44, correlationId, invocationId: invId, operationKey, seq: 0, driverId };

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
  const isBroadcast = order.status === "pendiente" && !order.driver_id;
  const isDirectOffer = order.status === "ofrecido" && (order.driver_id === driverId || order.reserved_driver_id === driverId);

  const preValidationNow = Date.now();
  let preValStatus = null;
  
  // Idempotency check: if already accepted by this driver, just return success
  if (order.status === "aceptado" && order.driver_id === driverId) {
     return { status: "SUCCESS_ALREADY_PROCESSED", correlationId };
  }

  if (order.status === "cancelado") preValStatus = "ORDER_CANCELLED";
  else if (!isBroadcast && !isDirectOffer) preValStatus = "INVALID_STATE";
  else if (!isBroadcast && order.assignment_attempt !== assignmentAttempt) preValStatus = "STALE_ASSIGNMENT_ATTEMPT";
  else if (order.offerExpiresAt != null && order.offerExpiresAt <= preValidationNow) preValStatus = "OFFER_EXPIRED";

  if (preValStatus) {
     let preSnap = await captureState(b44, rideOrderId, driverId);
     await logStep(ctx, "PREVALIDATION_RESULT", Date.now(), {}, null, null, preSnap, preSnap, "SUCCESS");
     return { status: preValStatus, correlationId };
  }

  // 2. ADQUISICIÓN DEL LEASE
  const expectedLeaseVersion = order.processingLeaseVersion ?? 0;
  const acquiredLeaseVersion = expectedLeaseVersion + 1;
  const acquireFilter = {
    id: rideOrderId,
    processingLeaseVersion: expectedLeaseVersion,
    $or: [
      { processingOwnerId: null },
      { processingOwnerId: { $exists: false } },
      { processingLeaseExpiresAt: { $lt: Date.now() } }
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

  let snapshotBefore = await captureState(b44, rideOrderId, driverId);
  let start = Date.now();
  await logStep(ctx, "ACQUIRE_LEASE_BEFORE", start, acquireFilter, null, null, snapshotBefore, null, "SUCCESS");

  start = Date.now();
  let acquired;
  try {
    acquired = await b44.entities.RideOrder.updateMany(acquireFilter, acquireUpdate);
  } catch (e: any) { 
    await logStep(ctx, "ACQUIRE_LEASE_AFTER", start, acquireFilter, null, e.message, snapshotBefore, null, "FAILED");
    throw e;
  }
  
  let snapshotAfter = await captureState(b44, rideOrderId, driverId);
  await logStep(ctx, "ACQUIRE_LEASE_AFTER", start, acquireFilter, acquired, null, snapshotBefore, snapshotAfter);

  if (acquired.updated === 0) {
    let retSnap = await captureState(b44, rideOrderId, driverId);
    await logStep(ctx, "FUNCTION_RETURN", Date.now(), null, null, null, retSnap, retSnap, "SUCCESS");
    return { status: "OPERATION_IN_PROGRESS", correlationId };
  }

  // 3. VALIDACIÓN POST-LEASE
  order = await b44.entities.RideOrder.get(rideOrderId);
  const validationNow = Date.now();
  
  const isNowBroadcast = order.status === "pendiente" && !order.driver_id;
  const isNowDirectOffer = order.status === "ofrecido" && (order.driver_id === driverId || order.reserved_driver_id === driverId);

  if (
    !order ||
    (!isNowBroadcast && !isNowDirectOffer) ||
    (!isNowBroadcast && order.assignment_attempt !== assignmentAttempt) ||
    (order.offerExpiresAt != null && order.offerExpiresAt <= validationNow) ||
    order.processingOwnerId !== ownerId ||
    order.processingLeaseVersion !== acquiredLeaseVersion ||
    order.processingAction !== "ACCEPT" ||
    order.processingOperationKey !== operationKey ||
    order.processingPhase !== "ACQUIRED" ||
    order.processingLeaseExpiresAt <= validationNow
  ) {
    const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId, ctx);
    let status;
    if (!order) status = "ORDER_NOT_FOUND";
    else if (order.status === "cancelado") status = "ORDER_CANCELLED";
    else if (order.driver_id === driverId && order.status === "aceptado") status = "ALREADY_ACCEPTED_BY_SAME_DRIVER";
    else if (order.status === "aceptado") status = "ALREADY_ACCEPTED_BY_OTHER_DRIVER";
    else if (order.offerExpiresAt != null && order.offerExpiresAt <= validationNow) status = "OFFER_EXPIRED";
    else if (!isNowBroadcast && order.assignment_attempt !== assignmentAttempt) status = "STALE_ASSIGNMENT_ATTEMPT";
    else if (!isNowBroadcast && order.driver_id !== driverId && order.reserved_driver_id !== driverId) status = "INVALID_DRIVER";
    else if (order.processingOwnerId !== ownerId || order.processingLeaseVersion !== acquiredLeaseVersion || order.processingLeaseExpiresAt <= validationNow) status = "LEASE_LOST";
    else status = "INVALID_STATE";
    
    let retSnap = await captureState(b44, rideOrderId, driverId);
    await logStep(ctx, "FUNCTION_RETURN", Date.now(), null, null, null, retSnap, retSnap, "SUCCESS");
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
  
  if (validated.updated === 0) {
    const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId, ctx);
    let retSnap = await captureState(b44, rideOrderId, driverId);
    await logStep(ctx, "FUNCTION_RETURN", Date.now(), null, null, null, retSnap, retSnap, "SUCCESS");
    return { status: "LEASE_LOST", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
  }

  // 5. RESERVA DEL DRIVER
  const driver = await b44.entities.Driver.get(driverId);
  if (!driver) {
      const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId, ctx);
      let retSnap = await captureState(b44, rideOrderId, driverId);
      await logStep(ctx, "FUNCTION_RETURN", Date.now(), null, null, null, retSnap, retSnap, "SUCCESS");
      return { status: "DRIVER_NOT_FOUND", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
  }
  const expectedDriverVersion = driver.driver_reservation_version ?? 0;
  const reservedDriverVersion = expectedDriverVersion + 1;
  const reservationKey = crypto.randomUUID();

  // Un chofer solamente puede aceptar si está realmente disponible y sin otro viaje activo.
  // Esto impide que una asignación manual o un doble toque pisen un viaje en curso.
  const reserveDriverFilter = {
      id: driverId,
      status: "disponible",
      driver_reservation_version: expectedDriverVersion,
      $and: [
        { $or: [{ active_ride_id: null }, { active_ride_id: { $exists: false } }] },
        { $or: [{ active_order_id: null }, { active_order_id: { $exists: false } }, { active_order_id: rideOrderId }] },
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
        driver_reservation_version: reservedDriverVersion 
      } 
  };

  snapshotBefore = await captureState(b44, rideOrderId, driverId);
  start = Date.now();
  await logStep(ctx, "RESERVE_DRIVER_BEFORE", start, reserveDriverFilter, null, null, snapshotBefore, null, "SUCCESS");

  start = Date.now();
  let resDriver;
  try {
    resDriver = await b44.entities.Driver.updateMany(reserveDriverFilter, reserveDriverUpdate);
  } catch (e: any) { 
    await logStep(ctx, "RESERVE_DRIVER_AFTER", start, reserveDriverFilter, null, e.message, snapshotBefore, null, "FAILED");
    throw e;
  }
  
  snapshotAfter = await captureState(b44, rideOrderId, driverId);
  await logStep(ctx, "RESERVE_DRIVER_AFTER", start, reserveDriverFilter, resDriver, null, snapshotBefore, snapshotAfter);

  if (resDriver.updated === 0) {
    const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId, ctx);
    let retSnap = await captureState(b44, rideOrderId, driverId);
    await logStep(ctx, "FUNCTION_RETURN", Date.now(), null, null, null, retSnap, retSnap, "SUCCESS");
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

  snapshotBefore = await captureState(b44, rideOrderId, driverId);
  start = Date.now();
  await logStep(ctx, "DRIVER_RESERVED_TRANSITION_BEFORE", start, driverResTransFilter, null, null, snapshotBefore, null, "SUCCESS");

  start = Date.now();
  let reservedPhase;
  try {
    reservedPhase = await b44.entities.RideOrder.updateMany(driverResTransFilter, driverResTransUpdate);
  } catch (e: any) { 
    await logStep(ctx, "DRIVER_RESERVED_TRANSITION_AFTER", start, driverResTransFilter, null, e.message, snapshotBefore, null, "FAILED");
    throw e;
  }
  
  snapshotAfter = await captureState(b44, rideOrderId, driverId);
  await logStep(ctx, "DRIVER_RESERVED_TRANSITION_AFTER", start, driverResTransFilter, reservedPhase, null, snapshotBefore, snapshotAfter);

  if (reservedPhase.updated === 0) {
    const comp = await compensateDriverCAS(b44, driverId, rideOrderId, reservationKey, reservedDriverVersion, correlationId, ctx);
    const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId, ctx);
    let retSnap = await captureState(b44, rideOrderId, driverId);
    await logStep(ctx, "FUNCTION_RETURN", Date.now(), null, null, null, retSnap, retSnap, "SUCCESS");
    return { status: "INTERNAL_INCONSISTENCY", compensationStatus: comp.updated === 1 ? "COMPENSATION_COMPLETED" : "COMPENSATION_REQUIRED", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
  }

  // 7. COMMIT COMERCIAL
  const commitNow = Date.now();
  const commitFilter = { 
      id: rideOrderId, 
      // Compatibilidad defensiva con APK anteriores: algunas versiones adelantaban
      // el estado visual antes de que este commit terminara. La reserva del móvil,
      // el intento y el lease siguen validando que sea el mismo ofrecimiento.
      status: isNowBroadcast ? "pendiente" : { $in: ["ofrecido", "aceptado", "en_camino", "en_viaje"] },
      driver_id: isNowBroadcast ? null : { $in: [null, driverId] },
      reserved_driver_id: isNowBroadcast ? null : driverId, 
      assignment_attempt: isNowBroadcast ? order.assignment_attempt : assignmentAttempt, 
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
        driver_id: driverId,
        driver_name: driver.name,
        assigned_base: driver.current_base,
        updated_date: new Date().toISOString(), // TRIGGER REALTIME UI UPDATE
        processingPhase: "COMMITTED", 
        lastCompletedOperationKey: operationKey, 
        lastCompletedAction: "ACCEPT", 
        lastCompletedResult: "SUCCESS", 
        lastCompletedAt: commitNow, 
        lastCompletedOfferVersion: assignmentAttempt, 
        pendingEffectKey: `ACCEPT:${rideOrderId}:${operationKey}`, 
        pendingEffectType: "NOTIFY_CENTRAL", 
        pendingEffectStatus: "PENDING", 
        pendingEffectCorrelationId: correlationId 
      },
      $inc: { pendingEffectVersion: 1 } 
  };

  snapshotBefore = await captureState(b44, rideOrderId, driverId);
  start = Date.now();
  await logStep(ctx, "COMMERCIAL_COMMIT_BEFORE", start, commitFilter, null, null, snapshotBefore, null, "SUCCESS");

  start = Date.now();
  let commit;
  try {
    commit = await b44.entities.RideOrder.updateMany(commitFilter, commitUpdate);
  } catch (e: any) { 
    await logStep(ctx, "COMMERCIAL_COMMIT_AFTER", start, commitFilter, null, e.message, snapshotBefore, null, "FAILED");
    throw e;
  }
  
  snapshotAfter = await captureState(b44, rideOrderId, driverId);
  await logStep(ctx, "COMMERCIAL_COMMIT_AFTER", start, commitFilter, commit, null, snapshotBefore, snapshotAfter);

  // 8. FALLO Y CLASIFICACIÓN DEL COMMIT
  if (commit.updated === 0) {
    const check = await b44.entities.RideOrder.get(rideOrderId);
    
    if (!check) {
      const comp = await compensateDriverCAS(b44, driverId, rideOrderId, reservationKey, reservedDriverVersion, correlationId, ctx);
      const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId, ctx);
      let retSnap = await captureState(b44, rideOrderId, driverId);
      await logStep(ctx, "FUNCTION_RETURN", Date.now(), null, null, null, retSnap, retSnap, "SUCCESS");
      return { 
        status: "ORDER_NOT_FOUND", 
        compensationStatus: comp.updated === 1 ? "COMPENSATION_COMPLETED" : "COMPENSATION_REQUIRED", 
        leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", 
        correlationId 
      };
    }
    
    if (check.status === "aceptado" && check.lastCompletedOperationKey === operationKey) {
      const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId, ctx);
      let retSnap = await captureState(b44, rideOrderId, driverId);
      await logStep(ctx, "FUNCTION_RETURN", Date.now(), null, null, null, retSnap, retSnap, "SUCCESS");
      return { status: "SUCCESS_ALREADY_PROCESSED", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
    }
    
    let commercialStatus;
    if (check.status === "aceptado" && check.driver_id === driverId) commercialStatus = "ALREADY_ACCEPTED_BY_SAME_DRIVER";
    else if (check.status === "aceptado" && check.driver_id !== driverId) commercialStatus = "ALREADY_ACCEPTED_BY_OTHER_DRIVER";
    else if (check.status === "cancelado") commercialStatus = "ORDER_CANCELLED";
    else if (!isNowBroadcast && check.assignment_attempt !== assignmentAttempt) commercialStatus = "STALE_ASSIGNMENT_ATTEMPT";
    else if (!isNowBroadcast && check.driver_id !== driverId && check.reserved_driver_id !== driverId) commercialStatus = "INVALID_DRIVER";
    else if (check.processingOwnerId !== ownerId || check.processingLeaseVersion !== acquiredLeaseVersion || check.processingAction !== "ACCEPT" || check.processingOperationKey !== operationKey || check.processingLeaseExpiresAt <= commitNow) commercialStatus = "LEASE_LOST";
    else if (!isNowBroadcast && !["ofrecido", "aceptado", "en_camino", "en_viaje"].includes(check.status)) commercialStatus = "INVALID_STATE";
    else commercialStatus = "INTERNAL_INCONSISTENCY";

    const comp = await compensateDriverCAS(b44, driverId, rideOrderId, reservationKey, reservedDriverVersion, correlationId, ctx);
    const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId, ctx);
    let retSnap = await captureState(b44, rideOrderId, driverId);
    await logStep(ctx, "FUNCTION_RETURN", Date.now(), null, null, null, retSnap, retSnap, "SUCCESS");
    return { status: commercialStatus, compensationStatus: comp.updated === 1 ? "COMPENSATION_COMPLETED" : "COMPENSATION_REQUIRED", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
  }

  // AUDIT LOG DE PRODUCCIÓN (EFECTO FINAL REAL)
  try {
    await b44.entities.AuditLog.create({
       action: 'viaje_aceptado',
       user_type: 'chofer',
       user_name: driver.name,
       details: `Chofer aceptó viaje ${order.id} mediante protocolo V2 (Key: ${operationKey})`
    });
  } catch (e) {
    console.error("No se pudo escribir el AuditLog final", e);
  }

  // 9. LIBERACIÓN
  const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId, ctx);
  let retSnap = await captureState(b44, rideOrderId, driverId);
  await logStep(ctx, "FUNCTION_RETURN", Date.now(), null, null, null, retSnap, retSnap, "SUCCESS");
  return { status: "SUCCESS", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
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

    // Identificar de manera segura al chofer comparando tokens locales
    const drivers = await b44.entities.Driver.filter({ id: driverId });
    const driver = drivers[0];
    if (!driver) {
       return Response.json({ accepted: false, reason: "driver_not_found" });
    }

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