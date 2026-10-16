-- TAMÃO V1.323 — merchant-requested Ads help, NEVER implied from interest alone.
create table public.platform_ads_assistance_v1_323(
 merchant_id uuid primary key references public.merchants(id),
 channel text not null check(channel in ('whatsapp','phone','email')),
 request_note text not null check(char_length(request_note) between 20 and 240),
 status text not null check(status in ('requested','triaged','closed','withdrawn')),
 version integer not null check(version>0),
 requested_by uuid not null,requested_at timestamptz not null default clock_timestamp(),
 updated_by uuid not null,updated_at timestamptz not null default clock_timestamp(),
 triaged_at timestamptz,closed_at timestamptz,
 admin_reason text
);
alter table public.platform_ads_assistance_v1_323 enable row level security;
revoke all on public.platform_ads_assistance_v1_323 from public,anon,authenticated;
grant select,insert,update on public.platform_ads_assistance_v1_323 to service_role;
create table public.platform_ads_assistance_actions_v1_323(
 request_id uuid primary key,merchant_id uuid not null references public.merchants(id),
 actor_user_id uuid not null,signature jsonb not null,response jsonb not null,
 occurred_at timestamptz not null default clock_timestamp()
);
create index platform_ads_assistance_actions_merchant_v1_323
 on public.platform_ads_assistance_actions_v1_323(merchant_id,occurred_at desc);
alter table public.platform_ads_assistance_actions_v1_323 enable row level security;
revoke all on public.platform_ads_assistance_actions_v1_323 from public,anon,authenticated;
grant select,insert on public.platform_ads_assistance_actions_v1_323 to service_role;

