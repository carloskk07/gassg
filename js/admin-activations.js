// TAMÃO V1.307 — only read protected evidence; never issue activation commands.
const adminActivationDesk={data:null,actor:null,role:null,checkedAt:null,loading:false,error:null};
async function adminActivationLoad({force=false}={}){
  const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
  if(!adminReady()||!actor||!['superadmin','operations','readonly'].includes(role))return null;
  if(adminActivationDesk.loading)return null;
  if(!force&&adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
     Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000)return adminActivationDesk.data;
  adminActivationDesk.loading=true;adminActivationDesk.error=null;render();
  try{
    const specs=[
      ['ads','ads-placement-readiness','admin_ads_placement_readiness_v1_236'],
      ['adsQueue','ads-campaign-queue','admin_ads_campaign_queue_v1_233'],
      ['clube','clube-campaign-queue','admin_clube_campaign_queue_v1_241'],
      ['terms','clube-terms-queue','admin_clube_terms_queue_v1_242'],
      ['intake','commercial-intake-read','admin_marketing_intake_v1_308'],
      ['adsSalesPlans','ads-sales-plans','admin_ads_sales_plans_v1_309'],
      ['adsOffers','ads-offers-read','admin_ads_offers_v1_310'],
      ['adsDossiers','ads-dossiers-read','admin_ads_dossiers_v1_311'],
      ['adsInstruments','ads-instruments-read','admin_ads_instruments_v1_312'],
      ['adsReceivables','ads-receivables-read','admin_ads_receivables_v1_313'],
      ['adsPsp','ads-psp-read','admin_ads_psp_v1_314'],
      ['adsMpInbox','ads-mp-inbox-read','admin_ads_mp_inbox_v1_316'],
      ['adsMpTriage','ads-mp-triage-read','admin_ads_mp_triage_v1_317'],
      ['adsPspFreshness','ads-psp-freshness-read','admin_ads_psp_freshness_v1_318'],
      ['adsPspMerchantReviews','ads-psp-merchant-reviews','admin_ads_psp_review_requests_v1_319'],
      ['adsLaunch','ads-launch-readiness','admin_ads_launch_readiness_v1_320'],
      ['adsLeads','ads-leads-read','admin_ads_leads_v1_322'],
      ['adsAssistance','ads-assistance-read','admin_ads_assistance_v1_323'],
      ['adsContacts','ads-contact-reports-read','admin_ads_contacts_v1_324'],
      ['adsFeedback','ads-contact-feedback-read','admin_ads_contact_feedback_v1_325'],
      ['adsFeedbackReturns','ads-feedback-returns-read','admin_ads_feedback_returns_v1_326'],
      ['adsReturnExecution','ads-return-execution-read','admin_ads_return_execution_v1_327']
    ];
    const values=await Promise.allSettled([
      ...specs.map(([,action])=>adminInvoke({action})),
      adminLoadGovernanceGates({force:true}),
      adminPushReliabilityLoadFromUi()
    ]);
    if(!adminReady()||actor!==String(adminRuntime.session?.user?.id||'')||role!==adminCurrentRole())return null;
    const evidence={};
    specs.forEach(([key,,source],i)=>{
      const d=values[i].status==='fulfilled'?values[i].value:null;
      const safe=d?.source===source&&(
        key==='ads'?d.readOnly===true&&d.publicEnabled===false&&d.billingEnabled===false&&d.readyToSell===false:
        key==='adsQueue'?d.noCharge===true&&d.adsLive===false:
        key==='adsReturnExecution'?d.readOnly===true&&d.automaticMessagesSent===0&&
          d.independentDeliveryProof===false&&d.adsLive===false&&d.paymentCreated===false&&
          Number.isSafeInteger(d.totalPlans)&&Number.isSafeInteger(d.scheduledPlans)&&
          Number.isSafeInteger(d.attemptsDeclared)&&Number.isSafeInteger(d.followupsDue)&&
          Array.isArray(d.rows)&&d.rows.length<=50&&d.rows.every(x=>
            /^[0-9a-f-]{36}$/i.test(String(x.merchantId))&&
            /^[0-9a-f-]{36}$/i.test(String(x.contactRequestId))&&
            ['scheduled','canceled','attempt_recorded'].includes(x.status)&&
            typeof x.consentCurrent==='boolean'&&x.attemptIndependentlyVerified===false):
        key==='adsFeedbackReturns'?d.readOnly===true&&d.messagesSent===0&&
          d.contactPerformed===false&&d.deliveryProven===false&&d.adsLive===false&&
          d.paymentCreated===false&&Number.isSafeInteger(d.totalPlans)&&
          Number.isSafeInteger(d.followupsDue)&&Array.isArray(d.rows)&&d.rows.length<=50&&
          d.rows.every(x=>/^[0-9a-f-]{36}$/i.test(String(x.merchantId))&&
           /^[0-9a-f-]{36}$/i.test(String(x.contactRequestId))&&
           ['contact_not_received','followup_needed'].includes(x.feedbackResponse)&&
           Number.isSafeInteger(x.assistanceVersion)&&x.assistanceVersion>0&&
           typeof x.consentCurrent==='boolean'&&
           (!x.returnPlan||['scheduled','canceled'].includes(x.returnPlan.status))):
        key==='adsFeedback'?d.readOnly===true&&d.messagesSent===0&&d.deliveryProven===false&&
          d.adsLive===false&&d.paymentCreated===false&&
          Number.isSafeInteger(d.totalMerchantFeedback)&&Number.isSafeInteger(d.awaitingMerchantFeedback)&&
          Array.isArray(d.rows)&&d.rows.length<=50&&d.rows.every(x=>
            /^[0-9a-f-]{36}$/i.test(String(x.merchantId))&&
            Number.isSafeInteger(x.assistanceVersion)&&x.assistanceVersion>0&&
            typeof x.currentConsent==='boolean'&&
            (!x.lastContact||(/^[0-9a-f-]{36}$/i.test(String(x.lastContact.contactRequestId))&&
              (!x.lastContact.merchantFeedback||x.lastContact.merchantFeedback.merchantDeclared===true)))):
        key==='adsContacts'?d.readOnly===true&&d.automatedMessagesSent===0&&
          d.deliveryIndependentlyVerified===false&&d.noAutomaticOutreach===true&&
          d.adsLive===false&&d.paymentCreated===false&&
          Number.isSafeInteger(d.totalManualReports)&&Number.isSafeInteger(d.followupsDue)&&
          Array.isArray(d.rows)&&d.rows.length<=50&&d.rows.every(x=>
            /^[0-9a-f-]{36}$/i.test(String(x.merchantId))&&
            Number.isSafeInteger(x.assistanceVersion)&&x.assistanceVersion>0&&
            typeof x.consentCurrent==='boolean'&&typeof x.merchantName==='string'&&
            Number.isSafeInteger(x.attemptsCount)&&
            (!x.lastAttempt||x.lastAttempt.independentlyVerified===false)):
        key==='adsAssistance'?d.readOnly===true&&d.contactPerformed===false&&
          d.messagesSent===0&&d.adsLive===false&&d.paymentCreated===false&&
          d.noAutomaticOutreach===true&&Number.isSafeInteger(d.totalRequests)&&
          Number.isSafeInteger(d.openRequests)&&d.openRequests<=d.totalRequests&&
          Array.isArray(d.rows)&&d.rows.length<=50&&d.rows.every(x=>
           /^[0-9a-f-]{36}$/i.test(String(x.merchantId))&&
           ['whatsapp','phone','email'].includes(x.channel)&&
           ['requested','triaged','closed','withdrawn'].includes(x.status)&&
           Number.isSafeInteger(x.version)&&x.version>0&&
           typeof x.consentCurrent==='boolean'&&x.contactPerformed===false):
        key==='adsLeads'?d.readOnly===true&&d.contactPerformed===false&&
          d.notificationSent===false&&d.paymentCreated===false&&d.adsLive===false&&
          d.noAutomaticOutreach===true&&Number.isSafeInteger(d.totalOptedIn)&&
          Number.isSafeInteger(d.creativeApproved)&&Number.isSafeInteger(d.preparingCreative)&&
          d.creativeApproved<=d.totalOptedIn&&d.preparingCreative<=d.totalOptedIn&&
          Array.isArray(d.rows)&&d.rows.length<=50&&d.rows.every(x=>
            /^[0-9a-f-]{36}$/i.test(String(x.merchantId))&&
            typeof x.merchantName==='string'&&Number.isSafeInteger(x.matchingActiveCatalogCount)&&
            x.contactPerformed===false&&x.marketingConsentInferred===false):
        key==='adsLaunch'?d.readOnly===true&&d.noAutomaticActivation===true&&
          d.merchantBillingSeparate===true&&d.providerLookupPerformed===false&&
          d.publicAdsVerified===false&&d.verifiedRevenueCents===null&&
          Number.isFinite(Date.parse(String(d.snapshotAt||'')))&&
          ['publicEnabled','billingEnabled','verifiedDeliveryEnabled'].every(k=>typeof d[k]==='boolean')&&
          ['creativesApproved','plansContactReady','merchantInterests','dossiersReviewed',
           'bilateralAcceptances','statementsIssued','checkoutsReady','lastKnownApprovedPayments',
           'staleApprovals24h','reversalsRecorded'].every(k=>Number.isSafeInteger(d[k])&&d[k]>=0)&&
          d.staleApprovals24h<=d.lastKnownApprovedPayments&&
          d.platformPspConfig?.liveAccountVerified===false&&
          d.platformPspConfig?.providerCharged===false&&
          ['explicitlyEnabled','providerTokenConfigured','providerSellerConfigured',
            'canAttemptAuthenticatedLookup'].every(k=>typeof d.platformPspConfig?.[k]==='boolean'):
        key==='adsPspMerchantReviews'?d.readOnly===true&&d.paymentStateChanged===false&&
          d.automaticReconciliation===false&&d.adsLive===false&&d.merchantBillingSeparate===true&&
          Number.isSafeInteger(d.totalRequests)&&Number.isSafeInteger(d.pendingRequests)&&
          d.pendingRequests<=d.totalRequests&&Array.isArray(d.rows)&&d.rows.length<=50&&
          d.rows.every(x=>/^[0-9a-f-]{36}$/i.test(String(x.merchantId))&&
           ["stale_approval","possible_reversal","refresh_due"].includes(x.reason)&&
           Number.isSafeInteger(x.checkoutVersion)&&x.checkoutVersion>0&&
           Number.isSafeInteger(x.currentVersion)&&x.currentVersion>0&&
           typeof x.pending==='boolean'):
        key==='adsPspFreshness'?d.readOnly===true&&d.snapshotOnly===true&&
          d.automaticReconciliation===false&&d.paymentStateChanged===false&&
          d.adsLive===false&&d.merchantBillingSeparate===true&&
          Number.isSafeInteger(d.totalCheckouts)&&Number.isSafeInteger(d.needsReview)&&
          Number.isSafeInteger(d.urgentCount)&&Number.isSafeInteger(d.staleApprovals)&&
          Number.isSafeInteger(d.overdueUnconfirmed)&&Number.isSafeInteger(d.stalledReservations)&&
          Array.isArray(d.rows)&&d.rows.length<=50&&d.rows.every(x=>
           /^[0-9a-f-]{36}$/i.test(String(x.merchantId))&&
           Number.isSafeInteger(x.checkoutVersion)&&x.checkoutVersion>0&&
           Number.isSafeInteger(x.amountCents)&&x.amountCents>=1000&&
           [1,2,3].includes(x.priority)&&typeof x.canRequestProviderCheck==='boolean'):
        key==='adsMpTriage'?d.readOnly===true&&d.adsLive===false&&
          d.automaticReconciliation===false&&d.providerSnapshotOnly===true&&
          d.paymentStateChanged===false&&d.refundsAlwaysRequireProviderCheck===true&&
          Number.isSafeInteger(d.totalUniquePaymentObservations)&&
          Number.isSafeInteger(d.actionableObservations)&&
          Number.isSafeInteger(d.priorityOneObservations)&&Array.isArray(d.rows)&&d.rows.length<=50&&
          d.rows.every(x=>/^[0-9a-f-]{36}$/i.test(String(x.merchantId))&&
            /^[0-9]{5,30}$/.test(String(x.paymentId))&&
            /^[a-f0-9]{64}$/.test(String(x.eventKey))&&
            [1,2,3].includes(x.priority)&&Number.isSafeInteger(x.amountCents)&&x.amountCents>0):
        key==='adsMpInbox'?d.readOnly===true&&d.adsLive===false&&
          d.automaticReconciliation===false&&d.webhookCannotMarkPaid===true&&
          Number.isSafeInteger(d.totalEvents)&&Array.isArray(d.rows)&&d.rows.length<=50&&
          d.rows.every(x=>/^[0-9a-f-]{36}$/i.test(String(x.merchantId))&&
            /^[0-9]{5,30}$/.test(String(x.paymentId))&&
            Number.isSafeInteger(x.amountCents)&&x.amountCents>0):
        key==='adsPsp'?d.readOnly===true&&d.adsLive===false&&d.merchantBillingSeparate===true&&
          d.refundReviewRequired===true&&Number.isSafeInteger(d.totalCheckouts)&&
          Number.isSafeInteger(d.providerApprovedCount)&&Number.isSafeInteger(d.providerApprovedGrossCents)&&
          Array.isArray(d.rows)&&d.rows.length<=50&&d.rows.every(x=>
            /^[0-9a-f-]{36}$/i.test(String(x.merchantId))&&
            /^[a-f0-9]{64}$/.test(String(x.documentSha256))&&
            (!x.checkout||['reserved','checkout_ready','payment_approved','payment_reversed'].includes(x.checkout.status))):
        key==='adsReceivables'?d.readOnly===true&&d.verifiedPayments===0&&
          d.collectedRevenueCents===0&&d.pspChargeCreated===false&&d.adsLive===false&&
          d.merchantBillingSeparate===true&&Number.isSafeInteger(d.totalReceivables)&&
          Number.isSafeInteger(d.issuedReceivables)&&Number.isSafeInteger(d.unverifiedReports)&&
          Array.isArray(d.rows)&&d.rows.length<=50&&d.rows.every(r=>
            /^[0-9a-f-]{36}$/i.test(String(r.merchantId))&&
            /^[a-f0-9]{64}$/.test(String(r.sha256))&&
            r.instrumentStatus==='bilateral_accepted'&&
            Number.isSafeInteger(r.instrumentVersion)&&r.instrumentVersion>=3&&
            (!r.receivable||['draft','issued','canceled'].includes(r.receivable.status))):
        key==='adsInstruments'?d.readOnly===true&&d.noCharge===true&&d.adsLive===false&&
          d.paymentRequestsCreated===0&&d.deliveryVerified===false&&d.notIcpCertified===true&&
          Number.isSafeInteger(d.totalInstruments)&&Array.isArray(d.rows)&&d.rows.length<=50&&
          d.rows.every(x=>/^[0-9a-f-]{36}$/i.test(String(x.merchantId))&&
            /^[a-f0-9]{64}$/.test(String(x.sha256))&&Number.isSafeInteger(x.version)&&x.version>0):
        key==='adsDossiers'?d.readOnly===true&&d.noCharge===true&&d.adsLive===false&&
          d.contractsSigned===0&&d.revenueCents===0&&d.paymentRequestsCreated===0&&
          Number.isSafeInteger(d.totalDossiers)&&Array.isArray(d.rows)&&d.rows.length<=50&&
          d.rows.every(x=>/^[0-9a-f-]{36}$/i.test(String(x.merchantId))&&
           Number.isSafeInteger(x.version)&&x.version>0):
        key==='adsOffers'?d.readOnly===true&&d.noCharge===true&&d.adsLive===false&&
          d.contractsSigned===0&&d.revenueCents===0&&d.notifiedExternally===false&&
          Number.isSafeInteger(d.totalOffers)&&Array.isArray(d.rows)&&d.rows.length<=50&&
          d.rows.every(x=>/^[0-9a-f-]{36}$/i.test(String(x.merchantId))&&
            ['shared','interested','declined','withdrawn'].includes(x.status)&&
            Number.isSafeInteger(x.version)&&x.version>0):
        key==='adsSalesPlans'?d.readOnly===true&&d.noCharge===true&&d.adsLive===false&&
          d.revenueCents===0&&d.contractsSigned===0&&
          Number.isSafeInteger(d.totalPlans)&&Number.isSafeInteger(d.approvedCreatives)&&
          Array.isArray(d.rows)&&d.rows.length<=50&&d.rows.every(x=>
            /^[0-9a-f-]{36}$/i.test(String(x.merchantId))&&typeof x.creativeEligible==='boolean'&&
            Number.isSafeInteger(x.version)&&x.version>=0):
        key==='clube'?d.readOnly===true&&d.couponSalesEnabled===false&&d.campaignsActive===0:
        key==='intake'?d.readOnly===true&&d.noMoneyMovement===true&&
          d.adsPublicationEnabled===false&&d.couponSalesEnabled===false&&
          Array.isArray(d.controls)&&d.controls.length===2&&
          new Set(d.controls.map(x=>x.moduleKey)).size===2&&
          d.controls.every(x=>['ads_proposals','clube_proposals'].includes(x.moduleKey)&&
            typeof x.enabled==='boolean'&&Number.isSafeInteger(x.version)&&x.version>0):
        d.readOnly===true&&d.couponSalesEnabled===false&&d.noContractsSigned===true);
      evidence[key]=safe?d:null;
    });
    const governance=values[22].status==='fulfilled'?values[22].value:null;
    evidence.governance=governance?.source==='admin_governance_gates_v1_304'&&governance.readOnly===true&&
      adminRuntime.governance?.loadedFor===actor&&adminRuntime.governance?.role===role?governance:null;
    const push=adminRuntime.pushReliability||{};
    evidence.push=push.loadedFor===actor&&push.data?.source==='admin_push_reliability_v1_294'&&
      push.data.readOnly===true&&push.data.gates?.automaticDeliveryVerified===false&&
      Date.now()-Date.parse(push.checkedAt||'')<120000?push.data:null;
    adminActivationDesk.data=evidence;adminActivationDesk.actor=actor;
    adminActivationDesk.role=role;adminActivationDesk.checkedAt=new Date().toISOString();
    return evidence;
  }catch(error){
    if(actor===String(adminRuntime.session?.user?.id||'')){
      adminActivationDesk.data=null;adminActivationDesk.error='Não foi possível conferir as ativações.';
    }
    return null;
  }finally{adminActivationDesk.loading=false;render();}
}

