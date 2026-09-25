import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';
import { findNextDriverInZone } from '../../shared/driverSelection.ts';

const changed = (result: any) =>
  (result?.matchedCount ?? result?.modifiedCount ?? result?.updated ?? 0) === 1;

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const payload = await req.json();
  const { action = 'claim', orderId, driverId, asNext = false } = payload;

  if (!driverId || !(await verifyRequestAuth(b44, payload, { allowDriverId: driverId }))) {
    return Response.json({ success: false, reason: 'unauthorized' }, { status: 401 });
  }

  try {
    const driver = await b44.entities.Driver.get(driverId);
    if (!driver) return Response.json({ success: false, reason: 'driver_not_found' });
    if (driver.status === 'no_disponible') {
      return Response.json({ success: false, reason: 'driver_off_service' });
    }

    // La cartelera Pendientes debe respetar exactamente la misma habilitación real
    // del vehículo que el despacho automático. Un Driver puede quedar momentáneamente
    // como disponible aunque Central haya desactivado/suspendido su registro Movil.
    const driverMobileId = String(driver.vehicle_model || '');
    const linkedMovil = driverMobileId
      ? await b44.entities.Movil.get(driverMobileId).catch(() => null)
      : null;

    if (!linkedMovil || linkedMovil.activo === false || linkedMovil.fuera_de_servicio === true || linkedMovil.suspension_motivo) {
      return Response.json({ success: false, reason: 'mobile_off_service' });
    }

    if (action === 'promote') {
      const nextOrderId = driver.next_order_id;
      const token = driver.next_order_token;
      if (!nextOrderId || !token) {
        return Response.json({ success: true, promoted: false, reason: 'no_next_order' });
      }

      const order = await b44.entities.RideOrder.get(nextOrderId).catch(() => null);
      if (!order || order.status !== 'preasignado_proximo' ||
          order.preassigned_driver_id !== driverId || order.preassignment_token !== token) {
        await b44.entities.Driver.updateMany(
          { id: driverId, next_order_id: nextOrderId, next_order_token: token },
          { $set: { next_order_id: null, next_order_token: null } }
        );
        return Response.json({ success: true, promoted: false, reason: 'next_order_not_available' });
      }

      const freshDriver = await b44.entities.Driver.get(driverId).catch(() => null);
      if (!freshDriver || freshDriver.next_order_id !== nextOrderId || freshDriver.next_order_token !== token) {
        return Response.json({ success: false, promoted: false, reason: 'driver_state_changed' });
      }
      if (freshDriver.active_ride_id || freshDriver.reserved_order_id) {
        return Response.json({ success: false, promoted: false, reason: 'current_ride_not_finished' });
      }

      const orderRes = await b44.entities.RideOrder.updateMany(
        {
          id: nextOrderId,
          status: 'preasignado_proximo',
          preassigned_driver_id: driverId,
          preassignment_token: token
        },
        {
          $set: {
            status: 'aceptado',
            driver_id: driverId,
            driver_name: driver.name,
            assigned_base: order.zone || order.assigned_base || null,
            preassigned_driver_id: null,
            preassignment_token: null,
            preassigned_at: null
          }
        }
      );
      if (!changed(orderRes)) {
        return Response.json({ success: false, promoted: false, reason: 'order_changed' });
      }

      const driverRes = await b44.entities.Driver.updateMany(
        {
          id: driverId,
          next_order_id: nextOrderId,
          next_order_token: token,
          $and: [
            { $or: [{ active_ride_id: null }, { active_ride_id: { $exists: false } }] },
            { $or: [{ reserved_order_id: null }, { reserved_order_id: { $exists: false } }] }
          ]
        },
        {
          $set: {
            status: 'en_viaje',
            dispatch_status: 'normal',
            active_ride_id: nextOrderId,
            next_order_id: null,
            next_order_token: null
          }
        }
      );

      if (!changed(driverRes)) {
        await b44.entities.RideOrder.updateMany(
          { id: nextOrderId, status: 'aceptado', driver_id: driverId },
          { $set: {
            status: 'preasignado_proximo',
            driver_id: null,
            driver_name: null,
            preassigned_driver_id: driverId,
            preassignment_token: token,
            preassigned_at: order.preassigned_at || new Date().toISOString()
          } }
        );
        return Response.json({ success: false, promoted: false, reason: 'driver_busy' });
      }

      await b44.entities.AuditLog.create({
        action: 'NEXT_RIDE_PROMOTED',
        user_type: 'chofer',
        user_name: driver.name || driverId,
        details: `Próximo viaje ${nextOrderId} promovido sin alterar el viaje anterior`,
        metadata: { orderId: nextOrderId, driverId }
      }).catch(() => {});

      return Response.json({ success: true, promoted: true, orderId: nextOrderId });
    }

    if (!orderId) return Response.json({ success: false, reason: 'missing_order_id' });
    const order = await b44.entities.RideOrder.get(orderId);
    if (String(order?.notes || '').includes('[REVISION_CENTRAL_CANCELADO_CHOFER]')) {
      return Response.json({ success: false, reason: 'pending_central_review' });
    }

    // Invariante irreversible: un viaje que alguna vez fue aceptado/iniciado
    // no puede volver a entrar por la cartelera Pendientes aunque otro proceso
    // haya dejado erróneamente status='pendiente'. Evita revivir viajes ya hechos
    // o en curso como ocurrió con 6aa2275510fe4fb31e0005c2.
    const wasAlreadyStarted = Boolean(
      order?.ride_started_at ||
      order?.taximetro_iniciado === true ||
      ['ACCEPT', 'START', 'FINISH'].includes(String(order?.lastCompletedAction || '').toUpperCase())
    );
    if (wasAlreadyStarted) {
      await b44.entities.AuditLog.create({
        action: 'PENDING_RECLAIM_BLOCKED_STARTED_RIDE',
        user_type: 'sistema',
        user_name: driver.name || driverId,
        details: `Bloqueado intento de tomar como pendiente un viaje ya iniciado ${orderId}`,
        metadata: { orderId, driverId, currentStatus: order?.status, lastCompletedAction: order?.lastCompletedAction }
      }).catch(() => {});
      return Response.json({ success: false, reason: 'ride_already_started' });
    }

    // Retenciones exclusivas de Central (por ejemplo móvil requerido que no aceptó)
    // nunca se publican ni pueden ser tomadas desde la cartelera de choferes.
    if (order?.processingAction === 'CENTRAL_REVIEW_REQUIRED_DRIVER' ||
        order?.pending_reason === 'REQUESTED_DRIVER_NOT_ACCEPTED') {
      return Response.json({ success:false, reason:'central_review_only' });
    }

    if (!order || order.status !== 'pendiente' || order.driver_id || order.reserved_driver_id ||
        order.preassigned_driver_id) {
      return Response.json({ success: false, reason: 'already_taken' });
    }
    // Pendientes es una salida explícita del servidor, no sinónimo de status=pendiente.
    // Sólo el backend puede autorizar que una orden quede visible/reclamable.
    if (order.processingAction !== 'PENDING_AUTHORIZED') {
      return Response.json({ success: false, reason: 'pending_not_authorized' });
    }

    // REGLA ORIGINAL DE PENDIENTES: si todavía existe un móvil realmente disponible
    // en la zona del pasaje, la cartelera NO puede apropiárselo. Debe seguir por el
    // despacho automático respetando la cola de esa zona. Pendientes sólo queda
    // habilitado cuando el selector autoritativo confirma que no hay candidato.
    const zoneCandidate = await findNextDriverInZone(b44, order, null).catch(() => null);
    if (zoneCandidate) {
      await b44.entities.AuditLog.create({
        action: 'PENDING_CLAIM_BLOCKED_DRIVER_IN_ZONE',
        user_type: 'sistema',
        user_name: driver.name || driverId,
        details: `Bloqueado Pendientes para ${orderId}: hay móvil disponible en ${order.zone}`,
        metadata: { orderId, driverId, zone: order.zone, zoneDriverId: zoneCandidate.id, zoneDriverName: zoneCandidate.name }
      }).catch(() => {});
      return Response.json({ success: false, reason: 'driver_available_in_zone' });
    }

    // Si el motor todavía está cerrando/reasignando un intento, la orden no puede
    // ser reclamada aunque otro estado haya quedado momentáneamente visible.
    if (order.processingPhase === 'REASSIGNING') {
      return Response.json({ success: false, reason: 'automatic_reassignment_in_progress' });
    }

    const token = crypto.randomUUID();
    // Un estado "en_viaje" aislado puede haber quedado atrasado. Solo se reserva
    // como próximo si existen referencias reales a otro viaje o la app informa
    // explícitamente que mantiene un viaje/taxímetro actual en pantalla.
    const hasCurrentRide = !!(
      driver.active_ride_id || driver.reserved_order_id
    );
    const hasNextRide = !!driver.next_order_id;
    // Contrato comercial: máximo DOS pasajes vinculados por móvil.
    // Slot 1 = viaje actual/reservado. Slot 2 = próximo viaje, incluso si ambos
    // fueron tomados desde Pendientes. Dos llamadas concurrentes compiten por
    // next_order_id mediante CAS y sólo una puede ganar.
    if (hasCurrentRide && hasNextRide) {
      return Response.json({ success:false, reason:'driver_capacity_full' });
    }
    const queueAsNext = asNext === true || hasCurrentRide;

    if (queueAsNext) {
      if (hasNextRide) {
        return Response.json({ success: false, reason: 'driver_capacity_full' });
      }

      const driverRes = await b44.entities.Driver.updateMany(
        {
          id: driverId,
          status: { $ne: 'no_disponible' },
          $or: [
            { next_order_id: null },
            { next_order_id: { $exists: false } }
          ],
          // Si ya posee un viaje actual, éste es exactamente el segundo slot.
          // Si asNext fue pedido sin viaje actual, también se reserva sólo un slot próximo.
          ...(hasCurrentRide ? {
            // El snapshot que decidió usar el segundo slot puede quedar viejo si el
            // primer viaje termina en paralelo. Revalidar en el CAS que todavía
            // existe un primer slot evita dejar un próximo viaje huérfano.
            $and: [
              { $or:[
                { active_ride_id:{ $ne:null } },
                { reserved_order_id:{ $ne:null } }
              ] }
            ]
          } : {
            $and: [
              { $or:[{active_ride_id:null},{active_ride_id:{$exists:false}}] },
              { $or:[{reserved_order_id:null},{reserved_order_id:{$exists:false}}] }
            ]
          })
        },
        { $set: { next_order_id: orderId, next_order_token: token } }
      );
      if (!changed(driverRes)) {
        return Response.json({ success: false, reason: 'driver_capacity_full' });
      }

      const orderRes = await b44.entities.RideOrder.updateMany(
        {
          id: orderId,
          status: 'pendiente',
          $or: [
            { preassigned_driver_id: null },
            { preassigned_driver_id: { $exists: false } }
          ]
        },
        {
          $set: {
            status: 'preasignado_proximo',
            driver_id: driverId,
            preassigned_driver_id: driverId,
            preassignment_token: token,
            preassigned_at: new Date().toISOString(),
            driver_name: driver.name,
            claimed_from_pending: true,
            assigned_base: order.zone || null
          }
        }
      );

      if (!changed(orderRes)) {
        await b44.entities.Driver.updateMany(
          { id: driverId, next_order_id: orderId, next_order_token: token },
          { $set: { next_order_id: null, next_order_token: null } }
        );
        return Response.json({ success: false, reason: 'already_taken' });
      }

      await b44.entities.AuditLog.create({
        action: 'NEXT_RIDE_CLAIMED',
        user_type: 'chofer',
        user_name: driver.name || driverId,
        details: `Tomó ${orderId} como próximo viaje`,
        metadata: { orderId, driverId }
      }).catch(() => {});

      return Response.json({ success: true, claimed: true, mode: 'next', orderId });
    }

    const driverRes = await b44.entities.Driver.updateMany(
      {
        id: driverId,
        status: { $ne: 'no_disponible' },
        $and: [
          { $or: [{ active_ride_id: null }, { active_ride_id: { $exists: false } }] },
          { $or: [{ reserved_order_id: null }, { reserved_order_id: { $exists: false } }] },
          { $or: [{ next_order_id: null }, { next_order_id: { $exists: false } }] }
        ]
      },
      {
        $set: {
          status: 'en_viaje',
          dispatch_status: 'normal',
          active_ride_id: orderId,
          queue_authoritative_base: null,
          queue_position: null
        }
      }
    );
    if (!changed(driverRes)) {
      return Response.json({ success: false, reason: 'driver_busy' });
    }

    const orderRes = await b44.entities.RideOrder.updateMany(
      { id: orderId, status: 'pendiente' },
      {
        $set: {
          status: 'aceptado',
          driver_id: driverId,
          driver_name: driver.name,
          claimed_from_pending: true,
          assigned_base: order.zone || null
        }
      }
    );
    if (!changed(orderRes)) {
      await b44.entities.Driver.updateMany(
        { id: driverId, active_ride_id: orderId },
        { $set: { status: 'disponible', active_ride_id: null, queue_authoritative_base: driver.queue_authoritative_base || null, queue_position: driver.queue_position || null } }
      );
      return Response.json({ success: false, reason: 'already_taken' });
    }

    await b44.entities.AuditLog.create({
      action: 'PENDING_RIDE_CLAIMED',
      user_type: 'chofer',
      user_name: driver.name || driverId,
      details: `Tomó el pasaje pendiente ${orderId}`,
      metadata: { orderId, driverId }
    }).catch(() => {});

    return Response.json({ success: true, claimed: true, mode: 'current', orderId });
  } catch (error) {
    console.error('claimNextRide error', error);
    return Response.json({ success: false, reason: 'server_error', error: error.message }, { status: 500 });
  }
});
