import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';
import { findNextDriverInZone } from '../../shared/driverSelection.ts';
import { getNextQueueTailAt } from '../../shared/queueOrder.ts';

Deno.serve(async (req) => {
  let b44: any = null;
  let lockOwner: string | null = null;
  let lockOrderId: string | null = null;
  let currentReleased = false;
  let lockedOrder: any = null;
  let requeueReleasedDriverAtEnd: null | (() => Promise<boolean>) = null;

  try {
    const base44 = createClientFromRequest(req);
    b44 = base44.asServiceRole;
    const payload = await req.json();
    const { orderId, driverId, assignmentAttempt } = payload;
    const source = payload.source === 'timeout'
      ? 'timeout'
      : (payload.source === 'legacy_client' ? 'legacy_client' : 'driver');
    const legacyQueueEnteredAt = payload.legacyQueueEnteredAt || null;

    if (!orderId || !driverId || assignmentAttempt == null) {
      return Response.json({ success:false, reason:'missing_params' }, { status:400 });
    }
    if (!(await verifyRequestAuth(b44, payload, { allowDriverId:driverId }))) {
      return Response.json({ success:false, reason:'unauthorized' }, { status:401 });
    }

    const order = await b44.entities.RideOrder.get(orderId);
    if (!order) return Response.json({ success:false, reason:'ORDER_NOT_FOUND' });
    if (
      order.status !== 'ofrecido' ||
      order.reserved_driver_id !== driverId ||
      Number(order.assignment_attempt) !== Number(assignmentAttempt)
    ) {
      return Response.json({ success:false, reason:'STALE_OR_EXPIRED' });
    }

    // BLINDAJE DE TIEMPO EN LA ÚLTIMA AUTORIDAD: aunque cron, APK legacy o un
    // watcher viejo invoquen rejectRide demasiado pronto, un TIMEOUT jamás puede
    // tomar el lease mientras la ventana vigente del teléfono siga abierta.
    // Esto es deliberadamente redundante con autoReassignOnTimeout: rejectRide es
    // la puerta final y debe ser segura por sí sola ante carreras con el ACK.
    if (source === 'timeout') {
      const freshExpiresAt = Number(order.offerExpiresAt);
      if (!Number.isFinite(freshExpiresAt)) {
        return Response.json({ success:false, reason:'TIMEOUT_WITHOUT_EXPIRY_AUTHORITY' });
      }
      const remainingMs = freshExpiresAt - Date.now();
      if (remainingMs > 0) {
        await b44.entities.AuditLog.create({
          action:'PREMATURE_TIMEOUT_BLOCKED_AT_REJECT',
          user_type:'sistema',
          user_name:'rejectRide',
          details:`Timeout anticipado bloqueado para ${orderId}; la oferta del móvil ${driverId} sigue vigente`,
          metadata:{ orderId, driverId, assignmentAttempt:Number(assignmentAttempt), offerExpiresAt:freshExpiresAt, remainingMs }
        }).catch(()=>{});
        return Response.json({ success:false, reason:'OFFER_STILL_LIVE', remainingMs });
      }
    }

    // RECHAZAR y TIMEOUT usan exactamente el mismo motor. Primero tomamos un lease
    // atómico sobre ESTA oferta; así aceptar/rechazar/vencer nunca pueden procesarla
    // simultáneamente.
    lockOwner = `${source}:${orderId}:${driverId}:${assignmentAttempt}:${crypto.randomUUID()}`;
    lockOrderId = orderId;
    const leaseUntil = Date.now() + 30000;
    const lockRes = await b44.entities.RideOrder.updateMany(
      {
        id: orderId,
        status: 'ofrecido',
        reserved_driver_id: driverId,
        reservation_token: order.reservation_token,
        assignment_attempt: assignmentAttempt,
        $or: [
          { processingOwnerId:null },
          { processingOwnerId:{ $exists:false } },
          { processingLeaseExpiresAt:{ $lt:Date.now() } }
        ]
      },
      {
        $set: {
          processingOwnerId: lockOwner,
          processingAction: source === 'timeout' ? 'TIMEOUT' : 'REJECT',
          processingOperationKey: `${source}:${orderId}:${assignmentAttempt}`,
          processingLeaseExpiresAt: leaseUntil,
          processingPhase: 'REASSIGNING'
        }
      }
    );
    if ((lockRes.matchedCount ?? lockRes.modifiedCount ?? lockRes.updated ?? 0) !== 1) {
      return Response.json({ success:false, reason:'PROCESSING_IN_PROGRESS' });
    }
    lockedOrder = order;

    // Durante la reasignación sacamos temporalmente al móvil de la cola para que
    // ninguna escritura legacy compita con el cambio de dueño de la oferta. Una vez
    // cerrado este intento, la regla operativa es inequívoca: rechazo o timeout =
    // ÚLTIMO de la misma base. La reinserción se hace server-side y no depende de que
    // la APK 12.27/12.29 vuelva a publicar una entrada.
    const queueBase = order.assigned_base || order.zone || null;
    requeueReleasedDriverAtEnd = async () => {
      if (!queueBase) return false;
      const queueAt = await getNextQueueTailAt(b44, queueBase, driverId);
      const requeued = await b44.entities.Driver.updateMany(
        {
          id:driverId,
          status:'disponible',
          $or:[{ current_base:null }, { current_base:queueBase }],
          $and:[
            { $or:[{ dispatch_status:'normal' }, { dispatch_status:null }, { dispatch_status:{ $exists:false } }] },
            { $or:[{ reserved_order_id:null }, { reserved_order_id:{ $exists:false } }] },
            { $or:[{ active_order_id:null }, { active_order_id:{ $exists:false } }] },
            { $or:[{ active_ride_id:null }, { active_ride_id:{ $exists:false } }] }
          ]
        },
        { $set:{
          current_base:queueBase,
          queue_entered_at:queueAt,
          queue_authoritative_base:queueBase,
          queue_authoritative_at:queueAt,
          queue_authority_marker:null,
          queue_position:null,
          queue_left_at:null
        } }
      ).catch(()=>({updated:0}));
      const requeuedCount = requeued?.updated ?? requeued?.modifiedCount ?? requeued?.matchedCount ?? 0;
      if (requeuedCount === 1) {
        await b44.entities.AuditLog.create({
          action:'QUEUE_REINSERTED_LAST_AFTER_REJECT_OR_TIMEOUT',
          user_type:'sistema',
          user_name:'rejectRide',
          details:`Móvil ${driverId} reinsertado al final de ${queueBase} después de ${source === 'timeout' ? 'timeout' : 'rechazo'}`,
          metadata:{ orderId, driverId, assignmentAttempt:Number(assignmentAttempt), source, baseName:queueBase, queueAt }
        }).catch(()=>{});
        return true;
      }
      return false;
    };
    const releasedCurrent = await b44.entities.Driver.updateMany(
      {
        id: driverId,
        status: 'disponible',
        dispatch_status: 'automatic_pending',
        reserved_order_id: orderId,
        reservation_token: order.reservation_token
      },
      {
        $set: {
          status:'disponible',
          dispatch_status:'normal',
          // Liberación TRANSITORIA durante el cambio de dueño. Al cerrar este intento
          // rejectRide lo reinsertará server-side al final de la misma base.
          current_base:null,
          queue_entered_at:null,
          queue_authoritative_base:null,
          queue_authoritative_at:null,
          queue_authority_marker:null,
          queue_position:null,
          queue_left_at:null,
          active_order_id:null,
          active_ride_id:null,
          reserved_order_id:null,
          reservation_token:null,
          manual_reservation_token:null,
          driver_reservation_key:null
        }
      }
    );
    const releasedCount = releasedCurrent.matchedCount ?? releasedCurrent.modifiedCount ?? releasedCurrent.updated ?? 0;
    if (releasedCount !== 1) {
      // Compatibilidad con v12.27/v12.29: esas APK primero liberan el Driver y
      // recién después piden la reasignación. Si el workflow nos trae exactamente
      // ese evento, adoptamos la liberación ya hecha en vez de restaurarla y competir
      // con el teléfono. La validación exige que el Driver siga libre, sin otro viaje
      // y con el mismo queue_entered_at observado en el evento que disparó esta llamada.
      // Una APK vieja puede haber liberado el Driver antes de que llegue este motor.
      // Para rechazo legacy Y para timeout aceptamos esa liberación únicamente si el
      // móvil sigue completamente libre; jamás si ya tiene otra reserva/viaje.
      const canAdoptPriorRelease = source === 'legacy_client' || source === 'timeout';
      const currentDriver = canAdoptPriorRelease
        ? await b44.entities.Driver.get(driverId).catch(() => null)
        : null;
      const alreadyReleasedAndIdle = Boolean(
        canAdoptPriorRelease &&
        currentDriver &&
        currentDriver.status === 'disponible' &&
        (currentDriver.dispatch_status == null || currentDriver.dispatch_status === 'normal') &&
        !currentDriver.reserved_order_id &&
        !currentDriver.active_order_id &&
        !currentDriver.active_ride_id &&
        (source === 'timeout' || !legacyQueueEnteredAt || String(currentDriver.queue_entered_at || '') === String(legacyQueueEnteredAt))
      );

      if (alreadyReleasedAndIdle) {
        currentReleased = true;
        await b44.entities.Driver.updateMany(
          { id:driverId, status:'disponible', reserved_order_id:null, active_order_id:null, active_ride_id:null },
          { $set:{
            current_base:null,
            queue_entered_at:null,
            queue_authoritative_base:null,
            queue_authoritative_at:null,
            queue_authority_marker:null,
            queue_position:null,
            queue_left_at:null
          } }
        ).catch(()=>{});
        await b44.entities.AuditLog.create({
          action: source === 'timeout' ? 'TIMEOUT_DRIVER_RELEASE_ADOPTED' : 'LEGACY_DRIVER_RELEASE_ADOPTED',
          user_type:'sistema',
          user_name:'rejectRide',
          details:`Central adoptó liberación previa de APK vieja para ${driverId} / ${orderId}`,
          metadata:{ orderId, driverId, assignmentAttempt:Number(assignmentAttempt), source, legacyQueueEnteredAt }
        }).catch(()=>{});
      } else {
        await b44.entities.RideOrder.updateMany(
          { id:orderId, processingOwnerId:lockOwner },
          { $set:{ processingOwnerId:null, processingAction:null, processingOperationKey:null, processingLeaseExpiresAt:null, processingPhase:null } }
        ).catch(()=>{});
        lockOwner = null;
        return Response.json({ success:false, reason:'STALE_OR_EXPIRED' });
      }
    } else {
      currentReleased = true;
    }

    // Primero apagar/cerrar la oferta anterior. La cancelación conserva el intento
    // exacto que recibió ese teléfono, aunque el RideOrder cambie después.
    // No dependemos de un único intento de red: si falla el primer cierre, repetimos
    // una vez y dejamos auditoría explícita. La reasignación puede continuar, pero
    // queda trazado si el móvil anterior no pudo recibir la orden de cierre.
    let closePushOk = false;
    let closePushError = null;
    for (let closeAttempt = 1; closeAttempt <= 2 && !closePushOk; closeAttempt++) {
      try {
        const closeRes = await b44.functions.invoke('sendPushNotification', {
          action:'cancel_multiple',
          orderId:order.id,
          driversToCancel:[driverId],
          orderData:{ assignmentAttempt:Number(assignmentAttempt) },
          internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
        });
        const closeData = closeRes?.data || closeRes;
        closePushOk = closeData?.ok !== false && !closeData?.error;
        if (!closePushOk) closePushError = closeData?.error || closeData?.reason || 'cancel_push_failed';
      } catch (e) {
        closePushError = e?.message || String(e);
      }
    }

    await b44.entities.AuditLog.create({
      action: closePushOk ? 'OFFER_CLOSE_CONFIRMED_BEFORE_REASSIGN' : 'OFFER_CLOSE_FAILED_BEFORE_REASSIGN',
      user_type:'sistema',
      user_name:'rejectRide',
      details: closePushOk
        ? `Oferta ${order.id} cerrada en móvil anterior antes de reasignar`
        : `No se pudo confirmar cierre de oferta ${order.id} en móvil anterior antes de reasignar`,
      metadata:{ orderId:order.id, driverId, assignmentAttempt:Number(assignmentAttempt), error:closePushError }
    }).catch(()=>{});

    const config = (await b44.entities.TarifaConfig.list())[0] || {};
    // Regla comercial: cada NUEVA oferta tiene 30 s desde que llega al teléfono.
    // El valor inicial sólo protege el tránsito hasta el ACK; native_ack lo vuelve
    // a fijar a 30 s completos desde la recepción real del nuevo móvil.
    const configuredSeconds = Number(config.tiempo_maximo_respuesta_segundos ?? 30);
    const timeoutSeconds = Number.isFinite(configuredSeconds) && configuredSeconds > 0 ? configuredSeconds : 30;
    const autoReassignActive = config.auto_reasignacion_activa ?? true;
    const excluded = new Set<string>([...(order.offered_driver_ids || []), driverId].filter(Boolean));

    if (autoReassignActive) {
      for (let i=0; i<100; i++) {
        const selectionOrder = { ...order, offered_driver_ids:[...excluded] };
        const nextDriver = await findNextDriverInZone(b44, selectionOrder, excluded);
        if (!nextDriver) break;
        excluded.add(nextDriver.id);

        const token = crypto.randomUUID();
        const reserve = await b44.entities.Driver.updateMany(
          { id:nextDriver.id, status:'disponible', dispatch_status:'normal', reserved_order_id:null, active_order_id:null, active_ride_id:null },
          { $set:{ dispatch_status:'automatic_pending', reserved_order_id:orderId, reservation_token:token } }
        );
        if ((reserve.matchedCount ?? reserve.modifiedCount ?? reserve.updated ?? 0) !== 1) continue;

        const newAttempt = Number(assignmentAttempt) + 1;
        const assignedAt = new Date().toISOString();
        // Nueva oferta: misma protección de transporte que assignRide. Sin ACK hay
        // 15 s de gracia; con ACK la ventana queda anclada a la recepción del teléfono.
        const expiresAt = Date.now() + timeoutSeconds*1000 + 15000;
        // Cada salto es una oferta NUEVA. offered_driver_ids queda sólo como historial
        // para no volver a ofrecer a quienes ya pasaron; la identidad activa se
        // reemplaza por completo con nextDriver + token + newAttempt.
        const offeredIds = [...new Set([...(order.offered_driver_ids || []), driverId, nextDriver.id].filter(Boolean))];
        const commit = await b44.entities.RideOrder.updateMany(
          {
            id:orderId,
            status:'ofrecido',
            reserved_driver_id:driverId,
            reservation_token:order.reservation_token,
            assignment_attempt:assignmentAttempt,
            processingOwnerId:lockOwner
          },
          {
            $set:{
              status:'ofrecido',
              driver_id:nextDriver.id,
              driver_name:nextDriver.name,
              reserved_driver_id:nextDriver.id,
              reservation_token:token,
              manual_reservation_token:null,
              assigned_base:nextDriver.current_base,
              offerExpiresAt:expiresAt,
              assignment_attempt:newAttempt,
              assigned_at:assignedAt,
              processingAction:null,
              processingOperationKey:null,
              processingOwnerId:null,
              processingLeaseExpiresAt:null,
              processingPhase:null,
              offered_driver_ids:offeredIds
            }
          }
        );
        if ((commit.matchedCount ?? commit.modifiedCount ?? commit.updated ?? 0) !== 1) {
          await b44.entities.Driver.updateMany(
            { id:nextDriver.id, reserved_order_id:orderId, reservation_token:token },
            { $set:{ dispatch_status:'normal', reserved_order_id:null, reservation_token:null } }
          ).catch(()=>{});
          continue;
        }

        lockOwner = null;
        await b44.functions.invoke('sendPushNotification', {
          action:'send',
          driverId:nextDriver.id,
          orderId,
          orderData:{
            pickup_address:order.pickup_address,
            dropoff_address:order.dropoff_address,
            fare:order.fare,
            notes:order.notes,
            assignmentAttempt:newAttempt
          },
          internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
        }).catch(e=>console.error('Error push rejectRide:',e));

        b44.functions.invoke('autoReassignOnTimeout', {
          orderId,
          driverId:nextDriver.id,
          assignmentAttempt:newAttempt,
          internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
        }).catch(e=>console.error('AutoReassign Trigger Error:',e));

        await requeueReleasedDriverAtEnd?.();

        await b44.entities.AuditLog.create({
          action: source === 'timeout' ? 'timeout_viaje' : 'rechazar_viaje',
          user_type: source === 'timeout' ? 'sistema' : 'chofer',
          user_name: source === 'timeout' ? 'Sistema' : 'Chofer',
          details: `${source === 'timeout' ? 'Venció el tiempo' : 'Rechazó'}. Reasignado a ${nextDriver.name}`,
          metadata:{ orderId, driverId, assignmentAttempt:Number(assignmentAttempt), nextDriverId:nextDriver.id }
        }).catch(()=>{});
        return Response.json({ success:true, reassigned_to:nextDriver.name, source });
      }
    }

    const pending = await b44.entities.RideOrder.updateMany(
      {
        id:orderId,
        status:'ofrecido',
        reserved_driver_id:driverId,
        reservation_token:order.reservation_token,
        assignment_attempt:assignmentAttempt,
        processingOwnerId:lockOwner
      },
      {
        $set:{
          status:'pendiente',
          driver_id:null,
          driver_name:null,
          reserved_driver_id:null,
          reservation_token:null,
          manual_reservation_token:null,
          assigned_at:null,
          offerExpiresAt:null,
          assigned_base:null,
          processingAction:null,
          processingOperationKey:null,
          processingOwnerId:null,
          processingLeaseExpiresAt:null,
          processingPhase:null
        },
        $addToSet:{ offered_driver_ids:driverId }
      }
    );
    if ((pending.matchedCount ?? pending.modifiedCount ?? pending.updated ?? 0) !== 1) {
      throw new Error('ORDER_CHANGED_BEFORE_PENDING');
    }

    lockOwner = null;
    await requeueReleasedDriverAtEnd?.();
    await b44.entities.AuditLog.create({
      action: source === 'timeout' ? 'timeout_viaje' : 'rechazar_viaje',
      user_type: source === 'timeout' ? 'sistema' : 'chofer',
      user_name: source === 'timeout' ? 'Sistema' : 'Chofer',
      details: `${source === 'timeout' ? 'Venció el tiempo' : 'Rechazó'}. Sin candidatos válidos en la zona, quedó pendiente.`,
      metadata:{ orderId, driverId, assignmentAttempt:Number(assignmentAttempt) }
    }).catch(()=>{});
    return Response.json({ success:true, reassigned_to:null, source });
  } catch (error:any) {
    console.error('RejectRide Error:',error);

    // Si ya liberamos al móvil anterior y algo excepcional falló, el estado más
    // seguro es Pendiente; nunca dejar una oferta activa apuntando a un móvil libre.
    if (b44 && lockOwner && lockOrderId && lockedOrder) {
      if (currentReleased) {
        await b44.entities.RideOrder.updateMany(
          {
            id:lockOrderId,
            status:'ofrecido',
            reserved_driver_id:lockedOrder.reserved_driver_id,
            reservation_token:lockedOrder.reservation_token,
            assignment_attempt:lockedOrder.assignment_attempt,
            processingOwnerId:lockOwner
          },
          {
            $set:{
              status:'pendiente',
              driver_id:null,
              driver_name:null,
              reserved_driver_id:null,
              reservation_token:null,
              manual_reservation_token:null,
              assigned_at:null,
              offerExpiresAt:null,
              assigned_base:null,
              processingAction:null,
              processingOperationKey:null,
              processingOwnerId:null,
              processingLeaseExpiresAt:null,
              processingPhase:null
            }
          }
        ).catch(()=>{});
        await requeueReleasedDriverAtEnd?.().catch(()=>false);
      } else {
        await b44.entities.RideOrder.updateMany(
          { id:lockOrderId, processingOwnerId:lockOwner },
          { $set:{ processingOwnerId:null, processingAction:null, processingOperationKey:null, processingLeaseExpiresAt:null, processingPhase:null } }
        ).catch(()=>{});
      }
    }

    return Response.json({ success:false, error:error.message }, { status:500 });
  }
});