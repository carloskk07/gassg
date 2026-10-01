function home(){
  const liveMode=globalThis.liveRequested?.()===true;
  const ready=globalThis.liveReady?.()===true;
  const p=liveMode?null:minPrice();
  const priceText=liveMode?(ready?'Consultar por endereço':'Conectando…'):(p==null?'Indisponível':BRL.format(p));
  const freshness=liveMode
    ? (ready?'Piloto conectado ao backend real • preços aparecem após informar o endereço':'Modo live solicitado • aguardando autenticação do piloto')
    : `Dados demonstrativos • referência ANP usada no protótipo (20–26/09/2026): ${BRL.format(122.66)}`;
  const disabled=liveMode&&!ready;
  return shell(`<section class="hero"><div class="hero-grid"><div>
    <span class="eyebrow">● ${liveMode?'Piloto conectado de São Gabriel':'Preços de parceiros ativos em São Gabriel'}</span>
    <h1>Seu gás.<br>Sem perder tempo.</h1>
    <p>Consulte o preço atual, informe seu endereço e deixe a plataforma encontrar uma opção rápida e confiável para você.</p>
    <div class="hero-price"><span class="from">P13</span><strong>${priceText}</strong></div><div class="freshness">${esc(freshness)}</div>
    <button class="primary full" onclick="quickProduct('P13')" ${disabled?'disabled':''}>🔥 Ver preço para meu endereço</button>
    <div class="trust-row"><span class="trust-chip">✓ Preço protegido</span><span class="trust-chip">✓ Validação de parceiros</span><span class="trust-chip">✓ Status confirmados</span></div>
  </div><div class="card desktop-only"><div class="muted tiny">COMO FUNCIONA</div><h2 style="font-size:30px;margin-top:8px">Preço Agora + Entrega Inteligente</h2><div class="steps" style="margin-top:20px">${[['1','Informe seu endereço','Filtramos apenas parceiros que conseguem atender.'],['2','Escolha sua prioridade','Mais barato, recomendado ou mais rápido.'],['3','A revenda confirma','Nada de pedido “confirmado” sem aceite real.'],['4','Acompanhe a entrega','Saída e entrega têm confirmação própria.']].map(x=>`<div class="step"><div class="step-num">${x[0]}</div><div><strong>${x[1]}</strong><p>${x[2]}</p></div></div>`).join('')}</div></div></div></section>

<section class="section"><div class="section-head"><div><h2>Mais que gás</h2><p>Você pode pedir somente água, carvão, lenha ou gelo — o P13 não é obrigatório.</p></div></div><div class="quick-grid">${Object.entries(products).map(([k,p])=>`<button class="quick-card" onclick="quickProduct('${k}')" ${disabled?'disabled':''}><div class="quick-icon">${p.icon}</div><div class="quick-title">${p.name}</div><div class="quick-sub">Consultar agora</div></button>`).join('')}<button class="quick-card" onclick="go('merchants')"><div class="quick-icon">🏪</div><div class="quick-title">Sou revenda</div><div class="quick-sub">Quero participar</div></button></div></section>

<section class="section"><div class="section-head"><div><h2>Benefícios que voltam para você</h2><p>O crescimento da plataforma também recompensa quem usa e compartilha.</p></div></div><div class="grid cards-3"><div class="card feature-card"><div class="feature-icon">💵</div><h3>Cashback</h3><p>Crédito para reduzir o valor das próximas compras dentro da plataforma.</p><button class="ghost small" onclick="go('club')">Ver meu saldo →</button></div><div class="card feature-card"><div class="feature-icon">🤝</div><h3>Indique e ganhe</h3><p>Vendas reais geradas pelo seu link podem liberar comissão e benefícios.</p><button class="ghost small" onclick="go('refer')">Conhecer programa →</button></div><div class="card feature-card"><div class="feature-icon">👑</div><h3>Clube Plus</h3><p>Plano opcional com benefícios ampliados, pensado para famílias recorrentes.</p><button class="ghost small" onclick="go('club')">Ver clube →</button></div></div></section>

<section class="section"><div class="banner"><div class="tiny">PARA EMPRESAS LOCAIS</div><h2>Vende gás, água, carvão, lenha ou produtos relacionados?</h2><p>Cadastre sua operação, defina seus próprios preços e receba novos pedidos.</p><button class="secondary" onclick="go('merchant-join')">Quero ser parceiro</button></div></section>`)
}
function orderPage(){
  const liveMode=globalThis.liveRequested?.()===true;
  const ready=globalThis.liveReady?.()===true;
  const hasAddress=!!state.address;
  const hasItems=hasCartItems();
  const os=liveMode?(ready?(liveRuntime.offers||[]):[]):(hasItems?offers():[]);
  const pendingOrder=liveMode
    ? (liveRuntime.order&&!['SETTLED','CANCELLED'].includes(liveRuntime.order.status)?liveRuntime.order:null)
    : state.orders.find(isLiveOrder);

  let liveNotice='';
  if(liveMode&&!ready){
    const message=liveRuntime?.status==='loading'
      ? 'Conectando ao backend real do piloto…'
      : 'O modo live ainda não conseguiu criar uma sessão. Habilite Anonymous Sign-Ins no Supabase para testar pedidos reais.';
    liveNotice=`<div class="notice ${liveRuntime?.status==='unavailable'?'danger':''}" style="margin-bottom:14px"><strong>Backend do piloto</strong><br>${esc(message)}</div>`;
  }

  let offerBlock='';
  if(hasItems&&hasAddress){
    if(liveMode&&ready&&liveRuntime.loadingOffers){
      offerBlock='<div class="empty card">Consultando revendas reais…</div>';
    }else if(liveMode&&ready&&liveRuntime.error){
      offerBlock=`<div class="notice danger"><strong>Não foi possível atualizar as ofertas.</strong><br>${esc(liveRuntime.error)}<br><button class="secondary small" style="margin-top:10px" onclick="liveRefreshOffers().catch(()=>{})">Tentar novamente</button></div>`;
    }else if(os.length){
      offerBlock=`<div class="offer-stack">${os.map(offerCard).join('')}</div>`;
    }else if(liveMode&&ready&&liveRuntime.lastSyncAt){
      offerBlock='<div class="empty card">Nenhuma revenda real cadastrada consegue atender esta cesta agora.</div>';
    }else if(liveMode&&ready){
      offerBlock='<div class="empty card"><button class="primary" onclick="liveRefreshOffers().catch(()=>{})">Consultar revendas reais</button></div>';
    }else{
      offerBlock='<div class="empty card">Nenhum parceiro consegue atender toda essa cesta agora. Reduza algum item ou tente novamente.</div>';
    }
  }

  return shell(`<section class="page"><button class="back" onclick="go('home')">← Voltar</button><h1 class="page-title">Pedir agora</h1><p class="muted">Monte sua cesta. O sistema mostra somente parceiros capazes de atender todos os itens selecionados.</p>
${liveNotice}
${pendingOrder?`<div class="notice" style="margin-bottom:14px"><strong>Você já possui um pedido em andamento.</strong><br>Conclua ou cancele o pedido ${esc(pendingOrder.publicCode||pendingOrder.id)} antes de criar outro.<br><button class="ghost small" onclick="go('tracking')">Acompanhar pedido →</button></div>`:''}
<div class="card flat form-stack"><div class="input-wrap"><label for="address">Endereço de entrega</label><input id="address" class="input" autocomplete="street-address" maxlength="160" placeholder="Ex.: Rua General Câmara, 123" value="${esc(state.address||'')}"></div><button class="primary" onclick="setAddress()">${hasAddress?'Atualizar endereço':'Confirmar endereço'}</button></div>

<section class="section"><div class="section-head"><div><h2>Sua cesta</h2><p>Adicione somente o que você precisa.</p></div></div><div class="card flat">${Object.entries(products).map(([k,p])=>cartRow(k,p)).join('')}</div></section>

${hasItems&&hasAddress?`<section class="section"><div class="section-head"><div><h2>Pagamento e benefícios</h2><p>${liveMode?'O servidor recalcula preço e saldo antes de confirmar.':'O meio de pagamento será confirmado com a revenda no piloto.'}</p></div></div>
<div class="card flat form-stack"><div class="input-wrap"><label for="payment-method">Forma de pagamento</label><select id="payment-method" class="input" onchange="setPaymentMethod(this.value)"><option value="pix" ${state.checkout.paymentMethod==='pix'?'selected':''}>Pix</option><option value="card" ${state.checkout.paymentMethod==='card'?'selected':''}>Cartão</option><option value="cash" ${state.checkout.paymentMethod==='cash'?'selected':''}>Dinheiro</option></select></div>
${state.user.cashback>0?`<label class="check-row"><input type="checkbox" ${state.checkout.useCashback?'checked':''} onchange="toggleCashback(this.checked)"><span><strong>Usar cashback</strong><small>Saldo disponível: ${BRL.format(state.user.cashback)}</small></span></label>`:''}</div></section>
<section class="section"><div class="section-head"><div><h2>Melhores opções</h2><p>${liveMode?'Ofertas calculadas e congeladas no servidor.':'Preço, ETA, capacidade e histórico entram na seleção.'}</p></div></div>${offerBlock}</section>`:hasItems&&!hasAddress?'<div class="notice">Confirme o endereço para calcular as opções disponíveis.</div>':!hasItems?'<div class="notice">Adicione pelo menos um produto para consultar ofertas.</div>':''}</section>`)
}
function cartRow(k,p){
  const q=state.cart[k]||0;
  return `<div class="cart-item"><div class="product-left"><div class="product-icon">${p.icon}</div><div><strong>${p.name}</strong><div class="tiny muted">${k==='P13'?'GLP':'Produto complementar'}</div></div></div><div class="qty" aria-label="Quantidade de ${esc(p.name)}"><button aria-label="Diminuir" onclick="qty('${k}',-1)">−</button><strong>${q}</strong><button aria-label="Aumentar" onclick="qty('${k}',1)">+</button></div></div>`
}
function offerCard(o){
  const recommended=o.roles.includes('Recomendado');
  const discount=state.checkout.useCashback?Math.min(state.user.cashback,o.total):0;
  const payable=roundMoney(o.total-discount);
  const labels=o.roles.join(' • ');
  const etaEnd=o.etaMax??(o.eta+7);
  const distanceChip=o.distance!=null?`<span class="meta-chip">${Number(o.distance).toFixed(1)} km</span>`:'';
  return `<article class="offer ${recommended?'selected':''}">${recommended?'<div class="best-badge">MELHOR EQUILÍBRIO</div>':''}<div class="offer-label">${esc(labels)}</div><div class="offer-main"><div><div class="offer-price">${BRL.format(payable)}</div><div class="tiny muted">${discount>0?`estimativa após ${BRL.format(discount)} de cashback`:'total entregue'}</div></div><div class="offer-eta">${o.eta}–${etaEnd} min</div></div><div class="offer-meta">${distanceChip}<span class="meta-chip">Trust ${o.trust}/100</span><span class="meta-chip">Preço protegido</span></div><button class="${recommended?'primary':'secondary'} full" style="margin-top:13px" onclick="checkout('${o.id}')" ${globalThis.liveRuntime?.actionPending?'disabled':''}>Escolher esta opção</button></article>`
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
  if(globalThis.liveRequested?.())liveRuntime.offers=[];
  save();
  render();
  globalThis.liveScheduleOfferRefresh?.();
}
function quickProduct(k){state.cart=normalizeCart({});setCartProduct(k,1);go('order')}
function setPaymentMethod(v){state.checkout.paymentMethod=['pix','card','cash'].includes(v)?v:'pix';save();render()}
function toggleCashback(v){state.checkout.useCashback=Boolean(v);save();render()}

