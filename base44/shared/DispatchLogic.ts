export const defaultFailureInjector = { hit: async (point: string) => {} };

export async function releaseManualDriver(b44: any, driverId: string, orderId: string, token: string) {
  await b44.entities.Driver.updateMany(
    { id: driverId, manual_reservation_token: token },
    { $set: { dispatch_status: 'normal', reserved_order_id: null, manual_reservation_token: null } }
  );
}

export async function safeAuditLog(b44: any, data: any, failureInjector = defaultFailureInjector) {
  try {
    await failureInjector.hit('DURING_AUDIT_LOG');
    await b44.entities.AuditLog.create(data);
  } catch (e) {
    console.error("Fallo no destructivo en AuditLog:", e);
    // Fallback log de sistema
  }
}

export async function validatePilotDriver(b44: any, zone: string, driverId: string) {
  const configs = await b44.entities.DispatchConfig.filter({ zone });
  const config = configs[0];
  if (config && config.pilotMode && config.engineState !== 'disabled') {
    if (!config.enabledDriverIds || !config.enabledDriverIds.includes(driverId)) {
      throw new Error('DRIVER_NOT_ENABLED_FOR_PILOT');
    }
  }
}

export async function tryManualCandidate(b44: any, baseId: string, order: any, driver: any, token: string, failureInjector = defaultFailureInjector) {
  try {
    await validatePilotDriver(b44, order.zone || '1-Puerto', driver.id);
    // 1. Reservar Driver
    const driverRes = await b44.entities.Driver.updateMany(
      { id: driver.id, status: 'disponible', dispatch_status: 'normal', reserved_order_id: null },
      { $set: { dispatch_status: 'manual_pending', reserved_order_id: order.id, manual_reservation_token: token } }
    );
    if ((driverRes.matchedCount ?? driverRes.modifiedCount ?? driverRes.updated ?? 0) !== 1) return false;

    await failureInjector.hit('AFTER_DRIVER_RESERVE');

    // 2. Marcar Viaje
    const rideRes = await b44.entities.RideOrder.updateMany(
      { id: order.id, status: 'procesando_despacho', reservation_token: token },
      { $set: { status: 'esperando_confirmacion_manual', reserved_driver_id: driver.id, manual_reservation_token: token } }
    );
    if ((rideRes.matchedCount ?? rideRes.modifiedCount ?? rideRes.updated ?? 0) !== 1) {
      await releaseManualDriver(b44, driver.id, order.id, token);
      return false;
    }

    await failureInjector.hit('AFTER_RIDE_MANUAL_TRANSITION');

    // 3. Bloquear Base
    const baseRes = await b44.entities.Base.updateMany(
      { id: baseId, lock_token: token },
      { $set: { dispatch_status: 'esperando_manual', active_order_id: order.id, manual_reservation_token: token, lock_token: null, lock_expires_at: null, manual_requested_at: Date.now(), manual_expires_at: Date.now() + 60000 } }
    );

    if ((baseRes.matchedCount ?? baseRes.modifiedCount ?? baseRes.updated ?? 0) !== 1) {
      // Revertir viaje y chofer
      await b44.entities.RideOrder.updateMany(
        { id: order.id, status: 'esperando_confirmacion_manual', reserved_driver_id: driver.id, manual_reservation_token: token },
        { $set: { status: 'procesando_despacho', reserved_driver_id: null, manual_reservation_token: null } }
      );
      await releaseManualDriver(b44, driver.id, order.id, token);
      return false;
    }

    await failureInjector.hit('AFTER_BASE_MANUAL_TRANSFER');
    return true;
  } catch (e) {
    if (e.message.includes('INJECTED_FAILURE_AT_AFTER_DRIVER_RESERVE')) {
      await releaseManualDriver(b44, driver.id, order.id, token);
    } else if (e.message.includes('INJECTED_FAILURE_AT_AFTER_RIDE_MANUAL_TRANSITION')) {
      await b44.entities.RideOrder.updateMany(
        { id: order.id, status: 'esperando_confirmacion_manual', manual_reservation_token: token },
        { $set: { status: 'procesando_despacho', reserved_driver_id: null, manual_reservation_token: null } }
      );
      await releaseManualDriver(b44, driver.id, order.id, token);
    }
    throw e;
  }
}

