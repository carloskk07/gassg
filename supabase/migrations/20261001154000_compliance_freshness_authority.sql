-- Chama São Gabriel — compliance freshness authority v1.15.4
-- Operational revalidation policy (not a legal expiration rule):
-- CNPJ evidence: max 30 days; ANP evidence for active GLP: max 7 days.

alter table public.merchant_compliance
  add column if not exists cnpj_verified_at timestamptz,
  add column if not exists anp_verified_at timestamptz;

update public.merchant_compliance
set
  cnpj_verified_at=case
    when cnpj_status='verified' then coalesce(cnpj_verified_at,verified_at,updated_at)
    else null
  end,
  anp_verified_at=case
    when anp_status='verified' then coalesce(anp_verified_at,verified_at,updated_at)
    else null
  end;

create table if not exists public.merchant_compliance_policy (
  policy_key text primary key check (policy_key='default'),
  cnpj_max_age_days integer not null default 30
    check (cnpj_max_age_days between 1 and 365),
  anp_max_age_days integer not null default 7
    check (anp_max_age_days between 1 and 90),
  updated_at timestamptz not null default now()
);

insert into public.merchant_compliance_policy(
  policy_key,cnpj_max_age_days,anp_max_age_days
)
values('default',30,7)
on conflict(policy_key) do nothing;

alter table public.merchant_compliance_policy enable row level security;
revoke all on table public.merchant_compliance_policy from anon, authenticated;
grant all on table public.merchant_compliance_policy to service_role;

create table if not exists public.merchant_compliance_events (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'compliance_expired',
      'compliance_reverified',
      'compliance_suspended'
    )
  ),
  reason text not null check (char_length(reason) between 3 and 240),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.merchant_compliance_events enable row level security;
revoke all on table public.merchant_compliance_events from anon, authenticated;
grant all on table public.merchant_compliance_events to service_role;

create index if not exists merchant_compliance_events_merchant_idx
  on public.merchant_compliance_events(merchant_id,created_at desc);

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
      and c.cnpj_verified_at >= clock_timestamp()-make_interval(days=>p.cnpj_max_age_days)
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
  v_current boolean:=false;
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

  select
    c.anp_status='verified'
    and c.anp_verified_at is not null
    and c.anp_verified_at >= clock_timestamp()-make_interval(days=>p.anp_max_age_days)
  into v_current
  from public.merchant_compliance c
  cross join public.merchant_compliance_policy p
  where c.merchant_id=p_merchant_id
    and p.policy_key='default';

  return coalesce(v_current,false);
end;
$$;

revoke all on function public.merchant_anp_compliance_current(uuid)
from public, anon, authenticated;
grant execute on function public.merchant_anp_compliance_current(uuid)
to postgres, service_role;

create or replace function public.enforce_active_merchant_compliance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.status='active' or new.online then
    if not public.merchant_cnpj_compliance_current(new.id) then
      raise exception 'CNPJ_REVERIFICATION_REQUIRED' using errcode='23514';
    end if;

    if not public.merchant_anp_compliance_current(new.id) then
      raise exception 'ANP_REVERIFICATION_REQUIRED' using errcode='23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_active_merchant_compliance()
from public, anon, authenticated;
grant execute on function public.enforce_active_merchant_compliance()
to postgres, service_role;

create or replace function public.enforce_compliance_continuity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_merchant_id uuid;
  v_active boolean:=false;
begin
  v_merchant_id:=case when tg_op='DELETE' then old.merchant_id else new.merchant_id end;

  select m.status='active'
  into v_active
  from public.merchants m
  where m.id=v_merchant_id;

  if coalesce(v_active,false)
     and (
       not public.merchant_cnpj_compliance_current(v_merchant_id)
       or not public.merchant_anp_compliance_current(v_merchant_id)
     ) then

    update public.merchants
    set status='suspended',
        online=false,
        updated_at=clock_timestamp()
    where id=v_merchant_id
      and status='active';

    insert into public.merchant_compliance_events(
      merchant_id,event_type,reason,metadata
    )
    values(
      v_merchant_id,
      'compliance_suspended',
      'Evidência regulatória ausente, rejeitada ou vencida.',
      jsonb_build_object('source','continuity_trigger')
    );
  end if;

  return case when tg_op='DELETE' then old else new end;
end;
$$;

revoke all on function public.enforce_compliance_continuity()
from public, anon, authenticated;
grant execute on function public.enforce_compliance_continuity()
to postgres, service_role;

drop trigger if exists enforce_compliance_continuity_trg
on public.merchant_compliance;
create trigger enforce_compliance_continuity_trg
after insert or update of
  cnpj_status,anp_status,cnpj_verified_at,anp_verified_at
on public.merchant_compliance
for each row
execute function public.enforce_compliance_continuity();

