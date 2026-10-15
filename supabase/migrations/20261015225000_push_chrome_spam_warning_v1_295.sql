-- TAMÃO V1.295: Chrome may flag a delivered notification as possible spam.
-- Keep the original voluntary observation immutable; corrective feedback
-- adds one append-only event per test, scoped to the original device/account.
alter table public.merchant_push_test_runs
 drop constraint if exists merchant_push_test_runs_device_report_check;
alter table public.merchant_push_test_runs
 add constraint merchant_push_test_runs_device_report_check
 check (device_report in ('seen','not_seen','spam_warning'));

create table if not exists public.merchant_push_report_corrections (
 run_id uuid primary key references public.merchant_push_test_runs(id) on delete cascade,
 original_report text not null check (original_report in ('seen','not_seen')),
 corrected_report text not null check (corrected_report='spam_warning'),
 reason_code text not null default 'chrome_spam_warning'
   check (reason_code='chrome_spam_warning'),
 corrected_at timestamptz not null default pg_catalog.now()
);
alter table public.merchant_push_report_corrections enable row level security;
revoke all on table public.merchant_push_report_corrections
 from public,anon,authenticated;
grant select,insert on table public.merchant_push_report_corrections to service_role;

create or replace function public.merchant_push_test_correct_spam_warning(
 p_run_id uuid,p_merchant_id uuid,p_user_id uuid,p_endpoint_hash text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare v_run public.merchant_push_test_runs%rowtype; v_existing text;
begin
 if p_endpoint_hash !~ '^[0-9a-f]{64}$' then return '{}'::jsonb; end if;
 select t.* into v_run from public.merchant_push_test_runs t
 join public.merchant_push_subscriptions s on s.id=t.subscription_id
 where t.id=p_run_id and t.user_id=p_user_id and t.merchant_id=p_merchant_id
   and t.state='provider_accepted'
   and t.created_at>pg_catalog.clock_timestamp()-interval '24 hours'
   and s.user_id=p_user_id and s.merchant_id=p_merchant_id
   and s.endpoint_hash=p_endpoint_hash and s.active and s.revoked_at is null
   and exists(select 1 from public.merchant_members mm
     where mm.merchant_id=p_merchant_id and mm.user_id=p_user_id and mm.active
       and mm.member_role in ('owner','manager','operator','driver'))
 for update of t;
 if not found or v_run.device_report not in ('seen','not_seen') then
   return '{}'::jsonb;
 end if;
 insert into public.merchant_push_report_corrections
  (run_id,original_report,corrected_report,reason_code)
 values (p_run_id,v_run.device_report,'spam_warning','chrome_spam_warning')
 on conflict (run_id) do nothing;
 select corrected_report into v_existing
 from public.merchant_push_report_corrections where run_id=p_run_id;
 if v_existing<>'spam_warning' then return '{}'::jsonb; end if;
 return pg_catalog.jsonb_build_object(
   'ok',true,'deviceReport','spam_warning','previousReport',v_run.device_report,
   'receiptKind','manual_user_report','correctionRecorded',true
 );
end $fn$;
revoke all on function public.merchant_push_test_correct_spam_warning(uuid,uuid,uuid,text)
 from public,anon,authenticated;
grant execute on function public.merchant_push_test_correct_spam_warning(uuid,uuid,uuid,text)
 to service_role;

-- Rebuild current effective read models without rewriting historical observations.
create or replace function public.merchant_push_test_latest(
 p_merchant_id uuid, p_user_id uuid, p_endpoint_hash text
) returns jsonb language sql stable security definer set search_path=pg_catalog as $fn$
 select coalesce((
  select pg_catalog.jsonb_build_object(
    'runId',t.id,'state',t.state,
    'providerAccepted',t.state='provider_accepted',
    'deviceReport',coalesce(c.corrected_report,t.device_report),
    'previousReport',case when c.run_id is not null then t.device_report else null end,
    'deviceReportedAt',t.device_reported_at,
    'checkedAt',t.created_at
  )
  from public.merchant_push_test_runs t
  join public.merchant_push_subscriptions s on s.id=t.subscription_id
  left join public.merchant_push_report_corrections c on c.run_id=t.id
  where t.merchant_id=p_merchant_id and t.user_id=p_user_id
    and s.merchant_id=p_merchant_id and s.user_id=p_user_id
    and s.endpoint_hash=p_endpoint_hash and s.active and s.revoked_at is null
    and t.created_at>pg_catalog.clock_timestamp()-interval '24 hours'
    and exists(select 1 from public.merchant_members mm
      where mm.merchant_id=p_merchant_id and mm.user_id=p_user_id and mm.active
        and mm.member_role in ('owner','manager','operator','driver'))
  order by t.created_at desc,t.id desc limit 1
 ),'{}'::jsonb)
$fn$;
revoke all on function public.merchant_push_test_latest(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.merchant_push_test_latest(uuid,uuid,text) to service_role;

-- A report is immutable: a retry with the same value is idempotent, a
-- contradictory report is rejected. Not_seen and seen are user observations.
create or replace function public.merchant_push_test_report(
 p_run_id uuid,p_merchant_id uuid,p_user_id uuid,
 p_endpoint_hash text,p_report text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare v_run public.merchant_push_test_runs%rowtype;
begin
 if p_endpoint_hash !~ '^[0-9a-f]{64}$'
   or p_report not in ('seen','not_seen','spam_warning')
 then return '{}'::jsonb; end if;
 select t.* into v_run from public.merchant_push_test_runs t
 join public.merchant_push_subscriptions s on s.id=t.subscription_id
 where t.id=p_run_id and t.user_id=p_user_id and t.merchant_id=p_merchant_id
   and t.state='provider_accepted'
   and t.created_at>pg_catalog.clock_timestamp()-interval '24 hours'
   and s.user_id=p_user_id and s.merchant_id=p_merchant_id
   and s.endpoint_hash=p_endpoint_hash and s.active and s.revoked_at is null
   and exists(select 1 from public.merchant_members mm
      where mm.merchant_id=p_merchant_id and mm.user_id=p_user_id and mm.active
        and mm.member_role in ('owner','manager','operator','driver'))
 for update of t;
 if not found then return '{}'::jsonb; end if;
 if v_run.device_report is not null and v_run.device_report<>p_report
 then return pg_catalog.jsonb_build_object('conflict',true); end if;
 if v_run.device_report is null then
   update public.merchant_push_test_runs
   set device_report=p_report,device_reported_at=pg_catalog.clock_timestamp()
   where id=p_run_id and device_report is null;
 end if;
 return pg_catalog.jsonb_build_object('ok',true,'deviceReport',p_report);
end $fn$;
revoke all on function public.merchant_push_test_report(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.merchant_push_test_report(uuid,uuid,uuid,text,text) to service_role;

-- No Cron toggle, test sender setting or live order processing is modified.

create or replace function public.merchant_push_test_diagnostics(
  p_merchant_id uuid,p_user_id uuid,p_endpoint_hash text
) returns jsonb language plpgsql stable security definer
  set search_path=pg_catalog as $fn$
declare v_authorized boolean; v_result jsonb;
begin
 if p_endpoint_hash !~ '^[0-9a-f]{64}$' then return '{}'::jsonb; end if;
 select exists (
   select 1 from public.merchant_push_subscriptions s
   where s.merchant_id=p_merchant_id and s.user_id=p_user_id
     and s.endpoint_hash=p_endpoint_hash and s.active
     and s.revoked_at is null
     and exists (
       select 1 from public.merchant_members mm
       where mm.merchant_id=p_merchant_id and mm.user_id=p_user_id
         and mm.active and mm.member_role in ('owner','manager','operator','driver')
     )
 ) into v_authorized;
 if not v_authorized then return '{}'::jsonb; end if;
 with runs as (
   select t.state,t.failure_code,
    coalesce(c.corrected_report,t.device_report) as device_report,t.created_at
   from public.merchant_push_test_runs t
   join public.merchant_push_subscriptions s on s.id=t.subscription_id
   left join public.merchant_push_report_corrections c on c.run_id=t.id
   where s.merchant_id=p_merchant_id and s.user_id=p_user_id
     and s.endpoint_hash=p_endpoint_hash and s.active
     and s.revoked_at is null
     and t.merchant_id=p_merchant_id and t.user_id=p_user_id
     and t.created_at >= pg_catalog.now()-interval '7 days'
 ), newest as (
   select state,failure_code,device_report,created_at
   from runs order by created_at desc limit 1
 )
 select pg_catalog.jsonb_build_object(
   'registered',true,'windowDays',7,
   'tests',count(*)::integer,
   'providerAccepted',count(*) filter(where state='provider_accepted')::integer,
   'providerFailed',count(*) filter(where state in ('failed','gateway_rejected','expired'))::integer,
   'reportedSeen',count(*) filter(where device_report='seen')::integer,
   'reportedNotSeen',count(*) filter(where device_report='not_seen')::integer,
   'reportedWarning',count(*) filter(where device_report='spam_warning')::integer,
   'latestState',(select state from newest),
   'latestFailureCode',(select failure_code from newest),
   'latestReport',(select device_report from newest),
   'latestAt',(select created_at from newest)
 ) into v_result from runs;
 return coalesce(v_result,'{}'::jsonb);
end $fn$;
revoke all on function public.merchant_push_test_diagnostics(uuid,uuid,text)
 from public,anon,authenticated;
grant execute on function public.merchant_push_test_diagnostics(uuid,uuid,text)
 to service_role;
-- The scheduler, order outbox, VAPID Vault and financial tables are untouched.

create or replace function public.admin_merchant_push_reliability_v1_294(
 p_actor uuid
) returns jsonb language plpgsql stable security definer
 set search_path=pg_catalog as $fn$
declare v_role text; v_result jsonb;
begin
 select admin_role into v_role from public.platform_admins
 where user_id=p_actor and active
   and admin_role in ('superadmin','operations','readonly');
 if not found then
   raise exception 'ADMIN_ACCESS_DENIED' using errcode='42501';
 end if;

 with active_devices as (
   select merchant_id,count(*)::integer as devices,
     max(registered_at) as last_registered
   from public.merchant_push_subscriptions
   where active and revoked_at is null
   group by merchant_id
 ), tests as (
   select t.merchant_id,count(*)::integer as tests,
     count(*) filter(where t.state='provider_accepted')::integer as accepted,
     count(*) filter(where t.state in ('gateway_rejected','expired','failed'))::integer as failed,
     count(*) filter(where coalesce(c.corrected_report,t.device_report)='seen')::integer as seen,
     count(*) filter(where coalesce(c.corrected_report,t.device_report)='not_seen')::integer as not_seen,
     count(*) filter(where coalesce(c.corrected_report,t.device_report)='spam_warning')::integer as warned,
     count(*) filter(where t.state='provider_accepted' and t.device_report is null)::integer as accepted_unconfirmed,
     max(t.created_at) as last_test
   from public.merchant_push_test_runs t
   left join public.merchant_push_report_corrections c on c.run_id=t.id
   where t.created_at >= pg_catalog.now()-interval '7 days'
   group by t.merchant_id
 ), groups as (
   select coalesce(d.merchant_id,t.merchant_id) merchant_id,
     coalesce(d.devices,0) devices,
     coalesce(t.tests,0) tests,
     coalesce(t.accepted,0) accepted,
     coalesce(t.failed,0) failed,
     coalesce(t.seen,0) seen,
     coalesce(t.not_seen,0) not_seen,
     coalesce(t.warned,0) warned,
     coalesce(t.accepted_unconfirmed,0) accepted_unconfirmed,
     d.last_registered,t.last_test
   from active_devices d full join tests t on t.merchant_id=d.merchant_id
 ), dashboard as (
   select pg_catalog.jsonb_build_object(
     'registeredDevices',coalesce(sum(devices),0)::integer,
     'merchantsWithDevices',count(*) filter(where devices>0)::integer,
     'tests7d',coalesce(sum(tests),0)::integer,
     'providerAccepted7d',coalesce(sum(accepted),0)::integer,
     'providerFailed7d',coalesce(sum(failed),0)::integer,
     'reportedSeen7d',coalesce(sum(seen),0)::integer,
     'reportedNotSeen7d',coalesce(sum(not_seen),0)::integer,
     'reportedWarning7d',coalesce(sum(warned),0)::integer,
     'acceptedUnconfirmed7d',coalesce(sum(accepted_unconfirmed),0)::integer
   ) totals from groups
 ), ranked as (
   select m.id as merchant_id,m.name as merchant_name,
     g.devices,g.tests,g.accepted,g.failed,g.seen,g.not_seen,g.warned,
     g.accepted_unconfirmed,g.last_test
   from groups g join public.merchants m on m.id=g.merchant_id
   order by g.tests desc,g.devices desc,m.name,m.id
   limit 30
 )
 select pg_catalog.jsonb_build_object(
   'source','admin_push_reliability_v1_294',
   'readOnly',true,'windowDays',7,'checkedAt',pg_catalog.now(),
   'summary',(select totals from dashboard),
   'gates',pg_catalog.jsonb_build_object(
     'senderEnabled',coalesce((select sender_enabled from public.merchant_push_keyring where id),false),
     'cronEnabled',coalesce((select enabled from public.merchant_push_cron_config where id),false),
     'automaticDeliveryVerified',false,
     'realWorldTestStatus',case when
       (select (totals->>'reportedSeen7d')::integer from dashboard)>0
       then 'manual_reports_exist' else 'not_yet_confirmed' end
   ),
   'merchants',coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
       'merchantId',merchant_id,'name',merchant_name,'devices',devices,
       'tests',tests,'providerAccepted',accepted,'providerFailed',failed,
       'reportedSeen',seen,'reportedNotSeen',not_seen,
       'reportedWarning',warned,
       'acceptedUnconfirmed',accepted_unconfirmed,'lastTest',last_test
      ) order by tests desc,devices desc,merchant_name
     ) from ranked),'[]'::jsonb),
   'merchantListLimit',30
 ) into v_result;
 return v_result;
end $fn$;
revoke all on function public.admin_merchant_push_reliability_v1_294(uuid)
 from public,anon,authenticated;
grant execute on function public.admin_merchant_push_reliability_v1_294(uuid)
 to service_role;
-- Deliberately no mutation to Cron, order outbox, sender, payment or VAPID configuration.
