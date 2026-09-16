import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

const sleep = (ms:number) => new Promise(resolve => setTimeout(resolve, ms));

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;

  try {
    const body = await req.json();
    const log = body?.data || body?.event?.data || body;

    // Solo compatibilidad con APK legacy (12.27/12.29): esas APK escriben un
    // AuditLog `rechazar_viaje` SIN metadata después de tocar RECHAZAR.
    // Los rechazos server-side creados por rejectRide ya traen orderId/driverId y
    // no deben volver a disparar este puente (evita recursión/doble reasignación).
    if (!log || log.action !== 'rechazar_viaje') {
      return Response.json({ success:true, skipped:true, reason:'NOT_REJECT_LOG' });
    }
    if (log.metadata?.orderId || log.metadata?.driverId) {
      return Response.json({ success:true, skipped:true, reason:'SERVER_REJECT_ALREADY_STRUCTURED' });
    }

    const driverName = String(log.user_name || '').trim();
    if (!driverName || driverName.toLowerCase() === 'chofer') {
      return Response.json({ success:true, skipped:true, reason:'NO_LEGACY_DRIVER_NAME' });
    }

    const drivers = await b44.entities.Driver.filter({ name: driverName }).catch(() => []);
    const driver = drivers?.[0] || null;
    if (!driver) {
      return Response.json({ success:true, skipped:true, reason:'DRIVER_NOT_FOUND' });
    }

    // La APK vieja registra el AuditLog al FINAL de su intento local. En paralelo,
    // las barreras server-side pueden estar restaurando la oferta viva. Esperamos
    // brevemente y re-leemos estado fresco para enlazar el rechazo explícito con la
    // única oferta activa del chofer, sin adivinar por timestamps/cola.
    let order:any = null;
    let freshDriver:any = driver;
    const detail = String(log.details || '').toLowerCase();

    for (let attempt = 0; attempt < 6 && !order; attempt++) {
      if (attempt > 0) await sleep(250);
      freshDriver = await b44.entities.Driver.get(driver.id).catch(() => freshDriver);

      if (freshDriver?.reserved_order_id) {
        const candidate = await b44.entities.RideOrder.get(freshDriver.reserved_order_id).catch(() => null);
        if (
          candidate &&
          candidate.status === 'ofrecido' &&
          candidate.reserved_driver_id === driver.id
        ) {
          order = candidate;
          break;
        }
      }

      const offers = await b44.entities.RideOrder.filter({
        status:'ofrecido',
        reserved_driver_id:driver.id
      }).catch(() => []);

      if (offers.length === 1) {
        order = offers[0];
        break;
      }
      if (offers.length > 1) {
        const byClient = offers.find((o:any) => {
          const client = String(o?.client_name || '').trim().toLowerCase();
          return client && detail.includes(client);
        });
        if (byClient) {
          order = byClient;
          break;
        }
      }
    }

    if (!order) {
      return Response.json({ success:true, skipped:true, reason:'NO_UNIQUE_LIVE_OFFER_FOR_DRIVER', driverId:driver.id });
    }

    // Cinturón extra: si el texto legacy incluye nombre de cliente, no asociar el
    // rechazo a otra oferta distinta salvo que sea la única oferta viva (invariante
    // normal del sistema). Esto aporta trazabilidad sin depender del texto para operar.
    const assignmentAttempt = Number(order.assignment_attempt || 1);
    const rejectRes = await b44.functions.invoke('rejectRide', {
      orderId:order.id,
      driverId:driver.id,
      assignmentAttempt,
      source:'legacy_client',
      legacyQueueEnteredAt:freshDriver?.queue_entered_at || null,
      internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
    }).catch((error:any) => ({ data:{ success:false, reason:error?.message || 'INVOKE_FAILED' } }));

    const result = rejectRes?.data || rejectRes;
    const accepted = result?.success === true;

    await b44.entities.AuditLog.create({
      action: accepted ? 'LEGACY_EXPLICIT_REJECT_CONFIRMED' : 'LEGACY_EXPLICIT_REJECT_NOT_APPLIED',
      user_type:'sistema',
      user_name:driverName,
      details: accepted
        ? `Rechazo legacy confirmado para ${order.id}; enviado inmediatamente al motor secuencial`
        : `Rechazo legacy detectado para ${order.id}, pero ya no era aplicable`,
      metadata:{
        orderId:order.id,
        driverId:driver.id,
        assignmentAttempt,
        result: result?.reassigned_to ?? null,
        reason: result?.reason ?? null,
        legacyAuditLogId: log.id || null
      }
    }).catch(() => {});

    return Response.json({
      success:true,
      applied:accepted,
      orderId:order.id,
      driverId:driver.id,
      result
    });
  } catch (error:any) {
    console.error('processLegacyExplicitReject error', error);
    return Response.json({ success:false, error:error?.message || String(error) }, { status:500 });
  }
});
