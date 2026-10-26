import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the real production merchant-sale webhook handler in a sealed VM.
// Only its external PSP / database edges are mocked: no network or ledger writes.
const webhook=fs.readFileSync(new URL(
  '../supabase/functions/billing-payment-webhook-mercadopago/index.ts',import.meta.url
),'utf8');
const begin=webhook.indexOf('async function handleMerchantSaleOrder(');
const end=webhook.indexOf('async function handlePlatformBillingOrder(',begin);
const pureBegin=webhook.indexOf('function orderPayments(');
const pureEnd=webhook.indexOf('async function fetchProviderOrder(',pureBegin);
assert.ok(begin>0&&end>begin&&pureBegin>0&&pureEnd>pureBegin);
const stripTypes=source=>source
  .replace(/\b(admin|attempt|dataId|body|encryptionKey|order|payment|sum|item|p):(?:any|string|number)\b/g,'')
  .replace(/\(p:any\)/g,'(p)');
const realSource=stripTypes(webhook.slice(pureBegin,pureEnd)+
  '\n'+webhook.slice(begin,end));
new vm.Script(realSource);

const orderId='ORDPROD00000000001';
const attempt={id:'12345678-1234-4123-8123-123456789012',
  merchant_id:'22345678-1234-4123-8123-123456789012',
  external_reference:'32345678-1234-4123-8123-123456789012',
  amount_cents:30000,currency:'BRL',status:'pending'};
const psAccount={provider_account_id:'123456',
  status:'active',access_token_ciphertext:'cipher',access_token_nonce:'nonce'};
const baseline={
  id:orderId,user_id:'123456',status:'processed',status_detail:'accredited',
  currency_id:'BRL',total_amount:'300.00',live_mode:true,
  external_reference:attempt.external_reference,
  transactions:{payments:[{
    id:'PAYMENTONE',amount:'300.00',status:'processed',status_detail:'accredited',
    payment_method:{id:'pix',type:'bank_transfer'}
  }],refunds:[]}
};
let remote=structuredClone(baseline);
const rpcEvents=[],mutations=[];
const admin={
  from(table){
    return {
      select(){return this;},
      eq(){return this;},
      neq(){return this;},
      maybeSingle:async()=>table==='merchant_payment_provider_accounts'
        ?{data:psAccount,error:null} : Promise.reject(new Error('Unexpected select '+table)),
      update(values){mutations.push({table,values});return this;}
    };
  },
  rpc:async (name,args)=>{
    rpcEvents.push({name,args});
    return {data:{status:'approved'},error:null};
  }
};
const ctx=vm.createContext({
  String,Number,Date,Array,Promise,JSON,
  paymentEncryptionConfigured:()=>true,
  decryptPaymentSecret:async()=> 'MERCADO_PAGO_OAUTH_TOKEN',
  fetchProviderOrder:async()=>({response:{ok:true,status:200},data:remote}),
  moneyToCents:value=>{
    const n=Number(value), cents=Math.round(n*100);
    return Number.isSafeInteger(cents)&&Math.abs(n*100-cents)<0.00001?cents:null;
  },
  safeOccurredAt:()=> '2026-10-26T04:00:00Z',
  paymentEvidenceHash:async()=> 'a'.repeat(64),
  json:(body,status=200)=>({body,status}),
});
vm.runInContext(realSource+
  '\nthis.processMerchant=handleMerchantSaleOrder;',ctx);

const execute=()=>ctx.processMerchant(admin,attempt,orderId,{},'encryption-key');
const reset=()=>{remote=structuredClone(baseline);mutations.length=0;rpcEvents.length=0;};

let result=await execute();
assert.equal(result.status,200);
assert.equal(result.body.salePaymentStatus,'approved');
assert.equal(result.body.tamaoReceivesSaleProceeds,false);
assert.equal(rpcEvents.length,1);
assert.equal(rpcEvents[0].name,'apply_merchant_sale_payment_event');
assert.equal(rpcEvents[0].args.p_provider_status,'processed');

const cases=[
  ['order processed, transaction pending',
    o=>o.transactions.payments[0].status='action_required',
    'MERCHANT_PROVIDER_PAYMENT_STATUS_CONFLICT'],
  ['order pending, transaction processed',
    o=>o.status='action_required','MERCHANT_PROVIDER_PAYMENT_STATUS_CONFLICT'],
  ['order processed, transaction failed',
    o=>o.transactions.payments[0].status='failed',
    'MERCHANT_PROVIDER_PAYMENT_STATUS_CONFLICT'],
  ['order processed, transaction cancelled',
    o=>o.transactions.payments[0].status='canceled',
    'MERCHANT_PROVIDER_PAYMENT_STATUS_CONFLICT'],
  ['order processed, transaction disputed',
    o=>o.transactions.payments[0].status_detail='charged_back',
    'MERCHANT_PROVIDER_PAYMENT_STATUS_CONFLICT'],
  ['order partially refunded, transaction processed',
    o=>o.status_detail='partially_refunded',
    'MERCHANT_PROVIDER_PAYMENT_STATUS_CONFLICT'],
  ['processed order with wrong payment amount',
    o=>o.transactions.payments[0].amount='250.00',
    'MERCHANT_PROVIDER_PAYMENT_STATUS_CONFLICT'],
  ['sandbox order cannot mark merchant sale paid',
    o=>o.live_mode=false,'MERCHANT_PROVIDER_SALE_EVIDENCE_CONFLICT'],
  ['provider currency conflict',
    o=>o.currency_id='USD','MERCHANT_PROVIDER_SALE_EVIDENCE_CONFLICT'],
  ['reversed amount exceeds purchase amount',
    o=>o.transactions.refunds=[{id:'R1',status:'processed',amount:'500.00'}],
    'MERCHANT_PROVIDER_SALE_EVIDENCE_CONFLICT'],
];
for(const [name,mutate,expected] of cases){
  reset();mutate(remote);result=await execute();
  assert.equal(result.status,200,name);
  assert.equal(result.body.reason,expected,name);
  assert.equal(result.body.salePaymentStatus,'review_required',name);
  assert.equal(result.body.tamaoReceivesSaleProceeds,false,name);
  assert.equal(rpcEvents.length,0,name+' must not approve or credit');
  assert.ok(mutations.some(m=>m.table==='merchant_sale_payment_attempts'
    &&m.values.status==='review_required'
    &&m.values.last_error_code===expected),name+' must require review');
}

reset();
remote.transactions.refunds=[{id:'R2',status:'processed',amount:'50.00'}];
result=await execute();
assert.equal(result.status,200);
assert.equal(result.body.reason,'PARTIAL_REFUND_REVIEW_REQUIRED');
assert.equal(rpcEvents.length,0,'partial refund cannot approve');

reset();
remote.transactions.payments[0].status='refunded';
remote.transactions.refunds=[{id:'R3',status:'processed',amount:'300.00'}];
result=await execute();
assert.equal(rpcEvents.length,1,'full refund goes through original controlled RPC');
assert.equal(rpcEvents[0].args.p_provider_status,'refunded');
assert.equal(result.body.tamaoReceivesSaleProceeds,false);

reset();
remote.transactions.payments[0].id='';
result=await execute();
assert.equal(result.body.reason,'PROVIDER_PAYMENT_ID_MISSING');
assert.equal(rpcEvents.length,0);

console.log('PASS: real merchant-sale Mercado Pago webhook cannot mark divergent/sandbox/refunded PSP states as approved.');
