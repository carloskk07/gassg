/* TAMÃO Discovery: consulta pública, sem pedidos nem cobranças. */
const discoveryVerticals={
  professionals:['Profissionais','Encontre prestadores de serviços na sua região','🛠️'],
  rides:['Caronas','Pesquise trajetos e vagas de caronas anunciadas','🚙'],
  stays:['Hospedagens','Explore hospedagens publicadas em destinos brasileiros','🏡']
};
const discoveryRuntime=Object.create(null);
function discoveryKind(){
  const r=route();
  return !globalThis.adminPortalRequested?.()&&!globalThis.merchantPortalRequested?.()
    &&Object.hasOwn(discoveryVerticals,r)?r:'';
}
function discoveryState(kind){
  return discoveryRuntime[kind]??=( {status:'idle',items:[],city:'',state:'',origin:'',destination:'',departureAfter:'',guests:'',occupation:'',minSeats:'',propertyType:'',maxPrice:'',sharedId:'',error:'',seq:0,offset:0,hasMore:false} );
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
 const count=kind==='professionals'?0:Number(kind==='rides'?item.seats_available:item.guests);
 if(kind!=='professionals'&&(!Number.isInteger(count)||count<1||count>(kind==='rides'?8:80)))return '';
 const inputs=kind==='professionals'?
  '<label>Qual serviço você precisa?<textarea name="service" required minlength="10" maxlength="500" rows="3" placeholder="Descreva o serviço e a região aproximada, sem informar dados pessoais."></textarea></label>'+
  '<label>Dia desejado (opcional)<input name="preferred_day" type="date"></label>':
  kind==='rides'?
  '<label>Quantas vagas deseja consultar?<input name="seats" type="number" required min="1" max="'+count+'" value="1"></label>':
  '<label>Entrada desejada<input name="checkin" type="date" required></label>'+
  '<label>Saída desejada<input name="checkout" type="date" required></label>'+
  '<label>Hóspedes<input name="guests" type="number" required min="1" max="'+count+'" value="1"></label>';
 return '<details class="discovery-inquiry" data-phone="'+esc(phone)+
  '" data-kind="'+kind+'" data-title="'+title+'" data-max="'+count+'">'+
  '<summary>'+(kind==='professionals'?'Pedir orçamento com detalhes':
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
  if(service.length<10||service.length>500)
    return invalid('Descreva o serviço em 10 a 500 caracteres.');
  if(day&&(!validDay(day)||Date.parse(day)<Date.now()-86400000))
    return invalid('Informe uma data válida, a partir de hoje.');
  message='Olá! Encontrei seu anúncio de serviço no TAMÃO: '+title+
    '. Gostaria de solicitar um orçamento. Serviço: '+service+
    (day?'. Dia desejado: '+day:'')+
    '. Podemos conversar sobre valores, região atendida e disponibilidade?';
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
  const gallery=discoveryPublicGallery(item);
  return '<article class="discovery-result">'+
    gallery+
    '<small>'+loc+'</small><h2>'+esc(item.title)+'</h2>'+
    (facts.length?'<ul class="discovery-facts">'+facts.map(x=>'<li>'+x+'</li>').join('')+'</ul>':'')+
    '<p>'+esc(item.description)+'</p>'+
    '<div class="discovery-actions">'+
    (contact?'<a href="'+esc(contact)+'" rel="noopener noreferrer" target="_blank">'+actionText+'</a>':'')+
    (share?'<a href="'+esc(share)+'" class="discovery-direct-link" aria-label="Abrir link direto deste anúncio">Abrir anúncio ↗</a>':'')+
    (share?'<a href="'+esc('https://wa.me/?text='+encodeURIComponent('Veja este anúncio publicado no TAMÃO: '+share))+'" target="_blank" rel="noopener noreferrer">Compartilhar anúncio ↗</a>':'')+
    '</div>'+discoveryInquiryForm(item,kind)+'</article>';
}
function discoveryPage(){
  const kind=discoveryKind();
  if(!kind)return shell('<section><h1>Não encontrado</h1></section>');
  const s=discoveryState(kind),v=discoveryVerticals[kind];
  const content=s.status==='loading'?'<p role="status">Buscando anúncios publicados…</p>':
    s.status==='error'?'<div class="discovery-empty" role="alert"><p>Consulta indisponível no momento. Verifique a conexão e tente novamente.</p><button type="button" onclick="discoveryFetch()">Tentar novamente</button></div>':
    s.status==='ready'&&!s.items.length?'<div class="discovery-empty"><p>Nenhum anúncio publicado encontrado com esses filtros.</p><button type="button" onclick="discoveryClearFilters()">Ver todos os anúncios</button><button type="button" onclick="go(\'advertise\')">Anunciar no TAMÃO →</button></div>':
    s.items.map(item=>discoveryCard(item,kind)).join('');
  return shell('<section class="section discovery-page"><header class="discovery-intro">'+
    '<span class="section-kicker">TAMÃO '+v[0].toUpperCase()+'</span><h1>'+v[1]+'</h1>'+
    '<p>Consulte anúncios publicados e fale diretamente com quem anunciou.</p></header>'+
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
    '<p class="tiny muted">Disponibilidade e condições são confirmadas com o anunciante. O TAMÃO não processa pagamentos dessas contratações.</p>'+
    (s.items.length?'<p class="discovery-count" role="status">Exibindo '+s.items.length+
      (s.items.length===1?' anúncio publicado':' anúncios publicados')+
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
   'occupation','minSeats','propertyType','maxPrice','sharedId'])s[field]='';
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
    discoveryState(kind).sharedId=discoverySharedListingId();
    discoveryFetch();
  }
}
