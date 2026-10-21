/* TAMÃO: opt-in live mobility, lazily loaded; no dispatch/payment promises. */
(function mobilityStyles(){
 if(document.querySelector('link[href*="/css/mobility.css"]'))return;
 const link=document.createElement('link'),source=document.querySelector('script[src*="/js/mobility.js"]')?.src||'';
 link.rel='stylesheet';link.href='./css/mobility.css'+(source.match(/\?v=[A-Za-z0-9._-]+/)?.[0]||'');
 document.head.appendChild(link);
})();

const mobilityRuntime={phase:'idle',client:null,user:null,items:[],detail:null,
 id:'',busy:false,notice:'',error:'',watch:null,poll:null,lastPublish:0,
 mapConsent:false,mapKey:'',mapFrameAt:0,gpsPending:false,gpsRequestId:'',gpsEpoch:0};
const mobilityId=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const mobilityStates={
 requested:'Aguardando resposta do anunciante',accepted:'Aceita pelo motorista',
 en_route:'Motorista a caminho',arrived:'Motorista chegou',
 completed:'Atendimento encerrado',cancelled:'Solicitação cancelada',
 rejected:'Solicitação recusada',expired:'Solicitação expirada'
};
function mobilityReturnPending(){
 try{return !globalThis.adminPortalRequested?.()&&!globalThis.merchantPortalRequested?.()&&
  new URLSearchParams(location.search).get('mobility')==='1';}catch{return false;}
}
function mobilityRoute(){return (route()==='mobility'||mobilityReturnPending())&&
 !globalThis.adminPortalRequested?.()&&!globalThis.merchantPortalRequested?.();}
function mobilityIntent(){
 try{
  const params=new URLSearchParams(location.search);
  const id=params.get('corrida')||'',mode=params.get('modalidade')||'';
  return mobilityId.test(id)&&['moto','carro'].includes(mode)?{id,mode}:null;
 }catch{return null;}
}
function mobilityLabel(row){
 return esc(String(row?.listing_title||'Profissional TAMÃO').slice(0,120));
}
function mobilityService(mode){return mode==='moto'?'moto':'carro';}
function mobilityStatus(row){return mobilityStates[row?.status]||'Status indisponível';}
function mobilityFormatDate(value){
 const t=Date.parse(String(value||''));
 return Number.isFinite(t)?new Date(t).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'';
}
function mobilityMapUrl(pos){
 // Reject malformed coordinates rather than interpreting null as latitude 0.
 const lat=pos?.lat,lon=pos?.lon;
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<-90||lat>90||lon<-180||lon>180)return '';
 const a=Math.max(-90,lat-0.009).toFixed(6),b=Math.max(-180,lon-0.012).toFixed(6),
  c=Math.min(90,lat+0.009).toFixed(6),d=Math.min(180,lon+0.012).toFixed(6);
 const p=lat.toFixed(6),q=lon.toFixed(6);
 return 'https://www.openstreetmap.org/export/embed.html?bbox='+
  encodeURIComponent([b,a,d,c].join(','))+'&layer=mapnik&marker='+encodeURIComponent(p+','+q);
}
// Enforce the backend's 45-second expiry independently in the browser.
 // A lost connection must not leave an obsolete vehicle marker visible.
