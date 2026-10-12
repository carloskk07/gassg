const DEFAULT_REFERRAL_PILOT_RATE=0.02;
const DEFAULT_MERCHANT_PILOT_FEE_RATE=0.075;

function currentCommercialRate(field,fallback){
  const policy=globalThis.liveRuntime?.marketStatus?.commercialPolicy;
  const raw=policy&&typeof policy==='object'?Number(policy[field]):NaN;
  if(Number.isFinite(raw)&&raw>=0&&raw<=5000)return raw/10000;
  return fallback;
}
function referralPilotRate(){
  return currentCommercialRate('directReferralBps',DEFAULT_REFERRAL_PILOT_RATE);
}
function merchantPilotFeeRate(){
  return currentCommercialRate('platformFeeBps',DEFAULT_MERCHANT_PILOT_FEE_RATE);
}
function policyPercent(rate){
  const pct=Math.round(Math.max(0,Number(rate)||0)*10000)/100;
  return pct.toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
}

function club(){
  const purchases=Math.max(0,Number(state.user.purchases)||0);
  const cycle=purchases===0?0:(purchases%5||5);
  const pct=cycle*20;
  const next=purchases>0&&cycle===5?'Ciclo completo — a próxima compra inicia um novo ciclo':`${cycle} de 5 compras no ciclo atual`;
  const debt=Math.max(0,Number(state.user.cashbackDebt)||0);
  const comparisonSavings=Math.max(0,Number(globalThis.liveRuntime?.comparisonSavingsCents||0))/100;
  const cashbackEarned=Math.max(0,Number(globalThis.liveRuntime?.cashbackEarnedCents||0))/100;
  return shell(`<section class="page">
    <span class="eyebrow">CLUBE TAMÃO</span>
    <h1 class="page-title">Conheça os benefícios das suas compras.</h1>
    <p class="muted page-lead">Confira os créditos que você já recebeu e veja quando poderá usar algum deles em uma próxima compra.</p>
    <div class="reward-hero"><div class="tiny" style="opacity:.75">SEU CASHBACK DISPONÍVEL</div><div class="balance">${BRL.format(state.user.cashback)}</div><div class="tiny">crédito para usar em novas compras</div><div class="progress"><div style="width:${pct}%"></div></div><strong>${esc(next)}</strong></div>
    <div class="earn-summary" style="margin-top:14px">
      <div class="earn-balance-card"><span>Economia nas comparações</span><strong>${BRL.format(comparisonSavings)}</strong><small>diferença acumulada contra a opção mais cara realmente exibida nas consultas que viraram pedidos concluídos</small></div>
      <div class="earn-balance-card"><span>Cashback já gerado</span><strong>${BRL.format(cashbackEarned)}</strong><small>créditos válidos historicamente, mesmo que parte já tenha sido usada</small></div>
      <div class="earn-balance-card"><span>Cashback disponível</span><strong>${BRL.format(state.user.cashback)}</strong><small>saldo que pode reduzir uma próxima compra</small></div>
    </div>
    ${debt>0?`<div class="notice" style="margin-top:14px"><strong>${BRL.format(debt)} em compensação.</strong><br>Esse valor corresponde a cashback de uma compra posteriormente revertida. Novos créditos reduzem essa compensação antes de ficarem disponíveis.</div>`:''}
    <section class="section"><div class="grid cards-3">
      <div class="card"><div class="feature-icon">💵</div><h3>Cashback</h3><p class="muted tiny">Crédito para reduzir o valor de novas compras no TAMÃO.</p></div>
      <div class="card"><div class="feature-icon">⭐</div><h3>Recorrência</h3><p class="muted tiny">Veja suas compras e acompanhe os benefícios que já recebeu.</p></div>
      <div class="card"><div class="feature-icon">🤝</div><h3>Indicação</h3><p class="muted tiny">Quando a campanha estiver disponível, você poderá indicar o TAMÃO para outras pessoas.</p><button class="ghost small" onclick="go('earn')">Ver como ganhar →</button></div>
    </div></section>
  </section>`)
}

function referralUrl(){
  if(!state.user.referralCode)return '';
  const base=`${location.origin}${location.pathname}`;
  return `${base}?ref=${encodeURIComponent(state.user.referralCode)}#home`;
}
let referralQrLoader=null;
function ensureReferralQrLibrary(){
  if(typeof globalThis.qrcode==='function')return Promise.resolve(true);
  if(referralQrLoader)return referralQrLoader;
  referralQrLoader=new Promise((resolve)=>{
    const script=document.createElement('script');
    script.src='https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.js';
    script.async=true;
    script.crossOrigin='anonymous';
    let done=false;
    const finish=(ok)=>{
      if(done)return;
      done=true;
      clearTimeout(timer);
      if(!ok)referralQrLoader=null;
      resolve(ok&&typeof globalThis.qrcode==='function');
    };
    const timer=setTimeout(()=>finish(false),8000);
    script.onload=()=>finish(true);
    script.onerror=()=>finish(false);
    document.head.appendChild(script);
  });
  return referralQrLoader;
}
async function renderReferralQr(){
  const target=document.getElementById('referral-qr');
  const url=referralUrl();
  if(!target||!url)return;
  const ready=await ensureReferralQrLibrary();
  if(!document.body.contains(target))return;
  if(!ready){
    target.innerHTML='<div class="tiny muted">QR indisponível agora. O link e o código continuam funcionando normalmente.</div>';
    return;
  }
  try{
    const qr=globalThis.qrcode(0,'M');
    qr.addData(url);
    qr.make();
    target.innerHTML=qr.createSvgTag({cellSize:5,margin:2,scalable:true});
    const svg=target.querySelector('svg');
    if(svg){
      svg.setAttribute('role','img');
      svg.setAttribute('aria-label','QR Code do seu link pessoal do TAMÃO');
      svg.style.maxWidth='220px';
      svg.style.width='100%';
      svg.style.height='auto';
    }
  }catch{
    target.innerHTML='<div class="tiny muted">Não foi possível gerar o QR agora. Use o link pessoal exibido acima.</div>';
  }
}
async function copyReferralCode(){
  const code=String(state.user.referralCode||'');
  if(!code)return toast('Código ainda indisponível');
  try{
    if(navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(code);
      toast('Código copiado');
      return;
    }
  }catch{}
  toast('Copie o código exibido no cartão');
}

