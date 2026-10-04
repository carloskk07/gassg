-- TAMÃO v1.65 — governança administrativa da política comercial.
-- Políticas novas afetam apenas pedidos futuros porque economics são snapshotados no INSERT.

alter table public.reward_policy
  add column if not exists policy_version integer not null default 1,
  add column if not exists updated_by uuid,
  add column if not exists last_change_reason text;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conname='reward_policy_policy_version_check'
      and conrelid='public.reward_policy'::regclass
  ) then
    alter table public.reward_policy
      add constraint reward_policy_policy_version_check
      check(policy_version>=1);
  end if;
  if not exists(
    select 1 from pg_constraint
    where conname='reward_policy_last_change_reason_check'
      and conrelid='public.reward_policy'::regclass
  ) then
    alter table public.reward_policy
      add constraint reward_policy_last_change_reason_check
      check(last_change_reason is null or char_length(last_change_reason)<=1000);
  end if;
end
$$;

create table if not exists public.financial_policy_history (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null,
  previous_version integer not null,
  new_version integer not null,
  previous_policy jsonb not null,
  new_policy jsonb not null,
  reason text not null check(char_length(reason) between 3 and 1000),
  actor_user_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  check(new_version=previous_version+1)
);

create index if not exists financial_policy_history_key_version_idx
  on public.financial_policy_history(policy_key,new_version desc);

alter table public.financial_policy_history enable row level security;
revoke all on table public.financial_policy_history from public, anon, authenticated;
grant all on table public.financial_policy_history to service_role;

