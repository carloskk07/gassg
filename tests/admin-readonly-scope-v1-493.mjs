import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const edge=read('supabase/functions/admin-ops/index.ts');
const js=src=>src.replace(/:any\b|:string\b/g,'').replaceAll('new Set<string>()','new Set()');
const extract=(start,end)=>{
  const a=edge.indexOf(start),b=edge.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'missing edge fixture '+start);
  return js(edge.slice(a,b));
};
const sensitive='PRIVATE-NOT-FOR-READONLY';
const ctx=vm.createContext({Date,Set,Object,Array,Number,String});
const scope=extract('function scopeAdminSummary(', '\nfunction lookupText(');
vm.runInContext(scope+';this.scopeAdminSummary=scopeAdminSummary;',ctx);
const data={
  currentAdmin:{user_id:'self',active:true,admin_role:'readonly',other:sensitive},
  platformAdmins:[{user_id:'self',active:true,admin_role:'readonly'},
    {user_id:sensitive,active:true,admin_role:'superadmin'}],
  merchants:[{id:'merchant',name:'Revenda',status:'active',online:true,
    cnpj:sensitive,paymentAccount:{account:sensitive},
    delivery_reference:sensitive,last_seen_at:'2026-10-30'}],
  applications:[{phone:sensitive}],pilotPartners:[{invite:sensitive}],
  merchantReadiness:[{phone:sensitive}],prelaunchLeads:[{phone:sensitive}],
  publicRequests:[{request_kind:'privacy',message:sensitive}],
  supportCases:[{message:sensitive}],controlOrders:[{address_text:sensitive}],
  merchantBilling:{paymentEvents:[{payment_id:sensitive}]},
  merchantPayments:{attempts:[{provider_transaction:sensitive}]},
  finance:{receivables:[{payment_ref:sensitive}]},
  productRegistry:{products:[{owner:sensitive}]},
  commercialPolicy:{notes:sensitive},
  businessMetrics:{totalOrders:14,privateEmail:sensitive},
  launchReadiness:{ready:false,secret:sensitive},
  acquisitionMetrics:{leads:3,customerEmail:sensitive},
  marketCityInterests:[{city:'São Gabriel',state:'RS',last_seen_at:'2026-10-30',
    contact_name:sensitive}],
  growthNetwork:{valid:true,merchantBreakdown:[{name:sensitive}]},
  growthApplicationFunnel:{valid:true,rows:[{companyName:sensitive}]},
  incidents:[{id:'inc',title:sensitive,description:sensitive,
    status:'open',severity:'high',source:'system',created_at:'2026-10-30'}],
  recentAudit:[{id:'audit',action:'admin_action',metadata:{token:sensitive},
    actor_user_id:sensitive,target_type:'merchant',target_id:sensitive,
    created_at:'2026-10-30'}],
  rewardFailures:[{error:sensitive}],accountingFailures:[{error:sensitive}],
  referralReviews:[{id:sensitive}]
};
const superadmin=ctx.scopeAdminSummary('superadmin',data);
assert.equal(superadmin,data,'superadmin remains unchanged');
const readOnly=ctx.scopeAdminSummary('readonly',data);
assert.doesNotMatch(JSON.stringify(readOnly),/PRIVATE-NOT-FOR-READONLY/);
assert.equal(readOnly.merchants[0].name,'Revenda');
assert.equal(readOnly.merchants[0].paymentAccount,undefined);
assert.equal(readOnly.businessMetrics.totalOrders,14);
assert.equal(readOnly.launchReadiness.ready,false);
assert.equal(readOnly.publicRequests.length,0);
assert.equal(readOnly.controlOrders.length,0);
assert.equal(readOnly.platformAdmins.length,1);
assert.equal(readOnly.incidents[0].status,'open');
assert.equal(readOnly.incidents[0].description,undefined);
assert.equal(readOnly.recentAudit[0].metadata,undefined);
assert.deepEqual(Object.keys(readOnly.recentAudit[0]).sort(),
  ['action','created_at','id','target_type']);
