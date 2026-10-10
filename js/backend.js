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

function isAmbiguousTransportError(error){
  return error?.code==='NETWORK_TIMEOUT'
    || error instanceof TypeError
    || (Number.isFinite(Number(error?.status))&&Number(error.status)>=500);
}
async function retryAmbiguousOnce(operation){
  try{return await operation()}
  catch(firstError){
    if(!isAmbiguousTransportError(firstError))throw firstError;
    await new Promise(resolve=>setTimeout(resolve,250));
    return operation();
  }
}

const MERCHANT_PILOT_INVITE_STORAGE='tamao-pilot-invite-v1';
const MERCHANT_PILOT_INVITE_TTL_MS=2*60*60*1000;
function validMerchantPilotInviteToken(value){
  return /^[A-Za-z0-9_-]{20,240}$/.test(String(value||'').trim());
}
function storedMerchantPilotInviteToken(){
  try{
    const raw=localStorage.getItem(MERCHANT_PILOT_INVITE_STORAGE);
    if(!raw)return '';
    const data=JSON.parse(raw);
    const token=String(data?.token||'').trim();
    const expiresAt=Number(data?.expiresAt||0);
    if(!validMerchantPilotInviteToken(token)||!Number.isFinite(expiresAt)||expiresAt<=Date.now()){
      localStorage.removeItem(MERCHANT_PILOT_INVITE_STORAGE);
      return '';
    }
    return token;
  }catch{
    localStorage.removeItem(MERCHANT_PILOT_INVITE_STORAGE);
    return '';
  }
}
function merchantPilotInviteFromUrl(){
  const url=new URL(location.href);
  const rawHash=url.hash.replace(/^#/,'');
  const splitAt=rawHash.indexOf('?');
  const hashRoute=splitAt>=0?rawHash.slice(0,splitAt):rawHash;
  const hashParams=new URLSearchParams(splitAt>=0?rawHash.slice(splitAt+1):'');
  const queryToken=String(url.searchParams.get('pilot')||'').trim();
  const hashToken=String(hashParams.get('pilot')||'').trim();
  const token=validMerchantPilotInviteToken(hashToken)?hashToken:(validMerchantPilotInviteToken(queryToken)?queryToken:'');
  let changed=false;

  if(url.searchParams.has('pilot')){
    url.searchParams.delete('pilot');
    changed=true;
  }
  if(hashParams.has('pilot')){
    hashParams.delete('pilot');
    url.hash=hashRoute
      ? '#'+hashRoute+(hashParams.toString()?'?'+hashParams.toString():'')
      : (hashParams.toString()?'#?'+hashParams.toString():'');
    changed=true;
  }
  if(changed){
    history.replaceState(null,'',url.pathname+url.search+url.hash);
  }
  if(token){
    try{
      localStorage.setItem(MERCHANT_PILOT_INVITE_STORAGE,JSON.stringify({
        token,
        expiresAt:Date.now()+MERCHANT_PILOT_INVITE_TTL_MS
      }));
    }catch{}
  }
  return token;
}
function merchantPilotInviteToken(){
  return merchantPilotInviteFromUrl()||storedMerchantPilotInviteToken();
}
function clearMerchantPilotInviteToken(){
  try{localStorage.removeItem(MERCHANT_PILOT_INVITE_STORAGE)}catch{}
  const url=new URL(location.href);
  const rawHash=url.hash.replace(/^#/,'');
  const splitAt=rawHash.indexOf('?');
  const hashRoute=splitAt>=0?rawHash.slice(0,splitAt):rawHash;
  const hashParams=new URLSearchParams(splitAt>=0?rawHash.slice(splitAt+1):'');
  let changed=false;
  if(url.searchParams.has('pilot')){url.searchParams.delete('pilot');changed=true}
  if(hashParams.has('pilot')){
    hashParams.delete('pilot');
    url.hash=hashRoute
      ? '#'+hashRoute+(hashParams.toString()?'?'+hashParams.toString():'')
      : (hashParams.toString()?'#?'+hashParams.toString():'');
    changed=true;
  }
  if(changed)history.replaceState(null,'',url.pathname+url.search+url.hash);
}


const MERCHANT_PROSPECT_INVITE_STORAGE='tamao-prospect-invite-v1';
const MERCHANT_PROSPECT_INVITE_TTL_MS=2*60*60*1000;
function validMerchantProspectInviteToken(value){
  return /^[A-Za-z0-9_-]{32,128}$/.test(String(value||'').trim());
}
function storedMerchantProspectInviteToken(){
  try{
    const value=JSON.parse(localStorage.getItem(MERCHANT_PROSPECT_INVITE_STORAGE)||'null');
    const token=String(value?.token||'');
    if(validMerchantProspectInviteToken(token)&&Number(value?.expiresAt)>Date.now())return token;
  }catch{}
  try{localStorage.removeItem(MERCHANT_PROSPECT_INVITE_STORAGE)}catch{}
  return '';
}
function merchantProspectInviteDetails(){
  try{
    const saved=JSON.parse(localStorage.getItem(MERCHANT_PROSPECT_INVITE_STORAGE)||'null');
    if(!validMerchantProspectInviteToken(saved?.token)||Number(saved?.expiresAt)<=Date.now())return null;
    const cnpj=String(saved.cnpj||'');
    const companyName=String(saved.companyName||'').slice(0,90);
    return {cnpj:/^[0-9]{14}$/.test(cnpj)?cnpj:'',companyName};
  }catch{return null}
}
function merchantProspectInviteFromUrl(){
  const url=new URL(location.href);
  const raw=url.hash.replace(/^#/,'');
  const split=raw.indexOf('?');
  const route=split>=0?raw.slice(0,split):raw;
  const hashParams=new URLSearchParams(split>=0?raw.slice(split+1):'');
  const fromHash=String(hashParams.get('prospect')||'');
  const fromQuery=String(url.searchParams.get('prospect')||'');
  const token=validMerchantProspectInviteToken(fromHash)?fromHash:
    validMerchantProspectInviteToken(fromQuery)?fromQuery:'';
  const cnpj=String(hashParams.get('cnpj')||'');
  const companyName=String(hashParams.get('empresa')||'').trim().slice(0,90);
  let changed=false;
  if(url.searchParams.has('prospect')){url.searchParams.delete('prospect');changed=true}
  if(hashParams.has('prospect')){
    hashParams.delete('prospect');
    url.hash='#'+route+(hashParams.toString()?'?'+hashParams.toString():'');
    changed=true;
  }
  if(hashParams.has('cnpj')||hashParams.has('empresa')){
    hashParams.delete('cnpj');hashParams.delete('empresa');
    url.hash='#'+route+(hashParams.toString()?'?'+hashParams.toString():'');
    changed=true;
  }
  if(changed)history.replaceState(null,'',url.pathname+url.search+url.hash);
  if(token)try{
    localStorage.setItem(MERCHANT_PROSPECT_INVITE_STORAGE,JSON.stringify({
      token,cnpj:/^[0-9]{14}$/.test(cnpj)?cnpj:'',companyName,
      expiresAt:Date.now()+MERCHANT_PROSPECT_INVITE_TTL_MS
    }));
  }catch{}
  return token;
}
function merchantProspectInviteToken(){
  return merchantProspectInviteFromUrl()||storedMerchantProspectInviteToken();
}
function clearMerchantProspectInviteToken(){
  try{localStorage.removeItem(MERCHANT_PROSPECT_INVITE_STORAGE)}catch{}
}

const customerPortalParams=new URLSearchParams(location.search);
const configuredPortalRole=String(globalThis.CHAMA_PORTAL_ROLE||'').trim().toLowerCase();
if(configuredPortalRole==='merchant'||customerPortalParams.get('merchant')==='1'||customerPortalParams.has('pilot')||location.hash.includes('pilot=')||customerPortalParams.has('prospect')||location.hash.includes('prospect=')){
  merchantPilotInviteFromUrl();
  merchantProspectInviteFromUrl();
}
const liveRuntime={
  requested:globalThis.__CHAMA_TEST__===true
    ? false
    : configuredPortalRole
      ? configuredPortalRole==='customer'
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
  commerceLaunchBlocked:false,
  marketMode:null,
  eligibleMerchantCount:0,
  displayedOfferCount:0,
  marketStatus:null,
  lastOrderTemplate:null,
  reorderPrediction:null,
  comparisonSavingsCents:0,
  cashbackEarnedCents:0,
  referredCount:0,
  qualifiedReferralCount:0,
  scheduledDeliveryUnavailable:false,
  paymentMethodUnavailable:false,
  postalValidated:false,
  lastMarketStatusAt:0,
  lastFinancialSyncAt:0,
  lastFinancialSyncAttemptAt:0,
  lastSyncAt:null,
  offerRequestSeq:0,
  orderRequestSeq:0,
  financialSyncSeq:0,
  marketStatusSeq:0,
  pollPending:false
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

function captureSupabaseImplicitSessionFromUrl(){
  const raw=String(location.hash||'').replace(/^#/,'');
  if(!raw||!raw.includes('access_token='))return null;
  const params=new URLSearchParams(raw);
  const accessToken=String(params.get('access_token')||'').trim();
  const refreshToken=String(params.get('refresh_token')||'').trim();
  const tokenType=String(params.get('token_type')||'').trim();
  const expiresIn=Number(params.get('expires_in')||0);
  if(!accessToken||!refreshToken)return null;
  return {
    access_token:accessToken,
    refresh_token:refreshToken,
    token_type:tokenType||'bearer',
    expires_in:Number.isFinite(expiresIn)&&expiresIn>0?expiresIn:null
  };
}

function clearSupabaseAuthFragment(routeName=''){
  const url=new URL(location.href);
  const raw=String(url.hash||'').replace(/^#/,'');
  if(!raw.includes('access_token=')&&!raw.includes('refresh_token=')&&!raw.includes('error='))return false;
  url.hash=routeName?'#'+routeName:'';
  history.replaceState(null,'',url.pathname+url.search+url.hash);
  return true;
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
    liveRuntime.error='A compra online exige o endereço oficial e seguro do TAMÃO.';
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

function prelaunchAttribution(){
  const p=new URLSearchParams(location.search);
  const safe=(key,max)=>String(p.get(key)||'').trim().slice(0,max)||null;
  return {
    source:safe('utm_source',80),
    medium:safe('utm_medium',80),
    campaign:safe('utm_campaign',120),
    content:safe('utm_content',120),
    term:safe('utm_term',120),
    referrer:String(document.referrer||'').slice(0,500)||null,
    landingPath:String(location.pathname+location.search+location.hash).slice(0,240)
  };
}

async function prelaunchLeadSubmit(payload){
  const body={...payload,...prelaunchAttribution()};
  const idempotencyKey=liveIdempotency('prelaunch-lead');
  return retryAmbiguousOnce(async()=>{
    const response=await chamaFetch(CHAMA_BACKEND.url+'/functions/v1/capture-prelaunch-lead',{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':CHAMA_BACKEND.publishableKey,'Idempotency-Key':idempotencyKey},
      body:JSON.stringify(body),
      cache:'no-store'
    });
    let data=null;
    try{data=await response.json()}catch{}
    if(!response.ok){
      const error=new Error(data?.message||data?.error||('HTTP '+response.status));
      error.code=data?.error||'HTTP_'+response.status;
      error.status=response.status;
      throw error;
    }
    return data;
  });
}

async function publicRequestSubmit(payload){
  const body={...payload,attribution:prelaunchAttribution()};
  const idempotencyKey=liveIdempotency('public-request');
  return retryAmbiguousOnce(async()=>{
    const response=await chamaFetch(CHAMA_BACKEND.url+'/functions/v1/submit-public-request',{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':CHAMA_BACKEND.publishableKey,'Idempotency-Key':idempotencyKey},
      body:JSON.stringify(body),
      cache:'no-store'
    });
    let data=null;
    try{data=await response.json()}catch{}
    if(!response.ok){
      const error=new Error(data?.message||data?.error||('HTTP '+response.status));
      error.code=data?.error||'HTTP_'+response.status;
      error.status=response.status;
      throw error;
    }
    return data;
  });
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
    completedOrders:Math.max(0,Number(raw.completedOrders||0)),
    completionRate:raw.completionRate==null?null:Number(raw.completionRate),
    onTimeRate:raw.onTimeRate==null?null:Number(raw.onTimeRate),
    avgAcceptSeconds:raw.avgAcceptSeconds==null?null:Number(raw.avgAcceptSeconds),
    feedbackCount:Math.max(0,Number(raw.feedbackCount||0)),
    positiveFeedbackRate:raw.positiveFeedbackRate==null?null:Number(raw.positiveFeedbackRate),
    comparisonSavings:Math.max(0,Number(raw.comparisonSavingsCents||0))/100,
    demandLevel:String(raw.demandLevel||'normal'),
    deliveryWindowStart:raw.deliveryWindowStart??null,
    deliveryWindowEnd:raw.deliveryWindowEnd??null,
    expiresAt:raw.expiresAt,
    live:true
  };
}

let liveOfferTimer=null;
function liveAddressDraftReady(){
  return /^[0-9]{8}$/.test(String(state.postalCode||''))
    && /^[0-9]{1,6}[A-Za-z]?$/.test(String(state.addressNumber||''))
    && hasCartItems();
}
function liveScheduleOfferRefresh(delay=350){
  if(!liveReady())return;
  clearTimeout(liveOfferTimer);
  liveOfferTimer=setTimeout(()=>{
    if(liveAddressDraftReady()){
      liveRefreshOffers().catch(()=>{});
    }
  },delay);
}

async function liveRefreshOffers({silent=false}={}){
  const seq=++liveRuntime.offerRequestSeq;
  if(!liveReady()||!liveAddressDraftReady()){
    liveRuntime.offers=[];
    liveRuntime.deliveryCompatibilityBlocked=false;
    liveRuntime.commerceLaunchBlocked=false;
    liveRuntime.marketMode=null;
    liveRuntime.eligibleMerchantCount=0;
    liveRuntime.displayedOfferCount=0;
    liveRuntime.scheduledDeliveryUnavailable=false;
    liveRuntime.paymentMethodUnavailable=false;
    liveRuntime.postalValidated=false;
    liveRuntime.loadingOffers=false;
    if(!silent)render();
    return [];
  }
  const postalCodeSnapshot=String(state.postalCode||'');
  const addressNumberSnapshot=String(state.addressNumber||'').trim().toUpperCase();
  const itemsSnapshot=liveCartItems();
  const scheduleSnapshot=state.checkout.deliveryMode==='scheduled'
    ? {
        start:state.checkout.deliveryWindowStart,
        end:state.checkout.deliveryWindowEnd
      }
    : {start:null,end:null};
  const paymentMethodSnapshot=state.checkout.paymentMethod;
  liveRuntime.offers=[];
  liveRuntime.deliveryCompatibilityBlocked=false;
  liveRuntime.commerceLaunchBlocked=false;
  liveRuntime.marketMode=null;
  liveRuntime.eligibleMerchantCount=0;
  liveRuntime.displayedOfferCount=0;
  liveRuntime.scheduledDeliveryUnavailable=false;
  liveRuntime.paymentMethodUnavailable=false;
  liveRuntime.postalValidated=false;
  liveRuntime.loadingOffers=true;
  liveRuntime.error=null;
  if(!silent)render();
  try{
    const data=await liveInvoke('get-offers',{
      postalCode:postalCodeSnapshot,
      addressNumber:addressNumberSnapshot,
      items:itemsSnapshot,
      priority:'recommended',
      deliveryWindowStart:scheduleSnapshot.start,
      deliveryWindowEnd:scheduleSnapshot.end,
      paymentMethod:paymentMethodSnapshot
    });
    if(seq!==liveRuntime.offerRequestSeq)return liveRuntime.offers;
    if(String(state.postalCode||'')!==postalCodeSnapshot||String(state.addressNumber||'').trim().toUpperCase()!==addressNumberSnapshot||JSON.stringify(liveCartItems())!==JSON.stringify(itemsSnapshot)){
      return liveRuntime.offers;
    }
    const currentSchedule=state.checkout.deliveryMode==='scheduled'
      ? {start:state.checkout.deliveryWindowStart,end:state.checkout.deliveryWindowEnd}
      : {start:null,end:null};
    if(JSON.stringify(currentSchedule)!==JSON.stringify(scheduleSnapshot)
       || state.checkout.paymentMethod!==paymentMethodSnapshot){
      return liveRuntime.offers;
    }
    liveRuntime.deliveryCompatibilityBlocked=data?.deliveryCompatibilityBlocked===true;
    liveRuntime.commerceLaunchBlocked=data?.commerceLaunchBlocked===true;
    liveRuntime.postalValidated=data?.postalValidated===true;
    if(liveRuntime.postalValidated&&data?.canonicalAddress){
      state.address=String(data.canonicalAddress).slice(0,240);
      state.postalCode=String(data.postalCode||postalCodeSnapshot).replace(/\D/g,'').slice(0,8);
      state.addressNumber=String(data.addressNumber||addressNumberSnapshot).trim().toUpperCase().slice(0,7);
      save();
    }
    liveRuntime.scheduledDeliveryUnavailable=data?.scheduledDeliveryUnavailable===true;
    liveRuntime.paymentMethodUnavailable=data?.paymentMethodUnavailable===true;
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
      liveRuntime.scheduledDeliveryUnavailable=false;
      liveRuntime.paymentMethodUnavailable=false;
      liveRuntime.postalValidated=false;
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
    referralCode:state.user.referredBy||null,
    cashTenderCents:state.checkout.paymentMethod==='cash'?state.checkout.cashTenderCents:null,
    customerPhone:state.checkout.customerPhoneDigits||'',
    addressComplement:state.checkout.addressComplement||null,
    deliveryReference:state.checkout.deliveryReference||null,
    deliveryNotes:state.checkout.deliveryNotes||null
  };
  try{
    const result=await retryAmbiguousOnce(
      ()=>liveInvoke('create-order',payload,{idempotencyKey})
    );

    liveRuntime.orderId=result.orderId;
    localStorage.setItem(CHAMA_BACKEND.orderStorageKey,result.orderId);
    state.cart=normalizeCart({});
    state.checkout.useCashback=false;
    state.checkout.cashTenderCents=null;
    state.checkout.deliveryMode='now';
    state.checkout.deliveryWindowStart=null;
    state.checkout.deliveryWindowEnd=null;
    state.checkout.deliveryWindowLabel=null;
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
      state.checkout.cashTenderCents=null;
      state.checkout.deliveryMode='now';
      state.checkout.deliveryWindowStart=null;
      state.checkout.deliveryWindowEnd=null;
      state.checkout.deliveryWindowLabel=null;
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
  liveRuntime.error=null;
  liveRuntime.lastSyncAt=new Date().toISOString();
  localStorage.setItem(CHAMA_BACKEND.orderStorageKey,order.orderId);
  if(['SETTLED','CANCELLED'].includes(order.status)){
    await liveSyncFinancialProfile({force:true});
  }
  if(!silent)render();
  return order;
}

async function liveStartMerchantPayment(){
  const order=liveRuntime.order;
  if(!order||liveRuntime.actionPending)return;
  const online=order.onlinePayment||{};
  if(online.status==='approved'){
    toast('Pagamento já confirmado pela revenda');
    return;
  }
  const existing=String(online.checkoutUrl||'');
  if(existing){
    if(!/^https:\/\/([a-z0-9-]+\.)*mercadopago\.com(?:\.br)?\//i.test(existing)){
      throw new Error('Link de pagamento inválido');
    }
    location.href=existing;
    return;
  }
  if(online.available!==true||online.canStart!==true){
    throw new Error('Pagamento online direto ainda não está disponível para este pedido');
  }

  liveRuntime.actionPending=true;
  liveRuntime.error=null;
  render();
  try{
    const idempotencyKey=liveIdempotency('merchant-sale-payment');
    const result=await retryAmbiguousOnce(()=>liveInvoke(
      'order-payment-checkout',
      {orderId:order.orderId},
      {idempotencyKey}
    ));
    if(result?.alreadyPaid===true){
      await liveGetOrder(order.orderId,{silent:true});
      toast('Pagamento confirmado');
      return;
    }
    const url=String(result?.checkoutUrl||'');
    if(!/^https:\/\/([a-z0-9-]+\.)*mercadopago\.com(?:\.br)?\//i.test(url)){
      throw new Error('O provedor não retornou um link de pagamento válido');
    }
    location.href=url;
  }catch(error){
    liveRuntime.error=String(error?.message||error);
    toast(liveRuntime.error);
    try{await liveGetOrder(order.orderId,{silent:true})}catch{}
  }finally{
    liveRuntime.actionPending=false;
    render();
  }
}

async function liveCustomerAction(action){
  const order=liveRuntime.order;
  if(!order||liveRuntime.actionPending)return;
  liveRuntime.actionPending=true;
  render();
  try{
    const idempotencyKey=liveIdempotency('customer-action');
    await retryAmbiguousOnce(()=>liveInvoke('customer-action',{
      orderId:order.orderId,
      action,
      expectedVersion:order.version
    },{idempotencyKey}));
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

async function liveSubmitFeedback(rating,tags=[]){
  const order=liveRuntime.order;
  if(!order||order.status!=='SETTLED')throw new Error('A avaliação fica disponível após a conclusão');
  const value=Number(rating);
  if(![1,5].includes(value))throw new Error('Avaliação inválida');
  const result=await retryAmbiguousOnce(()=>liveInvoke('customer-care',{
    action:'feedback',
    orderId:order.orderId,
    rating:value,
    tags:Array.isArray(tags)?tags:[]
  }));
  await liveGetOrder(order.orderId,{silent:true});
  render();
  return result;
}

async function liveOpenSupportCase(category,message=''){
  const order=liveRuntime.order;
  if(!order)throw new Error('Pedido não encontrado');
  const idempotencyKey=liveIdempotency('customer-care');
  const result=await retryAmbiguousOnce(()=>liveInvoke('customer-care',{
    action:'open-case',
    orderId:order.orderId,
    category:String(category||'other'),
    message:String(message||'').trim()
  },{idempotencyKey}));
  await liveGetOrder(order.orderId,{silent:true});
  render();
  return result;
}

const CUSTOMER_FINANCIAL_REFRESH_MS=5*60*1000;
const CUSTOMER_MARKET_REFRESH_MS=3*60*1000;

async function liveSyncFinancialProfile({force=false}={}){
  if(!liveReady())return false;
  const now=Date.now();
  if(!force&&liveRuntime.lastFinancialSyncAttemptAt&&now-liveRuntime.lastFinancialSyncAttemptAt<CUSTOMER_FINANCIAL_REFRESH_MS){
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
    identityType:state.user.identityType,
    lastOrderTemplate:liveRuntime.lastOrderTemplate,
    reorderPrediction:liveRuntime.reorderPrediction,
    referredCount:liveRuntime.referredCount,
    qualifiedReferralCount:liveRuntime.qualifiedReferralCount,
    comparisonSavingsCents:liveRuntime.comparisonSavingsCents,
    cashbackEarnedCents:liveRuntime.cashbackEarnedCents
  });
  const seq=++liveRuntime.financialSyncSeq;
  try{
    const summary=await liveInvoke('customer-summary',{});
    if(seq!==liveRuntime.financialSyncSeq)return false;
    if(summary?.referralCode)state.user.referralCode=String(summary.referralCode).slice(0,40);
    state.user.cashback=Math.max(0,Number(summary?.cashbackCents||0)/100);
    state.user.cashbackDebt=Math.max(0,Number(summary?.cashbackDebtCents||0)/100);
    state.user.commissionPending=Math.max(0,Number(summary?.commissionPendingCents||0)/100);
    state.user.commissionAvailable=Math.max(0,Number(summary?.commissionAvailableCents||0)/100);
    state.user.purchases=Math.max(0,Number(summary?.settledOrders||0));
    state.user.reversedPurchases=Math.max(0,Number(summary?.reversedOrders||0));
    state.user.cashEarningEligible=summary?.cashEarningEligible===true;
    state.user.identityType=String(summary?.identityType||'anonymous');
    liveRuntime.lastOrderTemplate=summary?.lastOrderTemplate??null;
    liveRuntime.reorderPrediction=summary?.reorderPrediction??null;
    liveRuntime.referredCount=Math.max(0,Number(summary?.referredCount||0));
    liveRuntime.qualifiedReferralCount=Math.max(0,Number(summary?.qualifiedReferralCount||0));
    liveRuntime.comparisonSavingsCents=Math.max(0,Number(summary?.comparisonSavingsCents||0));
    liveRuntime.cashbackEarnedCents=Math.max(0,Number(summary?.cashbackEarnedCents||0));
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
      identityType:state.user.identityType,
      lastOrderTemplate:liveRuntime.lastOrderTemplate,
      reorderPrediction:liveRuntime.reorderPrediction,
      referredCount:liveRuntime.referredCount,
      qualifiedReferralCount:liveRuntime.qualifiedReferralCount,
      comparisonSavingsCents:liveRuntime.comparisonSavingsCents,
      cashbackEarnedCents:liveRuntime.cashbackEarnedCents
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
  if(!force&&liveRuntime.marketStatus&&now-liveRuntime.lastMarketStatusAt<CUSTOMER_MARKET_REFRESH_MS)return liveRuntime.marketStatus;
  const seq=++liveRuntime.marketStatusSeq;
  const data=await liveInvoke('market-status',{});
  if(seq!==liveRuntime.marketStatusSeq)return liveRuntime.marketStatus;
  liveRuntime.marketStatus={
    commerceEnabled:data?.commerceEnabled===true,
    launchMode:String(data?.launchMode||'prelaunch'),
    supplyConfigured:data?.supplyConfigured===true,
    realSupplyConfigured:data?.realSupplyConfigured===true,
    configuredMerchantCount:Math.max(0,Number(data?.configuredMerchantCount||0)),
    availableNow:data?.availableNow===true,
    availableMerchantCount:Math.max(0,Number(data?.availableMerchantCount||0)),
    productCodes:Array.isArray(data?.productCodes)?data.productCodes.map(code=>String(code).trim().toUpperCase()):[],
    productDefinitions:Array.isArray(data?.productDefinitions)
      ? data.productDefinitions.map(item=>({
        productCode:String(item?.productCode||'').trim().toUpperCase(),
        productName:String(item?.productName||'').trim(),
        categoryKey:String(item?.categoryKey||'other').trim().toLowerCase(),
        categoryName:String(item?.categoryName||'Outros').trim(),
        sortOrder:Number(item?.sortOrder||100)
      })).filter(item=>/^[A-Z][A-Z0-9_]{1,31}$/.test(item.productCode)&&item.productName.length>0)
      :[],
    commercialPolicy:data?.commercialPolicy&&typeof data.commercialPolicy==='object'
      ?{
        active:data.commercialPolicy.active===true,
        platformFeeBps:Math.max(0,Number(data.commercialPolicy.platformFeeBps||0)),
        cashbackBps:Math.max(0,Number(data.commercialPolicy.cashbackBps||0)),
        directReferralBps:Math.max(0,Number(data.commercialPolicy.directReferralBps||0)),
        commissionHoldHours:Math.max(0,Number(data.commercialPolicy.commissionHoldHours||0)),
        version:Math.max(1,Number(data.commercialPolicy.version||1))
      }
      :null
  };
  const definitionByCode=new Map(
    (liveRuntime.marketStatus.productDefinitions||[]).map(item=>[item.productCode,item])
  );
  for(const code of liveRuntime.marketStatus.productCodes){
    const definition=definitionByCode.get(code)||null;
    if(globalThis.ensureProductDefinition?.(code,definition)&&!(code in state.cart))state.cart[code]=0;
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
  if(!liveReady()||liveRuntime.actionPending||liveRuntime.pollPending||document.visibilityState==='hidden')return;
  liveRuntime.pollPending=true;
  try{
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
        liveRuntime.error=null;
        render();
      }else{
        liveRuntime.error=String(error?.message||error||'Não foi possível atualizar o pedido.');
        render();
      }
    }
  }finally{
    liveRuntime.pollPending=false;
  }
}


const merchantRuntime={
  requested:configuredPortalRole
    ? configuredPortalRole==='merchant'
    : new URLSearchParams(location.search).get('merchant')==='1',
  status:'disabled',
  client:null,
  session:null,
  merchant:null,
  memberships:[],
  ownApplications:[],
  ownApplicationsLoaded:false,
  applicationFetchError:null,
  deliveryTeam:[],
  team:null,
  teamLoading:false,
  catalog:[],
  availableProducts:[],
  billing:null,
  receivingAccount:null,
  receivingAccounts:[],
  paymentProviders:[],
  paymentRoutes:[],
  paymentRouteVersion:1,
  orders:[],
  selectedMerchantId:localStorage.getItem('chama-merchant-selected-v1')||null,
  actionPending:false,
  error:null,
  notice:null,
  accessReason:null,
  heartbeatError:null,
  lastSyncAt:null,
  lastHeartbeatAt:0,
  lastPollAt:0,
  refreshSeq:0,
  pollPending:false
};

const MERCHANT_ALERTS_KEY='chama-merchant-alerts-v1';
function merchantStoredAlertsEnabled(){
  try{return localStorage.getItem(MERCHANT_ALERTS_KEY)==='1'}catch{return false}
}
const merchantAlerts={
  enabled:merchantStoredAlertsEnabled(),
  knownOrderIds:new Set(),
  audioContext:null,
  lastAlertAt:0
};

function merchantAlertStatus(){
  const supported=typeof Notification!=='undefined';
  return {
    enabled:merchantAlerts.enabled===true,
    notificationSupported:supported,
    notificationPermission:supported?Notification.permission:'unsupported'
  };
}

function merchantAlertCandidates(orders=[],merchant=merchantRuntime.merchant){
  const role=String(merchant?.memberRole||'');
  if(role==='driver'){
    return (orders||[]).filter(o=>['PREPARING','AT_RISK','OUT_FOR_DELIVERY','ARRIVING'].includes(String(o?.status||'')));
  }
  if(['owner','manager','operator'].includes(role)){
    return (orders||[]).filter(o=>String(o?.status||'')==='OFFERED_TO_MERCHANT');
  }
  return [];
}

async function merchantEnsureAlertAudio(){
  const AudioCtor=globalThis.AudioContext||globalThis.webkitAudioContext;
  if(!AudioCtor)return null;
  if(!merchantAlerts.audioContext)merchantAlerts.audioContext=new AudioCtor();
  if(merchantAlerts.audioContext.state==='suspended'){
    try{await merchantAlerts.audioContext.resume()}catch{}
  }
  return merchantAlerts.audioContext;
}

async function merchantPlayAlertTone(){
  const ctx=await merchantEnsureAlertAudio();
  if(!ctx||ctx.state!=='running')return false;
  const base=ctx.currentTime+0.01;
  [0,0.24,0.48].forEach((offset,index)=>{
    const osc=ctx.createOscillator();
    const gain=ctx.createGain();
    osc.type='sine';
    osc.frequency.setValueAtTime(index===1?1040:880,base+offset);
    gain.gain.setValueAtTime(0.0001,base+offset);
    gain.gain.exponentialRampToValueAtTime(0.16,base+offset+0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001,base+offset+0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(base+offset);
    osc.stop(base+offset+0.18);
  });
  return true;
}

async function merchantShowSystemNotification(kind,count){
  if(typeof Notification==='undefined'||Notification.permission!=='granted')return false;
  const title=kind==='driver'?'Nova entrega no TAMÃO':'Novo pedido no TAMÃO';
  const body=kind==='driver'
    ? (count>1?count+' entregas foram atribuídas a você.':'Uma entrega foi atribuída a você.')
    : (count>1?count+' pedidos aguardam aceite.':'Um pedido aguarda seu aceite.');
  const options={
    body,
    tag:'chama-merchant-alert',
    renotify:true,
    icon:'./icons/icon.svg',
    badge:'./icons/icon.svg',
    data:{url:'./?merchant=1#merchant'}
  };
  try{
    if(navigator.serviceWorker?.ready){
      const registration=await navigator.serviceWorker.ready;
      await registration.showNotification(title,options);
      return true;
    }
  }catch{}
  try{
    new Notification(title,options);
    return true;
  }catch{return false}
}

async function merchantFireAlert(kind,count){
  if(!merchantAlerts.enabled||count<1)return false;
  const now=Date.now();
  if(now-merchantAlerts.lastAlertAt<1200)return false;
  merchantAlerts.lastAlertAt=now;
  try{navigator.vibrate?.([180,80,180,80,260])}catch{}
  await merchantPlayAlertTone().catch(()=>false);
  await merchantShowSystemNotification(kind,count).catch(()=>false);
  try{
    toast(kind==='driver'
      ?(count>1?count+' novas entregas atribuídas':'Nova entrega atribuída')
      :(count>1?count+' novos pedidos aguardando aceite':'Novo pedido aguardando aceite'));
  }catch{}
  return true;
}

function merchantProcessOrderAlerts(orders=[],merchant=merchantRuntime.merchant){
  const candidates=merchantAlertCandidates(orders,merchant);
  const current=new Set(candidates.map(o=>String(o?.orderId||'')).filter(Boolean));
  const fresh=[...current].filter(id=>!merchantAlerts.knownOrderIds.has(id));
  merchantAlerts.knownOrderIds=current;
  if(merchantAlerts.enabled&&fresh.length){
    const kind=String(merchant?.memberRole||'')==='driver'?'driver':'merchant';
    merchantFireAlert(kind,fresh.length).catch(()=>{});
  }
  return fresh.length;
}

async function merchantEnableAlertsLive(){
  merchantAlerts.enabled=true;
  try{localStorage.setItem(MERCHANT_ALERTS_KEY,'1')}catch{}
  await merchantEnsureAlertAudio().catch(()=>null);
  let permission=typeof Notification==='undefined'?'unsupported':Notification.permission;
  if(typeof Notification!=='undefined'&&Notification.permission==='default'){
    try{permission=await Notification.requestPermission()}catch{permission=Notification.permission}
  }
  merchantAlerts.knownOrderIds=new Set();
  const fresh=merchantProcessOrderAlerts(merchantRuntime.orders,merchantRuntime.merchant);
  if(!fresh)await merchantPlayAlertTone().catch(()=>false);
  try{navigator.vibrate?.(120)}catch{}
  render();
  return {enabled:true,notificationPermission:permission};
}

function merchantDisableAlertsLive(){
  merchantAlerts.enabled=false;
  merchantAlerts.knownOrderIds=new Set();
  try{localStorage.removeItem(MERCHANT_ALERTS_KEY)}catch{}
  render();
  return {enabled:false};
}

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
    const callbackSession=captureSupabaseImplicitSessionFromUrl();

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

    let {data:{session},error}=await client.auth.getSession();

    if((error||!session?.access_token)&&callbackSession?.access_token&&callbackSession?.refresh_token){
      const restored=await client.auth.setSession({
        access_token:callbackSession.access_token,
        refresh_token:callbackSession.refresh_token
      });
      if(restored.error)throw restored.error;
      session=restored.data.session??null;
      error=null;
    }
    if(error)throw error;

    if(session?.access_token){
      clearSupabaseAuthFragment('merchant');
    }
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
    if(merchantRuntime.status==='no-access'){
      // Failing this auxiliary read must never turn a valid login into an error.
      try{await merchantLoadOwnApplications()}catch(error){
        merchantRuntime.applicationFetchError=String(error?.message||error);
      }
    }
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

async function merchantLoadOwnApplications(){
  if(!merchantRuntime.session?.access_token)return [];
  const result=await merchantInvoke('submit-merchant-application',{action:'my-applications'});
  merchantRuntime.ownApplications=Array.isArray(result?.applications)?result.applications:[];
  merchantRuntime.ownApplicationsLoaded=true;
  merchantRuntime.applicationFetchError=null;
  return merchantRuntime.ownApplications;
}
function merchantOwnApplicationForInvite(){
  const all=merchantRuntime.ownApplications||[];
  const hinted=globalThis.merchantProspectInviteDetails?.();
  const cnpj=String(hinted?.cnpj||'').replace(/\D/g,'');
  if(cnpj)return all.find(x=>String(x.cnpj||'').replace(/\D/g,'')===cnpj)||null;
  return all[0]||null;
}

async function merchantSendLogin(email){
  if(!merchantRuntime.client)await merchantBackendInit();
  const value=String(email||'').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw new Error('Informe um e-mail válido');
  const redirect=new URL(location.origin+location.pathname);
  redirect.searchParams.set('merchant','1');
  // Supabase implicit auth owns the URL fragment while returning access tokens.
  // Pilot invite state is already persisted separately, so keep this hash empty.
  merchantPilotInviteToken();
  redirect.hash='';
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
  merchantRuntime.ownApplications=[];
  merchantRuntime.ownApplicationsLoaded=false;
  merchantRuntime.applicationFetchError=null;
  merchantRuntime.deliveryTeam=[];
  merchantRuntime.team=null;
  merchantRuntime.teamLoading=false;
  merchantRuntime.catalog=[];
  merchantRuntime.availableProducts=[];
  merchantRuntime.billing=null;
  merchantRuntime.receivingAccount=null;
  merchantRuntime.receivingAccounts=[];
  merchantRuntime.paymentProviders=[];
  merchantRuntime.paymentRoutes=[];
  merchantRuntime.paymentRouteVersion=1;
  merchantRuntime.orders=[];
  merchantRuntime.selectedMerchantId=null;
  localStorage.removeItem('chama-merchant-selected-v1');
  merchantRuntime.status='unauthenticated';
  merchantRuntime.error=null;
  merchantRuntime.notice=null;
  merchantRuntime.accessReason=null;
  merchantRuntime.heartbeatError=null;
  merchantAlerts.knownOrderIds=new Set();
  render();
}

async function merchantRefresh({silent=false,recoverSelection=true}={}){
  if(!merchantRuntime.client)return null;
  const seq=++merchantRuntime.refreshSeq;
  if(!silent)render();
  try{
    const body={};
    if(merchantRuntime.selectedMerchantId)body.merchantId=merchantRuntime.selectedMerchantId;
    const data=await merchantInvoke('merchant-orders',body);
    if(seq!==merchantRuntime.refreshSeq)return data;
    merchantRuntime.merchant=data.merchant??null;
    merchantRuntime.memberships=data.memberships??[];
    merchantRuntime.deliveryTeam=data.deliveryTeam??[];
    merchantRuntime.catalog=data.catalog??[];
    merchantRuntime.availableProducts=data.availableProducts??[];
    merchantRuntime.billing=data.billing??null;
    merchantRuntime.receivingAccount=data.receivingAccount??null;
    merchantRuntime.receivingAccounts=Array.isArray(data.receivingAccounts)?data.receivingAccounts:[];
    merchantRuntime.paymentProviders=Array.isArray(data.paymentProviders)?data.paymentProviders:[];
    merchantRuntime.paymentRoutes=Array.isArray(data.paymentRoutes)?data.paymentRoutes:[];
    merchantRuntime.paymentRouteVersion=Number(data.paymentRouteVersion||1);
    merchantRuntime.orders=data.orders??[];
    merchantProcessOrderAlerts(merchantRuntime.orders,merchantRuntime.merchant);
    merchantRuntime.selectedMerchantId=data.merchant?.merchantId??merchantRuntime.selectedMerchantId;
    if(merchantRuntime.selectedMerchantId)localStorage.setItem('chama-merchant-selected-v1',merchantRuntime.selectedMerchantId);
    merchantRuntime.status='ready';
    merchantRuntime.error=null;
    merchantRuntime.accessReason=null;
    merchantRuntime.lastSyncAt=new Date().toISOString();
    return data;
  }catch(error){
    if(seq!==merchantRuntime.refreshSeq)return null;
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
      merchantRuntime.deliveryTeam=[];
      merchantRuntime.team=null;
      merchantRuntime.teamLoading=false;
      merchantRuntime.catalog=[];
      merchantRuntime.availableProducts=[];
      merchantRuntime.billing=null;
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
  merchantAlerts.knownOrderIds=new Set();
  merchantRuntime.team=null;
  merchantRuntime.teamLoading=false;
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
    const idempotencyKey=liveIdempotency('merchant-action');
    const result=await retryAmbiguousOnce(
      ()=>merchantInvoke('merchant-action',body,{idempotencyKey})
    );
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

async function merchantTeamLoadLive({silent=false}={}){
  const merchantId=merchantRuntime.merchant?.merchantId;
  if(!merchantId)throw new Error('Revenda não selecionada');
  if(!['owner','manager'].includes(String(merchantRuntime.merchant?.memberRole||''))){
    throw new Error('Seu papel não pode gerenciar a equipe');
  }
  merchantRuntime.teamLoading=true;
  if(!silent)render();
  try{
    const data=await merchantInvoke('merchant-team',{merchantId,action:'list'});
    merchantRuntime.team=data??{actorRole:null,members:[],pendingInvites:[]};
    return merchantRuntime.team;
  }finally{
    merchantRuntime.teamLoading=false;
    if(!silent)render();
  }
}

async function merchantTeamMutateLive(action,payload={}){
  const merchantId=merchantRuntime.merchant?.merchantId;
  if(!merchantId)throw new Error('Revenda não selecionada');
  if(!['invite','revoke-member','revoke-invite'].includes(action)){
    throw new Error('Ação de equipe inválida');
  }
  merchantRuntime.actionPending=true;
  merchantRuntime.error=null;
  render();
  try{
    const idempotencyKey=liveIdempotency('merchant-team');
    const result=await retryAmbiguousOnce(
      ()=>merchantInvoke('merchant-team',{
        merchantId,
        action,
        ...payload
      },{idempotencyKey})
    );
    await merchantRefresh({silent:true});
    await merchantTeamLoadLive({silent:true});
    return result;
  }catch(error){
    merchantRuntime.error=String(error?.message||error);
    try{await merchantTeamLoadLive({silent:true})}catch{}
    throw error;
  }finally{
    merchantRuntime.actionPending=false;
    render();
  }
}

async function merchantTeamInviteLive(email,memberRole,displayName){
  const normalizedEmail=String(email||'').trim().toLowerCase();
  const role=String(memberRole||'').trim().toLowerCase();
  const name=String(displayName||'').trim().replace(/\s+/g,' ');
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail))throw new Error('Informe um e-mail válido');
  if(!['manager','operator','driver'].includes(role))throw new Error('Papel de equipe inválido');
  if(name&&name.length>60)throw new Error('Nome operacional muito longo');
  return merchantTeamMutateLive('invite',{
    email:normalizedEmail,
    memberRole:role,
    displayName:name||null
  });
}

async function merchantTeamRevokeMemberLive(targetUserId){
  return merchantTeamMutateLive('revoke-member',{targetUserId:String(targetUserId||'')});
}

async function merchantTeamRevokeInviteLive(inviteId){
  return merchantTeamMutateLive('revoke-invite',{inviteId:String(inviteId||'')});
}

async function merchantOpenTeam(){
  try{
    await merchantTeamLoadLive({silent:true});
    go('merchant-team');
  }catch(error){
    toast(String(error?.message||error));
  }
}

async function merchantAssignDeliveryLive(orderId,deliveryUserId){
  if(merchantRuntime.actionPending)return;
  const order=merchantRuntime.orders.find(o=>o.orderId===orderId);
  if(!order)throw new Error('Pedido não encontrado no painel');
  if(!deliveryUserId)throw new Error('Escolha um responsável pela entrega');
  merchantRuntime.actionPending=true;
  merchantRuntime.error=null;
  render();
  try{
    const idempotencyKey=liveIdempotency('merchant-action');
    const result=await retryAmbiguousOnce(
      ()=>merchantInvoke('merchant-action',{
        orderId,
        action:'assign-delivery',
        expectedVersion:order.version,
        deliveryUserId:String(deliveryUserId)
      },{idempotencyKey})
    );
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

async function merchantUpdateMemberProfileLive(displayName){
  const merchantId=merchantRuntime.merchant?.merchantId;
  if(!merchantId)throw new Error('Revenda não selecionada');
  const name=String(displayName||'').trim().replace(/\s+/g,' ');
  if(name.length<2||name.length>60)throw new Error('Informe um nome operacional entre 2 e 60 caracteres');
  merchantRuntime.actionPending=true;render();
  try{
    await retryAmbiguousOnce(()=>merchantInvoke('merchant-ops',{
      merchantId,
      action:'update-member-profile',
      displayName:name
    }));
    await merchantRefresh({silent:true});
  }finally{
    merchantRuntime.actionPending=false;render();
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
    const idempotencyKey=liveIdempotency('complete-delivery');
    const result=await retryAmbiguousOnce(()=>merchantInvoke('complete-delivery',{
      orderId,
      pin:String(pin),
      expectedVersion:order.version,
      paymentConfirmed:true
    },{idempotencyKey}));
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

async function merchantPaymentConnectLive(provider='mercadopago',action='status'){
  const merchantId=merchantRuntime.merchant?.merchantId;
  if(!merchantId)throw new Error('Revenda não selecionada');
  if(!['owner','manager'].includes(String(merchantRuntime.merchant?.memberRole||''))){
    throw new Error('Seu papel não pode gerenciar a conta de recebimento');
  }
  const normalizedProvider=String(provider||'').trim().toLowerCase();
  const normalizedAction=String(action||'status').trim().toLowerCase();
  if(!/^[a-z][a-z0-9_]{1,39}$/.test(normalizedProvider)){
    throw new Error('Provedor de pagamento inválido');
  }
  if(!['status','start','disconnect'].includes(normalizedAction)){
    throw new Error('Ação de conexão de pagamento inválida');
  }
  merchantRuntime.actionPending=true;
  merchantRuntime.error=null;
  render();
  try{
    const result=await merchantInvoke('merchant-payment-connect',{
      merchantId,
      provider:normalizedProvider,
      action:normalizedAction
    });
    if(normalizedAction==='start'){
      const raw=String(result?.authorizationUrl||'');
      let url=null;
      try{url=new URL(raw)}catch{}
      const allowedHosts=new Set(
        normalizedProvider==='mercadopago'
          ?['auth.mercadopago.com']
          :normalizedProvider==='pagbank'
            ?['connect.pagseguro.uol.com.br','connect.sandbox.pagseguro.uol.com.br']
            :[]
      );
      if(!url||url.protocol!=='https:'||!allowedHosts.has(url.hostname)){
        throw new Error('URL de autorização do provedor inválida');
      }
      location.href=url.toString();
      return result;
    }
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

async function merchantUpdatePaymentRoutesLive(routes,reason='Atualização das formas de recebimento'){
  const merchantId=merchantRuntime.merchant?.merchantId;
  if(!merchantId)throw new Error('Revenda não selecionada');
  if(!['owner','manager'].includes(String(merchantRuntime.merchant?.memberRole||''))){
    throw new Error('Seu papel não pode configurar recebimentos');
  }
  if(!Array.isArray(routes)||routes.length<1||routes.length>30){
    throw new Error('Configure ao menos uma forma de recebimento válida');
  }
  const expectedVersion=Number(merchantRuntime.paymentRouteVersion||1);
  const cleanReason=String(reason||'').trim().replace(/\s+/g,' ');
  if(cleanReason.length<3||cleanReason.length>1000)throw new Error('Motivo da alteração inválido');
  merchantRuntime.actionPending=true;
  merchantRuntime.error=null;
  render();
  try{
    const idempotencyKey=liveIdempotency('merchant-payment-routes');
    const result=await retryAmbiguousOnce(()=>merchantInvoke('merchant-ops',{
      merchantId,
      action:'update-payment-routes',
      expectedVersion,
      routes,
      reason:cleanReason
    },{idempotencyKey}));
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

async function merchantBillingRequestLive(action,payload={}){
  const merchantId=merchantRuntime.merchant?.merchantId;
  if(!merchantId)throw new Error('Revenda não selecionada');
  if(!['owner','manager'].includes(String(merchantRuntime.merchant?.memberRole||''))){
    throw new Error('Seu papel não pode operar cobranças e pacotes');
  }
  const allowed=['request-billing-package','notify-billing-payment','notify-refund-recovery-payment','cancel-billing-request'];
  if(!allowed.includes(action))throw new Error('Ação financeira inválida');
  merchantRuntime.actionPending=true;
  merchantRuntime.error=null;
  render();
  try{
    const idempotencyKey=liveIdempotency('merchant-billing');
    const result=await retryAmbiguousOnce(()=>merchantInvoke('merchant-ops',{
      merchantId,
      action,
      ...payload
    },{idempotencyKey}));
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

async function merchantCreateBillingPixLive({planKey=null,statementId=null,refundRecoveryId=null}={}){
  const merchantId=merchantRuntime.merchant?.merchantId;
  if(!merchantId)throw new Error('Revenda não selecionada');
  if(!['owner','manager'].includes(String(merchantRuntime.merchant?.memberRole||''))){
    throw new Error('Seu papel não pode gerar cobranças Pix');
  }
  const plan=planKey==null?null:String(planKey).trim().toLowerCase();
  const statement=statementId==null?null:String(statementId).trim();
  const recovery=refundRecoveryId==null?null:String(refundRecoveryId).trim();
  if([plan,statement,recovery].filter(v=>v!=null).length!==1){
    throw new Error('Informe exatamente uma cobrança financeira');
  }
  if(plan!=null&&!/^[a-z][a-z0-9_]{1,39}$/.test(plan))throw new Error('Pacote de crédito inválido');
  if(statement!=null&&!statement)throw new Error('Fechamento diário inválido');
  if(recovery!=null&&!recovery)throw new Error('Obrigação de recuperação inválida');

  merchantRuntime.actionPending=true;
  merchantRuntime.error=null;
  render();
  try{
    const idempotencyKey=liveIdempotency('merchant-billing-pix');
    const result=await retryAmbiguousOnce(()=>merchantInvoke('merchant-billing-pix',{
      merchantId,
      planKey:plan,
      statementId:statement,
      refundRecoveryId:recovery
    },{idempotencyKey}));
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

async function merchantRequestBillingPackageLive(planKey,reference){
  const plan=String(planKey||'').trim().toLowerCase();
  const ref=String(reference||'').trim().replace(/\s+/g,' ');
  if(!/^[a-z][a-z0-9_]{1,39}$/.test(plan))throw new Error('Pacote de crédito inválido');
  if(ref.length<3||ref.length>240)throw new Error('Informe a referência do pagamento');
  return merchantBillingRequestLive('request-billing-package',{planKey:plan,reference:ref});
}

async function merchantNotifyBillingPaymentLive(statementId,reference){
  const id=String(statementId||'').trim();
  const ref=String(reference||'').trim().replace(/\s+/g,' ');
  if(!id)throw new Error('Fechamento diário inválido');
  if(ref.length<3||ref.length>240)throw new Error('Informe a referência do pagamento');
  return merchantBillingRequestLive('notify-billing-payment',{statementId:id,reference:ref});
}

async function merchantNotifyRefundRecoveryPaidLive(refundRecoveryId,reference){
  const id=String(refundRecoveryId||'').trim();
  const ref=String(reference||'').trim().replace(/\s+/g,' ');
  if(!id)throw new Error('Obrigação de recuperação inválida');
  if(ref.length<3||ref.length>240)throw new Error('Informe a referência do pagamento');
  return merchantBillingRequestLive(
    'notify-refund-recovery-payment',
    {refundRecoveryId:id,reference:ref}
  );
}

async function merchantCancelBillingRequestLive(paymentRequestId){
  const id=String(paymentRequestId||'').trim();
  if(!id)throw new Error('Solicitação financeira inválida');
  return merchantBillingRequestLive('cancel-billing-request',{paymentRequestId:id});
}

async function merchantSetOnlineLive(online){
  const merchantId=merchantRuntime.merchant?.merchantId;
  if(!merchantId)throw new Error('Revenda não selecionada');
  merchantRuntime.actionPending=true;render();
  try{
    await retryAmbiguousOnce(
      ()=>merchantInvoke('merchant-ops',{merchantId,action:'set-online',online:online===true})
    );
    await merchantRefresh({silent:true});
  }finally{
    merchantRuntime.actionPending=false;render();
  }
}

async function merchantUpdateProductLive(productCode,priceCents,availableStock,active=true,pricing={}){
  const merchantId=merchantRuntime.merchant?.merchantId;
  if(!merchantId)throw new Error('Revenda não selecionada');
  merchantRuntime.actionPending=true;render();
  try{
    const normalizedCode=String(productCode||'').trim().toUpperCase();
    const current=(merchantRuntime.catalog||[]).find(
      item=>String(item?.productCode||'').trim().toUpperCase()===normalizedCode
    )||null;
    const body={
      merchantId,action:'update-product',productCode:normalizedCode,
      priceCents:Number(priceCents),availableStock:Number(availableStock),active:active!==false
    };
    if(current?.updatedAt)body.expectedUpdatedAt=String(current.updatedAt);
    if(pricing&&typeof pricing==='object'){
      if(pricing.pricingMode!=null)body.pricingMode=String(pricing.pricingMode);
      if(pricing.minPriceCents!=null)body.minPriceCents=Number(pricing.minPriceCents);
      if(pricing.maxPriceCents!=null)body.maxPriceCents=Number(pricing.maxPriceCents);
      if(pricing.pricingStrategy!=null)body.pricingStrategy=String(pricing.pricingStrategy);
    }
    const idempotencyKey=liveIdempotency('merchant-catalog');
    try{
      await retryAmbiguousOnce(()=>merchantInvoke('merchant-ops',body,{idempotencyKey}));
    }catch(error){
      if(['CATALOG_VERSION_CONFLICT','CATALOG_VERSION_REQUIRED'].includes(String(error?.code||''))){
        await merchantRefresh({silent:true});
      }
      throw error;
    }
    await merchantRefresh({silent:true});
  }finally{
    merchantRuntime.actionPending=false;render();
  }
}

async function merchantConfigMutation(action,payload={}){
  const merchantId=merchantRuntime.merchant?.merchantId;
  if(!merchantId)throw new Error('Revenda não selecionada');
  let expectedUpdatedAt=String(merchantRuntime.merchant?.configUpdatedAt||'').trim();
  if(!expectedUpdatedAt){
    await merchantRefresh({silent:true});
    expectedUpdatedAt=String(merchantRuntime.merchant?.configUpdatedAt||'').trim();
  }
  if(!expectedUpdatedAt)throw Object.assign(new Error('Atualize o painel antes de salvar a configuração'),{code:'CONFIG_VERSION_REQUIRED'});

  const idempotencyKey=liveIdempotency('merchant-config');
  try{
    return await retryAmbiguousOnce(()=>merchantInvoke('merchant-ops',{
      merchantId,
      action,
      expectedUpdatedAt,
      ...payload
    },{idempotencyKey}));
  }catch(error){
    if(['CONFIG_VERSION_CONFLICT','CONFIG_VERSION_REQUIRED'].includes(String(error?.code||''))){
      await merchantRefresh({silent:true});
    }
    throw error;
  }
}

async function merchantUpdateLogisticsLive(deliveryFeeCents,baseEtaMinutes,acceptsCitywide){
  merchantRuntime.actionPending=true;render();
  try{
    await merchantConfigMutation('update-logistics',{
      deliveryFeeCents:Number(deliveryFeeCents),
      baseEtaMinutes:Number(baseEtaMinutes),
      acceptsCitywide:acceptsCitywide===true
    });
    await merchantRefresh({silent:true});
  }finally{
    merchantRuntime.actionPending=false;render();
  }
}

async function merchantUpdateCapacityLive(maxActiveOrders){
  const capacity=Number(maxActiveOrders);
  if(!Number.isInteger(capacity)||capacity<1||capacity>100)throw new Error('Capacidade precisa ficar entre 1 e 100 pedidos');
  merchantRuntime.actionPending=true;render();
  try{
    await merchantConfigMutation('update-capacity',{maxActiveOrders:capacity});
    await merchantRefresh({silent:true});
  }finally{
    merchantRuntime.actionPending=false;render();
  }
}

async function merchantUpdateSchedulingLive(acceptsScheduledOrders){
  merchantRuntime.actionPending=true;render();
  try{
    await merchantConfigMutation('update-scheduling',{
      acceptsScheduledOrders:acceptsScheduledOrders===true
    });
    await merchantRefresh({silent:true});
  }finally{
    merchantRuntime.actionPending=false;render();
  }
}

async function merchantUpdatePaymentMethodsLive(methods){
  const payload={
    pix:methods?.pix===true,
    card:methods?.card===true,
    cash:methods?.cash===true
  };
  if(!Object.values(payload).some(Boolean))throw new Error('Ative pelo menos uma forma de pagamento');
  merchantRuntime.actionPending=true;render();
  try{
    await merchantConfigMutation('update-payment-methods',payload);
    await merchantRefresh({silent:true});
  }finally{
    merchantRuntime.actionPending=false;render();
  }
}

function merchantPilotInviteErrorMessage(error){
  const raw=String(error?.message||error?.details||error?.hint||error||'');
  if(raw.includes('PILOT_INVITE_EXPIRED'))return 'Este convite de parceiro expirou. Solicite um novo link.';
  if(raw.includes('PILOT_INVITE_REVOKED'))return 'Este convite de parceiro foi revogado.';
  if(raw.includes('PILOT_INVITE_ALREADY_CLAIMED'))return 'Este convite de parceiro já foi usado por outra conta.';
  if(raw.includes('PILOT_PARTNER_ALREADY_CONVERTED'))return 'Este parceiro já foi convertido em revenda.';
  if(raw.includes('APPLICATION_PILOT_LINK_CONFLICT'))return 'Este cadastro já está ligado a outro convite de parceiro.';
  if(raw.includes('INVALID_PILOT_INVITE'))return 'Convite de parceiro inválido.';
  return raw||'Não foi possível vincular o convite de parceiro';
}

async function merchantClaimPilotInviteLive(applicationId,pilotInviteToken){
  if(!merchantRuntime.client)throw new Error('Cliente da revenda indisponível');
  const application=String(applicationId||'').trim();
  const token=String(pilotInviteToken||'').trim();
  if(!application||!/^[A-Za-z0-9_-]{20,240}$/.test(token))return null;
  const {data,error}=await merchantRuntime.client.rpc('claim_my_pilot_partner_invite',{
    p_application_id:application,
    p_token:token
  });
  if(error){
    const raw=String(error?.message||error?.details||error?.hint||error||'');
    if(
      raw.includes('PILOT_INVITE_EXPIRED')
      ||raw.includes('PILOT_INVITE_REVOKED')
      ||raw.includes('PILOT_INVITE_ALREADY_CLAIMED')
      ||raw.includes('INVALID_PILOT_INVITE')
    )clearMerchantPilotInviteToken();
    throw new Error(merchantPilotInviteErrorMessage(error));
  }
  clearMerchantPilotInviteToken();
  return data??null;
}

async function merchantSubmitApplicationLive(payload){
  if(!merchantRuntime.session?.access_token)throw new Error('Entre com seu e-mail antes de enviar o cadastro');
  const result=await retryAmbiguousOnce(()=>merchantInvoke('submit-merchant-application',payload));
  // Keep the returned application on screen, even if the subsequent refresh fails.
  if(result?.applicationId){
    merchantRuntime.ownApplications=[{
      id:result.applicationId,cnpj:String(result.cnpj||payload.cnpj),
      company_name:String(result.companyName||payload.companyName||''),
      responsible_name:String(payload.responsibleName||''),
      phone:String(payload.phone||''),address_text:String(payload.address||''),
      status:String(result.status||'pending'),
      created_at:result.createdAt||new Date().toISOString(),
      updated_at:result.updatedAt||new Date().toISOString()
    },...(merchantRuntime.ownApplications||[]).filter(x=>x.id!==result.applicationId)];
    merchantRuntime.ownApplicationsLoaded=true;
  }
  const pilotInviteToken=String(payload?.pilotInviteToken||'').trim();
  if(pilotInviteToken&&!result?.pilotPartner&&result?.applicationId){
    result.pilotPartner=await merchantClaimPilotInviteLive(result.applicationId,pilotInviteToken);
  }
  return result;
}

async function merchantHeartbeat(){
  if(!merchantReady()||merchantRuntime.actionPending||!merchantRuntime.merchant)return false;
  if(merchantRuntime.merchant.memberRole==='driver')return null;
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

// Apenas pedidos aguardando o parceiro exigem polling de 5s.
// Entregas em andamento mantêm 10s; revenda online sem pedido usa 15s.
// Com operação offline e sem pedidos, o painel economiza chamadas usando 60s.
// Não altera o heartbeat (60s) nem a elegibilidade no servidor (10 min).
function merchantPollingIntervalMs(orders,online){
  const list=Array.isArray(orders)?orders:[];
  if(list.some(order=>String(order?.status||'')==='OFFERED_TO_MERCHANT'))return 5000;
  if(list.some(order=>!['SETTLED','CANCELLED'].includes(String(order?.status||''))))return 10000;
  return online===true?15000:60000;
}

async function merchantPoll(){
  if(!merchantReady()||merchantRuntime.actionPending||merchantRuntime.pollPending||document.visibilityState==='hidden')return;
  const now=Date.now();
  const activeOrders=(merchantRuntime.orders||[]).some(order=>!['SETTLED','CANCELLED'].includes(String(order?.status||'')));
  const urgent=merchantRuntime.merchant?.online===true||activeOrders;
  const minIntervalMs=merchantPollingIntervalMs(merchantRuntime.orders,merchantRuntime.merchant?.online===true);
  if(merchantRuntime.lastPollAt&&now-merchantRuntime.lastPollAt<minIntervalMs)return;
  merchantRuntime.lastPollAt=now;
  merchantRuntime.pollPending=true;
  try{
    if(urgent)await merchantHeartbeat();
    await merchantRefresh({silent:true});
    render();
  }catch{
    render();
  }
  finally{merchantRuntime.pollPending=false}
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
globalThis.isAmbiguousTransportError=isAmbiguousTransportError;
globalThis.retryAmbiguousOnce=retryAmbiguousOnce;
globalThis.buildPortalHref=buildPortalHref;
globalThis.liveRuntime=liveRuntime;
globalThis.prelaunchLeadSubmit=prelaunchLeadSubmit;
globalThis.publicRequestSubmit=publicRequestSubmit;
globalThis.customerOriginSafe=customerOriginSafe;
globalThis.backendInit=backendInit;
globalThis.liveRequested=liveRequested;
globalThis.liveReady=liveReady;
globalThis.liveBanner=liveBanner;
globalThis.liveAddressDraftReady=liveAddressDraftReady;
globalThis.liveRefreshOffers=liveRefreshOffers;
globalThis.liveScheduleOfferRefresh=liveScheduleOfferRefresh;
globalThis.liveCreateOrder=liveCreateOrder;
globalThis.liveGetOrder=liveGetOrder;
globalThis.liveStartMerchantPayment=liveStartMerchantPayment;
globalThis.liveCustomerAction=liveCustomerAction;
globalThis.liveUpgradeAccount=liveUpgradeAccount;
globalThis.livePoll=livePoll;
globalThis.liveSyncMarketStatus=liveSyncMarketStatus;
globalThis.prelaunchExamplesEnabled=prelaunchExamplesEnabled;
globalThis.merchantRuntime=merchantRuntime;
globalThis.merchantPortalRequested=merchantPortalRequested;
globalThis.merchantOriginSafe=merchantOriginSafe;
globalThis.merchantReady=merchantReady;
globalThis.merchantAlertStatus=merchantAlertStatus;
globalThis.merchantEnableAlertsLive=merchantEnableAlertsLive;
globalThis.merchantDisableAlertsLive=merchantDisableAlertsLive;
globalThis.merchantBackendInit=merchantBackendInit;
globalThis.merchantSendLogin=merchantSendLogin;
globalThis.merchantSignOut=merchantSignOut;
globalThis.merchantRefresh=merchantRefresh;
globalThis.merchantSelectLive=merchantSelectLive;
globalThis.merchantPerformAction=merchantPerformAction;
globalThis.merchantTeamLoadLive=merchantTeamLoadLive;
globalThis.merchantTeamInviteLive=merchantTeamInviteLive;
globalThis.merchantTeamRevokeMemberLive=merchantTeamRevokeMemberLive;
globalThis.merchantTeamRevokeInviteLive=merchantTeamRevokeInviteLive;
globalThis.merchantOpenTeam=merchantOpenTeam;
globalThis.merchantAssignDeliveryLive=merchantAssignDeliveryLive;
globalThis.merchantUpdateMemberProfileLive=merchantUpdateMemberProfileLive;
globalThis.merchantCompleteDeliveryLive=merchantCompleteDeliveryLive;
globalThis.merchantPaymentConnectLive=merchantPaymentConnectLive;
globalThis.merchantUpdatePaymentRoutesLive=merchantUpdatePaymentRoutesLive;
globalThis.merchantBillingRequestLive=merchantBillingRequestLive;
globalThis.merchantRequestBillingPackageLive=merchantRequestBillingPackageLive;
globalThis.merchantNotifyBillingPaymentLive=merchantNotifyBillingPaymentLive;
globalThis.merchantCancelBillingRequestLive=merchantCancelBillingRequestLive;
globalThis.merchantSetOnlineLive=merchantSetOnlineLive;
globalThis.merchantUpdateProductLive=merchantUpdateProductLive;
globalThis.merchantUpdateLogisticsLive=merchantUpdateLogisticsLive;
globalThis.captureSupabaseImplicitSessionFromUrl=captureSupabaseImplicitSessionFromUrl;
globalThis.clearSupabaseAuthFragment=clearSupabaseAuthFragment;
globalThis.merchantPilotInviteToken=merchantPilotInviteToken;
globalThis.merchantProspectInviteToken=merchantProspectInviteToken;
globalThis.merchantProspectInviteDetails=merchantProspectInviteDetails;
globalThis.merchantOwnApplicationForInvite=merchantOwnApplicationForInvite;
globalThis.clearMerchantProspectInviteToken=clearMerchantProspectInviteToken;
globalThis.clearMerchantPilotInviteToken=clearMerchantPilotInviteToken;
globalThis.merchantClaimPilotInviteLive=merchantClaimPilotInviteLive;
globalThis.merchantSubmitApplicationLive=merchantSubmitApplicationLive;
globalThis.merchantPoll=merchantPoll;
globalThis.openMerchantPortal=openMerchantPortal;
globalThis.openCustomerPortal=openCustomerPortal;
