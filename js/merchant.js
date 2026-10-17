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
    rt.adsStart=null;
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
    rt.adsStart=null;
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
  return shell(`<section class="page merchant-access-page"><div class="merchant-access-grid"><div class="merchant-access-story">
    <span class="eyebrow">${pilotInvite||prospectInvite?'CONVITE DE PARCEIRO':'PAINEL DA REVENDA'}</span>
    <h1 class="page-title">${pilotInvite||prospectInvite?'Entre para continuar seu cadastro':'Entrar no painel da revenda'}</h1>
    <p class="muted">${pilotInvite||prospectInvite?'Informe o e-mail do responsável. Enviaremos um link para você continuar o cadastro da empresa.':'Informe o e-mail cadastrado na revenda. Enviaremos um link seguro de acesso.'}</p>
    <div class="merchant-access-points" aria-label="Vantagens de vender no TAMÃO">
      <div><span aria-hidden="true">✓</span><p><strong>Seus preços, suas escolhas</strong><small>Controle catálogo, estoque e entregas no mesmo painel.</small></p></div>
      <div><span aria-hidden="true">✓</span><p><strong>Mais um canal de vendas</strong><small>Sem abandonar sua clientela, o WhatsApp ou o balcão.</small></p></div>
      <div><span aria-hidden="true">✓</span><p><strong>Comece do seu jeito</strong><small>Prepare a empresa agora; vendas dependem da aprovação necessária.</small></p></div>
    </div>
    <button type="button" class="merchant-access-about" onclick="go('merchants')">Conhecer as vantagens para minha revenda <span aria-hidden="true">→</span></button>
    </div><div class="merchant-access-panel">
    ${pilotInvite?'<div class="notice success" style="margin-top:14px"><strong>Convite reconhecido.</strong><br>Seu convite já foi identificado. Você pode continuar o cadastro; as vendas só começam depois da habilitação.</div>':''}${prospectInvite?'<div class="notice success" style="margin-top:14px"><strong>Convite reconhecido.</strong><br>Vamos conferir o CNPJ para vincular seu cadastro à empresa convidada. A liberação para vender acontece em uma etapa separada.</div>':''}
    ${rt.notice?`<div class="notice success" style="margin-top:14px">${esc(rt.notice)}</div>`:''}
    ${rt.error?`<div class="notice danger" style="margin-top:14px">${esc(rt.error)}</div>`:''}
    <form class="card flat form-stack merchant-access-form" onsubmit="event.preventDefault();merchantLoginFromUi()">
      <h2>Entre com seu e-mail</h2>
      <p>Você receberá um link seguro. Não é necessário criar uma senha.</p>
      <div class="input-wrap"><label for="merchant-email">E-mail da empresa</label><input id="merchant-email" type="email" autocomplete="email" class="input" maxlength="160" placeholder="voce@empresa.com" required></div>
      <button type="submit" class="primary full">Enviar meu link de acesso →</button>
    </form>
    <p class="merchant-access-footnote">O cadastro da empresa passa por conferência antes da liberação das vendas. Você já pode preparar seus dados.</p>
  </div></div></section>`);
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
  const push=globalThis.merchantPushStatus?.()||{};
  const device=push.diagnostic;
  const health=push.deviceHealth;
  const testResult=push.testResult;
  const advice=!device?'':!device.secure
    ?'Abra o Portal das Revendas pelo endereço HTTPS oficial.':
    !device.supported?'Este navegador não oferece Web Push. Use um navegador compatível.':
    device.permission==='denied'?'Libere as notificações nas configurações do navegador e do celular.':
    device.permission!=='granted'?'Autorize as notificações deste aparelho para realizar um teste.':
    !device.workerReady?'Reabra o portal conectado à internet para ativar o serviço de notificações.':
    !device.localSubscription?'Cadastre este aparelho para começar os testes.':
    !device.keyMatches?'A inscrição local não corresponde à chave atual. Desative o push e cadastre novamente.':
    push.healthError==='DEVICE_NOT_REGISTERED'?'O servidor não reconhece esta inscrição. Desative o push e cadastre novamente.':
    push.healthError?'Não foi possível consultar os testes no servidor. Confira a conexão e verifique novamente.':
    !health?'Confira o resultado da análise do servidor após a verificação.':
    health.latestFailureCode==='SUBSCRIPTION_GONE'?'Inscrição rejeitada ou expirada pelo provedor. Desative o push e cadastre novamente.':
    health.latestFailureCode==='SENDER_UNAVAILABLE'?'O servidor de testes não conseguiu usar a configuração de envio. A administração deve revisar o serviço.':
    health.latestFailureCode==='GATEWAY_REJECTED'?'O serviço rejeitou o envio. Confira a inscrição e repita o teste após o intervalo.':
    ['GATEWAY_UNAVAILABLE','NETWORK_ERROR','PUSH_TEST_FAILED'].includes(health.latestFailureCode)
      ?'O envio encontrou uma falha temporária. Confira a conexão e teste mais tarde.':
    health.latestReport==='spam_warning'?'Você informou que o Chrome exibiu um aviso de possível spam. Use Mostrar notificação, Sempre mostrar e Marcar como seguro, se disponíveis.':
    health.latestReport==='not_seen'?'O provedor aceitou, mas você informou que o aviso não apareceu. Confira notificações do sistema, economia de bateria e modo Não Perturbe.':
    health.latestReport==='seen'?'Você registrou o recebimento de um teste. Repita com o PWA fechado para conferir seu aparelho.':
    health.latestState==='provider_accepted'?'O provedor aceitou o último envio, mas a exibição não foi confirmada. Confira o aviso no aparelho.':
    health.tests===0?'Nenhum envio de teste nos últimos 7 dias. Use “Enviar notificação de teste”.':
    health.latestState==='reserved'?'Há um teste ainda marcado como reservado. Atualize a verificação após alguns instantes.':
    'Confira as permissões e envie um novo teste quando necessário.';
  const healthInfo=health?
    '<div class="merchant-push-diagnostic" role="status"><strong>Histórico de testes deste aparelho • 7 dias</strong>'+
    '<div>Tentativas: '+esc(health.tests)+' · Aceitas pelo provedor: '+esc(health.providerAccepted)+
    ' · Falhas: '+esc(health.providerFailed)+'</div>'+
    '<div>Você informou recebimento: '+esc(health.reportedSeen)+
    ' · Não apareceu: '+esc(health.reportedNotSeen)+' · Aviso de spam: '+esc(health.reportedWarning||0)+'</div>'+
    '<small>Aceite pelo provedor e relatos manuais não garantem entrega de avisos futuros.</small></div>':'';
  const adviceInfo=device?
    '<div class="merchant-push-diagnostic" role="status" aria-live="polite"><strong>Próximo passo recomendado</strong><div>'+esc(advice)+'</div></div>':'';
  const report=testResult?.deviceReport;
  const reportButtons=testResult?.providerAccepted&&testResult?.runId&&!report
    ?'<div class="form-stack"><small>O aviso apareceu neste aparelho? Informe o que você observou:</small>'+
      '<button type="button" class="secondary" '+(push.reportPending?'disabled':'')+
      ' onclick="merchantPushReportFromUi(\'seen\')">Recebi a notificação</button>'+
      '<button type="button" class="secondary" '+(push.reportPending?'disabled':'')+
      ' onclick="merchantPushReportFromUi(\'not_seen\')">Não apareceu</button>'+
      '<button type="button" class="secondary" '+(push.reportPending?'disabled':'')+
      ' onclick="merchantPushReportFromUi(\'spam_warning\')">Apareceu com aviso de possível spam</button></div>':'';
  const fixWarning=testResult?.providerAccepted&&testResult?.runId&&
    ['seen','not_seen'].includes(report)?
    '<button type="button" class="secondary" '+(push.reportPending?'disabled':'')+
      ' onclick="merchantPushCorrectChromeWarningFromUi()">Na verdade, apareceu com aviso do Chrome</button>':'';
  const chromeAdvice='<div class="merchant-push-diagnostic">'+
    '<strong>Chrome exibiu “possível spam”?</strong>'+
    '<div>Se você reconhece o teste TAMÃO: toque em Mostrar notificação, depois Sempre mostrar e Marcar como seguro, quando o Chrome oferecer essas opções. Não é necessário desativar a proteção antispam geral.</div>'+
    '<small>O Chrome controla essa classificação; o TAMÃO não consegue removê-la automaticamente.</small></div>';
  const testInfo=testResult?
    '<div class="merchant-push-diagnostic" role="status" aria-live="polite"><strong>Último teste</strong><div>'+
    (report==='seen'?'Você confirmou que o aviso apareceu neste aparelho.':
     report==='not_seen'?'Você informou que o aviso não apareceu neste aparelho.':
     report==='spam_warning'?'Você informou que o Chrome mostrou um aviso de possível spam antes da notificação.':
     testResult.providerAccepted?'O provedor aceitou o envio. Confira se o aviso apareceu no aparelho.':
     'O provedor não confirmou o envio. Confira a inscrição e a conexão.')+
    '</div>'+reportButtons+fixWarning+chromeAdvice+
    '<small>Relato manual da revenda. O servidor não comprova exibição ou leitura no aparelho.</small></div>':'';
  const diagnostic=device?
    '<div class="merchant-push-diagnostic" role="status" aria-live="polite">'+
    '<strong>Verificação deste aparelho</strong>'+
    '<div>HTTPS: '+(device.secure?'OK':'indisponível')+
    ' · Web Push: '+(device.supported?'compatível':'indisponível')+'</div>'+
    '<div>Service Worker: '+(device.workerReady?'ativo':'não ativo')+
    ' · Permissão: '+esc(device.permission==='granted'?'concedida':
        device.permission==='denied'?'bloqueada':device.permission==='default'?'a solicitar':'indisponível')+'</div>'+
    '<div>Inscrição no navegador: '+(device.localSubscription?'encontrada':'não encontrada')+
    ' · Chave pública: '+(device.keyMatches?'compatível':'não confirmada')+'</div>'+
    '<small>Esta verificação é local. Não comprova inscrição no servidor nem recebimento de notificações.</small>'+
    '</div>':'';

  const notificationCopy=!status.notificationSupported
    ? 'Notificação do sistema indisponível neste navegador; som e vibração ainda podem funcionar.'
    : permission==='granted'
      ? 'Som, vibração e notificação do sistema habilitados neste aparelho.'
      : permission==='denied'
        ? 'Som e vibração podem funcionar, mas o navegador bloqueou notificações do sistema.'
        : 'Ao ativar, o navegador pode pedir permissão para notificações.';
  return `<div class="card flat form-stack" style="margin-top:14px">
    <div class="status-bar"><div><strong>Alertas neste aparelho</strong><br><small>${esc(notificationCopy)}</small></div><span class="status-pill ${status.enabled?'online':'offline'}">${status.enabled?'ATIVOS':'DESLIGADOS'}</span></div>
    <div class="notice"><strong>Escopo atual.</strong><br>Com alertas ativados, o TAMÃO tenta verificar pedidos mesmo em outra aba. O navegador pode suspender essas consultas em segundo plano; ao voltar para o painel, a atualização é retomada. Com o navegador fechado, não há garantia de alertas. Para não perder ofertas urgentes, mantenha o painel aberto e confira a conexão.</div>
    <button class="${status.enabled?'danger-btn':'primary'}" onclick="${status.enabled?'merchantDisableAlertsFromUi()':'merchantEnableAlertsFromUi()'}">${status.enabled?'Desativar alertas':'Ativar som, vibração e notificações'}</button>
    ${status.enabled&&globalThis.merchantPushStatus?.().available===true
      ?'<div class="merchant-push-toggle"><strong>Notificações push neste aparelho</strong><small>'+(
        globalThis.merchantPushStatus?.().testMode
        ?'Preparação para testes: você pode cadastrar este aparelho, mas o envio remoto ainda está desativado. O cadastro não significa que receberá avisos.'
        :'O push depende do navegador, da conexão e da entrega pelo provedor. Um aviso não substitui a confirmação do pedido no painel.'
      )+'</small><button type="button" class="secondary" onclick="'+(globalThis.merchantPushStatus?.().subscribed?'merchantPushDisableFromUi()':'merchantPushEnableFromUi()')+'">'+(globalThis.merchantPushStatus?.().subscribed?'Desativar push deste aparelho':globalThis.merchantPushStatus?.().testMode?'Cadastrar aparelho para teste':'Ativar push deste aparelho')+'</button><button type="button" class="secondary" onclick="merchantPushDiagnoseFromUi()" '+(push.healthPending?'disabled':'')+'>'+(push.healthPending?'Verificando aparelho…':'Verificar este aparelho')+'</button>'+
      (push.subscribed?'<button type="button" class="secondary" '+(push.testPending?'disabled':'')+' onclick="merchantPushTestFromUi()">'+(push.testPending?'Enviando teste…':'Enviar notificação de teste')+'</button><small>Teste solicitado por você, no máximo um a cada 3 minutos. Os avisos automáticos continuam desativados.</small>':'')+
      (push.subscribed?'<button type="button" class="secondary" '+(push.reportPending||push.testPending?'disabled':'')+' onclick="merchantPushLastFromUi()">Consultar último teste</button>':'')+
      testInfo+diagnostic+healthInfo+adviceInfo+'</div>'
      :''}
  </div>`;
}

