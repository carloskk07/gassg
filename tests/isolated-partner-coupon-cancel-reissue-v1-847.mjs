import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
// Disposable local Auth + PostgreSQL only. No PSP token, live domain or
// customer payment. Runs AFTER #846, LAST in the isolated workflow.
assert.equal(process.env.CI,'true');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const sql=statement=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres',
 '--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1',
 '--tuples-only','--no-align','--quiet','--command='+statement
],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},
 timeout:90000,stdio:['ignore','pipe','pipe']}).trim();
const q=x=>"'"+String(x).replaceAll("'","''")+"'";
const env=Object.fromEntries(execFileSync('supabase',['status','-o','env'],{
 encoding:'utf8',timeout:30000
}).split('\n').map(x=>{
 const m=x.match(/^([A-Z_]+)=(.*)$/);return m?[m[1],m[2].replace(/^["']|["']$/g,'')]:null;
}).filter(Boolean));
const api=env.API_URL||env.SUPABASE_URL||'',anon=env.ANON_KEY||env.SUPABASE_ANON_KEY||'',
 service=env.SERVICE_ROLE_KEY||env.SUPABASE_SERVICE_ROLE_KEY||'';
assert.match(api,/^http:\/\/(?:127\.0\.0\.1|localhost):54321\/?$/);
assert.ok(anon.length>25&&service.length>25);
const merchant='00000000-0000-4000-8000-000000000026';
const pkg=sql("SELECT package_key FROM public.clube_coupon_paid_packages WHERE package_key LIKE 'partner_ci_%' ORDER BY package_key LIMIT 1");
assert.match(pkg,/^partner_ci_[a-z0-9]+$/);
assert.equal(sql('select enabled from public.clube_partner_coupon_launch_v1_846 where singleton'),'t',
 'Only local #846 fixture enables the launch after intentionally removing the immutable lock');
assert.equal(sql("SELECT opted_in FROM public.merchant_coupon_consents_v1_845 WHERE merchant_id="+q(merchant)+"::uuid"),'t');
const admin=sql("SELECT user_id FROM public.platform_admins WHERE active=true AND admin_role='superadmin' LIMIT 1");
const owner=sql("SELECT user_id FROM public.merchant_members WHERE merchant_id="+q(merchant)+
 "::uuid AND active AND member_role='owner' LIMIT 1");
const userEmail='cancel-partner-coupon-'+randomUUID()+'@example.invalid';
const password='LocalCouponCancel!'+randomUUID();
const u=await fetch(api+'/auth/v1/admin/users',{
 method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},
 body:JSON.stringify({email:userEmail,password,email_confirm:true}),signal:AbortSignal.timeout(30000)
});
assert.ok([200,201].includes(u.status),'Local real GoTrue synthetic buyer');
const buyer=String((await u.json()).id||'');
assert.match(buyer,/^[0-9a-f-]{36}$/);
async function login(email,password){
 const r=await fetch(api+'/auth/v1/token?grant_type=password',{
 method:'POST',headers:{apikey:anon,'Content-Type':'application/json'},
 body:JSON.stringify({email,password}),signal:AbortSignal.timeout(30000)
 });
 assert.equal(r.status,200,'Local real GoTrue sign in');
 return (await r.json()).access_token;
}
const token=await login(userEmail,password);
const invoice=sql("INSERT INTO public.clube_coupon_paid_invoices("+
 "customer_user_id,package_key,request_id,sale_price_cents,coupon_face_cents,coupons_per_pack,valid_days,"+
 "min_order_cents,terms_version,terms_accepted_at,funding_mode_v1_846,funding_terms_version_v1_846)"+
 " VALUES("+q(buyer)+"::uuid,"+q(pkg)+",gen_random_uuid(),890,500,3,90,1000,"+
 "'clube_partner_coupon_terms_v1_846',clock_timestamp(),'partner_funded',"+
 "'clube_partner_coupon_terms_v1_846') RETURNING id");
const providerOrder='CI-RETURN-ORDER-'+randomUUID(),providerPayment='CI-RETURN-PIX-'+randomUUID();
sql("UPDATE public.clube_coupon_paid_invoices SET provider_order_id="+q(providerOrder)+
 ",provider_payment_id="+q(providerPayment)+",status='awaiting_payment' WHERE id="+q(invoice)+"::uuid");
const paid=JSON.parse(sql("SELECT public.clube_coupon_paid_payment_verify("+
 q(invoice)+"::uuid,"+q(providerOrder)+","+q(providerPayment)+",890)::text"));
assert.equal(paid.issued,3);
const net=JSON.parse(sql("SELECT public.clube_coupon_paid_net_proceeds_verify_audited("+
 q(invoice)+"::uuid,"+q(providerOrder)+",820,"+
 q('CI-RETURN-NET-'+randomUUID())+","+q(admin)+"::uuid)::text"));
assert.equal(net.ok,true);
const voucher=sql("SELECT id FROM public.clube_coupon_paid_issuances WHERE invoice_id="+q(invoice)+
 "::uuid ORDER BY ordinal LIMIT 1");
assert.match(voucher,/^[0-9a-f-]{36}$/);
function quoteFor(){
 const item=JSON.stringify([{product_code:'CHARCOAL2',quantity:1,unit_price_cents:1800}]);
 const hash=randomBytes(32).toString('hex');
 const res=JSON.parse(sql("SELECT public.create_quote_snapshot_v3("+q(buyer)+"::uuid,"+
 q(merchant)+"::uuid,'97300000','10',400,25,45,clock_timestamp()+interval '5 minutes',"+
 q(item)+"::jsonb,"+q(hash)+")::text"));
 sql("UPDATE public.quotes SET payment_method_requested='cash',payment_timing_requested='on_delivery' WHERE id="+q(res.quoteId)+"::uuid");
 return res.quoteId;
}
const makeOrder=(quote,key)=>JSON.parse(sql("SELECT public.clube_coupon_paid_create_order("+
 q(buyer)+"::uuid,"+q(quote)+"::uuid,"+q(voucher)+"::uuid,'cash',"+
 q(key)+","+q('b'.repeat(64))+",null,null,'11999999999')::text"));
async function edge(slug,payload,key){
 const res=await fetch(api+'/functions/v1/'+slug,{
 method:'POST',headers:{apikey:anon,Authorization:'Bearer '+token,
  Origin:'http://localhost:5173','Content-Type':'application/json',
  ...(key?{'Idempotency-Key':key}:{})},
 body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)});
 return {status:res.status,body:await res.json()};
}
function pos(){
 return Number(sql("SELECT (public.cashback_position("+q(buyer)+"::uuid)->>'spendableCents')::integer"));
}
assert.equal(pos(),0);
const first=makeOrder(quoteFor(),'ci-partner-return-first-'+randomUUID());
assert.equal(first.partnerFundedCoupon,true);
assert.equal(first.totalCents,1700);
assert.equal(pos(),0);
assert.equal(sql("SELECT count(*) FROM public.clube_coupon_paid_order_applications WHERE voucher_id="+q(voucher)+"::uuid"),'1');
const firstGet=await edge('get-order',{orderId:first.orderId});
assert.equal(firstGet.status,200);
const cancel1=await edge('customer-action',{orderId:first.orderId,action:'cancel-before-accept',
 expectedVersion:firstGet.body.version},'ci-return-cancel-one-'+randomUUID());
assert.equal(cancel1.status,200,'Original cancellation must remain available '+JSON.stringify(cancel1.body).slice(0,450));
assert.equal(cancel1.body.status,'CANCELLED');
assert.equal(pos(),0,'Canceled partner coupon MUST NOT become generic TAMÃO cashback');
assert.equal(sql("SELECT status FROM public.clube_coupon_paid_issuances WHERE id="+q(voucher)+"::uuid"),'issued');
assert.equal(sql("SELECT redeemed_order_id IS NULL FROM public.clube_coupon_paid_issuances WHERE id="+q(voucher)+"::uuid"),'t');
assert.equal(sql("SELECT count(*) FROM public.clube_partner_coupon_returns_v1_847 WHERE voucher_id="+q(voucher)+"::uuid AND disposition='reissued'"),'1');
assert.equal(sql("SELECT count(*) FROM public.wallet_entries WHERE order_id="+q(first.orderId)+"::uuid AND entry_type='cashback_release'"),'1');
assert.equal(sql("SELECT count(*) FROM public.wallet_entries WHERE order_id="+q(first.orderId)+"::uuid AND entry_type='cashback_reserve'"),'2',
 'original spend and exact return quarantine, both -R$5');
const firstRecon=JSON.parse(sql("SELECT public.clube_coupon_paid_order_reconciliation("+q(first.orderId)+"::uuid)::text"));
assert.equal(firstRecon.status,'PARTNER_COUPON_VOUCHER_RETURNED');
assert.equal(firstRecon.partnerCouponReturnDisposition,'reissued');
const second=makeOrder(quoteFor(),'ci-partner-return-second-'+randomUUID());
assert.notEqual(second.orderId,first.orderId);
assert.equal(second.partnerFundedCoupon,true);
assert.equal(second.totalCents,1700);
assert.equal(pos(),0);
assert.equal(sql("SELECT count(*) FROM public.clube_coupon_paid_order_applications WHERE voucher_id="+q(voucher)+"::uuid"),'2',
 'same purchased voucher can be redeemed again only after valid cancellation lineage');
assert.equal(sql("SELECT count(*) FROM public.wallet_entries WHERE idempotency_key="+q('clube-paid-coupon:'+voucher+':return:1')),'1');
const original=JSON.parse(sql("SELECT public.clube_coupon_paid_order_reconciliation("+q(first.orderId)+"::uuid)::text"));
assert.equal(original.status,'PARTNER_COUPON_VOUCHER_RETURNED',
 'Old canceled order must retain independent evidence after new redemption');
const secondGet=await edge('get-order',{orderId:second.orderId});
assert.equal(secondGet.status,200);
const cancel2=await edge('customer-action',{orderId:second.orderId,action:'cancel-before-accept',
 expectedVersion:secondGet.body.version},'ci-return-cancel-two-'+randomUUID());
assert.equal(cancel2.status,200);
assert.equal(pos(),0);
assert.equal(sql("SELECT count(*) FROM public.clube_partner_coupon_returns_v1_847 WHERE voucher_id="+q(voucher)+"::uuid AND disposition='reissued'"),'2');
assert.equal(sql("SELECT status FROM public.clube_coupon_paid_issuances WHERE id="+q(voucher)+"::uuid"),'issued');
assert.equal(sql("SELECT count(*) FROM public.clube_coupon_paid_issuances WHERE invoice_id="+q(invoice)+"::uuid"),'3',
 'No extra coupons are minted, just the original entitlement reissued');
assert.equal(sql("SELECT count(*) FROM public.merchant_cashback_reimbursements WHERE order_id IN ("+
 q(first.orderId)+"::uuid,"+q(second.orderId)+"::uuid)"),'0');
assert.equal(sql("SELECT count(*) FROM public.clube_partner_coupon_order_uses_v1_846 WHERE voucher_id="+q(voucher)+"::uuid"),'2',
 'Both merchant cost snapshots immutable and tied to their own orders');
console.log('PASS #847: two independent canceled real partner-coupon orders, same reissued voucher, ZERO fungible cashback, receipt lineage and zero TAMÃO reimbursements.');
