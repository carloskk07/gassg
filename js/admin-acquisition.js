function adminLeadWhatsApp(raw){
  const digits=String(raw||'').replace(/\D/g,'');
  return digits.length===10||digits.length===11?'55'+digits:digits;
}
function adminLeadInterestLabel(value){
  return ({gas:'Gás',water:'Água',charcoal:'Carvão',firewood:'Lenha',ice:'Gelo',other:'Outros'})[value]||String(value||'');
}
function adminPrelaunchLeadCard(x){
  const merchant=x.lead_type==='merchant';
  const type=merchant?'PARCEIRO':'CLIENTE';
  const title=merchant?(x.business_name||x.contact_name||'Empresa'):(x.contact_name||'Novo interessado');
  const interests=(x.interests||[]).map(adminLeadInterestLabel).join(' • ')||'—';
  const source=[x.source,x.medium,x.campaign].filter(Boolean).join(' / ')||'acesso direto';
  const wa=adminLeadWhatsApp(x.phone);
  return [
    '<article class="card flat">',
      '<div class="status-bar"><div><span class="status-pill '+(merchant?'online':'')+'">'+type+'</span>',
      '<h3 style="margin:8px 0 3px">'+esc(title)+'</h3>',
      '<div class="tiny muted">'+esc(x.contact_name||'')+(x.postal_code?' • CEP '+esc(x.postal_code):'')+'</div></div>',
      '<small>'+new Date(x.created_at).toLocaleString('pt-BR')+'</small></div>',
      '<div class="list-row"><span>Interesses</span><strong>'+esc(interests)+'</strong></div>',
      '<div class="list-row"><span>Origem</span><strong>'+esc(source)+'</strong></div>',
      x.note?'<p class="muted tiny">'+esc(x.note)+'</p>':'',
      '<div class="order-actions"><a class="secondary small" href="https://wa.me/'+esc(wa)+'" target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a><span class="tiny muted">envios: '+Number(x.submission_count||1)+'</span></div>',
    '</article>'
  ].join('');
}
function adminLeadCampaignRows(leads){
  const groups=new Map();
  for(const x of leads){
    const source=String(x.source||'direto');
    const campaign=String(x.campaign||'sem_campanha');
    const key=source+'|'+campaign;
    const row=groups.get(key)||{source,campaign,customers:0,merchants:0,total:0};
    row.total++;
    if(x.lead_type==='merchant')row.merchants++;else row.customers++;
    groups.set(key,row);
  }
  return [...groups.values()].sort((a,b)=>b.total-a.total||a.source.localeCompare(b.source)).slice(0,8);
}
function adminPrelaunchLeadsSection(data){
  const leads=Array.isArray(data?.prelaunchLeads)?data.prelaunchLeads:[];
  const customers=leads.filter(x=>x.lead_type==='customer').length;
  const merchants=leads.filter(x=>x.lead_type==='merchant').length;
  return [
    '<section class="section">',
      '<div class="section-head"><div><span class="section-kicker">AQUISIÇÃO • PRÉ-LANÇAMENTO</span><h2>Clientes e parceiros interessados</h2><p>Leads captados pelo site com origem de campanha, categorias de interesse e WhatsApp para contato.</p></div><span class="status-pill online">'+leads.length+' lead(s)</span></div>',
      '<div class="merchant-kpis"><div class="kpi"><span class="label">Clientes interessados</span><strong>'+customers+'</strong></div><div class="kpi"><span class="label">Empresas interessadas</span><strong>'+merchants+'</strong></div></div>',
      adminLeadCampaignRows(leads).length?'<div class="card flat" style="margin-top:14px"><h3>Origem dos leads</h3><div class="list">'+adminLeadCampaignRows(leads).map(x=>'<div class="list-row"><div><strong>'+esc(x.source)+'</strong><br><small>'+esc(x.campaign)+'</small></div><div class="tiny" style="text-align:right"><strong>'+x.total+'</strong><br>'+x.customers+' cliente(s) • '+x.merchants+' parceiro(s)</div></div>').join('')+'</div></div>':'',
      '<div class="grid cards-3" style="margin-top:14px">'+(leads.length?leads.slice(0,60).map(adminPrelaunchLeadCard).join(''):'<div class="empty card">Nenhum lead captado ainda.</div>')+'</div>',
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
  const status=String(x.status||'new').toUpperCase();
  let contactAction='';
  if(x.contact_channel==='email'){
    contactAction='<a class="secondary small" href="mailto:'+encodeURIComponent(String(x.contact_value||''))+'">Responder por e-mail</a>';
  }else{
    contactAction='<a class="secondary small" href="https://wa.me/'+esc(adminLeadWhatsApp(x.contact_value))+'" target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a>';
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
      '<div class="order-actions">'+contactAction+'<span class="tiny muted">'+esc(String(x.contact_value||''))+'</span></div>',
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
