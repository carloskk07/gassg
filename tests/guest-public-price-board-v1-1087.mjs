import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const backend=read('js/backend.js');
const customer=read('js/customer.js');
const bootstrap=read('js/bootstrap.js');
const acquisition=read('js/acquisition.js');
const showcase=read('js/home-showcase.js');
const guest=read('js/guest-price-board.js');
const edge=read('supabase/functions/public-city-prices/index.ts');

// First landing must NOT open customer Auth or mint an anonymous user.
assert.match(bootstrap,/\['order','tracking'\]\.includes\(route\(\)\)/);
assert.doesNotMatch(backend,/\.auth\.signInAnonymously\s*\(/);
assert.match(backend,/if\(!session\?\.access_token\|\|session\.user\?\.is_anonymous===true\)/);
assert.match(customer,/const disabled=!testDemo&&!ready&&!preview&&!customerOriginSafe\(\)/);
assert.match(acquisition,/globalThis\.tamaoGuestCityPriceBoard\?\.\(\)/);
assert.match(showcase,/globalThis\.addEventListener\?\.\('load'/);
assert.match(showcase,/guest-price-board\.js/);
assert.match(guest,/CHAMA_BACKEND\.url\+'\/functions\/v1\/public-city-prices'/);

// Public reader is isolated behind an Edge service key; no anon database grant.
assert.match(edge,/consume_hashed_api_quota/);
assert.match(edge,/public_city_price_board_v1_341/);
assert.match(edge,/data\.products\.map\(\(p:any\)=>/);
assert.match(edge,/req\.headers\.get\("apikey"\)!==PUB/);
assert.match(edge,/return reply\(\{error:"RATE_LIMITED"/);
assert.ok(!fs.existsSync(new URL('../supabase/migrations/20261120020000_public_city_price_board_guest_v1_1087.sql',import.meta.url)));

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
assert.ok(requests[0].url.endsWith('/functions/v1/public-city-prices'));
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

let edgeHandler=null,quotaAllowed=true,remoteBoard={...board},rpcCalls=[];
const EdgeEnv={
 SUPABASE_URL:'https://example.supabase.co',
 SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({default:'sb_publishable_example'}),
 SUPABASE_SECRET_KEYS:JSON.stringify({default:'server-secret-for-tests'})
};
const edgeCtx={
 Deno:{env:{get:key=>EdgeEnv[key]},serve:fn=>{edgeHandler=fn}},
 createClient:()=>({rpc:async(name,args)=>{
   rpcCalls.push({name,args});
   if(name==='consume_hashed_api_quota')
     return {data:{allowed:quotaAllowed,retryAfterSeconds:60},error:null};
   if(name==='public_city_price_board_v1_341')
     return {data:remoteBoard,error:null};
   return {data:null,error:new Error('Unexpected RPC')};
 }}),
 crypto:webcrypto,TextEncoder,Response,Request,Date,JSON,Number,String,Array,
 console:{error:()=>{}}
};
const runnable=edge.replace(/^import .+;\r?\n/gm,'')
 .replace('function allowed(origin:string|null)','function allowed(origin)')
 .replace('function headers(origin:string|null)','function headers(origin)')
 .replace('function reply(payload:unknown,status:number,origin:string|null)',
   'function reply(payload,status,origin)')
 .replace('async function digest(value:string)','async function digest(value)')
 .replace(/\(p:any\)=>/g,'p=>');
vm.runInNewContext(runnable,edgeCtx);
assert.equal(typeof edgeHandler,'function');
const request=(origin='https://tamao.com.br',key='sb_publishable_example')=>
 new Request('https://example.supabase.co/functions/v1/public-city-prices',{
   method:'POST',
   headers:{Origin:origin,apikey:key,'Content-Type':'application/json',
     'x-forwarded-for':'203.0.113.7'},
   body:JSON.stringify({p_city:'São Gabriel',p_state:'RS'})
 });
let result=await edgeHandler(request('https://evil.example'));
assert.equal(result.status,403);
result=await edgeHandler(request('https://tamao.com.br','wrong-key'));
assert.equal(result.status,401);
assert.equal(rpcCalls.length,0,'Blocked requests never invoke service-role RPC');
remoteBoard={...board,products:[{...board.products[0],merchantId:'private',customerPhone:'private'}]};
result=await edgeHandler(request());
assert.equal(result.status,200);
const safe=await result.json();
assert.equal(safe.source,board.source);
assert.equal(safe.notAQuote,true);
assert.equal(safe.products.length,1);
assert.deepEqual(Object.keys(safe.products[0]).sort(),
 ['code','fromCents','merchantCount','toCents','updatedAt'].sort());
assert.ok(!JSON.stringify(safe).includes('private'));
assert.deepEqual(rpcCalls.map(x=>x.name),
 ['consume_hashed_api_quota','public_city_price_board_v1_341']);
quotaAllowed=false;
rpcCalls=[];
result=await edgeHandler(request());
assert.equal(result.status,429);
assert.deepEqual(rpcCalls.map(x=>x.name),['consume_hashed_api_quota']);
quotaAllowed=true;
remoteBoard={...board,products:[{...board.products[0],merchantCount:0}]};
result=await edgeHandler(request());
assert.equal(result.status,503,'Corrupt aggregate must fail closed');

console.log('PASS V1.1087: rate-limited public Edge, strict aggregate projection, guests browse without Auth or DB grants.');
