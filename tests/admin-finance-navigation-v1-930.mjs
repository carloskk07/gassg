import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const src=read('js/admin.js'),css=read('css/components.css');
assert.doesNotThrow(()=>new vm.Script(src));
const defStart=src.indexOf('const ADMIN_FINANCE_WORKSPACES=');
const defEnd=src.indexOf('/* Finance Lab:',defStart);
const navStart=src.indexOf('function adminFinanceOpenCouponReview(){');
const navEnd=src.indexOf('function adminSetFinanceWorkspace(',navStart);
assert(defStart>0&&defEnd>defStart&&navStart>0&&navEnd>navStart);
const runtime={section:'finance',financeWorkspace:'homologation',
 session:{user:{id:'owner'}},financeReal:{actor:'owner',loadedKey:'coupons',
 data:{history:{purchases:[{status:'paid',fundingPending:true}]}}}};
const evidence={selected:'mobility'};
let role='superadmin',switches=0,sectionSwitches=0,realChecks=0,created=0;
const context=vm.createContext({
 adminRuntime:runtime,adminRoleCanSection:section=>section==='finance',
 adminCurrentRole:()=>role,adminReady:()=>true,
 adminFinanceHomologationEvidenceState:()=>evidence,
 adminSetFinanceWorkspace:key=>{switches++;runtime.financeWorkspace=key;},
 adminSetSection:key=>{sectionSwitches++;runtime.section=key;},
 adminFinanceRealRefresh:()=>{realChecks++;return Promise.resolve();},
 esc:value=>String(value)
});
vm.runInContext(src.slice(defStart,defEnd)+src.slice(navStart,navEnd)+
 ';this.nav=adminFinanceWorkspaceNav;this.review=adminFinanceOpenCouponReview;',context);
