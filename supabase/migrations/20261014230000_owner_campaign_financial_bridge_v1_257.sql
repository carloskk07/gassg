-- TAMÃO V1.257 — conservative campaign-level evidence bridge.
-- Read-only: uses existing V1.253/V1.254 PSP reconciliations and V1.255/V1.256
-- owner-reported costs + private receipt objects. Never treats this as profit or ROI.
create schema if not exists platform_funding_private_v1_257;
revoke all on schema platform_funding_private_v1_257 from public,anon,authenticated;
grant usage on schema platform_funding_private_v1_257 to service_role;

create or replace function platform_funding_private_v1_257.summary(
 p_actor uuid,p_month date default null
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare
 v_month date:=coalesce(p_month,
   date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')::date);
 v_solo jsonb;v_batches jsonb;v_costs jsonb;
 v_rows jsonb;v_total bigint;
begin
 if p_actor is null or not exists(
   select 1 from public.platform_admins a
   where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance')
 ) then raise exception 'OWNER_FINANCIAL_BRIDGE_DENIED' using errcode='42501';end if;
 if extract(day from v_month)<>1 or v_month<date '2026-01-01'
   or v_month>(date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')+
     interval '2 months')::date
 then raise exception 'OWNER_FINANCIAL_BRIDGE_MONTH_INVALID' using errcode='22023';end if;

 -- Reuse the established receipt proofs without inventing a new receipt model.
 select platform_funding_private_v1_253.fee_receipts(p_actor,v_month) into v_solo;
 select platform_funding_private_v1_254.batch_report(p_actor,v_month) into v_batches;
 select platform_funding_private_v1_255.read_expenses(p_actor,v_month) into v_costs;
 if v_solo->>'source'<>'admin_owner_campaign_fee_receipts_v1_253'
   or v_batches->>'source'<>'admin_owner_campaign_batch_ledger_v1_254'
   or v_costs->>'source'<>'admin_owner_campaign_cost_read_v1_255'
   or (v_solo->>'month')::date<>v_month
   or (v_batches->>'month')::date<>v_month
   or (v_costs->>'month')::date<>v_month
   or v_solo->>'bankSettlementVerified'<>'false'
   or v_batches->>'bankSettlementVerified'<>'false'
   or v_costs->>'bankVerified'<>'false'
 then raise exception 'OWNER_FINANCIAL_BRIDGE_EVIDENCE_UNVERIFIED' using errcode='22023';end if;

 select count(*) into v_total
 from public.platform_owner_budget_allocations_v1_247 a where a.month_key=v_month;

 with selected as (
  select a.* from public.platform_owner_budget_allocations_v1_247 a
  where a.month_key=v_month
  order by a.created_at desc,a.allocation_id limit 50
 ), receipts as (
  select s.allocation_id,
    count(*) filter (where v.expense_id is null)::bigint active_cost_count,
    count(*) filter (where v.expense_id is null and r.expense_id is not null
     and o.id is not null)::bigint attached_count,
    coalesce(sum(c.amount_cents) filter (where v.expense_id is null and
     r.expense_id is not null and o.id is not null),0)::bigint attached_cost_cents
  from selected s
  join public.platform_campaign_marketing_costs_v1_255 c
   on c.allocation_id=s.allocation_id
  left join public.platform_campaign_marketing_cost_voids_v1_255 v
   on v.expense_id=c.expense_id
  left join public.platform_campaign_marketing_receipts_v1_256 r
   on r.expense_id=c.expense_id
  left join storage.objects o on o.bucket_id='tamao-owner-campaign-receipts-v1-256'
   and o.name=r.object_path and coalesce(o.is_delete_marker,false)=false
  group by s.allocation_id
 ), evidence as (
  select a.allocation_id,a.benefit_key,a.month_key,a.campaign_reference,
    a.campaign_label,a.amount_cents,a.created_at,
    coalesce((sp.item->>'providerConfirmedFeeCents')::bigint,0) solo_fee,
    coalesce((sp.item->>'providerConfirmedOrders')::bigint,0) solo_orders,
    coalesce((bp.item->>'providerSupportedNetFeeCents')::bigint,0) batch_fee,
    coalesce((bp.item->>'verifiedBatchOrders')::bigint,0) batch_orders,
    coalesce((cp.item->>'ownerReportedPaidMarketingCents')::bigint,0) owner_spend,
    coalesce(r.active_cost_count,0) active_cost_count,
    coalesce(r.attached_count,0) attached_count,
    coalesce(r.attached_cost_cents,0) attached_cost_cents
  from selected a
  left join lateral (
    select x.item from jsonb_array_elements(v_solo->'rows') x(item)
    where x.item->>'allocationId'=a.allocation_id::text limit 1
  )sp on true
  left join lateral (
    select x.item from jsonb_array_elements(v_batches->'rows') x(item)
    where x.item->>'allocationId'=a.allocation_id::text limit 1
  )bp on true
  left join lateral (
    select x.item from jsonb_array_elements(v_costs->'campaigns') x(item)
    where x.item->>'allocationId'=a.allocation_id::text limit 1
  )cp on true
  left join receipts r on r.allocation_id=a.allocation_id
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'allocationId',e.allocation_id,
  'campaignTag','tam-'||e.benefit_key||'-'||to_char(e.month_key,'YYYYMM')||'-'||e.campaign_reference,
  'campaignLabel',e.campaign_label,
  'plannedIncentiveBudgetCents',e.amount_cents,
  'soloProviderFeeCents',e.solo_fee,
  'batchProviderFeeCents',e.batch_fee,
  'providerFeeEvidenceCents',e.solo_fee+e.batch_fee,
  'providerFeeEvidenceOrders',e.solo_orders+e.batch_orders,
  'ownerReportedMarketingSpendCents',e.owner_spend,
  'marketingSpendWithStoredReceiptCents',e.attached_cost_cents,
  'marketingSpendWithoutStoredReceiptCents',e.owner_spend-e.attached_cost_cents,
  'activeExpenseCount',e.active_cost_count,
  'storedReceiptCount',e.attached_count,
  'partialEvidenceDifferenceCents',case
    when e.solo_fee+e.batch_fee>0 and e.owner_spend>0
    then (e.solo_fee+e.batch_fee)-e.owner_spend else null end,
  'profitMeasured',false,'roiMeasured',false,
  'bankSettlementVerified',false
 )order by e.created_at desc,e.allocation_id),'[]'::jsonb) into v_rows
 from evidence e;

 return jsonb_build_object(
  'source','admin_owner_campaign_financial_bridge_v1_257',
  'month',v_month,'totalCampaigns',v_total,
  'rows',v_rows,'limit',50,'truncated',v_total>50,
  'receiptSources',jsonb_build_array('v1_253_single_order_psp','v1_254_batch_order_psp'),
  'expenseSource','v1_255_owner_attested_with_v1_256_optional_document',
  'comparisonMeaning','partial_difference_not_profit_not_roi',
  'revenueAttributionIsCausal',false,
  'bankSettlementVerified',false,'profitMeasured',false,'roiMeasured',false,
  'cashAvailableCents',0,'readOnly',true,'noTransfers',true,
  'newBenefitsEnabled',false
 );
