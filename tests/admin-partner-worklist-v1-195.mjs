import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/admin.js');
new vm.Script(source,{filename:'js/admin.js'});
const fn=name=>{
 const i=source.indexOf('function '+name+'(');
 assert.ok(i>=0,'Missing '+name);
 const j=source.indexOf('\n}',i);
 assert.ok(j>i,'Unterminated '+name);
 return source.slice(i,j+2);
};
const uid=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const data={
 applications:[
  {id:uid(1),status:'pending',company_name:'Revenda <teste>',created_at:'2026-10-10T13:00:00Z'},
  {id:uid(2),status:'approved',company_name:'Já analisado'},
  {id:'invalid" onclick="x',status:'pending',company_name:'Entrada não confiável'}
 ],
 pilotPartners:[
  {id:uid(10),onboarding_status:'ready_for_review',display_name:'Parceiro A',onboarding:{nextAction:'review_and_convert'}},
  {id:uid(11),onboarding_status:'awaiting_legal_data',display_name:'Parceiro B',onboarding:{nextAction:'partner_claim_invite'}},
  {id:uid(12),onboarding_status:'converted',display_name:'Já convertido'},
  {id:uid(13),onboarding_status:'cancelled',display_name:'Cancelado'}
 ],
 merchants:[
  {id:uid(20),status:'pending',name:'Revenda C',readiness:{offerReady:false,nextAction:'verify_compliance'}},
  {id:uid(21),status:'active',name:'Revenda D',readiness:{offerReady:false,nextAction:'go_online'}},
  {id:uid(22),status:'active',name:'Revenda pronta',readiness:{offerReady:true,nextAction:'ready'}},
  {id:uid(23),status:'suspended',name:'Revenda sob análise',readiness:null}
 ]
};
const escape=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const rt={status:'ready',session:{user:'first'},section:'overview',data,lastSyncAt:new Date().toISOString()};
let role='operations',repaints=0,focused=0,scrolled=0,messages=[],dom={};
const ctx=vm.createContext({
 adminRuntime:rt,Date,Number,Object,esc:escape,
 adminRoleCanSection:key=>key==='partners'&&['superadmin','operations','compliance'].includes(role),
 adminPilotNextActionCopy:p=>({review_and_convert:'Revisar dados reais e converter',partner_claim_invite:'Aguardar o parceiro',
 verify_compliance:'Validar CNPJ/ANP',go_online:'Colocar online'})[p?.onboarding?.nextAction]||'Conferir próximo passo',
 render:()=>{repaints++},
 requestAnimationFrame:fn=>fn(),
 document:{getElementById:id=>dom[id]||null},
 toast:x=>messages.push(x)
});
vm.runInContext(['adminMerchantOperationsQueue','adminMerchantOperationsQueueView','adminFocusMerchantOperationsRecord'].map(fn).join('\n')+
 '\nthis.queue=adminMerchantOperationsQueue;this.view=adminMerchantOperationsQueueView;this.focus=adminFocusMerchantOperationsRecord;',ctx);
