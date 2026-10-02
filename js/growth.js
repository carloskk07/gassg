const REFERRAL_PILOT_RATE=0.02;
const MERCHANT_PILOT_FEE_RATE=0.075;

function club(){
  const purchases=Math.max(0,Number(state.user.purchases)||0);
  const cycle=purchases===0?0:(purchases%5||5);
  const pct=cycle*20;
  const next=purchases>0&&cycle===5?'Ciclo completo — a próxima compra inicia um novo ciclo':`${cycle} de 5 compras no ciclo atual`;
  const debt=Math.max(0,Number(state.user.cashbackDebt)||0);
  return shell(`<section class="page">
    <span class="eyebrow">BENEFÍCIOS PARA QUEM COMPRA</span>
    <h1 class="page-title">Clube Chama</h1>
    <p class="muted page-lead">Acompanhe o que suas compras já devolveram para você e use o saldo disponível para economizar nas próximas.</p>
    <div class="reward-hero"><div class="tiny" style="opacity:.75">SEU CASHBACK DISPONÍVEL</div><div class="balance">${BRL.format(state.user.cashback)}</div><div class="tiny">crédito para usar em novas compras</div><div class="progress"><div style="width:${pct}%"></div></div><strong>${esc(next)}</strong></div>
    ${debt>0?`<div class="notice" style="margin-top:14px"><strong>${BRL.format(debt)} em compensação.</strong><br>Esse valor corresponde a cashback de uma compra posteriormente revertida. Novos créditos reduzem essa compensação antes de ficarem disponíveis.</div>`:''}
    <section class="section"><div class="grid cards-3">
      <div class="card"><div class="feature-icon">💵</div><h3>Cashback</h3><p class="muted tiny">Crédito para reduzir o valor de novas compras no Chama.</p></div>
      <div class="card"><div class="feature-icon">⭐</div><h3>Recorrência</h3><p class="muted tiny">Seu histórico ajuda a organizar benefícios e ciclos de fidelidade.</p></div>
      <div class="card"><div class="feature-icon">🤝</div><h3>Indicação</h3><p class="muted tiny">Além de economizar, você pode participar indicando novos compradores.</p><button class="ghost small" onclick="go('earn')">Ver como ganhar →</button></div>
    </div></section>
    <div class="card flat planned-card"><div><span class="section-kicker">EM EVOLUÇÃO</span><h3>Clube Plus</h3><p class="muted">Vantagens ampliadas estão em estudo para uma etapa futura. Nada é cobrado enquanto o produto não estiver ativo e claramente apresentado.</p></div><span class="status-pill offline">AINDA NÃO DISPONÍVEL</span></div>
  </section>`)
}

