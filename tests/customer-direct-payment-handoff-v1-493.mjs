import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const script=read('js/customer-direct-payment.js');
const backend=read('js/backend.js'),ui=read('js/customer.js');
new vm.Script(script);new vm.Script(backend);new vm.Script(ui);
const ORDER='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const MP_URL='https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=real-synthetic-fixture';
let seq=0;
function proof({id=ORDER,status='PREPARING',paymentStatus='not_started',
 url=null,available=true,canStart=true,amount=12500,owner='merchant',
 tamReceives=false,provider='mercadopago',paymentTiming='prepaid',expiresAt=null}={}){
 return {orderId:id,status,version:4,totalCents:12500,paymentTiming,paymentMethod:'pix',
 onlinePayment:{status:paymentStatus,available,canStart,checkoutUrl:url,
  amountCents:amount,provider,fundsOwner:owner,tamaoReceivesSaleProceeds:tamReceives,expiresAt}};
}
function setup({initial=proof(),reads=[proof()],reply={ok:true,orderId:ORDER,checkoutUrl:MP_URL},
 error=null,changeAccount=false,changeOrder=false,pending=false,retryTwice=false}={}){
 const calls=[],toasts=[],renders=[],nav={href:null};
 const rt={requested:true,status:'ready',session:{user:{id:'buyer-one'}},
   orderId:ORDER,order:{orderId:ORDER},actionPending:pending,error:null};
 let readIndex=0;
 const deps={
  liveRuntime:rt,liveReady:()=>rt.status==='ready',
  liveIdempotency:(prefix)=>prefix+':fixture-'+(++seq),
  retryAmbiguousOnce:async fn=>{
   if(!retryTwice)return fn();
   try{return await fn()}catch{return fn();}
  },
  liveInvoke:async (name,body,options)=>{
   calls.push({name,body,options});
   if(changeAccount)rt.session={user:{id:'buyer-two'}};
   if(changeOrder){rt.orderId=OTHER;rt.order={orderId:OTHER};}
   if(error)throw error;
   return reply;
  },
  liveGetOrder:async (id,opts)=>{
   calls.push({name:'get-order',id,opts});
   const value=reads[Math.min(readIndex++,reads.length-1)];
   if(value instanceof Error)throw value;
   if(value?.orderId===rt.orderId){
     rt.order=value;rt.orderCheckedId=value.orderId;
     rt.orderCheckedAt=new Date().toISOString();
   }
   return value;
  },
  toast:x=>toasts.push(String(x)),
  render:()=>renders.push(rt.actionPending),
  location:nav
 };
 const ctx={};ctx.globalThis=ctx;
 vm.runInNewContext(script,ctx,{filename:'customer-direct-payment.js'});
 return {rt,calls,toasts,renders,nav,go:(id=ORDER)=>ctx.customerDirectPaymentStart(id,deps)};
}
// Existing link: only navigates after a fresh, exact-order, same-account read.
{
 const x=setup({reads:[proof({url:MP_URL,paymentStatus:'checkout_ready',canStart:false})]});
 assert.equal(await x.go(),true);
 assert.equal(x.nav.href,MP_URL);
 assert.deepEqual(x.calls.map(x=>x.name),['get-order']);
 assert.equal(x.rt.actionPending,false);
}
// New checkout: one exact-order read, versioned provider RPC, second readback
// of the same link before the browser can leave the first-party page.
{
 const x=setup({reads:[proof(),proof({url:MP_URL,paymentStatus:'checkout_ready'})]});
 assert.equal(await x.go(),true);
 assert.equal(x.nav.href,MP_URL);
 assert.deepEqual(x.calls.map(x=>x.name),['get-order','order-payment-checkout','get-order']);
 assert.equal(x.calls[1].body.orderId,ORDER);
 assert.match(x.calls[1].options.idempotencyKey,/^merchant-sale-payment:/);
}
// ACK lost after the PSP checkout may have committed: authenticated readback
// may recover only the exact order's stored link, no extra payment attempt.
{
 const x=setup({reads:[proof(),proof({url:MP_URL,paymentStatus:'checkout_ready'})],
  error:new TypeError('lost ACK'),retryTwice:true});
 assert.equal(await x.go(),true);
 assert.equal(x.nav.href,MP_URL);
 const writes=x.calls.filter(c=>c.name==='order-payment-checkout');
 assert.equal(writes.length,2,'bounded transport retry reuses same key');
 assert.equal(writes[0].options.idempotencyKey,writes[1].options.idempotencyKey);
}
// A customer who switches account/order while the payment API is pending
// must never be sent to a checkout associated with the old principal.
for(const changed of [{changeAccount:true},{changeOrder:true}]){
 const x=setup({...changed,reads:[proof(),proof({url:MP_URL,paymentStatus:'checkout_ready'})]});
 assert.equal(await x.go(),false);
 assert.equal(x.nav.href,null);
 assert.equal(x.calls.filter(c=>c.name==='order-payment-checkout').length,1);
}
// An old DOM button from a different tracked order cannot read or create a checkout.
{
 const x=setup();
 assert.equal(await x.go(OTHER),false);
 assert.equal(x.calls.length,0);
 assert.equal(x.nav.href,null);
 assert.match(x.toasts.join(' '),/pedido selecionado mudou/i);
}
for(const invalid of [
 proof({id:OTHER}),proof({status:'CANCELLED',url:MP_URL}),
 proof({status:'REASSIGNING',url:MP_URL}),proof({paymentTiming:'on_delivery',url:MP_URL}),
 proof({amount:12501,url:MP_URL}),proof({owner:'platform',url:MP_URL}),
 proof({tamReceives:true,url:MP_URL}),proof({provider:'other',url:MP_URL}),
 proof({available:false,url:MP_URL}),
 proof({url:MP_URL,paymentStatus:'review_required'}),
 proof({url:MP_URL,paymentStatus:'refunded'}),
 proof({url:'https://www.mercadopago.com.br.evil.net/pay',paymentStatus:'checkout_ready'}),
 proof({url:'https://mercadopago.com@evil.net/pay',paymentStatus:'checkout_ready'}),
 proof({url:MP_URL,paymentStatus:'checkout_ready',expiresAt:'2020-01-01T00:00:00Z'})
]){
 const x=setup({reads:[invalid]});
 assert.equal(await x.go(),false,JSON.stringify(invalid));
 assert.equal(x.nav.href,null);
 assert.equal(x.calls.filter(c=>c.name==='order-payment-checkout').length,0);
}
{
 const x=setup({reads:[proof({available:true,canStart:false})]});
 assert.equal(await x.go(),false);
 assert.equal(x.calls.filter(c=>c.name==='order-payment-checkout').length,0);
}
// An unrelated or inconsistent API response cannot become a redirect.
for(const reply of [
 {},{ok:true,orderId:OTHER,checkoutUrl:MP_URL},
 {ok:true,orderId:ORDER,checkoutUrl:'https://evil.net/checkout'},
 {ok:false,orderId:ORDER,checkoutUrl:MP_URL}
]){
 const x=setup({reply,reads:[proof(),proof({url:MP_URL,paymentStatus:'checkout_ready'})]});
 assert.equal(await x.go(),false);
 assert.equal(x.nav.href,null);
}
// Even with a positive provider API ACK, a readback for different amount/link,
// an expired link or missing server read is not proof to redirect.
for(const second of [
 proof({url:'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=OTHER',paymentStatus:'checkout_ready'}),
 proof({url:MP_URL,paymentStatus:'checkout_ready',amount:12501}),
 proof({url:MP_URL,paymentStatus:'checkout_ready',available:false}),
 proof({url:MP_URL,paymentStatus:'checkout_ready',expiresAt:'2020-01-01T00:00:00Z'}),
 new TypeError('get-order failed')
]){
 const x=setup({reads:[proof(),second]});
 assert.equal(await x.go(),false);
 assert.equal(x.nav.href,null);
 assert.equal(x.calls.filter(c=>c.name==='order-payment-checkout').length,1);
}
// Rejected RPC (e.g. 409) must not treat an older link as authority.
{
 const error=Object.assign(Error('Payment route denied'),{status:409});
 const x=setup({error,reads:[proof(),proof({url:MP_URL,paymentStatus:'checkout_ready'})]});
 assert.equal(await x.go(),false);
 assert.equal(x.nav.href,null);
}
{
 const x=setup({reads:[proof({url:null,paymentStatus:'approved'})]});
 assert.equal(await x.go(),true);
 assert.equal(x.nav.href,null);
 assert.match(x.toasts.join(' '),/Pagamento já confirmado/);
}
// Backend approved response alone is never enough. Verify live readback.
{
 const x=setup({reply:{ok:true,orderId:ORDER,alreadyPaid:true},reads:[
  proof(),proof({paymentStatus:'approved'})
 ]});
 assert.equal(await x.go(),true);
 assert.equal(x.nav.href,null);
 assert.match(x.toasts.join(' '),/Pagamento já confirmado/);
}
{
 const x=setup({reply:{ok:true,orderId:ORDER,alreadyPaid:true},reads:[proof(),proof()]});
 assert.equal(await x.go(),false);
 assert.equal(x.nav.href,null);
}
// HTML binds the displayed order as escaped data, never executable inline values.
assert.equal(ui.split('data-order-id="${esc(o.orderId)}" onclick="liveStartMerchantPayment(this.dataset.orderId)"').length-1,2);
assert.doesNotMatch(ui,/onclick="liveStartMerchantPayment\(\)"/);
assert.match(backend,/liveCustomerScript\('customer-direct-payment'\)/);
assert.ok(read('.github/workflows/audit.yml').includes('node tests/customer-direct-payment-handoff-v1-493.mjs'));
console.log('PASS #493 direct seller payment: exact buyer/order, safe MP link, fresh readback, lost ACK, denied RPC, no cross-account redirect.');
