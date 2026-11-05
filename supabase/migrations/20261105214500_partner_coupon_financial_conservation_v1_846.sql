-- #846 prospective, opt-in funded PAID coupons. SAFE: bank/commercial release remains forbidden by CHECK(enabled=false).

-- TAMÃO #846 — coupon funder is frozen at NEW invoice creation, never inferred at redemption.
-- Existing paid coupons and all historical reimbursements are UNTOUCHED.
ALTER TABLE public.clube_coupon_paid_invoices
 ADD COLUMN funding_mode_v1_846 text NOT NULL DEFAULT 'platform_reimbursed'
 CHECK(funding_mode_v1_846 IN ('platform_reimbursed','partner_funded')),
 ADD COLUMN funding_terms_version_v1_846 text
 CHECK(funding_terms_version_v1_846 IS NULL OR funding_terms_version_v1_846='clube_partner_coupon_terms_v1_846');
ALTER TABLE public.clube_coupon_paid_invoices
 ADD CONSTRAINT coupon_partner_terms_pair_v1_846 CHECK(
  (funding_mode_v1_846='platform_reimbursed' AND funding_terms_version_v1_846 IS NULL)
  OR (funding_mode_v1_846='partner_funded' AND funding_terms_version_v1_846='clube_partner_coupon_terms_v1_846')
 );
