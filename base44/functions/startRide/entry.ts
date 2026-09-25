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

  // Flujo V2 estricto: Aceptado -> Llegué/En Puerta -> Pasajero a bordo/Con Pasaje.
  // El destino nunca interviene en estas transiciones.
  const allowedTransition =
    (order.status === "aceptado" && targetStatus === "en_camino") ||
    (order.status === "en_camino" && targetStatus === "en_viaje");
  if (!allowedTransition) {
    return { status: "INVALID_TRANSITION" };
  }

  // Los tiempos de pantalla son autoridad de Central/backend. La APK no lleva
  // un reloj comercial para estas transiciones: sólo intenta avanzar y el
  // servidor decide si ya se cumplió la espera mínima configurada.
  const configs = await b44.entities.TarifaConfig.list();
  const config = configs?.[0] || {};
  const nowMs = Date.now();
  if (order.status === "aceptado" && targetStatus === "en_camino") {
    const waitSeconds = Math.max(0, Number(config.segundos_aceptado_antes_en_camino) || 0);
    const originMs = Date.parse(order.accepted_at || order.updated_date || order.created_date || "");
    if (Number.isFinite(originMs) && nowMs < originMs + waitSeconds * 1000) {
      return { status: "TOO_EARLY", retryAfterMs: originMs + waitSeconds * 1000 - nowMs };
    }
  }
  if (order.status === "en_camino" && targetStatus === "en_viaje") {
    const waitSeconds = Math.max(0, Number(config.segundos_en_camino_antes_en_viaje) || 0);
    const originMs = Date.parse(order.en_camino_at || order.updated_date || "");
    if (Number.isFinite(originMs) && nowMs < originMs + waitSeconds * 1000) {
      return { status: "TOO_EARLY", retryAfterMs: originMs + waitSeconds * 1000 - nowMs };
    }
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
  
  // Snapshot tarifario: se congela una sola vez al entrar a en_viaje.
  // Cambios posteriores en TarifaConfig solo afectan viajes futuros.
  let rideStartFields: Record<string, any> = {};
  if (targetStatus === "en_viaje" && !order.tarifa_snapshot_at) {
    const configs = await b44.entities.TarifaConfig.list();
    const tarifa = configs?.[0] || {};
    const drivers = await b44.entities.Driver.filter({ id: driverId });
    const driver = drivers?.[0] || {};
    const startedAt = new Date().toISOString();
    rideStartFields = {
      ride_started_at: order.ride_started_at || startedAt,
      ride_finished_at: null,
      ride_duration_seconds: 0,
      max_speed_kmh: Number(order.max_speed_kmh || 0),
      driver_name: order.driver_name || driver.name || '',
      driver_mobile: order.driver_mobile || String(driver.vehicle_model || driver.mobile_number || ''),
      driver_vehicle_plate: order.driver_vehicle_plate || driver.vehicle_plate || '',
      taximetro_iniciado: true,
      tarifa_bajada_snapshot: Number(tarifa.bajada_bandera || 0),
      tarifa_valor_ficha_snapshot: Number(tarifa.valor_ficha || 0),
      tarifa_metros_por_ficha_snapshot: Number(tarifa.metros_por_ficha || 0),
      tarifa_tolerancia_espera_segundos_snapshot: Number(tarifa.tolerancia_espera_segundos || 0),
      tarifa_segundos_por_ficha_espera_snapshot: Number(tarifa.segundos_por_ficha_espera || 0),
      tarifa_valor_ficha_espera_snapshot: Number(tarifa.valor_ficha_espera || 0),
      tarifa_snapshot_at: startedAt,
      importe_real_actual: Number(tarifa.bajada_bandera || 0),
      metros_taximetro: Number(order.metros_taximetro || 0),
      segundos_espera_acumulados: Number(order.segundos_espera_acumulados || 0)
    };
  }

  // COMMIT
  const commitFilter = {
      id: rideOrderId,
      driver_id: driverId,
      processingOwnerId: ownerId,
      processingLeaseVersion: acquiredLeaseVersion,
      processingOperationKey: operationKey
  };
  const transitionAt = new Date().toISOString();
  const commitUpdate = {
      $set: {
        status: targetStatus,
        ...(targetStatus === "en_camino" ? { en_camino_at: transitionAt } : {}),
        updated_date: transitionAt,
        ...rideStartFields,
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
    return Response.json({ success: isSuccess, reason: result.status, retryAfterMs: result.retryAfterMs ?? 0 });
  } catch (error: any) {
    return Response.json({ error: error.message, success: false }, { status: 500 });
  }
});