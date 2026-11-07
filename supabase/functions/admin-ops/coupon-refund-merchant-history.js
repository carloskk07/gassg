// TAMÃO #868 — immutable coupon use / partner consent exposure report.
// Historical face values are NOT a payable ledger, bank proof or settlement.
export function couponRefundMerchantHistorySummary({
  invoiceId,customerId,fundingMode,applications,applicationCount,
  partnerUses,partnerUseCount,returns,returnCount,orders
}){
  const reject=(reason)=>{throw new Error("COUPON_REFUND_HISTORY_"+reason);};
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if(!uuid.test(String(invoiceId??""))||!uuid.test(String(customerId??"")))
    reject("INVALID_CASE");
  if(!["platform_reimbursed","partner_funded"].includes(fundingMode))
    reject("UNKNOWN_FUNDING");
  for(const [list,count] of [[applications,applicationCount],
    [partnerUses,partnerUseCount],[returns,returnCount]]){
    if(!Array.isArray(list)||!Number.isSafeInteger(count)||count<0||
       count>25||list.length!==count)reject("INCOMPLETE");
  }
  if(!Array.isArray(orders)||orders.length!==applicationCount)
    reject("ORDER_COUNT_MISMATCH");
  const orderById=new Map();
  for(const o of orders){
    if(!o||!uuid.test(String(o.id??""))||
       o.customer_id!==customerId||
       typeof o.status!=="string"||o.status.length<2||o.status.length>64||
       (o.financial_state!==null&&
        (typeof o.financial_state!=="string"||o.financial_state.length>64))||
       orderById.has(o.id))reject("ORDER_MISMATCH");
    orderById.set(o.id,o);
  }
  const entries=[],byOrder=new Map();
  let discountTotalCents=0;
  for(const a of applications){
    if(!a||a.invoice_id!==invoiceId||a.customer_user_id!==customerId||
       !uuid.test(String(a.order_id??""))||
       !uuid.test(String(a.voucher_id??""))||
       !uuid.test(String(a.quoted_merchant_id??""))||
       !Number.isSafeInteger(a.face_cents)||a.face_cents<=0||
       !Number.isSafeInteger(a.original_order_total_cents)||a.original_order_total_cents<0||
       !Number.isSafeInteger(a.original_order_cashback_cents)||
       a.original_order_cashback_cents<a.face_cents||
       byOrder.has(a.order_id)||!orderById.has(a.order_id))
      reject("APPLICATION_MISMATCH");
    const order=orderById.get(a.order_id);
    // A completed order should belong to the quoted merchant. A canceled
    // order can have released its merchant and still count in use history.
    if(order.merchant_id!=null&&order.merchant_id!==a.quoted_merchant_id)
      reject("MERCHANT_MISMATCH");
    discountTotalCents+=a.face_cents;
    if(!Number.isSafeInteger(discountTotalCents))reject("AMOUNT_OVERFLOW");
    const record={orderId:a.order_id,voucherId:a.voucher_id,
      merchantId:a.quoted_merchant_id,discountCents:a.face_cents,
      originalOrderCents:a.original_order_total_cents,
      orderStatus:order.status,financialState:order.financial_state,
      partnerUseRecorded:false,returnRecorded:false,returnDisposition:null,
      contractFeeBps:null};
    byOrder.set(a.order_id,record);entries.push(record);
  }
  if(partnerUses.length>0&&fundingMode!=="partner_funded")
    reject("UNEXPECTED_PARTNER_USE");
  if(fundingMode==="partner_funded"&&partnerUses.length!==applications.length)
    reject("MISSING_PARTNER_USE");
  const used=new Set();
  for(const p of partnerUses){
    const a=byOrder.get(p?.order_id);
    if(!a||used.has(p.order_id)||p.invoice_id!==invoiceId||
       p.customer_id!==customerId||
       p.voucher_id!==a.voucherId||
       p.merchant_id!==a.merchantId||
       p.face_cents!==a.discountCents||
       !Number.isSafeInteger(p.gross_cents)||p.gross_cents<=0||
       !Number.isSafeInteger(p.net_cents)||
       p.net_cents!==p.gross_cents-p.face_cents||
       !Number.isSafeInteger(p.fee_bps_snapshot)||
       p.fee_bps_snapshot<1||p.fee_bps_snapshot>1000)
      reject("PARTNER_USE_MISMATCH");
    a.partnerUseRecorded=true;a.contractFeeBps=p.fee_bps_snapshot;
    used.add(p.order_id);
  }
  if(returns.length>0&&fundingMode!=="partner_funded")
    reject("UNEXPECTED_PARTNER_RETURN");
  const returned=new Set();
  for(const back of returns){
    const a=byOrder.get(back?.order_id);
    if(!a||returned.has(back.order_id)||!a.partnerUseRecorded||
       back.invoice_id!==invoiceId||back.customer_id!==customerId||
       back.voucher_id!==a.voucherId||
       back.amount_cents!==a.discountCents||
       !["reissued","manual_review"].includes(back.disposition)||
       !["order_cancelled","post_settlement_financial_reversal"].includes(back.cause))
      reject("RETURN_MISMATCH");
    a.returnRecorded=true;a.returnDisposition=back.disposition;
    returned.add(back.order_id);
  }
  return {source:"clube_coupon_merchant_history_v1_868",readOnly:true,
    fundingModel:fundingMode,applicationCount:applications.length,
    partnerUseCount:partnerUses.length,returnCount:returns.length,
    historicalDiscountCents:discountTotalCents,entries,
    nominalDiscountNotPayableDebt:true,merchantPayoutVerified:false,
    bankCreditVerified:false,refundClosureAuthorized:false,
    caseClosed:false,moneyMoved:false};
}
