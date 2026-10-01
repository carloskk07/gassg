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
globalThis.__CHAMA_TEST__=true;

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

test('resgate mais barato devolve cashback reservado em excesso',()=>{
  reset(x=>{x.address='Rua Teste, 105';x.cart=cart(['P13',1]);x.user.cashback=200;x.checkout.useCashback=true});
  const o=T.createOrderForMerchant('C').order;
  assert.equal(o.cashbackReserved,122.9);
  assert.equal(T.rejectOrder(o.id).ok,true);
  const after=T.getState();
  const order=after.orders[0];
  assert.equal(order.status,'OFFERED_TO_MERCHANT');
  assert.equal(order.merchantId,'B');
  assert.equal(order.cashbackReserved,119.9);
  assert.equal(order.total,0);
  assert.equal(after.user.cashback,80.1);
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


test('aceite vencido é recusado mesmo se o botão ainda estiver visível',()=>{
  reset(x=>{x.address='Rua Teste, 130';x.cart=cart(['P13',1])});
  const o=T.createOrderForMerchant('C').order;
  o.offerExpiresAt=new Date(Date.now()-1000).toISOString();
  const before=T.getState().merchants.find(m=>m.id==='C').inventory.P13;
  const r=T.acceptOrder(o.id);
  assert.equal(r.ok,false);
  assert.equal(T.getState().merchants.find(m=>m.id==='C').inventory.P13,before);
  assert.notEqual(T.getState().orders[0].merchantId,'C');
});

test('cesta multiproduto só mostra revenda capaz de atender tudo',()=>{
  const s=reset(x=>{x.address='Rua Teste, 140';x.cart=cart(['WATER20',1],['WOOD',1])});
  const offers=T.offersForCart(s.cart);
  assert.deepEqual(offers.map(o=>o.id),['A']);
});

test('estoque complementar é reservado junto com o P13',()=>{
  const s=reset(x=>{x.address='Rua Teste, 150';x.cart=cart(['P13',1],['WATER20',2],['ICE5',1])});
  const m=s.merchants.find(x=>x.id==='B');
  const before={...m.inventory};
  const o=T.createOrderForMerchant('B').order;
  assert.equal(T.acceptOrder(o.id).ok,true);
  const after=T.getState().merchants.find(x=>x.id==='B').inventory;
  assert.equal(after.P13,before.P13-1);
  assert.equal(after.WATER20,before.WATER20-2);
  assert.equal(after.ICE5,before.ICE5-1);
  assert.ok(Object.values(after).every(v=>v>=0));
});

test('cancelamento simples deixa de ser permitido depois do aceite',()=>{
  reset(x=>{x.address='Rua Teste, 160';x.cart=cart(['P13',1])});
  const o=T.createOrderForMerchant('A').order;
  T.acceptOrder(o.id);
  const r=T.customerCancel(o.id);
  assert.equal(r.ok,false);
  assert.equal(T.getState().orders[0].status,'PREPARING');
});

test('cashback não pode ser restaurado duas vezes pelo mesmo cancelamento',()=>{
  reset(x=>{x.address='Rua Teste, 170';x.cart=cart(['P13',1]);x.user.cashback=10;x.checkout.useCashback=true});
  const o=T.createOrderForMerchant('A').order;
  assert.equal(T.customerCancel(o.id).ok,true);
  const balance=T.getState().user.cashback;
  assert.equal(T.customerCancel(o.id).ok,false);
  assert.equal(T.getState().user.cashback,balance);
});

test('re-cotação maior só altera total após aceite explícito do cliente',()=>{
  reset(x=>{x.address='Rua Teste, 180';x.cart=cart(['WATER20',1])});
  const o=T.createOrderForMerchant('B').order;
  const old=o.total;
  const rr=T.rejectOrder(o.id);
  assert.equal(rr.ok,true);
  let order=T.getState().orders[0];
  assert.equal(order.status,'REQUOTE_REQUIRED');
  assert.equal(order.total,old);
  const proposed=order.proposedTotal;
  assert.ok(proposed>old);
  const ar=T.acceptRequote(o.id);
  assert.equal(ar.ok,true);
  order=T.getState().orders[0];
  assert.equal(order.status,'OFFERED_TO_MERCHANT');
  assert.equal(order.total,proposed);
  assert.notEqual(order.merchantId,'B');
});

test('normalização corrige valores persistidos corrompidos',()=>{
  const bad=T.normalizeState({
    mode:'hacker',
    address:'x'.repeat(500),
    user:{cashback:-10,purchases:-3,commissionAvailable:'abc'},
    checkout:{paymentMethod:'bitcoin',useCashback:'yes'},
    merchants:[{id:'A',priceP13:-1,deliveryFee:-5,products:{WATER20:-9},inventory:{P13:-2}}]
  });
  assert.equal(bad.mode,'customer');
  assert.equal(bad.address.length,160);
  assert.equal(bad.user.cashback,0);
  assert.equal(bad.user.purchases,0);
  assert.equal(bad.checkout.paymentMethod,'pix');
  assert.equal(bad.merchants.find(m=>m.id==='A').deliveryFee,0);
  assert.equal(bad.merchants.find(m=>m.id==='A').products.WATER20,null);
  assert.equal(bad.merchants.find(m=>m.id==='A').inventory.P13,0);
});

test('timestamp de preço muito no futuro é tratado como inválido',()=>{
  const s=reset(x=>{x.address='Rua Teste, 190';x.cart=cart(['P13',1])});
  s.merchants.find(m=>m.id==='A').priceConfirmedAt=new Date(Date.now()+60*60*1000).toISOString();
  T.setState(s);
  assert.ok(!T.offersForCart(T.getState().cart).some(o=>o.id==='A'));
});


test('preparação vencida entra em AT_RISK sem fingir saída',()=>{
  reset(x=>{x.address='Rua Teste, 200';x.cart=cart(['P13',1])});
  const o=T.createOrderForMerchant('B').order;
  assert.equal(T.acceptOrder(o.id).ok,true);
  T.getState().orders[0].dispatchDueAt=new Date(Date.now()-1000).toISOString();
  assert.equal(T.housekeeping(),true);
  const order=T.getState().orders[0];
  assert.equal(order.status,'AT_RISK');
  assert.match(order.riskReason,/saída/i);
  assert.equal(order.dispatchedAt,undefined);
});

test('pedido em risco pode sair e recuperar o fluxo real',()=>{
  reset(x=>{x.address='Rua Teste, 210';x.cart=cart(['P13',1])});
  const o=T.createOrderForMerchant('B').order;
  T.acceptOrder(o.id);
  T.getState().orders[0].dispatchDueAt=new Date(Date.now()-1000).toISOString();
  T.housekeeping();
  assert.equal(T.dispatchOrder(o.id).ok,true);
  assert.equal(T.getState().orders[0].status,'OUT_FOR_DELIVERY');
});

test('ETA vencido gera um único alerta sem alterar artificialmente o status',()=>{
  reset(x=>{x.address='Rua Teste, 220';x.cart=cart(['P13',1])});
  const o=T.createOrderForMerchant('B').order;
  T.acceptOrder(o.id);T.dispatchOrder(o.id);
  T.getState().orders[0].promisedBy=new Date(Date.now()-1000).toISOString();
  assert.equal(T.housekeeping(),true);
  const first=T.getState().orders[0];
  assert.equal(first.status,'OUT_FOR_DELIVERY');
  assert.ok(first.etaRiskNotifiedAt);
  const count=first.events.filter(e=>e.status==='ETA_RISK').length;
  T.housekeeping();
  assert.equal(T.getState().orders[0].events.filter(e=>e.status==='ETA_RISK').length,count);
});


test('CNPJ numérico legado continua aceito',()=>{
  assert.equal(T.isValidCnpjShape('12.345.678/0001-95'),true);
  assert.equal(T.normalizeCnpj('12.345.678/0001-95'),'12345678000195');
});

test('CNPJ alfanumérico atual é aceito sem quebrar cadastros novos',()=>{
  assert.equal(T.isValidCnpjShape('00.000.000/E08G-12'),true);
  assert.equal(T.normalizeCnpj('00.000.000/E08G-12'),'00000000E08G12');
  assert.equal(T.isValidCnpjShape('00.000.000/E08G-AA'),false);
});


test('re-cotação que fica indisponível volta ao matching pela máquina de estados',()=>{
  reset(x=>{x.address='Rua Teste, 230';x.cart=cart(['P13',1])});
  const o=T.createOrderForMerchant('A').order;
  const rr=T.rejectOrder(o.id);
  assert.equal(rr.ok,true);
  let order=T.getState().orders[0];
  assert.equal(order.status,'REQUOTE_REQUIRED');
  const proposed=order.proposedMerchantId;
  T.getState().merchants.find(m=>m.id===proposed).online=false;
  const ar=T.acceptRequote(o.id);
  assert.equal(ar.ok,false);
  order=T.getState().orders[0];
  assert.ok(['REQUOTE_REQUIRED','CANCELLED'].includes(order.status));
  assert.ok(order.events.some(e=>e.status==='REASSIGNING'&&/indisponível/i.test(e.title)));
});

console.log(`\n${passed} simulações passaram.`);
