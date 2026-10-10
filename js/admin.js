const adminRuntime={
  requested:String(globalThis.CHAMA_PORTAL_ROLE||'').trim().toLowerCase()
    ? String(globalThis.CHAMA_PORTAL_ROLE||'').trim().toLowerCase()==='admin'
    : new URLSearchParams(location.search).get('admin')==='1',
  status:'disabled',
  client:null,
  session:null,
  data:null,
  actionPending:false,
  error:null,
  notice:null,
  bootstrapStatus:null,
  bootstrapError:null,
  lastSyncAt:null,
  refreshSeq:0,
  pollPending:false,
  lastPollAt:0,
  searchQuery:'',
  searchResults:[],
  searchPending:false,
  detail:null,
  detailPending:false,
  health:null,
  healthPending:false,
  providerHealth:(()=>{
    try{
      const cached=JSON.parse(sessionStorage.getItem('tamao-admin-provider-health-v1')||'null');
      const health=cached?.health||null;
      const cachedAt=Date.parse(cached?.cachedAt||health?.checkedAt||'');
      if(!health||!Number.isFinite(cachedAt)||Date.now()-cachedAt>10*60*1000){
        sessionStorage.removeItem('tamao-admin-provider-health-v1');
        return null;
      }
      return health;
    }catch{return null}
  })(),
  providerHealthPending:false,
  paymentPreflights:{},
  prospectReport:null,
  prospectLoading:false,
  prospectError:null,
  prospectCity:'São Gabriel',
  prospectState:'RS',
  cityNotifications:[],
  cityNotificationsPending:false,
  cityNotificationsError:null,
  auditResults:null,
  auditPending:false,
  section:(()=>{
    try{
      const saved=sessionStorage.getItem('tamao-admin-section');
      return ['overview','orders','customers','partners','prospects','catalog','finance','incidents','audit','system'].includes(saved)?saved:'overview';
    }catch{return 'overview'}
  })()
};

function adminOriginSafe(){
  if(['localhost','127.0.0.1'].includes(location.hostname))return true;
  const configured=String(globalThis.CHAMA_ADMIN_ORIGIN||'').trim();
  return configured.length>0&&location.origin===configured;
}
function adminPortalRequested(){return adminRuntime.requested}
function adminReady(){return adminRuntime.requested&&adminOriginSafe()&&adminRuntime.status==='ready'}

async function adminBackendInit(){
  if(!adminRuntime.requested){
    adminRuntime.status='disabled';
    return false;
  }
  if(!adminOriginSafe()){
    adminRuntime.status='unsafe-origin';
    adminRuntime.error='O painel administrativo exige uma origem dedicada e isolada.';
    return false;
  }
  if(['ready','no-access','unauthenticated'].includes(adminRuntime.status)&&adminRuntime.client){
    return adminRuntime.status==='ready';
  }

  adminRuntime.status='loading';
  adminRuntime.error=null;
  try{
    // Capture the implicit-grant fragment before the SDK or router can mutate it.
    // This is a defensive fallback; Supabase detectSessionInUrl remains enabled.
    const callbackSession=globalThis.captureSupabaseImplicitSessionFromUrl?.()??null;

    const lib=await loadSupabaseBrowser();
    const client=lib.createClient(CHAMA_BACKEND.url,CHAMA_BACKEND.publishableKey,{
      auth:{
        persistSession:true,
        autoRefreshToken:true,
        detectSessionInUrl:true,
        storage:sessionStorage,
        storageKey:'chama-sg-admin-auth-v1'
      },
      global:{fetch:globalThis.chamaFetch}
    });
    adminRuntime.client=client;

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
      globalThis.clearSupabaseAuthFragment?.('admin');
    }
    adminRuntime.session=session??null;

    if(!session?.access_token){
      adminRuntime.status='unauthenticated';
      return false;
    }
    if(session.user?.is_anonymous===true){
      await client.auth.signOut().catch(()=>{});
      adminRuntime.session=null;
      adminRuntime.status='unauthenticated';
      adminRuntime.error='A administração exige uma conta permanente.';
      return false;
    }

    let bootstrapFailure=null;
    try{
      await adminClaimBootstrap();
    }catch(error){
      bootstrapFailure=error;
      adminRuntime.bootstrapError=String(error?.message||error||'Falha ao validar o primeiro acesso.');
    }
    await adminRefresh({silent:true});
    if(adminRuntime.status==='ready'){
      adminRuntime.bootstrapError=null;
      return true;
    }
    if(adminRuntime.status==='no-access'&&bootstrapFailure){
      adminRuntime.status='bootstrap-error';
      adminRuntime.error='Não foi possível confirmar a autorização administrativa. Tente validar o acesso novamente.';
    }
    return false;
  }catch(error){
    adminRuntime.status='unavailable';
    adminRuntime.error=String(error?.message||error||'Administração indisponível');
    return false;
  }
}

async function adminAccessToken(){
  if(!adminRuntime.client)throw new Error('Cliente administrativo indisponível');
  const {data:{session},error}=await adminRuntime.client.auth.getSession();
  if(error||!session?.access_token)throw error||new Error('Sessão administrativa expirada');
  if(session.user?.is_anonymous===true)throw new Error('Conta permanente obrigatória');
  adminRuntime.session=session;
  return session.access_token;
}

function adminIdempotency(prefix='admin'){
  const uuid=globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)+Date.now().toString(36);
  return prefix+':'+uuid;
}

