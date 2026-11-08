import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {summarizeIndependentAdsPspEvidence as summarize} from '../supabase/functions/_shared/ads-independent-psp-evidence.mjs';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const admin=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-ads-independent.js');
const when=Date.parse('2026-10-27T02:30:15.609Z');
const now=Date.parse('2026-11-08T04:00:00Z');
const approved={
 provider:'mercadopago',status:'verified',
 verified_at:'2026-10-27T02:30:15.609448+00:00',
 provider_request_id:'provider-request-id-123456789',
 evidence_sha256:'a'.repeat(64),
 metadata:{topic:'order',action:'order.processed',liveMode:true,signatureVerified:true,
  purpose:'remote_webhook_registration_proof',financialMutationAllowed:false}
};
const check=rows=>summarize({historicalOrderRows:rows,
 approvedEventCount:0,reversalEventCount:0,nowMs:now});
const ok=check([approved]);
assert.equal(ok.historicalSignedOrderWebhookVerified,true);
assert.equal(ok.historicalSignedOrderWebhookVerifiedAt,new Date(when).toISOString());
assert.equal(ok.historicalProofScope,'order.processed');
assert.equal(ok.historicalProofEqualsAdsPaymentWebhook,false);
assert.equal(ok.historicalProofEqualsAdsSeller,false);
assert.equal(ok.adsPaymentWebhookVerified,false);
assert.equal(ok.adsLiveCheckoutHomologated,false);
assert.equal(ok.settlementIndependentlyVerified,false);
assert.equal(ok.previousProofReusedWithoutPayment,true);
assert.equal(ok.adsApprovedPaymentEventCount,0);
assert.equal(ok.adsReversalEventCount,0);
for(const change of [
 {provider:'different'}, {status:'expired'}, {evidence_sha256:'bad'},
 {provider_request_id:'short'}, {verified_at:null},
 {verified_at:'2026-12-01T00:00:00Z'},
 {metadata:{...approved.metadata,signatureVerified:false}},
 {metadata:{...approved.metadata,liveMode:false}},
 {metadata:{...approved.metadata,topic:'payment',action:'payment.updated'}},
 {metadata:{...approved.metadata,topic:'order',action:'order.test'}}
])assert.equal(check([{...approved,...change}]).historicalSignedOrderWebhookVerified,false,
 'Should reject unsupported prior evidence: '+Object.keys(change).join(','));
assert.equal(check([{...approved,status:'expired'},approved]).historicalSignedOrderWebhookVerified,true);
const facts=summarize({historicalOrderRows:[],approvedEventCount:3,reversalEventCount:1,nowMs:now});
assert.equal(facts.adsApprovedPaymentEventCount,3);
assert.equal(facts.adsReversalEventCount,1);
assert.equal(facts.adsPaymentWebhookVerified,false);
assert.equal(facts.adsLiveCheckoutHomologated,false);
for(const bad of [-1,1.5,NaN,Infinity,'1',null])assert.throws(()=>summarize({
 historicalOrderRows:[],approvedEventCount:bad,reversalEventCount:0,nowMs:now
}),/ADS_PSP_HISTORY_INVALID/);
assert.throws(()=>summarize({historicalOrderRows:'forged',nowMs:now}),/ADS_PSP_HISTORY_INVALID/);
assert.match(admin,/summarizeIndependentAdsPspEvidence/);
assert.match(admin,/if\(action==="ads-independent-psp-preflight"\)/);
assert.match(admin,/\.from\("payment_webhook_probes"\)/);
assert.match(admin,/\.contains\("metadata",\{topic:"order",action:"order.processed"/);
assert.match(admin,/\.from\("ads_independent_payment_events_v1_886"\)/);
assert.match(admin,/\.eq\("provider_status","approved"\)/);
assert.match(admin,/\.in\("provider_status",\["refunded","charged_back"\]\)/);
assert.match(admin,/liveWebhookDeliveryVerified:false/);
assert.match(admin,/realPaymentHomologated:false/);
assert.match(admin,/realRefundHomologated:false/);
assert.ok(admin.indexOf('if(action==="ads-independent-psp-preflight")') <
 admin.indexOf('const idempotencyKey='),'Read-only check must remain free of a financial mutation key');
assert.doesNotThrow(()=>new vm.Script(ui));
assert.match(ui,/Validações anteriores reaproveitadas/);
assert.match(ui,/historicalSignedOrderWebhookVerified/);
assert.match(ui,/historicalProofEqualsAdsSeller!==false/);
assert.match(ui,/Nenhum valor antigo foi creditado novamente/);
assert.match(ui,/Publicidade independente:/);
assert.doesNotMatch(ui,/Test[e]? de pagamento e reembolso real:<\/strong> ainda não homologado/);
console.log('V1.893 PASS: signed Order proof reused, no false payment/settlement homologation or repeat charge.');
