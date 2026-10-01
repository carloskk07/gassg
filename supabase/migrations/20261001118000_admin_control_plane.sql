-- Chama São Gabriel — protected admin control plane v1.7
-- Server-only authority for partner onboarding, compliance, financial reconciliation
-- and post-settlement reversal. No browser role receives direct table access.

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;
revoke all on table public.platform_admins from anon, authenticated;
grant all on table public.platform_admins to service_role;

create table if not exists public.platform_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (char_length(action) between 3 and 80),
  target_type text not null check (char_length(target_type) between 3 and 80),
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.platform_admin_audit enable row level security;
revoke all on table public.platform_admin_audit from anon, authenticated;
grant all on table public.platform_admin_audit to service_role;

create index if not exists platform_admin_audit_actor_created_idx
  on public.platform_admin_audit(actor_user_id,created_at desc);

create index if not exists platform_admin_audit_target_created_idx
  on public.platform_admin_audit(target_type,target_id,created_at desc);

create table if not exists public.merchant_compliance (
  merchant_id uuid primary key references public.merchants(id) on delete cascade,
  cnpj_status text not null default 'pending'
    check (cnpj_status in ('pending','verified','rejected')),
  anp_status text not null default 'pending'
    check (anp_status in ('pending','verified','not_required','rejected')),
  anp_reference text,
  notes text,
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (
    anp_status<>'verified'
    or (anp_reference is not null and char_length(trim(anp_reference)) between 3 and 240)
  ),
  check (notes is null or char_length(notes)<=1000)
);

alter table public.merchant_compliance enable row level security;
revoke all on table public.merchant_compliance from anon, authenticated;
grant all on table public.merchant_compliance to service_role;

create or replace function public.require_platform_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_user_id is null
     or not exists(
       select 1
       from public.platform_admins a
       join auth.users u on u.id=a.user_id
       where a.user_id=p_user_id
         and a.active
         and u.is_anonymous is false
     ) then
    raise exception 'ADMIN_ACCESS_DENIED' using errcode='42501';
  end if;
end;
$$;

revoke all on function public.require_platform_admin(uuid)
from public, anon, authenticated;
grant execute on function public.require_platform_admin(uuid)
to service_role;

create or replace function public.admin_approve_merchant_application(
  p_actor_user_id uuid,
  p_application_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_app public.merchant_applications%rowtype;
  v_merchant public.merchants%rowtype;
begin
  perform public.require_platform_admin(p_actor_user_id);

  select *
  into v_app
  from public.merchant_applications
  where id=p_application_id
  for update;

  if not found then
    raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002';
  end if;

  select *
  into v_merchant
  from public.merchants
  where cnpj=v_app.cnpj
  for update;

  if v_app.status='rejected' then
    raise exception 'APPLICATION_REJECTED' using errcode='40001';
  end if;

  if not found then
    insert into public.merchants(
      name,cnpj,status,online,address_text,trust_score,
      delivery_fee_cents,base_eta_minutes,accepts_citywide
    )
    values(
      v_app.company_name,v_app.cnpj,'pending',false,v_app.address_text,80,
      0,30,false
    )
    returning * into v_merchant;
  end if;

  insert into public.merchant_members(merchant_id,user_id,member_role,active)
  values(v_merchant.id,v_app.applicant_user_id,'owner',true)
  on conflict(merchant_id,user_id) do update
    set member_role='owner',active=true;

  insert into public.merchant_compliance(merchant_id)
  values(v_merchant.id)
  on conflict(merchant_id) do nothing;

  update public.merchant_applications
  set status='approved',updated_at=clock_timestamp()
  where id=v_app.id;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,'merchant_application_approved','merchant',
    v_merchant.id::text,
    jsonb_build_object(
      'applicationId',v_app.id,
      'cnpj',v_app.cnpj,
      'ownerUserId',v_app.applicant_user_id
    )
  );

  return jsonb_build_object(
    'ok',true,
    'applicationId',v_app.id,
    'merchantId',v_merchant.id,
    'status','pending',
    'ownerUserId',v_app.applicant_user_id
  );
end;
$$;

revoke all on function public.admin_approve_merchant_application(uuid,uuid)
from public, anon, authenticated;
grant execute on function public.admin_approve_merchant_application(uuid,uuid)
to service_role;

