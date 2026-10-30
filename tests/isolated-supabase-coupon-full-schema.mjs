import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';

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

// Verify the actual authenticated merchant-orders endpoint (not a SQL-only
// or frontend-only mock). Coupon face is a subset of cashback_reserved_cents:
// it may not be presented as ordinary earned cashback or a bank reimbursement.
const merchantCouponView=await callEdge('merchant-orders',ownerToken,{merchantId:merchant});
assert.equal(merchantCouponView.status,200,
 'merchant-orders must disclose the authorized coupon: '+JSON.stringify(merchantCouponView.body).slice(0,350));
const visibleCouponOrder=(merchantCouponView.body.orders||[]).find(x=>x.orderId===orderRef);
assert.ok(visibleCouponOrder,'active coupon order must appear in authorized partner queue');
assert.equal(visibleCouponOrder.cashbackReservedCents,amounts.cashback);
assert.equal(visibleCouponOrder.couponAppliedCents,500);
assert.equal(visibleCouponOrder.totalCents,amounts.total);
assert.equal(visibleCouponOrder.grossTotalCents,amounts.gross);
assert.equal(visibleCouponOrder.customerUserId,undefined,
 'merchant must never receive coupon purchaser identifiers');
assert.equal(visibleCouponOrder.couponVoucherId,undefined,
 'merchant must never receive private coupon redemption identifiers');
const deniedCouponMerchant=await callEdge('merchant-orders',buyerToken,{merchantId:merchant});
assert.equal(deniedCouponMerchant.status,403,
 'unrelated buyer must not enumerate the partner-only coupon breakdown');

// Execute the real DOM disclosure function with the real merchant API object,
// not a copy of its accounting logic. It must split the paid coupon and any
// other cashback, without claiming the merchant has been reimbursed.
const merchantJs=fs.readFileSync(new URL('../js/merchant.js',import.meta.url),'utf8');
const disclosureStart=merchantJs.indexOf('function merchantOrderBenefitDisclosure(o,demo=false){');
const disclosureEnd=merchantJs.indexOf('\nfunction merchantLiveOrder(o){',disclosureStart);
assert.ok(disclosureStart>=0&&disclosureEnd>disclosureStart);
const benefitDisclosure=vm.runInNewContext(
 merchantJs.slice(disclosureStart,disclosureEnd)+';merchantOrderBenefitDisclosure',
 {BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
  esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}
);
const disclosureHtml=benefitDisclosure(visibleCouponOrder);
assert.ok(disclosureHtml.includes('Cupom pago Clube TAMÃO aplicado: <strong>') &&
 disclosureHtml.includes('5,00</strong>'),
 'rendered authenticated coupon benefit must show its separate R$ 5,00 face');
assert.match(disclosureHtml,/Cashback de outros saldos:/);
assert.match(disclosureHtml,/Compensação à revenda: não comprovada/);
assert.doesNotMatch(disclosureHtml,/Valores divergentes|Origem dos benefícios inconsistente/);
assert.doesNotMatch(disclosureHtml,/Cashback usado pelo cliente: −/);
const contradictoryHtml=benefitDisclosure({...visibleCouponOrder,
 couponAppliedCents:amounts.cashback+1});
assert.match(contradictoryHtml,/Origem dos benefícios inconsistente ou indisponível/);
assert.match(contradictoryHtml,/Cashback de outros saldos: <strong>não informado/);

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
// A reimbursement explicitly REVERSED while its parent order still says
// SETTLED is contradictory. Never misreport it as ORDER_IN_PROGRESS.
// Probe only in the disposable full-schema database and undo with ROLLBACK.
const reversedDebt=sql("BEGIN; UPDATE public.merchant_cashback_reimbursements "+
 "SET status='reversed',reversed_at=clock_timestamp() WHERE order_id="+
 q(orderRef)+"::uuid AND status='open'; "+
 "SELECT public.clube_coupon_paid_order_reconciliation("+
 q(orderRef)+"::uuid)->>'status'; ROLLBACK;");
