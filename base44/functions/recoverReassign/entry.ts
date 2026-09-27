import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { findNextDriverInZone } from '../../shared/driverSelection.ts';
import { verifyRequestAuth } from '../../shared/security.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  try {
    const body = await req.json();
    if (!(await verifyRequestAuth(b44, body, { allowOperator:true }))) {
      return Response.json({success:false,reason:'unauthorized'},{status:401});
    }
    const { orderId } = body;
    if (!orderId) return Response.json({success:false,reason:'MISSING_ORDER_ID'},{status:400});

    const order = await b44.entities.RideOrder.get(orderId).catch(()=>null);
    if (!order) return Response.json({success:false,reason:'ORDER_NOT_FOUND'},{status:404});
    if (order.status !== 'ofrecido' || order.processingAction !== 'REASSIGN_RECOVERY_REQUIRED') {
      return Response.json({success:false,reason:'NOT_RECOVERABLE_STATE'},{status:409});
    }

    // El móvil del intento fallido ya fue liberado por rejectRide. Nunca restaurarlo.
    // Conservamos offered_driver_ids para que el selector no vuelva a ofrecerle.
    const oldDriverId = order.reserved_driver_id || order.driver_id || null;
    const offered = [...new Set([...(order.offered_driver_ids || []), oldDriverId].filter(Boolean))];
    const reopened = await b44.entities.RideOrder.updateMany(
      {
        id:order.id,
        status:'ofrecido',
        processingAction:'REASSIGN_RECOVERY_REQUIRED',
        reserved_driver_id:order.reserved_driver_id ?? null,
        reservation_token:order.reservation_token ?? null,
        assignment_attempt:order.assignment_attempt
      },
      { $set:{
        status:'procesando_despacho',
        driver_id:null,
        driver_name:null,
        reserved_driver_id:null,
        reservation_token:null,
        assigned_base:null,
        assigned_at:null,
        offerExpiresAt:null,
        push_ack_at:null,
        push_ack_assignment_attempt:null,
        alert_presented_at:null,
        alert_presented_assignment_attempt:null,
        alert_presented_protocol_attempt:null,
        processingAction:null,
        processingOwnerId:null,
        processingOperationKey:null,
        processingLeaseExpiresAt:null,
        processingPhase:null,
        pending_reason:null,
        offered_driver_ids:offered
      } }
    );
    if ((reopened?.updated ?? reopened?.modifiedCount ?? reopened?.matchedCount ?? 0) !== 1) {
      return Response.json({success:false,reason:'RECOVERY_CAS_LOST'},{status:409});
    }

    const recoveryOrder = {...order,status:'procesando_despacho',driver_id:null,reserved_driver_id:null,reservation_token:null,offered_driver_ids:offered};
    const excluded = new Set<string>(offered);
    const snapshot = await b44.entities.Driver.filter({status:'disponible',queue_authoritative_base:order.zone}).catch(()=>[]);
    const maxAttempts = Math.max(1,Math.min(100,Array.isArray(snapshot)?snapshot.length:0));

    for (let i=0;i<maxAttempts;i++) {
      const next = await findNextDriverInZone(b44,recoveryOrder,excluded);
      if (!next) break;
      excluded.add(next.id);
      const res = await b44.functions.invoke('assignRide',{
        orderId:order.id,driverId:next.id,internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
      });
      const data = res?.data || res;
      if (data?.success === true) {
        await b44.entities.AuditLog.create({
          action:'REASSIGN_RECOVERED',user_type:'sistema',user_name:'recoverReassign',
          details:`Reasignación recuperada para ${order.id} a ${next.id}`,
          metadata:{orderId:order.id,previousDriverId:oldDriverId,nextDriverId:next.id}
        }).catch(()=>{});
        return Response.json({success:true,reassigned_to:next.id});
      }
      if (data?.reason === 'QUEUE_SNAPSHOT_STALE') excluded.delete(next.id);
    }

    // Revalidación final antes de Pendientes.
    const finalCandidate = await findNextDriverInZone(b44,recoveryOrder,excluded);
    if (finalCandidate) {
      const res = await b44.functions.invoke('assignRide',{
        orderId:order.id,driverId:finalCandidate.id,internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
      });
      const data=res?.data||res;
      if (data?.success === true) return Response.json({success:true,reassigned_to:finalCandidate.id});
    }

    const pending = await b44.entities.RideOrder.updateMany(
      {id:order.id,status:'procesando_despacho'},
      {$set:{status:'pendiente',processingAction:'PENDING_AUTHORIZED',pending_reason:'ZONE_EXHAUSTED_AFTER_RECOVERY'}}
    );
    if ((pending?.updated ?? pending?.modifiedCount ?? pending?.matchedCount ?? 0) !== 1) {
      return Response.json({success:false,reason:'RECOVERY_PENDING_CAS_LOST'},{status:409});
    }
    await b44.entities.AuditLog.create({
      action:'PENDING_AUTHORIZED',user_type:'sistema',user_name:'recoverReassign',
      details:`Recuperación ${order.id}: zona agotada; Pendiente autorizado`,
      metadata:{orderId:order.id,zone:order.zone||null,previousDriverId:oldDriverId}
    }).catch(()=>{});
    return Response.json({success:true,reassigned_to:null,status:'pendiente'});
  } catch(e) {
    console.error('recoverReassign error',e);
    return Response.json({success:false,error:e?.message||String(e)},{status:500});
  }
});
