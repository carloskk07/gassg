/* V1.1115: deferred, READ-ONLY public merchant rates. No merchant identity,
   anonymous Auth login, billing operation, or permission to buy a package. */
const merchantPublicPlansState={
 status:'idle',plans:null,checkedAt:0,pending:null,error:null
};
function merchantPublicPlansValid(data){
 if(data?.source!=='merchant_billing_plans'||data.verified!==true||
    !Number.isFinite(Date.parse(String(data.checkedAt||'')))||
    !Array.isArray(data.plans)||data.plans.length<2||data.plans.length>12)return false;
 const arr=data.plans,flex=arr.filter(p=>p.planKey==='flex_daily');
 return flex.length===1&&new Set(arr.map(p=>p.planKey)).size===arr.length&&
    arr.every(p=>p&&/^[a-z][a-z0-9_]{1,39}$/.test(String(p.planKey||''))&&
     typeof p.displayName==='string'&&p.displayName.length>=2&&p.displayName.length<=60&&
     Number.isSafeInteger(p.platformFeeBps)&&p.platformFeeBps>=0&&p.platformFeeBps<=2000&&
     Number.isSafeInteger(p.sortOrder)&&
     (p.planKey==='flex_daily'
       ?p.billingMode==='postpaid_daily'&&p.purchaseAmountCents===null&&p.creditGrantCents===null
       :p.billingMode==='prepaid_credit'&&
        Number.isSafeInteger(p.purchaseAmountCents)&&p.purchaseAmountCents>=100&&
        p.purchaseAmountCents<=10000000&&p.creditGrantCents===p.purchaseAmountCents));
}
async function tamaoMerchantPublicPlansLoad(){
 if(globalThis.__CHAMA_TEST__===true||
    typeof CHAMA_BACKEND==='undefined'||!CHAMA_BACKEND.url||
    !CHAMA_BACKEND.publishableKey||typeof fetch!=='function')return null;
 if(merchantPublicPlansState.pending)return merchantPublicPlansState.pending;
 if(Date.now()-merchantPublicPlansState.checkedAt<120000)
    return merchantPublicPlansState.plans;
 const before=merchantPublicPlansState;
 const job=(async()=>{
  try{
   const reply=await (typeof chamaFetch==='function'?chamaFetch:fetch)(
    CHAMA_BACKEND.url+'/functions/v1/merchant-public-plans',{
     method:'POST',cache:'no-store',
     headers:{apikey:CHAMA_BACKEND.publishableKey,'Content-Type':'application/json'},
     body:'{}'
    },9000);
   if(!reply.ok)throw new Error('Public merchant plans unavailable');
   const data=await reply.json();
   if(!merchantPublicPlansValid(data))throw new Error('Merchant plan catalogue integrity');
   const plans=data.plans.map(p=>Object.freeze({
    key:p.planKey,name:p.displayName,bps:p.platformFeeBps,
    cents:p.purchaseAmountCents||0,mode:p.billingMode,
    sortOrder:p.sortOrder
   })).sort((a,b)=>a.sortOrder-b.sortOrder);
   merchantPublicPlansState.plans=Object.freeze(plans);
   merchantPublicPlansState.checkedAt=Date.now();
   merchantPublicPlansState.status='ready';
   merchantPublicPlansState.error=null;
   if(typeof route==='function'&&['merchants','earn'].includes(route())&&typeof render==='function')render();
   return plans;
  }catch(error){
   // Never call old hardcoded numbers "current" when the official read fails.
   merchantPublicPlansState.plans=null;
   merchantPublicPlansState.status='unavailable';
   merchantPublicPlansState.error=String(error?.message||error);
   merchantPublicPlansState.checkedAt=Date.now()-90000; // retry after 30s
   if(typeof route==='function'&&['merchants','earn'].includes(route())&&typeof render==='function')render();
   return null;
  }finally{if(before.pending===job)before.pending=null}
 })();
 merchantPublicPlansState.pending=job;
 return job;
}
globalThis.tamaoMerchantPublicPlans=merchantPublicPlansState;
globalThis.tamaoMerchantPublicPlansLoad=tamaoMerchantPublicPlansLoad;
tamaoMerchantPublicPlansLoad();
globalThis.addEventListener?.('hashchange',()=>{
 if(typeof route==='function'&&['merchants','earn'].includes(route()))
   tamaoMerchantPublicPlansLoad();
});


