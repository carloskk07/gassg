/* TAMÃO V1.1072 — simple, verified owner editor for real participant pages.
 * Loaded only in authenticated participant workspaces, never storefront startup.
 * No duplicate product, driver or appointment registration is created. */
(function tamaoNativePageStyles(){
 if(document.querySelector('link[href*="participant-native-owner.css"]'))return;
 const source=document.querySelector('script[src*="participant-native-owner.js"]')?.src||'';
 const v=source.match(/\?v=[A-Za-z0-9._-]+/)?.[0]||'';
 const link=document.createElement('link');link.rel='stylesheet';
 link.href='/css/participant-native-owner.css'+v;
 document.head.appendChild(link);
})();
const tamaoNativePagesCache=new Map();
const TAMAO_NATIVE_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function tamaoNativePageKind(kind){return ['merchant','listing','agenda','customer','driver','advertiser'].includes(kind)?kind:'';}
function tamaoNativePageKey(kind,id){return kind+':'+(kind==='customer'?'self':id);}
function tamaoNativePageSessionId(kind){
 const session=kind==='merchant'?globalThis.merchantRuntime?.session:
  ['listing','driver'].includes(kind)?{user:globalThis.discoveryOwner?.user}:
  kind==='agenda'?{user:globalThis.agendaRuntime?.user}:globalThis.liveRuntime?.session;
 return String(session?.user?.id||'');
}
function tamaoNativePageClient(kind){
 return kind==='merchant'?globalThis.merchantRuntime?.client:
  ['listing','driver'].includes(kind)?globalThis.discoveryOwner?.client:
  kind==='agenda'?globalThis.agendaRuntime?.client:globalThis.liveRuntime?.client;
}
async function tamaoNativePageAuthenticated(kind){
 const client=tamaoNativePageClient(kind);
 if(!client)throw Error('Entre na sua conta para personalizar a página.');
 const {data,error}=await client.auth.getSession();
 const session=data?.session;
 if(error||!session?.access_token||!TAMAO_NATIVE_ID.test(String(session.user?.id||''))||
    session.user?.is_anonymous===true)throw Error('Entre com seu e-mail para configurar sua página.');
 return session;
}
async function tamaoNativePageApi(kind,payload){
 const auth=await tamaoNativePageAuthenticated(kind);
 const response=await fetch(CHAMA_BACKEND.url+'/functions/v1/participant-pages',{
  method:'POST',headers:{'Content-Type':'application/json',
   apikey:CHAMA_BACKEND.publishableKey,Authorization:'Bearer '+auth.access_token},
  body:JSON.stringify(payload),cache:'no-store'
 });
 const data=await response.json().catch(()=>null);
 if(!response.ok||data?.source!=='participant_native_page_v1_1072'){
  const code=String(data?.error||'UNAVAILABLE');
  const messages={
   NOT_OWNER:'Esta página pertence a outro participante.',
   NOT_PUBLISHED:'Para publicar, ative primeiro seu cadastro ou anúncio oficial.',
   NO_REFERRAL_CODE:'Ative primeiro o seu código na Rede TAMÃO para publicar uma página que registre indicações.',
   LOGIN_REQUIRED:'Entre novamente na sua conta para salvar a página.',
   UNAVAILABLE:'Não foi possível atualizar sua página. Tente novamente.',
   INVALID_TEXT:'Revise o nome ou a mensagem da página.',
   INVALID_THEME:'Selecione um estilo válido.',
   INVALID_LAYOUT:'Selecione um formato de página válido.',
   INVALID_COVER:'Escolha uma foto pública e aprovada do seu cadastro.'
  };
  throw Error(messages[code]||'Não foi possível consultar esta página ('+code+').');
 }
 return data;
}
async function tamaoNativePageMine(kind,subjectId){
 if(!tamaoNativePageKind(kind)||kind!=='customer'&&!TAMAO_NATIVE_ID.test(String(subjectId||'')))return;
 const key=tamaoNativePageKey(kind,subjectId),cache=tamaoNativePagesCache.get(key);
 if(cache?.loading)return;
 const marker={...cache,loading:true,error:'',userId:tamaoNativePageSessionId(kind)};tamaoNativePagesCache.set(key,marker);
 try{
  const session=await tamaoNativePageAuthenticated(kind);
  const res=await tamaoNativePageApi(kind,{action:'mine',kind,subjectId});
  if((await tamaoNativePageAuthenticated(kind)).user.id!==session.user.id)return;
  if(tamaoNativePagesCache.get(key)!==marker)return;
  const photoChoices=Array.isArray(res.photoChoices)?res.photoChoices.filter(x=>
   typeof x==='string'&&/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|jpeg|png|webp)$/.test(x)).slice(0,6):[];
  tamaoNativePagesCache.set(key,{...marker,loading:false,loaded:true,
   page:res.page||null,photoChoices,identityName:res.identityName||'',
   userId:session.user.id,error:''});
 }catch(e){
  // Old requests must never replace a different account's editor or its photos.
  if(tamaoNativePagesCache.get(key)!==marker||
     marker.userId!==tamaoNativePageSessionId(kind))return;
  tamaoNativePagesCache.set(key,{...marker,loading:false,loaded:true,
   error:String(e?.message||e),page:null});
 }
 if(typeof render==='function')render();
}
function tamaoNativePagePublicLink(kind,subjectId){
 const cached=tamaoNativePagesCache.get(tamaoNativePageKey(kind,subjectId));
 return cached?.page?.published===true&&/^https:\/\/tamao\.com\.br\/p\/[a-z0-9-]+\/$/.test(cached.page.url||'')
  ?cached.page.url:'';
}
function tamaoNativePagePanel(kind,subjectId=''){
 if(!tamaoNativePageKind(kind)||kind!=='customer'&&!TAMAO_NATIVE_ID.test(String(subjectId||'')))return '';
 const key=tamaoNativePageKey(kind,subjectId);
 let cache=tamaoNativePagesCache.get(key);
 const sessionId=tamaoNativePageSessionId(kind);
 if(cache?.userId&&cache.userId!==sessionId){tamaoNativePagesCache.delete(key);cache=null;}
 if(!cache||(!cache.loaded&&!cache.loading)){
  tamaoNativePageMine(kind,subjectId);
  return '<section class="card flat tamao-native-page-panel"><h2>Minha página TAMÃO</h2><p role="status">Preparando sua página com os dados do seu cadastro…</p></section>';
 }
 const E=x=>esc(String(x??''));
 if(cache.loading)return '<section class="card flat tamao-native-page-panel"><h2>Minha página TAMÃO</h2><p role="status">Consultando a página…</p></section>';
 if(cache.error)return `<section class="card flat tamao-native-page-panel"><h2>Minha página TAMÃO</h2><p class="muted">${E(cache.error)}</p><button type="button" class="secondary" onclick="tamaoNativePageRetry('${kind}','${subjectId}')">Tentar novamente</button></section>`;
 const id='tamao-native-page-'+kind+'-'+(kind==='customer'?'self':subjectId);
 const p={...(cache.page||{}),...(cache.draft||{})};
 const url=tamaoNativePagePublicLink(kind,subjectId);
 const nice={merchant:'Minha página da revenda',customer:'Minha página de indicações',
  listing:'Minha página de serviços',agenda:'Minha página profissional',
  driver:'Minha página de motorista',advertiser:'Minha página do anunciante'}[kind];
 const copy={merchant:'Seus produtos e sua revenda, com pedido direcionado para você.',
  listing:'Seu serviço e o caminho oficial para o cliente entrar em contato.',
  agenda:'Seu perfil e o caminho direto para agendamentos.',
  driver:'Sua atividade de moto ou carro e as solicitações oficiais.',
  advertiser:'Sua empresa e o endereço aprovado da campanha.',
  customer:'Seu convite personalizado para apresentar o TAMÃO.'}[kind];
 const themes=[['clean','Natural'],['gold','Black Gold'],['rose','Elegance'],
  ['ocean','Ocean'],['sunset','Terracota'],['midnight','Midnight']];
 const layouts=[['split','Destaque dividido'],['centered','Capa em destaque'],['editorial','Editorial']];
 const chosenTheme=themes.some(t=>t[0]===p.theme)?p.theme:'clean';
 const chosenLayout=layouts.some(t=>t[0]===p.layout)?p.layout:'split';
 const options=(values,current)=>values.map(([value,label])=>
  `<option value="${value}"${value===current?' selected':''}>${label}</option>`).join('');
 const check=(name,label,value)=>`<label class="tamao-native-page-check"><input type="checkbox" name="${name}"${value!==false?' checked':''}><span>${label}</span></label>`;
 const labelName=E(cache.identityName||'Seu perfil TAMÃO');
 const title=E(p.headline||cache.identityName||'Seu perfil TAMÃO');
 const sub=E(p.tagline||copy);
 const photos=Array.isArray(cache.photoChoices)?cache.photoChoices.filter(x=>
  typeof x==='string'&&/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|jpeg|png|webp)$/.test(x)).slice(0,6):[];
 const imageURL=key=>'https://lgugwujpunhslavewffd.supabase.co/storage/v1/object/public/tamao-discovery-photos/'+
  key.split('/').map(encodeURIComponent).join('/');
 const selectedPhoto=photos.includes(p.heroPhotoKey)?p.heroPhotoKey:'';
 const activePhoto=selectedPhoto||photos[0]||'';
 const coverSelector=photos.length?'<details class="tamao-native-page-cover-select"><summary>Foto de destaque (opcional)</summary>'+
  '<div class="tamao-native-page-cover-options" role="radiogroup" aria-label="Escolher foto de capa">'+
  '<label class="tamao-native-page-cover-choice"><input type="radio" name="heroPhotoKey" value=""'+
   (!selectedPhoto?' checked':'')+'><span>Automática</span></label>'+
  photos.map((key,i)=>'<label class="tamao-native-page-cover-choice"><input type="radio" name="heroPhotoKey" value="'+E(key)+'"'+
   (selectedPhoto===key?' checked':'')+'><img src="'+E(imageURL(key))+'" alt="Foto '+(i+1)+'" loading="lazy"><span>Foto '+(i+1)+'</span></label>').join('')+
  '</div><p class="tiny muted">São fotos já aprovadas no seu cadastro. Se a escolhida for removida, a página usará outra foto publicada.</p></details>':'';
 const event=`tamaoNativePagePreview('${kind}','${subjectId}')`;
 return `<section class="card flat tamao-native-page-panel" id="${id}" aria-label="${nice}">
  <div class="tamao-native-page-heading"><span class="section-kicker">SUA PRESENÇA DIGITAL</span>
   <h2>${nice}</h2><p>${copy} <strong>Escolha um visual, confira a prévia e publique.</strong> Seu cadastro oficial preenche o restante.</p>
  </div>
  <div class="tamao-native-page-workspace">
   <div class="tamao-native-page-form" oninput="${event}" onchange="${event}">
    <div class="tamao-native-page-design">
     <label>Estilo visual<select class="input" name="theme">${options(themes,chosenTheme)}</select></label>
     <label>Formato da página<select class="input" name="layout">${options(layouts,chosenLayout)}</select></label>
    </div>
    ${coverSelector}
    <details><summary>Ajustar textos (opcional)</summary>
     <label>Frase principal<input class="input" name="headline" maxlength="110" value="${E(p.headline)}" placeholder="Usar o nome oficial automaticamente"></label>
     <label>Mensagem de apresentação<textarea class="input" name="tagline" maxlength="320" rows="3" placeholder="Uma frase sobre seu atendimento">${E(p.tagline)}</textarea></label>
    </details>
    <details><summary>Escolher o que aparece (opcional)</summary>
     ${check('showAbout','Sobre a atividade',p.showAbout)}
     ${['listing','driver','agenda'].includes(kind)?check('showGallery','Galeria de fotos já publicadas',p.showGallery):''}
     ${kind==='merchant'?check('showCatalog','Produtos da minha revenda',p.showCatalog):''}
     ${check('showDiscover','Convite para conhecer outras áreas do TAMÃO',p.showDiscover)}
     <p class="tiny muted">Imagens, serviços e produtos vêm do seu cadastro oficial. O botão principal mantém o destino correto e as regras da Rede.</p>
    </details>
   </div>
   <aside class="tamao-native-page-preview" aria-label="Prévia visual da página">
    <span class="tamao-native-page-preview-label">PRÉVIA IMEDIATA</span>
    <div class="tamao-native-page-mini" data-theme="${chosenTheme}" data-layout="${chosenLayout}">
     <div class="tamao-native-page-mini-art" aria-hidden="true"><img data-preview="cover" class="tamao-native-page-cover-photo" ${activePhoto?'src="'+E(imageURL(activePhoto))+'"':'hidden'} alt=""><span>✦</span><strong>${labelName}</strong></div>
     <div class="tamao-native-page-mini-copy"><span>ESPAÇO OFICIAL TAMÃO</span>
      <strong data-preview="headline">${title}</strong><p data-preview="tagline">${sub}</p><div class="tamao-native-page-mini-cta">Conhecer esta atividade →</div>
     </div>
    </div>
    <p class="tiny muted">A página publicada exibirá apenas seus dados e imagens aprovados. A prévia não publica alterações.</p>
   </aside>
  </div>
  <div class="tamao-native-page-actions">
   <button type="button" class="primary" onclick="tamaoNativePageSave('${kind}','${subjectId}',true)"${cache.busy?' disabled':''}>${cache.busy?'Salvando…':p.published?'Salvar e atualizar página':'Criar e publicar minha página'}</button>
   ${p.published?`<button type="button" class="secondary" onclick="tamaoNativePageSave('${kind}','${subjectId}',false)"${cache.busy?' disabled':''}>Despublicar</button>`:''}
   ${url?`<a class="secondary" href="${E(url)}" target="_blank" rel="noopener noreferrer">Ver página</a>`:''}
   ${url?`<button class="secondary" type="button" onclick="tamaoNativePageShare('${kind}','${subjectId}')">Copiar ou compartilhar</button>`:''}
   ${url?`<a class="secondary tamao-native-page-whatsapp" href="https://wa.me/?text=${encodeURIComponent('Conheça minha página no TAMÃO: '+url)}" target="_blank" rel="noopener noreferrer nofollow">Enviar pelo WhatsApp</a>`:''}
  </div>
  ${url?`<p class="tamao-native-page-url"><strong>Meu endereço:</strong> <a href="${E(url)}" target="_blank" rel="noopener noreferrer">${E(url)}</a></p>`:''}
  ${cache.savedMessage?`<p role="status" class="tiny">${E(cache.savedMessage)}</p>`:''}
  <p class="tiny muted">Seu link permanece o mesmo ao personalizar. Indicações dependem das regras de elegibilidade; visitas não geram recompensas por si só.</p>
 </section>`;
}

