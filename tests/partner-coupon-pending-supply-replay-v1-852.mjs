import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const edge=read('supabase/functions/coupon-credit-pix/index.ts');
const shop=read('js/clube-coupon-shop.js');
const helperStart=edge.indexOf('function couponOfficialPixTicket(');
const helperEnd=edge.indexOf('Deno.serve(',helperStart);
assert.ok(helperStart>0&&helperEnd>helperStart);
const helpers=edge.slice(helperStart,helperEnd).replace(/:any(?=[,)])/g,'');
new vm.Script(helpers,{filename:'coupon-credit-pix-safe-replay.ts'});
const routing=edge.slice(edge.indexOf('if(operation==="invoice-status")'),
  edge.indexOf('const amount=(Number(invoice.sale_price_cents)/100).toFixed(2)'));
assert.match(routing,/const replay=await couponVerifiedReplay\(invoice,admin\)/);
assert.match(edge,/const replay=await couponVerifiedReplay\(existing,admin\)/);
assert.match(helpers,/invoice\?\.funding_mode_v1_846==="partner_funded"/);
assert.match(helpers,/partnerPendingInvoiceSafe\(admin,invoice\)/);
assert.match(helpers,/PARTNER_COUPON_PENDING_SUPPLY_UNAVAILABLE/);

const now=Date.now();
const iso=ms=>new Date(now+ms).toISOString();
const br='00020101021226800014br.gov.bcb.pix1234567890';
const inv={
  id:'invoice-852',status:'awaiting_payment',sale_price_cents:890,
  created_at:iso(-300000),expires_at:iso(600000),
  pix_br_code:br,payment_url:null,provider_order_id:'order-852',
  provider_payment_id:'payment-852',funding_mode_v1_846:'partner_funded',
  buyer_postal_code_v1_850:'97000000'
};
const order={id:'order-852',external_reference:'invoice-852',
  total_amount:'8.90',status:'action_required',
  transactions:{payments:[{id:'payment-852',amount:'8.90',status:'pending',
    payment_method:{id:'pix',type:'bank_transfer',qr_code:br}}]}};
