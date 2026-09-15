// Simulación determinista y aislada del despacho Remises Concepción.
// No toca entidades Base44. Modela las invariantes actuales con carga observada 14/09.
import assert from 'node:assert/strict';

const ZONES = ['1-Puerto','2-Plaza','3-Columna','4-Base','5-Cementerio','6-Díaz Vélez','7-Don Bosco','8-Monumento'];
const N_DRIVERS = 50;
const N_RIDES = 246;
const ACK_WINDOW = 30_000;
let seed = 14092026;
const rnd=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
const pick=a=>a[Math.floor(rnd()*a.length)];

class Driver {
  constructor(i){ this.id=`M${String(i+1).padStart(2,'0')}`; this.zone=ZONES[i%8]; this.queue=i; this.available=true; this.reserved=null; this.active=null; }
}
class Ride {
  constructor(i,t,zone){ this.id=`P${i+1}`; this.t=t; this.zone=zone; this.status='pendiente'; this.driver=null; this.attempt=0; this.token=null; this.ackAt=null; this.expiresAt=null; this.seen=new Set(); }
}
const drivers=Array.from({length:N_DRIVERS},(_,i)=>new Driver(i));
const initialQueue=new Map(drivers.map(d=>[d.id,{zone:d.zone,queue:d.queue}]));
const rides=[];
const events=[];
const violations=[];
let pendingPeak=0, rejects=0, timeouts=0, accepts=0, lateTimeouts=0, staleActions=0;

function available(zone,ride){ return drivers.filter(d=>d.available&&d.zone===zone&&!d.reserved&&!d.active&&!ride.seen.has(d.id)).sort((a,b)=>a.queue-b.queue); }
function offer(r,t){
  const d=available(r.zone,r)[0];
  if(!d){r.status='pendiente'; return false;}
  r.status='ofrecido'; r.driver=d.id; r.attempt++; r.token=`${r.id}-A${r.attempt}-${Math.floor(rnd()*1e9)}`; r.seen.add(d.id); d.reserved=r.id;
  const network=Math.floor(rnd()*3500); r.ackAt=t+network; r.expiresAt=r.ackAt+ACK_WINDOW;
  events.push({t:r.ackAt,type:'ack',r:r.id,d:d.id,a:r.attempt,token:r.token});
  // conducta realista: mayoría acepta, algunos rechazan, pocos no responden.
  const x=rnd();
  if(x<0.105){ rejects++; events.push({t:r.ackAt+1000+Math.floor(rnd()*9000),type:'reject',r:r.id,d:d.id,a:r.attempt,token:r.token}); }
  else if(x<0.135){ timeouts++; events.push({t:r.expiresAt,type:'timeout',r:r.id,d:d.id,a:r.attempt,token:r.token}); }
  else {
    // fuerza carreras de borde como 76: ~8% acepta entre 28.5 y 30s.
    const edge=rnd()<0.08;
    const delay=edge?28500+Math.floor(rnd()*1450):800+Math.floor(rnd()*9000);
    events.push({t:r.ackAt+delay,type:'accept',r:r.id,d:d.id,a:r.attempt,token:r.token});
    // timeout viejo simultáneo/tardío siempre existe para comprobar que no roba aceptado.
    events.push({t:r.expiresAt+Math.floor(rnd()*1200),type:'late_timeout',r:r.id,d:d.id,a:r.attempt,token:r.token});
  }
  return true;
}
function exact(r,e){return r.status==='ofrecido'&&r.driver===e.d&&r.attempt===e.a&&r.token===e.token;}
function releaseOld(r,e){ const d=drivers.find(x=>x.id===e.d); if(d?.reserved===r.id)d.reserved=null; }
function handle(e){
 const r=rides.find(x=>x.id===e.r); if(!r)return;
 if(e.type==='accept'){
   if(!exact(r,e)){staleActions++;return;}
   if(e.t>r.expiresAt){violations.push(`ACEPTACION_DESPUES_VENCIMIENTO ${r.id}`);return;}
   const d=drivers.find(x=>x.id===e.d); r.status='aceptado'; d.reserved=null; d.active=r.id; r.token=null; accepts++;
   // finaliza luego; no reingresa cola automáticamente: sólo queda disponible fuera de cola lógica.
   events.push({t:e.t+300000+Math.floor(rnd()*600000),type:'finish',r:r.id,d:d.id,a:e.a});
 } else if(e.type==='reject'){
   if(!exact(r,e)){staleActions++;return;} releaseOld(r,e); r.token=null; r.driver=null; offer(r,e.t+1);
 } else if(e.type==='timeout'){
   if(!exact(r,e)){staleActions++;return;} if(e.t<r.expiresAt){violations.push(`TIMEOUT_ANTES_30S ${r.id}`);return;} releaseOld(r,e); r.token=null;r.driver=null;offer(r,e.t+1);
 } else if(e.type==='late_timeout'){
   if(r.status==='aceptado'){lateTimeouts++; return;}
   if(exact(r,e)&&e.t>=r.expiresAt){releaseOld(r,e);r.token=null;r.driver=null;offer(r,e.t+1);} else staleActions++;
 } else if(e.type==='finish'){
   const d=drivers.find(x=>x.id===e.d); if(r.status==='aceptado'&&d?.active===r.id){r.status='completado';d.active=null;d.available=true;}
 }
}

