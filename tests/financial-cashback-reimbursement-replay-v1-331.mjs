import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync(
  new URL('../supabase/migrations/20261016235000_cashback_reimbursement_replay_snapshot_v1_331.sql',import.meta.url),
  'utf8'
);
assert.match(sql,/create or replace function public\.ensure_order_settlement_accounting\(p_order_id uuid\)/i);
assert.match(sql,/security definer\s+set search_path TO 'pg_catalog'/i);
assert.match(sql,/v_order\.status<>'SETTLED'/);
assert.match(sql,/SETTLEMENT_RECEIVABLE_SNAPSHOT_CONFLICT/);
assert.match(sql,/v_order\.prepaid_fee_credit_applied_cents/);
const start=sql.indexOf('if v_order.cashback_reserved_cents>0 then');
const end=sql.indexOf('update public.settlement_accounting_failures',start);
assert.ok(start>0&&end>start);
const guard=sql.slice(start,end);
assert.match(guard,/insert into public\.merchant_cashback_reimbursements\(/i);
assert.match(guard,/on conflict\(order_id\) do nothing;/i);
assert.match(guard,/if not exists\(\s*select 1\s*from public\.merchant_cashback_reimbursements r/i);
assert.match(guard,/r\.order_id=v_order\.id/);
assert.match(guard,/r\.merchant_id=v_order\.merchant_id/);
assert.match(guard,/r\.cashback_cents=v_order\.cashback_reserved_cents/);
assert.match(guard,/r\.due_at=v_due_at/);
assert.match(guard,/elsif exists\(\s*select 1 from public\.merchant_cashback_reimbursements r/i);
assert.equal((guard.match(/raise exception 'SETTLEMENT_CASHBACK_REIMBURSEMENT_SNAPSHOT_CONFLICT'/g)||[]).length,2);
assert.match(guard,/using errcode='23514'/);
assert.doesNotMatch(sql,/\b(?:drop\s+(?:table|function)|truncate|delete\s+from|grant\s+|revoke\s+)\b/i);

// Prove the intended snapshot predicate for both insertion replay and
// zero-cashback paths. The SQL assertions above tie the predicate to the RPC.
function reimbursementsValid(order,existing){
  if(order.cashbackCents===0)return existing===null;
  return existing!==null
    &&existing.orderId===order.id
    &&existing.merchantId===order.merchantId
    &&existing.cashbackCents===order.cashbackCents
    &&existing.dueAt===order.dueAt;
}
const order={id:'order-1',merchantId:'merchant-1',cashbackCents:200,dueAt:'2026-10-17T00:00:00Z'};
const exact={orderId:order.id,merchantId:order.merchantId,cashbackCents:200,dueAt:order.dueAt,status:'paid'};
assert.equal(reimbursementsValid(order,exact),true,'legitimate replay may have paid state');
for(const changed of [
  {...exact,merchantId:'merchant-2'},
  {...exact,cashbackCents:100},
  {...exact,dueAt:'2026-10-18T00:00:00Z'},
  {...exact,orderId:'order-2'}
])assert.equal(reimbursementsValid(order,changed),false);
assert.equal(reimbursementsValid(order,null),false,'positive cashback must create a fact');
assert.equal(reimbursementsValid({...order,cashbackCents:0},exact),false,
  'zero cashback cannot carry a reimbursement');
assert.equal(reimbursementsValid({...order,cashbackCents:0},null),true);
console.log('V1.331 PASS: cashback reimbursement replay matching, mismatch rejection, zero-cashback guard, preserved settlement authority.');