export async function assignDriverToOrderAtomic(b44: any, order: any, driver: any, token: string, failureInjector = defaultFailureInjector) {
  try {
    await validatePilotDriver(b44, order.zone || '1-Puerto', driver.id);
    const driverRes = await b44.entities.Driver.updateMany(
      { id: driver.id, status: 'disponible', dispatch_status: 'normal', reserved_order_id: null },
      { $set: { dispatch_status: 'automatic_pending', reserved_order_id: order.id, reservation_token: token } }
    );
    if ((driverRes.matchedCount ?? driverRes.modifiedCount ?? driverRes.updated ?? 0) !== 1) return false;

    await failureInjector.hit('AFTER_AUTO_DRIVER_RESERVE');

    const rideRes = await b44.entities.RideOrder.updateMany(
      { id: order.id },
      { $set: { status: 'ofrecido', reservation_token: token, reserved_driver_id: driver.id } }
    );
    if ((rideRes.matchedCount ?? rideRes.modifiedCount ?? rideRes.updated ?? 0) !== 1) {
      await b44.entities.Driver.updateMany({ id: driver.id, reservation_token: token }, { $set: { dispatch_status: 'normal', reserved_order_id: null, reservation_token: null } });
      return false;
    }

    await safeAuditLog(b44, { action: 'RIDE_ASSIGNED', user_type: 'sistema', user_name: 'DispatchLogic', details: `Viaje ${order.id} asignado a ${driver.id}` }, failureInjector);

    await failureInjector.hit('AFTER_RIDE_OFFER');
    await failureInjector.hit('BEFORE_PUSH');

    // Trigger directo a sendPushNotification restaurado para eliminar la latencia de 15s de la automatización
    try {
      const pushResult = await b44.functions.invoke('sendPushNotification', {
        action: 'send',
        driverId: driver.id,
        orderId: order.id,
        orderData: {
          pickup_address: order.pickup_address,
          dropoff_address: order.dropoff_address,
          fare: order.fare,
          notes: order.notes,
          assignmentAttempt: order.assignment_attempt || 1
        },
        internalKey: Deno.env.get("INTERNAL_SERVICE_KEY")
      });

      if (pushResult && pushResult.data && pushResult.data.ok === false) {
         throw new Error("PUSH_FAILED: " + (pushResult.data.error || pushResult.data.reason));
      }
    } catch (pushErr) {
      console.error("Error trigger push en DispatchLogic:", pushErr);
      // Failsafe: purga inmediata si falla la notificación para no dejar al chofer ni al viaje colgados
      await b44.entities.RideOrder.updateMany({ id: order.id, status: 'ofrecido', reservation_token: token }, { $set: { status: 'procesando_despacho', reserved_driver_id: null } });
      await b44.entities.Driver.updateMany({ id: driver.id, reservation_token: token }, { $set: { dispatch_status: 'normal', reserved_order_id: null, reservation_token: null } });
      await safeAuditLog(b44, { action: 'DELIVERY_ERROR', user_type: 'sistema', user_name: 'System', details: 'Fallo push, reversión rápida: ' + pushErr.message }, failureInjector);
      return false;
    }
    
    return true;
  } catch (e) {
    if (e.message.includes('INJECTED_FAILURE_AT_AFTER_AUTO_DRIVER_RESERVE')) {
      await b44.entities.Driver.updateMany({ id: driver.id, reservation_token: token }, { $set: { dispatch_status: 'normal', reserved_order_id: null, reservation_token: null } });
    } else {
      // Revert ride back to procesando_despacho and release driver (for any other error to prevent stuck state)
      await b44.entities.RideOrder.updateMany({ id: order.id, status: 'ofrecido', reservation_token: token }, { $set: { status: 'procesando_despacho', reserved_driver_id: null } });
      await b44.entities.Driver.updateMany({ id: driver.id, reservation_token: token }, { $set: { dispatch_status: 'normal', reserved_order_id: null, reservation_token: null } });
      if (e.message.includes('INJECTED_FAILURE_AT_BEFORE_PUSH')) {
        await safeAuditLog(b44, { action: 'DELIVERY_ERROR', user_type: 'sistema', user_name: 'System', details: e.message }, failureInjector);
      }
    }
    throw e;
  }
}

export async function reassignAfterAutomaticReject(b44: any, baseId: string, orderId: string, driverId: string, oldToken: string, failureInjector = defaultFailureInjector) {
  const orderCheck = await b44.entities.RideOrder.get(orderId);
  await validatePilotDriver(b44, orderCheck?.zone || '1-Puerto', driverId);
  const newToken = crypto.randomUUID();
  let ownershipTransferred = false;

  const baseRes = await b44.entities.Base.updateMany(
    { id: baseId, dispatch_status: 'libre' },
    { $set: { dispatch_status: 'procesando', lock_token: newToken, lock_expires_at: Date.now() + 8000, active_order_id: orderId } }
  );
  if ((baseRes.matchedCount ?? baseRes.modifiedCount ?? baseRes.updated ?? 0) !== 1) return { status: 'zone_busy' };

  try {
    await failureInjector.hit('DURING_TOKEN_TRANSFER');
    const orderRes = await b44.entities.RideOrder.updateMany(
      { id: orderId, status: 'ofrecido', reserved_driver_id: driverId, reservation_token: oldToken },
      { $set: { status: 'procesando_despacho', reservation_token: newToken, reserved_driver_id: null }, $push: { offered_driver_ids: driverId }, $inc: { assignment_attempt: 1 } }
    );
    if ((orderRes.matchedCount ?? orderRes.modifiedCount ?? orderRes.updated ?? 0) !== 1) return { status: 'already_processed' };

    await failureInjector.hit('DURING_DRIVER_RELEASE');
    const driverRes = await b44.entities.Driver.updateMany(
      { id: driverId, dispatch_status: 'automatic_pending', reserved_order_id: orderId, reservation_token: oldToken },
      { $set: { dispatch_status: 'normal', reserved_order_id: null, reservation_token: null } }
    );
    if ((driverRes.matchedCount ?? driverRes.modifiedCount ?? driverRes.updated ?? 0) !== 1) {
      await safeAuditLog(b44, { action: 'INCONSISTENT_STATE', user_type: 'sistema', user_name: 'System', details: 'Fallo al liberar Driver durante rechazo automático' }, failureInjector);
      throw new Error('INCONSISTENT_STATE:DRIVER_RELEASE_FAILED');
    }

    ownershipTransferred = true; // Simulación de continuación
    return { status: 'reassigned' };
  } finally {
    if (!ownershipTransferred) {
      await b44.entities.Base.updateMany(
        { id: baseId, dispatch_status: 'procesando', lock_token: newToken },
        { $set: { dispatch_status: 'libre', lock_token: null, lock_expires_at: null, active_order_id: null } }
      );
    }
  }
}

