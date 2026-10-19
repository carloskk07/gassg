-- TAMÃO: merchant-compensated paid-coupon checkout, gated until verified
-- Mercado Pago NET proceeds and real order/settlement E2E are confirmed.
-- Depends on 20261019170000; DO NOT apply before isolated finance gates pass.
alter table public.clube_coupon_paid_invoices
 add column net_proceeds_cents integer
   check(net_proceeds_cents between 1 and 1000000),
 add column net_proceeds_reference text
   check(length(net_proceeds_reference) between 8 and 240),
 add column net_proceeds_verified_at timestamptz,
 add constraint coupon_net_proceeds_evidence_complete check(
  (net_proceeds_cents is null and net_proceeds_reference is null
    and net_proceeds_verified_at is null)
  or (net_proceeds_cents is not null and net_proceeds_reference is not null
    and net_proceeds_verified_at is not null)
 );
-- No invoices receive settlement evidence automatically. A real, verified
-- MP net-receipt ledger reference is REQUIRED before discount redemption.
create or replace function public.clube_coupon_paid_net_proceeds_verify(
 p_invoice_id uuid,p_provider_order_id text,p_net_cents integer,p_reference text
) returns jsonb language plpgsql security definer set search_path=pg_catalog
as $$
declare v public.clube_coupon_paid_invoices%rowtype;
begin
 select * into v from public.clube_coupon_paid_invoices
 where id=p_invoice_id for update;
 if not found or v.status<>'paid' or v.provider_order_id is distinct from p_provider_order_id
 or v.paid_at is null or v.provider_payment_id is null
 or p_net_cents is null or p_net_cents<=0
 or p_net_cents>v.sale_price_cents
 or p_net_cents::bigint<v.coupon_face_cents::bigint*v.coupons_per_pack::bigint
 or p_reference is null or length(trim(p_reference)) not between 8 and 240
 then raise exception 'COUPON_NET_PROCEEDS_UNVERIFIED' using errcode='42501';end if;
 if v.net_proceeds_cents is not null then
  if v.net_proceeds_cents<>p_net_cents
  or v.net_proceeds_reference<>trim(p_reference)
  then raise exception 'COUPON_NET_PROCEEDS_REPLAY_CONFLICT' using errcode='23505';end if;
  return pg_catalog.jsonb_build_object('ok',true,'replayed',true,'invoiceId',v.id);
 end if;
 update public.clube_coupon_paid_invoices set
 net_proceeds_cents=p_net_cents,
 net_proceeds_reference=trim(p_reference),
 net_proceeds_verified_at=clock_timestamp(),updated_at=clock_timestamp()
 where id=v.id;
 return pg_catalog.jsonb_build_object('ok',true,'replayed',false,'invoiceId',v.id);
end
$$;
revoke all on function public.clube_coupon_paid_net_proceeds_verify(uuid,text,integer,text)
 from public,anon,authenticated;
grant execute on function public.clube_coupon_paid_net_proceeds_verify(uuid,text,integer,text)
 to service_role;

create table public.clube_coupon_paid_order_applications(
 voucher_id uuid primary key references public.clube_coupon_paid_issuances(id),
 order_id uuid not null unique references public.orders(id) on delete restrict,
 quote_id uuid not null unique references public.quotes(id) on delete restrict,
 invoice_id uuid not null references public.clube_coupon_paid_invoices(id),
 customer_user_id uuid not null references auth.users(id),
 quoted_merchant_id uuid not null references public.merchants(id),
 face_cents integer not null check(face_cents>0),
 net_proceeds_reference text not null,
 original_order_cashback_cents integer not null check(original_order_cashback_cents>=face_cents),
 original_order_total_cents integer not null check(original_order_total_cents>=0),
 applied_at timestamptz not null default clock_timestamp()
);
alter table public.clube_coupon_paid_order_applications enable row level security;
revoke all on public.clube_coupon_paid_order_applications from public,anon,authenticated;
grant select,insert on public.clube_coupon_paid_order_applications to service_role;

