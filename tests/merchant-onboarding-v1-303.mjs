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
assert.match(page,/<h2>Prepare sua revenda para começar<\/h2>/);
assert.match(page,/Informe os preços/);
assert.match(page,/A liberação depende do TAMÃO/);
assert.match(page,/0 de 2 etapas concluídas/);
assert.match(page,/merchantSetupGo\('products'\)/);
assert.match(page,/Produtos e entregas/);
assert.doesNotMatch(page,/merchantSetupGo\('delivery'\)/,'group presents only the next incomplete action');
assert.match(page,/merchantSetupGo\('payment'\)/);
assert.match(page,/merchantFirstRunReview\(\)/);
assert.match(page,/<details class="merchant-first-run-extra">/,'other setup steps should be collapsed');
assert.match(page,/<summary>Ver etapas de preparação \(2\)<\/summary>/);
assert.ok(page.indexOf('merchant-first-run-actions')<page.indexOf('merchant-first-run-extra'),
  'show one direct next step before optional setup checklist');
assert.doesNotMatch(page,/<details class="merchant-first-run-extra"[^>]*\sopen/);

assert.match(page,/Aprovações, módulos estratégicos e autorizações financeiras/);
assert.doesNotMatch(page,/merchantLiveToggleOnline|adminSetMerchantStatus|Ativada automaticamente/);
assert.equal(ctx.view(rt,true),'','no onboarding when operation is already eligible');
assert.equal(ctx.model({...rt,merchant:{...rt.merchant,memberRole:'operator'}},false),null);
assert.equal(ctx.model({...rt,status:'loading'},false),null);
// A pending owner must be prompted to act, not told to wait for approval.
steps.unshift({key:'business',title:'Dados e endereço',detail:'Informe os dados reais',done:false});
rt.merchant.status='pending';
let firstBusiness=ctx.view(rt,false);
assert.match(firstBusiness,/<h2>Complete o cadastro da sua empresa<\/h2>/);
assert.match(firstBusiness,/Completar cadastro da empresa/);
assert.match(firstBusiness,/merchantSetupGo\('business'\)/);
assert.doesNotMatch(firstBusiness,/Aguarde a aprovação/);
steps[0].done=true;
assert.match(ctx.view(rt,false),/Continuar por Produtos e preços/);
steps[1].done=true;steps[3].done=true;
assert.match(ctx.view(rt,false),/<h2>A liberação depende do TAMÃO<\/h2>/);
assert.match(ctx.view(rt,false),/Conferir requisitos/);
steps.shift();
steps[0].done=true;steps[2].done=true;
rt.merchant.status='active';rt.enablement.checks=[{owner:'admin',ok:true}];
assert.match(ctx.view(rt,false),/Conferir requisitos/);
assert.doesNotMatch(ctx.view(rt,false),/liberação depende do TAMÃO/);
rt.billing.account.salesHold=true;
assert.match(ctx.view(rt,false),/restrição financeira/);
assert.match(ctx.view(rt,false),/merchantWorkspaceJump\('finance'\)/);
steps[0].done=false;
assert.match(ctx.view(rt,false),/merchantWorkspaceJump\('finance'\)/,'financial hold takes priority over other setup tasks');
steps[0].done=true;
assert.equal(ctx.jump('setup'),true);
assert.equal(panel.open,true);assert.equal(scroll,true);assert.equal(focus,true);
assert.equal(ctx.jump('unauthorized'),false);

// The direct review opens the real diagnostics, refreshes, and reopens after a redraw.
let openCount=0,readCount=0,finishReview;
const reviewState={status:'ready',session:{user:{id:'u1'}},merchant:{merchantId:'m1',memberRole:'owner'},accessEpoch:1};
const reviewCtx=vm.createContext({globalThis:{merchantRuntime:reviewState},
 merchantRevealControl:selector=>{assert.equal(selector,'#merchant-enablement h2');openCount++;return true;},
 merchantEnablementRecheck:async()=>{readCount++;await new Promise(resolve=>finishReview=resolve);},
 toast:()=>{throw Error('unexpected missing control');}});
