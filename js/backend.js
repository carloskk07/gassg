const CHAMA_BACKEND={
  url:'https://lgugwujpunhslavewffd.supabase.co',
  publishableKey:'sb_publishable_3FLGyrWHrUZ5vQc59Iowug_pekOZ9u_',
  orderStorageKey:'chama-live-order-id-v1'
};

const liveRuntime={
  requested:new URLSearchParams(location.search).get('live')==='1',
  status:'disabled',
  client:null,
  session:null,
  offers:[],
  order:null,
  orderId:null,
  loadingOffers:false,
  actionPending:false,
  error:null,
  lastSyncAt:null,
  offerRequestSeq:0,
  orderRequestSeq:0
};

function liveRequested(){return liveRuntime.requested}
function liveReady(){return liveRuntime.requested&&liveRuntime.status==='ready'}

function liveBanner(){
  if(!liveRuntime.requested)return 'demo';
  if(liveRuntime.status==='ready')return 'live';
  if(liveRuntime.status==='loading')return 'connecting';
  return 'blocked';
}

function loadSupabaseBrowser(){
  if(globalThis.supabase?.createClient)return Promise.resolve(globalThis.supabase);
  return new Promise((resolve,reject)=>{
    const existing=document.querySelector('script[data-chama-supabase]');
    if(existing){
      existing.addEventListener('load',()=>resolve(globalThis.supabase),{once:true});
      existing.addEventListener('error',()=>reject(new Error('Falha ao carregar Supabase JS')),{once:true});
      return;
    }
    const script=document.createElement('script');
    script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2';
    script.async=true;
    script.dataset.chamaSupabase='1';
    script.crossOrigin='anonymous';
    script.onload=()=>globalThis.supabase?.createClient?resolve(globalThis.supabase):reject(new Error('Supabase JS não inicializou'));
    script.onerror=()=>reject(new Error('Falha ao carregar Supabase JS'));
    document.head.appendChild(script);
  });
}

async function backendInit(){
  if(!liveRuntime.requested){
    liveRuntime.status='disabled';
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
        storageKey:'chama-sg-auth-v1'
      }
    });
    liveRuntime.client=client;

    let {data:{session},error}=await client.auth.getSession();
    if(error)throw error;

    if(!session){
      const response=await client.auth.signInAnonymously();
      if(response.error)throw response.error;
      session=response.data.session;
    }
    if(!session?.access_token)throw new Error('Sessão anônima não foi criada');

    liveRuntime.session=session;
    liveRuntime.status='ready';
    liveRuntime.orderId=localStorage.getItem(CHAMA_BACKEND.orderStorageKey)||null;

    await liveSyncFinancialProfile();

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

  const response=await fetch(CHAMA_BACKEND.url+'/functions/v1/'+encodeURIComponent(name),{
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
  const roleMap={recommended:'Recomendado',cheapest:'Mais barato',fastest:'Mais rápido',alternative:'Alternativa'};
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
    liveRuntime.loadingOffers=false;
    if(!silent)render();
    return [];
  }
  const addressSnapshot=state.address;
  const itemsSnapshot=liveCartItems();
  liveRuntime.offers=[];
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
    liveRuntime.offers=(data?.offers||[])
      .map(liveOfferView)
      .filter(o=>Number.isFinite(Date.parse(o.expiresAt))&&Date.parse(o.expiresAt)>Date.now());
    liveRuntime.lastSyncAt=new Date().toISOString();
    return liveRuntime.offers;
  }catch(error){
    if(seq===liveRuntime.offerRequestSeq){
      liveRuntime.offers=[];
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
  try{
    const result=await liveInvoke('create-order',{
      quoteId,
      paymentMethod:state.checkout.paymentMethod,
      useCashback:state.checkout.useCashback===true,
      referralCode:state.user.referredBy||null
    },{idempotencyKey:liveIdempotency('create-order')});

    liveRuntime.orderId=result.orderId;
    localStorage.setItem(CHAMA_BACKEND.orderStorageKey,result.orderId);
    state.cart=normalizeCart({});
    state.checkout.useCashback=false;
    save();
    await liveGetOrder(result.orderId,{silent:true});
    go('tracking');
    toast('Pedido real enviado para confirmação da revenda');
  }catch(error){
    liveRuntime.error=String(error?.message||error);
    toast(liveRuntime.error);
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
    await liveSyncFinancialProfile();
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

async function liveSyncFinancialProfile(){
  if(!liveReady())return;
  try{
    const summary=await liveInvoke('customer-summary',{});
    if(summary?.referralCode)state.user.referralCode=String(summary.referralCode).slice(0,40);
    state.user.cashback=Math.max(0,Number(summary?.cashbackCents||0)/100);
    state.user.commissionPending=Math.max(0,Number(summary?.commissionPendingCents||0)/100);
    state.user.commissionAvailable=Math.max(0,Number(summary?.commissionAvailableCents||0)/100);
    state.user.purchases=Math.max(0,Number(summary?.settledOrders||0));
    save();
  }catch(error){
    console.warn('Não foi possível sincronizar o resumo financeiro live',error);
  }
}

async function livePoll(){
  if(!liveReady()||!liveRuntime.orderId||liveRuntime.actionPending||document.visibilityState==='hidden')return;
  if(["SETTLED","CANCELLED"].includes(liveRuntime.order?.status))return;
  try{await liveGetOrder(liveRuntime.orderId,{silent:true});render()}catch(error){
    if(error?.status===404){
      localStorage.removeItem(CHAMA_BACKEND.orderStorageKey);
      liveRuntime.orderId=null;
      liveRuntime.order=null;
      render();
    }
  }
}

globalThis.liveRuntime=liveRuntime;
globalThis.backendInit=backendInit;
globalThis.liveRequested=liveRequested;
globalThis.liveReady=liveReady;
globalThis.liveBanner=liveBanner;
globalThis.liveRefreshOffers=liveRefreshOffers;
globalThis.liveScheduleOfferRefresh=liveScheduleOfferRefresh;
globalThis.liveCreateOrder=liveCreateOrder;
globalThis.liveGetOrder=liveGetOrder;
globalThis.liveCustomerAction=liveCustomerAction;
globalThis.livePoll=livePoll;
