import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const admin=read('js/admin.js');
const edge=read('supabase/functions/admin-ops/index.ts');
const sql=read('supabase/migrations/20261024160000_clube_coupon_paid_package_draft_admin.sql');
new vm.Script(admin,{filename:'js/admin.js'});
const start=admin.indexOf('async function adminClubeDraftCreate(){');
const end=admin.indexOf('async function adminClubeFinanceRefresh(){',start);
assert.ok(start>0&&end>start);
const id='11111111-1111-4111-8111-111111111111';
const fields={'key':'piloto_tamao','title':'Pacote interno piloto',
 'price':'12,00','face':'5,00','count':'2','days':'60'};
let role='finance',calls=0,confirms=0,refreshes=0,allow=true;
const ctx=vm.createContext({
 adminRuntime:{status:'ready',session:{user:{id}},clubeFinance:{}},
 adminCurrentRole:()=>role,
 adminGrowthMoneyInputCents:v=>{
  if(!/^\d{1,5},\d{2}$/.test(v))return null;
  return Number(v.replace(',',''))},
 document:{getElementById:(k)=>({value:fields[k.replace('admin-coupon-draft-','')]})},
 confirm:()=>{confirms++;return allow},
 adminInvoke:async x=>{
  calls++;
  assert.equal(x.action,'clube-coupon-package-draft-create');
  assert.equal(x.salePriceCents,1200);
  assert.equal(x.couponFaceCents,500);
  assert.equal(x.couponsPerPack,2);
  return {source:'clube_coupon_paid_package_draft_v1',ok:true,
    packageKey:x.packageKey,saleEnabled:false,fundingVerified:false,
    costCoverageVerified:false,moneyMoved:false,checkoutEnabled:false,
    auditId:'22222222-2222-4222-8222-222222222222',grossBufferCents:200}
 },
 render:()=>{},
 adminClubeFinanceRefresh:()=>{refreshes++}
});
vm.runInContext(admin.slice(start,end)+';this.draft=adminClubeDraftCreate;',ctx);
await ctx.draft();
assert.equal(calls,0,'finance must not create draft');
assert.equal(confirms,0,'finance must not see authorizing prompt');
role='superadmin';allow=false;await ctx.draft();
assert.equal(calls,0,'cancel must not create');
allow=true;fields.price='9,00';await ctx.draft();
assert.equal(calls,0,'underfunded face rejected');
fields.price='12,00';await ctx.draft();
assert.equal(calls,1);
assert.equal(refreshes,1);
assert.equal(ctx.adminRuntime.clubeFinance.draftResult.moneyMoved,false);
ctx.adminRuntime.session.user.id='33333333-3333-4333-8333-333333333333';
await ctx.draft();assert.equal(calls,2,'new authenticated session may create a different draft');
assert.match(edge,/if\(action==="clube-coupon-package-draft-create"\)/);
assert.match(edge,/String\(adminAccess\.admin_role\)!=="superadmin"/);
assert.match(edge,/clube_coupon_paid_package_draft_create/);
assert.match(sql,/public\.platform_admin_audit/);
assert.match(sql,/sale_enabled\s*\)\s*values\(/);
assert.match(sql,/false,false,false,false/);
assert.match(sql,/COUPON_DRAFT_PRELAUNCH_REQUIRED/);
assert.match(sql,/grant execute on function public\.clube_coupon_paid_package_draft_create/);
assert.doesNotMatch(sql,/\bupdate public\.clube_coupon_paid_packages\b|\bon conflict\b/i);
assert.match(admin,/Preparar pacote de cupons \(somente rascunho\)/);
console.log('PASS: coupon internal draft requires superadmin, human confirmation, full face coverage, audit and zero sales');
