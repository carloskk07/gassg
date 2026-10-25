import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

// Runs AFTER isolated-supabase-positive-checkout.mjs in the SAME disposable
// Supabase. This calls REAL coupon and order RPCs against the full migration
// chain, unlike the standalone PG17's simplified order-v8 fixture.
// Every "Mercado Pago" ID below is fictional local fixture data: this
// verifies accounting invariants, NOT bank receipt/provider signatures.
assert.equal(process.env.CI,'true','local ephemeral CI only');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const sql=command=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres',
 '--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1',
 '--tuples-only','--no-align','--quiet','--command='+command
],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},
 timeout:60000,stdio:['ignore','pipe','pipe']}).trim();
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const user=sql("SELECT id FROM auth.users WHERE email LIKE 'tamao-buyer-%@example.com' ORDER BY created_at DESC LIMIT 1;");
const admin=sql("SELECT user_id FROM public.platform_admins WHERE active=true AND admin_role='superadmin' AND user_id IN (SELECT id FROM auth.users WHERE email LIKE 'tamao-admin-%@example.com') LIMIT 1;");
const merchant='00000000-0000-4000-8000-000000000026';
assert.match(user,/^[0-9a-f-]{36}$/i);
assert.match(admin,/^[0-9a-f-]{36}$/i);
assert.equal(sql("SELECT status || ':' || online::text FROM public.merchants WHERE id="+q(merchant)+"::uuid"),'active:true');
assert.equal(sql("SELECT operation_mode FROM public.platform_launch_control WHERE singleton=true"),'LIVE',
 'only the isolated local fixture is allowed to enable commerce');
assert.equal(sql("SELECT count(*) FROM public.clube_coupon_paid_invoices"),'0');
const packageKey='ci_full_'+randomUUID().replaceAll('-','').slice(0,16);
const providerOrder='CI-LOCAL-ORDER-'+randomUUID();
const providerPayment='CI-LOCAL-PAYMENT-'+randomUUID();
const netReference='CI-LOCAL-NET-NOT-A-BANK-RECEIPT-'+randomUUID();
sql("INSERT INTO public.clube_coupon_paid_packages("+
 "package_key,title,sale_price_cents,coupon_face_cents,coupons_per_pack,"+
 "valid_days,funding_verified,legal_terms_verified,redeem_settlement_verified,sale_enabled)"+
 " VALUES("+q(packageKey)+",'Isolated CI coupon',1200,500,2,60,true,true,true,false);");
assert.equal(sql("SELECT sale_enabled FROM public.clube_coupon_paid_packages WHERE package_key="+q(packageKey)),'f',
 'the test must not open the public sale switch');
const invoice=sql("INSERT INTO public.clube_coupon_paid_invoices("+
 "customer_user_id,package_key,request_id,sale_price_cents,coupon_face_cents,"+
 "coupons_per_pack,valid_days,provider_order_id,status) VALUES ("+
 q(user)+"::uuid,"+q(packageKey)+",gen_random_uuid(),1200,500,2,60,"+
 q(providerOrder)+",'awaiting_payment') RETURNING id;");
assert.match(invoice,/^[0-9a-f-]{36}$/i);
const createQuote="SELECT public.create_quote_snapshot_v3("+
 q(user)+"::uuid,"+q(merchant)+"::uuid,'97300000','10',400,25,45,"+
 "clock_timestamp()+interval '5 minutes',"+
 "'[{\"product_code\":\"CHARCOAL2\",\"quantity\":1,\"unit_price_cents\":1800}]'::jsonb,"+
 "repeat('e',64))::text;";
const quote=JSON.parse(sql(createQuote));
assert.equal(quote.grossTotalCents,2200);
sql("UPDATE public.quotes SET payment_method_requested='cash',payment_timing_requested='on_delivery' WHERE id="+q(quote.quoteId)+"::uuid;");
const key='ci-coupon-checkout-'+randomUUID();
const hash='b'.repeat(64);
const checkout=(voucher)=>"SELECT public.clube_coupon_paid_create_order("+
 q(user)+"::uuid,"+q(quote.quoteId)+"::uuid,"+q(voucher)+"::uuid,"+
 "'cash',"+q(key)+","+q(hash)+",null,null,'11999999999')::text;";
