/* Loaded only on the public #learn route. */
function learnPremiumPage(){
return shell(`<section class="page learn-premium">
  <section class="learn-hero" aria-labelledby="learn-hero-title">
    <div class="learn-hero-copy">
      <span class="learn-eyebrow"><span class="learn-eyebrow-mark" aria-hidden="true"></span> COMO FUNCIONA O TAMÃO</span>
      <h1 id="learn-hero-title">Tudo mais simples, <em>do primeiro clique à entrega.</em></h1>
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
    <div class="learn-visual" aria-hidden="true">
      <div class="learn-visual-top"><span class="learn-visual-dot"></span><span>UMA COMPRA MAIS TRANQUILA</span><span class="learn-visual-star">✳</span></div>
      <div class="learn-visual-intro"><span>01 / 04</span><strong>O que você precisa hoje?</strong><small>Você começa escolhendo, sem compromisso.</small></div>
      <div class="learn-visual-products"><span>Gás</span><span>Água</span><span>Essenciais</span></div>
      <div class="learn-visual-flow">
        <div><b>01</b><span>Escolha</span></div><i></i>
        <div><b>02</b><span>Consulte</span></div><i></i>
        <div><b>03</b><span>Confirme</span></div><i></i>
        <div><b>04</b><span>Acompanhe</span></div>
      </div>
      <div class="learn-visual-bottom"><span class="learn-visual-check">✓</span><span><strong>Você decide antes de confirmar.</strong><small>Valor total e previsão de entrega apresentados na jornada.</small></span></div>
    </div>
  </section>

  <div class="learn-trust-strip" aria-label="O que esperar do TAMÃO">
    <div><span class="learn-strip-icon" aria-hidden="true">01</span><span><strong>Ofertas da sua região</strong><small>Disponibilidade consultada pelo endereço</small></span></div>
    <div><span class="learn-strip-icon" aria-hidden="true">02</span><span><strong>Controle na sua mão</strong><small>Você escolhe antes de finalizar</small></span></div>
    <div><span class="learn-strip-icon" aria-hidden="true">03</span><span><strong>Informação durante a entrega</strong><small>Etapas informadas pela revenda</small></span></div>
  </div>

  <section class="learn-section learn-steps" id="buyer-guide-steps" tabindex="-1" aria-labelledby="learn-steps-title">
    <div class="learn-section-header">
      <div><span class="learn-label">UMA JORNADA CLARA</span><h2 id="learn-steps-title">Quatro passos. <em>Sem adivinhação.</em></h2></div>
      <p>Do produto ao recebimento, você sabe o que acontece antes de seguir para o próximo passo.</p>
    </div>
    <div class="learn-step-grid">
      <article class="learn-step"><span class="learn-step-number">01</span><div class="learn-step-art" aria-hidden="true">▦</div><h3>Escolha seus produtos</h3><p>Explore gás, água e outros itens disponíveis. Você pode montar a cesta que faz sentido para você.</p><small>Você escolhe</small></article>
      <article class="learn-step"><span class="learn-step-number">02</span><div class="learn-step-art" aria-hidden="true">⌖</div><h3>Informe o endereço</h3><p>Consulte as revendas que podem atender seu CEP e confira as opções e condições apresentadas.</p><small>Você consulta</small></article>
      <article class="learn-step"><span class="learn-step-number">03</span><div class="learn-step-art" aria-hidden="true">✓</div><h3>Confira e confirme</h3><p>Veja o valor total e a previsão de entrega. A revenda precisa aceitar para confirmar o pedido.</p><small>A revenda aceita</small></article>
      <article class="learn-step"><span class="learn-step-number">04</span><div class="learn-step-art" aria-hidden="true">↗</div><h3>Acompanhe a entrega</h3><p>Consulte o andamento informado pela revenda, do preparo à saída para entrega.</p><small>Você acompanha</small></article>
    </div>
  </section>

  <section class="learn-confidence" aria-labelledby="learn-confidence-title">
    <div class="learn-confidence-story">
      <span class="learn-label">CONFIANÇA SE CONSTRÓI COM CLAREZA</span>
      <h2 id="learn-confidence-title">Você sabe <em>quem faz o quê.</em></h2>
      <p>O TAMÃO conecta você às revendas participantes e organiza as informações do pedido. A revenda é responsável por aceitar, preparar e realizar a entrega.</p>
      <ul class="learn-confidence-list">
        <li><span aria-hidden="true">✓</span><div><strong>O valor aparece antes de confirmar</strong><small>Se uma alternativa mais cara for oferecida, você decide se aceita.</small></div></li>
        <li><span aria-hidden="true">✓</span><div><strong>O pedido depende do aceite</strong><small>Sem confirmação da revenda, não apresentamos a entrega como garantida.</small></div></li>
        <li><span aria-hidden="true">✓</span><div><strong>As atualizações têm significado</strong><small>O andamento reflete as etapas informadas pelo parceiro.</small></div></li>
      </ul>
    </div>
    <aside class="learn-confidence-panel" aria-label="Transparência na entrega">
      <span class="learn-confidence-panel-tag">TRANSPARÊNCIA EM CADA ETAPA</span>
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
      <div><span class="learn-label">O TAMÃO VAI ALÉM DO PEDIDO</span><h2 id="learn-benefits-title">Mais motivos para <em>fazer parte.</em></h2></div>
      <p>Além de comprar, você pode conhecer os benefícios oferecidos pela plataforma.</p>
    </div>
    <div class="learn-benefits-grid">
      <article class="learn-benefit-card learn-benefit-club"><span class="learn-benefit-symbol" aria-hidden="true">✦</span><span class="learn-label">CLUBE TAMÃO</span><h3>Benefícios que acompanham você.</h3><p>Consulte seus cupons e créditos de cashback elegíveis para usar em compras futuras, de acordo com as condições de cada benefício.</p><button type="button" onclick="go('club')">Conhecer o Clube <span aria-hidden="true">→</span></button></article>
      <article class="learn-benefit-card learn-benefit-network"><span class="learn-benefit-symbol" aria-hidden="true">↗</span><span class="learn-label">REDE TAMÃO</span><h3>Indicar também aproxima pessoas.</h3><p>Compartilhe seus convites, acompanhe indicações e conheça as regras das comissões e campanhas disponíveis.</p><button type="button" onclick="go('earn')">Conhecer a Rede <span aria-hidden="true">→</span></button></article>
    </div>
  </section>

  <section class="learn-faq" id="buyer-guide-questions" tabindex="-1" aria-labelledby="learn-faq-title">
    <div class="learn-faq-heading"><span class="learn-label">SUAS DÚVIDAS, NOSSAS RESPOSTAS</span><h2 id="learn-faq-title">Tudo explicado, <em>sem letras miúdas.</em></h2><p>Informações importantes para escolher e pedir com tranquilidade.</p><button class="learn-contact-link" type="button" onclick="go('contact')">Precisa de ajuda? Fale com o TAMÃO <span aria-hidden="true">→</span></button></div>
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
    <div><span class="learn-label">PEDIU? TÁ NA MÃO.</span><h2 id="learn-finish-title">Pronto para escolher <em>o que precisa?</em></h2><p>Comece pelos produtos. A disponibilidade e as condições de entrega são consultadas para a sua região.</p></div>
    <div class="learn-finish-actions"><button class="learn-button learn-button-light" type="button" onclick="startHomeBrowse()">Ver produtos <span aria-hidden="true">→</span></button><button class="learn-button learn-button-quiet" type="button" onclick="go('merchants')">Tenho uma revenda <span aria-hidden="true">↗</span></button></div>
  </section>
</section>`)
}
