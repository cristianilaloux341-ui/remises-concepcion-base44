import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';
import { compactQueueUnlocked, getBaseQueue, withQueueLock } from '../../shared/queueOrder.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  try {
    const payload = await req.json();
    const { orderId, action, sessionToken } = payload;
    if (!orderId || action !== 'cancel') {
      return Response.json({ success:false, reason:'INVALID_PARAMS' }, { status:400 });
    }
    // Esta función pertenece a Central. La futura app cliente tendrá su propia
    // cancelación limitada al pasaje autenticado del cliente, nunca autoridad de operador.
    const operatorAuthorized = await verifyRequestAuth(b44, payload, { allowOperator:true });
    if (!operatorAuthorized) {
      return Response.json({ success:false, reason:'unauthorized' }, { status:401 });
    }
    const order = await b44.entities.RideOrder.get(orderId).catch(()=>null);
    if (!order) return Response.json({ success:false, reason:'ORDER_NOT_FOUND' }, { status:404 });

    // Cancelación es terminal. Un pasaje cancelado no se reactiva: si vuelve a pedirse,
    // debe nacer una orden nueva y entrar por el motor canónico de despacho.
    // Idempotencia: una repetición/reintento de la misma cancelación no puede volver
    // a liberar el móvil, reinsertarlo primero ni emitir otro cancel_push.
    if (order.status === 'cancelado' && order.cancel_effects_status === 'DONE') {
      return Response.json({success:true,status:'cancelado',idempotent:true,reason:'ALREADY_CANCELLED'});
    }

    const driverIds = [...new Set([order.driver_id, order.reserved_driver_id, order.preassigned_driver_id].filter(Boolean))];
    const cancelOperationKey = order.cancel_effects_operation_key || `CANCEL_${orderId}`;

    // Ganar primero la transición terminal. Así CANCELAR y FINALIZAR compiten
    // atómicamente sobre RideOrder antes de que cualquiera de los dos toque Driver.
    if (order.status !== 'cancelado') {
      const changed = await b44.entities.RideOrder.updateMany(
        { id:orderId, status:order.status },
        { $set:{ status:'cancelado', offerExpiresAt:null, processingAction:'CANCELLED_BY_CENTRAL',
          processingOperationKey:null, processingOwnerId:null, processingLeaseExpiresAt:null, processingPhase:null,
          cancel_effects_status:'PENDING', cancel_effects_operation_key:cancelOperationKey,
          cancel_push_claimed:false, cancel_push_claimed_at:null } }
      );
      if ((changed?.updated ?? changed?.matchedCount ?? changed?.modifiedCount ?? 0) !== 1) {
        const fresh = await b44.entities.RideOrder.get(orderId).catch(()=>null);
        if (fresh?.status !== 'cancelado') return Response.json({success:false,reason:'CONCURRENT_CHANGE'},{status:409});
        if (fresh.cancel_effects_status === 'DONE') {
          return Response.json({success:true,status:'cancelado',idempotent:true,reason:'ALREADY_CANCELLED'});
        }
      }
    } else if (order.cancel_effects_status !== 'PENDING') {
      await b44.entities.RideOrder.updateMany(
        {id:orderId,status:'cancelado',$or:[{cancel_effects_status:null},{cancel_effects_status:{$exists:false}}]},
        {$set:{cancel_effects_status:'PENDING',cancel_effects_operation_key:cancelOperationKey,
               cancel_push_claimed:false,cancel_push_claimed_at:null}}
      ).catch(()=>null);
    }

    for (const driverId of driverIds) {
      const driver = await b44.entities.Driver.get(driverId).catch(()=>null);
      if (!driver) continue;

      // Segundo slot: cancelar ESTA orden nunca puede tocar el primer viaje.
      if (driver.next_order_id === orderId) {
        const nextQuery:any = { id:driverId, next_order_id:orderId };
        if (driver.next_order_token) nextQuery.next_order_token = driver.next_order_token;
        const clearedNext = await b44.entities.Driver.updateMany(
          nextQuery,
          { $set:{ next_order_id:null, next_order_token:null } }
        ).catch(()=>null);
        if ((clearedNext?.updated ?? clearedNext?.matchedCount ?? clearedNext?.modifiedCount ?? 0) !== 1) {
          return Response.json({success:false,reason:'CANCEL_NEXT_SLOT_CONCURRENT_CHANGE'},{status:409});
        }
        continue;
      }

      // Primer slot/oferta: limpiar solamente las referencias que realmente apuntan
      // a esta orden. Un next_order_id distinto se conserva intacto.
      const ownsCurrent = driver.reserved_order_id === orderId || driver.active_ride_id === orderId;
      if (!ownsCurrent) continue;
      const currentQuery:any = { id:driverId, next_order_id:driver.next_order_id ?? null, next_order_token:driver.next_order_token ?? null };
      if (driver.reserved_order_id === orderId) currentQuery.reserved_order_id = orderId;
      if (driver.active_ride_id === orderId) currentQuery.active_ride_id = orderId;
      const keepNext = Boolean(driver.next_order_id && driver.next_order_id !== orderId);
      const clearedCurrent = await b44.entities.Driver.updateMany(
        currentQuery,
        { $set:{
          status: keepNext ? driver.status : 'disponible',
          dispatch_status: keepNext ? driver.dispatch_status : 'normal',
          ...(driver.reserved_order_id === orderId ? {reserved_order_id:null,reservation_token:null,driver_reservation_key:null} : {}),
          ...(driver.active_ride_id === orderId ? {active_ride_id:null} : {})
        } }
      ).catch(()=>null);
      if ((clearedCurrent?.updated ?? clearedCurrent?.matchedCount ?? clearedCurrent?.modifiedCount ?? 0) !== 1) {
        return Response.json({success:false,reason:'CANCEL_CURRENT_SLOT_CONCURRENT_CHANGE'},{status:409});
      }
    }

    if (action === 'cancel') {
      // RideOrder ya quedó cancelado de forma autoritativa antes de limpiar Driver.
      // Si se canceló el primer viaje y ya había un segundo confirmado, promoverlo
      // inmediatamente. La cancelación no debe dejar el próximo viaje varado.
      for (const driverId of driverIds) {
        const fresh = await b44.entities.Driver.get(driverId).catch(()=>null);
        const nextOrderId = fresh?.next_order_id;
        const nextToken = fresh?.next_order_token;
        if (!nextOrderId || !nextToken) continue;
        if (fresh.reserved_order_id || fresh.active_ride_id) continue;
        const next = await b44.entities.RideOrder.get(nextOrderId).catch(()=>null);
        if (!next || next.status !== 'preasignado_proximo' || next.preassigned_driver_id !== driverId || next.preassignment_token !== nextToken) continue;
        const promotedOrder = await b44.entities.RideOrder.updateMany(
          {id:nextOrderId,status:'preasignado_proximo',preassigned_driver_id:driverId,preassignment_token:nextToken},
          {$set:{status:'aceptado',driver_id:driverId,driver_name:fresh.name,preassigned_driver_id:null,preassignment_token:null,preassigned_at:null}}
        );
        if ((promotedOrder?.updated ?? promotedOrder?.matchedCount ?? promotedOrder?.modifiedCount ?? 0) !== 1) continue;
        const promotedDriver = await b44.entities.Driver.updateMany(
          {id:driverId,next_order_id:nextOrderId,next_order_token:nextToken,
           $and:[{$or:[{reserved_order_id:null},{reserved_order_id:{$exists:false}}]},{$or:[{active_ride_id:null},{active_ride_id:{$exists:false}}]}]},
          {$set:{status:'en_viaje',dispatch_status:'normal',active_ride_id:nextOrderId,next_order_id:null,next_order_token:null}}
        );
        if ((promotedDriver?.updated ?? promotedDriver?.matchedCount ?? promotedDriver?.modifiedCount ?? 0) !== 1) {
          const rollbackNext = await b44.entities.RideOrder.updateMany(
            {id:nextOrderId,status:'aceptado',driver_id:driverId},
            {$set:{status:'preasignado_proximo',preassigned_driver_id:driverId,preassignment_token:nextToken,preassigned_at:next.preassigned_at || new Date().toISOString()}}
          ).catch(()=>null);
          if ((rollbackNext?.updated ?? rollbackNext?.matchedCount ?? rollbackNext?.modifiedCount ?? 0) !== 1) {
            await b44.entities.AuditLog.create({action:'NEXT_RIDE_PROMOTION_ROLLBACK_FAILED',user_type:'sistema',user_name:'operatorOrderAction',details:`No se pudo revertir promoción del segundo pasaje ${nextOrderId} tras cancelar ${orderId}`,metadata:{orderId:nextOrderId,previousOrderId:orderId,driverId,nextToken}}).catch(()=>{});
            return Response.json({success:false,reason:'NEXT_RIDE_PROMOTION_ROLLBACK_FAILED'},{status:409});
          }
          continue;
        }
        await b44.entities.AuditLog.create({action:'NEXT_RIDE_PROMOTED_BACKEND',user_type:'sistema',user_name:'operatorOrderAction',details:`Segundo pasaje ${nextOrderId} promovido al cancelar ${orderId}`,metadata:{orderId:nextOrderId,previousOrderId:orderId,driverId}}).catch(()=>{});
      }

      // Regla comercial: sólo una cancelación de Central devuelve el móvil primero.
      // Una cancelación del cliente libera el viaje sin alterar la prioridad de cola.
      if (operatorAuthorized && order.driver_id && !order.preassigned_driver_id) {
        const baseName = order.assigned_base || order.zone || null;
        if (baseName) {
          await withQueueLock(b44, baseName, async () => {
            const target = await b44.entities.Driver.get(order.driver_id).catch(()=>null);
            if (!target || target.status !== 'disponible' || target.dispatch_status !== 'normal' ||
                target.reserved_order_id || target.active_ride_id || target.next_order_id) return;

            const drivers = await b44.entities.Driver.filter({
              status:'disponible',
              queue_authoritative_base:baseName
            });
            const queue = getBaseQueue(drivers, baseName).filter((d:any)=>d.id !== target.id);
            // Cancelación de Central: reingreso explícito primero bajo la misma autoridad de cola.
            const targetChanged = await b44.entities.Driver.updateMany(
              {id:target.id,status:'disponible',dispatch_status:'normal',reserved_order_id:null,active_ride_id:null,next_order_id:null},
              {$set:{queue_authoritative_base:baseName,queue_position:1}}
            );
            const targetCount = targetChanged?.updated ?? targetChanged?.modifiedCount ?? targetChanged?.matchedCount ?? 0;
            if (targetCount !== 1) throw new Error(`CENTRAL_CANCEL_REQUEUE_RACE:${target.id}`);
            for (let i=0;i<queue.length;i++) {
              const d:any=queue[i]; const pos=i+2;
              if (Number(d.queue_position)===pos) continue;
              const shifted = await b44.entities.Driver.updateMany(
                {id:d.id,queue_authoritative_base:baseName,status:'disponible',dispatch_status:'normal',reserved_order_id:null,active_ride_id:null,next_order_id:null},
                {$set:{queue_position:pos,}}
              );
              const shiftedCount = shifted?.updated ?? shifted?.modifiedCount ?? shifted?.matchedCount ?? 0;
              if (shiftedCount !== 1) throw new Error(`CENTRAL_CANCEL_QUEUE_RACE:${d.id}`);
            }
          }).catch(async (queueError:any)=>{
            // La cancelación del viaje ya quedó confirmada. Si una carrera impidió
            // devolver el móvil primero, no ocultar el fallo ni dejar huecos/duplicados:
            // compactar la cola autoritativa y dejar auditoría para Central.
            await withQueueLock(b44, baseName, async ()=>{
              await compactQueueUnlocked(b44, baseName);
            }).catch(()=>{});
            await b44.entities.AuditLog.create({
              action:'CENTRAL_CANCEL_REQUEUE_FAILED',
              user_type:'sistema',
              user_name:'operatorOrderAction',
              details:`Cancelación ${orderId} confirmada, pero el reingreso primero requirió recuperación de cola.`,
              metadata:{orderId,driverId:order.driver_id,baseName,error:queueError?.message || String(queueError)}
            }).catch(()=>{});
          });
        }
      }
      // Lease durable para el cierre FCM. Evita duplicados concurrentes y, si el
      // proceso muere, permite recuperar el envío después de 60 s.
      if (driverIds.length) {
        const now = Date.now();
        const pushClaim = await b44.entities.RideOrder.updateMany(
          {id:orderId,status:'cancelado',cancel_effects_status:'PENDING',
           $or:[{cancel_push_claimed:false},{cancel_push_claimed:null},{cancel_push_claimed:{$exists:false}},
                {cancel_push_claimed_at:{$lt:now-60000}}]},
          {$set:{cancel_push_claimed:true,cancel_push_claimed_at:now}}
        ).catch(()=>null);
        const pushClaimed = (pushClaim?.updated ?? pushClaim?.matchedCount ?? pushClaim?.modifiedCount ?? 0) === 1;
        if (pushClaimed) {
          try {
            await b44.functions.invoke('sendPushNotification',{action:'cancel_multiple',driversToCancel:driverIds,orderId,sessionToken});
          } catch (pushError) {
            await b44.entities.RideOrder.updateMany(
              {id:orderId,status:'cancelado',cancel_effects_status:'PENDING',cancel_push_claimed:true,cancel_push_claimed_at:now},
              {$set:{cancel_push_claimed:false,cancel_push_claimed_at:null}}
            ).catch(()=>null);
            return Response.json({success:false,reason:'CANCEL_PUSH_RETRY_REQUIRED'},{status:503});
          }
        } else {
          const freshClaim = await b44.entities.RideOrder.get(orderId).catch(()=>null);
          if (freshClaim?.cancel_effects_status !== 'DONE') {
            return Response.json({success:false,reason:'CANCEL_EFFECTS_IN_PROGRESS'},{status:409});
          }
        }
      }

      const effectsDone = await b44.entities.RideOrder.updateMany(
        {id:orderId,status:'cancelado',cancel_effects_status:'PENDING',cancel_effects_operation_key:cancelOperationKey},
        {$set:{cancel_effects_status:'DONE'}}
      ).catch(()=>null);
      if ((effectsDone?.updated ?? effectsDone?.matchedCount ?? effectsDone?.modifiedCount ?? 0) !== 1) {
        const freshDone = await b44.entities.RideOrder.get(orderId).catch(()=>null);
        if (freshDone?.cancel_effects_status !== 'DONE') {
          return Response.json({success:false,reason:'CANCEL_EFFECTS_NOT_FINALIZED'},{status:409});
        }
      }

      await b44.entities.AuditLog.create({action:operatorAuthorized ? 'CENTRAL_CANCEL_COMMITTED' : 'CLIENT_CANCEL_COMMITTED',user_type:operatorAuthorized ? 'operador' : 'cliente',user_name:operatorAuthorized ? 'Central' : 'Cliente',details:`Cancelación autoritativa de ${orderId}`,metadata:{orderId,driverIds,cancelOperationKey}}).catch(()=>{});
      return Response.json({success:true,status:'cancelado'});
    }

  } catch (e) {
    console.error('operatorOrderAction',e);
    return Response.json({success:false,error:e?.message || String(e)},{status:500});
  }
});
