import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016020000_marketing_intake_control_v1_308.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-activations.js');
new vm.Script(ui,{filename:'admin-activations.js'});

for(const marker of [
  'enable row level security','revoke all on table public.platform_marketing_intake_v1_308',
  "'ads_proposals',true","'clube_proposals',true",
  "a.admin_role='superadmin'","from public.platform_admins a",
  'for update','MARKETING_INTAKE_VERSION_CONFLICT','platform_admin_audit',
  "'marketing-intake-set'","'commercial_intake'",
  'revoke all on function public.admin_marketing_intake_set_v1_308',
  'grant execute on function public.admin_marketing_intake_set_v1_308',
  "p_operation='register' and not public.marketing_intake_enabled_v1_308('ads_proposals')",
  "p_action in ('save','submit') and not public.marketing_intake_enabled_v1_308('ads_proposals')",
  "p_operation='register' and not public.marketing_intake_enabled_v1_308('clube_proposals')",
  "using errcode='42501'"
])assert.ok(sql.includes(marker),'missing SQL gate: '+marker);
assert.ok(!sql.includes('update public.platform_launch_control'));
assert.ok(!sql.includes('update public.merchant_billing_'));
assert.ok(!sql.includes('update public.ads_placement_controls'));
assert.ok(!sql.includes('insert into public.orders'));
assert.ok(!sql.includes('update public.merchant_ads_campaigns_v1_233 set ads_live'));
assert.ok(sql.includes('return clube_internal_v1_240.merchant_interest('));
assert.ok(sql.includes('return ads_internal_v1_233.merchant_campaign('));
assert.ok(sql.includes('return growth_internal_v1_232.ads_interest_v1_232('));
for(const marker of [
  '"commercial-intake-read"','if(action==="commercial-intake-read")',
  'if(action==="commercial-intake-set")',
  'String(adminAccess.admin_role||"")!=="superadmin"',
  'admin.rpc("admin_marketing_intake_set_v1_308"',
  'p_actor:user.id','p_expected_version:body.expectedVersion',
  'data.noMoneyMovement!==true','data.couponSalesEnabled!==false',
  'data.adsPublicationEnabled!==false'
])assert.ok(edge.includes(marker),'missing authenticated Edge contract: '+marker);
assert.ok(!edge.match(/ADMIN_READ_ACTIONS=new Set\(\["commercial-intake-set"/));

let role='superadmin',ready=true,user='owner',confirmReturn=false;
let reason='Controle de entrada ajustado',performed=[],refreshed=0,toasts=[];
const row={moduleKey:'ads_proposals',enabled:true,version:1,reason:'previous'};
const runtime={session:{user:{id:user}}};
const state=vm.createContext({
 adminRuntime:runtime,adminCurrentRole:()=>role,adminReady:()=>ready,
 adminRoleCanSection:s=>['superadmin','operations','readonly'].includes(role),
 adminPerform:async(action,payload)=>{
   performed.push({action,payload});
   return {source:'admin_marketing_intake_set_v1_308',moduleKey:payload.moduleKey,
      enabled:payload.enabled,version:2,changed:true,
      adsPublicationEnabled:false,couponSalesEnabled:false,noMoneyMovement:true};
 },
 adminInvoke:async({action})=>action==='commercial-intake-read'?{
   source:'admin_marketing_intake_v1_308',readOnly:true,noMoneyMovement:true,
   adsPublicationEnabled:false,couponSalesEnabled:false,
   controls:[{moduleKey:'ads_proposals',enabled:performed.length===0,version:1+performed.length,reason:'confirmed'},
     {moduleKey:'clube_proposals',enabled:true,version:3,reason:'unchanged'}]}:null,
 adminLoadGovernanceGates:async()=>null,
 adminPushReliabilityLoadFromUi:async()=>null,
 confirm:()=>confirmReturn,prompt:()=>reason,toast:t=>toasts.push(t),
 esc:s=>String(s).replaceAll('<','&lt;'),formatDateTime:s=>s,
 adminSetSection:()=>{},requestAnimationFrame:()=>{},render:()=>{},
 Number,String,Date,Promise,Set
});
vm.runInContext(ui+'\nthis.change=adminMarketingIntakeSet;this.intake=adminMarketingIntakeView;this.desk=adminActivationDesk;',state);
state.desk.actor='owner';state.desk.role='superadmin';
state.desk.checkedAt=new Date().toISOString();
state.desk.data={intake:{source:'admin_marketing_intake_v1_308',controls:[
 row,{moduleKey:'clube_proposals',enabled:true,version:3,reason:'previous'}]}};
assert.match(state.intake(),/Recebendo propostas/);
assert.match(state.intake(),/adminMarketingIntakeSet\('ads_proposals'\)/);
assert.equal(await state.change('unknown'),false);
confirmReturn=false;assert.equal(await state.change('ads_proposals'),false);
confirmReturn=true;reason='abc';assert.equal(await state.change('ads_proposals'),false);
assert.equal(performed.length,0);
reason='Suspender temporariamente novas propostas';
assert.equal(await state.change('ads_proposals'),true);
assert.equal(performed.length,1);
assert.equal(performed[0].action,'commercial-intake-set');
assert.equal(performed[0].payload.expectedVersion,1);
assert.equal(performed[0].payload.enabled,false);
assert.equal(state.desk.data.intake.controls[0].enabled,false);
assert.equal(state.desk.data.intake.controls[0].version,2);
role='operations';state.desk.data={intake:{controls:[row]}};
state.desk.role='operations';
assert.doesNotMatch(state.intake(),/adminMarketingIntakeSet\('ads_proposals'\)/);
assert.equal(await state.change('ads_proposals'),false);
role='superadmin';
state.desk.role='superadmin';
state.desk.checkedAt='2000-01-01T00:00:00Z';
assert.equal(await state.change('ads_proposals'),false);
assert.match(state.intake(),/Não confirmado/);
role='support';assert.equal(state.intake(),'');
console.log('V1.308 PASS — founder-only versioned and audited proposal intake, protected RPC, safe existing views/withdrawals and fail-closed UI.');
