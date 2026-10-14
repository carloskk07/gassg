import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261014001000_clube_coupon_finance_preview_v1_239.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin.js');
const boot=read('js/bootstrap.js');
const ci=read('.github/workflows/audit.yml');

for(const token of [
 'gas_3x5','water_5x2',
 "('gas_3x5','gas',890,3,500,10000,180)",
 "('water_5x2','water',490,5,200,3000,90)",
 'sales_enabled = false','redemption_enabled = false',
 'enable row level security',
 'revoke all on table public.clube_package_drafts_v1_239 from public,anon,authenticated,service_role',
 'revoke all on function public.admin_clube_coupon_preview_v1_239',
 "'superadmin','finance'",
 'security definer','security invoker','CLUBE_PREVIEW_ACL_DRIFT',
 'p_merchant_sponsor_bps + p_brand_sponsor_bps > 10000',
 'v_platform:=p.discount_per_coupon_cents-v_merch-v_brand',
 'v_fee:=floor((p_order_value_cents-p.discount_per_coupon_cents)',
 'v_no_fee:=v_payment_net-v_orders*(v_platform+p_variable_cost_cents+',
 'v_all_incremental:=v_no_fee+v_orders*v_fee',
 "'salesEnabled',false","'redemptionEnabled',false",
 "'noCharge',true","'noCouponIssued',true",
 "'sponsorVerified',false","'scenariosAreNotForecasts',true",
 'scenarioZeroIncrementalAfterMinCents','scenarioAllIncrementalAfterMinCents'
])assert.ok(sql.includes(token),'Missing safety mechanism in migration: '+token);
assert.ok(!/(insert\s+into|update|delete\s+from)\s+public\.(orders|order_items|merchant_fee_credit_ledger|merchant_daily_statements|merchant_billing_accounts|merchant_sale_payment_attempts)/i.test(sql),
 'Coupon draft migration cannot move merchant or customer finances');
assert.ok(edge.includes('"growth-benefit-preview","clube-coupon-preview","commercial-policy"'));
assert.ok(edge.includes('if(action==="clube-coupon-preview")'));
assert.ok(edge.includes('admin.rpc("admin_clube_coupon_preview_v1_239"'));
assert.ok(edge.includes('values[2]+values[3]>10000'));
assert.ok(edge.includes('data?.sponsorVerified!==false'));
assert.ok(edge.includes('data?.noCouponIssued!==true'));
assert.ok(ui.includes('function adminClubeCouponPreviewView()'));
assert.ok(ui.includes('async function adminClubeCouponPreviewFromUi()'));
assert.ok(ui.includes('${adminClubeCouponPreviewView()}'));
assert.ok(ui.includes("identity===String(adminRuntime.session?.user?.id||'')"));
assert.ok(boot.includes('adminClubeCouponPreviewFromUi'));
assert.ok(ci.includes('node tests/clube-finance-preview-v1-239.mjs'));
new vm.Script(ui,{filename:'admin.js'});
new vm.Script(boot,{filename:'bootstrap.js'});

const extract=name=>{
 const start=ui.indexOf('function '+name+'(');
 const end=ui.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,'Missing '+name);
 return ui.slice(start,end+2);
};
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const state={clubePreview:{data:null,pending:false,error:null,inputs:null}};
const ctx=vm.createContext({adminRuntime:state,adminCurrentRole:()=> 'finance',
 adminMoney:n=>'R$ '+(n/100).toFixed(2),esc,Number,String,Object});
vm.runInContext(extract('adminClubeCouponPreviewView')+
 '\nthis.view=adminClubeCouponPreviewView;',ctx);
assert.ok(ctx.view().includes('Pacotes não comercializados'));
assert.ok(ctx.view().includes('Simular sem vender cupons'));
assert.ok(!ctx.view().includes('Compre seu pacote'));
state.clubePreview.inputs={orderValueCents:'"><img src=x onerror=alert(1)>'};
assert.ok(!ctx.view().includes('value=""><img'));
assert.ok(ctx.view().includes('&lt;img'));
state.clubePreview.inputs={packageKey:'water_5x2'};
state.clubePreview.data={
 netPackageRevenueCents:340,totalTamaoSubsidyCents:0,
 couponCount:5,scenarioZeroIncrementalAfterMinCents:90,
 scenarioAllIncrementalAfterMinCents:1500,
 sponsorFundingRequiredCents:1000,totalDiscountCents:1000,minOrderCents:3000
};
assert.ok(ctx.view().includes('Água: R$ 4,90'));
assert.ok(ctx.view().includes('R$ 3.40'));
assert.ok(ctx.view().includes('R$ 0.90'));

function example({price,qty,discount,order,feeBps,merchantBps,brandBps,payment,
 variableCost,cashback,referral,minContribution}){
 const merchant=Math.floor(discount*merchantBps/10000);
 const brand=Math.floor(discount*brandBps/10000);
 const tamao=discount-merchant-brand;
 const perOrderFee=Math.floor((order-discount)*feeBps/10000);
 const conservative=price-payment-qty*(tamao+variableCost+cashback+referral+minContribution);
 return {totalDiscount:qty*discount,tamaoCost:qty*tamao,
  conservative,allIncremental:conservative+qty*perOrderFee};
}
const gas=example({price:890,qty:3,discount:500,order:12000,
 feeBps:750,merchantBps:10000,brandBps:0,payment:150,
 variableCost:90,cashback:0,referral:0,minContribution:0});
assert.deepEqual(gas,{totalDiscount:1500,tamaoCost:0,conservative:470,allIncremental:3056});
const gasNoSponsor=example({price:890,qty:3,discount:500,order:12000,
 feeBps:750,merchantBps:0,brandBps:0,payment:150,
 variableCost:90,cashback:0,referral:0,minContribution:0});
assert.equal(gasNoSponsor.conservative,-1030);
assert.equal(gasNoSponsor.tamaoCost,1500);
assert.equal(example({price:490,qty:5,discount:200,order:4000,
 feeBps:750,merchantBps:10000,brandBps:0,payment:150,
 variableCost:90,cashback:0,referral:0,minContribution:0}).conservative,-110);
console.log('V1.239 PASS — public sale blocked, roles restricted, negative economics exposed, UI escaped and fully funded alternatives modeled.');
