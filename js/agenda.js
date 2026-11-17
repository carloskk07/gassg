/* TAMÃO Agenda: optional professional booking module; no payment processing. */
const agendaRuntime={
 phase:'idle',client:null,user:null,page:null,services:[],hours:[],bookings:[],mine:[],
 slug:'',publicProfile:null,serviceId:'',day:'',slots:[],selectedStart:'',
 notice:'',error:'',busy:false,slotBusy:false,requestKey:'',epoch:0,authReady:false
};
const agendaUuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const agendaSlugPattern=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const agendaDays=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
function agendaRoute(){return route()==='agenda'&&!globalThis.adminPortalRequested?.()&&!globalThis.merchantPortalRequested?.();}
function agendaSlug(){
 const x=String(location.hash||'').split('?')[1]||'';
 try{const value=new URLSearchParams(x).get('profissional')||'';
  return agendaSlugPattern.test(value)&&value.length<=60?value:'';}catch{return '';}
}
function agendaShareLink(slug){
 return location.origin+location.pathname+'#agenda?profissional='+encodeURIComponent(slug);
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
 const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});
 return fmt.format(new Date(Date.now()+offset*86400000));
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
function agendaOwnerEditor(){
 const s=agendaRuntime,p=s.page||{},link=p.published&&p.slug?agendaShareLink(p.slug):'';
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
 return '<div class="agenda-owner-grid">'+
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
   '<button type="button" class="secondary" onclick="agendaCopyLink()">Copiar link</button>':'')+
  '<p class="tiny muted">A página é gratuita. Por enquanto, reservas não recebem sinal antecipado.</p></section>'+
  '<section class="agenda-panel"><h2>Serviços e preços</h2>'+
   (p.id?'<form class="agenda-service-row" onsubmit="return agendaSaveService(event)">'+
    '<label>Serviço<input required minlength="3" maxlength="100" name="title" placeholder="Ex.: Corte masculino"></label>'+
    '<label>Duração<select name="duration">'+[15,30,45,60,75,90,120,150,180,240].map(m=>'<option value="'+m+'"'+(m===30?' selected':'')+'>'+m+' min</option>').join('')+'</select></label>'+
    '<label>Preço R$<input type="number" name="price" inputmode="decimal" min="0" max="20000" step=".01" required value="0.00"></label>'+
    '<button class="primary" type="submit"'+(s.busy?' disabled':'')+'>Adicionar serviço</button></form>'+serviceCards:
    '<p>Salve sua página para adicionar os serviços.</p>')+
  '</section>'+
  '<section class="agenda-panel"><h2>Meus horários</h2><p>Marque os dias em que atende. Horários ocupados ficam indisponíveis automaticamente.</p>'+
   (p.id?'<form onsubmit="return agendaSaveHours(event)">'+allDays+
    '<button type="submit" class="primary"'+(s.busy?' disabled':'')+'>Salvar horários</button></form>':
    '<p>Salve sua página para configurar a agenda.</p>')+'</section>'+
  '<section class="agenda-panel"><h2>Próximos atendimentos</h2>'+
   (s.bookings.length?s.bookings.map(b=>{
    const serv=s.services.find(x=>x.id===b.service_id);
    return '<article class="agenda-booking"><strong>'+esc(b.customer_name)+'</strong>'+
     '<span>'+esc(serv?.title||'Atendimento')+' • '+esc(agendaDateTime(b.starts_at))+'</span>'+
     (b.customer_phone?'<span>Contato: '+esc(b.customer_phone)+'</span>':'')+
     '<button type="button" class="secondary" onclick="agendaCancel(\''+esc(b.id)+'\')">Cancelar horário</button></article>';
   }).join(''):'<p>Quando receber um agendamento, ele aparecerá aqui.</p>')+
  '</section></div>';
}
function agendaDateTime(value){
 try{return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',
  day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));}
 catch{return 'Data indisponível';}
}
function agendaPublicView(){
 const s=agendaRuntime,p=s.publicProfile;
 if(!p)return '<section class="agenda-panel"><h1>Página não disponível</h1><p>Confira o link enviado pelo profissional.</p><a href="#professionals">Encontrar profissionais</a></section>';
 const service=(p.services||[]).find(x=>x.id===s.serviceId);
 const choices=(p.services||[]).map(x=>
  '<option value="'+esc(x.id)+'"'+(s.serviceId===x.id?' selected':'')+'>'+esc(x.title)+' — '+agendaMoney(x.price_cents)+'</option>').join('');
 const date=s.day||agendaToday();
 const slots=s.slots.map(x=>
  '<button type="button" class="'+(s.selectedStart===x.starts_at?'primary':'secondary')+
  '" aria-pressed="'+(s.selectedStart===x.starts_at)+'" onclick="agendaSelectSlot(\''+esc(x.starts_at)+'\')">'+esc(x.label)+'</button>').join('');
 const form='<section class="agenda-panel"><h2>Escolha seu horário</h2>'+
  '<label>Serviço<select onchange="agendaChooseService(this.value)">'+choices+'</select></label>'+
  (service?'<p class="agenda-service-summary">'+esc(service.title)+' • '+service.duration_min+' min • '+agendaMoney(service.price_cents)+'</p>':'')+
  '<label>Data<input type="date" value="'+esc(date)+'" min="'+agendaToday()+'" max="'+agendaToday(30)+'" onchange="agendaChooseDay(this.value)"></label>'+
  '<p class="tiny muted">Horários disponíveis, no fuso de Brasília.</p>'+
  '<div class="agenda-slot-grid" role="group" aria-label="Horários disponíveis">'+
   (s.slotBusy?'<p>Consultando horários…</p>':slots||'<p>Nenhum horário livre nesta data. Escolha outro dia.</p>')+'</div>'+
  (s.selectedStart?(s.user?
    '<form class="agenda-book-form" onsubmit="return agendaBook(event)">'+
     '<h3>Confirme sua reserva</h3>'+
     '<label>Seu nome<input name="name" minlength="2" maxlength="90" required autocomplete="name"></label>'+
     '<label>Telefone (opcional)<input name="phone" type="tel" maxlength="25" placeholder="+55 ..."></label>'+
     '<p>'+esc(agendaDateTime(s.selectedStart))+'</p>'+
     '<p class="tiny muted">Agendamento gratuito. Qualquer pagamento eventual será combinado diretamente com o profissional; o TAMÃO não recebe sinal nesta versão.</p>'+
     '<button type="submit" class="primary"'+(s.busy?' disabled':'')+'>Confirmar horário gratuitamente</button></form>':
    '<div class="agenda-login-prompt"><p>Entre pelo seu e-mail para confirmar este horário.</p>'+agendaLoginForm()+'</div>'):'')+
  '</section>';
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
function agendaPage(){
 const s=agendaRuntime,slug=agendaSlug();
 const head='<section class="agenda-hero"><div><span class="section-kicker">TAMÃO AGENDA</span>'+
 '<h1>'+ (slug?'Seu próximo atendimento, sem complicação.':'Sua agenda organizada. Seus clientes mais perto.')+'</h1>'+
 '<p>'+(slug?'Escolha um serviço e veja os horários disponíveis em poucos passos.':
  'Tenha uma página exclusiva, organize serviços e receba reservas online — sem mensalidade para começar.')+'</p></div>'+
 '<a href="#professionals">Explorar profissionais</a></section>';
 if(s.phase==='idle'||s.phase==='loading')return shell('<section class="section agenda">'+head+'<p>Carregando agenda…</p></section>');
 if(s.phase==='failed')return shell('<section class="section agenda">'+head+agendaNote()+
  '<button type="button" onclick="agendaRetry()">Tentar novamente</button></section>');
 if(slug && s.slug!==slug)return shell('<section class="section agenda">'+head+'<p>Consultando a página do profissional…</p></section>');
 return shell('<section class="section agenda">'+head+agendaNote()+
  (slug?agendaPublicView():
    '<div class="agenda-intro"><h2>Agenda profissional do TAMÃO</h2><p>Ideal para barbearias, salões, estúdios, aulas e outros atendimentos com hora marcada. Você define seu horário e compartilha seu próprio link.</p></div>'+
    (!s.user?agendaLoginForm():agendaOwnerEditor())+
    (s.user&&s.mine.length?'<section class="agenda-panel"><h2>Reservas que fiz</h2>'+s.mine.map(b=>
     '<article class="agenda-booking"><span>'+esc(agendaDateTime(b.starts_at))+'</span><button type="button" class="secondary" onclick="agendaCancel(\''+esc(b.id)+'\')">Cancelar</button></article>').join('')+'</section>':''))+
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
   if(type==='SIGNED_OUT'){s.user=null;s.page=null;s.services=[];s.hours=[];s.bookings=[];s.mine=[];render();return;}
   if(type==='SIGNED_IN'&&session?.user?.id!==s.user?.id){
    s.user=session.user;s.page=null;s.services=[];s.hours=[];s.bookings=[];s.mine=[];
    Promise.resolve().then(()=>agendaRefreshOwner()).then(()=>render()).catch(()=>{});
   }
  });
  s.phase='ready';
  if(s.user)await agendaRefreshOwner();
  if(location.search.includes('agenda=1')){
   const url=new URL(location.href);url.searchParams.delete('agenda');
   history.replaceState(null,'',url.pathname+url.search+url.hash);
  }
  await agendaRefreshPublic();
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
  const [services,hours,bookings]=await Promise.all([
   s.client.from('agenda_services').select('*').eq('page_id',p.id).order('created_at'),
   s.client.from('agenda_hours').select('*').eq('page_id',p.id).order('weekday'),
   s.client.from('agenda_appointments').select('id,service_id,customer_name,customer_phone,starts_at,status')
     .eq('owner_id',u.id).eq('status','confirmed').gte('starts_at',new Date(Date.now()-3600000).toISOString()).order('starts_at').limit(100)
  ]);
  if(epoch!==s.epoch||s.user?.id!==u.id)return;
  if(services.error||hours.error||bookings.error)throw services.error||hours.error||bookings.error;
  s.services=services.data||[];s.hours=hours.data||[];s.bookings=bookings.data||[];
 }else{s.services=[];s.hours=[];s.bookings=[];}
 const mine=await s.client.from('agenda_appointments').select('id,starts_at,status')
  .eq('customer_id',u.id).eq('status','confirmed').gte('starts_at',new Date().toISOString()).order('starts_at').limit(50);
 if(epoch===s.epoch&&s.user?.id===u.id&&!mine.error)s.mine=mine.data||[];
}
async function agendaRefreshPublic(){
 const s=agendaRuntime,slug=agendaSlug();s.slug=slug;s.publicProfile=null;
 s.serviceId='';s.selectedStart='';s.slots=[];s.day=agendaToday();s.requestKey='';
 if(!slug||!s.client)return;
 const {data,error}=await s.client.rpc('agenda_public_page',{p_slug:slug});
 if(!agendaRoute()||agendaSlug()!==slug)return;
 if(error){s.error='Não foi possível consultar este profissional.';return;}
 s.publicProfile=data||null;
 s.serviceId=(data?.services||[])[0]?.id||'';
 if(s.serviceId)await agendaLoadSlots();
}
async function agendaLoadSlots(){
 const s=agendaRuntime,service=s.serviceId,day=s.day;
 s.selectedStart='';s.requestKey='';s.slots=[];if(!service||!day)return;
 s.slotBusy=true;render();
 try{
  const {data,error}=await s.client.rpc('agenda_available_slots',{p_service_id:service,p_day:day});
  if(s.serviceId!==service||s.day!==day)return;
  if(error)throw error;
  s.slots=(data||[]).filter(x=>agendaUuid.test(x?.starts_at)?false: // date is ISO, never a UUID
   typeof x?.starts_at==='string'&&Number.isFinite(Date.parse(x.starts_at))&&/^\d{2}:\d{2}$/.test(x.label)).slice(0,36);
 }catch(e){s.error='Não foi possível consultar horários. Tente outra data.';}
 finally{if(s.serviceId===service&&s.day===day){s.slotBusy=false;if(agendaRoute())render();}}
}
function agendaChooseService(id){const s=agendaRuntime;if(!(s.publicProfile?.services||[]).some(x=>x.id===id))return;
 s.serviceId=id;s.error='';agendaLoadSlots();}