const expectDenied=(statement,code)=>{
 let err=null;try{sql(statement)}catch(e){err=e}
 assert.ok(err,'expected refusal '+code);
 assert.match(String(err.stderr||err.message||''),new RegExp(code));
};
const beforeWallet=Number(sql("SELECT count(*) FROM public.wallet_entries"));
const beforeOrders=Number(sql("SELECT count(*) FROM public.orders"));
expectDenied(checkout(randomUUID()),'COUPON_NOT_FOUND');
assert.equal(sql("SELECT consumed_at IS NULL FROM public.quotes WHERE id="+q(quote.quoteId)+"::uuid"),'t');
const gross=JSON.parse(sql("SELECT public.clube_coupon_paid_payment_verify("+
 q(invoice)+"::uuid,"+q(providerOrder)+","+q(providerPayment)+",1200)::text;"));
assert.equal(gross.issued,2);
const grossReplay=JSON.parse(sql("SELECT public.clube_coupon_paid_payment_verify("+
 q(invoice)+"::uuid,"+q(providerOrder)+","+q(providerPayment)+",1200)::text;"));
assert.equal(grossReplay.replayed,true);
const vouchers=JSON.parse(sql("SELECT json_agg(json_build_object('id',id,'ordinal',ordinal) ORDER BY ordinal)::text "+
 "FROM public.clube_coupon_paid_issuances WHERE invoice_id="+q(invoice)+"::uuid;"));
assert.equal(vouchers.length,2);
expectDenied(checkout(vouchers[0].id),'COUPON_PAID_NET_FUNDS_REQUIRED');
assert.equal(Number(sql("SELECT count(*) FROM public.orders")),beforeOrders);
assert.equal(Number(sql("SELECT count(*) FROM public.wallet_entries")),beforeWallet);
assert.equal(sql("SELECT consumed_at IS NULL FROM public.quotes WHERE id="+q(quote.quoteId)+"::uuid"),'t');
const proof=JSON.parse(sql("SELECT public.clube_coupon_paid_net_proceeds_verify_audited("+
 q(invoice)+"::uuid,"+q(providerOrder)+",1100,"+q(netReference)+","+q(admin)+"::uuid)::text;"));
assert.equal(proof.ok,true);
assert.equal(proof.auditRecorded,true);
assert.equal(proof.replayed,false);
assert.equal(sql("SELECT count(*) FROM public.platform_admin_audit WHERE id="+q(proof.auditId)+"::uuid AND actor_user_id="+q(admin)+"::uuid"),'1');
const order=JSON.parse(sql(checkout(vouchers[0].id)));
assert.equal(order.couponAppliedCents,500);
assert.equal(order.couponReplayed,false);
assert.match(order.orderId,/^[0-9a-f-]{36}$/i);
assert.equal(Number(sql("SELECT count(*) FROM public.orders")),beforeOrders+1);
assert.equal(sql("SELECT status FROM public.clube_coupon_paid_issuances WHERE id="+q(vouchers[0].id)+"::uuid"),'redeemed');
const amounts=JSON.parse(sql("SELECT json_build_object('gross',gross_total_cents,'cashback',cashback_reserved_cents,"+
 "'total',total_cents)::text FROM public.orders WHERE id="+q(order.orderId)+"::uuid;"));
assert.equal(amounts.gross,2200);
assert.ok(amounts.cashback>=500);
assert.equal(amounts.total,amounts.gross-amounts.cashback,
 'real create_order_from_quote_v8 money must balance exactly');
assert.equal(sql("SELECT count(*) FROM public.clube_coupon_paid_order_applications WHERE order_id="+
 q(order.orderId)+"::uuid AND voucher_id="+q(vouchers[0].id)+"::uuid AND invoice_id="+
 q(invoice)+"::uuid AND face_cents=500 AND net_proceeds_reference="+q(netReference)),'1');
const seed='clube-paid-coupon:'+vouchers[0].id;
assert.equal(sql("SELECT count(*) FROM public.wallet_entries WHERE idempotency_key="+q(seed)+
 " AND user_id="+q(user)+"::uuid AND amount_cents=500"),'1');
const replay=JSON.parse(sql(checkout(vouchers[0].id)));
assert.equal(replay.couponReplayed,true);
assert.equal(replay.orderId,order.orderId);
assert.equal(Number(sql("SELECT count(*) FROM public.orders")),beforeOrders+1);
assert.equal(sql("SELECT count(*) FROM public.wallet_entries WHERE idempotency_key="+q(seed)),'1');
const beforeRefund=JSON.parse(sql("SELECT public.clube_coupon_paid_order_reconciliation("+
 q(order.orderId)+"::uuid)::text;"));
