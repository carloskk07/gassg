import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
new vm.Script(src,{filename:'js/admin.js'});
const begin=src.indexOf('// Explicitly CLIENT-ONLY orders demo');
const end=src.indexOf('function adminControlTower(d){',begin);
assert.ok(begin>=0&&end>begin,'demo must be in the existing Admin Orders section');
const demo=src.slice(begin,end);
assert.doesNotMatch(demo,/adminInvoke\s*\(|\.rpc\s*\(|\bfetch\s*\(|localStorage|sessionStorage|\.from\s*\(|create-order|paymentConfirmed\s*:/,
 'the demo cannot mutate production or request payment');
assert.match(src,/\$\{adminOrderDemoView\(\)\}/,'the genuine Admin Orders view must expose the demo');
assert.match(src,/adminOrderDemoState=null; \/\/ discard visual-only orders on sign-out/,
 'sign-out must erase the synthetic order list');
const state={section:'orders',session:{user:{id:'11111111-1111-4111-8111-111111111111'}}};
let ready=true,role='superadmin',draws=0;
const ctx=vm.createContext({
 adminRuntime:state,adminReady:()=>ready,adminCurrentRole:()=>role,
 adminOrderStatusLabel:status=>({
  OFFERED_TO_MERCHANT:'AGUARDANDO PARCEIRO',
  PREPARING:'PREPARANDO',
  OUT_FOR_DELIVERY:'A CAMINHO',
  ARRIVING:'CHEGANDO',
  SETTLED:'CONCLUÍDO'
 })[status]||status,
 adminMoney:cents=>'R$ '+(cents/100).toFixed(2),
 esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;'),
 render:()=>{draws++}
});
vm.runInContext(demo+';this.demo={create:adminOrderDemoCreate,advance:adminOrderDemoAdvance,clear:adminOrderDemoClear,view:adminOrderDemoView};',ctx);
let html=ctx.demo.view();
assert.match(html,/Pedidos de teste — sem revendas reais/);
assert.match(html,/NÃO SÃO PEDIDOS REAIS/);
assert.doesNotMatch(html,/data-demo-only="true"/,'empty initial session');
ctx.demo.create();
html=ctx.demo.view();
assert.equal((html.match(/data-demo-only="true"/g)||[]).length,3,'create exactly three synthetic orders');
assert.match(html,/DEMO-001/);
assert.match(html,/Gás P13/);
assert.match(html,/Água 20 L/);
assert.match(html,/Carvão 4 kg/);
assert.match(html,/AGUARDANDO PARCEIRO/);
assert.match(html,/R\$ 115\.90/);
assert.match(html,/nenhuma revenda foi notificada/);
ctx.demo.advance('DEMO-001');
assert.match(ctx.demo.view(),/PREPARANDO/);
for(let n=0;n<3;n++)ctx.demo.advance('DEMO-001');
assert.match(ctx.demo.view(),/Demonstração concluída/);
const finished=ctx.demo.view();
ctx.demo.advance('DEMO-001');
assert.equal(ctx.demo.view(),finished,'terminal demo order cannot advance again');
ctx.demo.advance('INVALID-ID');
assert.equal(ctx.demo.view(),finished,'unknown IDs cannot mutate the demo');
const previous=ctx.demo.view();
state.session.user.id='22222222-2222-4222-8222-222222222222';
ctx.demo.advance('DEMO-002');
assert.doesNotMatch(ctx.demo.view(),/DEMO-002/,'another Admin account cannot see previous session demo');
ctx.demo.create();
assert.match(ctx.demo.view(),/DEMO-002/,'new account can create only its own demo');
role='viewer';
assert.equal(ctx.demo.view(),'','non-superadmin cannot view orders demo');
ctx.demo.clear();
role='superadmin';
assert.match(ctx.demo.view(),/DEMO-002/,'unauthorized clear must not mutate demo');
ready=false;
assert.equal(ctx.demo.view(),'','logged-out sessions cannot see demo');
ready=true;
state.section='finance';
assert.equal(ctx.demo.view(),'','outside Orders section cannot use this demo');
state.section='orders';
ctx.demo.clear();
assert.doesNotMatch(ctx.demo.view(),/DEMO-002/);
assert.ok(draws>3,'user interactions should re-render the Admin');
console.log('PASS: three safe client-only demo orders, role/session isolation, progressive statuses, terminal freeze, logout reset and zero backend calls.');
