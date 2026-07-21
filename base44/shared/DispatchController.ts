import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

/**
 * DispatchController.ts
 * Punto único de entrada para todo evento de despacho de la plataforma.
 * No modifica datos directamente; enruta hacia los servicios correspondientes y audita la traza.
 */
export async function triggerDispatch(base44: any, zoneId: string, orderId: string | null = null) {
  const correlationId = crypto.randomUUID();

  // 1. Iniciar traza
  await base44.asServiceRole.entities.AuditLog.create({
    action: 'DISPATCH_START',
    user_type: 'sistema',
    user_name: 'DispatchController',
    details: `Intento de despacho en zona ${zoneId}`,
    metadata: { correlationId, zoneId, orderId }
  });

  try {
    // 2. Consultar Feature Flag
    const configs = await base44.asServiceRole.entities.DispatchConfig.filter({ zone: zoneId });
    const config = configs.length > 0 ? configs[0] : null;

    // 3. Enrutamiento (Fallback por defecto a legacy)
    if (!config || !config.backendDispatchEnabled) {
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
    // const result = await backendDispatchService.processZoneDispatch(base44, zoneId, orderId, correlationId);
    
    // Simulación de resultado estructural mientras se implementa el backendDispatchService
    const resultStatus = 'backend_dispatched'; // 'zone_busy', 'already_processed', etc.

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'DISPATCH_END',
      user_type: 'sistema',
      user_name: 'DispatchController',
      details: `Procesamiento backend completado: ${resultStatus}`,
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