-- TAMÃO V1.228: prospective (not live) merchant-to-merchant referral economics.
-- Crucially the existing fee-credit ledger's immutable balance equation cannot
-- accept arbitrary new entry types. No credit mutation, payouts or campaign start.
create table if not exists public.growth_merchant_benefit_policy_v1_228(
  policy_key text primary key check(policy_key='merchant_first_level_v1'),
  reward_enabled boolean not null default false check(reward_enabled=false),
  share_of_received_platform_fee_bps integer not null
    check(share_of_received_platform_fee_bps between 0 and 500),
  eligibility_days integer not null check(eligibility_days between 1 and 90),
  total_per_referred_merchant_cap_cents integer not null
    check(total_per_referred_merchant_cap_cents between 0 and 20000),
  max_levels integer not null default 1 check(max_levels=1),
  requires_verified_conversion boolean not null default true
    check(requires_verified_conversion=true),
  requires_actual_fee_receipt boolean not null default true
    check(requires_actual_fee_receipt=true),
  requires_refund_clearance boolean not null default true
    check(requires_refund_clearance=true),
  financial_approval_required boolean not null default true
    check(financial_approval_required=true),
  created_at timestamptz not null default clock_timestamp()
);
insert into public.growth_merchant_benefit_policy_v1_228(
  policy_key,reward_enabled,share_of_received_platform_fee_bps,
  eligibility_days,total_per_referred_merchant_cap_cents,max_levels
)values('merchant_first_level_v1',false,500,90,20000,1)
on conflict (policy_key) do nothing;
alter table public.growth_merchant_benefit_policy_v1_228 enable row level security;
revoke all on public.growth_merchant_benefit_policy_v1_228
 from public,anon,authenticated,service_role;
grant select on public.growth_merchant_benefit_policy_v1_228 to service_role;
-- Rows are not writable by the API; only a future audited migration may
-- authorize a financial campaign after revenue, reversals and fraud controls.

create or replace function public.admin_growth_merchant_benefit_preview_v1_228(
  p_actor_user_id uuid,
  p_received_fee_cents bigint,
  p_existing_rewards_cents bigint,
  p_variable_cost_cents bigint,
  p_minimum_contribution_cents bigint,
  p_prior_merchant_referral_credits_cents bigint
) returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog
as $fn$
declare
  v_policy public.growth_merchant_benefit_policy_v1_228%rowtype;
  v_target bigint;
  v_remaining_margin bigint;
  v_remaining_cap bigint;
  v_hypothetical bigint;
begin
  if not exists(select 1 from public.platform_admins a where
    a.user_id=p_actor_user_id and a.active and a.admin_role in ('superadmin','finance'))
  then raise exception 'GROWTH_FINANCE_PREVIEW_DENIED' using errcode='42501'; end if;
  if p_received_fee_cents is null or p_existing_rewards_cents is null
     or p_variable_cost_cents is null or p_minimum_contribution_cents is null
     or p_prior_merchant_referral_credits_cents is null
     or p_received_fee_cents<0 or p_received_fee_cents>100000000
     or p_existing_rewards_cents<0 or p_existing_rewards_cents>100000000
     or p_variable_cost_cents<0 or p_variable_cost_cents>100000000
     or p_minimum_contribution_cents<0 or p_minimum_contribution_cents>100000000
     or p_prior_merchant_referral_credits_cents<0
     or p_prior_merchant_referral_credits_cents>100000000
  then raise exception 'INVALID_GROWTH_FINANCE_SCENARIO' using errcode='22023'; end if;
  select * into v_policy from public.growth_merchant_benefit_policy_v1_228
    where policy_key='merchant_first_level_v1';
  if v_policy.policy_key is null or v_policy.reward_enabled then
    raise exception 'GROWTH_PREVIEW_POLICY_UNVERIFIED' using errcode='42501';
  end if;
  v_target:=floor(p_received_fee_cents::numeric*
    v_policy.share_of_received_platform_fee_bps/10000)::bigint;
  v_remaining_margin:=greatest(0,p_received_fee_cents-
    p_existing_rewards_cents-p_variable_cost_cents-
    p_minimum_contribution_cents-p_prior_merchant_referral_credits_cents);
  v_remaining_cap:=greatest(0,
    v_policy.total_per_referred_merchant_cap_cents-
    p_prior_merchant_referral_credits_cents);
  v_hypothetical:=least(v_target,v_remaining_margin,v_remaining_cap);
  return jsonb_build_object(
    'source','merchant_referral_finance_preview_v1_228','readOnly',true,
    'isScenarioNotRealPayment',true,'rewardEnabled',false,'grantableCents',0,
    'feeBasis','actual_tamao_fee_received_only',
    'noMerchantSaleProceeds',true,'noPayout',true,
    'singleLevel',v_policy.max_levels=1,
    'shareBps',v_policy.share_of_received_platform_fee_bps,
    'days',v_policy.eligibility_days,
    'perReferredMerchantCapCents',v_policy.total_per_referred_merchant_cap_cents,
    'receivedFeeCents',p_received_fee_cents,
    'existingRewardsCents',p_existing_rewards_cents,
    'variableCostCents',p_variable_cost_cents,
    'minimumContributionCents',p_minimum_contribution_cents,
    'priorCreditsCents',p_prior_merchant_referral_credits_cents,
    'targetCents',v_target,
    'safeMarginRemainingCents',v_remaining_margin,
    'capRemainingCents',v_remaining_cap,
    'illustrativeBenefitCents',v_hypothetical,
    'activationRequirements',jsonb_build_array(
      'Verified merchant lead-to-CNPJ conversion',
      'Proven TAMÃO fee receipt from PSP or billing reconciliation',
      'Refund and chargeback clearance',
      'Margin-preserving ledger integration and reversal handling',
      'Financial admin approval and activation migration')
  );
end;
$fn$;
revoke all on function public.admin_growth_merchant_benefit_preview_v1_228(uuid,bigint,bigint,bigint,bigint,bigint)
 from public,anon,authenticated;
grant execute on function public.admin_growth_merchant_benefit_preview_v1_228(uuid,bigint,bigint,bigint,bigint,bigint)
 to service_role;
