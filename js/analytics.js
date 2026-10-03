const marketingAnalyticsState={
  landingAttempted:false,
  observer:null,
  observedNodes:new WeakSet()
};

function marketingAnalyticsEnabled(){
  return globalThis.__CHAMA_TEST__!==true
    && globalThis.CHAMA_INTERNAL_PILOT!==true
    && globalThis.adminPortalRequested?.()!==true
    && globalThis.merchantPortalRequested?.()!==true;
}

function marketingAnalyticsAudience(){
  const current=typeof route==='function'?String(route()||'home'):String(location.hash||'#home').replace(/^#/,'');
  return ['merchants','merchant-join'].includes(current)?'merchant':'customer';
}

function marketingAnalyticsReferrerHost(){
  const value=String(document.referrer||'').trim();
  if(!value)return '';
  try{return new URL(value).hostname.toLowerCase().slice(0,253)}catch{return ''}
}

function marketingAnalyticsContext(){
  const params=new URLSearchParams(location.search);
  const safe=(key,max)=>String(params.get(key)||'').trim().slice(0,max);
  const current=typeof route==='function'?String(route()||'home'):'home';
  const hash=/^[A-Za-z0-9_-]{1,80}$/.test(current)?'#'+current:'#home';
  return {
    source:safe('utm_source',80),
    medium:safe('utm_medium',80),
    campaign:safe('utm_campaign',120),
    content:safe('utm_content',120),
    landingPath:String(location.pathname||'/').slice(0,150)+hash,
    referrerHost:marketingAnalyticsReferrerHost()
  };
}

function marketingAnalyticsSessionKey(eventType,audience){
  return 'tamao-fa-v1:'+String(eventType||'')+':'+String(audience||'');
}

async function marketingTrack(eventType,audience){
  if(!marketingAnalyticsEnabled())return false;
  if(!['landing_view','lead_form_view'].includes(eventType))return false;
  if(!['customer','merchant'].includes(audience))return false;
  const key=marketingAnalyticsSessionKey(eventType,audience);
  try{
    if(sessionStorage.getItem(key)==='1')return false;
    sessionStorage.setItem(key,'1');
  }catch{}

  try{
    const response=await globalThis.chamaFetch(
      CHAMA_BACKEND.url+'/functions/v1/capture-marketing-event',
      {
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'apikey':CHAMA_BACKEND.publishableKey
        },
        body:JSON.stringify({eventType,audience,...marketingAnalyticsContext()}),
        cache:'no-store',
        keepalive:true
      },
      5000
    );
    if(!response.ok)throw new Error('marketing event HTTP '+response.status);
    return true;
  }catch(error){
    console.warn('Medição agregada indisponível',String(error?.message||error));
    return false;
  }
}

function marketingTrackLandingOnce(){
  if(marketingAnalyticsState.landingAttempted)return;
  marketingAnalyticsState.landingAttempted=true;
  marketingTrack('landing_view',marketingAnalyticsAudience()).catch(()=>{});
}

function marketingObserveLeadForms(){
  if(!marketingAnalyticsEnabled()||typeof IntersectionObserver==='undefined')return;
  if(!marketingAnalyticsState.observer){
    marketingAnalyticsState.observer=new IntersectionObserver(entries=>{
      for(const entry of entries){
        if(!entry.isIntersecting||entry.intersectionRatio<0.35)continue;
        const audience=entry.target.id==='partner-interest'?'merchant':'customer';
        marketingTrack('lead_form_view',audience).catch(()=>{});
        marketingAnalyticsState.observer?.unobserve(entry.target);
      }
    },{threshold:[0.35]});
  }
  for(const id of ['early-access','partner-interest']){
    const node=document.getElementById(id);
    if(!node||marketingAnalyticsState.observedNodes.has(node))continue;
    marketingAnalyticsState.observedNodes.add(node);
    marketingAnalyticsState.observer.observe(node);
  }
}

function marketingAnalyticsAfterRender(){
  if(!marketingAnalyticsEnabled())return;
  marketingTrackLandingOnce();
  marketingObserveLeadForms();
}

Object.assign(globalThis,{
  marketingAnalyticsEnabled,
  marketingAnalyticsAudience,
  marketingAnalyticsContext,
  marketingTrack,
  marketingTrackLandingOnce,
  marketingObserveLeadForms,
  marketingAnalyticsAfterRender
});