function merchantDriverLivePage(rt){
  const m=rt.merchant||{};
  const orders=rt.orders||[];
  const orderEvidence=merchantOrderListEvidence(rt);
  const name=String(m.memberDisplayName||'').trim();
  return shell(`<section class="page">
    <div class="status-bar"><div><div class="tiny muted">MINHAS ENTREGAS</div><h1 class="page-title" style="margin-bottom:2px">${esc(m.name||'Revenda')}</h1></div><span class="status-pill online">MOTORISTA</span></div>
    <div class="notice success" style="margin-top:14px"><strong>Visão restrita por atribuição.</strong><br>Você vê somente pedidos que a operação vinculou à sua conta. Catálogo, preços, compliance e pedidos de outros responsáveis não aparecem aqui.</div>
    ${orderEvidence.fresh?merchantDeliveryBoardView(rt,orders):''}
    <section class="section"><div class="section-head"><div><h2>Pedidos atribuídos a você</h2><p>Saída, chegada e conclusão continuam protegidas pela versão do pedido e pelas autoridades do servidor.</p></div></div>${orderEvidence.fresh?merchantOrderQueueView(orders,'Nenhuma entrega atribuída a você agora.'):merchantOrderListRecovery(rt)}</section>
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
  const next=steps.find(item=>!item.done)||null;
  return '<section class="merchant-essentials" aria-label="Preparação da revenda">'+
    '<div class="merchant-essentials-heading"><div><span class="section-kicker">COMECE PELO ESSENCIAL</span>'+
    '<h2>Prepare sua revenda para vender</h2>'+
    '<p>Produtos, entregas e recebimentos. Você pode revisar cada informação quando precisar.</p></div>'+
    '<span class="merchant-essentials-count">'+done+' de 3 preenchidos</span></div>'+
    (next?'<div class="merchant-essentials-next"><strong>Seu próximo passo: '+esc(next.title)+'</strong>'+
      '<button type="button" class="primary" onclick="merchantSetupGo(\''+next.key+'\')">Continuar configuração</button></div>':
      '<p class="tiny muted">Informações básicas preenchidas. A habilitação para receber pedidos depende das verificações do TAMÃO.</p>')+
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


// V1.276 — one prominent daily availability control, using existing protected operations.
// V1.277 — the quick editor shows only eligible, server-scoped active catalog items.
// V1.279: temporary unsaved catalog edits, in memory only and scoped to a merchant.
const merchantQuickDrafts=new Map();
function merchantQuickDraftKey(rt,code){
  const merchantId=String(rt?.merchant?.merchantId||'');
  return merchantId&&/^[A-Z0-9_-]{1,24}$/.test(String(code||''))?merchantId+'::'+code:'';
}
function merchantQuickCatalogVersion(item){
  return [String(item?.updatedAt||''),Number(item?.priceCents),Number(item?.availableStock)].join('|');
}
function merchantQuickDraftFor(rt,item){
  const key=merchantQuickDraftKey(rt,item?.productCode);
  const draft=key?merchantQuickDrafts.get(key):null;
  if(!draft)return null;
  if(draft.version!==merchantQuickCatalogVersion(item)){merchantQuickDrafts.delete(key);return null;}
  return draft;
}
function merchantQuickCatalogChanged(productCode){
  const rt=globalThis.merchantRuntime||{};
  if(rt.status!=='ready'||rt.actionPending===true||
     !['owner','manager'].includes(String(rt.merchant?.memberRole||'')))return false;
  const code=String(productCode||'');
  const item=merchantQuickCatalogCandidates(rt).find(p=>p.productCode===code);
  const key=merchantQuickDraftKey(rt,code);
  if(!item||!key)return false;
  const price=document.getElementById('merchant-quick-price-'+code);
  const stock=document.getElementById('merchant-quick-stock-'+code);
  if(!price||!stock)return false;
  const priceDraft=String(price.value??'');
  const stockDraft=String(stock.value??'');
  const unchanged=priceDraft===(Number(item.priceCents)/100).toFixed(2)&&
    stockDraft===String(Number(item.availableStock));
  if(unchanged)merchantQuickDrafts.delete(key);
  else merchantQuickDrafts.set(key,{version:merchantQuickCatalogVersion(item),price:priceDraft,quantity:stockDraft});
  const note=document.getElementById('merchant-quick-feedback-'+code);
  if(note)note.textContent=unchanged?'Os valores correspondem aos dados registrados.':
    'Alterações ainda não salvas. Confira os valores e toque em Salvar alterações.';
  return !unchanged;
}
function merchantQuickHasDrafts(rt){
  const id=String(rt?.merchant?.merchantId||'');
  if(!id)return false;
  return [...merchantQuickDrafts.keys()].some(key=>key.startsWith(id+'::'));
}
function merchantQuickConfirmLeave(){
  if(!merchantQuickHasDrafts(globalThis.merchantRuntime||{}))return true;
  return typeof confirm==='function'&&confirm(
    'Existem ajustes de preço ou estoque ainda não salvos. Deseja descartá-los e sair?')===true;
}
function merchantQuickGoCatalog(){
  if(!merchantQuickConfirmLeave())return false;
  merchantQuickDrafts.clear();go('catalog');return true;
}
function merchantQuickRecentChanges(rt){
  const seen=new Set(),now=Date.now();
  return (Array.isArray(rt?.catalog)?rt.catalog:[]).filter(p=>{
    const code=String(p?.productCode||''),ts=Date.parse(String(p?.updatedAt||''));
    if(!/^[A-Z0-9_-]{1,24}$/.test(code)||seen.has(code)||!Number.isFinite(ts)||
       ts>Date.now()+5*60000||ts<0)return false;
    seen.add(code);return true;
  }).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).slice(0,5);
}
if(typeof window!=='undefined'&&window.addEventListener){
  window.addEventListener('beforeunload',event=>{
    if(!merchantQuickHasDrafts(globalThis.merchantRuntime||{}))return;
    event.preventDefault();event.returnValue='';
  });
}
function merchantQuickCatalogCandidates(rt){
  const entries=Array.isArray(rt?.catalog)?rt.catalog:[];
  const seen=new Set();
  const eligible=entries.filter(p=>{
    const code=String(p?.productCode||'');
    const price=Number(p?.priceCents),stock=Number(p?.availableStock);
    if(p?.active!==true||!/^[A-Z0-9_-]{1,24}$/.test(code)||seen.has(code)||
       !Number.isSafeInteger(price)||price<=0||price>1000000||
       !Number.isSafeInteger(stock)||stock<0||stock>100000)return false;
    seen.add(code);return true;
  });
  return eligible.sort((a,b)=>{
    if(a.productCode==='P13'&&b.productCode!=='P13')return -1;
    if(b.productCode==='P13'&&a.productCode!=='P13')return 1;
    const priority=p=>Number(p.availableStock)===0?0:
      Number(p.availableStock)<=3?1:!merchantTimestampFresh(p.priceConfirmedAt)?2:3;
    return priority(a)-priority(b); // Preserve catalog order among equal priorities.
  }).slice(0,6);
}
// V1.278 — read-only stock/price attention from the signed-in merchant catalog.
function merchantQuickStockAlerts(rt){
  const seen=new Set();
  const rows=(Array.isArray(rt?.catalog)?rt.catalog:[]).filter(p=>{
    const code=String(p?.productCode||'');
    if(p?.active!==true||!/^[A-Z0-9_-]{1,24}$/.test(code)||seen.has(code))return false;
    seen.add(code);
    return true;
  });
  const stocked=rows.filter(p=>Number.isSafeInteger(Number(p.availableStock))&&
    Number(p.availableStock)>=0&&Number(p.availableStock)<=100000);
  return {
    empty:stocked.filter(p=>Number(p.availableStock)===0).length,
    low:stocked.filter(p=>Number(p.availableStock)>0&&Number(p.availableStock)<=3).length,
    priceReview:rows.filter(p=>Number.isSafeInteger(Number(p.priceCents))&&Number(p.priceCents)>0&&
      !merchantTimestampFresh(p.priceConfirmedAt)).length
  };
}
// These buttons only alter the draft quantity: an explicit Save is still required.
// V1.282 — one truthful, read-only checklist derived from the authorized catalog.
function merchantDailyChecklistModel(rt,options={}){
  if(rt?.status!=='ready'||!['owner','manager'].includes(String(rt?.merchant?.memberRole||'')))return null;
  const alerts=merchantQuickStockAlerts(rt);
  const rows=Array.isArray(rt.catalog)?rt.catalog:[];
  const active=rows.filter(p=>p?.active===true);
  const incomplete=active.filter(p=>{
    const price=Number(p?.priceCents),stock=Number(p?.availableStock);
    return !Number.isSafeInteger(price)||price<=0||price>1000000||
      !Number.isSafeInteger(stock)||stock<0||stock>100000;
  }).length;
  const issues=[];
  if(merchantQuickHasDrafts(rt))issues.push({
    type:'draft',title:'Ajustes aguardando confirmação',
    detail:'Você tem alterações de preço ou estoque ainda não salvas.',
    action:'stock'
  });
  if(!active.length)issues.push({
    type:'catalog',title:'Configure os produtos da revenda',
    detail:'Nenhum produto ativo foi encontrado no catálogo consultado.',
    action:'catalog'
  });
  else{
    if(incomplete)issues.push({
      type:'incomplete',title:incomplete===1?'1 produto com cadastro incompleto':incomplete+' produtos com cadastro incompleto',
      detail:'Confira os valores de preço e estoque antes de vender.',action:'catalog'
    });
    if(alerts.empty)issues.push({
      type:'stock',title:alerts.empty===1?'1 produto sem estoque':alerts.empty+' produtos sem estoque',
      detail:'Confira a reposição antes de voltar a oferecer esses itens.',action:'stock'
    });
    if(alerts.low)issues.push({
      type:'low',title:alerts.low===1?'1 produto com até 3 unidades':alerts.low+' produtos com até 3 unidades',
      detail:'Acompanhe a reposição para evitar falta de estoque.',action:'stock'
    });
    if(alerts.priceReview)issues.push({
      type:'price',title:alerts.priceReview===1?'1 preço para confirmar':alerts.priceReview+' preços para confirmar',
      detail:'Revise os preços que não possuem confirmação recente.',action:'stock'
    });
  }
  if(options.deliveryFresh===false)issues.push({
    type:'delivery',title:'Confira a taxa de entrega',
    detail:'A confirmação da taxa de entrega precisa ser atualizada.',action:'delivery'
  });
  return {issues,activeCount:active.length,alerts};
}
function merchantDailyChecklistView(rt,options={}){
  const model=merchantDailyChecklistModel(rt,options);
  if(!model)return '';
  const issues=model.issues;
  const hasStockWork=issues.some(x=>x.action==='stock');
  const hasCatalogWork=issues.some(x=>x.action==='catalog');
  const delivery=issues.some(x=>x.action==='delivery');
  const list=issues.length?'<ul class="merchant-daily-checklist-items">'+issues.map(item=>
    '<li><strong>'+esc(item.title)+'</strong><span>'+esc(item.detail)+'</span></li>'
  ).join('')+'</ul>':
    '<p class="merchant-daily-checklist-clear">Sem alertas de estoque, preços ou taxa de entrega nos dados consultados. A disponibilidade e a elegibilidade continuam indicadas no painel.</p>';
  const buttons=(hasStockWork?
    '<button type="button" class="secondary small" onclick="merchantAvailabilityGo(\'stock\')">Conferir preços e estoque</button>':'')+
    (hasCatalogWork?
    '<button type="button" class="secondary small" onclick="merchantQuickGoCatalog()">Configurar produtos</button>':'')+
    (!hasStockWork&&!hasCatalogWork?
    '<button type="button" class="ghost small" onclick="merchantQuickGoCatalog()">Ver catálogo completo</button>':'');
  return '<section class="merchant-daily-checklist" aria-label="Atenção aos produtos e entregas">'+
    '<div class="merchant-daily-checklist-heading"><div><span class="section-kicker">CONFERÊNCIA DO DIA</span>'+
    '<h2>O que precisa da sua atenção</h2><p>Alertas baseados nos dados da sua revenda, sem alterar nada automaticamente.</p></div>'+
    '<strong class="merchant-daily-checklist-count">'+issues.length+' '+(issues.length===1?'ponto':'pontos')+'</strong></div>'+
    list+'<div class="merchant-daily-checklist-actions">'+buttons+
    (delivery?'<button type="button" class="secondary small" onclick="merchantAvailabilityGo(\'delivery\')">Conferir entregas</button>':'')+
    '</div></section>';
}
function merchantQuickStockAdjust(productCode,change){
  const rt=globalThis.merchantRuntime||{};
  if(rt.status!=='ready'||rt.actionPending===true||
     !['owner','manager'].includes(String(rt.merchant?.memberRole||'')))return false;
  const code=String(productCode||'');
  if(!merchantQuickCatalogCandidates(rt).some(p=>p.productCode===code)||
     ![-1,1,5].includes(change))return false;
  const input=document.getElementById('merchant-quick-stock-'+code);
  if(!input||input.disabled||input.closest?.('fieldset')?.disabled)return false;
  const raw=String(input.value??'').trim();
  if(!/^(0|[1-9][0-9]{0,5})$/.test(raw))return false;
  const current=Number(raw),next=current+change;
  if(!Number.isInteger(next)||next<0||next>100000)return false;
  input.value=String(next);
  merchantQuickCatalogChanged(code);
  const message=document.getElementById('merchant-quick-feedback-'+code);
  if(message)message.textContent='Estoque ajustado para '+next+'. Toque em Salvar alterações para confirmar.';
  return true;
}
// V1.280: audit records are loaded only on request and never edited by the browser.
// V1.281: filter on the server, load older records on demand without losing current rows.
function merchantCatalogHistoryView(rt){
  if(!['owner','manager'].includes(String(rt?.merchant?.memberRole||'')))return '';
  const merchantId=String(rt?.merchant?.merchantId||'');
  const userId=String(rt?.session?.user?.id||'');
  if(!userId)return '';
  const state=globalThis.merchantCatalogHistoryState;
  const scoped=state?.merchantId===merchantId&&state?.userId===userId?state:null;
  const loading=scoped?.status==='loading';
  const paging=scoped?.status==='paging';
  const busy=loading||paging;
  const ready=scoped?.status==='ready'||paging;
  const events=ready&&Array.isArray(scoped.events)?scoped.events:[];
  const selected=String(scoped?.productCode||'');
  const options=(Array.isArray(rt.catalog)?rt.catalog:[])
    .filter(p=>/^[A-Z][A-Z0-9_]{1,31}$/.test(String(p?.productCode||'')))
    .filter((p,i,arr)=>arr.findIndex(item=>item.productCode===p.productCode)===i)
    .map(p=>'<option value="'+esc(p.productCode)+'"'+(selected===p.productCode?' selected':'')+'>'+
      esc(p.productName||p.productCode)+'</option>').join('');
  const currency=value=>Number.isSafeInteger(Number(value))&&value!==null?
    BRL.format(Number(value)/100):'—';
  const qty=value=>Number.isSafeInteger(Number(value))&&value!==null?String(Number(value)):'—';
  const list=events.map(event=>{
    const date=Date.parse(String(event?.recordedAt||''));
    const when=Number.isFinite(date)?new Date(date).toLocaleString('pt-BR'):'Data não informada';
    const actorName=String(event?.actorName||'').trim();
    const actorId=String(event?.actorId||'');
    const identity=actorName||('Responsável '+(actorId&&/^[0-9a-f-]{36}$/i.test(actorId)?actorId.slice(0,8):'identificado'));
    const role=event?.actorRole==='owner'?'Titular':event?.actorRole==='manager'?'Gerente':'Responsável';
    const action=event?.action==='created'?'Cadastro do produto':'Atualização confirmada';
    const product=String(event?.productCode||'');
    const catalogProduct=(Array.isArray(rt.catalog)?rt.catalog:[]).find(p=>p.productCode===product);
    return '<div class="merchant-catalog-event">'+
      '<div class="merchant-catalog-event-heading"><strong>'+esc(catalogProduct?.productName||product)+'</strong>'+
      '<span>'+esc(when)+'</span></div>'+
      '<p>'+esc(action)+' • '+esc(identity)+' ('+esc(role)+')</p>'+
      '<div class="merchant-catalog-event-values">'+
      '<span>Preço: <strong>'+esc(currency(event?.oldPriceCents))+' → '+esc(currency(event?.newPriceCents))+'</strong></span>'+
      '<span>Estoque: <strong>'+esc(qty(event?.oldStock))+' → '+esc(qty(event?.newStock))+'</strong></span>'+
      '</div>'+
      (event?.oldActive!==null&&event?.oldActive!==undefined&&
       event?.oldActive!==event?.newActive?
       '<small>Disponibilidade: '+esc(event.oldActive?'Ativo':'Pausado')+
       ' → '+esc(event.newActive?'Ativo':'Pausado')+'</small>':'')+
      '</div>';
  }).join('');
  const status=loading?'<p>Consultando registros confirmados…</p>':
    scoped?.status==='error'?'<p class="notice danger">'+esc(scoped.message||'Não foi possível consultar o histórico.')+'</p>':
    ready?(events.length?list+
      '<p class="tiny muted">'+events.length+' registro(s) carregado(s), até 30 por página.</p>'+
      (paging?'<p>Carregando registros anteriores…</p>':'')+
      (!paging&&scoped?.hasMore?
      '<button type="button" class="secondary small" onclick="merchantQuickHistoryLoad(true)">Ver alterações anteriores</button>':''):
      '<p>Não há alterações registradas para esta seleção desde a ativação do histórico.</p>'):
    '<p>Consulte o histórico real de alterações confirmadas no banco, com responsável e valores anteriores.</p>';
  return '<details class="merchant-catalog-history"'+(scoped?' open':'')+'><summary>Histórico real de preços e estoque</summary>'+
    '<div class="merchant-catalog-history-content">'+
    '<p class="tiny muted">Registros a partir da ativação desta funcionalidade. Alterações anteriores não foram reconstruídas.</p>'+
    '<div class="merchant-catalog-history-toolbar">'+
    '<label>Produto <select onchange="merchantQuickHistoryProductChanged(this.value)" aria-label="Filtrar histórico por produto">'+
    '<option value="">Todos os produtos</option>'+options+'</select></label>'+
    '<button type="button" class="secondary small" onclick="merchantQuickHistoryLoad()"'+
    (busy?' disabled':'')+'>'+(loading?'Consultando…':ready?'Atualizar histórico':'Consultar histórico')+'</button></div>'+
    (scoped?.message&&ready?'<p class="notice danger">'+esc(scoped.message)+'</p>':'')+
    '<div class="merchant-catalog-history-rows" aria-live="polite">'+status+'</div></div></details>';
}
function merchantQuickHistoryProductChanged(code){
  const rt=globalThis.merchantRuntime||{};
  const merchantId=String(rt.merchant?.merchantId||'');
  const userId=String(rt.session?.user?.id||'');
  if(rt.status!=='ready'||!merchantId||!userId||
     !['owner','manager'].includes(String(rt.merchant?.memberRole||'')))return;
  const productCode=String(code||'').trim().toUpperCase();
  if(productCode&&!(Array.isArray(rt.catalog)&&rt.catalog.some(p=>p.productCode===productCode)))return;
  globalThis.merchantHistoryRequestId=(globalThis.merchantHistoryRequestId||0)+1;
  globalThis.merchantCatalogHistoryState={merchantId,userId,productCode,status:'idle',
    events:[],hasMore:false,nextBeforeId:null};
  return merchantQuickHistoryLoad();
}
async function merchantQuickHistoryLoad(more=false){
  const rt=globalThis.merchantRuntime||{};
  const merchantId=String(rt.merchant?.merchantId||'');
  const userId=String(rt.session?.user?.id||'');
  if(rt.status!=='ready'||!merchantId||!userId||
     !['owner','manager'].includes(String(rt.merchant?.memberRole||'')))return;
  const previous=globalThis.merchantCatalogHistoryState?.merchantId===merchantId&&
    globalThis.merchantCatalogHistoryState?.userId===userId?
    globalThis.merchantCatalogHistoryState:null;
  if(previous?.status==='loading'||previous?.status==='paging')return;
  const productCode=String(previous?.productCode||'');
  if(more&&!(previous?.status==='ready'&&previous.hasMore&&
    Number.isSafeInteger(previous.nextBeforeId)&&previous.nextBeforeId>0))return;
  const beforeId=more?previous.nextBeforeId:null;
  const retained=more&&Array.isArray(previous.events)?previous.events:[];
  const requestId=(globalThis.merchantHistoryRequestId||0)+1;
  globalThis.merchantHistoryRequestId=requestId;
  globalThis.merchantCatalogHistoryState={merchantId,userId,productCode,
    status:more?'paging':'loading',events:retained,
    hasMore:more,nextBeforeId:beforeId};
  if(typeof render==='function')render();
  const stillCurrent=()=>globalThis.merchantHistoryRequestId===requestId&&
    globalThis.merchantRuntime?.status==='ready'&&
    String(globalThis.merchantRuntime?.merchant?.merchantId||'')===merchantId&&
    String(globalThis.merchantRuntime?.session?.user?.id||'')===userId&&
    ['owner','manager'].includes(String(globalThis.merchantRuntime?.merchant?.memberRole||''))&&
    globalThis.merchantCatalogHistoryState?.userId===userId&&
    globalThis.merchantCatalogHistoryState?.productCode===productCode;
  try{
    const page=await merchantCatalogHistoryPageLive(merchantId,{productCode,beforeId});
    if(!stillCurrent())return;
    const events=more?retained.concat(page.events):page.events;
    globalThis.merchantCatalogHistoryState={merchantId,userId,productCode,status:'ready',
      events,hasMore:page.hasMore,nextBeforeId:page.nextBeforeId};
  }catch(error){
    if(!stillCurrent())return;
    globalThis.merchantCatalogHistoryState={merchantId,userId,productCode,
      status:more?'ready':'error',events:retained,hasMore:Boolean(more),
      nextBeforeId:beforeId,message:String(error?.message||'Não foi possível consultar o histórico.')};
  }finally{
    if(stillCurrent()&&typeof render==='function')render();
  }
}

function merchantQuickCatalogView(rt){
  if(!['owner','manager'].includes(String(rt?.merchant?.memberRole||'')))return '';
  const all=Array.isArray(rt.catalog)?rt.catalog:[];
  const products=merchantQuickCatalogCandidates(rt);
  const alerts=merchantQuickStockAlerts(rt);
  const ready=rt.actionPending!==true;
  const recent=merchantQuickRecentChanges(rt);
  const hasDraft=products.some(p=>Boolean(merchantQuickDraftFor(rt,p)));
  const rows=products.map(p=>{
    const code=String(p.productCode);
    const range=p.pricingMode==='range';
    const min=Number(p.minPriceCents),max=Number(p.maxPriceCents);
    const validRange=!range||(Number.isSafeInteger(min)&&Number.isSafeInteger(max)&&
      min>0&&max<=1000000&&min<=Number(p.priceCents)&&Number(p.priceCents)<=max);
    const disabled=!ready||!validRange;
    const quantity=Number(p.availableStock);
    const draft=merchantQuickDraftFor(rt,p);
    const stockHint=quantity===0?'Sem estoque':quantity<=3?'Estoque baixo (até 3 unidades)':'';
    const priceNeedsReview=!merchantTimestampFresh(p.priceConfirmedAt);
    return '<div class="merchant-quick-product">'+
      '<div class="merchant-quick-product-heading"><strong>'+esc(p.productName||code)+'</strong>'+
      '<span>'+esc(code)+(range?' • faixa automática':'')+'</span></div>'+
      (stockHint?'<strong class="merchant-quick-stock-warning">'+esc(stockHint)+'</strong>':'')+      (priceNeedsReview?'<small class="merchant-quick-price-warning">Preço precisa de nova confirmação. Confira o valor e salve para atualizar.</small>':'')+
      '<fieldset class="merchant-quick-product-fields"'+(disabled?' disabled':'')+'>'+
      '<div class="merchant-quick-field"><label for="merchant-quick-price-'+code+'">'+(range?'Preço normal (R$)':'Preço (R$)')+'</label>'+
      '<input id="merchant-quick-price-'+code+'" class="input merchant-quick-price" type="number" inputmode="decimal" min="0.01" max="10000" step="0.01" oninput="merchantQuickCatalogChanged(\''+code+'\')" value="'+
      esc(draft?draft.price:(Number(p.priceCents)/100).toFixed(2))+'"></div>'+
      '<div class="merchant-quick-field"><label for="merchant-quick-stock-'+code+'">Em estoque</label>'+
      '<input id="merchant-quick-stock-'+code+'" class="input merchant-quick-stock" type="number" inputmode="numeric" min="0" max="100000" step="1" aria-describedby="merchant-quick-feedback-'+code+'" oninput="merchantQuickCatalogChanged(\''+code+'\')" value="'+
      esc(draft?draft.quantity:String(Number(p.availableStock)))+'"></div>'+
      '<div class="merchant-quick-stepper" aria-label="Ajustar estoque de '+esc(p.productName||code)+'">'+
        '<button type="button" aria-label="Retirar uma unidade do estoque de '+esc(p.productName||code)+'" onclick="merchantQuickStockAdjust(\''+code+'\',-1)">−1</button>'+
        '<button type="button" aria-label="Adicionar uma unidade ao estoque de '+esc(p.productName||code)+'" onclick="merchantQuickStockAdjust(\''+code+'\',1)">+1</button>'+
        '<button type="button" aria-label="Adicionar cinco unidades ao estoque de '+esc(p.productName||code)+'" onclick="merchantQuickStockAdjust(\''+code+'\',5)">+5</button></div>'+      '<button type="button" class="secondary small" onclick="merchantQuickCatalogSave(\''+code+'\')">Salvar alterações</button>'+      '<small id="merchant-quick-feedback-'+code+'" class="merchant-quick-feedback" aria-live="polite">'+
      (draft?'Alterações ainda não salvas. Confira os valores e toque em Salvar alterações.':
      'Os ajustes não são salvos automaticamente.')+'</small>'+
      '</fieldset>'+
      (range?'<small class="merchant-quick-product-hint">'+(validRange?
        'Faixa autorizada: '+esc(BRL.format(min/100))+' até '+esc(BRL.format(max/100))+'. Limites e estratégia só podem ser alterados no catálogo.':
        'A faixa precisa ser revisada no catálogo antes de fazer alterações rápidas.')+'</small>':'')+
      '</div>';
  }).join('');
  return '<details id="merchant-quick-catalog" class="merchant-quick-catalog"'+(hasDraft?' open':'')+'>'+
    '<summary><strong>Atualizar preço e estoque</strong><span>'+
      (alerts.empty||alerts.low||alerts.priceReview?
      [alerts.empty?alerts.empty+' esgotado(s)':'',alerts.low?alerts.low+' com estoque baixo':'',
       alerts.priceReview?alerts.priceReview+' preço(s) para confirmar':''].filter(Boolean).join(' • '):
      'Ajustes rápidos para até 6 produtos ativos')+'</span></summary>'+
    '<div class="merchant-quick-catalog-content">'+
    (alerts.empty||alerts.low||alerts.priceReview?
       '<p class="merchant-quick-attention">Conferência do catálogo: '+esc(
       [alerts.empty?alerts.empty+' sem estoque':'',alerts.low?alerts.low+' com até 3 unidades':'',
        alerts.priceReview?alerts.priceReview+' preço(s) sem confirmação recente':''].filter(Boolean).join(' • '))       +'. Consulte o catálogo completo para ver todos os itens.</p>':'')+
    (products.length?'<p>Confira os valores antes de salvar cada produto. Estoque zero mantém o produto sem ofertas.</p>':
      '<p>Não há produtos ativos com preço e estoque válidos para ajuste rápido. Use o catálogo completo.</p>')+
    '<div class="merchant-quick-product-list">'+rows+'</div>'+
    merchantCatalogHistoryView(rt)+
    (recent.length?'<details class="merchant-quick-recent"><summary>Últimas atualizações registradas</summary>'+
      '<p>Datas da última alteração de cada produto. Não é um histórico de cada movimento de estoque.</p>'+
      '<div class="merchant-quick-recent-list">'+recent.map(p=>
        '<div><strong>'+esc(p.productName||p.productCode)+'</strong><span>'+
        esc(new Date(p.updatedAt).toLocaleString('pt-BR'))+'</span></div>').join('')+
      '</div></details>':'')+
    '<button type="button" class="ghost small" onclick="merchantQuickGoCatalog()">Abrir catálogo completo'+
    (all.length>products.length?' ('+all.length+' produtos)':'')+'</button>'+
    '</div></details>';
}
async function merchantQuickCatalogSave(productCode){
  const rt=globalThis.merchantRuntime||{};
  if(rt.status!=='ready'||rt.actionPending===true||
     !['owner','manager'].includes(String(rt.merchant?.memberRole||'')))return;
  const code=String(productCode||'');
  const item=merchantQuickCatalogCandidates(rt).find(p=>p.productCode===code);
  if(!item)return toast('Produto indisponível para edição rápida. Atualize o painel.');
  const priceField=document.getElementById('merchant-quick-price-'+code);
  const stockField=document.getElementById('merchant-quick-stock-'+code);
  if(!priceField||!stockField)return toast('Atualize o painel para editar este produto.');
  const raw=String(priceField.value||'').trim(),stockRaw=String(stockField.value||'').trim();
  const price=Number(raw),stock=Number(stockRaw);
  const cents=Math.round(price*100);
  if(!raw||!stockRaw||!Number.isFinite(price)||price<=0||price>10000||
     !Number.isSafeInteger(cents)||!Number.isInteger(stock)||stock<0||stock>100000){
    return toast('Revise o preço e o estoque antes de salvar.');
  }
  let pricing={};
  if(item.pricingMode==='range'){
    const min=Number(item.minPriceCents),max=Number(item.maxPriceCents);
    if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||min<=0||max>1000000||
       min>max||cents<min||cents>max){
      return toast('O preço normal deve respeitar a faixa atual. Revise os limites no catálogo.');
    }
    pricing={pricingMode:'range',minPriceCents:min,maxPriceCents:max,
      pricingStrategy:String(item.pricingStrategy||'balanced')};
  }
  try{
    await merchantUpdateProductLive(code,cents,stock,item.active===true,pricing);
    merchantQuickDrafts.delete(merchantQuickDraftKey(rt,code));
    if(globalThis.merchantCatalogHistoryState?.merchantId===String(rt.merchant?.merchantId||'')){
      globalThis.merchantCatalogHistoryState=null; // New server event requires a fresh read.
    }
    if(typeof render==='function')render();
    toast('Preço e estoque de '+code+' confirmados.');
  }catch(e){toast(String(e?.message||e))}
}
function merchantAvailabilityGo(key){
  const rt=globalThis.merchantRuntime||{};
  if(!['owner','manager'].includes(String(rt.merchant?.memberRole||'')))return false;
  if(key==='stock'){
    if(!merchantQuickCatalogCandidates(rt).length){go('catalog');return true;}
    if(!merchantRevealControl('#merchant-quick-catalog .merchant-quick-price')){
      toast('Atualize o painel para editar o estoque.');return false;
    }
    return true;
  }
  if(key!=='delivery')return false;
  const opened=merchantRevealControl('#live-delivery-fee');
  if(!opened)toast('Atualize o painel para acessar as entregas.');
  return opened;
}
function merchantAvailabilityPanel(rt,options){
  const m=rt?.merchant||{};
  const role=String(m.memberRole||'');
  if(!['owner','manager','operator'].includes(role))return '';
  const manager=['owner','manager'].includes(role);
  const on=m.online===true;
  const pending=rt.actionPending===true;
  const blocked=!on&&options.canGoOnline!==true;
  const status=on?(options.financialHold?'Novas vendas suspensas por pendência financeira':
    options.connectionHealthy?'Revenda online':'Conexão sem confirmação recente'):'Novas ofertas pausadas';
  const help=on?
    (options.financialHold?'A operação está marcada como online, mas novas vendas estão suspensas até regularizar a pendência.':
    options.connectionHealthy?'Sua revenda está marcada como online. As novas ofertas dependem das verificações do sistema.':
    'Confira a conexão antes de confiar no recebimento de novas ofertas.'):
    'Enquanto estiver pausada, a revenda não recebe novas ofertas. Os pedidos já aceitos continuam disponíveis.';
  const stock=Array.isArray(rt.catalog)?rt.catalog:[];
  const offerable=stock.filter(item=>item?.active===true&&Number(item.availableStock)>0);
  const p13=options.p13;
  const p13Stock=p13&&Number.isInteger(Number(p13.availableStock))&&Number(p13.availableStock)>=0
    ?String(Number(p13.availableStock)):'—';
  const itemsInfo=offerable.length+' '+(offerable.length===1?'produto com estoque':'produtos com estoque');
  const fee=Number(m.deliveryFeeCents);
  const feeText=Number.isSafeInteger(fee)&&fee>=0?
    BRL.format(fee/100):'Não informado';
  const deliveryCopy=m.acceptsCitywide===false?'Atendimento na cidade desativado':
    options.freshness?.deliveryFresh===false?'Taxa de entrega precisa de confirmação':'Taxa de entrega registrada';
  const hint=blocked?
    '<small class="merchant-availability-blocked">'+(options.financialHold
      ?'Regularize o fechamento financeiro vencido antes de ficar online.'
      :'Antes de ficar online, confira produtos, entrega, pagamentos e a habilitação da revenda.')+'</small>':'';
  const button='<button id="merchant-online-toggle" type="button" class="'+(on?'danger-btn':'primary')+
    ' merchant-availability-toggle" onclick="merchantLiveToggleOnline('+(on?'false':'true')+')"'+
    (blocked||pending?' disabled':'')+'>'+(pending?'Atualizando…':on?'Pausar novos pedidos':'Ficar online')+'</button>';
  return '<section class="merchant-availability" aria-label="Disponibilidade da revenda">'+
    '<div class="merchant-availability-heading"><div><span class="section-kicker">SUA OPERAÇÃO AGORA</span>'+
    '<h2>'+esc(status)+'</h2><p>'+esc(help)+'</p></div>'+button+'</div>'+
    hint+'<div class="merchant-availability-stats">'+
    '<div><span>Estoque P13</span><strong>'+esc(p13Stock)+'</strong><small>'+esc(itemsInfo)+'</small></div>'+
    '<div><span>Entrega</span><strong>'+esc(feeText)+'</strong><small>'+esc(deliveryCopy)+'</small></div>'+
    '<div><span>Pedidos na fila</span><strong>'+Number(options.orderCount||0)+'</strong>'+
    '<small>Em andamento nesta operação</small></div></div>'+
    (manager?'<div class="merchant-availability-actions">'+
      '<button type="button" class="secondary small" onclick="merchantAvailabilityGo(\'stock\')">Ajustar estoque e preços</button>'+
      '<button type="button" class="secondary small" onclick="merchantAvailabilityGo(\'delivery\')">Ajustar entregas</button></div>':'')+
    '</section>';
}
// V1.303: first-use guidance never grants commercial or financial permission.
function merchantFirstRunModel(rt,canGoOnline){
  const m=rt?.merchant||{};
  if(rt?.status!=='ready'||!['owner','manager'].includes(String(m.memberRole||''))||
     canGoOnline===true)return null;
  const steps=merchantSetupSnapshot(rt);
  const pending=steps.filter(step=>!step.done);
  const diagnostic=rt.enablement?.merchant_id===m.merchantId&&
    Array.isArray(rt.enablement.checks)?rt.enablement:null;
  const adminPending=(diagnostic?.checks||[]).filter(x=>x?.ok!==true&&x?.owner==='admin').length;
  return {steps,pending,next:pending[0]||null,completed:steps.length-pending.length,
    adminPending,needsAdminApproval:m.status!=='active'||adminPending>0,
    financialHold:rt.billing?.account?.salesHold===true};
}
function merchantFirstRunView(rt,canGoOnline){
  const model=merchantFirstRunModel(rt,canGoOnline);
  if(!model)return '';
  const title=model.financialHold?'Novas vendas aguardam regularização':
    model.needsAdminApproval?'A liberação depende do TAMÃO':
    model.next?'Prepare sua revenda para começar':'Verifique o que ainda falta';
  const lead=model.financialHold
    ?'Há uma restrição financeira. Consulte os detalhes do financeiro para acompanhar a regularização.'
    :model.needsAdminApproval
      ?'Aprovação ou validações da plataforma estão pendentes. Você pode preparar a operação sem liberar vendas por conta própria.'
      :model.next
        ?'Revise os dados da empresa para que ela possa ser encontrada pelos clientes elegíveis.'
        :'Os dados básicos estão preenchidos, mas ainda existem verificações necessárias para operar.';
  const rows=model.steps.map((step,i)=>'<li class="'+(step.done?'is-done':'is-pending')+'">'+
    '<span aria-hidden="true">'+(step.done?'✓':String(i+1))+'</span>'+
    '<div><strong>'+esc(step.title)+'</strong><small>'+esc(step.detail)+'</small></div>'+
    '<button type="button" class="secondary small" onclick="merchantSetupGo(\''+step.key+'\')">'+
      (step.done?'Revisar':'Configurar')+'</button></li>').join('');
  const cta=model.next?
    '<button type="button" class="primary" onclick="merchantSetupGo(\''+model.next.key+'\')">Continuar por '+esc(model.next.title)+' →</button>':
    '<button type="button" class="primary" onclick="merchantEnablementRecheck()">Conferir requisitos →</button>';
  return '<section id="merchant-first-run" class="merchant-first-run" aria-label="Guia para começar a vender">'+
    '<div class="merchant-first-run-head"><div><span class="section-kicker">PRIMEIROS PASSOS</span>'+
    '<h2>'+esc(title)+'</h2><p>'+esc(lead)+'</p></div>'+
    '<span class="merchant-first-run-count">'+model.completed+' de 3 configurados</span></div>'+
    '<ol class="merchant-first-run-steps">'+rows+'</ol>'+
    '<div class="merchant-first-run-actions">'+cta+
    '<button type="button" class="secondary" onclick="merchantWorkspaceJump(\'setup\')">Ver todas as verificações</button></div>'+
    '<p class="merchant-first-run-note">A configuração não libera vendas automaticamente. Aprovações, módulos estratégicos e autorizações financeiras continuam sob controle administrativo e validação do servidor.</p>'+
    '</section>';
}
function merchantWorkspaceJump(area){
  const keys={orders:'merchant-live-orders',start:'merchant-workspace-start',setup:'merchant-workspace-setup',growth:'merchant-workspace-growth',
    settings:'merchant-workspace-settings',finance:'merchant-workspace-finance'};
  const id=keys[String(area||'')];
  if(!id)return false;
  const panel=document.getElementById(id);
  if(!panel)return false;
  if(panel.tagName==='DETAILS')panel.open=true;
  const focusTarget=panel.querySelector('summary')||panel.querySelector('h2');
  panel.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  if(focusTarget)focusTarget.focus({preventScroll:true});
  return true;
}
// V1.348 — read-only guide to the next relevant workspace, never a permission grant.
function merchantWorkspaceOrientation(rt,{canGoOnline=false,connectionHealthy=false,financialHold=false,orders=[]}={}){
  const m=rt?.merchant||{};
  const count=Array.isArray(orders)?orders.length:0;
  const manage=['owner','manager'].includes(String(m.memberRole||''));
  if(count>0)return {
    tone:'attention',eyebrow:'SEU PRÓXIMO PASSO',title:'Confira seus pedidos',
    detail:count===1?'Há 1 pedido na fila. Veja a situação antes de agir.':
      'Há '+count+' pedidos na fila. Priorize o que precisa de atenção.',
    action:'orders',label:'Ver fila de pedidos'
  };
  if(financialHold)return {
    tone:'blocked',eyebrow:'SEU PRÓXIMO PASSO',title:'Há uma restrição financeira',
    detail:'Novas vendas estão suspensas. Consulte a situação no painel autorizado.',
    action:manage?'finance':'start',label:manage?'Ver resultados e financeiro':'Ver situação da operação'
  };
  if(!canGoOnline)return {
    tone:'setup',eyebrow:'SEU PRÓXIMO PASSO',title:'Prepare sua revenda',
    detail:manage?'Confira o que falta configurar. As liberações dependem das verificações do TAMÃO.':
      'Veja o que falta para sua operação. A liberação não acontece por este atalho.',
    action:manage?'setup':'start',label:manage?'Continuar configuração':'Ver situação da operação'
  };
  if(m.online!==true)return {
    tone:'paused',eyebrow:'SEU PRÓXIMO PASSO',title:'Novos pedidos pausados',
    detail:'Sua revenda está preparada, mas offline. Confira a disponibilidade quando quiser atender.',
    action:'start',label:'Conferir disponibilidade'
  };
  if(!connectionHealthy)return {
    tone:'attention',eyebrow:'SEU PRÓXIMO PASSO',title:'Confira sua conexão',
    detail:'A presença da revenda ainda não tem confirmação recente. Consulte a situação antes de esperar novos pedidos.',
    action:'start',label:'Verificar operação'
  };
  return {
    tone:'ready',eyebrow:'SEU PRÓXIMO PASSO',title:'Tudo pronto para acompanhar',
    detail:'A operação está online. Mantenha preços, produtos e entregas atualizados.',
    action:'start',label:'Revisar produtos e entregas'
  };
}
// V1.354 — the server-authorized order snapshot must be freshly retrieved before
// presenting operational controls. Heartbeat presence is not a merchant-orders read.
function merchantOrderListEvidence(rt,now=Date.now()){
  if(rt?.status!=='ready'||!rt?.merchant)return {
    fresh:false,kind:'unverified',label:'Ainda não foi possível confirmar a lista de pedidos.'
  };
  const selected=String(rt.selectedMerchantId||'');
  const actual=String(rt.merchant.merchantId||'');
  if(selected&&actual&&selected!==actual)return {
    fresh:false,kind:'mismatch',label:'A lista exibida não corresponde à revenda selecionada. Atualize antes de agir.'
  };
  const checked=Date.parse(String(rt.lastSyncAt||''));
  if(!Number.isFinite(checked)||checked>now+60000)return {
    fresh:false,kind:'unverified',label:'Não há confirmação recente da lista de pedidos nesta sessão.'
  };
  const age=Math.max(0,now-checked);
  if(age>120000)return {
    fresh:false,kind:'stale',label:'A última consulta dos pedidos foi há '+Math.floor(age/60000)+' min. Os estados podem ter mudado.'
  };
  return {fresh:true,kind:'current',label:'Pedidos consultados recentemente. Qualquer ação ainda depende da confirmação do sistema.'};
}
function merchantOrderListRecovery(rt){
  const evidence=merchantOrderListEvidence(rt);
  if(evidence.fresh)return '';
  const count=Array.isArray(rt?.orders)?rt.orders.length:0;
  return '<section class="merchant-orders-recovery" role="status" aria-label="Atualização dos pedidos necessária">'+
    '<strong>Atualize a lista antes de atender</strong>'+
    '<p>'+esc(evidence.label)+' Nenhum pedido é aceito ou alterado por esta atualização.</p>'+
    (count?'<small>'+count+' '+(count===1?'pedido constava':'pedidos constavam')+
      ' na última lista; '+(count===1?'não representa':'não representam')+
      ' uma fila verificada agora.</small>':'')+
    '<button type="button" class="primary" onclick="merchantLiveRefresh()" '+
      (rt?.actionPending===true?'disabled':'')+'>Atualizar pedidos →</button></section>';
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
    return shell(`<section class="page"><h1 class="page-title">Painel da revenda</h1><div class="notice danger"><strong>Não foi possível confirmar os pedidos atuais.</strong><br>${esc(rt.error||'Tente novamente.')}</div><p class="tiny muted">Se a conexão falhou temporariamente, o TAMÃO tenta consultar novamente. Até recuperar a sincronização, ações em pedidos ficam indisponíveis nesta tela.</p><button class="secondary full" style="margin-top:12px" onclick="merchantLiveRefresh()">Tentar novamente agora</button></section>`);
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
  const orderEvidence=merchantOrderListEvidence(rt);
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
  const orientation=orderEvidence.fresh?merchantWorkspaceOrientation(rt,{
    canGoOnline,connectionHealthy,financialHold,orders
  }):{
    tone:'attention',eyebrow:'SEU PRÓXIMO PASSO',title:'Confirme sua fila de pedidos',
    detail:'A consulta de pedidos precisa ser renovada. As ações ficam indisponíveis nesta visualização até a atualização.',
    action:'orders',label:'Ver atualização dos pedidos'
  };
  const orientationMarkup=`<aside class="merchant-workspace-orientation merchant-workspace-orientation--${orientation.tone}" aria-label="Orientação de trabalho">
    <span class="merchant-orientation-eyebrow">${esc(orientation.eyebrow)}</span>
    <strong>${esc(orientation.title)}</strong>
    <p>${esc(orientation.detail)}</p>
    <button type="button" class="merchant-orientation-action" onclick="merchantWorkspaceJump('${orientation.action}')">${esc(orientation.label)} <span aria-hidden="true">→</span></button>
  </aside>`;
  const connectionNotice=!connectionHealthy
    ? '<div class="notice danger" style="margin-top:12px"><strong>Conexão da operação sem confirmação recente.</strong><br>Enquanto a presença da revenda não for renovada, novos pedidos podem deixar de ser enviados para esta operação.</div>'
    : rt.heartbeatError
      ? '<div class="notice" style="margin-top:12px"><strong>Reconectando presença da revenda.</strong><br>'+esc(rt.heartbeatError)+'</div>'
      : '';

  return shell(`<section class="page merchant-workspace">
    <header class="merchant-workspace-header"><div class="merchant-workspace-identity">
      <div class="merchant-workspace-identity-meta"><span class="tiny">SUA REVENDA • ${esc(m.memberRole==='owner'?'RESPONSÁVEL':m.memberRole==='manager'?'GERÊNCIA':'OPERAÇÃO')}</span><span class="status-pill ${m.online?(heartbeatFresh?'online':'risk'):'offline'}">${m.online?(heartbeatFresh?'● ONLINE':'● SEM CONEXÃO'):'● OFFLINE'}</span></div>
      <h1 class="page-title">${esc(m.name)}</h1>
      <p class="merchant-workspace-welcome">Tudo o que importa para atender bem, organizado para o seu dia.</p>
      <div class="merchant-workspace-readonly"><span><strong>${orders.length}</strong> ${orderEvidence.fresh?(orders.length===1?'pedido na fila':'pedidos na fila'):'na última lista'}</span><span>Dados da sua operação</span></div>
    </div>${orientationMarkup}</header>
    <nav class="merchant-workspace-shortcuts" aria-label="Acesso rápido ao trabalho da revenda">
      <button type="button" class="merchant-workspace-shortcut is-primary" onclick="merchantWorkspaceJump('orders')"><span class="merchant-shortcut-icon" aria-hidden="true">📦</span><strong>Pedidos</strong><small>${orders.length} na fila de trabalho</small></button>
      <button type="button" class="merchant-workspace-shortcut" onclick="merchantWorkspaceJump('start')"><span class="merchant-shortcut-icon" aria-hidden="true">🧺</span><strong>${canGoOnline?'Produtos e entregas':'Comece por aqui'}</strong><small>${canGoOnline?'Estoque, preços e disponibilidade':'Prepare sua operação'}</small></button>
      ${manage?'<button type="button" class="merchant-workspace-shortcut" onclick="merchantWorkspaceJump(\'finance\')"><span class="merchant-shortcut-icon" aria-hidden="true">▥</span><strong>Resultados</strong><small>Vendas e financeiro</small></button>':''}
      ${manage?'<button type="button" class="merchant-workspace-shortcut merchant-shortcut-growth" onclick="merchantWorkspaceJump(\'growth\')"><span class="merchant-shortcut-icon" aria-hidden="true">↗</span><strong>Divulgar e indicar</strong><small>Rede, campanhas e parcerias</small></button>':''}
      <button type="button" class="merchant-workspace-shortcut" onclick="merchantWorkspaceJump('settings')"><span class="merchant-shortcut-icon" aria-hidden="true">⚙</span><strong>Minha revenda</strong><small>Equipe, alertas e opções</small></button>
    </nav>

    ${rt.error?`<div class="notice danger" style="margin-top:12px">${esc(rt.error)}</div>`:''}
    ${merchantAvailabilityPanel(rt,{canGoOnline,connectionHealthy,financialHold,freshness,p13,orderCount:orders.length})}
    ${orderEvidence.fresh?merchantDailyOverview(rt,orders):'<p class="merchant-queue-unverified-intro">A fila de pedidos precisa de atualização. Veja as orientações em Pedidos que exigem ação.</p>'}
    ${merchantFirstRunView(rt,canGoOnline)}
    ${financialHold?'<div class="notice danger" style="margin-top:12px"><strong>Novas vendas suspensas por pendência financeira.</strong><br>Regularize o fechamento vencido. Pedidos já aceitos continuam disponíveis normalmente.</div>':''}

    ${orderEvidence.fresh?merchantDeliveryBoardView(rt,orders):''}
    <section class="section" id="merchant-live-orders"><div class="section-head"><div><h2 tabindex="-1">Pedidos que exigem ação</h2><p>Aceite, saída e recebimento só são registrados depois de confirmação no sistema.</p></div></div>${orderEvidence.fresh?merchantDeliveryAttentionView(rt):''}${orderEvidence.fresh?merchantOrderQueueView(orders):merchantOrderListRecovery(rt)}</section>

    <details id="merchant-workspace-start" class="merchant-workspace-section"${!canGoOnline?' open':''}><summary tabindex="0"><span><strong>${canGoOnline?'Produtos e entregas':'Comece por aqui: prepare sua operação'}</strong><small>${canGoOnline?'Atualize estoque, preços e configurações quando precisar.':'Veja as etapas que exigem atenção para sua revenda começar a receber ofertas.'}</small></span></summary><div class="merchant-workspace-content">
      ${merchantDailyChecklistView(rt,{deliveryFresh:freshness.deliveryFresh})}
      ${merchantQuickCatalogView(rt)}
      ${connectionNotice}
      ${complianceNotice}
      ${freshnessNotice}
    </div></details>


    <details id="merchant-workspace-setup" class="merchant-workspace-section"><summary tabindex="0"><span><strong>Terminar a configuração para vender</strong><small>Produtos, entrega e recebimento, com as confirmações e habilitações necessárias.</small></span></summary><div class="merchant-workspace-content">
      ${merchantSetupView(rt)}
    </div></details>
    <details id="merchant-workspace-growth" class="merchant-workspace-section"><summary tabindex="0"><span><strong>Vender mais e ampliar sua rede</strong><small>Divulgação, benefícios, parcerias e indicações organizados em um só lugar.</small></span></summary><div class="merchant-workspace-content">
      ${merchantAdsStartSection(m)}
      ${merchantAdsAssistanceSection(m)}
      ${merchantAdsContactFeedbackSection(m)}
      ${merchantAdsFeedbackReturnSection(m)}
      ${merchantAdsReturnExecutionSection(m)}
      ${merchantAdsInterestSection(m)}
      ${merchantClubeInterestSection(m)}
      ${merchantClubeTermsSection(m)}
      ${merchantAdsCampaignSection(m)}
      ${merchantAdsOfferSection(m)}
      ${merchantAdsDossierSection(m)}
      ${merchantAdsInstrumentSection(m)}
      ${merchantAdsReceivableSection(m)}
      ${merchantAdsPspSection(m)}
      ${merchantAdsPspEvidenceSection(m)}
      ${merchantGrowthNetworkSection(m)}
    </div></details>
    <details id="merchant-workspace-finance" class="merchant-workspace-section"><summary tabindex="0"><span><strong>Resultados e financeiro</strong><small>Desempenho e cobranças da plataforma, separados dos pedidos do dia.</small></span></summary><div class="merchant-workspace-content">
      ${merchantBusinessPulseSection(m)}
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
    </div></details>

    <details id="merchant-workspace-settings" class="merchant-workspace-section"><summary tabindex="0"><span><strong>Minha revenda e configurações</strong><small>Notificações, equipe, documentos e preferências de operação.</small></span></summary><div class="merchant-workspace-content">
      ${merchantAlertControl()}
    <details class="merchant-diagnostic-drawer"><summary>Verificações de documentos e habilitação</summary>
      ${merchantEnablementAssistantView(rt)}
    </details>

    <div class="card flat form-stack" style="margin-top:14px">
      ${memberships.length>1?`<div class="input-wrap"><label for="merchant-live-select">Operação</label><select id="merchant-live-select" class="input" onchange="merchantLiveSelect(this.value)">${memberships.map(x=>`<option value="${esc(x.merchantId)}" ${x.merchantId===m.merchantId?'selected':''}>${esc(x.name)} • ${esc(x.memberRole)}</option>`).join('')}</select></div>`:''}
      <div class="order-actions"><button class="secondary small" onclick="merchantLiveRefresh()">Atualizar</button>${manage?'<button class="secondary small" onclick="merchantOpenTeam()">Equipe</button>':''}<button class="ghost small" onclick="merchantLiveLogout()">Sair</button></div>
    </div>

      ${manage?`<details id="merchant-operation-settings" class="merchant-settings-drawer"><summary>Configurações da revenda <span>Preços, entregas, pagamentos e outras opções</span></summary><div class="card flat form-stack">
      <h3>Produtos</h3>
      <p class="muted tiny">Edite os preços e estoques na seção de ajuste rápido, no início do painel, ou use o catálogo completo para configurar produtos e faixas.</p>
      <button class="secondary" type="button" onclick="merchantAvailabilityGo('stock')">Abrir ajuste rápido</button><button class="ghost" type="button" onclick="go('catalog')">Editar todos os produtos</button>
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
      <p class="muted tiny">Comece pelo simples: escolha o que aceita na entrega. Ao salvar, o TAMÃO configura as rotas de confirmação manual. Conectar banco ou maquininha é opcional.</p>
      <label class="check-row"><input id="live-payment-pix" type="checkbox" ${paymentMethods.pix?'checked':''}><span><strong>Pix</strong><small>Pagamento via Pix aceito pela operação.</small></span></label>
      <label class="check-row"><input id="live-payment-card" type="checkbox" ${paymentMethods.card?'checked':''}><span><strong>Cartão</strong><small>Cartão aceito na entrega conforme sua operação.</small></span></label>
      <label class="check-row"><input id="live-payment-cash" type="checkbox" ${paymentMethods.cash?'checked':''}><span><strong>Dinheiro</strong><small>Dinheiro aceito; o pedido pode informar troco.</small></span></label>
      <button class="primary" onclick="merchantLiveSavePaymentMethods()">Salvar como recebo</button>
      ${paymentConnectionsCard}
      <div class="divider"></div>
      <details class="merchant-settings-advanced"><summary>Agendamento de entregas</summary><div class="form-stack"><h3>Pedidos agendados</h3>
      <label class="check-row"><input id="live-scheduled-orders" type="checkbox" ${acceptsScheduledOrders?'checked':''}><span><strong>Aceitar entregas agendadas</strong><small>Quando ativo, clientes podem escolher janelas futuras de até 72 horas. O horário aparece antes do aceite.</small></span></label>
      <button class="secondary" onclick="merchantLiveSaveScheduling()">Salvar agendamento</button></div></details>
    </div></details>`:''}
    </div></details>

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
  // The full queue keeps secondary orders in native details, even when collapsed.
  for(let parent=card.parentElement;parent;parent=parent.parentElement){
    if(parent.tagName==='DETAILS')parent.open=true;
  }
  card.scrollIntoView?.({behavior:'smooth',block:'center'});
  card.focus?.({preventScroll:true});
  return true;
}
// V1.283 — navigate to the existing control without executing any order transition.
function merchantOrderNextStepLabel(order){
  switch(String(order?.status||'')){
    case 'OFFERED_TO_MERCHANT': return 'Conferir aceite';
    case 'PREPARING': return 'Conferir saída';
    case 'AT_RISK': return 'Revisar imprevisto';
    case 'OUT_FOR_DELIVERY': return 'Conferir chegada';
    case 'ARRIVING': return 'Conferir pagamento e PIN';
    case 'MERCHANT_ACCEPTED': return 'Acompanhar preparação';
    default: return 'Ver pedido';
  }
}
function merchantFocusOrderNextStep(orderId){
  const id=String(orderId||'');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return false;
  const rt=globalThis.merchantRuntime||{};
  const role=String(rt.merchant?.memberRole||'');
  if(rt.status!=='ready'||rt.actionPending===true||
     !['owner','manager','operator','driver'].includes(role))return false;
  const order=(Array.isArray(rt.orders)?rt.orders:[]).find(x=>String(x?.orderId||'')===id);
  if(!order)return false; // Must be an order in the current server-authorized list.
  const card=document.getElementById('merchant-order-card-'+id);
  if(!card||!merchantFocusLiveOrder(id))return false;
  const actionButton=()=>card.querySelector?.('.merchant-order-action-fieldset button.primary:not([disabled]),.merchant-order-action-fieldset button.secondary:not([disabled])');
  const status=String(order.status||'');
  let target=null;
  if(status==='OFFERED_TO_MERCHANT'){
    const expiry=Date.parse(String(order.offerExpiresAt||''));
    if(Number.isFinite(expiry)&&expiry>Date.now()+1000)target=actionButton();
  }else if(status==='PREPARING'){
    if(['owner','manager'].includes(role)&&!order.assignedDeliveryUserId)
      target=card.querySelector?.('[id="delivery-'+id+'"]');
    if(!target)target=actionButton();
  }else if(status==='OUT_FOR_DELIVERY'){
    target=actionButton();
  }else if(status==='ARRIVING'){
    const paid=card.querySelector?.('[id="live-paid-'+id+'"]');
    const pin=card.querySelector?.('[id="live-pin-'+id+'"]');
    const submit=card.querySelector?.('[id="live-deliver-submit-'+id+'"]');
    target=paid&&!paid.checked?paid:pin&&!/^[0-9]{4}$/.test(String(pin.value||''))?pin:submit;
  }
  // Risk and accepted orders need review, not a blind attempt to dispatch/accept.
  if(!target||target.disabled||target.closest?.('fieldset')?.disabled)return true;
  for(let parent=target.parentElement;parent;parent=parent.parentElement){
    if(parent.tagName==='DETAILS')parent.open=true;
  }
  target.scrollIntoView?.({behavior:'smooth',block:'center'});
  target.focus?.({preventScroll:true});
  return true;
}
// V1.271 — one read-only next action from server-scoped orders, never an order transition.
function merchantDailyFocusModel(orders,now=Date.now()){
  const rows=Array.isArray(orders)?orders:[];
  const byStatus=status=>rows.filter(x=>x?.status===status);
  const offers=byStatus('OFFERED_TO_MERCHANT').filter(order=>{
    const raw=String(order?.offerExpiresAt||'');
    const expires=raw?Date.parse(raw):NaN;
    return Number.isFinite(expires)&&expires>now+1000;
  }).sort((a,b)=>{
    const expiry=x=>{const n=Date.parse(String(x?.offerExpiresAt||''));return Number.isFinite(n)?n:Number.MAX_SAFE_INTEGER;};
    return expiry(a)-expiry(b);
  });
  const urgentOffer=offers.find(x=>{
    const expires=Date.parse(String(x?.offerExpiresAt||''));
    return Number.isFinite(expires)&&expires-now<=5*60*1000;
  });
  const risk=byStatus('AT_RISK')[0];
  const arriving=byStatus('ARRIVING')[0];
  const delivery=byStatus('OUT_FOR_DELIVERY')[0];
  const preparing=byStatus('PREPARING')[0];
  const accepted=byStatus('MERCHANT_ACCEPTED')[0];
  let order=null,title='',detail='';
  if(urgentOffer){order=urgentOffer;title='Novo pedido aguardando resposta';detail='Confira se pode atender antes do prazo informado.';}
  else if(risk){order=risk;title='Pedido com imprevisto';detail='Confira a situação e escolha o próximo passo no próprio pedido.';}
  else if(offers.length){order=offers[0];title='Novo pedido para aceitar';detail='Confirme estoque e entrega antes de responder.';}
  else if(arriving){order=arriving;title='Entrega aguardando conferência';detail='Confira a entrega, o PIN e o recebimento antes de concluir.';}
  else if(delivery){order=delivery;title='Entrega em andamento';detail='Registre a chegada apenas quando estiver próximo do destino.';}
  else if(preparing){order=preparing;title='Pedido em preparação';detail='Confira os produtos e confirme a saída somente quando acontecer.';}
  else if(accepted){order=accepted;title='Pedido aceito';detail='Acompanhe a preparação antes da próxima etapa.';}
  else if(byStatus('OFFERED_TO_MERCHANT').length){
    return {order:null,title:'Atualize os pedidos',detail:'Há uma oferta com prazo aparentemente vencido. Atualize para confirmar o estado no servidor.',refresh:true};
  }else if(rows.length){
    return {order:null,title:'Confira os pedidos',detail:'Existem pedidos com situação não reconhecida por este resumo. Consulte a fila completa.',refresh:false};
  }
  if(!order)return {order:null,title:'Nenhum pedido em andamento',detail:'Quando houver um pedido atribuído à sua operação, ele aparecerá na fila.',refresh:false};
  return {order,title,detail,refresh:false};
}
// V1.353: read-only queue measurements, scoped to the orders returned for this member.
// Unknown or expired response windows are NOT treated as offers ready to accept.
function merchantDayQueuePulse(orders,now=Date.now()){
  const rows=Array.isArray(orders)?orders:[];
  const offers=rows.filter(o=>o?.status==='OFFERED_TO_MERCHANT');
  const validOffers=offers.filter(o=>{
    const raw=String(o?.offerExpiresAt||'');
    const deadline=Date.parse(raw);
    return /^20\d\d-\d\d-\d\dT/.test(raw)
      &&Number.isFinite(deadline)&&deadline>now+1000;
  });
  return {
    waiting:validOffers.length,
    refresh:offers.length-validOffers.length,
    incidents:rows.filter(o=>o?.status==='AT_RISK').length,
    deliveries:rows.filter(o=>['OUT_FOR_DELIVERY','ARRIVING'].includes(String(o?.status||''))).length
  };
}
function merchantDayQueuePulseView(orders){
  const pulse=merchantDayQueuePulse(orders);
  const signals=[
    ['Resposta pendente',pulse.waiting],
    ['Imprevistos',pulse.incidents],
    ['Em entrega',pulse.deliveries]
  ].map(([label,count])=>
    '<span class="merchant-day-queue-chip"><strong>'+count+'</strong><small>'+esc(label)+'</small></span>').join('');
  return '<div class="merchant-day-queue-pulse" role="group" aria-label="Resumo da fila de pedidos">'+
    signals+
    (pulse.refresh?'<div class="merchant-day-queue-warning" role="status"><span>'+pulse.refresh+
      (pulse.refresh===1?' oferta precisa de nova consulta.':' ofertas precisam de nova consulta.')+
      ' Não aceite sem um prazo válido.</span>'+
      '<button type="button" class="secondary small" onclick="merchantLiveRefresh()">Atualizar pedidos</button></div>':'')+
    '</div>';
}
function merchantDailyVerifiedSales(rt){
  const role=String(rt?.merchant?.memberRole||'');
  const merchantId=String(rt?.merchant?.merchantId||'');
  const d=rt?.businessPulse;
  const m=d?.metrics;
  const keys=['ordersCreated','settledOrders','cancelledOrders','reversedOrders','activeOrders','settledSalesCents'];
  if(!['owner','manager'].includes(role)||!merchantId||
     d?.merchantId!==merchantId||d?.source!=='merchant_business_pulse_v1_231'||
     d?.readOnly!==true||d?.salesNotPlatformRevenue!==true||
     d?.adsBillingEnabled!==false||d?.proBillingEnabled!==false||d?.periodDays!==30||
     !m||!keys.every(k=>Number.isSafeInteger(m[k])&&m[k]>=0)||
     m.ordersCreated!==m.settledOrders+m.cancelledOrders+m.reversedOrders+m.activeOrders)return null;
  return {salesCents:m.settledSalesCents,orders:m.settledOrders};
}
function merchantDailyOpenSales(){
  const rt=globalThis.merchantRuntime||{};
  if(!['owner','manager'].includes(String(rt.merchant?.memberRole||'')))return;
  merchantRevealControl('#merchant-business-pulse');
  if(!merchantDailyVerifiedSales(rt)&&!rt.businessPulseLoading)
    merchantBusinessPulseLoadFromUi();
}
function merchantDailyOverview(rt,orders){
  const role=String(rt?.merchant?.memberRole||'');
  const isDriver=role==='driver';
  const canSeeSales=['owner','manager'].includes(role);
  const focus=merchantDailyFocusModel(orders);
  const pulse=merchantDayQueuePulseView(orders);
  const id=String(focus.order?.orderId||'');
  const safe=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  const label=focus.order?.publicCode?esc(focus.order.publicCode):'Pedido';
  const action=safe?'<button type="button" class="primary" onclick="merchantFocusOrderNextStep(\''+id+'\')">'+
    esc(merchantOrderNextStepLabel(focus.order))+' • '+label+'</button>':
    focus.refresh?'<button type="button" class="secondary" onclick="merchantLiveRefresh()">Atualizar pedidos</button>':
    '';
  const sales=merchantDailyVerifiedSales(rt);
  const salesHtml=!canSeeSales?'':sales?
    '<div class="merchant-daily-sales"><span>Vendas registradas • últimos 30 dias</span><strong>'+
    esc(BRL.format(sales.salesCents/100))+'</strong><small>'+
    sales.orders+' pedido(s) concluído(s) sem reversão. Valores dos pedidos, não lucro nem saldo bancário.</small>'+
    '<button type="button" class="ghost small" onclick="merchantDailyOpenSales()">Ver detalhes</button></div>':
    '<div class="merchant-daily-sales"><span>Suas vendas</span><strong>Consultar resultados</strong>'+
    '<small>Mostramos apenas vendas concluídas e verificadas no histórico de pedidos.</small>'+
    '<button type="button" class="secondary small" onclick="merchantDailyOpenSales()">Ver vendas dos últimos 30 dias</button></div>';
  const count=Array.isArray(orders)?orders.length:0;
  return '<section class="merchant-daily-overview" aria-label="Resumo de trabalho da revenda">'+
    '<div class="merchant-daily-main"><span class="section-kicker">'+(isDriver?'MINHAS ENTREGAS':'AGORA NA SUA REVENDA')+'</span>'+
    '<h2>'+esc(focus.title)+'</h2>'+
    (focus.order?'<strong class="merchant-daily-order-code">'+label+'</strong>':'')+
    '<p>'+esc(focus.detail)+'</p>'+
    pulse+
    '<div class="merchant-daily-actions">'+action+
    '<span class="tiny muted">'+count+' '+(count===1?'pedido na fila':'pedidos na fila')+
    ' • ações só são efetivadas no pedido</span></div></div>'+
    salesHtml+'</section>';
}
// V1.273 — compact multi-delivery board, read-only and scoped to server-returned orders.
function merchantDeliveryBoardModel(orders,now=Date.now()){
  const list=(Array.isArray(orders)?orders:[]).filter(order=>
    order&&['OUT_FOR_DELIVERY','ARRIVING'].includes(String(order.status||'')));
  const priority=order=>{
    if(order.status==='ARRIVING')return 0;
    const deadline=merchantOrderScheduleDate(order.promisedBy);
    return deadline&&deadline.getTime()<now?1:2;
  };
  const deadline=order=>{
    const d=merchantOrderScheduleDate(order.promisedBy);
    return d?d.getTime():Number.MAX_SAFE_INTEGER;
  };
  return [...list].sort((a,b)=>priority(a)-priority(b)||deadline(a)-deadline(b)||
    String(a.orderId||'').localeCompare(String(b.orderId||'')));
}
function merchantDeliveryBoardView(rt,orders){
  const role=String(rt?.merchant?.memberRole||'');
  if(!['owner','manager','operator','driver'].includes(role))return '';
  const active=merchantDeliveryBoardModel(orders);
  // A single order is already emphasized by V1.271; never duplicate it here.
  if(active.length<2)return '';
  const arriving=active.filter(order=>order.status==='ARRIVING').length;
  const visible=active.slice(0,6);
  const rows=visible.map(order=>{
    const id=String(order.orderId||'');
    const valid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
    const status=order.status==='ARRIVING'?'Aguardando conferência':'A caminho';
    const eta=merchantOrderScheduleDate(order.promisedBy);
    const signal=merchantOrderAttention(order);
    const deadline=eta?'Previsão registrada: '+eta.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'Sem previsão registrada';
    const open=valid?'<button type="button" class="primary small" onclick="merchantFocusLiveOrder(\''+id+'\')">Ver pedido</button>':'';
    return '<div class="merchant-delivery-board-row"><div class="merchant-delivery-board-details">'+
      '<strong>'+esc(order.publicCode||'Pedido')+'</strong>'+
      '<span>'+esc(status)+(signal?.level==='late'?' • Revisar prazo':'')+'</span>'+
      '<small>'+esc(deadline)+'</small></div>'+
      '<div class="merchant-delivery-board-actions">'+open+merchantDeliveryShortcuts(order)+'</div></div>';
  }).join('');
  return '<section class="merchant-delivery-board" aria-label="Entregas em andamento agora">'+
    '<div class="merchant-delivery-board-heading"><div><span class="section-kicker">ENTREGAS AGORA</span>'+
    '<h2>'+active.length+' entregas em andamento</h2>'+
    '<p>'+arriving+' aguardando conferência • As confirmações continuam dentro de cada pedido.</p></div>'+
    '<button type="button" class="secondary small" onclick="merchantFocusOrderGroup(\'delivery\')">Ver fila completa</button></div>'+
    '<div class="merchant-delivery-board-list">'+rows+'</div>'+
    (active.length>visible.length?'<small>Mais '+(active.length-visible.length)+' entrega(s) disponíveis na fila completa.</small>':'')+
    '</section>';
}
function merchantOrderAttentionSummary(orders){
  const now=Date.now();
  const attention=(Array.isArray(orders)?orders:[])
    .map(order=>({order,signal:merchantOrderAttention(order,now)}))
    .filter(item=>item.signal)
    .sort((a,b)=>{
      const levels={risk:0,late:1,soon:2};
      const severity=(levels[a.signal.level]??3)-(levels[b.signal.level]??3);
      if(severity)return severity;
      const due=item=>{
        const preparing=['PREPARING','AT_RISK'].includes(String(item.order?.status||''));
        return merchantOrderScheduleDate(preparing?item.order?.dispatchDueAt:item.order?.promisedBy)?.getTime()??Number.MAX_SAFE_INTEGER;
      };
      return due(a)-due(b);
    });
  if(!attention.length)return '';
  const counts={risk:0,late:0,soon:0};
  for(const item of attention)counts[item.signal.level]=(counts[item.signal.level]||0)+1;
  const breakdown=[
    counts.risk?counts.risk+' imprevisto(s)':'',
    counts.late?counts.late+' prazo(s) para revisar':'',
    counts.soon?counts.soon+' prazo(s) próximo(s)':''
  ].filter(Boolean).join(' • ');
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
      '<p>'+esc(breakdown)+'</p>'+
      '<small>Referências de prazo e imprevistos do sistema. Confira a situação antes de agir.</small></div>'+
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

// V1.272 — shortcuts only navigate within the already server-scoped, rendered queue.
function merchantFocusOrderGroup(group){
  const key=String(group||'');
  if(!['offers','risk','delivery','preparing','other'].includes(key))return false;
  const element=document.getElementById('merchant-order-group-'+key);
  if(!element)return false;
  element.scrollIntoView?.({behavior:'smooth',block:'start'});
  element.focus?.({preventScroll:true});
  return true;
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
    '<button type="button" class="merchant-order-queue-stat" onclick="merchantFocusOrderGroup(\''+group.key+'\')" '+
    (group.orders.length?'':'disabled title="Sem pedidos nesta etapa"')+
    ' aria-label="'+group.orders.length+' pedido(s): '+esc(titles[group.key])+'. Ir para esta etapa">'+
    '<strong>'+group.orders.length+'</strong><span>'+esc(titles[group.key])+'</span></button>').join('');
  const sections=queues.filter(group=>group.orders.length).map(group=>{
    const byDue=order=>{
      const field=['MERCHANT_ACCEPTED','PREPARING','AT_RISK'].includes(String(order?.status||''))?'dispatchDueAt':'promisedBy';
      return merchantOrderScheduleDate(order?.[field])?.getTime()??Number.MAX_SAFE_INTEGER;
    };
    const sortSeverity=order=>{
      if(order?.status==='ARRIVING')return -1;
      if(order?.status==='MERCHANT_ACCEPTED')return 4;
      const level=merchantOrderAttention(order)?.level;
      return level==='risk'?0:level==='late'?1:level==='soon'?2:3;
    };
    const sorted=[...group.orders].sort((a,b)=>{
      if(group.key==='offers'){
        const at=Date.parse(String(a.offerExpiresAt||'')),bt=Date.parse(String(b.offerExpiresAt||''));
        return (Number.isFinite(at)?at:Number.MAX_SAFE_INTEGER)-(Number.isFinite(bt)?bt:Number.MAX_SAFE_INTEGER);
      }
      if(group.key==='delivery'||group.key==='preparing')
        return sortSeverity(a)-sortSeverity(b)||byDue(a)-byDue(b);
      return 0;
    });
    // Never tuck away offers, incidents, pending-arrival confirmation or
    // imminent/overdue deadlines. Only routine overflow is collapsed.
    const compact=['delivery','preparing'].includes(group.key)&&sorted.length>5;
    const isVisible=(order,i)=>i<3||order.status==='ARRIVING'||Boolean(merchantOrderAttention(order));
    const visible=compact?sorted.filter(isVisible):sorted;
    const hidden=compact?sorted.filter((order,i)=>!isVisible(order,i)):[];
    const overflow=hidden.length?
      '<details class="merchant-order-queue-overflow"><summary>Ver mais '+hidden.length+
      ' pedido(s) nesta etapa</summary><div class="merchant-order-queue-overflow-body">'+
      hidden.map(merchantLiveOrder).join('')+'</div></details>':'';
    return '<section tabindex="-1" id="merchant-order-group-'+group.key+'" class="merchant-order-queue-group merchant-order-group-'+group.key+'">'+
      '<div class="merchant-order-queue-heading"><div><h3>'+esc(group.title)+'</h3><p>'+esc(group.hint)+'</p></div>'+
      '<span class="merchant-order-queue-count">'+sorted.length+'</span></div>'+
      visible.map(merchantLiveOrder).join('')+overflow+'</section>';
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

// A route or phone link requires details explicitly released by the server after acceptance.
// The external map opens only after a merchant/driver taps the link.
function merchantDeliveryShortcuts(o){
  if(!o?.addressVisible||!o?.deliveryDetailsVisible||
     !['OUT_FOR_DELIVERY','ARRIVING'].includes(String(o.status||'')))return '';
  const address=String(o.address||'').trim();
  const phone=String(o.customerPhone||'').replace(/\D/g,'');
  const safeAddress=address.length>=8&&address.length<=300&&
    !/[<>\x00-\x1f]/.test(address);
  const safePhone=(phone.length===10||phone.length===11)&&
    /^[1-9][0-9]{9,10}$/.test(phone);
  const suffix=String(o.postalCode||'').replace(/\D/g,'');
  const addressQuery=address+(suffix.length===8?', CEP '+suffix:'');
  const route=safeAddress?'<a class="secondary small merchant-delivery-shortcut" target="_blank" rel="noopener noreferrer" '+
    'href="https://www.google.com/maps/dir/?api=1&amp;destination='+encodeURIComponent(addressQuery)+'" '+
    'aria-label="Traçar rota para o endereço do pedido no Google Maps">Abrir rota ↗</a>':'';
  const call=safePhone?'<a class="secondary small merchant-delivery-shortcut" '+
    'href="tel:+55'+phone+'" aria-label="Ligar para o cliente deste pedido">Ligar para cliente</a>':'';
  return route||call?'<div class="merchant-delivery-shortcuts" aria-label="Atalhos da entrega">'+
    route+call+'</div>':'';
}
// V1.275: local form readiness only; the server still validates PIN, payment and order version.
function merchantDeliveryConfirmationState(id){
  const key=String(id||'');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key))
    return {pin:'',paid:false,pinReady:false,ready:false};
  const pin=String(document.getElementById('live-pin-'+key)?.value||'').trim();
  const paid=document.getElementById('live-paid-'+key)?.checked===true;
  const pinReady=/^[0-9]{4}$/.test(pin);
  return {pin,paid,pinReady,ready:pinReady&&paid};
}
function merchantDeliveryConfirmationChanged(id){
  const key=String(id||'');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key))return false;
  const pinEl=document.getElementById('live-pin-'+key);
  if(pinEl){
    const cleaned=String(pinEl.value||'').replace(/[^0-9]/g,'').slice(0,4);
    if(pinEl.value!==cleaned)pinEl.value=cleaned;
  }
  const current=merchantDeliveryConfirmationState(key);
  const button=document.getElementById('live-deliver-submit-'+key);
  if(button)button.disabled=!current.ready||globalThis.merchantRuntime?.actionPending===true;
  const guide=document.getElementById('live-delivery-guide-'+key);
  if(guide)guide.textContent=!current.paid&&!current.pinReady
    ?'Confirme o recebimento e digite o PIN de 4 dígitos informado pelo cliente.'
    :!current.paid?'Marque pagamento recebido somente se o valor tiver sido recebido.'
    :!current.pinReady?'Digite os 4 números do PIN informado pelo cliente.'
    :'Dados preenchidos. Confira o pedido e toque em Confirmar entrega.';
  return current.ready;
}
function merchantLiveOrder(o){
  const items=(o.items||[]).map(i=>`${Number(i.quantity)}× ${esc(i.productName||i.productCode||'Item')}`).join(' • ');
  const total=BRL.format(Number(o.totalCents||0)/100);
  const copy=statusCopy[o.status]||[o.status,''];
  const address=o.addressVisible&&o.address?'📍 '+esc(o.address):'📍 Endereço protegido até o aceite';
  const currentRole=String(globalThis.merchantRuntime?.merchant?.memberRole||'');
  const canAssignDelivery=['owner','manager'].includes(currentRole);
  const deliveryTeam=merchantDeliveryCandidates(globalThis.merchantRuntime||{});
  // V1.284: compact, factual status and deadline for the first glance on mobile.
  // Only dates already received for this authorized order are shown; no local promises.
  const compactStatus={
    OFFERED_TO_MERCHANT:'Aguardando resposta',
    MERCHANT_ACCEPTED:'Pedido aceito',
    PREPARING:'Em preparação',
    AT_RISK:'Precisa de atenção',
    OUT_FOR_DELIVERY:'Em entrega',
    ARRIVING:'Chegada informada'
  }[String(o.status||'')]||'Confira o pedido';
  const deadlineKind=String(o.status||'')==='OFFERED_TO_MERCHANT'?'offer':
    ['PREPARING','AT_RISK'].includes(String(o.status||''))?'dispatch':
    ['OUT_FOR_DELIVERY','ARRIVING'].includes(String(o.status||''))?'delivery':null;
  const deadlineRaw=deadlineKind==='offer'?o.offerExpiresAt:
    deadlineKind==='dispatch'?o.dispatchDueAt:
    deadlineKind==='delivery'?o.promisedBy:null;
  const validRaw=typeof deadlineRaw==='string'&&
    /^20\d\d-\d\d-\d\dT\d\d:\d\d/.test(deadlineRaw);
  const deadlineMs=validRaw?Date.parse(deadlineRaw):NaN;
  const showDate=Number.isFinite(deadlineMs)&&deadlineMs>=Date.UTC(2020,0,1)&&
    deadlineMs<=Date.now()+180*86400000;
  const deadlineLabel=deadlineKind==='offer'?'Limite da oferta':
    deadlineKind==='dispatch'?'Prazo de saída':'Previsão de entrega';
  const deadlineText=showDate?new Date(deadlineMs).toLocaleString('pt-BR',{
    day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'
  }):'';
  const deadlinePassed=showDate&&deadlineMs<Date.now();
  const compactMeta='<div class="merchant-order-compact-meta" aria-label="Situação e referência de prazo do pedido">'+
    '<strong class="merchant-order-compact-status">'+esc(compactStatus)+'</strong>'+
    (deadlineText?'<span class="merchant-order-compact-deadline'+
      (deadlinePassed?' merchant-order-deadline-passed':'')+'">'+esc(deadlineLabel)+
      ': <strong>'+esc(deadlineText)+'</strong>'+
      (deadlinePassed?' • horário já passou':'')+'</span>':'')+
    '</div>';

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
    const expiration=o.offerExpiresAt?Date.parse(String(o.offerExpiresAt)):NaN;
    const hasExpiration=typeof o.offerExpiresAt==='string'&&
      /^20\d\d-\d\d-\d\dT/.test(o.offerExpiresAt)&&Number.isFinite(expiration);
    const expired=hasExpiration&&expiration<=Date.now()+1000;
    const secs=hasExpiration?Math.max(0,Math.ceil((expiration-Date.now())/1000)):null;
    actions=!hasExpiration
      ? '<strong class="merchant-offer-expired">Prazo sem confirmação</strong><p class="tiny muted">Atualize para obter uma janela de resposta válida antes de aceitar.</p><button type="button" class="secondary small" onclick="merchantLiveRefresh()">Atualizar pedidos</button>'
      :expired
        ? '<strong class="merchant-offer-expired">Prazo desta oferta encerrado</strong><button type="button" class="secondary small" onclick="merchantLiveRefresh()">Atualizar pedidos</button>'
        : `<button class="primary small" onclick="merchantLiveAction('${o.orderId}','accept')">Aceitar pedido</button><button class="danger-btn small" onclick="merchantLiveAction('${o.orderId}','reject')">Não consigo atender</button><span class="tiny muted">Prazo ~${secs}s</span>`;
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
    actions=`<div class="merchant-delivery-completion" aria-label="Conferir e concluir entrega">
      <strong class="merchant-delivery-completion-title">Conferir entrega</strong>
      <label class="check-row merchant-delivery-payment"><input id="live-paid-${o.orderId}" type="checkbox" onchange="merchantDeliveryConfirmationChanged('${o.orderId}')"><span><strong>Pagamento recebido</strong><small>Marque apenas depois de conferir que recebeu o pagamento.</small></span></label>
      <div class="input-wrap merchant-delivery-pin"><label for="live-pin-${o.orderId}">PIN informado pelo cliente</label>
        <input id="live-pin-${o.orderId}" type="text" inputmode="numeric" autocomplete="off" pattern="[0-9]{4}" maxlength="4" class="input pin-input" placeholder="4 dígitos" aria-describedby="live-delivery-guide-${o.orderId}" oninput="merchantDeliveryConfirmationChanged('${o.orderId}')">
        <small>O código será verificado pelo sistema ao confirmar.</small></div>
      <div id="live-delivery-guide-${o.orderId}" class="merchant-delivery-confirmation-guide" aria-live="polite">Confirme o recebimento e digite o PIN de 4 dígitos informado pelo cliente.</div>
      <button type="button" id="live-deliver-submit-${o.orderId}" class="primary merchant-delivery-submit" disabled onclick="merchantLiveDeliver('${o.orderId}')">Confirmar entrega</button>
    </div>`;
  }

  return `<article tabindex="-1" class="order-card ${o.status==='OFFERED_TO_MERCHANT'?'new':''}" id="merchant-order-card-${esc(o.orderId)}">
    <div class="order-head"><div><div class="order-id">${esc(o.publicCode||o.orderId)}</div><div class="order-line">${items||'Itens do pedido'}</div></div><div class="merchant-order-total"><strong>${total}</strong><div class="tiny muted">${esc(copy[0])}</div></div></div>
    ${compactMeta}
    ${merchantOrderAttentionCard(o)}
    ${merchantIncidentRiskGuide(o)}
    ${merchantOrderProgressView(o)}
    <div class="order-line">${address}</div><div class="order-line">Pagamento: ${esc(paymentLabel(o.paymentMethod))}</div>${o.paymentMethod==='cash'&&o.cashTenderCents?`<div class="order-line"><strong>Troco para: ${BRL.format(Number(o.cashTenderCents)/100)}</strong></div>`:''}${o.deliveryWindowStart?`<div class="notice success" style="margin-top:10px"><strong>Entrega agendada</strong><br>${esc(formatDeliveryWindow(o.deliveryWindowStart,o.deliveryWindowEnd))}</div>`:''}
    ${deliveryContact?`<details class="merchant-order-contact" ${['OUT_FOR_DELIVERY','ARRIVING'].includes(o.status)?'open':''}><summary>Endereço e contato para entrega</summary>${deliveryContact}</details>`:''}
    ${merchantDeliveryShortcuts(o)}
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
async function merchantPushDiagnoseFromUi(){
  try{
    await globalThis.merchantPushDiagnoseServerLive();
  }catch(e){toast(String(e?.message||e))}
}
async function merchantPushEnableFromUi(){
  try{
    await globalThis.merchantPushEnableLive();
    toast(globalThis.merchantPushStatus?.().testMode
      ?'Aparelho cadastrado para teste. O envio remoto ainda não está ativo.'
      :'Push cadastrado neste aparelho.');
  }
  catch(e){toast(String(e?.message||e))}
}
async function merchantPushTestFromUi(){
  try{
    const accepted=await globalThis.merchantPushSelfTestLive();
    if(accepted)toast('Provedor aceitou o teste. Confira o aviso neste aparelho.');
    else toast('Teste sem confirmação do provedor. Confira o painel.');
  }catch(e){toast(globalThis.merchantPushFriendlyError(e))}
}
async function merchantPushLastFromUi(){
  try{
    const found=await globalThis.merchantPushLatestTestLive();
    if(!found)toast('Nenhum teste recente encontrado para este aparelho.');
  }catch(e){toast(globalThis.merchantPushFriendlyError(e))}
}
async function merchantPushReportFromUi(report){
  try{
    const stored=await globalThis.merchantPushReportTestLive(report);
    if(stored)toast(report==='spam_warning'?'Aviso do Chrome registrado. Confira a opção Marcar como seguro.':report==='seen'?'Recebimento informado e registrado.':'Ausência do aviso informada e registrada.');
  }catch(e){toast(String(e?.message||e))}
}
async function merchantPushCorrectChromeWarningFromUi(){
  try{
    const recorded=await globalThis.merchantPushCorrectChromeWarningLive();
    if(recorded)toast('Correção registrada: a notificação apareceu com aviso do Chrome.');
  }catch(e){toast(globalThis.merchantPushFriendlyError(e))}
}
async function merchantPushDisableFromUi(){
  try{await globalThis.merchantPushDisableLive();toast('Push desativado neste aparelho.');}
  catch(e){toast(String(e?.message||e))}
}
async function merchantDisableAlertsFromUi(){
  let error=null;
  try{
    if(globalThis.merchantPushStatus?.().subscribed)await globalThis.merchantPushDisableLive();
  }catch(e){error=e}
  try{merchantDisableAlertsLive()}catch(e){error=e}
  toast(error?String(error?.message||error):'Alertas desativados neste aparelho');
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
  try{
    await merchantRefresh();
    if(globalThis.merchantRuntime?.status==='ready')toast('Operação atualizada');
    else if(globalThis.merchantRuntime?.status==='no-access')toast('Confira seu acesso à revenda.');
    else if(globalThis.merchantRuntime?.status==='unauthenticated')toast('Entre novamente para acessar a revenda.');
  }catch(e){toast(String(e?.message||e))}
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
    merchantPostActionConfirmation('Responsável pela entrega confirmado');
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
  if(String(id||'')!==String(globalThis.merchantRuntime?.merchant?.merchantId||'')){
    if(!merchantQuickConfirmLeave())return;
    merchantQuickDrafts.clear();
  }
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

// V1.357 — a server acknowledgement and a refreshed order list are separate facts.
// If the post-mutation read fails, do not imply that the screen shows a verified new state.
function merchantPostActionConfirmation(confirmedText){
  const status=String(globalThis.merchantRuntime?.status||'');
  if(['unavailable','no-access','unauthenticated'].includes(status)){
    toast('O servidor respondeu à ação, mas não conseguimos reconferir a fila. Atualize os pedidos antes de continuar.');
    return false;
  }
  toast(confirmedText);
  return true;
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
    merchantPostActionConfirmation(action==='accept'?'Pedido aceito':action==='reject'?'Pedido devolvido ao matching':action==='dispatch'?'Saída confirmada':'Chegada confirmada');
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
    merchantPostActionConfirmation('Impossibilidade registrada. Confira o estado atualizado do pedido.');
  }catch(e){toast(String(e?.message||e))}
}
async function merchantLiveDeliver(id){
  if(globalThis.merchantRuntime?.actionPending===true)return;
  const state=merchantDeliveryConfirmationState(id);
  if(!state.paid){
    document.getElementById('live-paid-'+id)?.focus?.();
    return toast('Confirme o recebimento do pagamento antes de concluir.');
  }
  if(!state.pinReady){
    document.getElementById('live-pin-'+id)?.focus?.();
    return toast('Informe os 4 dígitos do PIN do cliente.');
  }
  try{await merchantCompleteDeliveryLive(id,state.pin,true);merchantPostActionConfirmation('Entrega e pagamento confirmados')}catch(e){toast(String(e?.message||e))}
}
async function merchantLiveLogout(){
  if(!merchantQuickConfirmLeave())return;
  merchantQuickDrafts.clear();
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


// TAMÃO V1.310 — owner response to an internally displayed, nonbinding offer.
function merchantAdsOfferSection(merchant){
  if(!['owner','manager'].includes(String(merchant?.memberRole||'')))return '';
  const rt=globalThis.merchantRuntime||{},merchantId=String(merchant?.merchantId||'');
  const confirmed=rt.adsOffer?.merchantId===merchantId&&rt.adsOffer?.source==='merchant_ads_offer_v1_310'&&
    rt.adsOffer.noCharge===true&&rt.adsOffer.adsLive===false&&
    rt.adsOffer.contractSigned===false&&rt.adsOffer.paymentCreated===false&&
    rt.adsOffer.readOnly===true&&rt.adsOffer.nonBinding===true;
  const offer=confirmed?rt.adsOffer.offer:null;
  const status=offer?.expired&&offer?.status==='shared'?'Prazo encerrado':
    ({shared:'Condições disponíveis',interested:'Interesse confirmado pelo titular',
      declined:'Sem interesse',withdrawn:'Oferta retirada'}[offer?.status]||'Sem proposta disponível');
  const owner=merchant.memberRole==='owner';
  const reply=owner&&offer?.status==='shared'&&!offer.expired?
    '<div class="form-stack"><label class="check-row"><input type="checkbox" id="ads-offer-consent">'+
    '<span>Li estas condições e desejo registrar minha resposta. Reconheço que esta manifestação não é contratação, pagamento ou publicação de anúncio.</span></label>'+
    '<div class="order-actions"><button class="primary small" type="button" onclick="merchantAdsOfferRespond(\'interested\')">Tenho interesse nestas condições</button>'+
    '<button class="secondary small" type="button" onclick="merchantAdsOfferRespond(\'declined\')">Não tenho interesse</button></div></div>':'';
  const details=offer?'<div class="card flat"><div class="status-bar"><strong>'+esc(status)+'</strong>'+
      '<span class="status-pill">Versão '+Number(offer.version)+'</span></div>'+
      '<p>Valor proposto: <strong>'+(Number(offer.priceCents)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+
      '</strong> • Duração prevista: <strong>'+Number(offer.durationDays)+' dias</strong></p>'+
      '<p class="tiny muted">Disponibilizada em '+esc(typeof formatDateTime==='function'?formatDateTime(offer.sharedAt):offer.sharedAt||'—')+
      ' • válida até '+esc(typeof formatDateTime==='function'?formatDateTime(offer.expiresAt):offer.expiresAt||'—')+'</p>'+
      reply+'</div>':
      '<p class="muted tiny">Nenhuma condição comercial foi disponibilizada para esta revenda ou a consulta ainda não foi realizada.</p>';
  return '<section class="section merchant-ads-offer" id="merchant-ads-offer">'+
   '<div class="section-head"><div><span class="section-kicker">TAMÃO ADS • PROPOSTA COMERCIAL</span>'+
   '<h3>Condições para divulgação</h3>'+
   '<p>Consulte uma oferta enviada ao seu painel pelo TAMÃO. A resposta registra somente interesse comercial, sem cobrança ou contrato.</p></div>'+
   '<button class="secondary small" type="button" onclick="merchantAdsOfferLoad()" '+
     (rt.adsOfferBusy?'disabled':'')+'>Consultar condições</button></div>'+
   (confirmed?details:'<p class="muted tiny">Use “Consultar condições” para conferir o estado atualizado no servidor.</p>')+
   (rt.adsOfferError?'<p class="notice danger">'+esc(rt.adsOfferError)+'</p>':'')+
   '<p class="tiny muted">O TAMÃO não publica anúncios nem inicia cobranças ao registrar esta resposta. Qualquer contratação futura exige processo próprio e confirmação adicional.</p></section>';
}
async function merchantAdsOfferLoad(){
 const rt=globalThis.merchantRuntime,merchantId=String(rt?.merchant?.merchantId||'');
 if(!rt||rt.adsOfferBusy||!merchantId||!['owner','manager'].includes(String(rt.merchant.memberRole||'')))return null;
 rt.adsOfferBusy=true;rt.adsOfferError=null;render();
 try{
  const out=await merchantInvoke('merchant-ops',{action:'ads-offer',merchantId,operation:'view'});
  if(out?.source!=='merchant_ads_offer_v1_310'||out.merchantId!==merchantId||
    out.readOnly!==true||out.nonBinding!==true||out.noCharge!==true||
    out.adsLive!==false||out.contractSigned!==false||out.paymentCreated!==false||
    (out.offer!==null&&(!['shared','interested','declined','withdrawn'].includes(out.offer?.status)||
      !Number.isSafeInteger(out.offer?.version)||out.offer.version<1||
      !Number.isSafeInteger(out.offer?.priceCents)||out.offer.priceCents<1000||
      !Number.isSafeInteger(out.offer?.durationDays)||out.offer.durationDays<7)))
   throw new Error('As condições não foram confirmadas pelo servidor.');
  if(String(rt.merchant?.merchantId)!==merchantId)return null;
  rt.adsOffer=out;return out;
 }catch(e){
  if(String(rt.merchant?.merchantId)===merchantId){
    rt.adsOffer=null;rt.adsOfferError=String(e?.message||e);toast(rt.adsOfferError);
  }
  return null;
 }finally{rt.adsOfferBusy=false;render();}
}
async function merchantAdsOfferRespond(operation){
 const rt=globalThis.merchantRuntime,merchantId=String(rt?.merchant?.merchantId||'');
 if(!rt||!merchantId||rt.merchant.memberRole!=='owner'||rt.adsOfferBusy||
   !['interested','declined'].includes(operation))return false;
 const offer=rt.adsOffer?.merchantId===merchantId&&rt.adsOffer?.readOnly===true?rt.adsOffer.offer:null;
 if(!offer||offer.status!=='shared'||offer.expired||!Number.isSafeInteger(offer.version))return false;
 if(document.getElementById('ads-offer-consent')?.checked!==true){
   toast('Confirme que leu a proposta e que deseja responder.');return false;
 }
 if(!confirm('Registrar sua manifestação de '+(operation==='interested'?'interesse':'não interesse')+
   '? Isto não é contrato, compra, pagamento ou autorização de publicação.'))return false;
 rt.adsOfferBusy=true;render();
 try{
  const result=await merchantInvoke('merchant-ops',{
    action:'ads-offer',merchantId,operation,expectedVersion:offer.version,
    consent:true,requestId:crypto.randomUUID()
  });
  if(result?.source!=='merchant_ads_offer_v1_310'||result.merchantId!==merchantId||
    result.recorded!==true||result.status!==operation||result.version!==offer.version+1||
    result.noCharge!==true||result.adsLive!==false||result.contractSigned!==false||
    result.paymentCreated!==false)
    throw new Error('Manifestação não confirmada pelo servidor.');
  rt.adsOffer=null;
  // Release busy gate to allow a fresh authenticated read.
  rt.adsOfferBusy=false;
  const current=await merchantAdsOfferLoad();
  if(current?.offer?.status!==operation||current.offer.version!==result.version)
    throw new Error('Resposta registrada, mas leitura final pendente. Consulte as condições.');
  toast('Manifestação registrada. Nenhuma cobrança ou contrato foi criado.');
  return true;
 }catch(e){rt.adsOffer=null;rt.adsOfferError=String(e?.message||e);toast(rt.adsOfferError);return false}
 finally{rt.adsOfferBusy=false;render();}
}


// TAMÃO V1.311 — view and acknowledge contract-review terms, never sign or pay.
function merchantAdsDossierSection(merchant){
 if(!['owner','manager'].includes(String(merchant?.memberRole||'')))return '';
 const rt=globalThis.merchantRuntime||{},id=String(merchant?.merchantId||'');
 const packet=rt.adsDossier?.merchantId===id&&rt.adsDossier?.source==='merchant_ads_dossier_v1_311'&&
  rt.adsDossier.noCharge===true&&rt.adsDossier.adsLive===false&&
  rt.adsDossier.contractSigned===false&&rt.adsDossier.paymentRequestCreated===false&&
  rt.adsDossier.readOnly===true&&rt.adsDossier.reviewOnly===true?rt.adsDossier:null;
 const d=packet?.dossier||null;
 const status={shared_for_review:'Minuta para revisão',reviewed:'Leitura confirmada — sem assinatura',
  changes_requested:'Alterações solicitadas'}[d?.status]||'Ainda não disponibilizada';
 const owner=merchant.memberRole==='owner';
 const consent=d?.status==='shared_for_review'&&owner?
  '<div class="form-stack"><label class="check-row"><input id="ads-dossier-reviewed-consent" type="checkbox">'+
  '<span>Li esta minuta e quero registrar minha avaliação. Esta confirmação NÃO constitui assinatura, contratação ou autorização de cobrança.</span></label>'+
  '<div class="order-actions"><button class="primary small" type="button" onclick="merchantAdsDossierRespond(\'reviewed\')">Confirmar que revisei</button>'+
  '<button class="secondary small" type="button" onclick="merchantAdsDossierRespond(\'request_changes\')">Solicitar alterações</button></div></div>':'';
 const content=d?'<div class="card flat"><div class="status-bar"><strong>'+esc(status)+
  '</strong><span class="status-pill">Minuta v'+Number(d.version)+'</span></div>'+
  '<p>Valor negociado: <strong>'+(d.priceCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+
  '</strong> • Duração: '+Number(d.durationDays)+' dias</p>'+
  '<strong>O que está previsto</strong><p>'+esc(d.serviceScope)+'</p>'+
  '<strong>Cancelamento e alterações</strong><p>'+esc(d.cancellationTerms)+'</p>'+
  '<p>Vencimento sugerido após eventual contratação e cobrança: '+Number(d.dueDays)+' dias.</p>'+
  consent+'</div>':
  '<p class="muted tiny">Nenhuma minuta contratual disponível nesta consulta.</p>';
 return '<section class="section merchant-ads-dossier">'+
  '<div class="section-head"><div><span class="section-kicker">TAMÃO ADS • CONDIÇÕES COMERCIAIS</span>'+
  '<h3>Revisão das condições</h3><p>Confira o escopo e as regras propostas antes de qualquer formalização contratual.</p></div>'+
  '<button class="secondary small" type="button" onclick="merchantAdsDossierLoad()">Consultar minuta</button></div>'+
  (packet?content:'<p class="muted tiny">Consulte o servidor para verificar se há condições disponíveis.</p>')+
  (rt.adsDossierError?'<p class="notice danger">'+esc(rt.adsDossierError)+'</p>':'')+
  '<p class="tiny muted">Revisar esta minuta não assina contrato, não emite fatura, não efetua pagamento e não inicia publicidade.</p></section>';
}
async function merchantAdsDossierLoad(){
 const rt=globalThis.merchantRuntime,id=String(rt?.merchant?.merchantId||'');
 if(!rt||!id||rt.adsDossierBusy||!['owner','manager'].includes(String(rt.merchant.memberRole||'')))return null;
 rt.adsDossierBusy=true;rt.adsDossierError=null;render();
 try{
  const out=await merchantInvoke('merchant-ops',{action:'ads-dossier',merchantId:id,operation:'view'});
  if(out?.source!=='merchant_ads_dossier_v1_311'||out.merchantId!==id||
    out.readOnly!==true||out.reviewOnly!==true||out.noCharge!==true||
    out.adsLive!==false||out.contractSigned!==false||out.paymentRequestCreated!==false||
    (out.dossier!==null&&(!Number.isSafeInteger(out.dossier?.version)||
      out.dossier.version<1||!Number.isSafeInteger(out.dossier?.priceCents)||
      !Number.isSafeInteger(out.dossier?.dueDays)||
      !['shared_for_review','reviewed','changes_requested'].includes(out.dossier?.status))))
    throw new Error('Minuta não confirmada no servidor.');
  if(String(rt.merchant?.merchantId)!==id)return null;
  rt.adsDossier=out;return out;
 }catch(e){
  if(String(rt.merchant?.merchantId)===id){
   rt.adsDossier=null;rt.adsDossierError=String(e?.message||e);toast(rt.adsDossierError);
  }
  return null;
 }finally{rt.adsDossierBusy=false;render();}
}
async function merchantAdsDossierRespond(operation){
 const rt=globalThis.merchantRuntime,id=String(rt?.merchant?.merchantId||'');
 if(!rt||!id||rt.merchant.memberRole!=='owner'||rt.adsDossierBusy||
   !['reviewed','request_changes'].includes(operation))return false;
 const d=rt.adsDossier?.merchantId===id&&rt.adsDossier?.reviewOnly===true?
   rt.adsDossier.dossier:null;
 if(!d||d.status!=='shared_for_review'||!Number.isSafeInteger(d.version))return false;
 if(document.getElementById('ads-dossier-reviewed-consent')?.checked!==true){
   toast('Marque a confirmação de leitura da minuta.');return false;
 }
 if(!confirm(operation==='reviewed'?'Registrar que você revisou as condições? Isto não assina nem contrata publicidade.':
  'Solicitar revisão destas condições, sem contratar ou pagar?'))return false;
 rt.adsDossierBusy=true;render();
 try{
  const result=await merchantInvoke('merchant-ops',{
   action:'ads-dossier',merchantId:id,operation,
   expectedVersion:d.version,confirmed:true,requestId:crypto.randomUUID()
  });
  const status=operation==='reviewed'?'reviewed':'changes_requested';
  if(result?.source!=='merchant_ads_dossier_v1_311'||result.merchantId!==id||
    result.status!==status||result.version!==d.version+1||
    result.recorded!==true||result.noCharge!==true||result.adsLive!==false||
    result.contractSigned!==false||result.paymentRequestCreated!==false)
     throw new Error('Avaliação do documento não confirmada.');
  rt.adsDossier=null;rt.adsDossierBusy=false;
  const verified=await merchantAdsDossierLoad();
  if(verified?.dossier?.status!==status||verified.dossier.version!==result.version)
   throw new Error('Resposta registrada, mas a leitura de confirmação ainda não foi concluída.');
  toast('Avaliação registrada. Nenhum contrato foi assinado.');
  return true;
 }catch(e){
  rt.adsDossier=null;rt.adsDossierError=String(e?.message||e);toast(rt.adsDossierError);return false;
 }finally{rt.adsDossierBusy=false;render();}
}


// TAMÃO V1.312 — authenticated, explicit acceptance of the frozen document hash.
// Not a qualified ICP-Brasil signature and not automatic Ads activation.
function merchantAdsInstrumentSection(merchant){
 if(!['owner','manager'].includes(String(merchant?.memberRole||'')))return '';
 const rt=globalThis.merchantRuntime||{},id=String(merchant?.merchantId||'');
 const packet=rt.adsInstrument?.merchantId===id&&rt.adsInstrument?.source==='merchant_ads_instrument_v1_312'&&
   rt.adsInstrument.noCharge===true&&rt.adsInstrument.adsLive===false&&
   rt.adsInstrument.paymentRequestCreated===false&&rt.adsInstrument.notIcpCertified===true&&
   rt.adsInstrument.readOnly===true?rt.adsInstrument:null;
 const i=packet?.instrument||null,d=i?.document||{};
 const stages={offered:'Disponível para aceite',merchant_accepted:'Aceite do titular registrado',
   bilateral_accepted:'Aceite bilateral registrado'};
 const fields=i?'<article class="card flat"><div class="status-bar"><strong>'+esc(stages[i.status]||'Em revisão')+
   '</strong><span class="status-pill">Documento v'+Number(i.version)+'</span></div>'+
   '<p><strong>Contratante:</strong> '+esc(d.merchantLegalName||'—')+' • CNPJ '+esc(d.merchantCnpj||'—')+'</p>'+
   '<p><strong>Prestadora:</strong> '+esc(d.platformLegalName||'—')+' • CNPJ '+esc(d.platformCnpj||'—')+'</p>'+
   '<p><strong>Valor:</strong> '+(Number(d.priceCents)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+
   ' • duração '+Number(d.durationDays)+' dias • vencimento proposto '+Number(d.dueDays)+' dias.</p>'+
   '<strong>Escopo</strong><p>'+esc(d.serviceScope||'')+'</p>'+
   '<strong>Cancelamento</strong><p>'+esc(d.cancellationTerms||'')+'</p>'+
   '<strong>Início e condições</strong><p>'+esc(d.executionCondition||'')+'</p>'+
   '<p class="tiny muted">Identificador SHA-256 do documento: <code>'+esc(i.sha256||'')+'</code></p>'+
   (merchant.memberRole==='owner'&&i.status==='offered'?
    '<label class="check-row"><input type="checkbox" id="ads-sign-consent">'+
    '<span>Li o documento completo, confirmo as condições e autorizo registrar meu aceite eletrônico autenticado. Entendo que não é certificado ICP-Brasil nem cobrança imediata.</span></label>'+
    '<label class="input-wrap">Digite ACEITO para confirmar<input type="text" id="ads-sign-phrase" maxlength="6" autocomplete="off" placeholder="ACEITO"></label>'+
    '<button type="button" class="primary small" onclick="merchantAdsInstrumentAccept()">Registrar meu aceite eletrônico</button>':'')+
   '</article>':'<p class="muted tiny">Ainda não existe instrumento disponível para consulta nesta revenda.</p>';
 return '<section class="section merchant-ads-instrument">'+
   '<div class="section-head"><div><span class="section-kicker">TAMÃO ADS • ACEITE AUTENTICADO</span>'+
   '<h3>Instrumento eletrônico de publicidade</h3>'+
   '<p>Confira as duas empresas, o preço, as condições e o identificador antes de registrar seu aceite.</p></div>'+
   '<button type="button" class="secondary small" onclick="merchantAdsInstrumentLoad()">Consultar documento</button></div>'+
   (packet?fields:'<p class="muted tiny">Clique em Consultar documento para verificar o registro no servidor.</p>')+
   (rt.adsInstrumentError?'<p class="notice danger">'+esc(rt.adsInstrumentError)+'</p>':'')+
   '<p class="tiny muted">Este método registra usuário autenticado, data e integridade documental. Não utiliza certificado ICP-Brasil e não habilita cobrança ou publicação automaticamente.</p></section>';
}
async function merchantAdsInstrumentLoad(){
 const rt=globalThis.merchantRuntime,id=String(rt?.merchant?.merchantId||'');
 if(!rt||!id||rt.adsInstrumentBusy||!['owner','manager'].includes(String(rt.merchant.memberRole||'')))return null;
 rt.adsInstrumentBusy=true;rt.adsInstrumentError=null;render();
 try{
  const out=await merchantInvoke('merchant-ops',{action:'ads-instrument',merchantId:id,operation:'view'});
  if(out?.source!=='merchant_ads_instrument_v1_312'||out.merchantId!==id||
    out.readOnly!==true||out.noCharge!==true||out.adsLive!==false||
    out.paymentRequestCreated!==false||out.notIcpCertified!==true||
    (out.instrument!==null&&(!/^[a-f0-9]{64}$/.test(String(out.instrument?.sha256||''))||
      out.instrument?.document?.schema!=='ads-electronic-instrument-v1.312'||
      !['offered','merchant_accepted','bilateral_accepted'].includes(out.instrument?.status))))
    throw new Error('Documento não confirmado pelo servidor.');
  if(String(rt.merchant?.merchantId)!==id)return null;
  rt.adsInstrument=out;return out;
 }catch(e){
  if(String(rt.merchant?.merchantId)===id){
    rt.adsInstrument=null;rt.adsInstrumentError=String(e?.message||e);toast(rt.adsInstrumentError);
  }
  return null;
 }finally{rt.adsInstrumentBusy=false;render();}
}
async function merchantAdsInstrumentAccept(){
 const rt=globalThis.merchantRuntime,id=String(rt?.merchant?.merchantId||'');
 if(!rt||!id||rt.merchant.memberRole!=='owner'||rt.adsInstrumentBusy)return false;
 const i=rt.adsInstrument?.merchantId===id&&rt.adsInstrument?.readOnly===true?
   rt.adsInstrument.instrument:null;
 if(!i||i.status!=='offered'||!Number.isSafeInteger(i.version)||
   !/^[a-f0-9]{64}$/.test(String(i.sha256||'')))return false;
 const check=document.getElementById('ads-sign-consent')?.checked===true;
 const phrase=String(document.getElementById('ads-sign-phrase')?.value||'').trim();
 if(!check||phrase!=='ACEITO'){
   toast('Marque a declaração de aceite e digite ACEITO.');return false;
 }
 if(!confirm('Confirma seu aceite eletrônico das condições e do documento identificado pelo SHA-256 exibido? Esta ação não cria cobrança nem publica anúncio.'))return false;
 rt.adsInstrumentBusy=true;render();
 try{
  const out=await merchantInvoke('merchant-ops',{
   action:'ads-instrument',merchantId:id,operation:'accept',expectedVersion:i.version,
   sha256:i.sha256,consent:true,requestId:crypto.randomUUID()
  });
  if(out?.source!=='merchant_ads_instrument_v1_312'||out.merchantId!==id||
     out.status!=='merchant_accepted'||out.sha256!==i.sha256||
     out.version!==i.version+1||out.recorded!==true||out.noCharge!==true||
     out.adsLive!==false||out.paymentRequestCreated!==false||out.notIcpCertified!==true)
   throw new Error('O aceite não foi confirmado.');
  rt.adsInstrument=null;rt.adsInstrumentBusy=false;
  const checkAgain=await merchantAdsInstrumentLoad();
  if(checkAgain?.instrument?.status!=='merchant_accepted'||
     checkAgain.instrument.sha256!==i.sha256||checkAgain.instrument.version!==out.version)
   throw new Error('Aceite registrado, mas a leitura posterior está pendente.');
  toast('Aceite eletrônico registrado no documento, sem cobrança.');
  return true;
 }catch(e){
  rt.adsInstrument=null;rt.adsInstrumentError=String(e?.message||e);toast(rt.adsInstrumentError);return false;
 }finally{rt.adsInstrumentBusy=false;render();}
}


// TAMÃO V1.313 — merchant billing statement; payment reports are ALWAYS unverified.
function merchantAdsReceivableSection(merchant){
 if(!['owner','manager'].includes(String(merchant?.memberRole||'')))return '';
 const rt=globalThis.merchantRuntime||{},id=String(merchant?.merchantId||'');
 const packet=rt.adsReceivable?.merchantId===id&&rt.adsReceivable?.source==='merchant_ads_receivable_v1_313'&&
  rt.adsReceivable.readOnly===true&&rt.adsReceivable.paymentVerified===false&&
  rt.adsReceivable.adsLive===false&&rt.adsReceivable.pspChargeCreated===false?rt.adsReceivable:null;
 const r=packet?.statement||null;
 const pay=r?'<div class="card flat"><p><strong>'+
  (r.amountCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+
  '</strong> • '+esc(r.status==='issued'?'Demonstrativo emitido':'Demonstrativo cancelado')+'</p>'+
  '<p>Vencimento: '+esc(String(r.dueDate||'—'))+' • BRL • versão '+Number(r.version)+'</p>'+
  '<p class="tiny muted">Contrato SHA-256: <code>'+esc(r.documentSha256)+'</code></p>'+
  '<p class="tiny muted">Referências informadas, não verificadas: '+Number(r.unverifiedReports||0)+'</p>'+
  (r.status==='issued'&&merchant.memberRole==='owner'?
    '<div class="form-stack"><label>Referência de um pagamento já realizado (opcional)<input id="ads-payment-reference" class="input" type="text" minlength="8" maxlength="120" placeholder="Ex.: identificador da transferência"></label>'+
    '<button type="button" class="secondary small" onclick="merchantAdsReceivableReport()">Informar referência para conferência</button></div>':'')+
  '</div>':'<p class="muted tiny">Ainda não há demonstrativo comercial emitido para esta revenda.</p>';
 return '<section class="section merchant-ads-receivable">'+
  '<div class="section-head"><div><span class="section-kicker">TAMÃO ADS • FINANCEIRO</span>'+
  '<h3>Cobrança de publicidade</h3>'+
  '<p>Consulte somente as condições emitidas pelo TAMÃO. Valores de Ads não são taxas ou créditos de pedidos.</p></div>'+
  '<button type="button" class="secondary small" onclick="merchantAdsReceivableLoad()">Consultar demonstrativo</button></div>'+
  (packet?pay:'<p class="muted tiny">Consulte o servidor para confirmar se há uma cobrança comercial.</p>')+
  (rt.adsReceivableError?'<p class="notice danger">'+esc(rt.adsReceivableError)+'</p>':'')+
  '<p class="tiny muted">Este demonstrativo não inclui um meio de pagamento automático. Não transfira valores sem confirmar instruções oficiais. Informar uma referência não comprova recebimento e não publica anúncios.</p></section>';
}
async function merchantAdsReceivableLoad(){
 const rt=globalThis.merchantRuntime,id=String(rt?.merchant?.merchantId||'');
 if(!rt||!id||rt.adsReceivableBusy||!['owner','manager'].includes(String(rt.merchant.memberRole||'')))return null;
 rt.adsReceivableBusy=true;rt.adsReceivableError=null;render();
 try{
  const data=await merchantInvoke('merchant-ops',{action:'ads-receivable',merchantId:id,operation:'view'});
  if(data?.source!=='merchant_ads_receivable_v1_313'||data.merchantId!==id||
   data.readOnly!==true||data.paymentVerified!==false||data.adsLive!==false||
   data.pspChargeCreated!==false||
   (data.statement!==null&&(!['issued','canceled'].includes(data.statement?.status)||
     !Number.isSafeInteger(data.statement.version)||data.statement.version<1||
     !Number.isSafeInteger(data.statement.amountCents)||data.statement.amountCents<1000||
     data.statement.currency!=='BRL')))
   throw new Error('Demonstrativo não confirmado no servidor.');
  if(String(rt.merchant?.merchantId)!==id)return null;
  rt.adsReceivable=data;return data;
 }catch(e){
  if(String(rt.merchant?.merchantId)===id){
   rt.adsReceivable=null;rt.adsReceivableError=String(e?.message||e);toast(rt.adsReceivableError);
  }
  return null;
 }finally{rt.adsReceivableBusy=false;render();}
}
async function merchantAdsReceivableReport(){
 const rt=globalThis.merchantRuntime,id=String(rt?.merchant?.merchantId||'');
 if(!rt||!id||rt.merchant.memberRole!=='owner'||rt.adsReceivableBusy)return false;
 const r=rt.adsReceivable?.merchantId===id&&rt.adsReceivable?.readOnly===true?
  rt.adsReceivable.statement:null;
 if(!r||r.status!=='issued'||!Number.isSafeInteger(r.version))return false;
 const reference=String(document.getElementById('ads-payment-reference')?.value||'').trim();
 if(!/^[A-Za-z0-9][A-Za-z0-9 _./:-]{7,119}$/.test(reference)){
  toast('Informe uma referência válida de 8 a 120 caracteres.');return false;
 }
 if(!confirm('Registrar essa referência para conferência? Ela NÃO é comprovante bancário nem confirmação de pagamento.'))return false;
 rt.adsReceivableBusy=true;render();
 try{
  const data=await merchantInvoke('merchant-ops',{
   action:'ads-receivable',merchantId:id,operation:'report',version:r.version,
   reference,requestId:crypto.randomUUID()
  });
  if(data?.source!=='merchant_ads_receivable_v1_313'||data.merchantId!==id||
    data.reported!==true||data.paymentVerified!==false||
    data.adsLive!==false||data.pspChargeCreated!==false)
   throw new Error('A referência não foi confirmada.');
  rt.adsReceivable=null;rt.adsReceivableBusy=false;
  const checked=await merchantAdsReceivableLoad();
  if(!checked?.statement||checked.statement.unverifiedReports<1)
    throw new Error('Referência enviada, mas leitura posterior pendente.');
  toast('Referência registrada como não verificada. Aguardando conferência.');
  return true;
 }catch(e){
  rt.adsReceivable=null;rt.adsReceivableError=String(e?.message||e);toast(rt.adsReceivableError);return false;
 }finally{rt.adsReceivableBusy=false;render();}
}


// V1.314 — merchant can open only the platform-verified Mercado Pago checkout URL.
function merchantAdsPspSection(merchant){
 if(!['owner','manager'].includes(String(merchant?.memberRole||'')))return '';
 const rt=globalThis.merchantRuntime||{},id=String(merchant?.merchantId||'');
 const packet=rt.adsPsp?.merchantId===id&&rt.adsPsp?.source==='merchant_ads_psp_view_v1_314'&&
  rt.adsPsp.readOnly===true&&rt.adsPsp.adsLive===false&&
  rt.adsPsp.merchantBillingSeparate===true?rt.adsPsp:null;
 const c=packet?.checkout||null;
 const messages={reserved:'Checkout em preparação e conferência',
   checkout_ready:'Pagamento disponível no Mercado Pago',
   payment_approved:'Pagamento aprovado na última verificação do provedor',
   payment_reversed:'Pagamento estornado ou contestado'};
 const allow=c?.status==='checkout_ready'&&
  /^https:\/\/(www\.)?mercadopago\.com(\.br)?\//.test(String(c.checkoutUrl||''));
 const label=c?'<div class="card flat"><strong>'+esc(messages[c.status]||'Checkout indisponível')+'</strong>'+
  '<p>Valor: <strong>'+(Number(c.amountCents)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+'</strong> • BRL</p>'+
  '<p class="tiny muted">Referência: '+esc(c.externalReference||'')+'</p>'+
  (allow?'<p><a class="primary btn" target="_blank" rel="noopener noreferrer" href="'+esc(c.checkoutUrl)+
    '">Pagar no Mercado Pago <span aria-hidden="true">↗</span></a></p>':'')+
  (c.verifiedAt?'<p class="tiny muted">Última confirmação no provedor: '+esc(String(c.verifiedAt))+'</p>':'')+
  '</div>':'<p class="muted tiny">Ainda não há checkout autorizado para esta revenda.</p>';
 return '<section class="section merchant-ads-psp"><div class="section-head"><div>'+
  '<span class="section-kicker">TAMÃO ADS • PAGAMENTO SEGURO</span>'+
  '<h3>Checkout oficial de publicidade</h3>'+
  '<p>O checkout é criado exclusivamente na conta da empresa responsável pelo TAMÃO, separado do pagamento de pedidos.</p></div>'+
  '<button type="button" class="secondary small" onclick="merchantAdsPspLoad()">Conferir checkout</button></div>'+
  (packet?label:'<p class="muted tiny">Clique em Conferir checkout para consultar o servidor.</p>')+
  (rt.adsPspError?'<p class="notice danger">'+esc(rt.adsPspError)+'</p>':'')+
  '<p class="tiny muted">Ao pagar, confirme o beneficiário dentro do Mercado Pago. O retorno ao TAMÃO não prova o recebimento; a confirmação deve vir do provedor. Nenhuma campanha é publicada automaticamente.</p></section>';
}
async function merchantAdsPspLoad(){
 const rt=globalThis.merchantRuntime,id=String(rt?.merchant?.merchantId||'');
 if(!rt||!id||rt.adsPspBusy||!['owner','manager'].includes(String(rt.merchant.memberRole||'')))return null;
 rt.adsPspBusy=true;rt.adsPspError=null;render();
 try{
  const data=await merchantInvoke('merchant-ops',{action:'ads-psp',merchantId:id,operation:'view'});
  if(data?.source!=='merchant_ads_psp_view_v1_314'||data.merchantId!==id||
     data.readOnly!==true||data.adsLive!==false||data.merchantBillingSeparate!==true||
     (data.checkout!==null&&(!['reserved','checkout_ready','payment_approved','payment_reversed'].includes(data.checkout?.status)||
       !Number.isSafeInteger(data.checkout?.amountCents)||data.checkout.amountCents<1000||
       (data.checkout.checkoutUrl!==null&&
        !/^https:\/\/(www\.)?mercadopago\.com(\.br)?\//.test(data.checkout.checkoutUrl)))))
    throw new Error('Checkout não confirmado no serviço.');
  if(String(rt.merchant?.merchantId)!==id)return null;
  rt.adsPsp=data;return data;
 }catch(e){
  if(String(rt.merchant?.merchantId)===id){rt.adsPsp=null;rt.adsPspError=String(e?.message||e);toast(rt.adsPspError);}
  return null;
 }finally{rt.adsPspBusy=false;render();}
}


// V1.319 — server-owned evidence age; signed webhook observations never count as current settlement.
function merchantAdsPspEvidenceSection(merchant){
 if(!['owner','manager'].includes(String(merchant?.memberRole||'')))return '';
 const rt=globalThis.merchantRuntime||{},id=String(merchant?.merchantId||'');
 const data=rt.adsPspEvidence?.source==='merchant_ads_psp_evidence_v1_319'&&
  rt.adsPspEvidence.merchantId===id&&rt.adsPspEvidence.readOnly===true&&
  rt.adsPspEvidence.snapshotOnly===true&&rt.adsPspEvidence.providerRechecked===false&&
  rt.adsPspEvidence.paymentStateChanged===false&&rt.adsPspEvidence.adsLive===false&&
  rt.adsPspEvidence.merchantBillingSeparate===true?rt.adsPspEvidence:null;
 const e=data?.evidence||null;
 const messages={
  no_checkout:'Nenhum checkout de publicidade emitido',
  reversal_recorded:'Pagamento estornado ou contestado',
  reversal_observed_review_required:'Alerta de possível estorno — requer conferência',
  approval_evidence_stale:'Confirmação desatualizada — peça nova consulta',
  approval_refresh_recommended:'Recomendamos nova conferência no provedor',
  approval_last_verified:'Pagamento aprovado na última consulta autenticada',
  checkout_preparation:'Checkout em preparação',
  approval_observed_unreconciled:'Aprovação observada, mas ainda não conciliada',
  awaiting_provider_confirmation:'Aguardando confirmação do Mercado Pago',
  unknown:'Situação indisponível'
 };
 const request=e?.canRequestReview===true&&merchant.memberRole==='owner';
 const evidence=e?'<div class="card flat"><strong>'+esc(messages[e.status]||messages.unknown)+'</strong>'+
  (e.lastProviderVerifiedAt?'<p class="tiny muted">Última consulta autenticada: '+esc(String(e.lastProviderVerifiedAt))+
   (e.hoursSinceVerified!==null?' • '+Number(e.hoursSinceVerified)+' hora(s) decorridas':'')+'</p>':'')+
  (e.lastObservedAt?'<p class="tiny muted">Último evento observado: '+esc(String(e.lastObservedAt))+
    '. Essa informação é histórica e não confirma o pagamento atual.</p>':'')+
  (e.possibleReversal?'<p class="notice danger">Pode ter ocorrido um estorno ou contestação depois da última consulta. É necessária uma nova verificação no Mercado Pago.</p>':'')+
  (e.reviewRequestedAt?'<p class="tiny muted">Última solicitação de conferência: '+esc(String(e.reviewRequestedAt))+'</p>':'')+
  (request?'<button type="button" class="primary small" onclick="merchantAdsPspEvidenceRequest()">Solicitar nova conferência ao TAMÃO</button>':'')+
  '</div>':'<p class="muted tiny">Consulte a situação no servidor para verificar a data da última conferência.</p>';
 return '<section class="section merchant-ads-psp-evidence"><div class="section-head"><div>'+
  '<span class="section-kicker">TAMÃO ADS • TRANSPARÊNCIA</span>'+
  '<h3>Comprovação e validade do pagamento</h3>'+
  '<p>Saiba o que o provedor confirmou, quando foi consultado e se é necessária uma nova conferência.</p></div>'+
  '<button type="button" class="secondary small" onclick="merchantAdsPspEvidenceLoad()">Atualizar comprovação</button></div>'+
  (data?evidence:'<p class="muted tiny">Clique em Atualizar comprovação para verificar a situação.</p>')+
  (rt.adsPspEvidenceError?'<p class="notice danger">'+esc(rt.adsPspEvidenceError)+'</p>':'')+
  '<p class="tiny muted">Uma confirmação antiga não garante que o dinheiro permaneça recebido. Solicitar conferência não altera pagamento, não cria cobrança nem publica anúncio.</p></section>';
}
async function merchantAdsPspEvidenceLoad(){
 const rt=globalThis.merchantRuntime,id=String(rt?.merchant?.merchantId||'');
 if(!rt||!id||rt.adsPspEvidenceBusy||!['owner','manager'].includes(String(rt.merchant.memberRole||'')))return null;
 rt.adsPspEvidenceBusy=true;rt.adsPspEvidenceError=null;render();
 const states=new Set(['no_checkout','reversal_recorded','reversal_observed_review_required',
  'approval_evidence_stale','approval_refresh_recommended','approval_last_verified',
  'checkout_preparation','approval_observed_unreconciled','awaiting_provider_confirmation','unknown']);
 try{
  const data=await merchantInvoke('merchant-ops',{action:'ads-psp-evidence',merchantId:id,operation:'view'});
  const e=data?.evidence;
  if(data?.source!=='merchant_ads_psp_evidence_v1_319'||data.merchantId!==id||
   data.readOnly!==true||data.snapshotOnly!==true||data.providerRechecked!==false||
   data.paymentStateChanged!==false||data.adsLive!==false||
   data.merchantBillingSeparate!==true||!states.has(e?.status)||
   (e?.checkoutVersion!==null&&(!Number.isSafeInteger(e?.checkoutVersion)||e.checkoutVersion<1))||
   (e?.hoursSinceVerified!==null&&(!Number.isSafeInteger(e?.hoursSinceVerified)||e.hoursSinceVerified<0))||
   typeof e?.possibleReversal!=='boolean'||typeof e?.canRequestReview!=='boolean')
   throw new Error('Evidência financeira não confirmada.');
  if(String(rt.merchant?.merchantId)!==id)return null;
  rt.adsPspEvidence=data;return data;
 }catch(e){
  if(String(rt.merchant?.merchantId)===id){
   rt.adsPspEvidence=null;rt.adsPspEvidenceError=String(e?.message||e);
   toast(rt.adsPspEvidenceError);
  }
  return null;
 }finally{rt.adsPspEvidenceBusy=false;render();}
}
async function merchantAdsPspEvidenceRequest(){
 const rt=globalThis.merchantRuntime,id=String(rt?.merchant?.merchantId||'');
 if(!rt||!id||rt.merchant.memberRole!=='owner'||rt.adsPspEvidenceBusy)return false;
 const evidence=rt.adsPspEvidence?.source==='merchant_ads_psp_evidence_v1_319'?
  rt.adsPspEvidence.evidence:null;
 if(!evidence||evidence.canRequestReview!==true||
  !Number.isSafeInteger(evidence.checkoutVersion)||evidence.checkoutVersion<1)return false;
 if(!confirm('Solicitar que o TAMÃO consulte novamente o pagamento no Mercado Pago? Isso não confirma pagamento, nem publica anúncios.'))return false;
 rt.adsPspEvidenceBusy=true;render();
 try{
  const result=await merchantInvoke('merchant-ops',{
   action:'ads-psp-evidence',merchantId:id,operation:'request_review',
   expectedVersion:evidence.checkoutVersion,requestId:crypto.randomUUID()
  });
  if(result?.source!=='merchant_ads_psp_evidence_v1_319'||result.merchantId!==id||
    result.requestRecorded!==true||result.paymentStateChanged!==false||
    result.providerRechecked!==false||result.adsLive!==false||
    result.merchantBillingSeparate!==true)
   throw new Error('A solicitação não foi confirmada.');
  rt.adsPspEvidence=null;rt.adsPspEvidenceBusy=false;
  const latest=await merchantAdsPspEvidenceLoad();
  if(!latest?.evidence?.reviewRequestedAt)
   throw new Error('Solicitação registrada, mas ainda sem confirmação de leitura.');
  toast('Solicitação recebida para conferência financeira. Nenhum estado de pagamento foi alterado.');
  return true;
 }catch(e){
  rt.adsPspEvidence=null;rt.adsPspEvidenceError=String(e?.message||e);
  toast(rt.adsPspEvidenceError);return false;
 }finally{rt.adsPspEvidenceBusy=false;render();}
}


// TAMÃO V1.321 — the next useful step, based ONLY on merchant-scoped SQL evidence.
function merchantAdsStartSection(merchant){
 if(!['owner','manager'].includes(String(merchant?.memberRole||'')))return '';
 const rt=globalThis.merchantRuntime||{},id=String(merchant?.merchantId||'');
 const d=rt.adsStart?.merchantId===id&&rt.adsStart?.source==='merchant_ads_start_read_v1_321'&&
  rt.adsStart.readOnly===true&&rt.adsStart.noCharge===true&&rt.adsStart.adsLive===false&&
  rt.adsStart.noAutomaticEnrollment===true?rt.adsStart:null;
 const checks=d?[
  ['merchantActive','Cadastro da revenda ativo'],
  ['businessCityReady','Cidade da revenda preenchida'],
  ['interestRegistered','Interesse em divulgação registrado'],
  ['activeCatalogReady','Produto ativo na categoria escolhida'],
  ['creativeCityCurrent','Cidade da proposta atualizada']
 ]:[];
 const guides={
  activate_merchant:['Concluir o cadastro da revenda','setup'],
  complete_business_city:['Conferir cidade e dados comerciais','setup'],
  update_creative_city:['Revisar proposta para a cidade atual','campaign'],
  register_interest:['Registrar interesse sem compromisso','interest'],
  activate_catalog:['Configurar produto ativo para divulgar','setup'],
  prepare_creative:['Criar sua apresentação de divulgação','campaign'],
  revise_creative:['Ajustar apresentação conforme revisão','campaign'],
  submit_creative:['Enviar apresentação para análise','campaign'],
  awaiting_review:['Acompanhar análise da apresentação','campaign'],
  creative_approved:['Acompanhar condições comerciais','offer'],
  review_status:['Consultar o estado da apresentação','campaign']
 };
 const next=d?guides[d.nextAction]:null;
 const items=checks.map(([key,title])=>
  '<div class="merchant-ads-start-step"><span aria-hidden="true">'+
    (d[key]?'✓':'○')+'</span><span>'+esc(title)+'</span>'+
    '<span class="tiny muted">'+(d[key]?'Concluído':'Pendente')+'</span></div>').join('');
 const label=d?.creativeStatus==='approved_creative'?'Peça aprovada para conversa comercial':
  d?.creativeStatus==='submitted'?'Sua apresentação está em análise':
  d?.readyToSubmit?'Pronto para enviar sua apresentação':
  'Prepare sua divulgação com passos simples';
 return '<section class="section merchant-ads-start" id="merchant-ads-start" aria-label="Começar a divulgar no TAMÃO">'+
  '<div class="section-head"><div><span class="section-kicker">DIVULGAÇÃO LOCAL • GUIA DE INÍCIO</span>'+
  '<h2>Coloque sua revenda no caminho de novos clientes</h2>'+
  '<p>Confira o que falta para apresentar sua divulgação ao TAMÃO, sem contratar ou pagar agora.</p></div>'+
  '<button type="button" class="secondary small" onclick="merchantAdsStartLoad()" '+
   (rt.adsStartBusy?'disabled':'')+'>'+(rt.adsStartBusy?'Conferindo…':'Verificar meu progresso')+'</button></div>'+
  (d?'<div class="card flat"><h3>'+esc(label)+'</h3>'+
    '<p class="tiny muted">Verificado no servidor • '+(Number(d.matchingActiveCatalogCount)||0)+
    ' produto(s) ativo(s) compatível(is) • Nenhum anúncio publicado.</p>'+
    '<div class="merchant-ads-start-steps">'+items+'</div>'+
    (next?'<button type="button" class="primary small" onclick="merchantAdsStartNavigate(\''+
     next[1]+'\')">'+esc(next[0])+'</button>':'')+
    (['prepare_creative','revise_creative'].includes(d.nextAction)?
      '<button type="button" class="secondary small" onclick="merchantAdsCreativeExample()">Preencher exemplo de apresentação</button>':'')+
    (d.nextAction==='prepare_creative'&&d.merchantActive&&d.businessCityReady&&d.interestRegistered&&d.activeCatalogReady?
      '<button type="button" class="primary small" onclick="merchantAdsFirstDraftCreate()" '+
      (rt.adsFirstDraftBusy?'disabled':'')+'>'+(rt.adsFirstDraftBusy?'Salvando…':'Criar meu primeiro rascunho')+'</button>':'')+
    (d.creativeStatus==='approved_creative'?'<p class="tiny muted">Aprovação de uma peça não garante exibição, alcance, preferência na busca ou faturamento.</p>':'')+
    '</div>':
    '<p class="muted tiny">Ainda não consultado. Use “Verificar meu progresso” para receber a orientação correta para esta revenda.</p>')+
  (rt.adsStartError?'<p class="notice danger">'+esc(rt.adsStartError)+'</p>':'')+
  '<p class="tiny muted">Este guia apenas consulta suas condições reais. Registro de interesse, envio de proposta, aceite e cobrança são ações separadas e voluntárias.</p>'+
  '</section>';
}
async function merchantAdsStartLoad(){
 const rt=globalThis.merchantRuntime,id=String(rt?.merchant?.merchantId||'');
 if(!rt||!id||rt.adsStartBusy||!['owner','manager'].includes(String(rt.merchant.memberRole||'')))return null;
 rt.adsStartBusy=true;rt.adsStartError=null;render();
 try{
  const d=await merchantInvoke('merchant-ops',{action:'ads-start-read',merchantId:id});
  const boolKeys=['merchantActive','businessCityReady','creativeCityCurrent',
    'interestRegistered','activeCatalogReady','readyToSubmit'];
  const allowed=['creative_approved','awaiting_review','activate_merchant',
    'complete_business_city','update_creative_city','register_interest',
    'activate_catalog','prepare_creative','revise_creative','submit_creative','review_status'];
  if(d?.source!=='merchant_ads_start_read_v1_321'||d.merchantId!==id||
    d.readOnly!==true||d.noCharge!==true||d.adsLive!==false||
    d.noAutomaticEnrollment!==true||
    !Number.isSafeInteger(d.matchingActiveCatalogCount)||d.matchingActiveCatalogCount<0||
    !Number.isSafeInteger(d.creativeVersion)||d.creativeVersion<0||
    !boolKeys.every(k=>typeof d[k]==='boolean')||
    !allowed.includes(d.nextAction)||
    ![null,'draft','submitted','approved_creative','needs_changes','withdrawn'].includes(d.creativeStatus)||
    d.readyToSubmit!==(d.merchantActive&&d.businessCityReady&&d.creativeCityCurrent&&
      d.interestRegistered&&d.activeCatalogReady&&d.creativeStatus==='draft'))
      throw new Error('O guia ainda não conseguiu confirmar os requisitos no servidor.');
  if(String(rt.merchant?.merchantId)!==id)return null;
  rt.adsStart=d;return d;
 }catch(e){
  if(String(rt.merchant?.merchantId)===id){
   rt.adsStart=null;rt.adsStartError=String(e?.message||e);toast(rt.adsStartError);
  }
  return null;
 }finally{rt.adsStartBusy=false;render();}
}
function merchantAdsStartNavigate(which){
 const allowed={interest:'merchant-ads-interest',campaign:'merchant-ads-campaigns',
   offer:'merchant-ads-offer',setup:'merchant-workspace-setup'};
 if(!Object.hasOwn(allowed,which))return false;
 const target=document.getElementById(allowed[which]);
 if(!target)return false;
 const panel=document.getElementById(which==='setup'?'merchant-workspace-setup':'merchant-workspace-growth');
 if(panel&&'open' in panel)panel.open=true;
 target.scrollIntoView({behavior:'smooth',block:'start'});
 if(which==='campaign')document.getElementById('ads-campaign-title')?.focus({preventScroll:true});
 return true;
}
function merchantAdsCreativeExample(){
 const rt=globalThis.merchantRuntime,id=String(rt?.merchant?.merchantId||'');
 if(!rt||!['owner','manager'].includes(String(rt.merchant.memberRole||''))||
  rt.adsStart?.merchantId!==id||
  !['prepare_creative','revise_creative'].includes(rt.adsStart?.nextAction))return false;
 if(!merchantAdsStartNavigate('campaign'))return false;
 const title=document.getElementById('ads-campaign-title');
 const description=document.getElementById('ads-campaign-description');
 if(!title||!description)return false;
 if((title.value.trim()||description.value.trim())&&
  !confirm('Substituir o texto atual por um exemplo editável? Nada será enviado automaticamente.'))return false;
 title.value='Conheça os produtos da nossa revenda';
 description.value='Conheça nossa revenda e consulte os produtos e condições de entrega disponíveis na sua região pelo TAMÃO.';
 title.focus({preventScroll:true});
 toast('Exemplo preenchido. Personalize e salve antes de enviar para revisão.');
 return true;
}


// V1.322 — explicit FIRST Ads draft, never a submission, approval, billing or publication.
async function merchantAdsFirstDraftCreate(){
 const rt=globalThis.merchantRuntime,id=String(rt?.merchant?.merchantId||'');
 if(!rt||!id||rt.adsFirstDraftBusy||rt.adsCampaignLoading||
   !['owner','manager'].includes(String(rt.merchant.memberRole||'')))return false;
 const d=rt.adsStart?.merchantId===id&&rt.adsStart?.source==='merchant_ads_start_read_v1_321'?rt.adsStart:null;
 if(!d||d.nextAction!=='prepare_creative'||d.creativeStatus!==null||
   d.creativeVersion!==0||d.merchantActive!==true||d.businessCityReady!==true||
   d.interestRegistered!==true||d.activeCatalogReady!==true||d.creativeCityCurrent!==true)return false;
 if(!confirm('Criar um rascunho inicial editável? Não será enviado, aprovado, cobrado ou publicado automaticamente.'))return false;
 rt.adsFirstDraftBusy=true;rt.adsCampaignError=null;render();
 try{
  // Repeat preflight on the server to exclude stale merchant, city and catalogue state.
  const fresh=await merchantInvoke('merchant-ops',{action:'ads-start-read',merchantId:id});
  if(fresh?.source!=='merchant_ads_start_read_v1_321'||fresh.merchantId!==id||
    fresh.noCharge!==true||fresh.adsLive!==false||fresh.noAutomaticEnrollment!==true||
    fresh.nextAction!=='prepare_creative'||fresh.creativeVersion!==0||
    fresh.creativeStatus!==null||fresh.merchantActive!==true||
    fresh.businessCityReady!==true||fresh.interestRegistered!==true||
    fresh.activeCatalogReady!==true||fresh.creativeCityCurrent!==true)
    throw new Error('Os requisitos mudaram. Atualize o guia antes de criar o rascunho.');
  const title='Conheça os produtos da nossa revenda';
  const description='Conheça nossa revenda e consulte os produtos e condições de entrega disponíveis na sua região pelo TAMÃO.';
  const created=await merchantInvoke('merchant-ops',{
    action:'ads-campaign',merchantId:id,operation:'save',version:0,category:'all',
    title,description,requestId:crypto.randomUUID()
  });
  if(created?.source!=='merchant_ads_campaign_v1_233'||created.merchantId!==id||
     created.noCharge!==true||created.adsLive!==false||
     created.campaign?.status!=='draft'||created.campaign.version!==1||
     created.campaign.title!==title||created.campaign.description!==description)
    throw new Error('O rascunho não foi confirmado.');
  const checked=await merchantInvoke('merchant-ops',{
    action:'ads-campaign',merchantId:id,operation:'view',version:0
  });
  if(checked?.source!=='merchant_ads_campaign_v1_233'||checked.merchantId!==id||
     checked.noCharge!==true||checked.adsLive!==false||
     checked.campaign?.status!=='draft'||checked.campaign.version!==created.campaign.version||
     checked.campaign.title!==title)
    throw new Error('Rascunho salvo, mas a leitura posterior está pendente.');
  if(String(rt.merchant?.merchantId)!==id)return false;
  rt.adsCampaign=checked;rt.adsStart=null;rt.adsFirstDraftBusy=false;render();
  merchantAdsStartNavigate('campaign');
  toast('Rascunho salvo. Personalize o texto e envie para revisão somente quando desejar.');
  return true;
 }catch(e){
  if(String(rt.merchant?.merchantId)===id){
   rt.adsStart=null;rt.adsCampaignError=String(e?.message||e);
   toast(rt.adsCampaignError);
  }
  return false;
 }finally{rt.adsFirstDraftBusy=false;render();}
}


// V1.323 — request human advice about TAMÃO Ads, only with explicit owner opt-in.
function merchantAdsAssistanceSection(merchant){
 if(!['owner','manager'].includes(String(merchant?.memberRole||'')))return '';
 const rt=globalThis.merchantRuntime||{},id=String(merchant?.merchantId||'');
 const d=rt.adsAssistance?.source==='merchant_ads_assistance_v1_323'&&
   rt.adsAssistance.merchantId===id&&rt.adsAssistance.readOnly===true&&
   rt.adsAssistance.noMessageSent===true&&rt.adsAssistance.noCharge===true&&
   rt.adsAssistance.adsLive===false?rt.adsAssistance:null;
 const request=d?.request||null,owner=merchant.memberRole==='owner';
 const status={requested:'Seu pedido foi registrado',triaged:'Pedido em análise interna',
   closed:'Solicitação encerrada',withdrawn:'Solicitação retirada'};
 const active=request&&['requested','triaged'].includes(request.status);
 const eligibility=d?.merchantActive===true&&d?.interestRegistered===true;
 const form=owner&&eligibility&&!active?'<div class="form-stack">'+
  '<label>Como prefere conversar sobre publicidade?<select class="input" id="ads-help-channel">'+
  '<option value="whatsapp">WhatsApp</option><option value="phone">Telefone</option>'+
  '<option value="email">E-mail</option></select></label>'+
  '<label>Sobre o que gostaria de receber orientação?<textarea class="input" id="ads-help-note" rows="3" minlength="20" maxlength="240" placeholder="Ex.: quero ajuda para planejar minha primeira divulgação, avaliar uma proposta e entender as condições." ></textarea></label>'+
  '<label class="check-row"><input type="checkbox" id="ads-help-consent">'+
  '<span>Solicito voluntariamente orientação comercial do TAMÃO sobre publicidade pelo canal escolhido. Posso retirar o pedido no painel; isso não autoriza cobranças ou anúncios.</span></label>'+
  '<button type="button" class="primary small" onclick="merchantAdsAssistanceAction(\'request\')">Solicitar orientação do TAMÃO</button></div>':'';
 const cancel=owner&&active?'<button type="button" class="secondary small" onclick="merchantAdsAssistanceAction(\'withdraw\')">Retirar minha solicitação</button>':'';
 const record=request?'<div class="card flat"><strong>'+esc(status[request.status]||'Não confirmado')+
  '</strong><p>Canal preferido: '+esc(({whatsapp:'WhatsApp',phone:'Telefone',email:'E-mail'})[request.channel]||'—')+
  '</p><p>'+esc(request.note)+'</p>'+
  '<p class="tiny muted">Registro v'+request.version+' • '+esc(String(request.requestedAt||'—'))+
  '</p>'+cancel+'</div>':'';
 return '<section class="section merchant-ads-assistance">'+
  '<div class="section-head"><div><span class="section-kicker">TAMÃO ADS • ATENDIMENTO SOB PEDIDO</span>'+
  '<h3>Quer uma orientação para começar a anunciar?</h3>'+
  '<p>Peça atendimento comercial à equipe TAMÃO no canal que preferir, sem compromisso de contratar.</p></div>'+
  '<button type="button" class="secondary small" onclick="merchantAdsAssistanceLoad()">Consultar pedido</button></div>'+
  (d?(record||(!eligibility?'<p class="muted tiny">Registre seu interesse em divulgação e mantenha sua revenda ativa para solicitar orientação.</p>':'')+form):
    '<p class="muted tiny">Consulte o servidor para verificar se pode solicitar atendimento.</p>')+
  (rt.adsAssistanceError?'<p class="notice danger">'+esc(rt.adsAssistanceError)+'</p>':'')+
  '<p class="tiny muted">A solicitação vai para uma fila interna. Esta opção não envia mensagens automaticamente, não cria contrato, não gera taxa e não garante contato imediato.</p></section>';
}
async function merchantAdsAssistanceLoad(){
 const rt=globalThis.merchantRuntime,id=String(rt?.merchant?.merchantId||'');
 if(!rt||!id||rt.adsAssistanceBusy||!['owner','manager'].includes(String(rt.merchant.memberRole||'')))return null;
 rt.adsAssistanceBusy=true;rt.adsAssistanceError=null;render();
 try{
  const out=await merchantInvoke('merchant-ops',{action:'ads-assistance',merchantId:id,operation:'view'});
  if(out?.source!=='merchant_ads_assistance_v1_323'||out.merchantId!==id||
    out.readOnly!==true||out.noMessageSent!==true||out.noCharge!==true||
    out.adsLive!==false||typeof out.merchantActive!=='boolean'||
    typeof out.interestRegistered!=='boolean'||
    (out.request!==null&&(!['requested','triaged','closed','withdrawn'].includes(out.request?.status)||
      !['whatsapp','phone','email'].includes(out.request?.channel)||
      typeof out.request.note!=='string'||out.request.note.length<20||
      !Number.isSafeInteger(out.request.version)||out.request.version<1)))
    throw new Error('Pedido de orientação não confirmado no servidor.');
  if(String(rt.merchant?.merchantId)!==id)return null;
  rt.adsAssistance=out;return out;
 }catch(e){
  if(String(rt.merchant?.merchantId)===id){
   rt.adsAssistance=null;rt.adsAssistanceError=String(e?.message||e);toast(rt.adsAssistanceError);
  }
  return null;
 }finally{rt.adsAssistanceBusy=false;render();}
}
async function merchantAdsAssistanceAction(operation){
 const rt=globalThis.merchantRuntime,id=String(rt?.merchant?.merchantId||'');
 if(!rt||!id||rt.merchant.memberRole!=='owner'||rt.adsAssistanceBusy||
   !['request','withdraw'].includes(operation))return false;
 const state=rt.adsAssistance,req=state?.merchantId===id&&state.readOnly===true?state.request:null;
 if(!state||!Number.isSafeInteger(req?.version||0))return false;
 const active=req&&['requested','triaged'].includes(req.status);
 if(operation==='request'&&(!state.merchantActive||!state.interestRegistered||active))return false;
 if(operation==='withdraw'&&!active)return false;
 let channel=null,note=null;
 if(operation==='request'){
  channel=String(document.getElementById('ads-help-channel')?.value||'');
  note=String(document.getElementById('ads-help-note')?.value||'').trim();
  if(!['whatsapp','phone','email'].includes(channel)||note.length<20||note.length>240||
    document.getElementById('ads-help-consent')?.checked!==true){
   toast('Escolha o canal, informe o assunto e confirme seu pedido voluntário.');return false;
  }
 }
 if(!confirm(operation==='request'?'Registrar pedido de orientação de publicidade, sem cobrança nem mensagem automática?':
   'Retirar sua solicitação de orientação comercial?'))return false;
 rt.adsAssistanceBusy=true;render();
 try{
  const out=await merchantInvoke('merchant-ops',{
   action:'ads-assistance',merchantId:id,operation,
   expectedVersion:req?.version||0,channel,note,consent:true,requestId:crypto.randomUUID()
  });
  const status=operation==='request'?'requested':'withdrawn';
  if(out?.source!=='merchant_ads_assistance_v1_323'||out.merchantId!==id||
   out.recorded!==true||out.status!==status||out.version!==(req?.version||0)+1||
   out.noMessageSent!==true||out.noCharge!==true||out.adsLive!==false)
   throw new Error('O pedido não foi confirmado no servidor.');
  rt.adsAssistance=null;rt.adsAssistanceBusy=false;
  const checked=await merchantAdsAssistanceLoad();
  if(checked?.request?.status!==status||checked.request.version!==out.version)
   throw new Error('Solicitação registrada, mas leitura posterior pendente.');
  toast(operation==='request'?'Pedido registrado. A equipe poderá analisá-lo.':'Solicitação retirada.');
  return true;
 }catch(e){
  rt.adsAssistance=null;rt.adsAssistanceError=String(e?.message||e);toast(rt.adsAssistanceError);
  return false;
 }finally{rt.adsAssistanceBusy=false;render();}
}


// V1.325 — explicit owner-reported experience with a founder-declared contact.
function merchantAdsContactFeedbackSection(merchant){
 if(!['owner','manager'].includes(String(merchant?.memberRole||'')))return '';
 const rt=globalThis.merchantRuntime||{},id=String(merchant?.merchantId||'');
 const out=rt.adsContactFeedback?.merchantId===id&&
  rt.adsContactFeedback?.source==='merchant_ads_contact_feedback_v1_325'&&
  rt.adsContactFeedback.readOnly===true&&
  rt.adsContactFeedback.messageSent===false&&rt.adsContactFeedback.deliveryProven===false&&
  rt.adsContactFeedback.adsLive===false&&rt.adsContactFeedback.paymentCreated===false?
  rt.adsContactFeedback:null;
 const last=out?.lastContact,feedback=last?.feedback;
 const outcome={not_reached:'Contato não concluído',conversation:'Conversa declarada pela equipe',
  followup_requested:'Retorno declarado pela equipe',not_interested:'Sem interesse, conforme relato da equipe'};
 const states={contact_confirmed:'Confirmei que fui atendido',
  contact_not_received:'Não recebi o contato informado',
  followup_needed:'Ainda preciso de um retorno'};
 const eligible=last&&out.consentCurrent===true&&!feedback&&merchant.memberRole==='owner'&&
  Number.isSafeInteger(out.assistanceVersion)&&out.assistanceVersion>0;
 const controls=eligible?'<div class="form-stack">'+
   '<label>Como foi o atendimento?<select id="ads-contact-feedback-response" class="input">'+
   '<option value="">Selecione uma resposta</option>'+
   '<option value="contact_confirmed">Fui atendido</option>'+
   '<option value="contact_not_received">Não recebi esse contato</option>'+
   '<option value="followup_needed">Preciso de novo retorno</option></select></label>'+
   '<label class="check-row"><input id="ads-contact-feedback-consent" type="checkbox">'+
   '<span>Confirmo que esta é minha avaliação pessoal do contato informado pelo TAMÃO.</span></label>'+
   '<button type="button" class="primary small" onclick="merchantAdsContactFeedbackSubmit()">Registrar minha avaliação</button></div>':'';
 const details=last?'<div class="card flat"><p><strong>Último contato registrado:</strong> '+
  esc(outcome[last.reportedOutcome]||'Atendimento em acompanhamento')+'</p>'+
  '<p class="tiny muted">Canal informado: '+esc(String(last.channel||''))+
  ' • Registro: '+esc(String(last.reportedAt||''))+'</p>'+
  (last.nextFollowupOn?'<p class="tiny muted">Retorno informado pela equipe: '+
    esc(String(last.nextFollowupOn))+'</p>':'')+
  (feedback?'<p><strong>Sua avaliação:</strong> '+esc(states[feedback.response]||'Registrada')+
    '</p><p class="tiny muted">Registro: '+esc(String(feedback.submittedAt||''))+'</p>':'')+
  controls+'</div>':'<p class="muted tiny">Não há atendimento manual atual registrado para avaliar.</p>';
 return '<section class="section merchant-ads-contact-feedback">'+
  '<div class="section-head"><div><span class="section-kicker">TAMÃO ADS • SUA EXPERIÊNCIA</span>'+
  '<h3>Como foi nosso atendimento?</h3>'+
  '<p>Se você pediu orientação para anunciar, pode conferir o último contato informado e registrar sua experiência.</p></div>'+
  '<button type="button" class="secondary small" onclick="merchantAdsContactFeedbackLoad()">Consultar atendimento</button></div>'+
  (out?details:'<p class="muted tiny">Consulte o servidor para verificar se há um contato disponível.</p>')+
  (rt.adsContactFeedbackError?'<p class="notice danger">'+esc(rt.adsContactFeedbackError)+'</p>':'')+
  '<p class="tiny muted">Este formulário não envia WhatsApp, não confirma entrega técnica de mensagens e não cria despesas ou anúncios.</p></section>';
}
async function merchantAdsContactFeedbackLoad(){
 const rt=globalThis.merchantRuntime,id=String(rt?.merchant?.merchantId||'');
 if(!rt||!id||rt.adsContactFeedbackBusy||
   !['owner','manager'].includes(String(rt.merchant.memberRole||'')))return null;
 rt.adsContactFeedbackBusy=true;rt.adsContactFeedbackError=null;render();
 try{
  const out=await merchantInvoke('merchant-ops',{
   action:'ads-contact-feedback',merchantId:id,operation:'view'
  });
  if(out?.source!=='merchant_ads_contact_feedback_v1_325'||out.merchantId!==id||
    out.readOnly!==true||out.messageSent!==false||out.deliveryProven!==false||
    out.adsLive!==false||out.paymentCreated!==false||
    typeof out.consentCurrent!=='boolean'||
    (out.lastContact!==null&&(!/^[0-9a-f-]{36}$/i.test(String(out.lastContact?.contactRequestId||''))||
      !['not_reached','conversation','followup_requested','not_interested'].includes(
       out.lastContact?.reportedOutcome)||
      out.lastContact.adminReportIndependentProof!==false||
      (out.lastContact.feedback!==null&&(
       !['contact_confirmed','contact_not_received','followup_needed'].includes(
        out.lastContact.feedback?.response)||out.lastContact.feedback.merchantDeclared!==true)))))
   throw new Error('Avaliação comercial não confirmada pelo servidor.');
  if(String(rt.merchant?.merchantId)!==id)return null;
  rt.adsContactFeedback=out;return out;
 }catch(e){
  if(String(rt.merchant?.merchantId)===id){
   rt.adsContactFeedback=null;rt.adsContactFeedbackError=String(e?.message||e);
   toast(rt.adsContactFeedbackError);
  }
  return null;
 }finally{rt.adsContactFeedbackBusy=false;render();}
}
async function merchantAdsContactFeedbackSubmit(){
 const rt=globalThis.merchantRuntime,id=String(rt?.merchant?.merchantId||'');
 if(!rt||!id||rt.merchant.memberRole!=='owner'||rt.adsContactFeedbackBusy)return false;
 const out=rt.adsContactFeedback?.merchantId===id&&rt.adsContactFeedback?.readOnly===true?
  rt.adsContactFeedback:null,contact=out?.lastContact;
 if(!out||out.consentCurrent!==true||!contact||contact.feedback||
   !Number.isSafeInteger(out.assistanceVersion)||out.assistanceVersion<1||
   !/^[0-9a-f-]{36}$/i.test(String(contact.contactRequestId||'')))return false;
 const response=String(document.getElementById('ads-contact-feedback-response')?.value||'');
 if(!['contact_confirmed','contact_not_received','followup_needed'].includes(response)||
   document.getElementById('ads-contact-feedback-consent')?.checked!==true){
   toast('Selecione sua experiência e marque a confirmação.');return false;
 }
 if(!confirm('Registrar sua avaliação pessoal deste atendimento? Ela não comprova entrega técnica nem cria novas cobranças.'))return false;
 rt.adsContactFeedbackBusy=true;render();
 try{
  const saved=await merchantInvoke('merchant-ops',{
    action:'ads-contact-feedback',merchantId:id,operation:'respond',
    contactRequestId:contact.contactRequestId,expectedAssistanceVersion:out.assistanceVersion,
    response,consent:true,requestId:crypto.randomUUID()
  });
  if(saved?.source!=='merchant_ads_contact_feedback_v1_325'||saved.merchantId!==id||
    saved.recorded!==true||saved.contactRequestId!==contact.contactRequestId||
    saved.response!==response||saved.messageSent!==false||saved.deliveryProven!==false||
    saved.adsLive!==false||saved.paymentCreated!==false)
   throw new Error('Resposta ainda não confirmada no servidor.');
  rt.adsContactFeedback=null;rt.adsContactFeedbackBusy=false;
  const fresh=await merchantAdsContactFeedbackLoad();
  if(fresh?.lastContact?.contactRequestId!==contact.contactRequestId||
    fresh.lastContact.feedback?.response!==response)
   throw new Error('A avaliação foi enviada, mas a leitura de confirmação ainda não foi concluída.');
  toast('Sua avaliação foi registrada e está disponível para a equipe responsável.');
  return true;
 }catch(e){
  rt.adsContactFeedback=null;rt.adsContactFeedbackError=String(e?.message||e);
  toast(rt.adsContactFeedbackError);return false;
 }finally{rt.adsContactFeedbackBusy=false;render();}
}


// V1.326 — read-only status of a manually planned return, never a delivered message.
function merchantAdsFeedbackReturnSection(merchant){
 if(!['owner','manager'].includes(String(merchant?.memberRole||'')))return '';
 const rt=globalThis.merchantRuntime||{},id=String(merchant?.merchantId||'');
 const d=rt.adsFeedbackReturn?.merchantId===id&&
  rt.adsFeedbackReturn?.source==='merchant_ads_feedback_return_v1_326'&&
  rt.adsFeedbackReturn.readOnly===true&&rt.adsFeedbackReturn.messageSent===false&&
  rt.adsFeedbackReturn.contactPerformed===false&&rt.adsFeedbackReturn.deliveryProven===false&&
  rt.adsFeedbackReturn.adsLive===false&&rt.adsFeedbackReturn.paymentCreated===false?
  rt.adsFeedbackReturn:null;
 const plan=d?.returnPlan||null;
 return '<section class="section merchant-ads-feedback-return">'+
  '<div class="section-head"><div><span class="section-kicker">V1.326 • ACOMPANHAMENTO COMERCIAL</span>'+
  '<h3>Previsão de retorno da equipe TAMÃO</h3>'+
  '<p>Consulte se a equipe organizou uma nova tentativa após sua avaliação do atendimento.</p></div>'+
  '<button class="secondary small" type="button" onclick="merchantAdsFeedbackReturnLoad()">Consultar previsão</button></div>'+
  (d?(plan?'<div class="card flat"><strong>'+
    esc(plan.status==='scheduled'?'Retorno manual previsto':'Previsão anterior cancelada')+
    '</strong><p>Data informada pela equipe: '+esc(String(plan.dueOn||'—'))+
    '</p><p class="tiny muted">Versão do planejamento: '+Number(plan.version)+
    '. Este registro não comprova ligação ou mensagem enviada.</p></div>':
    '<p class="muted tiny">Nenhum retorno manual foi agendado na solicitação atual.</p>'):
    '<p class="muted tiny">Consulte o servidor para verificar o planejamento.</p>')+
  (rt.adsFeedbackReturnError?'<p class="notice danger">'+esc(rt.adsFeedbackReturnError)+'</p>':'')+
  '<p class="tiny muted">A previsão é apenas organizacional; não significa contato realizado, mensagem entregue, pagamento ou anúncio publicado.</p></section>';
}
async function merchantAdsFeedbackReturnLoad(){
 const rt=globalThis.merchantRuntime,id=String(rt?.merchant?.merchantId||'');
 if(!rt||!id||rt.adsFeedbackReturnBusy||
  !['owner','manager'].includes(String(rt.merchant.memberRole||'')))return null;
 rt.adsFeedbackReturnBusy=true;rt.adsFeedbackReturnError=null;render();
 try{
  const out=await merchantInvoke('merchant-ops',{
   action:'ads-feedback-return',merchantId:id,operation:'view'
  });
  if(out?.source!=='merchant_ads_feedback_return_v1_326'||out.merchantId!==id||
    out.readOnly!==true||typeof out.consentCurrent!=='boolean'||
    out.messageSent!==false||out.contactPerformed!==false||
    out.deliveryProven!==false||out.adsLive!==false||out.paymentCreated!==false||
    (out.returnPlan!==null&&(!['scheduled','canceled'].includes(out.returnPlan?.status)||
     !Number.isSafeInteger(out.returnPlan.version)||out.returnPlan.version<1)))
    throw new Error('Previsão de retorno não confirmada no servidor.');
  if(String(rt.merchant?.merchantId)!==id)return null;
  rt.adsFeedbackReturn=out;return out;
 }catch(e){
  if(String(rt.merchant?.merchantId)===id){
   rt.adsFeedbackReturn=null;rt.adsFeedbackReturnError=String(e?.message||e);
   toast(rt.adsFeedbackReturnError);
  }
  return null;
 }finally{rt.adsFeedbackReturnBusy=false;render();}
}


// V1.327 — merchant sees a new reported attempt, not proof of delivered communication.
function merchantAdsReturnExecutionSection(merchant){
 if(!['owner','manager'].includes(String(merchant?.memberRole||'')))return '';
 const rt=globalThis.merchantRuntime||{},id=String(merchant?.merchantId||'');
 const packet=rt.adsReturnExecution?.merchantId===id&&
   rt.adsReturnExecution.source==='merchant_ads_return_execution_v1_327'&&
   rt.adsReturnExecution.readOnly===true&&rt.adsReturnExecution.automaticMessagesSent===0&&
   rt.adsReturnExecution.independentDeliveryProof===false&&
   rt.adsReturnExecution.adsLive===false&&rt.adsReturnExecution.paymentCreated===false?
   rt.adsReturnExecution:null;
 const p=packet?.plan||null;
 const state={scheduled:'Retorno previsto',canceled:'Previsão cancelada',
    attempt_recorded:'Nova tentativa relatada pela equipe'};
 const label={not_reached:'A equipe não conseguiu falar',conversation:'A equipe relata uma conversa',
   followup_requested:'A equipe relata pedido de novo retorno',not_interested:'A equipe relata falta de interesse'};
 return '<section class="section merchant-ads-return-execution">'+
  '<div class="section-head"><div><span class="section-kicker">V1.327 • ACOMPANHAMENTO REAL</span>'+
  '<h3>O que aconteceu após a previsão?</h3>'+
  '<p>Consulte o andamento do retorno, diferenciando agendamento e nova tentativa declarada.</p></div>'+
  '<button class="secondary small" type="button" onclick="merchantAdsReturnExecutionLoad()">Consultar andamento</button></div>'+
  (packet?(p?'<div class="card flat"><strong>'+esc(state[p.status]||'Retorno em acompanhamento')+
    '</strong><p>Data que estava prevista: '+esc(String(p.dueOn||'—'))+'</p>'+
    (p.status==='attempt_recorded'?'<p>'+esc(label[p.attemptOutcome]||'Tentativa registrada')+
     ' • '+esc(String(p.attemptReportedAt||''))+'</p>':'')+
    '<p class="tiny muted">Registro administrativo, sem prova independente de entrega ou confirmação de atendimento.</p></div>':
    '<p class="muted tiny">Não há previsão atual com nova tentativa registrada para esta revenda.</p>'):
    '<p class="muted tiny">Consulte o servidor para confirmar o andamento.</p>')+
  (rt.adsReturnExecutionError?'<p class="notice danger">'+esc(rt.adsReturnExecutionError)+'</p>':'')+
  '<p class="tiny muted">Nenhuma mensagem, ligação, cobrança ou publicação é realizada por esta consulta.</p></section>';
}
async function merchantAdsReturnExecutionLoad(){
 const rt=globalThis.merchantRuntime,id=String(rt?.merchant?.merchantId||'');
 if(!rt||!id||rt.adsReturnExecutionBusy||
    !['owner','manager'].includes(String(rt.merchant.memberRole||'')))return null;
 rt.adsReturnExecutionBusy=true;rt.adsReturnExecutionError=null;render();
 try{
  const out=await merchantInvoke('merchant-ops',{
    action:'ads-return-execution',merchantId:id,operation:'view'
  });
  if(out?.source!=='merchant_ads_return_execution_v1_327'||out.merchantId!==id||
    out.readOnly!==true||typeof out.consentCurrent!=='boolean'||
    out.automaticMessagesSent!==0||out.independentDeliveryProof!==false||
    out.adsLive!==false||out.paymentCreated!==false||
    (out.plan!==null&&(!['scheduled','canceled','attempt_recorded'].includes(out.plan?.status)||
      !Number.isSafeInteger(out.plan.version)||out.plan.version<1||
      out.plan.attemptIndependentlyVerified!==false||
      (out.plan.status==='attempt_recorded'&&
        !['not_reached','conversation','followup_requested','not_interested'].includes(out.plan.attemptOutcome)))))
    throw new Error('Andamento de retorno não confirmado no servidor.');
  if(String(rt.merchant?.merchantId)!==id)return null;
  rt.adsReturnExecution=out;return out;
 }catch(e){
  if(String(rt.merchant?.merchantId)===id){
    rt.adsReturnExecution=null;rt.adsReturnExecutionError=String(e?.message||e);
    toast(rt.adsReturnExecutionError);
  }
  return null;
 }finally{rt.adsReturnExecutionBusy=false;render();}
}
