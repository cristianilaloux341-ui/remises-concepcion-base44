import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  
  try {
    const body = await req.json();
    const { orderData, sessionToken } = body;
    
    // 1. Crear el viaje inmediatamente. La selección de candidato ocurre sólo
    // en backend; assignRide sigue siendo la única barrera que confirma la reserva.
    const order = await b44.entities.RideOrder.create(orderData);
    
    const allAvailable = await b44.entities.Driver.filter({ status: "disponible" });
    // Compatible con Central y APK legacy: estar en servicio/libre alcanza.
    // current_base sólo da prioridad; nunca es requisito para ser ofertable.
    const drivers = allAvailable.filter(d =>
      !d.active_order_id && !d.active_ride_id && !d.reserved_order_id &&
      (d.dispatch_status == null || d.dispatch_status === "normal")
    );
    let assigned = false;

    const queueTime = (d) => {
      if (!d.queue_entered_at) return Infinity;
      const value = new Date(d.queue_entered_at).getTime();
      return Number.isNaN(value) ? Infinity : value;
    };

    const sortByQueue = (arr) => [...arr].sort((a, b) => {
      const tA = queueTime(a);
      const tB = queueTime(b);
      if (tA !== tB) return tA - tB;
      return (a.id || "").localeCompare(b.id || "");
    });

    const distanceKm = (lat1, lng1, lat2, lng2) => {
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLng = ((lng2 - lng1) * Math.PI) / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const tryAssign = async (driver) => {
      if (!driver || assigned) return false;
      try {
        const res = await b44.functions.invoke("assignRide", {
          orderId: order.id,
          driverId: driver.id,
          sessionToken: sessionToken || 'client_demo_token'
        });
        assigned = res?.data?.success === true;
        return assigned;
      } catch (e) {
        console.error(`client dispatch candidate ${driver.id} failed:`, e?.message || e);
        return false;
      }
    };

    // 2. Regla principal compatible: primero la zona propia del pasaje.
    // Dentro de la zona conservamos la cola actual para no cambiar el criterio
    // que ya entienden Central y los APK viejos.
    if (order.zone) {
      const zoneDrivers = sortByQueue(drivers.filter(d => d.current_base === order.zone));
      for (const driver of zoneDrivers) {
        if (await tryAssign(driver)) break;
      }
    }

    // 3. Si la zona no pudo cubrirlo, usar cercanía real al origen, igual que
    // la reasignación productiva. Choferes sin GPS siguen siendo compatibles y
    // quedan disponibles para el fallback por cola.
    if (!assigned && drivers.length > 0 && order.pickup_lat != null && order.pickup_lng != null) {
      const nearby = drivers
        .filter(d => d.current_lat != null && d.current_lng != null)
        .map(d => ({
          driver: d,
          distance: distanceKm(
            Number(order.pickup_lat), Number(order.pickup_lng),
            Number(d.current_lat), Number(d.current_lng)
          )
        }))
        .filter(x => Number.isFinite(x.distance))
        .sort((a, b) => a.distance - b.distance || queueTime(a.driver) - queueTime(b.driver));

      for (const candidate of nearby) {
        if (await tryAssign(candidate.driver)) break;
      }
    }

    // 4. Fallback legacy: si faltó GPS o hubo una carrera de asignación,
    // probar la cola global. assignRide vuelve a validar cada candidato de forma
    // atómica, por lo que un móvil tomado por otro pasaje no se pisa.
    if (!assigned && drivers.length > 0) {
      const globalDrivers = sortByQueue(drivers);
      for (const driver of globalDrivers) {
        if (await tryAssign(driver)) break;
      }
    }

    // Sin móvil disponible queda pendiente y la Central conserva control total.
    if (!assigned) {
      await b44.entities.RideOrder.update(order.id, { status: "pendiente" });
    }
    
    return Response.json({ success: true, orderId: order.id, assigned });
  } catch(e) {
    console.error("Error en clientCreateAndDispatchRide", e);
    return Response.json({ success: false, error: e.message }, { status: 500 });
  }
});