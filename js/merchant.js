// TAMÃO Ads V1.233 — private creative proposals, never served as paid placement.
function merchantAdsCampaignSection(merchant){
  if(!['owner','manager'].includes(String(merchant?.memberRole||'')))return '';
  const rt=globalThis.merchantRuntime||{};
  const id=String(merchant?.merchantId||'');
  const packet=rt.adsCampaign?.merchantId===id&&rt.adsCampaign.source==='merchant_ads_campaign_v1_233'&&
    rt.adsCampaign.noCharge===true&&rt.adsCampaign.adsLive===false?rt.adsCampaign:null;
  const c=packet?.campaign||null;
  const statusLabels={draft:'Rascunho',submitted:'Enviada para revisão',
    approved_creative:'Peça revisada • não publicada',needs_changes:'Ajustes solicitados',
    withdrawn:'Retirada'};
  const canEdit=!c||['draft','needs_changes','withdrawn'].includes(c.status);
  const categories=[['all','Toda a revenda'],['glp','Gás'],['water','Água'],
    ['ice','Gelo'],['barbecue','Churrasco e carvão']];
  const rows=categories.map(x=>'<option value="'+x[0]+'" '+
    (x[0]===(c?.category_key||'all')?'selected':'')+'>'+esc(x[1])+'</option>').join('');
  const controls=canEdit?'<div class="form-stack">'+
    '<div class="input-wrap"><label for="ads-campaign-title">Título da divulgação</label>'+
    '<input class="input" id="ads-campaign-title" maxlength="80" placeholder="Ex.: Sua revenda mais perto de você" value="'+esc(c?.title||'')+'"/></div>'+
    '<div class="input-wrap"><label for="ads-campaign-description">Apresentação</label>'+
    '<textarea class="input" id="ads-campaign-description" rows="3" maxlength="240" placeholder="Conte como sua revenda atende os clientes, sem prometer preço ou prazo não confirmado.">'+esc(c?.description||'')+'</textarea></div>'+
    '<div class="input-wrap"><label for="ads-campaign-category">Categoria de interesse</label>'+
    '<select class="input" id="ads-campaign-category">'+rows+'</select></div>'+
    '<div class="order-actions">'+
      '<button class="secondary small" onclick="merchantAdsCampaignAct(\'save\')" type="button">Salvar rascunho</button>'+
      (c?.status==='draft'?'<button class="primary small" onclick="merchantAdsCampaignAct(\'submit\')" type="button">Enviar para revisão</button>':'')+
    '</div></div>':
    '<div class="card flat"><strong>'+esc(c?.title||'')+'</strong><p class="muted">'+
      esc(c?.description||'')+'</p></div>';
  return '<section class="section merchant-ads-campaigns" id="merchant-ads-campaigns">'+
    '<div class="section-head"><div><span class="section-kicker">TAMÃO ADS • CAMPANHAS</span>'+
    '<h2>Prepare a apresentação da sua revenda</h2>'+
    '<p>Crie uma proposta para análise. Não há anúncio publicado, cobrança ou destaque na busca.</p></div>'+
    '<button type="button" class="secondary small" onclick="merchantAdsCampaignAct(\'view\')">Consultar proposta</button></div>'+
    '<div class="card flat">'+
    (c?'<p class="tiny"><strong>'+esc(statusLabels[c.status]||'Em preparação')+'</strong>'+
      ' • '+esc([c.target_city,c.target_state].filter(Boolean).join('/'))+
      ' • versão '+Number(c.version||1)+'</p>':'<p class="muted tiny">Nenhuma proposta carregada. Você pode começar pelo rascunho.</p>')+
    (c?.review_note?'<div class="notice">'+esc(c.review_note)+'</div>':'')+
    controls+
    (c&&['draft','submitted','approved_creative','needs_changes'].includes(c.status)?
      '<div class="order-actions" style="margin-top:10px">'+
      '<button class="ghost small" type="button" onclick="merchantAdsCampaignAct(\'withdraw\')">Retirar proposta</button></div>':'')+
    (rt.adsCampaignError?'<div class="notice danger">'+esc(rt.adsCampaignError)+'</div>':'')+
    '<p class="tiny muted">A revisão não contrata nem veicula publicidade. '+
    'Para enviar, é preciso ter interesse registrado, revenda ativa e catálogo compatível. '+
    'Preço e prazo de entrega permanecem definidos pelo sistema de pedidos.</p>'+
    '</div></section>';
}
async function merchantAdsCampaignAct(operation){
  const rt=globalThis.merchantRuntime;
  const merchantId=String(rt?.merchant?.merchantId||'');
  if(!merchantId||!['owner','manager'].includes(String(rt?.merchant?.memberRole||'')))
    return toast('Apenas proprietário ou gerente pode preparar campanhas.');
  if(rt.adsCampaignLoading)return;
  const existing=rt.adsCampaign?.merchantId===merchantId?rt.adsCampaign.campaign:null;
  const version=existing?.version||0;
  const payload={action:'ads-campaign',merchantId,operation,version};
  if(operation==='save'){
    payload.title=String(document.getElementById('ads-campaign-title')?.value||'').trim();
    payload.description=String(document.getElementById('ads-campaign-description')?.value||'').trim();
    payload.category=String(document.getElementById('ads-campaign-category')?.value||'all');
    if(payload.title.length<12||payload.title.length>80||
       payload.description.length<30||payload.description.length>240)
      return toast('Título de 12 a 80 caracteres e descrição de 30 a 240 caracteres.');
  }
  if(operation==='submit'&&!existing)return toast('Salve a proposta antes de enviar.');
  if(operation==='submit'&&!confirm('Enviar a peça para análise? Isso não cria anúncio nem cobrança.'))return;
  if(operation==='withdraw'&&!confirm('Retirar a proposta? Isso não cancela qualquer cobrança, pois não há contratação.'))return;
  if(operation!=='view')payload.requestId=crypto.randomUUID();
  rt.adsCampaignLoading=true;rt.adsCampaignError=null;
  try{
    const data=await merchantInvoke('merchant-ops',payload);
    if(data?.source!=='merchant_ads_campaign_v1_233'||data.merchantId!==merchantId||
      data.noCharge!==true||data.adsLive!==false)
      throw new Error('Não foi possível verificar o estado da campanha.');
    if(String(rt.merchant?.merchantId)!==merchantId)return;
    rt.adsCampaign=data;
    if(operation!=='view')toast('Proposta atualizada, sem cobrança ou publicação.');
  }catch(e){
    if(String(rt?.merchant?.merchantId)===merchantId){
      rt.adsCampaignError=String(e?.message||'Não foi possível atualizar a campanha.');
      toast(rt.adsCampaignError);
    }
  }finally{rt.adsCampaignLoading=false;render();}
}
// V1.242 — view negotiated terms and register nonbinding awareness.
function merchantClubeTermsSection(merchant){
  if(!['owner','manager'].includes(String(merchant?.memberRole||'')))return '';
  const rt=globalThis.merchantRuntime||{};
  const id=String(merchant?.merchantId||'');
  const current=rt.clubeTerms?.merchantId===id?rt.clubeTerms:null;
  const cards=[['gas_3x5','Clube Gás'],['water_5x2','Clube Água']].map(([key,title])=>{
    const packet=current?.[key]?.source==='merchant_clube_terms_v1_242'?current[key]:null;
    const t=packet?.terms;
    const status=t?.status==='shared_for_discussion'&&t.current===true;
    const owner=merchant.memberRole==='owner';
    const pending=rt.clubeTermsPending?.[key];
    const safeMoney=n=>'R$ '+(Number(n||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2});
    const copy=status?
      '<div class="form-stack">'+
      '<p class="tiny muted">Participação sugerida da sua revenda: '+
      (Number(t.merchantShareBps)/100).toLocaleString('pt-BR')+
      '% do desconto, até '+safeMoney(t.merchantProposedBudgetCents)+
      ' (não contratado). Marca: '+(Number(t.brandShareBps)/100).toLocaleString('pt-BR')+
      '%, com orçamento sugerido '+safeMoney(t.brandBudgetCents)+
      '. O restante caberia ao TAMÃO, com teto proposto '+safeMoney(t.platformBudgetCents)+
      '. Nenhum custeio está comprovado.</p>'+
      '<p class="tiny muted">Pacotes completos que esses valores poderiam sustentar: <strong>'+
      Number(t.capacity?.maxPackagesIllustrative||0).toLocaleString('pt-BR')+
      '</strong> (simulação, nenhum cupom disponível).</p>'+
      '<p class="tiny muted">Documentos: representação '+esc(t.identityDocumentStatus)+
      ', minuta '+esc(t.agreementDocumentStatus)+
      ', custeio '+esc(t.fundingDocumentStatus)+
      '. Todos ainda dependem de verificação independente.</p>'+
      '<p class="tiny muted">Observações para conversa: '+esc(t.notes||'')+'</p>'+
      '<p class="tiny muted">Sua resposta: '+esc(({none:'Aguardando manifestação',
        read_for_discussion:'Li e quero conversar',not_interested:'Não tenho interesse'})[t.merchantResponse]||'A definir')+'</p>'+
      (owner?'<label class="checkbox-line"><input type="checkbox" id="clube-terms-consent-'+key+
        '"/> Declaro apenas que li a minuta e desejo conversar sobre ela. Esta resposta não é aceite contratual nem autorização de desconto.</label>'+
      '<div class="order-actions">'+
      '<button type="button" class="secondary small" onclick="merchantClubeTermsReplyFromUi(\''+key+'\',\'read_for_discussion\')" '+
      (pending?'disabled':'')+'>Li e quero conversar</button>'+
      '<button type="button" class="ghost small" onclick="merchantClubeTermsReplyFromUi(\''+key+'\',\'not_interested\')" '+
      (pending?'disabled':'')+'>Não tenho interesse</button></div>':'<p class="tiny muted">Somente o titular pode registrar ciência.</p>')+
      '</div>':'<p class="tiny muted">Ainda não há minuta atual compartilhada para negociação.</p>';
    return '<article class="card flat form-stack"><div class="section-head"><div><h3>'+esc(title)+'</h3>'+
    '<p class="tiny muted">Condições comerciais para avaliação — sem compromisso</p></div>'+
    '<button type="button" class="secondary small" onclick="merchantClubeTermsLoadFromUi(\''+key+'\')" '+
    (pending?'disabled':'')+'>Consultar proposta</button></div>'+copy+
    (rt.clubeTermsErrors?.[key]?'<p class="notice danger">'+esc(rt.clubeTermsErrors[key])+'</p>':'')+'</article>';
  }).join('');
  return '<section class="section merchant-clube-terms">'+
   '<div class="section-head"><div><span class="section-kicker">CLUBE TAMÃO • CONVERSA COMERCIAL</span>'+
   '<h2>Condições para avaliar, sem compromisso</h2>'+
   '<p>Confira se há uma minuta preparada para sua revenda. Seu interesse anterior não cria cobrança.</p>'+
   '</div></div><div class="grid cards-2">'+cards+'</div></section>';
}
async function merchantClubeTermsCall(key,operation,extra={}){
  const rt=globalThis.merchantRuntime;
  const merchantId=String(rt?.merchant?.merchantId||'');
  if(!merchantId||!['owner','manager'].includes(String(rt?.merchant?.memberRole||''))||
    !['gas_3x5','water_5x2'].includes(key))return;
  if(rt.clubeTermsPending?.[key])return;
  if(rt.clubeTerms?.merchantId!==merchantId)rt.clubeTerms={merchantId};
  rt.clubeTermsPending??={};
  rt.clubeTermsErrors??={};
  rt.clubeTermsPending[key]=true;
  rt.clubeTermsErrors[key]=null;
  try{
    const result=await merchantInvoke('merchant-ops',{
      action:'clube-terms',merchantId,packageKey:key,operation,...extra});
    if(result?.source!=='merchant_clube_terms_v1_242'||
      result?.merchantId!==merchantId||result?.packageKey!==key||
      result?.readOnly!==(operation==='view')||
      result?.noContract!==true||result?.noCharge!==true||
      result?.fundingVerified!==false||result?.couponSalesEnabled!==false||
      (result.terms!==null&&(
        !Number.isSafeInteger(result.terms.version)||result.terms.version<1||
        !['draft','shared_for_discussion','withdrawn'].includes(result.terms.status))))
      throw new Error('Minuta não confirmada pelo servidor.');
    if(String(rt.merchant?.merchantId)!==merchantId)return;
    rt.clubeTerms[key]=result;
    if(operation!=='view')toast('Manifestação registrada apenas para negociação. Nenhum contrato foi firmado.');
  }catch(e){
    if(String(rt.merchant?.merchantId)===merchantId){
      rt.clubeTermsErrors[key]=String(e?.message||'Não foi possível consultar a minuta.');
      toast(rt.clubeTermsErrors[key]);
    }
  }finally{rt.clubeTermsPending[key]=false;render();}
}
function merchantClubeTermsLoadFromUi(key){
  return merchantClubeTermsCall(key,'view');
}
function merchantClubeTermsReplyFromUi(key,operation){
  const rt=globalThis.merchantRuntime;
  if(rt?.merchant?.memberRole!=='owner')
    return toast('Somente o titular pode registrar a manifestação.');
  const t=rt?.clubeTerms?.[key]?.terms;
  if(!t||!t.current||t.status!=='shared_for_discussion')
    return toast('Consulte a minuta atual antes de responder.');
  if(operation==='read_for_discussion'&&document.getElementById('clube-terms-consent-'+key)?.checked!==true)
    return toast('Confirme que é apenas uma manifestação sem contrato.');
  if(operation==='not_interested'&&!confirm('Registrar que você não deseja negociar esta minuta?'))
    return;
  if(!['read_for_discussion','not_interested'].includes(operation))return;
  return merchantClubeTermsCall(key,operation,{
    version:t.version,requestId:crypto.randomUUID(),
    consent:operation==='read_for_discussion'});
}

// V1.240 — only interest in possible Clube sponsorship, never a funded campaign.
function merchantClubeInterestSection(merchant){
  if(!['owner','manager'].includes(String(merchant?.memberRole||'')))return '';
  const rt=globalThis.merchantRuntime||{};
  const merchantId=String(merchant?.merchantId||'');
  const state=rt.clubeInterest?.merchantId===merchantId?rt.clubeInterest:null;
  const packs=[
    {key:'gas_3x5',title:'Clube Gás',offer:'3 cupons de R$ 5 • validade proposta de 180 dias'},
    {key:'water_5x2',title:'Clube Água',offer:'5 cupons de R$ 2 • validade proposta de 90 dias'}
  ];
  const options=(entries,current)=>entries.map(([k,v])=>
    '<option value="'+k+'"'+(String(current)===String(k)?' selected':'')+'>'+esc(v)+'</option>').join('');
  const cards=packs.map(pack=>{
    const x=state?.[pack.key]?.source==='merchant_clube_interest_v1_240'?
      state[pack.key]:null;
    const busy=rt.clubeInterestPending?.[pack.key]===true;
    const selectedShare=x?.interested?x.merchantShareBps:10000;
    const selectedBudget=x?.interested?x.proposedBudgetCents:10000;
    return '<article class="card flat form-stack" aria-label="'+esc(pack.title)+'">'+
      '<div class="section-head"><div><h3>'+esc(pack.title)+'</h3><p class="tiny muted">'+esc(pack.offer)+'</p></div>'+
      '<span class="status-pill '+(x?.interested?'online':'risk')+'">'+
        (x?.interested?'Interesse registrado':'Ainda não participante')+'</span></div>'+
      '<div class="grid cards-2">'+
      '<div class="input-wrap"><label for="clube-share-'+pack.key+'">Desconto que poderia financiar</label>'+
      '<select class="input" id="clube-share-'+pack.key+'">'+
        options([[10000,'100% do desconto'],[5000,'50% do desconto'],[2500,'25% do desconto']],
         selectedShare)+'</select></div>'+
      '<div class="input-wrap"><label for="clube-budget-'+pack.key+'">Teto total que gostaria de avaliar</label>'+
      '<select class="input" id="clube-budget-'+pack.key+'">'+
        options([[3000,'R$ 30'],[10000,'R$ 100'],[30000,'R$ 300'],[100000,'R$ 1.000']],
         selectedBudget)+'</select></div></div>'+
      '<label class="checkbox-line"><input type="checkbox" id="clube-consent-'+pack.key+'"/>'+
      ' Autorizo registrar essas preferências para contato comercial, sem contrato e sem obrigação financeira.</label>'+
      '<div class="order-actions">'+
      '<button type="button" class="secondary small" onclick="merchantClubeInterestLoadFromUi(\''+pack.key+'\')" '+(busy?'disabled':'')+'>Consultar</button>'+
      '<button type="button" class="primary small" onclick="merchantClubeInterestRegisterFromUi(\''+pack.key+'\')" '+(busy?'disabled':'')+'>Salvar interesse</button>'+
      (x?.interested?'<button type="button" class="ghost small" onclick="merchantClubeInterestWithdrawFromUi(\''+pack.key+'\')" '+(busy?'disabled':'')+'>Retirar interesse</button>':'')+
      '</div>'+
      (x?.interested?'<p class="tiny muted">Intenção para '+esc([x.city,x.state].filter(Boolean).join('/'))+
        '. Não reserva orçamento nem autoriza o TAMÃO a gerar descontos.</p>':'')+
      (rt.clubeInterestErrors?.[pack.key]?'<p class="notice danger">'+
        esc(rt.clubeInterestErrors[pack.key])+'</p>':'')+
      '</article>';
  }).join('');
  return '<section class="section merchant-clube-interest" id="merchant-clube-interest">'+
    '<div class="section-head"><div><span class="section-kicker">CLUBE TAMÃO • PARCERIAS</span>'+
    '<h2>Ajude seus clientes a economizar e voltar a comprar</h2>'+
    '<p>Escolha os benefícios que teria interesse em patrocinar futuramente. A negociação final será feita separadamente.</p></div></div>'+
    '<div class="grid cards-2">'+cards+'</div>'+
    '<p class="tiny muted">Pesquisa sem compromisso: os cupons não estão à venda. Percentuais e valores não constituem autorização de campanha, reserva financeira, promessa de benefício nem mudança no preço dos pedidos.</p>'+
    '</section>';
}
async function merchantClubeInterestCall(packageKey,operation,fields={}){
  const rt=globalThis.merchantRuntime;
  const merchantId=String(rt?.merchant?.merchantId||'');
  if(!merchantId||!['owner','manager'].includes(String(rt?.merchant?.memberRole||'')))
    return toast('Somente proprietário ou gerente pode registrar interesse.');
  if(!['gas_3x5','water_5x2'].includes(packageKey)||rt.clubeInterestPending?.[packageKey])
    return;
  if(rt.clubeInterest?.merchantId!==merchantId)rt.clubeInterest={merchantId};
  const prev=rt.clubeInterest[packageKey];
  rt.clubeInterestPending??={};
  rt.clubeInterestErrors??={};
  rt.clubeInterestPending[packageKey]=true;
  rt.clubeInterestErrors[packageKey]=null;
  try{
    const payload={action:'clube-interest',merchantId,packageKey,operation,...fields};
    if(operation!=='view'){
      payload.expectedVersion=Number.isSafeInteger(prev?.version)?prev.version:0;
      payload.requestId=crypto.randomUUID();
    }
    const data=await merchantInvoke('merchant-ops',payload);
    if(data?.source!=='merchant_clube_interest_v1_240'||
      data?.merchantId!==merchantId||data?.packageKey!==packageKey||
      data?.noCharge!==true||data?.noContract!==true||
      data?.fundingVerified!==false||data?.discountEnabled!==false||
      data?.couponSalesEnabled!==false||data?.noFinancialObligation!==true||
      !Number.isSafeInteger(data?.version)||data.version<0||
      typeof data?.interested!=='boolean')
      throw new Error('Não foi possível confirmar a proposta no servidor.');
    if(String(rt.merchant?.merchantId)!==merchantId)return;
    rt.clubeInterest[packageKey]=data;
    if(operation!=='view')toast(data.interested?
      'Interesse salvo. Nenhuma cobrança ou desconto foi criado.':
      'Interesse retirado. Nenhuma campanha foi ativada.');
  }catch(e){
    if(String(rt.merchant?.merchantId)===merchantId){
      rt.clubeInterestErrors[packageKey]=String(e?.message||
        'Não foi possível atualizar. Consulte a situação antes de tentar novamente.');
      toast(rt.clubeInterestErrors[packageKey]);
    }
  }finally{
    rt.clubeInterestPending[packageKey]=false;render();
  }
}
function merchantClubeInterestLoadFromUi(key){
  return merchantClubeInterestCall(key,'view');
}
function merchantClubeInterestRegisterFromUi(key){
  if(document.getElementById('clube-consent-'+key)?.checked!==true)
    return toast('Confirme o interesse voluntário sem compromisso financeiro.');
  const merchantShareBps=Number(document.getElementById('clube-share-'+key)?.value);
  const budgetCents=Number(document.getElementById('clube-budget-'+key)?.value);
  if(![10000,5000,2500].includes(merchantShareBps)||
    ![3000,10000,30000,100000].includes(budgetCents))
    return toast('Selecione o percentual e o limite de orçamento válidos.');
  return merchantClubeInterestCall(key,'register',{
    merchantShareBps,budgetCents,consent:true
  });
}
function merchantClubeInterestWithdrawFromUi(key){
  if(!confirm('Retirar seu interesse no Clube TAMÃO? Não há contrato ou desconto ativo.'))return;
  return merchantClubeInterestCall(key,'withdraw');
}

