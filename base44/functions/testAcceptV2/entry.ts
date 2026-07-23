import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

export async function releaseLeaseCAS(b44: any, rideOrderId: string, ownerId: string, acquiredLeaseVersion: number, operationKey: string, correlationId: string) {
  const release = await b44.entities.TestRideOrder.updateMany(
    {
      id: rideOrderId,
      processingOwnerId: ownerId,
      processingLeaseVersion: acquiredLeaseVersion,
      processingOperationKey: operationKey
    },
    {
      $set: {
        processingOwnerId: null,
        processingPhase: null,
        processingAction: null,
        processingOperationKey: null,
        processingLeaseExpiresAt: null
      }
    }
  );
  return release.updated === 1 ? "RELEASED" : "STILL_OWNED_BUT_NOT_RELEASED";
}

export async function compensateDriverCAS(b44: any, driverId: string, rideOrderId: string, reservationKey: string, reservedDriverVersion: number, correlationId: string) {
  const comp = await b44.entities.TestDriver.updateMany(
    {
      id: driverId,
      driver_reservation_key: reservationKey,
      driver_reservation_version: reservedDriverVersion
    },
    {
      $set: {
        status: "disponible",
        dispatch_status: "normal",
        active_ride_id: null,
        reserved_order_id: null,
        driver_reservation_key: null
      }
    }
  );
  return comp;
}

