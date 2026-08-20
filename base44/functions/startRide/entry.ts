import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

export async function startRideCAS(b44: any, rideOrderId: string, driverId: string, targetStatus: string, operationKey: string) {
  const ownerId = crypto.randomUUID();
  
  const order = await b44.entities.RideOrder.get(rideOrderId);
  if (!order) return { status: "ORDER_NOT_FOUND" };
  
  if (order.lastCompletedOperationKey === operationKey) {
     return { status: "SUCCESS_ALREADY_PROCESSED" };
  }
  
  if (order.status === targetStatus && order.driver_id === driverId) {
     return { status: "SUCCESS_ALREADY_PROCESSED" };
  }
  
  if (!["aceptado", "en_camino", "en_viaje"].includes(order.status) || order.driver_id !== driverId) {
     return { status: "INVALID_STATE" };
  }
  
  // ACQUIRE LEASE
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
      processingAction: "START",
      processingPhase: "ACQUIRED",
      processingOperationKey: operationKey
    },
    $inc: { processingLeaseVersion: 1 }
  };
  
  const acquired = await b44.entities.RideOrder.updateMany(acquireFilter, acquireUpdate);
  if (acquired.updated === 0) {
    return { status: "OPERATION_IN_PROGRESS" };
  }
  
  // COMMIT
  const commitFilter = {
      id: rideOrderId,
      driver_id: driverId,
      processingOwnerId: ownerId,
      processingLeaseVersion: acquiredLeaseVersion,
      processingOperationKey: operationKey
  };
  const commitUpdate = {
      $set: {
        status: targetStatus,
        updated_date: new Date().toISOString(),
        processingOwnerId: null,
        processingPhase: null,
        processingAction: null,
        processingOperationKey: null,
        processingLeaseExpiresAt: null,
        lastCompletedOperationKey: operationKey,
        lastCompletedAction: "START"
      }
  };
  
  const commit = await b44.entities.RideOrder.updateMany(commitFilter, commitUpdate);
  if (commit.updated === 0) {
     // RELEASE on fail
     await b44.entities.RideOrder.updateMany(
        { id: rideOrderId, processingOwnerId: ownerId, processingLeaseVersion: acquiredLeaseVersion },
        { $set: { processingOwnerId: null, processingPhase: null, processingAction: null, processingOperationKey: null, processingLeaseExpiresAt: null } }
     );
     return { status: "INTERNAL_INCONSISTENCY" };
  }
  
  try {
    await b44.entities.AuditLog.create({
       action: 'viaje_iniciado',
       user_type: 'chofer',
       user_name: 'Chofer',
       details: `Chofer cambió estado a ${targetStatus} (Key: ${operationKey})`
    });
  } catch (e) {}

  return { status: "SUCCESS" };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const b44 = base44.asServiceRole;
    
    const payload = await req.json();
    const { orderId, driverId, targetStatus, sessionToken } = payload;
    
    if (!orderId || !driverId || !targetStatus) {
      return Response.json({ success: false, reason: "missing_params" });
    }

    const isAuthorized = await verifyRequestAuth(b44, payload, { allowDriverId: driverId });
    if (!isAuthorized) {
      return Response.json({ success: false, reason: "unauthorized" }, { status: 401 });
    }
    
    const operationKey = `START_${orderId}_${driverId}_${targetStatus}_${crypto.randomUUID().slice(0, 8)}`;
    const result = await startRideCAS(b44, orderId, driverId, targetStatus, operationKey);
    
    const isSuccess = result.status === "SUCCESS" || result.status === "SUCCESS_ALREADY_PROCESSED";
    return Response.json({ success: isSuccess, reason: result.status });
  } catch (error: any) {
    return Response.json({ error: error.message, success: false }, { status: 500 });
  }
});