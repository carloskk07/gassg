-- TAMÃO V1.263 — Owner-asserted external payout evidence for matured referrals.
-- The records are claims, not independent bank/PSP settlement verification.
-- No transfer, wallet edit, commission maturation, or payment operation.
create schema if not exists platform_referral_payout_private_v1_263;
revoke all on schema platform_referral_payout_private_v1_263 from public,anon,authenticated;
grant usage on schema platform_referral_payout_private_v1_263 to service_role;

create table public.platform_referral_payout_claims_v1_263(
 claim_id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.order_reward_grants(order_id) on delete cascade,
 beneficiary_user_id uuid not null,
 amount_cents bigint not null check(amount_cents>0 and amount_cents<=100000000),
 provider text not null check(provider in ('pix','bank_transfer','mercado_pago','other')),
 provider_reference text not null check(provider_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$'),
 paid_on date not null,
 proof_sha256 text check(proof_sha256 is null or proof_sha256 ~ '^[0-9a-f]{64}$'),
 reported_by uuid not null,
 reported_at timestamptz not null default clock_timestamp(),
 unique(provider,provider_reference)
);
create index platform_referral_payout_claims_date_v1_263
 on public.platform_referral_payout_claims_v1_263(paid_on desc,reported_at desc);
create index platform_referral_payout_claims_order_v1_263
 on public.platform_referral_payout_claims_v1_263(order_id);

create table public.platform_referral_payout_voids_v1_263(
 claim_id uuid primary key references public.platform_referral_payout_claims_v1_263(claim_id) on delete cascade,
 reason text not null check(char_length(reason) between 12 and 300),
 voided_by uuid not null,
 voided_at timestamptz not null default clock_timestamp()
);
alter table public.platform_referral_payout_claims_v1_263 enable row level security;
alter table public.platform_referral_payout_voids_v1_263 enable row level security;
revoke all on public.platform_referral_payout_claims_v1_263 from public,anon,authenticated,service_role;
revoke all on public.platform_referral_payout_voids_v1_263 from public,anon,authenticated,service_role;

create or replace function platform_referral_payout_private_v1_263.assert_owner(p_actor uuid)
returns void language plpgsql stable security definer set search_path=pg_catalog as $fn$
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a where a.user_id=p_actor
   and a.active and a.admin_role='superadmin'
 ) then raise exception 'PAYOUT_OWNER_ONLY' using errcode='42501';end if;
end;$fn$;
revoke all on function platform_referral_payout_private_v1_263.assert_owner(uuid)
 from public,anon,authenticated,service_role;
grant execute on function platform_referral_payout_private_v1_263.assert_owner(uuid) to service_role;

