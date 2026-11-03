import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/admin.js');
const names=['adminFinanceDecisionScope','adminFinanceDecisionProof','adminFinanceDecisionMessage','adminResolveBillingRefund','adminBillingPaymentEventAction','adminResolveDailyStatement'];
const code=names.map(name=>{
 const start=source.search(new RegExp('(?:async )?function '+name+'\\('));
 assert.ok(start>=0,'Missing '+name);
 const end=source.indexOf('\n}',start);
 assert.ok(end>start);
 return source.slice(start,end+2);
}).join('\n');
new vm.Script(code);
const merchant='11111111-1111-4111-8111-111111111111';
const sid='22222222-2222-4222-8222-222222222222';
const unlinked='33333333-3333-4333-8333-333333333333';
const excessId='44444444-4444-4444-8444-444444444444';
const eventId='55555555-5555-4555-8555-555555555555';
const reqId='66666666-6666-4666-8666-666666666666';
const initial={
 merchantBilling:{
  statements:[{id:sid,merchant_id:merchant,status:'open',amount_due_cents:12500,paid_at:null,waived_at:null}],
  refunds:[
   {id:unlinked,status:'review_required',payment_request_id:null,merchant_id:null,provider_event_id:'ref1',amount_cents:3000},
   {id:excessId,status:'review_required',payment_request_id:reqId,merchant_id:merchant,provider_event_id:'ref2',amount_cents:2000,match_reason:'refund_total_exceeds_original'}
  ],
  refundRecoveries:[],
  paymentEvents:[{id:eventId,status:'review_required',provider:'mercadopago',provider_event_id:'evt1',payment_request_id:null,amount_cents:12500}]
 }
};
const clone=x=>structuredClone(x);
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve}};
function fixture(){
 const db=clone(initial),calls=[],reads=[],toasts=[];
 const rt={requested:true,status:'ready',actionPending:false,session:{user:{id:'operator-A'}},lastSyncAt:null,data:clone(db)};
 let role='finance',commit=true,lost=false,readMode='normal',onConfirm=null,onRead=null;
 const ctx=vm.createContext({
  adminRuntime:rt,Date,Number,String,Error,
  adminReady:()=>rt.status==='ready',
  adminRoleCanSection:x=>x==='finance'&&role==='finance',
  prompt:()=> 'referencia auditoria 493',
  confirm:()=>onConfirm?onConfirm():true,
  toast:x=>toasts.push(String(x)),
  adminPerform:async(action,payload)=>{
   calls.push({action,payload});
   if(commit){
    if(action==='merchant-billing-action'){
      const row=db.merchantBilling.statements[0];row.status='waived';row.waived_at=new Date().toISOString();
    }
    if(action==='merchant-billing-refund'){
      db.merchantBilling.refunds.find(x=>x.id===payload.refundId).status=
       payload.refundAction==='dismiss-excess'?'resolved_excess':'ignored_unrelated';
    }
    if(action==='merchant-billing-payment-event'&&payload.eventAction==='ignore'){
      const e=db.merchantBilling.paymentEvents[0];e.status='ignored';e.payment_request_id=null;
    }
   }
   if(lost)throw new TypeError('ACK lost');
   return {ok:true};
  },
  adminRefresh:async({silent})=>{
   assert.equal(silent,true);reads.push(1);
   if(onRead)return onRead(db,rt);
   if(readMode==='throw')throw Error('GET failed');
   const next=clone(db);
   if(readMode!=='discard'){
    rt.data=next;rt.lastSyncAt=new Date().toISOString();
   }
   return next;
  }
 });
 vm.runInContext(code+'\nthis.ops={waive:adminResolveDailyStatement,refund:adminResolveBillingRefund,event:adminBillingPaymentEventAction};',ctx);
 return {
  rt,db,calls,reads,toasts,
  waive:()=>ctx.ops.waive(merchant,sid,'waive-statement'),
  refund:(id,action)=>ctx.ops.refund(id,action),
  event:action=>ctx.ops.event(eventId,action),
  noWrite:()=>commit=false,lost:()=>lost=true,
  readMode:x=>readMode=x,role:x=>role=x,
  onConfirm:fn=>onConfirm=fn,onRead:fn=>onRead=fn
 };
}
{
 const x=fixture();await x.waive();
 assert.equal(x.calls.length,1);
 assert.equal(x.rt.data.merchantBilling.statements[0].status,'waived');
 assert.match(x.toasts.join(' '),/Fechamento diário abonado e confirmado/);
}
{
 const x=fixture();x.lost();await x.waive();
 assert.equal(x.calls.length,1,'unknown ACK must not produce another write');
 assert.match(x.toasts.join(' '),/abonado e confirmado/);
}
for(const readMode of ['throw','discard']){
 const x=fixture();x.readMode(readMode);await x.waive();
 assert.doesNotMatch(x.toasts.join(' '),/abonado e confirmado/);
 assert.match(x.toasts.join(' '),/não foi confirmada/);
}
{
 const x=fixture();x.noWrite();await x.waive();
 assert.match(x.toasts.join(' '),/não foi confirmada/);
}
{
 const x=fixture();x.onConfirm(()=>{x.rt.session={user:{id:'operator-B'}};return true;});
 await x.waive();assert.equal(x.calls.length,0);
}
{
 const x=fixture();x.role('support');await x.waive();
 assert.equal(x.calls.length,0);
}
{
 const x=fixture();x.onConfirm(()=>{
  x.rt.data.merchantBilling.statements[0].status='paid';return true;
 });
 await x.waive();assert.equal(x.calls.length,0);
}
{
 const x=fixture();x.onRead((db,rt)=>{
  const y=clone(db);y.merchantBilling.statements[0].amount_due_cents=12600;
  rt.data=y;rt.lastSyncAt=new Date().toISOString();return y;
 });await x.waive();assert.match(x.toasts.join(' '),/não foi confirmada/);
}
for(const [id,action,state,success] of [
 [unlinked,'dismiss-unrelated','ignored_unrelated',/não relacionado e confirmado/],
 [excessId,'dismiss-excess','resolved_excess',/registro confirmado/]
]){
 const x=fixture();await x.refund(id,action);
 assert.equal(x.calls.length,1);
 assert.equal(x.rt.data.merchantBilling.refunds.find(r=>r.id===id).status,state);
 assert.match(x.toasts.join(' '),success);
}
{
 const x=fixture();x.noWrite();await x.refund(unlinked,'dismiss-unrelated');
 assert.match(x.toasts.join(' '),/não foi confirmada/);
}
{
 const x=fixture();x.db.merchantBilling.refundRecoveries=[{refund_id:excessId}];x.rt.data=clone(x.db);
 await x.refund(excessId,'dismiss-excess');assert.equal(x.calls.length,0);
}
{
 const x=fixture();await x.refund(excessId,'dismiss-unrelated');assert.equal(x.calls.length,0);
}
{
 const x=fixture();x.lost();await x.refund(excessId,'dismiss-excess');
 assert.equal(x.calls.length,1);assert.match(x.toasts.join(' '),/registro confirmado/);
}
{
 const x=fixture();x.onRead((db,rt)=>{
  const y=clone(db);y.merchantBilling.refunds[1].provider_event_id='foreign';
  rt.data=y;rt.lastSyncAt=new Date().toISOString();return y;
 });await x.refund(excessId,'dismiss-excess');
 assert.match(x.toasts.join(' '),/não foi confirmada/);
}
{
 const x=fixture();x.onConfirm(()=>{x.rt.session={user:{id:'other'}};return true});
 await x.refund(excessId,'dismiss-excess');assert.equal(x.calls.length,0);
}
{
 const x=fixture();await x.event('ignore');
 assert.equal(x.rt.data.merchantBilling.paymentEvents[0].status,'ignored');
 assert.match(x.toasts.join(' '),/ignorado e confirmado/);
}
{
 const x=fixture();x.noWrite();await x.event('ignore');
 assert.match(x.toasts.join(' '),/não foi confirmada/);
}
{
 const x=fixture();x.lost();await x.event('ignore');
 assert.equal(x.calls.length,1);assert.match(x.toasts.join(' '),/ignorado e confirmado/);
}
{
 const x=fixture();await x.event('recheck');
 assert.match(x.toasts.join(' '),/permanece em revisão/);
 assert.doesNotMatch(x.toasts.join(' '),/Conciliação reprocessada/);
}
{
 const x=fixture();x.db.merchantBilling.paymentEvents[0].status='matched_exact';
 await x.event('recheck');assert.match(x.toasts.join(' '),/reconciliado e confirmado/);
}
{
 const x=fixture();x.onRead((db,rt)=>{
  const y=clone(db);y.merchantBilling.paymentEvents[0].amount_cents=9999;
  rt.data=y;rt.lastSyncAt=new Date().toISOString();return y;
 });await x.event('recheck');assert.match(x.toasts.join(' '),/não foi confirmada/);
}
{
 const x=fixture();x.onConfirm(()=>{x.rt.session={user:{id:'other'}};return true});
 await x.event('ignore');assert.equal(x.calls.length,0);
}
{
 const x=fixture(),d=deferred();
 x.onRead(()=>d.promise);
 const pending=x.event('ignore');
 for(let i=0;i<40&&x.reads.length===0;i++)await Promise.resolve();
 assert.equal(x.reads.length,1);
 x.rt.session={user:{id:'operator-B'}};
 const old=x.toasts.length;
 d.resolve(clone(x.db));await pending;
 assert.equal(x.toasts.length,old,'late response cannot report success to new operator');
}
const eventSql=read('supabase/migrations/20261008020000_payment_event_review_lifecycle_v1_84.sql');
const statementSql=read('supabase/migrations/20261007173000_merchant_billing_engine_v1_72.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
assert.match(eventSql,/set status='ignored'/);
assert.match(statementSql,/then 'paid' else 'waived' end/);
assert.match(edge,/rpcName="admin_merchant_billing_payment_event_action"/);
assert.match(edge,/rpcName="admin_merchant_billing_refund_action"/);
assert.match(source,/adminRuntime\.data!==fresh/);
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-finance-resolution-readback-v1-493.mjs'));
console.log('PASS #493: D+1 waiver, refund dismissal/excess, PSP event recheck/ignore: exact applied readback and account isolation.');
