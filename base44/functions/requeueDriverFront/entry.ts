import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { verifyRequestAuth } from '../../shared/security.ts';
import { getBaseQueue, withQueueLock } from '../../shared/queueOrder.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const payload = await req.json().catch(() => ({}));
  const { driverId, baseName } = payload;

  if (!(await verifyRequestAuth(b44, payload, { allowOperator: true }))) {
    return Response.json({ success:false, reason:'unauthorized' }, { status:401 });
  }
  if (!driverId || !baseName) {
    return Response.json({ success:false, reason:'missing_params' }, { status:400 });
  }

  try {
    return await withQueueLock(b44, baseName, async () => {
      const [target, baseDrivers] = await Promise.all([
        b44.entities.Driver.get(driverId).catch(() => null),
        b44.entities.Driver.filter({
          status:'disponible',
          $or:[{ current_base:baseName }, { queue_authoritative_base:baseName }]
        }).catch(() => [])
      ]);

      if (!target) return Response.json({ success:false, reason:'driver_not_found' }, { status:404 });
      if (
        target.status !== 'disponible' ||
        (target.dispatch_status != null && target.dispatch_status !== 'normal') ||
        target.reserved_order_id || target.active_order_id || target.active_ride_id
      ) {
        return Response.json({ success:false, reason:'driver_busy' }, { status:409 });
      }

      const existingQueue = getBaseQueue(baseDrivers, baseName).filter((d:any) => d.id !== driverId);
      const desired = [target, ...existingQueue];

      // Proyección para APK v12.27/v12.29: el target queda con el menor timestamp
      // legacy, pero la prioridad real se decide exclusivamente por queue_position.
      const validExistingTimes = existingQueue
        .map((d:any) => new Date(d.queue_authoritative_at || d.queue_entered_at || 0).getTime())
        .filter((ms:number) => Number.isFinite(ms))
        .sort((a:number,b:number) => a - b);
      const uniqueExisting = validExistingTimes.length === existingQueue.length &&
        new Set(validExistingTimes).size === existingQueue.length;
      const fallbackStart = Date.now() - desired.length;
      const targetCompatMs = uniqueExisting && validExistingTimes.length
        ? validExistingTimes[0] - 1
        : fallbackStart;
      const targetEnteredAt = new Date().toISOString();

      for (let i = 0; i < desired.length; i++) {
        const d:any = desired[i];
        const pos = i + 1;
        const compatMs = i === 0
          ? targetCompatMs
          : (uniqueExisting ? validExistingTimes[i - 1] : fallbackStart + i);
        const compatAt = new Date(compatMs).toISOString();
        const filter:any = {
          id:d.id,
          status:'disponible',
          dispatch_status:'normal',
          reserved_order_id:null,
          active_order_id:null,
          active_ride_id:null
        };
        if (i > 0) filter.queue_authoritative_base = baseName;

        const set:any = {
          current_base:baseName,
          queue_authoritative_base:baseName,
          queue_authoritative_at:compatAt,
          queue_position:pos,
          queue_authority_marker:pos,
          queue_left_at:null
        };
        if (i === 0) set.queue_entered_at = targetEnteredAt;

        const res = await b44.entities.Driver.updateMany(filter, { $set:set }).catch(()=>({updated:0}));
        const count = res?.updated ?? res?.modifiedCount ?? res?.matchedCount ?? 0;
        if (count !== 1) continue;
      }

      await b44.entities.AuditLog.create({
        action:'QUEUE_REINSERTED_FIRST_AFTER_CENTRAL_CANCEL',
        user_type:'operador',
        user_name:'Central',
        details:`Móvil ${target.name || driverId} volvió 1° a ${baseName} por cancelación de Central`,
        metadata:{ driverId, baseName, authority:'queue_position', legacyProjection:'queue_authoritative_at' }
      }).catch(()=>{});

      return Response.json({ success:true, queuePosition:1 });
    });
  } catch (error:any) {
    return Response.json({ success:false, reason:error?.message || 'QUEUE_FRONT_FAILED' }, { status:409 });
  }
});