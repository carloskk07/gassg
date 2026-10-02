const PRELAUNCH_EXAMPLE_PRICES={
  P13:11990,P20:18990,P45:41990,WATER20:1590,CHARCOAL4:1990,WOOD:2490,ICE5:1250
};

function prelaunchExampleOffers(cart={P13:1}){
  let subtotal=0;
  for(const [code,qtyRaw] of Object.entries(cart||{})){
    const qty=Math.max(0,Math.trunc(Number(qtyRaw)||0));
    if(!qty)continue;
    const unit=PRELAUNCH_EXAMPLE_PRICES[code];
    if(!Number.isFinite(unit))continue;
    subtotal+=unit*qty;
  }
  if(subtotal<=0)return[];
  return [
    {id:'example-recommended',roles:['EXEMPLO','Recomendado'],total:(subtotal+300)/100,eta:18,etaMax:25,trust:97,isExample:true},
    {id:'example-cheapest',roles:['EXEMPLO','Mais barato'],total:subtotal/100,eta:30,etaMax:40,trust:94,isExample:true},
    {id:'example-fastest',roles:['EXEMPLO','Mais rápido'],total:(subtotal+500)/100,eta:12,etaMax:18,trust:98,isExample:true}
  ];
}

function exampleOfferCard(o){
  return `<article class="offer example-offer"><div class="best-badge">EXEMPLO — NÃO COMPRÁVEL</div><div class="offer-label">${esc(o.roles.join(' • '))}</div><div class="offer-main"><div><div class="offer-price">${BRL.format(o.total)}</div><div class="tiny muted">valor ilustrativo para visualizar a interface</div></div><div class="offer-eta">${o.eta}–${o.etaMax} min</div></div><div class="offer-meta"><span class="meta-chip">Reputação ${o.trust}/100</span><span class="meta-chip">Exemplo visual</span></div><button class="secondary full" style="margin-top:13px" disabled>Disponível quando houver parceiro real</button></article>`;
}

function prelaunchExampleSection(cart={P13:1}){
  return `<section class="section prelaunch-examples"><div class="section-head"><div><span class="section-kicker">DEMONSTRAÇÃO DO PRÉ-LANÇAMENTO</span><h2>Veja como será comparar as opções</h2><p>Os cards abaixo servem somente para mostrar a experiência. Não representam revendas nem preços reais e não podem gerar pedido.</p></div></div><div class="offer-stack">${prelaunchExampleOffers(cart).map(exampleOfferCard).join('')}</div></section>`;
}){
  return `<section class="section prelaunch-examples"><div class="section-head"><div><h2>Como as ofertas aparecerão</h2><p>Exemplos visuais. Não representam preços ou revendas reais e não geram pedido.</p></div></div><div class="offer-stack">${prelaunchExampleOffers(cart).map(exampleOfferCard).join('')}</div></section>`;
}

function customerProductName(code,p=products[code]){
  const kg=glpKgForProductCode(code);
  if(kg!==null)return kg===13?'Botijão de cozinha 13 kg':`Botijão de gás ${kg} kg`;
  return p?.name||code;
}
function customerProductMeta(code){
  const kg=glpKgForProductCode(code);
  if(kg!==null)return `GLP • ${code}`;
  return 'Item essencial';
}
async function startHomeOrder(){
  const el=document.querySelector('#home-address');
  const value=el?.value.trim()||'';
  if(value&&value.length<5)return toast('Informe um endereço válido ou deixe em branco para preencher depois');
  if(value)state.address=value.slice(0,160);
  state.cart=normalizeCart({});
  setCartProduct('P13',1);
  save();
  go('order');
}

