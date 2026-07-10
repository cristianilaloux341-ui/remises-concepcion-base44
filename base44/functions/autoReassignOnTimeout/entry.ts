import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Auto-reassign after X seconds if driver doesn't accept
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { orderId, driverId, timeoutSeconds = 30 } = await req.json();

    if (!orderId) {
      return Response.json({ error: 'Missing orderId' }, { status: 400 });
    }

    // Esperar bloqueando la request para asegurar que el motor de Deno no suspenda el worker en background
    await new Promise(resolve => setTimeout(resolve, timeoutSeconds * 1000));

    try {
      // Revisar si la orden sigue en estado "ofrecido" (no aceptada)
      const orders = await base44.asServiceRole.entities.RideOrder.filter({ id: orderId });
      const order = orders[0];

      if (!order || ['aceptado', 'en_camino', 'en_viaje', 'completado', 'cancelado', 'rechazado'].includes(order.status)) {
        console.log(`Auto-reassign abortado: el viaje ${orderId} ya está en estado final/aceptado: ${order?.status}`);
        return Response.json({ ok: true, skipped: true }); 
      }

      // Si el operador asignó el viaje manualmente a otro móvil en este tiempo, ignorar este timeout
      if (driverId && order.driver_id && order.driver_id !== driverId) {
        console.log(`Auto-reassign abortado: el viaje ${orderId} fue asignado a otro móvil manualmente`);
        return Response.json({ ok: true, skipped: true });
      }

      // Obtener driver actual
      const drivers = await base44.asServiceRole.entities.Driver.filter({ id: driverId });
      const currentDriver = drivers[0];

      // Si el driver cambió a "en_viaje" o "disponible", ignorar
      if (currentDriver && ['en_viaje', 'disponible'].includes(currentDriver.status)) {
        console.log(`Auto-reassign abortado: el driver ${driverId} ya no está ofrecido (estado: ${currentDriver.status})`);
        // A menos que la orden siga colgada sin chofer y ofrecida (reparación)
        if (order.status === 'ofrecido' && order.driver_id === driverId) {
           console.log("Forzando reasignación porque la orden quedó en ofrecido con un driver que se liberó/ocupó");
        } else {
           return Response.json({ ok: true, skipped: true });
        }
      }

      // El chofer NO respondió — obtener todos los drivers disponibles
      const allDrivers = await base44.asServiceRole.entities.Driver.list();
      const offeredIds = order.offered_driver_ids || [];
      const available = allDrivers.filter(
        d => d.status === 'disponible' && d.current_base && !offeredIds.includes(d.id)
      );

      if (available.length === 0) {
        // Sin más choferes — volver a pendiente
        if (currentDriver && currentDriver.status === 'ofrecido') {
          await base44.asServiceRole.entities.Driver.update(currentDriver.id, {
            status: 'disponible'
          });
        }
        await base44.asServiceRole.entities.RideOrder.update(orderId, {
          status: 'pendiente',
          driver_id: null,
          driver_name: null,
        });
        return Response.json({ ok: true, reverted_to_pending: true });
      }

      // Buscar siguiente en cola
      const lastBase = order.assigned_base;
      const sameBaseQueue = available
        .filter(d => d.current_base === lastBase)
        .sort((a, b) => {
          const tA = a.queue_entered_at ? new Date(a.queue_entered_at).getTime() : 0;
          const tB = b.queue_entered_at ? new Date(b.queue_entered_at).getTime() : 0;
          return tA - tB;
        });

      const nextDriver = sameBaseQueue.length > 0 ? sameBaseQueue[0] : available[0];

      // Regresar al chofer anterior a disponible (por no responder a tiempo)
      if (currentDriver && currentDriver.status === 'ofrecido') {
        await base44.asServiceRole.entities.Driver.update(currentDriver.id, {
          status: 'disponible'
        });
      }

      // Marcar al nuevo chofer como ofrecido para sacarlo de la cola
      if (nextDriver) {
        await base44.asServiceRole.entities.Driver.update(nextDriver.id, {
          status: 'ofrecido'
        });
      }

      // Reasignar la orden
      await base44.asServiceRole.entities.RideOrder.update(orderId, {
        status: 'ofrecido',
        driver_id: nextDriver.id,
        driver_name: nextDriver.name,
        assigned_base: nextDriver.current_base,
        offered_driver_ids: [...offeredIds, currentDriver?.id].filter(Boolean),
      });

      console.log(`Auto-reassigned order ${orderId} to driver ${nextDriver?.name}`);
      return Response.json({ ok: true, reassigned_to: nextDriver?.name });
    } catch (e) {
      console.error(`Auto-reassign error:`, e.message);
      return Response.json({ error: e.message }, { status: 500 });
    }
  } catch (err) {
    console.error(`Error in autoReassignOnTimeout:`, err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
});