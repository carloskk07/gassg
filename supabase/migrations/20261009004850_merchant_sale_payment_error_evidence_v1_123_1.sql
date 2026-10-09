
alter table public.merchant_sale_payment_attempts
  add column if not exists last_error_code text,
  add column if not exists last_error_at timestamptz;

alter table public.merchant_sale_payment_attempts
  drop constraint if exists merchant_sale_payment_attempts_error_shape;

alter table public.merchant_sale_payment_attempts
  add constraint merchant_sale_payment_attempts_error_shape
  check (
    (
      last_error_code is null
      and last_error_at is null
    )
    or (
      last_error_code is not null
      and last_error_at is not null
      and char_length(last_error_code) between 3 and 120
      and last_error_code ~ '^[A-Z0-9_:-]+$'
    )
  );
