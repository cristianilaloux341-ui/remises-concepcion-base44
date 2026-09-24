import assert from 'node:assert/strict';

const ITERATIONS = 10000;

function enter(base, driver, state) {
  if (state.locked) return false;
  state.locked = true;
  try {
    const current = state.drivers.filter(d => d.base === base && d.id !== driver.id && d.pos > 0);
    const next = current.reduce((m,d)=>Math.max(m,d.pos),0)+1;
    if (driver.version !== state.versions.get(driver.id)) return false;
    driver.base=base; driver.pos=next; driver.marker=null;
    state.versions.set(driver.id, driver.version+1); driver.version++;
    return true;
  } finally { state.locked=false; }
}

function compact(base,state) {
  const q=state.drivers.filter(d=>d.base===base&&d.pos>0).sort((a,b)=>a.pos-b.pos||a.id.localeCompare(b.id));
  q.forEach((d,i)=>{ if(d.pos!==i+1){d.pos=i+1;d.marker=null;} });
}

let failures=0;
for(let n=0;n<ITERATIONS;n++){
  const drivers=Array.from({length:50},(_,i)=>({id:String(i+1).padStart(2,'0'),base:'2-Plaza',pos:i+1,version:0,marker:null}));
  const state={drivers,versions:new Map(drivers.map(d=>[d.id,0])),locked:false};
  const a=drivers[10], b=drivers[20];
  a.base=null;a.pos=null;b.base=null;b.pos=null;
  compact('2-Plaza',state);
  const order=Math.random()<.5?[a,b]:[b,a];
  for(const d of order) assert.equal(enter('2-Plaza',d,state),true);
  compact('2-Plaza',state);
  const q=drivers.filter(d=>d.base==='2-Plaza').sort((x,y)=>x.pos-y.pos);
  const positions=q.map(d=>d.pos);
  if(new Set(positions).size!==50 || positions.some((p,i)=>p!==i+1)) failures++;
}
console.log(JSON.stringify({scenario:'simultaneous-queue-entry',iterations:ITERATIONS,drivers:50,failed:failures,ok:failures===0},null,2));
if(failures) process.exit(1);
