-- #823/#832 — Programa de Benefícios Mobilidade: adesão voluntária real,
-- taxa Flex 9% -> 8%, contrato e snapshot econômico antes da viagem.
-- Nenhum valor é debitado, cobrado, reembolsado ou considerado pago aqui.
-- Condições v2 aprovadas para a adesão voluntária; não afetam contratos v1.
create table public.mobility_benefit_terms_v1_832 (
  terms_version integer primary key check(terms_version>=1),
  normal_fee_bps integer not null check(normal_fee_bps between 1 and 10000),
  member_fee_bps integer not null check(member_fee_bps between 1 and 10000),
  max_discount_cents integer not null check(max_discount_cents between 1 and 1000),
  terms_text text not null check(char_length(terms_text)>120),
  enabled boolean not null default false,
  recorded_at timestamptz not null default clock_timestamp(),
  check(member_fee_bps<normal_fee_bps)
);
alter table public.mobility_benefit_terms_v1_832 enable row level security;
revoke all on public.mobility_benefit_terms_v1_832 from public,anon,authenticated;
insert into public.mobility_benefit_terms_v1_832
 (terms_version,normal_fee_bps,member_fee_bps,max_discount_cents,terms_text,enabled)
values (2,900,800,100,
 'Adesão voluntária ao Programa de Benefícios TAMÃO para moto e carro. Ao participar, o motorista concorda em conceder até R$ 1,00 por corrida a passageiros que possuam benefício elegível e o utilizem antes da confirmação do preço; o cliente paga o valor líquido diretamente ao motorista. Esse desconto é integralmente custeado pelo motorista participante e NÃO será ressarcido pelo TAMÃO. Em contrapartida, a taxa Flex padrão de 9% passa a 8% sobre o valor líquido da corrida a partir da adesão, para corridas com tarifa aceita durante a vigência. A adesão e a saída são livres; o cancelamento afeta apenas novas tarifas confirmadas e não altera compromissos já aceitos. Planos pré-pagos de moto/carro não estão à venda neste momento. O TAMÃO não recebe o pagamento integral da corrida; a taxa da plataforma tem cobrança separada e não se presume quitada ao marcar uma corrida como concluída.',
 true);
create or replace function public.mobility_benefits_participate_v1_826(
 p_opt_in boolean,p_terms_version integer
) returns jsonb language plpgsql security definer
set search_path=pg_catalog
as $$
declare
 v_driver uuid:=(select auth.uid());
 v_row public.mobility_benefits_participation_v1_826%rowtype;
begin
 if v_driver is null or not public.discovery_verified_account() then
  raise exception 'MOBILITY_AUTH_REQUIRED' using errcode='42501';
 end if;
 if p_opt_in is null or p_terms_version is distinct from 2
 or not exists(select 1 from public.mobility_benefit_terms_v1_832 where terms_version=2 and enabled)
 then
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
 values(v_driver,p_opt_in,2,
  case when p_opt_in then clock_timestamp() else null end,
  case when p_opt_in then null else clock_timestamp() end,clock_timestamp())
 on conflict(driver_id) do update set
  opted_in=excluded.opted_in,terms_version=excluded.terms_version,
  accepted_at=case when excluded.opted_in then clock_timestamp()
    else public.mobility_benefits_participation_v1_826.accepted_at end,
  revoked_at=case when excluded.opted_in then null else clock_timestamp() end,
  updated_at=clock_timestamp()
 returning * into v_row;
 return jsonb_build_object('optedIn',v_row.opted_in,'termsVersion',v_row.terms_version,
  'acceptedAt',v_row.accepted_at,'updatedAt',v_row.updated_at);
end;
$$;
revoke all on function public.mobility_benefits_participate_v1_826(boolean,integer)
 from public,anon;
grant execute on function public.mobility_benefits_participate_v1_826(boolean,integer) to authenticated;

-- Mesmo catálogo autenticado já permitido pelo controle de ACL #826:
-- nenhuma nova função acessível a browser, nenhuma identidade alheia.
create or replace function public.mobility_billing_catalog_v1_826()
returns jsonb language sql stable security definer set search_path=pg_catalog
as $$
 select jsonb_build_object(
  'plans',coalesce((
    select jsonb_agg(jsonb_build_object(
      'key',p.plan_key,'name',p.display_name,'mode',p.billing_mode,
      'amountCents',p.purchase_amount_cents,'feeBps',p.platform_fee_bps,
      'purchaseEnabled',p.purchase_enabled
    ) order by p.sort_order)
    from public.mobility_billing_plans_v1_826 p
  ),'[]'::jsonb),
  'benefits',jsonb_build_object(
    'eligibleDriver',exists(
      select 1 from public.discovery_listings l
      join public.discovery_professional_details d on d.listing_id=l.id
      where l.owner_id=(select auth.uid()) and l.vertical='professionals'
        and l.status='published'
        and d.occupation ~* '(motot[aá]xi|moto.?taxi|motorista|t[aá]xi|taxista)'
    ),
    'optedIn',exists(
      select 1 from public.mobility_benefits_participation_v1_826 b
      where b.driver_id=(select auth.uid())
        and b.opted_in and b.terms_version=2
    ),
    'version',2,
    'normalFeeBps',900,
    'memberFeeBps',800,
    'maxDiscountCents',100,
    'termsText',(select t.terms_text from public.mobility_benefit_terms_v1_832 t
                 where t.terms_version=2 and t.enabled)
  )
 );
