import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const backend=read('js/backend.js');
const server=read('supabase/functions/merchant-push-registration/index.ts');
const ci=read('.github/workflows/audit.yml');
const extract=(start,end)=>{
 const a=backend.indexOf('async function '+start+'('),b=backend.indexOf('\n'+end,a);
 assert.ok(a>=0&&b>a,'missing '+start);
 return backend.slice(a,b);
};
const code=[
 extract('merchantPushCheckLive','async function merchantPushDiagnoseServerLive'),
 extract('merchantPushEnableLive','// Push test cannot alter orders or enable Cron.'),
 extract('merchantPushDisableLive','function merchantOriginSafe')
].join('\n');
new vm.Script(code,{filename:'merchant-push-state-machine'});

function gate(){let release;return {promise:new Promise(r=>release=r),release};}
const ENDPOINT='https://push.example.com/endpoint-1';
function setup({permission='granted',initialSubscription=false,
  serverReply=null,subscribeGate=null,unsubscribeGate=null,configGate=null,
  permissionGate=null,getSubGate=null,localRemovalWorks=true}={}){
 const calls=[],events=[];
 const rt={requested:true,status:'ready',
  merchant:{merchantId:'shop-A',memberRole:'owner'},
  selectedMerchantId:'shop-A',session:{user:{id:'user-A'}},
  accessEpoch:1};
 const push={available:true,checked:true,publicKey:'key-A',
  subscribed:initialSubscription,merchantId:'shop-A',
  togglePending:false,checking:false,checkToken:null};
 const notification={permission,
  requestPermission:async()=>{
   events.push('requestPermission');
   if(permissionGate)await permissionGate.promise;
   notification.permission='granted';
   return 'granted';
  }};
 let sub=null;
 const makeSub=()=>{
  const result={endpoint:ENDPOINT,
   options:{applicationServerKey:new Uint8Array([1,2,3])},
   toJSON:()=>({endpoint:ENDPOINT,keys:{p256dh:'public-test',auth:'auth-test'}}),
   unsubscribe:async()=>{
    events.push('browser-unsubscribe');
    if(!localRemovalWorks)return false;
    if(sub===result)sub=null;
    return true;
   }};
  return result;
 };
 if(initialSubscription)sub=makeSub();
 const registration={pushManager:{
  getSubscription:async()=>{
   events.push('read-browser-subscription');
   if(getSubGate)await getSubGate.promise;
   return sub;
  },
  subscribe:async()=>{
   events.push('browser-subscribe');
   sub=makeSub();return sub;
  }}};
 let serverCalls=0;
 const invoke=async(_,request)=>{
  calls.push(request);serverCalls++;
  if(request.action==='config'){
   if(configGate)await configGate.promise;
   return {available:true,publicKey:'key-A',testMode:true};
  }
  if(request.action==='subscribe'){
   if(subscribeGate)await subscribeGate.promise;
   return serverReply??{ok:true,active:true};
  }
  if(request.action==='unsubscribe'){
   if(unsubscribeGate)await unsubscribeGate.promise;
   return serverReply??{ok:true,active:false};
  }
  throw Error('unexpected action');
 };
 const ctx=vm.createContext({
  merchantRuntime:rt,merchantPushRuntime:push,
  merchantReady:()=>rt.status==='ready'&&rt.requested,
  merchantPushStatus:()=>({supported:true}),
  merchantPushKeyBytes:()=>new Uint8Array([1,2,3]),
  Notification:notification,
  navigator:{serviceWorker:{ready:Promise.resolve(registration),getRegistration:async()=>registration}},
  merchantInvoke:invoke,
  render:()=>events.push('render'),
  Date,Number,String,Array,Object,Error,Uint8Array
 });
 vm.runInContext(code+'\nthis.api={check:merchantPushCheckLive,enable:merchantPushEnableLive,disable:merchantPushDisableLive};',ctx);
 const switchAccount=(merchantId='shop-B')=>{
  rt.accessEpoch++;rt.session={user:{id:'user-B'}};
  rt.merchant={merchantId,memberRole:'owner'};
  rt.selectedMerchantId=merchantId;
  // Same invalidation performed by merchantClearProtectedSnapshot.
  push.toggleToken=null;push.togglePending=false;
  push.checkToken=null;push.checking=false;
  push.subscribed=false;push.publicKey='key-B';
 };
 return {rt,push,ctx,api:ctx.api,calls,events,notification,
  switchAccount,get localSubscription(){return sub},get serverCalls(){return serverCalls}};
}

