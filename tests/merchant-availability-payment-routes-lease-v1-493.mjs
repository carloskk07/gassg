import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/merchant-mutations.js');
const backend=read('js/backend.js');
const edge=read('supabase/functions/merchant-ops/index.ts');
const audit=read('.github/workflows/audit.yml');
new vm.Script(source,{filename:'js/merchant-mutations.js'});
const MID='11111111-1111-4111-8111-111111111111';
const USER='user-A';
const standardRoute=()=>({
 paymentMethod:'cash',provider:'manual',connectionId:null,
 channel:'delivery',verificationMode:'manual',
 active:true,priority:100,customerLabel:'Dinheiro',metadata:{}
});
function gate(){let resolve;return {promise:new Promise(r=>resolve=r),resolve};}
function fixture({postGate=null,readGate=null,postError=null,ackOverride=null,
 staleRead=false,wrongOnline=false,wrongRoutes=false,badVersion=false}={}){
 const calls=[],renders=[],records=[];
 const state={online:false,routes:[standardRoute()],version:3};
 const rt={session:{user:{id:USER}},merchant:{merchantId:MID,memberRole:'owner',online:false},
  selectedMerchantId:MID,accessEpoch:9,status:'ready',actionPending:false,error:null,
  paymentRouteVersion:state.version,paymentRoutes:[standardRoute()],lastSyncAt:null};
 let reads=0,enablements=0;
 const ctx=vm.createContext({
  merchantRuntime:rt,globalThis:null,Date,Number,String,Error,Boolean,Array,JSON,Object,Set,
  render:()=>renders.push({user:rt.session?.user?.id,pending:rt.actionPending}),
  liveIdempotency:kind=>'test-'+kind+'-1234567890123456',
  retryAmbiguousOnce:fn=>fn(),
  merchantEnablementAfterChange:()=>{enablements++},
  merchantInvoke:async (endpoint,payload,opts)=>{
   calls.push({endpoint,payload,opts});
   if(postGate)await postGate.promise;
   if(endpoint!=='merchant-ops')throw Error('Unexpected endpoint');
   const routes=payload.action==='update-payment-routes';
   let response;
   if(routes){
    state.routes=JSON.parse(JSON.stringify(payload.routes));state.version++;
    response={ok:true,merchantId:MID,version:state.version,fundsOwner:'merchant',
     tamaoReceivesSaleProceeds:false,routes:JSON.parse(JSON.stringify(state.routes))};
   }else{
    state.online=payload.online;
    response={ok:true,online:state.online,last_seen_at:new Date().toISOString()};
   }
   if(postError)throw postError;
   return ackOverride??response;
  },
  merchantRefresh:async ({silent})=>{
   assert.equal(silent,true);reads++;
   if(readGate)await readGate.promise;
   const merchant={merchantId:MID,memberRole:rt.merchant?.memberRole||'owner',
    online:wrongOnline?!state.online:state.online};
   const data={merchant,paymentRoutes:wrongRoutes?[{...standardRoute(),priority:999}]:
    JSON.parse(JSON.stringify(state.routes)),paymentRouteVersion:
    badVersion?state.version+1:state.version};
   records.push(data);
   if(!staleRead&&rt.session?.user?.id===USER){
    rt.merchant=merchant;rt.paymentRoutes=data.paymentRoutes;
    rt.paymentRouteVersion=data.paymentRouteVersion;
    rt.lastSyncAt=new Date().toISOString();
   }
   return data;
  }
 });
 ctx.globalThis=ctx;
 vm.runInContext(source,ctx);
 return {rt,ctx,calls,renders,records,state,
  online:value=>ctx.merchantOnlineMutateImpl(value),
  routes:list=>ctx.merchantPaymentRoutesMutateImpl(list,'Configuração confirmada pelo proprietário'),
  get reads(){return reads},get enablements(){return enablements},
  switchAccount({merchant=false}={}){
   rt.accessEpoch++;rt.session={user:{id:'user-B'}};
   if(merchant){rt.merchant={merchantId:'merchant-B',memberRole:'owner'};
    rt.selectedMerchantId='merchant-B'}
   rt.actionPending=true;
  }
 };
}
{
 const f=fixture();
 const result=await f.online(true);
 assert.equal(result.online,true);
 assert.equal(f.rt.merchant.online,true);
 assert.equal(f.reads,1);
 assert.equal(f.enablements,1);
 assert.equal(f.calls[0].payload.action,'set-online');
 assert.equal(f.rt.actionPending,false);
}
{
 const f=fixture();
 await f.online(false);
 assert.equal(f.rt.merchant.online,false);
 assert.equal(f.reads,1);
}
{
 const f=fixture({postError:Object.assign(Error('lost acknowledgement'),{code:'NETWORK_TIMEOUT'})});
 const result=await f.online(true);
 assert.equal(result.reconciledAfterNetworkError,true);
 assert.equal(f.rt.merchant.online,true,'only a fresh installed read can recover ambiguous response');
 assert.equal(f.calls.length,1,'no second post with a new idempotency key');
}
{
 const f=fixture({postError:Object.assign(Error('forbidden'),{status:403})});
 await assert.rejects(()=>f.online(true),/forbidden/);
 assert.equal(f.reads,0,'definitive authorization rejection is not repaired by unrelated online state');
 assert.equal(f.enablements,0);
}
{
 const f=fixture({wrongOnline:true});
 await assert.rejects(()=>f.online(true),/disponibilidade não foi confirmada/);
 assert.equal(f.enablements,0);
}
{
 const f=fixture({staleRead:true});
 await assert.rejects(()=>f.online(true),/disponibilidade não foi confirmada/);
 assert.equal(f.enablements,0);
}
{
 const f=fixture({ackOverride:{ok:true,online:false}});
 await assert.rejects(()=>f.online(true),/servidor não confirmou/);
 assert.equal(f.reads,0);
}
{
 const g=gate(),f=fixture({postGate:g});
 const pending=f.online(true);
 assert.equal(f.calls.length,1);
 await assert.rejects(()=>f.online(true),/Aguarde/);
 f.switchAccount({merchant:true});
 g.resolve();
 await assert.rejects(pending,/conta ou a revenda mudou/);
 assert.equal(f.reads,0);
 assert.equal(f.rt.actionPending,true,'old online action cannot release next merchant lock');
 assert.equal(f.enablements,0);
}
{
 const g=gate(),f=fixture({readGate:g});
 const pending=f.online(true);
 for(let n=0;n<25&&f.reads===0;n++)await Promise.resolve();
 assert.equal(f.reads,1);
 f.switchAccount();
 g.resolve();
 await assert.rejects(pending,/conta ou a revenda mudou/);
 assert.equal(f.rt.actionPending,true);
}
{
 const f=fixture();
 f.rt.merchant.memberRole='driver';
 await assert.rejects(()=>f.online(true),/Atualize seu acesso/);
 assert.equal(f.calls.length,0);
}
{
 const f=fixture();
 f.rt.merchant.memberRole='operator';
 const data=await f.online(true);
 assert.equal(data.online,true,'operator can toggle availability per server role');
}
{
 const f=fixture();
 const result=await f.routes([standardRoute()]);
 assert.equal(result.ok,true);
 assert.equal(result.version,4);
 assert.equal(f.rt.paymentRouteVersion,4);
 assert.equal(f.reads,1);
 assert.equal(f.enablements,1);
 assert.equal(f.calls[0].opts.idempotencyKey.startsWith('test-merchant-payment-routes'),true);
 assert.equal(f.rt.actionPending,false);
}
{
 const f=fixture({wrongRoutes:true});
 await assert.rejects(()=>f.routes([standardRoute()]),/formas de recebimento não foram confirmadas/);
 assert.equal(f.enablements,0);
}
{
 const f=fixture({badVersion:true});
 await assert.rejects(()=>f.routes([standardRoute()]),/formas de recebimento não foram confirmadas/);
 assert.equal(f.enablements,0);
}
{
 const f=fixture({staleRead:true});
 await assert.rejects(()=>f.routes([standardRoute()]),/formas de recebimento não foram confirmadas/);
 assert.equal(f.enablements,0);
}
{
 const f=fixture({ackOverride:{ok:true,merchantId:MID,version:4,
  fundsOwner:'tamao',tamaoReceivesSaleProceeds:true,routes:[standardRoute()]}});
 await assert.rejects(()=>f.routes([standardRoute()]),/servidor não comprovou/);
 assert.equal(f.reads,0,'wrong owner of funds never triggers success or route refresh');
}
{
 const f=fixture({ackOverride:{ok:true,merchantId:MID,version:4,
  fundsOwner:'merchant',tamaoReceivesSaleProceeds:false,
  routes:[{...standardRoute(),verificationMode:'automatic'}]}});
 await assert.rejects(()=>f.routes([standardRoute()]),/servidor não comprovou/);
}
{
 const g=gate(),f=fixture({postGate:g});
 const pending=f.routes([standardRoute()]);
 assert.equal(f.calls.length,1);
 f.switchAccount();
 g.resolve();
 await assert.rejects(pending,/conta ou a revenda mudou/);
 assert.equal(f.reads,0);
 assert.equal(f.rt.actionPending,true);
 assert.equal(f.enablements,0);
}
{
 const g=gate(),f=fixture({readGate:g});
 const pending=f.routes([standardRoute()]);
 for(let n=0;n<30&&f.reads<1;n++)await Promise.resolve();
 assert.equal(f.reads,1);
 f.switchAccount({merchant:true});
 g.resolve();
 await assert.rejects(pending,/conta ou a revenda mudou/);
 assert.equal(f.rt.actionPending,true);
}
{
 const f=fixture();
 f.rt.merchant.memberRole='operator';
 await assert.rejects(()=>f.routes([standardRoute()]),/proprietário ou gerente/);
 assert.equal(f.calls.length,0);
}
{
 const f=fixture();
 f.rt.paymentRouteVersion=null;
 await assert.rejects(()=>f.routes([standardRoute()]),/Atualize as formas de pagamento/);
 assert.equal(f.calls.length,0);
}
// The initial portal no longer carries heavy mutation logic; both operations
// are available only after an actor-scoped first-click lazy load.
assert.match(backend,/async function merchantSetOnlineLive\(online\)/);
assert.match(backend,/async function merchantUpdatePaymentRoutesLive\(/);
assert.match(backend,/merchantLoadMutations\(\)/);
assert.doesNotMatch(backend,/async function merchantOnlineMutateImpl\(/);
assert.doesNotMatch(backend,/async function merchantPaymentRoutesMutateImpl\(/);
assert.match(edge,/merchant_payment_routes_action/);
assert.match(edge,/merchant_delivery_payment_allowed/);
assert.match(audit,/node tests\/merchant-availability-payment-routes-lease-v1-493\.mjs/);
console.log('PASS: online and provider route readback, exact funds identity, account/merchant switch, stale ACK, permissions and no false success');
