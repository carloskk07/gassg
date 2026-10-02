const CHAMA_BACKEND={
  url:'https://lgugwujpunhslavewffd.supabase.co',
  publishableKey:'sb_publishable_3FLGyrWHrUZ5vQc59Iowug_pekOZ9u_',
  orderStorageKey:'chama-live-order-id-v1'
};
const SUPABASE_BROWSER_URL='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
const SUPABASE_BROWSER_SRI='sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok';
const CHAMA_NETWORK_TIMEOUT_MS=15000;
let supabaseLoadPromise=null;

async function chamaFetch(input,init={},timeoutMs=CHAMA_NETWORK_TIMEOUT_MS){
  const controller=new AbortController();
  const externalSignal=init?.signal;
  let timeoutId=null;
  let abortListener=null;
  if(externalSignal?.aborted)controller.abort(externalSignal.reason);
  else if(externalSignal){
    abortListener=()=>controller.abort(externalSignal.reason);
    externalSignal.addEventListener('abort',abortListener,{once:true});
  }
  timeoutId=setTimeout(()=>controller.abort(new DOMException('Tempo limite de rede excedido','TimeoutError')),Math.max(1,Number(timeoutMs)||CHAMA_NETWORK_TIMEOUT_MS));
  try{
    return await fetch(input,{...init,signal:controller.signal});
  }catch(error){
    if(controller.signal.aborted&&!externalSignal?.aborted){
      const timeoutError=new Error('A conexão demorou demais. Verifique sua internet e tente novamente.');
      timeoutError.code='NETWORK_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  }finally{
    clearTimeout(timeoutId);
    if(abortListener)externalSignal.removeEventListener('abort',abortListener);
  }
}

const customerPortalParams=new URLSearchParams(location.search);
const liveRuntime={
  requested:globalThis.__CHAMA_TEST__===true
    ? false
    : customerPortalParams.get('merchant')!=='1'&&customerPortalParams.get('admin')!=='1',
  status:'disabled',
  client:null,
  session:null,
  offers:[],
  order:null,
  orderId:null,
  loadingOffers:false,
  actionPending:false,
  error:null,
  deliveryCompatibilityBlocked:false,
  marketMode:null,
  eligibleMerchantCount:0,
  displayedOfferCount:0,
  marketStatus:null,
  lastMarketStatusAt:0,
  lastFinancialSyncAt:0,
  lastFinancialSyncAttemptAt:0,
  lastSyncAt:null,
  offerRequestSeq:0,
  orderRequestSeq:0
};

function customerOriginSafe(){
  if(['localhost','127.0.0.1'].includes(location.hostname))return true;
  const configured=String(globalThis.CHAMA_CUSTOMER_ORIGIN||'').trim();
  return configured.length>0&&location.origin===configured;
}
function liveRequested(){return liveRuntime.requested}
function liveReady(){return liveRuntime.requested&&liveRuntime.status==='ready'}

function liveBanner(){
  if(!liveRuntime.requested)return 'demo';
  if(liveRuntime.status==='ready')return 'live';
  if(liveRuntime.status==='loading')return 'connecting';
  return 'blocked';
}

function buildPortalHref(configuredOrigin,portal,current=location){
  const currentOrigin=String(current?.origin||'').trim();
  const currentHostname=String(current?.hostname||'').trim().toLowerCase();
  const configured=String(configuredOrigin||'').trim();
  const local=['localhost','127.0.0.1'].includes(currentHostname);
  const targetOrigin=local?currentOrigin:configured;
  if(!targetOrigin)return null;

  let originUrl;
  try{originUrl=new URL(targetOrigin)}catch{return null}
  if(!local&&originUrl.origin!==targetOrigin)return null;

  const pathname=local?(String(current?.pathname||'/')||'/'):'/';
  const url=new URL(pathname,originUrl.origin);
  url.search='';
  if(portal==='merchant'){
    url.searchParams.set('merchant','1');
    url.hash='merchant';
  }else if(portal==='admin'){
    url.searchParams.set('admin','1');
    url.hash='admin';
  }else if(portal==='customer'){
    url.hash='home';
  }else{
    return null;
  }
  return url.toString();
}

function loadSupabaseBrowser(){
  if(globalThis.supabase?.createClient)return Promise.resolve(globalThis.supabase);
  if(supabaseLoadPromise)return supabaseLoadPromise;

  supabaseLoadPromise=new Promise((resolve,reject)=>{
    document.querySelectorAll('script[data-chama-supabase]').forEach(node=>node.remove());
    const script=document.createElement('script');
    let settled=false;
    const timer=setTimeout(()=>finish(false,new Error('Tempo limite ao carregar Supabase JS')),12000);

    function finish(ok,value){
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      script.onload=null;
      script.onerror=null;
      if(!ok){
        script.remove();
        supabaseLoadPromise=null;
        reject(value);
        return;
      }
      resolve(value);
    }

    script.src=SUPABASE_BROWSER_URL;
    script.integrity=SUPABASE_BROWSER_SRI;
    script.async=true;
    script.dataset.chamaSupabase='1';
    script.crossOrigin='anonymous';
    script.onload=()=>globalThis.supabase?.createClient
      ?finish(true,globalThis.supabase)
      :finish(false,new Error('Supabase JS não inicializou'));
    script.onerror=()=>finish(false,new Error('Falha ao carregar Supabase JS'));
    document.head.appendChild(script);
  });
  return supabaseLoadPromise;
}

async function backendInit(){
  if(!liveRuntime.requested){
    liveRuntime.status='disabled';
    return false;
  }
  if(!customerOriginSafe()){
    liveRuntime.status='unsafe-origin';
    liveRuntime.error='O piloto real do cliente exige uma origem dedicada e isolada.';
    return false;
  }
  if(liveRuntime.status==='ready')return true;
  liveRuntime.status='loading';
  liveRuntime.error=null;
  try{
    const lib=await loadSupabaseBrowser();
    const client=lib.createClient(CHAMA_BACKEND.url,CHAMA_BACKEND.publishableKey,{
      auth:{
        persistSession:true,
        autoRefreshToken:true,
        detectSessionInUrl:true,
        storage:localStorage,
        storageKey:'chama-sg-customer-auth-v2'
      },
      global:{fetch:chamaFetch}
    });
    liveRuntime.client=client;

    let {data:{session},error}=await client.auth.getSession();
    if(error)throw error;

    if(!session){
      if(!globalThis.chamaTurnstile?.challenge){
        throw new Error('Proteção anti-bot indisponível');
      }
      const captchaToken=await globalThis.chamaTurnstile.challenge('anonymous_signin');
      if(!captchaToken)throw new Error('Token anti-bot ausente');
      const response=await client.auth.signInAnonymously({
        options:{captchaToken}
      });
      if(response.error)throw response.error;
      session=response.data.session;
    }
    if(!session?.access_token)throw new Error('Sessão anônima não foi criada');

    liveRuntime.session=session;
    liveRuntime.status='ready';
    liveRuntime.orderId=localStorage.getItem(CHAMA_BACKEND.orderStorageKey)||null;

    await liveSyncFinancialProfile();
    try{await liveSyncMarketStatus({force:true})}
    catch(e){console.warn('Estado do mercado real indisponível',e)}

    if(liveRuntime.orderId){
      try{await liveGetOrder(liveRuntime.orderId,{silent:true})}
      catch(e){
        console.warn('Pedido live anterior não pôde ser restaurado',e);
        localStorage.removeItem(CHAMA_BACKEND.orderStorageKey);
        liveRuntime.orderId=null;
        liveRuntime.order=null;
      }
    }
    return true;
  }catch(error){
    console.warn('Modo live indisponível',error);
    liveRuntime.status='unavailable';
    liveRuntime.error=String(error?.message||error||'Backend indisponível');
    return false;
  }
}

async function liveAccessToken(){
  if(!liveRuntime.client)throw new Error('Cliente Supabase indisponível');
  const {data:{session},error}=await liveRuntime.client.auth.getSession();
  if(error||!session?.access_token)throw error||new Error('Sessão expirada');
  liveRuntime.session=session;
  return session.access_token;
}

async function liveInvoke(name,body={},options={}){
  if(!liveReady())throw new Error('Modo live não está pronto');
  const token=await liveAccessToken();
  const headers={
    'Content-Type':'application/json',
    'apikey':CHAMA_BACKEND.publishableKey,
    'Authorization':'Bearer '+token
  };
  if(options.idempotencyKey)headers['Idempotency-Key']=options.idempotencyKey;

  const response=await chamaFetch(CHAMA_BACKEND.url+'/functions/v1/'+encodeURIComponent(name),{
    method:'POST',
    headers,
    body:JSON.stringify(body),
    cache:'no-store'
  });
  let data=null;
  try{data=await response.json()}catch{}
  if(!response.ok){
    const err=new Error(data?.message||data?.error||('HTTP '+response.status));
    err.code=data?.error||'HTTP_'+response.status;
    err.status=response.status;
    err.data=data;
    throw err;
  }
  return data;
}

function liveCartItems(){
  return Object.entries(state.cart)
    .filter(([,quantity])=>Number(quantity)>0)
    .map(([productCode,quantity])=>({productCode,quantity:Number(quantity)}));
}

function liveOfferView(raw){
  const roleMap={available:'Disponível agora',recommended:'Recomendado',cheapest:'Mais barato',fastest:'Mais rápido',alternative:'Alternativa'};
  return {
    id:raw.quoteId,
    quoteId:raw.quoteId,
    roles:[roleMap[raw.label]||'Opção'],
    total:Number(raw.totalCents||0)/100,
    eta:Number(raw.etaMinMinutes||0),
    etaMax:Number(raw.etaMaxMinutes||raw.etaMinMinutes||0),
    trust:Number(raw.trustScore||0),
    expiresAt:raw.expiresAt,
    live:true
  };
}

let liveOfferTimer=null;
function liveScheduleOfferRefresh(delay=350){
  if(!liveReady())return;
  clearTimeout(liveOfferTimer);
  liveOfferTimer=setTimeout(()=>{
    if(state.address&&hasCartItems()){
      liveRefreshOffers().catch(()=>{});
    }
  },delay);
}

async function liveRefreshOffers({silent=false}={}){
  const seq=++liveRuntime.offerRequestSeq;
  if(!liveReady()||!state.address||!hasCartItems()){
    liveRuntime.offers=[];
    liveRuntime.deliveryCompatibilityBlocked=false;
    liveRuntime.marketMode=null;
    liveRuntime.eligibleMerchantCount=0;
    liveRuntime.displayedOfferCount=0;
    liveRuntime.loadingOffers=false;
    if(!silent)render();
    return [];
  }
  const addressSnapshot=state.address;
  const itemsSnapshot=liveCartItems();
  liveRuntime.offers=[];
  liveRuntime.deliveryCompatibilityBlocked=false;
  liveRuntime.marketMode=null;
  liveRuntime.eligibleMerchantCount=0;
  liveRuntime.displayedOfferCount=0;
  liveRuntime.loadingOffers=true;
  liveRuntime.error=null;
  if(!silent)render();
  try{
    const data=await liveInvoke('get-offers',{
      address:addressSnapshot,
      items:itemsSnapshot,
      priority:'recommended'
    });
    if(seq!==liveRuntime.offerRequestSeq)return liveRuntime.offers;
    if(state.address!==addressSnapshot||JSON.stringify(liveCartItems())!==JSON.stringify(itemsSnapshot)){
      return liveRuntime.offers;
    }
    liveRuntime.deliveryCompatibilityBlocked=data?.deliveryCompatibilityBlocked===true;
    liveRuntime.marketMode=String(data?.marketMode||'')||null;
    liveRuntime.eligibleMerchantCount=Math.max(0,Number(data?.eligibleMerchantCount||0));
    liveRuntime.displayedOfferCount=Math.max(0,Number(data?.displayedOfferCount||0));
    liveRuntime.offers=(data?.offers||[])
      .map(liveOfferView)
      .filter(o=>Number.isFinite(Date.parse(o.expiresAt))&&Date.parse(o.expiresAt)>Date.now());
    liveRuntime.lastSyncAt=new Date().toISOString();
    return liveRuntime.offers;
  }catch(error){
    if(seq===liveRuntime.offerRequestSeq){
      liveRuntime.offers=[];
      liveRuntime.deliveryCompatibilityBlocked=false;
      liveRuntime.marketMode=null;
      liveRuntime.eligibleMerchantCount=0;
      liveRuntime.displayedOfferCount=0;
      liveRuntime.error=String(error?.message||error);
    }
    throw error;
  }finally{
    if(seq===liveRuntime.offerRequestSeq){
      liveRuntime.loadingOffers=false;
      if(!silent)render();
    }
  }
}

function liveIdempotency(prefix){
  const uuid=globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)+Date.now().toString(36);
  return prefix+':'+uuid;
}

