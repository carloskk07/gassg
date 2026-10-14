-- TAMÃO V1.265: immutable observations read from the official MP outgoing Payouts GET API.
-- No payout creation; never equate transaction status with verified beneficiary.
create schema if not exists platform_payout_provider_private_v1_265;
revoke all on schema platform_payout_provider_private_v1_265 from public,anon,authenticated;
grant usage on schema platform_payout_provider_private_v1_265 to service_role;

create table public.platform_referral_provider_observations_v1_265(
 observation_id uuid primary key default gen_random_uuid(),
 claim_id uuid not null references public.platform_referral_payout_claims_v1_263(claim_id) on delete cascade,
 payout_id text not null check(payout_id ~ '^POP[0-9A-Z]{10,45}$'),
 transaction_id text not null check(transaction_id ~ '^TOP[0-9A-Z]{10,45}$'),
 transaction_reference text not null,
 provider_status text not null check(provider_status in
  ('created','approved','pending','in_process','success','error','canceled','unknown')),
 status_detail text not null check(length(status_detail)<=100),
 amount_cents bigint not null check(amount_cents between 0 and 100000000),
 provider_updated_at timestamptz,
 response_sha256 text not null check(response_sha256 ~ '^[0-9a-f]{64}$'),
 reference_matches boolean not null,
 amount_matches boolean not null,
 claim_eligible_at_check boolean not null,
 provider_transaction_success boolean not null,
 recipient_verified boolean not null default false check(recipient_verified=false),
 bank_settlement_verified boolean not null default false check(bank_settlement_verified=false),
 checked_by uuid not null,
 checked_at timestamptz not null default clock_timestamp(),
 unique(claim_id,payout_id,transaction_id,response_sha256),
 check(provider_transaction_success=
   (provider_status='success' and status_detail='accredited'
    and reference_matches and amount_matches and claim_eligible_at_check))
);
create index platform_referral_provider_observations_lookup_v1_265
 on public.platform_referral_provider_observations_v1_265(claim_id,checked_at desc);
create index platform_referral_provider_observations_transaction_v1_265
 on public.platform_referral_provider_observations_v1_265(payout_id,transaction_id);
alter table public.platform_referral_provider_observations_v1_265 enable row level security;
revoke all on public.platform_referral_provider_observations_v1_265 from public,anon,authenticated,service_role;

create or replace function platform_payout_provider_private_v1_265.target(
 p_actor uuid,p_claim uuid
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare v public.platform_referral_payout_claims_v1_263%rowtype;
v_active boolean;v_eligible boolean;
begin
 perform platform_referral_payout_private_v1_263.assert_owner(p_actor);
 select * into v from public.platform_referral_payout_claims_v1_263
  where claim_id=p_claim;
 if not found then raise exception 'PAYOUT_PROVIDER_CLAIM_NOT_FOUND' using errcode='P0002';end if;
 select not exists(select 1 from public.platform_referral_payout_voids_v1_263
  where claim_id=p_claim) into v_active;
 select exists(select 1 from public.order_reward_grants g
  where g.order_id=v.order_id and g.referrer_user_id=v.beneficiary_user_id
   and g.referral_pending_cents=v.amount_cents
   and g.matured_at is not null and g.reversed_at is null) into v_eligible;
 return jsonb_build_object('source','owner_payout_provider_target_v1_265',
  'claimId',p_claim,'provider',v.provider,
  'reference',v.provider_reference,'amountCents',v.amount_cents,
  'active',v_active,'eligible',v_eligible,
  'bankVerified',false,'recipientVerified',false);
end;$fn$;

create or replace function platform_payout_provider_private_v1_265.record(
 p_actor uuid,p_claim uuid,p_payout text,p_transaction text,
 p_reference text,p_amount bigint,p_status text,p_detail text,
 p_updated timestamptz,p_digest text
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $fn$
declare v public.platform_referral_payout_claims_v1_263%rowtype;
v_active boolean;v_eligible boolean;v_ref boolean;v_amt boolean;v_success boolean;
v_id uuid;
begin
 perform platform_referral_payout_private_v1_263.assert_owner(p_actor);
 if p_claim is null or p_payout !~ '^POP[0-9A-Z]{10,45}$'
  or p_transaction !~ '^TOP[0-9A-Z]{10,45}$'
  or p_reference is null or length(p_reference) not between 8 and 120
  or p_amount is null or p_amount<0 or p_amount>100000000
  or p_status not in ('created','approved','pending','in_process',
    'success','error','canceled','unknown')
  or p_detail is null or length(p_detail)>100
  or p_digest !~ '^[0-9a-f]{64}$'
  or p_updated is null or p_updated>clock_timestamp()+interval '5 minutes'
 then raise exception 'PAYOUT_PROVIDER_INVALID' using errcode='22023';end if;
 -- Serialize by transaction and refuse reuse of one payout transaction as
 -- evidence on multiple independent claims.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   'outbound-payout-provider-v1_265:'||p_payout||':'||p_transaction,0));
 if exists(select 1 from public.platform_referral_provider_observations_v1_265 o
  where o.payout_id=p_payout and o.transaction_id=p_transaction
   and o.claim_id<>p_claim)
 then raise exception 'PAYOUT_PROVIDER_TRANSACTION_REUSED' using errcode='23505';end if;
 select * into v from public.platform_referral_payout_claims_v1_263
  where claim_id=p_claim for share;
 if not found or v.provider<>'mercado_pago' then
  raise exception 'PAYOUT_PROVIDER_UNSUPPORTED_CLAIM' using errcode='22023';end if;
 select not exists(select 1 from public.platform_referral_payout_voids_v1_263
  where claim_id=p_claim) into v_active;
 select exists(select 1 from public.order_reward_grants g
  where g.order_id=v.order_id and g.referrer_user_id=v.beneficiary_user_id
   and g.referral_pending_cents=v.amount_cents
   and g.matured_at is not null and g.reversed_at is null) into v_eligible;
 v_ref:=p_reference=v.provider_reference;
 v_amt:=p_amount=v.amount_cents;
 v_success:=p_status='success' and p_detail='accredited' and v_ref and v_amt
   and v_active and v_eligible;
 insert into public.platform_referral_provider_observations_v1_265(
  claim_id,payout_id,transaction_id,transaction_reference,provider_status,status_detail,
  amount_cents,provider_updated_at,response_sha256,reference_matches,
  amount_matches,claim_eligible_at_check,provider_transaction_success,checked_by)
 values(p_claim,p_payout,p_transaction,p_reference,p_status,p_detail,p_amount,
  p_updated,p_digest,v_ref,v_amt,v_active and v_eligible,v_success,p_actor)
 on conflict(claim_id,payout_id,transaction_id,response_sha256)
 do nothing returning observation_id into v_id;
 if v_id is null then
  select observation_id into v_id from public.platform_referral_provider_observations_v1_265
   where claim_id=p_claim and payout_id=p_payout and transaction_id=p_transaction
    and response_sha256=p_digest;
 end if;
 return jsonb_build_object('source','owner_payout_provider_observation_v1_265',
  'observationId',v_id,'claimId',p_claim,'status',p_status,
  'statusDetail',p_detail,'referenceMatches',v_ref,'amountMatches',v_amt,
  'eligibleNow',v_active and v_eligible,'providerTransactionSuccess',v_success,
  'recipientVerified',false,'bankSettlementVerified',false,'transferExecuted',false);
