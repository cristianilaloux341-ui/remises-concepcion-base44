import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

export const options = {requiresAuth:false};
Deno.serve(async (req) => {
  try {
    const base44=createClientFromRequest(req), b44=base44.asServiceRole;
    const payload=await req.json();
    const {orderId,driverId}=payload;
    if(!orderId||!driverId)return Response.json({success:false,reason:'missing_params'},{status:400});
    if(!(await verifyRequestAuth(b44,payload,{allowDriverId:driverId})))
      return Response.json({success:false,reason:'unauthorized'},{status:401});
    const order=await b44.entities.RideOrder.get(String(orderId)).catch(()=>null);
    if(!order||order.status!=='en_viaje'||String(order.driver_id||'')!==String(driverId))
      return Response.json({success:false,reason:'ride_not_active'},{status:409});
    const metros=Math.max(Number(order.metros_taximetro||0),Number(payload.metros||0));
    const espera=Math.max(Number(order.segundos_espera_acumulados||0),Number(payload.segundosEspera||0));
    const tolerancia=Math.max(Number(order.segundos_tolerancia_espera_usados||0),Number(payload.segundosTolerancia||0));
    const importe=Math.max(Number(order.importe_real_actual||0),Number(payload.importe||0));
    const movement=['parado','movimiento','detectando'].includes(String(payload.movement||''))?String(payload.movement):String(order.meter_movement_state||'detectando');
    const updated=await b44.entities.RideOrder.updateMany(
      {id:order.id,status:'en_viaje',driver_id:driverId},
      {$set:{...(payload.segundosDetenido!=null?{segundos_detenido_acumulados:Math.max(Number(order.segundos_detenido_acumulados||0),Number(payload.segundosDetenido||0))}:{}),metros_taximetro:metros,segundos_espera_acumulados:espera,segundos_tolerancia_espera_usados:tolerancia,importe_real_actual:importe,meter_movement_state:movement,meter_checkpoint_at:new Date().toISOString()}}
    );
    return Response.json({success:updated?.updated===1,metros,segundosEspera:espera,segundosTolerancia:tolerancia,importe});
  } catch(error){return Response.json({success:false,error:error?.message||'checkpoint_failed'},{status:500})}
});

