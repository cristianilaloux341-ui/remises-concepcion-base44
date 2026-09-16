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
      expiresAt = Date.now() + seconds * 1000;
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

    let ackedThisAttempt = Boolean(
      order.push_ack_at &&
      Number(order.push_ack_assignment_attempt) === Number(assignmentAttempt)
    );

    // Compatibilidad v12.27/v12.29: el ACK llega primero como AuditLog y el workflow
    // que lo copia al RideOrder puede demorarse unos instantes. Antes de declarar
    // "sin ACK", recuperar directamente ese log para que el timeout nunca le gane
    // a una recepción que el teléfono YA confirmó.
    if (!ackedThisAttempt && expiresAt <= Date.now()) {
      const assignedMs = order.assigned_at ? new Date(order.assigned_at).getTime() : 0;
      const ackLogs = await b44.entities.AuditLog.filter(
        {
          action:'push_ack_recibido',
          'metadata.orderId':orderId,
          'metadata.driverId':driverId
        },
        '-created_date',
        5
      ).catch(()=>[]);
      const matchingAck = (ackLogs || []).find((log:any) => {
        const logMs = new Date(log.created_date || 0).getTime();
        return Number.isFinite(logMs) && (!Number.isFinite(assignedMs) || assignedMs <= 0 || logMs >= assignedMs - 1000);
      });

      if (matchingAck) {
        const config = (await b44.entities.TarifaConfig.list().catch(()=>[]))[0] || {};
        const configuredSeconds = Number(config.tiempo_maximo_respuesta_segundos ?? 30);
        const responseSeconds = Number.isFinite(configuredSeconds) && configuredSeconds > 0 ? configuredSeconds : 30;
        const ackMs = new Date(matchingAck.created_date).getTime();
        const ackAt = new Date(ackMs).toISOString();
        const assignedBaseMs = order.assigned_at ? new Date(order.assigned_at).getTime() : ackMs;
        const ackExpiry = assignedBaseMs + 30000;
        const adopted = await b44.entities.RideOrder.updateMany(
          {
            id:orderId,
            status:'ofrecido',
            reserved_driver_id:driverId,
            reservation_token:order.reservation_token,
            assignment_attempt:Number(assignmentAttempt),
            $or:[
              { push_ack_assignment_attempt:null },
              { push_ack_assignment_attempt:{ $exists:false } },
              { push_ack_assignment_attempt:{ $ne:Number(assignmentAttempt) } }
            ]
          },
          { $set:{
            push_ack_at:ackAt,
            push_ack_assignment_attempt:Number(assignmentAttempt),
            offerExpiresAt:ackExpiry
          } }
        ).catch(()=>({updated:0}));
        const adoptedCount = adopted?.updated ?? adopted?.matchedCount ?? adopted?.modifiedCount ?? 0;
        if (adoptedCount === 1) {
          ackedThisAttempt = true;
          expiresAt = ackExpiry;
          await b44.entities.AuditLog.create({
            action:'ACK_RECOVERED_BEFORE_TIMEOUT',
            user_type:'sistema',
            user_name:'autoReassignOnTimeout',
            details:`ACK ya existente recuperado sin extender el techo absoluto de 30 s de ${orderId}`,
            metadata:{ orderId, driverId, assignmentAttempt:Number(assignmentAttempt), ackAt, offerExpiresAt:ackExpiry }
          }).catch(()=>{});
        }
      }
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
      return Response.json({ ok:true, chained:true, remainingMs:Math.max(0, remainingMs - waitMs), ackedThisAttempt });
    }

    // La oferta total dura 30 s. Si el teléfono todavía no confirmó recepción,
    // hacemos UN solo refuerzo a los 15 s (mismo assignment_attempt): primer aviso
    // al inicio + segundo aviso a mitad de ventana. Ese refuerzo NO crea otros 30 s.
    // Al llegar a los 30 s totales, si sigue sin respuesta, se pasa al siguiente.
    if (!ackedThisAttempt) {
      const retryCount = Number(order.delivery_retry_count || 0);
      const MAX_DELIVERY_RETRIES = 1;
      const DELIVERY_RETRY_WAIT_MS = 15000;

      if (retryCount < MAX_DELIVERY_RETRIES) {
        const nextRetryCount = retryCount + 1;
        const assignedMs = order.assigned_at ? new Date(order.assigned_at).getTime() : Date.now();
        const totalWindowEnd = assignedMs + 30000;
        const retryExpiresAt = Math.max(Date.now() + 1000, totalWindowEnd);
        const retryFilter:any = {
          id:orderId,
          status:'ofrecido',
          reserved_driver_id:driverId,
          reservation_token:order.reservation_token,
          assignment_attempt:Number(assignmentAttempt),
          offerExpiresAt:order.offerExpiresAt,
          $and:[
            { $or:[
              { push_ack_assignment_attempt:null },
              { push_ack_assignment_attempt:{ $exists:false } },
              { push_ack_assignment_attempt:{ $ne:Number(assignmentAttempt) } }
            ] }
          ]
        };
        if (retryCount === 0) {
          retryFilter.$and.push({ $or:[
            { delivery_retry_count:0 },
            { delivery_retry_count:null },
            { delivery_retry_count:{ $exists:false } }
          ] });
        } else {
          retryFilter.delivery_retry_count = retryCount;
        }

        const retryCas = await b44.entities.RideOrder.updateMany(
          retryFilter,
          { $set:{ delivery_retry_count:nextRetryCount, offerExpiresAt:retryExpiresAt } }
        ).catch(()=>({updated:0}));
        const retryChanged = retryCas?.updated ?? retryCas?.matchedCount ?? retryCas?.modifiedCount ?? 0;

        if (retryChanged === 1) {
          const retryPush = await b44.functions.invoke('sendPushNotification', {
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
          }).catch((e:any)=>({ data:{ ok:false, error:e?.message || String(e) } }));

          await b44.entities.AuditLog.create({
            action:'OFFER_DELIVERY_RETRY_SENT',
            user_type:'sistema',
            user_name:'autoReassignOnTimeout',
            details:`Sin ACK del teléfono; reintento ${nextRetryCount}/${MAX_DELIVERY_RETRIES} de la misma oferta ${orderId}`,
            metadata:{ orderId, driverId, assignmentAttempt:Number(assignmentAttempt), retryCount:nextRetryCount, retryPushOk:(retryPush?.data || retryPush)?.ok !== false }
          }).catch(()=>{});

          b44.functions.invoke('autoReassignOnTimeout', {
            orderId,
            driverId,
            assignmentAttempt:Number(assignmentAttempt),
            internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
          }).catch(e=>console.error('Delivery retry timeout chain error:',e));
          return Response.json({ ok:true, deliveryRetry:true, retryCount:nextRetryCount });
        }

        // ACK o alguna transición ganó la carrera. Releer sin tocar nada.
        b44.functions.invoke('autoReassignOnTimeout', {
          orderId,
          driverId,
          assignmentAttempt:Number(assignmentAttempt),
          internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
        }).catch(()=>{});
        return Response.json({ ok:true, skipped:true, reason:'delivery_state_changed' });
      }

      // Cumplidos los 30 s totales sin respuesta/ACK suficiente: se pasa al
      // siguiente sin agregar otra ventana y sin penalizar la posición por entrega.
      const deliveryResult = await b44.functions.invoke('rejectRide', {
        orderId,
        driverId,
        assignmentAttempt:Number(assignmentAttempt),
        source:'delivery_unconfirmed',
        internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
      });
      return Response.json({ ok:(deliveryResult?.data || deliveryResult)?.success !== false, deliveryUnconfirmed:true, result:deliveryResult?.data || deliveryResult });
    }

    // ACK confirmado: recién ahora el vencimiento significa que el chofer tuvo sus
    // 30 s completos y no respondió. Se usa el motor normal de timeout/reasignación.
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