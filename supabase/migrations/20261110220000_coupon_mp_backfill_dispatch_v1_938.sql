-- V1.938 — dispatch authorization is immutable BEFORE any MP report POST.
-- Existing V1.937 claim may be safely recovered ONLY with exact internal
-- proof that validation failed before any outbound provider call.
alter table public.clube_coupon_mp_report_backfill_v1_936
 add column if not exists dispatch_started_at timestamptz,
 add column if not exists dispatch_authority text
  check(dispatch_authority in ('fresh_claim','verified_no_post_recovery'));
revoke all on public.clube_coupon_mp_report_backfill_v1_936
 from public,anon,authenticated;

create or replace function public.clube_coupon_mp_report_backfill_dispatch_v1_938(
 p_invoice uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog
as $fn$
declare
 v_claim record;
 v_invoice record;
 v_authority text;
 v_legacy_verified boolean;
begin
 if p_invoice is null or not exists(
  select 1 from public.clube_coupon_net_auto_config_v1_931
  where id=true and enabled
 ) then
  return jsonb_build_object('authorized',false,'reason','DISABLED');
 end if;
 select status,paid_at,provider_order_id,provider_payment_id,
   net_proceeds_verified_at into v_invoice
 from public.clube_coupon_paid_invoices where id=p_invoice for update;
 if not found or v_invoice.status<>'paid' or v_invoice.paid_at is null
   or v_invoice.provider_order_id is null or v_invoice.provider_payment_id is null
   or v_invoice.net_proceeds_verified_at is not null then
   return jsonb_build_object('authorized',false,'reason','INVOICE_INELIGIBLE');
 end if;
 select invoice_id,request_day,period_start,period_end,created_at,
   dispatch_started_at into v_claim
 from public.clube_coupon_mp_report_backfill_v1_936
 where invoice_id=p_invoice for update;
 if not found or v_claim.dispatch_started_at is not null
   or v_claim.period_end>clock_timestamp()
   or v_claim.period_start>=v_claim.period_end
   or v_claim.request_day<>(v_claim.created_at at time zone 'UTC')::date
 then
   return jsonb_build_object('authorized',false,'reason','CLAIM_UNAVAILABLE');
 end if;
 if v_claim.created_at>clock_timestamp()-interval '90 seconds' then
  v_authority:='fresh_claim';
 else
  -- We cannot replay an ordinary historical claim because its provider POST
  -- may have succeeded despite a lost response. The *only* exception is an
  -- immutable pg_net result proving the old worker rejected a malformed
  -- date locally BEFORE calling Mercado Pago, correlated by creation time.
  select exists(
   select 1 from net._http_response r
   where r.status_code=200
     and r.content like '%"reportBackfill":"INVALID_CLAIM_WINDOW_NO_POST"%'
     and r.created between v_claim.created_at-interval '3 minutes'
                       and v_claim.created_at+interval '3 minutes'
  ) into v_legacy_verified;
  if v_legacy_verified is distinct from true then
   return jsonb_build_object('authorized',false,'reason','NO_PROVEN_PREPOST_FAILURE');
  end if;
  v_authority:='verified_no_post_recovery';
 end if;
 update public.clube_coupon_mp_report_backfill_v1_936
 set dispatch_started_at=clock_timestamp(),dispatch_authority=v_authority
 where invoice_id=p_invoice and dispatch_started_at is null;
 if not found then
  return jsonb_build_object('authorized',false,'reason','DISPATCH_ALREADY_STARTED');
 end if;
 return jsonb_build_object(
  'authorized',true,'authority',v_authority,
  'begin_date',to_char(v_claim.period_start at time zone 'UTC',
     'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'end_date',to_char(v_claim.period_end at time zone 'UTC',
     'YYYY-MM-DD"T"HH24:MI:SS"Z"')
 );
end $fn$;
revoke all on function public.clube_coupon_mp_report_backfill_dispatch_v1_938(uuid)
 from public,anon,authenticated;
grant execute on function public.clube_coupon_mp_report_backfill_dispatch_v1_938(uuid)
 to service_role;
