import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  
  try {
    const payload = await req.json();
    
    const { action, orderId, driverId } = payload;
    
    if (!orderId || !driverId) {
      return Response.json({ success: false, reason: "missing_params" });
    }

    // Protocolo nuevo: toda acción del teléfono debe estar ligada a la sesión real
    // del chofer. Conocer orderId + driverId no autoriza ACK, presentación, aceptar
    // ni rechazar. El APK nuevo envía access_token/sessionToken también desde la
    // notificación nativa.
    const nativeSessionToken = String(payload.sessionToken || payload.access_token || "");
    if (!nativeSessionToken || !(await verifyRequestAuth(b44, { ...payload, sessionToken:nativeSessionToken }, { allowDriverId:driverId }))) {
      return Response.json({ success:false, reason:"UNAUTHORIZED_NATIVE_ACTION" }, { status:401 });
    }

    const attemptMatch = String(orderId).match(/_att_(\d+)$/);
    const attemptFromOrderId = attemptMatch ? Number(attemptMatch[1]) : null;
    const attemptFromPayload = Number.isFinite(Number(payload.assignmentAttempt))
      ? Number(payload.assignmentAttempt)
      : null;
    const nativeAssignmentAttempt = attemptFromPayload ?? attemptFromOrderId;
    const realOrderId = String(orderId).replace(/_att_\d+$/, '');

    // Toda acción nativa pertenece a un intento concreto. Sin assignmentAttempt no
    // se puede distinguir una notificación atrasada de la oferta actual.
    if (!Number.isInteger(nativeAssignmentAttempt) || nativeAssignmentAttempt < 1) {
      return Response.json({ success:false, reason:"ASSIGNMENT_ATTEMPT_REQUIRED" }, { status:409 });
    }
    const supportsAlertPresented =
      payload.supportsAlertPresented === true ||
      String(payload.supportsAlertPresented || '').toLowerCase() === 'true';

    // El sistema nuevo no admite ACK sin protocolo ALERT_PRESENTED. El ACK confirma
    // transporte; nunca abre por sí solo una ventana comercial ni habilita una ruta
    // de compatibilidad distinta.
    if (action === "native_ack" && !supportsAlertPresented) {
      return Response.json({ success:false, reason:"ALERT_PRESENTED_PROTOCOL_REQUIRED" }, { status:409 });
    }

    if (action === "native_ack") {
      const driver = await b44.entities.Driver.get(driverId).catch(() => null);
      const order = await b44.entities.RideOrder.get(realOrderId).catch(() => null);

      // PUSH_RECEIVED confirma que FCM llegó al proceso nativo.
      // El protocolo se identifica por capacidad (`supportsAlertPresented=true`),
      // no por número de versión del APK. ACK es sólo PUSH_RECEIVED.
      // La ventana comercial espera ALERT_PRESENTED
      // y usa la duración configurada por la empresa.
      let ackRecorded = false;
      let protocolEnabled = false;
      if (
        order &&
        order.status === "ofrecido" &&
        order.reserved_driver_id === driverId &&
        Number(order.assignment_attempt) === Number(nativeAssignmentAttempt)
      ) {
        const ackAlreadyRecorded =
          Boolean(order.push_ack_at) &&
          Number(order.push_ack_assignment_attempt) === Number(order.assignment_attempt);
        const receivedAt = ackAlreadyRecorded ? order.push_ack_at : new Date().toISOString();
        // ACK sólo confirma transporte. No crea, extiende ni acorta la ventana
        // comercial. offerExpiresAt nace exclusivamente en ALERT_PRESENTED.
        {
          const protocolResult = await b44.entities.RideOrder.updateMany(
            {
              id: realOrderId,
              status: "ofrecido",
              reserved_driver_id: driverId,
              reservation_token: order.reservation_token,
              assignment_attempt: order.assignment_attempt
            },
            {
              $set: {
                push_ack_at: receivedAt,
                push_ack_assignment_attempt: order.assignment_attempt,
                alert_presented_protocol_attempt: order.assignment_attempt
              }
            }
          );
          protocolEnabled =
            (protocolResult?.updated ?? protocolResult?.matchedCount ?? protocolResult?.modifiedCount ?? 0) === 1;
          ackRecorded = protocolEnabled && !ackAlreadyRecorded;
        }
      }

      // Sólo el primer ACK genera push_ack_recibido para no duplicar workflows.
      await b44.entities.AuditLog.create({
        action: ackRecorded ? "push_ack_recibido" : "push_ack_ignorado",
        user_type: "sistema",
        user_name: driver?.name || "Chofer",
        details: ackRecorded
          ? `PUSH_RECEIVED confirmado. Esperando ALERT_PRESENTED antes de iniciar la ventana configurada.`
          : `ACK duplicado o de una oferta que ya cambió; no se abrió otra ventana.`,
        metadata: {
          orderId: realOrderId,
          driverId,
          assignmentAttempt: order?.assignment_attempt ?? nativeAssignmentAttempt ?? null,
          ackRecorded,
          supportsAlertPresented,
          protocolEnabled
        }
      }).catch(() => {});

      if (protocolEnabled && order) {
        b44.functions.invoke("autoReassignOnTimeout", {
          orderId: realOrderId,
          driverId,
          assignmentAttempt: order.assignment_attempt,
          internalKey: Deno.env.get("INTERNAL_SERVICE_KEY")
        }).catch((e: any) => console.error("Error despertando watchdog tras PUSH_RECEIVED", e));
      }

      return Response.json({ success: true, ackRecorded, protocolEnabled });
    } else if (action === "native_alert_presented") {
      const driver = await b44.entities.Driver.get(driverId).catch(() => null);
      const order = await b44.entities.RideOrder.get(realOrderId).catch(() => null);
      if (!order) return Response.json({ success: false, reason: "order_not_found" });

      if (
        order.status !== "ofrecido" ||
        order.reserved_driver_id !== driverId ||
        Number(order.assignment_attempt) !== Number(nativeAssignmentAttempt)
      ) {
        return Response.json({ success: false, reason: "offer_changed_or_stale" });
      }

      // Idempotencia: un reenvío del mismo attempt puede volver a publicar la misma
      // notificación, pero nunca debe regalar otra ventana de respuesta.
      if (
        order.alert_presented_at &&
        Number(order.alert_presented_assignment_attempt) === Number(order.assignment_attempt)
      ) {
        return Response.json({
          success: true,
          alreadyPresented: true,
          offerExpiresAt: order.offerExpiresAt,
          serverTimeMs: Date.now()
        });
      }

      // La duración es configuración autoritativa de Central, no una constante.
      // El reloj siempre nace desde ALERT_PRESENTED.
      const tarifaConfigs = await b44.entities.TarifaConfig.list().catch(() => []);
      const configuredSeconds = Number(tarifaConfigs?.[0]?.tiempo_maximo_respuesta_segundos);
      const responseSeconds = Number.isFinite(configuredSeconds) && configuredSeconds > 0 ? configuredSeconds : 30;
      const presentedMs = Date.now();
      const presentedAt = new Date(presentedMs).toISOString();
      const targetExpiry = presentedMs + responseSeconds * 1000;

      const presentedResult = await b44.entities.RideOrder.updateMany(
        {
          id: realOrderId,
          status: "ofrecido",
          reserved_driver_id: driverId,
          reservation_token: order.reservation_token,
          assignment_attempt: order.assignment_attempt,
          $or: [
            { alert_presented_assignment_attempt: null },
            { alert_presented_assignment_attempt: { $exists: false } },
            { alert_presented_assignment_attempt: { $ne: Number(order.assignment_attempt) } }
          ]
        },
        {
          $set: {
            alert_presented_at: presentedAt,
            alert_presented_assignment_attempt: order.assignment_attempt,
            alert_presented_protocol_attempt: order.assignment_attempt,
            offerExpiresAt: targetExpiry
          }
        }
      );

      const presentedRecorded =
        (presentedResult?.updated ?? presentedResult?.matchedCount ?? presentedResult?.modifiedCount ?? 0) === 1;

      if (presentedRecorded) {
        await b44.entities.AuditLog.create({
          action: "ALERT_PRESENTED",
          user_type: "sistema",
          user_name: driver?.name || order.driver_name || "Chofer",
          details: `Alerta nativa presentada. Comienzan ${responseSeconds} s configurados de respuesta.`,
          metadata: {
            orderId: realOrderId,
            driverId,
            assignmentAttempt: order.assignment_attempt,
            alertPresentedAt: presentedAt,
            offerExpiresAt: targetExpiry
          }
        }).catch(() => {});

        // Despertar/reencadenar el watchdog para que adopte inmediatamente la
        // nueva expiración, incluso si estaba esperando el techo de entrega.
        b44.functions.invoke("autoReassignOnTimeout", {
          orderId: realOrderId,
          driverId,
          assignmentAttempt: order.assignment_attempt,
          internalKey: Deno.env.get("INTERNAL_SERVICE_KEY")
        }).catch((e: any) => console.error("Error reencadenando watchdog tras ALERT_PRESENTED", e));
      }

      return Response.json({
        success: true,
        presentedRecorded,
        offerExpiresAt: presentedRecorded ? targetExpiry : order.offerExpiresAt,
        timeoutSeconds: responseSeconds,
        serverTimeMs: Date.now()
      });
    } else if (action === "native_accept") {
      const order = await b44.entities.RideOrder.get(realOrderId);
      if (!order) return Response.json({ success: false, reason: "order_not_found" });
      
      const driver = await b44.entities.Driver.get(driverId);
      if (!driver) return Response.json({ success: false, reason: "driver_not_found" });

      // La acción nativa debe conservar el intento ORIGINAL recibido en la notificación.
      // Si llega tarde una notificación de un intento anterior, acceptRide la rechazará
      // en lugar de convertirla accidentalmente en una aceptación del intento actual.
      const attempt = nativeAssignmentAttempt;
      
      // La sesión ya fue validada al entrar a esta función. Conservamos exactamente
      // ese mismo token al delegar en acceptRide; no lo sustituimos por el valor de
      // base de datos ni usamos una llave interna para ocultar una desincronización.
      const result = await b44.functions.invoke("acceptRide", {
         orderId: realOrderId,
         driverId,
         assignmentAttempt: attempt,
         sessionToken: nativeSessionToken
      });
      
      return Response.json(result);
      
    } else if (action === "native_reject") {
      const order = await b44.entities.RideOrder.get(realOrderId);
      if (!order) return Response.json({ success: false, reason: "order_not_found" });

      if (order.status !== "ofrecido" || order.reserved_driver_id !== driverId) {
         return Response.json({ success: false, reason: "already_processed_or_expired" });
      }
      // Igual que Aceptar: un rechazo viejo nunca puede actuar sobre una oferta nueva.
      if (Number(order.assignment_attempt) !== Number(nativeAssignmentAttempt)) {
         return Response.json({ success: false, reason: "stale_assignment_attempt" });
      }

      const driver = await b44.entities.Driver.get(driverId);
      const attempt = nativeAssignmentAttempt;

      // Una sola autoridad para TODOS los rechazos (pantalla, SW y acción nativa).
      // Todos los rechazos nativos delegan en rejectRide, con el mismo CAS, cola,
      // cancelación y ventana completa del siguiente intento.
      const rejectResponse = await b44.functions.invoke("rejectRide", {
        orderId: realOrderId,
        driverId,
        assignmentAttempt: attempt,
        sessionToken: nativeSessionToken
      });
      const rejectResult = rejectResponse?.data || rejectResponse;

      await b44.entities.AuditLog.create({
        action: 'RIDE_REJECTED_NATIVE',
        user_type: 'chofer',
        user_name: driver ? driver.name : driverId,
        details: `Chofer rechazó viaje ${realOrderId} desde notificación nativa. Resultado: ${rejectResult?.reason || rejectResult?.reassigned_to || (rejectResult?.success ? 'ok' : 'error')}`
      }).catch(() => {});

      return Response.json({ success: rejectResult?.success !== false, rejectResult });
    }

    return Response.json({ success: false, reason: "unknown_action" });
  } catch (error: any) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});