async function adminInvoke(body={},options={}){
  const token=await adminAccessToken();
  const headers={
    'Content-Type':'application/json',
    'apikey':CHAMA_BACKEND.publishableKey,
    'Authorization':'Bearer '+token
  };
  if(options.idempotencyKey)headers['Idempotency-Key']=options.idempotencyKey;
  const response=await globalThis.chamaFetch(CHAMA_BACKEND.url+'/functions/v1/admin-ops',{
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

async function adminAuthInvoke(body={},options={}){
  const headers={
    'Content-Type':'application/json',
    'apikey':CHAMA_BACKEND.publishableKey
  };
  if(options.withSession===true){
    headers.Authorization='Bearer '+await adminAccessToken();
  }
  const response=await globalThis.chamaFetch(CHAMA_BACKEND.url+'/functions/v1/admin-auth',{
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

async function adminClaimBootstrap(){
  if(!adminRuntime.session?.access_token)return null;
  const result=await adminAuthInvoke({action:'claim'},{withSession:true});
  adminRuntime.bootstrapStatus=String(result?.status||'unknown');
  adminRuntime.bootstrapError=null;
  if(adminRuntime.bootstrapStatus==='claimed'){
    adminRuntime.notice='Primeiro acesso confirmado. A administração foi ativada com segurança.';
  }
  return result;
}

function adminBootstrapAccessMessage(){
  if(adminRuntime.bootstrapStatus==='not_reserved'){
    return 'Esta conta permanente foi autenticada, mas não corresponde à reserva administrativa inicial.';
  }
  if(adminRuntime.bootstrapStatus==='bootstrap_closed'){
    return 'O bootstrap inicial já foi encerrado porque existe outro administrador ativo. Esta conta só pode ser adicionada por um administrador existente.';
  }
  if(adminRuntime.bootstrapStatus==='unknown'){
    return 'A identidade foi autenticada, mas o servidor não confirmou uma condição válida de bootstrap.';
  }
  return 'Esta conta está autenticada, mas não possui autorização administrativa ativa.';
}

async function adminRetryBootstrapFromUi(){
  if(adminRuntime.actionPending)return;
  adminRuntime.actionPending=true;
  adminRuntime.status='loading';
  adminRuntime.error=null;
  adminRuntime.bootstrapError=null;
  render();
  try{
    await adminClaimBootstrap();
    await adminRefresh({silent:true});
    if(adminRuntime.status==='no-access'&&adminRuntime.bootstrapStatus==='claimed'){
      adminRuntime.status='bootstrap-error';
      adminRuntime.error='O primeiro acesso foi reivindicado, mas o control plane ainda não confirmou a permissão. Tente novamente.';
    }
  }catch(error){
    adminRuntime.status='bootstrap-error';
    adminRuntime.bootstrapError=String(error?.message||error||'Falha ao validar o acesso.');
    adminRuntime.error='A validação administrativa falhou antes de qualquer elevação de privilégio.';
  }finally{
    adminRuntime.actionPending=false;
    render();
  }
}

async function adminSendLogin(email){
  if(adminRuntime.actionPending)return null;
  const value=String(email||'').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw new Error('Informe um e-mail válido');

  adminRuntime.actionPending=true;
  adminRuntime.error=null;
  adminRuntime.notice='Abrindo a verificação de segurança…';
  render();

  try{
    const redirect=new URL(location.origin+location.pathname);
    redirect.searchParams.set('admin','1');
    // Supabase implicit auth returns access/refresh tokens in the URL fragment.
    // Keep the redirect hash empty until detectSessionInUrl consumes that fragment;
    // bootstrap.js routes to #admin only after authentication initializes.
    redirect.hash='';

    if(!globalThis.chamaTurnstile?.challenge){
      throw new Error('Proteção anti-bot indisponível. Atualize a página e tente novamente.');
    }

    const captchaToken=await globalThis.chamaTurnstile.challenge('admin_login');
    if(!captchaToken)throw new Error('A verificação anti-bot não gerou um token válido.');

    adminRuntime.notice='Verificação concluída. Solicitando o link de acesso…';
    render();

    // A solicitação do magic link não depende do SDK Supabase no navegador.
    // O servidor valida origem, Turnstile, rate limit e elegibilidade do e-mail.
    const result=await adminAuthInvoke({
      action:'request-link',
      email:value,
      captchaToken,
      redirectTo:redirect.toString()
    });

    adminRuntime.notice=String(result?.message||'Se este e-mail estiver autorizado, o link de acesso será enviado.');
    adminRuntime.status='unauthenticated';
    return result;
  }catch(error){
    adminRuntime.notice=null;
    adminRuntime.error=String(error?.message||error||'Não foi possível solicitar o link de acesso.');
    throw error;
  }finally{
    adminRuntime.actionPending=false;
    render();
  }
}

async function adminSignOut(){
  if(adminRuntime.client)await adminRuntime.client.auth.signOut().catch(()=>{});
  adminRuntime.session=null;
  adminRuntime.data=null;
  adminRuntime.searchQuery='';
  adminRuntime.searchResults=[];
  adminRuntime.searchPending=false;
  adminRuntime.detail=null;
  adminRuntime.detailPending=false;
  adminRuntime.health=null;
  adminRuntime.healthPending=false;
  adminRuntime.providerHealth=null;
  adminRuntime.providerHealthPending=false;
  adminRuntime.paymentPreflights={};
  try{sessionStorage.removeItem('tamao-admin-provider-health-v1')}catch{}
  adminRuntime.auditResults=null;
  adminRuntime.auditPending=false;
  adminRuntime.status='unauthenticated';
  adminRuntime.error=null;
  adminRuntime.notice=null;
  adminRuntime.bootstrapStatus=null;
  adminRuntime.bootstrapError=null;
  render();
}

async function adminRefresh({silent=false}={}){
  if(!adminRuntime.client)return null;
  const seq=++adminRuntime.refreshSeq;
  if(!silent)render();
  try{
    const data=await adminInvoke({action:'summary'});
    if(seq!==adminRuntime.refreshSeq)return data;
    adminRuntime.data=data;
    adminRuntime.status='ready';
    adminRuntime.error=null;
    adminRuntime.lastSyncAt=new Date().toISOString();
    queueMicrotask(()=>adminEnsureProviderHealth().catch(()=>{}));
    return data;
  }catch(error){
    if(seq!==adminRuntime.refreshSeq)return null;
    if(error?.code==='ADMIN_ACCESS_DENIED'||error?.status===403&&error?.code==='ADMIN_ACCESS_DENIED'){
      adminRuntime.status='no-access';
      adminRuntime.data=null;
      adminRuntime.error=null;
      return null;
    }
    if(error?.status===401){
      adminRuntime.status='unauthenticated';
      adminRuntime.session=null;
      adminRuntime.data=null;
      adminRuntime.searchQuery='';
      adminRuntime.searchResults=[];
      adminRuntime.detail=null;
      adminRuntime.health=null;
      adminRuntime.auditResults=null;
      adminRuntime.error='Sua sessão expirou. Entre novamente.';
      return null;
    }
    adminRuntime.status='unavailable';
    adminRuntime.error=String(error?.message||error);
    throw error;
  }finally{
    if(!silent)render();
  }
}

async function adminPerform(action,payload={}){
  if(adminRuntime.actionPending)return null;
  adminRuntime.actionPending=true;
  adminRuntime.error=null;
  render();
  try{
    const idempotencyKey=adminIdempotency('admin-'+action);
    const result=await globalThis.retryAmbiguousOnce(
      ()=>adminInvoke(
        {action,...payload},
        {idempotencyKey}
      )
    );
    await adminRefresh({silent:true});
    return result;
  }catch(error){
    adminRuntime.error=String(error?.message||error);
    try{await adminRefresh({silent:true})}catch{}
    throw error;
  }finally{
    adminRuntime.actionPending=false;
    render();
  }
}

async function adminPoll(){
  if(!adminReady()||adminRuntime.actionPending||adminRuntime.pollPending||document.visibilityState==='hidden')return;
  const now=Date.now();
  const fastSections=new Set(['overview','orders','finance','incidents']);
  const pollIntervalMs=fastSections.has(String(adminRuntime.section||''))?15000:60000;
  if(adminRuntime.lastPollAt&&now-adminRuntime.lastPollAt<pollIntervalMs)return;
  adminRuntime.lastPollAt=now;
  adminRuntime.pollPending=true;
  try{
    await adminRefresh({silent:true});
    render();
  }catch{
    render();
  }
  finally{adminRuntime.pollPending=false}
}

function openAdminPortal(){
  const href=globalThis.buildPortalHref?.(globalThis.CHAMA_ADMIN_ORIGIN,'admin');
  if(!href){
    toast('A administração ainda não possui uma origem dedicada configurada');
    return;
  }
  location.href=href;
}

function adminLoginFromUi(){
  const email=document.querySelector('#admin-email')?.value.trim()||'';
  adminSendLogin(email).catch(e=>toast(String(e?.message||e)));
}


async function adminRunSearch(query){
  const value=String(query||'').trim();
  if(value.length<2){
    adminRuntime.searchQuery='';
    adminRuntime.searchResults=[];
    render();
    return;
  }
  if(adminRuntime.searchPending)return;
  adminRuntime.searchPending=true;
  adminRuntime.searchQuery=value;
  render();
  try{
    const result=await adminInvoke({action:'search',query:value});
    adminRuntime.searchResults=Array.isArray(result?.results)?result.results:[];
  }catch(error){
    adminRuntime.searchResults=[];
    adminRuntime.error=String(error?.message||error||'Falha na busca administrativa');
  }finally{
    adminRuntime.searchPending=false;
    render();
  }
}
function adminSearchFromUi(){
  const input=document.getElementById('admin-global-search');
  return adminRunSearch(input?.value||'');
}
function adminClearSearch(){
  adminRuntime.searchQuery='';
  adminRuntime.searchResults=[];
  render();
}
function adminFocusSearch(){
  const input=document.getElementById('admin-global-search');
  if(!input)return;
  input.focus();
  input.select();
}
function adminBindKeyboardShortcuts(){
  if(globalThis.__tamaoAdminKeyboardBound)return;
  globalThis.__tamaoAdminKeyboardBound=true;
  document.addEventListener('keydown',event=>{
    if(!adminPortalRequested()||adminRuntime.status!=='ready')return;
    if((event.ctrlKey||event.metaKey)&&String(event.key).toLowerCase()==='k'){
      event.preventDefault();
      adminFocusSearch();
      return;
    }
    if(event.key==='Escape'&&adminRuntime.detail){
      event.preventDefault();
      adminCloseDetail();
    }
  });
}
adminBindKeyboardShortcuts();
function adminOpenSearchResult(type,id){
  if(['order','merchant','customer'].includes(String(type))){
    return adminOpenEntity(type,id);
  }
  adminRuntime.searchQuery='';
  adminRuntime.searchResults=[];
  adminSetSection('partners');
  toast('Registro localizado na área de parceiros e solicitações');
}
async function adminOpenEntity(entityType,entityId){
  if(adminRuntime.detailPending)return;
  adminRuntime.detailPending=true;
  adminRuntime.detail={loading:true,type:String(entityType),id:String(entityId)};
  render();
  try{
    adminRuntime.detail=await adminInvoke({action:'entity-detail',entityType,entityId});
  }catch(error){
    adminRuntime.detail={error:String(error?.message||error||'Não foi possível carregar os detalhes.'),type:String(entityType),id:String(entityId)};
  }finally{
    adminRuntime.detailPending=false;
    render();
  }
}
function adminCloseDetail(){
  adminRuntime.detail=null;
  render();
}
async function adminLoadSystemHealth({force=false}={}){
  if(adminRuntime.healthPending||(!force&&adminRuntime.health))return;
  adminRuntime.healthPending=true;
  render();
  try{
    adminRuntime.health=await adminInvoke({action:'system-health'});
  }catch(error){
    adminRuntime.health={status:'critical',error:String(error?.message||error||'Diagnóstico indisponível'),checkedAt:new Date().toISOString()};
  }finally{
    adminRuntime.healthPending=false;
    render();
  }
}

const ADMIN_PROVIDER_HEALTH_CACHE_MS=10*60*1000;
function adminProviderHealthFresh(){
  const checkedAt=Date.parse(adminRuntime.providerHealth?.checkedAt||'');
  return Number.isFinite(checkedAt)&&Date.now()-checkedAt<ADMIN_PROVIDER_HEALTH_CACHE_MS;
}
function adminCacheProviderHealth(health){
  adminRuntime.providerHealth=health||null;
  try{
    if(health){
      sessionStorage.setItem('tamao-admin-provider-health-v1',JSON.stringify({
        cachedAt:new Date().toISOString(),
        health
      }));
    }else{
      sessionStorage.removeItem('tamao-admin-provider-health-v1');
    }
  }catch{}
}
async function adminCheckBillingProviderHealth({silent=false,force=true}={}){
  if(adminRuntime.providerHealthPending)return adminRuntime.providerHealth;
  if(!force&&adminProviderHealthFresh())return adminRuntime.providerHealth;
  adminRuntime.providerHealthPending=true;
  if(!silent)render();
  try{
    const health=await adminInvoke({action:'billing-provider-health'});
    adminCacheProviderHealth(health);
    const provider=health?.provider==='mercadopago'?'Mercado Pago':health?.provider==='woovi'?'Woovi/OpenPix':'PSP ativo';
    if(!silent)toast(health?.ok?provider+' validado':provider+' exige atenção: '+String(health?.reason||health?.status||'indisponível'));
    return health;
  }catch(error){
    const health={
      ok:false,
      status:'unavailable',
      provider:null,
      reason:String(error?.message||error||'Diagnóstico do PSP indisponível'),
      checkedAt:new Date().toISOString()
    };
    adminCacheProviderHealth(health);
    return health;
  }finally{
    adminRuntime.providerHealthPending=false;
    render();
  }
}
async function adminEnsureProviderHealth(){
  if(!adminReady()||adminRuntime.providerHealthPending||adminProviderHealthFresh())return adminRuntime.providerHealth;
  const ingress=adminRuntime.data?.merchantBilling?.paymentIngress;
  if(!ingress?.livePspReady)return adminRuntime.providerHealth;
  return adminCheckBillingProviderHealth({silent:true,force:false});
}

function adminLatestBillingWebhookProbe(d=adminRuntime.data,provider='mercadopago'){
  const rows=Array.isArray(d?.merchantBilling?.webhookProbes)
    ?d.merchantBilling.webhookProbes:[];
  return rows
    .filter(x=>String(x.provider||'').toLowerCase()===String(provider||'').toLowerCase())
    .sort((a,b)=>Date.parse(b.requested_at||0)-Date.parse(a.requested_at||0))[0]||null;
}
function adminFreshVerifiedWebhookProbe(d=adminRuntime.data,provider='mercadopago'){
  const rows=Array.isArray(d?.merchantBilling?.webhookProbes)
    ?d.merchantBilling.webhookProbes:[];
  const cutoff=Date.now()-24*60*60*1000;
  return rows
    .filter(x=>
      String(x.provider||'').toLowerCase()===String(provider||'').toLowerCase()
      &&x.status==='verified'
      &&Date.parse(x.verified_at||0)>=cutoff
    )
    .sort((a,b)=>Date.parse(b.verified_at||0)-Date.parse(a.verified_at||0))[0]||null;
}
async function adminCopyText(value,label='Valor'){
  const text=String(value||'');
  if(!text)return toast('Nada para copiar');
  try{
    await navigator.clipboard.writeText(text);
    toast(label+' copiado');
  }catch{
    prompt('Copie este valor:',text);
  }
}
async function adminGenerateBillingWebhookProbe(){
  const ingress=adminRuntime.data?.merchantBilling?.paymentIngress||{};
  if(String(ingress.activeBillingProvider||'').toLowerCase()!=='mercadopago'){
    return toast('A prova remota desta versão está disponível para Mercado Pago.');
  }
  if(
    ingress.adapterReadiness?.mercadopago?.webhookSecretConfigured!==true
    ||ingress.liveEndpoints?.mercadopago==null
  ){
    return toast('Configure primeiro o webhook HMAC e o endpoint Mercado Pago.');
  }
  try{
    const result=await adminPerform('create-billing-webhook-probe',{provider:'mercadopago'});
    if(!result?.resourceId)return toast('Não foi possível gerar o ID de prova');
    try{await navigator.clipboard.writeText(result.resourceId)}catch{}
    toast('ID de prova criado e copiado. Nenhuma cobrança foi gerada.');
  }catch(e){toast(String(e?.message||e))}
}

async function adminRetryBillingProviderCancel(paymentRequestId){
  if(!paymentRequestId)return toast('Solicitação financeira inválida');
  if(!confirm('Repetir o cancelamento desta cobrança no PSP? A solicitação financeira continuará encerrada.'))return;
  try{
    const result=await adminPerform('merchant-billing-provider-cancel-retry',{paymentRequestId});
    const cancel=result?.providerCancellation||{};
    if(Number(cancel.failed||0)>0){
      toast('Cancelamento no PSP ainda falhou; a pendência continua registrada');
    }else if(Number(cancel.cancelled||0)>0){
      toast('Cobrança cancelada no PSP');
    }else{
      toast('Nenhum cancelamento de PSP está pendente para esta solicitação');
    }
  }catch(e){toast(String(e?.message||e))}
}
function adminSeverityLabel(level){
  return ({critical:'CRÍTICO',high:'ALTO',medium:'MÉDIO',low:'BAIXO'})[String(level)]||String(level||'INFO').toUpperCase();
}
function adminAttentionItems(d){
  const items=[];
  const push=(severity,title,detail,target={})=>items.push({severity,title,detail,...target});
  const readiness=d.launchReadiness||{};
  for(const code of readiness.securityBlockers||[]){
    push('critical','Bloqueio de segurança',adminSecurityBlockerLabel(code),{section:'overview'});
  }
  for(const o of d.controlOrders||[]){
    if(['AT_RISK','REASSIGNING','REQUOTE_REQUIRED'].includes(o.status)||adminOrderIsLate(o)){
      push('critical','Pedido exige intervenção',(o.public_code||o.id)+' • '+adminOrderStatusLabel(o.status),{type:'order',id:o.id});
    }
  }
  for(const x of d.rewardFailures||[]){
    if(x.dead_lettered_at)push('critical','Benefício em dead-letter','Pedido '+x.order_id,{section:'finance'});
  }
  for(const x of d.accountingFailures||[]){
    if(x.dead_lettered_at)push('critical','Settlement em dead-letter','Pedido '+x.order_id,{section:'finance'});
  }
  const now=Date.now();
  for(const x of d.finance?.receivables||[]){
    if(x.due_at&&Date.parse(x.due_at)<now)push('high','Taxa vencida',adminMerchantName(x.merchant_id)+' • '+adminMoney(x.platform_fee_cents),{section:'finance'});
  }
  for(const x of d.finance?.cashbackReimbursements||[]){
    if(x.due_at&&Date.parse(x.due_at)<now)push('high','Cashback vencido',adminMerchantName(x.merchant_id)+' • '+adminMoney(x.cashback_cents),{section:'finance'});
  }
  const billing=d.merchantBilling||{};
  for(const refund of billing.refunds||[]){
    if(refund.status==='review_required'){
      const linked=Boolean(refund.merchant_id&&refund.payment_request_id);
      push(linked?'critical':'high',
        linked?'Refund do PSP bloqueia revenda':'Refund do PSP sem vínculo',
        (linked?adminMerchantName(refund.merchant_id)+' • ':'')+adminMoney(refund.amount_cents)+' • '+adminBillingRefundReasonLabel(refund.match_reason),
        {section:'finance'});
    }
  }
  for(const statement of billing.statements||[]){
    if(statement.status==='overdue'){
      push('critical','Fechamento diário vencido',
        adminMerchantName(statement.merchant_id)+' • '+adminMoney(statement.amount_due_cents),
        {section:'finance'});
    }
  }
  for(const request of billing.paymentRequests||[]){
    if(request.status==='pending'){
      const age=now-Date.parse(request.requested_at||request.updated_at||new Date().toISOString());
      if(age>24*60*60*1000){
        push('high','Pagamento aguardando conferência há +24h',
          adminMerchantName(request.merchant_id)+' • '+adminMoney(request.expected_amount_cents),
          {section:'finance'});
      }
    }
  }
  for(const event of billing.paymentEvents||[]){
    if(event.status==='review_required'){
      push('high','Evento financeiro exige revisão',
        String(event.provider||'PSP')+' • '+adminMoney(event.amount_cents)+' • '+adminBillingPaymentMatchReasonLabel(event.match_reason),
        {section:'finance'});
    }
  }
  for(const account of billing.accounts||[]){
    if(account.sales_hold){
      push('critical','Revenda em hold financeiro',
        adminMerchantName(account.merchant_id)+' • '+String(account.sales_hold_reason||'débito financeiro'),
        {section:'finance'});
    }
  }
  for(const attempt of d.merchantPayments?.attempts||[]){
    if(attempt.pilot_guard!==true)continue;
    const status=String(attempt.status||'');
    if(status==='review_required'){
      push('critical','Pagamento automático exige revisão',
        adminMerchantName(attempt.merchant_id)+' • '+adminBillingProviderName(attempt.provider)+' • '+adminMerchantPilotIssueLabel(attempt.last_error_code),
        attempt.order_id?{type:'order',id:attempt.order_id}:{section:'finance'});
      continue;
    }
    if(['preparing','checkout_ready','pending','approved'].includes(status)){
      const age=now-Date.parse(attempt.created_at||attempt.updated_at||new Date().toISOString());
      if(age>2*60*60*1000){
        push('high','Validação de pagamento aberta há +2h',
          adminMerchantName(attempt.merchant_id)+' • '+adminBillingProviderName(attempt.provider)+' • '+status.toUpperCase(),
          attempt.order_id?{type:'order',id:attempt.order_id}:{section:'finance'});
      }
    }
  }
  for(const x of d.supportCases||[]){
    if(['open','in_review'].includes(x.status)){
      const age=now-Date.parse(x.created_at||x.updated_at||new Date().toISOString());
      push(age>60*60*1000?'high':'medium','Atendimento '+(age>60*60*1000?'acima de 1h':'aberto'),String(x.category||'Suporte')+' • pedido '+String(x.order_id||'—'),x.order_id?{type:'order',id:x.order_id}:{section:'orders'});
    }
  }
  for(const m of d.merchants||[]){
    if(m.status!=='active')continue;
    const heartbeat=Date.parse(m.last_seen_at||'');
    if(!Number.isFinite(heartbeat)||now-heartbeat>15*60*1000){
      push('high','Revenda sem heartbeat',m.name+' • última atividade '+(m.last_seen_at?formatDateTime(m.last_seen_at):'nunca'),{type:'merchant',id:m.id});
    }
    const price=Date.parse(m.price_confirmed_at||'');
    if(!Number.isFinite(price)||now-price>24*60*60*1000){
      push('medium','Preço precisa reconfirmação',m.name+' • preço '+(m.price_confirmed_at?formatDateTime(m.price_confirmed_at):'nunca confirmado'),{type:'merchant',id:m.id});
    }
  }
  for(const a of d.applications||[]){
    if(a.status==='pending'&&now-Date.parse(a.created_at||'')>24*60*60*1000){
      push('medium','Cadastro aguardando análise',a.company_name+' • há mais de 24h',{section:'partners'});
    }
  }
  for(const warning of readiness.warningDetails||[]){
    if(!warning.confirmed)push('medium','Pendência de produção',adminProductionRequirementLabel(warning.key),{section:'overview'});
  }
  const rank={critical:0,high:1,medium:2,low:3};
  return items.sort((a,b)=>(rank[a.severity]??9)-(rank[b.severity]??9)).slice(0,20);
}
function adminAttentionCenter(d){
  const items=adminAttentionItems(d);
  const critical=items.filter(x=>x.severity==='critical').length;
  const high=items.filter(x=>x.severity==='high').length;
  const medium=items.filter(x=>x.severity==='medium').length;
  const action=(x)=>{
    if(x.type&&x.id)return "adminOpenEntity('"+String(x.type).replace(/'/g,'')+"','"+String(x.id).replace(/'/g,'')+"')";
    return "adminSetSection('"+String(x.section||'overview').replace(/'/g,'')+"')";
  };
  return `<section class="section admin-attention">
    <div class="admin-command-card">
      <div class="admin-command-head">
        <div><span class="section-kicker">ATENÇÃO AGORA</span><h2>Decisões prioritárias</h2><p>Exceções operacionais, financeiras e de segurança ordenadas para você agir primeiro no que realmente importa.</p></div>
        <div class="admin-severity-summary">
          <span class="admin-severity-chip critical"><b>${critical}</b> crítico</span>
          <span class="admin-severity-chip high"><b>${high}</b> alto</span>
          <span class="admin-severity-chip medium"><b>${medium}</b> médio</span>
        </div>
      </div>
      ${items.length?`<div class="admin-attention-list">${items.map((x,index)=>`<button type="button" class="admin-attention-item ${esc(x.severity)}" onclick="${action(x)}"><span class="admin-attention-rank">${String(index+1).padStart(2,'0')}</span><span class="admin-attention-severity">${esc(adminSeverityLabel(x.severity))}</span><span class="admin-attention-copy"><strong>${esc(x.title)}</strong><small>${esc(x.detail)}</small></span><span class="admin-attention-arrow" aria-hidden="true">→</span></button>`).join('')}</div>`:'<div class="admin-all-clear"><span aria-hidden="true">✓</span><div><strong>Nenhuma intervenção prioritária agora.</strong><small>Filas críticas, pedidos em risco e sinais operacionais estão limpos.</small></div></div>'}
    </div>
  </section>`;
}
function adminRecentCustomers(d){
  const map=new Map();
  for(const o of d.controlOrders||[]){
    if(!o.customer_id)continue;
    const current=map.get(o.customer_id)||{id:o.customer_id,phone:o.customer_phone_digits||'',orders:0,totalCents:0,lastAt:null,lastOrder:null};
    current.orders++;
    current.totalCents+=Number(o.total_cents||0);
    if(!current.lastAt||Date.parse(o.updated_at)>Date.parse(current.lastAt)){
      current.lastAt=o.updated_at;
      current.lastOrder=o.public_code||o.id;
      current.phone=o.customer_phone_digits||current.phone;
    }
    map.set(o.customer_id,current);
  }
  return [...map.values()].sort((a,b)=>Date.parse(b.lastAt||0)-Date.parse(a.lastAt||0));
}
function adminCustomersSection(d){
  const customers=adminRecentCustomers(d);
  return `<section class="section">
    <div class="section-head"><div><span class="section-kicker">CLIENTES 360°</span><h2>Clientes recentes</h2><p>Visão operacional agregada a partir dos pedidos recentes. Abra o 360° para histórico, suporte, gastos e feedback.</p></div><span class="status-pill online">${customers.length} recente(s)</span></div>
    ${customers.length?`<div class="admin-entity-grid">${customers.map(x=>`<button type="button" class="card flat admin-entity-card" onclick="adminOpenEntity('customer','${esc(x.id)}')"><div><strong>${esc(x.phone||'Cliente')}</strong><small>${esc(x.lastOrder||'Sem pedido')} • ${x.orders} pedido(s)</small></div><div><strong>${adminMoney(x.totalCents)}</strong><small>volume recente</small></div></button>`).join('')}</div>`:'<div class="empty card">Ainda não há clientes com pedidos reais.</div>'}
  </section>`;
}
function adminGlobalSearchView(){
  const results=adminRuntime.searchResults||[];
  const searched=adminRuntime.searchQuery;
  return `<div class="admin-global-search">
    <div class="admin-search-input-wrap">
      <span class="admin-search-icon" aria-hidden="true">${adminNavIcon('audit')}</span>
      <input id="admin-global-search" class="input" maxlength="120" autocomplete="off" placeholder="Buscar pedido, telefone, CNPJ, revenda ou cliente…" value="${esc(searched||'')}" onkeydown="if(event.key==='Enter'){event.preventDefault();adminSearchFromUi()}">
      <kbd class="admin-search-shortcut">Ctrl K</kbd>
      <button class="secondary small admin-search-submit" type="button" onclick="adminSearchFromUi()" ${adminRuntime.searchPending?'disabled aria-busy="true"':''}>${adminRuntime.searchPending?'Buscando…':'Buscar'}</button>
      ${searched?'<button class="ghost small admin-search-clear" type="button" onclick="adminClearSearch()">Limpar</button>':''}
    </div>
    ${searched?`<div class="admin-search-results">
      <div class="tiny muted">${adminRuntime.searchPending?'Consultando control plane…':results.length+' resultado(s) para “'+esc(searched)+'”'}</div>
      ${!adminRuntime.searchPending&&results.length?results.map(x=>`<button type="button" class="admin-search-result" onclick="adminOpenSearchResult('${esc(x.type)}','${esc(x.id)}')"><span class="status-pill">${esc(String(x.type||'').toUpperCase())}</span><span><strong>${esc(x.title||x.id)}</strong><small>${esc(x.subtitle||'')}</small></span><span aria-hidden="true">›</span></button>`).join(''):!adminRuntime.searchPending?'<div class="empty">Nenhum registro encontrado.</div>':''}
    </div>`:''}
  </div>`;
}
function adminTimeline(events=[]){
  const clean=events.filter(x=>x?.at).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  return clean.length?`<div class="admin-timeline">${clean.map(x=>`<div class="admin-timeline-row"><span></span><div><strong>${esc(x.label)}</strong><small>${esc(formatDateTime(x.at))}${x.detail?' • '+esc(x.detail):''}</small></div></div>`).join('')}</div>`:'<div class="tiny muted">Sem eventos cronológicos.</div>';
}
function adminDetailView(){
  const d=adminRuntime.detail;
  if(!d)return '';
  if(d.loading)return '<div class="admin-drawer-backdrop" onclick="adminCloseDetail()"><aside class="admin-drawer" onclick="event.stopPropagation()"><div class="empty card">Carregando visão 360°…</div></aside></div>';
  if(d.error)return `<div class="admin-drawer-backdrop" onclick="adminCloseDetail()"><aside class="admin-drawer" onclick="event.stopPropagation()"><div class="admin-drawer-head"><h2>Detalhes</h2><button class="ghost small" onclick="adminCloseDetail()">Fechar</button></div><div class="notice danger">${esc(d.error)}</div></aside></div>`;

  let content='';
  if(d.type==='order'){
    const o=d.order||{};
    const timeline=[
      {label:'Pedido criado',at:o.created_at},
      {label:'Revenda aceitou',at:o.accepted_at},
      {label:'Saiu para entrega',at:o.dispatched_at},
      {label:'Chegando',at:o.arriving_at},
      {label:'Entregue',at:o.delivered_at},
      {label:'Liquidado',at:o.settled_at}
    ];
    content=`<div class="admin-drawer-head"><div><span class="section-kicker">PEDIDO 360°</span><h2>${esc(o.public_code||o.id)}</h2></div><button class="ghost small" onclick="adminCloseDetail()">Fechar</button></div>
      <div class="merchant-kpis">
        <div class="kpi"><span class="label">Status</span><strong>${esc(adminOrderStatusLabel(o.status))}</strong></div>
        <div class="kpi"><span class="label">Total</span><strong>${adminMoney(o.total_cents)}</strong></div>
        <div class="kpi"><span class="label">Pagamento</span><strong>${esc(o.payment_method||'—')}</strong></div>
        <div class="kpi"><span class="label">Financeiro</span><strong>${esc(o.financial_state||'—')}</strong></div>
      </div>
      <div class="order-actions" style="margin:12px 0">
        ${o.customer_id?`<button class="secondary small" onclick="adminOpenEntity('customer','${esc(o.customer_id)}')">Cliente 360°</button>`:''}
        ${o.merchant_id?`<button class="secondary small" onclick="adminOpenEntity('merchant','${esc(o.merchant_id)}')">Revenda 360°</button>`:''}
      </div>
      <section class="section"><h3>Timeline</h3>${adminTimeline(timeline)}</section>
      <section class="section"><h3>Itens</h3><div class="list">${(d.items||[]).map(x=>`<div class="list-row"><div><strong>${esc(x.product_name)}</strong><br><small>${Number(x.quantity)} × ${adminMoney(x.unit_price_cents)}</small></div><strong>${adminMoney(x.line_total_cents)}</strong></div>`).join('')||'<div class="tiny muted">Sem itens.</div>'}</div></section>
      <section class="section"><h3>Entrega</h3><div class="card flat"><div class="order-line"><strong>Telefone:</strong> ${esc(o.customer_phone_digits||'—')}</div><div class="order-line"><strong>CEP:</strong> ${esc(o.postal_code||'—')}</div><div class="order-line"><strong>Endereço:</strong> ${esc(o.address_text||'dados minimizados')}</div>${o.delivery_reference?`<div class="order-line"><strong>Referência:</strong> ${esc(o.delivery_reference)}</div>`:''}</div></section>
      <section class="section"><h3>Suporte e financeiro</h3><div class="merchant-kpis"><div class="kpi"><span class="label">Atendimentos</span><strong>${(d.support||[]).length}</strong></div><div class="kpi"><span class="label">Taxa plataforma</span><strong>${adminMoney(d.finance?.receivable?.platform_fee_cents)}</strong></div><div class="kpi"><span class="label">Cashback</span><strong>${adminMoney(d.finance?.reimbursement?.cashback_cents)}</strong></div><div class="kpi"><span class="label">Ajustes</span><strong>${(d.finance?.adjustments||[]).length}</strong></div></div></section>
      <section class="section"><h3>Auditoria</h3><div class="list">${(d.audit||[]).map(x=>`<div class="list-row"><div><strong>${esc(x.action)}</strong><br><small>${esc(x.target_type)}</small></div><small>${esc(formatDateTime(x.created_at))}</small></div>`).join('')||'<div class="tiny muted">Sem ações administrativas.</div>'}</div></section>`;
  }else if(d.type==='merchant'){
    const m=d.merchant||{};
    const metrics=d.metrics||{};
    content=`<div class="admin-drawer-head"><div><span class="section-kicker">REVENDA 360°</span><h2>${esc(m.name||m.id)}</h2></div><button class="ghost small" onclick="adminCloseDetail()">Fechar</button></div>
      <div class="merchant-kpis">
        <div class="kpi"><span class="label">Status</span><strong>${esc(m.status||'—')}</strong></div>
        <div class="kpi"><span class="label">Trust</span><strong>${Number(m.trust_score||0)}/100</strong></div>
        <div class="kpi"><span class="label">Pedidos</span><strong>${Number(metrics.orders||0)}</strong></div>
        <div class="kpi"><span class="label">Cancelamento</span><strong>${metrics.cancellationRate==null?'—':Math.round(metrics.cancellationRate*100)+'%'}</strong></div>
      </div>
      <section class="section"><h3>Operação</h3><div class="card flat"><div class="order-line"><strong>Online:</strong> ${m.online?'sim':'não'} • <strong>Heartbeat:</strong> ${m.last_seen_at?esc(formatDateTime(m.last_seen_at)):'nunca'}</div><div class="order-line"><strong>Preço confirmado:</strong> ${m.price_confirmed_at?esc(formatDateTime(m.price_confirmed_at)):'nunca'}</div><div class="order-line"><strong>CNPJ:</strong> ${esc(m.cnpj||'—')}</div>${d.business?`<div class="order-line"><strong>Responsável:</strong> ${esc(d.business.responsible_name||'—')} • ${esc(d.business.whatsapp||'')}</div>`:''}</div></section>
      <section class="section"><h3>Compliance e capacidade</h3><div class="merchant-kpis"><div class="kpi"><span class="label">CNPJ</span><strong>${esc(d.compliance?.cnpj_status||'—')}</strong></div><div class="kpi"><span class="label">ANP</span><strong>${esc(d.compliance?.anp_status||'—')}</strong></div><div class="kpi"><span class="label">Pagamentos</span><strong>${(d.payments||[]).filter(x=>x.active).length}</strong></div><div class="kpi"><span class="label">Equipe</span><strong>${(d.members||[]).filter(x=>x.active).length}</strong></div></div></section>
      <section class="section"><h3>Catálogo</h3><div class="list">${(d.catalog||[]).map(x=>`<div class="list-row"><div><strong>${esc(x.product_name)}</strong><br><small>${x.available_stock} em estoque • ${x.active?'ativo':'pausado'}</small></div><strong>${adminMoney(x.price_cents)}</strong></div>`).join('')||'<div class="tiny muted">Catálogo vazio.</div>'}</div></section>
      <section class="section"><h3>Pedidos recentes</h3><div class="list">${(d.orders||[]).slice(0,20).map(x=>`<button class="list-row admin-row-button" onclick="adminOpenEntity('order','${esc(x.id)}')"><div><strong>${esc(x.public_code)}</strong><br><small>${esc(adminOrderStatusLabel(x.status))}</small></div><strong>${adminMoney(x.total_cents)}</strong></button>`).join('')||'<div class="tiny muted">Sem pedidos.</div>'}</div></section>
      <section class="section"><h3>Financeiro e suporte</h3><div class="merchant-kpis"><div class="kpi"><span class="label">Atendimentos</span><strong>${(d.support||[]).length}</strong></div><div class="kpi"><span class="label">Recebíveis</span><strong>${(d.finance?.receivables||[]).filter(x=>x.status==='open').length}</strong></div><div class="kpi"><span class="label">Cashback</span><strong>${(d.finance?.reimbursements||[]).filter(x=>x.status==='open').length}</strong></div><div class="kpi"><span class="label">Ajustes</span><strong>${(d.finance?.adjustments||[]).filter(x=>x.status==='open').length}</strong></div></div></section>`;
  }else if(d.type==='customer'){
    const m=d.metrics||{};
    const latest=(d.orders||[])[0]||{};
    content=`<div class="admin-drawer-head"><div><span class="section-kicker">CLIENTE 360°</span><h2>${esc(latest.customer_phone_digits||'Cliente')}</h2><small class="muted">${esc(d.id)}</small></div><button class="ghost small" onclick="adminCloseDetail()">Fechar</button></div>
      <div class="merchant-kpis">
        <div class="kpi"><span class="label">Pedidos</span><strong>${Number(m.orders||0)}</strong></div>
        <div class="kpi"><span class="label">Liquidados</span><strong>${Number(m.settled||0)}</strong></div>
        <div class="kpi"><span class="label">Volume</span><strong>${adminMoney(m.spendCents)}</strong></div>
        <div class="kpi"><span class="label">Cashback</span><strong>${adminMoney(m.cashbackCents)}</strong></div>
      </div>
      <section class="section"><h3>Conta</h3><div class="card flat"><div class="order-line"><strong>Código de indicação:</strong> ${esc(d.profile?.referral_code||'—')}</div><div class="order-line"><strong>Desde:</strong> ${d.profile?.created_at?esc(formatDateTime(d.profile.created_at)):'—'}</div><div class="order-line"><strong>Atendimentos:</strong> ${(d.support||[]).length} • <strong>Feedbacks:</strong> ${(d.feedback||[]).length}</div></div></section>
      <section class="section"><h3>Histórico de pedidos</h3><div class="list">${(d.orders||[]).map(x=>`<button class="list-row admin-row-button" onclick="adminOpenEntity('order','${esc(x.id)}')"><div><strong>${esc(x.public_code)}</strong><br><small>${esc(adminOrderStatusLabel(x.status))} • ${esc(x.supplier_name_snapshot||'sem revenda')}</small></div><strong>${adminMoney(x.total_cents)}</strong></button>`).join('')||'<div class="tiny muted">Sem pedidos.</div>'}</div></section>
      <section class="section"><h3>Feedback</h3><div class="list">${(d.feedback||[]).map(x=>`<div class="list-row"><div><strong>${Number(x.rating||0)}/5</strong><br><small>${esc((x.tags||[]).join(' • ')||x.note||'Sem observação')}</small></div><small>${esc(formatDateTime(x.created_at))}</small></div>`).join('')||'<div class="tiny muted">Sem feedback.</div>'}</div></section>`;
  }
  return `<div class="admin-drawer-backdrop" onclick="adminCloseDetail()"><aside class="admin-drawer" onclick="event.stopPropagation()">${content}</aside></div>`;
}
function adminSystemHealthView(){
  const h=adminRuntime.health;
  if(adminRuntime.healthPending&&!h)return '<section class="section"><div class="empty card">Executando diagnóstico do control plane…</div></section>';
  if(!h)return '<section class="section"><div class="section-head"><div><span class="section-kicker">SAÚDE DO SISTEMA</span><h2>Diagnóstico operacional</h2><p>Portais, banco, Edge Function e filas críticas em uma única verificação.</p></div><button class="secondary small" onclick="adminLoadSystemHealth({force:true})">Executar diagnóstico</button></div></section>';
  const status=String(h.status||'critical');
  const cls=status==='healthy'?'online':status==='degraded'?'risk':'offline';
  const portals=h.portals?.probes||[];
  const providerName=adminBillingProviderName(h.paymentProvider?.provider);
  const credentialLabel=adminBillingProviderCredentialLabel(h.paymentProvider?.provider);
  const e2e=adminBillingE2EState();
  return `<section class="section">
    <div class="section-head"><div><span class="section-kicker">SAÚDE DO SISTEMA</span><h2>Control plane ${status==='healthy'?'saudável':status==='degraded'?'degradado':'crítico'}</h2><p>Última checagem: ${esc(formatDateTime(h.checkedAt))} • ${Number(h.latencyMs||0)} ms</p></div><div class="order-actions"><span class="status-pill ${cls}">${esc(status.toUpperCase())}</span><button class="secondary small" onclick="adminLoadSystemHealth({force:true})">Atualizar</button></div></div>
    ${h.error?`<div class="notice danger">${esc(h.error)}</div>`:''}
    <div class="merchant-kpis">
      <div class="kpi"><span class="label">Edge admin-ops</span><strong>${h.edge?.ok?'OK':'FALHA'}</strong></div>
      <div class="kpi"><span class="label">Banco</span><strong>${h.database?.ok?'OK':'FALHA'}</strong><small>${esc(h.database?.operationMode||'—')}</small></div>
      <div class="kpi"><span class="label">Portais</span><strong>${h.portals?.ok?'3/3':'ATENÇÃO'}</strong><small>${esc(h.portals?.sourceSha?.slice(0,8)||'SHA divergente')}</small></div>
      <div class="kpi"><span class="label">${esc(providerName)}</span><strong>${h.paymentProvider?.ok?'API OK':String(h.paymentProvider?.status||'PENDENTE').toUpperCase()}</strong><small>${h.paymentProvider?.credentialValid===true?esc(credentialLabel)+' válido':h.paymentProvider?.credentialValid===false?esc(credentialLabel)+' rejeitado':'sem prova de API'}</small></div>
      <div class="kpi"><span class="label">PSP transacional</span><strong>${e2e.validated?'VALIDADO':'PENDENTE'}</strong><small>${e2e.validated?'transação verificada e conciliada':'aguarda primeira transação verificada'}</small></div>
      <div class="kpi"><span class="label">Suporte aberto</span><strong>${Number(h.queues?.openSupport||0)}</strong></div>
      <div class="kpi"><span class="label">Reward failures</span><strong>${Number(h.queues?.rewardFailures||0)}</strong></div>
      <div class="kpi"><span class="label">Accounting failures</span><strong>${Number(h.queues?.accountingFailures||0)}</strong></div>
      <div class="kpi"><span class="label">Heartbeat vencido</span><strong>${Number(h.queues?.staleMerchantHeartbeat||0)}</strong></div>
      <div class="kpi"><span class="label">Preço vencido</span><strong>${Number(h.queues?.staleMerchantPrice||0)}</strong></div>
    </div>
    ${h.paymentProvider?.ok===false?`<div class="notice" style="margin-bottom:12px"><strong>Cobrança automática degradada.</strong><br>A falha do PSP aparece no diagnóstico, mas o TAMÃO não bloqueia vendas automaticamente: o Financeiro mantém a conferência manual como contingência. Motivo: ${esc(h.paymentProvider?.reason||h.paymentProvider?.status||'indisponível')}.</div>`:''}
    <div class="admin-health-portals">${portals.map(p=>`<div class="card flat"><div class="order-head"><strong>${esc(String(p.role||'').toUpperCase())}</strong><span class="status-pill ${p.ok?'online':'offline'}">${p.ok?'OK':'FALHA'}</span></div><small>${esc(p.origin||'')}</small><div class="tiny muted">${esc(p.sourceSha?.slice(0,12)||p.error||'sem SHA')}</div></div>`).join('')}</div>
  </section>`;
}


function adminRoleLabel(role){
  return ({
    superadmin:'Superadmin',
    operations:'Operações',
    finance:'Financeiro',
    support:'Suporte',
    compliance:'Compliance',
    readonly:'Somente leitura'
  })[String(role||'')]||String(role||'—');
}
function adminRoleOptions(selected){
  return ['superadmin','operations','finance','support','compliance','readonly']
    .map(role=>`<option value="${role}" ${role===selected?'selected':''}>${esc(adminRoleLabel(role))}</option>`)
    .join('');
}
function adminCurrentRole(){
  return String(adminRuntime.data?.currentAdmin?.admin_role||'superadmin');
}
function adminIncidentSeverityLabel(value){
  return ({critical:'CRÍTICO',high:'ALTO',medium:'MÉDIO',low:'BAIXO'})[String(value||'')]||String(value||'—').toUpperCase();
}
function adminIncidentStatusLabel(value){
  return ({
    open:'ABERTO',
    investigating:'INVESTIGANDO',
    monitoring:'MONITORANDO',
    resolved:'RESOLVIDO'
  })[String(value||'')]||String(value||'—').toUpperCase();
}
async function adminCreateIncident(){
  const title=document.getElementById('admin-incident-title')?.value.trim()||'';
  const severity=document.getElementById('admin-incident-severity')?.value||'medium';
  const description=document.getElementById('admin-incident-description')?.value.trim()||'';
  const entityType=document.getElementById('admin-incident-entity-type')?.value.trim()||'';
  const entityId=document.getElementById('admin-incident-entity-id')?.value.trim()||'';
  if(title.length<3)return toast('Informe um título para o incidente');
  try{
    await adminPerform('incident-action',{
      incidentAction:'create',title,severity,description,
      source:'admin-panel',entityType:entityType||null,entityId:entityId||null
    });
    toast('Incidente criado');
  }catch(e){toast(String(e?.message||e))}
}
async function adminIncidentAction(incidentId,incidentAction){
  const payload={incidentId,incidentAction};
  if(incidentAction==='resolve'){
    const note=prompt('Descreva como o incidente foi resolvido:')||'';
    if(note.trim().length<3)return toast('Informe a resolução');
    payload.resolutionNote=note;
  }
  if(incidentAction==='set-status'){
    const status=prompt('Novo status: investigating ou monitoring')||'';
    if(!['investigating','monitoring'].includes(status.trim().toLowerCase()))return toast('Status inválido');
    payload.incidentStatus=status.trim().toLowerCase();
  }
  if(incidentAction==='assign'){
    const select=document.getElementById('incident-assignee-'+incidentId);
    payload.assignedAdminId=select?.value||null;
  }
  try{
    await adminPerform('incident-action',payload);
    toast('Incidente atualizado');
  }catch(e){toast(String(e?.message||e))}
}
function adminIncidentCard(item,admins){
  const activeAdmins=(admins||[]).filter(x=>x.active);
  const severityClass=item.severity==='critical'?'offline':item.severity==='high'?'risk':'online';
  const resolved=item.status==='resolved';
  const readOnly=adminCurrentRole()==='readonly';
  const assignee=activeAdmins.find(x=>x.user_id===item.assigned_admin_id);
  return `<article class="card admin-incident-card">
    <div class="order-head">
      <div><span class="status-pill ${severityClass}">${esc(adminIncidentSeverityLabel(item.severity))}</span><h3 style="margin:8px 0 2px">${esc(item.title)}</h3><small class="muted">${esc(item.source||'admin')} • ${esc(formatDateTime(item.updated_at))}</small></div>
      <span class="status-pill ${resolved?'online':'risk'}">${esc(adminIncidentStatusLabel(item.status))}</span>
    </div>
    ${item.description?`<p class="muted">${esc(item.description)}</p>`:''}
    ${item.entity_type?`<div class="tiny muted">Entidade: ${esc(item.entity_type)} • ${esc(item.entity_id||'—')}</div>`:''}
    ${readOnly
      ? `<div class="tiny muted" style="margin-top:10px">Responsável: ${esc(assignee?adminRoleLabel(assignee.admin_role)+' • '+assignee.user_id.slice(0,8):'não atribuído')}</div>`
      : `<div class="input-wrap" style="margin-top:10px">
          <label for="incident-assignee-${esc(item.id)}">Responsável</label>
          <select id="incident-assignee-${esc(item.id)}" class="input">
            <option value="">Sem responsável</option>
            ${activeAdmins.map(a=>`<option value="${esc(a.user_id)}" ${item.assigned_admin_id===a.user_id?'selected':''}>${esc(adminRoleLabel(a.admin_role))} • ${esc(a.user_id.slice(0,8))}</option>`).join('')}
          </select>
        </div>
        <div class="order-actions" style="margin-top:10px">
          <button class="secondary small" onclick="adminIncidentAction('${esc(item.id)}','assign')">Atribuir</button>
          ${!item.acknowledged_at?`<button class="secondary small" onclick="adminIncidentAction('${esc(item.id)}','acknowledge')">Reconhecer</button>`:''}
          ${!resolved?`<button class="secondary small" onclick="adminIncidentAction('${esc(item.id)}','set-status')">Alterar status</button><button class="primary small" onclick="adminIncidentAction('${esc(item.id)}','resolve')">Resolver</button>`:`<button class="secondary small" onclick="adminIncidentAction('${esc(item.id)}','reopen')">Reabrir</button>`}
        </div>`}
    ${item.resolution_note?`<div class="notice success" style="margin-top:10px"><strong>Resolução</strong><br>${esc(item.resolution_note)}</div>`:''}
  </article>`;
}
function adminIncidentDuration(ms){
  if(!Number.isFinite(ms)||ms<0)return '—';
  const minutes=Math.round(ms/60000);
  if(minutes<60)return minutes+' min';
  const hours=minutes/60;
  if(hours<48)return hours.toLocaleString('pt-BR',{maximumFractionDigits:1})+' h';
  return (hours/24).toLocaleString('pt-BR',{maximumFractionDigits:1})+' d';
}
function adminIncidentMedian(values){
  const clean=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!clean.length)return null;
  const mid=Math.floor(clean.length/2);
  return clean.length%2?clean[mid]:(clean[mid-1]+clean[mid])/2;
}
function adminIncidentCenter(d){
  const incidents=d.incidents||[];
  const open=incidents.filter(x=>x.status!=='resolved');
  const resolved=incidents.filter(x=>x.status==='resolved');
  const criticalOpen=open.filter(x=>x.severity==='critical').length;
  const highOpen=open.filter(x=>x.severity==='high').length;
  const mtta=adminIncidentMedian(incidents.map(x=>x.acknowledged_at?Date.parse(x.acknowledged_at)-Date.parse(x.created_at):NaN));
  const mttr=adminIncidentMedian(resolved.map(x=>x.resolved_at?Date.parse(x.resolved_at)-Date.parse(x.created_at):NaN));
  const readOnly=adminCurrentRole()==='readonly';
  return `<section class="section">
    <div class="section-head"><div><span class="section-kicker">INCIDENTES</span><h2>Central de Incidentes</h2><p>Eventos críticos ganham responsável, severidade, status, MTTA/MTTR e resolução auditável.</p></div><span class="status-pill ${open.length?'risk':'online'}">${open.length} aberto(s)</span></div>
    <div class="merchant-kpis" style="margin-bottom:12px">
      <div class="kpi"><span class="label">Críticos abertos</span><strong>${criticalOpen}</strong></div>
      <div class="kpi"><span class="label">Altos abertos</span><strong>${highOpen}</strong></div>
      <div class="kpi"><span class="label">MTTA mediano</span><strong>${adminIncidentDuration(mtta)}</strong><small>criação → reconhecimento</small></div>
      <div class="kpi"><span class="label">MTTR mediano</span><strong>${adminIncidentDuration(mttr)}</strong><small>criação → resolução</small></div>
    </div>
    ${readOnly
      ? '<div class="notice">Perfil Somente leitura: incidentes podem ser consultados, mas não alterados.</div>'
      : `<div class="card flat form-stack">
          <h3>Novo incidente</h3>
          <div class="input-wrap"><label for="admin-incident-title">Título</label><input id="admin-incident-title" class="input" maxlength="160" placeholder="Ex.: falha no recebimento de pedidos"></div>
          <div class="input-wrap"><label for="admin-incident-severity">Severidade</label><select id="admin-incident-severity" class="input"><option value="critical">Crítico</option><option value="high">Alto</option><option value="medium" selected>Médio</option><option value="low">Baixo</option></select></div>
          <div class="input-wrap"><label for="admin-incident-description">Descrição</label><textarea id="admin-incident-description" class="input" maxlength="4000" rows="3" placeholder="Impacto, sintomas e contexto"></textarea></div>
          <div class="grid-2">
            <div class="input-wrap"><label for="admin-incident-entity-type">Tipo relacionado</label><input id="admin-incident-entity-type" class="input" maxlength="80" placeholder="order, merchant, system…"></div>
            <div class="input-wrap"><label for="admin-incident-entity-id">ID relacionado</label><input id="admin-incident-entity-id" class="input" maxlength="160" placeholder="Código/UUID opcional"></div>
          </div>
          <button class="primary" onclick="adminCreateIncident()">Criar incidente</button>
        </div>`}
    <div class="admin-incident-grid" style="margin-top:12px">
      ${open.length?open.map(x=>adminIncidentCard(x,d.platformAdmins||[])).join(''):'<div class="notice success"><strong>Nenhum incidente aberto.</strong></div>'}
    </div>
    ${resolved.length?`<details class="card flat" style="margin-top:12px"><summary><strong>Resolvidos (${resolved.length})</strong></summary><div class="admin-incident-grid" style="margin-top:10px">${resolved.slice(0,30).map(x=>adminIncidentCard(x,d.platformAdmins||[])).join('')}</div></details>`:''}
  </section>`;
}
async function adminAuditSearch(){
  if(adminRuntime.auditPending)return;
  const query=document.getElementById('admin-audit-query')?.value.trim()||'';
  const action=document.getElementById('admin-audit-action')?.value.trim()||'';
  const targetType=document.getElementById('admin-audit-target')?.value.trim()||'';
  const from=document.getElementById('admin-audit-from')?.value||'';
  const to=document.getElementById('admin-audit-to')?.value||'';
  adminRuntime.auditPending=true;
  render();
  try{
    const result=await adminInvoke({action:'audit-search',query,action:action||null,targetType:targetType||null,from:from||null,to:to||null,limit:200});
    adminRuntime.auditResults=result?.results||[];
  }catch(e){
    adminRuntime.error=String(e?.message||e);
  }finally{
    adminRuntime.auditPending=false;
    render();
  }
}
function adminAuditView(d){
  const rows=adminRuntime.auditResults??d.recentAudit??[];
  return `<section class="section">
    <div class="section-head"><div><span class="section-kicker">AUDITORIA</span><h2>Investigação administrativa</h2><p>Pesquise ações por texto, ação, tipo de alvo e período.</p></div><span class="status-pill online">${rows.length} registro(s)</span></div>
    <div class="card flat">
      <div class="grid-2">
        <div class="input-wrap"><label for="admin-audit-query">Busca livre</label><input id="admin-audit-query" class="input" placeholder="ator, alvo, metadata…"></div>
        <div class="input-wrap"><label for="admin-audit-action">Ação exata</label><input id="admin-audit-action" class="input" placeholder="merchant_activated"></div>
        <div class="input-wrap"><label for="admin-audit-target">Tipo de alvo</label><input id="admin-audit-target" class="input" placeholder="merchant, order…"></div>
        <div class="input-wrap"><label for="admin-audit-from">A partir de</label><input id="admin-audit-from" class="input" type="datetime-local"></div>
        <div class="input-wrap"><label for="admin-audit-to">Até</label><input id="admin-audit-to" class="input" type="datetime-local"></div>
      </div>
      <button class="secondary" onclick="adminAuditSearch()" ${adminRuntime.auditPending?'disabled aria-busy="true"':''}>${adminRuntime.auditPending?'Pesquisando…':'Pesquisar auditoria'}</button>
    </div>
    <div class="list" style="margin-top:12px">
      ${rows.length?rows.map(x=>`<details class="card flat admin-audit-row"><summary><span><strong>${esc(x.action)}</strong><small>${esc(x.target_type)} • ${esc(x.target_id||'—')} • ator ${esc(String(x.actor_user_id||'').slice(0,8))}</small></span><small>${esc(formatDateTime(x.created_at))}</small></summary><pre class="tiny admin-audit-metadata">${esc(JSON.stringify(x.metadata||{},null,2))}</pre></details>`).join(''):'<div class="empty card">Nenhuma ação encontrada.</div>'}
    </div>
  </section>`;
}

const ADMIN_SECTION_ROLES={
  overview:new Set(['superadmin','readonly','operations','finance','support','compliance']),
  orders:new Set(['superadmin','operations','finance','support']),
  customers:new Set(['superadmin','operations','finance','support']),
  partners:new Set(['superadmin','operations','compliance']),
  prospects:new Set(['superadmin','readonly','operations','compliance']),
  catalog:new Set(['superadmin','operations']),
  finance:new Set(['superadmin','finance']),
  incidents:new Set(['superadmin','readonly','operations','finance','support','compliance']),
  audit:new Set(['superadmin','readonly','operations','finance','support','compliance']),
  system:new Set(['superadmin','readonly','operations'])
};
function adminRoleCanSection(section,role=adminCurrentRole()){
  return ADMIN_SECTION_ROLES[String(section)]?.has(String(role))===true;
}
function adminFirstSectionForRole(role=adminCurrentRole()){
  return ['overview','orders','customers','partners','prospects','catalog','finance','incidents','audit','system']
    .find(section=>adminRoleCanSection(section,role))||'overview';
}

function adminSectionMeta(section=adminRuntime.section){
  return ({
    overview:{kicker:'CENTRAL DE COMANDO',title:'Visão geral',description:'Saúde do negócio, prioridades e decisões que exigem atenção agora.'},
    orders:{kicker:'OPERAÇÃO EM TEMPO REAL',title:'Pedidos',description:'Acompanhe aceite, risco, entrega, suporte e intervenções auditadas.'},
    customers:{kicker:'RELACIONAMENTO',title:'Clientes',description:'Visão operacional dos clientes recentes e acesso rápido ao histórico 360°.'},
    partners:{kicker:'REDE DE REVENDA',title:'Parceiros',description:'Aquisição, onboarding, compliance e prontidão operacional das revendas.'},
    prospects:{kicker:'EXPANSÃO NACIONAL',title:'Prospectos',description:'Demanda por município e revendas GLP da fonte oficial ANP.'},
    catalog:{kicker:'OFERTA DA PLATAFORMA',title:'Catálogo',description:'Categorias, produtos e governança da oferta disponível na plataforma.'},
    finance:{kicker:'CONTROLADORIA',title:'Financeiro',description:'Cobranças TAMÃO, crédito, D+1, PSP, conciliação, refunds e política econômica.'},
    incidents:{kicker:'CONFIABILIDADE',title:'Incidentes',description:'Severidade, resposta, MTTA/MTTR e resolução auditável dos eventos operacionais.'},
    audit:{kicker:'GOVERNANÇA',title:'Auditoria',description:'Trilha forense das decisões administrativas e mudanças sensíveis da plataforma.'},
    system:{kicker:'SEGURANÇA & PLATAFORMA',title:'Sistema',description:'Saúde técnica, portais, PSP, RBAC e controles estruturais do ambiente.'}
  })[String(section||'overview')]||{kicker:'CONTROL PLANE',title:'Administração',description:'Controle operacional do TAMÃO.'};
}
function adminRelativeTime(value){
  if(!value)return 'sem sincronização';
  const ms=Date.now()-Date.parse(value);
  if(!Number.isFinite(ms))return 'agora';
  const abs=Math.max(0,ms);
  if(abs<45000)return 'agora';
  const min=Math.round(abs/60000);
  if(min<60)return 'há '+min+' min';
  const hours=Math.round(min/60);
  if(hours<24)return 'há '+hours+' h';
  const days=Math.round(hours/24);
  return 'há '+days+' d';
}
function adminNavIcon(id){
  const paths={
    overview:'<path d="M4 12a8 8 0 1 1 16 0v7a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-7Z"/><path d="M8 11h8"/>',
    orders:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    customers:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    prospects:'<path d="M3 4h18v16H3zM7 9h4M7 13h8M7 17h10"/>',
    partners:'<path d="M8 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm8 0a4 4 0 1 0-4-4"/><path d="M1 21a7 7 0 0 1 14 0M14 15a7 7 0 0 1 9 6"/>',
    catalog:'<path d="M4 6h16v14H4z"/><path d="M8 6V3h8v3M8 11h8M8 15h5"/>',
    finance:'<path d="M4 7h16v13H4z"/><path d="M7 4h10M8 11h8M8 15h5"/><circle cx="17" cy="16" r="1"/>',
    incidents:'<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
    audit:'<path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h5M8 16h4"/><circle cx="17" cy="16" r="2.5"/>',
    system:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.38.3.6.65.6 1v.4h1v4h-1v.1c0 .2-.2.4-.6.5Z"/>'
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+(paths[id]||paths.overview)+'</svg>';
}
function adminOperationModeLabel(mode){
  return ({
    PRELAUNCH:'CONFIGURAÇÃO',
    PILOT:'OPERAÇÃO ATIVA',
    LIVE:'OPERAÇÃO NORMAL',
    PAUSED:'OPERAÇÃO PAUSADA'
  })[String(mode||'').toUpperCase()]||String(mode||'—').toUpperCase();
}
function adminReadinessStateLabel(state){
  return ({
    READY:'PRONTO',
    READY_WITH_WARNINGS:'ATENÇÃO',
    BLOCKED_SECURITY:'BLOQUEADO'
  })[String(state||'').toUpperCase()]||String(state||'—').toUpperCase();
}
function adminOperationalStrip(d){
  const readiness=d.launchReadiness||{};
  const mode=String(readiness.operationMode||(readiness.commerceEnabled?'LIVE':'PRELAUNCH')).toUpperCase();
  const blockers=Array.isArray(readiness.securityBlockers)?readiness.securityBlockers.length:0;
  const warnings=Array.isArray(readiness.unresolvedWarnings)?readiness.unresolvedWarnings.length:0;
  const incidents=(d.incidents||[]).filter(x=>x.status!=='resolved').length;
  const billing=d.merchantBilling||{};
  const ingress=billing.paymentIngress||{};
  const e2e=adminBillingE2EState(d);
  const provider=adminBillingProviderName(ingress.activeBillingProvider||adminRuntime.providerHealth?.provider);
  const providerState=e2e.validated?'integração verificada':adminRuntime.providerHealth?.ok===true?'API validada':ingress.livePspReady?'configurado':'pendente';
  const tone=blockers?'danger':warnings?'warning':'good';
  return '<div class="admin-ops-strip '+tone+'">'+
    '<div class="admin-ops-primary"><span class="admin-live-dot"></span><div><small>OPERAÇÃO</small><strong>'+esc(mode)+'</strong></div></div>'+
    '<div class="admin-ops-item"><small>Prontidão</small><strong>'+(blockers?blockers+' bloqueio(s)':warnings?warnings+' pendência(s)':'sem bloqueios')+'</strong></div>'+
    '<div class="admin-ops-item"><small>PSP</small><strong>'+esc(provider)+' • '+esc(providerState)+'</strong></div>'+
    '<div class="admin-ops-item"><small>Incidentes</small><strong>'+incidents+' aberto(s)</strong></div>'+
    '<div class="admin-ops-item admin-ops-sync"><small>Última atualização</small><strong>'+esc(adminRelativeTime(adminRuntime.lastSyncAt))+'</strong></div>'+
  '</div>';
}
function adminExecutiveKpi({icon,label,value,detail='',tone='neutral'}){
  return '<article class="admin-exec-kpi '+esc(tone)+'"><span class="admin-exec-icon" aria-hidden="true">'+esc(icon)+'</span><div><small>'+esc(label)+'</small><strong>'+value+'</strong>'+(detail?'<p>'+esc(detail)+'</p>':'')+'</div></article>';
}
function adminSetSection(section){
  const allowed=['overview','orders','customers','partners','prospects','catalog','finance','incidents','audit','system'];
  const requested=allowed.includes(String(section||''))?String(section):'overview';
  const next=adminRoleCanSection(requested)?requested:adminFirstSectionForRole();
  adminRuntime.section=next;
  try{sessionStorage.setItem('tamao-admin-section',next)}catch{}
  render();
  if(next==='system')adminLoadSystemHealth().catch(()=>{});
  if(next==='prospects')adminLoadProspects().catch(()=>{});
  requestAnimationFrame(()=>{
    document.querySelector('.admin-main')?.scrollIntoView({block:'start'});
  });
}

function adminMenuButton(id,label,icon,badge=''){
  if(!adminRoleCanSection(id))return '';
  const active=adminRuntime.section===id;
  return `<button class="admin-nav-item ${active?'active':''}" type="button" onclick="adminSetSection('${id}')" aria-current="${active?'page':'false'}">
    <span class="admin-nav-icon" aria-hidden="true">${adminNavIcon(id)}</span>
    <span class="admin-nav-label">${esc(label)}</span>
    ${badge!==''?`<span class="admin-nav-badge">${esc(String(badge))}</span>`:''}
  </button>`;
}

function adminPanel(id,content){
  if(!adminRoleCanSection(id))return '';
  return `<div class="admin-panel ${adminRuntime.section===id?'active':''}" data-admin-panel="${id}">${content}</div>`;
}

function adminMoney(cents){
  return BRL.format(Math.max(0,Number(cents||0))/100);
}
function adminParseMoneyToCents(value){
  let raw=String(value??'').trim().replace(/\s+/g,'').replace(/^R\$/i,'');
  if(!raw)return null;
  if(raw.includes(',')){
    raw=raw.replace(/\./g,'').replace(',','.');
  }else if(/^\d{1,3}(\.\d{3})+$/.test(raw)){
    raw=raw.replace(/\./g,'');
  }
  if(!/^\d+(?:\.\d{1,2})?$/.test(raw))return null;
  const cents=Math.round(Number(raw)*100);
  return Number.isSafeInteger(cents)&&cents>0?cents:null;
}
function adminNormalizePaymentMethod(value){
  const raw=String(value??'').trim().toLowerCase();
  const map={
    pix:'pix',
    transferencia:'bank_transfer',
    'transferência':'bank_transfer',
    bank_transfer:'bank_transfer',
    dinheiro:'cash',
    cash:'cash',
    cartao:'card',
    'cartão':'card',
    card:'card',
    outro:'other',
    other:'other'
  };
  return map[raw]||null;
}
function adminPaymentMethodLabel(value){
  return ({pix:'Pix',bank_transfer:'Transferência',cash:'Dinheiro',card:'Cartão',other:'Outro'})[String(value||'')]||String(value||'—');
}
function adminMerchantName(id){
  const m=(adminRuntime.data?.merchants||[]).find(x=>x.id===id);
  return m?.name||String(id||'Revenda');
}
function adminStatusPill(status){
  const good=['active','verified','paid'].includes(status);
  const bad=['rejected','suspended','reversed'].includes(status);
  return '<span class="status-pill '+(good?'online':bad?'offline':'')+'">'+esc(String(status||'—').toUpperCase())+'</span>';
}

function adminLoginView(){
  return shell(`<section class="page">
    <span class="eyebrow">CONTROL PLANE</span>
    <h1 class="page-title">Administração protegida</h1>
    <p class="muted">Acesso exclusivo para contas permanentes previamente autorizadas no banco.</p>
    ${adminRuntime.notice?`<div class="notice success" style="margin-top:14px">${esc(adminRuntime.notice)}</div>`:''}
    ${adminRuntime.error?`<div class="notice danger" style="margin-top:14px">${esc(adminRuntime.error)}</div>`:''}
    <div class="card flat form-stack" style="margin-top:16px">
      <div class="input-wrap"><label for="admin-email">E-mail administrativo</label><input id="admin-email" type="email" autocomplete="email" maxlength="160" class="input" placeholder="voce@email.com"></div>
      <button class="primary" onclick="adminLoginFromUi()" ${adminRuntime.actionPending?'disabled aria-busy="true"':''}>${adminRuntime.actionPending?'Processando…':'Enviar link de acesso'}</button>
    </div>
    <div class="notice" style="margin-top:14px">O portal nunca concede permissão pelo navegador. Um admin existente recebe o link normalmente; no primeiro acesso, somente o e-mail previamente reservado no servidor pode criar e reclamar a conta inicial.</div>
  </section>`);
}

function adminNoAccessView(){
  const email=adminRuntime.session?.user?.email||'conta autenticada';
  return shell(`<section class="page">
    <span class="eyebrow">ACESSO NEGADO</span>
    <h1 class="page-title">Conta não autorizada</h1>
    <p class="muted">${esc(email)} está autenticada, mas o servidor não concedeu acesso ao control plane.</p>
    <div class="notice danger" style="margin-top:14px">${esc(adminBootstrapAccessMessage())}</div>
    <div class="notice" style="margin-top:10px">Não existe autoelevação de privilégio. O primeiro admin só pode nascer da reserva criptográfica server-side; depois disso, novos administradores dependem de um admin já ativo.</div>
    <button class="secondary full" style="margin-top:12px" onclick="adminRetryBootstrapFromUi()">Validar acesso novamente</button>
    <button class="ghost full" style="margin-top:8px" onclick="adminSignOut()">Sair desta conta</button>
  </section>`);
}

function adminBootstrapErrorView(){
  return shell(`<section class="page">
    <span class="eyebrow">VALIDAÇÃO ADMINISTRATIVA</span>
    <h1 class="page-title">Não foi possível concluir a validação</h1>
    <p class="muted">Sua sessão foi autenticada, mas a autoridade de bootstrap não respondeu de forma conclusiva.</p>
    <div class="notice danger" style="margin-top:14px">${esc(adminRuntime.bootstrapError||adminRuntime.error||'Falha temporária na validação administrativa.')}</div>
    <div class="notice" style="margin-top:10px">Nenhuma permissão foi concedida por fallback. O acesso permanece fechado até o servidor confirmar a autorização.</div>
    <button class="primary full" style="margin-top:12px" onclick="adminRetryBootstrapFromUi()">Tentar validação novamente</button>
    <button class="ghost full" style="margin-top:8px" onclick="adminSignOut()">Sair desta conta</button>
  </section>`);
}

function adminApplicationCard(a){
  const pending=a.status==='pending';
  return `<article class="order-card">
    <div class="order-head"><div><div class="order-id">${esc(a.company_name)}</div><div class="tiny muted">${esc(a.cnpj)}</div></div>${adminStatusPill(a.status)}</div>
    <div class="order-line"><strong>Responsável:</strong> ${esc(a.responsible_name)}</div>
    <div class="order-line"><strong>WhatsApp:</strong> ${esc(a.phone)}</div>
    <div class="order-line"><strong>Endereço:</strong> ${esc(a.address_text)}</div>
    <div class="tiny muted">Recebido em ${new Date(a.created_at).toLocaleString('pt-BR')}</div>
    ${pending?`<div class="order-actions"><button class="primary small" onclick="adminApproveApplication('${a.id}')">Aprovar cadastro</button><button class="danger-btn small" onclick="adminRejectApplication('${a.id}')">Rejeitar</button></div>`:''}
  </article>`;
}


function adminProductName(code){
  const value=String(code||'').toUpperCase();
  if(/^P([1-9]|[1-8][0-9]|90)$/.test(value))return 'Gás GLP '+value;
  return ({WATER20:'Água 20 L',CHARCOAL4:'Carvão 4 kg',WOOD:'Lenha',ICE5:'Gelo 5 kg'})[value]||value;
}
function adminPilotInviteControls(p,id){
  const convertible=!['converted','cancelled'].includes(String(p?.onboarding_status||''));
  if(!convertible)return '';
  const invite=p?.activeInvite||null;
  const expiresAt=invite?.expiresAt?Date.parse(invite.expiresAt):NaN;
  const active=Boolean(invite&&Number.isFinite(expiresAt)&&expiresAt>Date.now());
  const label=active?'ativo até '+new Date(invite.expiresAt).toLocaleString('pt-BR'):invite?'expirado':'nenhum convite ativo';
  return '<div class="order-line"><strong>Convite do parceiro:</strong> '+esc(label)+'</div>'+
    (active?'<div class="tiny muted">Por segurança, o link não é armazenado em claro e não pode ser recuperado depois. Se você não salvou o link quando ele foi criado, use <strong>Rotacionar convite</strong>.</div>':'')+
    '<div class="order-actions"><button class="secondary small" onclick="adminIssuePilotInvite(\''+esc(id)+'\')">'+(active?'Rotacionar convite':'Gerar convite')+'</button>'+
    (active?'<button class="danger-btn small" onclick="adminRevokePilotInvite(\''+esc(id)+'\')">Revogar convite</button>':'')+'</div>';
}

function adminPilotNextActionCopy(p){
  const next=String(p?.onboarding?.nextAction||'');
  return ({
    issue_invite:'Gere o convite e envie ao parceiro. Nenhuma revenda será criada antes de ele entrar com uma conta permanente.',
    issue_new_invite:'O convite anterior não está utilizável. Gere um novo link e envie ao parceiro.',
    partner_claim_invite:'Convite ativo. O próximo passo é o parceiro abrir o link, entrar com o e-mail dele e concluir o cadastro.',
    review_and_convert:'Convite reivindicado e cadastro ligado ao parceiro. Revise os dados reais abaixo e converta a revenda.',
    partner_resubmit:'O cadastro ligado ao convite foi rejeitado. O parceiro precisa corrigir e reenviar antes da conversão.',
    merchant_setup_review:'A revenda já foi criada. Revise as pendências operacionais abaixo antes de ativá-la.',
    assign_owner:'Vincule um owner operacional permanente à revenda.',
    verify_compliance:'Valide CNPJ e, quando aplicável, ANP antes de ativar a operação.',
    confirm_payment:'Confirme ao menos uma forma de pagamento aceita pela revenda.',
    confirm_offer:'Confirme produto ativo, estoque disponível e preço recente.',
    confirm_logistics:'Confirme atendimento da área e taxa de entrega recente.',
    activate_merchant:'As bases estão prontas. Ative a revenda no painel administrativo.',
    go_online:'A revenda está ativa; o responsável precisa entrar no portal e colocá-la online.',
    refresh_heartbeat:'A revenda está online, mas precisa renovar a presença no portal para ficar ofertável.',
    ready:'Revenda pronta e ofertável agora.',
    none:'Este parceiro não possui próxima ação operacional.'
  })[next]||'Revise o estado do parceiro antes de continuar.';
}
function adminPilotPartnerCard(p){
  const statusLabel={
    awaiting_legal_data:'AGUARDANDO DADOS REAIS',
    ready_for_review:'PRONTO PARA REVISÃO',
    converted:'CONVERTIDO',
    cancelled:'CANCELADO'
  }[p.onboarding_status]||String(p.onboarding_status||'—').toUpperCase();
  const statusClass=p.onboarding_status==='converted'?'online':p.onboarding_status==='cancelled'?'offline':'risk';
  const id=String(p.id);
  const prefix='pilot-'+id;
  const convertible=!['converted','cancelled'].includes(p.onboarding_status);
  const onboarding=p.onboarding||{};
  const application=onboarding.application||null;
  const applicationUsable=Boolean(application&&['pending','approved'].includes(String(application.status||'')));
  const readyToConvert=convertible&&onboarding.ownerClaimed===true&&applicationUsable;
  const steps=Array.isArray(onboarding.steps)?onboarding.steps:[];
  const stepLabel={
    invite:'Convite',
    claim:'Conta vinculada',
    application:'Cadastro',
    merchant:'Revenda criada',
    owner:'Owner',
    compliance:'Compliance',
    payment:'Pagamento',
    offer:'Oferta',
    online:'Online'
  };
  const stepHtml=steps.length
    ? '<div class="pilot-step-grid">'+steps.map((step,index)=>{
        const done=step?.done===true;
        return '<div class="pilot-step '+(done?'done':'pending')+'"><span>'+(index+1)+'</span><div><strong>'+esc(stepLabel[step.key]||step.key)+'</strong><small>'+esc(done?'concluído':'pendente')+'</small></div></div>';
      }).join('')+'</div>'
    : '';
  const prefill={
    legal:application?.companyName||'',
    cnpj:application?.cnpj||'',
    responsible:application?.responsibleName||'',
    phone:application?.phone||'',
    whatsapp:application?.phone||'',
    address:application?.addressText||''
  };
  const inviteState={
    none:'SEM CONVITE',
    active:'CONVITE ATIVO',
    claimed:'REIVINDICADO',
    expired:'EXPIRADO',
    revoked:'REVOGADO'
  }[String(onboarding.inviteStatus||'none')]||String(onboarding.inviteStatus||'').toUpperCase();
  return `<article class="order-card">
    <div class="order-head"><div><div class="order-id">${esc(p.display_name)}</div><div class="tiny muted">Cadastro de parceiro • ${esc(p.proposed_product_code)}</div></div><span class="status-pill ${statusClass}">${esc(statusLabel)}</span></div>
    <div class="order-line"><strong>${p.pricing_mode==='range'?'Faixa comercial confirmada':'Preço comercial informado'}:</strong> ${p.pricing_mode==='range'?adminMoney(p.min_delivered_price_cents)+' mínimo • '+adminMoney(p.preferred_delivered_price_cents)+' normal • '+adminMoney(p.max_delivered_price_cents)+' máximo':adminMoney(p.proposed_delivered_price_cents)} ${p.delivery_included?'com entrega incluída':'antes da entrega'}</div>
    ${p.pricing_mode==='range'?`<div class="order-line"><strong>Estratégia inicial:</strong> ${esc(({volume:'Priorizar volume',balanced:'Equilibrado',margin:'Priorizar margem'})[p.pricing_strategy]||p.pricing_strategy||'—')}</div>`:''}
    <div class="order-line"><strong>Status do preço:</strong> ${p.price_status==='confirmed'?'confirmado':'proposto — ainda não publicar como oferta real'}</div>
    ${p.notes?`<div class="tiny muted">${esc(p.notes)}</div>`:''}
    <div class="divider"></div>
    <div class="status-bar"><strong>Onboarding real</strong><span class="status-pill ${onboarding.inviteStatus==='claimed'?'online':onboarding.inviteStatus==='active'?'risk':'offline'}">${esc(inviteState)}</span></div>
    ${stepHtml}
    <div class="notice ${readyToConvert?'success':''}" style="margin-top:10px"><strong>Próxima ação</strong><br>${esc(adminPilotNextActionCopy(p))}</div>
    ${application?`<div class="order-line"><strong>Cadastro do parceiro:</strong> ${esc(String(application.status||'—').toUpperCase())} • atualizado ${esc(formatDateTime(application.updatedAt))}</div>`:''}
    ${adminPilotInviteControls(p,id)}
    ${p.onboarding_status==='converted'?`<div class="notice success" style="margin-top:10px"><strong>Revenda criada.</strong><br>ID: ${esc(p.merchant_id||'—')}. Compliance e ativação continuam separados.</div>`:''}
    ${convertible?`<div class="divider"></div>
      <div class="notice"><strong>Concluir cadastro e criar revenda</strong><br>Cria cadastro, dados comerciais, catálogo, estoque inicial e pagamentos selecionados. Compliance permanece <strong>pendente</strong>. A conversão só é liberada quando o convite estiver ligado à conta permanente do parceiro.</div>
      <div class="field-row">
        <div class="input-wrap"><label for="${prefix}-legal">Razão social</label><input id="${prefix}-legal" class="input" maxlength="180" value="${esc(prefill.legal)}" placeholder="Razão social real"></div>
        <div class="input-wrap"><label for="${prefix}-cnpj">CNPJ</label><input id="${prefix}-cnpj" class="input" maxlength="24" value="${esc(prefill.cnpj)}" placeholder="CNPJ real"></div>
      </div>
      <div class="field-row">
        <div class="input-wrap"><label for="${prefix}-responsible">Responsável</label><input id="${prefix}-responsible" class="input" maxlength="120" value="${esc(prefill.responsible)}" placeholder="Nome do responsável"></div>
        <div class="input-wrap"><label for="${prefix}-owner-name">Nome no portal</label><input id="${prefix}-owner-name" class="input" maxlength="60" value="${esc(prefill.responsible)}" placeholder="Opcional"></div>
      </div>
      <div class="field-row">
        <div class="input-wrap"><label for="${prefix}-phone">Telefone</label><input id="${prefix}-phone" class="input" maxlength="24" value="${esc(prefill.phone)}" placeholder="55..."></div>
        <div class="input-wrap"><label for="${prefix}-whatsapp">WhatsApp</label><input id="${prefix}-whatsapp" class="input" maxlength="24" value="${esc(prefill.whatsapp)}" placeholder="55..."></div>
      </div>
      <div class="field-row">
        <div class="input-wrap"><label for="${prefix}-postal">CEP</label><input id="${prefix}-postal" class="input" maxlength="12" placeholder="97300000"></div>
        <div class="input-wrap"><label for="${prefix}-city">Cidade</label><input id="${prefix}-city" class="input" maxlength="120" value="São Gabriel"></div>
      </div>
      <div class="input-wrap"><label for="${prefix}-address">Endereço</label><input id="${prefix}-address" class="input" maxlength="240" value="${esc(prefill.address)}" placeholder="Rua, número e complemento"></div>
      <div class="notice ${onboarding.ownerClaimed?'success':''}"><strong>Owner automático pelo convite.</strong><br>${onboarding.ownerClaimed?'Conta permanente do parceiro já vinculada. A autoridade do banco impedirá trocar o owner por outra conta.':'Ainda aguardando o parceiro reivindicar o convite. A conversão permanece bloqueada para não criar revenda órfã.'}</div>
      <div class="field-row">
        <div class="input-wrap"><label for="${prefix}-stock">Estoque inicial</label><input id="${prefix}-stock" class="input" type="number" min="0" max="1000000" step="1" value="0"></div>
        <div class="input-wrap"><label for="${prefix}-fee">Taxa de entrega</label><input id="${prefix}-fee" class="input" type="number" min="0" max="1000" step="0.01" value="0.00"></div>
      </div>
      <div class="field-row">
        <div class="input-wrap"><label for="${prefix}-eta">ETA base (min)</label><input id="${prefix}-eta" class="input" type="number" min="5" max="180" step="1" value="30"></div>
        <div class="input-wrap"><label for="${prefix}-radius">Raio km</label><input id="${prefix}-radius" class="input" type="number" min="0" max="100" step="0.5" placeholder="Opcional"></div>
      </div>
      <label class="check-row"><input id="${prefix}-citywide" type="checkbox"><span><strong>Atende toda São Gabriel</strong><small>Marque apenas se a cobertura foi confirmada.</small></span></label>
      <div class="card flat"><strong>Formas de pagamento aceitas do cliente final</strong><div class="tiny muted" style="margin-top:4px">Isto descreve como a revenda recebe a venda do cliente. Não é a cobrança de taxas do TAMÃO.</div>
        <label class="check-row"><input id="${prefix}-pay-pix" type="checkbox"><span>Pix</span></label>
        <label class="check-row"><input id="${prefix}-pay-cash" type="checkbox"><span>Dinheiro</span></label>
        <label class="check-row"><input id="${prefix}-pay-card" type="checkbox"><span>Cartão na entrega</span></label>
      </div>
      <div class="input-wrap"><label for="${prefix}-notes">Observações administrativas</label><input id="${prefix}-notes" class="input" maxlength="2000" placeholder="Evidências, combinações e pendências"></div>
      <button class="primary" onclick="adminConvertPilotPartner('${id}')" ${readyToConvert?'':'disabled title="Aguarde o parceiro reivindicar o convite e concluir um cadastro válido"'}>Converter em revenda pendente</button>
    `:''}
  </article>`;
}

function adminMerchantCard(m){
  const c=m.compliance||{};
  const readiness=m.readiness||null;
  const active=m.status==='active';
  const cnpjId='cnpj-'+m.id;
  const anpId='anp-'+m.id;
  const refId='anpref-'+m.id;
  const notesId='notes-'+m.id;
  const mixed=(m.deliveryCapabilities||[]).find(x=>x.capability_code==='regulated_glp_mixed_load_verified');
  const mixedId='mixed-'+m.id;
  const mixedNotesId='mixednotes-'+m.id;
  return `<article class="order-card">
    <div class="order-head"><div><div class="order-id">${esc(m.name)}</div><div class="tiny muted">${esc(m.cnpj)}</div></div>${adminStatusPill(m.status)}</div>
    <div class="order-line">Online: <strong>${m.online?'sim':'não'}</strong> • Trust: ${Number(m.trust_score||0)}/100</div>
    ${readiness?`<div class="notice ${readiness.offerReady?'success':''}" style="margin-top:10px"><strong>${readiness.offerReady?'Revenda ofertável':'Próximo passo operacional'}</strong><br>${esc(adminPilotNextActionCopy({onboarding:{nextAction:readiness.nextAction}}))}</div>`:''}
    ${m.businessDetails?`<div class="order-line"><strong>Responsável:</strong> ${esc(m.businessDetails.responsible_name)} • ${esc(m.businessDetails.city)}/${esc(m.businessDetails.state)} • WhatsApp ${esc(m.businessDetails.whatsapp)}</div>`:''}
    <div class="field-row" style="margin-top:12px">
      <div class="input-wrap"><label for="${cnpjId}">CNPJ</label><select id="${cnpjId}" class="input"><option value="pending" ${c.cnpj_status==='pending'?'selected':''}>Pendente</option><option value="verified" ${c.cnpj_status==='verified'?'selected':''}>Verificado</option><option value="rejected" ${c.cnpj_status==='rejected'?'selected':''}>Rejeitado</option></select><small>Última verificação: ${c.cnpj_verified_at?esc(formatDateTime(c.cnpj_verified_at)):'nunca'}</small></div>
      <div class="input-wrap"><label for="${anpId}">ANP</label><select id="${anpId}" class="input"><option value="pending" ${c.anp_status==='pending'?'selected':''}>Pendente</option><option value="verified" ${c.anp_status==='verified'?'selected':''}>Verificada</option><option value="not_required" ${c.anp_status==='not_required'?'selected':''}>Não se aplica</option><option value="rejected" ${c.anp_status==='rejected'?'selected':''}>Rejeitada</option></select><small>Última verificação: ${c.anp_verified_at?esc(formatDateTime(c.anp_verified_at)):c.anp_status==='not_required'?'não se aplica':'nunca'}</small></div>
    </div>
    <div class="input-wrap"><label for="${refId}">Referência ANP</label><input id="${refId}" class="input" maxlength="240" value="${esc(c.anp_reference||'')}" placeholder="Número/consulta/evidência"></div>
    <div class="input-wrap"><label for="${notesId}">Evidência / observações de compliance</label><input id="${notesId}" class="input" maxlength="1000" value="${esc(c.notes||'')}" placeholder="Fonte consultada, data, resultado e referência da validação"><small>Ao marcar CNPJ como verificado, registre aqui a fonte/evidência. ANP verificada também exige a referência acima.</small></div>
    ${c.verified_by?`<div class="tiny muted">Última decisão de compliance por admin ${esc(String(c.verified_by).slice(0,8))} • ${esc(formatDateTime(c.updated_at))}</div>`:''}
    <div class="divider"></div>
    <label class="check-row"><input id="${mixedId}" type="checkbox" ${mixed?.active?'checked':''}><span><strong>Capacidade logística verificada para cesta mista com GLP</strong><small>Ative somente após validação operacional específica. CNPJ e ANP precisam estar verificados.</small></span></label>
    <div class="input-wrap"><label for="${mixedNotesId}">Evidência / observação logística</label><input id="${mixedNotesId}" class="input" maxlength="1000" value="${esc(mixed?.notes||'')}" placeholder="Veículo, procedimento, evidência ou referência da validação"></div>
    <div class="order-actions"><button class="ghost small" onclick="adminOpenEntity('merchant','${m.id}')">Abrir 360°</button><button class="secondary small" onclick="adminSaveCompliance('${m.id}')">Salvar validação</button><button class="secondary small" onclick="adminSaveDeliveryCapability('${m.id}')">Salvar capacidade logística</button>${active?`<button class="danger-btn small" onclick="adminSetMerchantStatus('${m.id}','suspend-merchant')">Suspender</button>`:`<button class="primary small" onclick="adminSetMerchantStatus('${m.id}','activate-merchant')">Ativar</button>`}</div>
  </article>`;
}

function adminReferralReasonLabel(code){
  const map={
    same_delivery_address_as_referrer:'Mesmo endereço de entrega do indicador',
    high_referral_velocity_24h:'Volume alto de indicações em 24h',
    multiple_referred_accounts_same_address:'Múltiplas contas indicadas no mesmo endereço'
  };
  return map[String(code||'')]||String(code||'Sinal de risco');
}
function adminReferralReviewCard(x){
  const financiallyReversed=x.financialState==='reversed'||!!x.financialReversedAt;
  const pending=x.risk_status==='review_required'&&!financiallyReversed;
  const reasons=Array.isArray(x.risk_reasons)?x.risk_reasons:[];
  return `<article class="order-card">
    <div class="order-head"><div><div class="order-id">Pedido ${esc(x.order_id)}</div><div class="tiny muted">Indicador ${esc(x.referrer_user_id)} • comprador ${esc(x.referred_user_id)}</div></div>${adminStatusPill(x.risk_status)}</div>
    <div class="order-line"><strong>Sinais:</strong> ${reasons.length?reasons.map(r=>esc(adminReferralReasonLabel(r))).join(' • '):'Nenhum sinal automático'}</div>
    <div class="tiny muted">Criado em ${new Date(x.created_at).toLocaleString('pt-BR')}</div>
    ${x.review_notes?`<div class="order-line"><strong>Revisão:</strong> ${esc(x.review_notes)}</div>`:''}
    ${financiallyReversed?'<div class="notice danger" style="margin-top:10px"><strong>Pedido financeiramente revertido.</strong><br>A comissão já foi estornada; nenhuma nova ação financeira deve ser aplicada.</div>':''}
    ${pending?`<div class="order-actions"><button class="primary small" onclick="adminReviewReferral('${x.order_id}','approved')">Aprovar comissão</button><button class="danger-btn small" onclick="adminReviewReferral('${x.order_id}','rejected')">Rejeitar comissão</button></div>`:''}
  </article>`;
}
function adminBillingPlanLabel(planKey){
  const plan=(adminRuntime.data?.merchantBilling?.plans||[]).find(x=>x.plan_key===planKey);
  return plan?.display_name||String(planKey||'—');
}
function adminBillingStatementStatus(status){
  return ({
    open:'ABERTO',
    paid:'PAGO',
    overdue:'VENCIDO',
    waived:'ABONADO'
  })[String(status||'')]||String(status||'—').toUpperCase();
}
function adminBillingPlanCard(plan){
  const fee=(Number(plan.platform_fee_bps||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const prepaid=plan.billing_mode==='prepaid_credit';
  const version=Number(plan.policy_version||1);
  const flex=plan.plan_key==='flex_daily';
  const inputId='billing-plan-fee-'+String(plan.plan_key).replace(/[^a-z0-9_-]/gi,'');
  const activeId='billing-plan-active-'+String(plan.plan_key).replace(/[^a-z0-9_-]/gi,'');
  return `<article class="card flat">
    <div class="order-head"><div><strong>${esc(plan.display_name)}</strong><br><small>${prepaid?'Crédito pré-pago':'Pós-pago diário'} • versão ${version}</small></div><span class="status-pill ${plan.active?'online':'offline'}">${plan.active?'ATIVO':'PAUSADO'}</span></div>
    ${prepaid?`<div class="order-line"><strong>Pacote:</strong> ${adminMoney(plan.purchase_amount_cents)} → ${adminMoney(plan.credit_grant_cents)} em crédito de taxas</div>`:'<div class="order-line">Sem compra antecipada • fechamento diário D+1</div>'}
    <div class="field-row" style="margin-top:12px">
      <div class="input-wrap"><label for="${inputId}">Taxa efetiva TAMÃO (%)</label><input id="${inputId}" class="input" type="number" min="0.01" max="100" step="0.05" value="${fee}"></div>
      <label class="check-row"><input id="${activeId}" type="checkbox" ${plan.active?'checked':''} ${flex?'disabled':''}><span><strong>${flex?'Fallback obrigatório':'Plano disponível'}</strong><small>${flex?'O Flex Diário não pode ser desativado.':'Pausar afeta apenas novas seleções; pedidos já criados mantêm o snapshot.'}</small></span></label>
    </div>
    <div class="order-actions"><button class="secondary small" onclick="adminSaveBillingPlan('${esc(plan.plan_key)}',${version})">Salvar plano</button></div>
    ${plan.last_change_reason?`<small class="field-help">Última decisão: ${esc(plan.last_change_reason)} • ${esc(formatDateTime(plan.updated_at))}</small>`:''}
  </article>`;
}
function adminBillingAccountCard(account){
  const held=account.sales_hold===true;
  const available=Math.max(0,Number(account.credit_balance_cents||0)-Number(account.credit_reserved_cents||0));
  return `<article class="order-card">
    <div class="order-head"><div><div class="order-id">${esc(adminMerchantName(account.merchant_id))}</div><div class="tiny muted">${esc(adminBillingPlanLabel(account.plan_key))} • atualizado ${esc(account.updated_at?new Date(account.updated_at).toLocaleString('pt-BR'):'—')}</div></div><span class="status-pill ${held?'offline':'online'}">${held?'VENDAS EM HOLD':'FINANCEIRO OK'}</span></div>
    <div class="merchant-kpis">
      <div class="kpi"><span class="label">Crédito</span><strong>${adminMoney(account.credit_balance_cents)}</strong></div>
      <div class="kpi"><span class="label">Reservado</span><strong>${adminMoney(account.credit_reserved_cents)}</strong></div>
      <div class="kpi"><span class="label">Disponível</span><strong>${adminMoney(available)}</strong></div>
      <div class="kpi"><span class="label">Último fechamento</span><strong>${esc(account.last_daily_close_date||'—')}</strong></div>
    </div>
    ${held?`<div class="notice danger" style="margin-top:10px"><strong>Novas vendas bloqueadas.</strong><br>${esc(account.sales_hold_reason||'Débito vencido')} • desde ${esc(account.sales_hold_at?new Date(account.sales_hold_at).toLocaleString('pt-BR'):'—')}</div>`:''}
    <div class="order-actions">
      <button class="ghost small" onclick="adminSetMerchantFlex('${esc(account.merchant_id)}')">Voltar ao Flex</button>
    </div>
  </article>`;
}
function adminBillingStatementCard(statement){
  const overdue=statement.status==='overdue';
  const open=['open','overdue'].includes(statement.status);
  const paidByCredit=Number(statement.prepaid_credit_applied_cents||0);
  return `<article class="order-card">
    <div class="order-head"><div><div class="order-id">${esc(adminMerchantName(statement.merchant_id))} • ${esc(statement.business_date)}</div><div class="tiny muted">Fechado em ${esc(new Date(statement.closed_at).toLocaleString('pt-BR'))} • vence ${esc(new Date(statement.due_at).toLocaleString('pt-BR'))}</div></div><span class="status-pill ${statement.status==='paid'?'online':overdue?'offline':'risk'}">${esc(adminBillingStatementStatus(statement.status))}</span></div>
    <div class="merchant-kpis">
      <div class="kpi"><span class="label">Vendas</span><strong>${adminMoney(statement.gross_sales_cents)}</strong></div>
      <div class="kpi"><span class="label">Taxa bruta</span><strong>${adminMoney(statement.gross_fee_cents)}</strong></div>
      <div class="kpi"><span class="label">Crédito usado</span><strong>${adminMoney(paidByCredit)}</strong></div>
      <div class="kpi"><span class="label">A pagar</span><strong>${adminMoney(statement.amount_due_cents)}</strong></div>
    </div>
    ${open?`<div class="notice" style="margin-top:10px"><strong>Quitação somente pela fila de pagamentos informados.</strong><br>Para marcar este fechamento como pago, a revenda precisa informar o pagamento e o Financeiro deve aprovar o valor exato. O abono administrativo continua separado.</div><div class="order-actions"><button class="ghost small" onclick="adminResolveDailyStatement('${esc(statement.merchant_id)}','${esc(statement.id)}','waive-statement')">Abonar</button></div>`:''}
    ${statement.resolution_reference?`<div class="tiny muted">Referência: ${esc(statement.resolution_reference)}</div>`:''}
  </article>`;
}
function adminBillingPaymentRequestCard(request){
  const plans=adminRuntime.data?.merchantBilling?.plans||[];
  const events=adminRuntime.data?.merchantBilling?.paymentEvents||[];
  const plan=plans.find(p=>p.plan_key===request.plan_key);
  const matchedEvent=events.find(e=>e.status==='matched_exact'&&e.payment_request_id===request.id)||null;
  const pending=request.status==='pending';
  const approved=request.status==='approved';
  const title=request.request_kind==='package_purchase'
    ? 'Compra de '+(plan?.display_name||request.plan_key||'pacote')
    : request.request_kind==='refund_recovery'
      ? 'Recuperação de refund/estorno'
      : 'Pagamento de fechamento diário';
  const statusLabel=({
    pending:'PENDENTE',
    approved:'APROVADO',
    rejected:'REJEITADO',
    cancelled:'CANCELADO'
  })[String(request.status||'')]||String(request.status||'—').toUpperCase();
  const statusClass=approved?'online':request.status==='rejected'?'offline':pending?'risk':'';
  const detail=request.request_kind==='package_purchase'
    ? `${adminMoney(request.expected_amount_cents)} • crédito ${adminMoney(request.credit_grant_cents_snapshot)} • taxa ${(Number(request.platform_fee_bps_snapshot||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}%`
    : request.request_kind==='refund_recovery'
      ? `${adminMoney(request.expected_amount_cents)} • obrigação ${esc(request.refund_recovery_id||'—')}`
      : `${adminMoney(request.expected_amount_cents)} • fechamento ${esc(request.statement_id||'—')}`;
  return `<article class="order-card">
    <div class="order-head"><div><div class="order-id">${esc(adminMerchantName(request.merchant_id))} • ${esc(title)}</div><div class="tiny muted">${esc(request.requested_at?new Date(request.requested_at).toLocaleString('pt-BR'):'—')} • ${detail}</div></div><span class="status-pill ${statusClass}">${esc(statusLabel)}</span></div>
    <div class="order-line"><strong>Referência informada pela revenda:</strong> ${esc(request.merchant_reference||'—')}</div>
    ${request.admin_reference?`<div class="tiny muted">Referência administrativa: ${esc(request.admin_reference)}</div>`:''}
    ${approved&&request.received_amount_cents!=null?`<div class="tiny muted">Recebido: ${adminMoney(request.received_amount_cents)} • ${esc(adminPaymentMethodLabel(request.payment_method))}${request.reconciliation_key?' • ID '+esc(request.reconciliation_key):''} • origem ${esc(request.approval_source==='provider_event'?'evento do provedor':'conferência manual')}</div>`:''}
    ${pending?`${matchedEvent?`<div class="notice success" style="margin-top:10px"><strong>Conciliação automática pronta.</strong><br>${esc(matchedEvent.provider)} confirmou ${adminMoney(matchedEvent.amount_cents)} • ${esc(adminPaymentMethodLabel(matchedEvent.payment_method))} • ID ${esc(matchedEvent.reconciliation_key)}.</div>`:`<div class="notice" style="margin-top:10px"><strong>Nenhum crédito ou quitação ocorreu ainda.</strong><br>Confira o recebimento no meio financeiro antes de aprovar. A aprovação exige valor recebido exato, meio de pagamento e referência.</div>`}
      <div class="order-actions">
        ${matchedEvent?`<button class="primary small" onclick="adminResolveBillingPaymentRequest('${esc(request.id)}','approve','${esc(matchedEvent.id)}')">Confirmar evento conciliado</button><span class="tiny muted">Aprovação manual desabilitada: existe prova exata do PSP.</span>`:`<button class="primary small" onclick="adminResolveBillingPaymentRequest('${esc(request.id)}','approve')">Confirmar recebimento</button>`}
        <button class="danger-btn small" onclick="adminResolveBillingPaymentRequest('${esc(request.id)}','reject')">Rejeitar</button>
      </div>`:''}
  </article>`;
}

function adminBillingPaymentEventLabel(status){
  return ({
    received:'RECEBIDO',
    matched_exact:'CONCILIADO',
    review_required:'REVISAR',
    already_applied:'JÁ APLICADO',
    ignored:'IGNORADO',
    superseded:'SUBSTITUÍDO',
    refunded:'REEMBOLSADO',
    applied:'APLICADO'
  })[String(status||'')]||String(status||'—').toUpperCase();
}
function adminBillingPaymentMatchReasonLabel(reason){
  return ({
    exact_reference_and_amount:'referência + valor exatos',
    multiple_exact_candidates:'mais de uma cobrança candidata',
    reference_found_but_amount_differs:'referência encontrada com valor diferente',
    no_exact_pending_request:'nenhuma cobrança pendente correspondente',
    approved_payment_already_uses_transaction:'transação já aplicada em cobrança aprovada',
    transaction_key_already_used_with_other_amount:'ID já usado com outro valor',
    duplicate_transaction_event:'outro evento conflitante já é o registro canônico desta transação',
    sibling_provider_event_same_transaction:'notificação irmã do PSP para a mesma transação; registro canônico preservado',
    sibling_provider_event_resolved_by_charge:'notificação genérica do PSP substituída pela cobrança correlacionada',
    approved_payment_request_applied:'evento aplicado pela aprovação conciliada',
    manual_approval_payment_already_confirmed:'pagamento confirmado manualmente pelo Financeiro',
    provider_charge_correlation_and_amount:'cobrança Pix correlacionada ao TAMÃO + valor exato',
    provider_charge_request_not_pending:'Pix recebido para solicitação que já não está pendente',
    provider_charge_merchant_mismatch:'correlação Pix aponta para outra revenda',
    provider_charge_amount_mismatch:'Pix correlacionado com valor diferente do esperado',
    provider_refund_before_approval:'pagamento devolvido pelo PSP antes da aprovação financeira',
    ignored_by_finance:'evento encerrado pelo Financeiro'
  })[String(reason||'')]||String(reason||'—');
}

function adminBillingPaymentEventCard(event){
  const status=String(event.status||'');
  const matched=status==='matched_exact';
  const review=status==='review_required';
  const statusClass=matched||status==='applied'||status==='already_applied'||status==='refunded'?'online':review?'risk':'';
  const merchant=event.merchant_id?adminMerchantName(event.merchant_id):'Sem revenda vinculada';
  return `<article class="order-card">
    <div class="order-head"><div><div class="order-id">${esc(event.provider)} • ${esc(event.provider_event_id)}</div><div class="tiny muted">${esc(event.received_at?new Date(event.received_at).toLocaleString('pt-BR'):'—')} • ${esc(merchant)}</div></div><span class="status-pill ${statusClass}">${esc(adminBillingPaymentEventLabel(status))}</span></div>
    <div class="order-line"><strong>Pagamento:</strong> ${adminMoney(event.amount_cents)} • ${esc(adminPaymentMethodLabel(event.payment_method))}</div>
    <div class="tiny muted">ID conciliável: ${esc(event.reconciliation_key)}${event.payer_reference?' • pagador '+esc(event.payer_reference):''}</div>
    ${event.match_reason?`<div class="tiny muted">Conciliação: ${esc(adminBillingPaymentMatchReasonLabel(event.match_reason))}</div>`:''}
    ${event.provider_correlation_id?`<div class="tiny muted">Correlação TAMÃO/PSP: ${esc(event.provider_correlation_id)}</div>`:''}
    ${matched&&event.payment_request_id?`<div class="notice success" style="margin-top:10px"><strong>Correspondência exata encontrada.</strong><br>Valor e identificador coincidem com uma solicitação pendente.</div><div class="order-actions"><button class="primary small" onclick="adminResolveBillingPaymentRequest('${esc(event.payment_request_id)}','approve','${esc(event.id)}')">Confirmar evento conciliado</button></div>`:''}
    ${review?`<div class="notice" style="margin-top:10px"><strong>Revisão obrigatória.</strong><br>O evento não movimentou saldo porque não houve correspondência exata e única.</div><div class="order-actions"><button class="secondary small" onclick="adminBillingPaymentEventAction('${esc(event.id)}','recheck')">Reprocessar conciliação</button><button class="ghost small" onclick="adminBillingPaymentEventAction('${esc(event.id)}','ignore')">Ignorar evento</button></div>`:''}
  </article>`;
}

function adminFinanceOverview(d){
  const billing=d.merchantBilling||{};
  const metrics=billing.metrics||{};
  const reconciliation=billing.reconciliation||{};
  const pendingReviews=(billing.paymentEvents||[]).filter(x=>x.status==='review_required').length
    +(billing.refunds||[]).filter(x=>x.status==='review_required').length;
  const e2e=adminBillingE2EState(d);
  const ingress=billing.paymentIngress||{};
  const pspLabel=e2e.validated?'Integração verificada':adminRuntime.providerHealth?.ok===true?'API validada':ingress.livePspReady?'Configurado':'Pendente';
  return `<section class="section admin-finance-overview">
    <div class="section-head"><div><span class="section-kicker">POSIÇÃO FINANCEIRA</span><h2>Visão executiva</h2><p>O que o TAMÃO tem a receber, o que está em risco e a situação real do PSP.</p></div><span class="status-pill ${Number(metrics.overdueStatementCount||0)||pendingReviews?'risk':'online'}">${Number(metrics.overdueStatementCount||0)||pendingReviews?'EXIGE ATENÇÃO':'SEM PENDÊNCIA CRÍTICA'}</span></div>
    <div class="admin-exec-grid finance">
      ${adminExecutiveKpi({icon:'R$',label:'D+1 em aberto',value:adminMoney(metrics.openStatementCents),detail:Number(metrics.openStatementCount||0)+' fechamento(s)',tone:Number(metrics.overdueStatementCount||0)?'warning':'money'})}
      ${adminExecutiveKpi({icon:'!',label:'Vencido',value:adminMoney(metrics.overdueStatementCents),detail:Number(metrics.overdueStatementCount||0)+' fechamento(s)',tone:Number(metrics.overdueStatementCount||0)?'danger':'neutral'})}
      ${adminExecutiveKpi({icon:'↗',label:'Aguardando conferência',value:adminMoney(metrics.pendingPaymentCents),detail:Number(metrics.pendingPaymentCount||0)+' pagamento(s)',tone:Number(metrics.pendingPaymentCount||0)?'warning':'neutral'})}
      ${adminExecutiveKpi({icon:'C',label:'Crédito pré-pago',value:adminMoney(metrics.prepaidCreditBalanceCents),detail:Number(metrics.prepaidAccountCount||0)+' conta(s)',tone:'money'})}
      ${adminExecutiveKpi({icon:'↺',label:'Refunds em revisão',value:String(pendingReviews),detail:adminMoney(metrics.refundRecoveryOutstandingCents||0)+' em recuperação',tone:pendingReviews?'danger':'neutral'})}
      ${adminExecutiveKpi({icon:'PSP',label:'Mercado Pago',value:esc(pspLabel),detail:reconciliation.healthy===true?'conciliação íntegra':'conciliação sob observação',tone:e2e.validated?'good':adminRuntime.providerHealth?.ok===true?'money':'warning'})}
    </div>
  </section>`;
}

function adminBillingMetricsView(metrics){
  if(!metrics)return '';
  const planMix=Array.isArray(metrics.planMix)?metrics.planMix:[];
  const sla=metrics.queueSla||{};
  const buckets=metrics.pendingAgeBuckets||{};
  const oldest=metrics.oldestPendingRequestedAt
    ? new Date(metrics.oldestPendingRequestedAt).toLocaleString('pt-BR')
    : null;
  const slaBreaches=Number(sla.breachCount||0);
  return `<div class="card flat" style="margin-bottom:16px">
    <div class="section-head"><div><h3>Cockpit financeiro</h3><p>Totais exatos calculados no servidor sobre toda a base, sem depender do limite das listas abaixo.</p></div><span class="status-pill ${Number(metrics.overdueStatementCount||0)>0?'offline':'online'}">${Number(metrics.overdueStatementCount||0)>0?'ATENÇÃO':'SAUDÁVEL'}</span></div>
    <div class="merchant-kpis">
      <div class="kpi"><span class="label">Crédito em circulação</span><strong>${adminMoney(metrics.prepaidCreditBalanceCents)}</strong><small>${Number(metrics.prepaidAccountCount||0)} conta(s) pré-paga(s)</small></div>
      <div class="kpi"><span class="label">Reservado em pedidos</span><strong>${adminMoney(metrics.prepaidCreditReservedCents)}</strong><small>disponível ${adminMoney(metrics.prepaidCreditAvailableCents)}</small></div>
      <div class="kpi"><span class="label">D+1 em aberto</span><strong>${adminMoney(metrics.openStatementCents)}</strong><small>${Number(metrics.openStatementCount||0)} fechamento(s)</small></div>
      <div class="kpi"><span class="label">Vencido</span><strong>${adminMoney(metrics.overdueStatementCents)}</strong><small>${Number(metrics.overdueStatementCount||0)} fechamento(s)</small></div>
      <div class="kpi"><span class="label">Vence em até 24h</span><strong>${adminMoney(metrics.dueWithin24hCents)}</strong><small>${Number(metrics.dueWithin24hCount||0)} fechamento(s)</small></div>
      <div class="kpi"><span class="label">Aguardando conferência</span><strong>${adminMoney(metrics.pendingPaymentCents)}</strong><small>${Number(metrics.pendingPaymentCount||0)} pagamento(s)</small></div>
      <div class="kpi"><span class="label">Recuperações de refund</span><strong>${adminMoney(metrics.refundRecoveryOutstandingCents||0)}</strong><small>${Number(metrics.refundRecoveryOutstandingCount||0)} obrigação(ões) em aberto • ${Number(sla.refundRecoveryOpenBreachCount||0)} fora de 24h</small></div>
      <div class="kpi"><span class="label">Conciliados prontos</span><strong>${Number(sla.matchedAwaitingApprovalCount||0)}</strong><small>${Number(sla.matchedApprovalBreachCount||0)} fora do SLA de ${Number(sla.matchedApprovalTargetHours||2)}h</small></div>
      <div class="kpi"><span class="label">Eventos em revisão</span><strong>${Number(sla.reviewEventCount||0)}</strong><small>${Number(sla.reviewEventBreachCount||0)} fora do SLA de ${Number(sla.eventReviewTargetHours||4)}h</small></div>
      <div class="kpi"><span class="label">SLA financeiro</span><strong>${slaBreaches}</strong><small>${slaBreaches?'item(ns) exigem prioridade':'fila dentro do prazo'}</small></div>
      <div class="kpi"><span class="label">Vendas em hold</span><strong>${Number(metrics.salesHoldCount||0)}</strong><small>de ${Number(metrics.accountCount||0)} conta(s)</small></div>
    </div>
    <div class="tiny muted" style="margin-top:10px">Pacotes a conferir: ${Number(metrics.pendingPackageCount||0)} • ${adminMoney(metrics.pendingPackageCents)} · D+1 informado: ${Number(metrics.pendingStatementPaymentCount||0)} • ${adminMoney(metrics.pendingStatementPaymentCents)} · recuperação informada: ${Number(metrics.pendingRefundRecoveryCount||0)} • ${adminMoney(metrics.pendingRefundRecoveryCents||0)}${oldest?' · solicitação pendente mais antiga: '+esc(oldest):''}</div>
    <div class="tiny muted" style="margin-top:6px">Idade da fila: &lt;1h ${Number(buckets.under1hCount||0)} · 1–4h ${Number(buckets.from1To4hCount||0)} · 4–24h ${Number(buckets.from4To24hCount||0)} · &gt;24h ${Number(buckets.over24hCount||0)} (${adminMoney(buckets.over24hCents||0)})</div>
    ${slaBreaches?`<div class="notice" style="margin-top:10px"><strong>SLA financeiro vencido.</strong><br>Priorize pagamentos já conciliados há mais de ${Number(sla.matchedApprovalTargetHours||2)}h, eventos em revisão há mais de ${Number(sla.eventReviewTargetHours||4)}h, obrigações de recuperação ainda sem tentativa de pagamento há mais de ${Number(sla.refundRecoveryOpenTargetHours||24)}h e avisos sem conciliação há mais de ${Number(sla.pendingEscalationHours||24)}h. Nenhum item é cancelado automaticamente.</div>`:''}
    ${planMix.length?`<div class="order-actions" style="margin-top:10px">${planMix.map(p=>`<span class="status-pill">${esc(p.displayName||p.planKey)}: ${Number(p.accountCount||0)} conta(s) • ${(Number(p.platformFeeBps||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}%</span>`).join('')}</div>`:''}
    <div class="notice" style="margin-top:10px"><strong>Leitura contábil.</strong><br>Crédito em circulação é saldo pré-pago ainda disponível para taxas; “aguardando conferência” é apenas valor informado pela revenda e não vira crédito nem quitação até aprovação administrativa.</div>
  </div>`;
}

function adminBillingReconciliationMessage(issue){
  const labels={
    account_ledger_balance_mismatch:'Saldo da conta diverge do razão de créditos.',
    account_reserved_order_mismatch:'Reserva financeira diverge dos pedidos ainda não liquidados.',
    flex_with_prepaid_credit:'Conta em Flex ainda carrega crédito ou reserva pré-paga.',
    approved_package_without_ledger_credit:'Pacote aprovado sem crédito correspondente no ledger.',
    linked_package_credit_not_approved:'Crédito de pacote ligado a uma solicitação que não está aprovada.',
    approved_statement_not_paid:'Pagamento D+1 aprovado sem fechamento marcado como pago.',
    pending_statement_terms_changed:'Aviso de pagamento está pendente, mas os termos do fechamento mudaram.',
    resolved_statement_has_open_receivable:'Fechamento resolvido ainda possui recebível aberto.',
    overdue_without_sales_hold:'Fechamento vencido ainda não gerou hold de novas vendas.',
    sales_hold_without_overdue_statement:'Hold financeiro existe sem fechamento vencido correspondente.',
    pending_payment_review_over_24h:'Aviso de pagamento sem conciliação exata aguarda ação há mais de 24 horas.',
    matched_payment_approval_sla_over_2h:'Pagamento já conciliado aguarda confirmação do Financeiro há mais de 2 horas.',
    payment_event_review_sla_over_4h:'Evento de pagamento permanece em revisão há mais de 4 horas.',
    refund_review_recovery_mismatch:'Refund ligado não possui obrigação de recuperação exata e coerente.',
    refund_recovery_request_mismatch:'Obrigação de recuperação diverge da solicitação financeira vinculada.',
    resolved_refund_without_recovered_obligation:'Refund foi marcado como recuperado sem obrigação + pagamento aprovados.',
    recovered_obligation_refund_not_resolved:'Obrigação foi recuperada, mas o refund não foi encerrado de forma coerente.',
    refund_review_without_sales_hold:'Refund ligado está em revisão sem hold efetivo de novas vendas.',
    refund_hold_without_review:'Existe hold de refund sem refund vinculado ainda em revisão.',
    refund_recovery_open_over_24h:'Obrigação de recuperação está aberta há mais de 24 horas sem tentativa de pagamento.'
  };
  return labels[String(issue?.issueType||'')]||String(issue?.issueType||'Divergência financeira');
}

function adminBillingReconciliationView(reconciliation){
  if(!reconciliation)return '';
  const issues=Array.isArray(reconciliation.issues)?reconciliation.issues:[];
  const critical=Number(reconciliation.criticalCount||0);
  const warnings=Number(reconciliation.warningCount||0);
  const healthy=reconciliation.healthy===true&&critical===0&&warnings===0;
  const issueRows=issues.map(issue=>{
    const severity=String(issue.severity||'warning');
    const merchant=adminMerchantName(issue.merchantId);
    const expected=Number(issue.expectedCents||0);
    const actual=Number(issue.actualCents||0);
    const amountDiff=expected!==actual
      ? `<div class="tiny muted">Esperado: ${adminMoney(expected)} • atual: ${adminMoney(actual)}</div>`
      : '';
    const age=Number(issue.ageHours);
    return `<div class="list-row"><div><strong>${esc(adminBillingReconciliationMessage(issue))}</strong><br><small>${esc(merchant)} • ${esc(issue.entityId||'—')}${Number.isFinite(age)?' • '+age.toLocaleString('pt-BR',{maximumFractionDigits:1})+'h':''}</small>${amountDiff}</div><span class="status-pill ${severity==='critical'?'offline':'risk'}">${severity==='critical'?'CRÍTICO':'ATENÇÃO'}</span></div>`;
  }).join('');
  return `<div class="card flat" style="margin-bottom:16px">
    <div class="section-head"><div><h3>Reconciliação financeira</h3><p>Auditoria independente entre conta, ledger, reservas de pedidos, solicitações de pagamento, fechamentos D+1, refunds e obrigações de recuperação.</p></div><span class="status-pill ${healthy?'online':'offline'}">${healthy?'ÍNTEGRA':critical+' crítico(s)'}</span></div>
    <div class="tiny muted">Divergências: ${Number(reconciliation.issueCount||0)} • críticas: ${critical} • alertas: ${warnings} • pagamentos aguardando revisão há mais de 24h: ${Number(reconciliation.stalePendingReviewCount||0)} • recuperações abertas >24h: ${Number(reconciliation.refundRecoveryOpenSlaBreachCount||0)}</div>
    ${issueRows?`<div class="list" style="margin-top:10px">${issueRows}</div>`:'<div class="notice success" style="margin-top:10px"><strong>Conciliação fechada.</strong><br>Nenhuma divergência encontrada entre os registros financeiros auditados.</div>'}
    ${Number(reconciliation.issueCount||0)>issues.length?`<div class="tiny muted" style="margin-top:8px">Mostrando as primeiras ${issues.length} divergências de ${Number(reconciliation.issueCount||0)}.</div>`:''}
  </div>`;
}

function adminBillingRefundReasonLabel(reason){
  return ({
    original_payment_not_found:'pagamento original não localizado no TAMÃO',
    refund_before_finance_approval:'refund chegou antes da aprovação financeira',
    refund_before_finance_approval_manual_reference:'refund antes da aprovação identificado pela referência manual da revenda',
    multiple_manual_payment_candidates:'mais de uma solicitação manual usa o mesmo identificador bancário',
    partial_refund_confirmed:'reembolso parcial confirmado pelo PSP',
    full_refund_confirmed:'reembolso total confirmado pelo PSP',
    refund_total_exceeds_original:'soma de reembolsos excede o pagamento original',
    refund_of_recovery_payment:'reembolso de um pagamento usado para quitar recuperação anterior'
  })[String(reason||'')]||String(reason||'—');
}
function adminBillingRefundCard(refund){
  const billing=adminRuntime.data?.merchantBilling||{};
  const recoveries=billing.refundRecoveries||[];
  const requests=billing.paymentRequests||[];
  const recovery=recoveries.find(x=>x.refund_id===refund.id)||null;
  const reopenedRecovery=refund.reopened_refund_recovery_id
    ?recoveries.find(x=>x.id===refund.reopened_refund_recovery_id)||null
    :null;
  const recoveryRequest=recovery?.recovery_payment_request_id
    ?requests.find(x=>x.id===recovery.recovery_payment_request_id)||null
    :null;
  const review=refund.status==='review_required';
  const linked=Boolean(refund.payment_request_id&&refund.merchant_id);
  const original=refund.original_payment_amount_cents==null
    ?null:Number(refund.original_payment_amount_cents);
  const cumulative=refund.cumulative_refunded_cents==null
    ?null:Number(refund.cumulative_refunded_cents);
  const progress=original&&cumulative!=null
    ?` • acumulado ${adminMoney(cumulative)} / ${adminMoney(original)}`
    :'';
  const persistedRecoverable=refund.recoverable_amount_cents==null
    ?null:Number(refund.recoverable_amount_cents);
  const persistedExcess=refund.excess_amount_cents==null
    ?null:Number(refund.excess_amount_cents);
  const statusLabel=({
    review_required:'REVISÃO',
    resolved_recovered:
      persistedExcess>0?'EXPOSIÇÃO RECUPERADA':'RECUPERADO',
    ignored_unrelated:'NÃO RELACIONADO',
    resolved_excess:'EXCESSO RECONHECIDO',
    resolved_preapproval:'DEVOLVIDO ANTES DA APROVAÇÃO',
    resolved_recovery_reopened:'RECUPERAÇÃO REABERTA'
  })[String(refund.status||'')]||String(refund.status||'—').toUpperCase();

  let recoveryState='';
  if(review&&linked){
    const refunded=Number(refund.amount_cents||0);
    const recoverable=Number(
      recovery?.outstanding_cents
      ??persistedRecoverable
      ??recovery?.amount_cents
      ??0
    );
    const excess=persistedExcess==null
      ?Math.max(0,refunded-recoverable)
      :persistedExcess;
    if(!recovery&&refund.match_reason==='refund_total_exceeds_original'){
      recoveryState='<div class="notice" style="margin-top:8px"><strong>Exposição original já totalmente coberta.</strong><br>Este fato do PSP permanece auditável, mas nenhum valor adicional foi convertido em dívida. O Financeiro precisa reconhecer o excesso para encerrar a revisão e liberar o hold quando não houver outra pendência.</div>';
    }else if(!recovery){
      recoveryState='<div class="notice danger" style="margin-top:8px"><strong>Obrigação de recuperação ausente.</strong><br>Este refund está ligado e ainda possui exposição econômica, mas a obrigação não apareceu. Não encerre manualmente; atualize/reconcilie o backend.</div>';
    }else if(recovery.status==='open'){
      recoveryState=`<div class="notice" style="margin-top:8px"><strong>Obrigação aberta: ${adminMoney(recoverable)}.</strong><br>A revenda precisa pagar somente a exposição recuperável. O hold permanece ativo e uma referência administrativa sozinha não resolve o caso.${excess>0?' Excesso do PSP não convertido em dívida: '+adminMoney(excess)+'.':''}</div>`;
    }else if(recovery.status==='payment_pending'){
      recoveryState=`<div class="notice risk" style="margin-top:8px"><strong>Pagamento de recuperação pendente: ${adminMoney(recoverable)}.</strong><br>${recoveryRequest?'Solicitação '+esc(recoveryRequest.id)+' está na fila financeira.':'A obrigação possui solicitação vinculada; atualize a fila para conferir.'} Aprove somente após valor exato + identificador da transação.${excess>0?' Excesso fora da obrigação: '+adminMoney(excess)+'.':''}</div>`;
    }else if(recovery.status==='recovered'){
      recoveryState=`<div class="notice success" style="margin-top:8px"><strong>Recuperação economicamente comprovada.</strong><br>O pagamento de ${adminMoney(recoverable)} foi aprovado pela autoridade financeira.${excess>0?' O excesso de '+adminMoney(excess)+' não virou dívida.':''}</div>`;
    }
  }

  const actions=review&&!linked
    ?`<div class="order-actions"><button class="ghost small" onclick="adminResolveBillingRefund('${esc(refund.id)}','dismiss-unrelated')">Marcar não relacionado</button></div>`
    :review&&linked&&refund.match_reason==='refund_total_exceeds_original'&&!recovery
      ?`<div class="order-actions"><button class="secondary small" onclick="adminResolveBillingRefund('${esc(refund.id)}','dismiss-excess')">Reconhecer excesso do PSP</button></div>`
      :'';

  return `<article class="order-card">
    <div class="order-head"><div><strong>${linked?esc(adminMerchantName(refund.merchant_id)):'Refund sem vínculo TAMÃO'}</strong><br><small>${esc(refund.provider||'—')} • ${esc(formatDateTime(refund.occurred_at))}</small></div><span class="status-pill ${review?'offline':'online'}">${esc(statusLabel)}</span></div>
    <div class="tiny muted">Refund: ${esc(refund.refund_reconciliation_key||'—')} • original: ${esc(refund.original_reconciliation_key||'—')}</div>
    <div class="tiny muted">Valor devolvido: ${adminMoney(refund.amount_cents)}${progress}</div>
    ${linked&&persistedRecoverable!=null&&persistedExcess!=null
      ?refund.status==='resolved_preapproval'
        ?`<div class="tiny muted">Alocação econômica: recuperável R$ 0,00 • não recuperável porque nenhum benefício foi concedido ${adminMoney(persistedExcess)} • prova ${adminMoney(persistedRecoverable+persistedExcess)} = refund</div>`
        :`<div class="tiny muted">Alocação econômica: recuperável ${adminMoney(persistedRecoverable)} • excedente não cobrável ${adminMoney(persistedExcess)} • prova ${adminMoney(persistedRecoverable+persistedExcess)} = refund</div>`
      :''}
    <div class="tiny muted">Motor: ${esc(adminBillingRefundReasonLabel(refund.match_reason))}</div>
    ${linked&&!refund.payment_event_id?`<div class="tiny muted">Âncora financeira: confirmação Pix manual exata (sem payment_event original). EndToEndId e valor foram conferidos contra a solicitação.</div>`:''}
    ${refund.status==='resolved_preapproval'?'<div class="notice success" style="margin-top:8px"><strong>Sem exposição da revenda.</strong><br>O PSP devolveu o pagamento antes da aprovação financeira. A solicitação foi cancelada automaticamente; nenhum crédito, quitação ou obrigação de recuperação foi criado.</div>':''}
    ${refund.status==='resolved_recovery_reopened'&&reopenedRecovery?`<div class="notice" style="margin-top:8px"><strong>Pagamento da recuperação foi reembolsado pelo PSP.</strong><br>A obrigação original foi reaberta sem criar uma dívida encadeada. Saldo atual: ${adminMoney(reopenedRecovery.outstanding_cents)} de ${adminMoney(reopenedRecovery.amount_cents)} originalmente alocados.</div>`:''}
    ${recovery?`<div class="tiny muted">Obrigação de recuperação: ${esc(recovery.id)} • saldo ${adminMoney(recovery.outstanding_cents)} / alocado ${adminMoney(recovery.amount_cents)} • ${esc(String(recovery.status||'—').toUpperCase())}</div>`:''}
    ${refund.resolution_reference?`<div class="tiny muted">Resolução: ${esc(refund.resolution_reference)}</div>`:''}
    ${review&&linked?'<div class="notice danger" style="margin-top:8px"><strong>Hold financeiro ativo.</strong><br>Novas vendas e novos benefícios financeiros permanecem suspensos até a recuperação comprovada.</div>':''}
    ${recoveryState}
    ${actions}
  </article>`;
}

function adminBillingProviderChargeRow(charge){
  const cancelRetry=charge.status==='cancelled'
    &&['PROVIDER_CANCEL_REQUIRED','PROVIDER_CANCEL_FAILED'].includes(String(charge.last_error_code||''));
  const retryButton=cancelRetry&&charge.payment_request_id
    ? `<br><button class="secondary small" style="margin-top:6px" onclick="adminRetryBillingProviderCancel('${esc(charge.payment_request_id)}')">Repetir cancelamento no PSP</button>`
    : '';
  const pendingNote=cancelRetry
    ? '<br><small>Cancelamento externo pendente; a cobrança local já está encerrada.</small>'
    : '';
  return `<div class="list-row"><div><strong>${esc(adminMerchantName(charge.merchant_id))}</strong><br><small>${esc(charge.provider||'—')} • correlação ${esc(charge.correlation_id||'—')}${charge.end_to_end_id?' • EndToEndId '+esc(charge.end_to_end_id):''}</small>${pendingNote}</div><div style="text-align:right"><strong>${adminMoney(charge.amount_cents)}</strong><br><span class="status-pill ${charge.status==='completed'?'online':charge.last_error_code?'offline':charge.status==='expired'||charge.status==='cancelled'?'':'risk'}">${esc(String(charge.status||'—').toUpperCase())}</span>${charge.expired_at?`<br><small>expirou ${esc(formatDateTime(charge.expired_at))}</small>`:''}${charge.last_error_code?`<br><small>${esc(charge.last_error_code)}</small>`:''}${retryButton}</div></div>`;
}


function adminBillingProviderName(value){
  const provider=String(value||'').trim().toLowerCase();
  return ({
    mercadopago:'Mercado Pago',
    pagbank:'PagBank',
    stone:'Stone',
    getnet:'Getnet',
    pagarme:'Pagar.me',
    asaas:'Asaas',
    cielo:'Cielo',
    rede:'Rede',
    woovi:'Woovi/OpenPix',
    nubank:'Nu Empresas',
    manual:'Sem integração automática'
  })[provider]||(provider||'PSP ativo');
}
function adminBillingProviderCredentialLabel(value){
  return String(value||'').trim().toLowerCase()==='mercadopago'?'Access Token':'credencial API';
}
function adminBillingE2EState(d=adminRuntime.data){
  const billing=d?.merchantBilling||{};
  const ingress=billing.paymentIngress||{};
  const active=String(ingress.activeBillingProvider||adminRuntime.providerHealth?.provider||'').trim().toLowerCase();
  if(!active)return {validated:false,event:null,provider:null};
  const events=Array.isArray(billing.paymentEvents)?billing.paymentEvents:[];
  const event=events.find(x=>String(x.provider||'').trim().toLowerCase()===active
    &&['matched_exact','applied','already_applied','refunded'].includes(String(x.status||'')))||null;
  return {validated:Boolean(event),event,provider:active};
}
function adminBillingProviderHealthNotice(h){
  if(!h)return '';
  const ok=h.ok===true;
  const provider=adminBillingProviderName(h.provider);
  const e2e=adminBillingE2EState();
  let detail='';
  if(h.provider==='mercadopago'){
    const verifiedAt=h.remoteWebhookVerifiedAt?formatDateTime(h.remoteWebhookVerifiedAt):null;
    detail='Access Token '+(h.credentialValid===true?'válido':h.credentialValid===false?'inválido':'não confirmado')
      +' • criação '+(h.chargeReady?'pronta':'não confirmada')
      +' • webhook HMAC local '+(h.receiveReady?'configurado':'não confirmado')
      +' • conta '+(h.accountBound?'vinculada':'não confirmada')
      +' • registro remoto do webhook '+(h.remoteWebhookRegistrationVerified===true?'verificado'+(verifiedAt?' em '+verifiedAt:''):'ainda não comprovado por notificação assinada');
  }else{
    detail='credencial '+(h.credentialValid===true?'válida':h.credentialValid===false?'inválida':'não confirmada')
      +' • webhook pagamento '+(h.chargeWebhookReady?'ativo':'não confirmado')
      +' • expiração '+(h.chargeExpiredWebhookReady?'ativa':'não confirmada')
      +' • refund '+(h.refundWebhookReady?'ativo':'não confirmado')
      +' • empresa '+(h.companyBound?'vinculada':'não confirmada');
  }
  if(h.reason)detail+=' • '+esc(h.reason);
  const e2eCopy=e2e.validated
    ?' • webhook financeiro real observado e conciliado'
    :' • validação transacional ainda pendente';
  return '<div class="notice '+(ok?'success':'danger')+'" style="margin-top:10px"><strong>'+(ok?'API '+provider+' validada.':'Integração '+provider+' requer atenção.')+'</strong><br>'+detail+e2eCopy+'</div>';
}

function adminMerchantPaymentAdapterLabel(status){
  return ({
    implemented:'IMPLEMENTADO',
    ready_for_credentials:'PREPARADO',
    manual_only:'MANUAL',
    planned:'PLANEJADO'
  })[String(status||'')]||String(status||'—').toUpperCase();
}
function adminMerchantPaymentVerificationLabel(value){
  return ({
    provider:'PROVEDOR',
    device:'TERMINAL',
    merchant:'MANUAL'
  })[String(value||'')]||String(value||'—').toUpperCase();
}
function adminPaymentPreflightKey(merchantId,provider){
  return String(merchantId||'')+'|'+String(provider||'').toLowerCase();
}
async function adminRunMerchantPaymentPreflight(merchantId,provider,{silent=false}={}){
  const providerKey=String(provider||'').toLowerCase();
  const key=adminPaymentPreflightKey(merchantId,providerKey);
  try{
    const result=await adminInvoke({
      action:'merchant-payment-preflight',
      merchantId,
      provider:providerKey
    });
    adminRuntime.paymentPreflights[key]={
      ...result,
      checkedAt:new Date().toISOString()
    };
    if(!silent)render();
    return adminRuntime.paymentPreflights[key];
  }catch(error){
    adminRuntime.paymentPreflights[key]={
      ok:false,
      readyForActivation:false,
      error:String(error?.message||error),
      checkedAt:new Date().toISOString(),
      gates:[]
    };
    if(!silent)render();
    throw error;
  }
}
function adminMerchantPaymentPreflightView(merchantId,provider){
  const state=adminRuntime.paymentPreflights[adminPaymentPreflightKey(merchantId,provider)]||null;
  if(!state)return '<div class="tiny muted" style="margin-top:8px">Verificação de ativação ainda não executada nesta sessão.</div>';
  const gates=Array.isArray(state.gates)?state.gates:[];
  const blocked=gates.filter(g=>g?.ok!==true);
  const rows=gates.map(g=>
    '<div class="list-row"><div><strong>'+esc(g.label||g.key||'Gate')+'</strong><br><small>'+esc(g.detail||'—')+'</small></div><span class="status-pill '+(g.ok===true?'online':'offline')+'">'+(g.ok===true?'OK':'BLOQUEADO')+'</span></div>'
  ).join('');
  const summary=state.readyForActivation===true
    ?'<div class="notice success" style="margin-top:8px"><strong>Verificação de ativação aprovada.</strong><br>Todos os requisitos obrigatórios estão atendidos. O estado será conferido novamente antes da ativação.</div>'
    :'<div class="notice danger" style="margin-top:8px"><strong>Ativação bloqueada.</strong><br>'+blocked.length+' requisito(s) ainda precisam ser resolvidos. Nenhuma configuração financeira foi alterada.</div>';
  return summary
    +'<details class="card flat" style="margin-top:8px"><summary><strong>Checklist técnico ('+(gates.length-blocked.length)+'/'+gates.length+')</strong></summary><div class="list" style="margin-top:8px">'+(rows||'<div class="tiny muted">Sem gates retornados.</div>')+'</div><div class="tiny muted" style="margin-top:8px">Verificado '+esc(adminRelativeTime(state.checkedAt))+'.</div></details>';
}

function adminMerchantPaymentAccountCard({merchant,account}){
  const provider=String(account?.provider||'').toLowerCase();
  const providerName=adminBillingProviderName(provider);
  const catalog=(adminRuntime.data?.merchantPayments?.providerCatalog||[])
    .find(x=>x.provider_key===provider)||null;
  const connected=account?.status==='active';
  const directEnabled=account?.capabilities?.directSalePaymentsEnabled===true;
  const canValidate=account?.capabilities?.canValidateProviderTransactions===true;
  const e2eValidated=account?.capabilities?.e2eValidated===true;
  const homologated=connected&&directEnabled&&canValidate&&e2eValidated;
  const pilotActive=connected&&directEnabled&&canValidate&&!e2eValidated;
  const inconsistent=connected&&directEnabled&&!canValidate;
  const globalEnabled=adminRuntime.data?.merchantPayments?.globalDirectPaymentsEnabled===true;
  const accountRef=String(account?.provider_account_id||'');
  const safeAccountRef=accountRef?('•••• '+accountRef.slice(-6)):'—';
  const adapterImplemented=catalog?.adapter_status==='implemented';
  const statusLabel=!connected
    ?String(account?.status||'NÃO CONECTADO').toUpperCase()
    :homologated?'INTEGRAÇÃO VERIFICADA'
      :pilotActive?'AUTOMAÇÃO ATIVA'
        :inconsistent?'INCONSISTENTE'
          :adapterImplemented?'PRONTO PARA ATIVAR':'CONECTADO';
  const statusClass=homologated&&globalEnabled?'online':inconsistent?'offline':connected?'risk':'';
  let notice='';
  if(!connected){
    notice='<div class="notice" style="margin-top:8px">A conexão deste provedor não está ativa.</div>';
  }else if(homologated){
    notice='<div class="notice success" style="margin-top:8px"><strong>Integração de pagamento verificada.</strong><br>Já existe evidência transacional confirmada pelo provedor/terminal para esta revenda. O dinheiro continua indo diretamente para a revenda.</div>';
  }else if(pilotActive){
    notice='<div class="notice" style="margin-top:8px"><strong>Confirmação automática ativa.</strong><br>A integração está liberada e aguarda a primeira transação liquidada para registrar a verificação operacional do provedor/terminal.</div>';
  }else if(inconsistent){
    notice='<div class="notice danger" style="margin-top:8px"><strong>Estado inconsistente.</strong><br>A capability de pagamento direto está ativa sem autoridade de validação do provedor. Suspenda a automação e revise a integração.</div>';
  }else if(adapterImplemented){
    notice='<div class="notice" style="margin-top:8px"><strong>Conta conectada, automação ainda desativada.</strong><br>Execute a verificação de ativação e habilite a confirmação automática quando todos os requisitos estiverem atendidos.</div>';
  }else{
    notice='<div class="notice" style="margin-top:8px"><strong>Conta conectada; automação ainda indisponível para este provedor.</strong><br>A revenda pode continuar usando a forma de recebimento cadastrada enquanto a confirmação automática não estiver disponível.</div>';
  }
  const directActive=homologated||pilotActive||inconsistent;
  const preflight=adminRuntime.paymentPreflights[adminPaymentPreflightKey(merchant.id,provider)]||null;
  const preflightReady=preflight?.readyForActivation===true;
  const action=connected&&adapterImplemented
    ?directActive
      ?'<div class="order-actions"><button class="danger-btn small" onclick="adminSetMerchantPaymentCapability(\''+esc(merchant.id)+'\',\''+esc(provider)+'\',false)">Suspender confirmação automática</button></div>'
      :'<div class="order-actions"><button class="secondary small" onclick="adminRunMerchantPaymentPreflight(\''+esc(merchant.id)+'\',\''+esc(provider)+'\').catch(e=>toast(String(e?.message||e)))">Verificar ativação</button><button class="primary small" '+(preflightReady?'':'disabled title="Conclua a verificação antes da ativação"')+' onclick="adminSetMerchantPaymentCapability(\''+esc(merchant.id)+'\',\''+esc(provider)+'\',true)">'+(e2eValidated?'Reativar confirmação automática':'Ativar confirmação automática')+'</button></div>'
    :'';
  return '<article class="order-card">'
    +'<div class="order-head"><div><div class="order-id">'+esc(merchant?.name||merchant?.id||'Revenda')+'</div><div class="tiny muted">'+esc(providerName)+' • conta '+esc(safeAccountRef)+'</div></div><span class="status-pill '+statusClass+'">'+esc(statusLabel)+'</span></div>'
    +notice
    +'<div class="tiny muted" style="margin-top:8px">Verificação: <strong>'+esc(adminMerchantPaymentVerificationLabel(account?.verification_level||catalog?.verification_level))+'</strong> • adaptador: '+esc(adminMerchantPaymentAdapterLabel(catalog?.adapter_status))+' • validação do provedor: <strong>'+(canValidate?'ATIVA':'BLOQUEADA')+'</strong> • integração verificada: <strong>'+(e2eValidated?'VALIDADA':'PENDENTE')+'</strong> • controle global: <strong>'+(globalEnabled?'ATIVO':'DESATIVADO')+'</strong>'+(account?.connected_at?' • desde '+esc(formatDateTime(account.connected_at)):'')+'</div>'
    +(!directActive&&connected&&adapterImplemented?adminMerchantPaymentPreflightView(merchant.id,provider):'')
    +action
    +'</article>';
}
function adminMerchantPaymentProviderCatalog(d){
  const providers=(d.merchantPayments?.providerCatalog||[]).filter(x=>x.provider_key!=='manual');
  if(!providers.length)return '';
  return '<div class="admin-entity-grid admin-provider-catalog">'
    +providers.map(provider=>{
      const implemented=provider.adapter_status==='implemented';
      const prepared=provider.adapter_status==='ready_for_credentials';
      const cls=implemented?'online':prepared?'risk':'';
      return '<article class="card flat"><div class="order-head"><div><strong>'+esc(provider.display_name)+'</strong><br><small>'+esc(adminMerchantPaymentVerificationLabel(provider.verification_level))+' • '+esc(String(provider.connection_mode||'').toUpperCase())+'</small></div><span class="status-pill '+cls+'">'+esc(adminMerchantPaymentAdapterLabel(provider.adapter_status))+'</span></div><div class="tiny muted">Métodos: '+esc((provider.supported_methods||[]).join(' • ')||'—')+'</div></article>';
    }).join('')
    +'</div>';
}
function adminMerchantDeclaredPspRadar(d){
  const routes=Array.isArray(d.merchantPayments?.routes)?d.merchantPayments.routes:[];
  const catalog=Array.isArray(d.merchantPayments?.providerCatalog)?d.merchantPayments.providerCatalog:[];
  const declared=routes.filter(route=>
    route?.active===true
    &&route?.provider!=='manual'
    &&route?.verification_mode==='merchant_confirmed'
    &&(
      route?.metadata?.merchantDeclaredProvider===true
      ||(route?.connection_id==null&&route?.channel==='external')
    )
  );
  if(!declared.length){
    return '<div class="card flat" style="margin-top:12px"><div class="order-head"><div><strong>Demanda real por PSP</strong><br><small>Nenhuma revenda declarou um provedor externo em uso manual ainda.</small></div><span class="status-pill">0 DECLARAÇÕES</span></div><div class="tiny muted" style="margin-top:8px">Quando uma revenda marcar “Eu uso este PSP”, ela aparecerá aqui sem expor credenciais nem movimentar dinheiro.</div></div>';
  }
  const groups=new Map();
  for(const route of declared){
    const key=String(route.provider||'').toLowerCase();
    if(!groups.has(key))groups.set(key,{provider:key,merchantMethods:new Map(),routes:0});
    const group=groups.get(key);
    group.routes++;
    const merchantId=String(route.merchant_id||'');
    if(!group.merchantMethods.has(merchantId))group.merchantMethods.set(merchantId,new Set());
    group.merchantMethods.get(merchantId).add(String(route.payment_method||'').toLowerCase());
  }
  const ranked=[...groups.values()].sort((a,b)=>
    b.merchantMethods.size-a.merchantMethods.size
    ||b.routes-a.routes
    ||a.provider.localeCompare(b.provider,'pt-BR')
  );
  const cards=ranked.map(group=>{
    const definition=catalog.find(x=>x.provider_key===group.provider)||null;
    const providerName=definition?.display_name||adminBillingProviderName(group.provider);
    const adapter=adminMerchantPaymentAdapterLabel(definition?.adapter_status);
    const merchants=[...group.merchantMethods.entries()].map(([merchantId,methods])=>{
      const methodLabel=[...methods].map(method=>adminPaymentMethodLabel(method)).join(' • ');
      return '<div class="list-row"><span>'+esc(adminMerchantName(merchantId))+'</span><small>'+esc(methodLabel||'manual')+'</small></div>';
    }).join('');
    return '<article class="card flat"><div class="order-head"><div><strong>'+esc(providerName)+'</strong><br><small>Uso declarado pelas revendas</small></div><span class="status-pill risk">'+group.merchantMethods.size+' REVENDA'+(group.merchantMethods.size===1?'':'S')+'</span></div>'
      +'<div class="tiny muted" style="margin-top:8px">Adaptador: <strong>'+esc(adapter)+'</strong> • confirmação atual: <strong>MANUAL</strong> • credenciais: <strong>NÃO COLETADAS</strong></div>'
      +'<div class="list" style="margin-top:8px">'+merchants+'</div></article>';
  }).join('');
  const totalMerchants=new Set(declared.map(route=>String(route.merchant_id||''))).size;
  return '<div class="section-head" style="margin-top:14px"><div><span class="section-kicker">DEMANDA OBSERVADA</span><h3>PSPs realmente usados pelas revendas</h3><p>Este radar nasce das rotas manuais externas configuradas pela própria revenda. Use-o para priorizar integrações automáticas onde existe demanda real, sem exigir troca de provedor.</p></div><span class="status-pill risk">'+totalMerchants+' REVENDA'+(totalMerchants===1?'':'S')+'</span></div>'
    +'<div class="notice"><strong>Sinal de produto, não prova financeira.</strong><br>Essas declarações dizem qual PSP a revenda usa; não confirmam pagamento e nunca liberam checkout automático.</div>'
    +'<div class="admin-entity-grid">'+cards+'</div>';
}
function adminMerchantPspHomologationQueue(d){
  const catalog=(d.merchantPayments?.providerCatalog||[]).filter(x=>x.provider_key!=='manual');
  const routes=Array.isArray(d.merchantPayments?.routes)?d.merchantPayments.routes:[];
  const merchants=Array.isArray(d.merchants)?d.merchants:[];
  if(!catalog.length)return '';

  const declaredByProvider=new Map();
  for(const route of routes){
    if(
      route?.active!==true
      ||route?.provider==='manual'
      ||route?.verification_mode!=='merchant_confirmed'
      ||route?.connection_id!=null
      ||route?.channel!=='external'
    )continue;
    const provider=String(route.provider||'').toLowerCase();
    if(!declaredByProvider.has(provider))declaredByProvider.set(provider,new Set());
    declaredByProvider.get(provider).add(String(route.merchant_id||''));
  }

  const accountsByProvider=new Map();
  for(const merchant of merchants){
    for(const account of merchant.paymentAccounts||[]){
      const provider=String(account?.provider||'').toLowerCase();
      if(!provider)continue;
      if(!accountsByProvider.has(provider))accountsByProvider.set(provider,[]);
      accountsByProvider.get(provider).push({merchant,account});
    }
  }

  const models=catalog.map(definition=>{
    const provider=String(definition.provider_key||'').toLowerCase();
    const declaredMerchants=declaredByProvider.get(provider)?.size||0;
    const accountRows=accountsByProvider.get(provider)||[];
    const activeRows=accountRows.filter(row=>row.account?.status==='active');
    const homologatedRows=activeRows.filter(row=>
      row.account?.capabilities?.directSalePaymentsEnabled===true
      &&row.account?.capabilities?.canValidateProviderTransactions===true
      &&row.account?.capabilities?.e2eValidated===true
    );
    const pilotRows=activeRows.filter(row=>
      row.account?.capabilities?.directSalePaymentsEnabled===true
      &&row.account?.capabilities?.canValidateProviderTransactions===true
      &&row.account?.capabilities?.e2eValidated!==true
    );
    const inconsistentRows=activeRows.filter(row=>
      row.account?.capabilities?.directSalePaymentsEnabled===true
      &&row.account?.capabilities?.canValidateProviderTransactions!==true
    );
    const adapterStatus=String(definition.adapter_status||'planned');
    const implemented=adapterStatus==='implemented';
    const prepared=adapterStatus==='ready_for_credentials';
    const manualOnly=adapterStatus==='manual_only'||definition.connection_mode==='manual';

    let stage='PLANEJADO';
    let stageClass='';
    let nextAction='Planejar conector somente quando houver demanda observada.';
    if(inconsistentRows.length){
      stage='AÇÃO IMEDIATA';
      stageClass='offline';
      nextAction='Suspender a configuração inconsistente e repetir a verificação da integração.';
    }else if(homologatedRows.length){
      stage='INTEGRAÇÃO VERIFICADA';
      stageClass='online';
      nextAction='Monitorar saúde da integração, webhooks/lookups e conciliação.';
    }else if(pilotRows.length){
      stage='AUTOMAÇÃO ATIVA';
      stageClass='risk';
      nextAction='Acompanhar a primeira transação até liquidação; a evidência do provedor marcará a integração como verificada.';
    }else if(activeRows.length&&implemented){
      stage='PRONTO PARA ATIVAR';
      stageClass='risk';
      nextAction='Ativar confirmação automática; a primeira venda liquidada deve produzir a evidência transacional necessária para verificar a integração.';
    }else if(activeRows.length){
      stage='CONECTADO';
      stageClass='risk';
      nextAction='Concluir o adaptador do provedor e depois validar uma transação.';
    }else if(implemented){
      stage='IMPLEMENTADO';
      stageClass='risk';
      nextAction='Conectar a conta da revenda e executar a validação transacional.';
    }else if(prepared){
      stage='PREPARADO';
      nextAction='Finalizar credenciais/OAuth/terminal e implementar validação transacional.';
    }else if(manualOnly){
      stage='MANUAL';
      nextAction='Manter confirmação manual até existir integração oficial adequada.';
    }

    let priority='P3';
    let priorityOrder=3;
    if(inconsistentRows.length||pilotRows.length||activeRows.length&&implemented&&!homologatedRows.length){
      priority='P0';
      priorityOrder=0;
    }else if(declaredMerchants>=2){
      priority='P0';
      priorityOrder=0;
    }else if(declaredMerchants===1){
      priority='P1';
      priorityOrder=1;
    }else if(implemented){
      priority='P2';
      priorityOrder=2;
    }

    return {
      provider,
      displayName:definition.display_name||adminBillingProviderName(provider),
      definition,
      declaredMerchants,
      activeAccounts:activeRows.length,
      homologatedAccounts:homologatedRows.length,
      pilotAccounts:pilotRows.length,
      inconsistentAccounts:inconsistentRows.length,
      stage,
      stageClass,
      nextAction,
      priority,
      priorityOrder
    };
  }).sort((a,b)=>
    a.priorityOrder-b.priorityOrder
    ||b.inconsistentAccounts-a.inconsistentAccounts
    ||b.declaredMerchants-a.declaredMerchants
    ||b.activeAccounts-a.activeAccounts
    ||Number(a.definition.sort_order||999)-Number(b.definition.sort_order||999)
  );

  const cards=models.map(model=>{
    const demand=model.declaredMerchants
      ?model.declaredMerchants+' revenda'+(model.declaredMerchants===1?'':'s')+' declarou uso'
      :'sem demanda declarada';
    const accountSummary=model.activeAccounts
      ?model.activeAccounts+' conta'+(model.activeAccounts===1?'':'s')+' ativa'+(model.activeAccounts===1?'':'s')
      :'nenhuma conta conectada';
    const proof=model.homologatedAccounts
      ?model.homologatedAccounts+' verificada'+(model.homologatedAccounts===1?'':'s')
      :model.pilotAccounts
        ?model.pilotAccounts+' conta'+(model.pilotAccounts===1?'':'s')+' com automação ativa aguardando validação'
        :'0 verificadas';
    return '<article class="card flat">'
      +'<div class="order-head"><div><strong>'+esc(model.displayName)+'</strong><br><small>'+esc(demand)+' • '+esc(accountSummary)+'</small></div><div style="text-align:right"><span class="status-pill '+model.stageClass+'">'+esc(model.stage)+'</span><br><small>'+esc(model.priority)+'</small></div></div>'
      +'<div class="tiny muted" style="margin-top:8px">Adaptador: <strong>'+esc(adminMerchantPaymentAdapterLabel(model.definition.adapter_status))+'</strong> • modo: <strong>'+esc(String(model.definition.connection_mode||'—').toUpperCase())+'</strong> • '+esc(proof)+'</div>'
      +(model.inconsistentAccounts?'<div class="notice danger" style="margin-top:8px"><strong>'+model.inconsistentAccounts+' inconsistência'+(model.inconsistentAccounts===1?'':'s')+'.</strong><br>Pagamento direto não pode permanecer habilitado sem validação do provedor.</div>':'')
      +'<div class="notice" style="margin-top:8px"><strong>Próxima ação:</strong><br>'+esc(model.nextAction)+'</div>'
      +'</article>';
  }).join('');

  const p0=models.filter(x=>x.priority==='P0').length;
  const observed=models.filter(x=>x.declaredMerchants>0).length;
  return '<div class="section-head" style="margin-top:16px"><div><span class="section-kicker">INTEGRAÇÕES MULTI-PSP</span><h3>Fila técnica de provedores</h3><p>Prioridade calculada por risco operacional, contas prontas para validação transacional e demanda declarada. Sem demanda, o TAMÃO não força integração nem troca de PSP.</p></div><span class="status-pill '+(p0?'risk':'')+'">'+p0+' P0 • '+observed+' COM DEMANDA</span></div>'
    +'<div class="notice"><strong>Regra de autoridade.</strong><br>Conectar uma conta não significa validar a integração. O status de integração verificada só aparece após uma venda liquidada gerar evidência confirmada pelo provedor/terminal. O dinheiro continua pertencendo à revenda.</div>'
    +'<div class="admin-entity-grid">'+cards+'</div>';
}

function adminMerchantPilotIssueLabel(code){
  return ({
    PROVIDER_CHECKOUT_OUTCOME_UNKNOWN:'resultado remoto desconhecido',
    PROVIDER_CHECKOUT_RESPONSE_MISMATCH:'resposta divergente do PSP',
    PROVIDER_CHECKOUT_COMMIT_FAILED:'checkout remoto não consolidado localmente',
    PROVIDER_CHECKOUT_REJECTED:'PSP rejeitou a criação do checkout',
    LOCAL_CHECKOUT_PREPARATION_FAILED:'falha local antes do checkout'
  })[String(code||'')]||String(code||'sem erro registrado').replaceAll('_',' ').toLowerCase();
}
function adminMerchantPspPilotCenter(d){
  const attempts=(d.merchantPayments?.attempts||[]).filter(x=>x?.pilot_guard===true);
  const verifications=(d.merchantPayments?.verifications||[]).filter(x=>x?.status==='verified');
  const merchants=Array.isArray(d.merchants)?d.merchants:[];
  const orderById=new Map((d.controlOrders||[]).map(x=>[String(x.id),x]));
  const merchantById=new Map(merchants.map(x=>[String(x.id),x]));
  const accountByKey=new Map();
  const attemptByKey=new Map();
  const verificationByAttempt=new Map();

  for(const merchant of merchants){
    for(const account of merchant.paymentAccounts||[]){
      const provider=String(account?.provider||'').toLowerCase();
      if(!provider)continue;
      accountByKey.set(String(merchant.id)+'|'+provider,{merchant,account});
    }
  }
  for(const attempt of attempts){
    const key=String(attempt.merchant_id||'')+'|'+String(attempt.provider||'').toLowerCase();
    if(!attemptByKey.has(key))attemptByKey.set(key,[]);
    attemptByKey.get(key).push(attempt);
  }
  for(const rows of attemptByKey.values()){
    rows.sort((a,b)=>Date.parse(b.created_at||b.updated_at||0)-Date.parse(a.created_at||a.updated_at||0));
  }
  for(const verification of verifications){
    if(!verification.payment_attempt_id)continue;
    const key=String(verification.payment_attempt_id);
    const current=verificationByAttempt.get(key);
    if(!current||Date.parse(verification.verified_at||verification.created_at||0)>Date.parse(current.verified_at||current.created_at||0)){
      verificationByAttempt.set(key,verification);
    }
  }

  const keys=new Set(attemptByKey.keys());
  for(const [key,row] of accountByKey){
    const account=row.account||{};
    const caps=account.capabilities||{};
    if(
      account.status==='active'
      &&caps.canValidateProviderTransactions===true
      &&(caps.directSalePaymentsEnabled===true||caps.e2eValidated===true)
    )keys.add(key);
  }

  const LIVE=new Set(['preparing','checkout_ready','pending','approved','review_required']);
  const models=[...keys].map(key=>{
    const [merchantId,provider]=key.split('|');
    const accountRow=accountByKey.get(key)||{};
    const merchant=accountRow.merchant||merchantById.get(merchantId)||{id:merchantId,name:adminMerchantName(merchantId)};
    const account=accountRow.account||null;
    const allAttempts=attemptByKey.get(key)||[];
    const liveAttempt=allAttempts.find(x=>LIVE.has(String(x.status||'')))||null;
    const latestAttempt=liveAttempt||allAttempts[0]||null;
    const verification=latestAttempt?verificationByAttempt.get(String(latestAttempt.id))||null:null;
    const caps=account?.capabilities||{};
    const e2eValidated=caps.e2eValidated===true||Boolean(verification);
    const directEnabled=caps.directSalePaymentsEnabled===true;
    const canValidate=caps.canValidateProviderTransactions===true;
    const status=String(latestAttempt?.status||'');

    let stage='AGUARDA 1ª VENDA';
    let stageClass='risk';
    let order=2;
    let nextAction='Aguardar a primeira transação validável; somente uma transação automática pendente poderá permanecer ativa neste PSP.';
    if(status==='review_required'){
      stage='REVISÃO';
      stageClass='offline';
      order=0;
      nextAction='Não libere nova tentativa. Suspenda a automação e confira o PSP até determinar o resultado real.';
    }else if(e2eValidated){
      stage='INTEGRAÇÃO VERIFICADA';
      stageClass='online';
      order=3;
      nextAction='Evidência transacional registrada. A integração está verificada para operação automática.';
    }else if(status==='approved'){
      stage='AGUARDA LIQUIDAÇÃO';
      stageClass='risk';
      order=1;
      nextAction='O PSP aprovou a transação; aguarde entrega/liquidação para concluir a verificação da integração.';
    }else if(liveAttempt){
      stage='VALIDAÇÃO EM CURSO';
      stageClass='risk';
      order=1;
      nextAction='Acompanhe esta transação até resultado terminal ou liquidação. Outra ordem automática do mesmo PSP permanece bloqueada.';
    }else if(latestAttempt){
      stage='VALIDAÇÃO ENCERRADA';
      stageClass='';
      order=4;
      nextAction=directEnabled&&canValidate
        ?'A tentativa anterior encerrou sem evidência conclusiva; uma nova transação poderá iniciar outra validação.'
        :'Automação suspensa ou indisponível; mantenha confirmação manual até nova decisão.';
    }

    const anchor=stage==='INTEGRAÇÃO VERIFICADA'
      ?caps.e2eValidatedAt||verification?.verified_at||verification?.created_at||latestAttempt?.updated_at
      :status==='review_required'
        ?latestAttempt?.last_error_at||latestAttempt?.updated_at||latestAttempt?.created_at
        :latestAttempt?.created_at||account?.updated_at||account?.connected_at;
    return {
      key,merchantId,provider,merchant,account,attempt:latestAttempt,verification,
      e2eValidated,directEnabled,canValidate,stage,stageClass,order,nextAction,anchor
    };
  }).sort((a,b)=>
    a.order-b.order
    ||Date.parse(a.anchor||0)-Date.parse(b.anchor||0)
    ||String(a.merchant?.name||'').localeCompare(String(b.merchant?.name||''))
  );

  const review=models.filter(x=>x.stage==='REVISÃO').length;
  const inFlight=models.filter(x=>['VALIDAÇÃO EM CURSO','AGUARDA LIQUIDAÇÃO'].includes(x.stage)).length;
  const waiting=models.filter(x=>x.stage==='AGUARDA 1ª VENDA').length;
  const validated=models.filter(x=>x.stage==='INTEGRAÇÃO VERIFICADA').length;
  const active=models.filter(x=>x.order<4);
  const readOnly=adminCurrentRole()==='readonly';

  const cards=active.map(model=>{
    const attempt=model.attempt;
    const orderRow=attempt?orderById.get(String(attempt.order_id)):null;
    const providerRef=attempt?.provider_payment_id||attempt?.provider_order_id||'';
    const maskedRef=providerRef?'•••• '+String(providerRef).slice(-8):'sem ID externo';
    const errorCode=String(attempt?.last_error_code||'');
    const paymentLine=attempt
      ?(orderRow?.public_code||String(attempt.order_id||'').slice(0,8))
        +' • '+adminPaymentMethodLabel(attempt.payment_method_snapshot||orderRow?.payment_method)
        +' • '+adminMoney(attempt.amount_cents)
      :'nenhuma tentativa criada';
    const detail=attempt
      ?'tentativa '+String(attempt.id||'').slice(0,8)
        +' • '+adminRelativeTime(attempt.created_at)
        +' • '+maskedRef
      :(model.account?.connected_at?'conta conectada '+adminRelativeTime(model.account.connected_at):'conta pronta para ativação');
    const reviewNotice=model.stage==='REVISÃO'
      ?'<div class="notice danger" style="margin-top:8px"><strong>Validação automática bloqueada por segurança.</strong><br>'+esc(adminMerchantPilotIssueLabel(errorCode))+(errorCode?' • '+esc(errorCode):'')+'. O TAMÃO não deve criar uma segunda cobrança automática até existir prova do resultado.</div>'
      :model.stage==='INTEGRAÇÃO VERIFICADA'
        ?'<div class="notice success" style="margin-top:8px"><strong>Integração verificada.</strong><br>'+(model.verification?'Evidência '+esc(adminMerchantPaymentVerificationLabel(model.verification.verification_level))+' em '+esc(formatDateTime(model.verification.verified_at||model.verification.created_at))+'.':'Conta promovida por evidência transacional persistida.')+'</div>'
        :'';
    const canSuspend=!readOnly&&model.directEnabled&&model.canValidate&&!model.e2eValidated;
    return '<article class="card flat">'
      +'<div class="order-head"><div><strong>'+esc(model.merchant?.name||adminMerchantName(model.merchantId))+' • '+esc(adminBillingProviderName(model.provider))+'</strong><br><small>'+esc(paymentLine)+'</small></div><span class="status-pill '+model.stageClass+'">'+esc(model.stage)+'</span></div>'
      +'<div class="tiny muted" style="margin-top:8px">'+esc(detail)+(model.anchor?' • '+esc(adminRelativeTime(model.anchor)):'' )+'</div>'
      +(attempt?.provider_status?'<div class="tiny muted">Status PSP: <strong>'+esc(String(attempt.provider_status).toUpperCase())+'</strong> • nível '+esc(adminMerchantPaymentVerificationLabel(attempt.verification_level))+'</div>':'')
      +reviewNotice
      +'<div class="notice" style="margin-top:8px"><strong>Próxima ação:</strong><br>'+esc(model.nextAction)+'</div>'
      +'<div class="order-actions">'
      +(attempt?.order_id?'<button class="secondary small" onclick="adminOpenEntity(\'order\',\''+esc(attempt.order_id)+'\')">Abrir pedido</button>':'')
      +'<button class="ghost small" onclick="adminOpenEntity(\'merchant\',\''+esc(model.merchantId)+'\')">Revenda 360°</button>'
      +(canSuspend?'<button class="danger-btn small" onclick="adminSetMerchantPaymentCapability(\''+esc(model.merchantId)+'\',\''+esc(model.provider)+'\',false)">Suspender automação</button>':'')
      +'</div></article>';
  }).join('');

  const recentClosed=models.filter(x=>x.order===4).slice(0,20);
  return '<div class="section-head" style="margin-top:16px"><div><span class="section-kicker">PAGAMENTOS AUTOMÁTICOS</span><h3>Central de validação transacional</h3><p>Antes da primeira evidência transacional conclusiva, cada revenda pode manter somente uma transação automática pendente por PSP. Resultado ambíguo permanece bloqueado até investigação; não existe atalho para forçar validação.</p></div><span class="status-pill '+(review?'offline':inFlight?'risk':'online')+'">'+review+' REVISÃO • '+inFlight+' EM CURSO</span></div>'
    +'<div class="merchant-kpis" style="margin-bottom:12px">'
    +'<div class="kpi"><span class="label">Em revisão</span><strong>'+review+'</strong><small>fail-closed</small></div>'
    +'<div class="kpi"><span class="label">Validações em curso</span><strong>'+inFlight+'</strong><small>1 por revenda/PSP</small></div>'
    +'<div class="kpi"><span class="label">Aguardando 1ª venda</span><strong>'+waiting+'</strong></div>'
    +'<div class="kpi"><span class="label">Integrações verificadas</span><strong>'+validated+'</strong><small>prova real</small></div>'
    +'</div>'
    +'<div class="notice"><strong>Autoridade financeira preservada.</strong><br>Esta central observa e pode suspender automação, mas não aprova pagamento, não altera evidência e não transforma manualmente uma integração em verificada.</div>'
    +(cards?'<div class="admin-entity-grid" style="margin-top:12px">'+cards+'</div>':'<div class="empty card" style="margin-top:12px">Nenhuma conta está em ativação, revisão ou validação transacional neste momento.</div>')
    +(recentClosed.length?'<details class="card flat" style="margin-top:12px"><summary><strong>Validações encerradas recentemente ('+recentClosed.length+')</strong></summary><div class="list" style="margin-top:10px">'+recentClosed.map(model=>{const a=model.attempt;return '<div class="list-row"><div><strong>'+esc(model.merchant?.name||adminMerchantName(model.merchantId))+' • '+esc(adminBillingProviderName(model.provider))+'</strong><br><small>'+esc(a?.status||'—')+' • '+esc(a?.last_error_code||'sem erro')+'</small></div><small>'+esc(a?.updated_at?formatDateTime(a.updated_at):'—')+'</small></div>';}).join('')+'</div></details>':'');
}

function adminMerchantSaleVerificationSection(d){
  const rows=(d.merchantPayments?.verifications||[]).slice(0,20);
  const orderById=new Map((d.controlOrders||[]).map(x=>[String(x.id),x]));
  if(!rows.length){
    return '<div class="card flat" style="margin-top:12px"><h3>Evidências de pagamento das vendas</h3><div class="tiny muted">Nenhuma venda possui evidência registrada ainda. Quando houver operação, esta área distinguirá confirmação por provedor, terminal e revenda.</div></div>';
  }
  return '<div class="card flat" style="margin-top:12px"><div class="section-head"><div><h3>Evidências de pagamento das vendas</h3><p>Somente prova transacional. Estes valores pertencem às revendas e não compõem o caixa do TAMÃO.</p></div></div><div class="list">'
    +rows.map(row=>{
      const order=orderById.get(String(row.order_id));
      const merchantName=adminMerchantName(row.merchant_id);
      const transaction=String(row.provider_transaction_id||'');
      const safeTx=transaction?'•••• '+transaction.slice(-8):'sem ID externo';
      const level=adminMerchantPaymentVerificationLabel(row.verification_level);
      return '<div class="list-row"><div><strong>'+esc(order?.public_code||String(row.order_id).slice(0,8))+' • '+esc(merchantName)+'</strong><br><small>'+esc(adminBillingProviderName(row.provider))+' • '+esc(level)+' • '+esc(safeTx)+'</small></div><div style="text-align:right"><strong>'+adminMoney(row.amount_cents)+'</strong><br><small>'+esc(formatDateTime(row.verified_at||row.occurred_at||row.created_at))+'</small></div></div>';
    }).join('')
    +'</div></div>';
}
function adminMerchantPaymentAccountsSection(d){
  const merchants=d.merchants||[];
  const rows=[];
  for(const merchant of merchants){
    for(const account of merchant.paymentAccounts||[]){
      rows.push({merchant,account});
    }
  }
  const globalEnabled=d.merchantPayments?.globalDirectPaymentsEnabled===true;
  return '<div class="section-head" style="margin-top:18px"><div><span class="section-kicker">VENDA DO CLIENTE → REVENDA</span><h3>Recebimento direto multi-PSP</h3><p>A revenda pode usar o provedor que já possui. Conectar ou validar um PSP serve apenas para confirmar a transação; nenhuma venda passa pela conta do TAMÃO.</p></div><span class="status-pill '+(globalEnabled?'online':'risk')+'">AUTOMAÇÃO GLOBAL '+(globalEnabled?'ATIVA':'DESATIVADA')+'</span></div>'
    +'<div class="notice"><strong>Arquitetura agnóstica de provedor.</strong><br>Mercado Pago não é obrigatório. Pix próprio, dinheiro e cartão na entrega continuam válidos; PagBank, Stone, Getnet e outros entram como conectores independentes.</div>'
    +adminMerchantPaymentProviderCatalog(d)
    +adminMerchantDeclaredPspRadar(d)
    +adminMerchantPspHomologationQueue(d)
    +adminMerchantPspPilotCenter(d)
    +(rows.length?'<div class="admin-entity-grid" style="margin-top:12px">'+rows.map(adminMerchantPaymentAccountCard).join('')+'</div>':'<div class="empty card" style="margin-top:12px">Nenhuma revenda possui conexão automática com PSP ainda. Isso não impede uma revenda de operar com formas de pagamento manuais confirmadas.</div>')
    +adminMerchantSaleVerificationSection(d);
}

function adminMerchantBillingSection(d){
  const billing=d.merchantBilling||{};
  const plans=billing.plans||[];
  const accounts=billing.accounts||[];
  const statements=billing.statements||[];
  const paymentRequests=billing.paymentRequests||[];
  const paymentEvents=billing.paymentEvents||[];
  const refunds=billing.refunds||[];
  const refundRecoveries=billing.refundRecoveries||[];
  const providerCharges=billing.providerCharges||[];
  const webhookProbes=billing.webhookProbes||[];
  const paymentIngress=billing.paymentIngress||null;
  const providerHealth=adminRuntime.providerHealth;
  const latestWebhookProbe=adminLatestBillingWebhookProbe(d,'mercadopago');
  const verifiedWebhookProbe=adminFreshVerifiedWebhookProbe(d,'mercadopago');
  const remoteWebhookVerified=
    providerHealth?.remoteWebhookRegistrationVerified===true
    ||Boolean(verifiedWebhookProbe);
  const pspApiValidated=providerHealth?.ok===true;
  const pspE2E=adminBillingE2EState(d);
  const pspFailed=Boolean(providerHealth)&&providerHealth?.ok===false;
  const pspConfigured=paymentIngress?.livePspReady===true;
  const pspBadgeLabel=pspE2E.validated?'INTEGRAÇÃO VERIFICADA':pspApiValidated?'API VALIDADA':pspFailed?'PSP FALHANDO':pspConfigured?'PSP CONFIGURADO':paymentIngress?.normalizedIngressConfigured?'INGRESS PRONTO':'PENDENTE';
  const pspBadgeClass=pspE2E.validated||pspApiValidated?'online':pspFailed?'offline':pspConfigured||paymentIngress?.normalizedIngressConfigured?'risk':'';
  const metrics=billing.metrics||null;
  const reconciliation=billing.reconciliation||null;
  const pendingPaymentRequests=paymentRequests
    .filter(x=>x.status==='pending')
    .sort((a,b)=>Date.parse(a.requested_at||0)-Date.parse(b.requested_at||0));
  const openStatements=statements.filter(x=>['open','overdue'].includes(x.status));
  const overdue=openStatements.filter(x=>x.status==='overdue');
  const held=accounts.filter(x=>x.sales_hold);
  const pendingRefunds=refunds
    .filter(x=>x.status==='review_required')
    .sort((a,b)=>Date.parse(a.occurred_at||0)-Date.parse(b.occurred_at||0));
  const actionableEvents=paymentEvents
    .filter(x=>['matched_exact','review_required'].includes(x.status))
    .sort((a,b)=>{
      const priority=(x)=>x.status==='matched_exact'?0:1;
      return priority(a)-priority(b)||Date.parse(a.updated_at||a.received_at||0)-Date.parse(b.updated_at||b.received_at||0);
    });
  return `<section class="section">
    <div class="section-head"><div><span class="section-kicker">COBRANÇA DAS REVENDAS</span><h2>Fechamento diário + pacotes</h2><p>Cada pedido mantém sua taxa auditável. À 00:05 o dia anterior é consolidado; o saldo vence no fim do dia seguinte. Crédito pré-pago reduz a taxa e evita pagamento diário enquanto houver saldo.</p></div><div class="order-actions"><span class="status-pill ${Number(metrics?.overdueStatementCount??overdue.length)?'offline':'online'}">${Number(metrics?.overdueStatementCount??overdue.length)} vencido(s)</span><span class="status-pill ${Number(metrics?.salesHoldCount??held.length)?'offline':'online'}">${Number(metrics?.salesHoldCount??held.length)} hold(s)</span></div></div>
    ${paymentIngress?`<div class="card flat admin-psp-card">
      <div class="section-head admin-psp-head"><div><span class="section-kicker">PAGAMENTOS DA PLATAFORMA</span><h3>Entrada Pix / PSP</h3><p>Estado operacional primeiro. Credenciais, webhooks e endpoints técnicos permanecem server-side e auditáveis; segredos nunca saem do ambiente server-side.</p></div><span class="status-pill ${pspBadgeClass}">${esc(pspBadgeLabel)}</span></div>
      <div class="admin-psp-status-grid">
        <div class="admin-psp-status"><span class="admin-state-dot ${paymentIngress.livePspReady?'ok':'pending'}"></span><div><small>Provedor ativo</small><strong>${esc(adminBillingProviderName(paymentIngress.activeBillingProvider||'—'))}</strong></div></div>
        <div class="admin-psp-status"><span class="admin-state-dot ${paymentIngress.adapterReadiness?.mercadopago?.accessTokenConfigured?'ok':'pending'}"></span><div><small>Access Token</small><strong>${paymentIngress.adapterReadiness?.mercadopago?.accessTokenConfigured?'Configurado':'Pendente'}</strong></div></div>
        <div class="admin-psp-status"><span class="admin-state-dot ${paymentIngress.adapterReadiness?.mercadopago?.webhookSecretConfigured?'ok':'pending'}"></span><div><small>Webhook HMAC</small><strong>${paymentIngress.adapterReadiness?.mercadopago?.webhookSecretConfigured?'Configurado':'Pendente'}</strong></div></div>
        <div class="admin-psp-status"><span class="admin-state-dot ${pspApiValidated?'ok':pspFailed?'bad':'pending'}"></span><div><small>API Mercado Pago</small><strong>${pspApiValidated?'Validada':pspFailed?'Falhando':'Não testada'}</strong></div></div>
        <div class="admin-psp-status"><span class="admin-state-dot ${remoteWebhookVerified?'ok':'pending'}"></span><div><small>Webhook remoto</small><strong>${remoteWebhookVerified?'Assinatura comprovada':latestWebhookProbe?.status==='pending'?'Prova aguardando envio':'Não comprovado'}</strong></div></div>
        <div class="admin-psp-status"><span class="admin-state-dot ${pspE2E.validated?'ok':'pending'}"></span><div><small>Validação transacional</small><strong>${pspE2E.validated?'Validado':'Aguardando primeira transação verificada'}</strong></div></div>
      </div>
      <div class="admin-psp-actions">
        <button class="secondary small" onclick="adminCheckBillingProviderHealth()" ${adminRuntime.providerHealthPending?'disabled':''}>${adminRuntime.providerHealthPending?'Testando conexão…':'Testar PSP ativo'}</button>
        ${paymentIngress.activeBillingProvider==='mercadopago'&&!remoteWebhookVerified
          ?`<button class="secondary small" onclick="adminGenerateBillingWebhookProbe()" ${adminRuntime.actionPending?'disabled':''}>Gerar prova Webhook</button>`
          :''}
        <small>Os dois testes são não financeiros: não criam Pix, cobrança, saldo ou crédito.</small>
      </div>
      ${latestWebhookProbe&&latestWebhookProbe.status==='pending'&&Date.parse(latestWebhookProbe.expires_at)>Date.now()
        ?`<div class="notice admin-psp-notice">
          <strong>Prova Webhook pronta para o simulador oficial.</strong><br>
          No Mercado Pago, abra Webhooks → Configurar notificações → Simular, escolha o endpoint de produção e o evento <strong>Order (Mercado Pago)</strong>. No campo Data ID, cole:
          <div class="admin-webhook-probe-code"><code>${esc(latestWebhookProbe.resource_id)}</code><button type="button" class="ghost small" onclick="adminCopyText('${esc(latestWebhookProbe.resource_id)}','Data ID')">Copiar ID</button></div>
          <small>Expira ${esc(formatDateTime(latestWebhookProbe.expires_at))}. A prova só é aceita se o Mercado Pago assinar a notificação com o HMAC configurado; nenhuma tabela financeira é alterada.</small>
        </div>`
        :remoteWebhookVerified
          ?`<div class="notice success admin-psp-notice"><strong>Webhook remoto comprovado criptograficamente.</strong><br>O endpoint recebeu uma notificação assinada pelo Mercado Pago e validou o HMAC oficial${(providerHealth?.remoteWebhookVerifiedAt||verifiedWebhookProbe?.verified_at)?' em '+esc(formatDateTime(providerHealth?.remoteWebhookVerifiedAt||verifiedWebhookProbe?.verified_at)):''}. Esta prova confirma transporte + assinatura, não um pagamento.</div>`
          :''}
      ${adminBillingProviderHealthNotice(providerHealth)}
      ${paymentIngress.configValid===false
        ?`<div class="notice danger admin-psp-notice"><strong>Configuração de webhook inválida.</strong><br>O mapa BILLING_PAYMENT_WEBHOOK_SECRETS não pôde ser validado. Nenhum recebimento automático deve ser considerado pronto.</div>`
        :pspE2E.validated
          ?`<div class="notice success admin-psp-notice"><strong>Integração financeira verificada.</strong><br>Além da API, já existe evidência de transação e webhook financeiro conciliados. O TAMÃO continua exigindo correlação, valor e evidência exatos antes de movimentar o financeiro.</div>`
          :pspApiValidated
            ?`<div class="notice success admin-psp-notice"><strong>API do PSP validada; integração transacional ainda pendente.</strong><br>A credencial respondeu e os requisitos locais estão prontos${remoteWebhookVerified?', inclusive o webhook remoto assinado':''}. A integração será marcada como verificada após uma transação real ser conciliada.</div>`
          :paymentIngress.livePspReady
            ?`<div class="notice admin-psp-notice"><strong>PSP configurado; validação transacional pendente.</strong><br>Os requisitos server-side existem, mas a configuração por si só não comprova credencial, webhook e conciliação do PSP. Use “Testar PSP ativo”.</div>`
            :paymentIngress.normalizedIngressConfigured
              ?`<div class="notice admin-psp-notice"><strong>Canal técnico pronto; PSP automático não configurado.</strong><br>O contrato HMAC normalizado do TAMÃO está disponível, mas nenhum adaptador nativo de PSP está configurado. A confirmação pela revenda continua disponível.</div>`
              :`<div class="notice admin-psp-notice"><strong>PSP/Pix ainda não conectado.</strong><br>O motor interno de conciliação está pronto, mas não há integração automática validada. O fluxo manual continua disponível.</div>`}
      <details class="admin-tech-details">
        <summary><span>Detalhes técnicos da integração</span><small>contratos, adaptadores e endpoints</small></summary>
        <div class="admin-tech-details-body">
          <div class="tiny muted">Contrato HMAC normalizado: ${esc(paymentIngress.contract||'—')} • provedores configurados nesse contrato: ${Number(paymentIngress.providerCount||0)}${Array.isArray(paymentIngress.providers)&&paymentIngress.providers.length?' • '+paymentIngress.providers.map(esc).join(', '):''}</div>
          <div class="tiny muted">Adaptadores nativos de PSP ativos: ${Number(paymentIngress.liveProviderCount||0)}${Array.isArray(paymentIngress.liveProviders)&&paymentIngress.liveProviders.length?' • '+paymentIngress.liveProviders.map(esc).join(', '):''}</div>
          <div class="tiny muted">PSP ativo: <strong>${esc(paymentIngress.activeBillingProvider||'—')}</strong></div>
          ${paymentIngress.adapterReadiness?.mercadopago?`<div class="tiny muted">Mercado Pago: adaptador ${paymentIngress.adapterReadiness.mercadopago.implemented?'implementado':'ausente'} • Access Token ${paymentIngress.adapterReadiness.mercadopago.accessTokenConfigured?'configurado':'pendente'} • webhook HMAC ${paymentIngress.adapterReadiness.mercadopago.webhookSecretConfigured?'configurado':'pendente'} • cobrança ${paymentIngress.adapterReadiness.mercadopago.chargeReady?'pronta':'pendente'} • recebimento ${paymentIngress.adapterReadiness.mercadopago.receiveReady?'pronto':'pendente'}</div>`:''}
          ${paymentIngress.liveEndpoints?.mercadopago?`<div class="tiny muted">Webhook Mercado Pago único (Order): ${esc(paymentIngress.liveEndpoints.mercadopago)}</div>`:''}
          ${paymentIngress.adapterReadiness?.woovi?`<div class="tiny muted">Woovi/OpenPix: adaptador ${paymentIngress.adapterReadiness.woovi.implemented?'implementado':'ausente'} • webhook ${paymentIngress.adapterReadiness.woovi.receiveReady?'pronto':'pendente'} • criação de cobrança ${paymentIngress.adapterReadiness.woovi.chargeReady?'pronta':'pendente'} • App ID ${paymentIngress.adapterReadiness.woovi.appIdConfigured?'configurado':'pendente'} • token privado ${paymentIngress.adapterReadiness.woovi.webhookAuthorizationConfigured?'configurado':'pendente'} • vínculo da empresa ${paymentIngress.adapterReadiness.woovi.companyBound?'configurado':'pendente'} • ambiente ${esc(paymentIngress.adapterReadiness.woovi.environment||'—')} • assinatura ${esc(paymentIngress.adapterReadiness.woovi.signature||'—')}</div>`:''}
          ${paymentIngress.liveEndpoints?.woovi?`<div class="tiny muted">Webhook Woovi: ${esc(paymentIngress.liveEndpoints.woovi)}</div>`:''}
          ${paymentIngress.liveEndpoints?.merchantPix?`<div class="tiny muted">Pix de cobrança TAMÃO → revenda: ${esc(paymentIngress.liveEndpoints.merchantPix)}</div>`:''}
          ${paymentIngress.endpoint?`<div class="tiny muted">Ingress normalizado: ${esc(paymentIngress.endpoint)}</div>`:''}
        </div>
      </details>
    </div>`:''}
    ${adminMerchantPaymentAccountsSection(d)}
    ${adminBillingMetricsView(metrics)}
    ${adminBillingReconciliationView(reconciliation)}
    ${pendingRefunds.length?`<div class="section-head" style="margin-top:18px"><div><h3>Reembolsos do PSP exigem decisão</h3><p>Refund confirmado nunca desfaz crédito ou quitação silenciosamente. Refund ligado cria obrigação de recuperação no valor exato; o hold só cai depois que o pagamento dessa obrigação for conciliado e aprovado.</p></div><span class="status-pill offline">${pendingRefunds.length} em revisão</span></div>${pendingRefunds.map(adminBillingRefundCard).join('')}`:''}
    ${refunds.some(x=>x.status!=='review_required')?`<details class="card flat" style="margin-bottom:16px"><summary><strong>Histórico de refunds do PSP</strong></summary><div style="margin-top:10px">${refunds.filter(x=>x.status!=='review_required').slice(0,50).map(adminBillingRefundCard).join('')}</div></details>`:''}
    ${providerCharges.length?`<details class="card flat" style="margin-bottom:16px"><summary><strong>Cobranças Pix geradas pelo TAMÃO</strong> • ${providerCharges.length}</summary><div class="list" style="margin-top:10px">${providerCharges.slice(0,50).map(adminBillingProviderChargeRow).join('')}</div></details>`:''}
    ${actionableEvents.length?`<div class="section-head" style="margin-top:18px"><div><h3>Eventos de pagamento</h3><p>Eventos autenticados do provedor são conciliados por valor + identificador. Ambiguidades nunca movimentam saldo automaticamente.</p></div><span class="status-pill ${actionableEvents.some(x=>x.status==='review_required')?'risk':'online'}">${actionableEvents.length} evento(s)</span></div>${actionableEvents.map(adminBillingPaymentEventCard).join('')}`:''}
    ${plans.length?`<div class="admin-entity-grid">${plans.map(adminBillingPlanCard).join('')}</div>`:'<div class="notice">Motor de cobrança diária ainda não está ativo neste ambiente.</div>'}
    <div class="section-head" style="margin-top:18px"><div><h3>Pagamentos aguardando conferência</h3><p>Aprovar é uma ação financeira: pacote gera crédito; fechamento diário é quitado. A referência da revenda, sozinha, nunca movimenta saldo.</p></div><span class="status-pill ${pendingPaymentRequests.length?'risk':'online'}">${pendingPaymentRequests.length} pendente(s)</span></div>
    ${pendingPaymentRequests.length?pendingPaymentRequests.map(adminBillingPaymentRequestCard).join(''):'<div class="empty card">Nenhum pagamento aguarda conferência.</div>'}
    ${paymentRequests.some(x=>x.status!=='pending')?`<details class="card flat" style="margin-top:12px"><summary><strong>Histórico de solicitações financeiras</strong></summary><div style="margin-top:10px">${paymentRequests.filter(x=>x.status!=='pending').slice(0,50).map(adminBillingPaymentRequestCard).join('')}</div></details>`:''}
    ${accounts.length?`<div class="section-head" style="margin-top:18px"><div><h3>Contas de cobrança</h3><p>Saldo, reservas e bloqueio financeiro por revenda.</p></div></div><div class="admin-entity-grid">${accounts.map(adminBillingAccountCard).join('')}</div>`:''}
    <div class="section-head" style="margin-top:18px"><div><h3>Fechamentos diários</h3><p>Prioridade para vencidos e abertos; históricos liquidados permanecem auditáveis.</p></div></div>
    ${openStatements.length?openStatements.map(adminBillingStatementCard).join(''):'<div class="empty card">Nenhum fechamento em aberto.</div>'}
    ${statements.some(x=>!['open','overdue'].includes(x.status))?`<details class="card flat" style="margin-top:12px"><summary><strong>Histórico recente</strong></summary><div style="margin-top:10px">${statements.filter(x=>!['open','overdue'].includes(x.status)).slice(0,30).map(adminBillingStatementCard).join('')}</div></details>`:''}
  </section>`;
}

function adminReceivableRow(x){
  return `<div class="list-row"><div><strong>${esc(adminMerchantName(x.merchant_id))}</strong><br><small>Taxa da plataforma • pedido ${esc(x.order_id)}</small></div><div style="text-align:right"><strong>${adminMoney(x.platform_fee_cents)}</strong><div class="order-actions"><button class="secondary small" onclick="adminFinancial('platform_receivable','${x.order_id}','paid')">Pago</button><button class="ghost small" onclick="adminFinancial('platform_receivable','${x.order_id}','waived')">Abonar</button></div></div></div>`;
}
function adminReimbursementRow(x){
  return `<div class="list-row"><div><strong>${esc(adminMerchantName(x.merchant_id))}</strong><br><small>Reembolso de cashback • pedido ${esc(x.order_id)}</small></div><div style="text-align:right"><strong>${adminMoney(x.cashback_cents)}</strong><div class="order-actions"><button class="secondary small" onclick="adminFinancial('cashback_reimbursement','${x.order_id}','paid')">Pago</button></div></div></div>`;
}
function adminAdjustmentRow(x){
  const direction=x.direction==='merchant_owes_platform'?'Revenda → plataforma':'Plataforma → revenda';
  return `<div class="list-row"><div><strong>${esc(adminMerchantName(x.merchant_id))}</strong><br><small>${esc(direction)} • ${esc(x.adjustment_type)} • pedido ${esc(x.order_id)}</small></div><div style="text-align:right"><strong>${adminMoney(x.amount_cents)}</strong><div class="order-actions"><button class="secondary small" onclick="adminFinancial('settlement_adjustment','${x.id}','paid')">Liquidado</button><button class="ghost small" onclick="adminFinancial('settlement_adjustment','${x.id}','waived')">Abonar</button></div></div></div>`;
}

function adminRewardFailureCard(x){
  const dead=!!x.dead_lettered_at;
  const next=x.next_retry_at?new Date(x.next_retry_at).toLocaleString('pt-BR'):'—';
  const last=x.last_attempt_at?new Date(x.last_attempt_at).toLocaleString('pt-BR'):new Date(x.updated_at||x.created_at).toLocaleString('pt-BR');
  return `<article class="order-card">
    <div class="order-head"><div><div class="order-id">Pedido ${esc(x.order_id)}</div><div class="tiny muted">Tentativas: ${Number(x.attempts||0)} • última: ${esc(last)}</div></div><span class="status-pill ${dead?'offline':''}">${dead?'DEAD LETTER':'RETRY'}</span></div>
    <div class="order-line"><strong>Último erro:</strong> ${esc(x.last_error||'Falha de processamento')}</div>
    ${x.last_sqlstate?`<div class="tiny muted">SQLSTATE: ${esc(x.last_sqlstate)}</div>`:''}
    <div class="tiny muted">${dead?'Retry automático interrompido para evitar loop infinito.':'Próxima tentativa automática: '+esc(next)}</div>
    <div class="order-actions"><button class="${dead?'primary':'secondary'} small" onclick="adminRetryReward('${x.order_id}')">Reprocessar agora</button></div>
  </article>`;
}

function adminAccountingFailureCard(x){
  const dead=!!x.dead_lettered_at;
  const next=x.next_retry_at?new Date(x.next_retry_at).toLocaleString('pt-BR'):'—';
  const last=x.last_attempt_at?new Date(x.last_attempt_at).toLocaleString('pt-BR'):new Date(x.updated_at||x.created_at).toLocaleString('pt-BR');
  return `<article class="order-card">
    <div class="order-head"><div><div class="order-id">Pedido ${esc(x.order_id)}</div><div class="tiny muted">Tentativas: ${Number(x.attempts||0)} • última: ${esc(last)}</div></div><span class="status-pill ${dead?'offline':''}">${dead?'DEAD LETTER':'RETRY'}</span></div>
    <div class="order-line"><strong>Falha contábil:</strong> ${esc(x.last_error||'Falha ao registrar settlement')}</div>
    ${x.last_sqlstate?`<div class="tiny muted">SQLSTATE: ${esc(x.last_sqlstate)}</div>`:''}
    <div class="tiny muted">${dead?'Retry automático interrompido; exige revisão administrativa.':'Próxima tentativa automática: '+esc(next)}</div>
    <div class="order-actions"><button class="${dead?'primary':'secondary'} small" onclick="adminRetryAccounting('${x.order_id}')">Reprocessar contabilidade</button></div>
  </article>`;
}

function adminSupportCaseCard(x){
  const category={
    late:'Atraso',
    wrong_item:'Produto incorreto',
    price_payment:'Preço ou pagamento',
    no_show:'Entrega não apareceu',
    delivery:'Problema na entrega',
    other:'Outro problema'
  }[x.category]||String(x.category||'Problema');
  const statusLabel={
    open:'ABERTO',
    in_review:'EM ANÁLISE',
    resolved:'RESOLVIDO',
    closed:'ENCERRADO'
  }[x.status]||String(x.status||'—').toUpperCase();
  const statusClass=['resolved','closed'].includes(x.status)?'online':x.status==='open'?'offline':'risk';
  return `<article class="order-card">
    <div class="order-head"><div><div class="order-id">${esc(category)}</div><div class="tiny muted">Pedido ${esc(x.order_id)} • aberto em ${new Date(x.created_at).toLocaleString('pt-BR')}</div></div><span class="status-pill ${statusClass}">${esc(statusLabel)}</span></div>
    ${x.message?`<div class="order-line"><strong>Cliente:</strong> ${esc(x.message)}</div>`:''}
    ${x.resolution_note?`<div class="notice success" style="margin-top:10px"><strong>Tratativa:</strong><br>${esc(x.resolution_note)}</div>`:''}
    ${!['resolved','closed'].includes(x.status)?`<div class="order-actions">${x.status==='open'?`<button class="secondary small" onclick="adminSetSupportStatus('${x.id}','in_review')">Assumir análise</button>`:''}<button class="primary small" onclick="adminSetSupportStatus('${x.id}','resolved')">Resolver</button><button class="ghost small" onclick="adminSetSupportStatus('${x.id}','closed')">Encerrar</button></div>`:''}
  </article>`;
}

function adminProductionRequirementLabel(code){
  return ({
    admin_required:'Administrador ativo',
    real_supply_required:'Primeira oferta real',
    merchant_owner_required:'Responsável da revenda',
    merchant_payment_required:'Forma de pagamento',
    offerable_supply_required:'Capacidade de atender agora',
    live_portals_verification_required:'Portais live e Turnstile'
  })[String(code||'')]||String(code||'Pendência');
}
function adminSecurityBlockerLabel(code){
  return ({
    browser_sensitive_table_acl:'Acesso direto do navegador a tabelas sensíveis detectado.',
    sensitive_table_rls_disabled:'RLS desativado em tabela sensível.',
    admin_rpc_browser_exposure:'RPC administrativa privilegiada exposta ao navegador.',
    live_portals_verification_required:'Portais oficiais sem verificação técnica recente e consistente.'
  })[String(code||'')]||String(code||'Bloqueio técnico');
}
function adminLaunchControl(readiness={}){
  const security=Array.isArray(readiness.securityBlockers)?readiness.securityBlockers:[];
  const warningDetails=Array.isArray(readiness.warningDetails)?readiness.warningDetails:[];
  const mode=String(readiness.operationMode|| (readiness.commerceEnabled?'LIVE':'PRELAUNCH')).toUpperCase();
  const readinessState=String(readiness.readinessState|| (security.length?'BLOCKED_SECURITY':warningDetails.length?'READY_WITH_WARNINGS':'READY'));
  const canActivate=readiness.canActivateOperation===true;
  const verifiedAt=readiness.portalsVerifiedAt
    ? new Date(readiness.portalsVerifiedAt).toLocaleString('pt-BR')
    : 'ainda não verificados';
  const sourceSha=String(readiness.portalsSourceSha||'');
  const stateClass=readinessState==='READY'?'online':readinessState==='BLOCKED_SECURITY'?'offline':'risk';
  const modeClass=['PILOT','LIVE'].includes(mode)?'online':mode==='PAUSED'?'offline':'risk';
  const warnings=warningDetails.map(item=>{
    const confirmed=item.confirmed===true;
    const expiry=item.expiresAt?new Date(item.expiresAt).toLocaleString('pt-BR'):null;
    return `<article class="order-card">
      <div class="order-head"><div><div class="order-id">${esc(adminProductionRequirementLabel(item.key))}</div><div class="tiny muted">${esc(item.condition||'Pendência operacional')}</div></div><span class="status-pill ${confirmed?'online':'risk'}">${confirmed?'CONFIRMADO PELO ADMIN':esc(item.status||'PENDENTE')}</span></div>
      <div class="order-line"><strong>Risco:</strong> ${esc(item.risk||'Pendência operacional.')}</div>
      <div class="order-line"><strong>Recomendação:</strong> ${esc(item.recommendation||'Revisar antes de operar.')}</div>
      ${item.reason?`<div class="notice success" style="margin-top:10px"><strong>Decisão registrada:</strong> ${esc(item.reason)}${expiry?' • válida até '+esc(expiry):''}</div>`:''}
      ${!confirmed?`<div class="order-actions"><button class="secondary small" onclick="adminConfirmLaunchRequirement('${String(item.key).replace(/'/g,'')}')">Revisar e confirmar</button></div>`:''}
    </article>`;
  }).join('');
  const securityHtml=security.length
    ? `<div class="notice danger"><strong>Bloqueios críticos — não podem ser ignorados</strong><br>${security.map(x=>'• '+esc(adminSecurityBlockerLabel(x))).join('<br>')}</div>`
    : '<div class="notice success"><strong>Segurança estrutural sem bloqueios detectados.</strong><br>RLS, ACLs privilegiadas e autoridade administrativa permanecem fail-closed.</div>';

  return `<section class="section"><div class="section-head"><div><span class="section-kicker">CENTRAL DE PRODUÇÃO</span><h2>Operação real sob controle do administrador</h2><p>Segurança técnica continua obrigatória. Pendências comerciais e operacionais são exibidas com risco, recomendação e decisão auditada.</p></div><div class="order-actions"><span class="status-pill ${stateClass}">${esc(adminReadinessStateLabel(readinessState))}</span><span class="status-pill ${modeClass}">${esc(adminOperationModeLabel(mode))}</span></div></div>
    <div class="merchant-kpis">
      <div class="kpi"><span class="label">Admins ativos</span><strong>${Number(readiness.activeAdminCount||0)}</strong></div>
      <div class="kpi"><span class="label">Revendas configuradas</span><strong>${Number(readiness.configuredMerchantCount||0)}</strong></div>
      <div class="kpi"><span class="label">Owner pronto</span><strong>${Number(readiness.ownerReadyMerchantCount||0)}</strong></div>
      <div class="kpi"><span class="label">Pagamento pronto</span><strong>${Number(readiness.paymentReadyMerchantCount||0)}</strong></div>
      <div class="kpi"><span class="label">Ofertável agora</span><strong>${Number(readiness.offerReadyMerchantCount||0)}</strong><small>${readiness.availableNow?'há oferta real possível':'nenhuma oferta real possível'}</small></div>
      <div class="kpi"><span class="label">Portais</span><strong>${readiness.portalsFresh?'OK':'ATENÇÃO'}</strong><small>${esc(verifiedAt)}</small></div>
    </div>
    <div class="card flat form-stack" style="margin-top:12px">
      ${securityHtml}
      ${warningDetails.length?`<div><strong>Alertas operacionais</strong><div class="tiny muted" style="margin-top:4px">Resolva a condição ou registre conscientemente a decisão administrativa antes de ativar novos pedidos.</div></div>${warnings}`:'<div class="notice success"><strong>Checklist operacional recomendado concluído.</strong></div>'}
      ${sourceSha?`<small class="field-help">Bundle live atestado: <code>${esc(sourceSha.slice(0,12))}…</code></small>`:''}
      <div class="order-actions">
        <button class="secondary" onclick="adminVerifyLaunchPortals()">Verificar portais live</button>
        ${['PILOT','LIVE'].includes(mode)
          ?'<button class="danger-btn" onclick="adminSetOperationMode(\'PAUSED\')">Pausar novos pedidos</button>'
          :`<button class="primary" ${canActivate?'':'disabled'} onclick="adminSetOperationMode('PILOT')">ATIVAR OPERAÇÃO</button>`}
        ${mode==='PILOT'?`<button class="secondary" ${canActivate?'':'disabled'} onclick="adminSetOperationMode('LIVE')">Confirmar operação normal</button>`:''}
        ${mode==='PAUSED'?'<button class="ghost" onclick="adminSetOperationMode(\'PRELAUNCH\')">Voltar para configuração</button>':''}
      </div>
      <small class="field-help">${security.length?'A ativação está bloqueada por segurança.':canActivate?'A autoridade server-side permite ativação explícita.':'Há alertas ainda não confirmados.'} O controle de novos pedidos preserva pedidos existentes e bloqueia apenas novas compras.</small>
    </div>
  </section>`;
}

function adminOrderStatusLabel(status){
  return ({
    OFFERED_TO_MERCHANT:'AGUARDANDO PARCEIRO',
    MERCHANT_ACCEPTED:'ACEITO',
    PREPARING:'PREPARANDO',
    AT_RISK:'EM RISCO',
    REASSIGNING:'REATRIBUINDO',
    REQUOTE_REQUIRED:'CONFIRMAÇÃO DE PREÇO',
    OUT_FOR_DELIVERY:'A CAMINHO',
    ARRIVING:'CHEGANDO',
    DELIVERED:'ENTREGUE',
    SETTLED:'CONCLUÍDO',
    CANCELLED:'CANCELADO'
  })[String(status||'')]||String(status||'—');
}
function adminOrderIsLate(o){
  const now=Date.now();
  if(['DELIVERED','SETTLED','CANCELLED'].includes(o.status))return false;
  const promised=Date.parse(o.promised_by||'');
  const dispatch=Date.parse(o.dispatch_due_at||'');
  if(Number.isFinite(promised)&&promised<now)return true;
  if(['PREPARING','AT_RISK'].includes(o.status)&&Number.isFinite(dispatch)&&dispatch<now)return true;
  return false;
}
function adminControlOrderCard(o){
  const merchant=(adminRuntime.data?.merchants||[]).find(x=>x.id===o.merchant_id);
  const proposed=(adminRuntime.data?.merchants||[]).find(x=>x.id===o.proposed_merchant_id);
  const items=(o.items||[]).map(i=>`${Number(i.quantity||0)}× ${esc(i.product_name||i.product_code||'Item')}`).join(' • ');
  const late=adminOrderIsLate(o);
  const risk=['AT_RISK','REASSIGNING','REQUOTE_REQUIRED'].includes(o.status)||late;
  const rescueable=['OFFERED_TO_MERCHANT','PREPARING','AT_RISK','REASSIGNING','REQUOTE_REQUIRED'].includes(o.status)&&!o.dispatched_at;
  const cancellable=rescueable;
  const postDispatchIncident=['OUT_FOR_DELIVERY','ARRIVING'].includes(o.status)&&!!o.dispatched_at;
  const customerPhone=String(o.customer_phone_digits||'').replace(/\D/g,'');
  const merchantWhatsapp=String(merchant?.businessDetails?.whatsapp||'').replace(/\D/g,'');
  const statusClass=['DELIVERED','SETTLED'].includes(o.status)?'online':o.status==='CANCELLED'?'offline':risk?'offline':'risk';
  const destination=[o.address_text,o.address_complement,o.delivery_reference].filter(Boolean).join(' • ');
  return `<article class="order-card ${risk?'new':''}">
    <div class="order-head"><div><div class="order-id">${esc(o.public_code||o.id)}</div><div class="tiny muted">${items||'Itens não carregados'}</div></div><div style="text-align:right"><span class="status-pill ${statusClass}">${esc(adminOrderStatusLabel(o.status))}</span>${late?'<div class="tiny" style="margin-top:4px"><strong>ATRASADO</strong></div>':''}</div></div>
    <div class="order-line"><strong>${adminMoney(o.total_cents)}</strong> • pagamento ${esc(String(o.payment_method||'—').toUpperCase())} • versão ${Number(o.version||0)}</div>
    <div class="order-line"><strong>Revenda:</strong> ${esc(merchant?.name||o.supplier_name_snapshot||'Ainda não definida')}${proposed?' • alternativa '+esc(proposed.name):''}</div>
    ${destination?`<div class="order-line"><strong>Entrega:</strong> ${esc(destination)}</div>`:''}
    ${o.risk_reason?`<div class="notice danger" style="margin-top:8px"><strong>Risco:</strong> ${esc(o.risk_reason)}</div>`:''}
    <div class="tiny muted">Atualizado ${esc(formatDateTime(o.updated_at))}${o.promised_by?' • prometido '+esc(formatDateTime(o.promised_by)):''}</div>
    <div class="order-actions">
      <button class="ghost small" onclick="adminOpenEntity('order','${o.id}')">Abrir 360°</button>
      ${customerPhone?`<button class="ghost small" onclick="adminOpenWhatsapp('${customerPhone}')">Cliente</button>`:''}
      ${merchantWhatsapp?`<button class="ghost small" onclick="adminOpenWhatsapp('${merchantWhatsapp}')">Revenda</button>`:''}
      <button class="secondary small" onclick="adminOrderControl('${o.id}',${Number(o.version||0)},'note')">Registrar observação</button>
      ${rescueable?`<button class="secondary small" onclick="adminOrderControl('${o.id}',${Number(o.version||0)},'rescue')">Buscar outra revenda</button>`:''}
      ${cancellable?`<button class="danger-btn small" onclick="adminOrderControl('${o.id}',${Number(o.version||0)},'cancel')">Cancelar antes da saída</button>`:''}
      ${postDispatchIncident?`<button class="danger-btn small" onclick="adminOrderControl('${o.id}',${Number(o.version||0)},'cancel-after-dispatch')">Encerrar entrega com falha</button>`:''}
    </div>
    ${postDispatchIncident?'<small class="field-help">Use apenas quando a entrega falhou definitivamente depois da saída. O pedido será encerrado e o cashback liberado, mas o estoque NÃO será devolvido automaticamente; a revenda deve reconciliar fisicamente o produto.</small>':''}
  </article>`;
}
function adminControlTower(d){
  const orders=d.controlOrders||[];
  const terminal=new Set(['DELIVERED','SETTLED','CANCELLED']);
  const active=orders.filter(o=>!terminal.has(o.status));
  const waiting=active.filter(o=>o.status==='OFFERED_TO_MERCHANT');
  const risks=active.filter(o=>['AT_RISK','REASSIGNING','REQUOTE_REQUIRED'].includes(o.status)||adminOrderIsLate(o));
  const delivery=active.filter(o=>['OUT_FOR_DELIVERY','ARRIVING'].includes(o.status));
  const visible=[...active,...orders.filter(o=>terminal.has(o.status)).slice(0,12)];
  return `<section class="section">
    <div class="section-head"><div><span class="section-kicker">TORRE DE CONTROLE</span><h2>Pedidos agora</h2><p>Visão operacional com intervenção auditada. Resgate preserva estoque, capacidade, compliance e confirmação de preço.</p></div><span class="status-pill ${risks.length?'offline':'online'}">${risks.length} em risco</span></div>
    <div class="merchant-kpis">
      <div class="kpi"><span class="label">Ativos</span><strong>${active.length}</strong></div>
      <div class="kpi"><span class="label">Aguardando aceite</span><strong>${waiting.length}</strong></div>
      <div class="kpi"><span class="label">Em risco/atrasados</span><strong>${risks.length}</strong></div>
      <div class="kpi"><span class="label">Em entrega</span><strong>${delivery.length}</strong></div>
    </div>
    <div style="margin-top:12px">${visible.length?visible.map(adminControlOrderCard).join(''):'<div class="empty card">Nenhum pedido real registrado ainda.</div>'}</div>
  </section>`;
}

function adminBpsPct(bps){
  const n=Number(bps||0)/100;
  return Number.isInteger(n)?String(n):n.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
}
function adminProductRegistrySection(d){
  const registry=d.productRegistry||{};
  const categories=Array.isArray(registry.categories)?registry.categories:[];
  const profiles=Array.isArray(registry.products)?registry.products:[];
  const general=profiles.filter(x=>x.delivery_class==='household_general');
  const glpGas=profiles.filter(x=>/^P([1-9][0-9]?)$/.test(String(x.product_code||'')));
  const glpContainers=profiles.filter(x=>/^P([1-9][0-9]?)_CONTAINER$/.test(String(x.product_code||'')));
  const selectableCategories=categories.filter(x=>x.active&&x.category_key!=='glp');
  const categoryOptions=categories.map(cat=>`<option value="${esc(cat.category_key)}">${esc(cat.category_name)}</option>`).join('');
  const categoryCards=categories.map(cat=>`<div class="list-row">
    <div><strong>${esc(cat.category_name)}</strong><br><small>${esc(cat.category_key)} • ordem ${Number(cat.sort_order||100)}</small></div>
    <div class="order-actions"><span class="status-pill ${cat.active?'online':'offline'}">${cat.active?'ATIVA':'PAUSADA'}</span><button class="${cat.active?'danger-btn':'secondary'} small" onclick="adminToggleProductCategory('${esc(cat.category_key)}',${cat.active?'false':'true'},${Number(cat.sort_order||100)})">${cat.active?'Pausar':'Ativar'}</button></div>
  </div>`).join('');
  const productRows=general.map(item=>`<div class="list-row admin-registry-product" data-product-search="${esc((String(item.product_name||'')+' '+String(item.product_code||'')).toLowerCase())}" data-product-category="${esc(item.category_key||'')}">
    <div><strong>${esc(item.product_name)}</strong><br><small>${esc(item.product_code)} • ${esc(item.category_key)} • ordem ${Number(item.sort_order||100)}</small></div>
    <div class="order-actions"><span class="status-pill ${item.active?'online':'offline'}">${item.active?'ATIVO':'PAUSADO'}</span><button class="${item.active?'danger-btn':'secondary'} small" onclick="adminSetProductActive('${esc(item.product_code)}',${item.active?'false':'true'})">${item.active?'Pausar':'Ativar'}</button></div>
  </div>`).join('');
  return `<section class="section">
    <div class="section-head"><div><span class="section-kicker">CATÁLOGO DA PLATAFORMA</span><h2>Categorias e produtos</h2><p>Produtos gerais podem ser criados sem novo deploy. A família GLP P1–P90 e seus vasilhames permanece canônica e protegida.</p></div></div>
    <div class="merchant-kpis">
      <div class="kpi"><span class="label">Categorias</span><strong>${categories.length}</strong></div>
      <div class="kpi"><span class="label">Produtos gerais</span><strong>${general.length}</strong></div>
      <div class="kpi"><span class="label">Cargas GLP</span><strong>${glpGas.length}</strong></div>
      <div class="kpi"><span class="label">Vasilhames GLP</span><strong>${glpContainers.length}</strong></div>
    </div>
    <div class="card flat" style="margin-top:12px">
      <div class="field-row">
        <div class="input-wrap"><label for="registry-search">Buscar produto</label><input id="registry-search" class="input" maxlength="120" placeholder="Nome ou código" oninput="adminFilterRegistry()"></div>
        <div class="input-wrap"><label for="registry-category-filter">Filtrar categoria</label><select id="registry-category-filter" class="input" onchange="adminFilterRegistry()"><option value="">Todas</option>${categoryOptions}</select></div>
      </div>
      <small class="field-help">O filtro é somente visual; ativação e pausa continuam sendo decisões auditadas no servidor.</small>
    </div>
    <div class="card flat form-stack" style="margin-top:12px">
      <h3>Nova categoria</h3>
      <div class="field-row">
        <div class="input-wrap"><label for="registry-category-key">Chave</label><input id="registry-category-key" class="input" maxlength="40" placeholder="bebidas"></div>
        <div class="input-wrap"><label for="registry-category-name">Nome</label><input id="registry-category-name" class="input" maxlength="80" placeholder="Bebidas"></div>
        <div class="input-wrap"><label for="registry-category-sort">Ordem</label><input id="registry-category-sort" class="input" type="number" min="0" max="10000" step="1" value="100"></div>
      </div>
      <button class="secondary" onclick="adminCreateProductCategory()">Criar categoria</button>
      <div class="divider"></div>
      <h3>Novo produto geral</h3>
      <div class="field-row">
        <div class="input-wrap"><label for="registry-product-code">Código</label><input id="registry-product-code" class="input" maxlength="32" placeholder="SODA2L"></div>
        <div class="input-wrap"><label for="registry-product-name">Nome</label><input id="registry-product-name" class="input" maxlength="120" placeholder="Refrigerante 2 L"></div>
      </div>
      <div class="field-row">
        <div class="input-wrap"><label for="registry-product-category">Categoria</label><select id="registry-product-category" class="input">${selectableCategories.map(cat=>`<option value="${esc(cat.category_key)}">${esc(cat.category_name)}</option>`).join('')}</select></div>
        <div class="input-wrap"><label for="registry-product-sort">Ordem</label><input id="registry-product-sort" class="input" type="number" min="0" max="10000" step="1" value="100"></div>
      </div>
      <label class="check-row"><input id="registry-product-visible" type="checkbox" checked><span><strong>Visível ao cliente</strong><small>Só aparece na vitrine quando houver oferta configurada.</small></span></label>
      <label class="check-row"><input id="registry-product-merchant" type="checkbox" checked><span><strong>Revendas podem adicionar ao catálogo</strong><small>A revenda ainda precisa definir preço, estoque e disponibilidade.</small></span></label>
      <button class="primary" onclick="adminCreateRegistryProduct()" ${selectableCategories.length?'':'disabled'}>Cadastrar produto</button>
      ${selectableCategories.length?'':'<div class="notice danger">Crie ou ative uma categoria geral antes de cadastrar produto.</div>'}
    </div>
    <div class="card flat" style="margin-top:12px"><h3>Categorias</h3><div class="list">${categoryCards||'<div class="tiny muted">Nenhuma categoria cadastrada.</div>'}</div></div>
    <div class="card flat" style="margin-top:12px"><h3>Produtos gerais • <span id="registry-visible-count">${general.length}</span> visível(is)</h3><div class="list">${productRows||'<div class="tiny muted">Nenhum produto geral cadastrado.</div>'}</div></div>
  </section>`;
}

function adminCommercialPolicySection(d){
  const p=d.commercialPolicy;
  if(!p)return `<section class="section"><div class="notice danger"><strong>Política comercial indisponível.</strong><br>O painel não conseguiu carregar a autoridade financeira.</div></section>`;
  const fee=Number(p.platform_fee_bps||0);
  const variable=Number(p.variable_cost_bps||0);
  const contribution=Number(p.minimum_contribution_bps||0);
  const cashback=Number(p.cashback_bps||0);
  const referral=Number(p.direct_referral_bps||0);
  const rewards=cashback+referral;
  const headroom=Math.max(0,fee-variable-contribution-rewards);
  const per100=(bps)=>adminMoney(Math.floor(10000*Number(bps||0)/10000));
  return `<section class="section">
    <div class="section-head"><div><span class="section-kicker">ECONOMIA GLOBAL E INCENTIVOS</span><h2>Política econômica</h2><p>Custos, contribuição mínima, cashback e indicação são globais. Para revendas reais, a taxa efetiva TAMÃO vem do plano de cobrança da revenda; o percentual global abaixo é apenas fallback/compatibilidade. Pedidos existentes preservam o snapshot vigente quando foram criados.</p></div><span class="status-pill ${p.active?'online':'offline'}">V${Number(p.policy_version||1)} • ${p.active?'ATIVA':'INATIVA'}</span></div>
    <div class="merchant-kpis">
      <div class="kpi"><span class="label">Taxa global de fallback</span><strong>${adminBpsPct(fee)}%</strong><small>não substitui a taxa do plano da revenda</small></div>
      <div class="kpi"><span class="label">Reserva variável</span><strong>${adminBpsPct(variable)}%</strong><small>${per100(variable)} por R$ 100</small></div>
      <div class="kpi"><span class="label">Contribuição mínima</span><strong>${adminBpsPct(contribution)}%</strong><small>${per100(contribution)} por R$ 100</small></div>
      <div class="kpi"><span class="label">Cashback</span><strong>${adminBpsPct(cashback)}%</strong><small>${per100(cashback)} por R$ 100</small></div>
      <div class="kpi"><span class="label">Indicação</span><strong>${adminBpsPct(referral)}%</strong><small>${per100(referral)} por R$ 100</small></div>
      <div class="kpi"><span class="label">Folga econômica</span><strong>${adminBpsPct(headroom)}%</strong><small>${per100(headroom)} por R$ 100 no pior caso</small></div>
    </div>
    <div class="card flat form-stack" style="margin-top:12px">
      <label class="check-row"><input id="policy-active" type="checkbox" ${p.active?'checked':''} onchange="adminPreviewCommercialPolicy()"><span><strong>Política ativa para novos pedidos</strong><small>Para desativar durante a operação, pause novos pedidos primeiro.</small></span></label>
      <div class="field-row">
        <div class="input-wrap"><label for="policy-fee">Taxa fallback/legado (%)</label><input id="policy-fee" type="number" min="0" max="50" step="0.05" class="input" value="${adminBpsPct(fee)}" oninput="adminPreviewCommercialPolicy()"></div>
        <div class="input-wrap"><label for="policy-variable">Reserva de custo (%)</label><input id="policy-variable" type="number" min="0" max="50" step="0.05" class="input" value="${adminBpsPct(variable)}" oninput="adminPreviewCommercialPolicy()"></div>
      </div>
      <div class="field-row">
        <div class="input-wrap"><label for="policy-contribution">Contribuição mínima (%)</label><input id="policy-contribution" type="number" min="0" max="50" step="0.05" class="input" value="${adminBpsPct(contribution)}" oninput="adminPreviewCommercialPolicy()"></div>
        <div class="input-wrap"><label for="policy-cashback">Cashback (%)</label><input id="policy-cashback" type="number" min="0" max="50" step="0.05" class="input" value="${adminBpsPct(cashback)}" oninput="adminPreviewCommercialPolicy()"></div>
      </div>
      <div class="field-row">
        <div class="input-wrap"><label for="policy-referral">Indicação direta (%)</label><input id="policy-referral" type="number" min="0" max="50" step="0.05" class="input" value="${adminBpsPct(referral)}" oninput="adminPreviewCommercialPolicy()"></div>
        <div class="input-wrap"><label for="policy-hold">Carência da indicação (horas)</label><input id="policy-hold" type="number" min="0" max="2160" step="1" class="input" value="${Number(p.commission_hold_hours||0)}"></div>
      </div>
      <div id="policy-preview" class="notice"><strong>Prévia por R$ 100:</strong><br>Taxa ${per100(fee)} • custo ${per100(variable)} • contribuição mínima ${per100(contribution)} • cashback ${per100(cashback)} • indicação ${per100(referral)} • folga ${per100(headroom)}.</div>
      <div class="input-wrap"><label for="policy-reason">Motivo da alteração</label><input id="policy-reason" class="input" maxlength="1000" placeholder="Ex.: ajustar cashback após revisão de margem"></div>
      <button class="primary" onclick="adminSaveCommercialPolicy(${Number(p.policy_version||1)})">Salvar política para pedidos futuros</button>
      ${p.last_change_reason?`<small class="field-help">Última decisão: ${esc(p.last_change_reason)} • ${esc(formatDateTime(p.updated_at))}</small>`:''}
    </div>
  </section>`;
}

function adminPage(){
  if(!adminPortalRequested()){
    return shell('<section class="page"><div class="notice danger">Administração só está disponível no portal protegido.</div></section>');
  }
  if(['disabled','loading'].includes(adminRuntime.status)){
    return shell('<section class="page"><h1 class="page-title">Administração</h1><div class="empty card">Conectando ao control plane…</div></section>');
  }
  if(adminRuntime.status==='unsafe-origin'){
    return shell('<section class="page"><span class="eyebrow">CONTROL PLANE BLOQUEADO</span><h1 class="page-title">Origem administrativa não isolada</h1><div class="notice danger">Por segurança, o painel admin não autentica em uma origem compartilhada como GitHub Pages. Use localhost para desenvolvimento ou configure uma origem dedicada para administração.</div></section>');
  }
  if(adminRuntime.status==='unauthenticated')return adminLoginView();
  if(adminRuntime.status==='no-access')return adminNoAccessView();
  if(adminRuntime.status==='bootstrap-error')return adminBootstrapErrorView();
  if(adminRuntime.status!=='ready'||!adminRuntime.data){
    return shell(`<section class="page"><h1 class="page-title">Administração</h1><div class="notice danger"><strong>Não foi possível carregar o painel.</strong><br>${esc(adminRuntime.error||'Tente novamente.')}</div><button class="secondary full" style="margin-top:12px" onclick="adminRefresh()">Tentar novamente</button></section>`);
  }

  const d=adminRuntime.data;
  const currentRole=adminCurrentRole();
  if(!adminRoleCanSection(adminRuntime.section,currentRole)){
    adminRuntime.section=adminFirstSectionForRole(currentRole);
  }
  const pending=(d.applications||[]).filter(x=>x.status==='pending');
  const pilotPartners=d.pilotPartners||[];
  const active=(d.merchants||[]).filter(x=>x.status==='active');
  const referralReviews=d.referralReviews||[];
  const pendingReferralReviews=referralReviews.filter(x=>x.risk_status==='review_required'&&x.financialState!=='reversed'&&!x.financialReversedAt);
  const rewardFailures=d.rewardFailures||[];
  const deadRewardFailures=rewardFailures.filter(x=>!!x.dead_lettered_at);
  const accountingFailures=d.accountingFailures||[];
  const deadAccountingFailures=accountingFailures.filter(x=>!!x.dead_lettered_at);
  const receivables=d.finance?.receivables||[];
  const reimbursements=d.finance?.cashbackReimbursements||[];
  const adjustments=d.finance?.adjustments||[];
  const platformAdmins=d.platformAdmins||[];
  const supportCases=d.supportCases||[];
  const openSupportCases=supportCases.filter(x=>['open','in_review'].includes(x.status));
  const controlOrders=d.controlOrders||[];
  const metrics=d.businessMetrics||{};
  const openFees=receivables.reduce((s,x)=>s+Number(x.platform_fee_cents||0),0);
  const openCashback=reimbursements.reduce((s,x)=>s+Number(x.cashback_cents||0),0);
  const openAdjustments=adjustments.reduce((s,x)=>s+Number(x.amount_cents||0),0);
  const billing=d.merchantBilling||{};
  const actionableFinanceCount=
    pendingReferralReviews.length
    +deadRewardFailures.length
    +deadAccountingFailures.length
    +(billing.paymentRequests||[]).filter(x=>x.status==='pending').length
    +(billing.paymentEvents||[]).filter(x=>x.status==='review_required').length
    +(billing.refunds||[]).filter(x=>x.status==='review_required').length
    +(billing.statements||[]).filter(x=>x.status==='overdue').length
    +(billing.accounts||[]).filter(x=>x.sales_hold===true).length;
  const activeOrderAttention=controlOrders.filter(x=>['AT_RISK','REASSIGNING','REQUOTE_REQUIRED'].includes(x.status)||adminOrderIsLate(x)).length;
  const partnerAttention=pending.length+pilotPartners.filter(x=>!['cancelled','converted'].includes(String(x.onboarding_status||''))).length;
  const incidentAttention=(d.incidents||[]).filter(x=>x.status!=='resolved').length;
  const securityAttention=(d.launchReadiness?.securityBlockers||[]).length;
  const badge=(n)=>Number(n)>0?String(Number(n)):'';

  const overviewContent=`
    <section class="section admin-overview-pulse">
      <div class="section-head"><div><span class="section-kicker">NEGÓCIO • 30 DIAS</span><h2>Pulso da operação</h2><p>Indicadores server-side calculados apenas sobre fatos liquidados e estados reais do pedido.</p></div><span class="admin-data-freshness">Atualizado ${esc(adminRelativeTime(adminRuntime.lastSyncAt))}</span></div>
      <div class="admin-exec-grid">
        ${adminExecutiveKpi({icon:'R$',label:'GMV 30d',value:adminMoney(metrics.gmvCents30d),detail:Number(metrics.settledOrders30d||0)+' pedidos liquidados',tone:'money'})}
        ${adminExecutiveKpi({icon:'T',label:'Receita TAMÃO 30d',value:adminMoney(metrics.platformFeeGeneratedCents30d),detail:'taxa da plataforma gerada',tone:'money'})}
        ${adminExecutiveKpi({icon:'↗',label:'Pedidos ativos',value:String(controlOrders.filter(o=>!['DELIVERED','SETTLED','CANCELLED'].includes(o.status)).length),detail:activeOrderAttention+' em risco ou atraso',tone:activeOrderAttention?'warning':'neutral'})}
        ${adminExecutiveKpi({icon:'◇',label:'Revendas ativas',value:String(active.length),detail:partnerAttention+' pendência(s) de parceiro',tone:partnerAttention?'warning':'neutral'})}
        ${adminExecutiveKpi({icon:'₿',label:'Financeiro',value:String(actionableFinanceCount),detail:'item(ns) exigem decisão',tone:actionableFinanceCount?'danger':'neutral'})}
        ${adminExecutiveKpi({icon:'!',label:'Incidentes',value:String(incidentAttention),detail:incidentAttention?'aberto(s) agora':'nenhum incidente aberto',tone:incidentAttention?'danger':'good'})}
      </div>
    </section>
    ${adminAttentionCenter(d)}
    ${currentRole==='superadmin'?adminLaunchControl(d.launchReadiness||{}):''}
    <section class="section admin-secondary-metrics"><div class="section-head"><div><span class="section-kicker">QUALIDADE & RETENÇÃO</span><h2>Indicadores de sustentação</h2></div></div><div class="merchant-kpis">
      <div class="kpi"><span class="label">Ticket médio</span><strong>${adminMoney(metrics.averageTicketCents30d)}</strong></div>
      <div class="kpi"><span class="label">Clientes recorrentes</span><strong>${metrics.repeatRate30d==null?'—':Math.round(Number(metrics.repeatRate30d)*100)+'%'}</strong><small>${Number(metrics.repeatCustomers30d||0)} de ${Number(metrics.activeCustomers30d||0)} ativos</small></div>
      <div class="kpi"><span class="label">Cancelamentos</span><strong>${metrics.cancellationRate30d==null?'—':Math.round(Number(metrics.cancellationRate30d)*100)+'%'}</strong><small>${Number(metrics.cancelledOrders30d||0)} de ${Number(metrics.createdOrders30d||0)} pedidos</small></div>
      <div class="kpi"><span class="label">Pontualidade 90d</span><strong>${metrics.onTimeRate90d==null?'—':Math.round(Number(metrics.onTimeRate90d)*100)+'%'}</strong></div>
      <div class="kpi"><span class="label">Cashback 30d</span><strong>${adminMoney(metrics.cashbackGrantedCents30d)}</strong></div>
      <div class="kpi"><span class="label">Atendimentos abertos</span><strong>${Number(metrics.openSupportCases||openSupportCases.length)}</strong></div>
      <div class="kpi"><span class="label">Cadastros pendentes</span><strong>${pending.length}</strong></div>
      <div class="kpi"><span class="label">Taxas a receber</span><strong>${adminMoney(openFees)}</strong></div>
    </div></section>`;

  const ordersContent=`
    ${adminControlTower({...d,controlOrders})}
    <section class="section"><div class="section-head"><div><h2>Atendimento de pedidos</h2><p>Problemas registrados pelo cliente entram aqui com vínculo ao pedido, status e trilha administrativa.</p></div><span class="status-pill ${openSupportCases.length?'offline':'online'}">${openSupportCases.length} aberto(s)</span></div>${supportCases.length?supportCases.map(adminSupportCaseCard).join(''):'<div class="empty card">Nenhum atendimento registrado.</div>'}</section>`;

  const customersContent=adminCustomersSection(d);

  const partnersContent=`
    ${adminPrelaunchLeadsSection(d)}
    ${adminPublicRequestsSection(d)}
    <section class="section"><div class="section-head"><div><h2>Parceiros em cadastramento</h2><p>Interesses comerciais registrados antes da conclusão do cadastro operacional. Esses registros não participam das ofertas e não contam como revenda ativa.</p></div></div>${pilotPartners.length?pilotPartners.map(adminPilotPartnerCard).join(''):'<div class="empty card">Nenhum parceiro aguardando conclusão de cadastro.</div>'}</section>
    <section class="section"><div class="section-head"><div><h2>Cadastros de parceiros</h2><p>Aprovação cria a revenda como pendente e vincula o solicitante como owner. Não coloca a operação online.</p></div></div>${(d.applications||[]).length?(d.applications||[]).map(adminApplicationCard).join(''):'<div class="empty card">Nenhum cadastro recebido.</div>'}</section>
    <section class="section"><div class="section-head"><div><h2>Validação e ativação</h2><p>CNPJ é obrigatório para toda revenda ativa. Qualquer produto GLP ativo exige também validação ANP.</p></div></div>${(d.merchants||[]).length?(d.merchants||[]).map(adminMerchantCard).join(''):'<div class="empty card">Nenhuma revenda criada.</div>'}</section>`;

  const catalogContent=`${adminProductRegistrySection(d)}`;

  const financeContent=`
    ${adminFinanceOverview(d)}
    ${adminMerchantBillingSection(d)}
    ${adminCommercialPolicySection(d)}
    <section class="section"><div class="section-head"><div><h2>Revisão de indicações</h2><p>Comissões suspeitas não amadurecem automaticamente. Aprovação ainda exige identidades permanentes e fim da quarentena.</p></div><span class="status-pill ${pendingReferralReviews.length?'offline':'online'}">${pendingReferralReviews.length} pendente(s)</span></div>${referralReviews.length?referralReviews.map(adminReferralReviewCard).join(''):'<div class="empty card">Nenhuma indicação exige revisão.</div>'}</section>
    <section class="section"><div class="section-head"><div><h2>Fila de benefícios</h2><p>Falhas transitórias usam backoff. Dead-letter exige revisão manual; a entrega do pedido permanece concluída.</p></div><span class="status-pill ${deadRewardFailures.length?'offline':'online'}">${deadRewardFailures.length} dead-letter</span></div>${rewardFailures.length?rewardFailures.map(adminRewardFailureCard).join(''):'<div class="empty card">Nenhuma dívida de processamento de benefícios.</div>'}</section>
    <section class="section"><div class="section-head"><div><h2>Fila contábil de settlement</h2><p>Taxa da plataforma e reembolso de cashback são processados independentemente dos benefícios.</p></div><span class="status-pill ${deadAccountingFailures.length?'offline':'online'}">${deadAccountingFailures.length} dead-letter</span></div>${accountingFailures.length?accountingFailures.map(adminAccountingFailureCard).join(''):'<div class="empty card">Nenhuma dívida contábil de settlement.</div>'}</section>
    <section class="section"><div class="section-head"><div><h2>Conciliação financeira</h2><p>Taxa da plataforma, cashback usado e ajustes são contas separadas.</p></div></div>
      <div class="card flat"><h3>Taxas da plataforma</h3><div class="list">${receivables.length?receivables.map(adminReceivableRow).join(''):'<div class="tiny muted">Nenhuma taxa em aberto.</div>'}</div></div>
      <div class="card flat" style="margin-top:12px"><h3>Cashback a reembolsar</h3><div class="list">${reimbursements.length?reimbursements.map(adminReimbursementRow).join(''):'<div class="tiny muted">Nenhum reembolso em aberto.</div>'}</div></div>
      <div class="card flat" style="margin-top:12px"><h3>Ajustes de reversão • ${adminMoney(openAdjustments)}</h3><div class="list">${adjustments.length?adjustments.map(adminAdjustmentRow).join(''):'<div class="tiny muted">Nenhum ajuste em aberto.</div>'}</div></div>
    </section>
    <section class="section"><div class="card flat form-stack"><h3>Reversão financeira auditada</h3><p class="muted tiny">Somente para um pedido já liquidado que teve estorno/refund confirmado. O histórico operacional de entrega permanece.</p><div class="input-wrap"><label for="admin-reverse-order">ID do pedido</label><input id="admin-reverse-order" class="input" placeholder="UUID do pedido"></div><div class="input-wrap"><label for="admin-reverse-reason">Motivo</label><input id="admin-reverse-reason" class="input" maxlength="240" placeholder="Motivo confirmado"></div><div class="input-wrap"><label for="admin-reverse-ref">Referência</label><input id="admin-reverse-ref" class="input" maxlength="120" placeholder="ID do estorno/comprovante"></div><button class="danger-btn" onclick="adminReverseOrder()">Executar reversão</button></div></section>`;

  const incidentsContent=adminIncidentCenter(d);
  const auditContent=adminAuditView(d);

  const adminAccessContent=currentRole==='superadmin'
    ? `<section class="section"><div class="section-head"><div><span class="section-kicker">ACESSO ADMINISTRATIVO</span><h2>Administradores da plataforma</h2><p>RBAC explícito: Superadmin, Operações, Financeiro, Suporte, Compliance e Somente leitura. O último Superadmin ativo não pode ser removido nem rebaixado.</p></div><div class="order-actions"><span class="status-pill online">${platformAdmins.filter(x=>x.active).length} ativo(s)</span><span class="status-pill">${esc(adminRoleLabel(currentRole))}</span></div></div>
      <div class="card flat form-stack">
        <div class="list">${platformAdmins.length?platformAdmins.map(x=>`<div class="list-row admin-access-row"><div><strong>${esc(x.user_id)}</strong><br><small>${x.active?'Administrador ativo':'Acesso administrativo suspenso'} • ${esc(adminRoleLabel(x.admin_role))}</small></div><div class="order-actions"><select id="admin-role-${esc(x.user_id)}" class="input small-input" aria-label="Perfil administrativo">${adminRoleOptions(x.admin_role)}</select><button class="secondary small" onclick="adminChangePlatformAdminRole('${esc(x.user_id)}')">Salvar perfil</button><span class="status-pill ${x.active?'online':'offline'}">${x.active?'ATIVO':'INATIVO'}</span><button class="${x.active?'danger-btn':'secondary'} small" onclick="adminSetPlatformAdmin('${esc(x.user_id)}',${x.active?'false':'true'},document.getElementById('admin-role-${esc(x.user_id)}')?.value)">${x.active?'Desativar':'Ativar'}</button></div></div>`).join(''):'<div class="tiny muted">Nenhum administrador bootstrapado ainda.</div>'}</div>
        <div class="divider"></div>
        <div class="input-wrap"><label for="admin-new-user-email">E-mail da conta permanente</label><input id="admin-new-user-email" class="input" type="email" maxlength="160" autocomplete="off" placeholder="pessoa@empresa.com"><small class="field-help">A conta precisa ser permanente e confirmada antes de receber acesso administrativo.</small></div>
        <div class="input-wrap"><label for="admin-new-user-role">Perfil inicial</label><select id="admin-new-user-role" class="input"><option value="readonly">Somente leitura</option><option value="support">Suporte</option><option value="compliance">Compliance</option><option value="operations">Operações</option><option value="finance">Financeiro</option><option value="superadmin">Superadmin</option></select><small class="field-help">Use Superadmin somente para quem precisa controlar acessos e modo operacional.</small></div>
        <button class="secondary" onclick="adminAddPlatformAdmin()">Adicionar administrador</button>
      </div>
    </section>`
    : currentRole==='readonly'
      ? `<section class="section"><div class="section-head"><div><span class="section-kicker">ACESSO ADMINISTRATIVO</span><h2>Administradores</h2><p>Consulta sem permissão para alterar perfis ou acessos.</p></div></div><div class="list">${platformAdmins.map(x=>`<div class="list-row"><div><strong>${esc(x.user_id)}</strong><br><small>${esc(adminRoleLabel(x.admin_role))}</small></div><span class="status-pill ${x.active?'online':'offline'}">${x.active?'ATIVO':'INATIVO'}</span></div>`).join('')}</div></section>`
      : '';

  const systemContent=`
    ${adminSystemHealthView()}
    ${adminAccessContent}
  `;

  const sectionMeta=adminSectionMeta(adminRuntime.section);
  const operationMode=String(d.launchReadiness?.operationMode||(d.launchReadiness?.commerceEnabled?'LIVE':'PRELAUNCH')).toUpperCase();
  const menu=`
    <nav class="admin-sidebar" aria-label="Áreas administrativas">
      <div class="admin-sidebar-brand"><span class="admin-sidebar-mark">T</span><div><strong>TAMÃO</strong><small>Control Plane</small></div></div>
      <div class="admin-nav-group">Operação</div>
      ${adminMenuButton('overview','Visão geral','⌂')}
      ${adminMenuButton('orders','Pedidos','▣',badge(activeOrderAttention+openSupportCases.length))}
      ${adminMenuButton('customers','Clientes','◎')}
      ${adminMenuButton('partners','Parceiros','◇',badge(partnerAttention))}
      ${adminMenuButton('prospects','Prospectos','⌕')}
      ${adminMenuButton('catalog','Catálogo','▤')}
      ${adminMenuButton('finance','Financeiro','₿',badge(actionableFinanceCount))}
      <div class="admin-nav-group">Governança</div>
      ${adminMenuButton('incidents','Incidentes','!',badge(incidentAttention))}
      ${adminMenuButton('audit','Auditoria','⌕')}
      ${adminMenuButton('system','Segurança e sistema','⚙',badge(securityAttention))}
      <div class="admin-sidebar-foot">
        <span class="admin-sidebar-mode ${['LIVE','PILOT'].includes(operationMode)?'live':operationMode==='PAUSED'?'paused':'prelaunch'}"><i></i>${esc(adminOperationModeLabel(operationMode))}</span>
        <small>${esc(adminRoleLabel(currentRole))} • atualizado ${esc(adminRelativeTime(adminRuntime.lastSyncAt))}</small>
      </div>
    </nav>`;

  return shell(`<section class="page admin-page">
    <header class="admin-page-header">
      <div class="admin-page-heading"><span class="section-kicker">${esc(sectionMeta.kicker)}</span><h1>${esc(sectionMeta.title)}</h1><p>${esc(sectionMeta.description)}</p></div>
      <div class="admin-page-actions"><span class="admin-role-chip">${esc(adminRoleLabel(currentRole))}</span><button class="secondary small" onclick="adminRefresh()" ${adminRuntime.actionPending?'disabled':''}><span aria-hidden="true">↻</span> Atualizar</button><button class="ghost small" onclick="adminSignOut()">Sair</button></div>
    </header>
    ${adminOperationalStrip(d)}
    ${adminRuntime.error?`<div class="notice danger admin-page-error">${esc(adminRuntime.error)}</div>`:''}
    ${adminGlobalSearchView()}
    <div class="admin-workspace">
      ${menu}
      <main class="admin-main">
        ${adminPanel('overview',overviewContent)}
        ${adminPanel('orders',ordersContent)}
        ${adminPanel('customers',customersContent)}
        ${adminPanel('partners',partnersContent)}
        ${adminPanel('prospects',adminProspectsSection(d))}
        ${adminPanel('catalog',catalogContent)}
        ${adminPanel('finance',financeContent)}
        ${adminPanel('incidents',incidentsContent)}
        ${adminPanel('audit',auditContent)}
        ${adminPanel('system',systemContent)}
      </main>
    </div>
    ${adminDetailView()}
  </section>`);
}

function adminFilterRegistry(){
  const query=String(document.getElementById('registry-search')?.value||'').trim().toLowerCase();
  const category=String(document.getElementById('registry-category-filter')?.value||'').trim();
  let visible=0;
  document.querySelectorAll('.admin-registry-product').forEach(row=>{
    const hay=String(row.dataset.productSearch||'');
    const cat=String(row.dataset.productCategory||'');
    const show=(!query||hay.includes(query))&&(!category||cat===category);
    row.hidden=!show;
    if(show)visible++;
  });
  const count=document.getElementById('registry-visible-count');
  if(count)count.textContent=String(visible);
}

async function adminCreateProductCategory(){
  const categoryKey=String(document.getElementById('registry-category-key')?.value||'').trim().toLowerCase();
  const categoryName=String(document.getElementById('registry-category-name')?.value||'').trim();
  const sortOrder=Number(document.getElementById('registry-category-sort')?.value||100);
  if(!/^[a-z][a-z0-9_]{1,39}$/.test(categoryKey))return toast('Use uma chave simples, como bebidas ou limpeza');
  if(categoryName.length<2)return toast('Informe o nome da categoria');
  if(!Number.isSafeInteger(sortOrder)||sortOrder<0||sortOrder>10000)return toast('Ordem inválida');
  const reason=prompt('Motivo para criar/atualizar esta categoria:')||'';
  if(reason.trim().length<3)return toast('Informe o motivo');
  try{
    await adminPerform('product-registry',{
      registryAction:'upsert-category',categoryKey,categoryName,
      active:true,sortOrder,reason
    });
    toast('Categoria salva');
  }catch(e){toast(String(e?.message||e))}
}
async function adminToggleProductCategory(categoryKey,active,sortOrder){
  const category=(adminRuntime.data?.productRegistry?.categories||[]).find(x=>x.category_key===categoryKey);
  const categoryName=String(category?.category_name||categoryKey);
  const reason=prompt((active?'Motivo para ativar ':'Motivo para pausar ')+categoryName+':')||'';
  if(reason.trim().length<3)return toast('Informe o motivo');
  if(!active&&!confirm('Pausar esta categoria? SKUs ativos das revendas serão pausados e precisarão ser reconfirmados antes de voltar a vender.'))return;
  try{
    await adminPerform('product-registry',{
      registryAction:'upsert-category',categoryKey,categoryName,
      active:active===true,sortOrder:Number(sortOrder||100),reason
    });
    toast(active?'Categoria ativada':'Categoria pausada');
  }catch(e){toast(String(e?.message||e))}
}
async function adminCreateRegistryProduct(){
  const productCode=String(document.getElementById('registry-product-code')?.value||'').trim().toUpperCase();
  const productName=String(document.getElementById('registry-product-name')?.value||'').trim();
  const categoryKey=String(document.getElementById('registry-product-category')?.value||'').trim().toLowerCase();
  const sortOrder=Number(document.getElementById('registry-product-sort')?.value||100);
  const customerVisible=document.getElementById('registry-product-visible')?.checked===true;
  const merchantAddAllowed=document.getElementById('registry-product-merchant')?.checked===true;
  if(!/^[A-Z][A-Z0-9_]{1,31}$/.test(productCode))return toast('Código inválido. Use letras, números e underscore.');
  if(/^P[0-9]/.test(productCode))return toast('Códigos Pxx são reservados à família GLP canônica');
  if(productName.length<2)return toast('Informe o nome do produto');
  if(!categoryKey||categoryKey==='glp')return toast('Escolha uma categoria geral');
  if(!Number.isSafeInteger(sortOrder)||sortOrder<0||sortOrder>10000)return toast('Ordem inválida');
  const reason=prompt('Motivo para cadastrar/atualizar este produto:')||'';
  if(reason.trim().length<3)return toast('Informe o motivo');
  try{
    await adminPerform('product-registry',{
      registryAction:'upsert-product',
      categoryKey,productCode,productName,
      deliveryClass:'household_general',
      requiresIsolatedDelivery:false,
      customerVisible,merchantAddAllowed,
      active:false,sortOrder,reason
    });
    toast('Produto criado como PAUSADO. Revise os dados e ative explicitamente quando estiver pronto para publicação.');
  }catch(e){toast(String(e?.message||e))}
}
async function adminSetProductActive(productCode,active){
  const reason=prompt((active?'Motivo para ativar ':'Motivo para pausar ')+productCode+':')||'';
  if(reason.trim().length<3)return toast('Informe o motivo');
  if(!active&&!confirm('Pausar este produto? Itens ativos das revendas serão pausados e não serão reativados automaticamente.'))return;
  try{
    await adminPerform('product-registry',{
      registryAction:'set-product-active',
      productCode,active:active===true,sortOrder:100,reason
    });
    toast(active?'Produto ativado':'Produto pausado');
  }catch(e){toast(String(e?.message||e))}
}

function adminPolicyFieldBps(id){
  const n=Number(document.getElementById(id)?.value);
  if(!Number.isFinite(n)||n<0||n>50)return null;
  return Math.round(n*100);
}
function adminPreviewCommercialPolicy(){
  const el=document.getElementById('policy-preview');
  if(!el)return;
  const fee=adminPolicyFieldBps('policy-fee');
  const variable=adminPolicyFieldBps('policy-variable');
  const contribution=adminPolicyFieldBps('policy-contribution');
  const cashback=adminPolicyFieldBps('policy-cashback');
  const referral=adminPolicyFieldBps('policy-referral');
  if([fee,variable,contribution,cashback,referral].some(x=>x==null)){
    el.className='notice danger';
    el.innerHTML='<strong>Prévia indisponível.</strong><br>Revise os percentuais.';
    return;
  }
  const headroom=fee-variable-contribution-cashback-referral;
  const cents=(bps)=>adminMoney(Math.floor(10000*bps/10000));
  el.className='notice '+(headroom>=0?'success':'danger');
  el.innerHTML='<strong>Prévia por R$ 100:</strong><br>Taxa '+cents(fee)+' • custo '+cents(variable)+' • contribuição mínima '+cents(contribution)+' • cashback '+cents(cashback)+' • indicação '+cents(referral)+' • folga '+cents(Math.max(0,headroom))+(headroom<0?' • <strong>POLÍTICA NÃO FINANCIADA</strong>':'');
}
async function adminSaveCommercialPolicy(expectedVersion){
  const active=document.getElementById('policy-active')?.checked===true;
  const platformFeeBps=adminPolicyFieldBps('policy-fee');
  const variableCostBps=adminPolicyFieldBps('policy-variable');
  const minimumContributionBps=adminPolicyFieldBps('policy-contribution');
  const cashbackBps=adminPolicyFieldBps('policy-cashback');
  const directReferralBps=adminPolicyFieldBps('policy-referral');
  const commissionHoldHours=Number(document.getElementById('policy-hold')?.value);
  const reason=document.getElementById('policy-reason')?.value.trim()||'';
  if([platformFeeBps,variableCostBps,minimumContributionBps,cashbackBps,directReferralBps].some(x=>x==null)){
    return toast('Revise os percentuais da política');
  }
  if(!Number.isSafeInteger(commissionHoldHours)||commissionHoldHours<0||commissionHoldHours>2160){
    return toast('A carência precisa estar entre 0 e 2160 horas');
  }
  if(reason.length<3)return toast('Informe o motivo da alteração');
  if(active&&platformFeeBps<variableCostBps+minimumContributionBps+cashbackBps+directReferralBps){
    return toast('A taxa TAMÃO não financia custos, contribuição mínima e recompensas informadas');
  }
  if(!confirm('Salvar esta política para PEDIDOS FUTUROS? Pedidos existentes manterão seus snapshots atuais.'))return;
  try{
    await adminPerform('commercial-policy',{
      expectedVersion,
      active,
      platformFeeBps,
      variableCostBps,
      minimumContributionBps,
      cashbackBps,
      directReferralBps,
      commissionHoldHours,
      reason
    });
    toast('Política comercial atualizada para pedidos futuros');
  }catch(e){toast(String(e?.message||e))}
}

function adminOpenWhatsapp(phone){
  const digits=String(phone||'').replace(/\D/g,'');
  if(digits.length<10)return toast('Contato indisponível');
  window.open('https://wa.me/'+digits,'_blank','noopener,noreferrer');
}
async function adminOrderControl(orderId,expectedVersion,controlAction){
  const labels={
    note:'Registrar uma observação administrativa neste pedido:',
    rescue:'Motivo para buscar outra revenda:',
    cancel:'Motivo para cancelar o pedido antes da saída:',
    'cancel-after-dispatch':'Descreva a falha confirmada depois da saída:'
  };
  const reason=prompt(labels[controlAction]||'Motivo da intervenção:')||'';
  if(reason.trim().length<3)return toast('Informe o motivo da intervenção');
  if(controlAction==='rescue'&&!confirm('Buscar outra revenda agora? O sistema revalidará estoque, preço, compliance, pagamento e capacidade. Se a nova condição for mais cara, o cliente deverá confirmar.'))return;
  if(controlAction==='cancel'&&!confirm('Cancelar este pedido antes da saída? Estoque reservado e cashback serão restaurados quando aplicável.'))return;
  if(controlAction==='cancel-after-dispatch'&&!confirm('Encerrar esta entrega após a saída? O cashback será liberado e o PIN invalidado, mas o estoque NÃO será restaurado automaticamente. Use somente após confirmar que a entrega falhou.'))return;
  try{
    const result=await adminPerform('order-control',{orderId,expectedVersion,controlAction,reason});
    toast(controlAction==='note'?'Observação registrada':controlAction==='rescue'?'Resgate executado':controlAction==='cancel-after-dispatch'?'Entrega falhada encerrada; revisar estoque físico':'Pedido cancelado');
    return result;
  }catch(e){toast(String(e?.message||e))}
}

async function adminVerifyLaunchPortals(){
  try{
    const result=await adminPerform('verify-launch-portals',{});
    if(result?.ok)toast('Os três portais live foram verificados');
  }catch(e){toast(String(e?.message||e))}
}
async function adminConfirmLaunchRequirement(requirementKey){
  const reason=prompt('Explique por que esta pendência pode ser assumida agora pelo administrador:')||'';
  if(reason.trim().length<3)return toast('Informe o motivo da decisão');
  const hoursText=prompt('Validade da confirmação em horas. Deixe vazio para não expirar:','24');
  if(hoursText===null)return;
  let expiresAt=null;
  if(String(hoursText).trim()){
    const hours=Number(hoursText);
    if(!Number.isFinite(hours)||hours<=0||hours>8760)return toast('Informe uma validade entre 1 e 8760 horas');
    expiresAt=new Date(Date.now()+hours*60*60*1000).toISOString();
  }
  const evidence=prompt('Evidência ou referência opcional:','')||'';
  if(!confirm('Estou ciente do risco e desejo registrar esta decisão administrativa.'))return;
  try{
    await adminPerform('confirm-launch-requirement',{
      requirementKey,
      status:'confirmed',
      reason,
      evidence,
      expiresAt,
      source:'admin-panel'
    });
    toast('Decisão registrada na auditoria');
  }catch(e){toast(String(e?.message||e))}
}
function adminRequireTypedConfirmation(expected,message){
  const value=prompt(message+'\n\nDigite exatamente: '+expected);
  return value===expected;
}
async function adminSetOperationMode(mode){
  const target=String(mode||'').toUpperCase();
  const labels={PRELAUNCH:'voltar para configuração',PILOT:'ativar a operação',LIVE:'confirmar a operação normal',PAUSED:'pausar novos pedidos'};
  if(!labels[target])return toast('Modo operacional inválido');
  const reason=prompt('Motivo para '+labels[target]+':')||'';
  if(reason.trim().length<3)return toast('Informe o motivo da mudança');
  const confirmText=target==='PAUSED'
    ?'Pausar novos pedidos agora? Pedidos existentes e o painel continuarão acessíveis.'
    :target==='LIVE'
      ?'Confirmar a operação normal agora? Esta ação mantém novos pedidos liberados conforme o checklist confirmado.'
      :target==='PILOT'
        ?'Ativar a operação agora? Novos pedidos serão permitidos conforme as regras e limites configurados.'
        :'Voltar para configuração? Novos pedidos ficarão bloqueados.';
  if(!confirm(confirmText))return;
  if(target==='LIVE'&&!adminRequireTypedConfirmation('CONFIRMAR OPERAÇÃO','Confirmação reforçada para manter a operação normal.'))return toast('Confirmação da operação cancelada');
  try{
    await adminPerform('set-operation-mode',{mode:target,reason});
    toast('Modo operacional atualizado para '+adminOperationModeLabel(target));
  }catch(e){toast(String(e?.message||e))}
}
async function adminSetCommerceEnabled(enabled){
  return adminSetOperationMode(enabled?'PILOT':'PAUSED');
}

async function adminSetSupportStatus(caseId,status){
  const label=status==='in_review'?'colocar este atendimento em análise':status==='resolved'?'resolver este atendimento':'encerrar este atendimento';
  let resolutionNote='';
  if(['resolved','closed'].includes(status)){
    resolutionNote=prompt('Descreva a solução ou motivo do encerramento:')||'';
    if(resolutionNote.trim().length<3)return toast('Informe como o atendimento foi tratado');
  }
  if(!confirm('Confirma '+label+'?'))return;
  try{
    await adminPerform('support-case-status',{caseId,status,resolutionNote});
    toast(status==='in_review'?'Atendimento em análise':status==='resolved'?'Atendimento resolvido':'Atendimento encerrado');
  }catch(e){toast(String(e?.message||e))}
}

function adminGeneratePilotInviteToken(){
  const bytes=new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary='';
  for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function adminPilotInviteLink(token){
  const configured=String(globalThis.CHAMA_MERCHANT_ORIGIN||'https://parceiro.tamao.com.br').trim();
  const url=new URL(configured||'https://parceiro.tamao.com.br',location.href);
  url.pathname='/';
  url.search='';
  url.searchParams.set('pilot',token);
  url.hash='merchant-join';
  return url.toString();
}
async function adminIssuePilotInvite(id){
  const p=(adminRuntime.data?.pilotPartners||[]).find(x=>x.id===id);
  if(!p)return toast('Parceiro não encontrado');
  if(['converted','cancelled'].includes(String(p.onboarding_status||'')))return toast('Este parceiro não pode receber novo convite');
  const daysRaw=prompt('Validade do novo convite em dias (1 a 90):','14');
  if(daysRaw==null)return;
  const days=Number(daysRaw);
  if(!Number.isInteger(days)||days<1||days>90)return toast('Informe uma validade entre 1 e 90 dias');
  if(p.activeInvite&&!confirm('Já existe um convite ativo. Rotacionar agora invalidará o link anterior. Continuar?'))return;
  const token=adminGeneratePilotInviteToken();
  const expiresAt=new Date(Date.now()+days*24*60*60*1000).toISOString();
  try{
    const result=await adminPerform('pilot-invite',{pilotPartnerId:id,inviteAction:'issue',token,expiresAt});
    const link=adminPilotInviteLink(token);
    try{await navigator.clipboard?.writeText(link)}catch{}
    prompt('Convite criado'+(Number(result?.rotatedPreviousCount||0)>0?' e o link anterior foi revogado':'')+'. Copie este link agora e envie ao parceiro. Por segurança, ele não poderá ser recuperado depois; se for perdido, rotacione o convite:',link);
    toast('Convite de parceiro criado com validade até '+new Date(result?.expiresAt||expiresAt).toLocaleString('pt-BR'));
  }catch(e){toast(String(e?.message||e))}
}
async function adminRevokePilotInvite(id){
  const p=(adminRuntime.data?.pilotPartners||[]).find(x=>x.id===id);
  if(!p)return toast('Parceiro não encontrado');
  if(!confirm('Revogar o convite ativo deste parceiro? O link deixará de funcionar imediatamente.'))return;
  try{
    const result=await adminPerform('pilot-invite',{pilotPartnerId:id,inviteAction:'revoke'});
    toast(Number(result?.revokedCount||0)>0?'Convite revogado':'Nenhum convite ativo para revogar');
  }catch(e){toast(String(e?.message||e))}
}

async function adminConvertPilotPartner(id){
  const p=(adminRuntime.data?.pilotPartners||[]).find(x=>x.id===id);
  if(!p)return toast('Parceiro não encontrado');
  const prefix='pilot-'+id;
  const value=(suffix)=>document.getElementById(prefix+'-'+suffix)?.value?.trim()||'';
  const checked=(suffix)=>document.getElementById(prefix+'-'+suffix)?.checked===true;
  const paymentMethods=[];
  if(checked('pay-pix'))paymentMethods.push('pix');
  if(checked('pay-cash'))paymentMethods.push('cash');
  if(checked('pay-card'))paymentMethods.push('card');
  const required={
    legalName:value('legal'),cnpj:value('cnpj'),responsibleName:value('responsible'),
    phone:value('phone'),whatsapp:value('whatsapp'),postalCode:value('postal'),
    city:value('city'),addressText:value('address')
  };
  if(Object.values(required).some(x=>!x))return toast('Preencha os dados reais obrigatórios da revenda');
  const ownerUserId=null;
  const availableStock=Number(value('stock')||0);
  const deliveryFeeCents=Math.round(Number(value('fee')||0)*100);
  const baseEtaMinutes=Number(value('eta')||30);
  const radiusText=value('radius');
  if(!confirm('Criar esta revenda como PENDENTE? Compliance não será marcado como verificado e a revenda não ficará online automaticamente.'))return;
  try{
    const result=await adminPerform('assisted-merchant-onboarding',{
      draftId:id,
      tradeName:p.display_name,
      ...required,
      state:'RS',
      ownerUserId,
      ownerDisplayName:value('owner-name')||null,
      productCode:p.proposed_product_code,
      productName:adminProductName(p.proposed_product_code),
      pricingMode:p.pricing_mode||'fixed',
      minPriceCents:Number(p.min_delivered_price_cents||p.proposed_delivered_price_cents),
      preferredPriceCents:Number(p.preferred_delivered_price_cents||p.proposed_delivered_price_cents),
      maxPriceCents:Number(p.max_delivered_price_cents||p.proposed_delivered_price_cents),
      pricingStrategy:p.pricing_strategy||'balanced',
      availableStock,
      paymentMethods,
      deliveryFeeCents,
      baseEtaMinutes,
      acceptsCitywide:checked('citywide'),
      serviceRadiusKm:radiusText===''?null:Number(radiusText),
      adminNotes:value('notes')||null
    });
    toast(result?.alreadyConverted?'Parceiro já estava convertido':'Revenda criada como pendente');
  }catch(e){toast(String(e?.message||e))}
}

async function adminApproveApplication(id){
  try{await adminPerform('approve-application',{applicationId:id});toast('Cadastro aprovado para validação')}catch(e){toast(String(e?.message||e))}
}
async function adminRejectApplication(id){
  const reason=prompt('Motivo da rejeição:');
  if(!reason)return;
  try{await adminPerform('reject-application',{applicationId:id,reason});toast('Cadastro rejeitado')}catch(e){toast(String(e?.message||e))}
}
async function adminSaveCompliance(id){
  const cnpjStatus=document.getElementById('cnpj-'+id)?.value||'pending';
  const anpStatus=document.getElementById('anp-'+id)?.value||'pending';
  const anpReference=document.getElementById('anpref-'+id)?.value.trim()||'';
  const notes=document.getElementById('notes-'+id)?.value.trim()||'';
  if(cnpjStatus==='verified'&&notes.length<5)return toast('Registre a fonte/evidência usada para verificar o CNPJ');
  if(anpStatus==='verified'&&anpReference.length<3)return toast('Informe a referência da consulta ANP');
  if((cnpjStatus==='rejected'||anpStatus==='rejected')&&notes.length<5)return toast('Documente a evidência da rejeição');
  try{
    await adminPerform('verify-merchant',{merchantId:id,cnpjStatus,anpStatus,anpReference,notes});
    toast('Validação salva');
  }catch(e){toast(String(e?.message||e))}
}
async function adminSaveDeliveryCapability(id){
  const active=document.getElementById('mixed-'+id)?.checked===true;
  const notes=document.getElementById('mixednotes-'+id)?.value.trim()||'';
  if(active&&!confirm('Confirma que esta revenda foi validada operacionalmente para cesta mista com GLP?'))return;
  try{
    await adminPerform('set-delivery-capability',{merchantId:id,active,notes});
    toast(active?'Capacidade logística verificada':'Capacidade logística revogada');
  }catch(e){toast(String(e?.message||e))}
}

async function adminSetMerchantPaymentCapability(merchantId,provider,enabled){
  const merchant=(adminRuntime.data?.merchants||[]).find(x=>x.id===merchantId);
  const name=merchant?.name||'esta revenda';
  const providerKey=String(provider||'').toLowerCase();
  const providerName=adminBillingProviderName(providerKey);
  const account=(merchant?.paymentAccounts||[]).find(x=>String(x?.provider||'').toLowerCase()===providerKey)||null;

  let preflight=null;
  if(enabled){
    try{
      preflight=await adminRunMerchantPaymentPreflight(merchantId,providerKey,{silent:true});
      render();
    }catch(e){
      return toast(String(e?.message||e));
    }
    if(preflight?.readyForActivation!==true){
      const blocked=(preflight?.blockingGates||[]).join(', ');
      return toast('Ativação bloqueada pela verificação obrigatória'+(blocked?' • '+blocked:''));
    }
  }

  const e2eValidated=preflight
    ?preflight.e2eValidated===true
    :account?.capabilities?.e2eValidated===true;
  const activationKind=e2eValidated?'reactivation':'pilot';
  const reference=prompt(
    enabled
      ?activationKind==='pilot'
        ?'Referência da ativação de '+providerName+' (ticket, plano ou acompanhamento):'
        :'Referência da reativação de '+providerName+' (integração já verificada):'
      :'Motivo/referência da suspensão de '+providerName+':'
  )||'';
  if(reference.trim().length<3)return toast('Informe uma referência auditável');

  const message=!enabled
    ?'Suspender confirmação automática via '+providerName+' para '+name+'? Transações já iniciadas continuam sujeitas ao controle seguro.'
    :activationKind==='pilot'
      ?'Verificação aprovada. Ativar confirmação automática via '+providerName+' para '+name+'? A primeira transação será acompanhada de forma controlada até existir evidência conclusiva. O dinheiro continuará indo diretamente à revenda.'
      :'Verificação aprovada. Reativar confirmação automática via '+providerName+' para '+name+'? Esta conta já possui evidência transacional persistida e o dinheiro continuará indo diretamente à revenda.';
  if(!confirm(message))return;

  if(enabled){
    const typed=activationKind==='pilot'?'ATIVAR PAGAMENTOS':'REATIVAR';
    const copy=activationKind==='pilot'
      ?'Todos os requisitos da verificação estão atendidos. A ativação libera a confirmação automática e mantém a primeira transação sob controle reforçado até a validação transacional.'
      :'Todos os requisitos da verificação estão atendidos. A reativação reutiliza a evidência transacional já registrada, sem alterar quem recebe o dinheiro.';
    if(!adminRequireTypedConfirmation(typed,copy)){
      return toast(activationKind==='pilot'?'Ativação dos pagamentos cancelada':'Reativação cancelada');
    }

    try{
      const fresh=await adminRunMerchantPaymentPreflight(merchantId,providerKey,{silent:true});
      if(fresh?.readyForActivation!==true){
        render();
        return toast('O estado mudou depois da confirmação. A ativação permaneceu bloqueada.');
      }
    }catch(e){
      render();
      return toast(String(e?.message||e));
    }
  }

  try{
    const result=await adminPerform('merchant-payment-capability',{
      merchantId,
      provider:providerKey,
      enabled:enabled===true,
      reference:reference.trim()
    });
    delete adminRuntime.paymentPreflights[adminPaymentPreflightKey(merchantId,providerKey)];
    toast(
      !result?.enabled
        ?'Confirmação automática suspensa em '+providerName
        :result?.activationKind==='pilot'
          ?'Confirmação automática ativada em '+providerName+' — aguardando validação transacional'
          :'Confirmação automática reativada em '+providerName+' — integração já verificada'
    );
  }catch(e){toast(String(e?.message||e))}
}

async function adminSetMerchantStatus(id,action){
  const label=action==='activate-merchant'?'ativar':'suspender';
  if(!confirm('Confirma '+label+' esta revenda?'))return;
  try{await adminPerform(action,{merchantId:id});toast('Status atualizado')}catch(e){toast(String(e?.message||e))}
}
async function adminReviewReferral(orderId,decision){
  const notes=prompt(decision==='approved'?'Observação da aprovação (opcional):':'Motivo da rejeição / evidência:')||'';
  if(decision==='rejected'&&!notes.trim())return toast('Informe o motivo da rejeição');
  if(!confirm(decision==='approved'?'Aprovar esta comissão após a revisão de risco?':'Rejeitar esta comissão? O pedido e cashback do comprador continuarão válidos.'))return;
  try{
    await adminPerform('review-referral',{orderId,decision,notes});
    toast(decision==='approved'?'Comissão aprovada para continuar na validação':'Comissão rejeitada e saldo pendente ajustado');
  }catch(e){toast(String(e?.message||e))}
}
async function adminRetryReward(orderId){
  if(!confirm('Reprocessar os benefícios deste pedido agora? A entrega não será alterada.'))return;
  try{
    const result=await adminPerform('retry-reward',{orderId});
    if(result?.ok){
      toast(result?.alreadyResolved?'A dívida já estava resolvida':'Benefícios reprocessados com sucesso');
    }else{
      toast('O reprocessamento falhou e permaneceu registrado para revisão');
    }
  }catch(e){toast(String(e?.message||e))}
}

async function adminRetryAccounting(orderId){
  if(!confirm('Reprocessar a contabilidade deste pedido agora? A entrega e os benefícios não serão alterados.'))return;
  try{
    const result=await adminPerform('retry-accounting',{orderId});
    if(result?.ok){
      toast(result?.alreadyResolved?'A dívida contábil já estava resolvida':'Contabilidade reprocessada com sucesso');
    }else{
      toast('A contabilidade continuou em falha e permaneceu registrada');
    }
  }catch(e){toast(String(e?.message||e))}
}

async function adminSetPlatformAdmin(targetUserId,active,adminRole=null){
  const current=(adminRuntime.data?.platformAdmins||[]).find(x=>x.user_id===targetUserId);
  const role=adminRole||document.getElementById('admin-role-'+targetUserId)?.value||current?.admin_role||'readonly';
  if(active!==true&&!confirm('Desativar este administrador? O último Superadmin ativo nunca pode ser removido.'))return;
  try{
    await adminPerform('set-platform-admin',{targetUserId,active:active===true,adminRole:role});
    toast(active?'Acesso administrativo atualizado':'Administrador desativado');
  }catch(e){toast(String(e?.message||e))}
}
async function adminChangePlatformAdminRole(targetUserId){
  const current=(adminRuntime.data?.platformAdmins||[]).find(x=>x.user_id===targetUserId);
  if(!current)return toast('Administrador não encontrado');
  const role=document.getElementById('admin-role-'+targetUserId)?.value||current.admin_role;
  if(role===current.admin_role)return toast('O perfil já está selecionado');
  if(!confirm('Alterar o perfil deste administrador para '+adminRoleLabel(role)+'?'))return;
  if(role==='superadmin'&&!adminRequireTypedConfirmation('SUPERADMIN','Elevar uma conta a Superadmin concede autoridade máxima sobre o control plane.'))return toast('Alteração cancelada');
  return adminSetPlatformAdmin(targetUserId,current.active,role);
}
async function adminAddPlatformAdmin(){
  const targetEmail=document.querySelector('#admin-new-user-email')?.value.trim().toLowerCase()||'';
  const adminRole=document.querySelector('#admin-new-user-role')?.value||'readonly';
  if(targetEmail.length<3||targetEmail.length>160||!/^\S+@\S+\.\S+$/.test(targetEmail)){
    return toast('Informe um e-mail válido de conta permanente');
  }
  if(adminRole==='superadmin'&&!adminRequireTypedConfirmation('SUPERADMIN','Conceder Superadmin a uma nova conta entrega autoridade máxima sobre o control plane.'))return toast('Inclusão cancelada');
  try{
    await adminPerform('set-platform-admin',{targetEmail,active:true,adminRole});
    toast('Administrador adicionado como '+adminRoleLabel(adminRole));
  }catch(e){toast(String(e?.message||e))}
}

async function adminResolveBillingRefund(refundId,refundAction){
  const billing=adminRuntime.data?.merchantBilling||{};
  const refund=(billing.refunds||[]).find(x=>x.id===refundId);
  if(!refund)return toast('Refund financeiro não encontrado');
  if(refund.status!=='review_required')return toast('Este refund já foi resolvido');

  const recovery=(billing.refundRecoveries||[]).find(x=>x.refund_id===refund.id)||null;

  if(refundAction==='dismiss-unrelated'){
    if(refund.payment_request_id||refund.merchant_id){
      return toast('Refund ligado não pode ser descartado como não relacionado.');
    }
    const reference=prompt('Explique por que este refund não pertence a uma cobrança TAMÃO:')||'';
    if(reference.trim().length<3)return toast('Informe a referência da resolução');
    if(!confirm('Confirmar que este refund não está relacionado ao TAMÃO? Esta opção só funciona para item sem revenda/solicitação vinculada.'))return;
    try{
      await adminPerform('merchant-billing-refund',{
        refundId,
        refundAction:'dismiss-unrelated',
        reference
      });
      toast('Refund encerrado como não relacionado');
    }catch(e){toast(String(e?.message||e))}
    return;
  }

  if(refundAction==='dismiss-excess'){
    if(!refund.payment_request_id||!refund.merchant_id){
      return toast('Somente refund ligado pode ser reconhecido como excesso.');
    }
    if(refund.match_reason!=='refund_total_exceeds_original'){
      return toast('Este refund não excede a exposição original.');
    }
    if(recovery){
      return toast('Ainda existe valor recuperável. Quite/aprove a obrigação antes de tratar o excesso.');
    }
    const reference=prompt('Referência para reconhecer que este valor excede a exposição original e não deve virar dívida:')||'';
    if(reference.trim().length<3)return toast('Informe a referência da resolução');
    if(!confirm('Reconhecer este refund como excesso acima do pagamento original? O fato do PSP permanecerá auditável, mas nenhum valor adicional será cobrado da revenda.'))return;
    try{
      await adminPerform('merchant-billing-refund',{
        refundId,
        refundAction:'dismiss-excess',
        reference
      });
      toast('Excesso do PSP reconhecido sem criar dívida adicional');
    }catch(e){toast(String(e?.message||e))}
    return;
  }

  toast('Refund ligado só pode ser recuperado por pagamento aprovado; excesso só pode ser reconhecido quando não houver exposição restante.');
}

async function adminBillingPaymentEventAction(paymentEventId,eventAction){
  const event=(adminRuntime.data?.merchantBilling?.paymentEvents||[]).find(x=>x.id===paymentEventId);
  if(!event)return toast('Evento financeiro não encontrado');
  if(eventAction==='ignore'){
    if(event.status!=='review_required')return toast('Somente eventos em revisão podem ser ignorados');
    const reason=prompt('Motivo para ignorar este evento financeiro:')||'';
    if(reason.trim().length<3)return toast('Informe o motivo');
    if(!confirm('Ignorar este evento sem apagar seu histórico? Ele continuará auditável.'))return;
    try{
      await adminPerform('merchant-billing-payment-event',{paymentEventId,eventAction,reason});
      toast('Evento encerrado como ignorado');
    }catch(e){toast(String(e?.message||e))}
    return;
  }
  if(eventAction!=='recheck')return toast('Ação financeira inválida');
  try{
    await adminPerform('merchant-billing-payment-event',{paymentEventId,eventAction,reason:null});
    toast('Conciliação reprocessada');
  }catch(e){toast(String(e?.message||e))}
}

async function adminResolveBillingPaymentRequest(paymentRequestId,requestAction,reconciledEventId=null){
  const billing=adminRuntime.data?.merchantBilling||{};
  const request=(billing.paymentRequests||[]).find(x=>x.id===paymentRequestId);
  if(!request)return toast('Solicitação financeira não encontrada');
  if(request.status!=='pending')return toast('Esta solicitação já foi resolvida');
  const approve=requestAction==='approve';
  const expectedCents=Number(request.expected_amount_cents||0);
  const reconciledEvent=reconciledEventId
    ?(billing.paymentEvents||[]).find(x=>x.id===reconciledEventId)
    :null;
  if(reconciledEventId&&(
    !reconciledEvent
    ||reconciledEvent.status!=='matched_exact'
    ||reconciledEvent.payment_request_id!==request.id
  )){
    return toast('O evento conciliado mudou. Atualize o painel antes de aprovar.');
  }
  let receivedAmountCents=null;
  let paymentMethod=null;
  let reconciliationKey=null;
  if(approve&&reconciledEvent){
    receivedAmountCents=Number(reconciledEvent.amount_cents||0);
    paymentMethod=String(reconciledEvent.payment_method||'');
    reconciliationKey=String(reconciledEvent.reconciliation_key||'').trim();
    if(receivedAmountCents!==expectedCents){
      return toast('O evento não possui o valor exato desta solicitação.');
    }
  }else if(approve){
    const defaultAmount=(expectedCents/100).toFixed(2).replace('.',',');
    const receivedRaw=prompt('Valor efetivamente recebido (R$):',defaultAmount);
    if(receivedRaw==null)return;
    receivedAmountCents=adminParseMoneyToCents(receivedRaw);
    if(receivedAmountCents==null)return toast('Informe um valor recebido válido');
    if(receivedAmountCents!==expectedCents){
      return toast('Valor recebido diferente do esperado. Não é possível aprovar esta solicitação.');
    }
    const methodRaw=prompt('Forma confirmada: pix, transferencia, dinheiro, cartao ou outro','pix');
    if(methodRaw==null)return;
    paymentMethod=adminNormalizePaymentMethod(methodRaw);
    if(!paymentMethod)return toast('Informe uma forma de pagamento válida');
    const keyHint=paymentMethod==='pix'
      ? 'Identificador único da transação (EndToEndId do Pix):'
      : 'Identificador único da transação/recibo:';
    reconciliationKey=prompt(keyHint)||'';
    reconciliationKey=reconciliationKey.trim().replace(/\s+/g,' ');
    if(reconciliationKey.length<6||reconciliationKey.length>160){
      return toast('Informe um identificador único da transação entre 6 e 160 caracteres');
    }
  }
  const defaultReference=reconciledEvent
    ?'Evento '+reconciledEvent.provider+' • '+reconciledEvent.provider_event_id
    :'';
  const reference=prompt(
    approve?'Referência/observação da conferência financeira:':'Motivo da rejeição:',
    defaultReference
  )||'';
  if(reference.trim().length<3)return toast('Informe uma referência');
  const amount=adminMoney(expectedCents);
  const approvalEffect=request.request_kind==='package_purchase'
    ?'creditará o pacote na conta da revenda.'
    :request.request_kind==='refund_recovery'
      ?'comprovará a recuperação do refund e permitirá retirar o hold se não houver outra pendência.'
      :'quitará o fechamento diário.';
  const message=approve
    ? 'Confirmar recebimento exato de '+amount+' via '+adminPaymentMethodLabel(paymentMethod)+'? Esta ação '+approvalEffect
    : 'Rejeitar esta solicitação de '+amount+'? Nenhum saldo será movimentado.';
  if(!confirm(message))return;
  try{
    await adminPerform('merchant-billing-payment-request',{
      paymentRequestId,
      requestAction,
      reference,
      receivedAmountCents,
      paymentMethod,
      reconciliationKey,
      paymentEventId:reconciledEvent?.id??null
    });
    toast(approve?'Pagamento confirmado com valor conciliado':'Solicitação rejeitada');
  }catch(e){toast(String(e?.message||e))}
}
async function adminSaveBillingPlan(planKey,expectedVersion){
  const safeId=String(planKey).replace(/[^a-z0-9_-]/gi,'');
  const feePct=Number(document.getElementById('billing-plan-fee-'+safeId)?.value);
  if(!Number.isFinite(feePct)||feePct<=0||feePct>100)return toast('Informe uma taxa válida entre 0,01% e 100%');
  const platformFeeBps=Math.round(feePct*100);
  const active=planKey==='flex_daily'?true:document.getElementById('billing-plan-active-'+safeId)?.checked===true;
  const reason=prompt('Motivo para alterar este plano de cobrança:')||'';
  if(reason.trim().length<3)return toast('Informe o motivo da alteração');
  if(!confirm('Salvar esta alteração somente para PEDIDOS FUTUROS? Pedidos já criados manterão suas taxas snapshotadas.'))return;
  try{
    await adminPerform('merchant-billing-plan',{planKey,expectedVersion,platformFeeBps,active,reason});
    toast('Plano de cobrança atualizado para pedidos futuros');
  }catch(e){toast(String(e?.message||e))}
}

async function adminSetMerchantFlex(merchantId){
  const reference=prompt('Motivo/referência para voltar ao Flex:')||'';
  if(reference.trim().length<3)return toast('Informe uma referência');
  if(!confirm('Voltar '+adminMerchantName(merchantId)+' ao Flex Diário? Só será permitido sem crédito pré-pago disponível ou reservado.'))return;
  try{
    await adminPerform('merchant-billing-action',{merchantId,billingAction:'set-flex',reference});
    toast('Plano Flex ativado');
  }catch(e){toast(String(e?.message||e))}
}
async function adminResolveDailyStatement(merchantId,statementId,billingAction){
  if(billingAction!=='waive-statement'){
    return toast('Quitação D+1 exige uma solicitação de pagamento informada pela revenda.');
  }
  const reference=prompt('Motivo/referência do abono:')||'';
  if(reference.trim().length<3)return toast('Informe a referência');
  if(!confirm('Abonar este fechamento diário?'))return;
  try{
    await adminPerform('merchant-billing-action',{merchantId,statementId,billingAction,reference});
    toast('Fechamento diário abonado');
  }catch(e){toast(String(e?.message||e))}
}

async function adminFinancial(kind,targetId,financialAction){
  const reference=prompt('Referência da conciliação (opcional):')||'';
  try{
    await adminPerform('financial-action',{kind,targetId,financialAction,reference});
    toast('Conciliação registrada');
  }catch(e){toast(String(e?.message||e))}
}
async function adminReverseOrder(){
  const orderId=document.querySelector('#admin-reverse-order')?.value.trim()||'';
  const reason=document.querySelector('#admin-reverse-reason')?.value.trim()||'';
  const reference=document.querySelector('#admin-reverse-ref')?.value.trim()||'';
  if(!orderId||reason.length<3)return toast('Informe pedido e motivo');
  if(!confirm('Esta ação estornará benefícios e recebíveis do pedido. Confirmar?'))return;
  if(!adminRequireTypedConfirmation('ESTORNAR '+orderId,'Confirmação reforçada de reversão financeira.'))return toast('Reversão cancelada');
  try{
    await adminPerform('reverse-order',{orderId,reason,reference});
    toast('Reversão financeira registrada');
  }catch(e){toast(String(e?.message||e))}
}

globalThis.adminRuntime=adminRuntime;
globalThis.adminPortalRequested=adminPortalRequested;
globalThis.adminReady=adminReady;
globalThis.adminBackendInit=adminBackendInit;
globalThis.adminSendLogin=adminSendLogin;
globalThis.adminRetryBootstrapFromUi=adminRetryBootstrapFromUi;
globalThis.adminSignOut=adminSignOut;
globalThis.adminRefresh=adminRefresh;
globalThis.adminPoll=adminPoll;
globalThis.adminPage=adminPage;
globalThis.adminRetryReward=adminRetryReward;
globalThis.adminRetryAccounting=adminRetryAccounting;
globalThis.adminSetPlatformAdmin=adminSetPlatformAdmin;
globalThis.adminAddPlatformAdmin=adminAddPlatformAdmin;
globalThis.adminChangePlatformAdminRole=adminChangePlatformAdminRole;
globalThis.adminCreateIncident=adminCreateIncident;
globalThis.adminIncidentAction=adminIncidentAction;
globalThis.adminAuditSearch=adminAuditSearch;
globalThis.adminResolveBillingPaymentRequest=adminResolveBillingPaymentRequest;
globalThis.adminGenerateBillingWebhookProbe=adminGenerateBillingWebhookProbe;
globalThis.adminCopyText=adminCopyText;
globalThis.adminSaveBillingPlan=adminSaveBillingPlan;
globalThis.adminSetMerchantFlex=adminSetMerchantFlex;
globalThis.adminResolveDailyStatement=adminResolveDailyStatement;
globalThis.openAdminPortal=openAdminPortal;


globalThis.adminFilterRegistry=adminFilterRegistry;
globalThis.adminCreateProductCategory=adminCreateProductCategory;
globalThis.adminToggleProductCategory=adminToggleProductCategory;
globalThis.adminCreateRegistryProduct=adminCreateRegistryProduct;
globalThis.adminSetProductActive=adminSetProductActive;
globalThis.adminPreviewCommercialPolicy=adminPreviewCommercialPolicy;
globalThis.adminSaveCommercialPolicy=adminSaveCommercialPolicy;
globalThis.adminOpenWhatsapp=adminOpenWhatsapp;
globalThis.adminOrderControl=adminOrderControl;
globalThis.adminVerifyLaunchPortals=adminVerifyLaunchPortals;
globalThis.adminConfirmLaunchRequirement=adminConfirmLaunchRequirement;
globalThis.adminSetOperationMode=adminSetOperationMode;
globalThis.adminSetCommerceEnabled=adminSetCommerceEnabled;
globalThis.adminSetSupportStatus=adminSetSupportStatus;
globalThis.adminIssuePilotInvite=adminIssuePilotInvite;
globalThis.adminRevokePilotInvite=adminRevokePilotInvite;
globalThis.adminConvertPilotPartner=adminConvertPilotPartner;
