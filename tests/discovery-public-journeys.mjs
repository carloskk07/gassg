import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('js/discovery.js');
assert.doesNotThrow(()=>new vm.Script(source,{filename:'js/discovery.js'}));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);
let current='professionals',results=[],calls=[],rendered=0;
let requestedDeparture='',profession='Eletricista',minSeats='2',propertyType='inn',maxPrice='300';
const sandbox={
 route:()=>current,shell:s=>s,esc,BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 chamaFetch:async()=>({}),CHAMA_BACKEND:{url:'https://example.test',publishableKey:'test-publishable'},
 render:()=>{rendered++;},
 document:{getElementById:(id)=>({
   'discovery-uf':{value:'SC'},'discovery-city':{value:'Florianópolis'},
   'discovery-departure-after':{value:requestedDeparture},
   'discovery-occupation':{value:profession},
   'discovery-min-seats':{value:minSeats},
   'discovery-property-type':{value:propertyType},
   'discovery-max-price':{value:maxPrice}
 })[id]},
 loadSupabaseBrowser:async()=>({
   createClient:(_url,_key,opts)=>{
     assert.equal(opts.auth.persistSession,false);
     assert.equal(opts.auth.detectSessionInUrl,false);
     return {rpc:async(name,params)=>{calls.push([name,params]);return {data:results,error:null}}};
   }
 }),
 console
};
sandbox.globalThis=sandbox;
vm.runInNewContext(source,sandbox,{filename:'js/discovery.js'});
const title='<svg onload=alert(1)>';
results=[{
 id:'a',vertical:'professionals',title,description:'Trabalho realizado com cuidado',
 city_name:'São Gabriel',state_code:'RS',occupation:'Eletricista',whatsapp_e164:'+555599998888',
 photo_urls:['00000000-0000-0000-0000-000000000011/11111111-1111-1111-1111-111111111111.webp'],
 guests:null,seats_available:null
}];
const ownedPhoto='00000000-0000-0000-0000-000000000011/11111111-1111-1111-1111-111111111111.webp';
assert.match(sandbox.discoveryPublicPhotoUrl(ownedPhoto),
  /\/storage\/v1\/object\/public\/tamao-discovery-photos\//);
assert.equal(sandbox.discoveryPublicPhotoUrl('https://attacker.example/tracker.jpg'),'');
assert.equal(sandbox.discoveryPublicPhotoUrl('../private.pdf'),'');
assert.match(sandbox.discoveryExploreCards(),/onclick="go\('professionals'\)"/);
assert.match(sandbox.discoveryExploreCards(),/onclick="go\('rides'\)"/);
assert.match(sandbox.discoveryExploreCards(),/onclick="go\('stays'\)"/);
const initial=sandbox.discoveryPage();
assert.match(initial,/TAMÃO PROFISSIONAIS/);
assert.match(initial,/id="discovery-city"/);
sandbox.discoveryAfterRender();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(rendered>0,true);
assert.equal(calls.length,1);
assert.equal(calls[0][0],'discovery_public_search');
assert.equal(calls[0][1].p_vertical,'professionals');
assert.equal(calls[0][1].p_limit,24);
const displayed=sandbox.discoveryPage();
assert.match(displayed,/Eletricista/);
assert.doesNotMatch(displayed,/<svg onload/);
assert.match(displayed,/&lt;svg onload=alert\(1\)&gt;/);
assert.match(displayed,/wa\.me\/555599998888/);
assert.doesNotMatch(displayed,/email|owner_id|user_id/i);
sandbox.discoverySearchFromUi({preventDefault(){}});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls.at(-1)[1].p_state_code,'SC');
assert.equal(calls.at(-1)[1].p_city_key,'florianopolis');
assert.match(sandbox.discoveryPage(),/id="discovery-occupation"/);
assert.equal(calls.at(-1)[1].p_occupation_query,'Eletricista');
assert.equal(calls.at(-1)[1].p_min_seats,null);
assert.equal(calls.at(-1)[1].p_property_type,null);
assert.equal(calls.at(-1)[1].p_max_price_cents,null);
for(const [kind,term] of [['rides','CARONAS'],['stays','HOSPEDAGENS']]){
 current=kind;
 results=[];
 sandbox.discoveryAfterRender();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.at(-1)[1].p_vertical,kind);
 const page=sandbox.discoveryPage();
 assert.match(page,new RegExp('TAMÃO '+term));
 assert.match(page,/Nenhum anúncio publicado encontrado/);
}
current='rides';
requestedDeparture='2030-03-10T09:30';
assert.match(sandbox.discoveryPage(),/id="discovery-departure-after"/);
sandbox.discoverySearchFromUi({preventDefault(){}});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls.at(-1)[1].p_departure_after,new Date(requestedDeparture).toISOString(),
 'ride date filter must be sent in UTC, preserving local visitor intent');
