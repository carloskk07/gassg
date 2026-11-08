import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261108042000_ads_independent_homologation_v1_892.sql');
const admin=read('supabase/functions/admin-ops/index.ts');
const intake=read('supabase/functions/ads-independent/index.ts');
const checkout=read('supabase/functions/ads-independent-checkout/index.ts');
const adminUI=read('js/admin-ads-independent.js');
const sponsorUI=read('js/ads-planner.js');
for(const [name,code] of [['admin',adminUI],['sponsor',sponsorUI]])
 assert.doesNotThrow(()=>new vm.Script(code,{filename:name+'.js'}));
for(const needle of [
 'homologation_campaign_id','homologation_expires_at','homologation_approved_by',
 'ads_independent_homologation_events_v1_892','ENABLE ROW LEVEL SECURITY',
 'admin_ads_independent_homologation_v1_892','ADS_HOMOLOGATION_CAMPAIGN_UNVERIFIED',
 'ADS_HOMOLOGATION_EXISTING_CHECKOUT_REVIEW','ADS_HOMOLOGATION_ALREADY_ACTIVE',
 "p_confirmation IS DISTINCT FROM 'HOMOLOGAR'",
 "p_confirmation IS DISTINCT FROM 'CANCELAR'",
 "interval '72 hours'",'homologation_campaign_id=p_campaign',
 'sales_enabled OR','auth.users','is_anonymous IS FALSE',
 "v_campaign.budget_cents<>1990","v_campaign.duration_days<>7",
 'GRANT EXECUTE ON FUNCTION public.ads_independent_checkout_reserve_v1_886',
 'GRANT EXECUTE ON FUNCTION public.admin_ads_independent_homologation_v1_892'
])assert.ok(sql.includes(needle),'Missing supervised PSP gate: '+needle);
assert.match(sql,/REVOKE ALL ON FUNCTION public\.admin_ads_independent_homologation_v1_892/);
assert.doesNotMatch(sql,/UPDATE\s+public\.ads_independent_sales_controls_v1_886\s+SET\s+sales_enabled\s*=\s*true/i);
assert.match(admin,/if\(action==="ads-independent-homologation-action"\)/);
assert.match(admin,/String\(adminAccess\.admin_role\|\|""\)!=="superadmin"/);
assert.match(admin,/admin_ads_independent_homologation_v1_892/);
assert.match(admin,/ADS_MP_ACCESS_TOKEN/);
assert.match(admin,/if\(r?.source/); // existing guards preserved
assert.match(intake,/homologationCampaignId:authorized\?allowedId:null/);
assert.match(intake,/data\.rows\.some/);
assert.match(sponsorUI,/testAuthorized=String\(s\.homologationCampaignId/);
assert.match(sponsorUI,/Pagamento REAL autorizado/);
assert.match(adminUI,/adminIndependentAdsHomologationAction/);
assert.match(adminUI,/HOMOLOGAR/);
assert.match(adminUI,/CANCELAR/);
assert.match(adminUI,/Autorizar uma compra real de R\$ 19,90/);
assert.match(checkout,/ads_independent_checkout_reserve_v1_886/);
console.log('V1.892 PASS: founder-scoped authorization, owner-only UI, no public sale or fake charge.');
