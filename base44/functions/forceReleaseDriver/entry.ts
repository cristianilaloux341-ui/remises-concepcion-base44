import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

const FORCE_CODE = '99';
const ACTIVE = new Set(['ofrecido','aceptado','en_camino','en_viaje','preasignado_proximo']);

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  try {
    const payload = await req.json();
    const { driverId, code } = payload || {};
    const authorized = await verifyRequestAuth(b44, payload, { allowOperator: true });
    if (!authorized) return Response.json({ success:false, reason:'unauthorized' }, { status:401 });
    if (String(code) !== FORCE_CODE) return Response.json({ success:false, reason:'invalid_code' }, { status:403 });
    if (!driverId) return Response.json({ success:false, reason:'missing_driver' }, { status:400 });

    const driver = await b44.entities.Driver.get(driverId).catch(() => null);
    if (!driver) return Response.json({ success:false, reason:'driver_not_found' }, { status:404 });

    const refs = [driver.active_ride_id, driver.reserved_order_id, driver.active_ride_id, driver.next_order_id].filter(Boolean);
    const orders:any[] = [];
    for (const id of [...new Set(refs)]) {
      const o = await b44.entities.RideOrder.get(id).catch(() => null);
      if (o) orders.push(o);
    }
    const validActive = orders.find(o => ACTIVE.has(o.status) &&
      (o.driver_id === driverId || o.reserved_driver_id === driverId || o.preassigned_driver_id === driverId));
    if (validActive) {
      return Response.json({ success:false, reason:'VALID_ACTIVE_RIDE', orderId:validActive.id, status:validActive.status });
    }

    const before = {
      status: driver.status,
      dispatch_status: driver.dispatch_status,
      active_ride_id: driver.active_ride_id || null,
      active_ride_id: driver.active_ride_id || null,
      reserved_order_id: driver.reserved_order_id || null,
      reservation_token: driver.reservation_token || null,
      next_order_id: driver.next_order_id || null,
      next_order_token: driver.next_order_token || null
    };

    // Código 99 sólo libera fantasmas. Si apareció cualquier vínculo nuevo desde la
    // lectura inicial (incluido segundo slot), el CAS no toca al móvil.
    const releaseQuery:any = { id: driverId };
    for (const field of ['active_ride_id','active_ride_id','reserved_order_id','next_order_id']) {
      const value = driver[field];
      releaseQuery[field] = value == null ? null : value;
    }
    const released = await b44.entities.Driver.updateMany(
      releaseQuery,
      { $set: {
        status:'disponible', dispatch_status:'normal', active_ride_id:null,
        reserved_order_id:null, reservation_token:null, driver_reservation_key:null,
        bloqueo_post_aceptacion_hasta:null
      }}
    );
    const releasedCount = Number(released?.updated ?? released?.modifiedCount ?? released?.matchedCount ?? released?.count ?? 0);
    if (releasedCount !== 1) {
      const fresh = await b44.entities.Driver.get(driverId).catch(() => null);
      return Response.json({
        success:false,
        reason:'CONCURRENT_CHANGE',
        driverId,
        current:{
          active_ride_id:fresh?.active_ride_id || null,
          active_ride_id:fresh?.active_ride_id || null,
          reserved_order_id:fresh?.reserved_order_id || null,
          next_order_id:fresh?.next_order_id || null
        }
      }, { status:409 });
    }

    if (driver.bloqueo_post_aceptacion_hasta && Number(driver.bloqueo_post_aceptacion_hasta) > Date.now()) {
      await b44.entities.AuditLog.create({
        action: 'DRIVER_POST_ACCEPT_BLOCK_RELEASED',
        user_type: 'sistema',
        user_name: 'forceReleaseDriver',
        details: 'Se liberó la ventana de bloqueo post-aceptación por liberación forzada',
        metadata: { driverId, origin: 'aceptacion' }
      }).catch(() => {});
    }

    await b44.entities.AuditLog.create({
      action:'DRIVER_FORCE_RELEASE_99', user_type:'operador', user_name: payload.operatorName || 'Central',
      details:`Liberación manual código 99 del móvil ${driver.name || driverId}. Solo se liberaron referencias sin viaje activo válido.`,
      metadata:{ driverId, before, checkedOrders: orders.map(o => ({id:o.id,status:o.status,driver_id:o.driver_id,reserved_driver_id:o.reserved_driver_id})) }
    }).catch(() => {});

    return Response.json({ success:true, driverId });
  } catch (e:any) {
    return Response.json({ success:false, reason:e?.message || 'error' }, { status:500 });
  }
});