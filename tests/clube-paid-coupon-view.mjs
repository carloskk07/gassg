import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ui=read('js/growth.js');
const edge=read('supabase/functions/coupon-credit-pix/index.ts');
const from=ui.indexOf('// Paid coupons share the customer');
const to=ui.indexOf('function club(){',from);
assert.ok(from>=0&&to>from,'extract authenticated Clube section');
assert.match(ui.slice(to),/\$\{clubePaidCouponPanel\(\)\}/,'widget is on the Club page');
assert.match(edge,/if\(operation==="my-vouchers"\)/);
assert.match(edge,/\.eq\("customer_user_id",user.id\)/);
assert.ok(edge.indexOf('if(operation==="my-vouchers")')<
 edge.indexOf('if(operation!=="purchase"&&operation!=="partner-purchase")'),
 'read my own history while sales are disabled');
assert.match(edge,/couponSalesEnabled:\s*Boolean\(await couponSaleRelease\(admin\)\)/);
assert.match(edge,/couponCheckoutEnabled:\s*Deno\.env\.get/);
assert.match(edge,/await platformCommerceAllowed\(admin\)/,
  'voucher history must not advertise paid coupon sales during PRELAUNCH');
assert.doesNotMatch(ui.slice(from,to),/onclick="[^"]*(?:Buy|Comprar|merchantBillingCreate)/,
 'no dead payment button until server can settle coupons');

let user='00000000-0000-0000-0000-000000000011';
let payload={ok:true,source:'clube_coupon_paid_my_vouchers_v1',purchases:[],vouchers:[]};
let calls=0,rendered=0,currentRoute='club';
const ctx=vm.createContext({
 globalThis:{liveReady:()=>true,liveRuntime:{session:{user:{id:user,is_anonymous:false,email_confirmed_at:'2026-11-11T12:00:00Z'}}}},
 liveReady:()=>true,
 liveInvoke:async(name,body)=>{
  assert.equal(name,'coupon-credit-pix');
  assert.equal(body.action,'my-vouchers');
  calls++;return payload;
 },
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 esc:value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;'),
 route:()=>currentRoute,render:()=>{rendered++},toast:()=>{},Date,Number,String,Array
});
vm.runInContext(ui.slice(from,to)+';this.panel=clubePaidCouponPanel;this.refresh=clubePaidCouponsRefresh;this.checkout=clubePaidCouponCheckoutPanel;',ctx);
assert.match(ctx.panel(),/Consultar meus cupons/);
await ctx.refresh();
assert.equal(calls,1);
assert.match(ctx.panel(),/ainda não possui cupons/);
assert.ok(rendered>0);
payload={ok:true,source:'clube_coupon_paid_my_vouchers_v1',purchases:[{invoiceId:'i1'}],
 vouchers:[{voucherId:'v1',invoiceId:'i1',ordinal:1,faceCents:500,
  status:'issued',expiresAt:'2026-11-10T10:00:00Z'}]};
await ctx.refresh();
assert.match(ctx.panel(),/R\$\s*5,00/);
assert.match(ctx.panel(),/Emitido/);
assert.doesNotMatch(ctx.panel(),/Comprar cupom/);
ctx.globalThis.liveRuntime.session.user.id='00000000-0000-0000-0000-000000000022';
assert.doesNotMatch(ctx.panel(),/R\$\s*5,00/,'isolate logged-in accounts');
payload={ok:false};
await ctx.refresh();
assert.match(ctx.panel(),/Não conseguimos consultar seus cupons/);
assert.doesNotMatch(ctx.panel(),/R\$\s*5,00/);
console.log('PASS: wallet UI, user separation, zero coupons, failed backend, safe sales-off read.');

// V1.949: simply entering the Clube or checkout fetches the original
// account's vouchers once, without issuing Pix or asking for a refresh click.
payload={ok:true,source:'clube_coupon_paid_my_vouchers_v1',purchases:[{invoiceId:'i2'}],
 vouchers:[{voucherId:'v2',invoiceId:'i2',ordinal:1,faceCents:500,
  status:'issued',expiresAt:'2027-05-09T10:00:00Z'}]};
ctx.globalThis.liveRuntime.session.user.id='00000000-0000-0000-0000-000000000033';
const beforeAuto=calls;
assert.doesNotMatch(ctx.panel(),/5,00/,'never show a prior account wallet');
await Promise.resolve();await Promise.resolve();
assert.equal(calls,beforeAuto+1,'opening Clube reads paid vouchers without a click');
assert.match(ctx.panel(),/5,00/,'paid voucher appears automatically');
ctx.panel();await Promise.resolve();
assert.equal(calls,beforeAuto+1,'rerender does not duplicate provider reads');
ctx.globalThis.liveRuntime.session.user.id='00000000-0000-0000-0000-000000000044';
currentRoute='order';
const beforeCheckout=calls;
assert.match(ctx.checkout(),/Cupons da sua conta/);
await Promise.resolve();await Promise.resolve();
assert.equal(calls,beforeCheckout+1,'checkout fetches existing voucher history');
ctx.globalThis.liveRuntime.session.user.id='00000000-0000-0000-0000-000000000055';
currentRoute='club';
const beforeRoute=calls;
ctx.panel();currentRoute='home';
await Promise.resolve();await Promise.resolve();
assert.equal(calls,beforeRoute,'leave page before microtask cancels read');
currentRoute='club';ctx.panel();
await Promise.resolve();await Promise.resolve();
assert.equal(calls,beforeRoute+1,'return to Clube safely retries canceled read');
console.log('V1.949 PASS — auto-load, account isolation, checkout, canceled navigation.');
