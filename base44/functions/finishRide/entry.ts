import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { verifyRequestAuth } from '../../shared/security.ts';

function mutationCount(result: any): number {
  return Math.max(
    Number(result?.updated ?? 0),
    Number(result?.modifiedCount ?? 0),
    Number(result?.matchedCount ?? 0)
  );
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const payload = await req.json();
  const { orderId, driverId, importeFinal, operationKey } = payload;
  const opKey = operationKey || `FINISH_${orderId}_${driverId}`;

  await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_REQUESTED', user_type: 'sistema', user_name: 'finishRide', details: `Requested finish for ${orderId}`, metadata: { orderId, driverId } });

  if (!orderId || !driverId) {
    await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_FAILED', user_type: 'sistema', user_name: 'finishRide', details: 'Missing params', metadata: { orderId, driverId } });
    return Response.json({ success: false, reason: 'missing_params' });
  }

  // Verificar la sesión del chofer o clave de servicio mediante el middleware
  if (!(await verifyRequestAuth(b44, payload, { allowDriverId: driverId }))) {
    await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_FAILED', user_type: 'sistema', user_name: 'finishRide', details: 'Invalid driver session', metadata: { orderId, driverId } });
    return Response.json({ success: false, reason: 'unauthorized' }, { status: 401 });
  }

  const drivers = await b44.entities.Driver.filter({ id: driverId });
  const driver = drivers[0];
  if (!driver) {
    return Response.json({ success: false, reason: 'driver_not_found' });
  }

  const orders = await b44.entities.RideOrder.filter({ id: orderId });
  const order = orders[0];
  if (!order) {
    await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_FAILED', user_type: 'sistema', user_name: 'finishRide', details: 'Order not found', metadata: { orderId } });
    return Response.json({ success: false, reason: 'not_found' });
  }

  if (order.driver_id !== driverId) {
    await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_FAILED', user_type: 'sistema', user_name: 'finishRide', details: 'Wrong driver', metadata: { orderId, expected: driverId, actual: order.driver_id } });
    return Response.json({ success: false, reason: 'wrong_driver' });
  }

  const checkAndRepairDriver = async (currentDriver) => {
    // Releer antes de decidir: finishRide compite con workflows que pueden limpiar
    // el Driver milisegundos después de completar el RideOrder. Un snapshot viejo
    // no debe convertir un cierre correcto en PARTIAL_FAILURE.
    const freshDriver = await b44.entities.Driver.get(driverId).catch(() => currentDriver);
    const isClean = (d:any) => Boolean(
      d &&
      ['disponible', 'no_disponible'].includes(d.status) &&
      !d.active_ride_id &&
      !d.active_order_id &&
      !d.reserved_order_id &&
      !d.reservation_token &&
      !d.manual_reservation_token
    );

    if (isClean(freshDriver)) {
      await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_ALREADY_PROCESSED', user_type: 'sistema', user_name: 'finishRide', details: 'Already completed perfectly', metadata: { orderId, driverId } });
      return Response.json({ success: true, idempotent: true, reason: 'ALREADY_PROCESSED' });
    }

    const fixRes = await b44.entities.Driver.updateMany(
      { id: driverId, $or: [{ reserved_order_id: orderId }, { active_order_id: orderId }, { active_ride_id: orderId }] },
      { $set: { status: 'disponible', dispatch_status: 'normal', current_base: null, queue_entered_at: null, queue_authoritative_base: null, queue_authoritative_at: null, queue_authority_marker: null, queue_position: null, reserved_order_id: null, reservation_token: null, manual_reservation_token: null, driver_reservation_key: null, active_order_id: null, active_ride_id: null, bloqueo_post_aceptacion_hasta: null } }
    );
    if (mutationCount(fixRes) >= 1) {
      await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_ALREADY_PROCESSED', user_type: 'sistema', user_name: 'finishRide', details: 'Repaired driver state', metadata: { orderId, driverId } });
      return Response.json({ success: true, idempotent: true, note: 'repaired_driver', reason: 'ALREADY_PROCESSED' });
    }

    // Si otra operación ganó la carrera y lo dejó limpio entre nuestra lectura y
    // el CAS, eso también es éxito idempotente, no un error parcial.
    const afterNoMatch = await b44.entities.Driver.get(driverId).catch(() => null);
    if (isClean(afterNoMatch)) {
      await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_ALREADY_PROCESSED', user_type: 'sistema', user_name: 'finishRide', details: 'Driver was cleaned concurrently', metadata: { orderId, driverId } });
      return Response.json({ success: true, idempotent: true, note: 'concurrent_cleanup', reason: 'ALREADY_PROCESSED' });
    }

    await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_PARTIAL_FAILURE', user_type: 'sistema', user_name: 'finishRide', details: `Failed to repair driver, raw: ${JSON.stringify(fixRes)}`, metadata: { orderId, driverId } });
    return Response.json({ success: false, reason: 'PARTIAL_STATE_REQUIRES_RECONCILIATION', db_result: fixRes });
  };

  if (order.status === 'completado') {
    // Compatibilidad con APKs anteriores: algunas versiones podían marcar el viaje
    // como completado justo antes de invocar finishRide. En ese caso no debemos salir
    // sin guardar el cierre real. Reparamos únicamente si faltan datos de finalización.
    const closureIncomplete = !order.ride_finished_at || order.lastCompletedAction !== 'FINISH' || order.taximetro_iniciado !== false;
    if (closureIncomplete) {
      const finishedAt = new Date();
      const startedAtMs = Date.parse(order.ride_started_at || '');
      const rideDurationSeconds = Number.isFinite(startedAtMs)
        ? Math.max(0, Math.floor((finishedAt.getTime() - startedAtMs) / 1000))
        : Number(order.ride_duration_seconds || 0);
      const finalImporte = Math.max(0, Number(importeFinal ?? order.importe_real_actual ?? 0));

      const repairOrder = await b44.entities.RideOrder.updateMany(
        { id: orderId, status: 'completado', driver_id: driverId },
        { $set: {
            taximetro_iniciado: false,
            importe_real_actual: finalImporte,
            ride_finished_at: order.ride_finished_at || finishedAt.toISOString(),
            ride_duration_seconds: rideDurationSeconds,
            updated_date: finishedAt.toISOString(),
            lastCompletedOperationKey: opKey,
            lastCompletedAction: 'FINISH'
          }
        }
      );

      if (mutationCount(repairOrder) === 1) {
        await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_REPAIRED', user_type: 'sistema', user_name: 'finishRide', details: 'Completed order had incomplete finish metadata and was repaired', metadata: { orderId, driverId } });
      } else {
        await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_PARTIAL_FAILURE', user_type: 'sistema', user_name: 'finishRide', details: `Could not repair completed order, raw: ${JSON.stringify(repairOrder)}`, metadata: { orderId, driverId } });
        return Response.json({ success: false, reason: 'COMPLETED_ORDER_REPAIR_FAILED', db_result: repairOrder });
      }
    }
    return await checkAndRepairDriver(driver);
  }

  if (!['aceptado', 'en_camino', 'en_viaje'].includes(order.status)) {
    await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_FAILED', user_type: 'sistema', user_name: 'finishRide', details: 'Invalid order status', metadata: { orderId, status: order.status } });
    return Response.json({ success: false, reason: 'invalid_order_status' });
  }

  // El cierre usa exclusivamente el acumulado del taxímetro nuevo, calculado con
  // el snapshot congelado al iniciar el viaje. No se consulta TarifaConfig ni el
  // calculador legacy al finalizar: un cambio de tarifa nunca puede alterar un viaje activo.
  const importeTelefono = Math.max(0, Number(importeFinal ?? order.importe_real_actual ?? 0));
  const finalImporte = importeTelefono;
  const importeServidor = null;
  const origenCalculo = 'taximetro_snapshot_telefono';
  const finishedAt = new Date();
  const startedAtMs = Date.parse(order.ride_started_at || '');
  const rideDurationSeconds = Number.isFinite(startedAtMs)
    ? Math.max(0, Math.floor((finishedAt.getTime() - startedAtMs) / 1000))
    : 0;

  const uOrder = await b44.entities.RideOrder.updateMany(
    { id: orderId, status: { $in: ['aceptado', 'en_camino', 'en_viaje'] }, driver_id: driverId },
    { $set: { 
        status: 'completado',
        taximetro_iniciado: false,
        importe_real_actual: finalImporte, 
        importe_calculo_servidor: importeServidor,
        origen_calculo: origenCalculo,
        ride_finished_at: finishedAt.toISOString(),
        ride_duration_seconds: rideDurationSeconds,
        driver_name: order.driver_name || driver.name || '',
        driver_mobile: order.driver_mobile || String(driver.vehicle_model || driver.mobile_number || ''),
        driver_vehicle_plate: order.driver_vehicle_plate || driver.vehicle_plate || '',
        updated_date: finishedAt.toISOString(),
        reserved_driver_id: null,
        reservation_token: null,
        manual_reservation_token: null,
        processingOwnerId: null,
        processingPhase: null,
        processingOperationKey: null,
        lastCompletedOperationKey: opKey,
        lastCompletedAction: "FINISH"
      } 
    }
  );

  if (mutationCount(uOrder) !== 1) {
    const freshOrders = await b44.entities.RideOrder.filter({ id: orderId });
    const freshDrivers = await b44.entities.Driver.filter({ id: driverId });
    const fOrder = freshOrders[0];
    const fDriver = freshDrivers[0];

    if (fOrder && fOrder.status === 'completado') {
      return await checkAndRepairDriver(fDriver || driver);
    }

    await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_FAILED', user_type: 'sistema', user_name: 'finishRide', details: `Order condition mismatch, raw: ${JSON.stringify(uOrder)}`, metadata: { orderId, driverId } });
    return Response.json({ success: false, reason: 'race_condition_or_invalid_state', db_result: uOrder });
  }

  const uDriver = await b44.entities.Driver.updateMany(
    { id: driverId, $or: [{ reserved_order_id: orderId }, { active_order_id: orderId }, { active_ride_id: orderId }] },
    { $set: { status: 'disponible', dispatch_status: 'normal', current_base: null, queue_entered_at: null, queue_authoritative_base: null, queue_authoritative_at: null, queue_authority_marker: null, queue_position: null, reserved_order_id: null, reservation_token: null, manual_reservation_token: null, driver_reservation_key: null, active_order_id: null, active_ride_id: null, bloqueo_post_aceptacion_hasta: null } }
  );

  if (mutationCount(uDriver) < 1) {
    return await checkAndRepairDriver(driver);
  }

  if (driver.bloqueo_post_aceptacion_hasta && Number(driver.bloqueo_post_aceptacion_hasta) > Date.now()) {
    await b44.entities.AuditLog.create({
      action: 'DRIVER_POST_ACCEPT_BLOCK_RELEASED',
      user_type: 'sistema',
      user_name: 'finishRide',
      details: 'Se liberó la ventana de bloqueo post-aceptación al finalizar el viaje',
      metadata: { driverId, orderId, origin: 'aceptacion' }
    });
  }

  await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_COMMITTED', user_type: 'sistema', user_name: 'finishRide', details: 'Finished successfully', metadata: { orderId, driverId } });
  return Response.json({ success: true });
});