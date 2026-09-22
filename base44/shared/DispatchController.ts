/**
 * LEGACY DISPATCH CONTROLLER
 *
 * El despacho productivo tiene una sola autoridad backend:
 * assignRide + rejectRide + autoReassignOnTimeout.
 *
 * Este helper queda únicamente para que simulaciones antiguas fallen de forma
 * explícita en vez de adquirir dispatch_engine o seleccionar un motor legacy.
 */
export async function triggerDispatch(_base44: any, zoneId: string, orderId: string | null = null, _requestedBaseId: string | null = null) {
  return {
    status: 'legacy_disabled',
    reason: 'USE_CANONICAL_DISPATCH_ENGINE',
    orderId,
    zoneId
  };
}