-- This function is service-role only and is called by the SAME authenticated
-- create-order Edge handler after JWT authentication and request fingerprinting.
-- It does not alter order money columns or bypass the regular v8 policy checks.
-- The existing wallet cashback_reserve + settlement reimbursement path remains
-- the authoritative money movement; the voucher seed is prepaid by MP.
create or replace function public.clube_coupon_paid_create_order(
 p_user_id uuid,p_quote_id uuid,p_voucher_id uuid,
 p_payment_method text,p_idempotency_key text,p_request_hash text,
 p_referral_code text default null,p_cash_tender_cents integer default null,
 p_customer_phone text default null,p_address_complement text default null,
 p_delivery_reference text default null,p_delivery_notes text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog
as $$
declare
 v_action public.action_requests%rowtype;
 v_invoice_id uuid;
 v_invoice public.clube_coupon_paid_invoices%rowtype;
 v_voucher public.clube_coupon_paid_issuances%rowtype;
 v_quote public.quotes%rowtype;
 v_order public.orders%rowtype;
 v_result jsonb;
 v_order_id uuid;
 v_before integer;
 v_after integer;
 v_face integer;
 v_seed_key text;
 v_wallet public.wallet_entries%rowtype;
 v_application public.clube_coupon_paid_order_applications%rowtype;
begin
 if p_user_id is null or p_quote_id is null or p_voucher_id is null
    or p_idempotency_key is null or p_request_hash is null then
  raise exception 'COUPON_CHECKOUT_INVALID' using errcode='22023'; end if;
 -- Exact lock namespace used by create_order_from_quote_v8; serialize all
 -- cashback consumption, normal orders and voucher-backed orders per customer.
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('cashback-user:'||p_user_id::text,0));
 select * into v_action from public.action_requests
 where idempotency_key=p_idempotency_key for update;
 if found and v_action.completed_at is not null then
   if v_action.user_id<>p_user_id or v_action.action_name<>'create-order'
   or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';end if;
   v_order_id:=(v_action.result_json->>'orderId')::uuid;
   select * into v_application
    from public.clube_coupon_paid_order_applications
    where order_id=v_order_id and voucher_id=p_voucher_id
    and quote_id=p_quote_id and customer_user_id=p_user_id;
   if not found then
    raise exception 'COUPON_ORDER_REPLAY_MISMATCH' using errcode='23505';end if;
   return v_action.result_json||pg_catalog.jsonb_build_object(
    'couponAppliedCents',v_application.face_cents,
    'couponVoucherId',v_application.voucher_id,'couponReplayed',true);
 end if;

 -- Prevent issuance before verification, quote ownership, or net settlement.
 select invoice_id into v_invoice_id
 from public.clube_coupon_paid_issuances where id=p_voucher_id;
 if not found then raise exception 'COUPON_NOT_FOUND' using errcode='P0002';end if;
 select * into v_invoice from public.clube_coupon_paid_invoices
 where id=v_invoice_id for update;
 if not found or v_invoice.customer_user_id<>p_user_id
    or v_invoice.status<>'paid' or v_invoice.provider_order_id is null
    or v_invoice.provider_payment_id is null or v_invoice.paid_at is null
    or v_invoice.net_proceeds_verified_at is null
    or v_invoice.net_proceeds_reference is null
    or v_invoice.net_proceeds_cents is null
    or v_invoice.net_proceeds_cents::bigint<
       v_invoice.coupon_face_cents::bigint*v_invoice.coupons_per_pack::bigint
 then raise exception 'COUPON_PAID_NET_FUNDS_REQUIRED' using errcode='42501';end if;
 select * into v_voucher from public.clube_coupon_paid_issuances
 where id=p_voucher_id for update;
 if not found or v_voucher.invoice_id<>v_invoice.id
    or v_voucher.customer_user_id<>p_user_id
    or v_voucher.status not in ('issued','reserved')
    or v_voucher.expires_at<=clock_timestamp()
    or v_voucher.face_cents<>v_invoice.coupon_face_cents
 then raise exception 'COUPON_INVALID_OR_SPENT' using errcode='40001';end if;
 select * into v_quote from public.quotes
 where id=p_quote_id and customer_id=p_user_id for share;
 if not found or v_quote.consumed_at is not null or
    v_quote.expires_at<=clock_timestamp() or
    v_quote.gross_total_cents<v_voucher.face_cents then
  raise exception 'COUPON_QUOTE_INVALID' using errcode='40001';end if;

 -- Reserve voucher and quote; an earlier reserved voucher can only be
 -- applied to the SAME quote and user.
 perform public.clube_coupon_paid_quote_reserve(
  p_user_id,p_voucher_id,p_quote_id);
 v_face:=v_voucher.face_cents;
 v_before:=coalesce((public.cashback_position(p_user_id)->>'spendableCents')::integer,0);
 -- Existing cashback and the voucher must BOTH fit this one quote: no
 -- residual voucher credit that could be spent twice on another order.
 if v_before::bigint+v_face::bigint>v_quote.gross_total_cents::bigint then
  raise exception 'COUPON_AND_CASHBACK_EXCEED_QUOTE' using errcode='22023';end if;

 v_seed_key:='clube-paid-coupon:'||p_voucher_id::text;
 insert into public.wallet_entries(user_id,order_id,bucket,entry_type,
  amount_cents,idempotency_key,metadata)
 values(p_user_id,null,'cashback','cashback_seed',v_face,v_seed_key,
   pg_catalog.jsonb_build_object('source','mercadopago_paid_coupon',
    'voucherId',p_voucher_id,'invoiceId',v_invoice.id,
    'providerOrderId',v_invoice.provider_order_id,
    'providerPaymentId',v_invoice.provider_payment_id,
    'netProceedsReference',v_invoice.net_proceeds_reference))
 on conflict(idempotency_key) do nothing;
 select * into v_wallet from public.wallet_entries
 where idempotency_key=v_seed_key;
 if not found or v_wallet.user_id<>p_user_id
   or v_wallet.amount_cents<>v_face
   or v_wallet.entry_type<>'cashback_seed'
   or v_wallet.bucket<>'cashback'
   or v_wallet.metadata->>'voucherId'<>p_voucher_id::text then
  raise exception 'COUPON_SEED_CONFLICT' using errcode='23505';end if;
 v_after:=coalesce((public.cashback_position(p_user_id)->>'spendableCents')::integer,0);
 if v_after-v_before<>v_face then
  raise exception 'COUPON_CASHBACK_DEBT_OR_DRIFT' using errcode='40001';end if;

 -- Atomic: if ANY downstream v8 check fails, grant+reservation+request+order
 -- are rolled back in the same transaction. V8 keeps the immutable pricing,
 -- city authorisation, idempotency, fraud checks and regular settlement.
 v_result:=public.create_order_from_quote_v8(
   p_user_id,p_quote_id,p_payment_method,true,p_idempotency_key,
   p_request_hash,p_referral_code,p_cash_tender_cents,p_customer_phone,
   p_address_complement,p_delivery_reference,p_delivery_notes);
 v_order_id:=(v_result->>'orderId')::uuid;
 select * into v_order from public.orders where id=v_order_id for update;
 if not found or v_order.customer_id<>p_user_id
    or coalesce(v_order.merchant_id,v_order.proposed_merchant_id)<>v_quote.merchant_id
    or v_order.gross_total_cents<>v_quote.gross_total_cents
    or v_order.cashback_reserved_cents<>v_after
    or v_order.cashback_reserved_cents<v_face
    or v_order.total_cents<>
       v_order.gross_total_cents-v_order.cashback_reserved_cents then
   raise exception 'COUPON_ORDER_MONEY_MISMATCH' using errcode='23514';end if;
 update public.clube_coupon_paid_issuances
  set status='redeemed',redeemed_order_id=v_order_id,
      reserved_quote_id=null,reserved_at=null
  where id=p_voucher_id and status='reserved'
    and reserved_quote_id=p_quote_id;
 if not found then raise exception 'COUPON_REDEMPTION_RACE' using errcode='40001';end if;
 insert into public.clube_coupon_paid_order_applications(
  voucher_id,order_id,quote_id,invoice_id,customer_user_id,quoted_merchant_id,
  face_cents,net_proceeds_reference,original_order_cashback_cents,
  original_order_total_cents)
 values(v_voucher.id,v_order.id,p_quote_id,v_invoice.id,p_user_id,
  v_quote.merchant_id,v_face,v_invoice.net_proceeds_reference,
  v_order.cashback_reserved_cents,v_order.total_cents);
 return v_result||pg_catalog.jsonb_build_object(
  'couponAppliedCents',v_face,'couponVoucherId',p_voucher_id,
  'couponReplayed',false);
end
$$;
revoke all on function public.clube_coupon_paid_create_order(
 uuid,uuid,uuid,text,text,text,text,integer,text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.clube_coupon_paid_create_order(
 uuid,uuid,uuid,text,text,text,text,integer,text,text,text,text)
 to service_role;
