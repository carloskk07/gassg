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
    return ['revenda','marca','indicar','agua','gas'].includes(value)?value:'';
  }catch{return ''}
}
function tamaoPublicEntryRoute(){
  if(globalThis.adminPortalRequested?.()||globalThis.merchantPortalRequested?.()||
     globalThis.__CHAMA_TEST__===true||globalThis.CHAMA_INTERNAL_PILOT===true)return false;
  // A visitor's explicit link to a page always takes precedence.
  if(String(location.hash||'').length>0)return false;
  const destination={revenda:'merchants',marca:'sponsors',indicar:'earn'}[tamaoPublicEntryIntent()];
  if(!destination)return false;
  go(destination);
  return true;
}
let renderLock=false;
function render(){
  if(renderLock)return;
  renderLock=true;
  try{
    if(!globalThis.adminPortalRequested?.())housekeeping();
    const r=route();
    const pages={home,learn,earn,order:orderPage,tracking,club,refer,merchants:merchantsLanding,sponsors:sponsorsLanding,'merchant-join':merchantJoin,merchant:merchantPage,'merchant-orders':merchantOrders,'merchant-team':merchantTeamPage,catalog,'merchant-metrics':merchantMetrics,privacy:privacyPage,terms:termsPage,contact:contactPage,admin:adminPage};
    const app=document.querySelector('#app');
    if(app)app.innerHTML=(pages[r]||home)();
    updatePublicPageIdentity(r);
    queueMicrotask(()=>globalThis.marketingAnalyticsAfterRender?.());
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

window.addEventListener('load',async()=>{
  if(globalThis.adminPortalRequested?.()){
    await adminBackendInit();
    if(route()!=='admin')go('admin');
    render();
  }else if(globalThis.merchantPortalRequested?.()){
    await merchantBackendInit();
    const invitedPartner=Boolean(globalThis.merchantPilotInviteToken?.()||globalThis.merchantProspectInviteToken?.());
    if(invitedPartner&&globalThis.merchantRuntime?.status==='no-access'){
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
  go,setMode,openSponsorContact,publicLandingJump,startOrder,quickProduct,startHomeBrowse,homeFilterProducts,homeDiscoverFocus,buyerCartFilter,customerCheckoutFocusStep,setAddress,deliveryAddressDraftChanged,qty,checkout,setPaymentMethod,toggleCashback,
  confirmRequote,cancelBeforeDispatch,cancelPending,shareReferral,shareTamaoGrowthInvite,activateCashAccount,joinMerchant,selectMerchant,toggleOnline,
  merchantUpdate,merchantAction,reset,
  merchantLoginFromUi,merchantLiveRefresh,merchantLiveSelect,merchantLiveToggleOnline,merchantWorkspaceJump,
  merchantLiveSaveP13,merchantLiveSaveProduct,merchantLiveSaveLogistics,merchantLiveAction,merchantLiveCannotFulfill,
  merchantLiveDeliver,merchantLiveAssignDelivery,merchantLiveSaveMemberProfile,
  merchantEnableAlertsFromUi,merchantDisableAlertsFromUi,merchantPushEnableFromUi,merchantPushDisableFromUi,merchantPushDiagnoseFromUi,merchantPushTestFromUi,merchantPushLastFromUi,merchantPushReportFromUi,merchantPushCorrectChromeWarningFromUi,
  merchantOpenTeam,merchantTeamReloadFromUi,merchantTeamInviteFromUi,merchantTeamRevokeMemberFromUi,merchantTeamRevokeInviteFromUi,copyMerchantTeamInstructions,
  merchantGrowthLoadFromUi,merchantGrowthShareFromUi,
  merchantClubeInterestLoadFromUi,merchantClubeInterestRegisterFromUi,merchantClubeInterestWithdrawFromUi,
  merchantClubeTermsLoadFromUi,merchantClubeTermsReplyFromUi,
  merchantLiveLogout,
  adminLoginFromUi,adminRetryBootstrapFromUi,adminRefresh,adminSignOut,adminLoadGovernanceGates,adminGovernanceChangeCityPause,adminGovernanceChangeCityCommerce,adminPushReliabilityLoadFromUi,adminApproveApplication,adminRejectApplication,
  adminSaveCompliance,adminSetMerchantStatus,adminFinancial,adminReverseOrder,adminGrowthBenefitPreviewFromUi,adminClubeCouponPreviewFromUi,adminClubeInterestLoadFromUi,adminClubeCampaignLoadFromUi,adminClubeCampaignReviewFromUi,adminClubeTermsLoadFromUi,adminClubeTermsSaveFromUi,adminOwnerFundingLoadFromUi,adminOwnerFundingSaveFromUi,adminOwnerEvidenceLoadFromUi,adminOwnerEvidenceSubmitFromUi,adminOwnerEvidenceReviewFromUi,adminOwnerBudgetLoadFromUi,adminOwnerBudgetAllocateFromUi,adminOwnerBudgetReleaseFromUi,adminOwnerFinanceLoadFromUi,adminOwnerFinanceSelectFromUi,adminOwnerFinanceHistoryLoadFromUi,adminOwnerCampaignSignalsLoadFromUi,adminOwnerCampaignSignalsCopyFromUi,adminOwnerCampaignOrdersLoadFromUi,adminOwnerCampaignFeeReceiptsLoadFromUi,adminOwnerBatchLedgerLoadFromUi,adminCampaignCostsLoadFromUi,adminCampaignCostsRecordFromUi,adminCampaignCostsVoidFromUi,adminCampaignReceiptsLoadFromUi,adminCampaignReceiptUploadFromUi,adminCampaignReceiptDownloadFromUi,adminOwnerBridgeLoadFromUi,adminOwnerOrphanAuditLoadFromUi,adminOwnerBenefitsLoadFromUi,adminOwnerOrphanCleanupLoadFromUi,adminOwnerOrphanCleanupDeleteFromUi,adminOwnerWalletReconLoadFromUi,adminOwnerSourceLotsLoadFromUi,adminOwnerReferralTraceLoadFromUi,adminOwnerPayoutReadFromUi,adminOwnerPayoutRecordFromUi,adminOwnerPayoutVoidFromUi,adminOwnerPayoutProofsLoadFromUi,adminOwnerPayoutProofUploadFromUi,adminOwnerPayoutProofVerifyFromUi,adminOwnerPayoutProofViewFromUi,adminOwnerPayoutProviderLoadFromUi,adminOwnerPayoutProviderCheckFromUi,adminOwnerPayoutQueueSetFilterFromUi,adminOwnerPayoutQueuePrepareCheckFromUi,adminPayoutReviewOpenFromUi,adminPayoutReviewRecordFromUi,adminPayoutFollowupLoadFromUi,adminPayoutGlobalLoadFromUi,adminPayoutGlobalOpenMonthFromUi,adminPayoutArchivedLoadFromUi,adminOwnerRecipientProofLoadFromUi,adminOwnerMultiPspLoadFromUi
});
