import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const backend=read('js/backend.js');
const customer=read('js/customer.js');
const bootstrap=read('js/bootstrap.js');
const acquisition=read('js/acquisition.js');
const showcase=read('js/home-showcase.js');
const guest=read('js/guest-price-board.js');
const migration=read('supabase/migrations/20261120020000_public_city_price_board_guest_v1_1087.sql');

// First landing must NOT open customer Auth or mint an anonymous user.
assert.match(bootstrap,/\['order','tracking'\]\.includes\(route\(\)\)/);
assert.doesNotMatch(backend,/\.auth\.signInAnonymously\s*\(/);
assert.match(backend,/if\(!session\?\.access_token\|\|session\.user\?\.is_anonymous===true\)/);
assert.match(customer,/const disabled=!testDemo&&!ready&&!preview&&!customerOriginSafe\(\)/);
assert.match(acquisition,/globalThis\.tamaoGuestCityPriceBoard\?\.\(\)/);
assert.match(showcase,/window\.addEventListener\('load'/);
assert.match(showcase,/guest-price-board\.js/);
assert.match(guest,/CHAMA_BACKEND\.url\+'\/rest\/v1\/rpc\/public_city_price_board_v1_341'/);

// The sole database permission is an aggregate, read-only, city-scoped RPC.
assert.match(migration,/grant execute on function public\.public_city_price_board_v1_341\(text,text\) to anon;/i);
assert.doesNotMatch(migration,/grant (?:select|insert|update|delete|all) on (?:table|all tables)/i);
assert.doesNotMatch(migration,/grant execute on function public\.(?:create_order|create_quote|customer_summary)/i);
assert.match(migration,/TAMAO_GUEST_CITY_BOARD_CONTRACT_DRIFT/);

const begin=guest.indexOf('let tamaoGuestPriceBoardSeq=0;');
const end=guest.indexOf("\nif(route()==='home')tamaoGuestCityPriceBoard()",begin);
assert.ok(begin>0&&end>begin);
const publicReader=guest.slice(begin,end);
const now=new Date().toISOString();
const board={
 source:'public_city_price_board_v1_341',
 city:'São Gabriel',state:'RS',kind:'eligible_merchant_estimates',
 real:true,notAQuote:true,requiresPostalConfirmation:true,
 productCount:1,checkedAt:now,
 products:[{code:'P13',fromCents:11590,toCents:12500,merchantCount:2,updatedAt:now}]
};
let renders=0,requests=[],nextData=board,selected={city:'São Gabriel',state:'RS'};
const runtime={status:'disabled',cityPriceSnapshot:null,lastCityPriceBoardAt:0};
const ctx={
 CHAMA_BACKEND:{url:'https://example.supabase.co',publishableKey:'sb_publishable_example'},
 customerOriginSafe:()=>true,homeMarketRegion:()=>selected,
 liveRuntime:runtime,liveRequested:()=>true,liveReady:()=>false,
 route:()=> 'home',render:()=>{renders++},
 fetch:async(url,options)=>{
   requests.push({url,options});
   return {ok:true,json:async()=>nextData};
 },
 Date,JSON,Promise,Number,String,Array,Error,
};
ctx.globalThis=ctx;
vm.runInNewContext(publicReader,ctx);
assert.equal(typeof ctx.tamaoGuestCityPriceBoard,'function');
const first=await ctx.tamaoGuestCityPriceBoard();
assert.equal(first.source,board.source);
assert.equal(first.notAQuote,true);
assert.equal(requests.length,1);
assert.ok(requests[0].url.endsWith('/rest/v1/rpc/public_city_price_board_v1_341'));
assert.equal(requests[0].options.method,'POST');
assert.equal(requests[0].options.headers.apikey,'sb_publishable_example');
assert.equal(requests[0].options.headers.Authorization,undefined);
assert.deepEqual(JSON.parse(requests[0].options.body),{p_city:'São Gabriel',p_state:'RS'});
assert.equal(runtime.cityPriceSnapshot,board);
assert.equal(renders,1);
assert.equal(await ctx.tamaoGuestCityPriceBoard(),board,'Valid public prices are cached');
assert.equal(requests.length,1);

selected={city:'Outra Cidade',state:'RS'};
nextData={...board,city:'Outra Cidade',products:[{...board.products[0],fromCents:-1}]};
await assert.rejects(()=>ctx.tamaoGuestCityPriceBoard(),/integrity failed/);
assert.equal(runtime.cityPriceSnapshot,board,'Invalid public prices cannot replace trusted ones');

nextData={...board,city:'Outra Cidade'};
await ctx.tamaoGuestCityPriceBoard();
assert.equal(runtime.cityPriceSnapshot.city,'Outra Cidade');
assert.equal(requests.length,3);
console.log('PASS V1.1087: public city prices without Auth; validated, cached and no order or wallet grant.');
