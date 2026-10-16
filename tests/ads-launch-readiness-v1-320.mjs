import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016140000_ads_launch_readiness_v1_320.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-activations.js'),css=read('css/components.css');
new vm.Script(ui,{filename:'admin-activations.js'});
for(const term of [
 'admin_ads_launch_readiness_v1_320',
 "a.admin_role in ('superadmin','operations','readonly')",
 'v_plans','v_creatives','v_interests','v_dossiers','v_bilateral',
 'v_issued','v_checkouts','v_approved','v_stale','v_reversed',
 "'readOnly',true","'verifiedRevenueCents',null",
 "'providerLookupPerformed',false","'publicAdsVerified',false",
 "'noAutomaticActivation',true","'merchantBillingSeparate',true",
 'ads_placement_controls_v1_236','platform_ads_psp_checkouts_v1_314',
 'revoke all on function public.admin_ads_launch_readiness_v1_320(uuid)',
 'to service_role'
])assert.ok(sql.includes(term),'Missing SQL protection: '+term);
assert.doesNotMatch(sql,/\b(insert into|update|delete from|alter table)\b/i);
assert.ok(edge.includes('"ads-launch-readiness"'));
assert.ok(edge.includes('admin.rpc("admin_ads_launch_readiness_v1_320"'));
assert.ok(edge.includes('data.verifiedRevenueCents!==null'));
assert.ok(edge.includes('data.publicAdsVerified!==false'));
assert.ok(edge.includes('providerLookupPerformed!==false'));
assert.ok(edge.includes('ADS_MP_CHECKOUT_ENABLED'));
assert.ok(edge.includes('ADS_MP_ACCESS_TOKEN'));
assert.ok(edge.includes('ADS_MP_SELLER_ID'));
assert.ok(!edge.includes('liveAccountVerified:true'));
assert.ok(ui.includes("['adsLaunch','ads-launch-readiness','admin_ads_launch_readiness_v1_320']"));
assert.ok(ui.includes('adminAdsLaunchReadinessView()'));
assert.ok(css.includes('.admin-ads-launch-steps'));
let role='superadmin',user='owner';
const data={source:'admin_ads_launch_readiness_v1_320',readOnly:true,
 snapshotAt:'2026-10-16T00:00:00Z',noAutomaticActivation:true,providerLookupPerformed:false,
 merchantBillingSeparate:true,verifiedRevenueCents:null,publicAdsVerified:false,
 creativesApproved:0,plansContactReady:0,merchantInterests:0,dossiersReviewed:0,
 bilateralAcceptances:0,statementsIssued:0,checkoutsReady:0,lastKnownApprovedPayments:0,
 staleApprovals24h:0,reversalsRecorded:0,publicEnabled:false,billingEnabled:false,
 verifiedDeliveryEnabled:false,platformPspConfig:{explicitlyEnabled:false,
 providerTokenConfigured:false,providerSellerConfigured:false,
 canAttemptAuthenticatedLookup:false,liveAccountVerified:false,providerCharged:false}};
const desk={data:{adsLaunch:data},role,actor:user,checkedAt:new Date().toISOString()};
const part=ui.slice(ui.indexOf('// V1.320 — one founder-readable pathway'));
assert.ok(part.startsWith('// V1.320'));
const ctx=vm.createContext({
 adminRuntime:{session:{user:{id:user}}},
 adminCurrentRole:()=>role,adminRoleCanSection:()=>role!=='support',
 adminActivationDesk:desk,
 esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;'),
 Date,String,Number
});
vm.runInContext(part+'\nthis.show=adminAdsLaunchReadinessView;',ctx);
let output=ctx.show();
assert.match(output,/O que falta para faturar/);
assert.match(output,/Próximo foco: Criativos aprovados/);
assert.match(output,/Receita liquidada ainda sem comprovação/);
assert.match(output,/Não configurado/);
assert.doesNotMatch(output,/onclick="adminPerform/);
data.creativesApproved=2;data.plansContactReady=1;
output=ctx.show();
assert.match(output,/Próximo foco: Revendas interessadas/);
role='support';assert.equal(ctx.show(),'');
role='superadmin';desk.data.adsLaunch=null;
assert.match(ctx.show(),/Diagnóstico ainda não confirmado/);
console.log('V1.320 PASS — evidence-based launch steps, no fake verified revenue, founder setup gates and mobile-friendly read-only UI.');
