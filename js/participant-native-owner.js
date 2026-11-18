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
function tamaoNativePageKind(kind){return ['merchant','listing','agenda','customer'].includes(kind)?kind:'';}
function tamaoNativePageKey(kind,id){return kind+':'+(kind==='customer'?'self':id);}
function tamaoNativePageSessionId(kind){
 const session=kind==='merchant'?globalThis.merchantRuntime?.session:
  kind==='listing'?{user:globalThis.discoveryOwner?.user}:
  kind==='agenda'?{user:globalThis.agendaRuntime?.user}:globalThis.liveRuntime?.session;
 return String(session?.user?.id||'');
}
function tamaoNativePageClient(kind){
 return kind==='merchant'?globalThis.merchantRuntime?.client:
  kind==='listing'?globalThis.discoveryOwner?.client:
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
   LOGIN_REQUIRED:'Entre novamente na sua conta para salvar a página.',
   UNAVAILABLE:'Não foi possível atualizar sua página. Tente novamente.',
   INVALID_TEXT:'Revise o nome ou a mensagem da página.',
   INVALID_THEME:'Selecione um estilo válido.'
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
  tamaoNativePagesCache.set(key,{...marker,loading:false,loaded:true,page:res.page||null,userId:session.user.id,error:''});
 }catch(e){
  tamaoNativePagesCache.set(key,{...marker,loading:false,loaded:true,error:String(e?.message||e),page:null});
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
 if(cache.loading)return '<section class="card flat tamao-native-page-panel"><h2>Minha página TAMÃO</h2><p role="status">Consultando a página…</p></section>';
 if(cache.error)return '<section class="card flat tamao-native-page-panel"><h2>Minha página TAMÃO</h2>'+
  '<p class="muted">'+esc(cache.error)+'</p><button type="button" class="secondary" onclick="tamaoNativePageRetry(\''+kind+'\',\''+subjectId+'\')">Tentar novamente</button></section>';
 const id='tamao-native-page-'+kind+'-'+(kind==='customer'?'self':subjectId),p=cache.page||{};
 const url=tamaoNativePagePublicLink(kind,subjectId);
 const nice={merchant:'Minha página da revenda',customer:'Minha página de indicações',
  listing:'Minha página de serviços',agenda:'Minha página profissional'}[kind];
 const escape=x=>esc(String(x||''));
 return '<section class="card flat tamao-native-page-panel" id="'+id+'" aria-label="'+nice+'">'+
  '<div class="tamao-native-page-heading"><span class="section-kicker">MINHA IDENTIDADE NO TAMÃO</span>'+
  '<h2>'+nice+'</h2><p>Os dados reais do seu cadastro aparecem automaticamente. '+
  (kind==='merchant'?'Clientes podem conhecer seus produtos e comprar diretamente da sua revenda, se houver atendimento habilitado.':
   kind==='listing'?'Clientes podem conhecer o anúncio e entrar em contato pelo caminho oficial.':
   kind==='agenda'?'Clientes podem conhecer você e agendar pela sua Agenda.':
   'Compartilhe seu espaço para apresentar o TAMÃO com seu código de indicação.')+
  '</p></div>'+
  '<div class="tamao-native-page-form">'+
   '<label>Estilo da página<select class="input" name="theme">'+
    [['clean','Clean'],['gold','Black Gold'],['rose','Elegance']].map(([val,label])=>
      '<option value="'+val+'"'+((p.theme||'clean')===val?' selected':'')+'>'+label+'</option>').join('')+'</select></label>'+
   '<details><summary>Personalizar apresentação (opcional)</summary>'+
    '<label>Frase de destaque<input class="input" name="headline" maxlength="110" value="'+escape(p.headline)+'" placeholder="O nome do cadastro já aparece automaticamente"></label>'+
    '<label>Uma mensagem sobre você ou sua empresa<textarea class="input" name="tagline" maxlength="320" rows="3" placeholder="Diga em poucas palavras por que visitar sua página">'+escape(p.tagline)+'</textarea></label>'+
   '</details>'+
  '</div>'+
  '<div class="tamao-native-page-actions">'+
   '<button type="button" class="primary" onclick="tamaoNativePageSave(\''+kind+'\',\''+subjectId+'\',true)"'+(cache.busy?' disabled':'')+'>'+
    (p.published?'Salvar e atualizar página':'Criar e publicar minha página')+'</button>'+
   (p.published?'<button type="button" class="secondary" onclick="tamaoNativePageSave(\''+kind+'\',\''+subjectId+'\',false)"'+(cache.busy?' disabled':'')+'>Despublicar</button>':'')+
   (url?'<a class="secondary" href="'+escape(url)+'" target="_blank" rel="noopener noreferrer">Ver página</a>':'')+
   (url?'<button class="secondary" type="button" onclick="tamaoNativePageShare(\''+kind+'\',\''+subjectId+'\')">Compartilhar</button>':'')+
  '</div>'+
  (url?'<p class="tamao-native-page-url"><strong>Meu endereço:</strong> <a href="'+escape(url)+'" target="_blank" rel="noopener noreferrer">'+escape(url)+'</a></p>':'')+
  (cache.savedMessage?'<p role="status" class="tiny">'+escape(cache.savedMessage)+'</p>':'')+
  '<p class="tiny muted">Sua página permanece com o mesmo endereço. As indicações seguem a elegibilidade da Rede; esta página não concede bônus por cliques nem altera taxas.</p>'+
 '</section>';
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
 const headline=container.querySelector('[name="headline"]')?.value||'';
 const tagline=container.querySelector('[name="tagline"]')?.value||'';
 const previous=cache.page?.published===true;
 cache.busy=true;cache.error='';cache.savedMessage='';render();
 try{
  const result=await tamaoNativePageApi(kind,{action:'save',kind,subjectId,published,theme,headline,tagline});
  const updated=tamaoNativePagesCache.get(key);
  if(updated){
   updated.page=result.page;
   updated.savedMessage=published?'Sua página está publicada e pronta para compartilhar.':'Sua página não está mais visível publicamente.';
   updated.busy=false;updated.error='';
  }
 }catch(e){
  const updated=tamaoNativePagesCache.get(key);
  if(updated){updated.busy=false;updated.savedMessage=String(e?.message||e);updated.page=cache.page||{published:previous};}
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
