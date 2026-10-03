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
  P20:{name:'Gás P20',icon:'🔥'},
  P45:{name:'Gás P45',icon:'🔥'},
  WATER20:{name:'Água 20 L',icon:'💧'},
  CHARCOAL4:{name:'Carvão 4 kg',icon:'⚫'},
  WOOD:{name:'Lenha',icon:'🪵'},
  ICE5:{name:'Gelo 5 kg',icon:'🧊'}
};
function glpKgForProductCode(value){
  const code=String(value??'').trim().toUpperCase();
  const match=/^P([1-9][0-9]?)$/.exec(code);
  if(!match)return null;
  const kg=Number(match[1]);
  return Number.isInteger(kg)&&kg>=1&&kg<=90?kg:null;
}
function glpContainerKgForProductCode(value){
  const code=String(value??'').trim().toUpperCase();
  const match=/^P([1-9][0-9]?)_CONTAINER$/.exec(code);
  if(!match)return null;
  const kg=Number(match[1]);
  return Number.isInteger(kg)&&kg>=1&&kg<=90?kg:null;
}
function glpContainerCodeForGas(value){
  const kg=glpKgForProductCode(value);
  return kg===null?null:'P'+kg+'_CONTAINER';
}
function ensureProductDefinition(value){
  const code=String(value??'').trim().toUpperCase();
  if(products[code])return products[code];
  const kg=glpKgForProductCode(code);
  if(kg!==null){
    products[code]={name:'Gás P'+kg,icon:'🔥'};
    return products[code];
  }
  const containerKg=glpContainerKgForProductCode(code);
  if(containerKg===null)return null;
  products[code]={name:'Vasilhame P'+containerKg,icon:'🛢️',hidden:true};
  return products[code];
}
function synchronizeGlpContainerCart(cart,mode){
  const target=cart||{};
  const needsContainer=mode==='needs_container';
  for(const [code,qtyRaw] of Object.entries({...target})){
    const kg=glpKgForProductCode(code);
    if(kg===null)continue;
    const companion='P'+kg+'_CONTAINER';
    ensureProductDefinition(companion);
    target[companion]=needsContainer?clamp(Math.trunc(Number(qtyRaw)||0),0,99):0;
  }
  for(const code of Object.keys(target)){
    if(glpContainerKgForProductCode(code)===null)continue;
    const gasCode=code.replace(/_CONTAINER$/,'');
    const gasQty=clamp(Math.trunc(Number(target[gasCode])||0),0,99);
    target[code]=needsContainer?gasQty:0;
  }
  return target;
}

function freshMerchant(id,name,priceP13,eta,distance,trust,inventory,prices){
  const ts=nowIso();
  return {
    id,name,priceP13,deliveryFee:0,eta,distance,online:true,trust,
    pricingP13:{mode:'fixed',min:priceP13,preferred:priceP13,max:priceP13,strategy:'balanced'},
    accepted:0,delivered:0,priceConfirmedAt:ts,lastSeenAt:ts,
    inventory:{P13:inventory.P13??0,P20:inventory.P20??0,P45:inventory.P45??0,WATER20:inventory.WATER20??0,CHARCOAL4:inventory.CHARCOAL4??0,WOOD:inventory.WOOD??0,ICE5:inventory.ICE5??0},
    products:{WATER20:prices.WATER20??null,CHARCOAL4:prices.CHARCOAL4??null,WOOD:prices.WOOD??null,ICE5:prices.ICE5??null}
  };
}

