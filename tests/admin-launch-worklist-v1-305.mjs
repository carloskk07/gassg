import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const js=read('js/admin.js');
const css=read('css/components.css');
const audit=read('.github/workflows/audit.yml');
new vm.Script(js,{filename:'admin.js'});

const begin=js.indexOf('function adminLaunchWorklistModel(');
const end=js.indexOf('\nfunction adminReleaseHub(',begin);
assert.ok(begin>=0&&end>begin,'worklist functions must exist');
const src=js.slice(begin,end);

let role='superadmin';
const ctx=vm.createContext({
 adminCurrentRole:()=>role,
 adminRoleCanSection:section=>role==='superadmin'||(role==='operations'&&section!=='finance')||section==='enablement',
 adminOperationModeLabel:mode=>({PRELAUNCH:'CONFIGURAÇÃO',PILOT:'OPERAÇÃO ATIVA',LIVE:'OPERAÇÃO NORMAL',PAUSED:'PAUSADA'})[mode]||mode,
 esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 String,Number,Array
});
vm.runInContext(src+'\nthis.model=adminLaunchWorklistModel;this.view=adminLaunchWorklist;',ctx);

const empty=ctx.model(null);
assert.equal(empty.completed,0);
assert.equal(empty.next.key,'real_supply_required');
assert.equal(empty.readyForAdminReview,false);
assert.equal(empty.serverVerified,false);
assert.equal(ctx.view({}).includes('Sem dados completos de prontidão'),true);

const waiting={
 operationMode:'PRELAUNCH',commerceEnabled:false,
 supply:{availableNow:false,realSupplyConfigured:false},
 configuredMerchantCount:0,ownerReadyMerchantCount:0,
 paymentReadyMerchantCount:0,offerReadyMerchantCount:0,
 canActivateOperation:false,readyToEnable:false,
 portalsFresh:true,adminPortalOk:true,customerPortalOk:true,merchantPortalOk:true,
 portalsSourceSha:'abc123def456',securityBlockers:[],portalsVerifiedAt:'2026-10-15T20:03:07Z'
};
const result=ctx.model(waiting);
assert.equal(result.completed,0);
assert.equal(result.serverVerified,true);
assert.equal(result.portalsVerified,true);
assert.equal(result.readyForAdminReview,false);
const view=ctx.view({launchReadiness:waiting});
assert.match(view,/0 de 4 requisitos comprovados/);
assert.match(view,/Primeira revenda com oferta real/);
assert.match(view,/Responsável operacional/);
assert.match(view,/Recebimento da revenda/);
assert.match(view,/Preço, estoque e entrega confirmados/);
assert.match(view,/adminSetSection\('partners'\)/);
assert.match(view,/adminSetSection\('enablement'\)/);
assert.match(view,/role="meter"/);
assert.match(view,/aria-valuenow="0"/);
assert.match(view,/Ativação automática: não/);
assert.doesNotMatch(view,/onclick="adminSetOperationMode/);
assert.doesNotMatch(view,/Ativar todas as cidades/);
assert.doesNotMatch(view,/operação já liberada/);

const halfway={...waiting,
 supply:{availableNow:false,realSupplyConfigured:true},
 configuredMerchantCount:1,ownerReadyMerchantCount:1,
 paymentReadyMerchantCount:0,offerReadyMerchantCount:0
};
const m2=ctx.model(halfway);
assert.equal(m2.completed,2);
assert.equal(m2.next.key,'merchant_payment_required');
assert.match(ctx.view({launchReadiness:halfway}),/2 de 4 requisitos comprovados/);
assert.match(ctx.view({launchReadiness:halfway}),/aria-valuenow="2"/);
const allSignals={...halfway,
 supply:{availableNow:true,realSupplyConfigured:true},
 paymentReadyMerchantCount:1,offerReadyMerchantCount:1
};
assert.equal(ctx.model(allSignals).completed,4);
assert.equal(ctx.model(allSignals).readyForAdminReview,false,
  'supply signals alone never grant launch authority');
assert.equal(ctx.model({...allSignals,portalsFresh:false,readyToEnable:true,canActivateOperation:true}).readyForAdminReview,false,
  'portal publication is a separate gate');
assert.equal(ctx.model({...allSignals,securityBlockers:['unknown'],readyToEnable:true,canActivateOperation:true}).readyForAdminReview,false,
  'security blockers fail closed');
const eligible={...allSignals,readyToEnable:true,canActivateOperation:true};
assert.equal(ctx.model(eligible).readyForAdminReview,true);
assert.match(ctx.view({launchReadiness:eligible}),/Requisitos comerciais comprovados/);
assert.match(ctx.view({launchReadiness:eligible}),/Isso ainda não ativa vendas/);
assert.doesNotMatch(ctx.view({launchReadiness:eligible}),/onclick="adminSetOperationMode/);

role='operations';
assert.match(ctx.view({launchReadiness:waiting}),/admin-launch-worklist/);
assert.doesNotMatch(ctx.view({launchReadiness:waiting}),/adminSetSection\('finance'\)/);
role='support';
assert.equal(ctx.view({launchReadiness:waiting}),'');
role='readonly';
assert.match(ctx.view({launchReadiness:waiting}),/admin-launch-worklist/);
assert.doesNotMatch(ctx.view({launchReadiness:waiting}),/adminSetSection\('partners'\)/);

for(const mark of ['.admin-launch-worklist','.admin-launch-worklist-steps',
 '.admin-launch-meter','@media(max-width:570px)','prefers-reduced-motion:reduce'])
 assert.ok(css.includes(mark),'missing worklist presentation: '+mark);
assert.ok(js.includes('\${adminLaunchWorklist(d)}'));
assert.ok(audit.includes('node tests/admin-launch-worklist-v1-305.mjs'));
assert.ok(js.includes("adminLaunchControl(d.launchReadiness||{})"),
  'preserve separate permissioned launch control');
console.log('V1.305 PASS — server-derived launch checklist, 4 real constraints, readonly roles, activation fail-closed.');
