-- TAMÃO #826 — fundação comercial SEGURA para moto/carro.
-- Não gera cobrança, saldo, repasse, desconto ou PSP sem preço aceito
-- e sem motor financeiro conciliado. Tarifa acordada é dado do serviço.
create table public.mobility_billing_plans_v1_826 (
  plan_key text primary key,
  display_name text not null,
  billing_mode text not null check (billing_mode in ('postpaid','prepaid')),
  purchase_amount_cents integer,
  platform_fee_bps integer not null check (platform_fee_bps between 1 and 10000),
  purchase_enabled boolean not null default false,
  sort_order integer not null,
  check (
    (billing_mode='postpaid' and purchase_amount_cents is null)
    or (billing_mode='prepaid' and purchase_amount_cents>0)
  )
);
alter table public.mobility_billing_plans_v1_826 enable row level security;
revoke all on public.mobility_billing_plans_v1_826 from public, anon, authenticated;
insert into public.mobility_billing_plans_v1_826
(plan_key,display_name,billing_mode,purchase_amount_cents,platform_fee_bps,purchase_enabled,sort_order)
values
('flex','Flex','postpaid',null,900,false,10),
('essential','Essencial','prepaid',990,600,false,20),
('popular','Popular','prepaid',2490,550,false,30),
('professional','Profissional','prepaid',4990,500,false,40);

create or replace function public.mobility_billing_catalog_v1_826()
returns jsonb language sql stable security definer
set search_path=pg_catalog
as $$
 select coalesce(jsonb_agg(jsonb_build_object(
   'key',plan_key,'name',display_name,'mode',billing_mode,
   'amountCents',purchase_amount_cents,'feeBps',platform_fee_bps,
   'purchaseEnabled',purchase_enabled
 ) order by sort_order),'[]'::jsonb)
 from public.mobility_billing_plans_v1_826;
$$;
revoke all on function public.mobility_billing_catalog_v1_826() from public;
grant execute on function public.mobility_billing_catalog_v1_826() to authenticated;

-- Consentimento para negociar benefícios; não autoriza desconto nem
-- altera taxa automaticamente. Os dois exigirão implementação transacional.
create table public.mobility_benefits_participation_v1_826 (
 driver_id uuid primary key references auth.users(id) on delete cascade,
 opted_in boolean not null default false,
 terms_version integer not null check(terms_version>=1),
 accepted_at timestamptz,
 revoked_at timestamptz,
 updated_at timestamptz not null default clock_timestamp(),
 check ((opted_in and accepted_at is not null)
         or (not opted_in))
);
alter table public.mobility_benefits_participation_v1_826 enable row level security;
revoke all on public.mobility_benefits_participation_v1_826 from public,anon,authenticated;

create or replace function public.mobility_benefits_participate_v1_826(
  p_opt_in boolean,p_terms_version integer
) returns jsonb language plpgsql security definer
set search_path=pg_catalog
as $$
declare v_driver uuid:=(select auth.uid());
 v_row public.mobility_benefits_participation_v1_826%rowtype;
begin
 if v_driver is null or not public.discovery_verified_account() then
  raise exception 'MOBILITY_AUTH_REQUIRED' using errcode='42501';
 end if;
 if p_opt_in is null or p_terms_version is distinct from 1 then
  raise exception 'MOBILITY_TERMS_VERSION_REQUIRED' using errcode='22023';
 end if;
 if not exists(
  select 1 from public.discovery_listings l
  join public.discovery_professional_details d on d.listing_id=l.id
  where l.owner_id=v_driver and l.vertical='professionals'
    and l.status='published'
    and d.occupation ~* '(motot[aá]xi|moto.?taxi|motorista|t[aá]xi|taxista)'
 ) then
   raise exception 'MOBILITY_DRIVER_LISTING_REQUIRED' using errcode='42501';
 end if;
 insert into public.mobility_benefits_participation_v1_826(
  driver_id,opted_in,terms_version,accepted_at,revoked_at,updated_at)
 values(v_driver,p_opt_in,1,
  case when p_opt_in then clock_timestamp() else null end,
  case when p_opt_in then null else clock_timestamp() end,clock_timestamp())
 on conflict(driver_id) do update set
  opted_in=excluded.opted_in,
  terms_version=excluded.terms_version,
  accepted_at=case when excluded.opted_in
     then coalesce(public.mobility_benefits_participation_v1_826.accepted_at,clock_timestamp())
     else public.mobility_benefits_participation_v1_826.accepted_at end,
  revoked_at=case when excluded.opted_in then null else clock_timestamp() end,
  updated_at=clock_timestamp()
 returning * into v_row;
 return jsonb_build_object('optedIn',v_row.opted_in,
  'termsVersion',v_row.terms_version,'acceptedAt',v_row.accepted_at);