async function checkout(mid){
  if(globalThis.liveRequested?.()){
    if(!globalThis.liveReady?.())return toast('Backend real ainda não está disponível');
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
      ? 'Conectando ao backend real…'
      : 'O backend real ainda não possui uma sessão de cliente disponível.';
    return shell(`<section class="page"><h1 class="page-title">Seu pedido</h1><div class="notice ${liveRuntime?.status==='unavailable'?'danger':''}">${esc(message)}</div></section>`);
  }

  const o=liveRuntime.order;
  if(!o){
    return shell(`<section class="page"><h1 class="page-title">Seu pedido</h1><div class="empty card">Você ainda não possui um pedido real neste navegador.<br><br><button class="primary" onclick="quickProduct('P13')">Consultar ofertas</button></div></section>`);
  }

  const copy=statusCopy[o.status]||[o.status,''];
  const active=!['SETTLED','CANCELLED'].includes(o.status);
  const deadline=o.status==='OFFERED_TO_MERCHANT'&&o.offerExpiresAt
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
${o.status==='REQUOTE_REQUIRED'&&proposed!=null?`<div class="notice" style="margin-top:14px"><strong>Encontramos outra opção.</strong><br>Novo total: ${BRL.format(proposed)}. Nada muda sem sua autorização.<div class="order-actions"><button class="primary small" onclick="confirmRequote('${o.orderId}')" ${liveRuntime.actionPending?'disabled':''}>Aceitar novo total</button><button class="secondary small" onclick="cancelPending('${o.orderId}')" ${liveRuntime.actionPending?'disabled':''}>Cancelar pedido</button></div></div>`:''}
${o.status==='CANCELLED'?'<div class="notice danger" style="margin-top:14px">Este pedido foi encerrado. Cashback reservado, se houver, é devolvido pelo ledger.</div>':''}
${o.riskReason&&o.status!=='CANCELLED'?`<div class="notice danger" style="margin-top:14px"><strong>Acompanhamento prioritário.</strong><br>${esc(o.riskReason)}</div>`:''}

<section class="section"><div class="section-head"><div><h2>Linha do tempo</h2><p>Eventos registrados pelo backend.</p></div><button class="ghost small" onclick="liveGetOrder().catch(()=>{})">Atualizar</button></div><div class="card flat timeline">${liveEventTimeline(o)}</div></section>
${o.deliveryPin&&['OUT_FOR_DELIVERY','ARRIVING'].includes(o.status)?`<div class="notice success"><strong>PIN de recebimento: ${esc(o.deliveryPin)}</strong><br>Informe este código somente quando o pedido estiver na sua frente.</div>`:''}
${active&&['OFFERED_TO_MERCHANT','REQUOTE_REQUIRED'].includes(o.status)?`<button class="ghost full" style="margin-top:10px" onclick="cancelPending('${o.orderId}')" ${liveRuntime.actionPending?'disabled':''}>Cancelar antes do aceite</button>`:''}
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
<div class="card flat"><div class="price-lock"><span>🔒</span><div><strong>Preço protegido: ${BRL.format(o.lockedTotal)}</strong><br>${o.cashbackReserved>0?`Inclui ${BRL.format(o.cashbackReserved)} de cashback reservado. `:''}Qualquer aumento exige novo aceite seu.</div></div><div class="divider"></div><div class="list-row"><div><strong>${merchantVisible?esc(o.supplierSnapshot.name):'Fornecedor em confirmação'}</strong><br><small>${merchantVisible?'Parceiro confirmado':'A identidade aparece após o aceite real'}</small></div><div style="text-align:right"><strong>${BRL.format(o.total)}</strong><br><small>${esc(o.address)}</small></div></div><div class="list-row"><span>Pagamento</span><strong>${paymentLabel(o.paymentMethod)}</strong></div></div>

${o.status==='OFFERED_TO_MERCHANT'?`<div class="notice" style="margin-top:14px"><strong>Aguardando aceite real.</strong><br>Se a revenda não responder em até 3 minutos, o sistema tenta outra automaticamente. ${deadline!=null?`Prazo restante aproximado: ${deadline}s.`:''}</div>`:''}
${o.status==='REQUOTE_REQUIRED'?`<div class="notice" style="margin-top:14px"><strong>Encontramos outra opção.</strong><br>Novo total: ${BRL.format(o.proposedTotal)}. Nada muda sem sua autorização.<div class="order-actions"><button class="primary small" onclick="confirmRequote('${o.id}')">Aceitar novo total</button><button class="secondary small" onclick="cancelPending('${o.id}')">Cancelar pedido</button></div></div>`:''}
${o.status==='CANCELLED'?`<div class="notice danger" style="margin-top:14px">Este pedido foi encerrado. Cashback reservado, se houver, foi devolvido.</div>`:''}
${o.riskReason&&o.status!=='CANCELLED'?`<div class="notice danger" style="margin-top:14px"><strong>Acompanhamento prioritário.</strong><br>${esc(o.riskReason)}. O status só muda quando houver nova confirmação real.</div>`:''}

<section class="section"><div class="section-head"><div><h2>Linha do tempo</h2><p>Eventos reais e auditáveis do pedido.</p></div></div><div class="card flat timeline">${eventTimeline(o)}</div></section>
${['OUT_FOR_DELIVERY','ARRIVING'].includes(o.status)?`<div class="notice success"><strong>PIN de recebimento: ${esc(o.pin)}</strong><br>Informe este código somente quando o pedido estiver na sua frente.</div>`:''}
${o.status==='SETTLED'&&o.cashbackEarned?`<div class="notice success" style="margin-top:14px"><strong>+${BRL.format(o.cashbackEarned)} de cashback</strong><br>Crédito já disponível para uma próxima compra.</div>`:''}
${live&&['OFFERED_TO_MERCHANT','REQUOTE_REQUIRED'].includes(o.status)?`<button class="ghost full" style="margin-top:10px" onclick="cancelPending('${o.id}')">Cancelar antes do aceite</button>`:''}
<div class="card flat" style="margin-top:14px"><strong>Precisa de ajuda?</strong><p class="muted tiny">Preço diferente, atraso, problema com produto ou entrega contestada viram incidentes rastreáveis.</p><button class="secondary full" onclick="toast('Suporte do pedido aberto — demonstração')">Abrir suporte</button></div>
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
async function cancelPending(id){
  if(globalThis.liveRequested?.()){
    await liveCustomerAction('cancel-before-accept');
    return;
  }
  const r=customerCancel(id);toast(r.ok?'Pedido cancelado':r.error);render();
}
