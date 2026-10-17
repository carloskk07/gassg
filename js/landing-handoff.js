/* TAMÃO V1.378 — Public editorial handoff, without tracking or persistence.
   Preserve only safe, allowlisted campaign parameters on public same-origin links. */
const TAMAO_LANDING_PASSTHROUGH={
  ref:40,
  utm_source:80,
  utm_medium:80,
  utm_campaign:120,
  utm_content:120,
  utm_term:120
};
function tamaoLandingHandoffUrl(href,sourceSearch,origin){
  let destination,base,source;
  try{
    base=new URL(origin);
    destination=new URL(href,base);
    source=new URLSearchParams(sourceSearch);
  }catch{return null}
  if(base.protocol!=='https:'||destination.origin!==base.origin)return null;
  // Reject private or unrecognized endpoints, even for a same-origin link.
  if(!/^\/(?:|como-funciona\/?|para-revendas\/?|para-marcas\/?|indicacoes\/?)$/.test(destination.pathname))return null;
  if(destination.hash&&!/^#(?:home|learn|merchants|sponsors|earn)$/.test(destination.hash))return null;
  let updated=false;
  for(const [key,max] of Object.entries(TAMAO_LANDING_PASSTHROUGH)){
    if(destination.searchParams.has(key))continue;
    const values=source.getAll(key);
    if(values.length!==1)continue;
    const value=values[0].trim();
    if(!value||value.length>max)continue;
    if(key==='ref'){
      if(!/^[A-Za-z0-9]{5,40}$/.test(value))continue;
    }else if(/[\x00-\x1f\x7f<>"'\x60]/.test(value)){
      continue;
    }
    destination.searchParams.set(key,value);
    updated=true;
  }
  return updated?destination.pathname+destination.search+destination.hash:null;
}
function tamaoLandingApplyHandoff(){
  if(typeof document==='undefined'||typeof location==='undefined')return 0;
  let changed=0;
  const origin=location.origin;
  for(const anchor of document.querySelectorAll('a[data-tamao-handoff]')){
    const href=anchor.getAttribute('href');
    if(!href)continue;
    const updated=tamaoLandingHandoffUrl(href,location.search,origin);
    if(!updated)continue;
    anchor.setAttribute('href',updated);
    changed++;
  }
  return changed;
}
if(typeof document!=='undefined'){
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',tamaoLandingApplyHandoff,{once:true});
  }else{
    tamaoLandingApplyHandoff();
  }
}