{
 const f=setup();
 assert.equal(await f.api.enable(),true);
 assert.deepEqual(f.calls.map(v=>v.action),['subscribe']);
 assert.equal(f.calls[0].merchantId,'shop-A');
 assert.equal(f.push.subscribed,true);
 assert.equal(f.push.togglePending,false);
 assert.equal(f.localSubscription?.endpoint,ENDPOINT);
 assert.equal(await f.api.disable(),true);
 assert.deepEqual(f.calls.map(v=>v.action),['subscribe','unsubscribe']);
 assert.equal(f.localSubscription,null);
 assert.equal(f.push.subscribed,false);
}
{
 const f=setup({initialSubscription:true});
 assert.equal(await f.api.enable(),true);
 assert.equal(f.events.includes('browser-subscribe'),false,'existing key is reused');
 assert.equal(f.push.subscribed,true);
}
{
 const f=setup({serverReply:{ok:true,active:false}});
 await assert.rejects(()=>f.api.enable(),/não foi confirmada pelo servidor/);
 assert.equal(f.events.includes('browser-unsubscribe'),true);
 assert.equal(f.push.subscribed,false,'200 without active push must not count');
}
{
 const f=setup({initialSubscription:true,serverReply:{ok:false,active:false}});
 await assert.rejects(()=>f.api.enable(),/não foi confirmada pelo servidor/);
 assert.equal(f.events.includes('browser-unsubscribe'),false,'do not revoke previously valid local subscription');
 assert.equal(f.push.subscribed,true);
}
{
 const f=setup({initialSubscription:true,serverReply:{ok:true,active:true}});
 await assert.rejects(()=>f.api.disable(),/não foi confirmada pelo servidor/);
 assert.equal(f.events.includes('browser-unsubscribe'),false,
  'a failed server revoke must not remove the local subscription');
 assert.equal(f.push.subscribed,true);
 assert.equal(f.push.togglePending,false);
}
{
 const f=setup({initialSubscription:true,localRemovalWorks:false});
 await assert.rejects(()=>f.api.disable(),/navegador não confirmou a exclusão/);
 assert.equal(f.calls.length,1);
 assert.equal(f.push.subscribed,false,'server revoked; browser failure is reported');
}
{
 const pendingPermission=gate();
 const f=setup({permission:'default',permissionGate:pendingPermission});
 const pending=f.api.enable();
 assert.equal(f.events.includes('requestPermission'),true);
 f.switchAccount();
 pendingPermission.release();
 await assert.rejects(pending,/A conta mudou durante a autorização/);
 assert.equal(f.calls.length,0,'B must never receive A authorization after browser prompt');
 assert.equal(f.events.includes('browser-subscribe'),false);
 assert.equal(f.push.publicKey,'key-B');
 assert.equal(f.push.togglePending,false);
}
{
 const g=gate(),f=setup({subscribeGate:g});
 const pending=f.api.enable();
 for(let n=0;n<40&&f.calls.length===0;n++)await Promise.resolve();
 assert.equal(f.calls[0].action,'subscribe');
 f.switchAccount();
 g.release();
 await assert.rejects(pending,/A conta mudou durante a ativação/);
 assert.equal(f.push.subscribed,false);
 assert.equal(f.push.publicKey,'key-B');
 assert.equal(f.push.togglePending,false,'stale callback must not lock new account');
}
{
 const g=gate(),f=setup({initialSubscription:true,unsubscribeGate:g});
 const pending=f.api.disable();
 for(let n=0;n<50&&f.calls.length===0;n++)await Promise.resolve();
 assert.equal(f.calls[0].action,'unsubscribe');
 f.switchAccount();
 g.release();
 await assert.rejects(pending,/A conta mudou durante a revogação/);
 assert.equal(f.events.includes('browser-unsubscribe'),false,
  'late A unsubscribe must not remove browser enrollment for B');
 assert.equal(f.push.subscribed,false);
}
{
 const g=gate(),f=setup({getSubGate:g,initialSubscription:true});
 const pending=f.api.disable();
 for(let n=0;n<30&&f.events.includes('read-browser-subscription')===false;n++)
  await Promise.resolve();
 f.switchAccount();
 g.release();
 await assert.rejects(pending,/A conta mudou durante a consulta/);
 assert.equal(f.calls.length,0);
 assert.equal(f.events.includes('browser-unsubscribe'),false);
}
{
 const f=setup();
 const initial=f.api.enable();
 await assert.rejects(()=>f.api.disable(),/Aguarde a alteração/);
 await assert.rejects(()=>f.api.enable(),/Aguarde a alteração/);
 await initial;
 assert.equal(f.calls.length,1,'no duplicate enrollments');
}
{
 const g=gate(),f=setup({configGate:g});
 f.push.checked=false;
 const pending=f.api.check();
 assert.equal(f.push.checking,true);
 f.switchAccount('shop-A'); // Same merchant, different user/epoch.
 g.release();
 assert.equal(await pending,false,'same merchant but different actor cannot accept stale config');
 assert.equal(f.push.publicKey,'key-B');
 assert.equal(f.push.checked,false);
 assert.equal(f.push.checking,false);
}
{
 const f=setup({initialSubscription:true});
 f.push.checked=false;
 assert.equal(await f.api.check(),true);
 assert.equal(f.push.checked,true);
 assert.equal(f.push.subscribed,true);
 assert.equal(f.calls[0].action,'config');
}
assert.match(server,/body.action==="unsubscribe"/);
assert.match(server,/body.action==="subscribe"/);
assert.match(backend,/merchantPushRuntime.toggleToken=null/);
assert.match(backend,/const permission=await Notification.requestPermission\(\)/);
assert.match(backend,/reply\?\.ok!==true\|\|reply.active!==true/);
assert.match(backend,/reply\?\.ok!==true\|\|reply.active!==false/);
assert.match(ci,/node tests\/merchant-push-session-lifecycle-v1-493\.mjs/);
console.log('PASS: full merchant push lifecycle with session-bound permission, subscribe ACK, revoke ACK, stale responses and browser device proof');