create or replace function public.admin_commercial_policy_action(
  p_actor_user_id uuid,
  p_expected_version integer,
  p_active boolean,
  p_platform_fee_bps integer,
  p_variable_cost_bps integer,
  p_minimum_contribution_bps integer,
  p_cashback_bps integer,
  p_direct_referral_bps integer,
  p_commission_hold_hours integer,
  p_reason text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_action public.action_requests%rowtype;
  v_policy public.reward_policy%rowtype;
  v_previous jsonb;
  v_new jsonb;
  v_launch_mode text;
  v_available_reward_bps integer;
  v_result jsonb;
begin
  perform public.require_platform_admin(p_actor_user_id);

  p_reason:=trim(regexp_replace(coalesce(p_reason,''),'\s+',' ','g'));

  if p_expected_version is null or p_expected_version<1 then
    raise exception 'INVALID_POLICY_VERSION' using errcode='22023';
  end if;
  if p_active is null then
    raise exception 'INVALID_POLICY_ACTIVE' using errcode='22023';
  end if;
  if p_platform_fee_bps is null or p_platform_fee_bps<0 or p_platform_fee_bps>5000
     or p_variable_cost_bps is null or p_variable_cost_bps<0 or p_variable_cost_bps>5000
     or p_minimum_contribution_bps is null or p_minimum_contribution_bps<0 or p_minimum_contribution_bps>5000
     or p_cashback_bps is null or p_cashback_bps<0 or p_cashback_bps>5000
     or p_direct_referral_bps is null or p_direct_referral_bps<0 or p_direct_referral_bps>5000 then
    raise exception 'INVALID_COMMERCIAL_POLICY_BPS' using errcode='22023';
  end if;
  if p_commission_hold_hours is null
     or p_commission_hold_hours<0
     or p_commission_hold_hours>2160 then
    raise exception 'INVALID_COMMISSION_HOLD' using errcode='22023';
  end if;
  if char_length(p_reason)<3 or char_length(p_reason)>1000 then
    raise exception 'COMMERCIAL_POLICY_REASON_REQUIRED' using errcode='22023';
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

  if p_active then
    if p_platform_fee_bps < p_variable_cost_bps + p_minimum_contribution_bps then
      raise exception 'COMMERCIAL_POLICY_CONTRIBUTION_UNFUNDED' using errcode='23514';
    end if;

    v_available_reward_bps:=
      p_platform_fee_bps
      - p_variable_cost_bps
      - p_minimum_contribution_bps;

    if p_cashback_bps + p_direct_referral_bps > v_available_reward_bps then
      raise exception 'COMMERCIAL_POLICY_REWARDS_UNFUNDED' using errcode='23514';
    end if;
  else
    select operation_mode
    into v_launch_mode
    from public.platform_launch_control
    where singleton=true;

    if coalesce(v_launch_mode,'PRELAUNCH') in ('PILOT','LIVE') then
      raise exception 'COMMERCIAL_POLICY_DISABLE_REQUIRES_PAUSE' using errcode='40001';
    end if;
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_actor_user_id,'admin-commercial-policy',p_request_hash
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
     or v_action.action_name<>'admin-commercial-policy'
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select *
  into v_policy
  from public.reward_policy
  where policy_key='default'
  for update;

  if not found then
    raise exception 'FINANCIAL_POLICY_MISSING' using errcode='55000';
  end if;
  if v_policy.policy_version<>p_expected_version then
    raise exception 'POLICY_VERSION_CONFLICT' using errcode='40001';
  end if;

  v_previous:=jsonb_build_object(
    'policyKey',v_policy.policy_key,
    'version',v_policy.policy_version,
    'active',v_policy.active,
    'platformFeeBps',v_policy.platform_fee_bps,
    'variableCostBps',v_policy.variable_cost_bps,
    'minimumContributionBps',v_policy.minimum_contribution_bps,
    'cashbackBps',v_policy.cashback_bps,
    'directReferralBps',v_policy.direct_referral_bps,
    'commissionHoldHours',v_policy.commission_hold_hours,
    'updatedAt',v_policy.updated_at,
    'updatedBy',v_policy.updated_by
  );

  update public.reward_policy
  set active=p_active,
      platform_fee_bps=p_platform_fee_bps,
      variable_cost_bps=p_variable_cost_bps,
      minimum_contribution_bps=p_minimum_contribution_bps,
      cashback_bps=p_cashback_bps,
      direct_referral_bps=p_direct_referral_bps,
      commission_hold_hours=p_commission_hold_hours,
      policy_version=policy_version+1,
      updated_by=p_actor_user_id,
      last_change_reason=p_reason,
      updated_at=clock_timestamp()
  where policy_key='default'
  returning * into v_policy;

  v_new:=jsonb_build_object(
    'policyKey',v_policy.policy_key,
    'version',v_policy.policy_version,
    'active',v_policy.active,
    'platformFeeBps',v_policy.platform_fee_bps,
    'variableCostBps',v_policy.variable_cost_bps,
    'minimumContributionBps',v_policy.minimum_contribution_bps,
    'cashbackBps',v_policy.cashback_bps,
    'directReferralBps',v_policy.direct_referral_bps,
    'commissionHoldHours',v_policy.commission_hold_hours,
    'updatedAt',v_policy.updated_at,
    'updatedBy',v_policy.updated_by,
    'lastChangeReason',v_policy.last_change_reason
  );

  insert into public.financial_policy_history(
    policy_key,previous_version,new_version,
    previous_policy,new_policy,reason,actor_user_id
  )
  values(
    'default',p_expected_version,v_policy.policy_version,
    v_previous,v_new,p_reason,p_actor_user_id
  );

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    'update-commercial-policy',
    'reward_policy',
    'default',
    jsonb_build_object(
      'previous',v_previous,
      'new',v_new,
      'reason',p_reason
    )
  );

  v_result:=jsonb_build_object(
    'ok',true,
    'policy',v_new,
    'appliesTo','future-orders-only'
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.admin_commercial_policy_action(
  uuid,integer,boolean,integer,integer,integer,integer,integer,integer,text,text,text
) from public, anon, authenticated;
grant execute on function public.admin_commercial_policy_action(
  uuid,integer,boolean,integer,integer,integer,integer,integer,integer,text,text,text
) to service_role;
