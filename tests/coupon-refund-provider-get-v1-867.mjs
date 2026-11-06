import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const file=read('supabase/functions/admin-ops/coupon-refund-provider-evidence.js');
const ctx=vm.createContext({Set,Number,String,Array,JSON,Object});
new vm.Script(file.replace('export function couponProviderRefundEvidence','function couponProviderRefundEvidence')+
  '\nthis.probe=couponProviderRefundEvidence;').runInContext(ctx);
const check=ctx.probe;
const cents=value=>{
  if(typeof value!=='string'||!/^\\d+(?:\\.\\d{1,2})?$/.test(value))return null;
  return Math.round(Number(value)*100);
};
const invoice={id:'66666666-6666-4666-8666-666666666666',
 provider_order_id:'ORD0123456789',provider_payment_id:'PAY0123456789',sale_price_cents:890};
const good={
  id:invoice.provider_order_id,external_reference:invoice.id,
  total_amount:'8.90',currency_id:'BRL',country_code:'BRA',
  status:'refunded',status_detail:'refunded',live_mode:true,
  transactions:{
    payments:[{id:invoice.provider_payment_id,amount:'8.90',
      payment_method:{id:'pix',type:'bank_transfer'},live_mode:true}],
    refunds:[{id:'REF01',transaction_id:invoice.provider_payment_id,
      status:'processed',amount:'8.90'}]
  }
};
const probe=(change={},inv=invoice)=>check({...good,...change},inv,cents);
const success=probe();
assert.equal(success.orderBound,true);
assert.equal(success.providerRefundVerified,true);
assert.equal(success.refundAmountCents,890);
assert.equal(success.refundTransactionCount,1);
assert.equal(success.reason,'PROVIDER_FULL_REFUND_CONFIRMED');
for(const bad of [
 {id:'ORD_UNRELATED'}, {external_reference:'OTHER_CUSTOMER'},
 {total_amount:'9.90'}, {currency_id:'USD'},{live_mode:false},
 {status:'processed'}, {status_detail:'partially_refunded'},
 {transactions:{...good.transactions,payments:[{...good.transactions.payments[0],id:'OTHER_PAY'}]}},
 {transactions:{...good.transactions,payments:[{...good.transactions.payments[0],amount:'1.00'}]}},
 {transactions:{...good.transactions,payments:[{...good.transactions.payments[0],payment_method:{id:'credit_card',type:'credit_card'}}]}},
 {transactions:{...good.transactions,refunds:[]}},
 {transactions:{...good.transactions,refunds:[{...good.transactions.refunds[0],status:'pending'}]}},
 {transactions:{...good.transactions,refunds:[{...good.transactions.refunds[0],transaction_id:'OTHER_PAYMENT'}]}},
 {transactions:{...good.transactions,refunds:[{...good.transactions.refunds[0],amount:'4.00'}]}},
 {transactions:{...good.transactions,refunds:[good.transactions.refunds[0],good.transactions.refunds[0]]}},
 {transactions:{...good.transactions,refunds:[{...good.transactions.refunds[0],amount:'99.00'}]}}
]){
 const result=probe(bad);
 assert.notEqual(result.providerRefundVerified,true,'uncertain PSP evidence must not confirm a refund');
 assert.equal(result.refundAmountCents,null,'invalid PSP proof must not expose confirmed refund amount');
}
const split=probe({transactions:{...good.transactions,refunds:[
 {id:'REF01',transaction_id:invoice.provider_payment_id,status:'processed',amount:'4.00'},
 {id:'REF02',transaction_id:invoice.provider_payment_id,status:'processed',amount:'4.90'}
]}});
assert.equal(split.providerRefundVerified,true);
assert.equal(split.refundAmountCents,890);
assert.equal(check(good,{...invoice,sale_price_cents:0},cents).providerRefundVerified,false);
const edge=read('supabase/functions/admin-ops/index.ts');
const start=edge.indexOf('if(action==="clube-coupon-refund-provider-inspect")');
const finish=edge.indexOf('if(action==="clube-coupon-refund-review-inspect")',start);
assert.ok(start>0&&finish>start);
const action=edge.slice(start,finish);
assert.match(action,/couponProviderRefundEvidence/);
assert.match(action,/mercadoPagoFetch\("\/v1\/orders\/"/);
assert.match(action,/method:"GET"/);
assert.match(action,/COUPON_REFUND_PROVIDER_CASE_CHANGED/);
assert.match(action,/providerRefundVerified:evidence.providerRefundVerified/);
assert.match(action,/refundClosureAuthorized:false/);
assert.match(action,/providerMutationPerformed:false/);
assert.doesNotMatch(action,/method:"POST"|\.update\(|\.insert\(|clube_coupon_paid_payment_refund|\/refund"/,
 'provider inspection must not issue refunds or mutate balances');
const ui=read('js/admin.js');
assert.match(ui,/async function adminClubeRefundProviderInspect\(/);
assert.match(ui,/Conferir estorno no Mercado Pago/);
assert.match(ui,/Não comprova crédito bancário ao comprador, não quita revenda e não permite encerrar/);
console.log('PASS #867: refund GET proof requires same order, Pix transaction, full amount, distinct IDs, and no bank/ledger mutation');
