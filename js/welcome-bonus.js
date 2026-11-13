/* Welcome bonus #815: server is sole authority for the promotion and wallet.
   Absence of an authoritative response is not an available promotion. */
const tamaoWelcomeBonus={status:null,lastUser:null,lastClaimTryAt:0,inflight:false};
const tamaoCouponHome={package:null,loading:false};
function tamaoWelcomeRender(){
  const status=tamaoWelcomeBonus.status;
  const active=status?.active===true &&
    Number.isInteger(Number(status.remaining)) && Number(status.remaining)>0 &&
    Number(status.awardCents)===100;
  document.querySelectorAll('.tamao-welcome-offer').forEach(node=>{
    node.hidden=!active;
    if(active){
      const count=node.querySelector('[data-welcome-remaining]');
      if(count){
        const next=String(Math.min(100,Number(status.remaining)));
        if(count.textContent!==next)count.textContent=next;
      }
    }
  });
}
async function tamaoWelcomeRefreshStatus(){
  const config=typeof CHAMA_BACKEND!=='undefined'?CHAMA_BACKEND:null;
  if(!config?.url||!config?.publishableKey)return;
  try{
    const response=await fetch(config.url+'/rest/v1/rpc/welcome_bonus_status_v1_815',{
      method:'POST',cache:'no-store',
      headers:{'apikey':config.publishableKey,'Content-Type':'application/json'},
      body:'{}'
    });
    if(!response.ok)throw new Error('campaign_status_unavailable');
    const data=await response.json();
    tamaoWelcomeBonus.status=data;
  }catch{
    tamaoWelcomeBonus.status=null;
  }
  tamaoWelcomeRender();
}
async function tamaoWelcomeClaimVerifiedUser(){
  if(tamaoWelcomeBonus.inflight)return;
  const runtime=globalThis.liveRuntime;
  const session=runtime?.session;
  const user=session?.user;
  if(!runtime?.client||runtime.status!=='ready'||!session?.access_token||
     !user?.id||user.is_anonymous===true||!user.email||
     !user.email_confirmed_at||tamaoWelcomeBonus.lastUser===user.id)return;
  if(tamaoWelcomeBonus.status?.active!==true ||
     Date.now()-tamaoWelcomeBonus.lastClaimTryAt<60000)return;
  tamaoWelcomeBonus.lastClaimTryAt=Date.now();
  tamaoWelcomeBonus.inflight=true;
  const sameAccount=()=>globalThis.liveRuntime===runtime&&
    runtime.session?.user?.id===user.id&&
    runtime.session?.access_token===session.access_token;
  try{
    const {data,error}=await runtime.client.rpc('claim_welcome_bonus_v1_815');
    if(error)throw error;
    // A request may outlive logout/account switching. Only the actual
    // authenticated recipient can receive the local profile readback.
    if(!sameAccount())return;
    if(data?.granted===true){
      tamaoWelcomeBonus.lastUser=user.id;
      if(data.alreadyGranted!==true&&
         typeof liveSyncFinancialProfile==='function'){
        await liveSyncFinancialProfile({force:true});
      }
    }
    // Failed/ineligible/paused claims must not permanently mark the user as
    // granted; later eligibility or a resumed campaign may be retried.
    if(sameAccount())await tamaoWelcomeRefreshStatus();
  }catch{
    // Fail closed and allow retry on next page load; never credit locally.
  }finally{
    tamaoWelcomeBonus.inflight=false;
  }
}
function tamaoWelcomeBoot(){
  const app=document.getElementById('app');
  if(app)new MutationObserver(()=>{tamaoWelcomeRender();tamaoCouponHomeRender();}).observe(app,{childList:true,subtree:true});
  tamaoWelcomeRefreshStatus();
  tamaoCouponHomeRefresh();
  // Auth can be restored or converted from an anonymous visitor asynchronously.
  setInterval(tamaoWelcomeClaimVerifiedUser,2500);
  setInterval(tamaoWelcomeRefreshStatus,60000);
  setInterval(tamaoCouponHomeRefresh,60000);
}
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',tamaoWelcomeBoot,{once:true});
}else tamaoWelcomeBoot();

/* Only the audited general-purpose package is displayed, as a catalog price.
   Checkout remains controlled by the independently gated coupon-credit-pix API. */
