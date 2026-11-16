-- TAMÃO V1.1041: first-touch network benefits across verified platform verticals.
-- Real financial payouts remain in the existing, separate manual withdrawal rails.
-- This migration never enables payments or creates synthetic receipts.
begin;

create table public.network_module_invite_bindings_v1_1041 (
  referred_user_id uuid primary key references auth.users(id) on delete cascade,
  inviter_user_id uuid not null references auth.users(id) on delete restrict,
  inviter_kind text not null check(inviter_kind in ('customer','merchant')),
  inviter_merchant_id uuid references public.merchants(id) on delete restrict,
  referral_code text not null check(referral_code ~ '^[A-Z0-9]{5,40}$'),
  bound_at timestamptz not null default clock_timestamp(),
  check(referred_user_id<>inviter_user_id),
  check((inviter_kind='customer' and inviter_merchant_id is null)
    or (inviter_kind='merchant' and inviter_merchant_id is not null))
);
create index network_module_bindings_inviter_v1_1041_idx
  on public.network_module_invite_bindings_v1_1041(inviter_user_id,bound_at);

create table public.network_module_ads_bonus_policy_v1_1041 (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  effective_after timestamptz not null default clock_timestamp(),
  inviter_bps integer not null default 500 check(inviter_bps between 0 and 500),
  maturation_days integer not null default 7 check(maturation_days between 7 and 60),
  terms_approved_at timestamptz,
  terms_reference text check(terms_reference is null or
      (length(terms_reference) between 12 and 160 and terms_reference !~ '[<>]')),
  check(not enabled or
      (inviter_bps>0 and terms_approved_at is not null and terms_reference is not null))
);
insert into public.network_module_ads_bonus_policy_v1_1041(singleton) values(true);

-- A first approved net advertising payment per referred account, no second
-- customer acquisition payout. No rights to cash until separate authorization.
create table public.network_module_ads_bonus_awards_v1_1041 (
  campaign_id uuid primary key references public.ads_independent_campaigns_v1_884(id)
    on delete restrict,
  referred_user_id uuid not null unique references auth.users(id) on delete restrict,
  inviter_user_id uuid not null references auth.users(id) on delete restrict,
  net_cents bigint not null check(net_cents>0),
  bonus_cents bigint not null check(bonus_cents>0 and bonus_cents<=net_cents/20),
  proof_reference text not null check(length(proof_reference) between 8 and 240),
  approved_at timestamptz not null,
  matured_at timestamptz not null,
  status text not null default 'validated' check(status in ('validated','reversed')),
  recorded_at timestamptz not null default clock_timestamp(),
  reversed_at timestamptz,
  check(referred_user_id<>inviter_user_id),
  check((status='validated' and reversed_at is null)
     or (status='reversed' and reversed_at is not null))
);
create index network_ads_awards_inviter_v1_1041_idx
  on public.network_module_ads_bonus_awards_v1_1041(inviter_user_id,status);

alter table public.network_module_invite_bindings_v1_1041 enable row level security;
alter table public.network_module_ads_bonus_policy_v1_1041 enable row level security;
alter table public.network_module_ads_bonus_awards_v1_1041 enable row level security;
revoke all on public.network_module_invite_bindings_v1_1041 from public,anon,authenticated;
revoke all on public.network_module_ads_bonus_policy_v1_1041 from public,anon,authenticated;
revoke all on public.network_module_ads_bonus_awards_v1_1041 from public,anon,authenticated;
grant select,insert on public.network_module_invite_bindings_v1_1041 to service_role;
grant select,insert,update on public.network_module_ads_bonus_awards_v1_1041 to service_role;
grant select,update on public.network_module_ads_bonus_policy_v1_1041 to service_role;

