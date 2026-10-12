import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('js/admin-acquisition.js'),admin=read('js/admin.js');
new vm.Script(source,{filename:'js/admin-acquisition.js'});
new vm.Script(admin,{filename:'js/admin.js'});
function extract(name){
  const start=source.indexOf('function '+name+'('),end=source.indexOf('\n}',start);
  assert.ok(start>=0&&end>start,'Missing function '+name);
  return source.slice(start,end+2);
}
const cities=[
  {key:'RS:pelotas',label:'Pelotas/RS',paused:true,hasRadar:true,hasMerchants:true,overdue:7,needingReview:3},
  {key:'RS:sao-gabriel',label:'São Gabriel/RS',hasRadar:true,hasMerchants:true,overdue:4,ranking:80},
  {key:'RS:porto-alegre',label:'Porto Alegre/RS',hasRadar:false,hasMerchants:true,needingReview:2,ranking:null},
  {key:'RS:santa-maria',label:'Santa Maria/RS',hasRadar:true,hasMerchants:false,openProspects:5,ranking:65},
  {key:'RS:bagé',label:'Bagé/RS',hasRadar:true,hasMerchants:false,onboarding:2},
  {key:'RS:rio-grande',label:'Rio Grande/RS',hasRadar:true,hasMerchants:true,interests:9,available:0,anp:5},
  {key:'RS:cacequi',label:'Cacequi/RS',hasRadar:true,hasMerchants:true,interests:6,available:2,registered:2},
  {key:'RS:unknown',label:'Sem confirmação/RS',hasRadar:true,hasMerchants:false,available:null,interests:null,anp:null},
  ...Array.from({length:9},(_,i)=>({key:'RS:extra-'+i,label:'Outra '+i+'/RS',
    hasRadar:true,hasMerchants:false,available:1,registered:0,ranking:i}))
].map(row=>({paused:false,hasRadar:false,hasMerchants:false,overdue:null,needingReview:0,
  openProspects:null,onboarding:null,interests:null,available:null,anp:null,ranking:null,
  registered:0,...row}));
const state={status:'ready',data:{},session:{user:{id:'account-A'}},lastSyncAt:new Date().toISOString(),
  expansionRadarCheckedAt:new Date().toISOString(),cityPipelineUi:null};
let valid=true,fresh=true,sampled=false,role='operations',renders=0;
let navigation=[];
const escape=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const ctx=vm.createContext({adminRuntime:state,Date,Number,Object,String,Array,Math,esc:escape,
 adminRoleCanSection:section=>section==='prospects'
   ?['operations','compliance','readonly','superadmin'].includes(role)
   :section==='partners'&&['operations','compliance','superadmin'].includes(role),
 adminExpansionBridgeSnapshot:()=>({valid,fresh,rows:cities,total:cities.length,sampled,missingLocation:2}),
 adminOpenExpansionBridgeCity:(key,destination)=>navigation.push([key,destination]),
 render:()=>renders++});
const names=['adminCityEvolutionStage','adminCityEvolutionSnapshot','adminCityEvolutionView','adminCityEvolutionCityNote',
 'adminCityPlanSteps','adminCityPlanView','adminCityPipelineSnapshot','adminCityPipelineUi','adminCityPipelineSetFilter',
 'adminCityPipelineSetSearch','adminCityPipelinePage','adminCityPipelineOpen','adminCityPipelineView'];
vm.runInContext(names.map(extract).join('\n')+
 '\nthis.snapshot=adminCityPipelineSnapshot;this.view=adminCityPipelineView;'+
 'this.filter=adminCityPipelineSetFilter;this.search=adminCityPipelineSetSearch;'+
 'this.page=adminCityPipelinePage;this.open=adminCityPipelineOpen;',ctx);
