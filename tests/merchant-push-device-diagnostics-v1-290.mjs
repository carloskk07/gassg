import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const backend=read('js/backend.js');
const merchant=read('js/merchant.js');
const bootstrap=read('js/bootstrap.js');
const audit=read('.github/workflows/audit.yml');
new vm.Script(backend,{filename:'js/backend.js'});
new vm.Script(merchant,{filename:'js/merchant.js'});
new vm.Script(bootstrap,{filename:'js/bootstrap.js'});

const slice=(name,next)=>{
  const a=backend.indexOf('async function '+name+'(');
  const b=backend.indexOf('\n'+next,a);
  assert.ok(a>=0&&b>a,'missing function '+name);
  return backend.slice(a,b);
};
const diagnosticSource=slice('merchantPushDiagnoseLive','async function merchantPushCheckLive');
const enableSource=slice('merchantPushEnableLive','async function merchantPushDisableLive');
const runtime={
  checked:true,checking:false,available:true,publicKey:'dummy-public',
  subscribed:true,merchantId:'m',testMode:true,diagnostic:null
};
const merchantRuntime={merchant:{merchantId:'m'},session:{user:{id:'u'}},status:'ready'};
const oldSub={
  endpoint:'https://fcm.googleapis.com/fcm/send/safe-device',
  options:{applicationServerKey:new Uint8Array([1,2,3])},
  toJSON:()=>({endpoint:'https://fcm.googleapis.com/fcm/send/safe-device',
    keys:{p256dh:'public',auth:'secret'}}),
  unsubscribe:async()=>{events.push('unsubscribe');return true}
};
let events=[],requestFails=false,localSub=oldSub,ready=true;
const reg={active:{},pushManager:{
  getSubscription:async()=>localSub,
  subscribe:async()=>{events.push('new-subscription');return oldSub}
}};
const env={
  merchantRuntime,merchantPushRuntime:runtime,
  merchantReady:()=>ready,
  merchantPushStatus:()=>({supported:true}),
  merchantPushKeyBytes:()=>new Uint8Array([1,2,3]),
  merchantInvoke:async()=>{events.push('register-server');if(requestFails)throw Error('offline');return {ok:true}},
  navigator:{serviceWorker:{ready:Promise.resolve(reg),getRegistration:async()=>reg}},
  Notification:{permission:'granted'},PushManager:class{},isSecureContext:true,
  render:()=>events.push('render'),Date,Uint8Array,Error
};
const ctx=vm.createContext(env);
vm.runInContext(diagnosticSource+'\n'+enableSource+
  '\nthis.diagnose=merchantPushDiagnoseLive;this.enable=merchantPushEnableLive;',ctx);

requestFails=true;events=[];
await assert.rejects(ctx.enable(),/offline/);
assert.equal(events.includes('unsubscribe'),false,'network error must not destroy original subscription');
assert.equal(events.includes('new-subscription'),false,'matching key must be reused');
assert.equal(runtime.subscribed,true,'reusable local registration must remain intact');

requestFails=false;events=[];
assert.equal(await ctx.enable(),true);
assert.equal(events.includes('new-subscription'),false,'registration must be idempotent');
assert.equal(events.includes('unsubscribe'),false,'do not revoke existing consent on retry');

const different={
  ...oldSub,
  options:{applicationServerKey:new Uint8Array([8,9,10])},
  unsubscribe:async()=>{events.push('replace-old');return true}
};
localSub=different;requestFails=true;events=[];
await assert.rejects(ctx.enable(),/offline/);
assert.deepEqual(events.filter(x=>x==='replace-old'),['replace-old'],
  'VAPID mismatch must replace old subscription only once');
assert.equal(events.filter(x=>x==='new-subscription').length,1);
assert.equal(events.filter(x=>x==='unsubscribe').length,1,
  'only newly-created subscription may be revoked after server error');
assert.equal(runtime.subscribed,false);

localSub=oldSub;requestFails=false;events=[];
assert.equal(await ctx.diagnose(),true);
assert.equal(runtime.diagnostic.supported,true);
assert.equal(runtime.diagnostic.workerReady,true);
assert.equal(runtime.diagnostic.permission,'granted');
assert.equal(runtime.diagnostic.localSubscription,true);
assert.equal(runtime.diagnostic.keyMatches,true);
assert.ok(!JSON.stringify(runtime.diagnostic).includes(oldSub.endpoint),
  'diagnostic must not expose endpoint, P256DH or auth secret');
merchantRuntime.merchant.merchantId='another';
runtime.diagnostic=null;
assert.equal(await ctx.diagnose(),true);
assert.equal(runtime.diagnostic.merchantId,'another');
ready=false;
assert.equal(await assert.rejects(ctx.diagnose(),/Entre na revenda/),undefined);
assert.match(merchant,/Verificar este aparelho/);
assert.match(merchant,/Esta verificação é local/);
assert.match(merchant,/merchantPushDiagnoseFromUi/);
assert.match(bootstrap,/merchantPushDiagnoseFromUi/);
assert.match(backend,/if\(createdNew\)await subscription.unsubscribe/);
assert.doesNotMatch(diagnosticSource,/\.rpc\(|console\.log|endpoint|keys\.auth/);
assert.match(audit,/node tests\/merchant-push-device-diagnostics-v1-290.mjs/);
console.log('V1.290 PASS — device-only diagnostics, key matching, subscription reuse and no false delivery claims.');
