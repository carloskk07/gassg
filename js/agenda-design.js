/* TAMÃO Agenda • reusable, owner-controlled themes. Payments/bookings remain in agenda.js. */
const agendaDesignThemes=Object.freeze({
 'black-gold':{title:'Black Gold',caption:'Clássico premium',primary:'#161717',accent:'#caa86c'},
 'elegance':{title:'Elegance',caption:'Beleza e bem-estar',primary:'#553c4a',accent:'#e8b5b9'},
 'clean':{title:'Clean',caption:'Moderno e acolhedor',primary:'#174f48',accent:'#76c5ae'}
});
function agendaDesignColor(value,fallback){
 return /^#[0-9a-fA-F]{6}$/.test(String(value||''))?String(value):fallback;
}
function agendaDesignIndex(value){
 const n=Number(value);return Number.isInteger(n)&&n>=0&&n<6?n:-1;
}
function agendaDesignEscape(v){return esc(String(v??''));}
function agendaDesignPhoto(profile,value){
 const images=profile?.photo_paths||profile?.photos||[];
 const index=agendaDesignIndex(value);
 return index>=0&&index<images.length?agendaPhotoUrl(images[index]):'';
}
function agendaDesignCurrent(){
 const d=agendaRuntime.design||{},t=agendaDesignThemes[d.template]||agendaDesignThemes.clean;
 return {
  template:agendaDesignThemes[d.template]?d.template:'clean',
  primary_color:agendaDesignColor(d.primary_color,t.primary),
  accent_color:agendaDesignColor(d.accent_color,t.accent),
  headline:String(d.headline||'').slice(0,100),
  tagline:String(d.tagline||'').slice(0,220),
  cover_index:agendaDesignIndex(d.cover_index),
  logo_index:agendaDesignIndex(d.logo_index),
  service_images:d.service_images&&typeof d.service_images==='object'?d.service_images:{},
  staff_images:d.staff_images&&typeof d.staff_images==='object'?d.staff_images:{},
  highlights:Array.isArray(d.highlights)?d.highlights.slice(0,4).map(x=>String(x).slice(0,70)):[],
  street_address:String(d.street_address||'').slice(0,180),
  instagram:String(d.instagram||'').slice(0,40),
  show_about:d.show_about!==false,
  show_team:d.show_team!==false,
  show_gallery:d.show_gallery!==false,
  show_location:d.show_location!==false,
  show_highlights:d.show_highlights!==false
 };
}
async function agendaDesignLoadOwner(){
 const s=agendaRuntime;
 s.design=null;s.designUnavailable=false;
 if(!s.page?.id||!s.client||!s.user)return;
 const {data,error}=await s.client.from('agenda_page_design').select('*')
  .eq('page_id',s.page.id).maybeSingle();
 if(error){s.designUnavailable=true;return;}
 s.design=data||null;
}
async function agendaDesignLoadPublic(profile){
 const s=agendaRuntime;s.design=null;
 if(!profile?.id||!s.client)return;
 const {data,error}=await s.client.from('agenda_page_design').select('*')
  .eq('page_id',profile.id).maybeSingle();
 if(error)return;
 if(s.publicProfile?.id===profile.id)s.design=data||null;
}
function agendaDesignPhotoOptions(profile,choice){
 const photos=profile.photo_paths||[];
 return '<option value="-1"'+(agendaDesignIndex(choice)===-1?' selected':'')+'>Sem foto (fundo do modelo)</option>'+
  photos.map((path,i)=>'<option value="'+i+'"'+(agendaDesignIndex(choice)===i?' selected':'')+'>Foto '+(i+1)+'</option>').join('');
}
function agendaDesignImagesPreview(profile){
 const photos=profile.photo_paths||[];
 return photos.length?'<div class="agenda-design-assets" aria-label="Fotos disponíveis">'+photos.map((path,i)=>{
  const src=agendaPhotoUrl(path);
  return src?'<figure><img loading="lazy" src="'+esc(src)+'" alt="Foto '+(i+1)+'"><figcaption>Foto '+(i+1)+'</figcaption></figure>':'';
 }).join('')+'</div>':
 '<p class="agenda-design-hint">Adicione suas fotografias na opção “Minha página”, em ajustes opcionais. Depois escolha qual usar em cada parte.</p>';
}
function agendaDesignPhotoAssignments(rows,map,kind,profile){
 if(!rows.length)return '<p class="agenda-design-hint">Cadastre '+(kind==='service'?'serviços':'colaboradores')+' para selecionar imagens específicas.</p>';
 return rows.map(row=>'<label>'+agendaDesignEscape(row.title||row.name)+
  '<select name="'+kind+'_'+agendaDesignEscape(row.id)+'">'+
   agendaDesignPhotoOptions(profile,map[row.id])+'</select></label>').join('');
}
function agendaDesignPreviewMarkup(input,profile){
 const template=agendaDesignThemes[input.template]?input.template:'clean';
 const theme=agendaDesignThemes[template];
 const primary=agendaDesignColor(input.primary_color,theme.primary);
 const accent=agendaDesignColor(input.accent_color,theme.accent);
 const cover=agendaDesignPhoto(profile,input.cover_index);
 return '<div class="agenda-design-live theme-'+template+'" style="--ap-primary:'+primary+';--ap-accent:'+accent+'">'+
  '<div class="agenda-design-live-cover">'+(cover?'<img src="'+esc(cover)+'" alt="">':'')+
  '<strong>'+agendaDesignEscape(input.headline||profile.title||'Seu estabelecimento')+'</strong>'+
  '<span>'+agendaDesignEscape(input.tagline||'Seu atendimento, do seu jeito.')+'</span></div>'+
  '<div class="agenda-design-live-content"><b>Serviços e agendamentos</b><small>O agendamento real utiliza seus serviços e horários.</small>'+
  '<span class="agenda-design-live-button">Escolher horário</span></div></div>';
}
function agendaDesignOwnerEditor(){
 const s=agendaRuntime,p=s.page;
 if(!p?.id)return '';
 if(s.designUnavailable)return '<section class="agenda-panel" role="alert"><h2>Personalização visual</h2><p>O editor visual está indisponível. A agenda e as reservas continuam funcionando normalmente.</p></section>';
 const d=agendaDesignCurrent();
 const photos=p.photo_paths||[];
 return '<section class="agenda-panel agenda-design-editor" id="agenda-design-editor">'+
  '<div class="agenda-design-heading"><div><span class="section-kicker">SUA IDENTIDADE</span><h2>Personalize sua página</h2>'+
  '<p>Escolha um estilo, ajuste os detalhes e veja uma prévia. As reservas continuam na sua agenda oficial.</p></div>'+
  (p.published?'<a class="agenda-design-view" href="'+esc(agendaShareLink(p.slug))+'" target="_blank" rel="noopener noreferrer">Abrir minha página</a>':'')+'</div>'+
  '<form id="agenda-design-form" onsubmit="return agendaDesignSave(event)" oninput="agendaDesignPreview()" onchange="agendaDesignPreview()">'+
  '<fieldset class="agenda-design-models"><legend>1 · Escolha um modelo</legend><div class="agenda-design-model-grid">'+
  Object.entries(agendaDesignThemes).map(([key,theme])=>
   '<label class="agenda-design-model theme-'+key+'"><input type="radio" name="template" value="'+key+'"'+(key===d.template?' checked':'')+'>'+
   '<span class="agenda-design-model-art"><span class="agenda-design-model-rule"></span><b>SEU NEGÓCIO</b><i>Agende com facilidade</i></span>'+
   '<strong>'+theme.title+'</strong><small>'+theme.caption+'</small></label>').join('')+'</div></fieldset>'+
  '<fieldset><legend>2 · Personalize o visual e o conteúdo</legend><div class="agenda-design-two">'+
   '<label>Cor principal <input name="primary_color" type="color" value="'+esc(d.primary_color)+'"></label>'+
   '<label>Cor de destaque <input name="accent_color" type="color" value="'+esc(d.accent_color)+'"></label>'+
   '<label>Título em destaque <input name="headline" maxlength="100" value="'+agendaDesignEscape(d.headline)+'" placeholder="'+agendaDesignEscape(p.title)+'"></label>'+
   '<label>Frase de apresentação <input name="tagline" maxlength="220" value="'+agendaDesignEscape(d.tagline)+'" placeholder="Seu cuidado merece o melhor"></label>'+
  '</div>'+
  '<h3>Suas fotografias</h3>'+agendaDesignImagesPreview(p)+
  '<div class="agenda-design-two"><label>Foto de capa <select name="cover_index">'+agendaDesignPhotoOptions(p,d.cover_index)+'</select></label>'+
   '<label>Foto da marca <select name="logo_index">'+agendaDesignPhotoOptions(p,d.logo_index)+'</select></label></div>'+
  '<details><summary>Fotos dos serviços</summary><div class="agenda-design-two">'+
   agendaDesignPhotoAssignments(s.services,d.service_images,'service',p)+'</div></details>'+
  '<details><summary>Fotos da equipe</summary><div class="agenda-design-two">'+
   agendaDesignPhotoAssignments(s.staff,d.staff_images,'staff',p)+'</div></details>'+
  '<label>Seus diferenciais (uma frase por linha, até 4)<textarea name="highlights" rows="3" maxlength="290" placeholder="Atendimento com horário marcado">'+
   agendaDesignEscape(d.highlights.join('\n'))+'</textarea></label>'+
  '<div class="agenda-design-two"><label>Endereço público (opcional)<input name="street_address" maxlength="180" value="'+agendaDesignEscape(d.street_address)+'" placeholder="Rua, número e bairro"></label>'+
  '<label>Instagram (opcional)<input name="instagram" maxlength="40" pattern="[a-zA-Z0-9._]{0,30}" value="'+agendaDesignEscape(d.instagram)+'" placeholder="usuario"></label></div>'+
  '<div class="agenda-design-toggles">'+
   [['show_about','Sobre'],['show_team','Equipe'],['show_gallery','Galeria'],['show_location','Localização'],['show_highlights','Destaques']].map(([k,label])=>
    '<label><input type="checkbox" name="'+k+'"'+(d[k]?' checked':'')+'> '+label+'</label>').join('')+'</div></fieldset>'+
  '<fieldset><legend>3 · Visualize e publique</legend><div id="agenda-design-preview" aria-live="polite">'+agendaDesignPreviewMarkup(d,p)+'</div></fieldset>'+
  '<button type="submit" class="primary"'+(s.busy?' disabled':'')+'>Salvar personalização</button>'+
  '<p class="agenda-design-hint">O visual salvo aparece no seu link oficial quando a agenda estiver publicada. Fotos e informações são controladas por você.</p>'+
  '</form></section>';
}
function agendaDesignPreview(){
 const form=document.getElementById('agenda-design-form'),target=document.getElementById('agenda-design-preview');
 if(!form||!target||!agendaRuntime.page)return;
 const f=new FormData(form),template=f.get('template');
 const t=agendaDesignThemes[template]||agendaDesignThemes.clean;
 target.innerHTML=agendaDesignPreviewMarkup({
  template,primary_color:agendaDesignColor(f.get('primary_color'),t.primary),
  accent_color:agendaDesignColor(f.get('accent_color'),t.accent),
  headline:f.get('headline'),tagline:f.get('tagline'),cover_index:f.get('cover_index')
 },agendaRuntime.page);
}
async function agendaDesignSave(event){
 event.preventDefault();const s=agendaRuntime;
 if(s.busy||!s.user?.id||!s.page?.id||s.designUnavailable)return false;
 const f=new FormData(event.target),template=String(f.get('template')||'');
 if(!agendaDesignThemes[template]){s.error='Escolha um dos modelos disponíveis.';render();return false;}
 const theme=agendaDesignThemes[template];
 const highlights=String(f.get('highlights')||'').split('\n').map(x=>x.trim()).filter(Boolean);
 const instagram=String(f.get('instagram')||'').trim().replace(/^@/,'');
 const service_images={},staff_images={};
 for(const row of s.services){
  const index=agendaDesignIndex(f.get('service_'+row.id));
  if(index>=0&&index<(s.page.photo_paths||[]).length)service_images[row.id]=index;
 }
 for(const row of s.staff){
  const index=agendaDesignIndex(f.get('staff_'+row.id));
  if(index>=0&&index<(s.page.photo_paths||[]).length)staff_images[row.id]=index;
 }
 const data={
  page_id:s.page.id,owner_id:s.user.id,template,
  primary_color:agendaDesignColor(f.get('primary_color'),theme.primary),
  accent_color:agendaDesignColor(f.get('accent_color'),theme.accent),
  headline:String(f.get('headline')||'').trim(),
  tagline:String(f.get('tagline')||'').trim(),
  cover_index:agendaDesignIndex(f.get('cover_index')),
  logo_index:agendaDesignIndex(f.get('logo_index')),
  service_images,staff_images,
  highlights,street_address:String(f.get('street_address')||'').trim(),
  instagram,
  show_about:f.get('show_about')==='on',show_team:f.get('show_team')==='on',
  show_gallery:f.get('show_gallery')==='on',show_location:f.get('show_location')==='on',
  show_highlights:f.get('show_highlights')==='on'
 };
 if(data.headline.length>100||data.tagline.length>220||data.street_address.length>180||
  highlights.length>4||highlights.some(x=>x.length>70)||
  !/^[A-Za-z0-9._]{0,30}$/.test(instagram)){
  s.error='Revise o título, os destaques, o endereço e o Instagram.';render();return false;
 }
 s.busy=true;s.error='';s.notice='';
 try{
  const {data:updated,error}=await s.client.from('agenda_page_design').upsert(data,{onConflict:'page_id'}).select('*').single();
  if(error||!updated||updated.page_id!==s.page.id)throw error||Error('design not confirmed');
  s.design=updated;
  s.notice='Personalização salva! '+(s.page.published?'Seu link oficial já apresenta o novo visual.':'Publique sua agenda para mostrar a nova página.');
 }catch(_){s.error='Não foi possível salvar o visual. Nada mudou nas suas reservas.';}
 s.busy=false;render();return false;
}
function agendaDesignChooseService(id){
 const s=agendaRuntime;
 if(!s.publicProfile?.services?.some(x=>x.id===id)||s.rescheduleId)return;
 s.serviceId=id;s.selectedStart='';s.error='';
 void agendaLoadSlots().then(()=>{document.getElementById('agenda-premium-book')?.scrollIntoView({behavior:'smooth',block:'start'});});
}
function agendaDesignPublicView(p,bookingForm){
 const s=agendaRuntime,d=agendaDesignCurrent();
 const safe=agendaDesignEscape;
 const title=d.headline||p.title;
 const color=agendaDesignColor(d.primary_color,agendaDesignThemes[d.template].primary);
 const accent=agendaDesignColor(d.accent_color,agendaDesignThemes[d.template].accent);
 const cover=agendaDesignPhoto(p,d.cover_index);
 const logo=agendaDesignPhoto(p,d.logo_index);
 const photos=p.photos||[];
 const serviceImg=item=>agendaDesignPhoto(p,d.service_images[item.id]);
 const staffImg=item=>agendaDesignPhoto(p,d.staff_images[item.id]);
 const realService=(p.services||[]);
 const team=p.staff||[];
 const area=[d.street_address,p.public_area,p.city].filter(Boolean).join(', ');
 const whats=p.whatsapp&&/^\+[1-9][0-9]{7,14}$/.test(p.whatsapp)?p.whatsapp.slice(1):'';
 const insta=/^[a-zA-Z0-9._]{1,30}$/.test(d.instagram)?d.instagram:'';
 const hero='<section class="agenda-premium-hero" id="inicio">'+
  (cover?'<img class="agenda-premium-cover" src="'+esc(cover)+'" alt="">':'')+
  '<div class="agenda-premium-hero-inner">'+
   (logo?'<img class="agenda-premium-logo" src="'+esc(logo)+'" alt="Marca de '+safe(p.title)+'">':'<span class="agenda-premium-symbol" aria-hidden="true">✦</span>')+
   '<span class="agenda-premium-overline">BEM-VINDO A '+safe(p.title)+'</span>'+
   '<h1>'+safe(title)+'</h1><p>'+safe(d.tagline||p.about||'Seu próximo atendimento começa aqui.')+'</p>'+
   '<a href="#agenda-premium-book" class="agenda-premium-button">Agendar horário</a>'+
  '</div></section>';
 const services='<section class="agenda-premium-section" id="servicos"><div class="agenda-premium-heading">'+
  '<span>ESCOLHA SEU ATENDIMENTO</span><h2>Serviços e valores</h2></div>'+
  (realService.length?'<div class="agenda-premium-cards">'+realService.map(item=>{
   const src=serviceImg(item);
   return '<article class="agenda-premium-service">'+
    (src?'<img loading="lazy" src="'+esc(src)+'" alt="Foto de '+safe(item.title)+'">':'<div class="agenda-premium-photo-fallback" aria-hidden="true">✦</div>')+
    '<div><h3>'+safe(item.title)+'</h3><p>'+Number(item.duration_min)+' minutos</p>'+
    '<strong>'+agendaMoney(item.price_cents)+'</strong>'+
    '<button type="button" onclick="agendaDesignChooseService(\''+esc(item.id)+'\')">Escolher serviço</button></div></article>';
  }).join('')+'</div>':'<p>Os serviços estarão disponíveis em breve.</p>')+'</section>';
 const about=d.show_about?'<section class="agenda-premium-section agenda-premium-about" id="sobre"><div class="agenda-premium-heading">'+
  '<span>QUEM SOMOS</span><h2>Conheça nosso trabalho</h2></div><p>'+safe(p.about||'Atendimento profissional com hora marcada.')+'</p></section>':'';
 const highlights=d.show_highlights&&d.highlights.length?'<section class="agenda-premium-highlights" aria-label="Diferenciais">'+
  d.highlights.map(x=>'<div><span aria-hidden="true">✦</span><strong>'+safe(x)+'</strong></div>').join('')+'</section>':'';
 const teamSection=d.show_team&&team.length?'<section class="agenda-premium-section" id="equipe"><div class="agenda-premium-heading"><span>PROFISSIONAIS</span><h2>Nossa equipe</h2></div>'+
  '<div class="agenda-premium-team">'+team.map(item=>{
   const src=staffImg(item);
   return '<article>'+(src?'<img loading="lazy" src="'+esc(src)+'" alt="Foto de '+safe(item.name)+'">':
    '<span class="agenda-premium-avatar" aria-hidden="true">✦</span>')+'<h3>'+safe(item.name)+'</h3></article>';
  }).join('')+'</div></section>':'';
 const gallery=d.show_gallery&&photos.length?'<section class="agenda-premium-section" id="galeria">'+
  '<div class="agenda-premium-heading"><span>NOSSO ESPAÇO</span><h2>Galeria</h2></div><div class="agenda-premium-gallery">'+
  photos.map((path,i)=>{const src=agendaPhotoUrl(path);
   return src?'<a href="'+esc(src)+'" target="_blank" rel="noopener noreferrer" aria-label="Abrir foto '+(i+1)+'">'+
    '<img loading="lazy" src="'+esc(src)+'" alt="Foto '+(i+1)+' de '+safe(p.title)+'"></a>':'';}).join('')+
  '</div></section>':'';
 const contacts=d.show_location?'<section class="agenda-premium-section agenda-premium-location" id="localizacao">'+
  '<div class="agenda-premium-heading"><span>VENHA NOS CONHECER</span><h2>Localização e contato</h2></div>'+
  '<p>'+safe(area||p.city||'Consulte a localização com o estabelecimento.')+'</p>'+
  '<div class="agenda-premium-links">'+
  (area?'<a target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/search/?api=1&amp;query='+encodeURIComponent(area)+'">Abrir no mapa</a>':'')+
  (whats?'<a target="_blank" rel="noopener noreferrer" href="https://wa.me/'+encodeURIComponent(whats)+'">Conversar no WhatsApp</a>':'')+
  (insta?'<a target="_blank" rel="noopener noreferrer" href="https://www.instagram.com/'+encodeURIComponent(insta)+'/">Instagram</a>':'')+
  '</div></section>':'';
 const booking=realService.length?bookingForm:'<section class="agenda-panel"><h2>Em preparação</h2><p>Os serviços ainda não estão disponíveis para agendar.</p></section>';
 return '<div class="agenda-premium theme-'+d.template+'" style="--ap-primary:'+color+';--ap-accent:'+accent+'">'+
  '<nav class="agenda-premium-nav" aria-label="Navegação do estabelecimento"><a href="#inicio">'+safe(p.title)+'</a>'+
  '<div><a href="#servicos">Serviços</a>'+(d.show_about?'<a href="#sobre">Sobre</a>':'')+
  (d.show_team&&team.length?'<a href="#equipe">Equipe</a>':'')+
  (d.show_gallery&&photos.length?'<a href="#galeria">Fotos</a>':'')+
  '<a href="#agenda-premium-book">Agendar</a></div></nav>'+
  hero+highlights+'<div class="agenda-premium-main">'+about+services+teamSection+gallery+
  '<section class="agenda-premium-section agenda-premium-book" id="agenda-premium-book">'+
  '<div class="agenda-premium-heading"><span>AGENDA ONLINE</span><h2>Escolha um horário</h2></div>'+booking+'</section>'+
  contacts+'</div><footer class="agenda-premium-footer">'+safe(p.title)+' · Agendamento pelo TAMÃO Agenda</footer></div>';
}
