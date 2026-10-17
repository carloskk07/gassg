import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const src=read('js/merchant.js');
const css=read('css/components.css');
const backend=read('js/backend.js');
const audit=read('.github/workflows/audit.yml');
new vm.Script(src,{filename:'js/merchant.js'});
const cut=name=>{
  const begin=src.indexOf('function '+name+'(');
  const end=src.indexOf('\n}',begin);
  assert.ok(begin>=0&&end>begin,'Missing '+name);
  return src.slice(begin,end+2);
};
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const now=Date.parse('2026-10-16T23:30:00.000Z');
const iso=offset=>new Date(now+offset).toISOString();
const model=vm.createContext({esc,Date,Math,Number});
vm.runInContext(cut('merchantOrderListEvidence')+'\n'+cut('merchantOrderListRecovery')+
  '\nthis.proof=merchantOrderListEvidence;this.recovery=merchantOrderListRecovery;',model);
const merchant={merchantId:'merchant-A',memberRole:'owner',name:'Teste'};
const rt={
  status:'ready',merchant,selectedMerchantId:'merchant-A',
  lastSyncAt:iso(-55000),orders:[{status:'OFFERED_TO_MERCHANT'}],
  actionPending:false
};
const proof=(changes={},t=now)=>model.proof({...rt,...changes},t);
assert.equal(proof().fresh,true);
assert.equal(proof({lastSyncAt:iso(-119999)}).fresh,true);
assert.equal(proof({lastSyncAt:iso(-120001)}).kind,'stale');
assert.match(proof({lastSyncAt:iso(-360000)}).label,/há 6 min/);
assert.equal(proof({lastSyncAt:null}).kind,'unverified');
assert.equal(proof({lastSyncAt:'bad'}).kind,'unverified');
assert.equal(proof({lastSyncAt:iso(61000)}).kind,'unverified');
assert.equal(proof({status:'unavailable'}).fresh,false);
assert.equal(proof({selectedMerchantId:'merchant-B'}).kind,'mismatch');
assert.equal(proof({merchant:null}).fresh,false);
assert.equal(proof({lastSyncAt:iso(-2*60000)}).fresh,true);
assert.equal(proof({lastSyncAt:iso(-2*60000-1)}).fresh,false);
assert.equal(model.recovery({...rt,lastSyncAt:new Date().toISOString()}),'','fresh evidence must not produce an alarming notice');
let notice=model.recovery({...rt,lastSyncAt:new Date(Date.now()-300000).toISOString()});
assert.match(notice,/Atualize a lista antes de atender/);
assert.match(notice,/1 pedido constava/);
assert.match(notice,/Atualizar pedidos/);
assert.doesNotMatch(notice,/merchantLiveAction|merchantPerformAction|merchantLiveDeliver/);
assert.ok(notice.includes('onclick="merchantLiveRefresh()"'));
assert.match(model.recovery({...rt,lastSyncAt:new Date(Date.now()-300000).toISOString(),actionPending:true}),/disabled/);
assert.match(model.recovery({...rt,lastSyncAt:null,orders:[]}),/Não há confirmação recente/);

const driverCtx=vm.createContext({
  esc,Date,Math,Number,globalThis:{},
  shell:html=>html,merchantAlertControl:()=>'<div>Alertas</div>',
  merchantOrderQueueView:()=>
    '<div class="test-driver-actions"><button onclick="merchantLiveAction(\'x\',\'accept\')">Aceitar</button></div>',
  merchantDeliveryBoardView:()=>'<div class="test-board-actions"><button>Entregar</button></div>'
});
vm.runInContext(cut('merchantOrderListEvidence')+'\n'+cut('merchantOrderListRecovery')+
 '\n'+cut('merchantDriverLivePage')+'\nthis.driver=merchantDriverLivePage;',driverCtx);
const driver={
 status:'ready',merchant:{merchantId:'merchant-A',memberRole:'driver',name:'Revenda'},
 selectedMerchantId:'merchant-A',lastSyncAt:new Date().toISOString(),
 orders:[{status:'OUT_FOR_DELIVERY'}],actionPending:false
};
const current=driverCtx.driver(driver);
assert.match(current,/test-driver-actions/);
assert.match(current,/test-board-actions/);
driver.lastSyncAt=new Date(Date.now()-5*60000).toISOString();
const stale=driverCtx.driver(driver);
assert.match(stale,/Atualize a lista antes de atender/);
assert.doesNotMatch(stale,/test-driver-actions|test-board-actions/);
assert.match(stale,/Atualizar pedidos/);
assert.match(stale,/Visão restrita por atribuição/);
const livePage=cut('merchantLivePage');
assert.match(livePage,/const orderEvidence=merchantOrderListEvidence\(rt\)/);
assert.match(livePage,/orderEvidence\.fresh\?merchantDailyOverview\(rt,orders\):/);
assert.match(livePage,/merchant-queue-unverified-intro/);
assert.match(livePage,/orderEvidence\.fresh\?merchantDeliveryBoardView\(rt,orders\):''/);
assert.match(livePage,/orderEvidence\.fresh\?merchantOrderQueueView\(orders\):merchantOrderListRecovery\(rt\)/);
assert.match(livePage,/orderEvidence\.fresh\?merchantDeliveryAttentionView\(rt\):''/);
assert.match(livePage,/orderEvidence\.fresh\?merchantWorkspaceOrientation\(rt,/);
assert.ok(backend.includes('merchantRuntime.lastSyncAt=new Date().toISOString()'),
 'merchant orders must be stamped only on a successful accepted refresh');
const refresh=backend.slice(backend.indexOf('async function merchantRefresh('),
 backend.indexOf('async function merchantSelectLive(',backend.indexOf('async function merchantRefresh(')));
assert.ok(refresh.indexOf('merchantRuntime.lastSyncAt=new Date().toISOString()')>
 refresh.indexOf('merchantRuntime.orders=data.orders??[]'));
assert.ok(refresh.indexOf('if(seq!==merchantRuntime.refreshSeq)return data;')<
 refresh.indexOf('merchantRuntime.lastSyncAt=new Date().toISOString()'),
 'discarded requests never certify an order list');
for(const name of ['.merchant-orders-recovery','#merchant-live-orders',
 '.merchant-orders-recovery button:focus-visible','@media(max-width:540px)']){
 assert.ok(css.includes(name),'missing accessible mobile stale status '+name);
}
assert.ok(audit.includes('node tests/merchant-freshness-v1-354.mjs'));
console.log('TAMÃO V1.354 PASS — stale order snapshots, wrong merchant, driver boundaries and verified safe refresh.');