// Credit coverage is an illustration of fully payable fees, never an order forecast.
function merchantPlanCoverageCount(ticket,bps,cents){
 const t=Number(ticket),rate=Number(bps),credit=Number(cents);
 const rounded=Math.round(t*100);
 if(!Number.isFinite(t)||t<1||t>10000||Math.abs(t*100-rounded)>.00001||
   ![rate,credit].every(Number.isSafeInteger)||rate<0||rate>2000||
   credit<0||credit>10000000)return null;
 const fee=Math.round(t*rate/100);
 return fee>0?Math.floor(credit/fee):null;
}
function merchantPlanCoverageRefresh(ticket){
 if(typeof document==='undefined')return false;
 const section=document.getElementById('merchant-plans');
 if(!section)return false;
 section.querySelectorAll('[data-merchant-coverage-for]').forEach(card=>{
  const count=merchantPlanCoverageCount(ticket,Number(card.getAttribute('data-merchant-plan-bps')),Number(card.getAttribute('data-merchant-plan-credit-cents')));
  const value=card.querySelector('[data-merchant-coverage-value]');
  const caption=card.querySelector('[data-merchant-coverage-caption]');
  if(value)value.textContent=count===null?'Não aplicável':count+' '+(count===1?'taxa completa':'taxas completas');
  if(caption)caption.textContent='Com pedido ilustrativo de '+BRL.format(Number(ticket));
 });
 const active=section.querySelector('[data-merchant-compare-plan][aria-pressed="true"]');
 const result=section.querySelector('[data-merchant-receipt-coverage]');
 if(active&&result){
  const count=merchantPlanCoverageCount(ticket,Number(active.getAttribute('data-merchant-plan-bps')),Number(active.getAttribute('data-merchant-plan-credit-cents')));
  result.textContent=count===null?'Consulte as condições aplicáveis.':
   'A recarga cobre até '+count+' '+(count===1?'taxa completa':'taxas completas')+' com este valor de pedido.';
 }
 return true;
}

// Only the commercial landing downloads this optional, read-only calculator.
function merchantPlanTicketPreview(value){
const ticket=Number(value);
if(![100,120,200].includes(ticket)||typeof document==='undefined')return false;
const section=document.getElementById('merchant-plans');
if(!section)return false;
globalThis.merchantPreviewAmount=ticket;
const custom=section.querySelector?.('#merchant-v1120-order-value');
if(custom)custom.value='';
const status=document.getElementById('merchant-v1120-custom-status');
if(status)status.textContent='Valor de referência selecionado: '+BRL.format(ticket)+'.';
const currency=BRL.format(ticket);
section.querySelectorAll('[data-merchant-ticket]').forEach(button=>{
 button.setAttribute('aria-pressed',String(Number(button.getAttribute('data-merchant-ticket'))===ticket));
});
section.querySelectorAll('[data-merchant-order-ticket]').forEach(element=>{element.textContent=currency;});
section.querySelectorAll('[data-merchant-saving-bps]').forEach(element=>{
 const bps=Number(element.getAttribute('data-merchant-saving-bps'));
 if(Number.isInteger(bps)&&bps>=0&&bps<=2000)
  element.textContent=BRL.format(ticket*bps/10000);
});
const active=typeof section.querySelector==='function'
 ?section.querySelector('[data-merchant-compare-plan][aria-pressed="true"]'):null;
if(active)merchantPlanReceiptPreview(active.getAttribute('data-merchant-compare-plan'),ticket);
if(typeof section.querySelector==='function'&&section.querySelector('[data-merchant-coverage-for]'))merchantPlanCoverageRefresh(ticket);
return true;
}

