-- TAMÃO #493 V1.1033 — Explicit, auditable, per-recipient Pix payout execution.
-- Authorization is NOT a transfer. Provider submission is separately gated.
-- User/beneficiary data is encrypted before it reaches PostgreSQL.
create table public.network_payout_execution_policy_v1_1033(
 singleton boolean primary key default true check(singleton),
 execution_enabled boolean not null default false,
 approved_by uuid references auth.users(id),
 approved_at timestamptz,
 approval_reference text,
 check(not execution_enabled or
  (approved_by is not null and approved_at is not null and
   length(approval_reference) between 20 and 200))
);
insert into public.network_payout_execution_policy_v1_1033(singleton) values(true);

create table public.network_payout_beneficiaries_v1_1033(
 user_id uuid primary key references auth.users(id) on delete restrict,
 pix_type text not null check(pix_type='CPF'),
 encrypted_pix_key text not null check(length(encrypted_pix_key) between 24 and 500),
 pix_iv text not null check(length(pix_iv) between 16 and 80),
 pix_key_hash text not null check(pix_key_hash~'^[a-f0-9]{64}$'),
 identity_proof_hash text not null check(identity_proof_hash~'^[a-f0-9]{64}$'),
 identity_proof_reference text not null check(length(identity_proof_reference) between 20 and 200),
 identity_checked_by uuid not null references auth.users(id),
 verified_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create table public.network_payout_jobs_v1_1033(
 id uuid primary key default gen_random_uuid(),
 reservation_id uuid not null unique references public.network_fee_payout_reservations_v1_1031(id) on delete restrict,
 user_id uuid not null references auth.users(id) on delete restrict,
 amount_cents bigint not null check(amount_cents between 100 and 10000000),
 pix_key_hash text not null check(pix_key_hash~'^[a-f0-9]{64}$'),
 identity_proof_hash text not null check(identity_proof_hash~'^[a-f0-9]{64}$'),
 provider text not null default 'mercadopago_payouts' check(provider='mercadopago_payouts'),
 state text not null default 'prepared' check(state in (
  'prepared','authorized','dispatching','uncertain','submitted',
  'credited_unverified','paid','rejected','refunded','review','cancelled')),
 external_reference text not null unique check(external_reference~'^TAMAONET[A-F0-9]{32}$'),
 transfer_idempotency_key uuid not null unique default gen_random_uuid(),
 authorized_by uuid references auth.users(id),
 authorized_at timestamptz,
 dispatched_at timestamptz,
 provider_payout_id text unique,
 provider_transaction_id text unique,
 provider_status text,
 provider_status_detail text,
 provider_observed_at timestamptz,
 receipt_reference text,
 receipt_hash text check(receipt_hash is null or receipt_hash~'^[a-f0-9]{64}$'),
 receipt_checked_by uuid references auth.users(id),
 receipt_checked_at timestamptz,
 review_reason text,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check((authorized_by is null and authorized_at is null) or
       (authorized_by is not null and authorized_at is not null)),
 check((state<>'paid') or
      (receipt_reference is not null and receipt_hash is not null
       and receipt_checked_by is not null and receipt_checked_at is not null
       and provider_payout_id is not null and provider_transaction_id is not null
       and provider_status='success' and provider_status_detail='accredited'))
);
create index network_payout_jobs_user_v1_1033_idx
 on public.network_payout_jobs_v1_1033(user_id,created_at desc);
create index network_payout_jobs_state_v1_1033_idx
 on public.network_payout_jobs_v1_1033(state,updated_at desc);
alter table public.network_payout_execution_policy_v1_1033 enable row level security;
alter table public.network_payout_beneficiaries_v1_1033 enable row level security;
alter table public.network_payout_jobs_v1_1033 enable row level security;
revoke all on public.network_payout_execution_policy_v1_1033,
 public.network_payout_beneficiaries_v1_1033,
 public.network_payout_jobs_v1_1033 from public,anon,authenticated,service_role;
grant select on public.network_payout_execution_policy_v1_1033,
 public.network_payout_jobs_v1_1033 to service_role;
-- Beneficiary ciphertext is not readable by web-facing service queries: only
-- a superadmin-verified RPC may return it to the Edge payout executor.

create function public.network_payout_assert_owner_v1_1033(p_actor uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $fn$
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a where a.user_id=p_actor
  and a.active and a.admin_role='superadmin')
 then raise exception 'NETWORK_PAYOUT_SUPERADMIN_REQUIRED' using errcode='42501';end if;
end $fn$;

create function public.network_payout_beneficiary_register_v1_1033(
 p_actor uuid,p_user uuid,p_encrypted text,p_iv text,p_key_hash text,
 p_proof_hash text,p_proof_reference text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 if p_user is null or p_user=p_actor
 or length(coalesce(p_encrypted,'')) not between 24 and 500
 or length(coalesce(p_iv,'')) not between 16 and 80
 or coalesce(p_key_hash,'') !~ '^[a-f0-9]{64}$'
 or coalesce(p_proof_hash,'') !~ '^[a-f0-9]{64}$'
 or length(coalesce(p_proof_reference,'')) not between 20 and 200
 or exists(select 1 from public.platform_admins a where a.user_id=p_user and a.active)
 or not exists(select 1 from auth.users u where u.id=p_user and u.deleted_at is null
  and not u.is_anonymous and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null))
 then raise exception 'NETWORK_PAYOUT_BENEFICIARY_UNVERIFIED' using errcode='42501';end if;
 -- Cannot switch a destination while any outgoing job may still settle.
 if exists(select 1 from public.network_payout_jobs_v1_1033 j
  where j.user_id=p_user and j.state not in('cancelled','rejected','refunded'))
 then raise exception 'NETWORK_PAYOUT_BENEFICIARY_LOCKED' using errcode='40001';end if;
 insert into public.network_payout_beneficiaries_v1_1033
  (user_id,pix_type,encrypted_pix_key,pix_iv,pix_key_hash,
   identity_proof_hash,identity_proof_reference,identity_checked_by)
 values(p_user,'CPF',p_encrypted,p_iv,p_key_hash,p_proof_hash,p_proof_reference,p_actor)
 on conflict(user_id) do update set
   encrypted_pix_key=excluded.encrypted_pix_key,pix_iv=excluded.pix_iv,
   pix_key_hash=excluded.pix_key_hash,identity_proof_hash=excluded.identity_proof_hash,
   identity_proof_reference=excluded.identity_proof_reference,
   identity_checked_by=excluded.identity_checked_by,verified_at=clock_timestamp(),
   updated_at=clock_timestamp();
 return jsonb_build_object('source','network_payout_beneficiary_v1_1033',
  'verified',true,'userId',p_user,'pixKeyHash',p_key_hash,
  'rawPixReturned',false,'moneyMoved',false);
end $fn$;

create function public.network_payout_set_execution_v1_1033(
 p_actor uuid,p_enabled boolean,p_reference text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 if p_enabled and (length(coalesce(p_reference,'')) not between 20 and 200
   or not exists(select 1 from public.network_fee_package_policy_v1_1030 p
       where p.singleton and p.accrual_enabled and p.terms_approved_at is not null
        and p.terms_reference is not null))
 then raise exception 'NETWORK_PAYOUT_ACTIVATION_EVIDENCE_REQUIRED'
 using errcode='42501';end if;
 update public.network_payout_execution_policy_v1_1033
 set execution_enabled=p_enabled,
   approved_by=case when p_enabled then p_actor else null end,
   approved_at=case when p_enabled then clock_timestamp() else null end,
   approval_reference=case when p_enabled then p_reference else null end where singleton;
 return jsonb_build_object('source','network_payout_execution_policy_v1_1033',
  'executionEnabled',p_enabled,'moneyMoved',false,'manualPerTransferApprovalRequired',true);
end $fn$;

create function public.network_payout_prepare_v1_1033(p_actor uuid,p_reservation uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare v_r public.network_fee_payout_reservations_v1_1031%rowtype;
 v_b public.network_payout_beneficiaries_v1_1033%rowtype;
 v_j public.network_payout_jobs_v1_1033%rowtype;
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 select * into v_r from public.network_fee_payout_reservations_v1_1031
  where id=p_reservation for update;
 if not found or v_r.state<>'reserved' then
  raise exception 'NETWORK_PAYOUT_RESERVATION_NOT_READY' using errcode='40001';end if;
 select * into v_j from public.network_payout_jobs_v1_1033 where reservation_id=p_reservation;
 if found then return jsonb_build_object('source','network_payout_job_v1_1033',
   'jobId',v_j.id,'state',v_j.state,'amountCents',v_j.amount_cents,
   'userId',v_j.user_id,'moneyMoved',false,'alreadyRecorded',true);end if;
 if not exists(select 1 from public.network_fee_package_policy_v1_1030
  where singleton and accrual_enabled and terms_approved_at is not null)
 or exists(select 1 from public.network_fee_payout_allocations_v1_1031 a
   join public.network_fee_package_sources_v1_1030 s using(kind,source_id)
   where a.reservation_id=p_reservation and s.state<>'eligible')
 then raise exception 'NETWORK_PAYOUT_AWARD_NOT_ELIGIBLE' using errcode='40001';end if;
 select * into v_b from public.network_payout_beneficiaries_v1_1033
   where user_id=v_r.user_id for share;
 if not found then raise exception 'NETWORK_PAYOUT_RECIPIENT_VERIFICATION_MISSING'
  using errcode='42501';end if;
 insert into public.network_payout_jobs_v1_1033
  (reservation_id,user_id,amount_cents,pix_key_hash,identity_proof_hash,external_reference)
 values(v_r.id,v_r.user_id,v_r.amount_cents,v_b.pix_key_hash,v_b.identity_proof_hash,
   'TAMAONET'||upper(replace(v_r.id::text,'-','')))
 returning * into v_j;
 return jsonb_build_object('source','network_payout_job_v1_1033',
   'jobId',v_j.id,'state','prepared','amountCents',v_j.amount_cents,
   'userId',v_j.user_id,'moneyMoved',false,'alreadyRecorded',false);
end $fn$;

create function public.network_payout_authorize_v1_1033(
 p_actor uuid,p_job uuid,p_expected_amount bigint,p_expected_hash text,p_confirm text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare v_j public.network_payout_jobs_v1_1033%rowtype;v_b record;
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 if p_confirm is distinct from 'AUTORIZO PIX'
 then raise exception 'NETWORK_PAYOUT_EXPLICIT_CONFIRMATION_REQUIRED' using errcode='42501';end if;
 select * into v_j from public.network_payout_jobs_v1_1033 where id=p_job for update;
 if not found or v_j.state<>'prepared' or v_j.amount_cents is distinct from p_expected_amount
   or v_j.pix_key_hash is distinct from p_expected_hash
 then raise exception 'NETWORK_PAYOUT_AUTHORIZE_STALE' using errcode='40001';end if;
 if not exists(select 1 from public.network_fee_payout_reservations_v1_1031 r
   where r.id=v_j.reservation_id and r.state='reserved')
 or exists(select 1 from public.network_fee_payout_allocations_v1_1031 a
   join public.network_fee_package_sources_v1_1030 s using(kind,source_id)
   where a.reservation_id=v_j.reservation_id and s.state<>'eligible')
 then raise exception 'NETWORK_PAYOUT_SOURCE_CHANGED' using errcode='40001';end if;
 select pix_key_hash,identity_proof_hash,verified_at into v_b
 from public.network_payout_beneficiaries_v1_1033 where user_id=v_j.user_id;
 if v_b.pix_key_hash is distinct from v_j.pix_key_hash
  or v_b.identity_proof_hash is distinct from v_j.identity_proof_hash
 then raise exception 'NETWORK_PAYOUT_RECIPIENT_CHANGED' using errcode='40001';end if;
 if not exists(select 1 from public.network_payout_execution_policy_v1_1033
   where singleton and execution_enabled)
 then raise exception 'NETWORK_PAYOUT_EXECUTION_DISABLED' using errcode='42501';end if;
 update public.network_payout_jobs_v1_1033
  set state='authorized',authorized_by=p_actor,authorized_at=clock_timestamp(),
      updated_at=clock_timestamp() where id=p_job;
 return jsonb_build_object('source','network_payout_authorization_v1_1033',
  'jobId',p_job,'authorized',true,'moneyMoved',false);
end $fn$;

-- A single persistent transition is required BEFORE an external POST. Once
-- this transition occurs, NEVER retry POST automatically on network ambiguity.
create function public.network_payout_dispatch_begin_v1_1033(p_actor uuid,p_job uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare v_j public.network_payout_jobs_v1_1033%rowtype;
 v_b public.network_payout_beneficiaries_v1_1033%rowtype;
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 select * into v_j from public.network_payout_jobs_v1_1033 where id=p_job for update;
 if not found or v_j.state<>'authorized'
 then raise exception 'NETWORK_PAYOUT_ALREADY_DISPATCHED_OR_INVALID' using errcode='40001';end if;
 if not exists(select 1 from public.network_payout_execution_policy_v1_1033
    where singleton and execution_enabled)
 or not exists(select 1 from public.network_fee_payout_reservations_v1_1031
    where id=v_j.reservation_id and state='reserved')
 or exists(select 1 from public.network_fee_payout_allocations_v1_1031 a
   join public.network_fee_package_sources_v1_1030 s using(kind,source_id)
   where a.reservation_id=v_j.reservation_id and s.state<>'eligible')
 then raise exception 'NETWORK_PAYOUT_DISPATCH_GATE_DENIED' using errcode='42501';end if;
 select * into v_b from public.network_payout_beneficiaries_v1_1033
 where user_id=v_j.user_id for share;
 if not found or v_b.pix_key_hash<>v_j.pix_key_hash
   or v_b.identity_proof_hash<>v_j.identity_proof_hash
 then raise exception 'NETWORK_PAYOUT_DESTINATION_CHANGED' using errcode='42501';end if;
 update public.network_payout_jobs_v1_1033
  set state='dispatching',dispatched_at=clock_timestamp(),updated_at=clock_timestamp()
 where id=p_job;
 return jsonb_build_object('source','network_payout_dispatch_v1_1033',
  'jobId',v_j.id,'amountCents',v_j.amount_cents,'userId',v_j.user_id,
  'externalReference',v_j.external_reference,
  'transferIdempotencyKey',v_j.transfer_idempotency_key,
  'pixKeyHash',v_j.pix_key_hash,
  'encryptedPixKey',v_b.encrypted_pix_key,'pixIv',v_b.pix_iv,'pixType',v_b.pix_type,
  'moneyMoved',false,'alreadyDispatched',false);
end $fn$;

create function public.network_payout_dispatch_result_v1_1033(
 p_actor uuid,p_job uuid,p_payout text,p_transaction text,p_unknown boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare v_j public.network_payout_jobs_v1_1033%rowtype;
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 select * into v_j from public.network_payout_jobs_v1_1033 where id=p_job for update;
 if not found or v_j.state not in('dispatching','uncertain')
 then raise exception 'NETWORK_PAYOUT_RESULT_INVALID_STATE' using errcode='40001';end if;
 if not p_unknown and (
   length(coalesce(p_payout,'')) not between 10 and 80
   or length(coalesce(p_transaction,'')) not between 10 and 80)
 then raise exception 'NETWORK_PAYOUT_RESULT_PROVIDER_IDS_REQUIRED' using errcode='22023';end if;
 if v_j.provider_payout_id is not null
   and v_j.provider_payout_id is distinct from p_payout
 then raise exception 'NETWORK_PAYOUT_RESULT_CONFLICT' using errcode='23505';end if;
 update public.network_payout_jobs_v1_1033
 set state=case when p_unknown then 'uncertain' else 'submitted' end,
 provider_payout_id=case when p_unknown then provider_payout_id else p_payout end,
 provider_transaction_id=case when p_unknown then provider_transaction_id else p_transaction end,
 updated_at=clock_timestamp() where id=p_job;
 return jsonb_build_object('source','network_payout_dispatch_result_v1_1033',
  'jobId',p_job,'state',case when p_unknown then 'uncertain' else 'submitted' end,
  'providerAcknowledged',not p_unknown,'moneyConfirmed',false);
end $fn$;

create function public.network_payout_observe_v1_1033(
 p_actor uuid,p_job uuid,p_payout text,p_transaction text,
 p_status text,p_detail text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare v_j public.network_payout_jobs_v1_1033%rowtype;v_next text;
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 select * into v_j from public.network_payout_jobs_v1_1033 where id=p_job for update;
 if not found or v_j.state not in('submitted','credited_unverified','paid','rejected','refunded','review')
   or v_j.provider_payout_id is distinct from p_payout
   or v_j.provider_transaction_id is distinct from p_transaction
 then raise exception 'NETWORK_PAYOUT_OBSERVATION_NOT_BOUND' using errcode='40001';end if;
 if p_status='success' and p_detail='accredited' then
  v_next:=case when v_j.state='paid' then 'paid' else 'credited_unverified' end;
 elsif p_status='refunded' then v_next:='refunded';
 elsif p_status in('rejected','error','canceled') then v_next:='rejected';
 elsif p_status in('created','approved','processed','transaction_in_process','success')
 then v_next:=case when v_j.state in('paid','credited_unverified') then v_j.state else 'submitted' end;
 else v_next:='review';end if;
 -- Once paid, a reversal is NEVER silently recategorised as unspent funds.
 if v_j.state='paid' and v_next<>'paid' then v_next:='review';end if;
 update public.network_payout_jobs_v1_1033
 set state=v_next,provider_status=p_status,provider_status_detail=p_detail,
  provider_observed_at=clock_timestamp(),updated_at=clock_timestamp(),
  review_reason=case when v_next='review' then 'PROVIDER_STATE_CHANGED' else review_reason end
 where id=p_job;
 return jsonb_build_object('source','network_payout_observation_v1_1033',
   'jobId',p_job,'state',v_next,'bankReceiptVerified',false,
   'externalProviderStatus',p_status,'externalProviderDetail',p_detail);
end $fn$;

-- Recover unknown provider results by GET only, never a second POST.
create function public.network_payout_bind_ambiguous_v1_1033(
 p_actor uuid,p_job uuid,p_payout text,p_transaction text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare v_j public.network_payout_jobs_v1_1033%rowtype;
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 if coalesce(p_payout,'') !~ '^POP[A-Za-z0-9_-]{8,75}
-- A second independent receipt + matching beneficiary review is required.
create function public.network_payout_bank_confirm_v1_1033(
 p_actor uuid,p_job uuid,p_reference text,p_sha256 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare v_j public.network_payout_jobs_v1_1033%rowtype;
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 if length(coalesce(p_reference,'')) not between 20 and 200
 or coalesce(p_sha256,'') !~ '^[a-f0-9]{64}$'
 then raise exception 'NETWORK_PAYOUT_BANK_EVIDENCE_REQUIRED' using errcode='22023';end if;
 select * into v_j from public.network_payout_jobs_v1_1033
 where id=p_job for update;
 if not found or v_j.state<>'credited_unverified'
  or v_j.provider_status<>'success' or v_j.provider_status_detail<>'accredited'
  or v_j.provider_payout_id is null or v_j.provider_transaction_id is null
  or exists(select 1 from public.network_fee_payout_reservations_v1_1031 r
    where r.id=v_j.reservation_id and r.state='reversal_review')
 then raise exception 'NETWORK_PAYOUT_INDEPENDENT_SETTLEMENT_NOT_READY'
  using errcode='40001';end if;
 update public.network_payout_jobs_v1_1033 set
  state='paid',receipt_reference=p_reference,receipt_hash=p_sha256,
  receipt_checked_by=p_actor,receipt_checked_at=clock_timestamp(),
  updated_at=clock_timestamp() where id=p_job;
 return jsonb_build_object('source','network_payout_bank_confirmation_v1_1033',
  'jobId',p_job,'state','paid','evidenceRecorded',true);
end $fn$;

-- The V1.1031 cancellation was safe when no executor existed. With an
-- executor it must NEVER release funds after a dispatch has been attempted.
create or replace function public.network_fee_payout_cancel_v1_1031(
 p_actor uuid,p_reservation uuid
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare v public.network_fee_payout_reservations_v1_1031%rowtype;
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 select * into v from public.network_fee_payout_reservations_v1_1031
 where id=p_reservation for update;
 if not found then raise exception 'NETWORK_PAYOUT_RESERVATION_UNKNOWN' using errcode='22023';end if;
 if exists(select 1 from public.network_payout_jobs_v1_1033 j
    where j.reservation_id=p_reservation and j.state<>'cancelled')
 then raise exception 'NETWORK_PAYOUT_DISPATCH_OR_JOB_LOCKED'
  using errcode='40001';end if;
 if v.state in('reserved','reversal_review') then
  update public.network_fee_payout_reservations_v1_1031
   set state='cancelled',cancelled_by=p_actor,cancelled_at=clock_timestamp()
   where id=p_reservation;
 end if;
 return jsonb_build_object('source','network_payout_cancel_v1_1031',
  'state','cancelled','reservationId',p_reservation,
  'moneyMoved',false,'fundsReleased',true);
end $fn$;

create function public.network_payout_cancel_prepared_v1_1033(
 p_actor uuid,p_job uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare v_j public.network_payout_jobs_v1_1033%rowtype;
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 select * into v_j from public.network_payout_jobs_v1_1033 where id=p_job for update;
 if not found or v_j.state<>'prepared' then
  raise exception 'NETWORK_PAYOUT_CANCEL_NOT_SAFE' using errcode='40001';end if;
 update public.network_payout_jobs_v1_1033 set state='cancelled',updated_at=clock_timestamp()
 where id=p_job;
 perform public.network_fee_payout_cancel_v1_1031(p_actor,v_j.reservation_id);
 return jsonb_build_object('source','network_payout_safe_cancel_v1_1033',
  'state','cancelled','jobId',p_job,'fundsReleased',true,'providerCalled',false);
end $fn$;

create function public.network_payout_overview_v1_1033(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare v_enabled boolean;v_jobs bigint;v_review bigint;v_paid bigint;v_held bigint;v_recent jsonb;
begin
 if not exists(select 1 from public.platform_admins a where a.user_id=p_actor
   and a.active and a.admin_role in('superadmin','finance'))
 then raise exception 'NETWORK_PAYOUT_READ_DENIED' using errcode='42501';end if;
 select execution_enabled into v_enabled
 from public.network_payout_execution_policy_v1_1033 where singleton;
 select count(*),count(*) filter(where state in('uncertain','review')),
   coalesce(sum(amount_cents) filter(where state='paid'),0),
   coalesce(sum(amount_cents) filter(where state in(
     'prepared','authorized','dispatching','uncertain','submitted','credited_unverified','review')),0)
 into v_jobs,v_review,v_paid,v_held from public.network_payout_jobs_v1_1033;
 select coalesce(jsonb_agg(jsonb_build_object(
   'jobId',x.id,'userId',x.user_id,'amountCents',x.amount_cents,
   'state',x.state,'createdAt',x.created_at)),'[]'::jsonb)
 into v_recent from (
   select id,user_id,amount_cents,state,created_at
   from public.network_payout_jobs_v1_1033 order by created_at desc limit 12
 ) x;
 return jsonb_build_object('source','network_payout_executor_v1_1033',
  'readOnly',true,'executionEnabled',coalesce(v_enabled,false),
  'jobs',v_jobs,'recentJobs',v_recent,'needsReview',v_review,'paidWithIndependentProofCents',v_paid,
  'inFlightOrReservedCents',v_held,
  'providerCredentialsVerified',false,
  'recipientProofRequired',true,
  'autoTransferEnabled',false);
end $fn$;

create function public.network_payout_job_read_v1_1033(p_actor uuid,p_job uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare v_j public.network_payout_jobs_v1_1033%rowtype;
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 select * into v_j from public.network_payout_jobs_v1_1033 where id=p_job;
 if not found then raise exception 'NETWORK_PAYOUT_JOB_UNKNOWN' using errcode='22023';end if;
 return jsonb_build_object('source','network_payout_job_v1_1033',
  'jobId',v_j.id,'reservationId',v_j.reservation_id,
  'userId',v_j.user_id,'amountCents',v_j.amount_cents,
  'pixKeyHash',v_j.pix_key_hash,
  'state',v_j.state,'providerPayoutId',v_j.provider_payout_id,
  'providerTransactionId',v_j.provider_transaction_id,
  'providerStatus',v_j.provider_status,'providerDetail',v_j.provider_status_detail,
  'externalReference',v_j.external_reference,
  'receiptRecorded',v_j.receipt_hash is not null);
end $fn$;

create function public.network_payout_review_reversal_v1_1033()
returns trigger language plpgsql security definer set search_path=pg_catalog as $fn$
begin
 if new.state='reversed' and old.state is distinct from new.state then
  update public.network_payout_jobs_v1_1033 j
  set state='review',review_reason='SOURCE_REVERSED',updated_at=clock_timestamp()
  where j.state not in('cancelled','rejected','refunded','review') and exists(
   select 1 from public.network_fee_payout_allocations_v1_1031 a
   where a.reservation_id=j.reservation_id
    and a.kind=new.kind and a.source_id=new.source_id);
 end if;
 return new;
end $fn$;
create trigger network_payout_source_review_trg_v1_1033
 after update of state on public.network_fee_package_sources_v1_1030
 for each row execute function public.network_payout_review_reversal_v1_1033();

revoke all on function public.network_payout_assert_owner_v1_1033(uuid),
 public.network_payout_beneficiary_register_v1_1033(uuid,uuid,text,text,text,text,text),
 public.network_payout_set_execution_v1_1033(uuid,boolean,text),
 public.network_payout_prepare_v1_1033(uuid,uuid),
 public.network_payout_authorize_v1_1033(uuid,uuid,bigint,text,text),
 public.network_payout_dispatch_begin_v1_1033(uuid,uuid),
 public.network_payout_dispatch_result_v1_1033(uuid,uuid,text,text,boolean),
 public.network_payout_observe_v1_1033(uuid,uuid,text,text,text,text),
 public.network_payout_bind_ambiguous_v1_1033(uuid,uuid,text,text),
 public.network_payout_bank_confirm_v1_1033(uuid,uuid,text,text),
 public.network_payout_cancel_prepared_v1_1033(uuid,uuid),
 public.network_payout_overview_v1_1033(uuid),
 public.network_payout_job_read_v1_1033(uuid,uuid),
 public.network_payout_review_reversal_v1_1033()
 from public,anon,authenticated,service_role;
grant execute on function public.network_payout_beneficiary_register_v1_1033(uuid,uuid,text,text,text,text,text),
 public.network_payout_set_execution_v1_1033(uuid,boolean,text),
 public.network_payout_prepare_v1_1033(uuid,uuid),
 public.network_payout_authorize_v1_1033(uuid,uuid,bigint,text,text),
 public.network_payout_dispatch_begin_v1_1033(uuid,uuid),
 public.network_payout_dispatch_result_v1_1033(uuid,uuid,text,text,boolean),
 public.network_payout_observe_v1_1033(uuid,uuid,text,text,text,text),
 public.network_payout_bind_ambiguous_v1_1033(uuid,uuid,text,text),
 public.network_payout_bank_confirm_v1_1033(uuid,uuid,text,text),
 public.network_payout_cancel_prepared_v1_1033(uuid,uuid),
 public.network_payout_overview_v1_1033(uuid),
 public.network_payout_job_read_v1_1033(uuid,uuid) to service_role;
-- Internal helper is callable by owner functions (SECURITY DEFINER) only.

 or coalesce(p_transaction,'') !~ '^TOP[A-Za-z0-9_-]{8,75}
-- A second independent receipt + matching beneficiary review is required.
create function public.network_payout_bank_confirm_v1_1033(
 p_actor uuid,p_job uuid,p_reference text,p_sha256 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare v_j public.network_payout_jobs_v1_1033%rowtype;
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 if length(coalesce(p_reference,'')) not between 20 and 200
 or coalesce(p_sha256,'') !~ '^[a-f0-9]{64}$'
 then raise exception 'NETWORK_PAYOUT_BANK_EVIDENCE_REQUIRED' using errcode='22023';end if;
 select * into v_j from public.network_payout_jobs_v1_1033
 where id=p_job for update;
 if not found or v_j.state<>'credited_unverified'
  or v_j.provider_status<>'success' or v_j.provider_status_detail<>'accredited'
  or v_j.provider_payout_id is null or v_j.provider_transaction_id is null
  or exists(select 1 from public.network_fee_payout_reservations_v1_1031 r
    where r.id=v_j.reservation_id and r.state='reversal_review')
 then raise exception 'NETWORK_PAYOUT_INDEPENDENT_SETTLEMENT_NOT_READY'
  using errcode='40001';end if;
 update public.network_payout_jobs_v1_1033 set
  state='paid',receipt_reference=p_reference,receipt_hash=p_sha256,
  receipt_checked_by=p_actor,receipt_checked_at=clock_timestamp(),
  updated_at=clock_timestamp() where id=p_job;
 return jsonb_build_object('source','network_payout_bank_confirmation_v1_1033',
  'jobId',p_job,'state','paid','evidenceRecorded',true);
end $fn$;

-- The V1.1031 cancellation was safe when no executor existed. With an
-- executor it must NEVER release funds after a dispatch has been attempted.
create or replace function public.network_fee_payout_cancel_v1_1031(
 p_actor uuid,p_reservation uuid
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare v public.network_fee_payout_reservations_v1_1031%rowtype;
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 select * into v from public.network_fee_payout_reservations_v1_1031
 where id=p_reservation for update;
 if not found then raise exception 'NETWORK_PAYOUT_RESERVATION_UNKNOWN' using errcode='22023';end if;
 if exists(select 1 from public.network_payout_jobs_v1_1033 j
    where j.reservation_id=p_reservation and j.state<>'cancelled')
 then raise exception 'NETWORK_PAYOUT_DISPATCH_OR_JOB_LOCKED'
  using errcode='40001';end if;
 if v.state in('reserved','reversal_review') then
  update public.network_fee_payout_reservations_v1_1031
   set state='cancelled',cancelled_by=p_actor,cancelled_at=clock_timestamp()
   where id=p_reservation;
 end if;
 return jsonb_build_object('source','network_payout_cancel_v1_1031',
  'state','cancelled','reservationId',p_reservation,
  'moneyMoved',false,'fundsReleased',true);
end $fn$;

create function public.network_payout_cancel_prepared_v1_1033(
 p_actor uuid,p_job uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare v_j public.network_payout_jobs_v1_1033%rowtype;
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 select * into v_j from public.network_payout_jobs_v1_1033 where id=p_job for update;
 if not found or v_j.state<>'prepared' then
  raise exception 'NETWORK_PAYOUT_CANCEL_NOT_SAFE' using errcode='40001';end if;
 update public.network_payout_jobs_v1_1033 set state='cancelled',updated_at=clock_timestamp()
 where id=p_job;
 perform public.network_fee_payout_cancel_v1_1031(p_actor,v_j.reservation_id);
 return jsonb_build_object('source','network_payout_safe_cancel_v1_1033',
  'state','cancelled','jobId',p_job,'fundsReleased',true,'providerCalled',false);
end $fn$;

create function public.network_payout_overview_v1_1033(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare v_enabled boolean;v_jobs bigint;v_review bigint;v_paid bigint;v_held bigint;v_recent jsonb;
begin
 if not exists(select 1 from public.platform_admins a where a.user_id=p_actor
   and a.active and a.admin_role in('superadmin','finance'))
 then raise exception 'NETWORK_PAYOUT_READ_DENIED' using errcode='42501';end if;
 select execution_enabled into v_enabled
 from public.network_payout_execution_policy_v1_1033 where singleton;
 select count(*),count(*) filter(where state in('uncertain','review')),
   coalesce(sum(amount_cents) filter(where state='paid'),0),
   coalesce(sum(amount_cents) filter(where state in(
     'prepared','authorized','dispatching','uncertain','submitted','credited_unverified','review')),0)
 into v_jobs,v_review,v_paid,v_held from public.network_payout_jobs_v1_1033;
 select coalesce(jsonb_agg(jsonb_build_object(
   'jobId',x.id,'userId',x.user_id,'amountCents',x.amount_cents,
   'state',x.state,'createdAt',x.created_at)),'[]'::jsonb)
 into v_recent from (
   select id,user_id,amount_cents,state,created_at
   from public.network_payout_jobs_v1_1033 order by created_at desc limit 12
 ) x;
 return jsonb_build_object('source','network_payout_executor_v1_1033',
  'readOnly',true,'executionEnabled',coalesce(v_enabled,false),
  'jobs',v_jobs,'recentJobs',v_recent,'needsReview',v_review,'paidWithIndependentProofCents',v_paid,
  'inFlightOrReservedCents',v_held,
  'providerCredentialsVerified',false,
  'recipientProofRequired',true,
  'autoTransferEnabled',false);
end $fn$;

create function public.network_payout_job_read_v1_1033(p_actor uuid,p_job uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare v_j public.network_payout_jobs_v1_1033%rowtype;
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 select * into v_j from public.network_payout_jobs_v1_1033 where id=p_job;
 if not found then raise exception 'NETWORK_PAYOUT_JOB_UNKNOWN' using errcode='22023';end if;
 return jsonb_build_object('source','network_payout_job_v1_1033',
  'jobId',v_j.id,'reservationId',v_j.reservation_id,
  'userId',v_j.user_id,'amountCents',v_j.amount_cents,
  'pixKeyHash',v_j.pix_key_hash,
  'state',v_j.state,'providerPayoutId',v_j.provider_payout_id,
  'providerTransactionId',v_j.provider_transaction_id,
  'providerStatus',v_j.provider_status,'providerDetail',v_j.provider_status_detail,
  'externalReference',v_j.external_reference,
  'receiptRecorded',v_j.receipt_hash is not null);
end $fn$;

create function public.network_payout_review_reversal_v1_1033()
returns trigger language plpgsql security definer set search_path=pg_catalog as $fn$
begin
 if new.state='reversed' and old.state is distinct from new.state then
  update public.network_payout_jobs_v1_1033 j
  set state='review',review_reason='SOURCE_REVERSED',updated_at=clock_timestamp()
  where j.state not in('cancelled','rejected','refunded','review') and exists(
   select 1 from public.network_fee_payout_allocations_v1_1031 a
   where a.reservation_id=j.reservation_id
    and a.kind=new.kind and a.source_id=new.source_id);
 end if;
 return new;
end $fn$;
create trigger network_payout_source_review_trg_v1_1033
 after update of state on public.network_fee_package_sources_v1_1030
 for each row execute function public.network_payout_review_reversal_v1_1033();

revoke all on function public.network_payout_assert_owner_v1_1033(uuid),
 public.network_payout_beneficiary_register_v1_1033(uuid,uuid,text,text,text,text,text),
 public.network_payout_set_execution_v1_1033(uuid,boolean,text),
 public.network_payout_prepare_v1_1033(uuid,uuid),
 public.network_payout_authorize_v1_1033(uuid,uuid,bigint,text,text),
 public.network_payout_dispatch_begin_v1_1033(uuid,uuid),
 public.network_payout_dispatch_result_v1_1033(uuid,uuid,text,text,boolean),
 public.network_payout_observe_v1_1033(uuid,uuid,text,text,text,text),
 public.network_payout_bind_ambiguous_v1_1033(uuid,uuid,text,text),
 public.network_payout_bank_confirm_v1_1033(uuid,uuid,text,text),
 public.network_payout_cancel_prepared_v1_1033(uuid,uuid),
 public.network_payout_overview_v1_1033(uuid),
 public.network_payout_job_read_v1_1033(uuid,uuid),
 public.network_payout_review_reversal_v1_1033()
 from public,anon,authenticated,service_role;
grant execute on function public.network_payout_beneficiary_register_v1_1033(uuid,uuid,text,text,text,text,text),
 public.network_payout_set_execution_v1_1033(uuid,boolean,text),
 public.network_payout_prepare_v1_1033(uuid,uuid),
 public.network_payout_authorize_v1_1033(uuid,uuid,bigint,text,text),
 public.network_payout_dispatch_begin_v1_1033(uuid,uuid),
 public.network_payout_dispatch_result_v1_1033(uuid,uuid,text,text,boolean),
 public.network_payout_observe_v1_1033(uuid,uuid,text,text,text,text),
 public.network_payout_bind_ambiguous_v1_1033(uuid,uuid,text,text),
 public.network_payout_bank_confirm_v1_1033(uuid,uuid,text,text),
 public.network_payout_cancel_prepared_v1_1033(uuid,uuid),
 public.network_payout_overview_v1_1033(uuid),
 public.network_payout_job_read_v1_1033(uuid,uuid) to service_role;
-- Internal helper is callable by owner functions (SECURITY DEFINER) only.

 then raise exception 'NETWORK_PAYOUT_RECOVERY_IDS_INVALID' using errcode='22023';end if;
 select * into v_j from public.network_payout_jobs_v1_1033 where id=p_job for update;
 if not found or v_j.state not in('uncertain','dispatching','submitted')
 then raise exception 'NETWORK_PAYOUT_RECOVERY_NOT_ALLOWED' using errcode='40001';end if;
 if (v_j.provider_payout_id is not null and v_j.provider_payout_id<>p_payout)
  or (v_j.provider_transaction_id is not null and v_j.provider_transaction_id<>p_transaction)
 then raise exception 'NETWORK_PAYOUT_RECOVERY_PROVIDER_CONFLICT' using errcode='23505';end if;
 update public.network_payout_jobs_v1_1033
 set state='submitted',provider_payout_id=p_payout,provider_transaction_id=p_transaction,
   updated_at=clock_timestamp() where id=p_job;
 return jsonb_build_object('source','network_payout_recovery_v1_1033',
  'jobId',p_job,'state','submitted','providerBound',true,'moneyConfirmed',false);
end $fn$;

-- Provider success alone does NOT prove the destination belongs to this user.
-- A second independent receipt + matching beneficiary review is required.
create function public.network_payout_bank_confirm_v1_1033(
 p_actor uuid,p_job uuid,p_reference text,p_sha256 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare v_j public.network_payout_jobs_v1_1033%rowtype;
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 if length(coalesce(p_reference,'')) not between 20 and 200
 or coalesce(p_sha256,'') !~ '^[a-f0-9]{64}$'
 then raise exception 'NETWORK_PAYOUT_BANK_EVIDENCE_REQUIRED' using errcode='22023';end if;
 select * into v_j from public.network_payout_jobs_v1_1033
 where id=p_job for update;
 if not found or v_j.state<>'credited_unverified'
  or v_j.provider_status<>'success' or v_j.provider_status_detail<>'accredited'
  or v_j.provider_payout_id is null or v_j.provider_transaction_id is null
  or exists(select 1 from public.network_fee_payout_reservations_v1_1031 r
    where r.id=v_j.reservation_id and r.state='reversal_review')
 then raise exception 'NETWORK_PAYOUT_INDEPENDENT_SETTLEMENT_NOT_READY'
  using errcode='40001';end if;
 update public.network_payout_jobs_v1_1033 set
  state='paid',receipt_reference=p_reference,receipt_hash=p_sha256,
  receipt_checked_by=p_actor,receipt_checked_at=clock_timestamp(),
  updated_at=clock_timestamp() where id=p_job;
 return jsonb_build_object('source','network_payout_bank_confirmation_v1_1033',
  'jobId',p_job,'state','paid','evidenceRecorded',true);
end $fn$;

-- The V1.1031 cancellation was safe when no executor existed. With an
-- executor it must NEVER release funds after a dispatch has been attempted.
create or replace function public.network_fee_payout_cancel_v1_1031(
 p_actor uuid,p_reservation uuid
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare v public.network_fee_payout_reservations_v1_1031%rowtype;
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 select * into v from public.network_fee_payout_reservations_v1_1031
 where id=p_reservation for update;
 if not found then raise exception 'NETWORK_PAYOUT_RESERVATION_UNKNOWN' using errcode='22023';end if;
 if exists(select 1 from public.network_payout_jobs_v1_1033 j
    where j.reservation_id=p_reservation and j.state<>'cancelled')
 then raise exception 'NETWORK_PAYOUT_DISPATCH_OR_JOB_LOCKED'
  using errcode='40001';end if;
 if v.state in('reserved','reversal_review') then
  update public.network_fee_payout_reservations_v1_1031
   set state='cancelled',cancelled_by=p_actor,cancelled_at=clock_timestamp()
   where id=p_reservation;
 end if;
 return jsonb_build_object('source','network_payout_cancel_v1_1031',
  'state','cancelled','reservationId',p_reservation,
  'moneyMoved',false,'fundsReleased',true);
end $fn$;

create function public.network_payout_cancel_prepared_v1_1033(
 p_actor uuid,p_job uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare v_j public.network_payout_jobs_v1_1033%rowtype;
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 select * into v_j from public.network_payout_jobs_v1_1033 where id=p_job for update;
 if not found or v_j.state<>'prepared' then
  raise exception 'NETWORK_PAYOUT_CANCEL_NOT_SAFE' using errcode='40001';end if;
 update public.network_payout_jobs_v1_1033 set state='cancelled',updated_at=clock_timestamp()
 where id=p_job;
 perform public.network_fee_payout_cancel_v1_1031(p_actor,v_j.reservation_id);
 return jsonb_build_object('source','network_payout_safe_cancel_v1_1033',
  'state','cancelled','jobId',p_job,'fundsReleased',true,'providerCalled',false);
end $fn$;

create function public.network_payout_overview_v1_1033(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare v_enabled boolean;v_jobs bigint;v_review bigint;v_paid bigint;v_held bigint;v_recent jsonb;
begin
 if not exists(select 1 from public.platform_admins a where a.user_id=p_actor
   and a.active and a.admin_role in('superadmin','finance'))
 then raise exception 'NETWORK_PAYOUT_READ_DENIED' using errcode='42501';end if;
 select execution_enabled into v_enabled
 from public.network_payout_execution_policy_v1_1033 where singleton;
 select count(*),count(*) filter(where state in('uncertain','review')),
   coalesce(sum(amount_cents) filter(where state='paid'),0),
   coalesce(sum(amount_cents) filter(where state in(
     'prepared','authorized','dispatching','uncertain','submitted','credited_unverified','review')),0)
 into v_jobs,v_review,v_paid,v_held from public.network_payout_jobs_v1_1033;
 select coalesce(jsonb_agg(jsonb_build_object(
   'jobId',x.id,'userId',x.user_id,'amountCents',x.amount_cents,
   'state',x.state,'createdAt',x.created_at)),'[]'::jsonb)
 into v_recent from (
   select id,user_id,amount_cents,state,created_at
   from public.network_payout_jobs_v1_1033 order by created_at desc limit 12
 ) x;
 return jsonb_build_object('source','network_payout_executor_v1_1033',
  'readOnly',true,'executionEnabled',coalesce(v_enabled,false),
  'jobs',v_jobs,'recentJobs',v_recent,'needsReview',v_review,'paidWithIndependentProofCents',v_paid,
  'inFlightOrReservedCents',v_held,
  'providerCredentialsVerified',false,
  'recipientProofRequired',true,
  'autoTransferEnabled',false);
end $fn$;

create function public.network_payout_job_read_v1_1033(p_actor uuid,p_job uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare v_j public.network_payout_jobs_v1_1033%rowtype;
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 select * into v_j from public.network_payout_jobs_v1_1033 where id=p_job;
 if not found then raise exception 'NETWORK_PAYOUT_JOB_UNKNOWN' using errcode='22023';end if;
 return jsonb_build_object('source','network_payout_job_v1_1033',
  'jobId',v_j.id,'reservationId',v_j.reservation_id,
  'userId',v_j.user_id,'amountCents',v_j.amount_cents,
  'pixKeyHash',v_j.pix_key_hash,
  'state',v_j.state,'providerPayoutId',v_j.provider_payout_id,
  'providerTransactionId',v_j.provider_transaction_id,
  'providerStatus',v_j.provider_status,'providerDetail',v_j.provider_status_detail,
  'externalReference',v_j.external_reference,
  'receiptRecorded',v_j.receipt_hash is not null);
end $fn$;

create function public.network_payout_review_reversal_v1_1033()
returns trigger language plpgsql security definer set search_path=pg_catalog as $fn$
begin
 if new.state='reversed' and old.state is distinct from new.state then
  update public.network_payout_jobs_v1_1033 j
  set state='review',review_reason='SOURCE_REVERSED',updated_at=clock_timestamp()
  where j.state not in('cancelled','rejected','refunded','review') and exists(
   select 1 from public.network_fee_payout_allocations_v1_1031 a
   where a.reservation_id=j.reservation_id
    and a.kind=new.kind and a.source_id=new.source_id);
 end if;
 return new;
end $fn$;
create trigger network_payout_source_review_trg_v1_1033
 after update of state on public.network_fee_package_sources_v1_1030
 for each row execute function public.network_payout_review_reversal_v1_1033();

revoke all on function public.network_payout_assert_owner_v1_1033(uuid),
 public.network_payout_beneficiary_register_v1_1033(uuid,uuid,text,text,text,text,text),
 public.network_payout_set_execution_v1_1033(uuid,boolean,text),
 public.network_payout_prepare_v1_1033(uuid,uuid),
 public.network_payout_authorize_v1_1033(uuid,uuid,bigint,text,text),
 public.network_payout_dispatch_begin_v1_1033(uuid,uuid),
 public.network_payout_dispatch_result_v1_1033(uuid,uuid,text,text,boolean),
 public.network_payout_observe_v1_1033(uuid,uuid,text,text,text,text),
 public.network_payout_bind_ambiguous_v1_1033(uuid,uuid,text,text),
 public.network_payout_bank_confirm_v1_1033(uuid,uuid,text,text),
 public.network_payout_cancel_prepared_v1_1033(uuid,uuid),
 public.network_payout_overview_v1_1033(uuid),
 public.network_payout_job_read_v1_1033(uuid,uuid),
 public.network_payout_review_reversal_v1_1033()
 from public,anon,authenticated,service_role;
grant execute on function public.network_payout_beneficiary_register_v1_1033(uuid,uuid,text,text,text,text,text),
 public.network_payout_set_execution_v1_1033(uuid,boolean,text),
 public.network_payout_prepare_v1_1033(uuid,uuid),
 public.network_payout_authorize_v1_1033(uuid,uuid,bigint,text,text),
 public.network_payout_dispatch_begin_v1_1033(uuid,uuid),
 public.network_payout_dispatch_result_v1_1033(uuid,uuid,text,text,boolean),
 public.network_payout_observe_v1_1033(uuid,uuid,text,text,text,text),
 public.network_payout_bind_ambiguous_v1_1033(uuid,uuid,text,text),
 public.network_payout_bank_confirm_v1_1033(uuid,uuid,text,text),
 public.network_payout_cancel_prepared_v1_1033(uuid,uuid),
 public.network_payout_overview_v1_1033(uuid),
 public.network_payout_job_read_v1_1033(uuid,uuid) to service_role;
-- Internal helper is callable by owner functions (SECURITY DEFINER) only.