-- Called ONLY by authenticated Edge with the verified actor from auth.getUser.
-- URL/LocalStorage are hints, not authority. First valid attribution wins.
create function public.network_module_bind_invite_v1_1041(
  p_actor uuid,p_code text
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare v_code text:=upper(btrim(coalesce(p_code,'')));
 v_inviter uuid;v_merchant uuid;v_kind text;v_actor auth.users%rowtype;
 v_existing public.network_module_invite_bindings_v1_1041%rowtype;
begin
 if p_actor is null or v_code !~ '^[A-Z0-9]{5,40}$' then
   return jsonb_build_object('source','network_module_first_touch_v1_1041','recorded',false);
 end if;
 select * into v_actor from auth.users where id=p_actor;
 if not found or coalesce(v_actor.is_anonymous,true) or
   (v_actor.email_confirmed_at is null and v_actor.phone_confirmed_at is null) or
   v_actor.created_at < clock_timestamp()-interval '30 days' then
   return jsonb_build_object('source','network_module_first_touch_v1_1041','recorded',false);
 end if;
 select * into v_existing from public.network_module_invite_bindings_v1_1041
  where referred_user_id=p_actor;
 if found then return jsonb_build_object(
   'source','network_module_first_touch_v1_1041','recorded',true,'existing',true);
 end if;
 select user_id into v_inviter from public.profiles where referral_code=v_code;
 if found then v_kind:='customer';
 else
   select created_by,merchant_id into v_inviter,v_merchant
   from public.growth_merchant_invites_v1_226 where invite_code=v_code;
   if found then v_kind:='merchant';end if;
 end if;
 if v_inviter is null or v_inviter=p_actor or v_kind is null then
   return jsonb_build_object('source','network_module_first_touch_v1_1041','recorded',false);
 end if;
 -- Respect existing paid first-order attribution; a different account
 -- cannot substitute for the person already associated with a buyer.
 if exists(select 1 from public.referrals r where r.referred_user_id=p_actor
   and r.referrer_user_id<>v_inviter) then
   return jsonb_build_object('source','network_module_first_touch_v1_1041','recorded',false);
 end if;
 if not exists(select 1 from auth.users u where u.id=v_inviter
   and u.is_anonymous=false
   and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)) then
   return jsonb_build_object('source','network_module_first_touch_v1_1041','recorded',false);
 end if;
 insert into public.network_module_invite_bindings_v1_1041
 (referred_user_id,inviter_user_id,inviter_kind,inviter_merchant_id,referral_code)
 values(p_actor,v_inviter,v_kind,v_merchant,v_code)
 on conflict(referred_user_id) do nothing;
 return jsonb_build_object('source','network_module_first_touch_v1_1041',
 'recorded',exists(select 1 from public.network_module_invite_bindings_v1_1041
  where referred_user_id=p_actor));
end $fn$;
revoke all on function public.network_module_bind_invite_v1_1041(uuid,text)
  from public,anon,authenticated;
grant execute on function public.network_module_bind_invite_v1_1041(uuid,text)
  to service_role;

