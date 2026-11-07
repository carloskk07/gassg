// V1.883 — budget preview, not a charge or promised inventory.
// CPM candidate: R$12 per 1,000 independently verified display views.
const TAMAO_ADS_PROPOSED_CPM_CENTS=1200;
const TAMAO_ADS_PREVIEW_BUDGETS=[1990,4990,9990,19990];
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
  if(tamaoAdsMyState?.fixedFeeSalesEnabled===true){
    const duration=budget===1990?7:budget===4990?15:30;
    const selector=document.getElementById('sponsor-cpm-days');
    if(selector)selector.value=String(duration);
  }
  const quote=tamaoAdsBudgetPreview(budget);
  const node=document.getElementById('sponsor-cpm-result');
  if(!node)return;
  if(!quote){node.textContent='Selecione um orçamento válido.';return}
  const count=quote.maxViewableImpressions.toLocaleString('pt-BR');
  node.textContent='Equivalência do teto: até '+count+
    ' visualizações verificadas se houver público suficiente. Sem garantia de entrega ou cobrança nesta etapa.';
}
function tamaoAdsBudgetRequest(){
  const quote=tamaoAdsBudgetPreview(Number(document.getElementById('sponsor-cpm-budget')?.value));
  if(!quote)return;
  const city=String(document.getElementById('sponsor-cpm-city')?.value||'').trim().replace(/\s+/g,' ').slice(0,80);
  const state=String(document.getElementById('sponsor-cpm-state')?.value||'RS').trim().toUpperCase();
  const days=Number(document.getElementById('sponsor-cpm-days')?.value);
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
function tamaoAdsPlannerSection(){
  const preset=tamaoAdsBudgetPreview(4990);
  const fixedSales=tamaoAdsMyState?.fixedFeeSalesEnabled===true;
  const options=TAMAO_ADS_PREVIEW_BUDGETS.map(v=>
    '<option value="'+v+'"'+(v===4990?' selected':'')+'>'+tamaoAdsFormatMoney(v)+'</option>').join('');
  return '<section class="section" aria-label="Planejar uma campanha publicitária sem compromisso">'+
    '<div class="section-head"><div><span class="section-kicker">PLANEJE SUA DIVULGAÇÃO</span>'+
    '<h2>'+(fixedSales?'Divulgue sua marca com preço e prazo definidos.':
      'Um orçamento claro, sem pagar por visualizações inventadas.')+'</h2>'+
    '<p>Publicidade regional é independente de cadastrar uma revenda. Estime seu teto de investimento e peça uma proposta.</p></div></div>'+
    '<div class="card flat form-stack" style="max-width:780px">'+
    '<div class="merchant-kpis"><div class="kpi"><span class="label">CPM em avaliação</span><strong>R$ 12,00</strong><small>por 1.000 visualizações verificadas</small></div>'+
    '<div class="kpi"><span class="label">Cobrança agora</span><strong>R$ 0,00</strong><small>exibições comerciais ainda não habilitadas</small></div></div>'+
    '<div class="field-row">'+
    '<div class="input-wrap"><label for="sponsor-cpm-budget">'+
       (fixedSales?'Preço fixo do pacote':'Teto de investimento')+'</label><select id="sponsor-cpm-budget" class="input" onchange="tamaoAdsBudgetQuote()">'+options+'</select></div>'+
    '<div class="input-wrap"><label for="sponsor-cpm-days">Prazo desejado</label><select id="sponsor-cpm-days" class="input" '+
      (fixedSales?'disabled aria-label="Prazo definido pelo pacote"':'')+
      '><option value="7">7 dias</option><option value="15" '+(fixedSales?'selected':'')+'>15 dias</option><option value="30" '+(!fixedSales?'selected':'')+'>30 dias</option></select></div></div>'+
    '<div class="field-row">'+
    '<div class="input-wrap"><label for="sponsor-cpm-city">Cidade <small>(opcional)</small></label><input id="sponsor-cpm-city" class="input" maxlength="80" autocomplete="address-level2" placeholder="Ex.: São Gabriel"></div>'+
    '<div class="input-wrap"><label for="sponsor-cpm-state">Estado (UF)</label><input id="sponsor-cpm-state" class="input" maxlength="2" value="RS" autocomplete="address-level1" aria-describedby="sponsor-cpm-note"></div></div>'+
    '<p id="sponsor-cpm-result" role="status" aria-live="polite">Equivalência do teto: até '+
    preset.maxViewableImpressions.toLocaleString('pt-BR')+
    ' visualizações verificadas se houver público suficiente. Sem garantia de entrega ou cobrança nesta etapa.</p>'+
    '<p id="sponsor-cpm-note" class="tiny muted">Uma visualização exigirá pelo menos 50% do anúncio visível durante 1 segundo contínuo, além de filtros contra tráfego inválido. A estimativa não é reserva nem garantia de público; somente condições verificadas poderão gerar contrato e cobrança.</p>'+
    '<button type="button" class="primary" onclick="tamaoAdsBudgetRequest()">Solicitar proposta sem pagar →</button>'+
    '<button type="button" class="secondary" onclick="tamaoAdsShowCityPublic()">Ver publicidade ativa nesta cidade</button>'+
    '<div id="sponsor-ad-live-slot" class="section" aria-label="Anúncio patrocinado disponível na região"></div>'+
    '</div></section>'+tamaoAdsCampaignForm();
}


// V1.884: independent advertiser intake with verified email; never charges.
let tamaoAdsDraftRequestId=null;
let tamaoAdsDraftBusy=false;
let tamaoAdsMyState={userId:null,rows:[],status:'idle',fixedFeeSalesEnabled:false};
let tamaoAdsPurchaseBusy=false;
let tamaoAdsPurchaseScriptPromise=null;
function tamaoAdsAccountVerified(){
  const u=globalThis.liveRuntime?.session?.user;
  return globalThis.liveReady?.()===true&&u?.id&&u.is_anonymous!==true&&!!u.email_confirmed_at;
}
async function tamaoAdsAccountStart(){
  const email=String(document.getElementById('sponsor-account-email')?.value||'').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return toast('Informe um e-mail válido.');
  try{
    const r=await liveUpgradeAccount(email);
    toast(r?.alreadyPermanent?'Conta confirmada.':'Enviamos a confirmação para seu e-mail.');
    render();
  }catch(e){toast(String(e?.message||'Não foi possível confirmar o e-mail.'))}
}
function tamaoAdsCampaignForm(){
  if(!tamaoAdsAccountVerified())
    return '<section class="section"><div class="section-head"><div>'+
      '<span class="section-kicker">PUBLIQUE COM SEGURANÇA</span>'+
      '<h2>Envie seu anúncio para revisão.</h2><p>Use um e-mail confirmado. A proposta e o anúncio não geram cobrança.</p></div></div>'+
      '<div class="card flat" style="max-width:650px">'+
      '<label for="sponsor-account-email">Seu e-mail</label>'+
      '<input id="sponsor-account-email" class="input" autocomplete="email" type="email" maxlength="160" placeholder="voce@empresa.com.br">'+
      '<button type="button" class="secondary" onclick="tamaoAdsAccountStart()">Confirmar meu e-mail</button></div></section>';
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
      const canBuy=s.fixedFeeSalesEnabled===true&&c.status==='approved'&&validPlan&&
        (bought===''||bought==='checkout_ready');
      const payment=bought==='payment_approved'?'Pagamento aprovado pelo provedor; aguarda publicação.':
        bought==='payment_reversed'?'Pagamento revertido; anúncio pausado.':
        bought==='reserved'?'Checkout em verificação. Não faça outra cobrança.':
        bought==='checkout_ready'?'Pagamento ainda não confirmado.':'';
      const checkPayment=bought&&bought!=='payment_reversed'?
        '<button type="button" class="secondary small" onclick="tamaoAdsVerifyPayment(\\''+id+'\\')">'+
        'Verificar pagamento</button>':'';
      const buy=canBuy?'<div class="card flat">'+
        '<p><strong>Veiculação por prazo fixo:</strong> '+tamaoAdsFormatMoney(fee)+
        ' por '+days+' dias, nesta cidade. Não há garantia de visualizações e não é cobrança por CPM.</p>'+
        '<label class="check-row"><input type="checkbox" id="ads-fixed-consent-'+id+'">'+
        '<span>Concordo com o preço fixo, prazo e condições de publicidade. O pagamento não publica o anúncio automaticamente.</span></label>'+
        '<button type="button" class="primary" onclick="tamaoAdsBuyCampaign(\''+id+'\')" '+
        (tamaoAdsPurchaseBusy?'disabled':'')+'>'+
        (bought==='checkout_ready'?'Concluir pagamento':'Contratar veiculação')+'</button></div>':'';
      return '<article class="card flat"><strong>'+esc(String(c.title))+'</strong>'+
        '<p>'+esc(String(c.city))+'/'+esc(String(c.state))+' · '+
        esc(String(c.effectiveStatus||c.status))+' · '+Number(c.reportedViewSignals||0)+' sinais de visibilidade</p>'+
        '<p>Prazo: '+(c.runEndsAt?esc(String(c.runEndsAt).slice(0,10)):'aguardando publicação')+'</p>'+
        '<p>Preço cadastrado: '+tamaoAdsFormatMoney(fee)+' por '+days+' dias</p>'+
        (payment?'<p role="status">'+esc(payment)+'</p>':'')+
        '<small>Impressões faturáveis por CPM: 0. Receita exibida ao anunciante: não se aplica.</small>'+
        buy+checkPayment+'</article>';
    }).join(''):'';
  return '<section class="section" aria-label="Cadastrar anúncio sem revenda">'+
    '<div class="section-head"><div><span class="section-kicker">ANUNCIANTE INDEPENDENTE</span>'+
    '<h2>Envie a peça para análise.</h2>'+
    '<p>Sem revenda, sem cobrança antecipada. O anúncio só será exibido após revisão e autorização de entrega.</p></div></div>'+
    '<div class="card flat form-stack" style="max-width:780px">'+
    '<div class="field-row"><label class="input-wrap">Empresa'+
    '<input id="sponsor-ad-company" class="input" maxlength="120" autocomplete="organization" required></label>'+
    '<label class="input-wrap">Título da campanha'+
    '<input id="sponsor-ad-title" class="input" maxlength="80" placeholder="Apresente sua marca na cidade" required></label></div>'+
    '<label class="input-wrap">Mensagem do anúncio (20 a 240 caracteres)'+
    '<textarea id="sponsor-ad-copy" class="input" maxlength="240" rows="3" placeholder="Explique claramente o que sua empresa oferece." required></textarea></label>'+
    '<label class="input-wrap">Site oficial do anúncio (HTTPS)'+
    '<input id="sponsor-ad-url" class="input" inputmode="url" maxlength="300" placeholder="https://suaempresa.com.br" required></label>'+
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
  if(tamaoAdsDraftBusy)return;
  if(!tamaoAdsAccountVerified())return toast('Confirme o e-mail antes de enviar.');
  const val=id=>String(document.getElementById(id)?.value||'').trim();
  const advertiser=val('sponsor-ad-company'),title=val('sponsor-ad-title'),
    description=val('sponsor-ad-copy'),city=val('sponsor-cpm-city'),
    state=val('sponsor-cpm-state').toUpperCase(),
    destination=val('sponsor-ad-url');
  const budgetCents=Number(val('sponsor-cpm-budget'));
  const durationDays=Number(val('sponsor-cpm-days'));
  const allowedFixed=(budgetCents===1990&&durationDays===7)||
    (budgetCents===4990&&durationDays===15)||
    (budgetCents===9990&&durationDays===30)||(budgetCents===19990&&durationDays===30);
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
    if(reply?.source!=='ads_independent_submit_v1_884'||reply?.paymentCreated!==false)
      throw Error('Não foi possível confirmar o cadastro do anúncio.');
    tamaoAdsDraftRequestId=null;
    if(result)result.textContent='Campanha recebida. Nenhuma cobrança foi gerada.';
    toast('Campanha enviada para análise sem cobrança.');
    await tamaoAdsMyRefresh({quiet:true});
  }catch(e){if(result)result.textContent=String(e?.message||'Falha ao enviar. Tente novamente.')}
  finally{tamaoAdsDraftBusy=false;if(button)button.disabled=false}
}
async function tamaoAdsMyRefresh({quiet=false}={}){
  const userId=String(globalThis.liveRuntime?.session?.user?.id||'');
  if(!tamaoAdsAccountVerified())return;
  try{
    const r=await liveInvoke('ads-independent',{action:'mine'});
    if(r?.source!=='ads_independent_mine_v1_884'||r?.noCharge!==true||!Array.isArray(r.rows))
      throw Error('Consulta não confirmada.');
    if(userId!==String(globalThis.liveRuntime?.session?.user?.id||''))return;
    tamaoAdsMyState={userId,rows:r.rows.slice(0,30),status:'ready',
      fixedFeeSalesEnabled:r.fixedFeeSalesEnabled===true};
    if(!quiet)toast('Campanhas atualizadas.');
    if(route()==='sponsors')render();
  }catch(e){if(!quiet)toast(String(e?.message||'Não foi possível consultar as campanhas.'))}
}

async function tamaoAdsBuyCampaign(campaignId){
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
  if(typeof globalThis.tamaoAdsPurchaseCampaign!=='function')
   throw Error('Pagamento indisponível.');
  await globalThis.tamaoAdsPurchaseCampaign(campaignId);
 }catch(error){
  tamaoAdsPurchaseScriptPromise=null;
  toast(String(error?.message||'Falha ao iniciar pagamento.'));
 }finally{tamaoAdsPurchaseBusy=false}
}

async function tamaoAdsVerifyPayment(campaignId){
 if(tamaoAdsPurchaseBusy)return;
 if(!tamaoAdsAccountVerified())return toast('Entre na conta antes de consultar.');
 tamaoAdsPurchaseBusy=true;
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
  if(typeof globalThis.tamaoAdsReconcileCampaign!=='function')
   throw Error('Consulta de pagamento não disponível.');
  await globalThis.tamaoAdsReconcileCampaign(campaignId);
  await tamaoAdsMyRefresh({quiet:true});
 }catch(e){
  tamaoAdsPurchaseScriptPromise=null;
  toast(String(e?.message||'Não foi possível conferir o pagamento.'));
 }finally{tamaoAdsPurchaseBusy=false}
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