create or replace function platform_referral_payout_private_v1_263.record_claim(
 p_actor uuid,p_order_id uuid,p_amount_cents bigint,p_provider text,
 p_reference text,p_paid_on date,p_proof_sha256 text default null
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $fn$
declare
 v_grant public.order_reward_grants%rowtype;
 v_prior public.platform_referral_payout_claims_v1_263%rowtype;
 v_claim_id uuid;
 v_digest text:=nullif(lower(trim(coalesce(p_proof_sha256,''))),'');
begin
 perform platform_referral_payout_private_v1_263.assert_owner(p_actor);
 if p_order_id is null or p_amount_cents is null or p_amount_cents<=0
    or p_amount_cents>100000000
    or p_provider not in ('pix','bank_transfer','mercado_pago','other')
    or p_reference is null or p_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$'
    or p_paid_on is null or p_paid_on> (clock_timestamp() at time zone 'America/Sao_Paulo')::date
    or p_paid_on<date '2026-01-01'
    or (v_digest is not null and v_digest !~ '^[0-9a-f]{64}$')
 then raise exception 'PAYOUT_CLAIM_INVALID' using errcode='22023';end if;

 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('benefit-payout-claim:'||p_order_id::text,0));

 select * into v_grant from public.order_reward_grants
  where order_id=p_order_id for share;
 if not found or v_grant.referrer_user_id is null
   or v_grant.referral_pending_cents<=0 or v_grant.matured_at is null
   or v_grant.reversed_at is not null
   or p_amount_cents<>v_grant.referral_pending_cents
   or p_paid_on<(v_grant.matured_at at time zone 'America/Sao_Paulo')::date
 then raise exception 'PAYOUT_GRANT_NOT_ELIGIBLE' using errcode='22023';end if;

 -- Never register more than one currently active claim against a grant.
 select c.* into v_prior from public.platform_referral_payout_claims_v1_263 c
 left join public.platform_referral_payout_voids_v1_263 v on v.claim_id=c.claim_id
 where c.order_id=p_order_id and v.claim_id is null
 order by c.reported_at desc limit 1;
 if found then
  if v_prior.amount_cents=p_amount_cents and v_prior.provider=p_provider
     and v_prior.provider_reference=p_reference and v_prior.paid_on=p_paid_on
     and v_prior.proof_sha256 is not distinct from v_digest then
   return jsonb_build_object('source','admin_owner_referral_payout_claim_v1_263',
    'claimId',v_prior.claim_id,'alreadyRecorded',true,
    'bankVerified',false,'transferExecuted',false);
  end if;
  raise exception 'PAYOUT_ACTIVE_CLAIM_EXISTS' using errcode='23505';
 end if;
 if exists(select 1 from public.platform_referral_payout_claims_v1_263 c
   where c.provider=p_provider and c.provider_reference=p_reference)
 then raise exception 'PAYOUT_REFERENCE_ALREADY_USED' using errcode='23505';end if;

 insert into public.platform_referral_payout_claims_v1_263(
  order_id,beneficiary_user_id,amount_cents,provider,provider_reference,
  paid_on,proof_sha256,reported_by)
 values(p_order_id,v_grant.referrer_user_id,p_amount_cents,p_provider,p_reference,
  p_paid_on,v_digest,p_actor) returning claim_id into v_claim_id;
 return jsonb_build_object('source','admin_owner_referral_payout_claim_v1_263',
   'claimId',v_claim_id,'alreadyRecorded',false,'bankVerified',false,
   'transferExecuted',false);
end;$fn$;
revoke all on function platform_referral_payout_private_v1_263.record_claim(
 uuid,uuid,bigint,text,text,date,text) from public,anon,authenticated,service_role;
grant execute on function platform_referral_payout_private_v1_263.record_claim(
 uuid,uuid,bigint,text,text,date,text) to service_role;

