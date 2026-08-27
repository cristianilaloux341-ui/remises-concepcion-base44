import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

const TWO_MINUTES = 2 * 60 * 1000;
const ONE_MINUTE = 60 * 1000;

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;

  try {
    const payload = await req.json();
    const { orderId, driverId } = payload || {};
    if (!orderId || !driverId) {
      return Response.json({ success:false, reason:'missing_fields' }, { status:400 });
    }

    const order = await b44.entities.RideOrder.get(orderId).catch(() => null);
    if (!order) return Response.json({ success:false, reason:'order_not_found' }, { status:404 });
    if (order.driver_id !== driverId) return Response.json({ success:false, reason:'driver_mismatch' }, { status:403 });
    if (!['aceptado','en_camino'].includes(order.status)) {
      return Response.json({ success:false, reason:'invalid_status', status:order.status }, { status:409 });
    }
    if (order.client_arrival_acknowledged === true) {
      return Response.json({ success:false, reason:'already_acknowledged' }, { status:409 });
    }

    const now = Date.now();
    const count = Number(order.client_arrival_notice_count || 0);
    const firstAt = order.client_arrival_first_notice_at ? Date.parse(order.client_arrival_first_notice_at) : 0;

    if (count >= 2) {
      return Response.json({ success:false, reason:'max_notices_reached' }, { status:409 });
    }
    if (count === 1 && firstAt && now - firstAt < TWO_MINUTES) {
      return Response.json({ success:false, reason:'second_notice_too_early', retryAt:new Date(firstAt + TWO_MINUTES).toISOString() }, { status:409 });
    }

    const sentAt = new Date(now).toISOString();
    const patch:any = {
      status:'en_camino',
      client_arrival_notice_count: count + 1
    };

    if (count === 0) {
      patch.client_arrival_first_notice_at = sentAt;
      patch.client_arrival_second_notice_at = null;
      patch.client_arrival_expires_at = null;
      patch.client_arrival_acknowledged = false;
      patch.client_arrival_acknowledged_at = null;
      patch.client_arrival_cancel_reason = null;
    } else {
      patch.client_arrival_second_notice_at = sentAt;
      patch.client_arrival_expires_at = new Date(now + ONE_MINUTE).toISOString();
    }

    await b44.entities.RideOrder.update(orderId, patch);

    if (order.client_id) {
      await base44.functions.invoke('sendPushNotification', {
        action:'send_client_push',
        payloadType:'bocina',
        userId:order.client_id,
        orderId:order.id,
        arrivalNoticeNumber:count + 1
      }).catch(() => {});
    }

    await b44.entities.AuditLog.create({
      action: count === 0 ? 'CLIENT_ARRIVAL_NOTICE_1' : 'CLIENT_ARRIVAL_NOTICE_2',
      user_type:'chofer',
      user_name:order.driver_name || driverId,
      details:`Aviso ${count + 1} de móvil afuera para viaje ${orderId}`,
      metadata:{ orderId, driverId, noticeNumber:count + 1, sentAt }
    }).catch(() => {});

    return Response.json({ success:true, noticeNumber:count + 1, sentAt, expiresAt:patch.client_arrival_expires_at || null });
  } catch (e:any) {
    return Response.json({ success:false, reason:e?.message || 'error' }, { status:500 });
  }
});
