/* TAMÃO Rede — premium public landing. Presentation only; all financial policy remains in the existing runtime. */
function earnPremiumPage({rateLabel,exampleAmount}={}){
  const rate=String(rateLabel||'conforme a política vigente');
  const example=String(exampleAmount||'valor calculado na conta');
  return shell(`<section class="page tamao-earn-page earn-signature" aria-labelledby="earn-signature-title">
    <header class="earn-hero">
      <div class="earn-hero-grid" aria-hidden="true"></div>
      <div class="earn-hero-copy">
        <div class="earn-kicker"><span class="earn-kicker-dot" aria-hidden="true"></span> REDE TAMÃO <span class="earn-kicker-divider">/</span> INDICAÇÕES & BENEFÍCIOS</div>
        <h1 id="earn-signature-title">Indique pessoas.<br><em>Acompanhe cada conquista.</em></h1>
        <p class="earn-hero-lead">O valor de uma boa indicação começa pela confiança. Compartilhe seu link pessoal, acompanhe os resultados da sua Rede e saiba exatamente de onde vêm seus benefícios.</p>
        <div class="earn-hero-actions">
          <button type="button" class="earn-action earn-action-primary" onclick="go('refer')">Acessar minha Rede <span aria-hidden="true">↗</span></button>
          <button type="button" class="earn-action earn-action-secondary" onclick="document.getElementById('earn-process')?.scrollIntoView({behavior:'smooth',block:'start'})">Entender como funciona <span aria-hidden="true">↓</span></button>
        </div>
        <div class="earn-hero-trust"><span><i aria-hidden="true"></i> Link com seu código</span><span><i aria-hidden="true"></i> Eventos verificados</span><span><i aria-hidden="true"></i> Extrato com origem</span></div>
      </div>
      <aside class="earn-stage" aria-label="Etapas de uma indicação e cálculo explicativo">
        <div class="earn-stage-head"><span>SEU CONVITE, COM TRANSPARÊNCIA</span><span class="earn-stage-mark" aria-hidden="true">T<span>•</span></span></div>
        <div class="earn-stage-label">O caminho de uma indicação</div>
        <ol class="earn-stage-progress">
          <li><span class="earn-stage-index">01</span><span><strong>Compartilhamento identificado</strong><small>Seu código acompanha o convite.</small></span><b aria-hidden="true">↗</b></li>
          <li><span class="earn-stage-index">02</span><span><strong>Primeira compra elegível</strong><small>Acontecimento real, não só cadastro.</small></span><b aria-hidden="true">↗</b></li>
          <li><span class="earn-stage-index">03</span><span><strong>Validação e extrato</strong><small>Origem e liberação conforme as regras.</small></span><b aria-hidden="true">✓</b></li>
        </ol>
        <div class="earn-stage-example"><span>COMISSÃO DE AQUISIÇÃO • EXEMPLO ILUSTRATIVO</span><div class="earn-stage-math"><strong>R$ 120,00 <small>× ${rate}</small></strong><b>${example}</b></div><p>Uma primeira compra qualificada de R$ 120. Não é saldo real nem promessa de rendimento.</p></div>
      </aside>
    </header>

    <div class="earn-assurance" aria-label="O que você encontra na Rede TAMÃO">
      <div><span class="earn-assurance-number">01</span><strong>Código individual</strong><small>Seu convite tem identificação própria.</small></div>
      <div><span class="earn-assurance-number">02</span><strong>Critérios definidos</strong><small>Cadastro isolado não gera comissão.</small></div>
      <div><span class="earn-assurance-number">03</span><strong>Valores separados</strong><small>Em validação e disponível não se confundem.</small></div>
      <div><span class="earn-assurance-number">04</span><strong>Histórico verificável</strong><small>Consulte origem e situação na sua conta.</small></div>
    </div>

    <section class="earn-section earn-process" id="earn-process" aria-labelledby="earn-process-title">
      <div class="earn-section-heading"><div><span class="earn-eyebrow">01 / A EXPERIÊNCIA</span><h2 id="earn-process-title">Confiança não se promete.<br><em>Ela aparece em cada etapa.</em></h2></div><p>Você sabe o que compartilhar, o que precisa acontecer e onde acompanhar o resultado. Tudo sem complicar sua rotina.</p></div>
      <div class="earn-step-grid">
        <article><span class="earn-step-num">01 <span aria-hidden="true">↗</span></span><div class="earn-step-glyph earn-glyph-link" aria-hidden="true"><span></span><span></span></div><h3>Seu link. Sua indicação.</h3><p>Entre na conta, encontre seu link ou QR Code e compartilhe com pessoas interessadas no TAMÃO.</p></article>
        <article><span class="earn-step-num">02 <span aria-hidden="true">↗</span></span><div class="earn-step-glyph earn-glyph-check" aria-hidden="true">✓</div><h3>Uma ação que vale.</h3><p>O novo cliente precisa realizar a primeira compra elegível, com pedido concluído, pagamento e entrega confirmados.</p></article>
        <article><span class="earn-step-num">03 <span aria-hidden="true">✓</span></span><div class="earn-step-glyph earn-glyph-ledger" aria-hidden="true"><span></span><span></span><span></span></div><h3>Resultado documentado.</h3><p>Consulte seus indicados, valores em validação e saldo disponível. O extrato informa a origem dos benefícios.</p></article>
      </div>
      <div class="earn-process-action"><span>Já tem conta?</span><button type="button" onclick="go('refer')">Ver meus convites e benefícios <span aria-hidden="true">→</span></button></div>
    </section>

    <section class="earn-section earn-value" aria-labelledby="earn-value-title">
      <div class="earn-value-top"><div><span class="earn-eyebrow">02 / O QUE VOCÊ GANHA COM A REDE</span><h2 id="earn-value-title">Mais maneiras de participar.<br><em>Uma única Rede.</em></h2></div><p>Convites, compras e parcerias se conectam. Cada modalidade tem sua própria forma de registro e suas condições.</p></div>
      <div class="earn-value-grid">
        <article class="earn-value-feature">
          <span class="earn-value-tag">PARA QUEM INDICA</span>
          <span class="earn-value-art" aria-hidden="true"><span class="earn-art-ring"></span><span class="earn-art-core">T<span>•</span></span><span class="earn-art-orbit earn-art-orbit-one"></span><span class="earn-art-orbit earn-art-orbit-two"></span></span>
          <div class="earn-value-content"><h3>Seu convite pode abrir portas.</h3><p>A política atual de aquisição prevê <strong>${rate} sobre a primeira compra qualificada</strong> de um novo cliente elegível. A comissão depende da validação e não se repete nas compras seguintes.</p><button type="button" onclick="go('refer')">Conhecer minhas indicações <span aria-hidden="true">↗</span></button></div>
        </article>
        <article class="earn-value-simple"><span class="earn-value-mini">01 / CLUBE</span><h3>Benefícios também nas suas compras.</h3><p>Confira cupons, cashback elegível e vantagens disponíveis na sua região. Esses benefícios não são a mesma coisa que comissões de indicação.</p><button type="button" onclick="go('club')">Explorar o Clube <span aria-hidden="true">↗</span></button><span class="earn-corner-symbol" aria-hidden="true">✳</span></article>
        <article class="earn-value-simple"><span class="earn-value-mini">02 / NEGÓCIOS</span><h3>Sua empresa em uma Rede local.</h3><p>Revendas e outros participantes podem divulgar suas páginas, organizar oportunidades e conhecer as condições comerciais de cada serviço.</p><button type="button" onclick="go('merchants')">Conhecer a parceria <span aria-hidden="true">↗</span></button><span class="earn-corner-symbol" aria-hidden="true">↗</span></article>
      </div>
      <div class="earn-fund-note"><span aria-hidden="true" class="earn-fund-icon">+</span><div><strong>Participação em outras modalidades</strong><p>A Rede também registra conquistas em serviços e pode contemplar distribuições de pacotes comerciais elegíveis, somente quando houver habilitação, participação verificada e valores confirmados. Consulte as regras e o extrato na sua conta.</p></div><button type="button" onclick="go('refer')">Ver modalidades <span aria-hidden="true">→</span></button></div>
    </section>

    <section class="earn-section earn-clarity" aria-labelledby="earn-clarity-title">
      <div class="earn-clarity-intro"><span class="earn-eyebrow">03 / CONDIÇÕES COM CLAREZA</span><h2 id="earn-clarity-title">Tudo às claras.<br><em>Inclusive as regras.</em></h2><p>Uma Rede de confiança precisa explicar os critérios antes, não depois. Veja as respostas principais ou consulte os detalhes diretamente na sua área.</p><button type="button" class="earn-outline" onclick="go('refer')">Acessar meu extrato <span aria-hidden="true">↗</span></button></div>
      <div class="earn-faq">
        <details><summary><span>01</span> Apenas cadastrar alguém gera comissão?<b aria-hidden="true">+</b></summary><p>Não. A comissão de aquisição depende da primeira compra qualificada de um novo cliente indicado, da conclusão do pedido e das validações aplicáveis.</p></details>
        <details><summary><span>02</span> Como a comissão é calculada?<b aria-hidden="true">+</b></summary><p>A taxa de referência atual é ${rate} sobre a primeira compra elegível. O exemplo de R$ 120 geraria ${example}, se todos os critérios fossem cumpridos. Alterações e campanhas seguem as regras vigentes.</p></details>
        <details><summary><span>03</span> Onde vejo o que foi reconhecido?<b aria-hidden="true">+</b></summary><p>Na área Minha Rede você encontra código pessoal, indicados, conquistas, saldo em validação e valores disponíveis. O extrato detalha as origens verificadas.</p></details>
        <details><summary><span>04</span> Posso sacar imediatamente?<b aria-hidden="true">+</b></summary><p>Não. Valores precisam ser validados e liberados; saques disponíveis seguem conferência, limites e o processo manual informado na sua conta. Um crédito em apuração não é saldo sacável.</p></details>
        <details><summary><span>05</span> Preciso pagar para indicar pessoas?<b aria-hidden="true">+</b></summary><p>Não há compra de pacote exigida para compartilhar o seu convite pessoal. Compras de cupons, pacotes comerciais e outros serviços possuem regras próprias e não garantem rendimento.</p></details>
      </div>
    </section>

    <footer class="earn-finale">
      <div><span class="earn-kicker earn-finale-kicker"><span class="earn-kicker-dot" aria-hidden="true"></span> SEU PRÓXIMO PASSO</span><h2>Uma conexão de cada vez.<br><em>Com tudo bem explicado.</em></h2><p>Entre na sua área da Rede TAMÃO. Encontre seu link, acompanhe seus resultados e compartilhe com mais confiança.</p></div>
      <div class="earn-finale-actions"><button type="button" onclick="go('refer')">Entrar na minha Rede <span aria-hidden="true">→</span></button><button type="button" onclick="go('contact')">Preciso de ajuda</button></div>
    </footer>
  </section>`);
}
