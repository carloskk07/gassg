-- TAMÃO V1.318 — stale PSP evidence alerts and explicit provider recheck, no autopayment.
create or replace function public.admin_ads_psp_freshness_v1_318(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog'
as $f$
declare v_total bigint;v_attention bigint;v_urgent bigint;v_stale bigint;
 v_overdue bigint;v_reserved bigint;v_rows jsonb;
begin
 if not exists(select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','operations','readonly'))
 then raise exception 'ADS_PSP_FRESHNESS_ACCESS_DENIED' using errcode='42501';end if;
 with base as (
  select c.merchant_id,left(m.name,120) merchant_name,c.status checkout_status,
    c.version checkout_version,c.amount_cents,c.payment_id,c.external_reference,
    c.verified_at,c.reserved_at,c.updated_at,r.due_date,r.status receivable_status,
    e.payment_id inbox_payment_id,e.provider_status inbox_provider_status,
    e.provider_status_detail inbox_provider_detail,e.received_at inbox_received_at
  from public.platform_ads_psp_checkouts_v1_314 c
  join public.merchants m on m.id=c.merchant_id
  join public.platform_ads_receivables_v1_313 r on r.merchant_id=c.merchant_id
  left join lateral (
   select i.payment_id,i.provider_status,i.provider_status_detail,i.received_at
   from public.platform_ads_mp_inbox_v1_316 i
   where i.merchant_id=c.merchant_id and
     (c.payment_id is null or i.payment_id=c.payment_id)
   order by i.received_at desc,i.event_key desc limit 1
  ) e on true
 ), classified as (
  select b.*,
   case
    when b.checkout_status='payment_approved' and (
      b.inbox_provider_status in ('refunded','charged_back') or
      (b.inbox_provider_status='approved' and b.inbox_provider_detail='partially_refunded'))
      and b.inbox_received_at>=b.verified_at then 'possible_reversal'
    when b.checkout_status='payment_reversed' and
      b.inbox_provider_status='approved' and b.inbox_provider_detail='accredited'
      and b.inbox_received_at>b.verified_at then 'activity_after_reversal'
    when b.checkout_status='payment_approved' and
      (b.verified_at is null or b.verified_at<clock_timestamp()-interval '24 hours')
      then 'stale_approved_verification'
    when b.checkout_status='reserved' and b.reserved_at<clock_timestamp()-interval '30 minutes'
      then 'stalled_reservation'
    when b.checkout_status='checkout_ready' and b.due_date<
      (clock_timestamp() at time zone 'America/Sao_Paulo')::date
      then 'overdue_unconfirmed_checkout'
    when b.checkout_status='checkout_ready' and b.inbox_provider_status='approved'
      and b.inbox_provider_detail='accredited' then 'observed_approval_not_reconciled'
    when b.checkout_status='payment_approved' and b.verified_at<clock_timestamp()-interval '6 hours'
      then 'approval_due_for_refresh'
    else 'informational'
   end as reason
  from base b
 ), prioritized as (
  select c.*,
   case when reason in ('possible_reversal','activity_after_reversal',
       'stale_approved_verification','stalled_reservation') then 1
     when reason in ('overdue_unconfirmed_checkout','observed_approval_not_reconciled',
       'approval_due_for_refresh') then 2 else 3 end priority
  from classified c
 ), totals as (
  select count(*) total, count(*) filter(where priority<3) attention,
    count(*) filter(where priority=1) urgent,
    count(*) filter(where reason='stale_approved_verification') stale,
    count(*) filter(where reason='overdue_unconfirmed_checkout') overdue,
    count(*) filter(where reason='stalled_reservation') reserved
  from prioritized
 ), top_rows as (
  select * from prioritized order by priority asc,
    coalesce(verified_at,reserved_at) asc,merchant_id limit 50
 )
 select t.total,t.attention,t.urgent,t.stale,t.overdue,t.reserved,
  (select coalesce(jsonb_agg(jsonb_build_object(
    'merchantId',x.merchant_id,'merchantName',x.merchant_name,
    'checkoutStatus',x.checkout_status,'checkoutVersion',x.checkout_version,
    'amountCents',x.amount_cents,'paymentId',x.payment_id,
    'inboxPaymentId',x.inbox_payment_id,'inboxProviderStatus',x.inbox_provider_status,
    'inboxProviderDetail',x.inbox_provider_detail,'inboxReceivedAt',x.inbox_received_at,
    'verifiedAt',x.verified_at,'dueDate',x.due_date,
    'externalReference',x.external_reference,'reason',x.reason,'priority',x.priority,
    'hoursSinceVerified',case when x.verified_at is null then null else
       least(100000,greatest(0,floor(extract(epoch from (clock_timestamp()-x.verified_at))/3600)::integer)) end,
    'canRequestProviderCheck',x.checkout_status in ('checkout_ready','payment_approved')
      and (x.payment_id is not null or x.inbox_payment_id is not null)
   ) order by x.priority asc,coalesce(x.verified_at,x.reserved_at) asc,x.merchant_id),'[]'::jsonb)
   from top_rows x)
 into v_total,v_attention,v_urgent,v_stale,v_overdue,v_reserved,v_rows
 from totals t;
 return jsonb_build_object('source','admin_ads_psp_freshness_v1_318',
   'readOnly',true,'snapshotOnly',true,'automaticReconciliation',false,
   'paymentStateChanged',false,'adsLive',false,'merchantBillingSeparate',true,
   'totalCheckouts',v_total,'needsReview',v_attention,'urgentCount',v_urgent,
   'staleApprovals',v_stale,'overdueUnconfirmed',v_overdue,
   'stalledReservations',v_reserved,'rows',v_rows);
end;
$f$;
revoke all on function public.admin_ads_psp_freshness_v1_318(uuid) from public,anon,authenticated;
grant execute on function public.admin_ads_psp_freshness_v1_318(uuid) to service_role;

-- Explicit revalidation. Only the existing provider-authenticated Edge endpoint can call
-- this with the latest GET /v1/payments/{id} evidence and a founder session.
create or replace function public.admin_ads_psp_refresh_v1_318(
 p_actor uuid,p_merchant uuid,p_expected_version integer,p_payment_data jsonb,p_request uuid
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog' as $f$
declare v_c public.platform_ads_psp_checkouts_v1_314%rowtype;
 v_sig jsonb;v_previous record;v_version integer;v_response jsonb;
begin
 if not exists(select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active and a.admin_role='superadmin')
 then raise exception 'ADS_PSP_REFRESH_FOUNDER_ONLY' using errcode='42501';end if;
 if p_merchant is null or p_request is null or p_expected_version is null
  or p_expected_version<1 or p_payment_data is null
  or jsonb_typeof(p_payment_data)<>'object'
 then raise exception 'ADS_PSP_REFRESH_INVALID' using errcode='22023';end if;
 v_sig:=jsonb_build_object('actor',p_actor,'merchant',p_merchant,
   'operation','refresh','expectedVersion',p_expected_version,'payment',p_payment_data);
 select request_signature,response into v_previous from public.platform_ads_psp_events_v1_314
 where request_id=p_request;
 if found then
  if v_previous.request_signature is distinct from v_sig
  then raise exception 'ADS_PSP_REFRESH_REQUEST_REUSE' using errcode='23505';end if;
  return v_previous.response||jsonb_build_object('replayed',true);
 end if;
 select * into v_c from public.platform_ads_psp_checkouts_v1_314
 where merchant_id=p_merchant for update;
 if v_c.merchant_id is null or v_c.status<>'payment_approved'
  or v_c.version<>p_expected_version or v_c.payment_id is null
  or p_payment_data->>'payment_id' is distinct from v_c.payment_id
  or p_payment_data->>'external_reference' is distinct from v_c.external_reference
  or p_payment_data->>'collector_id' is distinct from v_c.collector_id
  or p_payment_data->>'amount_cents' is distinct from v_c.amount_cents::text
  or p_payment_data->>'currency_id' is distinct from 'BRL'
  or p_payment_data->>'status' is distinct from 'approved'
  or p_payment_data->>'status_detail' is distinct from 'accredited'
 then raise exception 'ADS_PSP_REFRESH_PROVIDER_EVIDENCE_MISMATCH' using errcode='40001';end if;
 update public.platform_ads_psp_checkouts_v1_314
 set verified_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1,
  provider_status='approved',provider_status_detail='accredited'
 where merchant_id=p_merchant returning version into v_version;
 v_response:=jsonb_build_object('source','admin_ads_psp_refresh_v1_318',
  'merchantId',p_merchant,'status','payment_approved','version',v_version,
  'recorded',true,'replayed',false,'providerRechecked',true,'adsLive',false,
  'noNewCharge',true,'merchantBillingSeparate',true);
 insert into public.platform_ads_psp_events_v1_314(
  request_id,merchant_id,actor_user_id,operation,request_signature,response)
 values(p_request,p_merchant,p_actor,'refresh',v_sig,v_response);
 insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
 values(p_actor,'ads-psp-refresh','merchant',p_merchant::text,
  jsonb_build_object('requestId',p_request,'paymentId',v_c.payment_id,
    'version',v_version,'providerRechecked',true));
 return v_response;
end;
$f$;
revoke all on function public.admin_ads_psp_refresh_v1_318(uuid,uuid,integer,jsonb,uuid)
 from public,anon,authenticated;
grant execute on function public.admin_ads_psp_refresh_v1_318(uuid,uuid,integer,jsonb,uuid)
 to service_role;
