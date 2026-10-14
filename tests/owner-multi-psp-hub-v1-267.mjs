import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261014235956_multi_psp_finance_hub_v1_267.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-acquisition.js');
const boot=read('js/bootstrap.js');
const audit=read('.github/workflows/audit.yml');
for(const phrase of [
 'platform_multi_psp_private_v1_267.report',
 'public.admin_owner_multi_psp_hub_v1_267',
 'public.payment_provider_catalog',
 'public.merchant_sale_payment_attempts',
 'public.merchant_sale_payment_verifications',
 'public.platform_referral_payout_claims_v1_263',
 'public.platform_referral_payout_proofs_v1_264',
 'public.platform_referral_provider_observations_v1_265',
 'catalogFundsFlow','platform_owner_reported',
 'provider_verified_orders',
 'o.provider_transaction_success',
 'o.transaction_reference=x.provider_reference',
 "o.provider_status='success'",
 "o.status_detail='accredited'",
 'order by e.checked_at desc,e.observation_id desc limit 1',
 'ownerDeclaredActiveCents',
 'officialOutgoingLookupImplemented',
 'providerCatalogIsRuntimeVerification',
 'merchantReceiptsProvePlatformPayouts',
 'merchantAndPlatformFundsNettingAllowed',
 "'externalPaidBenefitsCents',null",
 "'noTransfers',true","'readOnly',true",
 'MULTI_PSP_V1_267_ACL_DRIFT'
])assert.ok(sql.includes(phrase),'SQL contract missing: '+phrase);
assert.ok(!/insert\s+into\s+public|update\s+public|delete\s+from\s+public/i.test(sql),
 'Consultation cannot mutate financial rows');
