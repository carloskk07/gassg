// TAMÃO V1.1090 — premium sponsor-only experience, loaded on demand.
// Keeps the customer homepage lightweight; this module never enables billing.
function sponsorJumpTo(id){
 if(!['sponsor-formats','sponsor-pricing','sponsor-faq'].includes(id))return false;
 const section=document.getElementById(id);
 if(!section)return false;
 const reduce=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true;
 section.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'});
 section.focus?.({preventScroll:true});
 return true;
}
function sponsorsLandingPremium(){
  return shell(`<section class="page tamao-sponsors-page sponsor-premium-v1090">
<header class="tamao-sponsor-hero sponsor-premium-hero">
 <div class="sponsor-hero-layout">
  <div class="sponsor-hero-copy">
   <span class="sponsor-premium-eyebrow"><span class="sponsor-premium-dot" aria-hidden="true"></span> PUBLICIDADE LOCAL NO TAMÃO</span>
   <h1 class="page-title">Sua marca merece <em>ser vista</em> por quem vive a sua cidade.</h1>
   <p class="page-lead">Apresente sua empresa, seus serviços e suas novidades em um espaço pensado para conectar negócios e pessoas. Escolha a região e prepare sua campanha com clareza.</p>
   <div class="sponsor-premium-actions">
    <button type="button" class="primary sponsor-premium-main-cta" onclick="sponsorJumpTo('sponsor-pricing')">Criar meu anúncio <span aria-hidden="true">→</span></button>
    <button type="button" class="sponsor-premium-link" onclick="sponsorJumpTo('sponsor-formats')">Conhecer os formatos <span aria-hidden="true">↗</span></button>
   </div>
   <div class="sponsor-premium-hero-proof"><span>✓ Sem precisar ter revenda</span><span>✓ Escolha sua região</span><span>✓ Proposta antes de pagar</span></div>
  </div>
  <aside class="sponsor-premium-visual" aria-label="Prévia ilustrativa de anúncio identificado">
   <div class="sponsor-premium-browser"><span class="sponsor-premium-browser-dots" aria-hidden="true">● ● ●</span><strong>TAMÃO</strong><small>Prévia de anúncio</small></div>
   <div class="sponsor-premium-ad-mock">
    <span class="sponsor-premium-ad-tag">PUBLICIDADE IDENTIFICADA</span>
    <div class="sponsor-premium-ad-art" aria-hidden="true"><span class="sponsor-premium-ad-orbit"></span><span class="sponsor-premium-ad-shape">✦</span></div>
    <span class="sponsor-premium-ad-brand">A SUA MARCA AQUI</span>
    <strong>Seu negócio em destaque nas escolhas da cidade.</strong>
    <p>Uma apresentação clara e profissional para o público conhecer sua empresa.</p>
    <span class="sponsor-premium-ad-action">Conhecer a empresa <span aria-hidden="true">↗</span></span>
   </div>
   <p class="sponsor-premium-visual-note">Apresentação ilustrativa, não é anúncio publicado. Localização e exibição dependem de revisão e inventário disponível.</p>
  </aside>
 </div>
</header>
<div class="sponsor-premium-trust-rail" aria-label="O que sua empresa encontra no TAMÃO">
 <div><span aria-hidden="true">⌖</span><strong>Presença por cidade</strong><small>Você indica a região de interesse.</small></div>
 <div><span aria-hidden="true">✦</span><strong>Sua marca identificada</strong><small>Conteúdo patrocinado claramente sinalizado.</small></div>
 <div><span aria-hidden="true">◷</span><strong>Prazo e orçamento</strong><small>Condições conhecidas antes da contratação.</small></div>
 <div><span aria-hidden="true">▤</span><strong>Acompanhamento</strong><small>Status da campanha em sua conta.</small></div>
</div>
<section class="sponsor-premium-why" aria-label="Vantagens de anunciar no TAMÃO">
 <div class="sponsor-premium-section-heading"><span class="section-kicker">VISIBILIDADE PARA QUEM EMPREENDE</span><h2>Mais presença para o seu negócio, sem complicar sua rotina.</h2><p>Você não precisa vender produtos pelo TAMÃO para divulgar a sua marca. Campanhas independentes seguem critérios de revisão, região e disponibilidade.</p></div>
 <div class="sponsor-premium-value-grid">
  <article><span aria-hidden="true">01</span><h3>Mostre o que a empresa faz</h3><p>Apresente sua mensagem em um anúncio identificado e direcione interessados ao seu site oficial.</p></article>
  <article><span aria-hidden="true">02</span><h3>Escolha o contexto local</h3><p>Indique a cidade que faz sentido para sua campanha e o orçamento que pretende investir.</p></article>
  <article><span aria-hidden="true">03</span><h3>Tenha clareza em cada etapa</h3><p>Envie a proposta, acompanhe sua situação e conheça as condições antes da ativação.</p></article>
 </div>
</section>
<section class="section sponsor-formats sponsor-premium-formats" id="sponsor-formats" tabindex="-1" aria-label="Formatos para sua campanha">
 <div class="sponsor-premium-section-heading"><span class="section-kicker">ESCOLHA SEU OBJETIVO</span><h2>Publicidade para diferentes momentos do seu negócio.</h2><p>Comece com um anúncio identificado ou converse sobre uma ação de benefícios e parcerias regionais.</p></div>
 <div class="sponsor-format-grid">
  <article><span>01 / VISIBILIDADE</span><span class="sponsor-premium-format-icon" aria-hidden="true">✦</span><h3>Anúncio da sua empresa</h3><p>Apresente sua marca em áreas elegíveis do TAMÃO, conforme a cidade e a disponibilidade de espaços.</p><button type="button" onclick="openSponsorContact('visibility')">Quero divulgar minha marca <span aria-hidden="true">→</span></button></article>
  <article><span>02 / RELACIONAMENTO</span><span class="sponsor-premium-format-icon" aria-hidden="true">♡</span><h3>Ações com benefícios</h3><p>Converse sobre campanhas com vantagens para clientes, orçamento e regras previamente combinados.</p><button type="button" onclick="openSponsorContact('relationship')">Conversar sobre benefícios <span aria-hidden="true">→</span></button></article>
  <article><span>03 / COMÉRCIO LOCAL</span><span class="sponsor-premium-format-icon" aria-hidden="true">◇</span><h3>Parceria regional</h3><p>Estude ações com revendas elegíveis, quando houver parceiros e operação disponíveis na cidade.</p><button type="button" onclick="openSponsorContact('local')">Explorar parceria regional <span aria-hidden="true">→</span></button></article>
 </div>
 <p class="sponsor-premium-format-note">Para criar um anúncio independente, use o formulário abaixo. As outras opções começam com uma conversa sem compromisso.</p>
</section>
<section class="sponsor-premium-how" aria-label="Como criar um anúncio">
 <div class="sponsor-premium-section-heading"><span class="section-kicker">COMEÇAR É SIMPLES</span><h2>Três etapas para preparar sua campanha.</h2></div>
 <ol class="sponsor-premium-steps">
  <li><span>01</span><div><h3>Escolha região e orçamento</h3><p>Veja valores de planejamento e o prazo relacionado.</p></div></li>
  <li><span>02</span><div><h3>Apresente sua marca</h3><p>Confirme o e-mail e informe nome da empresa, texto e site oficial.</p></div></li>
  <li><span>03</span><div><h3>Acompanhe a revisão</h3><p>O envio não cobra nem publica automaticamente. Você acompanha a proposta na sua conta.</p></div></li>
 </ol>
</section>
<section class="sponsor-premium-workspace" id="sponsor-pricing" tabindex="-1" aria-label="Planejar e cadastrar anúncio">
 <div class="sponsor-premium-section-heading"><span class="section-kicker">CRIE SUA CAMPANHA</span><h2>Comece com uma proposta clara.</h2><p>Escolha uma referência de investimento e envie o anúncio para análise. Condições e possibilidade de exibição são conferidas antes de qualquer pagamento.</p></div>
 ${(globalThis.tamaoAdsPlannerLoad?.(),globalThis.tamaoAdsPlannerSection?.()||'<p role="status">Carregando opções de campanha…</p>')}
</section>
<section class="sponsor-premium-faq" id="sponsor-faq" tabindex="-1" aria-label="Dúvidas de quem anuncia">
 <div class="sponsor-premium-section-heading"><span class="section-kicker">TRANSPARÊNCIA</span><h2>Respostas para anunciar com confiança.</h2></div>
 <div class="sponsor-premium-faq-list">
  <details><summary>Preciso ter uma revenda no TAMÃO?</summary><p>Não. Marcas, empresas e profissionais podem enviar anúncios independentes para análise.</p></details>
  <details><summary>Quanto custa anunciar?</summary><p>Existem referências de planejamento a partir de R$ 19,90 por 7 dias. O orçamento selecionado não é cobrança nem reserva de público; os termos da contratação são confirmados antes do pagamento.</p></details>
  <details><summary>Quantas pessoas verão meu anúncio?</summary><p>Não prometemos audiência, cliques ou conversões. A entrega depende de inventário disponível, e os sinais de visualização seguem os critérios de medição informados.</p></details>
  <details><summary>O anúncio vai ao ar quando eu envio?</summary><p>Não. Primeiro a campanha é revisada; a publicação depende da aprovação e das condições operacionais e comerciais.</p></details>
  <details><summary>Como acompanho a campanha?</summary><p>Depois de entrar com seu e-mail confirmado, consulte a seção Minhas campanhas para acompanhar a situação registrada.</p></details>
 </div>
</section>
<section class="sponsor-premium-closing" aria-label="Comece a divulgar sua empresa">
 <div><span class="section-kicker">SUA MARCA MERECE DESTAQUE</span><h2>Comece com uma apresentação que passa confiança.</h2><p>Prepare seu anúncio ou converse sobre uma ação regional. O primeiro contato não gera cobrança.</p></div>
 <div class="sponsor-premium-closing-actions"><button type="button" class="primary" onclick="sponsorJumpTo('sponsor-pricing')">Preparar meu anúncio <span aria-hidden="true">→</span></button><button type="button" class="secondary" onclick="openSponsorContact()">Conversar sobre publicidade</button></div>
</section>
</section>`);
}


globalThis.tamaoSponsorPremiumLanding=sponsorsLandingPremium;
globalThis.sponsorJumpTo=sponsorJumpTo;