create or replace function platform_referral_payout_private_v1_263.void_claim(
 p_actor uuid,p_claim_id uuid,p_reason text
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $fn$
declare
 v_claim public.platform_referral_payout_claims_v1_263%rowtype;
 v_reason text:=trim(coalesce(p_reason,''));
begin
 perform platform_referral_payout_private_v1_263.assert_owner(p_actor);
 if p_claim_id is null or char_length(v_reason)<12 or char_length(v_reason)>300
 then raise exception 'PAYOUT_VOID_INVALID' using errcode='22023';end if;
 select * into v_claim from public.platform_referral_payout_claims_v1_263
  where claim_id=p_claim_id for update;
 if not found then raise exception 'PAYOUT_CLAIM_NOT_FOUND' using errcode='P0002';end if;
 if exists(select 1 from public.platform_referral_payout_voids_v1_263
   where claim_id=p_claim_id)
 then return jsonb_build_object('source','admin_owner_referral_payout_void_v1_263',
   'claimId',p_claim_id,'alreadyVoided',true,'transferExecuted',false);end if;
 insert into public.platform_referral_payout_voids_v1_263(claim_id,reason,voided_by)
 values(p_claim_id,v_reason,p_actor);
 return jsonb_build_object('source','admin_owner_referral_payout_void_v1_263',
   'claimId',p_claim_id,'alreadyVoided',false,'transferExecuted',false);
end;$fn$;
revoke all on function platform_referral_payout_private_v1_263.void_claim(uuid,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function platform_referral_payout_private_v1_263.void_claim(uuid,uuid,text)
 to service_role;

create or replace function platform_referral_payout_private_v1_263.read_claims(
 p_actor uuid,p_month date default null
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare
 v_month date:=coalesce(p_month,date_trunc('month',
  clock_timestamp() at time zone 'America/Sao_Paulo')::date);
 v_metrics jsonb;
 v_total bigint;v_rows jsonb;
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a where a.user_id=p_actor
  and a.active and a.admin_role in ('superadmin','finance')
 ) then raise exception 'PAYOUT_READ_DENIED' using errcode='42501';end if;
 if extract(day from v_month)<>1 or v_month<date '2026-01-01'
  or v_month>(date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')
    +interval '2 months')::date
 then raise exception 'PAYOUT_MONTH_INVALID' using errcode='22023';end if;

 with claims as (
  select c.*,v.claim_id is not null voided,
   (g.order_id is not null and g.referrer_user_id=c.beneficiary_user_id
    and g.matured_at is not null and g.reversed_at is null
    and g.referral_pending_cents=c.amount_cents) eligible_now
  from public.platform_referral_payout_claims_v1_263 c
  left join public.platform_referral_payout_voids_v1_263 v on v.claim_id=c.claim_id
  left join public.order_reward_grants g on g.order_id=c.order_id
  where c.paid_on>=v_month and c.paid_on<(v_month+interval '1 month')::date
 )
 select jsonb_build_object(
  'totalClaims',count(*)::bigint,
  'activeClaims',count(*) filter(where not voided)::bigint,
  'voidedClaims',count(*) filter(where voided)::bigint,
  'reportedActiveCents',coalesce(sum(amount_cents) filter(where not voided),0)::bigint,
  'reportedEligibleNowCents',coalesce(sum(amount_cents) filter(
    where not voided and eligible_now),0)::bigint,
  'reportedNowIneligibleCents',coalesce(sum(amount_cents) filter(
    where not voided and not eligible_now),0)::bigint,
  'reportedVoidedCents',coalesce(sum(amount_cents) filter(where voided),0)::bigint,
  'activeWithoutProofFingerprint',count(*) filter(
    where not voided and proof_sha256 is null)::bigint
 ) into v_metrics from claims;

 select count(*)::bigint into v_total from public.platform_referral_payout_claims_v1_263 c
 where c.paid_on>=v_month and c.paid_on<(v_month+interval '1 month')::date;

 with selected as (
  select c.claim_id,c.order_id,c.amount_cents,c.provider,c.provider_reference,
   c.paid_on,c.proof_sha256,c.reported_at,c.beneficiary_user_id,
   v.claim_id is not null voided,
   (g.order_id is not null and g.referrer_user_id=c.beneficiary_user_id
    and g.matured_at is not null and g.reversed_at is null
    and g.referral_pending_cents=c.amount_cents) eligible_now
  from public.platform_referral_payout_claims_v1_263 c
  left join public.platform_referral_payout_voids_v1_263 v on v.claim_id=c.claim_id
  left join public.order_reward_grants g on g.order_id=c.order_id
  where c.paid_on>=v_month and c.paid_on<(v_month+interval '1 month')::date
  order by c.reported_at desc,c.claim_id limit 30
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'claimId',claim_id,'orderId',order_id,'amountCents',amount_cents,
  'provider',provider,'referenceMasked',
    left(provider_reference,4)||'…'||right(provider_reference,4),
  'paidOn',paid_on,'proofFingerprintPresent',proof_sha256 is not null,
  'voided',voided,'eligibleNow',eligible_now
 )order by reported_at desc,claim_id),'[]'::jsonb) into v_rows from selected;

 return jsonb_build_object(
  'source','admin_owner_referral_payout_claims_v1_263',
  'month',v_month,'timezone','America/Sao_Paulo',
  'reportedByOwnerOnly',true,'providerSettlementConfirmed',false,
  'reportMetricMeaning','owner_reported_external_claims_not_bank_verified',
  'metrics',v_metrics,'totalRecords',v_total,'limit',30,'truncated',v_total>30,
  'rows',v_rows,'externalPaidBenefitsCents',null,
  'externalPayoutMeasured',false,'bankSettlementVerified',false,
  'profitMeasured',false,'roiMeasured',false,
  'noTransfers',true,'newBenefitsEnabled',false,'readOnly',true
 );
