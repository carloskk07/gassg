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
console.log('PASS V1.1105: advertiser previews free, explicit customer-market ads server-gated, no client money credentials.');
