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
    <h1 class="page-title">Cada compra pode render mais vantagens para você.</h1>
    <p class="muted page-lead">Faça suas compras com tranquilidade e acompanhe no mesmo lugar o cashback conquistado, suas compras e os benefícios de sua rede de indicações.</p>
    <div class="reward-hero"><div class="tiny" style="opacity:.75">SEU CASHBACK DISPONÍVEL</div><div class="balance">${BRL.format(state.user.cashback)}</div><div class="tiny">crédito para usar em novas compras</div><div class="progress"><div style="width:${pct}%"></div></div><strong>${esc(next)}</strong></div>
    <div class="earn-summary" style="margin-top:14px">
      <div class="earn-balance-card"><span>Economia nas comparações</span><strong>${BRL.format(comparisonSavings)}</strong><small>diferença acumulada contra a opção mais cara realmente exibida nas consultas que viraram pedidos concluídos</small></div>
      <div class="earn-balance-card"><span>Cashback já gerado</span><strong>${BRL.format(cashbackEarned)}</strong><small>créditos válidos historicamente, mesmo que parte já tenha sido usada</small></div>
      <div class="earn-balance-card"><span>Cashback disponível</span><strong>${BRL.format(state.user.cashback)}</strong><small>saldo que pode reduzir uma próxima compra</small></div>
    </div>
    ${debt>0?`<div class="notice" style="margin-top:14px"><strong>${BRL.format(debt)} em compensação.</strong><br>Esse valor corresponde a cashback de uma compra posteriormente revertida. Novos créditos reduzem essa compensação antes de ficarem disponíveis.</div>`:''}
    <section class="section"><div class="grid cards-3">
      <div class="card"><div class="feature-icon">💵</div><h3>Cashback que volta para você</h3><p class="muted tiny">Nas compras elegíveis, parte do valor pode voltar como crédito para sua próxima compra. Tudo fica registrado em sua conta.</p></div>
      <div class="card"><div class="feature-icon">⭐</div><h3>Seus pedidos, suas vantagens</h3><p class="muted tiny">Tenha seu histórico à mão e saiba quando vale a pena repetir aquela compra do dia a dia.</p></div>
      <div class="card"><div class="feature-icon">🤝</div><h3>Sua rede também cresce</h3><p class="muted tiny">Convide amigos com seu link pessoal, apresente revendas da região e acompanhe as indicações qualificadas.</p><button class="ghost small" onclick="go('earn')">Ver como ganhar →</button></div>
    </div></section>
  </section>`)
}

function tamaoGrowthInviteUrl(audience='customer'){
  const code=String(state.user?.referralCode||'').trim().toUpperCase();
  const activeCode=/^[A-Z0-9]{5,40}$/.test(code)?code:'';
  const base='https://tamao.com.br/';
  return base+(activeCode?'?ref='+encodeURIComponent(activeCode):'')+
    (audience==='merchant'?'#merchants':'#home');
}
async function shareTamaoGrowthInvite(audience='customer'){
  const merchant=audience==='merchant';
  const url=tamaoGrowthInviteUrl(merchant?'merchant':'customer');
  const message=merchant
    ?'Conhece uma revenda que gostaria de vender mais? Veja como participar do TAMÃO: '+url
    :'Conheça o TAMÃO! Consulte gás, água e outros produtos na sua região: '+url;
  try{
    if(navigator.share){await navigator.share({title:'TAMÃO — Pediu? Tá na mão.',text:message,url});return;}
    if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(message);toast('Convite copiado para compartilhar');return;}
    toast('Compartilhe o endereço: '+url);
  }catch(e){if(e?.name!=='AbortError')toast('Não foi possível compartilhar; copie o endereço da página');}
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
    <h1 class="page-title">Seu próximo convite pode abrir novas portas.</h1>
    <p class="muted page-lead">Construa sua Rede TAMÃO no seu ritmo. Compartilhe seu link com amigos, apresente o aplicativo a quem precisa e acompanhe seus convidados e as compras qualificadas.</p>
    <div class="earn-summary">
      <div class="earn-balance-card"><span>Disponível</span><strong>${BRL.format(state.user.commissionAvailable)}</strong><small>saldo já liberado</small></div>
      <div class="earn-balance-card"><span>A liberar</span><strong>${BRL.format(state.user.commissionPending)}</strong><small>em validação</small></div>
      <div class="earn-balance-card"><span>Indicados</span><strong>${referredCount}</strong><small>novos usuários vinculados</small></div>
      <div class="earn-balance-card"><span>Qualificados</span><strong>${qualifiedReferralCount}</strong><small>com 1ª compra qualificada</small></div>
    </div>
    ${referralCard}
    ${identityCard}

    <section class="section"><div class="section-head"><div><span class="section-kicker">FAÇA UMA SIMULAÇÃO</span><h2>Veja como funciona a comissão de ${referralRateLabel}.</h2><p>Simule a recompensa de primeiras compras qualificadas e entenda as regras antes de compartilhar.</p></div></div>
      <div class="calculator-card">
        <div class="calculator-inputs">
          <div class="input-wrap"><label for="ref-sim-clients">Novos clientes com 1ª compra qualificada</label><input id="ref-sim-clients" class="input" type="number" inputmode="numeric" min="1" max="500" value="10" oninput="updateReferralSimulator()"></div>
          <div class="input-wrap"><label for="ref-sim-ticket">Valor médio da primeira compra (R$)</label><input id="ref-sim-ticket" class="input" type="number" inputmode="decimal" min="1" step="0.01" value="120" oninput="updateReferralSimulator()"></div>
        </div>
        <div class="calculator-result"><small>Resultado da simulação</small><strong id="ref-sim-total">${BRL.format(referralExample(120,10))}</strong><span id="ref-sim-detail">10 novos clientes × ${BRL.format(120)} × ${referralRateLabel}</span></div>
      </div>
      <div class="notice" style="margin-top:12px"><strong>Uma indicação qualificada faz a diferença.</strong><br>A comissão é calculada sobre a primeira compra válida do novo cliente indicado, após entrega, pagamento e validação. Compras posteriores não geram outra comissão de aquisição.</div>
    </section>

    <section class="section"><div class="section-head"><div><h2>Quando a indicação pode gerar comissão</h2></div></div><div class="how-grid">
      <div class="how-card"><span>1</span><div><strong>Compartilhe seu link</strong><p>Envie para quem realmente possa se interessar pelo TAMÃO.</p></div></div>
      <div class="how-card"><span>2</span><div><strong>O novo cliente faz a primeira compra válida</strong><p>Cadastro sozinho e compras posteriores do mesmo cliente não criam nova comissão.</p></div></div>
      <div class="how-card"><span>3</span><div><strong>A venda é concluída</strong><p>A entrega e o pagamento precisam ser confirmados.</p></div></div>
      <div class="how-card"><span>4</span><div><strong>A comissão é validada</strong><p>Depois da conferência de segurança e da validação das contas envolvidas, a comissão pode ser liberada.</p></div></div>
    </div></section>

    <div class="card flat payout-card"><div><span class="section-kicker">SUAS COMISSÕES</span><h3>Tudo acompanhado em um só lugar.</h3><p class="muted">Consulte o que está em validação e o que já foi liberado. Os meios de recebimento são informados na conta conforme a disponibilidade.</p></div></div>
  </section>`)
}

