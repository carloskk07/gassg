-- TAMÃO #493 / V1.1031 — reserve eligible NETWORK package awards, never transfer money.
-- A reservation is not a paid Pix; the existing immutable payout switch remains OFF.
begin;

create table public.network_fee_payout_reservations_v1_1031 (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete restrict,
 amount_cents bigint not null check(amount_cents between 100 and 10000000),
 idempotency_key text not null unique
   check(length(idempotency_key) between 16 and 80 and idempotency_key ~ '^[A-Za-z0-9_-]+$'),
 state text not null default 'reserved'
   check(state in ('reserved','cancelled','reversal_review')),
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(),
 cancelled_at timestamptz,
 cancelled_by uuid references auth.users(id),
 check((state='cancelled' and cancelled_at is not null and cancelled_by is not null)
    or (state<>'cancelled' and cancelled_at is null and cancelled_by is null))
);
create index network_fee_payout_user_v1_1031_idx
 on public.network_fee_payout_reservations_v1_1031(user_id,created_at desc);

create table public.network_fee_payout_allocations_v1_1031 (
 reservation_id uuid not null
  references public.network_fee_payout_reservations_v1_1031(id) on delete restrict,
 kind text not null,
 source_id uuid not null,
 user_id uuid not null,
 amount_microcents bigint not null check(amount_microcents>0),
 primary key(reservation_id,kind,source_id,user_id),
 foreign key(kind,source_id,user_id)
  references public.network_fee_package_awards_v1_1030(kind,source_id,user_id) on delete restrict
);
create index network_fee_payout_allocations_source_v1_1031_idx
 on public.network_fee_payout_allocations_v1_1031(kind,source_id,user_id);

alter table public.network_fee_payout_reservations_v1_1031 enable row level security;
alter table public.network_fee_payout_allocations_v1_1031 enable row level security;
revoke all on public.network_fee_payout_reservations_v1_1031,
 public.network_fee_payout_allocations_v1_1031 from public,anon,authenticated,service_role;

