import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Reproduce a buyer changing CEP while an invoice for the same future
// partner-funded package is still awaiting payment. No PSP is contacted.
const source=fs.readFileSync(new URL('../js/clube-coupon-shop.js',import.meta.url),'utf8');
new vm.Script(source);
const packageKey='partner_general_3x5_849';
const requestId='6dbf91d5-074b-47fd-85ef-d910db2e9801';
const invoiceId='802e621e-0829-4e03-822f-a32d0c6ed177';
const calls=[],messages=[];
const ctx=vm.createContext({
  globalThis:null,Number,String,Object,Array,Date,URL,Promise,
  BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
  esc:v=>String(v??''),route:()=> 'club',render:()=>{},
  toast:msg=>messages.push(msg),
  crypto:{randomUUID:()=>requestId},
  document:{getElementById:()=>({checked:true})},
  liveReady:()=>true,
  clubePaidCouponView:null,
  clubePaidCouponsRefresh:async()=>{},
  liveInvoke:async(name,body)=>{
    assert.equal(name,'coupon-credit-pix');
    calls.push(body);
    if(body.action==='invoice-status')
      return {ok:true,invoiceId,status:'awaiting_payment',pixPayable:true};
    if(body.action==='partner-purchase')
      return {ok:true,invoiceId,fundingModel:'partner_funded',pixPayable:false};
    throw new Error('Unexpected coupon operation '+body.action);
  }
});
ctx.globalThis=ctx;
ctx.liveRuntime={session:{user:{id:'buyer-851'}}};
new vm.Script(source+'\nthis.shop=clubeCouponShopState;this.buy=clubeCouponBuy;this.history=clubeCouponPurchasesPanel;').runInContext(ctx);
const previous={packageKey,status:'awaiting_payment',requestId,invoiceId,
  servicePostalCode:'97000000',fundingModel:'partner_funded'};
ctx.clubePaidCouponView={
  userId:'buyer-851',status:'ready',purchases:[previous]
};
Object.assign(ctx.shop,{
  userId:'buyer-851',status:'ready',busy:false,attempts:{},
  regionPostal:'97300000',purchase:null,
  packages:[{packageKey,fundingModel:'partner_funded',
    termsVersion:'clube_partner_coupon_terms_v1_846',
    eligiblePostalCode:'97300000'}]
});

assert.match(ctx.history(),/CEP da compra: 97000000/,
  'the original CEP must be disclosed beside the pending purchase');
await ctx.buy(packageKey);
assert.equal(calls.length,0,
  'buyer switching CEP must never fetch/reuse prior Pix or create a new one');
assert.match(messages.at(-1),/Pix pendente.*outro CEP/,
  'buyer receives a clear path to the original invoice');
assert.equal(ctx.shop.busy,false,'a denied attempt must unlock the buyer UI');

previous.servicePostalCode=null;
await ctx.buy(packageKey);
assert.equal(calls.length,0,'missing historical CEP also fails closed');

previous.servicePostalCode='97300000';
await ctx.buy(packageKey);
assert.deepEqual(calls.map(x=>x.action),['invoice-status'],
  'same-CEP pending purchase checks its original invoice; never creates a second Pix');
assert.equal(calls[0].invoiceId,invoiceId);

calls.length=0;
previous.status='prepared';
await ctx.buy(packageKey);
assert.deepEqual(calls.map(x=>x.action),['partner-purchase'],
  'same-CEP prepared invoice replays the existing immutable request');
assert.equal(calls[0].postalCode,'97300000');
assert.equal(calls[0].requestId,requestId);
assert.equal(ctx.shop.busy,false);

console.log('PASS #851: cross-CEP Pix replay denied, original CEP disclosed, same-CEP idempotent recovery retained.');