// V1.232 — expression of interest, not a purchase of advertising.
function merchantAdsInterestSection(merchant){
  if(!['owner','manager'].includes(String(merchant?.memberRole||'')))return '';
  const rt=globalThis.merchantRuntime||{};
  const id=String(merchant?.merchantId||'');
  const data=rt.adsInterest?.merchantId===id&&
    rt.adsInterest?.source==='merchant_ads_interest_v1_232'&&
    rt.adsInterest?.noCharge===true&&rt.adsInterest?.adsLive===false?rt.adsInterest:null;
  const active=data?.interested===true;
  const status=active?
    '<div class="notice success"><strong>Interesse registrado.</strong> Isso não cria anúncio nem cobrança. Você pode alterar ou retirar a qualquer momento.</div>':
    '<p class="muted tiny">Você pode participar da pesquisa sobre divulgação local. Não há compromisso de compra.</p>';
  const goals=[
    ['new_customers','Conquistar novos clientes'],
    ['local_visibility','Dar mais visibilidade à revenda'],
    ['new_area','Chegar a novas regiões'],
    ['unsure','Quero conhecer as opções']
  ];
  const budgets=[
    ['unsure','Ainda não defini'],
    ['upto_99','Até R$ 99 por mês'],
    ['100_299','R$ 100 a R$ 299 por mês'],
    ['300_999','R$ 300 a R$ 999 por mês'],
    ['1000_plus','R$ 1.000 ou mais por mês']
  ];
  const selected=(value,current)=>value===current?' selected':'';
  return '<section class="section merchant-ads-interest" id="merchant-ads-interest">'+
    '<div class="section-head"><div><span class="section-kicker">TAMÃO ADS</span>'+
    '<h2>Ajude a criar a divulgação ideal para sua revenda</h2>'+
    '<p>Conte como gostaria de alcançar mais clientes na sua cidade.</p></div>'+
    '<button class="ghost small" type="button" onclick="merchantAdsInterestLoadFromUi()" '+
    (rt.adsInterestLoading?'disabled':'')+'>Consultar situação</button></div>'+
    '<div class="card flat">'+status+
    '<div class="grid cards-2" style="margin-top:12px">'+
    '<div class="input-wrap"><label for="merchant-ads-goal">Qual é seu objetivo?</label>'+
    '<select class="input" id="merchant-ads-goal">'+
    goals.map(x=>'<option value="'+x[0]+'"'+selected(x[0],data?.goal||'new_customers')+'>'+esc(x[1])+'</option>').join('')+
    '</select></div>'+
    '<div class="input-wrap"><label for="merchant-ads-budget">Quanto consideraria investir, se o serviço existir?</label>'+
    '<select class="input" id="merchant-ads-budget">'+
    budgets.map(x=>'<option value="'+x[0]+'"'+selected(x[0],data?.budgetBand||'unsure')+'>'+esc(x[1])+'</option>').join('')+
    '</select></div></div>'+
    '<label class="tiny" style="display:flex;align-items:flex-start;gap:8px;margin-top:12px">'+
    '<input id="merchant-ads-consent" type="checkbox" style="margin-top:3px"/>'+
    '<span>Quero registrar o interesse da minha revenda para o TAMÃO avaliar o serviço de publicidade local. '+
    'Entendo que isto não é uma contratação, não gera cobrança e não autoriza anúncio.</span></label>'+
    '<div class="order-actions" style="margin-top:12px">'+
    '<button class="primary small" type="button" onclick="merchantAdsInterestRegisterFromUi()" '+
      (rt.adsInterestLoading?'disabled':'')+'>'+(active?'Atualizar meu interesse':'Tenho interesse')+'</button>'+
    (active?'<button class="secondary small" type="button" onclick="merchantAdsInterestWithdrawFromUi()">Retirar interesse</button>':'')+
    '</div>'+
    (rt.adsInterestError?'<p class="notice danger">'+esc(rt.adsInterestError)+'</p>':'')+
    '<p class="tiny muted">Esta é apenas uma pesquisa de demanda, sem descontos, posição especial nas ofertas ou pagamento. '+
    'O ranking orgânico das revendas não muda.</p></div></section>';
}
async function merchantAdsInterestCall(operation,fields={}){
  const rt=globalThis.merchantRuntime;
  const merchantId=String(rt?.merchant?.merchantId||'');
  if(!merchantId||!['owner','manager'].includes(String(rt?.merchant?.memberRole||'')))
    return toast('Apenas proprietário ou gerente pode consultar esta opção.');
  if(rt.adsInterestLoading)return;
  rt.adsInterestLoading=true;rt.adsInterestError=null;
  try{
    const data=await merchantInvoke('merchant-ops',{action:'ads-interest',merchantId,operation,...fields});
    if(data?.source!=='merchant_ads_interest_v1_232'||
       data.merchantId!==merchantId||data.noCharge!==true||data.adsLive!==false||
       typeof data.interested!=='boolean')
      throw new Error('Resposta do registro de interesse não confirmada.');
    if(String(rt.merchant?.merchantId)!==merchantId)return;
    rt.adsInterest=data;
    if(operation!=='view')toast(data.interested?'Interesse salvo. Nenhuma cobrança foi criada.':'Interesse retirado.');
  }catch(e){
    if(String(rt?.merchant?.merchantId)===merchantId){
      rt.adsInterestError=String(e?.message||'Não foi possível salvar seu interesse.');
      toast(rt.adsInterestError);
    }
  }finally{rt.adsInterestLoading=false;render();}
}
function merchantAdsInterestLoadFromUi(){
  return merchantAdsInterestCall('view');
}
function merchantAdsInterestRegisterFromUi(){
  const consent=document.getElementById('merchant-ads-consent')?.checked===true;
  if(!consent)return toast('Confirme que deseja registrar seu interesse sem contratação.');
  const goal=String(document.getElementById('merchant-ads-goal')?.value||'');
  const budgetBand=String(document.getElementById('merchant-ads-budget')?.value||'');
  if(!['new_customers','local_visibility','new_area','unsure'].includes(goal)||
     !['unsure','upto_99','100_299','300_999','1000_plus'].includes(budgetBand))
    return toast('Selecione opções válidas.');
  return merchantAdsInterestCall('register',{goal,budgetBand,consent:true});
}
function merchantAdsInterestWithdrawFromUi(){
  if(!confirm('Retirar o interesse da sua revenda em publicidade? Não há cobrança a cancelar.'))return;
  return merchantAdsInterestCall('withdraw');
}
// TAMÃO Negócios V1.231 — figures from the authenticated server, never fake samples.
function merchantBusinessPulseSection(merchant){
  if(!['owner','manager'].includes(String(merchant?.memberRole||'')))return '';
  const merchantId=String(merchant?.merchantId||'');
  const rt=globalThis.merchantRuntime||{};
  const d=rt.businessPulse?.merchantId===merchantId?rt.businessPulse:null;
  const keys=['ordersCreated','settledOrders','cancelledOrders','reversedOrders','activeOrders','settledSalesCents'];
  const m=d?.metrics;
  const valid=d?.source==='merchant_business_pulse_v1_231'&&
    d.readOnly===true&&d.salesNotPlatformRevenue===true&&
    d.adsBillingEnabled===false&&d.proBillingEnabled===false&&d.periodDays===30&&
    m&&keys.every(k=>Number.isSafeInteger(m[k])&&m[k]>=0)&&
    m.ordersCreated===m.settledOrders+m.cancelledOrders+m.reversedOrders+m.activeOrders&&
    Array.isArray(d.topProducts)&&d.topProducts.length<=5;
  const metric=(label,value,detail='')=>
    '<div class="kpi"><span class="label">'+esc(label)+'</span><strong>'+esc(value)+
    '</strong>'+(detail?'<small>'+esc(detail)+'</small>':'')+'</div>';
  const cards=valid?
    '<div class="merchant-kpis" style="margin-top:14px">'+
      metric('Pedidos recebidos',String(m.ordersCreated),'Criados nos últimos 30 dias')+
      metric('Vendas concluídas',String(m.settledOrders),'Sem reversão financeira')+
      metric('Vendas registradas',BRL.format(m.settledSalesCents/100),'Valor dos pedidos, não lucro')+
      metric('Cancelados',String(m.cancelledOrders))+
      metric('Revertidos',String(m.reversedOrders),'Excluídos do total concluído')+
      metric('Em andamento',String(m.activeOrders))+
    '</div>'+
    (d.topProducts.length?
      '<h3 style="margin-top:14px">Produtos mais vendidos</h3><div class="list">'+
      d.topProducts.map(x=>'<div class="list-row"><div><strong>'+esc(x.name)+
        '</strong><br><small>'+Number(x.quantity)+' unidade(s) concluída(s)</small></div>'+
        '<strong>'+esc(BRL.format(Number(x.salesCents)/100))+'</strong></div>').join('')+
      '</div>':'<p class="muted tiny" style="margin-top:12px">Os produtos aparecerão aqui após vendas concluídas.</p>')+
    '<p class="tiny muted">Indicadores baseados nos pedidos criados nos últimos 30 dias e posteriormente liquidados, sem reversão. Não incluem vendas fora do TAMÃO, custos, taxas de pagamento ou lucro.</p>':
    '<p class="muted">'+(rt.businessPulseLoading?'Consultando vendas confirmadas…':
      'Consulte seus números para acompanhar a movimentação real da sua revenda.')+'</p>';
  return '<section class="section merchant-business-pulse" id="merchant-business-pulse">'+
    '<div class="section-head"><div><span class="section-kicker">TAMÃO NEGÓCIOS</span>'+
    '<h2>Vender, acompanhar e crescer</h2>'+
    '<p>Uma visão simples das suas vendas e caminhos para divulgar sua revenda.</p></div>'+
    '<button class="secondary small" onclick="merchantBusinessPulseLoadFromUi()" '+
    (rt.businessPulseLoading?'disabled':'')+'>Atualizar meus números</button></div>'+
    '<div class="card flat">'+cards+
      (rt.businessPulseError?'<div class="notice danger">'+esc(rt.businessPulseError)+'</div>':'')+
    '</div>'+
    '<div class="grid cards-3" style="margin-top:14px">'+
      '<div class="card"><h3>Organize sua oferta</h3><p class="muted tiny">Preços, estoque e produtos atualizados ajudam os clientes a comprar com segurança.</p>'+
      '<button class="secondary small" onclick="go(\'catalog\')">Revisar meu catálogo</button></div>'+
      '<div class="card"><h3>Amplie sua rede</h3><p class="muted tiny">Convide clientes e outras revendas pelo seu link de indicação, sem custo de adesão.</p>'+
      '<button class="secondary small" onclick="merchantGrowthLoadFromUi()">Consultar minha rede</button></div>'+
      '<div class="card"><h3>Divulgação e ferramentas Pro</h3>'+
      '<p class="muted tiny">Estamos estruturando anúncios identificados e recursos opcionais para empresas. Ainda não existem compra de anúncios nem assinatura Pro habilitadas.</p></div>'+
    '</div></section>';
}
async function merchantBusinessPulseLoadFromUi(){
  const rt=globalThis.merchantRuntime;
  const id=String(rt?.merchant?.merchantId||'');
  if(!id||!['owner','manager'].includes(String(rt?.merchant?.memberRole||'')))
    return toast('Somente proprietário ou gerente pode acessar os indicadores.');
  if(rt.businessPulseLoading)return;
  rt.businessPulseLoading=true;
  rt.businessPulseError=null;
  try{
    const data=await merchantInvoke('merchant-ops',{merchantId:id,action:'business-pulse'});
    if(data?.source!=='merchant_business_pulse_v1_231'||
       data.merchantId!==id||data.readOnly!==true||
       data.salesNotPlatformRevenue!==true||
       data.adsBillingEnabled!==false||data.proBillingEnabled!==false)
      throw new Error('Não foi possível validar os indicadores retornados pelo servidor.');
    // Late responses from a previously selected revenda must never overwrite it.
    if(String(rt.merchant?.merchantId)!==id)return;
    rt.businessPulse=data;
  }catch(e){
    if(String(rt?.merchant?.merchantId)===id)
      rt.businessPulseError=String(e?.message||'Não foi possível carregar os números.');
  }finally{rt.businessPulseLoading=false;render();}
}
function merchantGrowthNetworkSection(merchant){
  const role=String(merchant?.memberRole||'');
  if(!['owner','manager'].includes(role))return '';
  const merchantId=String(merchant?.merchantId||'');
  const growth=globalThis.merchantRuntime?.growthNetwork;
  const valid=growth?.merchantId===merchantId&&
    growth?.source==='merchant_network_v1_226'&&
    /^TMR[A-F0-9]{24}$/.test(String(growth?.inviteCode||''))&&
    growth?.rewardEnabled===false;
  const link=(type)=>'https://tamao.com.br/?ref='+
    encodeURIComponent(valid?growth.inviteCode:'')+
    (type==='merchant'?'#merchants':'#home');
  return `<section class="section merchant-growth-network" id="merchant-growth-network">
    <div class="section-head"><div><span class="section-kicker">REDE TAMÃO</span>
      <h2>Minha rede de indicações</h2>
      <p>Convide clientes e outras revendas. Uma empresa indicada pode criar seu cadastro, mas só poderá vender após habilitação.</p>
    </div></div>
    <div class="card flat">
      <p class="muted">Tenha um link próprio da sua revenda para compartilhar. A rede registra interesses qualificados; novas recompensas financeiras ainda não estão habilitadas.</p>
      ${valid?`
        <div class="share-box">${esc(link('merchant'))}</div>
        <div class="merchant-kpis" style="margin-top:12px">
          <div class="kpi"><span class="label">Revendas interessadas</span><strong>${Math.max(0,Number(growth.merchantInterests||0))}</strong></div>
          <div class="kpi"><span class="label">Clientes interessados</span><strong>${Math.max(0,Number(growth.customerInterests||0))}</strong></div>
        </div>
        <div class="order-actions" style="margin-top:14px">
          <button class="primary" onclick="merchantGrowthShareFromUi('merchant')">Indicar outra revenda</button>
          <button class="secondary" onclick="merchantGrowthShareFromUi('customer')">Convidar clientes</button>
          <button class="ghost" onclick="merchantGrowthLoadFromUi()">Atualizar minha rede</button>
        </div>`
        :`<button class="primary" onclick="merchantGrowthLoadFromUi()">Gerar meu link de indicações</button>`}
      ${globalThis.merchantRuntime?.growthError?
        '<div class="notice danger">'+esc(globalThis.merchantRuntime.growthError)+'</div>':''}
      <p class="tiny muted">Atribuição somente após cadastro consentido. Nenhum crédito, saque ou comissão de revenda é liberado por esse convite.</p>
    </div>
  </section>`;
}
async function merchantGrowthLoadFromUi(){
  const runtime=globalThis.merchantRuntime;
  const merchantId=String(runtime?.merchant?.merchantId||'');
  if(!merchantId||!['owner','manager'].includes(String(runtime?.merchant?.memberRole||''))){
    return toast('Apenas proprietário ou gerente pode acessar a rede da revenda');
  }
  if(runtime.growthLoading)return;
  runtime.growthLoading=true;
  runtime.growthError=null;
  try{
    const data=await merchantInvoke('merchant-ops',{
      merchantId,action:'growth-network'
    });
    if(data?.source!=='merchant_network_v1_226'||
      data?.merchantId!==merchantId||data?.rewardEnabled!==false||
      !/^TMR[A-F0-9]{24}$/.test(String(data?.inviteCode||''))){
      throw new Error('O vínculo do convite não foi confirmado pelo servidor');
    }
    runtime.growthNetwork=data;
  }catch(e){
    runtime.growthError=String(e?.message||'Não foi possível consultar a rede');
  }finally{runtime.growthLoading=false;render();}
}
async function merchantGrowthShareFromUi(type='merchant'){
  const network=globalThis.merchantRuntime?.growthNetwork;
  const merchantId=String(globalThis.merchantRuntime?.merchant?.merchantId||'');
  if(network?.merchantId!==merchantId||
    !/^TMR[A-F0-9]{24}$/.test(String(network?.inviteCode||''))){
    return toast('Carregue primeiro o código da sua revenda');
  }
  const inviteType=type==='customer'?'customer':'merchant';
  const url='https://tamao.com.br/?ref='+encodeURIComponent(network.inviteCode)+
    (inviteType==='merchant'?'#merchants':'#home');
  const message=inviteType==='merchant'
    ?'Conheça o TAMÃO e cadastre sua revenda para alcançar mais clientes: '+url
    :'Conheça o TAMÃO e consulte produtos na sua região: '+url;
  try{
    if(navigator.share){await navigator.share({title:'Rede TAMÃO',text:message,url});return;}
    if(navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(message);
      toast('Convite copiado para compartilhar');return;
    }
    toast('Copie o endereço exibido na área Minha rede');
  }catch(e){if(e?.name!=='AbortError')toast('Não foi possível compartilhar automaticamente');}
}
function merchantRealPortalRequired(){
  return shell('<section class="page"><span class="eyebrow">ÁREA DA REVENDA</span><h1 class="page-title">Área da minha revenda</h1><p class="muted">Entre ou cadastre sua empresa para configurar produtos, entregas e recebimentos.</p><button class="primary full" onclick="openMerchantPortal()">Entrar ou cadastrar minha revenda</button></section>');
}

function merchantLiveLoginView(){
  const rt=globalThis.merchantRuntime||{};
  const pilotInvite=String(globalThis.merchantPilotInviteToken?.()||'').trim();
  const prospectInvite=String(globalThis.merchantProspectInviteToken?.()||'').trim();
  return shell(`<section class="page">
    <span class="eyebrow">${pilotInvite||prospectInvite?'CONVITE DE PARCEIRO':'PAINEL DA REVENDA'}</span>
    <h1 class="page-title">${pilotInvite||prospectInvite?'Entre para continuar seu cadastro':'Entrar no painel da revenda'}</h1>
    <p class="muted">${pilotInvite||prospectInvite?'Informe o e-mail do responsável. Enviaremos um link para você continuar o cadastro da empresa.':'Informe o e-mail cadastrado na revenda. Enviaremos um link seguro de acesso.'}</p>
    ${pilotInvite?'<div class="notice success" style="margin-top:14px"><strong>Convite reconhecido.</strong><br>Seu convite já foi identificado. Você pode continuar o cadastro; as vendas só começam depois da habilitação.</div>':''}${prospectInvite?'<div class="notice success" style="margin-top:14px"><strong>Convite reconhecido.</strong><br>Vamos conferir o CNPJ para vincular seu cadastro à empresa convidada. A liberação para vender acontece em uma etapa separada.</div>':''}
    ${rt.notice?`<div class="notice success" style="margin-top:14px">${esc(rt.notice)}</div>`:''}
    ${rt.error?`<div class="notice danger" style="margin-top:14px">${esc(rt.error)}</div>`:''}
    <div class="card flat form-stack" style="margin-top:16px">
      <div class="input-wrap"><label for="merchant-email">E-mail</label><input id="merchant-email" type="email" autocomplete="email" class="input" maxlength="160" placeholder="voce@empresa.com"></div>
      <button class="primary" onclick="merchantLoginFromUi()">Enviar link de acesso</button>
    </div>
    <div class="notice" style="margin-top:14px">O cadastro da empresa passa por conferência antes da liberação das vendas. Você já pode preencher os dados agora.</div>
  </section>`);
}

function merchantLiveNoAccess(){
  const rt=globalThis.merchantRuntime||{};
  const email=rt.session?.user?.email||'conta autenticada';
  const roleBlocked=rt.accessReason==='MERCHANT_ROLE_NOT_ENABLED';
  const application=globalThis.merchantOwnApplicationForInvite?.()||null;
  const applicationStatus=String(application?.status||'');
  const applicationNotice=applicationStatus==='pending'
    ?'<div class="notice" style="margin-top:14px"><strong>Cadastro em análise</strong><br>'+
      esc(application.company_name||'Sua empresa')+' já foi recebida. Não é necessário criar outro cadastro; você pode corrigir informações antes da aprovação.</div>'
    :applicationStatus==='rejected'
      ?'<div class="notice danger" style="margin-top:14px"><strong>Cadastro precisa de correção</strong><br>Revise os dados e reenvie para avaliação.</div>'
      :applicationStatus==='approved'
        ?'<div class="notice success" style="margin-top:14px"><strong>Cadastro aprovado</strong><br>O acesso operacional depende do vínculo e habilitação da revenda.</div>'
        :'';
  const applicationAction=applicationStatus==='rejected'?'Corrigir e reenviar':
    applicationStatus==='pending'?'Revisar cadastro':'Cadastrar empresa';
  return shell(`<section class="page">
    <span class="eyebrow">CONTA AUTENTICADA</span>
    <h1 class="page-title">${roleBlocked?'Seu acesso à revenda ainda não foi liberado':'Ainda não encontramos uma revenda vinculada'}</h1>
    <p class="muted">${roleBlocked
      ? 'Você entrou como '+esc(email)+', mas esta conta ainda não tem permissão para administrar a revenda.'
      : 'Você entrou como '+esc(email)+', mas ainda não há uma revenda ativa vinculada a este e-mail.'}</p>
    ${rt.notice?`<div class="notice success" style="margin-top:16px"><strong>Cadastro recebido.</strong><br>${esc(rt.notice)}</div>`:''}
    ${applicationNotice}
    ${roleBlocked
      ? '<div class="notice" style="margin-top:16px"><strong>Acesso à revenda ainda não liberado.</strong><br>Seu usuário ainda não tem permissão para operar esta revenda.</div>'
      : applicationStatus==='approved'?'': '<div class="card flat" style="margin-top:16px"><h3>Seu cadastro</h3><p class="muted tiny">Se precisar corrigir alguma informação, atualize o cadastro já enviado.</p><button class="primary full" onclick="go(\'merchant-join\')">'+applicationAction+'</button></div>'}
    <button class="ghost full" style="margin-top:12px" onclick="merchantLiveLogout()">Sair desta conta</button>
  </section>`);
}

function merchantLiveProduct(code){
  return (globalThis.merchantRuntime?.catalog||[]).find(x=>x.productCode===code)||null;
}
function merchantTimestampFresh(value,hours=24){
  const ts=Date.parse(value||'');
  return Number.isFinite(ts)&&Date.now()-ts<=hours*60*60*1000&&ts<=Date.now()+5*60*1000;
}
function merchantLiveFreshness(){
  const rt=globalThis.merchantRuntime||{};
  const offerable=(rt.catalog||[]).filter(item=>item.active&&Number(item.availableStock)>0);
  const staleProducts=offerable.filter(item=>!merchantTimestampFresh(item.priceConfirmedAt));
  const deliveryFresh=merchantTimestampFresh(rt.merchant?.deliveryFeeConfirmedAt);
  return {offerable,staleProducts,deliveryFresh,allFresh:deliveryFresh&&offerable.length>0&&!staleProducts.length};
}

function merchantDeliveryMemberLabel(userId){
  const id=String(userId||'');
  const member=(globalThis.merchantRuntime?.deliveryTeam||[]).find(x=>x.userId===id);
  if(member?.displayName)return member.displayName;
  const m=globalThis.merchantRuntime?.merchant;
  if(m?.memberRole==='driver'&&id&&m?.memberDisplayName)return m.memberDisplayName;
  return id?'Responsável atribuído':'Ainda não atribuído';
}

function merchantAlertControl(){
  const status=globalThis.merchantAlertStatus?.()||{enabled:false,notificationSupported:false,notificationPermission:'unsupported'};
  const permission=status.notificationPermission;
  const notificationCopy=!status.notificationSupported
    ? 'Notificação do sistema indisponível neste navegador; som e vibração ainda podem funcionar.'
    : permission==='granted'
      ? 'Som, vibração e notificação do sistema habilitados neste aparelho.'
      : permission==='denied'
        ? 'Som e vibração podem funcionar, mas o navegador bloqueou notificações do sistema.'
        : 'Ao ativar, o navegador pode pedir permissão para notificações.';
  return `<div class="card flat form-stack" style="margin-top:14px">
    <div class="status-bar"><div><strong>Alertas neste aparelho</strong><br><small>${esc(notificationCopy)}</small></div><span class="status-pill ${status.enabled?'online':'offline'}">${status.enabled?'ATIVOS':'DESLIGADOS'}</span></div>
    <div class="notice"><strong>Escopo atual.</strong><br>Os alertas funcionam enquanto este painel/PWA estiver aberto, inclusive em outra aba. Fechar totalmente o navegador interrompe o polling; push com o app fechado exige uma etapa posterior.</div>
    <button class="${status.enabled?'danger-btn':'primary'}" onclick="${status.enabled?'merchantDisableAlertsFromUi()':'merchantEnableAlertsFromUi()'}">${status.enabled?'Desativar alertas':'Ativar som, vibração e notificações'}</button>
  </div>`;
}

function merchantDriverLivePage(rt){
  const m=rt.merchant||{};
  const orders=rt.orders||[];
  const name=String(m.memberDisplayName||'').trim();
  return shell(`<section class="page">
    <div class="status-bar"><div><div class="tiny muted">MINHAS ENTREGAS</div><h1 class="page-title" style="margin-bottom:2px">${esc(m.name||'Revenda')}</h1></div><span class="status-pill online">MOTORISTA</span></div>
    <div class="notice success" style="margin-top:14px"><strong>Visão restrita por atribuição.</strong><br>Você vê somente pedidos que a operação vinculou à sua conta. Catálogo, preços, compliance e pedidos de outros responsáveis não aparecem aqui.</div>
    <section class="section"><div class="section-head"><div><h2>Pedidos atribuídos a você</h2><p>Saída, chegada e conclusão continuam protegidas pela versão do pedido e pelas autoridades do servidor.</p></div></div>${merchantOrderQueueView(orders,'Nenhuma entrega atribuída a você agora.')}</section>
    ${merchantAlertControl()}
    <div class="card flat form-stack" style="margin-top:14px">
      <h3>Seu nome operacional</h3>
      <div class="input-wrap"><label for="driver-display-name">Como aparecer para a equipe</label><input id="driver-display-name" class="input" maxlength="60" value="${esc(name)}" placeholder="Ex.: João"></div>
      <small class="field-help">Esse nome é usado dentro da operação. O cliente não recebe sua identidade por este painel.</small>
      <button class="secondary" onclick="merchantLiveSaveMemberProfile()">Salvar nome</button>
      <div class="order-actions"><button class="secondary small" onclick="merchantLiveRefresh()">Atualizar entregas</button><button class="ghost small" onclick="merchantLiveLogout()">Sair</button></div>
    </div>

  </section>`);
}

function merchantTeamPage(){
  const rt=globalThis.merchantRuntime||{};
  const m=rt.merchant;
  if(rt.status!=='ready'||!m){
    return shell('<section class="page"><h1 class="page-title">Equipe da revenda</h1><div class="empty card">Conecte-se à operação para gerenciar a equipe.</div></section>');
  }
  if(!['owner','manager'].includes(String(m.memberRole||''))){
    return shell('<section class="page"><button class="back" onclick="go(\'merchant\')">← Operação</button><h1 class="page-title">Equipe da revenda</h1><div class="notice danger"><strong>Acesso restrito.</strong><br>Somente owner ou manager pode gerenciar membros.</div></section>');
  }
  if(rt.teamLoading&&!rt.team){
    return shell('<section class="page"><button class="back" onclick="go(\'merchant\')">← Operação</button><h1 class="page-title">Equipe da revenda</h1><div class="empty card">Carregando equipe…</div></section>');
  }
  const team=rt.team||{actorRole:m.memberRole,members:[],pendingInvites:[]};
  const members=Array.isArray(team.members)?team.members:[];
  const pending=Array.isArray(team.pendingInvites)?team.pendingInvites:[];
  const canInviteManager=String(team.actorRole||m.memberRole)==='owner';
  const roleLabel={owner:'Proprietário',manager:'Gerente',operator:'Operador',driver:'Motorista'};
  const memberRows=members.map(member=>{
    const role=String(member.memberRole||'');
    const active=member.active===true;
    const protectedMember=member.isSelf===true||role==='owner'||(role==='manager'&&!canInviteManager);
    const status=active?'ATIVO':'INATIVO';
    const statusClass=active?'online':'offline';
    return `<div class="card flat" style="margin-bottom:10px">
      <div class="status-bar"><div><strong>${esc(member.displayName||member.email||'Membro')}</strong><br><small>${esc(member.email||'')} • ${esc(roleLabel[role]||role)}</small></div><span class="status-pill ${statusClass}">${status}</span></div>
      ${active&&!protectedMember?`<button class="danger-btn small" style="margin-top:10px" onclick="merchantTeamRevokeMemberFromUi('${esc(member.userId)}')">Revogar acesso</button>`:''}
      ${!active?'<div class="tiny muted" style="margin-top:8px">Para reativar, envie um novo convite para o mesmo e-mail.</div>':''}
    </div>`;
  }).join('');
  const inviteRows=pending.map(invite=>`<div class="card flat" style="margin-bottom:10px">
    <div class="status-bar"><div><strong>${esc(invite.displayName||invite.email)}</strong><br><small>${esc(invite.email)} • ${esc(roleLabel[invite.memberRole]||invite.memberRole)}</small></div><span class="status-pill risk">PENDENTE</span></div>
    <div class="tiny muted" style="margin-top:8px">Válido até ${esc(formatDateTime(invite.expiresAt))}. O vínculo acontece quando esse e-mail entrar no portal da revenda.</div>
    <div class="order-actions"><button class="secondary small" data-invite-id="${esc(invite.inviteId)}" onclick="copyMerchantTeamInstructionsByInvite(this.dataset.inviteId)">Copiar instruções</button><button class="danger-btn small" onclick="merchantTeamRevokeInviteFromUi('${esc(invite.inviteId)}')">Cancelar convite</button></div>
  </div>`).join('');

  return shell(`<section class="page">
    <button class="back" onclick="go('merchant')">← Operação</button>
    <span class="eyebrow">ACESSO DA EQUIPE</span>
    <h1 class="page-title">Equipe da revenda</h1>
    <p class="muted page-lead">Convide pessoas pelo e-mail que elas usarão para entrar. A conta recebe somente o papel definido aqui.</p>
    ${rt.error?`<div class="notice danger">${esc(rt.error)}</div>`:''}
    <div class="card flat form-stack">
      <h3>Convidar membro</h3>
      <div class="input-wrap"><label for="team-email">E-mail</label><input id="team-email" class="input" type="email" autocomplete="email" maxlength="160" placeholder="pessoa@empresa.com"></div>
      <div class="field-row">
        <div class="input-wrap"><label for="team-role">Papel</label><select id="team-role" class="input">${canInviteManager?'<option value="manager">Gerente</option>':''}<option value="operator">Operador</option><option value="driver" selected>Motorista</option></select></div>
        <div class="input-wrap"><label for="team-display-name">Nome operacional</label><input id="team-display-name" class="input" maxlength="60" placeholder="Ex.: João"></div>
      </div>
      <div class="notice"><strong>Sem senha compartilhada.</strong><br>Se a conta já existir, o acesso entra imediatamente. Caso contrário, o convite fica pendente por 7 dias e é reivindicado automaticamente no primeiro login com o mesmo e-mail.</div>
      <button class="primary" onclick="merchantTeamInviteFromUi()" ${rt.actionPending?'disabled':''}>Convidar para a equipe</button>
    </div>
    <section class="section"><div class="section-head"><div><h2>Membros</h2><p>Owner não pode ser removido por esta tela. Manager só pode revogar operator ou driver.</p></div><button class="ghost small" onclick="merchantTeamReloadFromUi()">Atualizar</button></div>${memberRows||'<div class="empty card">Nenhum membro listado.</div>'}</section>
    <section class="section"><div class="section-head"><div><h2>Convites pendentes</h2><p>O convidado deve entrar no portal usando exatamente o e-mail abaixo.</p></div></div>${inviteRows||'<div class="empty card">Nenhum convite pendente.</div>'}</section>
  </section>`);
}

