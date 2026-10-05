-- TAMÃO V1.70.12 — idempotência para submissões públicas pré-auth.
-- Evita duplicar solicitações/contagens quando a resposta do primeiro POST se perde
-- e o navegador repete a mesma operação.

alter table public.public_requests
  add column if not exists request_key_hash text,
  add column if not exists request_fingerprint_hash text;

alter table public.public_requests
  drop constraint if exists public_requests_request_key_hash_check,
  add constraint public_requests_request_key_hash_check
    check (request_key_hash is null or request_key_hash ~ '^[0-9a-f]{64}$');

alter table public.public_requests
  drop constraint if exists public_requests_request_fingerprint_hash_check,
  add constraint public_requests_request_fingerprint_hash_check
    check (request_fingerprint_hash is null or request_fingerprint_hash ~ '^[0-9a-f]{64}$');

create unique index if not exists public_requests_request_key_hash_uidx
  on public.public_requests(request_key_hash)
  where request_key_hash is not null;

alter table public.prelaunch_leads
  add column if not exists last_submission_key_hash text,
  add column if not exists last_submission_fingerprint_hash text;

alter table public.prelaunch_leads
  drop constraint if exists prelaunch_leads_last_submission_key_hash_check,
  add constraint prelaunch_leads_last_submission_key_hash_check
    check (last_submission_key_hash is null or last_submission_key_hash ~ '^[0-9a-f]{64}$');

alter table public.prelaunch_leads
  drop constraint if exists prelaunch_leads_last_submission_fingerprint_hash_check,
  add constraint prelaunch_leads_last_submission_fingerprint_hash_check
    check (
      last_submission_fingerprint_hash is null
      or last_submission_fingerprint_hash ~ '^[0-9a-f]{64}$'
    );

create unique index if not exists prelaunch_leads_last_submission_key_hash_uidx
  on public.prelaunch_leads(last_submission_key_hash)
  where last_submission_key_hash is not null;

revoke all on table public.public_requests, public.prelaunch_leads
from public, anon, authenticated;

grant all on table public.public_requests, public.prelaunch_leads
to service_role;