function tamaoNativePagePreview(kind,subjectId){
 const id='tamao-native-page-'+kind+'-'+(kind==='customer'?'self':subjectId);
 const container=document.getElementById(id);
 if(!container)return;
 const form=container.querySelector('.tamao-native-page-form');
 const preview=container.querySelector('.tamao-native-page-mini');
 if(!form||!preview)return;
 const theme=form.querySelector('[name="theme"]')?.value||'clean';
 const layout=form.querySelector('[name="layout"]')?.value||'split';
 preview.dataset.theme=['clean','gold','rose','ocean','sunset','midnight'].includes(theme)?theme:'clean';
 preview.dataset.layout=['split','centered','editorial'].includes(layout)?layout:'split';
 const cache=tamaoNativePagesCache.get(tamaoNativePageKey(kind,subjectId));
 const name=String(cache?.identityName||'Seu perfil TAMÃO');
 const title=String(form.querySelector('[name="headline"]')?.value||'').trim()||name;
 const tagline=String(form.querySelector('[name="tagline"]')?.value||'').trim()||
  'Conheça esta atividade e as oportunidades no TAMÃO.';
 preview.querySelector('[data-preview="headline"]').textContent=title;
 preview.querySelector('[data-preview="tagline"]').textContent=tagline;
 const photos=Array.isArray(cache?.photoChoices)?cache.photoChoices:[];
 const selected=form.querySelector('[name="heroPhotoKey"]:checked')?.value||'';
 const key=(photos.includes(selected)?selected:'')||photos[0]||'';
 const photo=preview.querySelector('[data-preview="cover"]');
 if(photo){
  photo.hidden=!key;
  if(key&&/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|jpeg|png|webp)$/.test(key))
   photo.src='https://lgugwujpunhslavewffd.supabase.co/storage/v1/object/public/tamao-discovery-photos/'+
    key.split('/').map(encodeURIComponent).join('/');
 }
}

