-- TAMÃO V1.70.13 — public request retry idempotency
-- A lost HTTP acknowledgement must not create duplicate support/privacy requests.

alter table public.public_requests
  add column if not exists idempotency_key text,
  add column if not exists request_hash text;

alter table public.public_requests
  drop constraint if exists public_requests_idempotency_pair_check;

alter table public.public_requests
  add constraint public_requests_idempotency_pair_check
  check (
    (idempotency_key is null and request_hash is null)
    or (
      idempotency_key is not null
      and request_hash is not null
      and char_length(idempotency_key) between 12 and 120
      and idempotency_key ~ '^[A-Za-z0-9._:-]+$'
      and request_hash ~ '^[0-9a-f]{64}$'
    )
  );

create unique index if not exists public_requests_idempotency_key_uidx
  on public.public_requests(idempotency_key)
  where idempotency_key is not null;

revoke all on table public.public_requests from public, anon, authenticated;
grant all on table public.public_requests to service_role;
