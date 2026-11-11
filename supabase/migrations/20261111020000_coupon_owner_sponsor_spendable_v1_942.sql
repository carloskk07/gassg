-- V1.942: A verified, fully owner-sponsored voucher is spendable after PSP
-- payment confirmation even when Mercado Pago has not produced the NET report.
-- The actual provider NET remains NULL and the reconciliation worker still runs.
-- Only historical owner-funded contracts can use this path; partner and
-- unsponsored discounts retain their former NET-funding requirements.
create or replace function public.clube_coupon_owner_sponsor_spendable_v1_942(p_invoice uuid)
returns boolean language sql stable security definer set search_path to 'pg_catalog'
as $function$
 select exists (
  select 1 from public.clube_coupon_paid_invoices i
  where i.id=p_invoice and i.status='paid'
    and i.provider='mercadopago'
    and i.funding_mode_v1_846='platform_reimbursed'
    and i.paid_at is not null
    and nullif(i.provider_order_id,'') is not null
    and nullif(i.provider_payment_id,'') is not null
    and i.sponsor_covered_cents::bigint=
      i.coupon_face_cents::bigint*i.coupons_per_pack::bigint
    and i.sponsor_covered_cents>0
    and not exists (
      select 1 from public.clube_coupon_refund_requests_v1_814 r
      where r.invoice_id=i.id and r.status<>'closed')
    and public.clube_coupon_sponsor_covered_v1_807(
      i.id,i.coupon_face_cents::bigint*i.coupons_per_pack::bigint)
 );
$function$;
revoke all on function public.clube_coupon_owner_sponsor_spendable_v1_942(uuid)
 from public,anon,authenticated;
grant execute on function public.clube_coupon_owner_sponsor_spendable_v1_942(uuid) to service_role;

