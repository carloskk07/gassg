import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261013235930_commercial_activation_v1_238.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const admin=read('js/admin-acquisition.js');
const navigation=read('js/admin.js');
const workflow=read('.github/workflows/audit.yml');
new vm.Script(admin,{filename:'admin-acquisition.js'});
for(const term of [
 'growth_internal_v1_238.activation_pulse',
 'public.admin_commercial_activation_v1_238',
 'stable security definer',
 'stable security invoker',
 "a.user_id=p_actor and a.active",
 "a.admin_role in ('superadmin','operations','compliance','finance','readonly')",
 'public.anp_glp_prospects',
 "prospect_status='uncontacted'",
 'public.anp_prospect_invites',
 'revoked_at is null and claimed_at is null',
 'expires_at>v_now',
 'public.prelaunch_leads',
 "lead_type='merchant'",
 'public.merchant_applications',
 "status='pending'",
 'public.merchants',
 "status='active' and online=true",
 'public.merchant_ads_interest_v1_232',
 'public.merchant_ads_campaigns_v1_233',
 "status='approved_creative'",
 'limit 20',
 "'dataMeaning','independent_operational_populations'",
 "'noContactsExposed',true",
 "'noMessagesSent',true",
 "'noSyntheticMerchants',true",
 "'adsLive',false",
 "'adsRevenueCents',0",
 "'noCharge',true",
 "'readOnly',true",
 "'nextAction',v_priority",
 'COMMERCIAL_ACTIVATION_ACL_DRIFT',
 'grant execute on function public.admin_commercial_activation_v1_238(uuid)'
])assert.ok(sql.includes(term),'Missing SQL business/permission requirement: '+term);
assert.doesNotMatch(sql,/\b(create table|insert into|update public\.|delete from|alter table)\b/i,
 'Commercial readiness must remain read-only');
for(const term of [
 '"commercial-activation"',
 'if(action==="commercial-activation")',
 'admin_commercial_activation_v1_238',
 'p_actor:user.id',
 'data?.noMessagesSent===true',
 'data?.noSyntheticMerchants===true',
 'data?.adsRevenueCents===0',
 'counts.merchantsActiveOnline<=counts.merchantsActive',
 'data.prospectCities.length<=20'
])assert.ok(edge.includes(term),'Missing Edge API gate: '+term);
for(const term of [
 'adminCommercialActivationSection()',
 'adminCommercialActivationLoadFromUi',
 "adminInvoke({action:'commercial-activation'})",
 "adminRuntime?.session?.user?.id",
 "'contact_anp_prospects'",
 "'review_applications'",
 "adminSetSection(",
 'Da primeira parceria à primeira venda',
 'Nenhum WhatsApp, convite ou cadastro é enviado automaticamente.',
 'Os números representam bases diferentes:',
 'Ads: R$ 0.'
])assert.ok(admin.includes(term),'Missing truthful operations UI: '+term);
assert.ok(navigation.includes('function adminSetSection(section)'), 'Navigable existing Admin section required');
assert.match(workflow,/- name: TAMÃO V1\.238 real commercial activation contract\s+run: node tests\/commercial-activation-v1-238\.mjs/);
console.log('V1.238 PASS — real merchant activation, independent populations, no contacts sent or Ads revenue');
