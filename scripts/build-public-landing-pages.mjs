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
  heading:'O essencial da sua rotina. Uma escolha mais simples.',
  lead:'Acabou o gás? Precisa de água ou outros itens do dia a dia? Explore os produtos, informe seu CEP quando quiser consultar a entrega e confira as condições antes de confirmar.',
  primary:['Conhecer os produtos','/'],
  secondary:['Ver o passo a passo','/#learn'],
  mark:'ESCOLHER, CONFERIR, ACOMPANHAR',
  visualTitle:'Você decide antes de pedir.',
  visualText:'Produto, CEP, valor e previsão vêm antes da confirmação. O pedido depende do aceite de uma revenda disponível.',
  steps:[
   ['01','Escolha o que precisa','Explore os produtos. Água e outros itens não exigem adicionar gás à cesta.'],
   ['02','Consulte sua região','Informe o CEP e veja as opções que realmente podem atender o seu endereço.'],
   ['03','Confirme com clareza','Confira o valor total e a previsão. A revenda precisa aceitar o pedido.']
  ],
  storyTitle:'Comprar bem é saber o que esperar.',
  storyText:'Em vez de procurar informações espalhadas, você consulta os itens, as condições da entrega e o andamento do pedido em uma só jornada.',
  storyPoints:['O preço final aparece antes da confirmação do pedido.','O acompanhamento diferencia pedido solicitado, aceito e enviado.','Quando não houver atendimento disponível, você pode solicitar um aviso.'],
  questions:[
   ['Preciso comprar gás para pedir água?','Não. Você escolhe livremente os itens e consulta se há oferta para eles no seu CEP.'],
   ['Quando meu pedido está confirmado?','Depois que a revenda aceita. Antes disso, a disponibilidade e as condições devem ser verificadas.'],
   ['O TAMÃO atende minha cidade?','A cobertura depende de revendas autorizadas e disponíveis para seu endereço. Consulte o CEP para saber.']
  ],
  closing:'Escolha o que precisa. O restante começa pelo seu CEP.'
 },
 {
  slug:'para-revendas',
  title:'TAMÃO para Revendas | Mais um canal para vender na sua cidade',
  description:'Leve sua revenda de gás, água e essenciais ao TAMÃO. Continue controlando produtos, preços, estoque, entregas e recebimentos. Conheça a parceria.',
  kicker:'TAMÃO PARA EMPRESAS',
  heading:'Sua revenda mais perto de quem precisa comprar.',
  lead:'O TAMÃO abre mais um caminho para consumidores conhecerem sua empresa. Você continua no controle dos produtos, preços, estoque, formas de receber e área de entrega.',
  primary:['Quero apresentar minha empresa','/?entrada=revenda'],
  secondary:['Entender a parceria','/#merchants'],
  mark:'MAIS UM CANAL, SEM PERDER SUA AUTONOMIA',
  visualTitle:'O seu negócio continua sendo seu.',
  visualText:'O cliente escolhe, você avalia o pedido, confirma o atendimento e organiza a entrega no seu painel.',
  steps:[
   ['01','Apresente sua empresa','Informe o contato da revenda e as categorias que comercializa.'],
   ['02','Configure a operação','Defina produtos, preços, estoque, recebimento e entregas após a habilitação.'],
   ['03','Atenda no seu ritmo','Quando estiver apta e online, a revenda decide quais pedidos pode confirmar.']
  ],
  storyTitle:'Mais oportunidades, com decisões nas suas mãos.',
  storyText:'Continue vendendo pelos canais que já utiliza. O TAMÃO acrescenta uma vitrine de consulta e uma jornada de pedidos organizada.',
  storyPoints:['Sem exclusividade: seus clientes e canais atuais permanecem seus.','No modelo atual, não há mensalidade; a taxa do TAMÃO incide sobre pedidos concluídos.','O pagamento da compra é feito à própria revenda conforme as formas que ela oferece.'],
  questions:[
   ['Preciso deixar de usar WhatsApp e telefone?','Não. O TAMÃO funciona como mais um canal de vendas, sem exigir exclusividade.'],
   ['Quem define os preços e a disponibilidade?','A própria revenda define produtos, preços, estoque e disponibilidade, respeitando as condições da plataforma.'],
   ['O cadastro já libera minha empresa para vender?','Não. A habilitação depende de verificações operacionais, comerciais e, quando aplicável, de autorizações para produtos regulados.']
  ],
  closing:'Mostre sua revenda. Continue no controle.'
 },
 {
  slug:'para-marcas',
  title:'Divulgação e Parcerias no TAMÃO | Marcas e Comércio Local',
  description:'Conheça possibilidades de divulgação regional, campanhas de benefícios e parcerias com revendas no TAMÃO. Propostas sob avaliação e aprovação.',
  kicker:'PARA MARCAS E PATROCINADORES',
  heading:'Sua marca pode fazer parte das escolhas da cidade.',
  lead:'Aproximar marcas, consumidores e revendas locais pode criar novas oportunidades. Conheça possibilidades de divulgação, ações de benefício e parcerias regionais.',
  primary:['Apresentar minha marca','/?entrada=marca'],
  secondary:['Conhecer os formatos','/#sponsors'],
  mark:'DIVULGAÇÃO COM CONTEXTO LOCAL',
  visualTitle:'Uma proposta para cada objetivo.',
  visualText:'Visibilidade regional, relacionamento com consumidores e ações junto a revendas são formatos para avaliação comercial, não anúncios ativos.',
  steps:[
   ['01','Conte seu objetivo','Apresente a cidade, a categoria e o público que deseja alcançar.'],
   ['02','Escolha uma possibilidade','Explore presença identificada, benefícios para clientes ou ações regionais.'],
   ['03','Defina as condições','Orçamento, formato, responsabilidades e aprovação vêm antes de qualquer campanha.']
  ],
  storyTitle:'Aparecer faz mais sentido quando há contexto.',
  storyText:'Uma campanha deve conversar com a realidade da região e das compras do dia a dia, sem misturar anúncios patrocinados com a classificação orgânica das ofertas.',
  storyPoints:['Publicidade patrocinada deve ser claramente identificada.','Formatos, públicos e investimentos são avaliados individualmente.','Nenhuma campanha é ativada automaticamente pelo envio de interesse.'],
  questions:[
   ['Quais tipos de marcas podem conversar com o TAMÃO?','Empresas interessadas em ações relevantes para os consumidores e revendas da região podem apresentar uma proposta.'],
   ['Há campanhas prontas para compra automática?','Não. As possibilidades apresentadas dependem de avaliação e aprovação comercial.'],
   ['O TAMÃO garante alcance ou vendas?','Não há garantia de alcance, pedidos ou retorno. Cada ação precisa de objetivos e condições definidos.']
  ],
  closing:'Conte sua ideia. Vamos avaliar o formato certo.'
 },
 {
  slug:'indicacoes',
  title:'Rede TAMÃO | Indique Pessoas e Revendas',
  description:'Conheça a Rede TAMÃO. Compartilhe seu convite, apresente compradores e revendas e acompanhe benefícios elegíveis conforme as condições de cada campanha.',
  kicker:'REDE TAMÃO',
  heading:'Quando você indica, novas conexões podem nascer.',
  lead:'Apresente o TAMÃO a quem compra e a quem vende. Compartilhe seu convite pessoal, acompanhe sua rede e conheça os benefícios aplicáveis a cada participação.',
  primary:['Conhecer minha rede','/?entrada=indicar'],
  secondary:['Entender os benefícios','/#earn'],
  mark:'CONEXÕES QUE APROXIMAM A CIDADE',
  visualTitle:'Seu convite pode ir mais longe.',
  visualText:'Pessoas e empresas têm jornadas de indicação diferentes. Atribuições e recompensas dependem de campanhas elegíveis e validações.',
  steps:[
   ['01','Compartilhe','Convide amigos e apresente revendas interessadas.'],
   ['02','Acompanhe','Consulte seus convites e as participações atribuídas à sua rede.'],
   ['03','Conheça os benefícios','Cada campanha tem regras, condições e momentos de validação próprios.']
  ],
  storyTitle:'Uma rede útil começa com uma boa indicação.',
  storyText:'A Rede TAMÃO foi pensada para aproximar consumidores, empresas e oportunidades de participação de forma simples e organizada.',
  storyPoints:['Convites de clientes e de revendas possuem caminhos próprios.','Cashback por compras e comissões por indicação são benefícios distintos.','A participação não representa promessa de renda ou pagamento automático.'],
  questions:[
   ['Posso indicar uma revenda?','Sim. A Rede TAMÃO contempla convites para empresas interessadas, com atribuição e validação próprias.'],
   ['Toda indicação gera uma comissão?','Não. Benefícios financeiros dependem de campanha ativa, elegibilidade e dos eventos exigidos em suas regras.'],
   ['Onde vejo meus convites?','Na área Minha Rede TAMÃO, acessível pela apresentação da Rede.']
  ],
  closing:'Compartilhe uma boa descoberta.'
 }
];

