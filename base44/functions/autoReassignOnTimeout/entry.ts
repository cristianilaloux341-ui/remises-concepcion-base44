import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();
    const { orderId, driverId, timeoutSeconds = 60, assignmentAttempt } = payload;

    if (!(await verifyRequestAuth(base44.asServiceRole, payload))) {
      return Response.json({ success: false, reason: 'unauthorized' }, { status: 401 });
    }

    if (!orderId || !driverId) {
      return Response.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // Para evitar el límite estricto de 29s del API Gateway (Deno Deploy / Vercel),
    // procesamos la espera en bloques de máximo 25 segundos.
    // Si la función "devuelve" sin esperar, el runtime se suspende y el setTimeout se congela.
    const maxSleep = 25;
    
    if (timeoutSeconds > maxSleep) {
      await new Promise(resolve => setTimeout(resolve, maxSleep * 1000));
      
      // Chequear si el viaje ya fue aceptado antes de delegar el próximo salto
      const orders = await base44.asServiceRole.entities.RideOrder.filter({ id: orderId });
      const order = orders[0];
      if (!order || ['aceptado', 'en_camino', 'en_viaje', 'completado', 'cancelado', 'rechazado'].includes(order.status)) {
        return Response.json({ ok: true, skipped: true }); 
      }
      if (order.driver_id && order.driver_id !== driverId) {
        return Response.json({ ok: true, skipped: true });
      }

      // Fix "lo saca antes de cumplir el tiempo" - we must read the CURRENT order from DB before chaining 
      // to ensure it hasn't been modified or incremented while we slept.
      const freshOrder = await base44.asServiceRole.entities.RideOrder.get(orderId);
      if (freshOrder && freshOrder.assignment_attempt !== assignmentAttempt) {
         return Response.json({ ok: true, skipped: true, reason: 'attempt_changed' });
      }

      // Invocar la siguiente iteración con el tiempo restante para evitar que este proceso exceda los 29s
      base44.functions.invoke("autoReassignOnTimeout", {
        orderId,
        driverId,
        timeoutSeconds: timeoutSeconds - maxSleep,
        assignmentAttempt,
        internalKey: Deno.env.get("INTERNAL_SERVICE_KEY")
      }).catch(e => console.error("Chain Error:", e));
      
      return Response.json({ ok: true, chained: true, remaining: timeoutSeconds - maxSleep });
    }

    // Último tramo de espera (o si inicialmente fue menor a 25s)
    await new Promise(resolve => setTimeout(resolve, timeoutSeconds * 1000));

    try {
      const orders = await base44.asServiceRole.entities.RideOrder.filter({ id: orderId });
      const order = orders[0];
      
      if (!order || ['aceptado', 'en_camino', 'en_viaje', 'completado', 'cancelado', 'rechazado'].includes(order.status)) {
        return Response.json({ ok: true, skipped: true }); 
      }
      if (order.driver_id && order.driver_id !== driverId) {
        return Response.json({ ok: true, skipped: true });
      }
      if (order.assignment_attempt !== assignmentAttempt) {
        return Response.json({ ok: true, skipped: true, reason: 'attempt_changed' });
      }

      // El teléfono puede haber recibido el push con demora. native_ack extiende
      // offerExpiresAt para darle al chofer la ventana completa configurada.
      // Si todavía tiene tiempo real, reprogramar solo el remanente y no reasignar.
      const authoritativeExpiresAt = Number(order.offerExpiresAt);
      const remainingMs = Number.isFinite(authoritativeExpiresAt)
        ? authoritativeExpiresAt - Date.now()
        : 0;
      if (remainingMs > 0) {
        base44.functions.invoke("autoReassignOnTimeout", {
          orderId,
          driverId,
          timeoutSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
          assignmentAttempt,
          internalKey: Deno.env.get("INTERNAL_SERVICE_KEY")
        }).catch(e => console.error("Extended Timeout Chain Error:", e));
        return Response.json({
          ok: true,
          extended_for_device_receipt: true,
          remainingSeconds: Math.ceil(remainingMs / 1000)
        });
      }

      const drivers = await base44.asServiceRole.entities.Driver.filter({ id: driverId });
      const currentDriver = drivers[0];

      const { findNextDriverInZone } = await import('../../shared/driverSelection.ts');
      
      const nextDriver = await findNextDriverInZone(base44.asServiceRole, order, driverId);

      const newAttempt = (order.assignment_attempt || 0) + 1;
      const targetStatus = nextDriver ? 'ofrecido' : 'pendiente';
      // Cada reasignación es una oferta NUEVA. Nunca usar timeoutSeconds acá:
      // en este punto representa sólo el último tramo de la espera encadenada
      // (por ejemplo 5/10/20 s), no la ventana completa configurada.
      const tarifaConfigs = await base44.asServiceRole.entities.TarifaConfig.list();
      const autoReassignActive = tarifaConfigs[0]?.auto_reasignacion_activa ?? true;
      const originalTimeoutSeconds = tarifaConfigs[0]?.tiempo_maximo_respuesta_segundos ?? 60;
      const nextReservationToken = nextDriver ? crypto.randomUUID() : null;
      const nextAssignedAt = nextDriver ? new Date().toISOString() : null;
      const nextOfferExpiresAt = nextDriver ? Date.now() + (originalTimeoutSeconds * 1000) : null;
      // El historial debe incluir al NUEVO móvil antes de enviarle la oferta.
      // Si solo guardamos al anterior, findNextDriverInZone puede volver a elegir
      // al mismo móvil en el siguiente timeout.
      const offeredIds = [...new Set([
        ...(order.offered_driver_ids || []),
        currentDriver?.id,
        nextDriver?.id
      ].filter(Boolean))];

      // 1. Escritura Atómica Transaccional
      const result = await base44.asServiceRole.entities.RideOrder.updateMany(
        {
          id: orderId,
          status: "ofrecido",
          reserved_driver_id: driverId, 
          $or: [{ assignment_attempt: assignmentAttempt }, { assignment_attempt: null }]
        },
        {
          $set: {
            status: targetStatus,
            driver_id: nextDriver ? nextDriver.id : null,
            driver_name: nextDriver ? nextDriver.name : null,
            reserved_driver_id: nextDriver ? nextDriver.id : null,
            reservation_token: nextReservationToken,
            manual_reservation_token: null,
            assigned_base: nextDriver ? nextDriver.current_base : null,
            offerExpiresAt: nextOfferExpiresAt,
            processingAction: null,
            processingOperationKey: null,
            processingOwnerId: null,
            processingLeaseExpiresAt: null,
            processingPhase: null,
            assignment_attempt: newAttempt,
            assigned_at: nextAssignedAt,
            offered_driver_ids: offeredIds
          }
        }
      );

      // Si el viaje fue tomado por el chofer, cancelado, o un broadcast simultáneo sucedió (result = 0)
      if (result.updated === 0) {
         console.log(`Auto-reassign abortado: el viaje ${orderId} fue aceptado o alterado atómicamente durante el timeout.`);
         return Response.json({ ok: true, skipped: true });
      }

      // 2. Transacción Exitosa -> Solo aquí actualizamos Driver Status / Notificamos
      if (currentDriver) {
         try { 
           // Liberar SOLO si el móvil todavía pertenece a esta misma oferta.
           // Si otro operador ya lo reservó para otro pasaje, este timeout viejo no lo toca.
           await base44.asServiceRole.entities.Driver.updateMany(
             { id: currentDriver.id, reserved_order_id: order.id, reservation_token: order.reservation_token },
             { $set: {
               status: 'disponible',
               dispatch_status: 'normal',
               reserved_order_id: null,
               active_order_id: null,
               active_ride_id: null,
               reservation_token: null,
               manual_reservation_token: null,
               driver_reservation_key: null,
               queue_entered_at: new Date().toISOString()
             } }
           ); 
         } catch(e){}
         
         // Enviar cancelación explícita al chofer anterior
         try {
           await base44.asServiceRole.functions.invoke('sendPushNotification', {
             action: 'cancel_multiple',
             orderId: order.id,
             driversToCancel: [currentDriver.id],
             internalKey: Deno.env.get("INTERNAL_SERVICE_KEY")
           });
         } catch(e) {
           console.error("Error cancelando push del chofer anterior:", e);
         }
      }
      
      if (nextDriver) {
         // Espejar la reserva del RideOrder en el Driver, igual que assignRide.
         // Si el móvil dejó de estar libre entre la selección y este punto, no lo pisamos.
         const reserveNext = await base44.asServiceRole.entities.Driver.updateMany(
           {
             id: nextDriver.id,
             status: 'disponible',
             dispatch_status: 'normal',
             reserved_order_id: null,
             active_order_id: null,
             active_ride_id: null
           },
           { $set: {
             dispatch_status: 'automatic_pending',
             reserved_order_id: order.id,
             reservation_token: nextReservationToken
           } }
         );

         if ((reserveNext.matchedCount ?? reserveNext.modifiedCount ?? reserveNext.updated ?? 0) !== 1) {
           // El candidato cambió de estado mientras reasignábamos. No enviarle una oferta
           // que el servidor no pudo reservar; devolver la orden a pendiente de forma segura.
           await base44.asServiceRole.entities.RideOrder.updateMany(
             { id: order.id, status: 'ofrecido', reserved_driver_id: nextDriver.id, assignment_attempt: newAttempt, reservation_token: nextReservationToken },
             { $set: { status: 'pendiente', driver_id: null, driver_name: null, reserved_driver_id: null, reservation_token: null, assigned_base: null, assigned_at: null, offerExpiresAt: null } }
           );
           return Response.json({ ok: true, reassigned_to: null, reason: 'next_driver_state_changed' });
         }
         
         // Enviar notificación Push al siguiente chofer
         try {
           await base44.asServiceRole.functions.invoke('sendPushNotification', {
             action: 'send',
             driverId: nextDriver.id,
             orderId: order.id,
             orderData: {
               pickup_address: order.pickup_address,
               dropoff_address: order.dropoff_address,
               fare: order.fare,
               notes: order.notes,
               assignmentAttempt: newAttempt
             },
             internalKey: Deno.env.get("INTERNAL_SERVICE_KEY")
           });
         } catch(pushErr) {
           console.error("Error al enviar push en autoReassignOnTimeout:", pushErr);
         }
         
         if (autoReassignActive) {
            base44.functions.invoke("autoReassignOnTimeout", {
              orderId,
              driverId: nextDriver.id,
              timeoutSeconds: originalTimeoutSeconds,
              assignmentAttempt: newAttempt,
              internalKey: Deno.env.get("INTERNAL_SERVICE_KEY")
            }).catch(e => console.error("AutoReassign Trigger Error:", e));
         }
      }

      return Response.json({ ok: true, reassigned_to: nextDriver?.name });
    } catch (e) {
      console.error(`Auto-reassign error:`, e.message);
      return Response.json({ error: e.message }, { status: 500 });
    }
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});