function referralExample(orderReais,count=1){
  const amount=Math.max(0,Number(orderReais)||0);
  const qty=Math.max(1,Math.trunc(Number(count)||1));
  return roundMoney(amount*referralPilotRate()*qty);
}
function merchantEconomicsExample(orderReais,count=1){
  const amount=Math.max(0,Number(orderReais)||0);
  const qty=Math.max(1,Math.trunc(Number(count)||1));
  const gross=roundMoney(amount*qty);
  const fee=roundMoney(gross*merchantPilotFeeRate());
  return {gross,fee,merchantNet:roundMoney(gross-fee)};
}
function merchantMarginExample({salePrice,orders=1,productCost=0,deliveryCost=0,paymentCost=0,taxRate=0}={}){
  const price=Math.max(0,Number(salePrice)||0);
  const qty=Math.min(10000,Math.max(1,Math.trunc(Number(orders)||1)));
  const unitProductCost=Math.max(0,Number(productCost)||0);
  const unitDeliveryCost=Math.max(0,Number(deliveryCost)||0);
  const unitPaymentCost=Math.max(0,Number(paymentCost)||0);
  const taxPct=Math.min(100,Math.max(0,Number(taxRate)||0));
  const gross=roundMoney(price*qty);
  const chamaFee=roundMoney(gross*merchantPilotFeeRate());
  const productCosts=roundMoney(unitProductCost*qty);
  const deliveryCosts=roundMoney(unitDeliveryCost*qty);
  const paymentCosts=roundMoney(unitPaymentCost*qty);
  const taxes=roundMoney(gross*(taxPct/100));
  const knownCosts=roundMoney(productCosts+deliveryCosts+paymentCosts+taxes);
  const contribution=roundMoney(gross-chamaFee-knownCosts);
  const unitContribution=qty?roundMoney(contribution/qty):0;
  const marginPct=gross>0?Math.round((contribution/gross)*1000)/10:0;
  return {gross,chamaFee,productCosts,deliveryCosts,paymentCosts,taxes,knownCosts,contribution,unitContribution,marginPct};
}
function updateReferralSimulator(){
  const clients=Math.min(500,Math.max(1,Math.trunc(Number(document.querySelector('#ref-sim-clients')?.value)||1)));
  const ticket=Math.min(100000,Math.max(1,Number(document.querySelector('#ref-sim-ticket')?.value)||1));
  const total=referralExample(ticket,clients);
  const out=document.querySelector('#ref-sim-total');
  if(out)out.textContent=BRL.format(total);
  const detail=document.querySelector('#ref-sim-detail');
  if(detail)detail.textContent=clients+' novo'+(clients===1?' cliente':'s clientes')+' × '+BRL.format(ticket)+' × '+policyPercent(referralPilotRate());
}
function updateMerchantSimulator(){
  const orders=Math.min(10000,Math.max(1,Math.trunc(Number(document.querySelector('#merchant-sim-orders')?.value)||1)));
  const salePrice=Math.min(100000,Math.max(0.01,Number(document.querySelector('#merchant-sim-ticket')?.value)||0.01));
  const productCostRaw=String(document.querySelector('#merchant-sim-product-cost')?.value??'').trim();
  const parsedProductCost=Number(productCostRaw);
  const hasProductCost=productCostRaw!==''&&Number.isFinite(parsedProductCost)&&parsedProductCost>=0;
  const productCost=hasProductCost?Math.min(100000,parsedProductCost):0;
  const deliveryCost=Math.min(100000,Math.max(0,Number(document.querySelector('#merchant-sim-delivery-cost')?.value)||0));
  const paymentCost=Math.min(100000,Math.max(0,Number(document.querySelector('#merchant-sim-payment-cost')?.value)||0));
  const taxRate=Math.min(100,Math.max(0,Number(document.querySelector('#merchant-sim-tax-rate')?.value)||0));
  const e=merchantMarginExample({salePrice,orders,productCost,deliveryCost,paymentCost,taxRate});
  const gross=document.querySelector('#merchant-sim-gross');
  const fee=document.querySelector('#merchant-sim-fee');
  const costs=document.querySelector('#merchant-sim-costs');
  const contribution=document.querySelector('#merchant-sim-contribution');
  const unit=document.querySelector('#merchant-sim-unit');
  const margin=document.querySelector('#merchant-sim-margin');
  if(gross)gross.textContent=BRL.format(e.gross);
  if(fee)fee.textContent=BRL.format(e.chamaFee);
  if(!hasProductCost){
    if(costs)costs.textContent='Informe o custo do produto';
    if(contribution)contribution.textContent='—';
    if(unit)unit.textContent='—';
    if(margin)margin.textContent='—';
    return;
  }
  if(costs)costs.textContent=BRL.format(e.knownCosts);
  if(contribution)contribution.textContent=BRL.format(e.contribution);
  if(unit)unit.textContent=BRL.format(e.unitContribution);
  if(margin)margin.textContent=(Number.isFinite(e.marginPct)?e.marginPct:0).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
}
function refer(){
  const url=referralUrl();
  const live=globalThis.liveRequested?.()===true;
  const permanent=state.user.cashEarningEligible===true;
  const hasReferral=Boolean(state.user.referralCode);
  const referredCount=live?Math.max(0,Number(globalThis.liveRuntime?.referredCount||0)):0;
  const qualifiedReferralCount=live?Math.max(0,Number(globalThis.liveRuntime?.qualifiedReferralCount||0)):0;
  const referralCard=hasReferral
    ? `<div class="card flat referral-share-card"><div class="tiny muted">SEU LINK PESSOAL</div><div class="share-box">${esc(url)}</div><div class="field-row" style="align-items:center;margin-top:14px"><div id="referral-qr" class="card flat" style="display:flex;align-items:center;justify-content:center;min-height:190px;flex:0 0 220px"><div class="tiny muted">Gerando QR...</div></div><div style="flex:1"><div class="tiny muted">SEU CÓDIGO</div><div class="balance" style="font-size:1.4rem">${esc(state.user.referralCode)}</div><p class="muted tiny">O QR e o link apontam para o mesmo código pessoal. Quem entrar por eles continua sujeito às regras de primeira compra qualificada.</p><button class="secondary small" onclick="copyReferralCode()">Copiar código</button></div></div><button class="primary full" style="margin-top:12px" onclick="shareReferral()">Compartilhar meu link</button></div>`
    : '<div class="notice"><strong>Seu link ainda não está disponível.</strong><br>Ele aparece quando sua identidade real for carregada pelo serviço do TAMÃO.</div>';
  const identityCard=live&&!permanent
    ? `<div class="notice" style="margin-top:14px"><strong>Quer transformar comissão em saldo disponível?</strong><br>Vincule um e-mail à sua conta. Seu histórico, pedidos e cashback continuam no mesmo usuário.</div><div class="card flat form-stack" style="margin-top:14px"><div class="input-wrap"><label for="cash-email">Seu e-mail</label><input id="cash-email" type="email" autocomplete="email" maxlength="160" class="input" placeholder="voce@email.com"></div><button class="primary" onclick="activateCashAccount()">Vincular meu e-mail</button></div>`
    : live&&permanent
      ? '<div class="notice success" style="margin-top:14px"><strong>Conta habilitada para comissão.</strong><br>Vendas elegíveis ainda passam pela janela de validação antes de se tornarem saldo disponível.</div>'
      : '';

  if(hasReferral)setTimeout(renderReferralQr,0);

  const referralRateLabel=policyPercent(referralPilotRate());
  return shell(`<section class="page">
    <button class="back" onclick="go('earn')">← Ganhar ou vender</button>
    <span class="eyebrow">CONVIDE ALGUÉM PARA CONHECER</span>
    <h1 class="page-title">Tem alguém que gostaria de conhecer o TAMÃO?</h1>
    <p class="muted page-lead">Quando a campanha estiver disponível, compartilhe seu link. A comissão depende da primeira compra válida de um novo cliente, não apenas do cadastro.</p>
    <div class="earn-summary">
      <div class="earn-balance-card"><span>Disponível</span><strong>${BRL.format(state.user.commissionAvailable)}</strong><small>saldo já liberado</small></div>
      <div class="earn-balance-card"><span>A liberar</span><strong>${BRL.format(state.user.commissionPending)}</strong><small>em validação</small></div>
      <div class="earn-balance-card"><span>Indicados</span><strong>${referredCount}</strong><small>novos usuários vinculados</small></div>
      <div class="earn-balance-card"><span>Qualificados</span><strong>${qualifiedReferralCount}</strong><small>com 1ª compra qualificada</small></div>
    </div>
    ${referralCard}
    ${identityCard}

    <section class="section"><div class="section-head"><div><span class="section-kicker">FAÇA UMA SIMULAÇÃO</span><h2>Entenda como seria calculada uma comissão de ${referralRateLabel}.</h2><p>Preencha valores de exemplo para entender o cálculo. Isso não significa que você receberá essa quantia.</p></div></div>
      <div class="calculator-card">
        <div class="calculator-inputs">
          <div class="input-wrap"><label for="ref-sim-clients">Novos clientes com 1ª compra qualificada</label><input id="ref-sim-clients" class="input" type="number" inputmode="numeric" min="1" max="500" value="10" oninput="updateReferralSimulator()"></div>
          <div class="input-wrap"><label for="ref-sim-ticket">Valor médio da primeira compra (R$)</label><input id="ref-sim-ticket" class="input" type="number" inputmode="decimal" min="1" step="0.01" value="120" oninput="updateReferralSimulator()"></div>
        </div>
        <div class="calculator-result"><small>Resultado da simulação</small><strong id="ref-sim-total">${BRL.format(referralExample(120,10))}</strong><span id="ref-sim-detail">10 novos clientes × ${BRL.format(120)} × ${referralRateLabel}</span></div>
      </div>
      <div class="notice" style="margin-top:12px"><strong>A comissão precisa ser validada antes de ficar disponível.</strong><br>A comissão só pode ser gerada pela primeira compra válida de cada novo cliente indicado. O pedido precisa ser entregue, pago e aprovado na conferência de segurança. Compras seguintes do mesmo cliente não geram outra comissão de indicação.</div>
    </section>

    <section class="section"><div class="section-head"><div><h2>Quando a indicação pode gerar comissão</h2></div></div><div class="how-grid">
      <div class="how-card"><span>1</span><div><strong>Compartilhe seu link</strong><p>Envie para quem realmente possa se interessar pelo TAMÃO.</p></div></div>
      <div class="how-card"><span>2</span><div><strong>O novo cliente faz a primeira compra válida</strong><p>Cadastro sozinho e compras posteriores do mesmo cliente não criam nova comissão.</p></div></div>
      <div class="how-card"><span>3</span><div><strong>A venda é concluída</strong><p>A entrega e o pagamento precisam ser confirmados.</p></div></div>
      <div class="how-card"><span>4</span><div><strong>A comissão é validada</strong><p>Depois da conferência de segurança e da validação das contas envolvidas, a comissão pode ser liberada.</p></div></div>
    </div></section>

    <div class="card flat payout-card"><div><span class="section-kicker">RECEBIMENTO</span><h3>Saldo liberado ainda não significa saque por Pix.</h3><p class="muted">Você pode acompanhar o que ainda está em análise e o que já foi liberado. O saque por Pix só aparecerá quando esse serviço estiver disponível.</p></div><button class="secondary" disabled>Saque Pix ainda não disponível</button></div>
  </section>`)
}

