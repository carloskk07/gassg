-- TAMÃO #493 / Rede V1.1030 — separate, verifiable fee-package network ledger.
-- No coupon package, merchandise, seller receipts, cashback, automatic Pix payout.
-- One network pool: 10% of verified NET fee-credit package receipts, with a
-- merchant-referrer slice INSIDE the same cap, not an additional expense.
-- RLS / RPCs are private: no direct public/anon/authenticated money writes.
begin;

create table public.network_fee_package_policy_v1_1030 (
  singleton boolean primary key default true check(singleton),
  accrual_enabled boolean not null default false,
  effective_after timestamptz not null default clock_timestamp(),
  pool_bps integer not null default 1000 check(pool_bps=1000),
  merchant_inviter_pool_bps integer not null default 2000
    check(merchant_inviter_pool_bps=2000),
  maturity_days integer not null default 7 check(maturity_days between 7 and 60),
  payouts_enabled boolean not null default false check(payouts_enabled=false),
  terms_approved_at timestamptz,
  terms_reference text check(terms_reference is null or
    (length(terms_reference) between 12 and 160 and terms_reference !~ '[<>]')),
  updated_at timestamptz not null default clock_timestamp(),
  check(not accrual_enabled or
    (terms_approved_at is not null and terms_reference is not null))
);
insert into public.network_fee_package_policy_v1_1030(singleton)
values(true) on conflict(singleton) do nothing;

-- At most one proven visit per user/hour, with a server timestamp. Never
-- infer presence from token renewal, browser tab, IP or UTM page view.
create table public.network_member_visits_v1_1030 (
 user_id uuid not null references auth.users(id) on delete cascade,
 visit_hour timestamptz not null,
 last_visit_at timestamptz not null,
 portal text not null check(portal in ('customer','merchant')),
 primary key(user_id,visit_hour),
 check(last_visit_at>=visit_hour and last_visit_at<visit_hour+interval '1 hour')
);
create index network_member_visits_recent_v1_1030_idx
 on public.network_member_visits_v1_1030(last_visit_at desc,user_id);

create table public.network_fee_package_sources_v1_1030 (
 kind text not null check(kind in ('merchant_prepaid_fee','mobility_prepaid_fee')),
 source_id uuid not null,
 buyer_user_id uuid references auth.users(id),
 merchant_id uuid references public.merchants(id),
 credit_entry_id uuid references public.merchant_fee_credit_ledger(id),
 gross_cents bigint not null check(gross_cents>0),
 net_cents bigint not null check(net_cents>0 and net_cents<=gross_cents),
 fee_credit_cents bigint not null check(fee_credit_cents>0),
 pool_microcents bigint not null check(pool_microcents>0),
 attributed_at timestamptz not null,
 closed_at timestamptz not null,
 receipt_reference text not null check(length(receipt_reference) between 8 and 240),
 state text not null default 'pending'
   check(state in ('pending','eligible','unallocated','reversed')),
 referrer_user_id uuid references auth.users(id),
 recorded_at timestamptz not null default clock_timestamp(),
 matured_at timestamptz,
 reversed_at timestamptz,
 primary key(kind,source_id),
 unique(credit_entry_id),
 check((kind='merchant_prepaid_fee' and merchant_id is not null and credit_entry_id is not null)
   or (kind='mobility_prepaid_fee' and merchant_id is null and credit_entry_id is null)),
 check(state<>'eligible' or matured_at is not null),
 check(state<>'reversed' or reversed_at is not null)
);
create index network_fee_package_source_dates_v1_1030_idx
 on public.network_fee_package_sources_v1_1030(attributed_at,kind);
create table public.network_fee_package_awards_v1_1030 (
 kind text not null,
 source_id uuid not null,
 user_id uuid not null references auth.users(id) on delete restrict,
 equal_microcents bigint not null check(equal_microcents>=0),
 inviter_microcents bigint not null default 0 check(inviter_microcents>=0),
 created_at timestamptz not null default clock_timestamp(),
 primary key(kind,source_id,user_id),
 foreign key(kind,source_id)
  references public.network_fee_package_sources_v1_1030(kind,source_id) on delete restrict,
 check(equal_microcents+inviter_microcents>0)
);
create index network_fee_package_awards_user_v1_1030_idx
 on public.network_fee_package_awards_v1_1030(user_id,created_at desc);

alter table public.network_fee_package_policy_v1_1030 enable row level security;
alter table public.network_member_visits_v1_1030 enable row level security;
alter table public.network_fee_package_sources_v1_1030 enable row level security;
alter table public.network_fee_package_awards_v1_1030 enable row level security;
revoke all on public.network_fee_package_policy_v1_1030,
 public.network_member_visits_v1_1030,
 public.network_fee_package_sources_v1_1030,
 public.network_fee_package_awards_v1_1030
 from public,anon,authenticated,service_role;

