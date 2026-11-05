-- TAMÃO #829 — recibo de tarifa contratada, sem alegar pagamento verificado.
-- O profissional recebe DIRETAMENTE: nenhuma cobrança da corrida passa ao TAMÃO.
-- Saldo promocional, taxa e conciliação serão registros separados e auditáveis.
create table public.mobility_ride_receipts_v1_829 (
 request_id uuid primary key references public.mobility_requests(id) on delete restrict,
 rider_id uuid not null references auth.users(id) on delete restrict,
 driver_id uuid not null references auth.users(id) on delete restrict,
 listing_id uuid not null references public.discovery_listings(id) on delete restrict,
 service text not null check (service in ('moto','carro')),
 quote_version integer not null check(quote_version between 1 and 20),
 agreed_fare_cents integer not null check(agreed_fare_cents between 100 and 10000000),
 discount_cents integer not null default 0 check(discount_cents>=0 and discount_cents<=agreed_fare_cents),
 direct_due_cents integer generated always as (agreed_fare_cents-discount_cents) stored,
 payment_evidence text not null default 'not_verified' check(payment_evidence='not_verified'),
 recorded_at timestamptz not null default clock_timestamp(),
 check(discount_cents=0) -- até integração validada, jamais simular desconto
);
create index mobility_receipts_driver_v1_829_idx
 on public.mobility_ride_receipts_v1_829(driver_id,recorded_at desc);
create index mobility_receipts_rider_v1_829_idx
 on public.mobility_ride_receipts_v1_829(rider_id,recorded_at desc);
create index mobility_receipts_listing_v1_829_idx
 on public.mobility_ride_receipts_v1_829(listing_id);
alter table public.mobility_ride_receipts_v1_829 enable row level security;
revoke all on public.mobility_ride_receipts_v1_829 from public,anon,authenticated;

create or replace function public.mobility_ride_receipt_immutable_v1_829()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $$
begin
 raise exception 'MOBILITY_RECEIPT_IMMUTABLE' using errcode='42501';
end;
$$;
revoke all on function public.mobility_ride_receipt_immutable_v1_829()
 from public,anon,authenticated;
create trigger mobility_ride_receipt_immutable_v1_829_trg
before update or delete on public.mobility_ride_receipts_v1_829
for each row execute function public.mobility_ride_receipt_immutable_v1_829();

create or replace function public.mobility_ride_receipt_finalize_v1_829()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $$
declare
 v_quote public.mobility_fare_quotes_v1_826%rowtype;
 v_prior public.mobility_ride_receipts_v1_829%rowtype;
begin
 if old.status is not distinct from new.status or new.status<>'completed'
 then return new;end if;
 select * into v_quote from public.mobility_fare_quotes_v1_826
 where request_id=new.id and rider_id=new.rider_id and driver_id=new.driver_id
   and rider_accepted_at is not null
 for share;
 if not found then
   if new.fare_confirmation_required then
     raise exception 'MOBILITY_RECEIPT_FARE_NOT_ACCEPTED' using errcode='40001';
   end if;
   -- Não cria valores imaginários para viagens históricas pré-aceite.
   return new;
 end if;
 insert into public.mobility_ride_receipts_v1_829(
   request_id,rider_id,driver_id,listing_id,service,
   quote_version,agreed_fare_cents,discount_cents,payment_evidence
 )
 values(
   new.id,new.rider_id,new.driver_id,new.listing_id,new.service,
   v_quote.quote_version,v_quote.fare_cents,0,'not_verified'
 )
 on conflict(request_id) do nothing;
 select * into v_prior from public.mobility_ride_receipts_v1_829
 where request_id=new.id;
 if not found
   or v_prior.rider_id is distinct from new.rider_id
   or v_prior.driver_id is distinct from new.driver_id
   or v_prior.listing_id is distinct from new.listing_id
   or v_prior.service is distinct from new.service
   or v_prior.quote_version is distinct from v_quote.quote_version
   or v_prior.agreed_fare_cents is distinct from v_quote.fare_cents
   or v_prior.discount_cents<>0
   or v_prior.payment_evidence<>'not_verified'
 then
   raise exception 'MOBILITY_RECEIPT_CONFLICT' using errcode='23505';
 end if;
 return new;
end;
$$;
revoke all on function public.mobility_ride_receipt_finalize_v1_829()
 from public,anon,authenticated;
create trigger mobility_ride_receipt_finalize_v1_829_trg
after update of status on public.mobility_requests
for each row execute function public.mobility_ride_receipt_finalize_v1_829();
