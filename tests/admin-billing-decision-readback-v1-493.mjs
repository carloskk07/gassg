import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('js/admin.js');
const edge=read('supabase/functions/admin-ops/index.ts');
const rid='11111111-1111-4111-8111-111111111111';
const eventId='22222222-2222-4222-8222-222222222222';
const original={
 id:rid,request_kind:'package_purchase',status:'pending',
 expected_amount_cents:12590,received_amount_cents:null,payment_method:null,
 reconciliation_key:null,provider_payment_event_id:null
};
const payment={
 id:eventId,status:'matched_exact',payment_request_id:rid,
 provider:'mercadopago',provider_event_id:'evt-provider-900',
 amount_cents:12590,payment_method:'pix',
 reconciliation_key:'E1234567890987654321'
};
const confirmReview={
 confirmed:true,receivedRaw:'125,90',paymentMethod:'pix',
 reconciliationKey:'E1234567890987654321',
 reference:'Extrato bancario e PSP verificados'
};
function extract(name){
 const at=js.indexOf('function '+name+'(');
 const start=at<0?-1:js.lastIndexOf('\n',at)+1;
 assert.ok(start>=0,'Missing '+name);
 const end=js.indexOf('\n}',at);
 assert.ok(end>at,'Missing end '+name);
 return js.slice(start,end+2);
}
const code=['adminNormalizePaymentMethod','adminParseMoneyToCents',
 'adminResolveBillingPaymentRequest'].map(extract).join('\n');