async function liveCreateOrder(quoteId){
  if(liveRuntime.actionPending)return;
  const selected=liveRuntime.offers.find(o=>o.quoteId===quoteId);
  if(!selected||!Number.isFinite(Date.parse(selected.expiresAt))||Date.parse(selected.expiresAt)<=Date.now()+1000){
    try{await liveRefreshOffers()}catch{}
    toast('A oferta expirou. Atualizamos os preços disponíveis.');
    return;
  }
  liveRuntime.actionPending=true;
  liveRuntime.error=null;
  render();
  const idempotencyKey=liveIdempotency('create-order');
  const payload={
    quoteId,
    paymentMethod:state.checkout.paymentMethod,
    useCashback:state.checkout.useCashback===true,
    referralCode:state.user.referredBy||null
  };
  try{
    let result;
    try{
      result=await liveInvoke('create-order',payload,{idempotencyKey});
    }catch(firstError){
      const ambiguous=firstError?.code==='NETWORK_TIMEOUT'||firstError instanceof TypeError||Number(firstError?.status)>=500;
      if(!ambiguous)throw firstError;
      await new Promise(resolve=>setTimeout(resolve,250));
      result=await liveInvoke('create-order',payload,{idempotencyKey});
    }

    liveRuntime.orderId=result.orderId;
    localStorage.setItem(CHAMA_BACKEND.orderStorageKey,result.orderId);
    state.cart=normalizeCart({});
    state.checkout.useCashback=false;
    save();
    await liveGetOrder(result.orderId,{silent:true});
    go('tracking');
    toast('Pedido real enviado para confirmação do parceiro');
  }catch(error){
    let recovered=false;
    try{
      await liveSyncFinancialProfile({force:true});
      if(liveRuntime.orderId){
        await liveGetOrder(liveRuntime.orderId,{silent:true});
        recovered=true;
      }
    }catch{}
    if(recovered){
      state.cart=normalizeCart({});
      state.checkout.useCashback=false;
      save();
      go('tracking');
      toast('Pedido recuperado com segurança após uma falha de conexão.');
    }else{
      liveRuntime.error=String(error?.message||error);
      toast(liveRuntime.error);
    }
  }finally{
    liveRuntime.actionPending=false;
    render();
  }
}

