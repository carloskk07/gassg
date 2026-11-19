/* V1.1072 — native, verified public participant page.
 * Never trust URL names, arbitrary photos, destination URLs, or money claims. */
(()=>{
 "use strict";
 const PROJECT="https://lgugwujpunhslavewffd.supabase.co";
 const API=PROJECT+"/functions/v1/participant-pages";
 const pathSlug=location.pathname.match(/^\/p\/([a-z0-9-]+)\/?$/)?.[1]||"";
 const transfer=location.pathname==='/p/'?
  String(new URLSearchParams(location.search).get('slug')||''):"";
 const slug=pathSlug||(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(transfer)&&transfer.length<=80?transfer:"");
 // Cloudflare verified 302 fallback serves the static page. Restore its
 // original premium short link locally without another network round trip.
 if(!pathSlug&&slug&&location.pathname==='/p/'){
  const url=new URL(location.href);
  url.pathname='/p/'+slug+'/';
  url.searchParams.delete('slug');
  history.replaceState(history.state,'',url.pathname+url.search+url.hash);
 }
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const codePattern=/^[A-Z0-9]{5,40}$/;
 const $=id=>document.getElementById(id);
 const text=(id,value)=>{const el=$(id);if(el)el.textContent=String(value||"")};
 function official(ref,params={},hash="home"){
  const u=new URL("https://tamao.com.br/");
  if(codePattern.test(String(ref||"")))u.searchParams.set("ref",ref);
  for(const [key,value] of Object.entries(params))if(value!==null&&value!=="")u.searchParams.set(key,String(value));
  u.hash=hash;return u.href;
 }
 function leaveLinks(ref){
  for(const anchor of document.querySelectorAll(".brand,footer a,#discover"))
   anchor.href=official(ref,{},"home");
 }
 function photo(key){
  if(!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/.test(String(key||"")))return "";
  return PROJECT+"/storage/v1/object/public/tamao-discovery-photos/"+
   String(key).split("/").map(encodeURIComponent).join("/");
 }
 function showMissing(){
  $("loading").hidden=true;$("content").hidden=true;$("missing").hidden=false;
  document.title="Página indisponível • TAMÃO";
 }
 function offerURL(ref,seller,item=""){
  return official(ref,{seller,item}, "order");
 }
 // An advertiser's approved HTTPS destination is NOT a TAMÃO checkout.
 // Do not append participant tokens to third-party sites.
 function externalAdvertiserURL(raw){
  const value=String(raw||"").trim();
  if(value.length<15||value.length>300||/[<>\s@\\]/.test(value))return "";
  try{
   const u=new URL(value),host=u.hostname.toLowerCase();
   return u.protocol==="https:"&&!u.username&&!u.password&&(!u.port||u.port==="443")
    &&host.includes(".")&&!host.endsWith(".local")&&!host.endsWith(".internal")
    &&!host.endsWith(".localhost")&&host!=="localhost"
    &&!/^\d+\.\d+\.\d+\.\d+$/.test(host)&&!host.startsWith("[")
    &&u.href.length<=300?u.href:"";
  }catch{return ""}
 }
 // The same five *real* product photos used in the TAMÃO storefront sprite.
 // Unknown product types keep a neutral catalog illustration, never a fake
 // photo of a product that the merchant does not actually sell.
 function productPhotoClass(code,label){
  const c=String(code||"").toUpperCase(),name=String(label||"").normalize("NFD")
   .replace(/[\u0300-\u036f]/g,"").toUpperCase();
  if(/^P(?:1|13|20|45|90)(?:$|_)/.test(c)||/^GAS\b/.test(name))return "gas";
  if(/^(?:WATER|AGUA)/.test(c)||/\bAGUA\b/.test(name))return "water";
  if(/^(?:CHARCOAL|CARVAO)/.test(c)||/\bCARVAO\b/.test(name))return "charcoal";
  if(/^(?:WOOD|LENHA)/.test(c)||/\bLENHA\b/.test(name))return "wood";
  if(/^(?:ICE|GELO)/.test(c)||/\bGELO\b/.test(name))return "ice";
  return "";
 }
 function productVisual(item){
  const kind=productPhotoClass(item.code,item.name);
  const visual=document.createElement("div");
  visual.className="product-visual"+(kind?" product-visual-"+kind:" product-visual-generic");
  visual.setAttribute("aria-hidden","true");
  if(!kind)visual.textContent="✦";
  return visual;
 }
 // Reuse only the professional's already approved listing or Agenda photos.
 // No new uploads, public personal data, or external image-service accounts.
 function showParticipantPhotos(keys){
  const out=$("photos");out.replaceChildren();
  for(const key of (Array.isArray(keys)?keys:[]).slice(0,6)){
   const url=photo(key);if(!url)continue;
   const img=document.createElement("img");
   img.src=url;img.alt="Foto publicada pelo participante";
   img.loading="lazy";img.decoding="async";out.appendChild(img);
  }
  out.hidden=out.children.length===0;
  const first=out.querySelector("img");
  if(first){
   const heroPhoto=document.createElement("img");
   heroPhoto.src=first.src;heroPhoto.className="visual-photo";heroPhoto.alt="";
   heroPhoto.decoding="async";heroPhoto.fetchPriority="high";
   $("visual-card").parentElement.prepend(heroPhoto);
   $("visual-card").classList.add("over-photo");
  }
 }

 async function load(){
  if(slug.length<4||slug.length>80||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))return showMissing();
  const ctl=new AbortController(),timeout=setTimeout(()=>ctl.abort(),12000);
  let data;
  try{
   const res=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:"view",slug}),signal:ctl.signal,cache:"no-store"});
   if(!res.ok)throw Error("NOT_AVAILABLE");
   data=await res.json();
  }catch{showMissing();return}finally{clearTimeout(timeout)}
  if(data?.source!=="participant_native_page_v1_1072"||
    data?.slug!==slug||!["merchant","customer","listing","agenda","driver","advertiser"].includes(data.kind))return showMissing();
  const theme=["clean","gold","rose","ocean","sunset","midnight"].includes(data.theme)?data.theme:"clean";
  const layout=["split","centered","editorial"].includes(data.layout)?data.layout:"split";
  document.body.className="theme-"+theme;
  document.body.dataset.layout=layout;
  const canonicalLink="https://tamao.com.br/p/"+slug+"/";
  const ref=codePattern.test(String(data.referralCode||""))?data.referralCode:"";
  leaveLinks(ref);
  const title=String(data.headline||data.name||"").slice(0,110);
  const name=String(data.name||"").slice(0,120);
  text("page-title",title);text("card-name",name);
  text("tagline",String(data.tagline||(
   data.kind==="merchant"?"Conheça esta revenda e consulte produtos disponíveis para sua região.":
   data.kind==="listing"?"Conheça os serviços e as condições do anunciante.":
   data.kind==="driver"?"Conheça o motorista e solicite atendimento pela plataforma.":
   data.kind==="advertiser"?"Conheça esta empresa e sua campanha na região.":
   data.kind==="agenda"?"Veja os serviços e agende diretamente com este profissional.":
   "Conheça o TAMÃO e as oportunidades da Rede."
  )).slice(0,320));
  const place=[String(data.city||"").slice(0,120),String(data.state||"").slice(0,2)].filter(Boolean).join("/");
  text("place",place);$("place").hidden=!place;
  text("kind",({merchant:"REVENDA NO TAMÃO",customer:"MINHA REDE TAMÃO",
   listing:data.vertical==="rides"?"CARONAS":"PROFISSIONAL NO TAMÃO",
   agenda:"AGENDA PROFISSIONAL",driver:"MOTORISTA NO TAMÃO",
   advertiser:"PUBLICIDADE • ANUNCIANTE INDEPENDENTE"})[data.kind]);
  const main=$("main-action");let action="",description="";
  if(data.kind==="merchant"&&uuid.test(String(data.merchantId||""))){
   action=offerURL(ref,data.merchantId);
   main.textContent="Comprar desta revenda →";
   description="Esta página direciona a consulta à revenda escolhida. O pedido só pode ser feito quando houver cobertura, estoque, preço e operação habilitada. O aceite continua obrigatório.";
   const items=Array.isArray(data.items)?data.items:[];
   const holder=$("items");holder.replaceChildren();
   for(const item of items.slice(0,20)){
    if(!/^[A-Z][A-Z0-9_]{1,31}$/.test(String(item.code||"")))continue;
    const article=document.createElement("article");
    const visual=productVisual(item);
    const title=document.createElement("strong");title.textContent=String(item.name||item.code).slice(0,80);
    const note=document.createElement("small");note.textContent="Preço e entrega confirmados no checkout.";
    const button=document.createElement("a");button.href=offerURL(ref,data.merchantId,item.code);button.textContent="Consultar este produto →";
    article.append(visual,title,note,button);holder.appendChild(article);
   }
   $("catalog").hidden=holder.children.length===0;
   const featured=$("cover-products");
   if(featured){
    featured.replaceChildren();
    for(const item of items.slice(0,3)){
     if(!/^[A-Z][A-Z0-9_]{1,31}$/.test(String(item.code||"")))continue;
     featured.appendChild(productVisual(item));
    }
    featured.hidden=featured.children.length===0;
   }
  }else if(data.kind==="listing"&&uuid.test(String(data.listingId||""))&&
   ["professionals","rides"].includes(data.vertical)){
   action=official(ref,{listing:data.listingId},data.vertical);
   main.textContent=data.vertical==="rides"?"Consultar esta carona →":"Solicitar este serviço →";
   description="O anúncio é consultado novamente no TAMÃO. Contato, disponibilidade e condições dependem da informação atual do anunciante.";
   showParticipantPhotos(data.photos);
  }else if(data.kind==="driver"&&uuid.test(String(data.listingId||""))&&
   data.vertical==="professionals"&&["moto","carro"].includes(data.driverMode)){
   action=official(ref,{corrida:data.listingId,modalidade:data.driverMode},"mobility");
   main.textContent=data.driverMode==="moto"?"Solicitar uma moto →":"Solicitar um carro →";
   description="O TAMÃO confere novamente o anúncio e a categoria do veículo antes de enviar qualquer solicitação. Disponibilidade, valor e atendimento dependem de confirmação do motorista.";
   showParticipantPhotos(data.photos);
  }else if(data.kind==="advertiser"&&uuid.test(String(data.campaignId||""))&&
   externalAdvertiserURL(data.destinationUrl)){
   action=externalAdvertiserURL(data.destinationUrl);
   main.textContent="Conhecer a empresa →";
   main.target="_blank";
   main.rel="noopener noreferrer nofollow sponsored";
   main.referrerPolicy="no-referrer";
   description="Publicidade identificada. Este link leva ao site informado pelo anunciante. Não constitui oferta de venda, pagamento ou garantia de atendimento pelo TAMÃO.";
  }else if(data.kind==="agenda"&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.agendaSlug||"")){
   const u=new URL("https://tamao.com.br/agenda/"+encodeURIComponent(data.agendaSlug)+"/");
   if(ref)u.searchParams.set("ref",ref);
   action=u.href;main.textContent="Agendar horário →";
   description="A disponibilidade e a confirmação são controladas pelo agendamento oficial do profissional.";
   showParticipantPhotos(data.photos);
  }else if(data.kind==="customer"){
   action=official(ref,{},"home");main.textContent="Conhecer o TAMÃO →";
   description="Este é o espaço de divulgação de um participante. O convite não assegura ganhos nem vantagens por simples acesso.";
  }else return showMissing();
  main.href=action;text("honesty",description);
  const whats=$("whatsapp-share");
  whats.href="https://wa.me/?text="+encodeURIComponent("Conheça "+name+" no TAMÃO: "+canonicalLink);
  whats.hidden=false;
  if(data.showGallery===false)$("photos").hidden=true;
  if(data.showCatalog===false)$("catalog").hidden=true;
  $("next").hidden=data.showDiscover===false;
  const details=String(data.details||"").trim().slice(0,2000);
  text("details",details);$("about").hidden=!details||data.showAbout===false;
  $("share").onclick=async()=>{
   const share={title:name+" • TAMÃO",text:"Conheça esta página no TAMÃO",url:canonicalLink};
   try{
    if(navigator.share){await navigator.share(share);return}
    if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(share.url);$("share").textContent="Link copiado ✓";return}
   }catch(e){if(e?.name==="AbortError")return;}
   $("share").textContent="Copie o endereço desta página";
  };
  document.title=name+" • TAMÃO";
  $("loading").hidden=true;$("content").hidden=false;$("missing").hidden=true;
 }
 load();
})();