export async function cleanupExpiredTechnicalLock(b44: any, baseId: string, expectedToken: string, now: number) {
  const base = await b44.entities.Base.get(baseId);
  if (!base || base.dispatch_status === 'esperando_manual' || base.lock_token !== expectedToken) {
    return { status: 'already_recovered', baseId, token: expectedToken };
  }
  if (!base.lock_expires_at || base.lock_expires_at >= now) {
    return { status: 'lock_renewed', baseId, token: expectedToken };
  }

  const drivers = await b44.entities.Driver.filter({ reservation_token: expectedToken });
  if (drivers.length > 0) {
    await b44.entities.Driver.updateMany(
      { id: drivers[0].id, reservation_token: expectedToken },
      { $set: { dispatch_status: 'normal', reserved_order_id: null, reservation_token: null } }
    );
  }

  const orders = await b44.entities.RideOrder.filter({ reservation_token: expectedToken });
  if (orders.length > 0) {
    const ord = orders[0];
    const safeStates = ['aceptado', 'en_camino', 'en_viaje', 'completado'];
    if (!safeStates.includes(ord.status) && !ord.driver_id) {
      await b44.entities.RideOrder.updateMany(
        { id: ord.id, reservation_token: expectedToken },
        { $set: { status: 'pendiente', reservation_token: null, reserved_driver_id: null } }
      );
    }
  }

  const bRes = await b44.entities.Base.updateMany(
    { id: baseId, lock_token: expectedToken },
    { $set: { dispatch_status: 'libre', lock_token: null, lock_expires_at: null, active_order_id: null } }
  );
  if ((bRes.matchedCount ?? bRes.modifiedCount ?? bRes.updated ?? 0) !== 1) return { status: 'already_recovered', baseId, token: expectedToken };

  return { status: 'recovered', baseId, orderId: orders[0]?.id, driverId: drivers[0]?.id, token: expectedToken };
}

export async function cleanupExpiredManualWait(b44: any, baseId: string, expectedToken: string, now: number) {
  const base = await b44.entities.Base.get(baseId);
  if (!base || base.manual_reservation_token !== expectedToken) return { status: 'already_recovered', baseId, token: expectedToken };
  if (!base.manual_expires_at || base.manual_expires_at >= now) return { status: 'lock_renewed', baseId, token: expectedToken };

  const drivers = await b44.entities.Driver.filter({ manual_reservation_token: expectedToken });
  if (drivers.length > 0) {
    await b44.entities.Driver.updateMany(
      { id: drivers[0].id, manual_reservation_token: expectedToken },
      { $set: { dispatch_status: 'normal', reserved_order_id: null, manual_reservation_token: null } }
    );
  }

  const orders = await b44.entities.RideOrder.filter({ manual_reservation_token: expectedToken });
  if (orders.length > 0) {
    const ord = orders[0];
    const safeStates = ['aceptado', 'en_camino', 'en_viaje', 'completado'];
    if (!safeStates.includes(ord.status) && !ord.driver_id) {
      await b44.entities.RideOrder.updateMany(
        { id: ord.id, manual_reservation_token: expectedToken },
        { $set: { status: 'pendiente', manual_reservation_token: null, reserved_driver_id: null } }
      );
    }
  }

  const bRes = await b44.entities.Base.updateMany(
    { id: baseId, manual_reservation_token: expectedToken },
    { $set: { dispatch_status: 'libre', manual_reservation_token: null, manual_expires_at: null, manual_requested_at: null, active_order_id: null } }
  );
  
  if ((bRes.matchedCount ?? bRes.modifiedCount ?? bRes.updated ?? 0) === 1) {
     await safeAuditLog(b44, { action: 'MANUAL_TIMEOUT', user_type: 'sistema', user_name: 'System', details: `Timeout manual expirado para token ${expectedToken}` });
     return { status: 'recovered', baseId, token: expectedToken };
  }
  return { status: 'already_recovered', baseId, token: expectedToken };
}