async function liveGetOrder(orderId=liveRuntime.orderId,{silent=false}={}){
  if(!liveReady()||!orderId)return null;
  const seq=++liveRuntime.orderRequestSeq;
  const order=await liveInvoke('get-order',{orderId});
  const current=liveRuntime.order;
  if(current?.orderId===order.orderId&&Number(current.version)>Number(order.version))return current;
  if(seq<liveRuntime.orderRequestSeq&&current?.orderId===order.orderId&&Number(current.version)>=Number(order.version))return current;
  liveRuntime.order=order;
  liveRuntime.orderId=order.orderId;
  liveRuntime.lastSyncAt=new Date().toISOString();
  localStorage.setItem(CHAMA_BACKEND.orderStorageKey,order.orderId);
  if(['SETTLED','CANCELLED'].includes(order.status)){
    await liveSyncFinancialProfile({force:true});
  }
  if(!silent)render();
  return order;
}

async function liveCustomerAction(action){
  const order=liveRuntime.order;
  if(!order||liveRuntime.actionPending)return;
  liveRuntime.actionPending=true;
  render();
  try{
    await liveInvoke('customer-action',{
      orderId:order.orderId,
      action,
      expectedVersion:order.version
    },{idempotencyKey:liveIdempotency('customer-action')});
    await liveGetOrder(order.orderId,{silent:true});
    toast(action==='accept-requote'?'Nova condição aceita':'Pedido cancelado');
  }catch(error){
    liveRuntime.error=String(error?.message||error);
    toast(liveRuntime.error);
    try{await liveGetOrder(order.orderId,{silent:true})}catch{}
  }finally{
    liveRuntime.actionPending=false;
    render();
  }
}

