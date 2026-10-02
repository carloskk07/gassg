-- Chama São Gabriel — generalized GLP regulatory gate v1.7.8
-- Internal catalog convention: P1..P90 are reserved for transportable GLP
-- cylinder capacities in kilograms. Regulatory enforcement therefore follows
-- product semantics, not only the original P13 SKU.

create or replace function public.is_glp_product_code(
  p_product_code text
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when upper(trim(coalesce(p_product_code,''))) ~ '^P([1-9][0-9]?)$'
    then substring(upper(trim(p_product_code)) from 2)::integer between 1 and 90
    else false
  end;
$$;

revoke all on function public.is_glp_product_code(text)
from public, anon, authenticated;
grant execute on function public.is_glp_product_code(text)
to postgres, service_role;

create or replace function public.enforce_glp_catalog_compliance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_status text;
  v_cnpj_status text;
  v_anp_status text;
begin
  if not new.active
     or not public.is_glp_product_code(new.product_code) then
    return new;
  end if;

  select m.status,c.cnpj_status,c.anp_status
  into v_status,v_cnpj_status,v_anp_status
  from public.merchants m
  left join public.merchant_compliance c
    on c.merchant_id=m.id
  where m.id=new.merchant_id;

  if not found then
    raise exception 'MERCHANT_NOT_FOUND' using errcode='P0002';
  end if;

  if v_status='active'
     and (
       coalesce(v_cnpj_status,'pending')<>'verified'
       or coalesce(v_anp_status,'pending')<>'verified'
     ) then
    raise exception 'GLP_REGULATORY_VERIFICATION_REQUIRED' using errcode='23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_glp_catalog_compliance()
from public, anon, authenticated;
grant execute on function public.enforce_glp_catalog_compliance()
to postgres, service_role;

drop trigger if exists enforce_p13_catalog_compliance_trg
on public.catalog_items;

drop trigger if exists enforce_glp_catalog_compliance_trg
on public.catalog_items;

create trigger enforce_glp_catalog_compliance_trg
before insert or update of product_code,active
on public.catalog_items
for each row
execute function public.enforce_glp_catalog_compliance();

drop function if exists public.enforce_p13_catalog_compliance();

create or replace function public.admin_set_merchant_status(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_merchant public.merchants%rowtype;
  v_compliance public.merchant_compliance%rowtype;
  v_has_glp boolean:=false;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_status not in ('active','suspended') then
    raise exception 'INVALID_MERCHANT_STATUS' using errcode='22023';
  end if;

  select *
  into v_merchant
  from public.merchants
  where id=p_merchant_id
  for update;

  if not found then
    raise exception 'MERCHANT_NOT_FOUND' using errcode='P0002';
  end if;

  if v_merchant.status=p_status then
    return jsonb_build_object(
      'ok',true,
      'merchantId',v_merchant.id,
      'status',v_merchant.status,
      'online',v_merchant.online,
      'alreadyInState',true
    );
  end if;

  if p_status='active' then
    if v_merchant.status not in ('pending','suspended') then
      raise exception 'INVALID_MERCHANT_STATUS_TRANSITION' using errcode='40001';
    end if;

    select *
    into v_compliance
    from public.merchant_compliance
    where merchant_id=v_merchant.id;

    if not found
       or v_compliance.cnpj_status<>'verified' then
      raise exception 'CNPJ_VERIFICATION_REQUIRED' using errcode='40001';
    end if;

    select exists(
      select 1
      from public.catalog_items ci
      where ci.merchant_id=v_merchant.id
        and ci.active
        and public.is_glp_product_code(ci.product_code)
    )
    into v_has_glp;

    if v_has_glp
       and v_compliance.anp_status<>'verified' then
      raise exception 'ANP_VERIFICATION_REQUIRED' using errcode='40001';
    end if;
  else
    if v_merchant.status<>'active' then
      raise exception 'INVALID_MERCHANT_STATUS_TRANSITION' using errcode='40001';
    end if;
  end if;

  update public.merchants
  set status=p_status,
      online=false,
      updated_at=clock_timestamp()
  where id=v_merchant.id
  returning * into v_merchant;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    case
      when p_status='active' then 'merchant_activated'
      else 'merchant_suspended'
    end,
    'merchant',
    v_merchant.id::text,
    jsonb_build_object('status',p_status,'hasGlp',v_has_glp)
  );

  return jsonb_build_object(
    'ok',true,
    'merchantId',v_merchant.id,
    'status',v_merchant.status,
    'online',v_merchant.online,
    'alreadyInState',false
  );
end;
$$;

revoke all on function public.admin_set_merchant_status(uuid,uuid,text)
from public, anon, authenticated;
grant execute on function public.admin_set_merchant_status(uuid,uuid,text)
to postgres, service_role;

create or replace function public.enforce_compliance_continuity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_merchant_id uuid;
  v_cnpj_status text;
  v_anp_status text;
  v_has_active_glp boolean:=false;
  v_is_active boolean:=false;
begin
  if tg_op='DELETE' then
    v_merchant_id:=old.merchant_id;

    update public.merchants
    set status='suspended',
        online=false,
        updated_at=clock_timestamp()
    where id=v_merchant_id
      and status='active';

    return old;
  end if;

  v_merchant_id:=new.merchant_id;
  v_cnpj_status:=new.cnpj_status;
  v_anp_status:=new.anp_status;

  select (m.status='active')
  into v_is_active
  from public.merchants m
  where m.id=v_merchant_id;

  if coalesce(v_is_active,false) is false then
    return new;
  end if;

  select exists(
    select 1
    from public.catalog_items ci
    where ci.merchant_id=v_merchant_id
      and ci.active
      and public.is_glp_product_code(ci.product_code)
  )
  into v_has_active_glp;

  if v_cnpj_status<>'verified'
     or (v_has_active_glp and v_anp_status<>'verified') then
    update public.merchants
    set status='suspended',
        online=false,
        updated_at=clock_timestamp()
    where id=v_merchant_id
      and status='active';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_compliance_continuity()
from public, anon, authenticated;
grant execute on function public.enforce_compliance_continuity()
to postgres, service_role;
