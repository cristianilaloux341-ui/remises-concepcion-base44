import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { haversineMetros } from '../../shared/TaximetroLogic.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const payload = await req.json();

  const driver = payload.data;
  if (!driver || driver.status !== 'en_viaje' || !driver.current_lat || !driver.current_lng) {
    return Response.json({ success: true, skipped: true, reason: 'not_en_viaje' });
  }

  const orders = await b44.entities.RideOrder.filter({ driver_id: driver.id, status: 'en_viaje', taximetro_iniciado: true });
  const order = orders[0];
  if (!order) return Response.json({ success: true, skipped: true, reason: 'no_active_order' });

  const lat = driver.current_lat;
  const lng = driver.current_lng;
  const timestamp = new Date().toISOString();

  const previousTraces = await b44.entities.RideGpsTrace.filter({ order_id: order.id }, '-timestamp', 1);
  let metros_acumulados = 0;
  let vel_kmh = 0;

  if (previousTraces.length > 0) {
    const prev = previousTraces[0];
    const dist = haversineMetros(prev.lat, prev.lng, lat, lng);
    
    // Ignorar si se movió menos de 5 metros para no saturar DB
    if (dist < 5) return Response.json({ success: true, skipped: true, reason: 'too_close' });

    const timeDiff = (new Date(timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000;
    vel_kmh = timeDiff > 0 ? (dist / timeDiff) * 3.6 : 0;
    
    // Filtro contra saltos absurdos de GPS (10 km de golpe)
    if (dist < 10000) {
      metros_acumulados = prev.metros_acumulados + dist;
    } else {
      metros_acumulados = prev.metros_acumulados;
    }
  }

  await b44.entities.RideGpsTrace.create({
    order_id: order.id,
    driver_id: driver.id,
    lat,
    lng,
    timestamp,
    metros_acumulados,
    velocidad_kmh: vel_kmh
  });

  return Response.json({ success: true });
});