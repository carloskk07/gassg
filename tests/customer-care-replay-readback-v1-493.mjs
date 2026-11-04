import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const backend=fs.readFileSync(new URL('../js/backend.js',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('../js/customer-care-replay.js',import.meta.url),'utf8');
new vm.Script(source);

const original={orderId:'order-A',supportCases:[{id:'case-A',category:'late',status:'open'}]};
const runtime={order:original,orderId:'order-A',session:{user:{id:'user-A'}},error:null};
const requests=[];
let index=0,attempt='network',serverRead=original,rendered=0,installReadback=true,changeAccountDuringRead=false;
const ctx=vm.createContext({
  liveRuntime:runtime,
  liveIdempotency:()=> 'case-key-'+(++index),
  retryAmbiguousOnce:fn=>fn(),
  liveInvoke:async(name,body,options)=>{
    assert.equal(name,'customer-care');
    requests.push({body:{...body},key:options.idempotencyKey,actor:runtime.session.user.id});
    if(attempt==='network')throw Error('Network timeout after possible write');
    if(attempt==='validation'){
      const error=Error('Bad input');error.status=400;throw error;
    }
    if(attempt==='server'){
      const error=Error('Temporary server error');error.status=503;throw error;
    }
    if(attempt==='account-switch'){
      runtime.session={user:{id:'user-B'}};
      runtime.order={orderId:'order-B'};
    }
    return {ok:true,case:{id:'case-A',order_id:body.orderId,category:body.category,status:'open'}};
  },
  liveGetOrder:async(orderId)=>{
    if(changeAccountDuringRead){
      runtime.session={user:{id:'user-B'}};
      runtime.orderId='order-B';
      runtime.order={orderId:'order-B',supportCases:[]};
      changeAccountDuringRead=false;
    }
    if(installReadback&&serverRead?.orderId===orderId){
      runtime.order=serverRead;
      runtime.orderId=orderId;
      runtime.orderCheckedId=orderId;
      runtime.orderCheckedAt=new Date().toISOString();
    }
    return serverRead;
  },
  render:()=>rendered++
});
vm.runInContext(source,ctx);
ctx.submit=(category,message)=>ctx.customerSupportReplaySubmit(category,message,{
  liveRuntime:runtime,liveIdempotency:ctx.liveIdempotency,
  retryAmbiguousOnce:ctx.retryAmbiguousOnce,liveInvoke:ctx.liveInvoke,
  liveGetOrder:ctx.liveGetOrder,render:ctx.render
});

// Server wrote a support case but its HTTP ACK was lost. The next click
// must use EXACTLY the same key, not an unrelated new logical request.
await assert.rejects(()=>ctx.submit('late','Atraso no pedido'),/Network timeout/);
const firstKey=requests[0].key;
assert.equal(requests.length,1);
attempt='server';
await assert.rejects(()=>ctx.submit('late','Atraso no pedido'),/Temporary server/);
assert.equal(requests.at(-1).key,firstKey);
attempt='success';
const replay=await ctx.submit('late','Atraso no pedido');
assert.equal(replay.refreshPending,false);
assert.equal(requests.at(-1).key,firstKey,'a saved case must be replayed under its original key');
assert.equal(requests.length,3,'the transport failures caused exactly three attempts');
assert.ok(rendered>0);

// A different report, even for the same order, needs a distinct server key.
await ctx.submit('other','Outra ocorrencia');
const secondKey=requests.at(-1).key;
assert.notEqual(secondKey,firstKey);

// Validated rejection is definitive; a new attempt with the same text
// must not keep replaying a rejected idempotency key.
attempt='validation';
await assert.rejects(()=>ctx.submit('delivery','Nao entregue'),/Bad input/);
const rejected=requests.at(-1).key;
attempt='success';
await ctx.submit('delivery','Nao entregue');
assert.notEqual(requests.at(-1).key,rejected);

// The API ACK alone cannot claim that the history was refreshed.
// A failed/stale get-order read leaves the case saved, but reports readback pending.
serverRead={orderId:'order-A',supportCases:[]};
const unread=await ctx.submit('no_show','Problema comprovado');
assert.equal(unread.refreshPending,true);
assert.match(runtime.error,/ainda não aparece/);
serverRead=original;
runtime.error=null;

// A server response can contain the case without ever being installed in
// tracking (e.g. a stale/overlapping get-order). It must not be shown as
// confirmed just because its JSON payload contains the correct ID.
installReadback=false;
serverRead={orderId:'order-A',supportCases:[{id:'case-A',category:'price_payment',status:'open'}]};
const discarded=await ctx.submit('price_payment','Consulta descartada');
assert.equal(discarded.refreshPending,true);
assert.match(runtime.error,/ainda não aparece/);
installReadback=true;
runtime.error=null;
const fresh=await ctx.submit('price_payment','Segunda consulta aplicada');
assert.equal(fresh.refreshPending,false);
assert.equal(runtime.order,serverRead);
assert.equal(runtime.orderCheckedId,'order-A');

// If the account changes during the authenticated read, never render a
// success for the new account or reuse the old request's private tracking.
const beforeReadSwitch=rendered;
changeAccountDuringRead=true;
assert.equal(await ctx.submit('delivery','Mudanca durante consulta'),null);
assert.equal(rendered,beforeReadSwitch);
runtime.session={user:{id:'user-A'}};
runtime.orderId='order-A';
runtime.order=original;

// Neither an old pending key nor a late successful response may be used
// by another authenticated customer or by a different order.
attempt='network';
await assert.rejects(()=>ctx.submit('other','Relato privado'),/Network timeout/);
const keyBeforeSwitch=requests.at(-1).key;
runtime.session={user:{id:'user-B'}};
runtime.order={orderId:'order-B',supportCases:[]};
runtime.orderId='order-B';
attempt='success';
serverRead={orderId:'order-B',supportCases:[{id:'case-A',category:'other'}]};
await ctx.submit('other','Relato privado');
assert.notEqual(requests.at(-1).key,keyBeforeSwitch);
assert.equal(requests.at(-1).body.orderId,'order-B');

// A response that completes AFTER an account switch cannot emit a success
// on that account, regardless of the server already persisting the old case.
runtime.session={user:{id:'user-A'}};
runtime.order=original;
runtime.orderId='order-A';
attempt='account-switch';
const rendersBefore=rendered;
assert.equal(await ctx.submit('late','Outra tentativa'),null);
assert.equal(rendered,rendersBefore);
assert.match(backend,/function liveForgetAccount\(\)\{\s*globalThis\.customerSupportReplayReset\?\.\(\);/,
  'logout must drop customer support replay state before changing account');
assert.ok(fs.readFileSync(new URL('../.github/workflows/audit.yml',import.meta.url),'utf8')
  .includes('node tests/customer-care-replay-readback-v1-493.mjs'));

// ACK succeeded but the exact case is not visible in the authenticated read.
// Clicking again must only refresh the order, NEVER create another support case.
ctx.customerSupportReplayReset();
runtime.session={user:{id:'user-A'}};
runtime.orderId='order-A';
runtime.order=original;
runtime.authGeneration=1;
attempt='success';
serverRead={orderId:'order-A',supportCases:[]};
const countBeforeAck=requests.length;
const missingAfterAck=await ctx.submit('late','ACK registrado, sem leitura');
assert.equal(missingAfterAck.refreshPending,true);
assert.equal(requests.length,countBeforeAck+1);
const keyAfterAck=requests.at(-1).key;
serverRead={orderId:'order-A',supportCases:[{id:'case-A',category:'late'}]};
const readOnlyReplay=await ctx.submit('late','ACK registrado, sem leitura');
assert.equal(readOnlyReplay.refreshPending,false);
assert.equal(requests.length,countBeforeAck+1,'a committed case may not be posted twice');
assert.equal(requests.at(-1).key,keyAfterAck);
assert.equal(runtime.error,null);

// The same ID with the wrong category is not sufficient proof of this case.
ctx.customerSupportReplayReset();
serverRead={orderId:'order-A',supportCases:[{id:'case-A',category:'wrong_item'}]};
const mismatchedCategory=await ctx.submit('late','Categoria divergente');
assert.equal(mismatchedCategory.refreshPending,true);

// Two submissions of the same order must never both start a network mutation.
ctx.customerSupportReplayReset();
let finishWrite;
const waitForWrite=new Promise(resolve=>{finishWrite=resolve});
const originalInvoke=ctx.liveInvoke;
let concurrentPosts=0;
ctx.liveInvoke=async(name,body,options)=>{
  concurrentPosts++;
  await waitForWrite;
  return {ok:true,case:{id:'case-A',order_id:body.orderId,category:body.category}};
};
serverRead={orderId:'order-A',supportCases:[{id:'case-A',category:'other'}]};
const firstConcurrent=ctx.submit('other','Relato concorrente');
await assert.rejects(()=>ctx.submit('other','Relato concorrente'),/em andamento/);
assert.equal(concurrentPosts,1);
finishWrite();
assert.equal((await firstConcurrent).refreshPending,false);
ctx.liveInvoke=originalInvoke;

// A deliberately incorrect ACK cannot be labelled confirmed.
ctx.customerSupportReplayReset();
ctx.liveInvoke=async()=>({ok:true,case:{id:'case-A',order_id:'other-order',category:'late'}});
await assert.rejects(()=>ctx.submit('late','Outra ordem no ACK'),/não confirmou o protocolo/);
ctx.liveInvoke=originalInvoke;

// Logout/login with the SAME user identifier still invalidates the old result.
ctx.customerSupportReplayReset();
let releaseOld;
const oldWrite=new Promise(resolve=>{releaseOld=resolve});
ctx.liveInvoke=async(name,body)=>{
  await oldWrite;
  return {ok:true,case:{id:'case-A',order_id:body.orderId,category:body.category}};
};
const beforeAba=rendered;
const staleAba=ctx.submit('late','Resposta antiga ABA');
runtime.authGeneration=2;
releaseOld();
assert.equal(await staleAba,null);
assert.equal(rendered,beforeAba,'old authentication response must not repaint the new session');
ctx.liveInvoke=originalInvoke;
ctx.customerSupportReplayReset();
runtime.authGeneration=0;

console.log('PASS #493 customer support: lost ACK replay, definite failure, exact request, applied readback, concurrent account isolation.');