function merchantBillingPixChargeExpired(charge){
  if(!charge)return false;
  if(String(charge.status||'')==='expired')return true;
  const expiresAt=Date.parse(String(charge.expiresAt||''));
  return String(charge.status||'')==='active'
    &&Number.isFinite(expiresAt)
    &&expiresAt<=Date.now();
}

function merchantBillingPixChargeView(request){
  const charge=request?.pixCharge||null;
  if(!charge)return '';
  const status=String(charge.status||'');
  const amount=BRL.format(Number(charge.amountCents||request.expectedAmountCents||0)/100);
  const expiry=charge.expiresAt?new Date(charge.expiresAt).toLocaleString('pt-BR'):null;
  const completed=status==='completed';
  const expired=merchantBillingPixChargeExpired(charge);
  const active=status==='active'&&!expired;
  const preparing=status==='preparing';

  if(completed){
    return `<div class="notice success" style="margin-top:8px"><strong>Pix recebido.</strong><br>${amount} confirmado pelo provedor${charge.endToEndId?' • EndToEndId '+esc(charge.endToEndId):''}. O Financeiro fará a confirmação final antes de liberar crédito ou quitar o fechamento.</div>`;
  }

  if(expired){
    const expiredAt=charge.expiredAt
      ?new Date(charge.expiredAt).toLocaleString('pt-BR')
      :expiry;
    return `<div class="notice risk" style="margin-top:8px"><strong>Pix expirado.</strong><br>Este QR não deve mais ser usado${expiredAt?' • expirou em '+esc(expiredAt):''}. A solicitação financeira continua pendente; gere um novo Pix. Nenhum crédito ou quitação ocorreu por causa da expiração.</div>`;
  }

  if(preparing){
    return `<div class="notice risk" style="margin-top:8px"><strong>Preparando cobrança Pix.</strong><br>Use “Gerar/recuperar Pix” para concluir ou recuperar uma tentativa interrompida.${charge.lastErrorCode?' Última falha: '+esc(charge.lastErrorCode)+'.':''}</div>`;
  }

  if(!active)return '';

  const qr=charge.qrCodeDataUri
    ? `<div style="margin-top:10px;text-align:center"><img src="${esc(charge.qrCodeDataUri)}" alt="QR Code Pix TAMÃO" width="220" height="220" loading="lazy" style="max-width:100%;height:auto"></div>`
    : '';
  const copy=charge.brCode
    ? `<div class="input-wrap" style="margin-top:8px"><label>Pix copia e cola</label><textarea class="input" readonly rows="3">${esc(charge.brCode)}</textarea></div><button class="secondary small" style="margin-top:8px" onclick="merchantCopyBillingPixCode('${esc(request.id)}')">Copiar código Pix</button>`
    : '';
  const link=charge.paymentLinkUrl
    ? ` <a class="ghost small" href="${esc(charge.paymentLinkUrl)}" target="_blank" rel="noopener noreferrer">Abrir pagamento</a>`
    : '';
  return `<div class="card flat" style="margin-top:8px"><div class="order-head"><div><strong>Pix pronto para pagar</strong><br><small>${amount}${expiry?' • válido até '+esc(expiry):''}</small></div><span class="status-pill online">QR ATIVO</span></div>${qr}${copy}${link}</div>`;
}

