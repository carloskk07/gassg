-- TAMÃO #835: uma taxa estimada de plataforma por corrida realmente concluída.
-- Pagamento da corrida é DIRETO ao motorista e não confirmado pelo TAMÃO.
-- Nenhuma linha desse livro-razão equivale a um Pix emitido ou a taxa quitada.
create table public.mobility_platform_fee_accruals_v1_835(
 request_id uuid primary key references public.mobility_ride_receipts_v1_829(request_id) on delete restrict,
 driver_id uuid not null references auth.users(id) on delete restrict,
 rider_id uuid not null references auth.users(id) on delete restrict,
 service text not null check(service in ('moto','carro')),
 gross_fare_cents integer not null check(gross_fare_cents between 100 and 10000000),
 discount_cents integer not null check(discount_cents between 0 and 100),
 net_fare_cents integer not null check(net_fare_cents=gross_fare_cents-discount_cents),
 fee_bps integer not null check(fee_bps between 1 and 10000),
 fee_cents integer not null check(fee_cents=round(net_fare_cents::numeric*fee_bps/10000)::integer),
 collection_status text not null default 'not_collected'
    check(collection_status='not_collected'),
 recorded_at timestamptz not null default clock_timestamp()
);
create index mobility_fee_driver_date_v1_835_idx
 on public.mobility_platform_fee_accruals_v1_835(driver_id,recorded_at desc,request_id desc);
create index mobility_fee_rider_v1_835_idx
 on public.mobility_platform_fee_accruals_v1_835(rider_id);
alter table public.mobility_platform_fee_accruals_v1_835 enable row level security;
revoke all on public.mobility_platform_fee_accruals_v1_835 from public,anon,authenticated;

create or replace function public.mobility_fee_accrual_immutable_v1_835()
 returns trigger language plpgsql security definer set search_path=pg_catalog
as $$
begin
 raise exception 'MOBILITY_FEE_ACCRUAL_IMMUTABLE' using errcode='42501';
end;
$$;
revoke all on function public.mobility_fee_accrual_immutable_v1_835()
 from public,anon,authenticated;
create trigger mobility_fee_accrual_immutable_v1_835_trg
 before update or delete on public.mobility_platform_fee_accruals_v1_835
 for each row execute function public.mobility_fee_accrual_immutable_v1_835();

-- O trigger de recibos #829 executa primeiro (ordem lexicográfica);
-- este trigger usa SOMENTE o recibo imutável e o contrato tarifário aceito.
create or replace function public.mobility_fee_accrual_on_completed_v1_835()
 returns trigger language plpgsql security definer set search_path=pg_catalog
as $$
declare
 v_receipt public.mobility_ride_receipts_v1_829%rowtype;
 v_terms public.mobility_fare_terms_v1_832%rowtype;
 v_prior public.mobility_platform_fee_accruals_v1_835%rowtype;
 v_expected integer;
