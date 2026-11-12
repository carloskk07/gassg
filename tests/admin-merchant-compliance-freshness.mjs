import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261022155032_admin_merchant_compliance_current.sql');
const admin=read('js/admin.js'),edge=read('supabase/functions/admin-ops/index.ts');
assert.match(migration,/CREATE OR REPLACE FUNCTION public\.admin_merchant_readiness_snapshot\(/);
assert.match(migration,/perform public\.require_platform_admin\(p_actor_user_id\)/);
assert.match(migration,/STABLE SECURITY DEFINER\s+SET search_path TO 'pg_catalog'/);
assert.match(migration,/public\.merchant_cnpj_compliance_current\(m.id\) as cnpj_verification_current/);
assert.match(migration,/public\.merchant_anp_compliance_current\(m.id\) as anp_verification_current/);
assert.match(migration,/'cnpjVerificationCurrent',n\.cnpj_verification_current/);
assert.match(migration,/'anpVerificationCurrent',n\.anp_verification_current/);
for(const part of ["'complianceReady',n.compliance_ready","'paymentReady',n.payment_ready",
 "'offerReady',n.offer_ready","'nextAction',case"]) {
 assert.ok(migration.includes(part),'Preserve existing admin JSON response field: '+part);
}
assert.match(migration,/revoke all on function public\.admin_merchant_readiness_snapshot\(uuid\) from public,anon,authenticated/);
assert.match(migration,/grant execute on function public\.admin_merchant_readiness_snapshot\(uuid\) to service_role/);
assert.match(edge,/readiness:merchantReadinessById\.get\(m.id\)\?\?null/,
 'Admin edge must forward current RPC result by merchant id');
assert.match(admin,/m\.readiness\?\.cnpjVerificationCurrent/);
assert.match(admin,/m\.readiness\?\.anpVerificationCurrent/);
assert.doesNotMatch(admin,/cnpj_max_age_days\s*=/);
assert.doesNotMatch(admin,/anp_max_age_days\s*=/);
assert.match(read('.github/workflows/audit.yml'),/node tests\/admin-merchant-compliance-freshness\.mjs/);
// V1.967: partial Admin rendering must NEVER downgrade compliance or
// revoke logistics simply because a checkbox/select disappeared.
const merchantId='11111111-1111-4111-8111-111111111111';
const actor='22222222-2222-4222-8222-222222222222';
const runtime={status:'ready',section:'partners',actionPending:false,
 session:{user:{id:actor}},data:{merchants:[{
  id:merchantId,status:'pending',compliance:{cnpj_status:'verified',
   anp_status:'verified'},deliveryCapabilities:[{
    capability_code:'regulated_glp_mixed_load_verified',active:true}]
 }]}};
let role='operations',selectedTab='verification',allowConfirmation=true,
 response={ok:true},requests=[],messages=[],fields={};
const el=(value)=>({value});
const full=()=>({
 ['cnpj-'+merchantId]:el('verified'),['anp-'+merchantId]:el('verified'),
 ['anpref-'+merchantId]:el('ANP-REFERENCIA-REAL-DO-TESTE'),
 ['notes-'+merchantId]:el('Fonte CNPJ oficial conferida neste teste'),
 ['mixed-'+merchantId]:{checked:true},
 ['mixednotes-'+merchantId]:el('Capacidade logística documentada')
});
const ctx=vm.createContext({
 adminRuntime:runtime,adminPartnersWorkspaceTab:selectedTab,
 adminReady:()=>runtime.status==='ready',
 adminCurrentRole:()=>role,
 document:{getElementById:id=>fields[id]??null},
 toast:msg=>{messages.push(String(msg))},
 confirm:()=>allowConfirmation,
 adminPerform:async(action,payload)=>{requests.push({action,payload});return response;},
 String,Object,Array,Date,RegExp
});
const begin=admin.indexOf('function adminPartnerVerificationMutationTarget(');
const end=admin.indexOf('async function adminSetMerchantPaymentCapability(',begin);
const beginStatus=admin.indexOf('async function adminSetMerchantStatus(');
const endStatus=admin.indexOf('const ADMIN_REFERRAL_REJECTION_REASONS',beginStatus);
assert.ok(begin>=0&&end>begin&&beginStatus>0&&endStatus>beginStatus);
vm.runInContext(admin.slice(begin,end)+admin.slice(beginStatus,endStatus)+
 '\nthis.saveCompliance=adminSaveCompliance;'+
 'this.saveCapability=adminSaveDeliveryCapability;'+
 'this.setStatus=adminSetMerchantStatus;',ctx);
await ctx.saveCompliance(merchantId);
await ctx.saveCapability(merchantId);
assert.equal(requests.length,0,'a missing form must neither downgrade CNPJ/ANP nor revoke logistics');
assert(messages.some(x=>x.includes('incompleto')),'missing control needs explanation');

fields=full();
delete fields['anp-'+merchantId];
await ctx.saveCompliance(merchantId);
assert.equal(requests.length,0,'a missing ANP selector must not silently send pending');
fields=full();delete fields['mixed-'+merchantId];
await ctx.saveCapability(merchantId);
assert.equal(requests.length,0,'a missing logistics switch must not silently send false');

fields=full();
fields['cnpj-'+merchantId].value='malformed';
await ctx.saveCompliance(merchantId);
assert.equal(requests.length,0,'unrecognized compliance status must be denied');

fields=full();
role='readonly';
await ctx.saveCompliance(merchantId);
await ctx.saveCapability(merchantId);
await ctx.setStatus(merchantId,'activate-merchant');
assert.equal(requests.length,0,'read-only roles cannot submit merchant mutations');
role='operations';
ctx.adminPartnersWorkspaceTab='queue';
await ctx.saveCompliance(merchantId);
assert.equal(requests.length,0,'another tab cannot mutate hidden verification controls');
ctx.adminPartnersWorkspaceTab='verification';
runtime.actionPending=true;
await ctx.saveCompliance(merchantId);
assert.equal(requests.length,0,'another in-flight action cannot be treated as a save');
runtime.actionPending=false;
await ctx.saveCompliance('33333333-3333-4333-8333-333333333333');
assert.equal(requests.length,0,'unloaded merchant may not be mutated from this screen');

response=null;
const successBefore=messages.filter(x=>x==='Validação salva').length;
await ctx.saveCompliance(merchantId);
assert.equal(requests.length,1);
assert.equal(messages.filter(x=>x==='Validação salva').length,successBefore,
 'concurrent/no-result backend must not claim compliance saved');
response={ok:false};
await ctx.saveCapability(merchantId);
assert(!messages.includes('Capacidade logística verificada'),
 'backend denial must never claim logistics activated');

response={ok:true};requests=[];
await ctx.saveCompliance(merchantId);
await ctx.saveCapability(merchantId);
assert.deepEqual(requests.map(x=>x.action),['verify-merchant','set-delivery-capability']);
assert.equal(requests[0].payload.cnpjStatus,'verified');
assert.equal(requests[0].payload.anpStatus,'verified');
assert.equal(requests[0].payload.anpReference,'ANP-REFERENCIA-REAL-DO-TESTE');
assert.equal(requests[1].payload.active,true);
assert(messages.includes('Validação salva'));
assert(messages.includes('Capacidade logística verificada'));
requests=[];
allowConfirmation=false;
await ctx.setStatus(merchantId,'activate-merchant');
assert.equal(requests.length,0,'activation requires explicit confirmation');
allowConfirmation=true;
await ctx.setStatus(merchantId,'invented-operation');
assert.equal(requests.length,0,'unknown merchant action must not be interpreted as suspension');
response=null;
await ctx.setStatus(merchantId,'activate-merchant');
assert.equal(requests.length,1);
assert(!messages.includes('Status atualizado'),'no-result backend must not claim activation');
response={ok:true};requests=[];
await ctx.setStatus(merchantId,'activate-merchant');
assert.equal(requests.length,1);
assert.equal(requests[0].action,'activate-merchant');
assert(messages.includes('Status atualizado'));

// The callback may resolve only AFTER logout/account switch; no cross-user
// success message may appear even if the original server operation succeeded.
messages=[];requests=[];
ctx.adminPerform=async(action,payload)=>{
 requests.push({action,payload});
 runtime.session={user:{id:'44444444-4444-4444-8444-444444444444'}};
 return {ok:true};
};
await ctx.saveCompliance(merchantId);
assert.equal(requests.length,1);
assert(!messages.includes('Validação salva'),
 'a delayed completion from an old session must not announce success');
runtime.session={user:{id:actor}};
console.log('V1.967 PASS: missing/stale merchant forms fail closed, role/account isolation, backend-result readback, no false activation or compliance downgrade.');

console.log('PASS — canonical server CNPJ/ANP validity, unchanged ACL and RPC interface.');
