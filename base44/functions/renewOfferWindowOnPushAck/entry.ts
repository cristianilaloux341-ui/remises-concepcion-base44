import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * Compatibilidad del workflow histórico "Renew Offer Window On Push Ack".
 *
 * Desde v12.31 ALERT_PRESENTED:
 * - PUSH_RECEIVED / push_ack_recibido sólo confirma entrega al proceso nativo.
 * - NO modifica offerExpiresAt.
 * - Los 30 s reales empiezan únicamente cuando Android confirma ALERT_PRESENTED.
 *
 * Conservamos esta función y el workflow para no romper instalaciones existentes.
 * Su única responsabilidad ahora es despertar/reencadenar el watchdog para que
 * pueda programar el reintento de entrega a los 8 s si todavía no hubo presentación.
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
    const assignmentAttempt =
      eventData?.metadata?.assignmentAttempt ??
      body?.assignmentAttempt ??
      null;

    if (!orderId || !driverId || assignmentAttempt == null) {
      return Response.json({ success: true, skipped: true, reason: 'MISSING_IDS' });
    }

    const order = await b44.entities.RideOrder.get(orderId).catch(() => null);
    if (
      !order ||
      order.status !== 'ofrecido' ||
      order.reserved_driver_id !== driverId ||
      Number(order.assignment_attempt) !== Number(assignmentAttempt)
    ) {
      return Response.json({ success: true, skipped: true, reason: 'OFFER_NO_LONGER_OWNED' });
    }

    // No se toca offerExpiresAt aquí. El watchdog calcula el reintento desde
    // push_ack_at + 8 s (o assigned_at + 8 s si nunca llegó ACK).
    b44.functions.invoke('autoReassignOnTimeout', {
      orderId,
      driverId,
      assignmentAttempt: Number(assignmentAttempt),
      internalKey: Deno.env.get('INTERNAL_SERVICE_KEY')
    }).catch((e: any) => console.error('Error despertando watchdog tras PUSH_RECEIVED', e));

    return Response.json({
      success: true,
      watchdogKicked: true,
      orderId,
      driverId,
      assignmentAttempt: Number(assignmentAttempt),
      offerExpiresAt: order.offerExpiresAt
    });
  } catch (error: any) {
    console.error('renewOfferWindowOnPushAck error', error);
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});