end;$fn$;

create or replace function platform_payout_provider_private_v1_265.read(
 p_actor uuid,p_month date default null
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare
 v_month date:=coalesce(p_month,date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')::date);
 v_rows jsonb;v_total bigint;v_checked bigint;v_success bigint;v_unmatched bigint;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
   where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance'))
 then raise exception 'PAYOUT_PROVIDER_READ_DENIED' using errcode='42501';end if;
 if extract(day from v_month)<>1 or v_month<date '2026-01-01'
  or v_month>(date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')
    +interval '2 months')::date
 then raise exception 'PAYOUT_PROVIDER_MONTH_INVALID' using errcode='22023';end if;
 with claims as (
  select c.claim_id,c.reported_at,v.claim_id is not null voided,
   o.provider_status,o.status_detail,o.reference_matches,o.amount_matches,
   o.provider_transaction_success,o.checked_at,
   o.payout_id,o.transaction_id,
   coalesce(o.provider_transaction_success,false) and v.claim_id is null
     and g.reversed_at is null and g.matured_at is not null
     and g.referrer_user_id=c.beneficiary_user_id
     and g.referral_pending_cents=c.amount_cents as success_now,
   p.claim_id is not null proof_present
  from public.platform_referral_payout_claims_v1_263 c
  left join public.platform_referral_payout_voids_v1_263 v on v.claim_id=c.claim_id
  left join public.order_reward_grants g on g.order_id=c.order_id
  left join public.platform_referral_payout_proofs_v1_264 p on p.claim_id=c.claim_id
  left join lateral (
   select x.* from public.platform_referral_provider_observations_v1_265 x
    where x.claim_id=c.claim_id order by x.checked_at desc,x.observation_id desc limit 1
  ) o on true
  where c.paid_on>=v_month and c.paid_on<(v_month+interval '1 month')::date
 )
 select count(*)::bigint,
  count(*) filter(where checked_at is not null)::bigint,
  count(*) filter(where success_now)::bigint,
  count(*) filter(where checked_at is not null and not success_now)::bigint
 into v_total,v_checked,v_success,v_unmatched from claims;
 with selected as (
  select c.claim_id,c.reported_at,v.claim_id is not null voided,
   o.provider_status,o.status_detail,o.reference_matches,o.amount_matches,
   o.provider_transaction_success,o.checked_at,
   o.payout_id,o.transaction_id,
   coalesce(o.provider_transaction_success,false) and v.claim_id is null
     and g.reversed_at is null and g.matured_at is not null
     and g.referrer_user_id=c.beneficiary_user_id
     and g.referral_pending_cents=c.amount_cents as success_now,
   p.claim_id is not null proof_present
  from public.platform_referral_payout_claims_v1_263 c
  left join public.platform_referral_payout_voids_v1_263 v on v.claim_id=c.claim_id
  left join public.order_reward_grants g on g.order_id=c.order_id
  left join public.platform_referral_payout_proofs_v1_264 p on p.claim_id=c.claim_id
  left join lateral (
   select x.* from public.platform_referral_provider_observations_v1_265 x
    where x.claim_id=c.claim_id order by x.checked_at desc,x.observation_id desc limit 1
  ) o on true
  where c.paid_on>=v_month and c.paid_on<(v_month+interval '1 month')::date
  order by c.reported_at desc,c.claim_id limit 30
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'claimId',claim_id,'checkedAt',checked_at,
  'status',provider_status,'detail',status_detail,
  'referenceMatches',reference_matches,'amountMatches',amount_matches,
  'successNow',success_now,'proofPresent',proof_present,
  'voided',voided,'payoutId',payout_id,'transactionId',transaction_id
 )order by reported_at desc,claim_id),'[]'::jsonb) into v_rows from selected;
 return jsonb_build_object(
  'source','owner_payout_provider_reconciliation_v1_265',
  'month',v_month,'timezone','America/Sao_Paulo','totalClaims',v_total,
  'checkedClaims',v_checked,'providerSuccessClaims',v_success,
  'checkedUnmatchedClaims',v_unmatched,'unqueriedClaims',v_total-v_checked,
  'limit',30,'truncated',v_total>30,'rows',v_rows,
  'provider','mercado_pago_payouts_get','bankSettlementVerified',false,
  'recipientVerified',false,'providerTransactionIsBeneficiaryProof',false,
  'externalPaidBenefitsCents',null,'readOnly',true,'noTransfers',true
 );
