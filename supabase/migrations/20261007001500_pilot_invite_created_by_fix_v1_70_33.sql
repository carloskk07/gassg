-- TAMÃO V1.70.33 — corrige drift de schema da autoridade de convite piloto.
-- V1.70.28 passou a registrar o admin emissor em pilot_partner_invites.created_by,
-- mas a coluna não existia no schema real. Sem ela, emissão/rotação via painel falha.

alter table public.pilot_partner_invites
  add column if not exists created_by uuid
  references auth.users(id)
  on delete set null;

create index if not exists pilot_partner_invites_created_by_idx
  on public.pilot_partner_invites(created_by)
  where created_by is not null;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='pilot_partner_invites'
      and column_name='created_by'
      and data_type='uuid'
  ) then
    raise exception 'PILOT_INVITE_CREATED_BY_COLUMN_MISSING';
  end if;
end;
$$;
