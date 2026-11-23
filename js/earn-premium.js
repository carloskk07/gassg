/* TAMÃO Rede — premium public landing. Presentation only; all financial policy remains in the existing runtime. */
/* Consistent, finished iconography. These are decorative SVGs, not fake links, QR codes or financial balances. */
function earnPremiumIcon(name){
 const icons={
  verified:'<circle cx="12" cy="12" r="10" fill="currentColor" opacity=".18"/><path d="m7 12.1 3.25 3.25L17.2 8.4" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
  link:'<path d="M9.2 14.8 7.6 16.4a3.3 3.3 0 0 1-4.7-4.7l3.3-3.3a3.3 3.3 0 0 1 4.7 0" fill="none" stroke="currentColor" stroke-width="2.65" stroke-linecap="round"/><path d="m14.8 9.2 1.6-1.6a3.3 3.3 0 0 1 4.7 4.7l-3.3 3.3a3.3 3.3 0 0 1-4.7 0M8.4 15.6l7.2-7.2" fill="none" stroke="currentColor" stroke-width="2.65" stroke-linecap="round"/>',
  club:'<rect x="3.5" y="7.5" width="17" height="13.5" rx="3" fill="currentColor" opacity=".21"/><path d="M6 8V6a6 6 0 0 1 12 0v2h-3V6a3 3 0 0 0-6 0v2Z" fill="currentColor"/><path d="M8.5 12.2h7v2.5h-7z" fill="currentColor"/>',
  store:'<path d="M4.3 11.5h15.4V20H4.3z" fill="currentColor" opacity=".21"/><path d="M5.3 3.5h13.4l2.6 6.2c.2 2-1.2 3.5-3.1 3.5-1.25 0-2.1-.5-2.8-1.5-.65 1-1.6 1.5-3.4 1.5s-2.75-.5-3.4-1.5c-.7 1-1.55 1.5-2.8 1.5-1.9 0-3.3-1.5-3.1-3.5z" fill="currentColor"/><path d="M10 15h4v5h-4z" fill="currentColor"/>',
  page:'<path d="M5.5 2.5h9l4 4v14.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-16a2 2 0 0 1 2-2Z" fill="currentColor" opacity=".23"/><path d="M14.5 2.5v4h4M7.5 11h7.5v2.5H7.5zm0 5h7.5v2.5H7.5z" fill="currentColor"/>',
  statement:'<path d="M6 2.5h12v19l-3-1.8-3 1.8-3-1.8-3 1.8z" fill="currentColor" opacity=".24"/><path d="M9 7.2h6v2.5H9zm0 4.6h6v2.5H9zm0 4.6h4v2.5H9z" fill="currentColor"/>'
 };
 return '<svg class="earn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">'+(icons[name]||'')+'</svg>';
}
function earnPremiumPage({rateLabel,exampleAmount}={}){
  const rate=String(rateLabel||'conforme a política vigente');
  const example=String(exampleAmount||'valor calculado na conta');
  return shell(`<section class="page tamao-earn-page earn-signature" aria-labelledby="earn-signature-title">
    <header class="earn-hero">
      <div class="earn-hero-copy">
        <div class="earn-kicker"><span class="earn-kicker-dot" aria-hidden="true"></span> REDE TAMÃO <span class="earn-kicker-divider">/</span> INDICAÇÕES & BENEFÍCIOS</div>
        <h1 id="earn-signature-title">Indique pessoas.<br><em>Simule seus benefícios.</em></h1>
        <p class="earn-hero-lead">Compartilhe seu link pessoal, simule comissões com a taxa vigente e conheça os benefícios de fazer parte da Rede. Tudo com origem e critérios transparentes.</p>
        <div class="earn-hero-earning"><span class="earn-hero-earning-mark" aria-hidden="true">${earnPremiumIcon('verified')}</span><div><span>COMISSÃO DE INDICAÇÃO DIRETA</span><strong>${rate}</strong><small>sobre cada compra elegível, concluída e validada</small></div></div>
        <div class="earn-hero-actions">
          <button type="button" class="earn-action earn-action-primary" onclick="go('refer')">Acessar minha Rede <span aria-hidden="true">↗</span></button>
          <button type="button" class="earn-action earn-action-secondary" onclick="document.getElementById('earn-benefits')?.scrollIntoView({behavior:'smooth',block:'start'})">Ver todos os benefícios <span aria-hidden="true">↓</span></button>
        </div>
        <div class="earn-hero-trust"><span><i aria-hidden="true"></i> Fundo coletivo de pacotes e publicidade</span><span><i aria-hidden="true"></i> Clube, cashback e cupons</span><span><i aria-hidden="true"></i> Extrato por origem</span></div>
      </div>
      <aside class="earn-stage earn-benefit-simulator earn-v1146-preview" aria-label="Simulador de comissão recorrente por compras qualificadas">
        <div class="earn-simulator-top"><span class="earn-simulator-label"><span class="earn-simulator-live-dot" aria-hidden="true"></span> SIMULADOR DE COMISSÕES</span><span class="earn-simulator-rate">Taxa atual: ${rate}</span></div>
        <h2>Quanto suas indicações <em>podem representar?</em></h2>
        <p class="earn-simulator-intro">Escolha quantas compras elegíveis deseja simular — inclusive recompras de um mesmo cliente indicado. O valor por compra começa em R$ 120,00 e pode ser personalizado.</p>
        <div class="earn-try-switch" role="group" aria-label="Quantidade hipotética de compras válidas, novas ou recorrentes">
          <button type="button" data-earn-scenario="1" aria-pressed="false" onclick="earnPremiumScenarioChoose(1)">1 compra</button>
          <button type="button" data-earn-scenario="5" aria-pressed="true" onclick="earnPremiumScenarioChoose(5)">5 compras</button>
          <button type="button" data-earn-scenario="10" aria-pressed="false" onclick="earnPremiumScenarioChoose(10)">10 compras</button>
        </div>
        <div class="earn-simulator-total"><span>COMISSÃO ESTIMADA • EXEMPLO</span><strong data-earn-scenario-total aria-live="polite">${example}</strong><small data-earn-scenario-description>5 compras válidas × R$ 120,00 × ${rate}</small></div>
        <div class="earn-simulator-breakdown" aria-label="Detalhes do cálculo ilustrativo">
          <div><span>COMPRAS VÁLIDAS</span><strong data-earn-count>5</strong></div>
          <div><span>TOTAL DAS COMPRAS</span><strong data-earn-gross>R$ 600,00</strong></div>
          <div><span>POR COMPRA</span><strong data-earn-per-order>R$ 2,40</strong></div>
        </div>
        <details class="earn-simulator-settings">
          <summary><span>Personalizar valor de cada compra</span><span class="earn-simulator-settings-toggle" aria-hidden="true">+</span></summary>
          <div class="earn-simulator-settings-body">
            <label for="earn-ticket-value">Valor de cada compra elegível (R$)</label>
            <input id="earn-ticket-value" data-earn-ticket type="number" min="1" max="10000" step="0.01" inputmode="decimal" value="120" oninput="earnPremiumUpdateEstimate()" aria-describedby="earn-ticket-note">
            <div class="earn-simulator-presets" role="group" aria-label="Valores de compra de exemplo">
              <button type="button" data-earn-ticket-preset="80" aria-pressed="false" onclick="earnPremiumTicketPreset(80)">R$ 80</button>
              <button type="button" data-earn-ticket-preset="120" aria-pressed="true" onclick="earnPremiumTicketPreset(120)">R$ 120</button>
              <button type="button" data-earn-ticket-preset="200" aria-pressed="false" onclick="earnPremiumTicketPreset(200)">R$ 200</button>
            </div>
            <small id="earn-ticket-note">Exemplo matemático limitado a R$ 10.000 por compra. O valor real depende de cada pedido válido.</small>
          </div>
        </details>
        <div class="earn-simulator-foot"><span aria-hidden="true">✓</span><p>Simulação, não saldo disponível nem renda prometida. A primeira compra e as recompras podem gerar comissão quando forem elegíveis, concluídas e validadas.</p></div>
        <div class="earn-simulator-bottom"><span>SEU LINK • SUAS INDICAÇÕES • SEU EXTRATO</span><span class="earn-stage-mark" aria-hidden="true">T<span>•</span></span></div>
      </aside>
    </header>

    <section class="earn-benefit-board" id="earn-benefits" aria-labelledby="earn-benefit-board-title">
      <div class="earn-benefit-board-heading"><span class="earn-eyebrow">ALÉM DE COMPARTILHAR</span><h2 id="earn-benefit-board-title">Não é só indicar.<br>É participar de uma Rede de vantagens.</h2><p>Comissão por indicações, participação coletiva em pacotes e publicidade elegíveis e benefícios do Clube — cada modalidade com suas regras.</p></div>
      <div class="earn-assurance" aria-label="Benefícios e oportunidades da Rede TAMÃO">
        <article><span class="earn-assurance-number">01 / INDICAÇÕES</span><strong class="earn-benefit-figure">${rate}</strong><h3>Comissão direta</h3><p>De cada compra qualificada de um cliente indicado, inclusive as próximas, após validação.</p><button type="button" onclick="go('refer')">Minhas indicações <span aria-hidden="true">↗</span></button></article>
        <article><span class="earn-assurance-number">02 / REDE ATIVA</span><strong class="earn-benefit-figure">10% <small>fundo coletivo</small></strong><h3>Fundo de pacotes e anúncios</h3><p>O fundo reserva 10% do valor líquido de pacotes elegíveis e 10% da publicidade efetivamente realizada: visualizações cobradas ou campanhas por período concluídas e conciliadas. O rateio considera a atividade verificada nas últimas 24 horas; cupons ficam fora. As participações não são saque imediato.</p><div class="earn-fund-clarity" aria-label="Simulação ilustrativa do fundo coletivo">
          <span class="earn-fund-kicker">EXEMPLO DO FUNDO COLETIVO</span>
          <div class="earn-fund-presets" role="group" aria-label="Valor hipotético de receita elegível de pacotes ou publicidade">
            <button type="button" data-earn-fund-preset="100" aria-pressed="true" onclick="earnPremiumFundChoose(100)">R$ 100</button>
            <button type="button" data-earn-fund-preset="250" aria-pressed="false" onclick="earnPremiumFundChoose(250)">R$ 250</button>
            <button type="button" data-earn-fund-preset="500" aria-pressed="false" onclick="earnPremiumFundChoose(500)">R$ 500</button>
          </div>
          <div class="earn-fund-result"><span>10% destinados ao fundo</span><strong data-earn-fund-total aria-live="polite">R$ 10,00</strong></div>
          <p data-earn-fund-description>R$ 100,00 de receita elegível: R$ 10,00 irão para o fundo coletivo, não para cada participante.</p>
          <small>Em anúncios por visualização, R$ 0,02 consumidos reservam R$ 0,002 ao fundo. Frações de centavo são acumuladas. A parcela de cada pessoa depende do rateio nas últimas 24 horas.</small>
        </div><button type="button" onclick="go('refer')">Ver participação <span aria-hidden="true">↗</span></button></article>
        <article><span class="earn-assurance-number">03 / COMPRAS</span><strong class="earn-benefit-symbol earn-benefit-symbol-club" aria-hidden="true">${earnPremiumIcon('club')}</strong><h3>Clube TAMÃO</h3><p>Cupons, cashback elegível e outras vantagens disponíveis para suas compras.</p><button type="button" onclick="go('club')">Explorar o Clube <span aria-hidden="true">↗</span></button></article>
        <article><span class="earn-assurance-number">04 / SUA IDENTIDADE</span><strong class="earn-benefit-symbol earn-benefit-symbol-page" aria-hidden="true">${earnPremiumIcon('page')}</strong><h3>Sua página pessoal</h3><p>Link de convite, QR Code, conquistas e extrato com origem, tudo na sua Rede.</p><button type="button" onclick="go('refer')">Acessar minha página <span aria-hidden="true">↗</span></button></article>
      </div>
    </section>

    <section class="earn-section earn-value" aria-labelledby="earn-value-title">
      <div class="earn-value-top"><div><span class="earn-eyebrow">01 / PARA CADA TIPO DE PARTICIPANTE</span><h2 id="earn-value-title">Mais maneiras de participar.<br><em>Uma única Rede.</em></h2></div><p>Você pode compartilhar oportunidades, descobrir vantagens para comprar ou apresentar seu negócio. Cada modalidade tem regras e condições próprias.</p></div>
      <div class="earn-value-grid">
        <article class="earn-value-feature">
          <span class="earn-value-tag">01 / QUEM INDICA</span>
          <div class="earn-value-art" aria-hidden="true">
            <div class="earn-invite-card">
              <div class="earn-invite-card-top"><span class="earn-invite-card-brand">TAMÃO <small>REDE</small></span><span class="earn-invite-card-seal">${earnPremiumIcon('verified')}</span></div>
              <span class="earn-invite-card-kicker">PÁGINA PESSOAL</span>
              <strong>Um convite com a sua identidade.</strong>
              <span class="earn-invite-card-meta">Link personalizado · histórico na conta</span>
              <span class="earn-invite-card-foot">${earnPremiumIcon('link')} Compartilhamento identificado</span>
            </div>
          </div>
          <div class="earn-value-content"><h3>Convide com a sua identidade.</h3><p>Seu link conecta novas pessoas ao TAMÃO. Cada compra qualificada, incluindo recompras, pode gerar comissão de <strong>${rate}</strong>, após validação.</p><button type="button" onclick="go('refer')">Acessar minhas indicações <span aria-hidden="true">↗</span></button></div>
        </article>
        <article class="earn-value-simple"><span class="earn-value-mini">02 / QUEM COMPRA</span><div class="earn-value-simple-icon" aria-hidden="true">${earnPremiumIcon('club')}</div><h3>Vantagens para o seu dia a dia.</h3><p>Conheça os cupons, cashback elegível e benefícios que estiverem disponíveis na sua região. Isso não se confunde com comissão.</p><button type="button" onclick="go('club')">Conhecer o Clube <span aria-hidden="true">↗</span></button></article>
        <article class="earn-value-simple"><span class="earn-value-mini">03 / QUEM TEM UM NEGÓCIO</span><div class="earn-value-simple-icon earn-value-simple-icon-business" aria-hidden="true">${earnPremiumIcon('store')}</div><h3>Sua empresa em uma Rede local.</h3><p>Uma página para apresentar seu negócio, divulgar serviços e organizar oportunidades — com condições comerciais explicadas antes de aderir.</p><button type="button" onclick="go('merchants')">Conhecer as parcerias <span aria-hidden="true">↗</span></button></article>
      </div>
      <section class="earn-verticals" aria-labelledby="earn-verticals-title">
        <div class="earn-verticals-heading"><div><span class="earn-eyebrow">UMA REDE, VÁRIOS SERVIÇOS</span><h3 id="earn-verticals-title">Conexões que atravessam todo o TAMÃO.</h3></div><p>Sete frentes com registros de conquistas. Nem toda conquista é comissão em dinheiro.</p></div>
        <div class="earn-verticals-list" aria-label="Modalidades com registro de conquistas"><span><i>01</i> Produtos</span><span><i>02</i> Revendas</span><span><i>03</i> Moto e carro</span><span><i>04</i> Profissionais</span><span><i>05</i> Caronas</span><span><i>06</i> Clube</span><span><i>07</i> Publicidade</span></div>
      </section>
    </section>

    <section class="earn-section earn-process" id="earn-process" aria-labelledby="earn-process-title">
      <div class="earn-section-heading"><div><span class="earn-eyebrow">02 / SIMPLES DE COMEÇAR</span><h2 id="earn-process-title">Você compartilha.<br><em>O TAMÃO registra.</em></h2></div><p>Sem burocracia para indicar. A validação acompanha eventos reais e ajuda a mostrar, com clareza, a origem de cada resultado.</p></div>
      <div class="earn-step-grid">
        <article><span class="earn-step-num">01 <span aria-hidden="true">↗</span></span><div class="earn-step-glyph earn-glyph-link" aria-hidden="true">${earnPremiumIcon('link')}</div><h3>Seu link. Sua indicação.</h3><p>Entre na conta e compartilhe seu convite pessoal ou QR Code. A identificação acompanha o novo participante.</p></article>
        <article><span class="earn-step-num">02 <span aria-hidden="true">↗</span></span><div class="earn-step-glyph earn-glyph-check" aria-hidden="true">${earnPremiumIcon('verified')}</div><h3>Uma ação que vale.</h3><p>A comissão recorrente depende de cada compra elegível, concluída e validada. Apenas cadastrar alguém não gera comissão.</p></article>
        <article><span class="earn-step-num">03 <span aria-hidden="true">✓</span></span><div class="earn-step-glyph earn-glyph-ledger" aria-hidden="true">${earnPremiumIcon('statement')}</div><h3>Resultado documentado.</h3><p>Veja seus convites, conquistas e saldos por situação. O extrato identifica a origem dos benefícios reconhecidos.</p></article>
      </div>
      <div class="earn-process-action"><span>Seu histórico fica na conta.</span><button type="button" onclick="go('refer')">Ver meus convites e benefícios <span aria-hidden="true">→</span></button></div>
    </section>

    <section class="earn-section earn-clarity" aria-labelledby="earn-clarity-title">
      <div class="earn-clarity-intro"><span class="earn-eyebrow">03 / AS REGRAS IMPORTAM</span><h2 id="earn-clarity-title">Tudo às claras.<br><em>Inclusive as regras.</em></h2><p>Informação acessível, condições transparentes e acompanhamento dentro da sua conta. Tire suas dúvidas antes de compartilhar.</p><button type="button" class="earn-outline" onclick="go('refer')">Acessar meu extrato <span aria-hidden="true">↗</span></button></div>
      <div class="earn-faq">
        <details><summary><span>01</span> Apenas cadastrar alguém gera comissão?<b aria-hidden="true">+</b></summary><p>Não. Cada comissão depende de uma compra qualificada e concluída do cliente indicado, com validações aplicáveis. Novas compras também podem gerar comissão.</p></details>
        <details><summary><span>02</span> Como a comissão é calculada?<b aria-hidden="true">+</b></summary><p>A taxa de referência atual é ${rate} sobre cada compra elegível. O exemplo de cinco compras elegíveis de R$ 120 geraria ${example}, se todos os critérios fossem cumpridos. Alterações e campanhas seguem as regras vigentes.</p></details>
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

/* Transparent calculator. Always uses the commercial policy and the existing referralExample helper. */
function earnPremiumUpdateEstimate(){
 const host=document.querySelector('.earn-hero .earn-v1146-preview');
 if(!host)return false;
 const selected=host.querySelector('[data-earn-scenario][aria-pressed="true"]');
 const n=[1,5,10].includes(Number(selected?.getAttribute('data-earn-scenario')))
   ?Number(selected.getAttribute('data-earn-scenario')):5;
 const field=host.querySelector('[data-earn-ticket]');
 const typed=String(field?.value??'').trim().replace(',','.');
 const raw=Number(typed);
 const valid=typed!==''&&Number.isFinite(raw)&&raw>=1&&raw<=10000;
 const ticket=valid?raw:0;
 if(field)field.setAttribute('aria-invalid',String(!valid));
 const total=host.querySelector('[data-earn-scenario-total]');
 const detail=host.querySelector('[data-earn-scenario-description]');
 if(total)total.textContent=valid?BRL.format(referralExample(ticket,n)):'—';
 if(detail)detail.textContent=valid
  ?n+' '+(n===1?'compra válida':'compras válidas')+
    ' × '+BRL.format(ticket)+' × '+policyPercent(referralPilotRate())
  :'Informe um valor de R$ 1 a R$ 10.000 para simular.';
 const count=host.querySelector('[data-earn-count]');
 const gross=host.querySelector('[data-earn-gross]');
 const perOrder=host.querySelector('[data-earn-per-order]');
 if(count)count.textContent=String(n);
 if(gross)gross.textContent=valid?BRL.format(ticket*n):'—';
 if(perOrder)perOrder.textContent=valid?BRL.format(referralExample(ticket,1)):'—';
 host.querySelectorAll('[data-earn-ticket-preset]').forEach(btn=>{
   btn.setAttribute('aria-pressed',String(Number(btn.getAttribute('data-earn-ticket-preset'))===ticket));
 });
 return true;
}
function earnPremiumScenarioChoose(quantity){
 const n=[1,5,10].includes(Number(quantity))?Number(quantity):5;
 const host=document.querySelector('.earn-hero .earn-v1146-preview');
 if(!host)return false;
 host.querySelectorAll('[data-earn-scenario]').forEach(button=>{
   button.setAttribute('aria-pressed',String(Number(button.getAttribute('data-earn-scenario'))===n));
 });
 return earnPremiumUpdateEstimate();
}
function earnPremiumTicketPreset(amount){
 const ticket=[80,120,200].includes(Number(amount))?Number(amount):120;
 const field=document.querySelector('.earn-hero .earn-v1146-preview [data-earn-ticket]');
 if(!field)return false;
 field.value=String(ticket);
 return earnPremiumUpdateEstimate();
}


/* V1.1152: illustrative pool preview only; does not calculate or promise individual payouts. */
function earnPremiumFundChoose(netAmount){
 const value=[100,250,500].includes(Number(netAmount))?Number(netAmount):100;
 const host=document.querySelector('.earn-fund-clarity');
 if(!host)return false;
 const pool=BRL.format(value/10);
 const total=host.querySelector('[data-earn-fund-total]');
 const description=host.querySelector('[data-earn-fund-description]');
 if(total)total.textContent=pool;
 if(description)description.textContent=BRL.format(value)+' de receita elegível: '+pool+
  ' irão para o fundo coletivo, não para cada participante.';
 host.querySelectorAll('[data-earn-fund-preset]').forEach(button=>{
  button.setAttribute('aria-pressed',String(Number(button.getAttribute('data-earn-fund-preset'))===value));
 });
 return true;
}