create or replace function public.admin_reject_merchant_application(
  p_actor_user_id uuid,
  p_application_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_app public.merchant_applications%rowtype;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_reason is null
     or char_length(trim(p_reason))<3
     or char_length(trim(p_reason))>240 then
    raise exception 'INVALID_REASON' using errcode='22023';
  end if;

  select *
  into v_app
  from public.merchant_applications
  where id=p_application_id
  for update;

  if not found then
    raise exception 'APPLICATION_NOT_FOUND' using errcode='P0002';
  end if;

  if v_app.status='approved' then
    raise exception 'APPLICATION_ALREADY_APPROVED' using errcode='40001';
  end if;

  update public.merchant_applications
  set status='rejected',updated_at=clock_timestamp()
  where id=v_app.id;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,'merchant_application_rejected','merchant_application',
    v_app.id::text,
    jsonb_build_object('cnpj',v_app.cnpj,'reason',trim(p_reason))
  );

  return jsonb_build_object('ok',true,'applicationId',v_app.id,'status','rejected');
end;
$$;

revoke all on function public.admin_reject_merchant_application(uuid,uuid,text)
from public, anon, authenticated;
grant execute on function public.admin_reject_merchant_application(uuid,uuid,text)
to service_role;

create or replace function public.admin_verify_merchant(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_cnpj_status text,
  p_anp_status text,
  p_anp_reference text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_merchant public.merchants%rowtype;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_cnpj_status not in ('pending','verified','rejected')
     or p_anp_status not in ('pending','verified','not_required','rejected') then
    raise exception 'INVALID_COMPLIANCE_STATUS' using errcode='22023';
  end if;

  if p_anp_status='verified'
     and (p_anp_reference is null
          or char_length(trim(p_anp_reference))<3
          or char_length(trim(p_anp_reference))>240) then
    raise exception 'ANP_REFERENCE_REQUIRED' using errcode='22023';
  end if;

  if p_notes is not null and char_length(p_notes)>1000 then
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

  insert into public.merchant_compliance(
    merchant_id,cnpj_status,anp_status,anp_reference,notes,
    verified_at,verified_by,updated_at
  )
  values(
    v_merchant.id,p_cnpj_status,p_anp_status,nullif(trim(p_anp_reference),''),
    nullif(trim(p_notes),''),
    case
      when p_cnpj_status='verified' and p_anp_status in ('verified','not_required')
      then clock_timestamp()
      else null
    end,
    p_actor_user_id,clock_timestamp()
  )
  on conflict(merchant_id) do update
  set cnpj_status=excluded.cnpj_status,
      anp_status=excluded.anp_status,
      anp_reference=excluded.anp_reference,
      notes=excluded.notes,
      verified_at=excluded.verified_at,
      verified_by=excluded.verified_by,
      updated_at=clock_timestamp();

  if p_cnpj_status='rejected' or p_anp_status='rejected' then
    update public.merchants
    set status='suspended',online=false,updated_at=clock_timestamp()
    where id=v_merchant.id;
  end if;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,'merchant_compliance_updated','merchant',v_merchant.id::text,
    jsonb_build_object(
      'cnpjStatus',p_cnpj_status,
      'anpStatus',p_anp_status,
      'anpReference',p_anp_reference
    )
  );

  return jsonb_build_object(
    'ok',true,'merchantId',v_merchant.id,
    'cnpjStatus',p_cnpj_status,'anpStatus',p_anp_status
  );
end;
$$;

revoke all on function public.admin_verify_merchant(uuid,uuid,text,text,text,text)
from public, anon, authenticated;
grant execute on function public.admin_verify_merchant(uuid,uuid,text,text,text,text)
to service_role;

create or replace function public.enforce_active_merchant_compliance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_compliance public.merchant_compliance%rowtype;
  v_has_p13 boolean:=false;
begin
  if new.status='active' or new.online then
    select *
    into v_compliance
    from public.merchant_compliance
    where merchant_id=new.id;

    if not found or v_compliance.cnpj_status<>'verified' then
      raise exception 'CNPJ_VERIFICATION_REQUIRED' using errcode='23514';
    end if;

    select exists(
      select 1 from public.catalog_items ci
      where ci.merchant_id=new.id
        and ci.product_code='P13'
        and ci.active
    ) into v_has_p13;

    if v_has_p13 and v_compliance.anp_status<>'verified' then
      raise exception 'ANP_VERIFICATION_REQUIRED' using errcode='23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_active_merchant_compliance()
from public, anon, authenticated;
grant execute on function public.enforce_active_merchant_compliance()
to postgres, service_role;

drop trigger if exists enforce_active_merchant_compliance_trg on public.merchants;
create trigger enforce_active_merchant_compliance_trg
before insert or update of status,online on public.merchants
for each row
execute function public.enforce_active_merchant_compliance();

