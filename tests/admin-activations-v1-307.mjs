import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('js/admin-activations.js'),admin=read('js/admin.js');
const html=read('index.html'),styles=read('css/components.css');
new vm.Script(src,{filename:'admin-activations.js'});
assert.ok(html.includes('js/admin-activations.js'));
assert.ok(admin.includes("activations:new Set(['superadmin','readonly','operations'])"));
assert.ok(admin.includes("adminPanel('activations',adminActivationDeskView(d))"));
assert.ok(admin.includes("adminMenuButton('activations','Ativações'"));
assert.ok(admin.includes("if(next==='activations')adminActivationLoad()"));
assert.ok(styles.includes('.admin-activation-grid'));
assert.ok(!src.includes('adminPerform(\'ads-publish'), 'read-only modules never publish Ads');

let role='superadmin',user='owner',calls=[],scrolls=[],show=true;
const governance={source:'admin_governance_gates_v1_304',readOnly:true,
  runtime:{merchantDirectPaymentsEnabled:false},
  cities:[{city:'São Gabriel',commerceEnabled:false}]};
const providers={
  'ads-placement-readiness':{source:'admin_ads_placement_readiness_v1_236',readOnly:true,publicEnabled:false,billingEnabled:false,readyToSell:false,approvedCreatives:0},
  'ads-campaign-queue':{source:'admin_ads_campaign_queue_v1_233',noCharge:true,adsLive:false,submittedCount:0},
  'clube-campaign-queue':{source:'admin_clube_campaign_queue_v1_241',readOnly:true,couponSalesEnabled:false,campaignsActive:0,activeInterests:0},
  'clube-terms-queue':{source:'admin_clube_terms_queue_v1_242',readOnly:true,couponSalesEnabled:false,noContractsSigned:true,totalReviews:0},
  'commercial-intake-read':{source:'admin_marketing_intake_v1_308',readOnly:true,adsPublicationEnabled:false,couponSalesEnabled:false,noMoneyMovement:true,
    controls:[{moduleKey:'ads_proposals',enabled:true,version:1,reason:'Preserved'},{moduleKey:'clube_proposals',enabled:true,version:1,reason:'Preserved'}]},
  'ads-sales-plans':{source:'admin_ads_sales_plans_v1_309',readOnly:true,noCharge:true,adsLive:false,
    revenueCents:0,contractsSigned:0,totalPlans:0,approvedCreatives:0,rows:[]},
  'ads-offers-read':{source:'admin_ads_offers_v1_310',readOnly:true,noCharge:true,adsLive:false,
    contractsSigned:0,revenueCents:0,notifiedExternally:false,totalOffers:0,interestedResponses:0,rows:[]}
};
const runtime={
 session:{user:{id:user}},governance:{loadedFor:user,role},
 pushReliability:{loadedFor:user,checkedAt:new Date().toISOString(),
   data:{source:'admin_push_reliability_v1_294',readOnly:true,
     gates:{automaticDeliveryVerified:false,senderEnabled:false,cronEnabled:false},
     summary:{registeredDevices:0,reportedWarning7d:0}}}
};
const env=vm.createContext({
  adminRuntime:runtime,adminCurrentRole:()=>role,adminReady:()=>show,
  adminRoleCanSection:s=>['superadmin','operations','readonly'].includes(role)&&
    (role==='superadmin'||s!=='finance'),adminInvoke:async({action})=>{
      calls.push(action);return providers[action];
  },adminLoadGovernanceGates:async()=>{runtime.governance.loadedFor=user;runtime.governance.role=role;return governance},
  adminPushReliabilityLoadFromUi:async()=>null,adminSetSection:s=>calls.push('go:'+s),
  requestAnimationFrame:fn=>fn(),document:{querySelector:s=>({scrollIntoView:()=>scrolls.push(s)})},
  esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
  formatDateTime:s=>String(s),render:()=>{},Number,String,Date,Promise
});
vm.runInContext(src+'\nthis.load=adminActivationLoad;this.view=adminActivationDeskView;this.go=adminActivationGo;',env);
assert.equal(await env.load({force:true})!=null,true);
assert.equal(calls.filter(x=>typeof x==='string').length,7);
let view=env.view({commercialPolicy:{policy_version:4}});
assert.match(view,/Central de consulta e acesso aos controles reais/);
assert.match(view,/Exibição bloqueada/);
assert.match(view,/Vendas bloqueadas/);
assert.match(view,/Modo global desligado/);
assert.match(view,/Nenhum controle desta página/i);
assert.doesNotMatch(view,/onclick="adminPerform/);
env.go('ads');assert.ok(calls.includes('go:partners'));assert.ok(scrolls.includes('.admin-ads-campaigns'));
providers['ads-placement-readiness']={source:'unknown',publicEnabled:true};
await env.load({force:true});view=env.view({});
assert.match(view,/Publicidade TAMÃO/);
assert.match(view,/Não confirmado/);
assert.doesNotMatch(view,/Exibição bloqueada/);
role='readonly';runtime.governance.role=role;
view=env.view({});assert.match(view,/não confirmada/);
await env.load({force:true});view=env.view({});
assert.ok(!view.includes("adminActivationGo('payments')"),'readonly must not navigate into finance');
role='support';assert.equal(await env.load({force:true}),null);
assert.equal(env.view({}),'');
console.log('V1.307 PASS — role gates, source checks, read-only desk, fail-closed display and official navigation.');
