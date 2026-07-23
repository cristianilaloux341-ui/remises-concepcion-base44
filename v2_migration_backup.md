# Respaldo de Cambios V2 (Migración Revertida)
Este archivo contiene el código de la migración V2 que fue revertida para auditoría futura.

## 1. assignRide/entry.ts (Cambio revertido)
```typescript
// Líneas que se habían modificado:
orderReq.assignment_attempt = newAttempt;
orderReq.offered_driver_ids = offeredIds;
orderReq.assigned_base = driverReq.current_base;
orderReq.driver_name = driverReq.name;
orderReq.offerExpiresAt = Date.now() + (timeoutSeconds * 1000);

await b44.entities.RideOrder.update(orderId, {
  offered_driver_ids: offeredIds,
  assignment_attempt: newAttempt,
  assigned_base: driverReq.current_base,
  driver_name: driverReq.name,
  offerExpiresAt: orderReq.offerExpiresAt
});
```

## 2. Las entidades Driver.jsonc y RideOrder.jsonc
A las mismas se les habían agregado los campos: `offerExpiresAt`, `processingOwnerId`, `processingLeaseVersion`, `processingPhase`, `pendingEffectKey`, `pendingEffectType`, `pendingEffectStatus`, `pendingEffectCorrelationId`, `pendingEffectVersion`, `effectOwnerId`, `effectLeaseExpiresAt`, `effectAttemptCount`, `lastCompletedEffectKey`, `lastEffectError`, `lastEffectAttemptAt` (en RideOrder), y `active_ride_id`, `driver_reservation_key`, `driver_reservation_version` (en Driver).

## 3. acceptRide/entry.ts
La función completa había sido reemplazada por la lógica de 9 pasos transaccionales con `acceptRideLogic()`.