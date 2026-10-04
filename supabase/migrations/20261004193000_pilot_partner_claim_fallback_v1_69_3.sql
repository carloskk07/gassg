-- TAMÃO v1.69.3 — fallback autenticado para claim do convite piloto.
-- Exposição deliberadamente estreita: nenhuma tabela é aberta ao browser.
-- A identidade vem exclusivamente de auth.uid() e a autoridade interna
-- continua validando conta permanente, ownership da aplicação, expiração,
-- revogação, uso único e vínculo exclusivo com o rascunho.

create or replace function public.claim_my_pilot_partner_invite(
  p_application_id uuid,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_user_id uuid;
begin
  v_user_id:=auth.uid();

  if v_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode='42501';
  end if;

  return public.claim_pilot_partner_invite(
    v_user_id,
    p_application_id,
    p_token
  );
end;
$$;

revoke all on function public.claim_my_pilot_partner_invite(uuid,text)
  from public, anon, authenticated;
grant execute on function public.claim_my_pilot_partner_invite(uuid,text)
  to authenticated;
