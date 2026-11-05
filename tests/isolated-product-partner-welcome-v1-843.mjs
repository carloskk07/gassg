import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';

// Runs AFTER isolated-supabase-positive-checkout.mjs against the same disposable
// Supabase runner. NO production tokens/PSP keys. All money is synthetic cash.
assert.equal(process.env.CI,'true');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const raw=execFileSync('supabase',['status','-o','env'],{encoding:'utf8',timeout:30000});
const vars=Object.fromEntries(raw.split('\n').map(l=>{
 const m=l.match(/^([A-Z_]+)=(.*)$/);
 return m?[m[1],m[2].replace(/^["']|["']$/g,'')]:null;
}).filter(Boolean));
const base=vars.API_URL||vars.SUPABASE_URL||'';
const anon=vars.ANON_KEY||vars.SUPABASE_ANON_KEY||'';
const service=vars.SERVICE_ROLE_KEY||vars.SUPABASE_SERVICE_ROLE_KEY||'';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):54321\/?$/);
const sql=s=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
 '--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet',
 '--command='+s
],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},timeout:60000}).trim();
const q=s=>"'"+String(s).replaceAll("'","''")+"'";
const merchantId='00000000-0000-4000-8000-000000000026';
const postalCode='97300000';
const ownerId=sql("select user_id from public.merchant_members where merchant_id="+q(merchantId)+
 "::uuid and member_role='owner' and active limit 1");
assert.match(ownerId,/^[0-9a-f-]{36}$/i);
assert.equal(sql('select commerce_enabled from public.platform_launch_control limit 1'),'t');
assert.equal(sql("select count(*) from public.merchant_benefit_participations_v1_842 where merchant_id="+q(merchantId)+"::uuid"),'0');
sql("update public.merchants set last_seen_at=clock_timestamp(),status='active',online=true,accepts_citywide=true where id="+q(merchantId)+"::uuid");
sql("update public.catalog_items set price_confirmed_at=clock_timestamp(),active=true,available_stock=10 where merchant_id="+q(merchantId)+"::uuid and product_code='WATER20'");
sql("select public.merchant_benefits_contract_v1_842("+q(ownerId)+"::uuid,"+
 q(merchantId)+"::uuid,'accept',1,0,"+q(randomUUID())+"::uuid,true)");
assert.equal(sql("select opted_in from public.merchant_benefit_participations_v1_842 where merchant_id="+q(merchantId)+"::uuid"),'t');

async function actor(label){
 const email='partner-welcome-'+label+'-'+randomUUID()+'@example.invalid';
 const password='Isolated!'+randomUUID();
 const headers={apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'};
 const created=await fetch(base+'/auth/v1/admin/users',{
  method:'POST',headers,body:JSON.stringify({email,password,email_confirm:true}),
  signal:AbortSignal.timeout(20000)
 });
 assert.ok([200,201].includes(created.status),label+' local Auth');
 const user=await created.json();
 const login=await fetch(base+'/auth/v1/token?grant_type=password',{
  method:'POST',headers:{apikey:anon,'Content-Type':'application/json'},
  body:JSON.stringify({email,password}),signal:AbortSignal.timeout(20000)
 });
 assert.equal(login.status,200);
 const session=await login.json();
 return {id:user.id,token:session.access_token};
}
const buyer=await actor('buyer');
const cancelBuyer=await actor('cancel');
const nonBuyer=await actor('nonmember');
const manager=await actor('manager');
sql("insert into public.merchant_members(merchant_id,user_id,member_role,active) values ("+
 q(merchantId)+"::uuid,"+q(manager.id)+"::uuid,'manager',true)");

function issueWelcome(a){
 const grantId=randomUUID();
 sql("insert into public.wallet_entries(id,user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata) values ("+
  q(grantId)+"::uuid,"+q(a.id)+"::uuid,null,'cashback','cashback_seed',100,"+
  q('welcome_2026_815:'+a.id)+",'"+
  '{"source":"welcome_bonus","campaign":"welcome_2026_815","funding":"owner_promotional_budget"}'+"'::jsonb)");
 sql("insert into public.platform_welcome_grants_v1_815(user_id,campaign_key,amount_cents,wallet_entry_id) values ("+
  q(a.id)+"::uuid,'welcome_2026_815',100,"+q(grantId)+"::uuid)");
 assert.equal(sql('select remaining_cents from public.platform_cashback_source_lots_v1_261 where lot_id='+q(grantId)+'::uuid'),'100');
 return grantId;
}
const buyerLot=issueWelcome(buyer);
const cancelLot=issueWelcome(cancelBuyer);
const nonLot=issueWelcome(nonBuyer);

function quoteFor(a){
 const item=JSON.stringify([{product_code:'WATER20',quantity:1,unit_price_cents:1590}]);
 const result=JSON.parse(sql("select public.create_quote_snapshot_v3("+
 q(a.id)+"::uuid,"+q(merchantId)+"::uuid,"+q(postalCode)+
 ",'10',400,25,45,clock_timestamp()+interval '5 minutes',"+
 q(item)+"::jsonb,"+q(randomBytes(32).toString('hex'))+")"));
 assert.match(result.quoteId,/^[0-9a-f-]{36}$/i);
 assert.equal(result.grossTotalCents,1990);
 sql("update public.quotes set payment_method_requested='cash',payment_timing_requested='on_delivery' where id="+q(result.quoteId)+"::uuid");
 return result.quoteId;
}
async function call(slug,user,payload,key=null){
 const res=await fetch(base+'/functions/v1/'+slug,{
  method:'POST',
  headers:{apikey:anon,Authorization:'Bearer '+user.token,
    Origin:'http://localhost:5173','Content-Type':'application/json',
    ...(key?{'Idempotency-Key':key}:{})},
  body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)
 });
 const body=await res.json();
 return {status:res.status,body};
}
function welcomeIntent(quoteId){return {quoteId,paymentMethod:'cash',
 useCashback:false,applyWelcome:true,customerPhone:'11999999999'}}
