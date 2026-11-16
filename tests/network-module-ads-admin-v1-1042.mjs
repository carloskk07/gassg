import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const admin=read('js/admin.js');
const edge=read('supabase/functions/admin-ops/index.ts');
const audit=read('.github/workflows/audit.yml');
new vm.Script(admin,{filename:'js/admin.js'});
assert.match(edge,/if\(action==="network-fee-package-status"\)/);
assert.match(edge,/moduleAds:?[a-zA-Z]*/, 'Admin response must have separate module Ads readback');
for(const t of ['network_module_ads_bonus_policy_v1_1041',
 'network_module_ads_bonus_awards_v1_1041','network_module_ads_bonus_set_enabled_v1_1041']){
 assert.ok(edge.includes(t),'Expected verified network Ads source '+t);
}
assert.match(edge,/if\(action==="network-module-ads-set-enabled"\)\{\s*if\(String\(adminAccess\.admin_role\)!=="superadmin"\)/);
assert.match(edge,/data\.cashPayoutsEnabled!==false/);
assert.match(edge,/moneyMoved:false/);
assert.match(edge,/adsPolicy\.data\.enabled/);
assert.match(edge,/adsValidated\.count/);
assert.match(edge,/adsReversed\.count/);
assert.match(admin,/adminNetworkAdsBonusPanel\(\)\+/,'Benefits appear alongside existing 10% account panel');
const start=admin.indexOf('async function adminNetworkAdsBonusToggle(');
const end=admin.indexOf('function adminNetworkFeePackagePanel()',start);
assert.ok(start>0&&end>start,'Policy control isolated in Growth tab');
const calls=[],toasts=[],confirms=[];
let role='superadmin';
const ctx=vm.createContext({
 adminNetworkFeePackageState:{moduleAds:{source:'network_module_ads_admin_v1_1042',
  readOnly:true,cashPayoutsEnabled:false,enabled:false,inviterBps:500,maturityDays:7,
  validatedAwards:0,reversedAwards:0}},
 adminCurrentRole:()=>role,
 adminPerform:async(action,payload)=>{calls.push({action,payload});return {
  source:'network_ads_bonus_policy_v1_1041',enabled:payload.enabled,cashPayoutsEnabled:false,moneyMoved:false};},
 adminNetworkFeePackageRefresh:async()=>null,
 document:{getElementById:()=>({value:''})},
 toast:s=>toasts.push(s),
 confirm:s=>{confirms.push(s);return true}
});
vm.runInContext('let adminNetworkFeePackageBusy=false;\n'+admin.slice(start,end)+
 '\nthis.panel=adminNetworkAdsBonusPanel;this.toggle=adminNetworkAdsBonusToggle;',ctx);
const html=ctx.panel();
assert.match(html,/Indicação de anunciantes/);
assert.match(html,/Apuração desativada/);
assert.match(html,/Bonificações verificadas/);
assert.match(html,/7 dias/);
assert.match(html,/Ativar somente para campanhas futuras/);
assert.match(html,/Ganhos ainda não são sacáveis/);
await ctx.toggle(true);
assert.equal(calls.length,0,'Missing legal terms cannot enable paid program');
assert.match(toasts.at(-1),/termos aprovados/);
ctx.document.getElementById=()=>({value:'TERMS-APPROVED-OWNER-2026-11'});
await ctx.toggle(true);
assert.equal(calls.length,1);
assert.equal(calls[0].action,'network-module-ads-set-enabled');
assert.equal(calls[0].payload.enabled,true);
assert.equal(calls[0].payload.termsReference,'TERMS-APPROVED-OWNER-2026-11');
assert.match(confirms.at(-1),/saque permanecerá bloqueado/);
role='finance';
assert.doesNotMatch(ctx.panel(),/Ativar somente para campanhas futuras/,'Finance role is read-only');
await ctx.toggle(false);
assert.equal(calls.length,1,'Finance cannot mutate Ads bonus policy');
role='superadmin';
ctx.adminNetworkFeePackageState.moduleAds.enabled=true;
assert.match(ctx.panel(),/Suspender novas apurações de anúncios/);
await ctx.toggle(false);
assert.equal(calls.length,2);
assert.equal(calls[1].payload.enabled,false);
assert.equal(calls[1].payload.termsReference,'');
assert.match(audit,/node tests\/network-module-ads-admin-v1-1042\.mjs/);
console.log('V1.1042 PASS — gated Ads benefits readback, owner-only toggle, read-only Finance, no payouts, CLI budget-independent.');