assert.equal(calls.at(-1)[1].p_min_guests,null);
assert.match(sandbox.discoveryPage(),/id="discovery-min-seats"/);
assert.equal(calls.at(-1)[1].p_min_seats,2);
assert.equal(calls.at(-1)[1].p_occupation_query,null);
assert.equal(calls.at(-1)[1].p_max_price_cents,null);
current='stays';
requestedDeparture='';
sandbox.discoverySearchFromUi({preventDefault(){}});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls.at(-1)[1].p_departure_after,null,
 'stays must not inherit ride date filters');
assert.match(sandbox.discoveryPage(),/id="discovery-property-type"/);
assert.match(sandbox.discoveryPage(),/id="discovery-max-price"/);
assert.equal(calls.at(-1)[1].p_property_type,'inn');
assert.equal(calls.at(-1)[1].p_max_price_cents,30000);
assert.equal(calls.at(-1)[1].p_min_seats,null);
assert.equal(calls.at(-1)[1].p_occupation_query,null);
// Invalid and deliberately oversized values never become broad, unintended RPC filters.
minSeats='9';propertyType='other<script>';maxPrice='600000';
current='rides';sandbox.discoverySearchFromUi({preventDefault(){}});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls.at(-1)[1].p_min_seats,null);
current='stays';sandbox.discoverySearchFromUi({preventDefault(){}});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls.at(-1)[1].p_property_type,null);
assert.equal(calls.at(-1)[1].p_max_price_cents,null);
// Truthful detail cards from moderated public attributes only.
const professionalCard=sandbox.discoveryCard({
 vertical:'professionals',title:'Eletricista regional',city_name:'São Gabriel',
 state_code:'RS',description:'Atendimento direto e orçamento com profissional.',
 occupation:'Eletricista',service_area:'São Gabriel e entorno',years_experience:12,
 whatsapp_e164:'+555599998888'
},'professionals');
assert.match(professionalCard,/Atende: São Gabriel e entorno/);
assert.match(professionalCard,/12 anos de experiência declarada/);
const rideCard=sandbox.discoveryCard({
 vertical:'rides',title:'Carona região',description:'Saída anunciada',
 departure_city:'São Gabriel',destination_city:'Bagé',seats_available:2,
 departure_at:'2030-07-05T12:00:00Z',proposed_cost_share_cents:3500
},'rides');
assert.match(rideCard,/2 vagas anunciadas/);
assert.match(rideCard,/Contribuição sugerida por vaga: R\$\s?35,00/);
assert.doesNotMatch(rideCard,/Pagamento realizado|Reserva confirmada/);
const stayCard=sandbox.discoveryCard({
 vertical:'stays',title:'Pousada teste',description:'Condições declaradas',
 property_type:'inn',guests:4,bedrooms:2,price_from_brl_cents:28900,
 price_unit:'night',amenities:['Wi-Fi','<img src=x onerror=alert(1)>']
},'stays');
assert.match(stayCard,/Pousada/);
assert.match(stayCard,/2 quartos/);
assert.match(stayCard,/Preço anunciado desde R\$\s?289,00 por noite/);
assert.doesNotMatch(stayCard,/<img src=x onerror/);
assert.match(stayCard,/&lt;img src=x onerror=alert\(1\)&gt;/);
assert.equal(sandbox.discoveryCard({...results[0],vertical:'stays'},'rides'),'');
const publicId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
sandbox.location={origin:'https://tamao.com.br',search:'?listing='+publicId};
const shared=sandbox.discoveryShareLink({id:publicId},'professionals');
assert.equal(shared,'https://tamao.com.br/?listing='+publicId+'#professionals');
assert.equal(sandbox.discoveryShareLink({id:'invalid'},'professionals'),'');
assert.equal(sandbox.discoveryShareLink({id:publicId},'unknown'),'');
assert.match(sandbox.discoveryCard({
 vertical:'professionals',id:publicId,title:'Eletricista publicado',
 description:'Visita comercial',city_name:'São Gabriel',state_code:'RS'
},'professionals'),/Compartilhar anúncio/);
current='rides';
sandbox.discoveryState('rides').status='idle';
sandbox.discoveryAfterRender();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls.at(-1)[1].p_listing_id,publicId,'deep link must be fetched from approved server search');
assert.equal(calls.at(-1)[1].p_vertical,'rides','shared links never mix modalities');
sandbox.discoverySearchFromUi({preventDefault(){}});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls.at(-1)[1].p_listing_id,null,'manual search must leave shared detail mode');
sandbox.location.search='?listing=<script>'; 
assert.equal(sandbox.discoverySharedListingId(),'','invalid share ids rejected');
// Server pagination is bounded; a duplicate cannot make a second card.
sandbox.location.search='';
current='professionals';
sandbox.discoveryState('professionals').status='idle';
results=Array.from({length:24},(_,i)=>({
 id:'ad-'+i,vertical:'professionals',title:'Profissional publicado '+i,
 description:'Contato declarado',occupation:'Eletricista'
}));
sandbox.discoveryAfterRender();
await new Promise(resolve=>setImmediate(resolve));
assert.match(sandbox.discoveryPage(),/Carregar mais anúncios/);
assert.equal(calls.at(-1)[1].p_offset,0);
results=[
 {id:'ad-23',vertical:'professionals',title:'Anúncio repetido',description:'Mesmo anúncio'},
 {id:'ad-24',vertical:'professionals',title:'Anúncio adicional',description:'Novo resultado'}
];
sandbox.discoveryLoadMore();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls.at(-1)[1].p_offset,24);
assert.equal(sandbox.discoveryState('professionals').items.length,25);
assert.doesNotMatch(sandbox.discoveryPage(),/Carregar mais anúncios/);
sandbox.discoveryClearFilters();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(sandbox.discoveryState('professionals').city,'');
assert.equal(sandbox.discoveryState('professionals').occupation,'');
assert.equal(calls.at(-1)[1].p_city_key,null);
assert.equal(calls.at(-1)[1].p_occupation_query,null);
assert.match(sandbox.discoveryPage(),/Limpar filtros/);
results=[];
sandbox.discoveryClearFilters();
await new Promise(resolve=>setImmediate(resolve));
assert.match(sandbox.discoveryPage(),/Anunciar no TAMÃO/);

