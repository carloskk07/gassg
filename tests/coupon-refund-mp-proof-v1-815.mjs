import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const edge=fs.readFileSync(new URL('../supabase/functions/coupon-credit-pix/index.ts',import.meta.url),'utf8');
const begin=edge.indexOf('function couponFullRefundVerified(');
const end=edge.indexOf('\nDeno.serve(',begin);
assert.ok(begin>0&&end>begin,'refund guard must be independently testable');
const functionBody=edge.slice(begin,end).replace(/:any(?=[,)])/g,'');
const ctx=vm.createContext({
 String,Array,Number,
 moneyToCents:value=>value==null?null:Math.round(Number(value)*100),
 findPix:order=>order?.transactions?.payments?.find(p=>p?.payment_method?.id==='pix')??null
});
new vm.Script(functionBody+'\nthis.verify=couponFullRefundVerified;').runInContext(ctx);
const invoice={id:'invoice-1',provider_order_id:'mp-order-1',provider_payment_id:'mp-pix-1',sale_price_cents:890};
const pix={id:'mp-pix-1',amount:'8.90',payment_method:{id:'pix',type:'bank_transfer'}};
const refund={id:'mp-refund-1',status:'processed',transaction_id:'mp-pix-1',amount:'8.90'};
const order={id:'mp-order-1',external_reference:'invoice-1',total_amount:'8.90',live_mode:true,transactions:{payments:[pix],refunds:[refund]}};
assert.equal(ctx.verify(order,invoice),true,'completed full provider refund is verified');
const altered=[
 {...order,id:'mp-other'},
 {...order,external_reference:'another-invoice'},
 {...order,live_mode:false},
 {...order,total_amount:'8.80'},
 {...order,transactions:{payments:[{...pix,amount:'8.80'}],refunds:[refund]}},
 {...order,transactions:{payments:[{...pix,id:'other'}],refunds:[refund]}},
 {...order,transactions:{payments:[pix],refunds:[]}},
 {...order,transactions:{payments:[pix],refunds:[{...refund,status:'processing'}]}},
 {...order,transactions:{payments:[pix],refunds:[{...refund,transaction_id:'other'}]}},
 {...order,transactions:{payments:[pix],refunds:[{...refund,amount:'8.00'}]}},
 {...order,transactions:{payments:[pix],refunds:[{...refund,id:''}]}},
 {...order,transactions:{payments:[pix],refunds:[{...refund,amount:'8.90'}, {...refund,id:'second',amount:'0.10'}]}}
];
for(const [idx,bad] of altered.entries())
 assert.equal(ctx.verify(bad,invoice),false,'reject partial/ambiguous refund case '+idx);
const action=edge.slice(edge.indexOf('if(operation==="request-refund")'),edge.indexOf('if(operation==="catalog")'));
assert.ok(action.includes('idempotencyKey:String(data.requestId)'), 'refund retries share one immutable provider key');
assert.ok(action.includes('couponFullRefundVerified(proof,invoice)'),'mark refunded only after fresh GET');
assert.ok(action.includes('voucherErr')&&action.includes('v.status==="issued"||v.status==="void"'),'used vouchers must not be automatically refunded');
assert.ok(action.includes('remoteRefundVerified=done.data?.ok===true&&done.data?.refunded===true'));
assert.ok(action.indexOf('clube_coupon_refund_request_v1_814')<action.indexOf('mercadoPagoFetch(endpoint+"/refund"'),'ownership and durable request precede PSP action');
console.log('V1.815 PASS — completed full Mercado Pago Orders refund only, no partials, replays or spent coupons.');
