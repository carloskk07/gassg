import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('js/admin.js');
const start=admin.indexOf('function adminFinanceLabLiveActorCurrent(');
const end=admin.indexOf('function adminFinanceLabLiveHistoryLabel(',start);
assert.ok(start>0&&end>start,'live Pix scope and recovery functions must be contiguous');
const source=admin.slice(start,end);
new vm.Script(source);
const ID='ORD_REAL_PIX_ORIGINAL_12345';
const FOREIGN='ORD_FOREIGN_PIX_ORDER_98765';
const EXPIRES=new Date(Date.now()+3600_000).toISOString();
const pix=()=>({ok:true,mode:'live',found:true,recovered:true,
 orderId:ID,amountCents:200,brCode:'000201010212'+('X'.repeat(54)),
 expiresAt:EXPIRES,credited:false,settlementVerified:false,
 paymentLinkUrl:'https://www.mercadopago.com.br/payments/ticket'});
const status=()=>({ok:true,mode:'live',orderId:ID,amountCents:200,
 orderStatus:'action_required',paymentStatus:'action_required',
 brCode:'000201010212'+('Y'.repeat(54)),expiresAt:EXPIRES,
 credited:false,settlementVerified:false,
 paymentLinkUrl:'https://www.mercadopago.com.br/payments/ticket'});
function defer(){
 let resolve;
 const promise=new Promise(r=>resolve=r);
 return {promise,resolve};
}
function fixture(){
 const calls=[],renders=[],schedules=[],toasts=[];
 const lab={
  liveReadiness:null,liveReadinessLoading:false,
  livePending:false,liveError:null,live:null,liveStatus:null,
  liveKey:null,liveAmountCents:null
 };
 const runtime={status:'ready',session:{user:{id:'operator-A'}},financeLab:lab};
 let role='superadmin',perform=async({action})=>{
  if(action==='finance-lab-live-readiness')
   return {ok:true,mode:'live',readOnly:true,recent:[]};
  if(action==='finance-lab-live-recover')return pix();
  if(action==='finance-lab-live-check')return status();
  if(action==='finance-lab-live-pix')return {...pix(),found:undefined};
  throw Error('Unexpected action '+action);
 };
 let prompt=()=> 'GERAR PIX REAL',clipboard=async()=>{};
 const ctx=vm.createContext({
  adminRuntime:runtime,Date,String,Number,Math,Error,
  adminReady:()=>runtime.status==='ready',
  adminCurrentRole:()=>role,
  adminInvoke:async payload=>{calls.push({...payload});return perform(payload)},
  adminFinanceLabCents:()=>200,
  adminIdempotency:()=> 'replay-same-key-1234567890',
  adminFinanceLabLiveIsPayable:()=>true,
  adminFinanceLabLiveScheduleExpiry:v=>schedules.push(v),
  adminFinanceLabLoadQrEncoder:async()=>true,
  render:()=>renders.push({actor:runtime.session?.user?.id,lab:runtime.financeLab}),
  toast:t=>toasts.push(t),
  document:{getElementById:()=>({value:'2,00'})},
  prompt:(...args)=>prompt(...args),
  navigator:{clipboard:{writeText:async text=>clipboard(text)}}
 });
 vm.runInContext(source+'\nthis.pixOps={readiness:adminFinanceLabLiveReadinessFromUi,'+
  'recover:adminFinanceLabLiveRecoverFromUi,check:adminFinanceLabLiveCheckFromUi,'+
  'create:adminFinanceLabLiveCreateFromUi,copy:adminFinanceLabLiveCopyFromUi,'+
  'scope:adminFinanceLabLiveActorCurrent};',ctx);
 return {ctx,rt:runtime,lab,calls,renders,schedules,toasts,
  provider:fn=>perform=fn,role:v=>role=v,prompt:fn=>prompt=fn,clipboard:fn=>clipboard=fn};
}

// Existing PSP order, read-only lookup, original QR and verification; no POST.
{
 const a=fixture();
 await a.ctx.pixOps.recover(ID);
 assert.equal(a.calls[0].action,'finance-lab-live-recover');
 assert.equal(a.calls[0].orderId,ID);
 assert.equal(a.lab.live.orderId,ID);
 assert.equal(a.lab.livePending,false);
 assert.equal(a.lab.liveError,null);
 assert.equal(a.schedules[0].orderId,ID);
 assert.equal(a.calls.some(x=>x.action==='finance-lab-live-pix'),false);
 await a.ctx.pixOps.check(ID);
 assert.equal(a.lab.liveStatus.orderId,ID);
 assert.equal(a.lab.live.orderId,ID);
 assert.equal(a.lab.liveStatus.credited,false);
 assert.equal(a.lab.liveStatus.settlementVerified,false);
 assert.equal(a.calls.some(x=>x.action==='finance-lab-live-pix'),false);
 // PSP processing is NOT verified receipt: remove an obsolete payable QR.
 a.provider(async ({action})=>{
  assert.equal(action,'finance-lab-live-check');
  return {...status(),orderStatus:'processed',paymentStatus:'processed'};
 });
 await a.ctx.pixOps.check(ID);
 assert.equal(a.lab.live,null,'processed PSP status must remove stale payable QR');
 assert.equal(a.lab.liveStatus.orderStatus,'processed');
 assert.equal(a.lab.liveStatus.credited,false,'provider GET cannot credit funds');
}