end;$fn$;

create or replace function platform_funding_private_v1_257.orphans(
 p_actor uuid
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare
 v_total bigint;v_linked bigint;v_recent bigint;v_stale bigint;v_unexpected bigint;
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance')
 ) then raise exception 'OWNER_RECEIPT_ORPHANS_DENIED' using errcode='42501';end if;
 if not exists(
   select 1 from storage.buckets b where b.id='tamao-owner-campaign-receipts-v1-256'
   and b.public=false and b.file_size_limit=3145728
 ) then raise exception 'OWNER_RECEIPT_BUCKET_NOT_PRIVATE' using errcode='42501';end if;

 select count(*)::bigint,
   count(*) filter(where r.expense_id is not null)::bigint,
   count(*) filter(where r.expense_id is null and
     o.created_at>clock_timestamp()-interval '24 hours')::bigint,
   count(*) filter(where r.expense_id is null and
     o.created_at<=clock_timestamp()-interval '24 hours')::bigint,
   count(*) filter(where o.name !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|png|jpg)$')::bigint
 into v_total,v_linked,v_recent,v_stale,v_unexpected
 from storage.objects o
 left join public.platform_campaign_marketing_receipts_v1_256 r
   on r.object_path=o.name
 where o.bucket_id='tamao-owner-campaign-receipts-v1-256'
   and coalesce(o.is_delete_marker,false)=false;

 return jsonb_build_object(
  'source','admin_owner_campaign_receipt_orphans_v1_257',
  'bucketObjects',v_total,'linkedObjects',v_linked,
  'recentUnlinkedObjects',v_recent,'reviewCandidatesAfter24h',v_stale,
  'unexpectedPathObjects',v_unexpected,
  'minAgeHours',24,'readOnly',true,'deletionPerformed',false,
  'automaticDeletionEnabled',false,'noObjectPaths',true,
  'privateBucket',true,'bankVerified',false
 );
end;$fn$;

revoke all on function platform_funding_private_v1_257.summary(uuid,date)
 from public,anon,authenticated,service_role;
revoke all on function platform_funding_private_v1_257.orphans(uuid)
 from public,anon,authenticated,service_role;
grant execute on function platform_funding_private_v1_257.summary(uuid,date) to service_role;
grant execute on function platform_funding_private_v1_257.orphans(uuid) to service_role;

create or replace function public.admin_owner_campaign_financial_bridge_v1_257(
 p_actor uuid,p_month date default null
) returns jsonb language sql stable security invoker set search_path=pg_catalog as $wrap$
 select platform_funding_private_v1_257.summary($1,$2)
$wrap$;
create or replace function public.admin_owner_campaign_receipt_orphans_v1_257(
 p_actor uuid
) returns jsonb language sql stable security invoker set search_path=pg_catalog as $wrap$
 select platform_funding_private_v1_257.orphans($1)
$wrap$;
revoke all on function public.admin_owner_campaign_financial_bridge_v1_257(uuid,date)
 from public,anon,authenticated,service_role;
revoke all on function public.admin_owner_campaign_receipt_orphans_v1_257(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_owner_campaign_financial_bridge_v1_257(uuid,date)
 to service_role;
grant execute on function public.admin_owner_campaign_receipt_orphans_v1_257(uuid)
 to service_role;

do $acl$begin
 if has_function_privilege('anon',
   'public.admin_owner_campaign_financial_bridge_v1_257(uuid,date)','EXECUTE')
 or has_function_privilege('authenticated',
   'public.admin_owner_campaign_financial_bridge_v1_257(uuid,date)','EXECUTE')
 or has_function_privilege('authenticated',
   'public.admin_owner_campaign_receipt_orphans_v1_257(uuid)','EXECUTE')
 then raise exception 'OWNER_FINANCIAL_BRIDGE_ACL_DRIFT' using errcode='42501';end if;
end $acl$;
