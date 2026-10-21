/* TAMÃO Discovery: consulta pública, sem pedidos nem cobranças. */
const discoveryVerticals={
  professionals:['Profissionais','Encontre prestadores de serviços na sua região','🛠️'],
  rides:['Caronas','Pesquise trajetos e vagas de caronas anunciadas','🚙'],
  stays:['Hospedagens','Explore hospedagens publicadas em destinos brasileiros','🏡']
};
// Allowlisted search intents only. No vehicle dispatch, price or availability promise.
const discoveryServiceShortcuts=Object.freeze({
 moto:{title:'Pedir uma moto',occupation:'Mototáxi',
  summary:'Consulte anúncios de mototaxistas e combine o atendimento diretamente.'},
 carro:{title:'Pedir um carro',occupation:'Motorista',
  summary:'Encontre motoristas e táxis anunciados; confirme valores e disponibilidade.'},
 fretes:{title:'Pedir um frete',occupation:'Frete',
  summary:'Consulte fretes, carretos e mudanças e solicite orçamento.'},
 entregas:{title:'Pedir uma entrega',occupation:'Entregador',
  summary:'Consulte entregadores e motoboys anunciados para combinar sua entrega.'}
});
function discoveryServiceFromUrl(){
 if(discoveryKind()!=='professionals'||discoverySharedListingId())return '';
 try{
  const key=new URLSearchParams(String(globalThis.location?.search||'').slice(0,1500)).get('servico')||'';
  return Object.hasOwn(discoveryServiceShortcuts,key)?key:'';
 }catch{return '';}
}
function discoveryServiceLinks(active){
 return '<nav class="discovery-service-links" aria-label="Moto, carro e entregas">'+
  Object.entries(discoveryServiceShortcuts).map(([key,item])=>
   '<a href="/?servico='+key+'#professionals"'+
   (active===key?' aria-current="page"':'')+'>'+item.title+'</a>').join('')+
  '<a href="/#rides">Encontrar carona</a></nav>';
}
function discoveryForgetServiceUrl(){
 try{
  const url=new URL(globalThis.location?.href||'');
  if(!url.searchParams.has('servico'))return;
  url.searchParams.delete('servico');
  globalThis.history?.replaceState?.(null,'',url.pathname+url.search+url.hash);
 }catch{/* A blocked history API never blocks the local search reset. */}
}
const discoveryRuntime=Object.create(null);

const discoverySavedMemory=Object.create(null);
const discoveryListingIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function discoverySavedIds(kind){
 if(!Object.hasOwn(discoveryVerticals,kind))return [];
 const key='tamao-discovery-saved-v1-'+kind;
 let raw=discoverySavedMemory[kind]||[];
 try{
  const stored=globalThis.localStorage?.getItem(key);
  if(stored!==null&&stored!==undefined)raw=JSON.parse(stored);
 }catch(_){/* Storage may be disabled; keep a session-only shortlist. */}
 if(!Array.isArray(raw))return [];
 return [...new Set(raw.filter(id=>typeof id==='string'&&discoveryListingIdPattern.test(id))
  .map(id=>id.toLowerCase()))].slice(0,30);
}
function discoverySaveIds(kind,ids){
 const clean=[...new Set(ids.filter(id=>discoveryListingIdPattern.test(id)))].slice(0,30);
 discoverySavedMemory[kind]=clean;
 try{globalThis.localStorage?.setItem('tamao-discovery-saved-v1-'+kind,JSON.stringify(clean))}
 catch(_){/* A private browser can still use its in-session shortlist. */}
}
function discoveryToggleSaved(id){
 const kind=discoveryKind(),s=kind?discoveryState(kind):null;
 const normalized=String(id||'').toLowerCase();
 if(!s||s.status!=='ready'||!discoveryListingIdPattern.test(normalized)||
    !s.items.some(item=>item?.id===normalized&&item.vertical===kind))return false;
 const saved=discoverySavedIds(kind),already=saved.includes(normalized);
 if(!already&&saved.length>=30){s.savedNotice='Limite de 30 anúncios salvos nesta categoria.';render();return false}
 discoverySaveIds(kind,already?saved.filter(value=>value!==normalized):[...saved,normalized]);
 if(already)s.compareIds=(s.compareIds||[]).filter(id=>id!==normalized);
 s.savedNotice=already?'Anúncio retirado dos salvos.':'Anúncio salvo para consultar nesta busca.';
 render();return true;
}
function discoveryToggleSavedFilter(){
 const kind=discoveryKind();
 if(!kind)return false;
 const s=discoveryState(kind);
 s.savedOnly=!s.savedOnly;
 s.savedNotice='';
 render();return true;
}
function discoveryToggleComparison(){
 const kind=discoveryKind();
 if(!kind)return false;
 const s=discoveryState(kind);
 s.compareOpen=!s.compareOpen;
 render();return true;
}
// Manual shortlist comparison never revives announcements absent from public search.
function discoveryPickForComparison(id){
 const kind=discoveryKind();
 if(!kind)return false;
 const s=discoveryState(kind),value=String(id||'').toLowerCase();
 if(!['ready','loading-more'].includes(s.status)||
    !discoveryListingIdPattern.test(value)||
    !discoverySavedIds(kind).includes(value)||
    !s.items.some(item=>item?.id===value&&item.vertical===kind))return false;
 const chosen=Array.isArray(s.compareIds)?s.compareIds:[];
 if(chosen.includes(value)){
  s.compareIds=chosen.filter(id=>id!==value);
  s.savedNotice='Anúncio retirado da comparação.';
 }else{
  if(chosen.length>=3){
   s.savedNotice='É possível comparar até três anúncios.';
   render();return false;
  }
  s.compareIds=[...chosen,value];
  s.savedNotice='Anúncio selecionado para comparar.';
 }
 s.compareOpen=true;
 render();return true;
}
function discoveryClearComparisonSelection(){
 const kind=discoveryKind();
 if(!kind)return false;
 const s=discoveryState(kind);
 s.compareIds=[];s.compareOpen=false;
 s.savedNotice='Seleção de comparação limpa.';
 render();return true;
}
function discoverySavedComparison(kind,items){
 const saved=new Set(discoverySavedIds(kind));
 const chosen=(discoveryState(kind).compareIds||[]).filter(id=>saved.has(id));
 const wanted=chosen.length?new Set(chosen):saved;
 const selected=(Array.isArray(items)?items:[]).filter(item=>
  item?.vertical===kind&&wanted.has(item.id)&&discoveryListingIdPattern.test(item.id)).slice(0,3);
 if(!selected.length)return '';
 const safeAmount=cents=>cents!==null&&cents!==undefined&&String(cents).trim()!==''&&
   Number.isSafeInteger(Number(cents))&&Number(cents)>=0&&
   Number(cents)<=50000000?BRL.format(Number(cents)/100):'';
 const entries=selected.map(item=>{
  const parts=[item.city_name,item.state_code].filter(x=>typeof x==='string'&&x.length<=120).map(esc);
  let fact='';
  if(kind==='professionals')fact=item.occupation?'Profissão: '+esc(String(item.occupation).slice(0,120)):'';
  if(kind==='rides'){
   const seats=Number(item.seats_available);
   const departure=Date.parse(String(item.departure_at||''));
   fact=(Number.isInteger(seats)&&seats>=1&&seats<=8?seats+' vagas anunciadas':'')+
    (Number.isFinite(departure)?' · Saída declarada: '+
      esc(new Date(departure).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})):'');
  }
  if(kind==='stays'){
   const guests=Number(item.guests),price=safeAmount(item.price_from_brl_cents);
   fact=(Number.isInteger(guests)&&guests>0&&guests<=80?'Até '+guests+' hóspedes':'')+
    (price&&['night','stay','week'].includes(item.price_unit)?' · Desde '+esc(price)+
      ' por '+({night:'noite',stay:'estadia',week:'semana'})[item.price_unit]:'');
  }
  const share=discoveryShareLink(item,kind);
  return '<article class="discovery-shortlist-card"><strong>'+esc(String(item.title||'').slice(0,120))+'</strong>'+
   '<span>'+parts.join(' / ')+'</span>'+(fact?'<p>'+fact+'</p>':'')+
   (share?'<a href="'+esc(share)+'">Abrir anúncio ↗</a>':'')+'</article>';
 }).join('');
 return '<section class="discovery-shortlist" aria-label="Comparação de anúncios salvos">'+
  '<h2>Compare os salvos desta busca</h2>'+
  '<p>Dados declarados nos anúncios carregados. Confirme preços, vagas e disponibilidade diretamente com o anunciante.</p>'+
  '<div class="discovery-shortlist-grid">'+entries+'</div></section>';
}

