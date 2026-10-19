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
as $$
  select exists(
    select 1 from auth.users u where u.id=(select auth.uid())
      and not u.is_anonymous
      and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
  )
$$;
revoke all on function public.discovery_verified_account() from public;
grant execute on function public.discovery_verified_account() to authenticated;

-- Public marketing photos only; identification/licensing documents require private storage.
-- Owners can upload new images, but have no overwrite/delete/list privilege.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('tamao-discovery-photos','tamao-discovery-photos',true,5242880,
 array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy discovery_photo_owned_insert on storage.objects
for insert to authenticated with check (
 bucket_id='tamao-discovery-photos'
 and owner_id=(select auth.uid())::text
 and split_part(name,'/',1)=(select auth.uid())::text
 and split_part(name,'/',2) ~ '^[0-9a-f-]{36}[.](jpg|jpeg|png|webp)$'
 and name !~ '/.*/'
 and (select public.discovery_verified_account())
);
-- photo_urls stores Storage keys, never remotely hosted images/URLs.
create function public.discovery_verified_photo_paths(p_listing_id uuid)
returns boolean language sql stable security definer set search_path='pg_catalog'
as $$
 select coalesce((
  select cardinality(l.photo_urls) between 1 and 18 and not exists (
   select 1 from unnest(l.photo_urls) as ph(path)
   where ph.path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.](jpg|jpeg|png|webp)$'
      or split_part(ph.path,'/',1)<>l.owner_id::text
      or not exists (
        select 1 from storage.objects o
        where o.bucket_id='tamao-discovery-photos' and o.name=ph.path
          and o.owner_id=l.owner_id::text
          and o.metadata->>'mimetype' in ('image/jpeg','image/png','image/webp')
      )
  ) from public.discovery_listings l where l.id=p_listing_id
 ),false)
$$;
revoke all on function public.discovery_verified_photo_paths(uuid) from public,anon,authenticated;


-- Fotos em uploads incompletos podem ser removidas somente se nenhuma
-- listagem desse dono referenciar o objeto. As fotos publicadas permanecem
-- protegidas mesmo se o anunciante tentar deletá-las diretamente na Storage API.
create function public.discovery_photo_unreferenced(p_path text)
returns boolean language sql stable security definer set search_path='pg_catalog'
as $photo_cleanup$
 select (select auth.uid()) is not null and not exists(
   select 1 from public.discovery_listings l
   where l.owner_id=(select auth.uid()) and p_path=any(l.photo_urls)
 )
$photo_cleanup$;
revoke all on function public.discovery_photo_unreferenced(text) from public,anon,authenticated;
grant execute on function public.discovery_photo_unreferenced(text) to authenticated;

-- Atomic edit: concurrent forms must not replace one another's photo arrays.
-- Locked listing prevents lost updates when one user removes a photo while
-- another editor session adds a different photo.
create function public.discovery_unlink_listing_photo(
  p_listing_id uuid,p_photo_path text
) returns text[]
language plpgsql security definer set search_path='pg_catalog'
as $photo_unlink$
declare
  v_actor uuid:=(select auth.uid());
  v_listing public.discovery_listings%rowtype;
  v_remaining text[];
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode='42501';
  end if;
  select * into v_listing from public.discovery_listings
   where id=p_listing_id for update;
  if not found then
    raise exception 'LISTING_NOT_FOUND' using errcode='P0002';
  end if;
  if v_listing.owner_id<>v_actor or v_listing.status not in ('draft','rejected') then
    raise exception 'OWNER_DRAFT_REQUIRED' using errcode='42501';
  end if;
  if p_photo_path is null
     or p_photo_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.](jpg|jpeg|png|webp)create policy discovery_photo_owner_read on storage.objects
 for select to authenticated using (
   bucket_id='tamao-discovery-photos'
   and owner_id=(select auth.uid())::text
 );
create policy discovery_photo_orphan_cleanup on storage.objects
 for delete to authenticated using (
   bucket_id='tamao-discovery-photos'
   and owner_id=(select auth.uid())::text
   and split_part(name,'/',1)=(select auth.uid())::text
   and (select public.discovery_photo_unreferenced(name))
 );

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
   (select auth.uid())=owner_id and status in ('draft','rejected')
 ) with check (
   (select auth.uid())=owner_id and status in ('draft','rejected')
 );
grant insert (vertical,title,description,state_code,city_key,city_name,
  public_area,whatsapp_e164,photo_urls) on public.discovery_listings to authenticated;
grant update (title,description,state_code,city_key,city_name,
  public_area,whatsapp_e164,photo_urls,updated_at)
 on public.discovery_listings to authenticated;

-- Encapsula a verificação de dono sem publicar UUIDs de usuários.
-- A exceção SECURITY DEFINER só consulta o anúncio pertencente ao auth.uid().
create function public.discovery_owner_can_edit_details(
  p_listing_id uuid,p_vertical text
) returns boolean language sql stable security definer set search_path='pg_catalog'
as $$
  select exists(select 1 from public.discovery_listings l
    where l.id=p_listing_id and l.owner_id=(select auth.uid())
      and l.vertical=p_vertical and l.status in ('draft','rejected'))
