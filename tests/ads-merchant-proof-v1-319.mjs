import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016130000_ads_merchant_proof_v1_319.sql');
const merchant=read('js/merchant.js'),edge=read('supabase/functions/merchant-ops/index.ts');
const admin=read('js/admin-activations.js'),adminEdge=read('supabase/functions/admin-ops/index.ts');
new vm.Script(merchant);new vm.Script(admin);
for(const t of [
 'platform_ads_psp_review_requests_v1_319','enable row level security',
 'revoke all on public.platform_ads_psp_review_requests_v1_319',
 "mm.member_role in ('owner','manager')","v_role<>'owner'",
 'admin_ads_psp_review_requests_v1_319','merchant_ads_psp_evidence_v1_319',
 'v_c.status=','v_inbox.received_at>=v_c.verified_at',
 "'refunded','charged_back'","'partially_refunded'",
 "'approval_evidence_stale'","'approval_refresh_recommended'",
 "'reversal_observed_review_required'","'approval_last_verified'",
 "'approval_observed_unreconciled'","'awaiting_provider_confirmation'",
 'v_age>=24','interval \'12 hours\'',
 'v_c.version<>p_expected_version','ADS_EVIDENCE_OWNER_REQUIRED',
 "'paymentStateChanged',false","'providerRechecked',false",
 "'automaticReconciliation',false","'adsLive',false",
 "'merchantBillingSeparate',true",
 'platform_admin_audit',
 'verified_at>requested_at','current_version>checkout_version'
])assert.ok(sql.includes(t),'Missing SQL guard: '+t);
assert.doesNotMatch(sql,/insert into public\.(merchant_billing_payment_events|merchant_billing_provider_charges|merchant_sale_payment_attempts)/);
assert.doesNotMatch(sql,/update public\.(platform_ads_psp_checkouts|ads_placement_controls)/);
for(const t of [
 '"ads-psp-evidence"','if(action==="ads-psp-evidence")',
 'role!=="owner"','merchant_ads_psp_evidence_v1_319',
 'data.paymentStateChanged!==false','data.providerRechecked!==false',
 'data.adsLive!==false'
])assert.ok(edge.includes(t),'Missing merchant API guard: '+t);
for(const t of ['"ads-psp-merchant-reviews"','if(action==="ads-psp-merchant-reviews")',
 'admin_ads_psp_review_requests_v1_319','data.paymentStateChanged!==false',
 'data.automaticReconciliation!==false'])assert.ok(adminEdge.includes(t));
assert.ok(admin.includes('adminAdsPspMerchantReviewsView()'));
assert.ok(admin.includes("['adsPspMerchantReviews','ads-psp-merchant-reviews','admin_ads_psp_review_requests_v1_319']"));
assert.ok(merchant.includes('merchantAdsPspEvidenceSection(m)'));
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let role='owner',status='approval_evidence_stale',requests=0,canRequest=true,confirmed=false,checkoutVersion=3;
const now='2026-10-15T22:00:00+00:00';
const rt={merchant:{merchantId:id,memberRole:role}};let sent=[],notices=[];
const tail=merchant.slice(merchant.indexOf('// V1.319 — server-owned evidence age'));
const ctx=vm.createContext({
 merchantRuntime:rt,
 merchantInvoke:async(_name,payload)=>{
  sent.push(payload);
  if(payload.operation==='view')return {
   source:'merchant_ads_psp_evidence_v1_319',merchantId:id,readOnly:true,
   snapshotOnly:true,providerRechecked:false,paymentStateChanged:false,
   adsLive:false,merchantBillingSeparate:true,
   evidence:{status,checkoutVersion,paymentId:'987654',
    lastProviderVerifiedAt:now,hoursSinceVerified:28,lastObservedAt:null,
    lastObservedStatus:null,lastObservedDetail:null,
    possibleReversal:status==='reversal_observed_review_required',
    reviewRequestedAt:requests?now:null,canRequestReview:canRequest}
  };
  requests++;canRequest=false;
  return {source:'merchant_ads_psp_evidence_v1_319',merchantId:id,
   requestRecorded:true,paymentStateChanged:false,providerRechecked:false,
   adsLive:false,merchantBillingSeparate:true};
 },
 confirm:()=>confirmed,crypto:{randomUUID:()=> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},
 toast:x=>notices.push(x),render:()=>{},esc:s=>String(s),
 Date,Number,String,Promise
});
vm.runInContext(tail+'\nthis.load=merchantAdsPspEvidenceLoad;this.request=merchantAdsPspEvidenceRequest;this.show=merchantAdsPspEvidenceSection;',ctx);
assert.equal((await ctx.load()).evidence.status,'approval_evidence_stale');
assert.match(ctx.show(rt.merchant),/Confirmação desatualizada/);
assert.match(ctx.show(rt.merchant),/Solicitar nova conferência/);
assert.equal(await ctx.request(),false);
assert.equal(requests,0);
confirmed=true;
assert.equal(await ctx.request(),true);
assert.equal(requests,1);
assert.equal(sent.filter(x=>x.operation==='request_review').length,1);
assert.equal(sent.find(x=>x.operation==='request_review').expectedVersion,3);
assert.doesNotMatch(ctx.show(rt.merchant),/onclick="merchantAdsPspEvidenceRequest/);
status='reversal_observed_review_required';canRequest=false;
await ctx.load();
assert.match(ctx.show(rt.merchant),/Pode ter ocorrido um estorno/);
rt.merchant.memberRole='manager';canRequest=true;
assert.equal(await ctx.request(),false);
rt.merchant.memberRole='support';
assert.equal(ctx.show(rt.merchant),'');
console.log('V1.319 PASS — merchant evidence aging, reversal warning, owner-only review request, no settlement mutations.');
