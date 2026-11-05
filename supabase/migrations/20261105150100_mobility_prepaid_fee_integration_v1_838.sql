-- #838 mobilidade: recarga por Pix, tarifa congelada e crédito no encerramento.

-- Planos são RECARGAS consumíveis, nunca assinaturas ou mensalidades.
-- Mesmo motorista não pode manter dois Pix pendentes ao mesmo tempo.
create or replace function public.mobility_fee_pix_prepare_credit_v1_838(
 p_driver uuid,p_plan_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog
as $$
declare
 v_plan public.mobility_billing_plans_v1_826%rowtype;
 v_open public.mobility_fee_pix_invoices_v1_837%rowtype;
 v_id uuid:=gen_random_uuid();
begin
 if p_driver is null or not exists(
   select 1 from auth.users where id=p_driver and is_anonymous=false
 ) then raise exception 'MOBILITY_PREPAID_AUTH_REQUIRED' using errcode='42501';end if;
 if not exists(
    select 1 from public.discovery_listings l
    join public.discovery_professional_details d on d.listing_id=l.id
    where l.owner_id=p_driver and l.vertical='professionals'
      and l.status='published'
      and d.occupation ~* '(motot[aá]xi|moto.?taxi|motorista|t[aá]xi|taxista)'
 ) then raise exception 'MOBILITY_PREPAID_DRIVER_NOT_ELIGIBLE'
    using errcode='42501';end if;
 select * into v_plan from public.mobility_billing_plans_v1_826
 where plan_key=p_plan_key and billing_mode='prepaid' and purchase_enabled
   and purchase_amount_cents between 100 and 1000000
   and platform_fee_bps in (500,550,600);
 if not found then raise exception 'MOBILITY_PREPAID_PLAN_UNAVAILABLE'
    using errcode='22023';end if;
 perform pg_advisory_xact_lock(
   hashtextextended('mobility-fee-invoice:'||p_driver::text,0));
 select * into v_open from public.mobility_fee_pix_invoices_v1_837
 where driver_id=p_driver and status in ('prepared','active','expired','review_required')
 for update;
 if found then
  if v_open.invoice_kind='prepaid_credit' and v_open.plan_key=p_plan_key then
   return jsonb_build_object('invoiceId',v_open.id,'status',v_open.status,
     'invoiceKind','prepaid_credit','planKey',v_open.plan_key,
     'amountCents',v_open.amount_cents,'replayed',true);
  end if;
  raise exception 'MOBILITY_PREPAID_OTHER_INVOICE_OPEN' using errcode='23505';
 end if;
 insert into public.mobility_fee_pix_invoices_v1_837(
  id,driver_id,external_reference,amount_cents,invoice_kind,
  plan_key,plan_fee_bps,grant_cents
 ) values(v_id,p_driver,'mobility-fee:'||v_id::text,
   v_plan.purchase_amount_cents,'prepaid_credit',
   v_plan.plan_key,v_plan.platform_fee_bps,v_plan.purchase_amount_cents);
 return jsonb_build_object('invoiceId',v_id,'status','prepared',
  'invoiceKind','prepaid_credit','planKey',p_plan_key,
  'amountCents',v_plan.purchase_amount_cents,'replayed',false);
end;
$$;
revoke all on function public.mobility_fee_pix_prepare_credit_v1_838(uuid,text)
 from public,anon,authenticated;
grant execute on function public.mobility_fee_pix_prepare_credit_v1_838(uuid,text) to service_role;

-- prep
CREATE OR REPLACE FUNCTION public.mobility_fee_pix_prepare_v1_837(p_driver uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
 v_invoice public.mobility_fee_pix_invoices_v1_837%rowtype;
 v_ids uuid[];
 v_amount bigint:=0;
 v_id uuid:=gen_random_uuid();
 v_rows bigint:=0;
begin
 if p_driver is null or not exists(
   select 1 from auth.users u where u.id=p_driver and u.is_anonymous=false
 ) then raise exception 'MOBILITY_FEE_PAYER_NOT_PERMANENT'
   using errcode='42501';end if;
 perform pg_advisory_xact_lock(
   hashtextextended('mobility-fee-invoice:'||p_driver::text,0));
 select * into v_invoice from public.mobility_fee_pix_invoices_v1_837
 where driver_id=p_driver
   and status in ('prepared','active','expired','review_required')
 for update;
 if found then
   return jsonb_build_object('invoiceKind',v_invoice.invoice_kind,
    'planKey',v_invoice.plan_key,'invoiceId',v_invoice.id,
    'status',v_invoice.status,'amountCents',v_invoice.amount_cents,
    'externalReference',v_invoice.external_reference,
    'createdAt',v_invoice.created_at);
 end if;
 -- Com sum acumulada e teto por fatura, cada lançamento entra em no
 -- máximo UMA cobrança. O saldo abaixo de R$1 acumula sem fatura.
 with unbilled as (
  select a.request_id,a.fee_cents,a.recorded_at
  from public.mobility_platform_fee_accruals_v1_835 a
  where a.driver_id=p_driver and a.fee_cents>0
    and not exists(select 1 from public.mobility_fee_pix_invoice_lines_v1_837 l
                   where l.request_id=a.request_id)
    -- Prepaid use is allocated forever to one funding source, even if the
    -- provider later flags that source for review. Never silently rebill a
    -- completed prepaid trip as a second fee Pix during a dispute.
    -- Financial recovery requires a separate, explicitly reconciled flow.
    and not exists(select 1 from public.mobility_fee_prepaid_uses_v1_838 u
       where u.request_id=a.request_id and u.status='spent')
  order by a.recorded_at,a.request_id
  limit 100
 ), counted as (
  select request_id,fee_cents,recorded_at,
  sum(fee_cents) over(order by recorded_at,request_id) as running
  from unbilled
 )
 select array_agg(request_id order by recorded_at,request_id),
        coalesce(sum(fee_cents),0)
 into v_ids,v_amount
 from counted where running<=1000000;
 if v_amount<100 or v_ids is null then
   return jsonb_build_object('status','below_minimum',
    'amountCents',coalesce(v_amount,0),'minCents',100);
 end if;
 insert into public.mobility_fee_pix_invoices_v1_837(
  id,driver_id,external_reference,amount_cents)
 values(v_id,p_driver,'mobility-fee:'||v_id::text,v_amount);
 insert into public.mobility_fee_pix_invoice_lines_v1_837(
  request_id,invoice_id,fee_cents)
 select a.request_id,v_id,a.fee_cents
 from public.mobility_platform_fee_accruals_v1_835 a
 where a.driver_id=p_driver and a.request_id=any(v_ids);
 get diagnostics v_rows=row_count;
 if v_rows<>cardinality(v_ids)
    or (select sum(fee_cents) from public.mobility_fee_pix_invoice_lines_v1_837
        where invoice_id=v_id)<>v_amount
 then raise exception 'MOBILITY_FEE_INVOICE_SUM_CONFLICT'
   using errcode='40001';end if;
 return jsonb_build_object('invoiceId',v_id,'status','prepared',
   'amountCents',v_amount,'externalReference','mobility-fee:'||v_id::text,
   'createdAt',(select created_at from public.mobility_fee_pix_invoices_v1_837
                where id=v_id));
end;
$function$;

-- commit
CREATE OR REPLACE FUNCTION public.mobility_fee_pix_commit_v1_837(p_invoice uuid, p_driver uuid, p_order text, p_payment text, p_br_code text, p_qr_image text, p_link_url text, p_expires timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
 v_invoice public.mobility_fee_pix_invoices_v1_837%rowtype;
begin
 select * into v_invoice from public.mobility_fee_pix_invoices_v1_837
 where id=p_invoice and driver_id=p_driver for update;
 if not found then raise exception 'MOBILITY_FEE_PIX_NOT_FOUND' using errcode='42501';end if;
 if p_order is null or length(p_order) not between 8 and 200
 or p_order !~ '^[A-Za-z0-9_-]+$'
 or p_payment is null or length(p_payment) not between 3 and 200
 or p_payment !~ '^[A-Za-z0-9_-]+$'
 or p_br_code is null or length(p_br_code) not between 20 and 8192
 or p_expires is null or p_expires<=clock_timestamp()+interval '60 seconds'
 or p_expires>v_invoice.created_at+interval '24 hours'
 or (p_qr_image is not null and (
     length(p_qr_image)>550100 or p_qr_image !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$'))
 or (p_link_url is not null and (length(p_link_url)>2000
     or p_link_url !~ '^https://'))
 then raise exception 'MOBILITY_FEE_PIX_PROOF_INVALID' using errcode='22023';end if;
 if (v_invoice.invoice_kind='fee' and
    (select coalesce(sum(fee_cents),0) from public.mobility_fee_pix_invoice_lines_v1_837
       where invoice_id=p_invoice)<>v_invoice.amount_cents)
  or (v_invoice.invoice_kind='prepaid_credit' and
    (v_invoice.grant_cents<>v_invoice.amount_cents
      or v_invoice.plan_fee_bps not in (500,550,600)
      or exists(select 1 from public.mobility_fee_pix_invoice_lines_v1_837
        where invoice_id=p_invoice)))
 then raise exception 'MOBILITY_FEE_PIX_LINES_CONFLICT' using errcode='40001';end if;
 if v_invoice.status='active'
    and v_invoice.provider_order_id=p_order
    and v_invoice.provider_payment_id=p_payment
    and v_invoice.pix_br_code=p_br_code
 then return jsonb_build_object('invoiceId',p_invoice,'status','active',
    'amountCents',v_invoice.amount_cents,'replayed',true);end if;
 if v_invoice.status<>'prepared' then
  raise exception 'MOBILITY_FEE_PIX_ALREADY_COMMITTED' using errcode='23505';end if;
 update public.mobility_fee_pix_invoices_v1_837
 set status='active',provider_order_id=p_order,provider_payment_id=p_payment,
 pix_br_code=p_br_code,pix_qr_data_uri=p_qr_image,payment_link_url=p_link_url,
 expires_at=p_expires,updated_at=clock_timestamp()
 where id=p_invoice and status='prepared';
 return jsonb_build_object('invoiceId',p_invoice,'status','active',
    'amountCents',v_invoice.amount_cents,'replayed',false);
end;
$function$;

-- recover
CREATE OR REPLACE FUNCTION public.mobility_fee_pix_recover_paid_v1_837(p_invoice uuid, p_driver uuid, p_order text, p_payment text, p_amount_cents integer, p_evidence_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
 v_invoice public.mobility_fee_pix_invoices_v1_837%rowtype;
 v_previous public.mobility_fee_pix_evidence_v1_837%rowtype;
begin
 select * into v_invoice from public.mobility_fee_pix_invoices_v1_837
 where id=p_invoice and driver_id=p_driver for update;
 if not found or v_invoice.external_reference<>'mobility-fee:'||p_invoice::text
  or p_order is null or p_order !~ '^[A-Za-z0-9_-]{8,200}$'
  or p_payment is null or p_payment !~ '^[A-Za-z0-9_-]{3,200}$'
  or v_invoice.amount_cents is distinct from p_amount_cents
  or p_evidence_sha256 !~ '^[0-9a-f]{64}$'
  or (v_invoice.invoice_kind='fee' and (select coalesce(sum(fee_cents),0)
    from public.mobility_fee_pix_invoice_lines_v1_837
    where invoice_id=p_invoice)<>v_invoice.amount_cents)
  or (v_invoice.invoice_kind='prepaid_credit' and (
    v_invoice.grant_cents<>v_invoice.amount_cents or
    v_invoice.plan_fee_bps not in (500,550,600) or
    exists(select 1 from public.mobility_fee_pix_invoice_lines_v1_837
      where invoice_id=p_invoice)))
 then raise exception 'MOBILITY_FEE_EARLY_PAYMENT_MISMATCH'
   using errcode='42501';end if;
 if v_invoice.status='paid' and v_invoice.provider_order_id=p_order
  and v_invoice.provider_payment_id=p_payment
  and v_invoice.provider_evidence_hash=p_evidence_sha256
 then return jsonb_build_object('status','paid','replayed',true);end if;
 if v_invoice.status<>'prepared' or v_invoice.provider_order_id is not null
 then raise exception 'MOBILITY_FEE_EARLY_PAYMENT_STATE_CONFLICT'
   using errcode='23505';end if;
 insert into public.mobility_fee_pix_evidence_v1_837(
   invoice_id,event_state,provider_order_id,provider_payment_id,
   amount_cents,evidence_hash)
 values (p_invoice,'paid',p_order,p_payment,p_amount_cents,p_evidence_sha256)
 on conflict(invoice_id,event_state) do nothing;
 select * into v_previous from public.mobility_fee_pix_evidence_v1_837
 where invoice_id=p_invoice and event_state='paid';
 if not found or v_previous.evidence_hash<>p_evidence_sha256
  or v_previous.provider_order_id<>p_order
  or v_previous.provider_payment_id<>p_payment
  or v_previous.amount_cents<>p_amount_cents
 then raise exception 'MOBILITY_FEE_EARLY_PAYMENT_REPLAY_CONFLICT'
  using errcode='23505';end if;
 update public.mobility_fee_pix_invoices_v1_837
 set status='paid',provider_order_id=p_order,provider_payment_id=p_payment,
 paid_at=clock_timestamp(),provider_evidence_hash=p_evidence_sha256,
 last_provider_state='paid',updated_at=clock_timestamp()
 where id=p_invoice;
 return jsonb_build_object('status','paid','replayed',false);
end;
$function$;

-- terms
CREATE OR REPLACE FUNCTION public.mobility_fare_terms_on_accept_v1_832()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
 v_participant boolean:=false;
 v_bps integer:=900;
 v_discount integer:=0;
 v_existing public.mobility_fare_terms_v1_832%rowtype;
 v_prepaid jsonb;
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
 -- Uma reserva de crédito pré-pago só nasce após pagamento provado no MP.
 -- Reserva congela a taxa e o custo no mesmo aceite da proposta.
 if new.fare_cents-v_discount>=100 then
  v_prepaid:=public.mobility_fee_prepaid_reserve_v1_838(
    new.request_id,new.driver_id,new.fare_cents-v_discount);
 else
  v_prepaid:=null; -- Valor líquido zero: não consome crédito do motorista.
 end if;
 if v_prepaid is not null and v_prepaid->>'status'='reserved' then
  v_bps:=(v_prepaid->>'rateBps')::integer;
  if (v_prepaid->>'feeCents')::integer <>
      round((new.fare_cents-v_discount)::numeric*v_bps/10000)::integer
  then raise exception 'MOBILITY_PREPAID_ACCEPT_AMOUNT_MISMATCH'
       using errcode='40001';end if;
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
$function$;

-- fee
CREATE OR REPLACE FUNCTION public.mobility_fee_accrual_on_completed_v1_835()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
   or v_terms.fee_bps not in (500,550,600,800,900)
   or v_terms.payment_status<>'not_collected'
 then raise exception 'MOBILITY_FEE_RECEIPT_TERMS_CONFLICT' using errcode='40001';end if;
 if v_terms.fee_bps in (500,550,600) and not exists(
   select 1 from public.mobility_fee_prepaid_uses_v1_838 u
   where u.request_id=new.id and u.driver_id=new.driver_id
    and u.status='spent' and u.fee_bps=v_terms.fee_bps
    and u.reserved_cents=v_terms.estimated_fee_cents)
 then raise exception 'MOBILITY_PREPAID_FEE_NOT_SETTLED'
    using errcode='40001';end if;
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
$function$;
revoke all on function public.mobility_fee_pix_prepare_v1_837(uuid) from public,anon,authenticated;
grant execute on function public.mobility_fee_pix_prepare_v1_837(uuid) to service_role;
revoke all on function public.mobility_fee_pix_commit_v1_837(
 uuid,uuid,text,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.mobility_fee_pix_commit_v1_837(
 uuid,uuid,text,text,text,text,text,timestamptz) to service_role;
revoke all on function public.mobility_fee_pix_recover_paid_v1_837(
 uuid,uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.mobility_fee_pix_recover_paid_v1_837(
 uuid,uuid,text,text,integer,text) to service_role;
revoke all on function public.mobility_fare_terms_on_accept_v1_832()
 from public,anon,authenticated;
revoke all on function public.mobility_fee_accrual_on_completed_v1_835()
 from public,anon,authenticated;
