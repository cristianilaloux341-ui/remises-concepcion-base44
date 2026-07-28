import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const payload = await req.json();
  const { orderId, sessionToken } = payload;

  if (!sessionToken) {
    return Response.json({ success: false, reason: 'unauthorized - missing session token' }, { status: 401 });
  }

  try {
    const decodedStr = atob(sessionToken);
    const tokenData = JSON.parse(decodedStr);
    
    if (!tokenData || !tokenData.id || !tokenData.exp || Date.now() > tokenData.exp) {
      return Response.json({ success: false, reason: 'token_expired_or_invalid' }, { status: 401 });
    }

    const ops = await b44.entities.UsuariosSistema.filter({ id: tokenData.id });
    if (!ops || ops.length === 0 || !ops[0].activo) {
      return Response.json({ success: false, reason: 'operator_not_found_or_inactive' }, { status: 403 });
    }
  } catch (err) {
    return Response.json({ success: false, reason: 'invalid_token_format' }, { status: 400 });
  }

  const orderReq = await b44.entities.RideOrder.get(orderId);
  
  if (!orderReq) {
    return Response.json({ success: false, reason: 'Order not found' });
  }

  try {
    const newAttempt = (orderReq.assignment_attempt || 0) + 1;
    const newNotes = orderReq.notes ? (orderReq.notes.startsWith("[BROADCAST]") ? orderReq.notes : `[BROADCAST] ${orderReq.notes}`) : "[BROADCAST]";

    // Update order
    await b44.entities.RideOrder.update(orderId, {
      status: "pendiente",
      driver_id: null,
      driver_name: null,
      assigned_base: null,
      notes: newNotes,
      assignment_attempt: newAttempt
    });

    // Trigger directo eliminado para volver a la automatización de RideOrder

    await b44.entities.AuditLog.create({
      action: 'BROADCAST_RIDE_REQUESTED',
      user_type: 'sistema',
      user_name: 'broadcastRide',
      details: `Broadcast emitido para el viaje ${orderId}`
    }).catch(() => {});

    return Response.json({ success: true });
  } catch (e) {
    console.error("BroadcastRide Error:", e);
    return Response.json({ success: false, reason: e.message });
  }
});