current='admin';
assert.equal(sandbox.discoveryKind(),'');
const html=read('index.html'),sw=read('sw.js'),boot=read('js/bootstrap.js'),
 home=read('js/customer.js'),css=read('css/discovery.css');
for(const file of ['js/discovery.js','css/discovery.css']){
 assert.ok(!html.includes('./'+file),'discovery must not load on startup');
 assert.ok(!sw.includes("'./"+file+"'"),'discovery must be lazy in PWA cache');
 assert.ok(boot.includes('./'+file),'the lazy loader must reference the asset');
}
for(const kind of ['professionals','rides','stays']){
 assert.ok(boot.includes(kind+":typeof discoveryPage==='function'"),kind+' lazy route missing');
}
assert.match(boot,/discoveryRequestModule/);
assert.match(home,/tamaoDiscoveryEntryHub/);
assert.match(css,/@media\(max-width:760px\)/);
// Responsive gallery uses approved public paths only, with no document identifiers or network extras.
const galleryId='11111111-1111-4111-8111-111111111111';
const imageKey=i=>galleryId+'/'+String(i).padStart(8,'0')+'-2222-4222-8222-222222222222.webp';
const galleryPhotos=Array.from({length:11},(_,i)=>imageKey(i));
const gallery=sandbox.discoveryPublicGallery({
 title:'Casa <b>com fotos</b>',photo_urls:[
  galleryPhotos[0],galleryPhotos[0],'../private-credential.pdf',
  'https://tracking.invalid/collect',...galleryPhotos.slice(1)
 ]
});
assert.match(gallery,/Foto principal de Casa &lt;b&gt;com fotos&lt;\/b&gt;/);
assert.match(gallery,/Ver mais 7 fotos/);
assert.equal((gallery.match(/<img /g)||[]).length,8,'bounded image gallery');
assert.doesNotMatch(gallery,/private-credential|tracking\.invalid|<b>com fotos/);
assert.equal(sandbox.discoveryPublicGallery({photo_urls:['../document.pdf']}),'');
assert.doesNotMatch(sandbox.discoveryPublicGallery({photo_urls:[galleryPhotos[0],galleryPhotos[0]]}),/Ver mais/);
const fullCard=sandbox.discoveryCard({
 vertical:'stays',id:publicId,title:'Pousada central',
 description:'Hospedagem anunciada',city_name:'São Gabriel',state_code:'RS',
 photo_urls:galleryPhotos.slice(0,3),whatsapp_e164:'+555599998888'
},'stays');
assert.match(fullCard,/Ver mais 2 fotos/);
assert.match(fullCard,/Abrir link direto deste anúncio/);
assert.match(fullCard,/https:\/\/tamao\.com\.br\/\?listing=/);
assert.doesNotMatch(fullCard,/owner_id|private\.pdf/);
current='professionals';
const sPublic=sandbox.discoveryState('professionals');
sPublic.status='ready';sPublic.items=[{id:publicId,vertical:'professionals',title:'Anúncio legítimo',description:'Descrição publicável'}];sPublic.hasMore=true;
assert.match(sandbox.discoveryPage(),/Exibindo 1 anúncio publicado nesta busca/);
sPublic.status='error';sPublic.items=[];
assert.match(sandbox.discoveryPage(),/Tentar novamente/);
assert.match(sandbox.discoveryPage(),/onclick="discoveryFetch\(\)"/);
sPublic.status='ready';
assert.match(sandbox.discoveryPage(),/Ver todos os anúncios/);
assert.match(sandbox.discoveryPage(),/Anunciar no TAMÃO/);
for(const marker of ['.discovery-gallery-grid','.discovery-gallery-more','.discovery-direct-link','.discovery-count'])
 assert.ok(css.includes(marker),'Missing gallery/accessibility CSS: '+marker);

