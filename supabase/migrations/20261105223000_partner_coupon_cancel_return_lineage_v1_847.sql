
-- TAMÃO #847: canceled partner-financed vouchers return to the SAME paid
-- voucher and never become ordinary transferable TAMÃO cashback.
-- This migration does NOT enable sales or edit any historical invoice.
ALTER TABLE public.clube_coupon_paid_order_applications
 DROP CONSTRAINT clube_coupon_paid_order_applications_pkey;
ALTER TABLE public.clube_coupon_paid_order_applications
 ADD CONSTRAINT clube_coupon_paid_order_applications_pkey
 PRIMARY KEY(voucher_id,order_id);
ALTER TABLE public.clube_partner_coupon_order_uses_v1_846
 DROP CONSTRAINT clube_partner_coupon_order_uses_v1_846_voucher_id_key;
ALTER TABLE public.clube_coupon_paid_order_applications
 ADD COLUMN seed_wallet_entry_id_v1_847 uuid REFERENCES public.wallet_entries(id);
CREATE INDEX clube_coupon_application_voucher_history_v1_847
 ON public.clube_coupon_paid_order_applications(voucher_id,order_id);
CREATE FUNCTION public.clube_coupon_application_immutable_seed_v1_847()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$BEGIN
 IF new.seed_wallet_entry_id_v1_847 IS DISTINCT FROM old.seed_wallet_entry_id_v1_847
 THEN RAISE EXCEPTION 'COUPON_SEED_RECEIPT_IMMUTABLE' USING ERRCODE='23514';END IF;
 RETURN new;
END;$$;
REVOKE ALL ON FUNCTION public.clube_coupon_application_immutable_seed_v1_847() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER clube_coupon_application_immutable_seed_v1_847
 BEFORE UPDATE OF seed_wallet_entry_id_v1_847
 ON public.clube_coupon_paid_order_applications
 FOR EACH ROW EXECUTE FUNCTION public.clube_coupon_application_immutable_seed_v1_847();

