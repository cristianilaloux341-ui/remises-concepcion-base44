import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

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
    const driverMobileNumber = parseInt(driverMobileId, 10);
    const driverPlateRaw = String(driver.vehicle_plate || '').trim();
    const driverPlate = driverPlateRaw.replace(/\s+/g, '').toUpperCase();
    const movilLookup: any[] = [
      { driver_id: driverId },
      { driver_ids: { $in: [driverId] } }
    ];
    if (driverMobileId) movilLookup.push({ id: driverMobileId });
    if (Number.isFinite(driverMobileNumber)) movilLookup.push({ numero_movil: driverMobileNumber });
    if (driverPlateRaw) movilLookup.push({ dominio: driverPlateRaw });

    const directMovil = driverMobileId
      ? await b44.entities.Movil.get(driverMobileId).catch(() => null)
      : null;
    const fallbackMoviles = await b44.entities.Movil.filter({ $or: movilLookup }).catch(() => []);
    const linkedMoviles = directMovil ? [directMovil, ...fallbackMoviles] : fallbackMoviles;
    const linkedMovil = linkedMoviles.find((m: any) =>
      m.id === driverMobileId ||
      m.numero_movil === driverMobileNumber ||
      m.driver_id === driverId ||
      (Array.isArray(m.driver_ids) && m.driver_ids.includes(driverId)) ||
      (driverPlate && String(m.dominio || '').replace(/\s+/g, '').toUpperCase() === driverPlate)
    );
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

      if (driver.active_order_id || driver.active_ride_id || driver.reserved_order_id) {
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
            assigned_base: driver.current_base || order.assigned_base || order.zone || null,
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
          $or: [
            { active_order_id: null },
            { active_order_id: { $exists: false } }
          ],
          $and: [
            { $or: [{ active_ride_id: null }, { active_ride_id: { $exists: false } }] },
            { $or: [{ reserved_order_id: null }, { reserved_order_id: { $exists: false } }] }
          ]
        },
        {
          $set: {
            status: 'en_viaje',
            dispatch_status: 'normal',
            active_order_id: nextOrderId,
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

    if (!order || order.status !== 'pendiente' || order.driver_id || order.reserved_driver_id ||
        order.preassigned_driver_id) {
      return Response.json({ success: false, reason: 'already_taken' });
    }

    const token = crypto.randomUUID();
    // Un estado "en_viaje" aislado puede haber quedado atrasado. Solo se reserva
    // como próximo si existen referencias reales a otro viaje o la app informa
    // explícitamente que mantiene un viaje/taxímetro actual en pantalla.
    const hasCurrentRide = !!(
      driver.active_order_id || driver.active_ride_id || driver.reserved_order_id
    );
    const queueAsNext = asNext === true || hasCurrentRide;

    if (queueAsNext) {
      if (driver.next_order_id) {
        return Response.json({ success: false, reason: 'driver_already_has_next' });
      }

      const driverRes = await b44.entities.Driver.updateMany(
        {
          id: driverId,
          status: { $ne: 'no_disponible' },
          $or: [
            { next_order_id: null },
            { next_order_id: { $exists: false } }
          ]
        },
        { $set: { next_order_id: orderId, next_order_token: token } }
      );
      if (!changed(driverRes)) {
        return Response.json({ success: false, reason: 'driver_already_has_next' });
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
            assigned_base: driver.current_base || order.zone || null
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
        $or: [
          { active_order_id: null },
          { active_order_id: { $exists: false } }
        ],
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
          active_order_id: orderId,
          active_ride_id: orderId
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
          assigned_base: driver.current_base || order.zone || null
        }
      }
    );
    if (!changed(orderRes)) {
      await b44.entities.Driver.updateMany(
        { id: driverId, active_order_id: orderId, active_ride_id: orderId },
        { $set: { status: 'disponible', active_order_id: null, active_ride_id: null } }
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
