import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const edge=read('supabase/functions/coupon-credit-pix/index.ts');
const ui=read('js/admin.js');
const from=edge.indexOf('async function couponRecoverPaidFromProvider(');
const to=edge.indexOf('// A refund may close',from);
assert.ok(from>0&&to>from,'recoverable provider-paid Pix check is required');
const block=edge.slice(from,to).replace('admin:any,invoice:any','admin,invoice');
assert.match(block,/method:"GET"/);
assert.match(block,/clube_coupon_paid_payment_verify/);
assert.doesNotMatch(block,/method:"POST"|mercadoPagoFetch\("\/v1\/orders",/,
 'status check cannot create a second PSP payment');
assert.match(ui,/if\(\['paid','review_required','refunded'\]\.includes\(read\.status\)\)/);
assert.match(ui,/const latest=await adminFinanceRealApi\('coupon-credit-pix'/);
const original={
 id:'11111111-1111-4111-8111-111111111111',
 customer_user_id:'22222222-2222-4222-8222-222222222222',
 status:'awaiting_payment',provider_order_id:'MP-ORDER-1',
 provider_payment_id:'MP-PIX-1',sale_price_cents:890
};
const template={
 id:'MP-ORDER-1',external_reference:original.id,live_mode:true,
 currency_id:'BRL',total_amount:'8.90',status:'processed',status_detail:'accredited',
 transactions:{payments:[{
   id:'MP-PIX-1',live_mode:true,amount:'8.90',status:'processed',
   status_detail:'accredited',payment_method:{id:'pix',type:'bank_transfer'}
 }],refunds:[]}
};
let order=template,lookups=0,rpcs=0,reads=0,refunded=false;
const moneyToCents=v=>/^\d+(?:\.\d{1,2})?$/.test(String(v))?
  Math.round(Number(v)*100):null;
const db={
 async rpc(name,params){
  rpcs++;
  assert.equal(name,'clube_coupon_paid_payment_verify');
  assert.equal(params.p_invoice_id,original.id);
  assert.equal(params.p_payment_id,original.provider_payment_id);
  assert.equal(params.p_amount_cents,890);
  return {data:{ok:true},error:null};
 },
 from(table){
  assert.equal(table,'clube_coupon_paid_invoices');
  return {select(){return this},eq(){return this},async maybeSingle(){
    reads++;return {data:{...original,status:'paid',paid_at:'2026-11-10T20:00:00Z'},error:null};
  }};
 }
};
const scope=vm.createContext({
 MP_TOKEN:'APP_USR-test',mercadoPagoConfigured:()=>true,
 async mercadoPagoFetch(url,options){
  lookups++;assert.equal(url,'/v1/orders/MP-ORDER-1');
  assert.equal(options.method,'GET');return {ok:true};
 },
 async readMercadoPagoJson(){return order},
 findPix:x=>(x?.transactions?.payments||[]).find(p=>p?.payment_method?.id==='pix')||null,
 moneyToCents,encodeURIComponent,String,Number,Array
});
vm.runInContext(block+'\nthis.recover=couponRecoverPaidFromProvider;',scope);
const check=invoice=>scope.recover(db,invoice);
let got=await check(original);
assert.equal(got.status,'paid');
assert.equal(lookups,1);assert.equal(rpcs,1);assert.equal(reads,1);
got=await check({...original,status:'paid'});
assert.equal(got.status,'paid');assert.equal(lookups,1,
 'already-paid invoice is not rechecked or recredited');
for(const change of [
 {status:'processing'}, {status_detail:'partially_refunded'},
 {total_amount:'8.89'},{external_reference:'other'},
 {transactions:{...template.transactions,refunds:[{id:'refund-1'}]}},
 {transactions:{...template.transactions,payments:[{...template.transactions.payments[0],amount:'5.00'}]}},
 {transactions:{...template.transactions,payments:[template.transactions.payments[0],template.transactions.payments[0]]}},
 {transactions:{...template.transactions,chargebacks:[{id:'cb-1'}]}},
 {transactions:{...template.transactions,payments:[{...template.transactions.payments[0],status:'pending'}]}}
]){
 order={...template,...change};
 const old=rpcs;
 got=await check(original);
 assert.equal(got.status,'awaiting_payment','unsafe provider proof must not mark paid');
 assert.equal(rpcs,old,'unsafe proof cannot call payment verification RPC');
}
// MP may omit an empty refunds array from its normal Order GET response.
order={...template,transactions:{payments:template.transactions.payments}};
got=await check(original);
assert.equal(got.status,'paid');
console.log('V1.942 PASS — exact direct MP paid recovery, idempotent DB RPC, no duplicate Pix, and refund failures.');
