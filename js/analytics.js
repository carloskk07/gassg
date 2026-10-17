const marketingAnalyticsState={
  landingAttempted:false,
  lastLandingRoute:null,
  observer:null,
  observedNodes:new WeakSet(),
  // In-memory sent/in-flight keys cover browsers where sessionStorage is blocked.
  sentKeys:new Set(),
  pendingKeys:new Set(),
  retryAfter:new Map()
};

function marketingAnalyticsEnabled(){
  const host=String(location.hostname||'').toLowerCase();
  return ['tamao.com.br','www.tamao.com.br'].includes(host)
    && globalThis.__CHAMA_TEST__!==true
    && globalThis.CHAMA_INTERNAL_PILOT!==true
    && globalThis.adminPortalRequested?.()!==true
    && globalThis.merchantPortalRequested?.()!==true;
}

function marketingAnalyticsAudience(){
  const current=typeof route==='function'?String(route()||'home'):String(location.hash||'#home').replace(/^#/,'');
  // The contact route can be opened from a sponsor CTA. Preserve only its
  // temporary audience hint, never identity or the message content.
  return ['merchants','merchant-join','sponsors'].includes(current)
    ||(current==='contact'&&globalThis.tamaoPublicContactAudience==='merchant')
    ?'merchant':'customer';
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
  const c=marketingAnalyticsContext();
  return [
    'tamao-fa-v1',
    String(eventType||''),
    String(audience||''),
    c.source,c.medium,c.campaign,c.content,c.landingPath
  ].join(':').slice(0,700);
}

async function marketingTrack(eventType,audience){
  if(!marketingAnalyticsEnabled())return false;
  if(!['landing_view','lead_form_view'].includes(eventType))return false;
  if(!['customer','merchant'].includes(audience))return false;
  const key=marketingAnalyticsSessionKey(eventType,audience);
  if(marketingAnalyticsState.sentKeys.has(key)||marketingAnalyticsState.pendingKeys.has(key))return false;
  if((marketingAnalyticsState.retryAfter.get(key)||0)>Date.now())return false;
  try{
    if(sessionStorage.getItem(key)==='1'){
      marketingAnalyticsState.sentKeys.add(key);
      return false;
    }
  }catch{}

  marketingAnalyticsState.pendingKeys.add(key);
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
    // A network attempt is NOT an accepted measurement. Only dedupe on HTTP success.
    marketingAnalyticsState.sentKeys.add(key);
    marketingAnalyticsState.retryAfter.delete(key);
    try{sessionStorage.setItem(key,'1')}catch{}
    return true;
  }catch(error){
    // A retry happens on a later render or renewed intersection; no background poll.
    marketingAnalyticsState.retryAfter.set(key,Date.now()+60000);
    console.warn('Medição agregada indisponível',String(error?.message||error));
    return false;
  }finally{
    marketingAnalyticsState.pendingKeys.delete(key);
  }
}

function marketingTrackLandingOnce(){
  // One anonymous aggregate per marketing page, not merely the first SPA render.
  // sessionStorage deduplication remains in marketingTrack; no customer identifiers.
  const current=typeof route==='function'?String(route()||'home'):'home';
  if(!['home','learn','earn','merchants','sponsors','contact'].includes(current))return;
  // Call safely on re-render. Successful events are deduped; failures may
  // be retried after cooldown instead of being lost for the entire session.
  marketingAnalyticsState.lastLandingRoute=current;
  marketingAnalyticsState.landingAttempted=true;
  marketingTrack('landing_view',marketingAnalyticsAudience()).catch(()=>{});
}

function marketingObserveLeadForms(){
  if(!marketingAnalyticsEnabled()||typeof IntersectionObserver==='undefined')return;
  if(!marketingAnalyticsState.observer){
    marketingAnalyticsState.observer=new IntersectionObserver(entries=>{
      for(const entry of entries){
        // A 1,500px-long form on a 360px-wide phone may never reach a 35%
        // intersection ratio. Count a meaningful visible portion instead.
        const visibleHeight=Number(entry.intersectionRect?.height||0);
        const targetHeight=Number(entry.boundingClientRect?.height||0);
        if(!entry.isIntersecting||visibleHeight<Math.min(120,targetHeight*.3))continue;
        const sponsorContact=entry.target.classList?.contains('public-contact-card')===true;
        if(sponsorContact&&(
          (typeof route==='function'?route():null)!=='contact'
          ||globalThis.tamaoPublicContactAudience!=='merchant'
        ))continue;
        const audience=entry.target.id==='partner-interest'||sponsorContact?'merchant':'customer';
        marketingTrack('lead_form_view',audience).then(ok=>{
          // Do not discard a form observation if the server rejects its event.
          if(ok)marketingAnalyticsState.observer?.unobserve(entry.target);
        }).catch(()=>{});
      }
    },{threshold:[0,0.1,0.35]});
  }
  const nodes=['early-access','partner-interest'].map(id=>document.getElementById(id));
  if((typeof route==='function'?route():null)==='contact'
    &&globalThis.tamaoPublicContactAudience==='merchant'){
    nodes.push(document.querySelector('.public-contact-card'));
  }
  for(const node of nodes){
    if(!node||marketingAnalyticsState.observedNodes.has(node))continue;
    marketingAnalyticsState.observedNodes.add(node);
    marketingAnalyticsState.observer.observe(node);
  }
}

function marketingAnalyticsAfterRender(){
  if(!marketingAnalyticsEnabled())return;
  if((typeof route==='function'?route():null)!=='contact'){
    globalThis.tamaoPublicContactAudience=null;
  }
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
