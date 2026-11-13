import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src={
 boot:read('js/bootstrap.js'),home:read('js/customer.js'),quote:read('js/home-showcase.js'),
 admin:read('js/admin.js'),merchant:read('js/merchant.js'),core:read('js/core.js'),
 css:read('css/components.css'),e2e:read('tests/browser-e2e.mjs'),
 audit:read('.github/workflows/audit.yml')
};
for(const k of ['boot','home','quote','admin','merchant','core'])
 assert.doesNotThrow(()=>new vm.Script(src[k],{filename:k+'.js'}));
function extract(s,start,end){
 const a=s.indexOf(start),b=s.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Missing boundaries: '+start);
 return s.slice(a,b);
}
const home=extract(src.home,'function home(){','\nfunction orderPage(){');
const branch=home.slice(home.indexOf('if(!testDemo&&!internalPilot)return shell('));
const quote=branch.indexOf('$'+'{regionalPriceSection||');
const catalog=branch.indexOf('class="home-discover tamao-home-catalog"');
const banner=branch.indexOf('$'+'{couponBanner}');
assert.ok(quote>=0&&catalog>quote&&banner>catalog,'Product catalog precedes coupon promotion');
assert.match(src.quote,/<h1>TAMÃO em '\+esc\(place\)/);
assert.match(src.quote,/Sem ofertas confirmadas em/);
assert.match(src.quote,/pedido só avança com uma revenda e um preço confirmados/);
assert.match(src.css,/\.city-price-heading :is\(h1,h2\)/);
assert.match(src.css,/\.tamao-quote-no-offer/);

let page='professionals';
const context=vm.createContext({
  esc:v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
  shell:x=>x,route:()=>page,discoveryModuleError:false,
  mobilityModuleError:false,discoveryOwnerModuleError:false
});
const code=[
 extract(src.boot,'function tamaoPublicModuleState(', 'function discoveryLoadingPage()'),
 extract(src.boot,'function discoveryLoadingPage()', 'function retryDiscoveryModule()'),
 extract(src.boot,'function mobilityLoadingPage()', 'function mobilityRetryModule()'),
 extract(src.boot,'function discoveryOwnerLoadingPage()', 'function retryDiscoveryOwnerModule()')
].join('\n');
vm.runInContext(code+'\nthis.discovery=discoveryLoadingPage;this.mobility=mobilityLoadingPage;this.owner=discoveryOwnerLoadingPage;',context);
for(const [routeName,flag,view,retry] of [
 ['professionals','discoveryModuleError','discovery','retryDiscoveryModule'],
 ['rides','discoveryModuleError','discovery','retryDiscoveryModule'],
 ['stays','discoveryModuleError','discovery','retryDiscoveryModule'],
 ['mobility','mobilityModuleError','mobility','mobilityRetryModule'],
 ['advertise','discoveryOwnerModuleError','owner','retryDiscoveryOwnerModule']
]){
 page=routeName;context[flag]=false;
 const loading=context[view]();
 assert.match(loading,/<h1 class="page-title">[^<]+<\/h1>/);
 assert.match(loading,/role="status"/);
 assert.doesNotMatch(loading,/Tentar novamente/);
 assert.match(loading,/Ver produtos/);
 context[flag]=true;
 const failed=context[view]();
 assert.match(failed,/role="alert"/);
 assert.match(failed,new RegExp('onclick="'+retry+'\\(\\)"'));
 assert.match(failed,/Nenhum pedido, anúncio ou cobrança foi criado/);
 assert.match(failed,/Ver produtos/);
}
assert.match(src.boot,/if\(!document\.querySelector\('link\[href\*="css\/discovery\.css"\]'\)\)/);
assert.match(src.core,/>Painel administrativo<\/button>/);
assert.match(src.admin,/document\.title=adminSectionMeta\(adminRuntime\.section\)\.title\+' — TAMÃO Admin'/);
assert.match(src.merchant,/document\.title=\(String\(m\.name/);
assert.match(src.admin,/Consulte pagamentos, cobranças, reembolsos/);
assert.match(src.admin,/Veja cadastros, documentos e o que falta/);
assert.match(src.e2e,/for\(const routeName of \['learn','earn','merchants','club','sponsors','order','tracking','contact','privacy','terms'\]\)/);
assert.match(src.audit,/node tests\/page-journey-consistency-v1-971.mjs/);
console.log('V1.971 PASS: product-first home, semantic H1, consistent retry, browser route matrix, portal context.');
