import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261013213500_merchant_ads_demand_v1_232.sql');
const indexes=read('supabase/migrations/20261013214000_merchant_ads_fk_indexes_v1_232_1.sql');
const merchant=read('js/merchant.js');
const admin=read('js/admin-acquisition.js');
const edge=read('supabase/functions/merchant-ops/index.ts');
const adminEdge=read('supabase/functions/admin-ops/index.ts');
const workflow=read('.github/workflows/audit.yml');
new vm.Script(merchant,{filename:'merchant.js'});
new vm.Script(admin,{filename:'admin-acquisition.js'});
for(const k of [
 'merchant_ads_interest_v1_232','merchant_ads_interest_events_v1_232',
 'alter table public.merchant_ads_interest_v1_232 enable row level security',
 'alter table public.merchant_ads_interest_events_v1_232 enable row level security',
 'revoke all on table public.merchant_ads_interest_v1_232',
 'revoke all on table public.merchant_ads_interest_events_v1_232',
 'growth_internal_v1_232.ads_interest_v1_232','security definer',
 'public.merchant_ads_interest_v1_232','security invoker',
 "mm.active and mm.member_role in ('owner','manager')",
 "p_consent is distinct from true",
 "p_operation not in ('view','register','withdraw')",
 'pg_advisory_xact_lock','v_prev.interested is distinct from true',
 "values(p_merchant_id,p_actor_user_id,'withdraw')",
 'admin_ads_demand_v1_232',
 "a.admin_role in ('superadmin','operations','compliance','finance','readonly')",
 "'noRevenue',true","'adsLive',false","'noCharge',true",
 "'source','merchant_ads_interest_v1_232'"
])assert.ok(sql.includes(k),'SQL safety/contract missing '+k);
assert.ok(!/grant (insert|update|delete|all) on table public\.merchant_ads_interest_v1_232 to service_role/i.test(sql));
assert.ok(!/grant execute on function public\.merchant_ads_interest_v1_232[\s\S]*to (anon|authenticated)/i.test(sql));
for(const k of [
 'if(action==="ads-interest")',"p_actor_user_id:user.id,p_merchant_id:merchantId,p_operation:operation",
 'body.consent!==true','data.noCharge!==true','data.adsLive!==false',
 'if(!canManage(role))'
])assert.ok(edge.includes(k),'Merchant API missing '+k);
for(const k of [
 'if(action==="ads-demand")','p_actor_user_id:user.id',
 'data?.noRevenue===true','data?.noCharge===true'
])assert.ok(adminEdge.includes(k),'Admin API missing '+k);
for(const k of [
 'merchantAdsInterestSection(m)','function merchantAdsInterestRegisterFromUi()',
 "merchantAdsInterestCall('withdraw')",
 "document.getElementById('merchant-ads-consent')?.checked===true",
 "merchantInvoke('merchant-ops',{action:'ads-interest'",
 'O ranking orgânico das revendas não muda'
])assert.ok(merchant.includes(k),'Merchant consent UX missing '+k);
for(const k of [
 'adminAdsDemandSection()','adminAdsDemandLoadFromUi','noRevenue!==true',
 'adminRuntime?.session?.user?.id','Revendas interessadas','R$ 0'
])assert.ok(admin.includes(k),'Admin demand UI missing '+k);
assert.match(workflow,/- name: TAMÃO Ads V1\.232 demand and security contract\s+run: node tests\/merchant-ads-demand-v1-232\.mjs/);
assert.match(indexes,/on public\.merchant_ads_interest_v1_232\(updated_by\)/);
assert.match(indexes,/on public\.merchant_ads_interest_events_v1_232\(actor_user_id\)/);
assert.doesNotMatch(indexes,/\b(drop|update|delete|truncate)\b/i);
console.log('V1.232 PASS — consented interest, withdraw, RBAC, no billing, admin aggregated demand');