function earn(){
  const merchantSample=merchantEconomicsExample(120);
  const referralRateLabel=policyPercent(referralPilotRate());
  const merchantFeeLabel=policyPercent(merchantPilotFeeRate());
  return shell(`<section class="page">
    <span class="eyebrow">MAIS FORMAS DE APROVEITAR O TAMÃO</span>
    <h1 class="page-title">Comprar pelo TAMÃO também pode trazer benefícios.</h1>
    <p class="muted page-lead">Conheça os benefícios de compra, saiba como funcionam as indicações e veja como cadastrar sua empresa para vender pelo TAMÃO.</p>
    <div class="conversion-mini-proof"><span>✓ Compra e indicação são diferentes</span><span>✓ Regras visíveis</span><span>✓ Sem promessa de renda</span></div>

    <div class="opportunity-grid main-opportunities">
      <article class="opportunity-card person-opportunity"><div class="opportunity-icon">🤝</div><span class="section-kicker">PARA QUEM GOSTA DE COMPARTILHAR</span><h2>Conhece alguém que gostaria de usar o TAMÃO?</h2><p>Quando a campanha estiver ativa, você poderá compartilhar seu link. Uma indicação pode gerar comissão após a primeira compra válida ser entregue, paga e aprovada.</p>
        <ul class="clean-list"><li>Política comercial atual: ${referralRateLabel} da primeira compra qualificada</li><li>Uma comissão de aquisição por novo cliente elegível</li><li>Saldo “a liberar” separado do saldo disponível</li><li>Nenhum pagamento por simples recrutamento</li></ul>
        <div class="opportunity-example"><small>Exemplo matemático</small><strong>R$ 120 × ${referralRateLabel} = ${BRL.format(referralExample(120))}</strong><span>Este é apenas um exemplo: a comissão depende de uma compra válida e das verificações do programa.</span></div>
        <button class="primary full" onclick="go('refer')">Conhecer as indicações →</button>
      </article>
      <article class="opportunity-card business-opportunity"><div class="opportunity-icon">🏪</div><span class="section-kicker">PARA QUEM JÁ TEM UM NEGÓCIO</span><h2>Sua empresa pode vender por mais um canal.</h2><p>Use o TAMÃO como um canal adicional para gás, água e outros itens, sem abandonar telefone, WhatsApp, balcão ou sua base atual de clientes.</p>
        <ul class="clean-list"><li>Você define preços, estoque e taxa de entrega</li><li>Escolhe quando ficar online</li><li>Decide se aceita cada pedido</li><li>Pode aumentar o ticket com vários produtos na mesma entrega</li></ul>
        <div class="opportunity-example"><small>Taxa sobre pedidos concluídos</small><strong>Taxa TAMÃO: ${merchantFeeLabel} por pedido concluído</strong><span>Ex.: R$ 120 bruto → ${BRL.format(merchantSample.fee)} de taxa → ${BRL.format(merchantSample.merchantNet)} antes dos custos próprios e impostos.</span></div>
        <button class="primary full" onclick="go('merchants')">Quero conhecer a parceria →</button>
      </article>
    </div>

    <section class="section"><div class="soft-band"><div><span class="section-kicker">TRANSPARÊNCIA</span><h2>Cada vantagem funciona de um jeito.</h2><p>O cashback pode reduzir o valor de novas compras. A comissão de indicação depende da primeira venda válida. Já a revenda recebe pelas vendas que realiza. Não existe pagamento só por cadastrar pessoas, nem renda garantida. Saques serão oferecidos apenas quando o serviço estiver disponível.</p></div><button class="secondary" onclick="go('learn')">Entender compra e segurança</button></div></section>
  </section>`)
}