assert.equal(reversedDebt,'REVERSAL_REVIEW',
 'a reversed merchant obligation must remain flagged for reconciliation');
const originalDebt=JSON.parse(sql("SELECT public.clube_coupon_paid_order_reconciliation("+
 q(orderRef)+"::uuid)::text;"));
assert.equal(originalDebt.status,'MERCHANT_REIMBURSEMENT_DUE',
 'rollback must leave real merchant debt OPEN');
assert.equal(sql("SELECT status FROM public.merchant_cashback_reimbursements WHERE "+
 "order_id="+q(orderRef)+"::uuid"),'open');
// This used to accept an internal "paid" entry without beneficiary proof.
 // A coupon-backed liability must now remain OPEN, even for superadmin/RPC.
expectDenied("SELECT public.admin_financial_action("+
 q(admin)+"::uuid,'cashback_reimbursement',"+q(orderRef)+
 "::uuid,'paid','CI-INTERNAL-ACCOUNTING-NOT-BANK-PROOF')::text;",
 'COUPON_REIMBURSEMENT_EXTERNAL_PROOF_REQUIRED');
const stillDue=JSON.parse(sql("SELECT public.clube_coupon_paid_order_reconciliation("+
 q(orderRef)+"::uuid)::text;"));
assert.equal(stillDue.status,'MERCHANT_REIMBURSEMENT_DUE',
 'manual reference must not discharge coupon merchant debt');
assert.equal(stillDue.merchantExternalSettlementVerified,false);
assert.equal(sql("SELECT status FROM public.merchant_cashback_reimbursements WHERE "+
 "order_id="+q(orderRef)+"::uuid"),'open');
// Direct database writes with privileged access must not bypass the RPC
// or silently declare the coupon-backed merchant paid / offset.
expectDenied("UPDATE public.merchant_cashback_reimbursements "+
 "SET status='paid',paid_at=clock_timestamp() WHERE order_id="+
 q(orderRef)+"::uuid;",'COUPON_REIMBURSEMENT_EXTERNAL_PROOF_REQUIRED');
expectDenied("UPDATE public.merchant_cashback_reimbursements "+
 "SET status='offset',offset_at=clock_timestamp() WHERE order_id="+
 q(orderRef)+"::uuid;",'COUPON_REIMBURSEMENT_EXTERNAL_PROOF_REQUIRED');
assert.equal(sql("SELECT status FROM public.merchant_cashback_reimbursements WHERE "+
 "order_id="+q(orderRef)+"::uuid"),'open',
 'direct table updates must preserve the outstanding merchant debt');
assert.equal(sql("SELECT count(*) FROM public.platform_admin_audit WHERE "+
 "target_id="+q(orderRef)+" AND action='financial_paid' AND "+
 "target_type='cashback_reimbursement'"),'0');
expectDenied("SELECT public.admin_financial_action("+
 q(admin)+"::uuid,'cashback_reimbursement',"+q(orderRef)+
 "::uuid,'paid','CI-REPLAY-CANNOT-PAY-AGAIN')::text;",
 'COUPON_REIMBURSEMENT_EXTERNAL_PROOF_REQUIRED');
assert.equal(sql("SELECT count(*) FROM public.merchant_cashback_reimbursements WHERE "+
 "order_id="+q(orderRef)+"::uuid"),'1');
assert.equal(sql("SELECT count(*) FROM public.platform_referral_payout_proofs_v1_264"),'0',
 'merchant administrative bookkeeping cannot mint third-party bank payout proof');
console.log('PASS: real coupon settlement creates merchant liability; manual paid/replay DENIED, due remains OPEN, no bank claim.');
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

// With an independently funded SECOND local invoice, verify the actual
// dispatched-order cancellation and cashback return on the same full schema.
// The first invoice/voucher review assertions above remain unchanged.
const cancelProviderOrder='CI-LOCAL-CANCEL-ORDER-'+randomUUID();
const cancelProviderPayment='CI-LOCAL-CANCEL-PAYMENT-'+randomUUID();
const cancelInvoice=sql("INSERT INTO public.clube_coupon_paid_invoices("+
 "customer_user_id,package_key,request_id,sale_price_cents,coupon_face_cents,"+
 "coupons_per_pack,valid_days,provider_order_id,status) VALUES ("+
 q(user)+"::uuid,"+q(packageKey)+",gen_random_uuid(),1200,500,2,60,"+
 q(cancelProviderOrder)+",'awaiting_payment') RETURNING id;");
