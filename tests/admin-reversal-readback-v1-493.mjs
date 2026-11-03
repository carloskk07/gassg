import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('js/admin.js');
const edge=read('supabase/functions/admin-ops/index.ts');
const migration=read('supabase/migrations/20261016235500_reversal_adjustment_snapshot_integrity_v1_332.sql');
function extract(n){
 const i=js.search(new RegExp('(?:async )?function '+n+'\\('));
 assert.ok(i>=0,'missing '+n);
 const end=js.indexOf('\n}',i);
 assert.ok(end>i);
 return js.slice(i,end+2);
}
const source=['adminFinanceDecisionScope','adminReverseOrder'].map(extract).join('\n');
new vm.Script(source);
const ORDER='11111111-1111-4111-8111-111111111111';
const MERCHANT='22222222-2222-4222-8222-222222222222';
const other='33333333-3333-4333-8333-333333333333';
const settled={
 type:'order',id:ORDER,order:{
  id:ORDER,status:'SETTLED',financial_state:'settled',
  financial_reversed_at:null,merchant_id:MERCHANT,total_cents:14590,
  settled_at:'2026-11-02T15:00:00.000Z'
 },
 finance:{
  receivable:{order_id:ORDER,merchant_id:MERCHANT,status:'paid',platform_fee_cents:400},
  reimbursement:{order_id:ORDER,merchant_id:MERCHANT,status:'paid',cashback_cents:150},
  adjustments:[]
 }
};
const clone=x=>structuredClone(x);
const defer=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve}};
function fixture(){
 const db=clone(settled),calls=[],toasts=[],reads=[];
 const rt={status:'ready',requested:true,actionPending:false,session:{user:{id:'operator-A'}},reverseOrderPending:null};
 let role='finance',grant=true,confirmed=true,typed=true,committed=true,ackLost=false,reader=null,performer=null;
 const ctx=vm.createContext({
  adminRuntime:rt,Date,Number,String,Error,
  adminReady:()=>rt.status==='ready',
  adminRoleCanSection:x=>grant&&role==='finance'&&x==='finance',
  document:{querySelector:s=>({value:{
   '#admin-reverse-order':ORDER,
   '#admin-reverse-reason':'Duplicidade operacional comprovada',
   '#admin-reverse-ref':'CI-493-AUDIT'
  }[s]||''})},
  confirm:()=>confirmed,
  adminRequireTypedConfirmation:()=>typed,
  toast:x=>toasts.push(String(x)),
  adminInvoke:async input=>{
   assert.equal(input.action,'entity-detail');
   assert.equal(input.entityType,'order');
   assert.equal(input.entityId,ORDER);
   reads.push('detail');
   if(reader)return reader(db,reads.length);
   return clone(db);
  },
  adminPerform:async(action,payload)=>{
   calls.push({action,payload});
   if(performer)return performer(db,action,payload);
   if(committed){
    db.order.financial_state='reversed';
    db.order.financial_reversed_at=new Date().toISOString();
    db.finance.receivable.status='reversed';
    db.finance.reimbursement.status='reversed';
    db.finance.adjustments=[{
     order_id:ORDER,merchant_id:MERCHANT,
     adjustment_type:'platform_fee_refund_due',amount_cents:400
    }];
   }
   if(ackLost)throw new TypeError('ACK lost after reversal');
   return {ok:true,orderId:ORDER,financialState:'reversed'};
  }
 });
 vm.runInContext(source+'\nthis.reverse=adminReverseOrder;',ctx);
 return {rt,db,calls,toasts,reads,run:()=>ctx.reverse(),
  role:v=>role=v,grant:v=>grant=v,confirmed:v=>confirmed=v,
  typed:v=>typed=v,committed:v=>committed=v,ackLost:()=>ackLost=true,
  read:fn=>reader=fn,perform:fn=>performer=fn
 };
}
{
 const x=fixture();
 await x.run();
 assert.equal(x.calls.length,1);
 assert.equal(x.calls[0].action,'reverse-order');
 assert.equal(x.calls[0].payload.orderId,ORDER);
 assert.equal(x.reads.length,2,'read-only preflight + exact post-reversal proof');
 assert.equal(x.db.order.financial_state,'reversed');
 assert.match(x.toasts.join(' '),/Reversão financeira registrada e confirmada/);
 assert.equal(x.rt.reverseOrderPending,null);
}
{
 const x=fixture();x.ackLost();
 await x.run();assert.equal(x.calls.length,1,'no second POST after lost ACK');
 assert.match(x.toasts.join(' '),/Reversão financeira registrada e confirmada/);
}
{
 const x=fixture();x.committed(false);await x.run();
 assert.doesNotMatch(x.toasts.join(' '),/Reversão financeira registrada e confirmada/);
 assert.match(x.toasts.join(' '),/sem confirmação atual/);
}
{
 const x=fixture();x.read((_db,n)=>n===1?clone(settled):Promise.reject(Error('GET failed')));
 await x.run();
 assert.match(x.toasts.join(' '),/sem confirmação atual/);
}
for(const change of [
 {order:{merchant_id:other}},
 {order:{total_cents:14591}},
 {order:{financial_state:'settled'}},
 {order:{financial_reversed_at:null}},
 {finance:{receivable:{order_id:ORDER,status:'paid'}}},
 {finance:{reimbursement:{order_id:ORDER,status:'paid'}}},
 {finance:{adjustments:[{order_id:other,merchant_id:MERCHANT,amount_cents:400}]}}
]){
 const x=fixture();
 x.read((db,n)=>{
  const next=n===1?clone(settled):clone(db);
  if(n===2){
   if(change.order)Object.assign(next.order,change.order);
   if(change.finance)Object.assign(next.finance,change.finance);
  }
  return next;
 });
 await x.run();
 assert.doesNotMatch(x.toasts.join(' '),/Reversão financeira registrada e confirmada/,
  'invalid proof '+JSON.stringify(change));
}
{
 const x=fixture();x.db.order.financial_state='reversed';x.db.order.financial_reversed_at=new Date().toISOString();
 await x.run();
 assert.equal(x.calls.length,0,'already-reversed order must not be reversed again');
}
{
 const x=fixture();x.db.order.status='CANCELLED';
 await x.run();assert.equal(x.calls.length,0);
}
{
 const x=fixture();x.role('support');await x.run();assert.equal(x.calls.length,0);
}
{
 const x=fixture();x.rt.actionPending=true;await x.run();assert.equal(x.calls.length,0);
}
{
 const x=fixture();x.confirmed(false);await x.run();assert.equal(x.calls.length,0);
}
{
 const x=fixture();x.typed(false);await x.run();assert.equal(x.calls.length,0);
}
{
 const x=fixture();
 x.read(async(db,n)=>{
  const result=clone(db);
  if(n===1)x.rt.session={user:{id:'operator-B'}};
  return result;
 });
 await x.run();assert.equal(x.calls.length,0,'operator switched during preflight');
}
{
 const x=fixture(),gate=defer();
 x.perform(()=>gate.promise);
 const p=x.run();
 // Wait for exact preflight to finish, confirm, then financial POST to begin.
 for(let i=0;i<30&&x.calls.length===0;i++)await Promise.resolve();
 assert.equal(x.calls.length,1);
 x.rt.session={user:{id:'operator-B'}};
 const before=x.toasts.length;
 gate.resolve({ok:true});
 await p;
 assert.equal(x.toasts.length,before,'old ACK must not announce success to another account');
}
{
 const x=fixture(),gate=defer();
 x.read((db,n)=>n===1?clone(db):gate.promise);
 const p=x.run();
 for(let i=0;i<40&&x.reads.length<2;i++)await Promise.resolve();
 assert.equal(x.reads.length,2);
 x.rt.session={user:{id:'operator-B'}};
 const previous=x.toasts.length;
 gate.resolve(clone(x.db));
 await p;
 assert.equal(x.toasts.length,previous,'old readback may not announce reversal for another account');
}
{
 const x=fixture(),gate=defer();
 x.perform(()=>gate.promise);
 const p=x.run();
 for(let i=0;i<30&&x.calls.length===0;i++)await Promise.resolve();
 await x.run();
 assert.equal(x.calls.length,1,'same actor cannot initiate a second in-flight reversal');
 gate.resolve({ok:true});
 await p;
}
assert.match(edge,/entityType,entityId/);
assert.match(edge,/financial_state,financial_reversed_at/);
assert.match(migration,/set financial_state='reversed'/);
assert.match(migration,/update public\.order_reward_grants/);
assert.match(migration,/update public\.platform_receivables/);
assert.match(migration,/update public\.merchant_cashback_reimbursements/);
assert.match(source,/adminInvoke\(\{action:'entity-detail',entityType:'order',entityId:orderId\}\)/);
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-reversal-readback-v1-493.mjs'));
console.log('PASS #493: settled-order reversal requires exact authenticated pre/post financial proof, no duplicate writes, session isolation, and inconsistent ledger fail-closed.');