function tamaoNativePageRetry(kind,id){
 tamaoNativePagesCache.delete(tamaoNativePageKey(kind,id));
 tamaoNativePageMine(kind,id);
 render();
}
async function tamaoNativePageSave(kind,subjectId,published){
 const key=tamaoNativePageKey(kind,subjectId),cache=tamaoNativePagesCache.get(key);
 if(!cache||cache.busy||!cache.loaded)return;
 const id='tamao-native-page-'+kind+'-'+(kind==='customer'?'self':subjectId),container=document.getElementById(id);
 if(!container)return;
 const theme=container.querySelector('[name="theme"]')?.value||'clean';
 const layout=container.querySelector('[name="layout"]')?.value||'split';
 const value=name=>container.querySelector('[name="'+name+'"]')?.checked!==false;
 const showAbout=value('showAbout'),showGallery=value('showGallery');
 const showCatalog=value('showCatalog'),showDiscover=value('showDiscover');
 const headline=container.querySelector('[name="headline"]')?.value||'';
 const tagline=container.querySelector('[name="tagline"]')?.value||'';
 const heroPhotoKey=container.querySelector('[name="heroPhotoKey"]:checked')?.value||'';
 const previous=cache.page?.published===true;
 const startedUser=tamaoNativePageSessionId(kind);
 cache.draft={theme,layout,showAbout,showGallery,showCatalog,showDiscover,headline,tagline,heroPhotoKey};
 cache.busy=true;cache.error='';cache.savedMessage='';render();
 try{
  const result=await tamaoNativePageApi(kind,{action:'save',kind,subjectId,published,theme,layout,
   showAbout,showGallery,showCatalog,showDiscover,headline,tagline,heroPhotoKey});
  if(tamaoNativePageSessionId(kind)!==startedUser)return;
  const updated=tamaoNativePagesCache.get(key);
  if(updated&&updated.userId===startedUser){
   updated.page=result.page;updated.draft=null;updated.identityName=result.identityName||updated.identityName||'';
   updated.savedMessage=published?'Sua página está publicada e pronta para compartilhar.':'Sua página não está mais visível publicamente.';
   updated.busy=false;updated.error='';
  }
 }catch(e){
  if(tamaoNativePageSessionId(kind)!==startedUser)return;
  const updated=tamaoNativePagesCache.get(key);
  if(updated&&updated.userId===startedUser){
   updated.busy=false;updated.savedMessage=String(e?.message||e);
   updated.page=cache.page||{published:previous};
  }
 }finally{render();}
}
async function tamaoNativePageShare(kind,subjectId){
 const url=tamaoNativePagePublicLink(kind,subjectId);
 if(!url)return toast('Publique sua página para obter o link.');
 try{
  if(navigator.share){await navigator.share({title:'Minha página TAMÃO',url});return}
  if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url);toast('Página copiada para compartilhar');return}
 }catch(e){if(e?.name==='AbortError')return;}
 toast('Copie o endereço exibido na sua página.');
}
