import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
// This test is intentionally restricted to the temporary local PostgreSQL
// provisioned by the isolated Supabase GitHub workflow.
assert.equal(process.env.CI,'true');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const env={...process.env,PGPASSWORD:'postgres'};
const sql=statement=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres',
 '--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1',
 '--tuples-only','--no-align','--quiet','--command='+statement
],{encoding:'utf8',env,timeout:60000,stdio:['ignore','pipe','pipe']}).trim();
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const refuse=(statement,reason)=>{
 let error;try{sql(statement)}catch(ex){error=ex}
 assert.ok(error,'Expected fail-closed rule '+reason);
 assert.match(String(error.stderr||error.message),new RegExp(reason));
};
// The earlier sponsored-coupon test deliberately leaves the main buyer with
// an active order. Use the unrelated synthetic referrer (no customer orders)
// to verify a second real coupon checkout without weakening the order gate.
const buyer=sql("SELECT u.id FROM auth.users u WHERE u.email LIKE 'tamao-outsider-%@example.com' AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.customer_id=u.id) ORDER BY u.created_at DESC LIMIT 1;");
const admin=sql("SELECT a.user_id FROM public.platform_admins a JOIN auth.users u ON u.id=a.user_id WHERE a.active AND a.admin_role='superadmin' AND u.email LIKE 'tamao-admin-%@example.com' LIMIT 1;");
const merchant='00000000-0000-4000-8000-000000000026';
assert.match(buyer,/^[0-9a-f-]{36}$/);
assert.match(admin,/^[0-9a-f-]{36}$/);
const pkg='all_products_3x5_sponsor';
assert.equal(sql("SELECT min_order_cents||':'||sale_enabled::text FROM public.clube_coupon_paid_packages WHERE package_key="+quote(pkg)), '5000:false',
 'General package starts disabled with R$50 minimum');
// Isolated test database only: sponsor guarantee and package approval simulated;
// never transfer, advertise sales or mark the real production account credited.
sql("UPDATE public.platform_clube_sponsor_pool_v1_807 SET authorized_cents=1000000,owner_guaranteed_cents=1000000-reconciled_cents,version=version+1 WHERE benefit_key='clube_coupons';");
sql("UPDATE public.clube_coupon_paid_packages SET funding_verified=true,legal_terms_verified=true,redeem_settlement_verified=true,sale_enabled=true WHERE package_key="+quote(pkg)+";");
const id=sql("INSERT INTO public.clube_coupon_paid_invoices(customer_user_id,package_key,request_id,sale_price_cents,coupon_face_cents,coupons_per_pack,valid_days) VALUES("+quote(buyer)+"::uuid,"+quote(pkg)+",gen_random_uuid(),890,500,3,180) RETURNING id;");
assert.match(id,/^[0-9a-f-]{36}$/);
assert.equal(sql("SELECT min_order_cents FROM public.clube_coupon_paid_invoices WHERE id="+quote(id)+"::uuid"),'5000',
 'New invoice freezes the minimum at purchase');
refuse("UPDATE public.clube_coupon_paid_invoices SET min_order_cents=1000 WHERE id="+quote(id)+"::uuid",
 'COUPON_MINIMUM_SNAPSHOT_IMMUTABLE');
