import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { findNextDriverInZone } from '../../shared/driverSelection.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  
  try {
    const body = await req.json();
    const { orderData, sessionToken } = body;
    
    // Crear el viaje y resolver el primer candidato únicamente dentro de su zona.
    const order = await b44.entities.RideOrder.create({
      ...orderData,
      status: "procesando_despacho"
    });

    let assigned = false;
    if (order.zone) {
      // Si el primer candidato pierde la reserva por concurrencia (otro pasaje lo
      // tomó entre la lectura y el CAS), continuar con el siguiente de ESTA MISMA
      // zona. Un intento fallido no debe mandar a Pendientes mientras quede otro
      // móvil elegible en la cola.
      const excludedDriverIds = new Set<string>();
      const MAX_CANDIDATE_ATTEMPTS = 100;

      for (let attempt = 0; attempt < MAX_CANDIDATE_ATTEMPTS && !assigned; attempt++) {
        const nextDriver = await findNextDriverInZone(b44, order, excludedDriverIds);
        if (!nextDriver) break;

        excludedDriverIds.add(nextDriver.id);
        const res = await b44.functions.invoke("assignRide", {
          orderId: order.id,
          driverId: nextDriver.id,
          sessionToken: sessionToken || "client_demo_token",
          internalKey: Deno.env.get("INTERNAL_SERVICE_KEY")
        });
        assigned = res?.data?.success === true;
      }
    }

    // Pendiente REAL: dejar una marca explícita para que las protecciones de
    // compatibilidad distingan este caso de una escritura transitoria de APK vieja.
    // La búsqueda anterior ya recorrió todos los candidatos elegibles de la zona.
    if (!assigned) {
      await b44.entities.RideOrder.update(order.id, {
        status: "pendiente",
        driver_id: null,
        driver_name: null,
        reserved_driver_id: null,
        assigned_base: null,
        reservation_token: null,
        offerExpiresAt: null,
        processingAction: "PENDING_AUTHORIZED"
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