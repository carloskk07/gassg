-- TAMÃO V1.325: merchant-confirmed assistance feedback; never provider delivery proof.
create table public.platform_ads_contact_feedback_v1_325(
 request_id uuid primary key,
 merchant_id uuid not null references public.merchants(id),
 contact_request_id uuid not null unique references public.platform_ads_assistance_contacts_v1_324(request_id),
 actor_user_id uuid not null,
 assistance_version integer not null check(assistance_version>0),
 response text not null check(response in ('contact_confirmed','contact_not_received','followup_needed')),
 request_signature jsonb not null,
 submitted_at timestamptz not null default clock_timestamp()
);
create index ads_contact_feedback_v1_325_merchant_idx on public.platform_ads_contact_feedback_v1_325(merchant_id,submitted_at desc);
alter table public.platform_ads_contact_feedback_v1_325 enable row level security;
revoke all on public.platform_ads_contact_feedback_v1_325 from public,anon,authenticated;
grant select,insert on public.platform_ads_contact_feedback_v1_325 to service_role;

create or replace function public.merchant_ads_contact_feedback_v1_325(
 p_actor uuid,p_merchant uuid,p_operation text,p_contact_request uuid default null,
 p_expected_assistance_version integer default null,p_response text default null,
 p_consent boolean default false,p_request uuid default null
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog' as $fn$
declare v_role text;v_a public.platform_ads_assistance_v1_323%rowtype;
 v_m public.merchants%rowtype;v_interest boolean;v_c public.platform_ads_assistance_contacts_v1_324%rowtype;
 v_f public.platform_ads_contact_feedback_v1_325%rowtype;v_previous public.platform_ads_contact_feedback_v1_325%rowtype;
 v_active boolean;v_sig jsonb;
begin
 select mm.member_role into v_role from public.merchant_members mm
 where mm.merchant_id=p_merchant and mm.user_id=p_actor and mm.active
 and mm.member_role in ('owner','manager') limit 1;
 if v_role is null then raise exception 'ADS_FEEDBACK_MEMBER_DENIED' using errcode='42501';end if;
 if p_operation not in ('view','submit') then
 raise exception 'ADS_FEEDBACK_OPERATION_INVALID' using errcode='22023';end if;
 if p_operation='submit' then
  if v_role<>'owner' or p_consent is distinct from true or p_request is null
    or p_contact_request is null or p_expected_assistance_version is null or p_expected_assistance_version<1
    or p_response not in ('contact_confirmed','contact_not_received','followup_needed')
  then raise exception 'ADS_FEEDBACK_OWNER_CONFIRMATION_REQUIRED' using errcode='42501';end if;
  v_sig:=jsonb_build_object('actor',p_actor,'merchant',p_merchant,
   'contact',p_contact_request,'assistanceVersion',p_expected_assistance_version,
   'response',p_response,'consent',true);
  select * into v_previous from public.platform_ads_contact_feedback_v1_325 where request_id=p_request;
  if found then
    if v_previous.request_signature is distinct from v_sig then
       raise exception 'ADS_FEEDBACK_REQUEST_REUSE' using errcode='23505';end if;
    return jsonb_build_object('source','merchant_ads_contact_feedback_v1_325',
     'merchantId',p_merchant,'recorded',true,'replayed',true,
     'response',v_previous.response,'contactRequestId',v_previous.contact_request_id,
     'messageSent',false,'deliveryProven',false,'adsLive',false,'paymentCreated',false);
  end if;
 end if;
 select * into v_a from public.platform_ads_assistance_v1_323
  where merchant_id=p_merchant for update;
 select * into v_m from public.merchants where id=p_merchant;
 select coalesce(i.interested,false) into v_interest from public.merchant_ads_interest_v1_232 i
  where i.merchant_id=p_merchant;
 v_active:=v_a.merchant_id is not null and v_a.status in ('requested','triaged')
  and v_m.status='active' and coalesce(v_interest,false);
 if v_active then
   select * into v_c from public.platform_ads_assistance_contacts_v1_324 c
   where c.merchant_id=p_merchant and c.recorded_at>=v_a.requested_at
   order by c.recorded_at desc,c.request_id desc limit 1;
   if v_c.request_id is not null then
    select * into v_f from public.platform_ads_contact_feedback_v1_325 f
    where f.contact_request_id=v_c.request_id;
   end if;
 end if;
 if p_operation='view' then
  return jsonb_build_object('source','merchant_ads_contact_feedback_v1_325',
    'merchantId',p_merchant,'readOnly',true,'consentCurrent',v_active,
    'messageSent',false,'deliveryProven',false,'adsLive',false,'paymentCreated',false,
    'assistanceVersion',case when v_a.merchant_id is null then null else v_a.version end,
    'lastContact',case when v_active and v_c.request_id is not null then jsonb_build_object(
       'contactRequestId',v_c.request_id,'reportedOutcome',v_c.outcome,
       'channel',v_c.channel,'reportedAt',v_c.recorded_at,
       'nextFollowupOn',v_c.next_followup_on,
       'adminReportIndependentProof',false,
       'feedback',case when v_f.request_id is null then null else jsonb_build_object(
          'response',v_f.response,'submittedAt',v_f.submitted_at,
          'merchantDeclared',true) end
    ) else null end);
 end if;
 if not v_active or v_a.version<>p_expected_assistance_version or
   v_c.request_id is null or v_c.request_id<>p_contact_request or
   v_c.channel<>v_a.channel or v_f.request_id is not null
 then raise exception 'ADS_FEEDBACK_CONSENT_OR_CONTACT_STALE' using errcode='40001';end if;
 insert into public.platform_ads_contact_feedback_v1_325(
 request_id,merchant_id,contact_request_id,actor_user_id,
 assistance_version,response,request_signature)
 values(p_request,p_merchant,p_contact_request,p_actor,
  p_expected_assistance_version,p_response,v_sig);
 insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
 values(p_actor,'ads-contact-merchant-feedback','merchant',p_merchant::text,
 jsonb_build_object('requestId',p_request,'contactRequestId',p_contact_request,
  'response',p_response,'consentExplicit',true,'deliveryIndependentProof',false));
 return jsonb_build_object('source','merchant_ads_contact_feedback_v1_325',
    'merchantId',p_merchant,'recorded',true,'replayed',false,'response',p_response,
    'contactRequestId',p_contact_request,'messageSent',false,'deliveryProven',false,
    'adsLive',false,'paymentCreated',false);
end;
$fn$;
revoke all on function public.merchant_ads_contact_feedback_v1_325(uuid,uuid,text,uuid,integer,text,boolean,uuid)
 from public,anon,authenticated;
grant execute on function public.merchant_ads_contact_feedback_v1_325(uuid,uuid,text,uuid,integer,text,boolean,uuid)
 to service_role;

create or replace function public.admin_ads_contact_feedback_read_v1_325(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog' as $fn$
declare v_rows jsonb;v_count bigint;v_pending bigint;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a where a.user_id=p_actor
  and a.active and a.admin_role in ('superadmin','operations','readonly'))
 then raise exception 'ADS_FEEDBACK_ADMIN_DENIED' using errcode='42501';end if;
 select count(*) into v_count from public.platform_ads_contact_feedback_v1_325;
 select count(*) into v_pending from public.platform_ads_assistance_v1_323 a
 join public.merchants m on m.id=a.merchant_id
 join public.merchant_ads_interest_v1_232 i on i.merchant_id=a.merchant_id
 join lateral (
  select c.request_id from public.platform_ads_assistance_contacts_v1_324 c
  where c.merchant_id=a.merchant_id and c.recorded_at>=a.requested_at
  order by c.recorded_at desc,c.request_id desc limit 1
 ) latest on true
 left join public.platform_ads_contact_feedback_v1_325 f on f.contact_request_id=latest.request_id
 where a.status in ('requested','triaged') and m.status='active' and i.interested=true
  and f.request_id is null;
 select coalesce(jsonb_agg(jsonb_build_object(
   'merchantId',a.merchant_id,'merchantName',left(m.name,120),
   'assistanceVersion',a.version,'requestStatus',a.status,
   'currentConsent',a.status in ('requested','triaged') and m.status='active' and coalesce(i.interested,false),
   'lastContact',case when c.request_id is null then null else jsonb_build_object(
       'contactRequestId',c.request_id,'reportedOutcome',c.outcome,'reportedAt',c.recorded_at,
       'merchantFeedback',case when f.request_id is null then null else jsonb_build_object(
           'response',f.response,'submittedAt',f.submitted_at,'merchantDeclared',true) end) end
 ) order by a.requested_at desc,a.merchant_id),'[]'::jsonb) into v_rows
 from (select * from public.platform_ads_assistance_v1_323 order by requested_at desc limit 50) a
 join public.merchants m on m.id=a.merchant_id
 left join public.merchant_ads_interest_v1_232 i on i.merchant_id=a.merchant_id
 left join lateral (
  select * from public.platform_ads_assistance_contacts_v1_324 c
  where c.merchant_id=a.merchant_id and c.recorded_at>=a.requested_at
  order by c.recorded_at desc,c.request_id desc limit 1
 ) c on true
 left join public.platform_ads_contact_feedback_v1_325 f on f.contact_request_id=c.request_id;
 return jsonb_build_object('source','admin_ads_contact_feedback_v1_325','readOnly',true,
  'totalMerchantFeedback',v_count,'awaitingMerchantFeedback',v_pending,'rows',v_rows,
  'messagesSent',0,'deliveryProven',false,'adsLive',false,'paymentCreated',false);
end;
$fn$;
revoke all on function public.admin_ads_contact_feedback_read_v1_325(uuid) from public,anon,authenticated;
grant execute on function public.admin_ads_contact_feedback_read_v1_325(uuid) to service_role;
