import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('js/admin.js');
const backend=read('js/backend.js');
new vm.Script(admin,{filename:'admin.js'});
const fragment=(start,end,source=admin)=>{
  const from=source.indexOf(start);
  const to=source.indexOf(end,from+start.length);
  assert.ok(from>=0&&to>from,'Missing target: '+start);
  return source.slice(from,to);
};
const call=fragment('async function adminInvoke(', 'async function adminAuthInvoke(');
const refresh=fragment('async function adminRefresh(', 'async function adminPerform(');
const retry=fragment('function isAmbiguousTransportError(', 'const MERCHANT_PILOT_INVITE_STORAGE',backend);
assert.match(backend,/const CHAMA_NETWORK_TIMEOUT_MS=15000/);
assert.match(call,/body\?\.action==='summary'\?25000:undefined/);
assert.doesNotMatch(refresh,/finance-lab-sandbox-pix|payment-request|refund|reverse-order/,
  'the retry gate must never execute a financial operation');

const networkCalls=[];
const requestCtx=vm.createContext({
  CHAMA_BACKEND:{url:'https://example.supabase.co',publishableKey:'PUBLIC_ANON'},
  adminAccessToken:async()=> 'SECRET_JWT',
  globalThis:null
});
requestCtx.globalThis=requestCtx;
requestCtx.chamaFetch=async(url,init,timeout)=>{
  networkCalls.push({url,init,timeout});
  return {ok:true,status:200,json:async()=>({ok:true})};
};
vm.runInContext(call+'\nthis.adminInvoke=adminInvoke;',requestCtx);
assert.equal((await requestCtx.adminInvoke({action:'summary'})).ok,true);
assert.equal(networkCalls[0].timeout,25000);
assert.equal(networkCalls[0].init.headers.Authorization,'Bearer SECRET_JWT');
assert.equal(networkCalls[0].init.headers['Idempotency-Key'],undefined);
await requestCtx.adminInvoke({action:'finance-lab-sandbox-pix',amountCents:5000},
  {idempotencyKey:'unchanged-caller-key'});
assert.equal(networkCalls[1].timeout,undefined,
  'a Pix provider write retains the original network timeout and retry policy');
assert.equal(networkCalls[1].init.headers['Idempotency-Key'],'unchanged-caller-key');
await requestCtx.adminInvoke({action:'audit-search'});
assert.equal(networkCalls[2].timeout,undefined,'other calls retain the default timeout');

let calls=0,renderCount=0;
const runtime={client:{},status:'loading',refreshSeq:0,section:'finance',data:null,error:null};
const ctx=vm.createContext({
  Date,Number,Set,Promise,TypeError,
  adminRuntime:runtime,render:()=>renderCount++,
  adminInvoke:async body=>{
    assert.equal(body.action,'summary','only read-only administrative snapshot is retried');
    calls++;
    if(calls===1){const e=new Error('transient');e.code='NETWORK_TIMEOUT';throw e;}
    return {ok:true,merchantBilling:{paymentRequests:[],paymentEvents:[],refunds:[],statements:[]}};
  },
  adminEnsureProviderHealth:async()=>{},
  adminCurrentRole:()=> 'superadmin',
  queueMicrotask:()=>{},setTimeout:fn=>{fn();return 1;},
  globalThis:null
});
ctx.globalThis=ctx;
vm.runInContext(retry+'\nthis.retryAmbiguousOnce=retryAmbiguousOnce;\n'+refresh+
  '\nthis.adminRefresh=adminRefresh;',ctx);
const recovered=await ctx.adminRefresh({silent:true});
assert.equal(calls,2,'a transient NETWORK_TIMEOUT is retried exactly once');
assert.equal(recovered.ok,true);
assert.equal(runtime.status,'ready');
assert.equal(runtime.error,null);
assert.ok(Date.parse(runtime.lastSyncAt)>0);

calls=0;
ctx.adminInvoke=async()=>{calls++; const e=new Error('denied');e.code='ADMIN_ACCESS_DENIED';e.status=403;throw e;};
await ctx.adminRefresh({silent:true});
assert.equal(calls,1,'authorization refusal cannot be retried');
assert.equal(runtime.status,'no-access');
assert.equal(runtime.data,null,'authorization refusal clears privileged data');

runtime.status='loading';runtime.data=null;runtime.client={};
calls=0;
ctx.adminInvoke=async()=>{calls++;const e=new Error('expired');e.status=401;throw e;};
await ctx.adminRefresh({silent:true});
assert.equal(calls,1,'expired session must not be retried');
assert.equal(runtime.status,'unauthenticated');

runtime.status='loading';runtime.data=null;runtime.client={};
calls=0;
ctx.adminInvoke=async()=>{calls++;const e=new Error('no connection');e.code='NETWORK_TIMEOUT';throw e;};
await assert.rejects(ctx.adminRefresh({silent:true}),e=>e.code==='NETWORK_TIMEOUT');
assert.equal(calls,2,'a persistent transient error is attempted only twice');
assert.equal(runtime.status,'unavailable','a real total failure must fail closed');
assert.match(runtime.error,/servidor podem estar lentos/);
assert.doesNotMatch(runtime.error,/Verifique sua internet/);

console.log('PASS admin snapshot: scoped 25s timeout, bounded read-only retry, no PSP replay, deny/401 fail closed.');
