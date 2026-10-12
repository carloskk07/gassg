import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('js/admin.js'),acq=read('js/admin-acquisition.js');
new vm.Script(admin,{filename:'js/admin.js'});
new vm.Script(acq,{filename:'js/admin-acquisition.js'});
const extract=(src,name)=>{
  const i=src.indexOf('function '+name+'(');
  assert.ok(i>=0,'Missing '+name);
  const e=src.indexOf('\n}',i);
  assert.ok(e>i,'Unterminated '+name);
  return src.slice(i,e+2);
};
const uuid=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const owner=uuid(800);
const cnpj='12345678000199';
const now=Date.now();
const valid=(n,city,state)=>({
  id:uuid(n),name:'Revenda '+n,cnpj,status:'active',online:true,activeOwnerUserId:owner,
  businessDetails:{city,state},
  compliance:{cnpj_status:'verified',anp_status:'verified'},
  representationReview:{owner_user_id:owner,merchant_cnpj:cnpj,revoked_at:null,
    expires_at:new Date(now+7*86400000).toISOString()},
  readiness:{offerReady:true,nextAction:'ready'}
});
const data={merchants:[
  valid(1,'São Gabriel','RS'),
  {...valid(2,'Santa Maria','RS'),status:'pending',readiness:{offerReady:false,nextAction:'verify_compliance'}},
  {...valid(3,'Porto Alegre','RS'),online:false,readiness:{offerReady:false,nextAction:'go_online'}},
  {...valid(4,'Bagé','RS'),compliance:{cnpj_status:'rejected',anp_status:'verified'}},
  {...valid(5,'Canguçu','RS'),businessDetails:null,readiness:null}
]};
const radar=[
 {state:'RS',city:'Sao Gabriel',priority_score:60,interested_customers:15,
  anp_prospects:9,anp_source_status:'ok',eligible_merchants:1,
  uncontacted:3,overdue_followups:1,onboarding:2},
 {state:'RS',city:'Santa Maria',priority_score:40,interested_customers:8,
  anp_prospects:3,anp_source_status:'ok',eligible_merchants:0,overdue_followups:0},
 {state:'SP',city:'São Gabriel',priority_score:30,interested_customers:4,
  anp_prospects:3,anp_source_status:'ok',eligible_merchants:0},
 {state:'RS',city:'Pelotas',priority_score:25,interested_customers:1,
  anp_prospects:999,anp_source_status:'unavailable',eligible_merchants:0},
 {state:'RS',city:'Pelotas',priority_score:25,interested_customers:9,
  anp_prospects:999,anp_source_status:'ok'},
 {state:'?',city:'Rua <script>',priority_score:98}
];
let role='superadmin',renders=0,prospectSelections=[],sections=[],focuses=0,notice=[];
const rt={status:'ready',session:{user:{id:uuid(900)}},data,lastSyncAt:new Date(now-1000).toISOString(),
 expansionRadar:radar,expansionRadarLoaded:true,
 expansionRadarCheckedAt:new Date(now-1000).toISOString(),
 expansionRadarLoading:false,expansionRadarError:null,
 merchantNetworkCity:'all',merchantNetworkStatus:'all'};
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const ctx=vm.createContext({
  adminRuntime:rt,Date,Number,Math,Map,Set,Object,String,esc,
  adminRoleCanSection:key=>['superadmin','operations','compliance','readonly'].includes(role)
    &&(key==='prospects'||key==='partners'&&role!=='readonly'),
  adminPilotNextActionCopy:()=> 'Conferir próximo passo',
  adminProspectSelectCity:key=>prospectSelections.push(key),
  adminSetSection:next=>{sections.push(next);rt.section=next;renders++;},
  render:()=>renders++,
  requestAnimationFrame:callback=>callback(),
  document:{getElementById:key=>key==='admin-network-city'?{focus:()=>focuses++}:null},
  toast:x=>notice.push(x)
});
vm.runInContext([
 extract(admin,'adminMerchantProgressSnapshot'),
 extract(admin,'adminMerchantNetworkSnapshot'),
 extract(acq,'adminExpansionBridgeSnapshot'),
 extract(acq,'adminExpansionBridgeView'),
 extract(acq,'adminOpenExpansionBridgeCity')
].join('\n')+
 '\nthis.snap=adminExpansionBridgeSnapshot;this.view=adminExpansionBridgeView;this.open=adminOpenExpansionBridgeCity;',ctx);
let result=ctx.snap(data,now);
assert.equal(result.valid,true);
assert.equal(result.fresh,true);
assert.equal(result.duplicates,1);
assert.equal(result.invalidCities,1);
assert.equal(result.total,6);
assert.equal(result.missingLocation,1);
assert.equal(result.sampled,false);
const gabriel=result.rows.find(x=>x.key==='RS:sao-gabriel');
assert.ok(gabriel);
assert.equal(gabriel.registered,1);
assert.equal(gabriel.available,1);
assert.equal(gabriel.interests,15);
assert.equal(gabriel.anp,9);
assert.equal(gabriel.openProspects,3);
assert.equal(gabriel.stage,'Oferta confirmada na amostra');
assert.equal(result.rows.find(x=>x.key==='SP:sao-gabriel').registered,0,
 'Same town in different state must never be merged');
const santa=result.rows.find(x=>x.key==='RS:santa-maria');
assert.equal(santa.registered,1);
assert.equal(santa.available,0);
assert.equal(santa.needingReview,1);
assert.equal(santa.stage,'Revendas cadastradas, oferta não confirmada');
const pelotas=result.rows.find(x=>x.key==='RS:pelotas');
assert.equal(pelotas.anp,null,'ANP unavailable must not display counts');
assert.equal(result.rows.find(x=>x.key==='RS:porto-alegre').interests,null,
 'Merchant-only city must not fabricate demand or ANP records');
