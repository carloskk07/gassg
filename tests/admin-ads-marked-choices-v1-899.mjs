import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const load=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ads=load('js/admin-ads-independent.js'),styles=load('css/components.css');
assert.doesNotThrow(()=>new vm.Script(ads));
const uuid='12345678-1234-4234-8234-123456789012';
const refundId='87654321-1234-4234-8234-123456789012';
const campaign={id:uuid,advertiser:'Ad',title:'Campanha',status:'submitted',
 version:3,budgetCents:1990,durationDays:7,city:'São Gabriel',state:'RS',
 description:'Patrocinado',destination:'https://example.org',reportedViewSignals:0};
const refund={caseId:refundId,advertiser:'Ad',title:'Pedido de devolução',
 status:'reviewing',version:5,amountCents:1990,reason:'Teste',
 refundProviderAttempt:null,providerReversalRecorded:false};
const selected=new Map(),inputs=new Map(),events=[];
const document={
 querySelector:selector=>{
  const key=/^input\[name="([^"]+)"\]:checked$/.exec(selector)?.[1];
  return key?selected.get(key)||null:null;
 },
 getElementById:id=>inputs.get(id)||null
};
const ctx={
 document,adminRuntime:{section:'ads',session:{user:{id:'owner'}}},
 adminIndependentAdsPane:'campaigns',adminIndependentAdsBusy:false,
 adminIndependentAdsProviderPreflight:null,
 adminIndependentAdsState:{loadedFor:'owner',rows:[campaign],refundCases:[refund],
  deliveryEnabled:false,fixedFeeSalesEnabled:false,fixedFeeSalesVersion:5,
  providerApprovedGrossCents:0,homologationCampaignId:null,homologationExpiresAt:null},
 role:'superadmin',adminCurrentRole:()=>ctx.role,
 adminMoney:v=>'R$ '+(Number(v)/100).toFixed(2),
 esc:v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
 toast:message=>events.push({toast:message}),
 adminPerform:async(action,args)=>{
  events.push({action,args});
  if(action==='ads-independent-action')return {source:'admin_ads_independent_action_v1_884',
   billingEnabled:false,paymentCreated:false};
  if(action==='ads-independent-homologation-action')return {source:'admin_ads_independent_homologation_v1_892',
   salesEnabled:false,billingEnabled:false,newChargesCreated:false,
   homologationAuthorized:args.enabled};
  if(action==='ads-independent-sales-action')return {source:'admin_ads_independent_sales_toggle_v1_886',
   salesEnabled:args.enabled,newChargesCreated:false};
  if(action==='ads-independent-refunds-action')return {source:'admin_ads_independent_refund_action_v1_887',
   moneyMoved:false,caseId:args.caseId};
  if(action==='ads-independent-refund-provider')return {source:'admin_ads_independent_refund_provider_v1_888',
   providerRefundVerified:true,caseStatus:'provider_reversed'};
  throw Error('Unexpected action '+action);
 },
 adminIndependentAdsRefresh:async()=>{events.push({refresh:true})}
};
vm.createContext(ctx);
const from=ads.indexOf('function adminIndependentAdsMarked(group){');
const to=ads.indexOf('// Pure UI navigation.',from);
assert.ok(from>0&&to>from);
vm.runInContext(ads.slice(from,to)+ads.slice(ads.indexOf('function adminAdsIndependentSection(){'))+
 '\nthis.section=adminAdsIndependentSection;',ctx);
