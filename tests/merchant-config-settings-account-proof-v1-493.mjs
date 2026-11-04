import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/merchant-mutations.js');
const backend=read('js/backend.js');
const sql=read('supabase/migrations/20261006101500_merchant_config_concurrency_v1_70_24.sql');
const audit=read('.github/workflows/audit.yml');
new vm.Script(source,{filename:'merchant-mutations.js'});
const ID='11111111-1111-4111-8111-111111111111';
const INITIAL='2026-11-02T15:03:00.000Z';
const actions=[
 ['update-logistics',{deliveryFeeCents:699,baseEtaMinutes:45,acceptsCitywide:true}],
 ['update-capacity',{maxActiveOrders:12}],
 ['update-scheduling',{acceptsScheduledOrders:true}],
 ['update-payment-methods',{pix:true,card:false,cash:true}]
];
const ticket=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
function fixture({ackGate=null,readGate=null,failPost=null,wrongReply=false,
  wrongRead=false,staleRead=false,missingVersion=false,role='owner'}={}){
 const calls=[],renders=[];
 const server={merchantId:ID,memberRole:role,status:'active',online:true,
  configUpdatedAt:INITIAL,deliveryFeeCents:599,baseEtaMinutes:30,
  deliveryFeeConfirmedAt:INITIAL,acceptsCitywide:true,maxActiveOrders:8,
  acceptsScheduledOrders:false,paymentMethods:{pix:false,card:false,cash:true}};
 const rt={status:'ready',session:{user:{id:'operator-A'}},selectedMerchantId:ID,
  merchant:{...server,configUpdatedAt:missingVersion?'':INITIAL},
  accessEpoch:7,actionPending:false,lastSyncAt:INITIAL,error:null};
 let reads=0,enablements=0,sequence=0;
 const ctx=vm.createContext({
  merchantRuntime:rt,globalThis:null,Date,Number,String,Object,
  render:()=>renders.push({pending:rt.actionPending,user:rt.session?.user?.id}),
  liveIdempotency:scope=>'config-test:'+scope+':unique-123456789',
  retryAmbiguousOnce:fn=>fn(),
  merchantEnablementAfterChange:()=>{enablements++},
  merchantInvoke:async (_functionName,body,opts)=>{
   calls.push({body,opts});
   if(ackGate)await ackGate.promise;
   if(failPost)throw failPost;
   assert.equal(body.action.startsWith('update-'),true);
   assert.equal(body.merchantId,ID);
   assert.equal(body.expectedUpdatedAt,server.configUpdatedAt);
   sequence++;
   server.configUpdatedAt=new Date(Date.now()+1000*sequence).toISOString();
   if(body.action==='update-logistics'){
    server.deliveryFeeCents=body.deliveryFeeCents;server.baseEtaMinutes=body.baseEtaMinutes;
    server.acceptsCitywide=body.acceptsCitywide;
    server.deliveryFeeConfirmedAt=server.configUpdatedAt;
    if(!body.acceptsCitywide)server.online=false;
   }else if(body.action==='update-capacity')server.maxActiveOrders=body.maxActiveOrders;
   else if(body.action==='update-scheduling')server.acceptsScheduledOrders=body.acceptsScheduledOrders;
   else if(body.action==='update-payment-methods')
    server.paymentMethods={pix:body.pix,card:body.card,cash:body.cash};
   const fields=body.action==='update-logistics'
    ?{deliveryFeeCents:server.deliveryFeeCents,baseEtaMinutes:server.baseEtaMinutes,
      acceptsCitywide:server.acceptsCitywide,deliveryFeeConfirmedAt:server.deliveryFeeConfirmedAt,
      online:server.online}
    :body.action==='update-capacity'?{maxActiveOrders:server.maxActiveOrders}
    :body.action==='update-scheduling'?{acceptsScheduledOrders:server.acceptsScheduledOrders}
    :{paymentMethods:{...server.paymentMethods}};
   const reply={ok:true,action:body.action,configUpdatedAt:server.configUpdatedAt,...fields};
   if(wrongReply){
    if(body.action==='update-logistics')reply.deliveryFeeCents+=99;
    if(body.action==='update-capacity')reply.maxActiveOrders+=1;
    if(body.action==='update-scheduling')reply.acceptsScheduledOrders=!reply.acceptsScheduledOrders;
    if(body.action==='update-payment-methods')reply.paymentMethods.cash=!reply.paymentMethods.cash;
   }
   return reply;
  },
  merchantRefresh:async ({silent})=>{
   assert.equal(silent,true);reads++;
   if(readGate)await readGate.promise;
   const m={...server,paymentMethods:{...server.paymentMethods}};
   if(wrongRead){
    m.maxActiveOrders+=1;m.deliveryFeeCents+=1;
    m.acceptsScheduledOrders=!m.acceptsScheduledOrders;
    m.paymentMethods.pix=!m.paymentMethods.pix;
   }
   const data={merchant:m};
   if(!staleRead&&rt.session?.user?.id==='operator-A'){
    rt.merchant=data.merchant;
    rt.lastSyncAt=new Date().toISOString();
   }
   return data;
  }
 });
 ctx.globalThis=ctx;
 vm.runInContext(source,ctx);
 return {
  rt,calls,renders,ctx,server,
  config:(action,payload)=>ctx.merchantConfigSettingsMutateImpl(action,payload),
  get reads(){return reads},get enablements(){return enablements},
  changeUser({merchant=false}={}){
   rt.accessEpoch++;rt.session={user:{id:'operator-B'}};
   if(merchant){rt.merchant={merchantId:'another-merchant',memberRole:'owner'};
     rt.selectedMerchantId='another-merchant';}
   rt.actionPending=true;
  }
 };
}

