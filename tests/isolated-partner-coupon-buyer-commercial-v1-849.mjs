import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.CI,'true','Only an isolated Supabase container');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const sql=query=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
 '--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet',
 '--command='+query
],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},timeout:90000,
 stdio:['ignore','pipe','pipe']}).trim();
const before=Number(sql("select count(*) from public.clube_coupon_paid_invoices where package_key='partner_general_3x5_849'"));
assert.equal(before,0,'No partner program commercial invoices');
assert.equal(sql("select (public.clube_partner_coupon_sale_readiness_v1_849('partner_general_3x5_849')->>'ready')"),'false');
const fixture=execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
 '--no-psqlrc','--set=ON_ERROR_STOP=1',
 '--file=tests/fixtures/partner-coupon-buyer-commercial-v1-849.sql'
],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},timeout:90000,
 stdio:['ignore','pipe','pipe']});
assert.match(fixture,/ROLLBACK/);
assert.equal(sql("select count(*) from public.clube_partner_coupon_sale_agreements_v1_849"),'0',
 'Only synthetic disposable buyer/seller contract tested in ROLLBACK');
const config=Object.fromEntries(execFileSync('supabase',['status','-o','env'],{
 encoding:'utf8',timeout:30000
}).split('\n').map(x=>{
 const m=x.match(/^([A-Z_]+)=(.*)$/);
 return m?[m[1],m[2].replace(/^["']|["']$/g,'')]:null;
}).filter(Boolean));
const api=config.API_URL||config.SUPABASE_URL||'';
const anon=config.ANON_KEY||config.SUPABASE_ANON_KEY||'';
const service=config.SERVICE_ROLE_KEY||config.SUPABASE_SERVICE_ROLE_KEY||'';
assert.match(api,/^http:\/\/(?:127\.0\.0\.1|localhost):54321\/?$/);
assert.ok(anon.length>25&&service.length>25);
const email='ci-coupon-buyer-'+randomUUID()+'@example.invalid';
const password='LocalBuyer!'+randomUUID();
const admin=await fetch(api+'/auth/v1/admin/users',{
 method:'POST',
 headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},
 body:JSON.stringify({email,password,email_confirm:true}),
 signal:AbortSignal.timeout(30000)
});
assert.ok([200,201].includes(admin.status),'GoTrue real synthetic buyer');
const identity=await admin.json();
assert.match(String(identity.id||''),/^[0-9a-f-]{36}$/);
const session=await fetch(api+'/auth/v1/token?grant_type=password',{
 method:'POST',headers:{apikey:anon,'Content-Type':'application/json'},
 body:JSON.stringify({email,password}),signal:AbortSignal.timeout(30000)
});
assert.equal(session.status,200);
const token=(await session.json()).access_token;
assert.ok(token.length>100);
async function post(action,payload={}){
 const r=await fetch(api+'/functions/v1/coupon-credit-pix',{
  method:'POST',headers:{
   apikey:anon,Authorization:'Bearer '+token,
   Origin:'https://tamao.com.br','Content-Type':'application/json'
  },
  body:JSON.stringify({action,...payload}),signal:AbortSignal.timeout(45000)
 });
 const txt=await r.text();
 let body;try{body=JSON.parse(txt)}catch{throw Error(action+' invalid Edge JSON '+txt.slice(0,150))}
 return {status:r.status,body};
}
const offers=await post('partner-catalog');
assert.equal(offers.status,200,'Unreleased partner catalogue is an empty safe success');
assert.equal(offers.body?.source,'clube_partner_coupon_catalog_v1_849');
assert.equal(offers.body?.ok,true);
assert.equal(offers.body?.couponSalesEnabled,false);
assert.deepEqual(offers.body?.packages,[]);
const rejected=await post('partner-purchase',{
 packageKey:'partner_general_3x5_849',
 requestId:randomUUID(),termsAccepted:true,
 termsVersion:'clube_partner_coupon_terms_v1_846'
});
assert.equal(rejected.status,423,'No partner sale or MercadoPago Pix before real supply and commercial authorization');
assert.equal(rejected.body?.error,'PARTNER_COUPON_NO_ELIGIBLE_SUPPLY');
assert.equal(rejected.body?.pixPayable,false);
assert.equal(Number(sql("select count(*) from public.clube_coupon_paid_invoices where package_key='partner_general_3x5_849'")),before);
assert.equal(sql("select count(*) from public.clube_partner_coupon_sale_agreements_v1_849"),'0');
const legacy=await post('catalog');
assert.equal(legacy.status,200);
assert.equal(legacy.body?.source,'clube_paid_catalog_v1_807',
 'Owner-funded coupon catalogue remains independent and functioning');
console.log('PASS #849: admin-only immutable buyer contract and seller attestation, real Auth/Edge partner catalogue empty, PIX forbidden, zero invoices and untouched owner coupon catalogue.');
