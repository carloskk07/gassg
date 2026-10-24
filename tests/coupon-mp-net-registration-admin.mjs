import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('js/admin.js');
const edge=read('supabase/functions/admin-ops/index.ts');
const readOnlyTest=read('tests/coupon-mp-release-evidence.mjs');
new vm.Script(admin,{filename:'js/admin.js'});
const start=admin.indexOf('async function adminClubeReleaseRegisterNet(){');
const finish=admin.indexOf('function adminClubeReleaseReportsView(){',start);
assert.ok(start>0&&finish>start);
const changeStart=admin.indexOf('function adminClubeReleaseInvoiceChanged(value){');
const changeFinish=admin.indexOf('async function adminClubeReleaseInspect(index){',changeStart);
assert.ok(changeStart>0&&changeFinish>changeStart);
const invoiceId='11111111-1111-4111-8111-111111111111';
const id='22222222-2222-4222-8222-222222222222';
const expectedEvidenceReference='mp-release:report-20261024.csv:mp-payment-01';
let role='finance',calls=0,confirmed=0,authAllowed=true;
const state={
 adminRuntime:{status:'ready',session:{user:{id}},clubeFinance:{
  releaseInvoiceId:invoiceId,releaseEvidenceInvoiceId:invoiceId,
  releaseEvidenceReportFileName:'report-20261024.csv',releaseEvidenceFor:id,
  releaseEvidence:{eligible:true,providerReportChecked:true,netCents:1100,
   evidenceReference:expectedEvidenceReference},releaseEvidencePending:false}},
 adminCurrentRole:()=>role,
 adminInvoke:async(args)=>{
  calls++;
  assert.deepEqual({...args},{action:'clube-coupon-mp-funding-finalize',
   invoiceId,reportFileName:'report-20261024.csv',expectedNetCents:1100,
   expectedEvidenceReference,confirmation:'CONFIRMAR_LIQUIDO'});
  return {source:'coupon_mp_released_net_registration_v1',ok:true,
   invoiceId,netEvidenceRegistered:true,netCents:1100,evidenceReference:expectedEvidenceReference,
   couponFundingApplied:false,moneyMoved:false,merchantPayoutVerified:false,
   couponsAvailableForCheckout:false,replayed:false};
 },
 confirm:()=>{confirmed++;return authAllowed},
 render:()=>{}
};
const ctx=vm.createContext(state);
vm.runInContext(admin.slice(changeStart,changeFinish)+admin.slice(start,finish)+
 ';this.register=adminClubeReleaseRegisterNet;this.change=adminClubeReleaseInvoiceChanged;',ctx);
await ctx.register();
assert.equal(calls,0,'finance role must not write net evidence');
assert.equal(confirmed,0,'finance role must not even ask for confirmation');
role='superadmin';
authAllowed=false;
await ctx.register();
assert.equal(calls,0,'declined user confirmation must not register');
authAllowed=true;
await ctx.register();
assert.equal(calls,1);
assert.equal(state.adminRuntime.clubeFinance.releaseRegistration.netEvidenceRegistered,true);
assert.equal(state.adminRuntime.clubeFinance.releaseEvidence,null);
await ctx.register();
assert.equal(calls,1,'no stale replay without new inspection');
const st=state.adminRuntime.clubeFinance;
st.releaseEvidence={eligible:true,providerReportChecked:true,netCents:1100,
 evidenceReference:expectedEvidenceReference};
st.releaseEvidenceInvoiceId='different';
await ctx.register();
assert.equal(calls,1,'changed invoice must refuse');
st.releaseEvidenceInvoiceId=invoiceId;
st.releaseEvidenceFor='another user';
await ctx.register();
assert.equal(calls,1,'cross-account proof must refuse');
st.releaseEvidenceFor=id;
st.releaseEvidence.providerReportChecked=false;
await ctx.register();
assert.equal(calls,1,'unverified report must refuse');
st.releaseEvidence.providerReportChecked=true;
ctx.change('33333333-3333-4333-8333-333333333333');
assert.equal(st.releaseEvidence,null,'changing invoice invalidates the preview');
assert.equal(st.releaseRegistration,null,'changing invoice clears any prior confirmation');
assert.match(edge,/const finalize=action==="clube-coupon-mp-funding-finalize"/);
assert.match(edge,/if\(finalize&&String\(adminAccess\.admin_role\)!=="superadmin"\)/);
assert.match(edge,/clube_coupon_paid_net_proceeds_verify/);
assert.match(edge,/inspection\.netCents!==body\.expectedNetCents/);
assert.match(edge,/inspection\.evidenceReference!==body\.expectedEvidenceReference/);
assert.match(edge,/p_provider_order_id:invoice\.provider_order_id/);
assert.match(edge,/finalize\?matching\[0\]\?\.is_test!==false/,
 'recording money requires a real, explicitly non-test Mercado Pago report');
assert.match(edge,/replayed:registered\.replayed===true/);
assert.match(edge,/couponFundingApplied:false,merchantPayoutVerified:false/);
assert.match(readOnlyTest,/provider reconciliation must not write directly/);
console.log('PASS: superadmin explicit net receipt recording, invoice binding, role separation, stale evidence rejection and financial gates');
