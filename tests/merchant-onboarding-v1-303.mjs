import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const merchant=read('js/merchant.js');
const css=read('css/components.css');
const ci=read('.github/workflows/audit.yml');
for(const [name,src] of [['merchant.js',merchant],['css as JS',null]]){
 if(src)new vm.Script(src,{filename:name});
}
const cut=(name)=>{
 const start=merchant.indexOf('function '+name+'(');
 const end=merchant.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,'missing '+name);
 return merchant.slice(start,end+2);
};
const scripts=['merchantFirstRunModel','merchantFirstRunView','merchantWorkspaceJump'].map(cut).join('\n')+
 '\nthis.model=merchantFirstRunModel;this.view=merchantFirstRunView;this.jump=merchantWorkspaceJump;';
const steps=[
 {key:'products',title:'Produtos e preços',detail:'Informe os preços',done:false},
 {key:'delivery',title:'Entregas',detail:'Área confirmada',done:true},
 {key:'payment',title:'Recebimentos',detail:'Escolha o pagamento',done:false}
];
let focus=false,scroll=false;
const panel={tagName:'DETAILS',open:false,scrollIntoView:()=>{scroll=true},
 querySelector:()=>({focus:()=>{focus=true}})};
const ctx=vm.createContext({
 merchantSetupSnapshot:()=>steps,
 esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 document:{getElementById:id=>id==='merchant-workspace-setup'?panel:null},
 matchMedia:()=>({matches:true}),
 String
});
vm.runInContext(scripts,ctx);
const rt={status:'ready',merchant:{memberRole:'owner',status:'inactive',merchantId:'m'},
 enablement:{merchant_id:'m',checks:[{owner:'admin',ok:false},{owner:'merchant',ok:false}]},
 billing:{account:{salesHold:false}}};
const model=ctx.model(rt,false);
assert.equal(model.completed,1);
assert.equal(model.next.key,'products');
assert.equal(model.adminPending,1);
assert.equal(model.needsAdminApproval,true);
const page=ctx.view(rt,false);
assert.match(page,/A liberação depende do TAMÃO/);
assert.match(page,/1 de 3 configurados/);
assert.match(page,/merchantSetupGo\('products'\)/);
assert.match(page,/merchantSetupGo\('delivery'\)/);
assert.match(page,/merchantSetupGo\('payment'\)/);
assert.match(page,/merchantWorkspaceJump\('setup'\)/);
assert.match(page,/Aprovações, módulos estratégicos e autorizações financeiras/);
assert.doesNotMatch(page,/merchantLiveToggleOnline|adminSetMerchantStatus|Ativada automaticamente/);
assert.equal(ctx.view(rt,true),'','no onboarding when operation is already eligible');
assert.equal(ctx.model({...rt,merchant:{...rt.merchant,memberRole:'operator'}},false),null);
assert.equal(ctx.model({...rt,status:'loading'},false),null);
steps[0].done=true;steps[2].done=true;
rt.merchant.status='active';rt.enablement.checks=[{owner:'admin',ok:true}];
assert.match(ctx.view(rt,false),/Conferir requisitos/);
assert.doesNotMatch(ctx.view(rt,false),/liberação depende do TAMÃO/);
rt.billing.account.salesHold=true;
assert.match(ctx.view(rt,false),/restrição financeira/);
assert.equal(ctx.jump('setup'),true);
assert.equal(panel.open,true);assert.equal(scroll,true);assert.equal(focus,true);
assert.equal(ctx.jump('unauthorized'),false);

