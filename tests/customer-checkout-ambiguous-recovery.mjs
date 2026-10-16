import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const backend=fs.readFileSync(new URL('../js/backend.js',import.meta.url),'utf8');
const start=backend.indexOf('async function liveCreateOrder(quoteId){');
const end=backend.indexOf('\nasync function liveGetOrder(',start);
assert.ok(start>=0&&end>start,'checkout boundary missing');
const source=backend.slice(start,end);
new vm.Script(source,{filename:'liveCreateOrder'});
const confirmedId='550e8400-e29b-41d4-a716-446655440000';
const newActiveId='66ae8400-e29b-41d4-a716-446655440001';

async function scenario({result=null,previousId='old-previous-order',activeAfterSync=null,orderReadFails=false}={}){
  const routes=[],notices=[],requested=[],readOrders=[];
  const runtime={
    actionPending:false,
    orderId:previousId,
    error:null,
    offers:[{quoteId:'quote-123',expiresAt:new Date(Date.now()+90000).toISOString()}]
  };
  const state={
    cart:{WATER20:1},
    checkout:{
      paymentMethod:'pix',useCashback:false,cashTenderCents:null,
      customerPhoneDigits:'51999999999',addressComplement:null,
      deliveryReference:null,deliveryNotes:null,
      deliveryMode:'now',deliveryWindowStart:null,
      deliveryWindowEnd:null,deliveryWindowLabel:null
    },
    user:{referredBy:''}
  };
  const context=vm.createContext({
    liveRuntime:runtime,state,
    location:{search:''},URLSearchParams,Date,Number,String,Math,
    liveIdempotency:()=> 'create-order:test-key',
    retryAmbiguousOnce:async fn=>fn(),
    liveInvoke:async (route,payload)=>{
      requested.push({route,payload});
      if(!result)throw new TypeError('Network response missing');
      return result;
    },
    liveSyncFinancialProfile:async ()=>{
      if(activeAfterSync!==null)runtime.orderId=activeAfterSync;
      return true;
    },
    liveGetOrder:async id=>{
      readOrders.push(id);
      if(orderReadFails)throw new TypeError('Order detail unavailable');
      return {orderId:id,status:'OFFERED_TO_MERCHANT'};
    },
    normalizeCart:()=>({}),
    save:()=>{},
    go:route=>routes.push(route),
    toast:message=>notices.push(String(message)),
    render:()=>{},
    localStorage:{setItem:()=>{}},
    growthAttributionCode:()=> '',
  });
  vm.runInContext(source+'\nthis.runCheckout=liveCreateOrder;',context);
  await context.runCheckout('quote-123');
  return {state,runtime,routes,notices,requested,readOrders};
}

// A previous tracked order must NOT be mistaken for the just-attempted purchase.
const old=await scenario();
assert.deepEqual(old.state.cart,{WATER20:1});
assert.deepEqual(old.routes,[]);
assert.equal(old.readOrders.length,0);
assert.doesNotMatch(old.notices.join(' '),/recuperado com segurança|Pedido registrado/i);
assert.equal(old.runtime.actionPending,false);

// A truly confirmed create-order reply remains confirmed even if detail fetch fails.
const confirmed=await scenario({result:{orderId:confirmedId},orderReadFails:true});
console.log('DEBUG_CONFIRMED', JSON.stringify({cart:confirmed.state.cart,notices:confirmed.notices,routes:confirmed.routes,requests:confirmed.requested,readOrders:confirmed.readOrders,orderId:confirmed.runtime.orderId,error:confirmed.runtime.error}));
assert.deepEqual(confirmed.state.cart,{});
assert.ok(confirmed.routes.includes('tracking'));
assert.ok(confirmed.notices.some(s=>s.includes('Pedido registrado')));
assert.equal(confirmed.runtime.orderId,confirmedId);
assert.equal(confirmed.runtime.actionPending,false);

// A new active order discovered after an ambiguous response warrants inspection,
// not a false assertion that this particular quote was purchased.
const discovered=await scenario({activeAfterSync:newActiveId});
assert.deepEqual(discovered.state.cart,{WATER20:1});
assert.ok(discovered.routes.includes('tracking'));
assert.deepEqual(discovered.readOrders,[newActiveId]);
assert.doesNotMatch(discovered.notices.join(' '),/Pedido registrado|recuperado com segurança/);
assert.match(discovered.notices.join(' '),/Confira antes de tentar novamente/);
assert.equal(discovered.runtime.actionPending,false);

// An invalid success payload must not clear the basket or assert success.
const invalid=await scenario({result:{orderId:'invalid'}});
assert.deepEqual(invalid.state.cart,{WATER20:1});
assert.deepEqual(invalid.routes,[]);
assert.equal(invalid.runtime.actionPending,false);

// Normal success clears the basket and starts tracking the actual returned order.
const normal=await scenario({result:{orderId:confirmedId}});
assert.deepEqual(normal.state.cart,{});
assert.deepEqual(normal.readOrders,[confirmedId]);
assert.ok(normal.routes.includes('tracking'));

console.log('Checkout ambiguity regression PASS: old order, confirmed reply, discovered order, invalid reply, ordinary success.');
