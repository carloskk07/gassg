import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const read=p=>fs.readFileSync(new URL("../"+p,import.meta.url),"utf8");
const sql=read("supabase/migrations/20261016150000_ads_merchant_guided_start_v1_321.sql");
const edge=read("supabase/functions/merchant-ops/index.ts");
const ui=read("js/merchant.js");
const css=read("css/components.css");
new vm.Script(ui,{filename:"js/merchant.js"});
for(const token of [
 "merchant_ads_start_read_v1_321","security definer",
 "set search_path to 'pg_catalog'","mm.user_id=p_actor","mm.merchant_id=p_merchant",
 "mm.active","mm.member_role in ('owner','manager')",
 "merchant_ads_interest_v1_232","merchant_ads_campaigns_v1_233",
 "merchant_business_details","catalog_items","product_delivery_profiles",
 "pr.active","ci.active","m.status",
 "v_creative.target_city=v_city","v_creative.category_key='all'",
 "'noAutomaticEnrollment',true","'readOnly',true","'noCharge',true","'adsLive',false",
 "grant execute on function public.merchant_ads_start_read_v1_321(uuid,uuid) to service_role",
 "revoke all on function public.merchant_ads_start_read_v1_321(uuid,uuid) from public,anon,authenticated"
])assert.ok(sql.includes(token),"Missing SQL readiness guard: "+token);
assert.ok(!/\b(insert|update|delete)\s+(into\s+|from\s+)?public\./i.test(sql),"read-only function cannot mutate data");
for(const t of [
 '"ads-start-read"','if(action==="ads-start-read")',
 'admin.rpc("merchant_ads_start_read_v1_321"',
 'data.noAutomaticEnrollment!==true',
 'data.readyToSubmit!==(','data.matchingActiveCatalogCount'
])assert.ok(edge.includes(t),"Missing merchant Edge check: "+t);
for(const t of [
 'merchantAdsStartSection(m)','function merchantAdsStartSection(',
 'async function merchantAdsStartLoad()',
 'function merchantAdsStartNavigate(',
 'function merchantAdsCreativeExample()',
 'rt.adsStart=null','id="merchant-ads-start"',
 'merchant-workspace-setup','merchant-ads-campaigns','merchant-ads-interest'
])assert.ok(ui.includes(t),"Missing merchant UX behavior: "+t);
assert.ok(css.includes(".merchant-ads-start-step"));
const merchantId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const record={
 source:"merchant_ads_start_read_v1_321",merchantId,
 readOnly:true,noCharge:true,adsLive:false,noAutomaticEnrollment:true,
 merchantActive:true,businessCityReady:true,creativeCityCurrent:true,
 interestRegistered:false,activeCatalogReady:true,matchingActiveCatalogCount:2,
 creativeStatus:null,creativeVersion:0,readyToSubmit:false,nextAction:"register_interest"
};
let calls=[],notices=[];
const rt={merchant:{merchantId,memberRole:"owner"}};
const tail=ui.slice(ui.indexOf("// TAMÃO V1.321 — the next useful step"));
const ctx=vm.createContext({
 merchantRuntime:rt,
 merchantInvoke:async(_,x)=>{calls.push(x);return {...record};},
 render:()=>{},toast:x=>notices.push(x),esc:x=>String(x),
 document:{getElementById:()=>null},
 Number,String,Promise,Object
});
vm.runInContext(tail+"\nthis.load=merchantAdsStartLoad;this.view=merchantAdsStartSection;this.example=merchantAdsCreativeExample;",ctx);
assert.equal((await ctx.load()).nextAction,"register_interest");
assert.match(ctx.view(rt.merchant),/Registrar interesse sem compromisso/);
assert.equal(calls.length,1);
assert.equal(await ctx.example(),false);
record.interestRegistered=true;
record.creativeStatus="draft";
record.creativeVersion=1;
record.readyToSubmit=true;
record.nextAction="submit_creative";
assert.equal((await ctx.load()).readyToSubmit,true);
assert.match(ctx.view(rt.merchant),/Enviar apresentação para análise/);
record.noCharge=false;
assert.equal(await ctx.load(),null);
assert.ok(rt.adsStartError);
rt.merchant.memberRole="support";
assert.equal(ctx.view(rt.merchant),"");
console.log("V1.321 PASS — server-scoped Ads onboarding, real checklist gates, safe no-charge UX.");
