import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const backend=read('js/backend.js');
const merchant=read('js/merchant.js');
const ci=read('.github/workflows/audit.yml');
new vm.Script(backend,{filename:'backend.js'});
const cut=name=>{
  const at=backend.indexOf('async function '+name+'(');
  const end=backend.indexOf('\n}',at);
  assert.ok(at>=0&&end>at,'missing '+name);
  return backend.slice(at,end+2);
};
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const cases=[
  ['false dispatch despite ok',{ok:true,dispatched:false},'dispatch',false],
  ['false acceptance despite ok',{ok:true,accepted:false},'accept',false],
  ['false arrival despite ok',{success:true,arrived:false},'arriving',false],
  ['false completion despite ok',{ok:true,delivered:false},'complete-delivery',false],
  ['false team assignment despite ok',{ok:true,assigned:false},'assign-delivery',false],
  ['contradictory rescue positive',{autoRescued:true,dispatched:true},'dispatch',false],
  ['contradictory rescue acceptance',{autoRescued:true,accepted:true},'accept',false],
  ['rescue dispatch no departure',{autoRescued:true,dispatched:false,rescueReason:'merchant_unavailable_before_dispatch'},'dispatch',true],
  ['rescue accept no acceptance',{autoRescued:true,accepted:false,rescueReason:'offer_expired'},'accept',true],
  ['valid explicit dispatch',{ok:true,dispatched:true},'dispatch',true],
  ['valid acceptance',{ok:true,accepted:true},'accept',true],
  ['valid generic acknowledgement',{ok:true},'dispatch',true],
  ['legacy order acknowledgement',{orderId:id,version:11,status:'OUT_FOR_DELIVERY'},'dispatch',true],
  ['wrong order with ok',{ok:true,orderId:other},'dispatch',false],
  ['wrong order with legacy',{orderId:other,version:11,status:'OUT_FOR_DELIVERY'},'dispatch',false],
  ['invalid order id with ok',{ok:true,orderId:'not-uuid'},'dispatch',false],
  ['rejection may mark accepted false',{ok:true,accepted:false},'reject',true],
  ['ambiguous empty acknowledgement',{},'dispatch',false]
];
for(const [description,reply,action,accepted] of cases){
  const rt={status:'ready',orders:[],merchant:{merchantId:'M-1'}};
  let refreshes=0;
  const ctx=vm.createContext({merchantRuntime:rt,Number,Date,Array,
    merchantRefresh:async()=>{
      refreshes++;
      const snap={merchant:{merchantId:'M-1'},orders:[]};
      rt.status='ready';rt.merchant=snap.merchant;rt.orders=snap.orders;
      return snap;
    }});
  vm.runInContext(cut('merchantRefreshAfterConfirmedMutation')+'\nthis.check=merchantRefreshAfterConfirmedMutation;',ctx);
  const execute=()=>ctx.check(reply,{action,orderId:id});
  if(accepted){
    assert.equal(await execute(),true,description);
    assert.equal(refreshes,1,description);
  }else{
    await assert.rejects(execute,/O servidor não confirmou esta ação/i,description);
    assert.equal(refreshes,0,description+' must not be treated as post-mutation acknowledgement');
  }
}
assert.match(cut('merchantPerformAction'),/merchantRefreshAfterConfirmedMutation\(result,\{action,orderId\}\)/);
assert.match(cut('merchantAssignDeliveryLive'),/merchantRefreshAfterConfirmedMutation\(result,\{action:'assign-delivery',orderId\}\)/);
assert.match(cut('merchantCompleteDeliveryLive'),/merchantRefreshAfterConfirmedMutation\(result,\{action:'complete-delivery',orderId\}\)/);
assert.match(merchant,/if\(result\?\.autoRescued===true\)/,
  'server-authoritative automatic rescue remains a non-success UI outcome');
assert.ok(ci.includes('node tests/merchant-contradictory-outcome-v1-360.mjs'));
console.log('TAMÃO V1.360 PASS — '+cases.length+' replies checked: contradictions and foreign orders cannot confirm an action, auto-rescue remains explicit.');