function home(){
  const testDemo=globalThis.__CHAMA_TEST__===true;
  const ready=globalThis.liveReady?.()===true;
  const preview=!testDemo&&globalThis.prelaunchExamplesEnabled?.()===true;
  const market=globalThis.liveRuntime?.marketStatus||null;

  const p=testDemo?minPrice():null;
  const priceText=testDemo
    ? (p==null?'Indisponível':BRL.format(p))
    : preview
      ? 'Veja a experiência'
      : ready&&!market
        ? 'Consultar preço'
        : ready&&market?.realSupplyConfigured
          ? 'Consultar preço'
          : ready
            ? 'Chegando em breve'
            : 'Conectando…';

  const freshness=testDemo
    ? 'Ambiente isolado de teste automatizado'
    : preview
      ? 'Pré-lançamento em São Gabriel: conheça a experiência antes da abertura.'
      : ready&&!market
        ? 'Não foi possível confirmar o panorama geral agora. Informe seu endereço para consultar as opções diretamente.'
        : ready&&market?.realSupplyConfigured
          ? market?.availableNow
            ? 'Há parceiros elegíveis para consulta agora.'
            : 'Parceiros cadastrados; a disponibilidade é confirmada a cada consulta.'
          : ready
            ? 'Estamos formando a primeira rede de parceiros locais.'
            : globalThis.liveRuntime?.status==='unsafe-origin'
            ? 'Pré-lançamento nesta origem provisória.'
            : 'Conectando ao serviço.';

  const disabled=!testDemo&&!ready&&!preview;
  const eyebrow=testDemo
    ? '● TESTE AUTOMATIZADO'
    : preview
      ? '● PRÉ-LANÇAMENTO EM SÃO GABRIEL'
      : '● CHAMA SÃO GABRIEL';
  const primaryLabel=preview?'Ver como vou comprar':'Ver preços e prazos';

  return shell(`<section class="hero marketing-hero"><div class="hero-grid"><div>
    <span class="eyebrow">${eyebrow}</span>
    <h1>Seu gás, com preço e prazo antes de confirmar.</h1>
    <p>Informe onde quer receber, compare as opções disponíveis e acompanhe cada etapa até a entrega.</p>

    <div class="purchase-starter" aria-label="Iniciar compra de gás">
      <div class="starter-product"><div class="starter-product-icon">🔥</div><div><span class="starter-label">MAIS PROCURADO</span><strong>Botijão de cozinha 13 kg</strong><small>P13 • GLP</small></div><div class="starter-price"><small>CONSULTA</small><b>${priceText}</b></div></div>
      <label class="starter-address" for="home-address"><span>Onde entregar?</span><div><span aria-hidden="true">📍</span><input id="home-address" autocomplete="street-address" maxlength="160" placeholder="Digite seu endereço" value="${esc(state.address||'')}" ${disabled?'disabled':''}></div></label>
      <button class="primary starter-cta" onclick="startHomeOrder()" ${disabled?'disabled':''}>🔥 ${primaryLabel}</button>
      <small class="starter-footnote">${esc(freshness)}</small>
    </div>

    <div class="trust-row"><span class="trust-chip">✓ Total antes de pedir</span><span class="trust-chip">✓ Parceiro precisa aceitar</span><span class="trust-chip">✓ Entrega acompanhada</span></div>
  </div>
  <div class="hero-visual" aria-label="Resumo visual dos benefícios do Chama">
    <div class="visual-top"><span class="visual-dot"></span><strong>Compra sem adivinhação</strong><span class="visual-live">CHAMA</span></div>
    <div class="visual-product"><div class="visual-icon">🔥</div><div><strong>Botijão 13 kg</strong><small>Veja o total antes de pedir</small></div></div>
    <div class="visual-choice"><span><strong>Mais econômico</strong><small>Compare pelo total</small></span><span><strong>Mais rápido</strong><small>Compare pelo prazo</small></span></div>
    <div class="visual-status"><span class="visual-check">✓</span><div><strong>Parceiro confirmou</strong><small>Você só vê “A caminho” depois da saída confirmada.</small></div></div>
  </div></div></section>

<section class="section intent-section"><div class="section-head"><div><span class="section-kicker">ESCOLHA SEU CAMINHO</span><h2>Comprar vem primeiro. Os benefícios aparecem depois.</h2></div></div>
<div class="intent-grid">
  <button class="intent-card intent-primary" onclick="quickProduct('P13')" ${disabled?'disabled':''}><span class="intent-icon">🔥</span><span><strong>Quero pedir agora</strong><small>Compare preço total e prazo de entrega.</small></span><b>→</b></button>
  <button class="intent-card" onclick="go('learn')"><span class="intent-icon">🛡️</span><span><strong>Quero entender melhor</strong><small>Veja como compra, pagamento e entrega funcionam.</small></span><b>→</b></button>
  <button class="intent-card" onclick="go('earn')"><span class="intent-icon">🤝</span><span><strong>Quero ganhar ou vender</strong><small>Conheça indicação e parceria para empresas.</small></span><b>→</b></button>
</div></section>

<section class="section"><div class="protection-band"><div class="protection-icon">🛡️</div><div><span class="section-kicker light">PROTEÇÃO CHAMA</span><h2>Se uma entrega falhar antes de sair, o pedido não fica simplesmente abandonado.</h2><p>O Chama pode procurar outra opção elegível. Se a alternativa aumentar o total, você precisa aceitar o novo valor antes da troca.</p></div><button class="secondary dark-secondary" onclick="go('learn')">Como funciona</button></div></section>

<section class="section value-proof-section"><div class="section-head"><div><span class="section-kicker">POR QUE USAR O CHAMA</span><h2>As respostas principais aparecem antes de você decidir.</h2></div></div>
<div class="value-proof-grid">
  <article class="value-proof"><span>01</span><div><strong>Quanto vai custar?</strong><p>Veja o valor total da opção antes de criar o pedido.</p></div></article>
  <article class="value-proof"><span>02</span><div><strong>Quanto vai demorar?</strong><p>Compare a previsão de entrega e escolha pelo que importa para você.</p></div></article>
  <article class="value-proof"><span>03</span><div><strong>Quem confirmou?</strong><p>O parceiro precisa aceitar. Depois você acompanha preparação, saída e chegada.</p></div></article>
</div></section>

<section class="section"><div class="section-head"><div><span class="section-kicker">COMO FUNCIONA</span><h2>Da consulta até a sua porta</h2><p>Quatro passos claros, sem transformar um pedido enviado em entrega prometida.</p></div><button class="ghost small desktop-only" onclick="go('learn')">Ver detalhes →</button></div>
<div class="how-grid">
  <div class="how-card"><span>1</span><div><strong>Escolha o que precisa</strong><p>Gás, água, carvão, lenha, gelo ou uma cesta com vários itens.</p></div></div>
  <div class="how-card"><span>2</span><div><strong>Informe onde entregar</strong><p>O Chama procura opções capazes de atender sua cesta.</p></div></div>
  <div class="how-card"><span>3</span><div><strong>Compare e escolha</strong><p>Veja total e previsão de entrega antes de confirmar.</p></div></div>
  <div class="how-card"><span>4</span><div><strong>Acompanhe até receber</strong><p>Você vê quando o parceiro aceita, prepara, sai e conclui a entrega.</p></div></div>
</div></section>

<section class="section"><div class="section-head"><div><span class="section-kicker">MAIS QUE GÁS</span><h2>Complete o que está faltando em casa.</h2><p>Você também pode pedir itens disponíveis sem colocar gás na cesta.</p></div></div>
<div class="quick-grid">${Object.entries(products).map(([k,p])=>`<button class="quick-card" onclick="quickProduct('${k}')" ${disabled?'disabled':''}><div class="quick-icon">${p.icon}</div><div class="quick-title">${esc(customerProductName(k,p))}</div><div class="quick-sub">${preview?'Ver experiência':'Consultar agora'}</div></button>`).join('')}</div></section>

${preview?prelaunchExampleSection({P13:1}):''}

<section class="section"><div class="section-head"><div><span class="section-kicker">CONFIANÇA NA ENTREGA</span><h2>O status só avança quando existe confirmação.</h2></div></div>
<div class="grid cards-3">
  <div class="card feature-card"><div class="feature-icon">🛡️</div><h3>Parceiro apto para a cesta</h3><p>Uma oferta real só aparece quando a operação atende os critérios aplicáveis aos produtos e à entrega.</p></div>
  <div class="card feature-card"><div class="feature-icon">📍</div><h3>“A caminho” significa saída</h3><p>Esse status só aparece depois que o parceiro confirma que o pedido realmente saiu.</p></div>
  <div class="card feature-card"><div class="feature-icon">🔐</div><h3>Entrega com código</h3><p>A conclusão exige pagamento confirmado e o código de recebimento do pedido.</p></div>
</div></section>

<section class="section"><div class="opportunity-band"><div><span class="section-kicker light">DEPOIS DA COMPRA</span><h2>Economize comprando. Receba comissão indicando. Venda com sua empresa.</h2><p>Cashback, comissão por indicação e receita da revenda são coisas diferentes — o Chama mostra cada uma separadamente.</p></div><div class="opportunity-actions"><button class="primary light-primary" onclick="go('club')">Ver benefícios de compra</button><button class="secondary dark-secondary" onclick="go('earn')">Indicação ou parceria</button></div></div></section>

<section class="section"><div class="section-head"><div><span class="section-kicker">PARA EMPRESAS LOCAIS</span><h2>Já vende gás, água, carvão, lenha, gelo ou outros itens?</h2><p>Use o Chama como um canal adicional de vendas sem abrir mão do controle da sua operação.</p></div></div><div class="merchant-home-card"><div><span class="merchant-home-rate">7,5%</span><small>taxa inicial do piloto por pedido concluído</small></div><div><strong>Você define preço, estoque e disponibilidade.</strong><p>Também decide se aceita cada pedido e pode ficar offline quando não quiser receber novas vendas.</p></div><button class="primary" onclick="go('merchants')">Ver parceria e custos</button></div></section>`)
}
function orderPage(){
  const testDemo=globalThis.__CHAMA_TEST__===true;
  const liveMode=globalThis.liveRequested?.()===true;
  const ready=globalThis.liveReady?.()===true;
  const preview=!testDemo&&globalThis.prelaunchExamplesEnabled?.()===true;
  const hasAddress=!!state.address;
  const hasItems=hasCartItems();
  const os=testDemo?(hasItems?offers():[]):(ready?(liveRuntime.offers||[]):[]);
  const pendingOrder=testDemo
    ? state.orders.find(isLiveOrder)
    : (liveRuntime.order&&!['SETTLED','CANCELLED'].includes(liveRuntime.order.status)?liveRuntime.order:null);

  let liveNotice='';
  if(!testDemo&&preview){
    liveNotice='<div class="notice" style="margin-bottom:14px"><strong>Pré-lançamento.</strong><br>Você pode percorrer a experiência, mas os cards marcados como EXEMPLO não criam pedido nem cobrança.</div>';
  }else if(!testDemo&&liveMode&&!ready){
    const message=liveRuntime?.status==='loading'
      ? 'Preparando a consulta…'
      : liveRuntime?.status==='unsafe-origin'
        ? 'Compras reais ainda não estão liberadas nesta versão de pré-lançamento.'
        : 'O serviço de pedidos está indisponível agora. Nenhum pedido foi criado.';
    liveNotice=`<div class="notice ${liveRuntime?.status==='unavailable'?'danger':''}" style="margin-bottom:14px"><strong>Compra online</strong><br>${esc(message)}</div>`;
  }

  let offerBlock='';
  if(hasItems&&hasAddress){
    if(preview){
      offerBlock=`<div class="offer-stack">${prelaunchExampleOffers(state.cart).map(exampleOfferCard).join('')}</div>`;
    }else if(testDemo&&os.length){
      offerBlock=`<div class="offer-stack">${os.map(offerCard).join('')}</div>`;
    }else if(ready&&liveRuntime.loadingOffers){
      offerBlock='<div class="empty card">Procurando opções para sua cesta…</div>';
    }else if(ready&&liveRuntime.error){
      offerBlock=`<div class="notice danger"><strong>Não foi possível atualizar as opções.</strong><br>${esc(liveRuntime.error)}<br><button class="secondary small" style="margin-top:10px" onclick="liveRefreshOffers().catch(()=>{})">Tentar novamente</button></div>`;
    }else if(ready&&os.length){
      offerBlock=`<div class="offer-stack">${os.map(offerCard).join('')}</div>`;
    }else if(ready&&liveRuntime.deliveryCompatibilityBlocked){
      offerBlock='<div class="notice"><strong>Não encontramos uma operação habilitada para entregar esta combinação de itens agora.</strong><br>Se precisar com urgência, tente separar o GLP dos demais produtos ou consulte novamente depois.</div>';
    }else if(ready&&liveRuntime.lastSyncAt){
      offerBlock='<div class="empty card">Nenhum parceiro consegue atender esta cesta agora.</div>';
    }else if(ready){
      offerBlock='<div class="empty card"><button class="primary" onclick="liveRefreshOffers().catch(()=>{})">Procurar opções</button></div>';
    }else{
      offerBlock='<div class="empty card">Não foi possível consultar as opções agora.</div>';
    }
  }

  const paymentBlock=preview
    ? '<div class="notice">Forma de pagamento e cashback serão habilitados somente quando houver uma oferta real.</div>'
    : `<div class="card flat form-stack"><div class="input-wrap"><label for="payment-method">Como você pretende pagar?</label><select id="payment-method" class="input" onchange="setPaymentMethod(this.value)"><option value="pix" ${state.checkout.paymentMethod==='pix'?'selected':''}>Pix</option><option value="card" ${state.checkout.paymentMethod==='card'?'selected':''}>Cartão</option><option value="cash" ${state.checkout.paymentMethod==='cash'?'selected':''}>Dinheiro</option></select><small class="field-help">A forma escolhida aparece junto da opção antes de você confirmar.</small></div>${state.user.cashback>0?`<label class="check-row"><input type="checkbox" ${state.checkout.useCashback?'checked':''} onchange="toggleCashback(this.checked)"><span><strong>Usar cashback</strong><small>Saldo disponível: ${BRL.format(state.user.cashback)}</small></span></label>`:''}</div>`;

  return shell(`<section class="page"><button class="back" onclick="go('home')">← Voltar</button><span class="eyebrow">PEDIR AGORA</span><h1 class="page-title">O que você precisa e onde devemos entregar?</h1><p class="muted page-lead">Depois do endereço, você compara total e prazo antes de escolher.</p>
${liveNotice}
${pendingOrder?`<div class="notice" style="margin-bottom:14px"><strong>Você já possui um pedido em andamento.</strong><br>Conclua ou cancele o pedido ${esc(pendingOrder.publicCode||pendingOrder.id)} antes de criar outro.<br><button class="ghost small" onclick="go('tracking')">Acompanhar pedido →</button></div>`:''}
<div class="card flat form-stack order-address-card"><div class="input-wrap"><label for="address">Endereço de entrega</label><input id="address" class="input" autocomplete="street-address" maxlength="160" placeholder="Ex.: Rua General Câmara, 123" value="${esc(state.address||'')}"></div><button class="primary" onclick="setAddress()">${hasAddress?'Atualizar endereço':'Usar este endereço'}</button><small class="field-help">Usamos o endereço para procurar quem consegue atender sua cesta.</small></div>
<section class="section"><div class="section-head"><div><h2>Sua cesta</h2><p>Adicione somente o que você precisa. Gás não é obrigatório para comprar os demais itens.</p></div></div><div class="card flat">${Object.entries(products).map(([k,p])=>cartRow(k,p)).join('')}</div></section>
${hasItems&&hasAddress?`<section class="section"><div class="section-head"><div><h2>Como pretende pagar</h2><p>${preview?'Prévia visual sem cobrança.':'Escolha a forma e confira novamente antes do pedido.'}</p></div></div>${paymentBlock}</section><section class="section"><div class="section-head"><div><span class="section-kicker">COMPARE ANTES DE PEDIR</span><h2>${preview?'Veja como as opções aparecerão':'Preço total e prazo lado a lado'}</h2><p>${preview?'Os valores abaixo são somente ilustrativos.':'Escolha a opção que faz mais sentido para você.'}</p></div></div><div class="mini-protection">🛡️ <strong>Proteção Chama:</strong> o parceiro precisa aceitar e qualquer alternativa mais cara depende da sua aprovação.</div>${offerBlock}</section>`:hasItems&&!hasAddress?'<div class="notice">Informe o endereço para ver preço e prazo.</div>':!hasItems?'<div class="notice">Adicione pelo menos um produto para consultar as opções.</div>':''}</section>`)
}
function cartRow(k,p){
  const q=state.cart[k]||0;
  const label=customerProductName(k,p);
  return `<div class="cart-item"><div class="product-left"><div class="product-icon">${p.icon}</div><div><strong>${esc(label)}</strong><div class="tiny muted">${esc(customerProductMeta(k))}</div></div></div><div class="qty" aria-label="Quantidade de ${esc(label)}"><button aria-label="Diminuir" onclick="qty('${k}',-1)">−</button><strong>${q}</strong><button aria-label="Aumentar" onclick="qty('${k}',1)">+</button></div></div>`
}
function offerCard(o){
  const recommended=o.roles.includes('Recomendado');
  const discount=state.checkout.useCashback?Math.min(state.user.cashback,o.total):0;
  const payable=roundMoney(o.total-discount);
  const labels=o.roles.join(' • ');
  const etaEnd=o.etaMax??(o.eta+7);
  const distanceChip=o.distance!=null?`<span class="meta-chip">${Number(o.distance).toFixed(1)} km</span>`:'';
  return `<article class="offer ${recommended?'selected':''}">${recommended?'<div class="best-badge">MELHOR EQUILÍBRIO</div>':''}<div class="offer-label">${esc(labels)}</div><div class="offer-main"><div><div class="offer-price">${BRL.format(payable)}</div><div class="tiny muted">${discount>0?`estimativa após ${BRL.format(discount)} de cashback`:'total com entrega'}</div></div><div class="offer-eta"><strong>${o.eta}–${etaEnd} min</strong><small>previsão</small></div></div><div class="offer-meta">${distanceChip}<span class="meta-chip">✓ Operação elegível</span><span class="meta-chip">Parceiro local verificado</span><span class="meta-chip">Confiança ${o.trust}/100</span><span class="meta-chip">Pagamento: ${esc(paymentLabel(state.checkout.paymentMethod))}</span></div><div class="offer-assurance">🔒 O nome do parceiro aparece após o aceite real. Se for necessária uma alternativa mais cara, você decide antes.</div><button class="${recommended?'primary':'secondary'} full" style="margin-top:13px" onclick="checkout('${o.id}')" ${globalThis.liveRuntime?.actionPending?'disabled':''}>Pedir por ${BRL.format(payable)}</button></article>`
}
async function setAddress(){
  const el=document.querySelector('#address');
  const value=el?.value.trim()||'';
  if(value.length<5)return toast('Informe um endereço válido');
  state.address=value.slice(0,160);save();
  if(globalThis.liveReady?.()&&hasCartItems()){
    try{await liveRefreshOffers({silent:true})}catch{}
  }
  render();
  setTimeout(()=>document.querySelector('.offer-stack')?.scrollIntoView({behavior:'smooth'}),100);
}
function qty(k,d){
  setCartProduct(k,(state.cart[k]||0)+d);
  if(globalThis.liveRequested?.()){
    liveRuntime.offers=[];
    liveRuntime.deliveryCompatibilityBlocked=false;
  }
  save();
  render();
  globalThis.liveScheduleOfferRefresh?.();
}
function quickProduct(k){state.cart=normalizeCart({});setCartProduct(k,1);go('order')}
function setPaymentMethod(v){state.checkout.paymentMethod=['pix','card','cash'].includes(v)?v:'pix';save();render()}
function toggleCashback(v){state.checkout.useCashback=Boolean(v);save();render()}

