import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
// CI-only disposable Supabase, NEVER production keys nor merchant PSP.
// We intentionally drop the permanent launch-blocking CHECK in this isolated
// database to exercise the unexposed new financial path.
assert.equal(process.env.CI,'true');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const sql=statement=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres',
 '--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1',
 '--tuples-only','--no-align','--quiet','--command='+statement
],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},
 timeout:90000,stdio:['ignore','pipe','pipe']}).trim();
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
function denied(stmt,code){
 let caught=null;try{sql(stmt)}catch(e){caught=e;}
 assert.ok(caught,'must fail '+code);
 assert.match(String(caught.stderr||caught.message||''),new RegExp(code));
}
const merchant='00000000-0000-4000-8000-000000000026';
const owner=sql("SELECT user_id FROM public.merchant_members WHERE merchant_id="+q(merchant)+
 "::uuid AND active AND member_role='owner' LIMIT 1");
const admin=sql("SELECT user_id FROM public.platform_admins WHERE active=true AND admin_role='superadmin' ORDER BY created_at DESC LIMIT 1");
assert.match(owner,/^[0-9a-f-]{36}$/i);
assert.match(admin,/^[0-9a-f-]{36}$/i);
assert.equal(sql("SELECT enabled::text FROM public.clube_partner_coupon_launch_v1_846 WHERE singleton"),'false');
assert.equal(sql("SELECT COUNT(*) FROM public.clube_partner_coupon_order_uses_v1_846"),'0');
assert.equal(sql("SELECT has_function_privilege('authenticated','public.clube_coupon_paid_create_order(uuid,uuid,uuid,text,text,text,text,integer,text,text,text,text)','EXECUTE')"),'f');
assert.equal(sql("SELECT has_table_privilege('authenticated','public.clube_partner_coupon_order_uses_v1_846','SELECT')"),'f');
assert.equal(sql("SELECT commerce_enabled FROM public.platform_launch_control WHERE singleton"),'t',
  'Only local CI may enable ordinary product orders');
const previousDebts=Number(sql("SELECT COUNT(*) FROM public.merchant_cashback_reimbursements"));
const previousInvoices=Number(sql("SELECT COUNT(*) FROM public.clube_coupon_paid_invoices"));
const buyer=sql("INSERT INTO auth.users (id,instance_id,aud,role,is_sso_user,is_anonymous,email,email_confirmed_at) "+
 "VALUES(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',false,false,"+
 q('future-coupon-'+randomUUID()+'@example.invalid')+",clock_timestamp()) RETURNING id");
assert.match(buyer,/^[0-9a-f-]{36}$/);
sql("UPDATE public.merchants SET status='active',online=true,accepts_citywide=true,last_seen_at=clock_timestamp() WHERE id="+q(merchant)+"::uuid");
sql("UPDATE public.catalog_items SET price_confirmed_at=clock_timestamp(),active=true,available_stock=10 "+
 "WHERE merchant_id="+q(merchant)+"::uuid AND product_code='CHARCOAL2'");
const pkg='partner_ci_'+randomUUID().replaceAll('-','').slice(0,16);
sql("INSERT INTO public.clube_coupon_paid_packages("+
 "package_key,title,sale_price_cents,coupon_face_cents,coupons_per_pack,valid_days,"+
 "min_order_cents,funding_verified,legal_terms_verified,redeem_settlement_verified,sale_enabled)"+
 " VALUES("+q(pkg)+",'Only local future partner coupons',1500,500,3,90,1000,true,true,true,true)");
const newInvoice=()=>{
 return "INSERT INTO public.clube_coupon_paid_invoices("+
 "customer_user_id,package_key,request_id,sale_price_cents,coupon_face_cents,coupons_per_pack,valid_days,"+
 "min_order_cents,terms_version,terms_accepted_at,funding_mode_v1_846,funding_terms_version_v1_846)"+
 " VALUES("+q(buyer)+"::uuid,"+q(pkg)+",gen_random_uuid(),1500,500,3,90,1000,"+
 "'clube_partner_coupon_terms_v1_846',clock_timestamp(),'partner_funded',"+
 "'clube_partner_coupon_terms_v1_846') RETURNING id";
};
denied(newInvoice(),'PARTNER_COUPON_SALE_NOT_RELEASED');
assert.equal(sql("SELECT COUNT(*) FROM public.clube_coupon_paid_invoices"),String(previousInvoices),
 'The production-style launch seal refuses any new funded invoice');
