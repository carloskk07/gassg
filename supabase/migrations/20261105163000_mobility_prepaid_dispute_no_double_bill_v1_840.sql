-- TAMÃO #840: correção financeira para recarga pré-paga sob contestação.
-- Não reescrever migrations #838 já executadas nem liberar cobrança em duplicidade.
-- Este contrato preserva taxas normais não pré-pagas em aberto.
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
    -- A corrida pré-paga já foi alocada de forma definitiva ao lote.
    -- Estorno/contestação congela o lote e exige conciliação humana,
    -- mas jamais autoriza segunda cobrança Pix da mesma corrida.
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

create or replace function public.mobility_fee_pix_no_double_prepaid_v1_840()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $$
begin
 if exists (
   select 1 from public.mobility_fee_prepaid_uses_v1_838 u
   where u.request_id=new.request_id and u.status in ('reserved','spent')
 ) then
  raise exception 'MOBILITY_PREPAID_FEE_INVOICE_DUPLICATE'
    using errcode='23505';
 end if;
 return new;
end;
$$;
revoke all on function public.mobility_fee_pix_no_double_prepaid_v1_840()
 from public,anon,authenticated;
create trigger mobility_fee_pix_no_double_prepaid_v1_840_trg
 before insert on public.mobility_fee_pix_invoice_lines_v1_837
 for each row execute function public.mobility_fee_pix_no_double_prepaid_v1_840();

revoke all on function public.mobility_fee_pix_prepare_v1_837(uuid)
 from public,anon,authenticated;
grant execute on function public.mobility_fee_pix_prepare_v1_837(uuid) to service_role;
