import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261014235945_mp_payout_provider_observations_v1_265.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-acquisition.js');
const boot=read('js/bootstrap.js');
const audit=read('.github/workflows/audit.yml');
for(const v of [
 'platform_referral_provider_observations_v1_265',
 'enable row level security',
 'revoke all on public.platform_referral_provider_observations_v1_265',
 'platform_payout_provider_private_v1_265.target(',
 'platform_payout_provider_private_v1_265.record(',
 'platform_payout_provider_private_v1_265.read(',
 "v.provider<>'mercado_pago'",
 'PAYOUT_PROVIDER_TRANSACTION_REUSED',
 'v_ref:=p_reference=v.provider_reference',
 'v_amt:=p_amount=v.amount_cents',
 "v_success:=p_status='success' and p_detail='accredited'",
 'recipient_verified boolean not null default false check(recipient_verified=false)',
 'bank_settlement_verified boolean not null default false check(bank_settlement_verified=false)',
 "'externalPaidBenefitsCents',null",
 "'bankSettlementVerified',false",
 "'providerTransactionIsBeneficiaryProof',false",
 'public.admin_owner_payout_provider_target_v1_265',
 'public.admin_owner_payout_provider_record_v1_265',
 'public.admin_owner_payout_provider_read_v1_265',
 'PAYOUT_PROVIDER_ACL_DRIFT'
])assert.ok(sql.includes(v),'SQL contract missing: '+v);
const start=edge.indexOf('// V1.265 — read-only lookup');
const end=edge.indexOf('// V1.264 —',start);
assert.ok(start>=0&&end>start);
const provider=edge.slice(start,end);
for(const s of [
 'if(action==="owner-payout-provider-check")',
 'if(action==="owner-payout-provider-read")',
 'admin_owner_payout_provider_target_v1_265',
 'admin_owner_payout_provider_record_v1_265',
 'admin_owner_payout_provider_read_v1_265',
 'MERCADOPAGO_PAYOUTS_READ_ACCESS_TOKEN',
 'outgoing_payouts_credentials_missing',
 'method:"GET"',
 'redirect:"error"',
 'AbortSignal.timeout(9000)',
 '"https://api.mercadopago.com/v1/payouts/"',
 'sha256Hex(raw)',
 'v?.amount?.currency!=="BRL"',
 'amountMatch',
 'observation.recipientVerified!==false',
 'observation.bankSettlementVerified!==false',
 'observation.transferExecuted!==false',
 'externalPaidBenefitsCents!==null',
 'providerTransactionIsBeneficiaryProof!==false',
 'Date.parse(timestamp)>Date.now()+300000'
])assert.ok(provider.includes(s),'Edge Payouts contract missing: '+s);
assert.ok(!provider.includes('method:"POST"'));
assert.ok(!provider.includes('method:"PUT"'));
assert.ok(!provider.includes('v1/payments/'));
assert.ok(!provider.includes('admin.rpc("admin_owner_referral_payout_record_v1_263"'));
for(const term of [
 'adminOwnerPayoutProviderLoadFromUi',
 'adminOwnerPayoutProviderCheckFromUi',
 'adminOwnerPayoutProviderSection()',
 'owner-payout-provider-read',
 'owner-payout-provider-check',
 'outgoing_payouts_credentials_missing',
 'd.bankSettlementVerified!==false',
 'd.recipientVerified!==false'
])assert.ok(ui.includes(term),'UI missing '+term);
assert.ok(boot.includes('adminOwnerPayoutProviderLoadFromUi,adminOwnerPayoutProviderCheckFromUi'));
assert.ok(audit.includes('node tests/owner-mp-payout-provider-v1-265.mjs'));
new vm.Script(ui,{filename:'admin-acquisition.js'});
new vm.Script(boot,{filename:'bootstrap.js'});
const actor='11111111-1111-4111-8111-111111111111';
const claimId='22222222-2222-4222-8222-222222222222';
const sample={
 source:'owner_payout_provider_reconciliation_v1_265',provider:'mercado_pago_payouts_get',
 timezone:'America/Sao_Paulo',month:'2026-10-01',
 totalClaims:2,checkedClaims:1,providerSuccessClaims:1,checkedUnmatchedClaims:0,
 unqueriedClaims:1,limit:30,truncated:false,bankSettlementVerified:false,
 recipientVerified:false,providerTransactionIsBeneficiaryProof:false,
 externalPaidBenefitsCents:null,readOnly:true,noTransfers:true,
 rows:[{claimId,checkedAt:'2026-10-14T19:00:00Z',status:'success',detail:'accredited',
   referenceMatches:true,amountMatches:true,providerTransactionSuccess:true,
   successNow:true,voided:false,proofPresent:true,
   payoutId:'POP01KKYN1QY2SS1MKAY4KP6SSRCT',
   transactionId:'TOP01KKYN1QY2SS1MKAY4G9DV5NK9'},
  {claimId:'33333333-3333-4333-8333-333333333333',checkedAt:null,status:null,
   detail:null,referenceMatches:null,amountMatches:null,
   providerTransactionSuccess:null,successNow:false,voided:false,proofPresent:false,
   payoutId:null,transactionId:null}]
};
const vals={'owner-campaign-signals-month':'2026-10','owner-provider-claim':claimId,
 'owner-provider-payout':'POP01KKYN1QY2SS1MKAY4KP6SSRCT',
 'owner-provider-transaction':'TOP01KKYN1QY2SS1MKAY4G9DV5NK9'};
