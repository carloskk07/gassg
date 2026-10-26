import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const file=fs.readFileSync(new URL('../supabase/functions/billing-payment-webhook-mercadopago/index.ts',import.meta.url),'utf8');
const start=file.indexOf('async function handlePlatformBillingOrder(');
const end=file.indexOf('// The SAME production Mercado Pago webhook',start);
assert.ok(start>0&&end>start,'existing production billing handler must be tested');
const source=file.slice(start,end)
  .replaceAll('admin:any','admin')
  .replaceAll('dataId:string','dataId')
  .replaceAll('body:any','body')
  .replaceAll('accessToken:string','accessToken')
  .replaceAll('const patch:any','const patch')
  .replaceAll('(refund:any)=>','(refund)=>')
  .replaceAll('(sum:number,refund:any)=>','(sum,refund)=>');
new vm.Script(source);

const orderId='ORD01STABLEPAYMENT00001';
const correlation='11111111-1111-4111-8111-111111111111';
const amountCents=30000;
const charge={id:'22222222-2222-4222-8222-222222222222',
  payment_request_id:'33333333-3333-4333-8333-333333333333',
  merchant_id:'44444444-4444-4444-8444-444444444444',
  provider:'mercadopago',currency:'BRL',status:'active',
  amount_cents:amountCents,correlation_id:correlation,provider_charge_id:orderId};
const baseline={
  id:orderId,status:'processed',status_detail:'accredited',live_mode:true,
  total_amount:'300.00',currency_id:'BRL',external_reference:correlation,
  transactions:{payments:[{id:'PAY01STABLEPAYMENT000001',amount:'300.00',
    status:'processed',status_detail:'accredited',
    payment_method:{id:'pix',type:'bank_transfer'}}],refunds:[]}
};
let remote=structuredClone(baseline);
const calls={payment:[],refund:[],errors:[]};
const admin={
  from(table){
    return {
      select(){return this;},
      eq(){return this;},
      maybeSingle:async()=>{
        if(table==='clube_coupon_paid_invoices')return {data:null,error:null};
        if(table==='merchant_billing_provider_charges')return {data:charge,error:null};
        throw Error('Unexpected table '+table);
      },
      update(){return this;},
      in(){return this;}
    };
  },
  rpc:async (fn,args)=>{
    assert.equal(fn,'merchant_billing_provider_charge_record_error');
    assert.equal(args.p_charge_id,charge.id);
    calls.errors.push(args.p_error_code);
    return {data:{},error:null};
  }
};
const ctx=vm.createContext({
  URL,Number,Date,String,Array,
  UUID_RE:/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[89ab0-9a-f]{12}$/i,
  mercadoPagoConfigured:()=>true,
  fetchProviderOrder:async()=>({response:{ok:true,status:200},data:remote}),
  json:(body,status=200)=>({body,status}),
  billingPixPayment:order=>{
    const payments=order?.transactions?.payments??[];
    return payments.find(x=>x?.payment_method?.id==='pix'&&x?.payment_method?.type==='bank_transfer')
      ??payments[0]??null;
  },
  moneyToCents:value=>{
    const n=Number(value),cent=n*100;
    return Number.isFinite(cent)&&Number.isInteger(cent)?cent:null;
  },
  safeOccurredAt:()=>new Date().toISOString(),
  ingestPlatformPayment:async (_admin,order,c,at)=>{
    calls.payment.push({order,c,at});
    return {data:{status:'matched_exact'},reconciliationKey:'mp-order:'+orderId};
  },
  ingestPlatformRefunds:async (_admin,order,key,at)=>{
    calls.refund.push({order,key,at});
    return (order.transactions.refunds??[]).map(r=>({refundId:r.id}));
  }
});
vm.runInContext(source+'\nthis.handlePlatformBillingOrder=handlePlatformBillingOrder;',ctx);
const run=()=>ctx.handlePlatformBillingOrder(admin,orderId,{},'production-token');
const reset=()=>{remote=structuredClone(baseline);calls.payment=[];calls.refund=[];calls.errors=[];};
let result=await run();
assert.equal(result.status,200);
assert.equal(result.body.tamaoReceivesPlatformBilling,true);
assert.equal(calls.payment.length,1);
assert.equal(calls.refund.length,0);

