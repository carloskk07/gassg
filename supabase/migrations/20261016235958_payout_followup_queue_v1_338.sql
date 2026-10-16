-- TAMÃO V1.338 — read-only administrative review follow-up and suggested deadlines.
-- Times are internal triage thresholds, not banking promises or regulatory SLAs.
create or replace function public.admin_owner_payout_followup_read_v1_338(
  p_actor uuid,p_month date
) returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_month date:=coalesce(p_month,date_trunc('month',statement_timestamp() at time zone 'America/Sao_Paulo')::date);
  v_result jsonb;
begin
 if p_actor is null or not exists(
   select 1 from public.platform_admins a
   where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance')
 ) then raise exception 'PAYOUT_FOLLOWUP_READ_DENIED' using errcode='42501';end if;
 if extract(day from v_month)<>1 or v_month<date '2026-01-01'
   or v_month>(date_trunc('month',statement_timestamp() at time zone 'America/Sao_Paulo')+interval '2 months')::date
 then raise exception 'PAYOUT_FOLLOWUP_MONTH_INVALID' using errcode='22023';end if;
 with claims as (
   select c.claim_id,c.order_id,c.amount_cents,c.reported_at,
     v.claim_id is not null as voided,
     coalesce(e.review_state,'not_started') as review_state,
     e.created_at as last_review_at,
     (g.reversed_at is not null and exists(
       select 1 from public.platform_referral_provider_observations_v1_265 obs
       where obs.claim_id=c.claim_id and obs.provider_transaction_success is true
     )) as reversed_after_observed_success
   from public.platform_referral_payout_claims_v1_263 c
   left join public.platform_referral_payout_voids_v1_263 v on v.claim_id=c.claim_id
   left join public.order_reward_grants g on g.order_id=c.order_id
   left join lateral (
     select r.review_state,r.created_at
     from public.platform_referral_payout_review_events_v1_337 r
     where r.claim_id=c.claim_id
     order by r.event_id desc limit 1
   ) e on true
   where c.paid_on>=v_month and c.paid_on<(v_month+interval '1 month')::date
 ), due as (
   select *,
     case review_state
       when 'not_started' then reported_at+interval '24 hours'
       when 'in_review' then last_review_at+interval '48 hours'
       when 'awaiting_evidence' then last_review_at+interval '72 hours'
       when 'reviewed_no_bank_proof' then last_review_at+interval '168 hours'
       else null::timestamptz
     end as followup_due_at
   from claims
 ), triaged as (
   select *,
     followup_due_at<=statement_timestamp() as overdue,
     case
       when reversed_after_observed_success then 0
       when followup_due_at<=statement_timestamp() then 1
       else 2
     end as priority
   from due where not voided and review_state<>'closed_administrative'
 )
 select jsonb_build_object(
   'source','admin_payout_followup_queue_v1_338',
   'month',v_month,'timezone','America/Sao_Paulo',
   'readOnly',true,'administrativeOnly',true,
   'bankSettlementVerified',false,'recipientVerified',false,'moneyMoved',false,
   'duePolicy','internal_guidance_not_external_SLA',
   'firstReviewHours',24,'inReviewHours',48,'awaitingEvidenceHours',72,
   'noBankProofRecheckHours',168,
   'totalClaims',(select count(*) from claims),
   'voidedClaims',(select count(*) from claims where voided),
   'closedAdministrativeClaims',(select count(*) from claims where not voided and review_state='closed_administrative'),
   'activeClaims',(select count(*) from triaged),
   'unreviewedClaims',(select count(*) from triaged where review_state='not_started'),
   'awaitingEvidenceClaims',(select count(*) from triaged where review_state='awaiting_evidence'),
   'inReviewClaims',(select count(*) from triaged where review_state='in_review'),
   'noBankProofClaims',(select count(*) from triaged where review_state='reviewed_no_bank_proof'),
   'overdueClaims',(select count(*) from triaged where overdue),
   'criticalReversalClaims',(select count(*) from triaged where reversed_after_observed_success),
   'limit',30,'truncated',(select count(*)>30 from triaged),
   'rows',coalesce((
      select jsonb_agg(jsonb_build_object(
         'claimId',q.claim_id,'orderId',q.order_id,
         'reportedAmountCents',q.amount_cents,'reportedAt',q.reported_at,
         'reviewState',q.review_state,'lastReviewAt',q.last_review_at,
         'followupDueAt',q.followup_due_at,
         'overdue',q.overdue,'priority',q.priority,
         'criticalReversalObserved',q.reversed_after_observed_success
       ) order by q.priority,q.followup_due_at,q.claim_id)
      from (
        select * from triaged
        order by priority,followup_due_at,claim_id limit 30
      ) q
    ),'[]'::jsonb)
 ) into v_result;
 return v_result;
end;$function$;
revoke all on function public.admin_owner_payout_followup_read_v1_338(uuid,date)
 from public,anon,authenticated;
grant execute on function public.admin_owner_payout_followup_read_v1_338(uuid,date)
 to service_role;
notify pgrst,'reload schema';
