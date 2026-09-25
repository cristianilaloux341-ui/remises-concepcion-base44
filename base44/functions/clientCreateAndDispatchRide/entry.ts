import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { findNextDriverInZone } from '../../shared/driverSelection.ts';
import { verifyRequestAuth } from '../../shared/security.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  
  try {
    const body = await req.json();
    const { orderData, sessionToken, manualDriverId, resolvedMobileId, requestedDriverOnly = false } = body;

    // Mientras se reconstruye Clientes, esta entrada pertenece a Central.
    // Ningún cliente puede crear una orden que active el motor de despacho por esta ruta.
    const authorized = await verifyRequestAuth(b44, body, { allowOperator:true });
    if (!authorized) {
      return Response.json({ success:false, error:"UNAUTHORIZED_OPERATOR" }, { status:401 });
    }
    
    // Crear el viaje y resolver el primer candidato únicamente dentro de su zona.
    const order = await b44.entities.RideOrder.create({
      ...orderData,
      status: "procesando_despacho",
      requested_driver_id: requestedDriverOnly && manualDriverId ? manualDriverId : null,
      requested_driver_only: requestedDriverOnly === true && Boolean(manualDriverId)
    });

    let assigned = false;

    if (manualDriverId) {
      const manualRes = await b44.functions.invoke("assignRide", {
        orderId: order.id,
        driverId: manualDriverId,
        mobileId: resolvedMobileId || null,
        requireDriverConfirmation: true,
        forceManual: true,
        sessionToken: sessionToken || null,
        internalKey: Deno.env.get("INTERNAL_SERVICE_KEY")
      });
      assigned = manualRes?.data?.success === true;
      const manualMode = manualRes?.data?.mode || null;
      if (!assigned) {
        const requestedHold = requestedDriverOnly === true && Boolean(manualDriverId);
        // Una asignación manual común fallida NO demuestra que la zona esté
        // agotada y por lo tanto no puede publicar PENDING_AUTHORIZED. Sólo el
        // selector canónico de zona puede autorizar Pendientes. La orden queda
        // retenida para Central; si era un requerido conserva su motivo específico.
        await b44.entities.RideOrder.update(order.id, {
          status: "pendiente",
          driver_id:null,
          driver_name:null,
          reserved_driver_id:null,
          reservation_token:null,
          offerExpiresAt:null,
          processingAction: requestedHold ? "CENTRAL_REVIEW_REQUIRED_DRIVER" : "CENTRAL_REVIEW_MANUAL_ASSIGN_FAILED",
          pending_reason: requestedHold ? "REQUESTED_DRIVER_NOT_ACCEPTED" : "MANUAL_ASSIGN_FAILED"
        });
        return Response.json({
          success:false,
          orderId:order.id,
          assigned:false,
          status:"pendiente",
          centralReview:true,
          error:manualRes?.data?.reason || "MANUAL_ASSIGN_FAILED"
        }, { status:409 });
      }
      // Si el móvil ya tiene un viaje, assignRide puede ocupar su segundo slot.
      // Ese pasaje NO es una oferta viva: queda preasignado hasta que el backend
      // termine/promueva el primero.
      return Response.json({
        success:true,
        orderId:order.id,
        assigned:true,
        mode: manualMode,
        status: manualMode === "next" ? "preasignado_proximo" : "ofrecido"
      });
    }

    const zoneKey = String(order.zone || "").trim().toLowerCase();
    const isDirectPendingZone = zoneKey === "0" || zoneKey === "0-pendientes" || zoneKey === "0-pendiente";
    if (!zoneKey) {
      await b44.entities.RideOrder.update(order.id, {
        status:"pendiente",
        driver_id:null,
        driver_name:null,
        reserved_driver_id:null,
        assigned_base:null,
        reservation_token:null,
        offerExpiresAt:null,
        processingAction:"CENTRAL_REVIEW_ZONE_REQUIRED",
        pending_reason:null
      });
      await b44.entities.AuditLog.create({
        action:"ZONE_RESOLUTION_REQUIRED",
        user_type:"sistema",
        user_name:"clientCreateAndDispatchRide",
        details:`Pasaje ${order.id} sin zona válida: requiere revisión de Central y no se publica en Pendientes.`,
        metadata:{orderId:order.id}
      }).catch(()=>{});
      return Response.json({success:false,orderId:order.id,assigned:false,status:"pendiente",centralReview:true,reason:"ZONE_REQUIRED"},{status:409});
    }
    if (!isDirectPendingZone) {
      // Si el primer candidato pierde la reserva por concurrencia (otro pasaje lo
      // tomó entre la lectura y el CAS), continuar con el siguiente de ESTA MISMA
      // zona. Un intento fallido no debe mandar a Pendientes mientras quede otro
      // móvil elegible en la cola.
      const excludedDriverIds = new Set<string>();
      const zoneSnapshot = await b44.entities.Driver.filter({
        status:'disponible',
        queue_authoritative_base:order.zone
      }).catch(()=>[]);
      const maxCandidateAttempts = Math.max(1, Math.min(100, Array.isArray(zoneSnapshot) ? zoneSnapshot.length : 0));

      for (let attempt = 0; attempt < maxCandidateAttempts && !assigned; attempt++) {
        const nextDriver = await findNextDriverInZone(b44, order, excludedDriverIds);
        if (!nextDriver) break;

        excludedDriverIds.add(nextDriver.id);
        const res = await b44.functions.invoke("assignRide", {
          orderId: order.id,
          driverId: nextDriver.id,
          sessionToken: sessionToken || null,
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