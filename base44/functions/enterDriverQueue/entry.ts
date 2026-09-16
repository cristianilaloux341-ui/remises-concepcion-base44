import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { verifyRequestAuth } from '../../shared/security.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const payload = await req.json();
  const driverId = String(payload?.driverId || '').trim();
  const baseName = String(payload?.baseName || '').trim();

  if (!driverId || !baseName) {
    return Response.json({ success: false, reason: 'missing_params' }, { status: 400 });
  }

  if (!(await verifyRequestAuth(b44, payload, { allowDriverId: driverId }))) {
    return Response.json({ success: false, reason: 'unauthorized' }, { status: 401 });
  }

  const currentRows = await b44.entities.Driver.filter({ id: driverId });
  const current = currentRows?.[0];
  if (!current) return Response.json({ success: false, reason: 'driver_not_found' }, { status: 404 });

  const currentPos = Number(current?.queue_position);
  const alreadyAuthoritative = current?.status === 'disponible' &&
    (current?.dispatch_status == null || current.dispatch_status === 'normal') &&
    !current?.reserved_order_id && !current?.active_order_id && !current?.active_ride_id &&
    current?.queue_authoritative_base === baseName && Number.isFinite(currentPos) && currentPos > 0;

  if (alreadyAuthoritative) {
    if (current.current_base !== baseName) {
      await b44.entities.Driver.updateMany(
        { id: driverId, status: 'disponible', queue_authoritative_base: baseName, queue_position: current.queue_position },
        { $set: { current_base: baseName } }
      );
    }
    return Response.json({
      success: true,
      idempotent: true,
      baseName,
      queueEnteredAt: current.queue_authoritative_at || current.queue_entered_at || null,
      position: currentPos,
      serverNow: new Date().toISOString()
    });
  }

  const queueEnteredAt = new Date().toISOString();
  const entered = await b44.entities.Driver.updateMany(
    {
      id: driverId,
      status: 'disponible',
      dispatch_status: 'normal',
      reserved_order_id: null,
      active_order_id: null,
      active_ride_id: null,
      reservation_token: null,
      manual_reservation_token: null,
      driver_reservation_key: null
    },
    { $set: {
      current_base: baseName,
      queue_entered_at: queueEnteredAt,
      queue_authoritative_base: null,
      queue_authoritative_at: null,
      queue_authority_marker: null,
      queue_position: null
    } }
  );

  const enteredCount = entered?.updated ?? entered?.modifiedCount ?? entered?.matchedCount ?? 0;
  if (enteredCount < 1) {
    return Response.json({ success: false, reason: 'driver_busy_or_state_changed' }, { status: 409 });
  }

  const queueRows = await b44.entities.Driver.filter({ status: 'disponible', current_base: baseName }, '-queue_entered_at', 100);
  const queue = (Array.isArray(queueRows) ? queueRows : []).filter(d =>
    !d?.reserved_order_id && !d?.active_order_id && !d?.active_ride_id
  ).sort((a, b) => {
    const ta = Date.parse(a?.queue_entered_at || '') || Number.MAX_SAFE_INTEGER;
    const tb = Date.parse(b?.queue_entered_at || '') || Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
  const position = queue.findIndex(d => d?.id === driverId) + 1;
  if (position < 1) {
    return Response.json({ success: false, reason: 'queue_snapshot_missing_driver' }, { status: 409 });
  }

  const authorityMarker = `queue:${baseName}:${queueEnteredAt}:${driverId}`;
  const sealed = await b44.entities.Driver.updateMany(
    {
      id: driverId,
      status: 'disponible',
      dispatch_status: 'normal',
      current_base: baseName,
      queue_entered_at: queueEnteredAt,
      reserved_order_id: null,
      active_order_id: null,
      active_ride_id: null,
      reservation_token: null,
      manual_reservation_token: null,
      driver_reservation_key: null
    },
    { $set: {
      queue_position: position,
      queue_authoritative_base: baseName,
      queue_authoritative_at: queueEnteredAt,
      queue_authority_marker: authorityMarker
    } }
  );

  const sealedCount = sealed?.updated ?? sealed?.modifiedCount ?? sealed?.matchedCount ?? 0;
  if (sealedCount < 1) {
    return Response.json({ success: false, reason: 'authority_seal_lost_race' }, { status: 409 });
  }

  return Response.json({
    success: true,
    baseName,
    queueEnteredAt,
    position,
    queueSize: queue.length,
    authorityMarker,
    serverNow: new Date().toISOString()
  });
});
