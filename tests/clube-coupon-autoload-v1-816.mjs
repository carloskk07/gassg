import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../js/clube-coupon-shop.js',import.meta.url),'utf8');
new vm.Script(source);
let uid='user-a',requests=0,renders=0;
const ctx=vm.createContext({
 globalThis:null,Promise,Number,String,Object,Array,Date,URL,
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 esc:v=>String(v??''),
 route:()=> 'club',render:()=>{renders++},toast:()=>{},
 liveInvoke:async(_name,data)=>{
  assert.equal(_name,'coupon-credit-pix');
  assert.equal(data.action,'catalog','opening catalog cannot issue Pix');
  requests++;return {ok:true,source:'clube_paid_catalog_v1_807',packages:[]};
 },
 liveReady:()=>true
});
ctx.globalThis=ctx;ctx.liveRuntime={session:{user:{id:'user-a'}}};
new vm.Script(source+'\nthis.panel=clubeCouponShopPanel;this.shop=clubeCouponShopState;').runInContext(ctx);
const flush=async()=>{await Promise.resolve();await new Promise(resolve=>setTimeout(resolve,0))};
assert.match(ctx.panel(),/Conferindo pacotes/);
ctx.panel();
await flush();
assert.equal(requests,1,'first view runs exactly one authenticated catalog lookup');
assert.match(ctx.panel(),/Não há pacotes liberados/);
assert.match(ctx.panel(),/não reserva produtos ou entrega/);
assert.equal(requests,1,'regular rerender never doubles provider reads');
ctx.liveRuntime.session.user.id='user-b';
ctx.panel();await flush();
assert.equal(requests,2,'different signed-in account gets its own fresh catalog');
assert.ok(renders>=2,'completed loads update the page');
assert.doesNotMatch(source,/action:'purchase'[^;]+Promise\.resolve/,'autoload cannot create invoices');
console.log('V1.816 PASS — first view auto-load, per-account isolation, no sale without backend authorisation, honest no-revenda copy.');
