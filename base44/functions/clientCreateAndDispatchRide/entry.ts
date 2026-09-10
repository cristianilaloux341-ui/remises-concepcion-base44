import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { findNextDriverInZone } from '../../shared/driverSelection.ts';
import { assignDriverToOrderAtomic } from '../../shared/DispatchLogic.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  
  try {
    const body = await req.json();
    const { orderData, sessionToken } = body;
    
    // 1. Crear el viaje en estado técnico de despacho. Así la Central no muestra
    // "pendiente" durante los milisegundos en que todavía estamos buscando candidato.
    const order = await b44.entities.RideOrder.create({
      ...orderData,
      status: "procesando_despacho"
    });

    // 2. Resolver y reservar en un único recorrido server-side. Antes se elegía
    // candidato y luego se invocaba assignRide, que volvía a leer Driver, Movil,
    // viajes activos y configuración. Esa duplicación era parte de la demora al
    // apretar "Crear viaje".
    let assigned = false;
    let assignedDriver: any = null;
    let newAttempt = (order.assignment_attempt || 0) + 1;
    let timeoutSeconds = 60;
    let autoReassignActive = true;

    if (order.zone) {
      const [nextDriver, tarifaConfigs] = await Promise.all([
        findNextDriverInZone(b44, order, null),
        b44.entities.TarifaConfig.list()
      ]);
      const config = tarifaConfigs[0] || {};
      timeoutSeconds = config.tiempo_maximo_respuesta_segundos ?? 60;
      autoReassignActive = config.auto_reasignacion_activa ?? true;

      if (nextDriver) {
        assignedDriver = nextDriver;
        const assignedAt = new Date().toISOString();
        order.assignment_attempt = newAttempt;
        order.offered_driver_ids = [...new Set([...(order.offered_driver_ids || []), nextDriver.id])];
        order.assigned_base = nextDriver.current_base;
        order.driver_name = nextDriver.name;
        order.assigned_at = assignedAt;
        order.offerExpiresAt = Date.now() + (timeoutSeconds * 1000);

        const token = crypto.randomUUID();
        try {
          assigned = await assignDriverToOrderAtomic(b44, order, nextDriver, token);
        } catch (e) {
          console.error('Fast dispatch atomic error', e);
          assigned = false;
        }

        if (assigned && autoReassignActive) {
          b44.functions.invoke("autoReassignOnTimeout", {
            orderId: order.id,
            driverId: nextDriver.id,
            timeoutSeconds,
            assignmentAttempt: newAttempt,
            internalKey: Deno.env.get("INTERNAL_SERVICE_KEY")
          }).catch(e => console.error("AutoReassign Trigger Error:", e));
        }
      }
    }

    // Si no hay candidato válido, recién ahí pasa a Pendientes.
    if (!assigned) {
      await b44.entities.RideOrder.update(order.id, {
        status: "pendiente",
        driver_id: null,
        driver_name: null,
        reserved_driver_id: null,
        assigned_base: null,
        reservation_token: null,
        offerExpiresAt: null
      });
    }

    return Response.json({
      success: true,
      orderId: order.id,
      assigned,
      status: assigned ? "ofrecido" : "pendiente"
    });
  } catch(e) {
    console.error("Error en clientCreateAndDispatchRide", e);
    return Response.json({ success: false, error: e.message }, { status: 500 });
  }
});