function freshSeed(){
  const testDemo=globalThis.__CHAMA_TEST__===true;
  const internalPilot=globalThis.CHAMA_INTERNAL_PILOT===true;
  return {
    version:STATE_VERSION,
    mode:'customer',
    user:testDemo
      ? internalPilot
        ? {name:'Cliente piloto',cashback:0,cashbackDebt:0,purchases:0,referralCode:'PILOTOJR',commissionAvailable:0,commissionPending:0,referredBy:null,cashEarningEligible:true,identityType:'pilot'}
        : {name:'Carlos',cashback:7.50,cashbackDebt:0,purchases:4,referralCode:'CARLOS27',commissionAvailable:0,commissionPending:0,referredBy:null,cashEarningEligible:true,identityType:'test'}
      : {name:'',cashback:0,cashbackDebt:0,purchases:0,referralCode:'',commissionAvailable:0,commissionPending:0,referredBy:null,cashEarningEligible:false,identityType:'uninitialized'},
    address:'',
    postalCode:'',
    addressNumber:'',
    cart:{P13:0,P20:0,P45:0,WATER20:0,CHARCOAL4:0,WOOD:0,ICE5:0},
    checkout:{paymentMethod:'pix',useCashback:false,cashTenderCents:null,glpContainerMode:'exchange',deliveryMode:'now',deliveryWindowStart:null,deliveryWindowEnd:null,deliveryWindowLabel:null,customerPhoneDigits:'',addressComplement:'',deliveryReference:'',deliveryNotes:''},
    merchants:testDemo
      ? internalPilot
        ? [
            (()=>{const m=freshMerchant('JR-PILOT','Gas e Lenheira do JR — SIMULAÇÃO',120.00,30,2.0,90,{P13:20},{});m.pricingP13={mode:'range',min:115.90,preferred:120.00,max:125.00,strategy:'balanced'};return m})()
          ]
        : [
            freshMerchant('A','Revenda Parceira A',116.90,34,3.8,94,{P13:24,WATER20:18,CHARCOAL4:12,WOOD:8,ICE5:14},{WATER20:15.90,CHARCOAL4:19.90,WOOD:24.90,ICE5:12.00}),
            freshMerchant('B','Revenda Parceira B',119.90,19,1.9,97,{P13:31,WATER20:22,CHARCOAL4:10,WOOD:0,ICE5:16},{WATER20:14.90,CHARCOAL4:21.90,WOOD:null,ICE5:11.50}),
            freshMerchant('C','Revenda Parceira C',122.90,13,1.1,98,{P13:18,WATER20:0,CHARCOAL4:20,WOOD:11,ICE5:9},{WATER20:null,CHARCOAL4:18.90,WOOD:22.90,ICE5:13.00})
          ]
      :[],
    orders:[],
    selectedMerchant:testDemo?(internalPilot?'JR-PILOT':'A'):null,
    onboarding:[]
  };
}
function normalizeCart(cart={}){
  for(const code of Object.keys(cart||{}))ensureProductDefinition(code);
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
  const rawPolicy=raw?.pricingP13||{};
  const mode=rawPolicy.mode==='range'?'range':'fixed';
  const strategy=['volume','balanced','margin'].includes(rawPolicy.strategy)?rawPolicy.strategy:'balanced';
  let min=Number(rawPolicy.min),max=Number(rawPolicy.max);
  if(!Number.isFinite(min)||min<=0)min=m.priceP13;
  if(!Number.isFinite(max)||max<=0)max=m.priceP13;
  min=roundMoney(min);max=roundMoney(max);
  if(mode==='fixed'||min>m.priceP13||m.priceP13>max){min=m.priceP13;max=m.priceP13}
  m.pricingP13={mode,min,preferred:m.priceP13,max,strategy};
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
  if(!raw||typeof raw!=='object')return base;
  const testDemo=globalThis.__CHAMA_TEST__===true;
  const merged=testDemo?{...base,...raw}:{...base};

  merged.version=STATE_VERSION;
  merged.checkout={...base.checkout,...(raw.checkout||{})};
  merged.checkout.paymentMethod=['pix','card','cash'].includes(merged.checkout.paymentMethod)?merged.checkout.paymentMethod:'pix';
  merged.checkout.useCashback=Boolean(merged.checkout.useCashback);
  merged.checkout.glpContainerMode=merged.checkout.glpContainerMode==='needs_container'?'needs_container':'exchange';
  merged.checkout.deliveryMode=merged.checkout.deliveryMode==='scheduled'?'scheduled':'now';
  const scheduleStart=Date.parse(String(merged.checkout.deliveryWindowStart||''));
  const scheduleEnd=Date.parse(String(merged.checkout.deliveryWindowEnd||''));
  const scheduleNow=Date.now();
  const validSchedule=merged.checkout.deliveryMode==='scheduled'
    &&Number.isFinite(scheduleStart)
    &&Number.isFinite(scheduleEnd)
    &&scheduleEnd>scheduleStart
    &&scheduleStart>=scheduleNow+30*60*1000
    &&scheduleStart<=scheduleNow+72*60*60*1000
    &&scheduleEnd-scheduleStart>=60*60*1000
    &&scheduleEnd-scheduleStart<=4*60*60*1000;
  if(!validSchedule){
    merged.checkout.deliveryMode='now';
    merged.checkout.deliveryWindowStart=null;
    merged.checkout.deliveryWindowEnd=null;
    merged.checkout.deliveryWindowLabel=null;
  }else{
    merged.checkout.deliveryWindowStart=new Date(scheduleStart).toISOString();
    merged.checkout.deliveryWindowEnd=new Date(scheduleEnd).toISOString();
    merged.checkout.deliveryWindowLabel=String(merged.checkout.deliveryWindowLabel||'Entrega agendada').slice(0,80);
  }
  const cashTender=Number(merged.checkout.cashTenderCents);
  merged.checkout.cashTenderCents=merged.checkout.paymentMethod==='cash'&&Number.isInteger(cashTender)&&cashTender>0&&cashTender<=1000000
    ? cashTender
    : null;
  merged.checkout.customerPhoneDigits=String(merged.checkout.customerPhoneDigits||'').replace(/\D/g,'').slice(0,11);
  const normalizeDeliveryText=(value,max)=>String(value||'').trim().replace(/\s+/g,' ').slice(0,max);
  merged.checkout.addressComplement=normalizeDeliveryText(merged.checkout.addressComplement,120);
  merged.checkout.deliveryReference=normalizeDeliveryText(merged.checkout.deliveryReference,160);
  merged.checkout.deliveryNotes=normalizeDeliveryText(merged.checkout.deliveryNotes,240);
  merged.address=String(raw.address||'').slice(0,testDemo?160:240);
  merged.postalCode=String(raw.postalCode||'').replace(/\D/g,'').slice(0,8);
  merged.addressNumber=String(raw.addressNumber||'').trim().toUpperCase().replace(/\s+/g,'').slice(0,7);
  merged.cart=synchronizeGlpContainerCart(
    normalizeCart(raw.cart),
    merged.checkout.glpContainerMode
  );

  if(!testDemo){
    // Financial, merchant, order and onboarding state is server-authoritative.
    // Never hydrate those fields from browser storage.
    merged.user={...base.user};
    merged.mode='customer';
    merged.onboarding=[];
    merged.orders=[];
    merged.merchants=[];
    merged.selectedMerchant=null;
    return merged;
  }

  merged.user={...base.user,...(raw.user||{})};
  merged.user.cashback=Math.max(0,roundMoney(Number(merged.user.cashback)||0));
  merged.user.cashbackDebt=Math.max(0,roundMoney(Number(merged.user.cashbackDebt)||0));
  merged.user.purchases=Math.max(0,Math.trunc(Number(merged.user.purchases)||0));
  merged.user.commissionAvailable=Math.max(0,roundMoney(Number(merged.user.commissionAvailable)||0));
  merged.user.commissionPending=Math.max(0,roundMoney(Number(merged.user.commissionPending)||0));
  merged.user.referralCode=String(merged.user.referralCode||base.user.referralCode).slice(0,40);
  merged.user.cashEarningEligible=merged.user.cashEarningEligible!==false;
  merged.user.identityType=String(merged.user.identityType||base.user.identityType).slice(0,24);
  merged.mode=raw.mode==='merchant'?'merchant':'customer';
  merged.onboarding=Array.isArray(raw.onboarding)?raw.onboarding.slice(0,100):[];
  merged.orders=Array.isArray(raw.orders)?raw.orders.slice(-100):[];
  merged.merchants=base.merchants.map(b=>{
    const found=(Array.isArray(raw.merchants)?raw.merchants:[]).find(x=>x?.id===b.id);
    return normalizeMerchant(found||{},b);
  });
  merged.selectedMerchant=merged.merchants.some(m=>m.id===raw.selectedMerchant)?raw.selectedMerchant:(merged.merchants[0]?.id??null);
  return merged;
}