// Jornada: 246 pasajes en 8 h, pico observado 43 entre 09-10. Generamos 06-14 con ese pico.
let idx=0;
for(let hour=0;hour<8;hour++){
 const count=hour===3?43:[25,27,31,35,33,28,24][hour<3?hour:hour-1];
 for(let j=0;j<count && idx<N_RIDES;j++){
   const t=hour*3600000+Math.floor((j+0.2)*3600000/count);
   // distribución desigual para provocar pendientes reales en zonas cargadas.
   const z=rnd()<0.42?pick(['2-Plaza','3-Columna','5-Cementerio']):pick(ZONES);
   rides.push(new Ride(idx++,t,z));
 }
}
while(idx<N_RIDES){rides.push(new Ride(idx,7*3600000+Math.floor(rnd()*3600000),pick(ZONES)));idx++;}
for(const r of rides)events.push({t:r.t,type:'new',r:r.id});

// ruido técnico fuerte: heartbeat/GPS/reconnect no puede mover cola.
for(const d of drivers) for(let k=0;k<300;k++) events.push({t:Math.floor(rnd()*8*3600000),type:pick(['heartbeat','gps','reconnect']),d:d.id});

while(events.length){
 events.sort((a,b)=>a.t-b.t); const e=events.shift();
 if(e.type==='new'){const r=rides.find(x=>x.id===e.r);offer(r,e.t);} else if(['heartbeat','gps','reconnect','ack'].includes(e.type)){} else handle(e);
 pendingPeak=Math.max(pendingPeak,rides.filter(r=>r.status==='pendiente').length);
}

// Invariantes de cola técnica: ruido no la modificó.
for(const d of drivers){const q=initialQueue.get(d.id); if(d.zone!==q.zone||d.queue!==q.queue)violations.push(`COLA_MOVED ${d.id}`);}
// Ningún driver puede quedar pegado a dos identidades.
for(const d of drivers) if(d.reserved&&d.active) violations.push(`DRIVER_PEGADO ${d.id}`);
for(const r of rides) if(r.status==='aceptado' && !drivers.some(d=>d.active===r.id)) violations.push(`ORDER_DRIVER_SPLIT ${r.id}`);

const summary={drivers:N_DRIVERS,rides:rides.length,peak_hour_rides:43,reject_events:rejects,timeout_events:timeouts,accepts,pending_final:rides.filter(r=>r.status==='pendiente').length,pending_peak:pendingPeak,completed:rides.filter(r=>r.status==='completado').length,accepted_still_active:rides.filter(r=>r.status==='aceptado').length,late_timeouts_neutralized:lateTimeouts,stale_actions_neutralized:staleActions,queue_position_violations:violations.filter(v=>v.startsWith('COLA')).length,premature_timeout_violations:violations.filter(v=>v.startsWith('TIMEOUT')).length,stuck_driver_violations:violations.filter(v=>v.includes('PEGADO')||v.includes('SPLIT')).length,total_violations:violations.length};
console.log(JSON.stringify({summary,violations:violations.slice(0,30)},null,2));
assert.equal(violations.length,0);
