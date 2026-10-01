function merchantPage(){
  const m=merchantById(state.selectedMerchant)||state.merchants[0];
  const orders=state.orders.filter(o=>o.merchantId===m.id&&['OFFERED_TO_MERCHANT','MERCHANT_ACCEPTED','PREPARING','AT_RISK','OUT_FOR_DELIVERY','ARRIVING'].includes(o.status));
  const fresh=isPriceFresh(m);
  return shell(`<section class="page"><div class="status-bar"><div><div class="tiny muted">PAINEL DA REVENDA — DEMONSTRAÇÃO</div><h1 class="page-title" style="margin-bottom:2px">${esc(m.name)}</h1></div><span class="status-pill ${m.online?'online':'offline'}">${m.online?'● ONLINE':'OFFLINE'}</span></div>
<div class="card flat form-stack"><div class="input-wrap"><label for="merchant-select">Operação demonstrada</label><select id="merchant-select" class="input" onchange="selectMerchant(this.value)">${state.merchants.map(x=>`<option value="${x.id}" ${x.id===m.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><button class="${m.online?'secondary':'primary'}" onclick="toggleOnline('${m.id}')">${m.online?'Pausar novos pedidos':'Ficar online'}</button></div>
${!fresh?'<div class="notice danger" style="margin-top:12px"><strong>Preço expirado.</strong> A oferta não aparece ao cliente até ser reconfirmada.</div>':''}
<section class="section"><div class="merchant-kpis"><div class="kpi"><span class="label">Preço P13</span><strong>${BRL.format(m.priceP13)}</strong></div><div class="kpi"><span class="label">Estoque P13</span><strong>${m.inventory.P13}</strong></div><div class="kpi"><span class="label">Trust</span><strong>${m.trust}</strong></div><div class="kpi"><span class="label">Pedidos ativos</span><strong>${orders.length}</strong></div></div></section>
<div class="card flat form-stack"><div class="field-row"><div class="input-wrap"><label for="m-price">Preço P13</label><input id="m-price" inputmode="decimal" type="number" min="0.01" max="9999" step="0.10" class="input" value="${m.priceP13}"></div><div class="input-wrap"><label for="m-stock">Estoque disponível P13</label><input id="m-stock" inputmode="numeric" type="number" min="0" max="9999" class="input" value="${m.inventory.P13}"></div></div><button class="secondary" onclick="merchantUpdate('${m.id}')">Confirmar preço e estoque</button><div class="tiny muted">Última confirmação: ${esc(formatDateTime(m.priceConfirmedAt))}</div></div>
<section class="section"><div class="section-head"><div><h2>Pedidos que exigem ação</h2><p>Aceitar significa assumir compromisso real de atendimento.</p></div></div>${orders.length?orders.map(merchantOrder).join(''):`<div class="empty card">Nenhum pedido ativo para esta revenda.</div>`}</section></section>`)
}
function merchantOrder(o){
  const copy=statusCopy[o.status]||[o.status,''];
  const items=(o.items||[]).map(i=>`${i.qty}× ${esc(i.name)}`).join(' • ')||Object.entries(o.cart||{}).filter(([,q])=>q>0).map(([k,q])=>`${q}× ${esc(products[k]?.name||k)}`).join(' • ');
  let actions='';
  if(o.status==='OFFERED_TO_MERCHANT'){
    const secs=Math.max(0,Math.ceil((Date.parse(o.offerExpiresAt)-Date.now())/1000));
    actions=`<button class="primary small" onclick="merchantAction('${o.id}','accept')">Aceitar pedido</button><button class="danger-btn small" onclick="merchantAction('${o.id}','reject')">Não consigo atender</button><span class="tiny muted">Prazo: ~${secs}s</span>`;
  }else if(['MERCHANT_ACCEPTED','PREPARING','AT_RISK'].includes(o.status)){
    actions=`<button class="primary small" onclick="merchantAction('${o.id}','dispatch')">Confirmar saída</button><button class="danger-btn small" onclick="merchantAction('${o.id}','cannot-fulfill')">Não consigo concluir</button>`;
  }else if(o.status==='OUT_FOR_DELIVERY'){
    actions=`<button class="secondary small" onclick="merchantAction('${o.id}','arriving')">Estou chegando</button>`;
  }else if(o.status==='ARRIVING'){
    actions=`<label class="sr-only" for="pin-${o.id}">PIN de entrega</label><input id="pin-${o.id}" inputmode="numeric" maxlength="4" class="input pin-input" placeholder="PIN"><label class="check-row"><input id="paid-${o.id}" type="checkbox"><span><strong>Pagamento recebido</strong><small>Obrigatório para concluir o pedido.</small></span></label><button class="primary small" onclick="merchantAction('${o.id}','deliver')">Confirmar entrega</button>`;
  }
  const addressLine=o.status==='OFFERED_TO_MERCHANT'?'📍 Endereço protegido até o aceite':'📍 '+esc(o.address);
  return `<article class="order-card ${o.status==='OFFERED_TO_MERCHANT'?'new':''}"><div class="order-head"><div><div class="order-id">${esc(o.id)}</div><div class="order-line">${items}</div></div><div style="text-align:right"><strong>${BRL.format(o.total)}</strong><div class="tiny muted">${esc(copy[0])}</div></div></div><div class="order-line">${addressLine}</div><div class="order-line">Pagamento: ${esc(paymentLabel(o.paymentMethod))}</div><div class="order-actions">${actions}</div></article>`;
}
function selectMerchant(id){if(merchantById(id)){state.selectedMerchant=id;save();render()}}
function toggleOnline(id){
  const m=merchantById(id);if(!m)return toast('Revenda não encontrada');
  const r=m.online?pauseMerchant(id):resumeMerchant(id);
  toast(r.ok?(m.online?'Revenda online':'Novos pedidos pausados'):r.error);
  render();
}
function merchantUpdate(id){
  const price=document.querySelector('#m-price')?.value;
  const stock=document.querySelector('#m-stock')?.value;
  const r=updateMerchant(id,{priceP13:price,stockP13:stock});
  toast(r.ok?'Preço e estoque confirmados':r.error);render();
}
function merchantAction(id,action){
  let r={ok:false,error:'Ação inválida'};
  if(action==='accept')r=acceptOrder(id);
  if(action==='reject')r=rejectOrder(id);
  if(action==='dispatch')r=dispatchOrder(id);
  if(action==='cannot-fulfill')r=failAcceptedOrder(id,'A revenda informou uma falha operacional antes da saída.');
  if(action==='arriving')r=arrivingOrder(id);
  if(action==='deliver'){
    const pin=document.querySelector('#pin-'+CSS.escape(id))?.value.trim()||'';
    const paid=document.querySelector('#paid-'+CSS.escape(id))?.checked===true;
    r=deliverOrder(id,pin,paid);
  }
  const successMessages={accept:'Pedido aceito e estoque reservado',reject:'Pedido recusado; o sistema buscou alternativa','cannot-fulfill':'Estoque devolvido; o sistema buscou outra revenda',dispatch:'Saída confirmada — o cliente agora vê “A caminho”',arriving:'Chegada confirmada',deliver:'Entrega e pagamento confirmados; benefícios processados'};
  toast(r.ok?successMessages[action]:r.error);
  render();
}
function merchantOrders(){state.mode='merchant';save();return merchantPage()}
function catalog(){
  const m=merchantById(state.selectedMerchant)||state.merchants[0];
  return shell(`<section class="page"><h1 class="page-title">Meu catálogo</h1><p class="muted">A revenda não fica limitada ao P13. Cada produto tem preço e disponibilidade próprios.</p><div class="list">${Object.entries(products).map(([k,p])=>{const price=productPrice(m,k);const stock=inventoryFor(m,k);return `<div class="list-row"><div class="product-left"><div class="product-icon">${p.icon}</div><div><strong>${esc(p.name)}</strong><br><small>${price==null?'Não oferecido':`${BRL.format(price)} • estoque ${stock}`}</small></div></div><span class="status-pill ${price==null||stock<=0?'offline':'online'}">${price==null?'INATIVO':stock<=0?'SEM ESTOQUE':'ATIVO'}</span></div>`}).join('')}</div><div class="notice" style="margin-top:14px">No produto real, cada categoria terá regras de compatibilidade logística e conformidade próprias.</div></section>`)
}
function merchantMetrics(){
  const m=merchantById(state.selectedMerchant)||state.merchants[0];
  const accepted=Math.max(0,Number(m.accepted)||0),delivered=Math.max(0,Number(m.delivered)||0);
  const completion=accepted?delivered/accepted:0;
  return shell(`<section class="page"><h1 class="page-title">Desempenho</h1><div class="merchant-kpis"><div class="kpi"><span class="label">Trust Score</span><strong>${m.trust}/100</strong></div><div class="kpi"><span class="label">Aceitos</span><strong>${accepted}</strong></div><div class="kpi"><span class="label">Entregues</span><strong>${delivered}</strong></div><div class="kpi"><span class="label">Conclusão</span><strong>${accepted?Math.round(completion*100)+'%':'—'}</strong></div></div><section class="section"><div class="card flat"><h3>O que mais pesa no Trust Score</h3><div class="list"><div class="list-row"><strong>Entregas dentro do ETA</strong><span>25%</span></div><div class="list-row"><strong>Conclusão após aceite</strong><span>20%</span></div><div class="list-row"><strong>Integridade dos status</strong><span>15%</span></div><div class="list-row"><strong>Integridade de preço</strong><span>15%</span></div></div></div></section></section>`)
}
function formatDateTime(v){
  const d=new Date(v);if(Number.isNaN(d.getTime()))return 'não confirmada';
  return d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
}
