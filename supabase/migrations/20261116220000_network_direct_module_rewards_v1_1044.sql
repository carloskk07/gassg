-- TAMÃO V1.1044 — Direct verified acquisition incentives, separate from shared 10% pool.
-- Future-only owner policy. No money withdrawal, wallet entries or synthetic receipts.
-- Professionals: existing 5% first paid advertising campaign (V1.1041);
-- this migration covers first eligible mobility prepaid package and
-- first financially independent, partner-funded Clube paid package.
begin;

create table public.network_direct_module_policy_v1_1044 (
  module text primary key check(module in ('mobility','club')),
  enabled boolean not null default false,
  inviter_bps integer not null default 500 check(inviter_bps between 1 and 500),
  maturity_days integer not null default 7 check(maturity_days between 7 and 60),
  effective_after timestamptz not null default clock_timestamp(),
  terms_approved_at timestamptz,
  terms_reference text check(terms_reference is null or
    (length(terms_reference) between 12 and 160 and terms_reference !~ '[<>]')),
  check(not enabled or (terms_approved_at is not null and terms_reference is not null))
);
insert into public.network_direct_module_policy_v1_1044(module)
values('mobility'),('club');

create table public.network_direct_module_awards_v1_1044 (
  module text not null check(module in ('mobility','club')),
  source_id uuid not null,
  referred_user_id uuid not null references auth.users(id) on delete restrict,
  inviter_user_id uuid not null references auth.users(id) on delete restrict,
  net_cents bigint not null check(net_cents>0),
  bonus_cents bigint not null check(bonus_cents>0 and bonus_cents<=net_cents/20),
  proof_reference text not null check(length(proof_reference) between 8 and 240),
  qualified_at timestamptz not null,
  matured_at timestamptz not null,
  status text not null default 'validated' check(status in ('validated','reversed')),
  recorded_at timestamptz not null default clock_timestamp(),
  reversed_at timestamptz,
  primary key(module,source_id),
  unique(module,referred_user_id),
  check(referred_user_id<>inviter_user_id),
  check((status='validated' and reversed_at is null) or
        (status='reversed' and reversed_at is not null))
);
create index network_direct_awards_inviter_v1_1044
 on public.network_direct_module_awards_v1_1044(inviter_user_id,module,status);

alter table public.network_direct_module_policy_v1_1044 enable row level security;
alter table public.network_direct_module_awards_v1_1044 enable row level security;
revoke all on public.network_direct_module_policy_v1_1044,
 public.network_direct_module_awards_v1_1044 from public,anon,authenticated,service_role;
grant select,update on public.network_direct_module_policy_v1_1044 to service_role;
grant select,insert,update on public.network_direct_module_awards_v1_1044 to service_role;

