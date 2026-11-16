-- TAMÃO V1.1043 — refund/dispute reversal of verified Ads bonuses remains active
-- even when the owner suspends NEW bonus accruals. No policy enablement,
-- no new awards while disabled and no bank/payout writes.
-- This is an idempotent replacement of the existing service-only RPC.
begin;
create or replace function public.network_module_ads_bonus_refresh_v1_1041(p_inviter uuid)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare v_policy public.network_module_ads_bonus_policy_v1_1041%rowtype;
 v_added integer:=0;v_reversed integer:=0;
begin
 select * into v_policy from public.network_module_ads_bonus_policy_v1_1041 where singleton;
 -- Cancel any still-internal award if original transaction is reversed,
 -- net observation is disputed, or provider refund is in flight.
 with invalid as (
   select a.campaign_id from public.network_module_ads_bonus_awards_v1_1041 a
   join public.ads_independent_checkouts_v1_886 c on c.campaign_id=a.campaign_id
   left join public.platform_receipt_net_observations o
     on o.kind='advertising' and o.resource_id=c.campaign_id
   where a.inviter_user_id=p_inviter and a.status='validated'
     and (c.status is distinct from 'payment_approved' or c.provider_status is distinct from 'approved'
       or c.reversed_at is not null or o.status is distinct from 'net_verified'
       or exists(select 1 from public.ads_independent_refund_executions_v1_888 f
          where f.campaign_id=c.campaign_id)
       or exists(select 1 from public.ads_independent_refund_cases_v1_887 f
          where f.campaign_id=c.campaign_id))
 )
 update public.network_module_ads_bonus_awards_v1_1041 a
    set status='reversed',reversed_at=clock_timestamp()
 from invalid i where a.campaign_id=i.campaign_id;
 get diagnostics v_reversed=row_count;
 -- Suspending acquisition MUST NOT suspend refunds, disputes, or reversals.
 if not coalesce(v_policy.enabled,false) then
   return jsonb_build_object('source','network_ads_bonus_v1_1041',
    'enabled',false,'created',0,'reversed',v_reversed,'cashPayoutsEnabled',false);
 end if;

 -- One paid-ad acquisition bonus per account, from the FIRST fully verified
 -- net receipt; require that both invite binding and policy predate payment.
 with eligible as (
  select distinct on (c.owner_user_id)
   c.campaign_id,c.owner_user_id,b.inviter_user_id,c.approved_at,
   r.net_cents,r.evidence_reference,
   floor(r.net_cents::numeric*v_policy.inviter_bps/10000)::bigint as bonus,
   greatest(c.approved_at,r.release_at)+make_interval(days=>v_policy.maturation_days) as matured_at
  from public.ads_independent_checkouts_v1_886 c
  join public.network_module_invite_bindings_v1_1041 b
    on b.referred_user_id=c.owner_user_id and b.inviter_user_id=p_inviter
  join public.platform_receipt_net_audit r
    on r.kind='advertising' and r.resource_id=c.campaign_id
    and r.gross_cents=c.amount_cents and r.net_cents>0
    and r.release_at<=clock_timestamp()
  join public.platform_receipt_net_observations o
    on o.kind='advertising' and o.resource_id=c.campaign_id
    and o.status='net_verified'
  where c.status='payment_approved' and c.provider_status='approved'
   and c.reversed_at is null and c.approved_at is not null
   and c.approved_at>=b.bound_at and c.approved_at>=v_policy.effective_after
   and not exists(select 1 from public.ads_independent_refund_executions_v1_888 f
     where f.campaign_id=c.campaign_id)
   and not exists(select 1 from public.ads_independent_refund_cases_v1_887 f
     where f.campaign_id=c.campaign_id)
  order by c.owner_user_id,c.approved_at,c.campaign_id
 )
 insert into public.network_module_ads_bonus_awards_v1_1041
 (campaign_id,referred_user_id,inviter_user_id,approved_at,net_cents,
  bonus_cents,proof_reference,matured_at)
 select e.campaign_id,e.owner_user_id,e.inviter_user_id,e.approved_at,
  e.net_cents,e.bonus,e.evidence_reference,e.matured_at
 from eligible e where e.bonus>0 and e.matured_at<=clock_timestamp()
 on conflict do nothing;
 get diagnostics v_added=row_count;
 return jsonb_build_object('source','network_ads_bonus_v1_1041',
   'enabled',true,'created',v_added,'reversed',v_reversed,
   'cashPayoutsEnabled',false);
end $fn$;
-- Reassert service-only execution; do not grant this financial RPC to browsers.
revoke all on function public.network_module_ads_bonus_refresh_v1_1041(uuid) from public,anon,authenticated;
grant execute on function public.network_module_ads_bonus_refresh_v1_1041(uuid) to service_role;
commit;