CREATE TABLE public.clube_partner_coupon_launch_v1_846(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false CHECK(enabled=false),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.clube_partner_coupon_launch_v1_846(singleton,enabled)
VALUES(true,false);
ALTER TABLE public.clube_partner_coupon_launch_v1_846 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clube_partner_coupon_launch_v1_846 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.clube_partner_coupon_launch_v1_846 TO service_role;
-- This release MUST NOT be enabled by configuration-only UPDATE: CHECK(enabled=false)
-- requires a later reviewed migration when sale/refund/supply verification is implemented.
CREATE FUNCTION public.clube_partner_coupon_invoice_guard_v1_846()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $guard$
DECLARE v_launched boolean; v_cutover timestamptz; v_pkg public.clube_coupon_paid_packages%rowtype;
BEGIN
 IF tg_op='UPDATE' THEN
   IF new.funding_mode_v1_846 IS DISTINCT FROM old.funding_mode_v1_846
      OR new.funding_terms_version_v1_846 IS DISTINCT FROM old.funding_terms_version_v1_846
   THEN RAISE EXCEPTION 'COUPON_FUNDING_SNAPSHOT_IMMUTABLE' USING ERRCODE='23514'; END IF;
   RETURN new;
 END IF;
 IF new.funding_mode_v1_846='platform_reimbursed' THEN RETURN new; END IF;
 SELECT enabled,created_at INTO v_launched,v_cutover
 FROM public.clube_partner_coupon_launch_v1_846 WHERE singleton FOR SHARE;
 IF v_launched IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'PARTNER_COUPON_SALE_NOT_RELEASED' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_pkg FROM public.clube_coupon_paid_packages WHERE package_key=new.package_key FOR SHARE;
 IF NOT FOUND OR new.package_key NOT LIKE 'partner\_%' ESCAPE '\'
    OR v_pkg.sponsored_by_owner OR NOT v_pkg.sale_enabled
    OR NOT v_pkg.funding_verified OR NOT v_pkg.legal_terms_verified
    OR NOT v_pkg.redeem_settlement_verified
    OR new.status<>'prepared' OR new.created_at<v_cutover
    OR new.terms_version IS DISTINCT FROM 'clube_partner_coupon_terms_v1_846'
    OR new.terms_accepted_at IS NULL
    OR new.funding_terms_version_v1_846 IS DISTINCT FROM new.terms_version
    OR new.coupon_face_cents>500 OR new.coupon_face_cents<100
    OR new.min_order_cents<1000 OR new.sponsor_covered_cents<>0
 THEN RAISE EXCEPTION 'PARTNER_COUPON_INVOICE_NOT_ELIGIBLE' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(
    SELECT 1 FROM public.merchant_coupon_consents_v1_845 c
    JOIN public.merchants m ON m.id=c.merchant_id
    WHERE c.opted_in AND c.terms_version=1 AND m.status='active')
 THEN RAISE EXCEPTION 'PARTNER_COUPON_NO_ACTIVE_MERCHANT' USING ERRCODE='42501'; END IF;
 RETURN new;
END;$guard$;
REVOKE ALL ON FUNCTION public.clube_partner_coupon_invoice_guard_v1_846()
 FROM PUBLIC,anon,authenticated;
CREATE TRIGGER a_clube_partner_invoice_insert_v1_846
 BEFORE INSERT ON public.clube_coupon_paid_invoices
 FOR EACH ROW EXECUTE FUNCTION public.clube_partner_coupon_invoice_guard_v1_846();
CREATE TRIGGER a_clube_partner_invoice_immutable_v1_846
 BEFORE UPDATE OF funding_mode_v1_846,funding_terms_version_v1_846
 ON public.clube_coupon_paid_invoices
 FOR EACH ROW EXECUTE FUNCTION public.clube_partner_coupon_invoice_guard_v1_846();

CREATE TABLE public.clube_partner_coupon_order_uses_v1_846(
 order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE RESTRICT,
 voucher_id uuid NOT NULL UNIQUE REFERENCES public.clube_coupon_paid_issuances(id) ON DELETE RESTRICT,
 invoice_id uuid NOT NULL REFERENCES public.clube_coupon_paid_invoices(id) ON DELETE RESTRICT,
 merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
 customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 merchant_contract_version integer NOT NULL CHECK(merchant_contract_version>=1),
 buyer_terms_version text NOT NULL CHECK(buyer_terms_version='clube_partner_coupon_terms_v1_846'),
 face_cents integer NOT NULL CHECK(face_cents BETWEEN 100 AND 500),
 gross_cents integer NOT NULL CHECK(gross_cents>=1000),
 net_cents integer NOT NULL CHECK(net_cents=gross_cents-face_cents),
 fee_bps_snapshot integer NOT NULL CHECK(fee_bps_snapshot BETWEEN 1 AND 1000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX clube_partner_coupon_order_merchant_v1_846
 ON public.clube_partner_coupon_order_uses_v1_846(merchant_id,created_at DESC);
CREATE INDEX clube_partner_coupon_order_invoice_v1_846
 ON public.clube_partner_coupon_order_uses_v1_846(invoice_id);
ALTER TABLE public.clube_partner_coupon_order_uses_v1_846 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clube_partner_coupon_order_uses_v1_846 FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.clube_partner_coupon_order_immutable_v1_846()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$BEGIN RAISE EXCEPTION 'PARTNER_COUPON_RECEIPT_IMMUTABLE' USING ERRCODE='42501'; END;$$;
REVOKE ALL ON FUNCTION public.clube_partner_coupon_order_immutable_v1_846() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER clube_partner_coupon_order_immutable_v1_846_trg
 BEFORE UPDATE OR DELETE ON public.clube_partner_coupon_order_uses_v1_846
 FOR EACH ROW EXECUTE FUNCTION public.clube_partner_coupon_order_immutable_v1_846();

-- An atomic coupon application, not a checkbox, freezes the merchant-paid discount.
-- The old checkout still handles verified Pix, idempotency, wallet and cancellation.
CREATE FUNCTION public.clube_partner_coupon_application_v1_846()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $app$
DECLARE
 v_invoice public.clube_coupon_paid_invoices%rowtype;
 v_order public.orders%rowtype;
 v_coupon public.clube_coupon_paid_issuances%rowtype;
 v_consent public.merchant_coupon_consents_v1_845%rowtype;
 v_quote public.quotes%rowtype;
 v_bps integer; v_fee integer; v_release integer;
BEGIN
 SELECT * INTO v_invoice FROM public.clube_coupon_paid_invoices
 WHERE id=new.invoice_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_INVOICE_MISSING' USING ERRCODE='23503'; END IF;
 IF v_invoice.funding_mode_v1_846='platform_reimbursed' THEN RETURN new; END IF;
 SELECT * INTO v_order FROM public.orders WHERE id=new.order_id FOR UPDATE;
 SELECT * INTO v_coupon FROM public.clube_coupon_paid_issuances WHERE id=new.voucher_id FOR SHARE;
 SELECT * INTO v_quote FROM public.quotes WHERE id=new.quote_id FOR SHARE;
 SELECT * INTO v_consent FROM public.merchant_coupon_consents_v1_845
 WHERE merchant_id=new.quoted_merchant_id AND opted_in AND terms_version=1 FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PARTNER_COUPON_MERCHANT_NOT_PARTICIPATING'
    USING ERRCODE='42501'; END IF;
 IF v_invoice.funding_mode_v1_846<>'partner_funded'
    OR v_invoice.funding_terms_version_v1_846<>'clube_partner_coupon_terms_v1_846'
    OR v_invoice.terms_version<>v_invoice.funding_terms_version_v1_846
    OR v_invoice.terms_accepted_at IS NULL
    OR v_invoice.status<>'paid' OR v_invoice.paid_at IS NULL
    OR v_invoice.net_proceeds_verified_at IS NULL
    OR v_invoice.provider_payment_id IS NULL
    OR v_invoice.provider_order_id IS NULL
    OR v_invoice.net_proceeds_reference IS NULL
    OR v_order.id IS NULL OR v_order.status<>'OFFERED_TO_MERCHANT'
    OR v_order.financial_state<>'pending'
    OR v_order.customer_id<>new.customer_user_id
    OR v_order.merchant_id IS DISTINCT FROM new.quoted_merchant_id
    OR v_quote.customer_id<>new.customer_user_id
    OR v_quote.merchant_id<>new.quoted_merchant_id
    OR v_quote.gross_total_cents<>v_order.gross_total_cents
    OR v_coupon.invoice_id<>v_invoice.id
    OR v_coupon.redeemed_order_id<>v_order.id
    OR v_invoice.customer_user_id<>new.customer_user_id
    OR v_invoice.coupon_face_cents<>new.face_cents
    OR new.face_cents>500 OR new.face_cents<100
    OR v_order.gross_total_cents<GREATEST(1000,v_invoice.min_order_cents)
    OR v_order.gross_total_cents<new.face_cents
    OR v_order.cashback_reserved_cents<>new.face_cents
    OR v_order.total_cents<>v_order.gross_total_cents-new.face_cents
    OR EXISTS(SELECT 1 FROM public.merchant_welcome_order_uses_v1_843
              WHERE order_id=v_order.id)
 THEN RAISE EXCEPTION 'PARTNER_COUPON_APPLICATION_PROVENANCE_INVALID'
    USING ERRCODE='23514'; END IF;
 v_bps:=v_order.platform_fee_bps_snapshot;
 IF v_order.billing_plan_key_snapshot='flex_daily' AND v_bps=900 THEN v_bps:=800; END IF;
 v_fee:=floor(((v_order.gross_total_cents-new.face_cents)::numeric*v_bps)/10000)::integer;
 v_release:=greatest(v_order.prepaid_fee_reserved_cents_snapshot-v_fee,0);
 IF v_release>0 THEN
   PERFORM pg_catalog.pg_advisory_xact_lock(
     pg_catalog.hashtextextended('merchant-fee-credit:'||v_order.merchant_id::text,0));
   UPDATE public.merchant_billing_accounts
   SET credit_reserved_cents=credit_reserved_cents-v_release,updated_at=clock_timestamp()
   WHERE merchant_id=v_order.merchant_id AND credit_reserved_cents>=v_release;
   IF NOT FOUND THEN RAISE EXCEPTION 'PARTNER_COUPON_PREPAID_CREDIT_DRIFT'
     USING ERRCODE='40001'; END IF;
 END IF;
 UPDATE public.orders SET
   platform_fee_bps_snapshot=v_bps,
   prepaid_fee_reserved_cents_snapshot=prepaid_fee_reserved_cents_snapshot-v_release,
   prepaid_fee_credit_source_plan_key_snapshot=
      case when prepaid_fee_reserved_cents_snapshot-v_release=0 then NULL
       else prepaid_fee_credit_source_plan_key_snapshot end
 WHERE id=v_order.id AND status='OFFERED_TO_MERCHANT'
   AND cashback_reserved_cents=new.face_cents;
 IF NOT FOUND THEN RAISE EXCEPTION 'PARTNER_COUPON_FEE_SNAPSHOT_NOT_APPLIED'
   USING ERRCODE='40001'; END IF;
 INSERT INTO public.clube_partner_coupon_order_uses_v1_846(
   order_id,voucher_id,invoice_id,merchant_id,customer_id,merchant_contract_version,
   buyer_terms_version,face_cents,gross_cents,net_cents,fee_bps_snapshot
 ) VALUES(v_order.id,new.voucher_id,v_invoice.id,v_order.merchant_id,
   v_order.customer_id,v_consent.version,v_invoice.terms_version,
   new.face_cents,v_order.gross_total_cents,v_order.gross_total_cents-new.face_cents,v_bps);
 RETURN new;
END;$app$;
REVOKE ALL ON FUNCTION public.clube_partner_coupon_application_v1_846()
 FROM PUBLIC,anon,authenticated;
CREATE TRIGGER zzz_clube_partner_coupon_application_v1_846
 AFTER INSERT ON public.clube_coupon_paid_order_applications
 FOR EACH ROW EXECUTE FUNCTION public.clube_partner_coupon_application_v1_846();

CREATE FUNCTION public.clube_partner_coupon_no_transfer_v1_846()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$BEGIN
 IF EXISTS(SELECT 1 FROM public.clube_partner_coupon_order_uses_v1_846 a WHERE a.order_id=old.id)
 AND (new.merchant_id IS DISTINCT FROM old.merchant_id
      OR new.proposed_merchant_id IS DISTINCT FROM old.proposed_merchant_id
      OR new.gross_total_cents IS DISTINCT FROM old.gross_total_cents
      OR new.cashback_reserved_cents IS DISTINCT FROM old.cashback_reserved_cents
      OR new.total_cents IS DISTINCT FROM old.total_cents
      OR new.platform_fee_bps_snapshot IS DISTINCT FROM old.platform_fee_bps_snapshot
      OR (new.status='REQUOTE_REQUIRED' AND old.status<>'REQUOTE_REQUIRED'))
 THEN RAISE EXCEPTION 'PARTNER_COUPON_ORDER_SNAPSHOT_IMMUTABLE'
   USING ERRCODE='23514'; END IF;
 RETURN new;
END;$$;
REVOKE ALL ON FUNCTION public.clube_partner_coupon_no_transfer_v1_846()
 FROM PUBLIC,anon,authenticated;
CREATE TRIGGER zzz_clube_partner_coupon_no_transfer_v1_846
 BEFORE UPDATE OF merchant_id,proposed_merchant_id,gross_total_cents,cashback_reserved_cents,total_cents,platform_fee_bps_snapshot,status
 ON public.orders FOR EACH ROW EXECUTE FUNCTION public.clube_partner_coupon_no_transfer_v1_846();


-- Canonical accounting, rewards and quote checkout now understand the immutable NEW program snapshot.

CREATE OR REPLACE FUNCTION public.validate_platform_receivable_fact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_order public.orders%rowtype;
  v_expected_fee integer;
  v_expected_due timestamptz;
  v_partner public.merchant_welcome_order_uses_v1_843%rowtype;
  v_coupon public.clube_partner_coupon_order_uses_v1_846%rowtype;
  v_fee_basis integer;
  v_expected_basis integer:=null;
begin
  if tg_op='UPDATE' and (
    new.order_id is distinct from old.order_id
    or new.merchant_id is distinct from old.merchant_id
    or new.gross_total_cents is distinct from old.gross_total_cents
    or new.platform_fee_bps is distinct from old.platform_fee_bps
    or new.platform_fee_cents is distinct from old.platform_fee_cents
    or new.due_at is distinct from old.due_at
    or new.prepaid_credit_applied_cents is distinct from old.prepaid_credit_applied_cents
    or new.benefit_fee_basis_cents_v1_843 is distinct from old.benefit_fee_basis_cents_v1_843
  ) then
    raise exception 'FINANCIAL_FACT_IMMUTABLE' using errcode='23514';
  end if;

  if tg_op='INSERT' then
    select * into v_order
    from public.orders
    where id=new.order_id
    for share;

    if not found then
      raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
    end if;

    if v_order.status<>'SETTLED'
       or v_order.financial_state<>'settled'
       or v_order.financial_reversed_at is not null
       or v_order.merchant_id is null
       or v_order.settled_at is null
       or v_order.payment_confirmed_at is null
       or v_order.delivered_at is null then
      raise exception 'ORDER_NOT_ELIGIBLE_FOR_ACCOUNTING' using errcode='40001';
    end if;

    -- A venda paga pela revenda aceita R$1 fora da receita da plataforma.
    -- Em pedidos antigos, a base permanece o valor bruto original.
    v_fee_basis:=v_order.gross_total_cents;
    select * into v_partner
    from public.merchant_welcome_order_uses_v1_843 a
    where a.order_id=v_order.id;
    if found then
      if v_partner.merchant_id<>v_order.merchant_id
        or v_partner.customer_id<>v_order.customer_id
        or v_partner.gross_cents<>v_order.gross_total_cents
        or v_partner.net_cents<>v_order.total_cents
        or v_partner.amount_cents<>100
        or v_order.cashback_reserved_cents<>100
        or v_partner.fee_bps_snapshot<>v_order.platform_fee_bps_snapshot
      then raise exception 'PARTNER_WELCOME_RECEIVABLE_BASIS_CONFLICT' using errcode='23514';end if;
      v_fee_basis:=v_partner.net_cents;
      v_expected_basis:=v_partner.net_cents;
    end if;
    select * into v_coupon from public.clube_partner_coupon_order_uses_v1_846
    where order_id=v_order.id;
    if found then
      if v_partner.order_id is not null
        or v_coupon.merchant_id<>v_order.merchant_id
        or v_coupon.customer_id<>v_order.customer_id
        or v_coupon.gross_cents<>v_order.gross_total_cents
        or v_coupon.net_cents<>v_order.total_cents
        or v_order.cashback_reserved_cents<>v_coupon.face_cents
        or v_coupon.fee_bps_snapshot<>v_order.platform_fee_bps_snapshot
        or not exists(select 1 from public.clube_coupon_paid_order_applications a
           where a.order_id=v_order.id and a.voucher_id=v_coupon.voucher_id
              and a.invoice_id=v_coupon.invoice_id and a.face_cents=v_coupon.face_cents)
      then raise exception 'PARTNER_COUPON_RECEIVABLE_BASIS_CONFLICT'
        using errcode='23514';end if;
      v_fee_basis:=v_coupon.net_cents;
      v_expected_basis:=v_coupon.net_cents;
    end if;
    v_expected_fee:=floor(
      (v_fee_basis::numeric*v_order.platform_fee_bps_snapshot)/10000
    )::integer;
    v_expected_due:=public.merchant_settlement_daily_due_at(v_order.settled_at);

    if new.merchant_id<>v_order.merchant_id
       or new.gross_total_cents<>v_order.gross_total_cents
       or new.platform_fee_bps<>v_order.platform_fee_bps_snapshot
       or new.platform_fee_cents<>v_expected_fee
       or new.prepaid_credit_applied_cents<>v_order.prepaid_fee_credit_applied_cents
       or new.benefit_fee_basis_cents_v1_843 is distinct from v_expected_basis
       or new.due_at<>v_expected_due then
      raise exception 'PLATFORM_RECEIVABLE_MISMATCH' using errcode='23514';
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.grant_order_rewards(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_order public.orders%rowtype;
  v_referral public.referrals%rowtype;
  v_existing public.order_reward_grants%rowtype;
  v_platform_fee integer:=0;
  v_variable_reserve integer:=0;
  v_minimum_contribution integer:=0;
  v_reward_budget integer:=0;
  v_cashback_target integer:=0;
  v_referral_target integer:=0;
  v_cashback integer:=0;
  v_referral_amount integer:=0;
  v_platform_contribution integer:=0;
  v_referrer uuid:=null;
  v_available_at timestamptz:=null;
  v_fee_basis integer:=0;
  v_partner public.merchant_welcome_order_uses_v1_843%rowtype;
  v_coupon public.clube_partner_coupon_order_uses_v1_846%rowtype;
begin
  select *
  into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  if v_order.status<>'SETTLED'
     or v_order.financial_state<>'settled'
     or v_order.financial_reversed_at is not null
     or v_order.payment_confirmed_at is null
     or v_order.delivered_at is null
     or v_order.merchant_id is null then
    raise exception 'ORDER_NOT_ELIGIBLE_FOR_REWARDS' using errcode='40001';
  end if;

  select *
  into v_existing
  from public.order_reward_grants
  where order_id=v_order.id;

  if found then
    return jsonb_build_object(
      'orderId',v_existing.order_id,
      'platformFeeCents',v_existing.platform_fee_cents,
      'rewardBudgetCents',v_existing.reward_budget_cents,
      'cashbackCents',v_existing.cashback_cents,
      'referralPendingCents',v_existing.referral_pending_cents,
      'platformContributionCents',v_existing.platform_contribution_cents,
      'commissionAvailableAt',v_existing.commission_available_at,
      'alreadyGranted',true
    );
  end if;

  v_fee_basis:=v_order.gross_total_cents;
  select * into v_partner
  from public.merchant_welcome_order_uses_v1_843 a
  where a.order_id=v_order.id;
  if found then
    if v_partner.merchant_id<>v_order.merchant_id
      or v_partner.customer_id<>v_order.customer_id
      or v_partner.gross_cents<>v_order.gross_total_cents
      or v_partner.net_cents<>v_order.total_cents
      or v_partner.amount_cents<>100
      or v_order.cashback_reserved_cents<>100
      or v_partner.fee_bps_snapshot<>v_order.platform_fee_bps_snapshot
      or not exists(select 1 from public.platform_receivables p
        where p.order_id=v_order.id and p.merchant_id=v_order.merchant_id
          and p.benefit_fee_basis_cents_v1_843=v_partner.net_cents
          and p.platform_fee_bps=v_partner.fee_bps_snapshot)
    then raise exception 'PARTNER_WELCOME_REWARD_NOT_BACKED' using errcode='23514';end if;
    v_fee_basis:=v_partner.net_cents;
  end if;
  select * into v_coupon from public.clube_partner_coupon_order_uses_v1_846
  where order_id=v_order.id;
  if found then
    if v_partner.order_id is not null
      or v_coupon.merchant_id<>v_order.merchant_id
      or v_coupon.customer_id<>v_order.customer_id
      or v_coupon.gross_cents<>v_order.gross_total_cents
      or v_coupon.net_cents<>v_order.total_cents
      or v_order.cashback_reserved_cents<>v_coupon.face_cents
      or v_coupon.fee_bps_snapshot<>v_order.platform_fee_bps_snapshot
      or not exists(select 1 from public.platform_receivables p
         where p.order_id=v_order.id and p.merchant_id=v_order.merchant_id
           and p.benefit_fee_basis_cents_v1_843=v_coupon.net_cents
           and p.platform_fee_bps=v_coupon.fee_bps_snapshot)
    then raise exception 'PARTNER_COUPON_REWARD_NOT_BACKED' using errcode='23514';end if;
    v_fee_basis:=v_coupon.net_cents;
  end if;
  v_platform_fee:=floor(
    (v_fee_basis::numeric*v_order.platform_fee_bps_snapshot)/10000
  )::integer;

  v_variable_reserve:=least(
    v_platform_fee,
    ceil((v_fee_basis::numeric*v_order.variable_cost_bps_snapshot)/10000)::integer
  );

  v_minimum_contribution:=least(
    greatest(0,v_platform_fee-v_variable_reserve),
    ceil((v_fee_basis::numeric*v_order.minimum_contribution_bps_snapshot)/10000)::integer
  );

  v_reward_budget:=greatest(
    0,
    v_platform_fee-v_variable_reserve-v_minimum_contribution
  );

  v_cashback_target:=floor(
    (v_fee_basis::numeric*v_order.cashback_bps_snapshot)/10000
  )::integer;

  v_referral_target:=floor(
    (v_fee_basis::numeric*v_order.referral_bps_snapshot)/10000
  )::integer;

  v_cashback:=least(v_cashback_target,v_reward_budget);

  select *
  into v_referral
  from public.referrals
  where referred_user_id=v_order.customer_id
  for update;

  if found
     and (v_referral.qualified_order_id is null or v_referral.qualified_order_id=v_order.id)
     and v_referral.referrer_user_id<>v_order.customer_id then
    v_referrer:=v_referral.referrer_user_id;
    v_referral_amount:=least(
      v_referral_target,
      greatest(0,v_reward_budget-v_cashback)
    );

    if v_referral.qualified_order_id is null then
      update public.referrals
      set qualified_order_id=v_order.id
      where referred_user_id=v_order.customer_id
        and qualified_order_id is null;
    end if;

    if v_referral_amount>0 then
      v_available_at:=coalesce(v_order.settled_at,v_order.payment_confirmed_at,v_order.delivered_at,clock_timestamp())
        + make_interval(hours=>v_order.commission_hold_hours_snapshot);
    end if;
  end if;

  if v_referrer is not null and v_referral_amount>0 then
    perform pg_advisory_xact_lock(
      hashtextextended('referral-risk:'||v_referrer::text,0)
    );
  end if;

  v_platform_contribution:=
    v_platform_fee
    - v_variable_reserve
    - v_cashback
    - v_referral_amount;

  if v_platform_contribution<v_minimum_contribution then
    raise exception 'REWARD_BUDGET_INVARIANT_FAILED' using errcode='23514';
  end if;

  insert into public.order_reward_grants(
    order_id,customer_id,referrer_user_id,
    reward_budget_cents,cashback_cents,referral_pending_cents,
    commission_available_at,platform_fee_cents,variable_cost_reserve_cents,
    minimum_contribution_cents,platform_contribution_cents,created_at
  )
  values(
    v_order.id,v_order.customer_id,v_referrer,
    v_reward_budget,v_cashback,v_referral_amount,
    v_available_at,v_platform_fee,v_variable_reserve,
    v_minimum_contribution,v_platform_contribution,
    coalesce(v_order.settled_at,v_order.payment_confirmed_at,v_order.delivered_at,clock_timestamp())
  );

  if v_cashback>0 then
    insert into public.wallet_entries(
      user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
    )
    values(
      v_order.customer_id,v_order.id,'cashback','cashback_earn',v_cashback,
      'reward:'||replace(v_order.id::text,'-','')||':cashback',
      jsonb_build_object(
        'basis','platform_revenue',
        'platformFeeCents',v_platform_fee,
        'rewardBudgetCents',v_reward_budget
      )
    )
    on conflict(idempotency_key) do nothing;
  end if;

  if v_referral_amount>0 and v_referrer is not null then
    insert into public.wallet_entries(
      user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
    )
    values(
      v_referrer,v_order.id,'commission_pending','referral_pending',v_referral_amount,
      'reward:'||replace(v_order.id::text,'-','')||':referral-pending',
      jsonb_build_object(
        'referredUserId',v_order.customer_id,
        'holdUntil',v_available_at,
        'basis','platform_revenue',
        'platformFeeCents',v_platform_fee
      )
    )
    on conflict(idempotency_key) do nothing;
  end if;


  insert into public.order_events(
    order_id,actor_user_id,actor_type,event_type,title,detail,metadata
  )
  values(
    v_order.id,null,'system','REWARDS_GRANTED',
    'Benefícios e resultado unitário registrados',
    'Benefícios foram limitados pela receita e contribuição mínima da plataforma.',
    jsonb_build_object(
      'platformFeeCents',v_platform_fee,
      'variableCostReserveCents',v_variable_reserve,
      'rewardBudgetCents',v_reward_budget,
      'cashbackCents',v_cashback,
      'referralPendingCents',v_referral_amount,
      'platformContributionCents',v_platform_contribution,
      'commissionAvailableAt',v_available_at
    )
  );

  return jsonb_build_object(
    'orderId',v_order.id,
    'platformFeeCents',v_platform_fee,
    'rewardBudgetCents',v_reward_budget,
    'cashbackCents',v_cashback,
    'referralPendingCents',v_referral_amount,
    'platformContributionCents',v_platform_contribution,
    'commissionAvailableAt',v_available_at,
    'alreadyGranted',false
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_order_settlement_accounting(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_order public.orders%rowtype;
  v_platform_fee integer:=0;
  v_credit_applied integer:=0;
  v_due_at timestamptz;
  v_partner_discount integer:=0;
  v_coupon public.clube_partner_coupon_order_uses_v1_846%rowtype;
  v_reimbursable integer:=0;
  v_fee_basis integer:=0;
begin
  select *
  into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  if v_order.status<>'SETTLED'
     or v_order.financial_state<>'settled'
     or v_order.financial_reversed_at is not null
     or v_order.merchant_id is null
     or v_order.payment_confirmed_at is null
     or v_order.delivered_at is null
     or v_order.settled_at is null then
    raise exception 'ORDER_NOT_ELIGIBLE_FOR_ACCOUNTING' using errcode='40001';
  end if;

  v_credit_applied:=v_order.prepaid_fee_credit_applied_cents;

  select coalesce(sum(u.amount_cents),0)::integer
  into v_partner_discount
  from public.merchant_welcome_order_uses_v1_843 u
  where u.order_id=v_order.id and u.merchant_id=v_order.merchant_id
    and u.customer_id=v_order.customer_id;
  if v_partner_discount>0 and (
    v_partner_discount<>100 or v_order.cashback_reserved_cents<>100
    or v_order.total_cents<>v_order.gross_total_cents-v_partner_discount
    or not exists(select 1 from public.merchant_welcome_order_uses_v1_843 u
      where u.order_id=v_order.id and u.net_cents=v_order.total_cents
        and u.gross_cents=v_order.gross_total_cents
        and u.fee_bps_snapshot=v_order.platform_fee_bps_snapshot)
  ) then raise exception 'PARTNER_WELCOME_RECEIPT_MISMATCH' using errcode='23514';end if;
  select * into v_coupon from public.clube_partner_coupon_order_uses_v1_846
  where order_id=v_order.id;
  if found then
    if v_partner_discount<>0
       or v_coupon.merchant_id<>v_order.merchant_id
       or v_coupon.customer_id<>v_order.customer_id
       or v_coupon.gross_cents<>v_order.gross_total_cents
       or v_coupon.net_cents<>v_order.total_cents
       or v_order.cashback_reserved_cents<>v_coupon.face_cents
       or v_coupon.fee_bps_snapshot<>v_order.platform_fee_bps_snapshot
       or not exists(select 1 from public.clube_coupon_paid_order_applications a
          where a.order_id=v_order.id and a.voucher_id=v_coupon.voucher_id
             and a.invoice_id=v_coupon.invoice_id and a.face_cents=v_coupon.face_cents)
    then raise exception 'PARTNER_COUPON_SETTLEMENT_PROVENANCE_INVALID'
      using errcode='23514';end if;
    v_partner_discount:=v_coupon.face_cents;
  end if;
  v_reimbursable:=v_order.cashback_reserved_cents-v_partner_discount;
  if v_reimbursable<0 then
    raise exception 'PARTNER_WELCOME_REIMBURSEMENT_NEGATIVE' using errcode='23514';end if;
  v_fee_basis:=v_order.gross_total_cents-v_partner_discount;
  v_platform_fee:=floor(
    (v_fee_basis::numeric*v_order.platform_fee_bps_snapshot)/10000
  )::integer;

  if v_order.prepaid_fee_reserved_cents_snapshot>0
     and v_order.prepaid_fee_credit_consumed_at is null
     and v_order.prepaid_fee_credit_released_at is null then

    perform pg_advisory_xact_lock(
      hashtextextended('merchant-fee-credit:'||v_order.merchant_id::text,0)
    );

    update public.merchant_billing_accounts
    set plan_key=case
          when credit_balance_cents-v_order.prepaid_fee_reserved_cents_snapshot=0
           and greatest(credit_reserved_cents-v_order.prepaid_fee_reserved_cents_snapshot,0)=0
            then 'flex_daily'
          else plan_key
        end,
        credit_balance_cents=credit_balance_cents-v_order.prepaid_fee_reserved_cents_snapshot,
        credit_reserved_cents=greatest(
          credit_reserved_cents-v_order.prepaid_fee_reserved_cents_snapshot,
          0
        ),
        updated_at=clock_timestamp()
    where merchant_id=v_order.merchant_id
      and credit_balance_cents>=v_order.prepaid_fee_reserved_cents_snapshot
      and credit_reserved_cents>=v_order.prepaid_fee_reserved_cents_snapshot;

    if found then
      v_credit_applied:=least(
        v_order.prepaid_fee_reserved_cents_snapshot,
        v_platform_fee
      );

      update public.orders
      set prepaid_fee_credit_applied_cents=v_credit_applied,
          prepaid_fee_credit_consumed_at=clock_timestamp()
      where id=v_order.id;

      insert into public.merchant_fee_credit_ledger(
        merchant_id,order_id,entry_type,amount_cents,plan_key,reference
      )
      values(
        v_order.merchant_id,v_order.id,'fee_consumption',
        -v_credit_applied,v_order.prepaid_fee_credit_source_plan_key_snapshot,
        'order-settlement:'||v_order.public_code
      );
    else
      raise exception 'PREPAID_FEE_RESERVATION_INCONSISTENT' using errcode='40001';
    end if;
  end if;

  v_due_at:=public.merchant_settlement_daily_due_at(v_order.settled_at);

  insert into public.platform_receivables(
    order_id,merchant_id,gross_total_cents,
    platform_fee_bps,platform_fee_cents,status,due_at,
    prepaid_credit_applied_cents,benefit_fee_basis_cents_v1_843
  )
  values(
    v_order.id,v_order.merchant_id,v_order.gross_total_cents,
    v_order.platform_fee_bps_snapshot,v_platform_fee,
    'open',v_due_at,v_credit_applied,
    case when v_partner_discount>0 then v_fee_basis else null end
  )
  on conflict(order_id) do nothing;

  -- A replay must neither charge again nor return a fictional zero-credit payment.
  -- The receivable is keyed by order_id; verify the idempotent result matches
  -- the already approved and immutable order snapshot.
  if not exists(
    select 1 from public.platform_receivables pr
    where pr.order_id=v_order.id
      and pr.merchant_id=v_order.merchant_id
      and pr.gross_total_cents=v_order.gross_total_cents
      and pr.platform_fee_bps=v_order.platform_fee_bps_snapshot
      and pr.platform_fee_cents=v_platform_fee
      and pr.due_at=v_due_at
      and pr.prepaid_credit_applied_cents=v_credit_applied
      and pr.benefit_fee_basis_cents_v1_843 is not distinct from
          case when v_partner_discount>0 then v_fee_basis else null end
  ) then
    raise exception 'SETTLEMENT_RECEIVABLE_SNAPSHOT_CONFLICT'
      using errcode='23514';
  end if;

  if v_reimbursable>0 then
    insert into public.merchant_cashback_reimbursements(
      order_id,merchant_id,cashback_cents,status,due_at
    )
    values(
      v_order.id,v_order.merchant_id,v_reimbursable,
      'open',v_due_at
    )
    on conflict(order_id) do nothing;

    -- A replay must never accept a different reimbursement fact just
    -- because the order_id uniqueness constraint suppressed insertion.
    if not exists(
      select 1
      from public.merchant_cashback_reimbursements r
      where r.order_id=v_order.id
        and r.merchant_id=v_order.merchant_id
        and r.cashback_cents=v_reimbursable
        and r.due_at=v_due_at
    ) then
      raise exception 'SETTLEMENT_CASHBACK_REIMBURSEMENT_SNAPSHOT_CONFLICT'
        using errcode='23514';
    end if;
  elsif exists(
    select 1 from public.merchant_cashback_reimbursements r
    where r.order_id=v_order.id
  ) then
    -- Zero cashback orders must not have a reimbursable merchant debt.
    raise exception 'SETTLEMENT_CASHBACK_REIMBURSEMENT_SNAPSHOT_CONFLICT'
      using errcode='23514';
  end if;

  update public.settlement_accounting_failures
  set resolved_at=clock_timestamp(),
      next_retry_at=null,
      dead_lettered_at=null,
      updated_at=clock_timestamp()
  where order_id=v_order.id
    and resolved_at is null;

  return jsonb_build_object(
    'ok',true,
    'orderId',v_order.id,
    'billingPlanKey',v_order.billing_plan_key_snapshot,
    'platformFeeCents',v_platform_fee,
    'prepaidCreditAppliedCents',v_credit_applied,
    'prepaidCreditSourcePlanKey',v_order.prepaid_fee_credit_source_plan_key_snapshot,
    'postpaidDueCents',greatest(v_platform_fee-v_credit_applied,0),
    'cashbackReimbursementCents',v_reimbursable,
    'partnerFundedDiscountCents',v_partner_discount,
    'feeBasisCents',v_fee_basis,
    'dueAt',v_due_at
  );
end;
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
  original_order_total_cents)
 values(v_voucher.id,v_order.id,p_quote_id,v_invoice.id,p_user_id,
  v_quote.merchant_id,v_face,v_invoice.net_proceeds_reference,
  v_order.cashback_reserved_cents,v_order.total_cents);
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

REVOKE ALL ON FUNCTION public.grant_order_rewards(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.grant_order_rewards(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ensure_order_settlement_accounting(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_order_settlement_accounting(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.clube_coupon_paid_create_order(uuid,uuid,uuid,text,text,text,text,integer,text,text,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clube_coupon_paid_create_order(uuid,uuid,uuid,text,text,text,text,integer,text,text,text,text)
 TO service_role;
REVOKE ALL ON FUNCTION public.clube_coupon_paid_order_reconciliation(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clube_coupon_paid_order_reconciliation(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.validate_platform_receivable_fact() FROM PUBLIC,anon,authenticated;

