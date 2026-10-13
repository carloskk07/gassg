import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261013220000_growth_merchant_benefit_economics_v1_228.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin.js');
const boot=read('js/bootstrap.js');
const audit=read('.github/workflows/audit.yml');
for(const needle of [
 'growth_merchant_benefit_policy_v1_228',
 'reward_enabled boolean not null default false check(reward_enabled=false)',
 'share_of_received_platform_fee_bps between 0 and 500',
 'eligibility_days between 1 and 90',
 'total_per_referred_merchant_cap_cents between 0 and 20000',
 'max_levels integer not null default 1 check(max_levels=1)',
 'requires_actual_fee_receipt=true',
 'requires_refund_clearance=true',
 'financial_approval_required=true',
 "'merchant_first_level_v1',false,500,90,20000,1",
 'admin_growth_merchant_benefit_preview_v1_228(',
 "a.admin_role in ('superadmin','finance')",
 'v_remaining_margin:=greatest(0,p_received_fee_cents-',
 'v_remaining_cap:=greatest(0,',
 'v_hypothetical:=least(v_target,v_remaining_margin,v_remaining_cap)',
 "'grantableCents',0",
 "'rewardEnabled',false",
 "'isScenarioNotRealPayment',true",
 "'noMerchantSaleProceeds',true",
 "'noPayout',true",
 "'feeBasis','actual_tamao_fee_received_only'",
 'grant select on public.growth_merchant_benefit_policy_v1_228 to service_role',
 'grant execute on function public.admin_growth_merchant_benefit_preview_v1_228'
])assert.ok(sql.includes(needle),'Missing immutable economics protection: '+needle);
assert.ok(!/insert into public\.(merchant_fee_credit_ledger|merchant_billing_accounts)|update public\.merchant_billing_accounts|alter table public\.merchant_fee_credit_ledger|delete from public\.merchant_fee_credit_ledger/i.test(sql));
assert.ok(edge.includes('"growth-benefit-preview","commercial-policy"'));
assert.ok(edge.includes('if(action==="growth-benefit-preview")'));
assert.ok(edge.includes('admin.rpc("admin_growth_merchant_benefit_preview_v1_228"'));
assert.ok(edge.includes('Number.isSafeInteger(value)'));
assert.ok(edge.includes('data?.grantableCents===0'));
assert.ok(edge.includes('data?.rewardEnabled===false'));
assert.ok(edge.includes('data?.isScenarioNotRealPayment===true'));
assert.ok(ui.includes('adminGrowthBenefitPreviewView()'));
assert.ok(ui.includes('async function adminGrowthBenefitPreviewFromUi()'));
assert.ok(boot.includes('adminGrowthBenefitPreviewFromUi'));
assert.ok(audit.includes('node tests/growth-merchant-economics-v1-228.mjs'));
new vm.Script(ui,{filename:'admin.js'});
new vm.Script(boot,{filename:'bootstrap.js'});
const extract=name=>{
 const start=ui.indexOf('function '+name+'(');
 const end=ui.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,'Missing '+name);
 return ui.slice(start,end+2);
};
const role=()=> 'finance';
const adminMoney=c=> 'R$ '+(Number(c)/100).toFixed(2);
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const runtime={growthBenefitPreview:{data:null,pending:false,error:null}};
const ctx=vm.createContext({adminRuntime:runtime,adminCurrentRole:role,
adminMoney,esc,Number,String,Object});
vm.runInContext([extract('adminGrowthMoneyInputCents'),
extract('adminGrowthBenefitPreviewView')].join('\n')+
 '\nthis.parse=adminGrowthMoneyInputCents;this.view=adminGrowthBenefitPreviewView;',ctx);
for(const [raw,cents] of [['0',0],['9',900],['9,00',900],['9.0',900],
 ['0,01',1],['0.1',10],['200,00',20000],['999999,99',99999999],
 ['1000000,00',100000000],['1000000,01',null],['9.001',null],
 ['-1',null],['NaN',null],['2e3',null],['',null],['01',null]])
 assert.equal(ctx.parse(raw),cents,'Parsing unexpected '+raw);
assert.ok(ctx.view().includes('Campanha ainda desativada'));
assert.ok(ctx.view().includes('Nenhum valor é pago')===false);
runtime.growthBenefitPreview.data={
 source:'merchant_referral_finance_preview_v1_228',
 readOnly:true,rewardEnabled:false,grantableCents:0,noPayout:true,
 illustrativeBenefitCents:45,safeMarginRemainingCents:150,
 shareBps:500,days:90,perReferredMerchantCapCents:20000
};
assert.ok(ctx.view().includes('R$ 0.45'));
assert.ok(ctx.view().includes('Nenhum valor é pago nem prometido'));
runtime.growthBenefitPreview.inputs={receivedFeeCents:'11,11'};
assert.ok(ctx.view().includes('value="11,11"'));
runtime.growthBenefitPreview.inputs={receivedFeeCents:'"><img src=x onerror=alert(1)>'};
assert.ok(!ctx.view().includes('value=""><img'));
assert.ok(ctx.view().includes('&lt;img'));
console.log('V1.228 PASS — draft-only fee economics, 5% fee scenario, fail-closed authorization and safe Admin preview.');
