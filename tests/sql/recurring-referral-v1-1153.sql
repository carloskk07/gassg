-- V1.1153 — prova de comissão na segunda compra do MESMO indicado.
-- Executar apenas no Postgres descartável do CI. Toda a prova é ROLLBACK.
\set ON_ERROR_STOP on
begin;

create temp table recurring_v1153_seed on commit drop as
select g.order_id as first_order_id,
       gen_random_uuid() as repeat_order_id,
       g.customer_id, g.referrer_user_id,
       g.referral_pending_cents as first_reward_cents,
       r.qualified_order_id as first_qualified_order_id
from public.order_reward_grants g
join public.referrals r on r.referred_user_id=g.customer_id
join auth.users u on u.id=g.customer_id
join public.orders o on o.id=g.order_id
where u.email like 'tamao-buyer-%@example.com'
  and g.referral_pending_cents>0
  and g.reversed_at is null
  and o.status='SETTLED'
  and o.financial_state='settled'
  and r.qualified_order_id=g.order_id
order by g.created_at desc limit 1;

do $assert$
begin
 if (select count(*) from recurring_v1153_seed)<>1 then
   raise exception 'V1153_NO_CANONICAL_FIRST_SETTLED_REFERRAL';
 end if;
end $assert$;

-- Read-only copy of the canonical, fully settled local receipt into a fresh
-- order ID. The clone is NEVER a real purchase and is rolled back below.
-- The reward authority is called directly as a controlled LOCAL fixture.
insert into public.orders
select (pg_catalog.jsonb_populate_record(
  null::public.orders,
  to_jsonb(o) || pg_catalog.jsonb_build_object(
    'id',s.repeat_order_id,
    'public_code','SG-R'||upper(substr(replace(s.repeat_order_id::text,'-',''),1,12)),
    'created_at',clock_timestamp(),
    'updated_at',clock_timestamp(),
    'settled_at',clock_timestamp(),
    'delivered_at',clock_timestamp(),
    'payment_confirmed_at',clock_timestamp()
  )
)).*
from public.orders o join recurring_v1153_seed s on s.first_order_id=o.id;

insert into public.order_items(order_id,product_code,product_name,quantity,unit_price_cents,line_total_cents)
select s.repeat_order_id,i.product_code,i.product_name,i.quantity,i.unit_price_cents,i.line_total_cents
from public.order_items i join recurring_v1153_seed s on s.first_order_id=i.order_id;

insert into public.platform_receivables
select (pg_catalog.jsonb_populate_record(
  null::public.platform_receivables,
  to_jsonb(p) || pg_catalog.jsonb_build_object(
    'order_id',s.repeat_order_id,
    'created_at',clock_timestamp(),
    'updated_at',clock_timestamp(),
    'daily_statement_id',null
  )
)).*
from public.platform_receivables p
join recurring_v1153_seed s on s.first_order_id=p.order_id;

do $assert$
declare
 s recurring_v1153_seed%rowtype;
 first_result jsonb;
 repeat_result jsonb;
 actual record;
 v_expected integer;
 v_pending integer;
 v_commission_entries integer;
begin
 select * into strict s from recurring_v1153_seed;
 first_result:=public.grant_order_rewards(s.repeat_order_id);
 repeat_result:=public.grant_order_rewards(s.repeat_order_id);
 if (first_result->>'alreadyGranted')::boolean
    or not (repeat_result->>'alreadyGranted')::boolean then
   raise exception 'V1153_NONIDEMPOTENT_RECURRING_GRANT';
 end if;
 select g.*, o.referral_bps_snapshot, o.gross_total_cents
 into strict actual
 from public.order_reward_grants g join public.orders o on o.id=g.order_id
 where g.order_id=s.repeat_order_id;
 if actual.referrer_user_id is distinct from s.referrer_user_id
    or actual.customer_id is distinct from s.customer_id then
   raise exception 'V1153_REFERRER_BINDING_CHANGED';
 end if;
 v_expected:=floor(actual.gross_total_cents::numeric*actual.referral_bps_snapshot/10000)::integer;
 if actual.referral_bps_snapshot<>200 or actual.referral_pending_cents<>v_expected
   or v_expected<=0 then
   raise exception 'V1153_NOT_FULL_TWO_PERCENT';
 end if;
 if (select qualified_order_id from public.referrals where referred_user_id=s.customer_id)
    is distinct from s.first_order_id then
   raise exception 'V1153_FIRST_QUALIFIED_ORDER_OVERWRITTEN';
 end if;
 select count(*),coalesce(sum(amount_cents),0)
 into v_commission_entries,v_pending
 from public.wallet_entries
 where order_id=s.repeat_order_id and entry_type='referral_pending'
   and user_id=s.referrer_user_id;
 if v_commission_entries<>1 or v_pending<>v_expected then
   raise exception 'V1153_DUPLICATED_OR_MISSING_PENDING_LEDGER';
 end if;
 if (select metadata->>'purchaseType'
     from public.wallet_entries where order_id=s.repeat_order_id
       and entry_type='referral_pending')<>'repeat' then
   raise exception 'V1153_RECURRING_TYPE_NOT_IN_LEDGER';
 end if;
 if actual.platform_fee_cents <> actual.variable_cost_reserve_cents +
    actual.cashback_cents + actual.referral_pending_cents + actual.platform_contribution_cents
    or actual.platform_contribution_cents<actual.minimum_contribution_cents then
   raise exception 'V1153_FINANCIAL_INVARIANT_BROKEN';
 end if;
 raise notice 'V1153 PASS: repeat order 2 percent, one ledger, immutable first link, preserved budget';
end $assert$;

rollback;
