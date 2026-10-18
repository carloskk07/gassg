-- TAMÃO | Núcleo único de descoberta: serviços, caronas e hospedagens.
-- Escopo isolado do marketplace. Nada nesta migração abre cidades, ativa cobranças
-- nem interfere em pedidos, revendas, comissões ou permissões preexistentes.
-- Aplicar apenas junto ao código integrado, testes e plano de ativação.

create table public.discovery_vertical_cities (
  vertical text not null check (vertical in ('professionals','rides','stays')),
  state_code text not null check (state_code ~ '^[A-Z]{2}$'),
  city_key text not null check (city_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  city_name text not null check (length(btrim(city_name)) between 2 and 120),
  enabled boolean not null default false,
  changed_by uuid references auth.users(id),
  change_reason text not null default '',
  changed_at timestamptz not null default now(),
  primary key (vertical,state_code,city_key)
);

create table public.discovery_listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  vertical text not null check (vertical in ('professionals','rides','stays')),
  status text not null default 'draft'
    check (status in ('draft','review','published','paused','rejected')),
  title text not null check (length(btrim(title)) between 8 and 120),
  description text not null check (length(btrim(description)) between 30 and 3500),
  state_code text not null check (state_code ~ '^[A-Z]{2}$'),
  city_key text not null check (city_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  city_name text not null check (length(btrim(city_name)) between 2 and 120),
  public_area text check (length(public_area)<=140),
  -- Nunca armazenar endereço residencial preciso como localização pública.
  whatsapp_e164 text not null check (whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  photo_urls text[] not null default '{}',
  trial_ends_at timestamptz,
  advertising_accepted_at timestamptz,
  submitted_at timestamptz,
  published_at timestamptz,
  paused_at timestamptz,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discovery_photos_max check (cardinality(photo_urls)<=18),
  constraint discovery_listing_owner_vertical_unique unique (id,owner_id,vertical)
);
create index discovery_listing_discovery_idx
  on public.discovery_listings(vertical,state_code,city_key,published_at desc)
  where status='published';
create index discovery_listing_owner_idx
  on public.discovery_listings(owner_id,updated_at desc);

create table public.discovery_professional_details (
  listing_id uuid primary key references public.discovery_listings(id) on delete cascade,
  occupation text not null check (length(btrim(occupation)) between 3 and 100),
  service_area text not null check (length(btrim(service_area)) between 3 and 200),
  years_experience integer check (years_experience between 0 and 80),
  licensing_claim text check (length(licensing_claim)<=180),
  updated_at timestamptz not null default now()
);

create table public.discovery_ride_details (
  listing_id uuid primary key references public.discovery_listings(id) on delete cascade,
  departure_state text not null check (departure_state ~ '^[A-Z]{2}$'),
  departure_city text not null check (length(btrim(departure_city)) between 2 and 120),
  destination_state text not null check (destination_state ~ '^[A-Z]{2}$'),
  destination_city text not null check (length(btrim(destination_city)) between 2 and 120),
  departure_at timestamptz not null,
  seats_total integer not null check (seats_total between 1 and 8),
  seats_available integer not null check (seats_available between 0 and seats_total),
  proposed_cost_share_cents integer check (proposed_cost_share_cents between 0 and 500000),
  route_notes text check (length(route_notes)<=600),
  updated_at timestamptz not null default now()
);

create index discovery_ride_route_idx
  on public.discovery_ride_details(departure_state,departure_city,destination_state,destination_city,departure_at);

create table public.discovery_stay_details (
  listing_id uuid primary key references public.discovery_listings(id) on delete cascade,
  property_type text not null check (property_type in
    ('hotel','inn','holiday_house','beach_house','apartment','cabin','country_house','other')),
  guests integer not null check (guests between 1 and 80),
  bedrooms integer not null check (bedrooms between 0 and 60),
  beds integer not null check (beds between 1 and 120),
  units integer not null default 1 check (units between 1 and 250),
  amenities text[] not null default '{}',
  price_from_brl_cents integer check (price_from_brl_cents between 0 and 50000000),
  price_unit text check (price_unit in ('night','stay','week')),
  availability_confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint discovery_stay_amenity_limit check (cardinality(amenities)<=40),
  constraint discovery_stay_price_unit_pair check
    ((price_from_brl_cents is null)=(price_unit is null))
);

-- A publicidade permanece um produto do TAMÃO, não a contratação do serviço.
-- Nenhum processo automático de cobrança é criado por esta migração.
create table public.discovery_advertising_terms (
  vertical text primary key check (vertical in ('professionals','stays')),
  daily_rate_brl_cents integer not null check (daily_rate_brl_cents>=0),
  free_days integer not null default 0 check (free_days between 0 and 365),
  enabled boolean not null default false,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);
create table public.discovery_advertising_daily_ledger (
  listing_id uuid not null references public.discovery_listings(id),
  billable_day date not null,
  amount_brl_cents integer not null check (amount_brl_cents>=0),
  terms_snapshot jsonb not null,
  recorded_at timestamptz not null default now(),
  primary key (listing_id,billable_day)
);

create table public.discovery_moderation_log (
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.discovery_listings(id),
  from_status text not null,
  to_status text not null,
  actor_id uuid not null references auth.users(id),
  reason text,
  created_at timestamptz not null default now()
);

-- Estruturas servidor-first: todas fechadas por padrão e sem acesso anônimo
-- a documentos, moderação, políticas comerciais ou cobrança.
alter table public.discovery_vertical_cities enable row level security;
alter table public.discovery_listings enable row level security;
alter table public.discovery_professional_details enable row level security;
alter table public.discovery_ride_details enable row level security;
alter table public.discovery_stay_details enable row level security;
alter table public.discovery_advertising_terms enable row level security;
alter table public.discovery_advertising_daily_ledger enable row level security;
alter table public.discovery_moderation_log enable row level security;

revoke all on public.discovery_vertical_cities from public,anon,authenticated;
revoke all on public.discovery_listings from public,anon,authenticated;
revoke all on public.discovery_professional_details from public,anon,authenticated;
revoke all on public.discovery_ride_details from public,anon,authenticated;
revoke all on public.discovery_stay_details from public,anon,authenticated;
revoke all on public.discovery_advertising_terms from public,anon,authenticated;
revoke all on public.discovery_advertising_daily_ledger from public,anon,authenticated;
revoke all on public.discovery_moderation_log from public,anon,authenticated;

-- A navegação pública mostra SOMENTE anúncios publicados em locais autorizados.
-- Dados privados, moderação e identificação documental ficam fora dessas tabelas.
create policy discovery_public_or_owned on public.discovery_listings
 for select to anon,authenticated using (
  (status='published' and exists(
    select 1 from public.discovery_vertical_cities c
    where c.vertical=discovery_listings.vertical
      and c.state_code=discovery_listings.state_code
      and c.city_key=discovery_listings.city_key and c.enabled
  )) or ((select auth.uid())=owner_id)
 );
create policy discovery_enabled_cities on public.discovery_vertical_cities
 for select to anon,authenticated using (enabled);
grant select (vertical,state_code,city_key,city_name,enabled)
 on public.discovery_vertical_cities to anon,authenticated;

grant select (id,vertical,status,title,description,state_code,city_key,city_name,
  public_area,whatsapp_e164,photo_urls,published_at,created_at,updated_at)
 on public.discovery_listings to anon,authenticated;
-- Propriedade é visível aos titulares autenticados para políticas de escrita;
-- identidade do dono não é publicada aos visitantes anônimos.
grant select (owner_id) on public.discovery_listings to authenticated;

-- Detalhes só aparecem quando o anúncio-mãe é público, ou para seu proprietário.
create policy discovery_professional_visible on public.discovery_professional_details
 for select to anon,authenticated using (
  exists(select 1 from public.discovery_listings l where l.id=listing_id)
 );
create policy discovery_ride_visible on public.discovery_ride_details
 for select to anon,authenticated using (
  exists(select 1 from public.discovery_listings l where l.id=listing_id)
 );
create policy discovery_stay_visible on public.discovery_stay_details
 for select to anon,authenticated using (
  exists(select 1 from public.discovery_listings l where l.id=listing_id)
 );
grant select on public.discovery_professional_details to anon,authenticated;
grant select on public.discovery_ride_details to anon,authenticated;
grant select on public.discovery_stay_details to anon,authenticated;

-- Apenas contas permanentes com e-mail ou telefone confirmado podem anunciar.
create function public.discovery_verified_account()
returns boolean language sql stable security definer set search_path='pg_catalog'
as $
  select exists(
    select 1 from auth.users u where u.id=(select auth.uid())
      and not u.is_anonymous
      and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
  )
$;
revoke all on function public.discovery_verified_account() from public;
grant execute on function public.discovery_verified_account() to authenticated;

-- Fluxos de cadastro preservam proprietário e nunca permitem autopublicação.
create policy discovery_owner_draft_insert on public.discovery_listings
 for insert to authenticated with check (
   (select auth.uid())=owner_id and status='draft'
   and (select public.discovery_verified_account())
   and submitted_at is null and published_at is null
   and reviewed_by is null and reviewed_at is null
   and advertising_accepted_at is null
 );
create policy discovery_owner_draft_edit on public.discovery_listings
 for update to authenticated using (
   (select auth.uid())=owner_id and status in ('draft','rejected','paused')
 ) with check (
   (select auth.uid())=owner_id and status in ('draft','rejected','paused')
 );
grant insert (vertical,title,description,state_code,city_key,city_name,
  public_area,whatsapp_e164,photo_urls) on public.discovery_listings to authenticated;
grant update (title,description,state_code,city_key,city_name,
  public_area,whatsapp_e164,photo_urls,updated_at)
 on public.discovery_listings to authenticated;

-- Um usuário jamais poderá escrever detalhes de anúncio de outra pessoa
-- ou alterar detalhes já aprovados sem nova moderação.
create policy discovery_professional_draft_insert on public.discovery_professional_details
 for insert to authenticated with check (
   exists (select 1 from public.discovery_listings l where l.id=listing_id
       and l.owner_id=(select auth.uid()) and l.status in ('draft','rejected','paused') and l.vertical='professionals')
 );
create policy discovery_professional_draft_update on public.discovery_professional_details
 for update to authenticated using (
   exists (select 1 from public.discovery_listings l where l.id=listing_id
       and l.owner_id=(select auth.uid()) and l.status in ('draft','rejected','paused') and l.vertical='professionals')
 ) with check (
   exists (select 1 from public.discovery_listings l where l.id=listing_id
       and l.owner_id=(select auth.uid()) and l.status in ('draft','rejected','paused') and l.vertical='professionals')
 );
create policy discovery_ride_draft_insert on public.discovery_ride_details
 for insert to authenticated with check (
   exists (select 1 from public.discovery_listings l where l.id=listing_id
       and l.owner_id=(select auth.uid()) and l.status in ('draft','rejected','paused') and l.vertical='rides')
 );
create policy discovery_ride_draft_update on public.discovery_ride_details
 for update to authenticated using (
   exists (select 1 from public.discovery_listings l where l.id=listing_id
       and l.owner_id=(select auth.uid()) and l.status in ('draft','rejected','paused') and l.vertical='rides')
 ) with check (
   exists (select 1 from public.discovery_listings l where l.id=listing_id
       and l.owner_id=(select auth.uid()) and l.status in ('draft','rejected','paused') and l.vertical='rides')
 );
create policy discovery_stay_draft_insert on public.discovery_stay_details
 for insert to authenticated with check (
   exists (select 1 from public.discovery_listings l where l.id=listing_id
       and l.owner_id=(select auth.uid()) and l.status in ('draft','rejected','paused') and l.vertical='stays')
 );
create policy discovery_stay_draft_update on public.discovery_stay_details
 for update to authenticated using (
   exists (select 1 from public.discovery_listings l where l.id=listing_id
       and l.owner_id=(select auth.uid()) and l.status in ('draft','rejected','paused') and l.vertical='stays')
 ) with check (
   exists (select 1 from public.discovery_listings l where l.id=listing_id
       and l.owner_id=(select auth.uid()) and l.status in ('draft','rejected','paused') and l.vertical='stays')
 );
grant insert,update on public.discovery_professional_details to authenticated;
grant insert,update on public.discovery_ride_details to authenticated;
grant insert,update on public.discovery_stay_details to authenticated;

-- Propostas não são automaticamente publicadas. Ativação, revisão e auditoria
-- usam autoridade explícita do administrador principal.
create function public.discovery_set_vertical_city(
  p_vertical text,p_state text,p_city_key text,p_city_name text,
  p_enabled boolean,p_reason text
) returns void language plpgsql security definer set search_path='pg_catalog'
as $$
declare v_actor uuid:=(select auth.uid());
begin
  if v_actor is null or not exists(
    select 1 from public.platform_admins a
    where a.user_id=v_actor and a.active and a.admin_role='superadmin'
  ) then raise exception 'ADMIN_REQUIRED' using errcode='42501';end if;
  if length(btrim(coalesce(p_reason,'')))<8 then
    raise exception 'REASON_REQUIRED' using errcode='22023';end if;
  insert into public.discovery_vertical_cities(
    vertical,state_code,city_key,city_name,enabled,changed_by,change_reason,changed_at
  ) values (
    p_vertical,p_state,p_city_key,p_city_name,p_enabled,v_actor,p_reason,clock_timestamp()
  ) on conflict(vertical,state_code,city_key)
    do update set enabled=excluded.enabled,city_name=excluded.city_name,
      changed_by=excluded.changed_by,change_reason=excluded.change_reason,
      changed_at=excluded.changed_at;
end $$;
revoke all on function public.discovery_set_vertical_city(text,text,text,text,boolean,text) from public;
grant execute on function public.discovery_set_vertical_city(text,text,text,text,boolean,text)
 to authenticated;

create function public.discovery_transition_listing(
  p_listing_id uuid,p_next_status text,p_reason text default ''
) returns text language plpgsql security definer set search_path='pg_catalog'
as $$
declare
 v_actor uuid:=(select auth.uid());
 v_listing public.discovery_listings%rowtype;
 v_admin boolean;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode='42501';end if;
  select * into v_listing from public.discovery_listings where id=p_listing_id for update;
  if not found then raise exception 'LISTING_NOT_FOUND' using errcode='P0002';end if;
  v_admin:=exists(select 1 from public.platform_admins a
       where a.user_id=v_actor and a.active and a.admin_role='superadmin');
  if p_next_status=v_listing.status then return v_listing.status;end if;
  if p_next_status='review' then
    if v_actor<>v_listing.owner_id or v_listing.status not in ('draft','rejected','paused')
       then raise exception 'OWNER_DRAFT_REQUIRED' using errcode='42501';end if;
    if cardinality(v_listing.photo_urls)<1 or exists(
      select 1 from unnest(v_listing.photo_urls) u
       where u !~ '^https://[^[:space:]]+$'
    ) then raise exception 'REAL_PHOTO_REQUIRED' using errcode='22023';end if;
    if not (
     (v_listing.vertical='professionals' and exists(
      select 1 from public.discovery_professional_details where listing_id=p_listing_id)) or
     (v_listing.vertical='rides' and exists(
      select 1 from public.discovery_ride_details where listing_id=p_listing_id
        and departure_at>clock_timestamp() and seats_available>0)) or
     (v_listing.vertical='stays' and exists(
      select 1 from public.discovery_stay_details where listing_id=p_listing_id))
    ) then raise exception 'LISTING_DETAILS_REQUIRED' using errcode='22023';end if;
  elsif p_next_status in ('published','rejected','paused') then
    if not v_admin and not (
      p_next_status='paused' and v_actor=v_listing.owner_id
      and v_listing.status='published'
    ) then raise exception 'ADMIN_REQUIRED' using errcode='42501';end if;
    if v_admin and length(btrim(coalesce(p_reason,'')))<8 then
      raise exception 'REASON_REQUIRED' using errcode='22023';end if;
    if p_next_status='published' then
      if cardinality(v_listing.photo_urls)<1 or exists(
        select 1 from unnest(v_listing.photo_urls) u
        where u !~ '^https://[^[:space:]]+$'
      ) then raise exception 'REAL_PHOTO_REQUIRED' using errcode='22023';end if;
      if v_listing.vertical='rides' and not exists(
        select 1 from public.discovery_ride_details r
        where r.listing_id=p_listing_id and r.departure_at>clock_timestamp()
          and r.seats_available>0
      ) then raise exception 'EXPIRED_OR_FULL_RIDE' using errcode='22023';end if;
      if v_listing.status not in ('review','paused') then
        raise exception 'LISTING_REVIEW_REQUIRED' using errcode='22023';end if;
      if not exists (
        select 1 from public.discovery_vertical_cities c where c.vertical=v_listing.vertical
        and c.state_code=v_listing.state_code and c.city_key=v_listing.city_key and c.enabled
      ) then raise exception 'CITY_VERTICAL_DISABLED' using errcode='22023';end if;
    end if;
  else
    raise exception 'INVALID_TRANSITION' using errcode='22023';
  end if;
  update public.discovery_listings set status=p_next_status,updated_at=clock_timestamp(),
    submitted_at=case when p_next_status='review' then clock_timestamp() else submitted_at end,
    published_at=case when p_next_status='published' then clock_timestamp() else published_at end,
    paused_at=case when p_next_status='paused' then clock_timestamp() else paused_at end,
    reviewed_by=case when v_admin then v_actor else reviewed_by end,
    reviewed_at=case when v_admin then clock_timestamp() else reviewed_at end
  where id=p_listing_id;
  insert into public.discovery_moderation_log(listing_id,from_status,to_status,actor_id,reason)
  values(p_listing_id,v_listing.status,p_next_status,v_actor,nullif(btrim(p_reason),''));
  return p_next_status;
end $$;
revoke all on function public.discovery_transition_listing(uuid,text,text) from public;
grant execute on function public.discovery_transition_listing(uuid,text,text)
 to authenticated;

-- Sem seeds artificiais, cobrança automática, publicação automática ou
-- abertura comercial implícita. Caronas nunca entram na tabela de tarifas.
