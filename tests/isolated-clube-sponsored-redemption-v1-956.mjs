import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

// Technical proof only. A disposable local Postgres transaction exercises
// sponsor-financed vouchers without fabricating Mercado Pago NET receipts.
// Any synthetic order/Pix is ROLLED BACK; no hosted project credentials.
assert.equal(process.env.CI,'true');
for(const key of ['SUPABASE_ACCESS_TOKEN','SUPABASE_DB_PASSWORD',
  'SUPABASE_SERVICE_ROLE_KEY','MERCADOPAGO_ACCESS_TOKEN'])
 assert.equal(process.env[key]||'','');
const sql=command=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres',
 '--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1',
 '--tuples-only','--no-align','--quiet','--command='+command
],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},
  timeout:120000,stdio:['ignore','pipe','pipe']}).trim();
assert.equal(sql('select current_database()'),'postgres');
const snapshot=()=>sql(`SELECT
 (SELECT count(*) FROM public.clube_coupon_paid_invoices)::text||':'||
 (SELECT count(*) FROM public.clube_coupon_paid_issuances)::text||':'||
 (SELECT count(*) FROM public.clube_coupon_paid_order_applications)::text||':'||
 (SELECT count(*) FROM public.orders)::text||':'||
 (SELECT count(*) FROM public.wallet_entries)::text||':'||
 (SELECT encumbered_cents FROM public.platform_clube_sponsor_pool_v1_807
   WHERE benefit_key='clube_coupons')::text`);
