import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

const ACTIVE_STATUSES = ['aceptado', 'en_camino', 'en_viaje'];

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  try {
    const payload = await req.json();
    const { orderId, sessionToken, operatorName } = payload || {};
    if (!(await verifyRequestAuth(b44, { sessionToken }, { allowOperator:true }))) return Response.json({success:false,reason:'unauthorized'},{status:401});
    if (!orderId) return Response.json({success:false,reason:'missing_order_id'},{status:400});
    const order = await b44.entities.RideOrder.get(orderId).catch(()=>null);
    if (!order) return Response.json({success:false,reason:'order_not_found'},{status:404});
    if (order.status === 'completado') return Response.json({success:true,idempotent:true,reason:'already_completed'});
    if (!ACTIVE_STATUSES.includes(order.status)) return Response.json({success:false,reason:'invalid_status',status:order.status},{status:409});
    const driverId = order.driver_id || order.reserved_driver_id || null;
    if (!driverId) return Response.json({success:false,reason:'driver_not_linked'},{status:409});

    // Central delega al mismo cierre canónico: una sola autoridad para liberar
    // el primer viaje y promover un segundo confirmado.
    const finish = await base44.functions.invoke('finishRide', {
      orderId, driverId,
      importeFinal: order.importe_real_actual ?? 0,
      operationKey: `MANUAL_FINISH_${orderId}_${Date.now()}`,
      sessionToken
    });
    const data = finish?.data || {};
    if (!data.success) return Response.json({success:false,reason:data.reason || 'FINISH_FAILED',canonical:data},{status:409});

    await b44.entities.AuditLog.create({
      action:'MANUAL_RIDE_COMPLETED', user_type:'operador', user_name:operatorName || 'Central',
      details:`Pasaje ${orderId} terminado manualmente por Central mediante finishRide canónico`,
      metadata:{orderId,driverId,promotedNextOrderId:data.promotedNextOrderId || null,source:'central_manual_finish_canonical'}
    }).catch(()=>{});
    return Response.json({success:true,orderId,driverId,promotedNextOrderId:data.promotedNextOrderId || null,canonical:true});
  } catch (error) {
    console.error('manualCompleteRide error', error);
    return Response.json({success:false,reason:error?.message || 'error'},{status:500});
  }
});
