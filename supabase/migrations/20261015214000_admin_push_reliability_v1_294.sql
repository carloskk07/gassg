-- TAMÃO V1.294 — administrative, read-only Web Push reliability radar.
-- Reports only aggregate facts. No subscription endpoint or key is returned.
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
   select merchant_id,count(*)::integer as tests,
     count(*) filter(where state='provider_accepted')::integer as accepted,
     count(*) filter(where state in ('gateway_rejected','expired','failed'))::integer as failed,
     count(*) filter(where device_report='seen')::integer as seen,
     count(*) filter(where device_report='not_seen')::integer as not_seen,
     count(*) filter(where state='provider_accepted' and device_report is null)::integer as accepted_unconfirmed,
     max(created_at) as last_test
   from public.merchant_push_test_runs
   where created_at >= pg_catalog.now()-interval '7 days'
   group by merchant_id
 ), groups as (
   select coalesce(d.merchant_id,t.merchant_id) merchant_id,
     coalesce(d.devices,0) devices,
     coalesce(t.tests,0) tests,
     coalesce(t.accepted,0) accepted,
     coalesce(t.failed,0) failed,
     coalesce(t.seen,0) seen,
     coalesce(t.not_seen,0) not_seen,
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
     'acceptedUnconfirmed7d',coalesce(sum(accepted_unconfirmed),0)::integer
   ) totals from groups
 ), ranked as (
   select m.id as merchant_id,m.name as merchant_name,
     g.devices,g.tests,g.accepted,g.failed,g.seen,g.not_seen,
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