async function liveSyncFinancialProfile({force=false}={}){
  if(!liveReady())return false;
  const now=Date.now();
  if(!force&&liveRuntime.lastFinancialSyncAttemptAt&&now-liveRuntime.lastFinancialSyncAttemptAt<60000){
    return false;
  }
  liveRuntime.lastFinancialSyncAttemptAt=now;
  const before=JSON.stringify({
    referralCode:state.user.referralCode,
    cashback:state.user.cashback,
    cashbackDebt:state.user.cashbackDebt,
    commissionPending:state.user.commissionPending,
    commissionAvailable:state.user.commissionAvailable,
    purchases:state.user.purchases,
    reversedPurchases:state.user.reversedPurchases,
    cashEarningEligible:state.user.cashEarningEligible,
    identityType:state.user.identityType
  });
  try{
    const summary=await liveInvoke('customer-summary',{});
    if(summary?.referralCode)state.user.referralCode=String(summary.referralCode).slice(0,40);
    state.user.cashback=Math.max(0,Number(summary?.cashbackCents||0)/100);
    state.user.cashbackDebt=Math.max(0,Number(summary?.cashbackDebtCents||0)/100);
    state.user.commissionPending=Math.max(0,Number(summary?.commissionPendingCents||0)/100);
    state.user.commissionAvailable=Math.max(0,Number(summary?.commissionAvailableCents||0)/100);
    state.user.purchases=Math.max(0,Number(summary?.settledOrders||0));
    state.user.reversedPurchases=Math.max(0,Number(summary?.reversedOrders||0));
    state.user.cashEarningEligible=summary?.cashEarningEligible===true;
    state.user.identityType=String(summary?.identityType||'anonymous');
    if(summary?.activeOrderId){
      liveRuntime.orderId=String(summary.activeOrderId);
      localStorage.setItem(CHAMA_BACKEND.orderStorageKey,liveRuntime.orderId);
    }
    liveRuntime.lastFinancialSyncAt=Date.now();
    save();
    const after=JSON.stringify({
      referralCode:state.user.referralCode,
      cashback:state.user.cashback,
      cashbackDebt:state.user.cashbackDebt,
      commissionPending:state.user.commissionPending,
      commissionAvailable:state.user.commissionAvailable,
      purchases:state.user.purchases,
      reversedPurchases:state.user.reversedPurchases,
      cashEarningEligible:state.user.cashEarningEligible,
      identityType:state.user.identityType
    });
    return before!==after;
  }catch(error){
    console.warn('Não foi possível sincronizar o resumo financeiro live',error);
    return false;
  }
}