assert.match(cancelInvoice,/^[0-9a-f-]{36}$/i);
const cancelledGross=JSON.parse(sql("SELECT public.clube_coupon_paid_payment_verify("+
 q(cancelInvoice)+"::uuid,"+q(cancelProviderOrder)+","+
 q(cancelProviderPayment)+",1200)::text;"));
assert.equal(cancelledGross.issued,2);
const cancelVoucher=sql("SELECT id FROM public.clube_coupon_paid_issuances WHERE invoice_id="+
 q(cancelInvoice)+"::uuid ORDER BY ordinal LIMIT 1;");
assert.match(cancelVoucher,/^[0-9a-f-]{36}$/i);
const cancelNet=JSON.parse(sql("SELECT public.clube_coupon_paid_net_proceeds_verify_audited("+
 q(cancelInvoice)+"::uuid,"+q(cancelProviderOrder)+",1100,"+
 q('CI-LOCAL-CANCEL-NET-'+randomUUID())+","+q(admin)+"::uuid)::text;"));
assert.equal(cancelNet.ok,true);
const cancelQuote=JSON.parse(sql(createQuote.replace("repeat('e',64)","repeat('f',64)")));
assert.equal(cancelQuote.grossTotalCents,2200);
sql("UPDATE public.quotes SET payment_method_requested='cash',payment_timing_requested='on_delivery' WHERE id="+q(cancelQuote.quoteId)+"::uuid;");
const cancelKey='ci-coupon-cancel-'+randomUUID();
const cancelOrder=JSON.parse(sql("SELECT public.clube_coupon_paid_create_order("+
 q(user)+"::uuid,"+q(cancelQuote.quoteId)+"::uuid,"+q(cancelVoucher)+
 "::uuid,'cash',"+q(cancelKey)+","+q('c'.repeat(64))+
 ",null,null,'11999999999')::text;"));
assert.equal(cancelOrder.couponAppliedCents,500);
const cancelOrderId=cancelOrder.orderId;
const cancellationBuyerView=await callEdge('get-order',buyerToken,{orderId:cancelOrderId});
assert.equal(cancellationBuyerView.status,200);
const cancellationAccepted=await callEdge('merchant-action',ownerToken,
 {orderId:cancelOrderId,action:'accept',expectedVersion:cancellationBuyerView.body.version},
 'ci-coupon-cancel-accept-'+randomUUID());
assert.equal(cancellationAccepted.status,200);
const cancellationDispatched=await callEdge('merchant-action',ownerToken,
 {orderId:cancelOrderId,action:'dispatch',expectedVersion:cancellationAccepted.body.version},
 'ci-coupon-cancel-dispatch-'+randomUUID());
assert.equal(cancellationDispatched.status,200);
assert.equal(cancellationDispatched.body.status,'OUT_FOR_DELIVERY');
const cancellation=JSON.parse(sql("SELECT public.admin_cancel_dispatched_order("+
 q(admin)+"::uuid,"+q(cancelOrderId)+"::uuid,"+
 Number(cancellationDispatched.body.version)+","+
 q('CI isolated coupon cancellation after dispatch')+","+
 q('ci-cancel-after-dispatch-'+randomUUID())+","+
 q('d'.repeat(64))+")::text;"));
assert.equal(cancellation.status,'CANCELLED');
assert.equal(sql("SELECT count(*) FROM public.wallet_entries WHERE order_id="+
 q(cancelOrderId)+"::uuid AND user_id="+q(user)+"::uuid AND bucket='cashback'"+
 " AND entry_type='cashback_release'"),'1');
const rightful=JSON.parse(sql("SELECT public.clube_coupon_paid_order_reconciliation("+
 q(cancelOrderId)+"::uuid)::text;"));
