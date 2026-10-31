import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
const workflow=fs.readFileSync(new URL('../.github/workflows/audit.yml',import.meta.url),'utf8');
const start=source.indexOf('const ADMIN_FINANCE_CHARGE_UUID=');
const end=source.indexOf('\nasync function adminFinanceLabReadinessFromUi(',start);
assert.ok(start>0&&end>start,'Read-only PSP review helpers must be contiguous');
const code=source.slice(start,end);
new vm.Script(code,{filename:'admin-finance-pix-review-batch'});
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const row=(n,status,requestStatus,issues=[])=>({
 chargeId:id(n),status,requestStatus,issues,provider:'mercadopago'
});
const rows=[row(1,'expired','pending'),row(2,'active','pending'),
 row(3,'completed','approved',['SETTLEMENT_EVENT_NOT_FOUND']),
 row(4,'cancelled','pending'),row(5,'active','approved'),
 row(6,'preparing','pending'),row(7,'expired','pending'),
 row(8,'completed','pending'),row(9,'active','pending'),
 {...row(10,'expired','pending'),chargeId:'not-a-uuid'},
 {...row(11,'expired','pending'),provider:'woovi'}];
function setup(items=rows){
 const calls=[],renders=[],errors=[],rt={
  status:'ready',session:{user:{id:'operator-A'}},
  financeLab:{charges:{charges:items},
   chargesLoading:false,providerCheckingId:null,providerBatchPending:false,
   providerChecks:{},providerCheckErrors:{},providerBatchResult:null}
 };
 let role='superadmin',provider=async({chargeId})=>({
  ok:true,source:'mercadopago_order_lookup_v1',
  readOnly:true,chargeId,identifiersAndAmountMatched:true,
  settlementVerified:false,creditIssued:false,financialActionTaken:false,
  providerProcessed:true,providerAdverseState:false,
  providerOrderStatus:'processed',providerPaymentStatus:'processed',
  checkedAt:'2026-10-31T18:00:00Z',nextStep:'Conferir webhook e conta'
 });
 const ctx=vm.createContext({
  adminRuntime:rt,adminReady:()=>rt.status==='ready',
  adminCurrentRole:()=>role,render:()=>renders.push(true),
  adminInvoke:async payload=>{calls.push(payload);return provider(payload)},
  Date,String,Number,Array,Object,Error
 });
 vm.runInContext(code+'\nthis.review={candidates:adminFinanceProviderReviewCandidates,'+
 'batch:adminFinanceLabVerifyPendingBatchFromUi,'+
 'single:adminFinanceLabVerifyProviderFromUi,'+
 'valid:adminFinanceProviderProofValid}',ctx);
 return {ctx,rt,calls,renders,errors,setRole:x=>role=x,setProvider:fn=>provider=fn};
}
{
 const a=setup(),selected=Array.from(a.ctx.review.candidates(a.rt.financeLab));
 assert.equal(selected.length,5,'cap calls at five to fit 6/min backend rate limit');
 assert.deepEqual(selected.map(x=>x.chargeId),
  [id(1),id(7),id(2),id(6),id(8)],
  'expired pending first, then other pending; no cancelled or non-Pix');
 assert.equal(a.ctx.review.candidates({charges:{charges:[]}}).length,0);
 assert.equal(a.ctx.review.candidates(null).length,0);
 await a.ctx.review.batch();
 assert.equal(a.calls.length,5);
 assert.ok(a.calls.every(x=>x.action==='finance-lab-provider-verify'),
  'all PSP operations must use the existing read-only action');
 assert.equal(a.rt.financeLab.providerBatchPending,false);
 assert.equal(a.rt.financeLab.providerBatchResult.checked,5);
 assert.equal(a.rt.financeLab.providerBatchResult.errors,0);
 assert.equal(a.rt.financeLab.providerBatchResult.discrepancies,5,
  'processed remote against local expired/active/preparing must raise anomalies');
 assert.equal(Object.keys(a.rt.financeLab.providerChecks).length,5);
}
{
 const a=setup([row(1,'completed','approved',['SETTLEMENT_EVENT_NOT_FOUND']),
                  row(2,'expired','pending')]);
 a.setProvider(async({chargeId})=>chargeId===id(1)
  ?{ok:true,source:'mercadopago_order_lookup_v1',readOnly:true,
    chargeId,identifiersAndAmountMatched:true,settlementVerified:false,
    creditIssued:false,financialActionTaken:false,
    providerProcessed:false,providerAdverseState:true}
  :{ok:true,source:'mercadopago_order_lookup_v1',readOnly:true,
    chargeId,identifiersAndAmountMatched:true,settlementVerified:true,
    creditIssued:false,financialActionTaken:false,
    providerProcessed:true,providerAdverseState:false});
 await a.ctx.review.batch();
 assert.equal(a.calls.length,2);
 assert.equal(a.rt.financeLab.providerBatchResult.discrepancies,1,
  'processed local charge with PSP reversal must be flagged');
 assert.equal(a.rt.financeLab.providerBatchResult.errors,1,
  'even matching IDs cannot authorize a response claiming settlement');
 assert.equal(a.rt.financeLab.providerBatchResult.checked,1);
 assert.equal(a.rt.financeLab.providerCheckErrors[id(2)].length>0,true);
}
{
 const a=setup([row(1,'expired','pending'),row(2,'active','pending')]);
 let finish;
 a.setProvider(()=>new Promise(resolve=>finish=resolve));
 const pending=a.ctx.review.batch();
 assert.equal(a.calls.length,1);
 a.rt.session={user:{id:'operator-B'}};
 finish({ok:true,source:'mercadopago_order_lookup_v1',
  readOnly:true,chargeId:id(1),identifiersAndAmountMatched:true,
  settlementVerified:false,creditIssued:false,financialActionTaken:false,
  providerProcessed:true,providerAdverseState:false});
 await pending;
 assert.equal(a.calls.length,1,'old account cannot start next verification');
 assert.equal(Object.keys(a.rt.financeLab.providerChecks).length,0,
  'old actor cannot populate a new account with prior PSP evidence');
}
{
 const a=setup([row(1,'expired','pending')]);
 a.setRole('finance');await a.ctx.review.batch();
 assert.equal(a.calls.length,0,'non-superadmin cannot run PSP review');
 a.setRole('superadmin');
 const pending=a.ctx.review.single(id(1));await pending;
 assert.equal(a.calls.length,1,'single PSP check preserved');
 assert.equal(a.rt.financeLab.providerChecks[id(1)].chargeId,id(1));
}
// A failed second PSP lookup must not leave the prior successful result
// visible as if it were the current authority.
{
 const a=setup([row(1,'expired','pending')]);
 a.rt.financeLab.providerChecks[id(1)]={chargeId:id(1),providerProcessed:true};
 a.setProvider(async()=>{throw Error('PSP offline')});
 await a.ctx.review.single(id(1));
 assert.equal(a.rt.financeLab.providerChecks[id(1)],undefined);
 assert.equal(a.rt.financeLab.providerCheckError.chargeId,id(1));
 assert.match(a.rt.financeLab.providerCheckError.message,/PSP offline/);
}
const financeUi=source.slice(source.indexOf('function adminFinanceLabView(d){'),
 source.indexOf('function adminFinanceLabView(d){')+19000);
assert.match(financeUi,/adminFinanceLabVerifyPendingBatchFromUi\(\)/);
assert.match(financeUi,/divergentes|divergência|divergentes/i);
assert.match(financeUi,/\.slice\(0,state\.providerBatchResult\?20:8\)/,
  'after a batch, all provider-reviewed charges must remain visible beyond the initial eight');
assert.match(financeUi,/state\.providerCheckingId\|\|state\.providerBatchPending\?'disabled'/,
  'manual PSP buttons must stay disabled during the batch, not silently ignore clicks');
assert.doesNotMatch(code,/adminPerform\(|merchant-billing-payment-event|merchant-billing-action|create-billing/);
assert.ok(workflow.includes('node tests/admin-finance-provider-batch-v1-493.mjs'));
console.log('TAMÃO #493 PASS — bounded authenticated read-only Pix PSP review, inconsistencies, safe failures and account isolation.');
