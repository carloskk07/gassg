-- TAMÃO V1.340: persistent cases across months, read-only.
-- Internal follow-up dates are NOT financial, statutory or PSP settlement SLAs.
create or replace function public.admin_owner_payout_global_followup_v1_340(p_actor uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog'
as $f$
declare v_data jsonb;
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance')
 ) then raise exception 'PAYOUT_GLOBAL_FOLLOWUP_READ_DENIED' using errcode='42501';end if;

 with claims as (
  select c.claim_id,c.order_id,c.amount_cents,c.paid_on,c.reported_at,
    v.claim_id is not null as voided,
    coalesce(e.review_state,'not_started') review_state,
    e.created_at last_review_at,
    (g.reversed_at is not null and exists (
       select 1 from public.platform_referral_provider_observations_v1_265 obs
       where obs.claim_id=c.claim_id and obs.provider_transaction_success is true
    )) as critical_reversal
  from public.platform_referral_payout_claims_v1_263 c
  left join public.platform_referral_payout_voids_v1_263 v on v.claim_id=c.claim_id
  left join public.order_reward_grants g on g.order_id=c.order_id
  left join lateral(
    select r.review_state,r.created_at
    from public.platform_referral_payout_review_events_v1_337 r
    where r.claim_id=c.claim_id order by r.event_id desc limit 1
  ) e on true
 ), active_cases as (
  select *,
   case review_state
    when 'not_started' then reported_at+interval '24 hours'
    when 'in_review' then last_review_at+interval '48 hours'
    when 'awaiting_evidence' then last_review_at+interval '72 hours'
    when 'reviewed_no_bank_proof' then last_review_at+interval '168 hours'
   end as due_at
  from claims
  where not voided and review_state<>'closed_administrative'
 ), priority_cases as (
  select *,
   (due_at<=statement_timestamp()) overdue,
   case when critical_reversal then 0
        when due_at<=statement_timestamp() then 1 else 2 end priority,
   date_trunc('month',paid_on::timestamp)::date as claim_month
  from active_cases
 )
 select jsonb_build_object(
  'source','admin_payout_global_followup_v1_340',
  'scope','all_months',
  'readOnly',true,'administrativeOnly',true,
  'bankSettlementVerified',false,'recipientVerified',false,'moneyMoved',false,
  'duePolicy','internal_guidance_not_external_SLA','timezone','America/Sao_Paulo',
  'activeClaims',(select count(*) from priority_cases),
  'activeOlderMonths',(select count(*) from priority_cases
    where paid_on<date_trunc('month',statement_timestamp() at time zone 'America/Sao_Paulo')::date),
  'overdueClaims',(select count(*) from priority_cases where overdue),
  'criticalReversalClaims',(select count(*) from priority_cases where critical_reversal),
  'unreviewedClaims',(select count(*) from priority_cases where review_state='not_started'),
  'awaitingEvidenceClaims',(select count(*) from priority_cases where review_state='awaiting_evidence'),
  'distinctMonths',(select count(distinct claim_month) from priority_cases),
  'limit',30,
  'truncated',(select count(*)>30 from priority_cases),
  'rows',coalesce((
   select jsonb_agg(jsonb_build_object(
     'claimId',q.claim_id,'orderId',q.order_id,
     'claimMonth',q.claim_month,'paidOn',q.paid_on,
     'reportedAmountCents',q.amount_cents,
     'reviewState',q.review_state,'followupDueAt',q.due_at,
     'overdue',q.overdue,'priority',q.priority,
     'criticalReversalObserved',q.critical_reversal
   ) order by q.priority,q.due_at,q.claim_id)
   from (select * from priority_cases
     order by priority,due_at,claim_id limit 30) q
  ),'[]'::jsonb)
 ) into v_data;
 return v_data;
end;$f$;
revoke all on function public.admin_owner_payout_global_followup_v1_340(uuid)
 from public,anon,authenticated;
grant execute on function public.admin_owner_payout_global_followup_v1_340(uuid)
 to service_role;
notify pgrst,'reload schema';