$$;
revoke all on function public.discovery_owner_can_edit_details(uuid,text) from public;
grant execute on function public.discovery_owner_can_edit_details(uuid,text)
  to authenticated;

-- Um usuário jamais poderá escrever detalhes de anúncio de outra pessoa
-- ou alterar detalhes já aprovados sem nova moderação.
create policy discovery_professional_draft_insert on public.discovery_professional_details
 for insert to authenticated with check (
   (select public.discovery_owner_can_edit_details(listing_id,'professionals'))
 );
create policy discovery_professional_draft_update on public.discovery_professional_details
 for update to authenticated using (
   (select public.discovery_owner_can_edit_details(listing_id,'professionals'))
 ) with check (
   (select public.discovery_owner_can_edit_details(listing_id,'professionals'))
 );
create policy discovery_ride_draft_insert on public.discovery_ride_details
 for insert to authenticated with check (
   (select public.discovery_owner_can_edit_details(listing_id,'rides'))
 );
create policy discovery_ride_draft_update on public.discovery_ride_details
 for update to authenticated using (
   (select public.discovery_owner_can_edit_details(listing_id,'rides'))
 ) with check (
   (select public.discovery_owner_can_edit_details(listing_id,'rides'))
 );
create policy discovery_stay_draft_insert on public.discovery_stay_details
 for insert to authenticated with check (
   (select public.discovery_owner_can_edit_details(listing_id,'stays'))
 );