-- An authenticated Edge function must verify the JWT before calling this RPC.
-- The function verifies account permanence and does not grant rewards.
create function public.network_record_visit_v1_1030(p_user uuid,p_portal text)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare v_now timestamptz:=clock_timestamp(); v_hour timestamptz;
begin
 if p_portal not in ('customer','merchant') or p_user is null then
   raise exception 'NETWORK_VISIT_INVALID' using errcode='22023';
 end if;
 if not exists(select 1 from auth.users u where u.id=p_user
    and u.is_anonymous=false and u.deleted_at is null
    and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
    and (u.banned_until is null or u.banned_until<v_now))
   or exists(select 1 from public.platform_admins a where a.user_id=p_user and a.active)
 then return jsonb_build_object('recorded',false,'reason','ACCOUNT_NOT_ELIGIBLE');end if;
 if p_portal='merchant' and not exists(
   select 1 from public.merchant_members m where m.user_id=p_user and m.active
    and m.member_role in ('owner','manager'))
 then return jsonb_build_object('recorded',false,'reason','MERCHANT_MEMBERSHIP_REQUIRED');end if;
 v_hour:=date_trunc('hour',v_now);
 insert into public.network_member_visits_v1_1030(user_id,visit_hour,last_visit_at,portal)
 values(p_user,v_hour,v_now,p_portal)
 on conflict(user_id,visit_hour) do update
 set last_visit_at=excluded.last_visit_at,portal=excluded.portal;
 return jsonb_build_object('recorded',true,'eligibleAt',v_now,
   'moneyGranted',false,'source','network_visit_v1_1030');
end $fn$;
revoke all on function public.network_record_visit_v1_1030(uuid,text)
 from public,anon,authenticated;
grant execute on function public.network_record_visit_v1_1030(uuid,text)
 to service_role;

-- User-scoped financial statement: microcents do not become whole cents by
-- rounding up. "Eligible" is validated but NOT transferable; Pix payout OFF.
create function public.network_user_fee_package_summary_v1_1030(p_user uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $fn$
declare v_pending bigint;v_matured bigint;v_reversed bigint;v_sources bigint;
 v_activity timestamptz;v_policy record;
begin
 select * into v_policy from public.network_fee_package_policy_v1_1030 where singleton;
 select coalesce(sum(a.equal_microcents+a.inviter_microcents)
   filter(where s.state='pending'),0),
   coalesce(sum(a.equal_microcents+a.inviter_microcents)
   filter(where s.state='eligible'),0),
   coalesce(sum(a.equal_microcents+a.inviter_microcents)
   filter(where s.state='reversed'),0),
   count(*)
 into v_pending,v_matured,v_reversed,v_sources
 from public.network_fee_package_awards_v1_1030 a
 join public.network_fee_package_sources_v1_1030 s using(kind,source_id)
 where a.user_id=p_user;
 select max(last_visit_at) into v_activity
 from public.network_member_visits_v1_1030 where user_id=p_user;
 return jsonb_build_object('source','network_fee_package_user_v1_1030',
  'readOnly',true,'payoutsEnabled',false,
  'accrualEnabled',coalesce(v_policy.accrual_enabled,false),
  'pendingMicrocents',v_pending,'validatedMicrocents',v_matured,
  'reversedMicrocents',v_reversed,
  'pendingCents',floor(v_pending::numeric/1000000)::bigint,
  'validatedCents',floor(v_matured::numeric/1000000)::bigint,
  'awardSources',v_sources,'lastVerifiedVisitAt',v_activity);
end $fn$;
revoke all on function public.network_user_fee_package_summary_v1_1030(uuid)
 from public,anon,authenticated;
grant execute on function public.network_user_fee_package_summary_v1_1030(uuid)
 to service_role;

-- Administration: read-only aggregate, no identities or raw PII in results.
create function public.network_fee_package_admin_summary_v1_1030(p_actor uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $fn$
declare v_total bigint;v_pending bigint;v_eligible bigint;v_reversed bigint;
 v_unallocated bigint;v_sources bigint;v_members bigint;v_policy record;
begin
 if not exists(select 1 from public.platform_admins a where a.user_id=p_actor
   and a.active and a.admin_role in ('superadmin','finance'))
 then raise exception 'NETWORK_ADMIN_DENIED' using errcode='42501';end if;
 select * into v_policy from public.network_fee_package_policy_v1_1030 where singleton;
 select count(*),coalesce(sum(pool_microcents),0),
   coalesce(sum(pool_microcents) filter(where state='pending'),0),
   coalesce(sum(pool_microcents) filter(where state='eligible'),0),
   coalesce(sum(pool_microcents) filter(where state='reversed'),0),
   coalesce(sum(pool_microcents) filter(where state='unallocated'),0)
 into v_sources,v_total,v_pending,v_eligible,v_reversed,v_unallocated
 from public.network_fee_package_sources_v1_1030;
 select count(distinct user_id) into v_members from public.network_member_visits_v1_1030
  where last_visit_at>clock_timestamp()-interval '24 hours';
 return jsonb_build_object('source','network_fee_package_admin_v1_1030',
  'readOnly',true,'payoutsEnabled',false,
  'accrualEnabled',coalesce(v_policy.accrual_enabled,false),
  'poolBps',1000,'sourceCount',v_sources,'membersActive24h',v_members,
  'totalPoolMicrocents',v_total,
  'pendingMicrocents',v_pending,'validatedMicrocents',v_eligible,
  'reversedMicrocents',v_reversed,'unallocatedMicrocents',v_unallocated,
  'effectiveAfter',v_policy.effective_after,
  'requiresTermsApproval',v_policy.terms_approved_at is null);
end $fn$;
revoke all on function public.network_fee_package_admin_summary_v1_1030(uuid)
 from public,anon,authenticated;
grant execute on function public.network_fee_package_admin_summary_v1_1030(uuid)
 to service_role;

commit;
