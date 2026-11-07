import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261108020000_ads_independent_refund_review_v1_887.sql');
const client=read('js/ads-planner.js');
const admin=read('js/admin-ads-independent.js');
const userEdge=read('supabase/functions/ads-independent/index.ts');
const adminEdge=read('supabase/functions/admin-ops/index.ts');
for(const t of ['ads_independent_refund_cases_v1_887','ads_independent_refund_events_v1_887',
 'ENABLE ROW LEVEL SECURITY','REVOKE ALL ON','ads_independent_refund_request_v1_887',
 'ADS_REFUND_PAYMENT_REQUIRED','ADS_REFUND_CASE_OPEN','record_provider_reversal',
 'ADS_REFUND_PROVIDER_PROOF_REQUIRED','providerReversalRecorded',
 'admin_ads_independent_refunds_read_v1_887','admin_ads_independent_refund_action_v1_887',
 "'moneyMoved',false","'refundIssued',false","status='paused'"])
 assert.ok(sql.includes(t),'V887 missing contract '+t);
assert.doesNotMatch(sql,/mercadoPagoFetch|UPDATE public\.platform_ads_psp_checkouts_v1_314/i);
assert.match(sql,/p_operation='record_provider_reversal'/);
assert.match(sql,/v_payment\.status<>'payment_reversed'/);
assert.match(sql,/p_action IN \('publish','resume'\)/);
assert.match(userEdge,/if\(action==="refund-request"\)/);
assert.match(userEdge,/ads_independent_refund_request_v1_887/);
assert.match(adminEdge,/if\(action==="ads-independent-refunds-read"\)/);
assert.match(adminEdge,/if\(action==="ads-independent-refunds-action"\)/);
assert.match(client,/function tamaoAdsCampaignForm\(\)/);
assert.match(client,/async function tamaoAdsRequestRefund\(campaignId\)/);
assert.match(client,/refundCaseStatus/);
assert.match(admin,/adminIndependentRefundAction/);
assert.match(admin,/providerReversalRecorded/);
for(const [name,code] of Object.entries({client,admin}))
 assert.doesNotThrow(()=>new vm.Script(code,{filename:name+'.js'}),'Invalid JS '+name);
console.log('V1.887 PASS: owner refund intake, pause on request, admin case review and verified reversal only.');
