-- TAMÃO V1.70.3 — public request retry/idempotency hardening
-- Public contact/privacy requests can be retried after an ambiguous transport
-- failure. Persist a client-generated key + semantic fingerprint so the same
-- request cannot create two protocols.

alter table public.public_requests
  add column if not exists request_idempotency_key text,
  add column if not exists request_hash text;

alter table public.public_requests
  drop constraint if exists public_requests_idempotency_pair_check;

alter table public.public_requests
  add constraint public_requests_idempotency_pair_check
  check (
    (request_idempotency_key is null and request_hash is null)
    or (
      request_idempotency_key is not null
      and char_length(request_idempotency_key) between 12 and 120
      and request_idempotency_key ~ '^[A-Za-z0-9._:-]+$'
      and request_hash ~ '^[0-9a-f]{64}$'
    )
  );

create unique index if not exists public_requests_idempotency_key_uidx
  on public.public_requests(request_idempotency_key)
  where request_idempotency_key is not null;


-- The pre-launch lead table already deduplicates by (lead_type, phone), but an
-- automatic ACK retry must not inflate submission_count.
alter table public.prelaunch_leads
  add column if not exists last_request_idempotency_key text,
  add column if not exists last_request_hash text;

alter table public.prelaunch_leads
  drop constraint if exists prelaunch_leads_last_idempotency_pair_check;

alter table public.prelaunch_leads
  add constraint prelaunch_leads_last_idempotency_pair_check
  check (
    (last_request_idempotency_key is null and last_request_hash is null)
    or (
      last_request_idempotency_key is not null
      and char_length(last_request_idempotency_key) between 12 and 120
      and last_request_idempotency_key ~ '^[A-Za-z0-9._:-]+$'
      and last_request_hash ~ '^[0-9a-f]{64}$'
    )
  );

create unique index if not exists prelaunch_leads_last_idempotency_key_uidx
  on public.prelaunch_leads(last_request_idempotency_key)
  where last_request_idempotency_key is not null;
