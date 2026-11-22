-- TAMÃO V1.1155: segregate pool redemption by actual commercial terms.
-- Reserve/accrual for advertising stays ON; no automatic payouts are enabled.
-- Each fund source needs its OWN published and approved terms before any
-- withdrawal/offset, preventing fee-package approval from unlocking Ads.
-- This is a financially protective migration, not operator approval.
begin;

alter table public.network_ads_pool_policy_v1_1154
 add column redemption_terms_reference text,
 add column redemption_terms_approved_at timestamptz;
alter table public.network_ads_pool_policy_v1_1154
 add constraint network_ads_pool_redemption_terms_v1_1155_check
 check (
   (redemption_terms_reference is null and redemption_terms_approved_at is null)
   or (redemption_terms_reference is not null and redemption_terms_approved_at is not null
     and length(redemption_terms_reference) between 12 and 160
     and redemption_terms_reference !~ '[<>]')
 );

-- This owner action records approval only when a genuinely published,
-- versioned and legally reviewed terms reference is provided externally.
create function public.network_ads_pool_terms_set_v1_1155(
 p_actor uuid,p_approved boolean,p_reference text default null
) returns jsonb language plpgsql security definer
set search_path=pg_catalog as $terms$
declare v_ref text:=nullif(btrim(coalesce(p_reference,'')),'');
begin
 if not exists(select 1 from public.platform_admins a
    where a.user_id=p_actor and a.active and a.admin_role='superadmin')
 then raise exception 'ADS_POOL_TERMS_OWNER_ONLY' using errcode='42501';end if;
 if p_approved is null or
    (p_approved and (v_ref is null or length(v_ref) not between 12 and 160
      or v_ref ~ '[<>]')) then
    raise exception 'ADS_POOL_PUBLISHED_TERMS_REQUIRED' using errcode='22023';
 end if;
 update public.network_ads_pool_policy_v1_1154
 set redemption_terms_approved_at=case when p_approved then clock_timestamp() else null end,
     redemption_terms_reference=case when p_approved then v_ref else null end,
     updated_at=clock_timestamp()
 where singleton;
 return jsonb_build_object('source','network_ads_pool_terms_v1_1155',
   'termsApproved',p_approved,'moneyMoved',false,'automaticPayouts',false);
end $terms$;
revoke all on function public.network_ads_pool_terms_set_v1_1155(uuid,boolean,text)
 from public,anon,authenticated;
grant execute on function public.network_ads_pool_terms_set_v1_1155(uuid,boolean,text) to service_role;

-- For each ledger source, only the corresponding approved commercial policy
-- can authorize REDEMPTION, independently of how accrual was calculated.
create function public.network_source_redeemable_v1_1155(p_kind text)
 returns boolean language sql stable security definer
 set search_path=pg_catalog as $source$
 select case
 when p_kind in ('merchant_prepaid_fee','mobility_prepaid_fee') then
  exists(select 1 from public.network_fee_package_policy_v1_1030 p
    where p.singleton and p.accrual_enabled and p.terms_approved_at is not null
      and p.terms_reference is not null)
 when p_kind in ('ads_verified_view','ads_fixed_campaign') then
  exists(select 1 from public.network_ads_pool_policy_v1_1154 p
    where p.singleton and p.accrual_enabled
      and p.redemption_terms_approved_at is not null
      and p.redemption_terms_reference is not null and p.payouts_enabled=false)
 else false end
 $source$;
revoke all on function public.network_source_redeemable_v1_1155(text)
 from public,anon,authenticated;
grant execute on function public.network_source_redeemable_v1_1155(text) to service_role;

