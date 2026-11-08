import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('js/admin.js'),acq=read('js/admin-acquisition.js'),ads=read('js/admin-activations.js');
for(const [name,body] of [['admin',admin],['acquisition',acq],['activations',ads]])
  new vm.Script(body,{filename:name+'.js'});
const span=(source,start,end)=>{
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'Missing range '+start);
  return source.slice(a,b);
};
const fn=(source,name)=>{
  const a=source.search(new RegExp('(?:async )?function '+name+'\\('));
  assert.ok(a>=0,'Missing function '+name);
  const b=source.indexOf('\n}',a);
  assert.ok(b>a,'Incomplete function '+name);
  return source.slice(a,b+2);
};
const escaped=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const fields=new Map(),writes=[],notices=[];
const set=(id,value,extra={})=>fields.set(id,{value,...extra});
const uuid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ctx=vm.createContext({
  document:{getElementById:id=>fields.get(id)||null},
  esc:escaped,adminMoney:c=>'R$ '+(Number(c)/100).toFixed(2),formatDateTime:String,
  adminStatusPill:()=>'<span>Em revisão</span>',adminMerchantName:()=> 'Revenda',
  adminBillingPlanLabel:()=> 'Flex', adminBillingStatementStatus:()=> 'ABERTO',
  adminOrderStatusLabel:s=>s,
  Date,Number,String,Array,Object,Set,Math,Intl,
  crypto:{randomUUID:()=> '12345678-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},
  adminRuntime:{status:'ready',session:{user:{id:'owner'}},
    data:{merchantBilling:{statements:[{id:uuid,merchant_id:uuid,status:'open',amount_due_cents:1200}]}},
    actionPending:false},
  adminReady:()=>true,adminCurrentRole:()=> 'superadmin',adminFinanceDecisionScope:()=>true,
  adminPerform:async(action,payload)=>{writes.push({action,payload});return {ok:true,
    source:action==='ads-psp-action'?'admin_ads_psp_reconcile_v1_314':null,
    merchantId:uuid,status:'payment_approved',adsLive:false,noAdsPublication:true}},
  adminInvoke:async(action)=>{writes.push({action:action.action,payload:action});return {
    source:action.action==='owner-benefit-payout-void'?'admin_owner_referral_payout_void_v1_263':'admin_owner_budget_release_v1_247',
    claimId:uuid,alreadyVoided:false,transferExecuted:false,
    recorded:true,plannedOnly:true,noCharge:true,fundsVerified:false,spendableCents:0,newBenefitsEnabled:false
  }},
  adminFinanceDecisionProof:async()=>({status:'verified'}),
  adminFinanceDecisionMessage:()=>{},adminOwnerBudgetLoadFromUi:async()=>{},
  toast:msg=>notices.push(String(msg)),confirm:()=>true,render:()=>{},
  adminOwnerBudgetBusy:false,
  adminOwnerBudgetPending:new Set(),
  adminOwnerBudgetState:{loadedFor:'owner',allocations:[{allocationId:uuid,status:'allocated',version:1}]},
  adminOwnerPayoutBusy:false,adminOwnerPayoutState:{loadedFor:'owner'},
  adminActivationDesk:{loading:false,actor:'owner',role:'superadmin',
    checkedAt:new Date().toISOString(),
    data:{adsPsp:{platformPspConfigured:true,rows:[{merchantId:uuid,checkout:{status:'checkout_ready'}}]}}},
  adminActivationLoad:async()=>({adsPsp:{rows:[{merchantId:uuid,checkout:{status:'payment_approved'}}]}})
});
const source=[
  span(admin,'const ADMIN_ORDER_ACTION_REASONS=','async function adminOrderControl('),
  fn(admin,'adminOrderControl'),fn(admin,'adminControlOrderCard'),
  span(admin,'const ADMIN_REFERRAL_REJECTION_REASONS=','async function adminReviewReferral('),
  fn(admin,'adminReviewReferral'),fn(admin,'adminReferralReviewCard'),
  span(admin,'const ADMIN_BILLING_CHOICE_REASONS=','async function adminSaveBillingPlan('),
  fn(admin,'adminSaveBillingPlan'),fn(admin,'adminSetMerchantFlex'),fn(admin,'adminResolveDailyStatement'),
  fn(admin,'adminBillingPlanCard'),fn(admin,'adminBillingAccountCard'),fn(admin,'adminBillingStatementCard'),
  span(acq,'const ADMIN_BUDGET_RELEASE_REASONS=','async function adminOwnerBudgetReleaseFromUi('),
  fn(acq,'adminOwnerBudgetReleaseFromUi'),fn(acq,'adminOwnerBudgetSection'),
  span(acq,'const ADMIN_PAYOUT_VOID_REASONS=','async function adminOwnerPayoutVoidFromUi('),
  fn(acq,'adminOwnerPayoutVoidFromUi'),fn(acq,'adminOwnerPayoutEvidenceSection'),
  fn(ads,'adminAdsPspAction'),fn(ads,'adminAdsPspView')
].join('\n');
vm.runInContext(source+'\nthis.api={order:adminOrderControl,orderUI:adminOrderActionChoice,'+
  'referral:adminReviewReferral,referralUI:adminReferralReviewCard,'+
  'rate:adminBillingRateValue,rateChange:adminBillingRatePresetChange,bill:adminSaveBillingPlan,'+
  'billUI:adminBillingPlanCard,flex:adminSetMerchantFlex,waive:adminResolveDailyStatement,'+
  'budget:adminOwnerBudgetReleaseFromUi,budgetUI:adminOwnerBudgetSection,'+
  'budgetTemplate:adminOwnerBudgetApplyTemplate,payout:adminOwnerPayoutVoidFromUi,'+
  'psp:adminAdsPspAction,pspUI:adminAdsPspView};',ctx);
const t=ctx.api;
// Orders: selections cannot mutate unobserved state, and dispatch failures require a second check.
const order={id:uuid,version:3,merchant_id:uuid};
assert.match(t.orderUI(order,'rescue','Buscar outra revenda','secondary'),/Marque o motivo real/);
assert.match(t.orderUI(order,'cancel-after-dispatch','Encerrar entrega','danger-btn'),/admin-order-verified/);
await t.order(uuid,3,'cancel');assert.equal(writes.length,0);
set('admin-order-reason-'+uuid+'-cancel','customer');
await t.order(uuid,3,'cancel');
assert.equal(writes.pop().payload.reason,'Cancelamento solicitado pelo cliente, conforme contato confirmado.');
set('admin-order-reason-'+uuid+'-cancel-after-dispatch','failed');
await t.order(uuid,3,'cancel-after-dispatch');assert.equal(writes.length,0);
fields.set('admin-order-verified-'+uuid,{checked:true});
await t.order(uuid,3,'cancel-after-dispatch');
assert.equal(writes.pop().payload.controlAction,'cancel-after-dispatch');
set('admin-order-reason-'+uuid+'-cancel','__proto__');
await t.order(uuid,3,'cancel');assert.equal(writes.length,0);
// Referrals: user must explicitly review; rejection requires actual reason.
const referral={order_id:uuid,risk_status:'review_required',risk_reasons:[],created_at:'2026-11-01T10:00:00Z'};
assert.match(t.referralUI(referral),/referral-reviewed/);
await t.referral(uuid,'approved');assert.equal(writes.length,0);
fields.set('referral-reviewed-'+uuid,{checked:true});
await t.referral(uuid,'approved');assert.equal(writes.pop().payload.decision,'approved');
await t.referral(uuid,'rejected');assert.equal(writes.length,0);
set('referral-reason-'+uuid,'duplicate');
await t.referral(uuid,'rejected');assert.match(writes.pop().payload.notes,/duplicado/);
// Billing: exact existing decimal rate survives locale formatting.
const plan={plan_key:'flex_daily',display_name:'Flex',platform_fee_bps:900,policy_version:1,active:true,billing_mode:'daily'};
const billUI=t.billUI(plan);
assert.match(billUI,/data-initial="9.00"/);
assert.match(billUI,/Outra taxa/);
set('billing-plan-fee-flex_daily','9.00',{dataset:{initial:'9.00'}});
set('billing-plan-rate-flex_daily','keep');
assert.equal(t.rate('flex_daily'),9);
await t.bill('flex_daily',1);assert.equal(writes.length,0);
set('billing-choice-plan-flex_daily','pricing');
await t.bill('flex_daily',1);assert.equal(writes.pop().payload.platformFeeBps,900);
set('billing-plan-rate-flex_daily','12');
assert.equal(t.rate('flex_daily'),12);
await t.bill('flex_daily',1);assert.equal(writes.pop().payload.platformFeeBps,1200);
await t.flex(uuid);assert.equal(writes.length,0);
set('billing-choice-flex-'+uuid,'requested');
await t.flex(uuid);assert.equal(writes.pop().payload.billingAction,'set-flex');
await t.waive(uuid,uuid,'waive-statement');assert.equal(writes.length,0);
set('billing-choice-waive-'+uuid,'adjustment');
await t.waive(uuid,uuid,'waive-statement');assert.equal(writes.length,0);
fields.set('billing-waive-confirm-'+uuid,{checked:true});
await t.waive(uuid,uuid,'waive-statement');
assert.equal(writes.pop().action,'merchant-billing-action');
assert.match(fn(admin,'adminSaveBillingPlan'),/adminBillingChoice/);
// Campaign templates: generate unique draft code and label only on a selected choice.
set('owner-budget-template','welcome');
fields.set('owner-budget-reference',{value:''});
fields.set('owner-budget-label',{value:''});
fields.set('owner-budget-details',{open:true});
t.budgetTemplate();
assert.match(fields.get('owner-budget-reference').value,/^welcome-\d{4}-\d{2}-[a-f0-9]{8}$/);
assert.match(fields.get('owner-budget-label').value,/boas-vindas/);
assert.equal(fields.get('owner-budget-details').open,false);
const budgetUI=t.budgetUI();
assert.match(budgetUI,/owner-budget-template/);
assert.match(budgetUI,/owner-budget-release-reason/);
await t.budget(uuid,1);assert.equal(writes.length,0);
set('owner-budget-release-reason-'+uuid,'unused');
await t.budget(uuid,1);
assert.equal(writes.pop().action,'owner-budget-release');
// Corrections are not claims of actual money movement.
await t.payout(uuid);assert.equal(writes.length,0);
set('owner-payout-void-choice-'+uuid,'duplicate');
await t.payout(uuid);assert.equal(writes.length,0);
fields.set('owner-payout-void-confirm-'+uuid,{checked:true});
await t.payout(uuid);assert.equal(writes.pop().action,'owner-benefit-payout-void');
// Manual provider ID is typed once inline, or filled from saved real provider evidence.
assert.match(t.pspUI(),/ads-psp-payment-id/);
await t.psp(uuid,'reconcile');assert.equal(writes.length,0);
set('ads-psp-payment-id-'+uuid,'123456789');
await t.psp(uuid,'reconcile');
assert.equal(writes.pop().payload.paymentId,'123456789');
for(const [src,name] of [[admin,'adminOrderControl'],[admin,'adminReviewReferral'],
  [admin,'adminSaveBillingPlan'],[admin,'adminSetMerchantFlex'],
  [admin,'adminResolveDailyStatement'],[acq,'adminOwnerBudgetReleaseFromUi'],
  [acq,'adminOwnerPayoutVoidFromUi'],[ads,'adminAdsPspAction']])
  assert.doesNotMatch(fn(src,name),/\bprompt\(/,'No prompt in '+name);
console.log('V1.904 PASS — guided orders, referrals, rate presets, waivers, planned campaigns, declarations and payment IDs.');
