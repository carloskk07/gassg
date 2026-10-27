import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261027213606_coupon_cancel_return_provenance_guard.sql');
const previous=read('supabase/migrations/20261027202737_coupon_reconciliation_return_owner_guard.sql');
const isolated=read('tests/isolated-supabase-coupon-full-schema.mjs');
const audit=read('.github/workflows/audit.yml');

assert.match(previous,/v_release_cents>=v_application\.original_order_cashback_cents/,
 'original weakness must be traceable before applying new guard');
assert.match(sql,/count\(\*\) filter \(where[\s\S]*?w\.amount_cents=v_application\.original_order_cashback_cents/);
assert.match(sql,/w\.metadata->>'reason'=v_order\.risk_reason/);
assert.match(sql,/right\(w\.idempotency_key,length\(':cashback-release'\)\)=':cashback-release'/);
assert.match(sql,/v_release_count=1 and v_matching_release_count=1/);
assert.match(sql,/v_release_cents=v_application\.original_order_cashback_cents/);
assert.match(sql,/when v_order\.financial_reversed_at is not null then 'REVERSAL_REVIEW'/);
assert.match(sql,/merchantExternalSettlementVerified',false/);
assert.match(sql,/security definer set search_path=pg_catalog/);
assert.match(sql,/revoke all on function public\.clube_coupon_paid_order_reconciliation\(uuid\)\s+from public,anon,authenticated;/);
assert.match(sql,/grant execute on function public\.clube_coupon_paid_order_reconciliation\(uuid\)\s+to service_role;/);
assert.doesNotMatch(sql,/\binsert\s+into\b|\bupdate\s+public\.|\bdelete\s+from\b|\balter\s+table\b|\bcreate\s+table\b/i);
for(const id of ["customer_cancelled_before_accept","admin_cancelled",
 "admin_cancelled_after_dispatch","requote_timeout","rescue_reason"]){
 const release={user:'buyer',order:'order',amount:500,
   key:'action:cashback-release',reason:id};
 const rows=[release];
 const valid=rows.filter(x=>x.user==='buyer'&&x.order==='order');
 const exact=valid.filter(x=>x.amount===500&&x.reason===id&&x.key.endsWith(':cashback-release'));
 assert.equal(valid.length,1);
 assert.equal(exact.length,1);
 assert.equal(valid.reduce((n,x)=>n+x.amount,0),500);
}
const valid={user:'buyer',order:'order',amount:500,
 key:'action:cashback-release',reason:'admin_cancelled_after_dispatch'};
const status=(rows)=> {
 const eligible=rows.filter(x=>x.user==='buyer'&&x.order==='order');
 const matching=eligible.filter(x=>x.amount===500&&x.reason===valid.reason
   &&x.key.endsWith(':cashback-release'));
 return eligible.length===1&&matching.length===1&&
  eligible.reduce((n,x)=>n+x.amount,0)===500?'CUSTOMER_CREDIT_RETURNED':'CANCELLATION_REVIEW';
};
assert.equal(status([valid]),'CUSTOMER_CREDIT_RETURNED');
assert.equal(status([{...valid,reason:'unrelated_cashback_credit'}]),'CANCELLATION_REVIEW');
assert.equal(status([{...valid,key:'unrelated_event'}]),'CANCELLATION_REVIEW');
assert.equal(status([valid,{...valid,key:'duplicate:cashback-release'}]),'CANCELLATION_REVIEW');
assert.equal(status([{...valid,user:'merchant'}]),'CANCELLATION_REVIEW');
assert.equal(status([{...valid,amount:400}]),'CANCELLATION_REVIEW');

for(const needle of ["wrongReason,'CANCELLATION_REVIEW'","wrongKey,'CANCELLATION_REVIEW'",
  "duplicate,'CANCELLATION_REVIEW'","reverted.status,'CUSTOMER_CREDIT_RETURNED'"])
 assert.ok(isolated.includes(needle),'isolated full-schema test requires '+needle);
assert.ok(audit.includes('node tests/coupon-cancel-return-provenance-contract.mjs'));
console.log('PASS: only original buyer refund with exact cancellation reason/key/amount; unrelated and duplicate wallet credits rejected.');