CREATE OR REPLACE FUNCTION public.network_manual_payout_request_v1_1034(p_user uuid, p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
 if v_min is null or not (
   exists(select 1 from public.network_fee_package_policy_v1_1030
    where singleton and accrual_enabled and terms_approved_at is not null and terms_reference is not null)
   or exists(select 1 from public.network_ads_pool_policy_v1_1154
    where singleton and accrual_enabled and redemption_terms_approved_at is not null
      and redemption_terms_reference is not null))
 then raise exception 'MANUAL_PAYOUT_PROGRAM_OR_MINIMUM_NOT_READY'
  using errcode='42501';end if;
 for v_award in
 select a.kind,a.source_id,a.user_id,
   (a.equal_microcents+a.inviter_microcents) as value
 from public.network_fee_package_awards_v1_1030 a
 join public.network_fee_package_sources_v1_1030 s using(kind,source_id)
 where a.user_id=p_user and s.state='eligible' and public.network_source_redeemable_v1_1155(a.kind)
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
 where a.user_id=p_user and s.state='eligible' and public.network_source_redeemable_v1_1155(a.kind)
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
end $function$
;
CREATE OR REPLACE FUNCTION public.network_manual_payout_status_v1_1034(p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare v_min bigint;v_total bigint;v_reserved bigint;v_offsets bigint;
 v_accrual boolean;v_active record;v_identity boolean;
begin
 select p.minimum_cents into v_min from public.network_manual_payout_policy_v1_1034 p where singleton;
 select (
   exists(select 1 from public.network_fee_package_policy_v1_1030 p
     where p.singleton and p.accrual_enabled and p.terms_approved_at is not null
       and p.terms_reference is not null)
   or exists(select 1 from public.network_ads_pool_policy_v1_1154 p
     where p.singleton and p.accrual_enabled and p.redemption_terms_approved_at is not null
       and p.redemption_terms_reference is not null)
 ) into v_accrual;
 select coalesce(sum(a.equal_microcents+a.inviter_microcents),0)
  into v_total from public.network_fee_package_awards_v1_1030 a
  join public.network_fee_package_sources_v1_1030 s using(kind,source_id)
  where a.user_id=p_user and s.state='eligible' and public.network_source_redeemable_v1_1155(a.kind);
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
  'adsAccrualEnabled',(select accrual_enabled from public.network_ads_pool_policy_v1_1154 where singleton),
  'adsTermsApproved',(select redemption_terms_approved_at is not null from public.network_ads_pool_policy_v1_1154 where singleton),
  'beneficiaryVerified',v_identity,
  'availableCents',greatest(0,floor((v_total-v_reserved-v_offsets)::numeric/1000000)::bigint),
  'canRequest',coalesce(v_accrual,false) and v_min is not null
    and floor((v_total-v_reserved-v_offsets)::numeric/1000000)>=coalesce(v_min,10000001)
    and (v_active.id is null or v_active.state not in('requested','approved','review')),
  'request',case when v_active.id is null then null else jsonb_build_object(
    'requestId',v_active.id,'state',v_active.state,'amountCents',v_active.amount_cents,
    'requestedAt',v_active.requested_at,'approvedAt',v_active.approved_at,'dueAt',v_active.due_at) end);
end $function$
;
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
 where a.user_id=p_user and s.state='eligible' and public.network_source_redeemable_v1_1155(a.kind);
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
end $function$
;
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
   where a.user_id=p_user and s.state='eligible' and public.network_source_redeemable_v1_1155(a.kind)
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
   where a.user_id=p_user and s.state='eligible' and public.network_source_redeemable_v1_1155(a.kind)
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
end $function$
;
CREATE OR REPLACE FUNCTION public.network_fee_offset_prepare_v1_1032(p_user uuid, p_merchant uuid, p_plan text, p_amount_cents bigint, p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
   where a.user_id=p_user and s.state='eligible' and public.network_source_redeemable_v1_1155(a.kind)
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
   where a.user_id=p_user and s.state='eligible' and public.network_source_redeemable_v1_1155(a.kind)
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
end $function$
;
CREATE OR REPLACE FUNCTION public.network_fee_offset_status_v1_1032(p_user uuid, p_merchant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
 where a.user_id=p_user and s.state='eligible' and public.network_source_redeemable_v1_1155(a.kind);
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
end $function$
;
CREATE OR REPLACE FUNCTION public.network_ads_pool_admin_summary_v1_1154(p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare v_policy record; v_rows jsonb;
begin
 if not exists(select 1 from public.platform_admins a where a.user_id=p_actor
    and a.active and a.admin_role in ('superadmin','finance')) then
    raise exception 'ADS_POOL_ADMIN_DENIED' using errcode='42501';
 end if;
 select * into strict v_policy from public.network_ads_pool_policy_v1_1154 where singleton;
 select coalesce(jsonb_agg(jsonb_build_object(
     'kind',kind,'receipts',receipts,'poolMicrocents',total,
     'pendingMicrocents',pending,'validatedMicrocents',eligible,
     'reversedMicrocents',reversed,'unallocatedMicrocents',unallocated
   ) order by kind),'[]'::jsonb) into v_rows
 from (
  select kind,count(*) receipts,sum(pool_microcents) total,
   coalesce(sum(pool_microcents) filter(where state='pending'),0) pending,
   coalesce(sum(pool_microcents) filter(where state='eligible'),0) eligible,
   coalesce(sum(pool_microcents) filter(where state='reversed'),0) reversed,
   coalesce(sum(pool_microcents) filter(where state='unallocated'),0) unallocated
   from public.network_fee_package_sources_v1_1030
   where kind in ('ads_verified_view','ads_fixed_campaign') group by kind
 ) x;
 return jsonb_build_object('source','network_ads_pool_admin_v1_1154',
  'readOnly',true,'accrualEnabled',v_policy.accrual_enabled,
  'poolBps',1000,'payoutsEnabled',false,'fundedBy','verified_ad_revenue',
  'requiresTermsApproval',(v_policy.redemption_terms_approved_at is null),
  'redemptionTermsApproved',v_policy.redemption_terms_approved_at is not null,
  'termsReference',v_policy.redemption_terms_reference,'sources',v_rows);
end $function$
;
CREATE OR REPLACE FUNCTION public.network_user_fee_package_summary_v1_1030(p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
  'adsAccrualEnabled',(select accrual_enabled from public.network_ads_pool_policy_v1_1154 where singleton),
  'adsRedemptionTermsApproved',(select redemption_terms_approved_at is not null from public.network_ads_pool_policy_v1_1154 where singleton),
  'pendingMicrocents',v_pending,'validatedMicrocents',v_matured,
  'reversedMicrocents',v_reversed,
  'pendingCents',floor(v_pending::numeric/1000000)::bigint,
  'validatedCents',floor(v_matured::numeric/1000000)::bigint,
  'awardSources',v_sources,'lastVerifiedVisitAt',v_activity);
end $function$
;

-- SECURITY DEFINER functions are invoked from authenticated Edge endpoints
-- and cannot be called by anon/authenticated directly. Every owner action
-- still verifies the superadmin in database.
revoke all on function public.network_manual_payout_request_v1_1034(uuid,text),
 public.network_manual_payout_status_v1_1034(uuid),
 public.network_fee_payout_status_v1_1031(uuid,uuid),
 public.network_fee_payout_reserve_v1_1031(uuid,uuid,bigint,text),
 public.network_fee_offset_prepare_v1_1032(uuid,uuid,text,bigint,text),
 public.network_fee_offset_status_v1_1032(uuid,uuid),
 public.network_ads_pool_admin_summary_v1_1154(uuid),
 public.network_user_fee_package_summary_v1_1030(uuid)
 from public,anon,authenticated;
grant execute on function public.network_manual_payout_request_v1_1034(uuid,text),
 public.network_manual_payout_status_v1_1034(uuid),
 public.network_fee_payout_status_v1_1031(uuid,uuid),
 public.network_fee_payout_reserve_v1_1031(uuid,uuid,bigint,text),
 public.network_fee_offset_prepare_v1_1032(uuid,uuid,text,bigint,text),
 public.network_fee_offset_status_v1_1032(uuid,uuid),
 public.network_ads_pool_admin_summary_v1_1154(uuid),
 public.network_user_fee_package_summary_v1_1030(uuid)
 to service_role;
commit;