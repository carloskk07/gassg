import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const admin=read('js/admin.js'),edge=read('supabase/functions/admin-ops/index.ts');
const boot=read('js/bootstrap.js'),css=read('css/components.css'),ci=read('.github/workflows/audit.yml');
new vm.Script(admin,{filename:'admin.js'});new vm.Script(boot,{filename:'bootstrap.js'});
const extract=(source,name)=>{
 const index=source.indexOf('function '+name+'(');
 assert.ok(index>=0,'missing '+name);
 const start=source.slice(index-6,index)==='async '?index-6:index;
 const end=source.indexOf('\n}',index);
 assert.ok(end>index);
 return source.slice(start,end+2);
};
const begin=edge.indexOf('async function adminGovernanceGates(');
const end=edge.indexOf('async function financeSalePaymentHistory(',begin);
assert.ok(begin>0&&end>begin);
const functionBody=edge.slice(begin,end);
for(const token of [
 'admin.from("market_cities")','admin.from("merchants")',
 'admin.from("merchant_applications")','"ADMIN_PERMISSION_DENIED"',
 '"GOVERNANCE_EVIDENCE_UNAVAILABLE"','noAutomaticActivation:true',
 'source:"admin_governance_gates_v1_304"','readOnly:true',
 'merchantDirectPaymentsEnabled','["superadmin","operations","readonly"]'
])assert.ok(functionBody.includes(token),'missing protection '+token);
assert.ok(edge.includes('const ADMIN_READ_ACTIONS=new Set(["governance-gates",'));
assert.ok(edge.includes('if(action==="governance-gates"){'));
assert.ok(edge.includes('return json(await adminGovernanceGates(admin,String(adminAccess.admin_role||"")),200,origin)'));
assert.ok(edge.includes('const adminAccess=await requireAdmin(admin,user.id)'));
assert.ok(edge.includes('admin.rpc("admin_set_market_city_pause"'));
assert.ok(boot.includes('adminLoadGovernanceGates,adminGovernanceChangeCityPause,'));
assert.ok(admin.includes("if(['overview','system'].includes(String(adminRuntime.section||'')))"));
assert.ok(admin.includes('adminGovernanceView()'));
assert.ok(admin.includes('adminRuntime.governance={data:null'));
assert.ok(ci.includes('node tests/admin-governance-gates-v1-304.mjs'));

const payload={
 source:'admin_governance_gates_v1_304',readOnly:true,noAutomaticActivation:true,
 checkedAt:new Date().toISOString(),
 cities:[{city:"Vila d'Água <img src=x onerror=alert(1)>",state:'RS',commerceEnabled:false,adminPaused:false}],
 counts:{merchantsByStatus:{pending:1,active:0},applicationsByStatus:{approved:1}},
 truncated:{cities:false,merchants:false,applications:false},
 runtime:{merchantDirectPaymentsEnabled:false},controls:{cityPause:true}
};
const state={data:payload,loadedFor:'user1',role:'superadmin',loading:false,error:null};
const runtime={governance:state,session:{user:{id:'user1'}},data:{launchReadiness:{operationMode:'PRELAUNCH'}}};
const env=vm.createContext({
 adminRuntime:runtime,adminReady:()=>true,adminCurrentRole:()=>state.role,
 adminRoleCanSection:s=>s!=='finance',
 adminOperationModeLabel:x=>x,
 esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
 Date,Number,String
});
vm.runInContext(extract(admin,'adminGovernanceView')+'\nthis.view=adminGovernanceView;',env);
const html=env.view();
assert.match(html,/Liberações e ativações/);
assert.match(html,/Comércio ainda não habilitado/);
assert.match(html,/Desabilitado no ambiente/);
assert.match(html,/0 ativa\(s\) • 1 pendente\(s\)/);
assert.match(html,/adminGovernanceChangeCityPause\(0\)/);
assert.doesNotMatch(html,/<img src=x onerror=alert\(1\)>/);
assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
assert.doesNotMatch(html,/adminGovernanceChangeCityPause\('Vila/);
state.role='readonly';env.adminRuntime.governance.role='readonly';
assert.doesNotMatch(env.view(),/adminGovernanceChangeCityPause\(0\)/);
state.role='superadmin';env.adminRuntime.governance.role='superadmin';
let invoked=[],feedback=[],reason='Justificativa válida',approved=true;
const env2=vm.createContext({
 adminReady:()=>true,adminCurrentRole:()=>state.role,
 adminRuntime:runtime,confirm:()=>approved,prompt:()=>reason,
 toast:x=>feedback.push(x),adminPerform:async(action,p)=>{invoked.push({action,p});},
 adminLoadGovernanceGates:async()=>null,Number,String
});
vm.runInContext(extract(admin,'adminGovernanceChangeCityPause')+'\nthis.toggle=adminGovernanceChangeCityPause;',env2);
assert.equal(await env2.toggle(-1),false);
assert.equal(await env2.toggle(300),false);
assert.equal(await env2.toggle(0),true);
assert.equal(invoked.length,1);
assert.equal(invoked[0].action,'market-city-pause');
assert.equal(invoked[0].p.paused,true);
assert.equal(invoked[0].p.city,payload.cities[0].city);
reason='x';assert.equal(await env2.toggle(0),false);
assert.equal(invoked.length,1);
for(const marker of ['.admin-governance','.admin-governance-city','@media(max-width:700px)'])
 assert.ok(css.includes(marker),'missing style '+marker);
console.log('V1.304 PASS — server-scoped gate states, safe admin interface, role-bound controls and explicit city pause.');
