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
return true;
}

globalThis.merchantPlanTicketPreview=merchantPlanTicketPreview;
