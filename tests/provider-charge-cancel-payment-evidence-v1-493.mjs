import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the actual production helper with an isolated in-memory PSP.
// No API calls, real payment records, external POSTs or money movement.
const file=fs.readFileSync(new URL(
  '../supabase/functions/_shared/provider-charge-cancel.js',import.meta.url),'utf8');
const start=file.indexOf('async function fetchMercadoPagoOrder(');
const end=file.indexOf('export async function cancelProviderChargesForPaymentRequest(',start);
assert.ok(start>0&&end>start,'production cancellation routine present');
const source=file.slice(start,end);
new vm.Script(source);

const orderId='TEST-ORDER-001';
const correlation='11111111-1111-4111-8111-111111111111';
const baseline={
  id:orderId,status:'action_required',external_reference:correlation,
  total_amount:'300.00',total_paid_amount:'0',currency_id:'BRL',live_mode:true,
  transactions:{payments:[{id:'TEST-PIX-001',amount:'300.00',
    status:'pending',live_mode:true,payment_method:{id:'pix',type:'bank_transfer'}}],
    refunds:[]}
};
let remote=structuredClone(baseline);
let calls=[],postHttpStatus=200,afterPost=()=>{};
const context=vm.createContext({
  Deno:{env:{get:()=> 'TEST_ONLY_ACCESS_TOKEN_NO_REAL_CONNECTION_1234'}},
  mercadoPagoConfigured:()=>true,
  moneyToCents:value=>{
    if(value==null||value==='')return null;
    const n=Number(value)*100;
    return Number.isSafeInteger(n)?n:null;
  },
  mercadoPagoFetch:async(path,opts)=>{
    calls.push({path,method:opts.method??'GET'});
    if(opts.method==='POST'){
      afterPost();
      return {ok:postHttpStatus===200,status:postHttpStatus,payload:{}};
    }
    return {ok:true,status:200,payload:structuredClone(remote)};
  },
  readMercadoPagoJson:async r=>r.payload,
  Date,Number,String,Array,Error,encodeURIComponent,PROVIDER_CANCEL_TIMEOUT_MS:4500
});
vm.runInContext(source+
  '\nthis.cancelMercadoPagoCharge=cancelMercadoPagoCharge;'+
  '\nthis.mercadoPagoPixCancelEvidence=mercadoPagoPixCancelEvidence;',context);
const invoke=()=>context.cancelMercadoPagoCharge(orderId,correlation,30000);
const reset=()=>{remote=structuredClone(baseline);calls=[];
  postHttpStatus=200;
  afterPost=()=>{remote.status='canceled';
    remote.transactions.payments[0].status='canceled';};
};
const posts=()=>calls.filter(c=>c.method==='POST').length;
const blocked=async(label,mutate,reason)=>{
  reset();mutate(remote);
  const r=await invoke();
  assert.equal(r.ok,false,label);
  assert.equal(r.reason,reason,label);
  assert.equal(posts(),0,label+': never call external POST on contradictory proof');
};
reset();
let r=await invoke();
assert.equal(r.ok,true);
assert.equal(posts(),1);
assert.equal(calls.filter(c=>c.method==='GET').length,2);
reset();remote.status='canceled';remote.transactions.payments[0].status='canceled';
r=await invoke();
assert.equal(r.ok,true);
assert.equal(posts(),0);

