// Loaded only when a customer reports a problem on a specific order.
// A committed case is never sent again just because get-order was delayed.
(()=>{
  'use strict';
  let pending=null;
  let inFlight=null;
  let generation=0;
  globalThis.customerSupportReplayReset=()=>{
    generation++;
    pending=null;
    inFlight=null;
  };
  globalThis.customerSupportReplaySubmit=async function(category,message,{
    liveRuntime,liveIdempotency,retryAmbiguousOnce,liveInvoke,liveGetOrder,render
  }){
    const rt=liveRuntime;
    const order=rt.order;
    if(!order||rt.orderId!==order.orderId)
      throw new Error('Atualize o pedido selecionado antes de registrar um problema.');
    const actor=String(rt.session?.user?.id||'');
    if(!actor)throw new Error('Sessão do cliente indisponível. Atualize o pedido.');
    const payload={
      action:'open-case',orderId:order.orderId,
      category:String(category||'other'),message:String(message||'').trim()
    };
    const fingerprint=JSON.stringify(payload);
    const authGeneration=Number(rt.authGeneration||0);
    const scope=generation;
    const sameContext=()=>generation===scope&&
      Number(rt.authGeneration||0)===authGeneration&&
      String(rt.session?.user?.id||'')===actor&&
      String(rt.order?.orderId||'')===payload.orderId&&
      String(rt.orderId||'')===payload.orderId;
    if(inFlight&&inFlight.scope===scope&&
       inFlight.actor===actor&&inFlight.orderId===payload.orderId&&
       inFlight.authGeneration===authGeneration)
      throw new Error('Um atendimento deste pedido já está em andamento. Aguarde a consulta.');
    const previous=pending;
    // After a verified server ACK the browser may redraw and clear the
    // textarea. Recover that SAME case by order/category, without another POST.
    // Before ACK, replay requires the exact original payload and key.
    const reusable=previous?.actor===actor&&
      previous?.scope===scope&&previous?.authGeneration===authGeneration&&
      (previous?.caseId
        ?previous.orderId===payload.orderId&&previous.category===payload.category
        :previous?.fingerprint===fingerprint);
    const entry=reusable?previous:{
      actor,orderId:payload.orderId,category:payload.category,
      fingerprint,scope,authGeneration,
      key:liveIdempotency('customer-care'),caseId:null,result:null
    };
    pending=entry;
    const operation={actor,orderId:payload.orderId,scope,authGeneration};
    inFlight=operation;
    try{
      let result=entry.result;
      if(!entry.caseId){
        try{
          result=await retryAmbiguousOnce(()=>liveInvoke('customer-care',payload,{
            idempotencyKey:entry.key
          }));
        }catch(error){
          if(!sameContext()||pending!==entry)return null;
          // Definitive 4xx rejection: do not reuse the rejected key.
          // Timeout, rate limit and 5xx may happen after the server committed.
          const status=Number(error?.status);
          if(Number.isInteger(status)&&status>=400&&
             ![408,429,500,502,503,504].includes(status))pending=null;
          throw error;
        }
        if(!sameContext()||pending!==entry)return null;
        // The canonical Edge Function always returns the original order and
        // category for both a new case and an idempotency replay.
        if(result?.ok!==true||!result.case?.id||
           result.case.order_id!==payload.orderId||
           result.case.category!==payload.category)
          throw new Error('O servidor não confirmou o protocolo deste pedido. Consulte novamente antes de repetir.');
        entry.caseId=result.case.id;
        entry.result=result;
      }
      if(!sameContext()||pending!==entry)return null;
      let refreshPending=false;
      try{
        const readStartedAt=Date.now();
        const verified=await liveGetOrder(payload.orderId,{silent:true});
        if(!sameContext()||pending!==entry)return null;
        // Only a freshly INSTALLED authenticated order read confirms the
        // case. An older or discarded response cannot close the uncertainty.
        const checkedAt=Date.parse(String(rt.orderCheckedAt||''));
        const applied=verified?.orderId===payload.orderId&&
          rt.order===verified&&rt.orderCheckedId===payload.orderId&&
          Number.isFinite(checkedAt)&&checkedAt>=readStartedAt&&
          checkedAt<=Date.now()+2000;
        if(!applied||!Array.isArray(verified.supportCases)||
           !verified.supportCases.some(item=>item?.id===entry.caseId&&
             item?.category===payload.category)){
          refreshPending=true;
          rt.error='O relato foi registrado, mas ainda não aparece na consulta do pedido. Atualize o acompanhamento.';
        }
      }catch(error){
        if(!sameContext()||pending!==entry)return null;
        refreshPending=true;
        rt.error='Não foi possível atualizar os atendimentos. Consulte novamente.';
      }
      if(!refreshPending){
        // Only verified readback retires the request. Subsequent attempts
        // during an uncertain read use the same case ID without another POST.
        if(pending===entry)pending=null;
        rt.error=null;
      }
      if(!sameContext())return null;
      render();
      return {...result,refreshPending};
    }finally{
      // A late operation cannot release a newer order/account's lock.
      if(inFlight===operation)inFlight=null;
    }
  };
})();