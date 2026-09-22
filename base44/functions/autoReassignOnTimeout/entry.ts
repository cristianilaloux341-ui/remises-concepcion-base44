import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

const sleep = (ms:number) => new Promise(resolve => setTimeout(resolve, ms));
const MAX_WAIT_MS = 8000;
const DELIVERY_RETRY_MS = 8000;
const DELIVERY_ADVANCE_MS = 8000;

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

    const readCurrent = async () => {
      const o = await b44.entities.RideOrder.get(orderId).catch(()=>null);
      if (!o || o.status !== 'ofrecido' || o.reserved_driver_id !== driverId ||
          Number(o.assignment_attempt) !== Number(assignmentAttempt)) return null;
      return o;
    };
    const chain = () => b44.functions.invoke('autoReassignOnTimeout', {
      orderId, driverId, assignmentAttempt:Number(assignmentAttempt),
      internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
    }).catch(()=>{});

    let order = await readCurrent();
    if (!order) return Response.json({ ok:true, skipped:true, reason:'offer_changed' });

    const presented = Boolean(order.alert_presented_at &&
      Number(order.alert_presented_assignment_attempt) === Number(assignmentAttempt));

    if (presented) {
      const expiry = Number(order.offerExpiresAt);
      if (!Number.isFinite(expiry)) {
        return Response.json({ ok:true, skipped:true, reason:'presented_without_expiry_guard' });
      }
      const remaining = expiry - Date.now();
      if (remaining > 0) {
        await sleep(Math.min(MAX_WAIT_MS, Math.max(250, remaining)));
        order = await readCurrent();
        if (!order) return Response.json({ ok:true, skipped:true, reason:'offer_changed_during_wait' });
        const freshExpiry = Number(order.offerExpiresAt);
        if (Number.isFinite(freshExpiry) && Date.now() < freshExpiry) {
          chain();
          return Response.json({ ok:true, chained:true, reason:'response_window_active', remainingMs:freshExpiry-Date.now() });
        }
      }

      order = await readCurrent();
      if (!order) return Response.json({ ok:true, skipped:true, reason:'offer_changed_before_timeout' });
      const finalExpiry = Number(order.offerExpiresAt);
      if (!Number.isFinite(finalExpiry) || Date.now() < finalExpiry) {
        chain();
        return Response.json({ ok:true, chained:true, reason:'expiry_not_reached' });
      }

      const result = await b44.functions.invoke('rejectRide', {
        orderId, driverId, assignmentAttempt:Number(assignmentAttempt), source:'timeout',
        internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
      });
      const data = result?.data || result;
      if (data?.reason === 'PROCESSING_IN_PROGRESS') {
        await sleep(1000); chain();
        return Response.json({ ok:true, deferred:true, reason:'processing_in_progress' });
      }
      return Response.json({ ok:data?.success !== false, timeoutProcessed:true, result:data });
    }

    // Sin ALERT_PRESENTED no existe reloj comercial. Sólo controlamos entrega.
    const assignedMs = order.assigned_at ? new Date(order.assigned_at).getTime() : Date.now();
    const ackMs = order.push_ack_at && Number(order.push_ack_assignment_attempt) === Number(assignmentAttempt)
      ? new Date(order.push_ack_at).getTime() : NaN;
    const anchor = Number.isFinite(ackMs) ? ackMs : assignedMs;
    const retryAt = anchor + DELIVERY_RETRY_MS;
    const advanceAt = retryAt + DELIVERY_ADVANCE_MS;
    let retryCount = Number(order.delivery_retry_count || 0);
    let now = Date.now();

    if (retryCount === 0 && now < retryAt) {
      await sleep(Math.min(MAX_WAIT_MS, Math.max(250, retryAt-now)));
      chain();
      return Response.json({ ok:true, chained:true, reason:'waiting_delivery_confirmation' });
    }

    order = await readCurrent();
    if (!order) return Response.json({ ok:true, skipped:true, reason:'offer_changed_before_delivery_retry' });
    if (order.alert_presented_at && Number(order.alert_presented_assignment_attempt) === Number(assignmentAttempt)) {
      chain();
      return Response.json({ ok:true, chained:true, reason:'presented_detected' });
    }
    retryCount = Number(order.delivery_retry_count || 0);
    now = Date.now();

    if (retryCount === 0 && now >= retryAt) {
      const cas = await b44.entities.RideOrder.updateMany({
        id:orderId,status:'ofrecido',reserved_driver_id:driverId,
        reservation_token:order.reservation_token,assignment_attempt:Number(assignmentAttempt),
        $or:[{delivery_retry_count:0},{delivery_retry_count:null},{delivery_retry_count:{$exists:false}}]
      },{$set:{delivery_retry_count:1}}).catch(()=>({updated:0}));
      const won=(cas?.updated??cas?.matchedCount??cas?.modifiedCount??0)===1;
      if(won){
        await b44.functions.invoke('sendPushNotification',{
          action:'send',driverId,orderId,
          orderData:{pickup_address:order.pickup_address,dropoff_address:order.dropoff_address,fare:order.fare,notes:order.notes,assignmentAttempt:Number(assignmentAttempt)},
          internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
        }).catch(()=>null);
      }
      retryCount=1;
    }

    now=Date.now();
    if(now<advanceAt){
      await sleep(Math.min(MAX_WAIT_MS,Math.max(250,advanceAt-now)));
      chain();
      return Response.json({ok:true,chained:true,reason:'waiting_after_delivery_retry'});
    }

    order=await readCurrent();
    if(!order) return Response.json({ok:true,skipped:true,reason:'offer_changed_before_delivery_advance'});
    if(order.alert_presented_at && Number(order.alert_presented_assignment_attempt)===Number(assignmentAttempt)){
      chain();
      return Response.json({ok:true,chained:true,reason:'presented_won_delivery_race'});
    }

    const result=await b44.functions.invoke('rejectRide',{
      orderId,driverId,assignmentAttempt:Number(assignmentAttempt),source:'delivery_unconfirmed_exhausted',
      internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
    });
    return Response.json({ok:(result?.data||result)?.success!==false,deliveryUnconfirmed:true,result:result?.data||result});
  } catch(err:any) {
    console.error('Auto-reassign error:',err);
    return Response.json({success:false,error:err.message},{status:500});
  }
});