function mobilityFreshPosition(row){
 if(row?.status!=='en_route'||!row.position)return null;
 const time=Date.parse(String(row.position.updated_at||''));
 const age=Date.now()-time;
 if(!Number.isFinite(time)||age< -10000||age>=45000)return null;
 return mobilityMapUrl(row.position)?row.position:null;
}
function mobilityMapPanel(row){
 const p=mobilityFreshPosition(row),url=mobilityMapUrl(p),active=row?.status==='en_route';
 if(!active)return '<p class="mobility-gps-note">O mapa fica disponível após o motorista iniciar o deslocamento e permitir o GPS.</p>';
 if(!p||!url)return '<p class="mobility-gps-note" role="status">Aguardando localização autorizada. O motorista pode estar sem sinal, GPS ou com a tela inativa.</p>';
 const date=mobilityFormatDate(p.updated_at);
 return '<section class="mobility-mapbox" aria-label="Localização compartilhada do motorista">'+
  '<p id="mobility-position-text">Última atualização: '+esc(date)+'. Precisão aproximada: '+Math.round(Number(p.accuracy_m)||0)+' m.</p>'+
  (mobilityRuntime.mapConsent
   ?'<iframe id="mobility-map" loading="lazy" title="Mapa de acompanhamento do motorista no OpenStreetMap" referrerpolicy="no-referrer" src="'+esc(url)+'"></iframe>'
   :'<p>O mapa é fornecido pelo OpenStreetMap. Ao abri-lo, a posição atual do motorista é enviada ao serviço de mapas.</p>'+
    '<button type="button" onclick="mobilityOpenMap()">Mostrar o mapa do motorista</button>')+
  '<p class="tiny muted">A posição só é compartilhada nesta solicitação enquanto o motorista a autorizar. Não é uma rota nem um tempo estimado.</p></section>';
}
function mobilityListCard(item){
 if(!mobilityId.test(String(item?.id||'')))return '';
 const isDriver=item.role==='driver',open=['requested','accepted','en_route','arrived'].includes(item.status);
 return '<article class="mobility-list-card"><strong>'+mobilityLabel(item)+'</strong>'+
  '<small>'+esc(item.service==='moto'?'🏍️ Moto':'🚕 Carro')+
  ' · '+esc(mobilityStatus(item))+' · '+(isDriver?'Recebida':'Enviada')+'</small>'+
  '<p>'+esc(String(item.origin||'').slice(0,120))+' → '+esc(String(item.destination||'').slice(0,120))+'</p>'+
  '<button type="button" onclick="mobilityFocus(\''+item.id+'\')">Ver '+(open?'andamento':'detalhes')+'</button></article>';
}
function mobilityAction(action,label,kind='secondary'){
 return '<button type="button" class="'+kind+'" onclick="mobilityTransition(\''+action+'\')"'+
 (mobilityRuntime.busy?' disabled':'')+'>'+label+'</button>';
}
function mobilityDetailPanel(row){
 if(!row)return '';
 const driver=row.role==='driver',status=row.status,terminal=!['requested','accepted','en_route','arrived'].includes(status);
 let actions='';
 if(driver){
  if(status==='requested')actions=mobilityAction('accept','Aceitar atendimento','primary')+
   mobilityAction('reject','Recusar');
  if(status==='accepted')actions=mobilityAction('depart','Iniciar deslocamento','primary');
  if(status==='en_route')actions=mobilityAction('arrive','Cheguei','primary');
  if(status==='arrived')actions=mobilityAction('finish','Finalizar atendimento','primary');
 }
 if(!terminal&&status!=='requested'&&driver){
  actions+=(mobilityRuntime.watch===null&&!mobilityRuntime.gpsPending&&status==='en_route'
   ?'<button type="button" onclick="mobilityStartTracking()">Compartilhar meu GPS agora</button>':'');
  if(mobilityRuntime.watch!==null)actions+='<button type="button" onclick="mobilityStopTracking()">Parar compartilhamento</button>';
 }
 if(!terminal&&!(driver&&status==='requested'))actions+=mobilityAction('cancel','Cancelar solicitação');
 return '<section class="mobility-active" aria-label="Atendimento selecionado">'+
  '<h2>'+mobilityLabel(row)+'</h2><p class="mobility-status">'+esc(mobilityStatus(row))+'</p>'+
  '<p>'+esc(String(row.origin||'').slice(0,120))+' → '+esc(String(row.destination||'').slice(0,120))+'</p>'+
  '<p class="tiny muted">Este pedido não garante disponibilidade, preço nem transporte. Combine condições com o anunciante.</p>'+
  '<p><a class="mobility-report-link" href="/?suporte=corrida&protocolo='+esc(String(row.id||''))+'#contact">Relatar problema com este atendimento</a></p>'+
  (driver&&status==='en_route'?'<p>Compartilhar sua localização é voluntário. Mantenha esta página aberta e visível. Você pode parar a qualquer momento.</p>':'')+
  '<div class="mobility-actions">'+actions+'</div>'+
  (!driver?mobilityMapPanel(row):'')+
  '<p class="tiny muted">Solicitação até '+esc(mobilityFormatDate(row.expires_at))+'.</p></section>';
}
function mobilityPage(){
 if(!mobilityRoute())return shell('<section class="section"><h1>Não encontrado</h1></section>');
 const s=mobilityRuntime,intent=mobilityIntent();
 const top='<header><span class="section-kicker">TAMÃO • MOBILIDADE</span>'+
 '<h1>Solicitações de moto e carro</h1>'+
 '<p>Peça atendimento a um profissional anunciado. Após aceite, acompanhe o deslocamento somente quando ele permitir compartilhar o GPS.</p></header>';
 const note=s.notice?'<p class="notice success" role="status">'+esc(s.notice)+'</p>':'';
 const error=s.error?'<p class="notice danger" role="alert">'+esc(s.error)+'</p>':'';
 if(s.phase==='idle'||s.phase==='loading')return shell('<section class="section mobility-page">'+top+'<p role="status">Preparando sua área segura…</p></section>');
 if(s.phase==='failed')return shell('<section class="section mobility-page">'+top+error+
  '<button onclick="mobilityRetry()">Tentar novamente</button></section>');
 if(!s.user)return shell('<section class="section mobility-page">'+top+
  '<p>Entre com seu e-mail para enviar pedidos ou atender solicitações de seus anúncios. Não mostraremos posições sem autenticação.</p>'+
  '<p><a href="/#contact">Precisa de ajuda? Fale com o suporte TAMÃO</a></p>'+
  note+error+'<form class="mobility-form" onsubmit="return mobilityLogin(event)">'+
  '<label>E-mail<input name="email" type="email" required maxlength="254" autocomplete="email"></label>'+
  '<button class="primary" type="submit"'+(s.busy?' disabled':'')+'>Receber link de acesso</button></form></section>');
 const form=intent?'<section class="mobility-start"><h2>Solicitar '+(intent.mode==='moto'?'uma moto':'um carro')+'</h2>'+
  '<p>O anúncio é verificado novamente no servidor. Não informe endereço residencial ou dados sensíveis nesta etapa.</p>'+
  '<form class="mobility-form" onsubmit="return mobilityCreate(event)">'+
  '<label>Origem aproximada<input name="origin" minlength="3" maxlength="120" required placeholder="Bairro ou região"></label>'+
  '<label>Destino aproximado<input name="destination" minlength="3" maxlength="120" required placeholder="Bairro ou região"></label>'+
  '<button class="primary" type="submit"'+(s.busy?' disabled':'')+'>Enviar solicitação ao anunciante</button></form></section>':'';
 return shell('<section class="section mobility-page">'+top+note+error+
  '<p class="mobility-account">Conta: '+esc(String(s.user.email||'verificada').slice(0,254))+
  ' <button type="button" onclick="mobilityRefresh()">Atualizar atendimentos</button>'+
  ' <button type="button" onclick="mobilityLogout()">Sair e parar localização</button></p>'+
  '<p class="tiny muted">Problema ao receber pedido, aceitar atendimento ou acompanhar o mapa? Use “Relatar problema” na solicitação. Não envie coordenadas de GPS ao suporte.</p>'+
  form+mobilityDetailPanel(s.detail)+
  '<section aria-label="Minhas solicitações"><h2>Minhas solicitações e atendimentos</h2>'+
  (s.items.length?'<div class="mobility-list">'+s.items.map(mobilityListCard).join('')+'</div>':
  '<p>Nenhuma solicitação. Motoristas recebem aqui os pedidos enviados aos seus anúncios publicados.</p>')+
  '</section></section>');
}
async function mobilityInit(){
 const s=mobilityRuntime;if(s.phase!=='idle')return;
 s.phase='loading';
 try{
  const sdk=await loadSupabaseBrowser();
  s.client=sdk.createClient(CHAMA_BACKEND.url,CHAMA_BACKEND.publishableKey,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,
     storageKey:'tamao-discovery-auth'},global:{fetch:chamaFetch}});
  const res=await s.client.auth.getUser();
  s.user=res?.data?.user||null;
  // Signing out in this or another browser tab clears private cached
  // trips and embedded location even if no further polling is possible.
  s.client.auth.onAuthStateChange?.((event,session)=>{
   if(event==='SIGNED_OUT'){mobilityClearSession();return}
   // Switching accounts must never reuse another participant's cached GPS.
   const next=session?.user;
   if((event==='SIGNED_IN'||event==='TOKEN_REFRESHED')&&next?.id&&
      next.id!==s.user?.id){
    mobilityClearSession();
    s.user=next;
    if(mobilityRoute())mobilityRefresh();
   }
  });
  s.phase='ready';
  if(mobilityReturnPending()){
   const url=new URL(location.href);
   url.searchParams.delete('mobility');url.hash='mobility';
   history.replaceState(null,'',url.pathname+url.search+url.hash);
  }
  if(s.user)await mobilityRefresh();
 }catch(_){s.phase='failed';s.error='Não foi possível acessar as solicitações. Tente mais tarde.';}
 if(mobilityRoute())render();
}
function mobilityClearSession(){
 const s=mobilityRuntime;
 if(s.watch!==null||s.gpsPending)mobilityStopTracking();
 const frame=document.getElementById?.('mobility-map');
 if(frame){frame.removeAttribute?.('src');frame.remove?.()}
 s.user=null;s.items=[];s.detail=null;s.id='';
 s.mapConsent=false;s.mapKey='';s.mapFrameAt=0;
 s.error='';s.notice='';s.busy=false;
 if(mobilityRoute())render();
}
async function mobilityLogout(){
 const s=mobilityRuntime;
 if(!s.client||!s.user||s.busy)return false;
 s.busy=true;
 try{
  // Server revocation must precede auth sign-out while an access token exists.
  if(s.watch!==null||s.gpsPending)await mobilityStopTracking();
  const r=await s.client.auth.signOut();
  if(r?.error)throw r.error;
  mobilityClearSession();
  return true;
 }catch(_){
  s.busy=false;
  s.error='Não foi possível encerrar a sessão. Tente novamente.';
  render();return false;
 }
}
function mobilityAfterRender(){
 const s=mobilityRuntime;
 if(!mobilityRoute()){
  if(s.watch!==null||s.gpsPending)mobilityStopTracking();
  if(s.poll!==null){clearInterval(s.poll);s.poll=null}
  return;
 }
 if(s.phase==='idle'){mobilityInit();return}
 if(s.phase==='ready'&&s.user&&s.poll===null){
  s.poll=setInterval(()=>{if(mobilityRoute()&&document.visibilityState!=='hidden')mobilityRefresh(true)},10000);
 }
}
function mobilityRetry(){
 mobilityRuntime.phase='idle';mobilityRuntime.error='';mobilityInit();render();
}
async function mobilityLogin(event){
 event.preventDefault();
 const s=mobilityRuntime,form=event.target,email=String(new FormData(form).get('email')||'').trim();
 if(s.busy||!s.client||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))return false;
 s.busy=true;s.error='';
 const intent=mobilityIntent(),url=new URL(location.origin+location.pathname);
 url.searchParams.set('mobility','1');
 if(intent){url.searchParams.set('corrida',intent.id);url.searchParams.set('modalidade',intent.mode)}
 try{
  const {error}=await s.client.auth.signInWithOtp({email,options:{emailRedirectTo:url.toString()}});
  if(error)throw error;
  s.notice='Confira seu e-mail e use o link para entrar nesta área.';
 }catch(_){s.error='Não foi possível enviar o acesso. Confira o e-mail e tente novamente.'}
 s.busy=false;render();return false;
}
async function mobilityRefresh(silent=false){
 const s=mobilityRuntime;
 if(!s.client||!s.user)return false;
 // Refreshes may be throttled when backgrounded. Expire a cached marker
 // immediately when the next foreground check runs, even if the RPC fails.
 if(s.detail?.position&&!mobilityFreshPosition(s.detail)){
  s.detail={...s.detail,position:null};
  mobilityUpdateMap(s.detail);
  if(mobilityRoute())render();
 }
 try{
  const {data,error}=await s.client.rpc('mobility_my_requests');
  if(error)throw error;
  const items=Array.isArray(data)?data:[];
  if(items.length>30)throw Error('Invalid response');
  const before=JSON.stringify(s.items);s.items=items;
  let changed=before!==JSON.stringify(items);
  if(s.id){
   const res=await s.client.rpc('mobility_snapshot',{p_request_id:s.id});
   if(res.error)throw res.error;
   const next=res.data||null;
   const prevStatus=s.detail?.status;
   const oldPosition=s.detail?.position||null;
   const prevPosition=JSON.stringify(oldPosition);
   s.detail=next;
   changed=changed||prevStatus!==next?.status;
   if((s.watch!==null||s.gpsPending)&&(next?.status!=='en_route'||next?.role!=='driver'))mobilityStopTracking();
   if(prevPosition!==JSON.stringify(next?.position||null)){
    // An iframe from a revoked/stale GPS point must not survive a silent poll.
    // Re-render when tracking starts or ends, otherwise refresh only the marker.
    if(Boolean(oldPosition)!==Boolean(next?.position))changed=true;
    else if(!changed)mobilityUpdateMap(next);
   }
  }
  if(!silent||changed)if(mobilityRoute())render();
  return true;
 }catch(_){
  // A network outage never authorizes keeping an old map on screen.
  if(s.detail?.position){
   s.detail={...s.detail,position:null};
   mobilityUpdateMap(s.detail);
   if(mobilityRoute())render();
  }
  if(!silent){s.error='Não foi possível atualizar. Confira a conexão.';render()}
  return false;
 }
}
function mobilityFocus(id){
 if(!mobilityId.test(String(id||''))||!mobilityRuntime.items.some(x=>x.id===id))return false;
 if(mobilityRuntime.watch!==null||mobilityRuntime.gpsPending)mobilityStopTracking();
 mobilityRuntime.id=id;mobilityRuntime.detail=null;mobilityRuntime.mapConsent=false;
 mobilityRuntime.mapKey='';mobilityRefresh();return true;
}
async function mobilityCreate(event){
 event.preventDefault();
 const s=mobilityRuntime,intent=mobilityIntent(),form=new FormData(event.target);
 const origin=String(form.get('origin')||'').trim(),destination=String(form.get('destination')||'').trim();
 if(!intent||!s.user||s.busy)return false;
 if(origin.length<3||origin.length>120||destination.length<3||destination.length>120){
  s.error='Informe origem e destino aproximados.';render();return false;
 }
 s.busy=true;s.error='';
 try{
  const r=await s.client.rpc('mobility_create_request',{
   p_listing_id:intent.id,p_service:intent.mode,p_origin_area:origin,p_destination_area:destination
  });
  if(r.error||!mobilityId.test(String(r.data||'')))throw r.error||Error('invalid id');
  s.id=r.data;s.notice='Solicitação enviada. Aguarde o aceite do anunciante.';
  await mobilityRefresh();
 }catch(_){s.error='Não foi possível solicitar. O anunciante pode estar indisponível ou já haver uma solicitação sua.'}
 s.busy=false;render();return false;
}
async function mobilityTransition(action){
 const s=mobilityRuntime;
 if(!s.client||!s.user||s.busy||!mobilityId.test(s.id)||!
  ['accept','depart','arrive','finish','reject','cancel'].includes(action))return false;
 s.busy=true;s.error='';render();
 try{
  if(s.watch!==null||s.gpsPending)await mobilityStopTracking();
  const r=await s.client.rpc('mobility_transition',{p_request_id:s.id,p_action:action});
  if(r.error)throw r.error;
  s.notice='Situação atualizada: '+(mobilityStates[r.data]||'consulte o atendimento')+'.';
  await mobilityRefresh();
 }catch(_){s.error='Não foi possível atualizar. Revise o estado da solicitação.'}
 s.busy=false;render();return false;
}
function mobilityOpenMap(){
 const s=mobilityRuntime;
 if(s.detail?.role!=='rider'||!mobilityFreshPosition(s.detail))return false;
 s.mapConsent=true;s.mapKey='';s.mapFrameAt=0;render();return true;
}
function mobilityUpdateMap(row){
 const el=document.getElementById?.('mobility-position-text');
 const position=mobilityFreshPosition(row);
 if(!position){
  if(el)el.textContent='Localização temporariamente indisponível.';
  // Defense in depth: never retain an iframe pointing to a revoked position.
  const frame=document.getElementById?.('mobility-map');
  if(frame){frame.removeAttribute?.('src');frame.remove?.()}
  mobilityRuntime.mapKey='';mobilityRuntime.mapFrameAt=0;
  return;
 }
 if(el)el.textContent='Última atualização: '+mobilityFormatDate(position.updated_at)+
  '. Precisão aproximada: '+Math.round(Number(position.accuracy_m)||0)+' m.';
 if(!mobilityRuntime.mapConsent)return;
 const frame=document.getElementById?.('mobility-map'),url=mobilityMapUrl(position);
 if(frame&&url&&url!==mobilityRuntime.mapKey&&Date.now()-mobilityRuntime.mapFrameAt>30000){
  frame.src=url;mobilityRuntime.mapKey=url;mobilityRuntime.mapFrameAt=Date.now();
 }
}
async function mobilityStartTracking(){
 const s=mobilityRuntime,d=s.detail;
 if(s.watch!==null||s.gpsPending||!s.client||!s.user||d?.role!=='driver'||
  d.status!=='en_route'||!mobilityId.test(String(d.id||'')))return false;
 if(document.visibilityState==='hidden'||!globalThis.isSecureContext||!navigator.geolocation){
  s.error='GPS indisponível. Use o site por HTTPS com a tela visível.';render();return false;
 }
 const id=d.id,client=s.client,epoch=++s.gpsEpoch;
 s.gpsRequestId=id;s.gpsPending=true;s.lastPublish=0;s.error='';
 s.notice='Preparando compartilhamento voluntário da localização.';
 render();
 try{
  // The server allows publishing only after this explicit action. A packet
  // arriving after STOP cannot turn tracking on again.
  const start=await client.rpc('mobility_start_position',{p_request_id:id});
  if(start?.error||start?.data!==true)throw Error('GPS_START_DENIED');
  if(s.gpsEpoch!==epoch||s.gpsRequestId!==id||s.id!==id||
     document.visibilityState==='hidden'||!mobilityRoute()||
     s.detail?.role!=='driver'||s.detail?.status!=='en_route'){
   await client.rpc('mobility_stop_position',{p_request_id:id}).catch(()=>{});
   return false;
  }
  s.watch=navigator.geolocation.watchPosition(async position=>{
   if(s.gpsEpoch!==epoch||s.gpsRequestId!==id||s.watch===null||
      document.visibilityState==='hidden'||s.id!==id)return;
   if(Date.now()-s.lastPublish<8000)return;
   const {latitude,longitude,accuracy}=position.coords||{};
   if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||!Number.isFinite(accuracy)||
      accuracy<0||accuracy>1000)return;
   s.lastPublish=Date.now();
   const out=await client.rpc('mobility_publish_position',{
    p_request_id:id,p_latitude:latitude,p_longitude:longitude,p_accuracy_m:accuracy
   }).catch(()=>({error:true}));
   if(out?.error&&s.gpsEpoch===epoch){
    s.error='Falha ao compartilhar. GPS interrompido.';
    await mobilityStopTracking();render();
   }
  },()=>{
   if(s.gpsEpoch!==epoch)return;
   s.error='Localização negada ou indisponível. Ative o GPS se desejar compartilhar.';
   mobilityStopTracking();render();
  },{enableHighAccuracy:true,maximumAge:0,timeout:15000});
  s.notice='GPS autorizado nesta solicitação. Para interromper, toque em Parar compartilhamento.';
  return true;
 }catch(_){
  if(s.gpsEpoch===epoch){
   s.error='Não foi possível iniciar o GPS. Revise a conexão e tente novamente.';
   await mobilityStopTracking();
  }
  return false;
 }finally{
  if(s.gpsEpoch===epoch){s.gpsPending=false;render()}
 }
}
async function mobilityStopTracking(){
 const s=mobilityRuntime,id=s.gpsRequestId||s.id,client=s.client;
 s.gpsEpoch++;
 s.gpsPending=false;s.gpsRequestId='';
 if(s.watch!==null){
  try{navigator.geolocation.clearWatch(s.watch)}catch(_){}
  s.watch=null;
 }
 if(client&&mobilityId.test(String(id||''))&&s.user){
  try{await client.rpc('mobility_stop_position',{p_request_id:id})}catch(_){}
 }
 return true;
}
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState!=='hidden')return;
 if(mobilityRuntime.watch!==null||mobilityRuntime.gpsPending)mobilityStopTracking();
 // No retained coordinates in the third-party map on backgrounding.
 const frame=document.getElementById?.('mobility-map');
 if(frame){frame.removeAttribute?.('src');frame.remove?.()}
 mobilityRuntime.mapKey='';mobilityRuntime.mapFrameAt=0;
 if(mobilityRuntime.detail?.position){
  mobilityRuntime.detail={...mobilityRuntime.detail,position:null};
 }
});
globalThis.addEventListener?.('offline',()=>{
 if(mobilityRuntime.watch!==null||mobilityRuntime.gpsPending)mobilityStopTracking();
 if(mobilityRuntime.detail?.position){
  mobilityRuntime.detail={...mobilityRuntime.detail,position:null};
  mobilityUpdateMap(mobilityRuntime.detail);
  if(mobilityRoute())render();
 }
});
