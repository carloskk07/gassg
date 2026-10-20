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
  return 'https://wa.me/'+phone.slice(1)+'?text='+encodeURIComponent('Olá, vi seu anúncio no TAMÃO: '+String(item.title||'').slice(0,80));
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
  const contact=discoveryWhatsApp(item),share=discoveryShareLink(item,kind);
  const photo=discoveryPublicPhotoUrl(Array.isArray(item.photo_urls)?item.photo_urls[0]:'');
  return '<article class="discovery-result">'+
    (photo?'<img class="discovery-photo" src="'+esc(photo)+'" alt="" loading="lazy" decoding="async">':'')+
    '<small>'+loc+'</small><h2>'+esc(item.title)+'</h2>'+
    (facts.length?'<ul class="discovery-facts">'+facts.map(x=>'<li>'+x+'</li>').join('')+'</ul>':'')+
    '<p>'+esc(item.description)+'</p>'+
    '<div class="discovery-actions">'+
    (contact?'<a href="'+esc(contact)+'" rel="noopener noreferrer" target="_blank">Conversar pelo WhatsApp ↗</a>':'')+
    (share?'<a href="'+esc('https://wa.me/?text='+encodeURIComponent('Veja este anúncio publicado no TAMÃO: '+share))+'" target="_blank" rel="noopener noreferrer">Compartilhar anúncio ↗</a>':'')+
    '</div></article>';
}
function discoveryPage(){
  const kind=discoveryKind();
  if(!kind)return shell('<section><h1>Não encontrado</h1></section>');
  const s=discoveryState(kind),v=discoveryVerticals[kind];
  const content=s.status==='loading'?'<p role="status">Buscando anúncios publicados…</p>':
    s.status==='error'?'<p role="alert">Consulta indisponível no momento. Verifique a conexão e tente novamente.</p>':
    s.status==='ready'&&!s.items.length?'<div class="discovery-empty"><p>Nenhum anúncio publicado encontrado com esses filtros.</p><button type="button" onclick="go(\'advertise\')">Anunciar no TAMÃO →</button></div>':
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
    const {data,error}=await client.rpc('discovery_public_search',{
      p_vertical:kind,p_state_code:s.state||null,p_city_key:discoveryCityKey(s.city)||null,
      p_departure_city:kind==='rides'?s.origin||null:null,
      p_destination_city:kind==='rides'?s.destination||null:null,
      // datetime-local is in the visitor's timezone; convert to UTC before RPC.
      p_departure_after:kind==='rides'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s.departureAfter)&&
        Number.isFinite(Date.parse(s.departureAfter))?new Date(s.departureAfter).toISOString():null,
      p_min_guests:kind==='stays'&&/^[1-9][0-9]?$/.test(s.guests)&&Number(s.guests)<=80?Number(s.guests):null,
      p_occupation_query:kind==='professionals'&&s.occupation?s.occupation:null,
      p_min_seats:kind==='rides'&&/^[1-8]$/.test(s.minSeats)?Number(s.minSeats):null,
      p_property_type:kind==='stays'&&['hotel','inn','holiday_house','beach_house','apartment','cabin','country_house','other'].includes(s.propertyType)?s.propertyType:null,
      p_max_price_cents:kind==='stays'&&/^(?:0|[1-9][0-9]{0,5})(?:[.][0-9]{1,2})?$/.test(s.maxPrice)&&Number(s.maxPrice)<=500000?Math.round(Number(s.maxPrice)*100):null,
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
