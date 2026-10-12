import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/admin.js');
new vm.Script(source,{filename:'js/admin.js'});
function fn(name){
  const i=source.indexOf('function '+name+'(');
  assert.ok(i>0,'Function missing: '+name);
  const j=source.indexOf('\n}',i);
  assert.ok(j>i,'Function incomplete: '+name);
  return source.slice(i,j+2);
}
const escape=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const user='11111111-1111-4111-8111-111111111111';
const cnpj='12345678000199';
const now=Date.now();
const merchant={
 id:'22222222-2222-4222-8222-222222222222',
 name:'Revenda <segura>',cnpj,
 status:'active',online:true,activeOwnerUserId:user,
 compliance:{cnpj_status:'verified',anp_status:'verified'},
 representationReview:{owner_user_id:user,merchant_cnpj:cnpj,
   expires_at:new Date(now+30*24*3600000).toISOString(),revoked_at:null},
 readiness:{offerReady:true,nextAction:'ready'}
};
let role='operations';
const rt={status:'ready',lastSyncAt:new Date(now-2000).toISOString()};
const ctx=vm.createContext({
 Date,Number,Math,Object,
 adminRuntime:rt,
 adminRoleCanSection:key=>key==='partners'&&['operations','compliance','superadmin'].includes(role),
 adminPilotNextActionCopy:({onboarding})=>({verify_compliance:'Validar CNPJ e ANP',
   go_online:'Abrir o portal',confirm_offer:'Confirmar preço e estoque',
   ready:'Pronto',activate_merchant:'Ativar manualmente'})[onboarding.nextAction]||'Revisar informações',
 esc:escape
});
vm.runInContext([fn('adminMerchantProgressSnapshot'),fn('adminMerchantProgressView')].join('\n')+
 '\nthis.snapshot=adminMerchantProgressSnapshot;this.view=adminMerchantProgressView;',ctx);

const full=ctx.snapshot(merchant,now);
assert.equal(full.valid,true);
assert.equal(full.total,7);
assert.equal(full.done,7);
assert.equal(full.unknown,0);
assert.equal(full.conflict,false);
assert.equal(full.ready,true);
assert.equal(full.label,'Ofertável segundo o servidor');
let html=ctx.view(merchant);
assert.ok(html.includes('Evolução da revenda'));
assert.ok(html.includes('7 de 7 verificações com evidência positiva'));
assert.ok(html.includes("aria-valuenow='7'"));
assert.ok(html.includes('width:100%'));
assert.ok(html.includes('Ofertável segundo o servidor'));
for(const label of [
 'Responsável vinculado','CNPJ verificado','Exigência ANP verificada',
 'Representação legal vigente','Cadastro operacional ativo','Revenda online',
 'Oferta disponível','Estes marcos são informativos'
])assert.ok(html.includes(label),'Missing milestone: '+label);
assert.equal((html.match(/admin-merchant-progress-step done/g)||[]).length,7);
assert.ok(!html.includes('adminSetMerchantStatus('));
assert.ok(!html.includes('adminApproveApplication('));
assert.ok(!html.includes('adminPerform('));
assert.ok(!html.includes('onclick='));

const noAnp={...merchant,compliance:{...merchant.compliance,anp_status:'not_required'}};
assert.equal(ctx.snapshot(noAnp,now).done,7);
assert.ok(ctx.view(noAnp).includes('Não exigida conforme registro de compliance'));

const expired={...merchant,representationReview:{...merchant.representationReview,expires_at:new Date(now-1000).toISOString()}};
const sExpired=ctx.snapshot(expired,now);
assert.equal(sExpired.done,5);
assert.equal(sExpired.conflict,true);
assert.equal(sExpired.ready,false);
assert.ok(ctx.view(expired).includes('Evidências divergentes'));
assert.ok(ctx.view(expired).includes('Revisão obrigatória.'));

const revoked={...merchant,representationReview:{...merchant.representationReview,revoked_at:new Date(now-1000).toISOString()}};
const sRevoked=ctx.snapshot(revoked,now);
assert.equal(sRevoked.steps.find(s=>s.key==='representation').status,'blocked');
assert.equal(sRevoked.ready,false);

