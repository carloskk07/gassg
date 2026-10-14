import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261014020000_clube_campaign_reviews_v1_241.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-acquisition.js');
const boot=read('js/bootstrap.js');
const workflow=read('.github/workflows/audit.yml');
for(const x of [
 'clube_campaign_reviews_v1_241','clube_campaign_review_events_v1_241',
 "status in ('under_review','request_documents','economic_prechecked','declined')",
 'check(funding_verified=false)','check(contract_approved=false)','check(campaign_enabled=false)',
 'enable row level security','revoke all on public.clube_campaign_reviews_v1_241',
 'grant select on public.clube_campaign_reviews_v1_241 to service_role',
 'for share','CLUBE_REVIEW_CONSENT_STALE','CLUBE_REVIEW_CITY_CHANGED',
 'CLUBE_REVIEW_STALE_VERSION','CLUBE_REVIEW_IDEMPOTENCY_CONFLICT',
 'CLUBE_FINANCE_ROLE_REQUIRED','pg_advisory_xact_lock',
 "p_status='economic_prechecked' and v_role not in ('superadmin','finance')",
 'ceil(v_pack.discount_per_coupon_cents::numeric*',
 'v_uses:=floor(v_interest.proposed_budget_cents::numeric/v_per_use)::integer',
 'v_packages:=floor(v_uses::numeric/v_pack.coupon_count)::integer',
 'on conflict(merchant_id,package_key) do update',
 'request_signature is distinct from v_signature',
 'coalesce((i.interested and c.interest_version=i.version',
 "'noContract',true","'fundingVerified',false","'campaignEnabled',false",
 "'sponsorFundingConfirmedCents',0","'couponSalesEnabled',false",
 'public.admin_clube_campaign_queue_v1_241',
 'public.admin_clube_campaign_review_v1_241',
 'CLUBE_CAMPAIGN_ACL_DRIFT'
])assert.ok(sql.includes(x),'Missing SQL invariant: '+x);
assert.ok(!/(insert\s+into|update|delete\s+from)\s+public\.(orders|merchant_billing_accounts|merchant_fee_credit_ledger|merchant_daily_statements|merchant_sale_payment_attempts)/i.test(sql),
 'Campaign review cannot modify order/financial ledgers');
for(const x of [
 '"clube-campaign-queue"','"clube-campaign-review"',
 'if(action==="clube-campaign-queue")','if(action==="clube-campaign-review")',
 'admin.rpc("admin_clube_campaign_queue_v1_241"',
 'admin.rpc("admin_clube_campaign_review_v1_241"',
 '(status==="economic_prechecked"&&!["superadmin","finance"].includes',
 'data?.sponsorFundingConfirmedCents!==0','data?.campaignEnabled!==false',
 'data?.noMerchantSaleProceeds!==true'
])assert.ok(edge.includes(x),'Missing Edge policy: '+x);
for(const x of [
 'function adminClubeCampaignSection()','adminClubeCampaignSection(),',
 'async function adminClubeCampaignLoadFromUi()',
 'async function adminClubeCampaignReviewFromUi(',
 "status==='economic_prechecked'&&!['superadmin','finance'].includes(role)",
 'Não comprometido','Hipótese arredondada para cima',
 'Não disponíveis para venda','noContract!==true','noCharge!==true',
 'expectedInterestVersion','crypto.randomUUID()'
])assert.ok(ui.includes(x),'Missing Admin UX: '+x);
assert.ok(boot.includes('adminClubeCampaignReviewFromUi'));
assert.ok(workflow.includes('node tests/clube-campaign-review-v1-241.mjs'));
new vm.Script(ui,{filename:'admin-acquisition.js'});
new vm.Script(boot,{filename:'bootstrap.js'});
const start=ui.indexOf('function adminClubeCampaignSection(){');
const end=ui.indexOf('\n}',start);
assert.ok(start>=0&&end>start);
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
let campaignData=null;
const userId='11111111-1111-4111-8111-111111111111';
const rt={session:{user:{id:userId}}};
const ctx=vm.createContext({adminRuntime:rt,adminCurrentRole:()=> 'finance',
 adminMoney:n=>'R$ '+(n/100).toFixed(2),esc,Number,String,
 adminClubeCampaignState:null,adminClubeCampaignBusy:false,
 adminClubeCampaignReviewsPending:new Set()});
vm.runInContext(ui.slice(start,end+2)+'\nthis.view=adminClubeCampaignSection;',ctx);
assert.ok(ctx.view().includes('Nenhuma cobrança ou campanha foi aberta'));
ctx.adminClubeCampaignState={loadedFor:userId,readOnly:true,rows:[{
 merchantId:userId,companyName:'Oficina <script>alert(1)</script>',
 packageKey:'gas_3x5',city:'São Gabriel',state:'RS',
 interestActive:true,interestVersion:1,reviewVersion:0,
 reviewCurrent:false,reviewStatus:null,reviewNote:null,
 budgetCents:3000,shareBps:10000,
 sponsoredPerCouponCents:500,maxCouponUsesIllustrative:6,
 maxPackagesIllustrative:2
}],activeInterests:1};
const html=ctx.view();
assert.ok(html.includes('R$ 30.00'));
assert.ok(html.includes('Pacotes inteiros hipotéticos'));
assert.ok(html.includes('&lt;script&gt;'));
assert.ok(!html.includes('<script>alert(1)</script>'));
assert.ok(html.includes('Economia pré-analisada'));
const vulnerable=(share,budget,discount,perPack)=>{
 const conservativePerUse=Math.ceil(discount*share/10000);
 return [Math.floor(budget/conservativePerUse),
         Math.floor(Math.floor(budget/conservativePerUse)/perPack)];
};
assert.deepEqual(vulnerable(10000,3000,500,3),[6,2]);
assert.deepEqual(vulnerable(2500,3000,500,3),[24,8]);
assert.deepEqual(vulnerable(10000,3000,200,5),[15,3]);
ctx.adminClubeCampaignState.rows[0].interestActive=false;
assert.ok(ctx.view().includes('Interesse retirado ou alterado'));
console.log('V1.241 PASS — finance gate, stale consent, upper-rounded obligations, read-only commercial readiness and escaped UI.');