for(const [action,payload] of actions){
 const f=fixture();
 const response=await f.config(action,payload);
 assert.equal(response.ok,true,action);
 assert.equal(response.action,action);
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].opts.idempotencyKey.includes('merchant-config'),true);
 assert.equal(f.reads,1,'real readback required '+action);
 assert.equal(f.rt.actionPending,false,'release original lock '+action);
 assert.equal(f.enablements,['update-logistics','update-payment-methods'].includes(action)?1:0);
}

{
 const f=fixture();
 const result=await f.config('update-logistics',{deliveryFeeCents:0,baseEtaMinutes:15,
   acceptsCitywide:false});
 assert.equal(result.online,false,'turning off coverage always pauses new sales');
 assert.equal(f.rt.merchant.online,false);
 assert.equal(f.rt.merchant.deliveryFeeCents,0);
}
for(const [action,payload] of actions){
 const f=fixture({wrongReply:true});
 await assert.rejects(()=>f.config(action,payload),/servidor não confirmou/i,action);
 assert.equal(f.reads,0,'unverified ACK must not be treated as success '+action);
 assert.equal(f.enablements,0);
 assert.equal(f.rt.actionPending,false);
 const bad=fixture({wrongRead:true});
 await assert.rejects(()=>bad.config(action,payload),/não foi comprovada/i,action);
 assert.equal(bad.enablements,0);
 const stale=fixture({staleRead:true});
 await assert.rejects(()=>stale.config(action,payload),/não foi comprovada/i,action);
 assert.equal(stale.enablements,0);
}
{
 const f=fixture({missingVersion:true});
 await f.config('update-capacity',{maxActiveOrders:4});
 assert.equal(f.reads,2,'missing optimistic version triggers authenticated refresh before POST');
 assert.equal(f.calls.length,1);
}
{
 const denied=fixture({role:'operator'});
 await assert.rejects(()=>denied.config('update-capacity',{maxActiveOrders:6}),
  /proprietário ou gerente/);
 assert.equal(denied.calls.length,0);
}
{
 const f=fixture();
 await assert.rejects(()=>f.config('update-capacity',{maxActiveOrders:0}),/Capacidade/);
 await assert.rejects(()=>f.config('update-logistics',{
  deliveryFeeCents:100001,baseEtaMinutes:50,acceptsCitywide:true}),/taxa, prazo/);
 await assert.rejects(()=>f.config('update-payment-methods',{
  pix:false,card:false,cash:false}),/Ative pelo menos uma/);
 assert.equal(f.calls.length,0);
 assert.equal(f.rt.actionPending,false);
}
{
 const gate=ticket(),f=fixture({ackGate:gate});
 const pending=f.config('update-capacity',{maxActiveOrders:10});
 assert.equal(f.calls.length,1);
 await assert.rejects(()=>f.config('update-capacity',{maxActiveOrders:11}),/Aguarde/);
 f.changeUser();
 gate.resolve();
 await assert.rejects(pending,/conta ou a revenda mudou/);
 assert.equal(f.reads,0,'late account-A ACK cannot update account-B screen');
 assert.equal(f.rt.actionPending,true,'account-A finally must not release account-B lock');
}
{
 const gate=ticket(),f=fixture({readGate:gate});
 const pending=f.config('update-scheduling',{acceptsScheduledOrders:true});
 for(let i=0;i<40&&f.reads===0;i++)await Promise.resolve();
 assert.equal(f.reads,1);
 f.changeUser({merchant:true});
 gate.resolve();
 await assert.rejects(pending,/conta ou a revenda mudou/);
 assert.equal(f.rt.actionPending,true);
 assert.equal(f.enablements,0);
}
{
 const conflict=Object.assign(Error('another tab updated merchant'),{code:'CONFIG_VERSION_CONFLICT',status:409});
 const f=fixture({failPost:conflict});
 await assert.rejects(()=>f.config('update-capacity',{maxActiveOrders:6}),/another tab/);
 assert.equal(f.reads,1,'conflict loads current truth before new attempt');
 assert.equal(f.rt.actionPending,false);
 assert.equal(f.enablements,0);
}
{
 const block=ticket(),f=fixture({ackGate:block});
 const pending=f.config('update-logistics',{deliveryFeeCents:200,baseEtaMinutes:20,
  acceptsCitywide:true});
 f.changeUser({merchant:true});
 block.resolve();
 await assert.rejects(pending,/conta ou a revenda mudou/);
 assert.equal(f.rt.merchant.merchantId,'another-merchant');
}
// Real backend still offers the canonical business-profile workflow separately;
// the four operational mutations are deferred, leaving the first paint lean.
for(const method of ['merchantUpdateLogisticsLive','merchantUpdateCapacityLive',
  'merchantUpdateSchedulingLive','merchantUpdatePaymentMethodsLive'])
 assert.match(backend,new RegExp('async function '+method+'\\('));
assert.match(read('js/merchant.js'),/merchantConfigMutation\('update-business-details'/);
assert.match(source,/async function merchantConfigSettingsMutateImpl\(/);
assert.match(sql,/merchant_config_action/);
assert.match(audit,/merchant-config-settings-account-proof-v1-493\.mjs/);
console.log('PASS: operational config readback, ACK, conflict refresh, role/merchant switch, concurrency and unavailable version');