let role='superadmin',data=structuredClone(sample),calls=[],messages=[];
const context=vm.createContext({
 adminRuntime:{session:{user:{id:actor}}},adminCurrentRole:()=>role,
 document:{getElementById:id=>({value:vals[id]||''})},
 adminInvoke:async x=>{calls.push(x);return x.action==='owner-payout-provider-check'?
   {source:'owner_payout_provider_check_v1_265',configured:false,checked:false,
    reason:'outgoing_payouts_credentials_missing',bankSettlementVerified:false,
    recipientVerified:false,transferExecuted:false}:data;},
 render:()=>{},toast:t=>messages.push(t),
 esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 String,Number,Array,Date
});
const u0=ui.indexOf('// V1.265 —'),u1=ui.indexOf('// TAMÃO V1.264 —',u0);
assert.ok(u0>=0&&u1>u0);
vm.runInContext(ui.slice(u0,u1),context);
await context.adminOwnerPayoutProviderLoadFromUi();
assert.equal(calls[0].action,'owner-payout-provider-read');
assert.equal(calls[0].month,'2026-10-01');
const h=context.adminOwnerPayoutProviderSection();
for(const x of ['1 de 2','success','accredited','Repasses','Beneficiário'])
 assert.ok(h.includes(x),'Missing UI text: '+x);
await context.adminOwnerPayoutProviderCheckFromUi();
assert.equal(calls[1].action,'owner-payout-provider-check');
assert.ok(messages.some(x=>x.includes('credencial exclusiva')));
role='finance';
assert.ok(!context.adminOwnerPayoutProviderSection().includes('Verificar pelo provedor (somente GET)'));
await context.adminOwnerPayoutProviderCheckFromUi();
assert.equal(calls.length,2);
role='readonly';
assert.equal(context.adminOwnerPayoutProviderSection(),'');
role='superadmin';
context.adminRuntime.session.user.id='44444444-4444-4444-8444-444444444444';
assert.ok(!context.adminOwnerPayoutProviderSection().includes('accredited'));
context.adminRuntime.session.user.id=actor;
data={...sample,checkedClaims:2};
await context.adminOwnerPayoutProviderLoadFromUi();
assert.ok(messages.some(x=>x.includes('não validada')));
assert.ok(!context.adminOwnerPayoutProviderSection().includes('accredited'));
console.log('V1.265 PASS: provider Payouts GET only, constrained IDs, disabled without dedicated token, no beneficiary or bank mislabeling.');
