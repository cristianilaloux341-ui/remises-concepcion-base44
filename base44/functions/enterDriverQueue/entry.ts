import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { verifyRequestAuth } from '../../shared/security.ts';
import { compactQueue, getNextQueuePosition, withQueueLock } from '../../shared/queueOrder.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const payload = await req.json();
  const driverId = String(payload?.driverId || '').trim();
  const baseName = String(payload?.baseName || '').trim();

  if (!driverId || !baseName) {
    return Response.json({ success: false, reason: 'missing_params' }, { status: 400 });
  }

  if (!(await verifyRequestAuth(b44, payload, { allowOperator: true, allowDriverId: driverId }))) {
    return Response.json({ success: false, reason: 'unauthorized' }, { status: 401 });
  }

  const currentRows = await b44.entities.Driver.filter({ id: driverId });
  const current = currentRows?.[0];
  if (!current) return Response.json({ success: false, reason: 'driver_not_found' }, { status: 404 });

  if (current.bloqueo_post_aceptacion_hasta && Number(current.bloqueo_post_aceptacion_hasta) > Date.now()) {
    return Response.json({ success: false, reason: 'driver_blocked_post_acceptance' }, { status: 403 });
  }

  const currentPos = Number(current?.queue_position);
  const alreadyAuthoritative = current?.status === 'disponible' &&
    (current?.dispatch_status == null || current.dispatch_status === 'normal') &&
    !current?.reserved_order_id && !current?.active_ride_id && !current?.next_order_id &&
    current?.queue_authoritative_base === baseName && Number.isFinite(currentPos) && currentPos > 0;

  if (alreadyAuthoritative) {
    const currentMarker = Number(current?.queue_authority_marker);
    if (!Number.isFinite(currentMarker) || currentMarker !== currentPos) {
      await b44.entities.Driver.updateMany(
        {
          id: driverId,
          status: 'disponible',
          queue_authoritative_base: baseName,
          queue_position: current.queue_position,
          reserved_order_id: null,
          active_ride_id: null,
          next_order_id: null
        },
        { $set: {  queue_authority_marker: currentPos, queue_left_at: null } }
      );
    }
    return Response.json({
      success: true,
      idempotent: true,
      baseName,
      queueEnteredAt: current.queue_entered_at || null,
      position: currentPos,
      authorityMarker: currentPos,
      serverNow: new Date().toISOString()
    });
  }

  // La entrada y el sellado autoritativo se hacen dentro del MISMO lock de base.
  // La entrada y el sellado autoritativo se realizan dentro del mismo lock de base.
  const placed = await withQueueLock(b44, baseName, async () => {
    const freshRows = await b44.entities.Driver.filter({ id: driverId });
    const fresh = freshRows?.[0];
    if (!fresh) return { success:false, reason:'driver_not_found' };

    const previousBase = fresh?.queue_authoritative_base || null;
    const freshPos = Number(fresh?.queue_position);
    const freshAlreadyAuthoritative = fresh?.status === 'disponible' &&
      (fresh?.dispatch_status == null || fresh.dispatch_status === 'normal') &&
      !fresh?.reserved_order_id && !fresh?.active_ride_id && !fresh?.active_ride_id && !fresh?.next_order_id &&
      fresh?.queue_authoritative_base === baseName && Number.isFinite(freshPos) && freshPos > 0;

    if (freshAlreadyAuthoritative) {
      const freshMarker = Number(fresh?.queue_authority_marker);
      if (!Number.isFinite(freshMarker) || freshMarker !== freshPos) {
        await b44.entities.Driver.updateMany(
          {
            id:driverId,
            status:'disponible',
            queue_authoritative_base:baseName,
            queue_position:fresh.queue_position,
            reserved_order_id:null,
            active_ride_id:null,
            active_ride_id:null,
            next_order_id:null
          },
          { $set:{  queue_authority_marker:freshPos, queue_left_at:null } }
        );
      }
      return {
        success:true, idempotent:true,
        queueEnteredAt:fresh.queue_entered_at || null,
        position:freshPos,
        authorityMarker:freshPos,
        previousBase
      };
    }

    const position = await getNextQueuePosition(b44, baseName, driverId);
    const queueEnteredAt = new Date().toISOString();
    const authorityMarker = position;
    const sealed = await b44.entities.Driver.updateMany(
      {
        id:driverId,
        status:'disponible',
        dispatch_status:'normal',
        reserved_order_id:null,
        active_ride_id:null,
        active_ride_id:null,
        next_order_id:null,
        reservation_token:null,
        driver_reservation_key:null
      },
      { $set:{
        
        queue_entered_at:queueEnteredAt,
        queue_authoritative_base:baseName,
        queue_authority_marker:authorityMarker,
        queue_position:position,
        queue_left_at:null
      } }
    );
    const sealedCount = sealed?.updated ?? sealed?.modifiedCount ?? sealed?.matchedCount ?? 0;
    if (sealedCount !== 1) return { success:false, reason:'driver_busy_or_state_changed' };
    return { success:true, queueEnteredAt, position, authorityMarker, previousBase };
  });

  if (!placed?.success) {
    const status = placed?.reason === 'driver_not_found' ? 404 : 409;
    return Response.json({ success:false, reason:placed?.reason || 'queue_entry_failed' }, { status });
  }

  if (placed.previousBase && placed.previousBase !== baseName) {
    await compactQueue(b44, placed.previousBase).catch(() => null);
  }

  return Response.json({
    success:true,
    idempotent:Boolean(placed.idempotent),
    baseName,
    queueEnteredAt:placed.queueEnteredAt,
    position:placed.position,
    authorityMarker:placed.authorityMarker,
    serverNow:new Date().toISOString()
  });
});