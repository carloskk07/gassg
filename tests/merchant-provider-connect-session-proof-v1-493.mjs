import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('js/merchant-mutations.js'),backend=read('js/backend.js');
const edge=read('supabase/functions/merchant-payment-connect/index.ts');
const merchant=read('js/merchant.js'),audit=read('.github/workflows/audit.yml');
new vm.Script(src,{filename:'merchant-mutations.js'});
const ID='11111111-1111-4111-8111-111111111111';
const state='a'.repeat(40),client='test-client-ABC12345';
const gate=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
function fixture({actionStatus='active',postGate=null,readGate=null,
  postError=null,ackOverride=null,wrongRead=false,staleRead=false,
  accountAbsent=false,provider='mercadopago',role='owner'}={}){
 const rt={session:{user:{id:'user-A'}},merchant:{merchantId:ID,memberRole:role},
  selectedMerchantId:ID,status:'ready',accessEpoch:11,actionPending:false,
  error:null,lastSyncAt:'2026-01-01T00:00:00.000Z',
  receivingAccounts:accountAbsent?[]:[{
   provider,status:actionStatus,connected:actionStatus==='active',
   providerAccountId:'provider-account-A',fundsOwner:'merchant',tamaoReceivesSaleProceeds:false
  }]};
 const calls=[],location={href:'https://parceiro.tamao.com.br/'};
 let reads=0,enablements=0;
 let serverStatus=accountAbsent?'not_connected':actionStatus;
 const providerAccount=(key)=>({
   provider:key,status:serverStatus,connected:serverStatus==='active',
   providerAccountId:serverStatus==='not_connected'?null:'provider-account-A',
   fundsOwner:'merchant',tamaoReceivesSaleProceeds:false
 });
 const ctx=vm.createContext({
  merchantRuntime:rt,globalThis:null,Date,Number,String,Boolean,Array,JSON,Object,Set,URL,location,
  render:()=>{},merchantEnablementAfterChange:()=>enablements++,
  merchantInvoke:async(endpoint,body)=>{
   calls.push({endpoint,body});
   if(postGate)await postGate.promise;
   if(postError)throw postError;
   if(body.action==='start'){
    const host=body.provider==='pagbank'?'connect.pagseguro.uol.com.br':'auth.mercadopago.com';
    const path=body.provider==='pagbank'?'/oauth2/authorize':'/authorization';
    return ackOverride||{
     ok:true,provider:body.provider,fundsOwner:'merchant',tamaoReceivesSaleProceeds:false,
     expiresAt:new Date(Date.now()+5*60000).toISOString(),
     authorizationUrl:'https://'+host+path+'?client_id='+client+
       '&response_type=code&state='+state
    };
   }
   if(body.action==='disconnect'){
    serverStatus=accountAbsent?'not_connected':'revoked';
    return ackOverride||{ok:true,result:{
     ok:true,merchantId:ID,provider:body.provider,
     status:serverStatus,fundsOwner:'merchant',tamaoReceivesSaleProceeds:false
    }};
   }
   if(body.action==='status')return ackOverride||{
    ok:true,provider:{key:body.provider,fundsFlow:'merchant_direct'},
    account:providerAccount(body.provider)
   };
   throw Error('wrong action');
  },
  merchantRefresh:async ({silent})=>{
   assert.equal(silent,true);reads++;
   if(readGate)await readGate.promise;
   const accounts=serverStatus==='not_connected'?[]:[{
    ...providerAccount(provider),
    providerAccountId:wrongRead?'different-provider-account':'provider-account-A'
   }];
   const fresh={merchant:{merchantId:ID,memberRole:role},receivingAccounts:accounts};
   if(!staleRead&&rt.session?.user?.id==='user-A'){
    rt.merchant=fresh.merchant;rt.receivingAccounts=fresh.receivingAccounts;
    rt.lastSyncAt=new Date().toISOString();
   }
   return fresh;
  }
 });
 ctx.globalThis=ctx;
 vm.runInContext(src,ctx);
 return {
  rt,ctx,calls,location,
  invoke:(p=provider,action='status')=>ctx.merchantProviderConnectImpl(p,action),
  switchUser({merchant=false}={}){
   rt.accessEpoch++;rt.session={user:{id:'user-B'}};
   if(merchant){rt.merchant={merchantId:'merchant-B',memberRole:'owner'};
    rt.selectedMerchantId='merchant-B';}
   rt.actionPending=true;
  },
  get reads(){return reads},get enablements(){return enablements}
 };
}
{
 const f=fixture();
 const ack=await f.invoke('mercadopago','status');
 assert.equal(ack.account.connected,true);
 assert.equal(f.reads,1);
 assert.equal(f.calls[0].body.merchantId,ID);
 assert.equal(f.rt.actionPending,false);
 assert.equal(f.location.href,'https://parceiro.tamao.com.br/');
}
{
 const f=fixture({accountAbsent:true});
 const ack=await f.invoke('mercadopago','status');
 assert.equal(ack.account.connected,false);
 assert.equal(f.reads,1);
}
{
 const f=fixture({actionStatus:'revoked'});
 assert.equal((await f.invoke('mercadopago','status')).account.status,'revoked');
 assert.equal(f.reads,1);
}
{
 const f=fixture({wrongRead:true});
 await assert.rejects(()=>f.invoke('mercadopago','status'),/não corresponde/);
 assert.equal(f.rt.actionPending,false);
}
{
 const f=fixture({staleRead:true});
 await assert.rejects(()=>f.invoke('mercadopago','status'),/não foi possível confirmar/);
}
{
 const f=fixture();
 const reply=await f.invoke('mercadopago','disconnect');
 assert.equal(reply.result.status,'revoked');
 assert.equal(f.rt.receivingAccounts[0].connected,false);
 assert.equal(f.rt.receivingAccounts[0].status,'revoked');
 assert.equal(f.enablements,1);
 assert.equal(f.reads,1);
}
{
 const f=fixture({accountAbsent:true});
 const reply=await f.invoke('mercadopago','disconnect');
 assert.equal(reply.result.status,'not_connected');
 assert.equal(f.rt.receivingAccounts.length,0);
 assert.equal(f.enablements,1);
}
{
 const f=fixture({staleRead:true});
 await assert.rejects(()=>f.invoke('mercadopago','disconnect'),/não foi possível confirmar/);
 assert.equal(f.enablements,0);
}
{
 const f=fixture({ackOverride:{ok:true,result:{
  ok:true,merchantId:'merchant-other',provider:'mercadopago',
  status:'revoked',fundsOwner:'merchant',tamaoReceivesSaleProceeds:false
 }}});
 await assert.rejects(()=>f.invoke('mercadopago','disconnect'),/desconexão não foi comprovada/);
 assert.equal(f.reads,0);
}
{
 const f=fixture({postError:Object.assign(Error('payment route active'),{status:409})});
 await assert.rejects(()=>f.invoke('mercadopago','disconnect'),/payment route active/);
 assert.equal(f.reads,0);
 assert.equal(f.enablements,0);
}
{
 const f=fixture({provider:'pagbank'});
 const result=await f.invoke('pagbank','start');
 assert.equal(result.provider,'pagbank');
 assert.match(f.location.href,/^https:\/\/connect\.pagseguro\.uol\.com\.br\/oauth2\/authorize/);
 assert.equal(f.reads,0,'authorization begins by redirect, not by pretending connection is active');
 assert.equal(f.rt.actionPending,false);
}
{
 const f=fixture();
 await f.invoke('mercadopago','start');
 assert.match(f.location.href,/^https:\/\/auth\.mercadopago\.com\/authorization\?/);
 assert.equal(f.reads,0);
}
for(const invalidUrl of [
 'http://auth.mercadopago.com/authorization?response_type=code&client_id='+client+'&state='+state,
 'https://evil.example/authorization?response_type=code&client_id='+client+'&state='+state,
 'https://auth.mercadopago.com.evil.example/authorization?response_type=code&client_id='+client+'&state='+state,
 'https://auth.mercadopago.com:8443/authorization?response_type=code&client_id='+client+'&state='+state,
 'https://auth.mercadopago.com/other?response_type=code&client_id='+client+'&state='+state,
 'https://auth.mercadopago.com/authorization?response_type=code&client_id='+client,
 'https://user:pass@auth.mercadopago.com/authorization?response_type=code&client_id='+client+'&state='+state
]){
 const f=fixture({ackOverride:{
  ok:true,provider:'mercadopago',fundsOwner:'merchant',tamaoReceivesSaleProceeds:false,
  expiresAt:new Date(Date.now()+5*60000).toISOString(),authorizationUrl:invalidUrl
 }});
 await assert.rejects(()=>f.invoke('mercadopago','start'),/autorização do provedor/);
 assert.equal(f.location.href,'https://parceiro.tamao.com.br/');
}
{
 const f=fixture({ackOverride:{
  ok:true,provider:'mercadopago',fundsOwner:'merchant',tamaoReceivesSaleProceeds:false,
  expiresAt:new Date(Date.now()-60000).toISOString(),
  authorizationUrl:'https://auth.mercadopago.com/authorization?response_type=code&client_id='+client+'&state='+state
 }});
 await assert.rejects(()=>f.invoke('mercadopago','start'),/expirou/);
}
{
 const g=gate(),f=fixture({postGate:g});
 const pending=f.invoke('mercadopago','start');
 assert.equal(f.calls.length,1);
 await assert.rejects(()=>f.invoke('pagbank','start'),/Aguarde/);
 f.switchUser();
 g.resolve();
 await assert.rejects(pending,/conta ou revenda mudou/);
 assert.equal(f.location.href,'https://parceiro.tamao.com.br/','stale OAuth never redirects another operator');
 assert.equal(f.rt.actionPending,true,'old finally cannot release new actor lock');
}
{
 const g=gate(),f=fixture({readGate:g});
 const pending=f.invoke('mercadopago','disconnect');
 for(let i=0;i<35&&f.reads===0;i++)await Promise.resolve();
 assert.equal(f.reads,1);
 f.switchUser({merchant:true});
 g.resolve();
 await assert.rejects(pending,/conta ou revenda mudou/);
 assert.equal(f.rt.actionPending,true);
 assert.equal(f.enablements,0);
}
{
 const f=fixture({role:'driver'});
 await assert.rejects(()=>f.invoke('mercadopago','start'),/proprietário ou gerente/);
 assert.equal(f.calls.length,0);
}
{
 const f=fixture();
 await assert.rejects(()=>f.invoke('PAYPAL/redirect','start'),/Provedor de pagamento inválido/);
 await assert.rejects(()=>f.invoke('mercadopago','erase'),/Ação de conexão inválida/);
 assert.equal(f.calls.length,0);
}
assert.match(backend,/async function merchantPaymentConnectLive\(/);
assert.match(backend,/return globalThis.merchantProviderConnectImpl\(provider,action\)/);
assert.match(backend,/merchantLoadMutations\(\)/);
assert.doesNotMatch(backend,/async function merchantProviderConnectImpl\(/);
assert.match(src,/merchantProviderAuthorizeUrl/);
assert.match(edge,/action==="disconnect"/);
assert.match(edge,/action==="status"/);
assert.match(merchant,/merchantDisconnectProviderFromUi/);
assert.match(audit,/merchant-provider-connect-session-proof-v1-493\.mjs/);
console.log('PASS PSP status/start/disconnect: exact readback, ownership, OAuth allowlist and expiry, actor switch, collision and no false success');