end;
$$;
revoke all on function public.mobility_benefits_participate_v1_826(boolean,integer)
 from public,anon;
grant execute on function public.mobility_benefits_participate_v1_826(boolean,integer)
 to authenticated;

-- Preço informado e confirmado pelas duas pontas da MESMA solicitação.
create table public.mobility_fare_quotes_v1_826 (
  request_id uuid primary key references public.mobility_requests(id) on delete cascade,
  driver_id uuid not null references auth.users(id) on delete cascade,
  rider_id uuid not null references auth.users(id) on delete cascade,
  fare_cents integer not null check(fare_cents between 100 and 10000000),
  quote_version integer not null default 1 check(quote_version between 1 and 20),
  proposed_at timestamptz not null default clock_timestamp(),
  rider_accepted_at timestamptz
);
create index mobility_fare_quotes_rider_v1_826_idx on public.mobility_fare_quotes_v1_826(rider_id);
create index mobility_fare_quotes_driver_v1_826_idx on public.mobility_fare_quotes_v1_826(driver_id);
alter table public.mobility_fare_quotes_v1_826 enable row level security;
revoke all on public.mobility_fare_quotes_v1_826 from public,anon,authenticated;

create or replace function public.mobility_fare_propose_v1_826(
 p_request_id uuid,p_fare_cents integer
) returns jsonb language plpgsql security definer
set search_path=pg_catalog
as $$
declare v_user uuid:=(select auth.uid());
 v_request public.mobility_requests%rowtype;
 v_quote public.mobility_fare_quotes_v1_826%rowtype;
begin
 if v_user is null or not public.discovery_verified_account() then
   raise exception 'MOBILITY_AUTH_REQUIRED' using errcode='42501';
 end if;
 if p_fare_cents is null or p_fare_cents not between 100 and 10000000 then
   raise exception 'MOBILITY_FARE_INVALID' using errcode='22023';
 end if;
 select * into v_request from public.mobility_requests
 where id=p_request_id for update;
 if not found or v_request.driver_id<>v_user then
  raise exception 'MOBILITY_FARE_FORBIDDEN' using errcode='42501';
 end if;
 if v_request.status<>'accepted' or v_request.expires_at<=clock_timestamp() then
  raise exception 'MOBILITY_FARE_STATUS_INVALID' using errcode='40001';
 end if;
 select * into v_quote from public.mobility_fare_quotes_v1_826
 where request_id=p_request_id for update;
 if found then
  if v_quote.driver_id<>v_user or v_quote.rider_id<>v_request.rider_id then
   raise exception 'MOBILITY_FARE_PARTICIPANT_CHANGED' using errcode='42501';
  end if;
  if v_quote.rider_accepted_at is not null then
   if v_quote.fare_cents<>p_fare_cents then
    raise exception 'MOBILITY_FARE_ALREADY_ACCEPTED' using errcode='40001';
   end if;
  elsif v_quote.fare_cents<>p_fare_cents then
   if v_quote.quote_version>=20 then
    raise exception 'MOBILITY_FARE_TOO_MANY_CHANGES' using errcode='40001';
   end if;
   update public.mobility_fare_quotes_v1_826
   set fare_cents=p_fare_cents,quote_version=quote_version+1,
       proposed_at=clock_timestamp()
   where request_id=p_request_id returning * into v_quote;
  end if;
 else
  insert into public.mobility_fare_quotes_v1_826
   (request_id,driver_id,rider_id,fare_cents)
  values(p_request_id,v_user,v_request.rider_id,p_fare_cents)
  returning * into v_quote;
 end if;
 return jsonb_build_object('requestId',v_quote.request_id,
  'fareCents',v_quote.fare_cents,'version',v_quote.quote_version,
  'accepted',v_quote.rider_accepted_at is not null);
