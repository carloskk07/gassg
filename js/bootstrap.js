/* V1.371 — Page identity and accessible navigation for public visitors.
   Client-side titles improve browser context. Hash URLs retain the site's
   current canonical policy; this does not claim independent SEO indexing. */
const TAMAO_PUBLIC_PAGE_IDENTITY=Object.freeze({
  home:['TAMÃO — Gás, água e essenciais perto de você','Escolha gás, água e outros essenciais, consulte a disponibilidade para seu CEP e acompanhe seu pedido pelo TAMÃO.'],
  learn:['Como funciona o TAMÃO — Do pedido à entrega','Entenda como escolher produtos, consultar o preço total, receber a confirmação da revenda e acompanhar a entrega.'],
  earn:['Rede TAMÃO — Indicações e benefícios','Convide pessoas e revendas, acompanhe suas indicações e conheça as condições dos benefícios da Rede TAMÃO.'],
  club:['Clube TAMÃO — Benefícios para suas compras','Consulte seu cashback, histórico e benefícios de compras elegíveis no Clube TAMÃO.'],
  refer:['Minha Rede TAMÃO — Convites e indicações','Compartilhe seu convite pessoal e acompanhe indicações e benefícios conforme as regras de cada campanha.'],
  merchants:['Para revendas — Venda pelo TAMÃO','Apresente sua empresa a novos clientes da região. Você controla preços, produtos, estoque e entregas.'],
  professionals:['Profissionais — TAMÃO','Busque profissionais por cidade e entre em contato diretamente com os anunciantes.'],
  rides:['Caronas — TAMÃO','Consulte viagens compartilhadas anunciadas, trajetos e contatos diretos.'],
  stays:['Hospedagens no Brasil — TAMÃO','Conheça hospedagens anunciadas e converse diretamente com os responsáveis.'],
  mobility:['Corrida — TAMÃO','Moto, carro e GPS com consentimento.'],
  advertise:['Anunciar no TAMÃO — Meus anúncios','Cadastre seus serviços, caronas e hospedagens para revisão no TAMÃO.'],
  sponsors:['Para marcas — Divulgue no TAMÃO','Conheça opções de divulgação regional, campanhas de benefício e parcerias com o comércio local.'],
  contact:['Contato — TAMÃO','Fale com o TAMÃO sobre compras, revendas, publicidade, parceria ou atendimento.'],
  privacy:['Privacidade — TAMÃO','Veja como o TAMÃO trata dados pessoais e protege sua privacidade.'],
  terms:['Termos de uso — TAMÃO','Consulte as condições de utilização da plataforma TAMÃO.'],
  order:['Escolher produtos — TAMÃO','Monte sua cesta e consulte ofertas e condições para seu endereço antes de confirmar.'],
  tracking:['Acompanhar meu pedido — TAMÃO','Consulte as etapas registradas do seu pedido TAMÃO.']
});
function updatePublicPageIdentity(page){
  if(globalThis.adminPortalRequested?.()||globalThis.merchantPortalRequested?.())return;
  const identity=TAMAO_PUBLIC_PAGE_IDENTITY[page]||TAMAO_PUBLIC_PAGE_IDENTITY.home;
  document.title=identity[0];
  const description=document.querySelector('meta[name="description"]');
  description?.setAttribute('content',identity[1]);
}
function announcePublicPageNavigation(){
  if(globalThis.adminPortalRequested?.()||globalThis.merchantPortalRequested?.())return;
  const identity=TAMAO_PUBLIC_PAGE_IDENTITY[route()];
  if(!identity)return;
  const main=document.getElementById('tamao-main');
  if(!main)return;
  const heading=main.querySelector('h1');
  const target=heading||main;
  target.setAttribute('tabindex','-1');
  window.scrollTo?.(0,0);
  target.focus?.({preventScroll:true});
  const announcement=document.getElementById('tamao-route-announcement');
  if(announcement)announcement.textContent=heading?.textContent?.trim()||identity[0];
}
/* V1.375 — Explicit, allowlisted marketing entry points.
   UTMs and referral hints stay in the query string; this only chooses which
   existing public page to show, without auth, cart or order mutations. */
