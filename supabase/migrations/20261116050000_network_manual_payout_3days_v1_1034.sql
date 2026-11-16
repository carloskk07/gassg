-- TAMÃO V1.1034 — Manual payouts from audited Rede awards, due in 3 calendar days
-- AFTER owner verification. No API money movement, no self-proclaimed bank receipt.
-- Minimum is deliberately UNSET until the owner chooses an amount.
create table public.network_manual_payout_policy_v1_1034 (
 singleton boolean primary key default true check(singleton),
 minimum_cents bigint check(minimum_cents between 100 and 10000000),
 payment_days integer not null default 3 check(payment_days=3),
 changed_by uuid references auth.users(id) on delete restrict,
 changed_at timestamptz not null default clock_timestamp()
);
insert into public.network_manual_payout_policy_v1_1034(singleton) values(true);

create table public.network_manual_payout_requests_v1_1034 (
 id uuid primary key default gen_random_uuid(),
 reservation_id uuid not null unique references public.network_fee_payout_reservations_v1_1031(id) on delete restrict,
 user_id uuid not null references auth.users(id) on delete restrict,
 amount_cents bigint not null check(amount_cents between 100 and 10000000),
 request_key text not null unique check(length(request_key) between 16 and 80),
 state text not null default 'requested'
    check(state in('requested','approved','paid','cancelled','review')),
 requested_at timestamptz not null default clock_timestamp(),
 approved_at timestamptz,
 approved_by uuid references auth.users(id),
 due_at timestamptz,
 recipient_pix_hash text check(recipient_pix_hash is null or recipient_pix_hash~'^[a-f0-9]{64}$'),
 paid_at timestamptz,
 paid_by uuid references auth.users(id),
 bank_reference text unique check(bank_reference is null or length(bank_reference) between 20 and 200),
 bank_receipt_sha256 text check(bank_receipt_sha256 is null or bank_receipt_sha256~'^[a-f0-9]{64}$'),
 review_at timestamptz,
 review_reason text,
 check(state not in('approved','paid') or
   (approved_at is not null and approved_by is not null and due_at is not null
    and due_at=approved_at+interval '3 days' and recipient_pix_hash is not null)),
 check(state<>'paid' or
   (paid_at is not null and paid_by is not null
     and bank_reference is not null and bank_receipt_sha256 is not null))
);
create unique index network_manual_payout_one_active_per_user_v1_1034
 on public.network_manual_payout_requests_v1_1034(user_id)
 where state in('requested','approved','review');
create index network_manual_payout_due_v1_1034
 on public.network_manual_payout_requests_v1_1034(state,due_at,requested_at);

alter table public.network_manual_payout_policy_v1_1034 enable row level security;
alter table public.network_manual_payout_requests_v1_1034 enable row level security;
revoke all on public.network_manual_payout_policy_v1_1034,
 public.network_manual_payout_requests_v1_1034
 from public,anon,authenticated,service_role;

