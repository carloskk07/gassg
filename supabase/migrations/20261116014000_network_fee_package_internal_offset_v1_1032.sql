-- TAMÃO #493 V1.1032 — Rede: real internal award offset plus exact external Pix.
-- No inter-user transfers, no cash payout, no fabricated provider receipt.
create table public.network_fee_package_offsets_v1_1032(
 id uuid primary key default gen_random_uuid(),
 payment_request_id uuid not null unique references public.merchant_billing_payment_requests(id) on delete restrict,
 user_id uuid not null references auth.users(id) on delete restrict,
 merchant_id uuid not null references public.merchants(id) on delete restrict,
 plan_key text not null references public.merchant_billing_plans(plan_key),
 amount_cents bigint not null check(amount_cents between 100 and 10000000),
 idempotency_key text not null unique check(length(idempotency_key) between 12 and 120),
 state text not null default 'reserved' check(state in('reserved','applied','cancelled','reversal_review')),
 created_at timestamptz not null default clock_timestamp(),
 applied_at timestamptz,
 cancelled_at timestamptz,
 review_at timestamptz
);
create table public.network_fee_package_offset_allocations_v1_1032(
 offset_id uuid not null references public.network_fee_package_offsets_v1_1032(id) on delete restrict,
 kind text not null,source_id uuid not null,user_id uuid not null,
 amount_microcents bigint not null check(amount_microcents>0),
 primary key(offset_id,kind,source_id,user_id),
 foreign key(kind,source_id,user_id)
  references public.network_fee_package_awards_v1_1030(kind,source_id,user_id) on delete restrict
);
create index network_fee_offsets_user_v1_1032 on public.network_fee_package_offsets_v1_1032(user_id,state);
create index network_fee_offset_alloc_source_v1_1032
 on public.network_fee_package_offset_allocations_v1_1032(kind,source_id,user_id);
alter table public.network_fee_package_offsets_v1_1032 enable row level security;
alter table public.network_fee_package_offset_allocations_v1_1032 enable row level security;
revoke all on public.network_fee_package_offsets_v1_1032,
 public.network_fee_package_offset_allocations_v1_1032 from public,anon,authenticated,service_role;
grant select on public.network_fee_package_offsets_v1_1032,
 public.network_fee_package_offset_allocations_v1_1032 to service_role;

