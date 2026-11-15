import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../js/mobility.js',import.meta.url),'utf8');
const owner='11000000-0000-4000-8000-000000000001',id='22000000-0000-4000-8000-000000000002';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const policy=()=>({plans:[{key:'essential',name:'Essencial',mode:'prepaid',amountCents:990,
 feeBps:600,purchaseEnabled:true}],benefits:{version:2,normalFeeBps:900,
 memberFeeBps:800,eligibleDriver:true,termsText:'Condições do programa'},
 prepaid:{availableCents:0,reservedCents:0,spentCents:0,underReviewCents:0},
 billing:{outstandingCents:0,recordedCount:0,accruedCents:0,collectedCents:0,
 collectionStatus:'not_collected',entries:[]}});
const charge=()=>({ok:true,charge:{invoiceId:id,status:'active',amountCents:990,
 invoiceKind:'prepaid_credit',brCode:'0002010102110000000000000000000000000000000',
 expiresAt:new Date(Date.now()+3600000).toISOString(),paidByProvider:false}});
function fixture(stage){
 const timers=new Map(),pending=deferred(),calls=[];let seq=0,signal;
 const context=vm.createContext({URL,URLSearchParams,Date,Intl,FormData,AbortController,
  BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),esc:String,
  document:{querySelector:()=>null,createElement:()=>({}),head:{appendChild(){}},
   addEventListener:()=>{},getElementById:()=>null,visibilityState:'visible'},
  route:()=> 'mobility',render:()=>{},CHAMA_BACKEND:{url:'https://isolated.invalid',publishableKey:'public-test'},
  setTimeout:(fn,ms)=>{timers.set(++seq,{fn,ms});return seq},clearTimeout:id=>timers.delete(id),
  fetch:async(url,options)=>{
   calls.push(JSON.parse(options.body));signal=options.signal;
   if(stage==='fetch')return pending.promise;
   return {ok:true,json:async()=>stage==='body'?pending.promise:charge()};
  }});
 vm.runInContext(source+';this.rt=mobilityRuntime;',context);
 const s=context.rt;s.user={id:owner};s.program=policy();
 s.client={auth:{getSession:async()=>stage==='session'?pending.promise:
  {data:{session:{user:{id:owner},access_token:'owned-session'}}}},
  rpc:async()=>stage==='ledger'?pending.promise:{data:policy(),error:null}};
 return {context,s,timers,pending,calls,signal:()=>signal};
}
async function flush(){for(let i=0;i<15;i++)await Promise.resolve()}
for(const stage of ['session','fetch','body','ledger']){
 const f=fixture(stage),request=f.context.mobilityFeePixRequest('plan','essential');
 await flush();assert.equal(f.s.pixBusy,true);
 const timeout=[...f.timers.values()].find(t=>t.ms===15000);
 assert.ok(timeout,'the entire authenticated Pix read needs a finite deadline: '+stage);
 timeout.fn();await request;
 assert.equal(f.s.pixBusy,false);assert.equal(f.s.pix,null);
 assert.equal(f.s.pixCheckRequired,true);
 assert.match(f.context.mobilityFeePixPanel(),/Conferir pagamento no Mercado Pago/);
 assert.doesNotMatch(f.context.mobilityFeePixPanel(),/Pix copia e cola|Recarga confirmada/);
 assert.match(f.context.mobilityPrepaidPlansPanel(),/disabled>Comprar recarga Essencial/);
 const count=f.calls.length;
 await f.context.mobilityFeePixRequest('plan','essential');assert.equal(f.calls.length,count,
  'uncertain original payment must be checked before any new purchase');
 if(f.signal())assert.equal(f.signal().aborted,true);
 // A late transport completion cannot resurrect the timed-out QR.
 f.pending.resolve(stage==='session'?{data:{session:{user:{id:owner},access_token:'owned-session'}}}:
  stage==='ledger'?{data:policy(),error:null}:stage==='fetch'?{ok:true,json:async()=>charge()}:charge());
 await flush();assert.equal(f.s.pix,null);
 assert.equal(f.calls.length,count,'no automatic replacement POST after a late response');
 // Explicit status recovery uses the same server-owned latest invoice.
 f.s.client.auth.getSession=async()=>({data:{session:{user:{id:owner},access_token:'owned-session'}}});
 f.s.client.rpc=async()=>({data:policy(),error:null});
 f.context.fetch=async(url,opts)=>{f.calls.push(JSON.parse(opts.body));return {ok:true,json:async()=>charge()}};
 await f.context.mobilityFeePixRequest('status');
 assert.equal(f.calls.at(-1).action,'status');assert.equal(f.s.pix.invoiceId,id);
 assert.equal(f.s.pixCheckRequired,false);assert.equal(f.s.pixBusy,false);
 assert.match(f.context.mobilityFeePixPanel(),/Pix copia e cola/);
}
// If the ledger is unavailable, retain a status-only path even though the
// ordinary financial catalogue is deliberately hidden until a valid read.
{
 const f=fixture('body');f.s.program=null;f.s.pixCheckRequired=true;
 assert.match(f.context.mobilityFeePixPanel(),/Conferir pagamento no Mercado Pago/);
 assert.match(f.context.mobilityFeeLedgerPanel(),/Conferir pagamento no Mercado Pago/);
 f.s.client.rpc=async()=>({data:policy(),error:null});
 f.context.fetch=async(url,opts)=>{assert.equal(JSON.parse(opts.body).action,'status');return {ok:true,json:async()=>charge()}};
 await f.context.mobilityFeePixRequest('status');
 assert.equal(f.s.pix.invoiceId,id);assert.equal(f.s.pixCheckRequired,false);
}
// An old timeout must not clear another account's charge or busy state.
{
 const f=fixture('fetch'),request=f.context.mobilityFeePixRequest('status');await flush();
 const timeout=[...f.timers.values()].find(t=>t.ms===15000);
 f.context.mobilityClearSession();f.s.user={id:'33000000-0000-4000-8000-000000000003'};
 f.s.program=policy();f.s.pix={...charge().charge,invoiceId:'44000000-0000-4000-8000-000000000004'};
 f.s.pixBusy=true;timeout.fn();await request;
 assert.equal(f.s.pixBusy,true);assert.equal(f.s.pix.invoiceId,'44000000-0000-4000-8000-000000000004');
 assert.equal(f.s.pixCheckRequired,false);
}
console.log('PASS: bounded mobility Pix session/fetch/body/ledger, no stale QR or automatic replacement, status-only recovery and account-safe timeout.');
