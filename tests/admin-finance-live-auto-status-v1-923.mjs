import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ui=read('js/admin.js');
new vm.Script(ui,{filename:'admin.js'});
const a=ui.indexOf('function adminFinanceLabLiveActorCurrent(');
const b=ui.indexOf('function adminFinanceLabLiveHistoryLabel(',a);
const c=ui.indexOf('function adminFinanceLabLivePaymentBanner(');
const d=ui.indexOf('function adminFinanceLabView(',c);
assert(a>0&&b>a&&c>b&&d>c);
const functions=ui.slice(a,b);
const banner=ui.slice(c,d);
const ORDER='ORD_REAL_PAYMENT_2026_ORIGINAL';
const expiresAt=new Date(Date.now()+600000).toISOString();
const createdAt=new Date().toISOString();
const pending=()=>({ok:true,mode:'live',orderId:ORDER,amountCents:200,
 orderStatus:'action_required',paymentStatus:'action_required',
 providerProcessed:false,webhookProcessed:false,webhookSeen:true,
 reversalObserved:false,brCode:'000201'+('X'.repeat(74)),expiresAt,
 credited:false,settlementVerified:false});
const processed=()=>({...pending(),orderStatus:'processed',
 paymentStatus:'processed',providerProcessed:true,webhookProcessed:true,brCode:''});
