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
 readiness:{offerReady:true,nextAction:'ready',cnpjVerificationCurrent:true,anpVerificationCurrent:true}
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
 'Responsável vinculado','CNPJ vigente','Exigência ANP vigente',
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


const staleCnpj={...merchant,readiness:{...merchant.readiness,cnpjVerificationCurrent:false}};
assert.equal(ctx.snapshot(staleCnpj,now).steps.find(s=>s.key==='cnpj').status,'pending');
assert.equal(ctx.snapshot(staleCnpj,now).ready,false);
assert.ok(ctx.view(staleCnpj).includes('Reconfirmar CNPJ'));
const staleAnp={...merchant,readiness:{...merchant.readiness,anpVerificationCurrent:false}};
assert.equal(ctx.snapshot(staleAnp,now).steps.find(s=>s.key==='anp').status,'pending');
assert.equal(ctx.snapshot(staleAnp,now).ready,false);
assert.ok(ctx.view(staleAnp).includes('Revalidar ANP'));
const noLongerExempt={...noAnp,readiness:{...merchant.readiness,anpVerificationCurrent:false}};
assert.equal(ctx.snapshot(noLongerExempt,now).steps.find(s=>s.key==='anp').status,'pending');
const missingServerEvidence={...merchant,readiness:{offerReady:true,nextAction:'ready'}};
assert.equal(ctx.snapshot(missingServerEvidence,now).steps.find(s=>s.key==='cnpj').status,'unknown');
assert.equal(ctx.snapshot(missingServerEvidence,now).steps.find(s=>s.key==='anp').status,'unknown');
assert.equal(ctx.snapshot(missingServerEvidence,now).ready,false);
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

// Admin 360 reuses the exact seven-step widget: no second readiness rules.
const detailSource=source.slice(source.indexOf("}else if(d.type==='merchant'){"),
 source.indexOf("}else if(d.type==='customer'){"));
assert.ok(detailSource.includes('adminMerchantProgressView((Array.isArray(adminRuntime.data?.merchants)'),
 'Merchant 360 must reuse the list readiness evidence');
assert.ok(detailSource.includes('.find(x=>x?.id===m.id)'),
 'Never display progress from another company');
assert.ok(detailSource.indexOf('adminMerchantProgressView(')<detailSource.indexOf('<h3>Operação'),
 'Surface readiness before the merchant detail sections');
const card=fn('adminMerchantCard');
assert.ok(card.includes('adminMerchantProgressView(m)'));
assert.ok(card.includes('admin-partner-work-merchant-'));
const css=read('css/components.css');
assert.ok(css.includes('.admin-merchant-progress-steps'));
assert.ok(css.includes('@media(max-width:390px)'));
assert.ok(css.includes('@media(prefers-reduced-motion:reduce)'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-merchant-progress-v1-196.mjs'));
assert.ok(!source.includes('admin_finance_merchant_performance_v1_190'));
// Merchant 360 must take the administrator to the existing authorized
// controls, not invent an alternate verifier or auto-approve a partner.
vm.runInContext(fn('adminMerchantReturnToControls')+
 '\nthis.goControls=adminMerchantReturnToControls;',ctx);
assert.ok(source.includes("adminMerchantReturnToControls('${esc(m.id)}')"),
 '360 includes the correct merchant-specific review action');
const originalRole=role;
const originalData=rt.data;
const originalSection=rt.section;
let rendered=0,focused='',scrolled=false,flash='';
const selected='22222222-2222-4222-8222-222222222222';
const partnerCard={focus(){focused='card';},scrollIntoView(){scrolled=true}};
const cnpjField={focus(){focused='cnpj';}};
ctx.render=()=>{rendered++;};
ctx.toast=x=>{flash=String(x);};
ctx.requestAnimationFrame=callback=>callback();
ctx.document={getElementById:id=>id==='admin-partner-work-merchant-'+selected?partnerCard:
 id==='cnpj-'+selected?cnpjField:null};
rt.status='ready';
rt.section='dashboard';
rt.detail={type:'merchant',merchant:{id:selected}};
rt.session={user:{id:user}};
rt.data={merchants:[{id:selected}]};
role='operations';
assert.equal(ctx.goControls(selected),true);
assert.equal(rt.section,'partners');
assert.equal(rt.detail,null);
assert.equal(focused,'cnpj');
assert.equal(scrolled,true);
assert.equal(rendered,1);
const beforeMismatch=rendered;
assert.equal(ctx.goControls('33333333-3333-4333-8333-333333333333'),false);
assert.equal(rendered,beforeMismatch,'cannot navigate to a different unseen merchant');
assert.equal(ctx.goControls('invalid'),false);
role='finance';
assert.equal(ctx.goControls(selected),false,'finance-only account cannot navigate merchant controls');
assert.equal(rendered,beforeMismatch,'role rejection never rerenders');
role='operations';
rt.status='unauthenticated';
assert.equal(ctx.goControls(selected),false);
rt.status='ready';
ctx.document={getElementById:()=>null};
assert.equal(ctx.goControls(selected),true,'same merchant can be selected from loaded data');
assert.match(flash,/não está visível/,'missing DOM does not fabricate completion');
assert.ok(!fn('adminMerchantReturnToControls').includes('adminPerform('));
rt.data=originalData;
rt.section=originalSection;
role=originalRole;

console.log('V1.196: seven evidence-specific milestones; unknown, mismatch, revoked, expired, stale, no-writing, role and mobile styles passed.');
