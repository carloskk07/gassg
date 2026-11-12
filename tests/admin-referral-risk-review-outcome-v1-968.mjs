import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ui=read('js/admin.js');
const sql=read('supabase/migrations/20261001134000_referral_fraud_review_authority.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const audit=read('.github/workflows/audit.yml');
assert.match(sql,/admin_referral_review_action\(/);
assert.match(sql,/admin_review_referral_reward\(/);
assert.match(sql,/'riskStatus',p_decision/);
assert.match(sql,/'orderId',p_order_id/);
assert.match(sql,/'ok',true/);
assert.match(sql,/p_idempotency_key/);
assert.match(edge,/rpcName="admin_referral_review_action"/);
assert.match(audit,/node tests\/admin-referral-risk-review-outcome-v1-968\.mjs/);

const start=ui.indexOf('const ADMIN_REFERRAL_REJECTION_REASONS=');
const end=ui.indexOf('async function adminRetryReward(',start);
assert(start>0&&end>start,'referral risk-review UI block missing');
const user='11111111-1111-4111-8111-111111111111';
const order='22222222-2222-4222-8222-222222222222';
const other='33333333-3333-4333-8333-333333333333';
const runtime={status:'ready',actionPending:false,session:{user:{id:user}}};
let role='finance',allowConfirm=true,reviewed=true,reason='duplicate',reply=null,
  calls=[],feedback=[];
const ctx=vm.createContext({
 adminRuntime:runtime,
 adminReady:()=>runtime.status==='ready',
 adminCurrentRole:()=>role,
 document:{getElementById:id=>id==='referral-reviewed-'+order?{checked:reviewed}:
   id==='referral-reason-'+order?{value:reason}:null},
 toast:message=>feedback.push(String(message)),
 confirm:()=>allowConfirm,
 adminPerform:async(action,payload)=>{calls.push({action,payload});return reply;},
 String,Object,Array
});
vm.runInContext(ui.slice(start,end)+'\nthis.review=adminReviewReferral;',ctx);
await ctx.review('invalid','approved');
await ctx.review(order,'unknown');
assert.equal(calls.length,0,'invalid order/decision must not touch wallet or review RPC');

reviewed=false;
await ctx.review(order,'approved');
assert.equal(calls.length,0,'a missing explicit review check forbids approval');
reviewed=true;
role='support';await ctx.review(order,'approved');
assert.equal(calls.length,0,'unauthorized role cannot submit risk review');
role='finance';runtime.actionPending=true;await ctx.review(order,'approved');
assert.equal(calls.length,0,'busy Admin cannot count an absent result as success');
runtime.actionPending=false;
allowConfirm=false;await ctx.review(order,'approved');
assert.equal(calls.length,0,'explicit confirmation is required');
allowConfirm=true;

const successCount=()=>feedback.filter(x=>x.includes('Revisão aprovada;')).length;
const earlier=successCount();
reply=null;
await ctx.review(order,'approved');
assert.equal(calls.length,1);
assert.equal(successCount(),earlier,'null/busy result must not report approval');
for(const bad of [
 {ok:false,orderId:order,riskStatus:'approved'},
 {ok:true,orderId:other,riskStatus:'approved'},
 {ok:true,orderId:order,riskStatus:'rejected'},
 {ok:true,riskStatus:'approved'},
 {ok:true,orderId:order}
]){
 reply=bad;await ctx.review(order,'approved');
 assert.equal(successCount(),earlier,'wrong order, decision or partial success is not proof');
}
reply={ok:true,orderId:order,riskStatus:'approved'};
await ctx.review(order,'approved');
assert.equal(successCount(),earlier+1);
assert(feedback.some(x=>x.includes('depende das demais condições financeiras')),
 'risk approval never represents a cash payout or matured commission');

reason='invalid';let before=calls.length;
await ctx.review(order,'rejected');
assert.equal(calls.length,before,'rejection needs a preapproved documented reason');
reason='duplicate';
reply={ok:true,orderId:order,riskStatus:'rejected',amountCents:500};
await ctx.review(order,'rejected');
assert.equal(calls.at(-1).payload.decision,'rejected');
assert.match(calls.at(-1).payload.notes,/duplicado/);
assert(feedback.some(x=>x.includes('Revisão rejeitada;')),
 'rejected result must be reported as review, not a confirmed bank transaction');

reply={ok:true,orderId:order,riskStatus:'approved'};
feedback=[];calls=[];
ctx.adminPerform=async(action,payload)=>{
 calls.push({action,payload});
 runtime.session={user:{id:other}};
 return {ok:true,orderId:order,riskStatus:'approved'};
};
await ctx.review(order,'approved');
assert.equal(calls.length,1);
assert.equal(successCount(),0,
 'a signed-out owner must not receive another session\'s financial success toast');
console.log('V1.968 PASS: risk-review SQL authority bound to correct order, approved/rejected outcome and same session; no fictional commission maturity or payouts.');