function learn(){
  return shell(`<section class="page">
    <span class="eyebrow">COMO FUNCIONA O TAMÃO</span>
    <h1 class="page-title">Quer pedir gás, água ou outros itens? Veja como funciona.</h1>
    <p class="muted page-lead">Comece pelo seu CEP. Quando houver revendas disponíveis, você confere os preços, os prazos e escolhe a opção que prefere.</p>
    <div class="journey-invite">
      <span class="journey-invite-icon" aria-hidden="true">🏡</span>
      <div><strong>Do gás à água, o que você precisa está no mesmo lugar.</strong><span>Você escolhe, a revenda confirma e o TAMÃO mostra o andamento.</span></div>
      <button class="primary" onclick="startCustomerAvailability()">Consultar minha região →</button>
    </div>

    <section class="section"><div class="section-head"><div><span class="section-kicker">SEM COMPLICAÇÃO</span><h2>Do CEP à entrega, veja como funciona.</h2></div></div><div class="how-grid">
      <div class="how-card"><span>1</span><div><strong>Monte sua cesta</strong><p>Escolha gás e/ou produtos essenciais disponíveis.</p></div></div>
      <div class="how-card"><span>2</span><div><strong>Confirme seu endereço</strong><p>Procuramos revendas que possam entregar esses produtos no seu endereço.</p></div></div>
      <div class="how-card"><span>3</span><div><strong>Escolha uma opção</strong><p>Compare valor total e previsão de entrega antes de confirmar.</p></div></div>
      <div class="how-card"><span>4</span><div><strong>Acompanhe</strong><p>Você acompanha quando a revenda aceita, prepara e sai para entregar.</p></div></div>
    </div></section>

    <section class="section"><div class="section-head"><div><span class="section-kicker">MAIS TRANQUILIDADE</span><h2>Você não precisa ficar sem resposta.</h2></div></div><div class="grid cards-3">
      <div class="card feature-card"><div class="feature-icon">💲</div><h3>Valor antes de confirmar</h3><p>Você vê o total da opção antes de criar o pedido.</p></div>
      <div class="card feature-card"><div class="feature-icon">✅</div><h3>Parceiro precisa confirmar</h3><p>A revenda precisa aceitar antes de o pedido ser confirmado. Você vê essa confirmação no acompanhamento.</p></div>
      <div class="card feature-card"><div class="feature-icon">📍</div><h3>Acompanhamento por etapas</h3><p>Você vê quando o pedido está sendo preparado, já saiu ou está chegando.</p></div>
    </div></section>

    <section class="section"><div class="section-head"><div><span class="section-kicker">A GENTE EXPLICA</span><h2>O que você gostaria de saber?</h2></div></div><div class="faq-list">
      <details open><summary>Preciso comprar gás para pedir água, carvão, lenha ou gelo?</summary><p>Não. Quando houver oferta real para o produto, você pode montar uma cesta sem gás.</p></details>
      <details><summary>O preço pode mudar depois que eu escolho?</summary><p>Depois que você escolhe, o valor não muda sem sua autorização. Se outra revenda oferecer uma alternativa mais cara, você decide se aceita.</p></details>
      <details><summary>Como sei que alguém realmente assumiu meu pedido?</summary><p>O pedido é confirmado quando a revenda aceita. O aviso “A caminho” só aparece quando ela informa que saiu para entregar.</p></details>
      <details><summary>E se o parceiro aceitar e depois não puder sair para entregar?</summary><p>O TAMÃO pode procurar outra revenda disponível. Se o preço for maior, pediremos sua autorização antes de trocar.</p></details>
      <details><summary>E se ninguém aceitar?</summary><p>Sem aceite da revenda, o pedido não é confirmado. O sistema pode buscar outra opção e avisa se não houver ninguém disponível.</p></details>
      <details><summary>Como a entrega é concluída?</summary><p>A conclusão exige confirmação de pagamento e o código de recebimento do pedido. Informe esse código somente quando o pedido estiver com você.</p></details>
      <details><summary>Como funciona o cashback?</summary><p>Compras elegíveis podem gerar crédito para reduzir compras futuras dentro do TAMÃO. O saldo aparece no Clube TAMÃO.</p></details>
      <details><summary>Também posso ganhar indicando pessoas?</summary><p>Sim. Quando a campanha de indicação estiver disponível, a primeira compra qualificada de cada novo cliente indicado pode gerar comissão após entrega, pagamento e validação. Compras posteriores do mesmo cliente não geram outra comissão de aquisição.</p></details>
      <details><summary>Tenho uma revenda. Posso vender outros produtos além de gás?</summary><p>Sim. Cada revenda pode cadastrar outros produtos que comercializa. Para vender gás, precisa comprovar as autorizações exigidas.</p></details>
    </div></section>

    <div class="dual-cta"><button class="primary" onclick="startCustomerAvailability()">Consultar ofertas na minha região →</button><button class="secondary" onclick="go('merchants')">Minha empresa pode vender?</button></div>
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
    toast(/manual linking|identity linking/i.test(msg)?'A ativação por e-mail está temporariamente indisponível':msg);
  }
}

function referralSharePayload(url,region){
  const city=String(region?.city||'').trim().slice(0,80);
  const state=String(region?.state||'').trim().toUpperCase();
  const place=city&&/^[A-Z]{2}$/.test(state)?`em ${city}/${state}`:'na sua região';
  return {
    title:'TAMÃO — Pediu? Tá na mão.',
    text:`Conheça o TAMÃO! Consulte gás, água e itens essenciais ${place}, confira a disponibilidade pelo CEP e compartilhe: ${url}`,
    url
  };
}

async function shareReferral(){
  const url=referralUrl();
  if(!url)return toast('Link de indicação indisponível no momento');
  const region=typeof rememberedMarketRegion==='function'?rememberedMarketRegion():null;
  const payload=referralSharePayload(url,region);
  try{
    if(navigator.share){
      await navigator.share(payload);
      return;
    }
    if(navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(payload.text);
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
  const internalPilot=globalThis.CHAMA_INTERNAL_PILOT===true;
  const cta=internalPilot?"setMode('merchant')":"openPrelaunchMerchantLead()";
  const ctaLabel=internalPilot?'Abrir ambiente interno':'Cadastrar minha empresa';
  const referenceTicket=120.00;
  const merchantFeeLabel=policyPercent(merchantPilotFeeRate());
  const initial=merchantMarginExample({salePrice:referenceTicket,orders:50});

  return shell(`<section class="page merchant-landing">
    <span class="eyebrow">VENDA PELO TAMÃO</span>
    <h1 class="page-title">Sua empresa já vende. <span class="headline-accent">Que tal ser encontrada por mais clientes?</span></h1>
    <p class="muted page-lead">O TAMÃO pode ajudar clientes da sua região a encontrar sua empresa. Você continua vendendo no balcão, pelo WhatsApp e telefone — <strong>e continua no comando dos seus preços, estoque e entregas.</strong></p>
    <div class="conversion-mini-proof"><span>✓ Sem exclusividade</span><span>✓ Recebimento direto na revenda</span><span>✓ Você decide quando ficar online</span></div>

    <div class="merchant-commercial-strip merchant-value-strip">
      <div><small>TAXA POR PEDIDO CONCLUÍDO</small><strong>${merchantFeeLabel}</strong><span>sobre o valor bruto de cada pedido concluído</span></div>
      <p><strong>O modelo atual não tem mensalidade.</strong> A taxa do TAMÃO só é cobrada sobre pedidos concluídos. O cliente paga diretamente à sua revenda, que continua responsável pelos próprios custos e impostos.</p>
    </div>

    ${internalPilot?`<div class="notice success" style="margin-top:14px"><strong>Você está no laboratório interno do TAMÃO.</strong><br>Abra o painel da Gas e Lenheira do JR, simule pedidos e veja a operação antes de qualquer cadastro real.</div>`:''}

    <div class="hero-actions merchant-hero-actions">
      <button class="primary" onclick="${cta}">${internalPilot?ctaLabel:'Quero levar minha empresa ao TAMÃO →'}</button>
      <button class="secondary" onclick="document.getElementById('merchant-margin')?.scrollIntoView({behavior:'smooth'})">Ver quanto custa vender</button>
    </div>

    ${internalPilot?'':prelaunchMerchantLeadSection()}

    <section class="section"><div class="section-head"><div><span class="section-kicker">MAIS UM CANAL DE VENDAS</span><h2>Sua empresa pode ser encontrada por mais clientes.</h2><p>Você pode receber pedidos pelo TAMÃO e continuar vendendo no balcão, por telefone ou WhatsApp.</p></div></div>
      <div class="grid cards-3 partner-benefits">
        <div class="card"><div class="feature-icon">📈</div><h3>Mais oportunidades de venda</h3><p class="muted tiny">Seja uma opção para quem consulta gás e itens essenciais na área atendida pela sua empresa.</p></div>
        <div class="card"><div class="feature-icon">🧺</div><h3>Mais valor em cada entrega</h3><p class="muted tiny">Apresente água, carvão, lenha, gelo e outros produtos compatíveis da sua loja na mesma jornada de compra.</p></div>
        <div class="card"><div class="feature-icon">🔁</div><h3>Clientes que podem voltar</h3><p class="muted tiny">O histórico de compras pode ajudar o cliente a lembrar quando está na hora de repor o que costuma pedir.</p></div>
      </div>
      <div class="merchant-no-lockin"><span>✓ Sem exclusividade</span><span>✓ Sem obrigação de aceitar</span><span>✓ Online/offline quando quiser</span><span>✓ Preço e estoque sob seu controle</span></div>
    </section>

    <section class="section" id="merchant-margin"><div class="section-head"><div><span class="section-kicker">FAÇA AS CONTAS DO SEU JEITO</span><h2>Uma venda a mais vale quanto para o seu negócio?</h2><p>Experimente cenários com seus próprios custos. O simulador separa faturamento, taxa TAMÃO e despesas para ajudar você a decidir com clareza.</p></div></div>
      <div class="calculator-card merchant-calculator merchant-margin-calculator">
        <div class="calculator-inputs merchant-margin-inputs">
          <div class="input-wrap"><label for="merchant-sim-orders">Pedidos adicionais</label><input id="merchant-sim-orders" class="input" type="number" inputmode="numeric" min="1" max="10000" value="50" oninput="updateMerchantSimulator()"></div>
          <div class="input-wrap"><label for="merchant-sim-ticket">Preço médio por pedido (R$)</label><input id="merchant-sim-ticket" class="input" type="number" inputmode="decimal" min="0.01" step="0.01" value="120.00" oninput="updateMerchantSimulator()"></div>
          <div class="input-wrap"><label for="merchant-sim-product-cost">Custo do produto por pedido (R$)</label><input id="merchant-sim-product-cost" class="input" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Informe seu custo real" oninput="updateMerchantSimulator()"><small>Obrigatório para estimar contribuição e margem.</small></div>
          <div class="input-wrap"><label for="merchant-sim-delivery-cost">Custo médio de entrega (R$)</label><input id="merchant-sim-delivery-cost" class="input" type="number" inputmode="decimal" min="0" step="0.01" value="0" oninput="updateMerchantSimulator()"></div>
          <div class="input-wrap"><label for="merchant-sim-payment-cost">Custo médio do pagamento (R$)</label><input id="merchant-sim-payment-cost" class="input" type="number" inputmode="decimal" min="0" step="0.01" value="0" oninput="updateMerchantSimulator()"></div>
          <div class="input-wrap"><label for="merchant-sim-tax-rate">Tributos sobre a venda (%)</label><input id="merchant-sim-tax-rate" class="input" type="number" inputmode="decimal" min="0" max="100" step="0.1" value="0" oninput="updateMerchantSimulator()"></div>
        </div>
        <div class="economics-results merchant-margin-results">
          <div><small>Vendas brutas</small><strong id="merchant-sim-gross">${BRL.format(initial.gross)}</strong></div>
          <div><small>Taxa TAMÃO (${merchantFeeLabel})</small><strong id="merchant-sim-fee">${BRL.format(initial.chamaFee)}</strong></div>
          <div><small>Custos próprios informados</small><strong id="merchant-sim-costs">Informe o custo do produto</strong></div>
          <div class="highlight"><small>Contribuição estimada após os custos informados</small><strong id="merchant-sim-contribution">—</strong></div>
          <div><small>Contribuição estimada por pedido</small><strong id="merchant-sim-unit">—</strong></div>
          <div><small>Margem estimada sobre a venda</small><strong id="merchant-sim-margin">—</strong></div>
        </div>
      </div>
      <div class="notice" style="margin-top:12px"><strong>Use os seus custos reais.</strong><br>O simulador não conhece seu custo de compra, folha, combustível, impostos, manutenção ou despesas fixas. Ele serve para testar cenários — não para prometer lucro.</div>
    </section>

    <section class="section"><div class="section-head"><div><span class="section-kicker">ESPAÇO PARA DIFERENTES REVENDEDORES</span><h2>Preço importa. Atendimento também.</h2><p>Além do valor, consideramos o prazo, a disponibilidade e o histórico de atendimento de cada revenda.</p></div></div>
      <div class="distribution-grid">
        <div class="distribution-card"><span>1</span><strong>Preço total</strong><p>O cliente precisa enxergar uma condição competitiva.</p></div>
        <div class="distribution-card"><span>2</span><strong>Prazo real</strong><p>O prazo e a capacidade de entrega também contam.</p></div>
        <div class="distribution-card"><span>3</span><strong>Confiança operacional</strong><p>Estoque, consistência e cumprimento ajudam a construir reputação.</p></div>
        <div class="distribution-card"><span>4</span><strong>Pedidos bem distribuídos</strong><p>Quando as ofertas são parecidas, o número de pedidos em andamento pode ajudar a equilibrar as oportunidades.</p></div>
      </div>
      <div class="notice" style="margin-top:12px"><strong>Regra importante:</strong> o TAMÃO não coloca uma oferta claramente pior na frente só para distribuir pedidos. Esse ajuste vale para opções parecidas.</div>
    </section>

    <section class="section"><div class="section-head"><div><span class="section-kicker">APROVEITE MELHOR SUA ESTRUTURA</span><h2>Uma entrega. Mais possibilidades para sua empresa.</h2><p>Mostre outros produtos que você já comercializa, respeitando as regras de transporte e as autorizações aplicáveis.</p></div></div>
      <div class="ticket-grid">
        <div class="ticket-product">🔥 <strong>GLP</strong><span>P1 a P90 conforme catálogo e validação</span></div>
        <div class="ticket-product">💧 <strong>Água</strong><span>Galões e outros formatos no catálogo</span></div>
        <div class="ticket-product">🪵 <strong>Lenha</strong><span>Venda adicional na mesma entrega</span></div>
        <div class="ticket-product">🔥 <strong>Carvão</strong><span>Complemento de cesta</span></div>
        <div class="ticket-product">🧊 <strong>Gelo</strong><span>Mais produtos na mesma entrega</span></div>
      </div>
    </section>

    <section class="section" id="merchant-how"><div class="section-head"><div><span class="section-kicker">DO PEDIDO À ENTREGA</span><h2>Você decide como atender cada pedido.</h2></div></div><div class="how-grid">
      <div class="how-card"><span>1</span><div><strong>Cliente consulta</strong><p>O TAMÃO busca revendas que tenham os produtos e atendam o endereço informado.</p></div></div>
      <div class="how-card"><span>2</span><div><strong>Você aceita ou recusa</strong><p>Recusar antes de aceitar é permitido. Se não puder atender, diga não ou fique offline.</p></div></div>
      <div class="how-card"><span>3</span><div><strong>Prepare e confirme a saída</strong><p>Depois que você aceita, o cliente conta com a entrega. O status “A caminho” aparece quando você confirma a saída.</p></div></div>
      <div class="how-card"><span>4</span><div><strong>Conclua com prova</strong><p>Pagamento confirmado e código de recebimento encerram a entrega com rastreabilidade.</p></div></div>
    </div></section>

    <section class="section"><div class="section-head"><div><span class="section-kicker">COMO O DINHEIRO FUNCIONA</span><h2>Venda, recebimento e taxa TAMÃO são separados.</h2><p>O valor da venda pertence à revenda. Quando o cliente paga por um meio cadastrado pela empresa, o recebimento acontece diretamente na conta ou operação da própria revenda; o TAMÃO registra e concilia somente o que precisa para operar a plataforma.</p></div></div>
      <div class="money-flow">
        <div><span>1</span><strong>Pedido</strong><small>Preço e política financeira ficam registrados.</small></div>
        <b>→</b>
        <div><span>2</span><strong>Pagamento</strong><small>O cliente paga pela forma disponível da própria revenda.</small></div>
        <b>→</b>
        <div><span>3</span><strong>Conclusão</strong><small>Pagamento + código confirmam a entrega.</small></div>
        <b>→</b>
        <div><span>4</span><strong>Conciliação</strong><small>A venda da revenda e as cobranças do TAMÃO permanecem separadas.</small></div>
      </div>
      <div class="notice success" style="margin-top:12px"><strong>O TAMÃO não recebe a venda para depois repassar.</strong><br>O recebimento do cliente fica com a revenda. Taxas e créditos devidos ao TAMÃO são tratados separadamente no financeiro da plataforma.</div>
    </section>

    <section class="section"><div class="section-head"><div><span class="section-kicker">O QUE VOCÊ CONTROLA</span><h2>Sua operação continua sendo sua.</h2></div></div>
      <div class="control-grid">
        <div class="control-item"><span>💲</span><div><strong>Preço por produto</strong><small>Atualize e reconfirme cada SKU.</small></div></div>
        <div class="control-item"><span>📦</span><div><strong>Estoque</strong><small>Somente item ativo e disponível entra nas ofertas.</small></div></div>
        <div class="control-item"><span>⏱️</span><div><strong>Prazo e taxa de entrega</strong><small>Configure a condição comercial da operação.</small></div></div>
        <div class="control-item"><span>🟢</span><div><strong>Online ou offline</strong><small>Pare de receber novos pedidos quando precisar.</small></div></div>
      </div>
    </section>

    <section class="section"><div class="founder-band"><div><span class="section-kicker light">SUA EMPRESA. SUA CIDADE. SEU MERCADO.</span><h2>Quem procura seus produtos pode encontrar sua revenda no TAMÃO.</h2><p>O cadastro é acompanhado, sua empresa mantém controle de preço, estoque e disponibilidade e pode usar seus próprios meios de recebimento. O TAMÃO não promete volume de pedidos nem renda.</p></div><div class="founder-points"><span>✓ Cadastro acompanhado</span><span>✓ Painel da revenda</span><span>✓ Controle da operação</span><span>✓ Sem exclusividade</span></div></div></section>

    <section class="section"><div class="merchant-requirements"><div><span class="section-kicker light">COMECE COM O BÁSICO</span><h2>Comece pelo cadastro. As verificações vêm depois.</h2><p>Você pode cadastrar sua empresa agora. Antes de liberar as vendas, conferimos os dados do responsável e, no caso do gás, as autorizações exigidas.</p></div>
      <div class="requirement-list"><span>✓ Dados e CNPJ da empresa</span><span>✓ Responsável autorizado</span><span>✓ Endereço e área de atendimento</span><span>✓ ANP vigente para comercializar GLP</span></div>
    </div></section>

    <section class="section"><div class="section-head"><div><span class="section-kicker">RESPOSTAS PARA DECIDIR COM TRANQUILIDADE</span><h2>A parceria faz sentido para minha empresa?</h2></div></div><div class="faq-list">
      <details open><summary>Sou obrigado a aceitar todo pedido?</summary><p>Não. Você decide pedido por pedido e pode ficar offline. Recusar antes do aceite é melhor do que assumir uma entrega que já sabe que não conseguirá cumprir.</p></details>
      <details><summary>Se eu não for o mais barato, fico sem pedidos?</summary><p>Não necessariamente. O TAMÃO considera preço total, prazo e confiança. Entre parceiros próximos em qualidade, carga atual e volume recente ajudam a evitar concentração.</p></details>
      <details><summary>Posso continuar vendendo pelo WhatsApp e telefone?</summary><p>Sim. A proposta atual não exige exclusividade. O TAMÃO é um canal adicional.</p></details>
      <details><summary>Quando existe a taxa de ${merchantFeeLabel}?</summary><p>Na política comercial atual, a taxa da plataforma incide sobre o valor bruto de cada pedido concluído. O percentual exibido é sincronizado com a política vigente para novos pedidos.</p></details>
      <details><summary>Quem define preço, estoque e entrega?</summary><p>Sim. Você define o preço de cada produto, o estoque, o frete, a previsão de entrega e quando pode atender.</p></details>
      <details><summary>Como recebo o dinheiro da venda?</summary><p>O cliente paga diretamente à sua revenda, conforme a forma de pagamento oferecida. O TAMÃO não recebe o valor para depois fazer um repasse.</p></details>
      <details><summary>Preciso ter Mercado Pago ou contratar um novo serviço?</summary><p>Não para receber na entrega. A revenda pode disponibilizar dinheiro, Pix ou cartão na maquininha, conforme o que realmente aceita. Integrações automáticas com provedores dependem de homologação.</p></details>
      <details><summary>Tenho que pagar para começar?</summary><p>No plano comercial diário atual, não há exigência de comprar um pacote de crédito antecipadamente para se cadastrar. A taxa TAMÃO é apurada sobre pedidos concluídos, conforme a política comercial vigente.</p></details>
      <details><summary>O que acontece se eu aceitar e depois não conseguir entregar?</summary><p>O sistema pode iniciar uma tentativa de rescue antes da saída. Falhas depois do aceite afetam a experiência e devem ser evitadas mantendo preço, estoque e disponibilidade atualizados.</p></details>
      <details><summary>Posso vender além do P13?</summary><p>Sim. O catálogo suporta outros tamanhos de GLP e produtos como água, carvão, lenha e gelo, sujeitos às validações aplicáveis.</p></details>
    </div></section>

    <section class="section"><div class="soft-band"><div><span class="section-kicker">${internalPilot?'AMBIENTE INTERNO':'VAMOS CONVERSAR SOBRE SUA EMPRESA?'}</span><h2>${internalPilot?'Conheça a rotina operacional.':'Conte sobre sua empresa e a região que atende.'}</h2><p>${internalPilot?'Este ambiente é reservado à validação interna e não altera a operação pública.':'O cadastro não libera pedidos nem gera cobrança. Antes de vender, conferimos os dados da empresa e as autorizações exigidas.'}</p></div><button class="primary" onclick="${cta}">${internalPilot?ctaLabel:'Quero começar minha parceria →'}</button></div></section>
  </section>`)
}
function currentMerchantPilotInviteToken(){
  return String(globalThis.merchantPilotInviteToken?.()||'').trim();
}
function clearCurrentMerchantPilotInviteToken(){
  globalThis.clearMerchantPilotInviteToken?.();
}
function currentMerchantProspectInviteToken(){
  return String(globalThis.merchantProspectInviteToken?.()||'').trim();
}
function clearCurrentMerchantProspectInviteToken(){
  globalThis.clearMerchantProspectInviteToken?.();
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
  const prospectInvite=globalThis.merchantPortalRequested?.()?currentMerchantProspectInviteToken():'';
  const pilotInvite=prospectInvite?'':globalThis.merchantPortalRequested?.()?currentMerchantPilotInviteToken():'';
  const prospectDetails=prospectInvite?globalThis.merchantProspectInviteDetails?.():null;
  const ownApplication=globalThis.merchantOwnApplicationForInvite?.()||null;
  const ownStatus=String(ownApplication?.status||'');
  const ownNotice=ownStatus==='pending'
    ?'<div class="notice" style="margin-bottom:14px"><strong>Cadastro já recebido.</strong> '+esc(ownApplication.company_name||'Sua empresa')+' está aguardando análise. Você pode revisar e atualizar os dados sem abrir outro cadastro.</div>'
    :ownStatus==='rejected'
      ?'<div class="notice" style="margin-bottom:14px"><strong>Cadastro precisa de correção.</strong> Confira os dados e reenvie para nova análise.</div>'
      :ownStatus==='approved'
        ?'<div class="notice success" style="margin-bottom:14px"><strong>Cadastro aprovado.</strong> O recebimento de pedidos exige outras validações operacionais.</div>'
        :'';
  const prefillCnpj=String(prospectDetails?.cnpj||ownApplication?.cnpj||'');
  const prefillCompany=String(ownApplication?.company_name||prospectDetails?.companyName||'');
  return shell(`<section class="page"><button class="back" onclick="go('merchants')">← Para revendas</button><h1 class="page-title">Sua empresa tem lugar no TAMÃO.</h1><p class="muted">${globalThis.merchantPortalRequested?.()?'Conte um pouco sobre seu negócio. Nossa equipe poderá validar os dados e orientar a habilitação comercial.':'Acesse o portal de parceiros e comece o cadastro da sua empresa.'}</p>${pilotInvite?'<div class="notice success" style="margin-bottom:14px"><strong>Convite de parceiro reconhecido.</strong><br>Seus dados serão vinculados às condições comerciais já registradas. A operação continuará offline até aprovação, compliance, estoque e disponibilidade serem confirmados.</div>':''}${prospectInvite?'<div class="notice success" style="margin-bottom:14px"><strong>Convite de revenda reconhecido.</strong><br>Preencha os dados reais da empresa identificada na ANP. O cadastro será associado ao CNPJ convidado para análise, sem ativar vendas automaticamente.</div>':''}${ownNotice}<form class="card flat form-stack merchant-join-form" onsubmit="event.preventDefault();joinMerchant()" novalidate><div class="merchant-join-intro"><strong>Dados da empresa</strong><small>Preencha uma única vez. Você poderá corrigir os dados enquanto o cadastro estiver em análise.</small></div><div class="field-row"><div class="input-wrap"><label for="j-cnpj">CNPJ</label><input id="j-cnpj" name="cnpj" autocomplete="off" required aria-describedby="merchant-cnpj-hint" value="${esc(prefillCnpj)}" autocapitalize="characters" maxlength="18" class="input" placeholder="00.000.000/0000-00 ou alfanumérico"><small class="field-hint" id="merchant-cnpj-hint">Informe o CNPJ real da empresa, inclusive alfanumérico quando aplicável.</small></div><div class="input-wrap"><label for="j-name">Nome da empresa</label><input id="j-name" name="organization" autocomplete="organization" required value="${esc(prefillCompany)}" maxlength="90" class="input" placeholder="Nome da revenda"></div></div><div class="merchant-join-intro"><strong>Como falar com você</strong><small>O WhatsApp será usado para assuntos do cadastro e da operação.</small></div><div class="field-row"><div class="input-wrap"><label for="j-owner">Responsável</label><input id="j-owner" name="name" autocomplete="name" required value="${esc(ownApplication?.responsible_name||'')}" maxlength="90" class="input" placeholder="Nome do responsável"></div><div class="input-wrap"><label for="j-phone">WhatsApp</label><input id="j-phone" name="tel" type="tel" autocomplete="tel" required value="${esc(ownApplication?.phone||'')}" inputmode="tel" maxlength="20" class="input" placeholder="(55) 99999-9999"></div></div><div class="merchant-join-intro"><strong>Onde fica sua empresa</strong><small>Precisamos do endereço para conferir a região de atendimento.</small></div><div class="input-wrap"><label for="j-address">Endereço</label><input id="j-address" name="street-address" autocomplete="street-address" required value="${esc(ownApplication?.address_text||'')}" maxlength="160" class="input" placeholder="Endereço da empresa"></div><button class="primary" type="submit" ${ownStatus==='approved'?'disabled title="Empresa já aprovada"':''}>${ownStatus==='rejected'?'Reenviar meus dados corrigidos':ownStatus==='pending'?'Salvar meus dados atualizados':'Enviar cadastro da minha empresa →'}</button><small class="merchant-join-footer">Seu cadastro não gera cobrança nem coloca a revenda online automaticamente.</small></form><div class="notice" style="margin-top:14px">O cadastro não coloca a empresa online automaticamente. A operação entra nas ofertas somente depois da aprovação e, quando houver GLP, da validação regulatória aplicável.</div></section>`)
}
function onlyDigits(v){return String(v||'').replace(/\D/g,'')}
function isValidPhoneShape(v){const n=onlyDigits(v);return n.length===10||n.length===11}
function merchantJoinInvalid(id,message){
  const input=document.getElementById(id);
  if(input){input.setAttribute('aria-invalid','true');input.focus();}
  return toast(message);
}
async function joinMerchant(){
  const cnpj=document.querySelector('#j-cnpj')?.value.trim()||'';
  const name=document.querySelector('#j-name')?.value.trim()||'';
  const owner=document.querySelector('#j-owner')?.value.trim()||'';
  const phone=document.querySelector('#j-phone')?.value.trim()||'';
  const address=document.querySelector('#j-address')?.value.trim()||'';
  if(!isValidCnpjShape(cnpj))return merchantJoinInvalid('j-cnpj','Informe um CNPJ válido no formato atual');
  if(name.length<2)return merchantJoinInvalid('j-name','Informe o nome da empresa');
  if(owner.length<2)return merchantJoinInvalid('j-owner','Informe o nome do responsável');
  if(!isValidPhoneShape(phone))return merchantJoinInvalid('j-phone','Informe um WhatsApp válido com DDD');
  if(address.length<5)return merchantJoinInvalid('j-address','Informe o endereço da empresa');
  document.querySelectorAll('.merchant-join-form [aria-invalid="true"]').forEach(el=>el.removeAttribute('aria-invalid'));


  if(globalThis.merchantPortalRequested?.()){
    if(!globalThis.merchantRuntime?.session?.access_token)return toast('Entre com seu e-mail antes de enviar o cadastro');
    const submitBtn=document.querySelector('.merchant-join-form button[type="submit"]');
    if(submitBtn?.dataset.submitting==='true')return;
    const previousLabel=submitBtn?.textContent||'';
    if(submitBtn){submitBtn.dataset.submitting='true';submitBtn.disabled=true;submitBtn.textContent='Enviando cadastro…';}
    try{
      const prospectInviteToken=currentMerchantProspectInviteToken();
      const pilotInviteToken=prospectInviteToken?'':currentMerchantPilotInviteToken();
      const result=await merchantSubmitApplicationLive({
        cnpj,
        companyName:name.slice(0,90),
        responsibleName:owner.slice(0,90),
        phone,
        address:address.slice(0,160),
        ...(pilotInviteToken?{pilotInviteToken}:{}),
        ...(prospectInviteToken?{prospectInviteToken}:{})
      });
      toast(result?.prospectInvite?.linked?'Convite vinculado. Cadastro enviado para análise':result?.pilotPartner?.pilotPartnerName?'Cadastro vinculado e enviado para análise':'Cadastro enviado para análise');
      if(result?.pilotPartner)clearCurrentMerchantPilotInviteToken();
      if(result?.prospectInvite?.linked)clearCurrentMerchantProspectInviteToken();
      globalThis.merchantRuntime.notice=result?.pilotPartner?.pilotPartnerName
        ? 'Cadastro vinculado ao parceiro '+String(result.pilotPartner.pilotPartnerName)+'. Aguarde a aprovação e as validações operacionais.'
        : 'Cadastro '+String(result?.companyName||name)+' recebido. Aguarde a validação e o vínculo da operação.';
      go('merchant');
      render();
      return;
    }catch(e){
      toast(String(e?.message||e));
      return;
    }finally{
      if(submitBtn){submitBtn.dataset.submitting='false';submitBtn.disabled=false;submitBtn.textContent=previousLabel;}
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
