-- TAMÃO V1.936 — one bounded report backfill request, never a payment operation.
-- Reconciliation is unchanged: only verified provider CSV + audited net RPC
-- can record funds, and no purchase/credit is created by this migration.
create table if not exists public.clube_coupon_mp_report_backfill_v1_936 (
 invoice_id uuid primary key references public.clube_coupon_paid_invoices(id),
 request_day date not null unique,
 period_start timestamptz not null,
 period_end timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 constraint valid_backfill_period check(period_end>period_start and
   period_end<=created_at and period_end-period_start<=interval '2 days')
);
alter table public.clube_coupon_mp_report_backfill_v1_936 enable row level security;
revoke all on public.clube_coupon_mp_report_backfill_v1_936 from public,anon,authenticated;
grant select on public.clube_coupon_mp_report_backfill_v1_936 to service_role;

create or replace function public.clube_coupon_mp_report_backfill_claim_v1_936(
 p_invoice uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog
as $fn$
declare
 v_invoice record;
 v_utc_day date;
 v_start timestamptz;
 v_end timestamptz;
 v_saved uuid;
begin
 if p_invoice is null or not exists(
  select 1 from public.clube_coupon_net_auto_config_v1_931
  where id=true and enabled
 ) then return jsonb_build_object('claimed',false,'reason','NOT_AUTHORIZED'); end if;
 select id,status,paid_at,provider_order_id,provider_payment_id,
        net_proceeds_verified_at
 into v_invoice from public.clube_coupon_paid_invoices
 where id=p_invoice for update;
 if not found or v_invoice.status<>'paid' or v_invoice.paid_at is null
   or v_invoice.provider_order_id is null or v_invoice.provider_payment_id is null
   or v_invoice.net_proceeds_verified_at is not null
   or v_invoice.paid_at>clock_timestamp()-interval '2 hours'
   or v_invoice.paid_at<clock_timestamp()-interval '7 days' then
    return jsonb_build_object('claimed',false,'reason','NOT_ELIGIBLE');
 end if;
 v_utc_day:=(clock_timestamp() at time zone 'UTC')::date;
 v_start:=date_trunc('day',v_invoice.paid_at at time zone 'UTC') at time zone 'UTC';
 v_end:=clock_timestamp()-interval '15 minutes';
 if v_end<=v_invoice.paid_at or v_end<=v_start or v_end-v_start>interval '2 days' then
  return jsonb_build_object('claimed',false,'reason','WINDOW_INVALID');
 end if;
 -- One attempt per invoice FOREVER, and one attempt across all coupons per
 -- UTC day. Unique indexes also close races across cron workers.
 insert into public.clube_coupon_mp_report_backfill_v1_936(
   invoice_id,request_day,period_start,period_end
 ) values(v_invoice.id,v_utc_day,v_start,v_end)
 on conflict do nothing returning invoice_id into v_saved;
 if v_saved is null then
  return jsonb_build_object('claimed',false,'reason','ALREADY_REQUESTED');
 end if;
 return jsonb_build_object('claimed',true,
  'begin_date',to_char(v_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'end_date',to_char(v_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
end $fn$;
revoke all on function public.clube_coupon_mp_report_backfill_claim_v1_936(uuid)
 from public,anon,authenticated;
grant execute on function public.clube_coupon_mp_report_backfill_claim_v1_936(uuid) to service_role;
