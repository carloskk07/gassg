import fs from 'node:fs';
import path from 'node:path';

// Public explanatory pages. Never synthesize inventory, bookings, ratings or prices.
// Every CTA uses the existing moderated discovery flows; no direct payment API.
const content={
 professionals:{
  pt:{slug:'profissionais',title:'Encontre profissionais pelo TAMÃO | Serviços e orçamentos',
   description:'Pesquise profissionais por região e especialidade no TAMÃO. Consulte anúncios publicados e solicite orçamento direto, sem pagamento antecipado pela plataforma.',
   kicker:'TAMÃO PROFISSIONAIS',heading:'Encontre quem pode ajudar na sua região.',
   intro:'Pesquise profissionais, leia especialidades e condições declaradas no anúncio. Entre em contato direto e peça um orçamento antes de combinar o serviço.',
   steps:[['Pesquise por área','Selecione cidade, UF e tipo de serviço.'],['Conheça o anúncio','Confira descrição, área atendida e fotos públicas quando disponíveis.'],['Peça um orçamento','Envie uma consulta com detalhes e combine valores diretamente com o profissional.']],
   faq:[['O TAMÃO contrata o profissional por mim?','Não. A contratação e as condições são combinadas diretamente com o anunciante.'],['Todos os profissionais atendem minha região?','A busca mostra anúncios publicados em localidades habilitadas. Confirme o atendimento antes de contratar.']],
   action:'Pesquisar profissionais',other:'Anunciar meus serviços',notice:'A disponibilidade depende de anúncios publicados e autorizados na região.'},
  es:{slug:'ar/profesionales',title:'Profesionales y servicios en Brasil | TAMÃO',
   description:'Explorá anuncios de profesionales y servicios por ciudad y especialidad en Brasil. Consultá condiciones y solicitá presupuestos directamente al anunciante.',
   kicker:'TAMÃO PROFESIONALES',heading:'Encontrá servicios y profesionales en Brasil.',
   intro:'Explorá anuncios publicados por especialidad y localidad. Consultá el área de atención y pedí un presupuesto directamente a quien publica.',
   steps:[['Elegí una zona','Buscá por ciudad, estado y especialidad.'],['Revisá el anuncio','Leé la descripción y las condiciones declaradas.'],['Consultá el presupuesto','Conversá directamente con el profesional antes de contratar.']],
   faq:[['¿TAMÃO cobra por el servicio?','No. El presupuesto y la contratación se acuerdan directamente con el anunciante.'],['¿La búsqueda ya está en español?','Esta página es informativa en español; la búsqueda actual abre la plataforma en portugués.']],
   action:'Ver profesionales',other:'Publicar un servicio',notice:'La disponibilidad depende de anuncios publicados y habilitados por localidad.'}
 },
 rides:{
  pt:{slug:'caronas',title:'Caronas entre cidades | Consulte trajetos no TAMÃO',
   description:'Procure caronas anunciadas por origem, destino, data e vagas. Converse com quem oferece o trajeto e confirme condições diretamente, sem reserva ou pagamento no TAMÃO.',
   kicker:'TAMÃO CARONAS',heading:'Encontre caronas para seu próximo trajeto.',
   intro:'Pesquise origem, destino e horários declarados. Verifique se ainda há vagas e combine detalhes da viagem diretamente com o anunciante.',
   steps:[['Escolha o trajeto','Informe origem, destino e data desejada na pesquisa.'],['Veja as vagas anunciadas','Confira horários e contribuição sugerida, quando declarados.'],['Converse com o anunciante','Consulte vagas e combine as condições antes de viajar.']],
   faq:[['A vaga fica reservada ao consultar?','Não. O contato não reserva assento; confirme diretamente com quem anunciou.'],['Pago a carona no TAMÃO?','Não. A plataforma não recebe pagamentos por caronas ocasionais.']],
   action:'Pesquisar caronas',other:'Anunciar uma carona',notice:'Uma vaga anunciada não equivale a reserva confirmada.'},
  es:{slug:'ar/viajes-compartidos',title:'Viajes compartidos en Brasil | TAMÃO',
   description:'Buscá viajes compartidos anunciados en Brasil por origen, destino y fecha. Consultá asientos y condiciones directamente sin reservar ni pagar por TAMÃO.',
   kicker:'TAMÃO VIAJES COMPARTIDOS',heading:'Explorá viajes compartidos en Brasil.',
   intro:'Consultá los trayectos anunciados, horarios y asientos declarados. Coordiná las condiciones directamente con quien publica el viaje.',
   steps:[['Elegí el trayecto','Indicá origen, destino y fecha.'],['Consultá los anuncios','Revisá los asientos y horarios declarados.'],['Hablá directamente','Confirmá la disponibilidad y los detalles antes del viaje.']],
   faq:[['¿La consulta reserva un asiento?','No. Un mensaje no confirma una reserva.'],['¿Se paga el viaje por TAMÃO?','No. TAMÃO no procesa pagos de viajes compartidos.']],
   action:'Ver viajes compartidos',other:'Publicar un viaje',notice:'Los asientos anunciados deben confirmarse directamente.'}
 },
 stays:{
  pt:{slug:'hospedagens',title:'Hospedagens em destinos brasileiros | TAMÃO',
   description:'Explore hospedagens anunciadas no TAMÃO por destino, capacidade, tipo e preço declarado. Consulte datas e condições diretamente com a hospedagem, sem reserva automática.',
   kicker:'TAMÃO HOSPEDAGENS',heading:'Explore opções de hospedagem no seu destino.',
   intro:'Consulte hotéis, pousadas e outros imóveis publicados. Veja capacidade, comodidades e valores declarados antes de perguntar pelas datas desejadas.',
   steps:[['Escolha o destino','Pesquise a cidade e o tipo de acomodação.'],['Compare informações','Veja capacidade, comodidades e preço informado pelo anunciante.'],['Consulte as datas','Confirme disponibilidade, tarifas e regras diretamente antes de combinar a estadia.']],
   faq:[['A consulta confirma a reserva?','Não. É preciso confirmar disponibilidade e condições com a hospedagem.'],['O TAMÃO recebe o valor da diária?','Não. A contratação e o pagamento da estadia são combinados diretamente.']],
   action:'Pesquisar hospedagens',other:'Anunciar uma hospedagem',notice:'Fotos, valores e comodidades são informações declaradas nos anúncios.'},
  es:{slug:'ar/alojamientos',title:'Alojamientos en destinos de Brasil | TAMÃO',
   description:'Explorá alojamientos publicados en Brasil por destino, capacidad y tipo. Consultá fechas, tarifas y condiciones directamente con cada anunciante.',
   kicker:'TAMÃO ALOJAMIENTOS',heading:'Conocé opciones de alojamiento en Brasil.',
   intro:'Buscá hoteles, posadas y otras propiedades anunciadas. Consultá capacidad, servicios y valores declarados antes de preguntar por fechas.',
   steps:[['Elegí el destino','Buscá por ciudad y tipo de alojamiento.'],['Revisá la información','Consultá la capacidad, los servicios y el precio anunciado.'],['Preguntá por fechas','Confirmá tarifas, disponibilidad y reglas directamente con el anunciante.']],
   faq:[['¿La consulta confirma una reserva?','No. La disponibilidad se confirma directamente con el alojamiento.'],['¿TAMÃO cobra la estadía?','No. La contratación y el pago se acuerdan con el anunciante.']],
   action:'Ver alojamientos',other:'Publicar alojamiento',notice:'La información publicada no garantiza disponibilidad ni reserva.'}
 }
};
export const DISCOVERY_LANDING_SLUGS=Object.freeze(Object.values(content).flatMap(group=>[group.pt.slug,group.es.slug]));
function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')}
function pageHTML(kind,locale,origin,indexing){
 const p=content[kind][locale],counterpart=content[kind][locale==='pt'?'es':'pt'];
 const canonical=origin+'/'+p.slug+'/',alternative=origin+'/'+counterpart.slug+'/';
 const direct=origin+'/#'+kind,advertise=origin+'/#advertise';
 const faq=p.faq.map(([question,answer])=>'<details><summary>'+esc(question)+'</summary><p>'+esc(answer)+'</p></details>').join('');
 const steps=p.steps.map(([head,body],i)=>'<article class="ed-proof-card"><span class="ed-eyebrow">'+String(i+1).padStart(2,'0')+'</span><h3>'+esc(head)+'</h3><p>'+esc(body)+'</p></article>').join('');
 return '<!doctype html><html lang="'+(locale==='pt'?'pt-BR':'es-AR')+'"><head>'+
 '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'+
 '<meta name="robots" content="'+(indexing?'index,follow,max-image-preview:large':'noindex,nofollow,noarchive,nosnippet')+'">'+
 '<meta name="description" content="'+esc(p.description)+'">'+
 '<link rel="canonical" href="'+esc(canonical)+'">'+
 '<link rel="alternate" hreflang="pt-BR" href="'+esc(origin+'/'+content[kind].pt.slug+'/')+'">'+
 '<link rel="alternate" hreflang="es-AR" href="'+esc(origin+'/'+content[kind].es.slug+'/')+'">'+
 '<link rel="alternate" hreflang="x-default" href="'+esc(origin+'/'+content[kind].pt.slug+'/')+'">'+
 '<meta property="og:type" content="website"><meta property="og:site_name" content="TAMÃO">'+
 '<meta property="og:locale" content="'+(locale==='pt'?'pt_BR':'es_AR')+'">'+
 '<meta property="og:title" content="'+esc(p.title)+'"><meta property="og:description" content="'+esc(p.description)+'">'+
 '<meta property="og:url" content="'+esc(canonical)+'"><meta name="twitter:card" content="summary">'+
 '<link rel="stylesheet" href="/css/landing-editorial.css"><link rel="icon" href="/icons/icon.svg" type="image/svg+xml">'+
 '<title>'+esc(p.title)+'</title></head><body class="ed-page ed-discovery-page">'+
 '<a class="ed-skip" href="#conteudo">'+(locale==='pt'?'Pular para conteúdo':'Saltar al contenido')+'</a>'+
 '<header class="ed-header"><div class="ed-shell ed-header-inner"><a class="ed-brand" href="/"><strong>TAMÃO</strong></a>'+
 '<nav class="ed-nav" aria-label="'+(locale==='pt'?'Idiomas e modalidades':'Idiomas y categorías')+'">'+
 '<a href="'+esc(alternative)+'" hreflang="'+(locale==='pt'?'es-AR':'pt-BR')+'">'+(locale==='pt'?'Español (AR)':'Português (BR)')+'</a>'+
 '</nav></div></header><main id="conteudo">'+
 '<section class="ed-hero"><div class="ed-shell ed-hero-grid"><div class="ed-hero-copy">'+
 '<span class="ed-eyebrow">'+esc(p.kicker)+'</span><h1>'+esc(p.heading)+'</h1><p>'+esc(p.intro)+'</p>'+
 '<div class="ed-actions"><a class="ed-btn ed-btn-primary" href="'+esc(direct)+'">'+esc(p.action)+' →</a>'+
 '<a class="ed-btn ed-btn-outline" href="'+esc(advertise)+'">'+esc(p.other)+'</a></div>'+
 '<p>'+esc(p.notice)+'</p></div>'+
 '<aside class="ed-hero-visual" aria-label="TAMÃO"><span class="ed-visual-kicker">TAMÃO</span>'+
 '<h2>'+esc(p.kicker)+'</h2><p>'+esc(p.notice)+'</p></aside></div></section>'+
 '<section class="ed-shell ed-proof" aria-labelledby="pasos"><div class="ed-proof-head"><h2 id="pasos">'+
 (locale==='pt'?'Como funciona':'Cómo funciona')+'</h2></div><div class="ed-proof-grid">'+steps+'</div></section>'+
 '<section class="ed-shell ed-section ed-faq" aria-labelledby="perguntas"><h2 id="perguntas">'+
 (locale==='pt'?'Perguntas frequentes':'Preguntas frecuentes')+'</h2>'+
 '<div class="ed-faq-items">'+faq+'</div></section>'+
 '<section class="ed-shell ed-last"><h2>'+esc(p.heading)+'</h2><a class="ed-btn ed-btn-primary" href="'+esc(direct)+'">'+esc(p.action)+' →</a></section>'+
 '</main><footer class="ed-footer"><div class="ed-shell ed-footer-inner"><a href="/">TAMÃO</a>'+
 '<small>'+esc(p.notice)+'</small></div></footer></body></html>';
}
export function writeDiscoveryLandingPages(target,{origin='https://tamao.com.br',indexing=false}={}){
 const u=new URL(origin);
 if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('invalid public origin');
 for(const [kind,group] of Object.entries(content))for(const locale of ['pt','es']){
  const p=group[locale],folder=path.join(target,p.slug);
  fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(folder,'index.html'),pageHTML(kind,locale,u.origin,indexing),'utf8');
 }
 return DISCOVERY_LANDING_SLUGS.map(slug=>'/'+slug+'/');
}
