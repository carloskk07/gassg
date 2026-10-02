-- Chama v1.31 — server-only sequence + pilot FK hardening.
-- Existing sequences created before default-ACL lockdown must be closed explicitly.
revoke all on all sequences in schema public from anon, authenticated;
grant usage, select on all sequences in schema public to service_role;

create index if not exists pilot_partner_drafts_merchant_idx
  on public.pilot_partner_drafts(merchant_id)
  where merchant_id is not null;
