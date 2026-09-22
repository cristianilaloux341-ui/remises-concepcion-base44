import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { findNextDriverInZone } from '../../shared/driverSelection.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  
  try {
    const body = await req.json();
    const { orderData, sessionToken, manualDriverId, resolvedMobileId } = body;
    
    // Crear el viaje y resolver el primer candidato únicamente dentro de su zona.
    const order = await b44.entities.RideOrder.create({
      ...orderData,
      status: "procesando_despacho"
    });

    let assigned = false;

    if (manualDriverId) {
      const manualRes = await b44.functions.invoke("assignRide", {
        orderId: order.id,
        driverId: manualDriverId,
        mobileId: resolvedMobileId || null,
        requireDriverConfirmation: true,
        forceManual: true,
        sessionToken: sessionToken || "client_demo_token",
        internalKey: Deno.env.get("INTERNAL_SERVICE_KEY")
      });
      assigned = manualRes?.data?.success === true;
      if (!assigned) {
        await b44.entities.RideOrder.update(order.id, {
          status: "pendiente",
          processingAction: "PENDING_AUTHORIZED",
          pending_reason: "MANUAL_ASSIGN_FAILED"
        });
        return Response.json({ success:false, orderId:order.id, assigned:false, status:"pendiente", error:manualRes?.data?.reason || "MANUAL_ASSIGN_FAILED" }, { status:409 });
      }
      return Response.json({ success:true, orderId:order.id, assigned:true, status:"ofrecido" });
    }

    const zoneKey = String(order.zone || "").trim().toLowerCase();
    const isDirectPendingZone = zoneKey === "0" || zoneKey === "0-pendientes" || zoneKey === "0-pendiente";
    if (order.zone && !isDirectPendingZone) {
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

    // Si no hay móvil disponible en esa zona, queda en Pendientes.
    if (!assigned) {
      await b44.entities.RideOrder.update(order.id, {
        status: "pendiente",
        driver_id: null,
        driver_name: null,
        reserved_driver_id: null,
        assigned_base: null,
        reservation_token: null,
        offerExpiresAt: null,
        processingAction: "PENDING_AUTHORIZED",
        pending_reason: isDirectPendingZone ? "ZONE_0_DIRECT_PENDING" : "ZONE_EXHAUSTED_AT_CREATE"
      });
      await b44.entities.AuditLog.create({
        action: "PENDING_AUTHORIZED",
        user_type: "sistema",
        user_name: "clientCreateAndDispatchRide",
        details: isDirectPendingZone
          ? `Pendiente autorizado para ${order.id}: Zona 0`
          : `Pendiente autorizado para ${order.id}: zona sin candidatos`,
        metadata: { orderId: order.id, zone: order.zone || null, reason: isDirectPendingZone ? "ZONE_0_DIRECT_PENDING" : "ZONE_EXHAUSTED_AT_CREATE" }
      }).catch(() => {});
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