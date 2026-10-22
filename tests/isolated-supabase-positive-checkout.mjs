import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

// Positive quote -> checkout -> read in a DISPOSABLE local Supabase stack.
// Synthetic cash-on-delivery only. No billing provider, Pix or paid rewards.
assert.equal(process.env.CI,'true');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const raw=execFileSync('supabase',['status','-o','env'],{
  encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']
});
const vars=Object.fromEntries(raw.split('\n').map(line=>{
  const m=line.match(/^([A-Z_]+)=(.*)$/);
  return m?[m[1],m[2].replace(/^["']|["']$/g,'')]:null;
}).filter(Boolean));
const base=vars.API_URL||vars.SUPABASE_URL||'';
const anon=vars.ANON_KEY||vars.SUPABASE_ANON_KEY||'';
const service=vars.SERVICE_ROLE_KEY||vars.SUPABASE_SERVICE_ROLE_KEY||'';
assert.match(base,/^http:\/\/(?:127\.0\.0\.1|localhost):54321\/?$/);
assert.ok(anon.length>25&&service.length>25);
const sql=command=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
 '--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet',
 '--command='+command
],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},
 timeout:60000,stdio:['ignore','pipe','pipe']}).trim();
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const adminHeaders={
 apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'
};
async function createActor(kind){
 const email='tamao-'+kind+'-'+randomUUID()+'@example.com';
 const password='Ephemeral!'+randomUUID();
 const res=await fetch(base+'/auth/v1/admin/users',{
  method:'POST',headers:adminHeaders,
  body:JSON.stringify({email,password,email_confirm:true}),
  signal:AbortSignal.timeout(30000)
 });
 assert.ok([200,201].includes(res.status),'local Auth create user HTTP '+res.status);
 const user=await res.json();
 assert.match(user.id,/^[0-9a-f-]{36}$/i);
 const login=await fetch(base+'/auth/v1/token?grant_type=password',{
  method:'POST',
  headers:{apikey:anon,'Content-Type':'application/json'},
  body:JSON.stringify({email,password}),
  signal:AbortSignal.timeout(30000)
 });
 assert.equal(login.status,200,'real local Auth login '+kind);
 const session=await login.json();
 assert.equal(session.user?.id,user.id);
 return {id:user.id,token:session.access_token};
}
const buyer=await createActor('buyer');
const owner=await createActor('owner');
const outsider=await createActor('outsider');
const merchantId='00000000-0000-4000-8000-000000000026';
const cnpj='00000000000000'; // explicit fictitious test identifier, never a genuine verification
const postalCode='97300000';
const create=[
// EVERY statement targets localhost PostgreSQL, destroyed after this job.
'BEGIN;',
"UPDATE public.platform_launch_control SET commerce_enabled=true,operation_mode='LIVE',enabled_at=clock_timestamp(),enabled_by="+q(owner.id)+"::uuid,portals_source_sha=repeat('f',40),mode_source_sha=repeat('f',40),customer_portal_ok=true,merchant_portal_ok=true,admin_portal_ok=true WHERE singleton=true;",
"INSERT INTO public.market_cities(state,city_key,city_name,commerce_enabled,activated_at) VALUES('RS',public.market_city_key('São Gabriel'),'São Gabriel',true,clock_timestamp()) ON CONFLICT(state,city_key) DO UPDATE SET commerce_enabled=true,admin_paused=false;",
"INSERT INTO public.postal_code_validation_cache(postal_code,city,state,provider,service_area_allowed,street,neighborhood) VALUES("+q(postalCode)+",'São Gabriel','RS','viacep',true,'Rua Ficticia CI','Centro') ON CONFLICT(postal_code) DO UPDATE SET service_area_allowed=true,verified_at=clock_timestamp(),street=excluded.street;",
"INSERT INTO public.merchants(id,name,cnpj,status,online,accepts_citywide,last_seen_at,delivery_fee_cents,delivery_fee_confirmed_at) VALUES("+q(merchantId)+"::uuid,'Revenda Simulada CI',"+q(cnpj)+",'pending',false,true,clock_timestamp(),400,clock_timestamp());",
"INSERT INTO public.merchant_members(merchant_id,user_id,member_role,active) VALUES("+q(merchantId)+"::uuid,"+q(owner.id)+"::uuid,'owner',true);",
"INSERT INTO public.merchant_business_details(merchant_id,legal_name,trade_name,responsible_name,phone,whatsapp,postal_code,city,state,address_text) VALUES("+q(merchantId)+"::uuid,'Empresa Simulada CI','Revenda Simulada CI','Titular Sintetico','11999999999','11999999999',"+q(postalCode)+",'São Gabriel','RS','Rua Ficticia CI, 10');",
"INSERT INTO public.merchant_compliance(merchant_id,cnpj_status,cnpj_verified_at,anp_status) VALUES("+q(merchantId)+"::uuid,'verified',clock_timestamp(),'not_required');",
"INSERT INTO public.merchant_representation_reviews(merchant_id,owner_user_id,merchant_cnpj,authority_kind,evidence_reference,verified_by,expires_at) VALUES("+q(merchantId)+"::uuid,"+q(owner.id)+"::uuid,"+q(cnpj)+",'legal_representative','CI-LOCAL-TEST-NO-REAL-DOCUMENT',"+q(owner.id)+"::uuid,clock_timestamp()+interval '1 day');",
"INSERT INTO public.merchant_payment_methods(merchant_id,payment_method,active) VALUES("+q(merchantId)+"::uuid,'cash',true);",
"INSERT INTO public.merchant_payment_routes(merchant_id,payment_method,provider,channel,verification_mode,active) VALUES("+q(merchantId)+"::uuid,'cash','manual','delivery','merchant_confirmed',true);",
"INSERT INTO public.catalog_items(merchant_id,product_code,product_name,price_cents,min_price_cents,max_price_cents,available_stock,active,price_confirmed_at) VALUES("+q(merchantId)+"::uuid,'CHARCOAL2','Carvao Simulado CI',1800,1800,1800,5,true,clock_timestamp());",
"UPDATE public.merchants SET status='active',online=true WHERE id="+q(merchantId)+"::uuid;",
'COMMIT;'
].join('\n');
sql(create);
assert.equal(sql('SELECT public.merchant_basket_compliance_current('+q(merchantId)+"::uuid,ARRAY['CHARCOAL2']::text[])"),'t');
assert.ok(sql("SELECT "+q(merchantId)+"::uuid=ANY(public.market_city_offer_scope('São Gabriel','RS'))")==='t','synthetic merchant must pass the REAL city offer scope');
const quoteCmd="SELECT public.create_quote_snapshot_v3("+
 q(buyer.id)+"::uuid,"+q(merchantId)+"::uuid,"+q(postalCode)+
 ",'10',400,25,45,clock_timestamp()+interval '5 minutes',"+
 "'[{\"product_code\":\"CHARCOAL2\",\"quantity\":1,\"unit_price_cents\":1800}]'::jsonb,"+
 "repeat('e',64));";
