import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const edge=read('supabase/functions/admin-ops/index.ts');
const js=src=>src.replace(/:any\b|:string\b/g,'');
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
  ADMIN_READ_ACTIONS:new Set(['summary','search','entity-detail','incident-list','owner-wallet-reconciliation','audit-search','merchant-payment-preflight']),
  ADMIN_ROLE_ACTIONS:{superadmin:new Set(['*']),readonly:new Set()},
  DomainError:class extends Error{constructor(code,message,status){super(message);this.code=code;this.status=status;}}
});
vm.runInContext(policy+';this.requireAction=requireAdminAction;',policyCtx);
for(const action of ['summary','search','incident-list','audit-search'])
  assert.doesNotThrow(()=>policyCtx.requireAction('readonly',action));
for(const action of ['entity-detail','owner-wallet-reconciliation',
  'merchant-payment-preflight','financial-action','public-request-status'])
  assert.throws(()=>policyCtx.requireAction('readonly',action),
    err=>err.code==='ADMIN_PERMISSION_DENIED'&&err.status===403);
assert.doesNotThrow(()=>policyCtx.requireAction('superadmin','owner-wallet-reconciliation'));
assert.ok(edge.includes('role==="readonly"?visible.map'));
assert.ok(edge.includes('role==="readonly"?rows.map'));
assert.ok(edge.includes('if(action==="incident-list")'));
assert.ok(edge.includes('if(adminAccess.admin_role==="readonly")'));
assert.ok(edge.includes('if(body.actorUserId&&role==="readonly")'));
console.log('PASS: readonly never receives contacts, addresses, PSP identifiers, finance, incidents or audit metadata; reads remain scoped.');
