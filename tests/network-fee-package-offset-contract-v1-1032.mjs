import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ddl=read('supabase/migrations/20261116014000_network_fee_package_internal_offset_v1_1032.sql');
const isolated=read('tests/sql/network-fee-package-offset-v1-1032.sql');
const edge=read('supabase/functions/merchant-ops/index.ts');
const ui=read('js/merchant.js');
const flow=read('js/merchant-billing-flow.js');
const audit=read('.github/workflows/audit.yml');
const integration=read('.github/workflows/isolated-supabase-integration.yml');
for(const term of ['network_fee_package_offsets_v1_1032',
  'network_fee_package_offset_allocations_v1_1032',
  'network_fee_offset_prepare_v1_1032','network_fee_offset_status_v1_1032',
  'network_fee_offset_sync_v1_1032','network_fee_offset_source_reversal_v1_1032',
  'network_fee_offset_refund_v1_1032','network_fee_offset_provider_charge_gate_v1_1032',
  'tamao_billing_private.resolve_merchant_billing_payment_request',
  "new.approval_source<>'provider_event'","new.auto_applied is distinct from true",
  "s.state='eligible'","o.state<>'cancelled'",
  "v_plan.purchase_amount_cents-p_amount_cents",
  "v_plan.purchase_amount_cents-100", "v_need:=p_amount_cents*1000000",
  'pg_advisory_xact_lock','network-payout-user:',
  "state='reversal_review'","sales_hold=true",
  "alter table public.network_fee_package_offsets_v1_1032 enable row level security",
  "from public,anon,authenticated,service_role", "'moneyMoved',false"
])assert.ok(ddl.includes(term),'missing protected offset implementation: '+term);
assert.doesNotMatch(ddl,/wallet_entries|grant execute[^;]*(?:anon|authenticated)|POST\s+\/v1\/payouts/i);
for(const term of ['rollback;','OFFSET_TERMS_BYPASS','OFFSET_OTHER_MEMBER_ALLOWED',
 'OFFSET_REPLAY_NOT_IDEMPOTENT','OFFSET_PAYOUT_DOUBLE_SPEND',
 'OFFSET_CANCEL_NOT_RELEASED','OFFSET_PIX_SETTLEMENT_NOT_ATOMIC',
 'OFFSET_SOURCE_REVERSAL_NOT_HELD'])
 assert.ok(isolated.includes(term),'missing isolated regression: '+term);
for(const term of ['network-fee-offset-status','network-fee-offset-prepare',
  'network_fee_offset_status_v1_1032','network_fee_offset_prepare_v1_1032',
  'mutationIdempotencyKey(req)','canManage(role)'])
 assert.ok(edge.includes(term),'missing authenticated merchant endpoint: '+term);
for(const term of ['merchantUseNetworkFeeOffsetFromUi','Usar bonificações',
  'merchantCreateBillingPixLive({planKey})','merchantPrepareNetworkFeeOffsetImpl'])
 assert.ok(ui.includes(term),'missing merchant UI: '+term);
for(const term of ['merchantNetworkFeeOffsetStatusImpl',
 'merchantPrepareNetworkFeeOffsetImpl', "liveIdempotency('network-fee-offset')",
 'merchantBillingSameActor','merchantRefresh({silent:true})',
 "row.expectedAmountCents!==result.remainingPixCents"])
 assert.ok(flow.includes(term),'missing merchant readback: '+term);
assert.ok(audit.includes('node tests/network-fee-package-offset-contract-v1-1032.mjs'));
assert.ok(integration.includes('tests/sql/network-fee-package-offset-v1-1032.sql'));
console.log('PASS V1.1032 verified bonus offset, Pix remainder, no internal sale, RLS, replay & rollback contracts');
