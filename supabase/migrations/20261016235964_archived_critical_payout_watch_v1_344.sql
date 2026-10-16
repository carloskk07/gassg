-- TAMÃO V1.344: retain historical visibility when administrative closure
-- or a void removes a critical reversal from the active follow-up queue.
-- Observations are NOT independent bank settlement evidence.
create or replace function public.admin_owner_payout_archived_critical_v1_344(
 p_actor uuid,p_offset integer default 0
) returns jsonb
language plpgsql stable security definer
set search_path to 'pg_catalog'
as $function$
declare v_result jsonb;
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active
    and a.admin_role in ('superadmin','finance')
 ) then raise exception 'ARCHIVED_PAYOUT_REVIEW_DENIED' using errcode='42501';end if;
 if p_offset is null or p_offset<0 or p_offset>999990 or p_offset%30<>0
 then raise exception 'ARCHIVED_PAYOUT_PAGE_INVALID' using errcode='22023';end if;
 with archived as (
   select c.claim_id,c.order_id,c.amount_cents,c.paid_on,c.reported_at,
     v.claim_id is not null as voided,
     coalesce(e.review_state,'not_started') as review_state,
     e.created_at as last_review_at,
     g.reversed_at as reward_reversed_at,
     case when v.claim_id is not null then 'voided'
          else 'closed_administrative' end as archive_reason
   from public.platform_referral_payout_claims_v1_263 c
   join public.order_reward_grants g on g.order_id=c.order_id
   left join public.platform_referral_payout_voids_v1_263 v
     on v.claim_id=c.claim_id
   left join lateral (
     select r.review_state,r.created_at
     from public.platform_referral_payout_review_events_v1_337 r
     where r.claim_id=c.claim_id order by r.event_id desc limit 1
   ) e on true
   where g.reversed_at is not null
     and (v.claim_id is not null or e.review_state='closed_administrative')
     and exists (
       select 1 from public.platform_referral_provider_observations_v1_265 obs
       where obs.claim_id=c.claim_id and obs.provider_transaction_success is true
     )
 )
 select pg_catalog.jsonb_build_object(
  'source','admin_payout_archived_critical_v1_344',
  'scope','historical_exceptions_all_months',
  'readOnly',true,'administrativeOnly',true,
  'bankSettlementVerified',false,'recipientVerified',false,
  'moneyMoved',false,'providerObservationIsBankProof',false,
  'totalClaims',(select count(*) from archived),
  'closedUnvoidedClaims',(select count(*) from archived where not voided),
  'voidedClaims',(select count(*) from archived where voided),
  'reportedAmountCents',(select coalesce(sum(amount_cents),0) from archived),
  'limit',30,'pageOffset',p_offset,'pageLimit',30,
  'hasPrevious',p_offset>0,
  'hasMore',(select count(*)>p_offset+30 from archived),
  'rows',coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'claimId',x.claim_id,'orderId',x.order_id,
      'claimMonth',date_trunc('month',x.paid_on::timestamp)::date,
      'paidOn',x.paid_on,
      'reportedAmountCents',x.amount_cents,
      'reportedAt',x.reported_at,
      'reviewState',x.review_state,'lastReviewAt',x.last_review_at,
      'rewardReversedAt',x.reward_reversed_at,
      'voided',x.voided,'archiveReason',x.archive_reason,
      'historicalProviderSuccessObserved',true
    ) order by x.voided,x.reward_reversed_at desc,x.claim_id)
    from (
      select * from archived
      order by voided,reward_reversed_at desc,claim_id
      limit 30 offset p_offset
    ) x
  ),'[]'::jsonb)
 ) into v_result;
 return v_result;
end;$function$;
revoke all on function public.admin_owner_payout_archived_critical_v1_344(uuid,integer)
 from public,anon,authenticated;
grant execute on function public.admin_owner_payout_archived_critical_v1_344(uuid,integer)
 to service_role;
notify pgrst,'reload schema';
