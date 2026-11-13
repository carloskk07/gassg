import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const bootstrap=read('js/bootstrap.js');
const merchant=read('js/merchant.js');
const index=read('index.html');
const recovery=index.match(/<template id="tamao-render-recovery">([\s\S]*?)<\/template>/)?.[1];
assert.ok(recovery,'Fallback remains in the same initially loaded HTML, not in startup JS');
const audit=read('.github/workflows/audit.yml');
for(const [name,code] of [['bootstrap',bootstrap],['merchant',merchant]])
  new vm.Script(code,{filename:name+'.js'});
function extract(source,start,end){
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Missing source bounds '+start);
 return source.slice(a,b);
}
// Inject failures into the real render() implementation, rather than
// only checking strings. Reload is a user action, never automatically invoked.
const renderSource=extract(bootstrap,'let renderLock=false;\nfunction render(){',
 'window.addEventListener(\'hashchange\'');
function brokenPage(role){
 const app={innerHTML:''};
 let focusCount=0,fail=true,errors=0;
 const ctx=vm.createContext({
  globalThis:{CHAMA_PORTAL_ROLE:role,adminPortalRequested:()=>role==='admin'},
  document:{
   title:'Previously loaded',
   querySelector:selector=>selector==='#app'?app:null,
   getElementById:id=>id==='tamao-render-recovery'?{innerHTML:recovery}:id==='tamao-recovery-title'?{
    focus:opts=>{assert.equal(opts.preventScroll,true);focusCount++}
   }:null
  },
  console:{error:()=>errors++},
  adminPage:()=>{if(fail)throw Error('test simulated rendering error');return '<main>Admin recovered</main>'},
  housekeeping:()=>{if(fail)throw Error('test simulated rendering error')},
 });
 vm.runInContext(renderSource+'\nthis.run=render;',ctx);
 ctx.run();
 assert.match(app.innerHTML,/<h1 id="tamao-recovery-title"[^>]*>Não foi possível abrir esta tela<\/h1>/);
 assert.match(app.innerHTML,/role="alert"/);
 assert.match(app.innerHTML,/onclick="location.reload\(\)"/);
 assert.match(app.innerHTML,/Antes de repetir um pedido ou pagamento, confira/);
 assert.doesNotMatch(app.innerHTML,/test simulated rendering error|<script|stack trace/i);
 assert.equal(ctx.document.title,'TAMÃO — tela indisponível');
 assert.equal(focusCount,1,'accessible focus must reach the recovery title');
 assert.equal(errors,1,'only the console receives the diagnostic');
 assert.equal((app.innerHTML.match(/<main /g)||[]).length,1);
 // A second render cannot be permanently blocked after an exception.
 if(role==='admin'){
  fail=false;ctx.run();
  assert.equal(app.innerHTML,'<main>Admin recovered</main>');
 }else{
  assert.match(app.innerHTML,/Recarregar página/);
 }
}
brokenPage('admin');
brokenPage('merchant');
brokenPage('customer');

// The same entry used by real Partner shortcuts must open all enclosing
// disclosures, focus its own control and not invoke any financial action.
const jumpSource=extract(merchant,'function merchantWorkspaceJump(area){',
 'function merchantWorkspaceNeedsGuide(');
const called=[];
const ancestor={tagName:'DETAILS',open:false,parentElement:null};
const intermediate={tagName:'DETAILS',open:false,parentElement:ancestor};
const summary={tagName:'SUMMARY',focus:opts=>called.push(['focus',opts.preventScroll])};
const panel={tagName:'DETAILS',open:false,parentElement:intermediate,
 querySelector:selector=>selector==='summary'?summary:null,
 scrollIntoView:opts=>called.push(['scroll',opts.behavior])};
const dom={getElementById:id=>id==='merchant-workspace-finance'?panel:null};
const context=vm.createContext({document:dom,globalThis:{
 matchMedia:()=>({matches:true})
}});
vm.runInContext(jumpSource+'\nthis.jump=merchantWorkspaceJump;',context);
assert.equal(context.jump('finance'),true);
assert.equal(panel.open,true);
assert.equal(intermediate.open,true);
assert.equal(ancestor.open,true);
assert.deepEqual(called,[['scroll','auto'],['focus',true]]);
called.length=0;context.globalThis.matchMedia=()=>({matches:false});
assert.equal(context.jump('finance'),true);
assert.deepEqual(called,[['scroll','smooth'],['focus',true]]);
assert.equal(context.jump('payments'),false);
assert.match(audit,/node tests\/authenticated-error-recovery-v1-978\.mjs/);
console.log('V1.978 PASS: real render error boundary, retry without side effects, nested workspace keyboard focus.');
