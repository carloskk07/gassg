import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const backend=read('js/backend.js');
const customer=read('js/customer.js');
const migration=read('supabase/migrations/20261120020000_public_city_price_board_guest_v1_1087.sql');
assert.match(migration,/grant execute on function public\.public_city_price_board_v1_341\(text,text\) to anon;/i);
assert.doesNotMatch(migration,/grant (?:select|insert|update|delete|all) on (?:table|all tables)/i);
assert.doesNotMatch(migration,/grant execute on function public\.(?:create_order|create_quote|customer_summary)/i);
assert.match(migration,/TAMAO_GUEST_CITY_BOARD_CONTRACT_DRIFT/);
assert.doesNotMatch(backend,/\.auth\.signInAnonymously\s*\(/);
assert.match(backend,/if\(!session\?\.access_token\|\|session\.user\?\.is_anonymous===true\)/);
assert.match(backend,/liveRefreshCityPriceBoard\(\{force:true\}\)\s*\.then\(board/);
assert.match(customer,/liveRuntime\?\.status!=='guest'/);
assert.match(customer,/Confirme sua conta para validar a entrega e o valor final pelo CEP/);

const begin=backend.indexOf('const CUSTOMER_CITY_BOARD_REFRESH_MS=');
const end=backend.indexOf('\nfunction prelaunchExamplesEnabled()',begin);
assert.ok(begin>0&&end>begin,'Extract only city-wide read-only public board');
const code=backend.slice(begin,end);
const now=new Date().toISOString();
const board={
  source:'public_city_price_board_v1_341',
  city:'São Gabriel',state:'RS',kind:'eligible_merchant_estimates',
  real:true,notAQuote:true,requiresPostalConfirmation:true,
  productCount:1,checkedAt:now,
  products:[{code:'P13',fromCents:11590,toCents:12500,merchantCount:2,updatedAt:now}]
};
for(const status of ['guest','ready']){
  const calls=[];
  const liveRuntime={
    status,client:{rpc:async(name,args)=>{calls.push({name,args});return {data:board,error:null}}},
    cityPriceSnapshot:null,lastCityPriceBoardAt:0
  };
  const ctx={
    liveRuntime,liveReady:()=>status==='ready',
    homeMarketRegion:()=>({city:'São Gabriel',state:'RS'}),
    Date,Promise,Error,Number,String,Array,RegExp,globalThis:null
  };
  ctx.globalThis=ctx;
  vm.runInNewContext(code+'\nglobalThis.readBoard=liveRefreshCityPriceBoard',ctx);
  const out=await ctx.readBoard({force:true});
  assert.equal(out.source,board.source);
  assert.equal(calls.length,1);
  assert.equal(calls[0].name,'public_city_price_board_v1_341');
  assert.equal(calls[0].args.p_city,'São Gabriel');
  assert.equal(out.notAQuote,true);
  const cache=await ctx.readBoard();
  assert.equal(cache,out);
  assert.equal(calls.length,1,'Verified city board should be cached');
}
console.log('PASS V1.1087: guest reads existing aggregate city prices, no Auth user, no quotes or orders.');