const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');

function renderLanding(page,origin,indexing){
 const canonical=origin+'/'+page.slug+'/';
 const cards=page.steps.map(([number,title,description])=>\`<article class="ed-step">
   <span class="ed-step-number">\${esc(number)}</span>
   <h3>\${esc(title)}</h3><p>\${esc(description)}</p>
  </article>\`).join('');
 const bullets=page.storyPoints.map(item=>'<li>'+esc(item)+'</li>').join('');
 const questions=page.questions.map(([q,a])=>'<details><summary>'+esc(q)+'</summary><p>'+esc(a)+'</p></details>').join('');
 const primary=\`<a class="ed-btn ed-btn-primary" href="\${esc(page.primary[1])}">\${esc(page.primary[0])} <span aria-hidden="true">→</span></a>\`;
 const secondary=\`<a class="ed-btn ed-btn-outline" href="\${esc(page.secondary[1])}">\${esc(page.secondary[0])}</a>\`;
 const navigation=PAGES.map(x=>\`<a href="/\${x.slug}/" \${x.slug===page.slug?'aria-current="page"':''}>\${esc(x.slug==='como-funciona'?'Como funciona':x.slug==='para-revendas'?'Para revendas':x.slug==='para-marcas'?'Para marcas':'Indicações')}</a>\`).join('');
 return \`<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="\${indexing?'index,follow,max-image-preview:large':'noindex,nofollow,noarchive,nosnippet'}" />
<meta name="theme-color" content="#0d6b4b" />
<meta name="description" content="\${esc(page.description)}" />
<link rel="canonical" href="\${esc(canonical)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="TAMÃO" />
<meta property="og:locale" content="pt_BR" />
<meta property="og:title" content="\${esc(page.title)}" />
<meta property="og:description" content="\${esc(page.description)}" />
<meta property="og:url" content="\${esc(canonical)}" />
<meta name="twitter:card" content="summary" />
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
<link rel="stylesheet" href="/css/landing-editorial.css" />
<title>\${esc(page.title)}</title>
</head><body>
<a class="ed-skip" href="#conteudo">Pular para o conteúdo</a>
<header class="ed-header"><div class="ed-shell ed-header-inner">
  <a href="/" class="ed-brand" aria-label="TAMÃO, ir para a home"><img src="/icons/icon.svg" width="43" height="43" alt="" /><span><strong>TAMÃO</strong><small>Pediu? Tá na mão.</small></span></a>
  <nav class="ed-nav" aria-label="Conheça o TAMÃO">\${navigation}</nav>
  <a class="ed-header-cta" href="/">Quero comprar <span aria-hidden="true">→</span></a>
</div></header>
<main id="conteudo">
 <section class="ed-hero"><div class="ed-shell ed-hero-grid">
  <div class="ed-hero-copy">
   <span class="ed-eyebrow">\${esc(page.kicker)}</span>
   <h1>\${esc(page.heading)}</h1>
   <p>\${esc(page.lead)}</p>
   <div class="ed-actions">\${primary}\${secondary}</div>
   <div class="ed-hero-notes" aria-label="Sobre o TAMÃO"><span>✓ Informação clara</span><span>✓ Foco na sua região</span><span>✓ Você decide o próximo passo</span></div>
  </div>
  <aside class="ed-hero-visual" aria-label="Apresentação ilustrativa da proposta do TAMÃO">
   <span class="ed-visual-kicker">\${esc(page.mark)}</span>
   <div class="ed-product-scene" aria-hidden="true">
    <div class="ed-halo"></div><div class="ed-product ed-product-gas"></div><div class="ed-product ed-product-water"></div>
    <span class="ed-scene-label">Gás • Água • Essenciais</span>
   </div>
   <div class="ed-visual-copy"><h2>\${esc(page.visualTitle)}</h2><p>\${esc(page.visualText)}</p></div>
  </aside>
 </div></section>
 <section class="ed-section ed-shell" aria-labelledby="etapas"><div class="ed-section-head"><span class="ed-eyebrow">DO INTERESSE À AÇÃO</span><h2 id="etapas">Simples de entender. Fácil de começar.</h2></div>
 <div class="ed-steps">\${cards}</div></section>
 <section class="ed-section ed-shell ed-value" aria-labelledby="beneficios">
  <div><span class="ed-eyebrow">O QUE FAZ DIFERENÇA</span><h2 id="beneficios">\${esc(page.storyTitle)}</h2><p>\${esc(page.storyText)}</p></div>
  <ul>\${bullets}</ul>
 </section>
 <section class="ed-section ed-shell ed-faq" aria-labelledby="duvidas">
  <div class="ed-section-head"><span class="ed-eyebrow">RESPOSTAS DIRETAS</span><h2 id="duvidas">Dúvidas que vale esclarecer.</h2></div><div class="ed-faq-items">\${questions}</div>
 </section>
 <section class="ed-shell ed-last"><div><span class="ed-eyebrow">SEU PRÓXIMO PASSO</span><h2>\${esc(page.closing)}</h2></div>\${primary}</section>
</main>
<footer class="ed-footer"><div class="ed-shell ed-footer-inner">
 <div><a href="/" class="ed-footer-brand">TAMÃO</a><small>Gás, água e essenciais perto de você. Consulte a disponibilidade para sua região.</small></div>
 <nav aria-label="Informações e privacidade"><a href="/#contact">Contato</a><a href="/#privacy">Privacidade</a><a href="/#terms">Termos de uso</a></nav>
</div></footer>
</body></html>\`;
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
