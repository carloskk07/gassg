import fs from 'node:fs';
import path from 'node:path';

// Public, factual, static editorial pages. They send visitors to the existing
// controlled SPA journeys, never to an independent order/payment/contact API.
export const PUBLIC_LANDING_SLUGS=Object.freeze([
  'como-funciona','para-revendas','para-marcas','indicacoes'
]);

const PAGES=[
 {
  slug:'como-funciona',
  title:'Como funciona o TAMÃO | Gás, água e essenciais perto de você',
  description:'Escolha gás, água e essenciais, consulte a entrega pelo CEP, confira preço e prazo e acompanhe o aceite da revenda pelo TAMÃO.',
  kicker:'PARA QUEM QUER COMPRAR',
  heading:'Faltou em casa? Resolva com mais escolhas e menos complicação.',
  lead:'Gás, água e essenciais em um só lugar. Escolha o que precisa, consulte as revendas que atendem seu CEP e veja preço total e previsão antes de decidir.',
  primary:['Conhecer os produtos','/'],
  secondary:['Ver o passo a passo','/#learn'],
  mark:'ESCOLHER, CONFERIR, ACOMPANHAR',
  stepsHeading:"Da escolha à entrega: você sabe o próximo passo.",
  proofTitle:"Três motivos para conhecer o TAMÃO",
  highlights:[["🧺","A cesta é sua","Água e outros itens não exigem comprar gás junto."],["💰","O valor antes do pedido","Consulte o total e a previsão das opções para seu CEP."],["📍","A entrega acompanhada","Veja as etapas registradas depois da confirmação da revenda."]],
  visualTitle:'Sua compra começa com uma escolha melhor.',
  visualText:'Veja as opções para sua região, escolha a que faz sentido e acompanhe o pedido depois que a revenda confirmar o atendimento.',
  steps:[
   ['01','Escolha o que precisa','Explore os produtos. Água e outros itens não exigem adicionar gás à cesta.'],
   ['02','Consulte sua região','Informe o CEP e veja as opções que realmente podem atender o seu endereço.'],
   ['03','Confirme com clareza','Confira o valor total e a previsão. A revenda precisa aceitar o pedido.']
  ],
  storyTitle:'Mais controle do primeiro clique à entrega.',
  storyText:'Compare as opções que realmente atendem seu endereço. Conheça o valor, entenda cada etapa e escolha com mais tranquilidade.',
  storyPoints:['O preço final aparece antes da confirmação do pedido.','O acompanhamento diferencia pedido solicitado, aceito e enviado.','Quando não houver atendimento disponível, você pode solicitar um aviso.'],
  questions:[
   ['Preciso comprar gás para pedir água?','Não. Você escolhe livremente os itens e consulta se há oferta para eles no seu CEP.'],
   ['Quando meu pedido está confirmado?','Depois que a revenda aceita. Antes disso, a disponibilidade e as condições devem ser verificadas.'],
   ['O TAMÃO atende minha cidade?','A cobertura depende de revendas autorizadas e disponíveis para seu endereço. Consulte o CEP para saber.']
  ],
  closing:'O próximo passo é simples: escolha o que precisa.'
 },
 {
  slug:'para-revendas',
  title:'TAMÃO para Revendas | Mais um canal para vender na sua cidade',
  description:'Leve sua revenda de gás, água e essenciais ao TAMÃO. Continue controlando produtos, preços, estoque, entregas e recebimentos. Conheça a parceria.',
  kicker:'TAMÃO PARA EMPRESAS',
  heading:'Sua revenda pode estar mais perto do próximo cliente.',
  lead:'Ganhe mais um canal para apresentar seus produtos e receber pedidos da sua região, sem abandonar seus canais atuais. Preços, estoque, pagamentos e entregas continuam sob sua gestão.',
  primary:['Quero apresentar minha empresa','/?entrada=revenda'],
  secondary:['Entender a parceria','/#merchants'],
  mark:'MAIS UM CANAL, SEM PERDER SUA AUTONOMIA',
  stepsHeading:"Do cadastro ao primeiro pedido, sem complicar.",
  proofTitle:"Uma parceria que respeita o seu negócio",
  highlights:[["🏪","Seus produtos, suas regras","Você administra catálogo, preços, estoque e área de entrega."],["💳","Recebimento sob seu controle","O cliente paga diretamente à sua revenda pelos meios oferecidos."],["🤝","Sem exclusividade","Continue atendendo por telefone, WhatsApp e outros canais."]],
  visualTitle:'Mais uma vitrine. A mesma autonomia.',
  visualText:'Você define o que vende e onde atende. Quando um pedido chegar, sua revenda confirma se pode realizá-lo.',
  steps:[
   ['01','Apresente sua empresa','Informe o contato da revenda e as categorias que comercializa.'],
   ['02','Configure a operação','Defina produtos, preços, estoque, recebimento e entregas após a habilitação.'],
   ['03','Atenda no seu ritmo','Quando estiver apta e online, a revenda decide quais pedidos pode confirmar.']
  ],
  storyTitle:'Mais presença na cidade. Mais controle no seu negócio.',
  storyText:'Tenha um novo ponto de encontro com compradores da região e organize catálogo, disponibilidade, pedidos e entregas em um painel.',
  storyPoints:['Sem exclusividade: seus clientes e canais atuais permanecem seus.','No modelo atual, não há mensalidade; a taxa do TAMÃO incide sobre pedidos concluídos.','O pagamento da compra é feito à própria revenda conforme as formas que ela oferece.'],
  questions:[
   ['Preciso deixar de usar WhatsApp e telefone?','Não. O TAMÃO funciona como mais um canal de vendas, sem exigir exclusividade.'],
   ['Quem define os preços e a disponibilidade?','A própria revenda define produtos, preços, estoque e disponibilidade, respeitando as condições da plataforma.'],
   ['O cadastro já libera minha empresa para vender?','Não. A habilitação depende de verificações operacionais, comerciais e, quando aplicável, de autorizações para produtos regulados.']
  ],
  closing:'Seu negócio merece ser encontrado. Apresente sua revenda.'
 },
 {
  slug:'para-marcas',
  title:'Divulgação e Parcerias no TAMÃO | Marcas e Comércio Local',
  description:'Conheça possibilidades de divulgação regional, campanhas de benefícios e parcerias com revendas no TAMÃO. Propostas sob avaliação e aprovação.',
  kicker:'PARA MARCAS E PATROCINADORES',
  heading:'Sua marca mais perto das escolhas que movem a cidade.',
  lead:'Apareça com contexto: ações regionais, divulgação identificada e benefícios pensados para quem compra e vende na cidade. Apresente sua ideia para construirmos uma proposta comercial.',
  primary:['Apresentar minha marca','/?entrada=marca'],
  secondary:['Conhecer os formatos','/#sponsors'],
  mark:'DIVULGAÇÃO COM CONTEXTO LOCAL',
  stepsHeading:"Da ideia à ação comercial.",
  proofTitle:"Sua marca em conversas que fazem sentido",
  highlights:[["📣","Divulgação regional","Possibilidades de presença publicitária identificada por região."],["🎁","Ações com benefícios","Propostas de campanhas e vantagens para públicos elegíveis."],["🏪","Comércio local","Parcerias pensadas para aproximar marcas e revendas."]],
  visualTitle:'Sua marca com propósito e presença local.',
  visualText:'Conheça formatos de divulgação, relacionamento e benefícios para avaliação. A proposta passa por definição e aprovação antes de ser veiculada.',
  steps:[
   ['01','Conte seu objetivo','Apresente a cidade, a categoria e o público que deseja alcançar.'],
   ['02','Escolha uma possibilidade','Explore presença identificada, benefícios para clientes ou ações regionais.'],
   ['03','Defina as condições','Orçamento, formato, responsabilidades e aprovação vêm antes de qualquer campanha.']
  ],
  storyTitle:'Publicidade que conversa com a vida real.',
  storyText:'Pense além de um banner: uma marca pode participar de ações regionais com comerciantes e consumidores, sempre com identificação publicitária e objetivos definidos.',
  storyPoints:['Publicidade patrocinada deve ser claramente identificada.','Formatos, públicos e investimentos são avaliados individualmente.','Nenhuma campanha é ativada automaticamente pelo envio de interesse.'],
  questions:[
   ['Quais tipos de marcas podem conversar com o TAMÃO?','Empresas interessadas em ações relevantes para os consumidores e revendas da região podem apresentar uma proposta.'],
   ['Há campanhas prontas para compra automática?','Não. As possibilidades apresentadas dependem de avaliação e aprovação comercial.'],
   ['O TAMÃO garante alcance ou vendas?','Não há garantia de alcance, pedidos ou retorno. Cada ação precisa de objetivos e condições definidos.']
  ],
  closing:'Sua próxima campanha local pode começar com uma conversa.'
 },
 {
  slug:'indicacoes',
  title:'Rede TAMÃO | Indique Pessoas e Revendas',
  description:'Conheça a Rede TAMÃO. Compartilhe seu convite, apresente compradores e revendas e acompanhe benefícios elegíveis conforme as condições de cada campanha.',
  kicker:'REDE TAMÃO',
  heading:'Uma boa indicação pode conectar a cidade inteira.',
  lead:'Indique para amigos, vizinhos e revendas. Seu convite ajuda mais pessoas a conhecerem o TAMÃO, enquanto você acompanha sua rede e descobre os benefícios de campanhas elegíveis.',
  primary:['Conhecer minha rede','/?entrada=indicar'],
  secondary:['Entender os benefícios','/#earn'],
  mark:'CONEXÕES QUE APROXIMAM A CIDADE',
  stepsHeading:"Três passos para começar sua rede.",
  proofTitle:"Indicar fica mais fácil quando o caminho é claro",
  highlights:[["🫶","Convide pessoas","Compartilhe o TAMÃO com quem pode gostar da plataforma."],["🏪","Apresente revendas","Ajude empresas da cidade a conhecer a oportunidade."],["🔗","Acompanhe convites","Consulte as participações atribuídas ao seu código."]],
  visualTitle:'Sua rede começa com quem você conhece.',
  visualText:'Convites para quem compra e para quem vende seguem caminhos próprios. Acompanhe as participações e veja as regras de cada benefício quando disponível.',
  steps:[
   ['01','Compartilhe','Convide amigos e apresente revendas interessadas.'],
   ['02','Acompanhe','Consulte seus convites e as participações atribuídas à sua rede.'],
   ['03','Conheça os benefícios','Cada campanha tem regras, condições e momentos de validação próprios.']
  ],
  storyTitle:'Compartilhe com propósito. Acompanhe com clareza.',
  storyText:'Um convite pode ajudar um amigo a conhecer produtos ou apresentar uma revenda à plataforma. A Rede organiza essas conexões e separa convites de benefícios financeiros.',
  storyPoints:['Convites de clientes e de revendas possuem caminhos próprios.','Cashback por compras e comissões por indicação são benefícios distintos.','A participação não representa promessa de renda ou pagamento automático.'],
  questions:[
   ['Posso indicar uma revenda?','Sim. A Rede TAMÃO contempla convites para empresas interessadas, com atribuição e validação próprias.'],
   ['Toda indicação gera uma comissão?','Não. Benefícios financeiros dependem de campanha ativa, elegibilidade e dos eventos exigidos em suas regras.'],
   ['Onde vejo meus convites?','Na área Minha Rede TAMÃO, acessível pela apresentação da Rede.']
  ],
  closing:'Apresente o TAMÃO. Faça sua rede acontecer.'
 }
];