const entity=extract('function adminRoleCanViewEntity(', '\nfunction scopeAdminSummary(');
vm.runInContext(entity+
  ';this.canView=adminRoleCanViewEntity;this.scopeEntity=scopeEntityDetail;',ctx);
assert.equal(ctx.canView('readonly','customer'),false);
assert.equal(ctx.canView('readonly','order'),false);
assert.equal(ctx.canView('readonly','merchant'),false);
assert.equal(ctx.canView('superadmin','order'),true);
assert.equal(ctx.scopeEntity('readonly',{type:'order',address_text:sensitive}),null);
assert.equal(ctx.scopeEntity('superadmin',{type:'order',address_text:sensitive}).address_text,sensitive);
const policy=extract('const READONLY_ALLOWED_READS=', '\n/* V1.184');
const policyCtx=vm.createContext({
  ADMIN_READ_ACTIONS:new Set(['summary','search','entity-detail','incident-list','owner-wallet-reconciliation','audit-search','merchant-payment-preflight','merchant-enablement','prospect-intelligence']),
  ADMIN_ROLE_ACTIONS:{superadmin:new Set(['*']),readonly:new Set()},
  DomainError:class extends Error{constructor(code,message,status){super(message);this.code=code;this.status=status;}}
});
vm.runInContext(policy+';this.requireAction=requireAdminAction;',policyCtx);
for(const action of ['summary','search','incident-list','audit-search'])
  assert.doesNotThrow(()=>policyCtx.requireAction('readonly',action));
for(const action of ['entity-detail','owner-wallet-reconciliation',
  'merchant-payment-preflight','financial-action','public-request-status',
  'merchant-enablement','prospect-intelligence'])
  assert.throws(()=>policyCtx.requireAction('readonly',action),
    err=>err.code==='ADMIN_PERMISSION_DENIED'&&err.status===403);
assert.doesNotThrow(()=>policyCtx.requireAction('superadmin','owner-wallet-reconciliation'));
for(const action of ['merchant-enablement','prospect-intelligence']){
  assert.doesNotThrow(()=>policyCtx.requireAction('operations',action),
    'operations must retain its existing commercial tools');
  assert.doesNotThrow(()=>policyCtx.requireAction('superadmin',action),
    'superadmin must retain its existing commercial tools');
}
const merchantHandler=extract('if(action==="merchant-enablement"){',
  '\n    if(action==="operational-alerts"){');
const prospectHandler=extract('if(action==="prospect-intelligence"){',
  '\n    if(action==="expansion-notifications"){');
for(const [name,handler] of [['merchant-enablement',merchantHandler],
  ['prospect-intelligence',prospectHandler]]){
  assert.doesNotMatch(handler,/"readonly"/,
    name+' must reject readonly at the handler, not just the routing policy');
  assert.match(handler,/"superadmin","operations","compliance"/,
    name+' remains available to authorized commercial operators');
}
assert.match(prospectHandler,/prospectIntelligence\(admin,body\.city,body\.state,body\.force===true\)/,
  'prospect refresh must remain unreachable by readonly');
const authorization=edge.indexOf('requireAdminAction(String(adminAccess.admin_role||"superadmin"),action);');
const firstHandler=edge.indexOf('if(action==="merchant-enablement"){');
assert.ok(authorization>=0&&firstHandler>authorization,
  'read-only deny gate must execute before commercial endpoint handlers');

assert.ok(edge.includes('role==="readonly"?visible.map'));
assert.ok(edge.includes('role==="readonly"?rows.map'));
assert.ok(edge.includes('if(action==="incident-list")'));
assert.ok(edge.includes('if(adminAccess.admin_role==="readonly")'));
assert.ok(edge.includes('if(body.actorUserId&&role==="readonly")'));

// The frontend must never offer workspaces that the same role cannot query.
// A saved tab from a former role must be recovered after a new summary loads.
const frontend=read('js/admin.js');
const activations=read('js/admin-activations.js');
const cutClient=(start,end)=>{
  const a=frontend.indexOf(start),b=frontend.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'missing admin frontend code '+start);
  return frontend.slice(a,b);
};
let currentRole='readonly',renderCount=0,requests=0;
const savedSections=[];
const uiRuntime={client:{},session:{user:{id:'readonly-test'}},section:'prospects',
  refreshSeq:0,status:'ready',data:null};
