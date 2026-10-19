-- TAMÃO: financeiro de compra de pacotes de cupons pela MESMA conta
-- recebedora do Mercado Pago usada no billing, sem autorizar vendas na migração.
-- Até implementar reserva, resgate, repartição e repasse da campanha,
-- nenhum pacote fica vendável; PIX nunca credita cupom por mera geração.
create table if not exists public.clube_coupon_paid_packages (
  package_key text primary key check(package_key ~ '^[a-z][a-z0-9_]{2,39}$'),
  title text not null check(length(title) between 6 and 120),
  sale_price_cents integer not null check(sale_price_cents between 100 and 1000000),
  coupon_face_cents integer not null check(coupon_face_cents between 100 and 1000000),
  coupons_per_pack integer not null check(coupons_per_pack between 1 and 15),
  valid_days integer not null check(valid_days between 1 and 365),
  funding_verified boolean not null default false,
  legal_terms_verified boolean not null default false,
  redeem_settlement_verified boolean not null default false,
  sale_enabled boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  constraint coupon_sale_requires_verification check(
    not sale_enabled or (funding_verified and legal_terms_verified and redeem_settlement_verified))
);

create table if not exists public.clube_coupon_paid_invoices (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references auth.users(id),
  package_key text not null references public.clube_coupon_paid_packages(package_key),
  request_id uuid not null,
  sale_price_cents integer not null check(sale_price_cents between 100 and 1000000),
  coupon_face_cents integer not null check(coupon_face_cents between 100 and 1000000),
  coupons_per_pack integer not null check(coupons_per_pack between 1 and 15),
  valid_days integer not null check(valid_days between 1 and 365),
  provider text not null default 'mercadopago' check(provider='mercadopago'),
  provider_order_id text unique,
  provider_payment_id text,
  status text not null default 'prepared'
    check(status in ('prepared','awaiting_payment','paid','expired','cancelled','refunded','review_required')),
  pix_br_code text,
  payment_url text,
  expires_at timestamptz,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint coupon_invoice_dedupe unique(customer_user_id,request_id)
);
create index if not exists clube_coupon_paid_invoices_customer_idx
 on public.clube_coupon_paid_invoices(customer_user_id,created_at desc);

create table if not exists public.clube_coupon_paid_issuances (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.clube_coupon_paid_invoices(id),
  ordinal integer not null check(ordinal between 1 and 15),
  customer_user_id uuid not null references auth.users(id),
  face_cents integer not null check(face_cents between 100 and 1000000),
  status text not null default 'issued'
    check(status in ('issued','reserved','redeemed','void','review_required')),
  expires_at timestamptz not null,
  redeemed_order_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  unique(invoice_id,ordinal)
);
create index if not exists clube_coupon_paid_issuances_owner_idx
 on public.clube_coupon_paid_issuances(customer_user_id,status,expires_at);

alter table public.clube_coupon_paid_packages enable row level security;
alter table public.clube_coupon_paid_invoices enable row level security;
alter table public.clube_coupon_paid_issuances enable row level security;
revoke all on public.clube_coupon_paid_packages from public,anon,authenticated;
revoke all on public.clube_coupon_paid_invoices from public,anon,authenticated;
revoke all on public.clube_coupon_paid_issuances from public,anon,authenticated;
grant select,insert,update on public.clube_coupon_paid_packages to service_role;
grant select,insert,update on public.clube_coupon_paid_invoices to service_role;
grant select,insert,update on public.clube_coupon_paid_issuances to service_role;

-- Only a verified Mercado Pago provider order, read by the server with TAMÃO's
-- credential, may call this RPC (service_role only). Replays are idempotent.
create or replace function public.clube_coupon_paid_payment_verify(
 p_invoice_id uuid,p_provider_order_id text,p_payment_id text,p_amount_cents integer
) returns jsonb language plpgsql security definer set search_path=pg_catalog
as $$
declare v_invoice public.clube_coupon_paid_invoices%rowtype;
begin
 select * into v_invoice from public.clube_coupon_paid_invoices
 where id=p_invoice_id for update;
 if not found then raise exception 'COUPON_INVOICE_NOT_FOUND'; end if;
 if v_invoice.provider_order_id is distinct from p_provider_order_id
    or v_invoice.sale_price_cents is distinct from p_amount_cents
    or p_payment_id is null or length(p_payment_id)<3 then
   raise exception 'COUPON_PAYMENT_PROOF_MISMATCH';
 end if;
 if v_invoice.status='paid' then
   return pg_catalog.jsonb_build_object('ok',true,'replayed',true,'invoiceId',v_invoice.id);
 end if;
 if v_invoice.status not in ('awaiting_payment','prepared') then
   raise exception 'COUPON_PAYMENT_STATE_INVALID';
 end if;
 update public.clube_coupon_paid_invoices
  set status='paid',paid_at=clock_timestamp(),provider_payment_id=p_payment_id,
      updated_at=clock_timestamp()
  where id=v_invoice.id;
 insert into public.clube_coupon_paid_issuances
  (invoice_id,ordinal,customer_user_id,face_cents,expires_at)
 select v_invoice.id,g,v_invoice.customer_user_id,v_invoice.coupon_face_cents,
        clock_timestamp()+pg_catalog.make_interval(days=>v_invoice.valid_days)
 from pg_catalog.generate_series(1,v_invoice.coupons_per_pack) as g
 on conflict (invoice_id,ordinal) do nothing;
 return pg_catalog.jsonb_build_object('ok',true,'replayed',false,
   'invoiceId',v_invoice.id,'issued',v_invoice.coupons_per_pack);
end
$$;
revoke all on function public.clube_coupon_paid_payment_verify(uuid,text,text,integer)
 from public,anon,authenticated;
grant execute on function public.clube_coupon_paid_payment_verify(uuid,text,text,integer)
 to service_role;

-- Refunded purchases invalidate unused vouchers; previously redeemed
-- vouchers require operator settlement review (never auto-credit or hide debt).
create or replace function public.clube_coupon_paid_payment_refund(
 p_invoice_id uuid,p_provider_order_id text
) returns jsonb language plpgsql security definer set search_path=pg_catalog
as $$
declare v_invoice public.clube_coupon_paid_invoices%rowtype;
declare v_redeemed integer;
begin
 select * into v_invoice from public.clube_coupon_paid_invoices
 where id=p_invoice_id for update;
 if not found or v_invoice.provider_order_id is distinct from p_provider_order_id
 then raise exception 'COUPON_REFUND_BINDING_MISMATCH';end if;
 select count(*) into v_redeemed from public.clube_coupon_paid_issuances
 where invoice_id=v_invoice.id and status in ('reserved','redeemed');
 if v_redeemed>0 then
  update public.clube_coupon_paid_invoices set status='review_required',updated_at=clock_timestamp()
  where id=v_invoice.id;
  update public.clube_coupon_paid_issuances set status='review_required'
  where invoice_id=v_invoice.id and status='issued';
  return pg_catalog.jsonb_build_object('ok',false,'reviewRequired',true);
 end if;
 update public.clube_coupon_paid_invoices
 set status='refunded',refunded_at=clock_timestamp(),updated_at=clock_timestamp()
 where id=v_invoice.id and status<>'refunded';
 update public.clube_coupon_paid_issuances set status='void'
 where invoice_id=v_invoice.id and status='issued';
 return pg_catalog.jsonb_build_object('ok',true,'refunded',true);
end
$$;
revoke all on function public.clube_coupon_paid_payment_refund(uuid,text)
 from public,anon,authenticated;
grant execute on function public.clube_coupon_paid_payment_refund(uuid,text)
 to service_role;
