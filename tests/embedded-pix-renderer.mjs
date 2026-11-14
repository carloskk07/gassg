import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {pixFixture} from './helpers/pix-fixture.mjs';
const helper=fs.readFileSync(new URL('../js/core.js',import.meta.url),'utf8').split('// The same bank-readable Pix')[1];
assert(helper);
const context=vm.createContext({TextEncoder,TextDecoder,URL,Map,Promise,Number,String,Date,
 setTimeout:()=>1,document:{currentScript:{src:'https://tamao.invalid/js/core.js?v=reviewed'},visibilityState:'visible'}});
vm.runInContext(fs.readFileSync(new URL('../js/qr-generator.js',import.meta.url),'utf8'),context);
vm.runInContext('// The same bank-readable Pix'+helper,context);
const code=pixFixture();
assert(context.tamaoPixCodeValid(code,1990));
assert(!context.tamaoPixCodeValid(code,4990));
assert(!context.tamaoPixCodeValid(code.slice(0,-4)+'FFFF',1990));
assert(!context.tamaoPixCodeValid('https://mercadopago.com.br/pay',1990));
const html=context.tamaoPixMarkup(code,{amountCents:1990,label:'QR Pix <teste>'});
assert.match(html,/<svg\b/);assert.match(html,/role="img"/);
assert.match(html,/aria-label="QR Pix &lt;teste&gt;"/);
assert(!html.includes('https://'),'QR is generated locally, not sent to a remote image service');
assert.equal(context.tamaoPixMarkup(code,{amountCents:4990}),'');
assert.equal(context.tamaoPixMarkup('not a Pix'),'');
console.log('PASS: actual QR encoder, exact CRC/currency/amount, no URL masquerading as bank QR, accessible local SVG.');

// Execute the deferred buyer purchase itself, including an auth change while
// the native payment request is in flight. Source-only checks miss bindings.
const purchase=fs.readFileSync(new URL('../js/ads-independent-purchase.js',import.meta.url),'utf8');
for(const switchSession of [false,true]){
 const runtime={session:{user:{id:'owned-buyer'}},authGeneration:1};let reads=0,creates=0;
 const c=vm.createContext({liveRuntime:runtime,crypto:{randomUUID:()=> 'isolated-request'},
  liveInvoke:async()=>{creates++;if(switchSession)runtime.authGeneration++;
   return {source:'ads_independent_checkout_v1_886',status:'checkout_ready',viewChargesCents:0,
    pixPayable:true,pixCode:code,expiresAt:new Date(Date.now()+3600000).toISOString()};},
  tamaoAdsMyRefresh:async()=>{reads++},toast:()=>{},Date,URL,Number,String,Map,
  location:{assign:()=>assert.fail('native Pix cannot leave TAMÃO')}});
 vm.runInContext(purchase,c);
 assert.equal(await c.tamaoAdsPurchaseCampaign('20000000-0000-4000-8000-000000000002'),!switchSession);
 assert.equal(creates,1);assert.equal(reads,switchSession?0:1);
}
console.log('PASS: deferred advertiser purchase displays native Pix and isolates in-flight auth changes.');
