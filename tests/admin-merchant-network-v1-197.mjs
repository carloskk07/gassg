import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const src=read('js/admin.js');
new vm.Script(src,{filename:'js/admin.js'});
const extract=name=>{
  const a=src.indexOf('function '+name+'(');
  assert.ok(a>=0,'Missing function '+name);
  const b=src.indexOf('\n}',a);
  assert.ok(b>a,'Missing function end '+name);
  return src.slice(a,b+2);
};
const id=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const now=Date.now(),owner=id(900);
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const complete=(n,city,uf)=>({
 id:id(n),name:'Revenda '+n,cnpj:'12345678000199',status:'active',online:true,
 activeOwnerUserId:owner,businessDetails:{city,state:uf},
 compliance:{cnpj_status:'verified',anp_status:'verified'},
 representationReview:{owner_user_id:owner,merchant_cnpj:'12345678000199',
   revoked_at:null,expires_at:new Date(now+30*86400000).toISOString()},
 readiness:{offerReady:true,nextAction:'ready'}
});
let role='operations',rendered=0,focused=0,scrolled=0;
const data={merchants:[
 complete(1,'São Gabriel','RS'),
 {...complete(2,'sao gabriel','rs'),name:'Gás Dois',online:false,readiness:{offerReady:false,nextAction:'go_online'}},
 {...complete(3,'São Gabriel','SP'),name:'Gás três',status:'pending',readiness:{offerReady:false,nextAction:'verify_compliance'}},
 {...complete(4,'Porto Alegre','RS'),name:'Mercado <quatro>',status:'suspended',readiness:{offerReady:false,nextAction:'verify_compliance'}},
 {...complete(5,'Pelotas','RS'),name:'Revenda sem prova',readiness:null},
 {...complete(6,'Bagé','RS'),name:'Prova divergente',compliance:{cnpj_status:'rejected',anp_status:'verified'}},
 {...complete(7,'Santa Maria','RS'),name:'Revenda sem localização',businessDetails:null,readiness:{offerReady:false,nextAction:'confirm_offer'}},
 {id:'invalid" onfocus="alert(1)',name:'Injected',status:'active',businessDetails:{city:'Test',state:'RS'}}
]};
const rt={status:'ready',session:{user:'A'},data,lastSyncAt:new Date(now-1000).toISOString(),
 merchantNetworkCity:'all',merchantNetworkStatus:'all',section:'partners'};
const dom={};
const ctx=vm.createContext({adminRuntime:rt,Date,Number,Math,Object,Map,Set,String,
 adminRoleCanSection:key=>key==='partners'&&['operations','compliance','superadmin'].includes(role),
 adminPilotNextActionCopy:({onboarding})=>({verify_compliance:'Validar documentos',go_online:'Colocar online',confirm_offer:'Confirmar oferta'})[onboarding.nextAction]||'Verifique o cadastro',
 esc,render:()=>{rendered++},requestAnimationFrame:fn=>fn(),
 document:{getElementById:k=>dom[k]||null},toast:msg=>{ctx.lastToast=msg}
});
vm.runInContext([
 extract('adminMerchantProgressSnapshot'),extract('adminMerchantNetworkSnapshot'),
 extract('adminMerchantNetworkView'),extract('adminSetMerchantNetworkFilter'),
 extract('adminOpenMerchantNetworkRecord')
].join('\n')+
 '\nthis.snap=adminMerchantNetworkSnapshot;this.view=adminMerchantNetworkView;this.select=adminSetMerchantNetworkFilter;this.open=adminOpenMerchantNetworkRecord;',ctx);
let r=ctx.snap(data,now);
assert.equal(r.valid,true);
assert.equal(r.totals.registered,7,'Invalid identifiers must not enter counts');
assert.equal(r.totals.active,5,'Active count is an overlapping source status');
assert.equal(r.totals.available,1,'Only complete, online, current and server-ready merchant is available');
assert.equal(r.totals.active_no_offer,2,'Known active without offer');
assert.equal(r.totals.pending,1);
assert.equal(r.totals.review,2);
assert.equal(r.totals.unknown,1);
assert.equal(r.cities.length,6,'Same city spelling folded, different UF separate, unknown grouped');
assert.ok(r.cities.some(x=>x.key==='RS:sao-gabriel'&&x.count===2));
assert.ok(r.cities.some(x=>x.key==='SP:sao-gabriel'&&x.count===1));
assert.ok(r.cities.some(x=>x.key==='__unknown__'));
assert.equal(r.fresh,true);
let html=ctx.view(data);
for(const needle of ['Como está nossa rede de revendas?','Cadastradas na amostra',
 'Ativas no cadastro','Ofertáveis verificadas','Aguardando ativação',
 'Exigem revisão','Dados insuficientes','Município e UF','Situação','Abrir revenda'])
 assert.ok(html.includes(needle),'Missing UI text: '+needle);