// Read-only merchant billing example: no requests, transactions or account writes.
function merchantPlanReceiptPreview(key,ticketValue){
 if(typeof document==='undefined')return false;
 const section=document.getElementById('merchant-plans');
 if(!section)return false;
 const choices=Array.from(section.querySelectorAll('[data-merchant-compare-plan]'));
 const choice=choices.find(el=>el.getAttribute('data-merchant-compare-plan')===key);
 if(!choice)return false;
 const activeTicket=Array.from(section.querySelectorAll('[data-merchant-ticket]'))
  .find(el=>el.getAttribute('aria-pressed')==='true');
 const ticket=Number(ticketValue===undefined?(globalThis.merchantPreviewAmount||activeTicket?.getAttribute('data-merchant-ticket')):ticketValue);
 const ticketCents=Math.round(ticket*100);
 if(!Number.isFinite(ticket)||ticket<1||ticket>10000||Math.abs(ticket*100-ticketCents)>.00001)return false;
 const flexBps=Number(section.getAttribute('data-merchant-flex-bps'));
 const planBps=Number(choice.getAttribute('data-merchant-plan-bps'));
 const creditCents=Number(choice.getAttribute('data-merchant-plan-credit-cents'));
 if(![flexBps,planBps,creditCents].every(Number.isSafeInteger)||
    flexBps<0||flexBps>2000||planBps<0||planBps>2000||
    creditCents<0||creditCents>10000000)return false;
 const flexFeeCents=Math.round(ticket*flexBps/100);
 const planFeeCents=Math.round(ticket*planBps/100);
 const enough=creditCents>=planFeeCents;
 const write=(name,value)=>section.querySelectorAll('[data-merchant-receipt-'+name+']')
  .forEach(el=>{el.textContent=value});
 const money=cents=>BRL.format(cents/100);
 write('plan',choice.getAttribute('data-merchant-plan-name')||'Pacote');
 write('flex',money(flexFeeCents));
 write('fee',money(planFeeCents));
 write('saving',money(flexFeeCents-planFeeCents));
 write('credit',money(creditCents));
 write('balance',enough?money(creditCents-planFeeCents):'Saldo insuficiente');
 write('status',enough
  ?'Com pagamento confirmado e saldo disponível, a taxa é debitada dos créditos.'
  :'Saldo insuficiente neste exemplo. A tarifa reduzida exige crédito disponível.');
 choices.forEach(el=>{
   const isSelected=el.getAttribute('data-merchant-compare-plan')===key;
   el.setAttribute('aria-pressed',String(isSelected));
   const card=el.closest?.('.merchant-v1115-plan');
   card?.classList?.toggle('merchant-v1122-selected',isSelected);
 });
if(typeof section.querySelector==='function'&&section.querySelector('[data-merchant-coverage-for]'))merchantPlanCoverageRefresh(ticket);
 if(ticketValue===undefined){
  const receipt=document.getElementById('merchant-plan-receipt');
  receipt?.scrollIntoView?.({behavior:'auto',block:'nearest'});
 }
 return true;
}
globalThis.merchantPlanReceiptPreview=merchantPlanReceiptPreview;
globalThis.merchantPlanTicketPreview=merchantPlanTicketPreview;


// Optional read-only comparison with a custom order value.
function merchantPlanCustomTicketPreview(value){
 const ticket=Number(typeof value==='string'?value.trim().replace(',','.'):value),cents=Math.round(ticket*100);
 if(!Number.isFinite(ticket)||ticket<1||ticket>10000||Math.abs(ticket*100-cents)>.00001)return false;
 if(typeof document==='undefined')return false;
 const section=document.getElementById('merchant-plans');
 if(!section)return false;
 const amount=cents/100,flexBps=Number(section.getAttribute('data-merchant-flex-bps'));
 if(!Number.isSafeInteger(flexBps)||flexBps<0||flexBps>2000)return false;
 section.querySelectorAll('[data-merchant-ticket]').forEach(button=>button.setAttribute('aria-pressed','false'));
 section.querySelectorAll('[data-merchant-order-ticket]').forEach(el=>{el.textContent=BRL.format(amount)});
 section.querySelectorAll('[data-merchant-saving-bps]').forEach(el=>{
  const bps=Number(el.getAttribute('data-merchant-saving-bps'));
  if(Number.isSafeInteger(bps)&&bps>=0&&bps<=2000){
   const planBps=flexBps-bps;
   const delta=Math.round(amount*flexBps/100)-Math.round(amount*planBps/100);
   el.textContent=BRL.format(delta/100);
  }
 });
 globalThis.merchantPreviewAmount=amount;
 const active=section.querySelector('[data-merchant-compare-plan][aria-pressed="true"]');
 if(active)merchantPlanReceiptPreview(active.getAttribute('data-merchant-compare-plan'),amount);
 merchantPlanCoverageRefresh(amount);
 return true;
}
function merchantPlanCustomTicketChange(input){
 const value=input?.value;
 const status=document.getElementById('merchant-v1120-custom-status');
 if(!merchantPlanCustomTicketPreview(value)){
  if(status)status.textContent='Informe um valor entre R$ 1,00 e R$ 10.000,00, com até duas casas decimais.';
  return false;
 }
 if(status)status.textContent='Comparação atualizada para '+BRL.format(Number(String(value).replace(',','.')))+'.';
 return true;
}
globalThis.merchantPlanCustomTicketPreview=merchantPlanCustomTicketPreview;
globalThis.merchantPlanCustomTicketChange=merchantPlanCustomTicketChange;


