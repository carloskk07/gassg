import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const backend=fs.readFileSync(new URL('../js/backend.js',import.meta.url),'utf8');
const start=backend.indexOf('let pendingCustomerSupportCase=null;');
const end=backend.indexOf('const CUSTOMER_FINANCIAL_REFRESH_MS',start);
assert.ok(start>0&&end>start,'The support replay state and client operation must exist');
const source=backend.slice(start,end);
new vm.Script(source);

const original={orderId:'order-A',supportCases:[{id:'case-A',status:'open'}]};
const runtime={order:original,session:{user:{id:'user-A'}},error:null};
const requests=[];
let index=0,attempt='network',serverRead=original,rendered=0;
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
    return {ok:true,case:{id:'case-A',status:'open'}};
  },
  liveGetOrder:async()=>serverRead,
  render:()=>rendered++
});
vm.runInContext(source+'\nthis.submit=liveOpenSupportCase;this.pending=()=>pendingCustomerSupportCase;',ctx);

// Server wrote a support case but its HTTP ACK was lost. The next click
// must use EXACTLY the same key, not an unrelated new logical request.
await assert.rejects(()=>ctx.submit('late','Atraso no pedido'),/Network timeout/);
const firstKey=requests[0].key;
assert.equal(ctx.pending().key,firstKey);
attempt='server';
await assert.rejects(()=>ctx.submit('late','Atraso no pedido'),/Temporary server/);
assert.equal(requests.at(-1).key,firstKey);
attempt='success';
const replay=await ctx.submit('late','Atraso no pedido');
assert.equal(replay.refreshPending,false);
assert.equal(requests.at(-1).key,firstKey,'a saved case must be replayed under its original key');
assert.equal(ctx.pending(),null,'confirmed API ACK frees the replay key');
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
assert.equal(ctx.pending(),null);
attempt='success';
await ctx.submit('delivery','Nao entregue');
assert.notEqual(requests.at(-1).key,rejected);

// The API ACK alone cannot claim that the history was refreshed.
// A failed/stale get-order read leaves the case saved, but reports readback pending.
serverRead={orderId:'order-A',supportCases:[]};
const unread=await ctx.submit('no_show','Problema comprovado');
assert.equal(unread.refreshPending,true);
assert.match(runtime.error,/ainda não aparece/);
assert.equal(ctx.pending(),null);
serverRead=original;
runtime.error=null;

// Neither an old pending key nor a late successful response may be used
// by another authenticated customer or by a different order.
attempt='network';
await assert.rejects(()=>ctx.submit('other','Relato privado'),/Network timeout/);
const keyBeforeSwitch=requests.at(-1).key;
runtime.session={user:{id:'user-B'}};
runtime.order={orderId:'order-B',supportCases:[]};
attempt='success';
serverRead={orderId:'order-B',supportCases:[{id:'case-A'}]};
await ctx.submit('other','Relato privado');
assert.notEqual(requests.at(-1).key,keyBeforeSwitch);
assert.equal(requests.at(-1).body.orderId,'order-B');

// A response that completes AFTER an account switch cannot emit a success
// on that account, regardless of the server already persisting the old case.
runtime.session={user:{id:'user-A'}};
runtime.order=original;
attempt='account-switch';
const rendersBefore=rendered;
await assert.rejects(()=>ctx.submit('late','Outra tentativa'),/conta ou o pedido mudou/);
assert.equal(rendered,rendersBefore);
assert.match(backend,/function liveForgetAccount\(\)\{\s*pendingCustomerSupportCase=null;/,
  'logout must drop customer support replay state before changing account');
assert.ok(fs.readFileSync(new URL('../.github/workflows/audit.yml',import.meta.url),'utf8')
  .includes('node tests/customer-care-replay-readback-v1-493.mjs'));
console.log('PASS #493 customer support: lost ACK replay, definite failure, exact request, account isolation, server readback.');
