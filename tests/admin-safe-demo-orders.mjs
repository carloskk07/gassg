import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
new vm.Script(src,{filename:'js/admin.js'});
const begin=src.indexOf('// Browser-only, superadmin-accessible presentation of the order lifecycle.');
const end=src.indexOf('function adminControlTower(d){',begin);
assert.ok(begin>=0&&end>begin,'demo must stay within existing Admin Orders section');
const demo=src.slice(begin,end);
assert.doesNotMatch(demo,/adminInvoke\s*\(|\.rpc\s*\(|\bfetch\s*\(|localStorage|\.from\s*\(|create-order|merchant_action|complete-delivery/,
 'visual simulator must make ZERO actual order, payment or backend requests');
assert.match(src,/\$\{adminOrderDemoView\(\)\}/,'reuse the current Admin Orders section');
assert.match(src,/adminOrderDemoForget\(\); \/\/ also purge the only in-tab synthetic order state/,
 'logout must erase synthetic state');
assert.match(demo,/sessionStorage\.setItem\(ADMIN_ORDER_DEMO_KEY/);
assert.match(demo,/sessionStorage\.removeItem\(ADMIN_ORDER_DEMO_KEY/);
const stored=new Map();
const sessionStorage={
 getItem:key=>stored.get(key)||null,
 setItem:(key,val)=>stored.set(key,String(val)),
 removeItem:key=>stored.delete(key)
};
const state={section:'orders',session:{user:{id:'11111111-1111-4111-8111-111111111111'}}};
let ready=true,role='superadmin',draws=0;
const input=new Map(),checked=new Map();
function create(){
 const ctx=vm.createContext({
  adminRuntime:state,adminReady:()=>ready,adminCurrentRole:()=>role,
  adminOrderStatusLabel:status=>({
   OFFERED_TO_MERCHANT:'AGUARDANDO PARCEIRO',PREPARING:'PREPARANDO',
   OUT_FOR_DELIVERY:'A CAMINHO',ARRIVING:'CHEGANDO',SETTLED:'CONCLUÍDO'
  })[status]||status,
  adminMoney:c=>'R$ '+(c/100).toFixed(2),
  esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;'),
  sessionStorage,
  document:{getElementById:id=>{
    if(id.startsWith('admin-order-demo-pin-'))return {value:input.get(id)||''};
    return {checked:checked.get(id)===true};
  }},
  Date,Number,JSON,render:()=>{draws++}
 });
 vm.runInContext(demo+';this.demo={create:adminOrderDemoCreate,advance:adminOrderDemoAdvance,'+
 'act:adminOrderDemoAction,role:adminOrderDemoSelectRole,clear:adminOrderDemoClear,'+
 'forget:adminOrderDemoForget,view:adminOrderDemoView};',ctx);
 return ctx.demo;
}
let lab=create();
assert.match(lab.view(),/Pedidos de teste — sem revendas reais/);
assert.match(lab.view(),/NÃO SÃO PEDIDOS REAIS/);
assert.doesNotMatch(lab.view(),/data-demo-only="true"/);
lab.create();
assert.equal((lab.view().match(/data-demo-only="true"/g)||[]).length,3);
assert.match(lab.view(),/Gás P13/);
assert.match(lab.view(),/Água 20 L/);
assert.match(lab.view(),/Carvão 4 kg/);
assert.match(lab.view(),/R\$ 115\.90/);
assert.match(lab.view(),/R\$ 119\.90/);
assert.match(lab.view(),/nenhuma revenda foi notificada/);
lab.advance('DEMO-001');
assert.match(lab.view(),/PREPARANDO/);
assert.ok(stored.has('tamao-admin-orders-demo-v2'),'the demo must persist in-tab');
lab=create(); // browser refresh: same sessionStorage, NEW script context
assert.match(lab.view(),/PREPARANDO/,'refresh must preserve the correct demo state');
lab.role('merchant');
assert.match(lab.view(),/Aceitar pedido/);
lab.act('DEMO-002','accept');
assert.match(lab.view(),/PREPARANDO/);
lab.act('DEMO-002','dispatch');
lab.act('DEMO-002','arriving');
assert.match(lab.view(),/PIN do cliente/);
lab.act('DEMO-002','complete'); // no PIN / no attestation
assert.match(lab.view(),/PIN fictício incorreto/);
input.set('admin-order-demo-pin-DEMO-002','0000');
checked.set('admin-order-demo-paid-DEMO-002',true);
lab.act('DEMO-002','complete');
assert.match(lab.view(),/PIN fictício incorreto/);
input.set('admin-order-demo-pin-DEMO-002','5937');
lab.act('DEMO-002','complete');
assert.match(lab.view(),/Demonstração concluída/);
const completedView=lab.view();
lab.act('DEMO-002','complete');
assert.equal(lab.view(),completedView,'settled demo may never settle twice');
lab.role('customer');
assert.match(lab.view(),/Cancelar pedido fictício/);
lab.act('DEMO-003','cancel');
assert.match(lab.view(),/Demonstração cancelada/);
lab.role('merchant');
lab.act('DEMO-003','accept'); // cannot accept a cancelled order
assert.match(lab.view(),/Demonstração cancelada/);
lab.role('customer');
lab.act('DEMO-001','dispatch'); // customer cannot dispatch
lab.role('admin');
lab.advance('DEMO-001');
for(let i=0;i<3;i++)lab.advance('DEMO-001');
assert.equal((lab.view().match(/Demonstração concluída/g)||[]).length,2);
lab=create();
assert.equal((lab.view().match(/data-demo-only="true"/g)||[]).length,3,
 'same fictitious orders survive another reload');
lab.role('customer');lab.role('merchant');
assert.doesNotMatch(lab.view(),/Código de entrega fictício \(só na visão Cliente\)/);
const storageSnapshot=stored.get('tamao-admin-orders-demo-v2');
assert.doesNotMatch(storageSnapshot,/4826|5937|6148|11590|Gás P13/,
 'storage may contain only step indices and generic synthetic status, not PIN or catalog');
state.session.user.id='22222222-2222-4222-8222-222222222222';
assert.doesNotMatch(lab.view(),/DEMO-002/,'new account must not inherit past account demo');
lab.create();
assert.match(lab.view(),/DEMO-002/,'new superadmin may create a separate local demo');
role='viewer';
assert.equal(lab.view(),'','non-superadmin cannot view demo');
lab.clear();
role='superadmin';
assert.match(lab.view(),/DEMO-002/,'unauthorized clearing cannot mutate saved state');
ready=false;
assert.equal(lab.view(),'','logged-out account cannot open demo');
ready=true;
state.section='finance';
assert.equal(lab.view(),'','demo is scoped to Admin Orders');
state.section='orders';
lab.clear();
assert.doesNotMatch(lab.view(),/DEMO-002/);
assert.equal(stored.has('tamao-admin-orders-demo-v2'),false);
lab.create();lab.forget();
assert.equal(stored.size,0,'signout must purge the in-tab synthetic store');
assert.ok(draws>8);
console.log('PASS: 3 shared synthetic orders, 3 perspectives, PIN+cash simulation, cancellations, in-tab reload, identity isolation and ZERO backend/PSP operations.');
