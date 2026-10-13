import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=(path)=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261013231000_ads_audience_readiness_v1_234.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-acquisition.js');
const workflow=read('.github/workflows/audit.yml');
new vm.Script(ui,{filename:'admin-acquisition.js'});
for(const part of [
 'public.admin_ads_audience_readiness_v1_234(p_actor_user_id uuid)',
 'stable security invoker',
 "a.user_id=p_actor_user_id and a.active",
 "a.admin_role in ('superadmin','operations','compliance','finance','readonly')",
 'public.prelaunch_marketing_event_daily',
 "m.event_type='landing_view' and m.audience='customer'",
 "m.event_type='landing_view' and m.audience='merchant'",
 "m.event_type='lead_form_view' and m.audience='customer'",
 "m.event_type='lead_form_view' and m.audience='merchant'",
 "m.event_date between v_today-29 and v_today",
 "generate_series(v_today-13,v_today,interval '1 day')",
 'public.merchant_ads_interest_v1_232',
 'public.merchant_ads_campaigns_v1_233',
 'public.merchant_business_details',
 "'metricType','unverified_anonymous_site_events'",
 "'uniqueVisitorsVerified',false",
 "'cityOfVisitorVerified',false",
 "'invalidTrafficFiltered',false",
 "'actualAdDeliveryImplemented',false",
 "'eventDedupAcrossClientsVerified',false",
 "'sourceCanBeSpoofed',true",
 "'readyToSell',false",
 "'verifiedAdImpressions',0",
 "'billableImpressions',0",
 "'verifiedAdClicks',0",
 "'adsRevenueCents',0",
 'ADS_AUDIENCE_ACL_DRIFT',
 'revoke all on function public.admin_ads_audience_readiness_v1_234',
 'grant execute on function public.admin_ads_audience_readiness_v1_234'
])assert.ok(sql.includes(part),'Missing factual or security guarantee: '+part);
assert.doesNotMatch(sql,/\b(create table|insert into|delete from|update public\.)\b/i);
assert.doesNotMatch(sql,/grant execute on function public\.admin_ads_audience_readiness_v1_234[\s\S]*to (anon|authenticated)/i);
for(const part of [
 '"ads-audience-readiness","ads-campaign-queue"',
 'if(action==="ads-audience-readiness")',
 'p_actor_user_id:user.id',
 'data?.metricType==="unverified_anonymous_site_events"',
 'commercial?.readyToSell===false',
 'commercial?.billableImpressions===0',
 'quality.sourceCanBeSpoofed===true',
 'data.daily.length===14'
])assert.ok(edge.includes(part),'Missing API gate: '+part);
const slash=String.fromCharCode(92);
assert.ok(edge.includes('/^20'+slash+'d{2}-'+slash+'d{2}-'+slash+'d{2}$/'),'Date regex has incorrect escape');
for(const part of [
 'adminAdsAudienceSection()',
 'adminAdsAudienceLoadFromUi()',
 "adminInvoke({action:'ads-audience-readiness'})",
 'adminRuntime?.session?.user?.id',
 'data?.evidence?.invalidTrafficFiltered===false',
 'data?.commercial?.billableImpressions===0',
 'Não indicam visitantes únicos',
 '0 impressões publicitárias comprovadas',
 'Demanda declarada pelas revendas, por cidade'
])assert.ok(ui.includes(part),'Missing truthful admin display: '+part);
assert.match(workflow,/- name: TAMÃO Ads V1\.234 audience evidence and revenue safety\s+run: node tests\/ads-audience-readiness-v1-234\.mjs/);
console.log('V1.234 PASS — organic event provenance, city demand only, no fake ad delivery or payment');
