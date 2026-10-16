import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016200000_ads_feedback_returns_v1_326.sql');
const adminEdge=read('supabase/functions/admin-ops/index.ts');
const merchantEdge=read('supabase/functions/merchant-ops/index.ts');
const adminUI=read('js/admin-activations.js');
const merchantUI=read('js/merchant.js');
new vm.Script(adminUI);new vm.Script(merchantUI);
for(const token of [
 'platform_ads_feedback_returns_v1_326','platform_ads_feedback_return_events_v1_326',
 'enable row level security','revoke all on public.platform_ads_feedback_returns_v1_326',
 'revoke all on public.platform_ads_feedback_return_events_v1_326',
 'admin_ads_feedback_returns_read_v1_326',
 'admin_ads_feedback_return_action_v1_326',
 'merchant_ads_feedback_return_v1_326',
 "a.admin_role='superadmin'","mm.member_role in ('owner','manager')",
 "f.response in ('contact_not_received','followup_needed')",
 "v_f.response not in ('contact_not_received','followup_needed')",
 "v_a.status not in ('requested','triaged')","m.status='active'",
 'c.recorded_at>=a.requested_at','v_c.request_id<>p_contact',
 'ADS_RETURN_CONSENT_STALE','ADS_RETURN_CONTACT_STALE',
 'ADS_RETURN_VERSION_CONFLICT','ADS_RETURN_REQUEST_REUSE',
 "'messageSent',false","'contactPerformed',false",
 "'deliveryProven',false","'paymentCreated',false","'adsLive',false",
 "'messagesSent',0","'followupsDue'","'totalPlans'"
])assert.ok(sql.includes(token),'SQL invariant: '+token);
assert.ok(!/insert into public\.(merchant_billing|platform_ads_psp|merchant_ads_campaigns)/.test(sql));
assert.ok(!/update public\.(merchant_billing|platform_ads_psp|merchant_ads_campaigns)/.test(sql));
for(const token of [
 '"ads-feedback-returns-read"','if(action==="ads-feedback-returns-read")',
 '"ads-feedback-return-action"','if(action==="ads-feedback-return-action")',
 'admin_ads_feedback_returns_read_v1_326','admin_ads_feedback_return_action_v1_326',
 'String(adminAccess.admin_role||"")!=="superadmin"',
 'data.contactPerformed!==false','data.paymentCreated!==false'
])assert.ok(adminEdge.includes(token),'Admin gateway: '+token);
for(const token of [
 '"ads-feedback-return"','if(action==="ads-feedback-return")',
 'body.operation!=="view"','merchant_ads_feedback_return_v1_326',
 'data.deliveryProven!==false','data.paymentCreated!==false'
])assert.ok(merchantEdge.includes(token),'Merchant gateway: '+token);
// Regression: V1.325 operation is "respond", not "submit". False consent blocked every response.
assert.ok(merchantEdge.includes('p_consent:operation==="respond"'),'V1.325 owner consent was not forwarded');
assert.ok(!merchantEdge.includes('p_consent:operation==="submit"'),'Must not regress to bad operation');
assert.ok(adminUI.includes('adminAdsFeedbackReturnsView()'));
assert.ok(adminUI.includes("['adsFeedbackReturns','ads-feedback-returns-read','admin_ads_feedback_returns_v1_326']"));
assert.ok(merchantUI.includes('merchantAdsFeedbackReturnSection(m)'));
const merchantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const rt={merchant:{merchantId,memberRole:'owner'}};
let calls=[];
const merchantTail=merchantUI.slice(merchantUI.indexOf('// V1.326 — read-only status'));
const ctx=vm.createContext({
 merchantRuntime:rt,merchantInvoke:async(_name,payload)=>{calls.push(payload);return{
   source:'merchant_ads_feedback_return_v1_326',merchantId,readOnly:true,
   consentCurrent:true,returnPlan:{status:'scheduled',version:1,dueOn:'2026-10-21'},
   messageSent:false,contactPerformed:false,deliveryProven:false,adsLive:false,paymentCreated:false
 };},
 esc:s=>String(s),render:()=>{},toast:()=>{},Date,Number,String
});
vm.runInContext(merchantTail+'\nthis.load=merchantAdsFeedbackReturnLoad;this.view=merchantAdsFeedbackReturnSection;',ctx);
assert.equal((await ctx.load()).returnPlan.status,'scheduled');
assert.match(ctx.view(rt.merchant),/2026-10-21/);
assert.doesNotMatch(ctx.view(rt.merchant),/nota interna/i);
assert.equal(calls.length,1);
assert.equal(calls[0].operation,'view');
rt.merchant.memberRole='manager';assert.match(ctx.view(rt.merchant),/Retorno manual previsto/);
rt.merchant.memberRole='support';assert.equal(ctx.view(rt.merchant),'');
console.log('V1.326 PASS — founder-only return planning, owner-scoped view, no automatic messages or payments, V1.325 consent repaired.');