-- An OWNER may reserve against a validated balance for later beneficiary
-- identity review. Reservation DOES NOT invoke a PSP and cannot be represented
-- as paid. No recipient Pix key / CPF / bank credential is stored.
create function public.network_fee_payout_reserve_v1_1031(
 p_actor uuid,p_user uuid,p_amount_cents bigint,p_key text
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare
 v_existing public.network_fee_payout_reservations_v1_1031%rowtype;
 v_reservation uuid;
 v_needed bigint;v_free bigint;v_used bigint;v_taken bigint;
 v_award record;v_total bigint:=0;
begin
 if not exists(select 1 from public.platform_admins
   where user_id=p_actor and active and admin_role='superadmin')
 then raise exception 'NETWORK_PAYOUT_OWNER_ONLY' using errcode='42501';end if;
 if p_user is null or p_amount_cents is null
   or p_amount_cents not between 100 and 10000000
   or p_key is null or length(p_key) not between 16 and 80
   or p_key !~ '^[A-Za-z0-9_-]+$'
 then raise exception 'NETWORK_PAYOUT_REQUEST_INVALID' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('network-payout-user:'||p_user::text,0));
 select * into v_existing from public.network_fee_payout_reservations_v1_1031
 where idempotency_key=p_key;
 if found then
   if v_existing.user_id<>p_user or v_existing.amount_cents<>p_amount_cents
    or v_existing.created_by<>p_actor
   then raise exception 'NETWORK_PAYOUT_IDEMPOTENCY_CONFLICT' using errcode='23505';end if;
   return jsonb_build_object('source','network_payout_reservation_v1_1031',
    'reservationId',v_existing.id,'state',v_existing.state,
    'amountCents',v_existing.amount_cents,'alreadyRecorded',true,
    'moneyMoved',false,'payoutProviderCalled',false);
 end if;
 if not exists(select 1 from auth.users u where u.id=p_user
   and not u.is_anonymous and u.deleted_at is null
   and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
   and (u.banned_until is null or u.banned_until<clock_timestamp()))
  or exists(select 1 from public.platform_admins a where a.user_id=p_user and a.active)
 then raise exception 'NETWORK_PAYOUT_BENEFICIARY_NOT_ELIGIBLE' using errcode='42501';end if;
 -- This is a reservation gate only. The bank payout switch is independently
 -- hard-disabled in V1.1030; terms must actually have been approved.
 if not exists(select 1 from public.network_fee_package_policy_v1_1030 p
   where p.singleton and p.accrual_enabled and p.terms_approved_at is not null
     and p.terms_reference is not null and p.payouts_enabled=false)
 then raise exception 'NETWORK_PAYOUT_TERMS_OR_POLICY_NOT_READY' using errcode='42501';end if;
 v_needed:=p_amount_cents*1000000;
 -- The per-user advisory lock serializes concurrent reservations. Every
 -- allocation is source-backed, not based on displayed rounded balances.
 for v_award in
   select a.kind,a.source_id,a.user_id,
     (a.equal_microcents+a.inviter_microcents) as microcents
   from public.network_fee_package_awards_v1_1030 a
   join public.network_fee_package_sources_v1_1030 s using(kind,source_id)
   where a.user_id=p_user and s.state='eligible'
   order by s.matured_at,a.kind,a.source_id
 loop
   select coalesce(sum(l.amount_microcents),0) into v_used
   from public.network_fee_payout_allocations_v1_1031 l
   join public.network_fee_payout_reservations_v1_1031 r
     on r.id=l.reservation_id
   where l.kind=v_award.kind and l.source_id=v_award.source_id
     and l.user_id=p_user and r.state<>'cancelled';
   v_free:=v_award.microcents-v_used;
   if v_free<0 then raise exception 'NETWORK_PAYOUT_LEDGER_OVERALLOCATED';end if;
   v_total:=v_total+v_free;
 end loop;
 if v_total<v_needed then
   raise exception 'NETWORK_PAYOUT_INSUFFICIENT_VALIDATED_BALANCE' using errcode='22023';
 end if;
 insert into public.network_fee_payout_reservations_v1_1031
  (user_id,amount_cents,idempotency_key,created_by)
 values(p_user,p_amount_cents,p_key,p_actor) returning id into v_reservation;
 for v_award in
   select a.kind,a.source_id,a.user_id,
    (a.equal_microcents+a.inviter_microcents) as microcents
   from public.network_fee_package_awards_v1_1030 a
   join public.network_fee_package_sources_v1_1030 s using(kind,source_id)
   where a.user_id=p_user and s.state='eligible'
   order by s.matured_at,a.kind,a.source_id
 loop
   exit when v_needed=0;
   select coalesce(sum(l.amount_microcents),0) into v_used
   from public.network_fee_payout_allocations_v1_1031 l
   join public.network_fee_payout_reservations_v1_1031 r on r.id=l.reservation_id
   where l.kind=v_award.kind and l.source_id=v_award.source_id
     and l.user_id=p_user and r.state<>'cancelled';
   v_taken:=least(v_needed,greatest(0,v_award.microcents-v_used));
   if v_taken>0 then
     insert into public.network_fee_payout_allocations_v1_1031
       (reservation_id,kind,source_id,user_id,amount_microcents)
     values(v_reservation,v_award.kind,v_award.source_id,p_user,v_taken);
     v_needed:=v_needed-v_taken;
   end if;
 end loop;
 if v_needed<>0 then raise exception 'NETWORK_PAYOUT_RESERVATION_CONSERVATION';end if;
 return jsonb_build_object('source','network_payout_reservation_v1_1031',
    'reservationId',v_reservation,'state','reserved',
    'amountCents',p_amount_cents,'alreadyRecorded',false,
    'moneyMoved',false,'payoutProviderCalled',false);
end $fn$;