const snap=ctx.snapshot(state.data);
assert.equal(snap.valid,true);assert.equal(snap.fresh,true);
assert.equal(snap.items.length,cities.length,'One primary decision per city');
for(const kind of ['paused','followup','merchant_review','first_contact','onboarding','recruitment','operating','review']){
 assert.ok(snap.items.some(x=>x.kind===kind),'Missing primary decision '+kind);
}
assert.equal(snap.items[0].key,'RS:pelotas');
assert.ok(snap.items[0].next.includes('Revisar a pausa'),'Paused cities must never become contact tasks');
assert.equal(snap.totals.followup,1);
assert.equal(snap.totals.paused,1);
assert.equal(snap.totals.merchant_review,1);
assert.equal(snap.totals.recruitment,1);
assert.equal(snap.totals.operating,10);
let html=ctx.view(state.data);
assert.ok(html.includes('Visão comercial por cidades'));
assert.ok(html.includes('Situação principal'));
assert.ok(html.includes('Buscar município ou UF'));
assert.ok(html.includes('Pressione Enter'));
assert.ok(html.includes('Página 1 de 3'));
assert.equal((html.match(/>Conferir cidade<\/button>/g)||[]).length,8);
assert.ok(html.includes('ANP não equivale a parceria'));
assert.ok(!html.includes('adminPerform('));
ctx.page(1);
html=ctx.view(state.data);
assert.ok(html.includes('Página 2 de 3'));
ctx.page(1);ctx.page(1);
html=ctx.view(state.data);
assert.ok(html.includes('Página 3 de 3'));
assert.equal((html.match(/>Conferir cidade<\/button>/g)||[]).length,1);
ctx.filter('followup');
html=ctx.view(state.data);
assert.ok(html.includes('Página 1 de 1'));
assert.equal((html.match(/>Conferir cidade<\/button>/g)||[]).length,1);
assert.ok(html.includes('São Gabriel/RS'));
ctx.open('RS:sao-gabriel','prospects');
assert.equal(navigation.at(-1).join(':'),'RS:sao-gabriel:prospects');
ctx.open('RS:porto-alegre','partners');
assert.equal(navigation.at(-1).join(':'),'RS:porto-alegre:partners');
const before=navigation.length;
ctx.open('RS:fake','prospects');ctx.open('RS:porto-alegre','prospects');
ctx.open('RS:sao-gabriel','invalid');
assert.equal(navigation.length,before,'Only validated city/target pairs navigate');
const rendered=renders;
ctx.filter('__proto__');
assert.equal(renders,rendered,'Ignore unknown filters');
ctx.search('SÃO GABRIEL');
assert.ok(ctx.view(state.data).includes('São Gabriel/RS'));
ctx.search('<script>');
assert.ok(ctx.view(state.data).includes('Nenhuma cidade corresponde aos filtros'));
assert.ok(!ctx.view(state.data).includes('value="<script>"'));
ctx.search('');
ctx.filter('all');
role='readonly';
html=ctx.view(state.data);
assert.ok(html.includes('Visão comercial por cidades'));
ctx.open('RS:porto-alegre','partners');
assert.equal(navigation.length,before,'Read-only role cannot navigate into protected revenda data');
ctx.open('RS:sao-gabriel','prospects');
assert.equal(navigation.length,before+1);
role='finance';
assert.equal(ctx.view(state.data),'');
let n=renders;ctx.filter('paused');ctx.search('Pelotas');ctx.page(1);ctx.open('RS:pelotas','prospects');
assert.equal(renders,n);
role='operations';fresh=false;
html=ctx.view(state.data);
assert.ok(html.includes('Informações desatualizadas'));
assert.ok(!html.includes('0 cidades'));
n=renders;ctx.filter('operating');ctx.page(1);
assert.equal(renders,n,'Stale sources must not authorize actions');
fresh=true;valid=false;
assert.ok(ctx.view(state.data).includes('Sem dados confirmados')||ctx.view(state.data).includes('Consulte o radar'));
valid=true;sampled=true;
assert.ok(ctx.view(state.data).includes('amostra limitada'));
sampled=false;
state.session={user:{id:'account-B'}};
state.lastSyncAt=new Date(Date.now()+1000).toISOString();
ctx.view(state.data);
assert.equal(state.cityPipelineUi.filter,'all','New user/source must reset filter');
state.status='unauthenticated';
assert.equal(ctx.view(state.data),'');
const stylesheet=read('css/components.css');
assert.ok(stylesheet.includes('.admin-city-pipeline-list'));
assert.ok(stylesheet.includes('@media(max-width:340px)'));
assert.ok(stylesheet.includes('.admin-city-pipeline :focus-visible'));
assert.ok(admin.includes('cityPipelineUi:null'));
assert.equal((admin.match(/adminRuntime[.]cityPipelineUi=null;/g)||[]).length,3,
 'Sign-out, access revocation, and session expiry must wipe state');
assert.ok(source.includes('adminCityPipelineView(d)+adminCommercialOpportunityView(d)'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-city-pipeline-v1-202.mjs'));
assert.ok(!names.map(extract).join('\n').includes('adminPerform('));
console.log('V1.202 passed: priority, single decision, filtering, pagination, authorization, freshness, sessions, escaping and no writes.');