create or replace function public.enforce_p13_catalog_compliance()
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
  if new.product_code<>'P13' or not new.active then
    return new;
  end if;

  select m.status,c.cnpj_status,c.anp_status
  into v_status,v_cnpj_status,v_anp_status
  from public.merchants m
  left join public.merchant_compliance c on c.merchant_id=m.id
  where m.id=new.merchant_id;

  if not found then
    raise exception 'MERCHANT_NOT_FOUND' using errcode='P0002';
  end if;

  if v_status='active'
     and (coalesce(v_cnpj_status,'pending')<>'verified'
          or coalesce(v_anp_status,'pending')<>'verified') then
    raise exception 'P13_REGULATORY_VERIFICATION_REQUIRED' using errcode='23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_p13_catalog_compliance()
from public, anon, authenticated;
grant execute on function public.enforce_p13_catalog_compliance()
to postgres, service_role;

drop trigger if exists enforce_p13_catalog_compliance_trg on public.catalog_items;
create trigger enforce_p13_catalog_compliance_trg
before insert or update of product_code,active on public.catalog_items
for each row
execute function public.enforce_p13_catalog_compliance();

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
  v_has_p13 boolean:=false;
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

  if p_status='active' then
    select *
    into v_compliance
    from public.merchant_compliance
    where merchant_id=v_merchant.id;

    if not found or v_compliance.cnpj_status<>'verified' then
      raise exception 'CNPJ_VERIFICATION_REQUIRED' using errcode='40001';
    end if;

    select exists(
      select 1 from public.catalog_items ci
      where ci.merchant_id=v_merchant.id
        and ci.product_code='P13'
        and ci.active
    ) into v_has_p13;

    if v_has_p13 and v_compliance.anp_status<>'verified' then
      raise exception 'ANP_VERIFICATION_REQUIRED' using errcode='40001';
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
    case when p_status='active' then 'merchant_activated' else 'merchant_suspended' end,
    'merchant',v_merchant.id::text,
    jsonb_build_object('status',p_status)
  );

  return jsonb_build_object(
    'ok',true,'merchantId',v_merchant.id,
    'status',v_merchant.status,'online',v_merchant.online
  );
end;
$$;

revoke all on function public.admin_set_merchant_status(uuid,uuid,text)
from public, anon, authenticated;
grant execute on function public.admin_set_merchant_status(uuid,uuid,text)
to service_role;

create or replace function public.admin_financial_action(
  p_actor_user_id uuid,
  p_kind text,
  p_target_id uuid,
  p_action text,
  p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_row jsonb;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_reference is not null
     and (char_length(trim(p_reference))<2 or char_length(trim(p_reference))>240) then
    raise exception 'INVALID_REFERENCE' using errcode='22023';
  end if;

  if p_kind='platform_receivable' then
    if p_action not in ('paid','waived') then
      raise exception 'INVALID_FINANCIAL_ACTION' using errcode='22023';
    end if;

    update public.platform_receivables
    set status=p_action,
        paid_at=case when p_action='paid' then clock_timestamp() else paid_at end,
        waived_at=case when p_action='waived' then clock_timestamp() else waived_at end,
        updated_at=clock_timestamp()
    where order_id=p_target_id
      and status='open'
    returning to_jsonb(platform_receivables.*) into v_row;

  elsif p_kind='cashback_reimbursement' then
    if p_action not in ('paid','offset') then
      raise exception 'INVALID_FINANCIAL_ACTION' using errcode='22023';
    end if;

    update public.merchant_cashback_reimbursements
    set status=p_action,
        paid_at=case when p_action='paid' then clock_timestamp() else paid_at end,
        offset_at=case when p_action='offset' then clock_timestamp() else offset_at end,
        updated_at=clock_timestamp()
    where order_id=p_target_id
      and status='open'
    returning to_jsonb(merchant_cashback_reimbursements.*) into v_row;

  elsif p_kind='settlement_adjustment' then
    if p_action not in ('paid','waived') then
      raise exception 'INVALID_FINANCIAL_ACTION' using errcode='22023';
    end if;

    update public.platform_settlement_adjustments
    set status=p_action,
        settled_at=case when p_action='paid' then clock_timestamp() else settled_at end
    where id=p_target_id
      and status='open'
    returning to_jsonb(platform_settlement_adjustments.*) into v_row;

  else
    raise exception 'INVALID_FINANCIAL_KIND' using errcode='22023';
  end if;

  if v_row is null then
    raise exception 'FINANCIAL_ITEM_NOT_OPEN' using errcode='40001';
  end if;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,'financial_'||p_action,p_kind,p_target_id::text,
    jsonb_build_object('reference',p_reference,'result',v_row)
  );

  return jsonb_build_object('ok',true,'kind',p_kind,'action',p_action,'item',v_row);
end;
$$;

revoke all on function public.admin_financial_action(uuid,text,uuid,text,text)
from public, anon, authenticated;
grant execute on function public.admin_financial_action(uuid,text,uuid,text,text)
to service_role;
