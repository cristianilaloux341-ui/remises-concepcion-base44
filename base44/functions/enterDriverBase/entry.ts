import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { verifyRequestAuth } from '../../shared/security.ts';
import { withQueueLock, getNextQueuePosition, compactQueue } from '../../shared/queueOrder.ts';

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

  const driver = await b44.entities.Driver.get(driverId).catch(() => null);
  if (!driver) return Response.json({ success:false, reason:'driver_not_found' }, { status:404 });

  if (driver.status !== 'disponible' || (driver.dispatch_status && driver.dispatch_status !== 'normal') ||
      driver.reserved_order_id || driver.active_order_id || driver.active_ride_id || driver.next_order_id) {
    return Response.json({ success:false, reason:'driver_not_idle' }, { status:409 });
  }

  const oldBase = driver.queue_authoritative_base || null;
  const oldPos = Number(driver.queue_position);
  if (oldBase === baseName && Number.isFinite(oldPos) && oldPos > 0) {
    return Response.json({ success:true, skipped:true, reason:'already_in_base', baseName, queuePosition:oldPos });
  }

  try {
    const result = await withQueueLock(b44, baseName, async () => {
      const fresh = await b44.entities.Driver.get(driverId).catch(() => null);
      if (!fresh) throw new Error('driver_not_found');
      if (fresh.status !== 'disponible' || (fresh.dispatch_status && fresh.dispatch_status !== 'normal') ||
          fresh.reserved_order_id || fresh.active_order_id || fresh.active_ride_id || fresh.next_order_id) {
        throw new Error('driver_not_idle');
      }

      const previousBase = fresh.queue_authoritative_base || null;
      const queuePosition = await getNextQueuePosition(b44, baseName, driverId);
      const queueAt = new Date().toISOString();

      const updated = await b44.entities.Driver.updateMany(
        {
          id:driverId,
          status:'disponible',
          dispatch_status:fresh.dispatch_status ?? 'normal',
          reserved_order_id:null,
          active_order_id:null,
          active_ride_id:null,
          next_order_id:null,
          queue_authoritative_base:fresh.queue_authoritative_base ?? null,
          queue_position:fresh.queue_position ?? null
        },
        { $set:{
          current_base:baseName,
          queue_authoritative_base:baseName,
          queue_position:queuePosition,
          queue_authority_marker:queuePosition,
          queue_entered_at:queueAt,
          queue_authoritative_at:queueAt,
          manual_reorder_token:null,
          manual_reorder_at:null
        }}
      ).catch(() => ({ updated:0 }));

      const changed = Math.max(Number(updated?.updated ?? 0), Number(updated?.modifiedCount ?? 0), Number(updated?.matchedCount ?? 0));
      if (changed !== 1) throw new Error('concurrent_change');

      await b44.entities.AuditLog.create({
        action:'DRIVER_AUTHORITATIVE_BASE_ENTRY',
        user_type:'sistema',
        user_name:'QueueAuthority',
        details:`Entrada autoritativa de ${fresh.name || driverId} a ${baseName} en posición ${queuePosition}`,
        metadata:{ driverId, oldBase:previousBase, newBase:baseName, queuePosition, queueAt }
      }).catch(()=>{});

      return { previousBase, queuePosition, queueAt };
    });

    // La salida de la base anterior es una acción operativa real: cerramos su hueco,
    // pero nunca dentro del lock de la nueva base para evitar locks anidados.
    if (result.previousBase && result.previousBase !== baseName) {
      const compacted = await compactQueue(b44, result.previousBase).then(()=>true).catch(()=>false);
      if (!compacted) {
        await b44.entities.AuditLog.create({action:'PREVIOUS_BASE_COMPACTION_FAILED',user_type:'sistema',user_name:'enterDriverBase',details:`El móvil ${driverId} entró a ${baseName}, pero falló compactar la base anterior ${result.previousBase}`,metadata:{driverId,newBase:baseName,previousBase:result.previousBase}}).catch(()=>{});
        return Response.json({success:true,baseName,queuePosition:result.queuePosition,queueAt:result.queueAt,warning:'PREVIOUS_BASE_COMPACTION_FAILED'});
      }
    }

    return Response.json({ success:true, baseName, queuePosition:result.queuePosition, queueAt:result.queueAt });
  } catch (error:any) {
    return Response.json({ success:false, reason:error?.message || 'BASE_ENTRY_FAILED' }, { status:409 });
  }
});
