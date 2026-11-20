// V1.883 — budget preview, not a charge or promised inventory.
// CPM candidate: R$12 per 1,000 independently verified display views.
const TAMAO_ADS_PROPOSED_CPM_CENTS=1200;
const TAMAO_ADS_PREVIEW_BUDGETS=[1990,4990,9990,19990];
// V1.911 — UF is selected, never typed or inferred from a fictitious location.
const TAMAO_ADS_UFS=['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
 'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
function tamaoAdsFixedDays(budgetCents){
 const days={1990:7,4990:15,9990:30,19990:30}[Number(budgetCents)];
 return Number.isSafeInteger(days)?days:null;
}
function tamaoAdsBudgetPreview(budgetCents){
  const budget=Number(budgetCents);
  if(!Number.isSafeInteger(budget)||!TAMAO_ADS_PREVIEW_BUDGETS.includes(budget))
    return null;
  return {budgetCents:budget,cpmCents:TAMAO_ADS_PROPOSED_CPM_CENTS,
    maxViewableImpressions:Math.floor(budget*1000/TAMAO_ADS_PROPOSED_CPM_CENTS),
    chargeEnabled:false,inventoryVerified:false,guaranteedViews:0};
}
function tamaoAdsFormatMoney(cents){
  return 'R$ '+(cents/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function tamaoAdsBudgetQuote(){
  const budget=Number(document.getElementById('sponsor-cpm-budget')?.value);
  const duration=tamaoAdsFixedDays(budget);
  const selector=document.getElementById('sponsor-cpm-days');
  if(selector&&duration)selector.value=String(duration);
  const quote=tamaoAdsBudgetPreview(budget);
  const node=document.getElementById('sponsor-cpm-result');
  if(!node)return;
  if(!quote){node.textContent='Selecione um orçamento válido.';return}
  const count=quote.maxViewableImpressions.toLocaleString('pt-BR');
  for(const option of document.querySelectorAll?.('[data-sponsor-budget]')||[]){
    const active=Number(option.getAttribute('data-sponsor-budget'))===budget;
    option.setAttribute('aria-pressed',String(active));
    option.classList?.toggle('is-selected',active);
  }
  node.textContent='Orçamento em análise: '+tamaoAdsFormatMoney(budget)+' por '+duration+
    ' dias. O envio da proposta não gera cobrança nem garante exibição.';
  const details=document.getElementById('sponsor-cpm-technical-result');
  if(details)details.textContent='Equivalência matemática do teto: até '+count+
    ' visualizações verificadas somente se houver público suficiente. Esta conta não é previsão de audiência nem compromisso de entrega.';
}
function tamaoAdsChooseBudget(value){
 const budget=Number(value);
 if(!tamaoAdsBudgetPreview(budget))return false;
 const select=document.getElementById('sponsor-cpm-budget');
 if(!select)return false;
 select.value=String(budget);
 tamaoAdsBudgetQuote();
 return true;
}
function tamaoAdsContinueToCreative(){
  if(typeof route==='function'&&route()!=='sponsors')return false;
  const target=document.getElementById('sponsor-account-step');
  if(!target)return false;
  const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true;
  target.scrollIntoView({behavior:reduced?'auto':'smooth',block:'start'});
  target.focus?.({preventScroll:true});
  return true;
}
function tamaoAdsBudgetRequest(){
  const quote=tamaoAdsBudgetPreview(Number(document.getElementById('sponsor-cpm-budget')?.value));
  if(!quote)return;
  const city=String(document.getElementById('sponsor-cpm-city')?.value||'').trim().replace(/\s+/g,' ').slice(0,80);
  const state=String(document.getElementById('sponsor-cpm-state')?.value||'RS').trim().toUpperCase();
  const days=tamaoAdsFixedDays(quote.budgetCents);
  const daysSelector=document.getElementById('sponsor-cpm-days');
  if(daysSelector&&days)daysSelector.value=String(days);
  if(!Number.isSafeInteger(days)||![7,15,30].includes(days)||!/^[A-Z]{2}$/.test(state)){
    document.getElementById('sponsor-cpm-result').textContent='Revise o período e a UF.';
    return;
  }
  const cityLabel=city?city+'/'+state:'UF '+state;
  const detail='Interesse em publicidade independente de revendas. Cidade: '+cityLabel+
    '. Prazo desejado: '+days+' dias. Teto solicitado: '+tamaoAdsFormatMoney(quote.budgetCents)+
    '. Simulação não vinculante: CPM proposto de '+tamaoAdsFormatMoney(quote.cpmCents)+
    ', equivalência de até '+quote.maxViewableImpressions+
    ' impressões verificadas, sem promessa de entrega. Solicito avaliar inventário e condições antes de qualquer cobrança.';
  openSponsorContact('visibility',detail);
}
// Load wallet UI only on the advertiser page; no anonymous identity is created.
function tamaoAdsCreditsLoad(){
 if(typeof document?.createElement!=='function'||typeof setTimeout!=='function')return;
 if(globalThis.tamaoCreditBoot){setTimeout(()=>globalThis.tamaoCreditBoot?.(),0);return}
 if(globalThis.tamaoCreditLoading)return;
 globalThis.tamaoCreditLoading=true;
 const src=document.querySelector('script[src*="ads-planner.js"]')?.src||
  location.origin+'/js/ads-planner.js';
 if(!document.querySelector('link[data-tamao-credit-style]')){
  const style=document.createElement('link');
  style.rel='stylesheet';
  style.setAttribute('data-tamao-credit-style','true');
  style.href=new URL('../css/ads-credits.css'+new URL(src).search,src).href;
  document.head.append(style);
 }
 const tag=document.createElement('script');
 tag.src=new URL('ads-credits.js'+new URL(src).search,src).href;
 tag.onload=()=>{globalThis.tamaoCreditLoading=false;
  setTimeout(()=>globalThis.tamaoCreditBoot?.(),0)};
 tag.onerror=()=>{globalThis.tamaoCreditLoading=false};
 document.head.append(tag);
}
function tamaoAdsPlannerSection(){
 tamaoAdsCreditsLoad();
 if(globalThis.tamaoAdsCreditModeEnabled===true){
  const verified=typeof tamaoAdsAccountVerified==='function'&&tamaoAdsAccountVerified();
  if(verified&&tamaoAdsMyState?.status==='idle'&&typeof setTimeout==='function'){
   tamaoAdsMyState.status='loading';
   setTimeout(()=>tamaoAdsMyRefresh({quiet:true}),0);
  }
  const legacy=verified&&tamaoAdsMyState?.status==='ready'&&
   Array.isArray(tamaoAdsMyState.rows)&&tamaoAdsMyState.rows.length>0?
    '<details class="tamao-credit-legacy-history"><summary>Consultar contratos e pagamentos anteriores</summary>'+
     tamaoAdsCampaignForm()+'</details>':'';
  return '<section class="section sponsor-budget-builder tamao-credit-intro" aria-label="Publicidade com créditos por visualização">'+
   '<div class="section-head"><div><span class="section-kicker">INVESTIMENTO SOB CONTROLE</span>'+
   '<h2>Carregue créditos. Pague apenas pelas visualizações elegíveis.</h2>'+
   '<p>Sem pacote de sete dias, mensalidade ou cobrança acima do saldo. Sua empresa define a cidade, envia a peça e acompanha o consumo na própria conta.</p></div></div>'+
   '<div class="tamao-credit-steps">'+
    '<div><strong>01 · Carregue quando quiser</strong><p>Escolha R$ 19,90 ou outro valor, pague por Pix e acompanhe o saldo confirmado.</p></div>'+
    '<div><strong>02 · Divulgue na sua cidade</strong><p>Uma campanha aprovada aparece quando há público e crédito disponível.</p></div>'+
    '<div><strong>03 · Acompanhe o consumo</strong><p>O valor por visualização e o extrato estão no seu painel. Você pode pausar a divulgação.</p></div>'+
   '</div>'+
   '<p class="tiny muted">A publicidade depende da audiência disponível. Visualizações repetidas ou inválidas não devem gerar débito; filtros de tráfego são aplicados pelo servidor.</p>'+
   '</section>'+
   (verified?legacy:tamaoAdsCampaignForm());
 }
 tamaoAdsCreditsLoad();
  // The visitor can carry a deliberately selected preview plan into this real
  // form. The official whitelist remains authoritative; this never charges.
  const requestedBudget=Number(globalThis.tamaoSponsorDemoBudget?.()||4990);
  const initialBudget=TAMAO_ADS_PREVIEW_BUDGETS.includes(requestedBudget)?requestedBudget:4990;
  const initialDays=tamaoAdsFixedDays(initialBudget);
  const preset=tamaoAdsBudgetPreview(initialBudget);
  const fixedSales=tamaoAdsMyState?.fixedFeeSalesEnabled===true;
  const options=TAMAO_ADS_PREVIEW_BUDGETS.map(v=>
    '<option value="'+v+'"'+(v===initialBudget?' selected':'')+'>'+tamaoAdsFormatMoney(v)+
      ' · '+tamaoAdsFixedDays(v)+' dias</option>').join('');
  const quickChoices=TAMAO_ADS_PREVIEW_BUDGETS.map(v=>
    '<button type="button" class="sponsor-budget-choice'+(v===initialBudget?' is-selected':'')+
      '" data-sponsor-budget="'+v+'" aria-pressed="'+(v===initialBudget?'true':'false')+
      '" onclick="tamaoAdsChooseBudget('+v+')">'+
      '<strong>'+tamaoAdsFormatMoney(v)+'</strong><small>'+tamaoAdsFixedDays(v)+
      ' dias</small></button>').join('');
  return '<section class="section sponsor-budget-builder" aria-label="Planejar uma campanha publicitária sem compromisso">'+
    '<div class="section-head"><div><span class="section-kicker">ORÇAMENTO DA SUA CAMPANHA</span>'+
    '<h2>'+(fixedSales?'Conheça o valor e o prazo antes de contratar.':
      'Escolha a faixa de investimento que faz sentido.')+'</h2>'+
    '<p>Publicidade regional é independente de cadastrar uma revenda. Selecione uma opção e prepare a proposta, sem pagamento nesta etapa.</p></div></div>'+
    '<div class="card flat form-stack">'+
    '<span class="sponsor-budget-eyebrow">OPÇÕES PARA PLANEJAMENTO</span>'+
    '<div class="sponsor-budget-choices" role="group" aria-label="Escolha seu orçamento de divulgação">'+quickChoices+'</div>'+
    '<div class="field-row">'+
    '<div class="input-wrap"><label for="sponsor-cpm-budget">'+
       (fixedSales?'Preço fixo do pacote':'Orçamento escolhido')+'</label><select id="sponsor-cpm-budget" class="input" onchange="tamaoAdsBudgetQuote()">'+options+'</select></div>'+
    '<div class="input-wrap"><label for="sponsor-cpm-days">Período correspondente</label><select id="sponsor-cpm-days" class="input" disabled aria-label="Prazo definido pelo pacote">'+
      '<option value="7"'+(initialDays===7?' selected':'')+'>7 dias</option><option value="15"'+(initialDays===15?' selected':'')+'>15 dias</option><option value="30"'+(initialDays===30?' selected':'')+'>30 dias</option></select></div></div>'+
    '<div class="field-row">'+
    '<div class="input-wrap"><label for="sponsor-cpm-city">Cidade onde quer divulgar</label><input id="sponsor-cpm-city" class="input" maxlength="80" autocomplete="address-level2" placeholder="Ex.: São Gabriel"></div>'+
    '<div class="input-wrap"><label for="sponsor-cpm-state">Estado (UF)</label><select id="sponsor-cpm-state" class="input" autocomplete="address-level1" aria-describedby="sponsor-cpm-note">'+
     TAMAO_ADS_UFS.map(uf=>'<option value="'+uf+'"'+(uf==='RS'?' selected':'')+'>'+uf+'</option>').join('')+
    '</select></div></div>'+
    '<p id="sponsor-cpm-result" role="status" aria-live="polite">Orçamento em análise: '+tamaoAdsFormatMoney(initialBudget)+' por '+initialDays+' dias. O envio da proposta não gera cobrança nem garante exibição.</p>'+
    '<div class="sponsor-budget-actions"><button type="button" class="primary" onclick="tamaoAdsContinueToCreative()">Continuar e preparar meu anúncio →</button>'+ 
    '<button type="button" class="secondary" onclick="tamaoAdsBudgetRequest()">Solicitar proposta personalizada</button>'+ 
    '<button type="button" class="secondary" onclick="tamaoAdsShowCityPublic()">Ver publicidade ativa nesta cidade</button></div>'+
    '<details class="sponsor-budget-method"><summary>Como funcionam a medição e a cobrança?</summary>'+
    '<div class="merchant-kpis"><div class="kpi"><span class="label">'+
      (fixedSales?'Veiculação com preço fixo':'CPM em avaliação')+'</span><strong>'+
      (fixedSales?'Pacote selecionado':'R$ 12,00')+'</strong><small>'+
      (fixedSales?'valor por período, não por impressão':'por 1.000 visualizações verificadas')+'</small></div>'+
    '<div class="kpi"><span class="label">'+(fixedSales?'CPM faturável':'Cobrança agora')+
       '</span><strong>R$ 0,00</strong><small>'+
      (fixedSales?'a cobrança exige aprovação e condições válidas':'exibições comerciais ainda não habilitadas')+
      '</small></div></div>'+
    '<p id="sponsor-cpm-note" class="tiny muted">Uma visualização exigirá pelo menos 50% do anúncio visível durante 1 segundo contínuo, além de filtros contra tráfego inválido. A estimativa não é reserva nem garantia de público; somente condições verificadas poderão gerar contrato e cobrança.</p>'+
    '<p id="sponsor-cpm-technical-result" class="tiny muted">Equivalência matemática do teto: até '+preset.maxViewableImpressions.toLocaleString('pt-BR')+' visualizações, somente se houver público suficiente. Não é previsão de audiência.</p>'+
    '</details>'+
    '<div id="sponsor-ad-live-slot" class="section" aria-label="Anúncio patrocinado disponível na região"></div>'+
    '</div></section>'+tamaoAdsCampaignForm();
}


// V1.911 — user-selected editable drafts, never automatic submission.
const TAMAO_ADS_COPY_MODELS={
 company:{
  title:name=>'Conheça a empresa '+name,
  description:name=>'Conheça a empresa '+name+'. Consulte o site indicado para saber mais sobre o anunciante.'
 },
 website:{
  title:name=>'Saiba mais sobre '+name,
  description:name=>'Acesse o site indicado para conhecer '+name+' e consultar informações sobre a empresa.'
 },
 contact:{
  title:name=>'Entre em contato com '+name,
  description:name=>'Conheça '+name+'. Consulte os canais de contato informados no site indicado neste anúncio.'
 }
};
function tamaoAdsCampaignUseModel(key){
 if(!Object.prototype.hasOwnProperty.call(TAMAO_ADS_COPY_MODELS,key))return false;
 const company=String(document.getElementById('sponsor-ad-company')?.value||'').trim();
 const title=document.getElementById('sponsor-ad-title');
 const description=document.getElementById('sponsor-ad-copy');
 if(company.length<2||!title||!description){
  toast('Informe primeiro o nome real da empresa.');return false;
 }
 const model=TAMAO_ADS_COPY_MODELS[key];
 const nextTitle=model.title(company),nextDescription=model.description(company);
 if(nextTitle.length>80||nextDescription.length>240){
  toast('Nome muito longo para o modelo. Escreva o título e a mensagem personalizados.');return false;
 }
 if((title.value||description.value)&&
  (title.value!==nextTitle||description.value!==nextDescription)&&
  !confirm('Substituir o título e a mensagem atuais pelo modelo selecionado?'))return false;
 title.value=nextTitle;description.value=nextDescription;
 if(typeof tamaoAdsUpdateCreativePreview==='function')tamaoAdsUpdateCreativePreview();
 return true;
}
// Refund requests are self-declared motives, not proof of PSP reversal or wrongdoing.
const TAMAO_ADS_REFUND_MOTIVES={
 cancel:'Solicito o cancelamento desta campanha e uma análise de eventual reembolso.',
 charge:'Não reconheço a cobrança vinculada a esta campanha e solicito esclarecimento e análise.',
 delivery:'Tenho uma divergência sobre a veiculação desta campanha e solicito análise.'
};
function tamaoAdsRefundReasonText(campaignId){
 if(!/^[0-9a-f-]{36}$/i.test(String(campaignId||'')))return '';
 const choice=String(document.getElementById('ads-refund-choice-'+campaignId)?.value||'');
 const extra=String(document.getElementById('ads-refund-reason-'+campaignId)?.value||'').trim().replace(/\s+/g,' ');
 if(choice==='custom')return extra;
 if(!Object.prototype.hasOwnProperty.call(TAMAO_ADS_REFUND_MOTIVES,choice))return '';
 return TAMAO_ADS_REFUND_MOTIVES[choice]+(extra?' Detalhes: '+extra:'');
}

// V1.884: independent advertiser intake with verified email; never charges.
let tamaoAdsDraftRequestId=null;
let tamaoAdsDraftBusy=false;
let tamaoAdsMyState={userId:null,rows:[],status:'idle',fixedFeeSalesEnabled:false,
 homologationCampaignId:null,homologationExpiresAt:null};
let tamaoAdsMyReadSeq=0;
let tamaoAdsPurchaseBusy=false;
let tamaoAdsRefundBusy=false;
const tamaoAdsRefundRequestIds=new Map();
let tamaoAdsPurchaseScriptPromise=null;
function tamaoAdsAccountVerified(){
  const u=globalThis.liveRuntime?.session?.user;
  return globalThis.liveReady?.()===true&&u?.id&&u.is_anonymous!==true&&!!u.email_confirmed_at;
}
function tamaoAdsSessionScope(){
 return {userId:String(globalThis.liveRuntime?.session?.user?.id||''),
  generation:Number(globalThis.liveRuntime?.authGeneration||0)};
}
function tamaoAdsSessionMatches(scope){
 const current=tamaoAdsSessionScope();
 return !!scope.userId&&tamaoAdsAccountVerified()&&
  current.userId===scope.userId&&current.generation===scope.generation;
}
function tamaoAdsSyncOwner(){
 const scope=tamaoAdsSessionScope();
 if(!tamaoAdsAccountVerified())scope.userId='';
 if(tamaoAdsMyState.userId!==scope.userId||
    tamaoAdsMyState.authGeneration!==scope.generation){
  ++tamaoAdsMyReadSeq;
  tamaoAdsAutoPaymentStop();
  tamaoAdsDraftBusy=false;tamaoAdsDraftRequestId=null;
  tamaoAdsPurchaseBusy=false;tamaoAdsRefundBusy=false;
  tamaoAdsRefundRequestIds.clear();
  tamaoAdsMyState={userId:scope.userId,authGeneration:scope.generation,
   rows:[],status:'idle',fixedFeeSalesEnabled:false,
   homologationCampaignId:null,homologationExpiresAt:null};
 }
 return scope;
}
function tamaoAdsPaymentText(campaign){
 const payment=String(campaign?.fixedFeeStatus||'');
 if(payment==='payment_approved'){
  const status=String(campaign.effectiveStatus||campaign.status||'');
  if(status==='active')return 'Pagamento aprovado pelo provedor; campanha ativa.';
  if(status==='paused')return 'Pagamento aprovado pelo provedor; campanha pausada.';
  if(['ended','expired'].includes(status))return 'Pagamento aprovado pelo provedor; veiculação encerrada.';
  return 'Pagamento aprovado pelo provedor; aguarda publicação.';
 }
 return payment==='payment_reversed'?'Pagamento revertido; anúncio pausado.':
  payment==='reserved'?'Checkout em verificação. Não faça outra cobrança.':
  payment==='checkout_ready'?'Pagamento ainda não confirmado.':'';
}
async function tamaoAdsAccountStart(mode='register'){
  const returning=mode==='login';
  if(mode!=='register'&&!returning)return false;
  const emailId=returning?'sponsor-account-login-email':'sponsor-account-email';
  const email=String(document.getElementById(emailId)?.value||'').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return toast('Informe um e-mail válido.');
  let fullName='',phone='';
  if(!returning){
    fullName=String(document.getElementById('sponsor-account-name')?.value||'').trim().replace(/\s+/g,' ');
    phone=String(document.getElementById('sponsor-account-phone')?.value||'').replace(/\D/g,'');
    if(fullName.length<5||fullName.length>100||fullName.split(' ').length<2||
       !/^[\p{L}][\p{L} .'-]{3,99}$/u.test(fullName))
      return toast('Informe seu nome e sobrenome.');
    if(!/^[0-9]{10,11}$/.test(phone))
      return toast('Informe telefone com DDD.');
  }
  const submit=document.getElementById(returning?'sponsor-account-login-send':'sponsor-account-register-send');
  const status=document.getElementById('sponsor-account-status');
  if(submit?.disabled)return false;
  if(submit)submit.disabled=true;
  if(status)status.textContent='Preparando seu acesso seguro…';
  try{
    const reply=returning
      ?await tamaoClubSendAccess(email,{returnToSponsor:true})
      :await liveUpgradeAccount(email,{fullName,phone,returnToSponsor:true});
    if(reply?.alreadyPermanent){
      if(status)status.textContent='Sua conta está pronta. Você já pode enviar o anúncio para revisão.';
      if(typeof render==='function')render();
    }else{
      if(status)status.textContent=returning
        ?'Enviamos um link de entrada para seu e-mail. Abra-o neste navegador para voltar à sua campanha.'
        :'Enviamos a confirmação para seu e-mail. Confirme o cadastro para preparar a campanha.';
    }
    return true;
  }catch{
    if(status)status.textContent=returning
      ?'Não foi possível enviar o link. Confira seu e-mail e tente novamente.'
      :'Não foi possível iniciar o cadastro. Verifique seus dados e tente novamente.';
    return false;
  }finally{
    if(submit)submit.disabled=false;
  }
}
// V1.1091 — private draft preview: text only; never emits an impression or opens an external URL.
function tamaoAdsUpdateCreativePreview(){
 const val=id=>String(document.getElementById(id)?.value||'').trim();
 const set=(id,value)=>{
  const el=document.getElementById(id);
  if(el)el.textContent=value;
 };
 set('sponsor-creative-brand',val('sponsor-ad-company')||'Nome da sua empresa');
 set('sponsor-creative-title',val('sponsor-ad-title')||'Seu título aparecerá aqui');
 set('sponsor-creative-message',val('sponsor-ad-copy')||'Descreva brevemente o que sua empresa oferece.');
 const destination=val('sponsor-ad-url');
 let host='Seu site oficial';
 try{
  const parsed=new URL(destination);
  if(parsed.protocol==='https:'&&parsed.hostname)host=parsed.hostname;
 }catch{}
 set('sponsor-creative-domain',host);
 return true;
}
// Prefill only a business name the visitor explicitly continued from the public
// personalized preview. Never infer identity, overwrite an existing draft, or submit.
function tamaoAdsPublicDemoCompanyAttr(){
 const get=globalThis.tamaoSponsorDemoCompany;
 if(typeof get!=='function')return '';
 const name=String(get()||'').trim().slice(0,48);
 if(!name)return '';
 const encoded=name.replace(/[&<>"']/g,ch=>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 return ' value="'+encoded+'"';
}
// V1.1094 — only an explicitly continued, private creative draft may prefill
// EMPTY campaign fields; the advertiser still edits/reviews before submitting.
function tamaoAdsPublicDemoCreative(field){
 if(!['headline','copy'].includes(field))return '';
 const get=globalThis.tamaoSponsorDemoCreative;
 const item=typeof get==='function'?get():null;
 if(!item||typeof item!=='object')return '';
 const size=field==='headline'?80:240;
 const value=String(item[field]||'').trim().slice(0,size);
 return value.replace(/[&<>"']/g,ch=>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function tamaoAdsCampaignForm(){
  tamaoAdsSyncOwner();
  if(!tamaoAdsAccountVerified())
    return '<section id="sponsor-account-step" tabindex="-1" class="section sponsor-access-start" aria-label="Acesso seguro do anunciante"><div class="section-head"><div>'+
      '<span class="section-kicker">SUA CONTA DE ANUNCIANTE</span>'+
      '<h2>Apresente sua empresa com segurança.</h2><p>Primeiro acesso? Informe seus dados e confirme o e-mail. Já tem conta? Entre sem repetir o cadastro. Nenhuma dessas ações cria cobrança ou anúncio.</p></div></div>'+
      '<div class="card flat sponsor-account-entry">'+
      '<div class="sponsor-account-form-grid">'+
      '<label for="sponsor-account-name">Nome e sobrenome'+
      '<input id="sponsor-account-name" class="input" maxlength="100" autocomplete="name" placeholder="Seu nome completo"></label>'+
      '<label for="sponsor-account-phone">Telefone com DDD'+
      '<input id="sponsor-account-phone" class="input" maxlength="18" type="tel" inputmode="tel" autocomplete="tel" placeholder="(55) 99999-9999"></label></div>'+
      '<label for="sponsor-account-email">E-mail para confirmar sua conta'+
      '<input id="sponsor-account-email" class="input" autocomplete="email" type="email" maxlength="160" placeholder="voce@empresa.com.br"></label>'+
      '<button id="sponsor-account-register-send" type="button" class="primary" onclick="tamaoAdsAccountStart()">Criar conta e enviar confirmação →</button>'+
      '<details class="sponsor-account-returning"><summary>Já tenho conta — entrar só com e-mail</summary>'+
      '<label for="sponsor-account-login-email">E-mail da sua conta'+
      '<input id="sponsor-account-login-email" class="input" autocomplete="email" type="email" maxlength="160" placeholder="voce@empresa.com.br"></label>'+
      '<button id="sponsor-account-login-send" type="button" class="secondary" onclick="tamaoAdsAccountStart(\'login\')">Enviar link de acesso</button>'+
      '</details>'+
      '<p id="sponsor-account-status" role="status" aria-live="polite"></p>'+
      '<small>A confirmação da conta é necessária para enviar a campanha à análise. O envio do anúncio não publica nem gera Pix.</small>'+
      '</div></section>';
  const s=tamaoAdsMyState;
  if(s.status==='idle'&&typeof setTimeout==='function'){
    s.status='loading';
    setTimeout(()=>tamaoAdsMyRefresh({quiet:true}),0);
  }
  const current=String(globalThis.liveRuntime?.session?.user?.id||'');
  const mine=s.userId===current&&s.status==='ready'
    ?s.rows.map(c=>{
      const id=String(c.id||'');
      const fee=Number(c.budgetCents)||0;
      const days=Number(c.durationDays)||0;
      const bought=String(c.fixedFeeStatus||'');
      const validPlan=(fee===1990&&days===7)||(fee===4990&&days===15)||
        (fee===9990&&days===30)||(fee===19990&&days===30);
      const testAuthorized=String(s.homologationCampaignId||'')===id&&
        Date.parse(String(s.homologationExpiresAt||''))>Date.now();
      const pixReady=bought==='checkout_ready'&&c.fixedFeePixPayable===true&&
        typeof c.fixedFeePixCode==='string'&&c.fixedFeePixCode.length>30&&
        Date.parse(String(c.fixedFeePixExpiresAt||''))>Date.now()+60000;
      const canBuy=(s.fixedFeeSalesEnabled===true||testAuthorized)&&
        c.status==='approved'&&validPlan&&!pixReady&&
        (bought===''||bought==='checkout_ready'||bought==='reserved');
      const payment=tamaoAdsPaymentText(c);
      const refundStatus=String(c.refundCaseStatus||'');
      const checkPayment=bought&&bought!=='payment_reversed'?
        '<button type="button" class="secondary small" onclick="tamaoAdsVerifyPayment(\''+id+'\')" '+
        (tamaoAdsPurchaseBusy?'disabled':'')+'>'+
        'Verificar pagamento</button>':'';
      const refundAction=bought==='payment_approved'&&!refundStatus?
        '<div class="card flat"><label for="ads-refund-choice-'+id+'">Motivo da solicitação</label>'+
        '<select id="ads-refund-choice-'+id+'" class="input">'+
        '<option value="">Selecione o motivo real</option>'+
        '<option value="cancel">Quero cancelar a campanha</option>'+
        '<option value="charge">Não reconheço a cobrança</option>'+
        '<option value="delivery">Divergência na veiculação</option>'+
        '<option value="custom">Outro motivo</option></select>'+
        '<details><summary>Acrescentar detalhes ou escrever outro motivo (opcional)</summary>'+
        '<label for="ads-refund-reason-'+id+'">Detalhes para análise</label>'+
        '<textarea id="ads-refund-reason-'+id+'" class="input" maxlength="500" rows="2" '+
          'placeholder="Conte somente o que aconteceu."></textarea></details>'+
        '<button class="secondary small" type="button" onclick="tamaoAdsRequestRefund(\''+id+'\')" '+
          (tamaoAdsRefundBusy?'disabled':'')+'>Solicitar análise de reembolso</button>'+
        '<small>O pedido pausa a publicidade. Não confirma devolução de dinheiro antes da resposta do provedor.</small></div>':
        refundStatus?'<p role="status">Solicitação de reembolso: '+esc(refundStatus)+
          '. O histórico financeiro permanece sujeito à confirmação do provedor.</p>':'';
      const pixPanel=pixReady?'<section class="notice" aria-label="Pix da publicidade">'+
        '<h3>Pague sem sair do TAMÃO</h3>'+
        (globalThis.tamaoPixMarkup?.(c.fixedFeePixCode,{amountCents:fee})||'')+
        '<label>Pix copia e cola<textarea class="input" readonly rows="3">'+esc(c.fixedFeePixCode)+'</textarea></label>'+
        '<button type="button" class="primary" onclick="tamaoAdsCopyPix(\''+id+'\')">Copiar código Pix</button>'+
        '<p>Validade: '+esc(new Date(c.fixedFeePixExpiresAt).toLocaleString('pt-BR'))+'. A confirmação aparece aqui.</p></section>':'';
      if(pixReady&&typeof globalThis.tamaoPixWatch==='function'){
        const actor=s.userId;
        globalThis.tamaoPixWatch('ads:'+actor+':'+id,()=>route()==='sponsors'&&tamaoAdsAccountVerified()&&
          tamaoAdsMyState?.userId===actor&&tamaoAdsMyState.rows.some(r=>r.id===id&&r.fixedFeeStatus==='checkout_ready'),
          ()=>tamaoAdsMyRefresh({quiet:true,autoReconcile:false}));
      }
      const buy=canBuy?'<div class="card flat">'+
        (testAuthorized&&!s.fixedFeeSalesEnabled?
          '<p><strong>Homologação supervisionada:</strong> este é um pagamento REAL autorizado para uma campanha, não uma simulação.</p>':'')+
        '<p><strong>Veiculação por prazo fixo:</strong> '+tamaoAdsFormatMoney(fee)+
        ' por '+days+' dias, nesta cidade. Não há garantia de visualizações e não é cobrança por CPM.</p>'+
        '<label class="check-row"><input type="checkbox" id="ads-fixed-consent-'+id+'">'+
        '<span>Concordo com o preço fixo, prazo e condições de publicidade. O pagamento não publica o anúncio automaticamente.</span></label>'+
        '<button type="button" class="primary" onclick="tamaoAdsBuyCampaign(\''+id+'\')" '+
        (tamaoAdsPurchaseBusy?'disabled':'')+'>'+
        (bought==='reserved'?'Recuperar checkout sem nova cobrança':
         bought==='checkout_ready'?'Concluir pagamento':'Contratar veiculação')+'</button></div>':'';
      return '<article class="card flat"><strong>'+esc(String(c.title))+'</strong>'+
        '<p>'+esc(String(c.city))+'/'+esc(String(c.state))+' · '+
        esc(String(c.effectiveStatus||c.status))+' · '+Number(c.reportedViewSignals||0)+' sinais de visibilidade</p>'+
        '<p>Prazo: '+(c.runEndsAt?esc(String(c.runEndsAt).slice(0,10)):'aguardando publicação')+'</p>'+
        '<p>Preço cadastrado: '+tamaoAdsFormatMoney(fee)+' por '+days+' dias</p>'+
        (payment?'<p role="status">'+esc(payment)+'</p>':'')+
        '<small>Impressões faturáveis por CPM: 0. Receita exibida ao anunciante: não se aplica.</small>'+
        pixPanel+buy+checkPayment+refundAction+
        (c.status==='active'&&String(c.effectiveStatus||c.status)==='active'&&
         Date.parse(String(c.runEndsAt||''))>Date.now()&&
         typeof tamaoParticipantNativePanel==='function'
          ?tamaoParticipantNativePanel('advertiser',id):'')+'</article>';
    }).join(''):'';
  return '<section id="sponsor-account-step" tabindex="-1" class="section" aria-label="Cadastrar anúncio sem revenda">'+
    '<div class="section-head"><div><span class="section-kicker">ANUNCIANTE INDEPENDENTE</span>'+
    '<h2>Envie a peça para análise.</h2>'+
    '<p>Sem revenda, sem cobrança antecipada. O anúncio só será exibido após revisão e autorização de entrega.</p></div></div>'+
    '<div class="card flat form-stack" style="max-width:780px">'+
    '<div class="field-row"><label class="input-wrap">Empresa'+
    '<input id="sponsor-ad-company" class="input" oninput="tamaoAdsUpdateCreativePreview()" maxlength="120" autocomplete="organization"'+tamaoAdsPublicDemoCompanyAttr()+' required></label>'+
    '<label class="input-wrap">Título da campanha'+
    '<input id="sponsor-ad-title" class="input" oninput="tamaoAdsUpdateCreativePreview()" maxlength="80" placeholder="Apresente sua marca na cidade"'+
       (tamaoAdsPublicDemoCreative('headline')?' value="'+tamaoAdsPublicDemoCreative('headline')+'"':'')+' required></label></div>'+
    '<div class="input-wrap"><label for="sponsor-ad-template">Modelo para preencher título e mensagem (opcional)</label>'+
    '<select id="sponsor-ad-template" class="input">'+
    '<option value="">Escolha como apresentar sua empresa</option>'+
    '<option value="company">Apresentar minha empresa</option>'+
    '<option value="website">Convidar para visitar meu site</option>'+
    '<option value="contact">Mostrar como entrar em contato</option></select>'+
    '<button type="button" class="secondary small" onclick="tamaoAdsCampaignUseModel(document.getElementById(\'sponsor-ad-template\').value)">Preencher modelo para revisar</button>'+
    '<small>O modelo usa apenas o nome informado. Confira e edite antes de enviar.</small></div>'+
    '<label class="input-wrap">Mensagem do anúncio (20 a 240 caracteres)'+
    '<textarea id="sponsor-ad-copy" class="input" oninput="tamaoAdsUpdateCreativePreview()" maxlength="240" rows="3" placeholder="Explique claramente o que sua empresa oferece." required>'+
       tamaoAdsPublicDemoCreative('copy')+'</textarea></label>'+
    '<label class="input-wrap">Site oficial do anúncio (HTTPS)'+
    '<input id="sponsor-ad-url" class="input" oninput="tamaoAdsUpdateCreativePreview()" inputmode="url" maxlength="300" placeholder="https://suaempresa.com.br" required></label>'+
    '<section class="sponsor-creative-preview-panel" aria-label="Veja seu anúncio antes de enviar">'+
    '<div class="sponsor-creative-preview-copy"><span class="section-kicker">VEJA SUA PEÇA GANHAR FORMA</span><h3>Uma prévia do que o público poderá conhecer.</h3><p>Altere o texto acima e veja a apresentação atualizar aqui. Antes de aparecer para visitantes, sua campanha precisa de revisão e aprovação.</p></div>'+
    '<div class="sponsor-creative-preview-ad">'+
      '<span>PUBLICIDADE · PRÉVIA PRIVADA</span>'+
      '<small id="sponsor-creative-brand">Nome da sua empresa</small>'+
      '<strong id="sponsor-creative-title">Seu título aparecerá aqui</strong>'+
      '<p id="sponsor-creative-message">Descreva brevemente o que sua empresa oferece.</p>'+
      '<div class="sponsor-creative-preview-bottom"><small id="sponsor-creative-domain">Seu site oficial</small><span>Conhecer o anunciante ↗</span></div>'+
    '</div>'+
    '<small class="sponsor-creative-preview-note">A prévia é particular e não é registrada como impressão ou anúncio publicado. Texto e link passam por revisão antes da ativação.</small>'+
    '</section>'+
    '<p class="tiny muted">Cidade, UF, prazo e orçamento são os mesmos selecionados na simulação acima.</p>'+
    '<label class="check-row"><input type="checkbox" id="sponsor-ad-terms">'+
    '<span>Confirmo que represento a empresa e autorizo a revisão da peça. A veiculação está sujeita a aprovação; não há venda ou Pix nesta etapa.</span></label>'+
    '<button id="sponsor-ad-submit" class="primary" type="button" onclick="tamaoAdsSubmitCampaign()" '+
      (tamaoAdsDraftBusy?'disabled':'')+'>Enviar campanha para revisão →</button>'+
    '<p id="sponsor-ad-result" role="status" aria-live="polite"></p>'+
    '</div><div class="section-head"><div><h3>Minhas campanhas</h3></div>'+
    '<button type="button" class="secondary small" onclick="tamaoAdsMyRefresh()">Atualizar</button></div>'+
    (mine?'<div class="grid cards-2">'+mine+'</div>':
      '<p class="muted">Use Atualizar para acompanhar as suas propostas.</p>')+
    '</section>';
}
async function tamaoAdsSubmitCampaign(){
  const scope=tamaoAdsSyncOwner(),same=()=>tamaoAdsSessionMatches(scope);
  if(tamaoAdsDraftBusy)return;
  if(!tamaoAdsAccountVerified())return toast('Confirme o e-mail antes de enviar.');
  const val=id=>String(document.getElementById(id)?.value||'').trim();
  const advertiser=val('sponsor-ad-company'),title=val('sponsor-ad-title'),
    description=val('sponsor-ad-copy'),city=val('sponsor-cpm-city'),
    state=val('sponsor-cpm-state').toUpperCase(),
    destination=val('sponsor-ad-url');
  const budgetCents=Number(val('sponsor-cpm-budget'));
  const durationDays=Number(val('sponsor-cpm-days'));
  const allowedFixed=durationDays===tamaoAdsFixedDays(budgetCents);
  const result=document.getElementById('sponsor-ad-result');
  const button=document.getElementById('sponsor-ad-submit');
  if(!document.getElementById('sponsor-ad-terms')?.checked)
    return toast('Confirme que representa a empresa.');
  if(advertiser.length<2||title.length<12||description.length<20||city.length<2||
    !/^[A-Z]{2}$/.test(state)||!/^https:\/\//.test(destination)||!tamaoAdsBudgetPreview(budgetCents)||
    ![7,15,30].includes(durationDays)||!allowedFixed)
    return toast('Revise a empresa, título, mensagem, cidade, link HTTPS e orçamento.');
  if(!tamaoAdsDraftRequestId)tamaoAdsDraftRequestId=crypto.randomUUID();
  tamaoAdsDraftBusy=true;
  if(button)button.disabled=true;
  if(result)result.textContent='Enviando para análise…';
  try{
    const reply=await liveInvoke('ads-independent',{
      action:'submit',requestId:tamaoAdsDraftRequestId,advertiser,title,
      description,city,state,destination,budgetCents,durationDays
    });
    if(!same())return;
    if(reply?.source!=='ads_independent_submit_v1_884'||reply?.paymentCreated!==false)
      throw Error('Não foi possível confirmar o cadastro do anúncio.');
    tamaoAdsDraftRequestId=null;
    if(result)result.textContent='Campanha recebida. Nenhuma cobrança foi gerada.';
    toast('Campanha enviada para análise sem cobrança.');
    await tamaoAdsMyRefresh({quiet:true});
  }catch(e){if(same()&&result)result.textContent=String(e?.message||'Falha ao enviar. Tente novamente.')}
  finally{if(same()){tamaoAdsDraftBusy=false;if(button)button.disabled=false}}
}
// V1.946: returning from Mercado Pago already points to #sponsors.
// Recheck the advertiser's ORIGINAL checkout without requiring a new click.
// Only the provider-authoritative reconcile RPC and a SECOND owner-scoped
// ledger read can label a payment approved. Never create a checkout here.
// Three bounded attempts (1.2s, +3m, +6m) stay inside 8/hour API quota.
const tamaoAdsAutoPayment={userId:null,campaignId:null,tries:0,epoch:0,
 startedAt:0,timer:null,busy:false};
function tamaoAdsAutoPaymentStop(){
 ++tamaoAdsAutoPayment.epoch;
 if(tamaoAdsAutoPayment.timer!=null&&typeof clearTimeout==='function')
  clearTimeout(tamaoAdsAutoPayment.timer);
 tamaoAdsAutoPayment.timer=null;
 tamaoAdsAutoPayment.userId=null;
 tamaoAdsAutoPayment.campaignId=null;
 tamaoAdsAutoPayment.tries=0;
 tamaoAdsAutoPayment.busy=false;
}
function tamaoAdsAutoReconcileOnReturn(userId){
 if(!tamaoAdsAccountVerified()||route()!=='sponsors'||
   String(globalThis.liveRuntime?.session?.user?.id||'')!==userId){
  tamaoAdsAutoPaymentStop();return;
 }
 const match=(tamaoAdsMyState.rows||[]).find(c=>
   c.status==='approved'&&c.fixedFeeStatus==='checkout_ready'&&
   /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(c.id||'')));
 if(!match){tamaoAdsAutoPaymentStop();return}
 if(tamaoAdsAutoPayment.userId===userId&&
   tamaoAdsAutoPayment.campaignId===match.id)return;
 tamaoAdsAutoPaymentStop();
 Object.assign(tamaoAdsAutoPayment,{
  userId,campaignId:match.id,tries:0,startedAt:Date.now(),busy:false
 });
 const epoch=tamaoAdsAutoPayment.epoch,scope=tamaoAdsSessionScope();
 const current=()=>tamaoAdsAutoPayment.epoch===epoch;
 const same=()=>current()&&tamaoAdsSessionMatches(scope)&&tamaoAdsAutoPayment.userId===userId&&
   tamaoAdsAutoPayment.campaignId===match.id&&
   String(globalThis.liveRuntime?.session?.user?.id||'')===userId&&
   tamaoAdsAccountVerified()&&route()==='sponsors';
 const poll=async()=>{
  if(!current())return;
  tamaoAdsAutoPayment.timer=null;
  if(!same()||tamaoAdsAutoPayment.tries>=3||
    Date.now()-tamaoAdsAutoPayment.startedAt>900000){
   if(current())tamaoAdsAutoPaymentStop();return;
  }
  if(document.visibilityState==='hidden'){
   tamaoAdsAutoPayment.timer=setTimeout(poll,180000);return;
  }
  tamaoAdsAutoPayment.tries++;
  tamaoAdsAutoPayment.busy=true;
  try{
   const result=await liveInvoke('ads-independent-checkout',{
    action:'reconcile',campaignId:match.id
   });
   if(!same())return;
   if(result?.source==='ads_independent_reconcile_v1_886'&&
     (result.status==='payment_reversed'||
      (result.status==='payment_approved'&&result.paymentApproved===true))){
    // Never rely only on the PSP response or browser query string.
    const applied=await tamaoAdsMyRefresh({quiet:true,autoReconcile:false});
    if(!same())return;
    const campaign=tamaoAdsMyState.rows.find(x=>x.id===match.id);
    if(applied===true&&campaign?.fixedFeeStatus===result.status){
     tamaoAdsAutoPaymentStop();
     toast(tamaoAdsPaymentText(campaign));
     return;
    }
   }
  }catch{/* An unverified reply cannot create payment or change campaign status. */}
  finally{if(current())tamaoAdsAutoPayment.busy=false}
  if(same()&&tamaoAdsAutoPayment.tries<3)
   tamaoAdsAutoPayment.timer=setTimeout(poll,180000);
  else if(current())tamaoAdsAutoPaymentStop();
 };
 tamaoAdsAutoPayment.timer=setTimeout(poll,1200);
}
async function tamaoAdsMyRefresh({quiet=false,autoReconcile=true}={}){
  const scope=tamaoAdsSyncOwner(),userId=scope.userId;
  if(!tamaoAdsSessionMatches(scope))return false;
  const seq=++tamaoAdsMyReadSeq;
  const same=()=>seq===tamaoAdsMyReadSeq&&tamaoAdsSessionMatches(scope);
  try{
    const r=await liveInvoke('ads-independent',{action:'mine'});
    if(r?.source!=='ads_independent_mine_v1_884'||r?.noCharge!==true||!Array.isArray(r.rows))
      throw Error('Consulta não confirmada.');
    if(!same())return false;
    tamaoAdsMyState={userId,authGeneration:scope.generation,rows:r.rows.slice(0,30),status:'ready',
      fixedFeeSalesEnabled:r.fixedFeeSalesEnabled===true,
      homologationCampaignId:String(r.homologationCampaignId||'')||null,
      homologationExpiresAt:String(r.homologationExpiresAt||'')||null};
    if(!quiet)toast('Campanhas atualizadas.');
    if(route()==='sponsors')render();
    if(autoReconcile)tamaoAdsAutoReconcileOnReturn(userId);return true;
  }catch(e){if(same()&&!quiet)toast(String(e?.message||'Não foi possível consultar as campanhas.'));return false;}
}

async function tamaoAdsCopyPix(campaignId){
 const scope=tamaoAdsSyncOwner(),actor=scope.userId;
 if(!tamaoAdsSessionMatches(scope))return false;
 if(await tamaoAdsMyRefresh({quiet:true})!==true)return false;
 if(!tamaoAdsSessionMatches(scope)||tamaoAdsMyState.userId!==actor)return false;
 const row=tamaoAdsMyState.rows.find(r=>r.id===campaignId);
 if(row?.fixedFeeStatus!=='checkout_ready'||row.fixedFeePixPayable!==true||
    Date.parse(String(row.fixedFeePixExpiresAt||''))<=Date.now()+60000)return false;
 try{await navigator.clipboard.writeText(row.fixedFeePixCode);toast('Código Pix copiado.');return true}
 catch{toast('Selecione o código Pix acima e copie.');return false}
}

async function tamaoAdsBuyCampaign(campaignId){
 const scope=tamaoAdsSyncOwner(),same=()=>tamaoAdsSessionMatches(scope);
 if(tamaoAdsPurchaseBusy)return;
 if(!tamaoAdsAccountVerified())return toast('Confirme seu e-mail antes de contratar.');
 if(!/^[0-9a-f-]{36}$/i.test(campaignId))return toast('Campanha inválida.');
 if(!document.getElementById('ads-fixed-consent-'+campaignId)?.checked)
  return toast('Leia e aceite o preço e as condições antes do pagamento.');
 tamaoAdsPurchaseBusy=true;
 try{
  if(typeof globalThis.tamaoAdsPurchaseCampaign!=='function'){
   if(!tamaoAdsPurchaseScriptPromise){
    const src=document.querySelector('script[src*="ads-planner.js"]')?.src||location.origin+'/js/ads-planner.js';
    tamaoAdsPurchaseScriptPromise=new Promise((resolve,reject)=>{
     const tag=document.createElement('script');
     tag.src=new URL('ads-independent-purchase.js'+new URL(src).search,src).href;
     tag.onload=resolve;
     tag.onerror=()=>reject(Error('Não foi possível abrir o pagamento.'));
     document.head.append(tag);
    });
   }
   await tamaoAdsPurchaseScriptPromise;
  }
  if(!same())return;
  if(typeof globalThis.tamaoAdsPurchaseCampaign!=='function')
   throw Error('Pagamento indisponível.');
  await globalThis.tamaoAdsPurchaseCampaign(campaignId);
 }catch(error){
  if(same()){
   tamaoAdsPurchaseScriptPromise=null;
   toast(String(error?.message||'Falha ao iniciar pagamento.'));
  }
 }finally{if(same())tamaoAdsPurchaseBusy=false}
}

async function tamaoAdsRequestRefund(campaignId){
 const scope=tamaoAdsSyncOwner(),same=()=>tamaoAdsSessionMatches(scope);
 if(tamaoAdsRefundBusy)return;
 if(!tamaoAdsAccountVerified())return toast('Entre na sua conta para solicitar reembolso.');
 const text=tamaoAdsRefundReasonText(campaignId);
 if(text.length<12||text.length>500)return toast('Explique a solicitação em 12 a 500 caracteres.');
 if(!tamaoAdsRefundRequestIds.has(campaignId))
  tamaoAdsRefundRequestIds.set(campaignId,crypto.randomUUID());
 tamaoAdsRefundBusy=true;
 try{
  const r=await liveInvoke('ads-independent',{
   action:'refund-request',campaignId,requestId:tamaoAdsRefundRequestIds.get(campaignId),
   reason:text
  });
  if(!same())return;
  if(r?.source!=='ads_independent_refund_request_v1_887'||
    r?.refundIssued!==false||!r.caseId)throw Error('Solicitação não confirmada pelo servidor.');
  toast('Solicitação recebida. A campanha será pausada durante a análise.');
  await tamaoAdsMyRefresh({quiet:true});
 }catch(e){if(same())toast(String(e?.message||'Não foi possível registrar o pedido.'))}
 finally{if(same())tamaoAdsRefundBusy=false}
}

async function tamaoAdsVerifyPayment(campaignId){
 tamaoAdsSyncOwner();
 if(tamaoAdsPurchaseBusy)return;
 if(!tamaoAdsAccountVerified())return toast('Entre na conta antes de consultar.');
 const scope=tamaoAdsSessionScope(),same=()=>tamaoAdsSessionMatches(scope);
 tamaoAdsPurchaseBusy=true;
 render();
 try{
  if(typeof globalThis.tamaoAdsReconcileCampaign!=='function'){
   if(!tamaoAdsPurchaseScriptPromise){
    const src=document.querySelector('script[src*="ads-planner.js"]')?.src||location.origin+'/js/ads-planner.js';
    tamaoAdsPurchaseScriptPromise=new Promise((resolve,reject)=>{
     const script=document.createElement('script');
     script.src=new URL('ads-independent-purchase.js'+new URL(src).search,src).href;
     script.onload=resolve;
     script.onerror=()=>reject(Error('Falha ao carregar a consulta de pagamento.'));
     document.head.append(script);
    });
   }
   await tamaoAdsPurchaseScriptPromise;
  }
  if(!same())return;
  if(typeof globalThis.tamaoAdsReconcileCampaign!=='function')
   throw Error('Consulta de pagamento não disponível.');
  const result=await globalThis.tamaoAdsReconcileCampaign(campaignId);
  if(!same()||!result)return;
  const applied=await tamaoAdsMyRefresh({quiet:true});
  if(!same())return;
  if(applied!==true)throw Error('A consulta não atualizou o histórico. Confira a campanha antes de repetir.');
  const campaign=tamaoAdsMyState.rows.find(c=>c.id===campaignId);
  if(['payment_approved','payment_reversed'].includes(result.status)){
   if(campaign?.fixedFeeStatus!==result.status||
     (result.status==='payment_approved'&&result.paymentApproved!==true))
    throw Error('O provedor e o histórico ainda precisam de conciliação. Atualize a campanha antes de repetir.');
   toast(tamaoAdsPaymentText(campaign));
  }else toast('A confirmação do pagamento ainda não foi localizada no provedor.');
 }catch(e){
  if(same()){
   tamaoAdsPurchaseScriptPromise=null;
   toast(String(e?.message||'Não foi possível conferir o pagamento.'));
  }
 }finally{if(same()){tamaoAdsPurchaseBusy=false;render()}}
}

async function tamaoAdsShowCityPublic(){
 const city=String(document.getElementById('sponsor-cpm-city')?.value||'').trim();
 const state=String(document.getElementById('sponsor-cpm-state')?.value||'').trim().toUpperCase();
 if(city.length<2||!/^[A-Z]{2}$/.test(state))return toast('Informe cidade e UF para consultar a publicidade local.');
 if(typeof globalThis.tamaoAdsDisplaySlot!=='function'){
  if(!globalThis.tamaoAdsPublicScriptLoading){
   globalThis.tamaoAdsPublicScriptLoading=true;
   const src=document.querySelector('script[src*="ads-planner.js"]')?.src||location.origin+'/js/ads-planner.js';
   const t=document.createElement('script');
   t.src=new URL('ads-display.js'+new URL(src).search,src).href;
   t.onerror=()=>{globalThis.tamaoAdsPublicScriptLoading=false;toast('Não foi possível consultar a publicidade agora.')};
   t.onload=()=>globalThis.tamaoAdsDisplaySlot?.(city,state,'sponsor-ad-live-slot');
   document.head.append(t);
  }
  return;
 }
 globalThis.tamaoAdsDisplaySlot(city,state,'sponsor-ad-live-slot');
}

function tamaoAdsLoadHome(){
 if(globalThis.tamaoAdsDisplayHome){
  setTimeout(()=>globalThis.tamaoAdsDisplayHome(),0);return;
 }
 if(globalThis.tamaoAdsHomeScript)return;
 globalThis.tamaoAdsHomeScript=true;
 const t=document.createElement('script');
 const src=document.querySelector('script[src*="ads-planner.js"]')?.src||location.href;
 t.src=new URL('ads-display.js'+new URL(src).search,src).href;
 t.onload=()=>globalThis.tamaoAdsDisplayHome?.();
 t.onerror=()=>{globalThis.tamaoAdsHomeScript=false};
 document.head.append(t);
}
if(globalThis.route?.()==='home')tamaoAdsLoadHome();