drop trigger if exists enforce_compliance_delete_suspension_trg
on public.merchant_compliance;
create trigger enforce_compliance_delete_suspension_trg
before delete
on public.merchant_compliance
for each row
execute function public.enforce_compliance_continuity();

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
  v_now timestamptz:=clock_timestamp();
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_cnpj_status not in ('pending','verified','rejected')
     or p_anp_status not in ('pending','verified','not_required','rejected') then
    raise exception 'INVALID_COMPLIANCE_STATUS' using errcode='22023';
  end if;

  if p_anp_status='verified'
     and (
       p_anp_reference is null
       or char_length(trim(p_anp_reference))<3
       or char_length(trim(p_anp_reference))>240
     ) then
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
    verified_at,verified_by,updated_at,
    cnpj_verified_at,anp_verified_at
  )
  values(
    v_merchant.id,
    p_cnpj_status,
    p_anp_status,
    nullif(trim(p_anp_reference),''),
    nullif(trim(p_notes),''),
    case
      when p_cnpj_status='verified' and p_anp_status in ('verified','not_required')
      then v_now
      else null
    end,
    p_actor_user_id,
    v_now,
    case when p_cnpj_status='verified' then v_now else null end,
    case when p_anp_status='verified' then v_now else null end
  )
  on conflict(merchant_id) do update
  set cnpj_status=excluded.cnpj_status,
      anp_status=excluded.anp_status,
      anp_reference=excluded.anp_reference,
      notes=excluded.notes,
      verified_at=excluded.verified_at,
      verified_by=excluded.verified_by,
      cnpj_verified_at=excluded.cnpj_verified_at,
      anp_verified_at=excluded.anp_verified_at,
      updated_at=v_now;

  if p_cnpj_status='rejected' or p_anp_status='rejected' then
    update public.merchants
    set status='suspended',
        online=false,
        updated_at=v_now
    where id=v_merchant.id;
  end if;

  insert into public.merchant_compliance_events(
    merchant_id,event_type,reason,metadata
  )
  values(
    v_merchant.id,
    'compliance_reverified',
    'Evidências de compliance atualizadas por administrador.',
    jsonb_build_object(
      'cnpjStatus',p_cnpj_status,
      'anpStatus',p_anp_status,
      'cnpjVerifiedAt',case when p_cnpj_status='verified' then v_now else null end,
      'anpVerifiedAt',case when p_anp_status='verified' then v_now else null end
    )
  );

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    'merchant_compliance_updated',
    'merchant',
    v_merchant.id::text,
    jsonb_build_object(
      'cnpjStatus',p_cnpj_status,
      'anpStatus',p_anp_status,
      'anpReference',p_anp_reference,
      'cnpjVerifiedAt',case when p_cnpj_status='verified' then v_now else null end,
      'anpVerifiedAt',case when p_anp_status='verified' then v_now else null end
    )
  );

  return jsonb_build_object(
    'ok',true,
    'merchantId',v_merchant.id,
    'cnpjStatus',p_cnpj_status,
    'anpStatus',p_anp_status,
    'cnpjVerifiedAt',case when p_cnpj_status='verified' then v_now else null end,
    'anpVerifiedAt',case when p_anp_status='verified' then v_now else null end
  );
end;
$$;

revoke all on function public.admin_verify_merchant(
  uuid,uuid,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.admin_verify_merchant(
  uuid,uuid,text,text,text,text
) to service_role;

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

    if not public.merchant_cnpj_compliance_current(v_merchant.id) then
      raise exception 'CNPJ_REVERIFICATION_REQUIRED' using errcode='40001';
    end if;

    if not public.merchant_anp_compliance_current(v_merchant.id) then
      raise exception 'ANP_REVERIFICATION_REQUIRED' using errcode='40001';
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
    case when p_status='active' then 'merchant_activated' else 'merchant_suspended' end,
    'merchant',
    v_merchant.id::text,
    jsonb_build_object('status',p_status)
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
to service_role;

create or replace function public.process_compliance_expiry()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_row record;
  v_count integer:=0;
begin
  for v_row in
    select m.id
    from public.merchants m
    where m.status='active'
      and (
        not public.merchant_cnpj_compliance_current(m.id)
        or not public.merchant_anp_compliance_current(m.id)
      )
    order by m.id
    for update skip locked
  loop
    update public.merchants
    set status='suspended',
        online=false,
        updated_at=clock_timestamp()
    where id=v_row.id
      and status='active';

    if found then
      insert into public.merchant_compliance_events(
        merchant_id,event_type,reason,metadata
      )
      values(
        v_row.id,
        'compliance_expired',
        'A janela operacional de revalidação expirou.',
        jsonb_build_object('source','scheduled_watchdog')
      );
      v_count:=v_count+1;
    end if;
  end loop;

  return jsonb_build_object('suspendedMerchants',v_count);
end;
$$;

revoke all on function public.process_compliance_expiry()
from public, anon, authenticated;
grant execute on function public.process_compliance_expiry()
to postgres, service_role;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname='chama-compliance-expiry';

  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  perform cron.schedule(
    'chama-compliance-expiry',
    '19 4 * * *',
    'select public.process_compliance_expiry();'
  );
end;
$$;