assert.equal(rightful.status,'CUSTOMER_CREDIT_RETURNED',
 'customer cashback must be returned after legitimate order cancellation');
assert.equal(rightful.returnedCashbackCents,rightful.cashbackReservedCents);
// Transactional corruption probe: point the SAME release at the merchant
// owner's wallet and verify it cannot falsely clear the buyer's refund.
// ROLLBACK restores the original entry; no hosted records or money used.
const wrongOwner=sql("BEGIN; "+
 "UPDATE public.wallet_entries SET user_id="+q(owner)+"::uuid "+
 "WHERE order_id="+q(cancelOrderId)+"::uuid AND entry_type='cashback_release'; "+
 "SELECT public.clube_coupon_paid_order_reconciliation("+
 q(cancelOrderId)+"::uuid)->>'status'; ROLLBACK;");
assert.equal(wrongOwner,'CANCELLATION_REVIEW',
 'credit to another person can never prove a buyer refund');
const rightAgain=JSON.parse(sql("SELECT public.clube_coupon_paid_order_reconciliation("+
 q(cancelOrderId)+"::uuid)::text;"));
assert.equal(rightAgain.status,'CUSTOMER_CREDIT_RETURNED',
 'rollback of synthetic wrong-owner probe must restore original accounting');
assert.equal(rightAgain.merchantExternalSettlementVerified,false);
// A different cashback release on the RIGHT wallet must not be mistaken
// for a refund of this voucher. All probes run only on the disposable DB.
const wrongReason=sql("BEGIN; "+
 "UPDATE public.wallet_entries SET metadata=jsonb_set(metadata,"+
 " '{reason}', to_jsonb('unrelated_cashback_credit'::text)) WHERE order_id="+
 q(cancelOrderId)+"::uuid AND entry_type='cashback_release'; "+
 "SELECT public.clube_coupon_paid_order_reconciliation("+
 q(cancelOrderId)+"::uuid)->>'status'; ROLLBACK;");
assert.equal(wrongReason,'CANCELLATION_REVIEW',
 'right account + order alone is not sufficient: wrong refund reason');
const wrongKey=sql("BEGIN; "+
 "UPDATE public.wallet_entries SET idempotency_key="+
 q('unrelated-wallet-event-'+randomUUID())+
 " WHERE order_id="+q(cancelOrderId)+
 "::uuid AND entry_type='cashback_release'; "+
 "SELECT public.clube_coupon_paid_order_reconciliation("+
 q(cancelOrderId)+"::uuid)->>'status'; ROLLBACK;");
assert.equal(wrongKey,'CANCELLATION_REVIEW',
 'the correct user/amount/reason needs an original cancellation action key');
const duplicate=sql("BEGIN; INSERT INTO public.wallet_entries("+
 "user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata)"+
 " VALUES("+q(user)+"::uuid,"+q(cancelOrderId)+
 "::uuid,'cashback','cashback_release',"+rightAgain.cashbackReservedCents+","+
 q('duplicate-local-cancel-'+randomUUID()+':cashback-release')+
 ",jsonb_build_object('reason','admin_cancelled_after_dispatch')); "+
 "SELECT public.clube_coupon_paid_order_reconciliation("+
 q(cancelOrderId)+"::uuid)->>'status'; ROLLBACK;");
assert.equal(duplicate,'CANCELLATION_REVIEW',
 'two cashback returns cannot count as a single verified refund');
const reverted=JSON.parse(sql("SELECT public.clube_coupon_paid_order_reconciliation("+
 q(cancelOrderId)+"::uuid)::text;"));
assert.equal(reverted.status,'CUSTOMER_CREDIT_RETURNED');
assert.equal(reverted.returnedCashbackCents,reverted.cashbackReservedCents);
console.log('PASS: real full-schema cancelled coupon order, buyer only, exact reason/key/amount, duplicate refund excluded; all corruption probes rolled back.');

console.log('PASS: full real schema: gross Pix event -> audited net -> real v8 coupon checkout/cashback -> order replay -> chargeback review; fake local money only.');
