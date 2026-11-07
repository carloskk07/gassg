// Synthetic fixtures only: never generate financial evidence in production.
export function returnWalletRefs(orderId){
  if(typeof orderId!=='string'||orderId.length!==36)
    throw Error('synthetic order UUID required');
  return {
    wallet_release_entry_id:'4'+orderId.slice(1),
    wallet_hold_entry_id:'5'+orderId.slice(1)
  };
}
export function withWalletEvidence(state){
  if(!Array.isArray(state.returns))return state;
  const walletEntries=state.returns.flatMap(back=>{
    const refs=returnWalletRefs(back.order_id);
    const order=state.orders?.find(x=>x.id===back.order_id);
    return [{
      id:back.wallet_release_entry_id??refs.wallet_release_entry_id,
      order_id:back.order_id,user_id:back.customer_id,
      bucket:'cashback',entry_type:'cashback_release',
      amount_cents:back.amount_cents,idempotency_key:'synthetic:cashback-release',
      metadata:{reason:back.cause==='post_settlement_financial_reversal'
        ?'post_settlement_financial_reversal':order?.risk_reason??'buyer_cancelled'},
      created_at:'2026-11-06T10:00:02Z'
    },{
      id:back.wallet_hold_entry_id??refs.wallet_hold_entry_id,
      order_id:back.order_id,user_id:back.customer_id,
      bucket:'cashback',entry_type:'cashback_reserve',
      amount_cents:-back.amount_cents,
      idempotency_key:'partner-coupon:return-hold:'+back.order_id,
      metadata:{source:'partner_coupon_cancel_quarantine',
        voucherId:back.voucher_id,
        releaseWalletEntryId:back.wallet_release_entry_id??refs.wallet_release_entry_id,
        cause:back.cause},
      created_at:'2026-11-06T10:00:03Z'
    }];
  });
  const allWallet=state.walletEntries??walletEntries;
  // Optional synthetic extra releases model an unreferenced cashback credit;
  // they never modify or generate any production wallet row.
  const releaseEntries=state.releaseEntries??allWallet.filter(item=>
    item.bucket==='cashback'&&item.entry_type==='cashback_release');
  // Simulates a separate complete order-wide read. It deliberately includes
  // ordinary cashback reserves to avoid flagging valid checkout holds.
  const reserveEntries=Object.prototype.hasOwnProperty.call(state,'reserveEntries')
    ?state.reserveEntries:allWallet.filter(item=>
      item.bucket==='cashback'&&item.entry_type==='cashback_reserve');
  // Deterministic synthetic seeds for EVERY applied partner-funded coupon,
  // including successive redemptions of the same voucher after reissue.
  // Never write to the live wallet or mask explicit invalid references.
  // Valid synthetic invoice receipt anchors. Explicitly supplied invalid
  // metadata/fields remain untouched for negative provenance tests.
  const invoicePayment=Object.prototype.hasOwnProperty.call(state,'invoicePayment')
    ?state.invoicePayment:{
      providerOrderId:'synthetic-psp-order-123',
      providerPaymentId:'synthetic-psp-payment-456',
      netProceedsReference:'synthetic-net-receipt-789',
      paidAt:'2026-11-06T09:58:00Z',
      netProceedsVerifiedAt:'2026-11-06T09:59:00Z'
    };
  const apps=(state.applications??[]).map(a=>{
    const copy={...a};
    if(state.fundingMode==='partner_funded'&&
       !Object.prototype.hasOwnProperty.call(copy,'net_proceeds_reference'))
      copy.net_proceeds_reference=invoicePayment?.netProceedsReference;
    return copy;
  });
  const ordinalByVoucher=new Map();
  const positions=apps.map((a,i)=>({a,i})).sort((x,y)=>
    String(x.a.applied_at).localeCompare(String(y.a.applied_at))||
    String(x.a.order_id).localeCompare(String(y.a.order_id)));
  const generatedSeeds=[];
  if(state.fundingMode==='partner_funded')for(const {a} of positions){
    const ordinal=ordinalByVoucher.get(a.voucher_id)??0;
    ordinalByVoucher.set(a.voucher_id,ordinal+1);
    const seedId='6'+String(a.order_id).slice(1);
    if(!Object.prototype.hasOwnProperty.call(a,'seed_wallet_entry_id_v1_847'))
      a.seed_wallet_entry_id_v1_847=seedId;
    generatedSeeds.push({
      id:seedId,order_id:null,user_id:a.customer_user_id,
      bucket:'cashback',entry_type:'cashback_seed',amount_cents:a.face_cents,
      idempotency_key:'clube-paid-coupon:'+a.voucher_id+
        (ordinal?':return:'+ordinal:''),
      metadata:{source:'mercadopago_paid_coupon',
        voucherId:a.voucher_id,invoiceId:a.invoice_id,
        providerOrderId:invoicePayment?.providerOrderId,
        providerPaymentId:invoicePayment?.providerPaymentId,
        netProceedsReference:invoicePayment?.netProceedsReference},
      created_at:a.applied_at
    });
  }
  const seedEntries=Object.prototype.hasOwnProperty.call(state,'seedEntries')
    ?state.seedEntries:generatedSeeds;
  // Independently generated canonical-key scan; explicit seedEntries mutations
  // must not rewrite the evidence returned by this second query.
  const canonicalSeedEntries=Object.prototype.hasOwnProperty.call(state,'canonicalSeedEntries')
    ?state.canonicalSeedEntries:generatedSeeds;
  return {...state,
    invoicePayment,applications:apps,walletEntries:allWallet,
    seedEntries,seedEntryCount:Object.prototype.hasOwnProperty.call(state,'seedEntryCount')
      ?state.seedEntryCount:seedEntries?.length,
    canonicalSeedEntries,
    canonicalSeedEntryCount:Object.prototype.hasOwnProperty.call(state,'canonicalSeedEntryCount')
      ?state.canonicalSeedEntryCount:canonicalSeedEntries?.length,
    // Preserve explicit null/invalid values: regression tests must NOT
    // silently convert missing exact count evidence into a success count.
    walletEntryCount:Object.prototype.hasOwnProperty.call(state,'walletEntryCount')
      ?state.walletEntryCount:allWallet.length,
    releaseEntries,
    releaseEntryCount:Object.prototype.hasOwnProperty.call(state,'releaseEntryCount')
      ?state.releaseEntryCount:releaseEntries.length,
    reserveEntries,
    reserveEntryCount:Object.prototype.hasOwnProperty.call(state,'reserveEntryCount')
      ?state.reserveEntryCount:reserveEntries?.length};
}
