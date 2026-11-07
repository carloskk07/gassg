// V1.884 — sponsored creative surface. Browser visibility signals are NOT
// independently audited impressions and never create a payable amount.
const tamaoAdsDisplayCache=new Map();
let tamaoAdsViewportObserver=null;
let tamaoAdsViewTimer=null;
let tamaoAdsActiveToken=null;
let tamaoAdsLoadSequence=0;
function tamaoAdsPublicGateway(payload){
 const base=String(globalThis.CHAMA_BACKEND?.url||'').trim();
 const key=String(globalThis.CHAMA_BACKEND?.publishableKey||'').trim();
 if(!base||!key)throw Error('ADS_NOT_CONFIGURED');
 return fetch(base+'/functions/v1/ads-independent',{
  method:'POST',cache:'no-store',
  headers:{'Content-Type':'application/json','apikey':key},
  body:JSON.stringify(payload)
 }).then(async response=>{
   let data=null;try{data=await response.json()}catch{}
   if(!response.ok)throw Error(data?.message||'Consulta indisponível');
   return data;
 });
}
function tamaoAdsStopView(){
 if(tamaoAdsViewTimer){clearTimeout(tamaoAdsViewTimer);tamaoAdsViewTimer=null}
 if(tamaoAdsViewportObserver){tamaoAdsViewportObserver.disconnect();tamaoAdsViewportObserver=null}
 tamaoAdsActiveToken=null;
}
function tamaoAdsSafeUrl(raw){
 try{
  const url=new URL(String(raw||''));
  return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&
   url.hostname.includes('.')&&!url.hostname.endsWith('.local')&&
   !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)&&!url.hostname.startsWith('[')
   ?url.href:null;
 }catch{return null}
}
function tamaoAdsDraw(target,slot){
 tamaoAdsStopView();
 const host=document.getElementById(target);
 if(!host)return;
 if(!slot){host.textContent='';return}
 const url=tamaoAdsSafeUrl(slot.url);
 if(slot.label!=='Patrocinado'||!url||
   !/^[0-9a-f-]{36}$/i.test(String(slot.challenge||''))||
   !/^[0-9a-f-]{36}$/i.test(String(slot.campaignId||''))||
   typeof slot.title!=='string'||slot.title.length>80||
   typeof slot.description!=='string'||slot.description.length>240||
   typeof slot.advertiser!=='string'||slot.advertiser.length>120){
  host.textContent='';return;
 }
 host.innerHTML='<article class="card flat tamao-paid-placement" aria-label="Publicidade identificada" '+
  'style="border:1px solid var(--border, #ddd);padding:18px">'+
  '<span class="section-kicker">PATROCINADO</span>'+
  '<h3>'+esc(slot.title)+'</h3><p>'+esc(slot.description)+'</p>'+
  '<p class="tiny muted">Anunciante: '+esc(slot.advertiser)+' · '+
   esc(slot.city)+'/'+esc(slot.state)+'</p>'+
  '<a href="'+esc(url)+'" target="_blank" rel="nofollow noopener noreferrer sponsored" '+
   'referrerpolicy="no-referrer">Conhecer o anunciante ↗</a>'+
  '</article>';
 const creative=host.querySelector('article');
 if(!creative||typeof IntersectionObserver!=='function')return;
 const token=String(slot.challenge);
 tamaoAdsActiveToken=token;
 const canMeasure=()=>tamaoAdsActiveToken===token&&creative.isConnected&&
   document.visibilityState==='visible'&&document.hasFocus()&&
   (globalThis.route?.()||'')!=='admin';
 let ratio=0,start=0,reported=false;
 const stop=()=>{
  start=0;
  if(tamaoAdsViewTimer){clearTimeout(tamaoAdsViewTimer);tamaoAdsViewTimer=null}
 };
 const schedule=()=>{
  if(reported||!canMeasure()||ratio<0.5){stop();return}
  if(start)return;
  start=performance.now();
  tamaoAdsViewTimer=setTimeout(async()=>{
   tamaoAdsViewTimer=null;
   if(reported||!canMeasure()||ratio<0.5){stop();return}
   const elapsed=Math.floor(performance.now()-start);
   if(elapsed<1000){stop();return}
   reported=true;
   tamaoAdsViewportObserver?.disconnect();
   try{
    await tamaoAdsPublicGateway({action:'confirm',challenge:token,
     visibleMs:Math.min(60000,elapsed),visiblePercent:Math.min(100,Math.floor(ratio*100)),
     tabVisible:true});
   }catch{/* Never interrupt client navigation for non-billable analytics. */}
  },1250);
 };
 tamaoAdsViewportObserver=new IntersectionObserver(entries=>{
  for(const e of entries)if(e.target===creative){ratio=e.intersectionRatio;schedule()}
 },{threshold:[0,0.49,0.5,0.75,1]});
 tamaoAdsViewportObserver.observe(creative);
 const onHidden=()=>{if(document.visibilityState!=='visible')stop();else schedule()};
 document.addEventListener('visibilitychange',onHidden,{passive:true});
 // Remove the private listener once this placement is replaced.
 creative.addEventListener('tamao-ad-detach',()=>document.removeEventListener('visibilitychange',onHidden),{once:true});
}
async function tamaoAdsDisplaySlot(city,state,targetId){
 const name=String(city||'').trim(),uf=String(state||'').trim().toUpperCase();
 const target=String(targetId||'');
 if(name.length<2||name.length>100||!/^[A-Z]{2}$/.test(uf)||!/^tamao-ads-home-slot$|^sponsor-ad-live-slot$/.test(target))return;
 const key=uf+'/'+name.toLocaleUpperCase('pt-BR');
 const existing=tamaoAdsDisplayCache.get(key);
 const current=Date.now();
 const seq=++tamaoAdsLoadSequence;
 if(existing&&existing.expires>current){
  tamaoAdsDraw(target,existing.slot);return;
 }
 try{
  const r=await tamaoAdsPublicGateway({action:'serve',city:name,state:uf});
  if(seq!==tamaoAdsLoadSequence)return;
  if(r?.source!=='ads_independent_issue_v1_884'||r?.billingEnabled!==false||
     r?.noCharge!==true)return;
  const slot=r.slot||null;
  // A challenge is single-use. Do not cache a real slot across rerenders.
  if(!slot)tamaoAdsDisplayCache.set(key,{slot:null,expires:current+60000});
  tamaoAdsDraw(target,slot);
 }catch{/* Ads are optional; failures never hide organic catalog or payments. */}
}
function tamaoAdsDisplayHome(){
 const region=typeof rememberedMarketRegion==='function'?rememberedMarketRegion():null;
 if(!region||globalThis.route?.()!=='home')return;
 tamaoAdsDisplaySlot(region.city,region.state,'tamao-ads-home-slot');
}
