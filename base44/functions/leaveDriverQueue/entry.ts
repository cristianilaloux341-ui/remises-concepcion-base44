import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { verifyRequestAuth } from '../../shared/security.ts';
import { compactQueueUnlocked, withQueueLock } from '../../shared/queueOrder.ts';

function mutationCount(result: any): number {
  return Math.max(
    Number(result?.updated ?? 0),
    Number(result?.modifiedCount ?? 0),
    Number(result?.matchedCount ?? 0)
  );
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const payload = await req.json();

  const driverId = String(payload?.driverId || '').trim();
  const source = String(payload?.source || 'unknown').trim();

  if (!driverId) {
    return Response.json({ success:false, reason:'missing_driver_id' }, { status:400 });
  }

  if (!(await verifyRequestAuth(b44, payload, { allowOperator:true, allowDriverId:driverId }))) {
    return Response.json({ success:false, reason:'unauthorized' }, { status:401 });
  }

  const rows = await b44.entities.Driver.filter({ id:driverId });
  const current = rows?.[0];
  if (!current) {
    return Response.json({ success:false, reason:'driver_not_found' }, { status:404 });
  }

  const isFromCentral = source.startsWith('central');
  const bloqueoHasta = Number(current?.bloqueo_post_aceptacion_hasta);
  if (!isFromCentral && bloqueoHasta > Date.now()) {
    const minutosRestantes = Math.ceil((bloqueoHasta - Date.now()) / 60000);
    return Response.json({ success: false, reason: 'driver_blocked', message: `Esperá ${minutosRestantes} minutos para salir de servicio` }, { status: 403 });
  }

  const alreadyOut = current.status === 'no_disponible' &&
    !current.current_base &&
    !current.queue_authoritative_base &&
    current.queue_position == null &&
    current.queue_authority_marker == null &&
    !current.reserved_order_id &&
    !current.active_order_id &&
    !current.active_ride_id &&
    !current.next_order_id;

  if (alreadyOut) {
    return Response.json({
      success:true,
      idempotent:true,
      previousBase:null,
      queueLeftAt:current.queue_left_at || null
    });
  }

  const previousBase = current.queue_authoritative_base || null;
  const queueLeftAt = new Date().toISOString();

  const leaveOnce = async () => {
    const freshRows = await b44.entities.Driver.filter({ id:driverId });
    const fresh = freshRows?.[0];
    if (!fresh) return { success:false, reason:'driver_not_found' };

    const freshBase = fresh.queue_authoritative_base || null;
    if (
      freshBase !== previousBase ||
      fresh.status !== 'disponible' ||
      (fresh.dispatch_status != null && fresh.dispatch_status !== 'normal') ||
      fresh.reserved_order_id ||
      fresh.active_order_id ||
      fresh.active_ride_id ||
      fresh.next_order_id
    ) {
      return { success:false, reason:'driver_busy_or_state_changed' };
    }

    const res = await b44.entities.Driver.updateMany(
      {
        id:driverId,
        status:'disponible',
        $or:[
          { dispatch_status:'normal' },
          { dispatch_status:null },
          { dispatch_status:{ $exists:false } }
        ],
        reserved_order_id:null,
        active_order_id:null,
        active_ride_id:null,
        next_order_id:null
      },
      {
        $set:{
          status:'no_disponible',
          dispatch_status:'normal',
          current_base:null,
          queue_entered_at:null,
          queue_authoritative_base:null,
          queue_authoritative_at:null,
          queue_authority_marker:null,
          queue_position:null,
          queue_left_at:queueLeftAt,
          reserved_order_id:null,
          reservation_token:null,
          driver_reservation_key:null,
          active_order_id:null,
          active_ride_id:null
        }
      }
    ).catch(() => ({ updated:0 }));

    if (mutationCount(res) !== 1) {
      return { success:false, reason:'driver_busy_or_state_changed' };
    }

    if (previousBase) {
      await compactQueueUnlocked(b44, previousBase);
    }

    return { success:true, driverName:fresh.name || 'Driver' };
  };

  const result = previousBase
    ? await withQueueLock(b44, previousBase, leaveOnce)
    : await leaveOnce();

  if (!result?.success) {
    const status = result?.reason === 'driver_not_found' ? 404 : 409;
    return Response.json({ success:false, reason:result?.reason || 'leave_failed' }, { status });
  }

  const fromCentral = source.startsWith('central');
  await b44.entities.AuditLog.create({
    action: fromCentral ? 'DRIVER_OFF_SERVICE_FROM_CENTRAL' : 'DRIVER_OFF_SERVICE_FROM_APK',
    user_type: fromCentral ? 'operador' : 'chofer',
    user_name: fromCentral ? 'Central' : (result.driverName || 'Chofer'),
    details: fromCentral
      ? `${result.driverName || driverId} salió de servicio desde Central`
      : `${result.driverName || driverId} salió de servicio desde la APK`,
    metadata:{
      driverId,
      previousBase,
      queueLeftAt,
      source
    }
  }).catch(() => {});

  return Response.json({
    success:true,
    previousBase,
    queueLeftAt
  });
});