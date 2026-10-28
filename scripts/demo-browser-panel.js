// This module is emitted ONLY by build-owner-browser-demo.mjs.
// It reads the pre-existing browser simulator. No server writes, no Pix or PSP.
(()=>{
  if(globalThis.TAMAO_BROWSER_DEMO!==true||globalThis.__CHAMA_TEST__!==true) return;
  const host=document.getElementById('tamao-demo-browser-banner');
  if(!host)return;
  const style=document.createElement('style');
  style.textContent=[
    '#tamao-demo-browser-banner{position:sticky;top:0;z-index:90000;background:#fff1c7;color:#3e2810;font:600 12px/1.4 system-ui,sans-serif;border-bottom:2px solid #b67a17}',
    '.tamao-demo-tools{max-width:1200px;margin:auto;display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:8px 12px}',
    '.tamao-demo-tools strong{font-weight:800}.tamao-demo-tools span{font-weight:500}',
    '.tamao-demo-tools button{border:1px solid #945d00;background:#fff9eb;color:#44300d;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer}',
    '.tamao-demo-tools button:focus-visible{outline:3px solid #433312;outline-offset:2px}',
    '.tamao-demo-progress{width:100%;font-weight:700;font-size:12px;text-align:center;color:#70440c}',
    '.tamao-demo-dialog{position:fixed;z-index:90010;inset:0;background:rgba(9,22,19,.66);display:none;place-items:center;padding:18px}',
    '.tamao-demo-dialog[data-open="true"]{display:grid}',
    '.tamao-demo-panel{background:#fff;color:#1a2923;border-radius:16px;max-width:760px;width:100%;max-height:82vh;overflow-y:auto;padding:24px;font:14px/1.5 system-ui,sans-serif;box-shadow:0 18px 50px #0004}',
    '.tamao-demo-panel h2{font-size:22px;margin:0 0 4px}.tamao-demo-panel p{margin:6px 0 12px}',
    '.tamao-demo-panel .demo-order{border:1px solid #ccd8d0;border-radius:10px;margin:10px 0;padding:12px;display:grid;gap:3px}',
    '.tamao-demo-panel .demo-amount{font-size:20px;font-weight:750}.tamao-demo-panel button{padding:9px 14px;border:1px solid #256f51;border-radius:8px;background:#effaf2;color:#134932;cursor:pointer}',
    '.tamao-demo-panel .demo-stats{display:flex;gap:12px;flex-wrap:wrap}.tamao-demo-panel .demo-stats span{padding:10px;background:#ecf5f0;border-radius:9px}',
    '@media(max-width:600px){.tamao-demo-tools{justify-content:center}.tamao-demo-tools>div{display:flex;flex-wrap:wrap;gap:5px;justify-content:center}.tamao-demo-tools>span{font-size:11px}}'
  ].join('\n');
  document.head.appendChild(style);
  const tools=document.createElement('div');tools.className='tamao-demo-tools';
  const heading=document.createElement('strong');heading.textContent='🧪 TAMÃO — DEMONSTRAÇÃO INTERATIVA';
  const detail=document.createElement('span');detail.textContent='Pedidos e valores fictícios • sem cadastro, Pix ou cobrança real';
  const nav=document.createElement('div');
  const progress=document.createElement('div');progress.className='tamao-demo-progress';progress.id='tamao-demo-progress';progress.setAttribute('role','status');
  const button=(label,fn)=>{
    const el=document.createElement('button');el.type='button';el.textContent=label;
    el.addEventListener('click',fn);return el;
  };
  let adminOpen=false;
  let adminRenderedFingerprint='';
  const dialog=document.createElement('div');dialog.className='tamao-demo-dialog';
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
  dialog.setAttribute('aria-label','Admin demonstrativo, dados fictícios');
  const panel=document.createElement('section');panel.className='tamao-demo-panel';
  const escapeText=x=>String(x??'');
  const make=(name,text)=>{const el=document.createElement(name);el.textContent=escapeText(text);return el};
  const money=value=>'R$ '+Number(value||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const read=()=>{
    const s=globalThis.ChamaTest?.getState?.();
    return s&&Array.isArray(s.orders)?s:null;
  };
  // A guided tour uses the SAME browser-only simulator. It never creates an
  // order silently and never changes financial state; only the active view.
  function currentOrder(){
    const orders=read()?.orders||[];
    return [...orders].reverse().find(o=>!['CANCELLED','SETTLED','DELIVERED'].includes(o.status))
      ||orders.at(-1)||null;
  }
  function focusAssignedOrder(){
    const o=currentOrder();
    if(!o||!['merchant','merchant-orders'].includes(location.hash.replace('#','')))return false;
    const card=Array.from(document.querySelectorAll('.order-card')).find(el=>
      el.querySelector('.order-id')?.textContent.includes(o.id));
    if(!card)return false;
    card.scrollIntoView({block:'center',behavior:'instant'});
    return true;
  }
  function openCustomer(){
    setAdmin(false);
    globalThis.setMode?.('customer');
    const o=currentOrder();
    if(o&&['OFFERED_TO_MERCHANT','PREPARING','OUT_FOR_DELIVERY','ARRIVING','SETTLED'].includes(o.status)){
      globalThis.go?.('tracking');
    }
    updateGuide();
  }
  function openMerchant(){
    setAdmin(false);
    const s=read();
    const o=currentOrder();
    // Without selecting the actual merchant of the chosen quote, a buyer
    // can create an order for B while the merchant demo stays on A.
    if(s&&o&&s.merchants?.some(m=>m.id===o.merchantId)){
      if(s.selectedMerchant!==o.merchantId){
        s.selectedMerchant=o.merchantId;
        globalThis.ChamaTest?.setState?.(s);
      }
    }
    globalThis.setMode?.('merchant');
    updateGuide();
    window.setTimeout(focusAssignedOrder,100);
  }
  function updateGuide(){
    const o=currentOrder();
    const status=o?.status||'';
    const steps={
      OFFERED_TO_MERCHANT:'2/4 · Pedido enviado. Abra Revenda e clique Aceitar pedido.',
      MERCHANT_ACCEPTED:'3/4 · Revenda confirmou. Clique Confirmar saída.',
      PREPARING:'3/4 · Revenda aceitou. Confirme saída, chegada e o PIN do Cliente.',
      OUT_FOR_DELIVERY:'3/4 · Em entrega. Na Revenda, clique Estou chegando.',
      ARRIVING:'3/4 · Na Revenda, confira o PIN do Cliente e confirme pagamento fictício.',
      SETTLED:'4/4 · Pedido fictício concluído! Confira o resumo no Admin.',
      DELIVERED:'4/4 · Pedido fictício entregue! Confira o resumo no Admin.',
      CANCELLED:'Pedido fictício cancelado. Reinicie para testar novamente.'
    };
    progress.textContent=steps[status]||'1/4 · Cliente: escolha um produto, informe um endereço fictício e simule o pedido.';
  }
  function drawAdmin(){
    const signature=JSON.stringify((read()?.orders||[]).map(o=>[o.id,o.merchantId,o.status,o.total]));
    if(signature===adminRenderedFingerprint&&panel.childElementCount)return;
    adminRenderedFingerprint=signature;
    panel.replaceChildren();
    panel.append(make('h2','Admin — resumo de pedidos simulados'));
    panel.append(make('p','Projeção local de leitura dos pedidos criados no mesmo navegador. Não é o Admin autenticado nem o banco de produção.'));
    const s=read();const orders=s?.orders||[];
    const stats=make('div','');stats.className='demo-stats';
    const active=orders.filter(o=>!['CANCELLED','SETTLED','DELIVERED','REJECTED'].includes(o.status)).length;
    for(const [label,value] of [['Pedidos fictícios',orders.length],['Em atendimento',active],['Concluídos',orders.filter(o=>['SETTLED','DELIVERED'].includes(o.status)).length]]){
      stats.append(make('span',label+': '+value));
    }
    panel.append(stats);
    if(!orders.length)panel.append(make('p','Nenhum pedido ainda. Volte ao Cliente, monte uma cesta e simule o pedido.'));
    for(const o of [...orders].reverse().slice(0,30)){
      const card=document.createElement('article');card.className='demo-order';
      card.append(make('strong','Pedido '+(o.publicCode||o.code||o.id||'simulado')));
      card.append(make('span','Status: '+(o.status||'desconhecido')));
      card.append(make('span','Revenda fictícia: '+(s.merchants?.find(m=>m.id===o.merchantId)?.name||'Não atribuída')));
      const items=(o.items||[]).map(i=>String(i.qty||i.quantity||0)+'× '+String(i.name||i.productName||'item')).join(' • ');
      if(items)card.append(make('span',items));
      const cents=Number(o.totalCents||0),real=Number(o.total||0);
      card.append(make('span',money(cents>0?cents/100:real)));
      panel.append(card);
    }
    panel.append(button('Ver pedido como Cliente',openCustomer));
    panel.append(make('span',' '));
    panel.append(button('Continuar na Revenda',openMerchant));
    panel.append(make('span',' '));
    panel.append(button('Fechar Admin demonstrativo',()=>setAdmin(false)));
  }
  function setAdmin(open){
    adminOpen=Boolean(open);dialog.dataset.open=String(adminOpen);
    if(adminOpen)adminRenderedFingerprint='';
    if(adminOpen){drawAdmin();panel.querySelector('button')?.focus()}
    else nav.querySelector('button')?.focus();
  }
  // The canonical merchant page re-renders after every action. Keep the
  // affected order visible instead of jumping back to the top of the page.
  if(typeof globalThis.merchantAction==='function'){
    const realAction=globalThis.merchantAction;
    globalThis.merchantAction=(id,action)=>{
      const result=realAction(id,action);
      updateGuide();
      window.setTimeout(focusAssignedOrder,100);
      return result;
    };
  }
  nav.append(button('Cliente',openCustomer));
  nav.append(button('Revenda (pedido)',openMerchant));
  nav.append(button('Admin (resumo)',()=>setAdmin(true)));
  nav.append(button('Reiniciar',()=>{
    if(confirm('Apagar apenas os pedidos e valores fictícios desta demonstração no navegador?')){
      setAdmin(false);globalThis.reset?.();
    }
  }));
  dialog.append(panel);
  dialog.addEventListener('click',e=>{if(e.target===dialog)setAdmin(false)});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&adminOpen)setAdmin(false)});
  tools.append(heading,detail,nav);
  tools.append(progress);
  updateGuide();
  window.setInterval(()=>{updateGuide();if(adminOpen)drawAdmin()},1800);
  host.append(tools);
  document.body.append(dialog);
})();
