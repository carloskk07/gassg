-- TAMÃO V1.308 — founder-controlled commercial proposal intake.
-- Never enables advertising delivery, coupon sales, payments or city commerce.
create table if not exists public.platform_marketing_intake_v1_308(
  module_key text primary key check (module_key in ('ads_proposals','clube_proposals')),
  intake_enabled boolean not null,
  version integer not null default 1 check(version>0),
  updated_by uuid,
  updated_at timestamptz not null default clock_timestamp(),
  reason text not null default 'Cadastro de propostas existente preservado'
);
alter table public.platform_marketing_intake_v1_308 enable row level security;
revoke all on table public.platform_marketing_intake_v1_308 from public,anon,authenticated;
grant select on table public.platform_marketing_intake_v1_308 to service_role;
insert into public.platform_marketing_intake_v1_308(module_key,intake_enabled)
values ('ads_proposals',true),('clube_proposals',true)
on conflict(module_key) do nothing;

create or replace function public.marketing_intake_enabled_v1_308(p_module text)
returns boolean language sql stable set search_path to 'pg_catalog'
as $function$
  select coalesce((select x.intake_enabled from public.platform_marketing_intake_v1_308 x
     where x.module_key=p_module),false);
$function$;
revoke all on function public.marketing_intake_enabled_v1_308(text) from public,anon,authenticated;
grant execute on function public.marketing_intake_enabled_v1_308(text) to service_role;

create or replace function public.admin_marketing_intake_read_v1_308(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog'
as $function$
declare v_controls jsonb;
begin
  if p_actor is null or not exists(
    select 1 from public.platform_admins a where a.user_id=p_actor and a.active
      and a.admin_role in ('superadmin','operations','readonly')
  ) then raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'moduleKey',x.module_key,'enabled',x.intake_enabled,'version',x.version,
    'updatedAt',x.updated_at,'reason',x.reason
  ) order by x.module_key),'[]'::jsonb) into v_controls
  from public.platform_marketing_intake_v1_308 x;
  if jsonb_array_length(v_controls)<>2 then
    raise exception 'MARKETING_INTAKE_STATE_INCOMPLETE' using errcode='55000';
  end if;
  return jsonb_build_object('source','admin_marketing_intake_v1_308','readOnly',true,
    'checkedAt',clock_timestamp(),'controls',v_controls,
    'adsPublicationEnabled',false,'couponSalesEnabled',false,'noMoneyMovement',true);
end;
$function$;
revoke all on function public.admin_marketing_intake_read_v1_308(uuid) from public,anon,authenticated;
grant execute on function public.admin_marketing_intake_read_v1_308(uuid) to service_role;

