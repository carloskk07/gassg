import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const admin=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
const start=admin.indexOf('function adminPage(){');
const end=admin.indexOf('function adminFilterRegistry()',start);
assert.ok(start>0&&end>start,'Admin page must be available');
const page=admin.slice(start,end);
assert.match(page,/const sectionActive=id=>adminRuntime\.section===id&&adminRoleCanSection\(id,currentRole\)/);
const all={
  overviewContent:"overview",
  ordersContent:"orders",
  customersContent:"customers",
  partnersContent:"partners",
  catalogContent:"catalog",
  financeContent:"finance",
  alertsContent:"alerts",
  incidentsContent:"incidents",
  auditContent:"audit",
  adminAccessContent:"system",
  systemContent:"system"
};
for(const [name,section] of Object.entries(all)){
  assert.ok(page.includes("const "+name+"=(sectionActive('"+section+"'))?("),
    name+' must only render when active and authorized');
}
for(const space of ['summary','billing','reconciliation','policy']){
  const name={summary:'financeSummaryContent',billing:'financeBillingContent',
    reconciliation:'financeReconciliationContent',policy:'financePolicyContent'}[space];
  assert.ok(page.includes("const "+name+"=(sectionActive('finance')&&financeSelection==='"+space+"')?("),
    name+' must only construct its selected workspace');
}
assert.ok(page.includes("const financeSelection=sectionActive('finance')?adminFinanceWorkspaceCurrent():'summary';"));
for(const section of ['overview','orders','customers','partners','prospects','enablement',
  'catalog','finance','activations','alerts','incidents','audit','system']){
  assert.ok(page.includes("adminPanel('"+section+"',"),
    'All administrative routes must remain wired: '+section);
}
for(const section of ['prospects','enablement']){
  assert.ok(page.includes("adminPanel('"+section+"',sectionActive('"+section+"')?"),
    'On-demand section must render only when selected and authorized');
}
assert.ok(page.includes("adminPanel('activations',sectionActive('activations')?"),
  'Protected lazy-loaded activations must not render while hidden');
// Actually execute the authorization and selection gate in an isolated VM.
const gate=page.match(/const sectionActive=id=>[^;]+;/)?.[0];
assert.ok(gate);
let section='overview',granted=new Set(['overview','finance','system']),checks=[];
const ctx=vm.createContext({
  adminRuntime:{get section(){return section}},
  adminRoleCanSection:(id,role)=>{checks.push([id,role]);return granted.has(id)},
  currentRole:'superadmin'
});
vm.runInContext(gate+'\nthis.sectionActive=sectionActive;',ctx);
assert.equal(ctx.sectionActive('finance'),false,'Hidden finance cannot render');
assert.equal(checks.length,0,'Hidden sections should short-circuit permission checks');
assert.equal(ctx.sectionActive('overview'),true);
section='finance';
assert.equal(ctx.sectionActive('finance'),true);
granted.delete('finance');
assert.equal(ctx.sectionActive('finance'),false,'Unauthorized finance cannot render');
console.log('Administrative active-only panel and finance workspace isolation passed.');

// Real startup: known superadmins skip redundant bootstrap claim, while first
// access uses the existing secure claim only after server access denial.
const initStart=admin.indexOf('async function adminBackendInit(){');
const initEnd=admin.indexOf('\nasync function adminAccessToken()',initStart);
assert.ok(initStart>=0&&initEnd>initStart);
const adminInit=admin.slice(initStart,initEnd);
async function startupScenario(firstStatus,claimOutcome='claimed'){
  const runtime={requested:true,status:'disabled',client:null,session:null,data:null};
  let summaries=0,claims=0;
  const auth={getSession:async()=>({data:{session:{access_token:'token',user:{is_anonymous:false}}},error:null})};
  const scope={
    adminRuntime:runtime,
    adminOriginSafe:()=>true,
    loadSupabaseBrowser:async()=>({createClient:()=>({auth})}),
    CHAMA_BACKEND:{url:'https://example.invalid',publishableKey:'public-test'},
    sessionStorage:{},
    globalThis:{captureSupabaseImplicitSessionFromUrl:()=>null,clearSupabaseAuthFragment:()=>{}},
    adminRefresh:async()=>{
      summaries++;
      if(firstStatus==='offline')throw Object.assign(new Error('network unavailable'),{code:'NETWORK_TIMEOUT'});
      runtime.status=firstStatus==='ready'||claims>0&&claimOutcome==='claimed'?'ready':'no-access';
      runtime.data=runtime.status==='ready'?{currentAdmin:{admin_role:'superadmin'}}:null;
    },
    adminClaimBootstrap:async()=>{claims++;if(claimOutcome==='error')throw new Error('bootstrap refused');}
  };
  vm.runInNewContext(adminInit+'\nthis.init=adminBackendInit;',scope);
  await scope.init();
  return {summaries,claims,status:runtime.status};
}
assert.deepEqual(await startupScenario('ready'),{summaries:1,claims:0,status:'ready'},
  'Returning admin must not wait for a bootstrap claim');
assert.deepEqual(await startupScenario('denied'),{summaries:2,claims:1,status:'ready'},
  'First-time admin must keep authorized bootstrap flow');
assert.deepEqual(await startupScenario('offline'),{summaries:1,claims:0,status:'unavailable'},
  'Network outages must never trigger privileged bootstrap claim');

// Summary must launch independent datasets before awaiting earlier results.
// Financial evidence remains in the same full, authorization-scoped response.
const ops=fs.readFileSync(new URL('../supabase/functions/admin-ops/index.ts',import.meta.url),'utf8');
const summarySlice=ops.slice(ops.indexOf('async function summary('),ops.indexOf('\nDeno.serve('));
for(const pair of [
  ['marketCityInterestsPromise','const [apps,merchants,compliance'],
  ['pilotPartnerInvitesPromise','const pilotPartners=await'],
  ['merchantBusinessDetailsPromise','const pilotPartners=await'],
  ['productCategoriesPromise','const commercialPolicy=await'],
  ['productProfilesPromise','const commercialPolicy=await'],
  ['supportMetricsPromise','const controlOrders=await'],
  ['growthApplicationFunnelPromise','admin_growth_network_overview_v1_227']
]){
  assert.ok(summarySlice.indexOf(pair[0])>=0&&summarySlice.indexOf(pair[0])<summarySlice.indexOf(pair[1]),
    'Independent summary fetch must start without a sequential wait: '+pair[0]);
}
for(const originalResponseField of ['pilotPartners:', 'marketCityInterests:', 'merchantReadiness:', 'merchantBilling:', 'finance:', 'currentAdmin,']){
  assert.ok(summarySlice.includes(originalResponseField),'Preserve original Admin response contract: '+originalResponseField);
}
