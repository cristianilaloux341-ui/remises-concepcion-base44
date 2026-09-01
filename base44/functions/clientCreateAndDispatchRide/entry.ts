import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

const MAX_ASSIGN_ATTEMPTS = 8;

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;

  try {
    const body = await req.json();
    const { orderData, sessionToken } = body || {};
    if (!orderData?.client_id || !sessionToken) {
      return Response.json({ success:false, reason:'missing_client_session' }, { status:400 });
    }

    const authorized = await verifyRequestAuth(b44, { ...body, clientId: orderData.client_id }, { allowClientId: orderData.client_id });
    if (!authorized) return Response.json({ success:false, reason:'unauthorized' }, { status:401 });

    const order = await b44.entities.RideOrder.create(orderData);

    const [allAvailable, allMoviles] = await Promise.all([
      b44.entities.Driver.filter({ status:'disponible' }),
      b44.entities.Movil.list().catch(() => [])
    ]);

    const isDriverWorking = (d) => {
      if (!d || d.status !== 'disponible') return false;
      if (d.active_order_id || d.active_ride_id || d.reserved_order_id) return false;
      if (d.dispatch_status != null && d.dispatch_status !== 'normal') return false;
      const mobileId = String(d.vehicle_model || '');
      const mobileNumber = parseInt(mobileId, 10);
      const movil = allMoviles.find(m => String(m.id) === mobileId || Number(m.numero_movil) === mobileNumber);
      return !(movil && (movil.activo === false || movil.fuera_de_servicio === true));
    };

    const drivers = allAvailable.filter(isDriverWorking);
    const queueTime = (d) => {
      if (!d.queue_entered_at) return Infinity;
      const value = new Date(d.queue_entered_at).getTime();
      return Number.isNaN(value) ? Infinity : value;
    };
    const sortByQueue = (arr) => [...arr].sort((a,b) => queueTime(a)-queueTime(b) || String(a.id||'').localeCompare(String(b.id||'')));
    const distanceKm = (lat1,lng1,lat2,lng2) => {
      const R=6371; const dLat=((lat2-lat1)*Math.PI)/180; const dLng=((lng2-lng1)*Math.PI)/180;
      const a=Math.sin(dLat/2)**2+Math.cos((lat1*Math.PI)/180)*Math.cos((lat2*Math.PI)/180)*Math.sin(dLng/2)**2;
      return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
    };

    // Construimos una única lista ordenada y sin duplicados: zona -> cercanía -> cola global.
    // Así un mismo móvil no recibe varios intentos dentro de la misma creación y limitamos
    // escrituras/latencia. assignRide sigue siendo la autoridad atómica final.
    const candidates = [];
    const seen = new Set();
    const add = (d) => { if (d?.id && !seen.has(d.id)) { seen.add(d.id); candidates.push(d); } };

    if (order.zone) sortByQueue(drivers.filter(d => d.current_base === order.zone)).forEach(add);

    const pickupLat = Number(order.pickup_lat);
    const pickupLng = Number(order.pickup_lng);
    if (Number.isFinite(pickupLat) && Number.isFinite(pickupLng)) {
      drivers
        .filter(d => Number.isFinite(Number(d.current_lat)) && Number.isFinite(Number(d.current_lng)))
        .map(d => ({ driver:d, distance:distanceKm(pickupLat,pickupLng,Number(d.current_lat),Number(d.current_lng)) }))
        .filter(x => Number.isFinite(x.distance))
        .sort((a,b) => a.distance-b.distance || queueTime(a.driver)-queueTime(b.driver))
        .forEach(x => add(x.driver));
    }
    sortByQueue(drivers).forEach(add);

    let assigned = false;
    let attempts = 0;
    for (const driver of candidates) {
      if (attempts >= MAX_ASSIGN_ATTEMPTS) break;
      attempts += 1;
      try {
        const res = await b44.functions.invoke('assignRide', {
          orderId:order.id,
          driverId:driver.id,
          sessionToken
        });
        if (res?.data?.success === true) { assigned = true; break; }
      } catch (e) {
        console.error(`client dispatch candidate ${driver.id} failed:`, e?.message || e);
      }
    }

    if (!assigned) await b44.entities.RideOrder.update(order.id, { status:'pendiente' });

    return Response.json({ success:true, orderId:order.id, assigned, attempts });
  } catch(e:any) {
    console.error('Error en clientCreateAndDispatchRide', e);
    return Response.json({ success:false, error:e?.message || 'error' }, { status:500 });
  }
});