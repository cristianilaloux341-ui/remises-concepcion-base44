// PRUEBA ADVERSARIAL: intenta romper invariantes del despacho sin tocar producción.
// Modela carreras observadas: timeout/accept simultáneos, reject duplicado, acciones viejas,
// doble PC, pendientes, heartbeat/GPS/reconnect y ráfagas mayores a la jornada real.
import assert from 'node:assert/strict';
const Z=['1-Puerto','2-Plaza','3-Columna','4-Base','5-Cementerio','6-Díaz Vélez','7-Don Bosco','8-Monumento'];
const DR=50, RIDES=420, WINDOW=30000;
let seed=0xBADF00D; const rnd=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296); const pick=a=>a[Math.floor(rnd()*a.length)];
const drivers=Array.from({length:DR},(_,i)=>({id:`M${i+1}`,zone:Z[i%8],q:i,available:true,res:null,active:null}));
const q0=JSON.stringify(drivers.map(d=>[d.id,d.zone,d.q]));
const rides=[]; const ev=[]; const V=[]; const metrics={offers:0,rejects:0,timeouts:0,accepts:0,staleBlocked:0,lateTimeoutBlocked:0,duplicateRejectBlocked:0,doublePcRaces:0,pendingEvents:0,maxPending:0};
const byRide=id=>rides.find(r=>r.id===id); const byD=id=>drivers.find(d=>d.id===id);
function cand(r){return drivers.filter(d=>d.available&&!d.res&&!d.active&&d.zone===r.zone&&!r.seen.has(d.id)).sort((a,b)=>a.q-b.q)[0];}
function offer(r,t){const d=cand(r);if(!d){r.status='pendiente';metrics.pendingEvents++;return false;}metrics.offers++;r.status='ofrecido';r.d=d.id;r.at++;r.tok=`${r.id}:${r.at}:${Math.floor(rnd()*1e8)}`;r.seen.add(d.id);d.res=r.id;r.ack=t+Math.floor(rnd()*5000);r.exp=r.ack+WINDOW;const snap={r:r.id,d:d.id,at:r.at,tok:r.tok};ev.push({t:r.ack,type:'ack',...snap});
 // Patrones deliberadamente hostiles
 const mode=Math.floor(rnd()*10);
 if(mode===0){ // aceptación 1 ms antes + timeout exactamente al límite
   ev.push({t:r.exp-1,type:'accept',...snap});ev.push({t:r.exp,type:'timeout',...snap});
 } else if(mode===1){ // aceptación y timeout mismo milisegundo: serializamos accept primero como ganador CAS
   ev.push({t:r.exp,type:'accept',priority:0,...snap});ev.push({t:r.exp,type:'timeout',priority:1,...snap});
 } else if(mode===2){ // rechazo + timeout + rechazo duplicado
   ev.push({t:r.ack+5000,type:'reject',...snap});ev.push({t:r.ack+5001,type:'reject_dup',...snap});ev.push({t:r.exp,type:'timeout',...snap});
 } else if(mode===3){ // no responde
   ev.push({t:r.exp,type:'timeout',...snap});
 } else if(mode===4){ // intento ilegal de reasignar a los 12s
   ev.push({t:r.ack+12000,type:'illegal_reassign',...snap});ev.push({t:r.ack+18000,type:'accept',...snap});
 } else if(mode===5){ // acción vieja llega después de nueva oferta
   ev.push({t:r.ack+3000,type:'reject',...snap});ev.push({t:r.ack+9000,type:'stale_accept',...snap});
 } else {ev.push({t:r.ack+500+Math.floor(rnd()*12000),type:'accept',...snap});ev.push({t:r.exp+Math.floor(rnd()*5000),type:'timeout',...snap});}
 return true;}