assert.ok(html.includes('São Gabriel/RS')||html.includes('sao gabriel/RS'));
assert.ok(html.includes('Cidade não informada'));
assert.ok(html.includes('Mercado &lt;quatro&gt;'),'Escaping required');
assert.ok(!html.includes('Mercado <quatro>'));
assert.equal((html.match(/>Abrir revenda<\/button>/g)||[]).length,7);
assert.ok(!html.includes('adminSetMerchantStatus('));
assert.ok(!html.includes('adminPerform('));
assert.ok(!html.includes('adminApproveApplication('));
assert.ok(!html.includes('adminSaveCompliance('));
ctx.select('city','RS:sao-gabriel');
assert.equal(rt.merchantNetworkCity,'RS:sao-gabriel');
assert.equal(rendered,1);
html=ctx.view(data);
assert.ok(html.includes('2 de 7 revenda(s)'));
assert.equal((html.match(/>Abrir revenda<\/button>/g)||[]).length,2);
ctx.select('status','active_no_offer');
assert.equal(rt.merchantNetworkStatus,'active_no_offer');
html=ctx.view(data);
assert.equal((html.match(/>Abrir revenda<\/button>/g)||[]).length,1);
ctx.select('city','all');ctx.select('status','review');
html=ctx.view(data);
assert.equal((html.match(/>Abrir revenda<\/button>/g)||[]).length,2);
const prior=rendered;
ctx.select('city','RS:<script>');
ctx.select('status','__proto__');
ctx.select('invalid','all');
assert.equal(rendered,prior,'Unknown filters must not change UI');
rt.merchantNetworkCity='not-real';
rt.merchantNetworkStatus='not-real';
html=ctx.view(data);
assert.equal((html.match(/>Abrir revenda<\/button>/g)||[]).length,7,'Invalid saved filters reset safely');
rt.merchantNetworkCity='all';rt.merchantNetworkStatus='all';
const target={focus:options=>{focused++;assert.equal(options.preventScroll,true)},
 scrollIntoView:options=>{scrolled++;assert.equal(options.block,'center');assert.equal(options.behavior,'instant')}};
dom['admin-partner-work-merchant-'+id(1)]=target;
ctx.open(id(1));
assert.equal(focused,1);assert.equal(scrolled,1);
ctx.open('../../logout');assert.equal(focused,1);
ctx.open(id(999));assert.equal(focused,1);
role='finance';assert.equal(ctx.view(data),'');
ctx.open(id(1));assert.equal(focused,1);
ctx.select('status','available');assert.equal(rt.merchantNetworkStatus,'all');
role='readonly';assert.equal(ctx.view(data),'');
role='compliance';assert.ok(ctx.view(data).includes('Como está nossa rede'));
const empty=ctx.snap({merchants:[]},now);
assert.equal(empty.totals.registered,0);
assert.ok(ctx.view({merchants:[]}).includes('Nenhuma revenda corresponde'));
assert.equal(ctx.snap({}).valid,false);
assert.ok(ctx.view({}).includes('Rede indisponível'));
rt.lastSyncAt=new Date(now-12*60000).toISOString();
r=ctx.snap(data,now);
assert.equal(r.fresh,false);
assert.equal(r.totals.available,0,'Old evidence cannot claim available');
assert.equal(r.totals.unknown,2,'Old ready row is unknown until verified');
html=ctx.view(data);
assert.ok(html.includes('Consulta desatualizada'));
assert.ok(html.includes('Os indicadores de disponibilidade não são atuais'));
assert.ok(html.includes('>—</strong>'),'Current availability must not be shown as fake zero');
rt.lastSyncAt=new Date(now+120000).toISOString();
assert.equal(ctx.snap(data,now).fresh,false,'Future clock not treated fresh');
rt.lastSyncAt=new Date(now).toISOString();
const big={merchants:Array.from({length:300},(_,i)=>({...complete(i+100,'Cidade Grande','RS'),readiness:{offerReady:false,nextAction:'confirm_offer'}}))};
r=ctx.snap(big,now);
assert.equal(r.rows.length,300);
assert.equal(r.sampled,true);
html=ctx.view(big);
assert.equal((html.match(/>Abrir revenda<\/button>/g)||[]).length,40);
assert.ok(html.includes('atingiu 300 registros'));
assert.ok(html.includes('Exibindo as primeiras 40'));
const card=extract('adminMerchantCard');
assert.ok(card.includes('admin-partner-work-merchant-'));
const section=src.slice(src.indexOf('const partnersContent='),src.indexOf('const catalogContent='));
assert.ok(section.includes('adminMerchantNetworkView(d)'));
assert.ok(section.includes('adminMerchantOperationsQueueView(d)'));
assert.ok(src.includes('globalThis.adminSetMerchantNetworkFilter=adminSetMerchantNetworkFilter;'));
assert.ok(src.includes('globalThis.adminOpenMerchantNetworkRecord=adminOpenMerchantNetworkRecord;'));
assert.ok(!src.includes('admin_finance_merchant_performance_v1_190'));
const css=read('css/components.css');
assert.ok(css.includes('.admin-merchant-network-filters'));
assert.ok(css.includes('@media(max-width:340px)'));
assert.ok(css.includes('.admin-merchant-network :focus-visible'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-merchant-network-v1-197.mjs'));
console.log('V1.197: city+UF grouping, status evidence, missing/stale, RBAC, sample caps, XSS, focus, mobile, no writes passed.');