let storageHealthy=true;
function isLiveStateScope(){
  if(globalThis.__CHAMA_TEST__===true)return false;
  const params=new URLSearchParams(location.search);
  return params.get('merchant')!=='1'&&params.get('admin')!=='1';
}
function appStateStorage(){
  return isLiveStateScope()?sessionStorage:localStorage;
}
function freshLiveSeed(){
  const seed=freshSeed();
  seed.user={
    ...seed.user,
    name:'',
    cashback:0,
    purchases:0,
    referralCode:'',
    commissionAvailable:0,
    commissionPending:0,
    referredBy:null,
    cashEarningEligible:false,
    identityType:'anonymous'
  };
  seed.address='';
  seed.postalCode='';
  seed.addressNumber='';
  seed.cart=normalizeCart({});
  seed.orders=[];
  seed.onboarding=[];
  return seed;
}
function load(){
  try{
    const storage=appStateStorage();
    const raw=storage.getItem(STORAGE)??(!isLiveStateScope()?localStorage.getItem(LEGACY_STORAGE):null);
    if(!raw&&isLiveStateScope())return freshLiveSeed();
    return normalizeState(raw?JSON.parse(raw):null);
  }catch(e){
    storageHealthy=false;
    console.warn('Falha ao carregar estado local',e);
    return isLiveStateScope()?freshLiveSeed():freshSeed();
  }
}
let state=load();