// This DDL exists in isolated CI ONLY. The committed production constraint is
// permanently enabled=false, so no owner or service role can flip it in place.
sql("ALTER TABLE public.clube_partner_coupon_launch_v1_846 DROP CONSTRAINT "+
 "clube_partner_coupon_launch_v1_846_enabled_check");
sql("UPDATE public.clube_partner_coupon_launch_v1_846 SET enabled=true WHERE singleton");
denied(newInvoice(),'PARTNER_COUPON_NO_ACTIVE_MERCHANT');
const initial=JSON.parse(sql("SELECT public.merchant_coupon_contract_v1_845("+
 q(owner)+"::uuid,"+q(merchant)+"::uuid,'view')::text"));
assert.equal(initial.optedIn,false);
const accepted=JSON.parse(sql("SELECT public.merchant_coupon_contract_v1_845("+
 q(owner)+"::uuid,"+q(merchant)+"::uuid,'accept',1,"+initial.version+","+
 q(randomUUID())+"::uuid,true)::text"));
assert.equal(accepted.optedIn,true);
assert.equal(accepted.checkoutEnabled,false,'consent must NOT automatically allow sales in production');
const invoice=sql(newInvoice());
assert.match(invoice,/^[0-9a-f-]{36}$/);
denied("UPDATE public.clube_coupon_paid_invoices SET funding_mode_v1_846='platform_reimbursed' WHERE id="+q(invoice)+"::uuid",
 'COUPON_FUNDING_SNAPSHOT_IMMUTABLE');
const providerOrder='CI-PARTNER-ORDER-'+randomUUID();
const providerPayment='CI-PARTNER-PIX-'+randomUUID();
sql("UPDATE public.clube_coupon_paid_invoices SET provider_order_id="+q(providerOrder)+
 ",provider_payment_id="+q(providerPayment)+",status='awaiting_payment' WHERE id="+q(invoice)+"::uuid");
const paid=JSON.parse(sql("SELECT public.clube_coupon_paid_payment_verify("+
 q(invoice)+"::uuid,"+q(providerOrder)+","+q(providerPayment)+",1500)::text"));
assert.equal(paid.issued,3);
const net=JSON.parse(sql("SELECT public.clube_coupon_paid_net_proceeds_verify_audited("+
 q(invoice)+"::uuid,"+q(providerOrder)+",1500,"+
 q('CI-PARTNER-NET-'+randomUUID())+","+q(admin)+"::uuid)::text"));
assert.equal(net.ok,true);
const voucher=sql("SELECT id FROM public.clube_coupon_paid_issuances WHERE invoice_id="+q(invoice)+
 "::uuid ORDER BY ordinal LIMIT 1");
assert.match(voucher,/^[0-9a-f-]{36}$/);
const makeQuote=()=>{
 const raw="SELECT public.create_quote_snapshot_v3("+q(buyer)+"::uuid,"+q(merchant)+
 "::uuid,'97300000','10',400,25,45,clock_timestamp()+interval '5 minutes',"+
 q(JSON.stringify([{product_code:'CHARCOAL2',quantity:1,unit_price_cents:1800}]))+"::jsonb,"+
 q('d'.repeat(64))+")::text";
 return JSON.parse(sql(raw)).quoteId;
};
const quote=makeQuote();
const key='ci-partner-coupon-'+randomUUID();
sql("UPDATE public.quotes SET payment_method_requested='cash',payment_timing_requested='on_delivery' WHERE id="+q(quote)+"::uuid");
const checkout=k=>"SELECT public.clube_coupon_paid_create_order("+
 q(buyer)+"::uuid,"+q(quote)+"::uuid,"+q(voucher)+"::uuid,'cash',"+
 q(k)+","+q('b'.repeat(64))+",null,null,'11999999999')::text";
const cancelled=JSON.parse(sql("SELECT public.merchant_coupon_contract_v1_845("+
 q(owner)+"::uuid,"+q(merchant)+"::uuid,'revoke',1,"+accepted.version+","+
 q(randomUUID())+"::uuid,false)::text"));
assert.equal(cancelled.optedIn,false);
denied(checkout(key),'PARTNER_COUPON_MERCHANT_NOT_PARTICIPATING');
assert.equal(sql("SELECT status FROM public.clube_coupon_paid_issuances WHERE id="+q(voucher)+"::uuid"),'issued',
 'Rejected redemption rolls back whole coupon, quote, wallet and order');
