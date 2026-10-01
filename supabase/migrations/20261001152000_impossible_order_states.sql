-- Chama São Gabriel — impossible order states hardening v1.14.9
-- Move remaining order invariants from application assumptions into CHECK constraints.

alter table public.orders
  drop constraint if exists orders_settlement_financial_state_pair;

alter table public.orders
  add constraint orders_settlement_financial_state_pair
  check (
    (status='SETTLED') = (financial_state in ('settled','reversed'))
  );

alter table public.orders
  drop constraint if exists orders_financial_reversal_metadata_lifecycle;

alter table public.orders
  add constraint orders_financial_reversal_metadata_lifecycle
  check (
    (
      financial_state='reversed'
      and financial_reversed_at is not null
      and financial_reversal_reason is not null
      and char_length(financial_reversal_reason) between 3 and 240
      and (
        financial_reversal_reference is null
        or char_length(financial_reversal_reference) between 3 and 120
      )
    )
    or
    (
      financial_state<>'reversed'
      and financial_reversed_at is null
      and financial_reversal_reason is null
      and financial_reversal_reference is null
    )
  );

alter table public.orders
  drop constraint if exists orders_requote_total_identity;

alter table public.orders
  add constraint orders_requote_total_identity
  check (
    status<>'REQUOTE_REQUIRED'
    or proposed_total_cents = proposed_gross_total_cents - cashback_reserved_cents
  );

alter table public.orders
  drop constraint if exists orders_requote_merchant_must_change;

alter table public.orders
  add constraint orders_requote_merchant_must_change
  check (
    status<>'REQUOTE_REQUIRED'
    or proposed_merchant_id is distinct from merchant_id
  );

alter table public.orders
  drop constraint if exists orders_current_merchant_must_be_attempted;

alter table public.orders
  add constraint orders_current_merchant_must_be_attempted
  check (
    merchant_id is null
    or merchant_id=any(attempted_merchant_ids)
  );

alter table public.orders
  drop constraint if exists orders_requote_candidate_not_previously_attempted;

alter table public.orders
  add constraint orders_requote_candidate_not_previously_attempted
  check (
    status<>'REQUOTE_REQUIRED'
    or not (proposed_merchant_id=any(attempted_merchant_ids))
  );

alter table public.orders
  drop constraint if exists orders_attempt_history_bounded;

alter table public.orders
  add constraint orders_attempt_history_bounded
  check (cardinality(attempted_merchant_ids) between 0 and 100);