// Navigate only to the existing guarded workflows; never perform a mutation.
function adminActivationGo(key){
  const routes={
    ads:['partners','.admin-ads-campaigns'],
    clube:['partners','.admin-clube-campaign'],
    benefits:['finance','.admin-finance-workspace-panel'],
    payments:['finance','.admin-finance-workspace-panel'],
    push:['system','.admin-governance'],
    cities:['system','.admin-governance-city-block']
  };
  const target=routes[key];
  if(!adminReady()||!adminRoleCanSection('activations')||!target||
     !adminRoleCanSection(target[0]))return;
  adminSetSection(target[0]);
  requestAnimationFrame(()=>document.querySelector(target[1])?.scrollIntoView({block:'start'}));
}
function adminActivationDeskView(d){
  if(!adminRoleCanSection('activations'))return '';
  const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
  const current=adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
    adminActivationDesk.data&&Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<600000;
  const e=current?adminActivationDesk.data:{};
  const fmt=n=>Number.isSafeInteger(n)&&n>=0?n.toLocaleString('pt-BR'):'—';
  const card=(key,title,status,detail,evidence,section)=>{
    const action=adminRoleCanSection(section)
      ?'<button type="button" class="secondary small" onclick="adminActivationGo(\''+key+'\')">Abrir fluxo oficial →</button>'
      :'<small>Este perfil não pode alterar esta área.</small>';
    return '<article class="admin-activation-card"><div class="admin-activation-card-head"><strong>'+
      esc(title)+'</strong><span class="status-pill">'+esc(status)+'</span></div>'+
      '<p>'+esc(detail)+'</p><small>'+esc(evidence)+'</small>'+action+'</article>';
  };
  const cards=[
    card('ads','Publicidade TAMÃO',e.ads?'Exibição bloqueada':'Não confirmado',
      'Revisar criativos não publica campanhas nem gera cobranças.',
      e.ads?fmt(e.ads.approvedCreatives)+' criativos revisados • '+
        (e.adsQueue?fmt(e.adsQueue.submittedCount)+' pendentes':'fila sem confirmação'):'Sem evidência atual',
      'partners'),
    card('clube','Clube e patrocínios',e.clube?'Vendas bloqueadas':'Não confirmado',
      'Negociações, condições e orçamento devem ser aprovados nos fluxos protegidos.',
      e.clube?fmt(e.clube.activeInterests)+' interesses • '+
        (e.terms?fmt(e.terms.totalReviews)+' revisões de termos':'termos sem confirmação'):'Sem evidência atual',
      'partners'),
    card('benefits','Benefícios e comissões',
      Number.isSafeInteger(d?.commercialPolicy?.policy_version)?'Política registrada':'Conferir política',
      'Taxas, cashback e indicações usam regras próprias; configuração não comprova pagamento.',
      Number.isSafeInteger(d?.commercialPolicy?.policy_version)?
        'Política versão '+d.commercialPolicy.policy_version:'Sem versão financeira confirmada','finance'),
    card('push','Avisos às revendas',!e.push?'Não confirmado':
      (e.push.gates.senderEnabled||e.push.gates.cronEnabled)?'Configuração em revisão':'Automação desligada',
      'Inscrição e teste aceito pelo provedor não comprovam aviso visto no aparelho.',
      e.push?fmt(e.push.summary?.registeredDevices)+' aparelhos • '+
        fmt(e.push.summary?.reportedWarning7d)+' alertas de possível spam em 7 dias':'Sem evidência atual','system'),
    card('payments','Pagamentos',!e.governance?'Não confirmado':
      e.governance.runtime?.merchantDirectPaymentsEnabled===true?'Modo global habilitado':'Modo global desligado',
      'A configuração do ambiente não comprova homologação, cobrança nem repasse.',
      e.governance?'Verifique provedores e revendas individualmente.':'Sem evidência atual','finance'),
    card('cities','Cidades e autorização',e.governance?'Autorização por cidade':'Não confirmado',
      'Só o administrador principal autoriza o comércio. Operação global e revenda apta continuam obrigatórias.',
      e.governance?fmt(e.governance.cities?.filter(x=>x.commerceEnabled).length)+
        ' cidades autorizadas no cadastro; vendas ainda dependem de outros requisitos':'Sem evidência atual','system')
  ].join('');
  return '<section class="section admin-activation-desk" aria-label="Central de ativações estratégicas">'+
    '<div class="section-head"><div><span class="section-kicker">V1.307 • DECISÕES E EVIDÊNCIAS</span>'+
    '<h2>Ativações estratégicas</h2>'+
    '<p>Central de consulta e acesso aos controles reais. Esta tela nunca executa liberações automaticamente.</p></div>'+
    '<button type="button" class="primary small" '+(adminActivationDesk.loading?'disabled':'')+
    ' onclick="adminActivationLoad({force:true})">'+(adminActivationDesk.loading?'Conferindo…':'Atualizar tudo')+
    '</button></div>'+
    (adminActivationDesk.error?'<p class="notice danger">'+esc(adminActivationDesk.error)+'</p>':'')+
    '<p class="tiny muted">Última consulta: '+
    esc(current?formatDateTime(adminActivationDesk.checkedAt):'não confirmada')+
    '. Uma falha na consulta é mostrada como “Não confirmado”, nunca como recurso desligado.</p>'+
    '<div class="admin-activation-grid">'+cards+'</div>'+adminAdsLaunchReadinessView()+adminAdsLeadsView()+adminAdsAssistanceView()+adminAdsContactsView()+adminAdsFeedbackView()+adminAdsFeedbackReturnsView()+adminAdsReturnExecutionView()+adminMarketingIntakeView()+adminAdsSalesPlansView()+adminAdsDossiersView()+adminAdsInstrumentsView()+adminAdsReceivablesView()+adminAdsPspView()+adminAdsMpInboxView()+adminAdsMpTriageView()+adminAdsPspFreshnessView()+adminAdsPspMerchantReviewsView()+
    '<p class="tiny muted">Publicidade pública, vendas de cupons e automação de avisos exigem homologação e gates reais no servidor. Nenhum controle desta página contorna esses requisitos.</p></section>';
}

// V1.308 — founder-only intake decisions; no external publication/payment.
async function adminMarketingIntakeSet(moduleKey){
  if(!adminReady()||adminCurrentRole()!=='superadmin'||adminActivationDesk.loading)return false;
  const actor=String(adminRuntime.session?.user?.id||'');
  const fresh=adminActivationDesk.actor===actor&&adminActivationDesk.role==='superadmin'&&
    Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000;
  const item=fresh?adminActivationDesk.data?.intake?.controls?.find(x=>x.moduleKey===moduleKey):null;
  if(!item||!Number.isSafeInteger(item.version)||item.version<1)return false;
  const enabled=!item.enabled;
  const label=moduleKey==='ads_proposals'?'propostas de anúncios':'interesses no Clube';
  if(!confirm((enabled?'REABRIR':'SUSPENDER')+' novas '+label+
    '? Anúncios e cupons não serão publicados nem cobrados.'))return false;
  const reason=String(prompt('Justificativa obrigatória (8 a 240 caracteres):')||'').trim();
  if(reason.length<8||reason.length>240){
    toast('Informe uma justificativa de 8 a 240 caracteres.');return false;
  }
  try{
    const out=await adminPerform('commercial-intake-set',{
      moduleKey,enabled,reason,expectedVersion:item.version
    });
    if(out?.source!=='admin_marketing_intake_set_v1_308'||
       out.moduleKey!==moduleKey||out.enabled!==enabled||
       !Number.isSafeInteger(out.version)||out.adsPublicationEnabled!==false||
       out.couponSalesEnabled!==false||out.noMoneyMovement!==true)
      throw new Error('A decisão ainda não foi comprovada. Atualize o painel.');
    adminActivationDesk.data=null;
    const checked=await adminActivationLoad({force:true});
    if(checked?.intake?.controls?.find(c=>c.moduleKey===moduleKey)?.enabled!==enabled)
      throw new Error('Alteração registrada, mas leitura final não confirmada. Atualize o painel.');
    toast(enabled?'Novas propostas liberadas para cadastro.':'Novas propostas suspensas.');
    return true;
  }catch(error){
    adminActivationDesk.data=null;
    await adminActivationLoad({force:true});
    toast(String(error?.message||error));return false;
  }
}
function adminMarketingIntakeView(){
  if(!adminRoleCanSection('activations'))return '';
  const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
  const fresh=adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
    Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000;
  const data=fresh?adminActivationDesk.data?.intake:null;
  const modules=[
    {key:'ads_proposals',title:'Propostas de anúncios',hint:'Recebimento de interesses e peças para análise. Não libera exibição ou cobrança.'},
    {key:'clube_proposals',title:'Interesses no Clube',hint:'Novas propostas de participação das revendas. Não vende cupons ou reserva dinheiro.'}
  ];
  const cards=modules.map(m=>{
    const item=data?.controls?.find(x=>x.moduleKey===m.key);
    const status=item?(item.enabled?'Recebendo propostas':'Novas propostas suspensas'):'Não confirmado';
    const canEdit=role==='superadmin'&&item&&!adminActivationDesk.loading;
    const button=canEdit?'<button type="button" class="secondary small" onclick="adminMarketingIntakeSet(\''+
      m.key+'\')">'+(item.enabled?'Suspender novas propostas':'Reabrir propostas')+'</button>':
      '<small class="muted">Alteração indisponível para este perfil ou esta consulta.</small>';
    return '<article class="admin-activation-card"><div class="admin-activation-card-head"><strong>'+
      esc(m.title)+'</strong><span class="status-pill">'+esc(status)+'</span></div>'+
      '<p>'+esc(m.hint)+'</p>'+
      '<small>'+(item?'Versão '+Number(item.version)+' • última justificativa: '+esc(item.reason||'—'):
        'Sem leitura recente confirmada pelo banco.')+'</small>'+button+'</article>';
  }).join('');
  return '<section class="section admin-marketing-controls" aria-label="Recebimento de propostas comerciais">'+
    '<div class="section-head"><div><span class="section-kicker">V1.308 • DECISÃO DO ADMINISTRADOR PRINCIPAL</span>'+
    '<h2>Recebimento de propostas comerciais</h2>'+
    '<p>Controle efetivo e auditado no banco. Propostas antigas podem ser consultadas e retiradas mesmo com novas inscrições suspensas.</p></div></div>'+
    '<div class="admin-activation-grid">'+cards+'</div>'+
    '<p class="tiny muted">Somente o administrador principal altera estes estados, com confirmação, motivo e versão. Nenhuma opção ativa publicidade, cobrança, benefícios ou cidades.</p></section>';
}


