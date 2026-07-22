import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const payload = await req.json();
  const { orderId, driverId, importeFinal, sessionToken } = payload;

  await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_REQUESTED', user_type: 'sistema', user_name: 'finishRide', details: `Requested finish for ${orderId}`, metadata: { orderId, driverId } });

  if (!orderId || !driverId || !sessionToken) {
    await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_FAILED', user_type: 'sistema', user_name: 'finishRide', details: 'Missing params', metadata: { orderId, driverId } });
    return Response.json({ success: false, reason: 'missing_params' });
  }

  const drivers = await b44.entities.Driver.filter({ id: driverId });
  const driver = drivers[0];
  if (!driver || driver.current_session_token !== sessionToken) {
    await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_FAILED', user_type: 'sistema', user_name: 'finishRide', details: 'Invalid driver', metadata: { orderId, driverId } });
    return Response.json({ success: false, reason: 'unauthorized' });
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

  if (order.status === 'completado') {
    if (driver.status === 'disponible' || driver.status === 'no_disponible') {
      await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_ALREADY_PROCESSED', user_type: 'sistema', user_name: 'finishRide', details: 'Already completed perfectly', metadata: { orderId, driverId } });
      return Response.json({ success: true, idempotent: true });
    } else {
      const fixRes = await b44.entities.Driver.updateMany(
        { id: driverId },
        { $set: { status: 'disponible', dispatch_status: 'normal', reserved_order_id: null, reservation_token: null, manual_reservation_token: null, active_order_id: null } }
      );
      if (fixRes.updated === 1) {
         await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_ALREADY_PROCESSED', user_type: 'sistema', user_name: 'finishRide', details: 'Repaired driver state', metadata: { orderId, driverId } });
         return Response.json({ success: true, idempotent: true, note: 'repaired_driver' });
      } else {
         await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_PARTIAL_FAILURE', user_type: 'sistema', user_name: 'finishRide', details: `Failed to repair driver, raw: ${JSON.stringify(fixRes)}`, metadata: { orderId, driverId } });
         return Response.json({ success: false, reason: 'PARTIAL_STATE_REQUIRES_RECONCILIATION', db_result: fixRes });
      }
    }
  }

  if (!['aceptado', 'en_viaje'].includes(order.status)) {
    await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_FAILED', user_type: 'sistema', user_name: 'finishRide', details: 'Invalid order status', metadata: { orderId, status: order.status } });
    return Response.json({ success: false, reason: 'invalid_order_status' });
  }

  const uOrder = await b44.entities.RideOrder.updateMany(
    { id: orderId, status: { $in: ['aceptado', 'en_viaje'] }, driver_id: driverId },
    { $set: { status: 'completado', importe_real_actual: importeFinal, updated_date: new Date().toISOString() } }
  );

  if (uOrder.updated !== 1) {
    await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_FAILED', user_type: 'sistema', user_name: 'finishRide', details: `Order condition mismatch, raw: ${JSON.stringify(uOrder)}`, metadata: { orderId, driverId } });
    return Response.json({ success: false, reason: 'race_condition_or_invalid_state', db_result: uOrder });
  }

  const uDriver = await b44.entities.Driver.updateMany(
    { id: driverId },
    { $set: { status: 'disponible', dispatch_status: 'normal', reserved_order_id: null, reservation_token: null, manual_reservation_token: null, active_order_id: null } }
  );

  if (uDriver.updated !== 1) {
    await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_PARTIAL_FAILURE', user_type: 'sistema', user_name: 'finishRide', details: `Driver update failed, raw: ${JSON.stringify(uDriver)}`, metadata: { orderId, driverId } });
    return Response.json({ success: false, reason: 'PARTIAL_STATE_REQUIRES_RECONCILIATION', db_result: uDriver });
  }

  await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_COMMITTED', user_type: 'sistema', user_name: 'finishRide', details: 'Finished successfully', metadata: { orderId, driverId } });
  return Response.json({ success: true });
});