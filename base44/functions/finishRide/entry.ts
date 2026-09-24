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
  if (!(await verifyRequestAuth(b44, payload, { allowDriverId: driverId, allowOperator: true }))) {
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

  const promoteConfirmedNextRide = async () => {
    let promotedNextOrderId:any = null;
    const fresh = await b44.entities.Driver.get(driverId).catch(()=>null);
    const nextOrderId = fresh?.next_order_id;
    const nextToken = fresh?.next_order_token;
    if (!nextOrderId || !nextToken) return null;

    const next = await b44.entities.RideOrder.get(nextOrderId).catch(()=>null);
    if (!next || next.status !== 'preasignado_proximo' ||
        next.preassigned_driver_id !== driverId || next.preassignment_token !== nextToken) return null;

    const orderPromote = await b44.entities.RideOrder.updateMany(
      {id:nextOrderId,status:'preasignado_proximo',preassigned_driver_id:driverId,preassignment_token:nextToken},
      {$set:{status:'aceptado',driver_id:driverId,driver_name:fresh.name,
             preassigned_driver_id:null,preassignment_token:null,preassigned_at:null}}
    );
    if (mutationCount(orderPromote) !== 1) return null;

    const driverPromote = await b44.entities.Driver.updateMany(
      {id:driverId,next_order_id:nextOrderId,next_order_token:nextToken,
       $and:[
         {$or:[{active_ride_id:null},{active_ride_id:{$exists:false}}]},
         {$or:[{active_ride_id:null},{active_ride_id:{$exists:false}}]},
         {$or:[{reserved_order_id:null},{reserved_order_id:{$exists:false}}]}
       ]},
      {$set:{status:'en_viaje',dispatch_status:'normal',active_ride_id:nextOrderId,
             active_ride_id:nextOrderId,next_order_id:null,next_order_token:null}}
    );
    if (mutationCount(driverPromote) === 1) {
      promotedNextOrderId = nextOrderId;
      await b44.entities.AuditLog.create({
        action:'NEXT_RIDE_PROMOTED_BACKEND',user_type:'sistema',user_name:'finishRide',
        details:`Segundo pasaje ${nextOrderId} promovido al finalizar ${orderId}`,
        metadata:{orderId:nextOrderId,previousOrderId:orderId,driverId}
      }).catch(()=>{});
      return promotedNextOrderId;
    }

    const rollbackNext = await b44.entities.RideOrder.updateMany(
      {id:nextOrderId,status:'aceptado',driver_id:driverId,
       $or:[{preassigned_driver_id:null},{preassigned_driver_id:{$exists:false}}]},
      {$set:{status:'preasignado_proximo',driver_id:driverId,driver_name:fresh.name,
             preassigned_driver_id:driverId,preassignment_token:nextToken,
             preassigned_at:next.preassigned_at || new Date().toISOString()}}
    ).catch(()=>null);
    if (mutationCount(rollbackNext) !== 1) {
      await b44.entities.AuditLog.create({
        action:'NEXT_RIDE_PROMOTION_ROLLBACK_FAILED',user_type:'sistema',user_name:'finishRide',
        details:`No se pudo revertir de forma segura la promoción del segundo pasaje ${nextOrderId}.`,
        metadata:{orderId:nextOrderId,previousOrderId:orderId,driverId,nextToken}
      }).catch(()=>{});
      throw new Error(`NEXT_RIDE_PROMOTION_ROLLBACK_FAILED:${nextOrderId}`);
    }
    return null;
  };

  const checkAndRepairDriver = async (currentDriver) => {
    // Releer antes de decidir: finishRide compite con workflows que pueden limpiar
    // el Driver milisegundos después de completar el RideOrder. Un snapshot viejo
    // no debe convertir un cierre correcto en PARTIAL_FAILURE.
    const freshDriver = await b44.entities.Driver.get(driverId).catch(() => currentDriver);
    const isClean = (d:any) => Boolean(
      d &&
      ['disponible', 'no_disponible'].includes(d.status) &&
      !d.active_ride_id &&
      !d.active_ride_id &&
      !d.reserved_order_id &&
      !d.reservation_token &&
      !d.next_order_id &&
      !d.next_order_token
    );

    if (isClean(freshDriver)) {
      await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_ALREADY_PROCESSED', user_type: 'sistema', user_name: 'finishRide', details: 'Already completed perfectly', metadata: { orderId, driverId } });
      return Response.json({ success: true, idempotent: true, reason: 'ALREADY_PROCESSED' });
    }

    const fixRes = await b44.entities.Driver.updateMany(
      { id: driverId, next_order_id: freshDriver?.next_order_id ?? null, next_order_token: freshDriver?.next_order_token ?? null, $or: [{ reserved_order_id: orderId }, { active_ride_id: orderId }] },
      { $set: { status: 'disponible', dispatch_status: 'normal',   queue_authoritative_base: null, queue_position: null, reserved_order_id: null, reservation_token: null, driver_reservation_key: null, active_ride_id: null } }
    );
    if (mutationCount(fixRes) >= 1) {
      const promotedNextOrderId = await promoteConfirmedNextRide();
      await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_ALREADY_PROCESSED', user_type: 'sistema', user_name: 'finishRide', details: 'Repaired driver state', metadata: { orderId, driverId, promotedNextOrderId } });
      return Response.json({ success: true, idempotent: true, note: 'repaired_driver', reason: 'ALREADY_PROCESSED', promotedNextOrderId });
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
    // Reparación idempotente: un retry o una carrera puede encontrar el viaje ya
    // completado pero con el cierre parcialmente persistido. No reabre ni recalcula
    // el viaje; sólo completa metadatos faltantes y limpia el estado del chofer.
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
  // otro calculador al finalizar: un cambio de tarifa nunca puede alterar un viaje activo.
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
    { id: driverId, next_order_id: driver?.next_order_id ?? null, next_order_token: driver?.next_order_token ?? null, $or: [{ reserved_order_id: orderId }, { active_ride_id: orderId }] },
    { $set: { status: 'disponible', dispatch_status: 'normal',   queue_authoritative_base: null, queue_position: null, reserved_order_id: null, reservation_token: null, driver_reservation_key: null, active_ride_id: null } }
  );

  if (mutationCount(uDriver) < 1) {
    return await checkAndRepairDriver(driver);
  }

  await b44.entities.AuditLog.create({ action: 'FINISH_RIDE_COMMITTED', user_type: 'sistema', user_name: 'finishRide', details: 'Finished successfully', metadata: { orderId, driverId } });

  // El backend promueve el segundo slot confirmado; no depende de que el APK siga abierto.
  let promotedNextOrderId:any = null;
  try {
    promotedNextOrderId = await promoteConfirmedNextRide();
  } catch (promotionError) {
    console.error('Backend next ride promotion failed', promotionError);
  }

  return Response.json({ success: true, promotedNextOrderId });
});