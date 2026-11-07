// TAMÃO #868 — immutable coupon use / partner consent exposure report.
// Historical face values are NOT a payable ledger, bank proof or settlement.
export function couponRefundMerchantHistorySummary({
  invoiceId,customerId,fundingMode,applications,applicationCount,
  partnerUses,partnerUseCount,returns,returnCount,orders,
  issuances,issuanceCount,couponFaceCents,couponsPerPack,
  walletEntries,walletEntryCount,releaseEntries,releaseEntryCount,
  reserveEntries,reserveEntryCount,seedEntries,seedEntryCount,
  canonicalSeedEntries,canonicalSeedEntryCount
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
  // The same issued voucher can be reissued after a cancellation;
  // count its denomination ONCE, but preserve every historic application.
  if(!Number.isSafeInteger(couponFaceCents)||couponFaceCents<=0||
     !Number.isSafeInteger(couponsPerPack)||couponsPerPack<1||
     couponsPerPack>15||!Number.isSafeInteger(issuanceCount)||
     issuanceCount<0||issuanceCount>couponsPerPack||
     !Array.isArray(issuances)||issuances.length!==issuanceCount)
    reject("ISSUANCE_COVERAGE");
  const issuanceById=new Map(),ordinals=new Set();
  for(const issued of issuances){
    if(!issued||!uuid.test(String(issued.id??""))||
       issued.invoice_id!==invoiceId||issued.customer_user_id!==customerId||
       issued.face_cents!==couponFaceCents||
       !Number.isSafeInteger(issued.ordinal)||issued.ordinal<1||
       issued.ordinal>couponsPerPack||
       issuanceById.has(issued.id)||ordinals.has(issued.ordinal))
      reject("ISSUANCE_MISMATCH");
    issuanceById.set(issued.id,issued);ordinals.add(issued.ordinal);
  }
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
  const entries=[],byOrder=new Map(),lineageByVoucher=new Map();
  // Every reuse must follow a return that explicitly reissued this voucher.
  const occurredAt=value=>{
    if(typeof value!=="string"||
       !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value))return null;
    const time=Date.parse(value);
    return Number.isFinite(time)?time:null;
  };
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
       byOrder.has(a.order_id)||!orderById.has(a.order_id)||
       occurredAt(a.applied_at)===null||
       a.face_cents!==couponFaceCents||
       !issuanceById.has(a.voucher_id))
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
      walletReturnNeutralized:false,contractFeeBps:null};
    byOrder.set(a.order_id,record);entries.push(record);
    const chain=lineageByVoucher.get(a.voucher_id)||[];
    chain.push({orderId:a.order_id,appliedAt:occurredAt(a.applied_at),
      seedId:a.seed_wallet_entry_id_v1_847??null,
      partnerUsedAt:null,returnedAt:null,returnDisposition:null});
    lineageByVoucher.set(a.voucher_id,chain);
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
       p.net_cents!==a.originalOrderCents||
       p.gross_cents!==a.originalOrderCents+a.discountCents||
       occurredAt(p.created_at)===null||
       !Number.isSafeInteger(p.fee_bps_snapshot)||
       p.fee_bps_snapshot<1||p.fee_bps_snapshot>1000)
      reject("PARTNER_USE_MISMATCH");
    const chain=lineageByVoucher.get(p.voucher_id);
    const step=chain?.find(x=>x.orderId===p.order_id);
    if(!step||occurredAt(p.created_at)<step.appliedAt)
      reject("PARTNER_USE_CHRONOLOGY");
    step.partnerUsedAt=occurredAt(p.created_at);
    a.partnerUseRecorded=true;a.contractFeeBps=p.fee_bps_snapshot;
    used.add(p.order_id);
  }
  if(returns.length>0&&fundingMode!=="partner_funded")
    reject("UNEXPECTED_PARTNER_RETURN");
  // #871 Every recorded return must match two durable, oppositely signed
  // wallet facts, both linked to this buyer, order and original voucher.
  // The compensating hold prevents a returned paid coupon from becoming
  // fungible cashback. Neither fact proves external bank settlement.
  if(!Number.isSafeInteger(walletEntryCount)||walletEntryCount<0||
     walletEntryCount!==returnCount*2||
     !Array.isArray(walletEntries)||walletEntries.length!==walletEntryCount)
    reject("WALLET_COVERAGE");
  // #873 A referenced refund receipt is not enough: any ADDITIONAL
  // cashback release on the same returned order would remain fungible.
  // Require the complete bounded population of cashback releases, including
  // releases not referenced by a coupon-return row, before certifying holds.
  if(!Number.isSafeInteger(releaseEntryCount)||releaseEntryCount<0||
     releaseEntryCount!==returnCount||
     !Array.isArray(releaseEntries)||releaseEntries.length!==releaseEntryCount)
    reject("RELEASE_POPULATION_INCOMPLETE");
  const releaseByOrder=new Map();
  const returnOrders=new Set(returns.map(back=>back?.order_id));
  for(const released of releaseEntries){
    if(!released||!uuid.test(String(released.id??""))||
       !returnOrders.has(released.order_id)||
       releaseByOrder.has(released.order_id)||
       released.bucket!=="cashback"||
       released.entry_type!=="cashback_release")
      reject("UNMATCHED_CASHBACK_RELEASE");
    releaseByOrder.set(released.order_id,released);
  }
  // #875 The referenced hold may match while another return-quarantine
  // reserve on the same coupon order silently debits the buyer. Scan ALL
  // cashback reserves for these orders, including ordinary order reserves,
  // but require only voucher-return quarantine reserves to match the returns.
  if(!Number.isSafeInteger(reserveEntryCount)||reserveEntryCount<0||
     reserveEntryCount>100||!Array.isArray(reserveEntries)||
     reserveEntries.length!==reserveEntryCount)
    reject("RESERVE_POPULATION_INCOMPLETE");
  const expectedHoldIds=new Set(returns.map(back=>
    String(back?.wallet_hold_entry_id??"")));
  if(expectedHoldIds.size!==returnCount||
     [...expectedHoldIds].some(id=>!uuid.test(id)))
    reject("QUARANTINE_HOLD_REFS_INVALID");
  const reserveIds=new Set(),quarantineById=new Map();
  for(const item of reserveEntries){
    if(!item||!uuid.test(String(item.id??""))||
       reserveIds.has(item.id)||!byOrder.has(item.order_id)||
       item.bucket!=="cashback"||item.entry_type!=="cashback_reserve")
      reject("RESERVE_POPULATION_INVALID");
    reserveIds.add(item.id);
    // Include both canonical key and immutable source markers to detect a
    // mismatched or renamed debit; IDs mentioned by returns are mandatory.
    const quarantine=expectedHoldIds.has(item.id)||
      String(item.idempotency_key??"").startsWith("partner-coupon:return-hold:")||
      item.metadata?.source==="partner_coupon_cancel_quarantine";
    if(!quarantine)continue;
    if(!expectedHoldIds.has(item.id))reject("UNMATCHED_QUARANTINE_HOLD");
    quarantineById.set(item.id,item);
  }
  if(quarantineById.size!==returnCount)
    reject("QUARANTINE_HOLD_MISSING");
  const walletById=new Map();
  for(const item of walletEntries){
    if(!item||!uuid.test(String(item.id??""))||walletById.has(item.id))
      reject("WALLET_ID_MISMATCH");
    walletById.set(item.id,item);
  }
  const returned=new Set();
  for(const back of returns){
    const a=byOrder.get(back?.order_id);
    if(!a||returned.has(back.order_id)||!a.partnerUseRecorded||
       back.invoice_id!==invoiceId||back.customer_id!==customerId||
       back.voucher_id!==a.voucherId||
       back.amount_cents!==a.discountCents||
       !["reissued","manual_review"].includes(back.disposition)||
       !["order_cancelled","post_settlement_financial_reversal"].includes(back.cause)||
       occurredAt(back.recorded_at)===null)
      reject("RETURN_MISMATCH");
    const chain=lineageByVoucher.get(back.voucher_id);
    const step=chain?.find(x=>x.orderId===back.order_id);
    const order=orderById.get(back.order_id);
    const release=walletById.get(back.wallet_release_entry_id);
    const hold=walletById.get(back.wallet_hold_entry_id);
    const populationRelease=releaseByOrder.get(back.order_id);
    const populationHold=quarantineById.get(back.wallet_hold_entry_id);
    if(!uuid.test(String(back.wallet_release_entry_id??""))||
       !uuid.test(String(back.wallet_hold_entry_id??""))||
       back.wallet_release_entry_id===back.wallet_hold_entry_id||
       !release||!hold||!populationRelease||!populationHold||
       populationHold.id!==hold.id||
       populationHold.user_id!==hold.user_id||
       populationHold.order_id!==hold.order_id||
       populationHold.amount_cents!==hold.amount_cents||
       populationHold.idempotency_key!==hold.idempotency_key||
       populationHold.created_at!==hold.created_at||
       JSON.stringify(populationHold.metadata)!==JSON.stringify(hold.metadata)||
       populationRelease.id!==release.id||
       populationRelease.user_id!==release.user_id||
       populationRelease.amount_cents!==release.amount_cents||
       populationRelease.idempotency_key!==release.idempotency_key||
       populationRelease.created_at!==release.created_at||
       JSON.stringify(populationRelease.metadata)!==JSON.stringify(release.metadata)||
       release.user_id!==customerId||hold.user_id!==customerId||
       release.order_id!==back.order_id||hold.order_id!==back.order_id||
       release.bucket!=="cashback"||hold.bucket!=="cashback"||
       release.entry_type!=="cashback_release"||
       hold.entry_type!=="cashback_reserve"||
       release.amount_cents!==back.amount_cents||
       hold.amount_cents!==-back.amount_cents||
       hold.idempotency_key!=="partner-coupon:return-hold:"+back.order_id||
       hold.metadata?.source!=="partner_coupon_cancel_quarantine"||
       hold.metadata?.voucherId!==back.voucher_id||
       hold.metadata?.releaseWalletEntryId!==release.id||
       hold.metadata?.cause!==back.cause||
       (back.cause==="order_cancelled"&&
        (typeof order.risk_reason!=="string"||!order.risk_reason||
         release.metadata?.reason!==order.risk_reason||
         !String(release.idempotency_key??"").endsWith(":cashback-release")))||
       (back.cause==="post_settlement_financial_reversal"&&
        release.metadata?.reason!=="post_settlement_financial_reversal")||
       occurredAt(release.created_at)===null||
       occurredAt(hold.created_at)===null||
       occurredAt(release.created_at)>occurredAt(hold.created_at)||
       occurredAt(hold.created_at)>occurredAt(back.recorded_at))
      reject("WALLET_RETURN_PAIR_MISMATCH");
    // #874 A release predating merchant coupon use is not a credible
    // cancellation reversal, even if its hold and return IDs match.
    // Equal timestamps are accepted for durable events in one clock tick.
    if(!step||step.partnerUsedAt===null||
       occurredAt(release.created_at)<step.partnerUsedAt||
       occurredAt(hold.created_at)<step.partnerUsedAt||
       occurredAt(back.recorded_at)<step.partnerUsedAt||
       (back.cause==="order_cancelled"&&order.status!=="CANCELLED")||
       (back.cause==="post_settlement_financial_reversal"&&
        occurredAt(order.financial_reversed_at)===null))
      reject("RETURN_CHRONOLOGY_OR_ORDER_STATE");
    step.returnedAt=occurredAt(back.recorded_at);
    step.returnDisposition=back.disposition;
    a.returnRecorded=true;a.returnDisposition=back.disposition;
    a.walletReturnNeutralized=true;
    returned.add(back.order_id);
  }
  if(returned.size!==returnCount||returnCount*2!==walletById.size||
     releaseByOrder.size!==returned.size)
    reject("WALLET_RETURN_UNUSED_OR_MISSING");
  // A canceled or financially reversed partner-funded order MUST have its
  // paid-voucher return recorded. Without it, the buyer could have been
  // credited without the compensating hold, despite this report claiming
  // complete neutralization for the invoice.
  if(fundingMode==="partner_funded"&&entries.some(record=>{
    const original=orderById.get(record.orderId);
    return (original.status==="CANCELLED"||
            original.financial_reversed_at!=null)&&!record.returnRecorded;
  }))reject("REVERSED_ORDER_RETURN_MISSING");
  // #876 A partner-funded voucher checkout creates a UNIQUE cashback_seed
  // (order_id NULL) and stores its ID on the immutable application.
  // The previous history verified returns but never verified those original
  // funding entries or their reissue sequence.
  if(!Number.isSafeInteger(seedEntryCount)||seedEntryCount<0||
     seedEntryCount>25||!Array.isArray(seedEntries)||
     seedEntries.length!==seedEntryCount||
     (fundingMode==="partner_funded"&&seedEntryCount!==applicationCount)||
     (fundingMode==="platform_reimbursed"&&seedEntryCount!==0))
    reject("SEED_COVERAGE_INCOMPLETE");
  // #877 An index-backed lookup of canonical coupon seed keys across ALL
  // wallets is required in addition to the invoice-tagged buyer scan.
  // Otherwise a seed for an unused voucher or a foreign buyer is invisible.
  if(!Number.isSafeInteger(canonicalSeedEntryCount)||
     canonicalSeedEntryCount<0||canonicalSeedEntryCount>25||
     !Array.isArray(canonicalSeedEntries)||
     canonicalSeedEntries.length!==canonicalSeedEntryCount||
     canonicalSeedEntryCount!==seedEntryCount)
    reject("CANONICAL_SEED_POPULATION_INCOMPLETE");
  const canonicalById=new Map();
  for(const record of canonicalSeedEntries){
    if(!record||!uuid.test(String(record.id??""))||
       canonicalById.has(record.id)||
       record.bucket!=="cashback"||record.entry_type!=="cashback_seed")
      reject("CANONICAL_SEED_POPULATION_INVALID");
    canonicalById.set(record.id,record);
  }
  const seedById=new Map(),verifiedSeeds=new Set();
  for(const seed of seedEntries){
    if(!seed||!uuid.test(String(seed.id??""))||
       seedById.has(seed.id)||seed.bucket!=="cashback"||
       seed.entry_type!=="cashback_seed")
      reject("SEED_POPULATION_INVALID");
    const canonical=canonicalById.get(seed.id);
    if(!canonical||
       canonical.user_id!==seed.user_id||
       canonical.order_id!==seed.order_id||
       canonical.amount_cents!==seed.amount_cents||
       canonical.bucket!==seed.bucket||
       canonical.entry_type!==seed.entry_type||
       canonical.idempotency_key!==seed.idempotency_key||
       canonical.created_at!==seed.created_at||
       JSON.stringify(canonical.metadata)!==JSON.stringify(seed.metadata))
      reject("CANONICAL_SEED_MISMATCH");
    seedById.set(seed.id,seed);
  }
  if(seedById.size!==canonicalById.size)
    reject("UNMATCHED_CANONICAL_SEED");
  for(const [voucherId,chain] of lineageByVoucher){
    chain.sort((left,right)=>left.appliedAt-right.appliedAt||
      left.orderId.localeCompare(right.orderId));
    if(fundingMode==="platform_reimbursed"&&chain.length>1)
      reject("LEGACY_VOUCHER_REUSE");
    for(let i=0;i<chain.length;i++){
      const event=chain[i];
      if(fundingMode==="platform_reimbursed"){
        if(event.seedId!==null)reject("LEGACY_UNEXPECTED_SEED");
        continue;
      }
      const seed=seedById.get(event.seedId);
      const expectedKey="clube-paid-coupon:"+voucherId+
        (i>0?":return:"+i:"");
      if(!seed||verifiedSeeds.has(seed.id)||
         seed.idempotency_key!==expectedKey||
         seed.user_id!==customerId||seed.order_id!==null||
         seed.amount_cents!==couponFaceCents||
         seed.metadata?.source!=="mercadopago_paid_coupon"||
         seed.metadata?.voucherId!==voucherId||
         seed.metadata?.invoiceId!==invoiceId||
         occurredAt(seed.created_at)===null||
         occurredAt(seed.created_at)>event.appliedAt||
         (i>0&&(chain[i-1].returnedAt===null||
                occurredAt(seed.created_at)<chain[i-1].returnedAt)))
        reject("SEED_PROVENANCE_MISMATCH");
      verifiedSeeds.add(seed.id);
    }
    for(let i=1;i<chain.length;i++){
      const prior=chain[i-1],next=chain[i];
      if(prior.returnDisposition!=="reissued"||
         prior.returnedAt===null||prior.returnedAt>next.appliedAt)
        reject("VOUCHER_REISSUE_LINEAGE");
    }
    if(chain.some((event,i)=>i<chain.length-1&&
       event.returnDisposition==="manual_review"))
      reject("REVIEWED_VOUCHER_REUSED");
  }
  if(verifiedSeeds.size!==seedEntryCount)
    reject("UNMATCHED_COUPON_SEED");
  const uniqueVoucherCount=lineageByVoucher.size;
  const uniqueVoucherFaceCents=uniqueVoucherCount*couponFaceCents;
  const historicalReusedDiscountCents=discountTotalCents-uniqueVoucherFaceCents;
  if(uniqueVoucherCount>issuanceCount||
     !Number.isSafeInteger(uniqueVoucherFaceCents)||
     historicalReusedDiscountCents<0||
     !Number.isSafeInteger(historicalReusedDiscountCents))
    reject("DENOMINATION_MISMATCH");
  return {source:"clube_coupon_merchant_history_v1_868",readOnly:true,
    fundingModel:fundingMode,applicationCount:applications.length,
    partnerUseCount:partnerUses.length,returnCount:returns.length,
    historicalDiscountCents:discountTotalCents,
    uniqueVoucherCount,uniqueVoucherFaceCents,
    historicalReusedDiscountCents,entries,
    walletReturnPairCount:returnCount,walletReturnNetCents:0,
    walletReturnNeutralized:true,
    cashbackReleaseCount:releaseEntryCount,
    cashbackReleaseCoverage:"bounded_complete",
    unmatchedCashbackReleaseCount:0,
    quarantineHoldCoverage:"bounded_complete",
    quarantineHoldCount:quarantineById.size,unmatchedQuarantineHoldCount:0,
    otherCashbackReserveCount:reserveEntryCount-quarantineById.size,
    couponSeedCoverage:"bounded_complete",couponSeedCount:verifiedSeeds.size,
    unmatchedCouponSeedCount:0,
    canonicalSeedCoverage:"bounded_complete",
    canonicalSeedCount:canonicalSeedEntryCount,
    unmatchedCanonicalSeedCount:0,
    nominalDiscountNotPayableDebt:true,merchantPayoutVerified:false,
    bankCreditVerified:false,refundClosureAuthorized:false,
    caseClosed:false,moneyMoved:false};
}
