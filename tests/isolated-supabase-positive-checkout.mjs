import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {verifyIsolatedLivePortals} from './isolated-live-portal-browser.mjs';
import {startOwnerLocalDemo} from '../scripts/owner-local-demo-server.mjs';
import {verifyOwnerLocalDemoBrowser} from './owner-local-demo-browser.mjs';
import {verifyIsolatedPrivilegedRpc} from './isolated-discovery-privileged-rpc.mjs';

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
 return {id:user.id,token:session.access_token,session};
}
const buyer=await createActor('buyer');
const owner=await createActor('owner');
const outsider=await createActor('outsider');
const adminActor=await createActor('admin');
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
"INSERT INTO public.catalog_items(merchant_id,product_code,product_name,price_cents,min_price_cents,max_price_cents,available_stock,active,price_confirmed_at) VALUES("+q(merchantId)+"::uuid,'P13','Gas GLP P13 Somente CI',11590,11590,11590,5,true,clock_timestamp());",
"INSERT INTO public.catalog_items(merchant_id,product_code,product_name,price_cents,min_price_cents,max_price_cents,available_stock,active,price_confirmed_at) VALUES("+q(merchantId)+"::uuid,'CHARCOAL2','Carvao Simulado CI',1800,1800,1800,5,true,clock_timestamp());",
"INSERT INTO public.catalog_items(merchant_id,product_code,product_name,price_cents,min_price_cents,max_price_cents,available_stock,active,price_confirmed_at) VALUES("+q(merchantId)+"::uuid,'WATER20','Agua 20 L Simulada CI',1590,1590,1590,6,true,clock_timestamp());",
"UPDATE public.merchants SET status='active',online=true WHERE id="+q(merchantId)+"::uuid;",
'COMMIT;'
].join('\n');
sql(create);

// Full-migration RLS behavior with *real local Auth actors*: an unpublished
// professional detail belongs to the owner only. Run the fixture inside a
// rollback-only transaction, without changing production or checkout data.
const privateListingId=randomUUID();
const privateDraft=sql(`BEGIN;
INSERT INTO public.discovery_listings(
 id,owner_id,vertical,status,title,description,state_code,city_key,city_name,whatsapp_e164
) VALUES (
 ${q(privateListingId)}::uuid,${q(owner.id)}::uuid,'professionals','draft',
 'Teste privado CI','Detalhes privados e não publicados de teste CI',
 'RS','sao-gabriel','São Gabriel','+5555999999999'
);
INSERT INTO public.discovery_professional_details(listing_id,occupation,service_area)
VALUES(${q(privateListingId)}::uuid,'Eletricista','Zona de teste CI');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',${q(owner.id)},true);
SELECT count(*) FROM public.discovery_professional_details
 WHERE listing_id=${q(privateListingId)}::uuid;
SELECT set_config('request.jwt.claim.sub',${q(buyer.id)},true);
SELECT count(*) FROM public.discovery_professional_details
 WHERE listing_id=${q(privateListingId)}::uuid;
UPDATE public.discovery_professional_details SET occupation='Acesso indevido'
 WHERE listing_id=${q(privateListingId)}::uuid;
SELECT count(*) FROM public.discovery_professional_details
 WHERE listing_id=${q(privateListingId)}::uuid;
SET LOCAL ROLE anon;
SELECT count(*) FROM public.discovery_professional_details
 WHERE listing_id=${q(privateListingId)}::uuid;
ROLLBACK;`);
assert.deepEqual(privateDraft.split(/\s+/).filter(line=>/^[01]$/.test(line)),
 ['1','0','0','0'],
 'owner may read private detail; buyer may neither read nor update, anon may not read');
assert.equal(sql("SELECT count(*) FROM public.discovery_listings WHERE id="+q(privateListingId)+"::uuid"),'0',
 'cross-user test data must always roll back');
// This temporary admin membership exists only in the local disposable database.
sql("INSERT INTO public.platform_admins(user_id,admin_role,active) VALUES("+q(adminActor.id)+"::uuid,'superadmin',true);");
assert.equal(sql("SELECT count(*) FROM public.platform_admins WHERE user_id="+q(adminActor.id)+"::uuid AND active"),'1');
await verifyIsolatedPrivilegedRpc({base,anon,sql,q,owner,buyer,outsider,adminActor});
// Outsider is a *local-only* citizen referrer. This is no bank identity or
// real commission; the referral code is accepted through canonical checkout.
const promoCode='REFCI123';
sql("UPDATE public.profiles SET referral_code="+q(promoCode)+" WHERE user_id="+q(outsider.id)+"::uuid;");
assert.equal(sql("SELECT referral_code FROM public.profiles WHERE user_id="+q(outsider.id)+"::uuid"),promoCode,'local Auth user already has an auto-created profile');
// Synthetic regulatory evidence exists exclusively inside disposable CI.
assert.equal(sql('SELECT public.merchant_basket_compliance_current('+q(merchantId)+"::uuid,ARRAY['P13']::text[])"),'f',
 'GLP P13 must be BLOCKED before ANP validation is current');
assert.equal(sql('SELECT public.merchant_basket_compliance_current('+q(merchantId)+"::uuid,ARRAY['WATER20']::text[])"),'t',
 'water can be bought without ANP if CNPJ/owner are otherwise valid');
// This simulated ANP change occurs ONLY in ephemeral Postgres. No production
// revenda, CNPJ or regulatory documentation is ever changed.
sql("UPDATE public.merchant_compliance SET anp_status='verified',anp_verified_at=clock_timestamp(),anp_reference='CI-LOCAL-FAKE-ANP-NOT-REAL' WHERE merchant_id="+q(merchantId)+"::uuid;");
assert.equal(sql('SELECT public.merchant_anp_verification_current('+q(merchantId)+"::uuid)"),'t');
assert.equal(sql('SELECT public.merchant_basket_compliance_current('+q(merchantId)+"::uuid,ARRAY['P13']::text[])"),'t',
 'real GLP checkout must become eligible only after ephemeral ANP evidence');