// Each vertical's contact message is an inquiry, not a booking or a platform charge.
for(const [kind,cta,keyword] of [
 ['professionals','Pedir orçamento pelo WhatsApp','solicitar um orçamento'],
 ['rides','Consultar vagas pelo WhatsApp','Há vagas disponíveis'],
 ['stays','Consultar datas pelo WhatsApp','consultar datas, preços']
]){
 const entry={vertical:kind,id:publicId,title:'Oferta <teste>',description:'Contato direto',
   city_name:'São Gabriel',state_code:'RS',public_area:'Centro <teste>',
   whatsapp_e164:'+555599998888'};
 const html=sandbox.discoveryCard(entry,kind);
 assert.match(html,new RegExp(cta));
 assert.match(html,/Região: Centro &lt;teste&gt;/);
 assert.doesNotMatch(html,/Região: Centro <teste>|Reserva confirmada|Compra garantida/);
 const href=sandbox.discoveryWhatsApp(entry);
 assert.ok(href.startsWith('https://wa.me/555599998888?text='));
 const message=decodeURIComponent(href.split('?text=')[1]);
 assert.ok(message.includes(keyword));
 assert.ok(!/pagamento confirmado|reserva realizada/i.test(message));
}
assert.equal(sandbox.discoveryWhatsApp({vertical:'stays',whatsapp_e164:'javascript:alert(1)'}),'');

