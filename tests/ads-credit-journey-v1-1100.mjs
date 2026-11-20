import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const source=read('js/ads-credits.js');
const studio=read('js/sponsors-premium.js');
const topupId='11111111-1111-4111-8111-111111111111';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const flush=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};
const storage=()=>{const map=new Map();return {
 getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k),map
};};
const wallet=(balance=0,topups=[])=>({source:'ads_credit_balance_v1_1097',
 balanceCents:balance,centsPerView:2,totalSpentCents:0,totalLoadedCents:balance,
 rechargeEnabled:true,billingEnabled:true,frozen:false,entries:[],campaigns:[],topups});
function harness(saved=storage()){
 const fields={},calls=[],timers=new Map();let timerId=0,html='';
 const mount={get innerHTML(){return html},set innerHTML(value){
  html=value;
  for(const id of Object.keys(fields))if(id!=='tamao-credit-mount')delete fields[id];
  for(const tag of value.matchAll(/<(input|textarea|select|p|form)[^>]*\bid="([^"]+)"[^>]*>/g)){
   const val=tag[0].match(/\bvalue="([^"]*)"/);
   fields[tag[2]]={value:val?.[1]||(tag[1]==='select'?'RS':''),checked:false,textContent:''};
  }
 }};
 fields['tamao-credit-mount']=mount;
 const context={console,Date,Intl,URL,crypto:{randomUUID},sessionStorage:saved,
  liveRuntime:{session:{user:{id:'owner-a'}},authGeneration:1},
  tamaoAdsAccountVerified:()=>!!context.liveRuntime.session,
  tamaoPixMarkup:()=>'<svg role="img" aria-label="QR Pix"></svg>',
  document:{visibilityState:'visible',getElementById:id=>fields[id]||null,
   querySelector:()=>null,querySelectorAll:()=>[]},
  setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},
  clearTimeout:id=>timers.delete(id),
  liveInvoke:(name,body,options)=>{const d=deferred();calls.push({name,body,options,...d});return d.promise;}
 };
 vm.createContext(context);vm.runInContext(source,context);
 const state=()=>JSON.parse(vm.runInContext('JSON.stringify(tamaoCreditState)',context));
 const account=(id,generation)=>{context.liveRuntime.session=id?{user:{id}}:null;
  context.liveRuntime.authGeneration=generation;};
 const load=async(data=wallet())=>{const p=context.tamaoCreditRefresh();calls.at(-1).resolve(data);await p;};
 return {context,fields,calls,timers,mount,state,account,load,saved};
}

// A read started before the post-payment read cannot restore a payable old Pix.
{
 const h=harness();
 const first=h.context.tamaoCreditRefresh(),a=h.calls.at(-1);
 const second=h.context.tamaoCreditRefresh(),b=h.calls.at(-1);
 b.resolve(wallet(1990));await second;
 a.resolve(wallet(0));assert.equal(await first,false);
 assert.equal(h.state().data.balanceCents,1990);
 assert.equal(h.state().loading,false);
}

// Rendered fields, consent and balances cannot cross identities or login cycles.
{
 const h=harness();await h.load(wallet(1990));
 h.fields['tamao-credit-c-title'].value='Proposta privada da conta A';
 h.fields['tamao-credit-c-terms'].checked=true;
 const old=h.context.tamaoCreditRefresh(),a=h.calls.at(-1);
 h.account('owner-b',2);
 const fresh=h.context.tamaoCreditRefresh(),b=h.calls.at(-1);
 a.resolve(wallet(4990));assert.equal(await old,false);
 assert.equal(h.state().loading,true,'An old finally must not release the new account read');
 b.resolve(wallet());await fresh;
 assert.equal(h.fields['tamao-credit-c-title'].value,'');
 assert.equal(h.fields['tamao-credit-c-terms'].checked,false);
 assert.equal(h.state().data.balanceCents,0);
 const oldLogin=h.context.tamaoCreditRefresh(),before=h.calls.at(-1);
 h.account(null,3);h.context.tamaoCreditBoot();
 h.account('owner-b',4);
 const newLogin=h.context.tamaoCreditRefresh(),after=h.calls.at(-1);
 after.resolve(wallet(99));await newLogin;
 before.resolve(wallet(9990));assert.equal(await oldLogin,false);
 assert.equal(h.state().data.balanceCents,99);
}