function merchantBillingLiveView(rt){
  const billing=rt.billing||null;
  if(!billing?.account)return '';
  const account=billing.account||{};
  const plan=billing.plan||{};
  const statements=billing.openStatements||[];
  const requests=billing.paymentRequests||[];
  const recoveries=billing.refundRecoveries||[];
  const activeRecoveries=recoveries.filter(r=>['open','payment_pending'].includes(String(r.status||'')));
  const pixReady=billing.pixProviderReady===true;
  const pending=requests.filter(r=>r.status==='pending');
  const pendingPackage=pending.find(r=>r.requestKind==='package_purchase')||null;
  const pendingByStatement=new Map(
    pending.filter(r=>r.requestKind==='statement_payment'&&r.statementId).map(r=>[r.statementId,r])
  );
  const pendingByRecovery=new Map(
    pending.filter(r=>r.requestKind==='refund_recovery'&&r.refundRecoveryId)
      .map(r=>[r.refundRecoveryId,r])
  );
  const held=account.salesHold===true;
  const holdReason=String(account.salesHoldReason||'');
  const refundHold=holdReason==='provider_payment_refund_review';
  const role=String(rt.merchant?.memberRole||'');
  const canSeeFinance=['owner','manager'].includes(role);
  if(!canSeeFinance){
    return held
      ? refundHold
        ? '<div class="notice danger" style="margin-top:12px"><strong>Novas vendas suspensas por revisão financeira.</strong><br>Um pagamento anteriormente confirmado teve reembolso/estorno informado pelo provedor. O owner ou gerente precisa tratar a revisão com o Financeiro. Pedidos já aceitos continuam disponíveis normalmente.</div>'
        : '<div class="notice danger" style="margin-top:12px"><strong>Novas vendas suspensas por pendência financeira.</strong><br>O owner ou gerente precisa regularizar o fechamento vencido. Pedidos já aceitos continuam disponíveis normalmente.</div>'
      : '';
  }

  const feePct=(Number(plan.platformFeeBps||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const available=Number(account.creditAvailableCents||0);
  const nextDue=statements
    .filter(x=>['open','overdue'].includes(x.status))
    .sort((a,b)=>Date.parse(a.dueAt||'')-Date.parse(b.dueAt||''))[0]||null;
  const openDue=statements.reduce((sum,x)=>sum+Number(x.amountDueCents||0),0);

  const planCards=(billing.plans||[]).map(p=>{
    const pct=(Number(p.platformFeeBps||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const current=p.planKey===plan.planKey;
    const prepaid=p.billingMode==='prepaid_credit';
    const activePrepaidBalance=plan.billingMode==='prepaid_credit'
      &&(Number(account.creditBalanceCents||0)>0||Number(account.creditReservedCents||0)>0);
    const protectedDowngrade=prepaid
      &&activePrepaidBalance
      &&Number(p.platformFeeBps||0)>Number(plan.platformFeeBps||0);
    const pendingThis=pendingPackage?.planKey===p.planKey;

    let action='';
    if(prepaid&&pendingThis){
      const chargeView=merchantBillingPixChargeView(pendingPackage);
      const packageChargeExpired=merchantBillingPixChargeExpired(pendingPackage.pixCharge);
      const retryPix=pixReady&&(
        !pendingPackage.pixCharge
        ||pendingPackage.pixCharge?.status==='preparing'
        ||packageChargeExpired
      )
        ? `<button class="secondary small" style="margin-top:8px" onclick="merchantCreateBillingPackagePixFromUi('${esc(p.planKey)}')" ${rt.actionPending?'disabled':''}>${packageChargeExpired?'Gerar novo Pix':'Gerar/recuperar Pix'}</button>`
        : '';
      action=`${chargeView||'<div class="notice risk" style="margin-top:8px"><strong>Solicitação pendente.</strong><br>Aguardando pagamento ou conferência financeira.</div>'}${retryPix}<button class="ghost small" style="margin-top:8px" onclick="merchantCancelBillingRequestFromUi('${esc(pendingPackage.id)}')" ${rt.actionPending?'disabled':''}>Cancelar solicitação</button>`;
    }else if(prepaid&&protectedDowngrade){
      action=`<div class="notice" style="margin-top:8px"><strong>Proteção do saldo atual.</strong><br>Enquanto houver crédito ou reserva no pacote ${esc(plan.displayName||'atual')}, você pode recarregar o mesmo pacote ou migrar para uma taxa menor. Este pacote ficará disponível quando o saldo atual terminar.</div>`;
    }else if(prepaid){
      const pixAction=pixReady
        ? `<button class="secondary small" style="margin-top:8px" onclick="merchantCreateBillingPackagePixFromUi('${esc(p.planKey)}')" ${pendingPackage||rt.actionPending?'disabled':''}>${current?'Gerar Pix para recarregar':'Gerar Pix e solicitar ativação'}</button><button class="ghost small" style="margin-top:8px" onclick="merchantRequestBillingPackageFromUi('${esc(p.planKey)}')" ${pendingPackage||rt.actionPending?'disabled':''}>Já paguei por outro meio</button>`
        : `<button class="secondary small" style="margin-top:8px" onclick="merchantRequestBillingPackageFromUi('${esc(p.planKey)}')" ${pendingPackage||rt.actionPending?'disabled':''}>${pendingPackage?'Outro pacote já está pendente':current?'Informar pagamento da recarga':'Informar pagamento e solicitar ativação'}</button>`;
      action=pixAction;
    }

    return `<div class="card flat"><div class="order-head"><div><strong>${esc(p.displayName)}</strong><br><small>${prepaid?'Pacote pré-pago':'Pós-pago diário'}</small></div><span class="status-pill ${current?'online':''}">${pct}%</span></div>${prepaid?`<div class="tiny muted">${BRL.format(Number(p.purchaseAmountCents||0)/100)} de crédito de taxas • ativação somente após confirmação financeira. O saldo é usado até o último centavo.</div>`:'<div class="tiny muted">Sem recarga antecipada. Fechamento diário com vencimento D+1.</div>'}${current?'<div class="notice success" style="margin-top:8px"><strong>Plano atual</strong></div>':''}${action}</div>`;
  }).join('');

  const statementRows=statements.map(s=>{
    const request=pendingByStatement.get(s.id);
    let paymentAction='';
    if(request){
      const chargeView=merchantBillingPixChargeView(request);
      const statementChargeExpired=merchantBillingPixChargeExpired(request.pixCharge);
      const retryPix=pixReady&&(
        !request.pixCharge
        ||request.pixCharge.status==='preparing'
        ||statementChargeExpired
      )
        ? `<button class="secondary small" style="margin-top:6px" onclick="merchantCreateStatementPixFromUi('${esc(s.id)}')" ${rt.actionPending?'disabled':''}>${statementChargeExpired?'Gerar novo Pix':'Gerar/recuperar Pix'}</button>`
        : '';
      paymentAction=`${chargeView||'<div class="tiny muted" style="margin-top:6px"><strong>Pagamento informado.</strong> Aguardando conferência do Financeiro.</div>'}${retryPix}<button class="ghost small" style="margin-top:6px" onclick="merchantCancelBillingRequestFromUi('${esc(request.id)}')" ${rt.actionPending?'disabled':''}>Cancelar aviso</button>`;
    }else{
      paymentAction=pixReady
        ? `<button class="secondary small" style="margin-top:6px" onclick="merchantCreateStatementPixFromUi('${esc(s.id)}')" ${rt.actionPending?'disabled':''}>Pagar com Pix</button><button class="ghost small" style="margin-top:6px" onclick="merchantNotifyStatementPaidFromUi('${esc(s.id)}')" ${rt.actionPending?'disabled':''}>Já paguei por outro meio</button>`
        : `<button class="secondary small" style="margin-top:6px" onclick="merchantNotifyStatementPaidFromUi('${esc(s.id)}')" ${rt.actionPending?'disabled':''}>Informar pagamento</button>`;
    }
    return `<div class="list-row"><div><strong>${esc(String(s.businessDate||'Fechamento'))}</strong><br><small>${s.status==='overdue'?'VENCIDO':'vence '+esc(s.dueAt?new Date(s.dueAt).toLocaleString('pt-BR'):'—')}</small>${paymentAction}</div><div style="text-align:right"><strong>${BRL.format(Number(s.amountDueCents||0)/100)}</strong><br><small>taxa bruta ${BRL.format(Number(s.grossFeeCents||0)/100)} • crédito ${BRL.format(Number(s.prepaidCreditAppliedCents||0)/100)}</small></div></div>`;
  }).join('');

  const recoveryRows=recoveries
    .filter(r=>['open','payment_pending'].includes(String(r.status||'')))
    .map(recovery=>{
      const request=pendingByRecovery.get(recovery.id)
        ||(recovery.recoveryPaymentRequestId
          ?requests.find(r=>r.id===recovery.recoveryPaymentRequestId)
          :null);
      const outstanding=Number(recovery.outstandingCents??recovery.amountCents??0);
      const allocated=Number(recovery.amountCents||0);
      const amount=BRL.format(outstanding/100);
      let action='';
      if(request?.status==='pending'){
        const chargeView=merchantBillingPixChargeView(request);
        const expired=merchantBillingPixChargeExpired(request.pixCharge);
        const retryPix=pixReady&&(
          !request.pixCharge
          ||request.pixCharge.status==='preparing'
          ||expired
        )
          ? `<button class="secondary small" style="margin-top:8px" onclick="merchantCreateRefundRecoveryPixFromUi('${esc(recovery.id)}')" ${rt.actionPending?'disabled':''}>${expired?'Gerar novo Pix':'Gerar/recuperar Pix'}</button>`
          : '';
        action=`${chargeView||'<div class="notice risk" style="margin-top:8px"><strong>Recuperação pendente.</strong><br>Aguardando pagamento ou conferência financeira.</div>'}${retryPix}<button class="ghost small" style="margin-top:8px" onclick="merchantCancelBillingRequestFromUi('${esc(request.id)}')" ${rt.actionPending?'disabled':''}>Cancelar aviso de pagamento</button>`;
      }else{
        action=pixReady
          ? `<button class="secondary small" style="margin-top:8px" onclick="merchantCreateRefundRecoveryPixFromUi('${esc(recovery.id)}')" ${rt.actionPending?'disabled':''}>Pagar recuperação com Pix</button><button class="ghost small" style="margin-top:8px" onclick="merchantNotifyRefundRecoveryPaidFromUi('${esc(recovery.id)}')" ${rt.actionPending?'disabled':''}>Já paguei por outro meio</button>`
          : `<button class="secondary small" style="margin-top:8px" onclick="merchantNotifyRefundRecoveryPaidFromUi('${esc(recovery.id)}')" ${rt.actionPending?'disabled':''}>Informar pagamento da recuperação</button>`;
      }
      return `<div class="card flat"><div class="order-head"><div><strong>Recuperação de refund/estorno</strong><br><small>Obrigação ${esc(String(recovery.id).slice(0,8))} • saldo atual ${amount}${outstanding!==allocated?' • valor histórico '+BRL.format(allocated/100):''} • o hold permanece até a aprovação do saldo</small></div><span class="status-pill risk">${amount}</span></div>${action}</div>`;
    }).join('');

  const recentRequests=requests.slice(0,8).map(r=>{
    const label=r.requestKind==='package_purchase'
      ? 'Pacote '+((billing.plans||[]).find(p=>p.planKey===r.planKey)?.displayName||r.planKey||'')
      : r.requestKind==='refund_recovery'
        ? 'Recuperação de refund/estorno'
        : 'Pagamento do fechamento';
    const status=({pending:'PENDENTE',approved:'APROVADO',rejected:'REJEITADO',cancelled:'CANCELADO'})[r.status]||String(r.status||'').toUpperCase();
    const method=({pix:'Pix',bank_transfer:'Transferência',cash:'Dinheiro',card:'Cartão',other:'Outro'})[String(r.paymentMethod||'')]||null;
    const provenance=r.approvalSource==='provider_event'
      ?'conciliação do provedor'
      :r.approvalSource==='manual'
        ?'conferência manual'
        :null;
    const confirmed=r.status==='approved'&&r.receivedAmountCents!=null
      ? `<br><small>confirmado: ${BRL.format(Number(r.receivedAmountCents||0)/100)}${method?' • '+esc(method):''}${r.reconciliationKey?' • ID '+esc(r.reconciliationKey):''}${provenance?' • '+esc(provenance):''}${r.adminReference?' • '+esc(r.adminReference):''}</small>`
      : '';
    const source=r.pixCharge
      ? `<br><small>Pix TAMÃO • ${esc(r.pixCharge.status||'—')}${r.pixCharge.endToEndId?' • EndToEndId '+esc(r.pixCharge.endToEndId):''}</small>`
      : `<br><small>${esc(r.merchantReference||'sem referência')}</small>`;
    const providerRefundNeutralized=r.status==='cancelled'
      &&r.adminReference==='provider-refund-before-approval'
        ?'<br><small>Pagamento devolvido pelo provedor antes da confirmação. Nenhum crédito, quitação ou nova dívida foi aplicado; gere uma nova cobrança se ainda quiser concluir o pagamento.</small>'
        :'';
    return `<div class="list-row"><div><strong>${esc(label)}</strong><br><small>${esc(r.requestedAt?new Date(r.requestedAt).toLocaleString('pt-BR'):'—')}</small>${source}${confirmed}${providerRefundNeutralized}</div><div style="text-align:right"><span class="status-pill ${r.status==='approved'?'online':r.status==='rejected'?'offline':r.status==='pending'?'risk':''}">${esc(status)}</span><br><small>${BRL.format(Number(r.expectedAmountCents||0)/100)}</small></div></div>`;
  }).join('');

  return `<section class="section">
    <div class="section-head"><div><span class="section-kicker">FINANCEIRO TAMÃO</span><h2>Taxas e fechamento diário</h2><p>Cada venda conserva sua taxa individual. O TAMÃO fecha o dia às 00:05 e eventual saldo pós-pago vence até o fim do dia seguinte.</p></div><span class="status-pill ${held?'offline':'online'}">${held?'VENDAS SUSPENSAS':'EM DIA'}</span></div>
    ${held?(refundHold
      ?activeRecoveries.length
        ?'<div class="notice danger"><strong>Refund/estorno em revisão.</strong><br>O provedor informou devolução de um pagamento anteriormente conciliado. Novas vendas e novos benefícios financeiros ficam pausados. Quite somente a obrigação de recuperação exibida abaixo; o hold só é liberado depois que o pagamento exato for conciliado e aprovado pelo Financeiro e não houver outra revisão pendente.</div>'
        :'<div class="notice danger"><strong>Refund/estorno em análise do Financeiro.</strong><br>Não existe cobrança automática de recuperação em aberto neste momento. O TAMÃO não cria dívida acima do valor originalmente recebido. Aguarde a análise do excesso/anomalia; novas vendas permanecem pausadas até a decisão auditável do Financeiro.</div>'
      :'<div class="notice danger"><strong>Há fechamento vencido.</strong><br>Novas vendas ficam pausadas até a regularização. Pedidos já aceitos continuam normalmente; seu acesso ao painel e ao histórico permanece disponível.</div>'):''}
    <div class="merchant-kpis">
      <div class="kpi"><span class="label">Plano</span><strong>${esc(plan.displayName||'Flex Diário')}</strong><small>${feePct}% por venda</small></div>
      <div class="kpi"><span class="label">Crédito pré-pago</span><strong>${BRL.format(Number(account.creditBalanceCents||0)/100)}</strong></div>
      <div class="kpi"><span class="label">Reservado</span><strong>${BRL.format(Number(account.creditReservedCents||0)/100)}</strong><small>pedidos ainda não liquidados</small></div>
      <div class="kpi"><span class="label">Disponível</span><strong>${BRL.format(available/100)}</strong></div>
      <div class="kpi"><span class="label">Saldo D+1 aberto</span><strong>${BRL.format(openDue/100)}</strong><small>${nextDue?'próximo vencimento '+new Date(nextDue.dueAt).toLocaleString('pt-BR'):'nenhum vencimento'}</small></div>
    </div>
    ${recoveryRows?`<div class="section-head" style="margin-top:16px"><div><h3>Recuperação de refund/estorno</h3><p>O valor devolvido pelo PSP precisa ser recomposto por uma nova transação comprovável. A referência administrativa sozinha não encerra o caso.</p></div></div><div class="admin-entity-grid">${recoveryRows}</div>`:''}
    ${statementRows?`<div class="card flat" style="margin-top:12px"><h3>Fechamentos em aberto</h3><div class="list">${statementRows}</div></div>`:''}
    <div class="section-head" style="margin-top:16px"><div><h3>Opções de taxa</h3><p>Quanto maior o crédito antecipado, menor a taxa por venda. O crédito só é consumido quando pedidos são liquidados. Com saldo ativo, recargas do mesmo pacote e upgrades para taxa menor permanecem disponíveis; downgrade só depois de zerar saldo e reservas.</p></div></div>
    <div class="admin-entity-grid">${planCards}</div>
    <div class="notice" style="margin-top:12px"><strong>Pix com conciliação automática.</strong><br>${pixReady?'Gere o Pix no próprio TAMÃO: o QR e o copia-e-cola ficam vinculados à solicitação, e o EndToEndId bancário volta pelo provedor sem digitação manual.':'A integração automática ainda não está configurada neste ambiente; o fluxo manual permanece disponível.'} Em qualquer rota, crédito ou quitação só acontecem após a confirmação financeira. Se o saldo restante não cobrir toda a taxa descontada de uma venda, esse último saldo é abatido da taxa Flex daquela venda e apenas a diferença entra no fechamento D+1; quando saldo e reservas zerarem, o plano volta ao Flex automaticamente.</div>
    ${recentRequests?`<details class="card flat" style="margin-top:12px"><summary><strong>Solicitações financeiras recentes</strong></summary><div class="list" style="margin-top:10px">${recentRequests}</div></details>`:''}
  </section>`;
}

async function merchantCreateBillingPackagePixFromUi(planKey){
  const billing=globalThis.merchantRuntime?.billing||{};
  const plan=(billing.plans||[]).find(p=>p.planKey===planKey);
  if(!plan)return toast('Pacote não encontrado');
  if(!confirm('Gerar Pix de '+BRL.format(Number(plan.purchaseAmountCents||0)/100)+' para '+plan.displayName+'? O crédito só será liberado após confirmação financeira.'))return;
  try{
    await merchantCreateBillingPixLive({planKey});
    toast('Pix gerado. Use o QR ou o código copia e cola.');
  }catch(e){toast(String(e?.message||e))}
}

async function merchantCreateStatementPixFromUi(statementId){
  const billing=globalThis.merchantRuntime?.billing||{};
  const statement=(billing.openStatements||[]).find(s=>s.id===statementId);
  if(!statement)return toast('Fechamento não encontrado');
  if(!confirm('Gerar Pix de '+BRL.format(Number(statement.amountDueCents||0)/100)+' para este fechamento?'))return;
  try{
    await merchantCreateBillingPixLive({statementId});
    toast('Pix gerado. Use o QR ou o código copia e cola.');
  }catch(e){toast(String(e?.message||e))}
}

async function merchantCreateRefundRecoveryPixFromUi(refundRecoveryId){
  const billing=globalThis.merchantRuntime?.billing||{};
  const recovery=(billing.refundRecoveries||[]).find(r=>r.id===refundRecoveryId);
  if(!recovery)return toast('Obrigação de recuperação não encontrada');
  if(!confirm('Gerar Pix de '+BRL.format(Number(recovery.amountCents||0)/100)+' para recompor este refund/estorno? O hold só será liberado após conferência do Financeiro.'))return;
  try{
    await merchantCreateBillingPixLive({refundRecoveryId});
    toast('Pix de recuperação gerado.');
  }catch(e){toast(String(e?.message||e))}
}

async function merchantNotifyRefundRecoveryPaidFromUi(refundRecoveryId){
  const billing=globalThis.merchantRuntime?.billing||{};
  const recovery=(billing.refundRecoveries||[]).find(r=>r.id===refundRecoveryId);
  if(!recovery)return toast('Obrigação de recuperação não encontrada');
  const reference=prompt('Identificador exato do pagamento de recuperação (Pix: EndToEndId; outro meio: ID da transação):')||'';
  if(reference.trim().length<6)return toast('Informe o identificador exato da transação');
  if(!confirm('Enviar para conferência a recuperação de '+BRL.format(Number(recovery.amountCents||0)/100)+'? O hold continua ativo até a aprovação do Financeiro.'))return;
  try{
    await merchantNotifyRefundRecoveryPaidLive(refundRecoveryId,reference);
    toast('Pagamento de recuperação informado; aguardando conferência');
  }catch(e){toast(String(e?.message||e))}
}

async function merchantCopyBillingPixCode(paymentRequestId){
  const request=(globalThis.merchantRuntime?.billing?.paymentRequests||[])
    .find(r=>r.id===paymentRequestId);
  const code=String(request?.pixCharge?.brCode||'');
  if(!code)return toast('Código Pix indisponível');
  try{
    if(navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(code);
    }else{
      const area=document.createElement('textarea');
      area.value=code;
      area.setAttribute('readonly','');
      area.style.position='fixed';
      area.style.opacity='0';
      document.body.appendChild(area);
      area.select();
      if(!document.execCommand('copy'))throw new Error('copy_failed');
      area.remove();
    }
    toast('Código Pix copiado');
  }catch{
    toast('Não foi possível copiar automaticamente. Selecione o código e copie manualmente.');
  }
}

async function merchantRequestBillingPackageFromUi(planKey){
  const billing=globalThis.merchantRuntime?.billing||{};
  const plan=(billing.plans||[]).find(p=>p.planKey===planKey);
  if(!plan)return toast('Pacote não encontrado');
  const reference=prompt('Identificador exato do pagamento (Pix: EndToEndId; transferência/PSP: ID da transação):')||'';
  if(reference.trim().length<6)return toast('Informe o identificador exato da transação');
  if(!confirm('Enviar para conferência o '+plan.displayName+' no valor de '+BRL.format(Number(plan.purchaseAmountCents||0)/100)+'? O crédito só entra após aprovação do admin.'))return;
  try{
    await merchantRequestBillingPackageLive(planKey,reference);
    toast('Solicitação enviada para conferência');
  }catch(e){toast(String(e?.message||e))}
}

async function merchantNotifyStatementPaidFromUi(statementId){
  const billing=globalThis.merchantRuntime?.billing||{};
  const statement=(billing.openStatements||[]).find(s=>s.id===statementId);
  if(!statement)return toast('Fechamento não encontrado');
  const reference=prompt('Identificador exato do pagamento (Pix: EndToEndId; transferência/PSP: ID da transação):')||'';
  if(reference.trim().length<6)return toast('Informe o identificador exato da transação');
  if(!confirm('Informar pagamento de '+BRL.format(Number(statement.amountDueCents||0)/100)+'? O fechamento só será quitado depois da conferência do admin.'))return;
  try{
    await merchantNotifyBillingPaymentLive(statementId,reference);
    toast('Pagamento informado; aguardando conferência');
  }catch(e){toast(String(e?.message||e))}
}

async function merchantCancelBillingRequestFromUi(paymentRequestId){
  if(!confirm('Cancelar esta solicitação financeira pendente? O TAMÃO também tentará invalidar o QR Pix no provedor. Se o pagamento já tiver sido recebido, o cancelamento será bloqueado.'))return;
  try{
    const result=await merchantCancelBillingRequestLive(paymentRequestId);
    const cancel=result?.providerCancellation||{};
    if(Number(cancel.failed||0)>0){
      toast('Solicitação cancelada; o cancelamento do QR no PSP ficou pendente para o Financeiro');
    }else if(Number(cancel.cancelled||0)>0){
      toast('Solicitação e QR Pix cancelados');
    }else{
      toast('Solicitação cancelada');
    }
  }catch(e){toast(String(e?.message||e))}
}

function merchantProviderName(provider){
  const key=String(provider||'').toLowerCase();
  return ({
    mercadopago:'Mercado Pago',
    pagbank:'PagBank',
    stone:'Stone',
    getnet:'Getnet',
    pagarme:'Pagar.me',
    asaas:'Asaas',
    cielo:'Cielo',
    rede:'Rede',
    woovi:'Woovi/OpenPix',
    nubank:'Nu Empresas',
    manual:'Sem integração automática'
  })[key]||String(provider||'PSP');
}
function merchantVerificationLabel(value){
  return ({
    provider:'Automática pelo provedor',
    device:'Automática pelo terminal',
    merchant:'Confirmação da revenda',
    provider_api:'API/webhook',
    merchant_confirmed:'Revenda confirma',
    customer_receipt:'Comprovante do cliente'
  })[String(value||'')]||String(value||'—');
}
function merchantSerializablePaymentRoute(route){
  return {
    paymentMethod:String(route?.paymentMethod||''),
    provider:String(route?.provider||''),
    connectionId:route?.connectionId||null,
    channel:String(route?.channel||'external'),
    verificationMode:String(route?.verificationMode||'merchant_confirmed'),
    active:route?.active===true,
    priority:Number(route?.priority||100),
    customerLabel:route?.customerLabel||null,
    metadata:route?.metadata&&typeof route.metadata==='object'?route.metadata:{}
  };
}
function merchantProviderManualMethods(provider,rt=globalThis.merchantRuntime||{}){
  const supported=Array.isArray(provider?.supportedMethods)?provider.supportedMethods:[];
  const paymentMethods=rt?.merchant?.paymentMethods||{};
  const methods=[];
  if(paymentMethods.pix===true&&supported.includes('pix'))methods.push('pix');
  if(paymentMethods.card===true&&supported.includes('card'))methods.push('card');
  return methods;
}
function merchantProviderManualDeclared(providerKey,rt=globalThis.merchantRuntime||{}){
  return (Array.isArray(rt?.paymentRoutes)?rt.paymentRoutes:[]).some(route=>
    route?.provider===providerKey
    &&route?.verificationMode==='merchant_confirmed'
    &&route?.metadata?.merchantDeclaredProvider===true
  );
}
function merchantProviderManualRoute(provider,paymentMethod){
  const name=String(provider?.displayName||merchantProviderName(provider?.provider));
  return {
    paymentMethod,
    provider:String(provider?.provider||''),
    connectionId:null,
    channel:'delivery',
    verificationMode:'merchant_confirmed',
    active:true,
    priority:Math.min(850,650+Number(provider?.sortOrder||100)),
    customerLabel:paymentMethod==='pix'?'Pix • '+name:'Cartão • '+name,
    metadata:{
      merchantDeclaredProvider:true,
      manualProviderFallback:true,
      automaticVerification:false,
      fundsOwner:'merchant'
    }
  };
}
// V1.269 — operational claims must be derived from actual provider capabilities.
function merchantPaymentProviderStage(provider,account,manualDeclared){
  const connected=account?.connected===true;
  const enabled=connected&&account?.capabilities?.directSalePaymentsEnabled===true;
  const canValidate=connected&&account?.capabilities?.canValidateProviderTransactions===true;
  const e2eVerified=connected&&account?.capabilities?.e2eValidated===true;
  if(enabled&&!canValidate)return {
    label:'INCONSISTENTE',statusClass:'offline',
    next:'A automação está habilitada sem validação confiável. Peça a revisão administrativa antes de usar checkout automático.'
  };
  if(enabled&&canValidate&&e2eVerified)return {
    label:'INTEGRAÇÃO VERIFICADA',statusClass:'online',
    next:'Existe evidência de transação do provedor. Continue acompanhando novas confirmações e possíveis estornos.'
  };
  if(enabled&&canValidate)return {
    label:'AUTOMAÇÃO ATIVA',statusClass:'risk',
    next:'A primeira venda automática ainda precisa produzir evidência real para validar a integração. Não crie pagamentos fictícios.'
  };
  if(connected&&e2eVerified)return {
    label:'AUTOMAÇÃO PAUSADA',statusClass:'risk',
    next:'Há histórico de evidência, mas a automação não está habilitada agora. Solicite nova verificação antes de reativar.'
  };
  if(connected)return {
    label:'CONECTADO',statusClass:'risk',
    next:'A conta está conectada, mas o checkout automático depende de verificação e autorização administrativa.'
  };
  if(manualDeclared)return {
    label:'EM USO • MANUAL',statusClass:'risk',
    next:'Você pode continuar recebendo diretamente pela sua conta; confirme o recebimento manualmente.'
  };
  if(provider?.setupState==='manual_only')return {
    label:'MANUAL DISPONÍVEL',statusClass:'',
    next:'Use a confirmação manual se essa for uma forma de pagamento aceita pela sua revenda.'
  };
  if(provider?.connectReady)return {
    label:'AUTOMAÇÃO DISPONÍVEL',statusClass:'',
    next:'Autorize sua própria conta pelo botão Conectar. A autorização não ativa pagamentos automáticos por si só.'
  };
  return {
    label:provider?.adapterStatus==='planned'?'PLANEJADO':'AUTOMAÇÃO PENDENTE',
    statusClass:'',
    next:'O recebimento manual pode continuar enquanto a integração oficial estiver indisponível.'
  };
}
function merchantPaymentActivationSteps(account,manualDeclared){
  const connected=account?.connected===true;
  const enabled=connected&&account?.capabilities?.directSalePaymentsEnabled===true;
  const canValidate=connected&&account?.capabilities?.canValidateProviderTransactions===true;
  const e2eVerified=connected&&account?.capabilities?.e2eValidated===true;
  return [
    {label:'Provedor informado ou conta conectada',done:manualDeclared||connected},
    {label:'Conexão autenticada da conta',done:connected},
    {label:'Automação autorizada e com validação do PSP',done:enabled&&canValidate},
    {label:'Transação real com evidência verificada',done:e2eVerified&&canValidate}
  ];
}
function merchantPaymentActivationChecklist(account,manualDeclared){
  const steps=merchantPaymentActivationSteps(account,manualDeclared);
  return '<details class="merchant-settings-advanced"><summary>Etapas de verificação automática (opcional)</summary>'+
    '<div class="list">'+steps.map((step,index)=>
      '<div class="list-row"><span>'+Number(index+1)+'. '+esc(step.label)+'</span>'+
      '<span class="status-pill '+(step.done?'online':'')+'">'+(step.done?'CONCLUÍDA':'PENDENTE')+'</span></div>'
    ).join('')+'</div>'+
    '<p class="tiny muted">Etapas pendentes de automação não impedem, por si só, recebimento manual na entrega. A última etapa exige evidência transacional real do PSP; uma simples conexão não basta.</p></details>';
}
function merchantPaymentConnectionsView(rt){
  const providers=(rt.paymentProviders||[]).filter(p=>p.provider!=='manual');
  const accounts=rt.receivingAccounts||[];
  if(!providers.length)return '';
  const priority=['mercadopago','pagbank','stone','getnet','pagarme','asaas','nubank','cielo','rede','woovi'];
  const ordered=[...providers].sort((a,b)=>{
    const ai=priority.indexOf(a.provider),bi=priority.indexOf(b.provider);
    return (ai<0?999:ai)-(bi<0?999:bi);
  });
  // V1.270: current providers first; others are opt-in.
  const configured=ordered.filter(provider=>{
    const account=accounts.find(a=>a.provider===provider.provider);
    return account?.connected===true||merchantProviderManualDeclared(provider.provider,rt);
  });
  const available=ordered.filter(provider=>!configured.includes(provider));
  const renderProvider=provider=>{
    const account=accounts.find(a=>a.provider===provider.provider)||null;
    const connected=account?.connected===true;
    const manualDeclared=merchantProviderManualDeclared(provider.provider,rt);
    const manualMethods=merchantProviderManualMethods(provider,rt);
    const stage=merchantPaymentProviderStage(provider,account,manualDeclared);
    const state=stage.label;
    const stateClass=stage.statusClass;
    const actions=[];
    if(connected){
      actions.push(`<button class="secondary small" onclick="merchantDisconnectProviderFromUi('${esc(provider.provider)}')">Desconectar</button>`);
    }else if(provider.connectReady&&provider.connectionMode==='oauth'){
      actions.push(`<button class="secondary small" onclick="merchantConnectProviderFromUi('${esc(provider.provider)}')">Conectar ${esc(provider.displayName)}</button>`);
    }
    if(!connected&&manualMethods.length){
      actions.push(manualDeclared
        ?`<button class="ghost small" onclick="merchantStopProviderManualUseFromUi('${esc(provider.provider)}')">Parar uso manual</button>`
        :`<button class="secondary small" onclick="merchantUseProviderManuallyFromUi('${esc(provider.provider)}')">Eu uso este PSP</button>`
      );
    }
    const note=provider.provider==='nubank'
      ?'Pode ser usado agora pela revenda com confirmação manual. Se houver integração oficial adequada no futuro, a automação entra como uma camada separada.'
      :provider.provider==='stone'
        ?'Pode ser usado agora sem compartilhar senha ou chave. A confirmação automática Stone permanece separada até a integração estar disponível para esta conta.'
        :provider.provider==='getnet'
          ?'Pode ser usado agora com confirmação da revenda. Terminal/Get Smart automático só será ativado quando a integração estiver disponível para esta conta.'
          :provider.provider==='pagbank'
            ?'A revenda pode usar o PagBank manualmente agora; quando o Connect estiver pronto, poderá autorizar a própria conta sem mudar o fluxo do dinheiro.'
            :provider.notes||'O dinheiro da venda permanece na conta da revenda.';
    const manualDetail=manualDeclared
      ?`<div class="tiny"><strong>Uso declarado pela revenda.</strong> TAMÃO apenas registra o PSP; a confirmação continua manual e não há acesso às credenciais.</div>`
      :!connected&&!manualMethods.length
        ?`<div class="tiny muted">Ative Pix ou cartão nas formas aceitas para declarar este provedor.</div>`
        :'';
    return `<article class="merchant-psp-card">
      <div class="order-head"><div><strong>${esc(provider.displayName)}</strong><br><small>${esc(merchantVerificationLabel(connected?provider.verificationLevel:'merchant'))}</small></div><span class="status-pill ${stateClass}">${esc(state)}</span></div>
      <div class="tiny muted">Aceita: ${esc((provider.supportedMethods||[]).map(x=>x==='card'?'cartão':x).join(' • ')||'—')}</div>
      <p class="tiny muted merchant-psp-note">${esc(note)}</p>
      ${connected?`<div class="tiny"><strong>Conta conectada.</strong> Recebimento direto na revenda • TAMÃO não recebe nem repassa.</div>`:''}
      ${manualDetail}
      <div class="tiny muted" style="margin-top:8px"><strong>Próximo passo:</strong> ${esc(stage.next)}</div>
      ${merchantPaymentActivationChecklist(account,manualDeclared)}
      ${actions.length?`<div class="order-actions">${actions.join('')}</div>`:''}
    </article>`;
  };
  const currentCards=configured.map(renderProvider).join('');
  const availableCards=available.map(renderProvider).join('');
  return `<div class="divider"></div>
    <div class="section-head"><div><span class="section-kicker">RECEBIMENTO DIRETO</span><h3>Seu banco ou maquininha</h3>
    <p>Você pode aceitar Pix, cartão ou dinheiro na entrega sem conectar um banco ao TAMÃO. A integração bancária é opcional.</p></div></div>
    <div class="notice"><strong>Você continua recebendo diretamente.</strong><br>O TAMÃO não recebe nem repassa o dinheiro da venda. A confirmação automática depende de uma integração verificada.</div>
    ${configured.length?
      '<h4 class="merchant-psp-active-heading">Prestadores que você já informou ('+configured.length+')</h4>'+
      '<div class="merchant-psp-grid">'+currentCards+'</div>':
      '<p class="tiny muted">Nenhum prestador adicional informado. Você não precisa escolher um para configurar recebimento na entrega.</p>'}
    ${available.length?'<details class="merchant-psp-optional merchant-settings-advanced"><summary>Escolher outro banco ou maquininha (opcional) • '+available.length+' opções</summary>'+
      '<p class="tiny muted">Marque Pix ou cartão acima e salve antes de informar um prestador. Não pedimos senha nem chave de API para uso manual.</p>'+
      '<div class="merchant-psp-grid">'+availableCards+'</div></details>':''}`;
}

/* V1.170 — checklist visual; only server authorization determines if sales are enabled. */
function merchantSetupSnapshot(rt){
  const m=rt?.merchant||{};
  const stock=Array.isArray(rt?.catalog)?rt.catalog:[];
  const offered=stock.filter(item=>item?.active===true&&Number(item.availableStock)>0&&
    Number(item.priceCents)>0&&merchantTimestampFresh(item.priceConfirmedAt));
  const delivery=m.acceptsCitywide===true&&merchantTimestampFresh(m.deliveryFeeConfirmedAt);
  const methods=m.paymentMethods||{};
  const enabled=['pix','card','cash'].filter(key=>methods[key]===true);
  const matches=key=>enabled.includes(key)||(['card_credit','card_debit'].includes(key)&&enabled.includes('card'));
  const routed=Array.isArray(rt?.paymentRoutes)&&rt.paymentRoutes.some(route=>
    route?.active===true&&matches(String(route.paymentMethod||'')));
  return [
    {key:'products',title:'Produtos e preços',
      detail:offered.length?offered.length+' produto(s) com preço atual e estoque':'Informe os preços e os estoques',
      done:offered.length>0},
    {key:'delivery',title:'Entregas',
      detail:delivery?'Área e taxa de entrega confirmadas':'Escolha sua área, taxa e prazo de entrega',
      done:delivery},
    {key:'payment',title:'Recebimentos',
      detail:enabled.length&&routed?'Forma de pagamento e rota configuradas':'Escolha como o cliente poderá pagar à sua revenda',
      done:Boolean(enabled.length&&routed)}
  ];
}
function merchantSetupView(rt){
  if(!['owner','manager'].includes(String(rt?.merchant?.memberRole||'')))return '';
  const steps=merchantSetupSnapshot(rt);
  const done=steps.filter(item=>item.done).length;
  return '<section class="merchant-essentials" aria-label="Preparação da revenda">'+
    '<div class="merchant-essentials-heading"><div><span class="section-kicker">COMECE PELO ESSENCIAL</span>'+
    '<h2>Prepare sua revenda para vender</h2>'+
    '<p>Produtos, entregas e recebimentos. Você pode revisar cada informação quando precisar.</p></div>'+
    '<span class="merchant-essentials-count">'+done+' de 3 preenchidos</span></div>'+
    '<div class="merchant-essentials-grid">'+steps.map((item,i)=>
      '<div class="merchant-essentials-step"><span aria-hidden="true" class="merchant-essentials-number">'+(i+1)+'</span>'+
      '<div class="merchant-essentials-content"><strong>'+esc(item.title)+'</strong>'+
      '<span>'+esc(item.detail)+'</span>'+
      '<button type="button" class="secondary small" onclick="merchantSetupGo(\''+item.key+'\')">'+
      (item.done?'Revisar':'Configurar')+'</button></div>'+
      '<span class="status-pill '+(item.done?'online':'offline')+'">'+(item.done?'Preenchido':'A revisar')+'</span></div>'
    ).join('')+'</div>'+
    '<p class="merchant-essentials-disclaimer">Esses ajustes não liberam vendas automaticamente. A aprovação, a elegibilidade do catálogo e as condições da cidade são verificadas separadamente pelo TAMÃO.</p>'+
  '</section>';
}
function merchantRevealControl(selector){
  const el=document.querySelector(selector);
  if(!el)return false;
  let node=el.parentElement;
  while(node){
    if(node.tagName==='DETAILS')node.open=true;
    node=node.parentElement;
  }
  el.scrollIntoView?.({behavior:'smooth',block:'center'});
  el.focus?.({preventScroll:true});
  return true;
}
function merchantSetupGo(key){
  if(key==='products'){go('catalog');return;}
  const selectors={delivery:'#live-delivery-fee',payment:'#live-payment-pix'};
  if(!Object.prototype.hasOwnProperty.call(selectors,key))return;
  if(!merchantRevealControl(selectors[key]))toast('Não foi possível abrir a configuração. Atualize o painel.');
}
function merchantEnablementFocus(key){
  const selectors={
    delivery_area:'#live-citywide',
    delivery_fee:'#live-delivery-fee',
    payment_method:'#live-payment-pix',
    payment_route:'.merchant-psp-grid',
    online:'#merchant-online-toggle',
    heartbeat:'#merchant-online-toggle'
  };
  if(key==='inventory'){go('catalog');return}
  if(!Object.prototype.hasOwnProperty.call(selectors,key))return toast('Etapa sem configuração direta. Consulte o requisito.');
  if(!merchantRevealControl(selectors[key]))return toast('Configuração indisponível nesta tela. Atualize o painel.');
}
function merchantEnablementCheckView(check){
  const ok=check?.ok===true;
  const merchantStep=check?.owner==='merchant';
  const buttonKeys=new Set(['inventory','delivery_area','delivery_fee','payment_method','payment_route','online']);
  const key=String(check?.key||'');
  const actionButton=!ok&&merchantStep&&buttonKeys.has(key)
    ?'<button type="button" class="secondary small" onclick="merchantEnablementFocus(\''+esc(key)+'\')">'+
       (key==='inventory'?'Abrir catálogo':'Ir para configuração')+'</button>':'';
  return '<div class="list-row" style="align-items:start"><div style="flex:1">'+
    '<strong>'+(ok?'✓ ':'○ ')+esc(check?.label||'Etapa')+'</strong>'+
    (!ok?'<div class="tiny muted" style="margin-top:4px">'+esc(check?.action||'Revise este requisito')+'</div>':'')+
    (!ok?'<small>'+esc(merchantStep?'Ação da revenda':check?.scope==='realtime'?'Disponibilidade temporária':
        check?.owner==='admin'?'Depende do TAMÃO':'Verificação do sistema')+'</small>':'')+
    '</div><div class="order-actions">'+actionButton+
      '<span class="status-pill '+(ok?'online':'offline')+'">'+(ok?'Conforme':'Pendente')+'</span>'+
    '</div></div>';
}
function merchantEnablementAssistantView(rt){
  const m=rt?.merchant;
  if(!m||!['owner','manager'].includes(String(m.memberRole||'')))return '';
  const diagnostic=rt.enablement?.merchant_id===m.merchantId?rt.enablement:null;
  const checks=Array.isArray(diagnostic?.checks)?diagnostic.checks:[];
  const missing=checks.filter(item=>item?.ok!==true);
  const merchantIssues=missing.filter(item=>item?.owner==='merchant'&&item.key!=='quote_authority');
  const otherIssues=missing.filter(item=>item?.owner!=='merchant');
  const fine=checks.filter(item=>item?.ok===true);
  const ready=diagnostic?.ready===true&&missing.length===0;
  const timestamp=String(diagnostic?.checked_at||'');
  const checkedMs=Date.parse(timestamp);
  const outdated=Number.isFinite(checkedMs)&&Date.now()-checkedMs>3*60*1000;
  const lead=merchantIssues[0]||otherIssues[0]||null;
  const state=ready?'Apta naquele momento':
    !diagnostic?rt.enablementLoading?'Verificando requisitos':'Verificação ainda não concluída':
    merchantIssues.length?'Configurações pendentes':'Aguardando validações';
  return '<section class="section" id="merchant-enablement">'+
    '<div class="section-head"><div><span class="section-kicker">PRÓXIMOS PASSOS</span>'+
      '<h2>Deixar minha revenda pronta para vender</h2>'+
      '<p>Confira o que ainda falta para sua empresa aparecer nas consultas. Algumas etapas dependem da análise do TAMÃO.</p></div>'+
      '<button class="secondary small" type="button" onclick="merchantEnablementRecheck()" '+
        (rt.enablementLoading?'disabled':'')+'>↻ Revalidar</button></div>'+
    '<div class="card flat">'+
      '<div class="status-bar"><strong>'+esc(state)+'</strong><span class="status-pill '+(ready&&!outdated?'online':'offline')+'">'+
        (diagnostic?missing.length+' pendência(s)':'Aguardando consulta')+'</span></div>'+
      (timestamp?'<small>Verificado '+esc(formatDateTime(timestamp))+
        (outdated?' • dados antigos; revalide para confirmar':' • condições podem mudar')+'</small>':'')+
      (rt.enablementError?'<div class="notice danger" style="margin-top:10px">Não foi possível verificar os requisitos: '+esc(rt.enablementError)+'</div>':'')+
      (!diagnostic?'<p class="muted tiny">'+(rt.enablementLoading?'Consultando as condições atuais…':'Use Revalidar para consultar a situação da revenda.')+'</p>':
       '<div class="merchant-kpis" style="margin-top:12px">'+
        '<div class="kpi"><span class="label">Da revenda</span><strong>'+merchantIssues.length+'</strong></div>'+
        '<div class="kpi"><span class="label">Outras verificações</span><strong>'+otherIssues.length+'</strong></div>'+
        '<div class="kpi"><span class="label">Atendidas</span><strong>'+fine.length+'/'+checks.length+'</strong></div>'+
       '</div>'+
       (lead?'<p class="tiny" style="margin-top:10px"><strong>Primeira ação:</strong> '+esc(lead.action||'Revisar requisitos')+'</p>':
        '<p class="tiny" style="margin-top:10px">Não encontramos pendências agora. Sua revenda só aparece para os clientes quando houver produtos e entrega disponíveis para o endereço consultado.</p>')+
       (merchantIssues.length?'<h3 style="margin-top:14px">O que sua revenda pode resolver</h3><div class="list">'+merchantIssues.map(merchantEnablementCheckView).join('')+'</div>':'')+
       (otherIssues.length?'<h3 style="margin-top:14px">Validações e condições adicionais</h3><div class="list">'+otherIssues.map(merchantEnablementCheckView).join('')+'</div>':'')+
       '<details style="margin-top:12px"><summary>Ver '+fine.length+' requisitos já atendidos</summary><div class="list">'+fine.map(merchantEnablementCheckView).join('')+'</div></details>')+
      '<div class="tiny muted" style="margin-top:12px">Esta consulta mostra o que falta. A aprovação dos documentos e a liberação das vendas são feitas separadamente.</div>'+
    '</div></section>';
}
async function merchantEnablementRecheck(){
  try{await merchantLoadEnablement({force:true})}
  catch(error){toast(String(error?.message||error))}
}


function merchantLivePage(){
  const rt=globalThis.merchantRuntime||{};
  if(['disabled','loading'].includes(rt.status)){
    return shell('<section class="page"><h1 class="page-title">Painel da revenda</h1><div class="empty card">Carregando o painel da sua revenda…</div></section>');
  }
  if(rt.status==='unsafe-origin'){
    return shell('<section class="page"><span class="eyebrow">PAINEL REAL BLOQUEADO</span><h1 class="page-title">Origem da revenda não isolada</h1><div class="notice danger"><strong>Não autenticamos operações da revenda em uma origem compartilhada.</strong><br>Use localhost para desenvolvimento ou uma origem dedicada configurada para o painel da revenda.</div></section>');
  }
  if(rt.status==='unauthenticated')return merchantLiveLoginView();
  if(rt.status==='no-access')return merchantLiveNoAccess();
  if(rt.status!=='ready'||!rt.merchant){
    return shell(`<section class="page"><h1 class="page-title">Painel da revenda</h1><div class="notice danger"><strong>Não foi possível carregar a operação.</strong><br>${esc(rt.error||'Tente novamente.')}</div><button class="secondary full" style="margin-top:12px" onclick="merchantLiveRefresh()">Tentar novamente</button></section>`);
  }

  const m=rt.merchant;
  if(m.memberRole==='driver')return merchantDriverLivePage(rt);
  const performance=m.performance||{};
  const capacity=Math.max(1,Number(m.maxActiveOrders||8));
  const acceptsScheduledOrders=m.acceptsScheduledOrders===true;
  const paymentMethods={
    pix:m.paymentMethods?.pix===true,
    card:m.paymentMethods?.card===true,
    cash:m.paymentMethods?.cash===true
  };
  const heartbeatFresh=merchantTimestampFresh(m.lastSeenAt,10/60);
  const connectionHealthy=!m.online||heartbeatFresh;
  const manage=['owner','manager'].includes(m.memberRole);
  const operate=['owner','manager','operator'].includes(m.memberRole);
  const p13=merchantLiveProduct('P13');
  const memberships=rt.memberships||[];
  const deliveryTeam=rt.deliveryTeam||[];
  const orders=rt.orders||[];
  const billing=rt.billing||null;
  const receivingAccount=rt.receivingAccount||null;
  const paymentConnectionsCard=manage?merchantPaymentConnectionsView(rt):'';
  const financialHold=billing?.account?.salesHold===true;
  const freshness=merchantLiveFreshness();
  const freshnessProblems=[];
  if(!freshness.deliveryFresh)freshnessProblems.push('taxa de entrega vencida');
  if(m.acceptsCitywide===false)freshnessProblems.push('atendimento na cidade desativado');
  if(freshness.staleProducts.length)freshnessProblems.push('preço vencido: '+freshness.staleProducts.map(x=>x.productName||x.productCode).join(', '));
  if(!freshness.offerable.length)freshnessProblems.push('nenhum produto ativo com estoque');
  if(!Object.values(paymentMethods).some(Boolean))freshnessProblems.push('nenhuma forma de pagamento confirmada');
  const commercialReady=freshness.allFresh&&m.acceptsCitywide!==false&&Object.values(paymentMethods).some(Boolean);
  const freshnessNotice=!commercialReady
    ? '<div class="notice danger" style="margin-top:12px"><strong>Ainda falta confirmar alguns dados para vender.</strong><br>'+esc(freshnessProblems.join(' • '))+'. Sua revenda aparece nas consultas quando tiver área de atendimento, frete, preços e estoque confirmados.</div>'
    : '';

  const compliance=m.compliance||{};
  const hasGlp=(rt.catalog||[]).some(item=>item.active&&/^P([1-9][0-9]?)$/.test(String(item.productCode||''))&&Number(String(item.productCode).slice(1))<=90);
  const cnpjCurrent=compliance.cnpjCurrent===true;
  const anpCurrent=compliance.anpCurrent===true;
  const complianceReady=cnpjCurrent&&anpCurrent;
  const cnpjWhen=compliance.cnpjVerifiedAt?formatDateTime(compliance.cnpjVerifiedAt):'nunca';
  const anpWhen=compliance.anpVerifiedAt?formatDateTime(compliance.anpVerifiedAt):(hasGlp?'nunca':'não exigida para o catálogo atual');
  const complianceNotice=complianceReady
    ? `<div class="notice success" style="margin-top:12px"><strong>Compliance vigente.</strong><br>CNPJ: ${esc(cnpjWhen)} • janela operacional ${Number(compliance.cnpjMaxAgeDays||30)} dias. ${hasGlp?`ANP: ${esc(anpWhen)} • janela operacional ${Number(compliance.anpMaxAgeDays||7)} dias.`:'Sem GLP ativo no catálogo; ANP não é exigida para a operação atual.'}</div>`
    : `<div class="notice danger" style="margin-top:12px"><strong>Revalidação necessária antes de operar.</strong><br>${!cnpjCurrent?`CNPJ: última verificação ${esc(cnpjWhen)}; revalidar a cada ${Number(compliance.cnpjMaxAgeDays||30)} dias. `:''}${!anpCurrent?`ANP: última verificação ${esc(anpWhen)}; revalidar a cada ${Number(compliance.anpMaxAgeDays||7)} dias para GLP.`:''}</div>`;
  const canGoOnline=m.status==='active'&&complianceReady&&commercialReady&&!financialHold;
  const connectionNotice=!connectionHealthy
    ? '<div class="notice danger" style="margin-top:12px"><strong>Conexão da operação sem confirmação recente.</strong><br>Enquanto a presença da revenda não for renovada, novos pedidos podem deixar de ser enviados para esta operação.</div>'
    : rt.heartbeatError
      ? '<div class="notice" style="margin-top:12px"><strong>Reconectando presença da revenda.</strong><br>'+esc(rt.heartbeatError)+'</div>'
      : '';

  return shell(`<section class="page">
    <div class="status-bar"><div><div class="tiny muted">PAINEL REAL • ${esc(String(m.memberRole||'').toUpperCase())}</div><h1 class="page-title" style="margin-bottom:2px">${esc(m.name)}</h1></div><span class="status-pill ${m.online?(heartbeatFresh?'online':'risk'):'offline'}">${m.online?(heartbeatFresh?'● ONLINE':'● SEM CONEXÃO'):'OFFLINE'}</span></div>

    ${rt.error?`<div class="notice danger" style="margin-top:12px">${esc(rt.error)}</div>`:''}
    ${connectionNotice}
    ${complianceNotice}
    ${freshnessNotice}
    ${financialHold?'<div class="notice danger" style="margin-top:12px"><strong>Novas vendas suspensas por pendência financeira.</strong><br>Regularize o fechamento vencido. Pedidos já aceitos continuam disponíveis normalmente.</div>':''}
    <section class="section" id="merchant-live-orders"><div class="section-head"><div><h2>Pedidos que exigem ação</h2><p>Aceite, saída e recebimento só são registrados depois de confirmação no sistema.</p></div></div>${merchantDeliveryAttentionView(rt)}${merchantOrderQueueView(orders)}</section>

    ${merchantSetupView(rt)}
    ${merchantBusinessPulseSection(m)}
    ${merchantAdsInterestSection(m)}
    ${merchantClubeInterestSection(m)}
    ${merchantClubeTermsSection(m)}
    ${merchantAdsCampaignSection(m)}
    ${merchantGrowthNetworkSection(m)}
    ${merchantAlertControl()}
    <details class="merchant-diagnostic-drawer"><summary>Verificações de documentos e habilitação</summary>
      ${merchantEnablementAssistantView(rt)}
    </details>

    <div class="card flat form-stack" style="margin-top:14px">
      ${memberships.length>1?`<div class="input-wrap"><label for="merchant-live-select">Operação</label><select id="merchant-live-select" class="input" onchange="merchantLiveSelect(this.value)">${memberships.map(x=>`<option value="${esc(x.merchantId)}" ${x.merchantId===m.merchantId?'selected':''}>${esc(x.name)} • ${esc(x.memberRole)}</option>`).join('')}</select></div>`:''}
      <div class="order-actions"><button class="secondary small" onclick="merchantLiveRefresh()">Atualizar</button>${manage?'<button class="secondary small" onclick="merchantOpenTeam()">Equipe</button>':''}${operate?`<button id="merchant-online-toggle" class="${m.online?'danger-btn':'primary'} small" onclick="merchantLiveToggleOnline(${m.online?'false':'true'})" ${!m.online&&!canGoOnline?'disabled title="'+(financialHold?'Regularize o fechamento financeiro vencido antes de ficar online':'Regularize compliance, preços e logística antes de ficar online')+'"':''}>${m.online?'Pausar novos pedidos':'Ficar online'}</button>`:''}<button class="ghost small" onclick="merchantLiveLogout()">Sair</button></div>
    </div>

    <section class="section"><div class="merchant-kpis">
      <div class="kpi"><span class="label">${p13?.pricingMode==='range'?'Preço normal P13':'Preço P13'}</span><strong>${p13?BRL.format(Number(p13.priceCents||0)/100):'—'}</strong>${p13?.pricingMode==='range'?'<small>'+BRL.format(Number(p13.minPriceCents||0)/100)+'–'+BRL.format(Number(p13.maxPriceCents||0)/100)+'</small>':''}</div>
      <div class="kpi"><span class="label">Estoque P13</span><strong>${p13?Number(p13.availableStock||0):'—'}</strong></div>
      <div class="kpi"><span class="label">Trust</span><strong>${Number(m.trustScore||0)}/100</strong></div>
      <div class="kpi"><span class="label">Pedidos ativos</span><strong>${orders.length}/${capacity}</strong><small>capacidade simultânea</small></div>
      <div class="kpi"><span class="label">Concluídos 90d</span><strong>${Number(performance.completedOrders||0)}</strong></div>
      <div class="kpi"><span class="label">Conclusão pós-aceite</span><strong>${performance.completionRate==null?'—':Math.round(Number(performance.completionRate)*100)+'%'}</strong></div>
      <div class="kpi"><span class="label">No prazo</span><strong>${performance.onTimeRate==null?'—':Math.round(Number(performance.onTimeRate)*100)+'%'}</strong></div>
    </div></section>



    ${merchantBillingLiveView(rt)}

    ${manage?`<details id="merchant-operation-settings" class="merchant-settings-drawer"><summary>Configurações da revenda <span>Preços, entregas, pagamentos e outras opções</span></summary><div class="card flat form-stack">
      <h3>Preço e estoque P13</h3>
      ${p13?.pricingMode==='range'?'<div class="notice"><strong>Faixa automática ativa.</strong><br>Autorizada de '+BRL.format(Number(p13.minPriceCents||0)/100)+' a '+BRL.format(Number(p13.maxPriceCents||0)/100)+'. Este atalho altera o preço normal e o estoque; edite limites e estratégia no catálogo.</div>':''}
      <div class="field-row"><div class="input-wrap"><label for="live-p13-price">${p13?.pricingMode==='range'?'Preço normal':'Preço'}</label><input id="live-p13-price" inputmode="decimal" type="number" min="0.01" max="10000" step="0.10" class="input" value="${p13?(Number(p13.priceCents||0)/100).toFixed(2):''}"></div><div class="input-wrap"><label for="live-p13-stock">Estoque disponível</label><input id="live-p13-stock" inputmode="numeric" type="number" min="0" max="100000" class="input" value="${p13?Number(p13.availableStock||0):0}"></div></div>
      <button class="secondary" onclick="merchantLiveSaveP13()">Confirmar preço e estoque P13</button><button class="ghost" onclick="go('catalog')">Editar todos os produtos</button>
      <div class="divider"></div>
      <h3>Entrega</h3>
      <div class="field-row"><div class="input-wrap"><label for="live-delivery-fee">Taxa de entrega</label><input id="live-delivery-fee" inputmode="decimal" type="number" min="0" max="1000" step="0.10" class="input" value="${(Number(m.deliveryFeeCents||0)/100).toFixed(2)}"></div><div class="input-wrap"><label for="live-eta">ETA base (min)</label><input id="live-eta" inputmode="numeric" type="number" min="5" max="180" class="input" value="${Number(m.baseEtaMinutes||30)}"></div></div>
      <label class="check-row"><input id="live-citywide" type="checkbox" ${m.acceptsCitywide!==false?'checked':''}><span><strong>Atende minha cidade</strong><small>Usado no filtro de ofertas da cidade cadastrada.</small></span></label>
      <button class="secondary" onclick="merchantLiveSaveLogistics()">Salvar logística</button>
      <div class="divider"></div>
      <details class="merchant-settings-advanced"><summary>Capacidade de atendimento</summary><div class="form-stack"><h3>Capacidade simultânea</h3>
      <div class="input-wrap"><label for="live-capacity">Máximo de pedidos ativos ao mesmo tempo</label><input id="live-capacity" inputmode="numeric" type="number" min="1" max="100" class="input" value="${capacity}"><small class="field-help">Ao atingir este limite, a revenda deixa de receber novas ofertas até liberar capacidade. Pedidos existentes não são cancelados.</small></div>
      <button class="secondary" onclick="merchantLiveSaveCapacity()">Salvar capacidade</button></div></details>
      <div class="divider"></div>
      <h3>Formas de pagamento aceitas do cliente</h3>
      <p class="muted tiny">Escolha o que sua revenda realmente aceita. Nenhuma dessas opções exige Mercado Pago ou qualquer outro PSP específico.</p>
      <label class="check-row"><input id="live-payment-pix" type="checkbox" ${paymentMethods.pix?'checked':''}><span><strong>Pix</strong><small>Pagamento via Pix aceito pela operação.</small></span></label>
      <label class="check-row"><input id="live-payment-card" type="checkbox" ${paymentMethods.card?'checked':''}><span><strong>Cartão</strong><small>Cartão aceito na entrega conforme sua operação.</small></span></label>
      <label class="check-row"><input id="live-payment-cash" type="checkbox" ${paymentMethods.cash?'checked':''}><span><strong>Dinheiro</strong><small>Dinheiro aceito; o pedido pode informar troco.</small></span></label>
      <button class="secondary" onclick="merchantLiveSavePaymentMethods()">Salvar formas de pagamento</button>
      ${paymentConnectionsCard}
      <div class="divider"></div>
      <details class="merchant-settings-advanced"><summary>Agendamento de entregas</summary><div class="form-stack"><h3>Pedidos agendados</h3>
      <label class="check-row"><input id="live-scheduled-orders" type="checkbox" ${acceptsScheduledOrders?'checked':''}><span><strong>Aceitar entregas agendadas</strong><small>Quando ativo, clientes podem escolher janelas futuras de até 72 horas. O horário aparece antes do aceite.</small></span></label>
      <button class="secondary" onclick="merchantLiveSaveScheduling()">Salvar agendamento</button></div></details>
    </div></details>`:''}

  </section>`);
}

function merchantScheduledDispatchState(o){
  if(!o?.deliveryWindowStart)return {scheduled:false,ready:true,opensAt:null};
  const start=Date.parse(o.deliveryWindowStart);
  const eta=Math.max(5,Math.min(180,Number(merchantRuntime.merchant?.baseEtaMinutes||30)));
  const opensAt=start-(eta+30)*60000;
  return {
    scheduled:true,
    ready:Date.now()>=opensAt,
    opensAt:Number.isFinite(opensAt)?new Date(opensAt).toISOString():null
  };
}

function merchantFormatPhone(value){
  const d=String(value||'').replace(/\D/g,'').slice(0,11);
  if(d.length===10)return '('+d.slice(0,2)+') '+d.slice(2,6)+'-'+d.slice(6);
  if(d.length===11)return '('+d.slice(0,2)+') '+d.slice(2,7)+'-'+d.slice(7);
  return d;
}

/* V1.174: order queue is UI-only; every transition is confirmed by the server. */

/* V1.177: attention signals are advisory, based on server timestamps and the browser clock.
   They never change order status, imply delivery, or permit a backend transition. */
function merchantOrderAttention(order,now=Date.now()){
  const status=String(order?.status||'');
  const preparing=['PREPARING','AT_RISK'].includes(status);
  const enRoute=['OUT_FOR_DELIVERY','ARRIVING'].includes(status);
  if(!preparing&&!enRoute)return status==='AT_RISK'
    ?{level:'risk',label:'Imprevisto operacional',detail:'Verifique a situação registrada e as ações disponíveis.'}
    :null;
  const deadline=merchantOrderScheduleDate(preparing?order?.dispatchDueAt:order?.promisedBy);
  const delta=deadline?deadline.getTime()-now:null;
  const validClock=Number.isFinite(now)&&now>=Date.UTC(2020,0,1);
  const late=validClock&&delta!==null&&Number.isFinite(delta)&&delta<0;
  const soon=validClock&&delta!==null&&Number.isFinite(delta)&&delta>=0&&delta<=15*60*1000;
  if(status==='AT_RISK')return {
    level:'risk',label:'Imprevisto operacional',
    detail:late?'A referência de saída já passou. Confira a situação antes de agir.'
      :'Verifique o problema informado e o próximo passo do pedido.'
  };
  if(late)return {
    level:'late',label:preparing?'Revisar prazo de saída':'Revisar previsão de entrega',
    detail:preparing?'O prazo de saída registrado já passou. Confira a situação atual.'
      :'A previsão registrada já passou. Verifique com a equipe antes de confirmar a entrega.'
  };
  if(soon)return {
    level:'soon',label:preparing?'Prazo de saída próximo':'Previsão de entrega próxima',
    detail:preparing?'Confira se tudo está pronto para iniciar a entrega.'
      :'Acompanhe o pedido e registre a chegada quando acontecer.'
  };
  return null;
}
function merchantFocusLiveOrder(orderId){
  const id=String(orderId||'');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return false;
  const card=document.getElementById('merchant-order-card-'+id);
  if(!card)return false;
  card.scrollIntoView?.({behavior:'smooth',block:'center'});
  card.focus?.({preventScroll:true});
  return true;
}
function merchantOrderAttentionSummary(orders){
  const attention=(Array.isArray(orders)?orders:[])
    .map(order=>({order,signal:merchantOrderAttention(order)}))
    .filter(item=>item.signal)
    .sort((a,b)=>{
      const levels={risk:0,late:1,soon:2};
      return (levels[a.signal.level]??3)-(levels[b.signal.level]??3);
    });
  if(!attention.length)return '';
  const rows=attention.slice(0,5).map(({order,signal})=>{
    const id=String(order?.orderId||'');
    const valid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
    return '<div class="merchant-order-attention-item"><div><strong>'+esc(order?.publicCode||'Pedido')+
      '</strong><span>'+esc(signal.label)+'</span></div>'+
      (valid?'<button type="button" class="secondary small" onclick="merchantFocusLiveOrder(\''+id+'\')">Ver pedido</button>':'')+'</div>';
  }).join('');
  return '<section class="merchant-order-attention-summary" aria-label="Pedidos que precisam de atenção">'+
    '<div class="merchant-order-attention-heading"><strong>'+attention.length+
      (attention.length===1?' pedido merece atenção':' pedidos merecem atenção')+'</strong>'+
      '<p>Referências de prazo e imprevistos do sistema. Confira a situação antes de agir.</p></div>'+
    '<div class="merchant-order-attention-list">'+rows+'</div>'+
    (attention.length>5?'<small>Há outros pedidos sinalizados nas seções abaixo.</small>':'')+
    '<button type="button" class="ghost small" onclick="merchantLiveRefresh()">Atualizar pedidos</button>'+
    '</section>';
}
function merchantOrderAttentionCard(order){
  const signal=merchantOrderAttention(order);
  return signal?'<div class="merchant-order-attention-inline merchant-order-attention-'+signal.level+
    '" role="status"><strong>'+esc(signal.label)+'</strong><span>'+esc(signal.detail)+
    '</span><small>Verifique as informações atuais. Este aviso não altera o pedido.</small></div>':'';
}

function merchantOrderQueueView(orders,emptyCopy='Nenhum pedido ativo para esta revenda.'){
  const all=Array.isArray(orders)?orders:[];
  if(!all.length)return '<div class="empty card">'+esc(emptyCopy)+'</div>';
  const groups=[
    {key:'offers',title:'Novos pedidos para aceitar',hint:'Confirme se pode atender antes do prazo.',statuses:['OFFERED_TO_MERCHANT']},
    {key:'risk',title:'Pedidos que precisam de atenção',hint:'Confira o problema antes de continuar.',statuses:['AT_RISK']},
    {key:'delivery',title:'Entregas em andamento',hint:'Registre chegada e conclusão somente quando acontecerem.',statuses:['OUT_FOR_DELIVERY','ARRIVING']},
    {key:'preparing',title:'Pedidos em preparação',hint:'Confirme a saída somente quando iniciar a entrega.',statuses:['MERCHANT_ACCEPTED','PREPARING']}
  ];
  const known=new Set(groups.flatMap(group=>group.statuses));
  const unknown=all.filter(order=>!known.has(String(order?.status||'')));
  if(unknown.length)groups.push({key:'other',title:'Outros pedidos',
    hint:'Confira o estado atual antes de agir.',statuses:[...new Set(unknown.map(order=>String(order?.status||'')))]});
  const queues=groups.map(group=>({...group,orders:all.filter(order=>group.statuses.includes(String(order?.status||'')))}));
  const titles={offers:'Para aceitar',risk:'Precisam atenção',delivery:'Em entrega',preparing:'Preparando'};
  const stats=queues.filter(group=>group.key!=='other').map(group=>
    '<div class="merchant-order-queue-stat"><strong>'+group.orders.length+'</strong><span>'+titles[group.key]+'</span></div>').join('');
  const sections=queues.filter(group=>group.orders.length).map(group=>{
    const sorted=group.key==='offers'?[...group.orders].sort((a,b)=>{
      const at=Date.parse(String(a.offerExpiresAt||'')),bt=Date.parse(String(b.offerExpiresAt||''));
      return (Number.isFinite(at)?at:Number.MAX_SAFE_INTEGER)-(Number.isFinite(bt)?bt:Number.MAX_SAFE_INTEGER);
    }):group.orders;
    return '<section class="merchant-order-queue-group merchant-order-group-'+group.key+'">'+
      '<div class="merchant-order-queue-heading"><div><h3>'+esc(group.title)+'</h3><p>'+esc(group.hint)+'</p></div>'+
      '<span class="merchant-order-queue-count">'+sorted.length+'</span></div>'+
      sorted.map(merchantLiveOrder).join('')+'</section>';
  }).join('');
  return '<div class="merchant-order-queue" aria-label="Fila de pedidos da revenda">'+
    merchantOrderAttentionSummary(all)+
    '<div class="merchant-order-queue-stats">'+stats+'</div>'+sections+'</div>';
}


/* V1.175: suggestions use current server-scoped assignments, never implied availability. */
function merchantDeliveryCandidates(rt){
  const people=Array.isArray(rt?.deliveryTeam)?rt.deliveryTeam:[];
  const orders=Array.isArray(rt?.orders)?rt.orders:[];
  const count=new Map();
  for(const order of orders){
    const id=String(order?.assignedDeliveryUserId||'');
    if(id&&['PREPARING','AT_RISK','OUT_FOR_DELIVERY','ARRIVING'].includes(order?.status)){
      count.set(id,(count.get(id)||0)+1);
    }
  }
  return people.filter(member=>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(member?.userId||''))&&
    ['owner','manager','operator','driver'].includes(String(member?.memberRole||''))
  ).map(member=>({...member,assignedCount:count.get(String(member.userId))||0}))
    .sort((a,b)=>(a.memberRole==='driver'?0:1)-(b.memberRole==='driver'?0:1)
      ||a.assignedCount-b.assignedCount
      ||String(a.displayName||'').localeCompare(String(b.displayName||''),'pt-BR'));
}
function merchantDeliveryUnassigned(orders){
  return (Array.isArray(orders)?orders:[]).filter(order=>
    ['PREPARING','AT_RISK'].includes(String(order?.status||''))
    &&!order?.assignedDeliveryUserId);
}
function merchantFocusDeliveryAssignment(orderId){
  const id=String(orderId||'');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return false;
  const select=document.getElementById('delivery-'+id);
  if(!select)return false;
  for(let parent=select.parentElement;parent;parent=parent.parentElement){
    if(parent.tagName==='DETAILS')parent.open=true;
  }
  select.scrollIntoView?.({block:'center',behavior:'smooth'});
  select.focus?.({preventScroll:true});
  return true;
}
function merchantDeliveryAttentionView(rt){
  const role=String(rt?.merchant?.memberRole||'');
  if(!['owner','manager'].includes(role))return '';
  const pending=merchantDeliveryUnassigned(rt?.orders);
  if(!pending.length)return '';
  const hasMembers=merchantDeliveryCandidates(rt).length>0;
  const rows=pending.slice(0,4).map(order=>{
    const id=String(order.orderId||'');
    const safe=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
    return '<div class="merchant-delivery-reminder-row"><span>'+esc(order.publicCode||'Pedido')+
      '</span>'+(safe&&hasMembers?'<button class="secondary small" type="button" onclick="merchantFocusDeliveryAssignment(\''+id+'\')">Escolher responsável</button>':'')+'</div>';
  }).join('');
  return '<section class="merchant-delivery-reminders" aria-label="Entregas sem responsável">'+
    '<div class="merchant-delivery-reminders-title"><strong>'+pending.length+' '+(pending.length===1?'pedido precisa':'pedidos precisam')+
    ' de responsável</strong><span>Antes da saída, distribua as entregas entre sua equipe.</span></div>'+
    '<div class="merchant-delivery-reminder-items">'+rows+'</div>'+
    (!hasMembers?'<button class="secondary small" type="button" onclick="merchantOpenTeam()">Adicionar alguém à equipe</button>':'')+
    (pending.length>4?'<small>Outros pedidos sem responsável aparecem na fila de preparação.</small>':'')+
    '</section>';
}


/* V1.176 — trusted order milestones use only server timestamps and server status. */
function merchantOrderEventDate(value){
  if(typeof value!=='string'||!/^20\d\d-\d\d-\d\dT/.test(value))return null;
  const ms=Date.parse(value);
  if(!Number.isFinite(ms)||ms>Date.now()+5*60*1000||ms<Date.UTC(2020,0,1))return null;
  return new Date(ms);
}
function merchantOrderScheduleDate(value){
  if(typeof value!=='string'||!/^20\d\d-\d\d-\d\dT/.test(value))return null;
  const ms=Date.parse(value);
  if(!Number.isFinite(ms)||ms<Date.UTC(2020,0,1)||ms>Date.now()+180*24*60*60*1000)return null;
  return new Date(ms);
}
function merchantOrderProgressView(order){
  const status=String(order?.status||'');
  const stages={
    OFFERED_TO_MERCHANT:0,MERCHANT_ACCEPTED:1,PREPARING:1,AT_RISK:1,
    OUT_FOR_DELIVERY:2,ARRIVING:3,DELIVERED:4
  };
  const stage=Object.prototype.hasOwnProperty.call(stages,status)?stages[status]:-1;
  const names=['Pedido registrado','Aceite da revenda','Saída para entrega','Chegada informada','Entrega concluída'];
  const stamps=[order?.createdAt,order?.acceptedAt,order?.dispatchedAt,order?.arrivingAt,order?.deliveredAt];
  const events=names.map((name,i)=>{
    const timestamp=merchantOrderEventDate(stamps[i]);
    const recorded=!!timestamp&&i<=stage;
    const isCurrent=i===stage;
    const label=recorded
      ?'Confirmado em '+timestamp.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})
      :isCurrent?'Etapa atual informada pelo sistema'+(i>0?' (sem horário neste registro)':'')
        :i<stage?'Etapa anterior (sem horário neste registro)':'Aguardando confirmação';
    return '<li class="merchant-order-milestone '+(recorded?'recorded':isCurrent?'current':'waiting')+'">'+
      '<span class="merchant-order-milestone-dot" aria-hidden="true"></span>'+
      '<div><strong>'+esc(name)+'</strong><small>'+esc(label)+'</small></div></li>';
  }).join('');
  const currentLabel={
    OFFERED_TO_MERCHANT:'Aguardando aceite da revenda',
    MERCHANT_ACCEPTED:'Aceito pela revenda',
    PREPARING:'Em preparação',
    AT_RISK:'Atenção operacional necessária',
    OUT_FOR_DELIVERY:'Saiu para entrega',
    ARRIVING:'Chegada informada',
    DELIVERED:'Entrega concluída'
  }[status]||'Status em atualização';
  const dispatchDeadline=merchantOrderScheduleDate(order?.dispatchDueAt);
  const promised=merchantOrderScheduleDate(order?.promisedBy);
  const formatDate=d=>d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  const deadlines=[
    dispatchDeadline?'Prazo de saída registrado: '+formatDate(dispatchDeadline):'',
    promised?'Previsão de entrega registrada: '+formatDate(promised):''
  ].filter(Boolean);
  return '<details class="merchant-order-progress"'+(status==='AT_RISK'?' open':'')+'>'+
    '<summary><span>Acompanhar etapas <small>'+esc(currentLabel)+'</small></span></summary>'+
    '<div class="merchant-order-progress-body"><ol class="merchant-order-milestones">'+events+'</ol>'+
    (deadlines.length?'<p class="merchant-order-predictions">'+esc(deadlines.join(' • '))+
      '<small>Previsões não são confirmações de entrega.</small></p>':'')+
    '</div></details>';
}


/* V1.178 — support a responsible decision; these instructions never mutate the order. */
function merchantIncidentAdvice(reason){
  const choices={
    stock_issue:{
      title:'Falta ou divergência de estoque',
      guidance:'Confira o estoque físico e a quantidade reservada. Se não conseguir cumprir este pedido, registre a impossibilidade e depois atualize o estoque do catálogo.',
      next:'Revisar estoque no catálogo após a confirmação.'
    },
    vehicle_issue:{
      title:'Problema com o veículo',
      guidance:'Verifique se existe transporte adequado e seguro para a entrega. Se não houver como cumprir o pedido, registre a impossibilidade.',
      next:'Não confirme saída sem o transporte realmente disponível.'
    },
    staffing_issue:{
      title:'Equipe indisponível',
      guidance:'Consulte quem pode realizar a entrega. Proprietário e gerente podem revisar os responsáveis no painel. Se não conseguir atender, registre a impossibilidade.',
      next:'Não atribua a entrega a alguém sem confirmação da equipe.'
    },
    other_operational:{
      title:'Outro imprevisto operacional',
      guidance:'Confira os dados do pedido e o que impede a entrega. Caso não consiga concluir, informe a impossibilidade ao sistema.',
      next:'Não confirme saída ou entrega antes da execução real.'
    }
  };
  return Object.prototype.hasOwnProperty.call(choices,reason)?choices[reason]:null;
}
function merchantIncidentRiskGuide(order){
  if(order?.status!=='AT_RISK')return '';
  const advice=merchantIncidentAdvice(String(order?.riskReason||''));
  return '<div class="merchant-incident-risk-guide"><strong>Como proceder com este imprevisto</strong><p>'+
    esc(advice?.guidance||'Confira o problema informado pelo sistema e se ainda é possível cumprir o pedido. Se não for possível, selecione o motivo correto em “Não consigo concluir este pedido”.')+
    '</p><small>Nenhuma alternativa ou novo responsável é confirmado automaticamente por este aviso.</small></div>';
}
function merchantIncidentChoiceChanged(id){
  const select=document.getElementById('reason-'+id);
  const advice=merchantIncidentAdvice(String(select?.value||''));
  const box=document.getElementById('merchant-incident-guide-'+id);
  if(box)box.textContent=advice?advice.guidance+' '+advice.next:'Selecione o motivo para ver como proceder.';
  const confirmation=document.getElementById('merchant-incident-confirm-'+id);
  if(confirmation)confirmation.checked=false;
  merchantIncidentAcknowledged(id);
}
function merchantIncidentAcknowledged(id){
  const reason=String(document.getElementById('reason-'+id)?.value||'');
  const checked=document.getElementById('merchant-incident-confirm-'+id)?.checked===true;
  const button=document.getElementById('merchant-incident-submit-'+id);
  if(button)button.disabled=!(checked&&merchantIncidentAdvice(reason));
}

function merchantLiveOrder(o){
  const items=(o.items||[]).map(i=>`${Number(i.quantity)}× ${esc(i.productName||i.productCode||'Item')}`).join(' • ');
  const total=BRL.format(Number(o.totalCents||0)/100);
  const copy=statusCopy[o.status]||[o.status,''];
  const address=o.addressVisible&&o.address?'📍 '+esc(o.address):'📍 Endereço protegido até o aceite';
  const currentRole=String(globalThis.merchantRuntime?.merchant?.memberRole||'');
  const canAssignDelivery=['owner','manager'].includes(currentRole);
  const deliveryTeam=merchantDeliveryCandidates(globalThis.merchantRuntime||{});
  const nextStepCopy={
    OFFERED_TO_MERCHANT:'Confirme se consegue preparar e entregar este pedido.',
    MERCHANT_ACCEPTED:'Prepare os itens e confirme somente quando sair para entregar.',
    PREPARING:'Quando iniciar a entrega, confirme a saída.',
    AT_RISK:'Verifique o problema antes de confirmar a saída.',
    OUT_FOR_DELIVERY:'Ao se aproximar do endereço, avise que está chegando.',
    ARRIVING:'Confira a entrega, o código informado pelo cliente e o pagamento.'
  }[o.status]||'';
  const assignedLabel=o.assignedDeliveryUserId
    ? merchantDeliveryMemberLabel(o.assignedDeliveryUserId)
    : '';
  const needsAssignment=canAssignDelivery&&['PREPARING','AT_RISK'].includes(o.status);
  const assignmentChoices=deliveryTeam.map(member=>`<option value="${esc(member.userId)}" ${member.userId===o.assignedDeliveryUserId?'selected':''}>${esc(member.displayName||'Membro da equipe')} • ${member.memberRole==='driver'?'Motorista':'Equipe'} • ${member.assignedCount} ${member.assignedCount===1?'pedido ativo':'pedidos ativos'}</option>`).join('');
  const assignmentForm=needsAssignment&&deliveryTeam.length
    ? `<fieldset class="merchant-delivery-assign-form form-stack" ${globalThis.merchantRuntime?.actionPending===true?'disabled':''}>
        <div class="input-wrap"><label for="delivery-${o.orderId}">Quem fará a entrega?</label>
          <select id="delivery-${o.orderId}" class="input" onchange="merchantDeliveryAssignmentChanged('${o.orderId}')"><option value="">Escolha uma pessoa da equipe</option>${assignmentChoices}</select>
          <small class="field-help">Os números mostram apenas pedidos ativos neste painel; não indicam disponibilidade.</small>
        </div>
        <span class="merchant-delivery-unsaved" id="delivery-feedback-${o.orderId}" aria-live="polite">A atribuição só será confirmada depois de salvar.</span>
        <button type="button" id="delivery-save-${o.orderId}" class="secondary small" onclick="merchantLiveAssignDelivery('${o.orderId}')">${o.assignedDeliveryUserId?'Salvar alteração':'Confirmar responsável'}</button>
      </fieldset>`
    :needsAssignment
      ? '<div class="merchant-delivery-no-team"><strong>Escolha quem fará a entrega.</strong><span>Adicione uma pessoa à sua equipe para atribuir este pedido.</span><button type="button" class="secondary small" onclick="merchantOpenTeam()">Gerenciar equipe</button></div>'
      :'';
  const assignmentControl=needsAssignment
    ? `<div class="merchant-delivery-assignment"><div class="merchant-delivery-assignment-heading"><strong>${o.assignedDeliveryUserId?'Responsável definido':'Entrega sem responsável'}</strong><small>${o.assignedDeliveryUserId?'Você pode alterar antes de sair para entregar.':'Escolha alguém da equipe antes de iniciar a entrega.'}</small></div>${o.assignedDeliveryUserId?`<details class="merchant-delivery-change"><summary>Alterar responsável</summary>${assignmentForm}</details>`:assignmentForm}</div>`
    : '';
  const deliveryContact=o.deliveryDetailsVisible
    ? `<div class="notice" style="margin-top:10px"><strong>Dados para entrega</strong>${o.postalCode?`<br>CEP: ${esc(String(o.postalCode).replace(/^(\d{5})(\d{3})$/,'$1-$2'))}`:''}<br>${o.customerPhone?`Telefone: <a href="tel:${esc(String(o.customerPhone))}">${esc(merchantFormatPhone(o.customerPhone))}</a>`:'Telefone não informado'}${o.addressComplement?`<br>Complemento: ${esc(o.addressComplement)}`:''}${o.deliveryReference?`<br>Referência: ${esc(o.deliveryReference)}`:''}${o.deliveryNotes?`<br>Instruções: ${esc(o.deliveryNotes)}`:''}</div>`
    : '';
  let actions='';

  if(o.status==='OFFERED_TO_MERCHANT'){
    const secs=o.offerExpiresAt?Math.max(0,Math.ceil((Date.parse(o.offerExpiresAt)-Date.now())/1000)):0;
    actions=`<button class="primary small" onclick="merchantLiveAction('${o.orderId}','accept')">Aceitar pedido</button><button class="danger-btn small" onclick="merchantLiveAction('${o.orderId}','reject')">Não consigo atender</button><span class="tiny muted">Prazo ~${secs}s</span>`;
  }else if(o.status==='MERCHANT_ACCEPTED'){
    actions='<span class="merchant-order-transition-note">Pedido aceito. A preparação será atualizada pelo sistema antes de liberar a saída.</span>';
  }else if(['PREPARING','AT_RISK'].includes(o.status)){
    const scheduleState=merchantScheduledDispatchState(o);
    const dispatchButton=scheduleState.scheduled&&!scheduleState.ready
      ? `<button class="primary small" disabled>Saída ainda bloqueada</button><span class="tiny muted">Liberada por volta de ${scheduleState.opensAt?esc(new Date(scheduleState.opensAt).toLocaleString('pt-BR')):'mais perto da janela'}</span>`
      : `<button class="primary small" onclick="merchantLiveAction('${o.orderId}','dispatch')">Confirmar saída</button>`;
    actions=`${dispatchButton}<details class="merchant-order-exception merchant-incident-reason">
      <summary>Não consigo concluir este pedido</summary>
      <div class="merchant-incident-form form-stack">
        <p class="merchant-incident-intro">Informe o que impede sua revenda de concluir esta entrega. Nenhuma alteração será feita antes da confirmação.</p>
        <label for="reason-${o.orderId}">O que aconteceu?</label>
        <select id="reason-${o.orderId}" class="input" onchange="merchantIncidentChoiceChanged('${o.orderId}')">
          <option value="">Selecione o motivo</option>
          <option value="stock_issue">Problema de estoque</option>
          <option value="vehicle_issue">Problema com o veículo</option>
          <option value="staffing_issue">Equipe indisponível</option>
          <option value="other_operational">Outro problema operacional</option>
        </select>
        <div class="merchant-incident-guide" id="merchant-incident-guide-${o.orderId}" aria-live="polite">Selecione o motivo para ver como proceder.</div>
        <label class="check-row merchant-incident-ack">
          <input id="merchant-incident-confirm-${o.orderId}" type="checkbox" onchange="merchantIncidentAcknowledged('${o.orderId}')">
          <span><strong>Confirmo que não conseguirei cumprir este pedido</strong>
            <small>O TAMÃO registrará a impossibilidade e reavaliará o pedido conforme suas regras. Isso não garante outra revenda disponível.</small>
          </span>
        </label>
        <button type="button" id="merchant-incident-submit-${o.orderId}" class="danger-btn small" disabled onclick="merchantLiveCannotFulfill('${o.orderId}')">Registrar impossibilidade</button>
      </div>
    </details>`;
  }else if(o.status==='OUT_FOR_DELIVERY'){
    actions=`<button class="secondary small" onclick="merchantLiveAction('${o.orderId}','arriving')">Estou chegando</button>`;
  }else if(o.status==='ARRIVING'){
    actions=`<label class="sr-only" for="live-pin-${o.orderId}">PIN de entrega</label><input id="live-pin-${o.orderId}" inputmode="numeric" maxlength="4" class="input pin-input" placeholder="PIN"><label class="check-row"><input id="live-paid-${o.orderId}" type="checkbox"><span><strong>Pagamento recebido</strong><small>Obrigatório para liquidar o pedido.</small></span></label><button class="primary small" onclick="merchantLiveDeliver('${o.orderId}')">Confirmar entrega</button>`;
  }

  return `<article tabindex="-1" class="order-card ${o.status==='OFFERED_TO_MERCHANT'?'new':''}" id="merchant-order-card-${esc(o.orderId)}">
    <div class="order-head"><div><div class="order-id">${esc(o.publicCode||o.orderId)}</div><div class="order-line">${items||'Itens do pedido'}</div></div><div style="text-align:right"><strong>${total}</strong><div class="tiny muted">${esc(copy[0])}</div></div></div>
    ${merchantOrderAttentionCard(o)}
    ${merchantIncidentRiskGuide(o)}
    ${merchantOrderProgressView(o)}
    <div class="order-line">${address}</div><div class="order-line">Pagamento: ${esc(paymentLabel(o.paymentMethod))}</div>${o.paymentMethod==='cash'&&o.cashTenderCents?`<div class="order-line"><strong>Troco para: ${BRL.format(Number(o.cashTenderCents)/100)}</strong></div>`:''}${o.deliveryWindowStart?`<div class="notice success" style="margin-top:10px"><strong>Entrega agendada</strong><br>${esc(formatDeliveryWindow(o.deliveryWindowStart,o.deliveryWindowEnd))}</div>`:''}
    ${deliveryContact?`<details class="merchant-order-contact" ${['OUT_FOR_DELIVERY','ARRIVING'].includes(o.status)?'open':''}><summary>Endereço e contato para entrega</summary>${deliveryContact}</details>`:''}
    ${assignedLabel?`<div class="notice success" style="margin-top:10px"><strong>Responsável pela entrega:</strong> ${esc(assignedLabel)}</div>`:''}
    ${assignmentControl}
    ${o.riskReason?`<div class="notice danger" style="margin-top:10px">${esc(o.riskReason)}</div>`:''}
    ${nextStepCopy?`<div class="merchant-order-next"><strong>Próxima ação</strong><span>${esc(nextStepCopy)}</span></div>`:'' }
    <div class="order-actions merchant-live-actions"><fieldset class="merchant-order-action-fieldset" ${globalThis.merchantRuntime?.actionPending===true?'disabled':''}>${actions}</fieldset></div>
  </article>`;
}

async function merchantEnableAlertsFromUi(){
  try{
    const status=await merchantEnableAlertsLive();
    toast(status?.notificationPermission==='denied'
      ?'Alertas sonoros ativados; notificações do navegador estão bloqueadas'
      :'Alertas de novos pedidos ativados');
  }catch(e){toast(String(e?.message||e))}
}
function merchantDisableAlertsFromUi(){
  try{
    merchantDisableAlertsLive();
    toast('Alertas desativados neste aparelho');
  }catch(e){toast(String(e?.message||e))}
}

async function merchantTeamReloadFromUi(){
  try{await merchantTeamLoadLive();toast('Equipe atualizada')}catch(e){toast(String(e?.message||e))}
}
async function merchantTeamInviteFromUi(){
  const email=String(document.getElementById('team-email')?.value||'').trim();
  const role=String(document.getElementById('team-role')?.value||'driver');
  const displayName=String(document.getElementById('team-display-name')?.value||'').trim();
  try{
    const result=await merchantTeamInviteLive(email,role,displayName);
    toast(result?.status==='linked'?'Conta vinculada à equipe':'Convite pendente criado');
  }catch(e){toast(String(e?.message||e))}
}
async function merchantTeamRevokeMemberFromUi(userId){
  try{
    await merchantTeamRevokeMemberLive(userId);
    toast('Acesso do membro revogado');
  }catch(e){toast(String(e?.message||e))}
}
async function merchantTeamRevokeInviteFromUi(inviteId){
  try{
    await merchantTeamRevokeInviteLive(inviteId);
    toast('Convite cancelado');
  }catch(e){toast(String(e?.message||e))}
}
async function copyMerchantTeamInstructionsByInvite(inviteId){
  const id=String(inviteId||'');
  const invite=(globalThis.merchantRuntime?.team?.pendingInvites||[]).find(x=>String(x.inviteId||'')===id);
  if(!invite)return toast('Convite não encontrado');
  return copyMerchantTeamInstructions(invite.email);
}
async function copyMerchantTeamInstructions(email){
  const url=location.origin+location.pathname+'?merchant=1#merchant';
  const message='Você foi convidado para a equipe no TAMÃO. Acesse '+url+' e entre usando exatamente este e-mail: '+String(email||'');
  try{
    if(navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(message);
      toast('Instruções copiadas');
      return;
    }
  }catch{}
  toast('Não foi possível copiar automaticamente');
}

async function merchantLoginFromUi(){
  const email=document.querySelector('#merchant-email')?.value.trim()||'';
  try{await merchantSendLogin(email);toast('Link de acesso enviado')}catch(e){toast(String(e?.message||e))}
}
async function merchantLiveRefresh(){
  try{await merchantRefresh();toast('Operação atualizada')}catch(e){toast(String(e?.message||e))}
}
function merchantDeliveryAssignmentChanged(id){
  const note=document.getElementById('delivery-feedback-'+id);
  if(note)note.textContent='Alteração ainda não salva. Confirme para enviar ao sistema.';
}
async function merchantLiveAssignDelivery(id){
  const rt=globalThis.merchantRuntime||{};
  if(rt.actionPending===true)return;
  if(!['owner','manager'].includes(String(rt.merchant?.memberRole||'')))return toast('Somente o proprietário ou gerente pode atribuir entregas');
  const order=(rt.orders||[]).find(item=>item.orderId===id);
  if(!order||!['PREPARING','AT_RISK'].includes(order.status))return toast('Atualize os pedidos antes de escolher o responsável');
  const deliveryUserId=String(document.getElementById('delivery-'+id)?.value||'');
  if(!deliveryUserId)return toast('Escolha um responsável pela entrega');
  if(!merchantDeliveryCandidates(rt).some(member=>member.userId===deliveryUserId))return toast('Responsável indisponível na equipe atual. Atualize o painel');
  if(order.assignedDeliveryUserId===deliveryUserId)return toast('Este responsável já está atribuído ao pedido');
  const button=document.getElementById('delivery-save-'+id);
  if(button){button.disabled=true;button.textContent='Confirmando…';}
  try{
    await merchantAssignDeliveryLive(id,deliveryUserId);
    toast('Responsável pela entrega confirmado');
  }catch(e){toast(String(e?.message||e))}
  finally{
    if(button){button.disabled=false;button.textContent=order.assignedDeliveryUserId?'Salvar alteração':'Confirmar responsável';}
  }
}
async function merchantLiveSaveMemberProfile(){
  const name=String(document.getElementById('driver-display-name')?.value||'').trim();
  try{
    await merchantUpdateMemberProfileLive(name);
    toast('Nome operacional atualizado');
  }catch(e){toast(String(e?.message||e))}
}
async function merchantLiveSelect(id){
  try{await merchantSelectLive(id)}catch(e){toast(String(e?.message||e))}
}
async function merchantLiveToggleOnline(online){
  try{await merchantSetOnlineLive(online);toast(online?'Revenda online':'Novos pedidos pausados')}catch(e){toast(String(e?.message||e))}
}
const merchantCatalogSaving=new Set();
async function merchantLiveSaveProduct(code){
  if(merchantCatalogSaving.has(code))return;
  const price=Number(document.getElementById('live-price-'+code)?.value);
  const stock=Number(document.getElementById('live-stock-'+code)?.value);
  const active=document.getElementById('live-active-'+code)?.checked===true;
  const pricingMode=String(document.getElementById('live-pricing-mode-'+code)?.value||'fixed');
  const pricingStrategy=String(document.getElementById('live-pricing-strategy-'+code)?.value||'balanced');
  const minPrice=Number(document.getElementById('live-min-price-'+code)?.value);
  const maxPrice=Number(document.getElementById('live-max-price-'+code)?.value);
  if(!Number.isFinite(price)||price<=0||price>10000||!Number.isInteger(stock)||stock<0||stock>100000)return toast('Revise preço e estoque de '+code);
  if(pricingMode==='range'){
    if(!Number.isFinite(minPrice)||!Number.isFinite(maxPrice)||minPrice<=0||maxPrice>10000||minPrice>price||price>maxPrice){
      return toast('Na faixa automática: mínimo ≤ preço normal ≤ máximo.');
    }
  }
  const saveButton=document.getElementById('live-save-product-'+code);
  const buttonText=saveButton?.textContent||'Salvar preço e estoque';
  merchantCatalogSaving.add(code);
  if(saveButton){saveButton.disabled=true;saveButton.textContent='Salvando…';}
  try{
    await merchantUpdateProductLive(code,Math.round(price*100),stock,active,{
      pricingMode,
      minPriceCents:pricingMode==='range'?Math.round(minPrice*100):Math.round(price*100),
      maxPriceCents:pricingMode==='range'?Math.round(maxPrice*100):Math.round(price*100),
      pricingStrategy
    });
    toast(pricingMode==='range'?'Faixa de preço de '+code+' confirmada':'Preço fixo de '+code+' confirmado');
  }catch(e){toast(String(e?.message||e))}
  finally{
    merchantCatalogSaving.delete(code);
    if(saveButton){saveButton.disabled=false;saveButton.textContent=buttonText;}
  }
}

function merchantPricingModeChanged(code){
  const mode=String(document.getElementById('live-pricing-mode-'+code)?.value||'fixed');
  const range=mode==='range';
  for(const id of ['live-min-price-'+code,'live-max-price-'+code,'live-pricing-strategy-'+code]){
    const el=document.getElementById(id);
    if(el)el.disabled=!range;
  }
}

async function merchantLiveSaveP13(){
  const price=Number(document.querySelector('#live-p13-price')?.value);
  const stock=Number(document.querySelector('#live-p13-stock')?.value);
  if(!Number.isFinite(price)||price<=0||price>10000||!Number.isInteger(stock)||stock<0)return toast('Revise preço e estoque');
  try{await merchantUpdateProductLive('P13',Math.round(price*100),stock,true);toast('Preço e estoque confirmados')}catch(e){toast(String(e?.message||e))}
}
async function merchantLiveSaveLogistics(){
  const fee=Number(document.querySelector('#live-delivery-fee')?.value);
  const eta=Number(document.querySelector('#live-eta')?.value);
  const citywide=document.querySelector('#live-citywide')?.checked===true;
  if(!Number.isFinite(fee)||fee<0||!Number.isInteger(eta)||eta<5||eta>180)return toast('Revise taxa e ETA');
  try{await merchantUpdateLogisticsLive(Math.round(fee*100),eta,citywide);toast(citywide?'Logística atualizada':'Logística atualizada. Novos pedidos foram pausados até reativar a cobertura da cidade.')}catch(e){toast(String(e?.message||e))}
}
async function merchantLiveSaveCapacity(){
  const capacity=Number(document.querySelector('#live-capacity')?.value);
  if(!Number.isInteger(capacity)||capacity<1||capacity>100)return toast('Informe uma capacidade entre 1 e 100 pedidos');
  try{
    await merchantUpdateCapacityLive(capacity);
    toast('Capacidade operacional atualizada');
  }catch(e){toast(String(e?.message||e))}
}

async function merchantConnectProviderFromUi(provider){
  const name=merchantProviderName(provider);
  try{
    await merchantPaymentConnectLive(provider,'start');
  }catch(e){toast(String(e?.message||e))}
}
async function merchantDisconnectProviderFromUi(provider){
  const name=merchantProviderName(provider);
  if(!confirm('Desconectar '+name+' desta revenda? Nenhum dinheiro será movimentado.'))return;
  try{
    await merchantPaymentConnectLive(provider,'disconnect');
    toast(name+' desconectado');
  }catch(e){toast(String(e?.message||e))}
}
async function merchantUseProviderManuallyFromUi(providerKey){
  const rt=globalThis.merchantRuntime||{};
  const provider=(rt.paymentProviders||[]).find(x=>x.provider===providerKey);
  if(!provider)return toast('Provedor indisponível');
  const methods=merchantProviderManualMethods(provider,rt);
  if(!methods.length)return toast('Ative Pix ou cartão antes de declarar este provedor');
  const existing=Array.isArray(rt.paymentRoutes)?rt.paymentRoutes:[];
  const routes=existing
    .filter(route=>!(route.provider===providerKey&&route?.metadata?.merchantDeclaredProvider===true))
    .map(merchantSerializablePaymentRoute);
  routes.push(...methods.map(method=>merchantProviderManualRoute(provider,method)));
  if(routes.length>30)return toast('Limite de rotas atingido. Desative um provedor antes de adicionar outro.');
  try{
    await merchantUpdatePaymentRoutesLive(
      routes,
      'Revenda declarou uso manual de '+merchantProviderName(providerKey)+'; automação permanece desativada.'
    );
    toast(merchantProviderName(providerKey)+' registrado para uso manual');
  }catch(e){toast(String(e?.message||e))}
}
async function merchantStopProviderManualUseFromUi(providerKey){
  const rt=globalThis.merchantRuntime||{};
  const name=merchantProviderName(providerKey);
  if(!confirm('Parar de declarar uso manual de '+name+'? Isso não desconecta nenhuma integração automática já configurada.'))return;
  const existing=Array.isArray(rt.paymentRoutes)?rt.paymentRoutes:[];
  const routes=existing
    .filter(route=>!(route.provider===providerKey&&route?.metadata?.merchantDeclaredProvider===true))
    .map(merchantSerializablePaymentRoute);
  if(!routes.length)return toast('Mantenha ao menos uma forma de recebimento ativa');
  try{
    await merchantUpdatePaymentRoutesLive(routes,'Revenda removeu declaração de uso manual de '+name+'.');
    toast('Uso manual de '+name+' removido');
  }catch(e){toast(String(e?.message||e))}
}
async function merchantConnectMercadoPagoFromUi(){
  return merchantConnectProviderFromUi('mercadopago');
}
async function merchantDisconnectMercadoPagoFromUi(){
  return merchantDisconnectProviderFromUi('mercadopago');
}

function merchantManualPaymentRoute(paymentMethod){
  if(paymentMethod==='pix'){
    return {
      paymentMethod:'pix',provider:'manual',channel:'delivery',
      verificationMode:'merchant_confirmed',active:true,priority:900,
      customerLabel:'Pix na entrega'
    };
  }
  if(paymentMethod==='card'){
    return {
      paymentMethod:'card',provider:'manual',channel:'delivery',
      verificationMode:'merchant_confirmed',active:true,priority:900,
      customerLabel:'Cartão na entrega'
    };
  }
  return {
    paymentMethod:'cash',provider:'manual',channel:'delivery',
    verificationMode:'merchant_confirmed',active:true,priority:900,
    customerLabel:'Dinheiro'
  };
}
async function merchantLiveSavePaymentMethods(){
  const methods={
    pix:document.querySelector('#live-payment-pix')?.checked===true,
    card:document.querySelector('#live-payment-card')?.checked===true,
    cash:document.querySelector('#live-payment-cash')?.checked===true
  };
  if(!Object.values(methods).some(Boolean))return toast('Ative pelo menos uma forma de pagamento');

  const selected=(paymentMethod)=>{
    if(paymentMethod==='pix')return methods.pix;
    if(['card','card_credit','card_debit'].includes(paymentMethod))return methods.card;
    if(paymentMethod==='cash')return methods.cash;
    return true;
  };
  const rt=globalThis.merchantRuntime||{};
  const existing=Array.isArray(rt.paymentRoutes)?rt.paymentRoutes:[];
  const preserved=existing
    .filter(route=>route.provider!=='manual'&&selected(route.paymentMethod))
    .map(route=>({
      paymentMethod:route.paymentMethod,
      provider:route.provider,
      connectionId:route.connectionId||null,
      channel:route.channel,
      verificationMode:route.verificationMode,
      active:route.active===true,
      priority:Number(route.priority||100),
      customerLabel:route.customerLabel||null,
      metadata:route.metadata||{}
    }));
  const automaticKeys=new Set(
    preserved.map(route=>[route.paymentMethod,route.provider,route.channel].join('|'))
  );
  const accounts=Array.isArray(rt.receivingAccounts)?rt.receivingAccounts:[];
  const providers=Array.isArray(rt.paymentProviders)?rt.paymentProviders:[];
  for(const account of accounts){
    if(
      account?.connected!==true
      ||account?.capabilities?.directSalePaymentsEnabled!==true
      ||account?.capabilities?.canValidateProviderTransactions!==true
    )continue;
    const provider=providers.find(x=>x.provider===account.provider);
    if(!provider||provider.adapterStatus!=='implemented')continue;
    const supported=Array.isArray(provider.supportedMethods)?provider.supportedMethods:[];
    const desired=[];
    if(methods.pix&&supported.includes('pix'))desired.push('pix');
    if(methods.card){
      const cardMethods=['card','card_credit','card_debit'].filter(x=>supported.includes(x));
      desired.push(...cardMethods);
    }
    for(const paymentMethod of desired){
      const device=provider.verificationLevel==='device';
      const channel=device?'delivery':'online';
      const key=[paymentMethod,provider.provider,channel].join('|');
      if(automaticKeys.has(key))continue;
      preserved.push({
        paymentMethod,
        provider:provider.provider,
        connectionId:account.id,
        channel,
        verificationMode:device?'device':'provider_api',
        active:true,
        priority:100+Number(provider.sortOrder||100),
        customerLabel:
          paymentMethod==='pix'?'Pix':
          paymentMethod==='card_credit'?'Cartão de crédito':
          paymentMethod==='card_debit'?'Cartão de débito':'Cartão',
        metadata:{autoManaged:true}
      });
      automaticKeys.add(key);
    }
  }
  const extraManual=existing
    .filter(route=>route.provider==='manual'&&!['pix','card','cash'].includes(route.paymentMethod))
    .map(route=>({
      paymentMethod:route.paymentMethod,
      provider:'manual',
      connectionId:null,
      channel:route.channel,
      verificationMode:route.verificationMode,
      active:route.active===true,
      priority:Number(route.priority||900),
      customerLabel:route.customerLabel||null,
      metadata:route.metadata||{}
    }));
  const routes=[
    ...preserved,
    ...extraManual,
    ...(methods.pix?[merchantManualPaymentRoute('pix')]:[]),
    ...(methods.card?[merchantManualPaymentRoute('card')]:[]),
    ...(methods.cash?[merchantManualPaymentRoute('cash')]:[])
  ];
  try{
    await merchantUpdatePaymentRoutesLive(
      routes,
      'Revenda atualizou os meios aceitos pelo cliente.'
    );
    toast('Formas de pagamento atualizadas sem alterar quem recebe o dinheiro');
  }catch(e){toast(String(e?.message||e))}
}

async function merchantLiveSaveScheduling(){
  const accepts=document.querySelector('#live-scheduled-orders')?.checked===true;
  try{
    await merchantUpdateSchedulingLive(accepts);
    toast(accepts?'Pedidos agendados ativados':'Pedidos agendados pausados');
  }catch(e){toast(String(e?.message||e))}
}

async function merchantLiveAction(id,action){
  if(globalThis.merchantRuntime?.actionPending===true)return;
  try{
    const result=await merchantPerformAction(id,action);
    if(action==='accept'&&result?.autoRescued){
      const messages={
        stock_changed_before_accept:'O estoque mudou; o pedido foi redirecionado automaticamente.',
        delivery_capability_changed_before_accept:'A capacidade logística mudou; o pedido foi redirecionado automaticamente.',
        merchant_unavailable_before_accept:'A operação ficou indisponível; o pedido foi redirecionado automaticamente.',
        offer_expired:'O prazo expirou; o sistema já buscou outra opção.'
      };
      toast(messages[result.rescueReason]||'O aceite não pôde ser concluído; o pedido foi redirecionado automaticamente.');
      return;
    }
    toast(action==='accept'?'Pedido aceito':action==='reject'?'Pedido devolvido ao matching':action==='dispatch'?'Saída confirmada':'Chegada confirmada');
  }catch(e){toast(String(e?.message||e))}
}
async function merchantLiveCannotFulfill(id){
  const rt=globalThis.merchantRuntime||{};
  if(rt.actionPending===true)return;
  const order=(Array.isArray(rt.orders)?rt.orders:[]).find(item=>item.orderId===id);
  if(!order||!['PREPARING','AT_RISK'].includes(String(order.status||''))){
    return toast('Atualize o pedido antes de registrar a impossibilidade.');
  }
  const reason=String(document.getElementById('reason-'+id)?.value||'');
  if(!merchantIncidentAdvice(reason))return toast('Selecione o motivo correto do imprevisto.');
  if(document.getElementById('merchant-incident-confirm-'+id)?.checked!==true){
    return toast('Confirme que sua revenda não conseguirá cumprir este pedido.');
  }
  try{
    await merchantPerformAction(id,'cannot-fulfill',reason);
    toast('Impossibilidade registrada. Confira o estado atualizado do pedido.');
  }catch(e){toast(String(e?.message||e))}
}
async function merchantLiveDeliver(id){
  if(globalThis.merchantRuntime?.actionPending===true)return;
  const pin=document.getElementById('live-pin-'+id)?.value.trim()||'';
  const paid=document.getElementById('live-paid-'+id)?.checked===true;
  try{await merchantCompleteDeliveryLive(id,pin,paid);toast('Entrega e pagamento confirmados')}catch(e){toast(String(e?.message||e))}
}
async function merchantLiveLogout(){
  await merchantSignOut();toast('Sessão encerrada');
}

function merchantPage(){
  if(globalThis.merchantPortalRequested?.())return merchantLivePage();
  if(globalThis.__CHAMA_TEST__!==true)return merchantRealPortalRequired();
  const m=merchantById(state.selectedMerchant)||state.merchants[0];
  const orders=state.orders.filter(o=>o.merchantId===m.id&&['OFFERED_TO_MERCHANT','MERCHANT_ACCEPTED','PREPARING','AT_RISK','OUT_FOR_DELIVERY','ARRIVING'].includes(o.status));
  const fresh=isPriceFresh(m);
  const internalPilot=globalThis.CHAMA_INTERNAL_PILOT===true;
  const policy=m.pricingP13||{mode:'fixed',min:m.priceP13,preferred:m.priceP13,max:m.priceP13,strategy:'balanced'};
  const autoPrice=Number(productPrice(m,'P13',1));
  return shell(`<section class="page"><div class="status-bar"><div><div class="tiny muted">${internalPilot?'PAINEL DA REVENDA — AMBIENTE INTERNO':'PAINEL DA REVENDA'}</div><h1 class="page-title" style="margin-bottom:2px">${esc(m.name)}</h1></div><span class="status-pill ${m.online?'online':'offline'}">${m.online?'● ONLINE':'OFFLINE'}</span></div>
${internalPilot?'<div class="notice" style="margin-top:12px"><strong>Ambiente interno.</strong><br>Faixa comercial P13 configurada para validação. As ações desta tela não alteram a operação pública.</div>':''}
<div class="card flat form-stack"><div class="input-wrap"><label for="merchant-select">Revenda</label><select id="merchant-select" class="input" onchange="selectMerchant(this.value)">${state.merchants.map(x=>`<option value="${x.id}" ${x.id===m.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><button class="${m.online?'secondary':'primary'}" onclick="toggleOnline('${m.id}')">${m.online?'Pausar novos pedidos':'Ficar online'}</button></div>
${!fresh?'<div class="notice danger" style="margin-top:12px"><strong>Preço expirado.</strong> A oferta não aparece ao cliente até ser reconfirmada.</div>':''}
<section class="section"><div class="merchant-kpis"><div class="kpi"><span class="label">${policy.mode==='range'?'Preço automático agora':'Preço P13'}</span><strong>${BRL.format(autoPrice)}</strong>${policy.mode==='range'?'<small>normal '+BRL.format(m.priceP13)+'</small>':''}</div><div class="kpi"><span class="label">Estoque P13</span><strong>${m.inventory.P13}</strong></div><div class="kpi"><span class="label">${internalPilot?'Trust simulado':'Trust'}</span><strong>${m.trust}</strong></div><div class="kpi"><span class="label">Pedidos ativos</span><strong>${orders.length}</strong></div></div></section>
<div class="card flat form-stack">
<div class="field-row">
  <div class="input-wrap"><label for="m-pricing-mode">Modo de preço</label><select id="m-pricing-mode" class="input" onchange="merchantDemoPricingModeChanged()"><option value="fixed" ${policy.mode==='fixed'?'selected':''}>Preço fixo</option><option value="range" ${policy.mode==='range'?'selected':''}>Faixa automática</option></select></div>
  <div class="input-wrap"><label for="m-price">${policy.mode==='range'?'Preço normal P13':'Preço P13'}</label><input id="m-price" inputmode="decimal" type="number" min="0.01" max="9999" step="0.10" class="input" value="${m.priceP13}"></div>
  <div class="input-wrap"><label for="m-stock">Estoque disponível P13</label><input id="m-stock" inputmode="numeric" type="number" min="0" max="9999" class="input" value="${m.inventory.P13}"></div>
</div>
<div class="field-row">
  <div class="input-wrap"><label for="m-price-min">Mínimo autorizado</label><input id="m-price-min" inputmode="decimal" type="number" min="0.01" max="9999" step="0.10" class="input" value="${policy.min}" ${policy.mode==='range'?'':'disabled'}></div>
  <div class="input-wrap"><label for="m-price-max">Máximo autorizado</label><input id="m-price-max" inputmode="decimal" type="number" min="0.01" max="9999" step="0.10" class="input" value="${policy.max}" ${policy.mode==='range'?'':'disabled'}></div>
  <div class="input-wrap"><label for="m-pricing-strategy">Estratégia</label><select id="m-pricing-strategy" class="input" ${policy.mode==='range'?'':'disabled'}><option value="volume" ${policy.strategy==='volume'?'selected':''}>Priorizar volume</option><option value="balanced" ${policy.strategy==='balanced'?'selected':''}>Equilibrado</option><option value="margin" ${policy.strategy==='margin'?'selected':''}>Priorizar margem</option></select></div>
</div>
<div class="notice"><strong>${policy.mode==='range'?'Faixa automática de preço':'Preço fixo'}.</strong><br>${policy.mode==='range'?'O TAMÃO ajusta somente entre '+BRL.format(policy.min)+' e '+BRL.format(policy.max)+', usando estoque e carga desta revenda.':'O preço não muda automaticamente.'} ${internalPilot?'Nada nesta tela altera a condição comercial real do JR.':''}</div>
<button class="secondary" onclick="merchantUpdate('${m.id}')">Confirmar política e estoque</button><div class="tiny muted">Última confirmação: ${esc(formatDateTime(m.priceConfirmedAt))}</div></div>
<section class="section"><div class="section-head"><div><h2>Pedidos que exigem ação</h2><p>${internalPilot?'Use estes pedidos para treinar aceite, saída, chegada e conclusão. Nenhuma ação é real.':'Aceitar significa assumir compromisso real de atendimento.'}</p></div></div>${orders.length?orders.map(merchantOrder).join(''):`<div class="empty card">Nenhum pedido ativo para esta revenda.</div>`}</section></section>`)
}
function merchantOrder(o){
  const copy=statusCopy[o.status]||[o.status,''];
  const items=(o.items||[]).map(i=>`${i.qty}× ${esc(i.name)}`).join(' • ')||Object.entries(o.cart||{}).filter(([,q])=>q>0).map(([k,q])=>`${q}× ${esc(products[k]?.name||k)}`).join(' • ');
  let actions='';
  if(o.status==='OFFERED_TO_MERCHANT'){
    const secs=Math.max(0,Math.ceil((Date.parse(o.offerExpiresAt)-Date.now())/1000));
    actions=`<button class="primary small" onclick="merchantAction('${o.id}','accept')">Aceitar pedido</button><button class="danger-btn small" onclick="merchantAction('${o.id}','reject')">Não consigo atender</button><span class="tiny muted">Prazo: ~${secs}s</span>`;
  }else if(['MERCHANT_ACCEPTED','PREPARING','AT_RISK'].includes(o.status)){
    actions=`<button class="primary small" onclick="merchantAction('${o.id}','dispatch')">Confirmar saída</button><button class="danger-btn small" onclick="merchantAction('${o.id}','cannot-fulfill')">Não consigo concluir</button>`;
  }else if(o.status==='OUT_FOR_DELIVERY'){
    actions=`<button class="secondary small" onclick="merchantAction('${o.id}','arriving')">Estou chegando</button>`;
  }else if(o.status==='ARRIVING'){
    actions=`<label class="sr-only" for="pin-${o.id}">PIN de entrega</label><input id="pin-${o.id}" inputmode="numeric" maxlength="4" class="input pin-input" placeholder="PIN"><label class="check-row"><input id="paid-${o.id}" type="checkbox"><span><strong>Pagamento recebido</strong><small>Obrigatório para concluir o pedido.</small></span></label><button class="primary small" onclick="merchantAction('${o.id}','deliver')">Confirmar entrega</button>`;
  }
  const addressLine=o.status==='OFFERED_TO_MERCHANT'?'📍 Endereço protegido até o aceite':'📍 '+esc(o.address);
  return `<article class="order-card ${o.status==='OFFERED_TO_MERCHANT'?'new':''}"><div class="order-head"><div><div class="order-id">${esc(o.id)}</div><div class="order-line">${items}</div></div><div style="text-align:right"><strong>${BRL.format(o.total)}</strong><div class="tiny muted">${esc(copy[0])}</div></div></div><div class="order-line">${addressLine}</div><div class="order-line">Pagamento: ${esc(paymentLabel(o.paymentMethod))}</div><div class="order-actions">${actions}</div></article>`;
}
function selectMerchant(id){if(merchantById(id)){state.selectedMerchant=id;save();render()}}
function toggleOnline(id){
  const m=merchantById(id);if(!m)return toast('Revenda não encontrada');
  const r=m.online?pauseMerchant(id):resumeMerchant(id);
  toast(r.ok?(m.online?'Revenda online':'Novos pedidos pausados'):r.error);
  render();
}
function merchantDemoPricingModeChanged(){
  const range=document.querySelector('#m-pricing-mode')?.value==='range';
  for(const id of ['m-price-min','m-price-max','m-pricing-strategy']){
    const el=document.getElementById(id);if(el)el.disabled=!range;
  }
}
function merchantUpdate(id){
  const price=document.querySelector('#m-price')?.value;
  const stock=document.querySelector('#m-stock')?.value;
  const pricingMode=document.querySelector('#m-pricing-mode')?.value||'fixed';
  const pricingMin=document.querySelector('#m-price-min')?.value;
  const pricingMax=document.querySelector('#m-price-max')?.value;
  const pricingStrategy=document.querySelector('#m-pricing-strategy')?.value||'balanced';
  const r=updateMerchant(id,{priceP13:price,stockP13:stock,pricingMode,pricingMin,pricingMax,pricingStrategy});
  toast(r.ok?(pricingMode==='range'?'Faixa de preço confirmada':'Preço e estoque confirmados'):r.error);render();
}
function merchantAction(id,action){
  let r={ok:false,error:'Ação inválida'};
  if(action==='accept')r=acceptOrder(id);
  if(action==='reject')r=rejectOrder(id);
  if(action==='dispatch')r=dispatchOrder(id);
  if(action==='cannot-fulfill')r=failAcceptedOrder(id,'A revenda informou uma falha operacional antes da saída.');
  if(action==='arriving')r=arrivingOrder(id);
  if(action==='deliver'){
    const pin=document.querySelector('#pin-'+CSS.escape(id))?.value.trim()||'';
    const paid=document.querySelector('#paid-'+CSS.escape(id))?.checked===true;
    r=deliverOrder(id,pin,paid);
  }
  const successMessages={accept:'Pedido aceito e estoque reservado',reject:'Pedido recusado; o sistema buscou alternativa','cannot-fulfill':'Estoque devolvido; o sistema buscou outra revenda',dispatch:'Saída confirmada — o cliente agora vê “A caminho”',arriving:'Chegada confirmada',deliver:'Entrega e pagamento confirmados; benefícios processados'};
  toast(r.ok?successMessages[action]:r.error);
  render();
}
function merchantOrders(){
  if(globalThis.merchantPortalRequested?.())return merchantLivePage();
  if(globalThis.__CHAMA_TEST__!==true)return merchantRealPortalRequired();
  state.mode='merchant';save();return merchantPage()
}
function catalog(){
  if(globalThis.merchantPortalRequested?.())return merchantLiveCatalog();
  if(globalThis.__CHAMA_TEST__!==true)return merchantRealPortalRequired();
  const m=merchantById(state.selectedMerchant)||state.merchants[0];
  return shell(`<section class="page"><h1 class="page-title">Meu catálogo</h1><p class="muted">A revenda não fica limitada ao P13. Cada produto tem preço e disponibilidade próprios.</p><div class="list">${Object.entries(products).map(([k,p])=>{const price=productPrice(m,k);const stock=inventoryFor(m,k);return `<div class="list-row"><div class="product-left"><div class="product-icon">${typeof tamaoProductArt==="function"?tamaoProductArt(k,p,"cart"):esc(p.icon)}</div><div><strong>${esc(p.name)}</strong><br><small>${price==null?'Não oferecido':`${BRL.format(price)} • estoque ${stock}`}</small></div></div><span class="status-pill ${price==null||stock<=0?'offline':'online'}">${price==null?'INATIVO':stock<=0?'SEM ESTOQUE':'ATIVO'}</span></div>`}).join('')}</div><div class="notice" style="margin-top:14px">No produto real, cada categoria terá regras de compatibilidade logística e conformidade próprias.</div></section>`)
}

/* V1.172: product suggestions are derived solely from the live authorized registry. */
function merchantCatalogAvailableChoices(rt){
  const current=new Set((rt?.catalog||[]).map(item=>String(item?.productCode||'').toUpperCase()));
  return (Array.isArray(rt?.availableProducts)?rt.availableProducts:[])
    .map(item=>({
      productCode:String(item?.productCode||'').trim().toUpperCase(),
      productName:String(item?.productName||'').trim().slice(0,130),
      categoryName:String(item?.categoryName||'Outros').trim().slice(0,70)||'Outros'
    }))
    .filter(item=>/^[A-Z][A-Z0-9_]{1,31}$/.test(item.productCode)
      &&!/^P([1-9][0-9]?)(?:_CONTAINER)?$/.test(item.productCode)
      &&!current.has(item.productCode)
      &&!Object.prototype.hasOwnProperty.call(products,item.productCode))
    .sort((a,b)=>a.categoryName.localeCompare(b.categoryName,'pt-BR')
      ||a.productName.localeCompare(b.productName,'pt-BR'));
}
function merchantCatalogFilterChoices(choices,category='',search=''){
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
  const needle=normalize(search.trim());
  return choices.filter(item=>(!category||item.categoryName===category)
    &&(!needle||normalize(item.productName+' '+item.productCode+' '+item.categoryName).includes(needle)));
}
function merchantCatalogFilterRegistry(){
  const select=document.getElementById('live-new-registry-product');
  if(!select)return;
  const rt=globalThis.merchantRuntime||{};
  const cat=String(document.getElementById('live-new-registry-category')?.value||'');
  const search=String(document.getElementById('live-new-registry-search')?.value||'');
  const choices=merchantCatalogFilterChoices(merchantCatalogAvailableChoices(rt),cat,search);
  const existing=String(select.value||'');
  const fragment=document.createDocumentFragment();
  if(!choices.length){
    const option=document.createElement('option');
    option.value='';option.textContent='Nenhum produto encontrado';
    fragment.appendChild(option);
  }else{
    let group=null,category='';
    for(const item of choices){
      if(item.categoryName!==category){
        category=item.categoryName;
        group=document.createElement('optgroup');
        group.label=category;fragment.appendChild(group);
      }
      const option=document.createElement('option');
      option.value=item.productCode;
      option.textContent=item.productName||item.productCode;
      group.appendChild(option);
    }
  }
  select.replaceChildren(fragment);
  if(choices.some(item=>item.productCode===existing))select.value=existing;
  const count=document.getElementById('live-new-registry-count');
  if(count)count.textContent=choices.length
    ?choices.length+' produto(s) para escolher':'Nenhum produto encontrado. Ajuste a busca ou a categoria.';
  const add=document.getElementById('live-new-registry-add');
  if(add)add.disabled=choices.length===0;
}
function merchantCatalogGasOptions(rt,container=false){
  const existing=new Set((rt?.catalog||[]).map(item=>String(item?.productCode||'').toUpperCase()));
  const preferred=[13,20,45];
  const numbers=[...preferred,...Array.from({length:90},(_,index)=>index+1).filter(n=>!preferred.includes(n))];
  return numbers.filter(n=>!existing.has('P'+n+(container?'_CONTAINER':'')))
    .map(n=>'<option value="P'+n+'">'+n+' kg (P'+n+')</option>').join('');
}


/* V1.173 — UI-only catalog maintenance. All edits still require explicit server confirmation. */
function merchantCatalogFocus(code,target='price'){
  if(!/^[A-Z][A-Z0-9_]{1,31}$/.test(String(code||'')))return false;
  const card=document.getElementById('merchant-catalog-item-'+code);
  if(!card)return false;
  let parent=card.parentElement;
  while(parent){
    if(parent.tagName==='DETAILS')parent.open=true;
    parent=parent.parentElement;
  }
  card.open=true;
  const selector=(target==='stock'?'live-stock-':'live-price-')+code;
  const field=document.getElementById(selector);
  if(!field)return false;
  field.scrollIntoView?.({behavior:'smooth',block:'center'});
  field.focus?.({preventScroll:true});
  return true;
}
function merchantCatalogAdjustStock(code,delta){
  if(!/^[A-Z][A-Z0-9_]{1,31}$/.test(String(code||''))||![-1,1].includes(delta))return false;
  const field=document.getElementById('live-stock-'+code);
  if(!field)return false;
  const raw=String(field.value||'').trim();
  const stock=Number(raw);
  if(!/^\d+$/.test(raw)||!Number.isInteger(stock)||stock<0||stock>100000){
    toast('Revise o estoque antes de ajustar');
    field.focus?.();
    return false;
  }
  const next=stock+delta;
  if(next<0||next>100000)return false;
  field.value=String(next);
  const note=document.getElementById('merchant-catalog-pending-'+code);
  if(note)note.textContent='Alteração ainda não salva. Toque em Salvar preço e estoque para confirmar.';
  return true;
}
function merchantCatalogMarkEdited(code){
  if(!/^[A-Z][A-Z0-9_]{1,31}$/.test(String(code||'')))return;
  const note=document.getElementById('merchant-catalog-pending-'+code);
  if(note)note.textContent='Alteração ainda não salva. Toque em Salvar preço e estoque para confirmar.';
}

function merchantLiveCatalog(){
  const rt=globalThis.merchantRuntime||{};
  if(rt.status!=='ready')return merchantLivePage();
  if(!['owner','manager'].includes(String(rt.merchant?.memberRole||''))){
    return shell('<section class="page"><button class="back" onclick="go(\'merchant\')">← Operação</button><h1 class="page-title">Produtos da revenda</h1><div class="notice">Somente o proprietário ou gerente pode alterar preços e estoque. Sua equipe continua com acesso às funções do próprio papel.</div></section>');
  }

  const safeCatalogCode=code=>/^[A-Z][A-Z0-9_]{1,31}$/.test(String(code||''));
  const local=Object.entries(products).filter(([code])=>safeCatalogCode(code)).map(([code,p])=>{
    const current=(rt.catalog||[]).find(x=>x.productCode===code);
    return {
      productCode:code,
      productName:current?.productName||p.name,
      priceCents:Number(current?.priceCents||0),
      pricingMode:current?.pricingMode||'fixed',
      minPriceCents:Number(current?.minPriceCents??current?.priceCents??0),
      maxPriceCents:Number(current?.maxPriceCents??current?.priceCents??0),
      pricingStrategy:current?.pricingStrategy||'balanced',
      availableStock:Number(current?.availableStock||0),
      active:current?.active===true,
      priceConfirmedAt:current?.priceConfirmedAt||null
    };
  });

  const localCodes=new Set(local.map(x=>x.productCode));
  const serverOnly=(rt.catalog||[])
    .filter(item=>safeCatalogCode(item?.productCode)&&!localCodes.has(item.productCode))
    .map(item=>({
      productCode:String(item.productCode||'').toUpperCase(),
      productName:item.productName||item.productCode||'Produto',
      priceCents:Number(item.priceCents||0),
      pricingMode:item.pricingMode||'fixed',
      minPriceCents:Number(item.minPriceCents??item.priceCents??0),
      maxPriceCents:Number(item.maxPriceCents??item.priceCents??0),
      pricingStrategy:item.pricingStrategy||'balanced',
      availableStock:Number(item.availableStock||0),
      active:item.active===true,
      priceConfirmedAt:item.priceConfirmedAt||null
    }));

  const known=[...local,...serverOnly]
    .sort((a,b)=>{
      const ag=/^P([1-9][0-9]?)(?:_CONTAINER)?$/.exec(a.productCode);
      const bg=/^P([1-9][0-9]?)(?:_CONTAINER)?$/.exec(b.productCode);
      if(ag&&bg){
        const byKg=Number(ag[1])-Number(bg[1]);
        if(byKg)return byKg;
        return a.productCode.includes('_CONTAINER')?1:-1;
      }
      if(ag)return -1;
      if(bg)return 1;
      return a.productName.localeCompare(b.productName,'pt-BR');
    });

  const needsReview=item=>{
    if(item?.active!==true)return {needed:false,issues:[],focus:'price'};
    const issues=[];
    const stock=Number(item.availableStock);
    const price=Number(item.priceCents);
    if(!Number.isInteger(stock)||stock<=0)issues.push('Sem estoque');
    if(!Number.isFinite(price)||price<=0)issues.push('Preço não informado');
    else if(!merchantTimestampFresh(item.priceConfirmedAt))issues.push('Preço precisa de confirmação');
    return {needed:issues.length>0,issues,focus:issues.includes('Sem estoque')?'stock':'price'};
  };
  const renderCatalogItem=item=>{
    const fresh=merchantTimestampFresh(item.priceConfirmedAt);
    const status=!item.active?'INATIVO':item.availableStock<=0?'SEM ESTOQUE':fresh?'CONFIRMADO':'PREÇO VENCIDO';
    const statusClass=item.active&&item.availableStock>0&&fresh?'online':item.active&&item.availableStock>0?'risk':'offline';
    const icon=products[item.productCode]?.icon||( /_CONTAINER$/.test(item.productCode)?'🛢️':/^P([1-9][0-9]?)$/.test(item.productCode)?'🔥':'📦');
    const range=item.pricingMode==='range';
    const strategyLabel={volume:'Priorizar volume',balanced:'Equilibrado',margin:'Priorizar margem'}[item.pricingStrategy]||'Equilibrado';
    const priceSummary=range
      ? 'Faixa '+BRL.format(item.minPriceCents/100)+' – '+BRL.format(item.maxPriceCents/100)+' • normal '+BRL.format(item.priceCents/100)+' • '+strategyLabel
      : 'Preço fixo '+(item.priceCents>0?BRL.format(item.priceCents/100):'—');
    return `<details class="merchant-catalog-entry" id="merchant-catalog-item-${item.productCode}"><summary><span class="merchant-catalog-summary-name">${icon} ${esc(item.productName)}<small>${esc(priceSummary)} • estoque ${Number(item.availableStock)}</small></span><span class="status-pill ${statusClass}">${status}</span></summary>
    <div class="card flat form-stack">
      <div class="status-bar"><div class="product-left"><div class="product-icon">${typeof tamaoProductArt==="function"?tamaoProductArt(item.productCode,{icon},"cart"):esc(icon)}</div><div><strong>${esc(item.productName)}</strong><br><small>${esc(item.productCode)} • ${esc(priceSummary)} • ${item.priceConfirmedAt?'confirmado '+new Date(item.priceConfirmedAt).toLocaleString('pt-BR'):'nunca confirmado'}</small></div></div><span class="status-pill ${statusClass}">${status}</span></div>
      <div class="field-row">
        <div class="input-wrap"><label for="live-price-${item.productCode}">Preço ${range?'normal':'de venda'}</label><input id="live-price-${item.productCode}" inputmode="decimal" type="number" min="0.01" max="10000" step="0.10" class="input" oninput="merchantCatalogMarkEdited('${item.productCode}')" value="${item.priceCents>0?(item.priceCents/100).toFixed(2):''}"></div>
        <div class="input-wrap"><label for="live-stock-${item.productCode}">Estoque</label>
          <div class="merchant-catalog-stock-controls"><button type="button" class="secondary" aria-label="Diminuir estoque de ${esc(item.productName)} em um" onclick="merchantCatalogAdjustStock('${item.productCode}',-1)">−</button>
          <input id="live-stock-${item.productCode}" inputmode="numeric" type="number" min="0" max="100000" step="1" class="input" oninput="merchantCatalogMarkEdited('${item.productCode}')" value="${item.availableStock}">
          <button type="button" class="secondary" aria-label="Aumentar estoque de ${esc(item.productName)} em um" onclick="merchantCatalogAdjustStock('${item.productCode}',1)">+</button></div>
        </div>
      </div>
      <details class="merchant-catalog-pricing" ${range?'open':''}><summary>${range?'Faixa de preço automática':'Preço automático e limites (opcional)'}</summary>
      <div class="form-stack">
        <div class="input-wrap"><label for="live-pricing-mode-${item.productCode}">Modo de preço</label><select id="live-pricing-mode-${item.productCode}" class="input" onchange="merchantPricingModeChanged('${item.productCode}')"><option value="fixed" ${range?'':'selected'}>Preço fixo</option><option value="range" ${range?'selected':''}>Faixa automática</option></select></div>
      <div class="field-row">
        <div class="input-wrap"><label for="live-min-price-${item.productCode}">Mínimo autorizado</label><input id="live-min-price-${item.productCode}" inputmode="decimal" type="number" min="0.01" max="10000" step="0.10" class="input" value="${(item.minPriceCents/100).toFixed(2)}" ${range?'':'disabled'}></div>
        <div class="input-wrap"><label for="live-max-price-${item.productCode}">Máximo autorizado</label><input id="live-max-price-${item.productCode}" inputmode="decimal" type="number" min="0.01" max="10000" step="0.10" class="input" value="${(item.maxPriceCents/100).toFixed(2)}" ${range?'':'disabled'}></div>
        <div class="input-wrap"><label for="live-pricing-strategy-${item.productCode}">Estratégia</label><select id="live-pricing-strategy-${item.productCode}" class="input" ${range?'':'disabled'}><option value="volume" ${item.pricingStrategy==='volume'?'selected':''}>Priorizar volume</option><option value="balanced" ${item.pricingStrategy==='balanced'?'selected':''}>Equilibrado</option><option value="margin" ${item.pricingStrategy==='margin'?'selected':''}>Priorizar margem</option></select></div>
      </div>
      <div class="notice"><strong>${range?'Faixa autorizada':'Preço fixo'}.</strong><br>${range?'O TAMÃO pode escolher um preço somente entre o mínimo e o máximo, usando estoque e carga da sua própria operação. O preço de concorrentes não define o seu valor.':'O TAMÃO usa exatamente o preço informado para este produto.'}</div>
      </div></details>
      <label class="check-row"><input id="live-active-${item.productCode}" type="checkbox" ${item.active?'checked':''}><span><strong>Produto ativo</strong><small>Somente itens ativos e com estoque participam das ofertas.</small></span></label>
      <button class="secondary merchant-catalog-save" id="live-save-product-${item.productCode}" onclick="merchantLiveSaveProduct('${item.productCode}')">Salvar preço e estoque</button>
      <small class="field-help" id="merchant-catalog-pending-${item.productCode}" aria-live="polite">Mudanças nos campos e no estoque só entram em vigor após salvar. O preço precisa ser reconfirmado periodicamente.</small>
    </div></details>`;
  };
  const currentCodes=new Set((rt.catalog||[]).map(item=>String(item.productCode||'').toUpperCase()));
  const configured=known.filter(item=>currentCodes.has(item.productCode));
  const review= configured.filter(item=>needsReview(item).needed);
  const ordered=[...review,...configured.filter(item=>!needsReview(item).needed)];
  const configuredRows=ordered.map(renderCatalogItem).join('');
  const optionalRows=known.filter(item=>!currentCodes.has(item.productCode)).map(renderCatalogItem).join('');
  const attentionRows=review.map(item=>{
    const check=needsReview(item);
    return `<div class="merchant-catalog-attention-item"><div><strong>${esc(item.productName)}</strong>
      <span>${esc(check.issues.join(' • '))}</span></div>
      <button type="button" class="secondary small" onclick="merchantCatalogFocus('${item.productCode}','${check.focus}')">Revisar</button></div>`;
  }).join('');
  const reviewSection=review.length
    ?'<section class="merchant-catalog-attention" aria-label="Produtos que precisam de revisão"><div class="merchant-catalog-attention-head">'+
      '<h2>Produtos que precisam de atenção</h2><span>'+review.length+' para revisar</span></div>'+
      '<p>Ajuste o estoque ou confirme o preço atual. Nenhuma alteração será enviada sem você salvar.</p>'+
      '<div class="merchant-catalog-attention-items">'+attentionRows+'</div></section>'
    :'<div class="merchant-catalog-all-clear"><strong>Sem pendências nos produtos ativos.</strong>'+
      '<span>'+(!configured.length?'Adicione seu primeiro produto para começar.':'Você pode revisar preços e estoques quando precisar.')+'</span></div>';

  const addableProducts=merchantCatalogAvailableChoices(rt);
  const addableCategories=[...new Set(addableProducts.map(item=>item.categoryName))];
  const addRegistered=addableProducts.length
    ? `<div class="card flat form-stack" style="margin-bottom:16px">
        <h3>Adicionar produto do catálogo TAMÃO</h3>
        <p class="muted tiny">Escolha um produto disponibilizado pelo TAMÃO. Você define o preço e o estoque da sua revenda.</p>
        <div class="merchant-catalog-chooser">
          <div class="input-wrap"><label for="live-new-registry-category">Categoria</label><select id="live-new-registry-category" class="input" onchange="merchantCatalogFilterRegistry()">
            <option value="">Todas as categorias</option>
            ${addableCategories.map(category=>`<option value="${esc(category)}">${esc(category)}</option>`).join('')}
          </select></div>
          <div class="input-wrap"><label for="live-new-registry-search">Buscar pelo nome (opcional)</label>
            <input type="search" id="live-new-registry-search" class="input" autocomplete="off" placeholder="Ex.: água, carvão, lenha" oninput="merchantCatalogFilterRegistry()">
          </div>
        </div>
        <div class="input-wrap"><label for="live-new-registry-product">Produto</label><select id="live-new-registry-product" class="input">
          ${addableCategories.map(category=>`<optgroup label="${esc(category)}">${addableProducts.filter(item=>item.categoryName===category).map(item=>`<option value="${esc(item.productCode)}">${esc(item.productName||item.productCode)}</option>`).join('')}</optgroup>`).join('')}
        </select><small class="field-help" id="live-new-registry-count" aria-live="polite">${addableProducts.length} produto(s) para escolher</small></div>
        <div class="field-row">
          <div class="input-wrap"><label for="live-new-registry-price">Preço</label><input id="live-new-registry-price" inputmode="decimal" type="number" min="0.01" max="10000" step="0.10" class="input" placeholder="0,00"></div>
          <div class="input-wrap"><label for="live-new-registry-stock">Estoque</label><input id="live-new-registry-stock" inputmode="numeric" type="number" min="0" max="100000" class="input" value="0"></div>
        </div>
        <button class="primary merchant-catalog-add-btn" id="live-new-registry-add" onclick="merchantLiveAddRegisteredProduct()">Adicionar produto</button>
      </div>`
    : '';

  const addGlp=`<div class="card flat form-stack" style="margin-bottom:16px">
    <h3>Adicionar cilindro GLP</h3>
    <p class="muted tiny">Códigos P1 a P90 seguem automaticamente as regras regulatórias e logísticas de GLP.</p>
    <div class="field-row">
      <div class="input-wrap"><label for="live-new-glp-code">Tamanho do botijão</label><select id="live-new-glp-code" class="input">${merchantCatalogGasOptions(rt)}</select></div>
      <div class="input-wrap"><label for="live-new-glp-price">Preço</label><input id="live-new-glp-price" inputmode="decimal" type="number" min="0.01" max="10000" step="0.10" class="input" placeholder="0,00"></div>
      <div class="input-wrap"><label for="live-new-glp-stock">Estoque</label><input id="live-new-glp-stock" inputmode="numeric" type="number" min="0" max="100000" class="input" value="0"></div>
    </div>
    <button class="primary" onclick="merchantLiveAddGlp()">Adicionar e confirmar</button>
  </div>`;

  const addContainer=`<div class="card flat form-stack" style="margin-bottom:16px">
    <h3>Adicionar vasilhame</h3>
    <p class="muted tiny">Cadastre o recipiente separadamente da carga. Ex.: P13 cria o SKU P13_CONTAINER.</p>
    <div class="field-row">
      <div class="input-wrap"><label for="live-new-container-code">Tamanho do vasilhame</label><select id="live-new-container-code" class="input">${merchantCatalogGasOptions(rt,true)}</select></div>
      <div class="input-wrap"><label for="live-new-container-price">Preço do vasilhame</label><input id="live-new-container-price" inputmode="decimal" type="number" min="0.01" max="10000" step="0.10" class="input" placeholder="0,00"></div>
      <div class="input-wrap"><label for="live-new-container-stock">Estoque</label><input id="live-new-container-stock" inputmode="numeric" type="number" min="0" max="100000" class="input" value="0"></div>
    </div>
    <button class="primary" onclick="merchantLiveAddContainer()">Adicionar vasilhame</button>
  </div>`;

  return shell(`<section class="page merchant-catalog-page"><button class="back" onclick="go('merchant')">← Operação</button>
    <span class="section-kicker">MINHA LOJA</span><h1 class="page-title">Produtos da minha revenda</h1>
    <p class="muted">Comece pelos produtos que já cadastrou: toque para informar preço e estoque. Cada SKU possui sua própria confirmação de preço; somente itens elegíveis aparecem nas ofertas.</p>
    ${reviewSection}
    <div class="merchant-catalog-head"><strong>Meus produtos</strong><span>${configured.length} cadastrado(s)</span></div>
    <div class="merchant-catalog-list">${configuredRows||'<div class="empty card">Sua lista está vazia. Abra “Adicionar produto” abaixo e escolha o que deseja vender.</div>'}</div>
    <details class="merchant-catalog-extra"><summary>Adicionar outro produto ou vasilhame</summary><div class="merchant-catalog-add-body">
      ${addRegistered}
      ${optionalRows?'<details class="merchant-catalog-kind"><summary>Outros produtos comuns</summary><p class="muted tiny">Modelos para configurar: disponibilidade e requisitos serão verificados antes da venda.</p><div class="merchant-catalog-list">'+optionalRows+'</div></details>':''}
      <details class="merchant-catalog-kind"><summary>Outro tamanho de gás</summary>${addGlp}</details>
      <details class="merchant-catalog-kind"><summary>Vasilhames</summary>${addContainer}</details>
    </div></details>
    <p class="tiny muted">Cadastrar produto não libera vendas automaticamente. As regras de estoque, preço, categoria e entrega continuam sendo conferidas.</p>
  </section>`);
}

async function merchantLiveAddRegisteredProduct(){
  const code=String(document.getElementById('live-new-registry-product')?.value||'').trim().toUpperCase();
  const available=merchantCatalogAvailableChoices(globalThis.merchantRuntime||{}).find(item=>item.productCode===code);
  const price=Number(document.getElementById('live-new-registry-price')?.value);
  const stock=Number(document.getElementById('live-new-registry-stock')?.value);
  if(!available)return toast('Escolha um produto liberado pela administração');
  if(!Number.isFinite(price)||price<=0||price>10000||!Number.isInteger(stock)||stock<0||stock>100000){
    return toast('Revise preço e estoque');
  }
  if(merchantCatalogSaving.has(code))return;
  const button=document.getElementById('live-new-registry-add');
  const previous=button?.textContent||'Adicionar produto';
  merchantCatalogSaving.add(code);
  if(button){button.disabled=true;button.textContent='Adicionando…';}
  try{
    await merchantUpdateProductLive(code,Math.round(price*100),stock,true);
    toast(String(available.productName||code)+' adicionado ao catálogo');
  }catch(e){toast(String(e?.message||e))}
  finally{
    merchantCatalogSaving.delete(code);
    if(button){button.disabled=false;button.textContent=previous;}
  }
}

async function merchantLiveAddGlp(){
  const code=String(document.getElementById('live-new-glp-code')?.value||'').trim().toUpperCase();
  const match=/^P([1-9][0-9]?)$/.exec(code);
  const kg=match?Number(match[1]):NaN;
  const price=Number(document.getElementById('live-new-glp-price')?.value);
  const stock=Number(document.getElementById('live-new-glp-stock')?.value);
  if(!Number.isInteger(kg)||kg<1||kg>90)return toast('Use um código GLP entre P1 e P90');
  if(!Number.isFinite(price)||price<=0||price>10000||!Number.isInteger(stock)||stock<0||stock>100000)return toast('Revise preço e estoque');
  try{
    await merchantUpdateProductLive(code,Math.round(price*100),stock,true);
    toast('Gás P'+kg+' adicionado ao catálogo');
  }catch(e){toast(String(e?.message||e))}
}

async function merchantLiveAddContainer(){
  const gasCode=String(document.getElementById('live-new-container-code')?.value||'').trim().toUpperCase();
  const match=/^P([1-9][0-9]?)$/.exec(gasCode);
  const kg=match?Number(match[1]):NaN;
  const price=Number(document.getElementById('live-new-container-price')?.value);
  const stock=Number(document.getElementById('live-new-container-stock')?.value);
  if(!Number.isInteger(kg)||kg<1||kg>90)return toast('Use um tamanho entre P1 e P90');
  if(!Number.isFinite(price)||price<=0||price>10000||!Number.isInteger(stock)||stock<0||stock>100000)return toast('Revise preço e estoque do vasilhame');
  try{
    await merchantUpdateProductLive(gasCode+'_CONTAINER',Math.round(price*100),stock,true);
    toast('Vasilhame P'+kg+' adicionado ao catálogo');
  }catch(e){toast(String(e?.message||e))}
}

function merchantMetrics(){
  if(globalThis.merchantPortalRequested?.())return merchantLivePage();
  if(globalThis.__CHAMA_TEST__!==true)return merchantRealPortalRequired();
  const internalPilot=globalThis.CHAMA_INTERNAL_PILOT===true;
  const m=merchantById(state.selectedMerchant)||state.merchants[0];
  const accepted=Math.max(0,Number(m.accepted)||0),delivered=Math.max(0,Number(m.delivered)||0);
  const completion=accepted?delivered/accepted:0;
  return shell(`<section class="page"><h1 class="page-title">Desempenho</h1><div class="merchant-kpis"><div class="kpi"><span class="label">${internalPilot?'Trust simulado':'Trust Score'}</span><strong>${m.trust}/100</strong></div><div class="kpi"><span class="label">Aceitos</span><strong>${accepted}</strong></div><div class="kpi"><span class="label">Entregues</span><strong>${delivered}</strong></div><div class="kpi"><span class="label">Conclusão</span><strong>${accepted?Math.round(completion*100)+'%':'—'}</strong></div></div><section class="section"><div class="card flat"><h3>O que mais pesa no Trust Score</h3><div class="list"><div class="list-row"><strong>Entregas dentro do ETA</strong><span>25%</span></div><div class="list-row"><strong>Conclusão após aceite</strong><span>20%</span></div><div class="list-row"><strong>Integridade dos status</strong><span>15%</span></div><div class="list-row"><strong>Integridade de preço</strong><span>15%</span></div></div></div></section></section>`)
}
function formatDateTime(v){
  const d=new Date(v);if(Number.isNaN(d.getTime()))return 'não confirmada';
  return d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
}

globalThis.merchantRequestBillingPackageFromUi=merchantRequestBillingPackageFromUi;
globalThis.merchantNotifyStatementPaidFromUi=merchantNotifyStatementPaidFromUi;
globalThis.merchantCancelBillingRequestFromUi=merchantCancelBillingRequestFromUi;
globalThis.merchantConnectProviderFromUi=merchantConnectProviderFromUi;
globalThis.merchantDisconnectProviderFromUi=merchantDisconnectProviderFromUi;
globalThis.merchantUseProviderManuallyFromUi=merchantUseProviderManuallyFromUi;
globalThis.merchantStopProviderManualUseFromUi=merchantStopProviderManualUseFromUi;
