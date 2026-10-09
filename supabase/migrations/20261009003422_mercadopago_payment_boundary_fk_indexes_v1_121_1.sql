
create index if not exists merchant_payment_oauth_states_merchant_idx
  on public.merchant_payment_oauth_states(merchant_id);
create index if not exists merchant_payment_oauth_states_initiated_by_idx
  on public.merchant_payment_oauth_states(initiated_by);
create index if not exists merchant_sale_payment_attempts_merchant_idx
  on public.merchant_sale_payment_attempts(merchant_id);
