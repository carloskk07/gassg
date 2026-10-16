import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016210000_ads_return_attempts_v1_327.sql');
const a=read('supabase/functions/admin-ops/index.ts'),m=read('supabase/functions/merchant-ops/index.ts');
const admin=read('js/admin-activations.js'),merchant=read('js/merchant.js');
new vm.Script(admin);new vm.Script(merchant);
for(const t of [
 'attempt_contact_request_id uuid unique','attempt_recorded_at timestamptz',
 'platform_ads_feedback_return_attempt_consistency_v1_327',
 "status in ('scheduled','canceled','attempt_recorded')",
 'ads_return_link_attempt_after_contact_v1_327',
 'after insert on public.platform_ads_assistance_contacts_v1_324',
 "set status='attempt_recorded'","r.assistance_version=new.assistance_version",
 "a.version=new.assistance_version","new.channel=a.channel",
 "m.status='active'","i.interested","updated_by=new.reported_by",
 "'ads-return-attempt-reported'","'independentlyVerified',false",
 'admin_ads_return_execution_read_v1_327',
 'merchant_ads_return_execution_v1_327',
 "mm.member_role in ('owner','manager')",
 'revoke all on function public.admin_ads_return_execution_read_v1_327(uuid)',
 'revoke all on function public.merchant_ads_return_execution_v1_327(uuid,uuid)',
 "'automaticMessagesSent',0","'independentDeliveryProof',false",
 "'adsLive',false","'paymentCreated',false"
])assert.ok(sql.includes(t),'Missing security invariant: '+t);
assert.ok(!/update public\.(merchant_billing|platform_ads_psp|merchant_ads_campaigns)/.test(sql));
assert.ok(!/insert into public\.(merchant_billing|platform_ads_psp|merchant_ads_campaigns)/.test(sql));
for(const t of ['"ads-return-execution-read"','if(action==="ads-return-execution-read")',
 'admin_ads_return_execution_read_v1_327','data.independentDeliveryProof!==false',
 'data.paymentCreated!==false'])assert.ok(a.includes(t),'Admin gateway '+t);
for(const t of ['"ads-return-execution"','if(action==="ads-return-execution")',
 'body.operation!=="view"','merchant_ads_return_execution_v1_327',
 'data.independentDeliveryProof!==false','data.paymentCreated!==false'])
 assert.ok(m.includes(t),'Merchant gateway '+t);
assert.ok(admin.includes('adminAdsReturnExecutionView()'));
assert.ok(admin.includes("['adsReturnExecution','ads-return-execution-read','admin_ads_return_execution_v1_327']"));
assert.ok(admin.includes('adminAdsReturnGoToContact('));
assert.ok(merchant.includes('merchantAdsReturnExecutionSection(m)'));
const merchantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const rt={merchant:{merchantId,memberRole:'owner'}},calls=[];
const tail=merchant.slice(merchant.indexOf('// V1.327 — merchant sees'));
const ctx=vm.createContext({
 merchantRuntime:rt,merchantInvoke:async(_n,p)=>{calls.push(p);return{
  source:'merchant_ads_return_execution_v1_327',merchantId,readOnly:true,consentCurrent:true,
  plan:{status:'attempt_recorded',version:2,dueOn:'2026-10-21',
    attemptReportedAt:'2026-10-22T15:00:00Z',attemptOutcome:'not_reached',
    attemptIndependentlyVerified:false},
  automaticMessagesSent:0,independentDeliveryProof:false,adsLive:false,paymentCreated:false
 };},
 esc:s=>String(s),render:()=>{},toast:()=>{},Date,Number,String
});
vm.runInContext(tail+'\nthis.load=merchantAdsReturnExecutionLoad;this.view=merchantAdsReturnExecutionSection;',ctx);
assert.equal((await ctx.load()).plan.status,'attempt_recorded');
assert.match(ctx.view(rt.merchant),/Nova tentativa relatada pela equipe/);
assert.match(ctx.view(rt.merchant),/não conseguiu falar/);
assert.doesNotMatch(ctx.view(rt.merchant),/nota interna/i);
assert.equal(calls[0].operation,'view');
rt.merchant.memberRole='manager';assert.match(ctx.view(rt.merchant),/Retorno/);
rt.merchant.memberRole='support';assert.equal(ctx.view(rt.merchant),'');
console.log('V1.327 PASS — observed manual attempt, no delivery proof, consent and active-cycle boundaries.');
