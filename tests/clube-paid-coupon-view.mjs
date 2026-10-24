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
 edge.indexOf('if(Deno.env.get("CLUBE_COUPON_PAID_SALES_ENABLED")!=="true")'),
 'read my own history while sales are disabled');
assert.match(edge,/couponSalesEnabled:\s*Deno\.env\.get/);
assert.match(edge,/couponCheckoutEnabled:\s*Deno\.env\.get/);
assert.match(edge,/await platformCommerceAllowed\(admin\)/,
  'voucher history must not advertise paid coupon sales during PRELAUNCH');
assert.doesNotMatch(ui.slice(from,to),/onclick="[^"]*(?:Buy|Comprar|merchantBillingCreate)/,
 'no dead payment button until server can settle coupons');

let user='00000000-0000-0000-0000-000000000011';
let payload={ok:true,source:'clube_coupon_paid_my_vouchers_v1',purchases:[],vouchers:[]};
let calls=0,rendered=0;
const ctx=vm.createContext({
 globalThis:{liveRuntime:{session:{user:{id:user}}}},
 liveReady:()=>true,
 liveInvoke:async(name,body)=>{
  assert.equal(name,'coupon-credit-pix');
  assert.equal(body.action,'my-vouchers');
  calls++;return payload;
 },
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 esc:value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;'),
 route:()=> 'club',render:()=>{rendered++},toast:()=>{},Date,Number,String,Array
});
vm.runInContext(ui.slice(from,to)+';this.panel=clubePaidCouponPanel;this.refresh=clubePaidCouponsRefresh;',ctx);
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