async function liveUpgradeAccount(email){
  if(!liveReady())throw new Error('Modo live não está pronto');
  const value=String(email||'').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw new Error('Informe um e-mail válido');
  const {data:{session},error:sessionError}=await liveRuntime.client.auth.getSession();
  if(sessionError||!session?.user)throw sessionError||new Error('Sessão indisponível');
  if(session.user.is_anonymous!==true){
    state.user.cashEarningEligible=true;
    state.user.identityType='permanent';
    save();
    return {alreadyPermanent:true};
  }
  const {data,error}=await liveRuntime.client.auth.updateUser({email:value});
  if(error)throw error;
  liveRuntime.identityUpgradePending=value;
  return {pending:true,email:value,user:data?.user??null};
}

async function liveSyncMarketStatus({force=false}={}){
  if(!liveReady())return null;
  const now=Date.now();
  if(!force&&liveRuntime.marketStatus&&now-liveRuntime.lastMarketStatusAt<60000)return liveRuntime.marketStatus;
  const data=await liveInvoke('market-status',{});
  liveRuntime.marketStatus={
    realSupplyConfigured:data?.realSupplyConfigured===true,
    configuredMerchantCount:Math.max(0,Number(data?.configuredMerchantCount||0)),
    availableNow:data?.availableNow===true,
    availableMerchantCount:Math.max(0,Number(data?.availableMerchantCount||0)),
    productCodes:Array.isArray(data?.productCodes)?data.productCodes.map(code=>String(code).trim().toUpperCase()):[]
  };
  for(const code of liveRuntime.marketStatus.productCodes){
    if(globalThis.ensureProductDefinition?.(code)&&!(code in state.cart))state.cart[code]=0;
  }
  save();
  liveRuntime.lastMarketStatusAt=now;
  return liveRuntime.marketStatus;
}

function prelaunchExamplesEnabled(){
  if(globalThis.__CHAMA_TEST__===true)return false;
  if(liveRuntime.status==='unsafe-origin')return true;
  return liveRuntime.status==='ready'
    && liveRuntime.marketStatus?.realSupplyConfigured===false;
}

async function livePoll(){
  if(!liveReady()||liveRuntime.actionPending||document.visibilityState==='hidden')return;
  let changed=false;
  try{
    const before=JSON.stringify(liveRuntime.marketStatus);
    await liveSyncMarketStatus();
    changed=before!==JSON.stringify(liveRuntime.marketStatus);
  }catch{}
  try{
    changed=(await liveSyncFinancialProfile())||changed;
  }catch{}
  if(!liveRuntime.orderId){
    if(changed)render();
    return;
  }
  if(["SETTLED","CANCELLED"].includes(liveRuntime.order?.status)){
    if(changed)render();
    return;
  }
  try{
    await liveGetOrder(liveRuntime.orderId,{silent:true});
    render();
  }catch(error){
    if(error?.status===404){
      localStorage.removeItem(CHAMA_BACKEND.orderStorageKey);
      liveRuntime.orderId=null;
      liveRuntime.order=null;
      render();
    }else if(changed){
      render();
    }
  }
}


const merchantRuntime={
  requested:new URLSearchParams(location.search).get('merchant')==='1',
  status:'disabled',
  client:null,
  session:null,
  merchant:null,
  memberships:[],
  catalog:[],
  orders:[],
  selectedMerchantId:localStorage.getItem('chama-merchant-selected-v1')||null,
  actionPending:false,
  error:null,
  notice:null,
  accessReason:null,
  heartbeatError:null,
  lastSyncAt:null,
  lastHeartbeatAt:0
};

function merchantOriginSafe(){
  if(['localhost','127.0.0.1'].includes(location.hostname))return true;
  const configured=String(globalThis.CHAMA_MERCHANT_ORIGIN||'').trim();
  return configured.length>0&&location.origin===configured;
}
function merchantPortalRequested(){return merchantRuntime.requested}
function merchantReady(){return merchantRuntime.requested&&merchantRuntime.status==='ready'}