function growthNetworkIntro(){
  const authenticated=Boolean(state.user?.referralCode);
  return `<section class="section growth-network-intro" aria-label="Convide pessoas e revendas">
    <div class="section-head"><div><span class="section-kicker">REDE TAMÃO</span>
      <h2>Convide pessoas. Ajude sua cidade a ter mais opções.</h2>
      <p>Você pode compartilhar o TAMÃO com amigos ou apresentar uma revenda da sua região.</p></div></div>
    <div class="grid cards-3">
      <article class="card"><div class="feature-icon">🤝</div>
        <h3>Convide amigos</h3><p class="muted tiny">Mais pessoas podem conhecer e consultar o TAMÃO. Benefícios por indicação dependem das campanhas elegíveis.</p>
        <button class="secondary full" onclick="shareTamaoGrowthInvite('customer')">Compartilhar com amigos</button></article>
      <article class="card"><div class="feature-icon">🏪</div>
        <h3>Conhece uma revenda?</h3><p class="muted tiny">Apresente o TAMÃO a uma empresa. Ela poderá se cadastrar e atender clientes após as verificações necessárias.</p>
        <button class="primary full" onclick="shareTamaoGrowthInvite('merchant')">Convidar uma revenda</button></article>
      <article class="card"><div class="feature-icon">📋</div><h3>Acompanhe suas indicações</h3>
        <p class="muted tiny">${authenticated?'Seu link pessoal está disponível. Os benefícios financeiros só são liberados conforme as regras.':'Seu código pessoal aparece após entrar na sua conta. Compartilhamentos sem código não geram atribuição.'}</p>
        <button class="ghost full" onclick="go('refer')">Minhas indicações →</button></article>
    </div>
  </section>`;
}
function earn(){
  const merchantSample=merchantEconomicsExample(120);
  const referralRateLabel=policyPercent(referralPilotRate());
  const merchantFeeLabel=policyPercent(merchantPilotFeeRate());
  return shell(`<section class="page">
    <span class="eyebrow">REDE TAMÃO • COMPARTILHAR E CRESCER</span>
    <h1 class="page-title">Compre bem, compartilhe o que gosta e construa sua rede.</h1>
    <p class="muted page-lead">O TAMÃO aproxima quem compra, quem vende e quem indica. Descubra suas vantagens, convide amigos e ajude a criar mais oportunidades para a sua cidade.</p>
    <div class="conversion-mini-proof"><span>✓ Compra e indicação são diferentes</span><span>✓ Regras visíveis</span><span>✓ Sua rede, suas oportunidades</span></div>
    <nav class="tamao-cro-paths" aria-label="Escolha como participar da Rede TAMÃO">
      <button type="button" onclick="go('refer')"><span aria-hidden="true">🤝</span><strong>Quero indicar</strong><small>Compartilhe seu link e acompanhe indicações elegíveis.</small><b aria-hidden="true">→</b></button>
      <button type="button" onclick="go('club')"><span aria-hidden="true">🎁</span><strong>Quero meus benefícios</strong><small>Confira o que você conquistou e as condições de uso.</small><b aria-hidden="true">→</b></button>
      <button type="button" onclick="go('merchants')"><span aria-hidden="true">🏪</span><strong>Tenho uma empresa</strong><small>Conheça o canal de vendas para revendas locais.</small><b aria-hidden="true">→</b></button>
    </nav>
    ${growthNetworkIntro()}
    <section class="section tamao-customer-growth">
      <div class="section-head"><div><span class="section-kicker">O SEU JEITO DE PARTICIPAR</span>
        <h2>Compre quando precisar. Compartilhe quando fizer sentido.</h2>
        <p>Você não precisa ter uma empresa para ajudar o TAMÃO a crescer na sua região. Sua própria rede começa com um convite.</p></div></div>
      <div class="grid cards-3 tamao-value-grid">
        <article class="card"><span class="tamao-value-icon">🛍️</span><h3>Comprar fica mais simples</h3><p>Consulte as opções para seu endereço, confira preço e prazo e acompanhe pedidos confirmados pela revenda.</p></article>
        <article class="card"><span class="tamao-value-icon">👥</span><h3>Construa sua Rede TAMÃO</h3><p>Seu link pessoal permite convidar amigos e apresentar empresas. Veja suas indicações e quais tiveram a primeira compra qualificada.</p></article>
        <article class="card"><span class="tamao-value-icon">🎁</span><h3>Veja o que sua rede conquistou</h3><p>Encontre cashback e histórico de indicações em um só lugar. Benefícios seguem as regras de compras qualificadas, com dados claros para acompanhar.</p></article>
      </div>
      <div class="tamao-value-actions"><button type="button" class="secondary" onclick="go('refer')">Abrir minhas indicações →</button><button type="button" class="ghost" onclick="go('club')">Ver meus benefícios</button></div>
    </section>

    <div class="opportunity-grid main-opportunities">
      <article class="opportunity-card person-opportunity"><div class="opportunity-icon">🤝</div><span class="section-kicker">PARA QUEM GOSTA DE COMPARTILHAR</span><h2>Conhece alguém que gostaria de usar o TAMÃO?</h2><p>Compartilhe seu link pessoal, ajude mais gente a encontrar boas opções e acompanhe as indicações. Primeiras compras elegíveis podem gerar comissão após a validação.</p>
        <ul class="clean-list"><li>Política comercial atual: ${referralRateLabel} da primeira compra qualificada</li><li>Uma comissão de aquisição por novo cliente elegível</li><li>Saldo “a liberar” separado do saldo disponível</li><li>Nenhum pagamento por simples recrutamento</li></ul>
        <div class="opportunity-example"><small>Exemplo matemático</small><strong>R$ 120 × ${referralRateLabel} = ${BRL.format(referralExample(120))}</strong><span>Simulação para uma primeira compra elegível e validada, conforme a política comercial.</span></div>
        <button class="primary full" onclick="go('refer')">Conhecer as indicações →</button>
      </article>
      <article class="opportunity-card business-opportunity"><div class="opportunity-icon">🏪</div><span class="section-kicker">PARA QUEM JÁ TEM UM NEGÓCIO</span><h2>Sua empresa pode vender por mais um canal.</h2><p>Use o TAMÃO como um canal adicional para gás, água e outros itens, sem abandonar telefone, WhatsApp, balcão ou sua base atual de clientes.</p>
        <ul class="clean-list"><li>Você define preços, estoque e taxa de entrega</li><li>Escolhe quando ficar online</li><li>Decide se aceita cada pedido</li><li>Pode aumentar o ticket com vários produtos na mesma entrega</li></ul>
        <div class="opportunity-example"><small>Taxa sobre pedidos concluídos</small><strong>Taxa TAMÃO: ${merchantFeeLabel} por pedido concluído</strong><span>Ex.: R$ 120 bruto → ${BRL.format(merchantSample.fee)} de taxa → ${BRL.format(merchantSample.merchantNet)} antes dos custos próprios e impostos.</span></div>
        <button class="primary full" onclick="go('merchants')">Quero conhecer a parceria →</button>
      </article>
    </div>

    <section class="section"><div class="soft-band"><div><span class="section-kicker">SUAS VANTAGENS, DO SEU JEITO</span><h2>Mais de um motivo para fazer parte.</h2><p>O cashback de compras elegíveis ajuda na próxima compra; a Rede TAMÃO permite convidar clientes e empresas; e cada revenda continua recebendo diretamente por suas vendas. Tudo com condições claras, que você pode consultar antes de participar.</p></div><button class="secondary" onclick="go('learn')">Entender compra e segurança</button></div></section>
  </section>`)
}

