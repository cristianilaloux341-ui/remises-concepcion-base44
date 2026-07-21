import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

/**
 * DispatchController.ts
 * Enrutador con adquisición atómica de exclusión mutua.
 */
export async function triggerDispatch(base44: any, zoneId: string, orderId: string | null = null, requestedBaseId: string | null = null) {
  const correlationId = crypto.randomUUID();

  await base44.asServiceRole.entities.AuditLog.create({
    action: 'DISPATCH_START',
    user_type: 'sistema',
    user_name: 'DispatchController',
    details: `Intento de despacho en zona ${zoneId}`,
    metadata: { correlationId, zoneId, orderId, requestedBaseId }
  });

  try {
    const configs = await base44.asServiceRole.entities.DispatchConfig.filter({ zone: zoneId });
    const config = configs.length > 0 ? configs[0] : { engineState: 'disabled', pilotMode: false };

    let isBackendEnabled = false;
    let engineDecisionReason = '';

    if (orderId) {
      const order = await base44.asServiceRole.entities.RideOrder.get(orderId);
      if (!order) throw new Error('Order not found');

      if (order.dispatch_engine === 'backend') {
        // En draining, permitimos que el backend termine su trabajo exclusivo
        if (config.engineState === 'active' || config.engineState === 'draining') {
          isBackendEnabled = true;
          engineDecisionReason = 'already_backend_in_flight';
        } else {
          isBackendEnabled = false;
          engineDecisionReason = 'backend_force_disabled';
        }
      } else if (order.dispatch_engine === 'legacy') {
        isBackendEnabled = false;
        engineDecisionReason = 'already_legacy_in_flight';
      } else {
        // Adquisición atómica si es nulo
        let wantsBackend = false;
        // Solo comenzamos nuevos viajes en active
        if (config.engineState === 'active') {
          if (config.pilotMode) {
            if (requestedBaseId && Array.isArray(config.enabledBaseIds) && config.enabledBaseIds.includes(requestedBaseId)) {
              wantsBackend = true;
            }
          } else {
            wantsBackend = true;
          }
        }

        if (wantsBackend) {
          const res = await base44.asServiceRole.entities.RideOrder.updateMany(
            { id: orderId, status: 'pendiente', $or: [{ dispatch_engine: null }, { dispatch_engine: { $exists: false } }] },
            { $set: { dispatch_engine: 'backend' } }
          );
          if ((res.matchedCount ?? res.modifiedCount ?? 0) === 1) {
            isBackendEnabled = true;
            engineDecisionReason = 'atomic_acquisition_backend';
          } else {
            await base44.asServiceRole.entities.AuditLog.create({
              action: 'DISPATCH_ENGINE_MISMATCH',
              user_type: 'sistema', user_name: 'DispatchController',
              details: `Race condition evitada (backend match=0) para ${orderId}`,
              metadata: { correlationId }
            });
            return { status: 'already_processed_by_other_engine', orderId, zoneId, correlationId };
          }
        } else {
          const res = await base44.asServiceRole.entities.RideOrder.updateMany(
            { id: orderId, status: 'pendiente', $or: [{ dispatch_engine: null }, { dispatch_engine: { $exists: false } }] },
            { $set: { dispatch_engine: 'legacy' } }
          );
          if ((res.matchedCount ?? res.modifiedCount ?? 0) === 1) {
            isBackendEnabled = false;
            engineDecisionReason = 'atomic_acquisition_legacy';
          } else {
            await base44.asServiceRole.entities.AuditLog.create({
              action: 'DISPATCH_ENGINE_MISMATCH',
              user_type: 'sistema', user_name: 'DispatchController',
              details: `Race condition evitada (legacy match=0) para ${orderId}`,
              metadata: { correlationId }
            });
            return { status: 'already_processed_by_other_engine', orderId, zoneId, correlationId };
          }
        }
      }
    } else {
      isBackendEnabled = config.engineState === 'active';
      engineDecisionReason = 'no_order_id_fallback';
    }

    if (!isBackendEnabled) {
      await base44.asServiceRole.entities.AuditLog.create({
        action: 'DISPATCH_END',
        user_type: 'sistema', user_name: 'DispatchController',
        details: `Ejecutando fallback a legacy para zona ${zoneId} (${engineDecisionReason})`,
        metadata: { correlationId, zoneId, orderId, result: 'legacy_dispatched' }
      });
      return { status: 'legacy_dispatched', orderId, zoneId, correlationId };
    }

    const resultStatus = 'backend_dispatched'; 
    await base44.asServiceRole.entities.AuditLog.create({
      action: 'DISPATCH_END',
      user_type: 'sistema', user_name: 'DispatchController',
      details: `Adquisición atómica completada: ${resultStatus} (${engineDecisionReason})`,
      metadata: { correlationId, zoneId, orderId, result: resultStatus }
    });

    return { status: resultStatus, orderId, zoneId, correlationId };

  } catch (error) {
    await base44.asServiceRole.entities.AuditLog.create({
      action: 'DISPATCH_CRITICAL_ERROR',
      user_type: 'sistema', user_name: 'DispatchController',
      details: `Falla crítica en el controlador: ${error.message}`,
      metadata: { correlationId, zoneId, orderId, error: error.message, stack: error.stack }
    });
    return { status: 'persistence_error', orderId, zoneId, correlationId };
  }
}