function tamaoPublicEntryIntent(){
  try{
    const value=String(new URLSearchParams(location.search).get('entrada')||'').trim().toLowerCase();
    return ['revenda','cadastro-revenda','marca','indicar','agua','gas'].includes(value)?value:'';
  }catch{return ''}
}
let tamaoSignupHandoffAttempted=false;
function tamaoPublicEntryRoute(){
  if(globalThis.adminPortalRequested?.()||globalThis.merchantPortalRequested?.()||
     globalThis.__CHAMA_TEST__===true||globalThis.CHAMA_INTERNAL_PILOT===true)return false;
  // A visitor's explicit link to a page always takes precedence.
  if(String(location.hash||'').length>0)return false;
  const intent=tamaoPublicEntryIntent();
  if(intent==='cadastro-revenda'){
    // Distinguish a real registration from generic commercial discovery.
    // No origin configured: keep the person on a useful public route.
    const target=typeof buildPortalHref==='function'
      ?buildPortalHref(globalThis.CHAMA_MERCHANT_ORIGIN,'merchant'):null;
    if(!target||typeof openMerchantPortal!=='function'){
      go('merchants');
      return true;
    }
    if(tamaoSignupHandoffAttempted)return true;
    tamaoSignupHandoffAttempted=true;
    openMerchantPortal(true);
    return true;
  }
  const destination={revenda:'merchants',marca:'sponsors',indicar:'earn'}[intent];
  if(!destination)return false;
  go(destination);
  return true;
}
let discoveryModuleRequested=false;
let discoveryModuleError=false;
function discoveryLoadingPage(){
  return shell('<section class="section"><h1>Consultando anúncios do TAMÃO</h1>'+
    (discoveryModuleError
      ?'<p>Não foi possível abrir a consulta agora.</p><button class="secondary" type="button" onclick="retryDiscoveryModule()">Tentar novamente</button>'
      :'<p role="status">Preparando a consulta de anúncios publicados…</p>')+'</section>');
}
function retryDiscoveryModule(){
  discoveryModuleRequested=false;discoveryModuleError=false;
  discoveryRequestModule();
  render();
}
function discoveryRequestModule(){
  if(discoveryModuleRequested||typeof discoveryPage==='function')return;
  if(!['professionals','rides','stays'].includes(route())||
    globalThis.adminPortalRequested?.()||globalThis.merchantPortalRequested?.())return;
  discoveryModuleRequested=true;
  const source=document.querySelector('script[src*="/js/bootstrap.js"]')?.src||'';
  let version='';
  try{version=new URL(source,location.href).searchParams.get('v')||'';}catch{}
  const suffix=/^[A-Za-z0-9._-]{1,120}$/.test(version)?'?v='+encodeURIComponent(version):'';
  const css=document.createElement('link');
  css.rel='stylesheet';css.href='./css/discovery.css'+suffix;
  document.head.appendChild(css);
  const script=document.createElement('script');
  script.src='./js/discovery.js'+suffix;
  script.onload=()=>render();
  script.onerror=()=>{discoveryModuleError=true;render();};
  document.head.appendChild(script);
}
let mobilityModuleRequested=false,mobilityModuleError=false;
function mobilityReturnIntent(){
 try{return new URLSearchParams(location.search).get('mobility')==='1'}catch{return false}
}
function mobilityLoadingPage(){
 return shell('<section><h1>Solicitações de moto e carro</h1>'+
  (mobilityModuleError?'<p role="alert">Falha ao abrir o acompanhamento.</p>'+
   '<button onclick="mobilityRetryModule()">Tentar novamente</button>':
   '<p role="status">Preparando…</p>')+'</section>');
}
function mobilityRetryModule(){
 mobilityModuleRequested=mobilityModuleError=false;mobilityRequestModule();render();
}
function mobilityRequestModule(){
 if(mobilityModuleRequested||mobilityModuleError||typeof mobilityPage==='function'||
  (route()!=='mobility'&&!mobilityReturnIntent())||
  globalThis.adminPortalRequested?.()||globalThis.merchantPortalRequested?.())return;
 mobilityModuleRequested=true;
 const s=document.createElement('script');
 s.src='./js/mobility.js'+(document.querySelector('script[src*="/js/bootstrap.js"]')?.src.match(/\?v=[A-Za-z0-9._-]+/)?.[0]||'');
 s.onload=()=>render();s.onerror=()=>{mobilityModuleError=true;render()};
 document.head.appendChild(s);
}
let discoveryOwnerModuleRequested=false;
let discoveryOwnerModuleError=false;
// Email OTP callbacks may replace the URL fragment (#advertise) with auth
// tokens. Keep the non-sensitive route intent in the query until Supabase
// consumes the callback, then restore the regular #advertise route.
function discoveryOwnerReturnPending(){
  if(globalThis.adminPortalRequested?.()||globalThis.merchantPortalRequested?.())return false;
  try{return new URLSearchParams(location.search).get('advertise')==='1';}
  catch{return false;}
}
function discoveryOwnerLoadingPage(){
  return shell('<section class="section"><h1>Meus anúncios TAMÃO</h1>'+
    (discoveryOwnerModuleError?
      '<p>Não foi possível abrir sua área agora.</p><button class="secondary" type="button" onclick="retryDiscoveryOwnerModule()">Tentar novamente</button>':
      '<p role="status">Preparando a área de anúncios…</p>')+'</section>');
}
function retryDiscoveryOwnerModule(){
  discoveryOwnerModuleRequested=false;discoveryOwnerModuleError=false;
  discoveryOwnerRequestModule();render();
}
function discoveryOwnerRequestModule(){
  if(discoveryOwnerModuleRequested||typeof discoveryOwnerPage==='function')return;
  if((route()!=='advertise'&&!discoveryOwnerReturnPending())||
     globalThis.adminPortalRequested?.()||globalThis.merchantPortalRequested?.())return;
  discoveryOwnerModuleRequested=true;
  const source=document.querySelector('script[src*="/js/bootstrap.js"]')?.src||'';
  let version='';
  try{version=new URL(source,location.href).searchParams.get('v')||'';}catch{}
  const suffix=/^[A-Za-z0-9._-]{1,120}$/.test(version)?'?v='+encodeURIComponent(version):'';
  if(!document.querySelector('link[href*="css/discovery.css"]')){
    const css=document.createElement('link');
    css.rel='stylesheet';css.href='./css/discovery.css'+suffix;
    document.head.appendChild(css);
  }
  const script=document.createElement('script');
  script.src='./js/discovery-owner.js'+suffix;
  script.onload=()=>render();
  script.onerror=()=>{discoveryOwnerModuleError=true;render();};
  document.head.appendChild(script);
}
let renderLock=false;
function render(){
  if(renderLock)return;
  renderLock=true;
  try{
    if(!globalThis.adminPortalRequested?.())housekeeping();
    // An OTP response can temporarily contain #access_token=... in place of
    // #advertise. Keep the advertiser workspace visible, not the home/menu,
    // while its lazy SDK safely finishes the auth callback.
    const r=discoveryOwnerReturnPending()?'advertise':
      mobilityReturnIntent()?'mobility':route();
    const pages={home,learn,earn,order:orderPage,tracking,club,refer,merchants:merchantsLanding,sponsors:sponsorsLanding,professionals:typeof discoveryPage==='function'?discoveryPage:discoveryLoadingPage,rides:typeof discoveryPage==='function'?discoveryPage:discoveryLoadingPage,stays:typeof discoveryPage==='function'?discoveryPage:discoveryLoadingPage,advertise:typeof discoveryOwnerPage==='function'?discoveryOwnerPage:discoveryOwnerLoadingPage,mobility:typeof mobilityPage==='function'?mobilityPage:mobilityLoadingPage,'merchant-join':merchantJoin,...(typeof merchantPage==='function'?{merchant:merchantPage,'merchant-orders':merchantOrders,'merchant-team':merchantTeamPage,catalog,'merchant-metrics':merchantMetrics}:{}),privacy:privacyPage,terms:termsPage,contact:contactPage,admin:(typeof adminPage==='function'?adminPage:home)};
    const app=document.querySelector('#app');
    if(app)app.innerHTML=(pages[r]||home)();
    updatePublicPageIdentity(r);
    queueMicrotask(()=>globalThis.marketingAnalyticsAfterRender?.());
    queueMicrotask(()=>globalThis.discoveryAfterRender?.());
    queueMicrotask(()=>discoveryRequestModule());
    queueMicrotask(()=>globalThis.discoveryOwnerAfterRender?.());
    queueMicrotask(()=>discoveryOwnerRequestModule());
    queueMicrotask(()=>globalThis.mobilityAfterRender?.());
    queueMicrotask(()=>mobilityRequestModule());
  }catch(e){
    globalThis.__lastRenderError=String(e?.stack||e?.message||e);
    console.error('Falha de renderização',e);
    const app=document.querySelector('#app');
    if(app)app.innerHTML='<main class="shell page"><div class="notice danger"><strong>Não foi possível carregar esta tela.</strong><br>Recarregue a página. Se o problema continuar, tente novamente mais tarde.</div></main>';
  }finally{renderLock=false}
}
window.addEventListener('hashchange',()=>{
  render();
  announcePublicPageNavigation();
});
window.addEventListener('storage',e=>{
  if([STORAGE,LEGACY_STORAGE].includes(e.key)){state=load();render()}
});
window.addEventListener('error',e=>console.error('Erro global',e.error||e.message));
window.addEventListener('unhandledrejection',e=>console.error('Promise rejeitada',e.reason));
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&globalThis.merchantPortalRequested?.()){
    globalThis.merchantWakeSync?.('visible')?.catch?.(()=>{});
  }
});
window.addEventListener('online',()=>{
  if(globalThis.merchantPortalRequested?.()){
    globalThis.merchantWakeSync?.('online')?.catch?.(()=>{});
  }
});