const quote=JSON.parse(sql(quoteCmd));
assert.match(quote.quoteId,/^[0-9a-f-]{36}$/i);
assert.equal(quote.grossTotalCents,2200);
sql("UPDATE public.quotes SET payment_method_requested='cash',payment_timing_requested='on_delivery' WHERE id="+q(quote.quoteId)+"::uuid;");
const idempotency='ci-http-checkout-'+randomUUID();
const request={
 quoteId:quote.quoteId,paymentMethod:'cash',useCashback:false,
 customerPhone:'11999999999'
};
async function call(slug,token,body,extra={}){
 const res=await fetch(base+'/functions/v1/'+slug,{
  method:'POST',
  headers:{apikey:anon,Authorization:'Bearer '+token,
   Origin:'http://localhost:5173','Content-Type':'application/json',...extra},
  body:JSON.stringify(body),signal:AbortSignal.timeout(45000)
 });
 return {status:res.status,body:await res.json()};
}
const first=await call('create-order',buyer.token,request,{'Idempotency-Key':idempotency});
assert.equal(first.status,201,'checkout error: '+JSON.stringify(first.body).slice(0,500));
assert.match(first.body.orderId,/^[0-9a-f-]{36}$/i);
assert.equal(first.body.status,'OFFERED_TO_MERCHANT');
const replay=await call('create-order',buyer.token,request,{'Idempotency-Key':idempotency});
assert.equal(replay.status,201,'checkout idempotent retry');
assert.equal(replay.body.orderId,first.body.orderId);
assert.equal(sql('SELECT count(*) FROM public.orders'),'1');
assert.equal(sql("SELECT count(*) FROM public.action_requests WHERE action_name='create-order'"),'1');
assert.equal(sql("SELECT consumed_at IS NOT NULL FROM public.quotes WHERE id="+q(quote.quoteId)+"::uuid"),'t');
const own=await call('get-order',buyer.token,{orderId:first.body.orderId});
assert.equal(own.status,200,'own get-order: '+JSON.stringify(own.body).slice(0,500));
assert.equal(own.body.role,'customer');
assert.equal(own.body.status,'OFFERED_TO_MERCHANT');
assert.equal(own.body.items?.length,1);
const blocked=await call('get-order',outsider.token,{orderId:first.body.orderId});
assert.equal(blocked.status,404);
assert.equal(blocked.body.error,'ORDER_NOT_FOUND');

