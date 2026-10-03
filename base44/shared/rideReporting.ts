// Shared by history and the home total: same completed rides, dates and amounts.
export function reportDate(value:any){
 if(!value)return null;let text=String(value);
 if(/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(text)&&!/(Z|[+-]\d\d:\d\d)$/i.test(text))text+='Z';
 const date=new Date(text);return Number.isFinite(date.getTime())?date:null;
}
export function nonnegative(value:any){const n=Number(value);return Number.isFinite(n)?Math.max(0,n):0;}
export function optionalSeconds(value:any){return value==null||value===''?null:Math.floor(nonnegative(value));}
export function periodBounds(period:string,now=new Date()){
 const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=(type:string)=>p.find(x=>x.type===type)?.value||'';
 const day=`${part('year')}-${part('month')}-${part('day')}`;
 const anchor=new Date(day+'T12:00:00Z');
 if(period==='week')anchor.setUTCDate(anchor.getUTCDate()-(anchor.getUTCDay()+6)%7);
 if(period==='month')anchor.setUTCDate(1);
 return {day,from:new Date(anchor.toISOString().slice(0,10)+'T03:00:00Z'),to:now};
}
export function reportRide(order:any){
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
export function buildRideHistory(orders:any[],period:string,now=new Date()){
 const bounds=periodBounds(period,now),seen=new Set();
 const rows=orders.filter(o=>{if(o.status!=='completado'||seen.has(o.id))return false;seen.add(o.id);return true;}).map(reportRide).filter(o=>{const d=reportDate(o.completed_at);return d&&d>=bounds.from&&d<=bounds.to;}).sort((a,b)=>Date.parse(b.completed_at)-Date.parse(a.completed_at));
 const total=rows.reduce((s,o)=>s+o.importe_final,0),km=rows.reduce((s,o)=>s+o.metros_taximetro,0)/1000;
 return {success:true,period,day:bounds.day,orders:rows,total,km,summary:{total,count:rows.length,km,durationSeconds:rows.reduce((s,o)=>s+(o.ride_duration_seconds||0),0),billableWaitSeconds:rows.reduce((s,o)=>s+(o.segundos_espera_acumulados||0),0)}};
}
export async function loadCompletedRides(entity:any,driverId:string,from:Date){
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