end;$fn$;
revoke all on function platform_referral_payout_private_v1_263.read_claims(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function platform_referral_payout_private_v1_263.read_claims(uuid,date)
 to service_role;

create or replace function public.admin_owner_referral_payout_claims_v1_263(
 p_actor uuid,p_month date default null
) returns jsonb language sql stable security invoker set search_path=pg_catalog as $wrapper$
 select platform_referral_payout_private_v1_263.read_claims($1,$2)
$wrapper$;
create or replace function public.admin_owner_referral_payout_record_v1_263(
 p_actor uuid,p_order_id uuid,p_amount_cents bigint,p_provider text,
 p_reference text,p_paid_on date,p_proof_sha256 text default null
) returns jsonb language sql volatile security invoker set search_path=pg_catalog as $wrapper$
 select platform_referral_payout_private_v1_263.record_claim(
 $1,$2,$3,$4,$5,$6,$7)
$wrapper$;
create or replace function public.admin_owner_referral_payout_void_v1_263(
 p_actor uuid,p_claim_id uuid,p_reason text
) returns jsonb language sql volatile security invoker set search_path=pg_catalog as $wrapper$
 select platform_referral_payout_private_v1_263.void_claim($1,$2,$3)
$wrapper$;
revoke all on function public.admin_owner_referral_payout_claims_v1_263(uuid,date)
 from public,anon,authenticated,service_role;
revoke all on function public.admin_owner_referral_payout_record_v1_263(
 uuid,uuid,bigint,text,text,date,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_owner_referral_payout_void_v1_263(uuid,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_owner_referral_payout_claims_v1_263(uuid,date)
 to service_role;
grant execute on function public.admin_owner_referral_payout_record_v1_263(
 uuid,uuid,bigint,text,text,date,text) to service_role;
grant execute on function public.admin_owner_referral_payout_void_v1_263(uuid,uuid,text)
 to service_role;
do $acl$ begin
 if has_function_privilege('anon','public.admin_owner_referral_payout_claims_v1_263(uuid,date)','EXECUTE')
 or has_function_privilege('authenticated','public.admin_owner_referral_payout_claims_v1_263(uuid,date)','EXECUTE')
 or has_function_privilege('anon','public.admin_owner_referral_payout_record_v1_263(uuid,uuid,bigint,text,text,date,text)','EXECUTE')
 or has_function_privilege('authenticated','public.admin_owner_referral_payout_record_v1_263(uuid,uuid,bigint,text,text,date,text)','EXECUTE')
 or has_function_privilege('anon','public.admin_owner_referral_payout_void_v1_263(uuid,uuid,text)','EXECUTE')
 or has_function_privilege('authenticated','public.admin_owner_referral_payout_void_v1_263(uuid,uuid,text)','EXECUTE')
 or not has_function_privilege('service_role','public.admin_owner_referral_payout_claims_v1_263(uuid,date)','EXECUTE')
 or not has_function_privilege('service_role','public.admin_owner_referral_payout_record_v1_263(uuid,uuid,bigint,text,text,date,text)','EXECUTE')
 or not has_function_privilege('service_role','public.admin_owner_referral_payout_void_v1_263(uuid,uuid,text)','EXECUTE')
 then raise exception 'PAYOUT_V1_263_ACL_DRIFT' using errcode='42501';end if;
end $acl$;