function save(){
  try{
    appStateStorage().setItem(STORAGE,JSON.stringify(state));
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
  toast(globalThis.CHAMA_INTERNAL_PILOT===true?'Piloto interno reiniciado':'Demonstração reiniciada');
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
function demoPricingPressure(m,k,qty=1){
  const active=(state?.orders||[]).filter(o=>o.merchantId===m.id&&isLiveOrder(o)).length;
  const recent=Math.max(0,Number(m.delivered)||0);
  const stock=Math.max(Number(qty)||1,inventoryFor(m,k));
  const requested=Math.max(1,Number(qty)||1);
  const activePressure=clamp(active/5,0,1);
  const coverage=stock/requested;
  const stockPressure=clamp((5-coverage)/4,0,1);
  const recentPressure=clamp(recent/100,0,1);
  return clamp(activePressure*.55+stockPressure*.30+recentPressure*.15,0,1);
}
function demoRangePrice(m,k,qty=1){
  if(k!=='P13')return m.products?.[k]??null;
  const policy=m.pricingP13||{mode:'fixed',min:m.priceP13,preferred:m.priceP13,max:m.priceP13,strategy:'balanced'};
  if(policy.mode!=='range')return m.priceP13;
  const min=Number(policy.min),pref=Number(m.priceP13),max=Number(policy.max);
  if(!Number.isFinite(min)||!Number.isFinite(pref)||!Number.isFinite(max)||min>pref||pref>max)return m.priceP13;
  const pressure=demoPricingPressure(m,k,qty);
  let position=policy.strategy==='volume'?pressure*.80:policy.strategy==='margin'?.50+pressure*.50:.25+pressure*.50;
  position=clamp(position,0,1);
  const target=position<=.5
    ? min+(pref-min)*(position/.5)
    : pref+(max-pref)*((position-.5)/.5);
  return roundMoney(clamp(target,min,max));
}
function productPrice(m,k,qty=1){
  if(k==='P13') return demoRangePrice(m,k,qty);
  return m.products?.[k]??null;
}
function inventoryFor(m,k){return Number(m.inventory?.[k]??0)}
function hasCartItems(cart=state.cart){return Object.values(cart).some(q=>Number(q)>0)}
function cartUnits(cart=state.cart){return Object.values(cart).reduce((a,b)=>a+(Number(b)||0),0)}
function cartAvailableFor(m,cart){
  if(!m||!m.online||!isPriceFresh(m)||!hasCartItems(cart)) return false;
  return Object.entries(cart).every(([k,q])=>{
    q=Number(q)||0;if(q<=0)return true;
    const price=productPrice(m,k,q);
    return price!=null&&Number.isFinite(Number(price))&&inventoryFor(m,k)>=q;
  });
}
function cartSubtotalFor(m,cart){
  if(!cartAvailableFor(m,cart)) return null;
  let total=0;
  for(const [k,q] of Object.entries(cart)){
    if(q<=0)continue;
    total+=q*Number(productPrice(m,k,q));
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
  if(globalThis.CHAMA_INTERNAL_PILOT===true&&eligible.length===1){
    eligible[0].roles=['Disponível agora'];
    return eligible;
  }
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
  return Object.entries(cart).filter(([,q])=>q>0).map(([k,q])=>{
    const unitPrice=Number(productPrice(m,k,q));
    return {key:k,name:(ensureProductDefinition(k)?.name||k),qty:q,unitPrice,lineTotal:roundMoney(q*unitPrice)};
  });
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
  if(!o)return {ok:false,error:'Pedido não encontrado'};
  if(['OFFERED_TO_MERCHANT','REQUOTE_REQUIRED'].includes(o.status)){
    transition(o,'CANCELLED','Cancelado pelo cliente','O pedido foi cancelado antes do compromisso de entrega.');
    restoreCashback(o);save();return {ok:true};
  }
  if(['PREPARING','AT_RISK'].includes(o.status)&&!o.dispatchedAt){
    const m=merchantById(o.merchantId);
    if(o.inventoryReserved){
      releaseInventory(m,o.cart);
      o.inventoryReserved=false;
    }
    const r=transition(o,'CANCELLED','Cancelado antes da saída','O estoque reservado foi devolvido antes da saída.');
    if(!r.ok)return r;
    restoreCashback(o);save();return {ok:true};
  }
  return {ok:false,error:'A entrega já saiu; o cancelamento automático não é mais permitido'};
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
  const grossCents=Math.max(0,Math.round((Number(o.grossTotal)||0)*100));
  const earnedCents=Math.floor((grossCents*100)/10000);
  const earned=earnedCents/100;
  state.user.purchases=(Number(state.user.purchases)||0)+1;
  state.user.cashback=roundMoney((Number(state.user.cashback)||0)+earned);
  o.cashbackEarned=earned;
  o.rewardEconomics={
    platformFee:Math.floor((grossCents*750)/10000)/100,
    variableReserve:Math.ceil((grossCents*75)/10000)/100,
    minimumContribution:Math.ceil((grossCents*250)/10000)/100
  };
}
function deliverOrder(id,pin,paymentConfirmed=false){
  const o=orderById(id);if(!o||o.status!=='ARRIVING')return {ok:false,error:'Pedido ainda não está pronto para confirmação de entrega'};
  if(paymentConfirmed!==true)return {ok:false,error:'Confirme o recebimento do pagamento antes de concluir'};
  if(o.pinFailures>=MAX_PIN_FAILURES)return {ok:false,error:'PIN bloqueado após muitas tentativas. Abra suporte.'};
  if(String(pin||'').trim()!==o.pin){
    o.pinFailures=(o.pinFailures||0)+1;
    appendEvent(o,'PIN_FAILED','PIN incorreto',`Tentativa ${o.pinFailures} de ${MAX_PIN_FAILURES}.`);
    save();return {ok:false,error:o.pinFailures>=MAX_PIN_FAILURES?'PIN bloqueado. Abra suporte.':'PIN incorreto — entrega não concluída'};
  }
  o.paymentConfirmedAt=nowIso();
  appendEvent(o,'PAYMENT_CONFIRMED','Pagamento confirmado','A revenda confirmou o recebimento do pagamento.');
  let r=transition(o,'DELIVERED','Entregue ✓','PIN validado com sucesso.');if(!r.ok)return r;
  o.deliveredAt=nowIso();
  const m=merchantById(o.merchantId);if(m)m.delivered++;
  r=transition(o,'SETTLED','Pedido concluído','Entrega e pagamento conciliados na demonstração; benefícios foram processados.');
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
function updateMerchant(id,{priceP13,stockP13,pricingMode,pricingMin,pricingMax,pricingStrategy}){
  const m=merchantById(id);if(!m)return {ok:false,error:'Revenda não encontrada'};
  const price=Number(priceP13),stock=Number(stockP13);
  if(!Number.isFinite(price)||price<=0||price>9999)return {ok:false,error:'Preço inválido'};
  if(!Number.isFinite(stock)||stock<0||stock>9999)return {ok:false,error:'Estoque inválido'};
  const mode=pricingMode==='range'?'range':'fixed';
  const strategy=['volume','balanced','margin'].includes(pricingStrategy)?pricingStrategy:'balanced';
  let min=mode==='range'?Number(pricingMin):price;
  let max=mode==='range'?Number(pricingMax):price;
  if(!Number.isFinite(min)||!Number.isFinite(max)||min<=0||max>9999||min>price||price>max){
    return {ok:false,error:'Na faixa automática: mínimo ≤ preço normal ≤ máximo.'};
  }
  m.priceP13=roundMoney(price);
  m.pricingP13={mode,min:roundMoney(min),preferred:roundMoney(price),max:roundMoney(max),strategy};
  m.inventory.P13=Math.trunc(stock);m.priceConfirmedAt=nowIso();m.lastSeenAt=nowIso();save();return {ok:true};
}
function setCartProduct(k,qty){
  k=String(k||'').trim().toUpperCase();
  if(!ensureProductDefinition(k))return;
  state.cart[k]=clamp(Math.trunc(Number(qty)||0),0,99);
  synchronizeGlpContainerCart(state.cart,state.checkout.glpContainerMode);
  save();
}
function startOrder(k='P13'){
  k=String(k||'').trim().toUpperCase();
  if(!ensureProductDefinition(k))k='P13';
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
  if(globalThis.adminPortalRequested?.()){
    const status=globalThis.adminRuntime?.status||'loading';
    if(status==='ready')return '<div class="demo-strip live-strip"><span>● ADMIN PROTEGIDO • control plane server-side</span><button onclick="openCustomerPortal()">Sair do admin</button></div>';
    if(status==='loading'||status==='disabled')return '<div class="demo-strip live-strip"><span>Conectando ao control plane administrativo…</span></div>';
    if(status==='unauthenticated')return '<div class="demo-strip"><span>Administração • conta permanente e autorização explícita</span><button onclick="openCustomerPortal()">Voltar ao site</button></div>';
    if(status==='no-access')return '<div class="demo-strip blocked-strip"><span>Conta autenticada sem permissão administrativa</span><button onclick="openCustomerPortal()">Voltar ao site</button></div>';
    return '<div class="demo-strip blocked-strip"><span>Control plane administrativo indisponível</span><button onclick="openCustomerPortal()">Voltar ao site</button></div>';
  }
  if(globalThis.merchantPortalRequested?.()){
    const status=globalThis.merchantRuntime?.status||'loading';
    if(status==='ready')return '<div class="demo-strip live-strip"><span>● PAINEL REAL DA REVENDA • operações gravadas no Supabase</span><button onclick="openCustomerPortal()">Sair do painel</button></div>';
    if(status==='loading'||status==='disabled')return '<div class="demo-strip live-strip"><span>Conectando ao painel real da revenda…</span></div>';
    if(status==='unauthenticated')return '<div class="demo-strip"><span>Painel da revenda • autenticação permanente necessária</span><button onclick="openCustomerPortal()">Voltar ao site</button></div>';
    if(status==='no-access')return '<div class="demo-strip blocked-strip"><span>Conta autenticada, mas ainda sem revenda vinculada</span><button onclick="openCustomerPortal()">Voltar ao site</button></div>';
    if(status==='unsafe-origin')return '<div class="demo-strip blocked-strip"><span>Painel real bloqueado nesta origem compartilhada</span><button onclick="openCustomerPortal()">Voltar ao site</button></div>';
    return '<div class="demo-strip blocked-strip"><span>Painel da revenda indisponível no momento</span><button onclick="openCustomerPortal()">Voltar ao site</button></div>';
  }
  if(globalThis.__CHAMA_TEST__===true){
    if(globalThis.CHAMA_INTERNAL_PILOT===true){
      return '<div class="demo-strip"><span>🧪 PILOTO INTERNO • nenhum pedido, pagamento ou estoque desta tela é real</span><button onclick="reset()">Reiniciar piloto</button></div>';
    }
    return '<div class="demo-strip"><span>Ambiente isolado de teste automatizado</span><button onclick="reset()">Reiniciar teste</button></div>';
  }
  const mode=globalThis.liveBanner?.()||'connecting';
  const preview=globalThis.prelaunchExamplesEnabled?.()===true;
  if(mode==='live'){
    if(preview)return '<div class="demo-strip"><span>PRÉ-LANÇAMENTO • conheça a experiência enquanto formamos a primeira rede de parceiros</span></div>';
    return '<div class="demo-strip live-strip"><span>● OPERAÇÃO ATIVA • consulte opções reais para o seu endereço</span></div>';
  }
  if(mode==='connecting')return '<div class="demo-strip live-strip"><span>Preparando sua experiência…</span></div>';
  if(globalThis.liveRuntime?.status==='unsafe-origin'){
    return '<div class="demo-strip"><span>PRÉ-LANÇAMENTO • compras reais serão liberadas na abertura oficial desta experiência</span></div>';
  }
  return '<div class="demo-strip blocked-strip"><span>Serviço temporariamente indisponível • nenhum pedido foi criado</span></div>';
}
function siteFooter({adminPortal=false}={}){
  if(adminPortal)return '';
  return '<footer class="site-footer"><div class="shell site-footer-inner"><div><strong>TAMÃO</strong><small>Pediu? Tá na mão. • Pré-lançamento em São Gabriel/RS</small></div><nav aria-label="Informações legais"><button onclick="go(\'privacy\')">Privacidade</button><button onclick="go(\'terms\')">Termos</button><button onclick="go(\'contact\')">Contato</button></nav></div></footer>';
}
function shell(content){
  const r=route();
  const adminPortal=globalThis.adminPortalRequested?.()===true;
  const merchantPortal=!adminPortal&&globalThis.merchantPortalRequested?.()===true;
  const testDemo=globalThis.__CHAMA_TEST__===true;
  const prelaunchPublic=!adminPortal&&!merchantPortal&&!testDemo&&globalThis.prelaunchExamplesEnabled?.()===true;
  const merchantOriginReady=String(globalThis.CHAMA_MERCHANT_ORIGIN||'').trim().length>0;
  const merchantAction=merchantPortal?"go('merchant')":testDemo?"setMode('merchant')":prelaunchPublic||!merchantOriginReady?"go('merchants')":"openMerchantPortal()";
  const customerAction=(adminPortal||merchantPortal)?"openCustomerPortal()":testDemo?"setMode('customer')":"go('home')";
  const brandAction=adminPortal?"go('admin')":merchantPortal?"go('merchant')":"go('home')";
  const desktopNav=adminPortal
    ? '<button onclick="go(\'admin\')">Control plane</button>'
    :merchantPortal
      ? '<button onclick="go(\'merchant\')">Operação</button><button onclick="go(\'catalog\')">Catálogo</button><button onclick="go(\'merchants\')">Parceiros</button>'
      : prelaunchPublic
        ? '<button onclick="go(\'home\')">Início</button><button onclick="openPrelaunchCustomerLead()">Lista de abertura</button><button onclick="go(\'learn\')">Como funciona</button><button onclick="go(\'merchants\')">Para empresas</button><button onclick="go(\'contact\')">Contato</button>'
        : '<button onclick="go(\'home\')">Início</button><button onclick="go(\'learn\')">Como funciona</button><button onclick="go(\'earn\')">Ganhe</button><button onclick="go(\'club\')">Clube</button><button onclick="go(\'merchants\')">Para revendas</button>';
  const switcher=adminPortal
    ? '<div class="mode-pill" aria-label="Alternar ambiente"><button onclick="openCustomerPortal()">Site</button><button class="active" onclick="go(\'admin\')">Admin</button></div>'
    : `<div class="mode-pill" aria-label="Alternar modo"><button class="${!merchantPortal&&(!testDemo||state.mode==='customer')&&r!=='merchants'?'active':''}" onclick="${customerAction}">${prelaunchPublic?'Quero comprar':'Comprar'}</button><button class="${merchantPortal||(testDemo&&state.mode==='merchant')||(!merchantPortal&&r==='merchants')?'active':''}" onclick="${merchantAction}">${prelaunchPublic?'Quero vender':'Revenda'}</button></div>`;
  return `<div class="app">
  ${runtimeStrip()}
  <header class="topbar"><div class="shell topbar-inner">
    <button class="brand brand-button" onclick="${brandAction}" aria-label="Ir para o início do TAMÃO"><div class="brandmark"><img src="./icons/icon.svg" alt=""></div><div><span class="brand-name">TAMÃO</span><small>Pediu? Tá na mão.</small></div></button>
    <div class="desktop-only desktop-nav">${desktopNav}</div>
    ${switcher}
  </div></header>
  <main class="shell">${content}</main>
  ${siteFooter({adminPortal})}
  ${bottomNav(r)}
  </div>`;
}
function bottomNav(r){
  const adminPortal=globalThis.adminPortalRequested?.()===true;
  const merchantPortal=!adminPortal&&globalThis.merchantPortalRequested?.()===true;
  const testDemo=globalThis.__CHAMA_TEST__===true;
  const prelaunchPublic=!adminPortal&&!merchantPortal&&!testDemo&&globalThis.prelaunchExamplesEnabled?.()===true;
  const items=adminPortal
    ?[['admin','🛡️','Admin','go']]
    :merchantPortal
      ?globalThis.merchantRuntime?.merchant?.memberRole==='driver'
        ?[['merchant','🚚','Entregas','go']]
        :[['merchant','🏪','Operação','go'],['merchant-orders','📦','Pedidos','go'],['merchant-team','👥','Equipe','go'],['catalog','🧺','Catálogo','go']]
      :testDemo&&state.mode==='merchant'
        ?[['merchant','🏪','Operação','go'],['merchant-orders','📦','Pedidos','go'],['catalog','🧺','Catálogo','go'],['merchant-metrics','📊','Desempenho','go'],['merchants','➕','Parceiros','go']]
        :prelaunchPublic
          ?[['home','⌂','Início','go'],['early-access','🔔','Abertura','lead'],['learn','🛡️','Como funciona','go'],['merchants','🏪','Vender','go'],['contact','💬','Contato','go']]
          :[['home','⌂','Início','go'],['order','🔥','Pedir','start'],['tracking','📍','Pedido','go'],['earn','💰','Ganhe','go'],['club','★','Clube','go']];
  return `<nav class="bottom-nav" aria-label="Navegação principal">${items.map(([id,ic,l,act])=>{
    const active=r===id;
    const onclick=act==='start'?"startOrder('P13')":act==='lead'?"openPrelaunchCustomerLead()":`go('${id}')`;
    return `<button class="nav-btn ${active?'active':''}" ${active?'aria-current="page"':''} onclick="${onclick}"><span aria-hidden="true">${ic}</span><span>${l}</span></button>`;
  }).join('')}</nav>`;
}
function setMode(m){state.mode=m==='merchant'?'merchant':'customer';save();go(state.mode==='merchant'?'merchant':'home');render()}

parseReferral();

if(globalThis.__CHAMA_TEST__){
  globalThis.ChamaTest={
    freshSeed,normalizeState,normalizeCart,ensureProductDefinition,glpKgForProductCode,cartAvailableFor,cartTotalFor,offersForCart,isPriceFresh,minPrice,
    createOrderForMerchant,acceptOrder,rejectOrder,failAcceptedOrder,dispatchOrder,arrivingOrder,deliverOrder,customerCancel,
    reassignOrder,acceptRequote,transition,updateMerchant,pauseMerchant,resumeMerchant,setCartProduct,grantRewards,
    hasCartItems,esc,housekeeping,normalizeCnpj,isValidCnpjShape,
    getState:()=>state,setState:s=>{state=normalizeState(s);save();}
  };
}
