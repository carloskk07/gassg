/* Direct seller-payment handoff: no redirect without current customer/order proof.
 * Lazily loaded only on explicit checkout click. The PSP and backend remain
 * responsible for payment/settlement; no client-side financial write exists. */
(()=>{
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const stages=new Set(['MERCHANT_ACCEPTED','PREPARING','AT_RISK','OUT_FOR_DELIVERY','ARRIVING']);
 const safeUrl=url=>typeof url==='string'&&
  /^https:\/\/(?:[a-z0-9-]+\.)*mercadopago\.com(?:\.br)?\//i.test(url);
 function validPayment(order,expected){
  const payment=order?.onlinePayment||{};
  const cents=Number(order?.totalCents),amount=Number(payment.amountCents);
  return order?.orderId===expected&&stages.has(order.status)&&
    order.paymentTiming==='prepaid'&&['pix','card'].includes(order.paymentMethod)&&
    Number.isSafeInteger(cents)&&cents>0&&Number.isSafeInteger(amount)&&amount===cents&&
    payment.fundsOwner==='merchant'&&payment.tamaoReceivesSaleProceeds===false&&
    payment.provider==='mercadopago'&&payment.available===true;
 }
 const reusableCheckout=payment=>['checkout_ready','pending'].includes(payment?.status);
 const notExpired=payment=>!payment?.expiresAt||
   Number.isFinite(Date.parse(payment.expiresAt))&&Date.parse(payment.expiresAt)>Date.now()+1000;
 globalThis.customerDirectPaymentStart=async function(orderId,{
   liveRuntime:rt,liveReady,liveIdempotency,retryAmbiguousOnce,
   liveInvoke,liveGetOrder,toast,render,location
 }){
   const id=String(orderId||''),userId=String(rt.session?.user?.id||'');
   const same=()=>liveReady()&&rt.session?.user?.id===userId&&
     rt.orderId===id&&rt.order?.orderId===id;
   if(rt.actionPending)return false;
   if(!UUID.test(id)||!userId||!same()){
     rt.error='O pedido selecionado mudou. Atualize o acompanhamento antes de pagar.';
     toast(rt.error);render();return false;
   }
   rt.actionPending=true;rt.error=null;render();
   const readFresh=async()=>{
     const requestedAt=Date.now();
     const order=await liveGetOrder(id,{silent:true});
     const checkedAt=Date.parse(String(rt.orderCheckedAt||''));
     if(rt.orderCheckedId!==id||!Number.isFinite(checkedAt)||
        checkedAt<requestedAt||checkedAt>Date.now()+2000)
       throw Error('O pedido não recebeu uma atualização confirmada. Confira antes de pagar.');
     return order;
   };
   let mutationStarted=false;
   try{
     // An old DOM or provider link cannot authorize a payment:
     // get-order must confirm the current customer, merchant and amount.
     let order=await readFresh();
     if(!same())return false;
     if(!validPayment(order,id))
       throw Error('O pagamento online deste pedido não está confirmado. Atualize o acompanhamento.');
     const payment=order.onlinePayment;
     if(payment.status==='approved'){
       toast('Pagamento já confirmado no pedido atualizado.');
       return true;
     }
     let url=payment.checkoutUrl;
     if(url){
       if(!reusableCheckout(payment)||!safeUrl(url)||!notExpired(payment))
         throw Error('O link de pagamento não está válido. Atualize o pedido.');
     }else{
       if(payment.canStart!==true)
         throw Error('O pagamento ainda não pode ser iniciado para este pedido.');
       const idempotencyKey=liveIdempotency('merchant-sale-payment');
       mutationStarted=true;
       const reply=await retryAmbiguousOnce(()=>liveInvoke('order-payment-checkout',
         {orderId:id},{idempotencyKey}));
       if(!same())return false;
       if(reply?.ok!==true||reply.orderId!==id||reply.error||reply.success===false)
         throw Error('O servidor não confirmou a tentativa de pagamento para este pedido.');
       const expectedUrl=reply?.alreadyPaid===true?null:String(reply.checkoutUrl||'');
       if(reply?.alreadyPaid!==true&&!safeUrl(expectedUrl))
         throw Error('O checkout retornou um endereço de pagamento inválido.');
       order=await readFresh();
       if(!same())return false;
       if(reply.alreadyPaid===true){
         if(!validPayment(order,id)||order.onlinePayment.status!=='approved')
           throw Error('Pagamento informado, mas ainda não confirmado no acompanhamento.');
         toast('Pagamento já confirmado no pedido atualizado.');
         return true;
       }
       if(!validPayment(order,id)||!reusableCheckout(order.onlinePayment)||
          !safeUrl(order.onlinePayment.checkoutUrl)||
          order.onlinePayment.checkoutUrl!==expectedUrl||!notExpired(order.onlinePayment))
         throw Error('O link criado ainda não foi confirmado no pedido. Não inicie outra tentativa.');
       url=expectedUrl;
     }
     if(!same())return false;
     location.href=url;
     return true;
   }catch(error){
     if(!same())return false;
     // For an ambiguous network/5xx error, recover ONLY a link visible
     // in a second authenticated read for the exact order and amount.
     const ambiguous=mutationStarted&&(
       error instanceof TypeError||['TypeError','TimeoutError','AbortError'].includes(error?.name)||
       Number.isInteger(error?.status)&&error.status>=500
     );
     if(ambiguous){
       let checked=null;
       try{checked=await readFresh()}catch{}
       if(!same())return false;
       if(validPayment(checked,id)&&reusableCheckout(checked.onlinePayment)&&
          safeUrl(checked.onlinePayment.checkoutUrl)&&
          notExpired(checked.onlinePayment)){
         location.href=checked.onlinePayment.checkoutUrl;
         return true;
       }
       if(validPayment(checked,id)&&checked.onlinePayment.status==='approved'){
         toast('Pagamento confirmado na consulta atualizada.');
         return true;
       }
     }
     rt.error='Não foi possível confirmar o pagamento deste pedido. Confira o andamento antes de tentar novamente.';
     toast(rt.error);return false;
   }finally{
     rt.actionPending=false;
     render();
   }
 };
})();