const firstQuote=quoteFor(buyer);
const preview=JSON.parse(sql('select public.product_welcome_quote_preview_v1_843('+
 q(buyer.id)+'::uuid,'+q(firstQuote)+'::uuid)'));
assert.equal(preview.eligible,true);
assert.equal(preview.discountCents,100);
assert.equal(preview.normalCashbackAvailableCents,0);
assert.equal(preview.partnerFunded,true);
const firstKey='ci-product-welcome-'+randomUUID();
const first=await call('create-order',buyer,welcomeIntent(firstQuote),firstKey);
assert.equal(first.status,201,'partner welcome creates order '+JSON.stringify(first.body).slice(0,420));
assert.equal(first.body.welcomeApplied,true);
assert.equal(first.body.partnerFundedDiscountCents,100);
assert.equal(first.body.grossTotalCents,1990);
assert.equal(first.body.totalCents,1890);
assert.equal(first.body.partnerFeeBpsSnapshot,800,'opted-in Flex 9% becomes 8%');
const orderId=first.body.orderId;
const replay=await call('create-order',buyer,welcomeIntent(firstQuote),firstKey);
assert.equal(replay.status,201);
assert.equal(replay.body.orderId,orderId);
assert.equal(replay.body.welcomeReplayed,true);
assert.equal(sql("select count(*) from public.merchant_welcome_order_uses_v1_843 where order_id="+q(orderId)+"::uuid"),'1');
assert.equal(sql('select remaining_cents from public.platform_cashback_source_lots_v1_261 where lot_id='+q(buyerLot)+'::uuid'),'0');
assert.equal(sql('select count(*) from public.merchant_cashback_reimbursements where order_id='+q(orderId)+'::uuid'),'0');

const client=await call('get-order',buyer,{orderId});
assert.equal(client.status,200);
assert.equal(client.body.partnerFundedDiscountCents,100);
assert.equal(client.body.totalCents,1890);
const merchant=await call('merchant-orders',manager,{merchantId});
assert.equal(merchant.status,200,'real local merchant auth snapshot');
const listed=merchant.body.orders?.find(o=>o.orderId===orderId);
assert.ok(listed);
assert.equal(listed.partnerFundedDiscountCents,100);
assert.equal(listed.partnerFeeBpsSnapshot,800);

const foreign=await call('get-order',nonBuyer,{orderId});
assert.equal(foreign.status,404,'discount must remain private');
const accepted=await call('merchant-action',manager,{
 orderId,action:'accept',expectedVersion:listed.version
},'ci-benefit-accept-'+randomUUID());
assert.equal(accepted.status,200,JSON.stringify(accepted.body).slice(0,450));
const current=await call('get-order',buyer,{orderId});
const dispatched=await call('merchant-action',manager,{
 orderId,action:'dispatch',expectedVersion:current.body.version
},'ci-benefit-dispatch-'+randomUUID());
assert.equal(dispatched.status,200,JSON.stringify(dispatched.body).slice(0,450));
const during=await call('get-order',buyer,{orderId});
const arrived=await call('merchant-action',manager,{
 orderId,action:'arriving',expectedVersion:during.body.version
},'ci-benefit-arriving-'+randomUUID());
assert.equal(arrived.status,200,JSON.stringify(arrived.body).slice(0,450));
const arrivedOrder=await call('get-order',buyer,{orderId});
assert.match(arrivedOrder.body.deliveryPin,/^[0-9]{4}$/);
const complete=await call('complete-delivery',manager,{
 orderId,pin:arrivedOrder.body.deliveryPin,
 expectedVersion:arrivedOrder.body.version,paymentConfirmed:true
},'ci-benefit-complete-'+randomUUID());
assert.equal(complete.status,200,'cash completion '+JSON.stringify(complete.body).slice(0,470));
assert.equal(complete.body.status,'SETTLED');
assert.equal(sql('select platform_fee_cents from public.platform_receivables where order_id='+q(orderId)+'::uuid'),'151',
 '8 percent fee on NET 18.90 is 1.51, not gross 19.90');
