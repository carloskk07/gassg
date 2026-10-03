-- Chama São Gabriel — production launch readiness v1.46
-- Commerce is fail-closed until an active platform admin explicitly enables it
-- after database readiness and fresh attestation of all isolated live portals.

create table if not exists public.platform_launch_control (
  singleton boolean primary key default true check (singleton),
  commerce_enabled boolean not null default false,
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id) on delete set null,
  disabled_at timestamptz,
  disabled_by uuid references auth.users(id) on delete set null,
  portals_verified_at timestamptz,
  portals_source_sha text,
  customer_portal_ok boolean not null default false,
  merchant_portal_ok boolean not null default false,
  admin_portal_ok boolean not null default false,
  updated_at timestamptz not null default now(),
  check (
    portals_source_sha is null
    or portals_source_sha~'^[0-9a-f]{40}$'
  ),
  check (
    commerce_enabled=false
    or (
      enabled_at is not null
      and enabled_by is not null
    )
  )
);

alter table public.platform_launch_control enable row level security;
revoke all on table public.platform_launch_control from public, anon, authenticated;
grant all on table public.platform_launch_control to service_role;

create index if not exists platform_launch_control_enabled_by_fk_idx
  on public.platform_launch_control(enabled_by);
create index if not exists platform_launch_control_disabled_by_fk_idx
  on public.platform_launch_control(disabled_by);

insert into public.platform_launch_control(singleton,commerce_enabled)
values(true,false)
on conflict(singleton) do nothing;

create or replace function public.platform_launch_readiness()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_control public.platform_launch_control%rowtype;
  v_supply jsonb;
  v_active_admins integer:=0;
  v_owner_ready integer:=0;
  v_payment_ready integer:=0;
  v_configured_merchants integer:=0;
  v_portals_fresh boolean:=false;
  v_database_ready boolean:=false;
  v_blockers jsonb:='[]'::jsonb;
begin
  select *
  into v_control
  from public.platform_launch_control
  where singleton=true;

  if not found then
    raise exception 'LAUNCH_CONTROL_MISSING' using errcode='P0002';
  end if;

  select count(*)::integer
  into v_active_admins
  from public.platform_admins
  where active;

  v_supply:=public.market_supply_status();
  v_configured_merchants:=coalesce((v_supply->>'configuredMerchantCount')::integer,0);

  select count(distinct m.id)::integer
  into v_owner_ready
  from public.merchants m
  where m.status='active'
    and public.merchant_operational_compliance_current(m.id)
    and exists(
      select 1
      from public.merchant_members mm
      where mm.merchant_id=m.id
        and mm.active
        and mm.member_role='owner'
    )
    and exists(
      select 1
      from public.catalog_items ci
      where ci.merchant_id=m.id
        and ci.active
        and ci.price_cents>0
    );

  select count(distinct m.id)::integer
  into v_payment_ready
  from public.merchants m
  where m.status='active'
    and public.merchant_operational_compliance_current(m.id)
    and exists(
      select 1
      from public.merchant_payment_methods p
      where p.merchant_id=m.id
        and p.active
    )
    and exists(
      select 1
      from public.catalog_items ci
      where ci.merchant_id=m.id
        and ci.active
        and ci.price_cents>0
    );

  v_portals_fresh:=
    v_control.portals_verified_at is not null
    and v_control.portals_verified_at>=clock_timestamp()-interval '60 minutes'
    and v_control.customer_portal_ok
    and v_control.merchant_portal_ok
    and v_control.admin_portal_ok
    and v_control.portals_source_sha is not null;

  v_database_ready:=
    v_active_admins>0
    and coalesce((v_supply->>'realSupplyConfigured')::boolean,false)
    and v_configured_merchants>0
    and v_owner_ready>0
    and v_payment_ready>0;

  if v_active_admins<1 then
    v_blockers:=v_blockers||jsonb_build_array('admin_required');
  end if;
  if not coalesce((v_supply->>'realSupplyConfigured')::boolean,false) then
    v_blockers:=v_blockers||jsonb_build_array('real_supply_required');
  end if;
  if v_owner_ready<1 then
    v_blockers:=v_blockers||jsonb_build_array('merchant_owner_required');
  end if;
  if v_payment_ready<1 then
    v_blockers:=v_blockers||jsonb_build_array('merchant_payment_required');
  end if;
  if not v_portals_fresh then
    v_blockers:=v_blockers||jsonb_build_array('live_portals_verification_required');
  end if;

  return jsonb_build_object(
    'commerceEnabled',v_control.commerce_enabled,
    'databaseReady',v_database_ready,
    'readyToEnable',v_database_ready and v_portals_fresh,
    'activeAdminCount',v_active_admins,
    'configuredMerchantCount',v_configured_merchants,
    'ownerReadyMerchantCount',v_owner_ready,
    'paymentReadyMerchantCount',v_payment_ready,
    'portalsFresh',v_portals_fresh,
    'portalsVerifiedAt',v_control.portals_verified_at,
    'portalsSourceSha',v_control.portals_source_sha,
    'customerPortalOk',v_control.customer_portal_ok,
    'merchantPortalOk',v_control.merchant_portal_ok,
    'adminPortalOk',v_control.admin_portal_ok,
    'blockers',v_blockers,
    'supply',v_supply
  );
