-- TAMÃO V1.403: diagnóstico agregado de leitura apenas.
-- Não retorna nomes, e-mails, CNPJ, token, usuário ou identificadores de registros.
select
  (select count(*) from public.pilot_partner_drafts) as pilot_drafts,
  (select count(*) from public.pilot_partner_invites) as historical_invites,
  (select count(*) from public.pilot_partner_invites where revoked_at is not null) as revoked_invites,
  (select count(*) from public.pilot_partner_invites
   where revoked_at is null and claimed_at is null and expires_at>now()) as active_unclaimed_invites,
  (select count(*) from public.pilot_partner_invites where claimed_at is not null) as claimed_invites,
  (select count(*) from public.merchant_applications where status='pending') as pending_applications,
  (select count(*) from public.merchant_applications where pilot_partner_draft_id is not null) as linked_applications,
  (select count(*) from public.pilot_partner_invites i
   join public.merchant_applications a on a.id=i.application_id
   where i.claimed_at is not null and i.claimed_user_id=a.applicant_user_id
     and a.pilot_partner_draft_id=i.draft_id) as verified_claim_links,
  (select count(*) from public.pilot_partner_invites i
   left join public.merchant_applications a on a.id=i.application_id
   where i.claimed_at is not null and
     (a.id is null or a.applicant_user_id is distinct from i.claimed_user_id
      or a.pilot_partner_draft_id is distinct from i.draft_id)) as divergent_claim_links,
  (select count(*) from public.market_cities where commerce_enabled=true) as commerce_enabled_cities,
  (select count(*) from public.merchants where online=true) as online_merchants;
