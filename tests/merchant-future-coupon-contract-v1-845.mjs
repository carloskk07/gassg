import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ui=read('js/merchant-benefits-contract.js');
const sql=read('supabase/migrations/20261105212500_merchant_future_coupon_contract_v1_845.sql');
const edge=read('supabase/functions/merchant-ops/index.ts');
const legacy=read('supabase/migrations/20261105185500_paid_coupon_welcome_compat_v1_843.sql');
new vm.Script(ui,{filename:'merchant-benefits-contract.js'});
for(const item of [
 'merchant_coupon_consents_v1_845','merchant_coupon_consent_events_v1_845',
 'merchant_coupon_event_immutable_v1_845','merchant_coupon_contract_v1_845',
 'MERCHANT_COUPON_VERSION_STALE','MERCHANT_COUPON_REPLAY_CONFLICT',
 'MERCHANT_COUPON_OWNER_REQUIRED','p_consent IS DISTINCT FROM true',
 " 'futureCouponsOnly',true","'checkoutEnabled',false",
 " 'feeReductionEnabled',false","'existingPaidCouponsUntouched',true",
 'REVOKE ALL ON FUNCTION public.merchant_coupon_contract_v1_845',
 'TO service_role'
])assert.ok(sql.includes(item),'contract obligation: '+item);
assert.match(sql,/ALTER TABLE public\.merchant_coupon_consent_events_v1_845 ENABLE ROW LEVEL SECURITY/);
assert.doesNotMatch(sql,/\b(?:update|delete|truncate)\s+public\.(?:orders|wallet_entries|merchant_cashback_reimbursements|clube_coupon_paid_invoices|clube_coupon_paid_issuances|merchant_billing_plans|platform_launch_control)\b/i);
assert.match(sql,/Cupons anteriormente vendidos/);
assert.match(sql,/não recebe ressarcimento TAMÃO/);
assert.match(sql,/não necessariamente cobre o custo do desconto/);
assert.match(legacy,/COUPON_PAID_NET_FUNDS_REQUIRED/);
assert.match(edge,/"coupon-benefits-contract","business-pulse"/);
assert.match(edge,/merchant_coupon_contract_v1_845/);
assert.match(edge,/data\.existingPaidCouponsUntouched!==true/);
assert.match(edge,/data\.checkoutEnabled!==false/);

const id='b8450000-0000-4000-8000-000000000001';
let calls=[],notices=[],checks=0,version=0,optedIn=false;
const rt={merchant:{merchantId:id,memberRole:'owner'}};
const response=operation=>({
 source:'merchant_coupon_contract_v1_845',merchantId:id,
 readOnly:operation==='view',optedIn,version,termsVersion:1,
 termsText:'Condições válidas: novo contrato. '.repeat(30),
 maxCouponFaceCents:500,minOrderCents:1000,
 normalFlexFeeBps:900,fundedFlexFeeBps:800,
 futureCouponsOnly:true,checkoutEnabled:false,feeReductionEnabled:false,
 existingPaidCouponsUntouched:true,moneyMoved:false
});
const ctx={globalThis:{merchantRuntime:rt},String,Number,
 esc:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
 render:()=>checks++,toast:s=>notices.push(s),confirm:()=>true,
 crypto:{randomUUID:()=>'e8450000-0000-4000-8000-000000000001'},
 document:{getElementById:()=>({checked:true})},
 merchantInvoke:async(_,payload)=>{
  calls.push(payload);
  assert.equal(payload.action,'coupon-benefits-contract');
  if(payload.operation==='accept'){version++;optedIn=true;}
  if(payload.operation==='revoke'){version++;optedIn=false;}
  return response(payload.operation);
 }};
vm.runInNewContext(ui,ctx);
let html=ctx.merchantFutureCouponContractRender(rt);
assert.match(html,/Consultar condições dos cupons/);
assert.doesNotMatch(html,/Aceitar condições dos novos cupons/);
await ctx.merchantCouponContractAct('view');
html=ctx.merchantFutureCouponContractRender(rt);
assert.match(html,/Aceitar condições dos novos cupons/);
assert.match(html,/Cupons pagos de próximas campanhas/);
assert.match(html,/Os cupons antigos continuam/);
assert.match(html,/Aceite não é ativação/);
await ctx.merchantCouponContractAct('accept');
assert.equal(calls.length,3,'mutations require fresh authenticated readback');
assert.equal(rt.merchantFutureCouponContract.version,1);
assert.equal(rt.merchantFutureCouponContract.optedIn,true);
assert.match(ctx.merchantFutureCouponContractRender(rt),/Revogar para novos cupons/);
await ctx.merchantCouponContractAct('revoke');
assert.equal(calls.length,5);
assert.equal(rt.merchantFutureCouponContract.optedIn,false);
rt.merchant.memberRole='manager';
await ctx.merchantCouponContractAct('accept');
assert.equal(calls.length,5,'manager cannot consent');
rt.merchant.memberRole='operator';
assert.equal(ctx.merchantFutureCouponContractRender(rt),'');
rt.merchant.memberRole='owner';
rt.merchantFutureCouponContract={...response('view'),termsText:'<img onerror=alert(1)>'};
assert.doesNotMatch(ctx.merchantFutureCouponContractRender(rt),/<img/);
rt.merchant={merchantId:'b8450000-0000-4000-8000-000000000002',memberRole:'owner'};
assert.doesNotMatch(ctx.merchantFutureCouponContractRender(rt),/onerror/);
assert.ok(checks>=3);
console.log('TAMÃO #845: future coupon terms, owner role, readback, XSS, no old coupon conversion.');
