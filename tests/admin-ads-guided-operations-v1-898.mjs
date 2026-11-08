import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ads=read('js/admin-ads-independent.js'),admin=read('js/admin.js');
new vm.Script(ads,{filename:'admin-ads-independent.js'});
new vm.Script(admin,{filename:'admin.js'});
const between=(s,start,end)=>{
 const a=s.indexOf(start),b=s.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Missing '+start+' ... '+end);
 return s.slice(a,b);
};
const uuid='12345678-1234-4234-8234-123456789012';
const refundId='87654321-1234-4234-8234-123456789012';
const campaign={id:uuid,advertiser:'Teste',title:'Oferta local',city:'São Gabriel',
 state:'RS',status:'submitted',version:2,budgetCents:1990,durationDays:7,
 description:'Publicidade independente',destination:'https://example.org',
 reportedViewSignals:0};
const refund={caseId:refundId,advertiser:'Anunciante',title:'Cancelamento',
 status:'reviewing',version:5,amountCents:1990,reason:'Pagamento duplicado',
 refundProviderAttempt:null,providerReversalRecorded:false};
const context={
 adminIndependentAdsState:{loadedFor:'actor',rows:[campaign],deliveryEnabled:false,
  fixedFeeSalesEnabled:false,fixedFeeSalesVersion:2,providerApprovedGrossCents:0,
  refundCases:[refund],homologationCampaignId:null,homologationExpiresAt:null},
 adminIndependentAdsBusy:false,adminIndependentAdsProviderPreflight:null,
 adminIndependentAdsPane:'campaigns',
 adminRuntime:{status:'ready',section:'ads',session:{user:{id:'actor'}}},
 adminAdsWorkspaceTab:'campaigns',
 role:'superadmin',
 adminCurrentRole:()=>context.role,adminMoney:c=>'R$ '+(c/100).toFixed(2),
 esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
 adminReady:()=>true,render:()=>context.renders++,
 renders:0,
 adminInvoke:async()=>({}),
 toast:()=>{}
};
vm.createContext(context);
const handlers=between(ads,'function adminIndependentAdsOpenPane(pane){','function adminAdsIndependentSection(){');
const view=ads.slice(ads.indexOf('function adminAdsIndependentSection(){'));
vm.runInContext(handlers+view+'\nthis.openPane=adminIndependentAdsOpenPane;this.view=adminAdsIndependentSection;',context);
let html=context.view();
assert.match(html,/Revisar campanhas/);
assert.match(html,/Configuração e vendas/);
assert.match(html,/Reembolsos/);
assert.match(html,/adminIndependentAdsChooseCampaign/);
assert.doesNotMatch(html,/id="independent-ads-sales-reason"/);
assert.doesNotMatch(html,/id="ads-refund-admin-reason-/);
assert.doesNotMatch(html,/id="ads-homologation-confirm"/);
context.openPane('finance');assert.equal(context.adminIndependentAdsPane,'finance');
assert.equal(context.renders,1);
html=context.view();
assert.match(html,/Conferir conta e webhook do TAMÃO Ads/);
assert.match(html,/name="independent-ads-control-preset"/);
assert.match(html,/name="independent-ads-sales-preset"/);
assert.match(html,/name="ads-homologation-preset"/);
assert.match(html,/id="ads-homologation-check-verify"/);
assert.match(html,/id="ads-homologation-check-confirm"/);
assert.match(ads,/HOMOLOGAR/);
assert.doesNotMatch(html,/id="independent-ads-preset-/);
assert.doesNotMatch(html,/id="ads-refund-admin-reason-/);
context.openPane('refunds');
html=context.view();
assert.match(html,/Cancelamentos e reembolsos/);
assert.match(html,/name="ads-refund-admin-choice-/);
assert.match(html,/value="execute"/);
assert.match(ads,/DEVOLVER/);
assert.doesNotMatch(html,/id="ads-homologation-confirm"/);
assert.doesNotMatch(html,/id="independent-ads-sales-reason"/);
assert.doesNotMatch(html,/id="independent-ads-preset-/);
const old=context.renders;
context.openPane('nonsense');assert.equal(context.renders,old);
context.adminAdsWorkspaceTab='diagnostics';context.openPane('finance');
assert.equal(context.renders,old);
context.adminAdsWorkspaceTab='campaigns';
context.role='support';context.openPane('campaigns');
assert.equal(context.renders,old);
assert.equal(context.view(),'','support must not see Ads');
context.role='finance';context.openPane('finance');
html=context.view();
assert.match(html,/Configuração e vendas/);
assert.doesNotMatch(html,/id="ads-homologation-confirm"/);
assert.doesNotMatch(html,/name="independent-ads-sales-preset"/);

// The task picker must select the exact Ads sub-workspace with existing role gates.
const nav=between(admin,'// This selector navigates only to known read/workspaces.','function adminQuickGo(');
const navCtx={adminIndependentAdsPane:'campaigns',adminAdsWorkspaceTab:'campaigns',
 adminOrdersWorkspaceTab:'orders',adminPartnersWorkspaceTab:'queue',adminGrowthWorkspaceTab:'acquisition',
 adminRuntime:{financeWorkspace:'summary'},role:'finance',current:'',
 adminReady:()=>true,adminRoleCanSection:section=>section==='ads',
 adminCurrentRole:()=>navCtx.role,
 document:{getElementById:()=>({value:navCtx.current})},
 adminSetSection:section=>{navCtx.section=section},
 esc:s=>String(s)};
vm.createContext(navCtx);
vm.runInContext(nav+'\nthis.choose=adminSelectTaskFromUi;this.tasks=adminTaskNavChoices;',navCtx);
assert.ok(navCtx.tasks().some(x=>x.id==='ads-refunds'));
navCtx.current='ads-refunds';navCtx.choose();
assert.equal(navCtx.adminIndependentAdsPane,'refunds');
assert.equal(navCtx.section,'ads');
navCtx.current='ads-finance';navCtx.choose();
assert.equal(navCtx.adminIndependentAdsPane,'finance');
navCtx.current='ads-campaigns';navCtx.choose();
assert.equal(navCtx.adminIndependentAdsPane,'campaigns');
navCtx.current='ads-diagnostics';navCtx.choose();
assert.notEqual(navCtx.adminAdsWorkspaceTab,'diagnostics','diagnostics restricted to merchant ops roles');

// Actual server actions remain gated; selected audited reasons remove mandatory typing,
// but do not automatically approve or send money.
const events=[];
const elements=new Map();
const marked=new Map();
const document={
 getElementById:id=>elements.get(id)||null,
 querySelector:selector=>{
  const group=/^input\[name="([^"]+)"\]:checked$/.exec(selector)?.[1];
  return group?marked.get(group)||null:null;
 }
};
const actionCtx={
 adminRuntime:{session:{user:{id:'actor'}}},role:'superadmin',
 adminCurrentRole:()=>actionCtx.role,
 adminIndependentAdsState:{loadedFor:'actor',rows:[campaign],deliveryEnabled:false,
 fixedFeeSalesEnabled:false,fixedFeeSalesVersion:3,
 refundCases:[refund]},adminIndependentAdsBusy:false,
 document,toast:message=>events.push(['toast',message]),
 adminPerform:async(action,params)=>{
  events.push(['write',action,params]);
  if(action==='ads-independent-action')return {source:'admin_ads_independent_action_v1_884',
   billingEnabled:false,paymentCreated:false};
  if(action==='ads-independent-sales-action')return {source:'admin_ads_independent_sales_toggle_v1_886',
   salesEnabled:true,newChargesCreated:false};
  if(action==='ads-independent-refund-provider')return {source:'admin_ads_independent_refund_provider_v1_888',
   providerRefundVerified:true,caseStatus:'provider_reversed'};
  throw Error('Unplanned action: '+action);
 },
 adminIndependentAdsRefresh:async()=>{events.push(['refresh'])}
};
vm.createContext(actionCtx);
const actionJs=between(ads,'// A checked option is mandatory: a form render or refresh cannot authorize any action.','async function adminIndependentAdsCheckProvider()');
const salesJs=between(ads,'async function adminIndependentAdsSalesAction(','async function adminIndependentRefundAction(');
const providerJs=between(ads,'async function adminIndependentRefundProvider(','// Pure UI navigation.');
vm.runInContext(actionJs+salesJs+providerJs+
 '\nthis.action=adminIndependentAdsAction;this.sale=adminIndependentAdsSalesAction;this.refund=adminIndependentRefundProvider;',actionCtx);
marked.set('independent-ads-control-preset',{value:'Inventário e conteúdo de campanhas conferidos para entrega sem faturamento.'});
marked.set('independent-ads-sales-preset',{value:'Recebimento e exigências do checkout de publicidade conferidos antes de liberar contratações.'});
await actionCtx.action('enable_delivery');
assert.equal(events.filter(x=>x[0]==='write').length,1);
assert.equal(events[0][2].reason,marked.get('independent-ads-control-preset').value);
events.length=0;
await actionCtx.sale();
assert.equal(events.filter(x=>x[0]==='write').length,1);
assert.equal(events[0][1],'ads-independent-sales-action');
events.length=0;
actionCtx.role='finance';await actionCtx.sale();
assert.equal(events.length,0,'Finance may read, not toggle sales');
actionCtx.role='superadmin';
marked.set('ads-refund-admin-choice-'+refundId,
 {value:'execute',dataset:{reason:'Devolução integral solicitada após conferência do pagamento, recebedor e caso.'}});
await actionCtx.refund('execute',refundId,5);
assert.equal(events.filter(x=>x[0]==='write').length,0,'No money action without checked acknowledgements');
assert.match(events.find(x=>x[0]==='toast')[1],/duas verificações/);
events.length=0;
elements.set('ads-refund-check-payment-'+refundId,{checked:true});
elements.set('ads-refund-check-send-'+refundId,{checked:true});
marked.set('ads-refund-admin-choice-'+refundId,
 {value:'record_provider_reversal',dataset:{reason:'Reversão confirmada no provedor e conferida para registro do protocolo.'}});
await actionCtx.refund('execute',refundId,5);
assert.equal(events.filter(x=>x[0]==='write').length,0,'Wrong marked action must never move money');
events.length=0;
marked.set('ads-refund-admin-choice-'+refundId,
 {value:'execute',dataset:{reason:'Devolução integral solicitada após conferência do pagamento, recebedor e caso.'}});
await actionCtx.refund('execute',refundId,5);
assert.equal(events.filter(x=>x[0]==='write').length,1);
assert.equal(events[0][2].confirmation,'DEVOLVER');
assert.match(ads,/const confirmation=enabled\?'HOMOLOGAR':'CANCELAR'/);
assert.match(ads,/adminIndependentAdsBusy=true/);
assert.match(ads,/expectedVersion:state.fixedFeeSalesVersion/);
const builder=read('scripts/build-live-portals.mjs');
const stripper=read('scripts/strip-admin-css.mjs');
assert.match(builder,/\['admin-acquisition','admin','admin-activations','admin-ads-independent'\]/,
 'Admin Ads code must not be released to Cliente or Revenda portals');
assert.match(stripper,/PROTECTED_ADMIN_SCRIPTS=.*'admin-ads-independent.js'/,
 'Admin-only Ads classes must not prevent public CSS stripping');
console.log('V1.898 PASS: three independent Ads panes, guided audited reasons, role-scoped tasks and financial confirmation remain fail-closed.');
