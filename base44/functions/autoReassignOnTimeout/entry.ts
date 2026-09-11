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
      const config = (await b44.entities.TarifaConfig.list())[0] || {};
      const seconds = config.tiempo_maximo_respuesta_segundos ?? 60;
      const assignedAtMs = order.assigned_at ? new Date(order.assigned_at).getTime() : Date.now();
      expiresAt = assignedAtMs + seconds * 1000;
    }

    const remainingMs = expiresAt - Date.now();
    if (remainingMs > 0) {
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

    // Venció en Central: se procesa como el MISMO rechazo atómico que usa el botón
    // RECHAZAR. Esa rutina apaga el móvil anterior, lo manda al final de su cola,
    // y recién después asigna al siguiente de la misma zona.
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