CREATE TABLE public.clube_partner_coupon_returns_v1_847(
 order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE RESTRICT,
 voucher_id uuid NOT NULL REFERENCES public.clube_coupon_paid_issuances(id) ON DELETE RESTRICT,
 invoice_id uuid NOT NULL REFERENCES public.clube_coupon_paid_invoices(id) ON DELETE RESTRICT,
 customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 wallet_release_entry_id uuid NOT NULL UNIQUE REFERENCES public.wallet_entries(id) ON DELETE RESTRICT,
 wallet_hold_entry_id uuid NOT NULL UNIQUE REFERENCES public.wallet_entries(id) ON DELETE RESTRICT,
 amount_cents integer NOT NULL CHECK(amount_cents BETWEEN 100 AND 500),
 disposition text NOT NULL CHECK(disposition IN ('reissued','manual_review')),
 cause text NOT NULL CHECK(cause IN ('order_cancelled','post_settlement_financial_reversal')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX clube_partner_coupon_returns_voucher_v1_847
 ON public.clube_partner_coupon_returns_v1_847(voucher_id,recorded_at);
ALTER TABLE public.clube_partner_coupon_returns_v1_847 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clube_partner_coupon_returns_v1_847 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.clube_partner_coupon_returns_v1_847 TO service_role;
CREATE FUNCTION public.clube_partner_coupon_returns_immutable_v1_847()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$BEGIN RAISE EXCEPTION 'PARTNER_COUPON_RETURN_IMMUTABLE' USING ERRCODE='23514';END;$$;
REVOKE ALL ON FUNCTION public.clube_partner_coupon_returns_immutable_v1_847() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER clube_partner_coupon_returns_immutable_v1_847
 BEFORE UPDATE OR DELETE ON public.clube_partner_coupon_returns_v1_847
 FOR EACH ROW EXECUTE FUNCTION public.clube_partner_coupon_returns_immutable_v1_847();

-- DO NOT run this at the first cashback release INSERT: several legitimate
-- cancellation RPCs write the release BEFORE they update orders to CANCELLED.
-- Deferred commit-time constraint executes atomically, after the final order
-- state is known. Another checkout cannot see intermediate wallet credits.
CREATE FUNCTION public.clube_partner_coupon_release_to_voucher_v1_847()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $return$
DECLARE
 v_receipt public.clube_partner_coupon_order_uses_v1_846%rowtype;
 v_order public.orders%rowtype;
 v_voucher public.clube_coupon_paid_issuances%rowtype;
 v_invoice public.clube_coupon_paid_invoices%rowtype;
 v_hold uuid;
 v_reason text;
 v_kind text;
 v_disposition text;
BEGIN
 SELECT * INTO v_receipt FROM public.clube_partner_coupon_order_uses_v1_846
 WHERE order_id=new.order_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO v_order FROM public.orders WHERE id=new.order_id FOR UPDATE;
 -- Same lock order as paid coupon checkout: invoice, then voucher.
 SELECT * INTO v_invoice FROM public.clube_coupon_paid_invoices
 WHERE id=v_receipt.invoice_id FOR UPDATE;
 SELECT * INTO v_voucher FROM public.clube_coupon_paid_issuances
 WHERE id=v_receipt.voucher_id FOR UPDATE;
 v_reason:=new.metadata->>'reason';
 IF v_order.id IS NULL OR v_voucher.id IS NULL OR v_invoice.id IS NULL
    OR new.bucket<>'cashback' OR new.entry_type<>'cashback_release'
    OR new.user_id<>v_receipt.customer_id
    OR v_order.customer_id<>v_receipt.customer_id
    OR v_order.merchant_id<>v_receipt.merchant_id
    OR v_order.cashback_reserved_cents<>v_receipt.face_cents
    OR new.amount_cents<>v_receipt.face_cents
    OR v_invoice.funding_mode_v1_846<>'partner_funded'
    OR v_invoice.customer_user_id<>v_receipt.customer_id
    OR v_voucher.invoice_id<>v_invoice.id
    OR v_voucher.status<>'redeemed'
    OR v_voucher.redeemed_order_id<>new.order_id
    OR EXISTS(SELECT 1 FROM public.clube_partner_coupon_returns_v1_847 r
      WHERE r.order_id=new.order_id)
 THEN RAISE EXCEPTION 'PARTNER_COUPON_RETURN_PROVENANCE_INVALID' USING ERRCODE='23514'; END IF;
 IF v_order.status='CANCELLED' AND v_order.financial_state<>'reversed'
    AND v_order.financial_reversed_at IS NULL THEN
    IF v_reason IS DISTINCT FROM v_order.risk_reason
       OR right(new.idempotency_key,length(':cashback-release'))<>':cashback-release'
    THEN RAISE EXCEPTION 'PARTNER_COUPON_CANCEL_REASON_INVALID' USING ERRCODE='23514'; END IF;
    v_kind:='order_cancelled';
 ELSIF v_order.financial_reversed_at IS NOT NULL AND
       v_reason='post_settlement_financial_reversal' AND
       EXISTS(SELECT 1 FROM public.order_financial_reversals r WHERE r.order_id=new.order_id)
 THEN v_kind:='post_settlement_financial_reversal';
 ELSE RAISE EXCEPTION 'PARTNER_COUPON_RETURN_NOT_CANCELLED_OR_REVERSED'
  USING ERRCODE='40001';END IF;
 -- Freeze the returned amount back into the private, paid-voucher right.
 -- cashback_release was inserted by the existing cancellation/reversal RPC;
 -- the same transaction's matching -face reserve neutralizes fungibility.
 INSERT INTO public.wallet_entries(
  user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
 ) VALUES(
  v_receipt.customer_id,new.order_id,'cashback','cashback_reserve',
  -v_receipt.face_cents,
  'partner-coupon:return-hold:'||new.order_id::text,
  jsonb_build_object('source','partner_coupon_cancel_quarantine',
   'voucherId',v_receipt.voucher_id::text,
   'releaseWalletEntryId',new.id::text,'cause',v_kind)
 ) RETURNING id INTO v_hold;
 IF v_kind='order_cancelled' AND v_voucher.expires_at>clock_timestamp()
    AND v_invoice.status='paid'
    AND NOT EXISTS(SELECT 1 FROM public.clube_coupon_refund_requests_v1_814 r
      WHERE r.invoice_id=v_invoice.id AND r.status<>'closed')
 THEN v_disposition:='reissued';
 ELSE v_disposition:='manual_review';END IF;
 UPDATE public.clube_coupon_paid_issuances
 SET status=CASE WHEN v_disposition='reissued' THEN 'issued' ELSE 'review_required' END,
     redeemed_order_id=CASE WHEN v_disposition='reissued' THEN NULL ELSE redeemed_order_id END,
     reserved_quote_id=NULL,reserved_at=NULL
 WHERE id=v_voucher.id AND status='redeemed' AND redeemed_order_id=new.order_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'PARTNER_COUPON_RETURN_VOUCHER_RACE' USING ERRCODE='40001';END IF;
 INSERT INTO public.clube_partner_coupon_returns_v1_847(
  order_id,voucher_id,invoice_id,customer_id,wallet_release_entry_id,
  wallet_hold_entry_id,amount_cents,disposition,cause
 ) VALUES(new.order_id,v_receipt.voucher_id,v_receipt.invoice_id,
  v_receipt.customer_id,new.id,v_hold,v_receipt.face_cents,v_disposition,v_kind);
 RETURN NULL;
END;
$return$;
REVOKE ALL ON FUNCTION public.clube_partner_coupon_release_to_voucher_v1_847()
 FROM PUBLIC,anon,authenticated;
CREATE CONSTRAINT TRIGGER clube_partner_coupon_release_to_voucher_v1_847
 AFTER INSERT ON public.wallet_entries
 DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW
 WHEN (NEW.bucket='cashback' AND NEW.entry_type='cashback_release' AND NEW.order_id IS NOT NULL)
 EXECUTE FUNCTION public.clube_partner_coupon_release_to_voucher_v1_847();

CREATE FUNCTION public.clube_partner_coupon_application_provenance_v1_847()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $app$
DECLARE v_mode text; v_wallet public.wallet_entries%rowtype;
 v_prior integer;v_returns integer;
BEGIN
 SELECT funding_mode_v1_846 INTO v_mode
 FROM public.clube_coupon_paid_invoices WHERE id=new.invoice_id;
 IF v_mode IS NULL THEN RAISE EXCEPTION 'COUPON_APPLICATION_INVOICE_MISSING' USING ERRCODE='23503'; END IF;
 IF v_mode='partner_funded' THEN
   IF new.seed_wallet_entry_id_v1_847 IS NULL
   THEN RAISE EXCEPTION 'PARTNER_COUPON_SEED_RECEIPT_MISSING' USING ERRCODE='23514';END IF;
   SELECT * INTO v_wallet FROM public.wallet_entries WHERE id=new.seed_wallet_entry_id_v1_847;
   IF NOT FOUND OR v_wallet.user_id<>new.customer_user_id
      OR v_wallet.amount_cents<>new.face_cents
      OR v_wallet.entry_type<>'cashback_seed'
      OR v_wallet.metadata->>'voucherId' IS DISTINCT FROM new.voucher_id::text
      OR v_wallet.metadata->>'invoiceId' IS DISTINCT FROM new.invoice_id::text
   THEN RAISE EXCEPTION 'PARTNER_COUPON_SEED_RECEIPT_INVALID' USING ERRCODE='23514';END IF;
   SELECT count(*) INTO v_prior FROM public.clube_coupon_paid_order_applications
    WHERE voucher_id=new.voucher_id;
   SELECT count(*) INTO v_returns FROM public.clube_partner_coupon_returns_v1_847
    WHERE voucher_id=new.voucher_id AND disposition='reissued';
   IF v_prior<>v_returns THEN RAISE EXCEPTION 'PARTNER_COUPON_REDEMPTION_LINEAGE_INVALID'
    USING ERRCODE='23514'; END IF;
 ELSE
   IF new.seed_wallet_entry_id_v1_847 IS NOT NULL
      OR EXISTS(SELECT 1 FROM public.clube_coupon_paid_order_applications
                WHERE voucher_id=new.voucher_id)
   THEN RAISE EXCEPTION 'LEGACY_COUPON_SINGLE_REDEMPTION_REQUIRED'
     USING ERRCODE='23514';END IF;
 END IF;
 RETURN new;
END;$app$;
REVOKE ALL ON FUNCTION public.clube_partner_coupon_application_provenance_v1_847()
 FROM PUBLIC,anon,authenticated;
CREATE TRIGGER a_clube_partner_coupon_application_provenance_v1_847
 BEFORE INSERT ON public.clube_coupon_paid_order_applications
 FOR EACH ROW EXECUTE FUNCTION public.clube_partner_coupon_application_provenance_v1_847();


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
    or v_invoice.net_proceeds_verified_at is null
    or v_invoice.net_proceeds_reference is null
    or v_invoice.net_proceeds_cents is null
    or (v_invoice.net_proceeds_cents::bigint<
       v_invoice.coupon_face_cents::bigint*v_invoice.coupons_per_pack::bigint
       and not public.clube_coupon_sponsor_covered_v1_807(v_invoice.id,
         v_invoice.coupon_face_cents::bigint*v_invoice.coupons_per_pack::bigint))
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
  v_quote.merchant_id,v_face,v_invoice.net_proceeds_reference,
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

create or replace function public.clube_coupon_paid_order_reconciliation(
 p_order_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog
as $$
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
   v_invoice.net_proceeds_verified_at is null or
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
$$;


-- No client/anon/normal authenticated role may mutate private wallet or
-- accounting facts. Legacy coupon RPC is still internal service-role only.
REVOKE ALL ON FUNCTION public.clube_coupon_paid_create_order(
 uuid,uuid,uuid,text,text,text,text,integer,text,text,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clube_coupon_paid_create_order(
 uuid,uuid,uuid,text,text,text,text,integer,text,text,text,text)
 TO service_role;
REVOKE ALL ON FUNCTION public.clube_coupon_paid_order_reconciliation(uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clube_coupon_paid_order_reconciliation(uuid)
 TO service_role;

