import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const growth=readFileSync(new URL('../js/growth.js',import.meta.url),'utf8');
const start=growth.indexOf('let tamaoNetworkLastVisitAt=0;');
const end=growth.indexOf('// V1.1034',start);
assert.ok(start>0&&end>start,'Rede activity handler must be present');
const handler=growth.slice(start,end);
assert.match(handler,/networkVisit:true/);
assert.match(handler,/networkVisit\.recorded===true/);
assert.match(handler,/networkVisit\.moneyGranted===false/);
assert.match(handler,/tamaoNetworkVisitInFlight/);
assert.doesNotMatch(handler,/tamaoNetworkLastVisitAt=now;/);
assert.match(readFileSync(new URL('../.github/workflows/audit.yml',import.meta.url),'utf8'),
  /node tests\/network-visit-ack-v1-1157\.mjs/);

function harness(){
  let time=1000000000;
  let calls=0;
  let section='earn';
  let response={networkVisit:{source:'network_visit_v1_1030',recorded:true,moneyGranted:false}};
  const warnings=[];
  const context=vm.createContext({
    Date:{now:()=>time},
    route:()=>section,
    liveReady:()=>true,
    liveRuntime:{session:{user:{id:'member-A'}},networkPackage:null},
    liveInvoke:async (action,body)=>{
      assert.equal(action,'customer-summary');
      assert.deepEqual(JSON.parse(JSON.stringify(body)),{networkVisit:true});
      calls++;
      if(typeof response==='function')return response();
      return response;
    },
    render:()=>{},
    console:{warn:(...parts)=>warnings.push(parts.join(' '))}
  });
  vm.runInContext(handler,context);
  return {
    run:()=>vm.runInContext('tamaoNetworkVisitFromUi()',context),
    advance:(ms)=>{time+=ms;},
    setResponse:(value)=>{response=value;},
    setActor:(id)=>{context.liveRuntime.session.user.id=id;},
    setSection:(value)=>{section=value;},
    calls:()=>calls,
    warnings
  };
}

const flow=harness();
await flow.run();
assert.equal(flow.calls(),1,'first verified Rede opening records once');
flow.advance(12000);
await flow.run();
assert.equal(flow.calls(),1,'successful receipt coalesces a later render');
flow.advance(10*60*1000);
flow.setResponse(async()=>{throw Error('temporary Edge outage')});
await flow.run();
assert.equal(flow.calls(),2);
flow.advance(2000);
await flow.run();
assert.equal(flow.calls(),2,'failed transport must not spin');
flow.advance(14000);
flow.setResponse({networkVisit:{source:'network_visit_v1_1030',recorded:false,reason:'temporarily_unavailable'}});
await flow.run();
assert.equal(flow.calls(),3,'failed transport may retry on later explicit Rede visit');
flow.advance(16000);
flow.setResponse({networkVisit:{source:'network_visit_v1_1030',recorded:true,moneyGranted:false}});
await flow.run();
assert.equal(flow.calls(),4,'unacknowledged visit must not consume ten minutes');
flow.advance(1000);
flow.setActor('member-B');
await flow.run();
assert.equal(flow.calls(),5,'new authenticated user must not inherit prior user visit window');
flow.advance(11*60*1000);
flow.setSection('home');
await flow.run();
assert.equal(flow.calls(),5,'homepage refresh is not a Rede visit');
flow.setSection('refer');
flow.setResponse({networkVisit:{source:'network_visit_v1_1030',recorded:true,moneyGranted:true}});
await flow.run();
assert.equal(flow.calls(),6,'invalid money-granted response must not crash');
flow.advance(16000);
flow.setResponse({networkVisit:{source:'network_visit_v1_1030',recorded:true,moneyGranted:false}});
await flow.run();
assert.equal(flow.calls(),7,'untrusted award response must not mark a verified visit');

const parallel=harness();
let release;
parallel.setResponse(()=>new Promise(resolve=>{release=resolve;}));
const first=parallel.run();
await Promise.resolve();
const second=parallel.run();
await second;
assert.equal(parallel.calls(),1,'parallel rendering must not repeat request');
release({networkVisit:{source:'network_visit_v1_1030',recorded:true,moneyGranted:false}});
await first;
parallel.advance(16000);
await parallel.run();
assert.equal(parallel.calls(),1,'acknowledged parallel visit must coalesce');

assert.ok(flow.warnings.some(x=>x.includes('nenhum saldo foi creditado')));
console.log('V1.1157 PASS — Rede activity only coalesces after server proof; failure retry, user switch, concurrent render, no heartbeat or funds');