// Local ordering never changes the server query, authority, or publication state.
const discoverySortOptions={
 professionals:[['recent','Mais recentes'],['experience','Mais experiência declarada']],
 rides:[['recent','Mais recentes'],['departure','Próximas saídas'],['seats','Mais vagas anunciadas']],
 stays:[['recent','Mais recentes'],['price','Menor preço anunciado'],['capacity','Maior capacidade declarada']]
};
function discoverySortLoaded(kind,items,mode){
 const rows=Array.isArray(items)?items.slice():[];
 const options=discoverySortOptions[kind]||[];
 if(!options.some(([key])=>key===mode)||mode==='recent')return rows;
 const numeric=(value,max)=>value!==null&&value!==undefined&&
   String(value).trim()!==''&&Number.isSafeInteger(Number(value))&&
   Number(value)>=0&&Number(value)<=max?Number(value):null;
 const stamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&
   Number.isFinite(Date.parse(value))?Date.parse(value):null;
 const value=item=>{
  if(kind==='professionals'&&mode==='experience')return numeric(item?.years_experience,80);
  if(kind==='rides'&&mode==='departure')return stamp(item?.departure_at);
  if(kind==='rides'&&mode==='seats')return numeric(item?.seats_available,8);
  if(kind==='stays'&&mode==='price')return numeric(item?.price_from_brl_cents,50000000);
  if(kind==='stays'&&mode==='capacity')return numeric(item?.guests,80);
  return null;
 };
 const ascending=mode==='price'||mode==='departure';
 return rows.map((item,index)=>({item,index,rank:value(item)}))
  .sort((a,b)=>a.rank===null&&b.rank===null?a.index-b.index:
   a.rank===null?1:b.rank===null?-1:
   a.rank===b.rank?a.index-b.index:
   ascending?a.rank-b.rank:b.rank-a.rank)
  .map(entry=>entry.item);
}
function discoverySetSort(value){
 const kind=discoveryKind();
 if(!kind)return false;
 const mode=String(value||'');
 if(!(discoverySortOptions[kind]||[]).some(([key])=>key===mode))return false;
 const s=discoveryState(kind);
 s.sortMode=mode;
 render();return true;
}
function discoveryKind(){
  const r=route();
  return !globalThis.adminPortalRequested?.()&&!globalThis.merchantPortalRequested?.()
    &&Object.hasOwn(discoveryVerticals,r)?r:'';
}
function discoveryState(kind){
  return discoveryRuntime[kind]??=( {status:'idle',items:[],service:'',city:'',state:'',origin:'',destination:'',departureAfter:'',guests:'',occupation:'',minSeats:'',propertyType:'',maxPrice:'',sharedId:'',error:'',seq:0,offset:0,hasMore:false,savedOnly:false,compareOpen:false,savedNotice:'',sortMode:'recent',compareIds:[]} );
}
function discoveryCityKey(raw){
  return String(raw||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9 -]/g,'').trim().replace(/\s+/g,'-').slice(0,110);
}
function discoveryExploreCards(){
  return '<section class="section discovery-entrances"><h2>Explore mais no TAMÃO</h2>'+
  '<div class="discovery-entry-grid">'+Object.entries(discoveryVerticals).map(([key,v])=>
    '<button type="button" onclick="go(\''+key+'\')">'+v[2]+' <strong>'+v[0]+'</strong><span>Ver anúncios e oportunidades →</span></button>'
  ).join('')+'</div></section>';
}
function discoveryWhatsApp(item){
  const phone=String(item.whatsapp_e164||'');
  if(!/^\+[1-9][0-9]{7,14}$/.test(phone))return '';
  const title=String(item.title||'').trim().slice(0,80);
  const kind=String(item.vertical||'');
  const opening=kind==='rides'?'Olá! Vi sua carona anunciada no TAMÃO: ':
    kind==='stays'?'Olá! Vi sua hospedagem anunciada no TAMÃO: ':
    'Olá! Vi seu serviço anunciado no TAMÃO: ';
  const question=kind==='rides'?' Há vagas disponíveis? Podemos conversar sobre o trajeto e as condições?':
    kind==='stays'?' Gostaria de consultar datas, preços e condições diretamente com você.':
    ' Gostaria de solicitar um orçamento e confirmar a disponibilidade.';
  return 'https://wa.me/'+phone.slice(1)+'?text='+encodeURIComponent(opening+title+'.'+question);
}
function discoverySharedListingId(){
 const search=String(globalThis.location?.search||'').slice(0,700);
 const match=search.match(/(?:^\?|&)listing=([0-9a-f-]{36})(?:&|$)/i);
 const id=match?.[1]||'';
 return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)?id.toLowerCase():'';
}
function discoveryShareLink(item,kind){
 const id=String(item?.id||'').toLowerCase(),origin=String(globalThis.location?.origin||'');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)||
    !/^https:\/\/(?:www\.)?tamao\.com\.br$/.test(origin)||
    !Object.hasOwn(discoveryVerticals,kind))return '';
 return origin+'/?listing='+id+'#'+kind;
}
function discoveryPublicPhotoUrl(raw){
  const key=String(raw||'');
  if(!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/.test(key))return '';
  const base=String(CHAMA_BACKEND.url||'').replace(/\/+$/,'');
  if(!/^https:\/\//.test(base))return '';
  return base+'/storage/v1/object/public/tamao-discovery-photos/'+
    key.split('/').map(encodeURIComponent).join('/');
}
// Only moderated public marketing images are eligible for the visitor gallery.
function discoveryPublicGallery(item){
 const keys=Array.isArray(item?.photo_urls)?item.photo_urls:[];
 const photos=[...new Set(keys.filter(key=>typeof key==='string').map(discoveryPublicPhotoUrl).filter(Boolean))].slice(0,8);
 if(!photos.length)return '';
 const title=String(item?.title||'Anúncio').slice(0,100);
 const main='<img class="discovery-photo" src="'+esc(photos[0])+'" alt="'+
   esc('Foto principal de '+title)+'" loading="lazy" decoding="async">';
 if(photos.length===1)return '<div class="discovery-gallery">'+main+'</div>';
 const extra=photos.slice(1).map((url,i)=>
  '<img src="'+esc(url)+'" alt="'+esc('Foto '+(i+2)+' de '+title)+
  '" loading="lazy" decoding="async">').join('');
 return '<div class="discovery-gallery">'+main+
  '<details class="discovery-gallery-more"><summary>Ver mais '+(photos.length-1)+
  (photos.length===2?' foto':' fotos')+'</summary>'+
  '<div class="discovery-gallery-grid">'+extra+'</div></details></div>';
}
// Optional inquiry details: never a reservation, payment or availability promise.
function discoveryInquiryForm(item,kind){
 if(!Object.hasOwn(discoveryVerticals,kind))return '';
 const phone=String(item?.whatsapp_e164||'');
 if(!/^\+[1-9][0-9]{7,14}$/.test(phone))return '';
 const title=esc(String(item?.title||'').slice(0,80));
 const mode=kind==='professionals'?discoveryState('professionals').service:'';
 const mobility=Object.hasOwn(discoveryServiceShortcuts,mode)?mode:'';
 const count=kind==='professionals'?0:Number(kind==='rides'?item.seats_available:item.guests);
 if(kind!=='professionals'&&(!Number.isInteger(count)||count<1||count>(kind==='rides'?8:80)))return '';
 const mobilityInputs=
  '<label>Origem aproximada<input name="origin" required minlength="3" maxlength="120" placeholder="Bairro ou ponto de referência"></label>'+
  '<label>Destino aproximado<input name="destination" required minlength="3" maxlength="120" placeholder="Bairro ou região de destino"></label>'+
  '<label>Detalhes adicionais (opcional)<textarea name="service" maxlength="350" rows="2" placeholder="Quantidade de pessoas, tipo de carga ou observações, sem dados pessoais"></textarea></label>'+
  '<label>Dia desejado (opcional)<input name="preferred_day" type="date"></label>';
 const inputs=kind==='professionals'?(mobility?mobilityInputs:
  '<label>Qual serviço você precisa?<textarea name="service" required minlength="10" maxlength="500" rows="3" placeholder="Descreva o serviço e a região aproximada, sem informar dados pessoais."></textarea></label>'+
  '<label>Dia desejado (opcional)<input name="preferred_day" type="date"></label>'):
  kind==='rides'?
  '<label>Quantas vagas deseja consultar?<input name="seats" type="number" required min="1" max="'+count+'" value="1"></label>':
  '<label>Entrada desejada<input name="checkin" type="date" required></label>'+
  '<label>Saída desejada<input name="checkout" type="date" required></label>'+
  '<label>Hóspedes<input name="guests" type="number" required min="1" max="'+count+'" value="1"></label>';
 return '<details class="discovery-inquiry" data-phone="'+esc(phone)+
  '" data-kind="'+kind+'" data-service="'+mobility+'" data-title="'+title+'" data-max="'+count+'">'+
  '<summary>'+(kind==='professionals'?(mobility?
     (mobility==='moto'||mobility==='carro'?'Consultar trajeto e corrida':
      mobility==='fretes'?'Consultar frete':'Consultar entrega'):'Pedir orçamento com detalhes'):
    kind==='rides'?'Consultar quantidade de vagas':'Consultar datas e hóspedes')+'</summary>'+
  '<div class="discovery-inquiry-fields">'+inputs+'</div>'+
  '<p class="tiny muted">É apenas uma consulta direta. Orçamento, disponibilidade e condições dependem do anunciante. O TAMÃO não recebe pagamentos nesta etapa.</p>'+
  '<p class="discovery-inquiry-feedback" role="alert"></p>'+
  '<a href="#" target="_blank" rel="noopener noreferrer" onclick="return discoveryPrepareInquiry(this)">Preparar consulta no WhatsApp ↗</a>'+
  '</details>';
}
function discoveryPrepareInquiry(anchor){
 const box=anchor?.closest?.('.discovery-inquiry');
 const kind=String(box?.dataset?.kind||''),phone=String(box?.dataset?.phone||'');
 const title=String(box?.dataset?.title||'').slice(0,80);
 const limit=Number(box?.dataset?.max);
 const feedback=box?.querySelector?.('.discovery-inquiry-feedback');
 const invalid=message=>{if(feedback)feedback.textContent=message;return false};
 if(!/^\+[1-9][0-9]{7,14}$/.test(phone)||!title||
    !Number.isInteger(limit)||limit<0||limit>80||
    (kind!=='professionals'&&limit<1))return false;
 const number=name=>Number(box?.querySelector?.('[name="'+name+'"]')?.value);
 let message='';
 if(kind==='professionals'){
  const raw=String(box?.querySelector?.('[name="service"]')?.value||'');
  const service=raw.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim();
  const day=String(box?.querySelector?.('[name="preferred_day"]')?.value||'').trim();
  const validDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&
    Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
  const mode=String(box?.dataset?.service||'');
  const mobility=Object.hasOwn(discoveryServiceShortcuts,mode)?mode:'';
  if(mobility){
    const cleanRoute=name=>String(box?.querySelector?.('[name="'+name+'"]')?.value||'')
      .replace(/[\\u0000-\\u001f\\u007f]+/g,' ').replace(/\\s+/g,' ').trim();
    const origin=cleanRoute('origin'),destination=cleanRoute('destination');
    if(origin.length<3||origin.length>120||destination.length<3||destination.length>120)
      return invalid('Informe origem e destino aproximados, de 3 a 120 caracteres.');
    if(service.length>350)return invalid('Detalhes excedem 350 caracteres.');
    if(day&&(!validDay(day)||Date.parse(day)<Date.now()-86400000))
      return invalid('Informe uma data válida, a partir de hoje.');
    const request={moto:'uma corrida de moto',carro:'uma corrida de carro',
      fretes:'um frete',entregas:'uma entrega'}[mobility];
    message='Olá! Encontrei seu anúncio no TAMÃO: '+title+
      '. Gostaria de consultar '+request+'. Origem aproximada: '+origin+
      '. Destino aproximado: '+destination+
      (service?'. Detalhes: '+service:'')+
      (day?'. Dia desejado: '+day:'')+
      '. Podemos confirmar valores e disponibilidade diretamente?';
  }else{
    if(service.length<10||service.length>500)
      return invalid('Descreva o serviço em 10 a 500 caracteres.');
    if(day&&(!validDay(day)||Date.parse(day)<Date.now()-86400000))
      return invalid('Informe uma data válida, a partir de hoje.');
    message='Olá! Encontrei seu anúncio de serviço no TAMÃO: '+title+
      '. Gostaria de solicitar um orçamento. Serviço: '+service+
      (day?'. Dia desejado: '+day:'')+
      '. Podemos conversar sobre valores, região atendida e disponibilidade?';
  }
 }else if(kind==='rides'){
  const seats=number('seats');
  if(limit>8||!Number.isInteger(seats)||seats<1||seats>limit)
    return invalid('Informe uma quantidade de vagas válida.');
  message='Olá! Vi sua carona no TAMÃO: '+title+
    '. Gostaria de consultar '+seats+(seats===1?' vaga':' vagas')+
    '. Podemos confirmar disponibilidade, trajeto e condições?';
 }else if(kind==='stays'){
  const checkin=String(box?.querySelector?.('[name="checkin"]')?.value||'');
  const checkout=String(box?.querySelector?.('[name="checkout"]')?.value||'');
  const guests=number('guests');
  const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&
    Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
  if(!validDate(checkin)||!validDate(checkout)||checkout<=checkin||
     Date.parse(checkin)<Date.now()-86400000)
    return invalid('Informe entrada e saída válidas, com saída após a entrada.');
  if(!Number.isInteger(guests)||guests<1||guests>limit)
    return invalid('Informe uma quantidade de hóspedes válida.');
  message='Olá! Vi sua hospedagem no TAMÃO: '+title+
    '. Gostaria de consultar de '+checkin+' a '+checkout+' para '+
    guests+(guests===1?' hóspede':' hóspedes')+
    '. Pode confirmar disponibilidade e condições?';
 }else return false;
 if(feedback)feedback.textContent='';
 anchor.href='https://wa.me/'+phone.slice(1)+'?text='+encodeURIComponent(message);
 return true;
}
// Only a confirmed session can create a report; anonymous traffic is not
// silently forwarded to the privileged database API. The listing is rechecked
// by the server (published + enabled city) at submission time.
function discoveryReportForm(item,kind){
 const id=String(item?.id||'').toLowerCase();
 if(!discoveryListingIdPattern.test(id)||item?.vertical!==kind)return '';
 return '<details class="discovery-report"><summary>Informar problema com este anúncio</summary>'+
  '<form data-listing-id="'+id+'" onsubmit="discoverySubmitReport(event);return false;">'+
  '<label>Motivo<select name="reason" required>'+
   '<option value="">Selecione</option>'+
   '<option value="incorrect_information">Informação incorreta</option>'+
   '<option value="suspected_fraud">Possível fraude</option>'+
   '<option value="unsafe_content">Conteúdo perigoso</option>'+
   '<option value="other">Outro problema</option></select></label>'+
  '<label>Descreva o problema<textarea name="details" required minlength="12" maxlength="600" rows="3" '+
  'placeholder="Explique o ocorrido, sem incluir documentos ou dados pessoais."></textarea></label>'+
  '<p class="tiny muted">Exige uma conta TAMÃO verificada para prevenir abusos. A denúncia fica privada e é analisada pelo TAMÃO. <a href="#advertise">Entrar na minha conta TAMÃO</a></p>'+
  '<p class="discovery-report-feedback" role="status" aria-live="polite"></p>'+
  '<button type="submit">Enviar denúncia</button></form></details>';
}
async function discoverySubmitReport(event){
 event?.preventDefault?.();
 const form=event?.currentTarget,listingId=String(form?.dataset?.listingId||'');
 const reason=String(form?.querySelector?.('[name="reason"]')?.value||'');
 const details=String(form?.querySelector?.('[name="details"]')?.value||'').trim();
 const feedback=form?.querySelector?.('.discovery-report-feedback');
 const button=form?.querySelector?.('button[type="submit"]');
 const show=message=>{if(feedback)feedback.textContent=message;};
 const kind=discoveryKind(),state=kind?discoveryState(kind):null;
 if(!discoveryListingIdPattern.test(listingId)||
    !state?.items.some(x=>x.id===listingId&&x.vertical===kind)||
    !['incorrect_information','suspected_fraud','unsafe_content','other'].includes(reason)||
    details.length<12||details.length>600){
    show('Revise o motivo, a descrição e o anúncio publicado.');return false;
 }
 if(button?.disabled)return false;
 if(button)button.disabled=true;
 show('Conferindo sua conta e enviando denúncia…');
 try{
   const sdk=await loadSupabaseBrowser();
   const client=sdk.createClient(CHAMA_BACKEND.url,CHAMA_BACKEND.publishableKey,{
     auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,
       storageKey:'tamao-discovery-auth'},
     global:{fetch:chamaFetch}
   });
   const user=await client.auth.getUser();
   if(user.error||!user.data?.user){
      show('Entre em sua conta TAMÃO pelo link acima e depois volte a este anúncio para enviar a denúncia.');
      return false;
   }
   const sent=await client.rpc('discovery_submit_report',{
     p_listing_id:listingId,p_reason:reason,p_details:details
   });
   if(sent.error||!Number.isSafeInteger(Number(sent.data))||Number(sent.data)<=0)
      throw Error('REPORT_NOT_CONFIRMED');
   show('Denúncia registrada com protocolo '+String(sent.data)+'. A equipe poderá analisá-la no painel TAMÃO.');
   if(form.querySelector?.('[name="details"]'))form.querySelector('[name="details"]').value='';
 }catch(_){
   show('Não foi possível registrar a denúncia. Verifique a conexão ou a verificação da conta e tente novamente.');
 }finally{
   if(button)button.disabled=false;
 }
 return false;
}
function discoveryCard(item,kind){
  if(item?.vertical!==kind)return '';
  const loc=esc([item.city_name,item.state_code].filter(Boolean).join(' / '));
  const facts=[];
  const safeInt=(v,max)=>v!==null&&v!==undefined&&String(v).trim()!==''&&
    Number.isSafeInteger(Number(v))&&Number(v)>=0&&Number(v)<=max?Number(v):null;
  const price=cents=>BRL.format(cents/100);
  if(kind==='professionals'){
    if(item.occupation)facts.push(esc(item.occupation));
    if(item.service_area)facts.push('Atende: '+esc(String(item.service_area).slice(0,200)));
    const years=safeInt(item.years_experience,80);
    if(years!==null)facts.push(years+' '+(years===1?'ano':'anos')+' de experiência declarada');
  }else if(kind==='rides'){
    const places=[item.departure_city,item.destination_city].map(x=>esc(String(x||'').slice(0,120)));
    facts.push(places.join(' → '));
    const seats=safeInt(item.seats_available,8);
    if(seats!==null)facts.push(seats+' '+(seats===1?'vaga anunciada':'vagas anunciadas'));
    const departure=Date.parse(String(item.departure_at||''));
    if(Number.isFinite(departure))facts.push('Saída declarada: '+
      esc(new Date(departure).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})));
    const contribution=safeInt(item.proposed_cost_share_cents,500000);
    if(contribution!==null)facts.push('Contribuição sugerida por vaga: '+esc(price(contribution)));
  }else{
    const types={hotel:'Hotel',inn:'Pousada',holiday_house:'Casa de temporada',
      beach_house:'Casa de praia',apartment:'Apartamento',cabin:'Cabana',
      country_house:'Casa de campo',other:'Hospedagem'};
    if(Object.hasOwn(types,item.property_type))facts.push(types[item.property_type]);
    const guests=safeInt(item.guests,80),rooms=safeInt(item.bedrooms,60);
    if(guests!==null)facts.push('Até '+guests+' hóspedes');
    if(rooms!==null)facts.push(rooms+' '+(rooms===1?'quarto':'quartos'));
    const cents=safeInt(item.price_from_brl_cents,50000000);
    const units={night:'noite',stay:'estadia',week:'semana'};
    if(cents!==null&&Object.hasOwn(units,item.price_unit))
      facts.push('Preço anunciado desde '+esc(price(cents))+' por '+units[item.price_unit]);
    const amenities=Array.isArray(item.amenities)?item.amenities.filter(x=>
      typeof x==='string'&&x.trim()&&x.length<=60).slice(0,5):[];
    if(amenities.length)facts.push('Comodidades: '+amenities.map(x=>esc(x)).join(', '));
  }
  const actionText=kind==='rides'?'Consultar vagas pelo WhatsApp ↗':
    kind==='stays'?'Consultar datas pelo WhatsApp ↗':
    'Pedir orçamento pelo WhatsApp ↗';
  if(typeof item.public_area==='string'&&item.public_area.trim().length>=2&&
     item.public_area.length<=140)facts.unshift('Região: '+esc(item.public_area));
  const contact=discoveryWhatsApp(item),share=discoveryShareLink(item,kind);
  const id=String(item.id||'').toLowerCase();
  const canSave=discoveryListingIdPattern.test(id);
  const saved=canSave&&discoverySavedIds(kind).includes(id);
  const compared=saved&&(discoveryState(kind).compareIds||[]).includes(id);
  const gallery=discoveryPublicGallery(item);
  return '<article class="discovery-result">'+
    gallery+
    '<small>'+loc+'</small><h2>'+esc(item.title)+'</h2>'+
    (facts.length?'<ul class="discovery-facts">'+facts.map(x=>'<li>'+x+'</li>').join('')+'</ul>':'')+
    '<p>'+esc(item.description)+'</p>'+
    '<div class="discovery-actions">'+
    (contact?'<a href="'+esc(contact)+'" rel="noopener noreferrer" target="_blank">'+actionText+'</a>':'')+
    (share?'<a href="'+esc(share)+'" class="discovery-direct-link" aria-label="Abrir link direto deste anúncio">Abrir anúncio ↗</a>':'')+
    (canSave?'<button type="button" class="discovery-save" aria-pressed="'+saved+'" onclick="discoveryToggleSaved(\''+id+'\')">'+(saved?'★ Salvo':'☆ Salvar anúncio')+'</button>':'')+
    (saved?'<button type="button" class="discovery-pick" data-id="'+id+'" aria-pressed="'+compared+'" onclick="discoveryPickForComparison(this.dataset.id)">'+(compared?'✓ Comparando':'⇄ Selecionar comparação')+'</button>':'')+
    (share?'<a href="'+esc('https://wa.me/?text='+encodeURIComponent('Veja este anúncio publicado no TAMÃO: '+share))+'" target="_blank" rel="noopener noreferrer">Compartilhar anúncio ↗</a>':'')+
    '</div>'+discoveryInquiryForm(item,kind)+discoveryReportForm(item,kind)+'</article>';
}
function discoveryPage(){
  const kind=discoveryKind();
  if(!kind)return shell('<section><h1>Não encontrado</h1></section>');
  const s=discoveryState(kind),v=discoveryVerticals[kind],shortcut=kind==='professionals'?discoveryServiceShortcuts[s.service]:null;
  const savedIds=discoverySavedIds(kind);
  const savedSet=new Set(savedIds);
  const eligible=(s.status==='ready'||s.status==='loading-more')?s.items:[];
  const visible=s.savedOnly?eligible.filter(item=>savedSet.has(item?.id)):eligible;
  const visibleCount=visible.length;
  const displayItems=discoverySortLoaded(kind,visible,s.sortMode);
  const loadedSaved=eligible.filter(item=>savedSet.has(item?.id)).length;
  const content=s.status==='loading'?'<p role="status">Buscando anúncios publicados…</p>':
    s.status==='error'?'<div class="discovery-empty" role="alert"><p>Consulta indisponível no momento. Verifique a conexão e tente novamente.</p><button type="button" onclick="discoveryFetch()">Tentar novamente</button></div>':
    s.status==='ready'&&!visible.length?'<div class="discovery-empty"><p>'+(s.savedOnly?'Nenhum anúncio salvo entre os resultados carregados desta busca.':'Nenhum anúncio publicado encontrado com esses filtros.')+'</p>'+(s.savedOnly?'<button type="button" onclick="discoveryToggleSavedFilter()">Mostrar todos desta busca</button>':'<button type="button" onclick="discoveryClearFilters()">Ver todos os anúncios</button><button type="button" onclick="go(\'advertise\')">Anunciar no TAMÃO →</button>')+'</div>':
    displayItems.map(item=>discoveryCard(item,kind)).join('');
  return shell('<section class="section discovery-page"><header class="discovery-intro">'+
    '<span class="section-kicker">TAMÃO '+v[0].toUpperCase()+'</span><h1>'+esc(shortcut?.title||v[1])+'</h1>'+
    '<p>'+esc(shortcut?.summary||'Consulte anúncios publicados e fale diretamente com quem anunciou.')+'</p></header>'+
    (kind==='professionals'?discoveryServiceLinks(s.service):'')+
    '<form class="discovery-search" onsubmit="return discoverySearchFromUi(event)">'+
    '<label>UF<select id="discovery-uf"><option value="">Todo o Brasil</option>'+
    ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(uf=>
    '<option value="'+uf+'"'+(s.state===uf?' selected':'')+'>'+uf+'</option>').join('')+'</select></label>'+
    '<label>Cidade<input id="discovery-city" autocomplete="address-level2" placeholder="Digite a cidade" maxlength="120" value="'+esc(s.city)+'"></label>'+
    (kind==='professionals'?'<label>Profissão ou especialidade<input id="discovery-occupation" maxlength="100" placeholder="Ex.: eletricista" value="'+esc(s.occupation)+'"></label>':'')+
    (kind==='rides'
      ?'<label>Origem<input id="discovery-origin" maxlength="120" value="'+esc(s.origin)+'" placeholder="Saindo de"></label>'+
       '<label>Destino<input id="discovery-destination" maxlength="120" value="'+esc(s.destination)+'" placeholder="Indo para"></label>'+ 
       '<label>Saída a partir de<input id="discovery-departure-after" type="datetime-local" value="'+esc(s.departureAfter)+'"></label>'+
       '<label>Vagas mínimas<input id="discovery-min-seats" type="number" min="1" max="8" step="1" value="'+esc(s.minSeats)+'" placeholder="Ex.: 2"></label>'
      :kind==='stays'?'<label>Hóspedes<input id="discovery-guests" type="number" min="1" max="80" value="'+esc(s.guests)+'"></label>'+
       '<label>Tipo de hospedagem<select id="discovery-property-type"><option value="">Todos os tipos</option>'+
       [['hotel','Hotel'],['inn','Pousada'],['holiday_house','Casa de temporada'],['beach_house','Casa de praia'],['apartment','Apartamento'],['cabin','Cabana'],['country_house','Casa de campo'],['other','Outro']].map(([code,label])=>
        '<option value="'+code+'"'+(s.propertyType===code?' selected':'')+'>'+label+'</option>').join('')+'</select></label>'+
       '<label>Preço anunciado até (R$)<input id="discovery-max-price" type="number" min="0" max="500000" step="1" placeholder="Opcional" value="'+esc(s.maxPrice)+'"></label>':'')+
    '<button type="submit" class="primary">Pesquisar</button>'+
    '<button type="button" class="secondary" onclick="discoveryClearFilters()">Limpar filtros</button></form>'+
    '<div class="discovery-sort-bar"><label for="discovery-sort">Ordenar anúncios carregados</label>'+
     '<select id="discovery-sort" onchange="discoverySetSort(this.value)">'+
     discoverySortOptions[kind].map(([key,label])=>'<option value="'+key+'"'+(s.sortMode===key?' selected':'')+'>'+label+'</option>').join('')+
     '</select><span>Ordem local: não inclui anúncios ainda não carregados.</span></div>'+
    '<div class="discovery-saved-bar" aria-label="Anúncios salvos">'+
     '<span>★ '+savedIds.length+' salvo'+(savedIds.length===1?'':'s')+' neste navegador</span>'+
     '<button type="button" aria-pressed="'+Boolean(s.savedOnly)+'" onclick="discoveryToggleSavedFilter()">'+
      (s.savedOnly?'Ver todos os anúncios':'Mostrar salvos desta busca')+'</button>'+
     '<button type="button" aria-expanded="'+Boolean(s.compareOpen)+'" onclick="discoveryToggleComparison()"'+
      (loadedSaved?'':' disabled')+'>Comparar salvos ('+loadedSaved+')</button>'+
     (s.compareIds.length?'<button type="button" onclick="discoveryClearComparisonSelection()">Limpar seleção ('+s.compareIds.length+')</button>':'')+'</div>'+
    '<p class="discovery-saved-note">Salvos só aparecem após nova consulta ao servidor, se ainda estiverem publicados e disponíveis nesta busca.</p>'+
    (s.savedNotice?'<p class="discovery-saved-feedback" role="status">'+esc(s.savedNotice)+'</p>':'')+
    (s.compareOpen?discoverySavedComparison(kind,eligible):'')+
    '<p class="tiny muted">Disponibilidade e condições são confirmadas com o anunciante. O TAMÃO não processa pagamentos dessas contratações.</p>'+
    (visibleCount?'<p class="discovery-count" role="status">Exibindo '+visibleCount+
      (s.savedOnly?(visibleCount===1?' anúncio salvo':' anúncios salvos'):(visibleCount===1?' anúncio publicado':' anúncios publicados'))+
      (s.hasMore?' nesta busca. Há mais resultados para carregar.':'.')+'</p>':'')+
    '<div class="discovery-results" aria-live="polite">'+content+'</div>'+
    (s.hasMore?'<button type="button" class="secondary discovery-more" onclick="discoveryLoadMore()"'+(s.status==='loading-more'?' disabled':'')+'>'+(s.status==='loading-more'?'Carregando anúncios…':'Carregar mais anúncios')+'</button>':'')+
    (s.status==='ready'&&s.error?'<p role="alert">Não foi possível trazer mais anúncios. Tente novamente.</p>':'')+
    '</section>');
}
function discoverySearchFromUi(event){
  event?.preventDefault?.();
  const kind=discoveryKind();
  if(!kind)return false;
  const s=discoveryState(kind);
  s.sharedId=''; // Submitting filters leaves any incoming shared-detail link.
  s.state=String(document.getElementById('discovery-uf')?.value||'').slice(0,2);
  s.city=String(document.getElementById('discovery-city')?.value||'').trim().slice(0,120);
  s.origin=String(document.getElementById('discovery-origin')?.value||'').trim().slice(0,120);
  s.destination=String(document.getElementById('discovery-destination')?.value||'').trim().slice(0,120);
  s.departureAfter=kind==='rides'?String(document.getElementById('discovery-departure-after')?.value||'').trim().slice(0,16):'';
  s.guests=String(document.getElementById('discovery-guests')?.value||'').trim().slice(0,3);
  s.occupation=kind==='professionals'?String(document.getElementById('discovery-occupation')?.value||'').trim().slice(0,100):'';
  if(s.service&&s.occupation!==discoveryServiceShortcuts[s.service]?.occupation){s.service='';discoveryForgetServiceUrl();}
  s.minSeats=kind==='rides'?String(document.getElementById('discovery-min-seats')?.value||'').trim().slice(0,2):'';
  s.propertyType=kind==='stays'?String(document.getElementById('discovery-property-type')?.value||'').trim().slice(0,20):'';
  s.maxPrice=kind==='stays'?String(document.getElementById('discovery-max-price')?.value||'').trim().slice(0,12):'';
  discoveryFetch();
  return false;
}
function discoveryClearFilters(){
 const kind=discoveryKind();
 if(!kind)return;
 const s=discoveryState(kind);
 for(const field of ['city','state','origin','destination','departureAfter','guests',
   'occupation','service','minSeats','propertyType','maxPrice','sharedId'])s[field]='';
 discoveryForgetServiceUrl();
 s.offset=0;s.hasMore=false;
 discoveryFetch();
}
function discoveryLoadMore(){
 const kind=discoveryKind();
 if(kind&&discoveryState(kind).status==='ready'&&discoveryState(kind).hasMore)discoveryFetch(true);
}
async function discoveryFetch(more=false){
  const kind=discoveryKind();
  if(!kind)return;
  const s=discoveryState(kind);
  if(more&&(!s.hasMore||s.status!=='ready'))return;
  const seq=++s.seq,previous=more?s.items.slice():[],offset=more?s.offset:0;
  s.status=more?'loading-more':'loading';
  if(!more){s.items=[];s.offset=0;s.hasMore=false}
  s.error='';render();
  try{
    const sdk=await loadSupabaseBrowser();
    const client=sdk.createClient(CHAMA_BACKEND.url,CHAMA_BACKEND.publishableKey,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      global:{fetch:chamaFetch}
    });
    const shared=Boolean(s.sharedId); // A verified listing link must not inherit past search filters.
    const {data,error}=await client.rpc('discovery_public_search',{
      p_vertical:kind,p_state_code:shared?null:s.state||null,p_city_key:shared?null:discoveryCityKey(s.city)||null,
      p_departure_city:!shared&&kind==='rides'?s.origin||null:null,
      p_destination_city:!shared&&kind==='rides'?s.destination||null:null,
      // datetime-local is in the visitor's timezone; convert to UTC before RPC.
      p_departure_after:!shared&&kind==='rides'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s.departureAfter)&&
        Number.isFinite(Date.parse(s.departureAfter))?new Date(s.departureAfter).toISOString():null,
      p_min_guests:!shared&&kind==='stays'&&/^[1-9][0-9]?$/.test(s.guests)&&Number(s.guests)<=80?Number(s.guests):null,
      p_occupation_query:!shared&&kind==='professionals'&&s.occupation?s.occupation:null,
      p_min_seats:!shared&&kind==='rides'&&/^[1-8]$/.test(s.minSeats)?Number(s.minSeats):null,
      p_property_type:!shared&&kind==='stays'&&['hotel','inn','holiday_house','beach_house','apartment','cabin','country_house','other'].includes(s.propertyType)?s.propertyType:null,
      p_max_price_cents:!shared&&kind==='stays'&&/^(?:0|[1-9][0-9]{0,5})(?:[.][0-9]{1,2})?$/.test(s.maxPrice)&&Number(s.maxPrice)<=500000?Math.round(Number(s.maxPrice)*100):null,
      p_listing_id:s.sharedId||null,
      p_limit:24,p_offset:offset
    });
    if(error)throw error;
    if(seq!==s.seq)return;
    if(!Array.isArray(data))throw new Error('Resposta inválida');
    const rows=data.filter(item=>item&&item.vertical===kind);
    if(more){
      const seen=new Set(previous.map(item=>item.id));
      s.items=[...previous,...rows.filter(item=>!seen.has(item.id))];
    }else s.items=rows;
    s.offset=offset+data.length;
    s.hasMore=data.length===24&&s.offset<500;
    s.status='ready';
  }catch(e){
    if(seq!==s.seq)return;
    s.status=more?'ready':'error';
    if(more)s.items=previous;
    s.error=String(e?.message||'Falha na consulta.');
  }
  if(discoveryKind()===kind)render();
}
function discoveryAfterRender(){
  const kind=discoveryKind();
  if(kind&&discoveryState(kind).status==='idle'){
    const s=discoveryState(kind);
    s.sharedId=discoverySharedListingId();
    if(kind==='professionals'&&!s.sharedId){
     s.service=discoveryServiceFromUrl();
     if(s.service)s.occupation=discoveryServiceShortcuts[s.service].occupation;
    }
    discoveryFetch();
  }
}
