import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * Compatibilidad del workflow histórico "Renew Offer Window On Push Ack".
 *
 * - APK legacy: conserva el comportamiento previo de 30 s desde el ACK cuando
 *   ese ACK llega por AuditLog/JS y todavía no fue copiado al RideOrder.
 * - v12.31 ALERT_PRESENTED: el native_ack marca alert_presented_protocol_attempt.
 *   En ese caso este workflow NO toca offerExpiresAt; sólo despierta el watchdog.
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;

  try {
    const body = await req.json().catch(() => ({}));
    const eventData = body?.data || null;

    const action = eventData?.action || body?.action || null;
    if (body?.event && body.event.entity_name !== 'AuditLog') {
      return Response.json({ success: true, skipped: true, reason: 'NOT_AUDIT_EVENT' });
    }
    if (action !== 'push_ack_recibido') {
      return Response.json({ success: true, skipped: true, reason: 'NOT_PUSH_ACK' });
    }

    const orderId = eventData?.metadata?.orderId || body?.orderId || null;
    const driverId = eventData?.metadata?.driverId || body?.driverId || null;
    const metadataAttempt = eventData?.metadata?.assignmentAttempt ?? body?.assignmentAttempt ?? null;

    if (!orderId || !driverId) {
      return Response.json({ success: true, skipped: true, reason: 'MISSING_IDS' });
    }

    const order = await b44.entities.RideOrder.get(orderId).catch(() => null);
    if (!order) {
      return Response.json({ success: true, skipped: true, reason: 'ORDER_NOT_FOUND' });
    }

    const assignmentAttempt = metadataAttempt ?? order.assignment_attempt;
    if (
      order.status !== 'ofrecido' ||
      order.reserved_driver_id !== driverId ||
      Number(order.assignment_attempt) !== Number(assignmentAttempt)
    ) {
      return Response.json({ success: true, skipped: true, reason: 'OFFER_NO_LONGER_OWNED' });
    }

    const protocolEnabled =
      Number(order.alert_presented_protocol_attempt) === Number(order.assignment_attempt);

    if (protocolEnabled) {
      // Nuevo protocolo: ACK != alerta visible. No renovar desde ACK.
      b44.functions.invoke('autoReassignOnTimeout', {
        orderId,
        driverId,
        assignmentAttempt: Number(order.assignment_attempt),
        internalKey: Deno.env.get('INTERNAL_SERVICE_KEY')
      }).catch((e: any) => console.error('Error despertando watchdog v12.31', e));

      return Response.json({
        success: true,
        protocolEnabled: true,
        renewed: false,
        offerExpiresAt: order.offerExpiresAt
      });
    }

    // Compatibilidad legacy. Si el ACK ya fue persistido por una ruta nativa
    // antigua, conservar el comportamiento que esa ruta tenía y no duplicar nada.
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

    const rawAckMs = eventData?.created_date ? new Date(eventData.created_date).getTime() : now;
    const ackMs = Number.isFinite(rawAckMs) ? Math.min(rawAckMs, now) : now;
    const ackAt = new Date(ackMs).toISOString();
    const targetExpiry = ackMs + 30000;

    const updateRes = await b44.entities.RideOrder.updateMany(
      {
        id: orderId,
        status: 'ofrecido',
        reserved_driver_id: driverId,
        reservation_token: order.reservation_token,
        assignment_attempt: order.assignment_attempt,
        offerExpiresAt: currentExpiry
      },
      {
        $set: {
          offerExpiresAt: targetExpiry,
          push_ack_at: ackAt,
          push_ack_assignment_attempt: order.assignment_attempt
        }
      }
    );

    const changed = updateRes?.updated ?? updateRes?.modifiedCount ?? updateRes?.matchedCount ?? 0;
    if (changed !== 1) {
      return Response.json({ success: true, skipped: true, reason: 'CONCURRENT_OFFER_CHANGE' });
    }

    await b44.entities.AuditLog.create({
      action: 'OFFER_ACK_RECORDED_RENEWED',
      user_type: 'sistema',
      user_name: order.driver_name || 'Sistema',
      details: 'ACK legacy registrado. Se conservan los 30 s desde recepción para APK anteriores.',
      metadata: {
        orderId,
        driverId,
        assignmentAttempt: order.assignment_attempt,
        previousOfferExpiresAt: currentExpiry,
        renewedOfferExpiresAt: targetExpiry,
        extensionMs: targetExpiry - currentExpiry
      }
    }).catch(() => {});

    b44.functions.invoke('autoReassignOnTimeout', {
      orderId,
      driverId,
      assignmentAttempt: order.assignment_attempt,
      internalKey: Deno.env.get('INTERNAL_SERVICE_KEY')
    }).catch((e: any) => console.error('Error lanzando watchdog legacy corregido', e));

    return Response.json({
      success: true,
      protocolEnabled: false,
      renewed: true,
      offerExpiresAt: targetExpiry,
      timeoutSeconds: 30
    });
  } catch (error: any) {
    console.error('renewOfferWindowOnPushAck error', error);
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});
