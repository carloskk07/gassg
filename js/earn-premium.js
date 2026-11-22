/* TAMÃO Rede — premium public landing. Presentation only; all financial policy remains in the existing runtime. */
function earnPremiumPage({rateLabel,exampleAmount}={}){
  const rate=String(rateLabel||'conforme a política vigente');
  const example=String(exampleAmount||'valor calculado na conta');
  return shell(`<section class="page tamao-earn-page earn-signature" aria-labelledby="earn-signature-title">
    <header class="earn-hero">
      <div class="earn-hero-copy">
        <div class="earn-kicker"><span class="earn-kicker-dot" aria-hidden="true"></span> REDE TAMÃO <span class="earn-kicker-divider">/</span> CONEXÕES QUE FAZEM SENTIDO</div>
        <h1 id="earn-signature-title">Indique com confiança.<br><em>Acompanhe com clareza.</em></h1>
        <p class="earn-hero-lead">Compartilhe o TAMÃO com quem pode aproveitar seus serviços. Seu convite tem identificação própria, e cada benefício elegível pode ser acompanhado na sua Rede.</p>
        <div class="earn-hero-actions">
          <button type="button" class="earn-action earn-action-primary" onclick="go('refer')">Acessar minha Rede <span aria-hidden="true">↗</span></button>
          <button type="button" class="earn-action earn-action-secondary" onclick="document.getElementById('earn-process')?.scrollIntoView({behavior:'smooth',block:'start'})">Entender como funciona <span aria-hidden="true">↓</span></button>
        </div>
        <div class="earn-hero-trust"><span><i aria-hidden="true"></i> Seu link e QR Code</span><span><i aria-hidden="true"></i> Resultados verificáveis</span><span><i aria-hidden="true"></i> Extrato por origem</span></div>
      </div>
      <aside class="earn-stage earn-editorial-scene" aria-label="Seu convite pessoal conectado ao registro de benefícios">
        <div class="earn-scene-top"><span>SEU ESPAÇO NA REDE TAMÃO</span><span class="earn-scene-seal" aria-hidden="true">T<span>•</span></span></div>
        <div class="earn-scene-art" aria-hidden="true">
          <div class="earn-scene-halo earn-scene-halo-one"></div>
          <div class="earn-scene-halo earn-scene-halo-two"></div>
          <div class="earn-scene-halo earn-scene-halo-three"></div>
          <div class="earn-scene-node earn-scene-node-a"><span>01</span></div>
          <div class="earn-scene-node earn-scene-node-b"><span>02</span></div>
          <div class="earn-scene-node earn-scene-node-c"><span>03</span></div>
          <div class="earn-scene-emblem"><span class="earn-scene-emblem-top">TAMÃO</span><span class="earn-scene-emblem-main">REDE</span><small>CONEXÕES COM IDENTIDADE</small></div>
        </div>
        <div class="earn-scene-bottom">
          <h2>Uma indicação sua.<br>Um histórico que você entende.</h2>
          <p>Link pessoal, QR Code, resultados verificados e extrato em um único lugar. Sem números inventados.</p>
          <div class="earn-scene-steps"><span><b>01</b> Convide</span><i aria-hidden="true">→</i><span><b>02</b> Valide</span><i aria-hidden="true">→</i><span><b>03</b> Acompanhe</span></div>
        </div>
      </aside>
    </header>

    <div class="earn-assurance" aria-label="O que você encontra na Rede TAMÃO">
      <div><span class="earn-assurance-number">01</span><strong>Convite identificado</strong><small>Link e QR Code vinculados à sua conta.</small></div>
      <div><span class="earn-assurance-number">02</span><strong>Critérios públicos</strong><small>Cadastro sozinho não gera comissão.</small></div>
      <div><span class="earn-assurance-number">03</span><strong>Valores separados</strong><small>Em validação não significa disponível.</small></div>
      <div><span class="earn-assurance-number">04</span><strong>Extrato por origem</strong><small>Confira o que foi realmente reconhecido.</small></div>
    </div>

    <section class="earn-section earn-process" id="earn-process" aria-labelledby="earn-process-title">
      <div class="earn-section-heading"><div><span class="earn-eyebrow">01 / SIMPLES DE COMEÇAR</span><h2 id="earn-process-title">Você compartilha.<br><em>O TAMÃO registra.</em></h2></div><p>Sem burocracia para indicar. A validação acompanha eventos reais e ajuda a mostrar, com clareza, a origem de cada resultado.</p></div>
      <div class="earn-step-grid">
        <article><span class="earn-step-num">01 <span aria-hidden="true">↗</span></span><div class="earn-step-glyph earn-glyph-link" aria-hidden="true"><span></span><span></span></div><h3>Seu link. Sua indicação.</h3><p>Entre na conta e compartilhe seu convite pessoal ou QR Code. A identificação acompanha o novo participante.</p></article>
        <article><span class="earn-step-num">02 <span aria-hidden="true">↗</span></span><div class="earn-step-glyph earn-glyph-check" aria-hidden="true">✓</div><h3>Uma ação que vale.</h3><p>A comissão de aquisição exige a primeira compra elegível, concluída e validada. Apenas cadastrar não é suficiente.</p></article>
        <article><span class="earn-step-num">03 <span aria-hidden="true">✓</span></span><div class="earn-step-glyph earn-glyph-ledger" aria-hidden="true"><span></span><span></span><span></span></div><h3>Resultado documentado.</h3><p>Veja seus convites, conquistas e saldos por situação. O extrato identifica a origem dos benefícios reconhecidos.</p></article>
      </div>
      <div class="earn-process-action"><span>Seu histórico fica na conta.</span><button type="button" onclick="go('refer')">Ver meus convites e benefícios <span aria-hidden="true">→</span></button></div>
    </section>

    <section class="earn-section earn-value" aria-labelledby="earn-value-title">
      <div class="earn-value-top"><div><span class="earn-eyebrow">02 / PARA CADA TIPO DE PARTICIPANTE</span><h2 id="earn-value-title">Mais maneiras de participar.<br><em>Uma única Rede.</em></h2></div><p>Você pode compartilhar oportunidades, descobrir vantagens para comprar ou apresentar seu negócio. Cada modalidade tem regras e condições próprias.</p></div>
      <div class="earn-value-grid">
        <article class="earn-value-feature">
          <span class="earn-value-tag">01 / QUEM INDICA</span>
          <div class="earn-value-art" aria-hidden="true"><div class="earn-art-ring"></div><div class="earn-art-core">T<span>•</span></div><div class="earn-art-orbit earn-art-orbit-one"></div><div class="earn-art-orbit earn-art-orbit-two"></div></div>
          <div class="earn-value-content"><h3>Convide com a sua identidade.</h3><p>Seu link conecta novas pessoas ao TAMÃO. A primeira compra qualificada pode gerar comissão de <strong>${rate}</strong>, após validação.</p><button type="button" onclick="go('refer')">Acessar minhas indicações <span aria-hidden="true">↗</span></button></div>
        </article>
        <article class="earn-value-simple"><span class="earn-value-mini">02 / QUEM COMPRA</span><div class="earn-value-simple-icon" aria-hidden="true">✳</div><h3>Vantagens para o seu dia a dia.</h3><p>Conheça os cupons, cashback elegível e benefícios que estiverem disponíveis na sua região. Isso não se confunde com comissão.</p><button type="button" onclick="go('club')">Conhecer o Clube <span aria-hidden="true">↗</span></button></article>
        <article class="earn-value-simple"><span class="earn-value-mini">03 / QUEM TEM UM NEGÓCIO</span><div class="earn-value-simple-icon" aria-hidden="true">↗</div><h3>Sua empresa em uma Rede local.</h3><p>Uma página para apresentar seu negócio, divulgar serviços e organizar oportunidades — com condições comerciais explicadas antes de aderir.</p><button type="button" onclick="go('merchants')">Conhecer as parcerias <span aria-hidden="true">↗</span></button></article>
      </div>
      <section class="earn-verticals" aria-labelledby="earn-verticals-title">
        <div class="earn-verticals-heading"><div><span class="earn-eyebrow">UMA REDE, VÁRIOS SERVIÇOS</span><h3 id="earn-verticals-title">Conexões que atravessam todo o TAMÃO.</h3></div><p>Sete frentes com registros de conquistas. Nem toda conquista é comissão em dinheiro.</p></div>
        <div class="earn-verticals-list" aria-label="Modalidades com registro de conquistas"><span><i>01</i> Produtos</span><span><i>02</i> Revendas</span><span><i>03</i> Moto e carro</span><span><i>04</i> Profissionais</span><span><i>05</i> Caronas</span><span><i>06</i> Clube</span><span><i>07</i> Publicidade</span></div>
      </section>
    </section>

    <section class="earn-section earn-economics earn-v1146-preview" aria-labelledby="earn-economics-title">
      <div class="earn-economics-copy">
        <span class="earn-eyebrow">03 / NÚMEROS SEM PROMESSAS</span>
        <h2 id="earn-economics-title">O benefício tem regra.<br><em>E tem origem.</em></h2>
        <p>A comissão de indicação direta considera ${rate} sobre a primeira compra qualificada. É preciso concluir e validar a compra. O exemplo abaixo é apenas um cálculo, não representa ganho real.</p>
        <div class="earn-economics-proof"><span aria-hidden="true">✓</span><strong>O saldo em validação é separado do saldo disponível.</strong></div>
        <button type="button" class="earn-economics-link" onclick="go('refer')">Consultar o meu extrato <span aria-hidden="true">↗</span></button>
      </div>
      <div class="earn-stage earn-try" aria-label="Calculadora ilustrativa de comissões">
        <div class="earn-try-heading"><div><span>EXEMPLO MATEMÁTICO, NÃO SALDO REAL</span><strong>Quanto representam primeiras compras elegíveis?</strong></div><span class="earn-try-star" aria-hidden="true">✳</span></div>
        <div class="earn-try-switch" role="group" aria-label="Quantidade hipotética de primeiras compras válidas">
          <button type="button" data-earn-scenario="1" aria-pressed="true" onclick="earnPremiumScenarioChoose(1)">1 compra</button>
          <button type="button" data-earn-scenario="5" aria-pressed="false" onclick="earnPremiumScenarioChoose(5)">5 compras</button>
          <button type="button" data-earn-scenario="10" aria-pressed="false" onclick="earnPremiumScenarioChoose(10)">10 compras</button>
        </div>
        <div class="earn-try-result"><div><span>Exemplo matemático</span><small data-earn-scenario-description>1 primeira compra válida × R$ 120 × ${rate}</small></div><strong data-earn-scenario-total aria-live="polite">${example}</strong></div>
        <p>Valores hipotéticos. Só há comissão quando a indicação e a compra cumprem os critérios e são validadas. Não representa saldo ou renda garantida.</p>
      </div>
    </section>

    <section class="earn-section earn-clarity" aria-labelledby="earn-clarity-title">
      <div class="earn-clarity-intro"><span class="earn-eyebrow">04 / AS REGRAS IMPORTAM</span><h2 id="earn-clarity-title">Tudo às claras.<br><em>Inclusive as regras.</em></h2><p>Informação acessível, condições transparentes e acompanhamento dentro da sua conta. Tire suas dúvidas antes de compartilhar.</p><button type="button" class="earn-outline" onclick="go('refer')">Acessar meu extrato <span aria-hidden="true">↗</span></button></div>
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
      <div><span class="earn-kicker earn-finale-kicker"><span class="earn-kicker-dot" aria-hidden="true"></span> SEU PRÓXIMO PASSO</span><h2>Seu próximo convite pode<br><em>abrir novas portas.</em></h2><p>Acesse o seu link identificado, conheça os benefícios elegíveis e acompanhe tudo em um lugar só.</p></div>
      <div class="earn-finale-actions"><button type="button" onclick="go('refer')">Entrar na minha Rede <span aria-hidden="true">→</span></button><button type="button" onclick="go('contact')">Preciso de ajuda</button></div>
    </footer>
  </section>`);
}

/* Purely explanatory calculator: the existing commission policy remains the sole source of truth. */
function earnPremiumScenarioChoose(quantity){
 const n=[1,5,10].includes(Number(quantity))?Number(quantity):1;
 const host=document.querySelector('.earn-economics.earn-v1146-preview');
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