create function public.network_direct_module_set_enabled_v1_1044(
 p_actor uuid,p_module text,p_enabled boolean,p_terms_reference text default null
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare v_reference text:=nullif(btrim(coalesce(p_terms_reference,'')),'');
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 if p_enabled is null or p_module not in ('mobility','club') or p_module is null
 then raise exception 'NETWORK_DIRECT_POLICY_INVALID' using errcode='22023';end if;
 if p_enabled and (v_reference is null or length(v_reference) not between 12 and 160
  or v_reference ~ '[<>]') then
  raise exception 'NETWORK_DIRECT_TERMS_REQUIRED' using errcode='22023';end if;
 update public.network_direct_module_policy_v1_1044
 set enabled=p_enabled,
     effective_after=case when p_enabled then clock_timestamp() else effective_after end,
     terms_approved_at=case when p_enabled then clock_timestamp() else terms_approved_at end,
     terms_reference=case when p_enabled then v_reference else terms_reference end
 where module=p_module;
 if not found then raise exception 'NETWORK_DIRECT_POLICY_MISSING';end if;
 return jsonb_build_object('source','network_direct_policy_v1_1044',
   'module',p_module,'enabled',p_enabled,'cashPayoutsEnabled',false,'moneyMoved',false);
end $fn$;
revoke all on function public.network_direct_module_set_enabled_v1_1044(uuid,text,boolean,text)
 from public,anon,authenticated;
grant execute on function public.network_direct_module_set_enabled_v1_1044(uuid,text,boolean,text)
 to service_role;

-- Revoke invalid historical awards FIRST, even if future bonuses are paused.
-- This is invoked by an authenticated, user-scoped Edge session, not the browser.
create function public.network_direct_module_refresh_v1_1044(p_inviter uuid)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare v_added_mobility integer:=0;v_added_club integer:=0;v_reversed integer:=0;
begin
 if p_inviter is null then raise exception 'NETWORK_DIRECT_INVITER_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('network-direct-1044:'||p_inviter::text,0));
 update public.network_direct_module_awards_v1_1044 a
 set status='reversed',reversed_at=clock_timestamp()
 where a.inviter_user_id=p_inviter and a.status='validated' and (
  (a.module='mobility' and not exists(
   select 1 from public.mobility_fee_pix_invoices_v1_837 i
   join public.mobility_fee_prepaid_lots_v1_838 l on l.invoice_id=i.id
   join public.platform_receipt_net_audit r on r.kind='mobility' and r.resource_id=i.id
   join public.platform_receipt_net_observations o on o.kind='mobility'
     and o.resource_id=i.id
   where i.id=a.source_id and i.driver_id=a.referred_user_id
     and i.status='paid' and i.invoice_kind='prepaid_credit'
     and i.provider='mercadopago' and i.provider_evidence_hash is not null
     and l.status='active' and l.funded_cents=i.grant_cents
     and l.spent_cents=l.funded_cents and l.reserved_cents=0
     and r.net_cents=a.net_cents and r.gross_cents=i.amount_cents
     and r.evidence_reference=a.proof_reference and o.status='net_verified'
  ))
  or
  (a.module='club' and not exists(
   select 1 from public.clube_coupon_paid_invoices c
   join public.clube_partner_coupon_sale_agreements_v1_849 ag
     on ag.request_id=c.request_id and ag.package_key=c.package_key
   where c.id=a.source_id and c.customer_user_id=a.referred_user_id
     and c.status='paid' and c.refunded_at is null
     and c.funding_mode_v1_846='partner_funded'
     and c.funding_terms_version_v1_846='clube_partner_coupon_terms_v1_846'
     and c.sponsor_covered_cents=0 and c.coupon_settlement_hold_reason_v1_853 is null
     and c.net_proceeds_cents=a.net_cents and c.net_proceeds_verified_at is not null
     and c.net_proceeds_reference=a.proof_reference
     and ag.sales_authorized=true and ag.owner_accepts_partner_nonreimbursement=true
     and ag.owner_accepts_refund=true
     and not exists(select 1 from public.clube_coupon_refund_requests_v1_814 f
       where f.invoice_id=c.id)
     and not exists(select 1 from public.clube_partner_coupon_returns_v1_847 f
       where f.invoice_id=c.id)
  ))
 );
 get diagnostics v_reversed=row_count;

 -- Direct 5% of reconciled NET of the first actually CONSUMED prepaid
 -- mobility package, not of gross fares or unused fee-credit liabilities.
 with eligible as (
  select distinct on (i.driver_id)
    i.id as source_id,i.driver_id as referred,b.inviter_user_id,
    r.net_cents,r.evidence_reference,i.paid_at,
    greatest(i.paid_at,r.release_at)+make_interval(days=>p.maturity_days) as matured_at,
    floor(r.net_cents::numeric*p.inviter_bps/10000)::bigint as bonus
  from public.mobility_fee_pix_invoices_v1_837 i
  join public.network_module_invite_bindings_v1_1041 b
    on b.referred_user_id=i.driver_id and b.inviter_user_id=p_inviter
  join public.network_direct_module_policy_v1_1044 p
    on p.module='mobility' and p.enabled and p.terms_approved_at is not null
  join public.mobility_fee_prepaid_lots_v1_838 l on l.invoice_id=i.id
    and l.driver_id=i.driver_id and l.status='active'
    and l.funded_cents=i.grant_cents
    and l.spent_cents=l.funded_cents and l.reserved_cents=0
  join public.platform_receipt_net_audit r on r.kind='mobility' and r.resource_id=i.id
    and r.gross_cents=i.amount_cents and r.net_cents>0
    and r.release_at<=clock_timestamp()
  join public.platform_receipt_net_observations o
    on o.kind='mobility' and o.resource_id=i.id and o.status='net_verified'
  where i.status='paid' and i.provider='mercadopago'
    and i.invoice_kind='prepaid_credit' and i.provider_evidence_hash is not null
    and i.paid_at>=b.bound_at and i.paid_at>=p.effective_after
    and greatest(i.paid_at,r.release_at)+make_interval(days=>p.maturity_days)
      <=clock_timestamp()
  order by i.driver_id,i.paid_at,i.id
 )
 insert into public.network_direct_module_awards_v1_1044
 (module,source_id,referred_user_id,inviter_user_id,net_cents,bonus_cents,
  proof_reference,qualified_at,matured_at)
 select 'mobility',e.source_id,e.referred,e.inviter_user_id,e.net_cents,
  e.bonus,e.evidence_reference,e.paid_at,e.matured_at
 from eligible e where e.bonus>0
 on conflict do nothing;
 get diagnostics v_added_mobility=row_count;

 -- Clube: ONLY a seller-signed, partner-funded package with no owner subsidy
 -- and confirmed NET. Owner-sponsored coupons, discount face value, pending
 -- supplier authorizations and refunds generate NO commission.
 with eligible as (
  select distinct on (c.customer_user_id)
    c.id as source_id,c.customer_user_id as referred,b.inviter_user_id,
    c.net_proceeds_cents::bigint as net_cents,c.net_proceeds_reference,
    c.paid_at,
    greatest(c.paid_at,c.net_proceeds_verified_at)
      +make_interval(days=>p.maturity_days) as matured_at,
    floor(c.net_proceeds_cents::numeric*p.inviter_bps/10000)::bigint as bonus
  from public.clube_coupon_paid_invoices c
  join public.network_module_invite_bindings_v1_1041 b
    on b.referred_user_id=c.customer_user_id and b.inviter_user_id=p_inviter
  join public.network_direct_module_policy_v1_1044 p
    on p.module='club' and p.enabled and p.terms_approved_at is not null
  join public.clube_partner_coupon_sale_agreements_v1_849 ag
    on ag.request_id=c.request_id and ag.package_key=c.package_key
    and ag.sales_authorized=true and ag.owner_accepts_partner_nonreimbursement=true
    and ag.owner_accepts_refund=true
    and ag.signed_at<=c.paid_at
  where c.status='paid' and c.provider='mercadopago'
    and c.refunded_at is null and c.coupon_settlement_hold_reason_v1_853 is null
    and c.funding_mode_v1_846='partner_funded'
    and c.funding_terms_version_v1_846='clube_partner_coupon_terms_v1_846'
    and c.sponsor_covered_cents=0
    and c.net_proceeds_cents>0 and c.net_proceeds_cents<=c.sale_price_cents
    and length(c.net_proceeds_reference) between 8 and 240
    and c.net_proceeds_verified_at is not null
    and c.paid_at>=b.bound_at and c.paid_at>=p.effective_after
    and greatest(c.paid_at,c.net_proceeds_verified_at)
      +make_interval(days=>p.maturity_days)<=clock_timestamp()
    and not exists(select 1 from public.clube_coupon_refund_requests_v1_814 f
      where f.invoice_id=c.id)
    and not exists(select 1 from public.clube_partner_coupon_returns_v1_847 f
      where f.invoice_id=c.id)
  order by c.customer_user_id,c.paid_at,c.id
 )
 insert into public.network_direct_module_awards_v1_1044
 (module,source_id,referred_user_id,inviter_user_id,net_cents,bonus_cents,
  proof_reference,qualified_at,matured_at)
 select 'club',e.source_id,e.referred,e.inviter_user_id,e.net_cents,
   e.bonus,e.net_proceeds_reference,e.paid_at,e.matured_at
 from eligible e where e.bonus>0
 on conflict do nothing;
 get diagnostics v_added_club=row_count;
 return jsonb_build_object('source','network_direct_refresh_v1_1044',
  'createdMobility',v_added_mobility,'createdClub',v_added_club,
  'reversed',v_reversed,'cashPayoutsEnabled',false,'moneyMoved',false);
end $fn$;
revoke all on function public.network_direct_module_refresh_v1_1044(uuid)
 from public,anon,authenticated;
grant execute on function public.network_direct_module_refresh_v1_1044(uuid) to service_role;

create function public.network_direct_module_summary_v1_1044(p_inviter uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $fn$
declare v_modules jsonb;
begin
 select coalesce(jsonb_object_agg(p.module,jsonb_build_object(
  'enabled',p.enabled,'inviterBps',p.inviter_bps,
  'validatedAwards',(select count(*) from public.network_direct_module_awards_v1_1044 a
    where a.inviter_user_id=p_inviter and a.module=p.module and a.status='validated'),
  'reversedAwards',(select count(*) from public.network_direct_module_awards_v1_1044 a
    where a.inviter_user_id=p_inviter and a.module=p.module and a.status='reversed'),
  'validatedCents',(select coalesce(sum(a.bonus_cents),0)
    from public.network_direct_module_awards_v1_1044 a
    where a.inviter_user_id=p_inviter and a.module=p.module and a.status='validated')
 )),'{}'::jsonb) into v_modules
 from public.network_direct_module_policy_v1_1044 p;
 return jsonb_build_object('source','network_direct_summary_v1_1044',
   'readOnly',true,'cashPayoutsEnabled',false,'modules',v_modules);
end $fn$;
revoke all on function public.network_direct_module_summary_v1_1044(uuid)
 from public,anon,authenticated;
grant execute on function public.network_direct_module_summary_v1_1044(uuid) to service_role;

create function public.network_direct_module_admin_v1_1044(p_actor uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $fn$
declare v_modules jsonb;
begin
 if not exists(select 1 from public.platform_admins
   where user_id=p_actor and active and admin_role in ('superadmin','finance'))
 then raise exception 'NETWORK_DIRECT_ADMIN_DENIED' using errcode='42501';end if;
 select coalesce(jsonb_object_agg(p.module,jsonb_build_object(
  'enabled',p.enabled,'inviterBps',p.inviter_bps,
  'maturityDays',p.maturity_days,'termsApproved',p.terms_approved_at is not null,
  'validatedAwards',(select count(*) from public.network_direct_module_awards_v1_1044 a
    where a.module=p.module and a.status='validated'),
  'reversedAwards',(select count(*) from public.network_direct_module_awards_v1_1044 a
    where a.module=p.module and a.status='reversed'),
  'validatedCents',(select coalesce(sum(a.bonus_cents),0)
    from public.network_direct_module_awards_v1_1044 a
    where a.module=p.module and a.status='validated')
 )),'{}'::jsonb) into v_modules
 from public.network_direct_module_policy_v1_1044 p;
 return jsonb_build_object('source','network_direct_admin_v1_1044',
   'readOnly',true,'cashPayoutsEnabled',false,'moneyMoved',false,'modules',v_modules);
end $fn$;
revoke all on function public.network_direct_module_admin_v1_1044(uuid)
 from public,anon,authenticated;
grant execute on function public.network_direct_module_admin_v1_1044(uuid) to service_role;

commit;
