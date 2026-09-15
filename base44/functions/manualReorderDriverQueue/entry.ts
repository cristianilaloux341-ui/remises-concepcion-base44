import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { verifyRequestAuth } from '../../shared/security.ts';
import { getBaseQueue, compactQueue } from '../../shared/queueOrder.ts';

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
  const idx = currentQueue.findIndex((d: any) => d.id === driverId);
  if (idx === -1) return Response.json({ success:false, reason:'driver_not_in_base' });

  const driverToMove = currentQueue[idx];
  if (driverToMove.dispatch_status !== 'normal' || driverToMove.reserved_order_id ||
      driverToMove.active_order_id || driverToMove.active_ride_id) {
    return Response.json({ success:false, reason:'driver_busy' });
  }

  currentQueue.splice(idx, 1);
  const bounded = Math.max(0, Math.min(Number(newPosition), currentQueue.length));
  if (idx === bounded) return Response.json({ success:true, skipped:true, reason:'same_position' });

  currentQueue.splice(bounded, 0, driverToMove);

  let pos = 1;
  for (const d of currentQueue) {
    await b44.entities.Driver.update(d.id, {
      queue_position: pos
    });
    pos++;
  }

  await b44.entities.AuditLog.create({
    action: 'QUEUE_MANUAL_REORDER',
    user_type: 'operador',
    user_name: 'Central',
    details: `Reordenó móvil ${driverToMove.name || driverId} en ${baseName}`,
    metadata: { driverId, baseName, from: idx+1, to: bounded+1 }
  }).catch(()=>{});

  return Response.json({ success:true, from: idx+1, to: bounded+1 });
});