begin
 if new.status is distinct from 'completed'
    or old.status is not distinct from new.status then return new;end if;
 select * into v_receipt from public.mobility_ride_receipts_v1_829
   where request_id=new.id;
 select * into v_terms from public.mobility_fare_terms_v1_832
   where request_id=new.id;
 if not found then
   if new.fare_confirmation_required then
      raise exception 'MOBILITY_FEE_ACCEPTED_TERMS_REQUIRED' using errcode='40001';
   end if;
   return new; -- grandfathered pré-cotação; não inventar dívida
 end if;
 if v_receipt.request_id is null
   or v_receipt.rider_id<>new.rider_id
   or v_receipt.driver_id<>new.driver_id
   or v_receipt.service<>new.service
   or v_terms.rider_id<>new.rider_id
   or v_terms.driver_id<>new.driver_id
   or v_receipt.agreed_fare_cents<>v_terms.gross_fare_cents
   or v_receipt.discount_cents<>v_terms.discount_cents
   or v_receipt.direct_due_cents<>v_terms.net_fare_cents
   or v_receipt.quote_version<>v_terms.quote_version
   or v_terms.fee_bps not in (800,900)
   or v_terms.payment_status<>'not_collected'
 then raise exception 'MOBILITY_FEE_RECEIPT_TERMS_CONFLICT' using errcode='40001';end if;
 v_expected:=round(v_receipt.direct_due_cents::numeric*v_terms.fee_bps/10000)::integer;
 if v_expected<>v_terms.estimated_fee_cents then
   raise exception 'MOBILITY_FEE_SNAPSHOT_MATH_MISMATCH' using errcode='40001';
 end if;
 insert into public.mobility_platform_fee_accruals_v1_835(
    request_id,driver_id,rider_id,service,gross_fare_cents,discount_cents,
    net_fare_cents,fee_bps,fee_cents)
 values (new.id,new.driver_id,new.rider_id,new.service,
    v_receipt.agreed_fare_cents,v_receipt.discount_cents,
    v_receipt.direct_due_cents,v_terms.fee_bps,v_expected)
 on conflict(request_id) do nothing;
 select * into v_prior from public.mobility_platform_fee_accruals_v1_835
 where request_id=new.id;
 if not found or v_prior.driver_id<>new.driver_id
   or v_prior.rider_id<>new.rider_id or v_prior.service<>new.service
   or v_prior.gross_fare_cents<>v_receipt.agreed_fare_cents
   or v_prior.discount_cents<>v_receipt.discount_cents
   or v_prior.net_fare_cents<>v_receipt.direct_due_cents
   or v_prior.fee_bps<>v_terms.fee_bps
   or v_prior.fee_cents<>v_expected
   or v_prior.collection_status<>'not_collected'
 then raise exception 'MOBILITY_FEE_ACCRUAL_CONFLICT' using errcode='23505';end if;
 return new;
end;
$$;
revoke all on function public.mobility_fee_accrual_on_completed_v1_835()
 from public,anon,authenticated;
create trigger mobility_fee_accrual_on_completed_v1_835_trg
 after update of status on public.mobility_requests
 for each row execute function public.mobility_fee_accrual_on_completed_v1_835();

-- Reutiliza um RPC autenticado existente. A consulta retorna SOMENTE
-- os lançamentos do motorista de auth.uid(), sem abrir a tabela por REST.
CREATE OR REPLACE FUNCTION public.mobility_billing_catalog_v1_826()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
  ),
  'billing',jsonb_build_object(
    'recordedCount',(select count(*)::integer from public.mobility_platform_fee_accruals_v1_835 a
      where a.driver_id=(select auth.uid())),
    'accruedCents',(select coalesce(sum(a.fee_cents),0)::bigint from public.mobility_platform_fee_accruals_v1_835 a
      where a.driver_id=(select auth.uid())),
    'collectedCents',0,
    'collectionStatus','not_collected',
    'entries',coalesce((
      select jsonb_agg(jsonb_build_object(
        'requestId',recent.request_id,
        'service',recent.service,
        'netCents',recent.net_fare_cents,
        'discountCents',recent.discount_cents,
        'feeBps',recent.fee_bps,
        'feeCents',recent.fee_cents,
        'recordedAt',recent.recorded_at,
        'collectionStatus',recent.collection_status
      ) order by recent.recorded_at desc,recent.request_id desc)
      from (select a.request_id,a.service,a.net_fare_cents,a.discount_cents,
                   a.fee_bps,a.fee_cents,a.recorded_at,a.collection_status
            from public.mobility_platform_fee_accruals_v1_835 a
            where a.driver_id=(select auth.uid())
            order by a.recorded_at desc,a.request_id desc limit 8) recent
    ),'[]'::jsonb)
  )
 );
$function$;
revoke all on function public.mobility_billing_catalog_v1_826() from public,anon;
grant execute on function public.mobility_billing_catalog_v1_826() to authenticated;
