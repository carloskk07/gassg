/* Customer decision completion: exact order, versioned ACK and fresh readback.
   Loaded only when the buyer explicitly cancels or accepts a revised quote. */
(()=>{
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const transitions=Object.freeze({
  'cancel-before-accept':{from:['OFFERED_TO_MERCHANT','REQUOTE_REQUIRED'],to:'CANCELLED'},
  'cancel-before-dispatch':{from:['PREPARING','AT_RISK'],to:'CANCELLED'},
  'accept-requote':{from:['REQUOTE_REQUIRED'],to:'OFFERED_TO_MERCHANT'}
 });
 globalThis.customerActionSubmit=async function(action,expectedOrderId,{
   liveRuntime:rt,liveReady,liveIdempotency,retryAmbiguousOnce,liveInvoke,liveGetOrder,toast,render
 }){
   const expected=String(expectedOrderId||'');
   const selected=rt.order;
   const transition=Object.hasOwn(transitions,action)?transitions[action]:null;
   if(!liveReady()||rt.actionPending||!transition)return false;
   // The DOM button may belong to an old order after another tab or the
   // authenticated customer has switched the active order.
   if(!UUID.test(expected)||selected?.orderId!==expected||rt.orderId!==expected||
      !transition.from.includes(String(selected.status||''))||
      !Number.isSafeInteger(selected.version)||selected.version<1){
     rt.error='O pedido ou a etapa mudou. Atualize o acompanhamento antes de decidir.';
     toast(rt.error);
     render();
     return false;
   }
   const userId=rt.session?.user?.id;
   if(!userId){
     rt.error='Confirme sua sessão antes de alterar este pedido.';
     toast(rt.error);render();return false;
   }
   const version=selected.version;
   const same=()=>liveReady()&&rt.session?.user?.id===userId&&
     rt.orderId===expected&&rt.order?.orderId===expected;
   rt.actionPending=true;
   rt.error=null;
   render();
   let accepted=null;
   try{
     const reply=await retryAmbiguousOnce(()=>liveInvoke('customer-action',{
       orderId:expected,action,expectedVersion:version
     },{idempotencyKey:liveIdempotency('customer-action')}));
     if(!same())return false;
     // Real customer_order_action RPC returns exactly {orderId,status,version}.
     // HTTP 200 alone or a response for a different order is not success.
     if(!reply||reply.orderId!==expected||reply.status!==transition.to||
        !Number.isSafeInteger(reply.version)||reply.version!==version+1||
        reply.ok===false||reply.success===false||reply.error)
       throw new Error('O servidor não confirmou a alteração deste pedido. Atualize antes de repetir.');
     accepted=reply;
     let refreshed=null;
     try{refreshed=await liveGetOrder(expected,{silent:true})}catch(_){}
     if(!same())return false;
     if(!refreshed||refreshed.orderId!==expected||
        !Number.isSafeInteger(refreshed.version)||refreshed.version<reply.version||
        (refreshed.version===reply.version&&refreshed.status!==reply.status)){
       rt.error='O servidor registrou a decisão, mas o acompanhamento ainda não foi confirmado. Não repita a ação; atualize o pedido.';
       toast(rt.error);
       return false;
     }
     rt.error=null;
     toast(action==='accept-requote'?'Nova condição aceita e confirmada':'Cancelamento confirmado no pedido');
     return true;
   }catch(error){
     if(!same())return false;
     // A lost response is ambiguous; refresh instead of issuing a new
     // decision for some other version or order.
     rt.error=accepted
       ?'A decisão foi registrada, mas o acompanhamento ainda não foi confirmado.'
       :String(error?.message||error);
     toast(rt.error);
     try{await liveGetOrder(expected,{silent:true})}catch(_){}
     return false;
   }finally{
     rt.actionPending=false;
     render();
   }
 };
})();