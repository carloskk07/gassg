import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ui=read('js/admin-acquisition.js');
const audit=read('.github/workflows/audit.yml');
const from=ui.indexOf('// TAMÃO V1.267 — separate commerce receipts');
const to=ui.indexOf('// TAMÃO V1.266 —',from);
assert.ok(from>=0&&to>from);
const section=ui.slice(from,to);
assert.ok(section.includes('function adminOwnerMultiPspAdapterGuidance(p)'));
assert.ok(section.includes('function adminOwnerMultiPspEvidenceGuidance(p)'));
assert.ok(audit.includes('node tests/owner-psp-readiness-v1-268.mjs'));
new vm.Script(section);
const actor='11111111-1111-4111-8111-111111111111';
const merchant=(providerKey,adapter,mode,attempts,evidence,verified)=>({
 providerKey,displayName:providerKey==='mercadopago'?'<Mercado Pago>':providerKey,
 catalogAdapterStatus:adapter,catalogConnectionMode:mode,
 catalogVerificationLevel:'provider',catalogFundsFlow:'merchant_direct',
 catalogSupportsLookup:mode!=='manual',catalogSupportsWebhook:mode!=='manual',
 paymentAttempts:attempts,evidenceRecords:evidence,providerVerifiedOrders:verified,
 ownerOfFunds:'merchant',outgoingPayoutVerified:false
});
const merchants=[
 merchant('mercadopago','implemented','oauth',2,1,1),
 merchant('stone','ready_for_credentials','api_credentials',0,0,0),
 merchant('manual','implemented','manual',0,0,0)
];
const outgoing=['mercado_pago','pix','bank_transfer','other'].map(providerKey=>({
 providerKey,displayName:providerKey,officialOutgoingLookupImplemented:providerKey==='mercado_pago',
 claims:0,activeClaims:0,voidedClaims:0,withDocument:0,officiallyQueried:0,
 officialStatusMatched:0,ownerDeclaredActiveCents:0,verifiedBeneficiaryClaims:0,
 bankVerifiedClaims:0,ownerOfFunds:'platform_owner_reported',realTransferProven:false
}));
const base={
 source:'admin_owner_multi_psp_hub_v1_267',month:'2026-10-01',
 timezone:'America/Sao_Paulo',
 providerCatalogIsRuntimeVerification:false,merchantReceiptsProvePlatformPayouts:false,
 merchantAndPlatformFundsNettingAllowed:false,bankSettlementVerified:false,
 recipientVerified:false,externalPaidBenefitsCents:null,noTransfers:true,
 noIdentityCollection:true,newBenefitsEnabled:false,readOnly:true,
 merchantCatalogProviders:3,merchantEvidenceRecords:1,merchantProviderVerifiedOrders:1,
 outgoingProviderCategories:4,outgoingClaims:0,outgoingClaimsQueried:0,
 merchantProviders:merchants,outgoingProviders:outgoing,
 outgoingPayoutsCredentialConfigured:false,
 outgoingPayoutsCredentialScope:'dedicated_mp_payouts_read_only',
 outgoingPayoutsCredentialProvesApiAuthorization:false,
 incomingMerchantCredentialsReused:false
};
let data=structuredClone(base),month='2026-10',role='superadmin',calls=[];
const context=vm.createContext({
 adminRuntime:{session:{user:{id:actor}}},adminCurrentRole:()=>role,
 adminInvoke:async args=>{calls.push(args);return data;},
 document:{getElementById:()=>({value:month})},
 toast:msg=>{throw Error(msg);},render:()=>{},
 esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 adminMoney:n=>'R$ '+(n/100).toFixed(2)
});
vm.runInContext(section,context);
assert.match(context.adminOwnerMultiPspAdapterGuidance(merchants[0]),/não comprovad/);
assert.match(context.adminOwnerMultiPspAdapterGuidance(merchants[1]),/Aguardando/);
assert.match(context.adminOwnerMultiPspAdapterGuidance(merchants[2]),/manual/);
assert.match(context.adminOwnerMultiPspEvidenceGuidance(merchants[0]),/evidência do provedor/);
assert.match(context.adminOwnerMultiPspEvidenceGuidance(merchants[1]),/Sem tentativas/);
assert.doesNotMatch(context.adminOwnerMultiPspSection(),/roteiro para ativação real/i);
await context.adminOwnerMultiPspLoadFromUi();
const h=context.adminOwnerMultiPspSection();
assert.match(h,/Roteiro para ativação real/);
assert.match(h,/1 provedores com pedidos que possuem evidência registrada do PSP/);
assert.match(h,/1 opções aguardando configuração\/homologação/);
assert.match(h,/1 modos manuais no catálogo/);
assert.match(h,/sem confirmação automática do banco/);
assert.match(h,/Sem tentativas ou evidências/);
assert.match(h,/&lt;Mercado Pago&gt;/);
assert.doesNotMatch(h,/<Mercado Pago>/);
assert.equal(calls.length,1);
assert.equal(calls[0].action,'owner-multi-psp-hub');
assert.equal(calls[0].month,'2026-10-01');
month='2026-09';
assert.doesNotMatch(context.adminOwnerMultiPspSection(),/Roteiro para ativação real/);
month='2026-10';
role='support';
assert.equal(context.adminOwnerMultiPspSection(),'');
role='finance';
data={...base,merchantProviders:merchants.map(p=>({...p,paymentAttempts:0,evidenceRecords:0,providerVerifiedOrders:0})),
  merchantEvidenceRecords:0,merchantProviderVerifiedOrders:0};
await context.adminOwnerMultiPspLoadFromUi();
assert.match(context.adminOwnerMultiPspSection(),/0 provedores com pedidos que possuem evidência/);
assert.match(context.adminOwnerMultiPspSection(),/Sem tentativas ou evidências/);
console.log('V1.268 PASS: honest provider readiness, true evidence counters, safe roles and month isolation.');
