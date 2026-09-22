import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  try {
    const payload = await req.json();
    const { orderId, action, sessionToken } = payload;
    if (!orderId || !['cancel','reactivate'].includes(action)) {
      return Response.json({ success:false, reason:'INVALID_PARAMS' }, { status:400 });
    }
    const operatorAuthorized = await verifyRequestAuth(b44, payload, { allowOperator:true });
    const clientAuthorized = action === 'cancel' && await verifyRequestAuth(b44, payload, { allowClient:true });
    if (!operatorAuthorized && !clientAuthorized) {
      return Response.json({ success:false, reason:'unauthorized' }, { status:401 });
    }
    if (action === 'reactivate' && !operatorAuthorized) {
      return Response.json({ success:false, reason:'operator_required' }, { status:403 });
    }
    const order = await b44.entities.RideOrder.get(orderId).catch(()=>null);
    if (!order) return Response.json({ success:false, reason:'ORDER_NOT_FOUND' }, { status:404 });

    // Nunca liberar un móvil antes de validar la transición solicitada.
    // Reactivar sólo está permitido desde estados terminales cancelado/rechazado.
    if (action === 'reactivate' && !['cancelado','rechazado'].includes(order.status)) {
      return Response.json({success:false,reason:'REACTIVATE_ONLY_CANCELLED'});
    }

    const driverIds = [...new Set([order.driver_id, order.reserved_driver_id, order.preassigned_driver_id].filter(Boolean))];
    for (const driverId of driverIds) {
      await b44.entities.Driver.updateMany(
        { id:driverId, $or:[{reserved_order_id:orderId},{active_order_id:orderId},{active_ride_id:orderId},{next_order_id:orderId}] },
        { $set:{ status:'disponible', dispatch_status:'normal', reserved_order_id:null, active_order_id:null, active_ride_id:null, reservation_token:null, manual_reservation_token:null, driver_reservation_key:null, next_order_id:null, next_order_token:null } }
      ).catch(()=>{});
    }

    if (action === 'cancel') {
      const changed = await b44.entities.RideOrder.updateMany(
        { id:orderId, status:order.status },
        { $set:{ status:'cancelado', offerExpiresAt:null, processingAction:'CANCELLED_BY_CENTRAL', processingOperationKey:null, processingOwnerId:null, processingLeaseExpiresAt:null, processingPhase:null } }
      );
      if ((changed?.updated ?? changed?.matchedCount ?? changed?.modifiedCount ?? 0) !== 1) return Response.json({success:false,reason:'CONCURRENT_CHANGE'});
      // Regla comercial: sólo una cancelación de Central devuelve el móvil primero.
      // Una cancelación del cliente libera el viaje sin alterar la prioridad de cola.
      if (operatorAuthorized && order.driver_id && !order.preassigned_driver_id) {
        const baseName = order.assigned_base || order.zone || null;
        if (baseName) await b44.functions.invoke('requeueDriverFront',{driverId:order.driver_id,baseName,sessionToken}).catch(()=>{});
      }
      if (driverIds.length) b44.functions.invoke('sendPushNotification',{action:'cancel_multiple',driversToCancel:driverIds,orderId,sessionToken}).catch(()=>{});
      await b44.entities.AuditLog.create({action:operatorAuthorized ? 'CENTRAL_CANCEL_COMMITTED' : 'CLIENT_CANCEL_COMMITTED',user_type:operatorAuthorized ? 'operador' : 'cliente',user_name:operatorAuthorized ? 'Central' : 'Cliente',details:`Cancelación autoritativa de ${orderId}`,metadata:{orderId,driverIds}}).catch(()=>{});
      return Response.json({success:true,status:'cancelado'});
    }

    const changed = await b44.entities.RideOrder.updateMany(
      { id:orderId, status:order.status },
      { $set:{ status:'pendiente', driver_id:null, driver_name:null, assigned_base:null, reserved_driver_id:null, preassigned_driver_id:null, preassignment_token:null, preassigned_at:null, claimed_from_pending:false, reservation_token:null, manual_reservation_token:null, offerExpiresAt:null, processingAction:'PENDING_AUTHORIZED', pending_reason:'CENTRAL_REACTIVATED', processingOperationKey:null, processingOwnerId:null, processingLeaseExpiresAt:null, processingPhase:null } }
    );
    if ((changed?.updated ?? changed?.matchedCount ?? changed?.modifiedCount ?? 0) !== 1) return Response.json({success:false,reason:'CONCURRENT_CHANGE'});
    await b44.entities.AuditLog.create({action:'CENTRAL_REACTIVATE_PENDING_AUTHORIZED',user_type:'operador',user_name:'Central',details:`Reactivación autoritativa de ${orderId}`,metadata:{orderId}}).catch(()=>{});
    return Response.json({success:true,status:'pendiente'});
  } catch (e) {
    console.error('operatorOrderAction',e);
    return Response.json({success:false,error:e?.message || String(e)},{status:500});
  }
});
