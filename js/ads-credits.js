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
  safeCode+'</textarea></label><button type="button" class="secondary" onclick="tamaoCreditCopyPix()">Copiar Pix</button></section>';
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
    !Number.isSafeInteger(data.centsPerView)||!Array.isArray(data.entries))
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