create policy discovery_stay_draft_update on public.discovery_stay_details
 for update to authenticated using (
   (select public.discovery_owner_can_edit_details(listing_id,'stays'))
 ) with check (
   (select public.discovery_owner_can_edit_details(listing_id,'stays'))
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
  if p_next_status='draft' then
    -- Changes to a paused/rejected advertisement require a new review.
    -- No owner may modify a paused approved listing without withdrawing it.
    if v_actor<>v_listing.owner_id or v_listing.status not in ('paused','rejected')
      then raise exception 'OWNER_REOPEN_REQUIRED' using errcode='42501';end if;
  elsif p_next_status='review' then
    if v_actor<>v_listing.owner_id or v_listing.status not in ('draft','rejected','paused')
       then raise exception 'OWNER_DRAFT_REQUIRED' using errcode='42501';end if;
    if not public.discovery_verified_photo_paths(p_listing_id) then raise exception 'REAL_PHOTO_REQUIRED' using errcode='22023';end if;
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
      if not public.discovery_verified_photo_paths(p_listing_id) then raise exception 'REAL_PHOTO_REQUIRED' using errcode='22023';end if;
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
    submitted_at=case when p_next_status='draft' then null when p_next_status='review' then clock_timestamp() else submitted_at end,
    published_at=case when p_next_status='draft' then null when p_next_status='published' then clock_timestamp() else published_at end,
    paused_at=case when p_next_status='paused' then clock_timestamp() else paused_at end,
    reviewed_by=case when p_next_status='draft' then null when v_admin then v_actor else reviewed_by end,
    reviewed_at=case when p_next_status='draft' then null when v_admin then clock_timestamp() else reviewed_at end
  where id=p_listing_id;
  insert into public.discovery_moderation_log(listing_id,from_status,to_status,actor_id,reason)
  values(p_listing_id,v_listing.status,p_next_status,v_actor,nullif(btrim(p_reason),''));
  return p_next_status;
end $$;
revoke all on function public.discovery_transition_listing(uuid,text,text) from public;
grant execute on function public.discovery_transition_listing(uuid,text,text)
 to authenticated;


-- O anunciante lista apenas os próprios registros, inclusive rascunhos,
-- sem expor owner_id nem depender de filtros externos em coluna privada.
create function public.discovery_my_listings()
returns table(
 id uuid,vertical text,status text,title text,description text,
 state_code text,city_key text,city_name text,public_area text,
 whatsapp_e164 text,photo_urls text[],submitted_at timestamptz,
 published_at timestamptz,updated_at timestamptz
) language sql stable security definer set search_path='pg_catalog'
as $$
 select l.id,l.vertical,l.status,l.title,l.description,l.state_code,
   l.city_key,l.city_name,l.public_area,l.whatsapp_e164,l.photo_urls,
   l.submitted_at,l.published_at,l.updated_at
 from public.discovery_listings l where l.owner_id=(select auth.uid())
 order by l.updated_at desc,l.id desc limit 100
$$;
revoke all on function public.discovery_my_listings() from public,anon,authenticated;
grant execute on function public.discovery_my_listings() to authenticated;


-- The existing verified superadmin identity is the only reviewer.
-- Exposes pending commercial content, never documents, owner IDs or payment data.
create function public.discovery_admin_review_queue(p_limit integer default 50)
returns table(
 id uuid,vertical text,status text,title text,description text,
 state_code text,city_key text,city_name text,public_area text,
 whatsapp_e164 text,photo_urls text[],submitted_at timestamptz,
 occupation text,departure_city text,destination_city text,
 departure_at timestamptz,seats_available integer,
 property_type text,guests integer,price_from_brl_cents integer,
 city_vertical_enabled boolean
) language plpgsql stable security definer set search_path='pg_catalog'
as $$
begin
 if (select auth.uid()) is null or not exists(
   select 1 from public.platform_admins a
   where a.user_id=(select auth.uid()) and a.active and a.admin_role='superadmin'
 ) then raise exception 'ADMIN_REQUIRED' using errcode='42501';end if;
 return query
 select l.id,l.vertical,l.status,l.title,l.description,l.state_code,
  l.city_key,l.city_name,l.public_area,l.whatsapp_e164,l.photo_urls,l.submitted_at,
  pro.occupation,r.departure_city,r.destination_city,r.departure_at,
  r.seats_available,st.property_type,st.guests,st.price_from_brl_cents,
  exists(select 1 from public.discovery_vertical_cities c
    where c.vertical=l.vertical and c.state_code=l.state_code
      and c.city_key=l.city_key and c.enabled)
 from public.discovery_listings l
 left join public.discovery_professional_details pro
   on pro.listing_id=l.id and l.vertical='professionals'
 left join public.discovery_ride_details r
   on r.listing_id=l.id and l.vertical='rides'
 left join public.discovery_stay_details st
   on st.listing_id=l.id and l.vertical='stays'
 where l.status='review'
 order by l.submitted_at,l.id
 limit greatest(1,least(coalesce(p_limit,50),100));
end $$;
revoke all on function public.discovery_admin_review_queue(integer)
 from public,anon,authenticated;
grant execute on function public.discovery_admin_review_queue(integer) to authenticated;

-- Contrato público de descoberta: uma busca segura, sem dados de proprietários,
-- sem misturar as três jornadas e sem confiar em um índice geográfico do marketplace.
create function public.discovery_public_search(
  p_vertical text default null,
  p_state_code text default null,
  p_city_key text default null,
  p_departure_city text default null,
  p_destination_city text default null,
  p_departure_after timestamptz default null,
  p_min_guests integer default null,
  p_limit integer default 20
) returns table(
  id uuid,vertical text,title text,description text,
  state_code text,city_key text,city_name text,public_area text,
  whatsapp_e164 text,photo_urls text[],published_at timestamptz,
  occupation text,departure_city text,destination_city text,
  departure_at timestamptz,seats_available integer,
  property_type text,guests integer,bedrooms integer,
  price_from_brl_cents integer,price_unit text
) language sql stable security invoker set search_path='pg_catalog'
as $$
 select
  l.id,l.vertical,l.title,l.description,l.state_code,l.city_key,l.city_name,
  l.public_area,l.whatsapp_e164,l.photo_urls,l.published_at,
  pro.occupation,r.departure_city,r.destination_city,r.departure_at,
  r.seats_available,st.property_type,st.guests,st.bedrooms,
  st.price_from_brl_cents,st.price_unit
 from public.discovery_listings l
 left join public.discovery_professional_details pro
   on pro.listing_id=l.id and l.vertical='professionals'
 left join public.discovery_ride_details r
   on r.listing_id=l.id and l.vertical='rides'
 left join public.discovery_stay_details st
   on st.listing_id=l.id and l.vertical='stays'
 where l.status='published'
   and (p_vertical is null or l.vertical=p_vertical)
   and (p_state_code is null or l.state_code=p_state_code)
   and (p_city_key is null or l.city_key=p_city_key)
   and exists(select 1 from public.discovery_vertical_cities c
      where c.vertical=l.vertical and c.state_code=l.state_code
        and c.city_key=l.city_key and c.enabled)
   and (l.vertical<>'rides' or
     (r.departure_at>statement_timestamp() and r.seats_available>0))
   and (p_departure_city is null or
      (l.vertical='rides' and lower(r.departure_city)=lower(p_departure_city)))
   and (p_destination_city is null or
      (l.vertical='rides' and lower(r.destination_city)=lower(p_destination_city)))
   and (p_departure_after is null or
      (l.vertical='rides' and r.departure_at>=p_departure_after))
   and (p_min_guests is null or
      (l.vertical='stays' and st.guests>=p_min_guests))
 order by l.published_at desc,l.id desc
 limit greatest(1,least(coalesce(p_limit,20),50))
$$;
revoke all on function public.discovery_public_search(
  text,text,text,text,text,timestamptz,integer,integer) from public;
grant execute on function public.discovery_public_search(
  text,text,text,text,text,timestamptz,integer,integer) to anon,authenticated;

-- Sem seeds artificiais, cobrança automática, publicação automática ou
-- abertura comercial implícita. Caronas nunca entram na tabela de tarifas.

-- PRIVATE EVIDENCE: never reuse the public marketing-photo bucket for identity,
-- licence or accommodation documents. No disclosure to anon or public search.
create function public.discovery_is_superadmin()
returns boolean language sql stable security definer set search_path='pg_catalog'
as $$
 select (select auth.uid()) is not null and exists(
   select 1 from public.platform_admins a
   where a.user_id=(select auth.uid()) and a.active and a.admin_role='superadmin')
$$;
revoke all on function public.discovery_is_superadmin() from public,anon,authenticated;
grant execute on function public.discovery_is_superadmin() to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('tamao-discovery-documents','tamao-discovery-documents',false,10485760,
 array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,
 allowed_mime_types=excluded.allowed_mime_types;

-- The JWT identity is checked inside definer helpers so Storage RLS does
-- not require exposing the listing owner UUID column to clients.
create function public.discovery_document_editable(p_listing text)
returns boolean language sql stable security definer set search_path='pg_catalog'
as $$
 select (select auth.uid()) is not null and exists(
   select 1 from public.discovery_listings l
   where l.id::text=p_listing and l.owner_id=(select auth.uid())
     and l.status in ('draft','rejected'))
$$;
revoke all on function public.discovery_document_editable(text) from public,anon,authenticated;
grant execute on function public.discovery_document_editable(text) to authenticated;

create function public.discovery_document_owned(p_listing text)
returns boolean language sql stable security definer set search_path='pg_catalog'
as $$
 select (select auth.uid()) is not null and exists(
   select 1 from public.discovery_listings l
   where l.id::text=p_listing and l.owner_id=(select auth.uid()))
$$;
revoke all on function public.discovery_document_owned(text) from public,anon,authenticated;
grant execute on function public.discovery_document_owned(text) to authenticated;

create table public.discovery_documents(
 id uuid primary key default gen_random_uuid(),
 listing_id uuid not null references public.discovery_listings(id) on delete cascade,
 owner_id uuid not null default auth.uid() references auth.users(id),
 kind text not null default 'supporting' check (kind in ('supporting','licence','registration','identity')),
 object_path text not null unique check (
   object_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.](pdf|jpg|jpeg|png|webp)$'),
 created_at timestamptz not null default now()
);
create index discovery_documents_listing_idx on public.discovery_documents(listing_id,created_at);
alter table public.discovery_documents enable row level security;
revoke all on public.discovery_documents from public,anon,authenticated;
create policy discovery_document_owner_or_admin_read on public.discovery_documents
 for select to authenticated using (
   owner_id=(select auth.uid()) or (select public.discovery_is_superadmin())
 );
create policy discovery_document_owner_insert on public.discovery_documents
 for insert to authenticated with check (
   owner_id=(select auth.uid()) and (select public.discovery_verified_account())
   and split_part(object_path,'/',1)=owner_id::text
   and split_part(object_path,'/',2)=listing_id::text
   and (select public.discovery_document_editable(listing_id::text))
   and exists(select 1 from storage.objects o
     where o.bucket_id='tamao-discovery-documents'
       and o.name=object_path and o.owner_id=owner_id::text)
 );
-- Proprietário só pode remover comprovantes em rascunho ou rejeitados.
-- A exclusão dos bytes é feita pela Storage API ANTES dos metadados.
create policy discovery_document_owner_delete on public.discovery_documents
 for delete to authenticated using (
   owner_id=(select auth.uid())
   and (select public.discovery_document_editable(listing_id::text))
 );
grant select,delete on public.discovery_documents to authenticated;
grant insert(listing_id,kind,object_path) on public.discovery_documents to authenticated;

-- Impede exclusão por REST dos metadados enquanto os bytes continuam no
-- Storage. Excluir o objeto pela API primeiro, depois sua referência privada.
create function public.discovery_require_storage_removed()
returns trigger language plpgsql security definer set search_path='pg_catalog'
as $docguard$
begin
 if exists(
   select 1 from storage.objects o
   where o.bucket_id='tamao-discovery-documents' and o.name=old.object_path
 ) then
   raise exception 'DELETE_STORAGE_FIRST' using errcode='22023';
 end if;
 return old;
end $docguard$;
revoke all on function public.discovery_require_storage_removed() from public,anon,authenticated;
create trigger discovery_document_delete_after_storage
 before delete on public.discovery_documents
 for each row execute function public.discovery_require_storage_removed();

-- Definer lookup breaks the policy cycle (documents INSERT -> storage SELECT
-- -> documents SELECT) and never returns the document itself.
create function public.discovery_document_registered(p_path text)
returns boolean language sql stable security definer set search_path='pg_catalog'
as $$
 select (select public.discovery_is_superadmin()) and exists(
   select 1 from public.discovery_documents d where d.object_path=p_path)
$$;
revoke all on function public.discovery_document_registered(text) from public,anon,authenticated;
grant execute on function public.discovery_document_registered(text) to authenticated;

-- Upload is immutable and tied to an editable listing owned by the JWT user.
-- A different advertiser cannot place documents in someone else's folder.
create policy discovery_document_storage_insert on storage.objects
 for insert to authenticated with check (
   bucket_id='tamao-discovery-documents'
   and owner_id=(select auth.uid())::text
   and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.](pdf|jpg|jpeg|png|webp)$'
   and split_part(name,'/',1)=(select auth.uid())::text
   and (select public.discovery_verified_account())
   and (select public.discovery_document_editable(split_part(name,'/',2)))
 );
-- SELECT is required for authorised short-lived signed URLs; no UPDATE/DELETE.
-- Administrators can retrieve only documents actually registered in the ledger.
create policy discovery_document_storage_read on storage.objects
 for select to authenticated using (
   bucket_id='tamao-discovery-documents' and (
     (owner_id=(select auth.uid())::text
       and (select public.discovery_document_owned(split_part(name,'/',2))))
     or (select public.discovery_document_registered(name))
   )
 );

-- Exclusão explicitamente restrita ao proprietário de um rascunho editável.
-- Nenhuma operação de update/upsert é permitida; apagar bytes pela Storage API.
create policy discovery_document_storage_delete on storage.objects
 for delete to authenticated using (
   bucket_id='tamao-discovery-documents'
   and owner_id=(select auth.uid())::text
   and split_part(name,'/',1)=(select auth.uid())::text
   and (select public.discovery_document_editable(split_part(name,'/',2)))
 );

     or split_part(p_photo_path,'/',1)<>v_actor::text
     or not (p_photo_path=any(v_listing.photo_urls)) then
    raise exception 'PHOTO_NOT_IN_DRAFT' using errcode='22023';
  end if;
  update public.discovery_listings
    set photo_urls=array_remove(v_listing.photo_urls,p_photo_path),
        updated_at=clock_timestamp()
    where id=p_listing_id
    returning photo_urls into v_remaining;
  return v_remaining;
end
$photo_unlink$;
revoke all on function public.discovery_unlink_listing_photo(uuid,text) from public,anon,authenticated;
grant execute on function public.discovery_unlink_listing_photo(uuid,text) to authenticated;
create policy discovery_photo_owner_read on storage.objects
 for select to authenticated using (
   bucket_id='tamao-discovery-photos'
   and owner_id=(select auth.uid())::text
 );
create policy discovery_photo_orphan_cleanup on storage.objects
 for delete to authenticated using (
   bucket_id='tamao-discovery-photos'
   and owner_id=(select auth.uid())::text
   and split_part(name,'/',1)=(select auth.uid())::text
   and (select public.discovery_photo_unreferenced(name))
 );

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
   (select auth.uid())=owner_id and status in ('draft','rejected')
 ) with check (
   (select auth.uid())=owner_id and status in ('draft','rejected')
 );
