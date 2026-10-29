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
    '.tamao-demo-driver-form{display:grid;gap:12px;max-width:460px}.tamao-demo-driver-form label{display:grid;gap:5px;font-weight:650}.tamao-demo-driver-form input[type=text]{width:100%;padding:11px;font:inherit;border:1px solid #879e93;border-radius:8px}.tamao-demo-driver-check{display:flex!important;align-items:center;gap:8px}.tamao-demo-driver-check input{width:20px;height:20px}.tamao-demo-driver-status{font-weight:650;color:#69451b}',
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
  let driverOpen=false,driverOrderId=null,driverError='';
  let deviceCheckBusy=false,deviceCheckResult='';
  let adminRenderedFingerprint='',driverRenderedFingerprint='';
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
  // All customer entry points (the demo banner AND the original 'Comprar'
  // switcher) must resume a saved order instead of dropping back to the home.
  // Keep this override inside the generated browser-only demo, not production.
  if(typeof globalThis.setMode==='function'){
    const setModeOriginal=globalThis.setMode;
    globalThis.setMode=mode=>{
      const result=setModeOriginal(mode);
      if(mode==='customer'&&currentOrder()){
        globalThis.go?.('tracking');
      }
      return result;
    };
  }
  function openCustomer(){
    setAdmin(false);
    globalThis.setMode?.('customer');
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
      PREPARING:'3/4 · Revenda aceitou. Confirme a saída; depois abra Entregador.',
      OUT_FOR_DELIVERY:'3/4 · Em entrega. Abra Entregador e registre a chegada.',
      ARRIVING:'3/4 · No Entregador, informe o PIN e confirme recebimento fictício.',
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
  // This is a phone/browser capability check only, NOT the protected
  // offline-delivery workflow. It never stores a real order, PIN or payment.
  // Separate short-lived IndexedDB storage avoids production's receipt DB.
  async function verifyEncryptedDeviceStorage(){
    if(!globalThis.isSecureContext||!globalThis.crypto?.subtle||
       !globalThis.crypto?.getRandomValues||!globalThis.indexedDB)
      throw new Error('Navegador sem criptografia ou armazenamento seguro');
    const db=await new Promise((resolve,reject)=>{
      const req=indexedDB.open('tamao-demo-device-crypto-check-v1',1);
      req.onupgradeneeded=()=>{
        if(!req.result.objectStoreNames.contains('checks'))
          req.result.createObjectStore('checks',{keyPath:'id'});
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('Armazenamento bloqueado'));
      req.onblocked=()=>reject(new Error('Feche outras abas de teste e tente novamente'));
    });
    const transact=(mode,perform)=>new Promise((resolve,reject)=>{
      const tx=db.transaction('checks',mode);
      let result;
      const request=perform(tx.objectStore('checks'));
      request.onsuccess=()=>{result=request.result};
      request.onerror=()=>reject(request.error||new Error('Falha no armazenamento'));
      tx.onabort=()=>reject(tx.error||new Error('Gravação interrompida'));
      tx.onerror=()=>reject(tx.error||new Error('Falha ao guardar teste'));
      tx.oncomplete=()=>resolve(result);
    });
    try{
      const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
      if(key.extractable!==false)throw new Error('Chave de teste exportável');
      const iv=crypto.getRandomValues(new Uint8Array(12));
      const challenge=crypto.getRandomValues(new Uint8Array(24));
      const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,challenge);
      await transact('readwrite',store=>store.put({
        id:'probe',key,iv:Array.from(iv),ciphertext:Array.from(new Uint8Array(encrypted))
      }));
      // Open a NEW transaction: writing alone does not prove readable storage.
      const saved=await transact('readonly',store=>store.get('probe'));
      if(!saved?.key||saved.key.extractable!==false||!Array.isArray(saved.ciphertext))
        throw new Error('O navegador não preservou a chave protegida');
      const decrypted=new Uint8Array(await crypto.subtle.decrypt(
        {name:'AES-GCM',iv:new Uint8Array(saved.iv)},
        saved.key,new Uint8Array(saved.ciphertext)
      ));
      if(decrypted.length!==challenge.length||!decrypted.every((v,i)=>v===challenge[i]))
        throw new Error('Não foi possível recuperar os dados criptografados');
    }finally{
      // The check leaves no proof, customer data, PIN or encryption key behind.
      try{await transact('readwrite',store=>store.delete('probe'))}catch{}
      db.close();
    }
  }
  async function runDeviceCheck(){
    if(deviceCheckBusy)return;
    deviceCheckBusy=true;
    deviceCheckResult='Verificando a criptografia e o armazenamento local…';
    driverRenderedFingerprint='';if(driverOpen)drawDriver();
    try{
      await verifyEncryptedDeviceStorage();
      deviceCheckResult='✓ Aprovado neste navegador: dados fictícios criptografados foram gravados, recuperados e apagados. Não comprova entrega offline real.';
    }catch(error){
      deviceCheckResult='Não aprovado neste navegador: '+String(error?.message||'armazenamento indisponível')+'. Nenhum pedido foi alterado.';
    }finally{
      deviceCheckBusy=false;
      driverRenderedFingerprint='';if(driverOpen)drawDriver();
    }
  }
  function drawDriver(){
    const order=read()?.orders?.find(o=>o.id===driverOrderId)||null;
    const fingerprint=JSON.stringify([order?.id,order?.status,order?.pinFailures,driverError,deviceCheckBusy,deviceCheckResult]);
    if(fingerprint===driverRenderedFingerprint&&panel.childElementCount)return;
    driverRenderedFingerprint=fingerprint;
    panel.replaceChildren();
    panel.append(make('h2','Entregador — uma entrega por vez'));
    panel.append(make('p','Somente demonstração com pedido fictício. No TAMÃO real, a atribuição depende da conta autorizada da revenda.'));
    if(!order){
      panel.append(make('p','Nenhuma entrega selecionada. Crie um pedido no Cliente e confirme a saída pela Revenda.'));
    }else{
      const card=make('article','');card.className='demo-order';
      card.append(make('strong','Pedido '+(order.publicCode||order.id)));
      card.append(make('span','Situação: '+String(order.status||'indefinido')));
      card.append(make('span','Endereço fictício: '+String(order.address||'Não informado')));
      card.append(make('span','Total fictício: '+money(order.total)));
      panel.append(card);
      if(order.status==='OUT_FOR_DELIVERY'){
        panel.append(make('p','Uma ação: ao chegar ao endereço, registre a chegada.'));
        panel.append(button('Cheguei ao endereço',()=>{
          const r=globalThis.ChamaTest?.arrivingOrder?.(order.id);
          if(r?.ok!==true)driverError=String(r?.error||'Chegada não confirmada');
          else driverError='';
          globalThis.render?.();updateGuide();driverRenderedFingerprint='';drawDriver();
        }));
      }else if(order.status==='ARRIVING'){
        const form=make('div','');form.className='tamao-demo-driver-form';
        const label=make('label','Código de 4 dígitos informado pelo Cliente');
        const pin=document.createElement('input');pin.id='tamao-demo-driver-pin';
        pin.type='text';pin.inputMode='numeric';pin.maxLength=4;
        pin.autocomplete='off';pin.pattern='[0-9]{4}';
        label.append(pin);form.append(label);
        const paidLabel=make('label','');paidLabel.className='tamao-demo-driver-check';
        const paid=document.createElement('input');paid.type='checkbox';paid.id='tamao-demo-driver-paid';
        paidLabel.append(paid,document.createTextNode('Recebi o pagamento fictício do pedido'));
        form.append(paidLabel);
        form.append(button('Concluir entrega simulada',()=>{
          const r=globalThis.ChamaTest?.deliverOrder?.(order.id,pin.value,paid.checked);
          if(r?.ok!==true){
            driverError=String(r?.error||'Entrega não confirmada');
            const status=document.getElementById('tamao-demo-driver-status');
            if(status)status.textContent=driverError;
            pin.value='';pin.focus();
            return;
          }
          driverError='';
          pin.value='';paid.checked=false;
          globalThis.render?.();updateGuide();driverRenderedFingerprint='';drawDriver();
        }));
        panel.append(form);
        panel.append(make('p','O código aparece no acompanhamento do Cliente. Não é enviado por este demonstrativo a nenhuma revenda ou banco.'));
      }else if(['SETTLED','DELIVERED'].includes(order.status)){
        panel.append(make('p','✓ Entrega fictícia concluída. Cliente e Admin mostram o mesmo pedido.'));
        panel.append(button('Conferir no Cliente',openCustomer));
        panel.append(make('span',' '));
        panel.append(button('Conferir no Admin',()=>setAdmin(true)));
      }else{
        panel.append(make('p','Esta etapa pertence à Revenda: aceite o pedido e confirme a saída antes da entrega.'));
        panel.append(button('Ir para a Revenda',openMerchant));
      }
    }
    const status=make('p',driverError);
    status.id='tamao-demo-driver-status';status.className='tamao-demo-driver-status';
    status.setAttribute('role','status');panel.append(status);
    panel.append(make('p','Sem sinal: este demonstrativo online não registra comprovantes offline. Esse recurso é testado separadamente no Android emulado e permanece em homologação.'));
    const deviceButton=button('Verificar armazenamento protegido deste aparelho',runDeviceCheck);
    deviceButton.id='tamao-demo-device-check';
    deviceButton.disabled=deviceCheckBusy;
    panel.append(deviceButton);
    const deviceStatus=make('p',deviceCheckResult);
    deviceStatus.id='tamao-demo-device-status';
    deviceStatus.setAttribute('role','status');
    deviceStatus.setAttribute('aria-live','polite');
    panel.append(deviceStatus);
    panel.append(make('p','Teste de compatibilidade: depois de abrir a página no celular, você pode ativar modo avião e tocar no botão acima sem recarregar a página. Não confirma pedidos, pagamento ou sincronização com a revenda.'));
    panel.append(button('Fechar',()=>setDriver(false)));
  }
  function setDriver(open){
    driverOpen=Boolean(open);adminOpen=false;
    dialog.dataset.open=String(driverOpen);
    if(driverOpen){
      driverOrderId=currentOrder()?.id||null;
      driverError='';deviceCheckResult='';driverRenderedFingerprint='';
      dialog.setAttribute('aria-label','Entregador demonstrativo, dados fictícios');
      drawDriver();
      panel.querySelector('button')?.focus();
    }else nav.querySelector('button')?.focus();
  }
  function setAdmin(open){
    adminOpen=Boolean(open);driverOpen=false;dialog.dataset.open=String(adminOpen);
    if(adminOpen)dialog.setAttribute('aria-label','Admin demonstrativo, dados fictícios');
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
  function beginP13(){
    setAdmin(false);
    globalThis.setMode?.('customer');
    const o=currentOrder();
    if(o&&!['CANCELLED','SETTLED','DELIVERED','REJECTED'].includes(o.status)){
      globalThis.go?.('tracking');
    }else{
      // Existing public checkout and price comparison, with synthetic stock only.
      globalThis.startOrder?.('P13');
    }
    updateGuide();
  }
  nav.append(button('Cliente · acompanhar pedido',openCustomer));
  nav.append(button('Começar com gás P13',beginP13));
  nav.append(button('Revenda (pedido)',openMerchant));
  nav.append(button('Entregador (simulação)',()=>setDriver(true)));
  nav.append(button('Admin (resumo)',()=>setAdmin(true)));
  nav.append(button('Reiniciar',()=>{
    if(confirm('Apagar apenas os pedidos e valores fictícios desta demonstração no navegador?')){
      setAdmin(false);globalThis.reset?.();
    }
  }));
  dialog.append(panel);
  dialog.addEventListener('click',e=>{if(e.target===dialog){if(driverOpen)setDriver(false);else setAdmin(false)}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(driverOpen)setDriver(false);else if(adminOpen)setAdmin(false)}});
  tools.append(heading,detail,nav);
  tools.append(progress);
  updateGuide();
  window.setInterval(()=>{updateGuide();if(adminOpen)drawAdmin();if(driverOpen)drawDriver()},1800);
  host.append(tools);
  document.body.append(dialog);
})();
