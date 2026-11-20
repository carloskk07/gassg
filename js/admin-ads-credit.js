// V1.1098 — verified Admin-only prepaid advertising workspace.
// Authentication, permissions and database ACL are enforced by admin-ops.
let adminCreditAdsState={actor:'',status:'idle',rows:[],gate:null,totals:null,error:''};
let adminCreditAdsBusy=false;
let adminCreditAdsFilter='all';
function adminCreditAdsChooseFilter(value){
 const allowed=['all','submitted','approved','active','paused','rejected','ended'];
 if(!allowed.includes(value))return false;
 adminCreditAdsFilter=value;
 if(adminRuntime?.section==='ads'&&typeof render==='function')render();
 return true;
}
async function adminCreditAdsRequest(action,body={}){
 const actor=String(adminRuntime?.session?.user?.id||''),role=adminCurrentRole();
 const pilot=(action.startsWith('admin-pilot-')||action==='reconcile')?adminCreditPilotScope():null;
 const token=await adminAccessToken();
 if((pilot&&pilot!==adminCreditPilotScope())||!adminReady()||!token||!actor||actor!==String(adminRuntime?.session?.user?.id||'')||role!==adminCurrentRole())throw Error('A autenticação administrativa expirou.');
 const response=await globalThis.chamaFetch(CHAMA_BACKEND.url+'/functions/v1/ads-credit',{
  method:'POST',cache:'no-store',
  headers:{'Content-Type':'application/json','apikey':CHAMA_BACKEND.publishableKey,
    Authorization:'Bearer '+token},
  body:JSON.stringify({action,...body})
 });
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw Error(data?.message||data?.error||'Erro de publicidade por créditos');
 return data;
}
async function adminCreditAdsRefresh(){
 const actor=String(adminRuntime?.session?.user?.id||'');
 if(!actor||!adminReady()||adminCreditAdsBusy)return false;
 adminCreditAdsBusy=true;
 const pilot=adminCreditPilotScope();
 const readingPilot=pilot.actor?adminCreditPilotRead(pilot):null;
 if(adminCreditAdsState.actor!==actor)adminCreditAdsState={
  actor,status:'loading',rows:[],gate:null,totals:null,error:''};
 else adminCreditAdsState.status='loading';
 try{
  const r=await adminCreditAdsRequest('admin-read');
  if(actor!==String(adminRuntime?.session?.user?.id||''))return false;
  if(r?.source!=='ads_credit_admin_read_v1_1098'||!Array.isArray(r.rows)||
     !r.gate||!Number.isSafeInteger(r.gate.centsPerView))
   throw Error('Não foi possível confirmar os créditos no banco.');
  adminCreditAdsState={actor,status:'ready',rows:r.rows,gate:r.gate,
   totals:{wallets:r.wallets,loaded:r.loadedCents,spent:r.spentCents,
    remaining:r.remainingCents},error:''};
  return true;
 }catch(e){
  if(actor===String(adminRuntime?.session?.user?.id||'')){
   adminCreditAdsState.status='error';
   adminCreditAdsState.error='Os dados financeiros não puderam ser confirmados.';
  }
  return false;
 }finally{
  await readingPilot;
  adminCreditAdsBusy=false;
  if(adminRuntime?.section==='ads')render();
 }
}
function adminCreditAdsPanel(){
 const actor=String(adminRuntime?.session?.user?.id||'');
 const current=adminCreditAdsState.actor===actor&&adminCreditAdsState.status==='ready';
 const data=adminCreditAdsState,canAct=['superadmin','compliance'].includes(adminCurrentRole());
 const money=value=>adminMoney(Number(value)||0);
 const names={submitted:'Em análise',approved:'Aprovada',active:'Em divulgação',
  paused:'Pausada',rejected:'Rejeitada',ended:'Encerrada'};
 const deliveryOpen=current&&data.gate.rechargeEnabled===true&&data.gate.billingEnabled===true&&data.gate.evidenceEnabled===true;
 const actions=c=>{
  if(!canAct)return '';
  const status=String(c.status||'');
  const options=status==='submitted'?[['approve','Aprovar anúncio'],['reject','Rejeitar']]:
   status==='approved'?[...(deliveryOpen?[['publish','Publicar com saldo']]:[]),['reject','Rejeitar'],['end','Encerrar']]:
   status==='active'?[['pause','Pausar'],['end','Encerrar']]:
   status==='paused'?[...(deliveryOpen?[['resume','Retomar com saldo']]:[]),['end','Encerrar']]:[];
  if(!options.length)return '';
  const id=String(c.id||'');
  return ((!deliveryOpen&&['approved','paused'].includes(status))?'<p>O anúncio pode entrar em divulgação quando a cobrança por visualização estiver liberada.</p>':'')+'<fieldset><legend>Escolha a ação</legend>'+
   options.map(([v,label])=>'<label class="admin-option-row"><input type="radio" name="credit-admin-'+id+
     '" value="'+v+'"> '+label+'</label>').join('')+'</fieldset>'+
   '<label class="input-wrap" for="credit-reason-'+id+'">Motivo da decisão'+
   '<textarea id="credit-reason-'+id+'" class="input" maxlength="500" rows="2" '+
    'placeholder="Obrigatório para rejeitar ou encerrar; opcional nas demais ações."></textarea></label>'+ 
   '<label class="admin-option-row"><input type="checkbox" id="credit-ack-'+id+'"> '+
    'Conferi o anúncio e autorizo a decisão selecionada.</label>'+
   '<button type="button" class="secondary small" onclick="adminCreditAdsDecide(\''+id+'\','+
     Number(c.version)+')"'+(adminCreditAdsBusy?' disabled':'')+'>Confirmar ação marcada</button>';
 };
 const allRows=current?data.rows:[];
 const priorities={submitted:0,approved:1,paused:2,active:3,rejected:4,ended:5};
 const counts=Object.fromEntries(Object.keys(names).map(k=>[k,allRows.filter(c=>c.status===k).length]));
 const options=[['all','Todas'],...Object.entries(names).map(([k,label])=>[k,label])];
 const filters='<label class="input-wrap" for="credit-admin-filter">Ver campanhas'+
  '<select id="credit-admin-filter" class="input" onchange="adminCreditAdsChooseFilter(this.value)">'+
  options.map(([value,label])=>'<option value="'+value+'"'+
   (adminCreditAdsFilter===value?' selected':'')+'>'+
   esc(label)+' ('+(value==='all'?allRows.length:counts[value])+')</option>').join('')+
  '</select></label>';
 const visibleRows=allRows.filter(c=>adminCreditAdsFilter==='all'||c.status===adminCreditAdsFilter)
  .slice().sort((a,b)=>(priorities[a.status]??6)-(priorities[b.status]??6)||
   String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
 const rows=current?visibleRows.map(c=>
  '<article class="card flat"><span class="section-kicker">ANUNCIANTE REGIONAL</span>'+
   '<h4>'+esc(String(c.advertiser||''))+'</h4>'+
   '<strong>'+esc(String(c.title||''))+'</strong>'+
   '<p>'+esc(String(c.city||''))+'/'+esc(String(c.state||''))+
    ' · '+esc(names[c.status]||String(c.status||''))+'</p>'+
   '<p>'+esc(String(c.description||''))+'</p>'+
   '<p><small>Destino: '+esc(String(c.destination||''))+'</small></p>'+
   '<p>Visualizações debitadas: '+Number(c.views||0)+'</p>'+
   actions(c)+'</article>').join(''):'';
 const g=data.gate||{},t=data.totals||{};
 return '<section class="section" aria-label="Campanhas de créditos publicitários">'+
  '<div class="section-head"><div><span class="section-kicker">PUBLICIDADE POR CRÉDITOS</span>'+
  '<h3>Campanhas por visualização</h3>'+
  '<p>Revisão de criativos e controle dos saldos, sem pacote de dias. Os lançamentos antigos permanecem no histórico anterior.</p></div>'+
  '<button type="button" class="secondary small" onclick="adminCreditAdsRefresh()">Atualizar</button></div>'+
  (current?adminCreditPilotPanel()+'<div class="merchant-kpis">'+
   '<div class="kpi"><span class="label">Preço por visualização</span><strong>'+
    money(g.centsPerView)+'</strong></div>'+
   '<div class="kpi"><span class="label">Saldo total</span><strong>'+
    money(t.remaining)+'</strong></div>'+
   '<div class="kpi"><span class="label">Recargas confirmadas</span><strong>'+
    money(t.loaded)+'</strong></div>'+
   '<div class="kpi"><span class="label">Consumido</span><strong>'+
    money(t.spent)+'</strong></div></div>'+
   '<p role="status">Recargas '+(g.rechargeEnabled?'habilitadas':'desligadas')+
   ' · Débitos '+(g.billingEnabled?'habilitados':'desligados')+
   ' · Validação de evidências '+(g.evidenceEnabled?'habilitada':'desligada')+'</p>'+
   '<p class="tiny muted">'+counts.submitted+' aguardando revisão · '+counts.approved+
   ' aguardando publicação · '+counts.active+' em divulgação · '+counts.paused+' pausadas.</p>'+ 
   filters+
  '<div class="grid cards-2">'+(rows||'<p>Nenhuma campanha nesta situação.</p>')+'</div>':
   '<p role="status">'+esc(data.error||'Consultando campanhas e saldos…')+'</p>')+
  '</section>';
}
async function adminCreditAdsDecide(id,version){
 const actor=String(adminRuntime?.session?.user?.id||'');
 if(!actor||!adminReady()||adminCreditAdsBusy||adminCreditAdsState.actor!==actor||
    adminCreditAdsState.status!=='ready')return false;
 const row=adminCreditAdsState.rows.find(c=>c.id===id&&Number(c.version)===version);
 const decision=String(document.querySelector('input[name="credit-admin-'+id+'"]:checked')?.value||'');
 if(!row||!['approve','reject','publish','pause','resume','end'].includes(decision)||
    document.getElementById('credit-ack-'+id)?.checked!==true)
  return toast('Marque uma decisão e confirme que revisou a campanha.');
 if(!['superadmin','compliance'].includes(adminCurrentRole()))return false;
 const gate=adminCreditAdsState.gate;
 if(['publish','resume'].includes(decision)&&!(gate?.rechargeEnabled&&gate.billingEnabled&&gate.evidenceEnabled))
  return toast('A divulgação por créditos aguarda a liberação financeira.');
 const manuallyEntered=String(document.getElementById('credit-reason-'+id)?.value||'')
  .trim().replace(/\s+/g,' ').slice(0,500);
 if(['reject','end'].includes(decision)&&manuallyEntered.length<12)
  return toast('Informe um motivo real com pelo menos 12 caracteres para rejeitar ou encerrar.');
 const reasons={
  approve:'Anúncio revisado e aprovado para veiculação por créditos.',
  reject:'Anúncio rejeitado após conferência do conteúdo apresentado.',
  publish:'Campanha aprovada, com saldo e regras de entrega conferidos.',
  pause:'Divulgação pausada após conferência operacional do administrador.',
  resume:'Campanha retomada após verificação de saldo e conteúdo.',
  end:'Campanha encerrada por decisão administrativa documentada.'
 };
 adminCreditAdsBusy=true;
 try{
  const r=await adminCreditAdsRequest('admin-action',{
   campaignId:id,version,decision,reason:manuallyEntered.length>=12?manuallyEntered:reasons[decision]});
  if(actor!==String(adminRuntime?.session?.user?.id||''))return false;
  if(r?.source!=='ads_credit_admin_action_v1_1098'||r.campaignId!==id)
   throw Error('A decisão não foi confirmada no servidor.');
  toast('Decisão registrada.');
  return true;
 }catch(e){if(actor===String(adminRuntime?.session?.user?.id||''))
   toast(String(e?.message||'Não foi possível aplicar a decisão.'));return false;
 }finally{adminCreditAdsBusy=false;await adminCreditAdsRefresh();}
}
let adminCreditPilotRevision=0;
let adminCreditPilotState={actor:'',login:'',revision:0,data:null,error:'',busy:false,sequence:0};
function adminCreditPilotScope(){
 const actor=adminReady()&&adminCurrentRole()==='superadmin'?String(adminRuntime?.session?.user?.id||''):'';
 const login=actor?String(adminRuntime.session.user.last_sign_in_at||''):'';
 if(adminCreditPilotState.actor!==actor||adminCreditPilotState.login!==login)
  adminCreditPilotState={actor,login,revision:++adminCreditPilotRevision,data:null,error:'',busy:false,sequence:0};
 return adminCreditPilotState;
}
async function adminCreditPilotRead(state){
 const sequence=++state.sequence;
 try{
  const data=await adminCreditAdsRequest('admin-pilot-read');
  if(adminCreditPilotScope()!==state||state.sequence!==sequence)return false;
  if(data?.source!=='admin_ads_credit_pilot_v1_1101'||typeof data.canStart!=='boolean')
   throw Error('Leitura incompleta');
  state.data=data;state.error='';return true;
 }catch{
  if(adminCreditPilotScope()===state&&state.sequence===sequence){
   // Keep the last verified pending topup so a transient read failure cannot
   // permanently stop automatic confirmation until the page is reloaded.
   state.error='Não foi possível consultar a recarga de homologação. Nova conferência automática em instantes.';
  }
  return false;
 }
}
function adminCreditPilotPanel(){
 const state=adminCreditPilotScope();
 if(!state.actor)return '';
 const d=state.data;
 const status={idle:'Pronta para iniciar',reserved:'Aguardando emissão',creating:'Em conferência no Mercado Pago',
  pix_pending:'Aguardando pagamento',approved:'Pagamento confirmado',unpaid:'Pagamento não concluído',
  closed_unissued:'Encerrada sem emissão',reversed:'Pagamento revertido',review_required:'Em revisão financeira',
  other_owner:'Em acompanhamento por outro superadministrador'};
 const rawId=String(d?.topupId||'');
 const id=/^[0-9a-f-]{36}$/i.test(rawId)?rawId:'';
 const validId=!!id;
 const allowStart=d?.providerReady===true&&(d.canStart===true||d.status==='reserved');
 const check=validId&&['reserved','creating','pix_pending','approved','review_required'].includes(d.status);
 const code=d?.status==='pix_pending'&&Date.parse(d.expiresAt)>Date.now()+60000&&
  typeof globalThis.tamaoPixCodeValid==='function'&&globalThis.tamaoPixCodeValid(d.pixCode,1990)?d.pixCode:'';
 const disabled=state.busy?' disabled':'';
 const controls=allowStart?'<label class="admin-option-row"><input type="checkbox" id="credit-pilot-consent"'+disabled+'>'+
  ' Autorizo a emissão de um Pix real de R$ 19,90 para a minha carteira de publicidade.</label>'+
  '<button type="button" class="primary small" onclick="adminCreditPilotRun(&quot;prepare&quot;,&quot;'+id+'&quot;,'+state.revision+')"'+disabled+'>'+
  (d.status==='reserved'?'Retomar emissão do Pix':'Gerar Pix de R$ 19,90')+'</button>':'';
 const pix=code?(globalThis.tamaoPixMarkup?.(code,{amountCents:1990,label:'QR Code da homologação de publicidade'})||'')+
  '<label class="input-wrap">Pix copia e cola<textarea class="input" id="credit-pilot-code" rows="3" readonly>'+esc(code)+'</textarea></label>'+
  '<button type="button" class="secondary small" onclick="adminCreditPilotCopy()">Copiar Pix</button>':'';
 return '<section class="card flat form-stack" aria-label="Homologação da carteira de publicidade">'+
  '<h4>Homologação do Pix da carteira</h4>'+
  '<p>Confira a recarga de R$ 19,90 na sua própria carteira antes de abrir as vendas. O saldo entra após a confirmação do Mercado Pago.</p>'+
  (d?'<p role="status"><strong>'+esc(d.status==='idle'&&d.providerReady!==true?'Aguardando o Mercado Pago':status[d.status]||'Em conferência')+'</strong>'+
   (Number.isSafeInteger(d.balanceCents)?' · Saldo da carteira '+esc(adminMoney(d.balanceCents)):'')+'</p>':'')+
  (d?.providerReady===false?'<p>A conexão com o Mercado Pago precisa de conferência. Atualize o painel para consultar novamente.</p>':'')+
  controls+pix+(check?'<button type="button" class="secondary small" onclick="adminCreditPilotRun(&quot;check&quot;,&quot;'+id+'&quot;,'+state.revision+')"'+disabled+'>Conferir no Mercado Pago</button>':'')+
  '<span role="status" id="credit-pilot-notice">'+esc(state.error||(state.busy?'Consultando o Mercado Pago…':''))+'</span></section>';
}
async function adminCreditPilotRun(operation,renderedId,revision){
 const state=adminCreditPilotScope(),d=state.data;
 if(!state.actor||state.revision!==revision||state.busy||!d||adminRuntime.section!=='ads'||
    String(d.topupId||'')!==renderedId)return false;
 if(operation==='prepare'){
  if(d.providerReady!==true||!(d.canStart||d.status==='reserved')||document.getElementById('credit-pilot-consent')?.checked!==true)
   return toast('Marque a autorização para emitir o Pix de R$ 19,90.');
 }else if(operation!=='check'||!renderedId)return false;
 state.busy=true;state.error='';render();
 try{
  const response=operation==='prepare'?await adminCreditAdsRequest('admin-pilot-prepare',{
   previousTopup:renderedId||null,acceptPilotTerms:true}):
   await adminCreditAdsRequest('reconcile',{topupId:renderedId});
  if(adminCreditPilotScope()!==state)return false;
  if(response?.source!==(operation==='prepare'?'ads_credit_topup_v1_1097':'ads_credit_payment_fact_v1_1097'))
   throw Error('Confirmação indisponível');
  return await adminCreditPilotRead(state);
 }catch{
  if(adminCreditPilotScope()===state){
   await adminCreditPilotRead(state);
   if(adminCreditPilotScope()===state)state.error='Confira a situação da cobrança antes de tentar novamente.';
  }
  return false;
 }finally{
  if(adminCreditPilotScope()===state){state.busy=false;if(adminRuntime.section==='ads')render();}
 }
}
async function adminCreditPilotCopy(){
 const state=adminCreditPilotScope(),field=document.getElementById('credit-pilot-code');
 if(!state.actor||state.data?.status!=='pix_pending'||!field||field.value!==state.data.pixCode||
   Date.parse(state.data.expiresAt)<=Date.now()+60000)return false;
 try{await navigator.clipboard.writeText(field.value);
  if(adminCreditPilotScope()===state)toast('Pix copiado.');return true;
 }catch{if(adminCreditPilotScope()===state){field.focus();field.select();toast('Código selecionado para copiar.');}return false;}
}
// A signed Mercado Pago webhook can settle while the protected Admin is open.
// Observe the authoritative wallet without reissuing Pix or trusting the browser.
let adminCreditPilotWatchBusy=false;
let adminCreditPilotWatchTopup='';
let adminCreditPilotWatchNextProbe=0;
let adminCreditPilotWatchProbes=0;
async function adminCreditPilotWatchTick(){
 const state=adminCreditPilotScope(),before=state.data;
 if(adminCreditPilotWatchBusy||!state.actor||!adminReady()||state.busy||
    adminCreditAdsBusy||adminRuntime?.section!=='ads'||
    (typeof adminIndependentAdsPane!=='undefined'&&adminIndependentAdsPane!=='credit')||
    document.visibilityState==='hidden'||
    !['reserved','creating','pix_pending','review_required'].includes(before?.status))
  return false;
 adminCreditPilotWatchBusy=true;
 try{
  const topupId=String(before.topupId||'');
  if(topupId!==adminCreditPilotWatchTopup){
   adminCreditPilotWatchTopup=topupId;
   adminCreditPilotWatchProbes=0;
   adminCreditPilotWatchNextProbe=Date.now()+12000;
  }
  // Bounded, idempotent fallback when a signed webhook is delayed or lost.
  // The server independently GETs Mercado Pago and validates the exact live Pix.
  if(before.status==='pix_pending'&&/^[0-9a-f-]{36}$/i.test(topupId)&&
     adminCreditPilotWatchProbes<5&&Date.now()>=adminCreditPilotWatchNextProbe){
   const delays=[30000,60000,120000,240000,480000];
   adminCreditPilotWatchNextProbe=Date.now()+delays[adminCreditPilotWatchProbes++];
   try{await adminCreditAdsRequest('reconcile',{topupId});}catch{}
  }
  const read=await adminCreditPilotRead(state);
  if(!read||adminCreditPilotScope()!==state)return false;
  const after=state.data;
  const changed=after.status!==before.status||after.balanceCents!==before.balanceCents||
    after.pixCode!==before.pixCode;
  if(changed&&after.status==='approved'){
   // The pilot widget and the total Ads KPIs must transition together.
   await adminCreditAdsRefresh();
   if(adminCreditPilotScope()===state)toast('Pix confirmado! Crédito disponível na carteira.');
  }else if(changed&&adminRuntime?.section==='ads')render();
  return changed;
 }finally{adminCreditPilotWatchBusy=false;}
}
if(typeof window!=='undefined'&&typeof window.setInterval==='function'){
 window.setInterval(()=>{void adminCreditPilotWatchTick().catch(()=>{});},8000);
 if(typeof document.addEventListener==='function')
  document.addEventListener('visibilitychange',()=>{
   if(document.visibilityState==='visible')void adminCreditPilotWatchTick().catch(()=>{});
  });
}
globalThis.adminCreditAdsChooseFilter=adminCreditAdsChooseFilter;
globalThis.adminCreditAdsPanel=adminCreditAdsPanel;
globalThis.adminCreditAdsRefresh=adminCreditAdsRefresh;
