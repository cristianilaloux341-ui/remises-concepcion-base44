import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

const ACTIVE_STATUSES = ['aceptado', 'en_camino', 'en_viaje'];

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;

  try {
    const payload = await req.json();
    const { orderId, sessionToken, operatorName } = payload || {};

    if (!(await verifyRequestAuth(b44, { sessionToken }, { allowOperator: true }))) {
      return Response.json({ success: false, reason: 'unauthorized' }, { status: 401 });
    }
    if (!orderId) {
      return Response.json({ success: false, reason: 'missing_order_id' }, { status: 400 });
    }

    const order = await b44.entities.RideOrder.get(orderId).catch(() => null);
    if (!order) {
      return Response.json({ success: false, reason: 'order_not_found' }, { status: 404 });
    }

    if (order.status === 'completado') {
      return Response.json({ success: true, idempotent: true, reason: 'already_completed' });
    }

    if (!ACTIVE_STATUSES.includes(order.status)) {
      return Response.json({ success: false, reason: 'invalid_status', status: order.status }, { status: 409 });
    }

    const now = new Date();
    const startedAtMs = Date.parse(order.ride_started_at || '');
    const durationSeconds = Number.isFinite(startedAtMs)
      ? Math.max(0, Math.floor((now.getTime() - startedAtMs) / 1000))
      : Number(order.ride_duration_seconds || 0);
    const opKey = `MANUAL_FINISH_${order.id}_${now.getTime()}`;
    const linkedDriverId = order.driver_id || order.reserved_driver_id || null;

    const updatedOrder = await b44.entities.RideOrder.updateMany(
      {
        id: order.id,
        status: order.status,
        driver_id: order.driver_id ?? null,
        reserved_driver_id: order.reserved_driver_id ?? null
      },
      {
        $set: {
          status: 'completado',
          taximetro_iniciado: false,
          ride_finished_at: now.toISOString(),
          ride_duration_seconds: durationSeconds,
          reserved_driver_id: null,
          reservation_token: null,
          manual_reservation_token: null,
          offerExpiresAt: null,
          processingAction: null,
          processingOperationKey: null,
          processingOwnerId: null,
          processingLeaseExpiresAt: null,
          processingPhase: null,
          lastCompletedOperationKey: opKey,
          lastCompletedAction: 'FINISH',
          lastCompletedResult: 'SUCCESS',
          lastCompletedAt: now.getTime()
        }
      }
    );

    const orderMatched = updatedOrder?.matchedCount ?? updatedOrder?.modifiedCount ?? updatedOrder?.updated ?? 0;
    if (orderMatched !== 1) {
      return Response.json({ success: false, reason: 'concurrent_change' }, { status: 409 });
    }

    let driverReleased = false;
    if (linkedDriverId) {
      const released = await b44.entities.Driver.updateMany(
        {
          id: linkedDriverId,
          $or: [
            { active_order_id: order.id },
            { active_ride_id: order.id },
            { reserved_order_id: order.id }
          ]
        },
        {
          $set: {
            status: 'disponible',
            dispatch_status: 'normal',
            current_base: null,
            queue_entered_at: null,
            queue_authoritative_base: null,
            queue_authoritative_at: null,
            queue_authority_marker: null,
            queue_position: null,
            active_order_id: null,
            active_ride_id: null,
            reserved_order_id: null,
            reservation_token: null,
            manual_reservation_token: null,
            driver_reservation_key: null
          }
        }
      ).catch(() => ({ updated: 0 }));
      const driverMatched = released?.matchedCount ?? released?.modifiedCount ?? released?.updated ?? 0;
      driverReleased = driverMatched > 0;
    }

    await b44.entities.AuditLog.create({
      action: 'MANUAL_RIDE_COMPLETED',
      user_type: 'operador',
      user_name: operatorName || 'Central',
      details: `Pasaje ${order.id} marcado como completado manualmente desde Central`,
      metadata: {
        orderId: order.id,
        previousStatus: order.status,
        driverId: linkedDriverId,
        driverReleased,
        source: 'central_manual_finish'
      }
    }).catch(() => {});

    return Response.json({ success: true, orderId: order.id, driverId: linkedDriverId, driverReleased });
  } catch (error) {
    console.error('manualCompleteRide error', error);
    return Response.json({ success: false, reason: error?.message || 'error' }, { status: 500 });
  }
});