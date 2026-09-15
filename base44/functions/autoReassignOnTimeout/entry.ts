import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const b44 = base44.asServiceRole;
    const payload = await req.json();
    const { orderId, driverId, assignmentAttempt } = payload;

    if (!(await verifyRequestAuth(b44, payload))) {
      return Response.json({ success:false, reason:'unauthorized' }, { status:401 });
    }
    if (!orderId || !driverId || assignmentAttempt == null) {
      return Response.json({ success:false, reason:'missing_params' }, { status:400 });
    }

    const order = await b44.entities.RideOrder.get(orderId).catch(()=>null);
    if (!order) return Response.json({ ok:true, skipped:true, reason:'order_missing' });

    // offerExpiresAt en Central es la ÚNICA autoridad de tiempo. La APK no decide
    // cuándo vence una oferta. Si ACK nativo extendió la ventana, este valor ya lo refleja.
    if (
      order.status !== 'ofrecido' ||
      order.reserved_driver_id !== driverId ||
      Number(order.assignment_attempt) !== Number(assignmentAttempt)
    ) {
      return Response.json({ ok:true, skipped:true, reason:'offer_changed' });
    }

    let expiresAt = Number(order.offerExpiresAt);
    if (!Number.isFinite(expiresAt)) {
      // Nunca inventar un vencimiento corto si falta la autoridad de tiempo.
      // Recuperamos una ventana completa (30 s configurados) desde este instante;
      // si llega el ACK del teléfono, native_ack vuelve a fijar 30 s desde recepción.
      const config = (await b44.entities.TarifaConfig.list())[0] || {};
      const configuredSeconds = Number(config.tiempo_maximo_respuesta_segundos ?? 30);
      const seconds = Number.isFinite(configuredSeconds) && configuredSeconds > 0 ? configuredSeconds : 30;
      // Oferta legacy sin vencimiento persistido: proteger también el tiempo de
      // transporte al teléfono. El ACK, si llega, vuelve a anclar los 30 s reales.
      expiresAt = Date.now() + seconds * 1000 + 15000;
      await b44.entities.RideOrder.updateMany(
        {
          id: orderId,
          status: 'ofrecido',
          reserved_driver_id: driverId,
          assignment_attempt: assignmentAttempt,
          $or: [{ offerExpiresAt:null }, { offerExpiresAt:{ $exists:false } }]
        },
        { $set:{ offerExpiresAt:expiresAt } }
      ).catch(()=>{});
    }

    const remainingMs = expiresAt - Date.now();

    const getDeliveryAckState = async () => {
      const config = (await b44.entities.TarifaConfig.list().catch(() => []))[0] || {};
      const configuredSeconds = Number(config.tiempo_maximo_respuesta_segundos ?? 30);
      const responseSeconds = Number.isFinite(configuredSeconds) && configuredSeconds > 0 ? configuredSeconds : 30;
      const assignedAtMs = order.assigned_at ? new Date(order.assigned_at).getTime() : NaN;
      const offerSpanMs = Number.isFinite(assignedAtMs) ? expiresAt - assignedAtMs : NaN;

      // Antes del ACK la oferta nace con respuesta + 15 s de gracia de transporte.
      // Cuando el teléfono acusa recepción, handleNativePushAction vuelve a fijar
      // assigned_at y offerExpiresAt a una ventana real de respuesta. Toleramos 5 s
      // por latencia de workflows/servidor.
      const ackConfirmed = Number.isFinite(offerSpanMs) &&
        offerSpanMs <= (responseSeconds * 1000) + 5000;
      return { ackConfirmed, responseSeconds, assignedAtMs, offerSpanMs };
    };

    if (remainingMs > 0) {
      // Si después de ~20-25 s todavía no existe evidencia de ACK, reenviar UNA VEZ
      // la MISMA oferta al MISMO móvil. No movemos la cola ni cambiamos el attempt.
      // Si el reintento llega, el ACK reinicia los 30 s completos desde recepción.
      if (remainingMs <= 25000) {
        const delivery = await getDeliveryAckState();
        if (!delivery.ackConfirmed) {
          const previousRetries = await b44.entities.AuditLog.filter({
            action:'OFFER_NO_ACK_RETRY_SENT',
            'metadata.orderId':orderId,
            'metadata.driverId':driverId
          }).catch(() => []);
          const alreadyRetried = (previousRetries || []).some((log:any) =>
            Number(log?.metadata?.assignmentAttempt) === Number(assignmentAttempt)
          );

          if (!alreadyRetried) {
            const retryRes = await b44.functions.invoke('sendPushNotification', {
              action:'send',
              driverId,
              orderId,
              orderData:{
                pickup_address:order.pickup_address,
                dropoff_address:order.dropoff_address,
                fare:order.fare,
                notes:order.notes,
                assignmentAttempt:Number(assignmentAttempt)
              },
              internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
            }).catch((e:any) => ({ data:{ ok:false, error:e?.message || 'RETRY_PUSH_FAILED' } }));
            const retryData = retryRes?.data || retryRes;

            await b44.entities.AuditLog.create({
              action:'OFFER_NO_ACK_RETRY_SENT',
              user_type:'sistema',
              user_name:'autoReassignOnTimeout',
              details:`Sin ACK del móvil ${driverId}; se reenvió la misma oferta ${orderId} antes de considerar timeout`,
              metadata:{
                orderId,
                driverId,
                assignmentAttempt:Number(assignmentAttempt),
                remainingMs,
                retryPushOk:retryData?.ok !== false,
                retryPushReason:retryData?.reason || retryData?.error || null
              }
            }).catch(()=>{});
          }
        }
      }

      // Las funciones serverless no deben dormir demasiado. Esperamos como máximo
      // 25 s y volvemos a leer offerExpiresAt; así cualquier ACK/cambio de Central
      // se respeta sin tener un reloj independiente dentro de Android.
      const waitMs = Math.min(25000, Math.max(1000, remainingMs));
      await new Promise(r => setTimeout(r, waitMs));
      b44.functions.invoke('autoReassignOnTimeout', {
        orderId,
        driverId,
        assignmentAttempt,
        internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
      }).catch(e=>console.error('Timeout chain error:',e));
      return Response.json({ ok:true, chained:true, remainingMs:Math.max(0, remainingMs - waitMs) });
    }

    const finalDeliveryState = await getDeliveryAckState();
    if (!finalDeliveryState.ackConfirmed) {
      await b44.entities.AuditLog.create({
        action:'OFFER_TIMEOUT_WITHOUT_ACK',
        user_type:'sistema',
        user_name:'autoReassignOnTimeout',
        details:`La oferta ${orderId} agotó la ventana sin confirmación de recepción del teléfono ${driverId}`,
        metadata:{
          orderId,
          driverId,
          assignmentAttempt:Number(assignmentAttempt),
          offerExpiresAt:expiresAt,
          assignedAt:order.assigned_at || null,
          offerSpanMs:Number.isFinite(finalDeliveryState.offerSpanMs) ? finalDeliveryState.offerSpanMs : null
        }
      }).catch(()=>{});
    }

    // Venció en Central: se procesa con EXACTAMENTE el mismo motor atómico que usa
    // el botón RECHAZAR. La oferta anterior se cierra y el siguiente recibe una
    // oferta nueva, con nuevo intento/token y su propia ventana de 30 s desde ACK.
    const result = await b44.functions.invoke('rejectRide', {
      orderId,
      driverId,
      assignmentAttempt:Number(assignmentAttempt),
      source:'timeout',
      internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
    });
    const data = result?.data || result;

    if (data?.reason === 'PROCESSING_IN_PROGRESS') {
      // Aceptación/rechazo legítimo ganó el lease por milisegundos. Releer pronto;
      // nunca competir ni liberar al chofer por atrás.
      await new Promise(r => setTimeout(r, 1000));
      b44.functions.invoke('autoReassignOnTimeout', {
        orderId,
        driverId,
        assignmentAttempt:Number(assignmentAttempt),
        internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
      }).catch(e=>console.error('Deferred timeout retry:',e));
      return Response.json({ ok:true, deferred:true, reason:'processing_in_progress' });
    }

    return Response.json({ ok:data?.success !== false, timeoutProcessed:true, result:data });
  } catch (err:any) {
    console.error('Auto-reassign error:',err);
    return Response.json({ success:false, error:err.message }, { status:500 });
  }
});