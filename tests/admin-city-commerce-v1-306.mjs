import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016010000_admin_city_commerce_gate_v1_306.sql');
const admin=read('js/admin.js'),edge=read('supabase/functions/admin-ops/index.ts');
const bootstrap=read('js/bootstrap.js'),css=read('css/components.css');
new vm.Script(admin,{filename:'admin.js'});new vm.Script(bootstrap,{filename:'bootstrap.js'});
for(const marker of [
 'join public.market_cities mc on mc.city_key=r.city_key and mc.state=r.state',
 'mc.commerce_enabled is true and mc.admin_paused is false',
 'public.merchant_allowed_in_operation_mode(m.id)',
 'public.merchant_financial_sales_allowed(m.id)',
 'public.merchant_basket_compliance_current',
 'public.merchant_delivery_payment_allowed',
 "and lc.operation_mode in ('LIVE','PILOT')",
 "a.admin_role='superadmin'",
 "raise exception 'CITY_NO_ELIGIBLE_MERCHANT'",
 "raise exception 'CITY_ADMINISTRATIVELY_PAUSED'",
 "raise exception 'CITY_NOT_DISCOVERED'",
 "actor_user_id,action,target_type,target_id,metadata",
 "p_actor_user_id,'market-city-commerce','market_city'",
 "v_previous is distinct from p_enabled",
 "revoke all on function public.admin_set_market_city_commerce",
 "from public,anon,authenticated",
 "to service_role"
])assert.ok(sql.includes(marker),'missing SQL authorization: '+marker);
assert.ok(!sql.includes('update public.platform_launch_control'));
assert.ok(!sql.includes('update public.merchants'));
assert.ok(!sql.includes('update public.merchant_payment_methods'));
assert.ok(!sql.includes('insert into public.orders'));
assert.ok(sql.includes("v_city,text")===false);
for(const marker of [
 'if(action==="market-city-commerce")',
 'String(adminAccess.admin_role)!=="superadmin"',
 'typeof enabled!=="boolean"',
 'cleanText(body.reason,{min:5,max:240',
 'admin.rpc("admin_set_market_city_commerce"',
 'p_actor_user_id:user.id',
 'data?.globalModeUnchanged!==true',
 'cityCommerce:role==="superadmin"',
 'requireAdminAction(String(adminAccess.admin_role||"superadmin"),action)'
])assert.ok(edge.includes(marker),'missing edge guard '+marker);
assert.ok(!edge.includes('"market-city-commerce","market-city-pause"'));
assert.ok(!edge.match(/ADMIN_READ_ACTIONS=new Set\(\["market-city-commerce"/));

const cut=(name)=>{
 const found=admin.indexOf('function '+name+'(');
 const start=admin.slice(Math.max(0,found-6),found)==='async '?found-6:found;
 const end=admin.indexOf('\n}',found);
 assert.ok(start>=0&&end>start);
 return admin.slice(start,end+2);
};
let role='superadmin',ready=true,confirmReturn=true,reason='Cadastramos a primeira revenda elegível';
let calls=[],messages=[],reads=0;
const runtime={session:{user:{id:'a'}},data:{launchReadiness:{operationMode:'PRELAUNCH'}},
 governance:{data:{source:'admin_governance_gates_v1_304',
  controls:{cityPause:true,cityCommerce:true},
  checkedAt:'2026-10-15T20:00:00Z',
  runtime:{merchantDirectPaymentsEnabled:false},
  counts:{merchantsByStatus:{pending:1},applicationsByStatus:{approved:1}},
  cities:[{city:'São Gabriel',state:'RS',commerceEnabled:false,adminPaused:false}]},
 loadedFor:'a',role:'superadmin',loading:false,error:null}};
const context=vm.createContext({
 adminReady:()=>ready,adminCurrentRole:()=>role,adminRuntime:runtime,
 adminRoleCanSection:()=>true,adminOperationModeLabel:x=>x,
 adminPerform:async(action,payload)=>{calls.push({action,payload});return {enabled:payload.enabled,globalModeUnchanged:true}},
 adminLoadGovernanceGates:async()=>{reads++},
 confirm:()=>confirmReturn,prompt:()=>reason,toast:m=>messages.push(m),String,Date,
 esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
});
vm.runInContext(cut('adminGovernanceChangeCityCommerce')+
 '\nthis.act=adminGovernanceChangeCityCommerce;',context);
assert.equal(await context.act(300),false);
role='operations';assert.equal(await context.act(0),false);
role='superadmin';
runtime.governance.data.cities[0].adminPaused=true;
assert.equal(await context.act(0),false);
assert.equal(calls.length,0);
runtime.governance.data.cities[0].adminPaused=false;
confirmReturn=false;assert.equal(await context.act(0),false);
confirmReturn=true;reason='a';
assert.equal(await context.act(0),false);
reason='Liberação manual após cadastro aprovado';
assert.equal(await context.act(0),true);
assert.equal(calls.length,1);
assert.equal(calls[0].action,'market-city-commerce');
assert.equal(calls[0].payload.city,'São Gabriel');
assert.equal(calls[0].payload.enabled,true);
assert.ok(calls[0].payload.reason.length>=5);
assert.equal(reads,1);
runtime.governance.data.cities[0].commerceEnabled=true;
assert.equal(await context.act(0),true);
assert.equal(calls[1].payload.enabled,false);
role='operations';
const viewfn=cut('adminGovernanceView');
vm.runInContext(viewfn+'\nthis.view=adminGovernanceView;',context);
assert.doesNotMatch(context.view(),/adminGovernanceChangeCityCommerce\(0\)/);
role='superadmin';
const html=context.view();
assert.match(html,/adminGovernanceChangeCityCommerce\(0\)/);
assert.match(html,/adminGovernanceChangeCityPause\(0\)/);
assert.match(html,/Suspender comércio/);
assert.match(html,/adminGovernanceChangeCityCommerce/);
assert.ok(bootstrap.includes('adminGovernanceChangeCityCommerce,'));
assert.ok(css.includes('.admin-governance-city-actions'));
console.log('V1.306 PASS — city commerce must be explicitly founder-authorized, separately from pause and global launch, without privilege leaks.');
