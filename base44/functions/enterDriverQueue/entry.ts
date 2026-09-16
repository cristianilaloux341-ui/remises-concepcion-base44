import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { verifyRequestAuth } from '../../shared/security.ts';
import { getNextQueueTailAt, getNextQueuePosition, compactQueueUnlocked, withQueueLock } from '../../shared/queueOrder.ts';

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

  // La entrada y el sellado autoritativo se hacen dentro del MISMO lock de base.
  // Antes se escribía primero current_base con queue_position/authority en null y
  // recién después se intentaba sellar. Si el segundo paso perdía una carrera, el
  // móvil quedaba visible en la base pero fuera de la cola real (caso móvil 60).
  const placed = await withQueueLock(b44, baseName, async () => {
    const freshRows = await b44.entities.Driver.filter({ id: driverId });
    const fresh = freshRows?.[0];
    if (!fresh) return { success:false, reason:'driver_not_found' };

    const freshPos = Number(fresh?.queue_position);
    const freshAlreadyAuthoritative = fresh?.status === 'disponible' &&
      (fresh?.dispatch_status == null || fresh.dispatch_status === 'normal') &&
      !fresh?.reserved_order_id && !fresh?.active_order_id && !fresh?.active_ride_id &&
      fresh?.queue_authoritative_base === baseName && Number.isFinite(freshPos) && freshPos > 0;

    if (freshAlreadyAuthoritative) {
      if (fresh.current_base !== baseName) {
        await b44.entities.Driver.updateMany(
          { id:driverId, status:'disponible', queue_authoritative_base:baseName, queue_position:fresh.queue_position },
          { $set:{ current_base:baseName } }
        );
      }
      return {
        success:true, idempotent:true,
        queueEnteredAt:fresh.queue_authoritative_at || fresh.queue_entered_at || null,
        position:freshPos,
        authorityMarker:fresh.queue_authority_marker ?? freshPos
      };
    }

    // Primero dejar 1..N a los que YA estaban. La nueva entrada siempre queda N+1.
    await compactQueueUnlocked(b44, baseName);
    const queueEnteredAt = await getNextQueueTailAt(b44, baseName, driverId);
    const position = await getNextQueuePosition(b44, baseName, driverId);
    const authorityMarker = position;
    const sealed = await b44.entities.Driver.updateMany(
      {
        id:driverId,
        status:'disponible',
        dispatch_status:'normal',
        reserved_order_id:null,
        active_order_id:null,
        active_ride_id:null,
        reservation_token:null,
        manual_reservation_token:null,
        driver_reservation_key:null
      },
      { $set:{
        current_base:baseName,
        queue_entered_at:queueEnteredAt,
        queue_authoritative_base:baseName,
        queue_authoritative_at:queueEnteredAt,
        queue_authority_marker:authorityMarker,
        queue_position:position,
        queue_left_at:null
      } }
    );
    const sealedCount = sealed?.updated ?? sealed?.modifiedCount ?? sealed?.matchedCount ?? 0;
    if (sealedCount !== 1) return { success:false, reason:'driver_busy_or_state_changed' };
    return { success:true, queueEnteredAt, position, authorityMarker };
  });

  if (!placed?.success) {
    const status = placed?.reason === 'driver_not_found' ? 404 : 409;
    return Response.json({ success:false, reason:placed?.reason || 'queue_entry_failed' }, { status });
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