function learn(){
  return shell(`<section class="page">
    <span class="eyebrow">COMO FUNCIONA O TAMÃO</span>
    <h1 class="page-title">Quer pedir gás, água ou outros itens? Veja como funciona.</h1>
    <p class="muted page-lead">Veja primeiro os produtos e escolha o que precisa. Na etapa de entrega, informe o CEP para conferir revendas, preço total e prazo antes de decidir.</p>
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

// V1.243 — honest sponsor discovery; no paid ads or funded Clube campaign is sold from this page.
// V1.301 — send partnership interest into the existing protected contact channel,
// without new storage, third-party redirects or a fake sponsor activation.
function openSponsorContact(){
  const focus=()=>{
    if(route()!=='contact')return;
    const type=document.getElementById('public-request-kind');
    if(type){type.value='sponsor';globalThis.contactKindChanged?.()}
    const message=document.getElementById('public-request-message');
    if(message&&!String(message.value||'').trim()){
      message.value='Tenho interesse em uma parceria de divulgação com o TAMÃO. Nossa marca atua em [cidade/região] e gostaríamos de conversar sobre objetivos, categorias e formatos disponíveis.';
    }
    document.querySelector('.public-contact-card')?.scrollIntoView({behavior:'smooth',block:'start'});
    document.getElementById('public-contact-name')?.focus({preventScroll:true});
  };
  if(route()!=='contact'){go('contact');setTimeout(focus,160);return}
  focus();
}
function sponsorsLanding(){
  return shell(`<section class="page tamao-sponsors-page">
    <div class="tamao-sponsor-hero tamao-commercial-hero">
      <span class="eyebrow">MARCAS E PARCEIROS • TAMÃO</span>
      <h1 class="page-title">Sua marca pode fazer parte das escolhas que movem a cidade.</h1>
      <p class="page-lead">Planeje campanhas regionais com propósito: apresente sua marca onde consumidores e revendas procuram soluções para o dia a dia. Cidade, público, formato e investimento são definidos com você antes de qualquer ativação.</p>
      <div class="conversion-mini-proof"><span>✓ Presença regional</span><span>✓ Campanhas desenhadas em conjunto</span><span>✓ Primeiro contato sem compromisso</span></div>
      <div class="tamao-value-actions">
        <button type="button" class="primary" onclick="openSponsorContact()">Quero apresentar minha marca →</button>
        <button type="button" class="secondary" onclick="go('merchants')">Conhecer as revendas</button>
      </div>
      <div class="tamao-cro-steps" aria-label="Como iniciar uma parceria de marca">
        <div><span>01</span><strong>Apresente sua marca</strong><small>Informe como podemos falar com você.</small></div>
        <div><span>02</span><strong>Escolha a região</strong><small>Conte onde e para quem deseja aparecer.</small></div>
        <div><span>03</span><strong>Defina a campanha</strong><small>Orçamento e critérios avaliados antes da ativação.</small></div>
      </div>
    </div>
    <section class="section">
      <div class="section-head"><div><span class="section-kicker">ONDE SUA MARCA PODE PARTICIPAR</span>
        <h2>Relevância é estar onde as boas escolhas acontecem.</h2>
        <p>A proposta é aproximar marcas, revendas e consumidores de uma forma útil para a cidade e sustentável para cada parceiro.</p></div></div>
      <div class="grid cards-3 tamao-value-grid">
        <article class="card"><span class="tamao-value-icon">📍</span><h3>Conexão com cada região</h3>
          <p>Explore oportunidades por município e categoria, respeitando a disponibilidade das revendas e a realidade dos consumidores locais.</p></article>
        <article class="card"><span class="tamao-value-icon">📣</span><h3>Divulgação identificada</h3>
          <p>Desenvolva com o TAMÃO ações de presença e divulgação regional. Os espaços patrocinados serão sempre identificados e separados da ordem orgânica das ofertas.</p></article>
        <article class="card"><span class="tamao-value-icon">🎁</span><h3>Benefícios que fazem sentido</h3>
          <p>Crie campanhas de benefício para aproximar sua marca dos consumidores e incentivar novas compras. As condições, os limites e o custeio são definidos antes de cada ativação.</p></article>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><div><span class="section-kicker">PARCERIA QUE RESPEITA SEU NEGÓCIO</span>
        <h2>Uma parceria feita para gerar valor dos dois lados.</h2>
        <p>Entenda como podemos desenhar juntos uma ação com público, cidade, orçamento e objetivos bem definidos.</p></div></div>
      <div class="tamao-journey">
        <div><strong>1. Conhecer seu objetivo</strong><p>Mais reconhecimento de marca, aproximação regional ou incentivo à recompra? Primeiro precisamos entender o que vale para sua empresa.</p></div>
        <div><strong>2. Construir condições realistas</strong><p>Definir público, cidade, limites de investimento, responsabilidades e critérios de avaliação, sem números ou resultados inventados.</p></div>
        <div><strong>3. Validar antes de ativar</strong><p>Conferimos as condições operacionais, financeiras e contratuais antes do início da campanha. Assim, cada parceiro sabe o que esperar.</p></div>
      </div>
    </section>
    <section class="section"><div class="card tamao-sponsor-footer">
      <span class="section-kicker">VAMOS CONVERSAR?</span>
      <h2>Boas parcerias começam com objetivos em comum.</h2>
      <p>Conte qual região e categoria interessam à sua marca. Nossa equipe ajuda a explorar formatos e condições de parceria que façam sentido para o seu negócio.</p>
      <button type="button" class="primary" onclick="openSponsorContact()">Conversar sobre divulgação →</button>
    </div></section>
  </section>`);
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
    <h1 class="page-title">Sua revenda, mais fácil de encontrar. <span class="headline-accent">Seu negócio, sempre nas suas mãos.</span></h1>
    <p class="muted page-lead">Faça do TAMÃO mais um canal para quem procura gás, água e essenciais na sua região. Prepare seu catálogo, organize pedidos e continue atendendo pelo balcão, telefone e WhatsApp. <strong>Você decide preços, estoque, formas de pagamento, disponibilidade e entrega.</strong></p>
    <div class="conversion-mini-proof"><span>✓ Sem exclusividade</span><span>✓ Recebimento direto na revenda</span><span>✓ Você decide quando ficar online</span></div>

    <div class="tamao-cro-steps merchant-cro-steps" aria-label="Como começar a vender pelo TAMÃO">
      <div><span>01</span><strong>Apresente sua revenda</strong><small>Cadastre a empresa e seu contato em poucos passos.</small></div>
      <div><span>02</span><strong>Prepare sua operação</strong><small>Revise produtos, entrega, recebimento e autorizações necessárias.</small></div>
      <div><span>03</span><strong>Receba pedidos elegíveis</strong><small>Após habilitação, confirme apenas os pedidos que puder atender.</small></div>
    </div>
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

    <section class="section"><div class="section-head"><div><span class="section-kicker">MAIS UM CANAL DE VENDAS</span><h2>Mais oportunidades chegam quando sua empresa está onde o cliente procura.</h2><p>Não é preciso mudar o jeito que sua revenda já vende. O TAMÃO acrescenta um caminho para o consumidor encontrá-la e consultar o que você realmente pode entregar.</p></div></div>
      <div class="grid cards-3 partner-benefits">
        <div class="card"><div class="feature-icon">📈</div><h3>Mais oportunidades de venda</h3><p class="muted tiny">Seja uma opção para quem consulta gás e itens essenciais na área atendida pela sua empresa.</p></div>
        <div class="card"><div class="feature-icon">🧺</div><h3>Mais valor em cada entrega</h3><p class="muted tiny">Apresente água, carvão, lenha, gelo e outros produtos compatíveis da sua loja na mesma jornada de compra.</p></div>
        <div class="card"><div class="feature-icon">🔁</div><h3>Clientes que podem voltar</h3><p class="muted tiny">O histórico de compras pode ajudar o cliente a lembrar quando está na hora de repor o que costuma pedir.</p></div>
      </div>
      <div class="merchant-no-lockin"><span>✓ Sem exclusividade</span><span>✓ Sem obrigação de aceitar</span><span>✓ Online/offline quando quiser</span><span>✓ Preço e estoque sob seu controle</span></div>
    </section>

    <section class="section merchant-business-intro">
      <div class="section-head"><div><span class="section-kicker">TAMÃO NEGÓCIOS</span>
      <h2>Pedidos, números e relacionamento no mesmo lugar.</h2>
      <p>Você administra a rotina e entende melhor o que acontece com as vendas do TAMÃO. Sem perder a autonomia do seu negócio.</p></div></div>
      <div class="grid cards-3 partner-benefits">
        <div class="card"><div class="feature-icon">🛒</div><h3>Venda do seu jeito</h3>
          <p class="muted tiny">Seus produtos, preços, estoque e entregas continuam sob seu controle. Novos pedidos chegam organizados ao painel.</p></div>
        <div class="card"><div class="feature-icon">📊</div><h3>Entenda seus resultados</h3>
          <p class="muted tiny">Acompanhe vendas concluídas, cancelamentos, reversões e produtos mais vendidos com dados da própria operação no TAMÃO.</p></div>
        <div class="card"><div class="feature-icon">📣</div><h3>Ajude mais gente a descobrir sua empresa</h3>
          <p class="muted tiny">Compartilhe seu link da Rede TAMÃO. Publicidade patrocinada e ferramentas Pro serão opções separadas quando estiverem disponíveis.</p></div>
      </div>
      <p class="tiny muted">A divulgação paga não altera a ordem orgânica das ofertas. Serviços adicionais ainda não estão disponíveis para contratação.</p>
    </section>

    <section class="section tamao-merchant-differentials">
      <div class="section-head"><div><span class="section-kicker">POR QUE FAZER PARTE</span>
        <h2>Sua revenda tem seu jeito. O TAMÃO respeita isso.</h2>
        <p>Mais um canal de vendas, sem exigir que você abra mão da clientela, das formas de receber ou dos produtos que já comercializa.</p></div></div>
      <div class="grid cards-3 tamao-value-grid">
        <article class="card"><span class="tamao-value-icon">💳</span><h3>O pagamento da venda é seu</h3>
          <p>O comprador paga diretamente à revenda pela forma oferecida. O TAMÃO não recebe o dinheiro do produto para depois repassar.</p></article>
        <article class="card"><span class="tamao-value-icon">📦</span><h3>Mais produtos na mesma conversa</h3>
          <p>Mostre água, carvão, lenha, gelo e os demais itens autorizados da sua operação. Uma cesta maior pode tornar cada entrega mais interessante.</p></article>
        <article class="card"><span class="tamao-value-icon">🤝</span><h3>Sua rede cresce com você</h3>
          <p>Compartilhe seu link, apresente clientes e outras revendas e acompanhe os interesses vinculados. Benefícios financeiros só são devidos quando houver campanha habilitada e conversão elegível.</p></article>
      </div>
      <div class="tamao-value-actions"><button type="button" class="secondary" onclick="go('sponsors')">Conhecer oportunidades com marcas →</button></div>
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
  return shell(`<section class="page"><button class="back" onclick="go('merchants')">← Para revendas</button><h1 class="page-title">Sua empresa tem lugar no TAMÃO.</h1><p class="muted">${globalThis.merchantPortalRequested?.()?'Conte um pouco sobre seu negócio. Nossa equipe poderá validar os dados e orientar a habilitação comercial.':'Acesse o portal de parceiros e comece o cadastro da sua empresa.'}</p>${pilotInvite?'<div class="notice success" style="margin-bottom:14px"><strong>Convite de parceiro reconhecido.</strong><br>Seus dados serão vinculados às condições comerciais já registradas. A operação continuará offline até aprovação, compliance, estoque e disponibilidade serem confirmados.</div>':''}${prospectInvite?'<div class="notice success" style="margin-bottom:14px"><strong>Convite de revenda reconhecido.</strong><br>Preencha os dados reais da empresa identificada na ANP. O cadastro será associado ao CNPJ convidado para análise, sem ativar vendas automaticamente.</div>':''}${ownNotice}<form class="card flat form-stack merchant-join-form" onsubmit="event.preventDefault();joinMerchant()" novalidate><div class="merchant-join-intro"><strong>Dados da empresa</strong><small>Preencha uma única vez. Você poderá corrigir os dados enquanto o cadastro estiver em análise.</small></div><div class="field-row"><div class="input-wrap"><label for="j-cnpj">CNPJ</label><input id="j-cnpj" name="cnpj" autocomplete="off" required aria-describedby="merchant-cnpj-hint" value="${esc(prefillCnpj)}" autocapitalize="characters" maxlength="18" class="input" placeholder="00.000.000/0000-00 ou alfanumérico"><small class="field-hint" id="merchant-cnpj-hint">Informe o CNPJ real da empresa, inclusive alfanumérico quando aplicável.</small></div><div class="input-wrap"><label for="j-name">Nome da empresa</label><input id="j-name" name="organization" autocomplete="organization" required value="${esc(prefillCompany)}" maxlength="90" class="input" placeholder="Nome da revenda"></div></div><div class="merchant-join-intro"><strong>Como falar com você</strong><small>O WhatsApp será usado para assuntos do cadastro e da operação.</small></div><div class="field-row"><div class="input-wrap"><label for="j-owner">Responsável</label><input id="j-owner" name="name" autocomplete="name" required value="${esc(ownApplication?.responsible_name||'')}" maxlength="90" class="input" placeholder="Nome do responsável"></div><div class="input-wrap"><label for="j-phone">WhatsApp</label><input id="j-phone" name="tel" type="tel" autocomplete="tel" required value="${esc(ownApplication?.phone||'')}" inputmode="tel" maxlength="20" class="input" placeholder="(55) 99999-9999"></div></div><div class="merchant-join-intro"><strong>Onde fica sua empresa</strong><small>Precisamos do endereço para conferir a região de atendimento.</small></div><div class="input-wrap"><label for="j-address">Endereço</label><input id="j-address" name="street-address" autocomplete="street-address" required value="${esc(ownApplication?.address_text||'')}" maxlength="160" class="input" placeholder="Endereço da empresa"></div><div class="input-wrap"><label for="j-referral-code">Código de quem apresentou o TAMÃO (opcional)</label><input id="j-referral-code" class="input" autocomplete="off" autocapitalize="characters" maxlength="40" value="${esc(typeof growthAttributionCode==='function'?growthAttributionCode():'')}" placeholder="Código do convite"><small class="field-hint">Quando você veio por um convite, o código pode aparecer automaticamente. Ele registra a origem do cadastro; benefícios dependem de validações e campanhas ativas.</small></div><button class="primary" type="submit" ${ownStatus==='approved'?'disabled title="Empresa já aprovada"':''}>${ownStatus==='rejected'?'Reenviar meus dados corrigidos':ownStatus==='pending'?'Salvar meus dados atualizados':'Enviar cadastro da minha empresa →'}</button><small class="merchant-join-footer">Seu cadastro não gera cobrança nem coloca a revenda online automaticamente.</small></form><div class="notice" style="margin-top:14px">O cadastro não coloca a empresa online automaticamente. A operação entra nas ofertas somente depois da aprovação e, quando houver GLP, da validação regulatória aplicável.</div></section>`)
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
  const referralCode=String(document.querySelector('#j-referral-code')?.value||'')
    .trim().toUpperCase();
  if(!isValidCnpjShape(cnpj))return merchantJoinInvalid('j-cnpj','Informe um CNPJ válido no formato atual');
  if(name.length<2)return merchantJoinInvalid('j-name','Informe o nome da empresa');
  if(owner.length<2)return merchantJoinInvalid('j-owner','Informe o nome do responsável');
  if(!isValidPhoneShape(phone))return merchantJoinInvalid('j-phone','Informe um WhatsApp válido com DDD');
  if(address.length<5)return merchantJoinInvalid('j-address','Informe o endereço da empresa');
  if(referralCode&&!/^[A-Z0-9]{5,40}$/.test(referralCode))
    return merchantJoinInvalid('j-referral-code','Confira o código de indicação.');
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
        ...(referralCode?{referralCode}:{}),
        ...(pilotInviteToken?{pilotInviteToken}:{}),
        ...(prospectInviteToken?{prospectInviteToken}:{})
      });
      toast(result?.growthReferral?.recorded===true
        ?'Cadastro recebido. A origem do convite foi registrada para análise.'
        :result?.prospectInvite?.linked?'Convite vinculado. Cadastro enviado para análise'
        :result?.pilotPartner?.pilotPartnerName?'Cadastro vinculado e enviado para análise'
        :'Cadastro enviado para análise');
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
