import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('js/admin.js');
const funcs=['adminFinanceDecisionScope','adminFinancialLedgerRecord',
 'adminFinancialDetailRecord','adminFinancialSameFact','adminFinancial'];
const code=funcs.map(name=>{
 const i=js.search(new RegExp('(?:async )?function '+name+'\\('));
 assert.ok(i>=0,'function missing: '+name);
 const end=js.indexOf('\n}',i);
 assert.ok(end>i);
 return js.slice(i,end+2);
}).join('\n');
new vm.Script(code);
const ORDER='11111111-1111-4111-8111-111111111111';
const MERCHANT='22222222-2222-4222-8222-222222222222';
const ADJUSTMENT='33333333-3333-4333-8333-333333333333';
const ref='E2E-EXTRATO-493-VERIFICADO';
const copy=x=>structuredClone(x);
const baseline={
 receivable:{order_id:ORDER,merchant_id:MERCHANT,status:'open',
  platform_fee_cents:450,paid_at:null,waived_at:null,
  resolved_by:null,resolution_reference:null},
 reimbursement:{order_id:ORDER,merchant_id:MERCHANT,status:'open',
  cashback_cents:200,paid_at:null,resolved_by:null,resolution_reference:null},
 adjustments:[{id:ADJUSTMENT,order_id:ORDER,merchant_id:MERCHANT,status:'open',
  amount_cents:175,adjustment_type:'platform_fee_refund_due',
  direction:'platform_owes_merchant',settled_at:null,
  resolved_by:null,resolution_reference:null}]
};
const KIND={
 platform_receivable:{amount:'platform_fee_cents',section:'receivables',detail:'receivable'},
 cashback_reimbursement:{amount:'cashback_cents',section:'cashbackReimbursements',detail:'reimbursement'},
 settlement_adjustment:{amount:'amount_cents',section:'adjustments',detail:'adjustments'}
};
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
function fixture(){
 const db={type:'order',id:ORDER,
  order:{id:ORDER,merchant_id:MERCHANT,status:'SETTLED',financial_state:'settled'},
  finance:copy(baseline)};
 const summary={finance:{
  receivables:[copy(baseline.receivable)],
  cashbackReimbursements:[{...copy(baseline.reimbursement),couponBacked:false}],
  adjustments:copy(baseline.adjustments)}};
 const rt={requested:true,status:'ready',session:{user:{id:'finance-A'}},
  actionPending:false,financeDecisionPending:null,data:copy(summary)};
 const calls=[],toasts=[],reads=[],typed=[];
 let role='finance',approve=true,typedApprove=true,enterRef=ref,
     changeOnConfirm=null,changeOnTyped=null,onRead=null,onPost=null,
     commit=true,ackLost=false;
 const ctx=vm.createContext({
  adminRuntime:rt,Date,Number,String,Error,
  adminReady:()=>rt.status==='ready',
  adminRoleCanSection:s=>s==='finance'&&['finance','superadmin'].includes(role),
  prompt:q=>enterRef,confirm:q=>{
   if(changeOnConfirm)changeOnConfirm();return approve;
  },
  adminRequireTypedConfirmation:q=>{
   typed.push(q);
   if(changeOnTyped)changeOnTyped();
   return typedApprove;
  },
  toast:x=>toasts.push(String(x)),
  adminInvoke:async body=>{
   assert.equal(body.action,'entity-detail');
   assert.equal(body.entityType,'order');
   assert.equal(body.entityId,ORDER);
   reads.push('detail');
   return onRead?onRead(db,reads.length,rt):copy(db);
  },
  adminPerform:async(action,payload)=>{
   calls.push({action,payload});
   if(onPost)return onPost(action,payload,db,rt);
   if(commit){
    const kind=payload.kind,act=payload.financialAction;
    let row=kind==='platform_receivable'?db.finance.receivable:
      kind==='cashback_reimbursement'?db.finance.reimbursement:
      db.finance.adjustments[0];
    row.status=act;
    row.resolved_by='finance-A';
    row.resolution_reference=payload.reference;
    if(kind==='settlement_adjustment')row.settled_at=new Date().toISOString();
    else if(act==='paid')row.paid_at=new Date().toISOString();
    else row.waived_at=new Date().toISOString();
   }
   if(ackLost)throw new TypeError('HTTP ACK lost');
   return {ok:true};
  }
 });
 vm.runInContext(code+'\nthis.record=adminFinancial;',ctx);
 return {
  db,rt,calls,toasts,reads,typed,
  act:(kind='platform_receivable',action='paid')=>
   ctx.record(kind,kind==='settlement_adjustment'?ADJUSTMENT:ORDER,action),
  role:x=>role=x,
  reference:x=>enterRef=x,
  confirm:x=>approve=x,
  typedConfirm:x=>typedApprove=x,
  onConfirm:fn=>changeOnConfirm=fn,
  onTyped:fn=>changeOnTyped=fn,
  read:fn=>onRead=fn,
  post:fn=>onPost=fn,
  noCommit:()=>commit=false,
  loseAck:()=>ackLost=true
 };
}
for(const [kind,action,key] of [
 ['platform_receivable','paid','paid_at'],
 ['platform_receivable','waived','waived_at'],
 ['cashback_reimbursement','paid','paid_at'],
 ['settlement_adjustment','paid','settled_at'],
 ['settlement_adjustment','waived','settled_at']
]){
 const x=fixture();await x.act(kind,action);
 assert.equal(x.calls.length,1,kind+': exactly one financial POST');
 assert.equal(x.reads.length,2,kind+': exact pre and post GET');
 assert.equal(x.calls[0].action,'financial-action');
 assert.equal(x.calls[0].payload.reference,ref);
 assert.match(x.typed[0],action==='paid'?/^PAGO /:/^ABONAR /);
 const row=kind==='platform_receivable'?x.db.finance.receivable:
   kind==='cashback_reimbursement'?x.db.finance.reimbursement:
   x.db.finance.adjustments[0];
 assert.equal(row.status,action);
 assert.ok(row[key]);
 assert.match(x.toasts.join(' '),action==='paid'?
  /Quitação manual confirmada no registro contábil/:/Abono confirmado no registro contábil/);
 assert.equal(x.rt.financeDecisionPending,null,'lock released');
}
{
 const x=fixture();x.loseAck();await x.act();
 assert.equal(x.calls.length,1,'ACK loss must recover through GET, never a second POST');
 assert.match(x.toasts.join(' '),/Quitação manual confirmada/);
}
{
 const x=fixture();x.noCommit();await x.act();
 assert.equal(x.calls.length,1);
 assert.match(x.toasts.join(' '),/Resultado financeiro não confirmado/);
 assert.doesNotMatch(x.toasts.join(' '),/Quitação manual confirmada/);
}
{
 const x=fixture();x.read((db,index)=>index===2?null:copy(db));
 await x.act();
 assert.match(x.toasts.join(' '),/não confirmado/);
}
{
 const x=fixture();x.read((db,index)=>{
  const d=copy(db);
  if(index===2)d.finance.receivable.platform_fee_cents+=1;
  return d;
 });await x.act();
 assert.match(x.toasts.join(' '),/não confirmado/,'amount drift cannot certify fee paid');
}
{
 const x=fixture();x.read((db,index)=>{
  const d=copy(db);
  if(index===2)d.finance.receivable.resolved_by='another-user';
  return d;
 });await x.act();
 assert.match(x.toasts.join(' '),/não confirmado/,'different operator cannot claim this mutation');
}
{
 const x=fixture();x.read((db,index)=>{
  const d=copy(db);
  if(index===2)d.finance.receivable.resolution_reference='OTHER-EXTRACT';
  return d;
 });await x.act();
 assert.match(x.toasts.join(' '),/não confirmado/,'different bank reference is not exact proof');
}
{
 const x=fixture();x.read((db,index)=>{
  const d=copy(db);
  if(index===2)d.id='99999999-9999-4999-8999-999999999999';
  return d;
 });await x.act();
 assert.match(x.toasts.join(' '),/não confirmado/);
}
{
 const x=fixture();x.read((db,index)=>{
  const d=copy(db);
  if(index===2)d.finance.receivable=null;
  return d;
 });await x.act();
 assert.match(x.toasts.join(' '),/não confirmado/,'missing row is not settlement evidence');
}
{
 const x=fixture();x.read((db,index)=>{
  const d=copy(db);
  if(index===1)d.finance.receivable.status='paid';
  return d;
 });await x.act();
 assert.equal(x.calls.length,0,'stale browser tab must not re-pay a closed fee');
 assert.match(x.toasts.join(' '),/lançamento mudou/i);
}
{
 const x=fixture();x.onConfirm(()=>{x.rt.session={user:{id:'finance-B'}}});
 await x.act();assert.equal(x.calls.length,0);
}
{
 const x=fixture();x.onTyped(()=>{x.rt.session={user:{id:'finance-B'}}});
 await x.act();assert.equal(x.calls.length,0);
}
{
 const x=fixture();x.post(async()=>{x.rt.session={user:{id:'finance-B'}};throw Error('timeout')});
 await x.act();assert.equal(x.reads.length,1);
 assert.doesNotMatch(x.toasts.join(' '),/confirmada/i);
}
{
 const x=fixture();x.reference('  ');await x.act();
 assert.equal(x.calls.length,0);
 assert.equal(x.reads.length,0);
 assert.match(x.toasts.join(' '),/referência auditável/);
}
{
 const x=fixture();x.reference(null);await x.act();
 assert.equal(x.calls.length,0);
}
{
 const x=fixture();x.confirm(false);await x.act();
 assert.equal(x.calls.length,0);
}
{
 const x=fixture();x.typedConfirm(false);await x.act();
 assert.equal(x.calls.length,0);
}
{
 const x=fixture();x.role('support');await x.act();
 assert.equal(x.calls.length,0);
}
{
 const x=fixture();x.rt.actionPending=true;await x.act();
 assert.equal(x.calls.length,0);
}
{
 const x=fixture();x.rt.data.finance.cashbackReimbursements[0].couponBacked=true;
 await x.act('cashback_reimbursement','paid');
 assert.equal(x.calls.length,0,'coupon-backed cash obligation not manually discharged');
}
{
 const x=fixture();delete x.rt.data.finance.cashbackReimbursements[0].couponBacked;
 await x.act('cashback_reimbursement','paid');
 assert.equal(x.calls.length,0,'unknown coupon provenance is fail-closed');
}
{
 const x=fixture();await x.act('cashback_reimbursement','waived');
 assert.equal(x.calls.length,0);
}
{
 const x=fixture();const gate=defer();
 x.read(async(db,index)=>index===1?gate.promise:copy(db));
 const first=x.act();
 for(let i=0;i<20&&x.reads.length<1;i++)await Promise.resolve();
 assert.equal(x.reads.length,1);
 await x.act();
 assert.equal(x.calls.length,0,'same actor concurrent financial actions blocked');
 gate.resolve(copy(x.db));
 await first;
 assert.equal(x.rt.financeDecisionPending,null);
}
assert.match(js,/adminInvoke\(\{action:'entity-detail',entityType:'order',entityId:snapshot\.order_id\}\)/);
assert.match(js,/adminRuntime\.financeDecisionPending=lock/);
assert.match(read('supabase/functions/admin-ops/index.ts'),/COUPON_REIMBURSEMENT_EXTERNAL_PROOF_REQUIRED/);
assert.match(read('supabase/migrations/20261001121000_admin_action_idempotency.sql'),/public\.admin_financial_action/);
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-general-finance-ledger-proof-v1-493.mjs'));
console.log('PASS #493: Admin three general finance ledgers, paid/waived, exact order detail, reference, operator, lost ACK, coupon gate, concurrent actions.');
