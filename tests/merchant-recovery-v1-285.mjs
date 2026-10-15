import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const src=read('js/backend.js'),bootstrap=read('js/bootstrap.js'),
 merchant=read('js/merchant.js'),audit=read('.github/workflows/audit.yml');
new vm.Script(src,{filename:'js/backend.js'});
new vm.Script(bootstrap,{filename:'js/bootstrap.js'});
new vm.Script(merchant,{filename:'js/merchant.js'});
const take=name=>{
 const p=src.indexOf('function '+name+'(');
 assert.ok(p>=0,'Missing '+name);
 const start=src.slice(p-6,p)==='async '?p-6:p;
 const end=src.indexOf('\n}',start);
 assert.ok(end>start,'Missing closing brace '+name);
 return src.slice(start,end+2);
};
let clock=1_000_000;
const FakeDate=class extends Date{static now(){return clock}};
const merchantRuntime={
 requested:true,status:'ready',client:{},session:{access_token:'valid'},
 merchant:{online:true,merchantId:'merchant-1',memberRole:'owner'},orders:[],
 actionPending:false,pollPending:false,lastPollAt:0,lastSyncAt:null,
 lastWakeAt:0,recoveryFailures:0,nextRecoveryAt:0
};
const events=[],doc={visibilityState:'visible'};
let failure=false,refreshStarted=false;
const sandbox={
 Date:FakeDate,document:doc,merchantRuntime,merchantAlerts:{enabled:false},
 merchantReady:()=>merchantRuntime.status==='ready',
 merchantHeartbeat:async()=>{events.push('heartbeat')},
 merchantRefresh:async()=>{
  events.push('refresh');refreshStarted=true;
  if(failure){merchantRuntime.status='unavailable';throw Error('Network down');}
  merchantRuntime.status='ready';merchantRuntime.recoveryFailures=0;
  merchantRuntime.nextRecoveryAt=0;merchantRuntime.lastSyncAt=new Date(clock).toISOString();
 },
 render:()=>events.push('render')
};
const code=['merchantPollingIntervalMs','merchantRecoveryDelayMs','merchantCanRecover',
 'merchantPoll','merchantWakeSync'].map(take).join('\n')+
 '\nthis.ops={poll:merchantPoll,wake:merchantWakeSync,delay:merchantRecoveryDelayMs,canRecover:merchantCanRecover};';
vm.runInNewContext(code,sandbox);
const {poll,wake,delay,canRecover}=sandbox.ops;
assert.equal(delay(1),5000);
assert.equal(delay(2),10000);
assert.equal(delay(3),20000);
assert.equal(delay(5),60000);
assert.equal(delay(500),60000);
await poll();
assert.deepEqual(events,['heartbeat','refresh','render']);
assert.equal(merchantRuntime.lastSyncAt,new Date(clock).toISOString());
clock+=15000;failure=true;
await poll();
assert.equal(merchantRuntime.status,'unavailable');
assert.equal(merchantRuntime.recoveryFailures,1);
assert.equal(merchantRuntime.nextRecoveryAt,clock+5000);
assert.equal(canRecover(),true);
const queries=events.filter(x=>x==='refresh').length;
clock+=4000;
await poll();
assert.equal(events.filter(x=>x==='refresh').length,queries,'no retry before backoff');
clock+=1000;
await poll();
assert.equal(merchantRuntime.recoveryFailures,2);
assert.equal(merchantRuntime.nextRecoveryAt,clock+10000);
clock+=10000;failure=false;
await poll();
assert.equal(merchantRuntime.status,'ready');
assert.equal(merchantRuntime.recoveryFailures,0);
assert.equal(merchantRuntime.nextRecoveryAt,0);
assert.equal(merchantRuntime.pollPending,false);
const queriesAfterRecovery=events.filter(x=>x==='refresh').length;
clock+=11000;
doc.visibilityState='hidden';
await poll();
assert.equal(events.filter(x=>x==='refresh').length,queriesAfterRecovery,'hidden without opt-in does not poll');
sandbox.merchantAlerts.enabled=true;
clock+=5000;
await poll();
assert.equal(events.filter(x=>x==='refresh').length,queriesAfterRecovery+1,
  'explicit alerts permit bounded background tab check');
doc.visibilityState='visible';
clock+=3000;
await wake('visible');
assert.equal(events.filter(x=>x==='refresh').length,queriesAfterRecovery+2,'foreground resync');
await wake('visible');
assert.equal(events.filter(x=>x==='refresh').length,queriesAfterRecovery+2,'wake deduplicated');
clock+=3000;
await wake('online');
assert.equal(events.filter(x=>x==='refresh').length,queriesAfterRecovery+3,'online event forces new snapshot');
merchantRuntime.actionPending=true;
clock+=16000;await wake('online');
assert.equal(events.filter(x=>x==='refresh').length,queriesAfterRecovery+3,'no wake during in-flight transaction');
merchantRuntime.actionPending=false;
merchantRuntime.pollPending=true;
await wake('online');
assert.equal(events.filter(x=>x==='refresh').length,queriesAfterRecovery+3,'no duplicate polling');
merchantRuntime.pollPending=false;
merchantRuntime.status='unavailable';
merchantRuntime.session=null;
assert.equal(canRecover(),false,'no retry after lost session');
clock+=60000;await poll();
assert.equal(events.filter(x=>x==='refresh').length,queriesAfterRecovery+3,'no unauthenticated queries');

assert.match(src,/merchantRuntime\.refreshSeq\+\+;\n  merchantRuntime\.nextRecoveryAt=0;/);
assert.match(src,/if\(seq!==merchantRuntime\.refreshSeq\)return data/);
assert.match(bootstrap,/window\.addEventListener\('online'/);
assert.match(bootstrap,/document\.addEventListener\('visibilitychange'/);
assert.match(bootstrap,/if\(globalThis\.merchantPortalRequested\?\.\(\)\)merchantPoll\(\)\.catch/);
assert.match(src,/globalThis\.merchantWakeSync=merchantWakeSync/);
assert.match(merchant,/o navegador pode suspender/i);
assert.match(merchant,/Não foi possível confirmar os pedidos atuais/);
assert.match(merchant,/Até recuperar a sincronização, ações em pedidos ficam indisponíveis/);
assert.match(audit,/node tests\/merchant-recovery-v1-285.mjs/);
assert.doesNotMatch(take('merchantPoll')+take('merchantWakeSync'),/merchantPerformAction|merchantLiveAction|merchantCompleteDeliveryLive/);
console.log('V1.285 PASS — outage recovery, backoff, wake sync, hidden alerts opt-in, session protection and no order actions.');
