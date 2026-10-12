import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/admin-acquisition.js');
const admin=read('js/admin.js');
new vm.Script(source,{filename:'js/admin-acquisition.js'});
new vm.Script(admin,{filename:'js/admin.js'});
const extract=(src,name)=>{
  const start=src.indexOf('function '+name+'(');
  assert.ok(start>=0,'Function missing: '+name);
  const end=src.indexOf('\n}',start);
  assert.ok(end>start,'Unterminated '+name);
  return src.slice(start,end+2);
};
const records=[
 {key:'RS:sao-gabriel',label:'São Gabriel/RS',hasRadar:true,hasMerchants:true,paused:false,
  overdue:3,openProspects:2,onboarding:1,interests:15,available:0,registered:2,
  needingReview:2,ranking:71},
 {key:'RS:pelotas',label:'Pelotas/RS',hasRadar:true,hasMerchants:true,paused:true,
  overdue:8,openProspects:6,onboarding:3,interests:50,available:0,registered:1,
  needingReview:1,ranking:90},
 {key:'RS:santa-maria',label:'Santa Maria/RS',hasRadar:true,hasMerchants:false,paused:false,
  overdue:0,openProspects:0,onboarding:0,interests:7,available:0,registered:0,
  needingReview:0,ranking:45},
 {key:'RS:porto-alegre',label:'Porto Alegre/RS',hasRadar:false,hasMerchants:true,paused:false,
  overdue:null,openProspects:null,onboarding:null,interests:null,available:1,registered:1,
  needingReview:1,ranking:null},
 {key:'RS:alegre',label:'Bairro <script>/RS',hasRadar:true,hasMerchants:false,paused:false,
  overdue:0,openProspects:null,onboarding:0,interests:0,available:0,registered:0,
  needingReview:0,ranking:null}
];
const escape=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
let role='operations',redraw=0,focused=0,opened=[],fresh=true,valid=true,limited=false;
const state={status:'ready',session:{user:{id:'a'}},data:{},commercialOpportunityFilter:'all'};
const context=vm.createContext({
  adminRuntime:state,Date,Number,Object,String,Array,Set,esc:escape,
  adminRoleCanSection:key=>key==='prospects'
    ?['superadmin','operations','compliance','readonly'].includes(role)
    :key==='partners'&&['superadmin','operations','compliance'].includes(role),
  adminExpansionBridgeSnapshot:()=>({valid,fresh,rows:records,cityCount:5,total:5,
    sampled:limited,missingLocation:0}),
  adminOpenExpansionBridgeCity:(key,dest)=>opened.push({key,dest}),
  render:()=>{redraw++},
  requestAnimationFrame:fn=>fn(),
  document:{getElementById:()=>({focus:()=>focused++})}
});
vm.runInContext(['adminCommercialOpportunitySnapshot','adminCommercialOpportunityView',
  'adminSetCommercialOpportunityFilter','adminOpenCommercialOpportunity']
  .map(n=>extract(source,n)).join('\n')+
  '\nthis.snapshot=adminCommercialOpportunitySnapshot;this.view=adminCommercialOpportunityView;'+
  'this.filter=adminSetCommercialOpportunityFilter;this.open=adminOpenCommercialOpportunity;',context);