-- Balance is read only; the service endpoint authenticates the caller separately.
create function public.network_fee_offset_status_v1_1032(p_user uuid,p_merchant uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare v_valid bigint;v_reserved bigint;v_offset bigint;v_enabled boolean;
begin
 if not exists(select 1 from public.merchant_members m
   where m.user_id=p_user and m.merchant_id=p_merchant and m.active and m.member_role in('owner','manager'))
 then raise exception 'NETWORK_OFFSET_ACCESS_DENIED' using errcode='42501';end if;
 select p.accrual_enabled and p.terms_approved_at is not null and p.terms_reference is not null
 into v_enabled from public.network_fee_package_policy_v1_1030 p where p.singleton;
 select coalesce(sum(a.equal_microcents+a.inviter_microcents),0) into v_valid
 from public.network_fee_package_awards_v1_1030 a
 join public.network_fee_package_sources_v1_1030 s using(kind,source_id)
 where a.user_id=p_user and s.state='eligible';
 select coalesce(sum(r.amount_cents)*1000000,0) into v_reserved
 from public.network_fee_payout_reservations_v1_1031 r
 where r.user_id=p_user and r.state<>'cancelled';
 select coalesce(sum(o.amount_cents)*1000000,0) into v_offset
 from public.network_fee_package_offsets_v1_1032 o
 where o.user_id=p_user and o.state<>'cancelled';
 return jsonb_build_object('source','network_offset_status_v1_1032',
   'readOnly',true,'merchantId',p_merchant,'userId',p_user,
   'enabled',coalesce(v_enabled,false),
   'validatedCents',floor(v_valid::numeric/1000000)::bigint,
   'availableCents',case when v_enabled then greatest(0,floor((v_valid-v_reserved-v_offset)::numeric/1000000)::bigint) else 0 end,
   'reservedPayoutCents',v_reserved/1000000,'usedOrReservedOffsetCents',v_offset/1000000,
   'moneyMoved',false);
end $fn$;

-- Source-backed, atomic partial payment. A minimum R$1 real Pix remains.
create function public.network_fee_offset_prepare_v1_1032(
 p_user uuid,p_merchant uuid,p_plan text,p_amount_cents bigint,p_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare v_existing public.network_fee_package_offsets_v1_1032%rowtype;
 v_plan public.merchant_billing_plans%rowtype;
 v_account public.merchant_billing_accounts%rowtype;
 v_award record;v_used bigint;v_offset_used bigint;v_total bigint:=0;
 v_need bigint;v_take bigint;v_request uuid;v_id uuid;
begin
 if p_user is null or p_merchant is null or p_plan is null
 or p_amount_cents is null or p_amount_cents not between 100 and 10000000
 or p_key is null or length(p_key) not between 12 and 120
 or p_key !~ '^[A-Za-z0-9._:-]+$'
 then raise exception 'NETWORK_OFFSET_INVALID' using errcode='22023';end if;
 if not exists(select 1 from public.merchant_members m
    where m.user_id=p_user and m.merchant_id=p_merchant
      and m.active and m.member_role in('owner','manager'))
 or not exists(select 1 from auth.users u where u.id=p_user
      and not u.is_anonymous and u.deleted_at is null
      and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
      and (u.banned_until is null or u.banned_until<clock_timestamp()))
 or exists(select 1 from public.platform_admins a where a.user_id=p_user and a.active)
 then raise exception 'NETWORK_OFFSET_BENEFICIARY_DENIED' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('network-payout-user:'||p_user::text,0));
 select * into v_existing from public.network_fee_package_offsets_v1_1032
 where idempotency_key=p_key for update;
 if found then
   if v_existing.user_id<>p_user or v_existing.merchant_id<>p_merchant
     or v_existing.plan_key<>p_plan or v_existing.amount_cents<>p_amount_cents
   then raise exception 'NETWORK_OFFSET_REPLAY_CONFLICT' using errcode='23505';end if;
   return jsonb_build_object('source','network_offset_prepare_v1_1032',
    'ok',true,'paymentRequestId',v_existing.payment_request_id,
    'merchantId',p_merchant,'planKey',p_plan,'offsetCents',p_amount_cents,
    'state',v_existing.state,'alreadyRecorded',true,'moneyMoved',false);
 end if;
 if not exists(select 1 from public.network_fee_package_policy_v1_1030 p
    where p.singleton and p.accrual_enabled and p.terms_approved_at is not null
      and p.terms_reference is not null)
 then raise exception 'NETWORK_OFFSET_TERMS_NOT_READY' using errcode='42501';end if;
 select * into v_plan from public.merchant_billing_plans
 where plan_key=p_plan and active and billing_mode='prepaid_credit' for share;
 if not found or p_amount_cents>v_plan.purchase_amount_cents-100
 then raise exception 'NETWORK_OFFSET_PLAN_INVALID' using errcode='22023';end if;
 -- Shared merchant locks ensure an offset cannot race an already generated Pix.
 perform pg_advisory_xact_lock(hashtextextended('merchant-billing-pix:'||p_merchant::text,0));
 perform pg_advisory_xact_lock(hashtextextended('merchant-billing-request:'||p_merchant::text,0));
 if exists(select 1 from public.merchant_billing_payment_requests r
    where r.merchant_id=p_merchant and r.request_kind='package_purchase' and r.status='pending')
 then raise exception 'PACKAGE_REQUEST_ALREADY_PENDING' using errcode='40001';end if;
 select * into v_account from public.merchant_billing_accounts
    where merchant_id=p_merchant for update;
 if v_account.sales_hold=true then raise exception 'NETWORK_OFFSET_MERCHANT_HOLD' using errcode='40001';end if;
 if v_account.credit_balance_cents>0 and v_account.plan_key<>p_plan
 and exists(select 1 from public.merchant_billing_plans prev
    where prev.plan_key=v_account.plan_key and prev.billing_mode='prepaid_credit'
      and prev.platform_fee_bps<v_plan.platform_fee_bps)
 then raise exception 'PREPAID_PLAN_DOWNGRADE_WITH_ACTIVE_CREDIT' using errcode='40001';end if;
 for v_award in
   select a.kind,a.source_id,a.user_id,a.equal_microcents+a.inviter_microcents as value
   from public.network_fee_package_awards_v1_1030 a
   join public.network_fee_package_sources_v1_1030 s using(kind,source_id)
   where a.user_id=p_user and s.state='eligible'
   order by s.matured_at,a.kind,a.source_id
   for share of s
 loop
   select coalesce(sum(l.amount_microcents),0) into v_used
   from public.network_fee_payout_allocations_v1_1031 l
   join public.network_fee_payout_reservations_v1_1031 r on r.id=l.reservation_id
   where l.kind=v_award.kind and l.source_id=v_award.source_id
      and l.user_id=p_user and r.state<>'cancelled';
   select coalesce(sum(l.amount_microcents),0) into v_offset_used
   from public.network_fee_package_offset_allocations_v1_1032 l
   join public.network_fee_package_offsets_v1_1032 o on o.id=l.offset_id
   where l.kind=v_award.kind and l.source_id=v_award.source_id
      and l.user_id=p_user and o.state<>'cancelled';
   if v_award.value<v_used+v_offset_used then raise exception 'NETWORK_OFFSET_OVERALLOCATED';end if;
   v_total:=v_total+v_award.value-v_used-v_offset_used;
 end loop;
 v_need:=p_amount_cents*1000000;
 if v_total<v_need then raise exception 'NETWORK_OFFSET_INSUFFICIENT_BALANCE' using errcode='22023';end if;
 insert into public.merchant_billing_payment_requests(
    merchant_id,request_kind,plan_key,expected_amount_cents,
    platform_fee_bps_snapshot,credit_grant_cents_snapshot,merchant_reference,requested_by)
 values(p_merchant,'package_purchase',p_plan,v_plan.purchase_amount_cents-p_amount_cents,
    v_plan.platform_fee_bps,v_plan.credit_grant_cents,
    'network-fee-offset:'||gen_random_uuid()::text,p_user)
 returning id into v_request;
 insert into public.network_fee_package_offsets_v1_1032(
    payment_request_id,user_id,merchant_id,plan_key,amount_cents,idempotency_key)
 values(v_request,p_user,p_merchant,p_plan,p_amount_cents,p_key)
 returning id into v_id;
 for v_award in
   select a.kind,a.source_id,a.user_id,a.equal_microcents+a.inviter_microcents as value
   from public.network_fee_package_awards_v1_1030 a
   join public.network_fee_package_sources_v1_1030 s using(kind,source_id)
   where a.user_id=p_user and s.state='eligible'
   order by s.matured_at,a.kind,a.source_id
 loop
   exit when v_need=0;
   select coalesce(sum(l.amount_microcents),0) into v_used
   from public.network_fee_payout_allocations_v1_1031 l
   join public.network_fee_payout_reservations_v1_1031 r on r.id=l.reservation_id
   where l.kind=v_award.kind and l.source_id=v_award.source_id
     and l.user_id=p_user and r.state<>'cancelled';
   select coalesce(sum(l.amount_microcents),0) into v_offset_used
   from public.network_fee_package_offset_allocations_v1_1032 l
   join public.network_fee_package_offsets_v1_1032 o on o.id=l.offset_id
   where l.kind=v_award.kind and l.source_id=v_award.source_id
     and l.user_id=p_user and o.state<>'cancelled';
   v_take:=least(v_need,greatest(0,v_award.value-v_used-v_offset_used));
   if v_take>0 then
     insert into public.network_fee_package_offset_allocations_v1_1032
       (offset_id,kind,source_id,user_id,amount_microcents)
     values(v_id,v_award.kind,v_award.source_id,p_user,v_take);
     v_need:=v_need-v_take;
   end if;
 end loop;
 if v_need<>0 then raise exception 'NETWORK_OFFSET_CONSERVATION';end if;
 return jsonb_build_object('source','network_offset_prepare_v1_1032',
   'ok',true,'paymentRequestId',v_request,'merchantId',p_merchant,'planKey',p_plan,
   'offsetCents',p_amount_cents,
   'remainingPixCents',v_plan.purchase_amount_cents-p_amount_cents,
   'state','reserved','alreadyRecorded',false,'moneyMoved',false);
end $fn$;

create function public.network_fee_offset_sync_v1_1032()
returns trigger language plpgsql security definer set search_path=pg_catalog as $fn$
declare v public.network_fee_package_offsets_v1_1032%rowtype;
begin
 if old.status is not distinct from new.status or old.status<>'pending' then return new;end if;
 select * into v from public.network_fee_package_offsets_v1_1032
 where payment_request_id=new.id for update;
 if not found then return new;end if;
 if new.status='approved' then
   if v.state<>'reserved' or new.approval_source<>'provider_event'
      or new.auto_applied is distinct from true or new.provider_payment_event_id is null
      or new.expected_amount_cents+v.amount_cents<>
        (select p.purchase_amount_cents from public.merchant_billing_plans p where p.plan_key=new.plan_key)
      or exists(select 1 from public.network_fee_package_offset_allocations_v1_1032 a
        join public.network_fee_package_sources_v1_1030 s using(kind,source_id)
        where a.offset_id=v.id and s.state<>'eligible')
   then raise exception 'NETWORK_OFFSET_NOT_VERIFIED' using errcode='42501';end if;
   update public.network_fee_package_offsets_v1_1032
      set state='applied',applied_at=clock_timestamp() where id=v.id;
 elsif new.status in ('cancelled','rejected') then
   if v.state not in('reserved','reversal_review')
      or exists(select 1 from public.merchant_billing_provider_charges c
       where c.payment_request_id=new.id and c.status='completed')
      or exists(select 1 from public.merchant_billing_payment_events e
       where e.payment_request_id=new.id and e.status in('matched_exact','applied'))
   then raise exception 'NETWORK_OFFSET_PAID_REVIEW_REQUIRED' using errcode='40001';end if;
   update public.network_fee_package_offsets_v1_1032
     set state='cancelled',cancelled_at=clock_timestamp() where id=v.id;
 end if;
 return new;
end $fn$;
create trigger network_fee_offset_sync_trg_v1_1032
after update of status on public.merchant_billing_payment_requests
for each row execute function public.network_fee_offset_sync_v1_1032();

create function public.network_fee_offset_source_reversal_v1_1032()
returns trigger language plpgsql security definer set search_path=pg_catalog as $fn$
begin
 if new.state='reversed' and old.state is distinct from new.state then
   update public.network_fee_package_offsets_v1_1032 o
     set state='reversal_review',review_at=clock_timestamp()
   where o.state in('reserved','applied') and exists(
     select 1 from public.network_fee_package_offset_allocations_v1_1032 a
       where a.offset_id=o.id and a.kind=new.kind and a.source_id=new.source_id);
   update public.merchant_billing_accounts b
     set sales_hold=true,sales_hold_reason='network_offset_reversal_review',
       sales_hold_at=clock_timestamp(),updated_at=clock_timestamp()
   where exists(select 1 from public.network_fee_package_offsets_v1_1032 o
     where o.merchant_id=b.merchant_id and o.state='reversal_review'
       and o.applied_at is not null);
 end if;
 return new;
end $fn$;
create trigger network_fee_offset_source_reversal_trg_v1_1032
after update of state on public.network_fee_package_sources_v1_1030
for each row execute function public.network_fee_offset_source_reversal_v1_1032();

create function public.network_fee_offset_refund_v1_1032()
returns trigger language plpgsql security definer set search_path=pg_catalog as $fn$
begin
 if new.payment_request_id is not null and new.amount_cents>0
    and new.status<>'ignored_unrelated' then
    update public.network_fee_package_offsets_v1_1032 o
      set state='reversal_review',review_at=clock_timestamp()
    where o.payment_request_id=new.payment_request_id and o.state='applied';
    update public.merchant_billing_accounts b
      set sales_hold=true,sales_hold_reason='network_offset_refund_review',
        sales_hold_at=clock_timestamp(),updated_at=clock_timestamp()
    where exists(select 1 from public.network_fee_package_offsets_v1_1032 o
      where o.payment_request_id=new.payment_request_id
       and o.merchant_id=b.merchant_id and o.state='reversal_review'
       and o.applied_at is not null);
 end if;
 return new;
end $fn$;
create trigger network_fee_offset_refund_trg_v1_1032
after insert or update of status,payment_request_id on public.merchant_billing_payment_refunds
for each row execute function public.network_fee_offset_refund_v1_1032();

create function public.network_fee_offset_provider_charge_gate_v1_1032()
returns trigger language plpgsql security definer set search_path=pg_catalog as $fn$
begin
 if exists(select 1 from public.network_fee_package_offsets_v1_1032 o
   where o.payment_request_id=new.payment_request_id and o.state<>'reserved')
 then raise exception 'NETWORK_OFFSET_REVERSED_CANNOT_CHARGE' using errcode='40001';end if;
 return new;
end $fn$;
create trigger network_fee_offset_provider_charge_guard_v1_1032
before insert on public.merchant_billing_provider_charges
for each row execute function public.network_fee_offset_provider_charge_gate_v1_1032();

-- A reward allocated to a Pix offset is no longer reservable for bank payout.
CREATE OR REPLACE FUNCTION public.network_fee_payout_reserve_v1_1031(p_actor uuid, p_user uuid, p_amount_cents bigint, p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
 v_existing public.network_fee_payout_reservations_v1_1031%rowtype;
 v_reservation uuid;
 v_needed bigint;v_free bigint;v_used bigint;v_taken bigint;v_offset_used bigint;
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
   select coalesce(sum(l.amount_microcents),0) into v_offset_used
   from public.network_fee_package_offset_allocations_v1_1032 l
   join public.network_fee_package_offsets_v1_1032 o on o.id=l.offset_id
   where l.kind=v_award.kind and l.source_id=v_award.source_id
     and l.user_id=p_user and o.state<>'cancelled';
   v_used:=v_used+v_offset_used;
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
   select coalesce(sum(l.amount_microcents),0) into v_offset_used
   from public.network_fee_package_offset_allocations_v1_1032 l
   join public.network_fee_package_offsets_v1_1032 o on o.id=l.offset_id
   where l.kind=v_award.kind and l.source_id=v_award.source_id
     and l.user_id=p_user and o.state<>'cancelled';
   v_used:=v_used+v_offset_used;
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
end $function$;

CREATE OR REPLACE FUNCTION public.network_fee_payout_status_v1_1031(p_actor uuid, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare v_eligible bigint;v_reserved bigint;v_risks bigint;v_cnt bigint;v_offset bigint;
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
 select coalesce(sum(o.amount_cents)*1000000,0) into v_offset
 from public.network_fee_package_offsets_v1_1032 o
 where o.user_id=p_user and o.state<>'cancelled';
 v_reserved:=v_reserved+v_offset;
 return jsonb_build_object('source','network_payout_status_v1_1031',
 'readOnly',true,'userId',p_user,
 'validatedMicrocents',v_eligible,'reservedMicrocents',v_reserved,'internalOffsetMicrocents',v_offset,
 'availableCents',greatest(0,floor((v_eligible-v_reserved)::numeric/1000000)::bigint),
 'reservationCount',v_cnt,'reversalReviews',v_risks,
 'payoutsEnabled',false,'bankSettlementVerified',false,
 'recipientVerified',false,'moneyMoved',false);
end $function$;

-- Only a real provider-confirmed Pix remainder may approve the mixed package.
CREATE OR REPLACE FUNCTION tamao_billing_private.resolve_merchant_billing_payment_request(p_actor_user_id uuid, p_payment_request_id uuid, p_action text, p_reference text, p_idempotency_key text, p_request_hash text, p_automatic_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_role text;
  v_action public.action_requests%rowtype;
  v_request public.merchant_billing_payment_requests%rowtype;
  v_plan public.merchant_billing_plans%rowtype;
  v_statement public.merchant_daily_statements%rowtype;
  v_recovery public.merchant_billing_refund_recoveries%rowtype;
  v_refund public.merchant_billing_payment_refunds%rowtype;
  v_kind text:=lower(trim(coalesce(p_action,'')));
  v_reference text:=nullif(trim(p_reference),'');
  v_result jsonb;
begin
  if p_automatic_event_id is null then
    v_role:=public.platform_admin_role(p_actor_user_id);
    if v_role is null or v_role not in ('superadmin','finance') then
      raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
    end if;
  elsif p_actor_user_id is not null or v_kind<>'approve' then
    raise exception 'INVALID_AUTOMATIC_BILLING_APPLICATION' using errcode='42501';
  end if;

  if p_payment_request_id is null then
    raise exception 'PAYMENT_REQUEST_ID_REQUIRED' using errcode='22023';
  end if;

  if v_kind not in ('approve','reject') then
    raise exception 'INVALID_PAYMENT_REQUEST_ACTION' using errcode='22023';
  end if;

  if v_reference is null
     or char_length(v_reference)<3
     or char_length(v_reference)>240 then
    raise exception 'FINANCIAL_REFERENCE_REQUIRED' using errcode='22023';
  end if;

  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;

  if p_request_hash is null or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  if p_automatic_event_id is null then
  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_actor_user_id,
    'admin-ops:merchant-billing-payment-request:'||v_kind,
    p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if v_action.user_id<>p_actor_user_id
     or v_action.action_name<>
        'admin-ops:merchant-billing-payment-request:'||v_kind
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  end if;

  select *
  into v_request
  from public.merchant_billing_payment_requests
  where id=p_payment_request_id
  for update;

  if not found then
    raise exception 'PAYMENT_REQUEST_NOT_FOUND' using errcode='P0002';
  end if;

  if v_request.status<>'pending' then
    raise exception 'PAYMENT_REQUEST_ALREADY_RESOLVED' using errcode='40001';
  end if;

  if p_automatic_event_id is not null and (
       not v_request.auto_applied
       or v_request.approval_source is distinct from 'provider_event'
       or v_request.provider_payment_event_id is distinct from p_automatic_event_id
       or v_request.request_kind not in ('package_purchase','statement_payment')
       or not exists(select 1 from public.merchant_billing_payment_events e
         where e.id=p_automatic_event_id and e.status='matched_exact'
           and e.payment_request_id=v_request.id and e.merchant_id=v_request.merchant_id
           and e.amount_cents=v_request.expected_amount_cents
           and e.payment_method='pix' and e.provider='mercadopago')) then
    raise exception 'AUTOMATIC_BILLING_EVENT_NOT_VERIFIED' using errcode='42501';
  end if;

  if v_kind='reject' then
    update public.merchant_billing_payment_requests
    set status='rejected',
        resolved_by=p_actor_user_id,
        resolved_at=clock_timestamp(),
        admin_reference=v_reference,
        updated_at=clock_timestamp()
    where id=v_request.id
    returning * into v_request;

  elsif v_request.request_kind='package_purchase' then
    select *
    into v_plan
    from public.merchant_billing_plans
    where plan_key=v_request.plan_key
      and active
      and billing_mode='prepaid_credit'
    for share;

    if not found
       or v_plan.purchase_amount_cents is distinct from (
         v_request.expected_amount_cents+
         coalesce((select o.amount_cents from public.network_fee_package_offsets_v1_1032 o
           where o.payment_request_id=v_request.id and o.state='reserved'),0))
       or v_plan.credit_grant_cents is distinct from v_request.credit_grant_cents_snapshot
       or v_plan.platform_fee_bps is distinct from v_request.platform_fee_bps_snapshot then
      raise exception 'PACKAGE_TERMS_CHANGED' using errcode='40001';
    end if;

    insert into public.merchant_billing_accounts(merchant_id,plan_key)
    values(v_request.merchant_id,'flex_daily')
    on conflict(merchant_id) do nothing;

    perform pg_advisory_xact_lock(
      hashtextextended('merchant-fee-credit:'||v_request.merchant_id::text,0)
    );

    update public.merchant_billing_accounts
    set plan_key=v_plan.plan_key,
        credit_balance_cents=
          credit_balance_cents+v_request.credit_grant_cents_snapshot,
        updated_at=clock_timestamp()
    where merchant_id=v_request.merchant_id;

    insert into public.merchant_fee_credit_ledger(
      merchant_id,entry_type,amount_cents,plan_key,
      reference,created_by,payment_request_id
    )
    values(
      v_request.merchant_id,'package_credit',
      v_request.credit_grant_cents_snapshot,v_request.plan_key,
      v_reference,p_actor_user_id,v_request.id
    );

    update public.merchant_billing_payment_requests
    set status='approved',
        resolved_by=p_actor_user_id,
        resolved_at=clock_timestamp(),
        admin_reference=v_reference,
        updated_at=clock_timestamp()
    where id=v_request.id
    returning * into v_request;

  elsif v_request.request_kind='statement_payment' then
    select *
    into v_statement
    from public.merchant_daily_statements
    where id=v_request.statement_id
      and merchant_id=v_request.merchant_id
    for update;

    if not found then
      raise exception 'STATEMENT_NOT_FOUND' using errcode='P0002';
    end if;

    if v_statement.status not in ('open','overdue')
       or v_statement.amount_due_cents is distinct from
          v_request.expected_amount_cents then
      raise exception 'STATEMENT_TERMS_CHANGED' using errcode='40001';
    end if;

    -- Bind approval before marking the statement paid, so its existing
    -- cleanup trigger cannot cancel the very provider-backed request being applied.
    update public.merchant_billing_payment_requests
    set status='approved',
        resolved_by=p_actor_user_id,
        resolved_at=clock_timestamp(),
        admin_reference=v_reference,
        updated_at=clock_timestamp()
    where id=v_request.id
    returning * into v_request;


    update public.merchant_daily_statements
    set status='paid',
        paid_at=clock_timestamp(),
        waived_at=null,
        resolved_by=p_actor_user_id,
        resolution_reference=v_reference,
        updated_at=clock_timestamp()
    where id=v_statement.id;

    update public.platform_receivables
    set status='paid',
        paid_at=clock_timestamp(),
        waived_at=null,
        resolved_by=p_actor_user_id,
        resolution_reference=v_reference,
        updated_at=clock_timestamp()
    where daily_statement_id=v_statement.id
      and status='open';

  elsif v_request.request_kind='refund_recovery' then
    select rr.*
    into v_recovery
    from public.merchant_billing_refund_recoveries rr
    where rr.id=v_request.refund_recovery_id
      and rr.merchant_id=v_request.merchant_id
    for update;

    if not found
       or v_recovery.status<>'payment_pending'
       or v_recovery.recovery_payment_request_id is distinct from v_request.id
       or v_request.expected_amount_cents<=0
       or v_request.expected_amount_cents>v_recovery.outstanding_cents then
      raise exception 'REFUND_RECOVERY_TERMS_CHANGED' using errcode='40001';
    end if;

    select *
    into v_refund
    from public.merchant_billing_payment_refunds
    where id=v_recovery.refund_id
      and merchant_id=v_request.merchant_id
    for update;

    if not found or v_refund.status<>'review_required' then
      raise exception 'REFUND_RECOVERY_TERMS_CHANGED' using errcode='40001';
    end if;

    update public.merchant_billing_payment_requests
    set status='approved',
        resolved_by=p_actor_user_id,
        resolved_at=clock_timestamp(),
        admin_reference=v_reference,
        updated_at=clock_timestamp()
    where id=v_request.id
    returning * into v_request;

    update public.merchant_billing_refund_recoveries
    set outstanding_cents=outstanding_cents-v_request.expected_amount_cents,
        status=case
          when outstanding_cents-v_request.expected_amount_cents=0
            then 'recovered'
          else 'open'
        end,
        recovery_payment_request_id=case
          when outstanding_cents-v_request.expected_amount_cents=0
            then v_request.id
          else null
        end,
        recovered_by=case
          when outstanding_cents-v_request.expected_amount_cents=0
            then p_actor_user_id
          else null
        end,
        recovered_at=case
          when outstanding_cents-v_request.expected_amount_cents=0
            then clock_timestamp()
          else null
        end,
        updated_at=clock_timestamp()
    where id=v_recovery.id
    returning * into v_recovery;

    if v_recovery.outstanding_cents=0 then
      update public.merchant_billing_payment_refunds
      set status='resolved_recovered',
          resolved_by=p_actor_user_id,
          resolved_at=clock_timestamp(),
          resolution_reference=
            'recovery-payment-request:'||v_request.id::text,
          updated_at=clock_timestamp()
      where id=v_refund.id;
    else
      update public.merchant_billing_payment_refunds
      set status='review_required',
          resolved_by=null,
          resolved_at=null,
          resolution_reference=null,
          updated_at=clock_timestamp()
      where id=v_refund.id;
    end if;

  else
    raise exception 'INVALID_PAYMENT_REQUEST_KIND' using errcode='40001';
  end if;

  perform public.process_merchant_billing_enforcement();

  v_result:=jsonb_build_object(
    'ok',true,
    'paymentRequestId',v_request.id,
    'requestKind',v_request.request_kind,
    'status',v_request.status,
    'merchantId',v_request.merchant_id,
    'refundRecoveryId',v_request.refund_recovery_id,
    'position',public.merchant_financial_position(v_request.merchant_id)
  );

  if p_automatic_event_id is null then
  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    'merchant_billing_payment_request_'||v_kind,
    'merchant_billing_payment_request',
    v_request.id::text,
    jsonb_build_object(
      'merchantId',v_request.merchant_id,
      'requestKind',v_request.request_kind,
      'planKey',v_request.plan_key,
      'statementId',v_request.statement_id,
      'refundRecoveryId',v_request.refund_recovery_id,
      'expectedAmountCents',v_request.expected_amount_cents,
      'reference',v_reference
    )
  );

  end if;

  return v_result;
end;
$function$;

revoke all on function public.network_fee_offset_status_v1_1032(uuid,uuid),
 public.network_fee_offset_prepare_v1_1032(uuid,uuid,text,bigint,text),
 public.network_fee_offset_sync_v1_1032(),public.network_fee_offset_source_reversal_v1_1032(),
 public.network_fee_offset_refund_v1_1032(),public.network_fee_offset_provider_charge_gate_v1_1032()
 from public,anon,authenticated,service_role;
grant execute on function public.network_fee_offset_status_v1_1032(uuid,uuid),
 public.network_fee_offset_prepare_v1_1032(uuid,uuid,text,bigint,text) to service_role;
