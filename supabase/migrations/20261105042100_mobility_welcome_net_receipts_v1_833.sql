-- #823/#833 — comprovante e snapshot: preço bruto, desconto real, líquido.
alter table public.mobility_ride_receipts_v1_829
 drop constraint mobility_ride_receipts_v1_829_discount_cents_check;
alter table public.mobility_ride_receipts_v1_829
 add constraint mobility_ride_receipts_welcome_cap_v1_833
 check(discount_cents between 0 and 100);


-- Congela desconto e taxa sobre valor LIQUIDO quando passageiro aceita.
create or replace function public.mobility_fare_terms_on_accept_v1_832()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $$
declare
 v_participant boolean:=false;
 v_bps integer:=900;
 v_discount integer:=0;
 v_existing public.mobility_fare_terms_v1_832%rowtype;
begin
 if old.rider_accepted_at is not null or new.rider_accepted_at is null
 then return new;end if;
 select exists(
   select 1 from public.mobility_benefits_participation_v1_826 b
   where b.driver_id=new.driver_id and b.opted_in and b.terms_version=2
 ) into v_participant;
 if v_participant then v_bps:=800;end if;
 select coalesce(sum(u.amount_cents),0)::integer
 into v_discount from public.mobility_welcome_uses_v1_833 u
 where u.request_id=new.request_id and u.rider_id=new.rider_id
   and u.driver_id=new.driver_id and u.status='reserved';
 if v_discount>0 and not v_participant then
   raise exception 'MOBILITY_WELCOME_WITHOUT_DRIVER_CONSENT' using errcode='42501';
 end if;
 insert into public.mobility_fare_terms_v1_832(
  request_id,rider_id,driver_id,quote_version,gross_fare_cents,
  discount_cents,fee_bps,estimated_fee_cents,benefit_terms_version,accepted_at
 ) values(
  new.request_id,new.rider_id,new.driver_id,new.quote_version,new.fare_cents,
  v_discount,v_bps,
  round((new.fare_cents-v_discount)::numeric*v_bps/10000)::integer,
  case when v_participant then 2 else null end,new.rider_accepted_at
 )
 on conflict(request_id) do nothing;
 select * into v_existing from public.mobility_fare_terms_v1_832
 where request_id=new.request_id;
 if not found or v_existing.rider_id<>new.rider_id
  or v_existing.driver_id<>new.driver_id
  or v_existing.quote_version<>new.quote_version
  or v_existing.gross_fare_cents<>new.fare_cents
  or v_existing.discount_cents<>v_discount
  or v_existing.fee_bps<>v_bps
  or v_existing.payment_status<>'not_collected'
 then raise exception 'MOBILITY_FARE_TERMS_CONFLICT' using errcode='23505';end if;
 return new;
end;
$$;
revoke all on function public.mobility_fare_terms_on_accept_v1_832()
 from public,anon,authenticated;

-- Registra no recibo um desconto somente quando o beneficio foi reservado.
CREATE OR REPLACE FUNCTION public.mobility_ride_receipt_finalize_v1_829()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
 v_quote public.mobility_fare_quotes_v1_826%rowtype;
 v_prior public.mobility_ride_receipts_v1_829%rowtype;
 v_terms public.mobility_fare_terms_v1_832%rowtype;
 v_discount integer:=0;
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
   -- Nao cria valores imaginarios para viagens historicas pre-aceite.
   return new;
 end if;
 select * into v_terms from public.mobility_fare_terms_v1_832
 where request_id=new.id;
 if found then
   if v_terms.rider_id<>new.rider_id
    or v_terms.driver_id<>new.driver_id
    or v_terms.quote_version<>v_quote.quote_version
    or v_terms.gross_fare_cents<>v_quote.fare_cents
   then raise exception 'MOBILITY_DISCOUNT_TERMS_CONFLICT' using errcode='40001';end if;
   v_discount:=v_terms.discount_cents;
 end if;
 insert into public.mobility_ride_receipts_v1_829(
   request_id,rider_id,driver_id,listing_id,service,
   quote_version,agreed_fare_cents,discount_cents,payment_evidence
 )
 values(
   new.id,new.rider_id,new.driver_id,new.listing_id,new.service,
   v_quote.quote_version,v_quote.fare_cents,v_discount,'not_verified'
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
   or v_prior.discount_cents<>v_discount
   or v_prior.payment_evidence<>'not_verified'
 then
   raise exception 'MOBILITY_RECEIPT_CONFLICT' using errcode='23505';
 end if;
 return new;
end;
$function$

-- Exibe somente aos participantes, sem divulgar carteira a motorista.
CREATE OR REPLACE FUNCTION public.mobility_snapshot(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 select jsonb_build_object('id',r.id,'service',r.service,'status',
  case when r.expires_at<=statement_timestamp() and r.status in
   ('requested','accepted','en_route','arrived') then 'expired' else r.status end,
  'origin',r.origin_area,'destination',r.destination_area,
  'role',case when r.rider_id=(select auth.uid()) then 'rider' else 'driver' end,
  'expires_at',r.expires_at,'listing_title',l.title,
  'fare_cents',q.fare_cents,'fare_version',q.quote_version,
  'fare_accepted',q.rider_accepted_at is not null,
  'welcome_eligible',case
     when r.rider_id=(select auth.uid()) and r.status='accepted'
       and q.rider_accepted_at is null and q.fare_cents is not null
     then public.mobility_welcome_eligible_v1_833(r.rider_id,r.driver_id,q.fare_cents)
     else false end,
  'discount_cents',coalesce(f.discount_cents,0),
  'direct_due_cents',case when q.fare_cents is not null
    then q.fare_cents-coalesce(f.discount_cents,0) else null end,
  'fee_bps',f.fee_bps,
  'fee_payment_status',f.payment_status,
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
 left join public.mobility_fare_terms_v1_832 f on f.request_id=r.id
 where r.id=p_request_id and ((select auth.uid())=r.rider_id
  or (select auth.uid())=r.driver_id)
$function$
