-- Chama São Gabriel — stable compliance clocks and strict GLP capability v1.15.6

create or replace function public.merchant_cnpj_compliance_current(
  p_merchant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce((
    select
      c.cnpj_status='verified'
      and c.cnpj_verified_at is not null
      and c.cnpj_verified_at >= statement_timestamp()-make_interval(days=>p.cnpj_max_age_days)
    from public.merchant_compliance c
    cross join public.merchant_compliance_policy p
    where c.merchant_id=p_merchant_id
      and p.policy_key='default'
  ),false);
$$;

revoke all on function public.merchant_cnpj_compliance_current(uuid)
from public, anon, authenticated;
grant execute on function public.merchant_cnpj_compliance_current(uuid)
to postgres, service_role;

create or replace function public.merchant_anp_verification_current(
  p_merchant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce((
    select
      c.anp_status='verified'
      and c.anp_verified_at is not null
      and c.anp_verified_at >= statement_timestamp()-make_interval(days=>p.anp_max_age_days)
    from public.merchant_compliance c
    cross join public.merchant_compliance_policy p
    where c.merchant_id=p_merchant_id
      and p.policy_key='default'
  ),false);
$$;

revoke all on function public.merchant_anp_verification_current(uuid)
from public, anon, authenticated;
grant execute on function public.merchant_anp_verification_current(uuid)
to postgres, service_role;

create or replace function public.merchant_anp_compliance_current(
  p_merchant_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_has_glp boolean:=false;
begin
  select exists(
    select 1
    from public.catalog_items ci
    where ci.merchant_id=p_merchant_id
      and ci.active
      and public.is_glp_product_code(ci.product_code)
  )
  into v_has_glp;

  if not v_has_glp then
    return true;
  end if;

  return public.merchant_anp_verification_current(p_merchant_id);
end;
$$;

revoke all on function public.merchant_anp_compliance_current(uuid)
from public, anon, authenticated;
grant execute on function public.merchant_anp_compliance_current(uuid)
to postgres, service_role;

create or replace function public.merchant_operational_compliance_current(
  p_merchant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    public.merchant_cnpj_compliance_current(p_merchant_id)
    and public.merchant_anp_compliance_current(p_merchant_id);
$$;

revoke all on function public.merchant_operational_compliance_current(uuid)
from public, anon, authenticated;
grant execute on function public.merchant_operational_compliance_current(uuid)
to postgres, service_role;

create or replace function public.enforce_glp_catalog_compliance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_status text;
begin
  if not new.active
     or not public.is_glp_product_code(new.product_code) then
    return new;
  end if;

  select m.status
  into v_status
  from public.merchants m
  where m.id=new.merchant_id;

  if not found then
    raise exception 'MERCHANT_NOT_FOUND' using errcode='P0002';
  end if;

  if v_status='active' then
    if not public.merchant_cnpj_compliance_current(new.merchant_id) then
      raise exception 'CNPJ_REVERIFICATION_REQUIRED' using errcode='23514';
    end if;

    if not public.merchant_anp_verification_current(new.merchant_id) then
      raise exception 'ANP_REVERIFICATION_REQUIRED' using errcode='23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_glp_catalog_compliance()
from public, anon, authenticated;
grant execute on function public.enforce_glp_catalog_compliance()
to postgres, service_role;

create or replace function public.admin_set_delivery_capability(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_active boolean,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_merchant public.merchants%rowtype;
  v_now timestamptz:=clock_timestamp();
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_merchant_id is null then
    raise exception 'INVALID_MERCHANT' using errcode='22023';
  end if;

  if p_notes is not null and char_length(trim(p_notes))>1000 then
    raise exception 'NOTES_TOO_LONG' using errcode='22023';
  end if;

  select *
  into v_merchant
  from public.merchants
  where id=p_merchant_id
  for update;

  if not found then
    raise exception 'MERCHANT_NOT_FOUND' using errcode='P0002';
  end if;

  if p_active then
    if not public.merchant_cnpj_compliance_current(p_merchant_id) then
      raise exception 'CNPJ_REVERIFICATION_REQUIRED' using errcode='40001';
    end if;

    -- This capability is specifically for mixed loads containing regulated GLP.
    -- It therefore requires ANP evidence even if the merchant has not yet
    -- activated a GLP SKU in the catalog.
    if not public.merchant_anp_verification_current(p_merchant_id) then
      raise exception 'ANP_REVERIFICATION_REQUIRED' using errcode='40001';
    end if;
  end if;

  insert into public.merchant_delivery_capabilities(
    merchant_id,capability_code,active,verified_at,verified_by,notes,updated_at
  )
  values(
    p_merchant_id,
    'regulated_glp_mixed_load_verified',
    p_active,
    v_now,
    p_actor_user_id,
    nullif(trim(p_notes),''),
    v_now
  )
  on conflict(merchant_id,capability_code) do update
  set active=excluded.active,
      verified_at=excluded.verified_at,
      verified_by=excluded.verified_by,
      notes=excluded.notes,
      updated_at=v_now;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    case when p_active
      then 'delivery_capability_verified'
      else 'delivery_capability_revoked'
    end,
    'merchant',
    p_merchant_id::text,
    jsonb_build_object(
      'capabilityCode','regulated_glp_mixed_load_verified',
      'active',p_active,
      'notes',p_notes,
      'cnpjCurrent',public.merchant_cnpj_compliance_current(p_merchant_id),
      'anpVerificationCurrent',public.merchant_anp_verification_current(p_merchant_id)
    )
  );

  return jsonb_build_object(
    'ok',true,
    'merchantId',p_merchant_id,
    'capabilityCode','regulated_glp_mixed_load_verified',
    'active',p_active,
    'verifiedAt',v_now
  );
end;
$$;

revoke all on function public.admin_set_delivery_capability(uuid,uuid,boolean,text)
from public, anon, authenticated;
grant execute on function public.admin_set_delivery_capability(uuid,uuid,boolean,text)
to service_role;
