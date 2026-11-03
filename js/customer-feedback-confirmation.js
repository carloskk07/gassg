// Loaded on demand only when a customer rates a settled delivery.
// The server controls the write; only a fresh installed get-order confirms it.
(()=>{
'use strict';
globalThis.customerFeedbackConfirmSubmit=async function(rating,tags=[],{
  liveRuntime,liveReady,isAmbiguousTransportError,liveInvoke,liveGetOrder,render
}){
  const rt=liveRuntime;
  const order=rt.order;
  const orderId=String(order?.orderId||'');
  const actor=String(rt.session?.user?.id||'');
  if(!liveReady()||!actor||!orderId||rt.orderId!==orderId||
     order?.status!=='SETTLED')
    throw new Error('Atualize o pedido concluído antes de avaliar a entrega.');
  if(order.feedback)throw new Error('Esta entrega já possui uma avaliação registrada.');
  if(rt.actionPending||rt.customerFeedbackToken?.actor===actor&&
     rt.customerFeedbackToken?.orderId===orderId)return false;
  const value=Number(rating);
  if(![1,5].includes(value))throw new Error('Avaliação inválida');
  const token={actor,orderId};
  const same=()=>liveReady()&&rt.customerFeedbackToken===token&&
    String(rt.session?.user?.id||'')===actor&&
    rt.orderId===orderId&&rt.order?.orderId===orderId;
  rt.customerFeedbackToken=token;
  render();
  try{
    let ambiguous=false;
    let response=null;
    try{
      // The feedback endpoint upserts one row per order, but has no
      // idempotency-key replay contract. NEVER resend on lost HTTP ACK.
      response=await liveInvoke('customer-care',{
        action:'feedback',orderId,rating:value,
        tags:Array.isArray(tags)?tags:[]
      });
    }catch(error){
      if(!same())return false;
      if(!isAmbiguousTransportError(error))throw error;
      ambiguous=true;
    }
    if(!same())return false;
    if(!ambiguous&&(
      response?.ok!==true||response.feedback?.orderId!==orderId||
      response.feedback?.rating!==value))
      throw new Error('O servidor não confirmou a avaliação deste pedido.');
    const readStartedAt=Date.now();
    let fresh=null;
    try{fresh=await liveGetOrder(orderId,{silent:true})}catch(_){}
    if(!same())return false;
    const checked=Date.parse(String(rt.orderCheckedAt||''));
    const applied=fresh?.orderId===orderId&&rt.order===fresh&&
      rt.orderCheckedId===orderId&&Number.isFinite(checked)&&
      checked>=readStartedAt&&checked<=Date.now()+2000;
    if(!applied||fresh.feedback?.rating!==value)
      throw new Error(ambiguous
        ?'A conexão foi interrompida. Atualize o pedido para conferir se a avaliação foi registrada antes de tentar novamente.'
        :'O servidor recebeu a avaliação, mas ela ainda não foi confirmada no acompanhamento. Atualize o pedido antes de tentar novamente.');
    rt.error=null;
    return true;
  }finally{
    if(rt.customerFeedbackToken===token){
      rt.customerFeedbackToken=null;
      if(same()||rt.session?.user?.id===actor&&rt.orderId===orderId)render();
    }
  }
}

})();
