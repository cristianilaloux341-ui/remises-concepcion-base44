import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { findNextDriverInZone } from '../../shared/driverSelection.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  try {
    const { orderId, driverId, mobileId, sessionToken, manual } = await req.json();
    if (!orderId) return Response.json({ success:false, reason:'ORDER_ID_REQUIRED' }, { status:400 });

    const order = await b44.entities.RideOrder.get(orderId).catch(() => null);
    if (!order) return Response.json({ success:false, reason:'ORDER_NOT_FOUND' }, { status:404 });
    if (order.status !== 'pendiente') return Response.json({ success:false, reason:'ORDER_NOT_PENDING' }, { status:409 });

    const centralReviewOnly = order.pending_reason === 'REQUESTED_DRIVER_NOT_ACCEPTED' ||
      order.processingAction === 'CENTRAL_REVIEW_REQUIRED_DRIVER';

    // Un requerido no aceptado queda congelado para decisión humana. Nunca puede
    // reactivar por sí solo la cadena automática; Central debe elegir otro móvil.
    if (centralReviewOnly && !driverId) {
      return Response.json({ success:false, reason:'REQUESTED_DRIVER_OPERATOR_SELECTION_REQUIRED' }, { status:409 });
    }

    let targetId = driverId || null;
    if (!targetId) {
      const zoneKey = String(order.zone || '').trim().toLowerCase();
      if (zoneKey === '0' || zoneKey === '0-pendientes' || zoneKey === '0-pendiente') {
        return Response.json({ success:false, reason:'ZONE_0_OPERATOR_SELECTION_REQUIRED' }, { status:409 });
      }
      const next = await findNextDriverInZone(b44, order, new Set());
      targetId = next?.id || null;
    }
    if (!targetId) return Response.json({ success:false, reason:'NO_ELIGIBLE_DRIVER' }, { status:409 });

    // Al elegir explícitamente otro móvil, la retención deja de ser exclusiva del
    // requerido original. assignRide hará la nueva oferta canónica.
    if (centralReviewOnly && driverId) {
      const releaseHold = await b44.entities.RideOrder.updateMany(
        { id:orderId, status:'pendiente', pending_reason:'REQUESTED_DRIVER_NOT_ACCEPTED' },
        { $set:{
          requested_driver_only:false,
          requested_driver_id:null,
          pending_reason:'MANUAL_RETURN',
          processingAction:null
        } }
      );
      if ((releaseHold.matchedCount ?? releaseHold.modifiedCount ?? releaseHold.updated ?? 0) !== 1) {
        return Response.json({ success:false, reason:'ORDER_CHANGED_BEFORE_OPERATOR_REASSIGN' }, { status:409 });
      }
    }

    const res = await b44.functions.invoke('assignRide', {
      orderId,
      driverId:targetId,
      mobileId:mobileId || null,
      requireDriverConfirmation:true,
      forceManual:manual === true,
      sessionToken:sessionToken || null,
      internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')
    });
    if (!res?.data?.success) {
      // Si liberamos una retención de móvil requerido para que Central pruebe otro
      // móvil y esa nueva asignación falla, el viaje NO puede quedar convertido en
      // un pendiente común. Restauramos la retención sólo si sigue pendiente y sin dueño.
      if (centralReviewOnly && driverId) {
        const restoredHold = await b44.entities.RideOrder.updateMany(
          {
            id:orderId,
            status:'pendiente',
            pending_reason:'MANUAL_RETURN',
            $and:[
              {$or:[{driver_id:null},{driver_id:{$exists:false}}]},
              {$or:[{reserved_driver_id:null},{reserved_driver_id:{$exists:false}}]}
            ]
          },
          { $set:{
            requested_driver_only:true,
            requested_driver_id:order.requested_driver_id || null,
            pending_reason:'REQUESTED_DRIVER_NOT_ACCEPTED',
            processingAction:'CENTRAL_REVIEW_REQUIRED_DRIVER'
          } }
        ).catch(()=>null);
        if ((restoredHold?.matchedCount ?? restoredHold?.modifiedCount ?? restoredHold?.updated ?? 0) !== 1) {
          await b44.entities.AuditLog.create({action:'REQUESTED_PENDING_HOLD_RESTORE_FAILED',user_type:'sistema',user_name:'operatorDispatchPendingRide',details:`Falló restauración de retención Central-only para ${orderId} tras asignación manual fallida`,metadata:{orderId,requestedDriverId:order.requested_driver_id || null,targetDriverId:driverId,assignReason:res?.data?.reason || 'ASSIGN_FAILED'}}).catch(()=>{});
          return Response.json({success:false,reason:'REQUESTED_PENDING_HOLD_RESTORE_FAILED'},{status:409});
        }
      }
      return Response.json({ success:false, reason:res?.data?.reason || 'ASSIGN_FAILED' }, { status:409 });
    }
    return Response.json({ success:true, driverId:targetId, status:'ofrecido' });
  } catch(e) {
    console.error('operatorDispatchPendingRide error', e);
    return Response.json({ success:false, reason:e?.message || 'DISPATCH_FAILED' }, { status:500 });
  }
});