import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

/**
 * DispatchController.ts
 * Punto único de entrada para todo evento de despacho de la plataforma.
 * No modifica datos directamente; enruta hacia los servicios correspondientes y audita la traza.
 */
export async function triggerDispatch(base44: any, zoneId: string, orderId: string | null = null, requestedBaseId: string | null = null) {
  const correlationId = crypto.randomUUID();

  // 1. Iniciar traza
  await base44.asServiceRole.entities.AuditLog.create({
    action: 'DISPATCH_START',
    user_type: 'sistema',
    user_name: 'DispatchController',
    details: `Intento de despacho en zona ${zoneId}`,
    metadata: { correlationId, zoneId, orderId, requestedBaseId }
  });

  try {
    // 2. Consultar Feature Flag y Evaluar Criterios Estrictos de Piloto
    const configs = await base44.asServiceRole.entities.DispatchConfig.filter({ zone: zoneId });
    const config = configs.length > 0 ? configs[0] : null;

    let isBackendEnabled = false;

    if (config?.backendDispatchEnabled === true) {
      if (config.pilotMode) {
        // En modo piloto, se exige explícitamente que la base solicitada esté en las permitidas
        if (requestedBaseId && Array.isArray(config.enabledBaseIds) && config.enabledBaseIds.includes(requestedBaseId)) {
          isBackendEnabled = true;
        }
      } else {
        isBackendEnabled = true;
      }
    }

    if (orderId) {
      // Validación y marcado de Exclusión Mutua en la orden
      // Si el viaje ya tiene un engine distinto, no lo tocamos.
      const order = await base44.asServiceRole.entities.RideOrder.get(orderId);
      if (order) {
        // Marcamos la orden explícitamente según quién la procesa
        const assignedEngine = isBackendEnabled ? 'backend' : 'legacy';
        if (!order.dispatch_engine) {
          await base44.asServiceRole.entities.RideOrder.updateMany(
            { id: orderId, status: 'pendiente' },
            { $set: { dispatch_engine: assignedEngine } }
          );
        } else if (order.dispatch_engine !== assignedEngine) {
           await base44.asServiceRole.entities.AuditLog.create({
             action: 'DISPATCH_ENGINE_MISMATCH',
             user_type: 'sistema',
             user_name: 'DispatchController',
             details: `El viaje ${orderId} ya estaba asignado a ${order.dispatch_engine}, abortando ${assignedEngine}`,
             metadata: { correlationId, zoneId, orderId }
           });
           return { status: 'already_processed_by_other_engine', orderId, zoneId, correlationId };
        }
      }
    }

    // 3. Enrutamiento
    if (!isBackendEnabled) {
      await base44.asServiceRole.entities.AuditLog.create({
        action: 'DISPATCH_END',
        user_type: 'sistema',
        user_name: 'DispatchController',
        details: `Ejecutando fallback a despacho legacy para zona ${zoneId}`,
        metadata: { correlationId, zoneId, orderId, result: 'legacy_dispatched' }
      });

      return {
        status: 'legacy_dispatched',
        orderId,
        zoneId,
        correlationId
      };
    }

    // 4. Delegación a Servicios del Backend (Stage 1+)
    const resultStatus = 'backend_dispatched_mock'; 

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'DISPATCH_END',
      user_type: 'sistema',
      user_name: 'DispatchController',
      details: `Procesamiento backend (PILOTO) completado: ${resultStatus}`,
      metadata: { correlationId, zoneId, orderId, result: resultStatus }
    });

    return {
      status: resultStatus,
      orderId,
      zoneId,
      correlationId
    };

  } catch (error) {
    // 5. Ante error, NO lanzar fallback automático a legacy para evitar asimetría/doble asignación
    await base44.asServiceRole.entities.AuditLog.create({
      action: 'DISPATCH_ERROR',
      user_type: 'sistema',
      user_name: 'DispatchController',
      details: `Falla crítica en el controlador: ${error.message}`,
      metadata: { correlationId, zoneId, orderId, error: error.message, stack: error.stack }
    });

    return {
      status: 'persistence_error',
      orderId,
      zoneId,
      correlationId
    };
  }
}