import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const backend=read('js/backend.js'),merchant=read('js/merchant.js'),ci=read('.github/workflows/audit.yml');
new vm.Script(backend,{filename:'backend.js'});
const start=backend.indexOf('async function merchantRefreshAfterConfirmedMutation(');
const end=backend.indexOf('\n}',start);
assert.ok(start>0&&end>start,'acknowledgement gate not found');
const source=backend.slice(start,end+2);
const orderId='11111111-1111-4111-8111-111111111111';
const examples=[
 ['accept correct first stage','accept',{ok:true,status:'MERCHANT_ACCEPTED'},true],
 ['accept correct preparing stage','accept',{ok:true,status:'PREPARING'},true],
 ['accept cannot be cancelled','accept',{ok:true,status:'CANCELLED'},false],
 ['accept cannot be dispatched','accept',{accepted:true,status:'OUT_FOR_DELIVERY',ok:true},false],
 ['dispatch confirmed','dispatch',{ok:true,status:'OUT_FOR_DELIVERY'},true],
 ['dispatch cannot remain preparing','dispatch',{ok:true,status:'PREPARING'},false],
 ['dispatch cannot be done','dispatch',{ok:true,status:'DELIVERED'},false],
 ['arriving confirmed','arriving',{ok:true,status:'ARRIVING'},true],
 ['arriving cannot skip to delivered','arriving',{ok:true,status:'DELIVERED'},false],
 ['arriving cannot remain in transit','arriving',{ok:true,status:'OUT_FOR_DELIVERY'},false],
 ['complete delivered','complete-delivery',{ok:true,status:'DELIVERED'},true],
 ['complete settled','complete-delivery',{ok:true,status:'SETTLED'},true],
 ['complete cannot stay arriving','complete-delivery',{ok:true,status:'ARRIVING'},false],
 ['assign preserved preparing','assign-delivery',{ok:true,status:'PREPARING'},true],
 ['assign preserved risk','assign-delivery',{ok:true,status:'AT_RISK'},true],
 ['assign cannot dispatch','assign-delivery',{ok:true,status:'OUT_FOR_DELIVERY'},false],
 ['reject reassigning','reject',{ok:true,status:'REASSIGNING'},true],
 ['reject requote','reject',{ok:true,status:'REQUOTE_REQUIRED'},true],
 ['reject cancelled','reject',{ok:true,status:'CANCELLED'},true],
 ['reject reoffered','reject',{ok:true,status:'OFFERED_TO_MERCHANT'},true],
 ['reject cannot claim accepted','reject',{ok:true,status:'PREPARING'},false],
 ['cannot fulfill reassigning','cannot-fulfill',{ok:true,status:'REASSIGNING'},true],
 ['cannot fulfill cannot claim delivery','cannot-fulfill',{ok:true,status:'OUT_FOR_DELIVERY'},false],
 ['wrong case is not an enum','dispatch',{ok:true,status:'out_for_delivery'},false],
 ['null state is contradictory','accept',{ok:true,status:null},false],
 ['legacy no status stays supported','dispatch',{ok:true},true],
 ['legacy versioned snapshot correct','dispatch',{orderId,version:19,status:'OUT_FOR_DELIVERY'},true],
 ['legacy versioned wrong stage','dispatch',{orderId,version:19,status:'PREPARING'},false],
 ['rescue can reassign safely','dispatch',{autoRescued:true,dispatched:false,status:'REASSIGNING'},true],
 ['rescue cannot claim departure','dispatch',{autoRescued:true,dispatched:true,status:'OUT_FOR_DELIVERY'},false],
 ['a generic false outcome fails','dispatch',{ok:true,dispatched:false,status:'OUT_FOR_DELIVERY'},false],
 ['foreign order never confirms','accept',{ok:true,orderId:'22222222-2222-4222-8222-222222222222',status:'PREPARING'},false]
];
for(const [label,action,reply,expected] of examples){
  let reads=0;
  const runtime={status:'ready',merchant:{merchantId:'shop-A'},orders:[]};
  const ctx=vm.createContext({merchantRuntime:runtime,Number,Date,Array,
    merchantRefresh:async()=>{
      reads++;
      const data={merchant:{merchantId:'shop-A'},orders:[]};
      runtime.status='ready';runtime.orders=data.orders;runtime.merchant=data.merchant;
      return data;
    }});
  vm.runInContext(source+'\nthis.validate=merchantRefreshAfterConfirmedMutation;',ctx);
  const check=()=>ctx.validate(reply,{action,orderId});
  if(expected){
    assert.equal(await check(),true,label);
    assert.equal(reads,1,label+' verified follow-up read');
  }else{
    await assert.rejects(check,/servidor não confirmou esta ação/i,label);
    assert.equal(reads,0,label+' cannot assert success or trigger success reconciliation');
  }
}
assert.ok(!source.includes('merchantInvoke('),'acknowledgement gate stays read-only');
assert.ok(source.includes("Object.prototype.hasOwnProperty.call(reply,'status')"));
assert.ok(merchant.includes('merchantPostActionConfirmation('),'operator feedback preserved');
assert.ok(ci.includes('node tests/merchant-action-state-coherence-v1-361.mjs'));
console.log('TAMÃO V1.361 PASS — '+examples.length+' mutation states including contradictory approval, dispatch, arrival, delivery, assignment and rescues.');
