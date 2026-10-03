function adminLeadWhatsApp(raw){
  const digits=String(raw||'').replace(/\D/g,'');
  return digits.length===10||digits.length===11?'55'+digits:digits;
}
function adminFirstName(value){
  return String(value||'').trim().split(/\s+/)[0]||'';
}
function adminLeadWhatsAppText(x){
  const first=adminFirstName(x.contact_name);
  if(x.lead_type==='merchant'){
    const company=String(x.business_name||'sua empresa').trim();
    return 'Olá'+(first?', '+first:'')+'! Aqui é do TAMÃO. Recebemos o interesse da '+company+' em participar como parceiro em São Gabriel. Quero entender rapidamente sua operação e explicar os próximos passos, sem compromisso. Podemos conversar por aqui?';
  }
  return 'Olá'+(first?', '+first:'')+'! Aqui é do TAMÃO. Você entrou na nossa lista de abertura em São Gabriel. Estamos organizando a cobertura por região e queremos confirmar seu interesse antes da abertura. Posso te avisar por aqui quando houver novidade para o seu CEP?';
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
  const fresh=leads.filter(x=>x.status==='new').length;
  const contacted=leads.filter(x=>x.status==='contacted').length;
  const qualified=leads.filter(x=>x.status==='qualified').length;
  const converted=leads.filter(x=>x.status==='converted').length;
  const staleNew=leads.filter(x=>x.status==='new'&&(Date.now()-Date.parse(String(x.created_at||'')))>=24*60*60*1000).length;
  const ordered=[...leads].sort((a,b)=>adminLeadPriority(a.status)-adminLeadPriority(b.status)||(Date.parse(a.created_at||'')-Date.parse(b.created_at||'')));
  return [
    '<section class="section">',
      '<div class="section-head"><div><span class="section-kicker">AQUISIÇÃO • PRÉ-LANÇAMENTO</span><h2>Clientes e parceiros interessados</h2><p>Leads captados pelo site com origem de campanha, categorias de interesse e WhatsApp para contato.</p></div><span class="status-pill online">'+leads.length+' lead(s)</span></div>',
      '<div class="merchant-kpis"><div class="kpi"><span class="label">Clientes interessados</span><strong>'+customers+'</strong></div><div class="kpi"><span class="label">Empresas interessadas</span><strong>'+merchants+'</strong></div><div class="kpi"><span class="label">Novos</span><strong>'+fresh+'</strong></div><div class="kpi"><span class="label">Contatados</span><strong>'+contacted+'</strong></div><div class="kpi"><span class="label">Qualificados</span><strong>'+qualified+'</strong></div><div class="kpi"><span class="label">Convertidos</span><strong>'+converted+'</strong></div><div class="kpi"><span class="label">Novos há +24h</span><strong>'+staleNew+'</strong></div></div>',
      adminLeadCampaignRows(leads).length?'<div class="card flat" style="margin-top:14px"><h3>Origem dos leads</h3><div class="list">'+adminLeadCampaignRows(leads).map(x=>'<div class="list-row"><div><strong>'+esc(x.source)+'</strong><br><small>'+esc(x.campaign)+'</small></div><div class="tiny" style="text-align:right"><strong>'+x.total+'</strong><br>'+x.customers+' cliente(s) • '+x.merchants+' parceiro(s)</div></div>').join('')+'</div></div>':'',
      '<div class="grid cards-3" style="margin-top:14px">'+(ordered.length?ordered.slice(0,60).map(adminPrelaunchLeadCard).join(''):'<div class="empty card">Nenhum lead captado ainda.</div>')+'</div>',
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