const uiCtx=vm.createContext({
  Date,Set,Array,Object,String,Promise,
  adminRuntime:uiRuntime,
  adminCurrentRole:()=>currentRole,
  adminReady:()=>true,
  adminInvoke:async()=>{requests++;return {currentAdmin:{admin_role:currentRole}}},
  retryAmbiguousOnce:async fn=>fn(),
  render:()=>renderCount++,
  queueMicrotask:fn=>fn(),
  sessionStorage:{setItem:(key,value)=>savedSections.push([key,value])},
  adminEnsureProviderHealth:async()=>null,
  adminLoadGovernanceGates:async()=>null,
  requestAnimationFrame:()=>{},
  adminNavIcon:()=>'<svg></svg>',
  esc:value=>String(value),
});
const policyClient=cutClient('const ADMIN_SECTION_ROLES=', '\nfunction adminSectionMeta(');
const refreshClient=cutClient('async function adminRefresh(', '\nasync function ');
const navigationClient=cutClient('function adminSetSection(section){', '\nfunction adminPanel(');
vm.runInContext(policyClient+'\n'+refreshClient+'\n'+navigationClient+
  '\nthis.can=adminRoleCanSection;this.goto=adminSetSection;this.menu=adminMenuButton;this.refresh=adminRefresh;',
  uiCtx);
const forbiddenTabs=['prospects','enablement','activations'];
for(const section of forbiddenTabs){
  assert.equal(uiCtx.can(section,'readonly'),false,section+' forbidden for readonly');
  assert.equal(uiCtx.menu(section,section,'·'),'','readonly menu hides '+section);
  uiCtx.goto(section);
  assert.equal(uiRuntime.section,'overview','readonly navigation must recover to overview');
}
assert.equal(requests,0,'forbidden tabs must not trigger a server fetch');
for(const tab of ['overview','alerts','incidents','audit','system'])
  assert.equal(uiCtx.can(tab,'readonly'),true,'preserve authorized '+tab);
for(const tab of ['prospects','enablement','activations'])
  assert.equal(uiCtx.can(tab,'superadmin'),true,'preserve superadmin '+tab);
for(const tab of ['prospects','enablement','activations'])
  assert.equal(uiCtx.can(tab,'operations'),true,'preserve operator '+tab);
for(const tab of ['prospects','enablement'])
  assert.equal(uiCtx.can(tab,'compliance'),true,'preserve compliance '+tab);
for(const section of forbiddenTabs){
  uiRuntime.section=section;
  await uiCtx.refresh({silent:true});
  assert.equal(uiRuntime.section,'overview','saved forbidden tab '+section+' must be reset after login');
  assert.equal(savedSections.at(-1)[1],'overview','persist safe tab on role change');
}
assert.equal(requests,3,'safe summary reads only; no restricted lazy queries');
const activationStart=activations.indexOf('async function adminActivationLoad(');
const activationEnd=activations.indexOf('\n}',activationStart);
assert.ok(activationStart>=0&&activationEnd>activationStart);
const activationCtx=vm.createContext({Date,Promise,adminRuntime:uiRuntime,
  adminCurrentRole:()=>currentRole,adminReady:()=>true,
  adminRoleCanSection:(section,role)=>uiCtx.can(section,role),
  render:()=>renderCount++,adminInvoke:async()=>{requests++;throw Error('unauthorized request')}});
vm.runInContext(activations.slice(0,activations.indexOf('\nasync function adminActivationLoad('))+
  '\n'+activations.slice(activationStart,activationEnd+2)+
  '\nthis.load=adminActivationLoad;',activationCtx);
assert.equal(await activationCtx.load({force:true}),null,
  'even a direct activation loader invocation must never fetch for readonly');
assert.equal(requests,3,'activation loader must not hit 23 restricted endpoints');
console.log('PASS: frontend RBAC aligned with backend, old tab recovers, privileged loaders not called.');

console.log('PASS: readonly never receives contacts, addresses, PSP identifiers, finance, incidents or audit metadata; reads remain scoped.');
