import assert from 'node:assert/strict';
import fs from 'node:fs';

const path = new URL('../supabase/migrations/20261016230500_push_fk_index_hygiene_audit.sql', import.meta.url);
const sql = fs.readFileSync(path, 'utf8');
const expected = [
  ['merchant_push_deliveries_subscription_fk_idx','merchant_push_deliveries','subscription_id'],
  ['merchant_push_outbox_order_fk_idx','merchant_push_outbox','order_id'],
  ['merchant_push_outbox_user_fk_idx','merchant_push_outbox','user_id'],
  ['merchant_push_subscriptions_user_fk_idx','merchant_push_subscriptions','user_id'],
  ['merchant_push_test_runs_merchant_fk_idx','merchant_push_test_runs','merchant_id'],
  ['merchant_push_test_runs_subscription_fk_idx','merchant_push_test_runs','subscription_id'],
];
for (const [name, table, column] of expected) {
  assert.match(sql, new RegExp('create index if not exists\\s+' + name +
    '\\s+on public\\.' + table + '\\s*\\(\\s*' + column + '\\s*\\)', 'i'));
}
assert.equal((sql.match(/create index if not exists/gi) || []).length, expected.length);
assert.doesNotMatch(sql, /\b(drop|delete|truncate|revoke|alter\s+policy)\b/i);
assert.match(sql, /set local lock_timeout/i);
console.log('Push FK index hygiene: PASS (six additive, guarded indexes).');