-- Independent Ads: up to 5% of true verified net revenue, NOT the existing
-- 10% package pool and NEVER coupon face value, advertiser spend, or clicks.
-- Owner-controlled terms switch: FALSE until explicit commercial acceptance.
create function public.network_module_ads_bonus_set_enabled_v1_1041(
  p_actor uuid,p_enabled boolean,p_terms_reference text default null
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare v_terms text:=nullif(btrim(coalesce(p_terms_reference,'')),'');
begin
 if not exists(select 1 from public.platform_admins
  where user_id=p_actor and active and admin_role='superadmin') then
  raise exception 'NETWORK_BENEFITS_OWNER_ONLY' using errcode='42501';
 end if;
 if p_enabled is null then raise exception 'NETWORK_BENEFITS_BAD_POLICY' using errcode='22023';end if;
 if p_enabled and (v_terms is null or length(v_terms) not between 12 and 160
  or v_terms ~ '[<>]') then
  raise exception 'NETWORK_BENEFITS_TERMS_REQUIRED' using errcode='22023';
 end if;
 update public.network_module_ads_bonus_policy_v1_1041
   set enabled=p_enabled,
    effective_after=case when p_enabled then clock_timestamp() else effective_after end,
    terms_approved_at=case when p_enabled then clock_timestamp() else terms_approved_at end,
    terms_reference=case when p_enabled then v_terms else terms_reference end
 where singleton;
 return jsonb_build_object('source','network_ads_bonus_policy_v1_1041',
  'enabled',p_enabled,'cashPayoutsEnabled',false);
end $fn$;
revoke all on function public.network_module_ads_bonus_set_enabled_v1_1041(uuid,boolean,text)
 from public,anon,authenticated;
grant execute on function public.network_module_ads_bonus_set_enabled_v1_1041(uuid,boolean,text)
 to service_role;

create function public.network_module_ads_bonus_refresh_v1_1041(p_inviter uuid)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare v_policy public.network_module_ads_bonus_policy_v1_1041%rowtype;
 v_added integer:=0;v_reversed integer:=0;
begin
 select * into v_policy from public.network_module_ads_bonus_policy_v1_1041 where singleton;
 if not coalesce(v_policy.enabled,false) then
   return jsonb_build_object('source','network_ads_bonus_v1_1041',
     'enabled',false,'created',0,'reversed',0,'cashPayoutsEnabled',false);
 end if;
 -- Cancel any still-internal award if original transaction is reversed,
 -- net observation is disputed, or provider refund is in flight.
 with invalid as (
   select a.campaign_id from public.network_module_ads_bonus_awards_v1_1041 a
   join public.ads_independent_checkouts_v1_886 c on c.campaign_id=a.campaign_id
   left join public.platform_receipt_net_observations o
     on o.kind='advertising' and o.resource_id=c.campaign_id
   where a.inviter_user_id=p_inviter and a.status='validated'
     and (c.status<>'payment_approved' or c.provider_status<>'approved'
       or c.reversed_at is not null or o.status is distinct from 'net_verified'
       or exists(select 1 from public.ads_independent_refund_executions_v1_888 f
          where f.campaign_id=c.campaign_id))
 )
 update public.network_module_ads_bonus_awards_v1_1041 a
    set status='reversed',reversed_at=clock_timestamp()
 from invalid i where a.campaign_id=i.campaign_id;
 get diagnostics v_reversed=row_count;

 -- One paid-ad acquisition bonus per account, from the FIRST fully verified
 -- net receipt; require that both invite binding and policy predate payment.
 with eligible as (
  select distinct on (c.owner_user_id)
   c.campaign_id,c.owner_user_id,b.inviter_user_id,c.approved_at,
   r.net_cents,r.evidence_reference,
   floor(r.net_cents::numeric*v_policy.inviter_bps/10000)::bigint as bonus,
   greatest(c.approved_at,r.release_at)+make_interval(days=>v_policy.maturation_days) as matured_at
  from public.ads_independent_checkouts_v1_886 c
  join public.network_module_invite_bindings_v1_1041 b
    on b.referred_user_id=c.owner_user_id and b.inviter_user_id=p_inviter
  join public.platform_receipt_net_audit r
    on r.kind='advertising' and r.resource_id=c.campaign_id
    and r.gross_cents=c.amount_cents and r.net_cents>0
    and r.release_at<=clock_timestamp()
  join public.platform_receipt_net_observations o
    on o.kind='advertising' and o.resource_id=c.campaign_id
    and o.status='net_verified'
  where c.status='payment_approved' and c.provider_status='approved'
   and c.reversed_at is null and c.approved_at is not null
   and c.approved_at>=b.bound_at and c.approved_at>=v_policy.effective_after
   and not exists(select 1 from public.ads_independent_refund_executions_v1_888 f
     where f.campaign_id=c.campaign_id)
  order by c.owner_user_id,c.approved_at,c.campaign_id
 )
 insert into public.network_module_ads_bonus_awards_v1_1041
 (campaign_id,referred_user_id,inviter_user_id,approved_at,net_cents,
  bonus_cents,proof_reference,matured_at)
 select e.campaign_id,e.owner_user_id,e.inviter_user_id,e.approved_at,
  e.net_cents,e.bonus,e.evidence_reference,e.matured_at
 from eligible e where e.bonus>0 and e.matured_at<=clock_timestamp()
 on conflict do nothing;
 get diagnostics v_added=row_count;
 return jsonb_build_object('source','network_ads_bonus_v1_1041',
   'enabled',true,'created',v_added,'reversed',v_reversed,
   'cashPayoutsEnabled',false);
end $fn$;
revoke all on function public.network_module_ads_bonus_refresh_v1_1041(uuid)
 from public,anon,authenticated;
grant execute on function public.network_module_ads_bonus_refresh_v1_1041(uuid)
 to service_role;

-- Read-only verified milestones: one real qualified conversion per referred
-- user and active category; NOT a cash ledger or claim per raw click.
create function public.network_module_benefits_summary_v1_1041(p_inviter uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $fn$
declare v_product bigint:=0;v_merchant bigint:=0;v_mobility bigint:=0;
 v_professional bigint:=0;v_ride bigint:=0;v_club bigint:=0;v_ads bigint:=0;
 v_invites bigint:=0;v_ads_cents bigint:=0;
begin
 select count(*),
  count(*) filter(where exists(
    select 1 from public.referrals r
    join public.orders o on o.id=r.qualified_order_id
    where r.referred_user_id=b.referred_user_id and r.referrer_user_id=p_inviter
      and o.status='SETTLED' and o.financial_state='settled'
      and o.settled_at>=b.bound_at)),
  count(*) filter(where exists(
    select 1 from public.merchant_applications m where m.applicant_user_id=b.referred_user_id
      and m.status='approved' and m.created_at>=b.bound_at)),
  count(*) filter(where exists(
    select 1 from public.mobility_fee_pix_invoices_v1_837 i
    where i.driver_id=b.referred_user_id and i.status='paid'
      and i.provider_evidence_hash is not null and i.paid_at>=b.bound_at)),
  count(*) filter(where exists(
    select 1 from public.discovery_listings l where l.owner_id=b.referred_user_id
      and l.vertical='professionals' and l.status='published' and l.published_at>=b.bound_at)),
  count(*) filter(where exists(
    select 1 from public.discovery_listings l where l.owner_id=b.referred_user_id
      and l.vertical='rides' and l.status='published' and l.published_at>=b.bound_at)),
  count(*) filter(where exists(
    select 1 from public.clube_coupon_paid_invoices c
    where c.customer_user_id=b.referred_user_id and c.status='paid'
      and c.refunded_at is null and c.net_proceeds_verified_at is not null
      and c.paid_at>=b.bound_at)),
  count(*) filter(where exists(
    select 1 from public.ads_independent_checkouts_v1_886 a
    join public.platform_receipt_net_audit r on r.kind='advertising'
      and r.resource_id=a.campaign_id and r.net_cents>0
    join public.platform_receipt_net_observations o on o.kind='advertising'
      and o.resource_id=a.campaign_id and o.status='net_verified'
    where a.owner_user_id=b.referred_user_id and a.status='payment_approved'
      and a.provider_status='approved' and a.reversed_at is null
      and a.approved_at>=b.bound_at and
      not exists(select 1 from public.ads_independent_refund_executions_v1_888 f
        where f.campaign_id=a.campaign_id)))
 into v_invites,v_product,v_merchant,v_mobility,v_professional,
  v_ride,v_club,v_ads
 from public.network_module_invite_bindings_v1_1041 b
 where b.inviter_user_id=p_inviter;
 select coalesce(sum(bonus_cents),0) into v_ads_cents
 from public.network_module_ads_bonus_awards_v1_1041
 where inviter_user_id=p_inviter and status='validated';
 return jsonb_build_object('source','network_module_benefits_v1_1041',
   'readOnly',true,'cashPayoutsEnabled',false,
   'invitedAccounts',v_invites,
   'modules',jsonb_build_object('products',v_product,'merchants',v_merchant,
     'mobility',v_mobility,'professionals',v_professional,'rides',v_ride,
     'club',v_club,'advertising',v_ads),
   'verifiedConversions',v_product+v_merchant+v_mobility+
    v_professional+v_ride+v_club+v_ads,
   'adsBonusValidatedCents',v_ads_cents,
   'adsBonusPayoutEnabled',false);
end $fn$;
revoke all on function public.network_module_benefits_summary_v1_1041(uuid)
 from public,anon,authenticated;
grant execute on function public.network_module_benefits_summary_v1_1041(uuid)
 to service_role;

commit;
