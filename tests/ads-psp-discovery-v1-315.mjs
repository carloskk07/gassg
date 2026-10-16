import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const adminApi=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-activations.js');
const previous=read('tests/ads-platform-psp-v1-314.mjs');
assert.ok(previous.includes('V1.314 PASS'));
new vm.Script(ui,{filename:'js/admin-activations.js'});
const begin=adminApi.indexOf('if(action==="ads-psp-discover"){');
const end=adminApi.indexOf('if(action==="ads-psp-action"){',begin);
assert.ok(begin>0&&end>begin,'Discovery precedes legacy independently verified reconciliation');
const handler=adminApi.slice(begin,end);
for(const token of [
 'String(adminAccess.admin_role||"")!=="superadmin"',
 'ADS_MP_CHECKOUT_ENABLED','ADS_MP_ACCESS_TOKEN','ADS_MP_SELLER_ID',
 'https://api.mercadolibre.com/users/me',
 'String(identity?.id||"")!==sellerId',
 'admin_ads_psp_read_v1_314',
 'checkout_ready','payment_approved',
 '/v1/payments/search?external_reference=',
 'encodeURIComponent(reference)','limit=50&offset=0',
 'sort=date_last_updated&criteria=desc',
 'search?.paging?.total','total!==1||search.results.length!==1',
 'candidate?.external_reference!==reference',
 '"/v1/payments/"+paymentId',
 'String(payment?.id||"")!==paymentId',
 'payment?.external_reference!==reference',
 'moneyToCents(payment?.transaction_amount)!==checkout.amountCents',
 'String(payment?.collector_id??payment?.collector?.id??"")!==sellerId',
 'payment?.currency_id!=="BRL"',
 'status==="approved"&&detail==="accredited"',
 'detail==="partially_refunded"',
 'status:"not_found"',
 'status:"manual_review"',
 'providerEvidenceRecorded:false',
 'nextStatus'
])assert.ok(handler.includes(token),'Missing PSP discovery guard '+token);
assert.ok(!/admin\.rpc\("admin_ads_psp_action_v1_314"/.test(handler),'Discovery must never update paid state');
assert.ok(!/checkout\/preferences/.test(handler),'Discovery must not generate new checkout');
assert.ok(!/return json\([^;]*providerEvidenceRecorded:true/.test(handler),'Search is not settled proof');
assert.ok(ui.includes('adminAdsPspAutoReview('),'Admin needs auto-discovery action');
assert.ok(ui.includes('Conferir pelo ID do pagamento'),'Manual reconciliation must remain available');
const start=ui.indexOf('async function adminAdsPspAutoReview(');
const finish=ui.indexOf('async function adminAdsPspAction(',start);
assert.ok(start>0&&finish>start);
const isolated=ui.slice(start,finish);
let role='superadmin',confirmed=true;
const merchantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const reference='tamao-ads-'+merchantId.replaceAll('-','')+'-v2';
const row={merchantId,checkout:{status:'checkout_ready',externalReference:reference,version:2}};
const desk={platformPspConfigured:true,rows:[row]};
const calls=[];const messages=[];
let discoveryStatus='not_found';
const paymentId='123456789';
const state={data:{adsPsp:desk},actor:'actor',role:'superadmin',loading:false,
 checkedAt:new Date().toISOString()};
const ctx=vm.createContext({
 adminReady:()=>true,adminCurrentRole:()=>role,
 adminRuntime:{session:{user:{id:'actor'}}},
 adminActivationDesk:state,
 adminPerform:async(action,body)=>{
  calls.push({action,body});
  if(action==='ads-psp-discover')return {
   source:'admin_ads_psp_discovery_v1_315',merchantId,
   externalReference:reference,adsLive:false,merchantBillingSeparate:true,
   providerEvidenceRecorded:false,candidateCount:discoveryStatus==='not_found'?0:1,
   status:discoveryStatus,
   paymentId:['approval_candidate','reversal_candidate'].includes(discoveryStatus)?paymentId:null
  };
  if(action==='ads-psp-action')return {
   source:'admin_ads_psp_reconcile_v1_314',merchantId,paymentId,
   status:discoveryStatus==='approval_candidate'?'payment_approved':'payment_reversed',
   verifiedFromProvider:true,adsLive:false
  };
  throw Error('Unexpected command');
 },
 adminActivationLoad:async()=>{
  const status=discoveryStatus==='approval_candidate'?'payment_approved':'payment_reversed';
  state.data={adsPsp:{...desk,rows:[{...row,checkout:{...row.checkout,status,paymentId}}]}};
  return state.data;
 },
 confirm:()=>confirmed,toast:s=>messages.push(s),
 crypto:{randomUUID:()=> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},
 Date,Number,String,Promise
});
vm.runInContext(isolated+'\nthis.run=adminAdsPspAutoReview;',ctx);
assert.equal(await ctx.run(merchantId),false);
assert.equal(calls.filter(x=>x.action==='ads-psp-action').length,0);
discoveryStatus='manual_review';
assert.equal(await ctx.run(merchantId),false);
assert.equal(calls.filter(x=>x.action==='ads-psp-action').length,0);
discoveryStatus='approval_candidate';confirmed=false;
assert.equal(await ctx.run(merchantId),false);
assert.equal(calls.filter(x=>x.action==='ads-psp-action').length,0);
confirmed=true;
assert.equal(await ctx.run(merchantId),true);
assert.equal(calls.filter(x=>x.action==='ads-psp-action').length,1);
assert.equal(calls.find(x=>x.action==='ads-psp-action').body.paymentId,paymentId);
assert.equal(state.data.adsPsp.rows[0].checkout.status,'payment_approved');
role='operations';
assert.equal(await ctx.run(merchantId),false);
console.log('V1.315 PASS — reference lookup is read-only; duplicate/pending blocked; final settlement reverified via V1.314.');
