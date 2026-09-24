import assert from 'node:assert/strict';
class Store{
 constructor(status='en_viaje'){this.o={id:'O',status,driver_id:'D'};}
 upd(filter,set){const o=this.o;if(o.id!==filter.id)return 0;
   if(filter.status && typeof filter.status==='object'){if(!filter.status.$in.includes(o.status))return 0;}
   else if(filter.status!==undefined && o.status!==filter.status)return 0;
   if(filter.driver_id!==undefined && o.driver_id!==filter.driver_id)return 0;
   Object.assign(o,set); return 1;
 }
}
const results=[]; const test=(name,fn)=>{try{fn();results.push({name,ok:true})}catch(e){results.push({name,ok:false,error:e.message})}};
function finish(s){return s.upd({id:'O',status:{$in:['aceptado','en_camino','en_viaje']},driver_id:'D'},{status:'completado',lastCompletedAction:'FINISH'});}
function cancel(s,snapshotStatus){return s.upd({id:'O',status:snapshotStatus},{status:'cancelado',processingAction:'CANCELLED_BY_CENTRAL'});}
for(let i=0;i<10000;i++){const s=new Store(); const snap=s.o.status; if(i%2===0){assert.equal(finish(s),1);assert.equal(cancel(s,snap),0);assert.equal(s.o.status,'completado')}else{assert.equal(cancel(s,snap),1);assert.equal(finish(s),0);assert.equal(s.o.status,'cancelado')}}
test('finish gana => cancel no pisa',()=>{const s=new Store();const snap=s.o.status;assert.equal(finish(s),1);assert.equal(cancel(s,snap),0);assert.equal(s.o.status,'completado')});
test('cancel gana => finish no pisa',()=>{const s=new Store();const snap=s.o.status;assert.equal(cancel(s,snap),1);assert.equal(finish(s),0);assert.equal(s.o.status,'cancelado')});
test('cancel duplicado no vuelve a transicionar',()=>{const s=new Store();const snap=s.o.status;assert.equal(cancel(s,snap),1);assert.equal(cancel(s,snap),0)});
const failed=results.filter(x=>!x.ok);console.log(JSON.stringify({iterations:10000,tests:results,failed:failed.length},null,2));assert.equal(failed.length,0);
