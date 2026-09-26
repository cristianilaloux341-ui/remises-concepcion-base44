const defaultFailureInjector = { hit: async (point: string) => {} };

async function safeAuditLog(b44: any, data: any, failureInjector = defaultFailureInjector) {
  try {
    await failureInjector.hit('DURING_AUDIT_LOG');
    await b44.entities.AuditLog.create(data);
  } catch (e) {
    console.error("Fallo no destructivo en AuditLog:", e);
    // Fallback log de sistema
  }
}

export async function assignDriverToOrderAtomic(b44: any, order: any, driver: any, token: string, failureInjector = defaultFailureInjector) {
  let offerCommitted = false;
  try {
    // Sellar también la pertenencia y prioridad que fueron seleccionadas.
    // Si el móvil cambió de base/posición entre findNextDriverInZone y este CAS,
    // esta foto quedó vieja y la asignación debe perder la carrera.
    const driverRes = await b44.entities.Driver.updateMany(
      {
        id: driver.id,
        status: 'disponible',
        dispatch_status: 'normal',
        reserved_order_id: null,
        active_ride_id: null,
        next_order_id: null,
        queue_authoritative_base: driver.queue_authoritative_base ?? null,
        queue_position: driver.queue_position ?? null
      },
      { $set: { dispatch_status: 'automatic_pending', reserved_order_id: order.id, reservation_token: token } }
    );
    if ((driverRes.matchedCount ?? driverRes.modifiedCount ?? driverRes.updated ?? 0) !== 1) return false;

    await failureInjector.hit('AFTER_AUTO_DRIVER_RESERVE');

    // Persistir TODA la identidad/ventana de la oferta antes del push. Antes se
    // guardaban assignment_attempt/assigned_at/offerExpiresAt después de enviar
    // FCM, abriendo una carrera donde el teléfono podía aceptar contra metadatos viejos.
    const offerSet: any = {
      status: 'ofrecido',
      reservation_token: token,
      driver_id: driver.id,
      reserved_driver_id: driver.id,};
    for (const field of ['driver_name', 'assigned_base', 'assigned_at', 'offerExpiresAt', 'assignment_attempt', 'offered_driver_ids', 'notes', 'push_ack_at', 'push_ack_assignment_attempt', 'alert_presented_at', 'alert_presented_assignment_attempt', 'alert_presented_protocol_attempt', 'delivery_retry_count', 'pending_reason']) {
      if (order[field] !== undefined) offerSet[field] = order[field];
    }

    const rideRes = await b44.entities.RideOrder.updateMany(
      { 
        id: order.id,
        status: { $in: ['pendiente', 'procesando_despacho', 'ofrecido'] },
        $and: [
          {
            $or: [
              { reservation_token: null },
              { reservation_token: { $exists: false } },
              { reservation_token: order.reservation_token || null }
            ]
          },
          {
            // No reasignar mientras ACEPTAR / RECHAZAR / TIMEOUT posee el viaje.
            // Sin esta barrera una asignación de Central podía entrar en mitad del
            // rechazo anterior y dejar driver_id de un móvil y reserved_driver_id de otro.
            $or: [
              { processingOwnerId: null },
              { processingOwnerId: { $exists: false } },
              { processingLeaseExpiresAt: { $lt: Date.now() } }
            ]
          }
        ]
      },
      { $set: offerSet }
    );
    if ((rideRes.matchedCount ?? rideRes.modifiedCount ?? rideRes.updated ?? 0) !== 1) {
      // Rollback quirúrgico: liberar sólo si ESTE token todavía posee la reserva.
      // No tocar cola/base/posición; perder la carrera de un pasaje no penaliza al móvil.
      await b44.entities.Driver.updateMany(
        { id: driver.id, status:'disponible', dispatch_status:'automatic_pending', reserved_order_id:order.id, reservation_token:token },
        { $set: { dispatch_status: 'normal', reserved_order_id: null, reservation_token: null } }
      );
      return false;
    }

    // Desde este punto la oferta es estado comercial comprometido y MONÓTONO.
    // Ningún error posterior (auditoría/push/failure injection) puede devolverla
    // a procesando_despacho ni liberar su reserva. El watchdog decide entrega.
    offerCommitted = true;
    await failureInjector.hit('AFTER_RIDE_OFFER');
    await failureInjector.hit('BEFORE_PUSH');

    // Auditoría y FCM arrancan en paralelo: la escritura del log no debe retrasar
    // la salida del pasaje al teléfono. La oferta ya quedó persistida arriba.
    const assignmentAudit = safeAuditLog(b44, {
      action: 'RIDE_ASSIGNED',
      user_type: 'sistema',
      user_name: 'DispatchLogic',
      details: `Viaje ${order.id} asignado a ${driver.id}`
    }, failureInjector);

    // Trigger directo a sendPushNotification restaurado para eliminar la latencia de la automatización
    try {
      const pushPromise = b44.functions.invoke('sendPushNotification', {
        action: 'send',
        driverId: driver.id,
        orderId: order.id,
        orderData: {
          pickup_address: order.pickup_address,
          dropoff_address: order.dropoff_address,
          fare: order.fare,
          notes: order.notes,
          assignmentAttempt: order.assignment_attempt || 1
        },
        internalKey: Deno.env.get("INTERNAL_SERVICE_KEY")
      });
      const [pushResult] = await Promise.all([pushPromise, assignmentAudit]);

      if (pushResult && pushResult.data && pushResult.data.ok === false) {
         console.warn("Push devolvió false, ignorando para evitar rollback prematuro:", pushResult.data.error || pushResult.data.reason);
      }
    } catch (pushErr) {
      console.error("Error trigger push en DispatchLogic:", pushErr);
      // Eliminado el Failsafe de purga inmediata. El temporizador de 60s se encargará si el chofer no responde.
      await safeAuditLog(b44, { action: 'DELIVERY_WARNING', user_type: 'sistema', user_name: 'System', details: 'Fallo push, pero se mantiene asignación: ' + pushErr.message }, failureInjector);
    }
    
    return true;
  } catch (e) {
    if (!offerCommitted) {
      // Antes del commit comercial sí corresponde soltar únicamente nuestra reserva.
      await b44.entities.Driver.updateMany(
        { id:driver.id, status:'disponible', dispatch_status:'automatic_pending', reserved_order_id:order.id, reservation_token:token },
        { $set:{ dispatch_status:'normal', reserved_order_id:null, reservation_token:null } }
      );
    } else {
      // Después del commit jamás retroceder ofrecido→procesando_despacho.
      // Mantener dueño/token y dejar que el watchdog de entrega continúe el circuito.
      await safeAuditLog(b44, {
        action:'DELIVERY_ERROR_AFTER_OFFER_COMMIT',
        user_type:'sistema',
        user_name:'DispatchLogic',
        details:'Error posterior al commit de oferta; se conserva estado monotónico: ' + (e?.message || String(e)),
        metadata:{orderId:order.id,driverId:driver.id,token}
      }).catch(()=>{});
    }
    throw e;
  }
}
