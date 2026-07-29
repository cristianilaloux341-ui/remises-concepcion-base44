import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const payload = await req.json();
  const { orderId } = payload;

  // Requerimos que el invocador sea un Operador (JWT verificado), Cliente o cuente con Internal Key
  if (!(await verifyRequestAuth(b44, payload, { allowOperator: true, allowClient: true }))) {
    return Response.json({ success: false, reason: 'unauthorized' }, { status: 401 });
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
    const targetDriverIds = availableDrivers.filter(d => d.fcm_token || d.push_subscription).map(d => d.id);

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
        await b44.functions.invoke("sendPushNotification", {
          action: "cancel_multiple", // Usamos cancel_multiple adaptado o un loop. 
          // Mejor usamos send a uno por uno, pero fire-and-forget
        });
        
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