-- TAMÃO #836. Auditoria financeira da mobilidade no Admin.
-- Consulta exata ao livro-razão canônico (sem copiar dados para revendas,
-- sem cobrar/cancelar Pix nem declarar taxa quitada).
create or replace function public.admin_mobility_fee_review_v1_836(p_actor_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog
as $$
declare
 v_role text;
 v_total_count bigint:=0;
 v_total_cents bigint:=0;
 v_driver_count bigint:=0;
 v_nine_count bigint:=0;
 v_nine_cents bigint:=0;
 v_eight_count bigint:=0;
 v_eight_cents bigint:=0;
 v_discounts_cents bigint:=0;
 v_recent jsonb:='[]'::jsonb;
 v_drivers jsonb:='[]'::jsonb;
 v_invalid_count bigint:=0;
 v_missing_count bigint:=0;
begin
 v_role:=public.platform_admin_role(p_actor_user_id);
 if v_role not in ('superadmin','finance','readonly') then
  raise exception 'ADMIN_MOBILITY_FEE_READ_DENIED' using errcode='42501';
 end if;
 select count(*),coalesce(sum(fee_cents),0),
        count(distinct driver_id),
        count(*) filter(where fee_bps=900),
        coalesce(sum(fee_cents) filter(where fee_bps=900),0),
        count(*) filter(where fee_bps=800),
        coalesce(sum(fee_cents) filter(where fee_bps=800),0),
        coalesce(sum(discount_cents),0)
 into v_total_count,v_total_cents,v_driver_count,
      v_nine_count,v_nine_cents,v_eight_count,v_eight_cents,
      v_discounts_cents
 from public.mobility_platform_fee_accruals_v1_835;

 -- Para detectar inconsistência: recibo do motorista + valores pactuados
 -- devem corresponder à taxa lançada. Nenhum status de "pago" é sintetizado.
 select count(*) into v_invalid_count
 from public.mobility_platform_fee_accruals_v1_835 a
 left join public.mobility_ride_receipts_v1_829 r on r.request_id=a.request_id
 left join public.mobility_fare_terms_v1_832 t on t.request_id=a.request_id
 left join public.mobility_requests m on m.id=a.request_id
 where r.request_id is null or t.request_id is null or m.status is distinct from 'completed'
  or a.driver_id is distinct from r.driver_id or a.rider_id is distinct from r.rider_id
  or a.service is distinct from r.service
  or a.gross_fare_cents is distinct from r.agreed_fare_cents
  or a.discount_cents is distinct from r.discount_cents
  or a.net_fare_cents is distinct from r.direct_due_cents
  or a.fee_bps is distinct from t.fee_bps
  or a.fee_cents is distinct from t.estimated_fee_cents
  or a.collection_status<>'not_collected';

 select count(*) into v_missing_count
 from public.mobility_ride_receipts_v1_829 r
 join public.mobility_fare_terms_v1_832 t on t.request_id=r.request_id
 join public.mobility_requests m on m.id=r.request_id
 left join public.mobility_platform_fee_accruals_v1_835 a on a.request_id=r.request_id
 where m.status='completed' and a.request_id is null;

 select coalesce(jsonb_agg(jsonb_build_object(
   'requestId',x.request_id,'driverId',x.driver_id,'service',x.service,
   'grossCents',x.gross_fare_cents,'discountCents',x.discount_cents,
   'netCents',x.net_fare_cents,'feeBps',x.fee_bps,'feeCents',x.fee_cents,
   'collectionStatus',x.collection_status,'recordedAt',x.recorded_at
 ) order by x.recorded_at desc,x.request_id desc),'[]'::jsonb)
 into v_recent
 from (
  select a.request_id,a.driver_id,a.service,a.gross_fare_cents,
   a.discount_cents,a.net_fare_cents,a.fee_bps,a.fee_cents,
   a.collection_status,a.recorded_at
  from public.mobility_platform_fee_accruals_v1_835 a
  order by a.recorded_at desc,a.request_id desc limit 80
 ) x;

 select coalesce(jsonb_agg(jsonb_build_object(
  'driverId',x.driver_id,'rides',x.rides,'accruedCents',x.accrued_cents,
  'firstAt',x.first_at,'lastAt',x.last_at
 ) order by x.accrued_cents desc,x.driver_id),'[]'::jsonb)
 into v_drivers
 from (
  select driver_id,count(*) rides,coalesce(sum(fee_cents),0) accrued_cents,
   min(recorded_at) first_at,max(recorded_at) last_at
  from public.mobility_platform_fee_accruals_v1_835
  group by driver_id
  order by accrued_cents desc,driver_id limit 80
 ) x;

 return jsonb_build_object(
  'generatedAt',clock_timestamp(),
  'source','database_full',
  'recordedCount',v_total_count,
  'driverCount',v_driver_count,
  'accruedCents',v_total_cents,
  'collectedCents',0,
  'outstandingCents',v_total_cents,
  'collectionStatus','not_collected',
  'ninePercent',jsonb_build_object('count',v_nine_count,'cents',v_nine_cents),
  'eightPercent',jsonb_build_object('count',v_eight_count,'cents',v_eight_cents),
  'benefitsCents',v_discounts_cents,
  'integrityIssues',v_invalid_count+v_missing_count,
  'invalidEntryCount',v_invalid_count,
  'missingEntryCount',v_missing_count,
  'recentEntries',v_recent,
  'recentDrivers',v_drivers,
  'recentEntriesTruncated',v_total_count>80,
  'recentDriversTruncated',v_driver_count>80,
  'paymentVerified',false
 );
end;
$$;
-- Nunca exponha função SECURITY DEFINER à Data API do navegador.
revoke all on function public.admin_mobility_fee_review_v1_836(uuid)
 from public,anon,authenticated;
grant execute on function public.admin_mobility_fee_review_v1_836(uuid)
 to service_role;