end;
$$;

revoke all on function public.platform_launch_readiness()
from public, anon, authenticated;
grant execute on function public.platform_launch_readiness()
to service_role;

create or replace function public.commerce_launch_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_enabled boolean:=false;
begin
  select commerce_enabled
  into v_enabled
  from public.platform_launch_control
  where singleton=true;

  return jsonb_build_object(
    'commerceEnabled',coalesce(v_enabled,false)
  );
end;
$$;

revoke all on function public.commerce_launch_status()
from public, anon, authenticated;
grant execute on function public.commerce_launch_status()
to service_role;

create or replace function public.admin_launch_control_action(
  p_actor_user_id uuid,
  p_action text,
  p_source_sha text,
  p_customer_ok boolean,
  p_merchant_ok boolean,
  p_admin_ok boolean,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_action public.action_requests%rowtype;
  v_readiness jsonb;
  v_result jsonb;
  v_enabled boolean;
begin
  if p_actor_user_id is null then
    raise exception 'ADMIN_ACCESS_DENIED' using errcode='42501';
  end if;

  if not exists(
    select 1
    from public.platform_admins a
    where a.user_id=p_actor_user_id
      and a.active
  ) then
    raise exception 'ADMIN_ACCESS_DENIED' using errcode='42501';
  end if;

  if p_action not in ('record-portals','enable-commerce','disable-commerce') then
    raise exception 'INVALID_LAUNCH_ACTION' using errcode='22023';
  end if;

  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;

  if p_request_hash is null
     or char_length(p_request_hash)<>64
     or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,
    p_actor_user_id,
    'admin-launch:'||p_action,
    p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if not found then
    raise exception 'IDEMPOTENCY_STATE_INVALID' using errcode='40001';
  end if;

  if v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'admin-launch:'||p_action
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  if p_action='record-portals' then
    if p_source_sha is null
       or lower(trim(p_source_sha))!~'^[0-9a-f]{40}$'
       or not coalesce(p_customer_ok,false)
       or not coalesce(p_merchant_ok,false)
       or not coalesce(p_admin_ok,false) then
      raise exception 'PORTAL_ATTESTATION_INVALID' using errcode='22023';
    end if;

    update public.platform_launch_control
    set portals_verified_at=clock_timestamp(),
        portals_source_sha=lower(trim(p_source_sha)),
        customer_portal_ok=true,
        merchant_portal_ok=true,
        admin_portal_ok=true,
        updated_at=clock_timestamp()
    where singleton=true;

    insert into public.platform_admin_audit(
      actor_user_id,action,target_type,target_id,metadata
    )
    values(
      p_actor_user_id,
      'record-launch-portals',
      'platform_launch',
      null,
      jsonb_build_object('sourceSha',lower(trim(p_source_sha)))
    );

  elsif p_action='enable-commerce' then
    v_readiness:=public.platform_launch_readiness();
    if not coalesce((v_readiness->>'readyToEnable')::boolean,false) then
      raise exception 'LAUNCH_NOT_READY' using errcode='40001';
    end if;

    update public.platform_launch_control
    set commerce_enabled=true,
        enabled_at=clock_timestamp(),
        enabled_by=p_actor_user_id,
        disabled_at=null,
        disabled_by=null,
        updated_at=clock_timestamp()
    where singleton=true;

    insert into public.platform_admin_audit(
      actor_user_id,action,target_type,target_id,metadata
    )
    values(
      p_actor_user_id,
      'enable-commerce',
      'platform_launch',
      null,
      jsonb_build_object(
        'sourceSha',v_readiness->>'portalsSourceSha',
        'configuredMerchantCount',v_readiness->>'configuredMerchantCount'
      )
    );

  else
    update public.platform_launch_control
    set commerce_enabled=false,
        disabled_at=clock_timestamp(),
        disabled_by=p_actor_user_id,
        updated_at=clock_timestamp()
    where singleton=true;

    insert into public.platform_admin_audit(
      actor_user_id,action,target_type,target_id,metadata
    )
    values(
      p_actor_user_id,
      'disable-commerce',
      'platform_launch',
      null,
      '{}'::jsonb
    );
  end if;

  v_readiness:=public.platform_launch_readiness();
  v_enabled:=coalesce((v_readiness->>'commerceEnabled')::boolean,false);

  v_result:=jsonb_build_object(
    'ok',true,
    'action',p_action,
    'commerceEnabled',v_enabled,
    'readiness',v_readiness
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.admin_launch_control_action(
  uuid,text,text,boolean,boolean,boolean,text,text
) from public, anon, authenticated;
grant execute on function public.admin_launch_control_action(
  uuid,text,text,boolean,boolean,boolean,text,text
) to service_role;

create or replace function public.require_commerce_enabled_for_new_order()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_enabled boolean:=false;
begin
  select commerce_enabled
  into v_enabled
  from public.platform_launch_control
  where singleton=true;

  if not coalesce(v_enabled,false) then
    raise exception 'COMMERCE_NOT_ENABLED' using errcode='55000';
  end if;

  return new;
end;
$$;

revoke all on function public.require_commerce_enabled_for_new_order()
from public, anon, authenticated;
grant execute on function public.require_commerce_enabled_for_new_order()
to postgres, service_role;

drop trigger if exists require_commerce_enabled_before_order_insert
on public.orders;

create trigger require_commerce_enabled_before_order_insert
before insert on public.orders
for each row
execute function public.require_commerce_enabled_for_new_order();

create or replace function public.create_order_from_quote_v8(
  p_user_id uuid,
  p_quote_id uuid,
  p_payment_method text,
  p_use_cashback boolean,
  p_idempotency_key text,
  p_request_hash text,
  p_referral_code text default null,
  p_cash_tender_cents integer default null,
  p_customer_phone text default null,
  p_address_complement text default null,
  p_delivery_reference text default null,
  p_delivery_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_enabled boolean:=false;
begin
  select commerce_enabled
  into v_enabled
  from public.platform_launch_control
  where singleton=true;

  if not coalesce(v_enabled,false) then
    raise exception 'COMMERCE_NOT_ENABLED' using errcode='55000';
  end if;

  return public.create_order_from_quote_v7(
    p_user_id,
    p_quote_id,
    p_payment_method,
    p_use_cashback,
    p_idempotency_key,
    p_request_hash,
    p_referral_code,
    p_cash_tender_cents,
    p_customer_phone,
    p_address_complement,
    p_delivery_reference,
    p_delivery_notes
  );
end;
$$;

revoke all on function public.create_order_from_quote_v8(
  uuid,uuid,text,boolean,text,text,text,integer,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.create_order_from_quote_v8(
  uuid,uuid,text,boolean,text,text,text,integer,text,text,text,text
) to service_role;