grant insert (vertical,title,description,state_code,city_key,city_name,
  public_area,whatsapp_e164,photo_urls) on public.discovery_listings to authenticated;
grant update (title,description,state_code,city_key,city_name,
  public_area,whatsapp_e164,photo_urls,updated_at)
 on public.discovery_listings to authenticated;

-- Encapsula a verificação de dono sem publicar UUIDs de usuários.
-- A exceção SECURITY DEFINER só consulta o anúncio pertencente ao auth.uid().
create function public.discovery_owner_can_edit_details(
  p_listing_id uuid,p_vertical text
) returns boolean language sql stable security definer set search_path='pg_catalog'
as $$
  select exists(select 1 from public.discovery_listings l
    where l.id=p_listing_id and l.owner_id=(select auth.uid())
      and l.vertical=p_vertical and l.status in ('draft','rejected'))
$$;
revoke all on function public.discovery_owner_can_edit_details(uuid,text) from public;
grant execute on function public.discovery_owner_can_edit_details(uuid,text)
  to authenticated;

-- Um usuário jamais poderá escrever detalhes de anúncio de outra pessoa
-- ou alterar detalhes já aprovados sem nova moderação.
create policy discovery_professional_draft_insert on public.discovery_professional_details
 for insert to authenticated with check (
   (select public.discovery_owner_can_edit_details(listing_id,'professionals'))
 );
