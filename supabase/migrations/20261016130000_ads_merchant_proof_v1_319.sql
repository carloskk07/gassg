-- TAMÃO V1.319 — merchant-visible payment evidence age and traceable review requests.
-- A webhook is historical context only. Review requests DO NOT verify a payment.
create table public.platform_ads_psp_review_requests_v1_319(
 request_id uuid primary key,
 merchant_id uuid not null references public.merchants(id),
 actor_user_id uuid not null,
 checkout_version integer not null check(checkout_version>0),
 reason text not null check(reason in ('stale_approval','possible_reversal','refresh_due')),
 evidence_sha256 text not null check(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 requested_at timestamptz not null default clock_timestamp()
);
create index platform_ads_psp_review_requests_v1_319_merchant on
 public.platform_ads_psp_review_requests_v1_319(merchant_id,requested_at desc);
alter table public.platform_ads_psp_review_requests_v1_319 enable row level security;
revoke all on public.platform_ads_psp_review_requests_v1_319 from public,anon,authenticated;
grant select,insert on public.platform_ads_psp_review_requests_v1_319 to service_role;

create or replace function public.merchant_ads_psp_evidence_v1_319(
 p_actor uuid,p_merchant uuid,p_operation text default 'view',
 p_expected_version integer default null,p_request uuid default null
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog'
as $f$
declare v_role text;v_c public.platform_ads_psp_checkouts_v1_314%rowtype;
 v_inbox public.platform_ads_mp_inbox_v1_316%rowtype;
 v_last public.platform_ads_psp_review_requests_v1_319%rowtype;
 v_status text;v_age integer;v_recent_reversal boolean;
 v_can_request boolean;v_response jsonb;
begin
 select mm.member_role into v_role from public.merchant_members mm
 where mm.user_id=p_actor and mm.merchant_id=p_merchant and mm.active
 and mm.member_role in ('owner','manager') limit 1;
 if v_role is null then raise exception 'ADS_EVIDENCE_MERCHANT_DENIED' using errcode='42501';end if;
 if p_operation not in ('view','request_review')
 then raise exception 'ADS_EVIDENCE_OPERATION_INVALID' using errcode='22023';end if;
 if p_operation='request_review' and
  (v_role<>'owner' or p_request is null or p_expected_version is null or p_expected_version<1)
 then raise exception 'ADS_EVIDENCE_OWNER_REQUIRED' using errcode='42501';end if;
 select * into v_c from public.platform_ads_psp_checkouts_v1_314 where merchant_id=p_merchant
 for update;
 if v_c.merchant_id is not null then
  select * into v_inbox from public.platform_ads_mp_inbox_v1_316 i
  where i.merchant_id=p_merchant and
   (v_c.payment_id is null or i.payment_id=v_c.payment_id)
  order by i.received_at desc,i.event_key desc limit 1;
 end if;
 select * into v_last from public.platform_ads_psp_review_requests_v1_319
 where merchant_id=p_merchant order by requested_at desc,request_id desc limit 1;
 v_age:=case when v_c.verified_at is null then null else
  least(100000,greatest(0,floor(extract(epoch from (clock_timestamp()-v_c.verified_at))/3600)::integer))
  end;
 v_recent_reversal:=coalesce(
  v_c.status='payment_approved' and v_inbox.received_at>=v_c.verified_at and
  (v_inbox.provider_status in ('refunded','charged_back') or
   (v_inbox.provider_status='approved' and v_inbox.provider_status_detail='partially_refunded')),
  false);
 v_status:=case
  when v_c.merchant_id is null then 'no_checkout'
  when v_c.status='payment_reversed' then 'reversal_recorded'
  when v_recent_reversal then 'reversal_observed_review_required'
  when v_c.status='payment_approved' and (v_age is null or v_age>=24) then 'approval_evidence_stale'
  when v_c.status='payment_approved' and v_age>=6 then 'approval_refresh_recommended'
  when v_c.status='payment_approved' then 'approval_last_verified'
  when v_c.status='reserved' then 'checkout_preparation'
  when v_c.status='checkout_ready' and v_inbox.provider_status='approved' and
   v_inbox.provider_status_detail='accredited' then 'approval_observed_unreconciled'
  when v_c.status='checkout_ready' then 'awaiting_provider_confirmation'
  else 'unknown';
 v_can_request:=v_c.status='payment_approved' and
  v_status in ('reversal_observed_review_required','approval_evidence_stale','approval_refresh_recommended')
  and (v_last.request_id is null or
     v_last.requested_at<=coalesce(v_c.verified_at,'epoch'::timestamptz) or
     v_last.requested_at<clock_timestamp()-interval '12 hours');
 if p_operation='request_review' then
  if v_c.merchant_id is null or v_c.version<>p_expected_version or not v_can_request
   or v_c.document_sha256 is null then
   raise exception 'ADS_EVIDENCE_RECHECK_NOT_ELIGIBLE' using errcode='40001';end if;
  -- Exactly one request UUID can never be silently reassigned to another payment.
  if exists(select 1 from public.platform_ads_psp_review_requests_v1_319 where request_id=p_request)
   then raise exception 'ADS_EVIDENCE_REQUEST_ID_USED' using errcode='23505';end if;
  insert into public.platform_ads_psp_review_requests_v1_319(
   request_id,merchant_id,actor_user_id,checkout_version,reason,evidence_sha256
  ) values(p_request,p_merchant,p_actor,v_c.version,
   case when v_status='reversal_observed_review_required' then 'possible_reversal'
        when v_status='approval_evidence_stale' then 'stale_approval'
        else 'refresh_due' end,v_c.document_sha256);
  insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
  values(p_actor,'ads-psp-review-request','merchant',p_merchant::text,
    jsonb_build_object('requestId',p_request,'checkoutVersion',v_c.version,
       'lastProviderVerifiedAt',v_c.verified_at,'reason',v_status,'noPaymentStateChange',true));
  return jsonb_build_object('source','merchant_ads_psp_evidence_v1_319',
    'merchantId',p_merchant,'requestRecorded',true,'paymentStateChanged',false,
    'providerRechecked',false,'adsLive',false,'merchantBillingSeparate',true);
 end if;
 return jsonb_build_object('source','merchant_ads_psp_evidence_v1_319',
   'merchantId',p_merchant,'readOnly',true,'snapshotOnly',true,
   'providerRechecked',false,'paymentStateChanged',false,'adsLive',false,
   'merchantBillingSeparate',true,'evidence',jsonb_build_object(
      'status',v_status,'checkoutVersion',v_c.version,'paymentId',v_c.payment_id,
      'lastProviderVerifiedAt',v_c.verified_at,'hoursSinceVerified',v_age,
      'lastObservedAt',v_inbox.received_at,'lastObservedStatus',v_inbox.provider_status,
      'lastObservedDetail',v_inbox.provider_status_detail,
      'possibleReversal',v_recent_reversal,
      'reviewRequestedAt',v_last.requested_at,
      'canRequestReview',coalesce(v_can_request,false)));
end;
$f$;
revoke all on function public.merchant_ads_psp_evidence_v1_319(uuid,uuid,text,integer,uuid)
 from public,anon,authenticated;
grant execute on function public.merchant_ads_psp_evidence_v1_319(uuid,uuid,text,integer,uuid)
 to service_role;

create or replace function public.admin_ads_psp_review_requests_v1_319(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog'
as $f$
declare v_rows jsonb;v_total bigint;v_pending bigint;
begin
 if not exists(select 1 from public.platform_admins a where a.user_id=p_actor and a.active
  and a.admin_role in ('superadmin','operations','readonly'))
 then raise exception 'ADS_EVIDENCE_ADMIN_DENIED' using errcode='42501';end if;
 with latest as (
  select distinct on (r.merchant_id) r.*,c.status checkout_status,c.version current_version,
    c.verified_at,c.payment_id,m.name merchant_name
  from public.platform_ads_psp_review_requests_v1_319 r
  join public.platform_ads_psp_checkouts_v1_314 c on c.merchant_id=r.merchant_id
  join public.merchants m on m.id=r.merchant_id
  order by r.merchant_id,r.requested_at desc,r.request_id desc
 ), classified as (
  select *,not (
     verified_at>requested_at and current_version>checkout_version and
     checkout_status in ('payment_approved','payment_reversed')
  ) pending from latest
 )
 select count(*),count(*) filter(where pending),
  coalesce((select jsonb_agg(jsonb_build_object(
    'merchantId',t.merchant_id,'merchantName',left(t.merchant_name,120),
    'requestedAt',t.requested_at,'reason',t.reason,
    'checkoutVersion',t.checkout_version,'currentVersion',t.current_version,
    'checkoutStatus',t.checkout_status,'paymentId',t.payment_id,
    'lastVerifiedAt',t.verified_at,'pending',t.pending
  ) order by t.pending desc,t.requested_at asc,t.merchant_id)
  from (select * from classified order by pending desc,requested_at asc,merchant_id limit 50) t),'[]'::jsonb)
 into v_total,v_pending,v_rows from classified;
 return jsonb_build_object('source','admin_ads_psp_review_requests_v1_319',
   'readOnly',true,'totalRequests',v_total,'pendingRequests',v_pending,
   'rows',v_rows,'paymentStateChanged',false,'automaticReconciliation',false,
   'adsLive',false,'merchantBillingSeparate',true);
end;
$f$;
revoke all on function public.admin_ads_psp_review_requests_v1_319(uuid) from public,anon,authenticated;
grant execute on function public.admin_ads_psp_review_requests_v1_319(uuid) to service_role;