async function checkout(mid){
  if(globalThis.liveRequested?.()){
    if(!globalThis.liveReady?.())return toast('O serviço de pedidos ainda não está disponível');
    await liveCreateOrder(mid);
    return;
  }
  const result=createOrderForMerchant(mid);
  if(!result.ok){toast(result.error);render();return}
  go('tracking');
  setTimeout(()=>toast('Pedido enviado para confirmação da revenda'),30);
}
const statusCopy={
  CREATED:['Pedido recebido','Recebemos os dados do pedido.'],
  QUOTE_LOCKED:['Preço protegido','O total deste pedido foi congelado.'],
  OFFERED_TO_MERCHANT:['Aguardando revenda','A revenda precisa confirmar que realmente vai atender.'],
  MERCHANT_ACCEPTED:['Revenda confirmou ✓','O pedido possui compromisso real de atendimento.'],
  PREPARING:['Em preparação','Itens reservados e entrega sendo preparada.'],
  AT_RISK:['Acompanhamento prioritário','Detectamos risco de atraso e estamos acompanhando.'],
  REASSIGNING:['Buscando outra revenda','A primeira opção não conseguiu continuar.'],
  REQUOTE_REQUIRED:['Sua confirmação é necessária','Encontramos outra opção com condição diferente.'],
  OUT_FOR_DELIVERY:['A caminho ✓','A revenda confirmou efetivamente a saída.'],
  ARRIVING:['Chegando','O entregador está próximo do endereço.'],
  DELIVERED:['Entregue ✓','Recebimento confirmado com prova de entrega.'],
  SETTLED:['Concluído','Pedido e benefícios foram conciliados.'],
  CANCELLED:['Cancelado','O pedido não será entregue.']
};