const processedUnsigned=()=>({...processed(),webhookProcessed:false});
function fixture(){
 const lab={live:{mode:'live',orderId:ORDER,expiresAt,brCode:'000201'+('X'.repeat(74))},
  livePending:false,liveSilentCheck:false,liveStatus:null,liveReadiness:null,
  liveReadinessLoading:false,liveError:null};
 const rt={status:'ready',section:'finance',financeWorkspace:'homologation',
  financeHomologationLabOpen:true,session:{user:{id:'owner'}},financeLab:lab};
 const calls=[],timers=[],draws=[],document={visibilityState:'visible'};
 let answer=pending();
 const ctx=vm.createContext({
  adminRuntime:rt,adminReady:()=>rt.status==='ready',
  adminCurrentRole:()=> 'superadmin',
  adminInvoke:async req=>{
   calls.push(req);
   return req.action==='finance-lab-live-readiness'?
    {ok:true,mode:'live',readOnly:true,recent:[{orderId:ORDER,createdAt}]}:answer;
  },
  adminFinanceLabLiveScheduleExpiry:()=>{},
  adminFinanceLabLoadQrEncoder:()=>Promise.resolve(),
  render:()=>draws.push(lab.liveStatus?.paymentStatus||'none'),
  document,Date,String,Number,Math,Error,
  setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},
  clearTimeout:()=>{},adminMoney:n=>'R$ '+(n/100).toFixed(2).replace('.',','),
  esc:x=>String(x)
 });
 vm.runInContext(functions+banner+
  ';this.watch=adminFinanceLabLiveWatchOrder;'+
  'this.check=adminFinanceLabLiveCheckFromUi;'+
  'this.readiness=adminFinanceLabLiveReadinessFromUi;'+
  'this.banner=adminFinanceLabLivePaymentBanner;',ctx);
 return {lab,rt,calls,timers,draws,document,ctx,setReply:r=>{answer=r}};
}
// Original pending Pix, then processed in the PSP and signed webhook.
// The read-only poll should remove the QR, show the paid state, and stop.
{
 const f=fixture();
 f.ctx.watch(ORDER,f.lab,'owner');
 assert.equal(f.timers.length,1);
 assert.equal(f.timers[0].ms,15000);
 f.setReply(processed());
 await f.timers[0].fn();
 assert.deepEqual(f.calls.map(x=>x.action),['finance-lab-live-check']);
 assert.equal(f.lab.live,null,'do not keep paid QR on screen');
 assert.equal(f.lab.liveStatus.providerProcessed,true);
 assert.equal(f.lab.liveStatus.webhookProcessed,true);
 assert.equal(f.lab.liveStatus.credited,false);
 assert.equal(f.lab.liveStatus.settlementVerified,false);
 assert.match(f.ctx.banner(f.lab),/Pagamento processado no Mercado Pago/);
 assert.match(f.ctx.banner(f.lab),/webhook assinado confirmado/);
 assert.match(f.ctx.banner(f.lab),/não credita cupons/);
 assert.equal(f.timers.length,1,'no polling after processed status');
}
// Repeated unchanged pending checks should not flash the screen or create bills.
{
 const f=fixture();
 f.ctx.watch(ORDER,f.lab,'owner');
 await f.timers[0].fn();
 assert.equal(f.timers.length,2);
 const before=f.draws.length;
 await f.timers[1].fn();
 assert.equal(f.draws.length,before,'unchanged pending results must not redraw');
 assert(f.calls.every(x=>x.action==='finance-lab-live-check'));
}
// A hidden tab does not call the PSP; a changed owner cannot resume the watch.
{
 const f=fixture();
 f.ctx.watch(ORDER,f.lab,'owner');
 f.document.visibilityState='hidden';
 await f.timers[0].fn();
 assert.equal(f.calls.length,0);
 assert.equal(f.timers.length,2);
 f.rt.session={user:{id:'another-user'}};
 await f.timers[1].fn();
 assert.equal(f.calls.length,0);
}
// Reopening the lab reads the newest recent original order, no POST.
{
 const f=fixture();
 f.lab.live=null;
 f.setReply(processed());
 await f.ctx.readiness();
 await Promise.resolve();
 await Promise.resolve();
 assert(f.calls.some(x=>x.action==='finance-lab-live-readiness'));
 assert(f.calls.some(x=>x.action==='finance-lab-live-check'));
 assert(!f.calls.some(x=>x.action==='finance-lab-live-pix'));
 assert.equal(f.lab.liveStatus?.paymentStatus,'processed');
}
// A provider-confirmed payment must keep polling for its signed webhook,
// even after the expired payable QR is cleared from the interface.
{
 const f=fixture();
 f.ctx.watch(ORDER,f.lab,'owner');
 f.setReply(processedUnsigned());
 await f.timers[0].fn();
 assert.equal(f.lab.live,null,'remove the original payable QR when PSP processed');
 assert.equal(f.lab.liveStatus.providerProcessed,true);
 assert.equal(f.lab.liveStatus.webhookProcessed,false);
 assert.equal(f.timers.length,2,'continue GET-only observations for unsigned payment');
 assert.match(f.ctx.banner(f.lab),/O webhook será consultado automaticamente/);
 assert.match(f.ctx.banner(f.lab),/15 minutos/);
 f.setReply(processed());
 await f.timers[1].fn();
 assert.equal(f.lab.liveStatus.webhookProcessed,true);
 assert.equal(f.timers.length,2,'stop once signed callback is observed');
 assert(f.calls.every(x=>x.action==='finance-lab-live-check'),'no POST or new charge');
}
// Readiness refresh can resume a previously processed original order,
// but a stale/expired wait window stops rather than polling forever.
{
 const f=fixture();
 f.lab.live=null;
 f.lab.liveStatus=processedUnsigned();
 await f.ctx.readiness();
 assert.equal(f.timers.length,1,'resume waiting for the same signed webhook');
 f.lab.liveWebhookWait={orderId:ORDER,startedAt:Date.now()-16*60_000};
 f.ctx.watch(ORDER,f.lab,'owner');
 assert.equal(f.timers.length,1,'observation budget is bounded');
}
{
 const f=fixture();
 f.lab.live=null;
 f.lab.liveStatus={...processedUnsigned(),reversalObserved:true};
 f.ctx.watch(ORDER,f.lab,'owner');
 assert.equal(f.timers.length,0,'do not poll a reversed payment');
}
assert.doesNotMatch(ui,/O teste de R\$ 2,00 comprovou o gateway/);
assert.match(ui,/Aguardando webhook assinado/);
assert.match(ui,/adminFinanceLabLiveCancelAutoCheck\(\)/);
assert.match(ui,/function adminFinanceLabLiveWatchOrder\(/);
assert.match(ui,/adminFinanceLabLivePaymentBanner\(state\)/);
assert.match(ui,/adminFinanceLabLiveScheduleExpiry\(null\)/);
assert.match(read('.github/workflows/audit.yml'),/tests\/admin-finance-live-auto-status-v1-923\.mjs/);
console.log('V1.923 PASS: original Pix polling, processed+signed view, no duplicate charge, safe account isolation.');
