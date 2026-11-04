import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');

const domain=read('supabase/functions/_shared/domain.js');
const coupon=read('supabase/functions/coupon-credit-pix/index.ts');
const order=read('supabase/functions/create-order/index.ts');
assert.match(domain,/export async function platformCommerceAllowed\(serviceClient\)/);
const loaded=await import('data:text/javascript;base64,'+Buffer.from(domain).toString('base64'));
const {platformCommerceAllowed,platformCouponSalesAllowed}=loaded;
const createClient=(data,error=null)=>({
  from(table){
    assert.equal(table,'platform_launch_control');
    return {select(columns){
      assert.equal(columns,'commerce_enabled,operation_mode');
      return {eq(field,value){
        assert.equal(field,'singleton');assert.equal(value,true);
        return {maybeSingle:async()=>({data,error})};
      }};
    }};
  }
});
for(const mode of ['PILOT','LIVE']){
  assert.equal(await platformCommerceAllowed(createClient({
    operation_mode:mode,commerce_enabled:true})),true,
    'commercial activity requires enabled central mode');
}
for(const mode of ['PRELAUNCH','PAUSED','PILOT','LIVE']){
  assert.equal(await platformCommerceAllowed(createClient({
    operation_mode:mode,commerce_enabled:false})),false);
}
for(const mode of ['PRELAUNCH','PAUSED','UNKNOWN']){
  assert.equal(await platformCommerceAllowed(createClient({
    operation_mode:mode,commerce_enabled:true})),false);
}
assert.equal(await platformCommerceAllowed(createClient(null)),false);
assert.equal(await platformCommerceAllowed(createClient(null,{code:'PGRST116'})),false);
assert.equal(await platformCommerceAllowed({from(){throw Error('db unavailable')}}),false);

assert.match(coupon,/platformCouponSalesAllowed/);
assert.ok(order.includes('platformCommerceAllowed'), 'orders must retain their own operational gate');
const saleClient=(data,error=null)=>({
 from(table){
  assert.equal(table,'platform_launch_control');
  return {select(columns){
   assert.equal(columns,'operation_mode');
   return {eq(field,value){
    assert.equal(field,'singleton');assert.equal(value,true);
    return {maybeSingle:async()=>({data,error})};
   }};
  }};
 }
});
for(const mode of ['PRELAUNCH','PILOT','LIVE']){
 assert.equal(await platformCouponSalesAllowed(saleClient({operation_mode:mode})),true,
  'package sales may be prepared independently of revendas/city commerce');
}
for(const mode of ['PAUSED','UNKNOWN']){
 assert.equal(await platformCouponSalesAllowed(saleClient({operation_mode:mode})),false);
}
assert.equal(await platformCouponSalesAllowed(saleClient(null)),false);
assert.equal(await platformCouponSalesAllowed(saleClient(null,{code:'PGRST116'})),false);
assert.equal(await platformCouponSalesAllowed({from(){throw Error('offline')}}),false);
const sales=coupon.indexOf('if(Deno.env.get("CLUBE_COUPON_PAID_SALES_ENABLED")!=="true")');
const emergency=coupon.indexOf('if(!await platformCouponSalesAllowed(admin))',sales);
const invoice=coupon.indexOf('.from("clube_coupon_paid_invoices").insert(details)');
assert.ok(sales>=0&&emergency>sales&&invoice>emergency,
 'PAUSED and private sales switch must block Pix before money is requested');
assert.match(coupon,/error:"COUPON_SALES_OPERATION_PAUSED"},423/);
const historical=coupon.slice(coupon.indexOf('if(operation==="my-vouchers")'),sales);
assert.ok(historical.includes('couponSalesEnabled:')&&
 historical.includes('await platformCouponSalesAllowed(admin)'),
 'sales display must use independent package gate');
assert.ok(historical.includes('couponCheckoutEnabled:')&&
 historical.includes('await platformCommerceAllowed(admin)'),
 'physical checkout remains blocked without commerce');
const branch=order.indexOf('if(couponVoucherId&&!await platformCommerceAllowed(admin))');
const rpc=order.indexOf('const { data, error } = couponVoucherId');
assert.ok(branch>=0&&rpc>branch,'coupon checkout RPC must be guarded');
assert.match(order,/if\(couponVoucherId&&!await platformCommerceAllowed\(admin\)\)/);
assert.match(order,/\?await admin\.rpc\("clube_coupon_paid_create_order"/);
assert.match(order,/:await admin\.rpc\("create_order_from_quote_v8"/);
assert.match(order,/new DomainError\("COMMERCE_NOT_ENABLED"/);
const gatedSection=order.slice(order.indexOf('const admin = createClient'),rpc);
assert.doesNotMatch(gatedSection,/\.insert\(|\.update\(|\.delete\(/,
 'operational gate must not mutate balances');
console.log('PASS: coupon sales independent of merchant while PAUSED blocks Pix and commerce still protects redemption.');
