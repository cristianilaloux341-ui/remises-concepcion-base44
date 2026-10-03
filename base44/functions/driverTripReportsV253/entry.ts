import {createClientFromRequest} from "npm:@base44/sdk@0.8.40";
export const options={requiresAuth:false};
// Shared by history and the home total: same completed rides, dates and amounts.
function reportDate(value:any){
 if(!value)return null;let text=String(value);
 if(/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(text)&&!/(Z|[+-]\d\d:\d\d)$/i.test(text))text+='Z';
 const date=new Date(text);return Number.isFinite(date.getTime())?date:null;
}
function nonnegative(value:any){const n=Number(value);return Number.isFinite(n)?Math.max(0,n):0;}
function optionalSeconds(value:any){return value==null||value===''?null:Math.floor(nonnegative(value));}
function periodBounds(period:string,now=new Date()){
 const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=(type:string)=>p.find(x=>x.type===type)?.value||'';
 const day=`${part('year')}-${part('month')}-${part('day')}`;
 const anchor=new Date(day+'T12:00:00Z');
 if(period==='week')anchor.setUTCDate(anchor.getUTCDate()-(anchor.getUTCDay()+6)%7);
 if(period==='month')anchor.setUTCDate(1);
 return {day,from:new Date(anchor.toISOString().slice(0,10)+'T03:00:00Z'),to:now};
}
function reportRide(order:any){
 let finished:Date|null=null,source='';
 for(const field of ['ride_finished_at','completed_at','updated_date','created_date']){finished=reportDate(order[field]);if(finished){source=field;break;}}
 const started=reportDate(order.ride_started_at);
 const derived=started&&finished&&['ride_finished_at','completed_at'].includes(source)?Math.max(0,Math.floor((finished.getTime()-started.getTime())/1000)):null;
 const stored=optionalSeconds(order.ride_duration_seconds??order.duration_seconds);
 const duration=stored!=null&&stored>0?stored:derived??stored;
 const rawWait=optionalSeconds(order.segundos_detenido_acumulados);
 const billable=optionalSeconds(order.segundos_espera_acumulados??order.wait_seconds);
 return {id:order.id,ride_number:order.ride_number||order.numero_viaje||order.id,
 pickup_address:order.pickup_address||order.origin_address,dropoff_address:order.dropoff_address||order.destination_address,
 driver_name:order.driver_name,driver_mobile:order.driver_mobile,driver_vehicle_plate:order.driver_vehicle_plate,
 importe_final:nonnegative(order.importe_real_actual??order.importe_final??order.importe??order.fare),
 metros_taximetro:nonnegative(order.metros_taximetro??order.distance_meters??order.distancia_teorica_metros),
 segundos_espera_acumulados:billable,segundos_detenido_acumulados:rawWait,
 ride_duration_seconds:duration,ride_started_at:order.ride_started_at||null,
 completed_at:finished?.toISOString()||null,completion_date_estimated:!['ride_finished_at','completed_at'].includes(source)};
}
function buildRideHistory(orders:any[],period:string,now=new Date()){
 const bounds=periodBounds(period,now),seen=new Set();
 const rows=orders.filter(o=>{if(o.status!=='completado'||seen.has(o.id))return false;seen.add(o.id);return true;}).map(reportRide).filter(o=>{const d=reportDate(o.completed_at);return d&&d>=bounds.from&&d<=bounds.to;}).sort((a,b)=>Date.parse(b.completed_at)-Date.parse(a.completed_at));
 const total=rows.reduce((s,o)=>s+o.importe_final,0),km=rows.reduce((s,o)=>s+o.metros_taximetro,0)/1000;
 return {success:true,period,day:bounds.day,orders:rows,total,km,summary:{total,count:rows.length,km,durationSeconds:rows.reduce((s,o)=>s+(o.ride_duration_seconds||0),0),billableWaitSeconds:rows.reduce((s,o)=>s+(o.segundos_espera_acumulados||0),0)}};
}
async function loadCompletedRides(entity:any,driverId:string,from:Date){
 const filter={driver_id:driverId,status:'completado',$or:[{ride_finished_at:{$gte:from.toISOString()}},{updated_date:{$gte:from.toISOString()}}]};
 const rows:any[]=[];const seen=new Set();const limit=200;
 for(let skip=0;;skip+=limit){
  const page=await entity.filter(filter,'-created_date',limit,skip);
  if(!Array.isArray(page))throw new Error('HISTORY_INVALID_RESPONSE');
  let added=0;for(const o of page){if(!seen.has(o.id)){seen.add(o.id);rows.push(o);added++;}}
  if(page.length<limit)return rows;
  if(!added)throw new Error('HISTORY_PAGINATION_STALLED');
 }
}

