import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { verifyRequestAuth } from '../../shared/security.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();
    const { orderId, driverId, timeoutSeconds = 60, assignmentAttempt } = payload;

    if (!(await verifyRequestAuth(base44.asServiceRole, payload))) {
      return Response.json({ success: false, reason: 'unauthorized' }, { status: 401 });
    }

    if (!orderId || !driverId) {
      return Response.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // Bloquear proceso en background
    await new Promise(resolve => setTimeout(resolve, timeoutSeconds * 1000));

    try {
      const orders = await base44.asServiceRole.entities.RideOrder.filter({ id: orderId });
      const order = orders[0];
      
      if (!order || ['aceptado', 'en_camino', 'en_viaje', 'completado', 'cancelado', 'rechazado'].includes(order.status)) {
        return Response.json({ ok: true, skipped: true }); 
      }
      if (order.driver_id && order.driver_id !== driverId) {
        return Response.json({ ok: true, skipped: true });
      }

      const drivers = await base44.asServiceRole.entities.Driver.filter({ id: driverId });
      const currentDriver = drivers[0];

      const allDrivers = await base44.asServiceRole.entities.Driver.list();
      const offeredIds = order.offered_driver_ids || [];
      const available = allDrivers.filter(d => d.status === 'disponible' && d.current_base && !offeredIds.includes(d.id));

      let nextDriver = null;
      if (available.length > 0) {
        const lastBase = order.assigned_base || order.zone;
        const sameBaseQueue = available
          .filter(d => d.current_base === lastBase)
          .sort((a, b) => {
            const tA = a.queue_entered_at ? new Date(a.queue_entered_at).getTime() : 0;
            const tB = b.queue_entered_at ? new Date(b.queue_entered_at).getTime() : 0;
            return tA - tB;
          });
        
        if (sameBaseQueue.length > 0) {
          nextDriver = sameBaseQueue[0];
        } else {
          // Haversine distance calc for closest fallback
          const getDistance = (lat1, lng1, lat2, lng2) => {
            const R = 6371; const dLat = ((lat2 - lat1) * Math.PI) / 180; const dLng = ((lng2 - lng1) * Math.PI) / 180;
            const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          };
          
          if (order.pickup_lat && order.pickup_lng) {
            let minDistance = Infinity;
            for (const d of available) {
              if (d.current_lat && d.current_lng) {
                const dist = getDistance(order.pickup_lat, order.pickup_lng, d.current_lat, d.current_lng);
                if (dist < minDistance) {
                  minDistance = dist;
                  nextDriver = d;
                }
              }
            }
          }
          if (!nextDriver) {
            nextDriver = available.sort((a, b) => {
              const tA = a.queue_entered_at ? new Date(a.queue_entered_at).getTime() : 0;
              const tB = b.queue_entered_at ? new Date(b.queue_entered_at).getTime() : 0;
              return tA - tB;
            })[0];
          }
        }
      }

      const newAttempt = (order.assignment_attempt || 0) + 1;
      const targetStatus = nextDriver ? 'ofrecido' : 'pendiente';

      // 1. Escritura Atómica Transaccional
      const result = await base44.asServiceRole.entities.RideOrder.updateMany(
        {
          id: orderId,
          status: "ofrecido",
          reserved_driver_id: driverId, // Debe buscar por el chofer reservado, no el definitivo
          $or: [{ assignment_attempt: assignmentAttempt }, { assignment_attempt: null }]
        },
        {
          $set: {
            status: targetStatus,
            driver_id: nextDriver ? nextDriver.id : null,
            driver_name: nextDriver ? nextDriver.name : null,
            reserved_driver_id: nextDriver ? nextDriver.id : null,
            reservation_token: null,
            assigned_base: nextDriver ? nextDriver.current_base : null,
            assignment_attempt: newAttempt
          },
          $addToSet: { offered_driver_ids: currentDriver?.id }
        }
      );

      // Si el viaje fue tomado por el chofer, cancelado, o un broadcast simultáneo sucedió (result = 0)
      if (result.updated === 0) {
         console.log(`Auto-reassign abortado: el viaje ${orderId} fue aceptado o alterado atómicamente durante el timeout.`);
         return Response.json({ ok: true, skipped: true });
      }

      // 2. Transacción Exitosa -> Solo aquí actualizamos Driver Status / Notificamos
      if (currentDriver) {
         try { 
           await base44.asServiceRole.entities.Driver.update(currentDriver.id, { 
             status: 'disponible',
             dispatch_status: 'normal',
             reserved_order_id: null,
             reservation_token: null
           }); 
         } catch(e){}
      }
      
      if (nextDriver) {
         try { await base44.asServiceRole.entities.Driver.update(nextDriver.id, { status: 'ofrecido' }); } catch(e){}
         
         const tarifaConfigs = await base44.asServiceRole.entities.TarifaConfig.list();
         const autoReassignActive = tarifaConfigs[0]?.auto_reasignacion_activa ?? true;
         
         if (autoReassignActive) {
            base44.functions.invoke("autoReassignOnTimeout", {
              orderId,
              driverId: nextDriver.id,
              timeoutSeconds,
              assignmentAttempt: newAttempt
            }).catch(e => console.error("AutoReassign Trigger Error:", e));
         }
      }

      return Response.json({ ok: true, reassigned_to: nextDriver?.name });
    } catch (e) {
      console.error(`Auto-reassign error:`, e.message);
      return Response.json({ error: e.message }, { status: 500 });
    }
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});