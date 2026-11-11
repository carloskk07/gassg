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
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
const ctx=vm.createContext({
 globalThis:{cshop:1,liveReady:()=>true,liveRuntime:{session:{user:{id:user,is_anonymous:false,email_confirmed_at:'2026-11-11T12:00:00Z'}}}},
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
vm.runInContext(read('js/clube-coupon-shop.js'),ctx);
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
await flush();
assert.equal(calls,beforeAuto+1,'opening Clube reads paid vouchers without a click');
assert.match(ctx.panel(),/5,00/,'paid voucher appears automatically');
ctx.panel();await flush();
assert.equal(calls,beforeAuto+1,'rerender does not duplicate provider reads');
ctx.globalThis.liveRuntime.session.user.id='00000000-0000-0000-0000-000000000044';
currentRoute='order';
const beforeCheckout=calls;
assert.match(ctx.checkout(),/Cupons da sua conta/);
await flush();
assert.equal(calls,beforeCheckout+1,'checkout fetches existing voucher history');
ctx.globalThis.liveRuntime.session.user.id='00000000-0000-0000-0000-000000000055';
currentRoute='club';
const beforeRoute=calls;
ctx.panel();currentRoute='home';
await flush();
assert.equal(calls,beforeRoute,'leave page before microtask cancels read');
currentRoute='club';ctx.panel();
await flush();
assert.equal(calls,beforeRoute+1,'return to Clube safely retries canceled read');
console.log('V1.949 PASS — auto-load, account isolation, checkout, canceled navigation.');

// V1.950: the PSP may be checked for the ORIGINAL invoice, never by issuing
// a second Pix. Changes of account cancel the polling authority.
const timers=new Map();let nextTimer=0;const actions=[];
ctx.setTimeout=(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id};
ctx.clearTimeout=id=>timers.delete(id);
ctx.document={hidden:false};
const buyer='00000000-0000-0000-0000-000000000066';
const invoice='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
ctx.globalThis.liveRuntime.session.user.id=buyer;
ctx.liveInvoke=async(_name,body)=>{
 actions.push(body.action);
 if(body.action==='invoice-status')
  return {ok:true,invoiceId:invoice,status:'paid',fundingPending:false};
 if(body.action==='my-vouchers')
  return {ok:true,source:'clube_coupon_paid_my_vouchers_v1',vouchers:[],purchases:[]};
 throw Error('Unexpected action: '+body.action);
};
vm.runInContext("clubeCouponShopState.userId='"+buyer+"';clubeCouponShopState.purchase={invoiceId:'"+invoice+"',status:'awaiting_payment'};",ctx);
ctx.clubeCouponPixAutoStart(invoice);
assert.equal(timers.size,1,'only one watcher on original invoice');
const [firstId,first]=[...timers.entries()][0];
assert.equal(first.ms,60000,'limited first status check');
timers.delete(firstId);await first.fn();await flush();
assert.equal(actions.filter(x=>x==='invoice-status').length,1);
assert.equal(actions.filter(x=>x==='my-vouchers').length,1);
assert.ok(actions.every(x=>x==='invoice-status'||x==='my-vouchers'),'no new checkout or credit');
assert.equal(timers.size,0,'paid invoice stops the watcher');
const buyer2='00000000-0000-0000-0000-000000000077';
ctx.globalThis.liveRuntime.session.user.id=buyer2;
vm.runInContext("clubeCouponShopState.userId='"+buyer2+"';clubeCouponShopState.purchase={invoiceId:'"+invoice+"',status:'awaiting_payment'};",ctx);
ctx.clubeCouponPixAutoStart(invoice);
const [secondId,second]=[...timers.entries()][0];
ctx.globalThis.liveRuntime.session.user.id='00000000-0000-0000-0000-000000000088';
timers.delete(secondId);await second.fn();await flush();
assert.equal(actions.filter(x=>x==='invoice-status').length,1,'account switch blocks provider call');
console.log('V1.950 PASS — automatic original Pix readback, no new charge, account isolation.');