end;$fn$;
revoke all on function platform_payout_provider_private_v1_265.target(uuid,uuid)
 from public,anon,authenticated,service_role;
revoke all on function platform_payout_provider_private_v1_265.record(uuid,uuid,text,text,text,bigint,text,text,timestamptz,text)
 from public,anon,authenticated,service_role;
revoke all on function platform_payout_provider_private_v1_265.read(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function platform_payout_provider_private_v1_265.target(uuid,uuid) to service_role;
grant execute on function platform_payout_provider_private_v1_265.record(uuid,uuid,text,text,text,bigint,text,text,timestamptz,text) to service_role;
grant execute on function platform_payout_provider_private_v1_265.read(uuid,date) to service_role;
create or replace function public.admin_owner_payout_provider_target_v1_265(p_actor uuid,p_claim uuid)
 returns jsonb language sql stable security invoker set search_path=pg_catalog as $w$
 select platform_payout_provider_private_v1_265.target($1,$2)$w$;
create or replace function public.admin_owner_payout_provider_record_v1_265(
 p_actor uuid,p_claim uuid,p_payout text,p_transaction text,
 p_reference text,p_amount bigint,p_status text,p_detail text,p_updated timestamptz,p_digest text
) returns jsonb language sql volatile security invoker set search_path=pg_catalog as $w$
 select platform_payout_provider_private_v1_265.record($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)$w$;
create or replace function public.admin_owner_payout_provider_read_v1_265(p_actor uuid,p_month date default null)
 returns jsonb language sql stable security invoker set search_path=pg_catalog as $w$
 select platform_payout_provider_private_v1_265.read($1,$2)$w$;
revoke all on function public.admin_owner_payout_provider_target_v1_265(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_owner_payout_provider_record_v1_265(uuid,uuid,text,text,text,bigint,text,text,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_owner_payout_provider_read_v1_265(uuid,date) from public,anon,authenticated,service_role;
grant execute on function public.admin_owner_payout_provider_target_v1_265(uuid,uuid) to service_role;
grant execute on function public.admin_owner_payout_provider_record_v1_265(uuid,uuid,text,text,text,bigint,text,text,timestamptz,text) to service_role;
grant execute on function public.admin_owner_payout_provider_read_v1_265(uuid,date) to service_role;
do $acl$begin
 if has_function_privilege('anon','public.admin_owner_payout_provider_target_v1_265(uuid,uuid)','EXECUTE')
 or has_function_privilege('authenticated','public.admin_owner_payout_provider_target_v1_265(uuid,uuid)','EXECUTE')
 or has_function_privilege('anon','public.admin_owner_payout_provider_record_v1_265(uuid,uuid,text,text,text,bigint,text,text,timestamptz,text)','EXECUTE')
 or has_function_privilege('authenticated','public.admin_owner_payout_provider_record_v1_265(uuid,uuid,text,text,text,bigint,text,text,timestamptz,text)','EXECUTE')
 or has_function_privilege('anon','public.admin_owner_payout_provider_read_v1_265(uuid,date)','EXECUTE')
 or has_function_privilege('authenticated','public.admin_owner_payout_provider_read_v1_265(uuid,date)','EXECUTE')
 then raise exception 'PAYOUT_PROVIDER_ACL_DRIFT' using errcode='42501';end if;
end$acl$;