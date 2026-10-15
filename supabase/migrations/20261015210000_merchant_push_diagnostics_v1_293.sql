-- TAMÃO V1.293 — read-only diagnosis, restricted to the signed-in
-- merchant member's active push subscription; no simulated delivery events.
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
   select t.state,t.failure_code,t.device_report,t.created_at
   from public.merchant_push_test_runs t
   join public.merchant_push_subscriptions s on s.id=t.subscription_id
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
   'latestState',(select state from newest),
   'latestFailureCode',(select failure_code from newest),
   'latestReport',(select device_report from newest),
   'latestAt',(select created_at from newest)
 ) into v_result from runs;
 return pg_catalog.coalesce(v_result,'{}'::jsonb);
end $fn$;
revoke all on function public.merchant_push_test_diagnostics(uuid,uuid,text)
 from public,anon,authenticated;
grant execute on function public.merchant_push_test_diagnostics(uuid,uuid,text)
 to service_role;
-- The scheduler, order outbox, VAPID Vault and financial tables are untouched.
