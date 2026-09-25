import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { withQueueLock, compactQueueUnlocked } from '../../shared/queueOrder.ts';

const DISCONNECT_GRACE_MS = 3 * 60 * 1000;

function mutationCount(result:any) {
  return Math.max(Number(result?.updated ?? 0), Number(result?.modifiedCount ?? 0), Number(result?.matchedCount ?? 0));
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const cutoff = Date.now() - DISCONNECT_GRACE_MS;

  try {
    // SEGURIDAD: last_active actualmente se escribe al autenticar el dispositivo,
    // no mediante un heartbeat periódico comprobado. Hasta que exista ese heartbeat
    // autoritativo, este sweep no puede retirar móviles de la cola por antigüedad.
    // Mantener la función como no-op permite dejar el workflow instalado sin que
    // modifique posiciones reales.
    return Response.json({ success:true, suspended:0, graceSeconds:DISCONNECT_GRACE_MS/1000, disabledUntilHeartbeat:true });

    // Solo candidatos realmente en cola. No convierte la desconexión en una salida
    // voluntaria: conserva status=disponible pero elimina pertenencia/prioridad.
    const queued = await b44.entities.Driver.filter({ status:'disponible', queue_authoritative_base:{ $ne:null } });
    let suspended = 0;

    for (const snapshot of queued) {
      if (snapshot.reserved_order_id || snapshot.active_ride_id || snapshot.next_order_id) continue;
      if (snapshot.dispatch_status != null && snapshot.dispatch_status !== 'normal') continue;

      const lastActiveMs = new Date(snapshot.last_active || 0).getTime();
      if (Number.isFinite(lastActiveMs) && lastActiveMs > cutoff) continue;

      const baseName = snapshot.queue_authoritative_base;
      if (!baseName || !Number.isFinite(Number(snapshot.queue_position)) || Number(snapshot.queue_position) <= 0) continue;

      await withQueueLock(b44, baseName, async () => {
        const fresh = await b44.entities.Driver.get(snapshot.id).catch(() => null);
        if (!fresh) return;

        const freshLastActiveMs = new Date(fresh.last_active || 0).getTime();
        if (Number.isFinite(freshLastActiveMs) && freshLastActiveMs > cutoff) return;
        if (
          fresh.status !== 'disponible' ||
          fresh.queue_authoritative_base !== baseName ||
          Number(fresh.queue_position) !== Number(snapshot.queue_position) ||
          fresh.reserved_order_id || fresh.active_ride_id || fresh.next_order_id ||
          (fresh.dispatch_status != null && fresh.dispatch_status !== 'normal')
        ) return;

        const nowIso = new Date().toISOString();
        const res = await b44.entities.Driver.updateMany({
          id:fresh.id,
          status:'disponible',
          queue_authoritative_base:baseName,
          queue_position:fresh.queue_position,
          reserved_order_id:null,
          active_ride_id:null,
          next_order_id:null
        }, { $set:{
          queue_authoritative_base:null,
          queue_position:null,
          queue_last_operation_key:null,
          disconnect_suspended_at:nowIso,
          disconnect_suspended_base:baseName
        }});

        if (mutationCount(res) !== 1) return;
        await compactQueueUnlocked(b44, baseName);
        suspended++;

        await b44.entities.AuditLog.create({
          action:'DRIVER_QUEUE_SUSPENDED_DISCONNECTED',
          user_type:'sistema',
          user_name:'disconnectQueueSweep',
          details:`${fresh.name || fresh.id} retirado de cola tras 3 minutos sin heartbeat`,
          metadata:{ driverId:fresh.id, previousBase:baseName, previousPosition:fresh.queue_position, lastActive:fresh.last_active }
        }).catch(() => {});
      });
    }

    return Response.json({ success:true, suspended, graceSeconds:DISCONNECT_GRACE_MS/1000 });
  } catch (error:any) {
    console.error('disconnectQueueSweep', error);
    return Response.json({ success:false, error:error?.message || String(error) }, { status:500 });
  }
});