// Reject response for a different order, even when the endpoint says found.
{
 const a=fixture();
 a.provider(async()=>({...pix(),orderId:FOREIGN}));
 await a.ctx.pixOps.recover(ID);
 assert.equal(a.lab.live,null);
 assert.equal(a.lab.liveStatus,null);
 assert.match(a.lab.liveError,/outra ordem/);
 assert.equal(a.schedules.length,0);
 assert.equal(a.calls.filter(x=>x.action==='finance-lab-live-pix').length,0);
}

// Contradictory provider check must not replace the current order.
{
 const a=fixture();
 a.lab.live=pix();
 a.provider(async()=>({...status(),orderId:FOREIGN}));
 await a.ctx.pixOps.check(ID);
 assert.equal(a.lab.live.orderId,ID);
 assert.equal(a.lab.liveStatus,null);
 assert.match(a.lab.liveError,/não foi comprovada/);
}

// A late recovery result after account switch cannot install a private QR
// or schedule expiry in the second operator's finance lab.
{
 const a=fixture(),gate=defer();
 a.provider(async()=>gate.promise);
 const prior=a.ctx.pixOps.recover(ID);
 assert.equal(a.calls.length,1);
 const fresh={live:null,liveStatus:null,livePending:false};
 a.rt.session={user:{id:'operator-B'}};
 a.rt.financeLab=fresh;
 const before=a.renders.length;
 gate.resolve(pix());
 await prior;
 assert.equal(a.rt.financeLab,fresh);
 assert.equal(fresh.live,null);
 assert.equal(a.lab.live,null);
 assert.equal(a.schedules.length,0);
 assert.equal(a.renders.length,before,'old response must not redraw another admin');
}

// A late same-ID payment check cannot update a different administrator.
{
 const a=fixture(),gate=defer();
 a.provider(async()=>gate.promise);
 const prior=a.ctx.pixOps.check(ID);
 a.rt.session={user:{id:'operator-B'}};
 a.rt.financeLab={liveStatus:null};
 gate.resolve(status());
 await prior;
 assert.equal(a.rt.financeLab.liveStatus,null);
 assert.equal(a.schedules.length,0);
}

// Readiness returned after a session replacement must not reinstate old Pix
// history or show old-account errors.
{
 const a=fixture(),gate=defer();
 a.provider(async()=>gate.promise);
 const prior=a.ctx.pixOps.readiness();
 const fresh={liveReadiness:null,liveReadinessLoading:false};
 a.rt.session={user:{id:'operator-B'}};
 a.rt.financeLab=fresh;
 gate.resolve({ok:true,mode:'live',readOnly:true,recent:[{orderId:ID}]});
 await prior;
 assert.equal(fresh.liveReadiness,null);
 assert.equal(a.lab.liveReadiness,null);
}

// A confirmation prompt cannot authorize issuance after the operator changes.
// No actual financial action is made by this test.
{
 const a=fixture();
 a.lab.liveReadiness={providerReady:true,accountBound:true,remoteWebhookVerified:true};
 a.prompt(()=>{a.rt.session={user:{id:'operator-B'}};return 'GERAR PIX REAL'});
 await a.ctx.pixOps.create();
 assert.equal(a.calls.length,0,'old confirmation must never POST in the new account');
 assert.equal(a.lab.liveKey,null);
}

// A request already started before signout can finish on the server, but it
// cannot install a Pix in the newly signed-in operator's UI.
{
 const a=fixture(),gate=defer();
 a.lab.liveReadiness={providerReady:true,accountBound:true,remoteWebhookVerified:true};
 a.provider(async()=>gate.promise);
 const prior=a.ctx.pixOps.create();
 assert.equal(a.calls.length,1);
 assert.equal(a.calls[0].action,'finance-lab-live-pix');
 assert.equal(a.calls[0].authorization,'GERAR_PIX_REAL');
 a.rt.status='unauthenticated';
 a.rt.session=null;
 a.rt.financeLab={live:null};
 const before=a.renders.length;
 gate.resolve(pix());
 await prior;
 assert.equal(a.rt.financeLab.live,null);
 assert.equal(a.schedules.length,0);
 assert.equal(a.renders.length,before);
}

// Copy callback after logout must never display a stale success toast.
{
 const a=fixture(),gate=defer();
 const original=pix();
 a.lab.live=original;
 a.clipboard(async()=>gate.promise);
 const prior=a.ctx.pixOps.copy();
 a.rt.status='unauthenticated';
 a.rt.session=null;
 a.rt.financeLab={live:null};
 gate.resolve();
 await prior;
 assert.equal(a.toasts.length,0);
}

// Superadmin restriction is required on every read path.
{
 const a=fixture();
 a.role('support');
 await a.ctx.pixOps.readiness();
 await a.ctx.pixOps.recover(ID);
 await a.ctx.pixOps.check(ID);
 await a.ctx.pixOps.copy();
 assert.equal(a.calls.length,0);
}
assert.match(admin,/function adminSignOut\(\)\{[\s\S]*?adminFinanceLabLiveScheduleExpiry\(null\)/,
 'logout must clear the previous QR expiry timer');
assert.ok(read('.github/workflows/audit.yml').includes(
 'node tests/admin-finance-pix-session-recovery-v1-493.mjs'));
console.log('PASS #493 Admin Pix lifecycle: read-only original order/QR/status, no settlement, account isolation, prompt and clipboard guard.');
