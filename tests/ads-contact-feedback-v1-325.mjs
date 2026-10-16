import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016190000_ads_contact_feedback_v1_325.sql');
const merchantEdge=read('supabase/functions/merchant-ops/index.ts');
const adminEdge=read('supabase/functions/admin-ops/index.ts');
const merchant=read('js/merchant.js'),admin=read('js/admin-activations.js');
new vm.Script(merchant);new vm.Script(admin);
for(const token of [
 'platform_ads_contact_feedback_v1_325','contact_request_id uuid not null unique',
 'enable row level security','revoke all on public.platform_ads_contact_feedback_v1_325',
 'grant select,insert on public.platform_ads_contact_feedback_v1_325 to service_role',
 'merchant_ads_contact_feedback_v1_325','admin_ads_contact_feedback_read_v1_325',
 "v_role<>'owner'","p_consent is distinct from true",
 "v_a.status in ('requested','triaged')","v_m.status='active'",
 'c.recorded_at>=v_a.requested_at','c.recorded_at>=a.requested_at',
 'v_c.request_id<>p_contact_request','ADS_FEEDBACK_CONSENT_OR_CONTACT_STALE',
 'ADS_FEEDBACK_REQUEST_REUSE','platform_admin_audit',
 'contact_not_received','contact_confirmed','followup_needed',
 "'messageSent',false","'deliveryProven',false",
 "'paymentCreated',false","'adsLive',false",
 "'messagesSent',0","'totalMerchantFeedback'","'awaitingMerchantFeedback'"
])assert.ok(sql.includes(token),'SQL guarantee missing: '+token);
assert.ok(!/insert into public\.(merchant_billing|platform_ads_psp|merchant_ads_campaigns)/.test(sql));
for(const token of [
 '"ads-contact-feedback"','if(action==="ads-contact-feedback")',
 'merchant_ads_contact_feedback_v1_325','body.consent!==true',
 'role!=="owner"','data.deliveryProven!==false'
])assert.ok(merchantEdge.includes(token),'Merchant Edge guarantee: '+token);
for(const token of [
 '"ads-contact-feedback-read"','if(action==="ads-contact-feedback-read")',
 'admin_ads_contact_feedback_read_v1_325','data.deliveryProven!==false'
])assert.ok(adminEdge.includes(token),'Admin Edge guarantee: '+token);
assert.ok(admin.includes('adminAdsFeedbackView()'));
assert.ok(admin.includes("['adsFeedback','ads-contact-feedback-read','admin_ads_contact_feedback_v1_325']"));
assert.ok(merchant.includes('merchantAdsContactFeedbackSection(m)'));
const merchantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const contactId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let choice='',consent=false,approval=true,feedback=null,role='owner',calls=[];
const rt={merchant:{merchantId,memberRole:role}};
const ctx=vm.createContext({
 merchantRuntime:rt,merchantInvoke:async(_name,payload)=>{
  calls.push(payload);
  if(payload.operation==='view')return {
   source:'merchant_ads_contact_feedback_v1_325',merchantId,
   readOnly:true,assistanceVersion:2,consentCurrent:true,
   messageSent:false,deliveryProven:false,adsLive:false,paymentCreated:false,
   lastContact:{contactRequestId:contactId,reportedOutcome:'conversation',
    reportedAt:'2026-10-16T17:30:00Z',channel:'whatsapp',
    nextFollowupOn:null,adminReportIndependentProof:false,feedback}
  };
  feedback={response:payload.response,submittedAt:'2026-10-16T17:31:00Z',merchantDeclared:true};
  return {source:'merchant_ads_contact_feedback_v1_325',merchantId,recorded:true,
   response:payload.response,contactRequestId:contactId,
   messageSent:false,deliveryProven:false,adsLive:false,paymentCreated:false};
 },
 document:{getElementById:key=>({
  value:key==='ads-contact-feedback-response'?choice:'',
  checked:key==='ads-contact-feedback-consent'?consent:false
 })},
 confirm:()=>approval,crypto:{randomUUID:()=> 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},
 toast:()=>{},render:()=>{},esc:s=>String(s),
 Number,String,Date,Promise
});
const tail=merchant.slice(merchant.indexOf('// V1.325 — explicit owner-reported'));
vm.runInContext(tail+
 '\nthis.load=merchantAdsContactFeedbackLoad;this.submit=merchantAdsContactFeedbackSubmit;this.view=merchantAdsContactFeedbackSection;',ctx);
assert.equal((await ctx.load()).lastContact.reportedOutcome,'conversation');
assert.match(ctx.view(rt.merchant),/Como foi nosso atendimento/);
assert.match(ctx.view(rt.merchant),/Registrar minha avaliação/);
assert.equal(await ctx.submit(),false);
choice='contact_not_received';assert.equal(await ctx.submit(),false);
consent=true;approval=false;assert.equal(await ctx.submit(),false);
assert.equal(calls.filter(x=>x.operation==='submit').length,0);
approval=true;assert.equal(await ctx.submit(),true);
assert.equal(calls.filter(x=>x.operation==='submit').length,1);
assert.equal(calls.find(x=>x.operation==='submit').contactRequestId,contactId);
assert.equal(calls.find(x=>x.operation==='submit').expectedAssistanceVersion,2);
assert.doesNotMatch(ctx.view(rt.merchant),/onclick="merchantAdsContactFeedbackSubmit/);
rt.merchant.memberRole='manager';assert.equal(await ctx.submit(),false);
rt.merchant.memberRole='support';assert.equal(ctx.view(rt.merchant),'');
console.log('V1.325 PASS — owner-confirmed contact feedback, cycle version, consent, no invented delivery or financial operation.');