assert.equal(sql('select benefit_fee_basis_cents_v1_843 from public.platform_receivables where order_id='+q(orderId)+'::uuid'),'1890');
assert.equal(sql('select count(*) from public.merchant_cashback_reimbursements where order_id='+q(orderId)+'::uuid'),'0',
 'partner-financed welcome must never create a TAMÃO reimbursement');
assert.equal(sql('select count(*) from public.wallet_entries where order_id='+q(orderId)+'::uuid and entry_type=\'cashback_reserve\''),'1');
assert.equal(sql('select count(*) from public.clube_coupon_paid_order_applications where order_id='+q(orderId)+'::uuid'),'0');
console.log('PASS #843: real local quote -> welcome -> merchant -> delivery -> settlement, fee on net, no reimbursement.');

const cancelQuote=quoteFor(cancelBuyer);
const cancelKey='ci-product-welcome-cancel-'+randomUUID();
const createdCancel=await call('create-order',cancelBuyer,welcomeIntent(cancelQuote),cancelKey);
assert.equal(createdCancel.status,201,JSON.stringify(createdCancel.body).slice(0,450));
const cancelId=createdCancel.body.orderId;
const beforeCancel=await call('get-order',cancelBuyer,{orderId:cancelId});
const cancelled=await call('customer-action',cancelBuyer,{
 orderId:cancelId,action:'cancel-before-accept',expectedVersion:beforeCancel.body.version
},'ci-benefit-cancel-'+randomUUID());
assert.equal(cancelled.status,200,JSON.stringify(cancelled.body).slice(0,420));
assert.equal(sql('select remaining_cents from public.platform_cashback_source_lots_v1_261 where lot_id='+q(cancelLot)+'::uuid'),'100',
 'cancellation restores ONLY exact welcome lot');
assert.equal(sql('select count(*) from public.merchant_cashback_reimbursements where order_id='+q(cancelId)+'::uuid'),'0');
const againQuote=quoteFor(cancelBuyer);
const again=await call('create-order',cancelBuyer,welcomeIntent(againQuote),'ci-benefit-after-cancel-'+randomUUID());
assert.equal(again.status,201,'released welcome may be used again in a NEW order');
assert.equal(again.body.partnerFundedDiscountCents,100);
assert.notEqual(again.body.orderId,cancelId);
assert.equal(sql('select remaining_cents from public.platform_cashback_source_lots_v1_261 where lot_id='+q(cancelLot)+'::uuid'),'0');
console.log('PASS #843: cancellation/recredit and second request use exactly once.');

sql("select public.merchant_benefits_contract_v1_842("+q(ownerId)+"::uuid,"+
 q(merchantId)+"::uuid,'revoke',1,1,"+q(randomUUID())+"::uuid,false)");
const absentQuote=quoteFor(nonBuyer);
const absentPreview=JSON.parse(sql('select public.product_welcome_quote_preview_v1_843('+
 q(nonBuyer.id)+'::uuid,'+q(absentQuote)+'::uuid)'));
assert.equal(absentPreview.eligible,false);
const denied=await call('create-order',nonBuyer,welcomeIntent(absentQuote),'ci-benefit-nonparticipant-'+randomUUID());
assert.equal(denied.status,409,'no consent must not debit prize '+JSON.stringify(denied.body).slice(0,300));
assert.equal(sql('select remaining_cents from public.platform_cashback_source_lots_v1_261 where lot_id='+q(nonLot)+'::uuid'),'100');
const ordinary=await call('create-order',nonBuyer,{
 quoteId:absentQuote,paymentMethod:'cash',useCashback:true,customerPhone:'11999999999'
},'ci-benefit-ordinary-'+randomUUID());
assert.equal(ordinary.status,201,'ordinary purchases must remain possible');
assert.equal(ordinary.body.cashbackReservedCents,0,
 'nonpartner ordinary checkout must never silently spend owner-funded welcome');
assert.equal(ordinary.body.totalCents,1990);
assert.equal(sql('select remaining_cents from public.platform_cashback_source_lots_v1_261 where lot_id='+q(nonLot)+'::uuid'),'100');
console.log('PASS #843: nonparticipant/ordinary wallet isolation and no fake claims.');
