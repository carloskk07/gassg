-- #837 — saldo Pix provado por Order independente, sem mutar o ledger.
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
    'collectedCents',(
      select coalesce(sum(i.amount_cents),0)::bigint
      from public.mobility_fee_pix_invoices_v1_837 i
      where i.driver_id=(select auth.uid()) and i.status='paid'
        and exists(select 1 from public.mobility_fee_pix_evidence_v1_837 e
          where e.invoice_id=i.id and e.event_state='paid'
            and e.evidence_hash=i.provider_evidence_hash)
    ),
    'outstandingCents',greatest(
      (select coalesce(sum(a.fee_cents),0)::bigint
       from public.mobility_platform_fee_accruals_v1_835 a
       where a.driver_id=(select auth.uid()))
      -(select coalesce(sum(i.amount_cents),0)::bigint
        from public.mobility_fee_pix_invoices_v1_837 i
        where i.driver_id=(select auth.uid()) and i.status='paid'
          and exists(select 1 from public.mobility_fee_pix_evidence_v1_837 e
          where e.invoice_id=i.id and e.event_state='paid'
            and e.evidence_hash=i.provider_evidence_hash)),0),
    'paidInvoiceCount',(
      select count(*)::integer from public.mobility_fee_pix_invoices_v1_837 i
      where i.driver_id=(select auth.uid()) and i.status='paid'
    ),
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
                   a.fee_bps,a.fee_cents,a.recorded_at,
                   case when exists(
                    select 1 from public.mobility_fee_pix_invoice_lines_v1_837 l
                    join public.mobility_fee_pix_invoices_v1_837 i on i.id=l.invoice_id
                    where l.request_id=a.request_id and i.status='paid'
                    and exists(select 1 from public.mobility_fee_pix_evidence_v1_837 e
                      where e.invoice_id=i.id and e.event_state='paid'
                        and e.evidence_hash=i.provider_evidence_hash)
                   ) then 'provider_verified' else a.collection_status end
                     as collection_status
            from public.mobility_platform_fee_accruals_v1_835 a
            where a.driver_id=(select auth.uid())
            order by a.recorded_at desc,a.request_id desc limit 8) recent
    ),'[]'::jsonb)
  )
 );
$function$;
CREATE OR REPLACE FUNCTION public.admin_mobility_fee_review_v1_836(p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
 v_paid_cents bigint:=0;
 v_invalid_invoice_count bigint:=0;
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

 -- Quitação SOMENTE de fatura com prova persistida de Order processada
 -- e pagamento Pix identificado por servidor; não reaproveitar contabilização
 -- das revendas ou reconhecer pagamento informado manualmente.
 select coalesce(sum(i.amount_cents),0)::bigint into v_paid_cents
 from public.mobility_fee_pix_invoices_v1_837 i
 where i.status='paid' and exists(
  select 1 from public.mobility_fee_pix_evidence_v1_837 e
  where e.invoice_id=i.id and e.event_state='paid'
    and e.evidence_hash=i.provider_evidence_hash
    and e.amount_cents=i.amount_cents
    and e.provider_order_id=i.provider_order_id
    and e.provider_payment_id=i.provider_payment_id
 );
 select count(*) into v_invalid_invoice_count
 from public.mobility_fee_pix_invoices_v1_837 i
 where i.status='paid' and (
   (select coalesce(sum(l.fee_cents),0) from public.mobility_fee_pix_invoice_lines_v1_837 l
    where l.invoice_id=i.id)<>i.amount_cents
   or not exists(select 1 from public.mobility_fee_pix_evidence_v1_837 e
      where e.invoice_id=i.id and e.event_state='paid'
      and e.evidence_hash=i.provider_evidence_hash
      and e.amount_cents=i.amount_cents
      and e.provider_order_id=i.provider_order_id
      and e.provider_payment_id=i.provider_payment_id)
 );
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
   case when exists(
    select 1 from public.mobility_fee_pix_invoice_lines_v1_837 l
    join public.mobility_fee_pix_invoices_v1_837 i on i.id=l.invoice_id
    where l.request_id=a.request_id and i.status='paid'
    and exists(select 1 from public.mobility_fee_pix_evidence_v1_837 e
      where e.invoice_id=i.id and e.event_state='paid'
        and e.evidence_hash=i.provider_evidence_hash)
  ) then 'provider_verified' else a.collection_status end as collection_status,
  a.recorded_at
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
  'collectedCents',v_paid_cents,
  'outstandingCents',greatest(v_total_cents-v_paid_cents,0),
  'collectionStatus',case when v_paid_cents=0 then 'not_collected'
      when v_paid_cents=v_total_cents then 'provider_verified'
      else 'partially_collected' end,
  'paidInvoiceCount',(
     select count(*)::integer from public.mobility_fee_pix_invoices_v1_837
     where status='paid'),
  'ninePercent',jsonb_build_object('count',v_nine_count,'cents',v_nine_cents),
  'eightPercent',jsonb_build_object('count',v_eight_count,'cents',v_eight_cents),
  'benefitsCents',v_discounts_cents,
  'integrityIssues',v_invalid_count+v_missing_count+v_invalid_invoice_count,
  'invalidEntryCount',v_invalid_count,
  'missingEntryCount',v_missing_count,
  'invalidInvoiceCount',v_invalid_invoice_count,
  'recentEntries',v_recent,
  'recentDrivers',v_drivers,
  'recentEntriesTruncated',v_total_count>80,
  'recentDriversTruncated',v_driver_count>80,
  'paymentVerified',(v_paid_cents>0)
 );
end;
$function$;
revoke all on function public.mobility_billing_catalog_v1_826() from public,anon;
grant execute on function public.mobility_billing_catalog_v1_826() to authenticated;
revoke all on function public.admin_mobility_fee_review_v1_836(uuid)
 from public,anon,authenticated;
grant execute on function public.admin_mobility_fee_review_v1_836(uuid)
 to service_role;
