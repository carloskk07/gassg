-- TAMÃO V1.326 — manually planned return after negative merchant contact feedback.
-- No messages, outbound calls, contract, payment or ad delivery.
create table public.platform_ads_feedback_returns_v1_326(
 contact_request_id uuid primary key references public.platform_ads_assistance_contacts_v1_324(request_id),
 merchant_id uuid not null references public.merchants(id),
 feedback_request_id uuid not null unique references public.platform_ads_contact_feedback_v1_325(request_id),
 assistance_version integer not null check(assistance_version>0),
 status text not null check(status in ('scheduled','canceled')),
 due_on date not null,
 version integer not null check(version>0),
 internal_note text not null check(char_length(internal_note) between 20 and 240),
 updated_by uuid not null,updated_at timestamptz not null default clock_timestamp()
);
create index ads_feedback_returns_v1_326_merchant on public.platform_ads_feedback_returns_v1_326(merchant_id,updated_at desc);
alter table public.platform_ads_feedback_returns_v1_326 enable row level security;
revoke all on public.platform_ads_feedback_returns_v1_326 from public,anon,authenticated;
grant select,insert,update on public.platform_ads_feedback_returns_v1_326 to service_role;

create table public.platform_ads_feedback_return_events_v1_326(
 request_id uuid primary key,merchant_id uuid not null references public.merchants(id),
 contact_request_id uuid not null,actor_user_id uuid not null,
 request_signature jsonb not null,response jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.platform_ads_feedback_return_events_v1_326 enable row level security;
revoke all on public.platform_ads_feedback_return_events_v1_326 from public,anon,authenticated;
grant select,insert on public.platform_ads_feedback_return_events_v1_326 to service_role;

create or replace function public.admin_ads_feedback_returns_read_v1_326(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog' as $f$
declare v_rows jsonb;v_total bigint;v_due bigint;
begin
 if not exists(select 1 from public.platform_admins p where p.user_id=p_actor and p.active
  and p.admin_role in ('superadmin','operations','readonly'))
 then raise exception 'ADS_RETURN_READ_DENIED' using errcode='42501';end if;
 select count(*) into v_total from public.platform_ads_feedback_returns_v1_326;
 select count(*) into v_due from public.platform_ads_feedback_returns_v1_326 r
 join public.platform_ads_assistance_v1_323 a on a.merchant_id=r.merchant_id
 join public.merchants m on m.id=r.merchant_id
 join public.merchant_ads_interest_v1_232 i on i.merchant_id=r.merchant_id
 where r.status='scheduled' and r.due_on<=(clock_timestamp() at time zone 'America/Sao_Paulo')::date
   and a.status in ('requested','triaged') and m.status='active' and i.interested
   and r.contact_request_id=(select c.request_id from public.platform_ads_assistance_contacts_v1_324 c
    where c.merchant_id=r.merchant_id and c.recorded_at>=a.requested_at
    order by c.recorded_at desc,c.request_id desc limit 1);
 select coalesce(jsonb_agg(jsonb_build_object(
  'merchantId',a.merchant_id,'merchantName',left(m.name,120),
  'assistanceVersion',a.version,'contactRequestId',c.request_id,
  'feedbackResponse',f.response,'feedbackAt',f.submitted_at,
  'consentCurrent',a.status in ('requested','triaged') and m.status='active' and coalesce(i.interested,false),
  'returnPlan',case when r.contact_request_id is null then null else jsonb_build_object(
   'status',r.status,'version',r.version,'dueOn',r.due_on,'internalNote',r.internal_note,
   'updatedAt',r.updated_at) end
 ) order by f.submitted_at desc,a.merchant_id),'[]'::jsonb) into v_rows
 from (select * from public.platform_ads_assistance_v1_323 order by requested_at desc limit 100) a
 join public.merchants m on m.id=a.merchant_id
 left join public.merchant_ads_interest_v1_232 i on i.merchant_id=a.merchant_id
 join lateral (select * from public.platform_ads_assistance_contacts_v1_324 c
  where c.merchant_id=a.merchant_id and c.recorded_at>=a.requested_at
  order by c.recorded_at desc,c.request_id desc limit 1) c on true
 join public.platform_ads_contact_feedback_v1_325 f on f.contact_request_id=c.request_id
  and f.response in ('contact_not_received','followup_needed')
 left join public.platform_ads_feedback_returns_v1_326 r on r.contact_request_id=c.request_id;
 return jsonb_build_object('source','admin_ads_feedback_returns_v1_326','readOnly',true,
  'totalPlans',v_total,'followupsDue',v_due,
  'rows',(select coalesce(jsonb_agg(value),'[]'::jsonb) from (
    select value from jsonb_array_elements(v_rows) limit 50) t),
  'messagesSent',0,'contactPerformed',false,'deliveryProven',false,
  'adsLive',false,'paymentCreated',false);
end;
$f$;
revoke all on function public.admin_ads_feedback_returns_read_v1_326(uuid) from public,anon,authenticated;
grant execute on function public.admin_ads_feedback_returns_read_v1_326(uuid) to service_role;

create or replace function public.admin_ads_feedback_return_action_v1_326(
 p_actor uuid,p_merchant uuid,p_contact uuid,p_assistance_version integer,
 p_operation text,p_expected_version integer,p_due_on date,p_note text,p_request uuid
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog' as $f$
declare
 v_a public.platform_ads_assistance_v1_323%rowtype;
 v_c public.platform_ads_assistance_contacts_v1_324%rowtype;
 v_f public.platform_ads_contact_feedback_v1_325%rowtype;
 v_r public.platform_ads_feedback_returns_v1_326%rowtype;
 v_sig jsonb;v_prior record;v_today date;v_status text;v_version integer;v_response jsonb;
begin
 if not exists(select 1 from public.platform_admins a where a.user_id=p_actor and a.active and a.admin_role='superadmin')
 then raise exception 'ADS_RETURN_FOUNDER_ONLY' using errcode='42501';end if;
 if p_merchant is null or p_contact is null or p_request is null
  or p_assistance_version is null or p_assistance_version<1
  or p_expected_version is null or p_expected_version<0
  or p_operation not in ('schedule','cancel') or p_note is null
  or char_length(btrim(p_note)) not between 20 and 240
 then raise exception 'ADS_RETURN_FIELDS_INVALID' using errcode='22023';end if;
 v_today:=(clock_timestamp() at time zone 'America/Sao_Paulo')::date;
 if p_operation='schedule' and (p_due_on is null or p_due_on<v_today+1 or p_due_on>v_today+30)
 then raise exception 'ADS_RETURN_DATE_INVALID' using errcode='22023';end if;
 if p_operation='cancel' and p_due_on is not null
 then raise exception 'ADS_RETURN_CANCEL_DATE_INVALID' using errcode='22023';end if;
 v_sig:=jsonb_build_object('actor',p_actor,'merchant',p_merchant,'contact',p_contact,
 'assistanceVersion',p_assistance_version,'operation',p_operation,
 'expectedVersion',p_expected_version,'dueOn',p_due_on,'note',btrim(p_note));
 select request_signature,response into v_prior from public.platform_ads_feedback_return_events_v1_326
  where request_id=p_request;
 if found then
  if v_prior.request_signature is distinct from v_sig then
   raise exception 'ADS_RETURN_REQUEST_REUSE' using errcode='23505';end if;
  return v_prior.response||jsonb_build_object('replayed',true);
 end if;
 select * into v_a from public.platform_ads_assistance_v1_323 where merchant_id=p_merchant for update;
 if v_a.merchant_id is null or v_a.version<>p_assistance_version
  or v_a.status not in ('requested','triaged')
  or not exists(select 1 from public.merchants m where m.id=p_merchant and m.status='active')
  or not exists(select 1 from public.merchant_ads_interest_v1_232 i where i.merchant_id=p_merchant and i.interested)
 then raise exception 'ADS_RETURN_CONSENT_STALE' using errcode='40001';end if;
 select * into v_c from public.platform_ads_assistance_contacts_v1_324 c
 where c.merchant_id=p_merchant and c.recorded_at>=v_a.requested_at
 order by c.recorded_at desc,c.request_id desc limit 1;
 if v_c.request_id is null or v_c.request_id<>p_contact or v_c.channel<>v_a.channel
 then raise exception 'ADS_RETURN_CONTACT_STALE' using errcode='40001';end if;
 select * into v_f from public.platform_ads_contact_feedback_v1_325 f where f.contact_request_id=p_contact;
 if v_f.request_id is null or v_f.merchant_id<>p_merchant
  or v_f.response not in ('contact_not_received','followup_needed')
 then raise exception 'ADS_RETURN_NEGATIVE_FEEDBACK_REQUIRED' using errcode='40001';end if;
 select * into v_r from public.platform_ads_feedback_returns_v1_326
 where contact_request_id=p_contact for update;
 if v_r.contact_request_id is null then
  if p_operation<>'schedule' or p_expected_version<>0
  then raise exception 'ADS_RETURN_NOT_SCHEDULED' using errcode='40001';end if;
  v_status:='scheduled';v_version:=1;
  insert into public.platform_ads_feedback_returns_v1_326(
   contact_request_id,merchant_id,feedback_request_id,assistance_version,
   status,due_on,version,internal_note,updated_by)
  values(p_contact,p_merchant,v_f.request_id,p_assistance_version,
    v_status,p_due_on,1,btrim(p_note),p_actor);
 else
  if v_r.version<>p_expected_version or v_r.assistance_version<>p_assistance_version
  then raise exception 'ADS_RETURN_VERSION_CONFLICT' using errcode='40001';end if;
  if p_operation='cancel' and v_r.status<>'scheduled'
  then raise exception 'ADS_RETURN_NOT_ACTIVE' using errcode='40001';end if;
  v_status:=case when p_operation='schedule' then 'scheduled' else 'canceled' end;
  v_version:=v_r.version+1;
  update public.platform_ads_feedback_returns_v1_326
  set status=v_status,version=v_version,
   due_on=case when p_operation='schedule' then p_due_on else due_on end,
   internal_note=btrim(p_note),updated_by=p_actor,updated_at=clock_timestamp()
  where contact_request_id=p_contact;
 end if;
 v_response:=jsonb_build_object('source','admin_ads_feedback_return_action_v1_326',
 'merchantId',p_merchant,'contactRequestId',p_contact,'status',v_status,
 'version',v_version,'recorded',true,'replayed',false,
 'messageSent',false,'contactPerformed',false,'deliveryProven',false,
 'adsLive',false,'paymentCreated',false);
 insert into public.platform_ads_feedback_return_events_v1_326(
  request_id,merchant_id,contact_request_id,actor_user_id,request_signature,response)
 values(p_request,p_merchant,p_contact,p_actor,v_sig,v_response);
 insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
 values(p_actor,'ads-feedback-return-'||p_operation,'merchant',p_merchant::text,
 jsonb_build_object('requestId',p_request,'contactRequestId',p_contact,
 'status',v_status,'version',v_version,'dueOn',p_due_on,'noOutreach',true));
 return v_response;
end;
$f$;
revoke all on function public.admin_ads_feedback_return_action_v1_326(uuid,uuid,uuid,integer,text,integer,date,text,uuid)
 from public,anon,authenticated;
grant execute on function public.admin_ads_feedback_return_action_v1_326(uuid,uuid,uuid,integer,text,integer,date,text,uuid)
 to service_role;

create or replace function public.merchant_ads_feedback_return_v1_326(p_actor uuid,p_merchant uuid)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog' as $f$
declare v_role text;v_a public.platform_ads_assistance_v1_323%rowtype;
 v_c public.platform_ads_assistance_contacts_v1_324%rowtype;
 v_r public.platform_ads_feedback_returns_v1_326%rowtype;v_f public.platform_ads_contact_feedback_v1_325%rowtype;
 v_active boolean;
begin
 select mm.member_role into v_role from public.merchant_members mm where mm.user_id=p_actor
 and mm.merchant_id=p_merchant and mm.active and mm.member_role in ('owner','manager') limit 1;
 if v_role is null then raise exception 'ADS_RETURN_MERCHANT_DENIED' using errcode='42501';end if;
 select * into v_a from public.platform_ads_assistance_v1_323 where merchant_id=p_merchant;
 v_active:=v_a.merchant_id is not null and v_a.status in ('requested','triaged')
  and exists(select 1 from public.merchants m where m.id=p_merchant and m.status='active')
  and exists(select 1 from public.merchant_ads_interest_v1_232 i
    where i.merchant_id=p_merchant and i.interested);
 if v_active then
  select * into v_c from public.platform_ads_assistance_contacts_v1_324 c
  where c.merchant_id=p_merchant and c.recorded_at>=v_a.requested_at
  order by c.recorded_at desc,c.request_id desc limit 1;
  select * into v_f from public.platform_ads_contact_feedback_v1_325 f
   where f.contact_request_id=v_c.request_id;
  if v_f.response in ('contact_not_received','followup_needed') then
   select * into v_r from public.platform_ads_feedback_returns_v1_326 r
   where r.contact_request_id=v_c.request_id;
  end if;
 end if;
 return jsonb_build_object('source','merchant_ads_feedback_return_v1_326',
 'merchantId',p_merchant,'readOnly',true,'consentCurrent',v_active,
 'returnPlan',case when v_active and v_r.contact_request_id is not null then
   jsonb_build_object('status',v_r.status,'dueOn',v_r.due_on,'version',v_r.version)
   else null end,
 'messageSent',false,'contactPerformed',false,'deliveryProven',false,
 'adsLive',false,'paymentCreated',false);
end;
$f$;
revoke all on function public.merchant_ads_feedback_return_v1_326(uuid,uuid) from public,anon,authenticated;
grant execute on function public.merchant_ads_feedback_return_v1_326(uuid,uuid) to service_role;