const scenarios=[
  ['pending Order, processed Pix',o=>o.transactions.payments[0].status='processed','MERCADOPAGO_PAYMENT_ALREADY_RECEIVED'],
  ['cancelled Order, processed Pix',o=>{o.status='canceled';o.transactions.payments[0].status='processed';},'MERCADOPAGO_PAYMENT_ALREADY_RECEIVED'],
  ['cancelled Order, pending Pix',o=>o.status='canceled','MERCADOPAGO_CANCEL_STATUS_CONFLICT'],
  ['processed Order, pending Pix',o=>o.status='processed','MERCADOPAGO_PAYMENT_ALREADY_RECEIVED'],
  ['paid amount despite pending status',o=>o.total_paid_amount=300,'MERCADOPAGO_PAYMENT_ALREADY_RECEIVED'],
  ['provider refund in flight',o=>o.transactions.refunds=[{status:'processing',amount:'50.00'}],'MERCADOPAGO_CANCEL_REFUND_REVIEW_REQUIRED'],
  ['adverse Pix status_detail',o=>o.transactions.payments[0].status_detail='charged_back','MERCADOPAGO_PAYMENT_ALREADY_RECEIVED'],
  ['missing transaction amount',o=>delete o.transactions.payments[0].amount,'MERCADOPAGO_CANCEL_PIX_BINDING_MISMATCH'],
  ['wrong transaction amount',o=>o.transactions.payments[0].amount='299.99','MERCADOPAGO_CANCEL_PIX_BINDING_MISMATCH'],
  ['non-Pix payment',o=>o.transactions.payments[0].payment_method={id:'visa',type:'credit_card'},'MERCADOPAGO_CANCEL_PIX_BINDING_MISMATCH'],
  ['sandbox Order',o=>o.live_mode=false,'MERCADOPAGO_CANCEL_PIX_BINDING_MISMATCH'],
  ['sandbox Pix',o=>o.transactions.payments[0].live_mode=false,'MERCADOPAGO_CANCEL_PIX_BINDING_MISMATCH'],
  ['missing Pix identity',o=>o.transactions.payments[0].id='','MERCADOPAGO_CANCEL_PIX_BINDING_MISMATCH'],
  ['multiple payments',o=>o.transactions.payments.push({...o.transactions.payments[0],id:'SECOND'}),'MERCADOPAGO_CANCEL_PIX_NOT_UNIQUE'],
  ['missing payments',o=>o.transactions.payments=[],'MERCADOPAGO_CANCEL_PIX_NOT_UNIQUE'],
  ['missing payment status',o=>delete o.transactions.payments[0].status,'MERCADOPAGO_CANCEL_STATUS_CONFLICT'],
  ['wrong external reference',o=>o.external_reference='other','MERCADOPAGO_CANCEL_BINDING_MISMATCH'],
  ['wrong returned Order identity',o=>o.id='FOREIGN-ORDER','MERCADOPAGO_CANCEL_BINDING_MISMATCH'],
  ['wrong order amount',o=>o.total_amount='299.99','MERCADOPAGO_CANCEL_BINDING_MISMATCH'],
  ['contradictory currency',o=>o.currency='USD','MERCADOPAGO_CANCEL_PIX_BINDING_MISMATCH'],
  ['malformed received money',o=>o.total_paid_amount='NaN','MERCADOPAGO_CANCEL_PIX_BINDING_MISMATCH']
];
for(const [name,mutate,reason] of scenarios)await blocked(name,mutate,reason);

reset();afterPost=()=>{
  remote.status='canceled';remote.transactions.payments[0].status='processed';
};
r=await invoke();
assert.equal(r.ok,false);
assert.equal(r.reason,'MERCADOPAGO_PAYMENT_ALREADY_RECEIVED');
assert.equal(posts(),1,'post-cancel processed Pix must NEVER confirm cancellation');
reset();afterPost=()=>{remote.status='canceled';};
r=await invoke();
assert.equal(r.ok,false);
assert.equal(r.reason,'MERCADOPAGO_CANCEL_STATUS_CONFLICT');
assert.equal(posts(),1,'post-cancel pending Pix not proof of cancellation');
reset();postHttpStatus=409;afterPost=()=>{
  remote.status='canceled';remote.transactions.payments[0].status='processed';
};
r=await invoke();
assert.equal(r.ok,false);
assert.equal(r.reason,'MERCADOPAGO_PAYMENT_ALREADY_RECEIVED');
assert.equal(posts(),1,'HTTP 409 cannot substitute remote cancellation proof');

console.log('PASS: Mercado Pago cancellation checks actual Pix status before and after remote cancel (mock only)');
