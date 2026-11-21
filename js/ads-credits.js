// TAMÃO Ads V1.1097 — prepaid credit workspace.
// Existing paid campaigns remain in their original independent fixed-duration list.
const tamaoCreditPlans=[1990,4990,9990,19990];
const tamaoCreditState={actor:'',generation:-1,loading:false,loaded:false,error:'',data:null,
 amountCents:1990,requestId:null,requestAmount:0,topupId:null,busy:false,pix:null};
const tamaoCreditMoney=n=>'R$ '+(Number(n||0)/100).toLocaleString('pt-BR',
 {minimumFractionDigits:2,maximumFractionDigits:2});
const tamaoCreditEscape=v=>String(v??'').replace(/[&<>"']/g,c=>
 ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function tamaoCreditActor(){return String(globalThis.liveRuntime?.session?.user?.id||'')}
function tamaoCreditVerified(){return typeof tamaoAdsAccountVerified==='function'&&
 tamaoAdsAccountVerified()&&tamaoCreditActor().length>0}
let tamaoCreditReadSeq=0,tamaoCreditMountedScope='',tamaoCreditAutoTimer=null;
// Bounded provider fallback for an already issued, owner-scoped Pix only.
const tamaoCreditProviderWatch={actor:'',generation:-1,topupId:'',attempts:0,nextAt:0,busy:false};
function tamaoCreditScope(){return {
 actor:tamaoCreditVerified()?tamaoCreditActor():'',
 generation:Number(globalThis.liveRuntime?.authGeneration||0)
};}
function tamaoCreditMatches(scope){
 const current=tamaoCreditScope();
 return !!scope.actor&&current.actor===scope.actor&&current.generation===scope.generation;
}
function tamaoCreditRememberRequest(){
 try{
  const key='tamao-ads-credit-request-v1100:'+tamaoCreditState.actor;
  if(tamaoCreditState.requestId)globalThis.sessionStorage?.setItem(key,JSON.stringify({
   id:tamaoCreditState.requestId,amount:tamaoCreditState.requestAmount,at:Date.now()}));
  else globalThis.sessionStorage?.removeItem(key);
 }catch{}
}
function tamaoCreditSyncOwner(){
 const scope=tamaoCreditScope();
 if(tamaoCreditState.actor!==scope.actor||tamaoCreditState.generation!==scope.generation){
  ++tamaoCreditReadSeq;
  if(tamaoCreditAutoTimer!==null)clearTimeout(tamaoCreditAutoTimer);
  tamaoCreditAutoTimer=null;
  Object.assign(tamaoCreditProviderWatch,{actor:scope.actor,generation:scope.generation,
   topupId:'',attempts:0,nextAt:0,busy:false});
  Object.assign(tamaoCreditState,{actor:scope.actor,generation:scope.generation,
   loading:false,loaded:false,error:'',data:null,amountCents:1990,requestId:null,
   requestAmount:0,topupId:null,busy:false,pix:null});
  tamaoCreditCampaignRequest=null;tamaoCreditCampaignFingerprint='';
  tamaoCreditCampaignBusy=false;tamaoCreditActionBusy=false;
  tamaoCreditDraftReset(scope.actor);
  if(scope.actor)try{
   const raw=globalThis.sessionStorage?.getItem('tamao-ads-credit-request-v1100:'+scope.actor);
   const saved=raw?JSON.parse(raw):null;
   if(/^[0-9a-f-]{36}$/i.test(String(saved?.id||''))&&tamaoCreditPlans.includes(saved.amount)&&
      Number.isFinite(saved.at)&&Date.now()-saved.at>=0&&Date.now()-saved.at<259200000){
    tamaoCreditState.requestId=saved.id;tamaoCreditState.requestAmount=saved.amount;
    tamaoCreditState.amountCents=saved.amount;
   }
  }catch{}
 }
 return scope;
}
// Bound the whole call, including session lookup and JSON decoding. A timed-out
// write keeps its original request ID; a retry never creates another intention.
async function tamaoCreditInvoke(body){
 const scope=tamaoCreditScope();
 let timer;
 try{return await Promise.race([
  liveInvoke('ads-credit',body,{sessionGuard:()=>tamaoCreditMatches(scope)}),new Promise((_,reject)=>{
   timer=setTimeout(()=>reject(Error('A consulta demorou. Confira a operação antes de tentar novamente.')),20000);
  })
 ]);}finally{clearTimeout(timer);}
}
function tamaoCreditPending(data=tamaoCreditState.data){
 return (Array.isArray(data?.topups)?data.topups:[]).filter(t=>
  ['reserved','creating','pix_pending','review_required'].includes(t.status));
}
const tamaoCreditFinished=['approved','reversed','unpaid','closed_unissued'];
const tamaoCreditPaymentLabels={reserved:'Aguardando emissão',creating:'Em conferência',
 pix_pending:'Aguardando pagamento',approved:'Pagamento confirmado',unpaid:'Pagamento não concluído',
 closed_unissued:'Encerrada sem emissão',reversed:'Pagamento revertido',review_required:'Em revisão financeira'};
function tamaoCreditSchedule(scope){
 if(tamaoCreditAutoTimer!==null)clearTimeout(tamaoCreditAutoTimer);
 tamaoCreditAutoTimer=null;
 if(!tamaoCreditMatches(scope)||!tamaoCreditPending().length)return;
 tamaoCreditAutoTimer=setTimeout(()=>{
  tamaoCreditAutoTimer=null;
  if(!tamaoCreditMatches(scope)||!document.getElementById('tamao-credit-mount'))return;
  if(document.visibilityState==='hidden')return tamaoCreditSchedule(scope);
  if(document.getElementById('tamao-credit-campaign-form')?.contains?.(document.activeElement))
   return tamaoCreditSchedule(scope);
  if(tamaoCreditState.busy||tamaoCreditState.loading)return tamaoCreditSchedule(scope);
  void tamaoCreditObservePayment(scope).catch(()=>{});
 },30000);
}
async function tamaoCreditObservePayment(scope){
 // Read the owner's ledger first. A remaining unpaid Pix is then checked
 // by the authenticated provider-reconciliation endpoint (no Pix creation).
 if(!await tamaoCreditRefresh()||!tamaoCreditMatches(scope))return false;
 const item=tamaoCreditPending().find(t=>t.status==='pix_pending'&&
   /^[0-9a-f-]{36}$/i.test(String(t.id||'')));
 if(!item)return true;
 const watch=tamaoCreditProviderWatch;
 if(watch.actor!==scope.actor||watch.generation!==scope.generation)return false;
 if(watch.topupId!==item.id)
  Object.assign(watch,{topupId:item.id,attempts:0,nextAt:0,busy:false});
 if(watch.busy||watch.attempts>=3||Date.now()<watch.nextAt||
   document.visibilityState==='hidden'||tamaoCreditState.busy)return true;
 watch.busy=true;
 watch.nextAt=Date.now()+[60000,180000,480000][watch.attempts++];
 try{
  const result=await tamaoCreditInvoke({action:'reconcile',topupId:item.id});
  if(!tamaoCreditMatches(scope)||watch.topupId!==item.id)return false;
  if(result?.source==='ads_credit_payment_fact_v1_1097')
   return await tamaoCreditRefresh();
 }catch{/* Keep original Pix in pending state until verified. */}
 finally{watch.busy=false;}
 return false;
}
function tamaoCreditPixHtml(pix){
 if(!pix?.pixCode||!Number.isSafeInteger(pix?.amountCents))return '';
 const expires=Date.parse(String(pix.expiresAt||''));
 if(!Number.isFinite(expires)||expires<=Date.now()+60000)
  return '<section class="tamao-credit-pix"><p>A validade deste Pix terminou. '+ 
   'Confira o pagamento no histórico antes de iniciar outra recarga.</p></section>';
 if(typeof globalThis.tamaoPixCodeValid==='function'&&!globalThis.tamaoPixCodeValid(pix.pixCode,pix.amountCents))
  return '<p role="status">O código Pix não pôde ser validado. Confira a recarga no histórico.</p>';
 const safeCode=tamaoCreditEscape(pix.pixCode);
 const qr=typeof globalThis.tamaoPixMarkup==='function'
  ?globalThis.tamaoPixMarkup(pix.pixCode,{amountCents:pix.amountCents}):'';
 return '<section class="tamao-credit-pix" aria-label="Pagamento Pix da recarga">'+
  '<h4>Pix da recarga</h4><p>Confira '+tamaoCreditMoney(pix.amountCents)+
  ' e pague pelo app do seu banco. Conferimos este Pix automaticamente e atualizamos seu saldo após confirmação do provedor.</p>'+
  (qr||'<div id="tamao-credit-qrcode" role="img" aria-label="QR Code para pagar a recarga" class="tamao-credit-qr-placeholder">Gerando QR Code…</div>')+
  '<label>Pix copia e cola<textarea id="tamao-credit-pix-code" class="input" readonly rows="3">'+
  safeCode+'</textarea></label><button type="button" class="secondary" onclick="tamaoCreditCopyPix()">Copiar Pix</button>'+
  '<button type="button" class="secondary" onclick="tamaoCreditReconcile(\''+
  tamaoCreditEscape(pix.topupId)+'\')">Conferir pagamento</button></section>';
}

const tamaoCreditCampaignStatusLabels={
 submitted:'Em análise',approved:'Aprovada — aguardando ativação',
 active:'Em divulgação',paused:'Pausada',rejected:'Não aprovada',ended:'Encerrada'
};
let tamaoCreditCampaignRequest=null,tamaoCreditCampaignBusy=false,
 tamaoCreditCampaignFingerprint='',tamaoCreditActionBusy=false;

let tamaoCreditDraftActor='',tamaoCreditClearDraftOnPaint=false;
const tamaoCreditDraft={advertiser:'',title:'',description:'',destination:'',
 city:'São Gabriel',state:'RS',terms:false};
const tamaoCreditDraftFields={
 advertiser:'tamao-credit-c-advertiser',title:'tamao-credit-c-title',
 description:'tamao-credit-c-description',destination:'tamao-credit-c-destination',
 city:'tamao-credit-c-city',state:'tamao-credit-c-state'
};
function tamaoCreditDraftReset(actor=''){
 tamaoCreditDraftActor=actor;
 Object.assign(tamaoCreditDraft,{advertiser:'',title:'',description:'',
  destination:'',city:'São Gabriel',state:'RS',terms:false});
}
function tamaoCreditDraftSave(){
 if(!tamaoCreditVerified()||tamaoCreditDraftActor!==tamaoCreditActor())return;
 for(const [key,id] of Object.entries(tamaoCreditDraftFields)){
  const input=document.getElementById(id);
  if(input)tamaoCreditDraft[key]=String(input.value??'');
 }
 const consent=document.getElementById('tamao-credit-c-terms');
 if(consent)tamaoCreditDraft.terms=consent.checked===true;
}
function tamaoCreditDraftRestore(){
 if(!tamaoCreditVerified())return;
 for(const [key,id] of Object.entries(tamaoCreditDraftFields)){
  const input=document.getElementById(id);
  if(input)input.value=tamaoCreditDraft[key];
 }
 const consent=document.getElementById('tamao-credit-c-terms');
 if(consent)consent.checked=tamaoCreditDraft.terms===true;
}
function tamaoCreditPrepareFromStudio(){
 const scope=tamaoCreditSyncOwner();
 if(!scope.actor)return false;
 const company=String(globalThis.tamaoSponsorDemoCompany?.()||'').slice(0,120);
 const creative=globalThis.tamaoSponsorDemoCreative?.();
 const budget=Number(globalThis.tamaoSponsorDemoBudget?.());
 if(!company&&!creative&&!tamaoCreditPlans.includes(budget))return false;
 if(tamaoCreditMountedScope===scope.actor+':'+scope.generation)tamaoCreditDraftSave();
 for(const [key,value,max] of [['advertiser',company,120],
  ['title',creative?.headline,80],['description',creative?.copy,240]]){
  if(!tamaoCreditDraft[key].trim()&&typeof value==='string')
   tamaoCreditDraft[key]=value.slice(0,max);
 }
 if(tamaoCreditPlans.includes(budget)&&!tamaoCreditState.busy&&
    !tamaoCreditState.requestId&&!tamaoCreditPending().length)
  tamaoCreditState.amountCents=budget;
 // Only the deliberately continued business draft is consumed. Identity,
 // destination, city and consent are never supplied by the preview.
 globalThis.tamaoSponsorDemoConsume?.();
 tamaoCreditClearDraftOnPaint=true;tamaoCreditPaint();return true;
}

function tamaoCreditCampaignHtml(data){
 const campaigns=Array.isArray(data.campaigns)?data.campaigns:[];
 const list=campaigns.map(c=>{
  const id=String(c.id||''),status=String(c.status||''),
   version=Number(c.version)||0,eligible=/^[0-9a-f-]{36}$/i.test(id);
  if(!eligible)return '';
  const action=status==='active'?'pause':status==='paused'?'resume':null;
  const sum=Number(c.spentCents)||0,views=Number(c.views)||0;
  return '<article class="card flat tamao-credit-campaign">'+
   '<span class="section-kicker">CAMPANHA REGIONAL</span><h4>'+tamaoCreditEscape(c.title)+'</h4>'+
   '<p>'+tamaoCreditEscape(c.city)+'/'+tamaoCreditEscape(c.state)+
    ' · '+tamaoCreditEscape(tamaoCreditCampaignStatusLabels[status]||status)+'</p>'+
   '<div class="tamao-credit-campaign-metrics"><span><strong>'+
    views.toLocaleString('pt-BR')+'</strong> visualizações cobradas</span><span><strong>'+
    tamaoCreditMoney(sum)+'</strong> utilizados</span></div>'+
   (action?'<button type="button" class="secondary small" onclick="tamaoCreditCampaignAction(\''+
    id+'\','+version+',\''+action+'\')"'+(tamaoCreditActionBusy?' disabled':'')+'>'+
    (action==='pause'?'Pausar campanha':'Retomar com saldo')+'</button>':'')+
   (status==='approved'?'<small>Após a aprovação do crédito e a conferência final, a equipe libera a exibição.</small>':'')+
   '</article>';
 }).join('');
 return '<div class="tamao-credit-campaigns">'+
  '<div class="section-head"><div><span class="section-kicker">PUBLICIDADE COM CRÉDITOS</span>'+
  '<h3>Monte sua campanha sem contratar dias.</h3>'+
  '<p>Sua empresa escolhe a cidade e a mensagem. O saldo é utilizado apenas quando houver uma visualização elegível. Sem mensalidade e sem gasto acima do saldo.</p></div></div>'+
  '<form id="tamao-credit-campaign-form" class="card flat form-stack tamao-credit-campaign-form" onsubmit="tamaoCreditCampaignSubmit();return false">'+
   '<div class="field-row"><label class="input-wrap">Nome da empresa'+
    '<input id="tamao-credit-c-advertiser" class="input" minlength="2" maxlength="120" autocomplete="organization" placeholder="Sua empresa" required></label>'+
   '<label class="input-wrap">Título da campanha'+
    '<input id="tamao-credit-c-title" class="input" minlength="12" maxlength="80" placeholder="Apresente sua empresa aos clientes" required></label></div>'+
   '<label class="input-wrap">O que você oferece?'+
    '<textarea id="tamao-credit-c-description" class="input" minlength="20" maxlength="240" rows="3" placeholder="Descreva seu produto ou serviço com clareza." required></textarea></label>'+
   '<label class="input-wrap">Link HTTPS para sua empresa'+
    '<input id="tamao-credit-c-destination" class="input" type="url" maxlength="300" inputmode="url" placeholder="https://suaempresa.com.br" required></label>'+
   '<div class="field-row"><label class="input-wrap">Cidade da divulgação'+
    '<input id="tamao-credit-c-city" class="input" minlength="2" maxlength="100" value="São Gabriel" required></label>'+
   '<label class="input-wrap">Estado (UF)<select id="tamao-credit-c-state" class="input">'+
    ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
     'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(uf=>
      '<option value="'+uf+'"'+(uf==='RS'?' selected':'')+'>'+uf+'</option>').join('')+
     '</select></label></div>'+
   '<label class="check-row"><input id="tamao-credit-c-terms" type="checkbox" required>'+
    '<span>Confirmo que posso divulgar esta empresa e concordo com a análise do anúncio. O envio não gera Pix ou cobrança.</span></label>'+
   '<button type="submit" class="primary"'+
     (tamaoCreditCampaignBusy?' disabled':'')+'>Enviar anúncio para análise</button>'+
   '<p role="status" id="tamao-credit-c-status"></p>'+
  '</form>'+
  '<div class="tamao-credit-campaigns-list"><h3>Minhas campanhas por visualização</h3>'+
   (list||'<p>Nenhuma campanha enviada ainda. Você pode preparar a primeira acima.</p>')+
  '</div></div>';
}
async function tamaoCreditCampaignSubmit(){
 const scope=tamaoCreditSyncOwner();
 if(tamaoCreditCampaignBusy||!tamaoCreditVerified())return false;
 if(tamaoCreditMountedScope!==scope.actor+':'+scope.generation){
  tamaoCreditPaint();return false;
 }
 const val=id=>String(document.getElementById(id)?.value||'').trim();
 const advertiser=val('tamao-credit-c-advertiser'),title=val('tamao-credit-c-title'),
  description=val('tamao-credit-c-description'),city=val('tamao-credit-c-city'),
  state=val('tamao-credit-c-state'),destination=val('tamao-credit-c-destination');
 const status=document.getElementById('tamao-credit-c-status');
 if(document.getElementById('tamao-credit-c-terms')?.checked!==true)
  return status&&(status.textContent='Confirme a autorização para enviar a peça.'),false;
 if(advertiser.length<2||title.length<12||description.length<20||city.length<2||
   !/^[A-Z]{2}$/.test(state)||!/^https:\/\//.test(destination))
  return status&&(status.textContent='Revise empresa, texto, cidade e destino HTTPS.'),false;
 const fingerprint=JSON.stringify([advertiser,title,description,city,state,destination]);
 if(tamaoCreditCampaignFingerprint&&tamaoCreditCampaignFingerprint!==fingerprint)
  return status&&(status.textContent='Existe um envio sem confirmação. Atualize a lista antes de alterar a proposta.'),false;
 if(!tamaoCreditCampaignRequest){
  tamaoCreditCampaignRequest=crypto.randomUUID();
  tamaoCreditCampaignFingerprint=fingerprint;
 }
 tamaoCreditCampaignBusy=true;
 if(status)status.textContent='Enviando para revisão…';
 try{
  const r=await tamaoCreditInvoke({
   action:'campaign-submit',requestId:tamaoCreditCampaignRequest,
   advertiser,title,description,city,state,destination,acceptCampaignTerms:true
  });
  if(!tamaoCreditMatches(scope))return false;
  if(r?.source!=='ads_credit_campaign_submit_v1_1098'||!r.campaignId)
   throw Error('O servidor não confirmou a proposta.');
  tamaoCreditCampaignRequest=null;tamaoCreditCampaignFingerprint='';
  tamaoCreditDraftReset(scope.actor);tamaoCreditClearDraftOnPaint=true;
  await tamaoCreditRefresh();
  return true;
 }catch(e){if(tamaoCreditMatches(scope)){
   tamaoCreditState.error=String(e?.message||'Não foi possível enviar. Confira a proposta.');
   if(status)status.textContent=tamaoCreditState.error;}return false;
 }finally{if(tamaoCreditMatches(scope)){
   tamaoCreditCampaignBusy=false;tamaoCreditPaint();}}
}
async function tamaoCreditCampaignAction(campaignId,version,decision){
 const scope=tamaoCreditSyncOwner();
 if(tamaoCreditActionBusy||!tamaoCreditVerified()||
    !['pause','resume'].includes(decision)||!Number.isSafeInteger(version))return false;
 if(!tamaoCreditState.data?.campaigns?.some(c=>c.id===campaignId&&c.version===version))
  return false;
 tamaoCreditActionBusy=true;
 try{
  const r=await tamaoCreditInvoke({
   action:'campaign-owner',campaignId,version,decision
  });
  if(!tamaoCreditMatches(scope))return false;
  if(r?.source!=='ads_credit_campaign_owner_action_v1_1098')throw Error('Confirmação pendente.');
  await tamaoCreditRefresh();return true;
 }catch(e){if(tamaoCreditMatches(scope)){
   tamaoCreditState.error=String(e?.message||'Não foi possível alterar a campanha.');
   tamaoCreditPaint();}
  return false;
 }finally{if(tamaoCreditMatches(scope)){
   tamaoCreditActionBusy=false;tamaoCreditPaint();}}
}
async function tamaoCreditReconcile(topupId){
 const scope=tamaoCreditSyncOwner();
 if(!tamaoCreditVerified()||tamaoCreditState.busy)return false;
 const pending=tamaoCreditState.data?.topups?.find(t=>
   t.id===topupId&&['reserved','creating','pix_pending','review_required'].includes(t.status));
 if(!pending)return false;
 tamaoCreditState.busy=true;
 try{
  const reply=await tamaoCreditInvoke({action:'reconcile',topupId});
  if(!tamaoCreditMatches(scope))return false;
  if(reply?.source!=='ads_credit_payment_fact_v1_1097')throw Error('Provedor não confirmou o pagamento.');
  if(tamaoCreditFinished.includes(reply.status))tamaoCreditState.pix=null;
  const refreshed=await tamaoCreditRefresh();
  if(tamaoCreditMatches(scope)&&refreshed){
   const latest=tamaoCreditState.data.topups?.find(t=>t.id===topupId);
   if(latest)tamaoCreditState.error=tamaoCreditPaymentLabels[latest.status]||'Recarga consultada.';
  }
  return true;
 }catch(e){if(tamaoCreditMatches(scope))
   tamaoCreditState.error='A confirmação ainda não chegou. Confira seu Pix antes de repetir.';
  return false;
 }finally{if(tamaoCreditMatches(scope)){
   tamaoCreditState.busy=false;tamaoCreditPaint();}}
}

function tamaoCreditMarkup(){
 tamaoCreditSyncOwner();
 const d=tamaoCreditState.data;
 if(!tamaoCreditVerified())return '';
 if(tamaoCreditState.loading&&!d)return '<section class="tamao-credit-workspace" aria-label="Crédito publicitário">'+
  '<p role="status">Consultando o saldo publicitário…</p></section>';
 if(!d)return '<section class="tamao-credit-workspace" aria-label="Crédito publicitário">'+
  '<h3>Créditos de publicidade</h3><p>O saldo ainda não pôde ser consultado.</p>'+
  '<button type="button" class="secondary" onclick="tamaoCreditRefresh()">Consultar novamente</button></section>';
 const balance=Number(d.balanceCents)||0,price=Number(d.centsPerView)||0;
 const active=d.rechargeEnabled===true&&d.billingEnabled===true&&!d.frozen;
 const entries=Array.isArray(d.entries)?d.entries:[];
 const pendingTopups=tamaoCreditPending(d)
  .filter(t=>/^[0-9a-f-]{36}$/i.test(String(t.id||'')))
  .slice(0,3);
 const pixHtml=tamaoCreditPixHtml(tamaoCreditState.pix);
 const needsCheck=pendingTopups.filter(t=>t.id!==tamaoCreditState.pix?.topupId||!pixHtml.includes('tamao-credit-pix-code'));
 const pendingHtml=needsCheck.length?'<section class="tamao-credit-pending">'+
  '<h4>Recargas em andamento</h4>'+
  needsCheck.map(t=>'<div class="tamao-credit-pending-item"><span><strong>Pix de '+
    tamaoCreditMoney(t.amountCents)+'</strong><small>'+
    (t.status==='pix_pending'?'Conferindo automaticamente no Mercado Pago':tamaoCreditPaymentLabels[t.status])+
    '</small></span><button type="button" class="secondary small" onclick="tamaoCreditReconcile(&quot;'+
    t.id+'&quot;)"'+(tamaoCreditState.busy?' disabled':'')+'>Conferir pagamento</button></div>').join('')+
  '</section>':'';
 const history=(Array.isArray(d.topups)?d.topups:[]).slice(0,20).map(t=>{
  const date=Date.parse(String(t.createdAt||''));
  return '<li><span>'+tamaoCreditEscape(tamaoCreditPaymentLabels[t.status]||'Em conferência')+
   '</span><strong>'+tamaoCreditMoney(t.amountCents)+'</strong><small>'+
   (Number.isFinite(date)?new Date(date).toLocaleDateString('pt-BR'):'')+'</small></li>';
 }).join('');
 const events=entries.slice(0,12).map(x=>{
  const date=Date.parse(String(x.at||''));
  const text=x.operation==='topup'?'Crédito confirmado':x.operation==='view'?
    'Visualização elegível':'Ajuste de pagamento';
  return '<li><span>'+text+'</span><strong>'+tamaoCreditMoney(x.deltaCents)+
   '</strong><small>'+(Number.isFinite(date)?new Date(date).toLocaleDateString('pt-BR'):'')+
   '</small></li>';
 }).join('');
 const locked=tamaoCreditState.busy||tamaoCreditState.loading||pendingTopups.length>0||!!tamaoCreditState.requestId;
 const mayPrepare=!pendingTopups.some(t=>['pix_pending','review_required'].includes(t.status));
 const plans=active&&mayPrepare?'<div class="tamao-credit-plans" role="group" aria-label="Escolha quanto carregar">'+
  tamaoCreditPlans.map(value=>'<button type="button" data-tamao-credit-plan="'+value+
   '" aria-pressed="'+String(tamaoCreditState.amountCents===value)+
   '" onclick="tamaoCreditChoose('+value+')"'+(locked?' disabled':'')+'>'+tamaoCreditMoney(value)+'</button>').join('')+
  '</div><label class="check-row"><input type="checkbox" id="tamao-credit-terms">'+
  '<span>Concordo com a recarga antecipada, os descontos por visualizações elegíveis e o uso do saldo somente em publicidade. Nenhum débito ocorre apenas por abrir a prévia. Aplicam-se os direitos previstos em lei.</span></label>'+
  '<button type="button" class="primary" onclick="tamaoCreditTopup()" '+
    (tamaoCreditState.busy||tamaoCreditState.loading||
     pendingTopups.some(t=>['pix_pending','review_required'].includes(t.status))||
     pendingTopups.length&&!tamaoCreditState.requestId?'disabled':'')+'>'+
    (tamaoCreditState.requestId?'Retomar o mesmo Pix':'Carregar crédito com Pix')+'</button>':'';
 return '<section class="tamao-credit-workspace" aria-label="Créditos publicitários TAMÃO">'+
  '<div class="tamao-credit-head"><span class="section-kicker">MEUS CRÉDITOS TAMÃO</span>'+
  '<h3>Seu investimento, sob controle.</h3>'+
  '<p>Saldo separado para anúncios. Cada visualização elegível só poderá ser debitada uma vez, depois da comprovação exigida.</p></div>'+
  '<div class="tamao-credit-kpis"><div><small>Saldo disponível</small><strong>'+
   tamaoCreditMoney(balance)+'</strong></div><div><small>Valor de referência por visualização</small>'+
   '<strong>'+tamaoCreditMoney(price)+'</strong></div><div><small>Consumo registrado</small>'+
   '<strong>'+tamaoCreditMoney(d.totalSpentCents)+'</strong></div></div>'+
  (active?'<p class="tamao-credit-equivalence">Seu saldo atual pode cobrir até '+
   (price>0?Math.floor(balance/price).toLocaleString('pt-BR'):'0')+
   ' visualizações faturáveis, se houver audiência elegível. Isso não garante alcance.</p>':
  '<p class="tamao-credit-awaiting">As novas recargas e a cobrança por visualização ainda não estão liberadas. Os saldos existentes e os anúncios contratados anteriormente continuam separados e protegidos.</p>')+
  (d.frozen?'<p class="notice">Conta publicitária em conferência financeira. Nenhuma nova cobrança ou consumo será iniciado.</p>':'')+
  plans+pixHtml+pendingHtml+
  '<p role="status" id="tamao-credit-message">'+tamaoCreditEscape(tamaoCreditState.error)+'</p>'+
  '<details id="tamao-credit-statement" class="tamao-credit-statement"><summary>Ver extrato de créditos e consumos</summary>'+
  (history?'<h4>Minhas recargas</h4><ul>'+history+'</ul>':'')+
  (events?'<h4>Movimentações do saldo</h4>':'')+
  (events?'<ul>'+events+'</ul>':'<p>O extrato aparecerá quando houver recargas ou consumo confirmado.</p>')+
  '<button type="button" class="secondary" onclick="tamaoCreditRefresh()">Atualizar meu saldo</button></details>'+
  tamaoCreditCampaignHtml(d)+
  '<small>Os créditos não são sacáveis nem transferíveis pela rotina normal. Questões legais, contestações de pagamento e correções de cobrança seguem os procedimentos aplicáveis.</small>'+
  '</section>';
}
let tamaoCreditQrLoader=null;
async function tamaoCreditRenderQr(){
 const target=document.getElementById('tamao-credit-qrcode');
 const code=String(tamaoCreditState.pix?.pixCode||'');
 if(!target||!code)return false;
 if(typeof globalThis.qrcode!=='function'){
  if(!tamaoCreditQrLoader){
   tamaoCreditQrLoader=new Promise(resolve=>{
    const script=document.createElement('script');
    const src=document.querySelector('script[src*="ads-credits.js"]')?.src||
       location.origin+'/js/ads-credits.js';
    script.src=new URL('qr-generator.js'+new URL(src).search,src).href;
    script.onload=()=>resolve(typeof globalThis.qrcode==='function');
    script.onerror=()=>resolve(false);
    document.head.append(script);
   });
  }
  if(!await tamaoCreditQrLoader){
   tamaoCreditQrLoader=null;
   if(target.isConnected)target.textContent='Use o código Pix copia e cola abaixo.';
   return false;
  }
 }
 if(document.getElementById('tamao-credit-qrcode')!==target)return false;
 try{
  const qr=globalThis.qrcode(0,'M');
  qr.addData(code);qr.make();
  target.innerHTML=qr.createSvgTag({cellSize:5,margin:20,scalable:true});
  const svg=target.querySelector('svg');
  if(svg){svg.setAttribute('aria-label','Pix da recarga de publicidade TAMÃO');
   svg.setAttribute('role','img');svg.style.maxWidth='225px';svg.style.width='100%';}
  return true;
 }catch{target.textContent='QR indisponível. Use o Pix copia e cola abaixo.';return false;}
}
function tamaoCreditPaint(){
 const scope=tamaoCreditSyncOwner();
 const el=document.getElementById('tamao-credit-mount');
 if(!el)return;
 const key=scope.actor+':'+scope.generation;
 // The old DOM may still belong to the previous account. Never save its
 // fields into the new account's freshly reset draft.
 if(tamaoCreditMountedScope===key&&!tamaoCreditClearDraftOnPaint)tamaoCreditDraftSave();
 const keepStatement=tamaoCreditMountedScope===key&&document.getElementById('tamao-credit-statement')?.open;
 el.innerHTML=tamaoCreditMarkup();
 const statement=document.getElementById('tamao-credit-statement');
 if(keepStatement&&statement)statement.open=true;
 tamaoCreditMountedScope=key;
 tamaoCreditClearDraftOnPaint=false;
 tamaoCreditDraftRestore();
 tamaoCreditRenderQr().catch(()=>{});
}
async function tamaoCreditRefresh(){
 const scope=tamaoCreditSyncOwner();
 if(!scope.actor){tamaoCreditPaint();return false;}
 const read=++tamaoCreditReadSeq;
 const current=()=>tamaoCreditMatches(scope)&&read===tamaoCreditReadSeq;
 tamaoCreditState.loading=true;tamaoCreditState.error='';tamaoCreditPaint();
 try{
  const data=await tamaoCreditInvoke({action:'mine'});
  if(!current())return false;
  if(data?.source!=='ads_credit_balance_v1_1097'||!Number.isSafeInteger(data.balanceCents)||
    !Number.isSafeInteger(data.centsPerView)||!Array.isArray(data.entries)||
    !Array.isArray(data.campaigns))
   throw Error('O saldo não foi confirmado pelo servidor.');
  tamaoCreditState.data=data;
  // Recover a still-payable Pix after a page refresh without ever creating a
  // second charge. The server only returns Pix data to the verified owner.
  const pending=Array.isArray(data.topups)?data.topups.find(t=>
   t.status==='pix_pending'&&typeof t.pixCode==='string'&&
   Number.isSafeInteger(t.amountCents)&&
   Date.parse(String(t.expiresAt||''))>Date.now()+60000):null;
  if(pending){tamaoCreditState.topupId=pending.id;
   tamaoCreditState.pix={source:'ads_credit_topup_v1_1097',
   status:'pix_pending',topupId:pending.id,
   amountCents:pending.amountCents,pixCode:pending.pixCode,
   expiresAt:pending.expiresAt};}
  else tamaoCreditState.pix=null;
  const open=tamaoCreditPending(data)[0];
  if(open&&/^[0-9a-f-]{36}$/i.test(String(open.requestId||''))&&tamaoCreditPlans.includes(open.amountCents)){
   // The owner can recover the same provider obligation on a second device.
   tamaoCreditState.requestId=open.requestId;tamaoCreditState.topupId=open.id;
   tamaoCreditState.requestAmount=open.amountCents;tamaoCreditState.amountCents=open.amountCents;
   tamaoCreditRememberRequest();
  }else if(Array.isArray(data.topups)&&data.topups.some(t=>
    (t.id===tamaoCreditState.topupId||t.requestId&&t.requestId===tamaoCreditState.requestId)&&
    tamaoCreditFinished.includes(t.status))){
   tamaoCreditState.requestId=null;tamaoCreditState.topupId=null;tamaoCreditState.requestAmount=0;
   tamaoCreditRememberRequest();
  }
  tamaoCreditState.loaded=true;return true;
 }catch(error){
  if(current())tamaoCreditState.error=
   'Não foi possível consultar o saldo agora. Tente novamente.';
  return false;
 }finally{if(current()){
   tamaoCreditState.loading=false;tamaoCreditPaint();tamaoCreditSchedule(scope);}}
}
function tamaoCreditChoose(value){
 tamaoCreditSyncOwner();
 const v=Number(value);
 if(!tamaoCreditPlans.includes(v))return false;
 if(tamaoCreditState.busy||tamaoCreditState.requestId||tamaoCreditPending().length)return false;
 if(tamaoCreditState.amountCents!==v){tamaoCreditState.requestId=null;
  tamaoCreditState.pix=null;}
 tamaoCreditState.amountCents=v;tamaoCreditPaint();return true;
}
async function tamaoCreditTopup(){
 const scope=tamaoCreditSyncOwner();
 if(!scope.actor||tamaoCreditState.busy)return false;
 if(tamaoCreditMountedScope!==scope.actor+':'+scope.generation){tamaoCreditPaint();return false;}
 const pending=tamaoCreditPending();
 if(tamaoCreditState.loading||pending.some(t=>['pix_pending','review_required'].includes(t.status))||
    pending.length&&!tamaoCreditState.requestId)return false;
 if(tamaoCreditState.data?.frozen||tamaoCreditState.data?.rechargeEnabled!==true||
    tamaoCreditState.data?.billingEnabled!==true)return false;
 if(document.getElementById('tamao-credit-terms')?.checked!==true){
  tamaoCreditState.error='Confirme as condições da recarga antes de gerar o Pix.';
  tamaoCreditPaint();return false;
 }
 const amount=tamaoCreditState.amountCents;
 if(!tamaoCreditState.requestId||tamaoCreditState.requestAmount!==amount){
  tamaoCreditState.requestId=crypto.randomUUID();tamaoCreditState.requestAmount=amount;}
 tamaoCreditRememberRequest();
 tamaoCreditState.busy=true;tamaoCreditState.error='';tamaoCreditPaint();
 try{
  const data=await tamaoCreditInvoke({action:'topup',
   requestId:tamaoCreditState.requestId,amountCents:amount,acceptCreditTerms:true});
  if(!tamaoCreditMatches(scope))return false;
  if(data?.source!=='ads_credit_topup_v1_1097')throw Error('Pix não confirmado.');
  if(tamaoCreditFinished.includes(data.status)){
   tamaoCreditState.requestId=null;tamaoCreditRememberRequest();
  }
  if(data.status==='pix_pending'&&typeof data.pixCode==='string'&&
    Number(data.amountCents)===amount){
    tamaoCreditState.pix=data;tamaoCreditState.topupId=data.topupId;
    // Keep the intention until a separate authoritative balance read sees
    // its final state. A lost response can only retry this same request.
    await tamaoCreditRefresh();
    return true;
  }
  await tamaoCreditRefresh();
  return true;
 }catch(error){if(tamaoCreditMatches(scope))tamaoCreditState.error=
  String(error?.message||'Não foi possível preparar o Pix. Atualize o saldo antes de repetir.');return false;}
 finally{if(tamaoCreditMatches(scope)){
   tamaoCreditState.busy=false;tamaoCreditPaint();tamaoCreditSchedule(scope);}}
}
async function tamaoCreditCopyPix(){
 const scope=tamaoCreditSyncOwner();
 const input=document.getElementById('tamao-credit-pix-code');
 if(!input||!tamaoCreditState.pix)return;
 try{await navigator.clipboard.writeText(input.value);
  if(!tamaoCreditMatches(scope))return;
  tamaoCreditState.error='Código Pix copiado.';}
 catch{if(!tamaoCreditMatches(scope))return;
  tamaoCreditState.error='Selecione o código Pix e copie.';}
 tamaoCreditPaint();
}
function tamaoCreditBoot(){
 const scope=tamaoCreditSyncOwner();
 if(!document.getElementById('tamao-credit-mount'))return;
 if(!scope.actor){tamaoCreditPaint();return;}
 tamaoCreditPrepareFromStudio();
 tamaoCreditPaint();
 if(!tamaoCreditState.loaded&&!tamaoCreditState.loading)
  tamaoCreditRefresh();
}
globalThis.tamaoCreditBoot=tamaoCreditBoot;
globalThis.tamaoCreditRefresh=tamaoCreditRefresh;
globalThis.tamaoCreditPrepareFromStudio=tamaoCreditPrepareFromStudio;
