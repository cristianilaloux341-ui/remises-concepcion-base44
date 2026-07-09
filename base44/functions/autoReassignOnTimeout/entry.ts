import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Auto-reassign after X seconds if driver doesn't accept
// Llamada desde el frontend después de despachar un viaje (no bloqueante)
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { orderId, driverId, timeoutSeconds = 30 } = await req.json();

    if (!orderId) {
      return Response.json({ error: 'Missing orderId' }, { status: 400 });
    }

    // Responder inmediatamente al cliente (el timeout ocurre en background)
    setTimeout(async () => {
      try {
        // Esperar X segundos
        await new Promise(resolve => setTimeout(resolve, timeoutSeconds * 1000));

        // Revisar si la orden sigue en estado "ofrecido" (no aceptada)
        const orders = await base44.asServiceRole.entities.RideOrder.filter({ id: orderId });
        const order = orders[0];

        if (!order || !['ofrecido', 'pendiente'].includes(order.status)) {
          return; // Ya fue aceptada o completada
        }

        // Si el operador asignó el viaje manualmente a otro móvil en este tiempo, ignorar este timeout
        if (driverId && order.driver_id !== driverId) {
          return;
        }

        // Obtener driver actual
        const drivers = await base44.asServiceRole.entities.Driver.filter({ id: order.driver_id });
        const currentDriver = drivers[0];

        // Si el driver cambió a "en_viaje", no hacer nada
        if (currentDriver?.status === 'en_viaje') {
          return;
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
          return;
        }

        // Buscar siguiente en cola
        const lastBase = order.assigned_base;
        const sameBaseQueue = available
          .filter(d => d.current_base === lastBase)
          .sort((a, b) => new Date(a.queue_entered_at) - new Date(b.queue_entered_at));

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

        console.log(`Auto-reassigned order ${orderId} to driver ${nextDriver.name}`);
      } catch (e) {
        console.error(`Auto-reassign error:`, e.message);
      }
    }, 0); // Ejecutar en background

    return Response.json({ ok: true, timeout_started: true });
  } catch (err) {
    console.error(`Error in autoReassignOnTimeout:`, err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
});