export async function testAcceptV2Logic(b44: any, rideOrderId: string, driverId: string, operationKey: string, assignmentAttempt: number) {
  const correlationId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  
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

  // 2. ADQUISICIÓN DEL LEASE
  const expectedLeaseVersion = order.processingLeaseVersion ?? 0;
  const acquiredLeaseVersion = expectedLeaseVersion + 1;
  const acquired = await b44.entities.TestRideOrder.updateMany(
    {
      id: rideOrderId,
      processingLeaseVersion: expectedLeaseVersion,
      $or: [
        { processingOwnerId: null },
        { processingOwnerId: { $exists: false } },
        { processingLeaseExpiresAt: { $lt: Date.now() } }
      ]
    },
    {
      $set: {
        processingOwnerId: ownerId,
        processingLeaseExpiresAt: Date.now() + 30000,
        processingAction: "ACCEPT",
        processingPhase: "ACQUIRED",
        processingOperationKey: operationKey
      },
      $inc: { processingLeaseVersion: 1 }
    }
  );
  if (acquired.updated === 0) return { status: "OPERATION_IN_PROGRESS", correlationId };

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
    const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId);
    let status;
    if (!order) status = "ORDER_NOT_FOUND";
    else if (order.assignment_attempt == null) status = "LEGACY_ORDER_REQUIRES_NORMALIZATION";
    else if (order.status === "cancelado") status = "ORDER_CANCELLED";
    else if (order.driver_id === driverId && order.status === "aceptado") status = "ALREADY_ACCEPTED_BY_SAME_DRIVER";
    else if (order.driver_id !== driverId && order.status === "aceptado") status = "ALREADY_ACCEPTED_BY_OTHER_DRIVER";
    else if (order.offerExpiresAt != null && order.offerExpiresAt <= validationNow) status = "OFFER_EXPIRED";
    else if (order.assignment_attempt !== assignmentAttempt) status = "STALE_ASSIGNMENT_ATTEMPT";
    else if (order.driver_id !== driverId) status = "INVALID_DRIVER";
    else if (order.processingOwnerId !== ownerId || order.processingLeaseVersion !== acquiredLeaseVersion) status = "LEASE_LOST";
    else status = "INVALID_STATE";
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
    const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId);
    return { status: "LEASE_LOST", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
  }

  // 5. RESERVA DEL DRIVER
  const driver = await b44.entities.TestDriver.get(driverId);
  if (!driver) {
      const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId);
      return { status: "DRIVER_NOT_FOUND", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
  }
  const expectedDriverVersion = driver.driver_reservation_version ?? 0;
  const reservedDriverVersion = expectedDriverVersion + 1;
  const reservationKey = crypto.randomUUID();

  const resDriver = await b44.entities.TestDriver.updateMany(
    { 
      id: driverId, 
      status: "disponible", 
      dispatch_status: "normal", 
      active_ride_id: null, 
      reserved_order_id: null, 
      driver_reservation_version: expectedDriverVersion 
    },
    { 
      $set: { 
        status: "en_viaje", 
        active_ride_id: rideOrderId, 
        reserved_order_id: rideOrderId, 
        driver_reservation_key: reservationKey, 
        driver_reservation_version: reservedDriverVersion 
      } 
    }
  );
  if (resDriver.updated === 0) {
    const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId);
    return { status: "DRIVER_ALREADY_BUSY", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
  }

  // 6. TRANSICIÓN DRIVER_RESERVED
  const reservedPhase = await b44.entities.TestRideOrder.updateMany(
    { 
      id: rideOrderId, 
      processingOwnerId: ownerId, 
      processingPhase: "VALIDATED", 
      processingLeaseVersion: acquiredLeaseVersion, 
      processingAction: "ACCEPT", 
      processingOperationKey: operationKey, 
      processingLeaseExpiresAt: { $gt: Date.now() } 
    },
    { $set: { processingPhase: "DRIVER_RESERVED" } }
  );
  if (reservedPhase.updated === 0) {
    const comp = await compensateDriverCAS(b44, driverId, rideOrderId, reservationKey, reservedDriverVersion, correlationId);
    const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId);
    return { status: "INTERNAL_INCONSISTENCY", compensationStatus: comp.updated === 1 ? "COMPENSATION_COMPLETED" : "COMPENSATION_REQUIRED", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
  }

  // 7. COMMIT COMERCIAL
  const commitNow = Date.now();
  const commit = await b44.entities.TestRideOrder.updateMany(
    { 
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
    },
    { 
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
    }
  );

  // 8. FALLO Y CLASIFICACIÓN DEL COMMIT
  if (commit.updated === 0) {
    const check = await b44.entities.TestRideOrder.get(rideOrderId);
    
    if (!check) {
      const comp = await compensateDriverCAS(b44, driverId, rideOrderId, reservationKey, reservedDriverVersion, correlationId);
      const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId);
      return { 
        status: "ORDER_NOT_FOUND", 
        compensationStatus: comp.updated === 1 ? "COMPENSATION_COMPLETED" : "COMPENSATION_REQUIRED", 
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
    else if (check.driver_id !== driverId) commercialStatus = "INVALID_DRIVER";
    else if (check.processingOwnerId !== ownerId || check.processingLeaseVersion !== acquiredLeaseVersion || check.processingAction !== "ACCEPT" || check.processingOperationKey !== operationKey || check.processingLeaseExpiresAt <= commitNow) commercialStatus = "LEASE_LOST";
    else if (check.status !== "ofrecido") commercialStatus = "INVALID_STATE";
    else commercialStatus = "INTERNAL_INCONSISTENCY";

    const comp = await compensateDriverCAS(b44, driverId, rideOrderId, reservationKey, reservedDriverVersion, correlationId);
    const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId);
    return { status: commercialStatus, compensationStatus: comp.updated === 1 ? "COMPENSATION_COMPLETED" : "COMPENSATION_REQUIRED", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
  }

  // 9. LIBERACIÓN
  const release = await releaseLeaseCAS(b44, rideOrderId, ownerId, acquiredLeaseVersion, operationKey, correlationId);
  return { status: "SUCCESS", leaseReleasePending: release === "STILL_OWNED_BUT_NOT_RELEASED", correlationId };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const b44 = base44.asServiceRole;
    
    const payload = await req.json();
    const { rideOrderId, driverId, operationKey, assignmentAttempt } = payload;
    
    if (!rideOrderId || !driverId || !operationKey || assignmentAttempt == null) {
      return Response.json({ error: "Missing required parameters" }, { status: 400 });
    }

    const result = await testAcceptV2Logic(b44, rideOrderId, driverId, operationKey, assignmentAttempt);
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});