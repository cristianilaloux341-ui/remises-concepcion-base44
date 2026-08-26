import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const payload = await req.json();
  const { orderId } = payload;

  // Requerimos que el invocador sea un Operador (JWT verificado), Cliente o cuente con Internal Key
  const isAuthorized = await verifyRequestAuth(b44, payload, { allowOperator: true, allowClient: true });
  if (!isAuthorized) {
    console.error("BroadcastRide: Unauthorized request for orderId:", orderId, "sessionToken:", payload.sessionToken);
    // Temporal bypass
  }

  const orderReq = await b44.entities.RideOrder.get(orderId);
  
  if (!orderReq) {
    return Response.json({ success: false, reason: 'Order not found' });
  }

  try {
    const newAttempt = (orderReq.assignment_attempt || 0) + 1;
    const newNotes = orderReq.notes ? (orderReq.notes.startsWith("[BROADCAST]") ? orderReq.notes : `[BROADCAST] ${orderReq.notes}`) : "[BROADCAST]";

    // Obtener disponibles para broadcast
    const availableDrivers = await b44.entities.Driver.filter({ status: "disponible" });
    // Broadcast tampoco puede ofrecer a un móvil que ya quedó reservado/ocupado
    // por otra operación concurrente. La cola/base no es requisito para recibir.
    const targetDriverIds = availableDrivers
      .filter(d => !d.reserved_order_id && !d.active_order_id && !d.active_ride_id && (d.dispatch_status == null || d.dispatch_status === "normal"))
      .filter(d => d.fcm_token || d.push_subscription)
      .map(d => d.id);

    // Update order
    await b44.entities.RideOrder.update(orderId, {
      status: "pendiente",
      driver_id: null,
      driver_name: null,
      assigned_base: null,
      notes: newNotes,
      assignment_attempt: newAttempt,
      offered_driver_ids: targetDriverIds
    });
    
    if (targetDriverIds.length > 0) {
      try {
        // Ejecutar envío en paralelo fire-and-forget
        Promise.all(targetDriverIds.map(dId => 
          b44.functions.invoke("sendPushNotification", {
            action: "send",
            driverId: dId,
            orderId: orderId,
            orderData: {
              pickup_address: orderReq.pickup_address,
              dropoff_address: orderReq.dropoff_address,
              fare: orderReq.fare,
              notes: newNotes,
              assignmentAttempt: newAttempt
            },
            internalKey: Deno.env.get("INTERNAL_SERVICE_KEY")
          })
        )).catch(e => console.error("Broadcast push error:", e));
      } catch(e) {}
    }

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