function tamaoCouponHomeRender(){
  const p=tamaoCouponHome.package;
  const valid=p?.key==='all_products_3x5_sponsor'&&
    Number.isSafeInteger(p.priceCents)&&p.priceCents>=100&&
    Number.isSafeInteger(p.faceCents)&&p.faceCents>=100&&
    Number.isSafeInteger(p.couponCount)&&p.couponCount>=1&&p.couponCount<=15&&
    Number.isSafeInteger(p.minOrderCents)&&p.minOrderCents>=100&&
    Number.isSafeInteger(p.validDays)&&p.validDays>=1&&p.validDays<=365;
  const fmt=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
  document.querySelectorAll('.tamao-coupon-price-board').forEach(node=>{
    node.hidden=!valid;
    if(!valid)return;
    const updates={
      '[data-coupon-price]':fmt.format(p.priceCents/100),
      '[data-coupon-face]':p.couponCount+' cupons de '+fmt.format(p.faceCents/100),
      '[data-coupon-minimum]':'Para pedidos a partir de '+fmt.format(p.minOrderCents/100)+' • validade de '+p.validDays+' dias após emissão',
      '[data-coupon-availability]':p.databaseReleased===true
        ?'Confira e compre seu pacote com Pix pelo Clube TAMÃO.'
        :'Use os cupons em compras elegíveis após a emissão, conforme as condições do Clube TAMÃO.'
    };
    for(const [selector,value] of Object.entries(updates)){
      const el=node.querySelector(selector);
      if(el&&el.textContent!==value)el.textContent=value;
    }
  });
}
async function tamaoCouponHomeRefresh(){
  if(tamaoCouponHome.loading)return;
  const config=typeof CHAMA_BACKEND!=='undefined'?CHAMA_BACKEND:null;
  if(!config?.url||!config?.publishableKey)return;
  tamaoCouponHome.loading=true;
  try{
    const response=await fetch(config.url+'/rest/v1/rpc/clube_coupon_home_prices_v1_820',{
      method:'POST',cache:'no-store',
      headers:{apikey:config.publishableKey,'Content-Type':'application/json'},
      body:'{}'
    });
    if(!response.ok)throw new Error('public_coupon_prices_unavailable');
    const data=await response.json();
    if(data?.source!=='clube_coupon_home_prices_v1_820'||
       !Array.isArray(data.packages)||data.packages.length!==1)
      throw new Error('unverified_coupon_price_contract');
    tamaoCouponHome.package=data.packages[0];
  }catch{
    tamaoCouponHome.package=null;
  }finally{
    tamaoCouponHome.loading=false;
    tamaoCouponHomeRender();
  }
}
function tamaoWelcomeShowSignup(){
  const wrapper=document.querySelector('.tamao-welcome-offer:not([hidden])');
  if(!wrapper)return;
  const form=wrapper.querySelector('.tamao-welcome-signup');
  if(!form)return;
  form.hidden=false;
  form.querySelector('input[type=email]')?.focus();
}
// Existing members request a login link; registration preserves the visitor's
// anonymous account through the existing upgrade path. Neither action is a purchase.
async function tamaoClubSendAccess(email){
  const value=String(email||'').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw Error('INVALID_EMAIL');
  const runtime=globalThis.liveRuntime;
  if(globalThis.liveReady?.()!==true||!runtime?.client?.auth||
     typeof customerOriginSafe!=='function'||customerOriginSafe()!==true)
    throw Error('ACCOUNT_SERVICE_UNAVAILABLE');
  const client=runtime.client,userId=runtime.session?.user?.id;
  if(!globalThis.chamaTurnstile?.challenge)throw Error('AUTH_PROTECTION_UNAVAILABLE');
  const captchaToken=await globalThis.chamaTurnstile.challenge('customer_login');
  if(!captchaToken||globalThis.liveReady?.()!==true||customerOriginSafe()!==true||
     runtime!==globalThis.liveRuntime||client!==runtime.client||
     userId!==runtime.session?.user?.id)throw Error('ACCOUNT_CONTEXT_CHANGED');
  const redirect=new URL('/',location.origin);
  // Auth uses the URL fragment for tokens. Preserve the destination in a
  // query hint so the SDK can consume its fragment before opening the Club.
  redirect.searchParams.set('entrada','clube');
  const {error}=await client.auth.signInWithOtp({email:value,
    options:{emailRedirectTo:redirect.toString(),shouldCreateUser:false,captchaToken}});
  if(error)throw error;
  return {accessRequested:true};
}
async function tamaoWelcomeRegister(event){
  event.preventDefault();
  const form=event.currentTarget;
  const clubEntry=form?.dataset?.tamaoAccountContext==='club';
  const field=form?.querySelector('input[type=email]');
  const status=form?.querySelector('[data-welcome-signup-status]');
  const button=form?.querySelector('button[type=submit]');
  const buttons=clubEntry?Array.from(form.querySelectorAll('button[type=submit]')):[button].filter(Boolean);
  const email=String(field?.value||'').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    if(status)status.textContent='Informe um e-mail válido.';
    return false;
  }
  if(buttons.some(item=>item.disabled))return false;
  buttons.forEach(item=>item.disabled=true);
  if(status)status.textContent='Preparando confirmação…';
  try{
    const login=clubEntry&&event.submitter?.value!=='register';
    if(!login&&typeof liveUpgradeAccount!=='function')throw Error('ACCOUNT_SERVICE_UNAVAILABLE');
    const result=login?await tamaoClubSendAccess(email):await liveUpgradeAccount(email);
    if(status)status.textContent=result?.alreadyPermanent
      ?'Sua conta já está cadastrada. Consulte seu saldo e benefícios no Clube.'
      :result?.accessRequested?'Solicitamos seu link de acesso. Confira o e-mail e abra a mensagem neste navegador.':
       clubEntry?'Enviamos a confirmação para seu e-mail. Abra a mensagem para confirmar sua conta.':
       'Enviamos a confirmação para seu e-mail. Conclua a confirmação para participar, sujeito às vagas e às regras da campanha.';
    if(field&&result?.alreadyPermanent!==true)field.value='';
  }catch{
    if(status)status.textContent=clubEntry
      ?'Não foi possível enviar o acesso. Confira o e-mail e a conexão. Se for seu primeiro acesso, escolha “Criar minha conta”.'
      :'Não foi possível enviar a confirmação. Confira a conexão e tente novamente.';
  }finally{
    buttons.forEach(item=>item.disabled=false);
  }
  return false;
}
Object.assign(globalThis,{tamaoWelcomeShowSignup,tamaoWelcomeRegister});