Deno.serve(async(req)=>{
 try{
  const payload=await req.json(),base44=createClientFromRequest(req),b44=base44.asServiceRole;
  const driver=await b44.entities.Driver.get(String(payload.driver_id||"")).catch(()=>null);
  if(!driver||driver.device_id!==payload.device_id||driver.current_session_token!==payload.access_token)
   return Response.json({success:false,reason:"invalid_session"},{status:401});
  const action=payload.action||"history";
  if(action==="checkpoint"||action==="finish_metrics"){
   const order=await b44.entities.RideOrder.get(String(payload.orderId||"")).catch(()=>null);
   const expectedStatus=action==="checkpoint"?"en_viaje":"completado";
   if(!order||order.status!==expectedStatus||String(order.driver_id)!==String(driver.id))
    return Response.json({success:false,reason:"ride_not_owned_or_closed"},{status:409});
   const set:any={
    metros_taximetro:Math.max(nonnegative(order.metros_taximetro),nonnegative(payload.metros)),
    segundos_espera_acumulados:Math.max(nonnegative(order.segundos_espera_acumulados),nonnegative(payload.segundosEspera)),
    segundos_tolerancia_espera_usados:Math.max(nonnegative(order.segundos_tolerancia_espera_usados),nonnegative(payload.segundosTolerancia))
   };
   if(payload.segundosDetenido!=null)set.segundos_detenido_acumulados=Math.max(nonnegative(order.segundos_detenido_acumulados),nonnegative(payload.segundosDetenido));
   if(action==="checkpoint")set.importe_real_actual=Math.max(nonnegative(order.importe_real_actual),nonnegative(payload.importe));
   else{const start=reportDate(order.ride_started_at),finish=reportDate(order.ride_finished_at);
    if(start&&finish)set.ride_duration_seconds=Math.max(0,Math.floor((finish.getTime()-start.getTime())/1000));
   }
   const changed=await b44.entities.RideOrder.updateMany({id:order.id,driver_id:driver.id,status:expectedStatus},{$set:set});
   const count=Math.max(Number(changed?.updated||0),Number(changed?.matchedCount||0),Number(changed?.modifiedCount||0));
   if(count!==1)return Response.json({success:false,reason:"METRICS_NOT_COMMITTED"},{status:409});
   const saved=await b44.entities.RideOrder.get(order.id);
   return Response.json({success:true,order:saved,reportVersion:253});
  }
  if(action==="save_occasional"){
   const start=reportDate(payload.ride_started_at),finish=reportDate(payload.ride_finished_at);
   if(!start||!finish||finish<start)return Response.json({success:false,reason:"INVALID_TRIP_TIMES"},{status:400});
   const startedAt=start.toISOString(),finishedAt=finish.toISOString();
   const prior=await b44.entities.RideOrder.filter({driver_id:driver.id,status:"completado",client_name:"Viaje Ocasional (Calle)",ride_started_at:startedAt},"-created_date",1);
   if(prior.length)return Response.json({success:true,order:prior[0],reportVersion:253});
   const movil=driver.vehicle_model?await b44.entities.Movil.get(String(driver.vehicle_model)).catch(()=>null):null;
   const tariff=payload.tarifa||{};
   const data:any={client_name:"Viaje Ocasional (Calle)",pickup_address:"Viaje en calle",status:"completado",
    driver_id:driver.id,driver_name:driver.name||"",driver_mobile:String(movil?.numero_movil||""),driver_vehicle_plate:driver.vehicle_plate||"",
    fare:Math.round(nonnegative(payload.importe)),importe_real_actual:Math.round(nonnegative(payload.importe)),source:"operador",
    metros_taximetro:Math.round(nonnegative(payload.metros)),segundos_espera_acumulados:Math.floor(nonnegative(payload.segundosEspera)),
    segundos_tolerancia_espera_usados:Math.floor(nonnegative(payload.segundosTolerancia)),
    ride_started_at:startedAt,ride_finished_at:finishedAt,ride_duration_seconds:Math.floor((finish.getTime()-start.getTime())/1000),taximetro_iniciado:false};
   if(payload.segundosDetenido!=null)data.segundos_detenido_acumulados=Math.floor(nonnegative(payload.segundosDetenido));
   const fields={bajada_bandera:"tarifa_bajada_snapshot",valor_ficha:"tarifa_valor_ficha_snapshot",metros_por_ficha:"tarifa_metros_por_ficha_snapshot",valor_ficha_espera:"tarifa_valor_ficha_espera_snapshot",segundos_por_ficha_espera:"tarifa_segundos_por_ficha_espera_snapshot",tolerancia_espera_segundos:"tarifa_tolerancia_espera_segundos_snapshot"};
   for(const [key,field] of Object.entries(fields))if(tariff[key]!=null)data[field]=nonnegative(tariff[key]);
   const created=await b44.entities.RideOrder.create(data),saved=await b44.entities.RideOrder.get(created.id);
   if(!saved?.ride_finished_at||saved.ride_duration_seconds!==data.ride_duration_seconds)
    return Response.json({success:false,reason:"TRIP_NOT_PERSISTED"},{status:500});
   return Response.json({success:true,order:saved,reportVersion:253});
  }
  if(!["history","summary"].includes(action))return Response.json({success:false,reason:"UNKNOWN_ACTION"},{status:400});
  const period=action==="summary"?"day":["day","week","month"].includes(payload.period)?payload.period:"day";
  const now=new Date(),bounds=periodBounds(period,now);
  const rows=await loadCompletedRides(b44.entities.RideOrder,driver.id,bounds.from),history=buildRideHistory(rows,period,now);
  if(action==="summary")return Response.json({success:true,daily_summary:{earnings:history.summary.total,trips:history.summary.count,day:history.day},reportVersion:253});
  return Response.json({...history,reportVersion:253});
 }catch(error){return Response.json({success:false,error:error?.message||"REPORT_FAILED"},{status:500})}
});