for(const [name,change,expected] of [
  ['order processed, Pix pending',o=>o.transactions.payments[0].status='action_required','MERCADOPAGO_PAYMENT_NOT_ACCREDITED'],
  ['order processed, Pix failed',o=>o.transactions.payments[0].status='failed','MERCADOPAGO_REVERSAL_REVIEW_REQUIRED'],
  ['order processed, Pix in dispute',o=>o.transactions.payments[0].status_detail='charged_back','MERCADOPAGO_REVERSAL_REVIEW_REQUIRED'],
  ['order detail partial refund without proof',o=>o.status_detail='partially_refunded','MERCADOPAGO_REVERSAL_REVIEW_REQUIRED'],
  ['payment detail partial refund without proof',o=>o.transactions.payments[0].status_detail='partially_refunded','MERCADOPAGO_REVERSAL_REVIEW_REQUIRED'],
  ['non-Pix payment',o=>o.transactions.payments[0].payment_method={id:'visa',type:'credit_card'},'MERCADOPAGO_PAYMENT_BINDING_MISMATCH'],
  ['Pix with contradictory method',o=>o.transactions.payments[0].payment_method.type='credit_card','MERCADOPAGO_PAYMENT_BINDING_MISMATCH'],
  ['missing transaction id',o=>o.transactions.payments[0].id='', 'MERCADOPAGO_PAYMENT_BINDING_MISMATCH'],
  ['wrong transaction amount',o=>o.transactions.payments[0].amount='299.99','MERCADOPAGO_PAYMENT_BINDING_MISMATCH'],
  ['sandbox order',o=>o.live_mode=false,'MERCADOPAGO_PAYMENT_BINDING_MISMATCH'],
  ['wrong currency',o=>o.currency_id='USD','MERCADOPAGO_PAYMENT_BINDING_MISMATCH']
]){
  reset();change(remote);
  result=await run();
  assert.equal(result.status,409,name);
  assert.equal(result.body.error,expected,name);
  assert.equal(calls.payment.length,0,name+' must not create positive ledger event');
  assert.equal(calls.refund.length,0,name+' must not fake a refund');
  assert.equal(calls.errors.length,1,name+' must record controlled review evidence');
}

reset();
remote.status='refunded';remote.status_detail='refunded';
remote.transactions.payments[0].status='refunded';
remote.transactions.payments[0].status_detail='refunded';
remote.transactions.refunds=[{id:'REFUND01',status:'processed',amount:'300.00'}];
result=await run();
assert.equal(result.status,200);
assert.equal(result.body.reviewRequired,true);
assert.equal(result.body.tamaoReceivesPlatformBilling,false);
assert.equal(calls.payment.length,0,'fully refunded snapshot cannot credit before reversing');
assert.equal(calls.refund.length,1,'existing refund quarantine still receives PSP evidence');
assert.equal(calls.refund[0].key,'mp-order:'+orderId);

reset();remote.status='processed';remote.status_detail='partially_refunded';
remote.transactions.payments[0].status_detail='partially_refunded';
remote.transactions.refunds=[{id:'REFUND02',status:'processed',amount:'50.00'}];
result=await run();
assert.equal(result.status,200);
assert.equal(result.body.reviewRequired,true);
assert.equal(calls.payment.length,0,'partially refunded order must not grant fresh credit');
assert.equal(calls.refund.length,1);

reset();remote.transactions.refunds=[{id:'REFUND03',status:'processed',amount:'400.00'}];
result=await run();
assert.equal(result.status,409);
assert.equal(result.body.error,'MERCADOPAGO_REVERSAL_REVIEW_REQUIRED');
assert.equal(calls.payment.length,0);
assert.equal(calls.refund.length,0);

reset();remote.transactions.payments=[];
result=await run();
assert.equal(result.status,409);
assert.equal(calls.payment.length,0);

console.log('PASS production Mercado Pago webhook: dual-state Pix evidence, no sandbox/non-Pix credit, refund quarantine, no PSP charges.');
