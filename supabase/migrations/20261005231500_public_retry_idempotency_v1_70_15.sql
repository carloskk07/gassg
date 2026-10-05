-- TAMÃO V1.70.15 — idempotência para retries públicos ambíguos

alter table public.public_requests
  add column if not exists request_idempotency_key text,
  add column if not exists request_hash text;

alter table public.public_requests
  drop constraint if exists public_requests_idempotency_key_check,
  add constraint public_requests_idempotency_key_check
    check (
      request_idempotency_key is null
      or (
        char_length(request_idempotency_key) between 12 and 120
        and request_idempotency_key ~ '^[A-Za-z0-9._:-]+$'
      )
    ),
  drop constraint if exists public_requests_request_hash_check,
  add constraint public_requests_request_hash_check
    check (request_hash is null or request_hash ~ '^[0-9a-f]{64}$');

create unique index if not exists public_requests_idempotency_key_uidx
  on public.public_requests(request_idempotency_key)
  where request_idempotency_key is not null;

alter table public.prelaunch_leads
  add column if not exists last_submission_idempotency_key text,
  add column if not exists last_submission_hash text;

alter table public.prelaunch_leads
  drop constraint if exists prelaunch_leads_last_idempotency_key_check,
  add constraint prelaunch_leads_last_idempotency_key_check
    check (
      last_submission_idempotency_key is null
      or (
        char_length(last_submission_idempotency_key) between 12 and 120
        and last_submission_idempotency_key ~ '^[A-Za-z0-9._:-]+$'
      )
    ),
  drop constraint if exists prelaunch_leads_last_submission_hash_check,
  add constraint prelaunch_leads_last_submission_hash_check
    check (last_submission_hash is null or last_submission_hash ~ '^[0-9a-f]{64}$');

create unique index if not exists prelaunch_leads_last_submission_idempotency_uidx
  on public.prelaunch_leads(last_submission_idempotency_key)
  where last_submission_idempotency_key is not null;
