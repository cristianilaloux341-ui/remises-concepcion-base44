import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { verifyRequestAuth } from '../../shared/security.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const payload = await req.json().catch(() => ({}));
  const driverId = String(payload?.driverId || '').trim();
  if (!driverId) return Response.json({ success:false, reason:'missing_driver_id' }, { status:400 });

  if (!(await verifyRequestAuth(b44, payload, { allowDriverId:driverId }))) {
    return Response.json({ success:false, reason:'unauthorized' }, { status:401 });
  }

  const rows = await b44.entities.Driver.filter({ id:driverId });
  const self = rows?.[0];
  if (!self) return Response.json({ success:false, reason:'driver_not_found' }, { status:404 });

  const baseName = self.queue_authoritative_base || null;
  const selfPosition = Number(self.queue_position);
  if (!baseName || self.status !== 'disponible' || !Number.isFinite(selfPosition) || selfPosition <= 0) {
    return Response.json({
      success:true,
      serverNowMs:Date.now(),
      baseName:null,
      selfPosition:null,
      queue:[]
    });
  }

  const queued = await b44.entities.Driver.filter({ status:'disponible', queue_authoritative_base:baseName });
  const queue = (queued || [])
    .filter((d:any) =>
      (d.dispatch_status == null || d.dispatch_status === 'normal') &&
      !d.reserved_order_id && !d.active_ride_id && !d.next_order_id &&
      Number.isFinite(Number(d.queue_position)) && Number(d.queue_position) > 0
    )
    .sort((a:any,b:any) => Number(a.queue_position) - Number(b.queue_position) || String(a.id).localeCompare(String(b.id)))
    .map((d:any) => ({
      driverId:d.id,
      name:d.name || '',
      mobile:d.mobile_number || d.numero_movil || '',
      position:Number(d.queue_position)
    }));

  return Response.json({
    success:true,
    serverNowMs:Date.now(),
    baseName,
    selfPosition,
    queue
  });
});