function referralUrl(){
  if(!state.user.referralCode)return '';
  const base=`${location.origin}${location.pathname}`;
  return `${base}?ref=${encodeURIComponent(state.user.referralCode)}#home`;
}
function referralExample(orderReais,count=1){
  const amount=Math.max(0,Number(orderReais)||0);
  const qty=Math.max(1,Math.trunc(Number(count)||1));
  return roundMoney(amount*REFERRAL_PILOT_RATE*qty);
}
function merchantEconomicsExample(orderReais,count=1){
  const amount=Math.max(0,Number(orderReais)||0);
  const qty=Math.max(1,Math.trunc(Number(count)||1));
  const gross=roundMoney(amount*qty);
  const fee=roundMoney(gross*MERCHANT_PILOT_FEE_RATE);
  return {gross,fee,merchantNet:roundMoney(gross-fee)};
}
function updateReferralSimulator(){
  const clients=Math.min(500,Math.max(1,Math.trunc(Number(document.querySelector('#ref-sim-clients')?.value)||1)));
  const ticket=Math.min(100000,Math.max(1,Number(document.querySelector('#ref-sim-ticket')?.value)||1));
  const total=referralExample(ticket,clients);
  const out=document.querySelector('#ref-sim-total');
  if(out)out.textContent=BRL.format(total);
  const detail=document.querySelector('#ref-sim-detail');
  if(detail)detail.textContent=clients+' novo'+(clients===1?' cliente':'s clientes')+' × '+BRL.format(ticket)+' × 2%';
}
function updateMerchantSimulator(){
  const orders=Math.min(10000,Math.max(1,Math.trunc(Number(document.querySelector('#merchant-sim-orders')?.value)||1)));
  const ticket=Math.min(100000,Math.max(1,Number(document.querySelector('#merchant-sim-ticket')?.value)||1));
  const e=merchantEconomicsExample(ticket,orders);
  const gross=document.querySelector('#merchant-sim-gross');
  const fee=document.querySelector('#merchant-sim-fee');
  const net=document.querySelector('#merchant-sim-net');
  if(gross)gross.textContent=BRL.format(e.gross);
  if(fee)fee.textContent=BRL.format(e.fee);
  if(net)net.textContent=BRL.format(e.merchantNet);
}
function refer(){
  const url=referralUrl();
  const live=globalThis.liveRequested?.()===true;
  const permanent=state.user.cashEarningEligible===true;
  const hasReferral=Boolean(state.user.referralCode);
  const referralCard=hasReferral
    ? `<div class="card flat referral-share-card"><div class="tiny muted">SEU LINK PESSOAL</div><div class="share-box">${esc(url)}</div><button class="primary full" style="margin-top:12px" onclick="shareReferral()">Compartilhar meu link</button></div>`
    : '<div class="notice"><strong>Seu link ainda não está disponível.</strong><br>Ele aparece quando sua identidade real for carregada pelo serviço do Chama.</div>';
  const identityCard=live&&!permanent
    ? `<div class="notice" style="margin-top:14px"><strong>Quer transformar comissão em saldo disponível?</strong><br>Vincule um e-mail à sua conta. Seu histórico, pedidos e cashback continuam no mesmo usuário.</div><div class="card flat form-stack" style="margin-top:14px"><div class="input-wrap"><label for="cash-email">Seu e-mail</label><input id="cash-email" type="email" autocomplete="email" maxlength="160" class="input" placeholder="voce@email.com"></div><button class="primary" onclick="activateCashAccount()">Vincular meu e-mail</button></div>`
    : live&&permanent
      ? '<div class="notice success" style="margin-top:14px"><strong>Conta habilitada para comissão.</strong><br>Vendas elegíveis ainda passam pela janela de validação antes de se tornarem saldo disponível.</div>'
      : '';

  return shell(`<section class="page">
    <button class="back" onclick="go('earn')">← Ganhar ou vender</button>
    <span class="eyebrow">COMISSÃO POR INDICAÇÃO</span>
    <h1 class="page-title">Indique um novo comprador. A primeira compra elegível pode gerar comissão.</h1>
    <p class="muted page-lead">O Chama usa indicação como aquisição de novos clientes: cadastro sozinho não gera valor e compras repetidas do mesmo indicado não criam uma nova comissão de aquisição.</p>
    <div class="earn-summary">
      <div class="earn-balance-card"><span>Disponível</span><strong>${BRL.format(state.user.commissionAvailable)}</strong><small>saldo já liberado</small></div>
      <div class="earn-balance-card"><span>A liberar</span><strong>${BRL.format(state.user.commissionPending)}</strong><small>em validação</small></div>
    </div>
    ${referralCard}
    ${identityCard}

    <section class="section"><div class="section-head"><div><span class="section-kicker">SIMULADOR DA POLÍTICA ATUAL</span><h2>Veja o que 2% representa em vendas qualificadas.</h2><p>Use quantidades e valores hipotéticos para entender a matemática. O resultado não é previsão nem promessa de renda.</p></div></div>
      <div class="calculator-card">
        <div class="calculator-inputs">
          <div class="input-wrap"><label for="ref-sim-clients">Novos clientes com 1ª compra qualificada</label><input id="ref-sim-clients" class="input" type="number" inputmode="numeric" min="1" max="500" value="10" oninput="updateReferralSimulator()"></div>
          <div class="input-wrap"><label for="ref-sim-ticket">Valor médio da primeira compra (R$)</label><input id="ref-sim-ticket" class="input" type="number" inputmode="decimal" min="1" step="0.01" value="120" oninput="updateReferralSimulator()"></div>
        </div>
        <div class="calculator-result"><small>Comissão ilustrativa pela política atual</small><strong id="ref-sim-total">${BRL.format(referralExample(120,10))}</strong><span id="ref-sim-detail">10 novos clientes × ${BRL.format(120)} × 2%</span></div>
      </div>
      <div class="notice" style="margin-top:12px"><strong>Comissão não é saque imediato.</strong><br>O valor só pode nascer da primeira compra qualificada de cada novo cliente indicado e ainda depende de entrega, pagamento, validação de risco, janela de segurança e das identidades permanentes exigidas pelo programa. Compras repetidas do mesmo cliente não geram novas comissões.</div>
    </section>

    <section class="section"><div class="section-head"><div><h2>Como a comissão passa a existir</h2></div></div><div class="how-grid">
      <div class="how-card"><span>1</span><div><strong>Compartilhe seu link</strong><p>Envie para quem realmente possa se interessar pelo Chama.</p></div></div>
      <div class="how-card"><span>2</span><div><strong>O novo cliente faz a primeira compra qualificada</strong><p>Cadastro sozinho e compras posteriores do mesmo cliente não criam nova comissão.</p></div></div>
      <div class="how-card"><span>3</span><div><strong>A venda é concluída</strong><p>A entrega e o pagamento precisam ser confirmados.</p></div></div>
      <div class="how-card"><span>4</span><div><strong>A comissão é validada</strong><p>Depois da janela de segurança e com indicador e cliente indicado em identidades permanentes, o valor elegível pode ficar disponível.</p></div></div>
    </div></section>

    <div class="card flat payout-card"><div><span class="section-kicker">RECEBIMENTO</span><h3>Saldo disponível e saque são coisas diferentes.</h3><p class="muted">O sistema já separa valor em validação de comissão disponível. A retirada em dinheiro só será apresentada como disponível quando a integração Pix real estiver pronta.</p></div><button class="secondary" disabled>Saque Pix ainda não disponível</button></div>
  </section>`)
}