// Preview the visitor's own brand locally; never sends, stores or publishes the text.
function merchantBrandPreviewHydrate(){
 if(typeof document==='undefined')return false;
 const showcase=document.querySelector('.merchant-v1112-window');
 if(!showcase)return false;
 if(showcase.querySelector('.merchant-v1120-brand-demo'))return true;
 const intro=showcase.querySelector('.merchant-v1112-window-intro');
 if(!intro)return false;
 const block=document.createElement('div');
 block.className='merchant-v1120-brand-demo';
 block.innerHTML='<div class="merchant-v1120-brand-identity">'+
  '<span class="merchant-v1120-brand-monogram" aria-hidden="true">S</span>'+
  '<div class="merchant-v1120-brand-words"><small>SUA VITRINE NO TAMÃO</small>'+
  '<strong class="merchant-v1120-brand-name">Sua revenda</strong>'+
  '<span>Seu catálogo • Sua operação</span></div></div>'+
  '<label class="merchant-v1120-brand-label" for="merchant-brand-try">Experimente com o nome da sua revenda</label>'+
  '<input id="merchant-brand-try" class="merchant-v1120-brand-input" type="text" maxlength="42" '+
   'autocomplete="off" spellcheck="false" placeholder="Nome da sua revenda">'+
  '<small class="merchant-v1120-brand-hint">Experimente sua identidade. O nome não é salvo neste campo.</small>';
 const input=block.querySelector('input');
 const display=block.querySelector('.merchant-v1120-brand-name');
 const monogram=block.querySelector('.merchant-v1120-brand-monogram');
 const refresh=()=>{
  const value=String(input.value||'').replace(/\s+/g,' ').trim().slice(0,42);
  globalThis.merchantPreviewBrandName=value;
  display.textContent=value||'Sua revenda';
  monogram.textContent=(value||'Sua revenda').charAt(0).toLocaleUpperCase('pt-BR');
 };
 input.addEventListener('input',refresh);
 input.value=String(globalThis.merchantPreviewBrandName||'').slice(0,42);
 refresh();
 intro.insertAdjacentElement('afterend',block);
 return true;
}
globalThis.merchantBrandPreviewHydrate=merchantBrandPreviewHydrate;


