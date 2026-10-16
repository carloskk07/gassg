// V1.238 — commercial activation: real prospect → application → merchant → Ads.
let adminCommercialActivationState=null;
let adminCommercialActivationBusy=false;
async function adminCommercialActivationLoadFromUi(){
  if(adminCommercialActivationBusy)return;
  const identity=String(adminRuntime?.session?.user?.id||'');
  if(!identity||!['superadmin','operations','compliance','finance','readonly'].includes(String(adminCurrentRole())))
    return toast('Faça login no painel com o perfil autorizado.');
  adminCommercialActivationBusy=true;
  try{
    const data=await adminInvoke({action:'commercial-activation'});
    const c=data?.counts;
    const keys=['anpProspects','anpUncontacted','anpContacted','anpInterested',
      'anpOnboarding','invitationsPending','invitationsClaimed','merchantLeads',
      'merchantNewLeads','merchantApplications','merchantPendingApplications',
      'merchantsRegistered','merchantsActive','merchantsActiveOnline',
      'adsOptedIn','adsCreativesReviewed'];
    if(data?.source!=='admin_commercial_activation_v1_238'
      ||data.readOnly!==true||data.noContactsExposed!==true
      ||data.noMessagesSent!==true||data.noSyntheticMerchants!==true
      ||data.adsLive!==false||data.adsRevenueCents!==0||data.noCharge!==true
      ||data.dataMeaning!=='independent_operational_populations'
      ||!c||!keys.every(k=>Number.isSafeInteger(c[k])&&c[k]>=0)
      ||!Array.isArray(data.prospectCities)||data.prospectCities.length>20)
      throw new Error('Não foi possível confirmar a origem das métricas comerciais.');
    if(identity!==String(adminRuntime?.session?.user?.id||''))return;
    adminCommercialActivationState={...data,loadedFor:identity};
  }catch(e){
    if(identity===String(adminRuntime?.session?.user?.id||'')){
      adminCommercialActivationState=null;
      toast(String(e?.message||'Não foi possível consultar a ativação comercial.'));
    }
  }finally{adminCommercialActivationBusy=false;render();}
}
function adminCommercialActivationSection(){
  if(!['superadmin','operations','compliance','finance','readonly'].includes(String(adminCurrentRole())))return '';
  const identity=String(adminRuntime?.session?.user?.id||'');
  const report=adminCommercialActivationState?.loadedFor===identity?adminCommercialActivationState:null;
  const c=report?.counts;
  const actions={
    review_applications:['Revisar solicitações de revendas','partners'],
    respond_merchant_leads:['Atender interessados em parceria','overview'],
    contact_anp_prospects:['Iniciar contato com prospectos da ANP','prospects'],
    followup_prospects:['Acompanhar prospectos interessados','prospects'],
    acquire_first_merchant:['Convidar a primeira revenda','prospects'],
    enable_partner_operation:['Concluir habilitação das revendas','partners'],
    collect_voluntary_ads_interest:['Apresentar Ads às revendas ativas','partners'],
    review_creative:['Analisar as primeiras peças Ads','overview'],
    validate_first_campaign:['Conferir o piloto Ads com revenda real','overview']
  };
  const priority=actions[report?.nextAction]||actions.acquire_first_merchant;
  const metric=(label,value,note='')=>'<div class="kpi">'+
    '<span class="label">'+esc(label)+'</span>'+
    '<strong>'+Number(value).toLocaleString('pt-BR')+'</strong>'+
    (note?'<small>'+esc(note)+'</small>':'')+'</div>';
  const data=c?
    '<div class="merchant-kpis" style="margin-top:12px">'+
      metric('Prospectos ANP',c.anpProspects,'Empresas conhecidas, não clientes')+
      metric('Sem contato registrado',c.anpUncontacted)+
      metric('Convites ainda válidos',c.invitationsPending)+
      metric('Leads de revendas',c.merchantLeads)+
      metric('Solicitações de cadastro pendentes',c.merchantPendingApplications)+
      metric('Revendas ativas',c.merchantsActive)+
      metric('Revendas ativas e online',c.merchantsActiveOnline)+
      metric('Revendas com interesse Ads',c.adsOptedIn)+
      metric('Peças Ads revisadas',c.adsCreativesReviewed)+
    '</div>'+
    '<div class="card flat" style="margin-top:14px">'+
      '<strong>Próxima ação comercial indicada</strong><p>'+esc(priority[0])+'</p>'+
      '<button class="primary small" type="button" onclick="adminSetSection(\''+priority[1]+'\')">Abrir área correspondente</button>'+
      '<p class="tiny muted">A recomendação é calculada apenas sobre registros existentes. Nenhum WhatsApp, convite ou cadastro é enviado automaticamente.</p>'+
    '</div>'+
    '<h4 style="margin-top:14px">Cidades com possíveis revendas</h4>'+
    (report.prospectCities.length?
      '<div class="list">'+report.prospectCities.map(x=>
        '<div class="list-row"><strong>'+esc([x.city,x.state].filter(Boolean).join('/'))+'</strong>'+
        '<small>'+Number(x.prospects)+' cadastrada(s) na ANP • '+
        Number(x.uncontacted)+' sem contato</small></div>').join('')+'</div>':
      '<p class="muted tiny">Não existem cidades com prospectos registrados.</p>')+
    '<p class="tiny muted">Os números representam bases diferentes: prospectos, leads, solicitações e revendas não são etapas comprovadas de um mesmo funil individual. '+
    'Intenção comercial e crédito antecipado não equivalem a receita realizada. Ads: R$ 0.</p>':
    '<p class="muted tiny">Consulte para identificar o gargalo atual entre prospecção, cadastro e primeira venda.</p>';
  return '<section class="section admin-commercial-activation">'+
    '<div class="section-head"><div><span class="section-kicker">TAMÃO NEGÓCIOS • CRESCIMENTO</span>'+
    '<h3>Da primeira parceria à primeira venda</h3>'+
    '<p>Acompanhe oportunidades reais antes de oferecer anúncios ou ferramentas pagas.</p></div>'+
    '<button class="secondary small" type="button" onclick="adminCommercialActivationLoadFromUi()" '+
    (adminCommercialActivationBusy?'disabled':'')+'>Conferir ativação comercial</button></div>'+
    data+'</section>';
}
// TAMÃO Ads V1.237 — live, read-only pilot checks for each real merchant.
const adminAdsPilotCache=new Map();
const adminAdsPilotPending=new Set();
async function adminAdsPilotCheckFromUi(merchantId,expectedVersion){
  const identity=String(adminRuntime?.session?.user?.id||'');
  if(!identity||!['superadmin','operations','compliance','finance','readonly'].includes(String(adminCurrentRole())))
    return;
  if(!/^[0-9a-f-]{36}$/i.test(String(merchantId)))return;
  const row=adminAdsCampaignQueue?.loadedFor===identity
    ?adminAdsCampaignQueue.rows?.find(c=>c.merchantId===merchantId):null;
  if(!row||row.version!==expectedVersion){
    return toast('Atualize a fila antes de conferir a campanha.');
  }
  const key=identity+':'+merchantId;
  if(adminAdsPilotPending.has(key))return;
  adminAdsPilotPending.add(key);
  try{
    const data=await adminInvoke({action:'ads-pilot-preflight',merchantId});
    const checks=data?.checks;
    const commercial=data?.commercial;
    const evidence=data?.evidence;
    const names=[
      'creativeExists','creativeReviewed','advertiserOptedIn','merchantActiveOnline',
      'campaignCityMatchesMerchant','merchantEligibleForRealOffers',
      'eligibleCategoryProductExists','internalPreviewClientReported',
      'publicPlacementLocked','billingLocked','verifiedDeliveryLocked'
    ];
    const proof=[
      'visitorCityVerified','clientPreviewIndependentlyVerified',
      'endToEndCustomerAdDeliveryVerified','adFraudDefenseVerified',
      'customerBasketAvailabilityProven'
    ];
    if(data?.source!=='admin_ads_pilot_preflight_v1_237'
       ||data?.merchantId!==merchantId||data?.readOnly!==true
       ||!checks||!names.every(k=>typeof checks[k]==='boolean')
       ||data.internalPrerequisitesMet!==names.every(k=>checks[k]===true)
       ||!evidence||!proof.every(k=>evidence[k]===false)
       ||commercial?.publicAdsLive!==false||commercial?.readyToSell!==false
       ||commercial?.noCharge!==true||commercial?.billableImpressions!==0
       ||commercial?.verifiedAdImpressions!==0||commercial?.adsRevenueCents!==0){
       throw new Error('Diagnóstico sem validação de origem.');
    }
    if(identity!==String(adminRuntime?.session?.user?.id||''))return;
    if(data.campaignVersion!==expectedVersion){
      adminAdsPilotCache.delete(key);
      throw new Error('A proposta foi alterada. Consulte a fila novamente.');
    }
    adminAdsPilotCache.set(key,{data,checkedAt:Date.now()});
  }catch(e){
    if(identity===String(adminRuntime?.session?.user?.id||'')){
      adminAdsPilotCache.delete(key);
      toast(String(e?.message||e));
    }
  }finally{
    adminAdsPilotPending.delete(key);
    render();
  }
}
function adminAdsPilotReadinessFragment(row,adminId){
  const key=adminId+':'+row.merchantId;
  const saved=adminAdsPilotCache.get(key);
  const freshness=saved&&Date.now()-saved.checkedAt<=120000
    &&saved.data?.campaignVersion===row.version;
  const data=freshness?saved.data:null;
  const labels={
    creativeExists:'Proposta cadastrada',
    creativeReviewed:'Peça revisada por conformidade',
    advertiserOptedIn:'Revenda confirmou interesse',
    merchantActiveOnline:'Revenda ativa e online',
    campaignCityMatchesMerchant:'Cidade corresponde ao cadastro',
    merchantEligibleForRealOffers:'Habilitada na regra real de ofertas',
    eligibleCategoryProductExists:'Produto compatível disponível e regular',
    internalPreviewClientReported:'Prévia interna relatada pelo navegador',
    publicPlacementLocked:'Exibição pública bloqueada',
    billingLocked:'Cobrança bloqueada',
    verifiedDeliveryLocked:'Impressões faturáveis bloqueadas'
  };
  const checkList=data?
    '<div class="list" style="margin-top:10px">'+Object.entries(labels).map(([key,label])=>
      '<div class="list-row"><span>'+esc(label)+'</span><strong>'+
      (data.checks[key]===true?'✓':'Pendente')+'</strong></div>').join('')+'</div>'+
    '<p class="tiny muted">'+
      (data.internalPrerequisitesMet?
        'Os requisitos internos desta etapa estão atendidos. Isso ainda não autoriza veiculação ou cobrança.':
        'O piloto ainda depende dos requisitos pendentes acima.')+'</p>'+
    '<div class="notice">Publicidade pública: <strong>desligada</strong> • Impressões verificadas: <strong>0</strong> • Receita Ads: <strong>R$ 0</strong>. '+
    'A cidade dos visitantes, a entrega ao consumidor e a resistência a tráfego artificial ainda não foram comprovadas.</div>':
    '<p class="tiny muted">Conferência individual com dados atuais do banco, sem liberar anúncios.</p>';
  return '<div class="card flat" style="margin-top:12px">'+
    '<div class="section-head"><div><strong>Pré-requisitos do piloto</strong>'+
    '<p class="tiny muted">Apenas diagnóstico operacional. Não altera a campanha.</p></div>'+
    '<button class="secondary small" type="button" '+
      'onclick="adminAdsPilotCheckFromUi(&quot;'+row.merchantId+'&quot;,'+Number(row.version)+')" '+
      (adminAdsPilotPending.has(key)?'disabled':'')+'>Conferir requisitos</button></div>'+
    checkList+'</div>';
}
// V1.236 — controlled editorial ad slot: intentionally locked for public use.
let adminAdsPlacementState=null;
let adminAdsPlacementBusy=false;
async function adminAdsPlacementLoadFromUi(){
  if(adminAdsPlacementBusy)return;
  const identity=String(adminRuntime?.session?.user?.id||'');
  if(!identity||!['superadmin','operations','compliance','finance','readonly'].includes(String(adminCurrentRole())))return;
  adminAdsPlacementBusy=true;
  try{
    const data=await adminInvoke({action:'ads-placement-readiness'});
    if(data?.source!=='admin_ads_placement_readiness_v1_236'
       ||data.publicEnabled!==false||data.billingEnabled!==false
       ||data.verifiedDeliveryEnabled!==false||data.readyToSell!==false
       ||data.organicRankingUnaffected!==true||data.readOnly!==true
       ||data.noCharge!==true||data.billableImpressions!==0
       ||data.verifiedAdImpressions!==0||data.adsRevenueCents!==0
       ||!Number.isSafeInteger(data.approvedCreatives)||data.approvedCreatives<0
       ||!Number.isSafeInteger(data.potentialMerchantCreatives)
       ||data.potentialMerchantCreatives<0)
      throw new Error('Controle de publicidade não pôde ser confirmado.');
    if(identity!==String(adminRuntime?.session?.user?.id||''))return;
    adminAdsPlacementState={...data,loadedFor:identity};
  }catch(e){
    if(identity===String(adminRuntime?.session?.user?.id||'')){
      adminAdsPlacementState=null;toast(String(e?.message||e));
    }
  }finally{adminAdsPlacementBusy=false;render();}
}
function adminAdsPlacementSection(){
  if(!['superadmin','operations','compliance','finance','readonly'].includes(String(adminCurrentRole())))return '';
  const adminId=String(adminRuntime?.session?.user?.id||'');
  const data=adminAdsPlacementState?.loadedFor===adminId?adminAdsPlacementState:null;
  return '<section class="section admin-ads-placement">'+
    '<div class="section-head"><div><span class="section-kicker">TAMÃO ADS • CONTROLES DE EXIBIÇÃO</span>'+
    '<h3>Preparação do espaço patrocinado</h3>'+
    '<p>Publicidade fora da lista orgânica. A exibição pública e qualquer cobrança estão bloqueadas.</p></div>'+
    '<button class="secondary small" type="button" onclick="adminAdsPlacementLoadFromUi()">Conferir bloqueios</button></div>'+
    (data?'<div class="merchant-kpis">'+
      '<div class="kpi"><span class="label">Criativos revisados</span><strong>'+data.approvedCreatives+'</strong></div>'+
      '<div class="kpi"><span class="label">Revendas com peça potencialmente elegível</span><strong>'+data.potentialMerchantCreatives+'</strong></div>'+
      '<div class="kpi"><span class="label">Espaços publicados</span><strong>0</strong></div>'+
      '<div class="kpi"><span class="label">Receita de publicidade</span><strong>R$ 0</strong></div></div>':
      '<p class="muted tiny">Consulte os bloqueios antes de qualquer experimento público.</p>')+
    '<p class="tiny muted">O banco impede ativação pública nesta versão. Sem impressões verificadas, sem faturamento e sem alteração de classificação de ofertas.</p>'+
    '</section>';
}
// V1.235 — administrative preview diagnostics; never public ad impressions.
let adminAdsPreviewSummary=null;
let adminAdsPreviewBusy=false;
async function adminAdsPreviewSummaryLoadFromUi(){
  if(adminAdsPreviewBusy)return;
  const adminId=String(adminRuntime?.session?.user?.id||'');
  if(!adminId||!['superadmin','operations','compliance','finance','readonly'].includes(String(adminCurrentRole())))return;
  adminAdsPreviewBusy=true;
  try{
    const data=await adminInvoke({action:'ads-preview-summary'});
    if(data?.source!=='admin_ads_preview_summary_v1_235'||data.windowDays!==30
       ||!Number.isSafeInteger(data.previewChallenges)||data.previewChallenges<0
       ||!Number.isSafeInteger(data.clientReportedPreviews)||data.clientReportedPreviews<0
       ||data.clientReportedPreviews>data.previewChallenges
       ||data.previewOnly!==true||data.independentlyVerified!==false
       ||data.adsLive!==false||data.noCharge!==true||data.readyToSell!==false
       ||data.verifiedAdImpressions!==0||data.billableImpressions!==0
       ||data.adsRevenueCents!==0)throw new Error('Diagnóstico sem validação de origem.');
    if(String(adminRuntime?.session?.user?.id||'')!==adminId)return;
    adminAdsPreviewSummary={...data,loadedFor:adminId};
  }catch(e){if(String(adminRuntime?.session?.user?.id||'')===adminId){
    adminAdsPreviewSummary=null;toast(String(e?.message||e));
  }}finally{adminAdsPreviewBusy=false;render();}
}
function adminAdsPreviewSummarySection(){
  if(!['superadmin','operations','compliance','finance','readonly'].includes(String(adminCurrentRole())))return '';
  const data=adminAdsPreviewSummary?.loadedFor===String(adminRuntime?.session?.user?.id||'')
    ?adminAdsPreviewSummary:null;
  return '<section class="section admin-ads-preview-summary">'+
   '<div class="section-head"><div><span class="section-kicker">TAMÃO ADS • QUALIDADE</span>'+
   '<h3>Diagnóstico de visualização interna</h3>'+
   '<p>Testes de peças por administradores — não são anúncios ao público.</p></div>'+
   '<button type="button" class="secondary small" onclick="adminAdsPreviewSummaryLoadFromUi()">Consultar testes</button></div>'+
   (data?'<div class="merchant-kpis">'+
     '<div class="kpi"><span class="label">Pré-visualizações emitidas</span><strong>'+data.previewChallenges+'</strong></div>'+
     '<div class="kpi"><span class="label">Relatos do navegador</span><strong>'+data.clientReportedPreviews+'</strong></div>'+
     '<div class="kpi"><span class="label">Impressões comerciais</span><strong>0</strong></div>'+
     '<div class="kpi"><span class="label">Receita Ads</span><strong>R$ 0</strong></div></div>':
     '<p class="muted tiny">Consulte os testes internos das últimas quatro semanas.</p>')+
   '<p class="tiny muted">Relatos não são provas independentes de impressão. '+
   'Não há publicidade veiculada, compromisso de compra ou cobrança.</p></section>';
}
async function adminAdsPreviewRunFromUi(merchantId){
  if(!['superadmin','compliance'].includes(String(adminCurrentRole())))return;
  const adminId=String(adminRuntime?.session?.user?.id||'');
  if(!adminId||!/^[0-9a-f-]{36}$/i.test(String(merchantId)))return;
  const campaign=adminAdsCampaignQueue?.rows?.find(c=>c.merchantId===merchantId&&c.status==='approved_creative');
  if(!campaign)return toast('Atualize a fila: apenas peças conferidas podem ser testadas.');
  if(!('IntersectionObserver' in window))return toast('O navegador não suporta medir a visibilidade de elementos.');
  let packet;
  try{packet=await adminPerform('ads-preview-issue',{merchantId,requestId:crypto.randomUUID()});}
  catch(e){return toast(String(e?.message||e));}
  if(String(adminRuntime?.session?.user?.id||'')!==adminId)return;
  if(packet?.source!=='ads_preview_proof_v1_235'||packet.operation!=='issue'
    ||packet.previewOnly!==true||packet.clientReported!==true
    ||packet.independentlyVerified!==false||packet.billable!==false
    ||packet.noCharge!==true||packet.adsLive!==false
    ||packet.creativeVersion!==campaign.version
    ||packet.merchantId!==merchantId
    ||!/^[0-9a-f-]{36}$/i.test(String(packet.challengeId||'')))
    return toast('Dados de prévia desatualizados ou inválidos.');
  const overlay=document.createElement('div');
  overlay.className='ads-preview-diagnostic-overlay';
  overlay.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML='<section role="dialog" aria-modal="true" aria-label="Prévia interna TAMÃO Ads" '+
    'style="width:min(96vw,540px);max-height:85vh;overflow:auto;padding:20px;border-radius:14px;background:white;color:#111">'+
    '<p class="tiny">PRÉVIA INTERNA • NÃO É PUBLICIDADE ATIVA</p>'+
    '<article class="card flat" id="ads-preview-creative-v1-235">'+
    '<small>'+esc([packet.city,packet.state].filter(Boolean).join('/'))+'</small>'+
    '<h3>'+esc(packet.title)+'</h3><p>'+esc(packet.description)+'</p></article>'+
    '<p id="ads-preview-status-v1-235">Mantenha esta peça visível por 1,5 segundo com a aba ativa.</p>'+
    '<button type="button" class="secondary small" id="ads-preview-close-v1-235">Fechar</button></section>';
  document.body.appendChild(overlay);
  const creative=overlay.querySelector('#ads-preview-creative-v1-235');
  const message=overlay.querySelector('#ads-preview-status-v1-235');
  let visibleRatio=0,seenMs=0,lastAt=performance.now(),stopped=false,busy=false;
  const observer=new IntersectionObserver(entries=>{
    for(const e of entries)if(e.target===creative)
      visibleRatio=e.isIntersecting?e.intersectionRatio:0;
  },{threshold:[0,.5,.75,1]});
  observer.observe(creative);
  let interval=0;
  const finish=()=>{stopped=true;clearInterval(interval);observer.disconnect();overlay.remove();};
  overlay.querySelector('#ads-preview-close-v1-235').onclick=finish;
  interval=setInterval(async()=>{
    if(stopped||busy)return;
    const now=performance.now();
    const delta=Math.max(0,Math.min(120,now-lastAt));lastAt=now;
    if(document.visibilityState==='visible'&&document.hasFocus()&&visibleRatio>=.5)
      seenMs+=delta;
    else seenMs=0;
    if(seenMs<1700)return;
    busy=true;clearInterval(interval);observer.disconnect();
    message.textContent='Registrando diagnóstico interno…';
    try{
      const result=await adminPerform('ads-preview-confirm',{
        merchantId,challengeId:packet.challengeId,
        visibleMs:Math.max(1500,Math.min(15000,Math.floor(seenMs))),
        visiblePercent:Math.max(50,Math.min(100,Math.floor(visibleRatio*100)))
      });
      if(result?.recorded!==true||result.previewOnly!==true
        ||result.clientReported!==true||result.independentlyVerified!==false
        ||result.billable!==false||result.adsLive!==false||result.noCharge!==true)
        throw new Error('O teste não foi confirmado.');
      if(!stopped)message.textContent='Relato experimental registrado. Nenhum anúncio ou impressão faturável foi criado.';
      await adminAdsPreviewSummaryLoadFromUi();
    }catch(e){if(!stopped)message.textContent='O teste não foi confirmado: '+String(e?.message||e);}
  },100);
}
// TAMÃO Ads V1.234 — observed marketing events, never paid ad impressions.
let adminAdsAudienceState=null;
let adminAdsAudienceBusy=false;
async function adminAdsAudienceLoadFromUi(){
  if(adminAdsAudienceBusy)return;
  const adminId=String(adminRuntime?.session?.user?.id||'');
  if(!adminId||!['superadmin','operations','compliance','finance','readonly'].includes(String(adminCurrentRole())))
    return toast('Você precisa de acesso autorizado ao painel.');
  adminAdsAudienceBusy=true;
  try{
    const data=await adminInvoke({action:'ads-audience-readiness'});
    const names=['landingCustomerEvents','landingMerchantEvents',
      'customerFormEvents','merchantFormEvents','last7dEvents','activeDays'];
    const verified=data?.source==='admin_ads_audience_readiness_v1_234'
      &&data?.readOnly===true&&data?.periodDays===30
      &&data?.metricType==='unverified_anonymous_site_events'
      &&data?.evidence?.uniqueVisitorsVerified===false
      &&data?.evidence?.cityOfVisitorVerified===false
      &&data?.evidence?.invalidTrafficFiltered===false
      &&data?.commercial?.readyToSell===false
      &&data?.commercial?.adsLive===false
      &&data?.commercial?.noCharge===true
      &&data?.commercial?.billableImpressions===0
      &&data?.commercial?.adsRevenueCents===0
      &&names.every(x=>Number.isSafeInteger(data[x])&&data[x]>=0)
      &&Array.isArray(data.daily)&&data.daily.length===14
      &&Array.isArray(data.cityDemand)&&data.cityDemand.length<=20;
    if(!verified)throw new Error('Não foi possível comprovar a classificação dos indicadores.');
    if(String(adminRuntime?.session?.user?.id||'')!==adminId)return;
    adminAdsAudienceState={...data,loadedFor:adminId};
  }catch(e){
    if(String(adminRuntime?.session?.user?.id||'')===adminId){
      adminAdsAudienceState=null;
      toast(String(e?.message||'Falha na consulta de audiência.'));
    }
  }finally{adminAdsAudienceBusy=false;render();}
}
function adminAdsAudienceSection(){
  if(!['superadmin','operations','compliance','finance','readonly'].includes(String(adminCurrentRole())))
    return '';
  const adminId=String(adminRuntime?.session?.user?.id||'');
  const data=adminAdsAudienceState?.loadedFor===adminId?adminAdsAudienceState:null;
  const stat=(label,count,detail='')=>
    '<div class="kpi"><span class="label">'+esc(label)+'</span>'+
    '<strong>'+Number(count).toLocaleString('pt-BR')+'</strong>'+
    (detail?'<small>'+esc(detail)+'</small>':'')+'</div>';
  const breakdown=data?
    '<div class="merchant-kpis" style="margin-top:12px">'+
      stat('Acessos registrados • clientes',data.landingCustomerEvents,'30 dias • eventos, não pessoas')+
      stat('Acessos registrados • revendas',data.landingMerchantEvents,'30 dias • eventos, não pessoas')+
      stat('Aberturas do formulário • clientes',data.customerFormEvents)+
      stat('Aberturas do formulário • revendas',data.merchantFormEvents)+
      stat('Eventos registrados • 7 dias',data.last7dEvents)+
      stat('Dias com algum evento',data.activeDays,'Dentro dos últimos 30 dias')+
    '</div>'+
    '<p class="tiny muted">Fonte: contadores de eventos anônimos aceitos no site público. '+ 
      'Não indicam visitantes únicos, conversões, tráfego livre de robôs ou localização de visitantes.</p>'+
    '<h4 style="margin-top:14px">Sinais por dia — últimas duas semanas (UTC)</h4>'+
    '<div class="list">'+data.daily.map(d=>
      '<div class="list-row"><small>'+esc(String(d.date||''))+'</small>'+
      '<span>'+Number(d.landingEvents).toLocaleString('pt-BR')+
      ' acesso(s) registrado(s) • '+Number(d.formEvents).toLocaleString('pt-BR')+
      ' formulário(s) aberto(s)</span></div>').join('')+'</div>'+
    '<h4 style="margin-top:14px">Demanda declarada pelas revendas, por cidade</h4>'+
    (data.cityDemand.length?'<div class="list">'+data.cityDemand.map(c=>
      '<div class="list-row"><strong>'+esc([c.city,c.state].filter(Boolean).join('/'))+
      '</strong><small>'+Number(c.interestedMerchants)+' interesse(s) • '+
      Number(c.submittedCreatives)+' peça(s) enviada(s) • '+
      Number(c.approvedCreatives)+' conferida(s)</small></div>').join('')+'</div>':
      '<p class="muted tiny">Ainda não há procura por publicidade associada a revendas cadastradas.</p>')+
    '<div class="notice"><strong>Portão comercial fechado:</strong> 0 impressões publicitárias comprovadas, '+
      '0 cliques validados e R$ 0 em receita de anúncios. '+ 
      'Não existem medição geográfica confiável, deduplicação de visitantes, filtragem auditada de tráfego inválido '+ 
      'nem anúncio efetivamente veiculado. Nenhum desses contadores pode fundamentar uma cobrança.</div>':
    '<p class="muted tiny">Consulte os eventos observados e a procura das revendas, sem confundir acesso ao site com exibição publicitária.</p>';
  return '<section class="section admin-ads-audience-readiness">'+
    '<div class="section-head"><div><span class="section-kicker">TAMÃO ADS • MEDIÇÃO</span>'+
    '<h3>Audiência observada e prontidão de anúncios</h3>'+
    '<p>Acompanhe os sinais de acesso ao TAMÃO sem prometer alcance local não comprovado.</p></div>'+
    '<button class="secondary small" type="button" onclick="adminAdsAudienceLoadFromUi()" '+
      (adminAdsAudienceBusy?'disabled':'')+'>Conferir audiência</button></div>'+
    breakdown+'</section>';
}
// V1.233 creative review — approval never enables delivery or billing.
let adminAdsCampaignQueue=null;
let adminAdsCampaignBusy=false;
async function adminAdsCampaignLoadFromUi(){
  if(adminAdsCampaignBusy)return;
  if(!['superadmin','operations','compliance','finance','readonly'].includes(String(adminCurrentRole())))return;
  const adminId=String(adminRuntime?.session?.user?.id||'');
  if(!adminId)return;
  adminAdsCampaignBusy=true;
  try{
    const data=await adminInvoke({action:'ads-campaign-queue'});
    if(data?.source!=='admin_ads_campaign_queue_v1_233'
       ||data.noCharge!==true||data.adsLive!==false
       ||!Number.isSafeInteger(data.submittedCount)||data.submittedCount<0
       ||!Array.isArray(data.rows)||data.rows.length>50)
      throw new Error('A fila de campanhas não foi confirmada.');
    if(String(adminRuntime?.session?.user?.id||'')!==adminId)return;
    adminAdsCampaignQueue={...data,loadedFor:adminId};
  }catch(e){
    if(String(adminRuntime?.session?.user?.id||'')===adminId){
      adminAdsCampaignQueue=null;toast(String(e?.message||e));
    }
  }finally{adminAdsCampaignBusy=false;render();}
}
async function adminAdsCampaignReview(merchantId,version,decision){
  if(!['superadmin','compliance'].includes(String(adminCurrentRole())))return;
  const queue=adminAdsCampaignQueue?.rows||[];
  const row=queue.find(x=>x.merchantId===merchantId&&x.version===version&&x.status==='submitted');
  if(!row||!['approved_creative','needs_changes'].includes(decision))
    return toast('Atualize a fila e escolha uma proposta enviada.');
  const note=String(document.getElementById('ads-review-note-'+merchantId)?.value||'').trim();
  if(note.length<12||note.length>500)return toast('Registre uma justificativa entre 12 e 500 caracteres.');
  if(!confirm((decision==='approved_creative'?'Conferir a peça':'Pedir ajustes')+
      '? Não será publicado nem cobrado nenhum anúncio.'))return;
  try{
    const data=await adminPerform('ads-campaign-review',{
      merchantId,version,decision,note,requestId:crypto.randomUUID()
    });
    if(data?.recorded!==true||data.noCharge!==true||data.adsLive!==false)
      throw new Error('O registro da revisão não foi confirmado.');
    toast('Análise registrada. A publicidade continua desativada.');
    await adminAdsCampaignLoadFromUi();
  }catch(e){toast(String(e?.message||e));}
}
function adminAdsCampaignSection(){
  if(!['superadmin','operations','compliance','finance','readonly'].includes(String(adminCurrentRole())))return '';
  const adminId=String(adminRuntime?.session?.user?.id||'');
  const data=adminAdsCampaignQueue?.loadedFor===adminId?adminAdsCampaignQueue:null;
  const canReview=['superadmin','compliance'].includes(String(adminCurrentRole()));
  const states={draft:'Rascunho',submitted:'Aguardando revisão',approved_creative:'Peça conferida — não publicada',
    needs_changes:'Ajustes solicitados',withdrawn:'Retirada'};
  const rows=data?.rows?.map(x=>{
    if(!/^[0-9a-f-]{36}$/i.test(String(x.merchantId||'')))return '';
    const diag=canReview&&x.status==='approved_creative'?
      '<div class="order-actions"><button class="secondary small" type="button" onclick="adminAdsPreviewRunFromUi(\''+
        x.merchantId+'\')">Testar prévia interna</button></div>':'';
    const fields=canReview&&x.status==='submitted'?
      '<label>Justificativa para a revisão<textarea id="ads-review-note-'+x.merchantId+
      '" rows="2" minlength="12" maxlength="500" placeholder="Explique o que foi conferido ou precisa mudar"></textarea></label>'+
      '<div class="order-actions">'+
      '<button class="secondary small" onclick="adminAdsCampaignReview(\''+x.merchantId+'\','+Number(x.version)+',\'needs_changes\')">Solicitar ajustes</button>'+
      '<button class="primary small" onclick="adminAdsCampaignReview(\''+x.merchantId+'\','+Number(x.version)+',\'approved_creative\')">Aprovar somente a peça</button>'+
      '</div>':'';
    return '<div class="card flat"><div class="status-bar"><strong>'+esc(x.companyName||'Revenda')+
      '</strong><span class="status-pill">'+esc(states[x.status]||'Em análise')+'</span></div>'+
      '<p class="tiny muted">'+esc([x.city,x.state].filter(Boolean).join('/')||'Localização pendente')+
      ' • '+esc(x.category||'Geral')+' • versão '+Number(x.version||1)+'</p>'+
      '<strong>'+esc(x.title||'')+'</strong><p>'+esc(x.description||'')+'</p>'+
      (x.reviewNote?'<p class="tiny muted">Nota: '+esc(x.reviewNote)+'</p>':'')+
      fields+diag+adminAdsPilotReadinessFragment(x,adminId)+'</div>';
  }).join('')||'';
  return '<section class="section admin-ads-campaigns">'+
   '<div class="section-head"><div><span class="section-kicker">TAMÃO ADS • CONFORMIDADE</span>'+
   '<h3>Central de propostas publicitárias</h3>'+
   '<p>Revisão de títulos, mensagens e categorias locais. Aprovar a peça não libera exibição, compra ou destaque.</p></div>'+
   '<button class="secondary small" onclick="adminAdsCampaignLoadFromUi()">Consultar propostas</button></div>'+
   (data?'<p class="tiny muted">Aguardando revisão: <strong>'+data.submittedCount+
     '</strong> • até 50 propostas mais recentes</p><div class="grid cards-2">'+
     (rows||'<p class="muted">Nenhuma proposta cadastrada.</p>')+'</div>':
     '<p class="muted tiny">Clique em Consultar propostas para analisar os materiais.</p>')+
   '</section>';
}
let adminAdsDemandState=null;
let adminAdsDemandBusy=false;
async function adminAdsDemandLoadFromUi(){
  if(adminAdsDemandBusy)return;
  const adminId=String(adminRuntime?.session?.user?.id||'');
  if(!adminId)return toast('Faça login no painel antes de consultar.');
  if(!['superadmin','operations','compliance','finance','readonly'].includes(String(adminCurrentRole())))
    return;
  adminAdsDemandBusy=true;
  try{
    const data=await adminInvoke({action:'ads-demand'});
    if(data?.source!=='admin_ads_demand_v1_232'||data.adsLive!==false||
       data.noRevenue!==true||data.noCharge!==true||
       !Number.isSafeInteger(data.totalInterested)||data.totalInterested<0||
       !Number.isSafeInteger(data.recent30d)||data.recent30d<0||
       !Array.isArray(data.rows)||data.rows.length>50)
      throw new Error('Fila de publicidade não confirmada pelo servidor.');
    if(String(adminRuntime?.session?.user?.id||'')!==adminId)return;
    adminAdsDemandState={...data,loadedFor:adminId};
  }catch(e){
    if(String(adminRuntime?.session?.user?.id||'')===adminId){
      adminAdsDemandState=null;
      toast(String(e?.message||'Não foi possível consultar as revendas interessadas.'));
    }
  }finally{adminAdsDemandBusy=false;render();}
}
// Clube TAMÃO V1.240 — read-only proposal radar, no funded discounts.
let adminClubeInterestState=null;
let adminClubeInterestBusy=false;
async function adminClubeInterestLoadFromUi(){
  const id=String(adminRuntime?.session?.user?.id||'');
  if(!id||!['superadmin','operations','compliance','finance','readonly'].includes(
       String(adminCurrentRole()))||adminClubeInterestBusy)return;
  adminClubeInterestBusy=true;
  try{
    const data=await adminInvoke({action:'clube-interest-queue'});
    if(data?.source!=='admin_clube_interest_queue_v1_240'||
      data?.readOnly!==true||data?.noContactsExposed!==true||
      data?.sponsorFundingConfirmedCents!==0||
      data?.couponSalesEnabled!==false||data?.noCharge!==true||
      data?.noContractsApproved!==true||
      !Number.isSafeInteger(data?.totalProposals)||data.totalProposals<0||
      !Array.isArray(data?.rows)||data.rows.length>50)
      throw new Error('Fila de propostas não validada pelo servidor.');
    if(String(adminRuntime?.session?.user?.id||'')!==id)return;
    adminClubeInterestState={...data,loadedFor:id};
  }catch(e){
    if(String(adminRuntime?.session?.user?.id||'')===id){
      adminClubeInterestState=null;
      toast(String(e?.message||'Não foi possível consultar o Clube.'));
    }
  }finally{adminClubeInterestBusy=false;render();}
}
function adminClubeInterestSection(){
  if(!['superadmin','operations','compliance','finance','readonly'].includes(
      String(adminCurrentRole())))return '';
  const id=String(adminRuntime?.session?.user?.id||'');
  const data=adminClubeInterestState?.loadedFor===id?adminClubeInterestState:null;
  const rows=(data?.rows||[]).map(x=>
    '<div class="list-row"><div><strong>'+esc(x.companyName||'Revenda')+'</strong>'+
    '<br><small>'+esc(x.packageKey==='gas_3x5'?'Clube Gás':'Clube Água')+
    ' • '+esc([x.city,x.state].filter(Boolean).join('/'))+
    ' • '+(Number(x.shareBps)/100).toLocaleString('pt-BR')+'% do desconto'+
    ' • até '+adminMoney(x.budgetCents)+' (intenção, não contrato)</small></div>'+
    '<small>'+esc(x.updatedAt?new Date(x.updatedAt).toLocaleDateString('pt-BR'):'')+
    '</small></div>').join('');
  return '<section class="section admin-clube-interest">'+
    '<div class="section-head"><div><span class="section-kicker">CLUBE TAMÃO • PARCERIAS</span>'+
    '<h3>Propostas de participação das revendas</h3>'+
    '<p>Interesse voluntário por pacote e cidade. Não equivale a verba confirmada ou cupons disponíveis.</p></div>'+
    '<button type="button" class="secondary small" onclick="adminClubeInterestLoadFromUi()" '+
    (adminClubeInterestBusy?'disabled':'')+'>Consultar propostas</button></div>'+
    (data?'<div class="merchant-kpis">'+
      '<div class="kpi"><span class="label">Intenções registradas</span><strong>'+
        Number(data.totalProposals).toLocaleString('pt-BR')+'</strong><small>Uma revenda pode sugerir dois pacotes</small></div>'+
      '<div class="kpi"><span class="label">Patrocínio comprovado</span><strong>R$ 0</strong><small>Nenhum contrato aprovado</small></div>'+
      '<div class="kpi"><span class="label">Pacotes disponíveis para venda</span><strong>0</strong><small>Bloqueio financeiro mantido</small></div>'+
    '</div><div class="list" style="margin-top:12px">'+
      (rows||'<p class="muted tiny">Ainda não existem propostas de revendas registradas.</p>')+
      '</div>':'<p class="muted tiny">Consulte o interesse real antes de definir a campanha. Nenhum orçamento está reservado.</p>')+
    '</section>';
}

// TAMÃO Clube V1.241 — pipeline to negotiate future sponsorship, not a real campaign.
let adminClubeCampaignState=null;
let adminClubeCampaignBusy=false;
const adminClubeCampaignReviewsPending=new Set();
async function adminClubeCampaignLoadFromUi(){
  const id=String(adminRuntime?.session?.user?.id||'');
  if(!id||!['superadmin','operations','compliance','finance','readonly'].includes(
      String(adminCurrentRole()))||adminClubeCampaignBusy)return;
  adminClubeCampaignBusy=true;
  try{
    const data=await adminInvoke({action:'clube-campaign-queue'});
    if(data?.source!=='admin_clube_campaign_queue_v1_241'||
      data?.readOnly!==true||data?.noContractsApproved!==true||
      data?.sponsorFundingConfirmedCents!==0||
      data?.couponSalesEnabled!==false||data?.campaignsActive!==0||
      data?.noCharge!==true||data?.noMerchantSaleProceeds!==true||
      !Number.isSafeInteger(data?.totalProposals)||data.totalProposals<0||
      !Number.isSafeInteger(data?.activeInterests)||data.activeInterests<0||
      !Array.isArray(data?.rows)||data.rows.length>50)
      throw new Error('A fila de negociações não foi verificada.');
    if(id!==String(adminRuntime?.session?.user?.id||''))return;
    adminClubeCampaignState={...data,loadedFor:id};
  }catch(e){
    if(id===String(adminRuntime?.session?.user?.id||'')){
      adminClubeCampaignState=null;
      toast(String(e?.message||'Não foi possível consultar as negociações.'));
    }
  }finally{adminClubeCampaignBusy=false;render();}
}
async function adminClubeCampaignReviewFromUi(merchantId,packageKey,expectedVersion,expectedInterestVersion){
  const actor=String(adminRuntime?.session?.user?.id||'');
  const role=String(adminCurrentRole());
  if(!actor||!['superadmin','operations','compliance','finance'].includes(role))return;
  const data=adminClubeCampaignState?.loadedFor===actor?adminClubeCampaignState:null;
  const row=data?.rows?.find(x=>x.merchantId===merchantId&&x.packageKey===packageKey);
  if(!row||!row.interestActive||
    row.reviewVersion!==expectedVersion||row.interestVersion!==expectedInterestVersion||
    adminClubeCampaignReviewsPending.has(merchantId+':'+packageKey))
    return toast('Atualize a fila antes de revisar.');
  const key=merchantId+'-'+packageKey;
  const status=String(document.getElementById('clube-review-status-'+key)?.value||'');
  const note=String(document.getElementById('clube-review-note-'+key)?.value||'').trim();
  if(!['under_review','request_documents','economic_prechecked','declined'].includes(status)||
    (status==='economic_prechecked'&&!['superadmin','finance'].includes(role))||
    note.length<12||note.length>500)
    return toast('Selecione uma etapa permitida e informe uma justificativa de 12 a 500 caracteres.');
  adminClubeCampaignReviewsPending.add(merchantId+':'+packageKey);
  try{
    const result=await adminInvoke({action:'clube-campaign-review',
      merchantId,packageKey,status,note,expectedVersion,expectedInterestVersion,
      requestId:crypto.randomUUID()});
    if(result?.source!=='admin_clube_campaign_review_v1_241'||
      result?.recorded!==true||result?.noCharge!==true||
      result?.noContract!==true||result?.fundingVerified!==false||
      result?.campaignEnabled!==false||result?.couponSalesEnabled!==false)
      throw new Error('O registro da negociação não foi confirmado.');
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      toast('Etapa registrada. Nenhum orçamento foi reservado e não há cupons ativos.');
      await adminClubeCampaignLoadFromUi();
    }
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      toast(String(e?.message||'A revisão não foi salva. Atualize a fila.'));
    }
  }finally{adminClubeCampaignReviewsPending.delete(merchantId+':'+packageKey);render();}
}
// V1.242 — nonbinding terms dossier; all budgets are plans, never verified sponsorship.
let adminClubeTermsState=null;
let adminClubeTermsBusy=false;
const adminClubeTermsSaving=new Set();
async function adminClubeTermsLoadFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  if(!actor||!['superadmin','operations','compliance','finance','readonly'].includes(
      String(adminCurrentRole()))||adminClubeTermsBusy)return;
  adminClubeTermsBusy=true;
  try{
    const d=await adminInvoke({action:'clube-terms-queue'});
    if(d?.source!=='admin_clube_terms_queue_v1_242'||
       d.readOnly!==true||d.noContractsSigned!==true||
       d.fundingVerifiedCents!==0||d.couponSalesEnabled!==false||
       d.noCharge!==true||d.moneyReservedCents!==0||
       !Number.isSafeInteger(d.totalReviews)||d.totalReviews<0||
       !Array.isArray(d.rows)||d.rows.length>50)
      throw new Error('Minutas não verificadas pelo servidor.');
    if(actor!==String(adminRuntime?.session?.user?.id||''))return;
    adminClubeTermsState={...d,loadedFor:actor};
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminClubeTermsState=null;
      toast(String(e?.message||'Não foi possível carregar as condições.'));
    }
  }finally{adminClubeTermsBusy=false;render();}
}
async function adminClubeTermsSaveFromUi(merchantId,packageKey,expectedVersion,expectedInterestVersion,expectedReviewVersion){
  const actor=String(adminRuntime?.session?.user?.id||'');
  if(!actor||!['finance','superadmin'].includes(String(adminCurrentRole())))return;
  const data=adminClubeTermsState?.loadedFor===actor?adminClubeTermsState:null;
  const x=data?.rows?.find(y=>y.merchantId===merchantId&&y.packageKey===packageKey);
  if(!x||!x.currentInterest||!x.currentReview||
    x.termsVersion!==expectedVersion||x.interestVersion!==expectedInterestVersion||
    x.reviewVersion!==expectedReviewVersion)return toast('Atualize a proposta antes de salvar.');
  const key=merchantId+'-'+packageKey;
  if(adminClubeTermsSaving.has(key))return;
  const read=id=>String(document.getElementById(id+'-'+key)?.value||'');
  const status=read('clube-terms-status');
  const brandShareBps=Number(read('clube-terms-brand-share'));
  const brandBudgetCents=Number(read('clube-terms-brand-budget'));
  const platformBudgetCents=Number(read('clube-terms-platform-budget'));
  const identityDocumentStatus=read('clube-terms-identity');
  const agreementDocumentStatus=read('clube-terms-agreement');
  const fundingDocumentStatus=read('clube-terms-funding');
  const note=read('clube-terms-note').trim();
  const docs=['not_requested','requested','supplied_unverified'];
  if(!['draft','shared_for_discussion','withdrawn'].includes(status)||
      !Number.isSafeInteger(brandShareBps)||brandShareBps<0||
      brandShareBps+x.merchantShareBps>10000||
      ![brandBudgetCents,platformBudgetCents].every(v=>
        Number.isSafeInteger(v)&&v>=0&&v<=1000000)||
      ![identityDocumentStatus,agreementDocumentStatus,fundingDocumentStatus].every(x=>docs.includes(x))||
      note.length<12||note.length>500)
    return toast('Revise percentuais, orçamentos propostos, documentos e justificativa.');
  adminClubeTermsSaving.add(key);
  try{
    const result=await adminInvoke({action:'clube-terms-save',
      merchantId,packageKey,status,brandShareBps,brandBudgetCents,
      platformBudgetCents,identityDocumentStatus,
      agreementDocumentStatus,fundingDocumentStatus,note,
      expectedVersion,expectedInterestVersion,expectedReviewVersion,
      requestId:crypto.randomUUID()});
    if(result?.source!=='admin_clube_terms_save_v1_242'||
      result?.recorded!==true||result?.noContract!==true||
      result?.noCharge!==true||result?.fundingVerified!==false||
      result?.couponSalesEnabled!==false||result?.budgetReservedCents!==0)
      throw new Error('Condições não confirmadas pelo servidor.');
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      toast('Minuta atualizada. Não há contrato, financiamento confirmado nem cupom ativo.');
      await adminClubeTermsLoadFromUi();
    }
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      toast(String(e?.message||'Minuta não salva. Verifique os dados e atualize a fila.'));
    }
  }finally{adminClubeTermsSaving.delete(key);render();}
}
function adminClubeTermsSection(){
  const role=String(adminCurrentRole());
  if(!['superadmin','operations','compliance','finance','readonly'].includes(role))return '';
  const actor=String(adminRuntime?.session?.user?.id||'');
  const d=adminClubeTermsState?.loadedFor===actor?adminClubeTermsState:null;
  const canEdit=['superadmin','finance'].includes(role);
  const options=(items,current)=>items.map(x=>
    '<option value="'+esc(x[0])+'"'+(String(x[0])===String(current)?' selected':'')+'>'+esc(x[1])+'</option>').join('');
  const docs=[['not_requested','Não solicitado'],['requested','Solicitado'],
    ['supplied_unverified','Informado como recebido; não validado']];
  const budgets=[[0,'Não previsto'],[3000,'R$ 30'],[10000,'R$ 100'],[30000,'R$ 300'],
    [100000,'R$ 1.000'],[1000000,'R$ 10.000']];
  const rows=(d?.rows||[]).map(x=>{
    const key=String(x.merchantId)+'-'+String(x.packageKey);
    const current=x.currentInterest&&x.currentReview;
    const caps=x.capacity;
    const shareOptions=[[0,'0%'],[2500,'25%'],[5000,'50%'],
      [7500,'75%'],[10000,'100%']].filter(v=>v[0]+x.merchantShareBps<=10000);
    const form=canEdit&&current?
      '<div class="form-stack">'+
      '<div class="input-wrap"><label for="clube-terms-status-'+esc(key)+'">Situação da minuta</label>'+
      '<select class="input" id="clube-terms-status-'+esc(key)+'">'+
      options([['draft','Rascunho interno'],['shared_for_discussion','Compartilhar para conversa'],
        ['withdrawn','Retirar minuta']],x.termsStatus||'draft')+'</select></div>'+
      '<div class="grid cards-2"><div class="input-wrap"><label for="clube-terms-brand-share-'+esc(key)+'">Participação proposta da marca (restante é TAMÃO)</label>'+
      '<select class="input" id="clube-terms-brand-share-'+esc(key)+'">'+
      options(shareOptions,x.brandShareBps||0)+'</select></div>'+
      '<div class="input-wrap"><label for="clube-terms-brand-budget-'+esc(key)+'">Limite sugerido da marca</label>'+
      '<select class="input" id="clube-terms-brand-budget-'+esc(key)+'">'+
      options(budgets,x.brandBudgetCents||0)+'</select></div>'+
      '<div class="input-wrap"><label for="clube-terms-platform-budget-'+esc(key)+'">Limite sugerido para o TAMÃO</label>'+
      '<select class="input" id="clube-terms-platform-budget-'+esc(key)+'">'+
      options(budgets,x.platformBudgetCents||0)+'</select></div></div>'+
      [['identity','Documento/representação',x.identityDocumentStatus],
       ['agreement','Minuta jurídica',x.agreementDocumentStatus],
       ['funding','Fonte de custeio',x.fundingDocumentStatus]].map(v=>
      '<div class="input-wrap"><label for="clube-terms-'+v[0]+'-'+esc(key)+'">'+esc(v[1])+'</label>'+
      '<select class="input" id="clube-terms-'+v[0]+'-'+esc(key)+'">'+options(docs,v[2])+'</select></div>').join('')+
      '<div class="input-wrap"><label for="clube-terms-note-'+esc(key)+'">Observações para negociação (12 a 500 caracteres)</label>'+
      '<textarea class="input" id="clube-terms-note-'+esc(key)+'" maxlength="500" rows="3">'+esc(x.notes||'')+'</textarea></div>'+
      '<button class="secondary small" type="button" onclick="adminClubeTermsSaveFromUi(\''+
        esc(x.merchantId)+'\',\''+esc(x.packageKey)+'\','+
        Number(x.termsVersion)+','+Number(x.interestVersion)+','+Number(x.reviewVersion)+')" '+
        (adminClubeTermsSaving.has(key)?'disabled':'')+'>Salvar minuta, sem firmar contrato</button></div>':
      '<p class="tiny muted">Minuta somente para consulta ou aguardando revisão válida.</p>';
    return '<article class="card flat form-stack">'+
      '<div class="section-head"><div><strong>'+esc(x.companyName)+'</strong>'+
      '<p class="tiny muted">'+esc(x.packageKey==='gas_3x5'?'Clube Gás':'Clube Água')+
      ' • '+esc([x.city,x.state].filter(Boolean).join('/'))+'</p></div>'+
      '<span class="status-pill '+(current&&x.currentTerms?'online':'risk')+'">'+
      (x.termsVersion===0?'Sem minuta':current&&x.currentTerms?'Minuta atual':'Revisão pendente')+
      '</span></div>'+
      '<p class="tiny muted">Revenda: '+(Number(x.merchantShareBps)/100).toLocaleString('pt-BR')+
      '% dos descontos • teto pretendido '+adminMoney(x.merchantBudgetCents)+
      ' • ciência da revenda: '+esc(({none:'Ainda não registrada',read_for_discussion:'Ciência para negociação',
      not_interested:'Não tem interesse'})[x.merchantResponse]||'Não informada')+'</p>'+
      (caps?'<div class="merchant-kpis">'+
        '<div class="kpi"><span class="label">Custo revenda/uso</span><strong>'+adminMoney(caps.merchantPerUseCents)+'</strong></div>'+
        '<div class="kpi"><span class="label">Custo marca/uso</span><strong>'+adminMoney(caps.brandPerUseCents)+'</strong></div>'+
        '<div class="kpi"><span class="label">Custo TAMÃO/uso</span><strong>'+adminMoney(caps.platformPerUseCents)+'</strong></div>'+
        '<div class="kpi"><span class="label">Pacotes em cenário</span><strong>'+Number(caps.maxPackagesIllustrative)+'</strong><small>Não disponíveis</small></div></div>':'')+
      form+'</article>';
  }).join('');
  return '<section class="section admin-clube-terms">'+
    '<div class="section-head"><div><span class="section-kicker">CLUBE TAMÃO • CONDIÇÕES COMERCIAIS</span>'+
    '<h3>Minutas e comprovações pendentes</h3>'+
    '<p>Calcule a divisão dos descontos, solicite documentos e apresente condições para conversa com a revenda.</p></div>'+
    '<button type="button" class="secondary small" onclick="adminClubeTermsLoadFromUi()" '+
      (adminClubeTermsBusy?'disabled':'')+'>Consultar minutas</button></div>'+
    (d?'<div class="merchant-kpis">'+
      '<div class="kpi"><span class="label">Negociações em histórico</span><strong>'+Number(d.totalReviews)+'</strong></div>'+
      '<div class="kpi"><span class="label">Verba comprovada</span><strong>R$ 0</strong></div>'+
      '<div class="kpi"><span class="label">Contratos assinados</span><strong>0</strong></div>'+
      '<div class="kpi"><span class="label">Cupons para venda</span><strong>0</strong></div></div>'+
      '<div class="grid cards-2" style="margin-top:12px">'+
      (rows||'<p class="muted">Nenhuma negociação com revenda foi registrada.</p>')+'</div>':
      '<p class="tiny muted">Consulte para visualizar minutas e simular a cobertura de descontos. Nenhum orçamento foi reservado.</p>')+
    '<p class="tiny muted">Documentos informados como recebidos ainda exigem verificação externa. Compartilhar uma minuta não constitui proposta vinculante, reserva de dinheiro ou confirmação de patrocínio.</p></section>';
}

// V1.244 — Private founder-financing policy (NOT a cash balance or automatic promise).
let adminOwnerFundingState=null;
let adminOwnerFundingPulseState=null;
let adminOwnerFundingLoading=false;
const adminOwnerFundingSaving=new Set();
async function adminOwnerFundingLoadFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  if(!actor||!['superadmin','finance'].includes(String(adminCurrentRole()))||adminOwnerFundingLoading)return;
  adminOwnerFundingLoading=true;
  try{
    const [d,pulse]=await Promise.all([
      adminInvoke({action:'owner-funding-read'}),
      adminInvoke({action:'owner-funding-pulse'})
    ]);
    if(d?.source!=='admin_owner_funding_read_v1_244'||d?.fundingSource!=='platform_owner'||
      d?.newBenefitsEnabled!==false||d?.noCharge!==true||
      d?.verifiedDepositCents!==0||d?.moneyReservedCents!==0||
      !Array.isArray(d.rows)||d.rows.length!==4)
      throw new Error('O plano de custeio não foi validado.');
    if(pulse?.source!=='admin_owner_funding_pulse_v1_245'||
      pulse?.readOnly!==true||pulse?.noCharge!==true||
      pulse?.timezone!=='America/Sao_Paulo'||
      pulse?.metricMeaning!=='grants_created_this_month_not_bank_spending'||
      pulse?.budgetMeaning!=='owner_plan_not_funds_deposited'||
      pulse?.verifiedDepositCents!==0||pulse?.moneyReservedCents!==0||
      pulse?.payoutsMeasured!==false||pulse?.newBenefitsActivated!==false||
      !Array.isArray(pulse?.rows)||pulse.rows.length!==4)
      throw new Error('Indicadores de incentivos não verificados.');
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerFundingState={...d,loadedFor:actor};
      adminOwnerFundingPulseState={...pulse,loadedFor:actor};
    }
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerFundingState=null;
      adminOwnerFundingPulseState=null;
      toast(String(e?.message||'Não foi possível consultar o custeio.'));
    }
  }finally{adminOwnerFundingLoading=false;render();}
}
function adminOwnerFundingReaisToCents(value,maxCents){
  const n=Number(value);
  if(!Number.isFinite(n)||n<0||n>maxCents/100)return null;
  const cents=Math.round(n*100);
  if(!Number.isSafeInteger(cents)||Math.abs(n*100-cents)>0.000001)return null;
  return cents;
}
async function adminOwnerFundingSaveFromUi(key,expectedVersion){
  const actor=String(adminRuntime?.session?.user?.id||'');
  if(!actor||String(adminCurrentRole())!=='superadmin')return;
  const d=adminOwnerFundingState?.loadedFor===actor?adminOwnerFundingState:null;
  const current=d?.rows?.find(x=>x.benefitKey===key);
  if(!current||current.version!==expectedVersion||adminOwnerFundingSaving.has(key))
    return toast('Atualize o plano antes de salvar.');
  const val=id=>String(document.getElementById('owner-funding-'+id+'-'+key)?.value||'');
  const budgetCents=adminOwnerFundingReaisToCents(val('budget'),50000000);
  const capCents=adminOwnerFundingReaisToCents(val('cap'),10000000);
  const status=val('status');
  const note=val('note').trim();
  if(![budgetCents,capCents].every(v=>Number.isSafeInteger(v)&&v>=0)||
    budgetCents>50000000||capCents>10000000||capCents>budgetCents||
    !['planning','internally_committed'].includes(status)||
    (status==='internally_committed'&&(budgetCents===0||capCents===0))||
    note.length<12||note.length>400)
    return toast('Confira orçamento, limite individual, situação e justificativa.');
  adminOwnerFundingSaving.add(key);
  try{
    const result=await adminInvoke({action:'owner-funding-save',
      benefitKey:key,budgetCents,capCents,status,note,expectedVersion,
      requestId:crypto.randomUUID()});
    if(result?.source!=='admin_owner_funding_save_v1_244'||result?.recorded!==true||
      result?.noExternalCommitment!==true||result?.newBenefitsEnabled!==false||
      result?.verifiedDepositCents!==0||result?.moneyReservedCents!==0||
      result?.moneyPaidCents!==0)
      throw new Error('Planejamento ainda não confirmado.');
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      toast('Orçamento interno registrado. O plano não movimenta dinheiro.');
      await adminOwnerFundingLoadFromUi();
    }
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      toast(String(e?.message||'Não foi possível salvar o orçamento.'));
    }
  }finally{adminOwnerFundingSaving.delete(key);render();}
}
function adminOwnerFundingSection(){
  const role=String(adminCurrentRole());
  if(!['superadmin','finance'].includes(role))return '';
  const actor=String(adminRuntime?.session?.user?.id||'');
  const d=adminOwnerFundingState?.loadedFor===actor?adminOwnerFundingState:null;
  const pulse=adminOwnerFundingPulseState?.loadedFor===actor?adminOwnerFundingPulseState:null;
  const labels={
    customer_cashback:'Cashback de clientes',
    customer_referral:'Comissões por clientes indicados',
    merchant_referral:'Bonificação por revendas indicadas',
    clube_coupons:'Cupons do Clube TAMÃO'
  };
  const signalText={
    budget_not_defined:'Definir teto mensal',
    gross_exceeds_plan:'Concessões superam o plano',
    near_planned_limit:'Próximo do teto planejado',
    within_planned_limit:'Dentro do teto planejado'
  };
  const metrics=(pulse?.rows||[]).map(x=>{
    const available=x.policyEnabled===true;
    const used=Number(x.grossGrantedCents||0);
    const reversed=Number(x.reversedGrantedCents||0);
    const remainder=Number(x.netGrantedCents||0);
    return '<article class="card flat form-stack">'+
      '<div class="section-head"><strong>'+esc(labels[x.benefitKey]||x.benefitKey)+'</strong>'+
      '<span class="tiny muted">'+(available?'Motor de benefícios configurado':'Benefício ainda não habilitado')+'</span></div>'+
      '<div class="merchant-kpis">'+
      '<div class="kpi"><span class="label">Créditos gerados no mês</span><strong>'+adminMoney(used)+'</strong></div>'+
      '<div class="kpi"><span class="label">Créditos das emissões do mês estornados</span><strong>'+adminMoney(reversed)+'</strong></div>'+
      '<div class="kpi"><span class="label">Emissões ainda válidas</span><strong>'+adminMoney(remainder)+'</strong></div>'+
      '<div class="kpi"><span class="label">Orçamento mensal planejado</span><strong>'+
      adminMoney(x.plannedBudgetCents)+'</strong></div></div>'+
      '<p class="tiny muted">'+esc(signalText[x.planningSignal]||'Acompanhamento financeiro')+
      (x.grossVsPlannedPct===null?'':', '+Number(x.grossVsPlannedPct).toLocaleString('pt-BR')+'% do teto')+
      '. O valor dos créditos não representa dinheiro pago ou disponível em conta.</p></article>';
  }).join('');
  const cards=(d?.rows||[]).map(x=>{
    const key=String(x.benefitKey);
    const fields=role==='superadmin'?
      '<div class="grid cards-2">'+
      '<label class="input-wrap">Orçamento mensal (R$)'+
      '<input class="input" type="number" inputmode="decimal" min="0" max="500000" step="0.01" id="owner-funding-budget-'+esc(key)+'" value="'+(Number(x.budgetCents)/100).toFixed(2)+'"></label>'+
      '<label class="input-wrap">Limite por pessoa (R$)'+
      '<input class="input" type="number" inputmode="decimal" min="0" max="100000" step="0.01" id="owner-funding-cap-'+esc(key)+'" value="'+(Number(x.capCents)/100).toFixed(2)+'"></label>'+
      '</div><label class="input-wrap">Declaração interna'+
      '<select class="input" id="owner-funding-status-'+esc(key)+'">'+
      '<option value="planning"'+(x.status==='planning'?' selected':'')+'>Em planejamento</option>'+
      '<option value="internally_committed"'+(x.status==='internally_committed'?' selected':'')+'>Compromisso interno do fundador</option>'+
      '</select></label>'+
      '<label class="input-wrap">Justificativa / origem prevista'+
      '<textarea class="input" maxlength="400" rows="2" id="owner-funding-note-'+esc(key)+'">'+esc(x.note||'Recursos próprios destinados aos incentivos da plataforma.')+'</textarea></label>'+
      '<button type="button" class="secondary small" onclick="adminOwnerFundingSaveFromUi(\''+
      esc(key)+'\','+Number(x.version)+')" '+(adminOwnerFundingSaving.has(key)?'disabled':'')+
      '>Salvar orçamento interno</button>':
      '<p class="tiny muted">Consulta financeira. Edição reservada ao administrador principal.</p>';
    return '<article class="card flat form-stack"><h3>'+esc(labels[key]||key)+'</h3>'+
      '<p class="tiny muted">Teto mensal proposto: '+adminMoney(x.budgetCents)+
      ' • limite por pessoa: '+adminMoney(x.capCents)+
      ' • '+(x.status==='internally_committed'?'Compromisso interno registrado':'Em planejamento')+'</p>'+
      fields+'</article>';
  }).join('');
  return '<section class="section admin-owner-funding"><div class="section-head"><div>'+
    '<span class="section-kicker">FINANCIAMENTO INICIAL • GESTÃO INTERNA</span>'+
    '<h3>Incentivos financiados pelo TAMÃO</h3>'+
    '<p>Defina quanto pretende destinar por mês a cashback, comissões, indicações e cupons, com limites individuais.</p>'+
    '</div><button type="button" class="secondary small" onclick="adminOwnerFundingLoadFromUi()" '+
      (adminOwnerFundingLoading?'disabled':'')+'>Consultar orçamento</button></div>'+
    (pulse?'<div class="section-head"><div>'+
      '<h4>Concessões reais do mês</h4>'+
      '<p>Referência: '+esc(pulse.monthStart)+' a '+esc(pulse.periodEndExclusive)+
      ' (fim exclusivo, horário de São Paulo). '+Number(pulse.grantsCount).toLocaleString('pt-BR')+
      ' registros de benefícios gerados; '+Number(pulse.reversedGrantsCount).toLocaleString('pt-BR')+
      ' revertidos.</p></div></div><div class="grid cards-2">'+metrics+'</div>':'')+
    (d?'<div class="section-head"><div><h4>Planejamento do fundador</h4></div></div>'+
      '<div class="grid cards-2">'+cards+'</div>':
      '<p class="muted">Consulte os quatro centros de incentivo para estabelecer os limites de custeio.</p>')+
    '<p class="tiny muted">Uso administrativo: o valor informado é uma intenção de custeio do proprietário. Não é depósito confirmado, saldo disponível, reserva de campanha ou autorização para saque. O cashback e a comissão já existentes seguem suas regras independentes; este plano não os altera.</p>'+
    '</section>';
}

// TAMÃO V1.246: internal bank-evidence queue — not a spendable balance.
let adminOwnerEvidenceState=null;
let adminOwnerEvidenceBusy=false;
const adminOwnerEvidencePending=new Set();
async function adminOwnerEvidenceLoadFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  if(!actor||!['finance','superadmin'].includes(String(adminCurrentRole()))||adminOwnerEvidenceBusy)return;
  adminOwnerEvidenceBusy=true;
  try{
    const result=await adminInvoke({action:'owner-evidence-queue'});
    if(result?.source!=='admin_owner_evidence_queue_v1_246'||
       result?.bankApiConfirmed!==false||result?.fundsSpendable!==false||
       result?.spendableCents!==0||result?.newBenefitsEnabled!==false||
       result?.cashMoved!==false||result?.readOnly!==true||
       !Array.isArray(result.rows)||result.rows.length>50||
       !Number.isSafeInteger(result.total)||result.total<0)
      throw new Error('A conferência financeira não foi validada.');
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerEvidenceState={...result,loadedFor:actor};
    }
  }catch(error){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerEvidenceState=null;
      toast(String(error?.message||'Falha ao consultar registros financeiros.'));
    }
  }finally{adminOwnerEvidenceBusy=false;render();}
}
async function adminOwnerEvidenceSubmitFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  if(!actor||!['finance','superadmin'].includes(String(adminCurrentRole()))||
     adminOwnerEvidencePending.has('submit'))return;
  const form=id=>String(document.getElementById('owner-evidence-'+id)?.value||'').trim();
  const key=form('benefit');
  const plan=adminOwnerFundingState?.loadedFor===actor?
    adminOwnerFundingState.rows?.find(x=>x.benefitKey===key):null;
  const amount=adminOwnerFundingReaisToCents(form('amount'),50000000);
  const transferDate=form('date');
  const transferReference=form('reference');
  const note=form('note');
  if(!plan||plan.version<1||plan.status!=='internally_committed'||
     amount===null||amount<100||amount>plan.budgetCents||
     !/^\d{4}-\d{2}-\d{2}$/.test(transferDate)||
     !/^[a-zA-Z0-9 .:_-]{12,100}$/.test(transferReference)||
     note.length<12||note.length>300)
     return toast('Defina o orçamento, confirme data, referência bancária e valor do aporte.');
  adminOwnerEvidencePending.add('submit');
  try{
    const data=await adminInvoke({action:'owner-evidence-submit',
     contributionId:crypto.randomUUID(),requestId:crypto.randomUUID(),
     benefitKey:key,planVersion:plan.version,amountCents:amount,
     transferDate,transferReference,note});
    if(data?.source!=='admin_owner_evidence_submit_v1_246'||data?.recorded!==true||
       data?.status!=='pending_review'||data?.bankApiConfirmed!==false||
       data?.fundsSpendable!==false||data?.newBenefitsEnabled!==false||
       data?.cashMoved!==false)
      throw new Error('Registro do aporte não confirmado.');
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      toast(adminCurrentRole()==='superadmin'
        ?'Aporte declarado. Confira o extrato e registre sua decisão abaixo.'
        :'Aporte declarado. Aguarda conferência por outro administrador financeiro.');
      adminOwnerFinanceHistoryState=null;
      await adminOwnerEvidenceLoadFromUi();
    }
  }catch(error){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      toast(String(error?.message||'Não foi possível registrar o aporte.'));
    }
  }finally{adminOwnerEvidencePending.delete('submit');render();}
}
async function adminOwnerEvidenceReviewFromUi(id,version){
  const actor=String(adminRuntime?.session?.user?.id||'');
  if(!actor||!['finance','superadmin'].includes(String(adminCurrentRole())))return;
  const d=adminOwnerEvidenceState?.loadedFor===actor?adminOwnerEvidenceState:null;
  const rec=d?.rows?.find(x=>x.contributionId===id);
  if(!rec||rec.version!==version||
     (rec.submittedBy===actor&&adminCurrentRole()!=='superadmin')||
     !['pending_review','manual_reconciled'].includes(rec.status)||
     adminOwnerEvidencePending.has(id))
      return toast('Registro desatualizado ou sem permissão para conferência.');
  const val=k=>String(document.getElementById('owner-evidence-'+k+'-'+id)?.value||'').trim();
  const status=val('status');
  const note=val('review-note');
  const statementReference=val('statement');
  if(!['manual_reconciled','rejected','disputed'].includes(status)||
     (rec.status==='manual_reconciled'&&status!=='disputed')||
     note.length<12||note.length>300||
     (status==='manual_reconciled'&&!/^[a-zA-Z0-9 .:_-]{12,100}$/.test(statementReference))||
     (status!=='manual_reconciled'&&statementReference.length))
      return toast('Preencha a decisão e a referência do extrato para conferência.');
  adminOwnerEvidencePending.add(id);
  try{
    const result=await adminInvoke({action:'owner-evidence-review',
      contributionId:id,reviewStatus:status,expectedVersion:version,note,
      statementReference,requestId:crypto.randomUUID()});
    if(result?.source!=='admin_owner_evidence_review_v1_246'||
       result?.recorded!==true||result?.reviewStatus!==status||
       result?.bankApiConfirmed!==false||result?.fundsSpendable!==false||
       result?.newBenefitsEnabled!==false||result?.cashMoved!==false)
      throw new Error('Revisão ainda não confirmada.');
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      toast('Conferência interna registrada. Nenhum saldo foi liberado para gastar.');
      await adminOwnerEvidenceLoadFromUi();
    }
  }catch(error){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      toast(String(error?.message||'Não foi possível concluir a revisão.'));
    }
  }finally{adminOwnerEvidencePending.delete(id);render();}
}
function adminOwnerEvidenceSection(){
  const role=String(adminCurrentRole());
  if(!['finance','superadmin'].includes(role))return '';
  const actor=String(adminRuntime?.session?.user?.id||'');
  const data=adminOwnerEvidenceState?.loadedFor===actor?adminOwnerEvidenceState:null;
  const plan=adminOwnerFundingState?.loadedFor===actor?adminOwnerFundingState:null;
  const labels={
    customer_cashback:'Cashback de clientes',customer_referral:'Indicação de clientes',
    merchant_referral:'Indicação de revendas',clube_coupons:'Clube TAMÃO'
  };
  const planChoices=(plan?.rows||[]).filter(x=>x.version>0&&x.status==='internally_committed');
  const options=planChoices.map(x=>
     '<option value="'+esc(x.benefitKey)+'">'+esc(labels[x.benefitKey])+
     ' • '+adminMoney(x.budgetCents)+'/mês</option>').join('');
  const canSubmit=planChoices.length>0;
  const form='<div class="card flat form-stack">'+
    '<h4>Declarar aporte para conferência</h4>'+
    '<p class="tiny muted">Registre somente transferências já realizadas e conferíveis no seu extrato bancário. O administrador principal pode fazer a própria conferência com referência do extrato; o perfil financeiro segue com revisão por outra pessoa.</p>'+
    '<label class="input-wrap">Destino do custeio<select class="input" id="owner-evidence-benefit">'+
    (options||'<option value="">Primeiro registre um orçamento interno</option>')+'</select></label>'+
    '<div class="grid cards-2"><label class="input-wrap">Valor informado (R$)'+
    '<input class="input" type="number" step="0.01" min="1" max="500000" id="owner-evidence-amount" placeholder="100,00"></label>'+
    '<label class="input-wrap">Data da transferência'+
    '<input class="input" type="date" id="owner-evidence-date"></label></div>'+
    '<label class="input-wrap">Identificador da transferência no banco'+
    '<input class="input" type="text" maxlength="100" id="owner-evidence-reference" placeholder="Identificação do comprovante"></label>'+
    '<label class="input-wrap">Observações internas'+
    '<textarea class="input" rows="2" maxlength="300" id="owner-evidence-note" placeholder="Conta de origem, destino e finalidade sem dados sigilosos"></textarea></label>'+
    '<button class="secondary small" type="button" onclick="adminOwnerEvidenceSubmitFromUi()" '+
    (!canSubmit||adminOwnerEvidencePending.has('submit')?'disabled':'')+
    '>Registrar aporte para conferência</button></div>';
  const statuses={pending_review:'Aguardando conferência',
    manual_reconciled:'Conferência manual registrada',
    rejected:'Recusado',disputed:'Contestação aberta'};
  const rows=(data?.rows||[]).map(x=>{
    const id=String(x.contributionId);
    const another=x.submittedBy!==actor;
    const reviewable=(role==='superadmin'||another)&&['pending_review','manual_reconciled'].includes(x.status);
    const reviewerForm=reviewable?'<div class="form-stack">'+
      '<label class="input-wrap">Resultado da conferência'+
      '<select class="input" id="owner-evidence-status-'+esc(id)+'">'+
      (x.status==='pending_review'?'<option value="manual_reconciled">Conferido com extrato (manual)</option>'+
      '<option value="rejected">Recusar comprovante</option>':'')+
      '<option value="disputed">Contestar registro</option></select></label>'+
      '<label class="input-wrap">Referência da operação no extrato'+
      '<input class="input" id="owner-evidence-statement-'+esc(id)+'" maxlength="100" type="text" placeholder="Linha ou identificador do extrato"></label>'+
      '<label class="input-wrap">Justificativa da análise'+
      '<textarea class="input" id="owner-evidence-review-note-'+esc(id)+'" maxlength="300" rows="2"></textarea></label>'+
      '<button class="secondary small" type="button" onclick="adminOwnerEvidenceReviewFromUi(\''+
      esc(id)+'\','+Number(x.version)+')" '+
      (adminOwnerEvidencePending.has(id)?'disabled':'')+
      '>Registrar conferência interna</button></div>':
      '<p class="tiny muted">'+(x.status==='pending_review'&&!another?'Somente o administrador principal pode conferir o próprio aporte.':'Registro em situação final.')+'</p>';
    return '<article class="card flat form-stack">'+
     '<div class="section-head"><div><strong>'+esc(labels[x.benefitKey]||x.benefitKey)+'</strong>'+
     '<p class="tiny muted">Transferência de '+esc(x.transferDate)+
     ' • '+esc(x.transferReference)+'</p></div><span class="status-pill">'+
     esc(statuses[x.status]||x.status)+'</span></div>'+
     '<p>Valor declarado: <strong>'+adminMoney(x.amountCents)+'</strong></p>'+
     '<p class="tiny muted">'+esc(x.note||'')+'</p>'+
     (x.reviewNote?'<p class="tiny muted">Análise: '+esc(x.reviewNote)+'</p>':'')+
     reviewerForm+'</article>';
  }).join('');
  return '<section class="section admin-owner-evidence">'+
    '<div class="section-head"><div><span class="section-kicker">FINANCIAMENTO PRÓPRIO • CONFERÊNCIA</span>'+
    '<h3>Aportes e comprovantes bancários</h3>'+
    '<p>Registre uma transferência real, registre sua conferência financeira e mantenha a responsabilidade de cada incentivo organizada.</p>'+
    '</div><button class="secondary small" type="button" onclick="adminOwnerEvidenceLoadFromUi()" '+
    (adminOwnerEvidenceBusy?'disabled':'')+'>Consultar registros</button></div>'+
    (data?'<div class="merchant-kpis">'+
       '<div class="kpi"><span class="label">Registros</span><strong>'+Number(data.total)+'</strong></div>'+
       '<div class="kpi"><span class="label">Aguardando conferência</span><strong>'+Number(data.pendingCount)+'</strong></div>'+
       '<div class="kpi"><span class="label">Conciliado manualmente</span><strong>'+adminMoney(data.manualReconciledCents)+'</strong></div>'+
       '<div class="kpi"><span class="label">Disponível para gastar</span><strong>R$ 0,00</strong></div></div>':
       '<p class="tiny muted">Consulte os registros para visualizar as conferências.</p>')+
    form+
    (data?'<div class="grid cards-2">'+(rows||'<p class="muted">Nenhum aporte registrado.</p>')+'</div>':'')+
    '<p class="tiny muted">A conferência é manual, não uma validação automática do banco. Os valores não são convertidos em créditos disponíveis para campanhas, pagamentos ou cupons nesta etapa.</p>'+
    '</section>';
}

// V1.247 — serialised allocation of the founder's planned budget.
// No allocation is bank cash, payout, invoice or coupon entitlement.
let adminOwnerBudgetState=null;
let adminOwnerBudgetBusy=false;
const adminOwnerBudgetPending=new Set();
async function adminOwnerBudgetLoadFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  if(!actor||!['superadmin','finance'].includes(String(adminCurrentRole()))||adminOwnerBudgetBusy)return;
  adminOwnerBudgetBusy=true;
  try{
    const d=await adminInvoke({action:'owner-budget-queue'});
    if(d?.source!=='admin_owner_budget_queue_v1_247'||
       d?.readOnly!==true||d?.plannedOnly!==true||
       d?.verifiedCashCents!==0||d?.spendableCents!==0||
       d?.newBenefitsEnabled!==false||d?.noCharge!==true||
       !Array.isArray(d.rows)||d.rows.length!==12||
       !Array.isArray(d.allocations)||d.allocations.length>50)
      throw new Error('Distribuição de orçamento não verificada.');
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerBudgetState={...d,loadedFor:actor};
    }
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerBudgetState=null;
      toast(String(e?.message||'Falha ao consultar distribuição de orçamento.'));
    }
  }finally{adminOwnerBudgetBusy=false;render();}
}
async function adminOwnerBudgetAllocateFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  if(!actor||String(adminCurrentRole())!=='superadmin'||
     adminOwnerBudgetPending.has('allocate'))return;
  const d=adminOwnerBudgetState?.loadedFor===actor?adminOwnerBudgetState:null;
  const value=k=>String(document.getElementById('owner-budget-'+k)?.value||'').trim();
  const [key,month]=value('month').split('|');
  const matching=d?.rows?.find(r=>r.benefitKey===key&&r.month===month);
  const reference=value('reference');
  const label=value('label');
  const amountCents=adminOwnerFundingReaisToCents(value('amount'),50000000);
  if(!matching||matching.planStatus!=='internally_committed'||matching.planVersion<1||
    amountCents===null||amountCents<100||amountCents>matching.unallocatedCents||
    !/^[a-z0-9_-]{8,80}$/.test(reference)||
    label.length<12||label.length>180)
    return toast('Revise campanha, mês, identificação, descrição e orçamento disponível.');
  adminOwnerBudgetPending.add('allocate');
  try{
    const data=await adminInvoke({action:'owner-budget-allocate',
      allocationId:crypto.randomUUID(),requestId:crypto.randomUUID(),
      benefitKey:key,month,campaignReference:reference,campaignLabel:label,
      amountCents,planVersion:matching.planVersion});
    if(data?.source!=='admin_owner_budget_allocate_v1_247'||data?.recorded!==true||
      data?.plannedOnly!==true||data?.noCharge!==true||
      data?.fundsVerified!==false||data?.spendableCents!==0||
      data?.newBenefitsEnabled!==false)
      throw new Error('Distribuição não confirmada.');
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      toast('Valor separado no planejamento, sem uso de dinheiro real.');
      adminOwnerFinanceHistoryState=null;
      adminOwnerCampaignSignalsState=null;
      await adminOwnerBudgetLoadFromUi();
    }
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      toast(String(e?.message||'Não foi possível distribuir o orçamento.'));
    }
  }finally{adminOwnerBudgetPending.delete('allocate');render();}
}
async function adminOwnerBudgetReleaseFromUi(id,expectedVersion){
  const actor=String(adminRuntime?.session?.user?.id||'');
  if(!actor||String(adminCurrentRole())!=='superadmin'||
    adminOwnerBudgetPending.has(id))return;
  const d=adminOwnerBudgetState?.loadedFor===actor?adminOwnerBudgetState:null;
  const row=d?.allocations?.find(x=>x.allocationId===id);
  if(!row||row.status!=='allocated'||row.version!==expectedVersion)
    return toast('Atualize as alocações antes de liberar.');
  const reason=String(prompt('Motivo para devolver o valor ao planejamento mensal:')||'').trim();
  if(reason.length<12||reason.length>240)
    return toast('Informe uma justificativa de 12 a 240 caracteres.');
  adminOwnerBudgetPending.add(id);
  try{
    const result=await adminInvoke({action:'owner-budget-release',
      allocationId:id,expectedVersion,reason,requestId:crypto.randomUUID()});
    if(result?.source!=='admin_owner_budget_release_v1_247'||result?.recorded!==true||
      result?.plannedOnly!==true||result?.noCharge!==true||
      result?.fundsVerified!==false||result?.spendableCents!==0||
      result?.newBenefitsEnabled!==false)
      throw new Error('Devolução ao orçamento não confirmada.');
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      toast('Valor devolvido ao planejamento mensal.');
      await adminOwnerBudgetLoadFromUi();
    }
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      toast(String(e?.message||'Não foi possível liberar o orçamento.'));
    }
  }finally{adminOwnerBudgetPending.delete(id);render();}
}
function adminOwnerBudgetSection(){
  const role=String(adminCurrentRole());
  if(!['superadmin','finance'].includes(role))return '';
  const actor=String(adminRuntime?.session?.user?.id||'');
  const d=adminOwnerBudgetState?.loadedFor===actor?adminOwnerBudgetState:null;
  const labels={
    customer_cashback:'Cashback de clientes',
    customer_referral:'Indicação de clientes',
    merchant_referral:'Indicação de revendas',
    clube_coupons:'Cupons Clube TAMÃO'
  };
  const rows=d?.rows||[];
  const monthly=rows.filter(x=>x.planStatus==='internally_committed'&&
    x.planVersion>0&&x.unallocatedCents>=100);
  const available=monthly.map(x=>'<option value="'+esc(x.benefitKey+'|'+x.month)+'">'+
    esc(labels[x.benefitKey]||x.benefitKey)+' — '+esc(x.month)+
    ' — '+adminMoney(x.unallocatedCents)+' disponível no plano</option>').join('');
  const summaries=rows.map(x=>
    '<article class="card flat form-stack"><p><strong>'+
    esc(labels[x.benefitKey]||x.benefitKey)+'</strong> • '+esc(x.month)+'</p>'+
    '<div class="merchant-kpis">'+
    '<div class="kpi"><span class="label">Teto planejado</span><strong>'+adminMoney(x.plannedCents)+'</strong></div>'+
    '<div class="kpi"><span class="label">Distribuído</span><strong>'+adminMoney(x.allocatedCents)+'</strong></div>'+
    '<div class="kpi"><span class="label">Ainda não distribuído</span><strong>'+adminMoney(x.unallocatedCents)+'</strong></div></div>'+
    (x.coverageExceeded?'<p class="tiny muted">Revise a cobertura do plano.</p>':'')+
    '</article>').join('');
  const controls=role==='superadmin'?
    '<div class="card flat form-stack"><h4>Separar orçamento por campanha</h4>'+
    '<p class="tiny muted">Esta ação distribui somente o orçamento mensal planejado e impede compromissos duplicados. Não movimenta conta bancária.</p>'+
    '<label class="input-wrap">Benefício e mês<select class="input" id="owner-budget-month">'+
    (available||'<option value="">Configure um orçamento positivo no painel acima</option>')+
    '</select></label>'+
    '<div class="grid cards-2">'+
    '<label class="input-wrap">Valor para a campanha (R$)'+
    '<input class="input" id="owner-budget-amount" type="number" step="0.01" min="1" max="500000"></label>'+
    '<label class="input-wrap">Código único da campanha'+
    '<input class="input" id="owner-budget-reference" type="text" maxlength="80" placeholder="ex.: cashback-outubro-01"></label></div>'+
    '<label class="input-wrap">Descrição da campanha'+
    '<input class="input" id="owner-budget-label" type="text" maxlength="180" placeholder="Incentivos para as primeiras compras da cidade"></label>'+
    '<button type="button" class="secondary small" onclick="adminOwnerBudgetAllocateFromUi()" '+
    (!available||adminOwnerBudgetPending.has('allocate')?'disabled':'')+
    '>Separar orçamento planejado</button></div>':'';
  const allocations=(d?.allocations||[]).map(x=>{
    const canRelease=role==='superadmin'&&x.status==='allocated';
    return '<article class="card flat form-stack"><div class="section-head">'+
      '<div><strong>'+esc(x.campaignLabel)+'</strong>'+
      '<p class="tiny muted">'+esc(labels[x.benefitKey]||x.benefitKey)+
      ' • '+esc(x.month)+' • '+esc(x.campaignReference)+'</p></div>'+
      '<span class="status-pill">'+(x.status==='allocated'?'Planejado':'Devolvido ao plano')+
      '</span></div><p>Valor: <strong>'+adminMoney(x.amountCents)+'</strong></p>'+
      (canRelease?'<button type="button" class="ghost small" onclick="adminOwnerBudgetReleaseFromUi(\''+
        esc(x.allocationId)+'\','+Number(x.version)+')" '+
        (adminOwnerBudgetPending.has(x.allocationId)?'disabled':'')+
        '>Devolver ao orçamento planejado</button>':'')+
      '</article>';
  }).join('');
  return '<section class="section admin-owner-budget">'+
    '<div class="section-head"><div>'+
    '<span class="section-kicker">CONTROLE DE INCENTIVOS • ORÇAMENTO</span>'+
    '<h3>Distribuição do orçamento por campanha</h3>'+
    '<p>Organize quanto cada campanha poderá consumir do planejamento, com proteção contra valores duplicados e possibilidade de desfazer a distribuição.</p>'+
    '</div><button type="button" class="secondary small" onclick="adminOwnerBudgetLoadFromUi()" '+
    (adminOwnerBudgetBusy?'disabled':'')+'>Consultar distribuição</button></div>'+
    controls+
    (d?'<div class="grid cards-2">'+summaries+'</div>'+
      '<div class="section-head"><h4>Histórico das campanhas planejadas</h4></div>'+
      '<div class="grid cards-2">'+
      (allocations||'<p class="muted">Nenhuma campanha recebeu orçamento planejado.</p>')+
      '</div>':
      '<p class="tiny muted">Consulte para acompanhar os meses atuais e seguintes.</p>')+
    '<p class="tiny muted">Os valores são exclusivamente planejamento. Caixa confirmado, dinheiro disponível para uso e benefícios ativados são zero neste módulo. Conferências bancárias são acompanhadas separadamente.</p>'+
    '</section>';
}

function adminClubeCampaignSection(){
  const role=String(adminCurrentRole());
  if(!['superadmin','operations','compliance','finance','readonly'].includes(role))return '';
  const id=String(adminRuntime?.session?.user?.id||'');
  const d=adminClubeCampaignState?.loadedFor===id?adminClubeCampaignState:null;
  const money=n=>adminMoney(Number(n)||0);
  const statusLabels={under_review:'Em análise',request_documents:'Solicitar documentação',
    economic_prechecked:'Economia pré-analisada (não aprovada)',declined:'Encerrada sem acordo'};
  const canReview=['superadmin','operations','compliance','finance'].includes(role);
  const canEconomic=['superadmin','finance'].includes(role);
  const rows=(d?.rows||[]).map(x=>{
    const key=String(x.merchantId)+'-'+String(x.packageKey);
    const stale=!x.interestActive||(x.reviewVersion>0&&!x.reviewCurrent);
    const stages=[
      ['under_review','Em análise'],['request_documents','Solicitar documentos'],
      ...(canEconomic?[['economic_prechecked','Economia pré-analisada']]:[]),
      ['declined','Encerrar negociação']
    ];
    const controls=canReview&&x.interestActive?'<div class="form-stack">'+
      '<div class="input-wrap"><label for="clube-review-status-'+esc(key)+'">Etapa da negociação</label>'+
      '<select id="clube-review-status-'+esc(key)+'" class="input">'+
      stages.map(v=>'<option value="'+esc(v[0])+'"'+(x.reviewStatus===v[0]?' selected':'')+'>'+esc(v[1])+'</option>').join('')+
      '</select></div>'+
      '<div class="input-wrap"><label for="clube-review-note-'+esc(key)+'">Justificativa interna (12 a 500 caracteres)</label>'+
      '<textarea id="clube-review-note-'+esc(key)+'" class="input" maxlength="500" rows="2" placeholder="Ex.: Confirmar regularidade, custos e minuta contratual.">'+esc(x.reviewNote||'')+'</textarea></div>'+
      '<button type="button" class="secondary small" '+
      (adminClubeCampaignReviewsPending.has(x.merchantId+':'+x.packageKey)?'disabled':'')+
      ' onclick="adminClubeCampaignReviewFromUi(\''+esc(x.merchantId)+'\',\''+esc(x.packageKey)+'\','+
        Number(x.reviewVersion)+','+Number(x.interestVersion)+')">Registrar etapa, sem ativar benefícios</button></div>':
      '<p class="tiny muted">A revisão não pode ser alterada neste perfil ou sem interesse ativo.</p>';
    return '<article class="card flat form-stack">'+
      '<div class="section-head"><div><strong>'+esc(x.companyName)+'</strong>'+
      '<p class="tiny muted">'+esc(x.packageKey==='gas_3x5'?'Clube Gás':'Clube Água')+
      ' • '+esc([x.city,x.state].filter(Boolean).join('/')||'Localidade pendente')+
      '</p></div><span class="status-pill '+(stale?'risk':'online')+'">'+
      (stale?'Interesse retirado ou alterado':esc(statusLabels[x.reviewStatus]||
         (x.interestActive?'Aguardando primeira revisão':'Interesse retirado')))+'</span></div>'+
      '<div class="merchant-kpis">'+
      '<div class="kpi"><span class="label">Orçamento sugerido</span><strong>'+money(x.budgetCents)+'</strong><small>Não comprometido</small></div>'+
      '<div class="kpi"><span class="label">Custo da revenda por uso</span><strong>'+money(x.sponsoredPerCouponCents)+'</strong><small>Hipótese arredondada para cima</small></div>'+
      '<div class="kpi"><span class="label">Usos hipotéticos com esse teto</span><strong>'+
         Number(x.maxCouponUsesIllustrative).toLocaleString('pt-BR')+'</strong><small>Não emitidos</small></div>'+
      '<div class="kpi"><span class="label">Pacotes inteiros hipotéticos</span><strong>'+
         Number(x.maxPackagesIllustrative).toLocaleString('pt-BR')+'</strong><small>Não disponíveis para venda</small></div></div>'+
      controls+'</article>';
  }).join('');
  return '<section class="section admin-clube-campaign">'+
    '<div class="section-head"><div><span class="section-kicker">CLUBE TAMÃO • NEGOCIAÇÕES</span>'+
    '<h3>Central de campanhas patrocinadas</h3>'+
    '<p>Acompanhe conversas, documentação e pré-análise financeira sem transformar intenção em compromisso.</p></div>'+
    '<button type="button" class="secondary small" onclick="adminClubeCampaignLoadFromUi()" '+
      (adminClubeCampaignBusy?'disabled':'')+'>Consultar negociações</button></div>'+
    (d?'<div class="merchant-kpis">'+
      '<div class="kpi"><span class="label">Interesses atuais</span><strong>'+Number(d.activeInterests)+'</strong></div>'+
      '<div class="kpi"><span class="label">Patrocínio comprovado</span><strong>R$ 0</strong></div>'+
      '<div class="kpi"><span class="label">Campanhas ativas</span><strong>0</strong></div></div>'+
      '<div class="grid cards-2" style="margin-top:12px">'+
      (rows||'<p class="muted">Nenhuma negociação registrada.</p>')+'</div>':
      '<p class="muted tiny">Consulte para exibir limites hipotéticos conforme cada proposta. Nenhuma cobrança ou campanha foi aberta.</p>')+
    '<p class="tiny muted">A pré-análise não verifica contrato ou depósito. É proibido publicar, cobrar pacotes ou aplicar descontos com base nesta etapa.</p></section>';
}
function adminAdsDemandSection(){
  if(!['superadmin','operations','compliance','finance','readonly'].includes(String(adminCurrentRole())))
    return '';
  const adminId=String(adminRuntime?.session?.user?.id||'');
  const data=adminAdsDemandState?.loadedFor===adminId?adminAdsDemandState:null;
  const goals={new_customers:'Conquistar clientes',local_visibility:'Visibilidade local',
    new_area:'Novas regiões',unsure:'Conhecer possibilidades'};
  const budgets={unsure:'A definir',upto_99:'Até R$ 99',100_299:'R$ 100–299',
    '300_999':'R$ 300–999','1000_plus':'R$ 1.000 ou mais'};
  const rows=data?.rows?.map(x=>
      '<div class="list-row"><div><strong>'+esc(x.companyName||'Revenda')+
      '</strong><br><small>'+esc([x.city,x.state].filter(Boolean).join('/')||'Cidade não informada')+
      ' • '+esc(goals[x.goal]||'A definir')+' • '+esc(budgets[x.budgetBand]||'A definir')+
      '</small></div><small>'+esc(x.updatedAt?new Date(x.updatedAt).toLocaleDateString('pt-BR'):'')+
      '</small></div>').join('')||'';
  return '<section class="section admin-ads-demand">'+
    '<div class="section-head"><div><span class="section-kicker">TAMÃO NEGÓCIOS • ADS</span>'+
    '<h3>Interesse de revendas em publicidade local</h3>'+
    '<p>Pesquisa voluntária. Nenhuma campanha, cobrança ou receita de anúncios ativada.</p></div>'+
    '<button class="secondary small" onclick="adminAdsDemandLoadFromUi()" '+
    (adminAdsDemandBusy?'disabled':'')+'>Consultar interessados</button></div>'+
    (data?'<div class="merchant-kpis">'+
      '<div class="kpi"><span class="label">Revendas interessadas</span><strong>'+data.totalInterested+'</strong></div>'+
      '<div class="kpi"><span class="label">Atualizações em 30 dias</span><strong>'+data.recent30d+'</strong></div>'+
      '<div class="kpi"><span class="label">Receita de anúncios</span><strong>R$ 0</strong><small>Campanhas pagas não habilitadas</small></div>'+
      '</div><div class="list" style="margin-top:12px">'+
      (rows||'<p class="muted">Ainda não existem revendas interessadas registradas.</p>')+'</div>':
      '<p class="muted tiny">Consulte para descobrir objetivos e investimento potencial por cidade, sem dados pessoais.</p>')+
    '</section>';
}
let adminGrowthReferralReviewQueue=null;
let adminGrowthReferralReviewBusy=false;
async function adminLoadGrowthReferralReviewQueue(){
  if(adminGrowthReferralReviewBusy)return;
  adminGrowthReferralReviewBusy=true;
  try{
    const data=await adminInvoke({action:'growth-referral-review-queue'});
    if(data?.source!=='growth_referral_review_queue_v1_230'||
       data?.readOnly!==true||data?.noPayout!==true||
       data?.rewardEligible!==false||!Array.isArray(data.rows)||data.rows.length>50){
      throw new Error('Resposta da fila de indicações inválida');
    }
    adminGrowthReferralReviewQueue=data;
  }catch(e){
    adminGrowthReferralReviewQueue=null;
    toast(String(e?.message||e));
  }finally{adminGrowthReferralReviewBusy=false;render();}
}
async function adminReviewGrowthReferral(applicationId,decision){
  if(!['superadmin','compliance'].includes(String(adminCurrentRole())))return;
  if(!/^[0-9a-f-]{36}$/i.test(String(applicationId)))return;
  if(!['verified_identity','rejected','needs_evidence'].includes(decision))return;
  const reason=String(document.getElementById('growth-review-note-'+applicationId)?.value||'').trim();
  if(reason.trim().length<12||reason.trim().length>800)return toast('Justificativa deve ter de 12 a 800 caracteres');
  let evidenceReference='';
  const row=adminGrowthReferralReviewQueue?.rows?.find(x=>x.applicationId===applicationId);
  if(!row||['verified_identity','rejected'].includes(row.latestDecision))return toast('A indicação já foi analisada. Atualize a fila.');
  if(decision==='verified_identity'){
    evidenceReference=String(document.getElementById('growth-review-proof-'+applicationId)?.value||'').trim();
    if(evidenceReference.trim().length<8||evidenceReference.trim().length>160)return toast('Informe uma referência de evidência válida');
    if(!row.cnpjMatches||!row.ownerMatches)return toast('Conferência do CNPJ e responsável ainda pendente.');
  }
  if(!confirm('Registrar esta revisão no histórico imutável? Não será concedido benefício financeiro.'))return;
  try{
    await adminPerform('growth-referral-review',{
      applicationId,decision,reason:reason.trim(),evidenceReference:evidenceReference.trim(),
      reviewRequestId:crypto.randomUUID()
    });
    toast('Revisão registrada sem concessão financeira');
    await adminLoadGrowthReferralReviewQueue();
  }catch(e){toast(String(e?.message||e))}
}
function adminGrowthReferralReviewSection(){
  if(!['superadmin','operations','compliance','readonly'].includes(String(adminCurrentRole())))return '';
  const data=adminGrowthReferralReviewQueue;
  let rows='';
  if(data&&Array.isArray(data.rows)){
    rows=data.rows.map(x=>{
      if(!x||!/^[0-9a-f-]{36}$/i.test(String(x.applicationId||'')))return '';
      const label=String(x.companyName||'Empresa').slice(0,120);
      const state=({verified_identity:'Identidade conferida',rejected:'Rejeitada',needs_evidence:'Aguardando evidências'})[x.latestDecision]||'Não analisada';
      const canReview=['superadmin','compliance'].includes(String(adminCurrentRole()));
      const btn=canReview&&!['verified_identity','rejected'].includes(x.latestDecision)?'<div class="order-actions">'+
        '<button class="secondary small" onclick="adminReviewGrowthReferral(\''+x.applicationId+'\',\'needs_evidence\')">Pedir evidências</button>'+
        '<button class="secondary small" onclick="adminReviewGrowthReferral(\''+x.applicationId+'\',\'rejected\')">Rejeitar</button>'+
        '<button class="primary small" onclick="adminReviewGrowthReferral(\''+x.applicationId+'\',\'verified_identity\')">Conferir identidade</button></div>':'';
      const fields=canReview&&!['verified_identity','rejected'].includes(x.latestDecision)?
        '<label>Justificativa da análise<textarea id="growth-review-note-'+x.applicationId+
        '" rows="3" minlength="12" maxlength="800" placeholder="Explique o motivo da decisão"></textarea></label>'+
        '<label>Referência da evidência (sem documentos pessoais)<input id="growth-review-proof-'+x.applicationId+
        '" maxlength="160" placeholder="Protocolo ou referência interna" /></label>':'';
      return '<article class="card flat"><strong>'+esc(label)+'</strong>'+
        '<p class="tiny muted">CNPJ final '+esc(x.cnpjSuffix||'')+
        ' • '+esc(state)+' • '+(x.cnpjMatches?'CNPJ vinculado':'CNPJ pendente')+
        ' • '+(x.ownerMatches?'responsável vinculado':'responsável pendente')+'</p>'+fields+btn+'</article>';
    }).filter(Boolean).join('');
  }
  return '<section class="section admin-growth-referral-review">'+
    '<div class="section-head"><div><span class="section-kicker">CONFORMIDADE • REDE TAMÃO</span>'+
    '<h3>Validação administrativa das indicações</h3>'+
    '<p>Histórico independente do convite. Conferir identidade não libera comissão nem créditos.</p></div>'+
    '<button class="secondary small" onclick="adminLoadGrowthReferralReviewQueue()">Atualizar análises</button></div>'+
    (data?(rows||'<p class="muted">Nenhum cadastro indicado encontrado.</p>'):
      '<p class="muted">Use Atualizar análises para consultar a fila autorizada.</p>')+'</section>';
}

function adminLeadWhatsApp(raw){
  const digits=String(raw||'').replace(/\D/g,'');
  return digits.length===10||digits.length===11?'55'+digits:digits;
}
function adminFirstName(value){
  return String(value||'').trim().split(/\s+/)[0]||'';
}
function adminLeadWhatsAppText(x){
  const first=adminFirstName(x.contact_name);
  const region=x.city&&x.state?x.city+'/'+x.state:'sua região';
  if(x.lead_type==='merchant'){
    const company=String(x.business_name||'sua empresa').trim();
    return 'Olá'+(first?', '+first:'')+'! Aqui é do TAMÃO. Recebemos o interesse da '+company+' em participar como parceiro na região de '+region+'. Quero entender rapidamente sua operação e explicar os próximos passos, sem compromisso. Podemos conversar por aqui?';
  }
  return 'Olá'+(first?', '+first:'')+'! Aqui é do TAMÃO. Você registrou interesse no TAMÃO para '+region+'. Estamos organizando a cobertura local e queremos confirmar seu interesse antes da abertura. Posso te avisar por aqui quando houver novidade para o seu CEP?';
}
function adminPublicRequestWhatsAppText(x){
  const first=adminFirstName(x.contact_name);
  const protocol=String(x.id||'').slice(0,8).toUpperCase();
  const subject=x.request_kind==='privacy'?'sua solicitação de privacidade':'sua mensagem';
  return 'Olá'+(first?', '+first:'')+'! Aqui é do TAMÃO. Recebemos '+subject+' pelo site. Protocolo '+protocol+'. Estou entrando em contato para dar continuidade ao atendimento.';
}
function adminLeadPriority(value){
  return ({new:0,contacted:1,qualified:2,converted:3,closed:4})[value]??9;
}
function adminLeadAgeLabel(createdAt){
  const ms=Date.now()-Date.parse(String(createdAt||''));
  if(!Number.isFinite(ms)||ms<0)return '';
  const hours=Math.floor(ms/3600000);
  if(hours<1)return 'agora';
  if(hours<24)return 'há '+hours+'h';
  const days=Math.floor(hours/24);
  return 'há '+days+'d';
}
function adminLeadInterestLabel(value){
  return ({gas:'Gás',water:'Água',charcoal:'Carvão',firewood:'Lenha',ice:'Gelo',other:'Outros'})[value]||String(value||'');
}
function adminLeadStatusLabel(value){
  return ({new:'NOVO',contacted:'CONTATADO',qualified:'QUALIFICADO',converted:'CONVERTIDO',closed:'ENCERRADO'})[value]||String(value||'').toUpperCase();
}
function adminLeadStatusClass(value){
  return value==='converted'?'online':value==='closed'?'offline':'';
}
function adminLeadActionButtons(x){
  const status=String(x.status||'new');
  if(status==='converted'||status==='closed')return '';
  const buttons=[];
  if(status==='new')buttons.push('<button class="secondary small" onclick="adminSetPrelaunchLeadStatus(\''+x.id+'\',\'contacted\')">Marcar contato</button>');
  if(['new','contacted'].includes(status))buttons.push('<button class="secondary small" onclick="adminSetPrelaunchLeadStatus(\''+x.id+'\',\'qualified\')">Qualificar</button>');
  if(['new','contacted','qualified'].includes(status))buttons.push('<button class="primary small" onclick="adminSetPrelaunchLeadStatus(\''+x.id+'\',\'converted\')">Converter</button>');
  buttons.push('<button class="ghost small" onclick="adminSetPrelaunchLeadStatus(\''+x.id+'\',\'closed\')">Encerrar</button>');
  return '<div class="order-actions pipeline-actions">'+buttons.join('')+'</div>';
}
async function adminSetPrelaunchLeadStatus(leadId,status){
  const labels={contacted:'contatado',qualified:'qualificado',converted:'convertido',closed:'encerrado'};
  let note='';
  if(status==='closed'){
    note=prompt('Motivo do encerramento:')||'';
    if(note.trim().length<3)return toast('Informe o motivo do encerramento');
  }else{
    note=prompt('Observação desta etapa (opcional):')||'';
  }
  if(!confirm('Marcar este lead como '+(labels[status]||status)+'?'))return;
  try{
    await adminPerform('lead-status',{leadId,status,note});
    toast('Lead atualizado');
  }catch(e){toast(String(e?.message||e))}
}
function adminPublicRequestStatusLabel(value){
  return ({new:'NOVA',in_review:'EM ANÁLISE',resolved:'RESOLVIDA',closed:'ENCERRADA'})[value]||String(value||'').toUpperCase();
}
function adminPublicRequestActionButtons(x){
  const status=String(x.status||'new');
  if(status==='closed')return '';
  const buttons=[];
  if(status==='new')buttons.push('<button class="secondary small" onclick="adminSetPublicRequestStatus(\''+x.id+'\',\'in_review\')">Em análise</button>');
  if(['new','in_review'].includes(status))buttons.push('<button class="primary small" onclick="adminSetPublicRequestStatus(\''+x.id+'\',\'resolved\')">Resolver</button>');
  if(['new','in_review','resolved'].includes(status))buttons.push('<button class="ghost small" onclick="adminSetPublicRequestStatus(\''+x.id+'\',\'closed\')">Encerrar</button>');
  return '<div class="order-actions pipeline-actions">'+buttons.join('')+'</div>';
}
async function adminSetPublicRequestStatus(requestId,status){
  let resolutionNote='';
  if(['resolved','closed'].includes(status)){
    resolutionNote=prompt(status==='resolved'?'Como esta solicitação foi resolvida?':'Motivo do encerramento:')||'';
    if(resolutionNote.trim().length<3)return toast('Documente como a solicitação foi tratada');
  }
  if(!confirm(status==='in_review'?'Colocar esta solicitação em análise?':status==='resolved'?'Marcar esta solicitação como resolvida?':'Encerrar esta solicitação?'))return;
  try{
    await adminPerform('public-request-status',{requestId,status,resolutionNote});
    toast(status==='in_review'?'Solicitação em análise':status==='resolved'?'Solicitação resolvida':'Solicitação encerrada');
  }catch(e){toast(String(e?.message||e))}
}
function adminPrelaunchLeadCard(x){
  const merchant=x.lead_type==='merchant';
  const type=merchant?'PARCEIRO':'CLIENTE';
  const title=merchant?(x.business_name||x.contact_name||'Empresa'):(x.contact_name||'Novo interessado');
  const interests=(x.interests||[]).map(adminLeadInterestLabel).join(' • ')||'—';
  const source=[x.source,x.medium,x.campaign].filter(Boolean).join(' / ')||'acesso direto';
  const wa=adminLeadWhatsApp(x.phone);
  const waText=encodeURIComponent(adminLeadWhatsAppText(x));
  return [
    '<article class="card flat">',
      '<div class="status-bar"><div><span class="status-pill '+(merchant?'online':'')+'">'+type+'</span> <span class="status-pill '+adminLeadStatusClass(x.status)+'">'+esc(adminLeadStatusLabel(x.status))+'</span>',
      '<h3 style="margin:8px 0 3px">'+esc(title)+'</h3>',
      '<div class="tiny muted">'+esc(x.contact_name||'')+(x.postal_code?' • CEP '+esc(x.postal_code):'')+'</div></div>',
      '<small>'+new Date(x.created_at).toLocaleString('pt-BR')+'</small></div>',
      '<div class="list-row"><span>Interesses</span><strong>'+esc(interests)+'</strong></div>',
      '<div class="list-row"><span>Origem</span><strong>'+esc(source)+'</strong></div>',
      x.note?'<p class="muted tiny"><strong>Mensagem:</strong> '+esc(x.note)+'</p>':'',
      x.admin_note?'<p class="muted tiny"><strong>Nota interna:</strong> '+esc(x.admin_note)+'</p>':'',
      '<div class="order-actions"><a class="secondary small" href="https://wa.me/'+esc(wa)+'?text='+waText+'" target="_blank" rel="noopener noreferrer">Abrir WhatsApp com mensagem</a><span class="tiny muted">'+esc(adminLeadAgeLabel(x.created_at))+' • envios: '+Number(x.submission_count||1)+'</span></div>',
      adminLeadActionButtons(x),
    '</article>'
  ].join('');
}
function adminLeadCampaignRows(leads){
  const groups=new Map();
  for(const x of leads){
    const source=String(x.source||'direto');
    const medium=String(x.medium||'sem_medium');
    const campaign=String(x.campaign||'sem_campanha');
    const key=source+'|'+medium+'|'+campaign;
    const row=groups.get(key)||{source,medium,campaign,customers:0,merchants:0,total:0,contacted:0,qualified:0,converted:0};
    row.total++;
    if(x.lead_type==='merchant')row.merchants++;else row.customers++;
    if(x.contacted_at)row.contacted++;
    if(x.qualified_at)row.qualified++;
    if(x.converted_at)row.converted++;
    groups.set(key,row);
  }
  return [...groups.values()].map(row=>({
    ...row,
    contactRatePct:row.total?100*row.contacted/row.total:0,
    qualificationRatePct:row.total?100*row.qualified/row.total:0,
    conversionRatePct:row.total?100*row.converted/row.total:0
  })).sort((a,b)=>b.total-a.total||b.converted-a.converted||a.source.localeCompare(b.source)).slice(0,8);
}
function adminMetricPercent(value){
  const n=Number(value);
  return Number.isFinite(n)?n.toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:1})+'%':'—';
}
function adminMetricDuration(value){
  const n=Number(value);
  if(!Number.isFinite(n)||n<0)return '—';
  if(n<60)return Math.round(n)+' min';
  if(n<1440)return (n/60).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+' h';
  return (n/1440).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+' d';
}
function adminAcquisitionMetrics(data,leads){
  const server=data?.acquisitionMetrics;
  if(server&&typeof server==='object'&&Number.isFinite(Number(server.total))){
    return {...server,campaigns:Array.isArray(server.campaigns)?server.campaigns:[]};
  }
  const total=leads.length;
  const contacted=leads.filter(x=>x.contacted_at).length;
  const qualified=leads.filter(x=>x.qualified_at).length;
  const converted=leads.filter(x=>x.converted_at).length;
  return {
    landingViews:0,
    formViews:0,
    landingToFormPct:0,
    landingToLeadPct:0,
    formToLeadPct:0,
    total,
    customers:leads.filter(x=>x.lead_type==='customer').length,
    merchants:leads.filter(x=>x.lead_type==='merchant').length,
    new:leads.filter(x=>x.status==='new').length,
    contacted,
    qualified,
    converted,
    closed:leads.filter(x=>x.status==='closed').length,
    staleNew24h:leads.filter(x=>x.status==='new'&&(Date.now()-Date.parse(String(x.created_at||'')))>=24*60*60*1000).length,
    last7d:leads.filter(x=>(Date.now()-Date.parse(String(x.created_at||'')))<=7*24*60*60*1000).length,
    last30d:leads.filter(x=>(Date.now()-Date.parse(String(x.created_at||'')))<=30*24*60*60*1000).length,
    contactRatePct:total?100*contacted/total:0,
    qualificationRatePct:total?100*qualified/total:0,
    conversionRatePct:total?100*converted/total:0,
    qualifiedToConvertedPct:qualified?100*converted/qualified:0,
    avgFirstContactMinutes:null,
    medianFirstContactMinutes:null,
    campaigns:adminLeadCampaignRows(leads)
  };
}
function adminAcquisitionCampaigns(metrics){
  const rows=Array.isArray(metrics?.campaigns)?metrics.campaigns:[];
  if(!rows.length)return '';
  return '<div class="card flat acquisition-campaigns"><div class="status-bar"><div><span class="section-kicker">ATRIBUIÇÃO FIRST-PARTY</span><h3 style="margin:5px 0 0">Campanhas: entrada até conversão</h3></div><small>contadores agregados + leads reais</small></div><div class="acquisition-campaign-list">'+rows.slice(0,16).map(x=>{
    const origin=[x.source,x.medium].filter(Boolean).join(' / ');
    const audience=x.audience==='merchant'?'PARCEIRO':'CLIENTE';
    const creative=x.content&&x.content!=='sem_conteudo'?' • '+esc(x.content):'';
    return '<div class="acquisition-campaign-row"><div><span class="status-pill">'+audience+'</span><strong>'+esc(origin||'direto')+'</strong><small>'+esc(x.campaign||'sem_campanha')+creative+' • '+Number(x.landingViews||0)+' entrada(s) • '+Number(x.formViews||0)+' formulário(s) • '+Number(x.total||0)+' lead(s)</small></div><div class="campaign-rates"><span><small>Entrada → form.</small><strong>'+adminMetricPercent(x.landingToFormPct)+'</strong></span><span><small>Entrada → lead</small><strong>'+adminMetricPercent(x.landingToLeadPct)+'</strong></span><span><small>Qualificação</small><strong>'+adminMetricPercent(x.qualificationRatePct)+'</strong></span><span><small>Conversão</small><strong>'+adminMetricPercent(x.conversionRatePct)+'</strong></span></div></div>';
  }).join('')+'</div></div>';
}
function adminGrowthNetworkOverviewView(raw){
  if(!raw||raw.available!==true)return '';
  const counts=['attributedLeads','customerInvitedLeads','merchantInvitedLeads',
    'customerInterests','merchantInterests','crmConvertedLeads','last30d',
    'merchantsWithInviteCode'];
  const verified=raw.valid===true&&raw.source==='growth_network_server_v1_227'&&
    raw.readOnly===true&&raw.noPayout===true&&raw.noPersonalData===true&&
    raw.leadScope==='consented_prelaunch_leads_only'&&
    raw.crmConversionIsNotOrderSettlement===true&&
    counts.every(k=>Number.isSafeInteger(raw[k])&&raw[k]>=0)&&
    Array.isArray(raw.merchantBreakdown)&&raw.merchantBreakdown.length<=12&&
    raw.customerInvitedLeads+raw.merchantInvitedLeads===raw.attributedLeads&&
    raw.customerInterests+raw.merchantInterests===raw.attributedLeads;
  if(!verified)return '<section class="section"><div class="notice danger">Atribuição da Rede TAMÃO indisponível ou inconsistente. Nenhum indicador foi validado.</div></section>';
  const rows=raw.merchantBreakdown.map(r=>{
    const name=String(r?.name||'').trim();
    const customer=Number(r?.customerInterests),merchant=Number(r?.merchantInterests),
      crm=Number(r?.crmConvertedLeads);
    if(!name||name.length>160||![customer,merchant,crm].every(n=>
      Number.isSafeInteger(n)&&n>=0))return '';
    return '<div class="list-row"><div><strong>'+esc(name)+'</strong>'+
      '<br><small>'+customer+' cliente(s) interessado(s) • '+
      merchant+' empresa(s) interessada(s) • '+crm+
      ' marcado(s) como convertido(s) no CRM</small></div></div>';
  }).filter(Boolean).join('');
  return '<section class="section admin-growth-network-overview">'+
    '<div class="section-head"><div><span class="section-kicker">REDE TAMÃO</span>'+
    '<h3>Indicações que chegaram ao funil</h3>'+
    '<p>Cadastros consentidos e atribuídos no servidor. Números de interesse não são vendas.</p></div>'+
    '<span class="status-pill">'+raw.attributedLeads+' atribuição(ões)</span></div>'+
    '<div class="merchant-kpis">'+
      '<div class="kpi"><span class="label">Novos contatos indicados</span><strong>'+raw.attributedLeads+'</strong></div>'+
      '<div class="kpi"><span class="label">Origem: clientes</span><strong>'+raw.customerInvitedLeads+'</strong></div>'+
      '<div class="kpi"><span class="label">Origem: revendas</span><strong>'+raw.merchantInvitedLeads+'</strong></div>'+
      '<div class="kpi"><span class="label">Empresas interessadas</span><strong>'+raw.merchantInterests+'</strong></div>'+
      '<div class="kpi"><span class="label">Marcados como convertidos no CRM</span><strong>'+raw.crmConvertedLeads+'</strong></div>'+
      '<div class="kpi"><span class="label">Revendas com código de convite</span><strong>'+raw.merchantsWithInviteCode+'</strong></div>'+
    '</div>'+
    (rows?'<div class="card flat"><h4>Revendas que trouxeram interessados</h4>'+
      '<div class="list">'+rows+'</div></div>':'')+
    '<p class="tiny muted">Métrica de pré-cadastro: não representa ativação de revenda, primeira compra, liquidação financeira ou recompensa. Sem créditos de indicação de revendas habilitados.</p>'+
    '</section>';
}
function adminGrowthApplicationFunnelView(raw){
  if(!raw||raw.available!==true)return '';
  const counters=['applicationsAttributed','contactCandidatesUnverified',
    'applicationsApproved','approvedCnpjOwnerMatches','activeMatchedMerchants',
    'invitedByMerchants','invitedByCustomers'];
  const valid=raw.valid===true&&raw.source==='growth_cnpj_application_funnel_v1_229'&&
    raw.readOnly===true&&raw.noPayout===true&&
    raw.noPersonalContactData===true&&
    raw.attributionNeverFinancialProof===true&&raw.firstLevelOnly===true&&
    counters.every(k=>Number.isSafeInteger(raw[k])&&raw[k]>=0)&&
    raw.invitedByMerchants+raw.invitedByCustomers===raw.applicationsAttributed&&
    raw.approvedCnpjOwnerMatches<=raw.applicationsApproved&&
    raw.activeMatchedMerchants<=raw.approvedCnpjOwnerMatches&&
    raw.contactCandidatesUnverified<=raw.applicationsAttributed&&
    Array.isArray(raw.rows)&&raw.rows.length<=12;
  if(!valid)return '<section class="section"><div class="notice danger">Vínculos de CNPJ indicados não puderam ser comprovados. Nenhum resultado foi considerado válido.</div></section>';
  const statusNames={pending:'Cadastro em análise',approved:'Cadastro aprovado',rejected:'Revisão necessária'};
  const rows=raw.rows.map(row=>{
    if(!row||!['merchant','customer'].includes(row.inviterKind)||
      !Object.hasOwn(statusNames,String(row.applicationStatus))||
      typeof row.companyName!=='string'||row.companyName.length<2||
      row.companyName.length>120||
      !/^[0-9A-Z]{4}$/.test(String(row.cnpjSuffix||''))||
      typeof row.merchantLinked!=='boolean'||
      typeof row.activeMerchant!=='boolean'||
      typeof row.leadCandidate!=='boolean'||
      row.verified!==false||row.rewardEligible!==false)return '';
    const stage=row.activeMerchant?'Empresa ativa com CNPJ/vínculo correspondente':
      row.merchantLinked?'Cadastro aprovado e revenda vinculada':
      statusNames[row.applicationStatus];
    return '<div class="list-row"><div><strong>'+esc(row.companyName)+'</strong>'+
      '<br><small>CNPJ final ••••'+esc(row.cnpjSuffix)+' • indicação de '+
      (row.inviterKind==='merchant'?'revenda':'cliente')+' • '+esc(stage)+'</small>'+
      '<br><small>'+ (row.leadCandidate
        ?'Contato anterior compatível: vínculo ainda não verificado'
        :'Sem vínculo anterior de lead comprovado')+'</small></div></div>';
  }).filter(Boolean).join('');
  return '<section class="section admin-growth-cnpj-funnel">'+
    '<div class="section-head"><div><span class="section-kicker">REDE TAMÃO • CNPJ</span>'+
    '<h3>Convite até cadastro de revenda</h3>'+
    '<p>Ligação entre o convite e a solicitação autenticada da empresa, sem atribuir pagamentos.</p></div></div>'+
    '<div class="merchant-kpis">'+
      '<div class="kpi"><span class="label">Empresas com convite registrado</span><strong>'+raw.applicationsAttributed+'</strong></div>'+
      '<div class="kpi"><span class="label">Indicações por revendas</span><strong>'+raw.invitedByMerchants+'</strong></div>'+
      '<div class="kpi"><span class="label">Indicações por clientes</span><strong>'+raw.invitedByCustomers+'</strong></div>'+
      '<div class="kpi"><span class="label">Cadastros aprovados</span><strong>'+raw.applicationsApproved+'</strong></div>'+
      '<div class="kpi"><span class="label">CNPJ e proprietário relacionados</span><strong>'+raw.approvedCnpjOwnerMatches+'</strong></div>'+
      '<div class="kpi"><span class="label">Revendas ativas relacionadas</span><strong>'+raw.activeMatchedMerchants+'</strong></div>'+
    '</div>'+
    (rows?'<div class="card flat"><h4>Últimas solicitações indicadas</h4>'+
      '<div class="list">'+rows+'</div></div>':'')+
    '<p class="tiny muted">Correspondência de telefone é apenas um indício não verificado. Aprovação, CNPJ e vínculo de proprietário não comprovam receita do TAMÃO. Nenhuma comissão de revenda é liberada nesta etapa.</p>'+
    '</section>';
}
// TAMÃO V1.249 — founder finance center: one read-only overview and focused workspaces.
// Uses the existing authenticated RPC actions, without enabling spending or payments.
let adminOwnerFinanceTab='overview';
let adminOwnerFinanceLoading=false;
let adminOwnerFinanceLoadedFor='';
let adminOwnerFinanceLoadedAt='';
let adminOwnerFinanceError='';
async function adminOwnerFinanceLoadFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  const role=String(adminCurrentRole());
  if(!actor||!['superadmin','finance'].includes(role)||adminOwnerFinanceLoading)return;
  adminOwnerFinanceLoading=true;
  adminOwnerFinanceError='';
  render();
  try{
    const [plan,pulse,evidence,budget]=await Promise.all([
      adminInvoke({action:'owner-funding-read'}),
      adminInvoke({action:'owner-funding-pulse'}),
      adminInvoke({action:'owner-evidence-queue'}),
      adminInvoke({action:'owner-budget-queue'})
    ]);
    if(plan?.source!=='admin_owner_funding_read_v1_244'||
       plan?.fundingSource!=='platform_owner'||plan?.readOnly!==true||
       plan?.newBenefitsEnabled!==false||plan?.noCharge!==true||
       plan?.verifiedDepositCents!==0||plan?.moneyReservedCents!==0||
       !Array.isArray(plan.rows)||plan.rows.length!==4||
       new Set(plan.rows.map(x=>x.benefitKey)).size!==4||
       plan.rows.some(x=>!Number.isSafeInteger(x.budgetCents)||x.budgetCents<0))
      throw new Error('Planejamento do fundador não validado.');
    if(pulse?.source!=='admin_owner_funding_pulse_v1_245'||
       pulse?.readOnly!==true||pulse?.noCharge!==true||
       pulse?.timezone!=='America/Sao_Paulo'||
       pulse?.metricMeaning!=='grants_created_this_month_not_bank_spending'||
       pulse?.budgetMeaning!=='owner_plan_not_funds_deposited'||
       pulse?.verifiedDepositCents!==0||pulse?.moneyReservedCents!==0||
       pulse?.newBenefitsActivated!==false||pulse?.payoutsMeasured!==false||
       !/^\d{4}-\d{2}-01$/.test(String(pulse.monthStart||''))||
       !Array.isArray(pulse.rows)||pulse.rows.length!==4||
       new Set(pulse.rows.map(x=>x.benefitKey)).size!==4||
       pulse.rows.some(x=>!Number.isSafeInteger(x.netGrantedCents)||x.netGrantedCents<0))
      throw new Error('Concessões do mês não validadas.');
    if(evidence?.source!=='admin_owner_evidence_queue_v1_246'||
       evidence?.readOnly!==true||evidence?.bankApiConfirmed!==false||
       evidence?.fundsSpendable!==false||evidence?.spendableCents!==0||
       evidence?.newBenefitsEnabled!==false||evidence?.cashMoved!==false||
       !Array.isArray(evidence.rows)||evidence.rows.length>50||
       !Number.isSafeInteger(evidence.total)||evidence.total<0||
       !Number.isSafeInteger(evidence.pendingCount)||evidence.pendingCount<0||
       !Number.isSafeInteger(evidence.manualReconciledCents)||
       evidence.manualReconciledCents<0)
      throw new Error('Aportes não validados.');
    if(budget?.source!=='admin_owner_budget_queue_v1_247'||
       budget?.readOnly!==true||budget?.plannedOnly!==true||
       budget?.noCharge!==true||budget?.verifiedCashCents!==0||
       budget?.spendableCents!==0||budget?.newBenefitsEnabled!==false||
       !Array.isArray(budget.rows)||budget.rows.length!==12||
       !Array.isArray(budget.allocations)||budget.allocations.length>50||
       budget.rows.filter(x=>x.month===pulse.monthStart).length!==4||
       budget.rows.some(x=>!Number.isSafeInteger(x.allocatedCents)||x.allocatedCents<0||
         !Number.isSafeInteger(x.plannedCents)||x.plannedCents<0||
         !Number.isSafeInteger(x.unallocatedCents)||x.unallocatedCents<0||
         x.allocatedCents+x.unallocatedCents!==x.plannedCents))
      throw new Error('Distribuição mensal não validada.');
    if(actor===String(adminRuntime?.session?.user?.id||'')&&
       role===String(adminCurrentRole())){
      adminOwnerFundingState={...plan,loadedFor:actor};
      adminOwnerFundingPulseState={...pulse,loadedFor:actor};
      adminOwnerEvidenceState={...evidence,loadedFor:actor};
      adminOwnerBudgetState={...budget,loadedFor:actor};
      adminOwnerFinanceLoadedFor=actor;
      adminOwnerFinanceLoadedAt=new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
    }
  }catch(error){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerFinanceError=String(error?.message||'Falha ao consultar central financeira.');
      adminOwnerFinanceLoadedFor='';
      // A failed aggregate refresh must not leave editable forms backed by stale snapshots.
      adminOwnerFundingState=null;
      adminOwnerFundingPulseState=null;
      adminOwnerEvidenceState=null;
      adminOwnerBudgetState=null;
      adminOwnerFinanceHistoryState=null;
      adminOwnerCampaignSignalsState=null;
      adminOwnerCampaignOrdersState=null;
      adminOwnerCampaignFeeReceiptsState=null;
      adminOwnerBatchLedgerState=null;
      adminCampaignCostsState=null;
      adminOwnerBridgeState=null;
      adminOwnerOrphanAuditState=null;
      adminOwnerOrphanCleanupState=null;
      toast(adminOwnerFinanceError);
    }
  }finally{adminOwnerFinanceLoading=false;render();}
}
function adminOwnerFinanceSelectFromUi(tab){
  if(!['overview','plan','evidence','campaigns','history','signals'].includes(tab)||
     !['superadmin','finance'].includes(String(adminCurrentRole())))return;
  adminOwnerFinanceTab=tab;
  render();
}
// TAMÃO V1.250 — history is sourced from actual immutable contribution/allocation events.
let adminOwnerFinanceHistoryState=null;
let adminOwnerFinanceHistoryBusy=false;
let adminOwnerFinanceHistoryFilters={month:'',benefitKey:'',kind:'all',eventType:'all'};
async function adminOwnerFinanceHistoryLoadFromUi(offset=0){
  const actor=String(adminRuntime?.session?.user?.id||'');
  const role=String(adminCurrentRole());
  if(!actor||!['superadmin','finance'].includes(role)||adminOwnerFinanceHistoryBusy||
     !Number.isSafeInteger(offset)||offset<0||offset>10000||offset%20!==0)return;
  const value=id=>String(document.getElementById('owner-history-'+id)?.value||'').trim();
  const filters=offset===0?{
    month:value('month'),benefitKey:value('benefit'),kind:value('kind')||'all',
    eventType:value('event')||'all'
  }:{...adminOwnerFinanceHistoryFilters};
  if((filters.month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(filters.month))||
     (filters.benefitKey&&!['customer_cashback','customer_referral','merchant_referral','clube_coupons'].includes(filters.benefitKey))||
     !['all','contribution','campaign'].includes(filters.kind)||
     !['all','contribution_submitted','contribution_manual_reconciled',
       'contribution_rejected','contribution_disputed','campaign_allocated','campaign_released'].includes(filters.eventType))
    return toast('Revise os filtros do histórico financeiro.');
  adminOwnerFinanceHistoryBusy=true;
  render();
  try{
    const d=await adminInvoke({action:'owner-finance-history',
       month:filters.month?filters.month+'-01':'',
       benefitKey:filters.benefitKey,kind:filters.kind,
       eventType:filters.eventType,offset});
    if(d?.source!=='admin_owner_finance_history_v1_250'||
       d?.readOnly!==true||d?.bankApiConfirmed!==false||
       d?.fundsSpendable!==false||d?.spendableCents!==0||
       d?.cashMoved!==false||d?.newBenefitsEnabled!==false||
       d?.month!==(filters.month?filters.month+'-01':null)||
       d?.benefitKey!==(filters.benefitKey||null)||
       d?.kind!==filters.kind||d?.eventType!==filters.eventType||
       d?.offset!==offset||d?.pageSize!==20||
       !Array.isArray(d.rows)||d.rows.length>20||
       !Number.isSafeInteger(d.total)||d.total<0||
       d.rows.length>Math.max(0,d.total-offset))
      throw new Error('Consulta histórica não verificada.');
    if(actor===String(adminRuntime?.session?.user?.id||'')&&
       role===String(adminCurrentRole())){
      adminOwnerFinanceHistoryFilters=filters;
      adminOwnerFinanceHistoryState={...d,loadedFor:actor};
    }
  }catch(error){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerFinanceHistoryState=null;
      toast(String(error?.message||'Falha ao consultar histórico financeiro.'));
    }
  }finally{adminOwnerFinanceHistoryBusy=false;render();}
}
function adminOwnerFinanceHistorySection(){
  const role=String(adminCurrentRole());
  if(!['superadmin','finance'].includes(role))return '';
  const actor=String(adminRuntime?.session?.user?.id||'');
  const d=adminOwnerFinanceHistoryState?.loadedFor===actor?adminOwnerFinanceHistoryState:null;
  const f=adminOwnerFinanceHistoryFilters;
  const selected=(a,b)=>a===b?' selected':'';
  const benefits={
    customer_cashback:'Cashback',customer_referral:'Indicações de clientes',
    merchant_referral:'Indicações de revendas',clube_coupons:'Clube TAMÃO'
  };
  const eventLabels={
    contribution_submitted:'Aporte declarado',
    contribution_manual_reconciled:'Conferência manual registrada',
    contribution_rejected:'Aporte recusado',
    contribution_disputed:'Aporte contestado',
    campaign_allocated:'Orçamento separado para campanha',
    campaign_released:'Orçamento devolvido ao planejamento'
  };
  const monthOptions='<option value="">Todos os meses</option>'+
    Array.from({length:18},(_,i)=>{
      const base=new Date();
      const dt=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth()-i,1));
      const k=dt.toISOString().slice(0,7);
      return '<option value="'+k+'"'+selected(f.month,k)+'>'+k+'</option>';
    }).join('');
  const form='<div class="card flat form-stack">'+
    '<div class="grid cards-2">'+
    '<label class="input-wrap">Mês da decisão<select id="owner-history-month" class="input">'+monthOptions+'</select></label>'+
    '<label class="input-wrap">Centro de incentivo<select id="owner-history-benefit" class="input">'+
    '<option value="">Todos</option>'+
    Object.entries(benefits).map(([k,v])=>'<option value="'+k+'"'+selected(f.benefitKey,k)+'>'+esc(v)+'</option>').join('')+
    '</select></label>'+
    '<label class="input-wrap">Origem<select id="owner-history-kind" class="input">'+
    [['all','Aportes e campanhas'],['contribution','Aportes'],['campaign','Campanhas']].map(([k,v])=>
      '<option value="'+k+'"'+selected(f.kind,k)+'>'+v+'</option>').join('')+'</select></label>'+
    '<label class="input-wrap">Decisão<select id="owner-history-event" class="input">'+
    '<option value="all"'+selected(f.eventType,'all')+'>Todas as decisões</option>'+
    Object.entries(eventLabels).map(([k,v])=>'<option value="'+k+'"'+selected(f.eventType,k)+'>'+esc(v)+'</option>').join('')+
    '</select></label></div>'+
    '<button type="button" class="secondary small" onclick="adminOwnerFinanceHistoryLoadFromUi(0)" '+
    (adminOwnerFinanceHistoryBusy?'disabled':'')+'>Pesquisar histórico</button></div>';
  const rows=(d?.rows||[]).map(x=>{
    const status=eventLabels[x.eventType]||x.eventType;
    const note=String(x.note||'');
    const actorLabel=String(x.actorId||'');
    const dt=Date.parse(String(x.createdAt||''));
    const date=Number.isFinite(dt)?new Date(dt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Data não confirmada';
    return '<article class="card flat form-stack">'+
      '<div class="section-head"><div><strong>'+esc(status)+'</strong>'+
      '<p class="tiny muted">'+esc(benefits[x.benefitKey]||x.benefitKey)+
      ' • '+esc(date)+' (São Paulo)</p></div><span class="status-pill">'+
      esc(x.kind==='campaign'?'Campanha':'Aporte')+'</span></div>'+
      '<p>Valor do registro: <strong>'+adminMoney(x.amountCents)+'</strong></p>'+
      (x.campaignLabel?'<p>'+esc(x.campaignLabel)+
        (x.campaignMonth?' • Competência '+esc(x.campaignMonth):'')+'</p>':'')+
      (note?'<p class="tiny muted">Justificativa: '+esc(note)+'</p>':'')+
      '<p class="tiny muted">Responsável: <span title="'+esc(actorLabel)+'">'+
      esc(actorLabel.slice(0,8))+'</span> • Versão '+Number(x.fromVersion)+
      ' → '+Number(x.toVersion)+'</p></article>';
  }).join('');
  const page=d?'<div class="section-head"><p class="tiny muted">'+
    Number(d.total).toLocaleString('pt-BR')+' evento(s) encontrados • exibindo '+
    (d.total?d.offset+1:0)+' a '+Math.min(d.total,d.offset+d.rows.length)+
    ' (20 por página)</p><div class="row">'+
    '<button type="button" class="secondary small" onclick="adminOwnerFinanceHistoryLoadFromUi('+
    Math.max(0,d.offset-20)+')" '+(adminOwnerFinanceHistoryBusy||d.offset===0?'disabled':'')+'>Anterior</button>'+
    '<button type="button" class="secondary small" onclick="adminOwnerFinanceHistoryLoadFromUi('+
    (d.offset+20)+')" '+(adminOwnerFinanceHistoryBusy||d.offset+20>=d.total||d.offset+20>10000?'disabled':'')+
    '>Próxima</button></div></div>':'';
  return '<div class="form-stack"><div class="section-head"><div>'+
    '<h4>Histórico de decisões financeiras</h4>'+
    '<p>Consulte as decisões registradas, quem as realizou e quais valores foram organizados em cada campanha.</p>'+
    '</div></div>'+form+
    (d?'<div class="grid cards-2">'+(rows||'<p class="muted">Nenhum evento para os filtros escolhidos.</p>')+
      '</div>'+page:'<p class="tiny muted">Use os filtros para consultar o histórico completo, página por página.</p>')+
    '<p class="tiny muted">Este histórico mostra eventos de aportes e campanhas, não pagamentos, faturamento, lucro ou retorno sobre investimento. A conferência manual não valida saldo bancário por API.</p></div>';
}

// TAMÃO V1.251 — campaign-specific acquisition signals, never financial ROI.
let adminOwnerCampaignSignalsState=null;
let adminOwnerCampaignSignalsBusy=false;
let adminOwnerCampaignSignalsMonth='';
async function adminOwnerCampaignSignalsLoadFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  const role=String(adminCurrentRole());
  if(!actor||!['superadmin','finance'].includes(role)||adminOwnerCampaignSignalsBusy)return;
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return toast('Selecione uma competência mensal válida.');
  adminOwnerCampaignSignalsBusy=true;
  render();
  try{
    const result=await adminInvoke({action:'owner-campaign-signals',month:month?month+'-01':''});
    const allowed=['customer_cashback','customer_referral','merchant_referral','clube_coupons'];
    if(result?.source!=='admin_owner_campaign_signals_v1_251'||
       result?.readOnly!==true||result?.plannedOnly!==true||
       result?.noCharge!==true||result?.spendableCents!==0||
       result?.bankApiConfirmed!==false||result?.newBenefitsEnabled!==false||
       result?.returnOnInvestmentMeasured!==false||result?.revenueAttributedCents!==null||
       result?.measurementUnit!=='first_party_event_counts_not_unique_people'||
       !/^\d{4}-\d{2}-01$/.test(String(result?.month||''))||
       (month&&result.month!==month+'-01')||
       result?.limit!==50||!Number.isSafeInteger(result.totalCampaigns)||
       result.totalCampaigns<0||typeof result.truncated!=='boolean'||
       result.truncated!==(result.totalCampaigns>50)||
       !Number.isSafeInteger(result.unattributedLandingViews)||
       result.unattributedLandingViews<0||
       !Number.isSafeInteger(result.unattributedFormViews)||
       result.unattributedFormViews<0||
       !Array.isArray(result.rows)||result.rows.length>50||
       result.rows.length>result.totalCampaigns||
       result.rows.some(x=>!allowed.includes(x.benefitKey)||
         !/^[a-z0-9_-]{8,80}$/.test(String(x.campaignReference||''))||
         x.month!==result.month||
         x.campaignTag!=='tam-'+x.benefitKey+'-'+x.month.slice(0,4)+x.month.slice(5,7)+'-'+x.campaignReference||
         !['allocated','released'].includes(x.status)||
         !Number.isSafeInteger(x.plannedAllocationCents)||x.plannedAllocationCents<100||
         !['landingViews','formViews','leads','customerLeads','merchantLeads',
           'qualifiedLeads','crmConvertedLeads'].every(k=>Number.isSafeInteger(x[k])&&x[k]>=0)||
         x.customerLeads+x.merchantLeads!==x.leads||
         x.returnOnInvestmentMeasured!==false||x.revenueAttributedCents!==null))
      throw new Error('Sinais de campanha não verificados.');
    if(actor===String(adminRuntime?.session?.user?.id||'')&&
       role===String(adminCurrentRole())){
      adminOwnerCampaignSignalsState={...result,loadedFor:actor};
      adminOwnerCampaignSignalsMonth=result.month.slice(0,7);
    }
  }catch(error){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerCampaignSignalsState=null;
      toast(String(error?.message||'Falha na leitura dos resultados.'));
    }
  }finally{adminOwnerCampaignSignalsBusy=false;render();}
}
function adminOwnerCampaignSignalsLink(tag){
  if(!/^tam-(?:customer_cashback|customer_referral|merchant_referral|clube_coupons)-\d{6}-[a-z0-9_-]{8,80}$/.test(tag))
    return '';
  return 'https://tamao.com.br/?utm_source=tamao&utm_medium=owner_campaign&utm_campaign='+
    encodeURIComponent(tag)+'#home';
}
async function adminOwnerCampaignSignalsCopyFromUi(tag){
  const actor=String(adminRuntime?.session?.user?.id||'');
  if(!actor||!['superadmin','finance'].includes(String(adminCurrentRole())))return;
  const d=adminOwnerCampaignSignalsState?.loadedFor===actor?adminOwnerCampaignSignalsState:null;
  if(!d?.rows?.some(x=>x.campaignTag===tag&&x.status==='allocated'))return;
  const url=adminOwnerCampaignSignalsLink(tag);
  if(!url)return;
  try{
    await navigator.clipboard.writeText(url);
    toast('Link identificado copiado. Divulgue-o para começar a acompanhar as interações.');
  }catch{
    window.prompt('Copie o link identificado da campanha:',url);
  }
}
function adminOwnerCampaignSignalsSection(){
  if(!['superadmin','finance'].includes(String(adminCurrentRole())))return '';
  const actor=String(adminRuntime?.session?.user?.id||'');
  const d=adminOwnerCampaignSignalsState?.loadedFor===actor?adminOwnerCampaignSignalsState:null;
  const labels={
    customer_cashback:'Cashback',customer_referral:'Indicação de clientes',
    merchant_referral:'Indicação de revendas',clube_coupons:'Clube TAMÃO'
  };
  const month=d?String(d.month).slice(0,7):
    (adminOwnerCampaignSignalsMonth||new Intl.DateTimeFormat('sv-SE',{
      timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'
    }).format(new Date()));
  const rows=(d?.rows||[]).map(x=>{
    const url=adminOwnerCampaignSignalsLink(x.campaignTag);
    const share=x.status==='allocated'&&url?
      '<button type="button" class="secondary small" onclick="adminOwnerCampaignSignalsCopyFromUi(\''+
      esc(x.campaignTag)+'\')">Copiar link da campanha</button>':
      '<p class="tiny muted">Campanha devolvida ao planejamento: link não oferecido para nova divulgação.</p>';
    return '<article class="card flat form-stack">'+
      '<div class="section-head"><div><strong>'+esc(x.campaignLabel)+'</strong>'+
      '<p class="tiny muted">'+esc(labels[x.benefitKey]||x.benefitKey)+' • '+
      esc(x.campaignReference)+'</p></div><span class="status-pill">'+
      (x.status==='allocated'?'Em planejamento':'Encerrada no planejamento')+'</span></div>'+
      '<div class="merchant-kpis">'+
      '<div class="kpi"><span class="label">Acessos registrados</span><strong>'+
      Number(x.landingViews).toLocaleString('pt-BR')+'</strong></div>'+
      '<div class="kpi"><span class="label">Visualizações do formulário</span><strong>'+
      Number(x.formViews).toLocaleString('pt-BR')+'</strong></div>'+
      '<div class="kpi"><span class="label">Cadastros identificados</span><strong>'+
      Number(x.leads).toLocaleString('pt-BR')+'</strong></div>'+
      '<div class="kpi"><span class="label">Cadastros qualificados no CRM</span><strong>'+
      Number(x.qualifiedLeads).toLocaleString('pt-BR')+'</strong></div></div>'+
      '<p class="tiny muted">Clientes: '+Number(x.customerLeads).toLocaleString('pt-BR')+
      ' • revendas: '+Number(x.merchantLeads).toLocaleString('pt-BR')+
      ' • conversões registradas no CRM: '+Number(x.crmConvertedLeads).toLocaleString('pt-BR')+
      ' (não são compras comprovadas).</p>'+
      '<p>Orçamento reservado no planejamento: <strong>'+adminMoney(x.plannedAllocationCents)+
      '</strong> • retorno financeiro: <strong>não mensurado</strong>.</p>'+
      share+'</article>';
  }).join('');
  return '<div class="form-stack">'+
    '<div class="section-head"><div><h4>Resultados de divulgação das campanhas</h4>'+
    '<p>Gere links exclusivos para cada campanha e acompanhe acessos, interesse e cadastros por origem identificada.</p>'+
    '</div></div>'+
    '<div class="card flat form-stack"><label class="input-wrap">Mês da campanha'+
    '<input class="input" type="month" min="2026-01" id="owner-campaign-signals-month" value="'+esc(month)+'"></label>'+
    '<button type="button" class="secondary small" onclick="adminOwnerCampaignSignalsLoadFromUi()" '+
    (adminOwnerCampaignSignalsBusy?'disabled':'')+'>Consultar resultados</button></div>'+
    (d?'<div class="merchant-kpis">'+
      '<div class="kpi"><span class="label">Campanhas planejadas no mês</span><strong>'+
      Number(d.totalCampaigns).toLocaleString('pt-BR')+'</strong></div>'+
      '<div class="kpi"><span class="label">Acessos sem identificação de campanha TAMÃO</span><strong>'+
      Number(d.unattributedLandingViews).toLocaleString('pt-BR')+'</strong></div>'+
      '<div class="kpi"><span class="label">Formulários sem identificação de campanha TAMÃO</span><strong>'+
      Number(d.unattributedFormViews).toLocaleString('pt-BR')+'</strong></div></div>'+
      (d.truncated?'<p class="tiny muted">Exibindo as 50 campanhas mais recentes deste mês.</p>':'')+
      '<div class="grid cards-2">'+
      (rows||'<p class="muted">Nenhuma campanha com orçamento planejado neste mês. Separe primeiro um valor na aba Campanhas para gerar seu link exclusivo.</p>')+
      '</div>':
      '<p class="muted">Consulte o mês para mostrar somente indicadores medidos.</p>')+
    '<p class="tiny muted">Medição agregada por campanha identificada no link, dentro da competência e da janela da alocação. Acessos não são pessoas únicas; visualizações e cadastros não comprovam pedidos. Não há ROI, faturamento atribuído, saldo disponível ou pagamento de incentivos calculado por esta aba.</p>'+ 
    adminOwnerCampaignOrdersSection()+
    adminOwnerCampaignFeeReceiptsSection()+
    adminOwnerBatchLedgerSection()+
    adminCampaignCostsSection()+
    (typeof adminOwnerFinancialSummarySection==='function'?adminOwnerFinancialSummarySection():'')+
    '</div>';
}

// TAMÃO V1.256 — private receipt objects for already recorded marketing costs.
// Never use a public bucket or disclose service-role credentials to the browser.
let adminCampaignReceiptsState=null;
let adminCampaignReceiptsBusy=false;
let adminCampaignReceiptsUploading=false;
async function adminCampaignReceiptsLoadFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  const role=String(adminCurrentRole());
  if(!actor||!['superadmin','finance'].includes(role)||adminCampaignReceiptsBusy)return;
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return toast('Competência inválida.');
  adminCampaignReceiptsBusy=true;render();
  try{
    const d=await adminInvoke({action:'owner-campaign-receipts-read',month:month?month+'-01':''});
    if(d?.source!=='admin_owner_campaign_receipts_read_v1_256'||
       d.readOnly!==true||d.privateBucket!==true||d.bankVerified!==false||
       d.noPublicUrls!==true||!/^\d{4}-\d{2}-01$/.test(String(d.month||''))||
       (month&&d.month!==month+'-01')||
       !Number.isSafeInteger(d.total)||d.total<0||d.limit!==100||
       d.truncated!==(d.total>100)||
       !Array.isArray(d.rows)||d.rows.length>100||d.rows.length>d.total||
       d.rows.some(x=>!x||!/^[0-9a-f-]{36}$/i.test(String(x.expenseId||''))||
         !Number.isSafeInteger(x.sizeBytes)||x.sizeBytes<64||x.sizeBytes>3145728||
         !['application/pdf','image/png','image/jpeg'].includes(x.mimeType)||
         !/^[0-9a-f]{64}$/.test(String(x.sha256||''))||
         !Number.isFinite(Date.parse(String(x.uploadedAt||'')))||
         typeof x.voided!=='boolean'))
      throw new Error('Metadados documentais não verificados.');
    if(actor===String(adminRuntime?.session?.user?.id||'')&&role===String(adminCurrentRole()))
      adminCampaignReceiptsState={...d,loadedFor:actor};
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminCampaignReceiptsState=null;
      toast(String(e?.message||'Não foi possível carregar os comprovantes.'));
    }
  }finally{adminCampaignReceiptsBusy=false;render();}
}
async function adminCampaignReceiptUploadFromUi(expenseId){
  const actor=String(adminRuntime?.session?.user?.id||'');
  if(!actor||String(adminCurrentRole())!=='superadmin'||adminCampaignReceiptsUploading)return;
  const cost=adminCampaignCostsState?.loadedFor===actor?adminCampaignCostsState:null;
  const metadata=adminCampaignReceiptsState?.loadedFor===actor?adminCampaignReceiptsState:null;
  if(!cost?.expenses?.some(x=>x.expenseId===expenseId&&x.status==='owner_attested')||
     !metadata||metadata.month!==cost.month||
     metadata.truncated||metadata.rows.some(x=>x.expenseId===expenseId))
    return toast('Consulte as despesas e os comprovantes do mês antes do envio.');
  const file=document.getElementById('owner-proof-file-'+expenseId)?.files?.[0];
  if(!file||!['application/pdf','image/png','image/jpeg'].includes(file.type)||
     file.size<64||file.size>3145728)
    return toast('Selecione um PDF, PNG ou JPEG de até 3 MB.');
  if(!adminRuntime?.client?.storage)
    return toast('Armazenamento indisponível: entre novamente no Admin.');
  adminCampaignReceiptsUploading=true;
  try{
    const bytes=await file.arrayBuffer();
    const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))
      .map(x=>x.toString(16).padStart(2,'0')).join('');
    const prep=await adminInvoke({action:'owner-campaign-receipt-prepare',
      expenseId,mimeType:file.type,sizeBytes:file.size});
    if(prep?.source!=='admin_owner_campaign_receipt_prepare_v1_256'||
       prep?.bucket!=='tamao-owner-campaign-receipts-v1-256'||
       prep?.mimeType!==file.type||prep?.maxBytes!==3145728||
       prep?.privateBucket!==true||prep?.bankVerified!==false||
       typeof prep.token!=='string'||prep.token.length<12||
       typeof prep.path!=='string'||!prep.path.startsWith(expenseId+'/')||
       !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|png|jpg)$/i.test(prep.path))
      throw new Error('Autorização privada de envio inválida.');
    const {error:uploadError}=await adminRuntime.client.storage
      .from('tamao-owner-campaign-receipts-v1-256')
      .uploadToSignedUrl(prep.path,prep.token,file,{contentType:file.type,upsert:false});
    if(uploadError)throw new Error('O arquivo não foi recebido: '+uploadError.message);
    const result=await adminInvoke({action:'owner-campaign-receipt-finalize',
      expenseId,path:prep.path,mimeType:file.type,sha256});
    if(result?.source!=='admin_owner_campaign_receipt_attach_v1_256'||
       result?.attached!==true||result?.bankVerified!==false||
       result?.cashMoved!==false||result?.newBenefitsEnabled!==false)
      throw new Error('O vínculo do documento não foi confirmado.');
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      toast('Comprovante arquivado no armazenamento privado.');
      await adminCampaignReceiptsLoadFromUi();
    }
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||''))
      toast(String(e?.message||'Falha no envio do comprovante.'));
  }finally{adminCampaignReceiptsUploading=false;render();}
}
async function adminCampaignReceiptDownloadFromUi(expenseId){
  const actor=String(adminRuntime?.session?.user?.id||'');
  if(!actor||!['superadmin','finance'].includes(String(adminCurrentRole())))return;
  const meta=adminCampaignReceiptsState?.loadedFor===actor?adminCampaignReceiptsState:null;
  if(!meta?.rows?.some(x=>x.expenseId===expenseId))return;
  const tab=globalThis.open?.('about:blank','_blank');
  if(tab)tab.opener=null;
  try{
    const data=await adminInvoke({action:'owner-campaign-receipt-view',expenseId});
    const url=new URL(String(data?.url||''));
    const base=new URL(CHAMA_BACKEND.url);
    if(data?.source!=='admin_owner_campaign_receipt_view_v1_256'||
       data?.temporaryDownload!==true||data?.bankVerified!==false||
       data?.expiresInSeconds!==60||url.origin!==base.origin||
       !url.pathname.startsWith('/storage/v1/object/sign/tamao-owner-campaign-receipts-v1-256/'))
      throw new Error('Link temporário não validado.');
    if(tab)tab.location.href=url.href;
    else globalThis.location.assign(url.href);
  }catch(e){
    if(tab)tab.close();
    if(actor===String(adminRuntime?.session?.user?.id||''))
      toast(String(e?.message||'Não foi possível consultar o comprovante.'));
  }
}
// TAMÃO V1.255 — paid marketing cost declared with documentary reference, never bank API proof.
let adminCampaignCostsState=null;
let adminCampaignCostsBusy=false;
let adminCampaignCostsActionPending=false;
async function adminCampaignCostsLoadFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  const role=String(adminCurrentRole());
  if(!actor||!['superadmin','finance'].includes(role)||adminCampaignCostsBusy)return;
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return toast('Selecione um mês válido.');
  adminCampaignCostsBusy=true;
  render();
  try{
    const d=await adminInvoke({action:'owner-campaign-cost-read',month:month?month+'-01':''});
    const benefits=['customer_cashback','customer_referral','merchant_referral','clube_coupons'];
    if(d?.source!=='admin_owner_campaign_cost_read_v1_255'||
       d?.evidenceLevel!=='owner_attested_proof_reference_not_bank_verified'||
       d?.readOnly!==true||d?.bankVerified!==false||
       d?.receiptFileUploaded!==false||d?.roiMeasured!==false||
       d?.cashMoved!==false||d?.incentiveBudgetDebited!==false||
       d?.newBenefitsEnabled!==false||
       !/^\d{4}-\d{2}-01$/.test(String(d?.month||''))||
       (month&&d.month!==month+'-01')||
       !Number.isSafeInteger(d.totalCampaigns)||d.totalCampaigns<0||
       d.campaignLimit!==50||d.campaignTruncated!==(d.totalCampaigns>50)||
       !Array.isArray(d.campaigns)||d.campaigns.length>50||
       d.campaigns.length>d.totalCampaigns||
       !Number.isSafeInteger(d.totalExpenses)||d.totalExpenses<0||
       d.expenseLimit!==100||d.expenseTruncated!==(d.totalExpenses>100)||
       !Array.isArray(d.expenses)||d.expenses.length>100||
       d.expenses.length>d.totalExpenses||
       d.campaigns.some(c=>!c||!/^[0-9a-f-]{36}$/i.test(String(c.allocationId||''))||
         !benefits.some(k=>typeof c.campaignTag==='string'&&c.campaignTag.startsWith(
           'tam-'+k+'-'+d.month.slice(0,4)+d.month.slice(5,7)+'-'))||
         typeof c.campaignLabel!=='string'||c.campaignLabel.length>180||
         !['allocated','released'].includes(c.status)||
         !['incentivePlannedCents','ownerReportedPaidMarketingCents','activeExpenses','voidedExpenses']
           .every(k=>Number.isSafeInteger(c[k])&&c[k]>=0))||
       d.expenses.some(x=>!x||!/^[0-9a-f-]{36}$/i.test(String(x.expenseId||''))||
         !/^[0-9a-f-]{36}$/i.test(String(x.allocationId||''))||
         !Number.isSafeInteger(x.amountCents)||x.amountCents<100||x.amountCents>5000000||
         !/^\d{4}-\d{2}-\d{2}$/.test(String(x.paidOn||''))||
         !['pix','bank_transfer','card','cash','other'].includes(x.paymentMethod)||
         typeof x.proofReference!=='string'||x.proofReference.length>120||
         typeof x.description!=='string'||x.description.length>240||
         !Number.isFinite(Date.parse(String(x.recordedAt||'')))||
         !['owner_attested','voided'].includes(x.status)||
         (x.status==='voided'&&(!Number.isFinite(Date.parse(String(x.voidedAt||'')))||
           typeof x.voidReason!=='string'||x.voidReason.length<12))))
      throw new Error('Despesas não confirmadas pelo servidor.');
    if(actor===String(adminRuntime?.session?.user?.id||'')&&role===String(adminCurrentRole()))
      adminCampaignCostsState={...d,loadedFor:actor};
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminCampaignCostsState=null;
      toast(String(e?.message||'Não foi possível carregar as despesas.'));
    }
  }finally{adminCampaignCostsBusy=false;render();}
}
async function adminCampaignCostsRecordFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  if(!actor||String(adminCurrentRole())!=='superadmin'||adminCampaignCostsActionPending)return;
  const d=adminCampaignCostsState?.loadedFor===actor?adminCampaignCostsState:null;
  const read=k=>String(document.getElementById('owner-cost-'+k)?.value||'').trim();
  const allocationId=read('allocation');
  const campaign=d?.campaigns?.find(x=>x.allocationId===allocationId);
  const amountCents=adminOwnerFundingReaisToCents(read('amount'),5000000);
  const paidOn=read('date'),paymentMethod=read('method');
  const proofReference=read('proof'),description=read('description');
  if(!campaign||amountCents===null||amountCents<100||amountCents>5000000||
     !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)||
     !['pix','bank_transfer','card','cash','other'].includes(paymentMethod)||
     !/^[A-Za-z0-9 .:/_-]{12,120}$/.test(proofReference)||
     description.length<12||description.length>240)
    return toast('Informe campanha, pagamento, referência do comprovante e descrição.');
  adminCampaignCostsActionPending=true;
  try{
    const result=await adminInvoke({action:'owner-campaign-cost-record',
      expenseId:crypto.randomUUID(),requestId:crypto.randomUUID(),
      allocationId,amountCents,paidOn,paymentMethod,proofReference,description});
    if(result?.source!=='admin_owner_campaign_cost_record_v1_255'||
       result?.recorded!==true||result?.status!=='owner_attested'||
       result?.cashMoved!==false||result?.bankVerified!==false||
       result?.receiptFileUploaded!==false||
       result?.incentiveBudgetDebited!==false||
       result?.newBenefitsEnabled!==false)
      throw new Error('Registro não confirmado.');
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      toast('Despesa registrada como paga por declaração do administrador.');
      await adminCampaignCostsLoadFromUi();
    }
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||''))
      toast(String(e?.message||'Não foi possível salvar a despesa.'));
  }finally{adminCampaignCostsActionPending=false;render();}
}
async function adminCampaignCostsVoidFromUi(expenseId){
  const actor=String(adminRuntime?.session?.user?.id||'');
  if(!actor||String(adminCurrentRole())!=='superadmin'||adminCampaignCostsActionPending)return;
  const d=adminCampaignCostsState?.loadedFor===actor?adminCampaignCostsState:null;
  if(!d?.expenses?.some(x=>x.expenseId===expenseId&&x.status==='owner_attested'))return;
  const reason=String(document.getElementById('owner-cost-void-'+expenseId)?.value||'').trim();
  if(reason.length<12||reason.length>240)
    return toast('Descreva em pelo menos 12 caracteres o motivo da correção.');
  adminCampaignCostsActionPending=true;
  try{
    const result=await adminInvoke({action:'owner-campaign-cost-void',
      expenseId,reason,requestId:crypto.randomUUID()});
    if(result?.source!=='admin_owner_campaign_cost_void_v1_255'||
       result?.recorded!==true||result?.status!=='voided'||
       result?.cashMoved!==false||result?.bankVerified!==false||
       result?.incentiveBudgetDebited!==false||
       result?.newBenefitsEnabled!==false)
      throw new Error('Correção não confirmada.');
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      toast('Correção registrada. O lançamento original permanece no histórico.');
      await adminCampaignCostsLoadFromUi();
    }
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||''))
      toast(String(e?.message||'Falha ao corrigir a despesa.'));
  }finally{adminCampaignCostsActionPending=false;render();}
}
function adminCampaignCostsSection(){
  if(!['superadmin','finance'].includes(String(adminCurrentRole())))return '';
  const actor=String(adminRuntime?.session?.user?.id||'');
  const d=adminCampaignCostsState?.loadedFor===actor?adminCampaignCostsState:null;
  const role=String(adminCurrentRole()),month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  const matching=d&&(!month||d.month.slice(0,7)===month);
  const campaigns=matching?d.campaigns:[];
  const campMap=new Map(campaigns.map(x=>[x.allocationId,x.campaignLabel]));
  const receiptMeta=typeof adminCampaignReceiptsState!=='undefined'&&
    adminCampaignReceiptsState?.loadedFor===actor&&
    adminCampaignReceiptsState.month===d?.month?adminCampaignReceiptsState:null;
  const receiptByExpense=new Map((receiptMeta?.rows||[]).map(x=>[x.expenseId,x]));
  const receiptComplete=!!receiptMeta&&!receiptMeta.truncated;
  const options=campaigns.filter(c=>c.status==='allocated')
    .map(x=>'<option value="'+esc(x.allocationId)+'">'+esc(x.campaignLabel)+
      ' ('+esc(x.campaignTag)+')</option>').join('');
  const total=campaigns.reduce((n,c)=>n+c.ownerReportedPaidMarketingCents,0);
  const entries=(matching?d.expenses:[]).map(x=>'<article class="card flat form-stack">'+
    '<strong>'+esc(campMap.get(x.allocationId)||'Campanha')+' • '+adminMoney(x.amountCents)+'</strong>'+
    '<p class="tiny muted">'+esc(x.paidOn)+' • '+esc(x.paymentMethod)+' • Referência: '+
    esc(x.proofReference)+'</p><p>'+esc(x.description)+'</p>'+
    (receiptByExpense.has(x.expenseId)?
      '<p class="tiny muted">Comprovante privado anexado • SHA-256: '+
      esc(receiptByExpense.get(x.expenseId).sha256.slice(0,12))+'… • '+
      Number(receiptByExpense.get(x.expenseId).sizeBytes).toLocaleString('pt-BR')+' bytes</p>'+
      '<button type="button" class="secondary small" onclick="adminCampaignReceiptDownloadFromUi(\''+
      esc(x.expenseId)+'\')">Baixar comprovante privado</button>':
      receiptComplete&&x.status==='owner_attested'&&role==='superadmin'?
      '<label class="input-wrap">Anexar comprovante (PDF, PNG ou JPEG, até 3 MB)'+
      '<input class="input" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" '+
      'id="owner-proof-file-'+esc(x.expenseId)+'"></label>'+
      '<button type="button" class="secondary small" onclick="adminCampaignReceiptUploadFromUi(\''+
      esc(x.expenseId)+'\')" '+(adminCampaignReceiptsUploading?'disabled':'')+
      '>Enviar comprovante privado</button>':
      '<p class="tiny muted">Consulte os comprovantes para verificar se há arquivo anexado.</p>')+
    (x.status==='voided'?
      '<p class="tiny muted">Lançamento corrigido • '+esc(x.voidReason||'')+'</p>':
      '<p class="tiny muted">Pagamento declarado pelo administrador. Não conciliado por API bancária.</p>'+
      (role==='superadmin'?
        '<label class="input-wrap">Motivo da correção<input class="input" id="owner-cost-void-'+
        esc(x.expenseId)+'" maxlength="240" placeholder="Informe por que deve ser desconsiderado"></label>'+
        '<button type="button" class="secondary small" onclick="adminCampaignCostsVoidFromUi(\''+
        esc(x.expenseId)+'\')" '+(adminCampaignCostsActionPending?'disabled':'')+
        '>Corrigir lançamento</button>':'')
    )+'</article>').join('');
  const edit=matching&&role==='superadmin'?
    '<div class="card flat form-stack"><h4>Registrar pagamento de divulgação</h4>'+
    '<p class="tiny muted">Preencha somente uma despesa já paga. A referência identifica o comprovante externo, mas nenhum arquivo é enviado aqui.</p>'+
    '<label class="input-wrap">Campanha<select class="input" id="owner-cost-allocation">'+
    (options||'<option value="">Nenhuma campanha ativa neste mês</option>')+'</select></label>'+
    '<div class="grid cards-2">'+
    '<label class="input-wrap">Valor pago (R$)<input class="input" id="owner-cost-amount" inputmode="decimal" placeholder="49,90"></label>'+
    '<label class="input-wrap">Data do pagamento<input class="input" id="owner-cost-date" type="date"></label></div>'+
    '<label class="input-wrap">Meio de pagamento<select class="input" id="owner-cost-method">'+
    '<option value="pix">Pix</option><option value="bank_transfer">Transferência</option>'+
    '<option value="card">Cartão</option><option value="cash">Dinheiro</option>'+
    '<option value="other">Outro</option></select></label>'+
    '<label class="input-wrap">Identificador do comprovante / transação'+
    '<input class="input" id="owner-cost-proof" maxlength="120" placeholder="EXTRATO-2026-10-TRANSACAO-01"></label>'+
    '<label class="input-wrap">Descrição da despesa'+
    '<textarea class="input" id="owner-cost-description" maxlength="240" rows="2" placeholder="Campanha de divulgação no comércio local"></textarea></label>'+
    '<button type="button" class="primary small" onclick="adminCampaignCostsRecordFromUi()" '+
    (adminCampaignCostsActionPending||!options?'disabled':'')+'>Registrar despesa paga</button></div>':'';
  return '<div class="form-stack"><div class="section-head"><div>'+
    '<h4>Gastos de divulgação por campanha</h4>'+
    '<p>Registre despesas de marketing pagas pelo fundador, separadas do orçamento reservado para cashback, indicações e cupons.</p>'+
    '</div></div>'+
    '<button type="button" class="secondary small" onclick="adminCampaignCostsLoadFromUi()" '+
    (adminCampaignCostsBusy?'disabled':'')+'>Consultar despesas do mês</button>'+
    '<button type="button" class="secondary small" onclick="adminCampaignReceiptsLoadFromUi()" '+
    (typeof adminCampaignReceiptsBusy!=='undefined'&&adminCampaignReceiptsBusy?'disabled':'')+'>Consultar comprovantes privados</button>'+
    (matching?'<div class="merchant-kpis">'+
      '<div class="kpi"><span class="label">Pagamentos declarados ativos</span><strong>'+
      adminMoney(total)+'</strong></div>'+
      '<div class="kpi"><span class="label">Lançamentos no mês</span><strong>'+
      Number(d.totalExpenses).toLocaleString('pt-BR')+'</strong></div></div>'+
      (d.campaignTruncated||d.expenseTruncated?
         '<p class="tiny muted">Resultados limitados aos 50 projetos e 100 lançamentos mais recentes; os totais por campanha incluem todos os lançamentos.</p>':'')+
      edit+'<div class="grid cards-2">'+
      (entries||'<p class="muted">Não há despesas registradas nesta competência.</p>')+'</div>':
      '<p class="muted">Consulte a competência selecionada para carregar os gastos registrados.</p>')+
    '<p class="tiny muted">Os valores são pagamentos declarados pelo administrador. Não há upload automático ao registrar a despesa: o comprovante pode ser anexado separadamente em armazenamento privado, mas o arquivo não prova conciliação bancária, libera saldo ou calcula ROI. Corrigir um lançamento não apaga o registro original.</p>'+
    '</div>';
}

// TAMÃO V1.258 — manually confirmed one-file orphan cleanup. No scheduled deletion.
let adminOwnerOrphanCleanupState=null;
let adminOwnerOrphanCleanupBusy=false;
let adminOwnerOrphanDeleteBusy=false;
async function adminOwnerOrphanCleanupLoadFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  const role=String(adminCurrentRole());
  if(!actor||!['superadmin','finance'].includes(role)||adminOwnerOrphanCleanupBusy)return;
  adminOwnerOrphanCleanupBusy=true;render();
  try{
    const d=await adminInvoke({action:'owner-orphan-cleanup-candidates'});
    if(d?.source!=='admin_owner_cleanup_candidates_v1_258'||
       d?.readOnly!==true||d?.privateBucket!==true||d?.noObjectPaths!==true||
       d?.deletionPerformed!==false||d?.automaticDeletionEnabled!==false||
       d?.minAgeHours!==24||d?.limit!==20||
       !Number.isSafeInteger(d.totalCandidates)||d.totalCandidates<0||
       d.truncated!==(d.totalCandidates>20)||
       !Array.isArray(d.rows)||d.rows.length>20||
       d.rows.length>d.totalCandidates||
       d.rows.some(x=>!x||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(x.objectId||''))||
         !Number.isFinite(Date.parse(String(x.createdAt||'')))))
      throw new Error('Lista de arquivos órfãos não verificada.');
    if(actor===String(adminRuntime?.session?.user?.id||'')&&role===String(adminCurrentRole()))
      adminOwnerOrphanCleanupState={...d,loadedFor:actor};
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerOrphanCleanupState=null;
      toast(String(e?.message||'Não foi possível carregar candidatos.'));
    }
  }finally{adminOwnerOrphanCleanupBusy=false;render();}
}
async function adminOwnerOrphanCleanupDeleteFromUi(objectId){
  const actor=String(adminRuntime?.session?.user?.id||'');
  if(!actor||String(adminCurrentRole())!=='superadmin'||adminOwnerOrphanDeleteBusy)return;
  const d=adminOwnerOrphanCleanupState?.loadedFor===actor?adminOwnerOrphanCleanupState:null;
  if(!d?.rows?.some(x=>x.objectId===objectId))return;
  const confirm=String(document.getElementById('owner-orphan-confirm-'+objectId)?.value||'').trim();
  if(confirm!=='EXCLUIR')
    return toast('Digite EXCLUIR para confirmar a remoção definitiva deste arquivo sem vínculo.');
  adminOwnerOrphanDeleteBusy=true;
  try{
    const result=await adminInvoke({action:'owner-orphan-cleanup-delete',
      objectId,requestId:crypto.randomUUID(),confirm:'EXCLUIR'});
    if(result?.source!=='admin_owner_cleanup_deleted_v1_258'||
       result?.objectAbsentConfirmed!==true||result?.oneObjectOnly!==true||
       result?.automaticDeletionEnabled!==false||result?.auditRecorded!==true||
       result?.linkedReceiptDeleted!==false||result?.objectPathsExposed!==false)
      throw new Error('Exclusão não confirmada pelo registro de auditoria.');
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      toast('Arquivo órfão removido e resultado registrado na auditoria.');
      await adminOwnerOrphanCleanupLoadFromUi();
      await adminOwnerOrphanAuditLoadFromUi();
    }
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerOrphanCleanupState=null;
      toast(String(e?.message||'Falha ao remover o arquivo. Consulte a auditoria.'));
    }
  }finally{adminOwnerOrphanDeleteBusy=false;render();}
}
function adminOwnerOrphanCleanupSection(){
  if(!['superadmin','finance'].includes(String(adminCurrentRole())))return '';
  const actor=String(adminRuntime?.session?.user?.id||'');
  const role=String(adminCurrentRole());
  const d=adminOwnerOrphanCleanupState?.loadedFor===actor?adminOwnerOrphanCleanupState:null;
  const items=(d?.rows||[]).map((x,i)=>'<article class="card flat form-stack">'+
    '<strong>Arquivo sem vínculo '+(i+1)+'</strong>'+
    '<p class="tiny muted">Identificador técnico: '+esc(x.objectId)+
    ' • Enviado em: '+esc(x.createdAt)+'</p>'+
    (role==='superadmin'?
      '<label class="input-wrap">Digite EXCLUIR para remover apenas este arquivo'+
      '<input class="input" id="owner-orphan-confirm-'+esc(x.objectId)+
      '" placeholder="EXCLUIR" autocomplete="off" maxlength="7"></label>'+
      '<button type="button" class="secondary small" onclick="adminOwnerOrphanCleanupDeleteFromUi(\''+
      esc(x.objectId)+'\')" '+(adminOwnerOrphanDeleteBusy?'disabled':'')+
      '>Remover este arquivo órfão</button>':
      '<p class="tiny muted">Somente o administrador principal pode autorizar a exclusão.</p>')+
    '</article>').join('');
  return '<div class="form-stack">'+
    '<h4>Revisão e limpeza individual de uploads abandonados</h4>'+
    '<p class="tiny muted">Apenas arquivos do bucket privado sem vínculo e enviados há mais de 24 horas aparecem aqui. A exclusão é permanente e exige confirmação para cada arquivo. Nenhum comprovante vinculado pode ser removido.</p>'+
    '<button type="button" class="secondary small" onclick="adminOwnerOrphanCleanupLoadFromUi()" '+
    (adminOwnerOrphanCleanupBusy?'disabled':'')+'>Consultar candidatos seguros</button>'+
    (d?'<p class="tiny muted">'+Number(d.totalCandidates).toLocaleString('pt-BR')+
      ' candidato(s) para revisão'+(d.truncated?' • até 20 por consulta':'')+'</p>'+
      '<div class="grid cards-2">'+
      (items||'<p class="muted">Nenhum arquivo está elegível para exclusão.</p>')+
      '</div>':
      '<p class="tiny muted">Consulte primeiro os candidatos. Arquivos recentes ou já vinculados não são listados.</p>')+
    '<p class="tiny muted">Não há limpeza automática em segundo plano. O sistema registra a autorização e verifica a ausência do objeto depois da remoção pela API Storage.</p>'+
    '</div>';
}

// TAMÃO V1.267 — separate commerce receipts from founder-funded benefits.
let adminOwnerMultiPspState=null,adminOwnerMultiPspBusy=false;
async function adminOwnerMultiPspLoadFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  const role=String(adminCurrentRole());
  if(!actor||!['superadmin','finance'].includes(role)||adminOwnerMultiPspBusy)return;
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return toast('Competência inválida.');
  adminOwnerMultiPspBusy=true;
  try{
    const d=await adminInvoke({action:'owner-multi-psp-hub',month:month?month+'-01':''});
    const integer=n=>Number.isSafeInteger(n)&&n>=0;
    const merchantKeys=['paymentAttempts','evidenceRecords','providerVerifiedOrders'];
    const outboundKeys=['claims','activeClaims','voidedClaims','withDocument',
      'officiallyQueried','officialStatusMatched','ownerDeclaredActiveCents',
      'verifiedBeneficiaryClaims','bankVerifiedClaims'];
    const outgoingKeys=['mercado_pago','pix','bank_transfer','other'];
    if(d?.source!=='admin_owner_multi_psp_hub_v1_267'||
       d?.timezone!=='America/Sao_Paulo'||
       d?.providerCatalogIsRuntimeVerification!==false||
       d?.merchantReceiptsProvePlatformPayouts!==false||
       d?.merchantAndPlatformFundsNettingAllowed!==false||
       d?.bankSettlementVerified!==false||d?.recipientVerified!==false||
       d?.externalPaidBenefitsCents!==null||d?.noTransfers!==true||
       d?.noIdentityCollection!==true||d?.newBenefitsEnabled!==false||
       d?.readOnly!==true||
       !/^\d{4}-\d{2}-01$/.test(String(d?.month||''))||
       (month&&d.month!==month+'-01')||
       !integer(d.merchantCatalogProviders)||
       !integer(d.merchantEvidenceRecords)||
       !integer(d.merchantProviderVerifiedOrders)||
       !integer(d.outgoingClaims)||!integer(d.outgoingClaimsQueried)||
       d.outgoingProviderCategories!==4||
       !Array.isArray(d.merchantProviders)||
       d.merchantProviders.length!==d.merchantCatalogProviders||
       d.merchantProviders.length>50||
       !Array.isArray(d.outgoingProviders)||d.outgoingProviders.length!==4||
       typeof d.outgoingPayoutsCredentialConfigured!=='boolean'||
       d.outgoingPayoutsCredentialScope!=='dedicated_mp_payouts_read_only'||
       d.outgoingPayoutsCredentialProvesApiAuthorization!==false||
       d.incomingMerchantCredentialsReused!==false||
       d.merchantProviders.some(x=>!x||
         !/^[a-z][a-z0-9_]{1,31}$/.test(String(x.providerKey||''))||
         typeof x.displayName!=='string'||x.displayName.length<2||x.displayName.length>120||
         typeof x.catalogAdapterStatus!=='string'||
         typeof x.catalogConnectionMode!=='string'||
         typeof x.catalogVerificationLevel!=='string'||
         x.catalogFundsFlow!=='merchant_direct'||
         typeof x.catalogSupportsLookup!=='boolean'||
         typeof x.catalogSupportsWebhook!=='boolean'||
         x.ownerOfFunds!=='merchant'||x.outgoingPayoutVerified!==false||
         !merchantKeys.every(k=>integer(x[k]))||
         x.providerVerifiedOrders>x.evidenceRecords)||
       new Set(d.merchantProviders.map(x=>x.providerKey)).size!==d.merchantProviders.length||
       d.outgoingProviders.some(x=>!x||!outgoingKeys.includes(x.providerKey)||
         typeof x.displayName!=='string'||x.displayName.length>120||
         x.officialOutgoingLookupImplemented!==(x.providerKey==='mercado_pago')||
         x.ownerOfFunds!=='platform_owner_reported'||x.realTransferProven!==false||
         !outboundKeys.every(k=>integer(x[k]))||
         x.claims!==x.activeClaims+x.voidedClaims||
         x.officialStatusMatched>x.officiallyQueried||
         x.officiallyQueried>x.claims||x.withDocument>x.claims||
         x.verifiedBeneficiaryClaims!==0||x.bankVerifiedClaims!==0)||
       new Set(d.outgoingProviders.map(x=>x.providerKey)).size!==4||
       d.outgoingProviders.reduce((s,x)=>s+x.claims,0)!==d.outgoingClaims||
       d.outgoingProviders.reduce((s,x)=>s+x.officiallyQueried,0)!==d.outgoingClaimsQueried||
       d.merchantProviders.reduce((s,x)=>s+x.evidenceRecords,0)!==d.merchantEvidenceRecords||
       d.merchantProviders.reduce((s,x)=>s+x.providerVerifiedOrders,0)<
         d.merchantProviderVerifiedOrders)
      throw new Error('Dados de conciliação multibanco não validados.');
    if(actor===String(adminRuntime?.session?.user?.id||'')&&
      role===String(adminCurrentRole()))
      adminOwnerMultiPspState={...d,loadedFor:actor};
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerMultiPspState=null;
      toast(String(e?.message||'Falha na central de conciliação.'));
    }
  }finally{adminOwnerMultiPspBusy=false;render();}
}
// V1.268 — operational guidance from real counts; catalog metadata is not proof.
function adminOwnerMultiPspAdapterGuidance(p){
  const mode=String(p.catalogConnectionMode||'');
  const status=String(p.catalogAdapterStatus||'');
  if(mode==='manual'||status==='manual_only')
    return 'Conferência manual: não há confirmação automática do banco neste modo.';
  if(status==='implemented')
    return 'Adaptador disponível no sistema; conexão da revenda e homologação real ainda precisam ser comprovadas.';
  if(status==='ready_for_credentials')
    return 'Aguardando configuração/homologação: recursos declarados não significam API conectada.';
  return 'Situação técnica indeterminada: revisar documentação do provedor antes de usar.';
}
function adminOwnerMultiPspEvidenceGuidance(p){
  if(p.providerVerifiedOrders>0)
    return 'Há pedidos com evidência do provedor registrada nesta competência; isso não confirma liquidação bancária.';
  if(p.evidenceRecords>0||p.paymentAttempts>0)
    return 'Há atividade registrada, mas nenhum pedido com evidência validada do provedor nesta competência.';
  return 'Sem tentativas ou evidências de pagamentos registradas nesta competência.';
}
function adminOwnerMultiPspSection(){
  const role=String(adminCurrentRole());
  if(!['superadmin','finance'].includes(role))return '';
  const actor=String(adminRuntime?.session?.user?.id||'');
  const d=adminOwnerMultiPspState?.loadedFor===actor?adminOwnerMultiPspState:null;
  const selectedMonth=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  const valid=d&&(!selectedMonth||d.month.slice(0,7)===selectedMonth);
  const configuredCatalog=(valid?d.merchantProviders:[]);
  const withProviderEvidence=configuredCatalog.filter(p=>p.providerVerifiedOrders>0).length;
  const needsCredentialReview=configuredCatalog.filter(p=>p.catalogAdapterStatus==='ready_for_credentials').length;
  const manualOnly=configuredCatalog.filter(p=>p.catalogConnectionMode==='manual').length;
  const merchantRows=configuredCatalog.map(p=>
    '<article class="card flat form-stack"><h5>'+esc(p.displayName)+'</h5>'+
    '<p class="tiny muted"><strong>Etapa técnica:</strong> '+esc(adminOwnerMultiPspAdapterGuidance(p))+'</p>'+
    '<p class="tiny muted">Modo: '+esc(p.catalogConnectionMode)+
      ' • consulta declarada: '+(p.catalogSupportsLookup?'sim':'não')+
      ' • webhook declarado: '+(p.catalogSupportsWebhook?'sim':'não')+'</p>'+
    '<p>'+Number(p.paymentAttempts)+' tentativas • '+
      Number(p.evidenceRecords)+' registros de evidência • '+
      Number(p.providerVerifiedOrders)+' pedidos com evidência do provedor</p>'+
    '<p class="tiny muted">'+esc(adminOwnerMultiPspEvidenceGuidance(p))+'</p>'+
    '<p class="tiny muted">Recebimento destinado à revenda. Não é comprovante de repasse do TAMÃO.</p></article>'
  ).join('');
  const outgoingRows=(valid?d.outgoingProviders:[]).map(p=>
    '<article class="card flat form-stack"><h5>'+esc(p.displayName)+'</h5>'+
    '<p class="tiny muted">'+(p.officialOutgoingLookupImplemented?
      'Consulta oficial somente leitura implementada; necessita credencial específica e transação real.':
      'Sem consulta oficial de saída conectada.')+'</p>'+
    '<p>'+Number(p.activeClaims)+' declarações ativas • '+
      Number(p.voidedClaims)+' retificadas • '+
      Number(p.withDocument)+' com arquivo • '+
      Number(p.officiallyQueried)+' consultadas no provedor</p>'+
    '<p>Declarado pelo proprietário: <strong>'+
      adminMoney(p.ownerDeclaredActiveCents)+'</strong>'+
      ' • status/referência coincidentes: '+Number(p.officialStatusMatched)+'</p>'+
    '<p class="tiny muted">Titularidade comprovada: 0 • liquidação bancária comprovada: 0</p></article>'
  ).join('');
  return '<div class="card flat form-stack">'+
    '<h4>Central multibanco e multi-PSP</h4>'+
    '<p>Compare o estágio de cada integração sem misturar recebimentos das revendas com os benefícios financiados pelo TAMÃO.</p>'+
    '<button type="button" class="secondary small" onclick="adminOwnerMultiPspLoadFromUi()" '+
    (adminOwnerMultiPspBusy?'disabled':'')+'>Atualizar visão financeira da competência</button>'+
    (valid?'<div class="merchant-kpis">'+
      '<div class="kpi"><span class="label">PSPs no catálogo das revendas</span><strong>'+
      Number(d.merchantCatalogProviders)+'</strong></div>'+
      '<div class="kpi"><span class="label">Evidências de pagamentos às revendas</span><strong>'+
      Number(d.merchantEvidenceRecords)+'</strong></div>'+
      '<div class="kpi"><span class="label">Declarações externas de benefícios</span><strong>'+
      Number(d.outgoingClaims)+'</strong></div>'+
      '<div class="kpi"><span class="label">Consultas oficiais de saída</span><strong>'+
      Number(d.outgoingClaimsQueried)+'</strong></div></div>'+
      '<h5>Roteiro para ativação real</h5>'+
      '<p class="tiny muted">'+Number(withProviderEvidence)+' '+(withProviderEvidence===1?'opção com':'opções com')+
      ' pedidos que possuem evidência registrada do PSP; '+
      Number(needsCredentialReview)+' '+(needsCredentialReview===1?'opção aguardando':'opções aguardando')+
      ' configuração/homologação; '+
      Number(manualOnly)+' '+(manualOnly===1?'modo manual':'modos manuais')+
      ' no catálogo. São indicadores de estágios diferentes; não somá-los como integrações ativas.</p>'+
      '<p class="tiny muted">Próxima ação: a revenda escolhe seu prestador, conclui a conexão/homologação quando aplicável e realiza uma transação legítima; o TAMÃO verifica os eventos e a evidência do provedor. Sem transação real, manter o estado como não comprovado.</p>'+
      '<h5>Pagamentos dos clientes às revendas</h5>'+
      '<p class="tiny muted">A situação exibida no catálogo descreve recursos previstos ou implementados, não credenciais ativas nem transações confirmadas.</p>'+
      '<div class="grid cards-2">'+(merchantRows||
      '<p class="tiny muted">Nenhum provedor no catálogo.</p>')+'</div>'+
      '<h5>Saídas para benefícios financiados pelo TAMÃO</h5>'+
      '<p class="tiny muted">O único adaptador de consulta oficial de saídas implementado é Mercado Pago Payouts. Credencial específica configurada: <strong>'+
      (d.outgoingPayoutsCredentialConfigured?'sim (autorização da API não comprovada)':'não')+
      '</strong>. Nenhuma credencial de recebimentos das revendas é reutilizada.</p>'+
      '<div class="grid cards-2">'+outgoingRows+'</div>':
      '<p class="tiny muted">Consulte uma competência para visualizar os provedores e as evidências reais.</p>')+
    '<p class="tiny muted">Não somar ou compensar os fluxos. Uma venda paga à revenda não prova custo do TAMÃO. Declaração de repasse, documento anexo ou transação consultada não confirmam, isoladamente, o beneficiário nem a liquidação bancária. Esta central é apenas de consulta; não ativa novos provedores nem executa transferências.</p></div>';
}

// TAMÃO V1.266 — evidence gaps, no recipient banking details collected.
let adminOwnerRecipientProofState=null,adminOwnerRecipientProofBusy=false;
async function adminOwnerRecipientProofLoadFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  const role=String(adminCurrentRole());
  if(!actor||!['superadmin','finance'].includes(role)||adminOwnerRecipientProofBusy)return;
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return toast('Selecione uma competência válida.');
  adminOwnerRecipientProofBusy=true;
  try{
    const d=await adminInvoke({action:'owner-recipient-proof-readiness',month:month?month+'-01':''});
    const t=d?.totals;
    const counts=['totalClaims','activeClaims','voidedClaims','eligibleClaims',
      'walletReconciledClaims','internalIdentityMatches','documentedClaims',
      'providerObservedClaims','providerReconciledClaims','readyForRecipientProof',
      'beneficiaryVerifiedClaims','bankSettlementVerifiedClaims'];
    const knownReasons=['claim_voided','recipient_grant_identity_mismatch',
      'commission_not_currently_eligible','commission_wallet_not_reconciled',
      'outgoing_provider_not_supported','official_outgoing_transaction_not_queried',
      'outgoing_transaction_status_or_reference_mismatch','payout_document_missing',
      'recipient_destination_not_independently_verified'];
    if(d?.source!=='admin_owner_recipient_evidence_gaps_v1_266'||
       d?.scope!=='owner_reported_referral_outgoing_claims'||
       d?.timezone!=='America/Sao_Paulo'||
       d?.destinationIdentityAvailableFromProvider!==false||
       d?.recipientVerified!==false||d?.bankSettlementVerified!==false||
       d?.externalPaidBenefitsCents!==null||d?.noIdentityCollection!==true||
       d?.readOnly!==true||d?.noTransfers!==true||
       d?.newBenefitsEnabled!==false||
       !/^\d{4}-\d{2}-01$/.test(String(d?.month||''))||
       (month&&d.month!==month+'-01')||
       !t||counts.some(k=>!Number.isSafeInteger(t[k])||t[k]<0)||
       t.totalClaims!==t.activeClaims+t.voidedClaims||
       t.beneficiaryVerifiedClaims!==0||t.bankSettlementVerifiedClaims!==0||
       t.readyForRecipientProof>t.providerReconciledClaims||
       t.readyForRecipientProof>t.documentedClaims||
       t.providerReconciledClaims>t.providerObservedClaims||
       t.providerObservedClaims>t.totalClaims||
       t.walletReconciledClaims>t.totalClaims||
       t.internalIdentityMatches>t.totalClaims||
       t.eligibleClaims>t.activeClaims||
       d.limit!==50||d.truncated!==(t.totalClaims>50)||
       !Array.isArray(d.rows)||d.rows.length>50||d.rows.length>t.totalClaims||
       d.rows.some(x=>!x||!/^[0-9a-f-]{36}$/i.test(String(x.claimId||''))||
         !Number.isSafeInteger(x.amountCents)||x.amountCents<1||
         !['pix','bank_transfer','mercado_pago','other'].includes(x.provider)||
         !/^\d{4}-\d{2}-\d{2}$/.test(String(x.paidOn||''))||
         !['voided','grantEligibleNow','internalRecipientMatchesGrant',
          'walletVerified','proofAttached','providerObserved','providerMatchedNow',
          'readyForRecipientProof','beneficiaryVerified','bankSettlementVerified']
          .every(k=>typeof x[k]==='boolean')||
         x.beneficiaryVerified!==false||x.bankSettlementVerified!==false||
         (x.readyForRecipientProof&&(
          x.voided||!x.grantEligibleNow||!x.walletVerified||!x.proofAttached||
          !x.providerMatchedNow||x.provider!=='mercado_pago'))||
         (x.providerMatchedNow&&!x.providerObserved)||
         (x.lastProviderCheckAt!==null&&
           !Number.isFinite(Date.parse(String(x.lastProviderCheckAt))))||
         !Array.isArray(x.missingEvidence)||
         !x.missingEvidence.includes('recipient_destination_not_independently_verified')||
         x.missingEvidence.some(r=>!knownReasons.includes(r))))
      throw new Error('Fila de evidências não validada.');
    if(actor===String(adminRuntime?.session?.user?.id||'')&&
       role===String(adminCurrentRole()))
      adminOwnerRecipientProofState={...d,loadedFor:actor};
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerRecipientProofState=null;
      toast(String(e?.message||'Falha na conferência de evidências de beneficiários.'));
    }
  }finally{adminOwnerRecipientProofBusy=false;render();}
}
function adminOwnerRecipientProofSection(){
  const role=String(adminCurrentRole());
  if(!['superadmin','finance'].includes(role))return '';
  const actor=String(adminRuntime?.session?.user?.id||'');
  const d=adminOwnerRecipientProofState?.loadedFor===actor?adminOwnerRecipientProofState:null;
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  const valid=d&&(!month||d.month.slice(0,7)===month);
  const t=valid?d.totals:null;
  const readable={
    claim_voided:'Declaração retificada',
    recipient_grant_identity_mismatch:'Destinatário interno diferente do indicador da concessão',
    commission_not_currently_eligible:'Comissão não está elegível atualmente',
    commission_wallet_not_reconciled:'Lançamentos da comissão não conciliados na carteira',
    outgoing_provider_not_supported:'Provedor ainda sem verificação externa integrada',
    official_outgoing_transaction_not_queried:'Sem consulta oficial da transferência de saída',
    outgoing_transaction_status_or_reference_mismatch:'Status, referência ou valor do provedor não conferidos',
    payout_document_missing:'Comprovante privado não anexado',
    recipient_destination_not_independently_verified:'Conta de destino e titularidade ainda não verificadas'
  };
  const list=(valid?d.rows:[]).map(x=>
    '<article class="card flat form-stack"><h5>Declaração '+esc(x.claimId)+'</h5>'+
    '<p>'+adminMoney(x.amountCents)+' • '+esc(x.provider)+
    ' • '+esc(x.paidOn)+(x.voided?' • retificada':'')+'</p>'+
    '<p class="tiny muted">Identidade do indicador no pedido: '+
      (x.internalRecipientMatchesGrant?'coincidente':'divergente')+
      ' • carteira: '+(x.walletVerified?'conciliada':'pendente')+
      ' • documento: '+(x.proofAttached?'anexado':'pendente')+
      ' • provedor: '+(x.providerMatchedNow?'transação conciliada':'sem confirmação suficiente')+
      '</p>'+
    '<p><strong>'+(
      x.readyForRecipientProof?'Falta apenas validar a titularidade do destino':'Evidências incompletas')+
      '</strong></p>'+
    '<p class="tiny muted">Pendências: '+
      x.missingEvidence.map(code=>esc(readable[code]||code)).join(' • ')+'</p>'+
    '</article>').join('');
  return '<div class="card flat form-stack"><h4>Conferência da identidade do beneficiário</h4>'+
    '<p>Mostra o que falta para confirmar que a conta destinatária pertence ao indicador que recebeu a comissão, sem coletar CPF, chave Pix ou dados bancários nesta etapa.</p>'+
    '<button type="button" class="secondary small" onclick="adminOwnerRecipientProofLoadFromUi()" '+
    (adminOwnerRecipientProofBusy?'disabled':'')+'>Conferir evidências da competência</button>'+
    (valid?'<div class="merchant-kpis">'+
      '<div class="kpi"><span class="label">Declarações</span><strong>'+Number(t.totalClaims)+'</strong></div>'+
      '<div class="kpi"><span class="label">Comissão e carteira conferidas</span><strong>'+
         Number(t.walletReconciledClaims)+'</strong></div>'+
      '<div class="kpi"><span class="label">Transações do provedor conciliadas</span><strong>'+
         Number(t.providerReconciledClaims)+'</strong></div>'+
      '<div class="kpi"><span class="label">Aguardando somente prova do destinatário</span><strong>'+
         Number(t.readyForRecipientProof)+'</strong></div></div>'+
      '<p class="tiny muted">'+Number(t.documentedClaims)+' com documento • '+
        Number(t.providerObservedClaims)+' consultas externas • '+
        Number(t.voidedClaims)+' declarações retificadas • '+
        Number(t.beneficiaryVerifiedClaims)+' beneficiários comprovados • '+
        Number(t.bankSettlementVerifiedClaims)+' liquidações bancárias comprovadas.'+
        (d.truncated?' Até 50 declarações listadas.':'')+'</p>'+
      '<div class="grid cards-2">'+(list||
        '<p class="tiny muted">Nenhuma declaração de repasse nesta competência.</p>')+
      '</div>':
      '<p class="tiny muted">Consulte a competência para identificar pendências.</p>')+
    '<p class="tiny muted">A identidade interna do indicador não confirma a titularidade da conta de destino. O retorno atual do Payouts não traz prova suficiente de destinatário para esta conciliação. Nenhum repasse, consulta de CPF ou verificação bancária nova é executado aqui. Valores pagos externamente permanecem não mensurados.</p>'+
    '</div>';
}

// V1.265 — Provider-derived outgoing payout status, not proof of recipient receipt.
let adminOwnerPayoutProviderState=null,adminOwnerPayoutProviderBusy=false;
async function adminOwnerPayoutProviderLoadFromUi(offset=0){
  if(!Number.isSafeInteger(offset)||offset<0||offset>999990||offset%30!==0)
    return toast('Página de revisão inválida.');
  const actor=String(adminRuntime?.session?.user?.id||'');
  const role=String(adminCurrentRole());
  if(!actor||!['superadmin','finance'].includes(role)||adminOwnerPayoutProviderBusy)return;
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return toast('Competência inválida.');
  adminOwnerPayoutProviderBusy=true;
  try{
    const d=await adminInvoke(offset===0?
      {action:'owner-payout-provider-read',month:month?month+'-01':''}:
      {action:'owner-payout-provider-page',month:month?month+'-01':'',offset});
    if(d?.source!=='owner_payout_provider_reconciliation_v1_265'||
       d?.provider!=='mercado_pago_payouts_get'||
       d?.timezone!=='America/Sao_Paulo'||d?.readOnly!==true||
       d?.noTransfers!==true||d?.bankSettlementVerified!==false||
       d?.recipientVerified!==false||d?.providerTransactionIsBeneficiaryProof!==false||
       d?.externalPaidBenefitsCents!==null||
       !/^\d{4}-\d{2}-01$/.test(String(d?.month||''))||
       (month&&d.month!==month+'-01')||
       !['totalClaims','checkedClaims','providerSuccessClaims','checkedUnmatchedClaims',
         'unqueriedClaims'].every(k=>Number.isSafeInteger(d[k])&&d[k]>=0)||
       d.totalClaims!==d.checkedClaims+d.unqueriedClaims||
       d.checkedClaims!==d.providerSuccessClaims+d.checkedUnmatchedClaims||
       d.triageV1335!==true||d.queueOrder!=='priority_then_reported_at'||
       d.queueCoverage!==(offset===0?'top_30_prioritized':'paginated_30_prioritized')||
       (offset>0&&(d.triageV1336!==true||d.pageOffset!==offset||
         d.pageLimit!==30||d.hasPrevious!==true||
         d.hasMore!==(offset+d.rows?.length<d.totalClaims)))||
       d.historicalProviderSuccessIsBankProof!==false||
       d.automaticRecoveryExecuted!==false||
       !['activeReversedClaims','activeReversedReportedCents',
         'reversedWithHistoricalProviderSuccessClaims',
         'activeReversedWithHistoricalProviderSuccessClaims']
         .every(k=>Number.isSafeInteger(d[k])&&d[k]>=0)||
       d.activeReversedClaims>d.totalClaims||
       d.reversedWithHistoricalProviderSuccessClaims>d.totalClaims||
       d.activeReversedWithHistoricalProviderSuccessClaims>d.activeReversedClaims||
       d.activeReversedWithHistoricalProviderSuccessClaims>
         d.reversedWithHistoricalProviderSuccessClaims||
       d.limit!==30||d.truncated!==(d.totalClaims>30)||
       !Array.isArray(d.rows)||d.rows.length>30||d.rows.length>d.totalClaims||
       d.rows.some(x=>!x||!/^[0-9a-f-]{36}$/i.test(String(x.claimId||''))||
         typeof x.successNow!=='boolean'||typeof x.proofPresent!=='boolean'||
         typeof x.voided!=='boolean'||
         !/^[0-9a-f-]{36}$/i.test(String(x.orderId||''))||
         !Number.isSafeInteger(x.reportedAmountCents)||x.reportedAmountCents<0||
         !/^\d{4}-\d{2}-\d{2}$/.test(String(x.paidOn||''))||
         !Number.isFinite(Date.parse(String(x.reportedAt||'')))||
         !Number.isSafeInteger(x.priority)||x.priority<0||x.priority>5||
         !['grantReversedNow','historicalProviderSuccessObserved',
           'requiresReversalReview'].every(k=>typeof x[k]==='boolean')||
         x.requiresReversalReview!==
           (x.grantReversedNow&&x.historicalProviderSuccessObserved&&!x.voided)||
         (x.requiresReversalReview&&x.priority!==0)||
         (x.voided&&x.priority!==5)||
         (x.priority===0&&!x.requiresReversalReview)||
         (x.checkedAt!==null&&(
           !Number.isFinite(Date.parse(String(x.checkedAt)))||
           typeof x.referenceMatches!=='boolean'||typeof x.amountMatches!=='boolean'||
           typeof x.providerTransactionSuccess!=='boolean'||
           typeof x.status!=='string'||typeof x.detail!=='string'||
           !/^POP[0-9A-Z]{10,45}$/.test(String(x.payoutId||''))||
           !/^TOP[0-9A-Z]{10,45}$/.test(String(x.transactionId||''))))||
         (x.checkedAt===null&&(
           x.status!==null||x.detail!==null||
           x.payoutId!==null||x.transactionId!==null||
           x.referenceMatches!==null||x.amountMatches!==null||
           x.providerTransactionSuccess!==null)))||
       d.rows.some((x,i)=>i>0&&d.rows[i-1].priority>x.priority))
      throw new Error('Conciliação do provedor não validada.');
    if(actor===String(adminRuntime?.session?.user?.id||'')&&
      role===String(adminCurrentRole())&&
      month===String(document.getElementById('owner-campaign-signals-month')?.value||'').trim())
      adminOwnerPayoutProviderState={...d,loadedFor:actor,
        pageOffset:offset,pageHasMore:offset===0?d.totalClaims>30:d.hasMore};
    if(adminPayoutReviewState&&!d.rows.some(x=>x.claimId===adminPayoutReviewState.claimId))
      adminPayoutReviewState=null;
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerPayoutProviderState=null;
      toast(String(e?.message||'Falha ao consultar o provedor.'));
    }
  }finally{adminOwnerPayoutProviderBusy=false;render();}
}
async function adminOwnerPayoutProviderCheckFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  if(!actor||adminOwnerPayoutProviderBusy||String(adminCurrentRole())!=='superadmin')
    return;
  const val=id=>String(document.getElementById(id)?.value||'').trim();
  const claimId=val('owner-provider-claim');
  const payoutId=val('owner-provider-payout').toUpperCase();
  const transactionId=val('owner-provider-transaction').toUpperCase();
  if(!/^[0-9a-f-]{36}$/i.test(claimId)||
     !/^POP[0-9A-Z]{10,45}$/.test(payoutId)||
     !/^TOP[0-9A-Z]{10,45}$/.test(transactionId))
    return toast('Informe IDs válidos da declaração, lote POP e transação TOP.');
  adminOwnerPayoutProviderBusy=true;
  try{
    const d=await adminInvoke({action:'owner-payout-provider-check',
      claimId,payoutId,transactionId});
    if(d?.source==='owner_payout_provider_check_v1_265'&&
      d?.configured===false&&d?.checked===false&&
      d?.reason==='outgoing_payouts_credentials_missing'&&
      d?.bankSettlementVerified===false&&d?.recipientVerified===false&&
      d?.transferExecuted===false){
      toast('Consulta indisponível: a credencial exclusiva de Payouts não está configurada.');
    }else{
      if(d?.source!=='owner_payout_provider_observation_v1_265'||
         !/^[0-9a-f-]{36}$/i.test(String(d.observationId||''))||
         d.claimId!==claimId||d.configured!==true||d.checked!==true||
         d.provider!=='mercado_pago_payouts_get'||
         typeof d.status!=='string'||typeof d.statusDetail!=='string'||
         !['referenceMatches','amountMatches','eligibleNow','providerTransactionSuccess']
            .every(k=>typeof d[k]==='boolean')||
         !Number.isSafeInteger(d.amountCents)||d.amountCents<0||
         !Number.isSafeInteger(d.reportedAmountCents)||d.reportedAmountCents<0||
         d.recipientVerified!==false||d.bankSettlementVerified!==false||
         d.settlementBankConfirmed!==false||d.transferExecuted!==false)
        throw new Error('Resultado externo não validado.');
      toast(d.providerTransactionSuccess?
        'Mercado Pago retornou transação concluída e valores/referências coincidentes. Destinatário ainda não verificado.':
        'Consulta realizada. Status, valor ou referência ainda não permitem considerar a operação conciliada.');
      adminOwnerPayoutProviderState=null;
    }
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||''))
      toast(String(e?.message||'Falha na consulta à API de Payouts.'));
  }finally{adminOwnerPayoutProviderBusy=false;render();}
}
// TAMÃO V1.335 — local filtering affects only the prioritized 30-record page.
let adminOwnerPayoutQueueFilter='all';
function adminOwnerPayoutQueueSetFilterFromUi(next){
  if(!['all','critical','pending'].includes(next))return;
  adminOwnerPayoutQueueFilter=next;
  render();
}
// Convenience only: prefill an existing read-only provider GET form.
// Never request a payout, resolve a claim, or approve a financial reversal.
function adminOwnerPayoutQueuePrepareCheckFromUi(claimId){
  const actor=String(adminRuntime?.session?.user?.id||'');
  if(adminOwnerPayoutProviderBusy||String(adminCurrentRole())!=='superadmin')return;
  const d=adminOwnerPayoutProviderState?.loadedFor===actor?adminOwnerPayoutProviderState:null;
  const row=d?.rows?.find(x=>x.claimId===claimId&&!x.voided);
  if(!row||!/^[0-9a-f-]{36}$/i.test(String(claimId||''))||
     !/^POP[0-9A-Z]{10,45}$/.test(String(row.payoutId||''))||
     !/^TOP[0-9A-Z]{10,45}$/.test(String(row.transactionId||'')))
    return toast('Esta declaração ainda não possui os IDs externos necessários. Consulte os registros existentes.');
  const claim=document.getElementById('owner-provider-claim');
  const payout=document.getElementById('owner-provider-payout');
  const transaction=document.getElementById('owner-provider-transaction');
  if(!claim||!payout||!transaction)return toast('Formulário de consulta indisponível.');
  claim.value=claimId;
  payout.value=row.payoutId;
  transaction.value=row.transactionId;
  toast('IDs preenchidos. Revise os dados e use Verificar pelo provedor para uma nova consulta somente leitura.');
}
// TAMÃO V1.337 — administrative review history; never certifies a transfer.
let adminPayoutReviewState=null,adminPayoutReviewBusy=false,adminPayoutReviewRetry=null;
const adminPayoutReviewStatuses={
  not_started:'Não iniciada',in_review:'Em análise',
  awaiting_evidence:'Aguardando evidências',
  reviewed_no_bank_proof:'Analisada sem comprovação bancária',
  closed_administrative:'Encerrada administrativamente'
};
async function adminPayoutReviewOpenFromUi(claimId){
  const actor=String(adminRuntime?.session?.user?.id||'');
  const role=String(adminCurrentRole());
  const panel=adminOwnerPayoutProviderState?.loadedFor===actor?adminOwnerPayoutProviderState:null;
  if(!actor||!['superadmin','finance'].includes(role)||adminPayoutReviewBusy||
     !panel?.rows?.some(x=>x.claimId===claimId))return;
  adminPayoutReviewBusy=true;
  try{
    const d=await adminInvoke({action:'owner-payout-review-read',claimId});
    if(d?.source!=='admin_payout_review_history_v1_337'||
      d?.claimId!==claimId||d?.readOnly!==true||d?.administrativeOnly!==true||
      d?.moneyMoved!==false||d?.bankSettlementVerified!==false||
      d?.recipientVerified!==false||
      !Object.hasOwn(adminPayoutReviewStatuses,d?.currentAdministrativeState)||
      !Number.isSafeInteger(d?.totalEvents)||d.totalEvents<0||
      d?.limit!==100||d?.truncated!==(d.totalEvents>100)||
      !Array.isArray(d?.events)||d.events.length>100||d.events.length>d.totalEvents||
      d.events.some(e=>!e||!/^[1-9][0-9]*$/.test(String(e.eventId||''))||
        !/^[0-9a-f-]{36}$/i.test(String(e.actorId||''))||
        !Object.hasOwn(adminPayoutReviewStatuses,e.reviewState)||
        e.reviewState==='not_started'||typeof e.justification!=='string'||
        e.justification.trim().length<20||e.justification.length>1000||
        !Number.isFinite(Date.parse(String(e.recordedAt||''))))||
      d.events.some((e,i)=>i>0&&BigInt(d.events[i-1].eventId)<=BigInt(e.eventId))||
      ((d.totalEvents===0)!==(d.currentAdministrativeState==='not_started'))||
      (d.events.length>0&&d.events[0].reviewState!==d.currentAdministrativeState))
      throw new Error('Histórico da análise não validado.');
    if(actor===String(adminRuntime?.session?.user?.id||'')&&
       role===String(adminCurrentRole())&&
       adminOwnerPayoutProviderState===panel)
      adminPayoutReviewState={...d,loadedFor:actor};
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminPayoutReviewState=null;
      toast(String(e?.message||'Histórico indisponível.'));
    }
  }finally{adminPayoutReviewBusy=false;render();}
}
async function adminPayoutReviewRecordFromUi(claimId){
  const actor=String(adminRuntime?.session?.user?.id||'');
  const current=adminPayoutReviewState;
  const panel=adminOwnerPayoutProviderState?.loadedFor===actor?adminOwnerPayoutProviderState:null;
  if(!actor||String(adminCurrentRole())!=='superadmin'||adminPayoutReviewBusy||
     current?.loadedFor!==actor||current?.claimId!==claimId||
     !panel?.rows?.some(x=>x.claimId===claimId))return;
  const reviewState=String(document.getElementById('admin-payout-review-status')?.value||'');
  const justification=String(document.getElementById('admin-payout-review-note')?.value||'').trim();
  if(!Object.hasOwn(adminPayoutReviewStatuses,reviewState)||
     reviewState==='not_started'||justification.length<20||justification.length>1000)
    return toast('Informe situação e justificativa de 20 a 1000 caracteres.');
  const signature=claimId+'|'+reviewState+'|'+justification;
  if(adminPayoutReviewRetry?.signature!==signature)
    adminPayoutReviewRetry={signature,requestId:crypto.randomUUID()};
  adminPayoutReviewBusy=true;
  let confirmed=false;
  try{
    const d=await adminInvoke({action:'owner-payout-review-record',claimId,
      requestId:adminPayoutReviewRetry.requestId,reviewState,justification});
    if(d?.source!=='admin_payout_review_record_v1_337'||
       d?.claimId!==claimId||d?.requestId!==adminPayoutReviewRetry.requestId||
       d?.reviewState!==reviewState||d?.justification!==justification||
       !/^[1-9][0-9]*$/.test(String(d?.eventId||''))||
       !Number.isFinite(Date.parse(String(d?.recordedAt||'')))||
       d?.administrativeOnly!==true||d?.moneyMoved!==false||
       d?.bankSettlementVerified!==false||d?.recipientVerified!==false)
      throw new Error('Resposta não confirmada. Consulte o histórico antes de repetir.');
    confirmed=true;adminPayoutReviewRetry=null;adminPayoutReviewState=null;
    toast('Análise administrativa registrada. Nenhum pagamento foi comprovado.');
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||''))
      toast(String(e?.message||'Registro não confirmado. Consulte o histórico antes de repetir.'));
  }finally{adminPayoutReviewBusy=false;render();}
  if(confirmed&&actor===String(adminRuntime?.session?.user?.id||''))
    await adminPayoutReviewOpenFromUi(claimId);
}
// TAMÃO V1.338 — read-only, internal deadline triage for referral payout reviews.
let adminPayoutFollowupState=null,adminPayoutFollowupBusy=false;
async function adminPayoutFollowupLoadFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  const role=String(adminCurrentRole());
  if(!actor||!['superadmin','finance'].includes(role)||adminPayoutFollowupBusy)return;
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  if(month&&!/^\\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return toast('Competência inválida.');
  adminPayoutFollowupBusy=true;
  try{
    const d=await adminInvoke({action:'owner-payout-followup-read',month:month?month+'-01':''});
    const numbers=['totalClaims','voidedClaims','closedAdministrativeClaims',
      'activeClaims','unreviewedClaims','awaitingEvidenceClaims',
      'inReviewClaims','noBankProofClaims','overdueClaims','criticalReversalClaims'];
    const states=['not_started','in_review','awaiting_evidence','reviewed_no_bank_proof'];
    if(d?.source!=='admin_payout_followup_queue_v1_338'||
      d?.timezone!=='America/Sao_Paulo'||
      !/^\\d{4}-\\d{2}-01$/.test(String(d?.month||''))||
      (month&&d.month!==month+'-01')||
      d?.readOnly!==true||d?.administrativeOnly!==true||
      d?.bankSettlementVerified!==false||d?.recipientVerified!==false||
      d?.moneyMoved!==false||
      d?.duePolicy!=='internal_guidance_not_external_SLA'||
      d?.firstReviewHours!==24||d?.inReviewHours!==48||
      d?.awaitingEvidenceHours!==72||d?.noBankProofRecheckHours!==168||
      numbers.some(k=>!Number.isSafeInteger(d?.[k])||d[k]<0)||
      d.totalClaims!==d.voidedClaims+d.closedAdministrativeClaims+d.activeClaims||
      d.activeClaims!==d.unreviewedClaims+d.awaitingEvidenceClaims+
        d.inReviewClaims+d.noBankProofClaims||
      d.overdueClaims>d.activeClaims||d.criticalReversalClaims>d.activeClaims||
      d.limit!==30||d.truncated!==(d.activeClaims>30)||
      !Array.isArray(d.rows)||d.rows.length!==Math.min(30,d.activeClaims)||
      d.rows.some(x=>!x||!/^[0-9a-f-]{36}$/i.test(String(x.claimId||''))||
        !/^[0-9a-f-]{36}$/i.test(String(x.orderId||''))||
        !Number.isSafeInteger(x.reportedAmountCents)||x.reportedAmountCents<0||
        !Number.isFinite(Date.parse(String(x.reportedAt||'')))||
        !Number.isFinite(Date.parse(String(x.followupDueAt||'')))||
        !states.includes(x.reviewState)||
        !(x.lastReviewAt===null||
          Number.isFinite(Date.parse(String(x.lastReviewAt||''))))||
        (x.reviewState==='not_started')!==(x.lastReviewAt===null)||
        typeof x.overdue!=='boolean'||
        typeof x.criticalReversalObserved!=='boolean'||
        !Number.isSafeInteger(x.priority)||x.priority<0||x.priority>2||
        x.priority!==(x.criticalReversalObserved?0:x.overdue?1:2))||
      d.rows.some((x,i)=>i>0&&(
        d.rows[i-1].priority>x.priority||
        (d.rows[i-1].priority===x.priority&&
          Date.parse(d.rows[i-1].followupDueAt)>Date.parse(x.followupDueAt)))))
      throw new Error('Acompanhamento financeiro não validado.');
    if(actor===String(adminRuntime?.session?.user?.id||'')&&
       role===String(adminCurrentRole())&&
       month===String(document.getElementById('owner-campaign-signals-month')?.value||'').trim())
      adminPayoutFollowupState={...d,loadedFor:actor};
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminPayoutFollowupState=null;
      toast(String(e?.message||'Não foi possível consultar as pendências.'));
    }
  }finally{adminPayoutFollowupBusy=false;render();}
}
function adminPayoutFollowupSection(){
  const role=String(adminCurrentRole());
  if(!['superadmin','finance'].includes(role))return '';
  const actor=String(adminRuntime?.session?.user?.id||'');
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  const data=adminPayoutFollowupState?.loadedFor===actor?adminPayoutFollowupState:null;
  const d=data&&(!month||data.month.slice(0,7)===month)?data:null;
  const names={
    not_started:'Sem análise',in_review:'Em análise',
    awaiting_evidence:'Aguardando evidências',
    reviewed_no_bank_proof:'Sem comprovação bancária'
  };
  const stamp=iso=>new Date(iso).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
  return '<section class="card flat form-stack"><h4>Prazo das revisões financeiras</h4>'+
    '<p class="tiny muted">Prazos sugeridos para acompanhamento interno: primeira análise em 24 horas; análise em andamento em 48 horas; evidências em 72 horas; nova conferência sem prova bancária em 7 dias. Não são prazos de pagamento.</p>'+
    '<button type="button" class="secondary small" '+
      (adminPayoutFollowupBusy?'disabled':'')+
      ' onclick="adminPayoutFollowupLoadFromUi()">Atualizar pendências da competência</button>'+
    (d?
      '<div class="grid cards-2">'+
        '<div class="card flat"><strong>'+d.overdueClaims+'</strong><p>Revisões com prazo interno vencido</p></div>'+
        '<div class="card flat"><strong>'+d.unreviewedClaims+'</strong><p>Declarações sem análise</p></div>'+
        '<div class="card flat"><strong>'+d.awaitingEvidenceClaims+'</strong><p>Aguardando evidências</p></div>'+
        '<div class="card flat"><strong>'+d.criticalReversalClaims+'</strong><p>Estorno após sucesso observado no provedor</p></div>'+
      '</div>'+
      '<p class="tiny muted">'+d.activeClaims+' acompanhamentos ativos • '+
        d.inReviewClaims+' em análise • '+d.noBankProofClaims+
        ' para nova conferência sem prova bancária • '+d.closedAdministrativeClaims+
        ' encerrados administrativamente • '+d.voidedClaims+' declarações anuladas.</p>'+
      (d.truncated?'<p class="tiny muted">A lista mostra somente as 30 primeiras prioridades; os totais consideram toda a competência. Utilize a paginação da central para consultar as demais declarações.</p>':'')+
      '<div class="grid cards-2">'+
      (d.rows.map(x=>
        '<article class="card flat form-stack">'+
        '<strong>'+(x.priority===0?'Crítica — verificar estorno e repasse':
          x.overdue?'Prazo interno vencido':'Acompanhamento dentro do prazo')+'</strong>'+
        '<p>Pedido <code>'+esc(x.orderId)+'</code></p>'+
        '<p class="tiny muted">Declaração <code>'+esc(x.claimId)+'</code></p>'+
        '<p>Valor declarado: '+adminMoney(x.reportedAmountCents)+'</p>'+
        '<p>Situação: '+esc(names[x.reviewState])+'</p>'+
        '<p class="tiny muted">Próxima conferência sugerida: '+esc(stamp(x.followupDueAt))+'</p>'+
        '<p class="tiny muted">Utilize Ver histórico / revisar na central de repasses para registrar a análise.</p>'+
        '</article>').join('')||
        '<p class="tiny muted">Nenhuma pendência ativa nessa competência.</p>')+
      '</div>':
      '<p class="tiny muted">Carregue a competência para identificar as pendências e os prazos sugeridos.</p>')+
    '<p class="tiny muted">O encerramento de uma revisão não comprova pagamento, liquidação bancária nem titularidade. Nenhuma ação financeira é executada nesta área.</p>'+
    '</section>';
}
function adminOwnerPayoutProviderSection(){
  const role=String(adminCurrentRole());
  if(!['superadmin','finance'].includes(role))return '';
  const actor=String(adminRuntime?.session?.user?.id||'');
  const d=adminOwnerPayoutProviderState?.loadedFor===actor?adminOwnerPayoutProviderState:null;
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  const show=d&&(!month||d.month.slice(0,7)===month);
  const sourceRows=show?d.rows:[];
  const visible=sourceRows.filter(x=>adminOwnerPayoutQueueFilter==='all'||
    (adminOwnerPayoutQueueFilter==='critical'&&x.priority<=1)||
    (adminOwnerPayoutQueueFilter==='pending'&&!x.voided&&x.priority<=4));
  const priorityLabel=x=>{
    if(x.voided)return 'Retificada — histórico preservado';
    if(x.priority===0)return 'Urgente — estorno após sucesso observado';
    if(x.priority===1)return 'Alta — pedido estornado';
    if(x.priority===2)return 'Alta — dados externos divergentes';
    if(x.priority===3)return 'Pendente — consultar provedor';
    if(x.priority===4)return 'Pendente — comprovante ausente';
    return 'Acompanhamento — sem divergência detectada';
  };
  const nextStep=x=>{
    if(x.voided)return 'Declaração retificada. Manter histórico e consultar registros anteriores.';
    if(x.priority===0)return 'Confrontar pedido revertido, comprovante privado e histórico da transferência. Não cobrar automaticamente.';
    if(x.priority===1)return 'Conferir motivo do estorno e verificar se ocorreu alguma transferência real.';
    if(x.priority===2)return 'Comparar referência e valor declarado com a observação do provedor.';
    if(x.priority===3)return 'Localizar IDs oficiais POP e TOP de transferência já existente e consultar o provedor.';
    if(x.priority===4)return 'Conferir o documento privado e a titularidade antes de considerar o caso esclarecido.';
    return 'Acompanhar documentação e titularidade. Status do PSP não prova liquidação bancária.';
  };
  const selected=adminPayoutReviewState?.loadedFor===actor?adminPayoutReviewState:null;
  const review=show&&selected&&sourceRows.some(x=>x.claimId===selected.claimId)?
    '<section class="card flat form-stack">'+
    '<h5>Histórico da declaração '+esc(selected.claimId)+'</h5>'+
    '<p>Estado administrativo: <strong>'+
       esc(adminPayoutReviewStatuses[selected.currentAdministrativeState])+
       '</strong> • '+Number(selected.totalEvents)+' eventos</p>'+
    (selected.truncated?'<p class="tiny muted">Exibidos 100 eventos recentes; anteriores preservados no banco.</p>':'')+
    (selected.events.map(e=>
      '<div class="card flat"><strong>'+esc(adminPayoutReviewStatuses[e.reviewState])+
      '</strong><p>'+esc(e.justification)+'</p>'+
      '<p class="tiny muted">Por '+esc(e.actorId)+' • '+esc(e.recordedAt)+
      ' • evento '+esc(e.eventId)+'</p></div>').join('')||
      '<p class="tiny muted">Nenhuma revisão registrada.</p>')+
    (role==='superadmin'?
      '<label for="admin-payout-review-status">Situação do acompanhamento</label>'+
      '<select id="admin-payout-review-status">'+
      Object.entries(adminPayoutReviewStatuses).filter(([k])=>k!=='not_started')
        .map(([k,v])=>'<option value="'+esc(k)+'">'+esc(v)+'</option>').join('')+
      '</select><label for="admin-payout-review-note">Justificativa (20 a 1000 caracteres)</label>'+
      '<textarea id="admin-payout-review-note" maxlength="1000" rows="3"></textarea>'+
      '<button type="button" '+(adminPayoutReviewBusy?'disabled':'')+
      ' onclick="adminPayoutReviewRecordFromUi(&quot;'+esc(selected.claimId)+'&quot;)">'+
      'Registrar análise</button>':'')+
    '<p class="tiny muted">Encerramento administrativo não comprova recebimento bancário, destinatário nem transferência.</p>'+
    '</section>':'';
  const rows=visible.map(x=>
    '<article class="card flat form-stack" data-payout-review-priority="'+Number(x.priority)+'">'+
    '<h5>'+esc(priorityLabel(x))+'</h5>'+
    '<p class="tiny muted">Pedido <code>'+esc(x.orderId)+'</code></p>'+
    '<p class="tiny muted">Declaração <code>'+esc(x.claimId)+'</code></p>'+
    '<p>Valor declarado: <strong>'+adminMoney(x.reportedAmountCents)+'</strong>'+
      ' • data informada: '+esc(x.paidOn)+'</p>'+
    (x.checkedAt===null?'<p>Provedor ainda não consultado</p>':
      '<p>Status observado: <strong>'+esc(x.status)+'</strong>'+
       ' • '+esc(x.detail)+'</p>'+
      '<p>Referência: '+(x.referenceMatches?'confere':'diverge')+
        ' • valor: '+(x.amountMatches?'confere':'diverge')+
        ' • situação atual: '+(x.successNow?'compatível com observação':'não conciliada')+'</p>'+
      '<p class="tiny muted">Consulta: '+esc(x.checkedAt)+
        ' • POP '+esc(x.payoutId)+' • TOP '+esc(x.transactionId)+'</p>')+
    '<p>Comprovante privado: <strong>'+(x.proofPresent?'registrado':'ausente')+
      '</strong> • benefício revertido: '+(x.grantReversedNow?'sim':'não')+
      ' • sucesso observado anteriormente: '+(x.historicalProviderSuccessObserved?'sim':'não')+'</p>'+
    '<p class="tiny muted"><strong>Próximo passo:</strong> '+esc(nextStep(x))+'</p>'+
    (role==='superadmin'&&!x.voided&&x.payoutId&&x.transactionId?
      '<button type="button" class="secondary small" onclick="adminOwnerPayoutQueuePrepareCheckFromUi(&quot;'+
      esc(x.claimId)+'&quot;)">Preparar conferência externa</button>':'')+
    '<button type="button" class="secondary small" '+(adminPayoutReviewBusy?'disabled':'')+
      ' onclick="adminPayoutReviewOpenFromUi(&quot;'+esc(x.claimId)+'&quot;)">'+
      'Ver histórico / revisar</button>'+
    '</article>').join('');
  return '<div class="card flat form-stack"><h4>Central de revisão de repasses externos</h4>'+
    '<p class="tiny muted">Fila de conferência por prioridade; Mercado Pago Payouts. A consulta não transfere nem recupera valores.</p>'+
    '<button type="button" class="secondary small" onclick="adminOwnerPayoutProviderLoadFromUi()" '+
      (adminOwnerPayoutProviderBusy?'disabled':'')+'>Atualizar evidências da competência</button>'+
    (show?
      '<div class="grid cards-2">'+
      '<div class="card flat"><strong>'+Number(d.activeReversedWithHistoricalProviderSuccessClaims)+
      '</strong><p>Declarações ativas: estorno após sucesso observado</p></div>'+
      '<div class="card flat"><strong>'+Number(d.activeReversedClaims)+
      '</strong><p>Declarações ativas ligadas a pedidos revertidos</p>'+
      '<p class="tiny muted">Valor declarado: '+adminMoney(d.activeReversedReportedCents)+'</p></div>'+
      '<div class="card flat"><strong>'+Number(d.checkedUnmatchedClaims)+
      '</strong><p>Conferências externas sem conciliação atual</p></div>'+
      '<div class="card flat"><strong>'+Number(d.unqueriedClaims)+
      '</strong><p>Declarações ainda não consultadas no provedor</p></div></div>'+
      '<p class="tiny muted">'+Number(d.checkedClaims)+' de '+Number(d.totalClaims)+
       ' declarações consultadas • '+Number(d.providerSuccessClaims)+
       ' compatíveis no momento • '+Number(d.reversedWithHistoricalProviderSuccessClaims)+
       ' com estorno e sucesso histórico observado, incluindo retificadas.</p>'+
      '<p class="tiny muted">Mostrando '+(d.rows.length?Number(d.pageOffset)+1:0)+
      '–'+(Number(d.pageOffset)+d.rows.length)+' de '+Number(d.totalClaims)+
      ' declarações da competência • página '+(Math.floor(Number(d.pageOffset)/30)+1)+
      '. Os totais acima consideram a competência inteira.</p>'+
      '<div class="row wrap">'+
      '<button type="button" class="secondary small" '+(d.pageOffset===0||adminOwnerPayoutProviderBusy?'disabled':'')+
      ' onclick="adminOwnerPayoutProviderLoadFromUi('+Math.max(0,Number(d.pageOffset)-30)+')">Anterior</button>'+
      '<button type="button" class="secondary small" '+(!d.pageHasMore||adminOwnerPayoutProviderBusy?'disabled':'')+
      ' onclick="adminOwnerPayoutProviderLoadFromUi('+(Number(d.pageOffset)+30)+')">Próxima página</button></div>'+
      '<div class="row wrap" role="group" aria-label="Filtrar fila apresentada">'+
      ['all','critical','pending'].map((v,i)=>
        '<button type="button" class="'+(adminOwnerPayoutQueueFilter===v?'primary':'secondary')+
        ' small" onclick="adminOwnerPayoutQueueSetFilterFromUi(&quot;'+v+'&quot;)">'+
        ['Todos da página','Estornos prioritários','Pendências da página'][i]+'</button>').join('')+'</div>'+
      '<div class="grid cards-2">'+
      (rows||'<p class="tiny muted">Nenhuma declaração encontrada neste filtro da página.</p>')+
      '</div>'+review:
      '<p class="tiny muted">Consulte a competência para carregar a fila de revisão.</p>')+
    (role==='superadmin'?'<div class="card flat form-stack"><h5>Verificar transferência já existente</h5>'+
      '<p class="tiny muted">Preencha os IDs oficiais POP e TOP. O comando usa somente consulta GET; não inicia pagamentos.</p>'+
      '<label>Identificador da declaração</label>'+
      '<input id="owner-provider-claim" autocomplete="off" placeholder="UUID da declaração">'+
      '<label>ID do lote Payouts (POP…)</label>'+
      '<input id="owner-provider-payout" autocomplete="off" placeholder="POP...">'+
      '<label>ID da transação (TOP…)</label>'+
      '<input id="owner-provider-transaction" autocomplete="off" placeholder="TOP...">'+
      '<button type="button" onclick="adminOwnerPayoutProviderCheckFromUi()" '+
        (adminOwnerPayoutProviderBusy?'disabled':'')+
        '>Verificar pelo provedor (somente GET)</button></div>':'')+
    '<p class="tiny muted">Uma observação success/accredited não comprova liquidação bancária nem identidade do beneficiário. Revisões e recuperações financeiras exigem análise administrativa e evidência independente.</p>'+
    '</div>'+adminPayoutFollowupSection();
}

// TAMÃO V1.264 — confidential, byte-verified payout documents.
let adminOwnerPayoutProofState=null,adminOwnerPayoutProofBusy=false;
async function adminOwnerPayoutProofsLoadFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||''),role=String(adminCurrentRole());
  if(!actor||!['superadmin','finance'].includes(role)||adminOwnerPayoutProofBusy)return;
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return toast('Competência inválida.');
  adminOwnerPayoutProofBusy=true;
  try{
    const d=await adminInvoke({action:'owner-benefit-proofs-read',month:month?month+'-01':''});
    if(d?.source!=='admin_owner_payout_proofs_read_v1_264'||
      d?.timezone!=='America/Sao_Paulo'||d?.privateBucket!==true||
      d?.readOnly!==true||d?.verifiedBytesAtUpload!==true||
      d?.bankVerified!==false||d?.providerConfirmed!==false||
      d?.paidBenefitsCents!==null||d?.transferExecuted!==false||
      !/^\d{4}-\d{2}-01$/.test(String(d?.month||''))||(month&&d.month!==month+'-01')||
      !Number.isSafeInteger(d.totalClaims)||d.totalClaims<0||
      !Number.isSafeInteger(d.withProof)||d.withProof<0||
      !Number.isSafeInteger(d.withoutProof)||d.withoutProof<0||
      d.totalClaims!==d.withProof+d.withoutProof||
      d.limit!==30||d.truncated!==(d.totalClaims>30)||
      !Array.isArray(d.rows)||d.rows.length>30||d.rows.length>d.totalClaims||
      d.rows.some(x=>!x||!/^[0-9a-f-]{36}$/i.test(String(x.claimId||''))||
        typeof x.attached!=='boolean'||typeof x.voided!=='boolean'||
        (x.attached&&(
          !['application/pdf','image/png','image/jpeg'].includes(x.mimeType)||
          !Number.isSafeInteger(x.sizeBytes)||x.sizeBytes<64||x.sizeBytes>3145728||
          !/^[0-9a-f]{64}$/.test(String(x.sha256||''))||
          !Number.isFinite(Date.parse(String(x.uploadedAt||'')))))||
        (!x.attached&&(x.mimeType!==null||x.sizeBytes!==null||
          x.sha256!==null||x.uploadedAt!==null))))
      throw new Error('Metadados de comprovantes não verificados.');
    if(actor===String(adminRuntime?.session?.user?.id||'')&&role===String(adminCurrentRole()))
      adminOwnerPayoutProofState={...d,loadedFor:actor};
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerPayoutProofState=null;
      toast(String(e?.message||'Falha ao consultar comprovantes.'));
    }
  }finally{adminOwnerPayoutProofBusy=false;render();}
}
async function adminOwnerPayoutProofUploadFromUi(claimId){
  const actor=String(adminRuntime?.session?.user?.id||''),role=String(adminCurrentRole());
  if(!actor||role!=='superadmin'||adminOwnerPayoutProofBusy)return;
  const d=adminOwnerPayoutProofState?.loadedFor===actor?adminOwnerPayoutProofState:null;
  if(!d?.rows?.some(x=>x.claimId===claimId&&!x.attached&&!x.voided)||
     !/^[0-9a-f-]{36}$/i.test(String(claimId||'')))
    return toast('Consulte os repasses e escolha uma declaração ativa sem comprovante.');
  const file=document.getElementById('owner-payout-proof-file-'+claimId)?.files?.[0];
  if(!file||!['application/pdf','image/png','image/jpeg'].includes(file.type)||
    file.size<64||file.size>3145728)
    return toast('Escolha um PDF, PNG ou JPEG de até 3 MB.');
  if(!adminRuntime?.client?.storage)
    return toast('Armazenamento indisponível. Entre novamente.');
  adminOwnerPayoutProofBusy=true;
  try{
    const bytes=await file.arrayBuffer();
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))
      .map(x=>x.toString(16).padStart(2,'0')).join('');
    const prep=await adminInvoke({action:'owner-benefit-proof-prepare',
      claimId,mimeType:file.type,sizeBytes:file.size});
    if(prep?.source!=='admin_owner_payout_proof_prepare_v1_264'||
      prep?.bucket!=='tamao-owner-referral-payout-proofs-v1-264'||
      prep?.maxBytes!==3145728||prep?.mimeType!==file.type||
      prep?.privateBucket!==true||prep?.bankVerified!==false||
      typeof prep?.token!=='string'||prep.token.length<12||
      typeof prep?.path!=='string'||!prep.path.startsWith(claimId+'/')||
      !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|png|jpg)$/i.test(prep.path)||
      (prep.expectedHash!==null&&prep.expectedHash!==hash))
      throw new Error('Autorização do envio inválida ou hash anterior divergente.');
    const {error:uploadError}=await adminRuntime.client.storage
      .from('tamao-owner-referral-payout-proofs-v1-264')
      .uploadToSignedUrl(prep.path,prep.token,file,{contentType:file.type,upsert:false});
    if(uploadError)throw uploadError;
    const result=await adminInvoke({action:'owner-benefit-proof-finalize',
      claimId,path:prep.path,mimeType:file.type,sha256:hash});
    if(result?.source!=='admin_owner_payout_proof_attach_v1_264'||
      result.attached!==true||typeof result.replayed!=='boolean'||
      result.bankVerified!==false||result.cashMoved!==false)
      throw new Error('Vínculo do comprovante não confirmado.');
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      toast('Arquivo conferido por SHA-256 e vinculado no armazenamento privado.');
      adminOwnerPayoutProofState=null;
    }
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||''))
      toast(String(e?.message||'Não foi possível anexar o comprovante.'));
  }finally{adminOwnerPayoutProofBusy=false;render();}
}
async function adminOwnerPayoutProofVerifyFromUi(claimId){
  const actor=String(adminRuntime?.session?.user?.id||''),role=String(adminCurrentRole());
  if(!actor||!['superadmin','finance'].includes(role)||adminOwnerPayoutProofBusy)return;
  const d=adminOwnerPayoutProofState?.loadedFor===actor?adminOwnerPayoutProofState:null;
  if(!d?.rows?.some(x=>x.claimId===claimId&&x.attached))return;
  adminOwnerPayoutProofBusy=true;
  try{
    const v=await adminInvoke({action:'owner-benefit-proof-verify',claimId});
    if(v?.source!=='admin_owner_payout_proof_verify_v1_264'||
      v.claimId!==claimId||v.integrityVerified!==true||
      v.bankVerified!==false||v.providerConfirmed!==false||
      v.transferExecuted!==false)throw new Error('Verificação inválida.');
    toast('Integridade do arquivo conferida novamente. Não confirma a transferência bancária.');
  }catch(e){toast(String(e?.message||'Integridade não confirmada.'));}
  finally{adminOwnerPayoutProofBusy=false;render();}
}
async function adminOwnerPayoutProofViewFromUi(claimId){
  const actor=String(adminRuntime?.session?.user?.id||''),role=String(adminCurrentRole());
  if(!actor||!['superadmin','finance'].includes(role))return;
  const d=adminOwnerPayoutProofState?.loadedFor===actor?adminOwnerPayoutProofState:null;
  if(!d?.rows?.some(x=>x.claimId===claimId&&x.attached))return;
  const tab=globalThis.open?.('about:blank','_blank');
  if(tab)tab.opener=null;
  try{
    const v=await adminInvoke({action:'owner-benefit-proof-view',claimId});
    const url=new URL(String(v?.url||'')),base=new URL(CHAMA_BACKEND.url);
    if(v?.source!=='admin_owner_payout_proof_view_v1_264'||
      v.integrityVerified!==true||v.temporaryDownload!==true||
      v.expiresInSeconds!==60||v.bankVerified!==false||
      v.providerConfirmed!==false||url.origin!==base.origin||
      !url.pathname.startsWith('/storage/v1/object/sign/tamao-owner-referral-payout-proofs-v1-264/'))
      throw new Error('Link privado inválido.');
    if(tab)tab.location.href=url.href;else globalThis.location.assign(url.href);
  }catch(e){
    if(tab)tab.close();
    if(actor===String(adminRuntime?.session?.user?.id||''))
      toast(String(e?.message||'Não foi possível abrir o documento.'));
  }
}
function adminOwnerPayoutProofsSection(){
  const role=String(adminCurrentRole());
  if(!['superadmin','finance'].includes(role))return '';
  const actor=String(adminRuntime?.session?.user?.id||'');
  const d=adminOwnerPayoutProofState?.loadedFor===actor?adminOwnerPayoutProofState:null;
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  const current=d&&(!month||d.month.slice(0,7)===month);
  const entries=(current?d.rows:[]).map(x=>
    '<article class="card flat form-stack"><p class="tiny muted">Declaração: <code>'+
    esc(x.claimId)+'</code>'+(x.voided?' • retificada':'')+'</p>'+
    (x.attached?
      '<p><strong>Comprovante arquivado</strong> • '+esc(x.mimeType)+
      ' • '+Number(x.sizeBytes)+' bytes</p>'+
      '<p class="tiny muted">SHA-256: <code>'+esc(x.sha256)+'</code></p>'+
      '<button type="button" class="secondary small" onclick="adminOwnerPayoutProofVerifyFromUi(\''+
      esc(x.claimId)+'\')">Reverificar integridade</button>'+
      '<button type="button" class="secondary small" onclick="adminOwnerPayoutProofViewFromUi(\''+
      esc(x.claimId)+'\')">Consultar arquivo privado</button>':
      x.voided?'<p class="tiny muted">Declaração retificada, sem anexo.</p>':
      role==='superadmin'?
      '<input id="owner-payout-proof-file-'+esc(x.claimId)+'" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg">'+
      '<button type="button" class="secondary small" onclick="adminOwnerPayoutProofUploadFromUi(\''+
      esc(x.claimId)+'\')" '+(adminOwnerPayoutProofBusy?'disabled':'')+
      '>Anexar comprovante</button>':
      '<p class="tiny muted">Sem comprovante vinculado.</p>')+'</article>').join('');
  return '<div class="card flat form-stack"><h4>Arquivos privados dos repasses declarados</h4>'+
    '<p>Anexe um PDF, PNG ou JPEG de até 3 MB. O servidor confere conteúdo, tamanho e SHA-256. Nenhuma confirmação bancária é presumida.</p>'+
    '<button type="button" class="secondary small" onclick="adminOwnerPayoutProofsLoadFromUi()" '+
    (adminOwnerPayoutProofBusy?'disabled':'')+'>Consultar comprovantes da competência</button>'+
    (current?'<p class="tiny muted">'+Number(d.withProof)+' de '+Number(d.totalClaims)+
      ' declarações com documento • '+Number(d.withoutProof)+' sem documento'+
      (d.truncated?' • últimas 30 exibidas':'')+'.</p>'+
      '<div class="grid cards-2">'+(entries||
        '<p class="tiny muted">Nenhum repasse declarado na competência.</p>')+'</div>':
      '<p class="tiny muted">Consulte a competência para localizar os anexos.</p>')+
    '<p class="tiny muted">Arquivo íntegro não comprova autenticação do documento, repasse concluído, nem crédito na conta do beneficiário. A confirmação por PSP ou banco exige integração e conciliação própria.</p></div>';
}

// TAMÃO V1.263 — declared external referral payouts, never bank-confirmed.
let adminOwnerPayoutState=null,adminOwnerPayoutBusy=false;
async function adminOwnerPayoutReadFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||''),role=String(adminCurrentRole());
  if(!actor||!['superadmin','finance'].includes(role)||adminOwnerPayoutBusy)return;
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return toast('Selecione uma competência válida.');
  adminOwnerPayoutBusy=true;render();
  try{
    const d=await adminInvoke({action:'owner-benefit-payout-read',month:month?month+'-01':''});
    const m=d?.metrics;
    const keys=['totalClaims','activeClaims','voidedClaims','reportedActiveCents',
      'reportedEligibleNowCents','reportedNowIneligibleCents','reportedVoidedCents',
      'activeWithoutProofFingerprint'];
    if(d?.source!=='admin_owner_referral_payout_claims_v1_263'||
       d?.timezone!=='America/Sao_Paulo'||
       d?.reportedByOwnerOnly!==true||d?.providerSettlementConfirmed!==false||
       d?.reportMetricMeaning!=='owner_reported_external_claims_not_bank_verified'||
       d?.externalPaidBenefitsCents!==null||d?.externalPayoutMeasured!==false||
       d?.bankSettlementVerified!==false||d?.profitMeasured!==false||
       d?.roiMeasured!==false||d?.readOnly!==true||d?.noTransfers!==true||
       d?.newBenefitsEnabled!==false||
       !/^\d{4}-\d{2}-01$/.test(String(d?.month||''))||
       (month&&d.month!==month+'-01')||
       !m||keys.some(k=>!Number.isSafeInteger(m[k])||m[k]<0)||
       m.totalClaims!==m.activeClaims+m.voidedClaims||
       m.reportedActiveCents!==m.reportedEligibleNowCents+m.reportedNowIneligibleCents||
       m.activeWithoutProofFingerprint>m.activeClaims||
       !Number.isSafeInteger(d.totalRecords)||d.totalRecords<0||
       d.totalRecords!==m.totalClaims||d.limit!==30||
       d.truncated!==(d.totalRecords>30)||
       !Array.isArray(d.rows)||d.rows.length>30||d.rows.length>d.totalRecords||
       d.rows.some(x=>!x||!/^[0-9a-f-]{36}$/i.test(String(x.claimId||''))||
         !/^[0-9a-f-]{36}$/i.test(String(x.orderId||''))||
         !Number.isSafeInteger(x.amountCents)||x.amountCents<1||
         !['pix','bank_transfer','mercado_pago','other'].includes(x.provider)||
         typeof x.referenceMasked!=='string'||
         !/^[A-Za-z0-9._:/-]{4}…[A-Za-z0-9._:/-]{4}$/.test(x.referenceMasked)||
         !/^\d{4}-\d{2}-\d{2}$/.test(String(x.paidOn||''))||
         typeof x.proofFingerprintPresent!=='boolean'||
         typeof x.voided!=='boolean'||typeof x.eligibleNow!=='boolean'))
      throw new Error('Relatório de repasses não validado.');
    if(actor===String(adminRuntime?.session?.user?.id||'')&&role===String(adminCurrentRole()))
      adminOwnerPayoutState={...d,loadedFor:actor};
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerPayoutState=null;
      toast(String(e?.message||'Falha ao consultar repasses declarados.'));
    }
  }finally{adminOwnerPayoutBusy=false;render();}
}
async function adminOwnerPayoutRecordFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  if(!actor||String(adminCurrentRole())!=='superadmin'||adminOwnerPayoutBusy)return;
  const val=id=>String(document.getElementById(id)?.value||'').trim();
  const orderId=val('owner-payout-order'),money=val('owner-payout-amount');
  const provider=val('owner-payout-provider'),reference=val('owner-payout-reference');
  const paidOn=val('owner-payout-date'),proofSha256=val('owner-payout-sha').toLowerCase();
  const centsMatch=money.match(/^(\d{1,7})(?:[,.](\d{1,2}))?$/);
  const amountCents=centsMatch?
    Number(centsMatch[1])*100+Number((centsMatch[2]||'').padEnd(2,'0')):NaN;
  if(!/^[0-9a-f-]{36}$/i.test(orderId)||!Number.isSafeInteger(amountCents)||
     amountCents<1||amountCents>100000000||
     !['pix','bank_transfer','mercado_pago','other'].includes(provider)||
     !/^[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$/.test(reference)||
     !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)||
     (proofSha256&&!/^[0-9a-f]{64}$/.test(proofSha256)))
    return toast('Confira o ID do pedido, valor, data, referência e SHA-256 opcional.');
  adminOwnerPayoutBusy=true;render();
  try{
    const d=await adminInvoke({action:'owner-benefit-payout-record',
      orderId,amountCents,provider,reference,paidOn,proofSha256});
    if(d?.source!=='admin_owner_referral_payout_claim_v1_263'||
       !/^[0-9a-f-]{36}$/i.test(String(d.claimId||''))||
       typeof d.alreadyRecorded!=='boolean'||d.bankVerified!==false||
       d.transferExecuted!==false)
      throw new Error('Registro não validado.');
    toast(d.alreadyRecorded?'Registro já constava na conciliação.':
      'Declaração registrada. Ainda não existe confirmação bancária.');
    adminOwnerPayoutState=null;
  }catch(e){toast(String(e?.message||'Não foi possível registrar a declaração.'));}
  finally{adminOwnerPayoutBusy=false;render();}
}
async function adminOwnerPayoutVoidFromUi(claimId){
  const actor=String(adminRuntime?.session?.user?.id||'');
  if(!actor||String(adminCurrentRole())!=='superadmin'||adminOwnerPayoutBusy||
     !/^[0-9a-f-]{36}$/i.test(String(claimId||'')))return;
  const reason=String(window.prompt('Informe a justificativa para retificar esta declaração (12 a 300 caracteres):')||'').trim();
  if(reason.length<12||reason.length>300)return;
  adminOwnerPayoutBusy=true;render();
  try{
    const d=await adminInvoke({action:'owner-benefit-payout-void',claimId,reason});
    if(d?.source!=='admin_owner_referral_payout_void_v1_263'||
       d.claimId!==claimId||typeof d.alreadyVoided!=='boolean'||
       d.transferExecuted!==false)throw new Error('Retificação não validada.');
    toast('Declaração retificada; o histórico de auditoria foi preservado.');
    adminOwnerPayoutState=null;
  }catch(e){toast(String(e?.message||'Retificação não registrada.'));}
  finally{adminOwnerPayoutBusy=false;render();}
}
function adminOwnerPayoutEvidenceSection(){
  if(!['superadmin','finance'].includes(String(adminCurrentRole())))return '';
  const owner=String(adminCurrentRole())==='superadmin';
  const actor=String(adminRuntime?.session?.user?.id||'');
  const d=adminOwnerPayoutState?.loadedFor===actor?adminOwnerPayoutState:null;
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  const valid=d&&(!month||d.month.slice(0,7)===month),m=valid?d.metrics:null;
  const rows=(valid?d.rows:[]).map(x=>
    '<article class="card flat form-stack"><p class="tiny muted">'+
    esc(x.paidOn)+' • '+esc(x.provider)+' • '+esc(x.referenceMasked)+'</p>'+
    '<p><strong>'+adminMoney(x.amountCents)+'</strong> — '+
    (x.voided?'Declaração retificada':x.eligibleNow?
      'Declaração ativa com comissão elegível':'Declaração ativa com comissão atualmente inelegível')+'</p>'+
    '<p class="tiny muted">Pedido: <code>'+esc(x.orderId)+'</code> • Identificador da declaração: '+
    esc(x.claimId)+' • impressão digital de comprovante: '+
    (x.proofFingerprintPresent?'informada':'não informada')+'</p>'+
    (owner&&!x.voided?
      '<button type="button" class="secondary small" onclick="adminOwnerPayoutVoidFromUi(\''+
      esc(x.claimId)+'\')" '+(adminOwnerPayoutBusy?'disabled':'')+
      '>Retificar declaração</button>':'')+'</article>').join('');
  const form=owner?'<div class="card flat form-stack">'+
    '<h5>Registrar declaração de repasse externo</h5>'+
    '<p class="tiny muted">Somente com comissão de indicação já liberada. Não executa Pix, não altera carteira e não comprova confirmação do PSP.</p>'+
    '<label>Identificador do pedido original</label><input id="owner-payout-order" placeholder="UUID do pedido" autocomplete="off">'+
    '<label>Valor em reais (igual à comissão liberada)</label><input id="owner-payout-amount" placeholder="Ex.: 15,00" inputmode="decimal" autocomplete="off">'+
    '<label>Origem informada do repasse</label><select id="owner-payout-provider">'+
    '<option value="pix">Pix</option><option value="bank_transfer">Transferência bancária</option>'+
    '<option value="mercado_pago">Mercado Pago</option><option value="other">Outro</option></select>'+
    '<label>Referência da transação</label><input id="owner-payout-reference" placeholder="Referência ou ID da transferência" autocomplete="off">'+
    '<label>Data informada da transferência</label><input id="owner-payout-date" type="date">'+
    '<label>SHA-256 do comprovante (opcional)</label><input id="owner-payout-sha" placeholder="64 caracteres, se houver arquivo verificado" autocomplete="off">'+
    '<button type="button" onclick="adminOwnerPayoutRecordFromUi()" '+
    (adminOwnerPayoutBusy?'disabled':'')+'>Registrar declaração (sem movimentar dinheiro)</button></div>':'';
  return '<div class="card flat form-stack"><h4>Comprovantes declarados de repasses externos</h4>'+
    '<p>Controle de declarações do administrador vinculadas a comissões elegíveis; não são liquidações confirmadas pelo banco.</p>'+
    '<button type="button" class="secondary small" onclick="adminOwnerPayoutReadFromUi()" '+
    (adminOwnerPayoutBusy?'disabled':'')+'>Consultar declarações da competência</button>'+
    (valid?'<div class="merchant-kpis">'+
      '<div class="kpi"><span class="label">Repasses informados, ativos</span><strong>'+
      adminMoney(m.reportedActiveCents)+'</strong></div>'+
      '<div class="kpi"><span class="label">Desses, com comissão atualmente elegível</span><strong>'+
      adminMoney(m.reportedEligibleNowCents)+'</strong></div>'+
      '<div class="kpi"><span class="label">Declarações com elegibilidade divergente</span><strong>'+
      adminMoney(m.reportedNowIneligibleCents)+'</strong></div>'+
      '<div class="kpi"><span class="label">Declarações retificadas</span><strong>'+
      adminMoney(m.reportedVoidedCents)+'</strong></div></div>'+
      '<p class="tiny muted">'+Number(m.totalClaims)+' declarações • '+
      Number(m.activeClaims)+' ativas • '+Number(m.voidedClaims)+
      ' retificadas • '+Number(m.activeWithoutProofFingerprint)+
      ' ativas sem impressão digital de comprovante.'+
      (d.truncated?' Apenas as últimas 30 são exibidas.':'')+'</p>'+
      '<div class="grid cards-2">'+(rows||'<p class="tiny muted">Nenhum repasse informado nesta competência.</p>')+
      '</div>':'<p class="tiny muted">Selecione a competência para consultar as declarações.</p>')+
    form+
    '<p class="tiny muted">A declaração de transferência não é confirmação independente: valores pagos externamente continuam não mensurados sem conciliação com PSP ou extrato bancário. Não confundir com créditos ou comissões na carteira. Nunca realiza saque, Pix ou estorno.</p>'+
    '</div>';
}

// V1.262: authorized referral commission history; internal movements ≠ payouts.
let adminOwnerReferralTraceState=null,adminOwnerReferralTraceBusy=false;
async function adminOwnerReferralTraceLoadFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||''),role=String(adminCurrentRole());
  if(!actor||!['superadmin','finance'].includes(role)||adminOwnerReferralTraceBusy)return;
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return toast('Selecione uma competência válida.');
  adminOwnerReferralTraceBusy=true;render();
  try{
    const d=await adminInvoke({action:'owner-referral-lifecycle',month:month?month+'-01':''});
    const nn=(x,keys)=>x&&keys.every(k=>Number.isSafeInteger(x[k])&&x[k]>=0);
    const c=d?.cohort,f=d?.walletEventFlows;
    if(d?.source!=='admin_owner_referral_lifecycle_v1_262'||
      d?.timezone!=='America/Sao_Paulo'||d?.readOnly!==true||
      d?.noTransfers!==true||d?.newBenefitsEnabled!==false||
      d?.issuerOrderTraceAvailable!==true||
      d?.pendingReleaseIsAmbiguousWithoutGrantState!==true||
      d?.cohortStagesCurrentNotHistorical!==true||
      d?.walletFlowsAreCashPayments!==false||d?.externalPaidReferralCents!==null||
      d?.externalPayoutMeasured!==false||d?.campaignAttributionIsCausal!==false||
      d?.bankSettlementVerified!==false||d?.profitMeasured!==false||d?.roiMeasured!==false||
      !/^\d{4}-\d{2}-01$/.test(String(d?.month||''))||(month&&d.month!==month+'-01')||
      !nn(c,['grantOrders','issuedCents','verifiedLifecycleCents','unverifiedLifecycleCents',
        'verifiedOrders','unverifiedOrders','pendingCents','availableCents',
        'verifiedAvailableCents','reversedBeforeMaturityCents','reversedAfterMaturityCents',
        'pendingOrders','availableOrders','reversedBeforeMaturityOrders',
        'reversedAfterMaturityOrders'])||
      !nn(f,['totalEvents','pendingCreatedCents','pendingReleasedCents',
        'availableCreatedCents','availableReversedCents','eventsWithoutValidGrant'])||
      c.issuedCents!==c.verifiedLifecycleCents+c.unverifiedLifecycleCents||
      c.grantOrders!==c.verifiedOrders+c.unverifiedOrders||
      c.issuedCents!==c.pendingCents+c.availableCents+
        c.reversedBeforeMaturityCents+c.reversedAfterMaturityCents||
      c.grantOrders!==c.pendingOrders+c.availableOrders+
        c.reversedBeforeMaturityOrders+c.reversedAfterMaturityOrders||
      c.verifiedAvailableCents>c.availableCents||f.eventsWithoutValidGrant>f.totalEvents||
      !Number.isSafeInteger(d.totalCampaigns)||d.totalCampaigns<0||
      d.limit!==50||d.truncated!==(d.totalCampaigns>50)||
      !Array.isArray(d.rows)||d.rows.length>50||d.rows.length>d.totalCampaigns||
      d.rows.some(x=>!x||!/^[0-9a-f-]{36}$/i.test(String(x.allocationId||''))||
        !['customer_cashback','customer_referral','merchant_referral','clube_coupons']
         .some(k=>typeof x.campaignTag==='string'&&x.campaignTag.startsWith(
           'tam-'+k+'-'+d.month.slice(0,4)+d.month.slice(5,7)+'-'))||
        typeof x.campaignLabel!=='string'||x.campaignLabel.length>180||
        !nn(x,['referralGrantOrders','referralIssuedCents','referralPendingCents',
          'referralAvailableCents','referralReversedCents'])||
        x.referralIssuedCents!==x.referralPendingCents+
          x.referralAvailableCents+x.referralReversedCents))
      throw new Error('Conciliação de indicações não validada.');
    if(actor===String(adminRuntime?.session?.user?.id||'')&&role===String(adminCurrentRole()))
      adminOwnerReferralTraceState={...d,loadedFor:actor};
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerReferralTraceState=null;
      toast(String(e?.message||'Falha ao conciliar as indicações.'));
    }
  }finally{adminOwnerReferralTraceBusy=false;render();}
}
function adminOwnerReferralLifecycleSection(){
  if(!['superadmin','finance'].includes(String(adminCurrentRole())))return '';
  const actor=String(adminRuntime?.session?.user?.id||'');
  const d=adminOwnerReferralTraceState?.loadedFor===actor?adminOwnerReferralTraceState:null;
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  const valid=d&&(!month||d.month.slice(0,7)===month);
  const c=valid?d.cohort:null,f=valid?d.walletEventFlows:null;
  const entries=(valid?d.rows:[]).map(x=>'<article class="card flat form-stack">'+
    '<h5>'+esc(x.campaignLabel)+'</h5><p class="tiny muted">'+esc(x.campaignTag)+'</p>'+
    '<p>Concedidas: <strong>'+adminMoney(x.referralIssuedCents)+'</strong> • pendentes: '+
    adminMoney(x.referralPendingCents)+' • disponíveis internamente: '+
    adminMoney(x.referralAvailableCents)+' • revertidas: '+adminMoney(x.referralReversedCents)+
    '</p><p class="tiny muted">'+Number(x.referralGrantOrders)+' pedido(s) associado(s)</p></article>').join('');
  return '<div class="card flat form-stack"><h4>Conciliação das comissões de indicação</h4>'+
    '<p>Rastreia concessões por pedido, liberação, reversões e lançamentos divergentes.</p>'+
    '<button class="secondary small" type="button" onclick="adminOwnerReferralTraceLoadFromUi()" '+
    (adminOwnerReferralTraceBusy?'disabled':'')+'>Conciliar indicações da competência</button>'+
    (valid?'<div class="merchant-kpis">'+
      '<div class="kpi"><span class="label">Concedidas</span><strong>'+adminMoney(c.issuedCents)+'</strong></div>'+
      '<div class="kpi"><span class="label">Ciclo conciliado</span><strong>'+adminMoney(c.verifiedLifecycleCents)+'</strong></div>'+
      '<div class="kpi"><span class="label">Disponível internamente e conferido</span><strong>'+adminMoney(c.verifiedAvailableCents)+'</strong></div>'+
      '<div class="kpi"><span class="label">Com divergência</span><strong>'+adminMoney(c.unverifiedLifecycleCents)+'</strong></div></div>'+
      '<p class="tiny muted">Situação atual das concessões do mês: pendentes '+
      adminMoney(c.pendingCents)+' • disponíveis '+adminMoney(c.availableCents)+
      ' • revertidas antes da maturação '+adminMoney(c.reversedBeforeMaturityCents)+
      ' • revertidas depois '+adminMoney(c.reversedAfterMaturityCents)+'.</p>'+
      '<p class="tiny muted">Eventos de carteira no mês: criadas '+adminMoney(f.pendingCreatedCents)+
      ' • baixadas '+adminMoney(f.pendingReleasedCents)+
      ' • disponibilizadas '+adminMoney(f.availableCreatedCents)+
      ' • revertidas '+adminMoney(f.availableReversedCents)+
      '. Eventos sem concessão válida: '+Number(f.eventsWithoutValidGrant)+'.</p>'+
      '<p class="tiny muted">'+Number(c.verifiedOrders)+' pedidos conferidos, '+
      Number(c.unverifiedOrders)+' com divergência • '+Number(d.totalCampaigns)+
      ' campanhas '+(d.truncated?'(50 exibidas)':'')+'.</p>'+
      '<div class="grid cards-2">'+(entries||
        '<p class="tiny muted">Sem campanhas vinculadas nesta competência.</p>')+'</div>':
      '<p class="tiny muted">Selecione a competência para consultar os registros reais.</p>')+
    '<p class="tiny muted">Comissões disponíveis são saldo interno, não saque ou pagamento externo. A situação das concessões é atual, embora agrupada pelo mês de origem; movimentações no mês são outra dimensão e não devem ser somadas como novo custo. Sem comprovantes de PSP ou banco, pagamentos e lucro permanecem não mensurados.</p></div>';
}

// TAMÃO V1.261 — audit the new origin lots without affecting native wallet.
let adminOwnerSourceLotsState=null;
let adminOwnerSourceLotsBusy=false;
async function adminOwnerSourceLotsLoadFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  const role=String(adminCurrentRole());
  if(!actor||!['superadmin','finance'].includes(role)||adminOwnerSourceLotsBusy)return;
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return toast('Selecione uma competência válida.');
  adminOwnerSourceLotsBusy=true;render();
  try{
    const d=await adminInvoke({action:'owner-cashback-source-lots',month:month?month+'-01':''});
    const nonneg=(x,fields)=>x&&fields.every(k=>Number.isSafeInteger(x[k])&&x[k]>=0);
    const ev=d?.events,l=d?.issuance,u=d?.settledUse;
    if(d?.source!=='admin_owner_cashback_source_lots_v1_261'||
      d?.timezone!=='America/Sao_Paulo'||
      d?.captureMode!=='forward_only_after_wallet_insert'||
      d?.lotAllocationMethod!=='fifo_bookkeeping_convention'||
      d?.walletIsAuthoritative!==true||d?.legacyBackfillPerformed!==false||
      d?.readOnly!==true||d?.noTransfers!==true||d?.newBenefitsEnabled!==false||
      d?.externalPaidBenefitsCents!==null||d?.externalPayoutMeasured!==false||
      d?.bankSettlementVerified!==false||d?.profitMeasured!==false||
      d?.roiMeasured!==false||
      !/^\d{4}-\d{2}-01$/.test(String(d?.month||''))||
      (month&&d.month!==month+'-01')||
      !nonneg(ev,['walletEntries','capturedEntries','untrackedEntries',
        'partialEntries','matchedCents','unmatchedCents'])||
      ev.walletEntries!==ev.capturedEntries+ev.untrackedEntries||
      ev.partialEntries>ev.capturedEntries||
      !nonneg(l,['newLots','issuedCents','remainingCents',
        'seedIssuedCents','earnedIssuedCents'])||
      l.issuedCents!==l.seedIssuedCents+l.earnedIssuedCents||
      l.remainingCents>l.issuedCents||
      !nonneg(u,['settledAssignedCents','settledPartiallyAssignedCents',
        'settledUnassignedCents','fullyAssignedOrders','partiallyAssignedOrders'])||
      !Number.isSafeInteger(d.totalCampaigns)||d.totalCampaigns<0||
      d.limit!==50||d.truncated!==(d.totalCampaigns>50)||
      !Array.isArray(d.rows)||d.rows.length>50||d.rows.length>d.totalCampaigns||
      d.rows.some(x=>!x||!/^[0-9a-f-]{36}$/i.test(String(x.allocationId||''))||
        !['customer_cashback','customer_referral','merchant_referral','clube_coupons']
        .some(k=>typeof x.campaignTag==='string'&&x.campaignTag.startsWith(
          'tam-'+k+'-'+d.month.slice(0,4)+d.month.slice(5,7)+'-'))||
        typeof x.campaignLabel!=='string'||x.campaignLabel.length>180||
        !nonneg(x,['earnedIssuedCents','earnedRemainingCents'])||
        x.earnedRemainingCents>x.earnedIssuedCents))
      throw new Error('Rastreabilidade de créditos não validada.');
    if(actor===String(adminRuntime?.session?.user?.id||'')&&role===String(adminCurrentRole()))
      adminOwnerSourceLotsState={...d,loadedFor:actor};
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerSourceLotsState=null;
      toast(String(e?.message||'Não foi possível consultar as origens de créditos.'));
    }
  }finally{adminOwnerSourceLotsBusy=false;render();}
}
function adminOwnerCashbackSourceLotsSection(){
  if(!['superadmin','finance'].includes(String(adminCurrentRole())))return '';
  const actor=String(adminRuntime?.session?.user?.id||'');
  const d=adminOwnerSourceLotsState?.loadedFor===actor?adminOwnerSourceLotsState:null;
  const selected=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  const matching=d&&(!selected||d.month.slice(0,7)===selected);
  const ev=matching?d.events:null,l=matching?d.issuance:null,u=matching?d.settledUse:null;
  const campaignCards=(matching?d.rows:[]).map(x=>
    '<article class="card flat form-stack">'+
    '<h5>'+esc(x.campaignLabel)+'</h5>'+
    '<p class="tiny muted">'+esc(x.campaignTag)+'</p>'+
    '<p>Cashback emitido com esta origem: <strong>'+
    adminMoney(x.earnedIssuedCents)+'</strong></p>'+
    '<p>Parcela desses lotes ainda disponível na escrituração: '+
    adminMoney(x.earnedRemainingCents)+'</p></article>').join('');
  return '<div class="card flat form-stack">'+
    '<div class="section-head"><div><h4>Origem dos novos créditos de cashback</h4>'+
    '<p>Acompanha os lotes emitidos e a associação de reservas por FIFO contábil, sem modificar a carteira oficial.</p>'+
    '</div></div>'+
    '<button type="button" class="secondary small" onclick="adminOwnerSourceLotsLoadFromUi()" '+
    (adminOwnerSourceLotsBusy?'disabled':'')+'>Consultar rastreabilidade da competência</button>'+
    (matching?'<div class="merchant-kpis">'+
      '<div class="kpi"><span class="label">Créditos emitidos em novos lotes</span><strong>'+
      adminMoney(l.issuedCents)+'</strong></div>'+
      '<div class="kpi"><span class="label">Saldo contábil atual desses lotes</span><strong>'+
      adminMoney(l.remainingCents)+'</strong></div>'+
      '<div class="kpi"><span class="label">Reservas vinculadas e pedidos liquidados</span><strong>'+
      adminMoney(u.settledAssignedCents)+'</strong></div>'+
      '<div class="kpi"><span class="label">Crédito sem vínculo completo nos pedidos liquidados</span><strong>'+
      adminMoney(u.settledUnassignedCents)+'</strong></div>'+
      '</div>'+
      '<p class="tiny muted">'+Number(l.newLots)+' lote(s) • '+
      Number(ev.walletEntries)+' evento(s) de cashback no mês • '+
      Number(ev.untrackedEntries)+' sem captura • '+
      Number(ev.partialEntries)+' incompleto(s). Emissões: promocionais '+
      adminMoney(l.seedIssuedCents)+' e recompensas '+adminMoney(l.earnedIssuedCents)+
      '. Total em eventos parcialmente vinculados: '+adminMoney(ev.unmatchedCents)+'.</p>'+
      '<p class="tiny muted">Reservas parcialmente associadas em pedidos liquidados: '+
      adminMoney(u.settledPartiallyAssignedCents)+
      '. Pedidos com reserva integralmente vinculada: '+Number(u.fullyAssignedOrders)+
      ' • parcialmente vinculada: '+Number(u.partiallyAssignedOrders)+'.</p>'+
      '<div class="grid cards-2">'+
      (campaignCards||'<p class="tiny muted">Nenhum lote de cashback vinculado a campanhas desta competência.</p>')+
      '</div>':
      '<p class="tiny muted">Consulte a competência para ver os dados reais de origem e consumo.</p>')+
    '<p class="tiny muted">FIFO é uma convenção de escrituração de saldo fungível, não identificação bancária do dinheiro. Saldo atual dos lotes não é saldo disponível da carteira e não representa pagamento. Eventos antigos não são preenchidos retroativamente; falhas de captura ficam visíveis. Nenhuma movimentação ou ativação é executada nesta consulta.</p>'+
    '</div>';
}

// TAMÃO V1.260 — compare grant events and applied wallet reservations by order.
let adminOwnerWalletReconState=null;
let adminOwnerWalletReconBusy=false;
async function adminOwnerWalletReconLoadFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  const role=String(adminCurrentRole());
  if(!actor||!['superadmin','finance'].includes(role)||adminOwnerWalletReconBusy)return;
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return toast('Selecione uma competência válida.');
  adminOwnerWalletReconBusy=true;render();
  try{
    const d=await adminInvoke({action:'owner-wallet-reconciliation',month:month?month+'-01':''});
    const g=d?.grantCohort,u=d?.settledUse,f=d?.walletEventFlows;
    const nonneg=(v,fields)=>v&&fields.every(k=>Number.isSafeInteger(v[k])&&v[k]>=0);
    if(d?.source!=='admin_owner_wallet_reconciliation_v1_260'||
       d?.timezone!=='America/Sao_Paulo'||d?.readOnly!==true||
       d?.noTransfers!==true||d?.newBenefitsEnabled!==false||
       d?.spentCreditLotAttribution!=='unavailable_fungible_wallet'||
       d?.settledOrderMatchBasis!=='wallet_reservation_and_unreversed_settlement'||
       d?.walletFlowsAreCashPayments!==false||d?.externalPaidBenefitsCents!==null||
       d?.externalPayoutMeasured!==false||d?.campaignAttributionIsCausal!==false||
       d?.bankSettlementVerified!==false||d?.profitMeasured!==false||
       d?.roiMeasured!==false||!/^\d{4}-\d{2}-01$/.test(String(d?.month||''))||
       (month&&d.month!==month+'-01')||
       !Number.isSafeInteger(d.totalCampaigns)||d.totalCampaigns<0||
       d.limit!==50||d.truncated!==(d.totalCampaigns>50)||
       !Array.isArray(d.rows)||d.rows.length>50||d.rows.length>d.totalCampaigns||
       !nonneg(g,['grantOrders','cashbackExpectedCents','cashbackMatchedCents',
         'cashbackUnmatchedCents','referralExpectedCents','referralMatchedCents',
         'referralUnmatchedCents','cashbackMismatchOrders','referralMismatchOrders'])||
       !nonneg(u,['settledOrdersWithCashback','reservedInSettledOrdersCents',
         'verifiedUseCents','unverifiedUseCents','verifiedOrders','unverifiedOrders'])||
       !nonneg(f,['seedIssuedCents','cashbackEarnedEntriesCents',
         'cashbackReservedEntriesCents','cashbackReleasedEntriesCents',
         'cashbackReversedEntriesCents','referralPendingEntriesCents',
         'referralPendingReleasedEntriesCents','referralAvailableEntriesCents',
         'referralReversedEntriesCents'])||
       g.cashbackExpectedCents!==g.cashbackMatchedCents+g.cashbackUnmatchedCents||
       g.referralExpectedCents!==g.referralMatchedCents+g.referralUnmatchedCents||
       g.cashbackMismatchOrders>g.grantOrders||g.referralMismatchOrders>g.grantOrders||
       u.reservedInSettledOrdersCents!==u.verifiedUseCents+u.unverifiedUseCents||
       u.settledOrdersWithCashback!==u.verifiedOrders+u.unverifiedOrders||
       d.rows.some(x=>!x||!/^[0-9a-f-]{36}$/i.test(String(x.allocationId||''))||
         !['customer_cashback','customer_referral','merchant_referral','clube_coupons']
         .some(k=>typeof x.campaignTag==='string'&&x.campaignTag.startsWith(
           'tam-'+k+'-'+d.month.slice(0,4)+d.month.slice(5,7)+'-'))||
         typeof x.campaignLabel!=='string'||x.campaignLabel.length>180||
         !nonneg(x,['tracedGrantOrders','matchedCashbackIssueCents',
           'unmatchedCashbackIssueCents','matchedReferralIssueCents',
           'unmatchedReferralIssueCents','mismatchOrders'])||
         x.mismatchOrders>x.tracedGrantOrders))
      throw new Error('Conciliação de carteira não validada.');
    if(actor===String(adminRuntime?.session?.user?.id||'')&&role===String(adminCurrentRole()))
      adminOwnerWalletReconState={...d,loadedFor:actor};
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerWalletReconState=null;
      toast(String(e?.message||'Falha ao conciliar os benefícios.'));
    }
  }finally{adminOwnerWalletReconBusy=false;render();}
}
function adminOwnerWalletReconciliationSection(){
  if(!['superadmin','finance'].includes(String(adminCurrentRole())))return '';
  const actor=String(adminRuntime?.session?.user?.id||'');
  const d=adminOwnerWalletReconState?.loadedFor===actor?adminOwnerWalletReconState:null;
  const selected=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  const matching=d&&(!selected||d.month.slice(0,7)===selected);
  const g=matching?d.grantCohort:null,u=matching?d.settledUse:null,f=matching?d.walletEventFlows:null;
  const cards=matching?d.rows.map(x=>
    '<article class="card flat form-stack"><h5>'+esc(x.campaignLabel)+'</h5>'+
    '<p class="tiny muted">'+esc(x.campaignTag)+' • '+Number(x.tracedGrantOrders)+
    ' concessões ligadas por pedido • '+Number(x.mismatchOrders)+' divergência(s)</p>'+
    '<p>Cashback com lançamento correspondente: <strong>'+
    adminMoney(x.matchedCashbackIssueCents)+'</strong> • sem correspondência: '+
    adminMoney(x.unmatchedCashbackIssueCents)+'</p>'+
    '<p>Indicações com lançamento correspondente: <strong>'+
    adminMoney(x.matchedReferralIssueCents)+'</strong> • sem correspondência: '+
    adminMoney(x.unmatchedReferralIssueCents)+'</p>'+
    '</article>').join(''):'';
  return '<div class="card flat form-stack"><div class="section-head"><div>'+
    '<h4>Conciliação das recompensas e carteira</h4>'+
    '<p>Rastreia o pedido de origem da recompensa e verifica se o cashback reservado foi aplicado em um pedido liquidado.</p></div></div>'+
    '<button type="button" class="secondary small" onclick="adminOwnerWalletReconLoadFromUi()" '+
    (adminOwnerWalletReconBusy?'disabled':'')+'>Conciliar registros da competência</button>'+
    (matching?'<div class="merchant-kpis">'+
    '<div class="kpi"><span class="label">Cashback concedido com lançamento correspondente</span><strong>'+
    adminMoney(g.cashbackMatchedCents)+'</strong></div>'+
    '<div class="kpi"><span class="label">Indicações com lançamento correspondente</span><strong>'+
    adminMoney(g.referralMatchedCents)+'</strong></div>'+
    '<div class="kpi"><span class="label">Cashback utilizado em pedidos com conciliação válida</span><strong>'+
    adminMoney(u.verifiedUseCents)+'</strong></div>'+
    '<div class="kpi"><span class="label">Uso sem conciliação suficiente</span><strong>'+
    adminMoney(u.unverifiedUseCents)+'</strong></div></div>'+
    '<p class="tiny muted">Total de '+Number(g.grantOrders)+' pedido(s) com concessão. Divergências: '+
    Number(g.cashbackMismatchOrders)+' no cashback e '+
    Number(g.referralMismatchOrders)+' nas indicações. Concessões sem lançamento: '+
    adminMoney(g.cashbackUnmatchedCents+g.referralUnmatchedCents)+'. Pedidos com uso não conciliado: '+
    Number(u.unverifiedOrders)+'.</p>'+
    '<p class="tiny muted">Movimentos internos da competência: crédito inicial '+
    adminMoney(f.seedIssuedCents)+' • cashback ganho '+adminMoney(f.cashbackEarnedEntriesCents)+
    ' • reservas '+adminMoney(f.cashbackReservedEntriesCents)+
    ' • liberações/devoluções '+adminMoney(f.cashbackReleasedEntriesCents)+
    ' • reversões de crédito '+adminMoney(f.cashbackReversedEntriesCents)+
    ' • comissões pendentes '+adminMoney(f.referralPendingEntriesCents)+
    ' • pendências transferidas '+adminMoney(f.referralPendingReleasedEntriesCents)+
    ' • comissões disponíveis '+adminMoney(f.referralAvailableEntriesCents)+
    ' • comissões revertidas '+adminMoney(f.referralReversedEntriesCents)+'.</p>'+
    '<p class="tiny muted">Campanhas na competência: '+Number(d.totalCampaigns)+
    (d.truncated?' • somente 50 exibidas':'')+'</p>'+
    '<div class="grid cards-2">'+
    (cards||'<p class="tiny muted">Sem campanhas vinculadas a recompensas nesta competência.</p>')+
    '</div>':
    '<p class="tiny muted">Consulte a competência selecionada para conciliar somente dados registrados.</p>')+
    '<p class="tiny muted">A carteira mistura créditos antigos: a origem individual de cada centavo consumido não é identificável. Conciliação por pedido não comprova pagamentos externos, saldo bancário, ROI ou que a campanha originou a venda. Movimentos internos não devem ser somados à emissão como novo custo.</p>'+
    '</div>';
}

// TAMÃO V1.259 — benefit costs with separate grant cohort and settled-order use.
let adminOwnerBenefitsState=null;
let adminOwnerBenefitsBusy=false;
async function adminOwnerBenefitsLoadFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  const role=String(adminCurrentRole());
  if(!actor||!['superadmin','finance'].includes(role)||adminOwnerBenefitsBusy)return;
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return toast('Selecione uma competência válida.');
  adminOwnerBenefitsBusy=true;render();
  try{
    const d=await adminInvoke({action:'owner-campaign-benefit-costs',month:month?month+'-01':''});
    const money=['cashbackGrantedCents','cashbackReversedCents','cashbackNetGrantedCents',
      'referralGrantedCents','referralReversedCents','referralNetGrantedCents',
      'cashbackUsedInSettledOrdersCents','referralMovedToAvailableCents',
      'referralAvailableReversedCents'];
    if(d?.source!=='admin_owner_campaign_benefit_costs_v1_259'||
       d?.readOnly!==true||d?.noTransfers!==true||d?.newBenefitsEnabled!==false||
       d?.timezone!=='America/Sao_Paulo'||d?.benefitsUsedAreIssuanceCohort!==false||
       d?.metricMeaning!=='grant_cohort_vs_settlement_activity_non_causal'||
       d?.campaignAttributionIsCausal!==false||d?.externalPayoutMeasured!==false||
       d?.externalPaidBenefitsCents!==null||d?.merchantReferralPaidCents!==null||
       d?.clubeCouponPaidCents!==null||d?.bankSettlementVerified!==false||
       d?.profitMeasured!==false||d?.roiMeasured!==false||
       !/^\d{4}-\d{2}-01$/.test(String(d?.month||''))||
       (month&&d.month!==month+'-01')||
       !Number.isSafeInteger(d.totalCampaigns)||d.totalCampaigns<0||
       d.limit!==50||d.truncated!==(d.totalCampaigns>50)||
       !Array.isArray(d.rows)||d.rows.length>50||d.rows.length>d.totalCampaigns||
       money.some(k=>!Number.isSafeInteger(d[k])||d[k]<0)||
       d.cashbackGrantedCents!==d.cashbackReversedCents+d.cashbackNetGrantedCents||
       d.referralGrantedCents!==d.referralReversedCents+d.referralNetGrantedCents||
       d.rows.some(x=>!x||!/^[0-9a-f-]{36}$/i.test(String(x.allocationId||''))||
         !['customer_cashback','customer_referral','merchant_referral','clube_coupons'].includes(x.benefitKey)||
         typeof x.campaignTag!=='string'||!x.campaignTag.startsWith(
           'tam-'+x.benefitKey+'-'+d.month.slice(0,4)+d.month.slice(5,7)+'-')||
         typeof x.campaignLabel!=='string'||x.campaignLabel.length>180||
         !Number.isSafeInteger(x.plannedIncentiveBudgetCents)||x.plannedIncentiveBudgetCents<0||
         !Number.isSafeInteger(x.attributedGrantOrders)||x.attributedGrantOrders<0||
         ['cashbackGrantedCents','cashbackReversedCents','cashbackNetGrantedCents',
          'referralGrantedCents','referralReversedCents','referralNetGrantedCents']
          .some(k=>!Number.isSafeInteger(x[k])||x[k]<0)||
         x.cashbackGrantedCents!==x.cashbackReversedCents+x.cashbackNetGrantedCents||
         x.referralGrantedCents!==x.referralReversedCents+x.referralNetGrantedCents))
      throw new Error('Apuração dos benefícios não validada.');
    if(actor===String(adminRuntime?.session?.user?.id||'')&&role===String(adminCurrentRole()))
      adminOwnerBenefitsState={...d,loadedFor:actor};
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerBenefitsState=null;
      toast(String(e?.message||'Não foi possível consultar benefícios.'));
    }
  }finally{adminOwnerBenefitsBusy=false;render();}
}
function adminOwnerBenefitCostsSection(){
  if(!['superadmin','finance'].includes(String(adminCurrentRole())))return '';
  const actor=String(adminRuntime?.session?.user?.id||'');
  const d=adminOwnerBenefitsState?.loadedFor===actor?adminOwnerBenefitsState:null;
  const selected=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  const matching=d&&(!selected||d.month.slice(0,7)===selected);
  const cards=(matching?d.rows:[]).map(x=>
    '<article class="card flat form-stack"><h5>'+esc(x.campaignLabel)+'</h5>'+
    '<p class="tiny muted">'+esc(x.campaignTag)+' • '+Number(x.attributedGrantOrders)+
    ' pedido(s) com concessão vinculada à campanha</p>'+
    '<p>Cashback concedido: '+adminMoney(x.cashbackGrantedCents)+
    ' • revertido: '+adminMoney(x.cashbackReversedCents)+
    ' • líquido: <strong>'+adminMoney(x.cashbackNetGrantedCents)+'</strong></p>'+
    '<p>Indicações concedidas: '+adminMoney(x.referralGrantedCents)+
    ' • revertidas: '+adminMoney(x.referralReversedCents)+
    ' • líquido: <strong>'+adminMoney(x.referralNetGrantedCents)+'</strong></p>'+
    '<p class="tiny muted">Orçamento planejado (não é despesa paga): '+
    adminMoney(x.plannedIncentiveBudgetCents)+'</p></article>').join('');
  const kpis=matching?'<div class="merchant-kpis">'+
    '<div class="kpi"><span class="label">Cashback concedido (mês de emissão)</span><strong>'+
    adminMoney(d.cashbackGrantedCents)+'</strong></div>'+
    '<div class="kpi"><span class="label">Cashback revertido dessa emissão</span><strong>'+
    adminMoney(d.cashbackReversedCents)+'</strong></div>'+
    '<div class="kpi"><span class="label">Cashback líquido concedido</span><strong>'+
    adminMoney(d.cashbackNetGrantedCents)+'</strong></div>'+
    '<div class="kpi"><span class="label">Indicações líquidas concedidas</span><strong>'+
    adminMoney(d.referralNetGrantedCents)+'</strong></div>'+
    '<div class="kpi"><span class="label">Cashback reservado em pedidos liquidados (sem conciliação V1.260)</span><strong>'+
    adminMoney(d.cashbackUsedInSettledOrdersCents)+'</strong></div>'+
    '<div class="kpi"><span class="label">Comissões movidas para saldo disponível</span><strong>'+
    adminMoney(d.referralMovedToAvailableCents)+'</strong></div></div>'+
    '<p class="tiny muted">Indicações: concedido '+adminMoney(d.referralGrantedCents)+
    ', revertido '+adminMoney(d.referralReversedCents)+
    '. Reversões do saldo disponível na competência: '+
    adminMoney(d.referralAvailableReversedCents)+'.</p>':
    '<p class="tiny muted">Consulte a competência selecionada para visualizar os registros reais.</p>';
  return '<div class="card flat form-stack"><div class="section-head"><div>'+
    '<h4>Custos e movimentações de benefícios</h4>'+
    '<p>Cashback e indicações: emissão, reversão, utilização em pedidos e movimentações internas sem confundir etapas.</p>'+
    '</div></div><button type="button" class="secondary small" onclick="adminOwnerBenefitsLoadFromUi()" '+
    (adminOwnerBenefitsBusy?'disabled':'')+'>Apurar benefícios da competência</button>'+
    kpis+(matching?'<p class="tiny muted">Campanhas: '+Number(d.totalCampaigns)+
    (d.truncated?' • exibidas somente as 50 mais recentes':'')+'</p>'+
    '<div class="grid cards-2">'+
    (cards||'<p class="muted">Sem concessões atribuídas a campanhas nesta competência.</p>')+
    '</div>':'')+
    '<p class="tiny muted">Concessões são agrupadas pelo mês em que nasceram. Uso de cashback e transferência de comissão consideram operações do mês, não a mesma coorte; não some esses números. Vínculo por UTM não comprova efeito da campanha.</p>'+
    '<p class="tiny muted">Pagamento externo de benefícios: não apurado. Indicações de revendas e cupons do Clube não possuem comprovação de desembolso nesta consulta. Nenhuma transferência, ativação de benefício, lucro ou ROI é calculada.</p></div>';
}

// TAMÃO V1.257 — financial evidence consolidation, not profit or campaign ROI.
let adminOwnerBridgeState=null;
let adminOwnerBridgeBusy=false;
let adminOwnerOrphanAuditState=null;
let adminOwnerOrphanAuditBusy=false;
async function adminOwnerBridgeLoadFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  const role=String(adminCurrentRole());
  if(!actor||!['superadmin','finance'].includes(role)||adminOwnerBridgeBusy)return;
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return toast('Selecione uma competência válida.');
  adminOwnerBridgeBusy=true;render();
  try{
    const d=await adminInvoke({action:'owner-campaign-financial-summary',month:month?month+'-01':''});
    const kinds=['customer_cashback','customer_referral','merchant_referral','clube_coupons'];
    if(d?.source!=='admin_owner_campaign_financial_bridge_v1_257'||
       d?.readOnly!==true||d?.noTransfers!==true||
       d?.newBenefitsEnabled!==false||d?.cashAvailableCents!==0||
       d?.bankSettlementVerified!==false||d?.profitMeasured!==false||
       d?.roiMeasured!==false||d?.revenueAttributionIsCausal!==false||
       d?.comparisonMeaning!=='partial_difference_not_profit_not_roi'||
       d?.expenseSource!=='v1_255_owner_attested_with_v1_256_optional_document'||
       !Array.isArray(d.receiptSources)||d.receiptSources.length!==2||
       d.receiptSources[0]!=='v1_253_single_order_psp'||
       d.receiptSources[1]!=='v1_254_batch_order_psp'||
       !/^\d{4}-\d{2}-01$/.test(String(d?.month||''))||
       (month&&d.month!==month+'-01')||
       !Number.isSafeInteger(d.totalCampaigns)||d.totalCampaigns<0||
       d.limit!==50||d.truncated!==(d.totalCampaigns>50)||
       !Array.isArray(d.rows)||d.rows.length>50||d.rows.length>d.totalCampaigns||
       d.rows.some(x=>!x||!/^[0-9a-f-]{36}$/i.test(String(x.allocationId||''))||
         !kinds.some(k=>typeof x.campaignTag==='string'&&x.campaignTag.startsWith(
           'tam-'+k+'-'+d.month.slice(0,4)+d.month.slice(5,7)+'-'))||
         typeof x.campaignLabel!=='string'||x.campaignLabel.length>180||
         !['plannedIncentiveBudgetCents','soloProviderFeeCents','batchProviderFeeCents',
           'providerFeeEvidenceCents','providerFeeEvidenceOrders',
           'ownerReportedMarketingSpendCents','marketingSpendWithStoredReceiptCents',
           'marketingSpendWithoutStoredReceiptCents','activeExpenseCount','storedReceiptCount']
           .every(k=>Number.isSafeInteger(x[k])&&x[k]>=0)||
         x.providerFeeEvidenceCents!==x.soloProviderFeeCents+x.batchProviderFeeCents||
         x.marketingSpendWithStoredReceiptCents+
           x.marketingSpendWithoutStoredReceiptCents!==x.ownerReportedMarketingSpendCents||
         x.storedReceiptCount>x.activeExpenseCount||
         (x.partialEvidenceDifferenceCents===null?(
           x.providerFeeEvidenceCents>0&&x.ownerReportedMarketingSpendCents>0
         ):(
           !Number.isSafeInteger(x.partialEvidenceDifferenceCents)||
           x.partialEvidenceDifferenceCents!==
             x.providerFeeEvidenceCents-x.ownerReportedMarketingSpendCents||
           x.providerFeeEvidenceCents===0||x.ownerReportedMarketingSpendCents===0
         ))||
         x.profitMeasured!==false||x.roiMeasured!==false||
         x.bankSettlementVerified!==false))
      throw new Error('Indicadores financeiros combinados não verificados.');
    if(actor===String(adminRuntime?.session?.user?.id||'')&&role===String(adminCurrentRole()))
      adminOwnerBridgeState={...d,loadedFor:actor};
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerBridgeState=null;
      toast(String(e?.message||'Falha na consolidação financeira.'));
    }
  }finally{adminOwnerBridgeBusy=false;render();}
}
async function adminOwnerOrphanAuditLoadFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  const role=String(adminCurrentRole());
  if(!actor||!['superadmin','finance'].includes(role)||adminOwnerOrphanAuditBusy)return;
  adminOwnerOrphanAuditBusy=true;render();
  try{
    const d=await adminInvoke({action:'owner-campaign-orphan-audit'});
    if(d?.source!=='admin_owner_campaign_receipt_orphans_v1_257'||
       d?.readOnly!==true||d?.deletionPerformed!==false||
       d?.automaticDeletionEnabled!==false||d?.privateBucket!==true||
       d?.bankVerified!==false||d?.noObjectPaths!==true||d?.minAgeHours!==24||
       !['bucketObjects','linkedObjects','recentUnlinkedObjects',
         'reviewCandidatesAfter24h','unexpectedPathObjects']
         .every(k=>Number.isSafeInteger(d[k])&&d[k]>=0)||
       d.linkedObjects+d.recentUnlinkedObjects+
         d.reviewCandidatesAfter24h!==d.bucketObjects||
       d.unexpectedPathObjects>d.bucketObjects)
      throw new Error('Auditoria dos arquivos privados não validada.');
    if(actor===String(adminRuntime?.session?.user?.id||'')&&role===String(adminCurrentRole()))
      adminOwnerOrphanAuditState={...d,loadedFor:actor};
  }catch(e){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerOrphanAuditState=null;
      toast(String(e?.message||'Falha na auditoria de arquivos sem vínculo.'));
    }
  }finally{adminOwnerOrphanAuditBusy=false;render();}
}
function adminOwnerFinancialSummarySection(){
  if(!['superadmin','finance'].includes(String(adminCurrentRole())))return '';
  const actor=String(adminRuntime?.session?.user?.id||'');
  const d=adminOwnerBridgeState?.loadedFor===actor?adminOwnerBridgeState:null;
  const selected=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  const matching=d&&(!selected||d.month.slice(0,7)===selected);
  const cards=(matching?d.rows:[]).map(x=>
    '<article class="card flat form-stack">'+
    '<h4>'+esc(x.campaignLabel)+'</h4>'+
    '<p class="tiny muted">'+esc(x.campaignTag)+'</p>'+
    '<div class="merchant-kpis">'+
    '<div class="kpi"><span class="label">Taxas conciliadas no PSP (pedidos individuais + agrupados)</span><strong>'+
    adminMoney(x.providerFeeEvidenceCents)+'</strong></div>'+
    '<div class="kpi"><span class="label">Gastos de marketing declarados</span><strong>'+
    adminMoney(x.ownerReportedMarketingSpendCents)+'</strong></div>'+
    '<div class="kpi"><span class="label">Gastos com documento armazenado</span><strong>'+
    adminMoney(x.marketingSpendWithStoredReceiptCents)+'</strong></div>'+
    '<div class="kpi"><span class="label">Gastos sem arquivo vinculado</span><strong>'+
    adminMoney(x.marketingSpendWithoutStoredReceiptCents)+'</strong></div>'+
    '</div>'+
    '<p class="tiny muted">Taxas de pedidos individuais: '+adminMoney(x.soloProviderFeeCents)+
    ' • taxas de extratos agrupados: '+adminMoney(x.batchProviderFeeCents)+
    ' • pedidos com evidência PSP: '+Number(x.providerFeeEvidenceOrders).toLocaleString('pt-BR')+
    ' • documentos: '+Number(x.storedReceiptCount).toLocaleString('pt-BR')+
    ' de '+Number(x.activeExpenseCount).toLocaleString('pt-BR')+' despesas ativas.</p>'+
    '<p><strong>Diferença parcial entre valores registrados: '+
    (x.partialEvidenceDifferenceCents===null?'indisponível':adminMoney(x.partialEvidenceDifferenceCents))+
    '</strong></p>'+
    '<p class="tiny muted">Não é lucro, margem líquida, saldo bancário nem ROI. O custo de incentivos, operação e processamento não foi integrado a esta comparação; anúncios não comprovam causalidade das vendas.</p>'+
    '<p class="tiny muted">Orçamento de incentivos planejado (separado de gastos): '+
    adminMoney(x.plannedIncentiveBudgetCents)+'</p></article>'
  ).join('');
  const orphans=adminOwnerOrphanAuditState?.loadedFor===actor?adminOwnerOrphanAuditState:null;
  const orphanView=orphans?
    '<div class="merchant-kpis">'+
    '<div class="kpi"><span class="label">Arquivos privados</span><strong>'+Number(orphans.bucketObjects).toLocaleString('pt-BR')+'</strong></div>'+
    '<div class="kpi"><span class="label">Documentos vinculados</span><strong>'+Number(orphans.linkedObjects).toLocaleString('pt-BR')+'</strong></div>'+
    '<div class="kpi"><span class="label">Uploads recentes sem vínculo</span><strong>'+Number(orphans.recentUnlinkedObjects).toLocaleString('pt-BR')+'</strong></div>'+
    '<div class="kpi"><span class="label">Pendências para revisão após 24h</span><strong>'+Number(orphans.reviewCandidatesAfter24h).toLocaleString('pt-BR')+'</strong></div></div>'+
    (orphans.unexpectedPathObjects?
      '<p class="tiny muted">Há '+Number(orphans.unexpectedPathObjects).toLocaleString('pt-BR')+' objeto(s) com caminho inesperado para investigação.</p>':''):
    '<p class="tiny muted">Consulte o estado do armazenamento privado para identificar uploads abandonados.</p>';
  return '<div class="form-stack">'+
    '<div class="section-head"><div><h4>Painel financeiro consolidado por campanha</h4>'+
    '<p>Compare taxas do TAMÃO conciliadas pelo provedor com despesas declaradas e seus comprovantes, preservando a origem de cada número.</p></div></div>'+
    '<button type="button" class="secondary small" onclick="adminOwnerBridgeLoadFromUi()" '+
    (adminOwnerBridgeBusy?'disabled':'')+'>Consolidar valores da competência</button>'+
    (matching?'<p class="tiny muted">Mês: '+esc(d.month)+' • '+
      Number(d.totalCampaigns).toLocaleString('pt-BR')+' campanha(s)'+
      (d.truncated?' • somente as 50 mais recentes':'')+'</p>'+
      '<div class="grid cards-2">'+
      (cards||'<p class="muted">Ainda não há campanhas com orçamento planejado nesta competência.</p>')+
      '</div>':
      '<p class="tiny muted">Consulte a competência selecionada para comparar somente dados reais do banco.</p>')+
    (typeof adminOwnerBenefitCostsSection==='function'?adminOwnerBenefitCostsSection():'')+
    (typeof adminOwnerWalletReconciliationSection==='function'?adminOwnerWalletReconciliationSection():'')+
    (typeof adminOwnerCashbackSourceLotsSection==='function'?adminOwnerCashbackSourceLotsSection():'')+
    (typeof adminOwnerReferralLifecycleSection==='function'?adminOwnerReferralLifecycleSection():'')+
    (typeof adminOwnerPayoutEvidenceSection==='function'?adminOwnerPayoutEvidenceSection():'')+
    (typeof adminOwnerPayoutProofsSection==='function'?adminOwnerPayoutProofsSection():'')+
    (typeof adminOwnerPayoutProviderSection==='function'?adminOwnerPayoutProviderSection():'')+
    (typeof adminOwnerRecipientProofSection==='function'?adminOwnerRecipientProofSection():'')+
    (typeof adminOwnerMultiPspSection==='function'?adminOwnerMultiPspSection():'')+
    '<div class="card flat form-stack"><h4>Integridade dos comprovantes privados</h4>'+
    '<p>Auditoria de arquivos sem vínculo à despesa. Os uploads recentes têm proteção de 24 horas; esta consulta não exclui documentos.</p>'+
    '<button type="button" class="secondary small" onclick="adminOwnerOrphanAuditLoadFromUi()" '+
    (adminOwnerOrphanAuditBusy?'disabled':'')+'>Auditar arquivos sem vínculo</button>'+
    orphanView+
    (typeof adminOwnerOrphanCleanupSection==='function'?adminOwnerOrphanCleanupSection():'')+
    '<p class="tiny muted">Nenhuma exclusão automática está habilitada. Os arquivos associados a despesas corrigidas permanecem preservados.</p></div>'+
    '</div>';
}

// TAMÃO V1.252 — authenticated, aggregated checkout UTM/order-state report.
// This report shows the merchant's settled order value, never TAMÃO's received revenue.
let adminOwnerCampaignOrdersState=null;
let adminOwnerCampaignOrdersBusy=false;
async function adminOwnerCampaignOrdersLoadFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  const role=String(adminCurrentRole());
  if(!actor||!['superadmin','finance'].includes(role)||adminOwnerCampaignOrdersBusy)return;
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return toast('Selecione um mês válido.');
  adminOwnerCampaignOrdersBusy=true;
  render();
  try{
    const d=await adminInvoke({action:'owner-campaign-orders',month:month?month+'-01':''});
    const keys=['customer_cashback','customer_referral','merchant_referral','clube_coupons'];
    if(d?.source!=='admin_owner_campaign_orders_v1_252'||
       d?.metricMeaning!=='first_party_checkout_utm_non_causal_attribution'||
       d?.readOnly!==true||d?.plannedOnly!==true||d?.noCharge!==true||
       d?.spendableCents!==0||d?.newBenefitsEnabled!==false||
       d?.platformReceivedRevenueCents!==null||d?.financialReturnMeasured!==false||
       !/^\d{4}-\d{2}-01$/.test(String(d?.month||''))||
       (month&&d.month!==month+'-01')||
       !Number.isSafeInteger(d.totalCampaigns)||d.totalCampaigns<0||
       d.limit!==50||typeof d.truncated!=='boolean'||d.truncated!==(d.totalCampaigns>50)||
       !Array.isArray(d.rows)||d.rows.length>50||d.rows.length>d.totalCampaigns||
       d.rows.some(x=>!x||typeof x.campaignTag!=='string'||
         !keys.some(k=>x.campaignTag.startsWith('tam-'+k+'-'+d.month.slice(0,4)+d.month.slice(5,7)+'-'))||
         !['createdOrders','settledOrders','reversedOrders','settledMerchantOrderValueCents']
           .every(k=>Number.isSafeInteger(x[k])&&x[k]>=0)||
         x.settledOrders+x.reversedOrders>x.createdOrders||
         x.platformReceivedRevenueCents!==null||x.financialReturnMeasured!==false))
      throw new Error('Indicadores de pedidos não validados.');
    if(actor===String(adminRuntime?.session?.user?.id||'')&&role===String(adminCurrentRole()))
      adminOwnerCampaignOrdersState={...d,loadedFor:actor};
  }catch(error){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerCampaignOrdersState=null;
      toast(String(error?.message||'Não foi possível consultar os pedidos.'));
    }
  }finally{adminOwnerCampaignOrdersBusy=false;render();}
}
function adminOwnerCampaignOrdersSection(){
  if(!['superadmin','finance'].includes(String(adminCurrentRole())))return '';
  const actor=String(adminRuntime?.session?.user?.id||'');
  const d=adminOwnerCampaignOrdersState?.loadedFor===actor?adminOwnerCampaignOrdersState:null;
  const freshMonth=String(document.getElementById('owner-campaign-signals-month')?.value||'');
  const monthMatches=!d||!freshMonth||d.month.slice(0,7)===freshMonth;
  const cards=(d?.rows||[]).map(x=>'<article class="card flat form-stack">'+
    '<strong>'+esc(x.campaignTag)+'</strong>'+
    '<div class="merchant-kpis">'+
    '<div class="kpi"><span class="label">Pedidos criados com o link</span><strong>'+
    Number(x.createdOrders).toLocaleString('pt-BR')+'</strong></div>'+
    '<div class="kpi"><span class="label">Pedidos liquidados, sem estorno</span><strong>'+
    Number(x.settledOrders).toLocaleString('pt-BR')+'</strong></div>'+
    '<div class="kpi"><span class="label">Liquidações revertidas</span><strong>'+
    Number(x.reversedOrders).toLocaleString('pt-BR')+'</strong></div>'+
    '<div class="kpi"><span class="label">Valor dos pedidos liquidados das revendas</span><strong>'+
    adminMoney(x.settledMerchantOrderValueCents)+'</strong></div></div>'+
    '<p class="tiny muted">O valor acima pertence às vendas das revendas. Recebimento do TAMÃO e retorno sobre o investimento ainda não são atribuídos a esta campanha.</p></article>').join('');
  return '<div class="form-stack"><div class="section-head"><div>'+
    '<h4>Pedidos ligados à divulgação</h4>'+
    '<p>Pedidos criados com o identificador UTM, liquidados ou revertidos, usando o estado financeiro real do pedido.</p>'+
    '</div></div>'+
    '<button type="button" class="secondary small" onclick="adminOwnerCampaignOrdersLoadFromUi()" '+
    (adminOwnerCampaignOrdersBusy?'disabled':'')+'>Consultar pedidos por campanha</button>'+
    (d&&monthMatches?
      '<p class="tiny muted">Competência: '+esc(d.month)+
      ' • '+Number(d.totalCampaigns).toLocaleString('pt-BR')+' campanha(s)'+
      (d.truncated?' • exibindo 50 mais recentes':'')+'</p>'+
      '<div class="grid cards-2">'+
      (cards||'<p class="muted">Não existem campanhas com orçamento planejado para essa competência.</p>')+
      '</div>':
      '<p class="tiny muted">Consulte os pedidos da competência selecionada para exibir apenas dados confirmados do servidor.</p>')+
    '<p class="tiny muted">UTM indica a origem informada no checkout, não comprova que a campanha causou a compra. Liquidação inclui confirmação por revenda ou PSP, conforme o pedido. Nenhum recebimento de taxa pelo TAMÃO é inferido dessa informação.</p>'+
    '</div>';
}

// TAMÃO V1.253 — provider-backed individual fee receipts. Grouped statements are excluded.
let adminOwnerCampaignFeeReceiptsState=null;
let adminOwnerCampaignFeeReceiptsBusy=false;
async function adminOwnerCampaignFeeReceiptsLoadFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  const role=String(adminCurrentRole());
  if(!actor||!['superadmin','finance'].includes(role)||adminOwnerCampaignFeeReceiptsBusy)return;
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return toast('Selecione uma competência válida.');
  adminOwnerCampaignFeeReceiptsBusy=true;
  render();
  try{
    const d=await adminInvoke({action:'owner-campaign-fee-receipts',month:month?month+'-01':''});
    const keys=['customer_cashback','customer_referral','merchant_referral','clube_coupons'];
    if(d?.source!=='admin_owner_campaign_fee_receipts_v1_253'||
       d?.evidenceLevel!=='provider_event_applied_single_order_statement_no_refund'||
       d?.readOnly!==true||d?.noTransfers!==true||
       d?.spendableCents!==0||d?.newBenefitsEnabled!==false||
       d?.bankSettlementVerified!==false||d?.roiMeasured!==false||
       d?.marketingSpendPaidCents!==null||
       !/^\d{4}-\d{2}-01$/.test(String(d?.month||''))||
       (month&&d.month!==month+'-01')||
       !Number.isSafeInteger(d.totalCampaigns)||d.totalCampaigns<0||
       d.limit!==50||typeof d.truncated!=='boolean'||d.truncated!==(d.totalCampaigns>50)||
       !Array.isArray(d.rows)||d.rows.length>50||d.rows.length>d.totalCampaigns||
       d.rows.some(x=>!x||
         !keys.some(k=>typeof x.campaignTag==='string'&&x.campaignTag.startsWith(
           'tam-'+k+'-'+d.month.slice(0,4)+d.month.slice(5,7)+'-'))||
         !['attributedOrders','providerConfirmedOrders','providerConfirmedFeeCents','notIndividuallyProvenOrders']
           .every(k=>Number.isSafeInteger(x[k])&&x[k]>=0)||
         x.providerConfirmedOrders+x.notIndividuallyProvenOrders!==x.attributedOrders||
         (x.providerConfirmedOrders===0&&x.providerConfirmedFeeCents!==0)||
         x.bankSettlementVerified!==false||x.roiMeasured!==false||
         x.marketingSpendPaidCents!==null))
      throw new Error('Conciliação individual não confirmada.');
    if(actor===String(adminRuntime?.session?.user?.id||'')&&role===String(adminCurrentRole()))
      adminOwnerCampaignFeeReceiptsState={...d,loadedFor:actor};
  }catch(error){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerCampaignFeeReceiptsState=null;
      toast(String(error?.message||'Falha ao consultar os recebimentos.'));
    }
  }finally{adminOwnerCampaignFeeReceiptsBusy=false;render();}
}
function adminOwnerCampaignFeeReceiptsSection(){
  if(!['superadmin','finance'].includes(String(adminCurrentRole())))return '';
  const actor=String(adminRuntime?.session?.user?.id||'');
  const d=adminOwnerCampaignFeeReceiptsState?.loadedFor===actor?adminOwnerCampaignFeeReceiptsState:null;
  const freshMonth=String(document.getElementById('owner-campaign-signals-month')?.value||'');
  const matching=!d||!freshMonth||d.month.slice(0,7)===freshMonth;
  const cards=(d?.rows||[]).map(x=>'<article class="card flat form-stack">'+
    '<strong>'+esc(x.campaignTag)+'</strong>'+
    '<div class="merchant-kpis">'+
    '<div class="kpi"><span class="label">Taxas confirmadas pelo provedor e vinculadas ao pedido</span><strong>'+
    adminMoney(x.providerConfirmedFeeCents)+'</strong></div>'+
    '<div class="kpi"><span class="label">Pedidos com recebimento individual comprovado</span><strong>'+
    Number(x.providerConfirmedOrders).toLocaleString('pt-BR')+'</strong></div>'+
    '<div class="kpi"><span class="label">Pedidos ainda sem confirmação individual</span><strong>'+
    Number(x.notIndividuallyProvenOrders).toLocaleString('pt-BR')+'</strong></div></div>'+
    '<p class="tiny muted">A comprovação exige cobrança de um único pedido, evento do provedor aplicado, ausência de crédito pré-pago e de estornos. Não se rateiam cobranças diárias com várias vendas.</p></article>').join('');
  return '<div class="form-stack"><div class="section-head"><div>'+
    '<h4>Taxas recebidas com comprovação individual</h4>'+
    '<p>Acompanhamento rigoroso dos recebimentos de taxas da plataforma ligados diretamente a pedidos de campanha.</p>'+
    '</div></div>'+
    '<button type="button" class="secondary small" onclick="adminOwnerCampaignFeeReceiptsLoadFromUi()" '+
    (adminOwnerCampaignFeeReceiptsBusy?'disabled':'')+'>Conferir taxas por campanha</button>'+
    (d&&matching?'<p class="tiny muted">Competência: '+esc(d.month)+
      ' • '+Number(d.totalCampaigns).toLocaleString('pt-BR')+' campanha(s)'+
      (d.truncated?' • exibindo 50 recentes':'')+'</p><div class="grid cards-2">'+
      (cards||'<p class="muted">Nenhuma campanha planejada para esta competência.</p>')+'</div>':
      '<p class="tiny muted">Consulte os recebimentos da competência selecionada.</p>')+
    '<p class="tiny muted">Confirmado pelo provedor e aplicado na cobrança não significa saldo bancário conferido. Campanhas com cobranças agrupadas, aprovação apenas manual ou créditos pré-pagos ficam fora do valor comprovado. Gastos efetivos de marketing e retorno sobre investimento ainda não são mensurados.</p>'+
    '</div>';
}

// TAMÃO V1.254 — provider-confirmed batch statement line ledger.
let adminOwnerBatchLedgerState=null;
let adminOwnerBatchLedgerBusy=false;
async function adminOwnerBatchLedgerLoadFromUi(){
  const actor=String(adminRuntime?.session?.user?.id||'');
  const role=String(adminCurrentRole());
  if(!actor||!['superadmin','finance'].includes(role)||adminOwnerBatchLedgerBusy)return;
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return toast('Selecione uma competência válida.');
  adminOwnerBatchLedgerBusy=true;
  render();
  try{
    const d=await adminInvoke({action:'owner-campaign-batch-ledger',month:month?month+'-01':''});
    const benefits=['customer_cashback','customer_referral','merchant_referral','clube_coupons'];
    if(d?.source!=='admin_owner_campaign_batch_ledger_v1_254'||
       d?.evidenceLevel!=='psp_paid_statement_balances_exact_all_lines_no_refunds'||
       d?.readOnly!==true||d?.noTransfers!==true||
       d?.batchOnly!==true||d?.noDoubleCountingWithV253!==true||
       d?.cashAvailableCents!==0||d?.newBenefitsEnabled!==false||
       d?.bankSettlementVerified!==false||d?.roiMeasured!==false||
       d?.paidMarketingCostCents!==null||
       !/^\d{4}-\d{2}-01$/.test(String(d?.month||''))||
       (month&&d.month!==month+'-01')||
       !Number.isSafeInteger(d.totalCampaigns)||d.totalCampaigns<0||
       d.limit!==50||typeof d.truncated!=='boolean'||
       d.truncated!==(d.totalCampaigns>50)||
       !Array.isArray(d.rows)||d.rows.length>50||
       d.rows.length>d.totalCampaigns||
       d.rows.some(x=>!x||
         !benefits.some(k=>typeof x.campaignTag==='string'&&
           x.campaignTag.startsWith('tam-'+k+'-'+d.month.slice(0,4)+d.month.slice(5,7)+'-'))||
         !['verifiedBatchOrders','verifiedBatchStatements','providerSupportedNetFeeCents']
           .every(k=>Number.isSafeInteger(x[k])&&x[k]>=0)||
         x.verifiedBatchStatements>x.verifiedBatchOrders||
         (x.verifiedBatchOrders===0&&x.providerSupportedNetFeeCents!==0)||
         x.entrySource!=='receivable_net_fee_statement_exact_payment_event'||
         x.bankSettlementVerified!==false||x.roiMeasured!==false||
         x.cashAvailableCents!==0||x.paidMarketingCostCents!==null))
      throw new Error('Conciliação dos extratos agrupados não verificada.');
    if(actor===String(adminRuntime?.session?.user?.id||'')&&
       role===String(adminCurrentRole()))
      adminOwnerBatchLedgerState={...d,loadedFor:actor};
  }catch(error){
    if(actor===String(adminRuntime?.session?.user?.id||'')){
      adminOwnerBatchLedgerState=null;
      toast(String(error?.message||'Não foi possível conferir os extratos agrupados.'));
    }
  }finally{adminOwnerBatchLedgerBusy=false;render();}
}
function adminOwnerBatchLedgerSection(){
  if(!['superadmin','finance'].includes(String(adminCurrentRole())))return '';
  const actor=String(adminRuntime?.session?.user?.id||'');
  const d=adminOwnerBatchLedgerState?.loadedFor===actor?adminOwnerBatchLedgerState:null;
  const month=String(document.getElementById('owner-campaign-signals-month')?.value||'').trim();
  const matching=!d||!month||String(d.month).slice(0,7)===month;
  const cards=(d?.rows||[]).map(x=>'<article class="card flat form-stack">'+
    '<strong>'+esc(x.campaignTag)+'</strong>'+
    '<div class="merchant-kpis">'+
    '<div class="kpi"><span class="label">Taxas líquidas de pedidos em extratos agrupados</span><strong>'+
    adminMoney(x.providerSupportedNetFeeCents)+'</strong></div>'+
    '<div class="kpi"><span class="label">Pedidos com evidência por linha</span><strong>'+
    Number(x.verifiedBatchOrders).toLocaleString('pt-BR')+'</strong></div>'+
    '<div class="kpi"><span class="label">Extratos agrupados conciliados</span><strong>'+
    Number(x.verifiedBatchStatements).toLocaleString('pt-BR')+'</strong></div></div>'+
    '<p class="tiny muted">Cada linha usa a taxa exata do próprio pedido menos créditos pré-pagos. A soma de todas as linhas precisa coincidir com o extrato pago e o evento do provedor.</p>'+
    '</article>').join('');
  return '<div class="form-stack"><div class="section-head"><div>'+
    '<h4>Conciliação dos extratos com vários pedidos</h4>'+
    '<p>Comprovação por linha contábil de cada pedido, inclusive quando o provedor confirmou um pagamento conjunto.</p>'+
    '</div></div>'+
    '<button type="button" class="secondary small" onclick="adminOwnerBatchLedgerLoadFromUi()" '+
    (adminOwnerBatchLedgerBusy?'disabled':'')+'>Conferir extratos agrupados</button>'+
    (d&&matching?'<p class="tiny muted">Competência: '+esc(d.month)+' • '+
      Number(d.totalCampaigns).toLocaleString('pt-BR')+' campanha(s)'+
      (d.truncated?' • exibindo 50 recentes':'')+'</p>'+
      '<div class="grid cards-2">'+
      (cards||'<p class="muted">Nenhuma campanha planejada nesta competência.</p>')+
      '</div>':
      '<p class="tiny muted">Consulte a competência selecionada para exibir os valores comprovados pelo banco de dados.</p>')+
    '<p class="tiny muted">Este resultado considera apenas extratos com dois ou mais pedidos, sem sobreposição com a conciliação individual da V1.253. Pendências, estornos ou divergências de qualquer linha impedem atribuir o extrato. Nenhuma consulta confere saldo bancário, cria créditos ou calcula ROI.</p>'+
    '</div>';
}

function adminOwnerFinanceWorkspaceSection(){
  const role=String(adminCurrentRole());
  if(!['superadmin','finance'].includes(role))return '';
  const actor=String(adminRuntime?.session?.user?.id||'');
  const plan=adminOwnerFundingState?.loadedFor===actor?adminOwnerFundingState:null;
  const pulse=adminOwnerFundingPulseState?.loadedFor===actor?adminOwnerFundingPulseState:null;
  const evidence=adminOwnerEvidenceState?.loadedFor===actor?adminOwnerEvidenceState:null;
  const budget=adminOwnerBudgetState?.loadedFor===actor?adminOwnerBudgetState:null;
  const complete=adminOwnerFinanceLoadedFor===actor&&!!plan&&!!pulse&&!!evidence&&!!budget;
  const keys=['customer_cashback','customer_referral','merchant_referral','clube_coupons'];
  const labels={
    customer_cashback:'Cashback',customer_referral:'Indicações de clientes',
    merchant_referral:'Indicações de revendas',clube_coupons:'Clube TAMÃO'
  };
  const tabs=[
    ['overview','Visão geral'],
    ['plan','Planejamento'],
    ['evidence','Aportes'],
    ['campaigns','Campanhas'],
    ['history','Histórico'],
    ['signals','Resultados']
  ];
  const navigation='<div class="row flex-wrap" role="group" aria-label="Áreas de financiamento">'+
    tabs.map(([id,title])=>'<button type="button" class="'+
      (adminOwnerFinanceTab===id?'primary':'secondary')+
      ' small" aria-pressed="'+(adminOwnerFinanceTab===id?'true':'false')+
      '" onclick="adminOwnerFinanceSelectFromUi(\''+id+'\')">'+title+'</button>').join('')+
    '</div>';
  const refresh='<button type="button" class="secondary small" onclick="adminOwnerFinanceLoadFromUi()" '+
    (adminOwnerFinanceLoading?'disabled':'')+'>'+
    (adminOwnerFinanceLoading?'Consultando…':'Atualizar visão financeira')+'</button>';
  const currentMonth=complete?String(pulse.monthStart):'';
  const monthly=complete?budget.rows.filter(x=>x.month===currentMonth):[];
  const sum=values=>values.reduce((total,value)=>total+Number(value||0),0);
  const summary=complete?
    '<div class="merchant-kpis">'+
      '<div class="kpi"><span class="label">Orçamento planejado / mês</span><strong>'+
      adminMoney(sum(plan.rows.map(x=>x.budgetCents)))+'</strong><small>Quatro centros de incentivos</small></div>'+
      '<div class="kpi"><span class="label">Distribuído em campanhas / mês</span><strong>'+
      adminMoney(sum(monthly.map(x=>x.allocatedCents)))+'</strong><small>Parcela do planejamento, não dinheiro gasto</small></div>'+
      '<div class="kpi"><span class="label">Emissões válidas geradas no mês</span><strong>'+
      adminMoney(sum(pulse.rows.map(x=>x.netGrantedCents)))+'</strong><small>Benefícios registrados, não pagamentos</small></div>'+
      '<div class="kpi"><span class="label">Aportes conferidos manualmente</span><strong>'+
      adminMoney(evidence.manualReconciledCents)+'</strong><small>Histórico total, sem validação bancária por API</small></div>'+
      '</div>'+
      '<p class="tiny muted">Competência '+esc(currentMonth)+' (São Paulo) • '+
      Number(evidence.pendingCount).toLocaleString('pt-BR')+
      ' aporte(s) aguardando decisão • consulta: '+esc(adminOwnerFinanceLoadedAt)+
      '. Nenhum desses indicadores representa saldo disponível para pagamentos.</p>':
      '<p class="muted">Atualize a visão financeira para reunir orçamento, aportes, campanhas e incentivos com dados atuais.</p>';
  const lines=complete?keys.map(key=>{
    const p=plan.rows.find(x=>x.benefitKey===key);
    const b=monthly.find(x=>x.benefitKey===key);
    const x=pulse.rows.find(x=>x.benefitKey===key);
    if(!p||!b||!x)return '';
    const pct=Number(p.budgetCents)>0?
      Math.min(100,Math.round(Number(b.allocatedCents)/Number(p.budgetCents)*100)):0;
    return '<article class="card flat form-stack">'+
      '<div class="section-head"><strong>'+esc(labels[key])+'</strong>'+
      '<span class="status-pill">'+(p.status==='internally_committed'?'Planejado pelo fundador':'Em preparação')+
      '</span></div>'+
      '<p class="tiny muted">Teto mensal: '+adminMoney(p.budgetCents)+
      ' • separado por campanha: '+adminMoney(b.allocatedCents)+
      ' • não distribuído: '+adminMoney(b.unallocatedCents)+'</p>'+
      '<div class="progress-track" role="progressbar" aria-label="Orçamento separado" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+pct+'">'+
      '<div class="progress-fill" style="width:'+pct+'%"></div></div>'+
      '<p class="tiny muted">Emissões ainda válidas no mês: '+adminMoney(x.netGrantedCents)+
      ' (indicador independente do valor distribuído).</p></article>';
  }).join(''):'';
  const explanation=adminOwnerFinanceTab==='overview'?
    '<div class="section-head"><div><h4>Seus quatro centros de crescimento</h4>'+
    '<p>Acompanhe o que foi planejado, distribuído e registrado em incentivos sem misturar valores diferentes.</p></div></div>'+
    (complete?'<div class="grid cards-2">'+lines+'</div>':'')+
    '<p class="tiny muted">Para executar uma operação, selecione Planejamento, Aportes ou Campanhas acima. As decisões continuam registradas por responsável e data.</p>':'';
  const detail=adminOwnerFinanceTab==='plan'?adminOwnerFundingSection():
    adminOwnerFinanceTab==='evidence'?adminOwnerEvidenceSection():
    adminOwnerFinanceTab==='campaigns'?adminOwnerBudgetSection():
    adminOwnerFinanceTab==='history'?adminOwnerFinanceHistorySection():
    adminOwnerFinanceTab==='signals'?adminOwnerCampaignSignalsSection():explanation;
  return '<section class="section admin-owner-finance-workspace">'+
    '<div class="section-head"><div>'+
    '<span class="section-kicker">TAMÃO • ADMINISTRAÇÃO FINANCEIRA</span>'+
    '<h3>Central de financiamento e crescimento</h3>'+
    '<p>Uma visão para organizar seus incentivos, acompanhar aportes e decidir onde investir no crescimento do TAMÃO.</p>'+
    '</div>'+refresh+'</div>'+
    navigation+
    (adminOwnerFinanceError?'<p class="tiny muted" role="status">'+esc(adminOwnerFinanceError)+'</p>':'')+
    summary+
    detail+
    '</section>';
}

function adminPrelaunchLeadsSection(data){
  const leads=Array.isArray(data?.prelaunchLeads)?data.prelaunchLeads:[];
  const metrics=adminAcquisitionMetrics(data,leads);
  const ordered=[...leads].sort((a,b)=>adminLeadPriority(a.status)-adminLeadPriority(b.status)||(Date.parse(a.created_at||'')-Date.parse(b.created_at||'')));
  return [
    '<section class="section">',
      '<div class="section-head"><div><span class="section-kicker">AQUISIÇÃO • CLIENTES E PARCEIROS</span><h2>Funil real de clientes e parceiros</h2><p>As métricas agregadas usam todos os leads do banco. A fila operacional abaixo traz somente os contatos recentes necessários para atendimento.</p></div><span class="status-pill online">'+Number(metrics.total||0)+' lead(s)</span></div>',
      '<div class="merchant-kpis acquisition-summary-kpis">',
        '<div class="kpi"><span class="label">Entradas medidas</span><strong>'+Number(metrics.landingViews||0)+'</strong><small>uma vez por sessão/aba e público</small></div>',
        '<div class="kpi"><span class="label">Formulários vistos</span><strong>'+Number(metrics.formViews||0)+'</strong><small>'+adminMetricPercent(metrics.landingToFormPct)+' das entradas</small></div>',
        '<div class="kpi"><span class="label">Total captado</span><strong>'+Number(metrics.total||0)+'</strong><small>'+Number(metrics.last7d||0)+' nos últimos 7 dias</small></div>',
        '<div class="kpi"><span class="label">Clientes / empresas</span><strong>'+Number(metrics.customers||0)+' / '+Number(metrics.merchants||0)+'</strong></div>',
        '<div class="kpi"><span class="label">Novos há +24h</span><strong>'+Number(metrics.staleNew24h||0)+'</strong><small>prioridade de contato</small></div>',
        '<div class="kpi"><span class="label">Mediana até 1º contato</span><strong>'+adminMetricDuration(metrics.medianFirstContactMinutes)+'</strong></div>',
      '</div>',
      '<div class="acquisition-funnel acquisition-funnel-full">',
        '<div class="funnel-stage"><span>1</span><div><small>ENTRADAS</small><strong>'+Number(metrics.landingViews||0)+'</strong><p>sessões medidas</p></div></div>',
        '<div class="funnel-stage"><span>2</span><div><small>VIRAM FORMULÁRIO</small><strong>'+Number(metrics.formViews||0)+'</strong><p>'+adminMetricPercent(metrics.landingToFormPct)+' das entradas</p></div></div>',
        '<div class="funnel-stage"><span>3</span><div><small>VIRARAM LEAD</small><strong>'+Number(metrics.total||0)+'</strong><p>'+adminMetricPercent(metrics.landingToLeadPct)+' das entradas</p></div></div>',
        '<div class="funnel-stage"><span>4</span><div><small>CONTATADOS</small><strong>'+Number(metrics.contacted||0)+'</strong><p>'+adminMetricPercent(metrics.contactRatePct)+' dos leads</p></div></div>',
        '<div class="funnel-stage"><span>5</span><div><small>QUALIFICADOS</small><strong>'+Number(metrics.qualified||0)+'</strong><p>'+adminMetricPercent(metrics.qualificationRatePct)+' dos leads</p></div></div>',
        '<div class="funnel-stage"><span>6</span><div><small>CONVERTIDOS</small><strong>'+Number(metrics.converted||0)+'</strong><p>'+adminMetricPercent(metrics.conversionRatePct)+' dos leads</p></div></div>',
      '</div>',
      adminAcquisitionCampaigns(metrics),
      adminGrowthNetworkOverviewView(data?.growthNetwork),
      adminGrowthApplicationFunnelView(data?.growthApplicationFunnel),
      adminAdsDemandSection(),
      adminClubeInterestSection(),
      adminClubeCampaignSection(),
      adminClubeTermsSection(),
      adminOwnerFinanceWorkspaceSection(),
      adminAdsCampaignSection(),
      adminAdsAudienceSection(),
      adminAdsPreviewSummarySection(),
      adminAdsPlacementSection(),
      adminCommercialActivationSection(),
      adminGrowthReferralReviewSection(),
      '<div class="section-head acquisition-queue-head"><div><span class="section-kicker">FILA OPERACIONAL</span><h3>Leads recentes para atendimento</h3><p>Até 200 contatos mais recentes. Ordenados por estágio e antiguidade para reduzir esquecimento.</p></div><span class="status-pill '+(Number(metrics.staleNew24h||0)?'offline':'online')+'">'+Number(metrics.new||0)+' novo(s)</span></div>',
      '<div class="grid cards-3" style="margin-top:14px">'+(ordered.length?ordered.slice(0,200).map(adminPrelaunchLeadCard).join(''):'<div class="empty card">Nenhum lead captado ainda.</div>')+'</div>',
    '</section>'
  ].join('');
}


function adminPublicRequestKindLabel(value){
  return ({general:'DÚVIDA',support:'SUPORTE',privacy:'PRIVACIDADE'})[value]||String(value||'SOLICITAÇÃO').toUpperCase();
}
function adminPrivacyActionLabel(value){
  return ({
    confirmation:'Confirmação de tratamento',
    access:'Acesso aos dados',
    correction:'Correção de dados',
    deletion:'Eliminação de dados',
    information:'Informações sobre uso/compartilhamento',
    revocation:'Revogação de autorização',
    other:'Outro assunto de privacidade'
  })[value]||'—';
}
function adminPublicRequestCard(x){
  const kind=adminPublicRequestKindLabel(x.request_kind);
  const protocol=String(x.id||'').slice(0,8).toUpperCase();
  const status=adminPublicRequestStatusLabel(x.status);
  let contactAction='';
  if(x.contact_channel==='email'){
    contactAction='<a class="secondary small" href="mailto:'+encodeURIComponent(String(x.contact_value||''))+'">Responder por e-mail</a>';
  }else{
    contactAction='<a class="secondary small" href="https://wa.me/'+esc(adminLeadWhatsApp(x.contact_value))+'?text='+encodeURIComponent(adminPublicRequestWhatsAppText(x))+'" target="_blank" rel="noopener noreferrer">Abrir WhatsApp com mensagem</a>';
  }
  return [
    '<article class="card flat">',
      '<div class="status-bar"><div><span class="status-pill '+(x.request_kind==='privacy'?'offline':'online')+'">'+esc(kind)+'</span>',
      '<h3 style="margin:8px 0 3px">'+esc(x.contact_name||'Solicitante')+'</h3>',
      '<div class="tiny muted">Protocolo '+esc(protocol)+' • '+esc(status)+'</div></div>',
      '<small>'+new Date(x.created_at).toLocaleString('pt-BR')+'</small></div>',
      x.request_kind==='privacy'?'<div class="list-row"><span>Direito/assunto</span><strong>'+esc(adminPrivacyActionLabel(x.privacy_action))+'</strong></div>':'',
      '<div class="list-row"><span>Canal</span><strong>'+esc(x.contact_channel==='email'?'E-mail':'WhatsApp')+'</strong></div>',
      '<p class="muted tiny" style="white-space:pre-wrap">'+esc(x.message||'')+'</p>',
      x.resolution_note?'<p class="muted tiny"><strong>Resolução:</strong> '+esc(x.resolution_note)+'</p>':'',
      '<div class="order-actions">'+contactAction+'<span class="tiny muted">'+esc(String(x.contact_value||''))+'</span></div>',
      adminPublicRequestActionButtons(x),
    '</article>'
  ].join('');
}
function adminPublicRequestsSection(data){
  const requests=Array.isArray(data?.publicRequests)?data.publicRequests:[];
  const open=requests.filter(x=>['new','in_review'].includes(x.status)).length;
  const privacy=requests.filter(x=>x.request_kind==='privacy'&&['new','in_review'].includes(x.status)).length;
  return [
    '<section class="section">',
      '<div class="section-head"><div><span class="section-kicker">CONFIANÇA • CONTATO E LGPD</span><h2>Solicitações públicas</h2><p>Dúvidas, suporte geral e exercícios de direitos recebidos pelo canal oficial do site.</p></div><span class="status-pill '+(open?'offline':'online')+'">'+open+' pendente(s)</span></div>',
      '<div class="merchant-kpis"><div class="kpi"><span class="label">Pendentes</span><strong>'+open+'</strong></div><div class="kpi"><span class="label">Privacidade pendente</span><strong>'+privacy+'</strong></div></div>',
      '<div class="grid cards-3" style="margin-top:14px">'+(requests.length?requests.slice(0,60).map(adminPublicRequestCard).join(''):'<div class="empty card">Nenhuma solicitação pública recebida.</div>')+'</div>',
    '</section>'
  ].join('');
}


async function adminLoadProspects({force=false}={}){
  if(!adminReady()||adminRuntime.prospectLoading)return;
  const requestingUser=String(adminRuntime.session?.user?.id||'');
  const requestedCity=String(adminRuntime.prospectCity||'');
  const requestedState=String(adminRuntime.prospectState||'');
  adminRuntime.prospectLoading=true;
  adminRuntime.prospectError=null;
  adminRuntime.prospectLoadedAt=null;
  adminRuntime.prospectLoadedFor=null;
  render();
  try{
    const response=await adminInvoke({action:'prospect-intelligence',
      city:requestedCity,state:requestedState,force});
    if(!adminReady()||String(adminRuntime.session?.user?.id||'')!==requestingUser)return;
    if(response?.state===requestedState
       &&String(response?.city||'').toUpperCase()===requestedCity.toUpperCase()
       &&adminRuntime.prospectState===requestedState
       &&String(adminRuntime.prospectCity||'').toUpperCase()===requestedCity.toUpperCase()){
      adminRuntime.prospectReport=response;
      adminRuntime.prospectLoadedFor=Array.isArray(response.prospects)?requestingUser:null;
      adminRuntime.prospectLoadedAt=Array.isArray(response.prospects)?new Date().toISOString():null;
    }
  }catch(error){
    if(String(adminRuntime.session?.user?.id||'')!==requestingUser)return;
    adminRuntime.prospectError=String(error?.message||error);
    adminRuntime.prospectLoadedAt=null;
    adminRuntime.prospectLoadedFor=null;
  }finally{
    adminRuntime.prospectLoading=false;render();
    if(adminReady()&&String(adminRuntime.session?.user?.id||'')===requestingUser
      &&(String(adminRuntime.prospectCity||'').toUpperCase()!==requestedCity.toUpperCase()
        ||adminRuntime.prospectState!==requestedState)){
      adminLoadProspects().catch(()=>{});
    }else if(adminReady()&&['superadmin','operations'].includes(String(adminCurrentRole()))){
      adminLoadCityNotifications().catch(()=>{});
    }
  }
}
function adminProspectSelectCity(value){
  const text=String(value||'');
  const sep=text.indexOf('|');
  if(sep<1)return;
  const uf=text.slice(0,sep),city=text.slice(sep+1);
  if(!/^[A-Z]{2}$/.test(uf)||city.length<2||city.length>120)return;
  adminRuntime.prospectCity=city;
  adminRuntime.prospectState=uf;
  adminRuntime.prospectReport=null;
  adminRuntime.prospectLoadedAt=null;
  adminRuntime.prospectLoadedFor=null;
  adminLoadProspects().catch(()=>{});
}
function adminProspectSearchCity(){
  const city=String(document.getElementById('prospect-city')?.value||'').trim();
  const uf=String(document.getElementById('prospect-uf')?.value||'').trim().toUpperCase();
  if(city.length<2||city.length>120||!/^[A-Z]{2}$/.test(uf))return toast('Informe cidade e UF válidas');
  adminRuntime.prospectCity=city;
  adminRuntime.prospectState=uf;
  adminRuntime.prospectReport=null;
  adminLoadProspects().catch(()=>{});
}
async function adminPauseMarketCity(paused){
  if(!['superadmin','operations'].includes(String(adminCurrentRole())))return toast('Sem permissão para alterar cidades');
  const verb=paused?'pausar':'retomar';
  const region=adminRuntime.prospectCity+'/'+adminRuntime.prospectState;
  const reason=prompt('Informe o motivo para '+verb+' a operação em '+region+':','');
  if(reason==null)return;
  if(reason.trim().length<5)return toast('Informe uma justificativa de pelo menos 5 caracteres');
  try{
    await adminPerform('market-city-pause',{
      city:adminRuntime.prospectCity,state:adminRuntime.prospectState,
      paused:paused===true,reason:reason.trim()
    });
    await adminLoadProspects();
    toast(paused?'Cidade pausada para novas cotações':'Pausa removida; ofertas dependem de revendas aptas');
  }catch(e){toast(String(e?.message||e))}
}

async function adminLoadCityNotifications(){
  if(!adminReady()||adminRuntime.cityNotificationsPending)return;
  if(!['superadmin','operations'].includes(String(adminCurrentRole())))return;
  const city=adminRuntime.prospectCity,state=adminRuntime.prospectState;
  adminRuntime.cityNotificationsPending=true;
  adminRuntime.cityNotificationsError=null;
  try{
    const data=await adminInvoke({action:'expansion-notifications',city,state});
    if(adminRuntime.prospectCity===city&&adminRuntime.prospectState===state){
      adminRuntime.cityNotifications=Array.isArray(data?.notifications)?data.notifications:[];
    }
  }catch(e){
    adminRuntime.cityNotificationsError=String(e?.message||e);
  }finally{
    adminRuntime.cityNotificationsPending=false;
    render();
  }
}
async function adminMarkCityNotification(notificationId,status){
  if(!['superadmin','operations'].includes(String(adminCurrentRole())))return;
  if(!['sent','skipped'].includes(status))return;
  const question=status==='sent'
    ?'Confirma que você JÁ ENVIOU a mensagem pelo WhatsApp? O TAMÃO ainda não envia automaticamente.'
    :'Informe por que este contato não deve receber o aviso:';
  let note=prompt(question,status==='sent'?'Mensagem enviada manualmente pelo WhatsApp':'Contato não realizado');
  if(note==null)return;
  note=String(note).trim();
  if(note.length<5)return toast('Informe uma confirmação ou justificativa');
  try{
    await adminPerform('city-notification-status',{notificationId,status,note});
    await adminLoadCityNotifications();
    toast(status==='sent'?'Envio manual confirmado':'Contato retirado da fila');
  }catch(e){toast(String(e?.message||e))}
}
function adminCityNotificationsSection(){
  if(!['superadmin','operations'].includes(String(adminCurrentRole())))return '';
  const rows=adminRuntime.cityNotifications||[];
  const pending=adminRuntime.cityNotificationsPending;
  return '<div class="section-head" style="margin-top:20px"><div>'+
    '<span class="section-kicker">AVISOS DE DISPONIBILIDADE</span><h3>Contatos autorizados nesta cidade</h3>'+
    '<p>A fila é gerada automaticamente quando há revenda apta. A mensagem ainda deve ser enviada manualmente pelo operador, e só depois confirmada.</p></div>'+
    '<span class="status-pill">'+rows.length+' aguardando</span></div>'+
    (adminRuntime.cityNotificationsError?'<div class="notice danger">'+esc(adminRuntime.cityNotificationsError)+'</div>':'')+
    '<div class="card flat"><div class="list">'+
    (rows.length?rows.map(item=>{
      const lead=item.prelaunch_leads||{};
      const raw=String(lead.phone||'').replace(/\D/g,'');
      const phone=adminLeadWhatsApp(raw);
      const city=String(item.city||'');
      const name=adminFirstName(lead.contact_name);
      const message='Olá'+(name?', '+name:'')+'! Aqui é do TAMÃO. Já há uma revenda habilitada em '+city+'/'+item.state+'. Consulte a disponibilidade de gás, água e outros produtos para seu CEP '+String(item.postal_code||'')+' em https://tamao.com.br. O preço e o prazo dependem da consulta no site. Se não quiser receber avisos, responda SAIR.';
      const link='https://wa.me/'+phone+'?text='+encodeURIComponent(message);
      return '<div class="list-row"><div><strong>'+esc(lead.contact_name||'Interessado')+'</strong><br>'+
        '<small>'+esc(city)+'/'+esc(item.state)+' • CEP '+esc(item.postal_code)+' • '+esc(phone)+'</small></div>'+
        '<div class="order-actions">'+
          '<a class="secondary small" href="'+esc(link)+'" rel="noopener noreferrer" target="_blank">Abrir WhatsApp</a>'+
          '<button class="primary small" onclick="adminMarkCityNotification(\''+esc(item.id)+'\',\'sent\')">Confirmar envio</button>'+
          '<button class="ghost small" onclick="adminMarkCityNotification(\''+esc(item.id)+'\',\'skipped\')">Não contatar</button>'+
        '</div></div>';
    }).join(''):pending?'<div class="muted">Carregando fila…</div>':'<div class="muted">Nenhum aviso pendente nesta cidade.</div>')+
    '</div></div>';
}


const PROSPECT_STAGE_LABELS={
  uncontacted:'Não contatada',contacted:'Contatada',interested:'Interessada',
  onboarding:'Em cadastro',partner:'Parceira confirmada',dismissed:'Descartada'
};
async function adminLoadExpansionRadar(){
  const requestingUser=String(adminRuntime.session?.user?.id||'');
  if(!adminReady()||adminRuntime.expansionRadarLoading)return;
  adminRuntime.expansionRadarLoading=true;
  adminRuntime.expansionRadarError=null;
  try{
    const result=await adminInvoke({action:'expansion-radar'});
    if(!adminReady()||String(adminRuntime.session?.user?.id||'')!==requestingUser)return;
    if(!Array.isArray(result?.cities))throw new Error('Radar de expansão sem lista de cidades verificável');
    adminRuntime.expansionRadar=result.cities;
    adminRuntime.expansionRadarLoaded=true;
    adminRuntime.expansionRadarCheckedAt=new Date().toISOString();
  }catch(error){
    adminRuntime.expansionRadarError=String(error?.message||error);
    adminRuntime.expansionRadarLoaded=false;
    adminRuntime.expansionRadarCheckedAt=null;
  }
  finally{adminRuntime.expansionRadarLoading=false;render()}
}
function adminRadarCityCard(city){
  const key=String(city.state||'')+'|'+String(city.city||'');
  const state=String(city.state||'');
  const paused=city.admin_paused===true;
  const customers=Number(city.interested_customers||0);
  const prospects=Number(city.anp_prospects||0);
  const score=Number(city.priority_score||0);
  const eligible=Number(city.eligible_merchants||0);
  const stage=paused?'Operação pausada':eligible>0?'Com atendimento':'Buscando parceiros';
  return '<button type="button" class="card flat" data-city="'+esc(key)+'" onclick="adminProspectSelectCity(this.dataset.city)" style="text-align:left;cursor:pointer">'+
    '<div class="status-bar"><strong>'+esc(city.city||'Cidade')+' / '+esc(state)+'</strong><span class="status-pill">'+esc(stage)+'</span></div>'+
    '<div class="tiny muted">Índice de trabalho '+score+' • '+customers+' interessado'+(customers===1?'':'s')+
      ' • '+prospects+' registro'+(prospects===1?'':'s')+' ANP</div>'+
    '<div class="tiny muted">'+Number(city.uncontacted||0)+' sem contato • '+Number(city.onboarding||0)+' em cadastro'+
      (Number(city.overdue_followups||0)?' • '+Number(city.overdue_followups||0)+' retorno(s) vencido(s)':'')+'</div>'+
    '<small>Fonte ANP: '+esc(city.anp_source_status==='ok'?'consultada':city.anp_source_status==='unavailable'?'indisponível':'a verificar')+
      ' • Revendas aptas: '+eligible+'</small>'+
  '</button>';
}
function adminExpansionRadarSection(){
  const items=Array.isArray(adminRuntime.expansionRadar)?adminRuntime.expansionRadar:[];
  const loading=adminRuntime.expansionRadarLoading;
  const error=adminRuntime.expansionRadarError;
  return '<div class="section-head"><div><span class="section-kicker">RADAR COMERCIAL</span><h3>Cidades em ordem de atenção</h3>'+
    '<p>Índice interno calculado de interesses consentidos, empresas ANP, negociações e retornos vencidos. Não é previsão de vendas ou tamanho do mercado.</p></div>'+
    '<button type="button" class="secondary small" onclick="adminLoadExpansionRadar()" '+(loading?'disabled':'')+'>Atualizar radar</button></div>'+
    (error?'<div class="notice danger">'+esc(error)+'</div>':'')+
    '<div class="grid cards-3">'+(items.length?items.slice(0,6).map(adminRadarCityCard).join(''):
      '<div class="empty card">'+(loading?'Analisando cidades…':'Nenhuma cidade identificada ainda.')+'</div>')+'</div>'+
    (items.length>6?'<details class="card flat" style="margin-top:10px"><summary>Ver todas as '+items.length+' cidades priorizadas</summary>'+
      '<div class="grid cards-3" style="margin-top:12px">'+items.slice(6).map(adminRadarCityCard).join('')+'</div></details>':'');
}
/* V1.198 — evidence-based crosswalk between ANP/lead radar and city-level operational merchants. */
function adminExpansionBridgeSnapshot(d,now=Date.now()){
  const network=adminMerchantNetworkSnapshot(d,now);
  const radarLoaded=adminRuntime.expansionRadarLoaded===true;
  const radarRows=adminRuntime.expansionRadar;
  if(!network.valid||!radarLoaded||!Array.isArray(radarRows))
    return {valid:false,rows:[],networkValid:network.valid,radarLoaded,radarFresh:false,networkFresh:network.fresh};
  const age=Date.parse(String(adminRuntime.expansionRadarCheckedAt||''));
  const radarFresh=Number.isFinite(age)&&age<=now+60000&&now-age<=30*60000;
  const fresh=network.fresh&&radarFresh;
  const sane=x=>Number.isSafeInteger(x)&&x>=0?x:null;
  const keyFrom=(city,state)=>{
    const town=String(city||'').trim().replace(/\s+/g,' ').slice(0,100);
    const uf=String(state||'').trim().toUpperCase();
    if(!town||!/^[A-Z]{2}$/.test(uf))return null;
    const clean=town.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    return clean?uf+':'+clean:null;
  };
  const radar=new Map();
  let duplicates=0,invalidCities=0;
  for(const city of radarRows){
    const key=keyFrom(city?.city,city?.state);
    if(!key){invalidCities++;continue;}
    if(radar.has(key)){duplicates++;continue;}
    radar.set(key,city);
  }
  const networkGrouped=new Map();
  for(const row of network.rows){
    if(row.cityKey==='__unknown__')continue;
    const list=networkGrouped.get(row.cityKey)||[];
    list.push(row);
    networkGrouped.set(row.cityKey,list);
  }
  const allKeys=new Set([...radar.keys(),...networkGrouped.keys()]);
  const result=[];
  for(const key of allKeys){
    const source=radar.get(key)||null;
    const members=networkGrouped.get(key)||[];
    const label=source?String(source.city||'').trim().slice(0,100)+'/'+String(source.state||'').trim().toUpperCase():
      String(members[0]?.cityLabel||'Cidade não identificada');
    const registered=members.length;
    const available=fresh?members.filter(m=>m.category==='available').length:null;
    const active=members.filter(m=>m.status==='active').length;
    const needingReview=members.filter(m=>m.category==='review'||m.category==='pending'||m.category==='unknown').length;
    const interests=source?sane(source.interested_customers):null;
    const anp=(source?.anp_source_status==='ok')?sane(source.anp_prospects):null;
    const openProspects=source?sane(source.uncontacted):null;
    const overdue=source?sane(source.overdue_followups):null;
    const onboarding=source?sane(source.onboarding):null;
    const ranking=source?sane(source.priority_score):null;
    const eligibleRadar=source?sane(source.eligible_merchants):null;
    const stage=source?.admin_paused===true?'Pausada administrativamente':
      !fresh?'Conferência de fontes necessária':
      available>0?'Oferta confirmada na amostra':
      registered>0?'Revendas cadastradas, oferta não confirmada':
      (interests!==null&&interests>0)||(anp!==null&&anp>0)?'Oportunidade para prospecção':
      'Sem sinais suficientes de demanda';
    result.push({key,label,registered,active,available,needingReview,
      interests,anp,openProspects,overdue,onboarding,ranking,eligibleRadar,
      stage,paused:source?.admin_paused===true,
      hasRadar:!!source,hasMerchants:registered>0,sourceState:source?.anp_source_status||null});
  }
  result.sort((a,b)=>(b.ranking??-1)-(a.ranking??-1)
    ||(b.overdue??-1)-(a.overdue??-1)
    ||a.label.localeCompare(b.label,'pt-BR'));
  return {valid:true,rows:result.slice(0,100),total:result.length,networkFresh:network.fresh,radarFresh,fresh,
    sampled:network.sampled||radarRows.length>=100,duplicates,invalidCities,missingLocation:network.rows.filter(r=>r.cityKey==='__unknown__').length};
}
function adminExpansionBridgeView(d){
  if(!adminRoleCanSection('prospects'))return '';
  const snapshot=adminExpansionBridgeSnapshot(d);
  if(!snapshot.valid)return `<section class='section admin-expansion-bridge' aria-label='Oportunidades por município'>
    <div class='section-head'><div><span class='section-kicker'>PANORAMA COMERCIAL</span><h3>Da demanda à revenda disponível</h3></div></div>
    <div class='notice'>${snapshot.networkValid?'O radar comercial ainda não foi consultado com sucesso.':'A lista de revendas ainda não foi carregada.'}
      Atualize o radar e os dados administrativos para cruzar as informações.</div></section>`;
  const txt=value=>value===null?'—':String(value);
  const items=snapshot.rows.slice(0,12).map(row=>`<div class='admin-expansion-bridge-row'>
    <div class='admin-expansion-bridge-main'><strong>${esc(row.label)}</strong>
      <small>${esc(row.stage)}</small>
      <span class='tiny muted'>Índice interno: ${txt(row.ranking)} • Retornos vencidos: ${txt(row.overdue)}</span></div>
    <div class='admin-expansion-bridge-numbers'>
      <div><small>Interesses registrados</small><strong>${txt(row.interests)}</strong></div>
      <div><small>Prospectos ANP*</small><strong>${txt(row.anp)}</strong></div>
      <div><small>Revendas cadastradas</small><strong>${row.registered}</strong></div>
      <div><small>Ofertáveis verificadas</small><strong>${txt(row.available)}</strong></div>
    </div>
    <div class='admin-expansion-bridge-actions'>
      ${row.hasRadar?`<button type='button' class='secondary small' data-area='${esc(row.key)}'
        onclick="adminOpenExpansionBridgeCity(this.dataset.area,'prospects')">Ver prospectos</button>`:''}
      <button type='button' class='secondary small' data-area='${esc(row.key)}'
        onclick="adminOpenExpansionBridgeCity(this.dataset.area,'partners')" ${row.hasMerchants?'':'disabled title="Nenhuma revenda dessa cidade na amostra"'}>Ver revendas</button>
    </div>
  </div>`).join('');
  return `<section class='section admin-expansion-bridge' aria-label='Oportunidades por município'>
    <div class='section-head'><div><span class='section-kicker'>EXPANSÃO CONECTADA À OPERAÇÃO</span>
      <h3>Da demanda à revenda disponível</h3>
      <p>Compare sinais comerciais, registros ANP e situação das revendas existentes, sem confundir interesse com venda.</p></div>
      <span class='admin-data-freshness'>${snapshot.fresh?'Fontes recentes':'Verificação necessária'}</span></div>
    ${!snapshot.fresh?'<div class="notice danger">Radar ou rede de revendas com dados antigos. A disponibilidade atual e a prioridade de contato devem ser confirmadas novamente.</div>':''}
    ${snapshot.sampled?'<div class="notice">Há limites na amostra do radar ou de revendas. Os totais não representam necessariamente toda a rede nacional.</div>':''}
    ${snapshot.duplicates||snapshot.invalidCities?`<div class='notice'>${snapshot.duplicates} cidade(s) repetida(s) e ${snapshot.invalidCities} localização(ões) inválida(s) no radar foram deixadas de fora da consolidação.</div>`:''}
    <div class='card flat'>
      <p class='tiny muted'>${snapshot.total} município(s) identificado(s) nas fontes recebidas; mostrando até 12.
        ${snapshot.missingLocation} revenda(s) sem município/UF confirmados ficaram fora do agrupamento.
        *A contagem ANP aparece somente quando a consulta da fonte foi confirmada.</p>
      ${items?`<div class='admin-expansion-bridge-list'>${items}</div>`:'<div class="empty">Nenhuma cidade disponível nas informações atuais.</div>'}
      <p class='tiny muted'>“Ofertável” exige evidências válidas do painel de revendas e informação recente. O índice do radar não é previsão de receita; ANP não significa parceria. O radar e os cadastros operacionais têm critérios e horários próprios.</p>
    </div>
  </section>`;
}
function adminOpenExpansionBridgeCity(key,destination){
  if(!adminRoleCanSection('prospects')||adminRuntime.status!=='ready')return;
  if(!['prospects','partners'].includes(destination))return;
  const state=adminExpansionBridgeSnapshot(adminRuntime.data);
  if(!state.valid)return;
  const row=state.rows.find(x=>x.key===key);
  if(!row)return;
  const session=adminRuntime.session;
  if(destination==='prospects'){
    if(!row.hasRadar)return;
    const source=adminRuntime.expansionRadar.find(x=>{
      const uf=String(x?.state||'').trim().toUpperCase();
      const city=String(x?.city||'').trim().normalize('NFD')
        .replace(/[\u0300-\u036f]/g,'').toLowerCase()
        .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      return uf+':'+city===key;
    });
    if(!source)return;
    adminProspectSelectCity(String(source.state).trim().toUpperCase()+'|'+String(source.city).trim());
    return;
  }
  if(!adminRoleCanSection('partners')||!row.hasMerchants)return;
  const network=adminMerchantNetworkSnapshot(adminRuntime.data);
  if(!network.valid||!network.cities.some(x=>x.key===key))return;
  adminRuntime.merchantNetworkCity=key;
  adminRuntime.merchantNetworkStatus='all';
  adminSetSection('partners');
  requestAnimationFrame(()=>{
    if(adminRuntime.status!=='ready'||adminRuntime.session!==session||!adminRoleCanSection('partners'))return;
    document.getElementById('admin-network-city')?.focus({preventScroll:true});
  });
}


/* V1.202 — one verified, navigation-only commercial decision per city. */
function adminCityPipelineSnapshot(d,now=Date.now()){
  const bridge=adminExpansionBridgeSnapshot(d,now);
  if(!bridge.valid)return {valid:false,fresh:false,items:[],totals:null,limited:false};
  if(!bridge.fresh)return {valid:true,fresh:false,items:[],totals:null,limited:bridge.sampled};
  const ordering={paused:0,followup:1,merchant_review:2,first_contact:3,
    onboarding:4,recruitment:5,operating:6,review:7};
  const items=bridge.rows.map(row=>{
    let kind='review',next='Conferir registros e atualizar as informações antes de decidir.';
    if(row.paused){
      kind='paused';next='Revisar a pausa administrativa antes de iniciar novas abordagens.';
    }else if(Number.isSafeInteger(row.overdue)&&row.overdue>0){
      kind='followup';next='Conferir '+row.overdue+' retorno(s) vencido(s) no CRM.';
    }else if(row.hasMerchants&&row.needingReview>0){
      kind='merchant_review';next='Conferir '+row.needingReview+' revenda(s) com pendências na amostra.';
    }else if(Number.isSafeInteger(row.openProspects)&&row.openProspects>0){
      kind='first_contact';next='Avaliar '+row.openProspects+' primeiro(s) contato(s) pendente(s).';
    }else if(Number.isSafeInteger(row.onboarding)&&row.onboarding>0){
      kind='onboarding';next='Acompanhar '+row.onboarding+' empresa(s) em cadastramento.';
    }else if(Number.isSafeInteger(row.interests)&&row.interests>0&&row.available===0){
      kind='recruitment';next='Há interesse registrado, mas nenhuma oferta confirmada nesta amostra.';
    }else if(row.available!==null&&row.available>0){
      kind='operating';next='Acompanhar a oferta confirmada na amostra, sem presumir disponibilidade permanente.';
    }else if(row.hasRadar&&Number.isSafeInteger(row.anp)&&row.anp>0){
      kind='recruitment';next='Consultar revendas registradas na ANP e avaliar possível parceria.';
    }
    return {...row,kind,next,priority:ordering[kind]};
  });
  items.sort((a,b)=>a.priority-b.priority
    ||(b.overdue??-1)-(a.overdue??-1)
    ||(b.ranking??-1)-(a.ranking??-1)
    ||a.label.localeCompare(b.label,'pt-BR')||a.key.localeCompare(b.key));
  const totals={all:items.length,paused:0,followup:0,merchant_review:0,
    first_contact:0,onboarding:0,recruitment:0,operating:0,review:0};
  for(const item of items)totals[item.kind]++;
  return {valid:true,fresh:true,items,totals,limited:bridge.sampled||bridge.total>bridge.rows.length,
    cityCount:bridge.total,missingLocation:bridge.missingLocation};
}
function adminCityPipelineUi(){
  const scope=[String(adminRuntime.session?.user?.id||''),
    String(adminRuntime.lastSyncAt||''),String(adminRuntime.expansionRadarCheckedAt||'')].join('|');
  if(!adminRuntime.cityPipelineUi||adminRuntime.cityPipelineUi.scope!==scope){
    adminRuntime.cityPipelineUi={scope,filter:'all',query:'',page:0};
  }
  return adminRuntime.cityPipelineUi;
}
function adminCityPipelineSetFilter(value){
  if(adminRuntime.status!=='ready'||!adminRoleCanSection('prospects'))return;
  const choices=['all','paused','followup','merchant_review','first_contact',
    'onboarding','recruitment','operating','review'];
  if(!choices.includes(value)||!adminCityPipelineSnapshot(adminRuntime.data).fresh)return;
  const ui=adminCityPipelineUi();
  ui.filter=value;ui.page=0;render();
}
function adminCityPipelineSetSearch(value){
  if(adminRuntime.status!=='ready'||!adminRoleCanSection('prospects'))return;
  if(!adminCityPipelineSnapshot(adminRuntime.data).fresh)return;
  const query=String(value||'').trim().slice(0,80);
  const ui=adminCityPipelineUi();
  ui.query=query;ui.page=0;render();
}
function adminCityPipelinePage(direction){
  if(adminRuntime.status!=='ready'||!adminRoleCanSection('prospects')||![-1,1].includes(direction))return;
  const snapshot=adminCityPipelineSnapshot(adminRuntime.data);
  if(!snapshot.fresh)return;
  const ui=adminCityPipelineUi();
  const subset=snapshot.items.filter(row=>(ui.filter==='all'||row.kind===ui.filter)
    &&row.label.toLocaleLowerCase('pt-BR').includes(ui.query.toLocaleLowerCase('pt-BR')));
  const last=Math.max(0,Math.ceil(subset.length/8)-1);
  const page=Math.min(last,Math.max(0,ui.page+direction));
  if(page===ui.page)return;
  ui.page=page;render();
}
function adminCityPipelineOpen(key,destination){
  if(adminRuntime.status!=='ready'||!adminRoleCanSection('prospects'))return;
  if(!['prospects','partners'].includes(destination))return;
  const snapshot=adminCityPipelineSnapshot(adminRuntime.data);
  if(!snapshot.valid||!snapshot.fresh)return;
  const row=snapshot.items.find(x=>x.key===key);
  if(!row)return;
  if(destination==='prospects'&&!row.hasRadar)return;
  if(destination==='partners'&&(!row.hasMerchants||!adminRoleCanSection('partners')))return;
  adminOpenExpansionBridgeCity(key,destination);
}
/* V1.203 — practical municipal expansion playbook backed only by verified source snapshots. */
function adminCityPlanSteps(row){
  const count=x=>Number.isSafeInteger(x)&&x>=0?x:null;
  const interests=count(row.interests),anp=count(row.anp),uncontacted=count(row.openProspects),
    overdue=count(row.overdue),onboarding=count(row.onboarding),available=count(row.available),
    registered=count(row.registered),review=count(row.needingReview);
  const result=[];
  result.push({label:'Conferir interesse dos clientes',
    state:interests===null?'unknown':interests>0?'observed':'attention',
    detail:interests===null?'Quantidade de interessados não confirmada pela fonte.':
      interests>0?interests+' interesse(s) registrado(s) na amostra; não representam pedidos.':
      'Nenhum interesse identificado nesta amostra, sem concluir ausência de demanda.'});
  result.push({label:'Localizar revendas e conferir ANP',
    state:anp===null?'unknown':anp>0?'observed':'attention',
    detail:anp===null?'A consulta ANP não está confirmada. Não presuma inexistência de revendas.':
      anp>0?anp+' registro(s) GLP na ANP consultada; ainda não são parceiros.':
      'Nenhum registro ANP identificado na consulta atual; revisar cobertura da fonte.'});
  result.push({label:'Registrar contatos e próximos retornos',
    state:(overdue!==null&&overdue>0)||(uncontacted!==null&&uncontacted>0)?'attention':
      overdue===null||uncontacted===null?'unknown':'observed',
    detail:overdue!==null&&overdue>0?overdue+' retorno(s) vencido(s). Conferir histórico e reagendar manualmente.':
      uncontacted!==null&&uncontacted>0?uncontacted+' prospecto(s) aguardando abordagem. Confirmar contato realizado antes de registrá-lo.':
      overdue===null||uncontacted===null?'Dados de contato incompletos: consultar o CRM da cidade.':
      'Sem pendências de primeiro contato ou retorno nesta amostra; não comprova contato realizado.'});
  result.push({label:'Acompanhar cadastro e habilitação da revenda',
    state:review!==null&&review>0||onboarding!==null&&onboarding>0?'attention':
      registered===null?'unknown':registered>0?'observed':'attention',
    detail:(registered===null?'Cadastro de revendas não confirmado.':registered+' revenda(s) cadastrada(s) na amostra.')+
      (onboarding!==null&&onboarding>0?' '+onboarding+' prospecto(s) sinalizado(s) em cadastramento.':'')+
      (review!==null&&review>0?' '+review+' revenda(s) exigem revisão.':'')+
      ' Cadastro não significa habilitação.'});
  result.push({label:'Verificar elegibilidade e ofertas reais',
    state:row.paused?'blocked':available===null?'unknown':available>0?'observed':'attention',
    detail:row.paused?'Cidade pausada pelo administrador. Revisar a pausa antes de qualquer liberação.':
      available===null?'Disponibilidade não verificada; a ausência de dados não significa ausência de ofertas.':
      available>0?available+' revenda(s) com oferta confirmada na amostra; confirmar condições no momento do pedido.':
      'Nenhuma oferta confirmada nesta amostra; habilitação exige requisitos reais de produto, estoque e entrega.'});
  return result;
}
function adminCityPlanView(row){
  const status={observed:'Sinal na fonte',attention:'Precisa de atenção',
    unknown:'Não verificado',blocked:'Pausa administrativa'};
  const steps=adminCityPlanSteps(row);
  const list=steps.map((step,index)=>`<li class='admin-city-plan-step'>
    <div><strong>${index+1}. ${esc(step.label)}</strong>
      <span class='admin-city-plan-status ${step.state}'>${esc(status[step.state])}</span></div>
    <small>${esc(step.detail)}</small></li>`).join('');
  const canProspect=row.hasRadar===true;
  const canPartners=row.hasMerchants===true&&adminRoleCanSection('partners');
  return `<details class='admin-city-plan'>
    <summary>Roteiro de expansão • 5 verificações</summary>
    <p class='tiny muted'>Sinais de trabalho, não tarefas automaticamente concluídas. Reavalie os dados antes de agir.</p>
    <ol class='admin-city-plan-steps'>${list}</ol>
    <div class='admin-city-plan-actions'>
      <button type='button' class='secondary small' data-city-key='${esc(row.key)}'
        onclick='adminCityPipelineOpen(this.dataset.cityKey,"prospects")'
        ${canProspect?'':'disabled title="Sem fonte ANP consultável nesta cidade"'}>Conferir prospectos</button>
      <button type='button' class='secondary small' data-city-key='${esc(row.key)}'
        onclick='adminCityPipelineOpen(this.dataset.cityKey,"partners")'
        ${canPartners?'':'disabled title="Sem cadastro consultável ou permissão"'}>Conferir revendas</button>
      <button type='button' class='secondary small' data-city-key='${esc(row.key)}'
        onclick='adminCityPlanCopy(this.dataset.cityKey)'>Copiar resumo</button>
    </div>
    <p class='tiny muted'>Somente consultas e cópia local. Nenhuma mensagem, convite, cadastro ou ativação é feita por este roteiro.</p>
  </details>`;
}
async function adminCityPlanCopy(key){
  if(adminRuntime.status!=='ready'||!adminRoleCanSection('prospects'))return;
  const session=adminRuntime.session;
  const snapshot=adminCityPipelineSnapshot(adminRuntime.data);
  if(!snapshot.valid||!snapshot.fresh)return;
  const row=snapshot.items.find(x=>x.key===key);
  if(!row)return;
  const lines=['TAMÃO — Roteiro comercial de '+row.label,
    'Resumo da amostra consultada; não é confirmação de abertura ou de ofertas.',
    'Prioridade: '+row.next,
    ...adminCityPlanSteps(row).map((step,i)=>(i+1)+'. '+step.label+' — '+step.detail)];
  if(adminRuntime.session!==session||adminRuntime.status!=='ready')return;
  try{
    if(typeof navigator==='undefined'||!navigator.clipboard?.writeText)
      throw new Error('Clipboard indisponível');
    await navigator.clipboard.writeText(lines.join('\n'));
    if(adminRuntime.status==='ready'&&adminRuntime.session===session)toast('Resumo da cidade copiado');
  }catch{
    if(adminRuntime.status==='ready'&&adminRuntime.session===session)
      toast('Não foi possível copiar. Verifique a permissão da área de transferência.');
  }
}

/* V1.204 — city commercial evidence signals and session-only comparable reference. */
function adminCityEvolutionStage(row){
  const count=x=>Number.isSafeInteger(x)&&x>=0?x:null;
  const available=count(row.available),registered=count(row.registered),
    onboarding=count(row.onboarding),anp=count(row.anp),
    uncontacted=count(row.openProspects),interests=count(row.interests);
  if(row.paused===true)return {id:'paused',label:'Pausada pelo administrador'};
  if(available!==null&&available>0)return {id:'offer',label:'Oferta verificada na amostra'};
  if(registered!==null&&registered>0)return {id:'registered',label:'Revenda cadastrada; oferta pendente'};
  if(onboarding!==null&&onboarding>0)return {id:'onboarding',label:'Cadastramento sinalizado'};
  if(anp!==null&&anp>0||uncontacted!==null&&uncontacted>0)
    return {id:'prospecting',label:'Prospecção identificada'};
  if(interests!==null&&interests>0)return {id:'interest',label:'Interesse registrado'};
  return {id:'unknown',label:'Evidência comercial inconclusiva'};
}
function adminCityEvolutionSnapshot(d,now=Date.now()){
  const src=adminCityPipelineSnapshot(d,now);
  if(!src.valid)return {valid:false,fresh:false,rows:[],totals:null,status:'invalid'};
  if(!src.fresh)return {valid:true,fresh:false,rows:[],totals:null,status:'stale'};
  const counts={paused:0,offer:0,registered:0,onboarding:0,prospecting:0,interest:0,unknown:0};
  const safe=x=>Number.isSafeInteger(x)&&x>=0?x:null;
  const rows=src.items.map(item=>{
    const stage=adminCityEvolutionStage(item);
    counts[stage.id]++;
    return {key:item.key,label:item.label,paused:item.paused===true,stage:stage.id,
      stageLabel:stage.label,interests:safe(item.interests),registered:safe(item.registered),
      available:safe(item.available),overdue:safe(item.overdue)};
  });
  let reference=adminRuntime.cityEvolutionBaseline||null,status='none',changes=new Map();
  const user=String(adminRuntime.session?.user?.id||'');
  if(reference&&reference.user!==user)reference=null;
  if(reference){
    const aged=now-reference.capturedAt;
    const sameRange=Number.isFinite(aged)&&aged>=0&&aged<=24*60*60*1000;
    const radarTime=Date.parse(String(adminRuntime.expansionRadarCheckedAt||''));
    const merchantTime=Date.parse(String(adminRuntime.lastSyncAt||''));
    if(!sameRange){status='expired';}
    else if(src.limited||reference.limited){status='limited';}
    else if(!(radarTime>reference.radarTime&&merchantTime>reference.merchantTime)){
      status='waiting';
    }else if(rows.length!==reference.rows.length||
      rows.some(r=>!reference.rows.some(old=>old.key===r.key))){
      status='coverage';
    }else{
      status='compared';
      const earlier=new Map(reference.rows.map(row=>[row.key,row]));
      for(const row of rows){
        const old=earlier.get(row.key);
        if(!old)continue;
        const delta={};
        for(const key of ['interests','registered','available','overdue']){
          delta[key]=old[key]!==null&&row[key]!==null?row[key]-old[key]:null;
        }
        changes.set(row.key,{from:old.stage,to:row.stage,fromLabel:old.stageLabel,
          toLabel:row.stageLabel,delta});
      }
    }
  }
  return {valid:true,fresh:true,rows,totals:counts,status,changes,reference,
    limited:src.limited,cityCount:src.cityCount};
}
function adminCityEvolutionCapture(){
  if(adminRuntime.status!=='ready'||!adminRoleCanSection('prospects'))return;
  const snapshot=adminCityEvolutionSnapshot(adminRuntime.data);
  if(!snapshot.valid||!snapshot.fresh||snapshot.limited)return;
  const radarTime=Date.parse(String(adminRuntime.expansionRadarCheckedAt||''));
  const merchantTime=Date.parse(String(adminRuntime.lastSyncAt||''));
  if(!Number.isFinite(radarTime)||!Number.isFinite(merchantTime))return;
  const user=String(adminRuntime.session?.user?.id||'');
  if(!user)return;
  adminRuntime.cityEvolutionBaseline={user,capturedAt:Date.now(),radarTime,merchantTime,
    rows:snapshot.rows.map(({key,stage,stageLabel,interests,registered,available,overdue})=>
      ({key,stage,stageLabel,interests,registered,available,overdue})),
    limited:false};
  render();
}
function adminCityEvolutionClear(){
  if(adminRuntime.status!=='ready'||!adminRoleCanSection('prospects'))return;
  adminRuntime.cityEvolutionBaseline=null;
  render();
}
async function adminCityEvolutionRefresh(){
  if(adminRuntime.status!=='ready'||!adminRoleCanSection('prospects')||
    adminRuntime.cityEvolutionRefreshing)return;
  const session=adminRuntime.session;
  adminRuntime.cityEvolutionRefreshing=true;
  render();
  try{
    await adminRefresh({silent:true});
    if(adminRuntime.status!=='ready'||adminRuntime.session!==session||
      !adminRoleCanSection('prospects'))return;
    await adminLoadExpansionRadar();
  }catch{
    if(adminRuntime.status==='ready'&&adminRuntime.session===session)
      toast('Não foi possível atualizar as duas fontes. Confira os avisos do painel.');
  }finally{
    if(adminRuntime.session===session){
      adminRuntime.cityEvolutionRefreshing=false;
      render();
    }
  }
}
function adminCityEvolutionCityNote(key,evolution){
  const row=evolution.rows.find(x=>x.key===key);
  if(!row)return '';
  const current=`<span class='admin-evolution-stage'>Momento observado: ${esc(row.stageLabel)}</span>`;
  if(evolution.status!=='compared')return current;
  const change=evolution.changes.get(key);
  if(!change)return current;
  const labels={interests:'interesses',registered:'revendas cadastradas',
    available:'ofertas verificadas',overdue:'retornos vencidos'};
  const differences=Object.entries(change.delta).filter(([,v])=>v!==null&&v!==0)
    .map(([key,v])=>labels[key]+' '+(v>0?'+':'')+v);
  const stageChange=change.from===change.to?'Mesmo tipo de sinal':
    'Mudança de sinal: '+change.fromLabel+' → '+change.toLabel;
  return current+`<small class='admin-evolution-delta'>${esc(stageChange)}${differences.length?' • '+esc(differences.join(' • ')):''}</small>`;
}
function adminCityEvolutionView(evolution){
  const heading="<div class='section-head'><div><span class='section-kicker'>AVANÇO COMERCIAL</span>"+
    "<h4>Como estão evoluindo as cidades?</h4><p>Compare duas consultas verificadas, sem supor que os mesmos clientes se tornaram compradores.</p></div></div>";
  const status=evolution.status;
  const actions=`<div class='admin-evolution-actions'>
    <button type='button' class='secondary small' onclick='adminCityEvolutionCapture()'
      ${evolution.limited?'disabled title="Amostra parcial não pode ser referência confiável"':''}>Marcar referência</button>
    <button type='button' class='secondary small' onclick='adminCityEvolutionRefresh()'
      ${adminRuntime.cityEvolutionRefreshing?'disabled':''}>Atualizar as duas fontes</button>
    ${evolution.reference?"<button type='button' class='secondary small' onclick='adminCityEvolutionClear()'>Limpar referência</button>":''}
  </div>`;
  const notice=status==='none'?'Marque uma referência para começar. Ela fica apenas nesta sessão administrativa; não é histórico permanente.':
    status==='waiting'?'Referência guardada. Atualize o radar e os cadastros para comparar duas consultas distintas.':
    status==='expired'?'A referência tem mais de 24 horas. Marque uma nova para evitar comparações indevidas.':
    status==='coverage'?'A cobertura de municípios mudou entre consultas; não calculamos variações de amostras diferentes. Marque nova referência.':
    status==='limited'?'A amostra de uma das consultas é limitada; não é seguro comparar mudanças.':
    status==='compared'?'Comparação de sinais concluída. Diferenças de contagens não comprovam conversão individual, vendas ou crescimento do mercado.':
    'Conferência das fontes necessária.';
  const indicators=[
    ['interest','Interesse registrado'],['prospecting','Prospecção identificada'],
    ['onboarding','Em cadastramento'],['registered','Revenda cadastrada'],
    ['offer','Oferta verificada'],['paused','Pausadas'],['unknown','Inconclusivas']
  ];
  const cards=indicators.map(([key,label])=>
    `<div><strong>${evolution.totals[key]}</strong><small>${label}</small></div>`).join('');
  return `<div class='admin-city-evolution' aria-label='Evolução de sinais comerciais por cidade'>
    ${heading}
    <div class='admin-evolution-kpis'>${cards}</div>
    <p class='tiny muted'>${evolution.rows.length} cidade(s) na amostra atual, agrupadas pelo sinal comercial mais avançado identificado. Etapas são indicativas, não um funil de clientes únicos.</p>
    ${evolution.limited?'<div class="notice">Amostra parcial: os indicadores não representam toda a rede.</div>':''}
    <div class='notice' role='status'>${esc(notice)}</div>
    ${actions}
  </div>`;
}

/* V1.205 — immutable, server-derived commercial history (no individual conversion inference). */
function adminCityHistoryReset(){
  adminRuntime.cityHistory={items:[],loading:false,loaded:false,error:null,loadedFor:null,chosen:null,scheduler:null,health:null};
}
async function adminLoadCityHistory({force=false}={}){
  if(!adminReady()||!adminRoleCanSection('prospects'))return;
  if(!adminRuntime.cityHistory)adminCityHistoryReset();
  const state=adminRuntime.cityHistory;
  const user=String(adminRuntime.session?.user?.id||'');
  if(state.loading||!user||!force&&(state.loaded&&state.loadedFor===user))return;
  state.loading=true;state.error=null;
  try{
    const data=await adminInvoke({action:'commercial-history-list'});
    if(!adminReady()||!adminRoleCanSection('prospects')||
      String(adminRuntime.session?.user?.id||'')!==user)return;
    if(data?.source!=='database_authoritative'||!Array.isArray(data?.snapshots))
      throw new Error('O servidor não confirmou a origem do histórico.');
    state.items=data.snapshots.slice(0,16);
    state.loaded=true;
    state.loadedFor=user;
    state.scheduler=data.scheduler?.cadence==='daily'&&typeof data.scheduler.active==='boolean'
      ?data.scheduler:null;
    state.health=adminCityHistoryValidatedHealth(data.health);
    if(!state.items.some(x=>x.id===state.chosen))state.chosen=null;
  }catch(error){
    if(adminReady()&&String(adminRuntime.session?.user?.id||'')===user){
      state.error=String(error?.message||error);
      state.loaded=false;state.items=[];state.scheduler=null;state.health=null;
    }
  }finally{
    if(adminRuntime.cityHistory===state){state.loading=false;render();}
  }
}
async function adminCaptureCityHistory(){
  if(!adminReady()||!['superadmin','operations'].includes(String(adminCurrentRole())))return;
  if(!adminRuntime.cityHistory)adminCityHistoryReset();
  const state=adminRuntime.cityHistory;
  if(state.loading||state.saving)return;
  const user=String(adminRuntime.session?.user?.id||'');
  state.saving=true;state.error=null;render();
  try{
    const result=await adminInvoke({action:'commercial-history-capture'},
      {idempotencyKey:adminIdempotency('commercial-history')});
    if(!adminReady()||String(adminRuntime.session?.user?.id||'')!==user)return;
    if(result?.source!=='server_authoritative'||!result.id)
      throw new Error('O registro não foi confirmado pelo banco.');
    toast(result.inserted?'Retrato comercial registrado no histórico.':
      'Já existe um retrato deste horário; nenhum registro duplicado foi criado.');
    await adminLoadCityHistory({force:true});
  }catch(error){
    if(adminReady()&&String(adminRuntime.session?.user?.id||'')===user)
      state.error=String(error?.message||error);
  }finally{
    if(adminRuntime.cityHistory===state){state.saving=false;render();}
  }
}
function adminChooseCityHistory(id){
  if(!adminReady()||!adminRoleCanSection('prospects'))return;
  const state=adminRuntime.cityHistory;
  if(!state?.loaded||state.loadedFor!==String(adminRuntime.session?.user?.id||''))return;
  if(id!==''&&!state.items.some(x=>x.id===id))return;
  state.chosen=id||null;render();
}
function adminCityHistoryCompare(items,chosen){
  const rows=Array.isArray(items)?items:[];
  const latest=rows[0]||null;
  const older=rows.find(x=>x.id===chosen&&x.id!==latest?.id)||rows[1]||null;
  if(!latest||!older)return {status:'insufficient',latest,older,changes:[]};
  if(latest.sampled||older.sampled)return {status:'sampled',latest,older,changes:[]};
  if(!Array.isArray(latest.rows)||!Array.isArray(older.rows)||
    latest.rows.length!==older.rows.length||
    latest.cityCount!==older.cityCount||
    latest.rows.some(x=>!older.rows.some(y=>y.key===x.key))){
    return {status:'coverage',latest,older,changes:[]};
  }
  const count=x=>Number.isSafeInteger(x)&&x>=0?x:null;
  const old=new Map(older.rows.map(x=>[x.key,x]));
  const changes=latest.rows.map(row=>{
    const prior=old.get(row.key);
    const metrics={};
    for(const key of ['interests','registered','eligible','overdue']){
      const before=count(prior?.[key]),after=count(row[key]);
      metrics[key]=before!==null&&after!==null?after-before:null;
    }
    return {key:String(row.key),label:String(row.label),metrics,
      pausedChanged:row.paused!==prior.paused};
  }).filter(item=>item.pausedChanged||
    Object.values(item.metrics).some(value=>value!==null&&value!==0));
  return {status:'comparable',latest,older,changes};
}
/* V1.207 — sanitize server-computed cron health; never infer healthy from "active". */
function adminCityHistoryValidatedHealth(value){
  const allowed=['healthy','awaiting_first','in_grace','missing_capture','run_failed',
    'job_missing','job_disabled','job_changed','watchdog_missing',
    'watchdog_disabled','watchdog_changed','watchdog_late'];
  if(!value||!allowed.includes(value.status))return null;
  const fields=['asOf','expectedAt','firstDueAt','lastCaptureAt',
    'lastScheduledAt','lastWatchdogAt'];
  for(const field of fields){
    const t=value[field];
    if(t!==null&&t!==undefined&&!Number.isFinite(Date.parse(String(t))))return null;
  }
  if(value.cronRunStatus!=null&&
    !['succeeded','failed','running','unknown'].includes(value.cronRunStatus))return null;
  if(value.lastWatchdogStatus!=null&&!allowed.includes(value.lastWatchdogStatus))return null;
  return {
    status:value.status,asOf:String(value.asOf||''),
    expectedAt:String(value.expectedAt||''),
    lastCaptureAt:value.lastCaptureAt||null,
    lastScheduledAt:value.lastScheduledAt||null,
    lastWatchdogAt:value.lastWatchdogAt||null,
    lastWatchdogStatus:value.lastWatchdogStatus||null,
    cronRunStatus:value.cronRunStatus||null,
    captureJobActive:value.captureJobActive===true,
    watchdogJobActive:value.watchdogJobActive===true
  };
}
function adminCityHistoryHealthView(value){
  const labels={
    healthy:['Captura diária confirmada','Último período esperado com captura comprovada no banco.','ok'],
    awaiting_first:['Primeira execução programada','O horário da primeira coleta ainda não chegou.','neutral'],
    in_grace:['Coleta dentro do prazo','A execução prevista ainda está dentro da janela de tolerância de 40 minutos.','neutral'],
    missing_capture:['Captura diária atrasada','Passou a tolerância de 40 minutos e não há confirmação válida de captura automática.','danger'],
    run_failed:['Falha registrada pelo agendador','O PostgreSQL registrou falha na execução programada.','danger'],
    job_missing:['Agendamento de captura ausente','A tarefa diária não está registrada no PostgreSQL.','danger'],
    job_disabled:['Agendamento de captura desativado','A tarefa diária foi desativada.','danger'],
    job_changed:['Configuração de captura alterada','Horário, executor ou comando não correspondem à configuração esperada.','danger'],
    watchdog_missing:['Monitor independente ausente','A verificação diária não está registrada no PostgreSQL.','danger'],
    watchdog_disabled:['Monitor independente desativado','A verificação diária está desativada.','danger'],
    watchdog_changed:['Configuração do monitor alterada','A tarefa de verificação não corresponde à configuração esperada.','danger'],
    watchdog_late:['Verificação independente atrasada','A captura existe, mas o monitor não registrou a conferência esperada.','danger']
  };
  if(!value)return "<div class='notice'>Saúde das capturas não verificada pelo servidor. Consulte o histórico novamente.</div>";
  const [title,detail,level]=labels[value.status]||labels.awaiting_first;
  const date=x=>{
    if(!x)return 'Ainda não registrada';
    const t=Date.parse(String(x));
    return Number.isFinite(t)?new Date(t).toLocaleString('pt-BR'):'Data não verificada';
  };
  return `<div class='admin-history-health' role='status' aria-live='polite'>
    <div class='notice ${level==='danger'?'danger':''}'>
      <strong>${esc(title)}</strong>
      <p>${esc(detail)}</p>
      <p class='tiny'>Próximo período de referência: ${esc(date(value.expectedAt))} •
        Última captura automática: ${esc(date(value.lastScheduledAt))} •
        Última verificação do monitor: ${esc(date(value.lastWatchdogAt))}</p>
      ${level==='danger'?'<p class="tiny">Confira a execução no Supabase Cron e os registros de falha antes de considerar o histórico atual.</p>':''}
    </div>
  </div>`;
}

function adminCityCommercialHistoryView(){
  if(!adminRoleCanSection('prospects')||!adminReady())return '';
  const state=adminRuntime.cityHistory||{items:[],loading:false,loaded:false,error:null,chosen:null,scheduler:null,health:null};
  const permitted=['superadmin','operations'].includes(String(adminCurrentRole()));
  const items=state.loadedFor===String(adminRuntime.session?.user?.id||'')&&
    Array.isArray(state.items)?state.items:[];
  const compare=adminCityHistoryCompare(items,state.chosen);
  const labelDate=value=>{
    const t=Date.parse(String(value||''));
    return Number.isFinite(t)?new Date(t).toLocaleString('pt-BR'):'Data não verificada';
  };
  const note=compare.status==='insufficient'?'A comparação exige dois retratos de horários diferentes; a coleta diária é automática quando o agendamento está ativo.':
    compare.status==='sampled'?'Uma das consultas contém apenas parte dos municípios. Diferenças não serão calculadas.':
    compare.status==='coverage'?'Os municípios não são os mesmos nas duas consultas. Diferenças bloqueadas para evitar conclusões incorretas.':
    'Comparação de contagens entre duas capturas do servidor, sem provar conversão de pessoas, vendas ou participação de mercado.';
  const metricLabels={interests:'interesses',registered:'revendas cadastradas',
    eligible:'revendas aptas',overdue:'retornos vencidos'};
  const changed=compare.changes.slice(0,12).map(row=>{
    const deltas=Object.entries(row.metrics).filter(([,v])=>v!==null&&v!==0)
      .map(([key,v])=>metricLabels[key]+': '+(v>0?'+':'')+v);
    if(row.pausedChanged)deltas.push('pausa administrativa alterada');
    return `<div class='admin-city-history-item'><strong>${esc(row.label)}</strong>
      <small>${esc(deltas.join(' • '))}</small></div>`;
  }).join('');
  return `<section class='section admin-city-history' aria-label='Histórico comercial persistente'>
    <div class='section-head'><div><span class='section-kicker'>HISTÓRICO COMERCIAL</span>
      <h3>Evolução registrada no banco</h3><p>Retratos oficiais por cidade, guardados para consultas futuras e auditados no servidor.</p></div></div>
    <div class='admin-city-history-actions'>
      <button type='button' class='secondary small' onclick='adminLoadCityHistory({force:true})'
        ${state.loading?'disabled':''}>Consultar histórico</button>
      ${permitted?`<button type='button' class='primary small' onclick='adminCaptureCityHistory()'
        ${state.loading||state.saving?'disabled':''}>Registrar retrato agora</button>`:''}
    </div>
    ${state.error?`<div class='notice danger'>${esc(state.error)}</div>`:''}
    ${state.loading?'<p class="tiny muted">Consultando histórico do servidor…</p>':''}
    ${!state.loaded&&!state.loading&&!state.error?'<p class="tiny muted">O histórico será consultado ao abrir Prospectos.</p>':''}
    <p class='tiny muted'>Até 16 retratos recentes, no máximo um por hora para toda a administração. Capturas diárias são feitas pelo PostgreSQL, sem depender de abrir o painel.</p>
    ${state.loaded&&state.loadedFor===String(adminRuntime.session?.user?.id||'')?`<p class='tiny muted' role='status'>Agendamento diário: ${state.scheduler?.active===true?'ativo, às 09h18 (horário de Brasília)':state.scheduler?.active===false?'inativo — conferência necessária':'não verificado'}.</p>`:''}
    ${state.loaded&&state.loadedFor===String(adminRuntime.session?.user?.id||'')?adminCityHistoryHealthView(state.health):''}
    ${items.length?`<div class='admin-city-history-compare'>
      <div><strong>Retrato mais recente</strong><small>${esc(labelDate(items[0].capturedAt))}
        • ${Number(items[0].cityCount)||0} cidade(s) registradas
        ${items[0].sampled?' • Amostra limitada':''} • ${items[0].origin==='scheduled'?'Automático':'Manual'}</small></div>
      <div><label for='admin-history-reference'>Comparar com</label>
        <select class='input' id='admin-history-reference' onchange='adminChooseCityHistory(this.value)'>
          ${items.slice(1).map(x=>`<option value='${esc(x.id)}'
            ${x.id===compare.older?.id?'selected':''}>${esc(labelDate(x.capturedAt))}${x.sampled?' (amostra)':''}${x.origin==='scheduled'?' (automático)':' (manual)'}</option>`).join('')}
        </select></div>
    </div>`:''}
    <div class='notice'>${esc(note)}</div>
    ${compare.status==='comparable'?`<p class='tiny muted'>${compare.changes.length} cidade(s) com sinais alterados.
      ${compare.changes.length>12?'Exibindo as primeiras 12.':''}</p>
      ${changed?`<div class='admin-city-history-list'>${changed}</div>`:
        '<p class="tiny muted">Nenhuma mudança detectada nessas contagens entre as duas consultas.</p>'}`:''}
    <p class='tiny muted'>Registros ANP não são parceiros confirmados; revenda apta neste retrato não garante oferta futura.
      Esta série não mede taxa de conversão, faturamento ou vendas reais.</p>
  </section>`;
}

function adminCityPipelineView(d){
  if(!adminRoleCanSection('prospects')||adminRuntime.status!=='ready')return '';
  const snapshot=adminCityPipelineSnapshot(d);
  const heading="<div class='section-head'><div><span class='section-kicker'>PLANEJAMENTO DE EXPANSÃO</span>"+
    "<h3>Visão comercial por cidades</h3><p>Uma próxima ação sugerida por município, com base nos sinais comprovados das fontes atuais.</p></div></div>";
  if(!snapshot.valid)return "<section class='section admin-city-pipeline'>"+heading+
    "<div class='notice'>Consulte o radar e atualize os dados de revendas para comparar as cidades. Sem dados confirmados, não há ranking operacional.</div></section>";
  if(!snapshot.fresh)return "<section class='section admin-city-pipeline'>"+heading+
    "<div class='notice danger'>Informações desatualizadas. Atualize o radar e os cadastros antes de tomar decisões; não é possível concluir que não existem pendências.</div></section>";
  const labels={all:'Todas as cidades',paused:'Pausa administrativa',followup:'Retornos vencidos',
    merchant_review:'Revendas para revisão',first_contact:'Primeiro contato',
    onboarding:'Em cadastramento',recruitment:'Captar novas revendas',
    operating:'Oferta confirmada',review:'Conferir informações'};
  const ui=adminCityPipelineUi();
  const filter=Object.prototype.hasOwnProperty.call(labels,ui.filter)?ui.filter:'all';
  const query=String(ui.query||'');
  const rows=snapshot.items.filter(row=>(filter==='all'||row.kind===filter)
    &&row.label.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
  const last=Math.max(0,Math.ceil(rows.length/8)-1);
  const page=Math.min(last,Math.max(0,ui.page));ui.page=page;
  const start=page*8;
  const txt=value=>value===null?'—':String(value);
  const evolution=adminCityEvolutionSnapshot(d);
  const cards=rows.slice(start,start+8).map(row=>{
    const target=row.hasRadar?'prospects':row.hasMerchants?'partners':null;
    const accessible=target&&(target==='prospects'||adminRoleCanSection('partners'));
    return `<article class='admin-city-pipeline-row'>
      <div class='admin-city-pipeline-main'>
        <span class='admin-city-pipeline-kind'>${esc(labels[row.kind])}</span>
        <strong>${esc(row.label)}</strong>
        ${adminCityEvolutionCityNote(row.key,evolution)}
        <small>${esc(row.next)}</small>
        <small>Interesses: ${txt(row.interests)} • ANP verificada: ${txt(row.anp)} •
          Revendas cadastradas: ${row.registered} • Ofertas confirmadas na amostra: ${txt(row.available)}</small>
        ${adminCityPlanView(row)}
      </div>
      <button type='button' class='secondary small' data-city-key='${esc(row.key)}'
        data-target='${target||''}' onclick='adminCityPipelineOpen(this.dataset.cityKey,this.dataset.target)'
        ${accessible?'':'disabled title="Sem registro consultável ou permissão"'}>Conferir cidade</button>
    </article>`;
  }).join('');
  return `<section class='section admin-city-pipeline' aria-label='Visão comercial por cidades'>
    ${heading}
    ${adminCityEvolutionView(evolution)}
    ${snapshot.limited?'<div class="notice">Radar ou lista de revendas com amostra limitada. Esta visão pode não incluir todos os municípios.</div>':''}
    <div class='admin-city-pipeline-kpis'>
      <div><strong>${snapshot.totals.all}</strong><small>Cidades na amostra</small></div>
      <div><strong>${snapshot.totals.followup}</strong><small>Com retornos vencidos prioritários</small></div>
      <div><strong>${snapshot.totals.recruitment}</strong><small>Com captação sugerida</small></div>
      <div><strong>${snapshot.totals.operating}</strong><small>Com ofertas confirmadas na amostra</small></div>
    </div>
    <div class='card flat'>
      <div class='admin-city-pipeline-toolbar'>
        <div><label for='admin-city-pipeline-filter'>Situação principal</label>
          <select class='input' id='admin-city-pipeline-filter' onchange='adminCityPipelineSetFilter(this.value)'>
            ${Object.entries(labels).map(([value,label])=>`<option value='${value}' ${filter===value?'selected':''}>${esc(label)} (${snapshot.totals[value]})</option>`).join('')}
          </select></div>
        <div><label for='admin-city-pipeline-search'>Buscar município ou UF</label>
          <input class='input' id='admin-city-pipeline-search' type='search' maxlength='80'
            value='${esc(query)}' placeholder='Ex.: São Gabriel' onchange='adminCityPipelineSetSearch(this.value)'>
          <small>Pressione Enter ou saia do campo para aplicar.</small></div>
      </div>
      <p class='tiny muted'>${rows.length} cidade(s) nesta seleção •
        ${rows.length?start+1:0}–${Math.min(start+8,rows.length)} exibida(s) •
        ${snapshot.missingLocation} cadastro(s) sem município válido fora do agrupamento.</p>
      ${cards?`<div class='admin-city-pipeline-list'>${cards}</div>`:
        '<p class="tiny muted">Nenhuma cidade corresponde aos filtros nesta amostra. Isso não comprova ausência de demanda.</p>'}
      <div class='admin-city-pipeline-paging'>
        <button class='secondary small' type='button' onclick='adminCityPipelinePage(-1)' ${page===0?'disabled':''}>Anterior</button>
        <small aria-live='polite'>Página ${page+1} de ${last+1}</small>
        <button class='secondary small' type='button' onclick='adminCityPipelinePage(1)' ${page===last?'disabled':''}>Próximas</button>
      </div>
      <p class='tiny muted'>Cada cidade aparece uma vez, pela pendência considerada mais prioritária; outras pendências continuam nas listas detalhadas.
        Consultar não gera contato, convite, ativação ou cobrança. ANP não equivale a parceria; índice de prioridade não é previsão de faturamento.</p>
    </div>
  </section>`;
}

/* V1.199 — navigation-only commercial priorities, sourced from the verified city bridge. */
function adminCommercialOpportunitySnapshot(d,now=Date.now()){
  const bridge=adminExpansionBridgeSnapshot(d,now);
  if(!bridge.valid)return {valid:false,fresh:false,items:[],totals:null,limited:false};
  if(!bridge.fresh)return {valid:true,fresh:false,items:[],totals:null,limited:bridge.sampled,
    cityCount:bridge.total,missingLocation:bridge.missingLocation};
  const priorities={overdue:0,paused:1,first_contact:2,onboarding:3,supply_gap:4,merchant_review:5};
  const labels={
    overdue:'Retorno comercial vencido',
    paused:'Cidade com operação pausada',
    first_contact:'Prospectos aguardando contato',
    onboarding:'Parceiros em cadastramento',
    supply_gap:'Interesse sem oferta confirmada',
    merchant_review:'Revendas aguardando revisão'
  };
  const items=[],totals={overdue:0,paused:0,first_contact:0,onboarding:0,supply_gap:0,merchant_review:0};
  for(const city of bridge.rows){
    const add=(kind,count,detail)=>{
      if(!Number.isSafeInteger(count)||count<=0)return;
      totals[kind]++;
      items.push({key:city.key,city:city.label,kind,priority:priorities[kind],count,
        detail,ranking:city.ranking??null,hasRadar:city.hasRadar,hasMerchants:city.hasMerchants,
        paused:city.paused});
    };
    if(city.paused){
      add('paused',1,'A situação de pausa deve ser revisada pelo administrador. Não iniciar contato automaticamente.');
      continue;
    }
    if(city.hasRadar){
      add('overdue',city.overdue,city.overdue===1?'1 acompanhamento com prazo vencido.':'Retornos com prazo vencido exigem análise.');
      add('first_contact',city.openProspects,'Registros identificados para primeira abordagem; confirme o contato antes de registrar.');
      add('onboarding',city.onboarding,'Parceiros indicados no radar como em cadastramento, sem garantia de habilitação.');
      if(city.interests!==null&&city.interests>0&&city.available===0){
        add('supply_gap',city.interests,'Interesses registrados nesta cidade, mas sem revenda com oferta confirmada na amostra.');
      }
    }
    if(city.hasMerchants&&city.needingReview>0){
      add('merchant_review',city.needingReview,'Revendas com pendências ou status incompleto na amostra administrativa.');
    }
  }
  items.sort((a,b)=>a.priority-b.priority
    ||(b.ranking??-1)-(a.ranking??-1)
    ||b.count-a.count
    ||a.city.localeCompare(b.city,'pt-BR')
    ||a.key.localeCompare(b.key));
  return {valid:true,fresh:true,items,totals,limited:bridge.sampled||bridge.total>bridge.rows.length,
    cityCount:bridge.total,missingLocation:bridge.missingLocation,labels};
}
function adminCommercialOpportunityView(d){
  if(!adminRoleCanSection('prospects'))return '';
  const snap=adminCommercialOpportunitySnapshot(d);
  if(!snap.valid)return `<section class='section admin-commercial-center' aria-label='Central de oportunidades'>
    <div class='section-head'><div><span class='section-kicker'>ACOMPANHAMENTO COMERCIAL</span><h3>Oportunidades que merecem atenção</h3></div></div>
    <div class='notice'>A central precisa dos dados atuais do radar de expansão e da rede de revendas. Atualize as consultas para iniciar a análise.</div>
  </section>`;
  if(!snap.fresh)return `<section class='section admin-commercial-center' aria-label='Central de oportunidades'>
    <div class='section-head'><div><span class='section-kicker'>ACOMPANHAMENTO COMERCIAL</span><h3>Oportunidades que merecem atenção</h3></div></div>
    <div class='notice danger'><strong>Conferência desatualizada.</strong> Atualize o radar e o painel administrativo antes de definir prioridades. Dados antigos não significam ausência de retornos, contatos ou parceiros.</div>
  </section>`;
  const filterNames={all:'Todas as prioridades',overdue:'Retornos vencidos',paused:'Cidades pausadas',
    first_contact:'Sem primeiro contato',onboarding:'Em cadastramento',supply_gap:'Sem oferta confirmada',
    merchant_review:'Revendas para revisão'};
  const request=String(adminRuntime.commercialOpportunityFilter||'all');
  const filter=Object.prototype.hasOwnProperty.call(filterNames,request)?request:'all';
  const shown=snap.items.filter(x=>filter==='all'||x.kind===filter);
  const rows=shown.slice(0,12).map(item=>{
    const target=item.kind==='merchant_review'?'partners':'prospects';
    const enabled=target==='prospects'?item.hasRadar:item.hasMerchants&&adminRoleCanSection('partners');
    return `<article class='admin-commercial-center-item'>
      <div><span class='admin-commercial-center-kind'>${esc(snap.labels[item.kind])}</span>
        <strong>${esc(item.city)}</strong>
        <small>${esc(item.detail)}</small>
        <small>Registros nesta categoria: ${item.count}${item.ranking!==null?' • Índice interno de trabalho: '+item.ranking:''}</small></div>
      <button type='button' class='secondary small' data-opportunity-city='${esc(item.key)}'
        data-opportunity-kind='${item.kind}'
        onclick="adminOpenCommercialOpportunity(this.dataset.opportunityCity,this.dataset.opportunityKind)"
        ${enabled?'':'disabled title="Sem permissão ou registro consultável nesta área"'}>Conferir registros</button>
    </article>`;
  }).join('');
  const totals=snap.totals;
  const countLabel=(key,label)=>`<div><strong>${totals[key]}</strong><small>${label}</small></div>`;
  return `<section class='section admin-commercial-center' aria-label='Central de oportunidades'>
    <div class='section-head'><div><span class='section-kicker'>ACOMPANHAMENTO COMERCIAL</span>
      <h3>Oportunidades que merecem atenção</h3>
      <p>Organize retornos, novos contatos e habilitações sem perder a origem de cada informação.</p></div>
      <span class='admin-data-freshness'>Fontes recentes</span></div>
    ${snap.limited?'<div class="notice">A análise utiliza amostras limitadas. Pode haver outros municípios e registros fora das listas consultadas.</div>':''}
    <div class='admin-commercial-center-stats'>
      ${countLabel('overdue','Cidades com retornos vencidos')}
      ${countLabel('first_contact','Cidades com primeiros contatos pendentes')}
      ${countLabel('onboarding','Cidades com parceiros em cadastramento')}
      ${countLabel('supply_gap','Cidades com interesses e sem oferta confirmada')}
    </div>
    <div class='card flat'>
      <div class='admin-commercial-center-toolbar'><div><label for='admin-commercial-filter'>Prioridades</label>
        <select class='input' id='admin-commercial-filter' onchange="adminSetCommercialOpportunityFilter(this.value)">
          ${Object.entries(filterNames).map(([key,label])=>`<option value='${key}' ${key===filter?'selected':''}>${esc(label)}</option>`).join('')}
        </select></div><small>${shown.length} item(ns) na amostra${shown.length>12?' • exibindo os primeiros 12':''}</small></div>
      ${shown.length?`<div class='admin-commercial-center-list'>${rows}</div>`:
        '<p class="tiny muted">Nenhuma oportunidade deste tipo foi identificada na amostra atual. Isso não comprova ausência de demandas em outras cidades.</p>'}
      <p class='tiny muted'>Contagens representam municípios com pelo menos um sinal; um município pode aparecer em várias categorias.
        Registros ANP não são revendas parceiras; o índice comercial não é previsão de vendas. Consultar um item não envia mensagens, não cria convite e não ativa cidades.</p>
    </div>
  </section>`;
}
function adminSetCommercialOpportunityFilter(value){
  if(adminRuntime.status!=='ready'||!adminRoleCanSection('prospects'))return;
  const allowed=['all','overdue','paused','first_contact','onboarding','supply_gap','merchant_review'];
  if(!allowed.includes(String(value||'')))return;
  adminRuntime.commercialOpportunityFilter=String(value);
  render();
  requestAnimationFrame(()=>document.getElementById('admin-commercial-filter')?.focus({preventScroll:true}));
}
function adminOpenCommercialOpportunity(key,kind){
  if(adminRuntime.status!=='ready'||!adminRoleCanSection('prospects'))return;
  const snap=adminCommercialOpportunitySnapshot(adminRuntime.data);
  if(!snap.valid||!snap.fresh)return;
  const item=snap.items.find(x=>x.key===key&&x.kind===kind);
  if(!item)return;
  const destination=kind==='merchant_review'?'partners':'prospects';
  if(destination==='partners'&&!adminRoleCanSection('partners'))return;
  adminOpenExpansionBridgeCity(key,destination);
}

async function adminSaveProspect(cnpj,expectedVersion){
  if(!['superadmin','operations','compliance'].includes(String(adminCurrentRole())))return;
  const id=String(cnpj||'').replace(/\D/g,'');
  if(!/^[0-9]{14}$/.test(id))return toast('CNPJ inválido');
  const stage=String(document.getElementById('prospect-stage-'+id)?.value||'');
  const note=String(document.getElementById('prospect-note-'+id)?.value||'').trim();
  const followUpDate=String(document.getElementById('prospect-follow-up-'+id)?.value||'');
  const contactChannel=String(document.getElementById('prospect-channel-'+id)?.value||'');
  if(note.length<5||note.length>1000)return toast('Descreva o próximo passo ou contato em pelo menos cinco caracteres');
  if(stage==='contacted'&&!contactChannel)return toast('Para registrar um contato, informe o canal utilizado');
  try{
    await adminPerform('prospect-crm',{
      cnpj:id,expectedVersion:Number(expectedVersion),status:stage,
      note,followUpDate,contactChannel
    });
    await Promise.all([adminLoadProspects(),adminLoadExpansionRadar()]);
    toast('Negociação atualizada e registrada na auditoria');
  }catch(error){toast(String(error?.message||error))}
}

function adminAnpProspectInviteLink(token,prospect){
  const url=new URL('https://parceiro.tamao.com.br/');
  const params=new URLSearchParams();
  params.set('prospect',token);
  if(/^[0-9]{14}$/.test(String(prospect?.cnpj||'')))params.set('cnpj',prospect.cnpj);
  const company=String(prospect?.legal_name||'').trim().slice(0,90);
  if(company)params.set('empresa',company);
  url.hash='merchant-join?'+params.toString();
  return url.toString();
}
async function adminIssueAnpProspectInvite(cnpj){
  if(!['superadmin','operations','compliance'].includes(String(adminCurrentRole())))return;
  const prospect=(adminRuntime.prospectReport?.prospects||[]).find(x=>x.cnpj===cnpj);
  if(!prospect)return toast('Atualize a lista de prospectos');
  if(['partner','dismissed'].includes(String(prospect.prospect_status)))return toast('Empresa não elegível para novo convite');
  const isActive=prospect.invitation?.status==='active';
  if(isActive&&!confirm('Já existe convite ativo. Rotacionar revogará o link anterior. Continuar?'))return;
  const daysRaw=prompt('Validade do convite em dias (1 a 30):','14');
  if(daysRaw==null)return;
  const days=Number(daysRaw);
  if(!Number.isSafeInteger(days)||days<1||days>30)return toast('Informe uma validade de 1 a 30 dias');
  const token=adminGeneratePilotInviteToken();
  const expiresAt=new Date(Date.now()+days*24*60*60*1000).toISOString();
  try{
    await adminPerform('prospect-invite',{
      cnpj,inviteAction:'issue',token,expiresAt,rotate:isActive
    });
    await adminLoadProspects();
    const link=adminAnpProspectInviteLink(token,prospect);
    try{await navigator.clipboard?.writeText(link)}catch{}
    prompt('Convite criado. Copie o link e envie ao responsável somente após avaliar a abordagem. Por segurança, o link não poderá ser recuperado; se perdê-lo, será necessário gerar outro:',link);
    toast('Convite de cadastro criado para o CNPJ '+cnpj);
  }catch(error){toast(String(error?.message||error))}
}
async function adminRevokeAnpProspectInvite(cnpj){
  if(!['superadmin','operations','compliance'].includes(String(adminCurrentRole())))return;
  if(!confirm('Revogar o convite ativo deste CNPJ? O link deixará de ser aceito.'))return;
  try{
    await adminPerform('prospect-invite',{cnpj,inviteAction:'revoke'});
    await adminLoadProspects();
    toast('Convite revogado');
  }catch(error){toast(String(error?.message||error))}
}
function adminProspectInvitationControls(record){
  const cnpj=String(record?.cnpj||'').replace(/\D/g,'');
  if(!/^[0-9]{14}$/.test(cnpj))return '';
  const inv=record.invitation||{status:'none'};
  const status=String(inv.status||'none');
  const label={
    none:'Ainda não convidada',active:'Convite ativo',expired:'Convite expirado',
    revoked:'Convite revogado',claimed:'Convite utilizado'
  }[status]||'Convite sem confirmação';
  const canAct=['superadmin','operations','compliance'].includes(String(adminCurrentRole()))
    &&!['dismissed','partner'].includes(String(record.prospect_status));
  const app=record.application||null;
  return '<div class="tiny muted" style="margin-top:8px"><strong>'+esc(label)+'</strong>'+
    (status==='active'&&inv.expiresAt?' • vence '+esc(formatDateTime(inv.expiresAt)):'')+
    (app?' • Cadastro '+esc(app.status||'em análise'):' • Cadastro ainda não identificado')+'</div>'+
    (canAct?'<div class="order-actions" style="margin-top:8px">'+
      (status!=='claimed'?'<button type="button" class="secondary small" onclick="adminIssueAnpProspectInvite(\''+cnpj+'\')">'+
        (status==='active'?'Rotacionar convite':'Gerar convite')+'</button>':'')+
      (status==='active'?'<button type="button" class="ghost small" onclick="adminRevokeAnpProspectInvite(\''+cnpj+'\')">Revogar</button>':'')+
    '</div>':'');
}

function adminProspectOnboardingProgress(record){
  const p=record?.onboarding||{};
  const status=String(p.step||'prospect');
  const steps=[
    {key:'prospect',label:'ANP'},
    {key:'invited',label:'Convite'},
    {key:'application',label:'Cadastro'},
    {key:'merchant',label:'Revenda'},
    {key:'ready',label:'Ofertas'}
  ];
  const stageIndex=Math.max(0,steps.findIndex(step=>step.key===status));
  const text=steps.map((step,index)=>(index<=stageIndex?'✓ ':'○ ')+step.label).join('  ·  ');
  const next=String(p.nextStep||'Qualificar empresa e gerar convite');
  const needsFollowup=p.reminderRecommended===true
    ?'<span class="status-pill">Convite sem cadastro há mais de 3 dias</span>':'';
  const application=String(p.applicationState||'');
  return '<div class="card flat" style="margin-top:8px"><strong>Caminho até a operação</strong>'+
    '<p class="tiny muted" style="white-space:normal">'+esc(text)+'</p>'+
    '<div class="tiny"><strong>Próxima ação:</strong> '+esc(next)+'</div>'+
    (application==='rejected'?'<div class="tiny muted">O cadastro precisa ser reenviado antes de seguir.</div>':'')+
    (status==='merchant'?'<div class="tiny muted">Revenda registrada não significa que possa receber pedidos. A autoridade de ofertas confirma elegibilidade em tempo real.</div>':'')+
    needsFollowup+'</div>';
}

/* V1.200 — focused, read-only follow-up triage backed by the selected CRM snapshot. */
function adminProspectFollowupSnapshot(report,now=Date.now()){
  const same=report&&String(report.state||'').toUpperCase()===String(adminRuntime.prospectState||'').toUpperCase()
    &&String(report.city||'').trim().toLowerCase()===String(adminRuntime.prospectCity||'').trim().toLowerCase();
  const checked=Date.parse(String(adminRuntime.prospectLoadedAt||''));
  const owner=String(adminRuntime.session?.user?.id||'');
  const recent=Number.isFinite(checked)&&checked<=now+60000&&now-checked<=10*60000;
  const fresh=!!same&&recent&&owner!==''&&owner===String(adminRuntime.prospectLoadedFor||'')
    &&adminRuntime.prospectLoading!==true&&adminRuntime.prospectError==null
    &&Array.isArray(report.prospects);
  if(!fresh)return {valid:false,items:[],total:0,counts:null,limited:false};
  const local=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',
    year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  const parts=local.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const today=parts?local:[...new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',
    year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now))]
    .filter(p=>['year','month','day'].includes(p.type)).reduce((a,x)=>({...a,[x.type]:x.value}),{});
  const day=typeof today==='string'?today:`${today.year}-${today.month}-${today.day}`;
  const kinds={overdue:0,today:0,first_contact:0,needs_date:0,scheduled:0,unconfirmed:0};
  const items=[],seen=new Set();
  const days=date=>{
    const raw=String(date||'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return null;
    const value=Date.parse(raw+'T00:00:00Z');
    return Number.isFinite(value)&&new Date(value).toISOString().slice(0,10)===raw?raw:null;
  };
  for(const p of report.prospects){
    const cnpj=String(p?.cnpj||'').replace(/\D/g,'');
    if(!/^\d{14}$/.test(cnpj)||seen.has(cnpj))continue;
    seen.add(cnpj);
    const stage=String(p?.prospect_status||'uncontacted');
    if(['partner','dismissed'].includes(stage))continue;
    const due=days(p?.follow_up_at);
    const hasUnknownDate=!!p?.follow_up_at&&!due;
    const attempts=Number(p?.contact_attempts);
    const first=stage==='uncontacted'&&!p?.last_contacted_at
      &&(!Number.isFinite(attempts)||attempts===0);
    const kind=hasUnknownDate?'unconfirmed':
      due?(due<day?'overdue':due===day?'today':'scheduled'):
      first?'first_contact':'needs_date';
    kinds[kind]++;
    items.push({cnpj,kind,stage,due,name:String(p.legal_name||'Revenda GLP').slice(0,160),
      version:Number.isSafeInteger(Number(p.crm_version))?Number(p.crm_version):null});
  }
  const rank={overdue:0,today:1,first_contact:2,needs_date:3,unconfirmed:4,scheduled:5};
  items.sort((a,b)=>rank[a.kind]-rank[b.kind]
    ||(a.due||'').localeCompare(b.due||'')
    ||a.name.localeCompare(b.name,'pt-BR')||a.cnpj.localeCompare(b.cnpj));
  return {valid:true,items:items.slice(0,10),allItems:items,total:items.length,
    counts:kinds,limited:report.prospects.length>=300,day};
}
/* V1.201 — local pagination and filters; state is scoped to the signed-in user's fresh city snapshot. */
const ADMIN_PROSPECT_FOLLOWUP_FILTERS=['all','overdue','today','first_contact','needs_date','unconfirmed','scheduled'];
function adminProspectFollowupUi(report){
  const scope=[String(adminRuntime.session?.user?.id||''),String(report?.state||''),
    String(report?.city||''),String(adminRuntime.prospectLoadedAt||'')].join('|');
  if(!adminRuntime.prospectFollowupUi||adminRuntime.prospectFollowupUi.scope!==scope){
    adminRuntime.prospectFollowupUi={scope,filter:'all',page:0};
  }
  return adminRuntime.prospectFollowupUi;
}
function adminSelectProspectFollowupFilter(kind){
  if(adminRuntime.status!=='ready'||!adminRoleCanSection('prospects')
    ||!ADMIN_PROSPECT_FOLLOWUP_FILTERS.includes(kind))return;
  if(!adminProspectFollowupSnapshot(adminRuntime.prospectReport).valid)return;
  const ui=adminProspectFollowupUi(adminRuntime.prospectReport);
  ui.filter=kind;
  ui.page=0;
  render();
}
function adminChangeProspectFollowupPage(direction){
  if(adminRuntime.status!=='ready'||!adminRoleCanSection('prospects')
    ||![-1,1].includes(direction))return;
  const report=adminRuntime.prospectReport;
  const s=adminProspectFollowupSnapshot(report);
  if(!s.valid)return;
  const ui=adminProspectFollowupUi(report);
  const available=s.allItems.filter(p=>ui.filter==='all'||p.kind===ui.filter).length;
  const maxPage=Math.max(0,Math.ceil(available/10)-1);
  const next=Math.min(maxPage,Math.max(0,ui.page+direction));
  if(next===ui.page)return;
  ui.page=next;
  render();
}
function adminProspectFollowupView(report){
  if(!adminRoleCanSection('prospects'))return '';
  const s=adminProspectFollowupSnapshot(report);
  if(!s.valid)return `<div class='notice'><strong>Próximos contatos ainda não confirmados.</strong>
    Consulte ou atualize os prospectos desta cidade para organizar as negociações. Dados antigos ou incompletos não significam que todos os contatos estejam em dia.</div>`;
  const labels={overdue:'Retorno vencido',today:'Contato para hoje',first_contact:'Primeira abordagem',
    needs_date:'Definir próxima data',unconfirmed:'Data precisa de revisão',scheduled:'Contato agendado'};
  const nums=s.counts;
  const canManage=['superadmin','operations','compliance'].includes(String(adminCurrentRole()));
  const ui=adminProspectFollowupUi(report);
  const kinds=[['all','Todas',s.total],['overdue','Vencidos',nums.overdue],
    ['today','Hoje',nums.today],['first_contact','Primeira abordagem',nums.first_contact],
    ['needs_date','Sem data',nums.needs_date],['unconfirmed','Data inválida',nums.unconfirmed],
    ['scheduled','Agendados',nums.scheduled]];
  const available=s.allItems.filter(p=>ui.filter==='all'||p.kind===ui.filter);
  const lastPage=Math.max(0,Math.ceil(available.length/10)-1);
  const page=Math.min(lastPage,Math.max(0,ui.page));
  ui.page=page;
  const start=page*10;
  const filters=kinds.map(([key,label,count])=>`<button type='button' class='secondary small'
      aria-pressed='${ui.filter===key?'true':'false'}' data-kind='${key}'
      onclick='adminSelectProspectFollowupFilter(this.dataset.kind)'>${label} (${count})</button>`).join('');
  const cards=available.slice(start,start+10).map(p=>`<div class='admin-prospect-followup-row'>
    <div><span class='admin-prospect-followup-status ${p.kind}'>${labels[p.kind]}</span>
      <strong>${esc(p.name)}</strong>
      <small>CNPJ ${esc(p.cnpj)} • ${p.due?'Próximo contato: '+esc(p.due):'Sem data válida de próximo contato'}
      </small></div>
    <button type='button' class='secondary small' data-cnpj='${p.cnpj}'
      onclick='adminOpenProspectFollowup(this.dataset.cnpj)' ${canManage?'':'disabled title="Apenas leitura neste perfil"'}>Ver negociação</button>
  </div>`).join('');
  return `<section class='admin-prospect-followup' aria-label='Próximos contatos de prospectos'>
    <div class='section-head'><div><h3>Contatos para acompanhar</h3>
      <p>Organize retornos e próximas ações desta cidade, sem registrar contatos que não aconteceram.</p></div></div>
    <div class='admin-prospect-followup-counters'>
      <div><strong>${nums.overdue}</strong><small>Vencidos</small></div>
      <div><strong>${nums.today}</strong><small>Para hoje</small></div>
      <div><strong>${nums.first_contact}</strong><small>Primeiro contato</small></div>
      <div><strong>${nums.needs_date+nums.unconfirmed}</strong><small>Revisar agendamento</small></div>
    </div>
    ${s.limited?'<p class="tiny muted">O retorno da cidade atingiu 300 registros. Podem existir outros prospectos fora desta amostra.</p>':''}
    <div class='admin-prospect-followup-filters' role='group' aria-label='Filtrar negociações por situação'>
      ${filters}
    </div>
    <div class='card flat'><p class='tiny muted'>${s.total} negociação(ões) nesta consulta •
      ${available.length} nesta categoria • ${available.length?start+1:0}–${Math.min(start+10,available.length)} exibidas.
      ${nums.scheduled} contato(s) futuro(s). Negociações concluídas ou descartadas não entram na fila.</p>
      ${cards?`<div class='admin-prospect-followup-list'>${cards}</div>`:
        ui.filter==='all'?'<p class="tiny muted">Nenhuma negociação pendente identificada nesta amostra; isso não garante ausência de pendências em outras cidades.</p>':'<p class="tiny muted">Nenhuma negociação nesta categoria da amostra consultada; isso não garante ausência de pendências em outras cidades.</p>'}
      <div class='admin-prospect-followup-paging'>
        <button type='button' class='secondary small' onclick='adminChangeProspectFollowupPage(-1)'
          ${page===0?'disabled':''}>Anterior</button>
        <span class='tiny muted' aria-live='polite'>Página ${page+1} de ${lastPage+1}</span>
        <button type='button' class='secondary small' onclick='adminChangeProspectFollowupPage(1)'
          ${page===lastPage?'disabled':''}>Próximos</button>
      </div>
      <p class='tiny muted'>Abra o cadastro, confira o histórico e registre uma próxima ação. O botão não envia mensagens, não marca contato, não cria convite e não altera o CRM.</p>
    </div>
  </section>`;
}
function adminOpenProspectFollowup(cnpj){
  if(adminRuntime.status!=='ready'||!adminRoleCanSection('prospects'))return;
  if(!['superadmin','operations','compliance'].includes(String(adminCurrentRole())))return;
  if(!/^\d{14}$/.test(String(cnpj||'')))return;
  const snapshot=adminProspectFollowupSnapshot(adminRuntime.prospectReport);
  if(!snapshot.valid||!snapshot.allItems.some(p=>p.cnpj===cnpj))return;
  const session=adminRuntime.session,loaded=adminRuntime.prospectLoadedAt;
  requestAnimationFrame(()=>{
    if(adminRuntime.status!=='ready'||adminRuntime.session!==session
      ||adminRuntime.prospectLoadedAt!==loaded||!adminRoleCanSection('prospects'))return;
    const details=document.getElementById('prospect-editor-'+cnpj);
    if(!details)return toast('Registro não localizado. Atualize a consulta de prospectos.');
    details.open=true;
    const summary=details.querySelector('summary');
    (summary||details).focus({preventScroll:true});
    details.scrollIntoView({block:'center',behavior:'instant'});
  });
}

function adminProspectCrmEditor(record){
  const cnpj=String(record.cnpj||'').replace(/\D/g,'');
  if(!/^[0-9]{14}$/.test(cnpj))return '';
  if(!['superadmin','operations','compliance'].includes(String(adminCurrentRole())))return '';
  const choices=Object.entries(PROSPECT_STAGE_LABELS)
    .map(([value,label])=>'<option value="'+value+'" '+(value===record.prospect_status?'selected':'')+'>'+esc(label)+'</option>').join('');
  const date=String(record.follow_up_at||'').slice(0,10);
  return '<details class="card flat" id="prospect-editor-'+cnpj+'" style="margin-top:8px"><summary tabindex="-1">Gerenciar negociação</summary>'+
    '<div class="form-stack" style="margin-top:12px">'+
      '<div class="field-row"><div class="input-wrap"><label for="prospect-stage-'+cnpj+'">Etapa comercial</label>'+
        '<select id="prospect-stage-'+cnpj+'" class="input">'+choices+'</select></div>'+
      '<div class="input-wrap"><label for="prospect-follow-up-'+cnpj+'">Próximo contato</label>'+
        '<input type="date" id="prospect-follow-up-'+cnpj+'" class="input" value="'+esc(date)+'"></div></div>'+
      '<div class="input-wrap"><label for="prospect-channel-'+cnpj+'">Contato realizado nesta atualização?</label>'+
        '<select id="prospect-channel-'+cnpj+'" class="input"><option value="">Não registrar contato</option>'+
          '<option value="phone">Telefone</option><option value="whatsapp">WhatsApp</option>'+
          '<option value="email">E-mail</option><option value="in_person">Presencial</option></select></div>'+
      '<div class="input-wrap"><label for="prospect-note-'+cnpj+'">Histórico / próxima ação</label>'+
        '<textarea id="prospect-note-'+cnpj+'" class="input" maxlength="1000" rows="3" placeholder="Descreva o que foi combinado e a próxima ação.">'+
          esc(record.notes||'')+'</textarea></div>'+
      '<div class="order-actions"><button type="button" class="primary small" onclick="adminSaveProspect(\''+cnpj+'\','+
        Number(record.crm_version||0)+')" '+(adminRuntime.actionPending?'disabled':'')+'>Salvar negociação</button>'+
      '<span class="tiny muted">Marque contato somente após realizá-lo. “Parceira confirmada” exige cadastro ativo no TAMÃO.</span></div>'+
    '</div></details>';
}


async function adminLoadEnablement(){
  if(!adminReady()||adminRuntime.enablementLoading)return;
  const requestingUser=String(adminRuntime.session?.user?.id||'');
  adminRuntime.enablementLoading=true;
  adminRuntime.enablementError=null;
  render();
  try{
    const response=await adminInvoke({action:'merchant-enablement'});
    if(!adminReady()||String(adminRuntime.session?.user?.id||'')!==requestingUser)return;
    if(response?.readOnly!==true||response?.source!=='market_city_offer_scope'
       ||!Array.isArray(response?.merchants)){
      throw new Error('Resposta de habilitação não verificada');
    }
    adminRuntime.enablementMerchants=response.merchants;
    adminRuntime.enablementLoaded=true;
    adminRuntime.enablementCheckedAt=response.asOf||new Date().toISOString();
  }catch(error){adminRuntime.enablementError=String(error?.message||error)}
  finally{adminRuntime.enablementLoading=false;render()}
}
function adminEnablementCheckRow(check){
  const ok=check?.ok===true;
  return '<div class="list-row" style="align-items:flex-start">'+
    '<div style="flex:1"><strong>'+(ok?'✓ ':'• ')+esc(check?.label||'Requisito')+'</strong>'+
      (ok?'':'<div class="tiny muted" style="margin-top:4px">'+esc(check?.action||'Revisar requisito')+'</div>')+
      '<small>'+esc(check?.scope==='global'?'Controle da plataforma':check?.scope==='city'?'Controle da cidade':
        check?.scope==='realtime'?'Condição temporária':'Configuração da revenda')+'</small></div>'+
    '<span class="status-pill '+(ok?'online':'offline')+'">'+(ok?'Conforme':'Pendente')+'</span></div>';
}
function adminEnablementMerchantCard(entry){
  const checks=Array.isArray(entry?.checks)?entry.checks:[];
  const failed=checks.filter(x=>x?.ok!==true);
  const ready=entry?.ready===true;
  const name=String(entry?.merchant_name||'Revenda');
  const state=String(entry?.state||'');
  const city=String(entry?.city||'');
  const main=failed.find(x=>x.key!=='quote_authority')||failed[0]||null;
  const location=city&&state?city+' / '+state:'Município ainda não informado';
  return '<article class="card flat" style="margin-bottom:12px">'+
    '<div class="section-head"><div><span class="section-kicker">'+esc(location)+'</span><h3>'+esc(name)+'</h3>'+
      '<p class="tiny muted">CNPJ '+esc(entry?.cnpj||'não confirmado')+' • Cadastro '+esc(entry?.merchant_status||'desconhecido')+'</p></div>'+
      '<span class="status-pill '+(ready?'online':'offline')+'">'+(ready?'Apta para cotação':failed.length+' bloqueio(s)')+'</span></div>'+
    (main&&!ready?'<p class="tiny"><strong>Próxima ação:</strong> '+esc(main.action||'Revisar habilitação')+'</p>':
       '<p class="tiny"><strong>Verificação atual:</strong> todos os requisitos do motor de cotações foram satisfeitos neste instante.</p>')+
    '<details><summary>Verificar todos os '+checks.length+' requisitos ('+failed.length+' pendente(s))</summary>'+
      '<div class="list" style="margin-top:12px">'+checks.map(adminEnablementCheckRow).join('')+'</div></details>'+
    '</article>';
}
function adminEnablementSection(d){
  const items=Array.isArray(adminRuntime.enablementMerchants)?adminRuntime.enablementMerchants:[];
  const loaded=adminRuntime.enablementLoaded===true;
  const fetching=adminRuntime.enablementLoading===true;
  const ready=items.filter(x=>x?.ready===true).length;
  const blocked=items.length-ready;
  const withIssues=items.filter(x=>(x?.blocker_count||0)>0);
  const global=withIssues.filter(x=>(x?.checks||[]).some(c=>c?.scope==='global'&&c?.ok!==true)).length;
  const filtered=items.slice().sort((a,b)=>(a.ready===true)-(b.ready===true)
    ||Number(b.blocker_count||0)-Number(a.blocker_count||0)
    ||String(a.merchant_name||'').localeCompare(String(b.merchant_name||''),'pt-BR'));
  return '<section class="section">'+
    '<div class="section-head"><div><span class="section-kicker">JORNADA DA REVENDA</span><h2>Central de habilitação operacional</h2>'+
      '<p>Entenda cada requisito que impede uma revenda de aparecer nas ofertas. Este diagnóstico é somente leitura, reflete as regras vigentes e nunca substitui o motor de cotações.</p></div>'+
      '<button type="button" class="secondary small" onclick="adminLoadEnablement()" '+(fetching?'disabled':'')+'>↻ Revalidar agora</button></div>'+
    (adminRuntime.enablementError?'<div class="notice danger">'+esc(adminRuntime.enablementError)+'</div>':'')+
    '<div class="merchant-kpis">'+
      '<div class="kpi"><span class="label">Revendas avaliadas</span><strong>'+items.length+'</strong></div>'+
      '<div class="kpi"><span class="label">Aptas agora</span><strong>'+ready+'</strong><small>Prontidão pode mudar a qualquer momento</small></div>'+
      '<div class="kpi"><span class="label">Com bloqueios</span><strong>'+blocked+'</strong></div>'+
      '<div class="kpi"><span class="label">Afetadas por controles globais</span><strong>'+global+'</strong></div>'+
    '</div>'+
    '<div class="tiny muted" style="margin:10px 0">Diagnóstico '+esc(adminRelativeTime(adminRuntime.enablementCheckedAt))+
       ' • Limite de 80 revendas recentes por consulta • Itens ANP sem cadastro ainda não são revendas operacionais.</div>'+
    (filtered.length?filtered.map(adminEnablementMerchantCard).join(''):
      '<div class="empty card">'+(fetching?'Verificando habilitação…':!loaded?'Clique em Revalidar agora para consultar os requisitos.':
        'Nenhuma revenda operacional cadastrada. Comece em Parceiros ou convide estabelecimentos identificados em Prospectos.')+'</div>')+
    '<div class="notice"><strong>Sem liberações automáticas.</strong> A confirmação de documentos, a regularidade ANP, os recebimentos e a ativação comercial continuam sujeitos às permissões existentes. Um bloqueio não é resolvido apenas por ser exibido neste painel.</div>'+
  '</section>';
}

function adminProspectsSection(d){
  const grouped=new Map();
  for(const lead of d?.marketCityInterests||[]){
    if(!lead.city||!lead.state)continue;
    const key=String(lead.state).toUpperCase()+'|'+String(lead.city);
    grouped.set(key,(grouped.get(key)||0)+1);
  }
  const selected=adminRuntime.prospectState+'|'+adminRuntime.prospectCity;
  if(!grouped.has(selected))grouped.set(selected,0);
  const cityOptions=[...grouped.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'pt-BR'))
    .map(([key,count])=>'<option '+(key===selected?'selected':'')+' value="'+esc(key)+'">'+esc(key.replace('|',' • '))+' ('+count+' lead'+(count===1?'':'s')+' recente'+(count===1?'':'s')+')</option>').join('');
  const report=adminRuntime.prospectReport;
  const matches=report&&report.state===adminRuntime.prospectState
    &&String(report.city).toUpperCase()===adminRuntime.prospectCity.toUpperCase();
  const prospects=matches?(report.prospects||[]):[];
  const placeholder=adminRuntime.prospectLoading?'<div class="notice">Consultando dados oficiais e demanda local…</div>':'';
  const error=adminRuntime.prospectError?'<div class="notice danger">'+esc(adminRuntime.prospectError)+'</div>':'';
  const summary=matches?'<div class="merchant-kpis">'+
    '<div class="kpi"><span class="label">Interesses por CEP</span><strong>'+Number(report.interestCount||0)+'</strong><small>CEP identificado e consentimento</small></div>'+
    '<div class="kpi"><span class="label">Revendas aptas agora</span><strong>'+Number(report.eligibleMerchantCount||0)+'</strong><small>Cadastro, conformidade, estoque, preço e presença</small></div>'+
    '<div class="kpi"><span class="label">Revendas na ANP</span><strong>'+(report.sourceStatus==='ok'?Number(report.availableCount||0):'—')+'</strong><small>Empresas prospectáveis, não parceiros</small></div>'+
    '<div class="kpi"><span class="label">Fonte consultada</span><strong>'+esc(adminRelativeTime(report.checkedAt))+'</strong><small>'+esc(report.sourceStatus||'não confirmada')+'</small></div></div>'+
    (report.warning?'<div class="notice">'+esc(report.warning)+'</div>':'')+
    '<div class="card flat"><strong>Comércio por cidade: '+(report.cityPaused?'PAUSADO PELO ADMIN':Number(report.eligibleMerchantCount||0)>0?'PRONTO PARA RECEBER COTAÇÕES':'AGUARDANDO REVENDA APTA')+'</strong>'+
      (['superadmin','operations'].includes(String(adminCurrentRole()))?
        '<div class="order-actions" style="margin-top:12px"><button class="'+(report.cityPaused?'secondary':'danger-btn')+' small" onclick="adminPauseMarketCity('+(report.cityPaused?'false':'true')+')">'+(report.cityPaused?'Remover pausa administrativa':'Pausar cidade')+'</button></div>':'')+
      '<p class="tiny muted">A habilitação é derivada de fornecedores válidos em tempo real. A ação administrativa é auditada e não ativa a cidade sozinha.</p></div>'+
    '<div class="section-head"><div><h3>Empresas registradas na ANP</h3><p>Confirmar dados e interesse antes do convite. Importação não habilita recebimento de pedidos.</p></div></div>'+
    '<div class="card flat"><div class="list">'+
    (prospects.length?prospects.map(x=>{
      const followUp=x.follow_up_at?String(x.follow_up_at).slice(0,10):null;
      const overdue=Boolean(followUp&&new Date(x.follow_up_at)<new Date()&&
        !['partner','dismissed'].includes(x.prospect_status));
      return '<div class="list-row"><div style="width:100%"><div class="status-bar"><strong>'+esc(x.legal_name||'Revenda GLP')+'</strong>'+
        '<span class="status-pill">'+esc(PROSPECT_STAGE_LABELS[x.prospect_status]||x.prospect_status||'Não contatada')+'</span></div>'+
        '<small>CNPJ '+esc(x.cnpj||'')+' • '+esc(x.address_text||adminRuntime.prospectCity)+
          ' • '+esc(x.distributor||'Sem vínculo identificado')+'</small>'+
        '<div class="tiny muted">'+Number(x.contact_attempts||0)+' contato(s) registrado(s)'+
          (followUp?' • Retorno: '+esc(followUp)+(overdue?' (vencido)':''):'')+
          (x.last_contacted_at?' • Último contato: '+esc(String(x.last_contacted_at).slice(0,10)):'')+'</div>'+
        adminProspectInvitationControls(x)+adminProspectOnboardingProgress(x)+adminProspectCrmEditor(x)+'</div></div>';
    }).join('')
      :'<div class="muted">Nenhum registro consultável para esta cidade. Confira o estado da fonte; ausência de resposta não significa ausência de revendedores.</div>')+
    '</div></div>':'';
  return '<section class="section">'+
    '<div class="section-head"><div><span class="section-kicker">EXPANSÃO NACIONAL</span><h2>Inteligência de cidades e prospectos</h2><p>Acompanhe demanda de clientes e revendas GLP da fonte oficial. A operação comercial continua protegida.</p></div></div>'+
    '<div class="card flat form-stack">'+
      '<div class="input-wrap"><label for="prospect-area">Cidades com demanda nos cadastros recentes</label>'+
      '<select id="prospect-area" class="input" onchange="adminProspectSelectCity(this.value)">'+cityOptions+'</select></div>'+
      '<div class="field-row"><div class="input-wrap"><label for="prospect-city">Município</label>'+
      '<input id="prospect-city" class="input" maxlength="120" value="'+esc(adminRuntime.prospectCity)+'" placeholder="Ex.: Santa Maria"></div>'+
      '<div class="input-wrap"><label for="prospect-uf">UF</label><input id="prospect-uf" class="input" maxlength="2" value="'+esc(adminRuntime.prospectState)+'" placeholder="RS"></div></div>'+
      '<div class="order-actions"><button class="primary" onclick="adminProspectSearchCity()" '+(adminRuntime.prospectLoading?'disabled':'')+'>Consultar na ANP</button>'+
      '<button class="secondary" onclick="adminLoadProspects({force:true})" '+(adminRuntime.prospectLoading?'disabled':'')+'>Atualizar fonte</button></div>'+
      '<small class="field-help">Fonte: API pública ANP GLP. O servidor reutiliza o resultado durante até 24 horas e mantém o último dado conhecido quando a fonte falha.</small>'+
    '</div>'+adminCityCommercialHistoryView()+adminExpansionRadarSection()+adminCityPipelineView(d)+adminCommercialOpportunityView(d)+adminExpansionBridgeView(d)+placeholder+error+summary+adminProspectFollowupView(matches?report:null)+adminCityNotificationsSection()+
    '<div class="notice"><strong>Ativação por elegibilidade, nunca apenas por cadastro.</strong> Uma cidade somente poderá abrir para compras após confirmação de revenda apta, regularidade ANP quando GLP, estoque, preço, área de entrega, capacidade e recebimento. O registro da ANP não equivale a autorização de parceria.</div>'+
  '</section>';
}