-- Preserve original atomic row locks, idempotency, owner and quote checks.
-- Do not manufacture a NET amount or MP report reference; owner-sponsor:
-- is explicitly an escrow provenance for the pre-existing NOT NULL column.
CREATE OR REPLACE FUNCTION public.clube_coupon_paid_quote_reserve(p_customer_user_id uuid, p_voucher_id uuid, p_quote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
 v_invoice_id uuid;
 v_invoice public.clube_coupon_paid_invoices%rowtype;
 v_voucher public.clube_coupon_paid_issuances%rowtype;
 v_quote record;
begin
 if p_customer_user_id is null or p_voucher_id is null or p_quote_id is null
 then raise exception 'COUPON_RESERVATION_INPUT_INVALID' using errcode='22023'; end if;
 select invoice_id into v_invoice_id from public.clube_coupon_paid_issuances
 where id=p_voucher_id;
 if not found then raise exception 'COUPON_NOT_FOUND' using errcode='P0002'; end if;
 select * into v_invoice from public.clube_coupon_paid_invoices
 where id=v_invoice_id for update;
 if not found or v_invoice.customer_user_id<>p_customer_user_id
 then raise exception 'COUPON_NOT_OWNED' using errcode='42501'; end if;
 select * into v_voucher from public.clube_coupon_paid_issuances
 where id=p_voucher_id for update;
 if not found or v_voucher.invoice_id<>v_invoice.id
    or v_voucher.customer_user_id<>p_customer_user_id
 then raise exception 'COUPON_OWNER_MISMATCH' using errcode='42501'; end if;
 if v_invoice.status<>'paid' or v_invoice.paid_at is null
    or v_invoice.provider_payment_id is null
    or v_invoice.provider_order_id is null
 then raise exception 'COUPON_PAYMENT_UNVERIFIED' using errcode='42501'; end if;
 if not exists(
   select 1 from public.clube_coupon_paid_packages p
   where p.package_key=v_invoice.package_key
     and p.funding_verified and p.legal_terms_verified
     and p.redeem_settlement_verified
 ) then raise exception 'COUPON_FUNDING_UNVERIFIED' using errcode='42501'; end if;
 -- Until sponsored-funding receipts are implemented, require the provider
 -- payment alone to cover the WHOLE outstanding face-value obligation.
 if v_invoice.sale_price_cents::bigint<
    v_invoice.coupon_face_cents::bigint*v_invoice.coupons_per_pack::bigint
    and not public.clube_coupon_sponsor_covered_v1_807(v_invoice.id,
      v_invoice.coupon_face_cents::bigint*v_invoice.coupons_per_pack::bigint)
    and not public.clube_partner_coupon_purchase_source_v1_848(v_invoice.id)
 then raise exception 'COUPON_FUNDS_INSUFFICIENT' using errcode='42501'; end if;
 -- This RPC is service-role only, but must independently enforce the
 -- same *liquid* lastro as create_order. A gross approved Pix never gives
 -- permission to hold a voucher before reconciliation of provider fees.
 -- A reservation replay must also be blocked if the invoice was changed.
 if not public.clube_coupon_owner_sponsor_spendable_v1_942(v_invoice.id) and (v_invoice.net_proceeds_verified_at is null
    or v_invoice.net_proceeds_reference is null
    or v_invoice.net_proceeds_cents is null
    or (v_invoice.net_proceeds_cents::bigint<
       v_invoice.coupon_face_cents::bigint*v_invoice.coupons_per_pack::bigint
       and not public.clube_coupon_sponsor_covered_v1_807(v_invoice.id,
         v_invoice.coupon_face_cents::bigint*v_invoice.coupons_per_pack::bigint)
    and not public.clube_partner_coupon_purchase_source_v1_848(v_invoice.id)))
 then raise exception 'COUPON_NET_PROCEEDS_UNVERIFIED'
  using errcode='42501'; end if;
 if v_voucher.face_cents<>v_invoice.coupon_face_cents
    or v_voucher.expires_at<=clock_timestamp()
 then raise exception 'COUPON_EXPIRED_OR_CHANGED' using errcode='40001'; end if;
 select customer_id,gross_total_cents,consumed_at,expires_at
 into v_quote from public.quotes
 where id=p_quote_id for share;
 if not found or v_quote.customer_id<>p_customer_user_id
 then raise exception 'COUPON_QUOTE_NOT_OWNED' using errcode='42501'; end if;
 if v_quote.consumed_at is not null or v_quote.expires_at<=clock_timestamp()
 then raise exception 'COUPON_QUOTE_STALE' using errcode='40001'; end if;
 if v_quote.gross_total_cents<v_voucher.face_cents
 then raise exception 'COUPON_EXCEEDS_QUOTE' using errcode='22023'; end if;
 if v_voucher.status='reserved' and v_voucher.reserved_quote_id=p_quote_id
 then return pg_catalog.jsonb_build_object(
   'ok',true,'reserved',true,'replayed',true,
   'voucherId',v_voucher.id,'quoteId',p_quote_id,
   'faceCents',v_voucher.face_cents,'appliedCents',0);
 end if;
 if v_voucher.status<>'issued' or v_voucher.reserved_quote_id is not null
 then raise exception 'COUPON_NOT_AVAILABLE' using errcode='40001'; end if;
 if exists(select 1 from public.clube_coupon_paid_issuances c
    where c.reserved_quote_id=p_quote_id)
 then raise exception 'COUPON_QUOTE_ALREADY_RESERVED' using errcode='23505'; end if;
 update public.clube_coupon_paid_issuances
 set status='reserved',reserved_quote_id=p_quote_id,reserved_at=clock_timestamp()
 where id=v_voucher.id;
 return pg_catalog.jsonb_build_object(
   'ok',true,'reserved',true,'replayed',false,
   'voucherId',v_voucher.id,'quoteId',p_quote_id,
   'faceCents',v_voucher.face_cents,'appliedCents',0);
end
$function$;

CREATE OR REPLACE FUNCTION public.clube_coupon_paid_create_order(p_user_id uuid, p_quote_id uuid, p_voucher_id uuid, p_payment_method text, p_idempotency_key text, p_request_hash text, p_referral_code text DEFAULT NULL::text, p_cash_tender_cents integer DEFAULT NULL::integer, p_customer_phone text DEFAULT NULL::text, p_address_complement text DEFAULT NULL::text, p_delivery_reference text DEFAULT NULL::text, p_delivery_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
 v_partner public.clube_partner_coupon_order_uses_v1_846%rowtype;
 v_return_count integer:=0;
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
    or (not public.clube_coupon_owner_sponsor_spendable_v1_942(v_invoice.id) and (v_invoice.net_proceeds_verified_at is null
    or v_invoice.net_proceeds_reference is null
    or v_invoice.net_proceeds_cents is null
    or (v_invoice.net_proceeds_cents::bigint<
       v_invoice.coupon_face_cents::bigint*v_invoice.coupons_per_pack::bigint
       and not public.clube_coupon_sponsor_covered_v1_807(v_invoice.id,
         v_invoice.coupon_face_cents::bigint*v_invoice.coupons_per_pack::bigint)
       and not public.clube_partner_coupon_purchase_source_v1_848(v_invoice.id)))
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
 v_before:=public.product_regular_cashback_position_v1_843(p_user_id);
 -- Existing cashback and the voucher must BOTH fit this one quote: no
 -- residual voucher credit that could be spent twice on another order.
 if v_before::bigint+v_face::bigint>v_quote.gross_total_cents::bigint then
  raise exception 'COUPON_AND_CASHBACK_EXCEED_QUOTE' using errcode='22023';end if;

 if v_invoice.funding_mode_v1_846='partner_funded' then
   select count(*) into v_return_count
   from public.clube_partner_coupon_returns_v1_847
   where voucher_id=p_voucher_id and disposition='reissued';
   if v_return_count>0 and (
     select count(*) from public.clube_coupon_paid_order_applications
     where voucher_id=p_voucher_id
   )<>v_return_count then
     raise exception 'PARTNER_COUPON_REISSUE_LINEAGE_INVALID' using errcode='23514';
   end if;
 end if;
 v_seed_key:='clube-paid-coupon:'||p_voucher_id::text||
    case when v_return_count>0 then ':return:'||v_return_count::text else '' end;
 insert into public.wallet_entries(user_id,order_id,bucket,entry_type,
  amount_cents,idempotency_key,metadata)
 values(p_user_id,null,'cashback','cashback_seed',v_face,v_seed_key,
   pg_catalog.jsonb_build_object('source','mercadopago_paid_coupon',
    'voucherId',p_voucher_id,'invoiceId',v_invoice.id,
    'providerOrderId',v_invoice.provider_order_id,
    'providerPaymentId',v_invoice.provider_payment_id,
    'fundingEvidenceReference',coalesce(v_invoice.net_proceeds_reference,'owner-sponsor:'||v_invoice.id::text)))
 on conflict(idempotency_key) do nothing;
 select * into v_wallet from public.wallet_entries
 where idempotency_key=v_seed_key;
 if not found or v_wallet.user_id<>p_user_id
   or v_wallet.amount_cents<>v_face
   or v_wallet.entry_type<>'cashback_seed'
   or v_wallet.bucket<>'cashback'
   or v_wallet.metadata->>'voucherId'<>p_voucher_id::text then
  raise exception 'COUPON_SEED_CONFLICT' using errcode='23505';end if;
 v_after:=public.product_regular_cashback_position_v1_843(p_user_id);
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
  original_order_total_cents,seed_wallet_entry_id_v1_847)
 values(v_voucher.id,v_order.id,p_quote_id,v_invoice.id,p_user_id,
  v_quote.merchant_id,v_face,
   coalesce(v_invoice.net_proceeds_reference,'owner-sponsor:'||v_invoice.id::text),
  v_order.cashback_reserved_cents,v_order.total_cents,
  case when v_invoice.funding_mode_v1_846='partner_funded' then v_wallet.id else null end);
 select * into v_partner from public.clube_partner_coupon_order_uses_v1_846
 where order_id=v_order_id;
 if found then
   v_result:=v_result||pg_catalog.jsonb_build_object(
     'partnerFundedCoupon',true,'partnerFundedDiscountCents',v_partner.face_cents,
     'partnerFeeBpsSnapshot',v_partner.fee_bps_snapshot,
     'couponFundingModel','partner_funded');
   update public.action_requests set result_json=v_result
   where user_id=p_user_id and idempotency_key=p_idempotency_key
     and action_name='create-order' and completed_at is not null;
   if not found then raise exception 'PARTNER_COUPON_IDEMPOTENCY_UPDATE_FAILED'
       using errcode='40001';end if;
 end if;
 return v_result||pg_catalog.jsonb_build_object(
  'couponAppliedCents',v_face,'couponVoucherId',p_voucher_id,
  'couponReplayed',false);
end
$function$;

-- Existing reconciler must not flag fully sponsored paid orders as missing
-- a provider NET report; it still verifies source count and order balances.
CREATE OR REPLACE FUNCTION public.clube_coupon_paid_order_reconciliation(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
 v_application public.clube_coupon_paid_order_applications%rowtype;
 v_order public.orders%rowtype;
 v_invoice public.clube_coupon_paid_invoices%rowtype;
 v_merchant_payment record;
 v_source_count integer;
 v_release_cents bigint;
 v_release_count integer;
 v_matching_release_count integer;
 v_state text;
 v_funder public.clube_partner_coupon_order_uses_v1_846%rowtype;
 v_return public.clube_partner_coupon_returns_v1_847%rowtype;
 v_seed public.wallet_entries%rowtype;
 v_hold public.wallet_entries%rowtype;
 v_release public.wallet_entries%rowtype;
begin
 select * into v_application from public.clube_coupon_paid_order_applications
 where order_id=p_order_id;
 if not found then raise exception 'COUPON_ORDER_NOT_FOUND' using errcode='P0002';end if;
 select * into v_order from public.orders where id=p_order_id;
 select * into v_invoice from public.clube_coupon_paid_invoices
 where id=v_application.invoice_id;
 if not found or v_order.id is null
 then raise exception 'COUPON_FINANCE_PROVENANCE_MISSING' using errcode='40001';end if;
 select count(*) into v_source_count from public.wallet_entries w
 where w.user_id=v_application.customer_user_id
 and w.bucket='cashback' and w.entry_type='cashback_seed'
 and w.amount_cents=v_application.face_cents
 and w.idempotency_key='clube-paid-coupon:'||v_application.voucher_id::text
 and w.metadata->>'invoiceId'=v_invoice.id::text
 and w.metadata->>'voucherId'=v_application.voucher_id::text;
 select * into v_merchant_payment from public.merchant_cashback_reimbursements
 where order_id=p_order_id;
 -- Count every returned cashback entry for this buyer/order. Crediting the
 -- correct wallet alone does not establish a genuine cancellation refund:
 -- another cashback release can carry that order ID or the wrong reason.
 select coalesce(sum(w.amount_cents),0),count(*),
   count(*) filter (where
     w.amount_cents=v_application.original_order_cashback_cents
     and w.metadata->>'reason'=v_order.risk_reason
     and right(w.idempotency_key,length(':cashback-release'))=':cashback-release')
 into v_release_cents,v_release_count,v_matching_release_count
 from public.wallet_entries w
 where w.order_id=p_order_id
   and w.user_id=v_application.customer_user_id
   and w.bucket='cashback' and w.entry_type='cashback_release';
 select * into v_funder from public.clube_partner_coupon_order_uses_v1_846
 where order_id=p_order_id;
 select * into v_return from public.clube_partner_coupon_returns_v1_847
 where order_id=p_order_id;
 if v_funder.order_id is not null then
   select * into v_seed from public.wallet_entries
     where id=v_application.seed_wallet_entry_id_v1_847;
   v_source_count:=case when v_seed.id is not null
      and v_seed.user_id=v_application.customer_user_id
      and v_seed.amount_cents=v_application.face_cents
      and v_seed.entry_type='cashback_seed'
      and v_seed.metadata->>'invoiceId'=v_invoice.id::text
      and v_seed.metadata->>'voucherId'=v_application.voucher_id::text
      then 1 else 0 end;
   if v_return.order_id is not null then
     select * into v_hold from public.wallet_entries
       where id=v_return.wallet_hold_entry_id;
     select * into v_release from public.wallet_entries
       where id=v_return.wallet_release_entry_id;
   end if;
 end if;
 v_state:=case
 -- Never certify customer refund using another wallet owner's release,
 -- or a coupon application whose buyer / immutable order snapshots drift.
 when v_application.customer_user_id is distinct from v_order.customer_id
   or v_invoice.customer_user_id is distinct from v_order.customer_id
   or v_application.original_order_total_cents is distinct from v_order.total_cents
   or v_application.original_order_cashback_cents is distinct from v_order.cashback_reserved_cents
   then 'FINANCIAL_REVIEW'
 when v_invoice.status<>'paid' or
   (v_invoice.net_proceeds_verified_at is null and
       not public.clube_coupon_owner_sponsor_spendable_v1_942(v_invoice.id)) or
   v_source_count<>1 then 'FINANCIAL_REVIEW'
 when v_order.financial_reversed_at is not null then 'REVERSAL_REVIEW'
 when v_funder.order_id is not null and v_order.status='CANCELLED'
  and (
     v_return.order_id is null
     or v_return.amount_cents<>v_funder.face_cents
     or v_return.customer_id<>v_order.customer_id
     or v_return.voucher_id<>v_funder.voucher_id
     or v_hold.amount_cents is distinct from -v_funder.face_cents
     or v_hold.user_id is distinct from v_order.customer_id
     or v_hold.entry_type is distinct from 'cashback_reserve'
     or v_release.amount_cents is distinct from v_funder.face_cents
     or v_release.entry_type is distinct from 'cashback_release'
     or v_return.cause<>'order_cancelled'
   ) then 'PARTNER_COUPON_RETURN_REVIEW'
 when v_funder.order_id is not null and v_order.status='CANCELLED'
  and v_return.disposition='manual_review'
  then 'PARTNER_COUPON_REFUND_REVIEW'
 when v_funder.order_id is not null and v_order.status='CANCELLED'
  and v_return.disposition='reissued'
  then 'PARTNER_COUPON_VOUCHER_RETURNED'
 when v_funder.order_id is not null and (
    v_funder.merchant_id is distinct from v_order.merchant_id
    or v_funder.customer_id is distinct from v_order.customer_id
    or v_funder.net_cents is distinct from v_order.total_cents
    or v_funder.gross_cents is distinct from v_order.gross_total_cents
    or v_funder.face_cents is distinct from v_application.face_cents
    or v_order.cashback_reserved_cents is distinct from v_funder.face_cents
    or v_invoice.funding_mode_v1_846 is distinct from 'partner_funded'
    or v_funder.fee_bps_snapshot is distinct from v_order.platform_fee_bps_snapshot
   ) then 'FINANCIAL_REVIEW'
 when v_funder.order_id is not null and v_order.status='SETTLED' and
   v_merchant_payment.order_id is not null then 'PARTNER_COUPON_REIMBURSEMENT_ANOMALY'
 when v_funder.order_id is not null and v_order.status='SETTLED' and
   not exists(select 1 from public.platform_receivables p
      where p.order_id=v_order.id and p.platform_fee_bps=v_funder.fee_bps_snapshot
        and p.benefit_fee_basis_cents_v1_843=v_funder.net_cents)
   then 'FINANCIAL_REVIEW'
 when v_funder.order_id is not null and v_order.status='SETTLED'
   then 'PARTNER_FUNDED_NO_REIMBURSEMENT'
 when v_order.status='SETTLED' and
   v_merchant_payment.order_id is null then 'MERCHANT_REIMBURSEMENT_MISSING'
 when v_order.status='SETTLED' and
   v_merchant_payment.cashback_cents<>v_order.cashback_reserved_cents
     then 'MERCHANT_REIMBURSEMENT_MISMATCH'
 -- Internal 'paid' is only an operator/accounting entry, not an
 -- independent bank/provider settlement proof. Until the existing TAMÃO
 -- financial-evidence workflow verifies an external payout, fail closed.
 -- A reversed merchant liability with an otherwise SETTLED order is
 -- contradictory accounting. Do not silently call it ORDER_IN_PROGRESS.
 -- The usual post-settlement order reversal is caught by the earlier
 -- financial_reversed_at check. This handles desynchronized reversal facts.
 when v_order.status='SETTLED' and
   v_merchant_payment.status='reversed' then 'REVERSAL_REVIEW'
 when v_order.status='SETTLED' and
   v_merchant_payment.status='paid' then 'MERCHANT_PAYOUT_UNVERIFIED'
 when v_order.status='SETTLED' and
   v_merchant_payment.status='open' then 'MERCHANT_REIMBURSEMENT_DUE'
 -- Do not mark the buyer refunded for an unrelated credit or two releases.
 -- Every production cancellation producer writes the SAME risk_reason into
 -- wallet metadata and an idempotency key ending :cashback-release.
 when v_order.status='CANCELLED'
   and v_order.risk_reason is not null
   and v_release_count=1 and v_matching_release_count=1
   and v_release_cents=v_application.original_order_cashback_cents
     then 'CUSTOMER_CREDIT_RETURNED'
 when v_order.status='CANCELLED' then 'CANCELLATION_REVIEW'
 else 'ORDER_IN_PROGRESS' end;
 return pg_catalog.jsonb_build_object(
  'source','clube_coupon_paid_order_reconciliation_v1',
  'couponFundingModel',case when v_funder.order_id is not null then 'partner_funded' else 'platform_reimbursed' end,
  'partnerFundedDiscountCents',coalesce(v_funder.face_cents,0),
  'partnerCouponReturnDisposition',v_return.disposition,
  'partnerCouponReturnCause',v_return.cause,
  'partnerCouponCreditFungible',false,
  'orderId',v_order.id,'voucherId',v_application.voucher_id,
  'invoiceId',v_invoice.id,'status',v_state,
  'couponFaceCents',v_application.face_cents,
  'cashbackReservedCents',v_order.cashback_reserved_cents,
  'orderTotalCents',v_order.total_cents,
  'fundingNetProceedsCents',v_invoice.net_proceeds_cents,
  'originalQuotedMerchantId',v_application.quoted_merchant_id,
  'currentMerchantId',v_order.merchant_id,
  'merchantReimbursementCents',v_merchant_payment.cashback_cents,
  'merchantReimbursementStatus',v_merchant_payment.status,
  'merchantExternalSettlementVerified',false,
  'returnedCashbackCents',v_release_cents);
end
$function$;
