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
        <p class="earn-hero-lead">Um convite pessoal, uma Rede que reconhece suas conexões e um histórico que mostra de onde vem cada benefício. <strong>Compartilhe com tranquilidade. Acompanhe com clareza.</strong></p>
        <div class="earn-hero-actions">
          <button type="button" class="earn-action earn-action-primary" onclick="go('refer')">Acessar minha Rede <span aria-hidden="true">↗</span></button>
          <button type="button" class="earn-action earn-action-secondary" onclick="document.getElementById('earn-process')?.scrollIntoView({behavior:'smooth',block:'start'})">Entender como funciona <span aria-hidden="true">↓</span></button>
        </div>
        <div class="earn-hero-trust"><span><i aria-hidden="true"></i> Seu link e QR Code</span><span><i aria-hidden="true"></i> Resultados verificáveis</span><span><i aria-hidden="true"></i> Extrato por origem</span></div>
      </div>
      <aside class="earn-stage earn-v1146-preview" aria-label="Conheça seu espaço de divulgação e entenda o cálculo de uma comissão">
        <div class="earn-stage-head"><span>UM CONVITE COM A SUA IDENTIDADE</span><span class="earn-stage-mark" aria-hidden="true">T<span>•</span></span></div>
        <div class="earn-profile">
          <div class="earn-profile-eyebrow"><span class="earn-profile-online" aria-hidden="true"></span> SEU ESPAÇO NA REDE TAMÃO</div>
          <div class="earn-profile-header">
            <div class="earn-profile-avatar" aria-hidden="true"><span>T</span></div>
            <div><strong>Uma página para chamar de sua.</strong><small>Seu convite, seu código e seus benefícios reunidos em um único lugar.</small></div>
          </div>
          <div class="earn-profile-features" aria-label="Funcionalidades da área de participante"><span><b aria-hidden="true">↗</b> Link pessoal</span><span><b aria-hidden="true">▦</b> QR Code</span><span><b aria-hidden="true">≡</b> Extrato</span></div>
          <div class="earn-profile-footer"><span>PERSONALIZAÇÃO E ACOMPANHAMENTO</span><strong aria-hidden="true">↗</strong></div>
        </div>
        <div class="earn-try" aria-label="Calculadora ilustrativa de comissões">
          <div class="earn-try-heading"><div><span>FAÇA AS CONTAS</span><strong>Quanto representam primeiras compras elegíveis?</strong></div><span class="earn-try-star" aria-hidden="true">✳</span></div>
          <div class="earn-try-switch" role="group" aria-label="Quantidade hipotética de primeiras compras válidas">
            <button type="button" data-earn-scenario="1" aria-pressed="true" onclick="earnPremiumScenarioChoose(1)">1 compra</button>
            <button type="button" data-earn-scenario="5" aria-pressed="false" onclick="earnPremiumScenarioChoose(5)">5 compras</button>
            <button type="button" data-earn-scenario="10" aria-pressed="false" onclick="earnPremiumScenarioChoose(10)">10 compras</button>
          </div>
          <div class="earn-try-result"><div><span>Exemplo matemático</span><small data-earn-scenario-description>1 primeira compra válida × R$ 120 × ${rate}</small></div><strong data-earn-scenario-total aria-live="polite">${example}</strong></div>
          <p>Valores hipotéticos. Só há comissão quando a indicação e a compra cumprem os critérios e são validadas. Não representa saldo ou renda garantida.</p>
        </div>
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
      <div class="earn-fund-note"><span aria-hidden="true" class="earn-fund-icon">+</span><div><strong>Conquistas em vários serviços, sem misturar benefícios.</strong><p>A Rede acompanha convites e eventos elegíveis em diferentes módulos. As campanhas financeiras e eventuais distribuições dos pacotes têm condições próprias e dependem de habilitação e validação.</p></div><button type="button" onclick="go('refer')">Ver modalidades <span aria-hidden="true">→</span></button></div>
      <section class="earn-verticals" aria-labelledby="earn-verticals-title">
        <div class="earn-verticals-heading"><div><span class="earn-eyebrow">CONECTE O QUE FAZ SENTIDO</span><h3 id="earn-verticals-title">Uma Rede que acompanha suas conexões além das compras.</h3></div><p>Sete frentes com registros próprios de participação. Nem toda conquista é comissão em dinheiro.</p></div>
        <div class="earn-verticals-list" aria-label="Modalidades com registro de conquistas"><span><i>01</i> Produtos</span><span><i>02</i> Revendas</span><span><i>03</i> Moto e carro</span><span><i>04</i> Profissionais</span><span><i>05</i> Caronas</span><span><i>06</i> Clube</span><span><i>07</i> Publicidade</span></div>
      </section>
    </section>

    <section class="earn-section earn-clarity" aria-labelledby="earn-clarity-title">
      <div class="earn-clarity-intro"><span class="earn-eyebrow">03 / CONDIÇÕES COM CLAREZA</span><h2 id="earn-clarity-title">Tudo às claras.<br><em>Inclusive as regras.</em></h2><p>Uma Rede de confiança precisa explicar os critérios antes, não depois. Veja as respostas principais ou consulte os detalhes diretamente na sua área.</p><button type="button" class="earn-outline" onclick="go('refer')">Acessar meu extrato <span aria-hidden="true">↗</span></button></div>
      <div class="earn-faq">
        <details><summary><span>01</span> Apenas cadastrar alguém gera comissão?<b aria-hidden="true">+</b></summary><p>Não. A comissão de aquisição depende da primeira compra qualificada de um novo cliente indicado, da conclusão do pedido e das validações aplicáveis.</p></details>
        <details><summary><span>02</span> Como a comissão é calculada?<b aria-hidden="true">+</b></summary><p>A taxa de referência atual é ${rate} sobre a primeira compra elegível. O exemplo de R$ 120 geraria ${example}, se todos os critérios fossem cumpridos. Alterações e campanhas seguem as regras vigentes.</p></details>
        <details><summary><span>03</span> Onde vejo o que foi reconhecido?<b aria-hidden="true">+</b></summary><p>Na área Minha Rede você encontra código pessoal, indicados, conquistas, saldo em validação e valores disponíveis. O extrato detalha as origens verificadas.</p></details>
        <details><summary><span>04</span> Posso sacar imediatamente?<b aria-hidden="true">+</b></summary><p>Não. Valores precisam ser validados e liberados; saques disponíveis seguem conferência, limites e o processo manual informado na sua conta. Um crédito em apuração não é saldo sacável.</p></details>
        <details><summary><span>05</span> Preciso pagar para indicar pessoas?<b aria-hidden="true">+</b></summary><p>Não há compra de pacote exigida para compartilhar o seu convite pessoal. Compras de cupons, pacotes comerciais e outros serviços possuem regras próprias e não garantem rendimento.</p></details>
        <details><summary><span>06</span> Posso ter uma página pessoal no TAMÃO?<b aria-hidden="true">+</b></summary><p>Sim. Sua área da Rede permite acessar seu convite identificado, QR Code e opções de personalização da divulgação. Recursos disponíveis dependem da sua conta e da modalidade.</p></details>
      </div>
    </section>

    <footer class="earn-finale">
      <div><span class="earn-kicker earn-finale-kicker"><span class="earn-kicker-dot" aria-hidden="true"></span> SEU PRÓXIMO PASSO</span><h2>Uma conexão de cada vez.<br><em>Com tudo bem explicado.</em></h2><p>Entre na sua área da Rede TAMÃO. Encontre seu link, acompanhe seus resultados e compartilhe com mais confiança.</p></div>
      <div class="earn-finale-actions"><button type="button" onclick="go('refer')">Entrar na minha Rede <span aria-hidden="true">→</span></button><button type="button" onclick="go('contact')">Preciso de ajuda</button></div>
    </footer>
  </section>`);
}

/* Purely explanatory calculator: the existing commission policy remains the sole source of truth. */
function earnPremiumScenarioChoose(quantity){
 const n=[1,5,10].includes(Number(quantity))?Number(quantity):1;
 const host=document.querySelector('.earn-v1146-preview');
 if(!host)return false;
 host.querySelectorAll('[data-earn-scenario]').forEach(button=>{
   button.setAttribute('aria-pressed',String(Number(button.getAttribute('data-earn-scenario'))===n));
 });
 const total=host.querySelector('[data-earn-scenario-total]');
 const descriptor=host.querySelector('[data-earn-scenario-description]');
 if(total)total.textContent=BRL.format(referralExample(120,n));
 if(descriptor)descriptor.textContent=n+' '+(n===1?'primeira compra válida':'primeiras compras válidas')+' × R$ 120 × '+policyPercent(referralPilotRate());
 return true;
}