function liveTracking(){
  if(!globalThis.liveReady?.()){
    const message=liveRuntime?.status==='loading'
      ? 'Preparando a consulta…'
      : 'Não foi possível abrir sua sessão de compra agora.';
    return shell(`<section class="page"><h1 class="page-title">Seu pedido</h1><div class="notice ${liveRuntime?.status==='unavailable'?'danger':''}">${esc(message)}</div></section>`);
  }

  const o=liveRuntime.order;
  if(!o){
    return shell(`<section class="page"><h1 class="page-title">Seu pedido</h1><div class="empty card">Você ainda não possui um pedido real neste navegador.<br><br><button class="primary" onclick="quickProduct('P13')">Consultar ofertas</button></div></section>`);
  }

  const copy=statusCopy[o.status]||[o.status,''];
  const active=!['SETTLED','CANCELLED'].includes(o.status);
  const deadline=['OFFERED_TO_MERCHANT','REQUOTE_REQUIRED'].includes(o.status)&&o.offerExpiresAt
    ? Math.max(0,Math.ceil((Date.parse(o.offerExpiresAt)-Date.now())/1000))
    : null;
  const total=Number(o.totalCents||0)/100;
  const cashbackReserved=Number(o.cashbackReservedCents||0)/100;
  const proposed=o.proposedTotalCents==null?null:Number(o.proposedTotalCents)/100;
  const items=(o.items||[]).map(i=>`<div class="list-row"><span>${Number(i.quantity)}× ${esc(i.product_name||i.productName||i.product_code||'Item')}</span><strong>${BRL.format(Number(i.line_total_cents??i.lineTotalCents??0)/100)}</strong></div>`).join('');

  return shell(`<section class="page"><button class="back" onclick="go('home')">← Início</button>
<div class="status-bar"><div><div class="tiny muted">PEDIDO ${esc(o.publicCode||o.orderId)}</div><h1 class="page-title" style="margin-bottom:3px">${esc(copy[0])}</h1></div><span class="status-pill ${['OUT_FOR_DELIVERY','ARRIVING','SETTLED','DELIVERED'].includes(o.status)?'online':o.status==='CANCELLED'?'offline':'risk'}">${o.status==='SETTLED'?'CONCLUÍDO':o.status==='CANCELLED'?'ENCERRADO':'AO VIVO'}</span></div>

<div class="card flat"><div class="price-lock"><span>🔒</span><div><strong>Preço protegido: ${BRL.format(total)}</strong><br>${cashbackReserved>0?`Inclui ${BRL.format(cashbackReserved)} de cashback reservado. `:''}O valor só muda com seu aceite explícito.</div></div>
<div class="divider"></div>
<div class="list-row"><div><strong>${o.supplierName?esc(o.supplierName):'Fornecedor em confirmação'}</strong><br><small>${o.supplierName?'Revenda que aceitou o pedido':'A identidade permanece oculta até o aceite real'}</small></div><div style="text-align:right"><strong>${BRL.format(total)}</strong><br><small>${esc(o.address||'')}</small></div></div>
<div class="list-row"><span>Pagamento</span><strong>${paymentLabel(o.paymentMethod)}</strong></div>
${items?'<div class="divider"></div>'+items:''}</div>

${o.status==='OFFERED_TO_MERCHANT'?`<div class="notice" style="margin-top:14px"><strong>Aguardando aceite real.</strong><br>A revenda tem até 3 minutos para responder. ${deadline!=null?`Prazo restante aproximado: ${deadline}s.`:''}</div>`:''}
${o.status==='REQUOTE_REQUIRED'&&proposed!=null?`<div class="notice" style="margin-top:14px"><strong>Encontramos outra opção.</strong><br>Novo total: ${BRL.format(proposed)}. Nada muda sem sua autorização. ${deadline!=null?`Esta condição expira em aproximadamente ${deadline}s.`:''}<div class="order-actions"><button class="primary small" onclick="confirmRequote('${o.orderId}')" ${liveRuntime.actionPending?'disabled':''}>Aceitar novo total</button><button class="secondary small" onclick="cancelPending('${o.orderId}')" ${liveRuntime.actionPending?'disabled':''}>Cancelar pedido</button></div></div>`:''}
${o.status==='CANCELLED'?'<div class="notice danger" style="margin-top:14px">Este pedido foi encerrado. Cashback reservado, se houver, é devolvido pelo ledger.</div>':''}
${o.financialState==='reversed'?'<div class="notice danger" style="margin-top:14px"><strong>Liquidação financeira revertida.</strong><br>A entrega permanece no histórico, mas cashback, comissão de indicação e recebível da plataforma foram estornados.'+(o.financialReversalReason?' Motivo: '+esc(o.financialReversalReason)+'.':'')+'</div>':''}
${o.riskReason&&o.status!=='CANCELLED'?`<div class="notice danger" style="margin-top:14px"><strong>Acompanhamento prioritário.</strong><br>${esc(o.riskReason)}</div>`:''}

<section class="section"><div class="section-head"><div><h2>Linha do tempo</h2><p>Atualizações confirmadas da operação.</p></div><button class="ghost small" onclick="liveGetOrder().catch(()=>{})">Atualizar</button></div><div class="card flat timeline">${liveEventTimeline(o)}</div></section>
${o.deliveryPin&&['OUT_FOR_DELIVERY','ARRIVING'].includes(o.status)?`<div class="notice success"><strong>PIN de recebimento: ${esc(o.deliveryPin)}</strong><br>Informe este código somente quando o pedido estiver na sua frente.</div>`:''}
${active&&['OFFERED_TO_MERCHANT','REQUOTE_REQUIRED'].includes(o.status)?`<button class="ghost full" style="margin-top:10px" onclick="cancelPending('${o.orderId}')" ${liveRuntime.actionPending?'disabled':''}>Cancelar antes do aceite</button>`:''}
${active&&['PREPARING','AT_RISK'].includes(o.status)?`<button class="danger-btn full" style="margin-top:10px" onclick="cancelBeforeDispatch('${o.orderId}')" ${liveRuntime.actionPending?'disabled':''}>Cancelar antes da saída</button>`:''}
<div class="card flat" style="margin-top:14px"><strong>Suporte do piloto</strong><p class="muted tiny">O pedido real já é auditável; o canal humano de incidentes será conectado antes da abertura pública.</p></div>
</section>`);
}

