// TAMÃO V1.884 — self-service independent advertisers, private admin moderation.
// This module is only loaded in the protected Admin acquisition workspace.
let adminIndependentAdsState={loadedFor:null,rows:[],deliveryEnabled:false,
 fixedFeeSalesEnabled:false,fixedFeeSalesVersion:0,providerApprovedGrossCents:0,
 homologationCampaignId:null,homologationExpiresAt:null,
 refundCases:null};
let adminIndependentAdsBusy=false;
let adminIndependentAdsProviderPreflight=null;
async function adminIndependentAdsRefresh(){
 const actor=String(adminRuntime?.session?.user?.id||'');
 if(!actor||adminIndependentAdsBusy)return;
 adminIndependentAdsBusy=true;
 try{
  const r=await adminInvoke({action:'ads-independent-read'});
  if(r?.source!=='admin_ads_independent_read_v1_884'||r?.billingEnabled!==false||
    r?.revenueCents!==0||r?.independentlyAuditedImpressions!==0||
    !Array.isArray(r.rows)||r.rows.length>50)
   throw Error('Estado do Ads independente não confirmado.');
  if(actor!==String(adminRuntime?.session?.user?.id||''))return;
  let refundCases=null;
  try{
   const rf=await adminInvoke({action:'ads-independent-refunds-read'});
   if(rf?.source!=='admin_ads_independent_refunds_read_v1_887'||
     rf?.refundMoneyMoved!==false||!Array.isArray(rf.rows)||rf.rows.length>50)
      throw Error('Fila de reembolsos sem confirmação.');
   refundCases=rf.rows;
  }catch{refundCases=null}
  adminIndependentAdsState={loadedFor:actor,rows:r.rows,deliveryEnabled:r.deliveryEnabled===true,
    refundCases,
    fixedFeeSalesEnabled:r.fixedFeeSalesEnabled===true,
    fixedFeeSalesVersion:Number(r.fixedFeeSalesVersion)||0,
    homologationCampaignId:String(r.homologationCampaignId||'')||null,
    homologationExpiresAt:String(r.homologationExpiresAt||'')||null,
    providerApprovedGrossCents:Number(r.providerApprovedGrossCents)||0};
  render();
 }catch(e){toast(String(e?.message||'Erro ao consultar Ads independente.'))}
 finally{adminIndependentAdsBusy=false}
}
// A checked option is mandatory: a form render or refresh cannot authorize any action.
function adminIndependentAdsMarked(group){
 const input=document.querySelector('input[name="'+group+'"]:checked');
 return input&&typeof input.value==='string'?input:null;
}
function adminIndependentAdsChooseCampaign(campaignId,version){
 if(!/^[0-9a-f-]{36}$/i.test(String(campaignId||'')))return;
 const chosen=adminIndependentAdsMarked('independent-ads-choice-'+campaignId);
 if(!chosen)return toast('Marque primeiro o que deseja fazer com a campanha.');
 return adminIndependentAdsAction(String(chosen.value||''),campaignId,version);
}
function adminIndependentAdsChooseRefund(caseId,version){
 if(!/^[0-9a-f-]{36}$/i.test(String(caseId||'')))return;
 const chosen=adminIndependentAdsMarked('ads-refund-admin-choice-'+caseId);
 if(!chosen)return toast('Marque primeiro o que deseja fazer com o reembolso.');
 const operation=String(chosen.value||'');
 if(['review','record_provider_reversal'].includes(operation))
  return adminIndependentRefundAction(operation,caseId,version);
 if(['verify','execute'].includes(operation))
  return adminIndependentRefundProvider(operation,caseId,version);
 return toast('Ação não reconhecida.');
}
function adminIndependentAdsRefundChoiceChanged(caseId){
 const selected=adminIndependentAdsMarked('ads-refund-admin-choice-'+caseId);
 const box=document.getElementById('ads-refund-acknowledgements-'+caseId);
 if(!box)return;
 box.hidden=selected?.value!=='execute';
 if(box.hidden){
  for(const prefix of ['ads-refund-check-payment-','ads-refund-check-send-']){
   const input=document.getElementById(prefix+caseId);
   if(input)input.checked=false;
  }
 }
}
async function adminIndependentAdsAction(decision,campaignId='',version=0){
 const actor=String(adminRuntime?.session?.user?.id||'');
 if(!actor||adminCurrentRole()!=='superadmin'||adminIndependentAdsBusy)return;
 const control=decision==='enable_delivery'||decision==='disable_delivery';
 const field=document.getElementById(control?'independent-ads-control-reason':'independent-ads-reason-'+campaignId);
 const selected=adminIndependentAdsMarked(control?'independent-ads-control-preset':
  'independent-ads-choice-'+campaignId);
 if(!selected)return toast('Marque uma opção antes de confirmar.');
 if(!control&&String(selected.value)!==decision)
  return toast('A ação marcada mudou. Confira antes de confirmar.');
 const predefined={
  approve:'Criativo revisado e aprovado pelo administrador.',
  reject:'Criativo incompleto ou incompatível com as regras da publicação.',
  publish:'Campanha e pagamento revisados para autorização de publicação.',
  pause:'Publicação pausada para revisão operacional do anunciante.',
  resume:'Campanha revisada e autorizada para retomar o prazo restante.',
  end:'Campanha encerrada mediante decisão administrativa documentada.'
 };
 const manual=String(field?.value||'').trim();
 const reason=manual||(control?String(selected.value||''):predefined[decision]||'');
 if(reason.length<12||reason.length>500)
  return toast('Selecione uma opção ou escreva uma justificativa com 12 a 500 caracteres.');
 const current=adminIndependentAdsState;
 if(current.loadedFor!==actor)return toast('Atualize a lista antes de decidir.');
 const row=current.rows.find(x=>x.id===campaignId);
 if(!control&&(!row||Number(row.version)!==version))return toast('A campanha mudou. Atualize antes de decidir.');
 adminIndependentAdsBusy=true;
 try{
  const r=await adminPerform('ads-independent-action',{
   decision,campaignId:control?'':campaignId,expectedVersion:control?null:version,reason
  });
  if(r?.source!=='admin_ads_independent_action_v1_884'||
     r?.billingEnabled!==false||r?.paymentCreated!==false)
    throw Error('A decisão não foi confirmada pelo servidor.');
  toast(control?'Estado de entrega atualizado sem habilitar cobrança.':'Análise da campanha registrada.');
 }catch(e){toast(String(e?.message||'Falha ao decidir.'))}
 finally{adminIndependentAdsBusy=false}
 await adminIndependentAdsRefresh();
}
async function adminIndependentAdsCheckProvider(){
 const actor=String(adminRuntime?.session?.user?.id||'');
 if(!actor||adminCurrentRole()!=='superadmin'||adminIndependentAdsBusy)return;
 adminIndependentAdsBusy=true;
 try{
  const data=await adminInvoke({action:'ads-independent-psp-preflight'});
  if(data?.source!=='ads_independent_psp_preflight_v1_890'||
    data?.readOnly!==true||data?.paymentsCreated!==0||
    typeof data?.sellerVerified!=='boolean'||
    typeof data?.readyForFinancialHomologation!=='boolean'||
    typeof data?.historicalSignedOrderWebhookVerified!=='boolean'||
    data?.historicalProofEqualsAdsPaymentWebhook!==false||
    data?.historicalProofEqualsAdsSeller!==false||
    data?.adsPaymentWebhookVerified!==false||
    !Number.isSafeInteger(data?.adsApprovedPaymentEventCount)||
    !Number.isSafeInteger(data?.adsReversalEventCount)||
    data.adsApprovedPaymentEventCount<0||data.adsReversalEventCount<0)
   throw Error('A checagem financeira não foi confirmada.');
  if(actor!==String(adminRuntime?.session?.user?.id||''))return;
  adminIndependentAdsProviderPreflight={actor,data};
  toast(data.readyForFinancialHomologation?
   'A configuração de recebimento está apta para homologação financeira.':'A configuração de pagamento exige revisão.');
 }catch(e){
  adminIndependentAdsProviderPreflight=null;
  toast(String(e?.message||'Não foi possível conferir o gateway.'));
 }finally{
  adminIndependentAdsBusy=false;
  render();
 }
}
async function adminIndependentAdsHomologationAction(enabled){
 const actor=String(adminRuntime?.session?.user?.id||'');
 if(!actor||adminCurrentRole()!=='superadmin'||adminIndependentAdsBusy)return;
 const state=adminIndependentAdsState;
 if(state.loadedFor!==actor||!Number.isSafeInteger(state.fixedFeeSalesVersion)||
    state.fixedFeeSalesVersion<1)return toast('Atualize as campanhas antes de decidir.');
 const campaignId=enabled?String(document.getElementById('ads-homologation-campaign')?.value||''):'';
 const marked=adminIndependentAdsMarked('ads-homologation-preset');
 if(!marked)return toast('Marque a justificativa para a homologação.');
 const reason=String(document.getElementById('ads-homologation-reason')?.value||'').trim()||
   String(marked.value||'').trim();
 const verified=document.getElementById('ads-homologation-check-verify')?.checked===true;
 const intentional=document.getElementById('ads-homologation-check-confirm')?.checked===true;
 if(reason.length<12||reason.length>500)return toast('A justificativa deve conter de 12 a 500 caracteres.');
 if(!verified||!intentional)
  return toast('Marque as duas confirmações antes de autorizar ou revogar.');
 // A human checked both attestations. The server still validates the exact
 // confirmation, expected version, ownership, and financial eligibility.
 const confirmation=enabled?'HOMOLOGAR':'CANCELAR';
 if(enabled&&!state.rows.some(c=>c.id===campaignId&&c.status==='approved'&&
     c.budgetCents===1990&&c.durationDays===7))
  return toast('Escolha uma campanha aprovada de R$ 19,90 por 7 dias.');
 adminIndependentAdsBusy=true;
 try{
  const r=await adminPerform('ads-independent-homologation-action',{
   enabled,campaignId,expectedVersion:state.fixedFeeSalesVersion,reason,confirmation
  });
  if(r?.source!=='admin_ads_independent_homologation_v1_892'||
     r?.salesEnabled!==false||r?.billingEnabled!==false||
     r?.newChargesCreated!==false||r?.homologationAuthorized!==enabled)
   throw Error('A autorização não foi confirmada no servidor.');
  toast(enabled?'Uma campanha foi autorizada para teste de pagamento REAL.':
   'Autorização revogada. Links já emitidos exigem conciliação.');
 }catch(e){toast(String(e?.message||'Não foi possível alterar a homologação.'))}
 finally{adminIndependentAdsBusy=false}
 await adminIndependentAdsRefresh();
}
async function adminIndependentAdsSalesAction(){
 const actor=String(adminRuntime?.session?.user?.id||'');
 if(!actor||adminCurrentRole()!=='superadmin'||adminIndependentAdsBusy)return;
 const state=adminIndependentAdsState;
 if(state.loadedFor!==actor||!Number.isSafeInteger(state.fixedFeeSalesVersion)||
   state.fixedFeeSalesVersion<1)return toast('Atualize a situação das campanhas primeiro.');
 const marked=adminIndependentAdsMarked('independent-ads-sales-preset');
 if(!marked)return toast('Marque a justificativa de novas vendas.');
 const reason=String(document.getElementById('independent-ads-sales-reason')?.value||'').trim()||
   String(marked.value||'').trim();
 if(reason.length<12||reason.length>500)return toast('Informe uma justificativa de 12 a 500 caracteres.');
 adminIndependentAdsBusy=true;
 try{
  const enable=!state.fixedFeeSalesEnabled;
  const r=await adminPerform('ads-independent-sales-action',{
   enabled:enable,expectedVersion:state.fixedFeeSalesVersion,reason
  });
  if(r?.source!=='admin_ads_independent_sales_toggle_v1_886'||
    r?.salesEnabled!==enable||r?.newChargesCreated!==false)
   throw Error('Estado comercial não confirmado.');
  toast(enable?'Contratação por valor fixo habilitada.':'Novas contratações interrompidas.');
 }catch(e){toast(String(e?.message||'Não foi possível alterar as vendas.'))}
 finally{adminIndependentAdsBusy=false}
 await adminIndependentAdsRefresh();
}
async function adminIndependentRefundAction(operation,caseId,version){
 if(adminIndependentAdsBusy||adminCurrentRole()!=='superadmin')return;
 const manual=String(document.getElementById('ads-refund-admin-reason-'+caseId)?.value||'').trim();
 const marked=adminIndependentAdsMarked('ads-refund-admin-choice-'+caseId);
 if(!marked||marked.value!==operation)
  return toast('Marque a ação correspondente antes de confirmar.');
 const reason=manual||String(marked.dataset?.reason||'').trim();
 if(reason.length<12||reason.length>500)return toast('Selecione uma justificativa ou escreva uma com 12 a 500 caracteres.');
 if(!['review','record_provider_reversal'].includes(operation)||!/^[0-9a-f-]{36}$/i.test(caseId))
  return toast('Solicitação inválida.');
 const row=adminIndependentAdsState.refundCases?.find(r=>r.caseId===caseId);
 if(!row||Number(row.version)!==version)return toast('A solicitação mudou. Atualize primeiro.');
 adminIndependentAdsBusy=true;
 try{
  const r=await adminPerform('ads-independent-refunds-action',{
   caseId,operation,expectedVersion:version,reason
  });
  if(r?.source!=='admin_ads_independent_refund_action_v1_887'||
    r?.moneyMoved!==false||r?.caseId!==caseId)
   throw Error('O servidor não confirmou a revisão.');
  toast(operation==='review'?'Revisão registrada.':'Reversão registrada pelo provedor, sem confirmar crédito bancário.');
 }catch(e){toast(String(e?.message||'Falha ao revisar pedido.'))}
 finally{adminIndependentAdsBusy=false}
 await adminIndependentAdsRefresh();
}
async function adminIndependentRefundProvider(operation,caseId,version){
 if(adminIndependentAdsBusy||adminCurrentRole()!=='superadmin')return;
 const actor=String(adminRuntime?.session?.user?.id||'');
 const row=adminIndependentAdsState.loadedFor===actor?
   adminIndependentAdsState.refundCases?.find(r=>r.caseId===caseId):null;
 if(!row||row.status!=='reviewing'||Number(row.version)!==version||
   row.providerReversalRecorded===true)
  return toast('Atualize o protocolo antes de usar o provedor.');
 if(!['execute','verify'].includes(operation))return;
 if(operation==='execute'&&row.refundProviderAttempt)
  return toast('Já existe solicitação ao provedor. Utilize apenas Verificar.');
 const manual=String(document.getElementById('ads-refund-admin-reason-'+caseId)?.value||'').trim();
 const marked=adminIndependentAdsMarked('ads-refund-admin-choice-'+caseId);
 if(!marked||marked.value!==operation)
  return toast('Marque a ação correspondente antes de confirmar.');
 const reason=manual||String(marked.dataset?.reason||'').trim();
 if(reason.length<12||reason.length>500)return toast('Informe justificativa com 12 a 500 caracteres.');
 if(operation==='execute'&&
   !(document.getElementById('ads-refund-check-payment-'+caseId)?.checked===true&&
     document.getElementById('ads-refund-check-send-'+caseId)?.checked===true))
  return toast('Marque as duas verificações antes de solicitar a devolução integral.');
 // The confirmation is emitted only after two deliberate checked acknowledgements.
 const confirmation=operation==='execute'?'DEVOLVER':'';
 adminIndependentAdsBusy=true;
 try{
  const r=await adminPerform('ads-independent-refund-provider',{
    operation,caseId,expectedVersion:version,reason,confirmation:operation==='execute'?confirmation:''
  });
  if(r?.source!=='admin_ads_independent_refund_provider_v1_888')
   throw Error('O provedor não confirmou a operação.');
  if(r.providerRefundVerified===true&&r.caseStatus==='provider_reversed')
   toast('Mercado Pago confirmou a reversão. Protocolo registrado; crédito bancário não é presumido.');
  else if(r.reviewRequired===true)
   toast(String(r.message||'Reembolso em análise. Verifique no provedor sem repetir o envio.'));
  else throw Error('O retorno não confirma a devolução.');
 }catch(e){toast(String(e?.message||'Não foi possível conferir a devolução.'))}
 finally{adminIndependentAdsBusy=false}
 await adminIndependentAdsRefresh();
}
// Pure UI navigation. A pane switch never opens a payment or changes campaign state.
function adminIndependentAdsOpenPane(pane){
 if(!['campaigns','finance','refunds'].includes(pane)||
   !adminReady()||adminRuntime.section!=='ads'||adminAdsWorkspaceTab!=='campaigns'||
   !['superadmin','operations','compliance','finance'].includes(adminCurrentRole()))return;
 adminIndependentAdsPane=pane;
 render();
}
function adminAdsIndependentSection(){
 const role=String(adminCurrentRole());
 if(!['superadmin','operations','compliance','finance'].includes(role))return '';
 const actor=String(adminRuntime?.session?.user?.id||'');
 const v=adminIndependentAdsState.loadedFor===actor?adminIndependentAdsState:null;
 const canAct=role==='superadmin';
 const delivery=v?.deliveryEnabled===true;
 const sales=v?.fixedFeeSalesEnabled===true;
 const provider=adminIndependentAdsProviderPreflight?.actor===actor?
   adminIndependentAdsProviderPreflight.data:null;
 const testExpires=Date.parse(String(v?.homologationExpiresAt||''));
 const testActive=Boolean(v?.homologationCampaignId&&Number.isFinite(testExpires)&&
   testExpires>Date.now());
 const eligibleTestCampaigns=v?.rows?.filter(c=>c.status==='approved'&&
   c.budgetCents===1990&&c.durationDays===7&&!c.fixedFeeStatus)||[];
 const pane=['campaigns','finance','refunds'].includes(adminIndependentAdsPane)?
  adminIndependentAdsPane:'campaigns';
 const reviewCount=v?.rows?.filter(c=>c.status==='submitted').length||0;
 const refundCount=v?.refundCases?.filter(c=>!['provider_reversed','rejected','closed'].includes(String(c.status))).length||0;
 const adsPane=(id,label,count)=>'<button type="button" class="secondary small '+
   (pane===id?'active':'')+'" aria-pressed="'+(pane===id)+'"'+
   ' onclick="adminIndependentAdsOpenPane(\''+id+'\')">'+label+
   (count?' ('+count+')':'')+'</button>';
 const actions=c=>{
  if(!canAct)return '';
  const status=String(c.status||''),version=Number(c.version)||0;
  const endsAt=Date.parse(String(c.runEndsAt||''));
  const expired=Number.isFinite(endsAt)&&endsAt<=Date.now();
  const id=String(c.id||'');
  // Only actions allowed by the current payment/delivery state are offered.
  const choices=status==='submitted'?
    [['approve','Aprovar criativo'],['reject','Rejeitar criativo']]:
    status==='approved'&&delivery&&
      ((!sales&&!c.fixedFeeStatus)||c.fixedFeeStatus==='payment_approved')?
      [['publish','Iniciar publicação']]:
    status==='active'?(expired?[['end','Encerrar campanha expirada']]:
      [['pause','Pausar publicação'],['end','Encerrar definitivamente']]):
    status==='paused'?([...(delivery&&!expired?[['resume','Retomar publicação']]:[]),
      ['end','Encerrar definitivamente']]):[];
  if(!choices.length)return '';
  return '<fieldset class="card flat"><legend>O que deseja fazer com esta campanha?</legend>'+
   choices.map(([decision,label])=>
     '<label class="admin-option-row"><input type="radio" name="independent-ads-choice-'+id+
     '" value="'+decision+'" '+(adminIndependentAdsBusy?'disabled':'')+'> '+label+'</label>').join('')+
   '</fieldset>'+
   '<details><summary>Adicionar uma justificativa personalizada (opcional)</summary>'+
    '<label for="independent-ads-reason-'+id+'">Outro motivo</label>'+
    '<textarea id="independent-ads-reason-'+id+'" rows="2" class="input" maxlength="500" '+
     'placeholder="Use somente em situações especiais"></textarea></details>'+
   '<button type="button" class="secondary small" onclick="adminIndependentAdsChooseCampaign(\''+
    id+'\','+version+')" '+(adminIndependentAdsBusy?'disabled':'')+
    '>Confirmar decisão marcada</button>';
 };
 const refundRows=pane==='refunds'?v?.refundCases?.map(c=>{
   const id=String(c.caseId||'');
   if(!/^[0-9a-f-]{36}$/i.test(id))return '';
   const review=canAct&&c.status==='submitted';
   const close=canAct&&c.providerReversalRecorded===true&&
     ['submitted','reviewing'].includes(String(c.status||''));
   const canExecute=canAct&&c.status==='reviewing'&&
     !c.refundProviderAttempt&&c.providerReversalRecorded!==true;
   const canVerify=canAct&&c.status==='reviewing'&&c.providerReversalRecorded!==true;
   const choices=[
    ...(review?[['review','Iniciar revisão','Protocolo aberto para análise de elegibilidade e pagamento.']]:[]),
    ...(close?[['record_provider_reversal','Registrar reversão verificada','Reversão confirmada no provedor e conferida para registro do protocolo.']]:[]),
    ...(canVerify?[['verify','Consultar devolução no provedor','Consulta de acompanhamento ao provedor, sem repetir solicitação de devolução.']]:[]),
    ...(canExecute?[['execute','Solicitar devolução integral','Devolução integral solicitada após conferência do pagamento, recebedor e caso.']]:[])
   ];
   const options=choices.map(([operation,label,reason])=>
    '<label class="admin-option-row"><input type="radio" name="ads-refund-admin-choice-'+id+
    '" value="'+operation+'" data-reason="'+esc(reason)+
    '" onchange="adminIndependentAdsRefundChoiceChanged(\''+id+'\')"> '+label+'</label>').join('');
   return '<article class="card flat"><strong>'+esc(String(c.advertiser||''))+
     ' · '+esc(String(c.title||''))+'</strong>'+
     '<p>Solicitação: '+esc(String(c.status||''))+
     ' · Valor original: '+adminMoney(Number(c.amountCents||0))+'</p>'+
     '<p>Motivo: '+esc(String(c.reason||''))+'</p>'+
     '<p>Provedor confirma reversão: '+(c.providerReversalRecorded===true?'Sim':'Não')+'</p>'+
     '<p>Envio pelo Admin: '+esc(String(c.refundProviderAttempt||'não realizado'))+'</p>'+
     (canAct&&choices.length?'<fieldset class="card flat"><legend>Marque a providência</legend>'+
       options+'</fieldset>'+
       '<details><summary>Outro motivo (opcional)</summary>'+
       '<label for="ads-refund-admin-reason-'+id+'">Justificativa personalizada</label>'+
       '<textarea id="ads-refund-admin-reason-'+id+'" class="input" maxlength="500" rows="2"></textarea></details>'+
       (canExecute?'<div id="ads-refund-acknowledgements-'+id+'" hidden>'+
        '<label class="admin-option-row"><input type="checkbox" id="ads-refund-check-payment-'+id+'"> '+
        'Conferi o pagamento, o valor integral e a conta recebedora no Mercado Pago.</label>'+
        '<label class="admin-option-row"><input type="checkbox" id="ads-refund-check-send-'+id+'"> '+
        'Autorizo esta devolução integral. Sei que não devo repetir envios ambíguos.</label></div>':'')+
       '<button type="button" class="secondary small" '+
        'onclick="adminIndependentAdsChooseRefund(\''+id+'\','+Number(c.version||0)+')" '+
        (adminIndependentAdsBusy?'disabled':'')+'>Executar providência marcada</button>'
:'')+
     '</article>';
 }).join('')||'':'';
 const rows=pane==='campaigns'?v?.rows?.map(c=>
  '<article class="card flat"><strong>'+esc(String(c.advertiser||''))+' · '+esc(String(c.title||''))+'</strong>'+
  '<p>'+esc(String(c.city||''))+'/'+esc(String(c.state||''))+
  ' · '+esc(String(c.effectiveStatus||c.status||''))+' · Versão '+Number(c.version||0)+'</p>'+
  '<p>'+esc(String(c.description||''))+'</p>'+
  '<small>Destino: '+esc(String(c.destination||''))+'</small>'+
  '<p>Prazo original: '+(c.runEndsAt?esc(String(c.runEndsAt).slice(0,10)):'aguardando início')+
  ' · Retomar nunca prorroga o prazo.</p>'+
  '<p>Valor do pacote: '+adminMoney(Number(c.budgetCents||0))+
  ' · Pagamento: '+esc(String(c.fixedFeeStatus||'não iniciado'))+'</p>'+
  '<p>Orçamento máximo: '+adminMoney(Number(c.budgetCents||0))+
  ' · Sinais de visibilidade: '+Number(c.reportedViewSignals||0)+
  ' · Exibições faturáveis: 0</p>'+actions(c)+'</article>'
 ).join('')||'':'';
 return '<section class="section" aria-label="Publicação independente do TAMÃO Ads">'+
  '<div class="section-head"><div><span class="section-kicker">TAMÃO ADS • ANUNCIANTES INDEPENDENTES</span>'+
  '<h3>Campanhas sem cadastro de revenda</h3>'+
  '<p>Análise e entrega não faturável. Sinais do navegador não constituem prova de cobrança.</p></div>'+
  '<button type="button" class="secondary small" onclick="adminIndependentAdsRefresh()" '+
  (adminIndependentAdsBusy?'disabled':'')+'>Atualizar campanhas</button></div>'+
  '<div class="admin-task-tabs" role="group" aria-label="Tarefas de anúncios independentes">'+
   adsPane('campaigns','Revisar campanhas',reviewCount)+
   adsPane('finance','Configuração e vendas',0)+
   adsPane('refunds','Reembolsos',refundCount)+'</div>'+
    '<div class="merchant-kpis"><div class="kpi"><span class="label">Entrega pública independente</span>'+
   '<strong>'+(delivery?'Habilitada':'Desligada')+'</strong></div>'+
   '<div class="kpi"><span class="label">CPM por visualizações</span><strong>Inativo</strong></div>'+
   '<div class="kpi"><span class="label">Vendas de período fixo</span><strong>'+
     (sales?'Habilitadas':'Desligadas')+'</strong></div>'+
   '<div class="kpi"><span class="label">Campanhas</span><strong>'+Number(v?.rows?.length||0)+'</strong></div></div>'+
  (pane==='finance'?(
  (canAct?'<div class="card flat"><label for="independent-ads-control-preset">Motivo da alteração</label>'+
    '<select id="independent-ads-control-preset" class="input">'+
    '<option value="">Selecione a justificativa</option>'+
    (delivery?'<option value="Entrega interrompida preventivamente para revisão operacional do inventário.">Interromper para revisão operacional</option>':
     '<option value="Inventário e conteúdo de campanhas conferidos para entrega sem faturamento.">Autorizar entrega não faturável revisada</option>')+
    '</select><label for="independent-ads-control-reason">Outro motivo (opcional)</label>'+
    '<textarea id="independent-ads-control-reason" class="input" maxlength="500" rows="2" ' +
    'placeholder="Descreva um motivo específico, se necessário"></textarea>'+
    '<button class="secondary small" type="button" onclick="adminIndependentAdsAction(\''+
    (delivery?'disable_delivery':'enable_delivery')+'\')" '+
    (adminIndependentAdsBusy?'disabled':'')+'>'+
    (delivery?'Interromper entrega imediatamente':'Autorizar entrega não faturável')+'</button>'+
    '<p class="tiny muted">A autorização exige campanha revisada e não libera faturamento, Pix nem repasses.</p></div>':'')+
  (canAct&&v?'<div class="card flat"><h4>Conferência segura do Mercado Pago</h4>'+
    '<p>Consulta somente leitura. Não emite Pix, pagamento ou reembolso.</p>'+
    '<button type="button" class="secondary small" onclick="adminIndependentAdsCheckProvider()" '+
      (adminIndependentAdsBusy?'disabled':'')+'>Conferir conta e webhook do TAMÃO Ads</button>'+
    (provider?
      '<p>Token de produção: '+(provider.tokenConfigured?'Configurado':'Pendente')+
      ' · Conta recebedora: '+(provider.sellerVerified?'Confirmada':'Não confirmada')+'</p>'+
      '<p>Checkout: '+(provider.checkoutConfigured?'Configurado':'Pendente')+
      ' · Webhook: '+(provider.webhookConfigured?'Habilitado':'Pendente')+
      ' · Assinatura: '+(provider.signedWebhookConfigured?'Configurada':'Pendente')+'</p>'+
      '<p><strong>Validações anteriores reaproveitadas:</strong> '+
        (provider.historicalSignedOrderWebhookVerified?
          'Webhook Mercado Pago assinado de pedidos (order.processed), modo LIVE, confirmado em '+
          esc(String(provider.historicalSignedOrderWebhookVerifiedAt||'').slice(0,16).replace('T',' '))+' UTC. '+
          'Esta etapa já foi comprovada; não é preciso refazer o teste de assinatura de pedidos.':
          'Não foi encontrada prova válida de webhook assinado de pedidos no histórico consultado.')+'</p>'+
      '<p><strong>Separação das provas:</strong> webhook de pedidos não comprova entrega do webhook de pagamentos da publicidade, '+
      'nem que o Mercado Pago Ads usa a mesma aplicação e conta recebedora. Nenhum valor antigo foi creditado novamente.</p>'+
      '<p><strong>Publicidade independente:</strong> '+Number(provider.adsApprovedPaymentEventCount)+
        ' evento(s) de aprovação de pagamento registrados · '+
        Number(provider.adsReversalEventCount)+' evento(s) de reversão no histórico. '+
        'Eventos de provedor não são, isoladamente, prova de liquidação bancária.</p>'+
      '<p><strong>Para finalizar a homologação Ads:</strong> conta recebedora verificada, Checkout Pro, webhook de pagamento '+
        'com assinatura e conciliação da própria campanha. A devolução só pode ser considerada concluída com confirmação do provedor.</p>'+
      '<p>Configuração apta para homologação: '+(provider.readyForFinancialHomologation?'Sim':'Não')+'</p>'
      :'<p class="muted">Utilize a conferência para localizar o que impede o recebimento. Nenhuma credencial é exibida.</p>')+
    '</div>':'')+
  (canAct&&v&&!sales?'<div class="card flat"><h4>Homologação financeira controlada</h4>'+
    '<p>Autorize apenas uma campanha aprovada de R$ 19,90 por 7 dias para um pagamento <strong>real</strong>. '+
    'O checkout exige aceite do anunciante, valida a conta Mercado Pago e mantém as vendas públicas desligadas. '+
    'Não é simulação e não cria pagamentos automaticamente.</p>'+
    (testActive?
      '<p role="status">Campanha autorizada: '+esc(String(v.homologationCampaignId))+
      ' · Até '+esc(String(v.homologationExpiresAt))+'</p>':
      '<p role="status">Não há autorização de teste financeiro ativa.</p>')+
    (!testActive&&eligibleTestCampaigns.length?
      '<label for="ads-homologation-campaign">Campanha aprovada (R$ 19,90)</label>'+
      '<select id="ads-homologation-campaign" class="input">'+eligibleTestCampaigns.map(c=>
        '<option value="'+esc(String(c.id))+'">'+esc(String(c.title))+'</option>').join('')+'</select>':
      !testActive?'<p>Envie e aprove uma campanha real de R$ 19,90 antes de autorizar o checkout de homologação.</p>':'')+
    '<label for="ads-homologation-preset">Motivo da autorização ou revogação</label>'+ 
    '<select id="ads-homologation-preset" class="input"><option value="">Selecione a justificativa</option>'+ 
    (testActive?'<option value="Autorização de teste financeiro revogada após revisão administrativa dos próximos checkouts.">Revogar autorização de teste</option>':
     '<option value="Campanha e elegibilidade para homologação financeira real conferidas pelo administrador.">Autorizar teste real acompanhado</option>')+'</select>'+ 
    '<label for="ads-homologation-reason">Outro motivo (opcional)</label>'+
    '<textarea id="ads-homologation-reason" class="input" maxlength="500" rows="2"></textarea>'+
    '<label for="ads-homologation-confirm">Confirmação ('+
      (testActive?'CANCELAR':'HOMOLOGAR')+')</label>'+
    '<input id="ads-homologation-confirm" class="input" autocomplete="off" maxlength="9">'+
    '<button class="secondary small" type="button" '+
      'onclick="adminIndependentAdsHomologationAction('+(testActive?'false':'true')+')" '+
      ((adminIndependentAdsBusy||(!testActive&&!eligibleTestCampaigns.length))?'disabled':'')+'>'+
      (testActive?'Revogar autorização para novo checkout':'Autorizar uma compra real de R$ 19,90')+
    '</button>'+
    '<p class="tiny muted">Revogação não desfaz pagamentos já enviados ao Mercado Pago. '+
    'Confira webhook, pagamento e estorno antes da abertura comercial.</p></div>':'')+
  (canAct&&v?'<div class="card flat"><h4>Contratação por período fixo</h4>'+
    '<p>Novos pagamentos só podem ser ativados com credenciais comerciais, vendedor verificado e webhook assinado. A taxa de CPM por visualização continua inativa.</p>'+
    '<p>Total aprovado pelo provedor (bruto, não é conciliação bancária): '+
      adminMoney(Number(v.providerApprovedGrossCents||0))+'</p>'+
    '<label for="independent-ads-sales-preset">Motivo da alteração</label>'+ 
    '<select id="independent-ads-sales-preset" class="input"><option value="">Selecione a justificativa</option>'+ 
    (sales?'<option value="Novas contratações suspensas preventivamente por decisão administrativa.">Interromper novas contratações</option>':
     '<option value="Recebimento e exigências do checkout de publicidade conferidos antes de liberar contratações.">Autorizar vendas após conferência</option>')+'</select>'+ 
    '<label for="independent-ads-sales-reason">Outro motivo (opcional)</label>'+
    '<textarea id="independent-ads-sales-reason" class="input" rows="2" maxlength="500" '+
      'placeholder="Descreva por que autorizar ou interromper novas compras"></textarea>'+
    '<button type="button" class="secondary small" onclick="adminIndependentAdsSalesAction()" '+
      (adminIndependentAdsBusy?'disabled':'')+'>'+
      (sales?'Interromper novas compras':'Habilitar compras com pagamento verificado')+
    '</button></div>':'')
  ):'')+
  (pane==='refunds'?(
  (v?.refundCases===null?'<p class="muted">Fila de reembolsos indisponível. Atualize para conferir.</p>':
    v?.refundCases?.length?'<section class="section"><h4>Cancelamentos e reembolsos</h4>'+
     '<p>Pedidos registrados pausam a publicidade; somente devolução confirmada no provedor permite conclusão. A revisão não movimenta valores.</p>'+
     '<div class="grid cards-2">'+refundRows+'</div></section>':'')
  ):'')+
  (pane==='campaigns'?(
  (v?'<div class="grid cards-2">'+(rows||'<p>Sem campanhas enviadas até agora.</p>')+'</div>':
   '<p class="muted">Atualize para conferir propostas reais e os controles de publicação.</p>')
  ):'')+
  '</section>';
}