// TAMÃO V1.309 — internal advertising sales planning only.
// "Ready for contact" means an internal worklist, never merchant approval or publication.
function adminAdsSalesPlansView(){
  if(!adminRoleCanSection('activations'))return '';
  const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
  const fresh=adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
    Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000;
  const data=fresh?adminActivationDesk.data?.adsSalesPlans:null;
  const money=c=>Number.isSafeInteger(c)?(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'—';
  const stages={draft:'Em elaboração',ready_for_contact:'Pronto para contato',paused:'Pausado',closed_lost:'Encerrado sem venda'};
  const offers=fresh?adminActivationDesk.data?.adsOffers:null;
  const rows=(data?.rows||[]).map(p=>{
    const merchantId=String(p.merchantId||'');
    if(!/^[0-9a-f-]{36}$/i.test(merchantId))return '';
    const editable=role==='superadmin'&&p.creativeEligible===true&&
      Number.isSafeInteger(p.creativeVersion)&&p.creativeVersion>0&&
      (p.version===0||p.creativeVersion===p.planCreativeVersion);
    const id='ads-plan-'+merchantId;
    const offer=offers?.rows?.find(x=>x.merchantId===merchantId)||null;
    const statusNames={shared:'Disponível no portal',interested:'Interesse registrado',declined:'Sem interesse',withdrawn:'Retirada'};
    const canShare=role==='superadmin'&&p.version>0&&p.stage==='ready_for_contact'&&
      p.creativeEligible===true&&p.planCreativeVersion===p.creativeVersion&&
      (!offer||offer.planVersion<p.version);
    const canWithdraw=role==='superadmin'&&offer?.status==='shared';
    const offerTools=offers?'<div class="admin-ads-plan-offer">'+
      '<p class="tiny muted">'+(offer?('Oferta: '+esc(statusNames[offer.status]||'Estado não confirmado')+
        ' • versão '+Number(offer.version)+(offer.expired?' • Prazo encerrado':'')):
        'Nenhuma oferta disponibilizada a esta revenda.')+'</p>'+
      (canShare?'<button type="button" class="secondary small" onclick="adminAdsOfferAction(\''+merchantId+'\',\'share\')">Disponibilizar oferta no portal da revenda</button>':'')+
      (canWithdraw?'<button type="button" class="secondary small" onclick="adminAdsOfferAction(\''+merchantId+'\',\'withdraw\')">Retirar oferta do portal</button>':'')+
      '</div>':'<p class="tiny muted">Disponibilização pendente de conferência do servidor.</p>';
    const fields=editable?'<div class="admin-ads-plan-fields">'+
      '<label>Valor planejado em R$ (não faturado)<input id="'+id+'-price" type="number" min="10" max="50000" step="1" inputmode="numeric" value="'+
        (Number.isSafeInteger(p.priceCents)?p.priceCents/100:99)+'"></label>'+
      '<label>Duração proposta em dias<input id="'+id+'-days" type="number" min="7" max="90" step="1" value="'+
        (Number.isSafeInteger(p.durationDays)?p.durationDays:7)+'"></label>'+
      '<label>Etapa comercial<select id="'+id+'-stage">'+
        Object.entries(stages).map(([key,label])=>'<option value="'+key+'" '+
          (p.stage===key?'selected':'')+'>'+label+'</option>').join('')+
      '</select></label>'+
      '<label class="admin-ads-plan-note">Observação interna<textarea id="'+id+'-note" rows="2" minlength="12" maxlength="500" placeholder="Anote o próximo passo, sem registrar contrato ou pagamento fictício">'+
        esc(p.note||'Planejar abordagem comercial com a revenda')+'</textarea></label>'+
      '<button type="button" class="primary small" onclick="adminAdsSalesPlanSave(\''+
        merchantId+'\')">Salvar planejamento</button></div>':
      '<p class="tiny muted">'+(role==='superadmin'?'Peça alterada ou retirada. Solicite nova aprovação antes de editar o plano.':
        'Somente o administrador principal pode alterar estes planos.')+'</p>';
    return '<article class="admin-activation-card"><div class="admin-activation-card-head"><strong>'+
      esc(p.companyName||'Revenda')+'</strong><span class="status-pill">'+
      esc(p.version>0?(stages[p.stage]||'Plano registrado'):'Sem plano')+'</span></div>'+
      '<p><strong>'+esc(p.title||'Peça não disponível')+'</strong></p>'+
      '<p class="tiny muted">'+esc([p.city,p.state].filter(Boolean).join('/')||'Cidade não confirmada')+
      ' • Criativo v'+esc(String(p.creativeVersion||'—'))+
      ' • Plano v'+esc(String(p.version))+'</p>'+
      (p.version>0?'<p class="tiny muted">Orçamento planejado: '+money(p.priceCents)+
        ' • '+esc(String(p.durationDays))+' dias • Nenhuma cobrança</p>':'')+
      fields+offerTools+'</article>';
  }).join('');
  return '<section class="section admin-ads-commercial-plans" aria-label="Planos comerciais de publicidade">'+
    '<div class="section-head"><div><span class="section-kicker">V1.309 • PUBLICIDADE E RECEITA POTENCIAL</span>'+
    '<h2>Planejamento comercial de anúncios</h2>'+
    '<p>Crie condições e acompanhe negociações sobre peças já aprovadas. Não há aceite do anunciante, publicação ou faturamento nesta etapa.</p></div></div>'+
    (data?'<p class="tiny muted">Peças aprovadas: <strong>'+data.approvedCreatives+
      '</strong> • Planos internos: <strong>'+data.totalPlans+
      '</strong> • Receita comprovada por este módulo: R$ 0,00.</p>':
      '<p class="muted">Não foi possível confirmar os planos no servidor. Atualize a central.</p>')+
    '<div class="admin-activation-grid">'+(rows||'<p class="muted">Nenhuma peça publicitária aprovada ainda. Use a área Parceiros → Propostas publicitárias para analisar os primeiros criativos.</p>')+
    '</div></section>';
}
async function adminAdsSalesPlanSave(merchantId){
  if(!adminReady()||adminCurrentRole()!=='superadmin'||adminActivationDesk.loading)return false;
  const actor=String(adminRuntime.session?.user?.id||'');
  if(adminActivationDesk.actor!==actor||adminActivationDesk.role!=='superadmin'||
    Date.now()-Date.parse(adminActivationDesk.checkedAt||'')>=120000)return false;
  const plan=adminActivationDesk.data?.adsSalesPlans?.rows?.find(x=>x.merchantId===merchantId);
  if(!plan||!plan.creativeEligible||!Number.isSafeInteger(plan.creativeVersion)||
    (plan.version>0&&plan.creativeVersion!==plan.planCreativeVersion))return false;
  const id='ads-plan-'+merchantId;
  const priceText=String(document.getElementById(id+'-price')?.value||'');
  const daysText=String(document.getElementById(id+'-days')?.value||'');
  const priceReais=/^\d+$/.test(priceText)?Number(priceText):NaN;
  const days=/^\d+$/.test(daysText)?Number(daysText):NaN;
  const stage=String(document.getElementById(id+'-stage')?.value||'');
  const note=String(document.getElementById(id+'-note')?.value||'').trim();
  if(!Number.isSafeInteger(priceReais)||priceReais<10||priceReais>50000||
    !Number.isSafeInteger(days)||days<7||days>90||
    !['draft','ready_for_contact','paused','closed_lost'].includes(stage)||
    note.length<12||note.length>500){
    toast('Revise valor (R$ 10 a R$ 50 mil), prazo (7 a 90 dias), etapa e nota (12 a 500 caracteres).');
    return false;
  }
  if(!confirm('Registrar planejamento interno de '+priceReais.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+
    ' por '+days+' dias? Isto NÃO cobra, publica, notifica ou firma contrato.'))return false;
  try{
    const result=await adminPerform('ads-sales-plan-save',{
      merchantId,creativeVersion:plan.creativeVersion,expectedVersion:plan.version,
      priceCents:priceReais*100,durationDays:days,stage,note,requestId:crypto.randomUUID()
    });
    if(result?.source!=='admin_ads_sales_plan_save_v1_309'||
      result.merchantId!==merchantId||!Number.isSafeInteger(result.version)||
      result.noCharge!==true||result.adsLive!==false||result.contractSigned!==false||
      result.paymentCreated!==false||result.merchantNotified!==false)
      throw new Error('Registro não comprovado pelo serviço.');
    adminActivationDesk.data=null;
    const confirmed=await adminActivationLoad({force:true});
    const saved=confirmed?.adsSalesPlans?.rows?.find(x=>x.merchantId===merchantId);
    if(!saved||saved.version!==result.version||saved.stage!==stage||
      saved.priceCents!==priceReais*100||saved.durationDays!==days)
      throw new Error('Plano registrado, mas leitura final não confirmada. Atualize a central.');
    toast('Plano registrado com auditoria. Nenhuma cobrança ou publicação foi realizada.');
    return true;
  }catch(e){
    adminActivationDesk.data=null;await adminActivationLoad({force:true});
    toast(String(e?.message||e));return false;
  }
}


// TAMÃO V1.310 — founder makes an existing approved plan visible only inside merchant portal.
async function adminAdsOfferAction(merchantId,operation){
 if(!adminReady()||adminCurrentRole()!=='superadmin'||adminActivationDesk.loading||
    !['share','withdraw'].includes(operation))return false;
 const actor=String(adminRuntime.session?.user?.id||'');
 if(adminActivationDesk.actor!==actor||adminActivationDesk.role!=='superadmin'||
    Date.now()-Date.parse(adminActivationDesk.checkedAt||'')>=120000)return false;
 const plan=adminActivationDesk.data?.adsSalesPlans?.rows?.find(x=>x.merchantId===merchantId);
 const offers=adminActivationDesk.data?.adsOffers;
 const offer=offers?.rows?.find(x=>x.merchantId===merchantId);
 if(!plan||!offers||!Number.isSafeInteger(plan.version)||plan.version<1)return false;
 if(operation==='share'&&(plan.stage!=='ready_for_contact'||!plan.creativeEligible||
     plan.planCreativeVersion!==plan.creativeVersion||
     (offer&&offer.planVersion>=plan.version)))return false;
 if(operation==='withdraw'&&(!offer||offer.status!=='shared'))return false;
 const planVersion=operation==='withdraw'?offer.planVersion:plan.version;
 if(!confirm((operation==='share'?'Disponibilizar as condições no portal desta revenda':
   'Retirar a oferta disponível')+
   '? Nenhuma cobrança, contrato, anúncio ou mensagem externa será criada.'))return false;
 const reason=String(prompt('Motivo da decisão administrativa (12 a 240 caracteres):')||'').trim();
 if(reason.length<12||reason.length>240){toast('Informe motivo de 12 a 240 caracteres.');return false;}
 try{
   const out=await adminPerform('ads-offer-action',{
     merchantId,operation,planVersion,expectedOfferVersion:offer?.version||0,
     reason,requestId:crypto.randomUUID()
   });
   if(out?.source!=='admin_ads_offer_action_v1_310'||out.merchantId!==merchantId||
     out.operation!==operation||!Number.isSafeInteger(out.version)||
     out.status!==(operation==='share'?'shared':'withdrawn')||
     out.noCharge!==true||out.adsLive!==false||out.contractSigned!==false||
     out.merchantNotified!==false)throw new Error('Ação comercial não comprovada.');
   adminActivationDesk.data=null;
   const checked=await adminActivationLoad({force:true});
   const current=checked?.adsOffers?.rows?.find(x=>x.merchantId===merchantId);
   if(!current||current.version!==out.version||current.status!==out.status)
      throw new Error('Registro efetuado, mas leitura final ainda não confirmada.');
   toast(operation==='share'?'Oferta disponível no portal, sem envio automático.':'Oferta retirada do portal.');
   return true;
 }catch(e){
   adminActivationDesk.data=null;await adminActivationLoad({force:true});
   toast(String(e?.message||e));return false;
 }
}


// V1.311 — contract-review dossier, NO signed contract, invoice or Ads publication.
function adminAdsDossiersView(){
 if(!adminRoleCanSection('activations'))return '';
 const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
 const fresh=adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
   Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000;
 const dossiers=fresh?adminActivationDesk.data?.adsDossiers:null;
 const offers=fresh?adminActivationDesk.data?.adsOffers:null;
 const labels={draft:'Minuta em preparação',shared_for_review:'Disponível para revisão',
   changes_requested:'Revenda solicitou alterações',reviewed:'Revisão confirmada — não assinada',
   withdrawn:'Documento retirado'};
 const rows=(offers?.rows||[]).filter(o=>o.status==='interested').map(o=>{
   const id=String(o.merchantId||'');
   if(!/^[0-9a-f-]{36}$/i.test(id))return '';
   const d=dossiers?.rows?.find(x=>x.merchantId===id);
   const editable=role==='superadmin'&&(!d||['draft','changes_requested'].includes(d.status))&&
     (!d||d.offerVersion===o.version);
   const editableHtml=editable?'<div class="admin-ads-dossier-fields">'+
     '<label>Escopo e entrega prevista<textarea id="ads-dossier-'+id+'-scope" rows="4" minlength="60" maxlength="700" '+
       'placeholder="Descreva o espaço publicitário, região, duração e critérios de medição previstos">'+
       esc(d?.serviceScope||'')+'</textarea></label>'+
     '<label>Cancelamento e ajustes<textarea id="ads-dossier-'+id+'-cancel" rows="3" minlength="40" maxlength="700" '+
       'placeholder="Descreva prazos de cancelamento, ajustes e reembolso sujeitos a contrato">'+
       esc(d?.cancellationTerms||'')+'</textarea></label>'+
     '<label>Vencimento proposto após futura cobrança (dias)<input id="ads-dossier-'+id+'-due" type="number" min="1" max="30" step="1" value="'+
       Number(d?.dueDays||7)+'"></label>'+
     '<button class="primary small" type="button" onclick="adminAdsDossierAction(\''+id+'\',\'save\')">Salvar minuta</button></div>':'';
   const commands=role==='superadmin'&&d?.offerVersion===o.version?
     (d.status==='draft'?'<button class="secondary small" type="button" onclick="adminAdsDossierAction(\''+id+'\',\'share\')">Disponibilizar minuta para revisão</button>':
      d.status==='shared_for_review'?'<button class="secondary small" type="button" onclick="adminAdsDossierAction(\''+id+'\',\'withdraw\')">Retirar minuta</button>':''):'';
   return '<article class="admin-activation-card"><div class="admin-activation-card-head"><strong>'+
     esc(o.companyName||'Revenda')+'</strong><span class="status-pill">'+
     esc(d?(labels[d.status]||'Em análise'):'Sem minuta')+'</span></div>'+
     '<p>Proposta com interesse registrado: <strong>'+(Number(o.priceCents)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+
     '</strong> por '+Number(o.durationDays)+' dias.</p>'+
     (d?'<p class="tiny muted">Documento v'+d.version+' • Oferta v'+d.offerVersion+
       ' • vencimento proposto em '+d.dueDays+' dias • sem fatura</p>':'')+
     (d?'<details><summary>Consultar condições</summary><p>'+esc(d.serviceScope)+'</p><p>'+esc(d.cancellationTerms)+'</p></details>':'')+
     editableHtml+commands+'</article>';
 }).join('');
 return '<section class="section admin-ads-dossiers">'+
   '<div class="section-head"><div><span class="section-kicker">V1.311 • NEGOCIAÇÃO DOCUMENTADA</span>'+
   '<h2>Condições contratuais e cobrança futura</h2>'+
   '<p>Prepare o escopo, as regras de cancelamento e o vencimento proposto. A revenda revisa os termos antes de qualquer contrato ou cobrança.</p></div></div>'+
   (offers&&dossiers?'<p class="tiny muted">'+dossiers.totalDossiers+
      ' dossiê(s) no servidor • Receita comprovada deste fluxo: R$ 0,00 • Nenhum contrato assinado.</p>':
      '<p class="muted">Consulta do dossiê não confirmada; atualize a Central de Ativações.</p>')+
   '<div class="admin-activation-grid">'+(rows||'<p class="muted">Nenhuma revenda demonstrou interesse em uma oferta de publicidade ainda. A minuta só pode ser preparada depois dessa manifestação.</p>')+
   '</div></section>';
}
async function adminAdsDossierAction(merchantId,operation){
 if(!adminReady()||adminCurrentRole()!=='superadmin'||adminActivationDesk.loading||
    !['save','share','withdraw'].includes(operation))return false;
 const actor=String(adminRuntime.session?.user?.id||'');
 if(adminActivationDesk.actor!==actor||adminActivationDesk.role!=='superadmin'||
   Date.now()-Date.parse(adminActivationDesk.checkedAt||'')>=120000)return false;
 const offer=adminActivationDesk.data?.adsOffers?.rows?.find(x=>x.merchantId===merchantId);
 const d=adminActivationDesk.data?.adsDossiers?.rows?.find(x=>x.merchantId===merchantId);
 if(!offer||offer.status!=='interested'||(d&&d.offerVersion!==offer.version))return false;
 if(operation==='save'&&d&&!['draft','changes_requested'].includes(d.status))return false;
 if(operation==='share'&&d?.status!=='draft')return false;
 if(operation==='withdraw'&&d?.status!=='shared_for_review')return false;
 let serviceScope=null,cancellationTerms=null,dueDays=null;
 if(operation==='save'){
   serviceScope=String(document.getElementById('ads-dossier-'+merchantId+'-scope')?.value||'').trim();
   cancellationTerms=String(document.getElementById('ads-dossier-'+merchantId+'-cancel')?.value||'').trim();
   dueDays=Number(document.getElementById('ads-dossier-'+merchantId+'-due')?.value||0);
   if(serviceScope.length<60||serviceScope.length>700||
     cancellationTerms.length<40||cancellationTerms.length>700||
     !Number.isSafeInteger(dueDays)||dueDays<1||dueDays>30){
      toast('Informe escopo (60–700 caracteres), cancelamento (40–700) e prazo (1–30 dias).');
      return false;
   }
 }
 if(!confirm(operation==='save'?'Salvar minuta apenas para revisão interna, sem enviar à revenda?':
   operation==='share'?'Disponibilizar estas condições no portal da revenda para revisão? Não haverá contratação ou cobrança.':
   'Retirar a minuta do portal sem criar cobranças?'))return false;
 try{
   const out=await adminPerform('ads-dossier-action',{
     merchantId,operation,offerVersion:offer.version,expectedVersion:d?.version||0,
     serviceScope,cancellationTerms,dueDays,requestId:crypto.randomUUID()
   });
   const status=operation==='save'?'draft':operation==='share'?'shared_for_review':'withdrawn';
   if(out?.source!=='admin_ads_dossier_action_v1_311'||out.merchantId!==merchantId||
     out.status!==status||!Number.isSafeInteger(out.version)||out.version<1||
     out.recorded!==true||out.noCharge!==true||out.adsLive!==false||
     out.contractSigned!==false||out.paymentRequestCreated!==false)
     throw new Error('Ação do dossiê não foi confirmada.');
   adminActivationDesk.data=null;
   const verified=await adminActivationLoad({force:true});
   const updated=verified?.adsDossiers?.rows?.find(x=>x.merchantId===merchantId);
   if(!updated||updated.status!==status||updated.version!==out.version)
     throw new Error('Registro criado, mas consulta posterior ainda não confirmada.');
   toast('Dossiê atualizado, sem contrato assinado ou cobrança.');
   return true;
 }catch(e){
   adminActivationDesk.data=null;await adminActivationLoad({force:true});
   toast(String(e?.message||e));return false;
 }
}


// V1.312 — electronic agreement accepted with authenticated identities and frozen SHA-256.
// This is not a certified signature and never triggers Ads billing or delivery.
function adminAdsInstrumentsView(){
 if(!adminRoleCanSection('activations'))return '';
 const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
 const recent=adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
    Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000;
 const instruments=recent?adminActivationDesk.data?.adsInstruments:null;
 const dossiers=recent?adminActivationDesk.data?.adsDossiers:null;
 const fmt={offered:'Disponível para aceite',merchant_accepted:'Aceito pela revenda',bilateral_accepted:'Aceite bilateral registrado'};
 const rows=(dossiers?.rows||[]).filter(d=>d.status==='reviewed').map(d=>{
  const id=String(d.merchantId||''),i=instruments?.rows?.find(x=>x.merchantId===id);
  if(!/^[0-9a-f-]{36}$/i.test(id))return '';
  const make=role==='superadmin'&&!i?
   '<div class="admin-ads-instrument-fields"><label>Razão social da empresa responsável pelo TAMÃO<input id="ads-sign-'+id+'-company" maxlength="160" placeholder="Razão social registrada"></label>'+
   '<label>CNPJ da empresa responsável (14 números)<input id="ads-sign-'+id+'-cnpj" inputmode="numeric" maxlength="14" placeholder="Somente números"></label>'+
   '<p class="tiny muted">A razão social e o CNPJ da revenda são consultados no cadastro do servidor. É preciso conferir as identidades jurídicas antes de emitir o documento.</p>'+
   '<button type="button" class="primary small" onclick="adminAdsInstrumentAction(\''+id+'\',\'issue\')">Emitir instrumento para aceite</button></div>':'';
  const countersign=role==='superadmin'&&i?.status==='merchant_accepted'?
   '<button type="button" class="primary small" onclick="adminAdsInstrumentAction(\''+id+'\',\'founder_accept\')">Confirmar aceite pelo TAMÃO</button>':'';
  return '<article class="admin-activation-card"><div class="admin-activation-card-head"><strong>'+
    esc(d.companyName||'Revenda')+'</strong><span class="status-pill">'+
    esc(i?fmt[i.status]||'Não confirmado':'Elegível para emissão')+'</span></div>'+
    '<p>Minuta revisada v'+d.version+' • '+
    (Number(d.priceCents)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+
    ' • '+d.durationDays+' dias.</p>'+
    (i?'<p><strong>'+esc(i.document.platformLegalName)+'</strong> e <strong>'+
      esc(i.document.merchantLegalName)+'</strong></p>'+
      '<p class="tiny muted">Documento SHA-256: <code>'+esc(i.sha256)+'</code></p>'+
      '<details><summary>Conferir o documento congelado</summary><p>'+esc(i.document.serviceScope)+'</p>'+
      '<p>'+esc(i.document.cancellationTerms)+'</p><p>'+esc(i.document.executionCondition)+'</p>'+
      '<p class="tiny muted">CNPJ TAMÃO '+esc(i.document.platformCnpj)+
      ' • CNPJ revenda '+esc(i.document.merchantCnpj)+'</p></details>':'')+
    make+countersign+'</article>';
 }).join('');
 return '<section class="section admin-ads-instruments">'+
   '<div class="section-head"><div><span class="section-kicker">V1.312 • INSTRUMENTO ELETRÔNICO</span>'+
   '<h2>Aceite eletrônico de publicidade</h2>'+
   '<p>Documento fixo com identidade das partes e SHA-256. A revenda aceita primeiro; o administrador confirma depois.</p></div></div>'+
   (instruments&&dossiers?'<p class="tiny muted">'+instruments.totalInstruments+
       ' documento(s) emitido(s) • Nenhuma cobrança ou exibição autorizada por esta etapa.</p>':
       '<p class="muted">A consulta aos documentos não foi confirmada. Atualize a central.</p>')+
   '<div class="admin-activation-grid">'+(rows||'<p class="muted">Não há minuta revisada pronta para emissão. Conclua primeiro a negociação comercial e a revisão do titular.</p>')+'</div>'+
   '<p class="tiny muted">Aceite autenticado não é certificado ICP-Brasil. A validade e adequação jurídica devem ser avaliadas conforme as partes e a operação. Este módulo não cria fatura, pagamento ou campanha pública.</p></section>';
}
async function adminAdsInstrumentAction(merchantId,operation){
 if(!adminReady()||adminCurrentRole()!=='superadmin'||adminActivationDesk.loading||
    !['issue','founder_accept'].includes(operation))return false;
 const actor=String(adminRuntime.session?.user?.id||'');
 if(adminActivationDesk.actor!==actor||adminActivationDesk.role!=='superadmin'||
    Date.now()-Date.parse(adminActivationDesk.checkedAt||'')>=120000)return false;
 const d=adminActivationDesk.data?.adsDossiers?.rows?.find(x=>x.merchantId===merchantId);
 const i=adminActivationDesk.data?.adsInstruments?.rows?.find(x=>x.merchantId===merchantId);
 if(!d||d.status!=='reviewed'||(operation==='issue'&&i)||
   (operation==='founder_accept'&&i?.status!=='merchant_accepted'))return false;
 let platformLegalName=null,platformCnpj=null,sha256=null,expectedVersion=i?.version||0;
 if(operation==='issue'){
  platformLegalName=String(document.getElementById('ads-sign-'+merchantId+'-company')?.value||'').trim();
  platformCnpj=String(document.getElementById('ads-sign-'+merchantId+'-cnpj')?.value||'').replace(/\D/g,'');
  if(platformLegalName.length<5||platformLegalName.length>160||!/^\d{14}$/.test(platformCnpj)){
    toast('Informe razão social (5–160 caracteres) e CNPJ de 14 dígitos da empresa TAMÃO.');return false;
  }
 }else{
  sha256=String(i.sha256||'');
  if(!/^[a-f0-9]{64}$/.test(sha256))return false;
 }
 if(!confirm(operation==='issue'?'Emitir documento imutável com estes dados jurídicos declarados? A emissão não cobra nem publica anúncios.':
   'Registrar aceite autenticado do administrador neste mesmo documento? Nenhuma cobrança ou publicação será criada.'))return false;
 try{
  const result=await adminPerform('ads-instrument-action',{
    merchantId,operation,expectedVersion,platformLegalName,platformCnpj,sha256,
    requestId:crypto.randomUUID()
  });
  const status=operation==='issue'?'offered':'bilateral_accepted';
  if(result?.source!=='admin_ads_instrument_action_v1_312'||result.merchantId!==merchantId||
     result.status!==status||!Number.isSafeInteger(result.version)||
     !/^[a-f0-9]{64}$/.test(String(result.sha256||''))||
     result.noCharge!==true||result.adsLive!==false||
     result.paymentRequestCreated!==false||result.notIcpCertified!==true)
   throw new Error('Instrumento não confirmado no serviço.');
  adminActivationDesk.data=null;
  const checked=await adminActivationLoad({force:true});
  const newRow=checked?.adsInstruments?.rows?.find(x=>x.merchantId===merchantId);
  if(!newRow||newRow.status!==status||newRow.sha256!==result.sha256||
     newRow.version!==result.version)
   throw new Error('Instrumento registrado, porém a leitura posterior não foi confirmada.');
  toast('Registro eletrônico confirmado, sem cobrança ou anúncio publicado.');
  return true;
 }catch(e){
  adminActivationDesk.data=null;await adminActivationLoad({force:true});
  toast(String(e?.message||e));return false;
 }
}


// V1.313 — Ads-specific payment statements. Never mark funds received without PSP verification.
function adminAdsReceivablesView(){
 if(!adminRoleCanSection('activations'))return '';
 const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
 const fresh=adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
   Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000;
 const data=fresh?adminActivationDesk.data?.adsReceivables:null;
 const fmt={draft:'Prévia interna',issued:'Demonstrativo emitido • aguardando pagamento',
   canceled:'Cancelado'};
 const entries=(data?.rows||[]).map(x=>{
  const id=String(x.merchantId||''),r=x.receivable;
  if(!/^[0-9a-f-]{36}$/i.test(id))return '';
  const action=role==='superadmin'?(!r?'prepare':r.status==='draft'?'issue':
    r.status==='issued'?'cancel':null):null;
  const button=action?'<button type="button" class="'+(action==='issue'?'primary':'secondary')+
    ' small" onclick="adminAdsReceivableAction(\''+id+'\',\''+action+'\')">'+
    ({prepare:'Preparar demonstrativo Ads',issue:'Emitir cobrança comercial',
      cancel:'Cancelar demonstrativo'}[action])+'</button>':'';
  return '<article class="admin-activation-card"><div class="admin-activation-card-head">'+
    '<strong>'+esc(x.merchantName||'Revenda')+'</strong>'+
    '<span class="status-pill">'+esc(r?fmt[r.status]:'Sem demonstrativo')+'</span></div>'+
    '<p><strong>'+(x.amountCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+
    '</strong> • prazo sugerido '+x.dueDays+' dias</p>'+
    (r?'<p class="tiny muted">Documento v'+r.version+
      ' • '+esc(r.status==='draft'?'Vencimento ainda não definido':('Vencimento: '+String(r.dueDate||'—')))+
      '</p>':'')+
    '<p class="tiny muted">Referências de pagamento informadas e não verificadas: '+
     Number(x.paymentReportsUnverified||0)+'. Nenhum pagamento confirmado por este módulo.</p>'+
    '<p class="tiny muted">Contrato SHA-256: <code>'+esc(x.sha256)+'</code></p>'+
    button+'</article>';
 }).join('');
 return '<section class="section admin-ads-receivables">'+
  '<div class="section-head"><div><span class="section-kicker">V1.313 • MONETIZAÇÃO CONTROLADA</span>'+
  '<h2>Cobranças de publicidade TAMÃO Ads</h2>'+
  '<p>Prepare e emita demonstrativos comerciais apenas após o aceite bilateral. A receita é separada das taxas e créditos das revendas.</p></div></div>'+
  (data?'<p class="tiny muted">Demonstrativos: '+data.totalReceivables+
    ' • Emitidos: '+data.issuedReceivables+
    ' • Referências não verificadas: '+data.unverifiedReports+
    ' • Receita comprovada: R$ 0,00.</p>':
    '<p class="muted">Não foi possível verificar o livro de cobranças. Atualize a central.</p>')+
  '<div class="admin-activation-grid">'+(entries||'<p class="muted">Não há contrato com aceite bilateral registrado. Nenhuma cobrança pode ser preparada antes disso.</p>')+
  '</div><p class="tiny muted">A emissão cria apenas registro interno consultável no portal. Não gera Pix, boleto, nota fiscal, cobrança PSP, reconhecimento de receita ou anúncio público. A confirmação financeira exigirá integração conciliada.</p></section>';
}
async function adminAdsReceivableAction(merchantId,operation){
 if(!adminReady()||adminCurrentRole()!=='superadmin'||adminActivationDesk.loading||
    !['prepare','issue','cancel'].includes(operation))return false;
 const actor=String(adminRuntime.session?.user?.id||'');
 if(adminActivationDesk.actor!==actor||adminActivationDesk.role!=='superadmin'||
   Date.now()-Date.parse(adminActivationDesk.checkedAt||'')>=120000)return false;
 const entry=adminActivationDesk.data?.adsReceivables?.rows?.find(r=>r.merchantId===merchantId);
 const r=entry?.receivable;
 if(!entry||entry.instrumentStatus!=='bilateral_accepted'||
   !/^[a-f0-9]{64}$/.test(String(entry.sha256||''))||
   (operation==='prepare'&&r)||
   (operation==='issue'&&r?.status!=='draft')||
   (operation==='cancel'&&r?.status!=='issued'))return false;
 const reason=String(prompt('Justificativa administrativa (12 a 240 caracteres):')||'').trim();
 if(reason.length<12||reason.length>240){toast('Informe a justificativa com 12 a 240 caracteres.');return false;}
 const terms={prepare:'Preparar demonstrativo interno, sem vencimento ou pedido de pagamento?',
   issue:'Emitir demonstrativo comercial visível à revenda, com valor e vencimento? Não será gerado Pix, boleto ou cobrança PSP.',
   cancel:'Cancelar o demonstrativo emitido? Isso não estorna pagamentos externos.'};
 if(!confirm(terms[operation]))return false;
 try{
  const result=await adminPerform('ads-receivable-action',{
    merchantId,operation,documentSha256:entry.sha256,
    expectedVersion:r?.version||0,reason,requestId:crypto.randomUUID()
  });
  const status=operation==='prepare'?'draft':operation==='issue'?'issued':'canceled';
  if(result?.source!=='admin_ads_receivable_action_v1_313'||result.merchantId!==merchantId||
    result.status!==status||!Number.isSafeInteger(result.version)||
    result.recorded!==true||result.verifiedPaid!==false||result.pspChargeCreated!==false||
    result.adsLive!==false||result.merchantBillingSeparate!==true)
    throw new Error('O demonstrativo não foi confirmado.');
  adminActivationDesk.data=null;
  const checked=await adminActivationLoad({force:true});
  const saved=checked?.adsReceivables?.rows?.find(x=>x.merchantId===merchantId)?.receivable;
  if(!saved||saved.version!==result.version||saved.status!==status)
    throw new Error('Registro salvo, mas conferência posterior pendente.');
  toast('Demonstrativo atualizado. Sem movimentação financeira ou publicação.');
  return true;
 }catch(e){
  adminActivationDesk.data=null;await adminActivationLoad({force:true});
  toast(String(e?.message||e));return false;
 }
}


// V1.314 — Checkout Pro only when the platform account is independently configured.
function adminAdsPspView(){
 if(!adminRoleCanSection('activations'))return '';
 const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
 const fresh=adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
  Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000;
 const d=fresh?adminActivationDesk.data?.adsPsp:null;
 const status={reserved:'Reserva protegida — requer recuperação supervisionada',
  checkout_ready:'Checkout disponível para pagamento',
  payment_approved:'Pagamento aprovado na última conferência do provedor',
  payment_reversed:'Pagamento estornado ou contestado no provedor'};
 const rows=(d?.rows||[]).map(x=>{
  const id=String(x.merchantId||''),c=x.checkout;
  if(!/^[0-9a-f-]{36}$/i.test(id))return '';
  const canCreate=role==='superadmin'&&d.platformPspConfigured===true&&!c&&
   x.receivable?.status==='issued';
  const canReconcile=role==='superadmin'&&d.platformPspConfigured===true&&
   ['checkout_ready','payment_approved'].includes(c?.status);
  return '<article class="admin-activation-card"><div class="admin-activation-card-head"><strong>'+
    esc(x.merchantName||'Revenda')+'</strong><span class="status-pill">'+
    esc(c?status[c.status]:'Checkout não iniciado')+'</span></div>'+
    '<p><strong>'+(Number(x.amountCents)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+
    '</strong> • demonstrativo: '+esc(x.receivable?.status||'Não emitido')+'</p>'+
    (c?'<p class="tiny muted">Referência: '+esc(c.externalReference)+
      ' • versão '+Number(c.version)+'</p>'+
      (c.paymentId?'<p class="tiny muted">Pagamento: '+esc(c.paymentId)+
      ' • '+esc(c.providerStatus||'')+'</p>':''):'')+
    (canCreate?'<button type="button" class="primary small" onclick="adminAdsPspAction(\''+id+'\',\'create\')">Gerar checkout Mercado Pago</button>':'')+
    (canReconcile?'<button type="button" class="primary small" onclick="adminAdsPspAutoReview(\''+id+'\')">Localizar e conciliar automaticamente</button>':'')+
    (canReconcile?'<button type="button" class="secondary small" onclick="adminAdsPspAction(\''+id+'\',\'reconcile\')">Conferir pelo ID do pagamento</button>':'')+
    (c?.checkoutUrl?'<p class="tiny muted">O link do checkout está disponível no portal da revenda. Não use retorno de navegador como confirmação de pagamento.</p>':'')+
    '</article>';
 }).join('');
 return '<section class="section admin-ads-psp"><div class="section-head"><div>'+
   '<span class="section-kicker">V1.314 • PAGAMENTO VERIFICADO</span>'+
   '<h2>Mercado Pago exclusivo do TAMÃO Ads</h2>'+
   '<p>Checkout da empresa operadora, com conferência independente pelo provedor. Não utiliza o dinheiro ou as integrações das revendas.</p></div></div>'+
   (d?'<p class="tiny muted">'+
     (d.platformPspConfigured?'Credenciais independentes configuradas — validação da conta ocorre no momento da ação.':
      'Checkout desativado: requer credenciais da conta TAMÃO Ads e habilitação expressa no servidor.')+
     ' • Checkouts: '+d.totalCheckouts+' • Aprovações verificadas: '+d.providerApprovedCount+
     ' • Total bruto com aprovação: '+(d.providerApprovedGrossCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+
     ' (sujeito a estornos)</p>':
     '<p class="muted">Leitura da integração não confirmada. Atualize a central.</p>')+
   '<div class="admin-activation-grid">'+(rows||'<p class="muted">Nenhum contrato bilateral apto a iniciar checkout.</p>')+'</div>'+
   '<p class="tiny muted">Uma resposta do navegador nunca confirma pagamento. A verificação usa a API autenticada do Mercado Pago e não libera anúncios; estornos e contestações devem ser reavaliados.</p></section>';
}

// V1.315: use the provider reference to find a payment without typing its ID.
// No local payment state changes until the provider is refetched in V1.314 reconciliation.
async function adminAdsPspAutoReview(merchantId){
 if(!adminReady()||adminCurrentRole()!=='superadmin'||adminActivationDesk.loading)return false;
 const actor=String(adminRuntime.session?.user?.id||'');
 if(adminActivationDesk.actor!==actor||adminActivationDesk.role!=='superadmin'||
  Date.now()-Date.parse(adminActivationDesk.checkedAt||'')>=120000)return false;
 const desk=adminActivationDesk.data?.adsPsp;
 const row=desk?.rows?.find(x=>x.merchantId===merchantId);
 if(desk?.platformPspConfigured!==true||
   !['checkout_ready','payment_approved'].includes(row?.checkout?.status))return false;
 try{
  const result=await adminPerform('ads-psp-discover',{merchantId});
  const allowed=['approval_candidate','reversal_candidate','unchanged','not_found','manual_review','pending_or_review'];
  if(result?.source!=='admin_ads_psp_discovery_v1_315'||result.merchantId!==merchantId||
    result.externalReference!==row.checkout.externalReference||
    result.adsLive!==false||result.merchantBillingSeparate!==true||
    result.providerEvidenceRecorded!==false||
    !allowed.includes(result.status)||
    !Number.isSafeInteger(result.candidateCount)||result.candidateCount<0)
   throw new Error('A busca financeira não foi confirmada pelo servidor.');
  if(result.status==='not_found'){
   toast('Nenhum pagamento encontrado nesta consulta; isso não comprova ausência de pagamento. Tente novamente ou confira pelo Mercado Pago.');
   return false;
  }
  if(result.status==='manual_review'){
   toast('Há múltiplos pagamentos ou resultados ambíguos. Nenhum pagamento foi marcado como recebido. Confira os IDs diretamente no provedor.');
   return false;
  }
  if(result.status==='unchanged'){
   toast('O pagamento continua aprovado na consulta atual, sujeito a estornos posteriores. Nenhuma nova movimentação.');
   return true;
  }
  if(result.status==='pending_or_review'){
   toast('Pagamento localizado, mas ainda não possui estado compatível com aprovação integral ou estorno comprovado.');
   return false;
  }
  const paymentId=String(result.paymentId||'');
  if(!/^[0-9]{5,30}$/.test(paymentId))throw new Error('Identificador do pagamento inválido.');
  const targetStatus=result.status==='approval_candidate'?'payment_approved':'payment_reversed';
  const operationDescription=targetStatus==='payment_approved'?'aprovação integral':'estorno/contestação';
  if(!confirm('Mercado Pago encontrou um candidato a '+operationDescription+
    ' do pagamento '+paymentId+'. Confirmar a conciliação com uma nova consulta de segurança ao provedor?'))return false;
  const verified=await adminPerform('ads-psp-action',{
   merchantId,operation:'reconcile',paymentId,requestId:crypto.randomUUID()
  });
  if(verified?.source!=='admin_ads_psp_reconcile_v1_314'||verified.merchantId!==merchantId||
    verified.paymentId!==paymentId||verified.status!==targetStatus||
    verified.verifiedFromProvider!==true||verified.adsLive!==false)
   throw new Error('A conciliação final não foi confirmada pelo provedor e pelo banco.');
  adminActivationDesk.data=null;
  const fresh=await adminActivationLoad({force:true});
  const updated=fresh?.adsPsp?.rows?.find(x=>x.merchantId===merchantId)?.checkout;
  if(!updated||updated.status!==targetStatus||updated.paymentId!==paymentId)
   throw new Error('Pagamento conferido, mas a leitura posterior do livro financeiro ainda não foi confirmada.');
  toast(targetStatus==='payment_approved'?
   'Pagamento integral confirmado no provedor. Publicação dos anúncios permanece bloqueada.':
   'Estorno/contestação confirmado no provedor. Nenhuma publicidade foi liberada.');
  return true;
 }catch(e){
  adminActivationDesk.data=null;await adminActivationLoad({force:true});
  toast(String(e?.message||e));return false;
 }
}

async function adminAdsPspAction(merchantId,operation,prefilledPaymentId=null){
 if(!adminReady()||adminCurrentRole()!=='superadmin'||adminActivationDesk.loading||
  !['create','reconcile'].includes(operation))return false;
 const actor=String(adminRuntime.session?.user?.id||'');
 if(adminActivationDesk.actor!==actor||adminActivationDesk.role!=='superadmin'||
  Date.now()-Date.parse(adminActivationDesk.checkedAt||'')>=120000)return false;
 const data=adminActivationDesk.data?.adsPsp;
 const x=data?.rows?.find(r=>r.merchantId===merchantId);
 if(!x||data?.platformPspConfigured!==true)return false;
 let paymentId=null;
 if(operation==='create'){
  if(x.checkout||x.receivable?.status!=='issued')return false;
  if(!confirm('Criar checkout REAL no Mercado Pago na conta da empresa TAMÃO Ads? Nenhum dinheiro será movimentado automaticamente e nenhum anúncio será publicado.'))return false;
 }else{
  if(!['checkout_ready','payment_approved'].includes(x.checkout?.status))return false;
  paymentId=String(prefilledPaymentId||prompt('Informe o ID NUMÉRICO do pagamento no Mercado Pago para consulta direta:')||'').trim();
  if(!/^[0-9]{5,30}$/.test(paymentId)){toast('Informe o identificador numérico completo.');return false;}
  if(!confirm('Consultar o pagamento informado diretamente no Mercado Pago e registrar seu estado comprovado?'))return false;
 }
 try{
  const out=await adminPerform('ads-psp-action',{
   merchantId,operation,paymentId,requestId:crypto.randomUUID()
  });
  const expected=operation==='create'?'checkout_ready':null;
  if(!['admin_ads_psp_create_v1_314','admin_ads_psp_reconcile_v1_314'].includes(out?.source)||
   out.merchantId!==merchantId||
   (expected&&out.status!==expected)||
   out.adsLive===true||out.noAdsPublication===false)
   throw new Error('A operação financeira não foi confirmada.');
  adminActivationDesk.data=null;
  const fresh=await adminActivationLoad({force:true});
  const live=fresh?.adsPsp?.rows?.find(r=>r.merchantId===merchantId)?.checkout;
  if(!live||live.status!==out.status)throw new Error('Provedor consultado, mas leitura posterior pendente.');
  toast('Estado do checkout conferido no servidor, sem publicação automática.');
  return true;
 }catch(e){
  adminActivationDesk.data=null;await adminActivationLoad({force:true});
  toast(String(e?.message||e));return false;
 }
}


// V1.316 — signed provider events only create a review inbox, NOT payment approval.
function adminAdsMpInboxView(){
 if(!adminRoleCanSection('activations'))return '';
 const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
 const fresh=adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
   Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000;
 const inbox=fresh?adminActivationDesk.data?.adsMpInbox:null;
 const psp=fresh?adminActivationDesk.data?.adsPsp:null;
 const rows=(inbox?.rows||[]).map(x=>{
  const merchantId=String(x.merchantId||''),paymentId=String(x.paymentId||'');
  const checkout=psp?.rows?.find(y=>y.merchantId===merchantId)?.checkout;
  const canReview=role==='superadmin'&&psp?.platformPspConfigured===true&&
   ['checkout_ready','payment_approved'].includes(checkout?.status)&&
   /^[0-9]{5,30}$/.test(paymentId)&&/^[0-9a-f-]{36}$/i.test(merchantId);
  return '<article class="admin-activation-card">'+
   '<div class="admin-activation-card-head"><strong>'+esc(x.merchantName||'Revenda')+
   '</strong><span class="status-pill">Evento verificado no provedor</span></div>'+
   '<p><strong>'+esc(x.providerStatus)+'</strong> • '+
    (Number(x.amountCents)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+
   ' • Pagamento '+esc(paymentId)+'</p>'+
   '<p class="tiny muted">Recebido: '+esc(String(x.receivedAt||'—'))+
   ' • Estado do livro financeiro: '+esc(x.checkoutStatus)+
   ' • Nenhuma mudança automática de pagamento.</p>'+
   (canReview?'<button type="button" class="secondary small" onclick="adminAdsPspAction(\''+
    merchantId+'\',\'reconcile\',\''+paymentId+'\')">Conferir agora no Mercado Pago</button>':'')+
   '</article>';
 }).join('');
 return '<section class="section admin-ads-mp-inbox">'+
  '<div class="section-head"><div><span class="section-kicker">V1.316 • EVENTOS ASSINADOS</span>'+
  '<h2>Eventos Mercado Pago para conferência</h2>'+
  '<p>Eventos recebidos com assinatura verificada e consulta direta ao provedor. A conclusão financeira requer conferência independente e autorização do administrador.</p></div></div>'+
  (inbox?'<p class="tiny muted">'+inbox.totalEvents+' evento(s) na caixa de entrada. Nenhum evento confirma pagamento ou libera anúncio automaticamente.</p>':
  '<p class="muted">A caixa de entrada não foi confirmada. Atualize a central.</p>')+
  '<div class="admin-activation-grid">'+(rows||'<p class="muted">Nenhum evento de pagamento Ads foi recebido. Confira também a configuração do webhook no Mercado Pago.</p>')+'</div>'+
  '<p class="tiny muted">O webhook requer segredo HMAC exclusivo e registro explícito do endereço no Mercado Pago. Se estiver desabilitado, nenhum evento será recebido automaticamente.</p></section>';
}


// V1.317 — latest signed-event snapshot triage, NOT a provider-live payment observation.
// Explicit risk sorting prevents refund/chargeback candidates being buried by webhooks.
function adminAdsMpTriageView(){
 if(!adminRoleCanSection('activations'))return '';
 const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
 const fresh=adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
  Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000;
 const queue=fresh?adminActivationDesk.data?.adsMpTriage:null;
 const psp=fresh?adminActivationDesk.data?.adsPsp:null;
 const labels={
  possible_reversal:'Possível estorno ou contestação — prioridade máxima',
  post_reversal_activity:'Nova aprovação após reversão — conferir',
  approval_to_verify:'Aprovação indicada — precisa reconciliação',
  check_latest_provider_state:'Situação divergente — consultar provedor',
  aligned_observation:'Estado compatível com a última observação',
  informational:'Observação informativa'
 };
 const items=(queue?.rows||[]).map(x=>{
  const merchantId=String(x.merchantId||''),paymentId=String(x.paymentId||'');
  const c=psp?.rows?.find(v=>v.merchantId===merchantId)?.checkout;
  const canReview=role==='superadmin'&&psp?.platformPspConfigured===true&&
    ['checkout_ready','payment_approved'].includes(c?.status)&&
    x.canRequestReconciliation===true&&
    /^[0-9]{5,30}$/.test(paymentId)&&/^[0-9a-f-]{36}$/i.test(merchantId);
  const emphasized=x.priority===1?'** ':'';
  return '<article class="admin-activation-card admin-mp-triage-priority-'+Number(x.priority)+'">'+
   '<div class="admin-activation-card-head"><strong>'+esc(x.merchantName||'Revenda')+
   '</strong><span class="status-pill">'+esc(x.priority===1?'Prioridade alta':
     x.priority===2?'Precisa de conferência':'Observação')+'</span></div>'+
   '<p><strong>'+esc(labels[x.triage]||'Situação para análise')+'</strong></p>'+
   '<p>Último status observado: '+esc(x.providerStatus)+' • '+
     (Number(x.amountCents)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+
     ' • ID '+esc(paymentId)+'</p>'+
   '<p class="tiny muted">Recebido: '+esc(String(x.receivedAt||'—'))+
     ' • Registro atual do checkout: '+esc(x.checkoutStatus)+
     ' • Snapshot de webhook, não é consulta ao vivo.</p>'+
   (canReview?'<button type="button" class="secondary small" onclick="adminAdsPspAction(\''+
      merchantId+'\',\'reconcile\',\''+paymentId+'\')">Consultar novamente no provedor</button>':'')+
   '</article>';
 }).join('');
 return '<section class="section admin-ads-mp-triage">'+
  '<div class="section-head"><div><span class="section-kicker">V1.317 • TRIAGEM FINANCEIRA</span>'+
  '<h2>Prioridades de conferência Mercado Pago Ads</h2>'+
  '<p>Observações assinadas e verificadas na chegada são agrupadas por pagamento e ordenadas por risco. Para qualquer alteração financeira, a consulta ao provedor deve ser refeita.</p></div></div>'+
  (queue?'<p class="tiny muted">Observações únicas: '+queue.totalUniquePaymentObservations+
    ' • Precisam de conferência: '+queue.actionableObservations+
    ' • Alta prioridade: '+queue.priorityOneObservations+'</p>':
    '<p class="muted">Não foi possível confirmar a triagem no banco. Atualize a central.</p>')+
  '<div class="admin-activation-grid">'+(items||'<p class="muted">Sem observações de pagamento Ads para priorizar. Isso não comprova ausência de transações; confira o provedor quando necessário.</p>')+
  '</div><p class="tiny muted">Nenhum evento altera o pagamento automaticamente ou publica anúncios. A ausência de alertas não garante que não existam estornos ou webhooks perdidos.</p></section>';
}


// V1.318 — ageing and reconciliation evidence, not real-time PSP status.
function adminAdsPspFreshnessView(){
 if(!adminRoleCanSection('activations'))return '';
 const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
 const fresh=adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
   Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000;
 const data=fresh?adminActivationDesk.data?.adsPspFreshness:null;
 const meanings={
  possible_reversal:'Possível estorno ou contestação após a última conferência',
  activity_after_reversal:'Nova atividade observada após o estorno',
  stale_approved_verification:'Aprovação sem conferência há mais de 24 horas',
  stalled_reservation:'Reserva de checkout parada há mais de 30 minutos',
  overdue_unconfirmed_checkout:'Demonstrativo vencido sem pagamento confirmado',
  observed_approval_not_reconciled:'Aprovação observada; conferir diretamente no provedor',
  approval_due_for_refresh:'Aprovação com mais de 6 horas desde a conferência',
  informational:'Sem alerta conhecido — não significa pagamento atual ou quitado'
 };
 const rows=(data?.rows||[]).map(x=>{
  const id=String(x.merchantId||'');
  if(!/^[0-9a-f-]{36}$/i.test(id))return '';
  const paymentId=String(x.paymentId||x.inboxPaymentId||'');
  const canCheck=role==='superadmin'&&
    adminActivationDesk.data?.adsPsp?.platformPspConfigured===true&&
    x.canRequestProviderCheck===true&&/^[0-9]{5,30}$/.test(paymentId);
  const badge=x.priority===1?'Prioridade alta':x.priority===2?'Conferir':'Informativo';
  return '<article class="admin-activation-card"><div class="admin-activation-card-head"><strong>'+
    esc(x.merchantName||'Revenda')+'</strong><span class="status-pill">'+badge+'</span></div>'+
    '<p><strong>'+esc(meanings[x.reason]||'Verificação necessária')+'</strong></p>'+
    '<p>'+esc(x.checkoutStatus)+' • '+
    (Number(x.amountCents)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+
    '</p><p class="tiny muted">Última conferência direta: '+
    esc(x.verifiedAt?formatDateTime(x.verifiedAt):'não registrada')+
    ' • Vencimento: '+esc(String(x.dueDate||'não informado'))+'</p>'+
    (x.inboxReceivedAt?'<p class="tiny muted">Última observação assinada: '+
      esc(formatDateTime(x.inboxReceivedAt))+' • '+esc(x.inboxProviderStatus||'')+
      '</p>':'')+
    (canCheck?'<button type="button" class="secondary small" onclick="adminAdsPspAction(\''+
      id+'\',\'reconcile\',\''+paymentId+'\')">Consultar novamente no Mercado Pago</button>':'')+
    '</article>';
 }).join('');
 return '<section class="section admin-ads-psp-freshness"><div class="section-head"><div>'+
  '<span class="section-kicker">V1.318 • EVIDÊNCIAS FINANCEIRAS</span>'+
  '<h2>Conferências vencidas e cobranças que exigem atenção</h2>'+
  '<p>Prioriza provas antigas, possíveis reversões, demonstrativos vencidos e reservas interrompidas.</p></div></div>'+
  (data?'<p class="tiny muted">Checkouts: '+data.totalCheckouts+
   ' • Ações sugeridas: '+data.needsReview+' • Urgentes: '+data.urgentCount+
   ' • Aprovações sem conferência há 24h: '+data.staleApprovals+
   ' • Vencidos sem confirmação: '+data.overdueUnconfirmed+
   ' • Reservas paradas: '+data.stalledReservations+'</p>':
   '<p class="muted">Não foi possível confirmar o estado das evidências financeiras.</p>')+
  '<div class="admin-activation-grid">'+(rows||'<p class="muted">Nenhum checkout consta no livro da plataforma. A ausência de alertas não comprova pagamentos ou estornos.</p>')+
  '</div><p class="tiny muted">Observações e idades são históricas, não mostram o status atual do Mercado Pago. Somente a consulta direta e autenticada do fundador atualiza a data de verificação. Não há conciliação automática nem publicação de anúncios.</p></section>';
}


// V1.319 — merchant-initiated PSP recheck requests, read-only until independent provider lookup.
function adminAdsPspMerchantReviewsView(){
 if(!adminRoleCanSection('activations'))return '';
 const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
 const fresh=adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
    Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000;
 const data=fresh?adminActivationDesk.data?.adsPspMerchantReviews:null;
 const labels={stale_approval:'Comprovação envelhecida',
  possible_reversal:'Possível estorno/contestação',refresh_due:'Revenda solicitou reconferência'};
 const rows=(data?.rows||[]).filter(r=>r.pending).map(r=>{
  const id=String(r.merchantId||'');
  if(!/^[0-9a-f-]{36}$/i.test(id))return '';
  return '<article class="admin-activation-card"><div class="admin-activation-card-head"><strong>'+
    esc(r.merchantName||'Revenda')+'</strong><span class="status-pill">Aguardando conferência</span></div>'+
    '<p>'+esc(labels[r.reason]||'Verificar')+'</p>'+
    '<p class="tiny muted">Solicitado em '+esc(r.requestedAt||'')+
    ' • Estado no livro: '+esc(r.checkoutStatus||'desconhecido')+'</p>'+
    '<p class="tiny muted">Última consulta autenticada: '+esc(r.lastVerifiedAt||'não comprovada')+'</p>'+
    (role==='superadmin'&&/^[0-9]{5,30}$/.test(String(r.paymentId||''))?
      '<button type="button" class="secondary small" onclick="adminAdsPspMerchantReviewOpen(\''+id+'\')">Abrir conferência do pagamento</button>':'')+
    '</article>';
 }).join('');
 return '<section class="section admin-ads-psp-merchant-reviews">'+
   '<div class="section-head"><div><span class="section-kicker">V1.319 • REQUISIÇÕES DAS REVENDAS</span>'+
   '<h2>Pedidos de reconferência de pagamentos</h2>'+
   '<p>Solicitações do titular que exigem rechecagem junto ao Mercado Pago. Pedir reconferência não muda a situação financeira.</p></div></div>'+
   (data?'<p class="tiny muted">'+data.pendingRequests+' solicitações pendentes • '+data.totalRequests+
    ' revenda(s) com histórico de pedido. A solicitação só é atendida quando o servidor registra consulta posterior e alteração de versão.</p>':
    '<p class="muted">Fila de reconferência indisponível ou ainda não confirmada.</p>')+
   '<div class="admin-activation-grid">'+(rows||'<p class="muted">Nenhum pedido de reconferência pendente.</p>')+
   '</div></section>';
}
function adminAdsPspMerchantReviewOpen(merchantId){
 if(adminCurrentRole()!=='superadmin')return false;
 const r=adminActivationDesk.data?.adsPspMerchantReviews?.rows?.find(x=>x.merchantId===merchantId&&x.pending);
 if(!r||!r.paymentId)return false;
 // Existing founder workflow performs fresh PSP lookup and checks seller, reference, amount and state.
 if(typeof adminAdsPspAction==='function'){
   adminAdsPspAction(merchantId,'reconcile',r.paymentId);return true;
 }
 return false;
}


// V1.320 — one founder-readable pathway from creative to verified operations.
function adminAdsLaunchReadinessView(){
 if(!adminRoleCanSection('activations'))return '';
 const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
 const current=adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
   Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000;
 const d=current?adminActivationDesk.data?.adsLaunch:null;
 if(!d)return '<section class="section admin-ads-launch-readiness"><h2>Prontidão comercial do TAMÃO Ads</h2>'+
  '<p class="muted">Diagnóstico ainda não confirmado. Atualize a Central de Ativações para conferir as etapas reais.</p></section>';
 const stages=[
  ['Criativos aprovados',d.creativesApproved,'Prepare e aprove um anúncio real da revenda'],
  ['Planos para contato',d.plansContactReady,'Defina preço, duração e plano de divulgação'],
  ['Revendas interessadas',d.merchantInterests,'Disponibilize oferta comercial e receba manifestação do titular'],
  ['Minutas revisadas',d.dossiersReviewed,'Prepare escopo e regras; o titular deve revisar'],
  ['Aceites bilaterais',d.bilateralAcceptances,'Emita o documento e registre aceite das duas partes'],
  ['Demonstrativos emitidos',d.statementsIssued,'Emita cobrança comercial somente após o aceite bilateral'],
  ['Checkouts disponíveis',d.checkoutsReady,'Habilite a conta própria Mercado Pago Ads antes de cobrar'],
  ['Aprovações observadas',d.lastKnownApprovedPayments,'Concilie cada pagamento no PSP e reconfira estornos']
 ];
 const firstPending=stages.findIndex(x=>x[1]===0);
 const cards=stages.map(([name,count,what],index)=>'<div class="admin-ads-launch-step">'+
   '<span class="tiny muted">Etapa '+(index+1)+'</span>'+
   '<strong>'+esc(name)+'</strong><span class="admin-ads-launch-count">'+Number(count)+'</span>'+
   (firstPending===index?'<p class="tiny"><strong>Próxima oportunidade:</strong> '+esc(what)+'</p>':
    '<p class="tiny muted">'+esc(what)+'</p>')+'</div>').join('');
 const p=d.platformPspConfig||{};
 const flags=[
  ['Credencial específica configurada',p.providerTokenConfigured],
  ['Conta recebedora identificada',p.providerSellerConfigured],
  ['Checkout habilitado expressamente',p.explicitlyEnabled],
  ['Pré-requisitos locais para consultar o provedor',p.canAttemptAuthenticatedLookup],
  ['Publicidade pública habilitada',d.publicEnabled],
  ['Faturamento publicitário habilitado',d.billingEnabled],
  ['Entrega publicitária verificada',d.verifiedDeliveryEnabled]
 ];
 const flagsHtml=flags.map(([name,ok])=>'<div class="admin-ads-launch-flag">'+
   '<span>'+esc(name)+'</span><strong>'+ (ok?'Configurado / habilitado':'Não configurado / desabilitado')+
   '</strong></div>').join('');
 const earliest=firstPending>=0?'Próximo foco: '+stages[firstPending][0]+'.':
   'Todas as etapas têm registros. Isso não comprova que a operação está pronta.';
 return '<section class="section admin-ads-launch-readiness">'+
  '<div class="section-head"><div><span class="section-kicker">V1.320 • PRONTIDÃO PARA O MERCADO</span>'+
  '<h2>O que falta para faturar com TAMÃO Ads?</h2>'+
  '<p>Funil comercial extraído do banco, com bloqueios operacionais reais e sem promessas de receita.</p></div></div>'+
  '<p><strong>'+esc(earliest)+'</strong></p>'+
  '<div class="admin-ads-launch-steps">'+cards+'</div>'+
  '<h3>Condições técnicas e autorizações</h3><div class="admin-ads-launch-flags">'+flagsHtml+'</div>'+
  '<p class="tiny muted">A configuração de credenciais não equivale à verificação da conta recebedora; a checagem autenticada acontece somente na operação autorizada. Nenhuma liberação é executada nesta tela.</p>'+
  '<p class="tiny muted">Aprovações exibidas são o último estado financeiro registrado, não receita liquidada. '+Number(d.staleApprovals24h)+
  ' aprovação(ões) com evidência superior a 24h e '+Number(d.reversalsRecorded)+
  ' reversão(ões) registrada(s). Receita liquidada ainda sem comprovação nesta visão.</p>'+
  '<p class="tiny muted">Fotografia do banco: '+esc(String(d.snapshotAt))+
  ' • Sem consulta ao Mercado Pago nesta ação. Para publicar Ads é necessária validação independente da entrega e autorização administrativa.</p>'+
  '</section>';
}


// TAMÃO V1.322 — opt-in commercial funnel. Read only: no outreach is inferred or sent.
function adminAdsLeadsView(){
 if(!adminRoleCanSection('activations'))return '';
 const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
 const fresh=adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
    Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000;
 const d=fresh?adminActivationDesk.data?.adsLeads:null;
 const labels={
   approved_for_planning:['Apresentação aprovada','Preparar proposta comercial individual'],
   draft_ready_to_submit:['Rascunho pronto','Orientar a revenda a enviar para revisão'],
   awaiting_review:['Aguardando análise','Conferir a fila real de criativos'],
   needs_creative_changes:['Ajustes solicitados','A revenda precisa revisar a apresentação'],
   needs_creative:['Início da divulgação','A revenda pode preparar seu primeiro rascunho'],
   catalog_not_ready:['Catálogo pendente','Revisar produtos e disponibilidade para entrega'],
   city_changed:['Cidade alterada','Revisar cidade/UF do criativo'],
   location_incomplete:['Dados incompletos','Completar cidade e UF da revenda'],
   merchant_inactive:['Cadastro inativo','Concluir habilitação antes de negociar publicidade']
 };
 const rows=(d?.rows||[]).map(x=>{
   const label=labels[x.stage]||['Verificar situação','Consultar cadastro'];
   const place=[x.city,x.state].filter(Boolean).join(' / ')||'Localidade não confirmada';
   return '<article class="admin-activation-card admin-ads-lead">'+
     '<div class="admin-activation-card-head"><strong>'+esc(x.merchantName)+
     '</strong><span class="status-pill">'+esc(label[0])+'</span></div>'+
     '<p class="tiny muted">'+esc(place)+' • '+Number(x.matchingActiveCatalogCount)+
     ' produto(s) ativos compatíveis</p>'+
     '<p><strong>Próximo passo:</strong> '+esc(label[1])+'</p>'+
     '<p class="tiny muted">Interesse registrado em '+esc(String(x.interestAt||'data não confirmada'))+
     '. Não houve contato por esta consulta.</p>'+
     '</article>';
 }).join('');
 return '<section class="section admin-ads-leads" aria-label="Revendas interessadas em publicidade">'+
   '<div class="section-head"><div><span class="section-kicker">V1.322 • AQUISIÇÃO COMERCIAL REAL</span>'+
   '<h2>Quem está pronto para começar a anunciar?</h2>'+
   '<p>Priorize revendas que demonstraram interesse em divulgação, com o próximo passo baseado no cadastro, catálogo e criativo reais.</p></div></div>'+
   (d?'<div class="admin-ads-lead-kpis">'+
     '<div><strong>'+Number(d.totalOptedIn)+'</strong><span>Revendas com interesse</span></div>'+
     '<div><strong>'+Number(d.creativeApproved)+'</strong><span>Apresentações aprovadas</span></div>'+
     '<div><strong>'+Number(d.preparingCreative)+'</strong><span>Preparando apresentação</span></div></div>':
     '<p class="muted">A consulta ao servidor ainda não foi confirmada. Atualize a Central de Ativações.</p>')+
   '<div class="admin-activation-grid">'+(rows||'<p class="muted">Ainda não há revendas com interesse em publicidade registrado. Oriente as revendas a utilizar o guia de divulgação disponível em seus painéis.</p>')+'</div>'+
   '<p class="tiny muted">Somente interesse declarado nesta funcionalidade. Não pressupõe autorização de marketing direto, não envia mensagens, não aprova anúncios nem cria receita. Exibidas até 50 revendas priorizadas; total apurado separadamente.</p></section>';
}


// V1.323 — merchant-initiated Ads assistance. Queue management never sends a message.
function adminAdsAssistanceView(){
 if(!adminRoleCanSection('activations'))return '';
 const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
 const fresh=adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
   Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000;
 const d=fresh?adminActivationDesk.data?.adsAssistance:null;
 const statusLabels={requested:'Novo pedido de atendimento',triaged:'Em triagem interna',
  closed:'Encerrado internamente',withdrawn:'Solicitação retirada'};
 const channels={whatsapp:'WhatsApp',phone:'Telefone',email:'E-mail'};
 const cards=(d?.rows||[]).map(x=>{
  const id=String(x.merchantId||'');
  const action=role==='superadmin'&&x.consentCurrent&&x.status==='requested'?'triage':
   role==='superadmin'&&['requested','triaged'].includes(x.status)?'close':null;
  return '<article class="admin-activation-card admin-ads-assistance">'+
   '<div class="admin-activation-card-head"><strong>'+esc(x.merchantName)+'</strong>'+
   '<span class="status-pill">'+esc(statusLabels[x.status])+'</span></div>'+
   '<p>Canal solicitado: <strong>'+esc(channels[x.channel])+'</strong></p>'+
   '<p>'+esc(x.note)+'</p>'+
   '<p class="tiny muted">'+(x.consentCurrent?'Interesse atual confirmado no servidor.':
     'Interesse atual não confirmado; não iniciar contato com base nesta solicitação.')+
     ' • Solicitação v'+x.version+' • '+esc(String(x.requestedAt||'—'))+'</p>'+
   (action?'<button type="button" class="secondary small" onclick="adminAdsAssistanceAction(\''+
      id+'\',\''+action+'\')">'+
       (action==='triage'?'Marcar como analisado':'Encerrar solicitação')+'</button>':'')+
   '</article>';
 }).join('');
 return '<section class="section admin-ads-assistance" aria-label="Pedidos de orientação TAMÃO Ads">'+
   '<div class="section-head"><div><span class="section-kicker">V1.323 • ATENDIMENTO SOLICITADO</span>'+
   '<h2>Revendas que pediram orientação de publicidade</h2>'+
   '<p>Uma fila de solicitações iniciadas pelas revendas, com canal preferido e motivo declarado. Nada é enviado automaticamente.</p></div></div>'+
   (d?'<p class="tiny muted">Solicitações: '+d.totalRequests+' • Abertas: '+d.openRequests+
       ' • Mensagens enviadas automaticamente: 0.</p>':
       '<p class="muted">Fila não confirmada no servidor. Atualize a Central de Ativações.</p>')+
   '<div class="admin-activation-grid">'+(cards||'<p class="muted">Nenhuma revenda solicitou atendimento comercial até esta consulta.</p>')+
   '</div><p class="tiny muted">Analisar ou encerrar altera apenas o controle interno. Não equivale a mensagem entregue nem autoriza cobrança, publicação ou contato sem consentimento atual.</p></section>';
}
async function adminAdsAssistanceAction(merchantId,operation){
 if(!adminReady()||adminCurrentRole()!=='superadmin'||adminActivationDesk.loading||
   !['triage','close'].includes(operation))return false;
 const actor=String(adminRuntime.session?.user?.id||'');
 if(adminActivationDesk.actor!==actor||adminActivationDesk.role!=='superadmin'||
   Date.now()-Date.parse(adminActivationDesk.checkedAt||'')>=120000)return false;
 const req=adminActivationDesk.data?.adsAssistance?.rows?.find(x=>x.merchantId===merchantId);
 if(!req||!Number.isSafeInteger(req.version)||
   (operation==='triage'&&(!req.consentCurrent||req.status!=='requested'))||
   (operation==='close'&&!['requested','triaged'].includes(req.status)))return false;
 const reason=String(prompt('Justificativa para esta etapa interna (12–240 caracteres):')||'').trim();
 if(reason.length<12||reason.length>240){toast('Informe uma justificativa válida.');return false;}
 if(!confirm(operation==='triage'?'Marcar solicitação como analisada? Nenhuma mensagem será enviada.':
   'Encerrar o pedido internamente? Isso não comprova atendimento ou contato.'))return false;
 try{
  const out=await adminPerform('ads-assistance-action',{
    merchantId,operation,expectedVersion:req.version,reason,requestId:crypto.randomUUID()
  });
  const status=operation==='triage'?'triaged':'closed';
  if(out?.source!=='admin_ads_assistance_action_v1_323'||out.merchantId!==merchantId||
    out.status!==status||out.version!==req.version+1||out.recorded!==true||
    out.messageSent!==false||out.contactPerformed!==false||
    out.adsLive!==false||out.paymentCreated!==false)
    throw new Error('Não foi possível confirmar a ação no servidor.');
  adminActivationDesk.data=null;
  const again=await adminActivationLoad({force:true});
  const saved=again?.adsAssistance?.rows?.find(x=>x.merchantId===merchantId);
  if(!saved||saved.status!==status||saved.version!==out.version)
    throw new Error('Ação registrada, mas leitura de confirmação ainda pendente.');
  toast('Etapa interna registrada. Nenhum contato automático foi realizado.');
  return true;
 }catch(e){
  adminActivationDesk.data=null;await adminActivationLoad({force:true});
  toast(String(e?.message||e));return false;
 }
}


// V1.324 — verified authorization for manual contact notes, NOT verified external delivery.
function adminAdsContactsView(){
 if(!adminRoleCanSection('activations'))return '';
 const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
 const fresh=adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
   Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000;
 const d=fresh?adminActivationDesk.data?.adsContacts:null;
 const outcomes={not_reached:'Não consegui falar',conversation:'Conversa relatada',
  followup_requested:'Retorno solicitado',not_interested:'Não deseja prosseguir'};
 const cards=(d?.rows||[]).filter(x=>x.consentCurrent&&['requested','triaged'].includes(x.status)).map(x=>{
  const id=String(x.merchantId||'');
  if(!/^[0-9a-f-]{36}$/i.test(id))return '';
  const last=x.lastAttempt;
  const due=last?.outcome==='followup_requested'?String(last.nextFollowupOn||''):'';
  const form=role==='superadmin'?'<div class="admin-ads-contact-form">'+
   '<label>Resultado relatado da tentativa<select class="input" id="ads-contact-'+id+'-outcome">'+
   '<option value="not_reached">Tentei, sem conseguir falar</option>'+
   '<option value="conversation">Conversei com a revenda</option>'+
   '<option value="followup_requested">Solicitou um novo contato</option>'+
   '<option value="not_interested">Informou que não deseja prosseguir</option></select></label>'+
   '<label>Nota do ocorrido (20–240 caracteres)<textarea class="input" id="ads-contact-'+id+'-note" rows="3" minlength="20" maxlength="240" placeholder="Registre somente fatos que realmente ocorreram, sem dados pessoais desnecessários"></textarea></label>'+
   '<label>Data do retorno (somente se solicitado)<input class="input" type="date" id="ads-contact-'+id+'-date"></label>'+
   '<button type="button" class="secondary small" onclick="adminAdsContactRecord(\''+id+'\')">Registrar atendimento manual</button></div>':'';
  return '<article id="ads-contact-card-'+id+'" class="admin-activation-card admin-ads-contact-card">'+
   '<div class="admin-activation-card-head"><strong>'+esc(x.merchantName||'Revenda')+
   '</strong><span class="status-pill">Consentimento atual</span></div>'+
   '<p>Canal solicitado: '+esc(({whatsapp:'WhatsApp',phone:'Telefone',email:'E-mail'})[x.preferredChannel]||'—')+
   ' • Relatos registrados: '+Number(x.attemptsCount)+'</p>'+
   (last?'<p>Último resultado informado: <strong>'+esc(outcomes[last.outcome]||'Não confirmado')+
    '</strong>'+ (due?' • Próximo retorno: '+esc(due):'')+'</p>'+
    '<p class="tiny muted">'+esc(last.note)+' • '+esc(String(last.recordedAt||''))+
    '</p>':'<p class="muted tiny">Nenhuma tentativa foi registrada. O pedido em análise não comprova contato.</p>')+
   '<p class="tiny muted">Solicitação v'+Number(x.assistanceVersion)+
   ' • Contatos são relatos do administrador; entrega não verificada independentemente.</p>'+
   form+'</article>';
 }).join('');
 return '<section class="section admin-ads-contacts">'+
  '<div class="section-head"><div><span class="section-kicker">V1.324 • ACOMPANHAMENTO HUMANO</span>'+
  '<h2>Atendimentos comerciais e retornos</h2>'+
  '<p>Registre apenas contatos realmente tentados. O próximo retorno e o consentimento atual permanecem conferidos no banco.</p></div></div>'+
  (d?'<p class="tiny muted">Relatos manuais: '+d.totalManualReports+
   ' • Retornos vencidos: '+d.followupsDue+' • Mensagens automáticas: 0.</p>':
   '<p class="muted">Consulta não confirmada; atualize a Central de Ativações.</p>')+
  '<div class="admin-activation-grid">'+(cards||'<p class="muted">Não há solicitações ativas com consentimento atual para acompanhamento.</p>')+
  '</div><p class="tiny muted">Registro administrativo declarado, sem prova independente de entrega. Nenhuma mensagem é enviada, nenhum contrato é assinado e nenhum anúncio é publicado por esta função.</p></section>';
}
async function adminAdsContactRecord(merchantId){
 if(!adminReady()||adminCurrentRole()!=='superadmin'||adminActivationDesk.loading)return false;
 const actor=String(adminRuntime.session?.user?.id||'');
 if(adminActivationDesk.actor!==actor||adminActivationDesk.role!=='superadmin'||
   Date.now()-Date.parse(adminActivationDesk.checkedAt||'')>=120000)return false;
 const item=adminActivationDesk.data?.adsContacts?.rows?.find(x=>x.merchantId===merchantId);
 if(!item||!item.consentCurrent||!['requested','triaged'].includes(item.status))return false;
 const outcome=String(document.getElementById('ads-contact-'+merchantId+'-outcome')?.value||'');
 const note=String(document.getElementById('ads-contact-'+merchantId+'-note')?.value||'').trim();
 const nextRaw=String(document.getElementById('ads-contact-'+merchantId+'-date')?.value||'').trim();
 const nextFollowupOn=nextRaw||null;
 if(!['not_reached','conversation','followup_requested','not_interested'].includes(outcome)||
   note.length<20||note.length>240||
   (outcome==='followup_requested'&&!/^\d{4}-\d{2}-\d{2}$/.test(nextFollowupOn||''))||
   (outcome!=='followup_requested'&&nextFollowupOn)){
   toast('Informe resultado, nota de 20–240 caracteres e data somente para retorno solicitado.');return false;
 }
 if(!confirm('Registrar que você realizou esta tentativa de contato MANUAL? O registro não envia mensagem nem comprova entrega.'))return false;
 try{
  const out=await adminPerform('ads-contact-report',{
   merchantId,expectedVersion:item.assistanceVersion,channel:item.preferredChannel,
   outcome,note,nextFollowupOn,requestId:crypto.randomUUID()
  });
  if(out?.source!=='admin_ads_contact_record_v1_324'||out.merchantId!==merchantId||
    out.recorded!==true||out.outcome!==outcome||
    out.assistanceVersion!==item.assistanceVersion||
    out.automatedMessageSent!==false||out.independentlyVerified!==false||
    out.adsLive!==false||out.paymentCreated!==false)
   throw new Error('Registro de contato não confirmado no servidor.');
  adminActivationDesk.data=null;
  const data=await adminActivationLoad({force:true});
  const updated=data?.adsContacts?.rows?.find(x=>x.merchantId===merchantId);
  if(!updated||updated.attemptsCount<=item.attemptsCount||
     updated.lastAttempt?.outcome!==outcome)
   throw new Error('Registro efetuado, mas leitura posterior ainda não confirmada.');
  toast('Tentativa manual registrada, sem mensagem automática.');
  return true;
 }catch(e){
  adminActivationDesk.data=null;await adminActivationLoad({force:true});
  toast(String(e?.message||e));return false;
 }
}


// V1.325 — merchant-declared experience; never inferred as provider delivery evidence.
function adminAdsFeedbackView(){
 if(!adminRoleCanSection('activations'))return '';
 const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
 const fresh=adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
   Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000;
 const d=fresh?adminActivationDesk.data?.adsFeedback:null;
 const labels={contact_confirmed:'Revenda informa que recebeu contato',
  contact_not_received:'Revenda informa que não recebeu contato',
  followup_needed:'Revenda solicita novo retorno'};
 const rows=(d?.rows||[]).filter(x=>x.lastContact&&x.currentConsent).map(x=>{
  const c=x.lastContact,f=c.merchantFeedback;
  return '<article class="admin-activation-card"><div class="admin-activation-card-head"><strong>'+
   esc(x.merchantName||'Revenda')+'</strong><span class="status-pill">'+
   esc(f?(labels[f.response]||'Resposta registrada'):'Aguardando avaliação da revenda')+
   '</span></div><p class="tiny muted">Último contato declarado pela administração: '+
   esc(c.reportedOutcome)+' • '+esc(String(c.reportedAt||''))+'</p>'+
   (f?'<p class="tiny muted">Resposta voluntária da revenda: '+esc(String(f.submittedAt||''))+
    '. Não constitui comprovante de entrega do canal.</p>':
    '<p class="tiny muted">A revenda ainda não confirmou sua experiência. Não presumir que a mensagem foi entregue.</p>')+
   '</article>';
 }).join('');
 return '<section class="section admin-ads-feedback"><div class="section-head"><div>'+
  '<span class="section-kicker">V1.325 • QUALIDADE DO ATENDIMENTO</span>'+
  '<h2>Avaliações do contato pelas revendas</h2>'+
  '<p>Confira quando a revenda relata que foi atendida, não recebeu contato ou precisa de novo retorno.</p></div></div>'+
  (d?'<p class="tiny muted">Respostas voluntárias registradas: '+d.totalMerchantFeedback+
    ' • Últimos contatos sem retorno da revenda: '+d.awaitingMerchantFeedback+
    ' • Mensagens enviadas pelo sistema: 0.</p>':
    '<p class="muted">Não foi possível confirmar o acompanhamento. Atualize a central.</p>')+
  '<div class="admin-activation-grid">'+(rows||'<p class="muted">Ainda não há contatos consentidos elegíveis para confirmação pela revenda.</p>')+
  '</div><p class="tiny muted">Respostas são declarações do titular autenticado, não confirmação técnica de entrega ou leitura pelo WhatsApp, e-mail ou telefone. Não alteram cobranças nem publicam anúncios.</p></section>';
}


// V1.326 — manual return planning from negative owner feedback; no outbound communications.
function adminAdsFeedbackReturnsView(){
 if(!adminRoleCanSection('activations'))return '';
 const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
 const fresh=adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
  Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000;
 const d=fresh?adminActivationDesk.data?.adsFeedbackReturns:null;
 const rows=(d?.rows||[]).filter(x=>x.consentCurrent).map(x=>{
  const id=String(x.merchantId||''),c=String(x.contactRequestId||''),p=x.returnPlan;
  if(!/^[0-9a-f-]{36}$/i.test(id)||!/^[0-9a-f-]{36}$/i.test(c))return '';
  const form=role==='superadmin'?
    '<div class="admin-ads-return-fields"><label>Data prevista de retorno<input type="date" id="ads-return-'+id+'-date" value="'+
      esc(String(p?.dueOn||''))+'"></label>'+
    '<label>Nota interna factual (não visível à revenda)<textarea id="ads-return-'+id+'-note" maxlength="240" rows="3">'+
      esc(String(p?.internalNote||''))+'</textarea></label>'+
    '<div class="order-actions"><button type="button" class="primary small" onclick="adminAdsFeedbackReturnAction(\''+id+'\',\'schedule\')">'+
      (p?.status==='scheduled'?'Reagendar retorno':'Planejar retorno')+'</button>'+
      (p?.status==='scheduled'?'<button type="button" class="secondary small" onclick="adminAdsFeedbackReturnAction(\''+id+'\',\'cancel\')">Cancelar previsão</button>':'')+
    '</div></div>':'';
  return '<article class="admin-activation-card"><div class="admin-activation-card-head"><strong>'+
    esc(x.merchantName||'Revenda')+'</strong><span class="status-pill">'+
    esc(p?.status==='scheduled'?'Retorno previsto':p?.status==='canceled'?'Previsão cancelada':'Sem retorno planejado')+
    '</span></div><p class="tiny muted">Revenda informou: '+
    esc(x.feedbackResponse==='contact_not_received'?'Não recebi o contato':'Preciso de novo retorno')+
    ' • avaliação de '+esc(String(x.feedbackAt||''))+'</p>'+
    (p?'<p class="tiny muted">Data prevista: '+esc(String(p.dueOn||''))+
     ' • revisão '+Number(p.version)+'</p>':'')+
    form+'</article>';
 }).join('');
 return '<section class="section admin-ads-feedback-returns"><div class="section-head"><div>'+
  '<span class="section-kicker">V1.326 • RECUPERAÇÃO DO ATENDIMENTO</span>'+
  '<h2>Retornos solicitados pelas revendas</h2>'+
  '<p>Organize manualmente uma nova tentativa quando o titular informa que não recebeu o contato ou pede retorno.</p></div></div>'+
  (d?'<p class="tiny muted">Planos históricos: '+d.totalPlans+
    ' • Retornos vencidos com consentimento atual: '+d.followupsDue+
    ' • Contatos enviados automaticamente: 0.</p>':
    '<p class="muted">Planejamento não confirmado. Atualize a central.</p>')+
  '<div class="admin-activation-grid">'+(rows||'<p class="muted">Não há avaliações negativas com consentimento atual que precisem de planejamento.</p>')+
  '</div><p class="tiny muted">Agendar é uma previsão administrativa, não contato realizado, entrega de mensagem ou promessa de atendimento automático. Registre tentativas efetivas no histórico comercial.</p></section>';
}
async function adminAdsFeedbackReturnAction(merchantId,operation){
 if(!adminReady()||adminCurrentRole()!=='superadmin'||adminActivationDesk.loading||
   !['schedule','cancel'].includes(operation))return false;
 const actor=String(adminRuntime.session?.user?.id||'');
 if(adminActivationDesk.actor!==actor||adminActivationDesk.role!=='superadmin'||
   Date.now()-Date.parse(adminActivationDesk.checkedAt||'')>=120000)return false;
 const entry=adminActivationDesk.data?.adsFeedbackReturns?.rows?.find(x=>x.merchantId===merchantId);
 if(!entry||entry.consentCurrent!==true||!['contact_not_received','followup_needed'].includes(entry.feedbackResponse)||
   (operation==='cancel'&&entry.returnPlan?.status!=='scheduled'))return false;
 const dateValue=operation==='schedule'?String(document.getElementById('ads-return-'+merchantId+'-date')?.value||''):null;
 const note=String(document.getElementById('ads-return-'+merchantId+'-note')?.value||'').trim();
 if(note.length<20||note.length>240||(operation==='schedule'&&!/^\d{4}-\d{2}-\d{2}$/.test(dateValue))){
  toast('Informe uma data válida e nota factual de 20 a 240 caracteres.');return false;
 }
 if(!confirm(operation==='schedule'?'Registrar data PREVISTA para uma nova tentativa manual, sem enviar mensagem?':
   'Cancelar somente a previsão de retorno, sem alterar contatos reais registrados?'))return false;
 try{
  const out=await adminPerform('ads-feedback-return-action',{
   merchantId,contactRequestId:entry.contactRequestId,assistanceVersion:entry.assistanceVersion,
   operation,expectedVersion:entry.returnPlan?.version||0,
   dueOn:dateValue,note,requestId:crypto.randomUUID()
  });
  const status=operation==='schedule'?'scheduled':'canceled';
  if(out?.source!=='admin_ads_feedback_return_action_v1_326'||out.merchantId!==merchantId||
   out.contactRequestId!==entry.contactRequestId||out.status!==status||
   !Number.isSafeInteger(out.version)||out.version<1||out.recorded!==true||
   out.messageSent!==false||out.contactPerformed!==false||out.deliveryProven!==false||
   out.adsLive!==false||out.paymentCreated!==false)
    throw new Error('Registro de retorno não confirmado.');
  adminActivationDesk.data=null;
  const verified=await adminActivationLoad({force:true});
  const current=verified?.adsFeedbackReturns?.rows?.find(x=>x.merchantId===merchantId)?.returnPlan;
  if(!current||current.status!==status||current.version!==out.version)
   throw new Error('A previsão foi registrada, mas a leitura posterior ainda não confirmou.');
  toast('Planejamento manual atualizado, sem envio de mensagens.');
  return true;
 }catch(e){
  adminActivationDesk.data=null;await adminActivationLoad({force:true});
  toast(String(e?.message||e));return false;
 }
}


// V1.327 — due queues and founder-reported follow-up attempt evidence.
// New outreach is recorded only via the existing V1.324 action; no automated contact.
function adminAdsReturnExecutionView(){
 if(!adminRoleCanSection('activations'))return '';
 const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
 const fresh=adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
   Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000;
 const data=fresh?adminActivationDesk.data?.adsReturnExecution:null;
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
 const eligible=(data?.rows||[]).filter(r=>r.consentCurrent===true);
 const active=eligible.filter(r=>r.status==='scheduled');
 const history=eligible.filter(r=>r.status==='attempt_recorded');
 const cards=[...active,...history,...eligible.filter(r=>r.status==='canceled')].map(r=>{
  const id=String(r.merchantId||'');
  if(!/^[0-9a-f-]{36}$/i.test(id))return '';
  const overdue=r.status==='scheduled'&&String(r.dueOn||'')<=today;
  const state=r.status==='attempt_recorded'?'Nova tentativa declarada':
   r.status==='scheduled'?(overdue?'Retorno vencido':'Retorno planejado'):'Previsão cancelada';
  const recordButton=role==='superadmin'&&r.status==='scheduled'?
   '<button type="button" class="secondary small" onclick="adminAdsReturnGoToContact(\''+
   id+'\')">Registrar tentativa que realmente ocorreu</button>':'';
  return '<article class="admin-activation-card">'+
    '<div class="admin-activation-card-head"><strong>'+esc(r.merchantName||'Revenda')+
    '</strong><span class="status-pill">'+esc(state)+'</span></div>'+
    '<p>Previsão: '+esc(String(r.dueOn||'—'))+
    ' • plano v'+Number(r.version)+'</p>'+
    (r.status==='attempt_recorded'?'<p>Nova tentativa informada pela administração: <strong>'+
     esc(({not_reached:'Não conseguiu contato',conversation:'Conversa relatada',
       followup_requested:'Novo retorno solicitado',not_interested:'Sem interesse'}[r.attemptOutcome]||'Registro'))+
     '</strong> • '+esc(String(r.attemptReportedAt||''))+'</p>':'')+
    '<p class="tiny muted">Nenhuma confirmação independente de entrega. '+
      'Ação não realiza contato automaticamente.</p>'+
    recordButton+'</article>';
 }).join('');
 return '<section class="section admin-ads-return-execution">'+
  '<div class="section-head"><div><span class="section-kicker">V1.327 • RETORNOS COM RASTREABILIDADE</span>'+
  '<h2>Retornos vencidos e tentativas registradas</h2>'+
  '<p>Veja o que exige uma nova tentativa manual e o que foi declarado depois do agendamento.</p></div></div>'+
  (data?'<p class="tiny muted">Previsões ativas: '+data.scheduledPlans+
    ' • Vencidas com consentimento atual: '+data.followupsDue+
    ' • Tentativas posteriores declaradas: '+data.attemptsDeclared+
    ' • Mensagens automáticas: 0.</p>':
    '<p class="muted">Histórico não confirmado. Atualize a central.</p>')+
  '<div class="admin-activation-grid">'+
    (cards||'<p class="muted">Sem retornos com consentimento atual para exibir.</p>')+
  '</div><p class="tiny muted">A tentativa é vinculada ao novo relato do administrador no banco, mas não substitui a confirmação voluntária da revenda. Mudança ou retirada de consentimento oculta a ação no fluxo atual.</p></section>';
}
function adminAdsReturnGoToContact(merchantId){
 if(!adminReady()||adminCurrentRole()!=='superadmin'||
   !/^[0-9a-f-]{36}$/i.test(String(merchantId||'')))return false;
 const item=adminActivationDesk.data?.adsReturnExecution?.rows?.find(x=>x.merchantId===merchantId&&
   x.status==='scheduled'&&x.consentCurrent===true);
 const current=adminActivationDesk.data?.adsContacts?.rows?.find(x=>x.merchantId===merchantId&&
   x.consentCurrent===true&&['requested','triaged'].includes(x.status));
 if(!item||!current||item.assistanceVersion!==current.assistanceVersion){
  toast('Atualize o acompanhamento. A solicitação ou o consentimento mudou.');return false;
 }
 const target=document.getElementById('ads-contact-card-'+merchantId);
 if(!target){toast('O formulário deste contato não está disponível nesta consulta.');return false;}
 target.scrollIntoView({behavior:'smooth',block:'center'});
 target.querySelector('select')?.focus();
 return true;
}