function liveEventTimeline(o){
  const events=o.events||[];
  if(!events.length)return '<div class="muted tiny">Nenhum evento registrado.</div>';
  return events.map((e,i)=>`<div class="event ${i<events.length-1?'done':'current'}"><div class="event-dot"><span class="dot"></span></div><div><div class="event-title">${esc(e.title||e.type||'Evento')}</div><div class="event-time">${e.createdAt?hhmm(new Date(e.createdAt)):'—'}</div><div class="event-desc">${esc(e.detail||'')}</div></div></div>`).join('');
}

function tracking(){
  if(globalThis.liveRequested?.())return liveTracking();
  const o=activeOrder();
  if(!o)return shell(`<section class="page"><h1 class="page-title">Seu pedido</h1><div class="empty card">Você ainda não possui pedidos. <br><br><button class="primary" onclick="quickProduct('P13')">Pedir gás</button></div></section>`);
  const merchantVisible=Boolean(o.supplierSnapshot)&&['PREPARING','OUT_FOR_DELIVERY','ARRIVING','DELIVERED','SETTLED','AT_RISK'].includes(o.status);
  const copy=statusCopy[o.status]||[o.status,''];
  const live=isLiveOrder(o);
  const deadline=o.status==='OFFERED_TO_MERCHANT'?Math.max(0,Math.ceil((Date.parse(o.offerExpiresAt)-Date.now())/1000)):null;
  return shell(`<section class="page"><button class="back" onclick="go('home')">← Início</button><div class="status-bar"><div><div class="tiny muted">PEDIDO ${esc(o.id)}</div><h1 class="page-title" style="margin-bottom:3px">${esc(copy[0])}</h1></div><span class="status-pill ${['OUT_FOR_DELIVERY','ARRIVING','SETTLED','DELIVERED'].includes(o.status)?'online':o.status==='CANCELLED'?'offline':'risk'}">${['SETTLED','DELIVERED'].includes(o.status)?'CONCLUÍDO':o.status==='CANCELLED'?'ENCERRADO':'AO VIVO'}</span></div>
<div class="card flat"><div class="price-lock"><span>🔒</span><div><strong>Total protegido: ${BRL.format(o.lockedTotal)}</strong><br>${o.cashbackReserved>0?`Inclui ${BRL.format(o.cashbackReserved)} de cashback reservado. `:''}Se for necessária uma opção mais cara, você precisa aprovar antes.</div></div><div class="divider"></div><div class="list-row"><div><strong>${merchantVisible?esc(o.supplierSnapshot.name):'Parceiro em confirmação'}</strong><br><small>${merchantVisible?'Parceiro confirmado':'O nome aparece depois que o pedido for aceito'}</small></div><div style="text-align:right"><strong>${BRL.format(o.total)}</strong><br><small>${esc(o.address)}</small></div></div><div class="list-row"><span>Pagamento</span><strong>${paymentLabel(o.paymentMethod)}</strong></div></div>

${o.status==='OFFERED_TO_MERCHANT'?`<div class="notice" style="margin-top:14px"><strong>Aguardando o parceiro confirmar.</strong><br>Se não houver resposta dentro da janela do pedido, o Chama procura outra opção automaticamente. ${deadline!=null?`Tempo aproximado restante: ${deadline}s.`:''}</div>`:''}
${o.status==='REQUOTE_REQUIRED'?`<div class="notice" style="margin-top:14px"><strong>Encontramos outra opção.</strong><br>Novo total: ${BRL.format(o.proposedTotal)}. Nada muda sem sua autorização.<div class="order-actions"><button class="primary small" onclick="confirmRequote('${o.id}')">Aceitar novo total</button><button class="secondary small" onclick="cancelPending('${o.id}')">Cancelar pedido</button></div></div>`:''}
${o.status==='CANCELLED'?`<div class="notice danger" style="margin-top:14px">Este pedido foi encerrado. Cashback reservado, se houver, foi devolvido.</div>`:''}
${o.riskReason&&o.status!=='CANCELLED'?`<div class="notice danger" style="margin-top:14px"><strong>Estamos acompanhando este pedido.</strong><br>${esc(o.riskReason)}. O status só muda quando houver uma nova confirmação.</div>`:''}

<section class="section"><div class="section-head"><div><h2>Acompanhe a entrega</h2><p>Cada etapa aparece somente depois da respectiva confirmação.</p></div></div><div class="card flat timeline">${eventTimeline(o)}</div></section>
${['OUT_FOR_DELIVERY','ARRIVING'].includes(o.status)?`<div class="notice success"><strong>Código de recebimento: ${esc(o.pin)}</strong><br>Informe este código somente quando o pedido estiver na sua frente.</div>`:''}
${o.status==='SETTLED'&&o.cashbackEarned?`<div class="notice success" style="margin-top:14px"><strong>+${BRL.format(o.cashbackEarned)} de cashback</strong><br>Crédito já disponível para uma próxima compra.</div>`:''}
${live&&['OFFERED_TO_MERCHANT','REQUOTE_REQUIRED'].includes(o.status)?`<button class="ghost full" style="margin-top:10px" onclick="cancelPending('${o.id}')">Cancelar antes do aceite</button>`:''}
${live&&['PREPARING','AT_RISK'].includes(o.status)?`<button class="danger-btn full" style="margin-top:10px" onclick="cancelBeforeDispatch('${o.id}')">Cancelar antes da saída</button>`:''}
<div class="card flat support-card" style="margin-top:14px"><strong>Precisa de ajuda?</strong><p class="muted tiny">Atraso, diferença de preço, problema com o produto ou entrega contestada podem ser tratados a partir deste pedido.</p><button class="secondary full" onclick="toast('Suporte do pedido aberto — demonstração')">Pedir ajuda</button></div>
</section>`)
}
function eventTimeline(o){
  const events=(o.events||[]).filter((e,i,arr)=>i===0||e.status!==arr[i-1].status||e.title!==arr[i-1].title);
  return events.map((e,i)=>`<div class="event ${i<events.length-1?'done':'current'}"><div class="event-dot"><span class="dot"></span></div><div><div class="event-title">${esc(e.title||statusCopy[e.status]?.[0]||e.status)}</div><div class="event-time">${hhmm(new Date(e.time))}</div><div class="event-desc">${esc(e.desc||'')}</div></div></div>`).join('');
}
function paymentLabel(v){return v==='card'?'Cartão':v==='cash'?'Dinheiro':'Pix'}
async function confirmRequote(id){
  if(globalThis.liveRequested?.()){
    await liveCustomerAction('accept-requote');
    return;
  }
  const r=acceptRequote(id);toast(r.ok?'Nova cotação enviada à revenda':r.error);render();
}
async function cancelBeforeDispatch(id){
  if(globalThis.liveRequested?.()){
    await liveCustomerAction('cancel-before-dispatch');
    return;
  }
  const r=customerCancel(id);
  toast(r.ok?'Pedido cancelado antes da saída':r.error);
  render();
}
async function cancelPending(id){
  if(globalThis.liveRequested?.()){
    await liveCustomerAction('cancel-before-accept');
    return;
  }
  const r=customerCancel(id);toast(r.ok?'Pedido cancelado':r.error);render();
}