const wrongOwner={...merchant,representationReview:{...merchant.representationReview,owner_user_id:'33333333-3333-4333-8333-333333333333'}};
assert.equal(ctx.snapshot(wrongOwner,now).ready,false);
const wrongCnpj={...merchant,representationReview:{...merchant.representationReview,merchant_cnpj:'99999999000199'}};
assert.equal(ctx.snapshot(wrongCnpj,now).ready,false);

const suspended={...merchant,status:'suspended',readiness:{offerReady:false,nextAction:'verify_compliance'}};
const sSuspended=ctx.snapshot(suspended,now);
assert.equal(sSuspended.steps.find(s=>s.key==='activation').status,'blocked');
assert.equal(sSuspended.ready,false);
assert.ok(ctx.view(suspended).includes('Revenda suspensa'));
assert.ok(ctx.view(suspended).includes('Próximo passo:'));
const pending={...merchant,status:'pending',online:false,compliance:{cnpj_status:'pending',anp_status:'pending'},
 representationReview:null,readiness:{offerReady:false,nextAction:'activate_merchant'}};
const sPending=ctx.snapshot(pending,now);
assert.equal(sPending.ready,false);
assert.equal(sPending.done,1);
assert.equal(sPending.unknown,0);
assert.ok(ctx.view(pending).includes('1 de 7 verificações com evidência positiva'));
const incomplete={id:merchant.id,name:'Nova revenda',cnpj,
 status:'pending',compliance:{cnpj_status:'verified'},readiness:null};
const sIncomplete=ctx.snapshot(incomplete,now);
assert.equal(sIncomplete.ready,false);
assert.ok(sIncomplete.unknown>=3);
assert.ok(ctx.view(incomplete).includes('sem confirmação'));
assert.ok(!ctx.view(incomplete).includes('Ofertável segundo o servidor'));

const empty=ctx.snapshot(null);
assert.equal(empty.valid,false);
assert.equal(ctx.view(null),'');
const serverFalse={...merchant,readiness:{offerReady:false,nextAction:'confirm_offer'}};
assert.equal(ctx.snapshot(serverFalse,now).done,6);
assert.equal(ctx.snapshot(serverFalse,now).ready,false);
const offline={...merchant,online:false};
assert.equal(ctx.snapshot(offline,now).conflict,true);
assert.equal(ctx.snapshot(offline,now).ready,false);
const rejectedCnpj={...merchant,compliance:{cnpj_status:'rejected',anp_status:'verified'}};
assert.equal(ctx.snapshot(rejectedCnpj,now).steps[1].status,'blocked');
assert.equal(ctx.snapshot(rejectedCnpj,now).ready,false);

rt.lastSyncAt=new Date(now-15*60000).toISOString();
html=ctx.view(merchant);
assert.ok(html.includes('Consulta desatualizada'));
assert.ok(html.includes('Dados antigos.'));
assert.ok(!html.includes("<span class='status-pill online'>Ofertável segundo o servidor"));
rt.lastSyncAt=new Date(now+120000).toISOString();
assert.ok(ctx.view(merchant).includes('Consulta desatualizada'));
rt.lastSyncAt=new Date(now-2000).toISOString();
role='finance';
assert.equal(ctx.view(merchant),'');
role='readonly';
assert.equal(ctx.view(merchant),'');
role='compliance';
assert.ok(ctx.view(merchant).includes('Evolução da revenda'));
role='superadmin';
assert.ok(ctx.view(merchant).includes('Evolução da revenda'));

const card=fn('adminMerchantCard');
assert.ok(card.includes('adminMerchantProgressView(m)'));
assert.ok(card.includes('admin-partner-work-merchant-'));
const css=read('css/components.css');
assert.ok(css.includes('.admin-merchant-progress-steps'));
assert.ok(css.includes('@media(max-width:390px)'));
assert.ok(css.includes('@media(prefers-reduced-motion:reduce)'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-merchant-progress-v1-196.mjs'));
assert.ok(!source.includes('admin_finance_merchant_performance_v1_190'));
console.log('V1.196: seven evidence-specific milestones; unknown, mismatch, revoked, expired, stale, no-writing, role and mobile styles passed.');
