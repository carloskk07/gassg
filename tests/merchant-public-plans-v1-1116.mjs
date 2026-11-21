import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const edge=read('supabase/functions/merchant-public-plans/index.ts');
const browser=read('js/merchant-public-plans.js'),growth=read('js/growth.js');
const config=read('supabase/config.toml'),audit=read('scripts/audit-edge-functions.sh');
assert.ok(config.includes('[functions.merchant-public-plans]\nverify_jwt = false'));
assert.ok(audit.includes('supabase/functions/merchant-public-plans/index.ts)'));
assert.ok(edge.includes('consume_hashed_api_quota')&&edge.includes('getReader()'));
assert.ok(!edge.includes('auth.getUser')&&!edge.includes('req.text()'));
assert.ok(!/grant\s+.*\s+on\s+public\.merchant_billing_plans/i.test(edge));
assert.ok(growth.includes("tamaoMerchantPublicPlans?.status==='ready'"));
assert.ok(growth.includes("safePlanName(p.name)"));
assert.ok(growth.includes('merchant-public-plans.js?v=1117'));
const plans=[
 {plan_key:'flex_daily',display_name:'Flex Diário',billing_mode:'postpaid_daily',platform_fee_bps:900,purchase_amount_cents:null,credit_grant_cents:null,active:true,sort_order:10},
 {plan_key:'credit_01990',display_name:'Essencial',billing_mode:'prepaid_credit',platform_fee_bps:800,purchase_amount_cents:1990,credit_grant_cents:1990,active:true,sort_order:20},
 {plan_key:'credit_04990',display_name:'Popular',billing_mode:'prepaid_credit',platform_fee_bps:750,purchase_amount_cents:4990,credit_grant_cents:4990,active:true,sort_order:30},
 {plan_key:'credit_09990',display_name:'Profissional',billing_mode:'prepaid_credit',platform_fee_bps:700,purchase_amount_cents:9990,credit_grant_cents:9990,active:true,sort_order:40},
 {plan_key:'credit_19990',display_name:'Alto Volume',billing_mode:'prepaid_credit',platform_fee_bps:650,purchase_amount_cents:19990,credit_grant_cents:19990,active:true,sort_order:50}
];
let handler=null,quotaAllowed=true,rows=plans,queries=[];
const env={
 SUPABASE_URL:'https://example.supabase.co',
 SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({default:'sb_publishable_test'}),
 SUPABASE_SECRET_KEYS:JSON.stringify({default:'server-only-secret-key'})
};
const admin={
 rpc:async(name,args)=>{queries.push({name,args});assert.equal(name,'consume_hashed_api_quota');return {data:{allowed:quotaAllowed},error:null}},
 from:name=>{assert.equal(name,'merchant_billing_plans');return {
  select:fields=>{assert.ok(fields.includes('platform_fee_bps'));assert.ok(!fields.includes('merchant_id'));return {
   eq:(field,value)=>{assert.equal(field,'active');assert.equal(value,true);return {
    order:(field)=>{assert.equal(field,'sort_order');queries.push({name:'merchant_billing_plans'});return Promise.resolve({data:rows,error:null})}
   }}
  }}
 }}
};
const edgeContext={
 Deno:{env:{get:k=>env[k]},serve:fn=>{handler=fn}},
 createClient:()=>admin,crypto:webcrypto,TextEncoder,TextDecoder,Response,Request,console:{error:()=>{}}
};
const runnable=edge.replace(/^import .+;\r?\n/gm,'')
 .replaceAll('origin:string|null','origin')
 .replaceAll('value:unknown','value')
 .replaceAll('status:number','status')
 .replaceAll('value:string','value')
 .replaceAll('req:Request','req');
vm.runInNewContext(runnable,edgeContext);
assert.equal(typeof handler,'function');
const request=(origin='https://tamao.com.br',key='sb_publishable_test',body='{}')=>
 new Request('https://example.supabase.co/functions/v1/merchant-public-plans',{
 method:'POST',headers:{Origin:origin,apikey:key,'Content-Type':'application/json',
 'x-forwarded-for':'203.0.113.21'},body
 });
let result=await handler(request('https://invalid.test'));
assert.equal(result.status,403);
result=await handler(request('https://tamao.com.br','bad-key'));
assert.equal(result.status,401);
result=await handler(request('https://tamao.com.br','sb_publishable_test','{"merchantId":"secret"}'));
assert.equal(result.status,400);
assert.equal(queries.length,0,'Blocked requests cannot access service-role SQL');
result=await handler(request());
assert.equal(result.status,200);
const good=await result.json();
assert.equal(good.source,'merchant_billing_plans');
assert.equal(good.verified,true);
assert.equal(good.plans.length,5);
assert.deepEqual(Object.keys(good.plans[0]).sort(),
 ['planKey','displayName','billingMode','platformFeeBps','purchaseAmountCents','creditGrantCents','sortOrder'].sort());
assert.ok(!JSON.stringify(good).includes('server-only'));
assert.equal(good.plans[0].platformFeeBps,900);
assert.equal(good.plans[4].platformFeeBps,650);
assert.deepEqual(queries.map(q=>q.name),['consume_hashed_api_quota','merchant_billing_plans']);
quotaAllowed=false;queries=[];
result=await handler(request());assert.equal(result.status,429);
assert.deepEqual(queries.map(q=>q.name),['consume_hashed_api_quota']);
quotaAllowed=true;rows=[...plans,{...plans[3],plan_key:'credit_bad',credit_grant_cents:1}];queries=[];
result=await handler(request());assert.equal(result.status,503,'Incomplete credit funding fails closed');
rows=plans;

const source=browser.slice(0,browser.indexOf('\nglobalThis.tamaoMerchantPublicPlans='));
assert.ok(source.includes('function merchantPublicPlansValid'));
let renders=0,requests=[],next=good,status=200;
const ctx={
 globalThis:null,CHAMA_BACKEND:{url:'https://example.supabase.co',publishableKey:'sb_publishable_test'},
 chamaFetch:async(url,init)=>{requests.push({url,init});return {ok:status===200,status,json:async()=>next}},
 route:()=> 'merchants',render:()=>renders++,fetch:()=>{},Date,JSON,Promise,Number,String,Array,Object,Error,Set
};
ctx.globalThis=ctx;
vm.runInNewContext(source+';this.load=tamaoMerchantPublicPlansLoad;this.valid=merchantPublicPlansValid;this.state=merchantPublicPlansState;',ctx);
assert.equal(ctx.valid(good),true);
await ctx.load();
assert.equal(ctx.state.status,'ready');
assert.equal(ctx.state.plans[0].bps,900);
assert.equal(ctx.state.plans[4].bps,650);
assert.equal(renders,1);
assert.equal(requests.length,1);
assert.equal(requests[0].init.headers.apikey,'sb_publishable_test');
assert.equal(requests[0].init.headers.Authorization,undefined);
await ctx.load();assert.equal(requests.length,1,'Fresh verified catalogue caches without extra charges');
ctx.state.checkedAt=0;
next={...good,plans:[...good.plans,{...good.plans[1]}]};
await ctx.load();
assert.equal(ctx.state.status,'unavailable','Duplicates must not masquerade as verified plans');
assert.equal(ctx.state.plans,null);
assert.equal(renders,2);
console.log('V1.1116 PASS: public live rate projection, rate limit, input cap, no account data, reader integrity and fallback.');
