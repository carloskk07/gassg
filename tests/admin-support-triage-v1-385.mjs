import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const admin=read('js/admin.js');
const css=read('css/components.css');
new vm.Script(admin,{filename:'admin.js'});
const start=admin.indexOf("let adminSupportQueueFilter='pending';");
const stop=admin.indexOf('\nfunction adminProductionRequirementLabel(',start);
assert.ok(start>0&&stop>start,'admin support triage functions should be contiguous');
const source=admin.slice(start,stop);
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const oldest='2026-10-17T09:00:00.000Z';
const newer='2026-10-17T12:00:00.000Z';
const caseId=id=>id.toString().padStart(8,'0')+'-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const uuid=caseId(100);
const rows=[
 {id:caseId(1),order_id:caseId(21),category:'late',status:'in_review',
  created_at:newer,updated_at:newer,message:'O pedido está atrasado'},
 {id:caseId(2),order_id:caseId(22),category:'wrong_item',status:'resolved',
  created_at:newer,updated_at:newer,resolution_note:'Troca registrada'},
 {id:caseId(3),order_id:caseId(23),category:'no_show',status:'open',
  created_at:oldest,updated_at:oldest,message:'Não chegou'},
 {id:caseId(4),order_id:caseId(24),category:'late',status:'open',
  created_at:newer,updated_at:newer},
 {id:caseId(5),order_id:caseId(25),category:'other',status:'closed',
  created_at:oldest,updated_at:oldest}
];
let role='superadmin';
const controls={filter:{value:'pending'},search:{value:''},count:{textContent:''},empty:{hidden:true}};
const nodes=[];
const document={
 getElementById(id){
  return {'admin-support-filter':controls.filter,
    'admin-support-search':controls.search,
    'admin-support-visible-count':controls.count,
    'admin-support-no-match':controls.empty}[id]||null;
 },
 querySelectorAll(selector){
  assert.equal(selector,'.admin-support-case');return nodes;
 }
};
const ctx=vm.createContext({
 document,esc,adminCurrentRole:()=>role,
 adminRelativeTime:()=> 'há 2 min',
 adminRuntime:{lastSyncAt:newer}
});
vm.runInContext(source+'\nthis.sort=adminSupportQueueSort;this.board=adminSupportQueueView;'+
 '\nthis.card=adminSupportCaseCard;this.apply=adminSupportQueueApplyFilter;'+
 '\nthis.date=adminSupportCaseDate;',ctx);
const ordered=Array.from(ctx.sort(rows)).map(x=>x.id);
assert.deepEqual(ordered.slice(0,3),[caseId(3),caseId(4),caseId(1)],
 'oldest unopened tickets first, followed by tickets in review');
assert.equal(rows[0].id,caseId(1),'server snapshot order must remain unchanged');
assert.equal(ctx.date('no date'),'');
assert.equal(ctx.date('2038-12-20T10:00:00Z'),'');
assert.ok(ctx.date(newer).includes('17/10/2026'));
let html=ctx.board(rows);
assert.match(html,/Fila de solicitações dos clientes/);
assert.match(html,/3 pendente\(s\)/);
assert.match(html,/Aguardam análise<\/small><strong>2/);
assert.match(html,/Em análise<\/small><strong>1/);
assert.match(html,/Resolvidos exibidos<\/small><strong>1/);
assert.match(html,/até 100 recentes/);
assert.match(html,/Dados consultados: há 2 min/);
assert.match(html,/3 atendimento\(s\) exibido\(s\)/);
assert.match(html,/adminSupportQueueApplyFilter\(\)/);
assert.match(html,/role="status" aria-live="polite"/);
assert.match(html,/adminOpenEntity\('order','00000023-aaaa-4aaa-8aaa-aaaaaaaaaaaa'\)/);
assert.match(html,/Assumir análise/);
assert.match(html,/Resolver/);
assert.match(html,/Tratativa registrada/);
assert.match(html,/admin-support-case/);
const locationResolved=html.indexOf('00000022-aaaa');
assert.ok(locationResolved>html.indexOf('00000021-aaaa'),
 'resolved cases should follow pending tickets');