// The public visitor can see the real home after deferred scripts load, without
// waiting for media. Protected portal callback consumption remains in the load
// handler before the first admin/merchant render.
window.addEventListener('DOMContentLoaded',()=>{
  if(globalThis.adminPortalRequested?.()||globalThis.merchantPortalRequested?.())return;
  tamaoPublicEntryRoute();
  render();
});
window.addEventListener('load',async()=>{
  if(globalThis.adminPortalRequested?.()){
    await adminBackendInit();
    if(route()!=='admin')go('admin');
    render();
  }else if(globalThis.merchantPortalRequested?.()){
    await merchantBackendInit();
    const invitedPartner=Boolean(globalThis.merchantPilotInviteToken?.()||globalThis.merchantProspectInviteToken?.());
    // A new revenda may have no invite: resume its actual signup after the
    // OTP callback instead of stranding the owner on the generic login panel.
    // This only changes navigation; it never grants merchant permissions.
    const returningToSignup=new URLSearchParams(location.search).get('signup')==='1';
    if((invitedPartner||returningToSignup)&&globalThis.merchantRuntime?.status==='no-access'){
      if(route()!=='merchant-join')go('merchant-join');
    }else if(!['merchant','merchant-orders','merchant-team','catalog','merchant-metrics','merchants','merchant-join'].includes(route())){
      go('merchant');
    }
    render();
  }else{
    tamaoPublicEntryRoute();
    render();
    if(globalThis.liveRequested?.()){
      await backendInit();
      if(globalThis.liveReady?.()&&route()==='order'&&state.address&&hasCartItems()){
        try{await liveRefreshOffers({silent:true})}catch{}
      }
      render();
    }
  }
  if('serviceWorker'in navigator&&location.protocol.startsWith('http')){
    try{
      const reg=await navigator.serviceWorker.register('./sw.js');
      reg.update().catch(()=>{});
    }catch(e){console.warn('Service worker indisponível',e)}
  }
  if(globalThis.merchantReady?.())globalThis.merchantPushCheckLive?.().catch(()=>{});
  setInterval(()=>{
    if(!globalThis.liveRequested?.()&&!globalThis.merchantPortalRequested?.()&&!globalThis.adminPortalRequested?.()&&housekeeping())render();
    if(globalThis.liveReady?.())livePoll().catch(()=>{});
    if(globalThis.merchantPortalRequested?.())merchantPoll().catch(()=>{});
    if(globalThis.adminReady?.())adminPoll().catch(()=>{});
  },5000);
});