-- Cancellation is allowed only BEFORE any external dispatch exists. No external
-- transaction exists in V1.1031; settlement is deliberately not implemented.
create function public.network_fee_payout_cancel_v1_1031(
 p_actor uuid,p_reservation uuid
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare v public.network_fee_payout_reservations_v1_1031%rowtype;
begin
 if not exists(select 1 from public.platform_admins
   where user_id=p_actor and active and admin_role='superadmin')
 then raise exception 'NETWORK_PAYOUT_OWNER_ONLY' using errcode='42501';end if;
 select * into v from public.network_fee_payout_reservations_v1_1031
   where id=p_reservation for update;
 if not found then raise exception 'NETWORK_PAYOUT_RESERVATION_UNKNOWN' using errcode='22023';end if;
 -- No Pix dispatch exists in this version; an owner's cancellation can
 -- safely release a reservation under reversal review while keeping history.
 if v.state in ('reserved','reversal_review') then
   update public.network_fee_payout_reservations_v1_1031
   set state='cancelled',cancelled_by=p_actor,cancelled_at=clock_timestamp()
   where id=p_reservation;
 end if;
 return jsonb_build_object('source','network_payout_cancel_v1_1031',
    'state','cancelled','reservationId',p_reservation,
    'moneyMoved',false,'fundsReleased',true);
end $fn$;

-- A reversed source cannot remain a clean reservation. Escalate for human
-- review rather than silently recycling funds or asserting bank settlement.
create function public.network_fee_payout_watch_reversal_v1_1031()
returns trigger language plpgsql security definer
set search_path=pg_catalog as $fn$
begin
 if new.state='reversed' and old.state is distinct from new.state then
  update public.network_fee_payout_reservations_v1_1031 r
   set state='reversal_review'
   where r.state='reserved' and exists(
     select 1 from public.network_fee_payout_allocations_v1_1031 a
       where a.reservation_id=r.id
         and a.kind=new.kind and a.source_id=new.source_id);
 end if;
 return new;
end $fn$;
create trigger network_fee_payout_reversal_guard_v1_1031
 after update of state on public.network_fee_package_sources_v1_1030
 for each row execute function public.network_fee_payout_watch_reversal_v1_1031();

create function public.network_fee_payout_status_v1_1031(p_actor uuid,p_user uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $fn$
declare v_eligible bigint;v_reserved bigint;v_risks bigint;v_cnt bigint;
begin
 if not exists(select 1 from public.platform_admins
   where user_id=p_actor and active and admin_role in ('superadmin','finance'))
 then raise exception 'NETWORK_PAYOUT_READ_DENIED' using errcode='42501';end if;
 select coalesce(sum(a.equal_microcents+a.inviter_microcents),0)
 into v_eligible from public.network_fee_package_awards_v1_1030 a
 join public.network_fee_package_sources_v1_1030 s using(kind,source_id)
 where a.user_id=p_user and s.state='eligible';
 select coalesce(sum(r.amount_cents)*1000000,0),
  count(*) filter(where r.state='reversal_review'),
  count(*)
 into v_reserved,v_risks,v_cnt
 from public.network_fee_payout_reservations_v1_1031 r
 where r.user_id=p_user and r.state<>'cancelled';
 return jsonb_build_object('source','network_payout_status_v1_1031',
 'readOnly',true,'userId',p_user,
 'validatedMicrocents',v_eligible,'reservedMicrocents',v_reserved,
 'availableCents',greatest(0,floor((v_eligible-v_reserved)::numeric/1000000)::bigint),
 'reservationCount',v_cnt,'reversalReviews',v_risks,
 'payoutsEnabled',false,'bankSettlementVerified',false,
 'recipientVerified',false,'moneyMoved',false);
end $fn$;
-- Aggregated owner dashboard: never reveal user IDs, payout keys or identities.
create function public.network_fee_payout_program_overview_v1_1031(p_actor uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $fn$
declare v_count bigint;v_review bigint;v_total bigint;
begin
 if not exists(select 1 from public.platform_admins
   where user_id=p_actor and active and admin_role in ('superadmin','finance'))
 then raise exception 'NETWORK_PAYOUT_READ_DENIED' using errcode='42501';end if;
 select count(*) filter(where state<>'cancelled'),
   count(*) filter(where state='reversal_review'),
   coalesce(sum(amount_cents) filter(where state<>'cancelled'),0)
 into v_count,v_review,v_total
 from public.network_fee_payout_reservations_v1_1031;
 return jsonb_build_object('source','network_payout_overview_v1_1031',
 'readOnly',true,'activeReservations',v_count,'reversalReviews',v_review,
 'reservedCents',v_total,'payoutsEnabled',false,
 'bankSettledCents',0,'providerConfigured',false,'moneyMoved',false);
end $fn$;
revoke all on function public.network_fee_payout_reserve_v1_1031(uuid,uuid,bigint,text),
 public.network_fee_payout_cancel_v1_1031(uuid,uuid),
 public.network_fee_payout_status_v1_1031(uuid,uuid),
 public.network_fee_payout_program_overview_v1_1031(uuid),
 public.network_fee_payout_watch_reversal_v1_1031()
 from public,anon,authenticated;
grant execute on function public.network_fee_payout_reserve_v1_1031(uuid,uuid,bigint,text),
 public.network_fee_payout_cancel_v1_1031(uuid,uuid),
 public.network_fee_payout_status_v1_1031(uuid,uuid),
 public.network_fee_payout_program_overview_v1_1031(uuid) to service_role;
commit;
