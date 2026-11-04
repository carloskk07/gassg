/* Welcome bonus #815: server is sole authority for the promotion and wallet.
   Absence of an authoritative response is not an available promotion. */
const tamaoWelcomeBonus={status:null,lastUser:null,lastClaimTryAt:0,inflight:false};
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
  try{
    const {data,error}=await runtime.client.rpc('claim_welcome_bonus_v1_815');
    if(error)throw error;
    tamaoWelcomeBonus.lastUser=user.id;
    if(data?.granted===true&&data?.alreadyGranted!==true&&
       typeof liveSyncFinancialProfile==='function'){
      await liveSyncFinancialProfile({force:true});
    }
    await tamaoWelcomeRefreshStatus();
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
const tamaoCouponHome={package:null,loading:false};
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
        ?'Preço cadastrado. Consulte no Clube se a compra por Pix está disponível.'
        :'Preço do pacote cadastrado. A venda ainda não está liberada; nenhum pagamento pode ser solicitado.'
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
async function tamaoWelcomeRegister(event){
  event.preventDefault();
  const form=event.currentTarget;
  const field=form?.querySelector('input[type=email]');
  const status=form?.querySelector('[data-welcome-signup-status]');
  const button=form?.querySelector('button[type=submit]');
  const email=String(field?.value||'').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    if(status)status.textContent='Informe um e-mail válido.';
    return false;
  }
  if(button?.disabled)return false;
  if(button)button.disabled=true;
  if(status)status.textContent='Preparando confirmação…';
  try{
    if(typeof liveUpgradeAccount!=='function')throw Error('ACCOUNT_SERVICE_UNAVAILABLE');
    const result=await liveUpgradeAccount(email);
    if(status)status.textContent=result?.alreadyPermanent
      ?'Sua conta já está cadastrada. Consulte seu saldo e benefícios no Clube.'
      :'Enviamos a confirmação para seu e-mail. Conclua a confirmação para participar, sujeito às vagas e às regras da campanha.';
    if(field&&result?.alreadyPermanent!==true)field.value='';
  }catch{
    if(status)status.textContent='Não foi possível enviar a confirmação. Confira a conexão e tente novamente.';
  }finally{
    if(button)button.disabled=false;
  }
  return false;
}
Object.assign(globalThis,{tamaoWelcomeShowSignup,tamaoWelcomeRegister});
