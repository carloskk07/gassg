-- TAMÃO v1.69.1 — índices de apoio das FKs de convites piloto.
create index if not exists pilot_partner_invites_claimed_user_idx
  on public.pilot_partner_invites(claimed_user_id);
create index if not exists pilot_partner_invites_application_idx
  on public.pilot_partner_invites(application_id);
