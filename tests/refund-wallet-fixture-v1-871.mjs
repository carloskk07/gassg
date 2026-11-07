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
  return {...state,
    walletEntries:allWallet,
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
