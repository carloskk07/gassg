import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.CI,'true','Disposable PostgreSQL CI only');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const query=sql=>execFileSync('psql',['--host=127.0.0.1','--port=54322',
 '--username=postgres','--dbname=postgres','--no-psqlrc',
 '--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet',
 '--command='+sql],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},
 timeout:90000,stdio:['ignore','pipe','pipe']}).trim();
const quote=x=>"'"+String(x).replaceAll("'","''")+"'";
const invoices=JSON.parse(query("SELECT COALESCE(json_agg(t),'[]'::json)::text FROM ("+
 "SELECT id,package_key,sale_price_cents,coupon_face_cents,coupons_per_pack,"+
 "net_proceeds_cents,provider_order_id,net_proceeds_reference,terms_version,"+
 "funding_mode_v1_846,net_proceeds_verified_at "+
 "FROM public.clube_coupon_paid_invoices WHERE funding_mode_v1_846='partner_funded' "+
 "AND package_key LIKE 'partner_ci_%' ORDER BY id) t"));
assert.ok(invoices.length>=2,'Both the settlement and two cancellations must be tested with discounted sale economics');
for(const i of invoices){
 assert.equal(i.sale_price_cents,890);
 assert.equal(i.coupon_face_cents,500);
 assert.equal(i.coupons_per_pack,3);
 assert.equal(i.net_proceeds_cents,820);
 assert.equal(i.terms_version,'clube_partner_coupon_terms_v1_846');
 assert.ok(i.net_proceeds_verified_at);
 assert.ok(i.net_proceeds_reference?.length>=8);
 const key=quote(i.id)+'::uuid';
 assert.equal(query('SELECT public.clube_partner_coupon_purchase_source_v1_848('+key+')'),'t',
  'Only a prospective, actually-paid partner package can split the financial backing');
 const replay=JSON.parse(query('SELECT public.clube_coupon_paid_net_proceeds_verify('+
  key+','+quote(i.provider_order_id)+',820,'+quote(i.net_proceeds_reference)+')::text'));
 assert.equal(replay.ok,true);
 assert.equal(replay.replayed,true);
 let conflict=null;
 try{query('SELECT public.clube_coupon_paid_net_proceeds_verify('+
    key+','+quote(i.provider_order_id)+',821,'+quote(i.net_proceeds_reference)+')');}
 catch(e){conflict=String(e.stderr||e.message);}
 assert.match(String(conflict),/COUPON_NET_PROCEEDS_REPLAY_CONFLICT/,
  'Never quietly rewrite a historically verified PSP net receipt');
}
assert.equal(query("SELECT COUNT(*) FROM public.clube_coupon_paid_invoices "+
 "WHERE funding_mode_v1_846='partner_funded' AND sponsor_covered_cents<>0"),'0');
assert.equal(query("SELECT COUNT(*) FROM public.clube_coupon_paid_invoices "+
 "WHERE funding_mode_v1_846='partner_funded' AND net_proceeds_cents>=coupon_face_cents*coupons_per_pack"),'0',
 'The tests must exercise a true discounted coupon package, not an artificial fully-backed invoice');
assert.equal(query("SELECT COUNT(*) FROM public.platform_receivables r "+
 "JOIN public.clube_partner_coupon_order_uses_v1_846 c ON c.order_id=r.order_id "+
 "WHERE r.platform_fee_bps<>c.fee_bps_snapshot OR "+
 "r.platform_fee_cents<>floor(c.net_cents::numeric*c.fee_bps_snapshot/10000)::integer"),'0',
 'Fee must be computed from the merchant net order, never the face value of purchased coupons');
assert.equal(query("SELECT COUNT(*) FROM public.merchant_cashback_reimbursements r "+
 "JOIN public.clube_partner_coupon_order_uses_v1_846 c ON c.order_id=r.order_id"),'0',
 'A coupon financed by a merchant must never become a TAMÃO compensation debt');
assert.equal(query("SELECT has_function_privilege('authenticated',"+
 "'public.clube_partner_coupon_purchase_source_v1_848(uuid)','EXECUTE')"),'f');
assert.equal(query("SELECT has_function_privilege('service_role',"+
 "'public.clube_partner_coupon_purchase_source_v1_848(uuid)','EXECUTE')"),'t');
assert.equal(query("SELECT public.clube_partner_coupon_purchase_source_v1_848(id) "+
 "FROM public.clube_coupon_paid_invoices WHERE funding_mode_v1_846='platform_reimbursed' LIMIT 1"),'f',
 'Old coupons are not retroactively reclassified as merchant-funded');
console.log('PASS #848: R$8.90 paid package, R$8.20 independently audited provider proceeds, R$15 merchant discount, net 8% fee, zero reimbursement and immutable PSP net.');
