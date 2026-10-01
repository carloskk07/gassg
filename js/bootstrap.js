let renderLock=false;
function render(){
  if(renderLock)return;
  renderLock=true;
  try{
    housekeeping();
    const r=route();
    const pages={home,order:orderPage,tracking,club,refer,merchants:merchantsLanding,'merchant-join':merchantJoin,merchant:merchantPage,'merchant-orders':merchantOrders,catalog,'merchant-metrics':merchantMetrics};
    const app=document.querySelector('#app');
    if(app)app.innerHTML=(pages[r]||home)();
  }catch(e){
    globalThis.__lastRenderError=String(e?.stack||e?.message||e);
    console.error('Falha de renderização',e);
    const app=document.querySelector('#app');
    if(app)app.innerHTML='<main class="shell page"><div class="notice danger"><strong>Não foi possível carregar esta tela.</strong><br>Recarregue a página. Se o problema continuar, reinicie a demonstração.</div></main>';
  }finally{renderLock=false}
}
window.addEventListener('hashchange',render);
window.addEventListener('storage',e=>{
  if([STORAGE,LEGACY_STORAGE].includes(e.key)){state=load();render()}
});
window.addEventListener('error',e=>console.error('Erro global',e.error||e.message));
window.addEventListener('unhandledrejection',e=>console.error('Promise rejeitada',e.reason));

window.addEventListener('load',async()=>{
  render();
  if(globalThis.merchantPortalRequested?.()){
    await merchantBackendInit();
    if(!['merchant','merchant-orders','catalog','merchant-metrics','merchants','merchant-join'].includes(route()))go('merchant');
    render();
  }else if(globalThis.liveRequested?.()){
    await backendInit();
    if(globalThis.liveReady?.()&&route()==='order'&&state.address&&hasCartItems()){
      try{await liveRefreshOffers({silent:true})}catch{}
    }
    render();
  }
  if('serviceWorker'in navigator&&location.protocol.startsWith('http')){
    try{
      const reg=await navigator.serviceWorker.register('./sw.js');
      reg.update().catch(()=>{});
    }catch(e){console.warn('Service worker indisponível',e)}
  }
  setInterval(()=>{
    if(!globalThis.liveRequested?.()&&!globalThis.merchantPortalRequested?.()&&housekeeping())render();
    if(globalThis.liveReady?.())livePoll().catch(()=>{});
    if(globalThis.merchantReady?.())merchantPoll().catch(()=>{});
  },5000);
});

Object.assign(window,{
  go,setMode,startOrder,quickProduct,setAddress,qty,checkout,setPaymentMethod,toggleCashback,
  confirmRequote,cancelPending,shareReferral,activateCashAccount,joinMerchant,selectMerchant,toggleOnline,
  merchantUpdate,merchantAction,reset,
  merchantLoginFromUi,merchantLiveRefresh,merchantLiveSelect,merchantLiveToggleOnline,
  merchantLiveSaveP13,merchantLiveSaveLogistics,merchantLiveAction,merchantLiveCannotFulfill,
  merchantLiveDeliver,merchantLiveLogout
});
