-- Isolated PostgreSQL 17 checkout test. The v8 below is the TEST STUB
-- from coupon-atomic-checkout-fixture-postgres-17.sql, never production v8.
DO $coupon_atomic_checkout_test$
declare
 v_user uuid;
 v_other uuid;
 v_merchant uuid:=gen_random_uuid();
 v_invoice uuid;
 v_quote uuid;
 v_small_quote uuid;
 v_voucher uuid;
 v_second uuid;
 v_result jsonb;
 v_order uuid;
 v_count integer;
 v_cash integer;
 v_total integer;
 v_status text;
begin
 select id into v_user from auth.users order by id limit 1;
 select id into v_other from auth.users where id<>v_user order by id limit 1;
 if v_user is null or v_other is null then
  raise exception 'COUPON_CHECKOUT_FIXTURE_NEEDS_TWO_USERS';end if;
 insert into public.merchants(id) values(v_merchant);
 insert into public.clube_coupon_paid_packages(
  package_key,title,sale_price_cents,coupon_face_cents,coupons_per_pack,
  valid_days,funding_verified,legal_terms_verified,redeem_settlement_verified)
 values('checkout_funded','Checkout funding audit',1200,500,2,60,true,true,true);
 insert into public.clube_coupon_paid_invoices(
  customer_user_id,package_key,request_id,sale_price_cents,coupon_face_cents,
  coupons_per_pack,valid_days,provider_order_id,status)
 values(v_user,'checkout_funded',gen_random_uuid(),1200,500,2,60,
  'checkout-provider-order','awaiting_payment')
 returning id into v_invoice;
 perform public.clube_coupon_paid_payment_verify(
  v_invoice,'checkout-provider-order','checkout-provider-payment',1200);
 select id into v_voucher from public.clube_coupon_paid_issuances
  where invoice_id=v_invoice and ordinal=1;
 select id into v_second from public.clube_coupon_paid_issuances
  where invoice_id=v_invoice and ordinal=2;
 insert into public.quotes(customer_id,gross_total_cents,merchant_id,expires_at)
 values(v_user,1500,v_merchant,clock_timestamp()+interval '15 minutes')
 returning id into v_quote;
 insert into public.quotes(customer_id,gross_total_cents,merchant_id,expires_at)
 values(v_user,400,v_merchant,clock_timestamp()+interval '15 minutes')
 returning id into v_small_quote;

 -- Paid but unverified NET funds may NEVER create cashback or an order.
 begin
  perform public.clube_coupon_paid_create_order(
   v_user,v_quote,v_voucher,'pix','coupon-checkout-1','sha-1',
   null,null,'51999999999');
  raise exception 'GROSS_PAYMENT_IMPROPERLY_SPENDABLE';
 exception when insufficient_privilege then null;
 end;
 select count(*) into v_count from public.wallet_entries;
 if v_count<>0 then raise exception 'NET_FUNDS_CHECK_MINTED_CASHBACK';end if;

 begin
  perform public.clube_coupon_paid_net_proceeds_verify(
   v_invoice,'checkout-provider-order',990,'mp-net-validated-0001');
  raise exception 'NET_PAYMENT_UNDERFUNDED_ACCEPTED';
 exception when insufficient_privilege then null;
 end;
 perform public.clube_coupon_paid_net_proceeds_verify(
   v_invoice,'checkout-provider-order',1100,'mp-net-validated-0001');
 begin
  perform public.clube_coupon_paid_net_proceeds_verify(
   v_invoice,'checkout-provider-order',1100,'different-reconciliation-evidence');
  raise exception 'SETTLEMENT_PROOF_MUTATED';
 exception when unique_violation then null;
 end;

 begin
  perform public.clube_coupon_paid_create_order(
   v_other,v_quote,v_voucher,'pix','coupon-other-1','sha-other',
   null,null,'51999999999');
  raise exception 'OTHER_ACCOUNT_REDEEMED_VOUCHER';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.clube_coupon_paid_create_order(
   v_user,v_small_quote,v_second,'pix','coupon-small-1','sha-small',
   null,null,'51999999999');
  raise exception 'COUPON_BIGGER_THAN_QUOTE';
 exception when serialization_failure then null;
 end;
 select count(*) into v_count from public.wallet_entries;
 if v_count<>0 then raise exception 'FAILED_CHECKOUT_MINTED_MONEY';end if;

 -- Existing normal cashback and a prepaid voucher must both be spent by v8.
 insert into public.wallet_entries(user_id,bucket,entry_type,amount_cents,idempotency_key)
 values(v_user,'cashback','cashback_seed',200,'existing-legitimate-cashback');
 v_result:=public.clube_coupon_paid_create_order(
  v_user,v_quote,v_voucher,'pix','coupon-checkout-1','sha-1',
  null,null,'51999999999');
 v_order:=(v_result->>'orderId')::uuid;
 if (v_result->>'couponAppliedCents')::integer<>500
    or (v_result->>'couponReplayed')::boolean is distinct from false
 then raise exception 'COUPON_DISCOUNT_NOT_APPLIED_ONCE';end if;
 select cashback_reserved_cents,total_cents into v_cash,v_total
 from public.orders where id=v_order;
 if v_cash<>700 or v_total<>800 then
  raise exception 'ORDER_TOTAL_RECONCILIATION_FAILED';
 end if;
 select count(*) into v_count from public.wallet_entries
 where entry_type='cashback_seed' and amount_cents=500
 and idempotency_key='clube-paid-coupon:'||v_voucher::text;
 if v_count<>1 then raise exception 'PREPAID_WALLET_PROVENANCE_MISSING';end if;
 select count(*) into v_count from public.clube_coupon_paid_order_applications
 where voucher_id=v_voucher and quote_id=v_quote and order_id=v_order
 and original_order_cashback_cents=700 and original_order_total_cents=800
 and face_cents=500 and net_proceeds_reference='mp-net-validated-0001'
 and customer_user_id=v_user and quoted_merchant_id=v_merchant;
 if v_count<>1 then raise exception 'COUPON_MERCHANT_FUNDING_LINK_MISSING';end if;
 select status into v_status from public.clube_coupon_paid_issuances
 where id=v_voucher;
 if v_status<>'redeemed' then raise exception 'COUPON_NOT_REDEEMED';end if;
 v_result:=public.clube_coupon_paid_order_reconciliation(v_order);
 if v_result->>'status'<>'ORDER_IN_PROGRESS'
 then raise exception 'COUPON_ORDER_RECONCILIATION_NOT_PENDING';end if;
 update public.orders set merchant_id=v_merchant,status='SETTLED' where id=v_order;
 v_result:=public.clube_coupon_paid_order_reconciliation(v_order);
 if v_result->>'status'<>'MERCHANT_REIMBURSEMENT_MISSING'
 then raise exception 'COUPON_MISSING_MERCHANT_REIMBURSEMENT_NOT_DETECTED';end if;
 insert into public.merchant_cashback_reimbursements(
  order_id,merchant_id,cashback_cents,status)
 values(v_order,v_merchant,700,'open');
 v_result:=public.clube_coupon_paid_order_reconciliation(v_order);
 if v_result->>'status'<>'MERCHANT_REIMBURSEMENT_DUE'
 then raise exception 'COUPON_MERCHANT_REIMBURSEMENT_DUE_NOT_VISIBLE';end if;
 update public.merchant_cashback_reimbursements set status='paid'
 where order_id=v_order;
 v_result:=public.clube_coupon_paid_order_reconciliation(v_order);
 if v_result->>'status'<>'MERCHANT_PAYOUT_UNVERIFIED'
   or (v_result->>'merchantExternalSettlementVerified')::boolean is distinct from false
 then raise exception 'COUPON_INTERNAL_PAID_MISTAKEN_FOR_BANK_PROOF';end if;

 v_result:=public.clube_coupon_paid_create_order(
  v_user,v_quote,v_voucher,'pix','coupon-checkout-1','sha-1',
  null,null,'51999999999');
 if (v_result->>'couponReplayed')::boolean is distinct from true
    or (v_result->>'orderId')::uuid<>v_order
 then raise exception 'COUPON_ORDER_REPLAY_NOT_IDEMPOTENT';end if;
 select count(*) into v_count from public.wallet_entries
 where idempotency_key='clube-paid-coupon:'||v_voucher::text;
 if v_count<>1 then raise exception 'COUPON_CREDIT_DUPLICATED_ON_REPLAY';end if;
 begin
  perform public.clube_coupon_paid_create_order(
   v_user,v_quote,v_second,'pix','coupon-checkout-1','sha-1',
   null,null,'51999999999');
  raise exception 'CHANGED_VOUCHER_REPLAY_ACCEPTED';
 exception when unique_violation then null;
 end;
 begin
  perform public.clube_coupon_paid_create_order(
   v_user,v_quote,v_voucher,'pix','coupon-checkout-1','new-sha',
   null,null,'51999999999');
  raise exception 'CHANGED_PAYMENT_FINGERPRINT_ACCEPTED';
 exception when unique_violation then null;
 end;

 -- A chargeback after use cannot recreate money; invoice moves to review.
 v_result:=public.clube_coupon_paid_payment_refund(
  v_invoice,'checkout-provider-order');
 select status into v_status from public.clube_coupon_paid_invoices
 where id=v_invoice;
 if v_status<>'review_required' or
   (v_result->>'reviewRequired')::boolean is distinct from true
 then raise exception 'PAID_CREDIT_CHARGEBACK_NOT_FROZEN';end if;
 v_result:=public.clube_coupon_paid_order_reconciliation(v_order);
 if v_result->>'status'<>'FINANCIAL_REVIEW'
 then raise exception 'CHARGEBACK_NOT_IN_RECONCILIATION';end if;
 select count(*) into v_count from public.clube_coupon_paid_order_applications
 where voucher_id=v_voucher;
 if v_count<>1 then raise exception 'CHARGEBACK_ERASED_SETTLEMENT_AUDIT';end if;
end
$coupon_atomic_checkout_test$;
