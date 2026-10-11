-- TAMÃO V1.158.1 — first commercial capability: pay the seller on delivery.
-- No payment into TAMÃO, no advance-payment authorization by implication.
-- This migration is intentionally fail-closed; prepaid ordering requires a
-- separate, audited quote/order timing flow in a subsequent migration.

alter table public.quotes
  add column if not exists payment_timing_requested text not null default 'on_delivery';
alter table public.quotes
  drop constraint if exists quotes_payment_timing_requested_check;
alter table public.quotes
  add constraint quotes_payment_timing_requested_check
    check (payment_timing_requested in ('on_delivery','prepaid'));

alter table public.orders
  add column if not exists payment_timing text not null default 'on_delivery';
alter table public.orders
  drop constraint if exists orders_payment_timing_check;
alter table public.orders
  add constraint orders_payment_timing_check
    check (payment_timing in ('on_delivery','prepaid'));

-- A legacy manual/external Pix route records acceptance of Pix without
-- authorizing a hosted checkout. Convert only that explicitly active,
-- merchant-confirmed route into Pix accepted at the moment of delivery.
-- Never convert automated, connected, inactive or other-provider routes.
update public.merchant_payment_routes r
set channel='delivery',
    customer_label='Pix na entrega',
    updated_at=clock_timestamp()
where r.provider='manual'
  and r.payment_method='pix'
  and r.channel='external'
  and r.verification_mode='merchant_confirmed'
  and r.active
  and not exists (
    select 1 from public.merchant_payment_routes existing
    where existing.merchant_id=r.merchant_id
      and existing.payment_method='pix'
      and existing.provider='manual'
      and existing.channel='delivery'
  );

-- This single server-side policy is reusable by the order trigger and
-- future city/product capabilities. Active method AND suitable delivery
-- route are both required; a route marked online/external does not qualify.
create or replace function public.merchant_delivery_payment_allowed(
  p_merchant_id uuid,p_payment_method text
)
returns boolean
language sql stable security definer
set search_path to pg_catalog
as $func$
select p_merchant_id is not null
  and p_payment_method in ('cash','pix','card')
  and exists(
    select 1 from public.merchant_payment_methods pm
    where pm.merchant_id=p_merchant_id
      and pm.payment_method=p_payment_method and pm.active
  )
  and exists(
    select 1 from public.merchant_payment_routes r
    where r.merchant_id=p_merchant_id and r.active
      and r.channel='delivery'
      and (
        r.payment_method=p_payment_method
        or (p_payment_method='card'
          and r.payment_method in ('card_credit','card_debit'))
      )
      and (
        r.verification_mode='merchant_confirmed'
        or (
          r.verification_mode='device'
          and exists (
            select 1 from public.merchant_payment_provider_accounts a
            where a.id=r.connection_id
              and a.merchant_id=r.merchant_id
              and a.provider=r.provider
              and a.status='active'
              and coalesce(
                (a.capabilities->>'canValidateProviderTransactions')::boolean,
                false
              )
          )
        )
      )
  );
$func$;
revoke all on function public.merchant_delivery_payment_allowed(uuid,text)
  from public,anon,authenticated;
grant execute on function public.merchant_delivery_payment_allowed(uuid,text)
  to service_role;

-- Do not rely only on get-offers: creating a quote or replaying create-order
-- cannot authorize a non-delivery route. Existing orders remain executable;
-- re-assignments or payment-method changes are checked.
create or replace function public.guard_new_order_delivery_payment()
returns trigger
language plpgsql security definer
set search_path to pg_catalog
as $func$
begin
  if tg_op='UPDATE' then
    if new.payment_timing is distinct from old.payment_timing then
      raise exception 'ORDER_PAYMENT_TIMING_IMMUTABLE'
        using errcode='40001';
    end if;
    if new.merchant_id is not distinct from old.merchant_id
       and new.payment_method is not distinct from old.payment_method then
      return new;
    end if;
  end if;
  if new.payment_timing='on_delivery'
     and new.merchant_id is not null
     and not public.merchant_delivery_payment_allowed(
       new.merchant_id,new.payment_method
     ) then
    raise exception 'ORDER_DELIVERY_PAYMENT_ROUTE_NOT_AUTHORIZED'
      using errcode='40001';
  end if;
  return new;
end;
$func$;
drop trigger if exists guard_new_order_delivery_payment_trg on public.orders;
create trigger guard_new_order_delivery_payment_trg
before insert or update of merchant_id,payment_method,payment_timing
on public.orders
for each row execute function public.guard_new_order_delivery_payment();
revoke all on function public.guard_new_order_delivery_payment()
  from public,anon,authenticated;
grant execute on function public.guard_new_order_delivery_payment()
  to service_role;

-- Prevent an automated charge from being prepared against a delivery-only
-- order, even if a future endpoint accidentally selects an online route.
-- Existing payment attempts are not rewritten and callbacks can still settle.
create or replace function public.guard_new_prepaid_attempt()
returns trigger
language plpgsql security definer
set search_path to pg_catalog
as $func$
begin
  if new.checkout_mode in ('hosted','pix','external_link') then
    if not exists(
      select 1
      from public.orders o
      join public.merchant_payment_routes r
        on r.id=new.payment_route_id
       and r.merchant_id=o.merchant_id
       and r.active
       and r.channel='online'
       and r.verification_mode='provider_api'
      join public.merchant_payment_provider_accounts a
        on a.id=r.connection_id
       and a.merchant_id=r.merchant_id
       and a.provider=r.provider
       and a.status='active'
      join public.payment_provider_catalog catalog
        on catalog.provider_key=r.provider
       and catalog.adapter_status='implemented'
      where o.id=new.order_id
        and o.merchant_id=new.merchant_id
        and o.payment_timing='prepaid'
        and o.payment_method in ('pix','card')
        and (
          o.payment_method=r.payment_method
          or (o.payment_method='card'
            and r.payment_method in ('card_credit','card_debit'))
        )
        and coalesce(
          (a.capabilities->>'directSalePaymentsEnabled')::boolean,false
        )
        and coalesce(
          (a.capabilities->>'canValidateProviderTransactions')::boolean,false
        )
    ) then
      raise exception 'PREPAID_PAYMENT_NOT_AUTHORIZED'
        using errcode='40001';
    end if;
  end if;
  return new;
end;
$func$;
drop trigger if exists guard_new_prepaid_attempt_trg
  on public.merchant_sale_payment_attempts;
create trigger guard_new_prepaid_attempt_trg
before insert or update of payment_route_id,checkout_mode
on public.merchant_sale_payment_attempts
for each row execute function public.guard_new_prepaid_attempt();
revoke all on function public.guard_new_prepaid_attempt()
  from public,anon,authenticated;
grant execute on function public.guard_new_prepaid_attempt()
  to service_role;
