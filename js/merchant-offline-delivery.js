// Driver-only, opt-in local delivery receipt. Never an order or payment ledger.
// A non-extractable AES-GCM key is scoped to the authorized user and merchant.
// Offline receipts remain PENDING until the existing authenticated server action
// confirms the exact version, assignment and PIN. Nothing is sent automatically.
(()=>{
  'use strict';
  const DB_NAME='tamao-driver-receipts-v1';
  const MAX_AGE_MS=12*60*60*1000;
  const MAX_SNAPSHOT_AGE_MS=4*60*60*1000;
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const pendingSync=new Set();
  let lastCachedSync=0,lastCachedScope='';
  const encoder=new TextEncoder(),decoder=new TextDecoder();
  const sessionValid=s=>Number.isSafeInteger(s?.expires_at)&&s.expires_at*1000>Date.now();

  function offlineAllowed(rt){
    const userId=String(rt?.session?.user?.id||'');
    const merchantId=String(rt?.merchant?.merchantId||'');
    // The offline shell may render before another server request is possible.
    // The cached driver role is the minimum local access gate; the server must
    // still recheck the real role, assignment and version before any mutation.
    return ['ready','unavailable'].includes(String(rt?.status||''))&&
      rt?.merchant?.memberRole==='driver'&&rt?.session?.user?.is_anonymous!==true&&
      !!rt?.session?.access_token&&sessionValid(rt?.session)&&
      UUID.test(userId)&&UUID.test(merchantId)&&
      localStorage.getItem('tamao-offline-denied:'+userId+':'+merchantId)!=='1';
  }
  function identity(){
    const rt=globalThis.merchantRuntime||{};
    const userId=String(rt.session?.user?.id||'');
    const merchantId=String(rt.merchant?.merchantId||'');
    if(globalThis.__CHAMA_TEST__===true||!['ready','unavailable'].includes(rt.status)||
       rt.merchant?.memberRole!=='driver'||!UUID.test(userId)||!UUID.test(merchantId)||
       !rt.session?.access_token||!sessionValid(rt.session))return null;
    if(localStorage.getItem('tamao-offline-denied:'+userId+':'+merchantId)==='1')return null;
    return {rt,userId,merchantId,scope:userId+':'+merchantId};
  }
  function authorizedOrder(id,{fresh=false}={}){
    const who=identity();
    if(fresh&&who?.rt.status!=='ready')return null;
    const order=who?.rt.orders?.find(o=>o.orderId===id);
    const syncTime=Date.parse(String(who?.rt.lastSyncAt||''));
    if(!who||!UUID.test(String(id||''))||!order||
       order.assignedDeliveryUserId!==who.userId||!['ARRIVING','OUT_FOR_DELIVERY'].includes(order.status)||
       !Number.isSafeInteger(order.version)||order.version<1||
       !Number.isFinite(syncTime)||Date.now()-syncTime<0||
       Date.now()-syncTime>(fresh?90000:MAX_SNAPSHOT_AGE_MS))return null;
    return {...who,order};
  }
  function openDB(){
    if(!globalThis.indexedDB||!globalThis.crypto?.subtle||!globalThis.crypto?.getRandomValues)
      return Promise.reject(new Error('Este navegador não permite armazenamento criptografado seguro.'));
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,2);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains('keys'))db.createObjectStore('keys',{keyPath:'id'});
        if(!db.objectStoreNames.contains('receipts'))db.createObjectStore('receipts',{keyPath:'id'});
        if(!db.objectStoreNames.contains('assignments'))db.createObjectStore('assignments',{keyPath:'id'});
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('Falha ao abrir armazenamento'));
      req.onblocked=()=>reject(new Error('Feche outra aba do TAMÃO e tente novamente.'));
    });
  }
  async function inStore(name,mode,operation){
    const db=await openDB();
    try{
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction(name,mode);
        let result;
        const req=operation(tx.objectStore(name));
        req.onsuccess=()=>{result=req.result};
        req.onerror=()=>reject(req.error||new Error('Armazenamento indisponível'));
        tx.onabort=()=>reject(tx.error||new Error('Gravação interrompida'));
        tx.onerror=()=>reject(tx.error||new Error('Falha de armazenamento'));
        // A request success is not a durable commit; wait for the transaction.
        tx.oncomplete=()=>resolve(result);
      });
    }finally{db.close()}
  }
  function read(name,id){return inStore(name,'readonly',store=>store.get(id))}
  function write(name,entry){return inStore(name,'readwrite',store=>store.put(entry))}
  function erase(name,id){return inStore(name,'readwrite',store=>store.delete(id))}
  const itemId=(scope,orderId)=>scope+':'+orderId;
  // One readwrite transaction is serialized across tabs by IndexedDB.
  // Never replace a newer unexpired PIN after a concurrent local save.
  async function receiptTransaction(id,mutate){
    const db=await openDB();
    try{
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction('receipts','readwrite');
        const store=tx.objectStore('receipts');
        let rejection=null;
        const request=store.get(id);
        request.onsuccess=()=>{
          try{mutate(store,request.result)}
          catch(error){
            rejection=error;
            tx.abort();
          }
        };
        request.onerror=()=>{rejection=request.error||new Error('Falha ao conferir comprovante');tx.abort()};
        tx.oncomplete=()=>resolve(true);
        tx.onabort=()=>reject(rejection||tx.error||new Error('Gravação de comprovante interrompida'));
        tx.onerror=()=>reject(tx.error||new Error('Falha de armazenamento'));
      });
    }finally{db.close()}
  }


  async function scopedKey(scope){
    let row=await read('keys',scope);
    if(row?.key)return row.key;
    const generated=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    // add (rather than put) prevents two tabs from silently replacing a key.
    try{await inStore('keys','readwrite',store=>store.add({id:scope,key:generated}))}
    catch(error){
      row=await read('keys',scope);
      if(!row?.key)throw error;
      return row.key;
    }
    return generated;
  }
  // A driver may close/reload the browser while out of signal. Store only a
  // short-lived subset of the last server-authorized assignments, never the
  // merchant's ledger or auth token. Losing a session always blocks recovery.
  async function cacheAssignments(){
    const who=identity();
    if(!who||who.rt.status!=='ready')return false;
    const checkedAt=Date.parse(String(who.rt.lastSyncAt||''));
    if(!Number.isFinite(checkedAt)||Math.abs(Date.now()-checkedAt)>90000)return false;
    if(lastCachedSync===checkedAt&&lastCachedScope===who.scope)return true;
    const orders=(Array.isArray(who.rt.orders)?who.rt.orders:[])
      .filter(o=>o?.assignedDeliveryUserId===who.userId&&['ARRIVING','OUT_FOR_DELIVERY'].includes(o.status)&&
        UUID.test(String(o.orderId||''))&&Number.isSafeInteger(o.version)&&o.version>0)
      .slice(0,30).map(o=>({
        orderId:o.orderId,publicCode:String(o.publicCode||'').slice(0,48),
        assignedDeliveryUserId:who.userId,status:o.status,version:o.version,
        addressVisible:o.addressVisible===true,
        address:o.addressVisible===true?String(o.address||'').slice(0,350):''
      }));
    const key=await scopedKey(who.scope);
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const expiresAt=Math.min(Date.now()+MAX_SNAPSHOT_AGE_MS,checkedAt+MAX_SNAPSHOT_AGE_MS);
    const payload=encoder.encode(JSON.stringify({userId:who.userId,merchantId:who.merchantId,checkedAt,orders}));
    const ciphertext=await crypto.subtle.encrypt({
      name:'AES-GCM',iv,additionalData:encoder.encode(who.scope+':assignments:2')
    },key,payload);
    await write('assignments',{
      id:who.scope,expiresAt,iv:Array.from(iv),ciphertext:Array.from(new Uint8Array(ciphertext))
    });
    lastCachedSync=checkedAt;lastCachedScope=who.scope;
    return true;
  }
  async function restoreAssignments(){
    const rt=globalThis.merchantRuntime||{};
    if(navigator.onLine!==false||rt.status!=='unavailable'||rt.merchant||
       rt.session?.user?.is_anonymous===true||!rt.session?.access_token||!sessionValid(rt.session)||
       !UUID.test(String(rt.session?.user?.id||'')))return false;
    // The selected merchant ID is just a lookup hint: the decrypted ciphertext
    // MUST match the authenticated user + merchant scope and assigned driver.
    const merchantId=String(rt.selectedMerchantId||'');
    if(!UUID.test(merchantId))return false;
    const originalSession=rt.session;
    const token=originalSession.access_token;
    const userId=String(originalSession.user.id),scope=userId+':'+merchantId;
    if(localStorage.getItem('tamao-offline-denied:'+scope)==='1')return false;
    const row=await read('assignments',scope);
    if(!row||row.id!==scope||!Number.isFinite(row.expiresAt))return false;
    if(row.expiresAt<Date.now()){await erase('assignments',scope);return false;}
    const key=await read('keys',scope);
    if(!key?.key)return false;
    const clear=await crypto.subtle.decrypt({
      name:'AES-GCM',iv:new Uint8Array(row.iv),
      additionalData:encoder.encode(scope+':assignments:2')
    },key.key,new Uint8Array(row.ciphertext));
    const decoded=JSON.parse(decoder.decode(clear));
    const checkedAt=Number(decoded.checkedAt);
    if(decoded.userId!==userId||decoded.merchantId!==merchantId||
       !Number.isFinite(checkedAt)||checkedAt>Date.now()||
       Date.now()-checkedAt>MAX_SNAPSHOT_AGE_MS||
       !Array.isArray(decoded.orders)||decoded.orders.length>30)return false;
    const orders=decoded.orders.filter(o=>
      o?.assignedDeliveryUserId===userId&&['ARRIVING','OUT_FOR_DELIVERY'].includes(o.status)&&
      UUID.test(String(o.orderId||''))&&Number.isSafeInteger(o.version)&&o.version>0);
    if(orders.length!==decoded.orders.length)return false;
    // AES-GCM/IndexedDB reads are async. A logout, account switch, role
    // revocation marker or online refresh can occur while decryption waits.
    // Never resurrect old delivery/address data into the changed session.
    if(globalThis.merchantRuntime!==rt||navigator.onLine!==false||
       rt.status!=='unavailable'||rt.merchant||
       String(rt.selectedMerchantId||'')!==merchantId||
       rt.session!==originalSession||rt.session?.access_token!==token||
       rt.session?.user?.id!==userId||!sessionValid(rt.session)||
       localStorage.getItem('tamao-offline-denied:'+scope)==='1'||
       row.expiresAt<=Date.now())return false;
    // A recovered snapshot is NEVER marked fresh or server-authoritative.
    // The usual UI may only stage a local proof, not invoke a mutation.
    rt.merchant={merchantId,memberRole:'driver'};
    rt.orders=orders;
    rt.lastSyncAt=new Date(checkedAt).toISOString();
    rt.offlineRestored=true;
    return true;
  }
  async function save(id,pin,paid,existingIdempotencyKey=null){
    const verified=authorizedOrder(id);
    if(!verified)throw new Error('Atualize a entrega com sua conta autorizada antes de guardar.');
    if(!/^[0-9]{4}$/.test(String(pin||''))||paid!==true)
      throw new Error('Informe o PIN de 4 dígitos e confirme o pagamento recebido.');
    const {scope,order}=verified;
    const idempotencyKey=typeof existingIdempotencyKey==='string'&&
      /^complete-delivery:[A-Za-z0-9_-]{16,96}$/.test(existingIdempotencyKey)
      ?existingIdempotencyKey:'complete-delivery:'+crypto.randomUUID();
    const savedAt=Date.now(),expiresAt=savedAt+MAX_AGE_MS;
    const key=await scopedKey(scope);
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const aad=encoder.encode(itemId(scope,id)+':'+order.version);
    const content=encoder.encode(JSON.stringify({
      orderId:id,version:order.version,sourceStatus:order.status,pin:String(pin),paid:true,idempotencyKey,
      savedAt,expiresAt,
      // Limited, encrypted delivery context loaded from an authorized response.
      address:order.addressVisible===true?String(order.address||'').slice(0,350):''
    }));
    const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,content);
    const receiptId=itemId(scope,id);
    const entry={id:receiptId,scope,orderId:id,version:order.version,
      savedAt,expiresAt,iv:Array.from(iv),ciphertext:Array.from(new Uint8Array(ciphertext))};
    await receiptTransaction(receiptId,(store,existing)=>{
      if(existing&&Number(existing.expiresAt)>Date.now())
        throw new Error('Já existe comprovante pendente para este pedido. Confira ou descarte antes de substituir.');
      store.put(entry);
    });
    return true;
  }
  async function pending(){
    const who=identity();
    if(!who)return [];
    const all=await inStore('receipts','readonly',store=>store.getAll());
    const current=[];
    for(const item of all){
      if(item.scope!==who.scope)continue;
      if(item.expiresAt<=Date.now()){
        // Do not erase a newer receipt written by another tab after getAll.
        await receiptTransaction(item.id,(store,current)=>{
          if(current&&Number(current.expiresAt)<=Date.now())store.delete(item.id);
        });
        continue;
      }
      current.push({orderId:item.orderId,version:item.version,savedAt:item.savedAt,receiptIv:item.iv});
    }
    return current.sort((a,b)=>a.savedAt-b.savedAt);
  }
  async function recover(who,id){
    const row=await read('receipts',itemId(who.scope,id));
    if(!row||row.scope!==who.scope||row.orderId!==id||row.expiresAt<=Date.now())
      throw new Error('Comprovante inexistente ou expirado. Confira a entrega com a revenda.');
    const key=await read('keys',who.scope);
    if(!key?.key)throw new Error('A chave deste aparelho não está disponível.');
    const decrypted=await crypto.subtle.decrypt({
      name:'AES-GCM',iv:new Uint8Array(row.iv),
      additionalData:encoder.encode(row.id+':'+row.version)
    },key.key,new Uint8Array(row.ciphertext));
    const content=JSON.parse(decoder.decode(decrypted));
    const sourceStatus=content.sourceStatus??'ARRIVING'; // pre-upgrade drafts were ARRIVING only
    if(content.orderId!==id||content.version!==row.version||
       content.expiresAt!==row.expiresAt||content.paid!==true||
       !['ARRIVING','OUT_FOR_DELIVERY'].includes(sourceStatus)||
       !/^[0-9]{4}$/.test(content.pin)||
       !/^complete-delivery:[A-Za-z0-9_-]{16,96}$/.test(content.idempotencyKey))
      throw new Error('O comprovante local não passou na verificação.');
    // Exact encrypted record identity; used to guard cleanup across browser tabs.
    return {...content,sourceStatus,receiptIv:row.iv};
  }
  function localReceiptFormState(id,saved){
    // The staging form is not the live delivery confirmation form. Never
    // change any online button when a receipt exists on this device.
    const button=document.getElementById('live-deliver-submit-'+id);
    if(!button?.closest?.('.merchant-driver-local-card'))return;
    const guide=document.getElementById('live-delivery-guide-'+id);
    const pin=document.getElementById('live-pin-'+id);
    const paid=document.getElementById('live-paid-'+id);
    if(saved){
      button.disabled=true;
      button.textContent='Comprovante guardado (pendente)';
      if(pin){pin.value='';pin.disabled=true}
      if(paid){paid.checked=false;paid.disabled=true}
      if(guide)guide.textContent='Guardado neste aparelho. A entrega só será confirmada após conferência online.';
    }else if(button.textContent==='Comprovante guardado (pendente)'){
      button.disabled=true;
      button.textContent='Guardar comprovante (pendente)';
      if(pin)pin.disabled=false;
      if(paid)paid.disabled=false;
      if(guide)guide.textContent='Informe PIN e recebimento para guardar um novo comprovante local.';
    }
  }
  async function saveFromUi(id,previousInput=null){
    const data=previousInput&&typeof previousInput==='object'?previousInput:
      globalThis.merchantDeliveryConfirmationState?.(id);
    try{
      await save(id,data?.pin,data?.paid,data?.idempotencyKey);
      const field=document.getElementById('live-pin-'+id);
      if(field)field.value='';
      localReceiptFormState(id,true);
      globalThis.toast?.('Comprovante protegido neste aparelho. PENDENTE de confirmação online.');
      await showPending();
    }catch(error){globalThis.toast?.(String(error?.message||error))}
  }
  async function discard(id,selectedIv){
    const who=identity();
    if(!who||!UUID.test(String(id||''))||!Array.isArray(selectedIv)||selectedIv.length!==12)return;
    if(pendingSync.has(id)){
      globalThis.toast?.('Este comprovante está sendo conferido. Aguarde a resposta do servidor.');
      return;
    }
    if(typeof confirm!=='function'||!confirm('Excluir o comprovante local? A entrega continuará pendente no servidor.'))return;
    const receiptId=itemId(who.scope,id);
    // Bind the UI button to the IV that it displayed, not a row read later.
    // A second tab can replace the proof between rendering and this click.
    await receiptTransaction(receiptId,(store,current)=>{
      if(current?.scope===who.scope&&Array.isArray(current.iv)&&
         current.iv.length===selectedIv.length&&
         current.iv.every((byte,i)=>byte===selectedIv[i]))
        store.delete(receiptId);
    });
    await showPending();
  }
  function deliveredOnServer(id,who,receipt){
    // A successful HTTP response alone is not proof of final delivery. Only a
    // recently applied, authenticated merchant-orders snapshot can settle a
    // local receipt, including when the original HTTP ACK was lost.
    const current=identity();
    const rt=current?.rt;
    if(!current||current.scope!==who.scope||current.userId!==who.userId||
       rt.status!=='ready'||(rt.selectedMerchantId&&rt.selectedMerchantId!==who.merchantId))
      return false;
    const checkedAt=Date.parse(String(rt.lastSyncAt||''));
    if(!Number.isFinite(checkedAt)||checkedAt>Date.now()||
       Date.now()-checkedAt>90000)return false;
    // Driver merchant-orders deliberately excludes terminal statuses from
    // orders. Only its separate read-only, assigned-driver terminal proof can
    // attest to an actual DELIVERED/SETTLED server transition.
    const order=(Array.isArray(rt.recentClosedDeliveries)?rt.recentClosedDeliveries:[])
      .find(o=>o?.orderId===id);
    const expectedVersion=receipt.version+(receipt.sourceStatus==='OUT_FOR_DELIVERY'?2:1);
    return !!order&&order.assignedDeliveryUserId===who.userId&&
      ['DELIVERED','SETTLED'].includes(order.status)&&
      Number.isSafeInteger(order.version)&&order.version===expectedVersion;
  }
  async function eraseAcknowledgedReceipt(who,id,receipt){
    // Never erase a newer encrypted proof created in another tab.
    await receiptTransaction(itemId(who.scope,id),(store,current)=>{
      if(current?.scope===who.scope&&Array.isArray(current.iv)&&
         current.iv.length===receipt.receiptIv.length&&
         current.iv.every((byte,i)=>byte===receipt.receiptIv[i]))
        store.delete(itemId(who.scope,id));
    });
  }
  async function reconcile(id){
    const who=identity();
    if(!who||!UUID.test(String(id||''))||pendingSync.has(id))return;
    if(navigator.onLine===false){
      globalThis.toast?.('Sem conexão. O comprovante continua protegido neste aparelho.');
      return;
    }
    pendingSync.add(id);
    try{
      if(who.rt.actionPending)throw new Error('Outra operação está em andamento. Tente novamente.');
      // No local state can authorize the arriving or delivery mutations.
      // Both actions require a freshly reloaded server-assigned order.
      await globalThis.merchantRefresh({silent:true});
      const receipt=await recover(who,id);
      if(deliveredOnServer(id,who,receipt)){
        // Lost ACK: the server has already confirmed the exact next version.
        // Do not send PIN or arrival a second time.
        await eraseAcknowledgedReceipt(who,id,receipt);
        globalThis.toast?.('Entrega confirmada pelo servidor. Comprovante local conferido.');
        return;
      }
      let current=authorizedOrder(id,{fresh:true});
      if(!current||current.scope!==who.scope||current.userId!==who.userId)
        throw new Error('O pedido mudou, foi cancelado ou deixou de estar atribuído. Confira com a revenda.');
      if(receipt.sourceStatus==='OUT_FOR_DELIVERY'){
        if(current.order.status==='OUT_FOR_DELIVERY'&&current.order.version===receipt.version){
          await globalThis.merchantPerformAction(id,'arriving');
          // An arriving ACK is insufficient without a fresh authorized state.
          await globalThis.merchantRefresh({silent:true});
          current=authorizedOrder(id,{fresh:true});
        }
        // If an earlier arrival ACK was lost, its exact next version may
        // already be ARRIVING. Do not perform the arrival transition twice.
        if(!current||current.scope!==who.scope||current.userId!==who.userId||
           current.order.status!=='ARRIVING'||current.order.version!==receipt.version+1)
          throw new Error('A chegada ou a versão do pedido não foi confirmada. Confira com a revenda.');
      }else if(current.order.status!=='ARRIVING'||current.order.version!==receipt.version){
        throw new Error('Versão do pedido mudou. A confirmação requer revisão da revenda.');
      }
      const acknowledged=await globalThis.merchantCompleteDeliveryLive(id,receipt.pin,true,receipt.idempotencyKey);
      // The canonical helper may return a positive HTTP ACK even when its
      // follow-up merchant-orders refresh fails. Do NOT clear the proof until
      // the authenticated snapshot confirms the exact completed version.
      if(!acknowledged||!deliveredOnServer(id,who,receipt))
        throw new Error('A confirmação final não apareceu nos pedidos atualizados. O comprovante permanece pendente.');
      await eraseAcknowledgedReceipt(who,id,receipt);
      globalThis.toast?.('Entrega confirmada pelo servidor. Comprovante local conferido.');
    }catch(error){
      globalThis.toast?.('Permanece pendente: '+String(error?.message||error));
    }finally{
      pendingSync.delete(id);
      await showPending();
    }
  }
  async function showPending(){
    const host=document.getElementById('merchant-offline-receipts');
    if(!host)return;
    const section=host.parentElement?.classList?.contains('merchant-driver-receipts')
      ?host.parentElement:null;
    if(!identity()){
      if(section)section.hidden=true;
      return;
    }
    host.replaceChildren();
    try{
      const records=await pending();
      const stagedIds=new Set(records.map(r=>r.orderId));
      for(const order of Array.isArray(globalThis.merchantRuntime?.orders)?globalThis.merchantRuntime.orders:[])
        if(UUID.test(String(order?.orderId||'')))
          localReceiptFormState(order.orderId,stagedIds.has(order.orderId));
      if(!records.length){
        if(section)section.hidden=true;
        host.textContent='Nenhum comprovante local pendente.';
        return;
      }
      if(section)section.hidden=false;
      const intro=document.createElement('p');
      intro.textContent='Entrega física anotada, não concluída no TAMÃO. Entre online com a mesma conta para conferir.';
      host.appendChild(intro);
      for(const receipt of records){
        const block=document.createElement('div');
        block.className='notice merchant-driver-local-receipt';
        const title=document.createElement('strong');
        title.textContent='Pedido '+receipt.orderId.slice(0,8)+' • aguardando servidor';
        block.appendChild(title);
        const send=document.createElement('button');
        send.type='button';send.className='secondary small';
        send.textContent='Conferir e enviar';send.disabled=navigator.onLine===false;
        send.addEventListener('click',()=>reconcile(receipt.orderId));
        block.appendChild(send);
        const remove=document.createElement('button');
        remove.type='button';remove.className='ghost small';
        remove.textContent='Descartar local';remove.addEventListener('click',()=>discard(receipt.orderId,receipt.receiptIv));
        block.appendChild(remove);
        host.appendChild(block);
      }
    }catch(error){
      if(section)section.hidden=false;
      host.textContent='Não foi possível ler os comprovantes protegidos: '+String(error?.message||error);
    }
  }
  function offlineConfirmationChanged(id){
    // The shared form validates the PIN and enables the button, but its normal
    // online success copy must not describe an offline draft as a delivery.
    const ready=globalThis.merchantDeliveryConfirmationChanged?.(id)===true;
    const guide=document.getElementById('live-delivery-guide-'+id);
    if(guide&&ready)guide.textContent=
      'PIN e recebimento informados. Guarde o comprovante neste aparelho; a entrega continua pendente de validação online.';
    return ready;
  }
  function merchantDriverOfflineQueue(rt){
    // A stale authorized snapshot may stage a local receipt but NEVER an API action.
    const last=Date.parse(String(rt?.lastSyncAt||''));
    const elapsed=Date.now()-last;
    const userId=String(rt?.session?.user?.id||'');
    if(!['ready','unavailable'].includes(String(rt?.status||''))||
       rt?.merchant?.memberRole!=='driver'||!rt?.session?.access_token||
       !sessionValid(rt.session)||
       localStorage.getItem('tamao-offline-denied:'+userId+':'+rt.merchant.merchantId)==='1'||
       !/^[0-9a-f-]{36}$/i.test(userId)||!Number.isFinite(elapsed)||
       elapsed<0||elapsed>4*60*60*1000)return '';
    const assigned=(Array.isArray(rt.orders)?rt.orders:[]).filter(o=>
      o?.assignedDeliveryUserId===userId&&['ARRIVING','OUT_FOR_DELIVERY'].includes(o?.status)&&
      /^[0-9a-f-]{36}$/i.test(String(o?.orderId||''))&&
      Number.isSafeInteger(o.version)&&o.version>0);
    if(!assigned.length)return '';
    return '<section class="section merchant-driver-local-queue" aria-label="Entregas para registro local">'+
      '<h2>Entregas carregadas neste aparelho</h2>'+
      '<p>Sem confirmação atual do servidor. Esta anotação é apenas local, não conclui nem liquida pedidos.</p>'+
      assigned.map(o=>{
        const id=esc(o.orderId);
        const address=o.addressVisible===true?String(o.address||'Endereço não disponível'):'Endereço não disponível';
        const beforeArrival=o.status==='OUT_FOR_DELIVERY';
        return `<article class="order-card merchant-driver-local-card">
          <strong>Pedido ${esc(o.publicCode||o.orderId)}</strong>
          <p>${esc(address)}</p>
          ${beforeArrival?'<p class="muted">Chegada ainda não registrada. Ela será conferida online antes de concluir.</p>':''}
          <label class="check-row"><input type="checkbox" id="live-paid-${id}"
            onchange="merchantOfflineConfirmationChanged('${id}')">
            <span>Pagamento recebido pessoalmente</span></label>
          <label for="live-pin-${id}">Código informado pelo cliente</label>
          <input id="live-pin-${id}" type="text" inputmode="numeric" pattern="[0-9]{4}"
            maxlength="4" autocomplete="off" class="input"
            oninput="merchantOfflineConfirmationChanged('${id}')">
          <div id="live-delivery-guide-${id}" role="status">A entrega continuará pendente no servidor.</div>
          <button id="live-deliver-submit-${id}" class="primary" type="button" disabled
            onclick="merchantOfflineDeliverySaveFromUi('${id}')">Guardar comprovante (pendente)</button>
        </article>`;
      }).join('')+'</section>';
  }
  globalThis.merchantDriverOfflineAllowed=offlineAllowed;
  globalThis.merchantOfflineDeliveryCacheAssignments=cacheAssignments;
  globalThis.merchantOfflineDeliveryRestore=restoreAssignments;
  globalThis.merchantOfflineConfirmationChanged=offlineConfirmationChanged;
  globalThis.merchantDriverOfflineQueue=merchantDriverOfflineQueue;
  globalThis.merchantOfflineDeliverySaveFromUi=saveFromUi;
  globalThis.merchantOfflineDeliveryShowPending=showPending;
  globalThis.merchantOfflineDeliveryReconcile=reconcile;
})();