const writes=()=>events.filter(x=>x.action);
let page=ctx.section();
assert.match(page,/name="independent-ads-choice-/);
assert.match(page,/type="radio"/);
assert.match(page,/Confirmar decisão marcada/);
assert.doesNotMatch(page,/id="independent-ads-preset-/);
assert.doesNotMatch(page,/id="independent-ads-reason-.*"[^>]*required/);
assert.doesNotMatch(page,/ads-homologation-check/);
await ctx.adminIndependentAdsChooseCampaign(uuid,3);
assert.equal(writes().length,0,'A campaign cannot be decided with no marked choice');
selected.set('independent-ads-choice-'+uuid,{value:'reject'});
await ctx.adminIndependentAdsAction('approve',uuid,3);
assert.equal(writes().length,0,'Marked decision cannot authorize another action');
selected.set('independent-ads-choice-'+uuid,{value:'approve'});
await ctx.adminIndependentAdsChooseCampaign(uuid,3);
assert.equal(writes().length,1);
assert.equal(writes()[0].args.reason,'Criativo revisado e aprovado pelo administrador.');
assert.equal(writes()[0].args.expectedVersion,3);
events.length=0;
await ctx.adminIndependentAdsChooseCampaign('bad\"><script>',3);
assert.equal(writes().length,0,'Invalid IDs cannot reach finance/backend controls');
ctx.role='finance';
await ctx.adminIndependentAdsChooseCampaign(uuid,3);
assert.equal(writes().length,0,'Readers cannot approve an ad');
ctx.role='superadmin';
page=ctx.section();
assert.doesNotMatch(page,/bad"><script>/);
ctx.adminIndependentAdsState.rows=[{...campaign,id:'bad"><script>'}];
page=ctx.section();
assert.doesNotMatch(page,/independent-ads-choice-/,'Invalid campaign id cannot enter event handler attributes');
ctx.adminIndependentAdsState.rows=[campaign];

ctx.adminIndependentAdsPane='finance';
page=ctx.section();
assert.match(page,/name="independent-ads-control-preset"/);
assert.match(page,/name="independent-ads-sales-preset"/);
assert.match(page,/name="ads-homologation-preset"/);
assert.match(page,/id="ads-homologation-check-verify"/);
assert.match(page,/id="ads-homologation-check-confirm"/);
assert.doesNotMatch(page,/<input id="ads-homologation-confirm"/);
assert.match(page,/<details>/);
assert.doesNotMatch(page,/id="ads-refund-admin-choice-/);
events.length=0;
await ctx.adminIndependentAdsAction('enable_delivery');
assert.equal(writes().length,0,'No delivery changes without an explicit mark');
selected.set('independent-ads-control-preset',
 {value:'Inventário e conteúdo de campanhas conferidos para entrega sem faturamento.'});
await ctx.adminIndependentAdsAction('enable_delivery');
assert.equal(writes().length,1);
events.length=0;
await ctx.adminIndependentAdsSalesAction();
assert.equal(writes().length,0);
selected.set('independent-ads-sales-preset',
 {value:'Recebimento e exigências do checkout de publicidade conferidos antes de liberar contratações.'});
await ctx.adminIndependentAdsSalesAction();
assert.equal(writes().length,1);
events.length=0;
campaign.status='approved';
inputs.set('ads-homologation-campaign',{value:uuid});
selected.set('ads-homologation-preset',
 {value:'Campanha e elegibilidade para homologação financeira real conferidas pelo administrador.'});
await ctx.adminIndependentAdsHomologationAction(true);
assert.equal(writes().length,0,'An explicit mark alone cannot enable a REAL payment');
inputs.set('ads-homologation-check-verify',{checked:true});
await ctx.adminIndependentAdsHomologationAction(true);
assert.equal(writes().length,0,'A single checkbox cannot authorize a REAL payment');
inputs.set('ads-homologation-check-confirm',{checked:true});
await ctx.adminIndependentAdsHomologationAction(true);
assert.equal(writes().length,1);
assert.equal(writes()[0].args.confirmation,'HOMOLOGAR');
assert.equal(writes()[0].args.expectedVersion,5);
assert.equal(writes()[0].args.campaignId,uuid);
events.length=0;
ctx.role='operations';
await ctx.adminIndependentAdsHomologationAction(true);
assert.equal(writes().length,0,'Operations cannot authorize real checkout');
ctx.role='superadmin';

ctx.adminIndependentAdsPane='refunds';
page=ctx.section();
assert.match(page,/name="ads-refund-admin-choice-/);
assert.match(page,/type="radio"/);
assert.match(page,/id="ads-refund-check-payment-/);
assert.match(page,/id="ads-refund-check-send-/);
assert.match(page,/id="ads-refund-acknowledgements-.*hidden/);
assert.match(page,/Executar providência marcada/);
assert.doesNotMatch(page,/id="ads-refund-provider-confirm-/);
assert.doesNotMatch(page,/id="ads-homologation-check-/);
events.length=0;
await ctx.adminIndependentAdsChooseRefund(refundId,5);
assert.equal(writes().length,0,'Refund choice must be marked');
selected.set('ads-refund-admin-choice-'+refundId,
 {value:'execute',dataset:{reason:'Devolução integral solicitada após conferência do pagamento, recebedor e caso.'}});
await ctx.adminIndependentAdsChooseRefund(refundId,5);
assert.equal(writes().length,0,'Refund cannot be executed without two checks');
inputs.set('ads-refund-check-payment-'+refundId,{checked:true});
await ctx.adminIndependentAdsChooseRefund(refundId,5);
assert.equal(writes().length,0,'One mark cannot execute refund');
inputs.set('ads-refund-check-send-'+refundId,{checked:true});
await ctx.adminIndependentAdsChooseRefund(refundId,4);
assert.equal(writes().length,0,'Stale refund version must fail closed');
await ctx.adminIndependentAdsChooseRefund(refundId,5);
assert.equal(writes().length,1);
assert.equal(writes()[0].args.confirmation,'DEVOLVER');
assert.equal(writes()[0].args.expectedVersion,5);
assert.equal(writes()[0].args.reason,'Devolução integral solicitada após conferência do pagamento, recebedor e caso.');
events.length=0;
selected.set('ads-refund-admin-choice-'+refundId,
 {value:'verify',dataset:{reason:'Consulta de acompanhamento ao provedor, sem repetir solicitação de devolução.'}});
inputs.set('ads-refund-acknowledgements-'+refundId,{hidden:false});
ctx.adminIndependentAdsRefundChoiceChanged(refundId);
assert.equal(inputs.get('ads-refund-acknowledgements-'+refundId).hidden,true);
assert.equal(inputs.get('ads-refund-check-payment-'+refundId).checked,false);
assert.equal(inputs.get('ads-refund-check-send-'+refundId).checked,false);
await ctx.adminIndependentAdsChooseRefund(refundId,5);
assert.equal(writes().length,1);
assert.equal(writes()[0].args.operation,'verify');
assert.equal(writes()[0].args.confirmation,'');
events.length=0;
selected.set('ads-refund-admin-choice-'+refundId,
 {value:'execute',dataset:{reason:'Devolução integral solicitada após conferência do pagamento, recebedor e caso.'}});
refund.refundProviderAttempt='already-sent';
await ctx.adminIndependentAdsChooseRefund(refundId,5);
assert.equal(writes().length,0,'A recorded provider attempt cannot be sent again');
refund.refundProviderAttempt=null;
ctx.role='finance';
await ctx.adminIndependentAdsChooseRefund(refundId,5);
assert.equal(writes().length,0,'Finance cannot send provider refund');
assert.match(styles,/\.admin-option-row/);
console.log('V1.899 PASS: one marked choice per action, two explicit checked payment acknowledgements, no typed secret word, stale/role/duplicate guards.');
