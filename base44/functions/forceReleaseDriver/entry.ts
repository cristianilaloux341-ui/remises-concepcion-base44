import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

const FORCE_CODE = '99';
const ACTIVE = new Set(['ofrecido','aceptado','en_camino','en_viaje']);

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

    const refs = [driver.active_order_id, driver.reserved_order_id, driver.active_ride_id].filter(Boolean);
    const orders:any[] = [];
    for (const id of [...new Set(refs)]) {
      const o = await b44.entities.RideOrder.get(id).catch(() => null);
      if (o) orders.push(o);
    }
    const validActive = orders.find(o => ACTIVE.has(o.status) && (o.driver_id === driverId || o.reserved_driver_id === driverId));
    if (validActive) {
      return Response.json({ success:false, reason:'VALID_ACTIVE_RIDE', orderId:validActive.id, status:validActive.status });
    }

    const before = {
      status: driver.status,
      dispatch_status: driver.dispatch_status,
      active_order_id: driver.active_order_id || null,
      active_ride_id: driver.active_ride_id || null,
      reserved_order_id: driver.reserved_order_id || null,
      reservation_token: driver.reservation_token || null
    };

    await b44.entities.Driver.updateMany(
      { id: driverId },
      { $set: {
        status:'disponible', dispatch_status:'normal', active_order_id:null, active_ride_id:null,
        reserved_order_id:null, reservation_token:null, manual_reservation_token:null, driver_reservation_key:null
      }}
    );

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