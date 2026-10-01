-- Chama São Gabriel — strict order-state invariants v1.14.5
-- Make impossible timestamps/proposal combinations fail at the database layer.

alter table public.orders
  drop constraint if exists orders_payment_confirmation_pair;
alter table public.orders
  add constraint orders_payment_confirmation_pair
  check (
    (payment_confirmed_at is null and payment_confirmation_method is null)
    or
    (payment_confirmed_at is not null and payment_confirmation_method is not null)
  );

alter table public.orders
  drop constraint if exists orders_payment_only_when_settled;
alter table public.orders
  add constraint orders_payment_only_when_settled
  check (
    payment_confirmed_at is null
    or status='SETTLED'
  );

alter table public.orders
  drop constraint if exists orders_settled_timestamp_only_when_settled;
alter table public.orders
  add constraint orders_settled_timestamp_only_when_settled
  check (
    settled_at is null
    or status='SETTLED'
  );

alter table public.orders
  drop constraint if exists orders_delivery_timestamp_state;
alter table public.orders
  add constraint orders_delivery_timestamp_state
  check (
    delivered_at is null
    or status in ('DELIVERED','SETTLED')
  );

alter table public.orders
  drop constraint if exists orders_arriving_timestamp_state;
alter table public.orders
  add constraint orders_arriving_timestamp_state
  check (
    arriving_at is null
    or status in ('ARRIVING','DELIVERED','SETTLED')
  );

alter table public.orders
  drop constraint if exists orders_dispatch_timestamp_state;
alter table public.orders
  add constraint orders_dispatch_timestamp_state
  check (
    dispatched_at is null
    or status in ('OUT_FOR_DELIVERY','ARRIVING','DELIVERED','SETTLED')
  );

alter table public.orders
  drop constraint if exists orders_proposal_lifecycle;
alter table public.orders
  add constraint orders_proposal_lifecycle
  check (
    (
      status='REQUOTE_REQUIRED'
      and proposed_merchant_id is not null
      and proposed_gross_total_cents is not null
      and proposed_total_cents is not null
      and proposed_delivery_fee_cents is not null
    )
    or
    (
      status<>'REQUOTE_REQUIRED'
      and proposed_merchant_id is null
      and proposed_gross_total_cents is null
      and proposed_total_cents is null
      and proposed_delivery_fee_cents is null
    )
  );

alter table public.orders
  drop constraint if exists orders_offer_expiry_lifecycle;
alter table public.orders
  add constraint orders_offer_expiry_lifecycle
  check (
    (
      status in ('OFFERED_TO_MERCHANT','REQUOTE_REQUIRED')
      and offer_expires_at is not null
    )
    or
    (
      status not in ('OFFERED_TO_MERCHANT','REQUOTE_REQUIRED')
      and offer_expires_at is null
    )
  );

alter table public.orders
  drop constraint if exists orders_post_accept_requires_accepted_at;
alter table public.orders
  add constraint orders_post_accept_requires_accepted_at
  check (
    status not in (
      'MERCHANT_ACCEPTED','PREPARING','AT_RISK',
      'OUT_FOR_DELIVERY','ARRIVING','DELIVERED','SETTLED'
    )
    or accepted_at is not null
  );
