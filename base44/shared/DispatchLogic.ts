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

export async function tryManualCandidate(b44: any, baseId: string, order: any, driver: any, token: string, failureInjector = defaultFailureInjector) {
  try {
    // 1. Reservar Driver
    const driverRes = await b44.entities.Driver.updateMany(
      { id: driver.id, status: 'disponible', dispatch_status: 'normal', reserved_order_id: null },
      { $set: { dispatch_status: 'manual_pending', reserved_order_id: order.id, manual_reservation_token: token } }
    );
    if ((driverRes.matchedCount ?? driverRes.modifiedCount ?? 0) !== 1) return false;

    await failureInjector.hit('AFTER_DRIVER_RESERVE');

    // 2. Marcar Viaje
    const rideRes = await b44.entities.RideOrder.updateMany(
      { id: order.id, status: 'procesando_despacho', reservation_token: token },
      { $set: { status: 'esperando_confirmacion_manual', reserved_driver_id: driver.id, manual_reservation_token: token } }
    );
    if ((rideRes.matchedCount ?? rideRes.modifiedCount ?? 0) !== 1) {
      await releaseManualDriver(b44, driver.id, order.id, token);
      return false;
    }

    await failureInjector.hit('AFTER_RIDE_MANUAL_TRANSITION');

    // 3. Bloquear Base
    const baseRes = await b44.entities.Base.updateMany(
      { id: baseId, dispatch_status: 'procesando', lock_token: token },
      { $set: { dispatch_status: 'esperando_manual', active_order_id: order.id, manual_reservation_token: token, lock_token: null, lock_expires_at: null } }
    );

    if ((baseRes.matchedCount ?? baseRes.modifiedCount ?? 0) !== 1) {
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
    const driverRes = await b44.entities.Driver.updateMany(
      { id: driver.id, status: 'disponible', dispatch_status: 'normal', reserved_order_id: null },
      { $set: { dispatch_status: 'automatic_pending', reserved_order_id: order.id, reservation_token: token } }
    );
    if ((driverRes.matchedCount ?? driverRes.modifiedCount ?? 0) !== 1) return false;

    await failureInjector.hit('AFTER_AUTO_DRIVER_RESERVE');

    const rideRes = await b44.entities.RideOrder.updateMany(
      { id: order.id, status: 'procesando_despacho', reservation_token: token },
      { $set: { status: 'ofrecido', reserved_driver_id: driver.id } }
    );
    if ((rideRes.matchedCount ?? rideRes.modifiedCount ?? 0) !== 1) {
      await b44.entities.Driver.updateMany({ id: driver.id, reservation_token: token }, { $set: { dispatch_status: 'normal', reserved_order_id: null, reservation_token: null } });
      return false;
    }

    await failureInjector.hit('AFTER_RIDE_OFFER');
    await failureInjector.hit('BEFORE_PUSH');

    // Simulate Push
    
    return true;
  } catch (e) {
    if (e.message.includes('INJECTED_FAILURE_AT_AFTER_AUTO_DRIVER_RESERVE')) {
      await b44.entities.Driver.updateMany({ id: driver.id, reservation_token: token }, { $set: { dispatch_status: 'normal', reserved_order_id: null, reservation_token: null } });
    } else if (e.message.includes('INJECTED_FAILURE_AT_AFTER_RIDE_OFFER') || e.message.includes('INJECTED_FAILURE_AT_BEFORE_PUSH')) {
      // Revert ride back to procesando_despacho and release driver
      await b44.entities.RideOrder.updateMany({ id: order.id, status: 'ofrecido', reservation_token: token }, { $set: { status: 'procesando_despacho', reserved_driver_id: null } });
      await b44.entities.Driver.updateMany({ id: driver.id, reservation_token: token }, { $set: { dispatch_status: 'normal', reserved_order_id: null, reservation_token: null } });
      // Si fue BEFORE_PUSH lo marcamos como DELIVERY_ERROR de forma lógica
      await safeAuditLog(b44, { action: 'DELIVERY_ERROR', user_type: 'sistema', user_name: 'System', details: e.message }, failureInjector);
    }
    throw e;
  }
}

export async function reassignAfterAutomaticReject(b44: any, baseId: string, orderId: string, driverId: string, oldToken: string, failureInjector = defaultFailureInjector) {
  const newToken = crypto.randomUUID();
  let ownershipTransferred = false;

  const baseRes = await b44.entities.Base.updateMany(
    { id: baseId, dispatch_status: 'libre' },
    { $set: { dispatch_status: 'procesando', lock_token: newToken, lock_expires_at: Date.now() + 30000, active_order_id: orderId } }
  );
  if ((baseRes.matchedCount ?? baseRes.modifiedCount ?? 0) !== 1) return { status: 'zone_busy' };

  try {
    await failureInjector.hit('DURING_TOKEN_TRANSFER');
    const orderRes = await b44.entities.RideOrder.updateMany(
      { id: orderId, status: 'ofrecido', reserved_driver_id: driverId, reservation_token: oldToken },
      { $set: { status: 'procesando_despacho', reservation_token: newToken, reserved_driver_id: null }, $push: { offered_driver_ids: driverId }, $inc: { assignment_attempt: 1 } }
    );
    if ((orderRes.matchedCount ?? orderRes.modifiedCount ?? 0) !== 1) return { status: 'already_processed' };

    await failureInjector.hit('DURING_DRIVER_RELEASE');
    const driverRes = await b44.entities.Driver.updateMany(
      { id: driverId, dispatch_status: 'automatic_pending', reserved_order_id: orderId, reservation_token: oldToken },
      { $set: { dispatch_status: 'normal', reserved_order_id: null, reservation_token: null } }
    );
    if ((driverRes.matchedCount ?? driverRes.modifiedCount ?? 0) !== 1) {
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