create or replace function public.admin_marketing_intake_set_v1_308(
  p_actor uuid,p_module text,p_enabled boolean,p_reason text,p_expected_version integer
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog'
as $function$
declare v_previous boolean;v_version integer;v_new_version integer;v_changed boolean;
begin
  if p_actor is null or not exists(
    select 1 from public.platform_admins a where a.user_id=p_actor and a.active
      and a.admin_role='superadmin'
  ) then raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501'; end if;
  if p_module not in ('ads_proposals','clube_proposals') or p_enabled is null
    or p_reason is null or char_length(btrim(p_reason)) not between 8 and 240
    or p_expected_version is null or p_expected_version<1
  then raise exception 'INVALID_MARKETING_INTAKE_CHANGE' using errcode='22023'; end if;
  select intake_enabled,version into v_previous,v_version
  from public.platform_marketing_intake_v1_308
  where module_key=p_module for update;
  if not found then raise exception 'MARKETING_INTAKE_UNKNOWN' using errcode='P0002'; end if;
  if v_version<>p_expected_version then
    raise exception 'MARKETING_INTAKE_VERSION_CONFLICT' using errcode='40001';
  end if;
  v_changed:=v_previous is distinct from p_enabled;
  v_new_version:=v_version;
  if v_changed then
    update public.platform_marketing_intake_v1_308
      set intake_enabled=p_enabled,version=version+1,reason=btrim(p_reason),
          updated_by=p_actor,updated_at=clock_timestamp()
    where module_key=p_module returning version into v_new_version;
    insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
    values(p_actor,'marketing-intake-set','commercial_intake',p_module,
      jsonb_build_object('previous',v_previous,'enabled',p_enabled,
        'previousVersion',v_version,'version',v_new_version,'reason',btrim(p_reason)));
  end if;
  return jsonb_build_object('source','admin_marketing_intake_set_v1_308',
    'moduleKey',p_module,'enabled',p_enabled,'version',v_new_version,'changed',v_changed,
    'adsPublicationEnabled',false,'couponSalesEnabled',false,'noMoneyMovement',true);
end;
$function$;
revoke all on function public.admin_marketing_intake_set_v1_308(uuid,text,boolean,text,integer) from public,anon,authenticated;
grant execute on function public.admin_marketing_intake_set_v1_308(uuid,text,boolean,text,integer) to service_role;

-- Enforce at the service-role-only RPC boundary, not just in the browser.
-- Existing view/withdraw operations continue when intake is suspended.
create or replace function public.merchant_ads_interest_v1_232(
  p_actor_user_id uuid,p_merchant_id uuid,p_operation text,
  p_goal text default null,p_budget_band text default null,p_consent boolean default false
) returns jsonb language plpgsql set search_path to 'pg_catalog'
as $function$
begin
  if p_operation='register' and not public.marketing_intake_enabled_v1_308('ads_proposals') then
    raise exception 'ADS_PROPOSALS_INTAKE_PAUSED' using errcode='42501';
  end if;
  return growth_internal_v1_232.ads_interest_v1_232(
    p_actor_user_id,p_merchant_id,p_operation,p_goal,p_budget_band,p_consent);
end;
$function$;
revoke all on function public.merchant_ads_interest_v1_232(uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.merchant_ads_interest_v1_232(uuid,uuid,text,text,text,boolean) to service_role;

create or replace function public.merchant_ads_campaign_v1_233(
  p_actor uuid,p_merchant uuid,p_action text,p_request uuid default null,
  p_title text default null,p_description text default null,
  p_category text default null,p_version integer default null
) returns jsonb language plpgsql set search_path to 'pg_catalog'
as $function$
begin
  if p_action in ('save','submit') and not public.marketing_intake_enabled_v1_308('ads_proposals') then
    raise exception 'ADS_PROPOSALS_INTAKE_PAUSED' using errcode='42501';
  end if;
  return ads_internal_v1_233.merchant_campaign(
    p_actor,p_merchant,p_action,p_request,p_title,p_description,p_category,p_version);
end;
$function$;
revoke all on function public.merchant_ads_campaign_v1_233(uuid,uuid,text,uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.merchant_ads_campaign_v1_233(uuid,uuid,text,uuid,text,text,text,integer) to service_role;

create or replace function public.merchant_clube_interest_v1_240(
 p_actor uuid,p_merchant uuid,p_package_key text,p_operation text,
 p_merchant_share_bps integer default null,p_budget_cents integer default null,
 p_consent boolean default false,p_expected_version integer default null,
 p_request_id uuid default null
) returns jsonb language plpgsql set search_path to 'pg_catalog'
as $function$
begin
  if p_operation='register' and not public.marketing_intake_enabled_v1_308('clube_proposals') then
    raise exception 'CLUBE_PROPOSALS_INTAKE_PAUSED' using errcode='42501';
  end if;
  return clube_internal_v1_240.merchant_interest(
    p_actor,p_merchant,p_package_key,p_operation,p_merchant_share_bps,
    p_budget_cents,p_consent,p_expected_version,p_request_id);
end;
$function$;
revoke all on function public.merchant_clube_interest_v1_240(uuid,uuid,text,text,integer,integer,boolean,integer,uuid) from public,anon,authenticated;
grant execute on function public.merchant_clube_interest_v1_240(uuid,uuid,text,text,integer,integer,boolean,integer,uuid) to service_role;