Object.assign(window,{
  go,setMode,openSponsorContact,publicLandingJump,startOrder,quickProduct,homeChooseProduct,startHomeBrowse,homeFilterProducts,homeDiscoverFocus,buyerCartFilter,customerCheckoutFocusStep,setAddress,deliveryAddressDraftChanged,qty,checkout,setPaymentMethod,toggleCashback,
  confirmRequote,cancelBeforeDispatch,cancelPending,shareReferral,shareTamaoGrowthInvite,activateCashAccount,joinMerchant,merchantPickOwnApplicationFromUi,reset,homeRefreshQuotePrices
});
// The customer portal must not resolve partner function identifiers while
// registering inline event handlers. Partner/admin portals keep their full
// existing action set and route map.
if(typeof merchantPage==='function')Object.assign(window,{
  selectMerchant,toggleOnline,merchantUpdate,merchantAction,
  merchantLoginFromUi,merchantLiveRefresh,merchantLiveSelect,merchantLiveToggleOnline,merchantWorkspaceJump,
  merchantLiveSaveP13,merchantLiveSaveProduct,merchantLiveSaveLogistics,merchantLiveAction,merchantLiveCannotFulfill,
  merchantLiveDeliver,merchantLiveAssignDelivery,merchantLiveSaveMemberProfile,
  merchantEnableAlertsFromUi,merchantDisableAlertsFromUi,merchantPushEnableFromUi,merchantPushDisableFromUi,merchantPushDiagnoseFromUi,merchantPushTestFromUi,merchantPushLastFromUi,merchantPushReportFromUi,merchantPushCorrectChromeWarningFromUi,
  merchantOpenTeam,merchantTeamReloadFromUi,merchantTeamInviteFromUi,merchantTeamRevokeMemberFromUi,merchantTeamRevokeInviteFromUi,copyMerchantTeamInstructions,
  merchantGrowthLoadFromUi,merchantGrowthShareFromUi,
  merchantClubeInterestLoadFromUi,merchantClubeInterestRegisterFromUi,merchantClubeInterestWithdrawFromUi,
  merchantClubeTermsLoadFromUi,merchantClubeTermsReplyFromUi,
  merchantLiveLogout
});
// Admin modules are deliberately absent from the customer/merchant bundles.
// Never evaluate admin-only callback identifiers on those origins.
if(typeof adminPage==='function')Object.assign(window,{
  adminLoginFromUi,adminRetryBootstrapFromUi,adminRefresh,adminSignOut,adminFinanceLabPreviewFromUi,adminFinanceLabSandboxPixFromUi,adminFinanceLabCopySandboxPixFromUi,adminFinanceLabReadinessFromUi,adminFinanceLabCheckOrderFromUi,adminFinanceLabDiagnoseChargesFromUi,adminSetFinanceWorkspace,adminCheckBillingProviderHealth,adminLoadGovernanceGates,adminGovernanceChangeCityPause,adminGovernanceChangeCityCommerce,adminPushReliabilityLoadFromUi,adminApproveApplication,adminRejectApplication,adminSaveCompliance,adminSetMerchantStatus,adminFinancial,adminReverseOrder,adminGrowthBenefitPreviewFromUi,adminClubeCouponPreviewFromUi,adminClubeLaunchReadinessLoadFromUi,adminClubeInterestLoadFromUi,adminClubeCampaignLoadFromUi,adminClubeCampaignReviewFromUi,adminClubeTermsLoadFromUi,adminClubeTermsSaveFromUi,adminOwnerFundingLoadFromUi,adminOwnerFundingSaveFromUi,adminOwnerEvidenceLoadFromUi,adminOwnerEvidenceSubmitFromUi,adminOwnerEvidenceReviewFromUi,adminOwnerBudgetLoadFromUi,adminOwnerBudgetAllocateFromUi,adminOwnerBudgetReleaseFromUi,
  ...(typeof adminOwnerFinanceLoadFromUi==='function'?{
    adminOwnerFinanceLoadFromUi,adminOwnerFinanceSelectFromUi,adminOwnerFinanceHistoryLoadFromUi,adminOwnerCampaignSignalsLoadFromUi,adminOwnerCampaignSignalsCopyFromUi,adminOwnerCampaignOrdersLoadFromUi,adminOwnerCampaignFeeReceiptsLoadFromUi,adminOwnerBatchLedgerLoadFromUi,adminCampaignCostsLoadFromUi,adminCampaignCostsRecordFromUi,adminCampaignCostsVoidFromUi,adminCampaignReceiptsLoadFromUi,adminCampaignReceiptUploadFromUi,adminCampaignReceiptDownloadFromUi,adminOwnerBridgeLoadFromUi,adminOwnerOrphanAuditLoadFromUi,adminOwnerBenefitsLoadFromUi,adminOwnerOrphanCleanupLoadFromUi,adminOwnerOrphanCleanupDeleteFromUi,adminOwnerWalletReconLoadFromUi,adminOwnerSourceLotsLoadFromUi,adminOwnerReferralTraceLoadFromUi,adminOwnerPayoutReadFromUi,adminOwnerPayoutRecordFromUi,adminOwnerPayoutVoidFromUi,adminOwnerPayoutProofsLoadFromUi,adminOwnerPayoutProofUploadFromUi,adminOwnerPayoutProofVerifyFromUi,adminOwnerPayoutProofViewFromUi,adminOwnerPayoutProviderLoadFromUi,adminOwnerPayoutProviderCheckFromUi,adminOwnerPayoutQueueSetFilterFromUi,adminOwnerPayoutQueuePrepareCheckFromUi,adminPayoutReviewOpenFromUi,adminPayoutReviewRecordFromUi,adminPayoutFollowupLoadFromUi,adminPayoutGlobalLoadFromUi,adminPayoutGlobalOpenMonthFromUi,adminPayoutArchivedLoadFromUi,adminOwnerRecipientProofLoadFromUi,adminOwnerMultiPspLoadFromUi
  }:{} )
});
