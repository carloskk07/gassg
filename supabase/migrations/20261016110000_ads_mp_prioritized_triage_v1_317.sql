-- TAMÃO V1.317 — prioritized READ-ONLY payment event triage.
-- Every risk label describes the LAST provider-verified snapshot in the signed webhook inbox.
-- Not a live PSP lookup and never a substitute for V1.314's fresh provider reconciliation.
create or replace function public.admin_ads_mp_triage_v1_317(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog'
as $body$
declare v_total bigint;v_pending bigint;v_urgent bigint;v_rows jsonb;
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a where a.user_id=p_actor
    and a.active and a.admin_role in ('superadmin','operations','readonly')
 ) then raise exception 'ADS_MP_TRIAGE_ADMIN_DENIED' using errcode='42501';end if;
 with newest as (
  select distinct on (e.merchant_id,e.payment_id)
   e.event_key,e.merchant_id,e.payment_id,e.provider_status,e.provider_status_detail,
   e.amount_cents,e.received_at,e.external_reference
  from public.platform_ads_mp_inbox_v1_316 e
  order by e.merchant_id,e.payment_id,e.received_at desc,e.event_key desc
 ), classification as (
  select e.*, c.status checkout_status,c.payment_id checkout_payment_id,
   c.version checkout_version,
   case
    when c.status='payment_approved' and c.payment_id=e.payment_id and
     (e.provider_status in ('refunded','charged_back') or
       (e.provider_status='approved' and e.provider_status_detail='partially_refunded'))
      then 'possible_reversal'
    when c.status='checkout_ready' and e.provider_status='approved'
       and e.provider_status_detail='accredited' then 'approval_to_verify'
    when c.status='payment_reversed' and e.provider_status='approved'
       and e.provider_status_detail='accredited' then 'post_reversal_activity'
    when c.status='payment_approved' and c.payment_id=e.payment_id and
      e.provider_status='approved' and e.provider_status_detail='accredited'
      then 'aligned_observation'
    when c.status='payment_reversed' and
      (e.provider_status in ('refunded','charged_back') or
       (e.provider_status='approved' and e.provider_status_detail='partially_refunded'))
      then 'aligned_observation'
    when c.status='payment_approved' then 'check_latest_provider_state'
    else 'informational'
   end as triage
  from newest e
  join public.platform_ads_psp_checkouts_v1_314 c on c.merchant_id=e.merchant_id
   and c.external_reference=e.external_reference
 ), classified as (
  select classification.*,
   case triage
    when 'possible_reversal' then 1
    when 'post_reversal_activity' then 1
    when 'check_latest_provider_state' then 2
    when 'approval_to_verify' then 2
    else 3 end as priority
  from classification
 )
 select count(*),
   count(*) filter(where priority in (1,2)),
   count(*) filter(where priority=1)
 into v_total,v_pending,v_urgent from classified;

 with newest as (
  select distinct on (e.merchant_id,e.payment_id)
   e.event_key,e.merchant_id,e.payment_id,e.provider_status,e.provider_status_detail,
   e.amount_cents,e.received_at,e.external_reference
  from public.platform_ads_mp_inbox_v1_316 e
  order by e.merchant_id,e.payment_id,e.received_at desc,e.event_key desc
 ), classified as (
  select e.*,c.status checkout_status,c.payment_id checkout_payment_id,
   case
    when c.status='payment_approved' and c.payment_id=e.payment_id and
      (e.provider_status in ('refunded','charged_back') or
       (e.provider_status='approved' and e.provider_status_detail='partially_refunded'))
      then 'possible_reversal'
    when c.status='checkout_ready' and e.provider_status='approved'
      and e.provider_status_detail='accredited' then 'approval_to_verify'
    when c.status='payment_reversed' and e.provider_status='approved'
      and e.provider_status_detail='accredited' then 'post_reversal_activity'
    when c.status='payment_approved' and c.payment_id=e.payment_id and
      e.provider_status='approved' and e.provider_status_detail='accredited'
      then 'aligned_observation'
    when c.status='payment_reversed' and
      (e.provider_status in ('refunded','charged_back') or
       (e.provider_status='approved' and e.provider_status_detail='partially_refunded'))
      then 'aligned_observation'
    when c.status='payment_approved' then 'check_latest_provider_state'
    else 'informational' end as triage
  from newest e
  join public.platform_ads_psp_checkouts_v1_314 c on c.merchant_id=e.merchant_id
   and c.external_reference=e.external_reference
 ), ordered as (
  select *,case
   when triage in ('possible_reversal','post_reversal_activity') then 1
   when triage in ('approval_to_verify','check_latest_provider_state') then 2
   else 3 end as priority
  from classified
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'merchantId',q.merchant_id,'merchantName',left(m.name,120),
  'eventKey',q.event_key,'paymentId',q.payment_id,
  'providerStatus',q.provider_status,'providerStatusDetail',q.provider_status_detail,
  'amountCents',q.amount_cents,'receivedAt',q.received_at,
  'checkoutStatus',q.checkout_status,'checkoutPaymentId',q.checkout_payment_id,
  'triage',q.triage,'priority',q.priority,
  'canRequestReconciliation',q.checkout_status in ('checkout_ready','payment_approved')
 ) order by q.priority asc,q.received_at desc,q.event_key),'[]'::jsonb)
 into v_rows from (
  select * from ordered order by priority asc,received_at desc,event_key limit 50
 ) q join public.merchants m on m.id=q.merchant_id;
 return jsonb_build_object('source','admin_ads_mp_triage_v1_317',
   'readOnly',true,'totalUniquePaymentObservations',v_total,
   'actionableObservations',v_pending,'priorityOneObservations',v_urgent,
   'rows',v_rows,'automaticReconciliation',false,
   'providerSnapshotOnly',true,'paymentStateChanged',false,
   'adsLive',false,'refundsAlwaysRequireProviderCheck',true);
end;
$body$;
revoke all on function public.admin_ads_mp_triage_v1_317(uuid) from public,anon,authenticated;
grant execute on function public.admin_ads_mp_triage_v1_317(uuid) to service_role;
