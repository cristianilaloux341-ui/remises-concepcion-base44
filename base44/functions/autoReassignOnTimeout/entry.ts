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
    // cuándo vence una oferta y el ACK nunca extiende el techo absoluto de 30 s.
    if (
      order.status !== 'ofrecido' ||
      order.reserved_driver_id !== driverId ||
      Number(order.assignment_attempt) !== Number(assignmentAttempt)
    ) {
      return Response.json({ ok:true, skipped:true, reason:'offer_changed' });
    }

    let expiresAt = Number(order.offerExpiresAt);
    if (!Number.isFinite(expiresAt)) {
      // Si falta la autoridad de tiempo, reconstruimos el techo desde assigned_at.
      // Nunca abrimos una ventana nueva por ACK o por ejecutar tarde este worker.
      const assignedBaseMs = order.assigned_at ? new Date(order.assigned_at).getTime() : Date.now();
      expiresAt = assignedBaseMs + 30000;
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

    const nowMs = Date.now();
    const remainingMs = expiresAt - nowMs;
    const assignedMs = order.assigned_at ? new Date(order.assigned_at).getTime() : (expiresAt - 30000);
    const reminderAt = assignedMs + 15000;
    const retryCount = Number(order.delivery_retry_count || 0);

    if (remainingMs > 0) {
      // Dos avisos dentro de UNA sola ventana: el inicial en t=0 y, si el viaje
      // sigue ofrecido sin aceptar/rechazar, un único refuerzo en t=15 s. El refuerzo
      // conserva exactamente el mismo assignment_attempt y NO modifica offerExpiresAt.
      if (retryCount === 0 && nowMs >= reminderAt) {
        const reminderCas = await b44.entities.RideOrder.updateMany(
          {
            id:orderId,
            status:'ofrecido',
            reserved_driver_id:driverId,
            reservation_token:order.reservation_token,
            assignment_attempt:Number(assignmentAttempt),
            $or:[
              { delivery_retry_count:0 },
              { delivery_retry_count:null },
              { delivery_retry_count:{ $exists:false } }
            ]
          },
          { $set:{ delivery_retry_count:1 } }
        ).catch(()=>({updated:0}));
        const reminderWon = reminderCas?.updated ?? reminderCas?.matchedCount ?? reminderCas?.modifiedCount ?? 0;

        if (reminderWon === 1) {
          const reminderPush = await b44.functions.invoke('sendPushNotification', {
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
            action:'OFFER_15S_REMINDER_SENT',
            user_type:'sistema',
            user_name:'autoReassignOnTimeout',
            details:`Segundo y último aviso de la oferta ${orderId} a los 15 s; el vencimiento original no se modificó.`,
            metadata:{
              orderId,
              driverId,
              assignmentAttempt:Number(assignmentAttempt),
              offerExpiresAt:expiresAt,
              reminderPushOk:(reminderPush?.data || reminderPush)?.ok !== false
            }
          }).catch(()=>{});
        }
      }

      const freshNow = Date.now();
      const nextWakeAt = retryCount === 0 && freshNow < reminderAt ? reminderAt : expiresAt;
      const waitMs = Math.min(15000, Math.max(500, nextWakeAt - freshNow));
      await new Promise(r => setTimeout(r, waitMs));
      b44.functions.invoke('autoReassignOnTimeout', {
        orderId,
        driverId,
        assignmentAttempt,
        internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
      }).catch(e=>console.error('Timeout chain error:',e));
      return Response.json({ ok:true, chained:true, remainingMs:Math.max(0, expiresAt - Date.now()), ackedThisAttempt });
    }

    // A los 30 s TOTALES se termina esta oferta. Con ACK es timeout normal; sin ACK
    // es entrega no confirmada. En ambos casos el pasaje sigue al siguiente móvil y
    // jamás se abre una tercera ventana para este mismo móvil.
    if (!ackedThisAttempt) {
      const deliveryResult = await b44.functions.invoke('rejectRide', {
        orderId,
        driverId,
        assignmentAttempt:Number(assignmentAttempt),
        source:'delivery_unconfirmed',
        internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
      });
      return Response.json({ ok:(deliveryResult?.data || deliveryResult)?.success !== false, deliveryUnconfirmed:true, result:deliveryResult?.data || deliveryResult });
    }

    // ACK confirmado y 30 s agotados: timeout/reasignación inmediata.
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