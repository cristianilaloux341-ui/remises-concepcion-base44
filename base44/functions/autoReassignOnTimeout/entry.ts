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

    const alertPresentedProtocolEnabled =
      Number(order.alert_presented_protocol_attempt) === Number(assignmentAttempt);

    // ── v12.31: ventana real desde ALERT_PRESENTED ──────────────────────────
    // Esta rama sólo existe para APKs que se identificaron explícitamente con
    // supportsAlertPresented=true. Las APK anteriores siguen por el camino legacy
    // de abajo sin ningún cambio de comportamiento.
    if (alertPresentedProtocolEnabled) {
      let protocolExpiresAt = expiresAt;
      let presentedThisAttempt = Boolean(
        order.alert_presented_at &&
        Number(order.alert_presented_assignment_attempt) === Number(assignmentAttempt)
      );
      let protocolRetryCount = Number(order.delivery_retry_count || 0);

      const assignedMs = order.assigned_at
        ? new Date(order.assigned_at).getTime()
        : Date.now();
      const ackedThisAttempt = Boolean(
        order.push_ack_at &&
        Number(order.push_ack_assignment_attempt) === Number(assignmentAttempt)
      );
      const rawAckMs = ackedThisAttempt ? new Date(order.push_ack_at).getTime() : NaN;
      const retryAnchorMs = Number.isFinite(rawAckMs) ? rawAckMs : assignedMs;
      const deliveryRetryAt = retryAnchorMs + 8000;

      let nowMs = Date.now();

      // Si FCM llegó pero Android todavía no confirmó que publicó el alerta,
      // reenviamos UNA sola vez a los 8 s. Conserva el mismo assignment_attempt.
      if (
        !presentedThisAttempt &&
        protocolRetryCount === 0 &&
        nowMs >= deliveryRetryAt &&
        nowMs < protocolExpiresAt
      ) {
        const retryCas = await b44.entities.RideOrder.updateMany(
          {
            id: orderId,
            status: 'ofrecido',
            reserved_driver_id: driverId,
            reservation_token: order.reservation_token,
            assignment_attempt: Number(assignmentAttempt),
            alert_presented_protocol_attempt: Number(assignmentAttempt),
            $or: [
              { delivery_retry_count: 0 },
              { delivery_retry_count: null },
              { delivery_retry_count: { $exists: false } }
            ]
          },
          { $set: { delivery_retry_count: 1 } }
        ).catch(() => ({ updated: 0 }));

        const retryWon =
          (retryCas?.updated ?? retryCas?.matchedCount ?? retryCas?.modifiedCount ?? 0) === 1;

        // Aunque otro worker haya ganado el CAS, para este worker el reintento ya
        // se considera consumido y no debe volver a competir.
        protocolRetryCount = 1;

        if (retryWon) {
          const retryPush = await b44.functions.invoke('sendPushNotification', {
            action: 'send',
            driverId,
            orderId,
            orderData: {
              pickup_address: order.pickup_address,
              dropoff_address: order.dropoff_address,
              fare: order.fare,
              notes: order.notes,
              assignmentAttempt: Number(assignmentAttempt)
            },
            internalKey: Deno.env.get('INTERNAL_SERVICE_KEY')
          }).catch((e: any) => ({ data: { ok: false, error: e?.message || String(e) } }));

          await b44.entities.AuditLog.create({
            action: 'OFFER_DELIVERY_RETRY_SENT_8S',
            user_type: 'sistema',
            user_name: 'autoReassignOnTimeout',
            details: `Sin ALERT_PRESENTED a los 8 s; se reenvió una vez la misma oferta ${orderId}.`,
            metadata: {
              orderId,
              driverId,
              assignmentAttempt: Number(assignmentAttempt),
              offerExpiresAt: protocolExpiresAt,
              retryPushOk: (retryPush?.data || retryPush)?.ok !== false
            }
          }).catch(() => {});
        }
      }

      nowMs = Date.now();
      if (protocolExpiresAt > nowMs) {
        let nextWakeAt = protocolExpiresAt;
        if (
          !presentedThisAttempt &&
          protocolRetryCount === 0 &&
          deliveryRetryAt > nowMs
        ) {
          nextWakeAt = Math.min(deliveryRetryAt, protocolExpiresAt);
        }

        const targetWaitMs = Math.max(500, nextWakeAt - nowMs);
        const maxSafeWaitMs = 8000;
        const isFinalWait = targetWaitMs <= maxSafeWaitMs;
        const waitMs = Math.min(maxSafeWaitMs, targetWaitMs);

        await new Promise(r => setTimeout(r, waitMs));

        if (!isFinalWait) {
          b44.functions.invoke('autoReassignOnTimeout', {
            orderId,
            driverId,
            assignmentAttempt,
            internalKey: Deno.env.get('INTERNAL_SERVICE_KEY')
          }).catch(e => console.error('ALERT_PRESENTED timeout chain error:', e));

          return Response.json({
            ok: true,
            chained: true,
            protocol: 'alert_presented',
            remainingMs: Math.max(0, protocolExpiresAt - Date.now())
          });
        }

        // Después de cada espera releemos. ALERT_PRESENTED puede haber cambiado
        // offerExpiresAt de techo de entrega a presented_at + 30 s.
        const checkOrder = await b44.entities.RideOrder.get(orderId).catch(() => null);
        if (
          !checkOrder ||
          checkOrder.status !== 'ofrecido' ||
          checkOrder.reserved_driver_id !== driverId ||
          Number(checkOrder.assignment_attempt) !== Number(assignmentAttempt)
        ) {
          return Response.json({ ok: true, skipped: true, reason: 'offer_changed_during_wait' });
        }

        const newExpiresAt = Number(checkOrder.offerExpiresAt);
        presentedThisAttempt = Boolean(
          checkOrder.alert_presented_at &&
          Number(checkOrder.alert_presented_assignment_attempt) === Number(assignmentAttempt)
        );

        // Si todavía queda tiempo, esta fue una vigilia intermedia (por ejemplo
        // el punto de reintento de 8 s) o ALERT_PRESENTED movió el vencimiento.
        if (Number.isFinite(newExpiresAt) && newExpiresAt > Date.now()) {
          b44.functions.invoke('autoReassignOnTimeout', {
            orderId,
            driverId,
            assignmentAttempt,
            internalKey: Deno.env.get('INTERNAL_SERVICE_KEY')
          }).catch(e => console.error('ALERT_PRESENTED re-chain error:', e));

          return Response.json({
            ok: true,
            chained: true,
            protocol: 'alert_presented',
            reason: presentedThisAttempt ? 'response_window_active' : 'delivery_window_active',
            remainingMs: Math.max(0, newExpiresAt - Date.now())
          });
        }

        protocolExpiresAt = newExpiresAt;
      }

      // Última lectura antes de tocar la cola/reasignación: evita perder una
      // aceptación o un ALERT_PRESENTED que ganó por milisegundos.
      const finalOrder = await b44.entities.RideOrder.get(orderId).catch(() => null);
      if (
        !finalOrder ||
        finalOrder.status !== 'ofrecido' ||
        finalOrder.reserved_driver_id !== driverId ||
        Number(finalOrder.assignment_attempt) !== Number(assignmentAttempt)
      ) {
        return Response.json({ ok: true, skipped: true, reason: 'offer_changed_before_timeout' });
      }

      const finalExpiresAt = Number(finalOrder.offerExpiresAt);
      if (Number.isFinite(finalExpiresAt) && finalExpiresAt > Date.now()) {
        b44.functions.invoke('autoReassignOnTimeout', {
          orderId,
          driverId,
          assignmentAttempt,
          internalKey: Deno.env.get('INTERNAL_SERVICE_KEY')
        }).catch(e => console.error('ALERT_PRESENTED final re-chain error:', e));
        return Response.json({ ok: true, chained: true, reason: 'expiry_moved_forward' });
      }

      const finalPresented = Boolean(
        finalOrder.alert_presented_at &&
        Number(finalOrder.alert_presented_assignment_attempt) === Number(assignmentAttempt)
      );

      const source = finalPresented ? 'timeout' : 'delivery_unconfirmed';
      const rejectResponse = await b44.functions.invoke('rejectRide', {
        orderId,
        driverId,
        assignmentAttempt: Number(assignmentAttempt),
        source,
        internalKey: Deno.env.get('INTERNAL_SERVICE_KEY')
      });
      const rejectData = rejectResponse?.data || rejectResponse;

      if (rejectData?.reason === 'PROCESSING_IN_PROGRESS') {
        await new Promise(r => setTimeout(r, 1000));
        b44.functions.invoke('autoReassignOnTimeout', {
          orderId,
          driverId,
          assignmentAttempt: Number(assignmentAttempt),
          internalKey: Deno.env.get('INTERNAL_SERVICE_KEY')
        }).catch(e => console.error('Deferred ALERT_PRESENTED timeout retry:', e));
        return Response.json({ ok: true, deferred: true, reason: 'processing_in_progress' });
      }

      return Response.json({
        ok: rejectData?.success !== false,
        protocol: 'alert_presented',
        deliveryUnconfirmed: !finalPresented,
        timeoutProcessed: finalPresented,
        result: rejectData
      });
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
        const ackExpiry = ackMs + 30000; // Pedido explícito: 30s reales desde el ACK
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
            details:`ACK recuperado. Se extendieron los 30s reales desde el ACK de ${orderId}`,
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
      // Reminders have been known to overlap with the timeout. To keep it simple, we skip the 15s push if they are already on the real countdown.
      // Or we can leave it. The problem is reminderAt might be out of date if expiresAt jumped.
      const realReminderAt = expiresAt - 15000;
      if (retryCount === 0 && nowMs >= realReminderAt) {
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
            details:`Segundo y último aviso de la oferta ${orderId}; faltan 15s para el límite real.`,
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

      // En entornos serverless, setTimeout largos (ej: 15s) pueden ser suspendidos
      // por la plataforma. Para no quedarnos colgados en 0s, invocamos la continuación
      // delegando en otro proceso o usando el cron. Pero como queremos que sea exacto,
      // usaremos un bucle corto o devolveremos para que el cron lo levante.
      // Sin embargo, para mantener el tiempo real, Base44 Workflow es mejor.
      // Como workaround inmediato: si faltan menos de 15s, vamos a esperar.
      // Si el edge runtime nos mata, el autoReassignCron lo recoge al minuto.
      const freshNow = Date.now();
      const nextWakeAt = retryCount === 0 && freshNow < realReminderAt ? realReminderAt : expiresAt;
      const maxSafeWaitMs = 8000;
      const targetWaitMs = Math.max(500, nextWakeAt - freshNow);
      const waitMs = Math.min(maxSafeWaitMs, targetWaitMs);
      
      await new Promise(r => setTimeout(r, waitMs));
      
      // Siempre validamos contra el tiempo real que falta en la base de datos
      const checkOrder = await b44.entities.RideOrder.get(orderId).catch(()=>null);
      if (!checkOrder || checkOrder.status !== 'ofrecido' || checkOrder.reserved_driver_id !== driverId || Number(checkOrder.assignment_attempt) !== Number(assignmentAttempt)) {
          return Response.json({ ok:true, skipped:true, reason:'offer_changed_during_wait' });
      }
      
      const newExpiresAt = Number(checkOrder.offerExpiresAt) || expiresAt;
      ackedThisAttempt = Boolean(checkOrder.push_ack_at && Number(checkOrder.push_ack_assignment_attempt) === Number(assignmentAttempt));
      
      // Si aún queda tiempo (más de 1 segundo de gracia), encadenamos y volvemos a esperar
      if (Date.now() + 1000 < newExpiresAt) {
          b44.functions.invoke('autoReassignOnTimeout', {
            orderId, driverId, assignmentAttempt, internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
          }).catch(e=>console.error('Timeout re-chain error:',e));
          return Response.json({ ok:true, chained:true, reason:'continue_to_full_timeout' });
      }
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
      await b44.functions.invoke('autoReassignOnTimeout', {
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