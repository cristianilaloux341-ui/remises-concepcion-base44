import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { verifyRequestAuth } from '../../shared/security.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const payload = await req.json();
  const { orderId, driverId, importeFinal } = payload;

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
    if (['disponible', 'no_disponible'].includes(currentDriver.status) && !currentDriver.active_ride_id && !currentDriver.reserved_order_id && !currentDriver.reservation_token && !currentDriver.manual_reservation_token) {
      await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_ALREADY_PROCESSED', user_type: 'sistema', user_name: 'finishRide', details: 'Already completed perfectly', metadata: { orderId, driverId } });
      return Response.json({ success: true, idempotent: true, reason: 'ALREADY_PROCESSED' });
    } else {
      const fixRes = await b44.entities.Driver.updateMany(
        { id: driverId },
        { $set: { status: 'disponible', dispatch_status: 'normal', reserved_order_id: null, reservation_token: null, manual_reservation_token: null, driver_reservation_key: null, active_ride_id: null } }
      );
      if (fixRes.updated === 1) {
         await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_ALREADY_PROCESSED', user_type: 'sistema', user_name: 'finishRide', details: 'Repaired driver state', metadata: { orderId, driverId } });
         return Response.json({ success: true, idempotent: true, note: 'repaired_driver', reason: 'ALREADY_PROCESSED' });
      } else {
         await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_PARTIAL_FAILURE', user_type: 'sistema', user_name: 'finishRide', details: `Failed to repair driver, raw: ${JSON.stringify(fixRes)}`, metadata: { orderId, driverId } });
         return Response.json({ success: false, reason: 'PARTIAL_STATE_REQUIRES_RECONCILIATION', db_result: fixRes });
      }
    }
  };

  if (order.status === 'completado') {
    return await checkAndRepairDriver(driver);
  }

  if (!['aceptado', 'en_viaje'].includes(order.status)) {
    await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_FAILED', user_type: 'sistema', user_name: 'finishRide', details: 'Invalid order status', metadata: { orderId, status: order.status } });
    return Response.json({ success: false, reason: 'invalid_order_status' });
  }

  const uOrder = await b44.entities.RideOrder.updateMany(
    { id: orderId, status: { $in: ['aceptado', 'en_viaje'] }, driver_id: driverId },
    { $set: { 
        status: 'completado',
        taximetro_iniciado: false,
        importe_real_actual: importeFinal, 
        updated_date: new Date().toISOString(),
        reserved_driver_id: null,
        reservation_token: null,
        manual_reservation_token: null,
        processingOwnerId: null,
        processingPhase: null,
        processingOperationKey: null
      } 
    }
  );

  if (uOrder.updated !== 1) {
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
    { id: driverId },
    { $set: { status: 'disponible', dispatch_status: 'normal', reserved_order_id: null, reservation_token: null, manual_reservation_token: null, driver_reservation_key: null, active_ride_id: null } }
  );

  if (uDriver.updated !== 1) {
    await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_PARTIAL_FAILURE', user_type: 'sistema', user_name: 'finishRide', details: `Driver update failed, raw: ${JSON.stringify(uDriver)}`, metadata: { orderId, driverId } });
    return Response.json({ success: false, reason: 'PARTIAL_STATE_REQUIRES_RECONCILIATION', db_result: uDriver });
  }

  await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_COMMITTED', user_type: 'sistema', user_name: 'finishRide', details: 'Finished successfully', metadata: { orderId, driverId } });
  return Response.json({ success: true });
});