import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261013224000_ads_campaign_review_v1_233.sql');
const merchantEdge=read('supabase/functions/merchant-ops/index.ts');
const adminEdge=read('supabase/functions/admin-ops/index.ts');
const merchant=read('js/merchant.js');
const admin=read('js/admin-acquisition.js');
const workflow=read('.github/workflows/audit.yml');
new vm.Script(merchant,{filename:'merchant.js'});
new vm.Script(admin,{filename:'admin-acquisition.js'});
for(const part of [
 'merchant_ads_campaigns_v1_233','merchant_ads_campaign_events_v1_233',
 "status in ('draft','submitted','approved_creative','needs_changes','withdrawn')",
 'ads_live boolean not null default false check(ads_live=false)',
 'no_charge boolean not null default true check(no_charge=true)',
 'alter table public.merchant_ads_campaigns_v1_233 enable row level security',
 'revoke all on public.merchant_ads_campaigns_v1_233 from public,anon,authenticated,service_role',
 'grant select on public.merchant_ads_campaigns_v1_233 to service_role',
 'ads_internal_v1_233.merchant_campaign','security definer',
 'public.merchant_ads_campaign_v1_233','security invoker',
 "mm.member_role in ('owner','manager')",
 "p_action not in ('view','save','submit','withdraw')",
 "p_action='submit'","i.interested","m.status='active'",
 "ci.merchant_id=p_merchant and ci.active",
 'pg_advisory_xact_lock',
 'ADS_CAMPAIGN_VERSION_CONFLICT',
 'ADS_CAMPAIGN_REQUEST_REUSED',
 "p_action='withdraw'",
 'public.admin_ads_campaign_queue_v1_233',
 "a.admin_role in ('superadmin','operations','compliance','finance','readonly')",
 'ads_internal_v1_233.review_campaign',
 "a.admin_role in ('superadmin','compliance')",
 "c.status<>'submitted'",
 "p_decision='approved_creative'",
 'ADS_CAMPAIGN_EVIDENCE_STALE',
 'ADS_CAMPAIGN_ACL_DRIFT'
]) assert.ok(sql.includes(part),'Missing SQL guarantee: '+part);
assert.ok(!/grant (insert|update|delete|all) on public\.merchant_ads_campaigns_v1_233 to service_role/i.test(sql));
assert.ok(!/grant execute on function public\.admin_ads_campaign_review_v1_233[\s\S]*to (anon|authenticated)/i.test(sql));
for(const part of [
 'if(action==="ads-campaign")','"ads-campaign","ads-interest"',
 'if(!canManage(role))','p_actor:user.id,p_merchant:merchantId,p_action:operation',
 'data?.adsLive!==false||data?.noCharge!==true',
 'if(operation==="save"',
])assert.ok(merchantEdge.includes(part),'Merchant backend missing '+part);
for(const part of [
 'if(action==="ads-campaign-queue")',
 'if(action==="ads-campaign-review")',
 'p_actor:user.id',
 'data.noCharge!==true||data.adsLive!==false',
 '["superadmin","compliance"].includes(String(adminAccess.admin_role))'
])assert.ok(adminEdge.includes(part),'Admin backend missing '+part);
for(const part of [
 'merchantAdsCampaignSection(m)',



 "merchantInvoke('merchant-ops',payload)",
 "crypto.randomUUID()",
 "rt.adsCampaign?.merchantId===id",
 "A revisão não contrata nem veicula publicidade"
])assert.ok(merchant.includes(part),'Merchant UI missing '+part);
for(const part of [
 'adminAdsCampaignSection()','adminAdsCampaignLoadFromUi',
 "adminPerform('ads-campaign-review'",
 'Aprovar somente a peça',
 "data.noCharge!==true||data.adsLive!==false",
 "adminRuntime?.session?.user?.id"
])assert.ok(admin.includes(part),'Admin UX missing '+part);
for(const operation of ['view','submit','withdraw'])
  assert.ok(merchant.includes('merchantAdsCampaignAct('+String.fromCharCode(92)+"'"+operation),
    'Merchant button missing '+operation);
assert.match(workflow,/- name: TAMÃO Ads V1\.233 creative approval without publication\s+run: node tests\/merchant-ads-campaign-v1-233\.mjs/);
console.log('V1.233 PASS — merchant draft, creative review, RBAC, versions, no billing or placement');