const result=ctx.queue(data);
assert.equal(result.valid,true);
assert.equal(result.total,6);
assert.equal(result.items[0].type,'application');
assert.equal(result.items[0].id,uid(1));
assert.ok(result.items.some(x=>x.type==='pilot'&&x.id===uid(10)));
assert.ok(result.items.some(x=>x.type==='merchant'&&x.id===uid(23)));
assert.ok(!result.items.some(x=>x.id===uid(22)));
assert.ok(!result.items.some(x=>x.id===uid(12)||x.id===uid(13)));
let html=ctx.view(data);
assert.ok(html.includes('Parceiros que precisam de atenção'));
assert.ok(html.includes('6 registro(s) com atenção na amostra'));
assert.ok(html.includes('Revenda &lt;teste&gt;'));
assert.ok(!html.includes('Revenda <teste>'));
assert.equal((html.match(/>Ver pendência<\/button>/g)||[]).length,6);
assert.ok(!html.includes('adminApproveApplication('));
assert.ok(!html.includes('adminSetMerchantStatus('));
assert.ok(!html.includes('adminPerform('));
assert.ok(html.includes('não aprova cadastro'));
assert.ok(html.includes("adminFocusMerchantOperationsRecord('pilot','"+uid(10)+"')"));
assert.equal(ctx.queue({applications:[],merchants:[]}).valid,false);
assert.ok(ctx.view({applications:[],merchants:[]}).includes('Fila de parceiros indisponível'));
const empty={applications:[],pilotPartners:[],merchants:[]};
assert.equal(ctx.queue(empty).total,0);
assert.ok(ctx.view(empty).includes('Isso não comprova que todas as revendas estejam habilitadas'));
const many={...data,pilotPartners:Array.from({length:300},(_,i)=>({
 id:uid(i+500),onboarding_status:'awaiting_legal_data',display_name:'Fila '+i,
 onboarding:{nextAction:'partner_claim_invite'}}))};
const limited=ctx.queue(many);
assert.equal(limited.items.length,8);
assert.equal(limited.sampled,true);
assert.ok(ctx.view(many).includes('Outros parceiros podem estar fora da amostra'));
rt.lastSyncAt=new Date(Date.now()-12*60000).toISOString();
assert.ok(ctx.view(data).includes('Dados desatualizados'));
assert.ok(ctx.view(data).includes('Atualize os dados'));
rt.lastSyncAt=new Date().toISOString();
role='finance';assert.equal(ctx.view(data),'');
ctx.focus('application',uid(1));assert.equal(repaints,0);
role='readonly';assert.equal(ctx.view(data),'');
role='compliance';
dom['admin-partner-work-application-'+uid(1)]={
 focus:opts=>{focused++;assert.equal(opts.preventScroll,true)},
 scrollIntoView:opts=>{scrolled++;assert.equal(opts.block,'center')}
};
ctx.focus('application',uid(1));
assert.equal(repaints,1);assert.equal(focused,1);assert.equal(scrolled,1);
assert.equal(rt.section,'partners');
ctx.focus('application',uid(2));assert.equal(repaints,1);
assert.ok(messages.at(-1).includes('mudou ou saiu'));
ctx.focus('pilot','../logout');assert.equal(repaints,1);
ctx.focus('random',uid(1));assert.equal(repaints,1);
ctx.focus('merchant',uid(20));assert.equal(repaints,2);
assert.ok(messages.at(-1).includes('não está visível'));
rt.data={applications:[],pilotPartners:[],merchants:[]};
ctx.focus('application',uid(1));assert.equal(repaints,2);
rt.data=data;rt.status='unauthenticated';
ctx.focus('application',uid(1));assert.equal(repaints,2);
rt.status='ready';
role='superadmin';assert.ok(ctx.view(data).includes('Parceiros que precisam de atenção'));
for(const [name,type,id] of [['adminApplicationCard','application','a.id'],['adminPilotPartnerCard','pilot','p.id'],['adminMerchantCard','merchant','m.id']]){
 const body=fn(name);
 assert.ok(body.includes('id="admin-partner-work-'+type+'-'));
 assert.ok(body.includes('tabindex="-1"'));
 assert.ok(body.includes('esc('+id+')'));
}
assert.ok(source.includes('adminMerchantOperationsQueueView(d)'));
assert.ok(source.includes('globalThis.adminFocusMerchantOperationsRecord=adminFocusMerchantOperationsRecord;'));
assert.ok(!source.includes('admin_finance_merchant_performance_v1_190'));
const css=read('css/components.css');
assert.ok(css.includes('.admin-partner-work-grid'));
assert.ok(css.includes('article[id^="admin-partner-work-"][tabindex="-1"]:focus'));
assert.ok(css.includes('@media(max-width:340px)'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-partner-worklist-v1-195.mjs'));
console.log('V1.195 partner worklist passed: roles, sample caps, status, XSS, focus, stale data and no writes.');
