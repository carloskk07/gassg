import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../js/backend.js',import.meta.url),'utf8');
const sliceFunction=name=>{
  const functionStart=source.indexOf('function '+name+'(');
  const start=source.slice(functionStart-6,functionStart)==='async '?functionStart-6:functionStart;
  assert.ok(start>=0,'função '+name+' precisa existir');
  const finish=source.indexOf('\n}',start);
  assert.ok(finish>start,'função '+name+' deve terminar em linha própria');
  return source.slice(start,finish+2);
};
const helper=sliceFunction('merchantPollingIntervalMs');
const polling=sliceFunction('merchantPoll');

function harness({online=true,orders=[],visibility='visible'}={}){
  let clock=1_000_000;
  const events=[];
  const merchantRuntime={merchant:{online},orders,actionPending:false,pollPending:false,lastPollAt:0};
  const sandbox={
    merchantRuntime,document:{visibilityState:visibility},
    Date:{now:()=>clock},
    merchantReady:()=>true,
    merchantHeartbeat:async()=>{events.push('heartbeat');return true;},
    merchantRefresh:async()=>{events.push('refresh');return true;},
    render:()=>events.push('render'),
  };
  const fns=vm.runInNewContext(helper+'\n'+polling+'\n;({merchantPollingIntervalMs,merchantPoll})',sandbox);
  return {
    poll:fns.merchantPoll,
    interval:(orders,online)=>fns.merchantPollingIntervalMs(orders,online),
    runtime:merchantRuntime,
    events,
    advance:ms=>{clock+=ms;},
    setVisibility:value=>{sandbox.document.visibilityState=value;},
    setReady:value=>{sandbox.merchantReady=()=>value;},
  };
}

const awaiting=[{status:'OFFERED_TO_MERCHANT'}];
const delivery=[{status:'PREPARING'}];
const delivered=[{status:'SETTLED'}];
const baseline=harness();
assert.equal(baseline.interval(awaiting,true),5000,'aceite pendente continua em 5s');
assert.equal(baseline.interval(delivery,true),10000,'entrega ativa em 10s');
assert.equal(baseline.interval([],true),15000,'revenda online sem pedido em 15s');
assert.equal(baseline.interval(delivered,true),15000,'pedido concluído não deve simular urgência');
assert.equal(baseline.interval([],false),60000,'painel offline ocioso em 60s');
assert.equal(baseline.interval(delivery,false),10000,'pedido em andamento mantém acompanhamento mesmo offline');

await baseline.poll();
assert.deepEqual(baseline.events,['heartbeat','refresh','render'],'primeira sincronização mantém presença antes do estado');
baseline.advance(5000);
await baseline.poll();
assert.equal(baseline.events.length,3,'painel online ocioso não consulta a cada cinco segundos');
baseline.advance(10000);
await baseline.poll();
assert.equal(baseline.events.filter(x=>x==='refresh').length,2,'15s permite nova consulta');
baseline.runtime.orders=awaiting;
baseline.advance(5000);
await baseline.poll();
assert.equal(baseline.events.filter(x=>x==='refresh').length,3,'aceite pendente preserva o ciclo rápido');
baseline.runtime.orders=delivery;
baseline.advance(5000);
await baseline.poll();
assert.equal(baseline.events.filter(x=>x==='refresh').length,3,'entrega não força ciclo de 5s');
baseline.advance(5000);
await baseline.poll();
assert.equal(baseline.events.filter(x=>x==='refresh').length,4,'entrega atualiza com 10s');

const idle=harness({online:false});
await idle.poll();
assert.deepEqual(idle.events,['refresh','render'],'offline não deve manter heartbeat');
idle.advance(30000);
await idle.poll();
assert.equal(idle.events.filter(x=>x==='refresh').length,1,'offline não consulta em 30s');
idle.advance(30000);
await idle.poll();
assert.equal(idle.events.filter(x=>x==='refresh').length,2,'offline mantém observabilidade em 60s');
idle.runtime.actionPending=true;
idle.advance(60000);
await idle.poll();
assert.equal(idle.events.filter(x=>x==='refresh').length,2,'ação em curso não pode competir com polling');
idle.runtime.actionPending=false;
idle.setVisibility('hidden');
await idle.poll();
assert.equal(idle.events.filter(x=>x==='refresh').length,2,'aba oculta não consulta');
idle.setVisibility('visible');
await idle.poll();
assert.equal(idle.events.filter(x=>x==='refresh').length,3,'reabertura de aba retoma sincronização vencida');

assert.ok(source.includes('const CUSTOMER_FINANCIAL_REFRESH_MS=5*60*1000;'));
assert.ok(source.includes('const CUSTOMER_MARKET_REFRESH_MS=3*60*1000;'));
assert.ok(source.includes('now-liveRuntime.lastFinancialSyncAttemptAt<CUSTOMER_FINANCIAL_REFRESH_MS'));
assert.ok(source.includes('now-liveRuntime.lastMarketStatusAt<CUSTOMER_MARKET_REFRESH_MS'));
assert.ok(source.includes('await liveSyncFinancialProfile({force:true})'),'conclusão e recuperação seguem com refresh financeiro imediato');
assert.ok(source.includes('if(now-merchantRuntime.lastHeartbeatAt<60000)return null;'),'heartbeat não pode atrasar além da periodicidade existente');
assert.ok(source.includes('await merchantHeartbeat();\n    await merchantRefresh({silent:true});'),'presença deve preceder consulta operacional');

const hoursPerDay=8, days=30;
const previousCalls=(hoursPerDay*3600/5 + hoursPerDay*3600/60)*days;
const optimizedCalls=(hoursPerDay*3600/15 + hoursPerDay*3600/60)*days;
assert.equal(previousCalls,187200);
assert.equal(optimizedCalls,72000);
assert.ok(1-optimizedCalls/previousCalls>0.60,'redução simulada online ociosa deve superar 60%');
console.log('V1.150 passou: prioridade em aceite, acompanhamento ativo, heartbeat, idle e economia teórica de 61,5%.');
