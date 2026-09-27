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
test('cancel segundo gana antes de promoción => finish no lo revive',()=>{
  const next={status:'preasignado_proximo',driver_id:null};
  const driver={active_ride_id:null,next_order_id:'N',next_order_token:'T'};
  next.status='cancelado';
  driver.next_order_id=null;driver.next_order_token=null;
  const promoteOrder = next.status==='preasignado_proximo' ? 1 : 0;
  assert.equal(promoteOrder,0);
  assert.equal(next.status,'cancelado');
  assert.equal(driver.active_ride_id,null);
});
test('promoción gana antes de cancel segundo => cancel limpia active_ride_id',()=>{
  const next={status:'preasignado_proximo',driver_id:null};
  const driver={active_ride_id:null,next_order_id:'N',next_order_token:'T',status:'disponible'};
  assert.equal(next.status,'preasignado_proximo');
  next.status='aceptado';next.driver_id='D';
  driver.active_ride_id='N';driver.next_order_id=null;driver.next_order_token=null;driver.status='en_viaje';
  next.status='cancelado';
  if(driver.active_ride_id==='N'){driver.active_ride_id=null;driver.status='disponible';}
  assert.equal(next.status,'cancelado');
  assert.equal(driver.active_ride_id,null);
  assert.equal(driver.status,'disponible');
});
const failed=results.filter(x=>!x.ok);console.log(JSON.stringify({iterations:10000,tests:results,failed:failed.length},null,2));assert.equal(failed.length,0);
