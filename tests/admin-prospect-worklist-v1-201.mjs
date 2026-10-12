import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('js/admin-acquisition.js');
function fn(name){
  const start=source.indexOf('function '+name+'(');
  const end=source.indexOf('\n}',start);
  assert.ok(start>=0&&end>start,'Missing '+name);
  return source.slice(start,end+2);
}
const now=Date.now(), cn=n=>String(n).padStart(14,'0');
function day(t){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(t)).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day}
const yesterday=day(now-86400000),tomorrow=day(now+86400000);
const report={state:'RS',city:'São Gabriel',prospects:[
  ...Array.from({length:12},(_,i)=>({cnpj:cn(i+1),legal_name:'Vencido '+i,prospect_status:'contacted',follow_up_at:yesterday})),
  ...Array.from({length:23},(_,i)=>({cnpj:cn(i+40),legal_name:'Primeira '+i,prospect_status:'uncontacted',contact_attempts:0})),
  ...Array.from({length:4},(_,i)=>({cnpj:cn(i+80),legal_name:'Agendado '+i,prospect_status:'contacted',follow_up_at:tomorrow})),
  {cnpj:cn(99),legal_name:'Desconsiderar',prospect_status:'dismissed'}
]};
const state={status:'ready',session:{user:{id:'user-A'}},prospectLoadedFor:'user-A',
  prospectReport:report,prospectLoadedAt:new Date(now).toISOString(),
  prospectLoading:false,prospectError:null,prospectCity:'São Gabriel',prospectState:'RS'};
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
let role='operations',rendered=0,focused=0,scrolled=0;
const doc={getElementById:id=>id==='prospect-editor-'+cn(11)?{
  open:false,querySelector:()=>({focus:()=>focused++}),scrollIntoView:()=>scrolled++
}:null};
const context=vm.createContext({adminRuntime:state,Date,Intl,Array,Object,String,Number,Map,Set,Math,esc,
  adminRoleCanSection:x=>x==='prospects'&&role!=='finance',
  adminCurrentRole:()=>role,render:()=>rendered++,
  requestAnimationFrame:cb=>cb(),document:doc,toast:()=>{}});
const helpers=['adminProspectFollowupSnapshot','adminProspectFollowupUi',
  'adminSelectProspectFollowupFilter','adminChangeProspectFollowupPage',
  'adminProspectFollowupView','adminOpenProspectFollowup'];
const constLine=source.split('\n').find(x=>x.startsWith('const ADMIN_PROSPECT_FOLLOWUP_FILTERS='));
assert.ok(constLine);
vm.runInContext(constLine+'\n'+helpers.map(fn).join('\n')+'\n'+
 'this.snapshot=adminProspectFollowupSnapshot;this.view=adminProspectFollowupView;'+
 'this.filter=adminSelectProspectFollowupFilter;this.page=adminChangeProspectFollowupPage;'+
 'this.open=adminOpenProspectFollowup;',context);
const snap=context.snapshot(report,now);
assert.equal(snap.total,39);
assert.equal(snap.items.length,10,'V1.200 10-card snapshot remains compatible');
assert.equal(snap.allItems.length,39,'Full set must remain navigable');
let html=context.view(report);
assert.equal((html.match(/>Ver negociação<\/button>/g)||[]).length,10);
assert.ok(html.includes('Todas (39)'));
assert.ok(html.includes('Vencidos (12)'));
assert.ok(html.includes('Primeira abordagem (23)'));
assert.ok(html.includes('Agendados (4)'));
assert.ok(html.includes("aria-pressed='true' data-kind='all'"));
assert.ok(html.includes('Página 1 de 4'));
context.page(1);
html=context.view(report);
assert.ok(html.includes('Página 2 de 4'));
assert.ok(html.includes('11–20 exibidas'));
context.page(1);context.page(1);context.page(1);
html=context.view(report);
assert.ok(html.includes('Página 4 de 4'));
assert.equal((html.match(/>Ver negociação<\/button>/g)||[]).length,9);
context.filter('overdue');
html=context.view(report);
assert.ok(html.includes('Vencidos (12)'));
assert.ok(html.includes('Página 1 de 2'));
context.page(1);
html=context.view(report);
assert.equal((html.match(/>Ver negociação<\/button>/g)||[]).length,2);
context.open(cn(11));
assert.equal(focused,1);assert.equal(scrolled,1);
context.filter('first_contact');
html=context.view(report);
assert.ok(html.includes('Página 1 de 3'));
assert.ok(html.includes('23 nesta categoria'));
context.filter('scheduled');
html=context.view(report);
assert.equal((html.match(/>Ver negociação<\/button>/g)||[]).length,4);
context.filter('unknown');assert.equal(state.prospectFollowupUi.filter,'scheduled');
context.page(100);assert.equal(state.prospectFollowupUi.page,0);
role='readonly';
html=context.view(report);
assert.ok(html.includes('disabled title="Apenas leitura neste perfil"'));
context.open(cn(11));assert.equal(focused,1);
role='operations';
state.prospectLoadedAt=new Date(now-20*60000).toISOString();
let count=rendered;
context.filter('all');context.page(1);
assert.equal(rendered,count,'Old snapshot must not authorize stale UI actions');
assert.ok(context.view(report).includes('ainda não confirmados'));
state.prospectLoadedAt=new Date(now).toISOString();
state.prospectCity='Santa Maria';
assert.equal(context.snapshot(report).valid,false);
state.prospectCity='São Gabriel';
state.session={user:{id:'user-B'}};state.prospectLoadedFor='user-B';
state.prospectLoadedAt=new Date(now+1000).toISOString();
html=context.view(report);
assert.ok(html.includes('Página 1 de 4'));
assert.equal(state.prospectFollowupUi.filter,'all','New session must reset filter');
state.status='unauthenticated';
count=rendered;context.filter('overdue');context.page(1);
assert.equal(rendered,count,'Signed-out user cannot manipulate queue');
const css=read('css/components.css');
assert.ok(css.includes('.admin-prospect-followup-filters button[aria-pressed="true"]'));
assert.ok(css.includes('.admin-prospect-followup-paging'));
assert.ok(css.includes('@media(max-width:340px)'));
assert.ok(!helpers.map(fn).join('\n').includes("adminPerform("),'View actions must not write CRM or payments');
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-prospect-worklist-v1-201.mjs'));
console.log('V1.201 passed: all records, category filters, pagination, user/city freshness, RBAC, no implicit writes and mobile.');