assert.ok(sql("SELECT "+q(merchantId)+"::uuid=ANY(public.market_city_offer_scope('São Gabriel','RS'))")==='t','synthetic merchant must pass the REAL city offer scope');
const quoteCmd="SELECT public.create_quote_snapshot_v3("+
 q(buyer.id)+"::uuid,"+q(merchantId)+"::uuid,"+q(postalCode)+
 ",'10',400,25,45,clock_timestamp()+interval '5 minutes',"+
 "'[{\"product_code\":\"P13\",\"quantity\":1,\"unit_price_cents\":11590}]'::jsonb,"+
 "repeat('e',64));";
const quote=JSON.parse(sql(quoteCmd));
assert.match(quote.quoteId,/^[0-9a-f-]{36}$/i);
assert.equal(quote.grossTotalCents,11990,'P13 115,90 + entrega 4,00');
sql("UPDATE public.quotes SET payment_method_requested='cash',payment_timing_requested='on_delivery' WHERE id="+q(quote.quoteId)+"::uuid;");
const idempotency='ci-http-checkout-'+randomUUID();
const request={
 quoteId:quote.quoteId,paymentMethod:'cash',useCashback:false,
 referralCode:promoCode,customerPhone:'11999999999'
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
// Reuse the actual merchant-ops / merchant-orders Auth and idempotency path.
// This is a disposable owner's self-declaration, NOT regulatory verification.
const profileBefore=await call('merchant-orders',owner.token,{merchantId});
assert.equal(profileBefore.status,200,'owner snapshot before business profile update');
assert.equal(profileBefore.body.merchant?.businessDetails?.city,'São Gabriel');
const businessUpdate={
 merchantId,action:'update-business-details',
 expectedUpdatedAt:profileBefore.body.merchant.configUpdatedAt,
 legalName:'Empresa Ficticia CI',tradeName:'Revenda Ficticia CI',
 responsibleName:'Proprietario Sintetico',phone:'11988887777',whatsapp:'11988887777',
 postalCode:'97300000',city:'São Gabriel',state:'RS',
 addressText:'Rua Ficticia CI numero 40'
};
// An already-approved merchant must not repurpose old compliance/representation
// evidence by changing its legal identity or operating location.
const reviewedEdit=await call('merchant-ops',owner.token,businessUpdate,
 {'Idempotency-Key':'ci-reviewed-profile-'+randomUUID()});
assert.equal(reviewedEdit.status,409,'active merchant identity edits require independent review');
assert.equal(reviewedEdit.body.error,'MERCHANT_BUSINESS_REVIEW_REQUIRED');
assert.equal(sql("SELECT city FROM public.merchant_business_details WHERE merchant_id="+q(merchantId)+"::uuid"),'São Gabriel');
// Local-only regression: merchant starts in pending mode to simulate genuine
// preapproval self-service. Restore approved state BEFORE quote checkout.
sql("UPDATE public.merchants SET status='pending',online=false,updated_at=clock_timestamp() WHERE id="+q(merchantId)+"::uuid");
const preapproval=await call('merchant-orders',owner.token,{merchantId});
assert.equal(preapproval.status,200);
businessUpdate.expectedUpdatedAt=preapproval.body.merchant.configUpdatedAt;
const illegalAddress=await call('merchant-ops',buyer.token,businessUpdate,
 {'Idempotency-Key':'ci-profile-buyer-'+randomUUID()});
assert.equal(illegalAddress.status,403,'non-member cannot change merchant company data');
assert.equal(illegalAddress.body.error,'MERCHANT_ACCESS_DENIED');
const invalidAddress=await call('merchant-ops',owner.token,
 {...businessUpdate,postalCode:'wrong'},
 {'Idempotency-Key':'ci-profile-invalid-'+randomUUID()});
assert.equal(invalidAddress.status,400,'address validation rejects malformed CEP');
assert.equal(invalidAddress.body.error,'INVALID_BUSINESS_PROFILE');
const profileKey='ci-merchant-profile-'+randomUUID();
const acceptedProfile=await call('merchant-ops',owner.token,businessUpdate,
 {'Idempotency-Key':profileKey});
assert.equal(acceptedProfile.status,200,'authenticated owner save: '+JSON.stringify(acceptedProfile.body).slice(0,450));
assert.equal(acceptedProfile.body.pendingAdministrativeVerification,true);
const repeatedProfile=await call('merchant-ops',owner.token,businessUpdate,
 {'Idempotency-Key':profileKey});
assert.equal(repeatedProfile.status,200,'identical idempotent replay must be safe');
assert.deepEqual(repeatedProfile.body,acceptedProfile.body);
const profileAfter=await call('merchant-orders',owner.token,{merchantId});
assert.equal(profileAfter.status,200);
assert.equal(profileAfter.body.merchant?.businessDetails?.addressText,businessUpdate.addressText);
assert.equal(profileAfter.body.merchant?.businessDetails?.responsibleName,businessUpdate.responsibleName);
assert.equal(profileAfter.body.merchant?.businessDetails?.postalCode,'97300000');
assert.equal(sql("SELECT count(*) FROM public.action_requests WHERE action_name='merchant-config:update-business-details' AND completed_at IS NOT NULL"),'1');
assert.equal(sql("SELECT status||':'||online::text FROM public.merchants WHERE id="+q(merchantId)+"::uuid"),'pending:false',
 'self-declaration must not approve the merchant or bring it online');
assert.equal(sql("SELECT count(*) FROM public.merchant_representation_reviews WHERE merchant_id="+q(merchantId)+"::uuid"),'1',
 'business data update must not overwrite representation review');
sql("UPDATE public.merchants SET status='active',online=true,updated_at=clock_timestamp() WHERE id="+q(merchantId)+"::uuid");
assert.equal(sql("SELECT status||':'||online::text FROM public.merchants WHERE id="+q(merchantId)+"::uuid"),'active:true',
 'restore disposable merchant before checkout smoke');
console.log('PASS: pending owner saves a business profile exactly once; active owner edit requires review; buyer/invalid input refused; checkout fixture restored.');

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
// Exercise the canonical Admin API with real local Auth, not a bypass.
const rejectedAdmin=await call('admin-ops',buyer.token,{action:'summary'});
assert.equal(rejectedAdmin.status,403,'buyers cannot read Admin summary');
assert.equal(rejectedAdmin.body.error,'ADMIN_ACCESS_DENIED');
const authorizedAdmin=await call('admin-ops',adminActor.token,{action:'summary'});
assert.equal(authorizedAdmin.status,200,'Admin HTTP summary: '+JSON.stringify(authorizedAdmin.body).slice(0,420));
assert.ok(authorizedAdmin.body.controlOrders?.some(o=>o.id===first.body.orderId),
 'authorized Admin must see the same real local accepted order');
// Unauthorized customer cannot write an administrative note either.
const forbiddenNote=await call('admin-ops',buyer.token,{
 action:'order-control',orderId:first.body.orderId,controlAction:'note',
 expectedVersion:nowCustomer.body.version,reason:'CI buyer attempted forged Admin note'
},{'Idempotency-Key':'ci-buyer-forged-admin-'+randomUUID()});
assert.equal(forbiddenNote.status,403);
assert.equal(forbiddenNote.body.error,'ADMIN_ACCESS_DENIED');
assert.equal(sql("SELECT count(*) FROM public.order_events WHERE order_id="+q(first.body.orderId)+"::uuid AND event_type='ADMIN_NOTE'"),'0');
// Observe the SAME local persisted order through the canonical browser UI.
await verifyIsolatedLivePortals({api:base,anon,buyer,owner,adminActor,orderId:first.body.orderId,merchantId,captureEvidence:true});
assert.equal(sql("SELECT count(*) FROM public.order_events WHERE order_id="+q(first.body.orderId)+"::uuid AND actor_user_id="+q(adminActor.id)+"::uuid AND event_type='ADMIN_NOTE'"),'1',
 'Admin note button must append a single legitimate order audit event');
assert.equal(sql("SELECT count(*) FROM public.platform_admin_audit WHERE actor_user_id="+q(adminActor.id)+"::uuid AND action='order-control-note' AND target_id="+q(first.body.orderId)),'1',
 'Admin note must be recorded in the platform audit log');
assert.equal(sql("SELECT count(*) FROM public.action_requests WHERE user_id="+q(adminActor.id)+"::uuid AND action_name='admin-order:note' AND completed_at IS NOT NULL"),'1',
 'Admin note must complete exactly one idempotent action');
assert.equal(sql("SELECT status FROM public.orders WHERE id="+q(first.body.orderId)+"::uuid"),'PREPARING',
 'a note must not change customer-visible order state');

assert.equal(sql('SELECT count(*) FROM public.orders'),'1','accepting cannot duplicate order');
assert.equal(sql("SELECT available_stock FROM public.catalog_items WHERE merchant_id="+q(merchantId)+"::uuid AND product_code='P13'"),'4','one item must be reserved exactly once');
assert.equal(sql("SELECT count(*) FROM public.order_events WHERE order_id="+q(first.body.orderId)+"::uuid AND event_type='MERCHANT_ACCEPTED'"),'1','replay cannot duplicate acceptance event');

assert.equal(sql('SELECT count(*) FROM public.wallet_entries'),'0');
assert.equal(sql('SELECT count(*) FROM public.merchant_billing_payment_events'),'0');

// The official dispatch must generate a secret PIN; only the customer can
// read it through get-order. Payment is LOCAL fictitious cash-on-delivery.
const orderId=first.body.orderId;
const dispatchBody={orderId,action:'dispatch',expectedVersion:nowCustomer.body.version};
const dispatchKey='ci-dispatch-'+randomUUID();
const dispatched=await call('merchant-action',owner.token,dispatchBody,{'Idempotency-Key':dispatchKey});
assert.equal(dispatched.status,200,'dispatch: '+JSON.stringify(dispatched.body).slice(0,420));
assert.equal(dispatched.body.status,'OUT_FOR_DELIVERY');
assert.equal(dispatched.body.version,nowCustomer.body.version+1);
const dispatchReplay=await call('merchant-action',owner.token,dispatchBody,{'Idempotency-Key':dispatchKey});
assert.equal(dispatchReplay.status,200,'dispatch idempotent replay');
assert.deepEqual(dispatchReplay.body,dispatched.body);
assert.equal(sql("SELECT count(*) FROM public.order_events WHERE order_id="+q(orderId)+"::uuid AND event_type='OUT_FOR_DELIVERY'"),'1');
const buyerDispatch=await call('get-order',buyer.token,{orderId});
assert.equal(buyerDispatch.status,200);
assert.equal(buyerDispatch.body.status,'OUT_FOR_DELIVERY');
const deliveryPin=buyerDispatch.body.deliveryPin;
assert.match(deliveryPin,/^[0-9]{4}$/,'only buyer learns the PIN from own authenticated API');
const merchantDispatch=await call('get-order',owner.token,{orderId});
assert.equal(merchantDispatch.status,200);
assert.equal(merchantDispatch.body.role,'merchant');
assert.equal(merchantDispatch.body.deliveryPin,null,'merchant must NOT read delivery PIN through get-order');
const outsiderDispatch=await call('get-order',outsider.token,{orderId});
assert.equal(outsiderDispatch.status,404,'outsider may not discover active delivery');

const arrivingBody={orderId,action:'arriving',expectedVersion:buyerDispatch.body.version};
const arrived=await call('merchant-action',owner.token,arrivingBody,
 {'Idempotency-Key':'ci-arriving-'+randomUUID()});
assert.equal(arrived.status,200,'arriving: '+JSON.stringify(arrived.body).slice(0,420));
assert.equal(arrived.body.status,'ARRIVING');
const buyerArriving=await call('get-order',buyer.token,{orderId});
assert.equal(buyerArriving.status,200);
assert.equal(buyerArriving.body.status,'ARRIVING');
assert.equal(buyerArriving.body.deliveryPin,deliveryPin,'PIN stays stable through arrival');

const wrongPin=deliveryPin==='0000'?'0001':'0000';
const wrongBody={orderId,pin:wrongPin,expectedVersion:buyerArriving.body.version,paymentConfirmed:true};
const wrongKey='ci-invalid-pin-'+randomUUID();
const wrong=await call('complete-delivery',owner.token,wrongBody,{'Idempotency-Key':wrongKey});
assert.equal(wrong.status,422,'wrong PIN must be rejected');
assert.equal(wrong.body.ok,false);
assert.equal(wrong.body.error,'INVALID_PIN');
const wrongReplay=await call('complete-delivery',owner.token,wrongBody,{'Idempotency-Key':wrongKey});
assert.equal(wrongReplay.status,422,'wrong PIN idempotent retry remains rejected');
const buyerAfterWrong=await call('get-order',buyer.token,{orderId});
assert.equal(buyerAfterWrong.status,200);
assert.equal(buyerAfterWrong.body.status,'ARRIVING','wrong PIN does not settle');
assert.equal(buyerAfterWrong.body.version,buyerArriving.body.version+1,'wrong PIN increments failure version exactly once');
assert.equal(sql("SELECT pin_failures FROM public.orders WHERE id="+q(orderId)+"::uuid"),'1');
assert.equal(sql("SELECT count(*) FROM public.order_events WHERE order_id="+q(orderId)+"::uuid AND event_type='PIN_FAILED'"),'1');

// E2E authorization at settlement: knowing the correct PIN is NOT a
// substitute for membership in the order's assigned merchant.
for(const [role,actor] of [['buyer',buyer],['unrelated referrer',outsider]]){
 const forbidden=await call('complete-delivery',actor.token,{
  orderId,pin:deliveryPin,expectedVersion:buyerAfterWrong.body.version,
  paymentConfirmed:true
 },{'Idempotency-Key':'ci-foreign-delivery-'+randomUUID()});
 assert.equal(forbidden.status,403,role+' must not settle an order even with its PIN');
 assert.equal(forbidden.body.error,'MERCHANT_ACCESS_DENIED');
 assert.equal(sql("SELECT status FROM public.orders WHERE id="+q(orderId)+"::uuid"),
  'ARRIVING','denied completion must not change the order status');
 assert.equal(sql("SELECT consumed_at IS NULL FROM public.order_delivery_secrets WHERE order_id="+q(orderId)+"::uuid"),
  't','denied completion must not consume the legitimate PIN');
}
const completeBody={orderId,pin:deliveryPin,
 expectedVersion:buyerAfterWrong.body.version,paymentConfirmed:true};
const completeKey='ci-complete-'+randomUUID();
const completed=await call('complete-delivery',owner.token,completeBody,{'Idempotency-Key':completeKey});
assert.equal(completed.status,200,'complete local cash delivery: '+JSON.stringify(completed.body).slice(0,480));
assert.equal(completed.body.ok,true);
assert.equal(completed.body.status,'SETTLED');
assert.equal(completed.body.paymentConfirmationMethod,'merchant_attestation',
 'only an in-runner merchant cash attestation, NOT an external PSP receipt');
const finalBuyer=await call('get-order',buyer.token,{orderId});
assert.equal(finalBuyer.status,200);
assert.equal(finalBuyer.body.status,'SETTLED');
assert.equal(finalBuyer.body.deliveryPin,null,'consumed PIN must never be exposed');
const foreignAfterSettlement=await call('get-order',outsider.token,{orderId});
assert.equal(foreignAfterSettlement.status,404,'settled orders must remain private from unrelated authenticated users');
assert.equal(foreignAfterSettlement.body.error,'ORDER_NOT_FOUND');

assert.equal(sql("SELECT consumed_at IS NOT NULL FROM public.order_delivery_secrets WHERE order_id="+q(orderId)+"::uuid"),'t');
assert.equal(sql('SELECT count(*) FROM public.orders'),'1');
for(const event of ['OUT_FOR_DELIVERY','ARRIVING','PIN_FAILED','PAYMENT_CONFIRMED','DELIVERED','SETTLED']){
 assert.equal(sql("SELECT count(*) FROM public.order_events WHERE order_id="+q(orderId)+"::uuid AND event_type="+q(event)),'1',
  'each actual transition should create exactly one '+event+' event');
}
// Existing financial hooks may legitimately append LOCAL rewards. Their
// exact values must remain unchanged on idempotent delivery replay.
const beforeReplay=sql("SELECT (SELECT count(*) FROM public.wallet_entries)::text || ':' || (SELECT count(*) FROM public.order_reward_grants)::text || ':' || (SELECT count(*) FROM public.order_events WHERE order_id="+q(orderId)+"::uuid)::text");
const completeReplay=await call('complete-delivery',owner.token,completeBody,{'Idempotency-Key':completeKey});
assert.equal(completeReplay.status,200,'completed order must replay safely');
assert.deepEqual(completeReplay.body,completed.body);
const afterReplay=sql("SELECT (SELECT count(*) FROM public.wallet_entries)::text || ':' || (SELECT count(*) FROM public.order_reward_grants)::text || ':' || (SELECT count(*) FROM public.order_events WHERE order_id="+q(orderId)+"::uuid)::text");
assert.equal(afterReplay,beforeReplay,'a repeated completion cannot duplicate any wallet/reward/event');
assert.equal(sql('SELECT count(*) FROM public.merchant_sale_payment_attempts'),'0',
 'no external provider checkout was created');
assert.equal(sql('SELECT count(*) FROM public.merchant_billing_payment_events'),'0',
 'no external billing payment was registered');
assert.equal(sql('SELECT count(*) FROM public.merchant_billing_provider_charges'),'0',
 'no Pix charge or payment link was issued');

// The LOCAL successful checkout and merchant-attested settlement must build
// a truthful internal unit-economics ledger. It is NOT proof of bank payout.
const qualified=sql("SELECT qualified_order_id="+q(orderId)+"::uuid FROM public.referrals WHERE referred_user_id="+q(buyer.id)+"::uuid AND referrer_user_id="+q(outsider.id)+"::uuid");
assert.equal(qualified,'t','real canonical checkout must attribute this buyer to their local referrer');
assert.equal(sql("SELECT count(*) FROM public.referrals WHERE referred_user_id="+q(buyer.id)+"::uuid"),'1');
const rewardRaw=sql("SELECT row_to_json(g)::text FROM public.order_reward_grants g WHERE g.order_id="+q(orderId)+"::uuid");
assert.ok(rewardRaw,'a settled local order must create exactly one reward grant');
const reward=JSON.parse(rewardRaw);
assert.equal(reward.referrer_user_id,outsider.id);
assert.ok(reward.platform_fee_cents>0,'local settlement must have a fee-backed incentive budget');
assert.ok(reward.referral_pending_cents>0,'local referral must have a positive pending incentive');
assert.ok(reward.cashback_cents>=0);
assert.equal(reward.platform_fee_cents,
 reward.variable_cost_reserve_cents+reward.cashback_cents+
 reward.referral_pending_cents+reward.platform_contribution_cents,
 'revenue must exactly fund cost reserve + incentives + contribution');
assert.ok(reward.platform_contribution_cents>=reward.minimum_contribution_cents,
 'platform keeps its floor contribution after paying for benefits');
assert.ok(new Date(reward.commission_available_at).getTime()>Date.now(),
 'pending referral must respect the configured hold period');
assert.equal(sql("SELECT count(*) FROM public.order_reward_grants WHERE order_id="+q(orderId)+"::uuid"),'1');
assert.equal(sql("SELECT count(*) FROM public.wallet_entries WHERE order_id="+q(orderId)+"::uuid AND user_id="+q(outsider.id)+"::uuid AND bucket='commission_pending' AND entry_type='referral_pending' AND amount_cents="+reward.referral_pending_cents),'1');
assert.equal(sql("SELECT count(*) FROM public.platform_receivables WHERE order_id="+q(orderId)+"::uuid AND platform_fee_cents="+reward.platform_fee_cents),'1',
 'fee must be booked as an internal receivable, not misrepresented as already paid');
assert.equal(sql("SELECT count(*) FROM public.platform_referral_payout_claims_v1_263"),'0',
 'pending commissions have NO payment proof or external payout claim');
// Independent retry of the existing canonical reward authority must be safe.
const regrant=JSON.parse(sql("SELECT public.grant_order_rewards("+q(orderId)+"::uuid)::text"));
assert.equal(regrant.alreadyGranted,true);
assert.equal(sql("SELECT count(*) FROM public.order_reward_grants WHERE order_id="+q(orderId)+"::uuid"),'1');
assert.equal(sql("SELECT count(*) FROM public.wallet_entries WHERE order_id="+q(orderId)+"::uuid AND bucket='commission_pending'"),'1');
console.log('PASS: local referral attributed and qualified; fee/benefit/contribution ledger reconciled; commission pending hold; no payout claim/PSP; regrant idempotent.');

// TEST THE NEXT FINANCIAL STATE USING THE EXACT CANONICAL RPC, NOT AN
// ARTIFICIAL "available" wallet insertion. Time manipulation below is local
// to the ephemeral Postgres runner (no production flags or payouts touched).
const holdHours=Number(sql("SELECT commission_hold_hours_snapshot FROM public.orders WHERE id="+q(orderId)+"::uuid"));
assert.ok(Number.isInteger(holdHours)&&holdHours>=24,'actual configured hold must remain nontrivial');
const holdWindow=JSON.parse(sql("SELECT json_build_object('settled',settled_at,'available',"+
 "(SELECT commission_available_at FROM public.order_reward_grants WHERE order_id="+q(orderId)+"::uuid))::text FROM public.orders WHERE id="+q(orderId)+"::uuid"));
const holdDelta=(new Date(holdWindow.available).getTime()-new Date(holdWindow.settled).getTime())/(60*60*1000);
assert.ok(Math.abs(holdDelta-holdHours)<0.002,
 'commission hold starts at real local settlement, never at order creation');
assert.equal(sql("SELECT risk_status FROM public.referral_reward_reviews WHERE order_id="+q(orderId)+"::uuid"),'clear',
 'synthetic referral should be risk-cleared before testing review gate');
assert.equal(sql("SELECT has_function_privilege('anon','public.process_reward_maturation()','EXECUTE')"),'f',
 'maturation function must stay unavailable to anonymous users');
assert.equal(sql("SELECT has_function_privilege('authenticated','public.process_reward_maturation()','EXECUTE')"),'f',
 'normal signed-in users must not directly release their own commissions');
const maturationCount=()=>Number(sql("SELECT (public.process_reward_maturation()->>'maturedCommissions')::integer"));
assert.equal(maturationCount(),0,'not-yet-due commission cannot mature');
assert.equal(sql("SELECT count(*) FROM public.wallet_entries WHERE order_id="+q(orderId)+"::uuid AND bucket='commission_available'"),'0',
 'a nonmatured commission is not available for payout');

// Advance ONLY this dummy grant's due date, not clock, global reward policy,
// or the underlying order's financial timestamps. Simulate risk review while
// due; the true worker must leave both pending and available balances alone.
sql("UPDATE public.order_reward_grants SET commission_available_at=clock_timestamp()-interval '1 hour' WHERE order_id="+q(orderId)+"::uuid;");
sql("UPDATE public.referral_reward_reviews SET risk_status='review_required',"+
 "risk_reasons='[\"ci_requires_review\"]'::jsonb WHERE order_id="+q(orderId)+"::uuid;");
assert.equal(maturationCount(),0,'risk-review-required commission stays blocked even after due');
assert.equal(sql("SELECT matured_at IS NULL FROM public.order_reward_grants WHERE order_id="+q(orderId)+"::uuid"),'t');
assert.equal(sql("SELECT count(*) FROM public.wallet_entries WHERE order_id="+q(orderId)+"::uuid AND bucket='commission_available'"),'0');

// The risk assessor for the synthetic transaction originally returned clear;
// restore that same local state without pretending a real operator approved a
// suspicious reward. Real reviewed claims must use existing Admin authority.
sql("UPDATE public.referral_reward_reviews SET risk_status='clear',risk_reasons='[]'::jsonb WHERE order_id="+q(orderId)+"::uuid;");
// The local merchant merely attested to receiving cash from the BUYER.
// TAMÃO has not yet received its fee. This is the critical funding gap.
assert.equal(sql("SELECT status FROM public.platform_receivables WHERE order_id="+q(orderId)+"::uuid"),'open',
 'delivery settlement must not count TAMÃO fee receivable as collected');
assert.equal(maturationCount(),0,'due, risk-cleared commission must stay pending while fee receivable is OPEN');
assert.equal(sql("SELECT count(*) FROM public.wallet_entries WHERE order_id="+q(orderId)+"::uuid AND bucket='commission_available'"),'0');
assert.equal(sql("SELECT matured_at IS NULL FROM public.order_reward_grants WHERE order_id="+q(orderId)+"::uuid"),'t',
 'maturation timestamp cannot advance without financial coverage');

// Fake payment proof ONLY inside the disposable runner, intentionally marked
// CI and NOT created through any PSP. Exercise the existing invoice lifecycle.
// Production must require its ordinary authorized admin reconciliation.
sql("UPDATE public.platform_receivables SET status='paid',paid_at=clock_timestamp(),resolved_by="+
 q(owner.id)+"::uuid,resolution_reference='ci-local-fee-record-not-bank-proof' "+
 "WHERE order_id="+q(orderId)+"::uuid AND status='open';");
assert.equal(sql("SELECT status FROM public.platform_receivables WHERE order_id="+q(orderId)+"::uuid"),'paid',
 'local invoice must be explicitly resolved before maturity');
assert.equal(maturationCount(),1,'paid fee, risk clear and due release one internal commission');
assert.equal(sql("SELECT matured_at IS NOT NULL FROM public.order_reward_grants WHERE order_id="+q(orderId)+"::uuid"),'t');
assert.equal(sql("SELECT count(*) FROM public.wallet_entries WHERE order_id="+q(orderId)+"::uuid AND user_id="+q(outsider.id)+"::uuid AND bucket='commission_pending' AND entry_type='referral_pending_release' AND amount_cents=-"+reward.referral_pending_cents),'1',
 'release must debit pending balance exactly once');
assert.equal(sql("SELECT count(*) FROM public.wallet_entries WHERE order_id="+q(orderId)+"::uuid AND user_id="+q(outsider.id)+"::uuid AND bucket='commission_available' AND entry_type='referral_available' AND amount_cents="+reward.referral_pending_cents),'1',
 'release must credit available balance exactly once');
const netBalances=sql("SELECT coalesce(sum(amount_cents) FILTER (WHERE bucket='commission_pending'),0)::text || ':' || "+
 "coalesce(sum(amount_cents) FILTER (WHERE bucket='commission_available'),0)::text FROM public.wallet_entries WHERE order_id="+q(orderId)+"::uuid AND user_id="+q(outsider.id)+"::uuid");
assert.equal(netBalances,'0:'+reward.referral_pending_cents,
 'maturation only moves internal balance from pending to available');
assert.equal(sql("SELECT count(*) FROM public.order_events WHERE order_id="+q(orderId)+"::uuid AND event_type='COMMISSION_AVAILABLE'"),'1');
assert.equal(maturationCount(),0,'maturation re-run must not release or emit twice');
assert.equal(sql("SELECT count(*) FROM public.wallet_entries WHERE order_id="+q(orderId)+"::uuid AND entry_type IN ('referral_pending_release','referral_available')"),'2',
 'repeated maturation cannot double credit internal wallet');
assert.equal(sql('SELECT count(*) FROM public.platform_referral_payout_claims_v1_263'),'0',
 'an internally available commission is NOT an externally claimed payout');
assert.equal(sql('SELECT count(*) FROM public.platform_referral_payout_proofs_v1_264'),'0',
 'internal maturation cannot produce a bank payment proof');
assert.equal(sql('SELECT count(*) FROM public.merchant_billing_payment_events'),'0',
 'fake merchant cash confirmation cannot create a real billing settlement');
console.log('PASS: canonical commission hold/risk gates, due maturation and replay; internal pending->available only, zero external payment proofs.');

console.log('PASS: local canonical quote -> HTTP checkout -> merchant accept -> dispatch -> PIN shown only to buyer -> arrival -> wrong PIN rejected -> merchant-attested cash settlement -> replay unchanged; zero external PSP.');

// Additional real HTTP orders in disposable Postgres. These scenarios use
// synthetic Auth users and existing APIs, never a real merchant, CNPJ, or PSP.
const testBuyer2=await createActor('multi-cancelled');
const testBuyer3=await createActor('multi-active');
async function placeAdditionalTestOrder(actor,productCode,unitCents,quantity,fingerprint){
 assert.equal(sql("SELECT public.merchant_basket_compliance_current("+
   q(merchantId)+"::uuid,ARRAY["+q(productCode)+"]::text[])"),'t',
   'local synthetic product must pass the canonical compliance scope');
 const rows=[{product_code:productCode,quantity,unit_price_cents:unitCents}];
 const quoted=JSON.parse(sql("SELECT public.create_quote_snapshot_v3("+
  q(actor.id)+"::uuid,"+q(merchantId)+"::uuid,"+q(postalCode)+
  ",'10',400,25,45,clock_timestamp()+interval '5 minutes',"+
  q(JSON.stringify(rows))+"::jsonb,repeat("+q(fingerprint)+",64));"));
 assert.match(quoted.quoteId,/^[0-9a-f-]{36}$/i);
 assert.equal(quoted.grossTotalCents,unitCents*quantity+400);
 sql("UPDATE public.quotes SET payment_method_requested='cash',payment_timing_requested='on_delivery' WHERE id="+q(quoted.quoteId)+"::uuid;");
 const req={quoteId:quoted.quoteId,paymentMethod:'cash',useCashback:false,
  customerPhone:'11999999999'};
 const key='ci-multi-order-'+randomUUID();
 const created=await call('create-order',actor.token,req,{'Idempotency-Key':key});
 assert.equal(created.status,201,'disposable additional checkout: '+JSON.stringify(created.body).slice(0,450));
 assert.equal(created.body.status,'OFFERED_TO_MERCHANT');
 const retry=await call('create-order',actor.token,req,{'Idempotency-Key':key});
 assert.equal(retry.status,201);
 assert.equal(retry.body.orderId,created.body.orderId,
  'checkout replay must never duplicate additional test order');
 return created.body.orderId;
}
const cancelledId=await placeAdditionalTestOrder(testBuyer2,'WATER20',1590,2,'b');
const beforeCancel=await call('get-order',testBuyer2.token,{orderId:cancelledId});
assert.equal(beforeCancel.status,200);
const rejectedBuyer=await call('get-order',testBuyer3.token,{orderId:cancelledId});
assert.equal(rejectedBuyer.status,404,'other buyer cannot access test order');
const cancelKey='ci-cancel-multi-'+randomUUID();
const cancelPayload={orderId:cancelledId,action:'cancel-before-accept',
 expectedVersion:beforeCancel.body.version};
const cancelled=await call('customer-action',testBuyer2.token,cancelPayload,
 {'Idempotency-Key':cancelKey});
assert.equal(cancelled.status,200,'customer cancellation in actual Edge/RPC: '+JSON.stringify(cancelled.body).slice(0,440));
assert.equal(sql("SELECT status FROM public.orders WHERE id="+q(cancelledId)+"::uuid"),'CANCELLED');
const cancelReplay=await call('customer-action',testBuyer2.token,cancelPayload,
 {'Idempotency-Key':cancelKey});
assert.equal(cancelReplay.status,200);
assert.equal(sql("SELECT available_stock FROM public.catalog_items WHERE merchant_id="+
 q(merchantId)+"::uuid AND product_code='WATER20'"),'6',
 'cancel before acceptance cannot reserve synthetic stock');

const activeId=await placeAdditionalTestOrder(testBuyer3,'WATER20',1590,1,'c');
const activeOwned=await call('get-order',testBuyer3.token,{orderId:activeId});
const activeAccepted=await call('merchant-action',owner.token,{
 orderId:activeId,action:'accept',expectedVersion:activeOwned.body.version
},{'Idempotency-Key':'ci-multi-accept-'+randomUUID()});
assert.equal(activeAccepted.status,200,'real merchant action must accept extra disposable order');
assert.equal(activeAccepted.body.status,'PREPARING');
// Reuse this disposable real-Auth driver for the isolated Chrome PWA route.
// Assignment is performed by the canonical merchant-action RPC before dispatch.
const deliveryActor=await createActor('delivery-revocation');
sql("INSERT INTO public.merchant_members(merchant_id,user_id,member_role,active) VALUES("+
 q(merchantId)+"::uuid,"+q(deliveryActor.id)+"::uuid,'driver',true)");
const assignedForBrowser=await call('merchant-action',owner.token,{
 orderId:activeId,action:'assign-delivery',expectedVersion:activeAccepted.body.version,
 deliveryUserId:deliveryActor.id
},{'Idempotency-Key':'ci-assign-driver-browser-'+randomUUID()});
assert.equal(assignedForBrowser.status,200,'canonical driver assignment: '+JSON.stringify(assignedForBrowser.body).slice(0,400));
assert.equal(assignedForBrowser.body.assignedDeliveryUserId,deliveryActor.id);
assert.equal(sql("SELECT available_stock FROM public.catalog_items WHERE merchant_id="+
 q(merchantId)+"::uuid AND product_code='WATER20'"),'5',
 'acceptance locks exactly one water unit');
assert.equal(sql("SELECT count(*) FROM public.orders"),'3',
 'one settled, one cancelled and one preparing test order must exist only in local Postgres');
const statusDistribution=sql("SELECT string_agg(status||':'||n::text,',' ORDER BY status) FROM ("+
 "SELECT status,count(*) n FROM public.orders GROUP BY status) t");
assert.equal(statusDistribution,'CANCELLED:1,PREPARING:1,SETTLED:1');
const adminMulti=await call('admin-ops',adminActor.token,{action:'summary'});
assert.equal(adminMulti.status,200);
for(const [id,expectedStatus] of [[orderId,'SETTLED'],[cancelledId,'CANCELLED'],[activeId,'PREPARING']]){
 const row=adminMulti.body.controlOrders?.find(x=>x.id===id);
 assert.ok(row,'same Admin endpoint must show the actual local scenario '+id);
 assert.equal(row.status,expectedStatus,'Admin must show the canonical outcome for '+id);
}
assert.equal(sql("SELECT product_code FROM public.order_items WHERE order_id="+q(orderId)+"::uuid"),'P13',
 'settled original order must contain regulated gas P13 rather than a mock');
// The same Chrome portal test now views the second buyer and second accepted
// order, again with the canonical authenticated Admin, not a mocked screen.
const browserCheckoutBuyer=await createActor('customer-ui');
await verifyIsolatedLivePortals({
 api:base,anon,buyer:testBuyer3,owner,adminActor,orderId:activeId,merchantId,
 recentClosedOrderId:orderId,exerciseCrossSessionDispatch:true,driverActor:deliveryActor,browserCheckoutBuyer
});
assert.equal(sql("SELECT count(*) FROM public.orders WHERE customer_id="+q(browserCheckoutBuyer.id)+"::uuid"),'1','browser UI must create precisely one customer order');
assert.equal(sql("SELECT status FROM public.orders WHERE id="+q(activeId)+"::uuid"),'SETTLED',
 'driver offline staged PIN must settle the assigned order through authentic Edge after reconnection');
assert.equal(sql("SELECT count(*) FROM public.merchant_sale_payment_attempts"),'0');
assert.equal(sql("SELECT count(*) FROM public.merchant_billing_payment_events"),'0');
console.log('PASS: GLP P13 blocked before CI ANP, then settled via PIN; water cancelled/accepted; canonical Admin statuses; no PSP or production changes.');

// Real frontends, real LOCAL Auth and Postgres, three independent origins.
// CI proves the owner rehearsal server before an optional human-driven session.
const demoUiBuyer=await createActor('local-demo-three-portal-browser');
const rehearsal=await startOwnerLocalDemo({
 api:base,anon,customer:demoUiBuyer,merchant:owner,admin:adminActor
});
try{
 const healths=await Promise.all(rehearsal.roles.map(async({role,url})=>{
   const port=new URL(url).port;
   const origin='http://127.0.0.1:'+port;
   const read=async path=>{
     const res=await fetch(origin+path,{signal:AbortSignal.timeout(8000)});
     assert.equal(res.status,200,role+' localhost '+path);
     assert.equal(res.headers.get('cache-control'),'no-store, max-age=0');
     return res.text();
   };
   const status=JSON.parse(await read('/__owner-demo-health'));
   assert.deepEqual(status,{ok:true,role,localOnly:true});
   const html=await read('/');
   assert.match(html,/owner-local-session\.js/);
   assert.match(html,/tamao-owner-demo-ribbon/,'local-only synthetic banner must be in the real page');
   assert.match(html,/NENHUMA VENDA, COBRANÇA OU PIX REAL/,'fixture cannot present as real commercial order');
   assert.match(html,/noindex,nofollow,noarchive/);
   assert.doesNotMatch(html,/lgugwujpunhslavewffd\.supabase\.co/);
   const script=await read('/js/backend.js');
   assert.match(script,/http:\/\/127\.0\.0\.1:54321/);
   assert.doesNotMatch(script,/lgugwujpunhslavewffd\.supabase\.co/);
   const bootstrap=await read('/js/owner-local-session.js');
   const expected=role==='customer'?'chama-sg-customer-auth-v2':
     role==='merchant'?'chama-sg-merchant-auth-v1':'chama-sg-admin-auth-v1';
   assert.ok(bootstrap.includes(expected),role+' local browser session');
   for(const forbidden of ['chama-sg-customer-auth-v2','chama-sg-merchant-auth-v1','chama-sg-admin-auth-v1'])
     if(forbidden!==expected)assert.ok(!bootstrap.includes(forbidden),'cross-role credentials leaked to '+role);
   const missing=await fetch(origin+'/../.git/config');
   assert.ok(missing.status===404||missing.status===403);
   const denied=await fetch(origin+'/__owner-demo-health',{method:'POST'});
   assert.equal(denied.status,405,'owner demo must be read-only HTTP server');
   return role;
 }));
 assert.deepEqual(healths,['customer','merchant','admin']);
 await verifyOwnerLocalDemoBrowser({roles:rehearsal.roles,customerId:demoUiBuyer.id});
 assert.equal(sql("SELECT count(*) FROM public.orders WHERE customer_id="+q(demoUiBuyer.id)+"::uuid"),'1','owner three-origin browser must create exactly one real local SQL order');
 console.log('PASS: three local owner-demo origins are authenticated, loopback-only and serve only disposable backend URLs.');
}finally{await rehearsal.close()}

// Revocation uses the real local Supabase Auth token and the existing
// merchant-orders Edge function. No fake token, backend replacement or
// commercial account: the whole CI database is destroyed after the job.
const assignedDriver=await call('merchant-orders',deliveryActor.token,{merchantId});
assert.equal(assignedDriver.status,200,'active local driver must read an authorized merchant snapshot');
assert.equal(assignedDriver.body.merchant?.memberRole,'driver','role must come from backend, not JWT metadata');
assert.equal(assignedDriver.body.recentClosedDeliveries?.some(o=>o.orderId===activeId),true,
 'delivery settled in real isolated Chrome must appear only for this assigned driver');
// Synthetic fixture only, after the P13 order has fully settled in this
// disposable database. This assigns historical attribution solely to test
// the actual driver-only terminal response; no production order is altered.
sql("UPDATE public.orders SET assigned_delivery_user_id="+q(deliveryActor.id)+
 "::uuid,updated_at=clock_timestamp() WHERE id="+q(orderId)+
 "::uuid AND merchant_id="+q(merchantId)+"::uuid AND status='SETTLED'");
const terminalDriver=await call('merchant-orders',deliveryActor.token,{merchantId});
assert.equal(terminalDriver.status,200,'driver can consult PII-free closure proof on local Auth');
assert.equal(terminalDriver.body.orders?.some(o=>o.orderId===orderId),false,
 'completed order must not appear in active driver assignments');
const closed=terminalDriver.body.recentClosedDeliveries?.find(o=>o.orderId===orderId);
assert.ok(closed,'server must attest the completed order to its assigned driver');
assert.equal(closed.status,'SETTLED');
assert.equal(closed.version,Number(sql("SELECT version FROM public.orders WHERE id="+q(orderId)+"::uuid")));
assert.equal(closed.assignedDeliveryUserId,deliveryActor.id);
assert.deepEqual(Object.keys(closed).sort(),['assignedDeliveryUserId','orderId','status','version'].sort(),
 'terminal proof must never leak customer address, contact, PIN, payment or contents');
sql("UPDATE public.merchant_members SET active=false WHERE merchant_id="+
 q(merchantId)+"::uuid AND user_id="+q(deliveryActor.id)+"::uuid");
const revokedDriver=await call('merchant-orders',deliveryActor.token,{merchantId});
assert.equal(revokedDriver.status,403,'revoked local driver must lose orders with the SAME valid token');
assert.ok(['NO_MERCHANT_ACCESS','MERCHANT_ACCESS_DENIED','MERCHANT_ROLE_NOT_ENABLED'].includes(revokedDriver.body.error),
 'revocation is a business 403, never an expired Auth token or stale cached grant');
sql("UPDATE public.merchant_members SET active=true,member_role='operator' WHERE merchant_id="+
 q(merchantId)+"::uuid AND user_id="+q(deliveryActor.id)+"::uuid");
const demotedDriver=await call('merchant-orders',deliveryActor.token,{merchantId});
assert.equal(demotedDriver.status,200,'demoted member may retain limited merchant access');
assert.equal(demotedDriver.body.merchant?.memberRole,'operator','backend role change disallows offline driver recovery');
sql("UPDATE public.merchant_members SET member_role='driver' WHERE merchant_id="+
 q(merchantId)+"::uuid AND user_id="+q(deliveryActor.id)+"::uuid");
const restoredDriver=await call('merchant-orders',deliveryActor.token,{merchantId});
assert.equal(restoredDriver.status,200);
assert.equal(restoredDriver.body.merchant?.memberRole,'driver',
 'only an authenticated fresh server snapshot may re-authorize driver offline scope');
console.log('PASS: real disposable Supabase Auth driver -> revoke -> demote -> restore; unchanged JWT never overrides current server membership.');

if(process.env.TAMAO_OWNER_LOCAL_DEMO==='1'){
 // Operator-friendly, persistent WHILE RUNNING rehearsal. No web hosting,
 // public port, real provider credentials, commercial Supabase or external PSP.
 const freshBuyer=await createActor('owner-rehearsal');
 const preview=await startOwnerLocalDemo({
   api:base,anon,customer:freshBuyer,merchant:owner,admin:adminActor
 });
 console.log('\nTAMÃO DEMONSTRAÇÃO PRIVADA LOCAL (SEM MOVIMENTO REAL)');
 console.log('Abra os três endereços acima em janelas distintas. O banco permanece local');
 console.log('até interromper o processo com Ctrl+C. Não encaminhe links para terceiros.');
 try{
   await new Promise(resolve=>{
     process.once('SIGINT',resolve);
     process.once('SIGTERM',resolve);
   });
 }finally{await preview.close()}
}