function agendaChooseDay(day){const s=agendaRuntime;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(day)))return;
 if(day<agendaToday()||day>agendaToday(30))return;
 s.day=day;s.error='';agendaLoadSlots();}
function agendaSelectSlot(instant){
 const s=agendaRuntime;if(!s.slots.some(x=>x.starts_at===instant))return;
 s.selectedStart=instant;s.requestKey=crypto.randomUUID();s.error='';render();
}
async function agendaLogin(ev){
 ev.preventDefault();const s=agendaRuntime;
 const email=String(new FormData(ev.target).get('email')||'').trim();
 if(s.busy||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||!s.client)return false;
 s.busy=true;s.error='';s.notice='';
 try{
  const slug=agendaSlug();const url=location.origin+location.pathname+'?agenda=1#agenda'+
   (slug?'?profissional='+encodeURIComponent(slug):'');
  const {error}=await s.client.auth.signInWithOtp({email,options:{emailRedirectTo:url}});
  if(error)throw error;
  s.notice='Enviamos um link de acesso para seu e-mail.';
 }catch(e){s.error='Não foi possível enviar o link. Confira o e-mail e tente novamente.';}
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
  s.notice='Página salva. '+(page.published?'Seu link está disponível.':'Publique quando desejar receber agendamentos.');
 }catch(e){
  s.error=e?.code==='23505'?'Este link já está em uso. Escolha outro.':
   'Não foi possível concluir tudo. Confira sua página antes de repetir o envio.';
  try{await agendaRefreshOwner();}catch{}
 }
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
async function agendaBook(ev){
 ev.preventDefault();const s=agendaRuntime;
 if(s.busy||!s.user||!s.selectedStart||!agendaUuid.test(s.serviceId))return false;
 const f=new FormData(ev.target),name=String(f.get('name')||'').trim(),phone=String(f.get('phone')||'').trim();
 if(name.length<2||name.length>90){s.error='Informe seu nome.';render();return false;}
 if(!s.requestKey)s.requestKey=crypto.randomUUID();
 const request=s.requestKey,instant=s.selectedStart,service=s.serviceId;
 s.busy=true;s.error='';s.notice='';
 try{
  const {data,error}=await s.client.rpc('agenda_book_slot',{
   p_service_id:service,p_starts_at:instant,p_name:name,p_phone:phone,p_request_id:request
  });
  if(error)throw error;
  if(!agendaUuid.test(data?.id)||data.status!=='confirmed')throw Error('booking readback failed');
  const verify=await s.client.from('agenda_appointments').select('id,status,starts_at')
   .eq('id',data.id).eq('customer_id',s.user.id).maybeSingle();
  if(verify.error||verify.data?.status!=='confirmed'||verify.data.starts_at!==instant)
   throw Error('booking readback unavailable');
  s.notice='Horário confirmado para '+agendaDateTime(instant)+'. Você pode acompanhar ou cancelar pela sua conta.';
  s.selectedStart='';s.requestKey='';
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
    s.selectedStart='';s.requestKey='';await agendaRefreshOwner();await agendaLoadSlots();
   }else{
    s.error=e?.message?.includes('AGENDA_SLOT_ALREADY_TAKEN')?'Este horário acabou de ser escolhido. Atualize os horários.':
     'Não foi possível confirmar. Confira sua conta antes de repetir.';
   }
  }catch(_){s.error='O resultado não pôde ser confirmado. Confira suas reservas antes de tentar novamente.';}
 }
 s.busy=false;render();return false;
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
async function agendaCopyLink(){
 const s=agendaRuntime;if(!s.page?.slug||!s.page.published)return;
 try{await navigator.clipboard.writeText(agendaShareLink(s.page.slug));s.notice='Link copiado.';}
 catch{s.notice='Copie o endereço do link exibido na sua página.';}
 render();
}
function agendaGoMyPage(){location.hash='#agenda';}