const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');

// Editorial representations explain the audience, not real orders, merchants,
// sponsors, earnings, availability or business performance.
function renderAudienceVisual(page){
  if(page.slug==='como-funciona')return `<div class="ed-product-scene" aria-hidden="true">
    <div class="ed-halo"></div><div class="ed-product ed-product-gas"></div><div class="ed-product ed-product-water"></div>
    <span class="ed-scene-label">Gás • Água • Essenciais</span></div>`;
  if(page.slug==='para-revendas')return `<div class="ed-audience-scene ed-audience-merchant" aria-hidden="true">
    <span class="ed-scene-overline">PAINEL • ILUSTRAÇÃO</span>
    <div class="ed-scene-primary"><span class="ed-scene-symbol">🏪</span><div><small>SUA EMPRESA</small><strong>Produtos sob controle</strong></div></div>
    <div class="ed-scene-pills"><span>📦 Catálogo</span><span>🚚 Entregas</span><span>✓ Disponibilidade</span></div>
    <span class="ed-scene-bottom">Autonomia para operar</span></div>`;
  if(page.slug==='para-marcas')return `<div class="ed-audience-scene ed-audience-brand" aria-hidden="true">
    <span class="ed-scene-overline">PROPOSTA • ILUSTRAÇÃO</span>
    <div class="ed-scene-primary"><span class="ed-scene-symbol">✦</span><div><small>MARCA + COMÉRCIO LOCAL</small><strong>Presença com contexto</strong></div></div>
    <div class="ed-scene-pills"><span>📍 Região</span><span>📣 Divulgação</span><span>🎁 Benefícios</span></div>
    <span class="ed-scene-bottom">Formatos sujeitos à aprovação</span></div>`;
  return `<div class="ed-audience-scene ed-audience-network" aria-hidden="true">
    <span class="ed-scene-overline">REDE • ILUSTRAÇÃO</span>
    <div class="ed-scene-primary"><span class="ed-scene-symbol">🤝</span><div><small>SEU CONVITE</small><strong>Mais pessoas conectadas</strong></div></div>
    <div class="ed-scene-pills"><span>🛍️ Quem compra</span><span>🏪 Quem vende</span></div>
    <span class="ed-scene-bottom">Benefícios conforme cada campanha</span></div>`;
}

