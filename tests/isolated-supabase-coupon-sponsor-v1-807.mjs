import assert from 'node:assert/strict';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
// ONLY the disposable local Supabase created by GitHub Actions.
assert.equal(process.env.CI,'true');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const args=statement=>[
 '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
 '--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align',
 '--quiet','--command='+statement
];
const env={...process.env,PGPASSWORD:'postgres'};
const sql=statement=>execFileSync('psql',args(statement),{
 encoding:'utf8',env,timeout:60000,stdio:['ignore','pipe','pipe']
}).trim();
const asyncSql=promisify(execFile);
const concurrentSql=statement=>asyncSql('psql',args(statement),{
 encoding:'utf8',env,timeout:60000,maxBuffer:256*1024
});
const q=s=>"'"+String(s).replaceAll("'","''")+"'";
const refuse=(stmt,fragment)=>{
 let err;try{sql(stmt)}catch(e){err=e}
 assert.ok(err,'Expected failure: '+fragment);
 assert.match(String(err.stderr||err.message),new RegExp(fragment));
};
const getPool=()=>sql("SELECT reconciled_cents||':'||encumbered_cents FROM public.platform_clube_sponsor_pool_v1_807 WHERE benefit_key='clube_coupons';");
const buyer=sql("SELECT id FROM auth.users WHERE email LIKE 'tamao-buyer-%@example.com' ORDER BY created_at DESC LIMIT 1;");
const merchant='00000000-0000-4000-8000-000000000026';
assert.match(buyer,/^[0-9a-f-]{36}$/i);
assert.equal(sql("SELECT operation_mode FROM public.platform_launch_control WHERE singleton=true"),'LIVE');
assert.equal(getPool(),'0:0');
assert.equal(sql("SELECT sale_enabled::text||':'||sponsored_by_owner::text FROM public.clube_coupon_paid_packages WHERE package_key='gas_3x5_sponsor'"),'false:true');
for(const key of ['gas_3x5_sponsor','water_5x2_sponsor']){
 sql("UPDATE public.clube_coupon_paid_packages SET funding_verified=true,legal_terms_verified=true,redeem_settlement_verified=true,sale_enabled=true WHERE package_key="+q(key)+";");
}
const mk=(key)=>{
 const gas=key==='gas_3x5_sponsor';
 return "INSERT INTO public.clube_coupon_paid_invoices "+
 "(customer_user_id,package_key,request_id,sale_price_cents,coupon_face_cents,coupons_per_pack,valid_days)"+
 " VALUES("+q(buyer)+"::uuid,"+q(key)+",gen_random_uuid(),"+
 (gas?"890,500,3,180":"490,200,5,90")+") RETURNING id;";
};
refuse(mk('gas_3x5_sponsor'),'COUPON_SPONSOR_FUNDS_NOT_VERIFIED_OR_EXHAUSTED');
assert.equal(getPool(),'0:0');
// A separately bank-reconciled owner contribution must exist in production.
// This counter is seeded ONLY inside the ephemeral runner to test buying.
sql("UPDATE public.platform_clube_sponsor_pool_v1_807 SET reconciled_cents=10000 WHERE benefit_key='clube_coupons';");
assert.equal(getPool(),'10000:0');
refuse("INSERT INTO public.clube_coupon_paid_invoices(customer_user_id,package_key,request_id,sale_price_cents,coupon_face_cents,coupons_per_pack,valid_days,sponsor_covered_cents)"+
 " VALUES("+q(buyer)+"::uuid,'gas_3x5_sponsor',gen_random_uuid(),890,500,3,180,1500);",
 'COUPON_SPONSOR_CLIENT_CANNOT_SET_CREDIT');
assert.equal(getPool(),'10000:0');
const first=sql(mk('gas_3x5_sponsor'));
assert.match(first,/^[0-9a-f-]{36}$/);
assert.equal(getPool(),'10000:1500');
assert.equal(sql("SELECT sponsor_covered_cents||':'||status FROM public.clube_coupon_paid_invoices WHERE id="+q(first)+"::uuid"),'1500:prepared');
assert.equal(sql("SELECT face_covered_cents||':'||status FROM public.clube_coupon_sponsor_reservations_v1_807 WHERE invoice_id="+q(first)+"::uuid"),'1500:held');
refuse("UPDATE public.clube_coupon_paid_invoices SET sponsor_covered_cents=0 WHERE id="+q(first)+"::uuid",
 'COUPON_SPONSOR_IMMUTABLE_INVOICE');
assert.equal(getPool(),'10000:1500');
const water=sql(mk('water_5x2_sponsor'));
for(let i=0;i<5;i++)sql(mk('gas_3x5_sponsor'));
assert.equal(getPool(),'10000:10000');
refuse(mk('water_5x2_sponsor'),'COUPON_SPONSOR_FUNDS_NOT_VERIFIED_OR_EXHAUSTED');
assert.equal(getPool(),'10000:10000');
assert.equal(sql("SELECT public.clube_coupon_sponsor_covered_v1_807("+q(first)+"::uuid,1500)"),'f',
 'unpaid hold must not count as settled voucher funding');
