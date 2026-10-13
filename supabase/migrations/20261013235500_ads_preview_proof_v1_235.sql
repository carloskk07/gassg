-- TAMÃO Ads V1.235 — administrative *preview* diagnostics only.
-- Browser viewability reports are NOT independently verified ad impressions.
-- No public ad placement, tracking, third-party pixels or billing.
create table public.ads_preview_challenges_v1_235 (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique,
 merchant_id uuid not null references public.merchants(id) on delete cascade,
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 creative_version integer not null check(creative_version>0),
 issued_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 check(expires_at>issued_at and expires_at<=issued_at+interval '3 minutes')
);
create index ads_preview_challenges_actor_v1_235
 on public.ads_preview_challenges_v1_235(actor_user_id,issued_at desc);
create index ads_preview_challenges_merchant_v1_235
 on public.ads_preview_challenges_v1_235(merchant_id,issued_at desc);

create table public.ads_preview_reports_v1_235 (
 challenge_id uuid primary key references public.ads_preview_challenges_v1_235(id) on delete cascade,
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 merchant_id uuid not null references public.merchants(id) on delete cascade,
 visible_milliseconds integer not null check(visible_milliseconds between 1500 and 15000),
 visible_percent integer not null check(visible_percent between 50 and 100),
 recorded_at timestamptz not null default clock_timestamp(),
 preview_only boolean not null default true check(preview_only),
 independently_verified boolean not null default false check(not independently_verified),
 billable boolean not null default false check(not billable)
);
create index ads_preview_reports_actor_v1_235
 on public.ads_preview_reports_v1_235(actor_user_id,recorded_at desc);
create index ads_preview_reports_merchant_v1_235
 on public.ads_preview_reports_v1_235(merchant_id,recorded_at desc);

alter table public.ads_preview_challenges_v1_235 enable row level security;
alter table public.ads_preview_reports_v1_235 enable row level security;
revoke all on public.ads_preview_challenges_v1_235 from public,anon,authenticated,service_role;
revoke all on public.ads_preview_reports_v1_235 from public,anon,authenticated,service_role;
create schema if not exists ads_internal_v1_235;
revoke all on schema ads_internal_v1_235 from public,anon,authenticated;
grant usage on schema ads_internal_v1_235 to service_role;

create or replace function ads_internal_v1_235.preview_proof(
 p_actor uuid,p_merchant uuid,p_operation text,
 p_request uuid,p_challenge uuid,p_visible_ms integer,p_visible_percent integer
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare
 c public.merchant_ads_campaigns_v1_233%rowtype;
 h public.ads_preview_challenges_v1_235%rowtype;
 r public.ads_preview_reports_v1_235%rowtype;
 v_now timestamptz:=clock_timestamp();
 v_new boolean:=false;
begin
 if p_actor is null or p_merchant is null or not exists(
  select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','compliance')
 ) then
   raise exception 'ADS_PREVIEW_ACCESS_DENIED' using errcode='42501';
 end if;
 if p_operation is null or p_operation not in ('issue','confirm') then
   raise exception 'ADS_PREVIEW_INVALID_OPERATION' using errcode='22023';
 end if;
 select * into c from public.merchant_ads_campaigns_v1_233
   where merchant_id=p_merchant;
 if not found or c.status<>'approved_creative'
    or not exists(select 1 from public.merchants m
      where m.id=p_merchant and m.status='active')
    or not exists(select 1 from public.merchant_ads_interest_v1_232 i
      where i.merchant_id=p_merchant and i.interested)
 then
   raise exception 'ADS_PREVIEW_CAMPAIGN_NOT_ELIGIBLE' using errcode='22023';
 end if;
 if p_operation='issue' then
   if p_request is null then
     raise exception 'ADS_PREVIEW_REQUEST_REQUIRED' using errcode='22023';
   end if;
   perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('ads-preview-actor:'||p_actor::text,235));
   select * into h from public.ads_preview_challenges_v1_235
    where request_id=p_request;
   if found then
     if h.actor_user_id is distinct from p_actor
        or h.merchant_id is distinct from p_merchant then
       raise exception 'ADS_PREVIEW_REQUEST_REUSED' using errcode='23505';
     end if;
   else
     if (select count(*) from public.ads_preview_challenges_v1_235
           where actor_user_id=p_actor and issued_at>v_now-interval '1 hour')>=20
     then raise exception 'ADS_PREVIEW_RATE_LIMITED' using errcode='22023'; end if;
     insert into public.ads_preview_challenges_v1_235
      (request_id,merchant_id,actor_user_id,creative_version,issued_at,expires_at)
     values(p_request,p_merchant,p_actor,c.version,v_now,v_now+interval '3 minutes')
     returning * into h;
     v_new:=true;
   end if;
   if h.creative_version<>c.version or h.expires_at<=v_now then
     raise exception 'ADS_PREVIEW_CHALLENGE_EXPIRED' using errcode='22023';
   end if;
   return jsonb_build_object('source','ads_preview_proof_v1_235',
     'operation','issue','merchantId',p_merchant,
     'challengeId',h.id,'expiresAt',h.expires_at,
     'title',c.title,'description',c.description,
     'city',c.target_city,'state',c.target_state,
     'creativeVersion',c.version,'newChallenge',v_new,
     'previewOnly',true,'clientReported',true,
     'independentlyVerified',false,'billable',false,'adsLive',false,'noCharge',true);
 end if;

 if p_challenge is null or p_visible_ms is null
    or p_visible_ms not between 1500 and 15000
    or p_visible_percent is null or p_visible_percent not between 50 and 100 then
   raise exception 'ADS_PREVIEW_METRIC_INVALID' using errcode='22023';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ads-preview-challenge:'||p_challenge::text,235));
 select * into h from public.ads_preview_challenges_v1_235
   where id=p_challenge;
 if not found or h.actor_user_id is distinct from p_actor
   or h.merchant_id is distinct from p_merchant
   or h.creative_version<>c.version
 then
   raise exception 'ADS_PREVIEW_CHALLENGE_INVALID' using errcode='42501';
 end if;
 select * into r from public.ads_preview_reports_v1_235 where challenge_id=p_challenge;
 if found then
   if r.actor_user_id<>p_actor or r.merchant_id<>p_merchant
      or r.visible_milliseconds<>p_visible_ms
      or r.visible_percent<>p_visible_percent then
     raise exception 'ADS_PREVIEW_REPLAY_CONFLICT' using errcode='23505';
   end if;
   return jsonb_build_object('source','ads_preview_proof_v1_235',
     'operation','confirm','recorded',true,'idempotent',true,
     'previewOnly',true,'clientReported',true,
     'independentlyVerified',false,'billable',false,'adsLive',false,'noCharge',true);
 end if;
 if h.expires_at<=v_now
    or v_now<h.issued_at+(interval '1 millisecond'*p_visible_ms) then
   raise exception 'ADS_PREVIEW_TIMING_INVALID' using errcode='22023';
 end if;
 insert into public.ads_preview_reports_v1_235
  (challenge_id,actor_user_id,merchant_id,visible_milliseconds,visible_percent)
 values(p_challenge,p_actor,p_merchant,p_visible_ms,p_visible_percent);
 return jsonb_build_object('source','ads_preview_proof_v1_235',
   'operation','confirm','recorded',true,'idempotent',false,
   'previewOnly',true,'clientReported',true,
   'independentlyVerified',false,'billable',false,'adsLive',false,'noCharge',true);