// Interactive tour of actual merchant capabilities; no artificial orders or financial data.
function merchantExecutiveTourHydrate(){
 if(typeof document==='undefined')return false;
 const showcase=document.querySelector('.merchant-v1112-window');
 if(!showcase)return false;
 if(showcase.querySelector('.merchant-v1123-tour'))return true;
 const intro=showcase.querySelector('.merchant-v1112-window-intro');
 const brand=showcase.querySelector('.merchant-v1120-brand-demo');
 const products=showcase.querySelector('.merchant-v1113-products');
 const controlbar=showcase.querySelector('.merchant-v1113-controlbar');
 if(!intro||!brand||!products||!controlbar)return false;
 const nav=document.createElement('div');
 nav.className='merchant-v1123-tour';
 nav.innerHTML=
 '<div class="merchant-v1123-tour-caption">CONHEÇA O PORTAL EM 3 VISÕES</div>'+
 '<div class="merchant-v1123-tour-tabs" role="tablist" aria-label="Explore recursos para revendas">'+
 '<button type="button" role="tab" id="merchant-v1123-tab-vitrine" data-merchant-tour-tab="vitrine" aria-controls="merchant-v1123-view-vitrine" aria-selected="true" tabindex="0">Vitrine</button>'+
 '<button type="button" role="tab" id="merchant-v1123-tab-pedidos" data-merchant-tour-tab="pedidos" aria-controls="merchant-v1123-view-pedidos" aria-selected="false" tabindex="-1">Pedidos</button>'+
 '<button type="button" role="tab" id="merchant-v1123-tab-financeiro" data-merchant-tour-tab="financeiro" aria-controls="merchant-v1123-view-financeiro" aria-selected="false" tabindex="-1">Recebimento</button>'+
 '</div>';
 const vitrine=document.createElement('section');
 vitrine.className='merchant-v1123-tour-panel merchant-v1123-vitrine';
 vitrine.id='merchant-v1123-view-vitrine';
 vitrine.setAttribute('role','tabpanel');
 vitrine.setAttribute('aria-labelledby','merchant-v1123-tab-vitrine');
 vitrine.tabIndex=0;
 const orders=document.createElement('section');
 orders.className='merchant-v1123-tour-panel merchant-v1123-tour-process';
 orders.id='merchant-v1123-view-pedidos';
 orders.setAttribute('role','tabpanel');
 orders.setAttribute('aria-labelledby','merchant-v1123-tab-pedidos');
 orders.tabIndex=0;
 orders.innerHTML=
  '<span class="merchant-v1123-tour-kicker">PEDIDOS SEM PERDER AUTONOMIA</span>'+
  '<h3>O pedido chega. A decisão é sua.</h3>'+
  '<ol class="merchant-v1123-tour-steps">'+
   '<li><b>01</b><div><strong>Cliente encontra sua revenda</strong><small>Produtos e área de atendimento cadastrados.</small></div></li>'+
   '<li><b>02</b><div><strong>Você aceita quando puder</strong><small>Controle disponibilidade, estoque e prazo.</small></div></li>'+
   '<li><b>03</b><div><strong>Entrega acompanhada</strong><small>Confirmação da saída e do recebimento.</small></div></li>'+
  '</ol>'+
  '<p class="merchant-v1123-tour-note">Seu painel organiza o atendimento desde a solicitação até a entrega.</p>';
 const finance=document.createElement('section');
 finance.className='merchant-v1123-tour-panel merchant-v1123-tour-finance';
 finance.id='merchant-v1123-view-financeiro';
 finance.setAttribute('role','tabpanel');
 finance.setAttribute('aria-labelledby','merchant-v1123-tab-financeiro');
 finance.tabIndex=0;
 finance.innerHTML=
  '<span class="merchant-v1123-tour-kicker">DINHEIRO COM FLUXO TRANSPARENTE</span>'+
  '<h3>Sua venda pertence à sua revenda.</h3>'+
  '<div class="merchant-v1123-money-grid">'+
   '<div><span>01 · VENDA</span><strong>Recebimento direto</strong><small>O cliente paga pelos meios aceitos pela sua empresa.</small></div>'+
   '<div><span>02 · PLATAFORMA</span><strong>Taxa separada</strong><small>O TAMÃO registra a cobrança da plataforma sem reter a venda.</small></div>'+
  '</div>'+
  '<p class="merchant-v1123-tour-note">Escolha Flex sem recarga ou créditos antecipados opcionais. As tarifas oficiais estão na comparação abaixo.</p>';
 intro.insertAdjacentElement('afterend',nav);
 nav.insertAdjacentElement('afterend',vitrine);
 vitrine.appendChild(brand);
 vitrine.appendChild(products);
 vitrine.appendChild(controlbar);
 vitrine.insertAdjacentElement('afterend',orders);
 orders.insertAdjacentElement('afterend',finance);
 const keys=['vitrine','pedidos','financeiro'];
 const panes=[vitrine,orders,finance];
 const tabs=Array.from(nav.querySelectorAll('[role="tab"]'));
 if(tabs.length!==keys.length)return false;
 const activate=key=>{
  const index=keys.indexOf(key);
  if(index<0)return false;
  panes.forEach((panel,i)=>{panel.hidden=i!==index});
  tabs.forEach((tab,i)=>{
   tab.setAttribute('aria-selected',String(i===index));
   tab.tabIndex=i===index?0:-1;
  });
  return true;
 };
 tabs.forEach((tab,i)=>{
  tab.addEventListener('click',()=>activate(keys[i]));
  tab.addEventListener('keydown',event=>{
   const selected=keys.findIndex((_,j)=>tabs[j].getAttribute('aria-selected')==='true');
   const current=selected<0?i:selected;
   const next=event.key==='ArrowRight'?(current+1)%keys.length:
    event.key==='ArrowLeft'?(current+keys.length-1)%keys.length:
    event.key==='Home'?0:event.key==='End'?keys.length-1:-1;
   if(next<0)return;
   event.preventDefault();
   activate(keys[next]);
   tabs[next].focus();
  });
 });
 activate('vitrine');
 return true;
}
globalThis.merchantExecutiveTourHydrate=merchantExecutiveTourHydrate;

