// Loaded only when a customer reports a problem on a specific order.
// The server, never this browser, decides whether the case exists.
(()=>{
  'use strict';
  let pending=null;
  globalThis.customerSupportReplayReset=()=>{pending=null;};
  globalThis.customerSupportReplaySubmit=async function(category,message,{
    liveRuntime,liveIdempotency,retryAmbiguousOnce,liveInvoke,liveGetOrder,render
  }){
    const order=liveRuntime.order;
    if(!order)throw new Error('Pedido não encontrado');
    const actor=String(liveRuntime.session?.user?.id||'');
    if(!actor)throw new Error('Sessão do cliente indisponível. Atualize o pedido.');
    const payload={
      action:'open-case',orderId:order.orderId,
      category:String(category||'other'),message:String(message||'').trim()
    };
    const fingerprint=JSON.stringify(payload);
    const previous=pending;
    const key=previous?.actor===actor&&previous.fingerprint===fingerprint
      ?previous.key:liveIdempotency('customer-care');
    pending={actor,fingerprint,key};
    let result;
    try{
      result=await retryAmbiguousOnce(()=>liveInvoke('customer-care',payload,{idempotencyKey:key}));
      if(result?.ok!==true||!result?.case?.id)
        throw new Error('Não foi possível confirmar o protocolo de atendimento. Consulte novamente.');
    }catch(error){
      // Network and 5xx can occur AFTER the server commits. Preserve this
      // exact request key across separate button clicks in the same session.
      const status=Number(error?.status);
      if(Number.isInteger(status)&&status>=400&&
        ![408,429,500,502,503,504].includes(status)&&pending?.key===key)
        pending=null;
      throw error;
    }
    if(pending?.key===key)pending=null;
    const sameContext=()=>String(liveRuntime.session?.user?.id||'')===actor&&
      String(liveRuntime.order?.orderId||'')===payload.orderId;
    if(!sameContext())throw new Error('A conta ou o pedido mudou. Consulte o acompanhamento atual.');
    let refreshPending=false;
    try{
      const verified=await liveGetOrder(payload.orderId,{silent:true});
      if(!sameContext())throw new Error('A conta ou o pedido mudou. Consulte o acompanhamento atual.');
      if(verified?.orderId!==payload.orderId||
         !Array.isArray(verified.supportCases)||
         !verified.supportCases.some(item=>item?.id===result.case.id)){
        refreshPending=true;
        liveRuntime.error='O relato foi registrado, mas ainda não aparece na consulta do pedido. Atualize o acompanhamento.';
      }
    }catch(error){
      if(!sameContext())throw new Error('A conta ou o pedido mudou. Consulte o acompanhamento atual.');
      refreshPending=true;
      liveRuntime.error='Não foi possível atualizar os atendimentos. Consulte novamente.';
    }
    render();
    return {...result,refreshPending};
  };
})();
