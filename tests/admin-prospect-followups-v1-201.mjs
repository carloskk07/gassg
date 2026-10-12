import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('js/admin-acquisition.js'),admin=read('js/admin.js');
new vm.Script(src,{filename:'js/admin-acquisition.js'});
new vm.Script(admin,{filename:'js/admin.js'});
function fn(name){const a=src.indexOf('function '+name+'('),b=src.indexOf('\n}',a);
 assert.ok(a>=0&&b>a,'Missing '+name);return src.slice(a,b+2)}
const now=Date.now();
function localDay(t){const o=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(t)).map(x=>[x.type,x.value]));return o.year+'-'+o.month+'-'+o.day}
const yesterday=localDay(now-86400000),today=localDay(now),tomorrow=localDay(now+86400000);
const cn=n=>String(n).padStart(14,'0');
const prospects=[
 {cnpj:cn(1),legal_name:'Atrasada <ABC>',prospect_status:'contacted',follow_up_at:yesterday,contact_attempts:1},
 {cnpj:cn(2),legal_name:'Hoje',prospect_status:'interested',follow_up_at:today,contact_attempts:3},
 {cnpj:cn(3),legal_name:'Primeira',prospect_status:'uncontacted',contact_attempts:0},
 {cnpj:cn(4),legal_name:'Sem agenda',prospect_status:'interested',contact_attempts:1},
 {cnpj:cn(5),legal_name:'Agendado',prospect_status:'contacted',follow_up_at:tomorrow},
 {cnpj:cn(6),legal_name:'Invalida',prospect_status:'contacted',follow_up_at:'2026-02-30'},
 {cnpj:cn(7),legal_name:'Parceira',prospect_status:'partner',follow_up_at:yesterday},
 {cnpj:cn(8),legal_name:'Descartada',prospect_status:'dismissed',follow_up_at:yesterday},
 {cnpj:cn(1),legal_name:'Duplicado',prospect_status:'contacted',follow_up_at:yesterday},
 {cnpj:'bad',legal_name:'Malformado',prospect_status:'contacted',follow_up_at:yesterday}
];
const report={state:'RS',city:'São Gabriel',prospects};
let role='operations',focus=0,scroll=0,deferredFrame=false,pendingFrame=null;
const state={status:'ready',session:{user:{id:'account-A'}},prospectLoadedFor:'account-A',
 prospectReport:report,prospectLoadedAt:new Date(now).toISOString(),prospectLoading:false,
 prospectError:null,prospectCity:'São Gabriel',prospectState:'RS'};
const details={open:false,querySelector:sel=>sel==='summary'?{focus:()=>focus++}:null,
 scrollIntoView:config=>{scroll++;assert.equal(config.block,'center')}};
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const ctx=vm.createContext({adminRuntime:state,Date,Number,String,Object,Array,Map,Set,Intl,Math,esc,
 adminCurrentRole:()=>role,adminRoleCanSection:key=>key==='prospects'&&['operations','superadmin','compliance','readonly'].includes(role),
 requestAnimationFrame:callback=>{if(deferredFrame)pendingFrame=callback;else callback()},document:{getElementById:id=>id==='prospect-editor-'+cn(1)?details:null},toast:()=>{}});
vm.runInContext(['adminProspectFollowupSnapshot','adminProspectFollowupView','adminOpenProspectFollowup'].map(fn).join('\n')+
 '\nthis.snapshot=adminProspectFollowupSnapshot;this.view=adminProspectFollowupView;this.open=adminOpenProspectFollowup;',ctx);
