import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {splitAdminAcquisition,splitAdminOwnerFinanceCore} from '../scripts/build-live-portals.mjs';
const original=fs.readFileSync(new URL('../js/admin-acquisition.js',import.meta.url),'utf8');
const sliced=splitAdminAcquisition(original);
const {startup,ownerFinance,prefix,leads}=splitAdminOwnerFinanceCore(sliced.core);
assert.equal(prefix+ownerFinance+leads,sliced.core);
assert.ok(ownerFinance.length>200000,'Chunk must isolate meaningful owner finance weight');
assert.ok(startup.length<140000,'Initial acquisition must be minimal');
assert.ok(leads.includes("typeof adminOwnerFinanceWorkspaceSection==='function'"));
assert.throws(()=>splitAdminOwnerFinanceCore('function noop(){}'),/boundary/);
const bootstrap=fs.readFileSync(new URL('../js/bootstrap.js',import.meta.url),'utf8');
assert.ok(bootstrap.includes("typeof adminOwnerFinanceLoadFromUi==='function'?{"),
  'Deferred owner tools must not be dereferenced before their script exists');
const src=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
const start=src.indexOf('// Optional read-only activations desk.');
const end=src.indexOf('function adminSetSection(section){',start);
assert.ok(start>0&&end>start,'Admin load boundary missing');
let section='overview',role='superadmin',actor='owner',ready=true,renders=0;
const scripts=[];
let timerId=0;
const timers=new Map();
const ctx=vm.createContext({
  setTimeout:(fn,ms)=>{assert.equal(ms,20000);timers.set(++timerId,fn);return timerId;},
  clearTimeout:id=>timers.delete(id),
  document:{currentScript:{src:'https://admin.tamao.com.br/js/admin.js?v=sha-test'},
    baseURI:'https://admin.tamao.com.br/',createElement:()=>({remove(){this.removed=true}}),
    head:{appendChild:s=>scripts.push(s)}},
  location:{origin:'https://admin.tamao.com.br'},
  adminRuntime:{get section(){return section},session:{user:{get id(){return actor}}}},
  adminReady:()=>ready,adminCurrentRole:()=>role,adminRoleCanSection:()=>role==='superadmin',
  adminOwnerFinanceWorkspaceSection:undefined,render:()=>{renders++},
  esc:s=>String(s),Promise,Error,String,URL
});
vm.runInContext(src.slice(start,end)+'\nthis.load=adminOwnerFinanceLoadOnDemand;this.view=adminOwnerFinanceFallbackView;this.url=adminOwnerFinanceModuleUrl;',ctx);
assert.equal(ctx.url,'https://admin.tamao.com.br/js/admin-owner-finance.js?v=sha-test');
assert.equal(await ctx.load(),null);
assert.equal(scripts.length,0,'Overview must not load owner operations');
section='growth';role='operations';
assert.equal(await ctx.load(),null);
assert.equal(scripts.length,0,'Operations role cannot download superadmin owner tools');
role='superadmin';
const first=ctx.load(),concurrent=ctx.load();
assert.equal(scripts.length,1,'Duplicate clicks must share a single script download');
assert.equal(scripts[0].src,ctx.url);
assert.match(ctx.view(),/Carregando/);
assert.equal(timers.size,1);
[...timers.values()][0]();
await Promise.all([first,concurrent]);
assert.equal(timers.size,0);
assert.equal(scripts[0].removed,true,'stalled script must be removed');
assert.match(ctx.view(),/Tentar novamente/);
const retry=ctx.load();
assert.equal(scripts.length,2,'Network errors must be retryable');
ctx.adminOwnerFinanceWorkspaceSection=()=>'<p>Gestão</p>';
scripts[0].onload();scripts[0].onerror();
assert.equal(timers.size,1,'late callbacks cannot settle current retry');
scripts[1].onload();
assert.equal(timers.size,0);
assert.equal(await retry,true);
assert.equal(await ctx.load(),true);
assert.equal(scripts.length,2,'Do not re-add loaded script');
role='operations';
assert.equal(await ctx.load(),null);
ready=false;
assert.equal(await ctx.load(),null,'Authentication gate before actions');
assert.ok(renders>0);
console.log('Admin owner finance split, role gating, shared loading, retry and SHA pin passed.');
