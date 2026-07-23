import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

async function captureState(b44: any, rideOrderId: string, driverId: string) {
  const [order, driver] = await Promise.all([
    b44.entities.TestRideOrder.get(rideOrderId).catch(() => null),
    b44.entities.TestDriver.get(driverId).catch(() => null)
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

async function logStep(ctx: any, step: string, start: number, filterCAS: any, resultObj: any, errorMsg: string | null, snapshotBefore: any, rideOrderId: string, driverId: string) {
  const executionDurationMs = Date.now() - start;
  const snapshotAfter = await captureState(ctx.b44, rideOrderId, driverId);
  ctx.seq++;
  
  const casUpdatedCount = resultObj ? resultObj.updated : 0;
  const casUpdateSucceeded = casUpdatedCount === 1;
  const executionResult = errorMsg ? "FAILED" : (casUpdateSucceeded ? "SUCCESS" : "SKIPPED");
  
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

export async function releaseLeaseCAS(b44: any, rideOrderId: string, ownerId: string, acquiredLeaseVersion: number, operationKey: string, correlationId: string, ctx?: any) {
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
    await logStep(ctx, "RELEASE_LEASE_BEFORE", start, filter, null, null, snapshotBefore, rideOrderId, ctx.driverId);
  }

  start = Date.now();
  let release = { updated: 0 };
  let error = null;
  try {
    release = await b44.entities.TestRideOrder.updateMany(filter, update);
  } catch (e: any) {
    error = e.message;
  }
  
  if (ctx) await logStep(ctx, "RELEASE_LEASE_AFTER", start, filter, release, error, snapshotBefore, rideOrderId, ctx.driverId);

  return release.updated === 1 ? "RELEASED" : "STILL_OWNED_BUT_NOT_RELEASED";
}

export async function compensateDriverCAS(b44: any, driverId: string, rideOrderId: string, reservationKey: string, reservedDriverVersion: number, correlationId: string, ctx?: any) {
  const filter = {
    id: driverId,
    driver_reservation_key: reservationKey,
    driver_reservation_version: reservedDriverVersion
  };
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
    await logStep(ctx, "COMPENSATE_DRIVER_BEFORE", start, filter, null, null, snapshotBefore, rideOrderId, driverId);
  }

  start = Date.now();
  let comp = { updated: 0 };
  let error = null;
  try {
    comp = await b44.entities.TestDriver.updateMany(filter, update);
  } catch (e: any) {
    error = e.message;
  }

  if (ctx) await logStep(ctx, "COMPENSATE_DRIVER_AFTER", start, filter, comp, error, snapshotBefore, rideOrderId, driverId);
  
  return comp;
}

export async function testAcceptV2Logic(b44: any, rideOrderId: string, driverId: string, operationKey: string, assignmentAttempt: number, injectFailureAtCommit?: boolean, invocationId?: string) {
  const correlationId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const invId = invocationId || crypto.randomUUID();
  
  const ctx = { b44, correlationId, invocationId: invId, operationKey, seq: 0, driverId };

  let order = await b44.entities.TestRideOrder.get(rideOrderId);

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
  const preValidationNow = Date.now();
  let preValStatus = null;
  if (order.status === "cancelado") preValStatus = "ORDER_CANCELLED";
  else if (order.status !== "ofrecido") preValStatus = "INVALID_STATE";
  else if (order.assignment_attempt !== assignmentAttempt) preValStatus = "STALE_ASSIGNMENT_ATTEMPT";
  else if (order.driver_id !== driverId) preValStatus = "INVALID_DRIVER";
  else if (order.offerExpiresAt != null && order.offerExpiresAt <= preValidationNow) preValStatus = "OFFER_EXPIRED";

  if (preValStatus) {
     await logStep(ctx, "PREVALIDATION_RESULT", Date.now(), {}, {updated:0}, preValStatus, await captureState(b44, rideOrderId, driverId), rideOrderId, driverId);
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
  await logStep(ctx, "ACQUIRE_LEASE_BEFORE", start, acquireFilter, null, null, snapshotBefore, rideOrderId, driverId);

  start = Date.now();
  let acquired = { updated: 0 };
  let error = null;
  try {
    acquired = await b44.entities.TestRideOrder.updateMany(acquireFilter, acquireUpdate);
  } catch (e: any) { error = e.message; }
  await logStep(ctx, "ACQUIRE_LEASE_AFTER", start, acquireFilter, acquired, error, snapshotBefore, rideOrderId, driverId);

  if (acquired.updated === 0) {
    await logStep(ctx, "FUNCTION_RETURN", Date.now(), null, {updated:0}, "OPERATION_IN_PROGRESS", await captureState(b44, rideOrderId, driverId), rideOrderId, driverId);
    return { status: "OPERATION_IN_PROGRESS", correlationId };
  }

  // 3. VALIDACIÓN POST-LEASE
  order = await b44.entities.TestRideOrder.get(rideOrderId);
  const validationNow = Date.now();
  if (
    !order ||
    order.status !== "ofrecido" ||
    order.driver_id !== driverId ||
    order.assignment_attempt == null ||
    order.assignment_attempt !== assignmentAttempt ||
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
    else if (order.assignment_attempt == null) status = "LEGACY_ORDER_REQUIRES_NORMALIZATION";
    else if (order.status === "cancelado") status = "ORDER_CANCELLED";
    else if (order.driver_id === driverId && order.status === "aceptado") status = "ALREADY_ACCEPTED_BY_SAME_DRIVER";
    else if (order.driver_id !== driverId && order.status === "aceptado") status = "ALREADY_ACCEPTED_BY_OTHER_DRIVER";
    else if (order.offerExpiresAt != null && order.offerExpiresAt <= validationNow) status = "OFFER_EXPIRED";
    else if (order.assignment_attempt !== assignmentAttempt) status = "STALE_ASSIGNMENT_ATTEMPT";
    else if (order.driver_id !== driverId) status = "INVALID_DRIVER";
    else if (order.processingOwnerId !== ownerId || order.processingLeaseVersion !== acquiredLeaseVersion || order.processingLeaseExpiresAt <= validationNow) status = "LEASE_LOST";
    else status = "INVALID_STATE";
    
    await logStep(ctx, "FUNCTION_RETURN", Date.now(), null, {updated:0}, status, await captureState(b44, rideOrderId, driverId), rideOrderId, driverId);
    return { status, leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
  }

  // 4. TRANSICIÓN A VALIDATED
  const validated = await b44.entities.TestRideOrder.updateMany(
    { 
      id: rideOrderId, 
      processingOwnerId: ownerId, 
      processingPhase: "ACQUIRED", 
      processingLeaseVersion: acquiredLeaseVersion, 
      processingAction: "ACCEPT", 
      processingOperationKey: operationKey, 
      processingLeaseExpiresAt: { $gt: Date.now() } 
    },
    { $set: { processingPhase: "VALIDATED" } }
  );
  if (validated.updated === 0) {
    const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId, ctx);
    await logStep(ctx, "FUNCTION_RETURN", Date.now(), null, {updated:0}, "LEASE_LOST", await captureState(b44, rideOrderId, driverId), rideOrderId, driverId);
    return { status: "LEASE_LOST", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
  }

  // 5. RESERVA DEL DRIVER
  const driver = await b44.entities.TestDriver.get(driverId);
  if (!driver) {
      const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId, ctx);
      await logStep(ctx, "FUNCTION_RETURN", Date.now(), null, {updated:0}, "DRIVER_NOT_FOUND", await captureState(b44, rideOrderId, driverId), rideOrderId, driverId);
      return { status: "DRIVER_NOT_FOUND", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
  }
  const expectedDriverVersion = driver.driver_reservation_version ?? 0;
  const reservedDriverVersion = expectedDriverVersion + 1;
  const reservationKey = crypto.randomUUID();

  const reserveDriverFilter = { 
      id: driverId, 
      status: "disponible", 
      dispatch_status: "normal", 
      active_ride_id: null, 
      reserved_order_id: null, 
      driver_reservation_version: expectedDriverVersion 
  };
  const reserveDriverUpdate = { 
      $set: { 
        status: "en_viaje", 
        active_ride_id: rideOrderId, 
        reserved_order_id: rideOrderId, 
        driver_reservation_key: reservationKey, 
        driver_reservation_version: reservedDriverVersion 
      } 
  };

  snapshotBefore = await captureState(b44, rideOrderId, driverId);
  start = Date.now();
  await logStep(ctx, "RESERVE_DRIVER_BEFORE", start, reserveDriverFilter, null, null, snapshotBefore, rideOrderId, driverId);

  start = Date.now();
  let resDriver = { updated: 0 };
  error = null;
  try {
    resDriver = await b44.entities.TestDriver.updateMany(reserveDriverFilter, reserveDriverUpdate);
  } catch (e: any) { error = e.message; }
  await logStep(ctx, "RESERVE_DRIVER_AFTER", start, reserveDriverFilter, resDriver, error, snapshotBefore, rideOrderId, driverId);

  if (resDriver.updated === 0) {
    const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId, ctx);
    await logStep(ctx, "FUNCTION_RETURN", Date.now(), null, {updated:0}, "DRIVER_ALREADY_BUSY", await captureState(b44, rideOrderId, driverId), rideOrderId, driverId);
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
  await logStep(ctx, "DRIVER_RESERVED_TRANSITION_BEFORE", start, driverResTransFilter, null, null, snapshotBefore, rideOrderId, driverId);

  start = Date.now();
  let reservedPhase = { updated: 0 };
  error = null;
  try {
    reservedPhase = await b44.entities.TestRideOrder.updateMany(driverResTransFilter, driverResTransUpdate);
  } catch (e: any) { error = e.message; }
  await logStep(ctx, "DRIVER_RESERVED_TRANSITION_AFTER", start, driverResTransFilter, reservedPhase, error, snapshotBefore, rideOrderId, driverId);

  if (reservedPhase.updated === 0) {
    const comp = await compensateDriverCAS(b44, driverId, rideOrderId, reservationKey, reservedDriverVersion, correlationId, ctx);
    const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId, ctx);
    await logStep(ctx, "FUNCTION_RETURN", Date.now(), null, {updated:0}, "INTERNAL_INCONSISTENCY", await captureState(b44, rideOrderId, driverId), rideOrderId, driverId);
    return { status: "INTERNAL_INCONSISTENCY", compensationStatus: comp.updated === 1 ? "COMPENSATION_COMPLETED" : "COMPENSATION_REQUIRED", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
  }

  // 7. COMMIT COMERCIAL
  if (injectFailureAtCommit) {
    await b44.entities.TestRideOrder.updateMany({id: rideOrderId}, {$set: {status: "cancelado"}});
  }
  const commitNow = Date.now();
  const commitFilter = { 
      id: rideOrderId, 
      status: "ofrecido", 
      driver_id: driverId, 
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
  await logStep(ctx, "COMMERCIAL_COMMIT_BEFORE", start, commitFilter, null, null, snapshotBefore, rideOrderId, driverId);

  start = Date.now();
  let commit = { updated: 0 };
  error = null;
  try {
    commit = await b44.entities.TestRideOrder.updateMany(commitFilter, commitUpdate);
  } catch (e: any) { error = e.message; }
  await logStep(ctx, "COMMERCIAL_COMMIT_AFTER", start, commitFilter, commit, error, snapshotBefore, rideOrderId, driverId);

  // 8. FALLO Y CLASIFICACIÓN DEL COMMIT
  if (commit.updated === 0) {
    const check = await b44.entities.TestRideOrder.get(rideOrderId);
    
    if (!check) {
      const comp = await compensateDriverCAS(b44, driverId, rideOrderId, reservationKey, reservedDriverVersion, correlationId, ctx);
      const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId, ctx);
      await logStep(ctx, "FUNCTION_RETURN", Date.now(), null, {updated:0}, "ORDER_NOT_FOUND", await captureState(b44, rideOrderId, driverId), rideOrderId, driverId);
      return { 
        status: "ORDER_NOT_FOUND", 
        compensationStatus: comp.updated === 1 ? "COMPENSATION_COMPLETED" : "COMPENSATION_REQUIRED", 
        leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", 
        correlationId 
      };
    }
    
    if (check.status === "aceptado" && check.lastCompletedOperationKey === operationKey) {
      const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId, ctx);
      await logStep(ctx, "FUNCTION_RETURN", Date.now(), null, {updated:0}, "SUCCESS_ALREADY_PROCESSED", await captureState(b44, rideOrderId, driverId), rideOrderId, driverId);
      return { status: "SUCCESS_ALREADY_PROCESSED", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
    }
    
    let commercialStatus;
    if (check.status === "aceptado" && check.driver_id === driverId) commercialStatus = "ALREADY_ACCEPTED_BY_SAME_DRIVER";
    else if (check.status === "aceptado" && check.driver_id !== driverId) commercialStatus = "ALREADY_ACCEPTED_BY_OTHER_DRIVER";
    else if (check.status === "cancelado") commercialStatus = "ORDER_CANCELLED";
    else if (check.assignment_attempt !== assignmentAttempt) commercialStatus = "STALE_ASSIGNMENT_ATTEMPT";
    else if (check.driver_id !== driverId) commercialStatus = "INVALID_DRIVER";
    else if (check.processingOwnerId !== ownerId || check.processingLeaseVersion !== acquiredLeaseVersion || check.processingAction !== "ACCEPT" || check.processingOperationKey !== operationKey || check.processingLeaseExpiresAt <= commitNow) commercialStatus = "LEASE_LOST";
    else if (check.status !== "ofrecido") commercialStatus = "INVALID_STATE";
    else commercialStatus = "INTERNAL_INCONSISTENCY";

    const comp = await compensateDriverCAS(b44, driverId, rideOrderId, reservationKey, reservedDriverVersion, correlationId, ctx);
    const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId, ctx);
    await logStep(ctx, "FUNCTION_RETURN", Date.now(), null, {updated:0}, commercialStatus, await captureState(b44, rideOrderId, driverId), rideOrderId, driverId);
    return { status: commercialStatus, compensationStatus: comp.updated === 1 ? "COMPENSATION_COMPLETED" : "COMPENSATION_REQUIRED", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
  }

  // 9. LIBERACIÓN
  const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId, ctx);
  await logStep(ctx, "FUNCTION_RETURN", Date.now(), null, {updated:0}, "SUCCESS", await captureState(b44, rideOrderId, driverId), rideOrderId, driverId);
  return { status: "SUCCESS", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const b44 = base44.asServiceRole;
    
    const payload = await req.json();
    const { rideOrderId, driverId, operationKey, assignmentAttempt, injectFailureAtCommit } = payload;
    
    if (!rideOrderId || !driverId || !operationKey || assignmentAttempt == null) {
      return Response.json({ error: "Missing required parameters" }, { status: 400 });
    }

    const invocationId = crypto.randomUUID();
    const result = await testAcceptV2Logic(b44, rideOrderId, driverId, operationKey, assignmentAttempt, injectFailureAtCommit, invocationId);
    return Response.json(result);
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});