import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261013235920_ads_pilot_preflight_v1_237.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-acquisition.js');
const offers=read('supabase/functions/get-offers/index.ts');
const workflow=read('.github/workflows/audit.yml');
new vm.Script(ui,{filename:'admin-acquisition.js'});
const invariants=[
 'ads_internal_v1_237.pilot_preflight',
 'public.admin_ads_pilot_preflight_v1_237',
 'stable security definer',
 'stable security invoker',
 "a.user_id=p_actor and a.active",
 "a.admin_role in ('superadmin','operations','compliance','finance','readonly')",
 'public.merchant_ads_campaigns_v1_233',
 "v_campaign.status='approved_creative'",
 'v_campaign.reviewed_at is not null',
 'v_campaign.reviewed_by is not null',
 'public.merchant_ads_interest_v1_232',
 "m.status='active' and m.online=true",
 'public.merchant_business_details',
 'btrim(d.city)=v_city',
 'upper(btrim(d.state))=v_state',
 'public.market_city_offer_scope(v_city,v_state)',
 'public.catalog_items',
 'public.product_delivery_profiles',
 'ci.available_stock>0 and ci.price_cents>0',
 "ci.price_confirmed_at>=statement_timestamp()-interval '24 hours'",
 'public.merchant_basket_compliance_current(p_merchant,array[ci.product_code])',
 'public.ads_preview_reports_v1_235',
 'public.ads_preview_challenges_v1_235',
 'ch.creative_version=v_campaign.version',
 'not pr.independently_verified and not pr.billable',
 'public.ads_placement_controls_v1_236',
 'v_placement_disabled and v_billing_disabled and v_verified_delivery_disabled',
 "'source','admin_ads_pilot_preflight_v1_237'",
 "'internalPrerequisitesMet',v_prerequisites",
 "'clientPreviewIndependentlyVerified',false",
 "'endToEndCustomerAdDeliveryVerified',false",
 "'adFraudDefenseVerified',false",
 "'customerBasketAvailabilityProven',false",
 "'publicAdsLive',false",
 "'readyToSell',false",
 "'noCharge',true",
 "'billableImpressions',0",
 "'verifiedAdImpressions',0",
 "'adsRevenueCents',0",
 'ADS_PILOT_PREFLIGHT_ACL_DRIFT',
 'revoke all on function public.admin_ads_pilot_preflight_v1_237(uuid,uuid)',
 'grant execute on function public.admin_ads_pilot_preflight_v1_237(uuid,uuid)'
];
for(const text of invariants)assert.ok(sql.includes(text),'Missing SQL safety contract: '+text);
assert.doesNotMatch(sql,/\b(create table|insert into|update public\.|delete from|alter table)\b/i,
  'Preflight must not mutate schema or business data');
assert.doesNotMatch(sql,/grant execute on function public\.admin_ads_pilot_preflight_v1_237[\s\S]*to (anon|authenticated)\b/i);
const actions=[
 '"ads-pilot-preflight"',
 'if(action==="ads-pilot-preflight")',
 'uuid(body.merchantId,"merchantId")',
 'admin_ads_pilot_preflight_v1_237',
 'p_actor:user.id,p_merchant:merchantId',
 'data.internalPrerequisitesMet===checkNames.every(k=>checks[k]===true)',
 'evidenceNames.every(k=>evidence[k]===false)',
 'commercial?.publicAdsLive===false',
 'commercial?.readyToSell===false',
 'commercial?.billableImpressions===0',
 'commercial?.adsRevenueCents===0'
];
for(const text of actions)assert.ok(edge.includes(text),'Missing backend gate: '+text);
const ux=[
 'adminAdsPilotCheckFromUi',
 'adminAdsPilotReadinessFragment(x,adminId)',
 "adminInvoke({action:'ads-pilot-preflight',merchantId})",
 "adminAdsCampaignQueue?.loadedFor===identity",
 "data.campaignVersion!==expectedVersion",
 'adminAdsPilotPending',
 "Date.now()-saved.checkedAt<=120000",
 'data.internalPrerequisitesMet!==names.every(k=>checks[k]===true)',
 'commercial?.readyToSell!==false',
 'merchantEligibleForRealOffers',
 'Pré-requisitos do piloto',
 'Não altera a campanha',
 'Conferir requisitos',
 'Publicidade pública: <strong>desligada</strong>'
];
for(const text of ux)assert.ok(ui.includes(text),'Missing honest UI: '+text);
assert.ok(offers.includes('const chosen = chooseOffers(candidates)'), 'Organic ranking must remain intact');
assert.ok(offers.includes('ads_sponsored_slot_v1_236'), 'Sponsored editorial separate from quotes');
assert.match(workflow,/- name: TAMÃO Ads V1\.237 real-offer pilot evidence contract\s+run: node tests\/ads-pilot-preflight-v1-237\.mjs/);
console.log('V1.237 PASS — pilot eligibility uses offer-scope, private ACL and permanently no billable Ads');
