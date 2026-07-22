import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { assignDriverToOrderAtomic } from '../../shared/DispatchLogic.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const payload = await req.json();
  const { orderId, driverId } = payload;

  const orderReq = await b44.entities.RideOrder.get(orderId);
  const driverReq = await b44.entities.Driver.get(driverId);
  
  if (!orderReq || !driverReq) {
    return Response.json({ success: false, reason: 'Not found' });
  }

  try {
    // 1. Penalize skipped drivers in queue
    if (driverReq.current_base && driverReq.status === "disponible") {
      const allDrivers = await b44.entities.Driver.filter({ status: "disponible", current_base: driverReq.current_base });
      const queue = allDrivers.sort((a, b) => {
        const tA = a.queue_entered_at ? new Date(a.queue_entered_at).getTime() : 0;
        const tB = b.queue_entered_at ? new Date(b.queue_entered_at).getTime() : 0;
        if (tA !== tB) return tA - tB;
        return (a.id || "").localeCompare(b.id || "");
      });
      const driverIndex = queue.findIndex(d => d.id === driverId);
      if (driverIndex > 0) {
        const skippedDrivers = queue.slice(0, driverIndex);
        const baseTime = new Date();
        await Promise.all(skippedDrivers.map((d, i) =>
          b44.entities.Driver.update(d.id, { queue_entered_at: new Date(baseTime.getTime() + (i * 1000)).toISOString() })
        ));
      }
    }

    // 2. Fetch config
    const tarifaConfigs = await b44.entities.TarifaConfig.list();
    const config = tarifaConfigs[0] || {};
    const timeoutSeconds = config.tiempo_maximo_respuesta_segundos ?? 60;
    const autoReassignActive = config.auto_reasignacion_activa ?? true;
    const autoAceptarViajes = config.auto_aceptar_viajes ?? false;

    const targetOrderStatus = autoAceptarViajes ? "aceptado" : "ofrecido";
    const targetDriverStatus = autoAceptarViajes ? "en_viaje" : "ofrecido";

    const newAttempt = (orderReq.assignment_attempt || 0) + 1;
    const offeredIds = [...(orderReq.offered_driver_ids || [])];
    if (!offeredIds.includes(driverId)) offeredIds.push(driverId);

    // Update basic tracking fields directly first, so Atomic gets the fresh object state
    orderReq.assignment_attempt = newAttempt;
    orderReq.offered_driver_ids = offeredIds;
    orderReq.assigned_base = driverReq.current_base;
    orderReq.driver_name = driverReq.name;

    await b44.entities.RideOrder.update(orderId, {
      offered_driver_ids: offeredIds,
      assignment_attempt: newAttempt,
      assigned_base: driverReq.current_base,
      driver_name: driverReq.name
    });

    // 3. Dispatch Logic Atomic Run (handles the lock, Push, and Audit)
    const token = crypto.randomUUID();
    let success = false;
    try {
        success = await assignDriverToOrderAtomic(b44, orderReq, driverReq, token);
    } catch (e) {
        console.warn("Atomic assign threw (e.g. pilot mismatch), fallback logic disabled for raw error.", e);
        success = false;
    }

    if (success) {
      // 4. Update statuses cleanly to mirror legacy UI behavior
      await b44.entities.Driver.update(driverId, { status: targetDriverStatus });
      if (targetOrderStatus !== 'ofrecido') {
        await b44.entities.RideOrder.update(orderId, { status: targetOrderStatus });
      }

      // 5. Trigger Reassignment if needed
      if (targetOrderStatus === "ofrecido" && autoReassignActive) {
        b44.functions.invoke("autoReassignOnTimeout", {
          orderId: orderId,
          driverId: driverId,
          timeoutSeconds: timeoutSeconds,
          assignmentAttempt: newAttempt
        }).catch(e => console.error("AutoReassign Trigger Error:", e));
      }
    } else {
        return Response.json({ success: false, reason: 'assignDriverToOrderAtomic failed' });
    }

    return Response.json({ success: true });
  } catch (e) {
    console.error("AssignRide Error:", e);
    return Response.json({ success: false, reason: e.message });
  }
});