role='finance';
html=ctx.board(rows);
assert.doesNotMatch(html,/Assumir análise|onclick="adminSetSupportStatus/);
assert.match(html,/Abrir pedido/,'finance role retains read-only case details');
role='support';
html=ctx.board(rows);
assert.match(html,/Assumir análise/);
const bogus=ctx.card({
 id:"');alert(1);//",order_id:"<svg onload=alert(1)>",
 category:'__proto__',status:'constructor',
 created_at:'not-a-date',message:'<script>alert(1)</script>',
 resolution_note:'<iframe></iframe>'
});
assert.match(bogus,/Assunto registrado/);
assert.match(bogus,/NÃO CONFIRMADO/);
assert.doesNotMatch(bogus,/onclick=|<script>|<svg|<iframe/);
assert.match(bogus,/&lt;script&gt;/);
assert.match(bogus,/data-support-status="constructor"/);

const pendingRows=rows.filter(x=>['open','in_review'].includes(x.status));
for(const item of rows){
 const rendered=ctx.card(item);
 const dataStatus=rendered.match(/data-support-status="([^"]*)"/)?.[1];
 const dataSearch=rendered.match(/data-support-search="([^"]*)"/)?.[1];
 nodes.push({status:dataStatus,search:dataSearch,hidden:false,
  getAttribute(key){return key==='data-support-status'?this.status:this.search}});
}
controls.filter.value='pending';controls.search.value='';
ctx.apply();
assert.equal(nodes.filter(n=>!n.hidden).length,pendingRows.length);
assert.equal(controls.count.textContent,'3 atendimento(s) exibido(s)');
controls.filter.value='open';ctx.apply();
assert.equal(nodes.filter(n=>!n.hidden).length,2);
controls.filter.value='resolved';ctx.apply();
assert.equal(nodes.filter(n=>!n.hidden).length,1);
controls.filter.value='all';controls.search.value='00000023';ctx.apply();
assert.equal(nodes.filter(n=>!n.hidden).length,1);
assert.equal(nodes.find(n=>!n.hidden).status,'open');
controls.search.value='inexistente';ctx.apply();
assert.equal(nodes.filter(n=>!n.hidden).length,0);
assert.equal(controls.empty.hidden,false);
controls.search.value='Atraso';controls.filter.value='pending';ctx.apply();
assert.equal(nodes.filter(n=>!n.hidden).length,2);
controls.filter.value='invalid';ctx.apply();
assert.equal(ctx.board(rows).includes('<option value="pending" selected>'),true);

const page=admin.slice(admin.indexOf('function adminPage(){'),
 admin.indexOf('\nfunction adminFilterRegistry(',admin.indexOf('function adminPage(){')));
assert.match(page,/adminSupportQueueView\(supportCases\)/);
assert.doesNotMatch(source,/adminPerform\(|supabase\.from\(|liveSubmit|window\.open/);
for(const token of ['.admin-support-queue-kpis',
 '.admin-support-case[hidden]','.admin-support-case-actions',
 '#admin-support-visible-count','@media(max-width:690px)','@media(max-width:370px)',
 '@media(prefers-reduced-motion:reduce)'])
 assert.ok(css.includes(token),'missing responsive triage rule '+token);
assert.ok(read('supabase/functions/admin-ops/index.ts').includes(
 '.in("status",["open","in_review","resolved"])'),
 'limited case list must be server-backed and not expose new data');
assert.ok(read('.github/workflows/audit.yml').includes(
 'node tests/admin-support-triage-v1-385.mjs'));
console.log('TAMÃO V1.385 PASS — prioritized support queue, limited results, keyboard/mobile filters, role controls, privacy and no new admin mutations.');
