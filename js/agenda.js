/* TAMÃO Agenda: optional professional booking module; no payment processing. */
const agendaRuntime={
 phase:'idle',client:null,user:null,page:null,services:[],staff:[],depositSettings:[],hours:[],bookings:[],mine:[],waiting:[],myWaiting:[],blocks:[],closedDays:[],dayClosed:false,
 slug:'',publicProfile:null,directory:[],directoryQuery:'',ownerMode:false,serviceId:'',staffId:'',rescheduleId:'',day:'',slots:[],paymentQuote:null,selectedStart:'',
 notice:'',error:'',busy:false,slotBusy:false,requestKey:'',epoch:0,authReady:false,qrOpen:false,advancedOpen:false,hoursOpen:false
};
const agendaUuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const agendaSlugPattern=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const agendaDays=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
function agendaRoute(){return route()==='agenda'&&!globalThis.adminPortalRequested?.()&&!globalThis.merchantPortalRequested?.();}
// Path URLs are canonical; legacy query/hash links continue resolving.
function agendaSlug(){
 const path=String(location.pathname||'');
 const match=/^\/agenda\/([a-z0-9-]+)\/?$/.exec(path);
 if(match)return agendaSlugPattern.test(match[1])&&match[1].length<=60?match[1]:'';
 const x=String(location.hash||'').split('?')[1]||'';
 try{
  const value=new URLSearchParams(x).get('profissional')||
   new URLSearchParams(location.search).get('profissional')||'';
  return agendaSlugPattern.test(value)&&value.length<=60?value:'';
 }catch{return '';}
}
function agendaShareLink(slug){
 if(!agendaSlugPattern.test(String(slug||''))||slug.length>60)return '';
 return 'https://tamao.com.br/agenda/'+encodeURIComponent(slug);
}
function agendaMoney(cents){return BRL.format(Math.max(0,Number(cents)||0)/100);}
function agendaPhotoUrl(path){
 if(!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/.test(String(path||'')))return '';
 return CHAMA_BACKEND.url+'/storage/v1/object/public/tamao-discovery-photos/'+
  String(path).split('/').map(encodeURIComponent).join('/');
}
function agendaSafeSlug(str){
 return String(str||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[^a-z0-9 -]/g,'').trim().replace(/\s+/g,'-')
  .replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,60);
}
function agendaToday(offset=0){
 const fmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});
 const parts=Object.fromEntries(fmt.formatToParts(new Date(Date.now()+offset*86400000)).map(x=>[x.type,x.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
}
function agendaNextDay(day){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(day||''))||day>=agendaToday(30))return '';
 const next=new Date(day+'T12:00:00Z');
 if(!Number.isFinite(next.getTime()))return '';
 next.setUTCDate(next.getUTCDate()+1);
 const result=next.toISOString().slice(0,10);
 return result<=agendaToday(30)?result:'';
}
// Only the selected public slot is retained for email-link login; no contacts or tokens.
const agendaPendingKey='tamao-agenda-pending-v1';
function agendaClearPendingChoice(){
 try{localStorage.removeItem(agendaPendingKey);}catch(_){}
}
function agendaRememberPendingChoice(){
 const s=agendaRuntime,slug=agendaSlug();
 if(s.user||!slug||!s.selectedStart)return;
 try{localStorage.setItem(agendaPendingKey,JSON.stringify({
  slug,serviceId:s.serviceId,staffId:s.staffId,day:s.day,instant:s.selectedStart,
  createdAt:Date.now()
 }));}catch(_){}
}
function agendaReadPendingChoice(slug){
 try{
  const saved=JSON.parse(localStorage.getItem(agendaPendingKey)||'null');
  if(!saved)return null;
  if(saved.slug!==slug||!agendaSlugPattern.test(saved.slug)||
   !agendaUuid.test(saved.serviceId)||
   (saved.staffId&&!agendaUuid.test(saved.staffId))||
   !/^\d{4}-\d{2}-\d{2}$/.test(String(saved.day||''))||
   saved.day<agendaToday()||saved.day>agendaToday(30)||
   !Number.isFinite(Date.parse(saved.instant))||
   !Number.isFinite(saved.createdAt)||
   saved.createdAt>Date.now()+60000||Date.now()-saved.createdAt>3600000){
   agendaClearPendingChoice();return null;
  }
  return saved;
 }catch(_){agendaClearPendingChoice();return null;}
}
function agendaSuggestedName(user){
 const name=String(user?.user_metadata?.full_name||user?.user_metadata?.name||'').trim();
 return name.length>=2&&name.length<=90?name:'';
}
function agendaSuggestedPhone(user){
 const phone=String(user?.phone||'').trim();
 return /^\+?[0-9 ()-]{8,25}$/.test(phone)?phone:'';
}
function agendaNote(){
 const s=agendaRuntime;
 return (s.notice?'<p class="agenda-note" role="status">'+esc(s.notice)+'</p>':'')+
 (s.error?'<p class="agenda-error" role="alert">'+esc(s.error)+'</p>':'');
}
function agendaPhotoStrip(paths){
 const images=(Array.isArray(paths)?paths:[]).slice(0,6).map(path=>{
  const src=agendaPhotoUrl(path);
  return src?'<img loading="lazy" src="'+esc(src)+'" alt="Foto enviada pelo profissional">':'';
 }).filter(Boolean).join('');
 return images?'<div class="agenda-photo-strip">'+images+'</div>':'';
}
function agendaLoginForm(){
 const s=agendaRuntime;
 return '<form class="agenda-login" onsubmit="return agendaLogin(event)">'+
  '<label>E-mail para acessar<input type="email" name="email" maxlength="254" required autocomplete="email" placeholder="voce@exemplo.com"></label>'+
  '<button type="submit" class="primary"'+(s.busy?' disabled':'')+'>Receber link de acesso</button>'+
  '<p class="tiny muted">Você recebe um link por e-mail. Não precisa criar uma senha.</p></form>';
}
function agendaQuickStartView(){
 const s=agendaRuntime;
 return '<section class="agenda-panel agenda-quick-start">'+
  '<span class="section-kicker">COMECE EM POUCOS PASSOS</span>'+
  '<h2>Crie sua agenda grátis</h2>'+
  '<p>Informe o essencial. Seu link, a página e os primeiros horários serão preparados automaticamente.</p>'+
  '<form id="agenda-quick-form" onsubmit="return agendaQuickCreate(event)">'+
   '<label>Nome do negócio<input name="business" required autofocus minlength="3" maxlength="100" autocomplete="organization" placeholder="Ex.: Barbearia do João"></label>'+
   '<label>Cidade<input name="city" required minlength="2" maxlength="100" value="São Gabriel" autocomplete="address-level2"></label>'+
   '<div class="agenda-form-split">'+
    '<label>Primeiro serviço<input name="service" required minlength="3" maxlength="100" placeholder="Ex.: Corte masculino"></label>'+
    '<label>Preço (R$)<input name="price" required type="number" inputmode="decimal" min="0" max="20000" step=".01" placeholder="Ex.: 35,00"></label>'+
   '</div>'+
   '<div class="agenda-form-split">'+
    '<label>Duração<select name="duration">'+[15,30,45,60,75,90,120,150,180,240].map(m=>
     '<option value="'+m+'"'+(m===30?' selected':'')+'>'+m+' minutos</option>').join('')+'</select></label>'+
    '<label>Quando atende<select name="schedule">'+
     '<option value="week_sat">Seg–sex 9h–18h, sáb 9h–13h</option>'+
     '<option value="weekdays">Seg–sex 9h–18h</option>'+
     '<option value="all_week">Todos os dias 9h–18h</option></select></label>'+
   '</div>'+
   '<p class="agenda-quick-hint">Você pode mudar tudo depois. Sem mensalidade e sem cobrar sinal de seus clientes.</p>'+
   '<button type="submit" class="primary"'+(s.busy?' disabled':'')+'>Criar e publicar minha agenda</button>'+
  '</form></section>';
}
function agendaOwnerEditor(){
 const s=agendaRuntime,p=s.page||{},link=p.published&&p.slug?agendaShareLink(p.slug):'';
 if(!p.id)return agendaQuickStartView();
 const photo=(p.photo_paths||[]).length;
 const allDays=agendaDays.map((label,i)=>{
  const found=s.hours.find(h=>h.weekday===i);
  const hh=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
  return '<div class="agenda-day"><label class="agenda-day-check"><input type="checkbox" name="open_'+i+'"'+(found?' checked':'')+'> '+label+'</label>'+
   '<label>Das <input aria-label="Início '+label+'" type="time" name="start_'+i+'" step="1800" value="'+hh(found?.opens_min??540)+'"></label>'+
   '<label>Até <input aria-label="Fim '+label+'" type="time" name="end_'+i+'" step="1800" value="'+hh(found?.closes_min??1080)+'"></label></div>';
 }).join('');
 const serviceCards=s.services.map(service=>
  '<form class="agenda-service-row" data-id="'+esc(service.id)+'" onsubmit="return agendaSaveService(event)">'+
  '<label>Serviço<input name="title" required minlength="3" maxlength="100" value="'+esc(service.title)+'"></label>'+
  '<label>Duração<select name="duration">'+[15,30,45,60,75,90,120,150,180,240].map(m=>
    '<option value="'+m+'"'+(Number(service.duration_min)===m?' selected':'')+'>'+m+' min</option>').join('')+'</select></label>'+
  '<label>Preço R$<input name="price" inputmode="decimal" type="number" step=".01" min="0" max="20000" value="'+(service.price_cents/100).toFixed(2)+'"></label>'+
  '<button class="secondary" type="submit"'+(s.busy?' disabled':'')+'>Salvar</button>'+
  '<button class="secondary" type="button" onclick="agendaToggleService(\''+esc(service.id)+'\')"'+(s.busy?' disabled':'')+'>'+ (service.active?'Pausar':'Reativar')+'</button></form>'
 ).join('');
 const ready=!!p.published && s.services.some(x=>x.active)&&s.hours.length>0;
 const upcoming=s.bookings.filter(x=>x.status==='confirmed'&&Date.parse(x.starts_at)>Date.now()).length;
 return '<div class="agenda-owner-grid">'+
  '<section class="agenda-panel agenda-owner-overview">'+
   '<span class="section-kicker">MINHA AGENDA</span>'+
   '<h2>'+esc(p.title)+'</h2>'+
   '<p class="agenda-status">'+(ready?'Sua agenda está pronta para receber clientes.':
    'Faltam alguns ajustes para receber novos agendamentos.')+'</p>'+
   '<div class="agenda-overview-stats">'+
    '<span><strong>'+upcoming+'</strong> próximas reservas</span>'+
    '<span><strong>'+s.services.filter(x=>x.active).length+'</strong> serviços</span>'+
    '<span><strong>'+s.hours.length+'</strong> dias de atendimento</span>'+
   '</div>'+
   (link&&ready?'<p class="agenda-link">Seu link: <a href="'+esc(link)+'">'+esc(link)+'</a></p>'+
    '<div class="agenda-overview-actions">'+
     '<button type="button" class="primary" onclick="agendaSharePublicLink()">Compartilhar agenda</button>'+
     '<button type="button" class="secondary" onclick="agendaCopyLink()">Copiar link</button>'+
     '<a class="agenda-action-link" href="'+esc(link)+'">Ver como cliente</a></div>':
    '<p class="tiny muted">Adicione um serviço, defina os horários e publique nos ajustes da página.</p>')+
  '</section>'+
  '<section class="agenda-panel"><h2>Serviços e preços</h2>'+
   (p.id?'<form class="agenda-service-row" onsubmit="return agendaSaveService(event)">'+
    '<label>Serviço<input required minlength="3" maxlength="100" name="title" placeholder="Ex.: Corte masculino"></label>'+
    '<label>Duração<select name="duration">'+[15,30,45,60,75,90,120,150,180,240].map(m=>'<option value="'+m+'"'+(m===30?' selected':'')+'>'+m+' min</option>').join('')+'</select></label>'+
    '<label>Preço R$<input type="number" name="price" inputmode="decimal" min="0" max="20000" step=".01" required value="0.00"></label>'+
    '<button class="primary" type="submit"'+(s.busy?' disabled':'')+'>Adicionar serviço</button></form>'+serviceCards:
    '<p>Salve sua página para adicionar os serviços.</p>')+
  '</section>'+
  '<details class="agenda-hours-wrap"'+(s.hoursOpen||!s.hours.length?' open':'')+
   ' ontoggle="agendaRememberPanel(\'hours\',this.open)"><summary>Horários de atendimento • '+s.hours.length+' dias por semana</summary>'+ 
  '<section class="agenda-panel"><h2>Meus horários</h2><p>Marque os dias em que atende. Horários ocupados ficam indisponíveis automaticamente.</p>'+
   (p.id?'<form onsubmit="return agendaSaveHours(event)">'+allDays+
    '<button type="submit" class="primary"'+(s.busy?' disabled':'')+'>Salvar horários</button></form>':
    '<p>Salve sua página para configurar a agenda.</p>')+'</section>'+
  '</details>'+ 
  '<section class="agenda-panel"><h2>Atendimentos e histórico</h2>'+
   '<p>'+s.bookings.filter(b=>b.status==='completed').length+' concluídos • '+
     s.bookings.filter(b=>b.status==='no_show').length+' ausências registradas • '+
     s.waiting.length+' na lista de espera (período recente).</p>'+
   (s.bookings.length?s.bookings.map(b=>{
    const serv=s.services.find(x=>x.id===b.service_id);
    const colleague=s.staff.find(x=>x.id===b.staff_id);
    const past=Date.parse(b.ends_at)<=Date.now();
    const upcoming=Date.parse(b.starts_at)>Date.now();
    return '<article class="agenda-booking"><strong>'+esc(b.customer_name)+'</strong>'+
     '<span>'+esc([serv?.title||'Atendimento',colleague?.name,agendaDateTime(b.starts_at)].filter(Boolean).join(' • '))+'</span>'+
     '<span>'+esc(b.status==='completed'?'Concluído':b.status==='no_show'?'Não compareceu':'Confirmado')+'</span>'+
     (b.customer_phone?'<span>Contato: '+esc(b.customer_phone)+'</span>':'')+
     (b.status==='confirmed'&&b.customer_phone&&/^\+?[0-9 ()-]{8,25}$/.test(b.customer_phone)?
      '<a class="agenda-wa" href="https://wa.me/'+esc(b.customer_phone.replace(/\D/g,''))+
      '?text='+encodeURIComponent('Olá, '+b.customer_name+'! Este é um lembrete do seu horário em '+agendaDateTime(b.starts_at)+'.')+
      '" target="_blank" rel="noopener noreferrer">Enviar lembrete pelo WhatsApp</a>':'')+
     (b.status==='confirmed'?'<button type="button" class="secondary" onclick="agendaDownloadCalendar(\''+esc(b.id)+'\')">Adicionar ao calendário</button>':'')+
     (b.status==='confirmed'&&b.reschedule_count<20&&upcoming?'<button type="button" class="secondary" onclick="agendaBeginReschedule(\''+esc(b.id)+'\')">Remarcar</button>':'')+
     (b.status==='confirmed'&&!past?'<button type="button" class="secondary" onclick="agendaCancel(\''+esc(b.id)+'\')">Cancelar horário</button>':'')+
     (b.status==='confirmed'&&past?'<button type="button" class="secondary" onclick="agendaMarkAttendance(\''+esc(b.id)+'\',\'completed\')">Concluído</button>'+
      '<button type="button" class="secondary" onclick="agendaMarkAttendance(\''+esc(b.id)+'\',\'no_show\')">Não compareceu</button>':'')+
      '</article>';
   }).join(''):'<p>Quando receber um agendamento, ele aparecerá aqui.</p>')+
  '</section>'+
  '<section class="agenda-panel"><h2>Lista de espera</h2>'+
   '<p>Quando não encontrarem horário, os clientes podem deixar contato voluntariamente. Você entra em contato pelo WhatsApp, sem disparos automáticos.</p>'+
   (s.waiting.length?'<div class="agenda-waiting-list">'+s.waiting.map(w=>{
    const service=s.services.find(x=>x.id===w.service_id);
    const member=s.staff.find(x=>x.id===w.staff_id);
    const digits=String(w.customer_phone||'').replace(/\D/g,'');
    const message='Olá, '+w.customer_name+'! Surgiu uma possibilidade para '+(service?.title||'seu atendimento')+' em '+agendaDateOnly(w.day)+'. Veja os horários disponíveis na agenda: '+(link||'');
    return '<article class="agenda-booking"><strong>'+esc(w.customer_name)+'</strong>'+
     '<span>'+esc([service?.title,member?.name,agendaDateOnly(w.day)].filter(Boolean).join(' • '))+'</span>'+
     (digits.length>=8?'<a class="agenda-wa" target="_blank" rel="noopener noreferrer" href="https://wa.me/'+esc(digits)+'?text='+encodeURIComponent(message)+'">Falar pelo WhatsApp</a>':'')+
     '<button type="button" class="secondary" data-id="'+esc(w.id)+
     '" onclick="agendaCloseWaitlist(this.dataset.id,true)">Marcar como contatado</button>'+
     '<button type="button" class="secondary" data-id="'+esc(w.id)+
     '" onclick="agendaCloseWaitlist(this.dataset.id,false)">Remover da fila</button></article>';
   }).join('')+'</div>':'<p>Nenhuma pessoa na fila de espera neste momento.</p>')+'</section>'+
  '<details class="agenda-more"'+(s.advancedOpen||!ready?' open':'')+
   ' ontoggle="agendaRememberPanel(\'advanced\',this.open)"><summary>Personalizar página, equipe e ajustes opcionais</summary>'+ 
  '<div class="agenda-more-grid">'+
  '<section class="agenda-panel"><h2>Minha página</h2><p>Apresente seu trabalho e compartilhe o link com seus clientes.</p>'+
  '<form id="agenda-profile-form" onsubmit="return agendaSaveProfile(event)">'+
   '<label>Nome do estabelecimento<input required minlength="3" maxlength="100" name="title" value="'+esc(p.title||'')+'" placeholder="Ex.: Barbearia do João"></label>'+
   '<label>Link personalizado<input required minlength="4" maxlength="60" pattern="[a-z0-9]+(-[a-z0-9]+)*" name="slug" value="'+esc(p.slug||'')+'" placeholder="barbearia-do-joao"></label>'+
   '<label>Apresentação<textarea name="about" maxlength="1000" rows="3">'+esc(p.about||'')+'</textarea></label>'+
   '<label>Cidade<input name="city" minlength="2" maxlength="100" required value="'+esc(p.city||'São Gabriel')+'"></label>'+
   '<label>Bairro ou região (opcional)<input maxlength="120" name="public_area" value="'+esc(p.public_area||'')+'"></label>'+
   '<label>WhatsApp com DDI (opcional)<input name="whatsapp" type="tel" pattern="\+[1-9][0-9]{7,14}" value="'+esc(p.whatsapp_e164||'')+'" placeholder="+5555999999999"></label>'+
   '<label>Fotos da página (até 6 imagens, JPG/PNG/WebP, 5 MB por imagem)<input type="file" name="photo" accept="image/jpeg,image/png,image/webp"'+(photo>=6?' disabled':'')+'></label>'+
   agendaPhotoStrip(p.photo_paths)+
   '<label class="agenda-publish"><input type="checkbox" name="published"'+(p.published?' checked':'')+'> Disponibilizar minha página para agendamentos</label>'+
   '<button type="submit" class="primary"'+(s.busy?' disabled':'')+'>Salvar minha página</button>'+
  '</form>'+(link?'<p class="agenda-link">Seu link: <a href="'+esc(link)+'">'+esc(link)+'</a></p>'+
   '<button type="button" class="secondary" onclick="agendaCopyLink()">Copiar link</button> '+
    '<button type="button" class="secondary" onclick="agendaSharePublicLink()">Compartilhar</button> '+
    '<button type="button" class="secondary" onclick="agendaToggleQr()">Mostrar QR Code</button>'+ 
    (s.qrOpen?'<div class="agenda-qr-card"><p>Escaneie para abrir minha agenda</p>'+agendaQrMarkup(p.slug)+
     '<button type="button" class="secondary" onclick="agendaDownloadQr()">Salvar QR Code</button></div>':''):'')+
  '<p class="tiny muted">A página é gratuita. Por enquanto, reservas não recebem sinal antecipado.</p></section>'+
  '<section class="agenda-panel"><h2>Equipe e agendas simultâneas</h2>'+
   '<p>Cadastre até 12 colaboradores. Cada um terá horários livres independentes, dentro do expediente geral do estabelecimento.</p>'+
   (p.id?'<form class="agenda-staff-add" onsubmit="return agendaSaveStaff(event)">'+
    '<label>Nome do colaborador<input name="name" required minlength="2" maxlength="70" placeholder="Ex.: Ana"></label>'+
    '<button type="submit" class="primary"'+(s.busy||s.staff.length>=12?' disabled':'')+'>Adicionar colaborador</button></form>'+
    (s.staff.length?'<div class="agenda-staff-list">'+s.staff.map(t=>
     '<div><strong>'+esc(t.name)+'</strong><span>'+(t.active?'Recebendo agendamentos':'Pausado')+'</span>'+
     '<button type="button" class="secondary" data-staff="'+esc(t.id)+
     '" onclick="agendaToggleStaff(this.dataset.staff)">'+(t.active?'Pausar agenda':'Reativar')+'</button></div>').join('')+'</div>':
     '<p class="tiny muted">Sem equipe cadastrada, a agenda individual permanece disponível.</p>'):
    '<p>Salve a página para cadastrar colaboradores.</p>')+'</section>'+
  '<section class="agenda-panel"><h2>Folgas e dias indisponíveis</h2>'+
   '<p>Marque férias, feriados e outros dias sem atendimento. Horários já reservados devem ser tratados antes do bloqueio.</p>'+
   (p.id?'<form onsubmit="return agendaAddClosedDay(event)">'+
    '<label>Dia sem atendimento<input type="date" name="day" required min="'+agendaToday()+'" max="'+agendaToday(180)+'"></label>'+
    '<button type="submit" class="secondary"'+(s.busy?' disabled':'')+'>Bloquear este dia</button></form>'+
    (s.closedDays.length?'<div class="agenda-closed-list">'+s.closedDays.map(d=>
     '<div><span>'+esc(agendaDateOnly(d.day))+'</span>'+
     '<button type="button" class="secondary" data-day="'+esc(d.day)+'" onclick="agendaSetClosedDay(this.dataset.day,false)">Liberar dia</button></div>').join('')+'</div>':
     '<p class="tiny muted">Nenhuma folga programada.</p>'):
    '<p>Salve sua página para escolher suas folgas.</p>')+
  '</section>'+
  '<section class="agenda-panel"><h2>Intervalos e pausas</h2>'+
   '<p>Bloqueie um almoço, reunião ou compromisso para toda a equipe ou uma pessoa. Horários já reservados permanecem protegidos.</p>'+
   (p.id?'<form class="agenda-block-form" onsubmit="return agendaAddBlock(event)">'+
    '<label>Agenda<select name="staff"><option value="">Todo o estabelecimento</option>'+
      s.staff.filter(t=>t.active).map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('')+'</select></label>'+
    '<label>Dia<input type="date" name="day" min="'+agendaToday()+'" max="'+agendaToday(180)+'" required></label>'+
    '<label>Início<input type="time" name="start" step="1800" value="12:00" required></label>'+
    '<label>Fim<input type="time" name="end" step="1800" value="13:00" required></label>'+
    '<button class="secondary" type="submit"'+(s.busy?' disabled':'')+'>Bloquear intervalo</button></form>'+
    (s.blocks.length?'<div class="agenda-staff-list">'+s.blocks.map(b=>{
      const member=s.staff.find(t=>t.id===b.staff_id);
      return '<div><strong>'+esc(member?.name||'Todo o estabelecimento')+'</strong>'+
       '<span>'+esc(agendaDateTime(b.starts_at))+' — '+esc(agendaDateTime(b.ends_at))+'</span>'+
       '<button type="button" class="secondary" data-id="'+esc(b.id)+
       '" onclick="agendaRemoveBlock(this.dataset.id)">Liberar</button></div>';
     }).join('')+'</div>':'<p class="tiny muted">Nenhuma pausa futura cadastrada.</p>'):
     '<p>Salve a página para programar pausas.</p>')+'</section>'+
  '<section class="agenda-panel"><h2>Condições de sinal dos serviços</h2>'+
   '<p>Planeje um sinal opcional para a futura cobrança online, abatido do total do serviço. Os valores abaixo são apenas uma prévia: não existe cobrança de sinal ativa.</p>'+
   (s.services.length?s.services.map(service=>{
    const policy=s.depositSettings.find(x=>x.service_id===service.id);
    const percent=Number(policy?.percent)||0;
    const signal=Math.round(Number(service.price_cents||0)*percent/100);
    const defaultText='O sinal, quando disponível, abate do preço total. As condições de cancelamento e reembolso devem respeitar os direitos do consumidor.';
    return '<form class="agenda-deposit-form" data-id="'+esc(service.id)+
      '" onsubmit="return agendaSaveDepositPolicy(event)">'+
      '<h3>'+esc(service.title)+'</h3>'+
      '<label>Sinal pretendido<select name="percent">'+
       [0,10,20,25,30,50].map(v=>'<option value="'+v+'"'+(v===percent?' selected':'')+'>'+
        (v===0?'Sem sinal':v+'% do valor do serviço')+'</option>').join('')+'</select></label>'+
      '<p class="agenda-deposit-estimate">Preço '+agendaMoney(service.price_cents)+
       ' • Sinal estimado '+agendaMoney(signal)+' • Restante '+agendaMoney(service.price_cents-signal)+'</p>'+
      '<label>Política de cancelamento e reembolso<textarea name="policy" rows="3" minlength="30" maxlength="500" required>'+
        esc(policy?.policy_text||defaultText)+'</textarea></label>'+
      '<p class="tiny muted">Simulação: não emite Pix, não debita cartão e não transforma reservas gratuitas em pagas.</p>'+
      '<button type="submit" class="secondary"'+(s.busy?' disabled':'')+'>Salvar condições</button></form>';
   }).join(''):'<p>Cadastre um serviço para configurar as condições.</p>')+
  '</section>'+
  '</div></details></div>';
}
function agendaDateOnly(value){
 return /^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?String(value).split('-').reverse().join('/'):'Data inválida';
}
function agendaIcsEscape(value){
 return String(value??'').slice(0,320).replace(/\r\n?/g,'\n').replace(/\\/g,'\\\\')
  .replace(/\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
}
function agendaIcsContent(booking,title){
 const start=new Date(booking?.starts_at),end=new Date(booking?.ends_at);
 if(!agendaUuid.test(String(booking?.id||''))||!Number.isFinite(start.valueOf())||
  !Number.isFinite(end.valueOf())||end<=start)return '';
 const stamp=d=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//TAMAO//Agenda//PT-BR',
  'CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',
  'UID:'+booking.id+'@tamao.com.br','DTSTAMP:'+stamp(new Date()),
  'DTSTART:'+stamp(start),'DTEND:'+stamp(end),
  'SEQUENCE:'+Math.max(0,Math.min(20,Number(booking.reschedule_count)||0)),
  'SUMMARY:'+agendaIcsEscape(title||'Atendimento no TAMÃO'),
  'DESCRIPTION:'+agendaIcsEscape('Reserva confirmada. Consulte TAMÃO Agenda para cancelar ou reagendar.'),
  'BEGIN:VALARM','TRIGGER:-PT1H','ACTION:DISPLAY',
  'DESCRIPTION:Lembrete do atendimento','END:VALARM',
  'END:VEVENT','END:VCALENDAR',''].join('\r\n');
}
function agendaDownloadCalendar(id){
 const s=agendaRuntime,b=[...s.mine,...s.bookings].find(x=>x.id===id);
 if(!b||b.status!=='confirmed')return;
 const service=s.services.find(x=>x.id===b.service_id);
 const label=service?.title||b.service_title||'Atendimento';
 const title=b.page_title?label+' — '+b.page_title+(b.staff_title?' ('+b.staff_title+')':''):'Atendimento: '+label;
 const data=agendaIcsContent(b,title);
 if(!data)return;
 const url=URL.createObjectURL(new Blob([data],{type:'text/calendar;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download='tamao-agenda-'+id+'.ics';
 document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function agendaDateTime(value){
 try{return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',
  day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));}
 catch{return 'Data indisponível';}
}
function agendaDepositQuoteView(q){
 // Until professional OAuth and financial reconciliation are homologated,
 // planned percentages belong only in the owner's editor.
 return '<p class="agenda-deposit-summary">Agendamento gratuito, sem sinal antecipado. O valor do serviço é pago diretamente ao profissional.</p>';
}
function agendaPublicView(){
 const s=agendaRuntime,p=s.publicProfile;
 if(!p)return '<section class="agenda-panel"><h1>Página não disponível</h1><p>Confira o link enviado pelo profissional.</p><a href="/#professionals">Encontrar profissionais</a></section>';
 const service=(p.services||[]).find(x=>x.id===s.serviceId);
 const choices=(p.services||[]).map(x=>
  '<option value="'+esc(x.id)+'"'+(s.serviceId===x.id?' selected':'')+'>'+esc(x.title)+' — '+agendaMoney(x.price_cents)+'</option>').join('');
 const date=s.day||agendaToday();
 const dateShortcuts=[['Hoje',agendaToday()],['Amanhã',agendaToday(1)],['Depois',agendaToday(2)]];
 const isReschedule=!!s.rescheduleId;
 const slots=s.slots.map(x=>
  '<button type="button" class="'+(s.selectedStart===x.starts_at?'primary':'secondary')+
  '" aria-pressed="'+(s.selectedStart===x.starts_at)+'" onclick="agendaSelectSlot(\''+esc(x.starts_at)+'\')">'+esc(x.label)+'</button>').join('');
 const waitingAlready=s.myWaiting.some(w=>w.service_id===s.serviceId &&
   (w.staff_id||'')===s.staffId && w.day===date);
 const queueForm=!isReschedule&&!s.slotBusy&&!s.dayClosed&&!s.slots.length&&service ?
   '<div class="agenda-waitlist"><h3>Quer entrar na lista de espera?</h3>'+
    '<p>Deixe um contato e o estabelecimento poderá conversar com você pelo WhatsApp quando surgir uma vaga. A lista não reserva um horário e não envia mensagens automáticas.</p>'+
    (waitingAlready?'<p class="agenda-note">Você já está na fila para esse dia.</p>':
     s.user?'<form onsubmit="return agendaJoinWaitlist(event)">'+
      '<label>Seu nome<input name="name" required minlength="2" maxlength="90" autocomplete="name"></label>'+
      '<label>WhatsApp<input name="phone" type="tel" required minlength="8" maxlength="25" autocomplete="tel"></label>'+
      '<label class="agenda-publish"><input name="consent" type="checkbox" required> Autorizo compartilhar meu nome, WhatsApp e dia desejado com este profissional para contato sobre a vaga.</label>'+
      '<button type="submit" class="secondary"'+(s.busy?' disabled':'')+'>Entrar na lista de espera</button></form>':
     agendaLoginForm())+'</div>':'';
 const form='<section class="agenda-panel"><h2>Escolha seu horário</h2>'+
  '<label>Serviço<select'+(isReschedule?' disabled':'')+' onchange="agendaChooseService(this.value)">'+choices+'</select></label>'+
  (p.staff?.length?'<label>Profissional<select'+(isReschedule?' disabled':'')+' onchange="agendaChooseStaff(this.value)">'+
   p.staff.map(t=>'<option value="'+esc(t.id)+'"'+(s.staffId===t.id?' selected':'')+'>'+esc(t.name)+'</option>').join('')+
   '</select></label>':'')+
  (isReschedule?'<p class="agenda-reschedule-hint">Escolha a nova data e um horário livre para remarcar sua reserva.</p>':'')+
  (service?'<p class="agenda-service-summary">'+esc(service.title)+' • '+service.duration_min+' min • '+agendaMoney(service.price_cents)+'</p>':'')+
  (service?agendaDepositQuoteView(null):'')+
  '<div class="agenda-date-shortcuts" role="group" aria-label="Datas rápidas">'+
   dateShortcuts.map(([label,day])=>'<button type="button" class="'+(date===day?'primary':'secondary')+
    '" aria-pressed="'+(date===day)+'" onclick="agendaChooseDay(\''+day+'\')">'+label+'</button>').join('')+
  '</div>'+
  '<label>Outra data<input type="date" value="'+esc(date)+'" min="'+agendaToday()+'" max="'+agendaToday(30)+'" onchange="agendaChooseDay(this.value)"></label>'+
  '<p class="tiny muted">Horários disponíveis, no fuso de Brasília.</p>'+
  '<div class="agenda-slot-grid" role="group" aria-label="Horários disponíveis">'+
   (s.slotBusy?'<p>Consultando horários…</p>':s.dayClosed?'<p>Não há atendimento neste dia.</p>':slots||'<p>Não há horários livres nesta data.</p>')+'</div>'+
  (!s.slotBusy&&!s.slots.length&&agendaNextDay(date)?
   '<button type="button" class="secondary agenda-next-day" onclick="agendaChooseDay(\''+agendaNextDay(date)+'\')">Ver horários do dia seguinte</button>':'')+
  (s.selectedStart?(s.user?(isReschedule?
   '<div class="agenda-book-form"><h3>Confirme o novo horário</h3><p>'+esc(agendaDateTime(s.selectedStart))+'</p>'+
    '<button type="button" class="primary" onclick="agendaConfirmReschedule()"'+(s.busy?' disabled':'')+'>Confirmar remarcação</button> '+
    '<button type="button" class="secondary" onclick="agendaCancelReschedule()">Desistir</button></div>':
    '<form class="agenda-book-form" onsubmit="return agendaBook(event)">'+
     '<h3>Confirme sua reserva</h3>'+
     '<label>Seu nome<input name="name" minlength="2" maxlength="90" required autocomplete="name" value="'+esc(agendaSuggestedName(s.user))+'"></label>'+
     '<label>WhatsApp para confirmação<input name="phone" type="tel" maxlength="25" minlength="8" required autocomplete="tel" value="'+esc(agendaSuggestedPhone(s.user))+'" placeholder="+55 55 99999-9999"></label>'+
     '<p>'+esc(agendaDateTime(s.selectedStart))+'</p>'+
     '<p class="tiny muted">Seu nome e WhatsApp serão compartilhados com este profissional. Reserva gratuita: nenhum sinal é cobrado pelo TAMÃO nesta versão.</p>'+
     '<button type="submit" class="primary"'+(s.busy?' disabled':'')+'>Confirmar horário gratuitamente</button></form>'):
    '<div class="agenda-login-prompt"><p>Entre pelo seu e-mail para confirmar este horário.</p>'+agendaLoginForm()+'</div>'):'')+
  queueForm+'</section>';
 return '<div class="agenda-public-grid"><section class="agenda-panel agenda-showcase">'+
  '<span class="section-kicker">PROFISSIONAL NO TAMÃO</span><h1>'+esc(p.title)+'</h1>'+
  '<p>'+esc(p.about||'Agende seu atendimento pelo TAMÃO.')+'</p>'+
  '<p>📍 '+esc([p.public_area,p.city].filter(Boolean).join(' • '))+'</p>'+
  agendaPhotoStrip(p.photos)+
  (p.whatsapp?'<a class="secondary agenda-wa" href="https://wa.me/'+encodeURIComponent(p.whatsapp.slice(1))+
    '" target="_blank" rel="noopener noreferrer">Conversar no WhatsApp</a>':'')+
  '</section>'+ (p.services?.length?form:'<section class="agenda-panel"><h2>Em preparação</h2><p>Este profissional ainda não disponibilizou serviços para agendar.</p></section>')+
  '</div>';
}
// Filter only public profiles already returned by the authorized directory RPC.
// Searching never reveals owner contacts or requests extra private records.
function agendaDirectorySearchText(value){
 return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLocaleLowerCase('pt-BR').trim().replace(/\s+/g,' ');
}
function agendaDirectoryMatches(profile,query){
 const tokens=agendaDirectorySearchText(query).slice(0,80).split(' ').filter(Boolean);
 if(!tokens.length)return true;
 const searchable=agendaDirectorySearchText([profile?.title,profile?.city].filter(Boolean).join(' '));
 return tokens.every(token=>searchable.includes(token));
}
function agendaDirectoryFilter(value){
 const s=agendaRuntime;
 s.directoryQuery=String(value||'').slice(0,80);
 const panel=document.getElementById('agenda-directory');
 if(!panel)return 0;
 let visible=0;
 for(const card of panel.querySelectorAll('[data-agenda-directory-card]')){
  const index=Number(card.getAttribute('data-agenda-index'));
  const profile=Number.isSafeInteger(index)&&index>=0?s.directory[index]:null;
  const matches=!!profile&&agendaDirectoryMatches(profile,s.directoryQuery);
  card.hidden=!matches;
  if(matches)visible++;
 }
 const feedback=panel.querySelector('#agenda-directory-result');
 if(feedback)feedback.textContent=agendaDirectoryResultCopy(visible,s.directory.length,s.directoryQuery);
 return visible;
}
function agendaDirectoryResultCopy(visible,total,query){
 if(!String(query||'').trim())return total===1?'1 profissional publicado':'Mostrando '+total+' profissionais publicados';
 return visible===0?'Nenhum profissional corresponde à busca. Tente outro nome ou cidade.':
  visible===1?'1 profissional encontrado':visible+' profissionais encontrados';
}
function agendaDirectoryClearSearch(){
 const input=document.getElementById('agenda-directory-search');
 if(input)input.value='';
 agendaDirectoryFilter('');
 input?.focus();
}
function agendaDirectoryView(){
 const list=agendaRuntime.directory;
 const query=String(agendaRuntime.directoryQuery||'').slice(0,80);
 const count=list.filter(p=>agendaDirectoryMatches(p,query)).length;
 return '<section id="agenda-directory" class="agenda-panel agenda-directory"><h2>Encontre um horário</h2>'+
 (list.length?
  '<p class="agenda-directory-intro">Procure um profissional pelo nome ou pela cidade e consulte os serviços e horários na página dele.</p>'+
  '<div class="agenda-directory-search" role="search">'+
   '<label for="agenda-directory-search">Nome ou cidade</label>'+
   '<div class="agenda-directory-search-row"><input id="agenda-directory-search" type="search" maxlength="80" autocomplete="off"'+
     ' placeholder="Ex.: barbearia ou São Gabriel" aria-controls="agenda-directory-cards" value="'+esc(query)+'"'+
     ' oninput="agendaDirectoryFilter(this.value)">'+
    '<button type="button" class="secondary" onclick="agendaDirectoryClearSearch()">Limpar busca</button></div>'+
  '</div>'+
  '<p id="agenda-directory-result" class="agenda-directory-result" role="status" aria-live="polite">'+
   esc(agendaDirectoryResultCopy(count,list.length,query))+'</p>'+
  '<div id="agenda-directory-cards" class="agenda-list">'+list.map((p,index)=>
   '<a class="agenda-directory-card" data-agenda-directory-card data-agenda-index="'+index+'"'+
    (agendaDirectoryMatches(p,query)?'':' hidden')+
    ' href="'+esc(agendaShareLink(p.slug))+'">'+
    (agendaPhotoUrl(p.photo_path)?'<img class="agenda-directory-photo" loading="lazy" src="'+esc(agendaPhotoUrl(p.photo_path))+'" alt="">':
     '<span class="agenda-directory-placeholder" aria-hidden="true">📅</span>')+
    '<strong>'+esc(p.title)+'</strong><span class="agenda-directory-city">'+esc(p.city)+'</span>'+
    '<span class="agenda-directory-visit">Ver serviços e horários <span aria-hidden="true">→</span></span></a>').join('')+'</div>':
  '<p>As páginas dos profissionais aparecerão aqui assim que disponibilizarem serviços e horários.</p>')+
 '</section>';
}
function agendaMyWaitingView(){
 const s=agendaRuntime;if(!s.user||!s.myWaiting.length)return '';
 return '<section class="agenda-panel"><h2>Minhas listas de espera</h2>'+
  '<p>O estabelecimento poderá chamar pelo WhatsApp. A lista não garante nem confirma horários.</p>'+
  s.myWaiting.map(w=>{
   const member=s.publicProfile?.staff?.find(t=>t.id===w.staff_id);
   return '<article class="agenda-booking"><strong>'+esc(agendaDateOnly(w.day))+'</strong>'+
    '<span>'+esc([member?.name,'Aguardando contato do profissional'].filter(Boolean).join(' • '))+'</span>'+
    '<button type="button" class="secondary" data-id="'+esc(w.id)+
    '" onclick="agendaCloseWaitlist(this.dataset.id,false)">Sair da lista</button></article>';
  }).join('')+'</section>';
}
function agendaMyBookingsView(){
 const s=agendaRuntime;
 if(!s.user||!s.mine.length)return '';
 return '<section class="agenda-panel"><h2>Minhas reservas</h2>'+
  '<p>Seus próximos horários. Você pode cancelar aqui quando precisar.</p>'+
  s.mine.map(b=>{
   const profile=s.publicProfile?.id===b.page_id?s.publicProfile:null;
   const service=profile?.services?.find(x=>x.id===b.service_id);
   return '<article class="agenda-booking"><strong>'+esc(b.page_title||profile?.title||'Atendimento no TAMÃO')+'</strong>'+
    '<span>'+esc([b.service_title||service?.title,b.staff_title,agendaDateTime(b.starts_at)].filter(Boolean).join(' • '))+'</span>'+ 
    (agendaSlugPattern.test(b.slug||'')?'<a class="agenda-wa" href="'+esc(agendaShareLink(b.slug))+'">Ver página do profissional</a>':'')+
    '<button type="button" class="secondary" data-id="'+esc(b.id)+
    '" onclick="agendaDownloadCalendar(this.dataset.id)">Adicionar ao calendário</button>'+ 
    (b.reschedule_count<2?'<button type="button" class="secondary" data-id="'+esc(b.id)+
    '" onclick="agendaBeginReschedule(this.dataset.id)">Remarcar</button>':'')+ 
    '<button type="button" class="secondary" data-id="'+esc(b.id)+
    '" onclick="agendaCancel(this.dataset.id)">Cancelar reserva</button></article>';
  }).join('')+'</section>';
}
function agendaPage(){
 const s=agendaRuntime,slug=agendaSlug();
 const head='<section class="agenda-hero"><div><span class="section-kicker">TAMÃO AGENDA</span>'+
 '<h1>'+ (slug?'Seu próximo atendimento, sem complicação.':(!s.user&&s.directory.length?'Encontre seu próximo horário no TAMÃO.':'Sua agenda organizada. Seus clientes mais perto.'))+'</h1>'+
 '<p>'+(slug?'Escolha um serviço e veja os horários disponíveis em poucos passos.':
  (!s.user&&s.directory.length?'Consulte profissionais e horários. Atende com hora marcada? Você também pode criar sua agenda gratuitamente.':'Tenha uma página exclusiva, organize serviços e receba reservas online — sem mensalidade para começar.'))+'</p></div>'+
 '<a href="'+(slug?'/agenda/':(!s.user&&s.directory.length?'#agenda-directory':'/#professionals'))+'">'+
 (slug?'Ver outras agendas':(!s.user&&s.directory.length?'Escolher um horário':'Explorar profissionais'))+'</a></section>';
 if(s.phase==='idle'||s.phase==='loading')return shell('<section class="section agenda">'+head+'<p>Carregando agenda…</p></section>');
 if(s.phase==='failed')return shell('<section class="section agenda">'+head+agendaNote()+
  '<button type="button" onclick="agendaRetry()">Tentar novamente</button></section>');
 if(slug && s.slug!==slug)return shell('<section class="section agenda">'+head+'<p>Consultando a página do profissional…</p></section>');
 const directoryFirst=!slug&&!s.user&&!s.ownerMode&&!s.page&&s.directory.length>0;
 return shell('<section class="section agenda">'+head+agendaNote()+
  (slug?agendaPublicView()+agendaMyBookingsView()+agendaMyWaitingView():
   (s.ownerMode&&!s.user?
    '<section class="agenda-panel agenda-fast-entry"><h2>Primeiro, confirme seu e-mail</h2>'+
     '<p>Um link de acesso basta. Depois você cria e publica sua agenda rapidamente.</p>'+
     agendaLoginForm()+
     '<button type="button" class="secondary" onclick="agendaStopOwner()">Voltar às agendas</button></section>':
    (directoryFirst?agendaDirectoryView():'')+
    (s.user&&(s.page||s.ownerMode)?agendaOwnerEditor():
     '<div class="agenda-intro"><h2>Atende clientes com hora marcada?</h2>'+
      '<p>Crie sua página, configure seu primeiro serviço e receba reservas online sem mensalidade.</p>'+
      '<button class="primary" type="button" onclick="agendaStartOwner()">Criar minha agenda grátis</button></div>')+
    agendaMyBookingsView()+agendaMyWaitingView()+
    (s.page?'<details class="agenda-other-pages"><summary>Encontrar outros profissionais</summary>'+agendaDirectoryView()+'</details>':
     directoryFirst?'':agendaDirectoryView())+
    (s.user?'<p class="agenda-logout"><button type="button" class="secondary" onclick="agendaLogout()">Sair da conta</button></p>':'')))+
  '</section>');
}
async function agendaInit(){
 const s=agendaRuntime;if(s.phase!=='idle')return;
 s.phase='loading';s.error='';s.epoch++;
 const epoch=s.epoch;
 try{
  const sdk=await loadSupabaseBrowser();
  s.client=sdk.createClient(CHAMA_BACKEND.url,CHAMA_BACKEND.publishableKey,{
   auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'tamao-discovery-auth'},
   global:{fetch:chamaFetch}
  });
  const user=await s.client.auth.getUser();
  if(epoch!==s.epoch)return;
  s.user=user.data?.user||null;
  s.authReady=true;
  s.client.auth.onAuthStateChange((type,session)=>{
   if(type==='SIGNED_OUT'){s.user=null;s.ownerMode=false;s.advancedOpen=false;s.hoursOpen=false;s.page=null;s.services=[];s.staff=[];s.depositSettings=[];s.hours=[];s.bookings=[];s.mine=[];s.waiting=[];s.myWaiting=[];s.blocks=[];s.closedDays=[];s.rescheduleId='';render();return;}
   if(type==='SIGNED_IN'&&session?.user?.id!==s.user?.id){
    s.user=session.user;s.ownerMode=false;s.page=null;s.services=[];s.staff=[];s.depositSettings=[];s.hours=[];s.bookings=[];s.mine=[];s.waiting=[];s.myWaiting=[];s.blocks=[];s.closedDays=[];s.rescheduleId='';
    Promise.resolve().then(()=>agendaRefreshOwner()).then(()=>render()).catch(()=>{});
   }
  });
  s.phase='ready';
  if(s.user)await agendaRefreshOwner();
  if(new URLSearchParams(location.search).get('agenda')==='1'){
   const url=new URL(location.href);const returnSlug=agendaSlug();
   if(url.searchParams.get('criar')==='1'&&!returnSlug)s.ownerMode=true;
   url.searchParams.delete('agenda');url.searchParams.delete('profissional');url.searchParams.delete('criar');
   if(returnSlug&&/^\/agenda(?:\/|$)/.test(location.pathname)){
    // Preserve the verified magic-link session, but restore the clean link.
    history.replaceState(null,'',new URL(agendaShareLink(returnSlug)).pathname);
   }else{
    url.hash='agenda'+(returnSlug?'?profissional='+encodeURIComponent(returnSlug):'');
    history.replaceState(null,'',url.pathname+url.search+url.hash);
   }
  }
  await agendaRefreshPublic();
  if(!agendaSlug())await agendaRefreshDirectory();
 }catch(e){if(epoch===s.epoch){s.phase='failed';s.error='Não foi possível abrir a agenda. Confira sua conexão.';}}
 if(epoch===s.epoch && agendaRoute())render();
}
function agendaRetry(){agendaRuntime.phase='idle';agendaInit();}
function agendaAfterRender(){
 if(!agendaRoute())return;
 const s=agendaRuntime,slug=agendaSlug();
 if(s.phase==='idle')agendaInit();
 else if(s.phase==='ready'&&slug!==s.slug)agendaRefreshPublic().then(()=>render());
}
async function agendaRefreshOwner(){
 const s=agendaRuntime,u=s.user;
 if(!u||!s.client)return;
 const epoch=s.epoch;
 const {data:p,error:e}=await s.client.from('agenda_pages').select('*').eq('owner_id',u.id).maybeSingle();
 if(e)throw e;if(epoch!==s.epoch||s.user?.id!==u.id)return;
 s.page=p;
 if(p){
  const [services,staff,depositSettings,hours,bookings,closedDays,blocks,waiting]=await Promise.all([
   s.client.from('agenda_services').select('*').eq('page_id',p.id).order('created_at'),
   s.client.from('agenda_staff').select('*').eq('page_id',p.id).order('created_at'),
   s.client.from('agenda_service_deposit_settings').select('service_id,percent,policy_text,policy_version').eq('owner_id',u.id).eq('page_id',p.id),
   s.client.from('agenda_hours').select('*').eq('page_id',p.id).order('weekday'),
   s.client.from('agenda_appointments').select('id,page_id,service_id,staff_id,reschedule_count,customer_name,customer_phone,starts_at,ends_at,status')
     .eq('owner_id',u.id).in('status',['confirmed','completed','no_show']).gte('starts_at',new Date(Date.now()-30*86400000).toISOString()).order('starts_at').limit(100),
   s.client.from('agenda_closed_days').select('day').eq('owner_id',u.id).gte('day',agendaToday()).order('day').limit(180),
   s.client.from('agenda_staff_blocks').select('id,staff_id,starts_at,ends_at').eq('owner_id',u.id).gte('ends_at',new Date().toISOString()).order('starts_at').limit(100),
   s.client.from('agenda_waitlist').select('id,service_id,staff_id,day,customer_name,customer_phone,created_at').eq('owner_id',u.id).eq('status','waiting').gte('day',agendaToday()).order('created_at').limit(100)
  ]);
  if(epoch!==s.epoch||s.user?.id!==u.id)return;
  if(services.error||staff.error||depositSettings.error||hours.error||bookings.error||closedDays.error||blocks.error||waiting.error)throw services.error||staff.error||depositSettings.error||hours.error||bookings.error||closedDays.error||blocks.error||waiting.error;
  s.services=services.data||[];s.staff=staff.data||[];s.depositSettings=depositSettings.data||[];s.hours=hours.data||[];s.bookings=bookings.data||[];s.closedDays=closedDays.data||[];s.blocks=blocks.data||[];s.waiting=waiting.data||[];
 }else{s.services=[];s.staff=[];s.depositSettings=[];s.hours=[];s.bookings=[];s.closedDays=[];s.blocks=[];s.waiting=[];}
 const mine=await s.client.rpc('agenda_my_bookings');
 if(epoch===s.epoch&&s.user?.id===u.id&&!mine.error)s.mine=mine.data||[];
 const queue=await s.client.from('agenda_waitlist').select('id,page_id,service_id,staff_id,day,created_at').eq('customer_id',u.id).eq('status','waiting').gte('day',agendaToday()).order('day').limit(12);
 if(epoch===s.epoch&&s.user?.id===u.id&&!queue.error)s.myWaiting=queue.data||[];
}
async function agendaRefreshDirectory(){
 const s=agendaRuntime;
 try{
  const {data,error}=await s.client.rpc('agenda_public_directory');
  if(!error&&Array.isArray(data))s.directory=data.filter(p=>
   agendaSlugPattern.test(String(p.slug||''))&&
   typeof p.title==='string'&&typeof p.city==='string').slice(0,24);
 }catch(_){/* Discovery remains optional while the new schema is rolling out. */}
}
function agendaPageIdentity(profile){
 if(typeof document==='undefined')return;
 const valid=profile&&agendaSlugPattern.test(String(profile.slug||''))&&String(profile.slug).length<=60;
 const name=valid?String(profile.title||'').trim().slice(0,100):'';
 document.title=name?name+' | TAMÃO Agenda':'TAMÃO Agenda — Agendamentos para profissionais';
 const canonical=document.querySelector('link[rel="canonical"]');
 if(canonical)canonical.href=valid?agendaShareLink(profile.slug):'https://tamao.com.br/agenda/';
}
async function agendaRefreshPublic(){
 const s=agendaRuntime,slug=agendaSlug();s.slug=slug;s.publicProfile=null;
 agendaPageIdentity(null);
 s.serviceId='';s.staffId='';s.selectedStart='';s.slots=[];s.day=agendaToday();s.requestKey='';
 if(!slug||!s.client)return;
 const {data,error}=await s.client.rpc('agenda_public_page',{p_slug:slug});
 if(!agendaRoute()||agendaSlug()!==slug)return;
 if(error){s.error='Não foi possível consultar este profissional.';return;}
 s.publicProfile=data||null;
 agendaPageIdentity(s.publicProfile);
 const editing=s.rescheduleId?[...s.mine,...s.bookings].find(x=>x.id===s.rescheduleId&&x.page_id===data?.id):null;
 const pending=!editing&&s.user?agendaReadPendingChoice(slug):null;
 if(s.rescheduleId&&!editing)s.rescheduleId='';
 s.serviceId=editing?.service_id||
  ((data?.services||[]).some(x=>x.id===pending?.serviceId)?pending.serviceId:(data?.services||[])[0]?.id)||'';
 s.staffId=editing?(editing.staff_id||''):
  ((data?.staff||[]).some(x=>x.id===pending?.staffId)?pending.staffId:(data?.staff||[])[0]?.id)||'';
 if(pending)s.day=pending.day;
 if(s.serviceId)await agendaLoadSlots();
 // A previous choice is never a booking; always verify it is still available.
 if(pending&&s.serviceId===pending.serviceId&&s.staffId===(pending.staffId||'')&&
  s.slots.some(x=>x.starts_at===pending.instant)){
  s.selectedStart=pending.instant;s.requestKey=crypto.randomUUID();
 }
 if(pending)agendaClearPendingChoice();
}
async function agendaLoadSlots(){
 const s=agendaRuntime,service=s.serviceId,day=s.day,staffId=s.staffId;
 s.selectedStart='';s.requestKey='';s.slots=[];s.paymentQuote=null;s.dayClosed=false;if(!service||!day)return;
 s.slotBusy=true;render();
 try{
  const [slots,closed]=await Promise.all([
   s.client.rpc('agenda_available_staff_slots',{p_service_id:service,p_day:day,p_staff_id:staffId||null}),
   s.client.rpc('agenda_day_is_closed',{p_service_id:service,p_day:day})
  ]);
  if(s.serviceId!==service||s.day!==day||s.staffId!==staffId)return;
  if(slots.error||closed.error)throw slots.error||closed.error;
  s.dayClosed=closed.data===true;

  s.slots=(s.dayClosed?[]:(slots.data||[])).filter(x=>typeof x?.starts_at==='string'&&
   Number.isFinite(Date.parse(x.starts_at))&&/^\d{2}:\d{2}$/.test(x.label)).slice(0,36);
 }catch(e){s.error='Não foi possível consultar horários. Tente outra data.';}
 finally{if(s.serviceId===service&&s.day===day&&s.staffId===staffId){s.slotBusy=false;if(agendaRoute())render();}}
}
function agendaChooseService(id){const s=agendaRuntime;if(s.rescheduleId||!(s.publicProfile?.services||[]).some(x=>x.id===id))return;
 s.serviceId=id;s.error='';agendaClearPendingChoice();agendaLoadSlots();}
function agendaChooseStaff(id){const s=agendaRuntime;if(s.rescheduleId)return;
 if(!(s.publicProfile?.staff||[]).some(x=>x.id===id))return;
 s.staffId=id;s.error='';agendaClearPendingChoice();agendaLoadSlots();}
function agendaChooseDay(day){const s=agendaRuntime;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(day)))return;
 if(day<agendaToday()||day>agendaToday(30))return;
 s.day=day;s.error='';agendaClearPendingChoice();agendaLoadSlots();}