function renderLanding(page,origin,indexing){
 const canonical=origin+'/'+page.slug+'/';
 const highlights=page.highlights.map(([symbol,title,description])=>`<article class="ed-proof-card"><span class="ed-proof-symbol" aria-hidden="true">${esc(symbol)}</span><h3>${esc(title)}</h3><p>${esc(description)}</p></article>`).join('');
 const cards=page.steps.map(([number,title,description])=>`<article class="ed-step">
   <span class="ed-step-number">${esc(number)}</span>
   <h3>${esc(title)}</h3><p>${esc(description)}</p>
  </article>`).join('');
 const bullets=page.storyPoints.map(item=>'<li>'+esc(item)+'</li>').join('');
 const questions=page.questions.map(([q,a])=>'<details><summary>'+esc(q)+'</summary><p>'+esc(a)+'</p></details>').join('');
 const primary=`<a class="ed-btn ed-btn-primary" data-tamao-handoff href="${esc(page.primary[1])}">${esc(page.primary[0])} <span aria-hidden="true">→</span></a>`;
 const secondary=`<a class="ed-btn ed-btn-outline" data-tamao-handoff href="${esc(page.secondary[1])}">${esc(page.secondary[0])}</a>`;
 const headerAction={
  'como-funciona':['Ver produtos','/'],
  'para-revendas':['Sou revenda','/?entrada=revenda'],
  'para-marcas':['Tenho uma marca','/?entrada=marca'],
  'indicacoes':['Quero indicar','/?entrada=indicar']
 }[page.slug];
 const navigation=PAGES.map(x=>`<a data-tamao-handoff href="/${x.slug}/" ${x.slug===page.slug?'aria-current="page"':''}>${esc(x.slug==='como-funciona'?'Como funciona':x.slug==='para-revendas'?'Para revendas':x.slug==='para-marcas'?'Para marcas':'Indicações')}</a>`).join('');
 return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="${indexing?'index,follow,max-image-preview:large':'noindex,nofollow,noarchive,nosnippet'}" />
<meta name="theme-color" content="#0d6b4b" />
<meta name="description" content="${esc(page.description)}" />
<link rel="canonical" href="${esc(canonical)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="TAMÃO" />
<meta property="og:locale" content="pt_BR" />
<meta property="og:title" content="${esc(page.title)}" />
<meta property="og:description" content="${esc(page.description)}" />
<meta property="og:url" content="${esc(canonical)}" />
<meta name="twitter:card" content="summary" />
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
<link rel="stylesheet" href="/css/landing-editorial.css" />
<script src="/js/landing-handoff.js" defer></script>
<title>${esc(page.title)}</title>
</head><body>
<a class="ed-skip" href="#conteudo">Pular para o conteúdo</a>
<header class="ed-header"><div class="ed-shell ed-header-inner">
  <a href="/" data-tamao-handoff class="ed-brand" aria-label="TAMÃO, ir para a home"><img src="/icons/icon.svg" width="43" height="43" alt="" /><span><strong>TAMÃO</strong><small>Pediu? Tá na mão.</small></span></a>
  <nav class="ed-nav" aria-label="Conheça o TAMÃO">${navigation}</nav>
  <a class="ed-header-cta" data-tamao-handoff href="${esc(headerAction[1])}">${esc(headerAction[0])} <span aria-hidden="true">→</span></a>
</div></header>
<main id="conteudo">
 <section class="ed-hero"><div class="ed-shell ed-hero-grid">
  <div class="ed-hero-copy">
   <span class="ed-eyebrow">${esc(page.kicker)}</span>
   <h1>${esc(page.heading)}</h1>
   <p>${esc(page.lead)}</p>
   <div class="ed-actions">${primary}${secondary}</div>
   <div class="ed-hero-notes" aria-label="Sobre o TAMÃO"><span>✓ ${esc(page.slug==='para-revendas'?'Sem exclusividade':page.slug==='como-funciona'?'Preço antes de pedir':page.slug==='indicacoes'?'Convites acompanhados':'Proposta por região')}</span><span>✓ ${esc(page.slug==='para-revendas'?'Controle da operação':page.slug==='como-funciona'?'Consulta por CEP':page.slug==='indicacoes'?'Rede de pessoas e empresas':'Publicidade identificada')}</span></div>
  </div>
  <aside class="ed-hero-visual" aria-label="Apresentação ilustrativa da proposta do TAMÃO">
   <span class="ed-visual-kicker">${esc(page.mark)}</span>
   ${renderAudienceVisual(page)}
   <div class="ed-visual-copy"><h2>${esc(page.visualTitle)}</h2><p>${esc(page.visualText)}</p></div>
  </aside>
 </div></section>
 <section class="ed-shell ed-proof" aria-labelledby="vantagens"><div class="ed-proof-head"><span class="ed-eyebrow">VANTAGENS NA PRÁTICA</span><h2 id="vantagens">${esc(page.proofTitle)}</h2></div><div class="ed-proof-grid">${highlights}</div></section>
 <section class="ed-section ed-shell" aria-labelledby="etapas"><div class="ed-section-head"><span class="ed-eyebrow">DO INTERESSE À AÇÃO</span><h2 id="etapas">${esc(page.stepsHeading)}</h2></div>
 <div class="ed-steps">${cards}</div></section>
 <section class="ed-section ed-shell ed-value" aria-labelledby="beneficios">
  <div><span class="ed-eyebrow">O QUE FAZ DIFERENÇA</span><h2 id="beneficios">${esc(page.storyTitle)}</h2><p>${esc(page.storyText)}</p></div>
  <ul>${bullets}</ul>
 </section>
 <section class="ed-section ed-shell ed-faq" aria-labelledby="duvidas">
  <div class="ed-section-head"><span class="ed-eyebrow">RESPOSTAS DIRETAS</span><h2 id="duvidas">Dúvidas que vale esclarecer.</h2></div><div class="ed-faq-items">${questions}</div>
 </section>
 <section class="ed-shell ed-last"><div><span class="ed-eyebrow">SEU PRÓXIMO PASSO</span><h2>${esc(page.closing)}</h2></div>${primary}</section>
</main>
<footer class="ed-footer"><div class="ed-shell ed-footer-inner">
 <div><a href="/" data-tamao-handoff class="ed-footer-brand">TAMÃO</a><small>Gás, água e essenciais perto de você. Consulte a disponibilidade para sua região.</small></div>
 <nav aria-label="Informações e privacidade"><a href="/#contact">Contato</a><a href="/#privacy">Privacidade</a><a href="/#terms">Termos de uso</a></nav>
</div></footer>
</body></html>`;
}

export function writePublicLandingPages(target,{origin='https://tamao.com.br',indexing=true}={}){
 const parsed=new URL(origin);
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash){
  throw new Error('origem inválida para páginas públicas');
 }
 for(const page of PAGES){
  const dir=path.join(target,page.slug);
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'index.html'),renderLanding(page,parsed.origin,indexing),'utf8');
 }
 return PUBLIC_LANDING_SLUGS.map(slug=>'/'+slug+'/');
}
