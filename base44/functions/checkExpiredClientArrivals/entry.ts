import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { validateInternalKey } from '../../shared/security.ts';

const MAX_BATCH = 100;

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;

  try {
    const payload = await req.json().catch(() => ({}));
    const { internalKey } = payload || {};
    if (!validateInternalKey(internalKey)) {
      return Response.json({ success:false, reason:'unauthorized' }, { status:401 });
    }

    const now = Date.now();
    const candidates = await b44.entities.RideOrder.filter({ status:'en_camino' }).catch(() => []);
    const expired = (candidates || [])
      .filter((o:any) => Number(o.client_arrival_notice_count || 0) >= 2)
      .filter((o:any) => o.client_arrival_acknowledged !== true)
      .filter((o:any) => {
        const t = o.client_arrival_expires_at ? Date.parse(o.client_arrival_expires_at) : NaN;
        return Number.isFinite(t) && t <= now;
      })
      .slice(0, MAX_BATCH);

    const results:any[] = [];
    for (const order of expired) {
      try {
        const res = await base44.functions.invoke('cancelExpiredClientArrival', { orderId:order.id, internalKey });
        results.push({ orderId:order.id, success:res?.data?.success === true, reason:res?.data?.reason || null });
      } catch (e:any) {
        results.push({ orderId:order.id, success:false, reason:e?.message || 'invoke_failed' });
      }
    }

    return Response.json({ success:true, checked:(candidates || []).length, expired:expired.length, results });
  } catch (e:any) {
    return Response.json({ success:false, reason:e?.message || 'error' }, { status:500 });
  }
});
