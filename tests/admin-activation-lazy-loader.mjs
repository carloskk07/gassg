import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
const begin=source.indexOf('// Optional read-only activations desk.');
const end=source.indexOf('function adminSetSection(section){',begin);
assert.ok(begin>0&&end>begin);
const loader=source.slice(begin,end);
const scripts=[],head={appendChild(script){scripts.push(script)}};
let section='activations',renders=0,calls=0,ready=true;
const ctx=vm.createContext({
  document:{currentScript:{src:'https://admin.tamao.com.br/js/admin.js?v=sha-test'},baseURI:'https://admin.tamao.com.br/',createElement:()=>({}),head},
  location:{origin:'https://admin.tamao.com.br'},
  adminReady:()=>ready,adminRoleCanSection:()=>true,
  adminRuntime:{get section(){return section}},render:()=>{renders++},
  adminActivationLoad:undefined,adminActivationDeskView:undefined,
  esc:s=>String(s),URL,Promise,Error,String
});
vm.runInContext(loader+'\nthis.invoke=adminActivationLoadOnDemand;this.view=adminActivationsFallbackView;this.url=adminActivationModuleUrl;',ctx);
assert.equal(ctx.url,'https://admin.tamao.com.br/js/admin-activations.js?v=sha-test');
const first=ctx.invoke(),second=ctx.invoke();
assert.equal(scripts.length,1,'Concurrent navigations must share one script');
assert.equal(scripts[0].src,ctx.url);
assert.match(ctx.view(),/Carregando/);
scripts[0].onerror();
await Promise.all([first,second]);
assert.match(ctx.view(),/Tentar novamente/);
const retry=ctx.invoke();
assert.equal(scripts.length,2,'Failure must allow a retry');
ctx.adminActivationLoad=async()=>{calls++;return 'loaded'};
ctx.adminActivationDeskView=()=>'<p>Ativações prontas</p>';
scripts[1].onload();
assert.equal(await retry,'loaded');
assert.equal(calls,1);
assert.equal(await ctx.invoke(),'loaded');
assert.equal(scripts.length,2,'No duplicate script after successful load');
section='overview';
assert.equal(await ctx.invoke(),null,'Navigation away must not load data');
ready=false;
assert.equal(await ctx.invoke(),null,'Unauthenticated must never load data');
console.log('Admin activations lazy loading, version pin, failure, retry and auth guard passed.');