const state={ready:true,global:true,area:true,verified:true,postal:'97000000',throwRpc:false};
let getCount=0,readinessCalls=0,supplyCalls=0;
const sandbox=vm.createContext({
  Date,String,Number,Array,Object,URL,Error,Math,encodeURIComponent,
  console:{warn:()=>{}},
  safeMercadoPagoUrl:()=>null,MP_TOKEN:'synthetic-never-used',
  mercadoPagoFetch:async()=>{getCount++;return {ok:true};},
  readMercadoPagoJson:async()=>order,
  findPix:o=>o?.transactions?.payments?.[0]||null,
  mercadoPagoPixDeadline:()=>iso(900000),
  moneyToCents:v=>Math.round(Number(v)*100),
  validatePixBrCode:()=>({valid:true}),
  partnerSaleReadiness:async()=>{readinessCalls++;if(state.throwRpc)throw Error('failed RPC');return {ready:state.ready};},
  platformCouponSalesAllowed:async()=>state.global,
  partnerBuyerSupply:async(_admin,postal)=>{
    supplyCalls++;assert.equal(postal,inv.buyer_postal_code_v1_850);
    return {ready:state.area,verified:state.verified,postalCode:state.postal};
  }
});
new vm.Script(helpers).runInContext(sandbox);
const admin={mockServiceRole:true};
const block=async(message)=>{
  const before=getCount;
  const result=await sandbox.couponVerifiedReplay(inv,admin);
  assert.equal(result.ok,false,message);
  assert.equal(result.error,'PARTNER_COUPON_PENDING_SUPPLY_UNAVAILABLE');
  assert.equal(result.pixPayable,false,'no payable QR may escape a failed live supply gate');
  assert.equal(result.pixCode,null,'old BR code is masked');
  assert.equal(result.paymentUrl,null,'old MP payment URL is masked');
  assert.equal(result.recheckRequired,true);
  assert.equal(getCount,before,'provider GET must not present a Pix for a withdrawn offer');
};
state.ready=false;await block('revenda withdrawn / consent revoked');
state.ready=true;state.global=false;await block('global emergency pause');
state.global=true;state.area=false;await block('stock expired / CEP no longer covered');
state.area=true;state.verified=false;await block('unverified postal supply');
state.verified=true;state.postal='97300000';await block('supply for a different postal code');
state.postal='97000000';state.throwRpc=true;await block('RPC error must fail closed');
state.throwRpc=false;
await blockNoAdmin();
async function blockNoAdmin(){
  const result=await sandbox.couponVerifiedReplay(inv,null);
  assert.equal(result.ok,false,'missing privileged client cannot authorize pending Pix');
  assert.equal(result.pixCode,null);
}
const invalid={...inv,buyer_postal_code_v1_850:null};
assert.equal((await sandbox.couponVerifiedReplay(invalid,admin)).pixPayable,false);
const accepted=await sandbox.couponVerifiedReplay(inv,admin);
assert.equal(accepted.ok,true,'fresh merchant supply and pending PSP permit original Pix');
assert.equal(accepted.pixCode,br);
assert.equal(accepted.pixPayable,true);
assert.equal(getCount,1,'one PSP GET only after merchant readiness');
const legacy={...inv,funding_mode_v1_846:'platform_reimbursed',buyer_postal_code_v1_850:null};
state.ready=false;state.global=false;state.area=false;
const legacyReplay=await sandbox.couponVerifiedReplay(legacy,admin);
assert.equal(legacyReplay.ok,true,'legacy owner-sponsored invoice never inherits partner-specific constraints');
assert.equal(legacyReplay.pixCode,br);
assert.equal(getCount,2);
const paidBefore=getCount;
const paidAfterWithdrawal=await sandbox.couponVerifiedReplay({...inv,status:'paid'},admin);
assert.equal(paidAfterWithdrawal.ok,true,
 'already-paid partner-funded receipts remain available regardless of later merchant withdrawal');
assert.equal(paidAfterWithdrawal.status,'paid');
assert.equal(paidAfterWithdrawal.pixPayable,false);
assert.equal(getCount,paidBefore,'paid receipts do not need a new Pix provider GET');
assert.ok(readinessCalls>0&&supplyCalls>0);

// Verify the real buyer UI tells the customer NOT to pay a stale Pix.
// A 409 from the Edge must remove an already rendered old payment card.
const messages=[];
const ctx=vm.createContext({
 globalThis:null,Promise,Number,String,Object,Array,Date,URL,
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 esc:v=>String(v??''),route:()=> 'club',render:()=>{},
 toast:m=>messages.push(m),liveReady:()=>true,
 liveInvoke:async()=>{throw Object.assign(Error('unavailable'),
   {code:'PARTNER_COUPON_PENDING_SUPPLY_UNAVAILABLE'});},
 clubePaidCouponView:null,clubePaidCouponsRefresh:async()=>{}
});
ctx.globalThis=ctx;ctx.liveRuntime={session:{user:{id:'buyer-852'}}};
new vm.Script(shop+'\nthis.check=clubeCouponCheckInvoice;this.shop=clubeCouponShopState;').runInContext(ctx);
ctx.clubePaidCouponView={userId:'buyer-852',status:'ready',purchases:[],vouchers:[]};
ctx.shop.userId='buyer-852';
ctx.shop.purchase={invoiceId:'6b8914c9-09ef-43d1-8a15-9b6c262f7152',
 pixPayable:true,pixCode:br,fundingModel:'partner_funded',
 servicePostalCode:'97000000'};
await ctx.check(ctx.shop.purchase.invoiceId);
assert.equal(ctx.shop.purchase,null,'the old visible QR must be cleared');
assert.match(messages.at(-1),/Não pague o código anterior/i);
assert.match(messages.at(-1),/reembolso/i);
console.log('PASS #852: pending partner Pix rechecked at original CEP on every replay, fail-closed while legacy invoices remain independent; buyer is warned not to pay stale code.');