// Contact requests contain only prospective intent, not reservations or billing.
const rideInquiry=sandbox.discoveryInquiryForm({
 title:'Carona São Gabriel',whatsapp_e164:'+555599998888',seats_available:3
},'rides');
const stayInquiry=sandbox.discoveryInquiryForm({
 title:'Casa para férias',whatsapp_e164:'+555599998888',guests:6
},'stays');
assert.match(rideInquiry,/Quantas vagas deseja consultar/);
assert.match(stayInquiry,/Entrada desejada/);
assert.match(stayInquiry,/Saída desejada/);
assert.match(stayInquiry,/Hóspedes/);
assert.doesNotMatch(rideInquiry+stayInquiry,/Reserva confirmada|Pagar no TAMÃO/);
assert.equal(sandbox.discoveryInquiryForm({whatsapp_e164:'bad',seats_available:1},'rides'),'');
assert.equal(sandbox.discoveryInquiryForm({whatsapp_e164:'+555599998888',seats_available:0},'rides'),'');
const professionalInquiry=sandbox.discoveryInquiryForm({
 title:'Eletricista regional',whatsapp_e164:'+555599998888'
},'professionals');
assert.match(professionalInquiry,/Pedir orçamento com detalhes/);
assert.match(professionalInquiry,/Qual serviço você precisa/);
assert.match(professionalInquiry,/Dia desejado \(opcional\)/);
assert.match(professionalInquiry,/name="service" required minlength="10" maxlength="500"/);
assert.doesNotMatch(professionalInquiry,/Reserva confirmada|Pagar no TAMÃO/);
assert.equal(sandbox.discoveryInquiryForm({whatsapp_e164:'not-phone'},'professionals'),'');
function makeInquiry(kind,values,max=3){
 const feedback={textContent:''};
 const box={dataset:{phone:'+555599998888',kind,title:'Anúncio exemplo',max:String(max)},
 querySelector:sel=>sel==='.discovery-inquiry-feedback'?feedback:
  Object.hasOwn(values,(sel.match(/\[name="([^"]+)"\]/)||[])[1])?
    {value:values[(sel.match(/\[name="([^"]+)"\]/)||[])[1]]}:null};
 const anchor={href:'#',closest:sel=>sel==='.discovery-inquiry'?box:null};
 return {ok:sandbox.discoveryPrepareInquiry(anchor),link:anchor.href,feedback:feedback.textContent};
}
let inquiry=makeInquiry('professionals',{service:'Preciso instalar tomadas na sala',preferred_day:'2030-08-10'},0);
assert.equal(inquiry.ok,true);
assert.match(decodeURIComponent(inquiry.link),/solicitar um orçamento/);
assert.match(decodeURIComponent(inquiry.link),/instalar tomadas na sala/);
assert.match(decodeURIComponent(inquiry.link),/Dia desejado: 2030-08-10/);
assert.doesNotMatch(decodeURIComponent(inquiry.link),/Reserva confirmada|Pagamento efetuado/);
inquiry=makeInquiry('professionals',{service:'curto',preferred_day:''},0);
assert.equal(inquiry.ok,false);
assert.match(inquiry.feedback,/10 a 500 caracteres/);
assert.equal(inquiry.link,'#');
inquiry=makeInquiry('professionals',{service:'Descrição válida de reparos',preferred_day:'2030-02-30'},0);
assert.equal(inquiry.ok,false);
assert.match(inquiry.feedback,/data válida/);
inquiry=makeInquiry('professionals',{service:'A'.repeat(501),preferred_day:''},0);
assert.equal(inquiry.ok,false);
assert.equal(inquiry.link,'#');
inquiry=makeInquiry('professionals',{service:'Trocar chuveiro e revisar instalação',preferred_day:''},0);
assert.equal(inquiry.ok,true,'service inquiry must work without an optional date');
assert.doesNotMatch(decodeURIComponent(inquiry.link),/Dia desejado:/);
inquiry=makeInquiry('rides',{seats:'2'},3);
assert.equal(inquiry.ok,true);
assert.match(decodeURIComponent(inquiry.link),/consultar 2 vagas/);
assert.doesNotMatch(decodeURIComponent(inquiry.link),/Reserva confirmada|Pagamento efetuado/);
inquiry=makeInquiry('rides',{seats:'4'},3);
assert.equal(inquiry.ok,false);
assert.match(inquiry.feedback,/quantidade de vagas válida/);
assert.equal(inquiry.link,'#');
inquiry=makeInquiry('stays',{checkin:'2030-08-10',checkout:'2030-08-14',guests:'3'},6);
assert.equal(inquiry.ok,true);
assert.match(decodeURIComponent(inquiry.link),/2030-08-10 a 2030-08-14 para 3 hóspedes/);
inquiry=makeInquiry('stays',{checkin:'2030-08-15',checkout:'2030-08-14',guests:'2'},6);
assert.equal(inquiry.ok,false);
assert.match(inquiry.feedback,/saída após a entrada/);
inquiry=makeInquiry('stays',{checkin:'2030-08-10',checkout:'2030-08-14',guests:'10'},6);
assert.equal(inquiry.ok,false);
assert.match(inquiry.feedback,/hóspedes válida/);
for(const rule of ['.discovery-inquiry-fields','.discovery-inquiry summary','.discovery-inquiry-fields textarea'])
 assert.ok(css.includes(rule),'Missing inquiry styles '+rule);

console.log('PASS: 3 browse routes, RLS query, safe HTML/WhatsApp, location filters and PWA assets.');