new vm.Script(code);
const deferred=()=>{
 let resolve;
 const promise=new Promise(r=>resolve=r);
 return {resolve,promise};
};
function fixture(){
 const actions=[],reads=[],messages=[];
 let serverRequest={...original},role='finance';
 let doPerform=async (action,decision)=>{
  assert.equal(action,'merchant-billing-payment-request');
  serverRequest={
   ...serverRequest,status:decision.requestAction==='approve'?'approved':'rejected',
   received_amount_cents:decision.receivedAmountCents,
   payment_method:decision.paymentMethod,
   reconciliation_key:decision.reconciliationKey,
   provider_payment_event_id:decision.paymentEventId
  };
  return {ok:true};
 };
 let doRead=async()=>({
  merchantBilling:{paymentRequests:[{...serverRequest}],paymentEvents:[payment]}
 });
 let confirmHandler=()=>true;
 const rt={status:'ready',actionPending:false,refreshSeq:0,
  session:{user:{id:'operator-A'}},
  lastSyncAt:new Date().toISOString(),
  data:{merchantBilling:{paymentRequests:[{...original}],
    paymentEvents:[{...payment}]}}
 };
 const ctx=vm.createContext({
  adminRuntime:rt,Date,Number,String,Error,
  adminReady:()=>rt.status==='ready',
  adminRoleCanSection:key=>key==='finance'&&['finance','superadmin'].includes(role),
  adminMoney:n=>'R$ '+(n/100).toFixed(2),
  adminPaymentMethodLabel:x=>x,
  prompt:(question)=>String(question).includes('Motivo da rejeição')
    ?'Recebimento nao localizado na conciliacao':'',
  confirm:text=>confirmHandler(text),
  toast:text=>messages.push(String(text)),
  adminPerform:async(action,decision)=>{
   actions.push({action,decision});return doPerform(action,decision);
  },
  adminRefresh:async({silent})=>{
   assert.equal(silent,true);
   reads.push('summary');
   const result=await doRead();
   if(result&&result.install!==false){
    rt.refreshSeq++;
    rt.lastSyncAt=new Date().toISOString();
    rt.data=result;
   }
   return result;
  }
 });
 vm.runInContext(code+'\nthis.decide=adminResolveBillingPaymentRequest;',ctx);
 return {ctx,rt,actions,reads,messages,
  decide:(kind='approve',event=null)=>ctx.decide(rid,kind,event,
    kind==='approve'?confirmReview:null),
  server:fn=>doPerform=fn,
  read:fn=>doRead=fn,
  confirm:fn=>confirmHandler=fn,
  getServer:()=>serverRequest,
  role:v=>role=v
 };
}
{
 const x=fixture();
 await x.decide();
 assert.equal(x.actions.length,1);
 assert.equal(x.reads.length,1);
 assert.equal(x.actions[0].decision.receivedAmountCents,12590);
 assert.equal(x.messages.length,1);
 assert.match(x.messages[0],/confirmado e conciliado/);
 assert.equal(x.rt.data.merchantBilling.paymentRequests[0].status,'approved');
 assert.equal(x.rt.data.merchantBilling.paymentRequests[0].received_amount_cents,12590);
}
{
 const x=fixture();
 await x.decide('reject');
 assert.equal(x.actions.length,1);
 assert.equal(x.reads.length,1);
 assert.equal(x.rt.data.merchantBilling.paymentRequests[0].status,'rejected');
 assert.match(x.messages[0],/Rejeição confirmada/);
}
{
 const x=fixture();
 await x.decide('approve',eventId);
 assert.equal(x.actions[0].decision.paymentEventId,eventId);
 assert.equal(x.rt.data.merchantBilling.paymentRequests[0].provider_payment_event_id,eventId);
 assert.match(x.messages[0],/confirmado e conciliado/);
}
{
 const x=fixture();
 x.server(async(_a,d)=>{
  // Server committed; HTTP ACK is lost before the browser sees it.
  x.read(async()=>({merchantBilling:{paymentRequests:[{
    ...original,status:'approved',
    received_amount_cents:d.receivedAmountCents,payment_method:d.paymentMethod,
    reconciliation_key:d.reconciliationKey,provider_payment_event_id:d.paymentEventId
  }],paymentEvents:[payment]}}));
  throw Error('network timeout after commit');
 });
 await x.decide();
 assert.equal(x.actions.length,1,'unknown ACK can only recover by GET');
 assert.equal(x.reads.length,1);
 assert.match(x.messages[0],/confirmado e conciliado/);
}
{
 const x=fixture();
 x.server(async()=>{throw Error('network timeout before write')});
 await x.decide();
 assert.equal(x.actions.length,1);
 assert.equal(x.reads.length,1,'do not retry POST from the decision UI');
 assert.match(x.messages[0],/não foi possível confirmar/i);
 assert.doesNotMatch(x.messages.join(' '),/Pagamento confirmado/);
}
{
 const x=fixture();
 x.read(async()=>({merchantBilling:{paymentRequests:[{...original}],paymentEvents:[payment]}}));
 await x.decide();
 assert.equal(x.actions.length,1);
 assert.match(x.messages[0],/não confirmada na leitura atual/i,
  'RPC ACK alone cannot claim settlement');
}
for(const corrupt of [
 {status:'approved',received_amount_cents:12591},
 {status:'approved',payment_method:'other'},
 {status:'approved',reconciliation_key:'E_FOREIGN'},
 {status:'pending'}
]){
 const x=fixture();
 x.read(async()=>({merchantBilling:{paymentRequests:[{
  ...original,status:'approved',received_amount_cents:12590,payment_method:'pix',
  reconciliation_key:'E1234567890987654321',...corrupt
 }],paymentEvents:[payment]}}));
 await x.decide();
 assert.doesNotMatch(x.messages.join(' '),/Pagamento confirmado/);
}
{
 const x=fixture();
 x.read(async()=>({merchantBilling:{paymentRequests:[],paymentEvents:[]}}));
 await x.decide();
 assert.match(x.messages[0],/não confirmada/,'truncated 300-row sample not proof');
}
{
 const x=fixture();
 const old=x.rt.data;
 x.read(async()=>({install:false,
  merchantBilling:{paymentRequests:[{...original,status:'approved'}],paymentEvents:[]}}));
 await x.decide();
 assert.equal(x.rt.data,old,'discarded summary never installed');
 assert.match(x.messages[0],/não confirmada/);
}
{
 const x=fixture();
 x.confirm(()=>{x.rt.session={user:{id:'operator-B'}};return true});
 await x.decide();
 assert.equal(x.actions.length,0,'prompt cannot approve for a new account');
}
{
 const x=fixture(),gate=deferred();
 x.server(async()=>gate.promise);
 const pending=x.decide();
 assert.equal(x.actions.length,1);
 const seen=x.messages.length;
 x.rt.session={user:{id:'operator-B'}};
 x.rt.data={merchantBilling:{paymentRequests:[{...original}],paymentEvents:[]}};
 gate.resolve({ok:true});
 await pending;
 assert.equal(x.reads.length,0,'old write completion must not read new account');
 assert.equal(x.messages.length,seen,'no success in account B');
}
{
 const x=fixture(),gate=deferred();
 x.read(async()=>gate.promise);
 const pending=x.decide();
 // The decision awaits the RPC before starting its independent GET.
 // Drain bounded microtasks so the race is inserted DURING the read,
 // instead of changing accounts before that read starts.
 for(let i=0;i<16&&x.reads.length===0;i++)await Promise.resolve();
 assert.equal(x.reads.length,1);
 x.rt.session={user:{id:'operator-B'}};
 const before=x.messages.length;
 gate.resolve({merchantBilling:{paymentRequests:[{
  ...original,status:'approved',received_amount_cents:12590,
  payment_method:'pix',reconciliation_key:'E1234567890987654321'
 }],paymentEvents:[]}});
 await pending;
 assert.equal(x.messages.length,before,'late readback must not confirm in account B');
}
{
 const x=fixture();x.rt.actionPending=true;
 await x.decide();
 assert.equal(x.actions.length,0);
}
{
 const x=fixture();x.role('support');
 await x.decide();
 assert.equal(x.actions.length,0);
}
{
 const x=fixture();
 x.confirm(()=>{
  x.rt.data.merchantBilling.paymentRequests[0].status='approved';
  return true;
 });
 await x.decide();
 assert.equal(x.actions.length,0,'stale confirmation must not send financial RPC');
 assert.match(x.messages[0],/mudou/i);
}
assert.match(edge,/rpcName="admin_merchant_billing_payment_request_action"/,
 'backend financial write must be the existing idempotent RPC');
assert.match(edge,/p_idempotency_key:idempotencyKey/);
assert.match(edge,/p_request_hash:requestHash/);
assert.match(edge,/\.order\("requested_at",\{ascending:false\}\)\s*\.limit\(300\)/,
 'summary is capped: missing row cannot authorize success');
assert.match(code,/adminRuntime\.data!==fresh/,'returned JSON alone is not applied proof');
assert.ok(read('.github/workflows/audit.yml').includes(
 'node tests/admin-billing-decision-readback-v1-493.mjs'));
console.log('PASS #493 financial request approval/rejection: authenticated applied summary proof, 1 write, lost ACK read-only recovery, exact amount+PSP ID, logout and stale snapshots.');