const a=merchant.indexOf('function merchantLivePage(){');
const b=merchant.indexOf('\nfunction merchantScheduledDispatchState(',a);
assert.ok(a>=0&&b>a);
const live=merchant.slice(a,b);
assert.ok(live.indexOf('merchantDailyOverview(rt,orders)')<live.indexOf('merchantDeliveryBoardView(rt,orders)'));
assert.ok(live.indexOf('merchantDailyOverview(rt,orders)')<live.indexOf('merchantFirstRunView(rt,canGoOnline)'));
assert.ok(live.indexOf('merchantFirstRunView(rt,canGoOnline)')<live.indexOf('merchantOrderQueueView(orders)'));
assert.ok(live.indexOf('merchantDeliveryBoardView(rt,orders)')<live.indexOf('merchantOrderQueueView(orders)'));
assert.ok(live.indexOf('merchantOrderQueueView(orders)')<live.indexOf('merchantDailyChecklistView(rt,'));
assert.ok(live.indexOf('merchantOrderQueueView(orders)')<live.indexOf('merchantQuickCatalogView(rt)'));
assert.ok(live.indexOf('merchantOrderQueueView(orders)')<live.indexOf('merchantSetupView(rt)'));
assert.ok(live.indexOf('merchantSetupView(rt)')<live.indexOf('merchantBillingLiveView(rt)'));
assert.match(live,/m.status==='active'&&complianceReady&&commercialReady&&!financialHold/);
assert.match(live,/merchantAvailabilityPanel\(rt/);
assert.match(live,/merchantAlertControl\(\)/);
assert.match(live,/merchantLiveSavePaymentMethods\(\)/);
assert.match(live,/merchantLiveSaveLogistics\(\)/);
assert.match(live,/merchantLiveSaveScheduling\(\)/);
assert.match(live,/merchantLiveSaveCapacity\(\)/);
assert.match(live,/merchantEnablementAssistantView\(rt\)/);
assert.match(live,/id="merchant-workspace-setup"/);
assert.doesNotMatch(live,/<details id="merchant-workspace-setup" class="merchant-workspace-section"\$\{!canGoOnline/);
for(const marker of [
 '.merchant-first-run','.merchant-first-run-steps','.merchant-first-run-actions',
 '@media(max-width:550px)','.merchant-workspace #merchant-live-orders'
])assert.ok(css.includes(marker),'missing responsive CSS '+marker);
assert.ok(ci.includes('node tests/merchant-onboarding-v1-303.mjs'));
// ANP applies to active GLP and GLP cylinders, not to unrelated products.
// Exercise the exact production predicate, not a test-only replacement.
const complianceStart=live.indexOf('  const compliance=m.compliance||{};');
const complianceEnd=live.indexOf('  const cnpjWhen=',complianceStart);
assert.ok(complianceStart>=0&&complianceEnd>complianceStart,'merchant compliance decision present');
const complianceSource=live.slice(complianceStart,complianceEnd);
const checkCompliance=(catalog,compliance)=>{
 const {hasGlp,complianceReady}=vm.runInNewContext(
  '(function(){'+complianceSource+';return {hasGlp,complianceReady};})()',
  {rt:{catalog},m:{compliance}}
 );
 return {hasGlp,complianceReady};
};
const verified={cnpjCurrent:true,anpCurrent:false};
for(const item of ['WATER20','WOOD','CHARCOAL_5KG','ICE_BAR_10KG']){
 const value=checkCompliance([{active:true,productCode:item}],{cnpjCurrent:true,anpCurrent:true});
 assert.equal(value.hasGlp,false,item+' is not locally classed as ANP-regulated');
 assert.equal(value.complianceReady,true,item+' is permitted when the server confirms ANP is non-applicable');
 assert.equal(checkCompliance([{active:true,productCode:item}],verified).complianceReady,false,
  'missing or contradictory server ANP evidence must fail closed: '+item);
}
assert.equal(checkCompliance([{active:false,productCode:'P13'}],
 {cnpjCurrent:true,anpCurrent:true}).complianceReady,true,
 'inactive GLP must not impose an ANP requirement on non-GLP products');
for(const item of ['P13','P13_CONTAINER','P90_CONTAINER']){
 const value=checkCompliance([{active:true,productCode:item}],verified);
 assert.equal(value.hasGlp,true,item+' remains regulated');
 assert.equal(value.complianceReady,false,item+' cannot pass without ANP');
 assert.equal(checkCompliance([{active:true,productCode:item}],
  {cnpjCurrent:true,anpCurrent:true}).complianceReady,true);
}
assert.equal(checkCompliance([{active:true,productCode:'CUSTOM_ITEM',deliveryClass:'regulated_glp'}],
 verified).complianceReady,false,'backend-regulated delivery classes must still require ANP');
assert.equal(checkCompliance([{active:true,productCode:'WATER20'}],
 {cnpjCurrent:false,anpCurrent:true}).complianceReady,false,'CNPJ remains mandatory');
assert.ok(live.includes('!anpCurrent?'),
 'ANP warnings must follow authoritative server verdict even for unclassified regulated SKUs');
assert.ok(!live.includes('Sem GLP ativo no catálogo; ANP não é exigida'),
 'a missing delivery class must never be presented as evidence of ANP exemption');
assert.equal(checkCompliance([{active:true,productCode:'REGULATED_CUSTOM'}],verified).complianceReady,false,
 'when the server marks a custom regulated SKU ineligible, UI must fail closed');
assert.equal(checkCompliance([{active:true,productCode:'REGULATED_CUSTOM'}],
 {cnpjCurrent:true,anpCurrent:true}).complianceReady,true);

// A permanently authenticated owner can complete the EXISTING missing
// merchant_business_details record; no auto KYC or LIVE activation follows.
const startSave=merchant.indexOf('async function merchantLiveSaveBusinessProfile(');
const endSave=merchant.indexOf('\n}',startSave);
assert.ok(startSave>=0&&endSave>startSave);
const formSrc=cut('merchantBusinessProfileView')+'\n'+merchant.slice(startSave,endSave+2)+
 ';this.profile=merchantBusinessProfileView;this.save=merchantLiveSaveBusinessProfile;';
const fields={
 legalName:'Empresa Ficticia CI',tradeName:'Revenda Sintetica CI',
 responsibleName:'Responsavel CI',phone:'(11) 99999-9999',
 whatsapp:'(11) 99999-9998',postalCode:'97300-000',city:'Sao Gabriel',
 state:'rs',addressText:'Rua Sintetica CI, 10'
};
const saves=[],toasts=[];
const bizRt={merchant:{memberRole:'owner',status:'pending'},businessDetails:null};
const businessVm=vm.createContext({
 globalThis:{merchantRuntime:bizRt},
 esc:v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'),
 toast:v=>toasts.push(v),confirm:()=>true,
 document:{getElementById:id=>{
   const key=id.replace('merchant-business-','');
   return Object.hasOwn(fields,key)?{value:fields[key]}:null;
 }},
 merchantSaveBusinessDetailsLive:async details=>{
   saves.push(details);bizRt.businessDetails={...details};
 }
});
vm.runInContext(formSrc,businessVm);
assert.match(businessVm.profile({merchant:{memberRole:'owner',status:'pending'},businessDetails:null}),/Dados da empresa e localização/);
assert.equal(businessVm.profile({merchant:{memberRole:'manager',status:'pending'}}),'');
assert.equal(businessVm.profile({merchant:{memberRole:'owner',status:'active'}}),'');
const escaped=businessVm.profile({merchant:{memberRole:'owner',status:'pending'},
 businessDetails:{tradeName:'"&<script>alert(1)</script>'}});
assert.ok(escaped.includes('&quot;&amp;&lt;script&gt;')&&!escaped.includes('<script>'));
await businessVm.save();
assert.equal(saves.length,1);
assert.equal(saves[0].postalCode,'97300000');
assert.equal(saves[0].phone,'11999999999');
assert.equal(saves[0].state,'RS');
assert.ok(toasts.some(x=>x.includes('registrados para análise')));
bizRt.merchant.memberRole='manager';
await businessVm.save();
assert.equal(saves.length,1,'a manager must never submit legal identity changes');
bizRt.merchant.memberRole='owner';
bizRt.merchant.status='active';
await businessVm.save();
assert.equal(saves.length,1,'an active merchant cannot silently replace verified legal data');
assert.ok(merchant.includes('${merchantBusinessProfileView(rt)}'),
 'form must be mounted in the existing real merchant portal');
console.log('V1.303 PASS — merchant tasks and orders first, owner-only guidance, admin control and retained operations.');
