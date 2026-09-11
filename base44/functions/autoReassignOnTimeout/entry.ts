import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const b44 = base44.asServiceRole;
    const payload = await req.json();
    const { orderId, driverId, timeoutSeconds=60, assignmentAttempt } = payload;
    if (!(await verifyRequestAuth(b44,payload))) return Response.json({success:false,reason:'unauthorized'},{status:401});
    if (!orderId || !driverId) return Response.json({error:'Missing parameters'},{status:400});

    const maxSleep=25;
    if (timeoutSeconds>maxSleep) {
      await new Promise(r=>setTimeout(r,maxSleep*1000));
      const order=(await b44.entities.RideOrder.filter({id:orderId}))[0];
      if (!order || ['aceptado','en_camino','en_viaje','completado','cancelado','rechazado'].includes(order.status) || (order.driver_id&&order.driver_id!==driverId)) return Response.json({ok:true,skipped:true});
      const fresh=await b44.entities.RideOrder.get(orderId);
      if (fresh && fresh.assignment_attempt!==assignmentAttempt) return Response.json({ok:true,skipped:true,reason:'attempt_changed'});
      b44.functions.invoke('autoReassignOnTimeout',{orderId,driverId,timeoutSeconds:timeoutSeconds-maxSleep,assignmentAttempt,internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')}).catch(e=>console.error('Chain Error:',e));
      return Response.json({ok:true,chained:true,remaining:timeoutSeconds-maxSleep});
    }

    await new Promise(r=>setTimeout(r,timeoutSeconds*1000));
    const order=(await b44.entities.RideOrder.filter({id:orderId}))[0];
    if (!order || ['aceptado','en_camino','en_viaje','completado','cancelado','rechazado'].includes(order.status) || (order.driver_id&&order.driver_id!==driverId)) return Response.json({ok:true,skipped:true});
    if (order.assignment_attempt!==assignmentAttempt) return Response.json({ok:true,skipped:true,reason:'attempt_changed'});
    if (order.processingOwnerId && Number(order.processingLeaseExpiresAt || 0) > Date.now()) {
      const leaseRemainingMs = Number(order.processingLeaseExpiresAt) - Date.now();
      const retrySeconds = Math.max(1, Math.min(5, Math.ceil(leaseRemainingMs / 1000) + 1));
      b44.functions.invoke('autoReassignOnTimeout',{
        orderId,
        driverId,
        timeoutSeconds:retrySeconds,
        assignmentAttempt,
        internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
      }).catch(e=>console.error('Deferred timeout after processing lease:',e));
      return Response.json({ok:true,deferred:true,reason:'processing_in_progress',retrySeconds});
    }

    const remainingMs=Number.isFinite(Number(order.offerExpiresAt)) ? Number(order.offerExpiresAt)-Date.now() : 0;
    if (remainingMs>0) {
      b44.functions.invoke('autoReassignOnTimeout',{orderId,driverId,timeoutSeconds:Math.max(1,Math.ceil(remainingMs/1000)),assignmentAttempt,internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')}).catch(e=>console.error('Extended Timeout:',e));
      return Response.json({ok:true,extended_for_device_receipt:true,remainingSeconds:Math.ceil(remainingMs/1000)});
    }

    const currentDriver=(await b44.entities.Driver.filter({id:driverId}))[0];
    const config=(await b44.entities.TarifaConfig.list())[0]||{};
    const autoReassignActive=config.auto_reasignacion_activa??true;
    const fullTimeout=config.tiempo_maximo_respuesta_segundos??60;

    if (currentDriver) {
      const releasedCurrent = await b44.entities.Driver.updateMany({id:currentDriver.id,status:'disponible',dispatch_status:'automatic_pending',reserved_order_id:order.id,reservation_token:order.reservation_token},{ $set:{status:'disponible',dispatch_status:'normal',reserved_order_id:null,active_order_id:null,active_ride_id:null,reservation_token:null,manual_reservation_token:null,driver_reservation_key:null,queue_entered_at:new Date().toISOString()} }).catch(()=>null);
      if (!releasedCurrent || (releasedCurrent.matchedCount ?? releasedCurrent.modifiedCount ?? releasedCurrent.updated ?? 0) !== 1) {
        return Response.json({ok:true,skipped:true,reason:'current_driver_reservation_changed'});
      }
      await b44.functions.invoke('sendPushNotification',{action:'cancel_multiple',orderId:order.id,driversToCancel:[currentDriver.id],orderData:{assignmentAttempt},internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')}).catch(e=>console.error('Cancel push:',e));
    }

    const {findNextDriverInZone}=await import('../../shared/driverSelection.ts');
    const excluded=new Set<string>([...(order.offered_driver_ids||[]),driverId].filter(Boolean));
    if (autoReassignActive) {
      for (let i=0;i<100;i++) {
        const candidate=await findNextDriverInZone(b44,{...order,offered_driver_ids:[...excluded]},driverId);
        if (!candidate) break;
        excluded.add(candidate.id);
        const token=crypto.randomUUID();
        const reserve=await b44.entities.Driver.updateMany({id:candidate.id,status:'disponible',dispatch_status:'normal',reserved_order_id:null,active_order_id:null,active_ride_id:null},{ $set:{dispatch_status:'automatic_pending',reserved_order_id:order.id,reservation_token:token} });
        if ((reserve.matchedCount??reserve.modifiedCount??reserve.updated??0)!==1) continue;

        const newAttempt=(order.assignment_attempt||0)+1;
        const offeredIds=[...new Set([...(order.offered_driver_ids||[]),driverId,candidate.id].filter(Boolean))];
        const commit=await b44.entities.RideOrder.updateMany({
          id:orderId,
          status:'ofrecido',
          reserved_driver_id:driverId,
          reservation_token:order.reservation_token,
          assignment_attempt:assignmentAttempt,
          $or:[
            {processingOwnerId:null},
            {processingOwnerId:{$exists:false}},
            {processingLeaseExpiresAt:{$lt:Date.now()}}
          ]
        },{ $set:{status:'ofrecido',driver_id:candidate.id,driver_name:candidate.name,reserved_driver_id:candidate.id,reservation_token:token,manual_reservation_token:null,assigned_base:candidate.current_base,offerExpiresAt:Date.now()+fullTimeout*1000,assignment_attempt:newAttempt,assigned_at:new Date().toISOString(),processingAction:null,processingOperationKey:null,processingOwnerId:null,processingLeaseExpiresAt:null,processingPhase:null,offered_driver_ids:offeredIds} });
        if (commit.updated!==1) {
          await b44.entities.Driver.updateMany({id:candidate.id,reserved_order_id:order.id,reservation_token:token},{ $set:{dispatch_status:'normal',reserved_order_id:null,reservation_token:null} }).catch(()=>{});
          return Response.json({ok:true,skipped:true,reason:'order_changed_during_candidate_reservation'});
        }
        await b44.functions.invoke('sendPushNotification',{action:'send',driverId:candidate.id,orderId:order.id,orderData:{pickup_address:order.pickup_address,dropoff_address:order.dropoff_address,fare:order.fare,notes:order.notes,assignmentAttempt:newAttempt},internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')}).catch(e=>console.error('Push:',e));
        b44.functions.invoke('autoReassignOnTimeout',{orderId,driverId:candidate.id,timeoutSeconds:fullTimeout,assignmentAttempt:newAttempt,internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')}).catch(e=>console.error('AutoReassign:',e));
        return Response.json({ok:true,reassigned_to:candidate.name});
      }
    }

    const pending=await b44.entities.RideOrder.updateMany({
      id:orderId,
      status:'ofrecido',
      reserved_driver_id:driverId,
      reservation_token:order.reservation_token,
      assignment_attempt:assignmentAttempt,
      $or:[
        {processingOwnerId:null},
        {processingOwnerId:{$exists:false}},
        {processingLeaseExpiresAt:{$lt:Date.now()}}
      ]
    },{ $set:{status:'pendiente',driver_id:null,driver_name:null,reserved_driver_id:null,reservation_token:null,manual_reservation_token:null,assigned_base:null,assigned_at:null,offerExpiresAt:null,processingAction:null,processingOperationKey:null,processingOwnerId:null,processingLeaseExpiresAt:null,processingPhase:null},$addToSet:{offered_driver_ids:driverId} });
    if (pending.updated!==1) return Response.json({ok:true,skipped:true,reason:'order_changed_before_pending'});
    return Response.json({ok:true,reassigned_to:null});
  } catch(err:any) {
    console.error('Auto-reassign error:',err);
    return Response.json({error:err.message},{status:500});
  }
});