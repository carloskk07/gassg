import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class StorageMock {
  constructor(){this.map=new Map()}
  getItem(k){return this.map.has(k)?this.map.get(k):null}
  setItem(k,v){this.map.set(k,String(v))}
  removeItem(k){this.map.delete(k)}
  clear(){this.map.clear()}
}
globalThis.localStorage=new StorageMock();
globalThis.location={hash:'',search:'',origin:'https://example.test',pathname:'/gassg/'};
globalThis.document={querySelector:()=>null};
globalThis.render=()=>{};
globalThis.toast=()=>{};

vm.runInThisContext(fs.readFileSync(new URL('../js/core.js',import.meta.url),'utf8'),{filename:'js/core.js'});
const T=globalThis.ChamaTest;
let passed=0;
function test(name,fn){
  try{fn();passed++;console.log('✓',name)}
  catch(e){console.error('✗',name);throw e}
}
function reset(mutator){
  const s=T.freshSeed();
  if(mutator)mutator(s);
  T.setState(s);
  return T.getState();
}
function cart(...pairs){
  const c={P13:0,WATER20:0,CHARCOAL4:0,WOOD:0,ICE5:0};
  for(const [k,q] of pairs)c[k]=q;
  return c;
}

test('estado inicial não força P13 no carrinho',()=>{
  const s=reset();
  assert.equal(s.cart.P13,0);
  assert.equal(T.hasCartItems(s.cart),false);
});

test('pedido somente de água é elegível sem adicionar gás',()=>{
  const s=reset(x=>{x.address='Rua Teste, 10';x.cart=cart(['WATER20',1])});
  const offers=T.offersForCart(s.cart);
  assert.ok(offers.length>=1);
  assert.ok(offers.every(o=>o.id!=='C'));
  const r=T.createOrderForMerchant(offers[0].id);
  assert.equal(r.ok,true);
  assert.equal(r.order.cart.P13,0);
  assert.equal(r.order.cart.WATER20,1);
});

test('impede segundo pedido enquanto há pedido ativo',()=>{
  reset(x=>{x.address='Rua Teste, 20';x.cart=cart(['P13',1])});
  assert.equal(T.createOrderForMerchant('A').ok,true);
  T.getState().cart=cart(['P13',1]);
  const r=T.createOrderForMerchant('B');
  assert.equal(r.ok,false);
  assert.match(r.error,/andamento/i);
});

test('despacho antes do aceite é bloqueado pela máquina de estados',()=>{
  reset(x=>{x.address='Rua Teste, 30';x.cart=cart(['P13',1])});
  const o=T.createOrderForMerchant('A').order;
  const r=T.dispatchOrder(o.id);
  assert.equal(r.ok,false);
  assert.equal(T.getState().orders[0].status,'OFFERED_TO_MERCHANT');
});

test('aceite reserva estoque uma única vez',()=>{
  const s=reset(x=>{x.address='Rua Teste, 40';x.cart=cart(['P13',2])});
  const before=s.merchants.find(m=>m.id==='A').inventory.P13;
  const o=T.createOrderForMerchant('A').order;
  assert.equal(T.acceptOrder(o.id).ok,true);
  const after=T.getState().merchants.find(m=>m.id==='A').inventory.P13;
  assert.equal(after,before-2);
  assert.equal(T.acceptOrder(o.id).ok,false);
  assert.equal(T.getState().merchants.find(m=>m.id==='A').inventory.P13,after);
});

test('preço do pedido permanece bloqueado após alteração do catálogo',()=>{
  reset(x=>{x.address='Rua Teste, 50';x.cart=cart(['P13',1])});
  const o=T.createOrderForMerchant('A').order;
  const locked=o.lockedTotal;
  assert.equal(T.updateMerchant('A',{priceP13:145,stockP13:24}).ok,true);
  assert.equal(T.getState().orders[0].lockedTotal,locked);
});

test('rejeição usa a cesta congelada do pedido e não o carrinho atual',()=>{
  reset(x=>{x.address='Rua Teste, 60';x.cart=cart(['WATER20',1])});
  const o=T.createOrderForMerchant('B').order;
  T.getState().cart=cart(['P13',99]);
  const r=T.rejectOrder(o.id);
  assert.equal(r.ok,true);
  const order=T.getState().orders[0];
  assert.notEqual(order.merchantId,'B');
  assert.equal(order.cart.WATER20,1);
  assert.equal(order.cart.P13,0);
  assert.ok(['OFFERED_TO_MERCHANT','REQUOTE_REQUIRED'].includes(order.status));
});