/* Build the explanatory receipt only when the merchant landing is visited.
   This keeps customer checkout below its strict initial JS budget. */
function merchantPlanReceiptHydrate(){
 if(typeof document==='undefined')return false;
 merchantBrandPreviewHydrate();
 merchantExecutiveTourHydrate();
 const section=document.getElementById('merchant-plans');
 const grid=section?.querySelector('.merchant-v1115-plans-grid');
 if(!grid)return false;
 const state=globalThis.tamaoMerchantPublicPlans;
 const plans=state?.status==='ready'&&Array.isArray(state.plans)
  ?state.plans:MERCHANT_PUBLIC_BILLING_PLANS;
 const prepaid=plans.slice(1),cards=Array.from(grid.querySelectorAll('article.merchant-v1115-plan'));
 if(!prepaid.length||cards.length!==prepaid.length)return false;
 section.setAttribute('data-merchant-flex-bps',String(plans[0].bps));
 prepaid.forEach((plan,i)=>{
  const card=cards[i];
  if(card.querySelector('[data-merchant-compare-plan]'))return;
  const button=document.createElement('button');
  button.type='button';
  button.className='merchant-v1118-plan-action';
  button.textContent='Ver taxa e saldo →';
  button.setAttribute('aria-label','Ver taxa e saldo do pacote '+plan.name);
  button.setAttribute('data-merchant-compare-plan',plan.key);
  button.setAttribute('data-merchant-plan-bps',String(plan.bps));
  button.setAttribute('data-merchant-plan-credit-cents',String(plan.cents));
  button.setAttribute('data-merchant-plan-name',plan.name);
  button.setAttribute('aria-controls','merchant-plan-receipt');
  button.setAttribute('aria-pressed',String(i===0));
  button.addEventListener('click',()=>merchantPlanReceiptPreview(plan.key));
  const coverage=document.createElement('div');
  coverage.className='merchant-v1119-coverage';
  coverage.setAttribute('data-merchant-coverage-for',plan.key);
  coverage.setAttribute('data-merchant-plan-bps',String(plan.bps));
  coverage.setAttribute('data-merchant-plan-credit-cents',String(plan.cents));
  coverage.innerHTML='<span>ESTA RECARGA COBRE ATÉ</span><strong data-merchant-coverage-value>—</strong><small data-merchant-coverage-caption></small>';
  const caption=card.querySelector('p');
  if(caption)card.insertBefore(coverage,caption);else card.appendChild(coverage);
  if(caption)card.insertBefore(button,caption);else card.appendChild(button);
 });
 if(!document.getElementById('merchant-plan-receipt')){
  const receipt=document.createElement('section');
  receipt.className='merchant-v1118-receipt';
  receipt.id='merchant-plan-receipt';
  receipt.tabIndex=-1;
  receipt.setAttribute('aria-label','Exemplo detalhado da cobrança da taxa');
  receipt.innerHTML=`
<div class="merchant-v1118-receipt-head">
<span>TRANSPARÊNCIA EM CADA PEDIDO</span>
<h3>O crédito paga a taxa. <em>Não é uma segunda cobrança.</em></h3>
<p>Selecione um pacote acima. Veja uma venda de <strong data-merchant-order-ticket>R$ 120,00</strong> em um exemplo ilustrativo.</p>
</div>
<div class="merchant-v1118-receipt-body">
<div class="merchant-v1118-receipt-title"><span>EXEMPLO DE COBRANÇA</span><strong data-merchant-receipt-plan>—</strong></div>
<div class="merchant-v1118-receipt-numbers">
<div><span>Taxa sem recarga (Flex)</span><strong data-merchant-receipt-flex>—</strong></div>
<div><span>Taxa com este pacote</span><strong data-merchant-receipt-fee>—</strong></div>
<div class="merchant-v1118-receipt-highlight"><span>Diferença nesta venda</span><strong data-merchant-receipt-saving>—</strong></div>
</div>
<div class="merchant-v1118-receipt-balance">
<div><span>Crédito carregado</span><strong data-merchant-receipt-credit>—</strong></div>
<div><span>Saldo ilustrativo após uma taxa</span><strong data-merchant-receipt-balance>—</strong></div>
</div>
<p class="merchant-v1119-receipt-coverage" data-merchant-receipt-coverage></p>
<p class="merchant-v1118-receipt-status" data-merchant-receipt-status role="status" aria-live="polite" aria-atomic="true">Comparando valores do catálogo.</p>
</div>
<p class="merchant-v1118-receipt-note">Exemplo de um pedido, sem realizar cobranças. Os créditos são um adiantamento para taxas do TAMÃO, não o pagamento de uma tarifa extra. A redução depende do pacote ativo e de saldo suficiente.</p>
`;
  grid.insertAdjacentElement('afterend',receipt);
 }
 if(!section.querySelector('.merchant-v1119-ways')){
  const ways=document.createElement('section');
  ways.className='merchant-v1119-ways';
  ways.setAttribute('aria-label','Duas maneiras de começar');
  ways.innerHTML=`
  <div class="merchant-v1119-ways-title"><span>DECIDA COM CLAREZA</span><h3>O seu jeito de começar.</h3></div>
  <div class="merchant-v1119-ways-grid">
   <article class="merchant-v1119-way"><span>01 / SEM RECARGA</span><strong>Flex Diário</strong><b data-merchant-way-flex>—</b>
    <p>Tarifa por pedido concluído, sem comprar créditos antes.</p>
    <button type="button" data-merchant-way-signup>Cadastrar minha revenda <span aria-hidden="true">→</span></button>
   </article>
   <article class="merchant-v1119-way merchant-v1119-way-prepaid"><span>02 / COM CRÉDITOS</span><strong>Tarifas reduzidas</strong><b data-merchant-way-prepaid>—</b>
    <p>Créditos antecipados para pagar taxas menores, conforme o plano e o saldo.</p>
    <button type="button" data-merchant-way-compare>Ver pacotes <span aria-hidden="true">→</span></button>
   </article>
  </div>
  <p class="merchant-v1119-ways-note">Cadastro gratuito nos dois caminhos. Os pacotes são opcionais e ficam no Financeiro da revenda.</p>`;
  section.insertBefore(ways,section.querySelector('.merchant-v1117-ticketbar')||grid);
  ways.querySelector('[data-merchant-way-signup]')?.addEventListener('click',()=>openMerchantPortal(true));
  ways.querySelector('[data-merchant-way-compare]')?.addEventListener('click',()=>grid.scrollIntoView({block:'start',behavior:'auto'}));
 }
 const flex=plans[0],lowest=prepaid.reduce((best,next)=>next.bps<best.bps?next:best);
 section.querySelector('[data-merchant-way-flex]').textContent=(flex.bps/100).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
 section.querySelector('[data-merchant-way-prepaid]').textContent='A partir de '+(lowest.bps/100).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
 const ticketbar=section.querySelector('.merchant-v1117-ticketbar');
 if(ticketbar&&!ticketbar.querySelector('.merchant-v1120-custom-ticket')){
  const label=document.createElement('label');
  label.className='merchant-v1120-custom-ticket';
  label.setAttribute('for','merchant-v1120-order-value');
  const title=document.createElement('span');
  title.textContent='OUTRO VALOR DO PEDIDO (R$)';
  const input=document.createElement('input');
  input.id='merchant-v1120-order-value';
  input.type='text';input.inputMode='decimal';input.maxLength=10;
  input.placeholder='Ex.: 125,90';
  input.setAttribute('aria-describedby','merchant-v1120-custom-status');
  const status=document.createElement('small');
  status.id='merchant-v1120-custom-status';status.setAttribute('role','status');
  status.textContent='Use o valor médio da sua revenda.';
  input.addEventListener('change',()=>merchantPlanCustomTicketChange(input));
  label.append(title,input,status);
  ticketbar.appendChild(label);
 }
 const selected=section.querySelector('[data-merchant-compare-plan][aria-pressed="true"]');
 const selectedTicket=section.querySelector('[data-merchant-ticket][aria-pressed="true"]');
 const ticket=Number(globalThis.merchantPreviewAmount||selectedTicket?.getAttribute('data-merchant-ticket')||120);
 if(![100,120,200].includes(ticket)){
  const custom=section.querySelector('#merchant-v1120-order-value');
  if(custom)custom.value=String(ticket);
  return merchantPlanCustomTicketPreview(ticket);
 }
 const result=merchantPlanReceiptPreview(selected?.getAttribute('data-merchant-compare-plan')||prepaid[0].key,ticket);
 merchantPlanCoverageRefresh(ticket);
 return result;
}
globalThis.merchantPlanReceiptHydrate=merchantPlanReceiptHydrate;
setTimeout(merchantPlanReceiptHydrate,0);
