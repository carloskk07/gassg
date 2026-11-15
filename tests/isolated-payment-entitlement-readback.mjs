import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readPaymentEntitlement} from '../supabase/functions/_shared/payment-entitlement.js';
import {platformNetSqlProof} from './helpers/platform-net-sql-proof.mjs';

// Run the actual readback against PostgreSQL in the SAME uncommitted session
// as the existing canonical fixtures. No hosted credentials or provider calls.
assert.equal(process.env.CI,'true');
for(const key of ['SUPABASE_ACCESS_TOKEN','SUPABASE_DB_PASSWORD','SUPABASE_SERVICE_ROLE_KEY',
 'MERCADOPAGO_ACCESS_TOKEN','ADS_MP_ACCESS_TOKEN'])assert.equal(process.env[key]||'','');
const pg=spawn('psql',['--host=127.0.0.1','--port=54322','--username=postgres',
 '--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet'],
 {env:{...process.env,PGPASSWORD:'postgres'},stdio:['pipe','pipe','pipe']});
let pending=null,sequence=0,errors='';
pg.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-10000)});
createInterface({input:pg.stdout}).on('line',line=>{
 if(!pending)return;
 if(line===pending.marker){const p=pending;pending=null;clearTimeout(p.timer);p.resolve(p.lines.join('\n'));}
 else pending.lines.push(line);
});
pg.on('exit',code=>{if(pending){clearTimeout(pending.timer);pending.reject(Error('Isolated PostgreSQL exited '+code+': '+errors));pending=null}});
const sql=statement=>new Promise((resolve,reject)=>{
 assert.equal(pending,null,'one SQL operation per rollback session');
 const marker='__PAYMENT_READBACK_'+(++sequence)+'__';
 const timer=setTimeout(()=>{pg.kill();reject(Error('Isolated SQL deadline: '+errors));},120000);
 pending={marker,resolve,reject,timer,lines:[]};
 pg.stdin.write(statement+'\nSELECT '+quote(marker)+';\n');
});
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const ident=v=>{assert.match(v,/^[a-z][a-z0-9_]*$/);return '"'+v+'"'};
// PostgreSQL json_agg may insert whitespace/newlines between its rows.
// Parse the complete single SELECT result, preserving every receipt.
const json=async statement=>JSON.parse((await sql(statement)).trim());
const admin={async rpc(name,args){
 assert(['admin_platform_receipt_net_summary','refund_recovery_expected_outstanding'].includes(name));
 const params=Object.entries(args).map(([key,value])=>ident(key)+' => '+quote(value)).join(',');
 return {data:await json('SELECT public.'+ident(name)+'('+params+');'),error:null};
},from(table){
 const filters=[];let columns='*',limit=1001;
 const run=async single=>{
  const where=filters.length?' WHERE '+filters.join(' AND '):'';
  const rows='SELECT '+columns+' FROM public.'+ident(table)+where;
  const result=await json('WITH matching AS ('+rows+') SELECT json_build_object('+ 
   "'data',coalesce((SELECT json_agg(r) FROM (SELECT * FROM matching LIMIT "+limit+
   ") r),'[]'::json),'count',(SELECT count(*) FROM matching),'error',NULL);");
  return single?{...result,data:result.data[0]??null}:result;
 };
 return {select(raw){columns=raw==='*'?'*':raw.split(',').map(ident).join(',');return this},
  eq(key,value){filters.push(ident(key)+'='+quote(value));return this},
  in(key,values){assert(values.length>0&&values.length<=500);filters.push(ident(key)+' IN ('+values.map(quote).join(',')+')');return this},
  limit(value){assert(Number.isSafeInteger(value)&&value>0&&value<=1001);limit=value;return this},
  maybeSingle(){return run(true)},then(resolve,reject){return run(false).then(resolve,reject)}};
}};
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const template=(file,name)=>{
 const text=read(file),match=text.match(new RegExp('const '+name+'=`([\\s\\S]*?)`;'));
 assert(match,'missing existing fixture '+name);assert(!match[1].includes('${'));
 return match[1];
};
const row=async(table,where)=>json('SELECT row_to_json(r) FROM (SELECT * FROM public.'+ident(table)+' WHERE '+where+' LIMIT 1) r;');
const before=async()=>json("SELECT json_build_array((SELECT count(*) FROM public.clube_coupon_paid_invoices),"+
 "(SELECT count(*) FROM public.mobility_fee_pix_invoices_v1_837),"+
 "(SELECT count(*) FROM public.ads_independent_checkouts_v1_886),"+
 "(SELECT count(*) FROM public.merchant_sale_payment_attempts));");