const before=snapshot();
const exercise=`BEGIN;
DO $v956$
DECLARE
 v_buyer uuid;v_merchant uuid:='00000000-0000-4000-8000-000000000026';
 v_invoice uuid;v_voucher uuid;v_order uuid;v_low uuid;v_high uuid;
 v_response jsonb;v_replay jsonb;v_key text:='ci-v956-single-redemption';
 v_fraud boolean;v_failed text;v_order_count integer;
BEGIN
 SELECT u.id INTO v_buyer FROM auth.users u
 WHERE u.email LIKE 'tamao-outsider-%@example.com'
 AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.customer_id=u.id)
 LIMIT 1;
 IF v_buyer IS NULL THEN RAISE EXCEPTION 'V956_ISOLATED_BUYER_NOT_FOUND'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.merchants
   WHERE id=v_merchant AND status='active' AND online)
 THEN RAISE EXCEPTION 'V956_LOCAL_MERCHANT_FIXTURE_MISSING'; END IF;
 IF (SELECT commerce_enabled FROM public.platform_launch_control WHERE singleton)=false
 THEN RAISE EXCEPTION 'V956_LOCAL_COMMERCE_FIXTURE_MISSING'; END IF;

 -- Only local synthetic funds: reset already-consumed fixture guarantee.
 UPDATE public.platform_clube_sponsor_pool_v1_807
 SET authorized_cents=1000000,
     owner_guaranteed_cents=1000000-reconciled_cents,
     version=version+1
 WHERE benefit_key='clube_coupons';
 UPDATE public.clube_coupon_paid_packages
 SET funding_verified=true,legal_terms_verified=true,
     redeem_settlement_verified=true,sale_enabled=true
 WHERE package_key='all_products_3x5_sponsor';

 INSERT INTO public.clube_coupon_paid_invoices(
    customer_user_id,package_key,request_id,sale_price_cents,
    coupon_face_cents,coupons_per_pack,valid_days)
 VALUES(v_buyer,'all_products_3x5_sponsor',gen_random_uuid(),890,500,3,180)
 RETURNING id INTO v_invoice;
 IF (SELECT sponsor_covered_cents FROM public.clube_coupon_paid_invoices
     WHERE id=v_invoice)<>1500
 THEN RAISE EXCEPTION 'V956_UNFUNDED_INVOICE'; END IF;

 UPDATE public.clube_coupon_paid_invoices
 SET provider_order_id='CI-V956-ORDER',
     provider_payment_id='CI-V956-PAYMENT',status='awaiting_payment'
 WHERE id=v_invoice;
 v_response:=public.clube_coupon_paid_payment_verify(
   v_invoice,'CI-V956-ORDER','CI-V956-PAYMENT',890);
 IF (v_response->>'issued')::integer<>3
 THEN RAISE EXCEPTION 'V956_BAD_CREDIT'; END IF;
 v_replay:=public.clube_coupon_paid_payment_verify(
   v_invoice,'CI-V956-ORDER','CI-V956-PAYMENT',890);
 IF v_replay->>'replayed'<>'true'
 THEN RAISE EXCEPTION 'V956_DUPLICATE_PAYMENT_CREDIT'; END IF;
 IF public.clube_coupon_owner_sponsor_spendable_v1_942(v_invoice) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'V956_OWNER_SPONSOR_NOT_SPENDABLE'; END IF;
 IF EXISTS(SELECT 1 FROM public.clube_coupon_paid_invoices
   WHERE id=v_invoice AND
   (net_proceeds_verified_at IS NOT NULL OR net_proceeds_cents IS NOT NULL))
 THEN RAISE EXCEPTION 'V956_FAKE_NET_SETTLEMENT'; END IF;

 SELECT id INTO v_voucher FROM public.clube_coupon_paid_issuances
 WHERE invoice_id=v_invoice AND ordinal=1;
 IF v_voucher IS NULL THEN RAISE EXCEPTION 'V956_VOUCHER_MISSING'; END IF;
 v_response:=public.create_quote_snapshot_v3(v_buyer,v_merchant,
   '97300000','10',400,25,45,clock_timestamp()+interval '5 minutes',
   '[{"product_code":"CHARCOAL2","quantity":1,"unit_price_cents":1800}]'::jsonb,
   repeat('a',64));
 v_low:=(v_response->>'quoteId')::uuid;
 v_fraud:=false;
 BEGIN
   PERFORM public.clube_coupon_paid_quote_reserve(v_buyer,v_voucher,v_low);
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS v_failed=MESSAGE_TEXT;
   v_fraud:=v_failed='COUPON_MINIMUM_ORDER_NOT_MET';
 END;
 IF NOT v_fraud THEN RAISE EXCEPTION 'V956_BELOW_MINIMUM_REDEEMED'; END IF;
 IF (SELECT status FROM public.clube_coupon_paid_issuances
   WHERE id=v_voucher)<>'issued'
 THEN RAISE EXCEPTION 'V956_FAILED_QUOTE_CONSUMED_VOUCHER'; END IF;

 -- Only an eligible basket gets a reservation and one atomic order.
 v_response:=public.create_quote_snapshot_v3(v_buyer,v_merchant,
   '97300000','10',400,25,45,clock_timestamp()+interval '5 minutes',
   '[{"product_code":"CHARCOAL2","quantity":3,"unit_price_cents":1800}]'::jsonb,
   repeat('b',64));
 v_high:=(v_response->>'quoteId')::uuid;
 IF (v_response->>'grossTotalCents')::integer<5000
 THEN RAISE EXCEPTION 'V956_CART_NOT_ELIGIBLE'; END IF;
 v_response:=public.clube_coupon_paid_quote_reserve(v_buyer,v_voucher,v_high);
 IF v_response->>'reserved'<>'true'
 THEN RAISE EXCEPTION 'V956_NOT_RESERVED'; END IF;
 UPDATE public.quotes SET payment_method_requested='cash',
   payment_timing_requested='on_delivery' WHERE id=v_high;
 SELECT count(*) INTO v_order_count FROM public.orders;
 v_response:=public.clube_coupon_paid_create_order(v_buyer,v_high,v_voucher,
   'cash',v_key,repeat('c',64),null,null,'11999999999');
 v_order:=(v_response->>'orderId')::uuid;
 IF v_order IS NULL OR (v_response->>'couponAppliedCents')::integer<>500
 THEN RAISE EXCEPTION 'V956_COUPON_NOT_APPLIED'; END IF;
 IF (SELECT status FROM public.clube_coupon_paid_issuances
     WHERE id=v_voucher)<>'redeemed'
 THEN RAISE EXCEPTION 'V956_COUPON_NOT_REDEEMED'; END IF;
 IF NOT EXISTS(
   SELECT 1 FROM public.clube_coupon_paid_order_applications
   WHERE order_id=v_order AND voucher_id=v_voucher
     AND invoice_id=v_invoice AND face_cents=500
     AND net_proceeds_reference LIKE 'owner-sponsor:%')
 THEN RAISE EXCEPTION 'V956_SPONSOR_LEDGER_MISSING'; END IF;
 -- The original voucher seed is deliberately order_id=NULL; the real
 -- order creates its own cashback_reserve. Both must exist ONCE and agree.
 IF (SELECT count(*) FROM public.wallet_entries
   WHERE order_id IS NULL AND user_id=v_buyer
     AND idempotency_key='clube-paid-coupon:'||v_voucher::text
     AND entry_type='cashback_seed' AND bucket='cashback'
     AND amount_cents=500
     AND metadata->>'voucherId'=v_voucher::text
     AND metadata->>'invoiceId'=v_invoice::text)<>1
 THEN RAISE EXCEPTION 'V956_VOUCHER_SEED_INCORRECT'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.wallet_entries
   WHERE order_id=v_order AND user_id=v_buyer
     AND entry_type='cashback_reserve' AND bucket='cashback'
     AND amount_cents<=-500)
 THEN RAISE EXCEPTION 'V956_ORDER_RESERVE_NOT_BACKED'; END IF;

 v_replay:=public.clube_coupon_paid_create_order(v_buyer,v_high,v_voucher,
   'cash',v_key,repeat('c',64),null,null,'11999999999');
 IF v_replay->>'couponReplayed'<>'true'
   OR (v_replay->>'orderId')::uuid<>v_order
   OR (SELECT count(*) FROM public.orders)<>v_order_count+1
 THEN RAISE EXCEPTION 'V956_DUPLICATE_ORDER_OR_BENEFIT'; END IF;
 IF (SELECT count(*) FROM public.clube_coupon_paid_order_applications
      WHERE order_id=v_order)<>1
 THEN RAISE EXCEPTION 'V956_DUPLICATE_APPLICATION'; END IF;
 IF EXISTS(SELECT 1 FROM public.clube_coupon_paid_invoices
    WHERE id=v_invoice AND net_proceeds_verified_at IS NOT NULL)
 THEN RAISE EXCEPTION 'V956_FAKE_MP_NET_REPORT'; END IF;
END;
$v956$;
ROLLBACK;`;
sql(exercise);
assert.equal(snapshot(),before,
 'Complete synthetic Clube redemption must leave zero traces in disposable DB');
console.log('V1.956 PASS — original owner-funded 3xR$5 pattern without MP NET report; rejected low basket, qualified product, single order, single wallet benefit, idempotent replay and ROLLBACK.');