assert.equal(sql("SELECT consumed_at IS NULL FROM public.quotes WHERE id="+q(quote)+"::uuid"),'t');
const reaccept=JSON.parse(sql("SELECT public.merchant_coupon_contract_v1_845("+
 q(owner)+"::uuid,"+q(merchant)+"::uuid,'accept',1,"+cancelled.version+","+
 q(randomUUID())+"::uuid,true)::text"));
assert.equal(reaccept.optedIn,true);
const result=JSON.parse(sql(checkout(key)));
assert.equal(result.couponAppliedCents,500);
assert.equal(result.partnerFundedCoupon,true);
assert.equal(result.partnerFundedDiscountCents,500);
assert.equal(result.partnerFeeBpsSnapshot,800);
assert.equal(result.couponFundingModel,'partner_funded');
const order=result.orderId;
assert.match(order,/^[0-9a-f-]{36}$/);
const snapshot=JSON.parse(sql("SELECT json_build_object('gross',gross_total_cents,"+
 "'cashback',cashback_reserved_cents,'total',total_cents,'fee',platform_fee_bps_snapshot)::text "+
 "FROM public.orders WHERE id="+q(order)+"::uuid"));
assert.equal(snapshot.gross,2200);
assert.equal(snapshot.cashback,500);
assert.equal(snapshot.total,1700);
assert.equal(snapshot.fee,800,'reduced Flex is 8% on NET');
assert.equal(sql("SELECT count(*) FROM public.clube_partner_coupon_order_uses_v1_846 WHERE order_id="+
 q(order)+"::uuid AND invoice_id="+q(invoice)+"::uuid AND voucher_id="+q(voucher)+
 "::uuid AND merchant_contract_version="+reaccept.version),'1');
const replay=JSON.parse(sql(checkout(key)));
assert.equal(replay.couponReplayed,true);
assert.equal(replay.orderId,order);
assert.equal(replay.partnerFundedDiscountCents,500);
denied("UPDATE public.clube_partner_coupon_order_uses_v1_846 SET face_cents=400 WHERE order_id="+
 q(order)+"::uuid",'PARTNER_COUPON_RECEIPT_IMMUTABLE');
denied("UPDATE public.orders SET merchant_id=NULL WHERE id="+q(order)+"::uuid",
 '(?:PARTNER_COUPON_ORDER_SNAPSHOT_IMMUTABLE|ORDER_BASKET_REGULATORY_NOT_AUTHORIZED)');
assert.equal(sql("SELECT merchant_id FROM public.orders WHERE id="+q(order)+"::uuid"),merchant,
 'Rejected merchant transfer leaves original merchant binding intact');
// The new immutable coupon receipt must also reject unauthorized money edits,
// regardless of other existing regulatory guards.
denied("UPDATE public.orders SET total_cents=total_cents+1 WHERE id="+q(order)+"::uuid",
 'PARTNER_COUPON_ORDER_SNAPSHOT_IMMUTABLE');
assert.equal(sql("SELECT total_cents FROM public.orders WHERE id="+q(order)+"::uuid"),'1700');

