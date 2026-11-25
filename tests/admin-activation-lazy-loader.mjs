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
let timerId=0;
const timers=new Map();
const ctx=vm.createContext({
  setTimeout:(fn,ms)=>{assert.equal(ms,20000);timers.set(++timerId,fn);return timerId;},
  clearTimeout:id=>timers.delete(id),
  document:{currentScript:{src:'https://admin.tamao.com.br/js/admin.js?v=sha-test'},baseURI:'https://admin.tamao.com.br/',createElement:()=>({remove(){this.removed=true}}),head},
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
assert.equal(timers.size,1);
[...timers.values()][0]();
await Promise.all([first,second]);
assert.equal(timers.size,0);
assert.equal(scripts[0].removed,true,'stalled script must be removed');
assert.match(ctx.view(),/Tentar novamente/);
const retry=ctx.invoke();
assert.equal(scripts.length,2,'Failure must allow a retry');
ctx.adminActivationLoad=async()=>{calls++;return 'loaded'};
ctx.adminActivationDeskView=()=>'<p>Ativações prontas</p>';
scripts[0].onload();scripts[0].onerror();
assert.equal(timers.size,1,'late callbacks cannot settle current retry');
scripts[1].onload();
assert.equal(timers.size,0);
assert.equal(await retry,'loaded');
assert.equal(calls,1);
assert.equal(await ctx.invoke(),'loaded');
assert.equal(scripts.length,2,'No duplicate script after successful load');
section='overview';
assert.equal(await ctx.invoke(),null,'Navigation away must not load data');
ready=false;
assert.equal(await ctx.invoke(),null,'Unauthenticated must never load data');
console.log('Admin activations lazy loading, version pin, failure, retry and auth guard passed.');
