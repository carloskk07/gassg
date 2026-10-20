/* TAMÃO | Meus anúncios. Carregado apenas ao abrir #advertise.
 * Transações financeiras e aprovação não são executadas aqui.
 * Comprovantes opcionais usam Storage privado, nunca o bucket de fotos.
 */
const discoveryOwner={
  client:null,phase:'idle',user:null,items:[],editor:null,kind:'professionals',
  notice:'',error:'',busy:false,pendingPhotoRemovals:[]
};
const discoveryOwnerTables={
  professionals:'discovery_professional_details',
  rides:'discovery_ride_details',
  stays:'discovery_stay_details'
};
// Only orphaned public photo keys are stored; never documents or auth tokens.
// Per-user keys avoid a shared browser retrying another account's cleanup.
// Supabase Storage RLS is authoritative even if localStorage is modified.
function discoveryOwnerPendingStorageKey(ownerId){
  return /^[0-9a-f-]{36}$/.test(String(ownerId||''))
    ?'tamao-photo-cleanup-v1:'+ownerId:'';
}
function discoveryOwnerReadPendingPhotoRemovals(ownerId){
  const name=discoveryOwnerPendingStorageKey(ownerId);
  if(!name)return [];
  try{
    const parsed=JSON.parse(globalThis.localStorage?.getItem(name)||'[]');
    return Array.isArray(parsed)?[...new Set(parsed.filter(key=>
      typeof key==='string'&&key.startsWith(ownerId+'/')&&
      Boolean(discoveryOwnerPhotoUrl(key))
    ))].slice(0,1800):[];
  }catch{return [];}
}
function discoveryOwnerPersistPendingPhotoRemovals(){
  const s=discoveryOwner,name=discoveryOwnerPendingStorageKey(s.user?.id);
  if(!name)return false;
  try{
    if(s.pendingPhotoRemovals.length)
      globalThis.localStorage?.setItem(name,JSON.stringify(s.pendingPhotoRemovals.slice(0,1800)));
    else globalThis.localStorage?.removeItem(name);
    return Boolean(globalThis.localStorage);
  }catch{return false;}
}
const discoveryOwnerStates=['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT',
  'MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
function discoveryOwnerRoute(){
  return (route()==='advertise'||globalThis.discoveryOwnerReturnPending?.()===true)&&
    !globalThis.adminPortalRequested?.()&&!globalThis.merchantPortalRequested?.();
}
function discoveryOwnerCitySlug(raw){
  return String(raw||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9 -]/g,'').trim().replace(/\s+/g,'-').slice(0,110);
}
function discoveryOwnerValue(data,name){
  return esc(data&&data[name]!==null&&data[name]!==undefined?data[name]:'');
}
function discoveryOwnerPhotoUrl(key){
  if(!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/.test(String(key||'')))return '';
  return String(CHAMA_BACKEND.url||'').replace(/\/+$/,'')+
    '/storage/v1/object/public/tamao-discovery-photos/'+
    String(key).split('/').map(encodeURIComponent).join('/');
}
function discoveryOwnerField(name,label,value,type,attrs){
  return '<label>'+label+'<input name="'+name+'" type="'+(type||'text')+
    '" '+(attrs||'')+' value="'+discoveryOwnerValue({v:value},'v')+'"></label>';
}
function discoveryOwnerTypeFields(type,d){
  if(type==='professionals')return (
    discoveryOwnerField('occupation','Profissão ou especialidade',d.occupation,'text','required minlength="3" maxlength="100"')+
    discoveryOwnerField('service_area','Onde atende',d.service_area,'text','required minlength="3" maxlength="200"')+
    discoveryOwnerField('years_experience','Anos de experiência (opcional)',d.years_experience,'number','min="0" max="80"')
  );
  if(type==='rides')return (
    discoveryOwnerField('departure_state','UF de origem',d.departure_state||'RS','text','required minlength="2" maxlength="2"')+
    discoveryOwnerField('departure_city','Cidade de origem',d.departure_city,'text','required minlength="2" maxlength="120"')+
    discoveryOwnerField('destination_state','UF de destino',d.destination_state||'RS','text','required minlength="2" maxlength="2"')+
    discoveryOwnerField('destination_city','Cidade de destino',d.destination_city,'text','required minlength="2" maxlength="120"')+
    discoveryOwnerField('departure_at','Saída (data e hora)',d.departure_at?new Date(d.departure_at).toISOString().slice(0,16):'','datetime-local','required')+
    discoveryOwnerField('seats_total','Vagas totais',d.seats_total||1,'number','required min="1" max="8"')+
    discoveryOwnerField('seats_available','Vagas disponíveis',d.seats_available??1,'number','required min="0" max="8"')+
    discoveryOwnerField('proposed_cost_share','Contribuição por vaga (R$), opcional',d.proposed_cost_share_cents===null?'':d.proposed_cost_share_cents===undefined?'':Number(d.proposed_cost_share_cents)/100,'number','min="0" max="5000" step=".01"')+
    '<label>Trajeto e paradas (opcional)<textarea name="route_notes" maxlength="600" rows="3" placeholder="Explique as paradas combinadas, sem publicar endereço residencial">'+esc(d.route_notes||'')+'</textarea></label>'
  );
  const types=[['holiday_house','Casa de temporada'],['beach_house','Casa de praia'],['inn','Pousada'],
    ['hotel','Hotel'],['apartment','Apartamento'],['cabin','Cabana'],
    ['country_house','Casa de campo'],['other','Outros']];
  return '<label>Tipo de hospedagem<select name="property_type" required>'+
    types.map(([v,t])=>'<option value="'+v+'"'+(d.property_type===v?' selected':'')+'>'+t+'</option>').join('')+'</select></label>'+
    discoveryOwnerField('guests','Capacidade de hóspedes',d.guests||2,'number','required min="1" max="80"')+
    discoveryOwnerField('bedrooms','Quartos',d.bedrooms??1,'number','required min="0" max="60"')+
    discoveryOwnerField('beds','Camas',d.beds??1,'number','required min="1" max="120"')+
    discoveryOwnerField('units','Unidades disponíveis no imóvel',d.units??1,'number','required min="1" max="250"')+
    discoveryOwnerField('price_from','Valor anunciado a partir de (R$, opcional)',d.price_from_brl_cents===null?'':d.price_from_brl_cents===undefined?'':Number(d.price_from_brl_cents)/100,'number','min="0" max="500000" step=".01"')+
    '<label>Período do preço<select name="price_unit">'+
      [['night','Por noite'],['stay','Por estadia'],['week','Por semana']].map(([value,label])=>
        '<option value="'+value+'"'+((d.price_unit||'night')===value?' selected':'')+'>'+label+'</option>').join('')+'</select></label>'+
    '<label>Comodidades (separe por vírgulas)<textarea name="amenities" maxlength="1200" rows="3" placeholder="Ex.: Wi-Fi, estacionamento, cozinha">'+esc(Array.isArray(d.amenities)?d.amenities.join(', '):'')+'</textarea></label>';
}
function discoveryOwnerPage(){
  const s=discoveryOwner;
  if(!discoveryOwnerRoute())return shell('<section><h1>Não encontrado</h1></section>');
  const header='<header class="discovery-owner-intro"><span class="section-kicker">TAMÃO • ANÚNCIOS</span>'+
    '<h1>Anuncie seus serviços, caronas e hospedagens.</h1>'+
    '<p>Crie um anúncio, inclua fotos e envie para revisão. Você controla o conteúdo e o contato.</p></header>';
  const note=s.notice?'<p role="status" class="discovery-owner-message">'+esc(s.notice)+'</p>':'';
  const error=s.error?'<p role="alert" class="discovery-owner-error">'+esc(s.error)+'</p>':'';
  if(s.phase==='idle'||s.phase==='loading')return shell('<section class="section discovery-owner">'+header+
    '<p role="status">Preparando sua área de anúncios…</p></section>');
  if(s.phase==='failed')return shell('<section class="section discovery-owner">'+header+error+
    '<button type="button" class="secondary" onclick="discoveryOwnerRetryInit()">Tentar conectar novamente</button></section>');
  if(!s.user)return shell('<section class="section discovery-owner">'+header+note+error+
    '<form class="discovery-owner-auth" onsubmit="return discoveryOwnerLogin(event)">'+
    '<label>Seu e-mail<input type="email" name="email" autocomplete="email" required maxlength="254" placeholder="voce@exemplo.com"></label>'+
    '<button class="primary" type="submit"'+(s.busy?' disabled':'')+'>Receber link de acesso</button>'+
    '<p class="tiny muted">Confirme o e-mail pelo link enviado. O cadastro não publica anúncios automaticamente.</p>'+
    '</form></section>');
  const cards=s.items.map(x=>{
    const id=String(x.id||'');
    if(!/^[a-f0-9-]{36}$/.test(id))return '';
    const canEdit=['draft','rejected','paused'].includes(x.status);
    const edit=canEdit?'<button type="button" onclick="discoveryOwnerOpen(\''+id+'\')">Editar</button>':'';
    const review=canEdit?'<button type="button" onclick="discoveryOwnerSubmit(\''+id+'\')">Enviar para revisão</button>':'';
    const pause=x.status==='published'?'<button type="button" onclick="discoveryOwnerPause(\''+id+'\')">Pausar anúncio</button>':'';
    return '<article class="discovery-owner-item"><strong>'+esc(x.title)+'</strong>'+
      '<small>'+esc(x.vertical)+' · '+esc(x.city_name)+' / '+esc(x.state_code)+' · '+esc(x.status)+'</small>'+
      '<div class="discovery-owner-actions">'+edit+review+pause+'</div></article>';
  }).join('');
  const d=s.editor||{},kind=s.editor?.vertical||s.kind;
  const form='<form id="discovery-owner-form" class="discovery-owner-form" onsubmit="return discoveryOwnerSave(event)">'+
    '<h2>'+(s.editor?.id?'Editar rascunho':'Novo anúncio')+'</h2>'+
    (s.editor?.id?'<p class="tiny muted">Tipo: '+esc(kind)+'</p>':
      '<label>O que deseja anunciar?<select name="vertical" onchange="discoveryOwnerTypeChanged(this.value)">'+
      Object.entries({professionals:'Profissionais',rides:'Caronas',stays:'Hospedagens'})
        .map(([v,t])=>'<option value="'+v+'"'+(kind===v?' selected':'')+'>'+t+'</option>').join('')+
      '</select></label>')+
    discoveryOwnerField('title','Título do anúncio',d.title,'text','required minlength="8" maxlength="120"')+
    '<label>Descrição<textarea name="description" minlength="30" maxlength="3500" rows="4" required>'+
      discoveryOwnerValue(d,'description')+'</textarea></label>'+
    '<label>Estado (UF)<select name="state_code" required>'+
      discoveryOwnerStates.map(x=>'<option value="'+x+'"'+((d.state_code||'RS')===x?' selected':'')+'>'+x+'</option>').join('')+
    '</select></label>'+
    discoveryOwnerField('city_name','Cidade',d.city_name,'text','required minlength="2" maxlength="120"')+
    discoveryOwnerField('public_area','Bairro ou área aproximada (opcional)',d.public_area,'text','maxlength="140"')+
    discoveryOwnerField('whatsapp_e164','WhatsApp com DDI (ex.: +5555999999999)',d.whatsapp_e164,'tel','required pattern="\\+[1-9][0-9]{7,14}"')+
    discoveryOwnerTypeFields(kind,d)+
    '<label>Fotos públicas do anúncio (JPG, PNG ou WebP, até 5 MB)<input id="discovery-owner-photos" name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple></label>'+
    '<label>Comprovantes para análise privada (PDF ou imagem, até 10 MB; máximo de 4 por envio)<input id="discovery-owner-documents" name="documents" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple></label>'+
    '<p class="tiny muted">Comprovantes não aparecem no anúncio: somente você e o superadministrador podem consultar esses arquivos. Envie apenas documentos necessários.</p>'+
    (Array.isArray(d.documents)&&d.documents.length?
      '<div class="discovery-owner-documents"><p class="tiny muted">Comprovantes anexados: '+d.documents.length+
      '. A remoção fica disponível somente enquanto o anúncio está em rascunho ou rejeitado.</p>'+
      (['draft','rejected'].includes(d.status)?d.documents.map((doc,i)=>
        /^[0-9a-f-]{36}$/.test(String(doc.id||''))?
          '<button type="button" onclick="discoveryOwnerRemoveDocument(&quot;'+doc.id+'&quot;)">Remover comprovante '+(i+1)+'</button>':''
      ).join(''):'')+'</div>':'')+
    (Array.isArray(d.photo_urls)&&d.photo_urls.length?
      '<div class="discovery-owner-photos">'+d.photo_urls.map((p,i)=>{
        const url=discoveryOwnerPhotoUrl(p);
        if(!url)return '';
        const removable=['draft','rejected'].includes(d.status)&&
          String(p).startsWith(s.user.id+'/');
        return '<div class="discovery-owner-photo"><img src="'+esc(url)+'" loading="lazy" alt="Foto '+(i+1)+' do anúncio">'+
          (removable?'<button type="button" onclick="discoveryOwnerRemovePhoto(&quot;'+esc(p)+'&quot;)">Remover foto '+(i+1)+'</button>':'')+'</div>';
      }).join('')+'</div>':'')+
    (s.pendingPhotoRemovals.length?'<button type="button" onclick="discoveryOwnerRetryPhotoCleanup()">'+
      'Repetir limpeza de '+s.pendingPhotoRemovals.length+' foto(s) pendente(s)</button>':'')+
    '<button type="submit" class="primary"'+(s.busy?' disabled':'')+'>Salvar rascunho e fotos</button>'+
    '<p class="tiny muted">O anúncio só aparece para visitantes depois da revisão e da abertura da modalidade nesta cidade.</p>'+
    '</form>';
  return shell('<section class="section discovery-owner">'+header+note+error+
    '<div class="discovery-owner-top"><strong>'+esc(s.user.email||'Conta verificada')+'</strong>'+
    '<button type="button" onclick="discoveryOwnerLogout()">Sair</button></div>'+
    '<div class="discovery-owner-layout"><section><h2>Meus anúncios</h2>'+
      (cards||'<p>Nenhum anúncio cadastrado.</p>')+
      '<button type="button" class="secondary" onclick="discoveryOwnerNew()">Novo anúncio</button></section>'+
      form+'</div></section>');
}
async function discoveryOwnerInit(){
  const s=discoveryOwner;if(s.phase!=='idle')return;
  const returningFromOtp=globalThis.discoveryOwnerReturnPending?.()===true;
  let sdkInitialized=false;
  s.phase='loading';
  try{
    const sdk=await loadSupabaseBrowser();
    s.client=sdk.createClient(CHAMA_BACKEND.url,CHAMA_BACKEND.publishableKey,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,
        storageKey:'tamao-discovery-auth'},global:{fetch:chamaFetch}
    });
    const response=await s.client.auth.getUser();
    sdkInitialized=true;
    s.user=response?.data?.user||null;
    s.phase='ready';
    if(s.user){
      s.pendingPhotoRemovals=discoveryOwnerReadPendingPhotoRemovals(s.user.id);
      await discoveryOwnerRefresh();
    }
  }catch(e){s.phase='failed';s.error='Não foi possível conectar ao cadastro. Verifique a conexão e tente novamente.';}
  if(returningFromOtp&&sdkInitialized){
    // getUser() waits for the Supabase URL-session initialization. Restore
    // navigation only after this step; do not expose a callback token in an
    // app link or place it in query parameters.
    const clean=new URL(location.href);
    clean.searchParams.delete('advertise');
    clean.hash='advertise';
    history.replaceState(null,'',clean.pathname+clean.search+clean.hash);
  }
  if(discoveryOwnerRoute())render();
}
function discoveryOwnerAfterRender(){
  if(discoveryOwnerRoute()&&discoveryOwner.phase==='idle')discoveryOwnerInit();
}
function discoveryOwnerRetryInit(){
  if(discoveryOwner.phase!=='failed')return;
  discoveryOwner.phase='idle';discoveryOwner.error='';
  discoveryOwnerInit();
  if(discoveryOwnerRoute())render();
}
async function discoveryOwnerRefresh(){
  const s=discoveryOwner;if(!s.client||!s.user)return;
  const {data,error}=await s.client.rpc('discovery_my_listings');
  if(error)throw error;
  if(!Array.isArray(data))throw Error('Invalid owner listings response');
  s.items=data.filter(x=>x&&/^[a-f0-9-]{36}$/.test(String(x.id||'')));
}
function discoveryOwnerError(error){
  if(error?.message==='DOCUMENT_CLEANUP_UNCONFIRMED')return 'O comprovante pode ter ficado pendente no armazenamento. Não reenvie este arquivo até o suporte conferir a situação.';
  if(error?.message==='PHOTO_CLEANUP_UNCONFIRMED')return 'O envio das fotos foi interrompido e não foi possível confirmar a limpeza. Confira seu anúncio antes de tentar novamente.';
  const code=String(error?.code||'');
  if(code==='42501')return 'Você não tem permissão para esta operação.';
  if(code==='22023')return 'Confira os campos e as fotos enviadas antes de solicitar revisão.';
  return 'Não foi possível concluir a operação. Confira sua conexão e tente novamente.';
}
async function discoveryOwnerLogin(ev){
  ev?.preventDefault?.();
  const s=discoveryOwner,form=ev?.target;
  const email=String(form?.elements?.email?.value||'').trim();
  if(s.busy||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))return false;
  s.busy=true;s.error='';s.notice='';
  try{
    const dest=location.origin+location.pathname+'?advertise=1';
    const {error}=await s.client.auth.signInWithOtp({email,options:{emailRedirectTo:dest}});
    if(error)throw error;
    s.notice='Link de acesso solicitado. Confira seu e-mail para continuar.';
  }catch(e){s.error=discoveryOwnerError(e);}
  s.busy=false;render();return false;
}
async function discoveryOwnerLogout(){
  const s=discoveryOwner;if(!s.client)return;
  await s.client.auth.signOut();
  s.user=null;s.items=[];s.editor=null;s.pendingPhotoRemovals=[];s.notice='';s.error='';
  if(discoveryOwnerRoute())render();
}
function discoveryOwnerNew(){discoveryOwner.editor=null;discoveryOwner.notice='';discoveryOwner.error='';render();}
function discoveryOwnerTypeChanged(kind){
  const s=discoveryOwner;
  if(!Object.hasOwn(discoveryOwnerTables,kind)||s.editor?.id)return;
  s.kind=kind;s.error='';render();
}
async function discoveryOwnerOpen(id){
  const s=discoveryOwner,listing=s.items.find(x=>x.id===id);
  if(!listing||!['draft','rejected','paused'].includes(listing.status))return;
  s.busy=true;s.error='';
  try{
    // A paused approved listing must be withdrawn before any edit.
    // Reopening creates an audited draft and invalidates the prior approval.
    if(listing.status==='paused'){
      const changed=await s.client.rpc('discovery_transition_listing',{
        p_listing_id:id,p_next_status:'draft',p_reason:'Edição solicitada pelo anunciante'
      });
      if(changed.error)throw changed.error;
      await discoveryOwnerRefresh();
    }
    const table=discoveryOwnerTables[listing.vertical];
    const {data,error}=await s.client.from(table).select('*').eq('listing_id',id).maybeSingle();
    if(error)throw error;
    const documents=await s.client.from('discovery_documents')
      .select('id,kind,created_at,object_path').eq('listing_id',id);
    if(documents.error)throw documents.error;
    s.editor={...listing,...(data||{}),documents:Array.isArray(documents.data)?documents.data:[],
      status:listing.status==='paused'?'draft':listing.status};
    s.kind=listing.vertical;
  }catch(e){s.error=discoveryOwnerError(e);}
  s.busy=false;render();
}
function discoveryOwnerDetails(vertical,f){
  const field=n=>String(f.get(n)||'').trim();
  const nonneg=(name,fallback)=>field(name)===''?fallback:Number(field(name));
  if(vertical==='professionals')return {
    occupation:field('occupation'),service_area:field('service_area'),
    years_experience:nonneg('years_experience',null)
  };
  if(vertical==='rides')return {
    departure_state:field('departure_state').toUpperCase(),
    departure_city:field('departure_city'),
    destination_state:field('destination_state').toUpperCase(),
    destination_city:field('destination_city'),
    departure_at:new Date(field('departure_at')).toISOString(),
    seats_total:nonneg('seats_total',1),seats_available:nonneg('seats_available',1),
    proposed_cost_share_cents:field('proposed_cost_share')===''?null:Math.round(Number(field('proposed_cost_share'))*100),
    route_notes:field('route_notes')||null
  };
  return {
    property_type:field('property_type'),guests:nonneg('guests',2),
    bedrooms:nonneg('bedrooms',1),beds:nonneg('beds',1),units:nonneg('units',1),
    amenities:[...new Set(field('amenities').split(',').map(x=>x.trim()).filter(x=>x&&x.length<=60))].slice(0,20),
    price_from_brl_cents:field('price_from')===''?null:Math.round(Number(field('price_from'))*100),
    price_unit:field('price_from')===''?null:['night','stay','week'].includes(field('price_unit'))?field('price_unit'):'night'
  };
}
async function discoveryOwnerSave(ev){
  ev?.preventDefault?.();
  const s=discoveryOwner;
  if(s.busy||!s.user||!s.client)return false;
  const form=ev?.target; if(!form||!form.checkValidity())return false;
  const f=new FormData(form),get=n=>String(f.get(n)||'').trim();
  const vertical=s.editor?.vertical||get('vertical');
  if(!Object.hasOwn(discoveryOwnerTables,vertical))return false;
  const files=Array.from(document.getElementById('discovery-owner-photos')?.files||[]);
  const documents=Array.from(document.getElementById('discovery-owner-documents')?.files||[]);
  let keys=Array.isArray(s.editor?.photo_urls)?s.editor.photo_urls.slice():[];
  if(files.length+keys.length>18){s.error='No máximo 18 fotos por anúncio.';render();return false;}
  const mime={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
  if(files.some(x=>!mime[x.type]||x.size<1||x.size>5242880)){
    s.error='Use JPG, PNG ou WebP, com até 5 MB por imagem.';render();return false;
  }
  const documentMime={'application/pdf':'pdf',...mime};
  if(documents.length>4||documents.some(x=>!documentMime[x.type]||x.size<1||x.size>10485760)){
    s.error='Use até 4 comprovantes PDF/JPG/PNG/WebP de até 10 MB por envio.';render();return false;
  }
  s.busy=true;s.error='';s.notice='';render();
  let id=s.editor?.id||null;
  try{
    const data={
      title:get('title'),description:get('description'),state_code:get('state_code'),
      city_name:get('city_name'),city_key:discoveryOwnerCitySlug(get('city_name')),
      public_area:get('public_area')||null,whatsapp_e164:get('whatsapp_e164')
    };
    const client=s.client;
    if(!id){
      const result=await client.from('discovery_listings')
        .insert({...data,vertical,photo_urls:[]}).select('id').single();
      if(result.error)throw result.error;
      id=result.data?.id;
    }else{
      const result=await client.from('discovery_listings').update(data).eq('id',id);
      if(result.error)throw result.error;
    }
    if(!/^[a-f0-9-]{36}$/.test(String(id||'')))throw Error('Invalid inserted listing ID');
    const details=discoveryOwnerDetails(vertical,f);
    const saved=await client.from(discoveryOwnerTables[vertical])
      .upsert({listing_id:id,...details},{onConflict:'listing_id'});
    if(saved.error)throw saved.error;
    for(const file of documents){
      const key=s.user.id+'/'+id+'/'+crypto.randomUUID()+'.'+documentMime[file.type];
      const upload=await client.storage.from('tamao-discovery-documents')
        .upload(key,file,{contentType:file.type,upsert:false,cacheControl:'60'});
      if(upload.error)throw upload.error;
      try{
        const registered=await client.from('discovery_documents')
          .insert({listing_id:id,kind:'supporting',object_path:key});
        if(registered.error)throw registered.error;
      }catch(registerError){
        // Storage and PostgREST are separate transactions. Compensate a
        // failed metadata insert via Storage API to avoid an orphaned file.
        try{
          const cleanup=await client.storage.from('tamao-discovery-documents').remove([key]);
          if(cleanup.error)throw cleanup.error;
        }catch{
          throw Error('DOCUMENT_CLEANUP_UNCONFIRMED');
        }
        throw registerError;
      }
    }
    // Storage and PostgREST cannot share one transaction. Track each attempted
    // upload before calling the network: a timeout can hide a committed object.
    const attemptedPhotos=[];
    try{
      for(const file of files){
        const key=s.user.id+'/'+crypto.randomUUID()+'.'+mime[file.type];
        attemptedPhotos.push(key);
        const result=await client.storage.from('tamao-discovery-photos')
          .upload(key,file,{contentType:file.type,upsert:false,cacheControl:'3600'});
        if(result.error)throw result.error;
        keys.push(key);
      }
      if(files.length){
        const written=await client.from('discovery_listings').update({photo_urls:keys}).eq('id',id);
        if(written.error)throw written.error;
      }
    }catch(photoError){
      // The RLS cleanup policy denies deletion if the database already
      // references this image, including when a response was lost in transit.
      let cleanupConfirmed=true;
      for(const key of attemptedPhotos){
        try{
          const removed=await client.storage.from('tamao-discovery-photos').remove([key]);
          if(removed.error)cleanupConfirmed=false;
        }catch{cleanupConfirmed=false;}
      }
      if(!cleanupConfirmed)throw Error('PHOTO_CLEANUP_UNCONFIRMED');
      throw photoError;
    }
    await discoveryOwnerRefresh();
    s.editor=null;s.notice='Rascunho salvo. Você pode enviá-lo para revisão.';
  }catch(e){
    s.error=discoveryOwnerError(e);
    if(id){
      try{await discoveryOwnerRefresh();}catch{}
    }
  }
  s.busy=false;if(discoveryOwnerRoute())render();
  return false;
}
// First unlink an editable photo from the listing; Storage RLS deliberately
// forbids deletion of images still referenced by any owner listing.
// When Storage is unavailable, offer explicit in-session cleanup retry rather
// than claiming that the remote object was deleted.
async function discoveryOwnerRemovePhoto(photoPath){
  const s=discoveryOwner,d=s.editor,key=String(photoPath||'');
  if(s.busy||!s.user||!s.client||!d?.id||
    !['draft','rejected'].includes(d.status)||
    !discoveryOwnerPhotoUrl(key)||!key.startsWith(s.user.id+'/')||
    !Array.isArray(d.photo_urls)||!d.photo_urls.includes(key))return;
  s.busy=true;s.error='';s.notice='';
  try{
    // The authenticated RPC locks the draft and removes only this photo.
    // A stale browser tab must not overwrite photos added in another tab.
    const updated=await s.client.rpc('discovery_unlink_listing_photo',{
      p_listing_id:d.id,p_photo_path:key
    });
    if(updated.error)throw updated.error;
    if(!Array.isArray(updated.data)||updated.data.includes(key))
      throw Error('PHOTO_UNLINK_UNCONFIRMED');
    // Independently read back the owner-scoped state before deleting bytes.
    // Storage RLS separately forbids deleting any photo still referenced.
    await discoveryOwnerRefresh();
    const persisted=s.items.find(item=>item.id===d.id);
    // A second editor may add/remove OTHER images after the RPC commits.
    // Only the target's absence is required; comparing whole arrays would
    // incorrectly treat a legitimate concurrent edit as failed cleanup.
    if(!persisted||!Array.isArray(persisted.photo_urls)||
      persisted.photo_urls.includes(key))
      throw Error('PHOTO_UNLINK_UNCONFIRMED');
    d.photo_urls=persisted.photo_urls.slice();
    try{
      const cleaned=await s.client.storage.from('tamao-discovery-photos').remove([key]);
      if(cleaned.error)throw cleaned.error;
      s.notice='Foto retirada do anúncio e do armazenamento.';
    }catch{
      s.pendingPhotoRemovals=[...new Set([...s.pendingPhotoRemovals,key])];
      const savedLocally=discoveryOwnerPersistPendingPhotoRemovals();
      s.error='A foto saiu do anúncio, mas o arquivo ainda precisa ser removido. Use “Repetir limpeza de fotos pendentes”.'+
        (savedLocally?'':' A pendência não pôde ser guardada para a próxima visita.');
    }
  }catch(e){
    s.error=discoveryOwnerError(e);
  }
  s.busy=false;if(discoveryOwnerRoute())render();
}
async function discoveryOwnerRetryPhotoCleanup(){
  const s=discoveryOwner;
  if(s.busy||!s.user||!s.client||!s.pendingPhotoRemovals.length)return;
  s.busy=true;s.error='';s.notice='';
  const pending=[];
  for(const key of s.pendingPhotoRemovals){
    if(!discoveryOwnerPhotoUrl(key)||!key.startsWith(s.user.id+'/'))continue;
    try{
      const cleaned=await s.client.storage.from('tamao-discovery-photos').remove([key]);
      if(cleaned.error)throw cleaned.error;
    }catch{pending.push(key);}
  }
  s.pendingPhotoRemovals=pending;
  const savedLocally=discoveryOwnerPersistPendingPhotoRemovals();
  if(pending.length){
    s.error='A limpeza das fotos pendentes não foi confirmada. Verifique a conexão e tente novamente.'+
      (savedLocally?'':' A pendência não pôde ser guardada para a próxima visita.');
  }else s.notice='Arquivos de fotos pendentes removidos do armazenamento.';
  s.busy=false;if(discoveryOwnerRoute())render();
}
async function discoveryOwnerRemoveDocument(docId){
  const s=discoveryOwner,d=s.editor;
  if(s.busy||!s.user||!s.client||!d?.id||!['draft','rejected'].includes(d.status))return;
  const doc=(d.documents||[]).find(x=>x.id===docId);
  const expected=s.user.id+'/'+d.id+'/';
  if(!doc||!/^[0-9a-f-]{36}$/.test(String(doc.id||''))||
    !String(doc.object_path||'').startsWith(expected)||
    !/^[0-9a-f-]{36}\.(pdf|jpg|jpeg|png|webp)$/.test(String(doc.object_path).slice(expected.length)))return;
  s.busy=true;s.error='';s.notice='';
  try{
    // Storage API deletes the real bytes; direct SQL deletion of storage.objects
    // would strand the file. Keep metadata if either operation fails for retry.
    const removed=await s.client.storage.from('tamao-discovery-documents').remove([doc.object_path]);
    if(removed.error)throw removed.error;
    const deleted=await s.client.from('discovery_documents').delete()
      .eq('id',doc.id).eq('listing_id',d.id).select('id');
    if(deleted.error)throw deleted.error;
    if(!Array.isArray(deleted.data)||deleted.data.length!==1)
      throw Error('Document metadata cleanup not confirmed');
    s.editor.documents=s.editor.documents.filter(x=>x.id!==docId);
    s.notice='Comprovante removido do rascunho.';
  }catch(e){s.error=discoveryOwnerError(e);}
  s.busy=false;if(discoveryOwnerRoute())render();
}
async function discoveryOwnerSubmit(id){
  const s=discoveryOwner,entry=s.items.find(x=>x.id===id);
  if(s.busy||!entry||!['draft','rejected','paused'].includes(entry.status))return;
  s.busy=true;s.error='';s.notice='';
  try{
    const {error}=await s.client.rpc('discovery_transition_listing',{
      p_listing_id:id,p_next_status:'review',p_reason:'Envio pelo anunciante'
    });
    if(error)throw error;
    await discoveryOwnerRefresh();s.notice='Anúncio enviado para revisão.';
  }catch(e){s.error=discoveryOwnerError(e);}
  s.busy=false;if(discoveryOwnerRoute())render();
}
async function discoveryOwnerPause(id){
  const s=discoveryOwner,entry=s.items.find(x=>x.id===id);
  if(s.busy||entry?.status!=='published')return;
  s.busy=true;s.error='';s.notice='';
  try{
    const {error}=await s.client.rpc('discovery_transition_listing',{
      p_listing_id:id,p_next_status:'paused',p_reason:'Pausa solicitada pelo anunciante'
    });
    if(error)throw error;
    await discoveryOwnerRefresh();s.notice='Anúncio pausado.';
  }catch(e){s.error=discoveryOwnerError(e);}
  s.busy=false;if(discoveryOwnerRoute())render();
}
