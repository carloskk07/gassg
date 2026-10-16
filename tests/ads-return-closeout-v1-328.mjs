import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016220000_ads_return_feedback_closeout_v1_328.sql');
const gateway=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-activations.js');
const mock=read('tests/admin-activations-v1-307.mjs');
new vm.Script(ui);
for(const token of [
 'admin_ads_return_feedback_closeout_v1_328','security definer',
 "set search_path to 'pg_catalog'","admin_role in ('superadmin','operations','readonly')",
 'r.attempt_contact_request_id',"r.status='attempt_recorded'",
 'a.version=r.assistance_version',"m.status='active'","coalesce(i.interested,false)",
 'c.channel=a.channel','latest.request_id',
 'platform_ads_contact_feedback_v1_325','f.contact_request_id=r.attempt_contact_request_id',
 "'merchant_confirmed'","'merchant_disputed'","'merchant_requested_followup'",
 "'awaiting_merchant_feedback'","'outdated'","'48 hours'",
 "'messagesSent',0","'independentDeliveryProof',false","'adsLive',false",
 'revoke all on function public.admin_ads_return_feedback_closeout_v1_328(uuid)',
 'grant execute on function public.admin_ads_return_feedback_closeout_v1_328(uuid) to service_role'
])assert.ok(sql.includes(token),'Missing SQL condition: '+token);
assert.ok(!/insert into public\.(merchant_billing|platform_ads_psp|platform_ads_assistance_contacts|platform_ads_contact_feedback)/.test(sql));
assert.ok(!/update public\.(merchant_billing|platform_ads_psp|platform_ads_feedback_returns|platform_ads_assistance)/.test(sql));
for(const token of [
 '"ads-return-closeout-read"','if(action==="ads-return-closeout-read")',
 'admin_ads_return_feedback_closeout_v1_328','data.independentDeliveryProof!==false',
 'data.paymentCreated!==false','data.messagesSent!==0',
 'r.currentConsentAndLatestAttempt'
])assert.ok(gateway.includes(token),'Gateway: '+token);
assert.ok(ui.includes("['adsReturnCloseout','ads-return-closeout-read','admin_ads_return_feedback_closeout_v1_328']"));
assert.ok(ui.includes('adminAdsReturnCloseoutView()'));
assert.ok(mock.includes("'ads-return-closeout-read'"));
assert.ok(mock.includes("calls.filter(x=>typeof x==='string').length,23"));
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',uuid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const make=(state,feedback,consent=true)=>({
 merchantId:id,merchantName:'Revenda Exemplo',originalContactId:uuid,attemptContactId:uuid,
 attemptReportedAt:'2026-10-16T10:00:00Z',attemptOutcome:'not_reached',
 feedbackResponse:feedback,currentConsentAndLatestAttempt:consent,
 state,attentionRequired:state==='merchant_disputed',independentlyVerified:false
});
const now=new Date().toISOString();
const ctx=vm.createContext({
 adminRuntime:{session:{user:{id:uuid}}},adminActivationDesk:{
  actor:uuid,role:'superadmin',checkedAt:now,data:{adsReturnCloseout:{
   source:'admin_ads_return_feedback_closeout_v1_328',readOnly:true,totalAttemptsDeclared:2,
   awaitingMerchantFeedback:0,confirmedByMerchant:0,disputedOrFollowupRequested:1,
   messagesSent:0,independentDeliveryProof:false,adsLive:false,paymentCreated:false,
   rows:[make('merchant_disputed','contact_not_received'),make('outdated',null,false)]
  }}},
 adminRoleCanSection:()=>true,adminCurrentRole:()=> 'superadmin',
 esc:value=>String(value),Date,Number,String
});
vm.runInContext(ui.slice(ui.indexOf('// V1.328 — evidence-only return follow-up closeout'))+
 '\nthis.showCloseout=adminAdsReturnCloseoutView;',ctx);
const rendered=ctx.showCloseout();
assert.match(rendered,/Revenda informou que não recebeu/);
assert.match(rendered,/Requer acompanhamento humano/);
assert.doesNotMatch(rendered,/Histórico de ciclo anterior/);
assert.match(rendered,/Contatos enviados automaticamente: 0/);
ctx.adminActivationDesk.data=null;
assert.match(ctx.showCloseout(),/não foi confirmada/);
console.log('V1.328 PASS — current-cycle merchant feedback evidence, no inferred delivery or financial changes.');