create policy discovery_professional_draft_update on public.discovery_professional_details
 for update to authenticated using (
   (select public.discovery_owner_can_edit_details(listing_id,'professionals'))
 ) with check (
   (select public.discovery_owner_can_edit_details(listing_id,'professionals'))
 );
create policy discovery_ride_draft_insert on public.discovery_ride_details
 for insert to authenticated with check (
   (select public.discovery_owner_can_edit_details(listing_id,'rides'))
 );
create policy discovery_ride_draft_update on public.discovery_ride_details
 for update to authenticated using (
   (select public.discovery_owner_can_edit_details(listing_id,'rides'))
 ) with check (
   (select public.discovery_owner_can_edit_details(listing_id,'rides'))
 );
create policy discovery_stay_draft_insert on public.discovery_stay_details
 for insert to authenticated with check (
   (select public.discovery_owner_can_edit_details(listing_id,'stays'))
 );
create policy discovery_stay_draft_update on public.discovery_stay_details
 for update to authenticated using (
   (select public.discovery_owner_can_edit_details(listing_id,'stays'))
 ) with check (
   (select public.discovery_owner_can_edit_details(listing_id,'stays'))
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
  if p_next_status='draft' then
    -- Changes to a paused/rejected advertisement require a new review.
    -- No owner may modify a paused approved listing without withdrawing it.
    if v_actor<>v_listing.owner_id or v_listing.status not in ('paused','rejected')
      then raise exception 'OWNER_REOPEN_REQUIRED' using errcode='42501';end if;
  elsif p_next_status='review' then
    if v_actor<>v_listing.owner_id or v_listing.status not in ('draft','rejected','paused')
       then raise exception 'OWNER_DRAFT_REQUIRED' using errcode='42501';end if;
    if not public.discovery_verified_photo_paths(p_listing_id) then raise exception 'REAL_PHOTO_REQUIRED' using errcode='22023';end if;
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
      if not public.discovery_verified_photo_paths(p_listing_id) then raise exception 'REAL_PHOTO_REQUIRED' using errcode='22023';end if;
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
    submitted_at=case when p_next_status='draft' then null when p_next_status='review' then clock_timestamp() else submitted_at end,
    published_at=case when p_next_status='draft' then null when p_next_status='published' then clock_timestamp() else published_at end,
    paused_at=case when p_next_status='paused' then clock_timestamp() else paused_at end,
    reviewed_by=case when p_next_status='draft' then null when v_admin then v_actor else reviewed_by end,
    reviewed_at=case when p_next_status='draft' then null when v_admin then clock_timestamp() else reviewed_at end
  where id=p_listing_id;
  insert into public.discovery_moderation_log(listing_id,from_status,to_status,actor_id,reason)
  values(p_listing_id,v_listing.status,p_next_status,v_actor,nullif(btrim(p_reason),''));
  return p_next_status;
end $$;
revoke all on function public.discovery_transition_listing(uuid,text,text) from public;
grant execute on function public.discovery_transition_listing(uuid,text,text)
 to authenticated;


-- O anunciante lista apenas os próprios registros, inclusive rascunhos,
-- sem expor owner_id nem depender de filtros externos em coluna privada.
create function public.discovery_my_listings()
returns table(
 id uuid,vertical text,status text,title text,description text,
 state_code text,city_key text,city_name text,public_area text,
 whatsapp_e164 text,photo_urls text[],submitted_at timestamptz,
 published_at timestamptz,updated_at timestamptz
) language sql stable security definer set search_path='pg_catalog'
as $$
 select l.id,l.vertical,l.status,l.title,l.description,l.state_code,
   l.city_key,l.city_name,l.public_area,l.whatsapp_e164,l.photo_urls,
   l.submitted_at,l.published_at,l.updated_at
 from public.discovery_listings l where l.owner_id=(select auth.uid())
 order by l.updated_at desc,l.id desc limit 100
$$;
revoke all on function public.discovery_my_listings() from public,anon,authenticated;
grant execute on function public.discovery_my_listings() to authenticated;


-- The existing verified superadmin identity is the only reviewer.
-- Exposes pending commercial content, never documents, owner IDs or payment data.
create function public.discovery_admin_review_queue(p_limit integer default 50)
returns table(
 id uuid,vertical text,status text,title text,description text,
 state_code text,city_key text,city_name text,public_area text,
 whatsapp_e164 text,photo_urls text[],submitted_at timestamptz,
 occupation text,departure_city text,destination_city text,
 departure_at timestamptz,seats_available integer,
 property_type text,guests integer,price_from_brl_cents integer,
 city_vertical_enabled boolean
) language plpgsql stable security definer set search_path='pg_catalog'
as $$
begin
 if (select auth.uid()) is null or not exists(
   select 1 from public.platform_admins a
   where a.user_id=(select auth.uid()) and a.active and a.admin_role='superadmin'
 ) then raise exception 'ADMIN_REQUIRED' using errcode='42501';end if;
 return query
 select l.id,l.vertical,l.status,l.title,l.description,l.state_code,
  l.city_key,l.city_name,l.public_area,l.whatsapp_e164,l.photo_urls,l.submitted_at,
  pro.occupation,r.departure_city,r.destination_city,r.departure_at,
  r.seats_available,st.property_type,st.guests,st.price_from_brl_cents,
  exists(select 1 from public.discovery_vertical_cities c
    where c.vertical=l.vertical and c.state_code=l.state_code
      and c.city_key=l.city_key and c.enabled)
 from public.discovery_listings l
 left join public.discovery_professional_details pro
   on pro.listing_id=l.id and l.vertical='professionals'
 left join public.discovery_ride_details r
   on r.listing_id=l.id and l.vertical='rides'
 left join public.discovery_stay_details st
   on st.listing_id=l.id and l.vertical='stays'
 where l.status='review'
 order by l.submitted_at,l.id
 limit greatest(1,least(coalesce(p_limit,50),100));
end $$;
revoke all on function public.discovery_admin_review_queue(integer)
 from public,anon,authenticated;
grant execute on function public.discovery_admin_review_queue(integer) to authenticated;

-- Contrato público de descoberta: uma busca segura, sem dados de proprietários,
-- sem misturar as três jornadas e sem confiar em um índice geográfico do marketplace.
create function public.discovery_public_search(
  p_vertical text default null,
  p_state_code text default null,
  p_city_key text default null,
  p_departure_city text default null,
  p_destination_city text default null,
  p_departure_after timestamptz default null,
  p_min_guests integer default null,
  p_limit integer default 20
) returns table(
  id uuid,vertical text,title text,description text,
  state_code text,city_key text,city_name text,public_area text,
  whatsapp_e164 text,photo_urls text[],published_at timestamptz,
  occupation text,departure_city text,destination_city text,
  departure_at timestamptz,seats_available integer,
  property_type text,guests integer,bedrooms integer,
  price_from_brl_cents integer,price_unit text
) language sql stable security invoker set search_path='pg_catalog'
as $$
 select
  l.id,l.vertical,l.title,l.description,l.state_code,l.city_key,l.city_name,
  l.public_area,l.whatsapp_e164,l.photo_urls,l.published_at,
  pro.occupation,r.departure_city,r.destination_city,r.departure_at,
  r.seats_available,st.property_type,st.guests,st.bedrooms,
  st.price_from_brl_cents,st.price_unit
 from public.discovery_listings l
 left join public.discovery_professional_details pro
   on pro.listing_id=l.id and l.vertical='professionals'
 left join public.discovery_ride_details r
   on r.listing_id=l.id and l.vertical='rides'
 left join public.discovery_stay_details st
   on st.listing_id=l.id and l.vertical='stays'
 where l.status='published'
   and (p_vertical is null or l.vertical=p_vertical)
   and (p_state_code is null or l.state_code=p_state_code)
   and (p_city_key is null or l.city_key=p_city_key)
   and exists(select 1 from public.discovery_vertical_cities c
      where c.vertical=l.vertical and c.state_code=l.state_code
        and c.city_key=l.city_key and c.enabled)
   and (l.vertical<>'rides' or
     (r.departure_at>statement_timestamp() and r.seats_available>0))
   and (p_departure_city is null or
      (l.vertical='rides' and lower(r.departure_city)=lower(p_departure_city)))
   and (p_destination_city is null or
      (l.vertical='rides' and lower(r.destination_city)=lower(p_destination_city)))
   and (p_departure_after is null or
      (l.vertical='rides' and r.departure_at>=p_departure_after))
   and (p_min_guests is null or
      (l.vertical='stays' and st.guests>=p_min_guests))
 order by l.published_at desc,l.id desc
 limit greatest(1,least(coalesce(p_limit,20),50))
$$;
revoke all on function public.discovery_public_search(
  text,text,text,text,text,timestamptz,integer,integer) from public;
grant execute on function public.discovery_public_search(
  text,text,text,text,text,timestamptz,integer,integer) to anon,authenticated;

-- Sem seeds artificiais, cobrança automática, publicação automática ou
-- abertura comercial implícita. Caronas nunca entram na tabela de tarifas.

-- PRIVATE EVIDENCE: never reuse the public marketing-photo bucket for identity,
-- licence or accommodation documents. No disclosure to anon or public search.
create function public.discovery_is_superadmin()
returns boolean language sql stable security definer set search_path='pg_catalog'
as $$
 select (select auth.uid()) is not null and exists(
   select 1 from public.platform_admins a
   where a.user_id=(select auth.uid()) and a.active and a.admin_role='superadmin')
$$;
revoke all on function public.discovery_is_superadmin() from public,anon,authenticated;
grant execute on function public.discovery_is_superadmin() to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('tamao-discovery-documents','tamao-discovery-documents',false,10485760,
 array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,
 allowed_mime_types=excluded.allowed_mime_types;

-- The JWT identity is checked inside definer helpers so Storage RLS does
-- not require exposing the listing owner UUID column to clients.
create function public.discovery_document_editable(p_listing text)
returns boolean language sql stable security definer set search_path='pg_catalog'
as $$
 select (select auth.uid()) is not null and exists(
   select 1 from public.discovery_listings l
   where l.id::text=p_listing and l.owner_id=(select auth.uid())
     and l.status in ('draft','rejected'))
$$;
revoke all on function public.discovery_document_editable(text) from public,anon,authenticated;
grant execute on function public.discovery_document_editable(text) to authenticated;

create function public.discovery_document_owned(p_listing text)
returns boolean language sql stable security definer set search_path='pg_catalog'
as $$
 select (select auth.uid()) is not null and exists(
   select 1 from public.discovery_listings l
   where l.id::text=p_listing and l.owner_id=(select auth.uid()))
$$;
revoke all on function public.discovery_document_owned(text) from public,anon,authenticated;
grant execute on function public.discovery_document_owned(text) to authenticated;

create table public.discovery_documents(
 id uuid primary key default gen_random_uuid(),
 listing_id uuid not null references public.discovery_listings(id) on delete cascade,
 owner_id uuid not null default auth.uid() references auth.users(id),
 kind text not null default 'supporting' check (kind in ('supporting','licence','registration','identity')),
 object_path text not null unique check (
   object_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.](pdf|jpg|jpeg|png|webp)$'),
 created_at timestamptz not null default now()
);
create index discovery_documents_listing_idx on public.discovery_documents(listing_id,created_at);
alter table public.discovery_documents enable row level security;
revoke all on public.discovery_documents from public,anon,authenticated;
create policy discovery_document_owner_or_admin_read on public.discovery_documents
 for select to authenticated using (
   owner_id=(select auth.uid()) or (select public.discovery_is_superadmin())
 );
create policy discovery_document_owner_insert on public.discovery_documents
 for insert to authenticated with check (
   owner_id=(select auth.uid()) and (select public.discovery_verified_account())
   and split_part(object_path,'/',1)=owner_id::text
   and split_part(object_path,'/',2)=listing_id::text
   and (select public.discovery_document_editable(listing_id::text))
   and exists(select 1 from storage.objects o
     where o.bucket_id='tamao-discovery-documents'
       and o.name=object_path and o.owner_id=owner_id::text)
 );
-- Proprietário só pode remover comprovantes em rascunho ou rejeitados.
-- A exclusão dos bytes é feita pela Storage API ANTES dos metadados.
create policy discovery_document_owner_delete on public.discovery_documents
 for delete to authenticated using (
   owner_id=(select auth.uid())
   and (select public.discovery_document_editable(listing_id::text))
 );
grant select,delete on public.discovery_documents to authenticated;
grant insert(listing_id,kind,object_path) on public.discovery_documents to authenticated;

-- Impede exclusão por REST dos metadados enquanto os bytes continuam no
-- Storage. Excluir o objeto pela API primeiro, depois sua referência privada.
create function public.discovery_require_storage_removed()
returns trigger language plpgsql security definer set search_path='pg_catalog'
as $docguard$
begin
 if exists(
   select 1 from storage.objects o
   where o.bucket_id='tamao-discovery-documents' and o.name=old.object_path
 ) then
   raise exception 'DELETE_STORAGE_FIRST' using errcode='22023';
 end if;
 return old;
end $docguard$;
revoke all on function public.discovery_require_storage_removed() from public,anon,authenticated;
create trigger discovery_document_delete_after_storage
 before delete on public.discovery_documents
 for each row execute function public.discovery_require_storage_removed();

-- Definer lookup breaks the policy cycle (documents INSERT -> storage SELECT
-- -> documents SELECT) and never returns the document itself.
create function public.discovery_document_registered(p_path text)
returns boolean language sql stable security definer set search_path='pg_catalog'
as $$
 select (select public.discovery_is_superadmin()) and exists(
   select 1 from public.discovery_documents d where d.object_path=p_path)
$$;
revoke all on function public.discovery_document_registered(text) from public,anon,authenticated;
grant execute on function public.discovery_document_registered(text) to authenticated;

-- Upload is immutable and tied to an editable listing owned by the JWT user.
-- A different advertiser cannot place documents in someone else's folder.
create policy discovery_document_storage_insert on storage.objects
 for insert to authenticated with check (
   bucket_id='tamao-discovery-documents'
   and owner_id=(select auth.uid())::text
   and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.](pdf|jpg|jpeg|png|webp)$'
   and split_part(name,'/',1)=(select auth.uid())::text
   and (select public.discovery_verified_account())
   and (select public.discovery_document_editable(split_part(name,'/',2)))
 );
-- SELECT is required for authorised short-lived signed URLs; no UPDATE/DELETE.
-- Administrators can retrieve only documents actually registered in the ledger.
create policy discovery_document_storage_read on storage.objects
 for select to authenticated using (
   bucket_id='tamao-discovery-documents' and (
     (owner_id=(select auth.uid())::text
       and (select public.discovery_document_owned(split_part(name,'/',2))))
     or (select public.discovery_document_registered(name))
   )
 );

-- Exclusão explicitamente restrita ao proprietário de um rascunho editável.
-- Nenhuma operação de update/upsert é permitida; apagar bytes pela Storage API.
create policy discovery_document_storage_delete on storage.objects
 for delete to authenticated using (
   bucket_id='tamao-discovery-documents'
   and owner_id=(select auth.uid())::text
   and split_part(name,'/',1)=(select auth.uid())::text
   and (select public.discovery_document_editable(split_part(name,'/',2)))
 );