let s=ctx.snapshot(report,now);
assert.equal(s.valid,true);assert.equal(s.total,6);
for(const name of ['overdue','today','first_contact','needs_date','scheduled','unconfirmed'])assert.equal(s.counts[name],1,name);
assert.equal(s.items[0].cnpj,cn(1));assert.equal(s.items[1].cnpj,cn(2));
assert.equal(s.items.at(-1).cnpj,cn(5));assert.equal(s.day,today);
let html=ctx.view(report);
for(const word of ['Contatos para acompanhar','Vencidos','Para hoje','Primeiro contato','Revisar agendamento','Ver negociação','não envia mensagens'])assert.ok(html.includes(word),word);
assert.equal((html.match(/>Ver negociação<\/button>/g)||[]).length,6);
assert.ok(html.includes('Atrasada &lt;ABC&gt;'));assert.ok(!html.includes('Atrasada <ABC>'));
assert.ok(!html.includes('adminPerform('));assert.ok(!html.includes('adminSaveProspect('));
ctx.open(cn(1));assert.equal(details.open,true);assert.equal(focus,1);assert.equal(scroll,1);
ctx.open('not-id');ctx.open(cn(7));assert.equal(focus,1);
role='readonly';assert.ok(ctx.view(report).includes('disabled title="Apenas leitura neste perfil"'));
ctx.open(cn(1));assert.equal(focus,1);
role='finance';assert.equal(ctx.view(report),'');ctx.open(cn(1));assert.equal(focus,1);
role='compliance';assert.ok(ctx.view(report).includes('Contatos para acompanhar'));
assert.equal(ctx.snapshot({...report,city:'Porto Alegre'}).valid,false);
assert.ok(ctx.view({...report,city:'Porto Alegre'}).includes('Próximos contatos ainda não confirmados'));
state.prospectLoadedFor='account-B';assert.equal(ctx.snapshot(report).valid,false);
state.prospectLoadedFor='account-A';state.prospectLoadedAt=new Date(now-20*60000).toISOString();assert.equal(ctx.snapshot(report).valid,false);
state.prospectLoadedAt=new Date(now+120000).toISOString();assert.equal(ctx.snapshot(report).valid,false);
state.prospectLoadedAt=new Date(now).toISOString();state.prospectLoading=true;assert.equal(ctx.snapshot(report).valid,false);
state.prospectLoading=false;state.prospectError='Erro';assert.equal(ctx.snapshot(report).valid,false);
state.prospectError=null;
const empty={...report,prospects:[]};assert.equal(ctx.snapshot(empty,now).total,0);
assert.ok(ctx.view(empty).includes('Nenhuma negociação pendente identificada'));
const big={...report,prospects:Array.from({length:300},(_,i)=>({cnpj:cn(i+100),legal_name:'Prospecto '+i,prospect_status:'uncontacted'}))};
s=ctx.snapshot(big,now);assert.equal(s.total,300);assert.equal(s.items.length,10);assert.equal(s.limited,true);
assert.ok(ctx.view(big).includes('atingiu 300 registros'));

// V1.201: a click can outlive the originating city, account, permission or loading state.
deferredFrame=true;
const verifyNoOpen=change=>{
  details.open=false;
  const before=focus;
  ctx.open(cn(1));
  assert.equal(typeof pendingFrame,'function');
  change();
  pendingFrame();
  assert.equal(focus,before);
  assert.equal(details.open,false);
  pendingFrame=null;
};
verifyNoOpen(()=>{state.prospectCity='Porto Alegre'});
state.prospectCity='São Gabriel';
verifyNoOpen(()=>{state.prospectReport={...report,city:'Porto Alegre'}});
state.prospectReport=report;
verifyNoOpen(()=>{state.prospectLoading=true});
state.prospectLoading=false;
verifyNoOpen(()=>{role='readonly'});
role='operations';
verifyNoOpen(()=>{state.prospectLoadedFor='different-user'});
state.prospectLoadedFor='account-A';
verifyNoOpen(()=>{state.prospectError='source failed'});
state.prospectError=null;
verifyNoOpen(()=>{state.prospectLoadedAt=new Date(now-20*60000).toISOString()});
state.prospectLoadedAt=new Date().toISOString();
details.open=false;
ctx.open(cn(1));pendingFrame();
assert.equal(details.open,true);
deferredFrame=false;

const loader=fn('adminLoadProspects');
assert.ok(loader.includes('const requestingUser='));
assert.ok(loader.includes('adminRuntime.prospectLoadedFor=Array.isArray(response.prospects)?requestingUser:null'));
assert.ok(loader.includes('adminRuntime.prospectState===requestedState'));
assert.ok(loader.includes('adminLoadProspects().catch(()=>{})'));
assert.ok(admin.includes('prospectLoadedAt:null')&&admin.includes('prospectLoadedFor:null'));
assert.ok(admin.includes('adminRuntime.prospectLoadedAt=null;')&&admin.includes('adminRuntime.prospectLoadedFor=null;'));
assert.ok(src.includes('adminProspectFollowupView(matches?report:null)'));
assert.ok(src.includes('id="prospect-editor-'));
assert.ok(src.includes('Marque contato somente após realizá-lo'));
assert.ok(!admin.includes('admin_finance_merchant_performance_v1_190'));
const css=read('css/components.css');
assert.ok(css.includes('.admin-prospect-followup-list')&&css.includes('@media(max-width:340px)'));
assert.ok(css.includes('details[id^="prospect-editor-"] summary:focus-visible'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-prospect-followups-v1-200.mjs'));
console.log('V1.201 passed: due dates, no-contact, missing/invalid dates, roles, identity/freshness, XSS, keyboard, no writes.');
