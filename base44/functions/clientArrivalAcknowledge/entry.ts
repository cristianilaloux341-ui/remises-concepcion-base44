import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  try {
    const payload = await req.json();
    const { orderId, clientId, sessionToken } = payload || {};
    if (!orderId || !clientId || !sessionToken) return Response.json({ success:false, reason:'missing_fields' }, { status:400 });
    if (!(await verifyRequestAuth(b44, payload, { allowClient:true, allowClientId:String(clientId) }))) {
      return Response.json({ success:false, reason:'unauthorized' }, { status:401 });
    }

    const order = await b44.entities.RideOrder.get(orderId).catch(() => null);
    if (!order) return Response.json({ success:false, reason:'order_not_found' }, { status:404 });
    if (String(order.client_id || '') !== String(clientId)) return Response.json({ success:false, reason:'client_mismatch' }, { status:403 });
    if (order.status !== 'en_camino') return Response.json({ success:false, reason:'invalid_status', status:order.status }, { status:409 });
    if (Number(order.client_arrival_notice_count || 0) < 1) return Response.json({ success:false, reason:'arrival_not_notified' }, { status:409 });

    if (order.client_arrival_acknowledged === true) return Response.json({ success:true, alreadyAcknowledged:true, acknowledgedAt:order.client_arrival_acknowledged_at || null });

    const acknowledgedAt = new Date().toISOString();
    await b44.entities.RideOrder.update(orderId, { client_arrival_acknowledged:true, client_arrival_acknowledged_at:acknowledgedAt, client_arrival_expires_at:null, client_arrival_cancel_reason:null });
    await b44.entities.AuditLog.create({ action:'CLIENT_ARRIVAL_ACKNOWLEDGED', user_type:'cliente', user_name:order.client_name || clientId, details:`Cliente confirmó YA VOY para viaje ${orderId}`, metadata:{ orderId, clientId, driverId:order.driver_id || null, acknowledgedAt } }).catch(() => {});
    return Response.json({ success:true, acknowledgedAt });
  } catch (e:any) {
    return Response.json({ success:false, reason:e?.message || 'error' }, { status:500 });
  }
});
