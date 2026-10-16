import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(
  new URL('../supabase/migrations/20261016235500_reversal_adjustment_snapshot_integrity_v1_332.sql',import.meta.url),
  'utf8'
);
assert.match(source,/CREATE OR REPLACE FUNCTION public\.reverse_settled_order_financials\(p_order_id uuid, p_reason text, p_reference text DEFAULT NULL::text\)/);
assert.match(source,/SECURITY DEFINER\s+SET search_path TO 'pg_catalog'/);
assert.match(source,/ORDER_NOT_REVERSIBLE/);
assert.match(source,/pg_advisory_xact_lock/);
assert.match(source,/from public\.orders\s+where id=p_order_id\s+for update/i);
assert.equal((source.match(/on conflict\(order_id,adjustment_type\) do nothing;/g)||[]).length,3);
assert.equal((source.match(/v_fee_refund_adjustment_expected:=true;/g)||[]).length,2);
assert.equal((source.match(/v_cashback_recovery_adjustment_expected:=true;/g)||[]).length,1);
assert.match(source,/if v_fee_refund_adjustment_expected and not exists\(/);
assert.match(source,/a\.adjustment_type='platform_fee_refund_due'/);
assert.match(source,/a\.merchant_id=v_receivable\.merchant_id/);
assert.match(source,/a\.direction='platform_owes_merchant'/);
assert.match(source,/a\.amount_cents=v_cash_refund_due/);
assert.match(source,/if v_cashback_recovery_adjustment_expected and not exists\(/);
assert.match(source,/a\.adjustment_type='cashback_reimbursement_recovery_due'/);
assert.match(source,/a\.merchant_id=v_reimbursement\.merchant_id/);
assert.match(source,/a\.direction='merchant_owes_platform'/);
assert.match(source,/a\.amount_cents=v_reimbursement\.cashback_cents/);
assert.match(source,/REVERSAL_FEE_ADJUSTMENT_SNAPSHOT_CONFLICT'[\s\S]*?errcode='23514'/);
assert.match(source,/REVERSAL_CASHBACK_ADJUSTMENT_SNAPSHOT_CONFLICT'[\s\S]*?errcode='23514'/);
const protection=source.indexOf('-- An existing adjustment is not proof');
const reverse=source.indexOf("update public.orders\n  set financial_state='reversed'");
assert.ok(protection>0&&reverse>protection,'verify financial facts before reversed state');
assert.match(source,/update public\.order_reward_grants\s+set reversed_at=/);
assert.match(source,/update public\.merchant_cashback_reimbursements\s+set status='reversed'/);
assert.doesNotMatch(source,/\b(?:DROP|TRUNCATE|GRANT|REVOKE)\s+(?:TABLE|FUNCTION|ON)\b/i);

// Simulate the economic tuple the SQL verifies; an adjustment can change
// operational status without changing the originally recorded debt.
const orderId='order-1',merchantId='merchant-1';
const fee={orderId,merchantId,adjustmentType:'platform_fee_refund_due',
           direction:'platform_owes_merchant',amountCents:379};
const cashback={orderId,merchantId,adjustmentType:'cashback_reimbursement_recovery_due',
                direction:'merchant_owes_platform',amountCents:142};
const sameFact=(observed,required)=>Boolean(observed)
  &&Object.entries(required).every(([key,value])=>observed[key]===value);
for(const fact of [fee,cashback]){
  assert.equal(sameFact({...fact,status:'open'},fact),true,'new adjustment');
  assert.equal(sameFact({...fact,status:'paid'},fact),true,'resolved adjustment');
  assert.equal(sameFact(null,fact),false,'missing financial adjustment');
  for(const change of [
    {orderId:'other-order'},
    {merchantId:'other-merchant'},
    {amountCents:fact.amountCents+1},
    {direction:'not_matching'},
    {adjustmentType:'wrong_type'}
  ])assert.equal(sameFact({...fact,...change},fact),false,
    'reject inconsistent amount, merchant, direction, order or type');
}
console.log('V1.332 PASS: reversal adjustments verified against immutable financial identity before final reversal.');
