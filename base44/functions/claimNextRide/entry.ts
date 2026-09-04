import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

const changed = (result: any) =>
  (result?.matchedCount ?? result?.modifiedCount ?? result?.updated ?? 0) === 1;

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const payload = await req.json();
  const { action = 'claim', orderId, driverId, asNext = false } = payload;

  if (!driverId || !(await verifyRequestAuth(b44, payload, { allowDriverId: driverId }))) {
    return Response.json({ success: false, reason: 'unauthorized' }, { status: 401 });
  }

  try {
    const driver = await b44.entities.Driver.get(driverId);
    if (!driver) return Response.json({ success: false, reason: 'driver_not_found' });
    if (driver.status === 'no_disponible') {
      return Response.json({ success: false, reason: 'driver_off_service' });
    }

    if (action === 'promote') {
      const nextOrderId = driver.next_order_id;
      const token = driver.next_order_token;
      if (!nextOrderId || !token) {
        return Response.json({ success: true, promoted: false, reason: 'no_next_order' });
      }

      const order = await b44.entities.RideOrder.get(nextOrderId).catch(() => null);
      if (!order || order.status !== 'preasignado_proximo' ||
          order.preassigned_driver_id !== driverId || order.preassignment_token !== token) {
        await b44.entities.Driver.updateMany(
          { id: driverId, next_order_id: nextOrderId, next_order_token: token },
          { $set: { next_order_id: null, next_order_token: null } }
        );
        return Response.json({ success: true, promoted: false, reason: 'next_order_not_available' });
      }

      if (driver.active_order_id || driver.active_ride_id || driver.reserved_order_id) {
        return Response.json({ success: false, promoted: false, reason: 'current_ride_not_finished' });
      }

      const orderRes = await b44.entities.RideOrder.updateMany(
        {
          id: nextOrderId,
          status: 'preasignado_proximo',
          preassigned_driver_id: driverId,
          preassignment_token: token
        },
        {
          $set: {
            status: 'aceptado',
            driver_id: driverId,
            driver_name: driver.name,
            assigned_base: driver.current_base || order.assigned_base || order.zone || null,
            preassigned_driver_id: null,
            preassignment_token: null,
            preassigned_at: null
          }
        }
      );
      if (!changed(orderRes)) {
        return Response.json({ success: false, promoted: false, reason: 'order_changed' });
      }

      const driverRes = await b44.entities.Driver.updateMany(
        {
          id: driverId,
          next_order_id: nextOrderId,
          next_order_token: token,
          $or: [
            { active_order_id: null },
            { active_order_id: { $exists: false } }
          ]
        },
        {
          $set: {
            status: 'en_viaje',
            dispatch_status: 'normal',
            active_order_id: nextOrderId,
            active_ride_id: nextOrderId,
            next_order_id: null,
            next_order_token: null
          }
        }
      );

      if (!changed(driverRes)) {
        await b44.entities.RideOrder.updateMany(
          { id: nextOrderId, status: 'aceptado', driver_id: driverId },
          { $set: {
            status: 'preasignado_proximo',
            driver_id: null,
            driver_name: null,
            preassigned_driver_id: driverId,
            preassignment_token: token,
            preassigned_at: order.preassigned_at || new Date().toISOString()
          } }
        );
        return Response.json({ success: false, promoted: false, reason: 'driver_busy' });
      }

      await b44.entities.AuditLog.create({
        action: 'NEXT_RIDE_PROMOTED',
        user_type: 'chofer',
        user_name: driver.name || driverId,
        details: `Próximo viaje ${nextOrderId} promovido sin alterar el viaje anterior`,
        metadata: { orderId: nextOrderId, driverId }
      }).catch(() => {});

      return Response.json({ success: true, promoted: true, orderId: nextOrderId });
    }

    if (!orderId) return Response.json({ success: false, reason: 'missing_order_id' });
    const order = await b44.entities.RideOrder.get(orderId);
    if (!order || order.status !== 'pendiente' || order.driver_id || order.reserved_driver_id ||
        order.preassigned_driver_id) {
      return Response.json({ success: false, reason: 'already_taken' });
    }

    const token = crypto.randomUUID();
    const hasCurrentRide = !!(
      driver.active_order_id || driver.active_ride_id || driver.reserved_order_id ||
      driver.status === 'en_viaje'
    );
    const queueAsNext = = asNext === true || hasCurrentRide;

    if (queueAsNext) {
      if (driver.next_order_id) {
        return Response.json({ success: false, reason: 'driver_already_has_next' });
      }

      const driverRes = await b44.entities.Driver.updateMany(
        {
          id: driverId,
          status: { $ne: 'no_disponible' },
          $or: [
            { next_order_id: null },
            { next_order_id: { $exists: false } }
          ]
        },
        { $set: { next_order_id: orderId, next_order_token: token } }
      );
      if (!changed(driverRes)) {
        return Response.json({ success: false, reason: 'driver_already_has_next' });
      }

      const orderRes = await b44.entities.RideOrder.updateMany(
        {
          id: orderId,
          status: 'pendiente',
          $or: [
            { preassigned_driver_id: null },
            { preassigned_driver_id: { $exists: false } }
          ]
        },
        {
          $set: {
            status: 'preasignado_proximo',
            preassigned_driver_id: driverId,
            preassignment_token: token,
            preassigned_at: new Date().toISOString(),
            assigned_base: driver.current_base || order.zone || null
          }
        }
      );

      if (!changed(orderRes)) {
        await b44.entities.Driver.updateMany(
          { id: driverId, next_order_id: orderId, next_order_token: token },
          { $set: { next_order_id: null, next_order_token: null } }
        );
        return Response.json({ success: false, reason: 'already_taken' });
      }

      await b44.entities.AuditLog.create({
        action: 'NEXT_RIDE_CLAIMED',
        user_type: 'chofer',
        user_name: driver.name || driverId,
        details: `Tomó ${orderId} como próximo viaje`,
        metadata: { orderId, driverId }
      }).catch(() => {});

      return Response.json({ success: true, claimed: true, mode: 'next', orderId });
    }

    const driverRes = await b44.entities.Driver.updateMany(
      {
        id: driverId,
        status: 'disponible',
        $or: [
          { active_order_id: null },
          { active_order_id: { $exists: false } }
        ],
        $and: [
          { $or: [{ active_ride_id: null }, { active_ride_id: { $exists: false } }] },
          { $or: [{ reserved_order_id: null }, { reserved_order_id: { $exists: false } }] },
          { $or: [{ next_order_id: null }, { next_order_id: { $exists: false } }] }
        ]
      },
      {
        $set: {
          status: 'en_viaje',
          dispatch_status: 'normal',
          active_order_id: orderId,
          active_ride_id: orderId
        }
      }
    );
    if (!changed(driverRes)) {
      return Response.json({ success: false, reason: 'driver_busy' });
    }

    const orderRes = await b44.entities.RideOrder.updateMany(
      { id: orderId, status: 'pendiente' },
      {
        $set: {
          status: 'aceptado',
          driver_id: driverId,
          driver_name: driver.name,
          assigned_base: driver.current_base || order.zone || null
        }
      }
    );
    if (!changed(orderRes)) {
      await b44.entities.Driver.updateMany(
        { id: driverId, active_order_id: orderId, active_ride_id: orderId },
        { $set: { status: 'disponible', active_order_id: null, active_ride_id: null } }
      );
      return Response.json({ success: false, reason: 'already_taken' });
    }

    await b44.entities.AuditLog.create({
      action: 'PENDING_RIDE_CLAIMED',
      user_type: 'chofer',
      user_name: driver.name || driverId,
      details: `Tomó el pasaje pendiente ${orderId}`,
      metadata: { orderId, driverId }
    }).catch(() => {});

    return Response.json({ success: true, claimed: true, mode: 'current', orderId });
  } catch (error) {
    console.error('claimNextRide error', error);
    return Response.json({ success: false, reason: 'server_error', error: error.message }, { status: 500 });
  }
});