$$;
revoke all on function public.mobility_billing_catalog_v1_826() from public,anon;
grant execute on function public.mobility_billing_catalog_v1_826() to authenticated;

-- Snapshot aceito pelo passageiro: o percentual não muda depois que
-- o motorista cancela sua adesão; nenhum Pix ou crédito é criado.
create table public.mobility_fare_terms_v1_832 (
 request_id uuid primary key references public.mobility_requests(id) on delete restrict,
 rider_id uuid not null references auth.users(id) on delete restrict,
 driver_id uuid not null references auth.users(id) on delete restrict,
 quote_version integer not null check(quote_version between 1 and 20),
 gross_fare_cents integer not null check(gross_fare_cents between 100 and 10000000),
 discount_cents integer not null default 0 check(discount_cents>=0 and discount_cents<=gross_fare_cents),
 net_fare_cents integer generated always as (gross_fare_cents-discount_cents) stored,
 fee_bps integer not null check(fee_bps between 1 and 10000),
 estimated_fee_cents integer not null check(estimated_fee_cents>=0),
 benefit_terms_version integer,
 payment_status text not null default 'not_collected'
     check(payment_status='not_collected'),
 accepted_at timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp()
);
alter table public.mobility_fare_terms_v1_832 enable row level security;
revoke all on public.mobility_fare_terms_v1_832 from public,anon,authenticated;

create or replace function public.mobility_fare_terms_immutable_v1_832()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $$
begin
 raise exception 'MOBILITY_FARE_TERMS_IMMUTABLE' using errcode='42501';
end;
$$;
revoke all on function public.mobility_fare_terms_immutable_v1_832() from public,anon,authenticated;
create trigger mobility_fare_terms_immutable_v1_832_trg
before update or delete on public.mobility_fare_terms_v1_832
for each row execute function public.mobility_fare_terms_immutable_v1_832();

create or replace function public.mobility_fare_terms_on_accept_v1_832()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $$
declare
 v_participant boolean:=false;
 v_bps integer:=900;
 v_existing public.mobility_fare_terms_v1_832%rowtype;
begin
 if old.rider_accepted_at is not null or new.rider_accepted_at is null
 then return new;end if;
 select exists(
   select 1 from public.mobility_benefits_participation_v1_826 b
   where b.driver_id=new.driver_id and b.opted_in and b.terms_version=2
 ) into v_participant;
 if v_participant then v_bps:=800;end if;
 insert into public.mobility_fare_terms_v1_832(
  request_id,rider_id,driver_id,quote_version,gross_fare_cents,
  discount_cents,fee_bps,estimated_fee_cents,benefit_terms_version,accepted_at
 ) values(
  new.request_id,new.rider_id,new.driver_id,new.quote_version,new.fare_cents,
  0,v_bps,round(new.fare_cents::numeric*v_bps/10000)::integer,
  case when v_participant then 2 else null end,new.rider_accepted_at
 )
 on conflict(request_id) do nothing;
 select * into v_existing from public.mobility_fare_terms_v1_832
 where request_id=new.request_id;
 if not found or v_existing.rider_id<>new.rider_id
  or v_existing.driver_id<>new.driver_id
  or v_existing.quote_version<>new.quote_version
  or v_existing.gross_fare_cents<>new.fare_cents
  or v_existing.discount_cents<>0
  or v_existing.fee_bps<>v_bps
  or v_existing.payment_status<>'not_collected'
 then raise exception 'MOBILITY_FARE_TERMS_CONFLICT' using errcode='23505';end if;
 return new;
end;
$$;
revoke all on function public.mobility_fare_terms_on_accept_v1_832() from public,anon,authenticated;
create trigger mobility_fare_terms_on_accept_v1_832_trg
after update of rider_accepted_at on public.mobility_fare_quotes_v1_826
for each row execute function public.mobility_fare_terms_on_accept_v1_832();

-- Verificação de termos para que nunca sejam cobrados como quitados.
do $$
begin
 if (select count(*) from public.mobility_billing_plans_v1_826 where plan_key='flex'
      and platform_fee_bps=900 and purchase_enabled=false)<>1
 or (select count(*) from public.mobility_benefit_terms_v1_832
      where terms_version=2 and enabled and normal_fee_bps=900
        and member_fee_bps=800 and max_discount_cents=100)<>1
 then raise exception 'MOBILITY_BENEFITS_POLICY_MISMATCH';end if;
end $$;