const merchantView=await call('merchant-orders',owner.token,{merchantId});
assert.equal(merchantView.status,200,'merchant dashboard: '+JSON.stringify(merchantView.body).slice(0,420));
assert.equal(merchantView.body.merchant?.merchantId,merchantId);
const offered=merchantView.body.orders?.find(x=>x.orderId===first.body.orderId);
assert.ok(offered,'the new order must be visible in the authenticated merchant panel');
assert.equal(offered.status,'OFFERED_TO_MERCHANT');
assert.equal(offered.addressVisible,false,'pre-accept PII remains hidden');
const outsiderMerchant=await call('merchant-orders',outsider.token,{merchantId});
assert.equal(outsiderMerchant.status,403);
assert.equal(outsiderMerchant.body.error,'NO_MERCHANT_ACCESS');
const actionKey='ci-merchant-accept-'+randomUUID();
const acceptBody={orderId:first.body.orderId,action:'accept',expectedVersion:own.body.version};
const accepted=await call('merchant-action',owner.token,acceptBody,{'Idempotency-Key':actionKey});
assert.equal(accepted.status,200,'merchant accept: '+JSON.stringify(accepted.body).slice(0,420));
assert.equal(accepted.body.status,'PREPARING');
assert.equal(accepted.body.accepted,true,'merchant acceptance must lock stock');
const acceptReplay=await call('merchant-action',owner.token,acceptBody,{'Idempotency-Key':actionKey});
assert.equal(acceptReplay.status,200,'merchant accept idempotent replay');
const nowCustomer=await call('get-order',buyer.token,{orderId:first.body.orderId});
assert.equal(nowCustomer.status,200);
assert.equal(nowCustomer.body.status,'PREPARING');
assert.equal(nowCustomer.body.version,own.body.version+1);
assert.equal(sql('SELECT count(*) FROM public.orders'),'1','accepting cannot duplicate order');
assert.equal(sql("SELECT available_stock FROM public.catalog_items WHERE merchant_id="+q(merchantId)+"::uuid AND product_code='CHARCOAL2'"),'4','one item must be reserved exactly once');
assert.equal(sql("SELECT count(*) FROM public.order_events WHERE order_id="+q(first.body.orderId)+"::uuid AND event_type='MERCHANT_ACCEPTED'"),'1','replay cannot duplicate acceptance event');

assert.equal(sql('SELECT count(*) FROM public.wallet_entries'),'0');
assert.equal(sql('SELECT count(*) FROM public.merchant_billing_payment_events'),'0');
console.log('PASS: LOCAL quote -> checkout -> replay -> buyer get-order -> merchant dashboard -> accept/replay -> buyer new state; IDOR blocked, cash only, zero PSP/rewards.');
