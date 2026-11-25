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
assert.match(planner,/liveUpgradeAccount\(email,\{fullName,phone,returnToSponsor:true\}\)/);
assert.match(planner,/tamaoClubSendAccess\(email,\{returnToSponsor:true\}\)/);
assert.match(planner,/sponsor-account-name/);
assert.match(planner,/sponsor-account-phone/);
assert.match(planner,/sponsor-account-login-email/);
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
assert.match(growth,/function tamaoAdsPlannerLoad\(\)/);
assert.match(planner,/function tamaoAdsLoadHome\(\)/);
assert.match(planner,/ads-display\.js/);
assert.match(home,/tamaoAdsLoadHomeDirect\(\)/);
assert.doesNotMatch(home,/tamaoAdsPlannerLoad\(\)/);
assert.equal((home.match(/\$\{adHomeSlot\}/g)||[]).length,2,
 'Both public home routes need an eligible sponsored placement independent of merchants');
for(const term of [
 'IntersectionObserver','intersectionRatio','document.visibilityState',
 'document.hasFocus()','Math.floor(ratio*100)',
 "action:'confirm'","visibleMs:Math.min(60000,elapsed)",
 "'nofollow noopener noreferrer sponsored'",
 'referrerpolicy="no-referrer"',"'/functions/v1/ads-independent'",
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
assert.match(read('js/admin.js'),/adminAdsIndependentSection\(\)/);
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

const loaderStart=growth.indexOf('function tamaoAdsLoadHomeDirect(){');
const loaderEnd=growth.indexOf('function tamaoAdsPlannerLoad(){',loaderStart);
assert.ok(loaderStart>0&&loaderEnd>loaderStart);
let page='sponsors',sequence=0,draws=0;
const scripts=[],timers=new Map();
const homeLoader=vm.createContext({URL,location:{origin:'https://tamao.com.br'},
 route:()=>page,setTimeout:(fn,ms)=>{timers.set(++sequence,{fn,ms});return sequence;},
 clearTimeout:id=>timers.delete(id),
 document:{querySelector:()=>({src:'https://tamao.com.br/js/growth.js?v=release-sha'}),
  createElement:()=>({remove(){this.removed=true}}),head:{appendChild:s=>scripts.push(s)}}});
vm.runInContext(growth.slice(loaderStart,loaderEnd),homeLoader);
homeLoader.tamaoAdsLoadHomeDirect();
assert.equal(scripts.length,0,'no home ad load off route');
page='home';homeLoader.tamaoAdsLoadHomeDirect();homeLoader.tamaoAdsLoadHomeDirect();
assert.equal(scripts.length,1);
assert.equal(scripts[0].src,'https://tamao.com.br/js/ads-display.js?v=release-sha');
assert.equal([...timers.values()][0].ms,15000);
[...timers.values()][0].fn();
assert.equal(scripts[0].removed,true);
assert.equal(timers.size,0);
homeLoader.tamaoAdsLoadHomeDirect();
assert.equal(scripts.length,2);
homeLoader.tamaoAdsDisplayHome=()=>draws++;
scripts[0].onload();
assert.equal(draws,0,'late callback ignored');
page='sponsors';scripts[1].onload();
assert.equal(draws,0,'navigation away cannot display home ad');
page='home';homeLoader.tamaoAdsLoadHomeDirect();
assert.equal(scripts.length,2);
[...timers.values()][0].fn();
assert.equal(draws,1);
console.log('PASS: home ad display bypasses advertiser planner, retains version and route boundaries.');