let html=ctx.view(data);
for(const text of ['Da demanda à revenda disponível','Interesses registrados',
 'Prospectos ANP*','Revendas cadastradas','Ofertáveis verificadas',
 'índice do radar','São Gabriel','Santa Maria','Pelotas','Porto Alegre',
 'Ver prospectos','Ver revendas']){
 assert.ok(html.toLowerCase().includes(text.toLowerCase()),'Missing '+text);
}
assert.ok(html.includes('ANP aparece somente quando a consulta da fonte foi confirmada'));
assert.ok(html.includes('cidade(s) repetida(s)'));
assert.ok(html.includes('localização(ões) inválida(s)'));
assert.ok(!html.includes('Rua <script>'));
assert.ok(!html.includes('999</strong>'),'Untrusted ANP count cannot be displayed');
assert.ok(!html.includes('adminPerform('));
assert.ok(!html.includes('adminSaveProspect('));
assert.ok(!html.includes('adminPauseMarketCity('));
assert.ok(!html.includes('adminSetMerchantStatus('));
assert.ok(html.includes('Sem revenda'));
ctx.open('RS:sao-gabriel','prospects');
assert.equal(prospectSelections.length,1);
assert.equal(prospectSelections[0],'RS|Sao Gabriel');
assert.equal(sections.length,0);
ctx.open('RS:sao-gabriel','partners');
assert.equal(sections.at(-1),'partners');
assert.equal(rt.merchantNetworkCity,'RS:sao-gabriel');
assert.equal(rt.merchantNetworkStatus,'all');
assert.equal(focuses,1);
const oldSections=sections.length;
ctx.open('SP:sao-gabriel','partners');
assert.equal(sections.length,oldSections,'No partner in city, no phantom activation');
ctx.open('../../logout','partners');
ctx.open('bad|city','prospects');
assert.equal(sections.length,oldSections);
const expiredRadarDate=new Date(now-2*3600000).toISOString();
rt.expansionRadarCheckedAt=expiredRadarDate;
result=ctx.snap(data,now);
assert.equal(result.fresh,false);
assert.equal(result.rows.find(x=>x.key==='RS:sao-gabriel').available,null);
html=ctx.view(data);
assert.ok(html.includes('Verificação necessária'));
assert.ok(html.includes('dados antigos'));
assert.ok(html.includes('>—</strong>'),'Old offer count not zero');
rt.expansionRadarCheckedAt=new Date(now-1000).toISOString();
rt.lastSyncAt=new Date(now-9*60000).toISOString();
assert.equal(ctx.snap(data,now).fresh,false);
rt.lastSyncAt=new Date(now).toISOString();
rt.expansionRadarCheckedAt=new Date(now+120000).toISOString();
assert.equal(ctx.snap(data,now).radarFresh,false,'Future evidence not fresh');
rt.expansionRadarCheckedAt=new Date(now).toISOString();
rt.expansionRadarLoaded=false;
assert.equal(ctx.snap(data,now).valid,false);
assert.ok(ctx.view(data).includes('radar comercial ainda não foi consultado'));
rt.expansionRadarLoaded=true;
assert.equal(ctx.snap({}).valid,false);
assert.ok(ctx.view({}).includes('lista de revendas ainda não foi carregada'));
const paused=[{...radar[0],admin_paused:true}];
rt.expansionRadar=paused;
assert.equal(ctx.snap(data,now).rows.find(x=>x.key==='RS:sao-gabriel').stage,
 'Pausada administrativamente');
rt.expansionRadar=Array.from({length:101},(_,i)=>({
 state:'RS',city:'Cidade '+i,priority_score:101-i,interested_customers:0,
 anp_source_status:'unavailable'
}));
result=ctx.snap(data,now);
assert.equal(result.sampled,true);
assert.equal(result.rows.length,100);
assert.ok(ctx.view(data).includes('limites na amostra'));
rt.expansionRadar=radar;
role='finance';
assert.equal(ctx.view(data),'');
const actionCount=prospectSelections.length;
ctx.open('RS:sao-gabriel','prospects');
assert.equal(prospectSelections.length,actionCount);
role='readonly';
assert.ok(ctx.view(data).includes('Da demanda à revenda disponível'));
ctx.open('RS:sao-gabriel','partners');
assert.equal(sections.length,oldSections,'Readonly cannot open protected Partner area');
role='operations';
assert.ok(ctx.view(data).includes('Da demanda à revenda disponível'));
rt.status='unauthenticated';
ctx.open('RS:sao-gabriel','prospects');
assert.equal(prospectSelections.length,actionCount);
rt.status='ready';
assert.ok(admin.includes('expansionRadarLoaded:false'));
assert.ok(admin.includes('expansionRadarCheckedAt:null'));
assert.ok(acq.includes('adminExpansionBridgeView(d)+placeholder'));
assert.ok(acq.includes('adminRuntime.expansionRadarLoaded=true'));
assert.ok(acq.includes("if(!adminReady()||String(adminRuntime.session?.user?.id||'')!==requestingUser)return;"));
const css=read('css/components.css');
assert.ok(css.includes('.admin-expansion-bridge-numbers'));
assert.ok(css.includes('@media(max-width:340px)'));
assert.ok(css.includes('.admin-expansion-bridge :focus-visible'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-expansion-evidence-v1-198.mjs'));
assert.ok(!admin.includes('admin_finance_merchant_performance_v1_190'));
console.log('V1.198 passed: ANP evidence, geographic join, duplicate guards, staged sampling, freshness, roles and navigation.');
