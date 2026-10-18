import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const ui=read('js/admin-acquisition.js');
const boot=read('js/bootstrap.js');
const edge=read('supabase/functions/admin-ops/index.ts');
const workflow=read('.github/workflows/audit.yml');
new vm.Script(ui,{filename:'admin-acquisition.js'});
new vm.Script(boot,{filename:'bootstrap.js'});
assert.ok(ui.includes('adminClubeLaunchReadinessSection(),'));
assert.ok(boot.includes('adminClubeLaunchReadinessLoadFromUi'));
assert.ok(workflow.includes('node tests/clube-launch-readiness-v1-408.mjs'));
for(const action of ['clube-interest-queue','clube-campaign-queue','clube-terms-queue']){
 assert.ok(ui.includes("adminInvoke({action:'"+action+"'})"),action);
 assert.ok(edge.includes('if(action==="'+action+'")'),action+' must be authorized by the Edge server');
}
for(const text of ['couponSalesEnabled!==false','fundingVerifiedCents!==0',
 'sponsorFundingConfirmedCents!==0','moneyReservedCents!==0',
 'session!==adminRuntime?.session','adminClubeLaunchReadinessBusy',
 'noCharge!==true','ready:false','activeSales:0','contractedCents:0']){
 assert.ok(ui.includes(text),'Missing gate '+text);
}
assert.doesNotMatch(ui.slice(ui.indexOf('/* TAMÃO V1.408'),ui.indexOf('// Clube TAMÃO V1.240')),
 /adminInvoke\(\{action:'(?:clube-terms-save|clube-campaign-review|clube-coupon-purchase|coupon-issue)'/,
 'readiness cannot mutate an agreement, issue a coupon or charge a buyer');

const snippet=ui.slice(ui.indexOf('/* TAMÃO V1.408'),ui.indexOf('// Clube TAMÃO V1.240'));
assert.ok(snippet.startsWith('/* TAMÃO V1.408'));
const actor='00112233-4455-6677-8899-aabbccddeeff';
const fake={
 'clube-interest-queue':{source:'admin_clube_interest_queue_v1_240',
  readOnly:true,couponSalesEnabled:false,noCharge:true,noContractsApproved:true,
  sponsorFundingConfirmedCents:0,totalProposals:2,rows:[]},
 'clube-campaign-queue':{source:'admin_clube_campaign_queue_v1_241',
  readOnly:true,couponSalesEnabled:false,noCharge:true,noContractsApproved:true,
  sponsorFundingConfirmedCents:0,campaignsActive:0,totalProposals:2,activeInterests:1,rows:[]},
 'clube-terms-queue':{source:'admin_clube_terms_queue_v1_242',
  readOnly:true,couponSalesEnabled:false,noCharge:true,noContractsSigned:true,
  fundingVerifiedCents:0,moneyReservedCents:0,totalReviews:1,rows:[{termsVersion:1}]}
};
const runtime={status:'ready',session:{user:{id:actor}}};
const context=vm.createContext({
 adminRuntime:runtime,adminCurrentRole:()=> 'superadmin',
 adminInvoke:async({action})=>fake[action],render:()=>{},toast:()=>{},
 esc:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
 console
});
vm.runInContext(snippet,context,{filename:'clube-readiness.js'});
await vm.runInContext('adminClubeLaunchReadinessLoadFromUi()',context);
const html=vm.runInContext('adminClubeLaunchReadinessSection()',context);
assert.match(html,/Clube TAMÃO: acompanhe e avance/);
assert.match(html,/Interesses registrados/);
assert.match(html,/Interesses ativos/);
assert.match(html,/Revisões registradas/);
assert.match(html,/Pacotes à venda/);
assert.match(html,/Bloqueados no banco/);
assert.match(html,/Somente o Admin principal/);
assert.doesNotMatch(html,/Pacotes disponíveis para compra|Liberar agora|Vender cupons/);
assert.equal(vm.runInContext('adminClubeLaunchReadiness.ready',context),false);
assert.equal(vm.runInContext('adminClubeLaunchReadiness.activeSales',context),0);
assert.equal(vm.runInContext('adminClubeLaunchReadiness.visibleTerms',context),1);
context.adminInvoke=async({action})=>action==='clube-interest-queue'?
  {...fake[action],sponsorFundingConfirmedCents:30000}:fake[action];
await vm.runInContext('adminClubeLaunchReadinessLoadFromUi()',context);
const invalid=vm.runInContext('adminClubeLaunchReadinessSection()',context);
assert.match(invalid,/não confirmada pelas fontes oficiais/);
assert.doesNotMatch(invalid,/Interesses registrados<\/span>/);
runtime.session={user:{id:'another-actor'}};
assert.doesNotMatch(vm.runInContext('adminClubeLaunchReadinessSection()',context),/não confirmada pelas fontes oficiais/);
console.log('V1.408 PASS — three authoritative queues, stale session protection, no commercial activation, no charges.');