assert.equal(beforeRefund.status,'ORDER_IN_PROGRESS');
assert.equal(beforeRefund.merchantExternalSettlementVerified,false);
// Coupon-created orders must reach the REAL merchant settlement/accounting
// authority, not merely pass an isolated mock checkout. Re-authenticate the
// existing LOCAL fixture's buyer and merchant owner through localhost GoTrue:
// their original random passwords aren't shared across CI Node processes.
// No hosted Supabase URL, provider token or secret is accepted or logged.
const localRaw=execFileSync('supabase',['status','-o','env'],{
 encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']
});
const local=Object.fromEntries(localRaw.split('\n').map(line=>{
 const match=line.match(/^([A-Z_]+)=(.*)$/);
 return match?[match[1],match[2].replace(/^["']|["']$/g,'')]:null;
}).filter(Boolean));
const api=local.API_URL||local.SUPABASE_URL||'';
const publishable=local.ANON_KEY||local.SUPABASE_ANON_KEY||'';
const service=local.SERVICE_ROLE_KEY||local.SUPABASE_SERVICE_ROLE_KEY||'';
assert.match(api,/^http:\/\/(?:127\.0\.0\.1|localhost):54321\/?$/);
assert.ok(publishable.length>25&&service.length>25);
const owner=sql("SELECT user_id FROM public.merchant_members WHERE merchant_id="+
 q(merchant)+"::uuid AND member_role='owner' AND active=true LIMIT 1;");
assert.match(owner,/^[0-9a-f-]{36}$/i);
async function localActorSession(userId){
 const password='LocalCouponCI!'+randomUUID();
 const updated=await fetch(api+'/auth/v1/admin/users/'+userId,{
  method:'PUT',
  headers:{apikey:service,Authorization:'Bearer '+service,
   'Content-Type':'application/json'},
  body:JSON.stringify({password}),
  signal:AbortSignal.timeout(30000)
 });
 assert.equal(updated.status,200,'disposable GoTrue test password update');
 const login=await fetch(api+'/auth/v1/token?grant_type=password',{
  method:'POST',headers:{apikey:publishable,'Content-Type':'application/json'},
  body:JSON.stringify({
   email:sql("SELECT email FROM auth.users WHERE id="+q(userId)+"::uuid;"),
   password
  }),signal:AbortSignal.timeout(30000)
 });
 assert.equal(login.status,200,'disposable GoTrue real login');
 const data=await login.json();
 assert.equal(data.user.id,userId);
 return data.access_token;
}
const buyerToken=await localActorSession(user);
const ownerToken=await localActorSession(owner);
async function callEdge(slug,token,body,key){
 const response=await fetch(api+'/functions/v1/'+slug,{
  method:'POST',
  headers:{apikey:publishable,Authorization:'Bearer '+token,
   Origin:'http://localhost:5173','Content-Type':'application/json',
   ...(key?{'Idempotency-Key':key}:{})},
  body:JSON.stringify(body),signal:AbortSignal.timeout(45000)
 });
 return {status:response.status,body:await response.json()};
}
const orderRef=order.orderId;
const created=await callEdge('get-order',buyerToken,{orderId:orderRef});
assert.equal(created.status,200,'buyer must read coupon-backed order');
assert.equal(created.body.status,'OFFERED_TO_MERCHANT');
const accepted=await callEdge('merchant-action',ownerToken,
 {orderId:orderRef,action:'accept',expectedVersion:created.body.version},
 'ci-coupon-accept-'+randomUUID());
assert.equal(accepted.status,200,'coupon order accepted by actual merchant API');
assert.equal(accepted.body.status,'PREPARING');
const dispatched=await callEdge('merchant-action',ownerToken,
 {orderId:orderRef,action:'dispatch',expectedVersion:accepted.body.version},
 'ci-coupon-dispatch-'+randomUUID());
assert.equal(dispatched.status,200,'coupon order dispatched by actual merchant API');
assert.equal(dispatched.body.status,'OUT_FOR_DELIVERY');
const buyerDispatch=await callEdge('get-order',buyerToken,{orderId:orderRef});
assert.equal(buyerDispatch.status,200);
assert.match(buyerDispatch.body.deliveryPin,/^[0-9]{4}$/);
const arriving=await callEdge('merchant-action',ownerToken,
 {orderId:orderRef,action:'arriving',expectedVersion:buyerDispatch.body.version},
 'ci-coupon-arriving-'+randomUUID());
assert.equal(arriving.status,200,'coupon order arrival must be operational');
assert.equal(arriving.body.status,'ARRIVING');
const completedBody={orderId:orderRef,pin:buyerDispatch.body.deliveryPin,
 expectedVersion:arriving.body.version,paymentConfirmed:true};
const completeKey='ci-coupon-complete-'+randomUUID();
const settled=await callEdge('complete-delivery',ownerToken,completedBody,completeKey);
assert.equal(settled.status,200,
 'coupon order settlement: '+JSON.stringify(settled.body).slice(0,420));
assert.equal(settled.body.status,'SETTLED');
assert.equal(settled.body.paymentConfirmationMethod,'merchant_attestation',
 'buyer-paid residual cash is ONLY locally attested, not a bank confirmation');
const settlementAgain=await callEdge('complete-delivery',ownerToken,
 completedBody,completeKey);
assert.equal(settlementAgain.status,200);
assert.deepEqual(settlementAgain.body,settled.body,
 'idempotent delivery may never create another merchant debt');
assert.equal(sql("SELECT count(*) FROM public.merchant_cashback_reimbursements "+
 "WHERE order_id="+q(orderRef)+"::uuid AND merchant_id="+q(merchant)+
 "::uuid AND cashback_cents="+amounts.cashback+" AND status='open'"),'1',
 'real settlement must create exactly one merchant reimbursement obligation');
const due=JSON.parse(sql("SELECT public.clube_coupon_paid_order_reconciliation("+
 q(orderRef)+"::uuid)::text;"));
assert.equal(due.status,'MERCHANT_REIMBURSEMENT_DUE');
assert.equal(due.merchantReimbursementCents,amounts.cashback);
assert.equal(due.merchantExternalSettlementVerified,false);
const finance=JSON.parse(sql("SELECT public.admin_financial_action("+
 q(admin)+"::uuid,'cashback_reimbursement',"+q(orderRef)+
 "::uuid,'paid','CI-INTERNAL-ACCOUNTING-NOT-BANK-PROOF')::text;"));
assert.equal(finance.ok,true);
assert.equal(finance.item.status,'paid');
const unverified=JSON.parse(sql("SELECT public.clube_coupon_paid_order_reconciliation("+
 q(orderRef)+"::uuid)::text;"));
assert.equal(unverified.status,'MERCHANT_PAYOUT_UNVERIFIED',
 'internal paid status must not be reported as external cash transfer');
assert.equal(unverified.merchantExternalSettlementVerified,false);
assert.equal(sql("SELECT count(*) FROM public.platform_admin_audit WHERE "+
 "target_id="+q(orderRef)+" AND action='financial_paid' AND "+
 "target_type='cashback_reimbursement'"),'1');
expectDenied("SELECT public.admin_financial_action("+
 q(admin)+"::uuid,'cashback_reimbursement',"+q(orderRef)+
 "::uuid,'paid','CI-REPLAY-CANNOT-PAY-AGAIN')::text;",'FINANCIAL_ITEM_NOT_OPEN');
assert.equal(sql("SELECT count(*) FROM public.merchant_cashback_reimbursements WHERE "+
 "order_id="+q(orderRef)+"::uuid"),'1');
assert.equal(sql("SELECT count(*) FROM public.platform_referral_payout_proofs_v1_264"),'0',
 'merchant administrative bookkeeping cannot mint third-party bank payout proof');
console.log('PASS: real coupon order accepted, delivered with PIN and internally settled; merchant reimbursement due -> internal paid -> payout UNVERIFIED; no bank claim.');
const refund=JSON.parse(sql("SELECT public.clube_coupon_paid_payment_refund("+
 q(invoice)+"::uuid,"+q(providerOrder)+")::text;"));
assert.equal(refund.reviewRequired,true);
const refundReplay=JSON.parse(sql("SELECT public.clube_coupon_paid_payment_refund("+
 q(invoice)+"::uuid,"+q(providerOrder)+")::text;"));
assert.equal(refundReplay.reviewRequired,true);
assert.equal(refundReplay.refunded,false);
assert.equal(sql("SELECT status FROM public.clube_coupon_paid_invoices WHERE id="+q(invoice)+"::uuid"),'review_required');
assert.equal(sql("SELECT status FROM public.clube_coupon_paid_issuances WHERE id="+q(vouchers[1].id)+"::uuid"),'review_required');
assert.equal(sql("SELECT status FROM public.clube_coupon_paid_issuances WHERE id="+q(vouchers[0].id)+"::uuid"),'redeemed');
const reconciliation=JSON.parse(sql("SELECT public.clube_coupon_paid_order_reconciliation("+
 q(order.orderId)+"::uuid)::text;"));
assert.equal(reconciliation.status,'FINANCIAL_REVIEW');
assert.equal(reconciliation.merchantExternalSettlementVerified,false);
assert.equal(sql("SELECT count(*) FROM public.platform_referral_payout_proofs_v1_264"),'0');
assert.equal(sql("SELECT count(*) FROM public.merchant_billing_payment_events"),'0');
assert.equal(sql("SELECT count(*) FROM public.merchant_sale_payment_attempts"),'0');
console.log('PASS: full real schema: gross Pix event -> audited net -> real v8 coupon checkout/cashback -> order replay -> chargeback review; fake local money only.');
