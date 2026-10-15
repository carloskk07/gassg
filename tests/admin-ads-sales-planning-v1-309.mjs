import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016030000_ads_sales_planning_v1_309.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-activations.js');
const css=read('css/components.css');
new vm.Script(ui,{filename:'admin-activations.js'});

for(const token of [
 'platform_ads_sales_plans_v1_309','platform_ads_sales_plan_requests_v1_309',
 'enable row level security','revoke all on public.platform_ads_sales_plans_v1_309',
 'revoke all on public.platform_ads_sales_plan_requests_v1_309',
 "a.admin_role='superadmin'","a.admin_role in ('superadmin','operations','readonly')",
 "c.status='approved_creative'","p_creative_version","for update",
 'ADS_PLAN_CREATIVE_NOT_APPROVED','ADS_PLAN_VERSION_CONFLICT','ADS_PLAN_REQUEST_REUSE',
 'platform_admin_audit','ads-commercial-plan','p_request uuid',
 "'noCharge',true","'adsLive',false","'merchantNotified',false",
 "'paymentCreated',false","'contractSigned',false"
])assert.ok(sql.includes(token),'SQL guard: '+token);
assert.ok(!/update public\.merchant_ads_campaigns_v1_233/.test(sql));
assert.ok(!/insert into public\.(orders|payments|merchant_billing_)/.test(sql));
for(const token of [
 '"ads-sales-plans"','if(action==="ads-sales-plans")',
 'if(action==="ads-sales-plan-save")',
 'admin_ads_sales_plans_read_v1_309','admin_ads_sales_plan_save_v1_309',
 'String(adminAccess.admin_role||"")!=="superadmin"',
 'p_actor:user.id','p_expected_version:expectedVersion',
 'data.adsLive!==false','data.noCharge!==true',
 'data.contractSigned!==false','data.paymentCreated!==false'
])assert.ok(edge.includes(token),'Edge contract: '+token);
assert.ok(css.includes('.admin-ads-plan-fields'));
assert.ok(ui.includes('adminAdsSalesPlansView()'));
assert.ok(ui.includes('adminAdsSalesPlanSave('));

let role='superadmin',calls=[],notify=[],allowed=true,confirmReturn=true,price='99',days='14',stage='ready_for_contact',note='Reunião inicial para definir valores';
let plan={merchantId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',companyName:'Loja fictícia',title:'Peça aprovada',
 city:'Cidade exemplo',state:'RS',creativeVersion:5,planCreativeVersion:null,creativeEligible:true,
 priceCents:null,durationDays:null,stage:null,note:null,version:0};
const runtime={session:{user:{id:'owner'}},governance:{}};
const env=vm.createContext({
 adminRuntime:runtime,adminReady:()=>allowed,adminCurrentRole:()=>role,
 adminRoleCanSection:s=>['superadmin','operations','readonly'].includes(role),
 adminInvoke:async({action})=>{
   calls.push(action);
   if(action==='ads-sales-plans')return {source:'admin_ads_sales_plans_v1_309',readOnly:true,
     noCharge:true,adsLive:false,revenueCents:0,contractsSigned:0,independentlyMeasuredImpressions:0,
     totalPlans:plan.version>0?1:0,approvedCreatives:1,rows:[{...plan}]};
   return null;
 },
 adminLoadGovernanceGates:async()=>null,adminPushReliabilityLoadFromUi:async()=>null,
 adminPerform:async(action,args)=>{
   calls.push({action,args});
   plan={...plan,version:1,planCreativeVersion:5,priceCents:args.priceCents,
     durationDays:args.durationDays,stage:args.stage,note:args.note};
   return {source:'admin_ads_sales_plan_save_v1_309',merchantId:args.merchantId,
     version:1,noCharge:true,adsLive:false,contractSigned:false,paymentCreated:false,merchantNotified:false};
 },
 crypto:{randomUUID:()=> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},
 document:{getElementById:id=>({value:id.endsWith('-price')?price:id.endsWith('-days')?days:
    id.endsWith('-stage')?stage:note})},
 confirm:()=>confirmReturn,toast:t=>notify.push(t),
 esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;'),
 formatDateTime:s=>s,render:()=>{},
 Number,String,Date,Promise,Set,Math,NaN
});
vm.runInContext(ui+'\nthis.reload=adminActivationLoad;this.salesView=adminAdsSalesPlansView;this.savePlan=adminAdsSalesPlanSave;',env);
assert.ok(await env.reload({force:true}));
assert.match(env.salesView(),/Planejamento comercial de anúncios/);
assert.match(env.salesView(),/Loja fictícia/);
assert.match(env.salesView(),/Nenhuma cobrança/);
price='9';
assert.equal(await env.savePlan(plan.merchantId),false);
price='99';note='curta';
assert.equal(await env.savePlan(plan.merchantId),false);
note='Reunião inicial para definir valores';confirmReturn=false;
assert.equal(await env.savePlan(plan.merchantId),false);
assert.ok(!calls.some(x=>typeof x==='object'&&x.action==='ads-sales-plan-save'));
confirmReturn=true;
assert.equal(await env.savePlan(plan.merchantId),true);
assert.equal(plan.version,1);
assert.equal(plan.priceCents,9900);
assert.equal(plan.durationDays,14);
assert.equal(plan.stage,'ready_for_contact');
assert.ok(calls.some(x=>x.action==='ads-sales-plan-save'));
assert.match(env.salesView(),/99,00/);
role='readonly';assert.equal(await env.reload({force:true})!=null,true);
assert.doesNotMatch(env.salesView(),/Salvar planejamento/);
assert.equal(await env.savePlan(plan.merchantId),false);
role='support';assert.equal(env.salesView(),'');
console.log('V1.309 PASS — secure SQL, founder-only plans, finances stay zero, positive save/readback and read-only roles.');
