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

    const now = Date.now();
    const currentExpiry = Number(order.offerExpiresAt || 0);
    // Si el servidor ya consumó el vencimiento, no se resucita. Si todavía figura
    // ofrecido pero la hora pasó por una carrera mínima, también se deja al timeout
    // resolver; la renovación es únicamente para ACK recibido durante oferta vigente.
    if (!Number.isFinite(currentExpiry) || currentExpiry <= now) {
      return Response.json({ success: true, skipped: true, reason: 'OFFER_ALREADY_EXPIRED' });
    }

    const timeoutSeconds = Number(configs?.[0]?.tiempo_maximo_respuesta_segundos ?? 30);
    const safeTimeoutSeconds = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds : 30;
    const ackMs = eventData?.created_date ? new Date(eventData.created_date).getTime() : now;
    const ackBaseMs = Number.isFinite(ackMs) ? Math.max(ackMs, now - 5000) : now;
    const renewedExpiry = ackBaseMs + safeTimeoutSeconds * 1000;

    // No acortar una oferta por ningún motivo. Si por latencia el workflow corre
    // tarde, usar como mínimo 30 s desde el momento de procesar el ACK.
    const targetExpiry = Math.max(currentExpiry, renewedExpiry, now + safeTimeoutSeconds * 1000);

    const updateRes = await b44.entities.RideOrder.updateMany(
      {
        id: orderId,
        status: 'ofrecido',
        reserved_driver_id: driverId,
        reservation_token: order.reservation_token,
        assignment_attempt: order.assignment_attempt,
        offerExpiresAt: currentExpiry
      },
      { $set: { offerExpiresAt: targetExpiry } }
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
