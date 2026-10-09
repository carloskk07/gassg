-- TAMÃO — Admin billing plan governance v1.133
-- Makes merchant billing plan fees explicitly versioned, audited and editable
-- for future orders without mutating historical order snapshots.

alter table public.merchant_billing_plans
  add column if not exists policy_version integer not null default 1,
  add column if not exists updated_by uuid,
  add column if not exists last_change_reason text;

do $$
begin
  if not exists(
    select 1
    from pg_catalog.pg_constraint
    where conname='merchant_billing_plans_updated_by_fkey'
      and conrelid='public.merchant_billing_plans'::regclass
  ) then
    alter table public.merchant_billing_plans
      add constraint merchant_billing_plans_updated_by_fkey
      foreign key(updated_by) references auth.users(id) on delete set null;
  end if;

  if not exists(
    select 1
    from pg_catalog.pg_constraint
    where conname='merchant_billing_plans_policy_version_check'
      and conrelid='public.merchant_billing_plans'::regclass
  ) then
    alter table public.merchant_billing_plans
      add constraint merchant_billing_plans_policy_version_check
      check (policy_version >= 1);
  end if;
end
$$;

create index if not exists merchant_billing_plans_updated_by_idx
  on public.merchant_billing_plans(updated_by)
  where updated_by is not null;

create table if not exists public.merchant_billing_plan_history (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null,
  policy_version integer not null check (policy_version >= 1),
  display_name text not null,
  billing_mode text not null,
  platform_fee_bps integer not null,
  purchase_amount_cents integer,
  credit_grant_cents integer,
  active boolean not null,
  changed_by uuid references auth.users(id) on delete set null,
  change_reason text,
  changed_at timestamptz not null default clock_timestamp(),
  unique(plan_key,policy_version)
);

alter table public.merchant_billing_plan_history enable row level security;
revoke all on table public.merchant_billing_plan_history
  from public,anon,authenticated;
grant all on table public.merchant_billing_plan_history
  to service_role;

create index if not exists merchant_billing_plan_history_plan_idx
  on public.merchant_billing_plan_history(plan_key,policy_version desc);

insert into public.merchant_billing_plan_history(
  plan_key,policy_version,display_name,billing_mode,
  platform_fee_bps,purchase_amount_cents,credit_grant_cents,
  active,changed_by,change_reason,changed_at
)
select
  p.plan_key,p.policy_version,p.display_name,p.billing_mode,
  p.platform_fee_bps,p.purchase_amount_cents,p.credit_grant_cents,
  p.active,p.updated_by,
  coalesce(p.last_change_reason,'Baseline importada pela governança V1.133'),
  p.updated_at
from public.merchant_billing_plans p
on conflict(plan_key,policy_version) do nothing;

create or replace function public.admin_merchant_billing_plan_action(
  p_actor_user_id uuid,
  p_plan_key text,
  p_expected_version integer,
  p_platform_fee_bps integer,
  p_active boolean,
  p_reason text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_action public.action_requests%rowtype;
  v_plan public.merchant_billing_plans%rowtype;
  v_previous jsonb;
  v_new jsonb;
  v_result jsonb;
begin
  perform public.require_platform_admin(p_actor_user_id);

  p_plan_key:=lower(trim(coalesce(p_plan_key,'')));
  p_reason:=trim(regexp_replace(coalesce(p_reason,''),'\s+',' ','g'));

  if p_plan_key!~'^[a-z][a-z0-9_]{1,63}$' then
    raise exception 'INVALID_BILLING_PLAN_KEY' using errcode='22023';
  end if;
  if p_expected_version is null or p_expected_version<1 then
    raise exception 'INVALID_BILLING_PLAN_VERSION' using errcode='22023';
  end if;
  if p_platform_fee_bps is null
     or p_platform_fee_bps<1
     or p_platform_fee_bps>10000 then
    raise exception 'INVALID_BILLING_PLAN_FEE' using errcode='22023';
  end if;
  if p_active is null then
    raise exception 'INVALID_BILLING_PLAN_ACTIVE' using errcode='22023';
  end if;
  if p_plan_key='flex_daily' and p_active is not true then
    raise exception 'FLEX_BILLING_PLAN_MUST_REMAIN_ACTIVE' using errcode='23514';
  end if;
  if char_length(p_reason)<3 or char_length(p_reason)>1000 then
    raise exception 'BILLING_PLAN_REASON_REQUIRED' using errcode='22023';
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
    p_idempotency_key,p_actor_user_id,
    'admin-merchant-billing-plan',p_request_hash
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
     or v_action.action_name<>'admin-merchant-billing-plan'
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select *
  into v_plan
  from public.merchant_billing_plans
  where plan_key=p_plan_key
  for update;

  if not found then
    raise exception 'BILLING_PLAN_NOT_FOUND' using errcode='P0002';
  end if;
  if v_plan.policy_version<>p_expected_version then
    raise exception 'BILLING_PLAN_VERSION_CONFLICT' using errcode='40001';
  end if;

  v_previous:=jsonb_build_object(
    'planKey',v_plan.plan_key,
    'displayName',v_plan.display_name,
    'billingMode',v_plan.billing_mode,
    'version',v_plan.policy_version,
    'platformFeeBps',v_plan.platform_fee_bps,
    'purchaseAmountCents',v_plan.purchase_amount_cents,
    'creditGrantCents',v_plan.credit_grant_cents,
    'active',v_plan.active,
    'updatedAt',v_plan.updated_at,
    'updatedBy',v_plan.updated_by
  );

  update public.merchant_billing_plans
  set platform_fee_bps=p_platform_fee_bps,
      active=p_active,
      policy_version=policy_version+1,
      updated_by=p_actor_user_id,
      last_change_reason=p_reason,
      updated_at=clock_timestamp()
  where plan_key=p_plan_key
  returning * into v_plan;

  v_new:=jsonb_build_object(
    'planKey',v_plan.plan_key,
    'displayName',v_plan.display_name,
    'billingMode',v_plan.billing_mode,
    'version',v_plan.policy_version,
    'platformFeeBps',v_plan.platform_fee_bps,
    'purchaseAmountCents',v_plan.purchase_amount_cents,
    'creditGrantCents',v_plan.credit_grant_cents,
    'active',v_plan.active,
    'updatedAt',v_plan.updated_at,
    'updatedBy',v_plan.updated_by,
    'lastChangeReason',v_plan.last_change_reason
  );

  insert into public.merchant_billing_plan_history(
    plan_key,policy_version,display_name,billing_mode,
    platform_fee_bps,purchase_amount_cents,credit_grant_cents,
    active,changed_by,change_reason,changed_at
  )
  values(
    v_plan.plan_key,v_plan.policy_version,v_plan.display_name,
    v_plan.billing_mode,v_plan.platform_fee_bps,
    v_plan.purchase_amount_cents,v_plan.credit_grant_cents,
    v_plan.active,p_actor_user_id,p_reason,v_plan.updated_at
  );

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    'update-merchant-billing-plan',
    'merchant_billing_plan',
    v_plan.plan_key,
    jsonb_build_object(
      'previous',v_previous,
      'new',v_new,
      'reason',p_reason,
      'appliesTo','future-orders-only'
    )
  );

  v_result:=jsonb_build_object(
    'ok',true,
    'plan',v_new,
    'appliesTo','future-orders-only'
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.admin_merchant_billing_plan_action(
  uuid,text,integer,integer,boolean,text,text,text
) from public,anon,authenticated;
grant execute on function public.admin_merchant_billing_plan_action(
  uuid,text,integer,integer,boolean,text,text,text
) to service_role,postgres;
