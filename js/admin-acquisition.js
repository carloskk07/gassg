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
  adminRuntime.prospectLoading=true;
  adminRuntime.prospectError=null;
  render();
  try{
    const response=await adminInvoke({action:'prospect-intelligence',
      city:adminRuntime.prospectCity,state:adminRuntime.prospectState,force});
    if(response?.state===adminRuntime.prospectState
       &&String(response?.city||'').toUpperCase()===adminRuntime.prospectCity.toUpperCase()){
      adminRuntime.prospectReport=response;
    }
  }catch(error){adminRuntime.prospectError=String(error?.message||error)}
  finally{adminRuntime.prospectLoading=false;render();
    if(['superadmin','operations'].includes(String(adminCurrentRole())))adminLoadCityNotifications().catch(()=>{});
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
  if(!adminReady()||adminRuntime.expansionRadarLoading)return;
  adminRuntime.expansionRadarLoading=true;
  adminRuntime.expansionRadarError=null;
  try{
    const result=await adminInvoke({action:'expansion-radar'});
    adminRuntime.expansionRadar=Array.isArray(result?.cities)?result.cities:[];
  }catch(error){adminRuntime.expansionRadarError=String(error?.message||error)}
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

function adminProspectCrmEditor(record){
  const cnpj=String(record.cnpj||'').replace(/\D/g,'');
  if(!/^[0-9]{14}$/.test(cnpj))return '';
  if(!['superadmin','operations','compliance'].includes(String(adminCurrentRole())))return '';
  const choices=Object.entries(PROSPECT_STAGE_LABELS)
    .map(([value,label])=>'<option value="'+value+'" '+(value===record.prospect_status?'selected':'')+'>'+esc(label)+'</option>').join('');
  const date=String(record.follow_up_at||'').slice(0,10);
  return '<details class="card flat" style="margin-top:8px"><summary>Gerenciar negociação</summary>'+
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
        adminProspectInvitationControls(x)+adminProspectCrmEditor(x)+'</div></div>';
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
    '</div>'+adminExpansionRadarSection()+placeholder+error+summary+adminCityNotificationsSection()+
    '<div class="notice"><strong>Ativação por elegibilidade, nunca apenas por cadastro.</strong> Uma cidade somente poderá abrir para compras após confirmação de revenda apta, regularidade ANP quando GLP, estoque, preço, área de entrega, capacidade e recebimento. O registro da ANP não equivale a autorização de parceria.</div>'+
  '</section>';
}
