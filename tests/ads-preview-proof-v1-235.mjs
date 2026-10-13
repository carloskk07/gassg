import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261013235500_ads_preview_proof_v1_235.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const admin=read('js/admin-acquisition.js');
const ci=read('.github/workflows/audit.yml');
new vm.Script(admin,{filename:'admin-acquisition.js'});
for(const term of [
  'public.ads_preview_challenges_v1_235',
  'public.ads_preview_reports_v1_235',
  'request_id uuid not null unique',
  'challenge_id uuid primary key',
  "expires_at<=issued_at+interval '3 minutes'",
  'preview_only boolean not null default true check(preview_only)',
  'independently_verified boolean not null default false check(not independently_verified)',
  'billable boolean not null default false check(not billable)',
  'alter table public.ads_preview_challenges_v1_235 enable row level security',
  'alter table public.ads_preview_reports_v1_235 enable row level security',
  'revoke all on public.ads_preview_reports_v1_235 from public,anon,authenticated,service_role',
  'security definer',
  'security invoker',
  "a.admin_role in ('superadmin','compliance')",
  'pg_advisory_xact_lock',
  "p_operation not in ('issue','confirm')",
  "c.status<>'approved_creative'",
  "i.merchant_id=p_merchant and i.interested",
  "m.id=p_merchant and m.status='active'",
  "issued_at>v_now-interval '1 hour'",
  'ADS_PREVIEW_REQUEST_REUSED',
  'ADS_PREVIEW_CHALLENGE_INVALID',
  'ADS_PREVIEW_REPLAY_CONFLICT',
  'ADS_PREVIEW_TIMING_INVALID',
  'r.visible_milliseconds<>p_visible_ms',
  'v_now<h.issued_at+(interval',
  "'clientReported',true",
  "'independentlyVerified',false",
  "'billable',false",
  "'adsRevenueCents',0",
  "'readyToSell',false",
  'ADS_PREVIEW_ACL_DRIFT',
  'grant execute on function public.admin_ads_preview_proof_v1_235',
  'grant execute on function public.admin_ads_preview_summary_v1_235'
])assert.ok(sql.includes(term),'Missing SQL guarantee: '+term);
assert.doesNotMatch(sql,/grant (insert|update|delete) on public\.ads_preview_(challenges|reports)_v1_235 to service_role/i);
for(const term of [
  '"ads-preview-summary"',
  '"ads-campaign-queue"',
  '"ads-preview-issue","ads-preview-confirm"',
  'if(action==="ads-preview-summary")',
  'if(action==="ads-preview-issue"||action==="ads-preview-confirm")',
  'p_actor:user.id,p_merchant:merchantId,p_operation:operation',
  'data?.independentlyVerified===false',
  'data?.billable===false',
  'data.readyToSell!==false',
  'visiblePercent>100',
  'data?.source==="ads_preview_proof_v1_235"'
])assert.ok(edge.includes(term),'Missing backend contract: '+term);
for(const term of [
  'adminAdsPreviewSummarySection()',
  'adminAdsPreviewSummaryLoadFromUi()',
  'adminAdsPreviewRunFromUi',
  "adminPerform('ads-preview-issue'",
  "adminPerform('ads-preview-confirm'",
  "IntersectionObserver",
  "document.visibilityState==='visible'",
  "document.hasFocus()",
  "visibleRatio>=.5",
  "seenMs<1700",
  "result.independentlyVerified!==false",
  "result.billable!==false",
  'Impressões comerciais',
  'Relatos não são provas independentes'
])assert.ok(admin.includes(term),'Missing preview test UI: '+term);
assert.match(ci,/- name: TAMÃO Ads V1\.235 nonbillable preview replay contract\s+run: node tests\/ads-preview-proof-v1-235\.mjs/);
console.log('V1.235 PASS — private viewability preview, replay blocked, no verified impressions or billing');