async function merchantBackendInit(){
  if(!merchantRuntime.requested){
    merchantRuntime.status='disabled';
    return false;
  }
  if(!merchantOriginSafe()){
    merchantRuntime.status='unsafe-origin';
    merchantRuntime.error='O painel real da revenda exige uma origem dedicada e isolada.';
    return false;
  }
  if(['ready','no-access','unauthenticated'].includes(merchantRuntime.status)&&merchantRuntime.client)return merchantRuntime.status==='ready';
  merchantRuntime.status='loading';
  merchantRuntime.error=null;
  try{
    const lib=await loadSupabaseBrowser();
    const client=lib.createClient(CHAMA_BACKEND.url,CHAMA_BACKEND.publishableKey,{
      auth:{
        persistSession:true,
        autoRefreshToken:true,
        detectSessionInUrl:true,
        storage:sessionStorage,
        storageKey:'chama-sg-merchant-auth-v1'
      },
      global:{fetch:chamaFetch}
    });
    merchantRuntime.client=client;

    const {data:{session},error}=await client.auth.getSession();
    if(error)throw error;
    merchantRuntime.session=session??null;

    if(!session?.access_token){
      merchantRuntime.status='unauthenticated';
      return false;
    }

    if(session.user?.is_anonymous===true){
      await client.auth.signOut().catch(()=>{});
      merchantRuntime.session=null;
      merchantRuntime.status='unauthenticated';
      merchantRuntime.error='A área da revenda exige uma conta permanente.';
      return false;
    }

    await merchantRefresh({silent:true});
    return merchantRuntime.status==='ready';
  }catch(error){
    merchantRuntime.status='unavailable';
    merchantRuntime.error=String(error?.message||error||'Painel indisponível');
    return false;
  }
}

async function merchantAccessToken(){
  if(!merchantRuntime.client)throw new Error('Cliente da revenda indisponível');
  const {data:{session},error}=await merchantRuntime.client.auth.getSession();
  if(error||!session?.access_token)throw error||new Error('Sessão da revenda expirada');
  if(session.user?.is_anonymous===true)throw new Error('Conta permanente obrigatória');
  merchantRuntime.session=session;
  return session.access_token;
}

async function merchantInvoke(name,body={},options={}){
  const token=await merchantAccessToken();
  const headers={
    'Content-Type':'application/json',
    'apikey':CHAMA_BACKEND.publishableKey,
    'Authorization':'Bearer '+token
  };
  if(options.idempotencyKey)headers['Idempotency-Key']=options.idempotencyKey;
  const response=await chamaFetch(CHAMA_BACKEND.url+'/functions/v1/'+encodeURIComponent(name),{
    method:'POST',
    headers,
    body:JSON.stringify(body),
    cache:'no-store'
  });
  let data=null;
  try{data=await response.json()}catch{}
  if(!response.ok){
    const err=new Error(data?.message||data?.error||('HTTP '+response.status));
    err.code=data?.error||'HTTP_'+response.status;
    err.status=response.status;
    err.data=data;
    throw err;
  }
  return data;
}

async function merchantSendLogin(email){
  if(!merchantRuntime.client)await merchantBackendInit();
  const value=String(email||'').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw new Error('Informe um e-mail válido');
  const redirect=new URL(location.origin+location.pathname);
  redirect.searchParams.set('merchant','1');
  redirect.hash='merchant';
  if(!globalThis.chamaTurnstile?.challenge)throw new Error('Proteção anti-bot indisponível');
  const captchaToken=await globalThis.chamaTurnstile.challenge('merchant_login');
  const {error}=await merchantRuntime.client.auth.signInWithOtp({
    email:value,
    options:{emailRedirectTo:redirect.toString(),shouldCreateUser:true,captchaToken}
  });
  if(error)throw error;
  merchantRuntime.notice='Enviamos um link de acesso para '+value+'. Abra-o neste navegador.';
  merchantRuntime.status='unauthenticated';
  render();
}

async function merchantSignOut(){
  if(merchantRuntime.client)await merchantRuntime.client.auth.signOut().catch(()=>{});
  merchantRuntime.session=null;
  merchantRuntime.merchant=null;
  merchantRuntime.memberships=[];
  merchantRuntime.catalog=[];
  merchantRuntime.orders=[];
  merchantRuntime.selectedMerchantId=null;
  localStorage.removeItem('chama-merchant-selected-v1');
  merchantRuntime.status='unauthenticated';
  merchantRuntime.error=null;
  merchantRuntime.notice=null;
  merchantRuntime.accessReason=null;
  merchantRuntime.heartbeatError=null;
  render();
}

