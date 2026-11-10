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
runtime.financeReal.actor='another-account';
assert(!context.nav().includes('Pix já pago: conferir valor líquido'),
 'receipt from another session cannot be shown');
const financeRender=src.slice(src.indexOf("const financeContent="),
 src.indexOf("const alertsContent="));
assert.match(financeRender,/financeSelection==='summary'\?adminFinanceRenderPart\('Fila financeira'/);
assert.match(financeRender,/financeSelection==='summary'\?adminFinanceRenderPart\('Prioridades financeiras'/);
const view=src.slice(src.indexOf('function adminFinanceHomologationView(d){'),
 src.indexOf('function adminFinanceHomologationToggleLab(){'));
assert(view.indexOf('adminFinanceRealPanel(chosen.key)')<
 view.indexOf('Conexão e recebimento'),'real payment appears before technical diagnostics');
assert.match(view,/couponPaid\?'':' open'/);
assert.match(view,/admin-finance-connection/);
assert.match(src,/Pix PAGO e registrado no TAMÃO/);
assert.match(src,/Conciliação do líquido pendente/);
assert.match(src,/Os cupons não estão liberados para uso/);
assert.match(css,/admin-finance-shortcut/);
assert.match(css,/admin-finance-secondary/);
assert.match(read('.github/workflows/audit.yml'),/node tests\/admin-finance-navigation-v1-930\.mjs/);
console.log('V1.930 PASS: direct coupon review, paid evidence first, clean nav, no new charge or role leak.');