vm.runInContext(cut('merchantFirstRunReview').replace(/^function /,'async function ')+';this.review=merchantFirstRunReview;',reviewCtx);
let review=reviewCtx.review();
assert.equal(openCount,1);
assert.equal(readCount,1);
finishReview();
assert.equal(await review,true);
assert.equal(openCount,2,'reopen current report after rendering');
review=reviewCtx.review();
reviewState.accessEpoch++;
finishReview();
assert.equal(await review,false);
assert.equal(openCount,3,'late result must not navigate another session');
reviewState.enablementLoading=true;
assert.equal(await reviewCtx.review(),true);
assert.equal(readCount,2,'already loading must not duplicate the read');
reviewState.merchant.memberRole='operator';
assert.equal(await reviewCtx.review(),false);
assert.equal(openCount,4);


const a=merchant.indexOf('function merchantLivePage(){');
const b=merchant.indexOf('\nfunction merchantScheduledDispatchState(',a);
assert.ok(a>=0&&b>a);
const live=merchant.slice(a,b);
assert.ok(live.indexOf('merchantDailyOverview(rt,orders)')<live.indexOf('merchantDeliveryBoardView(rt,orders)'));
assert.match(live,/const preparing=orderEvidence\.fresh&&orders\.length===0&&Boolean\(firstRun\)/,
  'only a verified empty queue with onboarding can prioritize preparation');
assert.ok(live.indexOf('${preparing?firstRun:')<live.indexOf('merchantAvailabilityPanel(rt,'),
  'preparation has one next-step guide before optional availability details');
assert.match(live,/orderEvidence\.fresh\?\(preparing\?'':merchantDailyOverview\(rt,orders\)\)/,
  'daily orders stay visible during normal operation');
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
const quickStart=live.indexOf('<nav class="merchant-workspace-shortcuts"');
const quickEnd=live.indexOf('</nav>',quickStart);
assert.ok(quickStart>=0&&quickEnd>quickStart,'merchant shortcuts must be a single accessible nav');
const quick=live.slice(quickStart,quickEnd);
assert.match(quick,/<details class="merchant-workspace-more">/);
assert.match(quick,/<summary>Mais áreas<\/summary>/);
assert.ok(quick.indexOf("merchantWorkspaceJump('orders')")<quick.indexOf('<details class="merchant-workspace-more">'));
assert.ok(quick.indexOf("merchantWorkspaceJump('start')")<quick.indexOf('<details class="merchant-workspace-more">'));
assert.match(quick,/merchantWorkspaceJump\(\\'finance\\'\)/);
assert.match(quick,/merchantWorkspaceJump\(\\'growth\\'\)/);
assert.match(quick,/merchantWorkspaceJump\('settings'\)/);
assert.ok(!quick.includes('<details class="merchant-workspace-more" open'),'secondary areas closed initially');

