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
      rows.some((r,i)=>r.key!==reference.rows[i]?.key)){
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
    '</div>'+adminExpansionRadarSection()+adminCityPipelineView(d)+adminCommercialOpportunityView(d)+adminExpansionBridgeView(d)+placeholder+error+summary+adminProspectFollowupView(matches?report:null)+adminCityNotificationsSection()+
    '<div class="notice"><strong>Ativação por elegibilidade, nunca apenas por cadastro.</strong> Uma cidade somente poderá abrir para compras após confirmação de revenda apta, regularidade ANP quando GLP, estoque, preço, área de entrega, capacidade e recebimento. O registro da ANP não equivale a autorização de parceria.</div>'+
  '</section>';
}