function earn(){
  const merchantSample=merchantEconomicsExample(120);
  return shell(`<section class="page">
    <span class="eyebrow">BENEFÍCIOS E OPORTUNIDADES</span>
    <h1 class="page-title">Comissão por indicação para pessoas. Mais vendas para empresas.</h1>
    <p class="muted page-lead">São caminhos diferentes: quem compra pode indicar novos clientes elegíveis; quem já tem uma empresa pode usar o Chama como canal adicional de vendas. Nenhum dos dois é promessa de renda fixa.</p>

    <div class="opportunity-grid main-opportunities">
      <article class="opportunity-card person-opportunity"><div class="opportunity-icon">🤝</div><span class="section-kicker">PARA PESSOAS</span><h2>Indique quem realmente pode comprar</h2><p>Compartilhe seu link pessoal. A primeira compra qualificada de cada novo cliente indicado pode gerar comissão depois de entregue, paga e validada.</p>
        <ul class="clean-list"><li>Política atual do piloto: 2% da primeira compra qualificada</li><li>Uma comissão de aquisição por novo cliente elegível</li><li>Saldo “a liberar” separado do saldo disponível</li><li>Nenhum pagamento por simples recrutamento</li></ul>
        <div class="opportunity-example"><small>Exemplo matemático</small><strong>R$ 120 × 2% = ${BRL.format(referralExample(120))}</strong><span>Não é promessa de renda; a venda precisa cumprir todos os gates.</span></div>
        <button class="primary full" onclick="go('refer')">Simular minha indicação</button>
      </article>
      <article class="opportunity-card business-opportunity"><div class="opportunity-icon">🏪</div><span class="section-kicker">PARA EMPRESAS</span><h2>Venda mais sem perder o controle</h2><p>Use a plataforma como um canal adicional para gás, água e outros itens da sua operação, mantendo preço, estoque, disponibilidade e aceite sob sua decisão.</p>
        <ul class="clean-list"><li>Você define preços, estoque e taxa de entrega</li><li>Escolhe quando ficar online</li><li>Decide se aceita cada pedido</li><li>Pode vender vários tipos de produto</li></ul>
        <div class="opportunity-example"><small>Política inicial do piloto</small><strong>Taxa Chama: 7,5% por pedido concluído</strong><span>Ex.: R$ 120 bruto → ${BRL.format(merchantSample.fee)} de taxa → ${BRL.format(merchantSample.merchantNet)} antes dos custos próprios e impostos.</span></div>
        <button class="primary full" onclick="go('merchants')">Ver parceria e simulador</button>
      </article>
    </div>

    <section class="section"><div class="soft-band"><div><span class="section-kicker">TRANSPARÊNCIA</span><h2>Benefício, comissão e receita não são a mesma coisa.</h2><p>Cashback reduz compras futuras. Comissão de indicação depende de uma venda válida. Receita da revenda nasce de pedidos concluídos. O Chama não paga por formar rede de pessoas, não promete renda fixa e só apresentará saque quando a integração financeira estiver realmente disponível.</p></div><button class="secondary" onclick="go('learn')">Entender compra e segurança</button></div></section>
  </section>`)
}