create or replace function public.merchant_ads_assistance_v1_323(
 p_actor uuid,p_merchant uuid,p_operation text,p_expected_version integer default null,
 p_channel text default null,p_note text default null,p_consent boolean default false,
 p_request uuid default null
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog' as $fn$
declare v_role text;v_record public.platform_ads_assistance_v1_323%rowtype;
 v_interest boolean;v_active boolean;v_sig jsonb;v_old record;
 v_version integer;v_status text;v_response jsonb;
begin
 select mm.member_role into v_role from public.merchant_members mm
 where mm.merchant_id=p_merchant and mm.user_id=p_actor and mm.active
  and mm.member_role in ('owner','manager') limit 1;
 if v_role is null then raise exception 'ADS_ASSISTANCE_MEMBER_DENIED' using errcode='42501';end if;
 if p_operation not in ('view','request','withdraw')
 then raise exception 'ADS_ASSISTANCE_ACTION_INVALID' using errcode='22023';end if;
 select coalesce(i.interested,false) into v_interest
 from public.merchant_ads_interest_v1_232 i where i.merchant_id=p_merchant;
 v_interest:=coalesce(v_interest,false);
 select m.status='active' into v_active from public.merchants m where m.id=p_merchant;
 v_active:=coalesce(v_active,false);
 if p_operation<>'view' then
  if v_role<>'owner' or p_request is null or p_expected_version is null
   or p_expected_version<0 or p_consent is distinct from true
  then raise exception 'ADS_ASSISTANCE_OWNER_CONSENT_REQUIRED' using errcode='42501';end if;
  if p_operation='request' and
    (v_interest is distinct from true or v_active is distinct from true
     or p_channel not in ('whatsapp','phone','email') or p_note is null
     or char_length(btrim(p_note)) not between 20 and 240)
  then raise exception 'ADS_ASSISTANCE_REQUEST_NOT_ELIGIBLE' using errcode='22023';end if;
  v_sig:=jsonb_build_object('actor',p_actor,'merchant',p_merchant,
   'operation',p_operation,'version',p_expected_version,
   'channel',p_channel,'note',p_note,'consent',true);
  select signature,response into v_old from public.platform_ads_assistance_actions_v1_323
   where request_id=p_request;
  if found then
   if v_old.signature is distinct from v_sig
   then raise exception 'ADS_ASSISTANCE_REQUEST_REUSE' using errcode='23505';end if;
   return v_old.response||jsonb_build_object('replayed',true);
  end if;
 end if;
 select * into v_record from public.platform_ads_assistance_v1_323
 where merchant_id=p_merchant for update;
 if p_operation='view' then
  return jsonb_build_object('source','merchant_ads_assistance_v1_323',
   'merchantId',p_merchant,'readOnly',true,'merchantActive',v_active,
   'interestRegistered',v_interest,'noMessageSent',true,'noCharge',true,'adsLive',false,
   'request',case when v_record.merchant_id is null then null else
     jsonb_build_object('channel',v_record.channel,'note',v_record.request_note,
      'status',v_record.status,'version',v_record.version,
      'requestedAt',v_record.requested_at,'updatedAt',v_record.updated_at) end);
 end if;
 if v_record.merchant_id is null then
  if p_expected_version<>0 or p_operation<>'request'
  then raise exception 'ADS_ASSISTANCE_INITIAL_VERSION_INVALID' using errcode='40001';end if;
 else
  if v_record.version<>p_expected_version
  then raise exception 'ADS_ASSISTANCE_VERSION_CONFLICT' using errcode='40001';end if;
 end if;
 if p_operation='request' then
  if v_record.merchant_id is not null and v_record.status not in ('closed','withdrawn')
  then raise exception 'ADS_ASSISTANCE_ALREADY_REQUESTED' using errcode='40001';end if;
  v_version:=p_expected_version+1;v_status:='requested';
  insert into public.platform_ads_assistance_v1_323(
   merchant_id,channel,request_note,status,version,requested_by,updated_by)
  values(p_merchant,p_channel,btrim(p_note),'requested',v_version,p_actor,p_actor)
  on conflict(merchant_id) do update set
    channel=excluded.channel,request_note=excluded.request_note,status='requested',
    version=excluded.version,requested_by=p_actor,requested_at=clock_timestamp(),
    updated_by=p_actor,updated_at=clock_timestamp(),
    triaged_at=null,closed_at=null,admin_reason=null;
 else
  if v_record.merchant_id is null or v_record.status not in ('requested','triaged')
  then raise exception 'ADS_ASSISTANCE_WITHDRAW_UNAVAILABLE' using errcode='40001';end if;
  v_version:=p_expected_version+1;v_status:='withdrawn';
  update public.platform_ads_assistance_v1_323
   set status='withdrawn',version=v_version,
    updated_by=p_actor,updated_at=clock_timestamp()
   where merchant_id=p_merchant;
 end if;
 v_response:=jsonb_build_object('source','merchant_ads_assistance_v1_323',
   'merchantId',p_merchant,'recorded',true,'status',v_status,'version',v_version,
   'noMessageSent',true,'noCharge',true,'adsLive',false,'replayed',false);
 insert into public.platform_ads_assistance_actions_v1_323(
  request_id,merchant_id,actor_user_id,signature,response)
 values(p_request,p_merchant,p_actor,v_sig,v_response);
 insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
 values(p_actor,'ads-assistance-merchant-'||p_operation,'merchant',p_merchant::text,
  jsonb_build_object('requestId',p_request,'version',v_version,
   'requestType','user_initiated','noAutomaticOutreach',true));
 return v_response;
end;
$fn$;
revoke all on function public.merchant_ads_assistance_v1_323(uuid,uuid,text,integer,text,text,boolean,uuid)
 from public,anon,authenticated;
grant execute on function public.merchant_ads_assistance_v1_323(uuid,uuid,text,integer,text,text,boolean,uuid)
 to service_role;

create or replace function public.admin_ads_assistance_read_v1_323(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog' as $fn$
declare v_total bigint;v_open bigint;v_rows jsonb;
begin
 if not exists(select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','operations','readonly'))
 then raise exception 'ADS_ASSISTANCE_ADMIN_DENIED' using errcode='42501';end if;
 select count(*),count(*) filter(where status in ('requested','triaged'))
 into v_total,v_open from public.platform_ads_assistance_v1_323;
 select coalesce(jsonb_agg(jsonb_build_object(
   'merchantId',a.merchant_id,'merchantName',left(m.name,120),
   'channel',a.channel,'note',a.request_note,'status',a.status,'version',a.version,
   'requestedAt',a.requested_at,'updatedAt',a.updated_at,
   'consentCurrent',coalesce(i.interested,false) and a.status in ('requested','triaged'),
   'contactPerformed',false,'contactVerified',false
 ) order by case a.status when 'requested' then 1 when 'triaged' then 2 else 3 end,
    a.requested_at desc,a.merchant_id),'[]'::jsonb) into v_rows
 from (select * from public.platform_ads_assistance_v1_323
   order by case status when 'requested' then 1 when 'triaged' then 2 else 3 end,
    requested_at desc,merchant_id limit 50) a
 join public.merchants m on m.id=a.merchant_id
 left join public.merchant_ads_interest_v1_232 i on i.merchant_id=a.merchant_id;
 return jsonb_build_object('source','admin_ads_assistance_v1_323','readOnly',true,
   'totalRequests',v_total,'openRequests',v_open,'rows',v_rows,
   'messagesSent',0,'contactPerformed',false,'adsLive',false,
   'paymentCreated',false,'noAutomaticOutreach',true);
end;
$fn$;
revoke all on function public.admin_ads_assistance_read_v1_323(uuid) from public,anon,authenticated;
grant execute on function public.admin_ads_assistance_read_v1_323(uuid) to service_role;

create or replace function public.admin_ads_assistance_action_v1_323(
 p_actor uuid,p_merchant uuid,p_operation text,
 p_expected_version integer,p_reason text,p_request uuid
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog' as $fn$
declare v_a public.platform_ads_assistance_v1_323%rowtype;
 v_sig jsonb;v_old record;v_interest boolean;v_version integer;
 v_status text;v_response jsonb;
begin
 if not exists(select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active and a.admin_role='superadmin')
 then raise exception 'ADS_ASSISTANCE_FOUNDER_ONLY' using errcode='42501';end if;
 if p_merchant is null or p_request is null or p_operation not in ('triage','close')
 or p_expected_version is null or p_expected_version<1
 or p_reason is null or char_length(btrim(p_reason)) not between 12 and 240
 then raise exception 'ADS_ASSISTANCE_ADMIN_ACTION_INVALID' using errcode='22023';end if;
 v_sig:=jsonb_build_object('actor',p_actor,'merchant',p_merchant,'operation',p_operation,
   'expectedVersion',p_expected_version,'reason',btrim(p_reason));
 select signature,response into v_old from public.platform_ads_assistance_actions_v1_323
 where request_id=p_request;
 if found then
  if v_old.signature is distinct from v_sig
  then raise exception 'ADS_ASSISTANCE_REQUEST_REUSE' using errcode='23505';end if;
  return v_old.response||jsonb_build_object('replayed',true);
 end if;
 select * into v_a from public.platform_ads_assistance_v1_323
  where merchant_id=p_merchant for update;
 if v_a.merchant_id is null or v_a.version<>p_expected_version
 then raise exception 'ADS_ASSISTANCE_ADMIN_VERSION_CONFLICT' using errcode='40001';end if;
 select coalesce(i.interested,false) into v_interest
 from public.merchant_ads_interest_v1_232 i where i.merchant_id=p_merchant;
 v_interest:=coalesce(v_interest,false);
 if p_operation='triage' and (v_a.status<>'requested' or not v_interest)
 then raise exception 'ADS_ASSISTANCE_TRIAGE_BLOCKED' using errcode='40001';end if;
 if p_operation='close' and v_a.status not in ('requested','triaged')
 then raise exception 'ADS_ASSISTANCE_CLOSE_BLOCKED' using errcode='40001';end if;
 v_version:=p_expected_version+1;
 v_status:=case when p_operation='triage' then 'triaged' else 'closed' end;
 update public.platform_ads_assistance_v1_323 set
  status=v_status,version=v_version,updated_by=p_actor,updated_at=clock_timestamp(),
  admin_reason=btrim(p_reason),
  triaged_at=case when p_operation='triage' then clock_timestamp() else triaged_at end,
  closed_at=case when p_operation='close' then clock_timestamp() else null end
 where merchant_id=p_merchant;
 v_response:=jsonb_build_object('source','admin_ads_assistance_action_v1_323',
  'merchantId',p_merchant,'status',v_status,'version',v_version,'recorded',true,
  'messageSent',false,'contactPerformed',false,'adsLive',false,'paymentCreated',false,
  'replayed',false);
 insert into public.platform_ads_assistance_actions_v1_323(
  request_id,merchant_id,actor_user_id,signature,response)
 values(p_request,p_merchant,p_actor,v_sig,v_response);
 insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
 values(p_actor,'ads-assistance-admin-'||p_operation,'merchant',p_merchant::text,
  jsonb_build_object('requestId',p_request,'version',v_version,
   'reason',btrim(p_reason),'noAutomaticOutreach',true));
 return v_response;
end;
$fn$;
revoke all on function public.admin_ads_assistance_action_v1_323(uuid,uuid,text,integer,text,uuid)
 from public,anon,authenticated;
grant execute on function public.admin_ads_assistance_action_v1_323(uuid,uuid,text,integer,text,uuid)
 to service_role;