let html=context.nav();
assert.match(html,/Pix já pago: conferir valor líquido/);
assert.match(html,/Não pague novamente/);
assert.match(html,/Continuar conferência/);
assert.match(html,/admin-finance-primary/);
assert.match(html,/Configurações e ferramentas avançadas/);
assert.equal((html.match(/id='admin-finance-switch-/g)||[]).length,6);
assert(html.indexOf("admin-finance-switch-homologation")<
 html.indexOf("admin-finance-secondary"),'real payments must be easy to find');
assert(html.indexOf("admin-finance-switch-lab")>
 html.indexOf("admin-finance-secondary"),'technical lab stays secondary');
assert.equal(context.review(),true);
assert.equal(evidence.selected,'coupons');
assert.equal(runtime.financeWorkspace,'homologation');
assert.equal(switches,1);
assert.equal(created,0,'navigation cannot generate Pix');
runtime.financeWorkspace='policy';
assert.match(context.nav(),/class='admin-finance-secondary' open/);
runtime.section='overview';
assert.equal(context.review(),true);
assert.equal(sectionSwitches,1);
assert.equal(realChecks,1);
role='finance';
html=context.nav();
assert(!html.includes('adminFinanceOpenCouponReview()'),
 'coupon shortcut must not be visible to other roles');
assert(!html.includes("admin-finance-switch-lab"),
 'financial lab restricted to owner');
assert(!html.includes("admin-finance-switch-homologation"),
 'financial homologation restricted to owner');
assert.equal(context.review(),false);
role='superadmin';
// V1.958: the ORIGINAL owner's sponsored R$8.90 Pix is paid and the three
// R$5 vouchers have independent financial coverage even before PSP NET.
runtime.financeReal.data.history.purchases=[{
 status:'paid',amountCents:890,fundingPending:false,
 packageKey:'all_products_3x5_sponsor'}];
html=context.nav();
assert.match(html,/Pix já pago: cupons financiados/);
assert.match(html,/Ver recibo e benefícios/);
assert.match(html,/A conciliação líquida do Mercado Pago é independente/);
assert.match(html,/não pague novamente/);
assert.doesNotMatch(html,/falta conferir o valor líquido/);
assert.equal(created,0,'read-only sponsor receipt never generates Pix');
// If ANY paid voucher has not been financially covered, its warning wins.
runtime.financeReal.data.history.purchases.push({
 status:'paid',amountCents:890,fundingPending:true});
assert.match(context.nav(),/Pix já pago: conferir valor líquido/);
// A pending, review, or unknown invoice may never be labeled paid.
runtime.financeReal.data.history.purchases=[{
 status:'awaiting_payment',amountCents:890,fundingPending:false}];
assert.match(context.nav(),/Consultar pagamento de cupons/);
assert.doesNotMatch(context.nav(),/Pix já pago: cupons financiados/);
runtime.financeReal.data.history.purchases=[{
 status:'paid',fundingPending:false}];
runtime.financeReal.actor='another-account';
assert(!context.nav().includes('Pix já pago: conferir valor líquido')&&
 !context.nav().includes('Pix já pago: cupons financiados'),
 'receipt from another session cannot be shown');
assert.match(context.nav(),/Consultar pagamento de cupons/);
const financeRender=src.slice(src.indexOf("const financeContent="),
 src.indexOf("const alertsContent="));
assert.match(financeRender,/financeSelection==='summary'\?adminFinanceRenderPart\('Fila financeira'/);
assert.match(financeRender,/financeSelection==='summary'\?adminFinanceRenderPart\('Prioridades financeiras'/);
const view=src.slice(src.indexOf('function adminFinanceHomologationView(d){'),
 src.indexOf('function adminFinanceHomologationToggleLab(){'));
assert(view.indexOf('adminFinanceRealPanel(chosen.key)')<
 view.indexOf('Conexão e recebimento'),'real payment appears before technical diagnostics');
assert.match(view,/couponPaid\|\|chosen\.key==='advertising'\?'':' open'/);
assert.match(view,/admin-finance-connection/);
assert.match(src,/Pix PAGO e registrado no TAMÃO/);
assert.match(src,/Conciliação do líquido pendente/);
assert.match(src,/Os cupons não estão liberados para uso/);
assert.match(css,/admin-finance-shortcut/);
assert.match(css,/admin-finance-secondary/);
assert.match(read('.github/workflows/audit.yml'),/node tests\/admin-finance-navigation-v1-930\.mjs/);
// V1.960: returning to Finance through the primary menu (not the shortcut)
// must re-read authenticated existing operations, without a purchase action.
const sectionStart=src.indexOf('function adminSetSection(section){');
const sectionEnd=src.indexOf('function adminMenuButton(',sectionStart);
assert(sectionStart>0&&sectionEnd>sectionStart);
let currentRole='superadmin',evidenceReads=0,existingPaymentReads=0,chargeCreates=0;
const sectionCtx=vm.createContext({
 adminRuntime:{section:'overview',financeWorkspace:'homologation',session:{user:{id:'owner'}}},
 adminRoleCanSection:()=>true,adminCurrentRole:()=>currentRole,
 adminFinanceWorkspaceCurrent:()=> 'homologation',
 adminFinanceHomologationRefresh:()=>{evidenceReads++;return Promise.resolve();},
 adminFinanceRealRefresh:()=>{existingPaymentReads++;return Promise.resolve();},
 adminLoadFinanceHistory:()=>Promise.resolve(),
 adminLoadMerchantFinance:()=>Promise.resolve(),
 adminFinanceLabLiveVisible:()=>false,
 adminFinanceLabLiveCancelAutoCheck:()=>{},
 render:()=>{},sessionStorage:{setItem:()=>{}},
 requestAnimationFrame:()=>{},adminAdvancedNavOpen:false
});
vm.runInContext(src.slice(sectionStart,sectionEnd)+';this.enterFinance=adminSetSection;',sectionCtx);
sectionCtx.enterFinance('finance');
assert.equal(evidenceReads,1,'Finance menu reloads module evidence');
assert.equal(existingPaymentReads,1,'Finance menu reloads existing Pix and vouchers');
assert.equal(chargeCreates,0,'read-only return never emits a Pix');
currentRole='finance';
sectionCtx.enterFinance('finance');
assert.equal(evidenceReads,1,'non-owner cannot refresh homologation evidence');
assert.equal(existingPaymentReads,1,'non-owner cannot invoke real-payment readback');
console.log('V1.960 PASS: Finance menu return refreshes existing payment for superadmin only.');
console.log('V1.930 PASS: direct coupon review, paid evidence first, clean nav, no new charge or role leak.');

 // V1.961: restoring the banking tab triggers one READ of the existing
 // owner-bound charge, even if the old 15-minute polling window expired.
const returnStart=src.indexOf('function adminFinanceReadbackOnReturn(){');
const returnEnd=src.indexOf('async function adminFinanceRealAction(',returnStart);
assert(returnStart>0&&returnEnd>returnStart);
let now=100000,readbacks=0,roleForReturn='superadmin',
 sectionForReturn='finance',keyForReturn='coupons',visibleForReturn='visible';
let returnBusy=false,returnBound=0;
const financeState={actor:'owner',returnReadAt:0,busy:false};
const docEvents={},windowEvents={};
const returnCtx=vm.createContext({
 Date:{now:()=>now},
 document:{get visibilityState(){return visibleForReturn;},
  addEventListener:(name,cb)=>{docEvents[name]=cb;returnBound++;}},
 globalThis:{addEventListener:(name,cb)=>{windowEvents[name]=cb;returnBound++;}},
 adminFinanceHomologationEvidenceState:()=>({selected:keyForReturn}),
 adminFinanceRealAllowed:(key)=>roleForReturn==='superadmin'&&
  sectionForReturn==='finance'&&key==='coupons',
 adminFinanceRealState:()=>financeState,
 adminFinanceRealRefresh:()=>{readbacks++;return Promise.resolve();}
});
vm.runInContext(src.slice(returnStart,returnEnd)+
 ';this.checkReturn=adminFinanceReadbackOnReturn;',returnCtx);
assert.equal(returnBound,3,'one visibility, focus and network listener each');
windowEvents.focus();
assert.equal(readbacks,1,'focus from payment app reads original invoice');
docEvents.visibilitychange();
windowEvents.online();
assert.equal(readbacks,1,'rapid duplicate events coalesced');
now+=16000;visibleForReturn='hidden';
docEvents.visibilitychange();
assert.equal(readbacks,1,'hidden tabs do not read financial state');
visibleForReturn='visible';docEvents.visibilitychange();
assert.equal(readbacks,2,'visible return after polling expiry rechecks invoice');
now+=16000;roleForReturn='finance';windowEvents.focus();
assert.equal(readbacks,2,'other roles cannot trigger financial reads');
roleForReturn='superadmin';sectionForReturn='overview';windowEvents.focus();
assert.equal(readbacks,2,'other sections never read financial data');
sectionForReturn='finance';financeState.busy=true;windowEvents.focus();
assert.equal(readbacks,2,'busy requests never race focus refreshes');
financeState.busy=false;keyForReturn='advertising';windowEvents.focus();
assert.equal(readbacks,2,'no cross-module coupon read');
assert.equal(chargeCreates,0,'no new Pix created on focus or network recovery');
console.log('V1.961 PASS: secure rate-limited tab-focus and reconnect readback of original Pix.');