assert.doesNotMatch(live,/<details id="merchant-workspace-setup" class="merchant-workspace-section"\$\{!canGoOnline/);
for(const marker of [
 '.merchant-first-run','.merchant-first-run-steps','.merchant-first-run-actions',
 '.merchant-first-run-extra','.merchant-workspace-more','.merchant-workspace-more-actions',
 '@media(max-width:550px)','.merchant-workspace #merchant-live-orders'
])assert.ok(css.includes(marker),'missing responsive CSS '+marker);
assert.ok(css.includes('.merchant-workspace-more:not([open])>.merchant-workspace-more-actions'),
 'secondary merchant links must actually hide when closed despite display:grid');
assert.ok(css.includes('.merchant-first-run-extra:not([open])>.merchant-first-run-steps'),
 'setup checklist must actually hide until explicitly expanded');
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

console.log('V1.303 PASS — merchant tasks and orders first, owner-only guidance, admin control and retained operations.');


 // ANP consultation is read-only, exact CNPJ and region, and never overwrites evidence.
const adminSource=read('js/admin.js');
new vm.Script(adminSource,{filename:'js/admin.js'});
const anpStart=adminSource.indexOf('function adminMerchantAnpReference(');
const anpEnd=adminSource.indexOf('function adminMerchantCard(',anpStart);
assert.ok(anpStart>=0&&anpEnd>anpStart);
const now=Date.now(), stamp=new Date(now-60000).toISOString();
const business={id:'m',cnpj:'12.345.678/0001-90',businessDetails:{city:'São Gabriel',state:'RS'}};
const prospect={cnpj:'12345678000190',legal_name:'Empresa de teste',anp_authorization:'REF-TESTE',sigaf_status:'Ativa',source_checked_at:stamp};
const report={city:'São Gabriel',state:'RS',sourceStatus:'ok',checkedAt:stamp,prospects:[prospect]};
let actor={id:'admin'},target=business,calls=[],notices=[],focusRef=false;
const nodes={'anp-lookup-m':{},'anp-result-m':{},'anp-consult-m':{disabled:false},'anp-copy-m':{hidden:true},'anpref-m':{value:'',focus:()=>{focusRef=true;}}};
const runtime={session:actor};
let response=report;
let timerSequence=0;
const pendingTimers=new Map();
const anpCtx=vm.createContext({adminRuntime:runtime,adminPartnerVerificationMutationTarget:()=>target,
 setTimeout:(callback,ms)=>{assert.equal(ms,20000);const id=++timerSequence;pendingTimers.set(id,callback);return id;},
 clearTimeout:id=>pendingTimers.delete(id),
 document:{getElementById:key=>nodes[key]||null},adminInvoke:async payload=>{calls.push(payload);return response;},
 formatDateTime:x=>x,toast:x=>notices.push(x)});
vm.runInContext(adminSource.slice(anpStart,anpEnd)+';this.lookup=adminMerchantAnpReference;this.consult=adminConsultMerchantAnp;',anpCtx);
assert.equal(anpCtx.lookup(report,business,now).reference,'REF-TESTE');
for(const bad of [{...report,sourceStatus:'unavailable'},{...report,state:'SC'},{...report,city:'Outra cidade'},
 {...report,checkedAt:new Date(now-90000000).toISOString()},
 {...report,prospects:[{...prospect,cnpj:'99999999000199'}]},
 {...report,prospects:[prospect,prospect]},
 {...report,prospects:[{...prospect,source_checked_at:new Date(now-90000000).toISOString()}]},
 {...report,prospects:[{...prospect,anp_authorization:''}]}])
 assert.equal(anpCtx.lookup(bad,business,now),null);
await anpCtx.consult('m');
assert.equal(calls.length,1);assert.equal(calls[0].action,'prospect-intelligence');
assert.equal(calls[0].force,false);
assert.equal(nodes['anpref-m'].value,'','lookup must never silently change evidence');
assert.equal(nodes['anp-copy-m'].hidden,false);
nodes['anp-copy-m'].onclick();
assert.equal(nodes['anpref-m'].value,'REF-TESTE');assert.equal(focusRef,true);
nodes['anpref-m'].value='existing';
nodes['anp-copy-m'].onclick();
assert.equal(nodes['anpref-m'].value,'existing');
runtime.session={id:'other'};
nodes['anpref-m'].value='';
nodes['anp-copy-m'].onclick();
assert.equal(nodes['anpref-m'].value,'','stale session cannot apply prior suggestion');
target=null;
await anpCtx.consult('m');assert.equal(calls.length,1);
console.log('PASS: ANP exact regional identity, freshness, read-only consultation, explicit non-overwriting reference and stale-session guard.');

 // A slow token/fetch/body cannot leave the administrator permanently blocked.
target=business;runtime.session=actor;
let completeLate;
response=new Promise(resolve=>{completeLate=resolve;});
const slow=anpCtx.consult('m');
assert.equal(nodes['anp-consult-m'].disabled,true);
assert.equal(nodes['anp-copy-m'].hidden,true);
assert.equal(pendingTimers.size,1);
[...pendingTimers.values()][0]();
await slow;
assert.equal(nodes['anp-consult-m'].disabled,false);
assert.match(nodes['anp-result-m'].textContent,/demorou demais/);
assert.equal(pendingTimers.size,0);
response=report;
await anpCtx.consult('m');
assert.equal(nodes['anp-copy-m'].hidden,false);
const recoveredText=nodes['anp-result-m'].textContent;
completeLate({...report,prospects:[{...prospect,anp_authorization:'LATE-RESULT'}]});
await Promise.resolve();
await Promise.resolve();
assert.equal(nodes['anp-result-m'].textContent,recoveredText);
nodes['anp-copy-m'].onclick();
assert.equal(nodes['anpref-m'].value,'REF-TESTE');
assert.equal(pendingTimers.size,0);

// The same in-memory merchant object may change while the read is pending.
nodes['anpref-m'].value='';
let finishIdentity;
response=new Promise(resolve=>{finishIdentity=resolve;});
const changedIdentity=anpCtx.consult('m');
business.cnpj='99999999000199';
finishIdentity(report);
await changedIdentity;
assert.equal(nodes['anp-copy-m'].hidden,true);
assert.equal(nodes['anpref-m'].value,'');
assert.equal(nodes['anp-consult-m'].disabled,false);
business.cnpj='12.345.678/0001-90';

// A reference that becomes stale while the screen is open cannot be applied.
response={...report};
await anpCtx.consult('m');
response.checkedAt=new Date(now-90000000).toISOString();
nodes['anp-copy-m'].onclick();
assert.equal(nodes['anpref-m'].value,'');
assert.equal(nodes['anp-copy-m'].hidden,true);
assert.match(nodes['anp-result-m'].textContent,/perdeu a validade/);
assert.equal(pendingTimers.size,0);

// A missing CNPJ blocks lookup without a network request.
business.cnpj='';
const beforeInvalid=calls.length;
await anpCtx.consult('m');
assert.equal(calls.length,beforeInvalid);
assert.match(nodes['anp-result-m'].textContent,/CNPJ, cidade e UF/);
assert.equal(nodes['anp-copy-m'].hidden,true);
console.log('PASS: ANP bounded read, late result, retry, changed identity, expired evidence and invalid input.');


// The administrative card exposes only the controls that the server role allows.
// Activation is a separate operational decision, never a promise of open sales.
const cardStart=adminSource.indexOf('function adminMerchantCard(m){');
const cardEnd=adminSource.indexOf('\nfunction adminReferralReasonLabel(',cardStart);
assert.ok(cardStart>=0&&cardEnd>cardStart);
let cardRole='operations';
const cardRuntime={actionPending:false};
const cardCtx=vm.createContext({
 adminRuntime:cardRuntime,adminCurrentRole:()=>cardRole,
 adminStatusPill:()=>'',adminMerchantProgressView:()=>'',adminMerchantMissingProfileNotice:()=>'',adminPilotNextActionCopy:()=>'',
 esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
 formatDateTime:s=>String(s)
});
vm.runInContext(adminSource.slice(cardStart,cardEnd)+';this.card=adminMerchantCard;',cardCtx);
const ownerId='11111111-1111-4111-8111-111111111111';
const cardMerchant={id:'m',name:'Revenda de teste',cnpj:'12345678000190',status:'pending',
 activeOwnerUserId:ownerId,compliance:{cnpj_status:'pending',anp_status:'pending'}};
let cardHtml=cardCtx.card(cardMerchant);
for(const heading of ['1. Documentação empresarial','2. Representação legal','3. Capacidade de entrega','4. Ativação operacional'])
 assert.ok(cardHtml.includes(heading));
assert.match(cardHtml,/Ativar o cadastro não abre vendas automaticamente/);
assert.match(cardHtml,/Valide primeiro a representação legal vigente/);
assert.match(cardHtml,/onclick="adminSetMerchantStatus\('m','activate-merchant'\)" disabled/);
assert.match(cardHtml,/Salvar validação documental/);
const readyMerchant={...cardMerchant,representationReview:{owner_user_id:ownerId,merchant_cnpj:cardMerchant.cnpj,expires_at:new Date(Date.now()+3600000).toISOString()}};
cardHtml=cardCtx.card(readyMerchant);
assert.doesNotMatch(cardHtml,/onclick="adminSetMerchantStatus\('m','activate-merchant'\)" disabled/);
assert.match(cardHtml,/Ativar cadastro/);
cardRuntime.actionPending=true;
cardHtml=cardCtx.card(readyMerchant);
assert.match(cardHtml,/onclick="adminSetMerchantStatus\('m','activate-merchant'\)" disabled/);
assert.match(cardHtml,/onclick="adminSaveCompliance\('m'\)" disabled/);
cardRuntime.actionPending=false;
for(const role of ['readonly','support','finance']){
 cardRole=role;cardHtml=cardCtx.card({...readyMerchant,status:'active'});
 assert.match(cardHtml,/Consulta somente leitura/);
 assert.match(cardHtml,/<select id="cnpj-m" class="input" disabled>/);
 assert.match(cardHtml,/<select id="anp-m" class="input" disabled>/);
 assert.match(cardHtml,/id="mixed-m" type="checkbox"\s+disabled/);
 assert.doesNotMatch(cardHtml,/onclick="admin(?:SaveCompliance|SaveDeliveryCapability|ReviewMerchantRepresentation|SetMerchantStatus|ConsultMerchantAnp)/);
 assert.match(cardHtml,/Ver preços e simular cesta/);
 assert.match(cardHtml,/onclick="adminOpenEntity\('merchant','m'\)"/);
}
for(const role of ['superadmin','operations','compliance']){
 cardRole=role;cardHtml=cardCtx.card({...readyMerchant,status:'active'});
 assert.match(cardHtml,/Suspender cadastro/);
 assert.match(cardHtml,/Salvar capacidade logística/);
 assert.doesNotMatch(cardHtml,/Consulta somente leitura/);
}
console.log('PASS: merchant verification stages, role-limited controls, pending state and operational activation copy.');


// Payment in delivery is independent of online checkout and requires a valid route.
// Exercise the production preparation predicate without creating a sale or a PSP charge.
const paymentCtx=vm.createContext({merchantTimestampFresh:()=>true});
vm.runInContext(cut('merchantSetupSnapshot')+';this.setup=merchantSetupSnapshot;',paymentCtx);
const paymentMerchant={memberRole:'owner',status:'active',paymentMethods:{pix:true,card:true,cash:true}};
const manualDelivery={paymentMethod:'pix',channel:'delivery',verificationMode:'merchant_confirmed',active:true,provider:'manual'};
const deviceDelivery={paymentMethod:'card_credit',channel:'delivery',verificationMode:'device',active:true,provider:'stone',connectionId:'account-1'};
const connectedAccount={id:'account-1',provider:'stone',connected:true,
 capabilities:{canValidateProviderTransactions:true,directSalePaymentsEnabled:true}};
const paymentStep=(routes,accounts=[],methods=paymentMerchant.paymentMethods)=>paymentCtx.setup({
 merchant:{...paymentMerchant,paymentMethods:methods},paymentRoutes:routes,receivingAccounts:accounts
}).find(x=>x.key==='payment');
assert.equal(paymentStep([manualDelivery]).done,true,'manual Pix at delivery requires no provider');
assert.equal(paymentStep([{...manualDelivery,paymentMethod:'cash'}]).done,true);
assert.equal(paymentStep([{...manualDelivery,paymentMethod:'card_debit'}]).done,true);
assert.equal(paymentStep([deviceDelivery],[connectedAccount]).done,true);
for(const route of [
 {...manualDelivery,channel:'online'},
 {...manualDelivery,channel:undefined},
 {...manualDelivery,active:false},
 {...manualDelivery,verificationMode:'provider_api'},
 {...manualDelivery,verificationMode:undefined},
 {...manualDelivery,paymentMethod:'unknown'}
])assert.equal(paymentStep([route]).done,false);
assert.equal(paymentStep([manualDelivery],[],{pix:false,card:true,cash:true}).done,false);
assert.equal(paymentStep([deviceDelivery]).done,false);
for(const account of [
 {...connectedAccount,id:'different'},
 {...connectedAccount,provider:'different'},
 {...connectedAccount,connected:false},
 {...connectedAccount,capabilities:{...connectedAccount.capabilities,canValidateProviderTransactions:false}},
 {...connectedAccount,capabilities:{...connectedAccount.capabilities,directSalePaymentsEnabled:false}}
])assert.equal(paymentStep([deviceDelivery],[account]).done,false);
assert.equal(paymentStep([{...manualDelivery,channel:'online'},manualDelivery]).done,true);
assert.match(paymentStep([]).detail,/Não é necessário conectar um provedor/);
assert.match(paymentStep([manualDelivery]).detail,/pagamento na entrega configurada/);
console.log('PASS: delivery payment preparation ignores online-only routes, respects enabled methods and requires matching authorized devices.');