// Release ONE abandoned pending invoice and race two competing buyers.
sql("UPDATE public.clube_coupon_paid_invoices SET status='expired' WHERE id="+q(first)+"::uuid;");
assert.equal(getPool(),'10000:8500');
assert.equal(sql("SELECT status FROM public.clube_coupon_sponsor_reservations_v1_807 WHERE invoice_id="+q(first)+"::uuid"),'released');
const contenders=await Promise.allSettled([
 concurrentSql(mk('gas_3x5_sponsor')),
 concurrentSql(mk('gas_3x5_sponsor'))
]);
const won=contenders.filter(x=>x.status==='fulfilled'),lost=contenders.filter(x=>x.status==='rejected');
assert.equal(won.length,1,'only one concurrent buyer may acquire last coverage');
assert.equal(lost.length,1);
assert.match(String(lost[0].reason.stderr||lost[0].reason.message),
 /COUPON_SPONSOR_FUNDS_NOT_VERIFIED_OR_EXHAUSTED/);
assert.equal(getPool(),'10000:10000');
const paid=won[0].value.stdout.trim();
assert.match(paid,/^[0-9a-f-]{36}$/);
const orderId='CI-SPONSOR-ORDER-'+randomUUID(),paymentId='CI-SPONSOR-PIX-'+randomUUID();
const netRef='CI-SPONSOR-NET-'+randomUUID();
sql("UPDATE public.clube_coupon_paid_invoices SET provider_order_id="+q(orderId)+",provider_payment_id="+q(paymentId)+",status='awaiting_payment' WHERE id="+q(paid)+"::uuid;");
const approved=JSON.parse(sql("SELECT public.clube_coupon_paid_payment_verify("+q(paid)+"::uuid,"+q(orderId)+","+q(paymentId)+",890)::text;"));
assert.equal(approved.issued,3);
assert.equal(sql("SELECT status FROM public.clube_coupon_sponsor_reservations_v1_807 WHERE invoice_id="+q(paid)+"::uuid"),'captured');
assert.equal(sql("SELECT public.clube_coupon_sponsor_covered_v1_807("+q(paid)+"::uuid,1500)"),'t');
const admin=sql("SELECT user_id FROM public.platform_admins WHERE active=true AND admin_role='superadmin' AND user_id IN (SELECT id FROM auth.users WHERE email LIKE 'tamao-admin-%@example.com') LIMIT 1;");
assert.match(admin,/^[0-9a-f-]{36}$/);
const net=JSON.parse(sql("SELECT public.clube_coupon_paid_net_proceeds_verify_audited("+q(paid)+"::uuid,"+q(orderId)+",840,"+q(netRef)+","+q(admin)+"::uuid)::text;"));
assert.equal(net.ok,true);
const ids=JSON.parse(sql("SELECT json_agg(id)::text FROM public.clube_coupon_paid_issuances WHERE invoice_id="+q(paid)+"::uuid"));
assert.equal(ids.length,3);
const hash='a'.repeat(64);
const quote=JSON.parse(sql("SELECT public.create_quote_snapshot_v3("+
  q(buyer)+"::uuid,"+q(merchant)+"::uuid,'97300000','10',400,25,45,"+
  "clock_timestamp()+interval '5 minutes',"+
  q('[{"product_code":"CHARCOAL2","quantity":1,"unit_price_cents":1800]')+"::jsonb,"+q(hash)+")::text;"));
sql("UPDATE public.quotes SET payment_method_requested='cash',payment_timing_requested='on_delivery' WHERE id="+q(quote.quoteId)+"::uuid;");
const order=JSON.parse(sql("SELECT public.clube_coupon_paid_create_order("+
 q(buyer)+"::uuid,"+q(quote.quoteId)+"::uuid,"+q(ids[0])+"::uuid,'cash',"+
 q('ci-sponsor-redeem-'+randomUUID())+","+q('b'.repeat(64))+
 ",null,null,'11999999999')::text;"));
assert.equal(order.couponAppliedCents,500);
assert.equal(sql("SELECT status FROM public.clube_coupon_paid_issuances WHERE id="+q(ids[0])+"::uuid"),'redeemed');
// A full provider refund AFTER any voucher is used must retain the sponsor
// liability until the merchant/client reconciliation is settled.
sql("SELECT public.clube_coupon_paid_payment_refund("+q(paid)+"::uuid,"+q(orderId)+")::text;");
assert.equal(sql("SELECT status FROM public.clube_coupon_sponsor_reservations_v1_807 WHERE invoice_id="+q(paid)+"::uuid"),'captured');
assert.equal(getPool(),'10000:10000');
console.log('V1.807 PASS — zero cash fails closed; full-face escrow; 2 concurrent buyers/1 winner; net Pix, v8 redemption and refund hold.');
