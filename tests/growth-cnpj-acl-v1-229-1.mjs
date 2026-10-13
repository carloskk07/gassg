import assert from 'node:assert/strict';
import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20261013224500_growth_cnpj_first_touch_acl_v1_229_1.sql',import.meta.url),'utf8');
assert.ok(sql.includes('revoke all on table public.growth_merchant_application_attributions_v1_229'));
assert.ok(sql.includes('from service_role'));
assert.ok(sql.includes('grant select,insert on table public.growth_merchant_application_attributions_v1_229'));
for(const permission of ['UPDATE','DELETE','TRUNCATE'])
  assert.ok(sql.includes("'"+permission+"'"),'Missing deny '+permission);
assert.ok(sql.includes('GROWTH_CNPJ_FIRST_TOUCH_ACL_DRIFT'));
assert.ok(!/drop table|create policy|update public\.|delete from public\.|insert into public\./i.test(sql));
console.log('V1.229.1 PASS — service-role first touch is append-only.');