function learn(){
  return shell(`<section class="page">
    <span class="eyebrow">SAIBA MAIS</span>
    <h1 class="page-title">Antes de pedir, veja quanto custa, quanto demora e o que acontece se algo der errado.</h1>
    <p class="muted page-lead">O Chama foi desenhado para tirar as principais dúvidas antes da compra: total, prazo, confirmação do parceiro e acompanhamento até o recebimento.</p>

    <section class="section"><div class="section-head"><div><span class="section-kicker">PASSO A PASSO</span><h2>Comprar é um fluxo de quatro etapas</h2></div></div><div class="how-grid">
      <div class="how-card"><span>1</span><div><strong>Monte sua cesta</strong><p>Escolha gás e/ou produtos essenciais disponíveis.</p></div></div>
      <div class="how-card"><span>2</span><div><strong>Confirme seu endereço</strong><p>Usamos a cesta e o endereço para procurar opções elegíveis.</p></div></div>
      <div class="how-card"><span>3</span><div><strong>Escolha uma opção</strong><p>Compare valor total e previsão de entrega antes de confirmar.</p></div></div>
      <div class="how-card"><span>4</span><div><strong>Acompanhe</strong><p>Aceite, preparação, saída e conclusão aparecem como etapas distintas.</p></div></div>
    </div></section>

    <section class="section"><div class="section-head"><div><span class="section-kicker">O QUE MUDA PARA VOCÊ</span><h2>Menos dúvida durante a compra</h2></div></div><div class="grid cards-3">
      <div class="card feature-card"><div class="feature-icon">💲</div><h3>Valor antes de confirmar</h3><p>Você vê o total da opção antes de criar o pedido.</p></div>
      <div class="card feature-card"><div class="feature-icon">✅</div><h3>Parceiro precisa confirmar</h3><p>Enviar o pedido não significa que você já ficará esperando: a operação precisa aceitar antes de assumir a entrega.</p></div>
      <div class="card feature-card"><div class="feature-icon">📍</div><h3>Acompanhamento por etapas</h3><p>Preparando, a caminho e chegando são estados separados.</p></div>
    </div></section>

    <section class="section"><div class="section-head"><div><span class="section-kicker">DÚVIDAS FREQUENTES</span><h2>Antes de comprar</h2></div></div><div class="faq-list">
      <details open><summary>Preciso comprar gás para pedir água, carvão, lenha ou gelo?</summary><p>Não. Quando houver oferta real para o produto, você pode montar uma cesta sem gás.</p></details>
      <details><summary>O preço pode mudar depois que eu escolho?</summary><p>A opção escolhida é protegida para o pedido. Se for necessária uma alternativa mais cara durante uma reatribuição, o sistema pede seu aceite antes de trocar a condição.</p></details>
      <details><summary>Como sei que alguém realmente assumiu meu pedido?</summary><p>O parceiro precisa aceitar o pedido. Depois, a saída também precisa ser confirmada antes de aparecer “A caminho”.</p></details>
      <details><summary>E se o parceiro aceitar e depois não puder sair para entregar?</summary><p>A Proteção Chama pode procurar outra opção elegível. Se a alternativa aumentar o total, você precisa aprovar o novo valor antes da troca.</p></details>
      <details><summary>E se ninguém aceitar?</summary><p>O pedido não é apresentado como confirmado sem aceite real. O sistema pode tentar outras opções elegíveis dentro das regras do pedido e informa quando não houver atendimento disponível.</p></details>
      <details><summary>Como a entrega é concluída?</summary><p>A conclusão exige confirmação de pagamento e o código de recebimento do pedido. Informe esse código somente quando o pedido estiver com você.</p></details>
      <details><summary>Como funciona o cashback?</summary><p>Compras elegíveis podem gerar crédito para reduzir compras futuras dentro do Chama. O saldo aparece no Clube Chama.</p></details>
      <details><summary>Também posso ganhar indicando pessoas?</summary><p>Sim. No piloto, a primeira compra qualificada de cada novo cliente indicado pode gerar comissão após entrega, pagamento e validação. Compras posteriores do mesmo cliente não geram outra comissão de aquisição.</p></details>
      <details><summary>Tenho uma revenda. Posso vender outros produtos além de gás?</summary><p>Sim. A proposta inclui gás e produtos relacionados, com preço e estoque controlados por SKU. GLP exige a validação regulatória aplicável.</p></details>
    </div></section>

    <div class="dual-cta"><button class="primary" onclick="quickProduct('P13')">🔥 Ver preços e prazos</button><button class="secondary" onclick="go('earn')">🤝 Indicação e parceria</button></div>
  </section>`)
}

