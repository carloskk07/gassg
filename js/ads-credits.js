// TAMÃO Ads V1.1097 — prepaid credit workspace.
// Existing paid campaigns remain in their original independent fixed-duration list.
const tamaoCreditPlans=[1990,4990,9990,19990];
const tamaoCreditState={actor:'',loading:false,loaded:false,error:'',data:null,
 amountCents:1990,requestId:null,requestAmount:0,busy:false,pix:null};
const tamaoCreditMoney=n=>'R$ '+(Number(n||0)/100).toLocaleString('pt-BR',
 {minimumFractionDigits:2,maximumFractionDigits:2});
const tamaoCreditEscape=v=>String(v??'').replace(/[&<>"']/g,c=>
 ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;'}[c]));
function tamaoCreditActor(){return String(globalThis.liveRuntime?.session?.user?.id||'')}
function tamaoCreditVerified(){return typeof tamaoAdsAccountVerified==='function'&&
 tamaoAdsAccountVerified()&&tamaoCreditActor().length>0}
function tamaoCreditPixHtml(pix){
 if(!pix?.pixCode||!Number.isSafeInteger(pix?.amountCents))return '';
 const safeCode=tamaoCreditEscape(pix.pixCode);
 const qr=typeof globalThis.tamaoPixMarkup==='function'
  ?globalThis.tamaoPixMarkup(pix.pixCode,{amountCents:pix.amountCents}):'';
 return '<section class="tamao-credit-pix" aria-label="Pagamento Pix da recarga">'+
  '<h4>Pix da recarga</h4><p>Confira '+tamaoCreditMoney(pix.amountCents)+
  ' e pague pelo app do seu banco. O saldo será liberado após a confirmação do provedor.</p>'+
  qr+'<label>Pix copia e cola<textarea id="tamao-credit-pix-code" class="input" readonly rows="3">'+
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
  '<div class="card flat form-stack tamao-credit-campaign-form">'+
   '<div class="field-row"><label class="input-wrap">Nome da empresa'+
    '<input id="tamao-credit-c-advertiser" class="input" maxlength="120" autocomplete="organization" placeholder="Sua empresa" required></label>'+
   '<label class="input-wrap">Título da campanha'+
    '<input id="tamao-credit-c-title" class="input" maxlength="80" placeholder="Apresente sua empresa aos clientes" required></label></div>'+
   '<label class="input-wrap">O que você oferece?'+
    '<textarea id="tamao-credit-c-description" class="input" maxlength="240" rows="3" placeholder="Descreva seu produto ou serviço com clareza." required></textarea></label>'+
   '<label class="input-wrap">Link HTTPS para sua empresa'+
    '<input id="tamao-credit-c-destination" class="input" maxlength="300" inputmode="url" placeholder="https://suaempresa.com.br" required></label>'+
   '<div class="field-row"><label class="input-wrap">Cidade da divulgação'+
    '<input id="tamao-credit-c-city" class="input" maxlength="100" value="São Gabriel" required></label>'+
   '<label class="input-wrap">Estado (UF)<select id="tamao-credit-c-state" class="input">'+
    ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
     'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(uf=>
      '<option value="'+uf+'"'+(uf==='RS'?' selected':'')+'>'+uf+'</option>').join('')+
     '</select></label></div>'+
   '<label class="check-row"><input id="tamao-credit-c-terms" type="checkbox">'+
    '<span>Confirmo que posso divulgar esta empresa e concordo com a análise do anúncio. O envio não gera Pix ou cobrança.</span></label>'+
   '<button type="button" class="primary" onclick="tamaoCreditCampaignSubmit()"'+
     (tamaoCreditCampaignBusy?' disabled':'')+'>Enviar anúncio para análise</button>'+
   '<p role="status" id="tamao-credit-c-status"></p>'+
  '</div>'+
  '<div class="tamao-credit-campaigns-list"><h3>Minhas campanhas por visualização</h3>'+
   (list||'<p>Nenhuma campanha enviada ainda. Você pode preparar a primeira acima.</p>')+
  '</div></div>';
}
async function tamaoCreditCampaignSubmit(){
 if(tamaoCreditCampaignBusy||!tamaoCreditVerified())return false;
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
 const actor=tamaoCreditActor();
 tamaoCreditCampaignBusy=true;
 if(status)status.textContent='Enviando para revisão…';
 try{
  const r=await liveInvoke('ads-credit',{
   action:'campaign-submit',requestId:tamaoCreditCampaignRequest,
   advertiser,title,description,city,state,destination,acceptCampaignTerms:true
  });
  if(actor!==tamaoCreditActor())return false;
  if(r?.source!=='ads_credit_campaign_submit_v1_1098'||!r.campaignId)
   throw Error('O servidor não confirmou a proposta.');
  tamaoCreditCampaignRequest=null;tamaoCreditCampaignFingerprint='';
  await tamaoCreditRefresh();
  return true;
 }catch(e){if(actor===tamaoCreditActor()&&status)
   status.textContent=String(e?.message||'Não foi possível enviar. Confira a proposta.');return false;
 }finally{tamaoCreditCampaignBusy=false;}
}
async function tamaoCreditCampaignAction(campaignId,version,decision){
 if(tamaoCreditActionBusy||!tamaoCreditVerified()||
    !['pause','resume'].includes(decision)||!Number.isSafeInteger(version))return false;
 const actor=tamaoCreditActor();
 if(!tamaoCreditState.data?.campaigns?.some(c=>c.id===campaignId&&c.version===version))
  return false;
 tamaoCreditActionBusy=true;
 try{
  const r=await liveInvoke('ads-credit',{
   action:'campaign-owner',campaignId,version,decision
  });
  if(actor!==tamaoCreditActor())return false;
  if(r?.source!=='ads_credit_campaign_owner_action_v1_1098')throw Error('Confirmação pendente.');
  await tamaoCreditRefresh();return true;
 }catch(e){if(actor===tamaoCreditActor()){
   tamaoCreditState.error=String(e?.message||'Não foi possível alterar a campanha.');
   tamaoCreditPaint();}
  return false;
 }finally{tamaoCreditActionBusy=false;}
}
async function tamaoCreditReconcile(topupId){
 if(!tamaoCreditVerified()||!tamaoCreditState.pix||tamaoCreditState.busy)return false;
 if(tamaoCreditState.pix.topupId!==topupId)return false;
 const actor=tamaoCreditActor();tamaoCreditState.busy=true;
 try{
  const reply=await liveInvoke('ads-credit',{action:'reconcile',topupId});
  if(actor!==tamaoCreditActor())return false;
  if(reply?.source!=='ads_credit_payment_fact_v1_1097')throw Error('Provedor não confirmou o pagamento.');
  if(reply.status==='approved'||reply.status==='reversed')tamaoCreditState.pix=null;
  await tamaoCreditRefresh();
  return true;
 }catch(e){if(actor===tamaoCreditActor())
   tamaoCreditState.error='A confirmação ainda não chegou. Confira seu Pix antes de repetir.';
  return false;
 }finally{tamaoCreditState.busy=false;tamaoCreditPaint();}
}

function tamaoCreditMarkup(){
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
 const events=entries.slice(0,12).map(x=>{
  const date=Date.parse(String(x.at||''));
  const text=x.operation==='topup'?'Crédito confirmado':x.operation==='view'?
    'Visualização auditada':'Ajuste de pagamento';
  return '<li><span>'+text+'</span><strong>'+tamaoCreditMoney(x.deltaCents)+
   '</strong><small>'+(Number.isFinite(date)?new Date(date).toLocaleDateString('pt-BR'):'')+
   '</small></li>';
 }).join('');
 const plans=active?'<div class="tamao-credit-plans" role="group" aria-label="Escolha quanto carregar">'+
  tamaoCreditPlans.map(value=>'<button type="button" data-tamao-credit-plan="'+value+
   '" aria-pressed="'+String(tamaoCreditState.amountCents===value)+
   '" onclick="tamaoCreditChoose('+value+')">'+tamaoCreditMoney(value)+'</button>').join('')+
  '</div><label class="check-row"><input type="checkbox" id="tamao-credit-terms">'+
  '<span>Concordo com a recarga antecipada, os descontos por visualizações auditadas e o uso do saldo somente em publicidade. Nenhum débito ocorre apenas por abrir a prévia. Aplicam-se os direitos previstos em lei.</span></label>'+
  '<button type="button" class="primary" onclick="tamaoCreditTopup()" '+
    (tamaoCreditState.busy?'disabled':'')+'>Carregar crédito com Pix</button>':'';
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
  plans+tamaoCreditPixHtml(tamaoCreditState.pix)+
  tamaoCreditCampaignHtml(d)+
  '<p role="status" id="tamao-credit-message">'+tamaoCreditEscape(tamaoCreditState.error)+'</p>'+
  '<details class="tamao-credit-statement"><summary>Ver extrato de créditos e consumos</summary>'+
  (events?'<ul>'+events+'</ul>':'<p>O extrato aparecerá quando houver recargas ou consumo confirmado.</p>')+
  '<button type="button" class="secondary" onclick="tamaoCreditRefresh()">Atualizar meu saldo</button></details>'+
  '<small>Os créditos não são sacáveis nem transferíveis pela rotina normal. Questões legais, contestações de pagamento e correções de cobrança seguem os procedimentos aplicáveis.</small>'+
  '</section>';
}
function tamaoCreditPaint(){
 const el=document.getElementById('tamao-credit-mount');
 if(el)el.innerHTML=tamaoCreditMarkup();
}
async function tamaoCreditRefresh(){
 if(!tamaoCreditVerified()){tamaoCreditState.actor='';tamaoCreditState.data=null;
  tamaoCreditState.loaded=false;tamaoCreditState.pix=null;tamaoCreditPaint();return false;}
 const actor=tamaoCreditActor();
 if(tamaoCreditState.loading)return false;
 tamaoCreditState.loading=true;tamaoCreditState.error='';tamaoCreditPaint();
 try{
  const data=await liveInvoke('ads-credit',{action:'mine'});
  if(tamaoCreditActor()!==actor||!tamaoCreditVerified())return false;
  if(data?.source!=='ads_credit_balance_v1_1097'||!Number.isSafeInteger(data.balanceCents)||
    !Number.isSafeInteger(data.centsPerView)||!Array.isArray(data.entries)||
    !Array.isArray(data.campaigns))
   throw Error('O saldo não foi confirmado pelo servidor.');
  tamaoCreditState.actor=actor;tamaoCreditState.data=data;
  tamaoCreditState.loaded=true;return true;
 }catch(error){
  if(tamaoCreditActor()===actor)tamaoCreditState.error=
   'Não foi possível consultar o saldo agora. Tente novamente.';
  return false;
 }finally{tamaoCreditState.loading=false;tamaoCreditPaint();}
}
function tamaoCreditChoose(value){
 const v=Number(value);
 if(!tamaoCreditPlans.includes(v))return false;
 if(tamaoCreditState.amountCents!==v){tamaoCreditState.requestId=null;
  tamaoCreditState.pix=null;}
 tamaoCreditState.amountCents=v;tamaoCreditPaint();return true;
}
async function tamaoCreditTopup(){
 if(!tamaoCreditVerified()||tamaoCreditState.busy)return false;
 if(tamaoCreditState.data?.rechargeEnabled!==true||
    tamaoCreditState.data?.billingEnabled!==true)return false;
 if(document.getElementById('tamao-credit-terms')?.checked!==true){
  tamaoCreditState.error='Confirme as condições da recarga antes de gerar o Pix.';
  tamaoCreditPaint();return false;
 }
 const actor=tamaoCreditActor(),amount=tamaoCreditState.amountCents;
 if(!tamaoCreditState.requestId||tamaoCreditState.requestAmount!==amount){
  tamaoCreditState.requestId=crypto.randomUUID();tamaoCreditState.requestAmount=amount;}
 tamaoCreditState.busy=true;tamaoCreditState.error='';tamaoCreditPaint();
 try{
  const data=await liveInvoke('ads-credit',{action:'topup',
   requestId:tamaoCreditState.requestId,amountCents:amount,acceptCreditTerms:true});
  if(actor!==tamaoCreditActor()||!tamaoCreditVerified())return false;
  if(data?.source!=='ads_credit_topup_v1_1097')throw Error('Pix não confirmado.');
  if(data.status==='pix_pending'&&typeof data.pixCode==='string'&&
    Number(data.amountCents)===amount){
    tamaoCreditState.pix=data;tamaoCreditState.requestId=null;
    return true;
  }
  await tamaoCreditRefresh();
  return true;
 }catch(error){if(actor===tamaoCreditActor())tamaoCreditState.error=
  String(error?.message||'Não foi possível preparar o Pix. Atualize o saldo antes de repetir.');return false;}
 finally{tamaoCreditState.busy=false;tamaoCreditPaint();}
}
async function tamaoCreditCopyPix(){
 const input=document.getElementById('tamao-credit-pix-code');
 if(!input||!tamaoCreditState.pix)return;
 try{await navigator.clipboard.writeText(input.value);
  tamaoCreditState.error='Código Pix copiado.';}
 catch{tamaoCreditState.error='Selecione o código Pix e copie.';}
 tamaoCreditPaint();
}
function tamaoCreditBoot(){
 if(!document.getElementById('tamao-credit-mount'))return;
 const actor=tamaoCreditActor();
 if(!tamaoCreditVerified()){tamaoCreditState.data=null;
  tamaoCreditState.actor='';tamaoCreditState.loaded=false;
  tamaoCreditPaint();return;}
 if(tamaoCreditState.actor!==actor){tamaoCreditState.data=null;
  tamaoCreditState.loaded=false;tamaoCreditState.pix=null;tamaoCreditState.requestId=null;}
 tamaoCreditPaint();
 if(!tamaoCreditState.loaded&&!tamaoCreditState.loading)
  tamaoCreditRefresh();
}
globalThis.tamaoCreditBoot=tamaoCreditBoot;
globalThis.tamaoCreditRefresh=tamaoCreditRefresh;