// The actual public studio fills the new credit form after explicit continuation.
{
 const h=harness();await h.load();vm.runInContext(studio,h.context);
 h.context.sponsorJumpTo=()=>true;
 h.context.sponsorDemoContinue();
 assert.match(h.fields['tamao-credit-c-title'].value,/Novidades/);
 assert.ok(h.fields['tamao-credit-c-description'].value.length>=20);
 assert.equal(h.fields['tamao-credit-c-terms'].checked,false);
 assert.equal(h.fields['tamao-credit-c-destination'].value,'');
 assert.equal(h.calls.length,1,'Continuing a preview must not submit or create Pix');
 h.fields['tamao-credit-c-title'].value='Mensagem que eu já personalizei';
 h.context.sponsorDemoBudget(9990);h.context.sponsorDemoContinue();
 assert.equal(h.fields['tamao-credit-c-title'].value,'Mensagem que eu já personalizei');
 assert.equal(h.state().amountCents,9990);
 h.account('owner-b',2);await h.load();
 assert.equal(h.fields['tamao-credit-c-title'].value,'','Consumed preview is not applied to another account');
}

// Timeout/lost response retains one intention, also after reloading the page.
{
 const h=harness();await h.load();h.fields['tamao-credit-terms'].checked=true;
 const first=h.context.tamaoCreditTopup(),a=h.calls.at(-1);
 const key=a.body.requestId;
 assert.equal(h.context.tamaoCreditChoose(9990),false);
 a.reject(Error('Response lost'));assert.equal(await first,false);
 assert.equal(h.state().requestId,key);
 const restored=harness(h.saved);await restored.load(wallet(0,[{
  id:topupId,amountCents:1990,status:'creating'
 }]));
 assert.equal(restored.state().requestId,key);
 restored.fields['tamao-credit-terms'].checked=true;
 const retry=restored.context.tamaoCreditTopup(),b=restored.calls.at(-1);
 assert.equal(b.body.requestId,key,'Reload must resume the same server intention');
 b.resolve({source:'ads_credit_topup_v1_1097',status:'pix_pending',topupId,
  amountCents:1990,pixCode:'000201-test-pix-code',expiresAt:new Date(Date.now()+3600000).toISOString()});
 await flush();
 const pending={id:topupId,amountCents:1990,status:'pix_pending',
  pixCode:'000201-test-pix-code',expiresAt:new Date(Date.now()+3600000).toISOString()};
 restored.calls.at(-1).resolve(wallet(0,[pending]));await retry;
 assert.equal(restored.state().pix.topupId,topupId);
 assert.match(restored.mount.innerHTML,/QR Pix/);
 assert.equal(restored.context.tamaoCreditChoose(9990),false);
 assert.equal(await restored.context.tamaoCreditTopup(),false,'Pending Pix cannot issue another charge');
 const poll=[...restored.timers.values()].find(t=>t.ms===30000);
 assert.ok(poll);poll.fn();await flush();
 assert.equal(restored.calls.at(-1).body.action,'mine','Automatic refresh only reads the wallet');
 restored.calls.at(-1).resolve(wallet(1990,[{...pending,status:'approved'}]));await flush();
 assert.equal(restored.state().pix,null);
 assert.equal(restored.state().requestId,null);
 assert.equal(restored.state().data.balanceCents,1990);
 assert.equal(restored.saved.getItem('tamao-ads-credit-request-v1100:owner-a'),null);
}

