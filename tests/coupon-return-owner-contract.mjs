import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261027202000_coupon_reconciliation_return_owner_guard.sql');
const original=read('supabase/migrations/20261019180000_clube_coupon_order_atomic_checkout.sql');
const audit=read('.github/workflows/audit.yml');

assert.match(migration,/create or replace function public\.clube_coupon_paid_order_reconciliation\(\s*p_order_id uuid/);
assert.match(migration,/security definer set search_path=pg_catalog/,
 'existing privileged RPC and search path must be preserved');
assert.match(migration,/where w\.order_id=p_order_id\s+and w\.user_id=v_application\.customer_user_id\s+and w\.bucket='cashback' and w\.entry_type='cashback_release'/,
 'a wallet release MUST be credited only to the original coupon customer');
assert.match(migration,/w\.metadata->>'invoiceId'=v_invoice\.id::text\s+and w\.metadata->>'voucherId'=v_application\.voucher_id::text/,
 'seed provenance must include BOTH invoice and voucher binding');
assert.match(migration,/v_application\.customer_user_id is distinct from v_order\.customer_id/);
assert.match(migration,/v_invoice\.customer_user_id is distinct from v_order\.customer_id/);
assert.match(migration,/v_application\.original_order_total_cents is distinct from v_order\.total_cents/);
assert.match(migration,/v_application\.original_order_cashback_cents is distinct from v_order\.cashback_reserved_cents/);
assert.match(migration,/when v_order\.status='CANCELLED' and\s+v_release_cents>=v_application\.original_order_cashback_cents\s+then 'CUSTOMER_CREDIT_RETURNED'/,
 'existing cancellation status still requires full credit');
assert.match(migration,/'merchantExternalSettlementVerified',false/,
 'customer refund reporting must never attest merchant bank payout');
assert.match(migration,/revoke all on function public\.clube_coupon_paid_order_reconciliation\(uuid\)\s+from public,anon,authenticated;/);
assert.match(migration,/grant execute on function public\.clube_coupon_paid_order_reconciliation\(uuid\)\s+to service_role;/);
assert.doesNotMatch(migration,/insert into|update public\.|delete from|alter table|create table|grant execute .*authenticated/i,
 'diagnostic SQL migration must not mint cash, create payments or grant public privileges');
assert.match(original,/from public\.wallet_entries w\s+where w\.order_id=p_order_id and w\.bucket='cashback'/,
 'original bug and reason for targeted migration must remain traceable');
assert.match(audit,/node tests\/coupon-return-owner-contract\.mjs/);

// Fixture demonstrates precisely the false-positive canceled-refund status:
// a release tagged to an order but belonging to a DIFFERENT customer.
const orderId='order-1',buyer='buyer-1',other='other-user';
const ledger=[
 {orderId,userId:other,type:'cashback_release',bucket:'cashback',cents:500},
 {orderId:'different-order',userId:buyer,type:'cashback_release',bucket:'cashback',cents:500}
];
const credited=(ownerOnly)=>ledger
 .filter(w=>w.orderId===orderId&&w.bucket==='cashback'&&w.type==='cashback_release'
    &&(!ownerOnly||w.userId===buyer))
 .reduce((sum,w)=>sum+w.cents,0);
assert.equal(credited(false),500,'previous filter falsely certified another user refund');
assert.equal(credited(true),0,'new owner-bound filter must not count foreign wallet entries');
ledger.push({orderId,userId:buyer,type:'cashback_release',bucket:'cashback',cents:500});
assert.equal(credited(true),500,'valid original buyer refund remains confirmable');
console.log('PASS: coupon cancelled order owner-bound cashback return, provenance, grants and no money writes.');
