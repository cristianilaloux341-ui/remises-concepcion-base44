import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * Renueva la ventana de respuesta cuando la app del chofer confirma que el push
 * llegó al WebView/JS. La oferta inicial empieza antes de FCM; sin esta corrección
 * el chofer pierde segundos mientras el push viaja y Android despierta la app.
 *
 * Esta función es deliberadamente CAS/condicional: jamás revive una oferta vencida,
 * reasignada o que ya no pertenece al mismo móvil.
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;

  try {
    const body = await req.json().catch(() => ({}));
    const eventData = body?.data || null;

    // Workflow de AuditLog. También tolera llamada directa controlada para pruebas.
    const action = eventData?.action || body?.action || null;
    if (body?.event && body.event.entity_name !== 'AuditLog') {
      return Response.json({ success: true, skipped: true, reason: 'NOT_AUDIT_EVENT' });
    }
    if (action !== 'push_ack_recibido') {
      return Response.json({ success: true, skipped: true, reason: 'NOT_PUSH_ACK' });
    }

    const orderId = eventData?.metadata?.orderId || body?.orderId || null;
    const driverId = eventData?.metadata?.driverId || body?.driverId || null;
    if (!orderId || !driverId) {
      return Response.json({ success: true, skipped: true, reason: 'MISSING_IDS' });
    }

    const [order, driver, configs] = await Promise.all([
      b44.entities.RideOrder.get(orderId).catch(() => null),
      b44.entities.Driver.get(driverId).catch(() => null),
      b44.entities.TarifaConfig.list().catch(() => [])
    ]);

    if (!order || !driver) {
      return Response.json({ success: true, skipped: true, reason: 'ORDER_OR_DRIVER_NOT_FOUND' });
    }

    // Solo la MISMA oferta viva puede ganar tiempo. Nunca revivir/reabrir algo que
    // ya fue aceptado, vencido, cancelado o reasignado a otro móvil.
    if (
      order.status !== 'ofrecido' ||
      order.reserved_driver_id !== driverId ||
      driver.reserved_order_id !== orderId ||
      driver.dispatch_status !== 'automatic_pending' ||
      driver.reservation_token !== order.reservation_token
    ) {
      return Response.json({ success: true, skipped: true, reason: 'OFFER_NO_LONGER_OWNED' });
    }

    // Idempotencia entre APK actuales (AuditLog) y futuras rutas native_ack: si ESTE
    // assignment_attempt ya quedó confirmado, no volver a extender el reloj.
    if (
      order.push_ack_at &&
      Number(order.push_ack_assignment_attempt) === Number(order.assignment_attempt)
    ) {
      return Response.json({ success: true, skipped: true, reason: 'ACK_ALREADY_RECORDED' });
    }

    const now = Date.now();
    const currentExpiry = Number(order.offerExpiresAt || 0);
    if (!Number.isFinite(currentExpiry)) {
      return Response.json({ success: true, skipped: true, reason: 'INVALID_OFFER_EXPIRY' });
    }

    const timeoutSeconds = Number(configs?.[0]?.tiempo_maximo_respuesta_segundos ?? 30);
    const safeTimeoutSeconds = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds : 30;
    const rawAckMs = eventData?.created_date ? new Date(eventData.created_date).getTime() : now;
    const ackMs = Number.isFinite(rawAckMs) ? Math.min(rawAckMs, now) : now;
    const ackAt = new Date(ackMs).toISOString();
    const targetExpiry = ackMs + safeTimeoutSeconds * 1000;

    // Si el workflow se ejecutó tarde y ya pasaron incluso los 30 s desde el ACK,
    // no inventamos tiempo extra. Mientras la MISMA oferta siga siendo propiedad de
    // este móvil, registramos la recepción y dejamos al timeout resolver enseguida.
    // Esto mantiene exactamente 30 s desde la recepción real, no desde el workflow.

    const updateRes = await b44.entities.RideOrder.updateMany(
      {
        id: orderId,
        status: 'ofrecido',
        reserved_driver_id: driverId,
        reservation_token: order.reservation_token,
        assignment_attempt: order.assignment_attempt,
        offerExpiresAt: currentExpiry
      },
      { $set: {
        offerExpiresAt: targetExpiry,
        push_ack_at: ackAt,
        push_ack_assignment_attempt: order.assignment_attempt
      } }
    );

    const changed = updateRes?.updated ?? updateRes?.modifiedCount ?? updateRes?.matchedCount ?? 0;
    if (changed !== 1) {
      return Response.json({ success: true, skipped: true, reason: 'CONCURRENT_OFFER_CHANGE' });
    }

    await b44.entities.AuditLog.create({
      action: 'OFFER_WINDOW_RENEWED_ON_ACK',
      user_type: 'sistema',
      user_name: order.driver_name || driver.name || 'Sistema',
      details: `Ventana renovada a ${safeTimeoutSeconds}s completos desde recepción visible del pasaje.`,
      metadata: {
        orderId,
        driverId,
        assignmentAttempt: order.assignment_attempt,
        previousOfferExpiresAt: currentExpiry,
        renewedOfferExpiresAt: targetExpiry,
        extensionMs: Math.max(0, targetExpiry - currentExpiry)
      }
    }).catch(() => {});

    return Response.json({
      success: true,
      renewed: true,
      orderId,
      driverId,
      assignmentAttempt: order.assignment_attempt,
      previousOfferExpiresAt: currentExpiry,
      offerExpiresAt: targetExpiry,
      timeoutSeconds: safeTimeoutSeconds
    });
  } catch (error) {
    console.error('renewOfferWindowOnPushAck error', error);
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});
