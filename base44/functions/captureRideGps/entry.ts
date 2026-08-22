import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { haversineMetros } from '../../shared/TaximetroLogic.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;

  const now = new Date();
  const minuteStamp = new Date(Math.floor(now.getTime() / 60000) * 60000).toISOString();
  const LOCK_ZONE = 'GPS_CAPTURE_LOCK';
  let lockConfigs = await b44.entities.DispatchConfig.filter({ zone: LOCK_ZONE });
  if (lockConfigs.length === 0) {
    await b44.entities.DispatchConfig.create({ zone: LOCK_ZONE, notes: '0' });
    lockConfigs = await b44.entities.DispatchConfig.filter({ zone: LOCK_ZONE });
  }
  const lastRun = lockConfigs[0].notes || '0';
  if (lastRun === minuteStamp) {
    return Response.json({ status: 'skipped', reason: 'already_ran_this_minute' });
  }
  await b44.entities.DispatchConfig.updateMany({ zone: LOCK_ZONE }, { $set: { notes: minuteStamp } });

  const activeOrders = await b44.entities.RideOrder.filter({ status: 'en_viaje', taximetro_iniciado: true });
  if (activeOrders.length === 0) return Response.json({ success: true, count: 0 });

  const tracesToCreate = [];

  for (const order of activeOrders) {
    if (!order.driver_id) continue;
    const drivers = await b44.entities.Driver.filter({ id: order.driver_id });
    const driver = drivers[0];
    if (!driver || !driver.current_lat || !driver.current_lng) continue;

    const lat = driver.current_lat;
    const lng = driver.current_lng;
    const timestamp = new Date().toISOString();

    const previousTraces = await b44.entities.RideGpsTrace.filter({ order_id: order.id }, '-timestamp', 1);
    let metros_acumulados = 0;
    let vel_kmh = 0;

    if (previousTraces.length > 0) {
      const prev = previousTraces[0];
      const dist = haversineMetros(prev.lat, prev.lng, lat, lng);
      
      const timeDiff = (new Date(timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000;
      vel_kmh = timeDiff > 0 ? (dist / timeDiff) * 3.6 : 0;
      
      if (dist < 500) {
        metros_acumulados = prev.metros_acumulados + dist;
      } else {
        metros_acumulados = prev.metros_acumulados;
      }
    }

    tracesToCreate.push({
      order_id: order.id,
      driver_id: driver.id,
      lat,
      lng,
      timestamp,
      metros_acumulados,
      velocidad_kmh: vel_kmh
    });
  }

  if (tracesToCreate.length > 0) {
    await b44.entities.RideGpsTrace.bulkCreate(tracesToCreate);
  }

  return Response.json({ success: true, count: tracesToCreate.length });
});