create function public.network_manual_payout_policy_set_v1_1034(
 p_actor uuid,p_minimum_cents bigint,p_confirm text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 if p_confirm is distinct from 'DEFINIR LIMITE'
 or (p_minimum_cents is not null and
     p_minimum_cents not between 100 and 10000000)
 then raise exception 'MANUAL_PAYOUT_MINIMUM_INVALID' using errcode='22023';end if;
 update public.network_manual_payout_policy_v1_1034
 set minimum_cents=p_minimum_cents,changed_by=p_actor,
  changed_at=clock_timestamp() where singleton;
 return jsonb_build_object('source','network_manual_policy_v1_1034',
   'minimumCents',p_minimum_cents,'paymentDays',3,
   'automaticPayouts',false,'moneyMoved',false);
end $fn$;

-- User-scoped read; Edge MUST independently verify the JWT subject.
create function public.network_manual_payout_status_v1_1034(p_user uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $fn$
declare v_min bigint;v_total bigint;v_reserved bigint;v_offsets bigint;
 v_accrual boolean;v_active record;v_identity boolean;
begin
 select p.minimum_cents into v_min from public.network_manual_payout_policy_v1_1034 p where singleton;
 select p.accrual_enabled into v_accrual from public.network_fee_package_policy_v1_1030 p where singleton;
 select coalesce(sum(a.equal_microcents+a.inviter_microcents),0)
  into v_total from public.network_fee_package_awards_v1_1030 a
  join public.network_fee_package_sources_v1_1030 s using(kind,source_id)
  where a.user_id=p_user and s.state='eligible';
 select coalesce(sum(r.amount_cents)*1000000,0) into v_reserved
  from public.network_fee_payout_reservations_v1_1031 r
  where r.user_id=p_user and r.state<>'cancelled';
 select coalesce(sum(o.amount_cents)*1000000,0) into v_offsets
  from public.network_fee_package_offsets_v1_1032 o
  where o.user_id=p_user and o.state<>'cancelled';
 select id,state,amount_cents,requested_at,approved_at,due_at
 into v_active from public.network_manual_payout_requests_v1_1034
 where user_id=p_user
 order by requested_at desc limit 1;
 select exists(select 1 from public.network_payout_beneficiaries_v1_1033 b
  where b.user_id=p_user) into v_identity;
 return jsonb_build_object('source','network_manual_payout_status_v1_1034',
  'readOnly',true,'mode','manual','automaticPayouts',false,
  'minimumConfigured',v_min is not null,'minimumCents',v_min,
  'paymentDays',3,'accrualEnabled',coalesce(v_accrual,false),
  'beneficiaryVerified',v_identity,
  'availableCents',greatest(0,floor((v_total-v_reserved-v_offsets)::numeric/1000000)::bigint),
  'canRequest',coalesce(v_accrual,false) and v_min is not null
    and floor((v_total-v_reserved-v_offsets)::numeric/1000000)>=coalesce(v_min,10000001)
    and (v_active.id is null or v_active.state not in('requested','approved','review')),
  'request',case when v_active.id is null then null else jsonb_build_object(
    'requestId',v_active.id,'state',v_active.state,'amountCents',v_active.amount_cents,
    'requestedAt',v_active.requested_at,'approvedAt',v_active.approved_at,'dueAt',v_active.due_at) end);
end $fn$;

-- Claim only matured, reconciled, source-backed awards. This repeats V1.1032
-- microcent reservations under the SAME advisory user lock (payout/offset).
create function public.network_manual_payout_request_v1_1034(p_user uuid,p_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare v_req public.network_manual_payout_requests_v1_1034%rowtype;
 v_min bigint;v_amount bigint;v_total bigint:=0;v_needed bigint;v_used bigint;
 v_offset_used bigint;v_take bigint;v_award record;v_id uuid;v_res uuid;
begin
 if p_user is null or coalesce(p_key,'') !~ '^[A-Za-z0-9_-]{16,80}$'
 then raise exception 'MANUAL_PAYOUT_REQUEST_INVALID' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('network-payout-user:'||p_user::text,0));
 select * into v_req from public.network_manual_payout_requests_v1_1034
  where request_key=p_key;
 if found then
  if v_req.user_id<>p_user then raise exception 'MANUAL_PAYOUT_REQUEST_KEY_CONFLICT'
   using errcode='23505';end if;
  return jsonb_build_object('source','network_manual_request_v1_1034',
   'requestId',v_req.id,'state',v_req.state,
   'amountCents',v_req.amount_cents,'alreadyRecorded',true,'moneyMoved',false);
 end if;
 if not exists(select 1 from auth.users u where u.id=p_user and
   not u.is_anonymous and u.deleted_at is null
   and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
   and (u.banned_until is null or u.banned_until<clock_timestamp()))
 or exists(select 1 from public.platform_admins a where a.user_id=p_user and a.active)
 then raise exception 'MANUAL_PAYOUT_USER_NOT_ELIGIBLE' using errcode='42501';end if;
 if exists(select 1 from public.network_manual_payout_requests_v1_1034 r
   where r.user_id=p_user and r.state in('requested','approved','review'))
 then raise exception 'MANUAL_PAYOUT_ALREADY_REQUESTED' using errcode='23505';end if;
 select minimum_cents into v_min from public.network_manual_payout_policy_v1_1034 where singleton;
 if v_min is null or not exists(select 1
  from public.network_fee_package_policy_v1_1030
  where singleton and accrual_enabled and terms_approved_at is not null
    and terms_reference is not null)
 then raise exception 'MANUAL_PAYOUT_PROGRAM_OR_MINIMUM_NOT_READY'
  using errcode='42501';end if;
 for v_award in
 select a.kind,a.source_id,a.user_id,
   (a.equal_microcents+a.inviter_microcents) as value
 from public.network_fee_package_awards_v1_1030 a
 join public.network_fee_package_sources_v1_1030 s using(kind,source_id)
 where a.user_id=p_user and s.state='eligible'
 order by s.matured_at,a.kind,a.source_id
 loop
  select coalesce(sum(l.amount_microcents),0) into v_used
  from public.network_fee_payout_allocations_v1_1031 l
  join public.network_fee_payout_reservations_v1_1031 r on r.id=l.reservation_id
  where l.user_id=p_user and l.kind=v_award.kind and l.source_id=v_award.source_id
   and r.state<>'cancelled';
  select coalesce(sum(l.amount_microcents),0) into v_offset_used
  from public.network_fee_package_offset_allocations_v1_1032 l
  join public.network_fee_package_offsets_v1_1032 o on o.id=l.offset_id
  where l.user_id=p_user and l.kind=v_award.kind and l.source_id=v_award.source_id
   and o.state<>'cancelled';
  if v_award.value<v_used+v_offset_used
  then raise exception 'MANUAL_PAYOUT_LEDGER_OVERALLOCATED';end if;
  v_total:=v_total+(v_award.value-v_used-v_offset_used);
 end loop;
 v_amount:=least(10000000,floor(v_total::numeric/1000000)::bigint);
 if v_amount<v_min then
  raise exception 'MANUAL_PAYOUT_MINIMUM_NOT_REACHED' using errcode='22023';end if;
 v_needed:=v_amount*1000000;
 insert into public.network_fee_payout_reservations_v1_1031
 (user_id,amount_cents,idempotency_key,created_by)
 values(p_user,v_amount,p_key,p_user) returning id into v_res;
 for v_award in
 select a.kind,a.source_id,a.user_id,
  (a.equal_microcents+a.inviter_microcents) as value
 from public.network_fee_package_awards_v1_1030 a
 join public.network_fee_package_sources_v1_1030 s using(kind,source_id)
 where a.user_id=p_user and s.state='eligible'
 order by s.matured_at,a.kind,a.source_id
 loop
  exit when v_needed=0;
  select coalesce(sum(l.amount_microcents),0) into v_used
  from public.network_fee_payout_allocations_v1_1031 l
  join public.network_fee_payout_reservations_v1_1031 r on r.id=l.reservation_id
  where l.user_id=p_user and l.kind=v_award.kind and l.source_id=v_award.source_id
    and r.state<>'cancelled';
  select coalesce(sum(l.amount_microcents),0) into v_offset_used
  from public.network_fee_package_offset_allocations_v1_1032 l
  join public.network_fee_package_offsets_v1_1032 o on o.id=l.offset_id
  where l.user_id=p_user and l.kind=v_award.kind and l.source_id=v_award.source_id
    and o.state<>'cancelled';
  v_take:=least(v_needed,greatest(0,v_award.value-v_used-v_offset_used));
  if v_take>0 then
   insert into public.network_fee_payout_allocations_v1_1031
    (reservation_id,kind,source_id,user_id,amount_microcents)
   values(v_res,v_award.kind,v_award.source_id,p_user,v_take);
   v_needed:=v_needed-v_take;
  end if;
 end loop;
 if v_needed<>0 then raise exception 'MANUAL_PAYOUT_CONSERVATION';end if;
 insert into public.network_manual_payout_requests_v1_1034
  (reservation_id,user_id,amount_cents,request_key)
 values(v_res,p_user,v_amount,p_key) returning id into v_id;
 return jsonb_build_object('source','network_manual_request_v1_1034',
  'requestId',v_id,'state','requested','amountCents',v_amount,
  'alreadyRecorded',false,'moneyMoved',false);
end $fn$;

create function public.network_manual_payout_queue_v1_1034(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare v_min bigint;v_rows jsonb;v_due bigint;
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 select minimum_cents into v_min from public.network_manual_payout_policy_v1_1034 where singleton;
 select coalesce(jsonb_agg(jsonb_build_object('requestId',x.id,
    'userId',x.user_id,'amountCents',x.amount_cents,'state',x.state,
    'requestedAt',x.requested_at,'approvedAt',x.approved_at,
    'dueAt',x.due_at,'recipientPixHash',x.recipient_pix_hash,
    'proofRecorded',x.bank_receipt_sha256 is not null)
   order by x.due_at nulls last,x.requested_at),'[]'::jsonb)
 into v_rows from (
  select * from public.network_manual_payout_requests_v1_1034
  where state in('requested','approved','review')
  order by due_at nulls last,requested_at limit 30
 ) x;
 select count(*) into v_due from public.network_manual_payout_requests_v1_1034
 where state='approved' and due_at<clock_timestamp();
 return jsonb_build_object('source','network_manual_queue_v1_1034',
  'readOnly',true,'minimumCents',v_min,'paymentDays',3,
  'manualOnly',true,'overdueCount',v_due,'items',v_rows);
end $fn$;

create function public.network_manual_payout_approve_v1_1034(
 p_actor uuid,p_request uuid,p_confirm text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare v public.network_manual_payout_requests_v1_1034%rowtype;v_hash text;v_at timestamptz;
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 if p_confirm is distinct from 'IDENTIDADE E SALDO CONFERIDOS'
 then raise exception 'MANUAL_PAYOUT_REVIEW_CONFIRM_REQUIRED' using errcode='42501';end if;
 select * into v from public.network_manual_payout_requests_v1_1034 where id=p_request for update;
 if not found or v.state<>'requested' then
  raise exception 'MANUAL_PAYOUT_NOT_REVIEWABLE' using errcode='40001';end if;
 if not exists(select 1 from public.network_fee_payout_reservations_v1_1031 r
  where r.id=v.reservation_id and r.state='reserved')
 or exists(select 1 from public.network_fee_payout_allocations_v1_1031 a
   join public.network_fee_package_sources_v1_1030 s using(kind,source_id)
   where a.reservation_id=v.reservation_id and s.state<>'eligible')
 or exists(select 1 from public.network_payout_jobs_v1_1033 j
   where j.reservation_id=v.reservation_id)
 then raise exception 'MANUAL_PAYOUT_FUNDS_UNVERIFIED' using errcode='42501';end if;
 select pix_key_hash into v_hash from public.network_payout_beneficiaries_v1_1033
 where user_id=v.user_id;
 if v_hash is null then
  raise exception 'MANUAL_PAYOUT_RECIPIENT_NOT_VERIFIED' using errcode='42501';end if;
 v_at:=clock_timestamp();
 update public.network_manual_payout_requests_v1_1034
 set state='approved',approved_by=p_actor,approved_at=v_at,
     recipient_pix_hash=v_hash,due_at=v_at+interval '3 days'
 where id=p_request;
 return jsonb_build_object('source','network_manual_approval_v1_1034',
  'state','approved','requestId',p_request,'dueAt',v_at+interval '3 days',
  'amountCents',v.amount_cents,'recipientPixHash',v_hash,
  'moneyMoved',false);
end $fn$;

-- Owner attest after actual manual payment OUTSIDE TAMÃO.
-- Hash alone is not an automatic PSP proof; the original independent bank
-- receipt must be retained and checked by the operator.
create function public.network_manual_payout_mark_paid_v1_1034(
 p_actor uuid,p_request uuid,p_amount_cents bigint,p_expected_pix_hash text,
 p_bank_reference text,p_receipt_sha256 text,p_confirm text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare v public.network_manual_payout_requests_v1_1034%rowtype;v_hash text;
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 if p_confirm is distinct from 'CONFERI PIX EXTERNO E DESTINATARIO'
  or length(coalesce(p_bank_reference,'')) not between 20 and 200
  or coalesce(p_receipt_sha256,'') !~ '^[a-f0-9]{64}$'
 then raise exception 'MANUAL_PAYOUT_RECEIPT_REQUIRED' using errcode='22023';end if;
 select * into v from public.network_manual_payout_requests_v1_1034
 where id=p_request for update;
 if not found or v.state<>'approved'
  or v.amount_cents is distinct from p_amount_cents
  or v.recipient_pix_hash is distinct from p_expected_pix_hash
  or exists(select 1 from public.network_fee_payout_reservations_v1_1031 r
    where r.id=v.reservation_id and r.state<>'reserved')
  or exists(select 1 from public.network_fee_payout_allocations_v1_1031 a
    join public.network_fee_package_sources_v1_1030 s using(kind,source_id)
    where a.reservation_id=v.reservation_id and s.state<>'eligible')
 then raise exception 'MANUAL_PAYOUT_RECONCILIATION_MISMATCH' using errcode='40001';end if;
 select pix_key_hash into v_hash from public.network_payout_beneficiaries_v1_1033
 where user_id=v.user_id;
 if v_hash is distinct from v.recipient_pix_hash
 then raise exception 'MANUAL_PAYOUT_DESTINATION_CHANGED' using errcode='40001';end if;
 update public.network_manual_payout_requests_v1_1034
 set state='paid',paid_at=clock_timestamp(),paid_by=p_actor,
  bank_reference=p_bank_reference,bank_receipt_sha256=p_receipt_sha256
 where id=p_request;
 return jsonb_build_object('source','network_manual_paid_record_v1_1034',
  'requestId',p_request,'state','paid','amountCents',v.amount_cents,
  'manualEvidenceRecorded',true,'providerApiCalled',false);
end $fn$;

-- Cancelling is safe only before approval. After approval manual outgoing
-- banking may be in transit: never silently restore the bonus allocation.
create function public.network_manual_payout_cancel_v1_1034(
 p_actor uuid,p_request uuid,p_confirm text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare v public.network_manual_payout_requests_v1_1034%rowtype;
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 if p_confirm is distinct from 'NAO HOUVE PAGAMENTO'
 then raise exception 'MANUAL_PAYOUT_CANCEL_CONFIRM_REQUIRED' using errcode='42501';end if;
 select * into v from public.network_manual_payout_requests_v1_1034
 where id=p_request for update;
 if not found or v.state<>'requested'
 then raise exception 'MANUAL_PAYOUT_CANNOT_CANCEL_AFTER_APPROVAL' using errcode='40001';end if;
 update public.network_manual_payout_requests_v1_1034
 set state='cancelled' where id=p_request;
 perform public.network_fee_payout_cancel_v1_1031(p_actor,v.reservation_id);
 return jsonb_build_object('source','network_manual_cancel_v1_1034',
   'requestId',p_request,'state','cancelled','fundsReleased',true,
   'bankTransferMade',false);
end $fn$;

-- Block a simultaneous automatic-Payouts job for a manual reservation.
create function public.network_manual_payout_job_guard_v1_1034()
returns trigger language plpgsql security definer set search_path=pg_catalog as $fn$
begin
 if exists(select 1 from public.network_manual_payout_requests_v1_1034 m
    where m.reservation_id=new.reservation_id and m.state<>'cancelled')
 then raise exception 'MANUAL_PAYOUT_RESERVATION_EXCLUSIVE' using errcode='40001';end if;
 return new;
end $fn$;
create trigger network_manual_job_guard_v1_1034
before insert or update of reservation_id on public.network_payout_jobs_v1_1033
for each row execute function public.network_manual_payout_job_guard_v1_1034();

-- Protect all manually reserved funds against the legacy owner cancel RPC.
create function public.network_manual_payout_reservation_guard_v1_1034()
returns trigger language plpgsql security definer set search_path=pg_catalog as $fn$
begin
 if new.state='cancelled' and old.state is distinct from new.state
  and exists(select 1 from public.network_manual_payout_requests_v1_1034 m
   where m.reservation_id=new.id and m.state<>'cancelled')
 then raise exception 'MANUAL_PAYOUT_RESERVATION_LOCKED' using errcode='40001';end if;
 return new;
end $fn$;
create trigger network_manual_reservation_guard_v1_1034
before update of state on public.network_fee_payout_reservations_v1_1031
for each row execute function public.network_manual_payout_reservation_guard_v1_1034();

-- Source refunds/reversals cannot be silently marked paid or released.
create function public.network_manual_payout_source_reversal_v1_1034()
returns trigger language plpgsql security definer set search_path=pg_catalog as $fn$
begin
 if new.state='reversed' and old.state is distinct from new.state then
 update public.network_manual_payout_requests_v1_1034 m
 set state='review',review_at=clock_timestamp(),review_reason='SOURCE_REVERSED'
 where m.state in('requested','approved','paid') and exists(
  select 1 from public.network_fee_payout_allocations_v1_1031 a
  where a.reservation_id=m.reservation_id
  and a.kind=new.kind and a.source_id=new.source_id);
 end if;
 return new;
end $fn$;
create trigger network_manual_payout_source_reversal_trg_v1_1034
after update of state on public.network_fee_package_sources_v1_1030
for each row execute function public.network_manual_payout_source_reversal_v1_1034();

revoke all on function
 public.network_manual_payout_policy_set_v1_1034(uuid,bigint,text),
 public.network_manual_payout_status_v1_1034(uuid),
 public.network_manual_payout_request_v1_1034(uuid,text),
 public.network_manual_payout_queue_v1_1034(uuid),
 public.network_manual_payout_approve_v1_1034(uuid,uuid,text),
 public.network_manual_payout_mark_paid_v1_1034(uuid,uuid,bigint,text,text,text,text),
 public.network_manual_payout_cancel_v1_1034(uuid,uuid,text),
 public.network_manual_payout_job_guard_v1_1034(),
 public.network_manual_payout_reservation_guard_v1_1034(),
 public.network_manual_payout_source_reversal_v1_1034()
from public,anon,authenticated,service_role;
grant execute on function
 public.network_manual_payout_policy_set_v1_1034(uuid,bigint,text),
 public.network_manual_payout_status_v1_1034(uuid),
 public.network_manual_payout_request_v1_1034(uuid,text),
 public.network_manual_payout_queue_v1_1034(uuid),
 public.network_manual_payout_approve_v1_1034(uuid,uuid,text),
 public.network_manual_payout_mark_paid_v1_1034(uuid,uuid,bigint,text,text,text,text),
 public.network_manual_payout_cancel_v1_1034(uuid,uuid,text)
to service_role;
