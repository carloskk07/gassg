import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261014030000_clube_terms_negotiation_v1_242.sql');
const admin=read('supabase/functions/admin-ops/index.ts');
const merchant=read('supabase/functions/merchant-ops/index.ts');
const adminUi=read('js/admin-acquisition.js');
const merchantUi=read('js/merchant.js');
const boot=read('js/bootstrap.js');
const workflow=read('.github/workflows/audit.yml');
for(const x of [
 'clube_terms_drafts_v1_242','clube_terms_events_v1_242',
 'check(funding_verified=false)','check(contract_signed=false)',
 'check(coupon_sales_enabled=false)','enable row level security',
 'revoke all on public.clube_terms_drafts_v1_242',
 'grant select on public.clube_terms_drafts_v1_242 to service_role',
 'CLUBE_TERMS_ACL_DRIFT','CLUBE_TERMS_FINANCE_DENIED',
 'CLUBE_TERMS_OWNER_REQUIRED','CLUBE_TERMS_INTEREST_STALE',
 'CLUBE_TERMS_REVIEW_STALE','CLUBE_TERMS_INVALID_SPLIT',
 'CLUBE_TERMS_NO_COMPLETE_PACKAGE','CLUBE_TERMS_STALE_VERSION',
 'CLUBE_TERMS_REPLY_STALE','CLUBE_TERMS_IDEMPOTENCY_CONFLICT',
 'CLUBE_TERMS_REPLY_IDEMPOTENCY_CONFLICT',
 "v_review.status not in ('under_review','request_documents','economic_prechecked')",
 "p_status='shared_for_discussion'",
 'clube_internal_v1_242.term_capacity','ceil(p_discount::numeric*p_merchant_bps/10000)',
 'v_platform:=p_discount-v_merchant-v_brand',
 'floor(p_merchant_budget::numeric/v_merchant)',
 'floor(p_brand_budget::numeric/v_brand)','floor(p_platform_budget::numeric/v_platform)',
 'v_packages:=floor(v_uses::numeric/p_count)::integer',
 'merchant_response_version=0',
 'merchant_response=\'none\',merchant_response_version=0',
 "v_term.terms_status<>'shared_for_discussion'",
 'or v_current is distinct from true',
 "'moneyReservedCents',0","'fundingVerified',false",
 "'financiallyReady',false",'public.admin_clube_terms_queue_v1_242',
 'public.merchant_clube_terms_v1_242','request_signature is distinct from v_signature'
])assert.ok(sql.includes(x),'Missing SQL guard: '+x);
assert.ok(!/(insert\s+into|update|delete\s+from)\s+public\.(orders|order_items|merchant_billing_accounts|merchant_fee_credit_ledger|merchant_daily_statements|merchant_sale_payment_attempts)/i.test(sql),
 'Commercial discussion must never write order/payment ledgers');
for(const x of [
 '"clube-terms-queue"','"clube-terms-save"',
 'if(action==="clube-terms-queue")','if(action==="clube-terms-save")',
 'admin_clube_terms_queue_v1_242','admin_clube_terms_save_v1_242',
 'data?.noContractsSigned!==true','data?.fundingVerifiedCents!==0',
 'data?.budgetReservedCents!==0'
])assert.ok(admin.includes(x),'Missing Admin Edge check: '+x);
for(const x of [
 '"clube-terms"','if(action==="clube-terms")',
 'merchant_clube_terms_v1_242','role!=="owner"',
 'operation==="read_for_discussion"&&body.consent!==true',
 'data?.couponSalesEnabled!==false'
])assert.ok(merchant.includes(x),'Missing Merchant Edge check: '+x);
for(const x of [
 'function adminClubeTermsSection()','adminClubeTermsSection(),',
 'adminClubeTermsLoadFromUi','adminClubeTermsSaveFromUi',
 'Não disponíveis','Minutas e comprovações pendentes',
 'fundingVerified!==false','crypto.randomUUID()'
])assert.ok(adminUi.includes(x),'Missing Admin UI: '+x);
for(const x of [
 'function merchantClubeTermsSection(merchant)',
 'merchantClubeTermsSection(m)','merchantClubeTermsLoadFromUi',
 'merchantClubeTermsReplyFromUi','Li e quero conversar',
 'Não tenho interesse','Nenhum custeio está comprovado',
 'Esta resposta não é aceite contratual'
])assert.ok(merchantUi.includes(x),'Missing merchant UX: '+x);
assert.ok(boot.includes('merchantClubeTermsReplyFromUi'));
assert.ok(boot.includes('adminClubeTermsSaveFromUi'));
assert.ok(workflow.includes('node tests/clube-terms-preflight-v1-242.mjs'));
new vm.Script(adminUi,{filename:'admin-acquisition.js'});
new vm.Script(merchantUi,{filename:'merchant.js'});
new vm.Script(boot,{filename:'bootstrap.js'});
function extract(s,fn){
 const start=s.indexOf('function '+fn+'('),end=s.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,'Missing function '+fn);
 return s.slice(start,end+2);
}
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const id='11111111-1111-4111-8111-111111111111';
const ctx=vm.createContext({
 adminRuntime:{session:{user:{id}}},adminCurrentRole:()=>'finance',
 adminMoney:n=>'R$ '+(n/100).toFixed(2),esc,Number,String,
 adminClubeTermsState:null,adminClubeTermsBusy:false,adminClubeTermsSaving:new Set()
});
vm.runInContext(extract(adminUi,'adminClubeTermsSection')+'\nthis.view=adminClubeTermsSection;',ctx);
assert.ok(ctx.view().includes('Nenhum orçamento foi reservado'));
ctx.adminClubeTermsState={loadedFor:id,totalReviews:1,rows:[{
 merchantId:id,packageKey:'gas_3x5',companyName:'Empresa <script>x</script>',
 city:'São Gabriel',state:'RS',merchantShareBps:10000,merchantBudgetCents:3000,
 currentInterest:true,currentReview:true,currentTerms:false,
 interestVersion:1,reviewVersion:1,termsVersion:0,termsStatus:null,
 brandShareBps:0,brandBudgetCents:0,platformBudgetCents:0,
 identityDocumentStatus:'not_requested',agreementDocumentStatus:'not_requested',
 fundingDocumentStatus:'not_requested',notes:null,merchantResponse:'none',
 capacity:{merchantPerUseCents:500,brandPerUseCents:0,
 platformPerUseCents:0,maxPackagesIllustrative:2}
}]};
const html=ctx.view();
assert.ok(html.includes('&lt;script&gt;'));
assert.ok(!html.includes('<script>x</script>'));
assert.ok(html.includes('R$ 5.00'));
assert.ok(html.includes('Salvar minuta, sem firmar contrato'));
const mctx=vm.createContext({globalThis:{merchantRuntime:{
 merchant:{merchantId:id,memberRole:'owner'}}},esc,Number,String});
vm.runInContext(extract(merchantUi,'merchantClubeTermsSection')+
 '\nthis.view=merchantClubeTermsSection;',mctx);
assert.ok(mctx.view({merchantId:id,memberRole:'owner'}).includes('Consultar proposta'));
assert.equal(mctx.view({merchantId:id,memberRole:'driver'}),'');
console.log('V1.242 PASS — nonbinding dual-sided negotiation, finance+owner gates, controlled documents, budgets and UI escaping');
