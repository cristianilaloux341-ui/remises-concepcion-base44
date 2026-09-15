import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { verifyRequestAuth } from '../../shared/security.ts';
import { getBaseQueue } from '../../shared/queueOrder.ts';
import { signReorderToken } from '../../shared/reorderToken.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const payload = await req.json();
  const { driverId, baseName, newPosition, sessionToken, internalKey } = payload;

  if (!(await verifyRequestAuth(b44, payload, { allowOperator: true }))) {
    return Response.json({ success:false, reason:'unauthorized' }, { status: 401 });
  }
  if (!driverId || !baseName || newPosition == null) {
    return Response.json({ success:false, reason:'missing_params' }, { status: 400 });
  }

  const freshDrivers = await b44.entities.Driver.filter({ current_base: baseName, status: 'disponible' });
  const currentQueue = getBaseQueue(freshDrivers, baseName);
  const idx = currentQueue.findIndex(d => d.id === driverId);
  if (idx === -1) return Response.json({ success:false, reason:'driver_not_in_base' });

  const driverToMove = currentQueue[idx];
  if (driverToMove.dispatch_status !== 'normal' || driverToMove.reserved_order_id ||
      driverToMove.active_order_id || driverToMove.active_ride_id) {
    return Response.json({ success:false, reason:'driver_busy' });
  }

  currentQueue.splice(idx, 1);
  const bounded = Math.max(0, Math.min(Number(newPosition), currentQueue.length));
  if (idx === bounded) return Response.json({ success:true, skipped:true, reason:'same_position' });

  const before = bounded > 0 ? currentQueue[bounded-1] : null;
  const after  = bounded < currentQueue.length ? currentQueue[bounded] : null;
  const beforeMs = before?.queue_authoritative_at ? new Date(before.queue_authoritative_at).getTime() : NaN;
  const afterMs  = after?.queue_authoritative_at  ? new Date(after.queue_authoritative_at).getTime()  : NaN;
  let nextMs: number;
  if (before && after) {
    if (!Number.isFinite(beforeMs) || !Number.isFinite(afterMs) || afterMs - beforeMs < 2)
      return Response.json({ success:false, reason:'no_safe_gap' });
    nextMs = Math.floor((beforeMs + afterMs) / 2);
  } else if (!before && after) {
    if (!Number.isFinite(afterMs)) return Response.json({ success:false, reason:'invalid_head' });
    nextMs = afterMs - 1;
  } else if (before && !after) {
    if (!Number.isFinite(beforeMs)) return Response.json({ success:false, reason:'invalid_tail' });
    nextMs = Math.max(Date.now(), beforeMs + 1);
  } else {
    nextMs = Date.now();
  }
  const authoritativeAtIso = new Date(nextMs).toISOString();

  const reorderToken = await signReorderToken(driverId, baseName, authoritativeAtIso);
  const reorderAt = new Date().toISOString();

  const moved = await b44.entities.Driver.updateMany(
    {
      id: driverToMove.id,
      current_base: baseName,
      status: 'disponible',
      dispatch_status: 'normal',
      reserved_order_id: null,
      active_order_id: null,
      active_ride_id: null,
      queue_entered_at: driverToMove.queue_entered_at ?? null
    },
    { $set: {
      queue_entered_at: authoritativeAtIso,
      queue_authoritative_base: baseName,
      queue_authoritative_at: authoritativeAtIso,
      queue_position: nextMs,
      queue_authority_marker: nextMs,
      manual_reorder_token: reorderToken,
      manual_reorder_at: reorderAt
    } }
  ).catch(() => ({ updated: 0 }));
  const changed = moved?.updated ?? moved?.modifiedCount ?? moved?.matchedCount ?? 0;
  if (changed < 1) return Response.json({ success:false, reason:'race_changed' });

  await b44.entities.AuditLog.create({
    action: 'QUEUE_MANUAL_REORDER',
    user_type: 'operador',
    user_name: 'Central',
    details: `Reordenó móvil ${driverToMove.name || driverId} en ${baseName}`,
    metadata: { driverId, baseName, from: idx+1, to: bounded+1, authoritativeAt: authoritativeAtIso, reorderToken }
  }).catch(()=>{});

  return Response.json({ success:true, from: idx+1, to: bounded+1, authoritativeAt: authoritativeAtIso });
});