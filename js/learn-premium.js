/* Loaded only on the public #learn route. */
function learnPremiumPage(){
return shell(`<section class="page learn-premium">
  <section class="learn-hero" aria-labelledby="learn-hero-title">
    <div class="learn-hero-copy">
      <span class="learn-eyebrow"><span class="learn-eyebrow-mark" aria-hidden="true"></span> A EXPERIÊNCIA TAMÃO, PASSO A PASSO</span>
      <h1 id="learn-hero-title">Tudo mais simples, <em>do primeiro clique à entrega.</em></h1>
      <span class="learn-hero-fine-line" aria-hidden="true"></span>
      <p>Encontre gás, água e itens essenciais em um só lugar. Consulte as opções para o seu endereço, veja o valor antes de confirmar e acompanhe cada etapa do pedido.</p>
      <div class="learn-hero-actions">
        <button type="button" class="learn-button learn-button-primary" onclick="startHomeBrowse()">Explorar produtos <span aria-hidden="true">→</span></button>
        <button type="button" class="learn-button learn-button-outline" onclick="publicLandingJump('buyer-guide-steps')">Ver como funciona <span aria-hidden="true">↘</span></button>
      </div>
      <div class="learn-hero-assurances" aria-label="Compromissos da experiência">
        <span><i aria-hidden="true">✓</i> Preço antes do pedido</span>
        <span><i aria-hidden="true">✓</i> Revenda confirma o aceite</span>
        <span><i aria-hidden="true">✓</i> Acompanhamento por etapas</span>
      </div>
    </div>
    <div class="learn-visual" data-step="1" aria-label="Guia interativo de quatro etapas">
      <div class="learn-visual-top"><span class="learn-visual-dot"></span><span>GUIA DA SUA JORNADA</span><span class="learn-visual-star" aria-hidden="true">✳</span></div>
      <div class="learn-visual-intro"><span data-learn-step-count>01 / 04</span><strong data-learn-step-heading>O que você precisa hoje?</strong><small data-learn-step-caption>Você começa escolhendo, sem compromisso.</small></div>
      <div class="learn-visual-products" aria-label="Categorias que você pode encontrar"><span><i aria-hidden="true">◈</i> Gás</span><span><i aria-hidden="true">◈</i> Água</span><span><i aria-hidden="true">◈</i> Essenciais</span></div>
      <div class="learn-visual-guide-label">ESCOLHA UMA ETAPA PARA EXPLORAR <span aria-hidden="true">↘</span></div>
      <div class="learn-visual-flow" role="group" aria-label="Explorar as etapas do pedido">
        <button type="button" class="learn-phase is-active" aria-pressed="true" onclick="learnPremiumSelectStep(1)"><b>01</b><span>Escolha</span></button><i aria-hidden="true"></i>
        <button type="button" class="learn-phase" aria-pressed="false" onclick="learnPremiumSelectStep(2)"><b>02</b><span>Consulte</span></button><i aria-hidden="true"></i>
        <button type="button" class="learn-phase" aria-pressed="false" onclick="learnPremiumSelectStep(3)"><b>03</b><span>Confirme</span></button><i aria-hidden="true"></i>
        <button type="button" class="learn-phase" aria-pressed="false" onclick="learnPremiumSelectStep(4)"><b>04</b><span>Acompanhe</span></button>
      </div>
      <div class="learn-visual-bottom" aria-live="polite" aria-atomic="true"><span class="learn-visual-check" aria-hidden="true">✓</span><span><strong data-learn-step-title>Você decide antes de confirmar.</strong><small data-learn-step-description>Explore os produtos antes de escolher como seguir.</small></span></div>
    </div>
  </section>

  <div class="learn-trust-strip" aria-label="O que esperar do TAMÃO">
    <div class="learn-trust-intro"><span class="learn-label">O ESSENCIAL, BEM FEITO</span><strong>Clareza é parte do serviço.</strong></div>
    <div><span class="learn-strip-icon" aria-hidden="true">01</span><span><strong>Ofertas da sua região</strong><small>Disponibilidade consultada pelo endereço</small></span></div>
    <div><span class="learn-strip-icon" aria-hidden="true">02</span><span><strong>Controle na sua mão</strong><small>Você escolhe antes de finalizar</small></span></div>
    <div><span class="learn-strip-icon" aria-hidden="true">03</span><span><strong>Informação durante a entrega</strong><small>Etapas informadas pela revenda</small></span></div>
  </div>

  <section class="learn-section learn-steps" id="buyer-guide-steps" tabindex="-1" aria-labelledby="learn-steps-title">
    <div class="learn-section-header">
      <div><span class="learn-label">01 — A EXPERIÊNCIA</span><h2 id="learn-steps-title">Quatro passos. <em>Sem adivinhação.</em></h2></div>
      <p>Do produto ao recebimento, você sabe o que acontece antes de seguir para o próximo passo.</p>
    </div>
    <div class="learn-step-grid">
      <article class="learn-step"><span class="learn-step-number">01</span><div class="learn-step-art" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="6.5" width="17" height="14" rx="2"/><path d="M3.5 10.5h17M8 6.5V4m8 2.5V4M8.5 15h3M15 15h1"/></svg></div><h3>Escolha seus produtos</h3><p>Explore gás, água e outros itens disponíveis. Você pode montar a cesta que faz sentido para você.</p><small>Você escolhe</small></article>
      <article class="learn-step"><span class="learn-step-number">02</span><div class="learn-step-art" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.2"/></svg></div><h3>Informe o endereço</h3><p>Consulte as revendas que podem atender seu CEP e confira as opções e condições apresentadas.</p><small>Você consulta</small></article>
      <article class="learn-step"><span class="learn-step-number">03</span><div class="learn-step-art" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3.5v3h6v-3M9 13l2 2 4-4"/></svg></div><h3>Confira e confirme</h3><p>Veja o valor total e a previsão de entrega. A revenda precisa aceitar para confirmar o pedido.</p><small>A revenda aceita</small></article>
      <article class="learn-step"><span class="learn-step-number">04</span><div class="learn-step-art" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h12v11H3zM15 11h3l3 3v4h-6M7 18h-1"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="M15 14h5"/></svg></div><h3>Acompanhe a entrega</h3><p>Consulte o andamento informado pela revenda, do preparo à saída para entrega.</p><small>Você acompanha</small></article>
    </div>
  </section>

  <section class="learn-confidence" aria-labelledby="learn-confidence-title">
    <div class="learn-confidence-story">
      <span class="learn-label">02 — UMA RELAÇÃO TRANSPARENTE</span>
      <h2 id="learn-confidence-title">Você sabe <em>quem faz o quê.</em></h2>
      <p>O TAMÃO conecta você às revendas participantes e organiza as informações do pedido. A revenda é responsável por aceitar, preparar e realizar a entrega.</p>
      <ul class="learn-confidence-list">
        <li><span aria-hidden="true">✓</span><div><strong>O valor aparece antes de confirmar</strong><small>Se uma alternativa mais cara for oferecida, você decide se aceita.</small></div></li>
        <li><span aria-hidden="true">✓</span><div><strong>O pedido depende do aceite</strong><small>Sem confirmação da revenda, não apresentamos a entrega como garantida.</small></div></li>
        <li><span aria-hidden="true">✓</span><div><strong>As atualizações têm significado</strong><small>O andamento reflete as etapas informadas pelo parceiro.</small></div></li>
      </ul>
    </div>
    <aside class="learn-confidence-panel" aria-label="Transparência na entrega">
      <span class="learn-confidence-panel-tag">TRANSPARÊNCIA EM CADA ETAPA</span><span class="learn-confidence-seal" aria-hidden="true">T<span>✓</span></span>
      <h3>Da solicitação à sua porta.</h3>
      <div class="learn-timeline">
        <div><span class="learn-timeline-mark">1</span><span><strong>Solicitação enviada</strong><small>Aguardando o aceite da revenda.</small></span></div>
        <div><span class="learn-timeline-mark">2</span><span><strong>Pedido aceito</strong><small>A revenda confirma que vai atender.</small></span></div>
        <div><span class="learn-timeline-mark">3</span><span><strong>Preparação e saída</strong><small>O parceiro informa o andamento.</small></span></div>
        <div><span class="learn-timeline-mark">4</span><span><strong>Recebimento</strong><small>Confira o pedido e confirme a entrega.</small></span></div>
      </div>
      <p class="learn-panel-footnote">Os horários e a disponibilidade dependem das revendas da sua região.</p>
    </aside>
  </section>

  <section class="learn-benefits" aria-labelledby="learn-benefits-title">
    <div class="learn-section-header">
      <div><span class="learn-label">03 — MAIS POSSIBILIDADES</span><h2 id="learn-benefits-title">Mais motivos para <em>fazer parte.</em></h2></div>
      <p>Além de comprar, você pode conhecer os benefícios oferecidos pela plataforma.</p>
    </div>
    <div class="learn-benefits-grid">
      <article class="learn-benefit-card learn-benefit-club"><span class="learn-benefit-symbol" aria-hidden="true">✦</span><span class="learn-label">CLUBE TAMÃO</span><h3>Benefícios que acompanham você.</h3><p>Consulte seus cupons e créditos de cashback elegíveis para usar em compras futuras, de acordo com as condições de cada benefício.</p><button type="button" onclick="go('club')">Conhecer o Clube <span aria-hidden="true">→</span></button></article>
      <article class="learn-benefit-card learn-benefit-network"><span class="learn-benefit-symbol" aria-hidden="true">↗</span><span class="learn-label">REDE TAMÃO</span><h3>Indicar também aproxima pessoas.</h3><p>Compartilhe seus convites, acompanhe indicações e conheça as regras das comissões e campanhas disponíveis.</p><button type="button" onclick="go('earn')">Conhecer a Rede <span aria-hidden="true">→</span></button></article>
    </div>
  </section>

  <section class="learn-faq" id="buyer-guide-questions" tabindex="-1" aria-labelledby="learn-faq-title">
    <div class="learn-faq-heading"><span class="learn-label">04 — SEM DÚVIDAS</span><h2 id="learn-faq-title">Tudo explicado, <em>sem letras miúdas.</em></h2><p>Informações importantes para escolher e pedir com tranquilidade.</p><button class="learn-contact-link" type="button" onclick="go('contact')">Precisa de ajuda? Fale com o TAMÃO <span aria-hidden="true">→</span></button></div>
    <div class="learn-faq-items">
      <details open><summary>Posso consultar produtos sem criar uma conta?</summary><p>Sim. Você pode explorar os produtos disponíveis. Para concluir uma compra, é necessário se identificar com nome, telefone e e-mail confirmado; o endereço de entrega é solicitado na compra.</p></details>
      <details><summary>Preciso comprar gás para pedir água ou outros itens?</summary><p>Não. Quando houver oferta para o produto na sua região, você pode montar uma cesta sem gás.</p></details>
      <details><summary>O preço pode mudar depois que eu escolho?</summary><p>O valor escolhido não muda sem sua autorização. Caso seja apresentada uma alternativa mais cara, você decide se deseja aceitá-la.</p></details>
      <details><summary>Como sei que a revenda assumiu o pedido?</summary><p>O pedido só é confirmado quando uma revenda aceita. A indicação de saída para entrega aparece quando a revenda informa essa etapa.</p></details>
      <details><summary>E se ninguém aceitar meu pedido?</summary><p>Sem aceite, o pedido não é confirmado. O TAMÃO pode procurar outra opção e informa quando não houver atendimento disponível.</p></details>
      <details><summary>Como a entrega é concluída?</summary><p>A conclusão requer confirmação do pagamento e o código de recebimento do pedido. Informe o código somente após receber o que comprou.</p></details>
      <details><summary>Como funcionam cashback e indicações?</summary><p>Compras elegíveis podem gerar créditos para uso no TAMÃO. Indicações podem gerar comissões em campanhas habilitadas, após os critérios de compra, entrega, pagamento e validação. Consulte as regras do Clube e da Rede.</p></details>
      <details><summary>Tenho uma revenda. Posso participar?</summary><p>Sim. Revendas podem solicitar participação, cadastrar produtos que comercializam e, quando aplicável, comprovar as autorizações necessárias para vender gás.</p></details>
    </div>
  </section>

  <section class="learn-finish" aria-labelledby="learn-finish-title">
    <div><span class="learn-label">TAMÃO · PEDIU? TÁ NA MÃO.</span><h2 id="learn-finish-title">Pronto para escolher <em>o que precisa?</em></h2><p>Comece pelos produtos. A disponibilidade e as condições de entrega são consultadas para a sua região.</p></div>
    <div class="learn-finish-actions"><button class="learn-button learn-button-light" type="button" onclick="startHomeBrowse()">Ver produtos <span aria-hidden="true">→</span></button><button class="learn-button learn-button-quiet" type="button" onclick="go('merchants')">Tenho uma revenda <span aria-hidden="true">↗</span></button></div>
  </section>
</section>`)
}

