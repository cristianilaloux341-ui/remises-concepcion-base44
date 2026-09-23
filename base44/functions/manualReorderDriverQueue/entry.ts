import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { verifyRequestAuth } from '../../shared/security.ts';
import { getBaseQueue, withQueueLock } from '../../shared/queueOrder.ts';

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
          driverToMove.active_order_id || driverToMove.active_ride_id || driverToMove.next_order_id) {
        return Response.json({ success:false, reason:'driver_busy' });
      }

      currentQueue.splice(idx, 1);
      const bounded = Math.max(0, Math.min(Number(newPosition), currentQueue.length));
      if (idx === bounded) return Response.json({ success:true, skipped:true, reason:'same_position' });
      currentQueue.splice(bounded, 0, driverToMove);

      // Reorden manual de Central: queue_position es la única prioridad.
      // No reescribimos timestamps de entrada/autoridad porque pertenecen al evento
      // real de ingreso a base y no deben cambiar al mover una fila.
      const reorderAt = new Date().toISOString();

      for (let i = 0; i < currentQueue.length; i++) {
        const d:any = currentQueue[i];
        const pos = i + 1;
        if (Number(d.queue_position) === pos && Number(d.queue_authority_marker) === pos && d.id !== driverId) continue;

        const changed = await b44.entities.Driver.updateMany(
          {
            id:d.id,
            queue_authoritative_base:baseName,
            status:'disponible',
            dispatch_status:'normal',
            reserved_order_id:null,
            active_order_id:null,
            active_ride_id:null,
            next_order_id:null
          },
          { $set:{
            queue_position:pos,
            queue_authority_marker:pos,
            manual_reorder_at:reorderAt
          } }
        ).catch(()=>({updated:0}));
        const changedCount = changed?.updated ?? changed?.modifiedCount ?? changed?.matchedCount ?? 0;
        if (changedCount !== 1) {
          throw new Error(`QUEUE_REORDER_CONCURRENT_CHANGE:${d.id}`);
        }
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
          authority:'queue_position'
        }
      }).catch(()=>{});

      return Response.json({ success:true, from:idx + 1, to:bounded + 1, queuePosition:bounded + 1 });
    });
  } catch (error:any) {
    return Response.json({ success:false, reason:error?.message || 'QUEUE_REORDER_FAILED' }, { status:409 });
  }
});