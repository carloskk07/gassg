-- TAMÃO V1.316 — signed Mercado Pago notifications for *review*, never settlement.
-- A webhook cannot approve payment or publish an ad. Only the V1.314 API-verified founder path may reconcile.
create table public.platform_ads_mp_inbox_v1_316 (
 event_key text primary key check(event_key ~ '^[a-f0-9]{64}$'),
 merchant_id uuid not null references public.merchants(id),
 payment_id text not null check(payment_id ~ '^[0-9]{5,30}$'),
 external_reference text not null check(char_length(external_reference) between 36 and 120),
 provider_status text not null check(char_length(provider_status) between 3 and 48),
 provider_status_detail text,
 amount_cents integer not null check(amount_cents between 1000 and 5000000),
 collector_id text not null check(collector_id ~ '^[0-9]{4,20}$'),
 currency text not null default 'BRL' check(currency='BRL'),
 received_at timestamptz not null default clock_timestamp(),
 verified_by_provider_api boolean not null default true check(verified_by_provider_api=true),
 reconciled_automatically boolean not null default false check(reconciled_automatically=false)
);
create index platform_ads_mp_inbox_merchant_v1_316
 on public.platform_ads_mp_inbox_v1_316(merchant_id,received_at desc);
alter table public.platform_ads_mp_inbox_v1_316 enable row level security;
revoke all on public.platform_ads_mp_inbox_v1_316 from public,anon,authenticated;
grant select,insert on public.platform_ads_mp_inbox_v1_316 to service_role;

create or replace function public.ads_mp_inbox_record_v1_316(
 p_event_key text,p_payment_id text,p_external_reference text,
 p_collector_id text,p_amount_cents integer,
 p_currency text,p_provider_status text,p_status_detail text
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog'
as $f$
declare v_c public.platform_ads_psp_checkouts_v1_314%rowtype;
 v_inserted integer;
begin
 if p_event_key is null or p_event_key !~ '^[a-f0-9]{64}$' or
  p_payment_id is null or p_payment_id !~ '^[0-9]{5,30}$' or
  p_external_reference is null or
  p_collector_id is null or p_collector_id !~ '^[0-9]{4,20}$' or
  p_currency <> 'BRL' or
  p_provider_status is null or char_length(p_provider_status) not between 3 and 48 or
  p_status_detail is not null and char_length(p_status_detail)>120
 then raise exception 'ADS_MP_INBOX_INVALID_EVIDENCE' using errcode='22023';end if;
 select * into v_c from public.platform_ads_psp_checkouts_v1_314
 where external_reference=p_external_reference and
   status in ('checkout_ready','payment_approved','payment_reversed');
 if not found then return jsonb_build_object('source','ads_mp_inbox_v1_316',
   'recorded',false,'reason','checkout_unknown','paymentApproved',false,
   'adsLive',false,'automaticReconciliation',false);end if;
 if v_c.collector_id is null or v_c.collector_id<>p_collector_id or
  v_c.amount_cents<>p_amount_cents or
  (v_c.payment_id is not null and v_c.payment_id<>p_payment_id)
 then raise exception 'ADS_MP_INBOX_CHECKOUT_MISMATCH' using errcode='42501';end if;
 insert into public.platform_ads_mp_inbox_v1_316(
  event_key,merchant_id,payment_id,external_reference,collector_id,
  amount_cents,currency,provider_status,provider_status_detail)
 values(p_event_key,v_c.merchant_id,p_payment_id,p_external_reference,p_collector_id,
  p_amount_cents,'BRL',p_provider_status,p_status_detail)
 on conflict(event_key) do nothing;
 get diagnostics v_inserted=row_count;
 return jsonb_build_object('source','ads_mp_inbox_v1_316',
  'recorded',v_inserted=1,'duplicate',v_inserted=0,
  'paymentApproved',false,'adsLive',false,'automaticReconciliation',false);
end;
$f$;
revoke all on function public.ads_mp_inbox_record_v1_316(text,text,text,text,integer,text,text,text)
 from public,anon,authenticated;
grant execute on function public.ads_mp_inbox_record_v1_316(text,text,text,text,integer,text,text,text)
 to service_role;

create or replace function public.admin_ads_mp_inbox_read_v1_316(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog'
as $f$
declare v_count bigint;v_rows jsonb;
begin
 if not exists(select 1 from public.platform_admins a
 where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','operations','readonly'))
 then raise exception 'ADS_MP_INBOX_ADMIN_DENIED' using errcode='42501';end if;
 select count(*) into v_count from public.platform_ads_mp_inbox_v1_316;
 select coalesce(jsonb_agg(jsonb_build_object(
  'merchantId',x.merchant_id,'merchantName',left(m.name,120),
  'paymentId',x.payment_id,'providerStatus',x.provider_status,
  'providerStatusDetail',x.provider_status_detail,
  'amountCents',x.amount_cents,'receivedAt',x.received_at,
  'checkoutStatus',c.status,'checkoutPaymentId',c.payment_id
 ) order by x.received_at desc,x.event_key),'[]'::jsonb) into v_rows
 from (select * from public.platform_ads_mp_inbox_v1_316
       order by received_at desc,event_key limit 50) x
 join public.merchants m on m.id=x.merchant_id
 join public.platform_ads_psp_checkouts_v1_314 c on c.merchant_id=x.merchant_id;
 return jsonb_build_object('source','admin_ads_mp_inbox_v1_316',
  'readOnly',true,'totalEvents',v_count,'rows',v_rows,
  'adsLive',false,'automaticReconciliation',false,'webhookCannotMarkPaid',true);
end;
$f$;
revoke all on function public.admin_ads_mp_inbox_read_v1_316(uuid) from public,anon,authenticated;
grant execute on function public.admin_ads_mp_inbox_read_v1_316(uuid) to service_role;