async function merchantRefresh({silent=false,recoverSelection=true}={}){
  if(!merchantRuntime.client)return null;
  if(!silent)render();
  try{
    const body={};
    if(merchantRuntime.selectedMerchantId)body.merchantId=merchantRuntime.selectedMerchantId;
    const data=await merchantInvoke('merchant-orders',body);
    merchantRuntime.merchant=data.merchant??null;
    merchantRuntime.memberships=data.memberships??[];
    merchantRuntime.catalog=data.catalog??[];
    merchantRuntime.orders=data.orders??[];
    merchantRuntime.selectedMerchantId=data.merchant?.merchantId??merchantRuntime.selectedMerchantId;
    if(merchantRuntime.selectedMerchantId)localStorage.setItem('chama-merchant-selected-v1',merchantRuntime.selectedMerchantId);
    merchantRuntime.status='ready';
    merchantRuntime.error=null;
    merchantRuntime.accessReason=null;
    merchantRuntime.lastSyncAt=new Date().toISOString();
    return data;
  }catch(error){
    const staleSelected=Boolean(merchantRuntime.selectedMerchantId)
      && error?.status===403
      && ['MERCHANT_ACCESS_DENIED','MERCHANT_ROLE_NOT_ENABLED'].includes(error?.code);
    if(staleSelected&&recoverSelection){
      merchantRuntime.selectedMerchantId=null;
      localStorage.removeItem('chama-merchant-selected-v1');
      return merchantRefresh({silent:true,recoverSelection:false});
    }
    if(
      error?.code==='NO_MERCHANT_ACCESS'
      || error?.status===403&&['MERCHANT_ACCESS_DENIED','MERCHANT_ROLE_NOT_ENABLED'].includes(error?.code)
    ){
      merchantRuntime.status='no-access';
      merchantRuntime.merchant=null;
      merchantRuntime.orders=[];
      merchantRuntime.catalog=[];
      merchantRuntime.error=null;
      merchantRuntime.accessReason=error?.code||'NO_MERCHANT_ACCESS';
      return null;
    }
    if(error?.status===401){
      merchantRuntime.status='unauthenticated';
      merchantRuntime.session=null;
      merchantRuntime.error='Sua sessão expirou. Entre novamente.';
      merchantRuntime.accessReason=null;
      return null;
    }
    merchantRuntime.status='unavailable';
    merchantRuntime.error=String(error?.message||error);
    throw error;
  }finally{
    if(!silent)render();
  }
}

async function merchantSelectLive(merchantId){
  merchantRuntime.selectedMerchantId=String(merchantId||'')||null;
  if(merchantRuntime.selectedMerchantId){
    localStorage.setItem('chama-merchant-selected-v1',merchantRuntime.selectedMerchantId);
  }else{
    localStorage.removeItem('chama-merchant-selected-v1');
  }
  await merchantRefresh();
}

async function merchantPerformAction(orderId,action,reason='other_operational'){
  if(merchantRuntime.actionPending)return;
  const order=merchantRuntime.orders.find(o=>o.orderId===orderId);
  if(!order)throw new Error('Pedido não encontrado no painel');
  merchantRuntime.actionPending=true;
  merchantRuntime.error=null;
  render();
  try{
    const body={orderId,action,expectedVersion:order.version};
    if(action==='cannot-fulfill')body.reason=reason;
    const result=await merchantInvoke('merchant-action',body,{idempotencyKey:liveIdempotency('merchant-action')});
    await merchantRefresh({silent:true});
    return result;
  }catch(error){
    merchantRuntime.error=String(error?.message||error);
    try{await merchantRefresh({silent:true})}catch{}
    throw error;
  }finally{
    merchantRuntime.actionPending=false;
    render();
  }
}

async function merchantCompleteDeliveryLive(orderId,pin,paymentConfirmed){
  if(merchantRuntime.actionPending)return;
  const order=merchantRuntime.orders.find(o=>o.orderId===orderId);
  if(!order)throw new Error('Pedido não encontrado no painel');
  if(paymentConfirmed!==true)throw new Error('Confirme o recebimento do pagamento');
  if(!/^\d{4}$/.test(String(pin||'')))throw new Error('Informe o PIN de 4 dígitos');
  merchantRuntime.actionPending=true;
  merchantRuntime.error=null;
  render();
  try{
    const result=await merchantInvoke('complete-delivery',{
      orderId,
      pin:String(pin),
      expectedVersion:order.version,
      paymentConfirmed:true
    },{idempotencyKey:liveIdempotency('complete-delivery')});
    if(result?.ok===false)throw Object.assign(new Error(result.error==='PIN_LOCKED'?'PIN bloqueado. Abra suporte.':'PIN incorreto.'),{code:result.error});
    await merchantRefresh({silent:true});
  }catch(error){
    merchantRuntime.error=String(error?.message||error);
    try{await merchantRefresh({silent:true})}catch{}
    throw error;
  }finally{
    merchantRuntime.actionPending=false;
    render();
  }
}

async function merchantSetOnlineLive(online){
  const merchantId=merchantRuntime.merchant?.merchantId;
  if(!merchantId)throw new Error('Revenda não selecionada');
  merchantRuntime.actionPending=true;render();
  try{
    await merchantInvoke('merchant-ops',{merchantId,action:'set-online',online:online===true});
    await merchantRefresh({silent:true});
  }finally{
    merchantRuntime.actionPending=false;render();
  }
}