/**
 * Explore the buying journey without fabricating a quote, purchase,
 * delivery state, participating merchant, payment or active benefit.
 */
function learnPremiumSelectStep(value){
  const step=Number(value);
  if(!Number.isInteger(step)||step<1||step>4)return false;
  if(typeof document==='undefined')return false;
  const root=document.querySelector('.learn-premium');
  if(!root)return false;
  const entries=[
    ['O que você precisa hoje?','Você começa escolhendo, sem compromisso.','Você decide antes de confirmar.','Explore os produtos antes de escolher como seguir.'],
    ['Sua região, suas opções.','O CEP ajuda a mostrar o atendimento disponível.','Disponibilidade de verdade.','Consulte as revendas e as condições apresentadas para o seu endereço.'],
    ['Confira antes de confirmar.','Você vê as condições antes de avançar.','O pedido depende do aceite.','A revenda precisa confirmar que pode atender a solicitação.'],
    ['Acompanhe com clareza.','As etapas são informadas pela revenda.','Informação até o recebimento.','Consulte o andamento e confirme o recebimento quando a entrega chegar.']
  ];
  const entry=entries[step-1];
  root.querySelectorAll('.learn-phase').forEach((button,index)=>{
    const active=index===step-1;
    button.setAttribute('aria-pressed',String(active));
    button.classList.toggle('is-active',active);
  });
  const visual=root.querySelector('.learn-visual');
  if(visual)visual.dataset.step=String(step);
  const values={
    '[data-learn-step-count]':String(step).padStart(2,'0')+' / 04',
    '[data-learn-step-heading]':entry[0],
    '[data-learn-step-caption]':entry[1],
    '[data-learn-step-title]':entry[2],
    '[data-learn-step-description]':entry[3]
  };
  for(const [selector,copy] of Object.entries(values)){
    const element=root.querySelector(selector);
    if(element)element.textContent=copy;
  }
  return true;
}