// The whole network call is bounded and an eventual late body has no authority.
{
 const h=harness();await h.load();h.fields['tamao-credit-terms'].checked=true;
 const first=h.context.tamaoCreditTopup(),lost=h.calls.at(-1);
 lost.reject(Error('Lost after provider creation'));await first;
 const restored=harness(h.saved);
 const pending={id:topupId,amountCents:1990,status:'pix_pending',pixCode:'already-created-pix',
  expiresAt:new Date(Date.now()+3600000).toISOString()};
 await restored.load(wallet(0,[pending]));
 assert.equal(restored.state().topupId,topupId);
 const poll=[...restored.timers.values()].find(t=>t.ms===30000);
 restored.fields['tamao-credit-campaign-form'].contains=()=>true;
 const before=restored.calls.length;poll.fn();await flush();
 assert.equal(restored.calls.length,before,'Polling must not replace a focused campaign form');
 restored.fields['tamao-credit-campaign-form'].contains=()=>false;
 const next=[...restored.timers.values()].filter(t=>t.ms===30000).at(-1);next.fn();
 restored.calls.at(-1).resolve(wallet(1990,[{...pending,status:'approved'}]));await flush();
 assert.equal(restored.state().pix,null);assert.equal(restored.state().requestId,null,
  'Payment after reload must clear the original intention without another Pix request');
 assert.equal(restored.calls.filter(c=>c.body.action==='topup').length,0);
}

// The whole network call is bounded and an eventual late body has no authority.
{
 const h=harness();const p=h.context.tamaoCreditRefresh(),late=h.calls.at(-1);
 const timer=[...h.timers.values()].find(t=>t.ms===20000);assert.ok(timer);timer.fn();
 assert.equal(await p,false);assert.equal(h.state().loading,false);
 late.resolve(wallet(9990));await flush();assert.equal(h.state().data,null);
}

// Switching while a Pix is pending cannot place its QR or unlock B's request.
{
 const h=harness();await h.load();h.fields['tamao-credit-terms'].checked=true;
 const old=h.context.tamaoCreditTopup(),a=h.calls.at(-1);
 h.account('owner-b',2);await h.load();h.fields['tamao-credit-terms'].checked=true;
 const fresh=h.context.tamaoCreditTopup(),b=h.calls.at(-1);
 assert.notEqual(a.body.requestId,b.body.requestId);
 a.resolve({source:'ads_credit_topup_v1_1097',status:'pix_pending',amountCents:1990,
  topupId,pixCode:'old-private-code',expiresAt:new Date(Date.now()+3600000).toISOString()});
 assert.equal(await old,false);assert.equal(h.state().busy,true);
 assert.equal(h.state().pix,null);assert.ok(!h.mount.innerHTML.includes('old-private-code'));
 b.reject(Error('Temporary error'));await fresh;assert.equal(h.state().busy,false);
}

// Real liveInvoke rechecks the caller's lease AFTER awaiting the access token.
{
 const backend=read('js/backend.js');
 const fn=backend.slice(backend.indexOf('async function liveInvoke('),backend.indexOf('\nfunction prelaunchAttribution('));
 const token=deferred();let accepted=true,sent=0;
 const ctx={liveReady:()=>true,liveAccessToken:()=>token.promise,
  CHAMA_BACKEND:{url:'https://unused.invalid',publishableKey:'test'},
  chamaFetch:async()=>{sent++;return {ok:true,json:async()=>({})};}};
 vm.createContext(ctx);vm.runInContext(fn,ctx);
 const request=ctx.liveInvoke('ads-credit',{action:'campaign-submit'},{sessionGuard:()=>accepted});
 accepted=false;token.resolve('old-test-token');
 await assert.rejects(request,/conta mudou/);assert.equal(sent,0);
}

assert.match(source,/Visualização elegível/);
assert.ok(!source.includes('Visualização auditada'));
console.log('PASS V1.1100: consented studio handoff, out-of-order reads, A/B and same-user session isolation, original Pix recovery after reload, QR removal after payment, read-only polling, full-call timeout and pre-send identity guard.');
