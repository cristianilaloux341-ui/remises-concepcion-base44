import assert from 'node:assert/strict';

// Modelo determinista del contrato CANÓNICO actual.
// No toca producción: estresa invariantes de cola, capacidad y carreras.
const DRIVERS = 50;
const ORDERS = 100;
const WINDOW_MS = 30_000;

function makeDrivers(n=DRIVERS) {
  return Array.from({length:n},(_,i)=>({
    id:`D${String(i+1).padStart(2,'0')}`,
    queuePosition:i+1,
    inQueue:true,
    current:null,
    next:null,
    deliveryFailures:0
  }));
}
function eligible(d){ return d.inQueue && !d.current && !d.next; }
function reserveFirst(drivers, orderId){
  const d=drivers.filter(eligible).sort((a,b)=>a.queuePosition-b.queuePosition||a.id.localeCompare(b.id))[0];
  if(!d) return null;
  d.inQueue=false; d.current={orderId,attempt:1,presentedAt:null,expiresAt:null};
  return d;
}
function present(d, at){ d.current.presentedAt=at; d.current.expiresAt=at+WINDOW_MS; }
function timeout(d, at){
  assert(d.current?.presentedAt!=null,'timeout comercial sin ALERT_PRESENTED');
  assert(at>=d.current.expiresAt,'oferta retirada antes del expires_at');
  const oid=d.current.orderId; d.current=null; return oid;
}
function deliveryFail(d){
  assert.equal(d.current?.presentedAt,null,'DELIVERY_FAILED no debe reemplazar timeout comercial');
  const oid=d.current.orderId; d.current=null; d.deliveryFailures++; return oid;
}
function assignSecond(d, oid){
  if(!d.current || d.next) return false;
  d.next={orderId:oid,confirmed:true}; return true;
}
function promote(d){
  assert(!d.current); if(!d.next)return null;
  d.current={orderId:d.next.orderId,attempt:1,presentedAt:null,expiresAt:null};
  d.next=null; return d.current.orderId;
}

const results=[];
const test=(name,fn)=>{try{fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:e.message});}};

test('100 despachos: ningún móvil recibe dos ofertas simultáneas',()=>{
  const ds=makeDrivers();
  const assigned=[];
  for(let i=0;i<ORDERS;i++) assigned.push(reserveFirst(ds,`O${i+1}`)?.id||null);
  const real=assigned.filter(Boolean);
  assert.equal(real.length,DRIVERS);
  assert.equal(new Set(real).size,DRIVERS);
  assert.equal(assigned.filter(x=>x===null).length,ORDERS-DRIVERS);
});

test('orden autoritativo: gana siempre el primero de cola',()=>{
  const ds=makeDrivers(8);
  for(let i=0;i<8;i++) assert.equal(reserveFirst(ds,`O${i}`).id,`D${String(i+1).padStart(2,'0')}`);
});

test('30 s desde ALERT_PRESENTED: 29.999 s sigue siendo aceptable',()=>{
  const d=makeDrivers(1)[0]; reserveFirst([d],'O1'); present(d,1000);
  assert.equal(d.current.expiresAt,31000);
  assert(30999<d.current.expiresAt);
  assert.throws(()=>timeout(d,30999),/antes del expires_at/);
  assert.equal(timeout(d,31000),'O1');
});

test('demora de entrega no consume ventana comercial',()=>{
  const d=makeDrivers(1)[0]; reserveFirst([d],'O1');
  // 16 s técnicos antes de mostrar: la ventana recién nace acá.
  present(d,16000);
  assert.equal(d.current.expiresAt,46000);
});

test('DELIVERY_FAILED no castiga ni reordena al móvil',()=>{
  const d=makeDrivers(1)[0]; const pos=d.queuePosition;
  reserveFirst([d],'O1'); deliveryFail(d);
  assert.equal(d.queuePosition,pos);
  assert.equal(d.deliveryFailures,1);
});

test('capacidad total máxima 2 y tercero bloqueado',()=>{
  const d=makeDrivers(1)[0]; reserveFirst([d],'O1');
  assert.equal(assignSecond(d,'O2'),true);
  assert.equal(assignSecond(d,'O3'),false);
  assert.equal([d.current,d.next].filter(Boolean).length,2);
});

test('finalizar primero promueve segundo confirmado',()=>{
  const d=makeDrivers(1)[0]; reserveFirst([d],'O1'); assignSecond(d,'O2');
  d.current=null;
  assert.equal(promote(d),'O2');
  assert.equal(d.current.orderId,'O2');
  assert.equal(d.next,null);
});

test('requerido no aceptado queda Central-only, sin B automático',()=>{
  const ride={id:'R',requestedDriverOnly:true,requestedDriverId:'D01',state:'offered',processingAction:null};
  const rejectRequired=(r,driverId)=>{
    if(r.requestedDriverOnly&&r.requestedDriverId===driverId){
      r.state='pending';r.processingAction='CENTRAL_REVIEW_REQUIRED_DRIVER';return null;
    }
    return 'NEXT_DRIVER';
  };
  assert.equal(rejectRequired(ride,'D01'),null);
  assert.equal(ride.processingAction,'CENTRAL_REVIEW_REQUIRED_DRIVER');
});

test('100 despachos / 10 min: llegada sostenida no viola exclusividad',()=>{
  const ds=makeDrivers();
  const active=new Set();
  for(let i=0;i<100;i++){
    const t=i*6000; // 100 llegadas distribuidas en 10 min
    // liberar una capacidad simulando cierres, sin alterar orden de los demás
    if(i>=50){
      const d=ds[(i-50)%ds.length];
      if(d.current){active.delete(d.current.orderId);d.current=null;d.inQueue=true;d.queuePosition=1000+i;}
    }
    const d=reserveFirst(ds,`O${i}`);
    if(d){assert(!active.has(`O${i}`));active.add(`O${i}`); if(i%3===0)present(d,t);}
    for(const x of ds) assert([x.current,x.next].filter(Boolean).length<=2);
  }
});

const failed=results.filter(x=>!x.ok);
console.log(JSON.stringify({scenario:'canonical-dispatch-load',orders:ORDERS,drivers:DRIVERS,tests:results,failed:failed.length},null,2));
assert.equal(failed.length,0);
