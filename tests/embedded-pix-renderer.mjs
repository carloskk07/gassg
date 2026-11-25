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

// A stalled encoder is a local display problem, never a new payment request.
const deferredScripts=[],deferredTimers=new Map();
let deferredSequence=0,draws=0,throwInsert=false;
const deferred=vm.createContext({TextEncoder,TextDecoder,URL,Map,Promise,Number,String,Date,
 setTimeout:(fn,ms)=>{assert.equal(ms,15000);deferredTimers.set(++deferredSequence,fn);return deferredSequence;},
 clearTimeout:id=>deferredTimers.delete(id),
 render:()=>draws++,
 document:{currentScript:{src:'https://tamao.invalid/js/core.js?v=reviewed'},baseURI:'https://tamao.invalid/',visibilityState:'visible',
  createElement:()=>({remove(){this.removed=true}}),head:{appendChild:s=>{
   if(throwInsert)throw new Error('blocked insertion');deferredScripts.push(s);
  }}}});
// Keep the unrelated identity display module out of this encoder-specific test.
deferred._pId=1;
vm.runInContext('// The same bank-readable Pix'+helper,deferred);
assert.match(deferred.tamaoPixMarkup(code,{amountCents:1990}),/Carregando/);
const firstEncoder=deferred.tamaoPixLoadEncoder();
assert.equal(deferred.tamaoPixLoadEncoder(),firstEncoder,'one encoder download at a time');
assert.equal(deferredScripts.length,1);
assert.equal(deferredScripts[0].src,'https://tamao.invalid/js/qr-generator.js?v=reviewed');
[...deferredTimers.values()][0]();
assert.equal(await firstEncoder,false);
assert.equal(deferredTimers.size,0);
assert.equal(deferredScripts[0].removed,true);
assert.match(deferred.tamaoPixMarkup(code,{amountCents:1990}),/Tentar carregar QR Code/);
assert.equal(deferredScripts.length,1,'no auto retry on render');
assert.match(deferred.tamaoPixMarkup(code,{amountCents:1990,imageDataUri:'data:image/png;base64,AAAAAAAAAAAAAAAA'}),/<img/);
throwInsert=true;
assert.equal(await deferred.tamaoPixLoadEncoder(),false);
assert.equal(deferredTimers.size,0);
throwInsert=false;
deferred.tamaoPixRetryEncoder();deferred.tamaoPixRetryEncoder();
assert.equal(deferredScripts.length,2,'double click cannot duplicate download');
const nextEncoder=deferred.tamaoPixLoadEncoder();
const beforeLate=draws;
deferredScripts[0].onerror();deferredScripts[0].onload();
assert.equal(draws,beforeLate);
assert.equal(deferredTimers.size,1);
vm.runInContext(fs.readFileSync(new URL('../js/qr-generator.js',import.meta.url),'utf8'),deferred);
deferredScripts[1].onload();
assert.equal(await nextEncoder,true);
assert.equal(deferredTimers.size,0);
assert.match(deferred.tamaoPixMarkup(code,{amountCents:1990}),/<svg\b/);
assert.equal(deferred.tamaoPixMarkup(code,{amountCents:4990}),'');
console.log('PASS: local QR timeout, original image fallback, explicit retry, late events and unchanged exact amount validation.');