const rawEnv=execFileSync('supabase',['status','-o','env'],{encoding:'utf8',timeout:30000});
const env=Object.fromEntries(rawEnv.split('\n').map(x=>{
 const m=x.match(/^([A-Z_]+)=(.*)$/);return m?[m[1],m[2].replace(/^[\"']|[\"']$/g,'')]:null;
}).filter(Boolean));
const base=env.API_URL||env.SUPABASE_URL||'';
const anon=env.ANON_KEY||env.SUPABASE_ANON_KEY||'';
const service=env.SERVICE_ROLE_KEY||env.SUPABASE_SERVICE_ROLE_KEY||'';
assert.match(base,/^http:\/\/(?:127\.0\.0\.1|localhost):54321\/?$/);
async function tokenFor(id){
 const password='LocalPartnerCouponCI!'+randomUUID();
 const update=await fetch(base+'/auth/v1/admin/users/'+id,{
 method:'PUT',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},
 body:JSON.stringify({password}),signal:AbortSignal.timeout(30000)});
 assert.equal(update.status,200,'local Auth password setup');
 const email=sql("SELECT email FROM auth.users WHERE id="+q(id)+"::uuid");
 const login=await fetch(base+'/auth/v1/token?grant_type=password',{
 method:'POST',headers:{apikey:anon,'Content-Type':'application/json'},
 body:JSON.stringify({email,password}),signal:AbortSignal.timeout(30000)});
 assert.equal(login.status,200,'local GoTrue user session');
 return (await login.json()).access_token;
}
const buyerToken=await tokenFor(buyer);
const ownerToken=await tokenFor(owner);
async function edge(slug,token,payload,key=null){
 const res=await fetch(base+'/functions/v1/'+slug,{
 method:'POST',headers:{apikey:anon,Authorization:'Bearer '+token,
 Origin:'http://localhost:5173','Content-Type':'application/json',
 ...(key?{'Idempotency-Key':key}:{})},
 body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)});
 return {status:res.status,body:await res.json()};
}
const initialOrder=await edge('get-order',buyerToken,{orderId:order});
assert.equal(initialOrder.status,200);
assert.equal(initialOrder.body.totalCents,1700);
assert.equal(initialOrder.body.partnerCouponFundedCents,500);
assert.equal(initialOrder.body.couponFundingModel,'partner_funded');
const merchantOrders=await edge('merchant-orders',ownerToken,{merchantId:merchant});
assert.equal(merchantOrders.status,200);
const row=merchantOrders.body.orders?.find(o=>o.orderId===order);
assert.ok(row);
assert.equal(row.totalCents,1700);
assert.equal(row.couponAppliedCents,500);
assert.equal(row.partnerCouponFundedCents,500);
assert.equal(row.couponFundingModel,'partner_funded');
assert.equal(row.partnerFeeBpsSnapshot,800);
const acceptedOrder=await edge('merchant-action',ownerToken,
 {orderId:order,action:'accept',expectedVersion:row.version},'ci-pc-accept-'+randomUUID());
assert.equal(acceptedOrder.status,200,JSON.stringify(acceptedOrder.body).slice(0,500));
const dispatched=await edge('merchant-action',ownerToken,
 {orderId:order,action:'dispatch',expectedVersion:acceptedOrder.body.version},
 'ci-pc-dispatch-'+randomUUID());
assert.equal(dispatched.status,200);
const buyerDispatch=await edge('get-order',buyerToken,{orderId:order});
assert.match(buyerDispatch.body.deliveryPin,/^[0-9]{4}$/);
const arriving=await edge('merchant-action',ownerToken,
 {orderId:order,action:'arriving',expectedVersion:buyerDispatch.body.version},
 'ci-pc-arriving-'+randomUUID());
assert.equal(arriving.status,200);
const completed=await edge('complete-delivery',ownerToken,{
 orderId:order,pin:buyerDispatch.body.deliveryPin,
 expectedVersion:arriving.body.version,paymentConfirmed:true
},'ci-pc-complete-'+randomUUID());
assert.equal(completed.status,200,'partner coupon settled through merchant API '+JSON.stringify(completed.body).slice(0,600));
assert.equal(completed.body.status,'SETTLED');
assert.equal(sql("SELECT platform_fee_cents FROM public.platform_receivables WHERE order_id="+q(order)+"::uuid"),'136',
 '8% of R$17 is R$1.36, never 9% of R$22');
assert.equal(sql("SELECT platform_fee_cents FROM public.order_reward_grants WHERE order_id="+q(order)+"::uuid"),'136',
 'Reward revenue reflects net reduced fee');
assert.equal(sql("SELECT benefit_fee_basis_cents_v1_843 FROM public.platform_receivables WHERE order_id="+q(order)+"::uuid"),'1700');
assert.equal(sql("SELECT COUNT(*) FROM public.merchant_cashback_reimbursements WHERE order_id="+q(order)+"::uuid"),'0',
 'Partner coupon must not cause merchant debt');
const reconciliation=JSON.parse(sql("SELECT public.clube_coupon_paid_order_reconciliation("+
 q(order)+"::uuid)::text"));
assert.equal(reconciliation.status,'PARTNER_FUNDED_NO_REIMBURSEMENT');
assert.equal(reconciliation.partnerFundedDiscountCents,500);
assert.equal(reconciliation.couponFundingModel,'partner_funded');
assert.equal(Number(sql("SELECT COUNT(*) FROM public.merchant_cashback_reimbursements")),previousDebts,
 'No historic merchant debt was erased or reclassified');
console.log('PASS #846: isolated new invoice/coupon -> revoked denial -> consent -> order -> direct merchant delivery -> 8% of net -> rewards -> ZERO reimbursement -> replay, with existing debts unchanged.');