async function merchantUpdateProductLive(productCode,priceCents,availableStock,active=true){
  const merchantId=merchantRuntime.merchant?.merchantId;
  if(!merchantId)throw new Error('Revenda não selecionada');
  merchantRuntime.actionPending=true;render();
  try{
    await merchantInvoke('merchant-ops',{
      merchantId,action:'update-product',productCode,
      priceCents:Number(priceCents),availableStock:Number(availableStock),active:active!==false
    });
    await merchantRefresh({silent:true});
  }finally{
    merchantRuntime.actionPending=false;render();
  }
}

async function merchantUpdateLogisticsLive(deliveryFeeCents,baseEtaMinutes,acceptsCitywide){
  const merchantId=merchantRuntime.merchant?.merchantId;
  if(!merchantId)throw new Error('Revenda não selecionada');
  merchantRuntime.actionPending=true;render();
  try{
    await merchantInvoke('merchant-ops',{
      merchantId,action:'update-logistics',
      deliveryFeeCents:Number(deliveryFeeCents),
      baseEtaMinutes:Number(baseEtaMinutes),
      acceptsCitywide:acceptsCitywide===true
    });
    await merchantRefresh({silent:true});
  }finally{
    merchantRuntime.actionPending=false;render();
  }
}

async function merchantSubmitApplicationLive(payload){
  if(!merchantRuntime.session?.access_token)throw new Error('Entre com seu e-mail antes de enviar o cadastro');
  return merchantInvoke('submit-merchant-application',payload);
}

async function merchantHeartbeat(){
  if(!merchantReady()||merchantRuntime.actionPending||!merchantRuntime.merchant)return false;
  const now=Date.now();
  if(now-merchantRuntime.lastHeartbeatAt<60000)return null;
  merchantRuntime.lastHeartbeatAt=now;
  try{
    await merchantInvoke('merchant-ops',{
      merchantId:merchantRuntime.merchant.merchantId,
      action:'heartbeat'
    });
    merchantRuntime.heartbeatError=null;
    return true;
  }catch(error){
    merchantRuntime.heartbeatError=String(error?.message||error||'Falha ao confirmar presença');
    return false;
  }
}

async function merchantPoll(){
  if(!merchantReady()||merchantRuntime.actionPending||document.visibilityState==='hidden')return;
  try{
    await merchantHeartbeat();
    await merchantRefresh({silent:true});
    render();
  }catch{}
}

function openMerchantPortal(){
  const href=buildPortalHref(globalThis.CHAMA_MERCHANT_ORIGIN,'merchant');
  if(!href){
    toast('O portal da revenda ainda não possui uma origem dedicada configurada');
    return;
  }
  location.href=href;
}
function openCustomerPortal(){
  const href=buildPortalHref(globalThis.CHAMA_CUSTOMER_ORIGIN,'customer');
  if(!href){
    toast('O site do cliente ainda não possui uma origem dedicada configurada');
    return;
  }
  location.href=href;
}

globalThis.chamaFetch=chamaFetch;
globalThis.buildPortalHref=buildPortalHref;
globalThis.liveRuntime=liveRuntime;
globalThis.customerOriginSafe=customerOriginSafe;
globalThis.backendInit=backendInit;
globalThis.liveRequested=liveRequested;
globalThis.liveReady=liveReady;
globalThis.liveBanner=liveBanner;
globalThis.liveRefreshOffers=liveRefreshOffers;
globalThis.liveScheduleOfferRefresh=liveScheduleOfferRefresh;
globalThis.liveCreateOrder=liveCreateOrder;
globalThis.liveGetOrder=liveGetOrder;
globalThis.liveCustomerAction=liveCustomerAction;
globalThis.liveUpgradeAccount=liveUpgradeAccount;
globalThis.livePoll=livePoll;
globalThis.liveSyncMarketStatus=liveSyncMarketStatus;
globalThis.prelaunchExamplesEnabled=prelaunchExamplesEnabled;
globalThis.merchantRuntime=merchantRuntime;
globalThis.merchantPortalRequested=merchantPortalRequested;
globalThis.merchantOriginSafe=merchantOriginSafe;
globalThis.merchantReady=merchantReady;
globalThis.merchantBackendInit=merchantBackendInit;
globalThis.merchantSendLogin=merchantSendLogin;
globalThis.merchantSignOut=merchantSignOut;
globalThis.merchantRefresh=merchantRefresh;
globalThis.merchantSelectLive=merchantSelectLive;
globalThis.merchantPerformAction=merchantPerformAction;
globalThis.merchantCompleteDeliveryLive=merchantCompleteDeliveryLive;
globalThis.merchantSetOnlineLive=merchantSetOnlineLive;
globalThis.merchantUpdateProductLive=merchantUpdateProductLive;
globalThis.merchantUpdateLogisticsLive=merchantUpdateLogisticsLive;
globalThis.merchantSubmitApplicationLive=merchantSubmitApplicationLive;
globalThis.merchantPoll=merchantPoll;
globalThis.openMerchantPortal=openMerchantPortal;
globalThis.openCustomerPortal=openCustomerPortal;