function exact(r,e){return r.status==='ofrecido'&&r.d===e.d&&r.at===e.at&&r.tok===e.tok;}
function release(r,e){const d=byD(e.d);if(d?.res===r.id)d.res=null;}
function h(e){const r=byRide(e.r);if(!r)return;if(e.type==='accept'||e.type==='stale_accept'){if(!exact(r,e)){metrics.staleBlocked++;return;}if(e.t>r.exp){V.push(`late accept won ${r.id}`);return;}const d=byD(e.d);r.status='aceptado';r.tok=null;d.res=null;d.active=r.id;metrics.accepts++;ev.push({t:e.t+120000+Math.floor(rnd()*300000),type:'finish',r:r.id,d:d.id});return;}
 if(e.type==='reject'||e.type==='reject_dup'){if(!exact(r,e)){if(e.type==='reject_dup')metrics.duplicateRejectBlocked++;else metrics.staleBlocked++;return;}metrics.rejects++;release(r,e);r.d=null;r.tok=null;offer(r,e.t+1);return;}
 if(e.type==='illegal_reassign'){if(exact(r,e)&&e.t<r.exp){metrics.staleBlocked++;return;}V.push(`premature reassign succeeded ${r.id}`);return;}
 if(e.type==='timeout'){if(!exact(r,e)){if(r.status==='aceptado')metrics.lateTimeoutBlocked++;else metrics.staleBlocked++;return;}if(e.t<r.exp){V.push(`premature timeout ${r.id}`);return;}metrics.timeouts++;release(r,e);r.d=null;r.tok=null;offer(r,e.t+1);return;}
 if(e.type==='finish'){const d=byD(e.d);if(r.status==='aceptado'&&d?.active===r.id){r.status='completado';d.active=null;d.available=true;}return;}}
// 420 viajes concentrados en 4h, dos PC generan pares casi simultáneos y ráfagas de 8-14.
for(let i=0;i<RIDES;i++){let t=Math.floor(i/2)*18000+(i%2)*3;if(i%40<12)t=Math.floor(i/40)*360000+((i%40)%12)*350;const zone=rnd()<.55?pick(['2-Plaza','3-Columna','5-Cementerio']):pick(Z);const r={id:`P${i+1}`,zone,status:'pendiente',d:null,at:0,tok:null,ack:null,exp:null,seen:new Set()};rides.push(r);ev.push({t,type:'new',r:r.id,pc:i%2});if(i%2===1)metrics.doublePcRaces++;}
// 50 móviles x 1000 eventos técnicos = 50.000 golpes que NO pueden mover cola.
for(const d of drivers)for(let k=0;k<1000;k++)ev.push({t:Math.floor(rnd()*4*3600000),type:pick(['gps','heartbeat','reconnect']),d:d.id});
let guard=0;while(ev.length&&guard++<200000){ev.sort((a,b)=>(a.t-b.t)||((a.priority??0)-(b.priority??0)));const e=ev.shift();if(e.type==='new'){offer(byRide(e.r),e.t);}else if(!['gps','heartbeat','reconnect','ack'].includes(e.type))h(e);metrics.maxPending=Math.max(metrics.maxPending,rides.filter(r=>r.status==='pendiente').length);}
if(JSON.stringify(drivers.map(d=>[d.id,d.zone,d.q]))!==q0)V.push('queue changed by technical traffic');
for(const d of drivers){if(d.res&&d.active)V.push(`driver split ${d.id}`);if(d.res&&!rides.some(r=>r.id===d.res&&r.status==='ofrecido'&&r.d===d.id))V.push(`orphan reservation ${d.id}`);if(d.active&&!rides.some(r=>r.id===d.active&&r.status==='aceptado'))V.push(`orphan active ${d.id}`);}
for(const r of rides){if(r.status==='ofrecido'&&!byD(r.d)?.res)V.push(`offered without owner ${r.id}`);if(r.status==='aceptado'&&!drivers.some(d=>d.active===r.id))V.push(`accepted without driver ${r.id}`);}
metrics.completed=rides.filter(r=>r.status==='completado').length;metrics.pendingFinal=rides.filter(r=>r.status==='pendiente').length;metrics.offeredFinal=rides.filter(r=>r.status==='ofrecido').length;metrics.totalViolations=V.length;
console.log(JSON.stringify({scenario:{drivers:DR,rides:RIDES,technicalEvents:50000,windowMs:WINDOW},metrics,violations:V.slice(0,50)},null,2));assert.equal(V.length,0);
