import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';
import { findNextDriverInZone } from '../../shared/driverSelection.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const b44 = base44.asServiceRole;
    const payload = await req.json();
    const { orderId, driverId, assignmentAttempt } = payload;

    if (!orderId || !driverId) {
      return Response.json({ success: false, reason: 'missing_params' }, { status: 400 });
    }

    const isAuthorized = await verifyRequestAuth(b44, payload, { allowDriverId: driverId });
    if (!isAuthorized) {
      return Response.json({ success: false, reason: 'unauthorized' }, { status: 401 });
    }

    const order = await b44.entities.RideOrder.get(orderId);
    if (!order) return Response.json({ success: false, reason: 'ORDER_NOT_FOUND' });

    if (order.status !== 'ofrecido' || order.reserved_driver_id !== driverId || order.assignment_attempt !== assignmentAttempt) {
      return Response.json({ success: false, reason: 'STALE_OR_EXPIRED' });
    }

    // El que rechaza vuelve al final de SU cola. La liberación está protegida por
    // orderId + reservation_token para no tocar una reserva nueva/concurrente.
    await b44.entities.Driver.updateMany(
      { id: driverId, reserved_order_id: orderId, reservation_token: order.reservation_token },
      { $set: {
        status: 'disponible',
        dispatch_status: 'normal',
        queue_entered_at: new Date().toISOString(),
        active_order_id: null,
        active_ride_id: null,
        reserved_order_id: null,
        reservation_token: null,
        manual_reservation_token: null,
        driver_reservation_key: null
      } }
    );

    b44.functions.invoke('sendPushNotification', {
      action: 'cancel_multiple',
      orderId: order.id,
      driversToCancel: [driverId],
      internalKey: Deno.env.get('INTERNAL_SERVICE_KEY')
    }).catch(e => console.error('Error cancelando push:', e));

    const tarifaConfigs = await b44.entities.TarifaConfig.list();
    const config = tarifaConfigs[0] || {};
    const timeoutSeconds = config.tiempo_maximo_respuesta_segundos ?? 60;
    const autoReassignActive = config.auto_reasignacion_activa ?? true;

    // Los candidatos que pierden una carrera se excluyen SOLO en memoria para esta
    // búsqueda. El RideOrder no se publica al candidato hasta que su reserva exista.
    const locallySkipped = new Set<string>();
    const baseOfferedIds = [...new Set([...(order.offered_driver_ids || []), driverId].filter(Boolean))];

    if (autoReassignActive) {
      while (true) {
        const selectionOrder = {
          ...order,
          offered_driver_ids: [...baseOfferedIds, ...locallySkipped]
        };
        const nextDriver = await findNextDriverInZone(b44, selectionOrder, driverId);
        if (!nextDriver) break;

        const nextReservationToken = crypto.randomUUID();

        // REGLA CRÍTICA: primero corroborar y reservar al móvil. Hasta que este CAS
        // no gane, el pasaje sigue perteneciendo a la oferta anterior y NO se envía.
        const reserveNext = await b44.entities.Driver.updateMany(
          {
            id: nextDriver.id,
            status: 'disponible',
            dispatch_status: 'normal',
            current_base: order.zone,
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
          // Cambió de estado entre selección y reserva: probar el siguiente de la
          // misma zona/cola, sin mostrar ni mandar este pasaje al candidato fallido.
          locallySkipped.add(nextDriver.id);
          continue;
        }

        // El intento y el reloj nacen recién DESPUÉS de asegurar el móvil.
        const newAttempt = assignmentAttempt + 1;
        const nextAssignedAt = new Date().toISOString();
        const nextOfferExpiresAt = Date.now() + timeoutSeconds * 1000;
        const offeredIds = [...new Set([...baseOfferedIds, ...locallySkipped, nextDriver.id])];

        const result = await b44.entities.RideOrder.updateMany(
          {
            id: orderId,
            status: 'ofrecido',
            reserved_driver_id: driverId,
            assignment_attempt: assignmentAttempt,
            reservation_token: order.reservation_token
          },
          { $set: {
            status: 'ofrecido',
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
            processingPhase: null,
            offered_driver_ids: offeredIds
          } }
        );

        if (result.updated !== 1) {
          // El pasaje cambió concurrentemente: deshacer únicamente NUESTRA reserva
          // y no enviar ningún push viejo/inválido.
          await b44.entities.Driver.updateMany(
            { id: nextDriver.id, reserved_order_id: orderId, reservation_token: nextReservationToken },
            { $set: {
              dispatch_status: 'normal',
              reserved_order_id: null,
              reservation_token: null
            } }
          );
          return Response.json({ success: false, reason: 'STALE_OR_EXPIRED' });
        }

        // Recién ahora existen juntas la reserva del móvil y la oferta del RideOrder.
        // Por eso el teléfono recibe siempre un assignmentAttempt vigente y completo.
        b44.functions.invoke('sendPushNotification', {
          action: 'send',
          driverId: nextDriver.id,
          orderId,
          orderData: {
            pickup_address: order.pickup_address,
            dropoff_address: order.dropoff_address,
            fare: order.fare,
            notes: order.notes,
            assignmentAttempt: newAttempt
          },
          internalKey: Deno.env.get('INTERNAL_SERVICE_KEY')
        }).catch(e => console.error('Error push en rejectRide:', e));

        b44.functions.invoke('autoReassignOnTimeout', {
          orderId,
          driverId: nextDriver.id,
          timeoutSeconds,
          assignmentAttempt: newAttempt,
          internalKey: Deno.env.get('INTERNAL_SERVICE_KEY')
        }).catch(e => console.error('AutoReassign Trigger Error:', e));

        await b44.entities.AuditLog.create({
          action: 'rechazar_viaje',
          user_type: 'chofer',
          user_name: 'Chofer',
          details: `Rechazó. Reasignado a ${nextDriver.name} después de confirmar reserva.`
        }).catch(() => {});

        return Response.json({ success: true, reassigned_to: nextDriver.name });
      }
    }

    // Solo queda pendiente cuando la cola válida de la MISMA zona se agotó.
    const pendingResult = await b44.entities.RideOrder.updateMany(
      {
        id: orderId,
        status: 'ofrecido',
        reserved_driver_id: driverId,
        assignment_attempt: assignmentAttempt,
        reservation_token: order.reservation_token
      },
      { $set: {
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
        processingPhase: null,
        offered_driver_ids: [...new Set([...baseOfferedIds, ...locallySkipped])]
      } }
    );

    if (pendingResult.updated !== 1) {
      return Response.json({ success: false, reason: 'STALE_OR_EXPIRED' });
    }

    await b44.entities.AuditLog.create({
      action: 'rechazar_viaje',
      user_type: 'chofer',
      user_name: 'Chofer',
      details: 'Rechazó. Sin candidatos válidos en la misma zona, quedó pendiente.'
    }).catch(() => {});

    return Response.json({ success: true, reassigned_to: null });
  } catch (error: any) {
    console.error('RejectRide Error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});