const start=edge.indexOf('// V1.267 — segregated multi-PSP');
const end=edge.indexOf('// V1.266 —',start);
assert.ok(start>=0&&end>start);
const handler=edge.slice(start,end);
for(const phrase of [
 'if(action==="owner-multi-psp-hub")',
 'admin_owner_multi_psp_hub_v1_267',
 'data?.merchantReceiptsProvePlatformPayouts!==false',
 'data?.merchantAndPlatformFundsNettingAllowed!==false',
 'data?.externalPaidBenefitsCents!==null',
 'data.merchantProviders.reduce',
 'data.outgoingProviders.reduce',
 'MERCADOPAGO_PAYOUTS_READ_ACCESS_TOKEN',
 'outgoingPayoutsCredentialProvesApiAuthorization:false',
 'incomingMerchantCredentialsReused:false'
])assert.ok(handler.includes(phrase),'Edge contract missing: '+phrase);
assert.ok(!handler.includes('fetch('));
assert.ok(ui.includes('adminOwnerMultiPspSection()'));
assert.ok(boot.includes('adminOwnerMultiPspLoadFromUi'));
assert.ok(audit.includes('node tests/owner-multi-psp-hub-v1-267.mjs'));
new vm.Script(ui,{filename:'admin-acquisition.js'});
new vm.Script(boot,{filename:'bootstrap.js'});
const actor='11111111-1111-4111-8111-111111111111';
const sample={
 source:'admin_owner_multi_psp_hub_v1_267',month:'2026-10-01',
 timezone:'America/Sao_Paulo',
 merchantCatalogProviders:1,merchantEvidenceRecords:2,
 merchantProviderVerifiedOrders:1,outgoingProviderCategories:4,
 outgoingClaims:1,outgoingClaimsQueried:1,
 providerCatalogIsRuntimeVerification:false,
 merchantReceiptsProvePlatformPayouts:false,
 merchantAndPlatformFundsNettingAllowed:false,
 bankSettlementVerified:false,recipientVerified:false,
 externalPaidBenefitsCents:null,noTransfers:true,noIdentityCollection:true,
 newBenefitsEnabled:false,readOnly:true,
 outgoingPayoutsCredentialConfigured:false,
 outgoingPayoutsCredentialScope:'dedicated_mp_payouts_read_only',
 outgoingPayoutsCredentialProvesApiAuthorization:false,
 incomingMerchantCredentialsReused:false,
 merchantProviders:[{providerKey:'mercadopago',displayName:'Mercado Pago',
  catalogAdapterStatus:'implemented',catalogSupportsLookup:true,
  catalogSupportsWebhook:true,catalogConnectionMode:'oauth',
  catalogVerificationLevel:'provider',catalogFundsFlow:'merchant_direct',
  paymentAttempts:1,evidenceRecords:2,providerVerifiedOrders:1,
  ownerOfFunds:'merchant',outgoingPayoutVerified:false}],
 outgoingProviders:[
 {providerKey:'bank_transfer',displayName:'Banco sem conexão',officialOutgoingLookupImplemented:false,
  claims:0,activeClaims:0,voidedClaims:0,withDocument:0,officiallyQueried:0,
  officialStatusMatched:0,ownerDeclaredActiveCents:0,verifiedBeneficiaryClaims:0,
  bankVerifiedClaims:0,ownerOfFunds:'platform_owner_reported',realTransferProven:false},
 {providerKey:'mercado_pago',displayName:'Mercado Pago Payouts',officialOutgoingLookupImplemented:true,
  claims:1,activeClaims:1,voidedClaims:0,withDocument:1,officiallyQueried:1,
  officialStatusMatched:1,ownerDeclaredActiveCents:1200,verifiedBeneficiaryClaims:0,
  bankVerifiedClaims:0,ownerOfFunds:'platform_owner_reported',realTransferProven:false},
 ...['other','pix'].map(providerKey=>({
  providerKey,displayName:providerKey,officialOutgoingLookupImplemented:false,
  claims:0,activeClaims:0,voidedClaims:0,withDocument:0,officiallyQueried:0,
  officialStatusMatched:0,ownerDeclaredActiveCents:0,
  verifiedBeneficiaryClaims:0,bankVerifiedClaims:0,
  ownerOfFunds:'platform_owner_reported',realTransferProven:false}))
 ]
};
let data=structuredClone(sample),role='superadmin',calls=[],messages=[];
const ctx=vm.createContext({
 adminRuntime:{session:{user:{id:actor}}},
 adminCurrentRole:()=>role,
 document:{getElementById:()=>({value:'2026-10'})},
 adminInvoke:async x=>{calls.push(x);return data;},
 render:()=>{},toast:x=>messages.push(x),
 adminMoney:n=>'R$ '+(n/100).toFixed(2),
 esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 String,Number,Date,Array,Set
});
const a=ui.indexOf('// TAMÃO V1.267 —');
const b=ui.indexOf('// TAMÃO V1.266 —',a);
assert.ok(a>=0&&b>a);
vm.runInContext(ui.slice(a,b),ctx);
assert.ok(!ctx.adminOwnerMultiPspSection().includes('R$ 12.00'));
await ctx.adminOwnerMultiPspLoadFromUi();
assert.equal(calls[0].action,'owner-multi-psp-hub');
assert.equal(calls[0].month,'2026-10-01');
const html=ctx.adminOwnerMultiPspSection();
for(const phrase of ['11','Mercado Pago','R$ 12.00','PSPs no catálogo',
 'Pagamentos dos clientes às revendas','Saídas para benefícios',
 'Não somar ou compensar os fluxos'])
 if(phrase!=='11')assert.ok(html.includes(phrase),'UI missing: '+phrase);
role='finance';
assert.ok(ctx.adminOwnerMultiPspSection().includes('R$ 12.00'));
ctx.adminRuntime.session.user.id='44444444-4444-4444-8444-444444444444';
assert.ok(!ctx.adminOwnerMultiPspSection().includes('R$ 12.00'));
ctx.adminRuntime.session.user.id=actor;
role='support';
assert.equal(ctx.adminOwnerMultiPspSection(),'');
await ctx.adminOwnerMultiPspLoadFromUi();
assert.equal(calls.length,1);
role='superadmin';
data={...sample,outgoingClaims:2};
await ctx.adminOwnerMultiPspLoadFromUi();
assert.ok(messages.some(x=>x.includes('não validados')));
assert.ok(!ctx.adminOwnerMultiPspSection().includes('R$ 12.00'));
console.log('V1.267 PASS: merchant receipts vs founder benefits isolated, no spurious payout proof, role/session protection.');
