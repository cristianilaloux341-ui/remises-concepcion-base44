import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';
import { findNextDriverInZone } from '../../shared/driverSelection.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const b44 = base44.asServiceRole;
    
    const payload = await req.json();
    const { orderId, driverId, assignmentAttempt, sessionToken } = payload;
    
    if (!orderId || !driverId) {
      return Response.json({ success: false, reason: "missing_params" }, { status: 400 });
    }

    const isAuthorized = await verifyRequestAuth(b44, payload, { allowDriverId: driverId });
    if (!isAuthorized) {
      return Response.json({ success: false, reason: "unauthorized" }, { status: 401 });
    }

    // 1. CAS RideOrder
    const order = await b44.entities.RideOrder.get(orderId);
    if (!order) return Response.json({ success: false, reason: "ORDER_NOT_FOUND" });
    
    if (order.status !== 'ofrecido' || order.reserved_driver_id !== driverId || order.assignment_attempt !== assignmentAttempt) {
      return Response.json({ success: false, reason: "STALE_OR_EXPIRED" });
    }

    // 2. Liberar al Driver
    await b44.entities.Driver.updateMany(
      { id: driverId, reserved_order_id: orderId, reservation_token: order.reservation_token },
      { $set: {
          status: "disponible",
          dispatch_status: "normal",
          queue_entered_at: new Date().toISOString(),
          active_order_id: null,
          active_ride_id: null,
          reserved_order_id: null,
          reservation_token: null,
          manual_reservation_token: null,
          driver_reservation_key: null
        }
      }
    );

    // Cancel push notification to the rejecting driver
    b44.functions.invoke('sendPushNotification', {
      action: 'cancel_multiple',
      orderId: order.id,
      driversToCancel: [driverId],
      internalKey: Deno.env.get("INTERNAL_SERVICE_KEY")
    }).catch(e => console.error("Error cancelando push:", e));

    // 3. Find next driver
    const nextDriver = await findNextDriverInZone(b44, order, driverId);

    // Fetch config
    const tarifaConfigs = await b44.entities.TarifaConfig.list();
    const config = tarifaConfigs[0] || {};
    const timeoutSeconds = config.tiempo_maximo_respuesta_segundos ?? 60;
    const autoReassignActive = config.auto_reasignacion_activa ?? true;

    if (nextDriver && autoReassignActive) {
      const newAttempt = assignmentAttempt + 1;
      const nextReservationToken = crypto.randomUUID();
      const nextAssignedAt = new Date().toISOString();
      const nextOfferExpiresAt = Date.now() + (timeoutSeconds * 1000);

      const result = await b44.entities.RideOrder.updateMany(
        {
          id: orderId,
          status: "ofrecido",
          reserved_driver_id: driverId,
          assignment_attempt: assignmentAttempt
        },
        {
          $set: {
            status: "ofrecido",
            driver_id: nextDriver.id,
            driver_name: nextDriver.name,
            reserved_driver_id: nextDriver.id,
            reservation_token: nextReservationToken,
            manual_reservation_token: null,
            assigned_base: nextDriver.current_base,
            offerExpiresAt: nextOfferExpiresAt,
            assignment_attempt: newAttempt,
            assigned_at: nextAssignedAt,
            processingAction: null,
            processingOperationKey: null,
            processingOwnerId: null,
            processingLeaseExpiresAt: null,
            processingPhase: null
          },
          $addToSet: { offered_driver_ids: driverId }
        }
      );

      if (result.updated === 1) {
        // Reserve next driver
        const reserveNext = await b44.entities.Driver.updateMany(
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
            reserved_order_id: orderId,
            reservation_token: nextReservationToken
          } }
        );

        if (reserveNext.updated !== 1) {
          // Fallback if driver became unavailable
          await b44.entities.RideOrder.updateMany(
            { id: orderId, status: 'ofrecido', reserved_driver_id: nextDriver.id, assignment_attempt: newAttempt, reservation_token: nextReservationToken },
            { $set: { status: 'pendiente', driver_id: null, driver_name: null, reserved_driver_id: null, reservation_token: null, assigned_base: null, assigned_at: null, offerExpiresAt: null } }
          );
          
          await b44.entities.AuditLog.create({
            action: 'rechazar_viaje',
            user_type: 'chofer',
            user_name: 'Chofer',
            details: `Rechazó. Siguiente móvil no disponible, quedó pendiente.`
          }).catch(() => {});
          
          return Response.json({ success: true, reassigned_to: null, reason: "next_driver_state_changed" });
        }

        // Send Push
        b44.functions.invoke('sendPushNotification', {
          action: 'send',
          driverId: nextDriver.id,
          orderId: orderId,
          orderData: {
            pickup_address: order.pickup_address,
            dropoff_address: order.dropoff_address,
            fare: order.fare,
            notes: order.notes,
            assignmentAttempt: newAttempt
          },
          internalKey: Deno.env.get("INTERNAL_SERVICE_KEY")
        }).catch(e => console.error("Error push en rejectRide:", e));

        // Enqueue autoReassign
        b44.functions.invoke("autoReassignOnTimeout", {
          orderId,
          driverId: nextDriver.id,
          timeoutSeconds,
          assignmentAttempt: newAttempt,
          internalKey: Deno.env.get("INTERNAL_SERVICE_KEY")
        }).catch(e => console.error("AutoReassign Trigger Error:", e));

        await b44.entities.AuditLog.create({
          action: 'rechazar_viaje',
          user_type: 'chofer',
          user_name: 'Chofer',
          details: `Rechazó. Reasignado a ${nextDriver.name}`
        }).catch(() => {});

        return Response.json({ success: true, reassigned_to: nextDriver.name });
      }
    }

    // 4. Si no hay siguiente o update falló
    await b44.entities.RideOrder.updateMany(
      {
        id: orderId,
        status: "ofrecido",
        reserved_driver_id: driverId,
        assignment_attempt: assignmentAttempt
      },
      {
        $set: {
          status: 'pendiente',
          driver_id: null,
          driver_name: null,
          reserved_driver_id: null,
          reservation_token: null,
          manual_reservation_token: null,
          assigned_at: null,
          offerExpiresAt: null,
          assigned_base: null,
          processingAction: null,
          processingOperationKey: null,
          processingOwnerId: null,
          processingLeaseExpiresAt: null,
          processingPhase: null
        },
        $addToSet: { offered_driver_ids: driverId }
      }
    );

    await b44.entities.AuditLog.create({
      action: 'rechazar_viaje',
      user_type: 'chofer',
      user_name: 'Chofer',
      details: `Rechazó. Sin candidatos, quedó pendiente.`
    }).catch(() => {});

    return Response.json({ success: true, reassigned_to: null });

  } catch (error: any) {
    console.error("RejectRide Error:", error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});