const providerOrder='CI-GENERAL-ORDER-'+randomUUID();
const providerPayment='CI-GENERAL-PIX-'+randomUUID();
sql("UPDATE public.clube_coupon_paid_invoices SET provider_order_id="+quote(providerOrder)+",provider_payment_id="+quote(providerPayment)+",status='awaiting_payment' WHERE id="+quote(id)+"::uuid;");
const paid=JSON.parse(sql("SELECT public.clube_coupon_paid_payment_verify("+quote(id)+"::uuid,"+quote(providerOrder)+","+quote(providerPayment)+",890)::text;"));
assert.equal(paid.issued,3);
const net=JSON.parse(sql("SELECT public.clube_coupon_paid_net_proceeds_verify_audited("+quote(id)+"::uuid,"+quote(providerOrder)+",840,"+quote('CI-GENERAL-NET-'+randomUUID())+","+quote(admin)+"::uuid)::text;"));
assert.equal(net.ok,true);
const voucher=sql("SELECT id FROM public.clube_coupon_paid_issuances WHERE invoice_id="+quote(id)+"::uuid ORDER BY ordinal LIMIT 1;");
assert.match(voucher,/^[0-9a-f-]{36}$/);
const mkQuote=qty=>{
 const hash=randomUUID().replaceAll('-','').padEnd(64,'a');
 const items=JSON.stringify([{product_code:'CHARCOAL2',quantity:qty,unit_price_cents:1800}]);
 const statement="SELECT public.create_quote_snapshot_v3("+
   quote(buyer)+"::uuid,"+quote(merchant)+"::uuid,'97300000','10',400,25,45,"+
   "clock_timestamp()+interval '5 minutes',"+
   quote(items)+"::jsonb,"+quote(hash)+")::text;";
 return JSON.parse(sql(statement)).quoteId;
};
const low=mkQuote(1);
const high=mkQuote(3);
const lowGross=Number(sql("SELECT gross_total_cents FROM public.quotes WHERE id="+quote(low)+"::uuid;"));
const highGross=Number(sql("SELECT gross_total_cents FROM public.quotes WHERE id="+quote(high)+"::uuid;"));
assert.ok(lowGross>=500&&lowGross<5000,'Low charcoal order remains below R$50, got '+lowGross);
assert.ok(highGross>=5000,'High charcoal order qualifies, got '+highGross);
refuse("SELECT public.clube_coupon_paid_quote_reserve("+quote(buyer)+"::uuid,"+quote(voucher)+"::uuid,"+quote(low)+"::uuid);",
 'COUPON_MINIMUM_ORDER_NOT_MET');
assert.equal(sql("SELECT status FROM public.clube_coupon_paid_issuances WHERE id="+quote(voucher)+"::uuid"),'issued');
const reserved=JSON.parse(sql("SELECT public.clube_coupon_paid_quote_reserve("+quote(buyer)+"::uuid,"+quote(voucher)+"::uuid,"+quote(high)+"::uuid)::text;"));
assert.equal(reserved.reserved,true);
sql("UPDATE public.quotes SET payment_method_requested='cash',payment_timing_requested='on_delivery' WHERE id="+quote(high)+"::uuid;");
const order=JSON.parse(sql("SELECT public.clube_coupon_paid_create_order("+
 quote(buyer)+"::uuid,"+quote(high)+"::uuid,"+quote(voucher)+"::uuid,'cash',"+
 quote('ci-coupon-general-'+randomUUID())+","+quote('b'.repeat(64))+
 ",null,null,'11999999999')::text;"));
assert.equal(order.couponAppliedCents,500);
assert.equal(sql("SELECT status FROM public.clube_coupon_paid_issuances WHERE id="+quote(voucher)+"::uuid"),'redeemed');
refuse("SELECT public.admin_clube_coupon_general_minimum_set_v1_810("+quote(admin)+"::uuid,7000);",
 'COUPON_MINIMUM_REQUIRES_PAUSED_PACKAGE');
sql("UPDATE public.clube_coupon_paid_packages SET sale_enabled=false WHERE package_key="+quote(pkg)+";");
const change=JSON.parse(sql("SELECT public.admin_clube_coupon_general_minimum_set_v1_810("+quote(admin)+"::uuid,7000)::text;"));
assert.equal(change.minimumCents,7000);
assert.equal(sql("SELECT min_order_cents FROM public.clube_coupon_paid_invoices WHERE id="+quote(id)+"::uuid"),'5000',
 'Existing paid invoices retain their original R$50 purchase contract');
console.log('V1.810 PostgreSQL PASS — non-gas charcoal cart below/above min, Pix-backed voucher, atomic order, immutable history and protected Admin rule.');
