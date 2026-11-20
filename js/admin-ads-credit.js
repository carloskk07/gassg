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
 const token=await adminAccessToken();
 if(!adminReady()||!token)throw Error('A autenticação administrativa expirou.');
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
  (current?'<div class="merchant-kpis">'+
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
globalThis.adminCreditAdsChooseFilter=adminCreditAdsChooseFilter;
globalThis.adminCreditAdsPanel=adminCreditAdsPanel;
globalThis.adminCreditAdsRefresh=adminCreditAdsRefresh;