let result=context.snapshot({},Date.now());
assert.equal(result.valid,true);
assert.equal(result.fresh,true);
assert.equal(result.items.length,8);
assert.equal(result.totals.overdue,1);
assert.equal(result.totals.paused,1);
assert.equal(result.totals.first_contact,1);
assert.equal(result.totals.onboarding,1);
assert.equal(result.totals.supply_gap,2);
assert.equal(result.totals.merchant_review,2);
assert.equal(result.items[0].kind,'overdue');
assert.equal(result.items[0].count,3,'Queue count must be underlying records, KPI counts cities');
assert.equal(result.items[1].kind,'paused','Paused city cannot generate contact tasks');
assert.equal(result.items.filter(x=>x.key==='RS:pelotas').length,1);
assert.ok(!result.items.some(x=>x.key==='RS:alegre'));
let html=context.view({});
for(const marker of ['Oportunidades que merecem atenção','Cidades com retornos vencidos',
  'Cidades com primeiros contatos pendentes','Cidades com parceiros em cadastramento',
  'Cidades com interesses e sem oferta confirmada','Prioridades','Conferir registros',
  'não envia mensagens','não é previsão de vendas']){
  assert.ok(html.includes(marker),'Missing '+marker);
}
assert.equal((html.match(/>Conferir registros<\/button>/g)||[]).length,8);
assert.ok(!html.includes('adminPerform('));
assert.ok(!html.includes('adminSaveProspect('));
assert.ok(!html.includes('adminIssueAnpProspectInvite('));
assert.ok(!html.includes('adminPauseMarketCity('));
assert.ok(!html.includes('adminSetMerchantStatus('));
context.filter('overdue');
assert.equal(state.commercialOpportunityFilter,'overdue');
assert.equal(redraw,1);
assert.equal(focused,1);
html=context.view({});
assert.equal((html.match(/>Conferir registros<\/button>/g)||[]).length,1);
assert.ok(html.includes('3 • Índice interno de trabalho: 71')||html.includes('Registros nesta categoria: 3'));
context.filter('merchant_review');
html=context.view({});
assert.equal((html.match(/>Conferir registros<\/button>/g)||[]).length,2);
const before=redraw;
context.filter('__proto__');
context.filter('other');
assert.equal(redraw,before,'Unknown filter cannot be applied');
state.commercialOpportunityFilter='unknown';
assert.equal((context.view({}).match(/>Conferir registros<\/button>/g)||[]).length,8,
 'Unexpected filter state must fallback to all');
context.open('RS:sao-gabriel','overdue');
assert.deepEqual(opened.at(-1),{key:'RS:sao-gabriel',dest:'prospects'});
context.open('RS:porto-alegre','merchant_review');
assert.deepEqual(opened.at(-1),{key:'RS:porto-alegre',dest:'partners'});
let length=opened.length;
context.open('RS:pelotas','overdue');
context.open('RS:nao-existe','overdue');
context.open('RS:sao-gabriel','bogus');
assert.equal(opened.length,length,'Only real current items can navigate');
role='readonly';
assert.ok(context.view({}).includes('Oportunidades que merecem atenção'));
context.open('RS:porto-alegre','merchant_review');
assert.equal(opened.length,length,'Readonly cannot access protected merchant view');
context.open('RS:sao-gabriel','overdue');
assert.equal(opened.at(-1).dest,'prospects');
role='finance';
assert.equal(context.view({}),'');
length=opened.length;
context.open('RS:sao-gabriel','overdue');
context.filter('overdue');
assert.equal(opened.length,length);
role='superadmin';
state.status='unauthenticated';
context.open('RS:sao-gabriel','overdue');
assert.equal(opened.length,length);
state.status='ready';
valid=false;
assert.equal(context.snapshot({}).valid,false);
assert.ok(context.view({}).includes('precisa dos dados atuais'));
length=opened.length;
context.open('RS:sao-gabriel','overdue');
assert.equal(opened.length,length);
valid=true;fresh=false;
result=context.snapshot({});
assert.equal(result.valid,true);
assert.equal(result.fresh,false);
assert.equal(result.items.length,0);
assert.equal(result.totals,null,'Unknown state cannot falsely mean zero opportunities');
assert.ok(context.view({}).includes('Conferência desatualizada'));
assert.ok(context.view({}).includes('não significam ausência'));
length=opened.length;
context.open('RS:sao-gabriel','overdue');
assert.equal(opened.length,length);
fresh=true;
limited=true;
assert.ok(context.view({}).includes('amostras limitadas'));
limited=false;
assert.ok(admin.includes("commercialOpportunityFilter:'all'"));
assert.ok(admin.includes("adminRuntime.commercialOpportunityFilter='all';"));
assert.ok(source.includes("adminCommercialOpportunityView(d)+adminExpansionBridgeView(d)"));
assert.ok(source.includes('function adminOpenCommercialOpportunity('));
const css=read('css/components.css');
assert.ok(css.includes('.admin-commercial-center-list'));
assert.ok(css.includes('@media(max-width:340px)'));
assert.ok(css.includes('.admin-commercial-center :focus-visible'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-commercial-center-v1-199.mjs'));
assert.ok(!admin.includes('admin_finance_merchant_performance_v1_190'));
console.log('V1.199 commercial center passed: overdue contacts, paused cities, onboarding, city gaps, conservative stale data, RBAC, navigation and mobile.');
