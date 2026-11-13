import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const core=read('js/core.js'),css=read('css/marketing-premium.css')+'\n'+read('css/public-ux.css');
const audit=read('.github/workflows/audit.yml');
assert.doesNotThrow(()=>new vm.Script(core,{filename:'js/core.js'}));
const start=core.indexOf('function shell(content){');
const stop=core.indexOf('// V1.985: close desktop disclosures',start);
assert.ok(start>=0&&stop>start,'Public shell and menu handler available');
const state={route:'home',order:false,admin:false,merchant:false};
const ctx=vm.createContext({
 route:()=>state.route,runtimeStrip:()=>'',siteFooter:()=>'',bottomNav:()=>'',state:{mode:'customer'},
 globalThis:{adminPortalRequested:()=>state.admin,merchantPortalRequested:()=>state.merchant,
  __CHAMA_TEST__:false,liveRuntime:{}},encodeURIComponent
});
vm.runInContext(core.slice(start,stop)+'\nthis.renderShell=shell;',ctx);
const render=()=>ctx.renderShell('<section>BODY</section>');
function header(html){
 const match=html.match(/<nav class="desktop-only desktop-nav tamao-public-nav" aria-label="Navegação principal">([\s\S]*?)<\/nav>/);
 assert.ok(match,'Desktop nav must be rendered');
 return match[1];
}
const html=render(),nav=header(html);
const links=[...nav.matchAll(/onclick="go\('([^']+)'\)"/g)].map(x=>x[1]);
const expected=['club','earn','professionals','mobility','rides','advertise','learn','merchants','sponsors'];
assert.equal(links.length,expected.length,'Every destination rendered exactly once');
assert.deepEqual(links.sort(),expected.sort(),'No destination missing or duplicated');
assert.doesNotMatch(nav,/Mais|Montar cesta|>Produtos<\/button>/,'No repeated header navigation');
assert.match(html,/onclick="tamaoOpenAvailability\(\)">Comprar/,'One purchasing action');
assert.doesNotMatch(html,/Montar cesta/,'Old repeated shopping entry removed');
assert.equal((nav.match(/name="tamao-public-header-groups"/g)||[]).length,2);
assert.match(nav,/<summary>Serviços/);
assert.match(nav,/<summary>Conheça/);
assert.equal((nav.match(/aria-label="Navegação principal"/g)||[]).length,0);
assert.ok(html.includes('aria-label="Ir para o início do TAMÃO"'),'Brand remains home link');
for(const route of expected){
 state.route=route;
 const current=header(render());
 const matches=[...current.matchAll(/aria-current="page" onclick="go\('([^']+)'\)"/g)];
 assert.equal(matches.length,1,'Exactly one active entry for '+route);
 assert.equal(matches[0][1],route,'Current link for '+route);
 if(['professionals','mobility','rides','advertise'].includes(route))
  assert.match(current,/class="tamao-nav-more is-current"/,'Services menu active on '+route);
 if(['learn','merchants','sponsors'].includes(route))
  assert.match(current,/class="tamao-nav-more is-current"/,'Discover menu active on '+route);
}
state.route='home';ctx.globalThis.liveRuntime.orderId='order-123';
assert.match(render(),/Meu pedido/,'Existing order can be tracked');
assert.doesNotMatch(render(),/onclick="tamaoOpenAvailability\(\)">Comprar/,'No duplicate buy action during order');
ctx.globalThis.liveRuntime.orderId=null;
state.admin=true;
assert.doesNotMatch(render(),/tamao-public-nav/,'Protected Admin must not show customer desktop menu');
state.admin=false;state.merchant=true;
assert.doesNotMatch(render(),/tamao-public-nav/,'Protected partner must not show customer desktop menu');
state.merchant=false;
// Exact handler: outside click or Escape closes; in-nav click must not close.
const code=core.slice(stop,core.indexOf('function bottomNav(r){',stop));
const open=[{open:true,focus:0},{open:true,focus:0}];
const panels=open.map(x=>({get open(){return x.open},set open(v){x.open=v},
 querySelector:()=>({focus:()=>{x.focus++}})}));
const navMock={
 querySelectorAll:()=>panels.filter(x=>x.open),
 contains:target=>target?.withinNav===true
};
const documentMock={querySelector:()=>navMock,addEventListener(){}};
const events=vm.createContext({document:documentMock,globalThis:{},String});
vm.runInContext(code+'\nthis.dismiss=tamaoPublicMenuDismiss;',events);
events.dismiss({type:'pointerdown',target:{withinNav:true}});
assert.deepEqual(open.map(x=>x.open),[true,true],'Click inside nav leaves it open');
events.dismiss({type:'pointerdown',target:{withinNav:false}});
assert.deepEqual(open.map(x=>x.open),[false,false],'Click outside closes menus');
open[0].open=true;
events.dismiss({type:'keydown',key:'Escape',target:{withinNav:true}});
assert.equal(open[0].open,false,'Escape closes menu');
assert.equal(open[0].focus,1,'Escape restores focus to summary');
for(const p of [
 /\.tamao-public-nav>button\[aria-current="page"\]/,
 /\.tamao-public-nav \.tamao-nav-more\.is-current>summary/,
 /\.tamao-nav-more-panel>button\[aria-current="page"\]/,
 /@media\(min-width:760px\) and \(max-width:960px\)/,
 /@media\(max-width:759px\)/
])assert.match(css,p,'Responsive or active style missing');
assert.match(audit,/node tests\/desktop-nav-v1-985\.mjs/);
console.log('V1.985 PASS: unique desktop destinations, one commerce CTA, current route, keyboard and outside-click closing, protected portals unaffected.');
