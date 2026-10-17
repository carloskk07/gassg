import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const backend=read('js/backend.js');
const merchant=read('js/merchant.js');
const sql=read('supabase/migrations/20261012042134_merchant_basket_compliance_v1_158_2.sql');
const css=read('css/components.css');
const audit=read('.github/workflows/audit.yml');
new vm.Script(backend,{filename:'backend.js'});
new vm.Script(merchant,{filename:'merchant.js'});
const cut=(s,name,async=false)=>{
  const start=s.indexOf((async?'async ':'')+'function '+name+'(');
  const end=s.indexOf('\n}',start);
  assert.ok(start>=0&&end>start,name+' missing');
  return s.slice(start,end+2);
};
const orderId='11111111-1111-4111-8111-111111111111';
const initial={orderId,version:10,status:'PREPARING'};
const tested=[];
for(const [description,reply,accepted] of [
  ['null',null,false],['false',false,false],['zero',0,false],
  ['empty string','',false],['nonempty string','OK',false],
  ['empty list',[],false],['empty object',{},false],
  ['ok null',{ok:null},false],['ok string',{ok:'true'},false],
  ['negative',{ok:false},false],['error',{error:'DENIED'},false],
  ['negative with positive',{ok:true,success:false},false],
  ['explicit acknowledgement',{ok:true},true],
  ['alternate affirmative',{success:true},true],
  ['legacy versioned order',{orderId,version:11,status:'OUT_FOR_DELIVERY'},true],
  ['version missing',{orderId,status:'OUT_FOR_DELIVERY'},false],
  ['legacy invalid id',{orderId:'injected',version:11,status:'PREPARING'},false],
  ['legacy invalid version',{orderId,version:'11',status:'PREPARING'},false],
  ['automatic rescue',{autoRescued:true,rescueReason:'merchant_unavailable_before_dispatch'},true]
]){
  let refreshes=0;
  const rt={status:'ready',orders:[initial],merchant:{merchantId:'merchant-1'},actionPending:false};
  const ctx=vm.createContext({merchantRuntime:rt,Array,Number,render:()=>{},
    merchantRefresh:async()=>{
      refreshes++;
      const data={merchant:{merchantId:'merchant-1'},orders:[]};
      rt.orders=data.orders;rt.merchant=data.merchant;rt.status='ready';
      return data;
    }});
  vm.runInContext(cut(backend,'merchantRefreshAfterConfirmedMutation',true)+
    '\nthis.check=merchantRefreshAfterConfirmedMutation;',ctx);
  if(accepted){
    assert.equal(await ctx.check(reply),true,description);
    assert.equal(refreshes,1,description);
  }else{
    await assert.rejects(()=>ctx.check(reply),/servidor não confirmou/i,description);
    assert.equal(refreshes,0,'not even a post-mutation refresh claimed on '+description);
  }
  tested.push(description);
}
const notices=[],calls=[];
let reply={autoRescued:true,rescueReason:'delivery_capability_changed_before_dispatch',dispatched:false};
const merchantRuntime={status:'ready',actionPending:false};
const ui=vm.createContext({
 globalThis:{merchantRuntime},
 merchantPerformAction:async(id,action)=>{calls.push(action);return reply;},
 merchantPostActionConfirmation:msg=>{notices.push(String(msg));return true},
 toast:msg=>notices.push('error:'+String(msg))
});
vm.runInContext(cut(merchant,'merchantLiveAction',true)+'\nthis.act=merchantLiveAction;',ui);
await ui.act(orderId,'dispatch');
assert.deepEqual(calls,['dispatch']);
assert.match(notices.pop(),/saída não foi confirmada/i);
assert.doesNotMatch(notices.join(' '),/Saída confirmada/);
reply={autoRescued:true,rescueReason:'offer_expired'};
await ui.act(orderId,'accept');
assert.match(notices.pop(),/prazo expirou/i);
reply={autoRescued:true,rescueReason:'merchant_unavailable_before_dispatch'};
await ui.act(orderId,'arriving');
assert.match(notices.pop(),/ação não foi confirmada/i);
reply={ok:true};
await ui.act(orderId,'dispatch');
assert.equal(notices.pop(),'Saída confirmada');
assert.ok(!cut(merchant,'merchantLiveAction',true).includes('merchantInvoke('),
  'UI never performs extra business requests to interpret the response');
assert.ok(sql.includes("'autoRescued',true")&&sql.includes("'dispatched',false"),
  'guard a real server-authoritative rescue response, not an invented case');
assert.match(backend,/const affirmative=structured/);
assert.match(merchant,/if\(result\?\.autoRescued===true\)/);
assert.ok(audit.includes('node tests/merchant-outcome-proof-v1-359.mjs'));
console.log('TAMÃO V1.359 PASS — '+tested.length+' response shapes, dispatch auto-rescue, positive acknowledgements and no false departure.');