test('reassign automático nunca aumenta preço silenciosamente',()=>{
  reset(x=>{x.address='Rua Teste, 70';x.cart=cart(['P13',1])});
  const o=T.createOrderForMerchant('A').order;
  const old=o.total;
  const r=T.rejectOrder(o.id);
  assert.equal(r.ok,true);
  const order=T.getState().orders[0];
  if(order.status==='REQUOTE_REQUIRED'){
    assert.ok(order.proposedTotal>old);
  }else{
    assert.ok(order.total<=old);
  }
});

test('cashback reservado volta ao cliente se cancelar antes do aceite',()=>{
  reset(x=>{x.address='Rua Teste, 80';x.cart=cart(['P13',1]);x.user.cashback=7.5;x.checkout.useCashback=true});
  const o=T.createOrderForMerchant('A').order;
  assert.equal(T.getState().user.cashback,0);
  assert.equal(o.cashbackReserved,7.5);
  assert.equal(T.customerCancel(o.id).ok,true);
  assert.equal(T.getState().user.cashback,7.5);
});

test('fluxo completo exige PIN e recompensa uma única vez',()=>{
  reset(x=>{x.address='Rua Teste, 90';x.cart=cart(['P13',1]);x.user.cashback=0;x.user.purchases=0});
  const o=T.createOrderForMerchant('B').order;
  assert.equal(T.acceptOrder(o.id).ok,true);
  assert.equal(T.dispatchOrder(o.id).ok,true);
  assert.equal(T.arrivingOrder(o.id).ok,true);
  assert.equal(T.deliverOrder(o.id,'0000').ok,false);
  assert.equal(T.getState().orders[0].status,'ARRIVING');
  assert.equal(T.deliverOrder(o.id,o.pin).ok,true);
  const after=T.getState();
  assert.equal(after.orders[0].status,'SETTLED');
  assert.equal(after.user.purchases,1);
  assert.equal(after.user.cashback,1.25);
  assert.equal(T.deliverOrder(o.id,o.pin).ok,false);
  assert.equal(T.getState().user.cashback,1.25);
});

test('PIN bloqueia após cinco tentativas incorretas',()=>{
  reset(x=>{x.address='Rua Teste, 100';x.cart=cart(['P13',1])});
  const o=T.createOrderForMerchant('C').order;
  T.acceptOrder(o.id);T.dispatchOrder(o.id);T.arrivingOrder(o.id);
  for(let i=0;i<5;i++)T.deliverOrder(o.id,'0000');
  const r=T.deliverOrder(o.id,o.pin);
  assert.equal(r.ok,false);
  assert.match(r.error,/bloqueado/i);
  assert.equal(T.getState().orders[0].status,'ARRIVING');
});

test('preço expirado remove revenda das ofertas',()=>{
  const s=reset(x=>{x.address='Rua Teste, 110';x.cart=cart(['P13',1])});
  s.merchants.find(m=>m.id==='A').priceConfirmedAt=new Date(Date.now()-25*60*60*1000).toISOString();
  T.setState(s);
  assert.ok(!T.offersForCart(T.getState().cart).some(o=>o.id==='A'));
});

test('sem revenda ativa o menor preço é nulo, não infinito',()=>{
  const s=reset();
  s.merchants.forEach(m=>m.online=false);
  T.setState(s);
  assert.equal(T.minPrice(),null);
});

test('pausar loja reatribui pedido ainda não aceito',()=>{
  reset(x=>{x.address='Rua Teste, 120';x.cart=cart(['P13',1])});
  const o=T.createOrderForMerchant('C').order;
  assert.equal(T.pauseMerchant('C').ok,true);
  const order=T.getState().orders[0];
  assert.ok(!(order.status==='OFFERED_TO_MERCHANT' && order.merchantId==='C'));
  assert.notEqual(order.merchantId,'C');
});

test('migração de estado antigo converte stock para inventory.P13',()=>{
  const old={merchants:[{id:'A',stock:7,priceP13:118,online:true}],cart:{P13:1},user:{cashback:2}};
  const migrated=T.normalizeState(old);
  assert.equal(migrated.version,2);
  assert.equal(migrated.merchants.find(m=>m.id==='A').inventory.P13,7);
  assert.equal(migrated.checkout.paymentMethod,'pix');
});

test('escape neutraliza HTML inserido pelo usuário',()=>{
  assert.equal(T.esc('<img src=x onerror=1>'),'&lt;img src=x onerror=1&gt;');
});

test('validação numérica rejeita preço infinito e estoque negativo',()=>{
  reset();
  assert.equal(T.updateMerchant('A',{priceP13:Infinity,stockP13:1}).ok,false);
  assert.equal(T.updateMerchant('A',{priceP13:120,stockP13:-1}).ok,false);
});

console.log(`\n${passed} simulações passaram.`);
