// V1.893 — distinguish a signed historical Mercado Pago Order webhook from
// the separate payment-webhook and Checkout Pro claims of independent Ads.
// This function is pure, read-only and never authorizes collection.
/** @param {{historicalOrderRows?:Array<any>,approvedEventCount?:number,reversalEventCount?:number,nowMs?:number}} [options] */
export function summarizeIndependentAdsPspEvidence({
  historicalOrderRows=[],approvedEventCount=0,reversalEventCount=0,nowMs=Date.now()
}={}){
  if(!Array.isArray(historicalOrderRows)||!Number.isFinite(nowMs)||
     !Number.isSafeInteger(approvedEventCount)||approvedEventCount<0||
     !Number.isSafeInteger(reversalEventCount)||reversalEventCount<0)
    throw new TypeError('ADS_PSP_HISTORY_INVALID');
  let signedOrderVerifiedAt=null;
  for(const row of historicalOrderRows.slice(0,20)){
    const meta=row?.metadata;
    const time=Date.parse(String(row?.verified_at||''));
    if(row?.provider==='mercadopago'&&row?.status==='verified'&&
       /^[0-9a-f]{64}$/i.test(String(row?.evidence_sha256||''))&&
       String(row?.provider_request_id||'').length>=12&&
       meta?.topic==='order'&&meta?.action==='order.processed'&&
       meta?.signatureVerified===true&&meta?.liveMode===true&&
       Number.isFinite(time)&&time>0&&time<=nowMs+300000){
      if(signedOrderVerifiedAt===null||
        time>Date.parse(signedOrderVerifiedAt))
        signedOrderVerifiedAt=new Date(time).toISOString();
    }
  }
  return {
    historicalSignedOrderWebhookVerified:signedOrderVerifiedAt!==null,
    historicalSignedOrderWebhookVerifiedAt:signedOrderVerifiedAt,
    historicalProofScope:'order.processed',
    historicalProofEqualsAdsPaymentWebhook:false,
    historicalProofEqualsAdsSeller:false,
    adsApprovedPaymentEventCount:approvedEventCount,
    adsReversalEventCount:reversalEventCount,
    // Neither an Orders signature nor a payment-event count demonstrates
    // payment-webhook delivery, seller equivalence, or bank settlement.
    adsPaymentWebhookVerified:false,
    adsLiveCheckoutHomologated:false,
    settlementIndependentlyVerified:false,
    previousProofReusedWithoutPayment:true
  };
}
