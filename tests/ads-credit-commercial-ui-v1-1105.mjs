// V1.1105: only real regional customer placements may request paid ad
// inventory. The sponsor's arbitrary preview city may not spend a wallet.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const display=read('js/ads-display.js');
const planner=read('js/ads-planner.js');
const studio=read('js/sponsors-premium.js');
const edge=read('supabase/functions/ads-independent/index.ts');
const controls=read('supabase/migrations/20261120204848_ads_credit_campaigns_v1_1098.sql');
for(const [name,code] of Object.entries({display,planner,studio}))
 assert.doesNotThrow(()=>new vm.Script(code,{filename:name+'.js'}));
assert.match(studio,/globalThis\.tamaoAdsCreditModeEnabled=true/);
assert.match(planner,/if\(globalThis\.tamaoAdsCreditModeEnabled===true\)/);
assert.match(studio,/id="tamao-credit-mount"/);
assert.match(edge,/ads_credit_issue_v1_1098/);
assert.match(edge,/ads_credit_confirm_v1_1098/);
assert.match(edge,/p_viewer_hash:viewerHash/);
assert.match(edge,/req\.headers\.get\("cf-connecting-ip"\)/);
assert.match(controls,/balance_cents>=price/);
assert.match(controls,/visible_percent/);
const calls=[];
const ctx={console,URL,Date,Map,Promise,setTimeout,
 CHAMA_BACKEND:{url:'https://example.supabase.co',publishableKey:'publishable'},
 fetch:async(_url,options)=>{calls.push(JSON.parse(options.body));return {
  ok:true,json:async()=>({source:'ads_independent_issue_v1_884',
   slot:null,noCharge:true,billingEnabled:false})}},
 document:{getElementById:()=>({textContent:''})},
 route:()=> 'sponsors'
};
vm.createContext(ctx);
vm.runInContext(display,ctx);
await ctx.tamaoAdsDisplaySlot('São Gabriel','RS','sponsor-ad-live-slot');
assert.equal(calls.length,1);
assert.equal(calls[0].institutionalOnly,true,
 'An advertiser-controlled city is a preview and must never request billable inventory');
await ctx.tamaoAdsDisplaySlot('São Gabriel','RS','tamao-ads-home-slot');
assert.equal(calls.length,2);
assert.equal(calls[1].institutionalOnly,undefined,
 'A genuine known-region customer home retains server-gated regional delivery');
await ctx.tamaoAdsDisplaySlot('São Gabriel','RS','sponsor-ad-live-slot');
assert.equal(calls.length,2,'A negative institutional preview can be cached safely');
assert.doesNotMatch(display,/MERCADOPAGO_ACCESS_TOKEN|APP_USR/);

const adminClient=read('js/admin-ads-credit.js');
const adminApi=read('supabase/functions/ads-credit/index.ts');
assert.match(adminApi,/action==="admin-commercial"/);
assert.match(adminApi,/access\.admin_role!=="superadmin"/);
assert.match(adminApi,/acknowledgeFinancialControls!==true/);
assert.match(adminApi,/\.eq\("version",expected\)\.eq\("cents_per_view",2\)/);
assert.match(adminApi,/readyForFinancialHomologation!==true/);
assert.match(adminApi,/version:expected\+1,updated_by:user\.id/);
const fields={'credit-commercial-ack':{checked:false}};
const auditCalls=[];
let adminRole='superadmin';
const adminCtx={
 adminRuntime:{section:'ads',session:{user:{id:'founder',email:'owner@example.com'}}},
 adminReady:()=>true,adminCurrentRole:()=>adminRole,
 adminMoney:amount=>'R$ '+(amount/100).toFixed(2),
 document:{getElementById:id=>fields[id]||null},
 toast:()=>{},render:()=>{},esc:value=>String(value),console
};
vm.createContext(adminCtx);vm.runInContext(adminClient,adminCtx);
adminCtx.stubbed={
 actor:'founder',status:'ready',rows:[],
 gate:{rechargeEnabled:false,billingEnabled:false,evidenceEnabled:false,
  centsPerView:2,version:1},
 totals:{wallets:1,loaded:1990,spent:0,remaining:1990},error:''
};
vm.runInContext('adminCreditAdsState=stubbed',adminCtx);
assert.match(adminCtx.adminCreditAdsPanel(),/Abrir publicidade por visualização/);
adminCtx.adminCreditAdsRequest=async(action,body)=>{
 auditCalls.push({action,body});
 return {source:'ads_credit_commercial_controls_v1_1105',version:2,
  rechargeEnabled:true,billingEnabled:true,evidenceEnabled:true};
};
adminCtx.adminCreditAdsRefresh=async()=>true;
assert.equal(await adminCtx.adminCreditCommercialRun('open',1),false,
 'Opening requires a real checked Admin consent');
assert.equal(auditCalls.length,0);
fields['credit-commercial-ack'].checked=true;
assert.equal(await adminCtx.adminCreditCommercialRun('open',2),false,
 'An old UI cannot override a newer financial gate');
assert.equal(await adminCtx.adminCreditCommercialRun('open',1),true);
assert.deepEqual(JSON.parse(JSON.stringify(auditCalls[0].body)),{
 operation:'open',expectedVersion:1,acknowledgeFinancialControls:true
});
adminRole='finance';
assert.equal(await adminCtx.adminCreditCommercialRun('pause',1),false,
 'The financial role cannot open or pause commercial billing');
adminRole='superadmin';
adminCtx.stubbed.gate={...adminCtx.stubbed.gate,
 rechargeEnabled:true,billingEnabled:true,evidenceEnabled:true,version:2};
assert.match(adminCtx.adminCreditAdsPanel(),/Pausar cobranças e recargas/);
assert.equal(await adminCtx.adminCreditCommercialRun('pause',2),true);
assert.equal(auditCalls[1].body.operation,'pause');
assert.equal(auditCalls[1].body.expectedVersion,2);

console.log('PASS V1.1105: advertiser previews free, explicit customer-market ads server-gated, no client money credentials.');
