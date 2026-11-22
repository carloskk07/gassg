/* Loaded only on the public #learn route. */
function learnPremiumPage(){
// A route re-render starts with a clean visible search state.
learnPremiumFaqState.topic='todos';
learnPremiumFaqState.query='';
return shell(`<section class="page learn-premium">
  <section class="learn-hero" aria-labelledby="learn-hero-title">
    <div class="learn-hero-copy">
      <span class="learn-eyebrow"><span class="learn-eyebrow-mark" aria-hidden="true"></span> TAMÃO / PARA O SEU DIA A DIA</span>
      <h1 id="learn-hero-title">O essencial para sua casa. <em>Com tudo mais simples.</em></h1>
      <span class="learn-hero-signature">Simples para pedir. Claro para acompanhar.</span>
      <span class="learn-hero-fine-line" aria-hidden="true"></span>
      <p>Encontre gás, água e itens essenciais nas revendas da sua região. Confira o valor e as condições antes de solicitar. A revenda confirma o atendimento; você acompanha cada etapa informada.</p>
      <div class="learn-hero-actions">
        <button type="button" class="learn-button learn-button-primary" onclick="startHomeBrowse()">Explorar produtos <span aria-hidden="true">→</span></button>
        <button type="button" class="learn-button learn-button-outline" onclick="learnPremiumJump('learn-guided-tour')">Ver como funciona <span aria-hidden="true">↘</span></button>
      </div>
      <div class="learn-hero-assurances" aria-label="Compromissos da experiência">
        <span><i aria-hidden="true">✓</i> Consulte sem criar conta</span>
        <span><i aria-hidden="true">✓</i> Confira o valor antes do pedido</span>
        <span><i aria-hidden="true">✓</i> Revenda confirma o aceite</span>
      </div>
    </div>
    <figure class="learn-merchandise" aria-labelledby="learn-merchandise-title">
      <figcaption class="learn-merchandise-heading">
        <span>UMA VITRINE PARA SUA ROTINA</span>
        <strong id="learn-merchandise-title">O que importa, em primeiro lugar.</strong>
      </figcaption>
      <div class="learn-merchandise-grid" aria-label="Exemplos de categorias de produtos">
        <div class="learn-merchandise-card">
          <span class="learn-merchandise-photo learn-photo-gas" aria-hidden="true"></span>
          <span class="learn-merchandise-card-label"><strong>Gás</strong><small>Para sua casa</small></span>
        </div>
        <div class="learn-merchandise-card">
          <span class="learn-merchandise-photo learn-photo-water" aria-hidden="true"></span>
          <span class="learn-merchandise-card-label"><strong>Água</strong><small>Para o dia a dia</small></span>
        </div>
        <div class="learn-merchandise-card">
          <span class="learn-merchandise-photo learn-photo-coal" aria-hidden="true"></span>
          <span class="learn-merchandise-card-label"><strong>Carvão</strong><small>Itens essenciais</small></span>
        </div>
        <div class="learn-merchandise-card">
          <span class="learn-merchandise-photo learn-photo-firewood" aria-hidden="true"></span>
          <span class="learn-merchandise-card-label"><strong>Lenha</strong><small>Quando precisar</small></span>
        </div>
      </div>
      <div class="learn-merchandise-footer"><span class="learn-merchandise-accent" aria-hidden="true"></span>Produtos ilustrativos; confira a disponibilidade para sua região.</div>
    </figure>
  </section>

  <section class="learn-guided-tour" id="learn-guided-tour" tabindex="-1" aria-labelledby="learn-tour-title">
    <div class="learn-guide-intro">
      <span class="learn-label">CONHEÇA A EXPERIÊNCIA</span>
      <h2 id="learn-tour-title">Cada escolha, <em>com mais clareza.</em></h2>
      <p>Veja o caminho do pedido, da consulta às informações da revenda. Escolha uma etapa para entender os detalhes.</p>
      
      <p class="learn-guide-footnote">O pedido depende da disponibilidade e do aceite da revenda.</p>
    </div>
    <div class="learn-visual" data-step="1" aria-label="Guia interativo de quatro etapas">
      <div class="learn-visual-top"><span class="learn-visual-dot"></span><span>SUA JORNADA, SEM SURPRESAS</span><span class="learn-visual-star" aria-hidden="true">—</span></div>
      <div class="learn-visual-intro"><span data-learn-step-count>01 / 04</span><strong data-learn-step-heading>O que você precisa hoje?</strong><small data-learn-step-caption>Você começa escolhendo, sem compromisso.</small></div>

      <div class="learn-visual-scenes" aria-hidden="true">
        <div class="learn-visual-scene" data-learn-scene="1">
          <span class="learn-scene-title">Escolha por categoria</span>
          <div class="learn-scene-products learn-scene-products-art" aria-hidden="true">
            <span class="learn-product-tile"><span class="learn-product-photo learn-photo-gas"></span><b>Gás</b></span>
            <span class="learn-product-tile"><span class="learn-product-photo learn-photo-water"></span><b>Água</b></span>
            <span class="learn-product-tile"><span class="learn-product-photo learn-photo-coal"></span><b>Essenciais</b></span>
          </div>
        </div>
        <div class="learn-visual-scene" data-learn-scene="2" hidden>
          <span class="learn-scene-title">Consulta por região</span>
          <div class="learn-scene-map" aria-hidden="true">
            <svg viewBox="0 0 340 95" preserveAspectRatio="xMidYMid meet" fill="none">
              <path d="M0 27H340M0 72H340M52 0V95M113 0V95M228 0V95M289 0V95" stroke="#DCE8DF" stroke-width="1"/>
              <path d="M58 70c43-48 70-49 114-14s74 15 111-18" stroke="#13805B" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="3 8"/>
              <circle cx="58" cy="70" r="16" fill="#E4F1E8" stroke="#0C7F56" stroke-width="2"/><circle cx="58" cy="70" r="5" fill="#0C7F56"/>
              <path d="M283 15c-12 0-20 8-20 20 0 14 20 35 20 35s20-21 20-35c0-12-8-20-20-20Z" fill="#0A7652"/>
              <circle cx="283" cy="35" r="7.5" fill="#E9F8E8"/>
            </svg>
            <span>Seu endereço</span><span>Atendimento conforme a região</span>
          </div>
        </div>
        <div class="learn-visual-scene" data-learn-scene="3" hidden>
          <span class="learn-scene-title">Confirmação com transparência</span>
          <div class="learn-scene-review learn-scene-review-art" aria-hidden="true">
             <span class="learn-scene-review-card"><svg viewBox="0 0 36 36" fill="none"><rect x="8" y="5" width="20" height="26" rx="5" fill="#EDF5EA" stroke="#157455" stroke-width="1.8"/><path d="M13 13h10M13 18h10M13 23h6" stroke="#448A67" stroke-width="2" stroke-linecap="round"/></svg><b>Você confere</b></span>
             <span class="learn-scene-review-arrow">→</span>
             <span class="learn-scene-review-card"><svg viewBox="0 0 36 36" fill="none"><circle cx="18" cy="18" r="13" fill="#E0F0E6" stroke="#148258" stroke-width="1.8"/><path d="m11 18 5 5 10-11" stroke="#147952" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/></svg><b>Revenda aceita</b></span>
          </div>
        </div>
        <div class="learn-visual-scene" data-learn-scene="4" hidden>
          <span class="learn-scene-title">Acompanhamento por etapas</span>
          <div class="learn-scene-track learn-scene-track-art" aria-hidden="true">
            <span><svg viewBox="0 0 36 36" fill="none"><rect x="8" y="5" width="20" height="26" rx="4" fill="#E4F2E8" stroke="#177957" stroke-width="1.7"/><path d="M13 13h10M13 19h7" stroke="#177957" stroke-width="1.8" stroke-linecap="round"/></svg><b>Solicitação</b></span>
            <i></i>
            <span><svg viewBox="0 0 36 36" fill="none"><circle cx="18" cy="18" r="13" fill="#E6F3E7" stroke="#187B58" stroke-width="1.7"/><path d="m12 18 4 4 8-9" stroke="#187B58" stroke-width="2.2" stroke-linecap="round"/></svg><b>Aceite</b></span>
            <i></i>
            <span><svg viewBox="0 0 36 36" fill="none"><path d="M4 12h17v13H4V12Zm17 5h6l5 5v3H21v-8Z" fill="#E6F3E8" stroke="#187B58" stroke-width="1.8" stroke-linejoin="round"/><circle cx="11" cy="26" r="3" fill="#D7F0DF" stroke="#187B58" stroke-width="1.7"/><circle cx="26" cy="26" r="3" fill="#D7F0DF" stroke="#187B58" stroke-width="1.7"/></svg><b>Entrega</b></span>
          </div>
        </div>
      </div>
      <div class="learn-visual-guide-label">ESCOLHA UMA ETAPA PARA EXPLORAR <span aria-hidden="true">↘</span></div>
      <div class="learn-visual-flow" role="group" aria-label="Explorar as etapas do pedido" onkeydown="learnPremiumStageKeydown(event)">
        <button type="button" class="learn-phase is-active" aria-pressed="true" onclick="learnPremiumSelectStep(1)"><b>01</b><span>Escolha</span></button><i aria-hidden="true"></i>
        <button type="button" class="learn-phase" aria-pressed="false" onclick="learnPremiumSelectStep(2)"><b>02</b><span>Consulte</span></button><i aria-hidden="true"></i>
        <button type="button" class="learn-phase" aria-pressed="false" onclick="learnPremiumSelectStep(3)"><b>03</b><span>Confirme</span></button><i aria-hidden="true"></i>
        <button type="button" class="learn-phase" aria-pressed="false" onclick="learnPremiumSelectStep(4)"><b>04</b><span>Acompanhe</span></button>
      </div>
      <div class="learn-visual-bottom" aria-live="polite" aria-atomic="true"><span class="learn-visual-check" aria-hidden="true">✓</span><span><strong data-learn-step-title>Você decide antes de confirmar.</strong><small data-learn-step-description>Explore os produtos antes de escolher como seguir.</small></span></div>
      <button class="learn-visual-next" type="button" onclick="learnPremiumStageAction()" data-learn-stage-cta><span data-learn-stage-cta-label>Explorar produtos</span><span aria-hidden="true">→</span></button>
    </div>
  </section>

  <nav class="learn-quick-index" aria-label="Explorar esta página">
    <span>IR DIRETO AO QUE IMPORTA</span>
    <button type="button" onclick="publicLandingJump('buyer-guide-steps')"><b>01</b> Como funciona</button>
    <button type="button" onclick="learnPremiumJump('learn-confidence')"><b>02</b> Sua confiança</button>
    <button type="button" onclick="learnPremiumJump('learn-benefits')"><b>03</b> Benefícios</button>
    <button type="button" onclick="publicLandingJump('buyer-guide-questions')"><b>04</b> Dúvidas</button>
  </nav>

  <section class="learn-trust-strip" aria-labelledby="learn-path-title">
    <div class="learn-trust-intro"><span class="learn-label">VOCÊ ESCOLHE</span><strong id="learn-path-title">Seu próximo passo.</strong><small>Encontre o caminho certo para você.</small></div>
    <div class="learn-trust-path"><span class="learn-strip-icon" aria-hidden="true">01</span><span><strong>Quero comprar</strong><small>Veja as opções da sua região.</small></span><button type="button" onclick="startHomeBrowse()">Explorar produtos <span aria-hidden="true">→</span></button></div>
    <div class="learn-trust-path"><span class="learn-strip-icon" aria-hidden="true">02</span><span><strong>Já tenho um pedido</strong><small>Consulte o andamento da entrega.</small></span><button type="button" onclick="go('tracking')">Acompanhar <span aria-hidden="true">→</span></button></div>
    <div class="learn-trust-path"><span class="learn-strip-icon" aria-hidden="true">03</span><span><strong>Quero benefícios</strong><small>Conheça cupons e créditos elegíveis.</small></span><button type="button" onclick="go('club')">Conhecer o Clube <span aria-hidden="true">→</span></button></div>
    <div class="learn-trust-disclosure" aria-labelledby="learn-transparency-title">
      <div class="learn-trust-disclosure-copy">
        <span class="learn-trust-disclosure-icon" aria-hidden="true">i</span>
        <div>
          <span class="learn-label">COMPROMISSO COM A CLAREZA</span>
          <strong id="learn-transparency-title">Você sabe quem confirma o pedido e o que acontece depois.</strong>
          <small>O TAMÃO conecta e organiza; a revenda aceita e realiza a entrega. O pedido só é confirmado após o aceite da revenda. Preços e condições são apresentados antes de solicitar.</small>
        </div>
      </div>
      <nav class="learn-trust-disclosure-links" aria-label="Atendimento e informações oficiais">
        <button type="button" onclick="go('contact')">Falar com o TAMÃO <span aria-hidden="true">↗</span></button>
        <button type="button" onclick="go('terms')">Termos de uso <span aria-hidden="true">↗</span></button>
        <button type="button" onclick="go('privacy')">Privacidade <span aria-hidden="true">↗</span></button>
      </nav>
    </div>
  </section>

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

  <section class="learn-confidence" id="learn-confidence" tabindex="-1" aria-labelledby="learn-confidence-title">
    <div class="learn-confidence-story">
      <span class="learn-label">02 — UMA RELAÇÃO TRANSPARENTE</span>

      <h2 id="learn-confidence-title">Cada um com seu papel. <em>Você com o controle.</em></h2>
      <p>Confiança começa quando todos sabem exatamente qual é a sua responsabilidade — sem promessas difíceis de cumprir.</p>
      <ul class="learn-confidence-list">
        <li><span aria-hidden="true">T</span><div><strong>O TAMÃO conecta e organiza</strong><small>Reúne opções de compra, informações e o acompanhamento do pedido.</small></div></li>
        <li><span aria-hidden="true">R</span><div><strong>A revenda confirma e entrega</strong><small>Aceita a solicitação, prepara o produto e informa as etapas da entrega.</small></div></li>
        <li><span aria-hidden="true">✓</span><div><strong>Você escolhe e confere</strong><small>Analisa o valor, decide sobre alternativas e confirma o recebimento após a entrega.</small></div></li>
      </ul>
    </div>
    <aside class="learn-confidence-panel" aria-label="Transparência na entrega">
      <span class="learn-confidence-panel-tag">TRANSPARÊNCIA EM CADA ETAPA</span><span class="learn-confidence-seal" aria-hidden="true">T.</span>

      <h3>O que merece sua atenção.</h3>
      <div class="learn-timeline">
        <div><span class="learn-timeline-mark">1</span><span><strong>Antes de confirmar</strong><small>Veja o valor total e as condições disponíveis para seu endereço.</small></span></div>
        <div><span class="learn-timeline-mark">2</span><span><strong>Depois de solicitar</strong><small>A revenda ainda precisa aceitar para que o pedido seja confirmado.</small></span></div>
        <div><span class="learn-timeline-mark">3</span><span><strong>No momento da entrega</strong><small>Confira os itens e só então informe o código de recebimento.</small></span></div>
      </div>
      
      <p class="learn-panel-footnote">Disponibilidade, horários e atualizações dependem das revendas que atendem sua região.</p>
    </aside>
  </section>

  <section class="learn-benefits" id="learn-benefits" tabindex="-1" aria-labelledby="learn-benefits-title">
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
    <div class="learn-faq-heading">
      <span class="learn-label">04 — CENTRAL DE RESPOSTAS</span>
      <h2 id="learn-faq-title">Sua dúvida merece <em>uma resposta clara.</em></h2>
      <p>Encontre a informação que precisa sem procurar em textos longos. Filtre por assunto ou pesquise diretamente.</p>
      <div class="learn-faq-support"><span class="learn-faq-support-icon" aria-hidden="true">?</span><div><strong>Não encontrou o que precisava?</strong><small>Nosso canal de atendimento está disponível para receber sua solicitação.</small><button class="learn-contact-link" type="button" onclick="go('contact')">Falar com o TAMÃO <span aria-hidden="true">→</span></button></div></div>
    </div>
    <div class="learn-faq-workspace">
      <div class="learn-faq-tools">
        <label for="learn-faq-search">O QUE VOCÊ DESEJA SABER?</label>
        <div class="learn-faq-search-frame">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10.6" cy="10.6" r="6.2"/><path d="m15.4 15.4 5.1 5.1"/></svg>
          <input id="learn-faq-search" type="search" autocomplete="off" maxlength="80" placeholder="Ex.: preço, entrega, cashback..." oninput="learnPremiumSearchFaq(this.value)" aria-controls="learn-faq-results"/>
        </div>
        <div class="learn-faq-topics" role="group" aria-label="Filtrar dúvidas por assunto">
          <button type="button" class="is-active" aria-pressed="true" data-learn-faq-topic="todos" onclick="learnPremiumSetFaqTopic('todos')">Todas</button>
          <button type="button" aria-pressed="false" data-learn-faq-topic="compra" onclick="learnPremiumSetFaqTopic('compra')">Compra</button>
          <button type="button" aria-pressed="false" data-learn-faq-topic="entrega" onclick="learnPremiumSetFaqTopic('entrega')">Entrega</button>
          <button type="button" aria-pressed="false" data-learn-faq-topic="beneficios" onclick="learnPremiumSetFaqTopic('beneficios')">Benefícios</button>
          <button type="button" aria-pressed="false" data-learn-faq-topic="cadastro" onclick="learnPremiumSetFaqTopic('cadastro')">Cadastro</button>
        </div>
        <p class="learn-faq-count" role="status" aria-live="polite" aria-atomic="true" data-learn-faq-count>8 perguntas para explorar</p>
      </div>
      <div class="learn-faq-items" id="learn-faq-results">
      <details open data-learn-faq-category="cadastro"><summary>Posso consultar produtos sem criar uma conta?</summary><p>Sim. Você pode explorar os produtos disponíveis. Para concluir uma compra, é necessário se identificar com nome, telefone e e-mail confirmado; o endereço de entrega é solicitado na compra.</p></details>
      <details data-learn-faq-category="compra"><summary>Preciso comprar gás para pedir água ou outros itens?</summary><p>Não. Quando houver oferta para o produto na sua região, você pode montar uma cesta sem gás.</p></details>
      <details data-learn-faq-category="compra"><summary>O preço pode mudar depois que eu escolho?</summary><p>O valor escolhido não muda sem sua autorização. Caso seja apresentada uma alternativa mais cara, você decide se deseja aceitá-la.</p></details>
      <details data-learn-faq-category="entrega"><summary>Como sei que a revenda assumiu o pedido?</summary><p>O pedido só é confirmado quando uma revenda aceita. A indicação de saída para entrega aparece quando a revenda informa essa etapa.</p></details>
      <details data-learn-faq-category="entrega"><summary>E se ninguém aceitar meu pedido?</summary><p>Sem aceite, o pedido não é confirmado. O TAMÃO pode procurar outra opção e informa quando não houver atendimento disponível.</p></details>
      <details data-learn-faq-category="entrega"><summary>Como a entrega é concluída?</summary><p>A conclusão requer confirmação do pagamento e o código de recebimento do pedido. Informe o código somente após receber o que comprou.</p></details>
      <details data-learn-faq-category="beneficios"><summary>Como funcionam cashback e indicações?</summary><p>Compras elegíveis podem gerar créditos para uso no TAMÃO. Indicações podem gerar comissões em campanhas habilitadas, após os critérios de compra, entrega, pagamento e validação. Consulte as regras do Clube e da Rede.</p></details>
      <details data-learn-faq-category="cadastro"><summary>Tenho uma revenda. Posso participar?</summary><p>Sim. Revendas podem solicitar participação, cadastrar produtos que comercializam e, quando aplicável, comprovar as autorizações necessárias para vender gás.</p></details>
      </div>
      <div class="learn-faq-empty" data-learn-faq-empty hidden>
        <span aria-hidden="true">⌕</span>
        <strong>Nenhuma resposta para esta busca.</strong>
        <p>Tente uma palavra diferente ou selecione outra categoria.</p>
        <button type="button" onclick="learnPremiumClearFaq()">Mostrar todas as dúvidas <span aria-hidden="true">→</span></button>
      </div>
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
  const stageActionLabel=root.querySelector('[data-learn-stage-cta-label]');
  if(stageActionLabel)stageActionLabel.textContent=step===4?'Acompanhar meu pedido':'Explorar produtos';
  root.querySelectorAll('[data-learn-scene]').forEach(scene=>{
    scene.hidden=scene.getAttribute('data-learn-scene')!==String(step);
  });
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

/** Whitelisted local section jumps, no route switching or arbitrary selectors. */
function learnPremiumJump(sectionId){
  if(!['learn-confidence','learn-benefits','learn-guided-tour'].includes(sectionId)||typeof document==='undefined')return false;
  const section=document.getElementById(sectionId);
  if(!section)return false;
  section.scrollIntoView({block:'start',behavior:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?'auto':'smooth'});
  section.focus({preventScroll:true});
  return true;
}


/** Find help locally; never sends typed text or saves browsing context. */
const learnPremiumFaqState={topic:'todos',query:''};
function learnPremiumNormalizeText(text){
  return String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLocaleLowerCase('pt-BR').trim();
}
function learnPremiumApplyFaq(){
  if(typeof document==='undefined')return false;
  const root=document.querySelector('.learn-premium .learn-faq');
  if(!root)return false;
  const cards=[...root.querySelectorAll('.learn-faq-items details[data-learn-faq-category]')];
  const query=learnPremiumNormalizeText(learnPremiumFaqState.query);
  const selected=learnPremiumFaqState.topic;
  let count=0;
  cards.forEach(card=>{
    const topic=card.getAttribute('data-learn-faq-category');
    const words=learnPremiumNormalizeText(card.textContent);
    const show=(selected==='todos'||selected===topic)&&(!query||words.includes(query));
    card.hidden=!show;
    if(show){count++;if(query)card.open=true;}
  });
  root.querySelectorAll('[data-learn-faq-topic]').forEach(button=>{
    const active=button.getAttribute('data-learn-faq-topic')===selected;
    button.setAttribute('aria-pressed',String(active));
    button.classList.toggle('is-active',active);
  });
  const label=root.querySelector('[data-learn-faq-count]');
  if(label)label.textContent=count===1?'1 pergunta encontrada':count+' perguntas encontradas';
  const empty=root.querySelector('[data-learn-faq-empty]');
  if(empty)empty.hidden=count!==0;
  return count;
}
function learnPremiumSetFaqTopic(topic){
  if(!['todos','compra','entrega','beneficios','cadastro'].includes(topic))return false;
  learnPremiumFaqState.topic=topic;
  return learnPremiumApplyFaq();
}
function learnPremiumSearchFaq(value){
  learnPremiumFaqState.query=String(value||'').slice(0,80);
  return learnPremiumApplyFaq();
}
function learnPremiumClearFaq(){
  learnPremiumFaqState.topic='todos';
  learnPremiumFaqState.query='';
  if(typeof document==='undefined')return false;
  const input=document.querySelector('.learn-premium #learn-faq-search');
  if(input)input.value='';
  return learnPremiumApplyFaq();
}

/** Contextual handoff only to existing customer routes, with no fake checkout. */
function learnPremiumStageAction(){
  if(typeof document==='undefined')return false;
  const step=Number(document.querySelector('.learn-premium .learn-visual')?.dataset?.step||1);
  if(step===4){if(typeof go==='function')go('tracking');return 'tracking';}
  if(typeof startHomeBrowse==='function')startHomeBrowse();
  return 'products';
}

/** Native arrow-key navigation for the four public, informative journey stages. */
function learnPremiumStageKeydown(event){
  if(!event||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return false;
  const group=event.currentTarget;
  if(!group||typeof document==='undefined')return false;
  const buttons=Array.from(group.querySelectorAll('.learn-phase'));
  const current=buttons.indexOf(document.activeElement);
  if(current<0||buttons.length!==4)return false;
  let next=current;
  if(event.key==='Home')next=0;
  else if(event.key==='End')next=buttons.length-1;
  else if(event.key==='ArrowRight')next=(current+1)%buttons.length;
  else next=(current+buttons.length-1)%buttons.length;
  event.preventDefault();
  const activated=learnPremiumSelectStep(next+1);
  if(activated)buttons[next].focus();
  return activated;
}
