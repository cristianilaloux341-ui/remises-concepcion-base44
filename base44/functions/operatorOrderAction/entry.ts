import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';
import { getBaseQueue, withQueueLock } from '../../shared/queueOrder.ts';

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
      const driver = await b44.entities.Driver.get(driverId).catch(()=>null);
      if (!driver) continue;

      // Segundo slot: cancelar ESTA orden nunca puede tocar el primer viaje.
      if (driver.next_order_id === orderId) {
        const nextQuery:any = { id:driverId, next_order_id:orderId };
        if (driver.next_order_token) nextQuery.next_order_token = driver.next_order_token;
        await b44.entities.Driver.updateMany(
          nextQuery,
          { $set:{ next_order_id:null, next_order_token:null } }
        ).catch(()=>{});
        continue;
      }

      // Primer slot/oferta: limpiar solamente las referencias que realmente apuntan
      // a esta orden. Un next_order_id distinto se conserva intacto.
      const ownsCurrent = driver.reserved_order_id === orderId || driver.active_order_id === orderId || driver.active_ride_id === orderId;
      if (!ownsCurrent) continue;
      const currentQuery:any = { id:driverId };
      if (driver.reserved_order_id === orderId) currentQuery.reserved_order_id = orderId;
      if (driver.active_order_id === orderId) currentQuery.active_order_id = orderId;
      if (driver.active_ride_id === orderId) currentQuery.active_ride_id = orderId;
      const keepNext = Boolean(driver.next_order_id && driver.next_order_id !== orderId);
      await b44.entities.Driver.updateMany(
        currentQuery,
        { $set:{
          status: keepNext ? driver.status : 'disponible',
          dispatch_status: keepNext ? driver.dispatch_status : 'normal',
          ...(driver.reserved_order_id === orderId ? {reserved_order_id:null,reservation_token:null,manual_reservation_token:null,driver_reservation_key:null} : {}),
          ...(driver.active_order_id === orderId ? {active_order_id:null} : {}),
          ...(driver.active_ride_id === orderId ? {active_ride_id:null} : {})
        } }
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
        if (baseName) {
          await withQueueLock(b44, baseName, async () => {
            const target = await b44.entities.Driver.get(order.driver_id).catch(()=>null);
            if (!target || target.status !== 'disponible' || target.dispatch_status !== 'normal' ||
                target.reserved_order_id || target.active_order_id || target.active_ride_id || target.next_order_id) return;

            const drivers = await b44.entities.Driver.filter({
              status:'disponible',
              $or:[{current_base:baseName},{queue_authoritative_base:baseName}]
            });
            const queue = getBaseQueue(drivers, baseName).filter((d:any)=>d.id !== target.id);
            const now = new Date().toISOString();

            // Cancelación de Central: reingreso explícito primero bajo la misma autoridad de cola.
            await b44.entities.Driver.updateMany(
              {id:target.id,status:'disponible',dispatch_status:'normal',reserved_order_id:null,active_order_id:null,active_ride_id:null,next_order_id:null},
              {$set:{current_base:baseName,queue_authoritative_base:baseName,queue_position:1,queue_authority_marker:1,queue_entered_at:now,queue_authoritative_at:now}}
            );
            for (let i=0;i<queue.length;i++) {
              const d:any=queue[i]; const pos=i+2;
              if (Number(d.queue_position)===pos && Number(d.queue_authority_marker)===pos) continue;
              await b44.entities.Driver.updateMany(
                {id:d.id,queue_authoritative_base:baseName,status:'disponible',dispatch_status:'normal',reserved_order_id:null,active_order_id:null,active_ride_id:null},
                {$set:{queue_position:pos,queue_authority_marker:pos}}
              );
            }
          }).catch(()=>{});
        }
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