try{
 assert.equal(await sql('SELECT current_database();'),'postgres');
 const base=await before();
 // A real sponsored voucher is redeemed through the canonical order engine.
 const coupon=template('./isolated-clube-sponsored-redemption-v1-956.mjs','exercise');
 assert(coupon.trimEnd().endsWith('ROLLBACK;'));
 await sql(coupon.slice(0,coupon.lastIndexOf('ROLLBACK;')));
 const invoice=await row('clube_coupon_paid_invoices',"provider_order_id='CI-V956-ORDER'");
 assert.equal((await readPaymentEntitlement('coupon',admin,invoice)).entitlementApplied,true);
 const snapshot=await before();
 assert.equal((await readPaymentEntitlement('coupon',admin,invoice)).entitlementApplied,true);
 assert.deepEqual(await before(),snapshot,'readback must not reissue a voucher');
 console.log('PASS: actual canonical coupon grants and redeemed voucher readback.');
 // A direct seller PSP event is synthetic, local and applied only by the
 // existing canonical processor; its verification must match that seller.
 await sql(`DO $sale$ DECLARE o public.orders%rowtype; a uuid; connection uuid; route uuid; sale_order uuid; buyer uuid; BEGIN
  SELECT * INTO o FROM public.orders WHERE customer_id=${quote(invoice.customer_user_id)}::uuid
   AND total_cents>0 ORDER BY created_at DESC LIMIT 1;
  IF o.id IS NULL THEN RAISE EXCEPTION 'READBACK_LOCAL_ORDER_REQUIRED'; END IF;
  -- A delivery-only order must NEVER acquire an automatic prepaid charge.
  BEGIN
   INSERT INTO public.merchant_sale_payment_attempts(order_id,merchant_id,provider,
    checkout_mode,external_reference,amount_cents,currency,status)
   VALUES(o.id,o.merchant_id,'mercadopago','hosted',gen_random_uuid()::text,
    o.total_cents,'BRL','pending');
   RAISE EXCEPTION 'READBACK_DELIVERY_ORDER_BECAME_PREPAID';
  EXCEPTION WHEN SQLSTATE '40001' THEN
   IF SQLERRM<>'PREPAID_PAYMENT_NOT_AUTHORIZED' THEN RAISE; END IF;
  END;
  -- Explicitly configured synthetic online account/route, only in ROLLBACK.
  -- These placeholders are NOT PSP credentials and are never sent anywhere.
  INSERT INTO public.merchant_payment_provider_accounts(merchant_id,provider,
   provider_account_id,status,capabilities,access_token_ciphertext,access_token_nonce,connected_at)
  VALUES(o.merchant_id,'mercadopago','CI-READBACK-SELLER','active',
   '{"directSalePaymentsEnabled":true,"canValidateProviderTransactions":true}'::jsonb,
   'CI-NOT-A-REAL-ENCRYPTED-TOKEN','CI-NOT-A-REAL-NONCE',clock_timestamp())
  ON CONFLICT(merchant_id,provider) DO UPDATE SET status='active',
   provider_account_id=excluded.provider_account_id,capabilities=excluded.capabilities,
   access_token_ciphertext=excluded.access_token_ciphertext,access_token_nonce=excluded.access_token_nonce,
   connected_at=excluded.connected_at RETURNING id INTO connection;
  INSERT INTO public.merchant_payment_routes(merchant_id,payment_method,provider,
   connection_id,channel,verification_mode,active,customer_label)
  VALUES(o.merchant_id,'pix','mercadopago',connection,'online','provider_api',true,'Pix isolado')
  ON CONFLICT(merchant_id,payment_method,provider,channel) DO UPDATE SET
   connection_id=excluded.connection_id,verification_mode='provider_api',active=true RETURNING id INTO route;
  -- Keep the one-active-order-per-customer invariant: the voucher buyer
  -- already has the first order. This independent scenario has its own actor.
  INSERT INTO auth.users(id,aud,role,email,is_anonymous,email_confirmed_at)
  VALUES(gen_random_uuid(),'authenticated','authenticated',
   'ci-receipt-buyer-'||gen_random_uuid()::text||'@example.invalid',false,clock_timestamp())
  RETURNING id INTO buyer;
  INSERT INTO public.orders(public_code,customer_id,status,address_text,address_number,postal_code,
   customer_phone_digits,payment_method,payment_timing,gross_total_cents,total_cents,
   delivery_fee_cents_snapshot,merchant_id,supplier_name_snapshot,attempted_merchant_ids,accepted_at,version)
  VALUES('CI-READBACK-'||substr(gen_random_uuid()::text,1,8),buyer,'MERCHANT_ACCEPTED',
   'Endereço exclusivamente sintético','1','97300000','51999998888','pix','prepaid',
   1000,1000,0,o.merchant_id,(SELECT name FROM public.merchants WHERE id=o.merchant_id),
   array[o.merchant_id],clock_timestamp(),1)
   RETURNING id INTO sale_order;
  INSERT INTO public.merchant_sale_payment_attempts(order_id,merchant_id,provider,
   checkout_mode,external_reference,amount_cents,currency,status,provider_order_id,
   verification_level,funds_owner,payment_route_id,payment_method_snapshot)
  VALUES(sale_order,o.merchant_id,'mercadopago','hosted',gen_random_uuid()::text,
   1000,'BRL','pending','CI-READBACK-SALE-ORDER','provider','merchant',route,'pix') RETURNING id INTO a;
  PERFORM public.apply_merchant_sale_payment_event_v2('mercadopago','CI-READBACK-SALE-EVENT',
   'CI-READBACK-SALE-ORDER','CI-READBACK-SALE-PAYMENT','payment.updated','approved',
   1000,'BRL',clock_timestamp(),repeat('d',64),'provider_api');
 END $sale$;`);
 const sale=await row('merchant_sale_payment_attempts',"provider_order_id='CI-READBACK-SALE-ORDER'");
 assert.equal(sale.status,'approved');
 assert.equal((await readPaymentEntitlement('merchant_sale',admin,sale)).entitlementApplied,true);
 console.log('PASS: delivery-only charge denied; authorized synthetic online seller proof matches.');
 await sql('ROLLBACK;');assert.deepEqual(await before(),base);

 // Reuse the complete Ads fixture up to its existing cancellation stage.
 // The complete original reversal test still runs separately, unchanged.
 const ads=template('./isolated-ads-independent-full-cycle-v1-955.mjs','txn');
 const split=ads.indexOf('  -- Buyer cancellation freezes');assert(split>0);
 await sql(ads.slice(0,split)+'\nEND;\n$v955$;');
 const checkout=await row('ads_independent_checkouts_v1_886',"payment_id='955001'");
 assert.equal(checkout.status,'payment_approved');
 assert.equal((await readPaymentEntitlement('advertising',admin,checkout)).entitlementApplied,true);
 console.log('PASS: actual canonical advertiser checkout and provider event readback.');
 await platformNetSqlProof({sql,json,quote,admin},'advertising',checkout.campaign_id);
 await sql('ROLLBACK;');assert.deepEqual(await before(),base);

 // Reuse existing completed rides and the funded/partially spent credit lot.
 const original=read('./isolated-mobility-fee-accrual-v1-835.mjs');
 const match=original.match(/const probe=("(?:\\.|[^"\\])*");/);assert(match);
 const rides=JSON.parse(match[1]);assert(rides.endsWith('ROLLBACK;'));
 const prepaid=read('./fixtures/mobility-prepaid-credit-v1-838.sql');
 const cutoff=prepaid.indexOf('-- After a provider reversal');assert(cutoff>0);
 await sql(rides.slice(0,-'ROLLBACK;'.length)+prepaid.slice(0,cutoff)+'\nSET LOCAL ROLE postgres;');
 const credit=await row('mobility_fee_pix_invoices_v1_837',"provider_order_id='ord838paid012345'");
 assert.equal((await readPaymentEntitlement('mobility',admin,credit)).entitlementApplied,true);
 await sql(`DO $fee$ DECLARE r jsonb; BEGIN
  r:=public.mobility_fee_pix_prepare_v1_837(${quote(credit.driver_id)}::uuid);
  PERFORM public.mobility_fee_pix_recover_paid_v1_837((r->>'invoiceId')::uuid,
   ${quote(credit.driver_id)}::uuid,'CI-READBACK-FEE-ORDER','CI-READBACK-FEE-PAYMENT',
   (r->>'amountCents')::integer,repeat('e',64));
 END $fee$;`);
 const fee=await row('mobility_fee_pix_invoices_v1_837',"provider_order_id='CI-READBACK-FEE-ORDER'");
 assert.equal((await readPaymentEntitlement('mobility',admin,fee)).entitlementApplied,true);
 console.log('PASS: actual mobility funded credit and allocated completed-ride fees match.');
 await platformNetSqlProof({sql,json,quote,admin},'mobility',credit.id);
 await sql('ROLLBACK;');assert.deepEqual(await before(),base);
 console.log('PASS: actual SQL receipt readback for redeemed coupons, canonical seller PSP, Ads, mobility credit/use and allocated fees; complete ROLLBACK, zero bank claims.');
}finally{
 if(!pg.killed&&pg.exitCode===null){try{await sql('ROLLBACK;')}catch{}pg.stdin.end();}
}