end;
$fn$;
revoke all on function ads_internal_v1_235.preview_proof(uuid,uuid,text,uuid,uuid,integer,integer)
 from public,anon,authenticated,service_role;
grant execute on function ads_internal_v1_235.preview_proof(uuid,uuid,text,uuid,uuid,integer,integer)
 to service_role;

create or replace function public.admin_ads_preview_proof_v1_235(
 p_actor uuid,p_merchant uuid,p_operation text,
 p_request uuid default null,p_challenge uuid default null,
 p_visible_ms integer default null,p_visible_percent integer default null
) returns jsonb language sql volatile security invoker
set search_path=pg_catalog as $wrapper$
 select ads_internal_v1_235.preview_proof($1,$2,$3,$4,$5,$6,$7)
$wrapper$;
revoke all on function public.admin_ads_preview_proof_v1_235(uuid,uuid,text,uuid,uuid,integer,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_ads_preview_proof_v1_235(uuid,uuid,text,uuid,uuid,integer,integer)
 to service_role;

create or replace function ads_internal_v1_235.preview_summary(p_actor uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $fn$
declare v_issued bigint;v_reports bigint;v_last timestamptz;
begin
 if not exists(select 1 from public.platform_admins a
    where a.user_id=p_actor and a.active
      and a.admin_role in ('superadmin','operations','compliance','finance','readonly')) then
   raise exception 'ADS_PREVIEW_SUMMARY_DENIED' using errcode='42501';
 end if;
 select count(*)::bigint into v_issued from public.ads_preview_challenges_v1_235
   where issued_at>=statement_timestamp()-interval '30 days';
 select count(*)::bigint,max(recorded_at) into v_reports,v_last
   from public.ads_preview_reports_v1_235
   where recorded_at>=statement_timestamp()-interval '30 days';
 return jsonb_build_object('source','admin_ads_preview_summary_v1_235',
   'windowDays',30,'previewChallenges',v_issued,
   'clientReportedPreviews',v_reports,'lastPreviewAt',v_last,
   'previewOnly',true,'independentlyVerified',false,
   'verifiedAdImpressions',0,'billableImpressions',0,
   'adsRevenueCents',0,'adsLive',false,'noCharge',true,'readyToSell',false);
end;
$fn$;
revoke all on function ads_internal_v1_235.preview_summary(uuid)
 from public,anon,authenticated,service_role;
grant execute on function ads_internal_v1_235.preview_summary(uuid) to service_role;

create or replace function public.admin_ads_preview_summary_v1_235(p_actor uuid)
returns jsonb language sql stable security invoker
set search_path=pg_catalog as $wrapper$
 select ads_internal_v1_235.preview_summary($1)
$wrapper$;
revoke all on function public.admin_ads_preview_summary_v1_235(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_ads_preview_summary_v1_235(uuid) to service_role;

do $check$
begin
 if has_table_privilege('service_role','public.ads_preview_challenges_v1_235','INSERT')
   or has_table_privilege('service_role','public.ads_preview_reports_v1_235','INSERT')
   or has_table_privilege('anon','public.ads_preview_reports_v1_235','SELECT')
   or has_function_privilege('anon','public.admin_ads_preview_proof_v1_235(uuid,uuid,text,uuid,uuid,integer,integer)','EXECUTE')
   or has_function_privilege('authenticated','public.admin_ads_preview_proof_v1_235(uuid,uuid,text,uuid,uuid,integer,integer)','EXECUTE')
   or not has_function_privilege('service_role','public.admin_ads_preview_summary_v1_235(uuid)','EXECUTE')
 then raise exception 'ADS_PREVIEW_ACL_DRIFT' using errcode='42501';end if;
end;
$check$;