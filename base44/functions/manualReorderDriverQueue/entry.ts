import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { verifyRequestAuth } from '../../shared/security.ts';
import { getBaseQueue, withQueueLock } from '../../shared/queueOrder.ts';
import { signReorderToken } from '../../shared/reorderToken.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const payload = await req.json();
  const { driverId, baseName, newPosition } = payload;

  if (!(await verifyRequestAuth(b44, payload, { allowOperator: true }))) {
    return Response.json({ success:false, reason:'unauthorized' }, { status: 401 });
  }
  if (!driverId || !baseName || newPosition == null) {
    return Response.json({ success:false, reason:'missing_params' }, { status: 400 });
  }

  try {
    return await withQueueLock(b44, baseName, async () => {
      const freshDrivers = await b44.entities.Driver.filter({ status: 'disponible', $or:[{ current_base:baseName }, { queue_authoritative_base:baseName }] });
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

      // Compatibilidad v12.27/v12.29: esas APK todavía muestran la fila ordenando
      // queue_authoritative_at. Reutilizamos el conjunto de timestamps existentes,
      // ordenados de menor a mayor, como una PROYECCIÓN del nuevo queue_position.
      // El backend nunca consulta estos valores para decidir prioridad.
      const existingTimes = currentQueue
        .map((d: any) => ({ raw: d.queue_authoritative_at || d.queue_entered_at || null, ms: new Date(d.queue_authoritative_at || d.queue_entered_at || 0).getTime() }))
        .filter((x: any) => x.raw && Number.isFinite(x.ms))
        .sort((a: any, b: any) => a.ms - b.ms);

      const uniqueTimes = existingTimes.length === currentQueue.length &&
        new Set(existingTimes.map((x: any) => x.ms)).size === currentQueue.length;
      const fallbackStart = Date.now() - Math.max(0, currentQueue.length - 1);
      const reorderAt = new Date().toISOString();

      let movedCompatAt:string | null = null;
      for (let i = 0; i < currentQueue.length; i++) {
        const d:any = currentQueue[i];
        const pos = i + 1;
        const compatAt = uniqueTimes
          ? new Date(existingTimes[i].ms).toISOString()
          : new Date(fallbackStart + i).toISOString();
        const reorderToken = await signReorderToken(d.id, baseName, compatAt);

        const updated = await b44.entities.Driver.updateMany(
          {
            id:d.id,
            queue_authoritative_base:baseName,
            status:'disponible',
            dispatch_status:'normal',
            reserved_order_id:null,
            active_order_id:null,
            active_ride_id:null
          },
          { $set:{
            queue_position:pos,
            queue_authoritative_base:baseName,
            queue_authoritative_at:compatAt,
            queue_entered_at:compatAt,
            queue_authority_marker:pos,
            manual_reorder_token:reorderToken,
            manual_reorder_at:reorderAt
          } }
        ).catch(()=>({updated:0}));
        const changed = updated?.updated ?? updated?.modifiedCount ?? updated?.matchedCount ?? 0;
        if (changed !== 1) continue;
        if (d.id === driverId) movedCompatAt = compatAt;
      }

      await b44.entities.AuditLog.create({
        action:'QUEUE_MANUAL_REORDER',
        user_type:'operador',
        user_name:'Central',
        details:`Reordenó móvil ${driverToMove.name || driverId} en ${baseName}`,
        metadata:{
          driverId,
          baseName,
          from:idx + 1,
          to:bounded + 1,
          movedCompatAt,
          authority:'queue_position',
          legacyProjection:'queue_authoritative_at'
        }
      }).catch(()=>{});

      return Response.json({ success:true, from:idx + 1, to:bounded + 1, queuePosition:bounded + 1 });
    });
  } catch (error:any) {
    return Response.json({ success:false, reason:error?.message || 'QUEUE_REORDER_FAILED' }, { status:409 });
  }
});