import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';
import { withQueueLock, compactQueueUnlocked, getEffectiveQueueBase } from '../../shared/queueOrder.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  try {
    const { driverId, sessionToken, operatorName } = await req.json();
    if (!driverId) return Response.json({ success:false, reason:'DRIVER_ID_REQUIRED' }, { status:400 });

    // Fail closed: sólo operador autenticado o llamada interna válida.
    if (!(await verifyRequestAuth(b44, { ...await Promise.resolve({sessionToken}), sessionToken }, { allowOperator:true }))) {
      return Response.json({ success:false, reason:'UNAUTHORIZED' }, { status:401 });
    }

    const driver = await b44.entities.Driver.get(driverId).catch(() => null);
    if (!driver) return Response.json({ success:false, reason:'DRIVER_NOT_FOUND' }, { status:404 });

    // Desvincular equipo no puede alterar una oferta/viaje activo ni reordenar la cola.
    // Si está trabajando, sólo se revoca la sesión/dispositivo.
    const busy = Boolean(driver.active_ride_id || driver.reserved_order_id || driver.next_order_id || driver.dispatch_status === 'reserved');
    const patch:any = { current_session_token:null, device_id:null };
    let queueRemoved = false;
    if (!busy) {
      const queueBase = getEffectiveQueueBase(driver);
      if (queueBase) {
        await withQueueLock(b44, queueBase, async () => {
          const removed = await b44.entities.Driver.updateMany(
            {id:driverId,status:'disponible',queue_authoritative_base:queueBase,
             queue_position:driver.queue_position,
             active_ride_id:null,reserved_order_id:null,next_order_id:null},
            {$set:{status:'no_disponible',queue_entered_at:null,
                   queue_authoritative_base:null,queue_position:null,
                   current_session_token:null,device_id:null}}
          );
          const count = Math.max(Number(removed?.updated||0),Number(removed?.modifiedCount||0),Number(removed?.matchedCount||0));
          if (count !== 1) throw new Error('DRIVER_STATE_CHANGED_RETRY');
          queueRemoved = true;
          await compactQueueUnlocked(b44, queueBase);
        });
      } else {
        patch.status = 'no_disponible';
        patch.queue_entered_at = null;
        patch.queue_authoritative_base = null;
        patch.queue_position = null;
        const changed = await b44.entities.Driver.updateMany(
          {id:driverId,status:'disponible',active_ride_id:null,reserved_order_id:null,next_order_id:null,
           $or:[{queue_authoritative_base:null},{queue_authoritative_base:{$exists:false}}]},
          {$set:patch}
        );
        const count = Math.max(Number(changed?.updated||0),Number(changed?.modifiedCount||0),Number(changed?.matchedCount||0));
        if (count !== 1) throw new Error('DRIVER_STATE_CHANGED_RETRY');
      }
    } else {
      const changed = await b44.entities.Driver.updateMany(
        {id:driverId,
         active_ride_id:driver.active_ride_id ?? null,
         reserved_order_id:driver.reserved_order_id ?? null,
         next_order_id:driver.next_order_id ?? null},
        {$set:patch}
      );
      const count = Math.max(Number(changed?.updated||0),Number(changed?.modifiedCount||0),Number(changed?.matchedCount||0));
      if (count !== 1) throw new Error('DRIVER_STATE_CHANGED_RETRY');
    }
    await b44.entities.AuditLog.create({
      action:'revocar_acceso',
      user_type:'operador',
      user_name:operatorName || 'Central',
      details:`Desvinculó el equipo del chofer ${driver.name || driverId}`,
      metadata:{ driverId, busy, queueRemoved }
    }).catch(() => {});

    return Response.json({ success:true, busy, statusChanged:!busy });
  } catch (e) {
    console.error('operatorRevokeDriverAccess error', e);
    return Response.json({ success:false, reason:e?.message || 'REVOKE_FAILED' }, { status:500 });
  }
});