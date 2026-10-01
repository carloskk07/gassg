const BRL = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const STORAGE='chama-sg-state-v2';
const LEGACY_STORAGE='chama-sg-state-v1';
const STATE_VERSION=2;
const OFFER_TIMEOUT_MS=180000;
const PRICE_FRESH_MS=24*60*60*1000;
const MAX_PIN_FAILURES=5;

const now=()=>new Date();
const nowIso=()=>now().toISOString();
const hhmm=(d=new Date())=>d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const roundMoney=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalizeCnpj=v=>String(v||'').toUpperCase().replace(/[^0-9A-Z]/g,'');
const isValidCnpjShape=v=>/^[0-9A-Z]{12}[0-9]{2}$/.test(normalizeCnpj(v));
const uid=()=>{
  if(globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().split('-')[0].toUpperCase();
  const a=new Uint32Array(2); globalThis.crypto?.getRandomValues?.(a);
  return (a[0]||Math.random()*1e9>>>0).toString(36).slice(0,8).toUpperCase();
};
const makePin=()=>{
  if(globalThis.crypto?.getRandomValues){
    const a=new Uint32Array(1); globalThis.crypto.getRandomValues(a); return String(1000+(a[0]%9000));
  }
  return String(Math.floor(1000+Math.random()*9000));
};

const products={
  P13:{name:'Gás P13',icon:'🔥'},
  WATER20:{name:'Água 20 L',icon:'💧'},
  CHARCOAL4:{name:'Carvão 4 kg',icon:'⚫'},
  WOOD:{name:'Lenha',icon:'🪵'},
  ICE5:{name:'Gelo 5 kg',icon:'🧊'}
};

function freshMerchant(id,name,priceP13,eta,distance,trust,inventory,prices){
  const ts=nowIso();
  return {
    id,name,priceP13,deliveryFee:0,eta,distance,online:true,trust,
    accepted:0,delivered:0,priceConfirmedAt:ts,lastSeenAt:ts,
    inventory:{P13:inventory.P13??0,WATER20:inventory.WATER20??0,CHARCOAL4:inventory.CHARCOAL4??0,WOOD:inventory.WOOD??0,ICE5:inventory.ICE5??0},
    products:{WATER20:prices.WATER20??null,CHARCOAL4:prices.CHARCOAL4??null,WOOD:prices.WOOD??null,ICE5:prices.ICE5??null}
  };
}

function freshSeed(){
  return {
    version:STATE_VERSION,
    mode:'customer',
    user:{name:'Carlos',cashback:7.50,purchases:4,referralCode:'CARLOS27',commissionAvailable:0,commissionPending:0,referredBy:null},
    address:'',
    cart:{P13:0,WATER20:0,CHARCOAL4:0,WOOD:0,ICE5:0},
    checkout:{paymentMethod:'pix',useCashback:false},
    merchants:[
      freshMerchant('A','Revenda Parceira A',116.90,34,3.8,94,{P13:24,WATER20:18,CHARCOAL4:12,WOOD:8,ICE5:14},{WATER20:15.90,CHARCOAL4:19.90,WOOD:24.90,ICE5:12.00}),
      freshMerchant('B','Revenda Parceira B',119.90,19,1.9,97,{P13:31,WATER20:22,CHARCOAL4:10,WOOD:0,ICE5:16},{WATER20:14.90,CHARCOAL4:21.90,WOOD:null,ICE5:11.50}),
      freshMerchant('C','Revenda Parceira C',122.90,13,1.1,98,{P13:18,WATER20:0,CHARCOAL4:20,WOOD:11,ICE5:9},{WATER20:null,CHARCOAL4:18.90,WOOD:22.90,ICE5:13.00})
    ],
    orders:[],
    selectedMerchant:'A',
    onboarding:[]
  };
}

function normalizeCart(cart={}){
  return Object.fromEntries(Object.keys(products).map(k=>[k,clamp(Number.isFinite(Number(cart[k]))?Math.trunc(Number(cart[k])):0,0,99)]));
}
function normalizeMerchant(raw,base){
  const m={...base,...raw};
  const legacyP13=Number.isFinite(Number(raw?.stock))?Math.max(0,Math.trunc(Number(raw.stock))):base.inventory.P13;
  m.inventory={...base.inventory,...(raw?.inventory||{}),P13:raw?.inventory?.P13??legacyP13};
  for(const k of Object.keys(m.inventory)) m.inventory[k]=Math.max(0,Math.trunc(Number(m.inventory[k])||0));
  m.products={...base.products,...(raw?.products||{})};
  for(const k of Object.keys(m.products)){
    const v=m.products[k];
    m.products[k]=v==null?null:(Number.isFinite(Number(v))&&Number(v)>0?roundMoney(Number(v)):null);
  }
  m.deliveryFee=Math.max(0,roundMoney(Number(m.deliveryFee)||0));
  m.priceP13=Number.isFinite(Number(m.priceP13))&&Number(m.priceP13)>0?roundMoney(Number(m.priceP13)):base.priceP13;
  m.eta=Math.max(1,Math.trunc(Number(m.eta)||base.eta));
  m.distance=Math.max(0,Number(m.distance)||base.distance);
  m.trust=clamp(Number(m.trust)||base.trust,0,100);
  m.online=Boolean(m.online);
  m.priceConfirmedAt=m.priceConfirmedAt||nowIso();
  m.lastSeenAt=m.lastSeenAt||nowIso();
  delete m.stock;
  return m;
}
function normalizeState(raw){
  const base=freshSeed();
  if(!raw||typeof raw!=='object') return base;
  const merged={...base,...raw};
  merged.version=STATE_VERSION;
  merged.user={...base.user,...(raw.user||{})};
  merged.user.cashback=Math.max(0,roundMoney(Number(merged.user.cashback)||0));
  merged.user.purchases=Math.max(0,Math.trunc(Number(merged.user.purchases)||0));
  merged.user.commissionAvailable=Math.max(0,roundMoney(Number(merged.user.commissionAvailable)||0));
  merged.user.commissionPending=Math.max(0,roundMoney(Number(merged.user.commissionPending)||0));
  merged.user.referralCode=String(merged.user.referralCode||base.user.referralCode).slice(0,40);
  merged.checkout={...base.checkout,...(raw.checkout||{})};
  merged.checkout.paymentMethod=['pix','card','cash'].includes(merged.checkout.paymentMethod)?merged.checkout.paymentMethod:'pix';
  merged.checkout.useCashback=Boolean(merged.checkout.useCashback);
  merged.address=String(raw.address||'').slice(0,160);
  merged.mode=raw.mode==='merchant'?'merchant':'customer';
  merged.cart=normalizeCart(raw.cart);
  merged.onboarding=Array.isArray(raw.onboarding)?raw.onboarding.slice(0,100):[];
  merged.orders=Array.isArray(raw.orders)?raw.orders.slice(-100):[];
  merged.merchants=base.merchants.map(b=>{
    const found=(Array.isArray(raw.merchants)?raw.merchants:[]).find(x=>x?.id===b.id);
    return normalizeMerchant(found||{},b);
  });
  merged.selectedMerchant=merged.merchants.some(m=>m.id===raw.selectedMerchant)?raw.selectedMerchant:merged.merchants[0].id;
  return merged;
}

let storageHealthy=true;
function load(){
  try{
    const raw=localStorage.getItem(STORAGE)??localStorage.getItem(LEGACY_STORAGE);
    return normalizeState(raw?JSON.parse(raw):null);
  }catch(e){
    storageHealthy=false;
    console.warn('Falha ao carregar estado local',e);
    return freshSeed();
  }
}
let state=load();

function save(){
  try{
    localStorage.setItem(STORAGE,JSON.stringify(state));
    storageHealthy=true;
    return true;
  }catch(e){
    storageHealthy=false;
    console.error('Falha ao salvar estado local',e);
    return false;
  }
}
function reset(){
  state=freshSeed();
  save();
  location.hash='#home';
  render();
  toast('Demonstração reiniciada');
}
function route(){return (location.hash.replace('#','')||'home').split('?')[0]}
function go(r){location.hash='#'+r}
function toast(msg){
  const t=document.querySelector('#toast');if(!t)return;
  t.textContent=msg;t.classList.add('show');
  clearTimeout(toast._timer);toast._timer=setTimeout(()=>t.classList.remove('show'),2600);
}
function parseReferral(){
  try{
    const ref=new URLSearchParams(location.search).get('ref');
    if(ref&&ref!==state.user.referralCode&&!state.user.referredBy){
      state.user.referredBy=ref.trim().slice(0,40); save();
    }
  }catch{}
}

function isPriceFresh(m,at=Date.now()){
  const ts=Date.parse(m.priceConfirmedAt||'');
  return Number.isFinite(ts)&&ts<=at+5*60*1000&&(at-ts)<=PRICE_FRESH_MS;
}
function productPrice(m,k){
  if(k==='P13') return m.priceP13;
  return m.products?.[k]??null;
}
function inventoryFor(m,k){return Number(m.inventory?.[k]??0)}
function hasCartItems(cart=state.cart){return Object.values(cart).some(q=>Number(q)>0)}
function cartUnits(cart=state.cart){return Object.values(cart).reduce((a,b)=>a+(Number(b)||0),0)}
function cartAvailableFor(m,cart){
  if(!m||!m.online||!isPriceFresh(m)||!hasCartItems(cart)) return false;
  return Object.entries(cart).every(([k,q])=>{
    q=Number(q)||0;if(q<=0)return true;
    const price=productPrice(m,k);
    return price!=null&&Number.isFinite(Number(price))&&inventoryFor(m,k)>=q;
  });
}
function cartSubtotalFor(m,cart){
  if(!cartAvailableFor(m,cart)) return null;
  let total=0;
  for(const [k,q] of Object.entries(cart)){
    if(q<=0)continue;
    total+=q*Number(productPrice(m,k));
  }
  return roundMoney(total);
}
function cartTotalFor(m,cart){
  const sub=cartSubtotalFor(m,cart);
  if(sub==null)return null;
  return roundMoney(sub+Number(m.deliveryFee||0));
}
function priceFreshnessText(){
  const valid=state.merchants.filter(m=>m.online&&isPriceFresh(m));
  if(!valid.length)return 'Sem preço confirmado no momento';
  const latest=Math.max(...valid.map(m=>Date.parse(m.priceConfirmedAt)));
  const mins=Math.max(0,Math.floor((Date.now()-latest)/60000));
  if(mins<1)return 'Atualizado agora';
  if(mins<60)return `Atualizado há ${mins} min`;
  const hrs=Math.floor(mins/60);return `Atualizado há ${hrs} h`;
}
function minPrice(){
  const vals=state.merchants.filter(m=>m.online&&isPriceFresh(m)&&inventoryFor(m,'P13')>0).map(m=>roundMoney(m.priceP13+Number(m.deliveryFee||0))).filter(Number.isFinite);
  return vals.length?Math.min(...vals):null;
}
function offersForCart(cart=state.cart){
  const eligible=state.merchants.filter(m=>cartAvailableFor(m,cart)).map(m=>{
    const total=cartTotalFor(m,cart);
    const score=(m.eta*.45)+(m.distance*1.4)+((100-m.trust)*1.6)+(total*.05);
    return {...m,total,score,roles:[]};
  });
  if(!eligible.length)return[];
  const cheapest=[...eligible].sort((a,b)=>a.total-b.total||a.eta-b.eta)[0];
  const fastest=[...eligible].sort((a,b)=>a.eta-b.eta||a.total-b.total)[0];
  const recommended=[...eligible].sort((a,b)=>a.score-b.score)[0];
  const byId=new Map(eligible.map(m=>[m.id,m]));
  byId.get(cheapest.id).roles.push('Mais barato');
  byId.get(recommended.id).roles.push('Recomendado');
  byId.get(fastest.id).roles.push('Mais rápido');
  return eligible.filter(m=>m.roles.length).sort((a,b)=>{
    const ar=a.roles.includes('Recomendado')?0:a.roles.includes('Mais barato')?1:2;
    const br=b.roles.includes('Recomendado')?0:b.roles.includes('Mais barato')?1:2;
    return ar-br;
  });
}
function offers(){return offersForCart(state.cart)}

const LIVE_STATUSES=new Set(['OFFERED_TO_MERCHANT','MERCHANT_ACCEPTED','PREPARING','OUT_FOR_DELIVERY','ARRIVING','AT_RISK','REASSIGNING','REQUOTE_REQUIRED']);
function isLiveOrder(o){return o&&LIVE_STATUSES.has(o.status)}
function activeOrder(){return state.orders.slice().reverse().find(isLiveOrder)||state.orders.at(-1)||null}
function orderById(id){return state.orders.find(o=>o.id===id)||null}
function merchantById(id){return state.merchants.find(m=>m.id===id)||null}

function appendEvent(o,status,title,desc){
  o.events=o.events||[];
  const last=o.events.at(-1);
  if(last?.status===status&&last?.title===title)return;
  o.events.push({status,time:nowIso(),title,desc});
}
const ALLOWED={
  OFFERED_TO_MERCHANT:new Set(['MERCHANT_ACCEPTED','REASSIGNING','CANCELLED']),
  MERCHANT_ACCEPTED:new Set(['PREPARING','CANCELLED']),
  PREPARING:new Set(['OUT_FOR_DELIVERY','AT_RISK','REASSIGNING','CANCELLED']),
  AT_RISK:new Set(['OUT_FOR_DELIVERY','REASSIGNING','CANCELLED']),
  OUT_FOR_DELIVERY:new Set(['ARRIVING','CANCELLED']),
  ARRIVING:new Set(['DELIVERED','CANCELLED']),
  DELIVERED:new Set(['SETTLED']),
  REASSIGNING:new Set(['OFFERED_TO_MERCHANT','REQUOTE_REQUIRED','CANCELLED']),
  REQUOTE_REQUIRED:new Set(['OFFERED_TO_MERCHANT','REASSIGNING','CANCELLED'])
};
function transition(o,next,title,desc){
  if(!o||!ALLOWED[o.status]?.has(next)) return {ok:false,error:`Transição inválida: ${o?.status||'null'} → ${next}`};
  o.status=next; appendEvent(o,next,title,desc); return {ok:true};
}
function reserveInventory(m,cart){
  if(!cartAvailableFor(m,cart))return false;
  for(const [k,q] of Object.entries(cart)) if(q>0)m.inventory[k]-=q;
  return true;
}
function releaseInventory(m,cart){
  if(!m)return;
  for(const [k,q] of Object.entries(cart||{})) if(q>0)m.inventory[k]=(m.inventory[k]||0)+q;
}
function restoreCashback(o){
  if(o?.cashbackReserved>0&&!o.cashbackRestored&&!o.deliveredAt){
    state.user.cashback=roundMoney(state.user.cashback+o.cashbackReserved);
    o.cashbackRestored=true;
  }
}
function rebalanceReservedCashback(o,newGross){
  const allowed=roundMoney(Math.min(Number(o.cashbackReserved)||0,Math.max(0,Number(newGross)||0)));
  const refund=roundMoney((Number(o.cashbackReserved)||0)-allowed);
  if(refund>0)state.user.cashback=roundMoney(state.user.cashback+refund);
  o.cashbackReserved=allowed;
  return allowed;
}
function snapshotItems(m,cart){
  return Object.entries(cart).filter(([,q])=>q>0).map(([k,q])=>({key:k,name:products[k].name,qty:q,unitPrice:Number(productPrice(m,k)),lineTotal:roundMoney(q*Number(productPrice(m,k)))}));
}
function createOrderForMerchant(mid){
  if(!state.address.trim()) return {ok:false,error:'Informe um endereço'};
  if(!hasCartItems(state.cart)) return {ok:false,error:'Adicione pelo menos um produto'};
  if(state.orders.some(isLiveOrder)) return {ok:false,error:'Você já possui um pedido em andamento'};
  const m=merchantById(mid);
  if(!cartAvailableFor(m,state.cart)) return {ok:false,error:'Esta oferta não está mais disponível. Atualizamos as opções.'};
  const gross=cartTotalFor(m,state.cart);
  if(gross==null)return {ok:false,error:'Não foi possível calcular esta oferta'};
  const cashbackReserved=state.checkout.useCashback?roundMoney(Math.min(state.user.cashback,gross)):0;
  const total=roundMoney(gross-cashbackReserved);
  const t=nowIso();
  const cart=structuredClone(state.cart);
  const order={
    id:'SG-'+uid(),merchantId:m.id,address:state.address.trim(),paymentMethod:state.checkout.paymentMethod,
    grossTotal:gross,total,lockedTotal:total,cashbackReserved,cashbackRestored:false,
    status:'OFFERED_TO_MERCHANT',createdAt:t,offerExpiresAt:new Date(Date.now()+OFFER_TIMEOUT_MS).toISOString(),
    pin:makePin(),pinFailures:0,cart,items:snapshotItems(m,cart),attemptedMerchantIds:[m.id],
    supplierSnapshot:null,rewardsGranted:false,inventoryReserved:false,
    events:[
      {status:'CREATED',time:t,title:'Pedido recebido',desc:'Criamos seu pedido e congelamos a cesta.'},
      {status:'QUOTE_LOCKED',time:t,title:'Preço protegido',desc:`Total protegido em ${BRL.format(total)}.`},
      {status:'OFFERED_TO_MERCHANT',time:t,title:'Aguardando confirmação da revenda',desc:'Ainda não exibimos seu pedido como confirmado.'}
    ]
  };
  if(cashbackReserved>0) state.user.cashback=roundMoney(state.user.cashback-cashbackReserved);
  state.orders.push(order);
  state.cart=normalizeCart({});
  state.checkout.useCashback=false;
  save();
  return {ok:true,order};
}
function chooseRescue(order){
  const candidates=state.merchants
    .filter(m=>!order.attemptedMerchantIds.includes(m.id)&&cartAvailableFor(m,order.cart))
    .map(m=>({m,gross:cartTotalFor(m,order.cart)}))
    .sort((a,b)=>a.m.eta-b.m.eta||a.gross-b.gross);
  if(!candidates.length)return null;
  const noIncrease=candidates.find(x=>x.gross<=order.grossTotal);
  return noIncrease||candidates[0];
}
function reassignOrder(order,reason='A revenda não conseguiu atender.'){
  if(!order||!['OFFERED_TO_MERCHANT','PREPARING','AT_RISK'].includes(order.status))return {ok:false,error:'Pedido não pode ser reatribuído neste estado'};
  const current=merchantById(order.merchantId);
  if(order.inventoryReserved){releaseInventory(current,order.cart);order.inventoryReserved=false}
  const r=transition(order,'REASSIGNING','Buscando outra revenda',reason);if(!r.ok)return r;
  const rescue=chooseRescue(order);
  if(!rescue){
    transition(order,'CANCELLED','Pedido cancelado','Nenhum parceiro elegível consegue atender esta cesta agora.');
    restoreCashback(order);save();return {ok:false,error:'Nenhum parceiro alternativo disponível'};
  }
  order.attemptedMerchantIds.push(rescue.m.id);
  if(rescue.gross>order.grossTotal){
    order.proposedMerchantId=rescue.m.id;
    order.proposedGrossTotal=rescue.gross;
    order.proposedTotal=roundMoney(Math.max(0,rescue.gross-order.cashbackReserved));
    transition(order,'REQUOTE_REQUIRED','Nova confirmação necessária',`Encontramos outra opção por ${BRL.format(order.proposedTotal)}. Nada será alterado sem seu aceite.`);
    save();return {ok:true,requote:true};
  }
  order.merchantId=rescue.m.id;
  order.grossTotal=rescue.gross;
  rebalanceReservedCashback(order,rescue.gross);
  order.total=roundMoney(Math.max(0,rescue.gross-order.cashbackReserved));
  order.lockedTotal=order.total;
  order.items=snapshotItems(rescue.m,order.cart);
  order.offerExpiresAt=new Date(Date.now()+OFFER_TIMEOUT_MS).toISOString();
  transition(order,'OFFERED_TO_MERCHANT','Novo parceiro acionado',`Outra revenda recebeu o pedido. Novo total protegido: ${BRL.format(order.total)}.`);
  save();return {ok:true,requote:false};
}
function acceptRequote(id){
  const o=orderById(id);
  if(!o||o.status!=='REQUOTE_REQUIRED')return {ok:false,error:'Não há nova cotação pendente'};
  const m=merchantById(o.proposedMerchantId);
  if(!cartAvailableFor(m,o.cart))return reassignOrderAfterRequoteLoss(o);
  o.merchantId=m.id;o.grossTotal=o.proposedGrossTotal;o.total=o.proposedTotal;o.lockedTotal=o.proposedTotal;o.items=snapshotItems(m,o.cart);
  delete o.proposedMerchantId;delete o.proposedGrossTotal;delete o.proposedTotal;
  o.offerExpiresAt=new Date(Date.now()+OFFER_TIMEOUT_MS).toISOString();
  transition(o,'OFFERED_TO_MERCHANT','Nova cotação aceita',`Você aceitou o novo total protegido de ${BRL.format(o.total)}.`);
  save();return {ok:true};
}
function reassignOrderAfterRequoteLoss(o){
  const moved=transition(o,'REASSIGNING','Oferta ficou indisponível','Estamos buscando outra alternativa.');
  if(!moved.ok)return moved;
  const rescue=chooseRescue(o);
  if(!rescue){transition(o,'CANCELLED','Pedido cancelado','Nenhuma alternativa disponível.');restoreCashback(o);save();return {ok:false,error:'Oferta indisponível'};}
  o.proposedMerchantId=rescue.m.id;o.proposedGrossTotal=rescue.gross;o.proposedTotal=roundMoney(Math.max(0,rescue.gross-o.cashbackReserved));
  transition(o,'REQUOTE_REQUIRED','Nova confirmação necessária',`Nova opção por ${BRL.format(o.proposedTotal)}.`);save();return {ok:false,error:'A oferta mudou; revise a nova cotação'};
}
function customerCancel(id){
  const o=orderById(id);
  if(!o||!['OFFERED_TO_MERCHANT','REQUOTE_REQUIRED'].includes(o.status))return {ok:false,error:'Este pedido já avançou e precisa de suporte para cancelamento'};
  transition(o,'CANCELLED','Cancelado pelo cliente','O pedido foi cancelado antes do compromisso de entrega.');
  restoreCashback(o);save();return {ok:true};
}
function acceptOrder(id){
  const o=orderById(id); if(!o||o.status!=='OFFERED_TO_MERCHANT')return {ok:false,error:'Pedido não está aguardando aceite'};
  if(Date.parse(o.offerExpiresAt||'')<=Date.now()){
    reassignOrder(o,'O prazo para confirmar este pedido expirou.');
    return {ok:false,error:'Prazo de aceite expirou; o pedido foi reavaliado'};
  }
  const m=merchantById(o.merchantId);
  if(!cartAvailableFor(m,o.cart))return reassignOrder(o,'Estoque ou disponibilidade mudaram antes do aceite.');
  if(!reserveInventory(m,o.cart))return reassignOrder(o,'Não foi possível reservar os itens.');
  o.inventoryReserved=true;m.accepted++;
  o.supplierSnapshot={id:m.id,name:m.name};
  o.acceptedAt=nowIso();
  const dispatchWindowMin=Math.max(3,Math.min(10,Math.ceil(m.eta*0.35)));
  o.dispatchDueAt=new Date(Date.now()+dispatchWindowMin*60*1000).toISOString();
  o.promisedBy=new Date(Date.now()+(m.eta+7)*60*1000).toISOString();
  let r=transition(o,'MERCHANT_ACCEPTED','Revenda confirmou ✓','A revenda confirmou itens, preço e capacidade de entrega.');if(!r.ok)return r;
  transition(o,'PREPARING','Em preparação',`Itens reservados. A saída deve ser confirmada em até ${dispatchWindowMin} min.`);
  save();return {ok:true};
}
function rejectOrder(id){
  const o=orderById(id);if(!o||o.status!=='OFFERED_TO_MERCHANT')return {ok:false,error:'Pedido não está aguardando resposta'};
  return reassignOrder(o,'A revenda recusou antes do aceite.');
}
function failAcceptedOrder(id,reason='A revenda não consegue concluir a preparação.'){
  const o=orderById(id);
  if(!o||!['PREPARING','AT_RISK'].includes(o.status))return {ok:false,error:'Pedido não pode ser resgatado neste estado'};
  return reassignOrder(o,reason);
}
function dispatchOrder(id){
  const o=orderById(id);if(!o)return {ok:false,error:'Pedido não encontrado'};
  const r=transition(o,'OUT_FOR_DELIVERY','Saiu para entrega ✓','A revenda confirmou explicitamente a saída do pedido.');
  if(r.ok){o.dispatchedAt=nowIso();save()}return r;
}
function arrivingOrder(id){
  const o=orderById(id);if(!o)return {ok:false,error:'Pedido não encontrado'};
  const r=transition(o,'ARRIVING','Entregador chegando','A chegada próxima foi confirmada no modo de demonstração.');
  if(r.ok){o.arrivingAt=nowIso();save()}return r;
}
function grantRewards(o){
  if(o.rewardsGranted)return;
  o.rewardsGranted=true;
  const earned=1.25;
  state.user.purchases=(Number(state.user.purchases)||0)+1;
  state.user.cashback=roundMoney((Number(state.user.cashback)||0)+earned);
  o.cashbackEarned=earned;
}
function deliverOrder(id,pin){
  const o=orderById(id);if(!o||o.status!=='ARRIVING')return {ok:false,error:'Pedido ainda não está pronto para confirmação de entrega'};
  if(o.pinFailures>=MAX_PIN_FAILURES)return {ok:false,error:'PIN bloqueado após muitas tentativas. Abra suporte.'};
  if(String(pin||'').trim()!==o.pin){
    o.pinFailures=(o.pinFailures||0)+1;
    appendEvent(o,'PIN_FAILED','PIN incorreto',`Tentativa ${o.pinFailures} de ${MAX_PIN_FAILURES}.`);
    save();return {ok:false,error:o.pinFailures>=MAX_PIN_FAILURES?'PIN bloqueado. Abra suporte.':'PIN incorreto — entrega não concluída'};
  }
  let r=transition(o,'DELIVERED','Entregue ✓','PIN validado com sucesso.');if(!r.ok)return r;
  o.deliveredAt=nowIso();
  const m=merchantById(o.merchantId);if(m)m.delivered++;
  r=transition(o,'SETTLED','Pedido concluído','Entrega conciliada na demonstração; benefícios foram processados.');
  if(r.ok){o.settledAt=nowIso();grantRewards(o);save()}
  return r;
}
function pauseMerchant(id){
  const m=merchantById(id);if(!m)return {ok:false,error:'Revenda não encontrada'};
  m.online=false;
  const pending=state.orders.filter(o=>o.merchantId===id&&o.status==='OFFERED_TO_MERCHANT');
  pending.forEach(o=>reassignOrder(o,'A revenda ficou indisponível antes do aceite.'));
  save();return {ok:true};
}
function resumeMerchant(id){const m=merchantById(id);if(!m)return {ok:false,error:'Revenda não encontrada'};m.online=true;m.lastSeenAt=nowIso();save();return {ok:true}}
function updateMerchant(id,{priceP13,stockP13}){
  const m=merchantById(id);if(!m)return {ok:false,error:'Revenda não encontrada'};
  const price=Number(priceP13),stock=Number(stockP13);
  if(!Number.isFinite(price)||price<=0||price>9999)return {ok:false,error:'Preço inválido'};
  if(!Number.isFinite(stock)||stock<0||stock>9999)return {ok:false,error:'Estoque inválido'};
  m.priceP13=roundMoney(price);m.inventory.P13=Math.trunc(stock);m.priceConfirmedAt=nowIso();m.lastSeenAt=nowIso();save();return {ok:true};
}
function setCartProduct(k,qty){
  if(!products[k])return;
  state.cart[k]=clamp(Math.trunc(Number(qty)||0),0,99);save();
}
function startOrder(k='P13'){
  if(!products[k])k='P13';
  if(!hasCartItems(state.cart))state.cart=normalizeCart({});
  if(state.cart[k]===0)state.cart[k]=1;
  save();go('order');
}
function clearCart(){state.cart=normalizeCart({});save()}
function housekeeping(){
  let changed=false;
  for(const o of state.orders){
    if(o.status==='OFFERED_TO_MERCHANT'&&Date.parse(o.offerExpiresAt||'')<=Date.now()){
      reassignOrder(o,'A revenda não respondeu dentro do prazo de confirmação.');changed=true;continue;
    }
    if(o.status==='PREPARING'&&Date.parse(o.dispatchDueAt||'')<=Date.now()){
      const r=transition(o,'AT_RISK','Saída ainda não confirmada','A revenda ultrapassou a janela de preparação. Estamos acompanhando antes de prometer que o pedido está a caminho.');
      if(r.ok){o.riskReason='Saída ainda não confirmada';changed=true}
    }
    if(['OUT_FOR_DELIVERY','ARRIVING'].includes(o.status)&&!o.etaRiskNotifiedAt&&Date.parse(o.promisedBy||'')<=Date.now()){
      o.etaRiskNotifiedAt=nowIso();
      o.riskReason='Entrega fora da janela prevista';
      appendEvent(o,'ETA_RISK','Entrega fora da janela prevista','O ETA máximo foi ultrapassado. O pedido continua ativo e deve receber atualização real, não um status artificial.');
      changed=true;
    }
  }
  if(changed)save();
  return changed;
}

function runtimeStrip(){
  if(!globalThis.liveRequested?.()){
    return '<div class="demo-strip"><span>Ambiente de demonstração • preços e revendas ilustrativos</span><button onclick="reset()">Reiniciar</button></div>';
  }
  const mode=globalThis.liveBanner?.()||'connecting';
  if(mode==='live'){
    return '<div class="demo-strip live-strip"><span>● PILOTO CONECTADO • dados e pedidos vêm do Supabase gassg</span><button onclick="location.href=location.pathname+\'#home\'">Voltar à demonstração</button></div>';
  }
  if(mode==='connecting'){
    return '<div class="demo-strip live-strip"><span>Conectando ao backend real do piloto…</span></div>';
  }
  return '<div class="demo-strip blocked-strip"><span>Modo live solicitado, mas o Auth do piloto ainda não está disponível</span><button onclick="location.href=location.pathname+\'#home\'">Abrir demonstração</button></div>';
}
function shell(content){
  const r=route();
  const merchantAction=globalThis.liveRequested?.()
    ? "toast('A área real da revenda exige login permanente; integração em próxima etapa')"
    : "setMode('merchant')";
  return `<div class="app">
  ${runtimeStrip()}
  <header class="topbar"><div class="shell topbar-inner">
    <button class="brand brand-button" onclick="go('home')" aria-label="Ir para o início"><div class="brandmark"><span>🔥</span></div><div>Chama<small>São Gabriel</small></div></button>
    <div class="desktop-only desktop-nav"><button onclick="go('home')">Início</button><button onclick="go('club')">Clube</button><button onclick="go('refer')">Indique e ganhe</button><button onclick="go('merchants')">Para revendas</button></div>
    <div class="mode-pill" aria-label="Alternar modo"><button class="${state.mode==='customer'?'active':''}" onclick="setMode('customer')">Cliente</button><button class="${state.mode==='merchant'?'active':''}" onclick="${merchantAction}">Revenda</button></div>
  </div></header>
  <main class="shell">${content}</main>
  ${bottomNav(r)}
  </div>`;
}
function bottomNav(r){
  const items=state.mode==='merchant'
    ?[['merchant','🏪','Operação','go'],['merchant-orders','📦','Pedidos','go'],['catalog','🧺','Catálogo','go'],['merchant-metrics','📊','Desempenho','go'],['merchants','➕','Parceiros','go']]
    :[['home','⌂','Início','go'],['order','🔥','Pedir','start'],['tracking','📍','Pedido','go'],['club','★','Clube','go'],['refer','🤝','Indique','go']];
  return `<nav class="bottom-nav" aria-label="Navegação principal">${items.map(([id,ic,l,act])=>`<button class="nav-btn ${r===id?'active':''}" ${r===id?'aria-current="page"':''} onclick="${act==='start'?"startOrder('P13')":`go('${id}')`}"><span aria-hidden="true">${ic}</span><span>${l}</span></button>`).join('')}</nav>`;
}
function setMode(m){state.mode=m==='merchant'?'merchant':'customer';save();go(state.mode==='merchant'?'merchant':'home');render()}

parseReferral();

if(globalThis.__CHAMA_TEST__){
  globalThis.ChamaTest={
    freshSeed,normalizeState,normalizeCart,cartAvailableFor,cartTotalFor,offersForCart,isPriceFresh,minPrice,
    createOrderForMerchant,acceptOrder,rejectOrder,dispatchOrder,arrivingOrder,deliverOrder,customerCancel,
    reassignOrder,acceptRequote,transition,updateMerchant,pauseMerchant,resumeMerchant,setCartProduct,grantRewards,
    hasCartItems,esc,housekeeping,normalizeCnpj,isValidCnpjShape,
    getState:()=>state,setState:s=>{state=normalizeState(s);save();}
  };
}
