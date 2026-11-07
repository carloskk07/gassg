import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const planner=read('js/ads-planner.js'),display=read('js/ads-display.js');
const growth=read('js/growth.js'),home=read('js/customer.js');
const admin=read('js/admin-ads-independent.js');
const adminShell=read('js/admin-acquisition.js'),server=read('supabase/functions/admin-ops/index.ts');
const edge=read('supabase/functions/ads-independent/index.ts');
for(const [name,source] of Object.entries({planner,display,growth,home,admin,adminShell}))
 assert.doesNotThrow(()=>new vm.Script(source,{filename:name+'.js'}),'Invalid '+name);
assert.match(planner,/function tamaoAdsCampaignForm\(\)/);
assert.match(planner,/tamaoAdsAccountVerified\(\)/);
assert.match(planner,/liveUpgradeAccount\(email\)/);
assert.match(planner,/async function tamaoAdsSubmitCampaign\(\)/);
assert.match(planner,/liveInvoke\('ads-independent'/);
assert.match(planner,/action:'submit',requestId:tamaoAdsDraftRequestId/);
assert.match(planner,/if\(!tamaoAdsDraftRequestId\)tamaoAdsDraftRequestId=crypto\.randomUUID\(\)/);
assert.match(planner,/response|paymentCreated!==false/i);
assert.match(planner,/function tamaoAdsCampaignForm/);
assert.match(planner,/tamaoAdsCampaignForm\(\)/);
assert.match(planner,/Ver publicidade ativa nesta cidade/);
assert.match(planner,/function tamaoAdsShowCityPublic/);
assert.match(planner,/tamaoAdsDisplaySlot\?\.\(city,state,'sponsor-ad-live-slot'\)/);
assert.match(growth,/function tamaoAdsHomeLoad\(\)/);
assert.match(growth,/ads-display\.js/);
assert.equal((home.match(/\$\{tamaoAdsHomeLoad\(\)\}/g)||[]).length,2,
 'Both public home routes need an eligible sponsored placement independent of merchants');
for(const term of [
 'IntersectionObserver','intersectionRatio','document.visibilityState',
 'document.hasFocus()','Math.floor(ratio*100)',
 "action:'confirm'","visibleMs:Math.min(60000,elapsed)",
 'rel="nofollow noopener noreferrer sponsored"',
 'referrerpolicy="no-referrer"',"'ads-independent'",
 'tamaoAdsSafeUrl','if(!slot){host.textContent',
 'tamaoAdsViewportCleanup','tamaoAdsDisplayHome',
 "typeof CHAMA_BACKEND!=='undefined'"
])assert.ok(display.includes(term),'Ad visibility/label/integrity missing '+term);
assert.doesNotMatch(display,/APP_USR|MERCADOPAGO|create.*payment|_payment_created/i);
assert.match(admin,/function adminAdsIndependentSection/);
assert.match(admin,/adminIndependentAdsAction/);
assert.match(admin,/adminIndependentAdsRefresh/);
assert.match(admin,/adminPerform\('ads-independent-action'/);
assert.match(admin,/r\?\.billingEnabled!==false\|\|r\?\.paymentCreated!==false/);
assert.match(adminShell,/function adminAdsIndependentLoad\(\)/);
assert.match(adminShell,/adminAdsIndependentSection\(\)/);
assert.match(server,/if\(action==="ads-independent-action"\)/);
assert.match(server,/admin_ads_independent_action_v1_884/);
assert.match(server,/String\(adminAccess\.admin_role\|\|""\)!=="superadmin"/);
assert.match(server,/if\(action==="ads-independent-read"\)/);
assert.match(edge,/if\(action==="serve"\)/);
assert.match(edge,/if\(action==="confirm"\)/);
assert.match(edge,/if\(action==="submit"\|\|action==="mine"\)/);
const vmContext=vm.createContext({
 globalThis:{liveRuntime:{status:'ready',session:{user:{id:'u',email_confirmed_at:'2026-11-07',is_anonymous:false}}},
  liveReady:()=>true},
 liveUpgradeAccount:()=>Promise.resolve({alreadyPermanent:true}),
 liveInvoke:()=>Promise.resolve({}),document:{getElementById:()=>null},
 toast:()=>{},console
});
vm.runInContext(planner+';this.renderAdForm=tamaoAdsCampaignForm;',vmContext);
const html=vmContext.renderAdForm();
assert.match(html,/Enviar campanha para revisão/);
assert.match(html,/Sem revenda, sem cobrança antecipada/);
assert.match(html,/Minhas campanhas/);
assert.match(html,/sponsor-ad-url/);
assert.doesNotMatch(html,/onclick=".*[Cc]obrar|Gerar Pix/);
console.log('V1.884 UI PASS: independent advertiser submission, private Admin moderation, real identified display and NO payment.');