function agendaSelectSlot(instant){
 const s=agendaRuntime;if(!s.slots.some(x=>x.starts_at===instant))return;
 s.selectedStart=instant;s.requestKey=crypto.randomUUID();s.error='';
 agendaRememberPendingChoice();render();
}
async function agendaLogin(ev){
 ev.preventDefault();const s=agendaRuntime;
 const email=String(new FormData(ev.target).get('email')||'').trim();
 if(s.busy||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||!s.client)return false;
 s.busy=true;s.error='';s.notice='';
 try{
  const slug=agendaSlug();const url=location.origin+'/?agenda=1'+
   (slug?'&profissional='+encodeURIComponent(slug):(s.ownerMode?'&criar=1':''));
  const {error}=await s.client.auth.signInWithOtp({email,options:{emailRedirectTo:url}});
  if(error)throw error;
  s.notice='Enviamos um link de acesso para seu e-mail.';
 }catch(e){s.error='Não foi possível enviar o link. Confira o e-mail e tente novamente.';}
 s.busy=false;render();return false;
}
async function agendaQuickCreate(ev){
 ev.preventDefault();
 const s=agendaRuntime;
 if(s.busy||!s.client||!s.user||s.page)return false;
 const f=new FormData(ev.target),
  title=String(f.get('business')||'').trim(),
  city=String(f.get('city')||'').trim(),
  service=String(f.get('service')||'').trim(),
  duration=Number(f.get('duration')),
  price=Number(f.get('price')),
  schedule=String(f.get('schedule')||'week_sat');
 const cents=Math.round(price*100);
 if(title.length<3||title.length>100||city.length<2||city.length>100||
  service.length<3||service.length>100||![15,30,45,60,75,90,120,150,180,240].includes(duration)||
  !Number.isFinite(price)||price<0||price>20000||
  Math.abs(price*100-cents)>0.000001||
  !['week_sat','weekdays','all_week'].includes(schedule)){
  s.error='Confira o nome, o serviço, o valor e os horários.';render();return false;
 }
 const weekdays=Array.from({length:schedule==='all_week'?7:5},(_,i)=>
  ({weekday:schedule==='all_week'?i:i+1,opens_min:540,closes_min:1080}));
 if(schedule==='week_sat')weekdays.push({weekday:6,opens_min:540,closes_min:780});
 s.busy=true;s.error='';s.notice='';
 let created=false,ready=false;
 try{
  const rawSlug=agendaSafeSlug(title).slice(0,60).replace(/-$/,'')||'meu-negocio';
  // Prefer the establishment name. Add a short suffix only when already used.
  // UNIQUE in PostgreSQL handles concurrent claims safely.
  let page=null;
  for(let attempt=0;attempt<3;attempt++){
   const suffix=attempt?'-'+crypto.randomUUID().replace(/-/g,'').slice(0,6):'';
   const slug=rawSlug.slice(0,60-suffix.length).replace(/-$/,'')+suffix;
   const {data,error}=await s.client.from('agenda_pages').insert({
    slug,title,city,published:false
   }).select('*').single();
   if(!error){page=data;break;}
   if(error.code!=='23505'||attempt===2)throw error;
  }
  // Publish last: incomplete setup must never receive customer bookings.
  if(!page?.id)throw Error('agenda draft was not confirmed');
  created=true;s.page=page;
  const {data:serviceRow,error:serviceError}=await s.client.from('agenda_services').insert({
   page_id:page.id,title:service,duration_min:duration,price_cents:cents
  }).select('id').single();
  if(serviceError||!serviceRow?.id)throw serviceError||Error('service not confirmed');
  const {error:hoursError}=await s.client.rpc('agenda_replace_hours',{
   p_page_id:page.id,p_hours:weekdays
  });
  if(hoursError)throw hoursError;
  const {data:published,error:publishError}=await s.client.from('agenda_pages')
   .update({published:true}).eq('id',page.id).select('*').single();
  if(publishError||!published?.published)throw publishError||Error('publication not confirmed');
  s.page=published;ready=true;
  try{await agendaRefreshOwner();}catch(_){/* Published page is already confirmed. */}
  try{await agendaRefreshDirectory();}catch(_){}
  s.notice='Sua agenda está publicada! Compartilhe o link e comece a receber reservas gratuitas.';
 }catch(e){
  s.error=created?'Sua página foi guardada como rascunho. Complete os passos pendentes nas configurações e publique.':
   (e?.code==='23505'?'Já existe uma agenda nesta conta. Atualize a página.':
    'Não foi possível criar a agenda. Confira os dados e tente novamente.');
  try{await agendaRefreshOwner();}catch(_){}
 }
 if(ready)s.ownerMode=true;
 s.busy=false;render();return false;
}
async function agendaSaveProfile(ev){
 ev.preventDefault();const s=agendaRuntime;if(s.busy||!s.user)return false;
 const form=ev.target,f=new FormData(form);
 const slug=String(f.get('slug')||'').trim();
 if(!agendaSlugPattern.test(slug)||slug.length<4||slug.length>60){s.error='Escolha um link com letras minúsculas, números e hífens.';render();return false;}
 const data={slug,title:String(f.get('title')||'').trim(),about:String(f.get('about')||'').trim(),
  city:String(f.get('city')||'').trim(),public_area:String(f.get('public_area')||'').trim(),
  whatsapp_e164:String(f.get('whatsapp')||'').trim()||null,published:f.get('published')==='on'};
 const file=form.elements.photo.files?.[0]||null;
 if(file&&(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size<1||file.size>5242880)){
  s.error='Selecione uma imagem JPG, PNG ou WebP de até 5 MB.';render();return false;}
 s.busy=true;s.error='';s.notice='';
 try{
  let page=s.page;
  if(page){
   const {data:updated,error}=await s.client.from('agenda_pages').update(data).eq('id',page.id).select('*').single();
   if(error)throw error;page=updated;
  }else{
   const {data:created,error}=await s.client.from('agenda_pages').insert(data).select('*').single();
   if(error)throw error;page=created;s.page=created;
  }
  if(file&&page.photo_paths.length<6){
   const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type];
   const key=s.user.id+'/'+crypto.randomUUID()+'.'+ext;
   const uploaded=await s.client.storage.from('tamao-discovery-photos')
    .upload(key,file,{contentType:file.type,cacheControl:'3600',upsert:false});
   if(uploaded.error)throw uploaded.error;
   const {data:withPhoto,error}=await s.client.from('agenda_pages')
    .update({photo_paths:[...page.photo_paths,key]}).eq('id',page.id).select('*').single();
   if(error)throw error;page=withPhoto;s.page=page;
  }
  await agendaRefreshOwner();
  await agendaRefreshDirectory();
  s.notice='Página salva. '+(page.published?'Seu link está disponível.':'Publique quando desejar receber agendamentos.');
 }catch(e){
  s.error=e?.code==='23505'?'Este link já está em uso. Escolha outro.':
   'Não foi possível concluir tudo. Confira sua página antes de repetir o envio.';
  try{await agendaRefreshOwner();}catch{}
 }
 s.busy=false;render();return false;
}
async function agendaSaveDepositPolicy(ev){
 ev.preventDefault();const s=agendaRuntime;
 if(s.busy||!s.page||!s.user)return false;
 const id=ev.target?.dataset?.id;
 if(!agendaUuid.test(id)||!s.services.some(x=>x.id===id))return false;
 const f=new FormData(ev.target),percent=Number(f.get('percent'));
 const policy=String(f.get('policy')||'').trim();
 if(![0,10,20,25,30,50].includes(percent)||policy.length<30||policy.length>500){
  s.error='Confira o percentual e a política de reembolso.';render();return false;
 }
 s.busy=true;s.error='';s.notice='';
 try{
  const {data,error}=await s.client.rpc('agenda_set_deposit_policy',{
   p_service_id:id,p_percent:percent,p_policy_text:policy
  });
  if(error||data?.service_id!==id||data?.percent!==percent||
    data?.charges_enabled!==false)throw error||Error('policy confirmation invalid');
  await agendaRefreshOwner();
  if(s.serviceId===id)await agendaLoadSlots();
  s.notice='Condições salvas. A cobrança antecipada permanece desligada.';
 }catch(e){s.error='Não foi possível salvar o sinal planejado. Nenhuma cobrança foi iniciada.';}
 s.busy=false;render();return false;
}
async function agendaSaveService(ev){
 ev.preventDefault();const s=agendaRuntime,p=s.page;
 if(s.busy||!p||!s.user)return false;
 const f=new FormData(ev.target),id=ev.target.dataset.id;
 const price=Number(f.get('price')),duration=Number(f.get('duration'));
 if(!Number.isFinite(price)||price<0||price>20000||!Number.isInteger(duration)||duration<15||
  duration>240||duration%15){s.error='Confira preço e duração.';render();return false;}
 const data={title:String(f.get('title')||'').trim(),price_cents:Math.round(price*100),duration_min:duration};
 s.busy=true;s.error='';s.notice='';
 try{
  const result=id?await s.client.from('agenda_services').update(data).eq('id',id).eq('page_id',p.id):
   await s.client.from('agenda_services').insert({...data,page_id:p.id,active:true});
  if(result.error)throw result.error;
  await agendaRefreshOwner();s.notice='Serviço atualizado.';
 }catch(e){s.error='Não foi possível salvar o serviço.';}
 s.busy=false;render();return false;
}
async function agendaToggleService(id){
 const s=agendaRuntime,v=s.services.find(x=>x.id===id);
 if(!v||s.busy)return;
 s.busy=true;s.error='';
 try{
  const {error}=await s.client.from('agenda_services').update({active:!v.active}).eq('id',id).eq('page_id',s.page.id);
  if(error)throw error;await agendaRefreshOwner();s.notice=v.active?'Serviço pausado.':'Serviço reativado.';
 }catch(e){s.error='Não foi possível alterar este serviço.';}
 s.busy=false;render();
}
async function agendaSaveStaff(ev){
 ev.preventDefault();const s=agendaRuntime;
 if(s.busy||!s.page||!s.user||s.staff.length>=12)return false;
 const name=String(new FormData(ev.target).get('name')||'').trim();
 if(name.length<2||name.length>70){s.error='Informe um nome válido.';render();return false;}
 s.busy=true;s.error='';s.notice='';
 try{
  const {error}=await s.client.from('agenda_staff').insert({page_id:s.page.id,name,active:true});
  if(error)throw error;
  await agendaRefreshOwner();s.notice='Colaborador adicionado. Ele já pode receber agendamentos.';
 }catch(e){s.error='Não foi possível cadastrar o colaborador. Verifique sua equipe.';}
 s.busy=false;render();return false;
}
async function agendaToggleStaff(id){
 const s=agendaRuntime,t=s.staff.find(x=>x.id===id);
 if(s.busy||!t||!s.page)return;
 s.busy=true;s.error='';s.notice='';
 try{
  const {error}=await s.client.from('agenda_staff').update({active:!t.active})
   .eq('id',id).eq('page_id',s.page.id);
  if(error)throw error;
  await agendaRefreshOwner();s.notice=t.active?'Agenda do colaborador pausada.':'Agenda do colaborador reativada.';
 }catch(e){
  s.error=e?.message?.includes('AGENDA_STAFF_HAS_BOOKINGS')?
   'Este colaborador tem atendimentos confirmados. Resolva-os antes de pausar a agenda.':
   'Não foi possível atualizar a agenda deste colaborador.';
 }
 s.busy=false;render();
}
function agendaLocalHourToInstant(day,hour){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^\d{2}:\d{2}$/.test(hour))return '';
 // Use timezone data, not the visitor's device clock. Brazil currently UTC-3,
 // but the Intl zone lookup also handles historical/future policy changes.
 const fmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',timeZoneName:'shortOffset'});
 const tz=fmt.formatToParts(new Date(day+'T12:00:00Z')).find(p=>p.type==='timeZoneName')?.value||'';
 const hit=/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(tz);
 if(!hit)return '';
 const offset=(hit[1]==='+'?1:-1)*(Number(hit[2])*60+Number(hit[3]||0));
 const d=new Date(day+'T'+hour+':00Z');
 if(!Number.isFinite(d.valueOf()))return '';
 return new Date(d.valueOf()-offset*60000).toISOString();
}
async function agendaAddBlock(ev){
 ev.preventDefault();const s=agendaRuntime;
 if(s.busy||!s.user||!s.page)return false;
 const f=new FormData(ev.target),day=String(f.get('day')||'');
 const start=agendaLocalHourToInstant(day,String(f.get('start')||''));
 const end=agendaLocalHourToInstant(day,String(f.get('end')||''));
 const staffId=String(f.get('staff')||'');
 if(!start||!end||Date.parse(end)<=Date.parse(start)||Date.parse(end)-Date.parse(start)>12*3600000 ||
  day<agendaToday()||day>agendaToday(180)||staffId&&!s.staff.some(t=>t.id===staffId&&t.active)){
  s.error='Confira o dia, o horário e o colaborador.';render();return false;
 }
 s.busy=true;s.error='';s.notice='';
 try{
  const {data,error}=await s.client.rpc('agenda_add_staff_block',{
   p_staff_id:staffId||null,p_start:start,p_end:end
  });
  if(error||!agendaUuid.test(String(data)))throw error||Error('block unconfirmed');
  await agendaRefreshOwner();
  if(s.serviceId&&day===s.day)await agendaLoadSlots();
  s.notice='Intervalo indisponível cadastrado.';
 }catch(e){
  s.error=e?.message?.includes('AGENDA_BLOCK_HAS_BOOKINGS')?
   'Este intervalo já contém uma reserva confirmada. Resolva o atendimento antes de bloquear.':
   'Não foi possível bloquear o intervalo. Confira sua agenda.';
 }
 s.busy=false;render();return false;
}
async function agendaRemoveBlock(id){
 const s=agendaRuntime;if(s.busy||!s.page||!s.blocks.some(x=>x.id===id))return;
 s.busy=true;s.error='';s.notice='';
 try{
  const {data,error}=await s.client.rpc('agenda_remove_staff_block',{p_id:id});
  if(error||data!==true)throw error||Error('remove unconfirmed');
  await agendaRefreshOwner();
  if(s.serviceId)await agendaLoadSlots();
  s.notice='Intervalo liberado.';
 }catch(e){s.error='Não foi possível liberar este intervalo.';}
 s.busy=false;render();
}
async function agendaJoinWaitlist(ev){
 ev.preventDefault();const s=agendaRuntime;
 if(s.busy||!s.user||!s.publicProfile||!s.serviceId||s.rescheduleId)return false;
 const f=new FormData(ev.target),name=String(f.get('name')||'').trim(),phone=String(f.get('phone')||'').trim();
 if(f.get('consent')!=='on'||name.length<2||name.length>90||
   !/^\+?[0-9 ()-]{8,25}$/.test(phone)){
  s.error='Confira seu nome, WhatsApp e autorização de contato.';render();return false;
 }
 const service=s.serviceId,staff=s.staffId,day=s.day;
 s.busy=true;s.error='';s.notice='';
 try{
  const {data,error}=await s.client.rpc('agenda_join_waitlist',{
   p_service_id:service,p_staff_id:staff||null,p_day:day,p_name:name,p_phone:phone,p_consent:true
  });
  if(error||!agendaUuid.test(String(data)))throw error||Error('waitlist unconfirmed');
  const verify=await s.client.from('agenda_waitlist').select('id,status')
   .eq('id',data).eq('customer_id',s.user.id).maybeSingle();
  if(verify.error||verify.data?.status!=='waiting')throw Error('waitlist readback unavailable');
  await agendaRefreshOwner();
  s.notice='Pedido de contato registrado. O profissional poderá chamar pelo WhatsApp se surgir vaga.';
 }catch(e){
  // A network timeout can commit; never imply the request failed without readback.
  let found=false;
  try{
   let q=s.client.from('agenda_waitlist').select('id').eq('customer_id',s.user.id)
    .eq('service_id',service).eq('day',day).eq('status','waiting');
   q=staff?q.eq('staff_id',staff):q.is('staff_id',null);
   const check=await q.maybeSingle();
   found=!!check.data?.id;
   if(found)await agendaRefreshOwner();
  }catch(_){}
  s.error=found?'':'Não foi possível confirmar sua entrada na fila. Consulte suas listas antes de repetir.';
  if(found)s.notice='Sua participação na lista de espera está registrada.';
 }
 s.busy=false;render();return false;
}
async function agendaCloseWaitlist(id,contacted){
 const s=agendaRuntime;
 if(s.busy||!agendaUuid.test(id)||
  !(s.waiting.some(x=>x.id===id)||(!contacted&&s.myWaiting.some(x=>x.id===id))))return;
 s.busy=true;s.error='';s.notice='';
 try{
  const {data,error}=await s.client.rpc('agenda_close_waitlist',{
   p_wait_id:id,p_contacted:contacted===true
  });
  if(error||data!==true)throw error||Error('close waitlist failed');
  await agendaRefreshOwner();
  s.notice=contacted?'Contato registrado na lista.':'Participação retirada da lista.';
 }catch(e){s.error='Não foi possível alterar a lista. Tente novamente.';}
 s.busy=false;render();
}
async function agendaMarkAttendance(id,result){
 const s=agendaRuntime;
 const booking=s.bookings.find(b=>b.id===id);
 if(s.busy||!booking||booking.status!=='confirmed'||Date.parse(booking.ends_at)>Date.now()||
  !['completed','no_show'].includes(result))return;
 if(result==='no_show'&&!confirm('Registrar que o cliente não compareceu? Esta conclusão não pode ser desfeita pela agenda.'))return;
 s.busy=true;s.error='';s.notice='';
 try{
  const {data,error}=await s.client.rpc('agenda_mark_attendance',{
   p_appointment_id:id,p_result:result
  });
  if(error||data!==true)throw error||Error('attendance unconfirmed');
  const verify=await s.client.from('agenda_appointments').select('id,status').eq('id',id).maybeSingle();
  if(verify.error||verify.data?.status!==result)throw Error('attendance readback unavailable');
  await agendaRefreshOwner();
  s.notice=result==='completed'?'Atendimento concluído registrado.':'Ausência registrada.';
 }catch(e){s.error='Não foi possível confirmar a conclusão. Confira o histórico.';}
 s.busy=false;render();
}
async function agendaSaveHours(ev){
 ev.preventDefault();const s=agendaRuntime;if(s.busy||!s.page)return false;
 const f=new FormData(ev.target),hours=[];
 for(let i=0;i<7;i++){
  if(f.get('open_'+i)!=='on')continue;
  const mins=value=>{const match=/^(\d{2}):(\d{2})$/.exec(String(value||''));return match?Number(match[1])*60+Number(match[2]):NaN;};
  const opens=mins(f.get('start_'+i)),closes=mins(f.get('end_'+i));
  if(!Number.isInteger(opens)||!Number.isInteger(closes)||opens>=closes||opens%30||closes%30||
    opens<0||closes>1440){s.error='Confira o início e o fim do expediente.';render();return false;}
  hours.push({weekday:i,opens_min:opens,closes_min:closes});
 }
 s.busy=true;s.error='';s.notice='';
 try{
  const {error}=await s.client.rpc('agenda_replace_hours',{p_page_id:s.page.id,p_hours:hours});
  if(error)throw error;await agendaRefreshOwner();s.notice='Horários atualizados.';
 }catch(e){s.error='Não foi possível salvar os horários.';}
 s.busy=false;render();return false;
}
async function agendaAddClosedDay(ev){
 ev.preventDefault();
 const day=String(new FormData(ev.target).get('day')||'');
 await agendaSetClosedDay(day,true);return false;
}
async function agendaSetClosedDay(day,closed){
 const s=agendaRuntime;
 if(s.busy||!s.page||!s.user||!/^\d{4}-\d{2}-\d{2}$/.test(day)||
  day<agendaToday()||day>agendaToday(180))return;
 s.busy=true;s.error='';s.notice='';
 try{
  const {data,error}=await s.client.rpc('agenda_set_closed_day',{p_day:day,p_closed:closed});
  if(error||data!==true)throw error||Error('day update unconfirmed');
  await agendaRefreshOwner();
  if(s.serviceId&&s.day===day)await agendaLoadSlots();
  s.notice=closed?'Dia bloqueado para novos agendamentos.':'Dia liberado para agendamentos.';
 }catch(e){
  s.error=e?.message?.includes('AGENDA_DAY_HAS_BOOKINGS')?
   'Este dia já tem reservas confirmadas. Resolva esses atendimentos antes de bloquear.':
   'Não foi possível alterar a folga. Confira sua agenda antes de repetir.';
 }
 s.busy=false;render();
}
async function agendaBook(ev){
 ev.preventDefault();const s=agendaRuntime;
 if(s.busy||s.rescheduleId||!s.user||!s.selectedStart||!agendaUuid.test(s.serviceId))return false;
 const f=new FormData(ev.target),name=String(f.get('name')||'').trim(),phone=String(f.get('phone')||'').trim();
 if(name.length<2||name.length>90){s.error='Informe seu nome.';render();return false;}
 if(!/^\+?[0-9 ()-]{8,25}$/.test(phone)){s.error='Informe um WhatsApp válido para confirmar o horário.';render();return false;}
 if(!s.requestKey)s.requestKey=crypto.randomUUID();
 if((s.publicProfile?.staff||[]).length&& !agendaUuid.test(s.staffId))return false;
 const request=s.requestKey,instant=s.selectedStart,service=s.serviceId;
 s.busy=true;s.error='';s.notice='';
 try{
  const {data,error}=await s.client.rpc('agenda_book_staff_slot',{
   p_service_id:service,p_starts_at:instant,p_name:name,p_phone:phone,
   p_request_id:request,p_staff_id:s.staffId||null
  });
  if(error)throw error;
  if(!agendaUuid.test(data?.id)||data.status!=='confirmed')throw Error('booking readback failed');
  const verify=await s.client.from('agenda_appointments').select('id,status,starts_at')
   .eq('id',data.id).eq('customer_id',s.user.id).maybeSingle();
  if(verify.error||verify.data?.status!=='confirmed'||Date.parse(verify.data.starts_at)!==Date.parse(instant))
   throw Error('booking readback unavailable');
  s.notice='Horário confirmado para '+agendaDateTime(instant)+'. Você pode acompanhar ou cancelar pela sua conta.';
  s.selectedStart='';s.requestKey='';agendaClearPendingChoice();
  await agendaRefreshOwner();
  await agendaLoadSlots();
 }catch(e){
  // An ambiguous network failure may have committed. Verify the same
  // request ID; never allocate a new one automatically on retry.
  try{
   const readback=await s.client.from('agenda_appointments').select('id,status,starts_at')
    .eq('request_id',request).eq('customer_id',s.user.id).maybeSingle();
   if(readback.data?.status==='confirmed'){
    s.notice='Reserva confirmada para '+agendaDateTime(readback.data.starts_at)+'.';
    s.selectedStart='';s.requestKey='';agendaClearPendingChoice();await agendaRefreshOwner();await agendaLoadSlots();
   }else{
    s.error=e?.message?.includes('AGENDA_SLOT_ALREADY_TAKEN')?'Este horário acabou de ser escolhido. Atualize os horários.':
     'Não foi possível confirmar. Confira sua conta antes de repetir.';
   }
  }catch(_){s.error='O resultado não pôde ser confirmado. Confira suas reservas antes de tentar novamente.';}
 }
 s.busy=false;render();return false;
}
function agendaBeginReschedule(id){
 const s=agendaRuntime;
 const b=[...s.mine,...s.bookings].find(x=>x.id===id&&x.status==='confirmed');
 if(!b||s.busy||!agendaUuid.test(b.id))return;
 if(b.customer_id===s.user?.id&&b.reschedule_count>=2)return;
 if(b.reschedule_count>=20)return;
 const slug=b.slug||((s.page?.id===b.page_id)?s.page.slug:'');
 if(!agendaSlugPattern.test(slug))return;
 s.rescheduleId=id;s.error='';s.notice='Escolha o novo horário abaixo.';
 if(/^\/agenda(?:\/|$)/.test(location.pathname)){
  const next=new URL(agendaShareLink(slug));
  if(location.pathname!==next.pathname){
   history.pushState(null,'',next.pathname);
  }
  agendaRefreshPublic().then(()=>render()).catch(()=>{
   s.error='Não foi possível abrir os horários.';render();
  });
 }else{
  const next='#agenda?profissional='+encodeURIComponent(slug);
  if(location.hash===next)agendaRefreshPublic().then(()=>render()).catch(()=>{
   s.error='Não foi possível abrir os horários.';render();
  });
  else location.hash=next;
 }
}
function agendaCancelReschedule(){
 const s=agendaRuntime;s.rescheduleId='';s.error='';s.notice='Remarcação interrompida. Sua reserva original está mantida.';
 if(s.serviceId)agendaLoadSlots();else render();
}
async function agendaConfirmReschedule(){
 const s=agendaRuntime;
 if(!s.user||!s.client||s.busy||!agendaUuid.test(s.rescheduleId)||!s.selectedStart)return;
 const current=[...s.mine,...s.bookings].find(x=>x.id===s.rescheduleId&&x.status==='confirmed');
 if(!current||current.page_id!==s.publicProfile?.id||
  current.service_id!==s.serviceId||(current.staff_id||'')!==s.staffId)return;
 const target=s.selectedStart;
 if(!s.slots.some(x=>x.starts_at===target))return;
 s.busy=true;s.error='';s.notice='';
 try{
  const {data,error}=await s.client.rpc('agenda_reschedule_booking',{
   p_appointment_id:current.id,p_expected_starts_at:current.starts_at,p_new_starts_at:target
  });
  if(error)throw error;
  if(data?.status!=='confirmed'||data?.id!==current.id||Date.parse(data?.starts_at)!==Date.parse(target))
   throw Error('readback failed');
  const verify=await s.client.from('agenda_appointments').select('id,starts_at,status')
   .eq('id',current.id).maybeSingle();
  if(verify.error||verify.data?.status!=='confirmed'||
   Date.parse(verify.data.starts_at)!==Date.parse(target))
   throw Error('readback failed');
  s.rescheduleId='';s.notice='Horário remarcado para '+agendaDateTime(target)+'. Atualize seu calendário com a nova reserva.';
  await agendaRefreshOwner();await agendaLoadSlots();
 }catch(e){
  let result={error:true};
  try{result=await s.client.from('agenda_appointments').select('starts_at,status')
    .eq('id',current.id).maybeSingle();}catch(_){}
  if(!result.error&&result.data?.status==='confirmed'&&
     Date.parse(result.data.starts_at)===Date.parse(target)){
   s.rescheduleId='';s.notice='Remarcação confirmada para '+agendaDateTime(target)+'.';
   await agendaRefreshOwner();await agendaLoadSlots();
  }else{
   s.error=e?.message?.includes('AGENDA_SLOT_ALREADY_TAKEN')?
    'Este horário foi reservado por outra pessoa. Escolha outro.':
    'A remarcação não foi confirmada. Confira sua reserva antes de tentar novamente.';
  }
 }
 s.busy=false;render();
}
async function agendaCancel(id){
 const s=agendaRuntime;
 if(s.busy||!agendaUuid.test(id)||!confirm('Cancelar este horário?'))return;
 s.busy=true;s.error='';s.notice='';
 try{
  const {data,error}=await s.client.rpc('agenda_cancel_booking',{p_appointment_id:id});
  if(error||data!==true)throw error||Error('cancel failed');
  await agendaRefreshOwner();
  s.notice='Horário cancelado.';
  if(s.serviceId)await agendaLoadSlots();
 }catch(_){s.error='Não foi possível cancelar. Confira sua agenda antes de tentar novamente.';}
 s.busy=false;render();
}
function agendaQrSvg(slug){
 if(typeof globalThis.qrcode!=='function'||!agendaSlugPattern.test(String(slug||'')))return '';
 try{
  const qr=globalThis.qrcode(0,'M');
  qr.addData(agendaShareLink(slug));
  qr.make();
  const svg=qr.createSvgTag(4,2);
  return typeof svg==='string'&&svg.startsWith('<svg')&&svg.length<150000?svg:'';
 }catch(_){return '';}
}
function agendaQrMarkup(slug){
 const svg=agendaQrSvg(slug);
 return svg?'<div class="agenda-qr-image" role="img" aria-label="QR Code da página do profissional">'+svg+'</div>':
  '<p class="tiny muted">Não foi possível criar o QR Code. Copie o link acima.</p>';
}
async function agendaLoadQr(){
 if(typeof globalThis.qrcode==='function')return true;
 return await new Promise(resolve=>{
  const script=document.createElement('script');
  script.src='/js/qr-generator.js';script.async=true;
  script.onload=()=>resolve(typeof globalThis.qrcode==='function');
  script.onerror=()=>resolve(false);
  document.head.appendChild(script);
 });
}
async function agendaToggleQr(){
 const s=agendaRuntime;if(!s.page?.slug||!s.page.published)return;
 if(s.qrOpen){s.qrOpen=false;render();return;}
 const loaded=await agendaLoadQr();
 if(!loaded){s.error='Não foi possível preparar o QR Code. Use o link de compartilhamento.';render();return;}
 s.qrOpen=true;s.error='';render();
}
function agendaDownloadQr(){
 const s=agendaRuntime;
 if(!s.page?.published)return;
 const svg=agendaQrSvg(s.page.slug);
 if(!svg){s.error='QR Code indisponível. Copie o link da página.';render();return;}
 const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
 const link=document.createElement('a');
 link.href=url;link.download='tamao-agenda-'+s.page.slug+'.svg';
 document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1500);
}
async function agendaSharePublicLink(){
 const s=agendaRuntime;if(!s.page?.slug||!s.page.published)return;
 const url=agendaShareLink(s.page.slug);
 if(typeof navigator.share==='function'){
  try{await navigator.share({title:s.page.title||'Minha Agenda TAMÃO',url});return;}
  catch(e){if(e?.name==='AbortError')return;}
 }
 agendaCopyLink();
}
async function agendaCopyLink(){
 const s=agendaRuntime;if(!s.page?.slug||!s.page.published)return;
 try{await navigator.clipboard.writeText(agendaShareLink(s.page.slug));s.notice='Link copiado.';}
 catch{s.notice='Copie o endereço do link exibido na sua página.';}
 render();
}
function agendaRememberPanel(which,open){
 const s=agendaRuntime;
 if(which==='hours')s.hoursOpen=!!open;
 if(which==='advanced')s.advancedOpen=!!open;
}
function agendaGoMyPage(){
 if(/^\/agenda(?:\/|$)/.test(location.pathname)){
  history.pushState(null,'','/agenda/');
  agendaRefreshPublic().then(()=>render()).catch(()=>render());
 }else location.hash='#agenda';
}

function agendaStartOwner(){agendaRuntime.ownerMode=true;agendaRuntime.error='';render();}
function agendaStopOwner(){agendaRuntime.ownerMode=false;agendaRuntime.error='';render();}
async function agendaLogout(){
 const s=agendaRuntime;if(!s.client||!s.user||s.busy)return;
 s.busy=true;s.error='';
 try{
  const {error}=await s.client.auth.signOut();
  if(error)throw error;
  s.user=null;s.ownerMode=false;s.advancedOpen=false;s.hoursOpen=false;s.page=null;s.services=[];s.staff=[];s.depositSettings=[];s.hours=[];s.bookings=[];s.mine=[];s.waiting=[];s.myWaiting=[];s.blocks=[];s.closedDays=[];s.rescheduleId='';
  s.notice='Você saiu da conta.';
 }catch(_){s.error='Não foi possível sair. Tente novamente.';}
 s.busy=false;render();
}
