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

// Only the commercial landing downloads this optional, read-only calculator.
function merchantPlanTicketPreview(value){
const ticket=Number(value);
if(![100,120,200].includes(ticket)||typeof document==='undefined')return false;
const section=document.getElementById('merchant-plans');
if(!section)return false;
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
 const ticket=Number(ticketValue===undefined?activeTicket?.getAttribute('data-merchant-ticket'):ticketValue);
 if(![100,120,200].includes(ticket))return false;
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
 choices.forEach(el=>el.setAttribute('aria-pressed',
  String(el.getAttribute('data-merchant-compare-plan')===key)));
 if(ticketValue===undefined){
  const receipt=document.getElementById('merchant-plan-receipt');
  receipt?.scrollIntoView?.({behavior:'auto',block:'nearest'});
 }
 return true;
}
globalThis.merchantPlanReceiptPreview=merchantPlanReceiptPreview;
globalThis.merchantPlanTicketPreview=merchantPlanTicketPreview;

/* Build the explanatory receipt only when the merchant landing is visited.
   This keeps customer checkout below its strict initial JS budget. */
function merchantPlanReceiptHydrate(){
 if(typeof document==='undefined')return false;
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
  button.textContent='Entender este pacote →';
  button.setAttribute('data-merchant-compare-plan',plan.key);
  button.setAttribute('data-merchant-plan-bps',String(plan.bps));
  button.setAttribute('data-merchant-plan-credit-cents',String(plan.cents));
  button.setAttribute('data-merchant-plan-name',plan.name);
  button.setAttribute('aria-controls','merchant-plan-receipt');
  button.setAttribute('aria-pressed',String(i===0));
  button.addEventListener('click',()=>merchantPlanReceiptPreview(plan.key));
  const caption=card.querySelector('p');
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
<p>Escolha “Entender este pacote” acima. Veja uma venda de <strong data-merchant-order-ticket>R$ 120,00</strong> em um exemplo ilustrativo.</p>
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
<p class="merchant-v1118-receipt-status" data-merchant-receipt-status role="status" aria-live="polite" aria-atomic="true">Comparando valores do catálogo.</p>
</div>
<p class="merchant-v1118-receipt-note">Exemplo de um pedido, sem realizar cobranças. Os créditos são um adiantamento para taxas do TAMÃO, não o pagamento de uma tarifa extra. A redução depende do pacote ativo e de saldo suficiente.</p>
`;
  grid.insertAdjacentElement('afterend',receipt);
 }
 const selected=section.querySelector('[data-merchant-compare-plan][aria-pressed="true"]');
 const selectedTicket=section.querySelector('[data-merchant-ticket][aria-pressed="true"]');
 const ticket=Number(selectedTicket?.getAttribute('data-merchant-ticket')||120);
 return merchantPlanReceiptPreview(selected?.getAttribute('data-merchant-compare-plan')||prepaid[0].key,ticket);
}
globalThis.merchantPlanReceiptHydrate=merchantPlanReceiptHydrate;
setTimeout(merchantPlanReceiptHydrate,0);