end;
$$;
revoke all on function public.mobility_fare_propose_v1_826(uuid,integer) from public,anon;
grant execute on function public.mobility_fare_propose_v1_826(uuid,integer) to authenticated;

create or replace function public.mobility_fare_accept_v1_826(
 p_request_id uuid,p_version integer
) returns jsonb language plpgsql security definer
set search_path=pg_catalog
as $$
declare v_user uuid:=(select auth.uid());
 v_request public.mobility_requests%rowtype;
 v_quote public.mobility_fare_quotes_v1_826%rowtype;
begin
 if v_user is null or not public.discovery_verified_account() then
  raise exception 'MOBILITY_AUTH_REQUIRED' using errcode='42501';
 end if;
 select * into v_request from public.mobility_requests
 where id=p_request_id for update;
 if not found or v_request.rider_id<>v_user then
  raise exception 'MOBILITY_FARE_FORBIDDEN' using errcode='42501';
 end if;
 if v_request.status<>'accepted' or v_request.expires_at<=clock_timestamp() then
  raise exception 'MOBILITY_FARE_STATUS_INVALID' using errcode='40001';
 end if;
 select * into v_quote from public.mobility_fare_quotes_v1_826
 where request_id=p_request_id for update;
 if not found or v_quote.driver_id<>v_request.driver_id
  or v_quote.rider_id<>v_user then
  raise exception 'MOBILITY_FARE_NOT_PROPOSED' using errcode='P0002';
 end if;
 if p_version is distinct from v_quote.quote_version then
  raise exception 'MOBILITY_FARE_CHANGED_REVIEW_REQUIRED' using errcode='40001';
 end if;
 if v_quote.rider_accepted_at is null then
  update public.mobility_fare_quotes_v1_826
  set rider_accepted_at=clock_timestamp()
  where request_id=p_request_id returning * into v_quote;
 end if;
 return jsonb_build_object('requestId',v_quote.request_id,
  'fareCents',v_quote.fare_cents,'version',v_quote.quote_version,
  'accepted',true);
end;
$$;
revoke all on function public.mobility_fare_accept_v1_826(uuid,integer) from public,anon;
grant execute on function public.mobility_fare_accept_v1_826(uuid,integer) to authenticated;

-- Reaproveita autoridade de leitura participante já existente.
-- Preço/aceite é visto SOMENTE por passageiro ou motorista da solicitação.
create or replace function public.mobility_snapshot(p_request_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog
as $$
 select jsonb_build_object('id',r.id,'service',r.service,'status',
  case when r.expires_at<=statement_timestamp() and r.status in
   ('requested','accepted','en_route','arrived') then 'expired' else r.status end,
  'origin',r.origin_area,'destination',r.destination_area,
  'role',case when r.rider_id=(select auth.uid()) then 'rider' else 'driver' end,
  'expires_at',r.expires_at,'listing_title',l.title,
  'fare_cents',q.fare_cents,'fare_version',q.quote_version,
  'fare_accepted',q.rider_accepted_at is not null,
  'driver_whatsapp',case
    when r.rider_id=(select auth.uid())
      and r.status in ('accepted','en_route','arrived')
      and r.expires_at>statement_timestamp()
      and l.whatsapp_e164 ~ '^\+[1-9][0-9]{9,14}$'
      and public.mobility_driver_category_current(r.listing_id,r.driver_id,r.service)
    then l.whatsapp_e164
    else null end,
  'position',
  case when r.status='en_route' and r.tracking_enabled and
   l.status='published' and exists(
    select 1 from public.discovery_vertical_cities c
     where c.vertical='professionals' and c.state_code=l.state_code
      and c.city_key=l.city_key and c.enabled
   ) and r.expires_at>statement_timestamp() and
   p.updated_at>statement_timestamp()-interval '45 seconds'
   then jsonb_build_object('lat',p.latitude,'lon',p.longitude,
    'accuracy_m',p.accuracy_m,'updated_at',p.updated_at) else null end)
 from public.mobility_requests r
 join public.discovery_listings l on l.id=r.listing_id
 left join public.mobility_live_positions p on p.request_id=r.id
 left join public.mobility_fare_quotes_v1_826 q on q.request_id=r.id
 where r.id=p_request_id and ((select auth.uid())=r.rider_id
  or (select auth.uid())=r.driver_id)
$$;
