import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  try {
    const payload = await req.json();
    const { orderId, action, sessionToken } = payload;
    if (!orderId || action !== 'cancel') {
      return Response.json({ success:false, reason:'INVALID_PARAMS' }, { status:400 });
    }
    const operatorAuthorized = await verifyRequestAuth(b44, payload, { allowOperator:true });
    const clientAuthorized = action === 'cancel' && await verifyRequestAuth(b44, payload, { allowClient:true });
    if (!operatorAuthorized && !clientAuthorized) {
      return Response.json({ success:false, reason:'unauthorized' }, { status:401 });
    }
    const order = await b44.entities.RideOrder.get(orderId).catch(()=>null);
    if (!order) return Response.json({ success:false, reason:'ORDER_NOT_FOUND' }, { status:404 });

    // Cancelación es terminal. Un pasaje cancelado no se reactiva: si vuelve a pedirse,
    // debe nacer una orden nueva y entrar por el motor canónico de despacho.

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

  } catch (e) {
    console.error('operatorOrderAction',e);
    return Response.json({success:false,error:e?.message || String(e)},{status:500});
  }
});