async function activateCashAccount(){
  const email=document.querySelector('#cash-email')?.value.trim()||'';
  try{
    const result=await liveUpgradeAccount(email);
    if(result?.alreadyPermanent){
      state.user.cashEarningEligible=true;
      state.user.identityType='permanent';
      save();render();toast('Sua conta já está habilitada');
      return;
    }
    toast('Enviamos a confirmação para seu e-mail');
    const el=document.querySelector('#cash-email');
    if(el)el.value='';
  }catch(e){
    const msg=String(e?.message||e);
    toast(/manual linking|identity linking/i.test(msg)?'Ativação por e-mail ainda precisa ser habilitada no Auth do piloto':msg);
  }
}

async function shareReferral(){
  const url=referralUrl();
  if(!url)return toast('Link real de indicação ainda indisponível');
  const text=`Use o Chama para consultar preço e pedir gás e outros itens em São Gabriel: ${url}`;
  try{
    if(navigator.share){
      await navigator.share({title:'Chama São Gabriel',text,url});
      return;
    }
    if(navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(text);
      toast('Link copiado');
      return;
    }
    toast('Copie o link exibido acima');
  }catch(e){
    if(e?.name!=='AbortError')toast('Não foi possível compartilhar automaticamente');
  }
}

function merchantsLanding(){
  const portal=globalThis.merchantPortalRequested?.()===true;
  const cta=portal?"go('merchant-join')":"openMerchantPortal()";
  const sample=merchantEconomicsExample(120,100);
  return shell(`<section class="page merchant-landing">
    <span class="eyebrow">PARA EMPRESAS LOCAIS</span>
    <h1 class="page-title">Mais um canal de vendas. Sua operação continua sob seu controle.</h1>
    <p class="muted page-lead">Receba oportunidades de pedidos sem abrir outra loja. Você continua no controle de catálogo, preço, estoque, taxa de entrega, disponibilidade e da decisão de aceitar cada pedido.</p>
    <div class="merchant-commercial-strip">
      <div><small>POLÍTICA INICIAL DO PILOTO</small><strong>7,5%</strong><span>taxa da plataforma sobre o valor bruto de cada pedido concluído</span></div>
      <p>Sem mensalidade apresentada no modelo atual. Custos próprios da revenda, tributos, meios de pagamento e entrega não estão incluídos nesta conta.</p>
    </div>
    <div class="hero-actions merchant-hero-actions"><button class="primary" onclick="${cta}">${portal?'Cadastrar minha empresa':'Acessar / cadastrar revenda'}</button><button class="secondary" onclick="document.getElementById('merchant-economics')?.scrollIntoView({behavior:'smooth'})">Simular custos</button></div>

    <div class="grid cards-3 partner-benefits">
      <div class="card"><div class="feature-icon">📈</div><h3>Mais um canal de vendas</h3><p class="muted tiny">O Chama pode apresentar sua operação a clientes que já estão procurando os produtos que você vende.</p></div>
      <div class="card"><div class="feature-icon">🎛️</div><h3>Você continua no controle</h3><p class="muted tiny">Defina preço, estoque, taxa e disponibilidade. Fique offline quando não quiser receber novos pedidos.</p></div>
      <div class="card"><div class="feature-icon">🧺</div><h3>Venda além do P13</h3><p class="muted tiny">Cadastre outros tamanhos de GLP e produtos como água, carvão, lenha e gelo conforme sua operação.</p></div>
    </div>

    <section class="section" id="merchant-economics"><div class="section-head"><div><span class="section-kicker">SIMULADOR COMERCIAL</span><h2>Veja a taxa antes de decidir.</h2><p>Simulação baseada na política inicial de 7,5% do piloto. Não inclui custos, impostos ou margem própria da empresa.</p></div></div>
      <div class="calculator-card merchant-calculator">
        <div class="calculator-inputs">
          <div class="input-wrap"><label for="merchant-sim-orders">Pedidos concluídos</label><input id="merchant-sim-orders" class="input" type="number" inputmode="numeric" min="1" max="10000" value="100" oninput="updateMerchantSimulator()"></div>
          <div class="input-wrap"><label for="merchant-sim-ticket">Valor médio por pedido (R$)</label><input id="merchant-sim-ticket" class="input" type="number" inputmode="decimal" min="1" step="0.01" value="120" oninput="updateMerchantSimulator()"></div>
        </div>
        <div class="economics-results">
          <div><small>Vendas brutas</small><strong id="merchant-sim-gross">${BRL.format(sample.gross)}</strong></div>
          <div><small>Taxa Chama (7,5%)</small><strong id="merchant-sim-fee">${BRL.format(sample.fee)}</strong></div>
          <div class="highlight"><small>Antes dos seus custos e impostos</small><strong id="merchant-sim-net">${BRL.format(sample.merchantNet)}</strong></div>
        </div>
      </div>
      <div class="notice" style="margin-top:12px"><strong>Repasse ainda em validação operacional.</strong><br>O Chama congela a política financeira no pedido, mas o fluxo real de cobrança, conciliação e repasse ainda precisa ser validado ponta a ponta antes da abertura pública. Nenhum prazo de repasse é prometido nesta fase.</div>
    </section>

    <section class="section" id="merchant-how"><div class="section-head"><div><span class="section-kicker">DO PEDIDO À ENTREGA</span><h2>Uma operação simples de entender</h2></div></div><div class="how-grid">
      <div class="how-card"><span>1</span><div><strong>Cliente consulta</strong><p>O Chama procura operações elegíveis para a cesta e o endereço.</p></div></div>
      <div class="how-card"><span>2</span><div><strong>Você decide se aceita</strong><p>Nenhum pedido vira compromisso da revenda sem seu aceite.</p></div></div>
      <div class="how-card"><span>3</span><div><strong>Prepare e confirme a saída</strong><p>O cliente só vê “A caminho” depois da sua confirmação.</p></div></div>
      <div class="how-card"><span>4</span><div><strong>Conclua com prova</strong><p>Pagamento confirmado e PIN encerram a entrega com rastreabilidade.</p></div></div>
    </div></section>

    <section class="section"><div class="section-head"><div><span class="section-kicker">O QUE VOCÊ CONTROLA</span><h2>Sua operação continua sendo sua.</h2></div></div>
      <div class="control-grid">
        <div class="control-item"><span>💲</span><div><strong>Preço por produto</strong><small>Atualize e reconfirme cada SKU.</small></div></div>
        <div class="control-item"><span>📦</span><div><strong>Estoque</strong><small>Somente item ativo e disponível entra nas ofertas.</small></div></div>
        <div class="control-item"><span>⏱️</span><div><strong>Prazo e taxa de entrega</strong><small>Configure a condição comercial da operação.</small></div></div>
        <div class="control-item"><span>🟢</span><div><strong>Online ou offline</strong><small>Pare de receber novos pedidos quando precisar.</small></div></div>
      </div>
    </section>

    <section class="section"><div class="merchant-requirements"><div><span class="section-kicker light">PARA COMEÇAR</span><h2>Cadastro curto, ativação responsável.</h2><p>Precisamos identificar a empresa e o responsável. Para vender GLP, a operação passa também pela verificação regulatória aplicável antes de entrar nas ofertas.</p></div>
      <div class="requirement-list"><span>✓ CNPJ e dados da empresa</span><span>✓ Responsável e contato</span><span>✓ Endereço da operação</span><span>✓ Validação ANP quando houver GLP</span></div>
    </div></section>

    <section class="section"><div class="section-head"><div><span class="section-kicker">DÚVIDAS DE QUEM VENDE</span><h2>Antes de entrar, saiba exatamente o que você controla.</h2></div></div><div class="faq-list"><details open><summary>Quando existe a taxa de 7,5%?</summary><p>Na política inicial do piloto, a taxa da plataforma incide sobre o valor bruto de cada pedido concluído. O simulador acima mostra a matemática antes dos custos e tributos próprios da empresa.</p></details><details><summary>Sou obrigado a aceitar todo pedido?</summary><p>Não. A revenda decide se aceita cada pedido e também pode ficar offline quando não quiser receber novas oportunidades.</p></details><details><summary>Quem define preço, estoque e entrega?</summary><p>A própria revenda controla preço por produto, estoque disponível, taxa de entrega e prazo operacional dentro das regras da plataforma.</p></details><details><summary>Quando o dinheiro é repassado?</summary><p>O fluxo real de cobrança, conciliação e repasse ainda está em validação para a abertura pública. O Chama não publica um prazo de repasse antes dessa comprovação.</p></details><details><summary>Posso vender outros itens além do P13?</summary><p>Sim. O catálogo suporta outros tamanhos de GLP e produtos como água, carvão, lenha e gelo, sujeitos às validações aplicáveis.</p></details></div></section>

    <section class="section"><div class="soft-band"><div><span class="section-kicker">ENTRADA NO PILOTO</span><h2>Veja custo, requisitos e operação antes de ativar.</h2><p>Enviar o cadastro não coloca a empresa online automaticamente e não cria cobrança. A ativação depende da aprovação e, quando houver GLP, da validação regulatória aplicável.</p></div><button class="primary" onclick="${cta}">Começar cadastro</button></div></section>

    <div class="notice"><strong>Por que existe validação?</strong><br>Para que clientes encontrem operações realmente aptas a atender. Isso protege a experiência do comprador e também a reputação das empresas parceiras.</div>
  </section>`)
}
function merchantJoin(){
  if(globalThis.merchantPortalRequested?.()){
    const rt=globalThis.merchantRuntime||{};
    if(['disabled','loading'].includes(rt.status)){
      return shell('<section class="page"><h1 class="page-title">Cadastro de parceiro</h1><div class="empty card">Conectando à sua conta…</div></section>');
    }
    if(rt.status==='unauthenticated')return merchantLiveLoginView();
  }
  if(globalThis.__CHAMA_TEST__!==true&&!globalThis.merchantPortalRequested?.())return merchantRealPortalRequired();
  return shell(`<section class="page"><button class="back" onclick="go('merchants')">← Para revendas</button><h1 class="page-title">Quero ser parceiro</h1><p class="muted">${globalThis.merchantPortalRequested?.()?'Preencha os dados para enviar sua empresa para análise.':'Ambiente isolado de teste.'}</p><div class="card flat form-stack"><div class="field-row"><div class="input-wrap"><label for="j-cnpj">CNPJ</label><input id="j-cnpj" autocapitalize="characters" maxlength="18" class="input" placeholder="00.000.000/0000-00 ou alfanumérico"></div><div class="input-wrap"><label for="j-name">Nome da empresa</label><input id="j-name" maxlength="90" class="input" placeholder="Nome da revenda"></div></div><div class="field-row"><div class="input-wrap"><label for="j-owner">Responsável</label><input id="j-owner" maxlength="90" class="input" placeholder="Nome do responsável"></div><div class="input-wrap"><label for="j-phone">WhatsApp</label><input id="j-phone" inputmode="tel" maxlength="20" class="input" placeholder="(55) 99999-9999"></div></div><div class="input-wrap"><label for="j-address">Endereço</label><input id="j-address" maxlength="160" class="input" placeholder="Endereço da empresa"></div><button class="primary" onclick="joinMerchant()">Enviar para análise</button></div><div class="notice" style="margin-top:14px">O cadastro não coloca a empresa online automaticamente. A operação entra nas ofertas somente depois da aprovação e, quando houver GLP, da validação regulatória aplicável.</div></section>`)
}
function onlyDigits(v){return String(v||'').replace(/\D/g,'')}
function isValidPhoneShape(v){const n=onlyDigits(v);return n.length===10||n.length===11}
async function joinMerchant(){
  const cnpj=document.querySelector('#j-cnpj')?.value.trim()||'';
  const name=document.querySelector('#j-name')?.value.trim()||'';
  const owner=document.querySelector('#j-owner')?.value.trim()||'';
  const phone=document.querySelector('#j-phone')?.value.trim()||'';
  const address=document.querySelector('#j-address')?.value.trim()||'';
  if(!isValidCnpjShape(cnpj))return toast('Informe um CNPJ válido no formato atual');
  if(name.length<2||owner.length<2||address.length<5)return toast('Revise os dados da empresa');
  if(!isValidPhoneShape(phone))return toast('Informe um WhatsApp válido');

  if(globalThis.merchantPortalRequested?.()){
    if(!globalThis.merchantRuntime?.session?.access_token)return toast('Entre com seu e-mail antes de enviar o cadastro');
    try{
      const result=await merchantSubmitApplicationLive({
        cnpj,
        companyName:name.slice(0,90),
        responsibleName:owner.slice(0,90),
        phone,
        address:address.slice(0,160)
      });
      toast('Cadastro real enviado para análise');
      globalThis.merchantRuntime.notice='Cadastro '+String(result?.companyName||name)+' recebido. Aguarde a validação e o vínculo da operação.';
      go('merchant');
      render();
      return;
    }catch(e){
      toast(String(e?.message||e));
      return;
    }
  }

  if(globalThis.__CHAMA_TEST__!==true){
    openMerchantPortal();
    return;
  }

  const normalized=normalizeCnpj(cnpj);
  if(state.onboarding.some(x=>normalizeCnpj(x.cnpj)===normalized))return toast('Este CNPJ já foi enviado para análise');
  state.onboarding.push({cnpj:normalized,name:name.slice(0,90),owner:owner.slice(0,90),phone:onlyDigits(phone),address:address.slice(0,160),status:'Em análise',createdAt:nowIso()});
  save();toast('Cadastro enviado para análise');go('merchants');
}
