// Read-only matching of a Mercado Pago Payouts transaction to the SAME
// coupon-backed TAMÃO order's merchant-reimbursement obligation.
//
// MP /v1/payouts/{payout_id}/transactions/{transaction_id} documents status,
// status_detail, amount and external_reference; the published GET response
// does NOT guarantee verified recipient identity. Therefore this inspection
// may validate PROVIDER STATUS but MUST NEVER close the merchant liability.
// No database writes, no production money movement, no submitted proof accepted.
const fail=(reason,extra={})=>({
 source:"coupon_merchant_payout_inspection_v1",
 readOnly:true,moneyMoved:false,
 providerTransactionAccredited:false,
 merchantBeneficiaryVerified:false,
 merchantExternalSettlementVerified:false,
 eligibleForFinancialWrite:false,
 reason,...extra
});

function cents(value){
 // Reject exponent, comma, negative or fractional-cent provider amounts.
 const raw=typeof value==="number"?String(value):value;
 if(typeof raw!=="string"||!/^(?:0|[1-9][0-9]{0,9})(?:\.[0-9]{1,2})?$/.test(raw))return null;
 const [whole,fraction=""]=raw.split(".");
 const amount=Number(whole)*100+Number(fraction.padEnd(2,"0"));
 return Number.isSafeInteger(amount)&&amount>0?amount:null;
}
export function couponMerchantPayoutEvidence({
 payoutId,transactionId,transaction,reimbursement,application,order,invoice,voucher
}){
 const expectedId=String(transactionId??"");
 const expectedOrder=String(order?.id??"");
 const expectedReimbursement=Number(reimbursement?.cashback_cents);
 const ref=String(transaction?.external_reference??"");
 const state=String(transaction?.status??"").toLowerCase();
 const detail=String(transaction?.status_detail??"").toLowerCase();
 const receivedCents=cents(transaction?.amount?.value);
 const safe={orderId:expectedOrder||null,payoutId:String(payoutId??""),
  transactionId:expectedId,
  expectedCents:Number.isSafeInteger(expectedReimbursement)?expectedReimbursement:null,
  observedCents:receivedCents,providerStatus:state,providerStatusDetail:detail};
 // The payout status is only meaningful after the complete, immutable
 // coupon provenance matches: original customer, redeemed voucher, verified
 // net source and the EXACT merchant/order reimbursement amounts. A provider
 // transaction cannot compensate for a missing or disputed funding source.
 const face=Number(application?.face_cents);
 const net=Number(invoice?.net_proceeds_cents);
 const obligation=Number(invoice?.coupon_face_cents)*Number(invoice?.coupons_per_pack);
 const fundsValid=Number.isSafeInteger(net)&&net>0&&
   Number.isSafeInteger(obligation)&&obligation>0&&
   net>=obligation&&net<=Number(invoice?.sale_price_cents);
 if(!reimbursement||!application||!order||!invoice||!voucher
  ||String(reimbursement.order_id)!==expectedOrder
  ||String(application.order_id)!==expectedOrder
  ||String(application.invoice_id)!==String(invoice.id)
  ||String(application.voucher_id)!==String(voucher.id)
  ||String(voucher.invoice_id)!==String(invoice.id)
  ||String(voucher.redeemed_order_id)!==expectedOrder
  ||voucher.status!=="redeemed"
  ||String(application.customer_user_id)!==String(order.customer_id)
  ||String(voucher.customer_user_id)!==String(order.customer_id)
  ||String(invoice.customer_user_id)!==String(order.customer_id)
  ||String(reimbursement.merchant_id)!==String(order.merchant_id)
  ||String(application.quoted_merchant_id)!==String(order.merchant_id)
  ||Number(reimbursement.cashback_cents)!==Number(order.cashback_reserved_cents)
  ||Number(application.original_order_cashback_cents)!==Number(order.cashback_reserved_cents)
  ||Number(application.original_order_total_cents)!==Number(order.total_cents)
  ||!Number.isSafeInteger(face)||face<=0
  ||face!==Number(voucher.face_cents)||face!==Number(invoice.coupon_face_cents)
  ||face>expectedReimbursement
  ||!fundsValid||!invoice.paid_at
  ||!invoice.provider_order_id||!invoice.provider_payment_id
  ||!invoice.net_proceeds_verified_at
  ||!invoice.net_proceeds_reference
  ||String(application.net_proceeds_reference)!==String(invoice.net_proceeds_reference)
  ||order.status!=="SETTLED"||order.financial_state!=="settled"
  ||order.financial_reversed_at
  ||invoice.status!=="paid")
   return fail("COUPON_PAYOUT_ACCOUNTING_NOT_ELIGIBLE",safe);
 if(!expectedId||!expectedOrder||String(transaction?.id??"")!==expectedId
  ||!ref||ref!==expectedOrder
  ||String(transaction?.amount?.currency??"")!=="BRL"
  ||receivedCents!==expectedReimbursement||!(expectedReimbursement>0))
  return fail("COUPON_PAYOUT_PROVIDER_BINDING_MISMATCH",safe);
 if(state!=="success"||detail!=="accredited")
  return fail("COUPON_PAYOUT_NOT_ACCREDITED",safe);
 return {
  ...fail("COUPON_PAYOUT_BENEFICIARY_IDENTITY_REQUIRED",safe),
  providerTransactionAccredited:true,
  // Official GET transaction examples do NOT include recipient. A payout
  // transferred to someone else is never proof of the TAMÃO merchant payment.
  merchantBeneficiaryVerified:false,
  merchantExternalSettlementVerified:false,
  eligibleForFinancialWrite:false
 };
}

// Connection readiness is NOT proof that the credited payout went to this
// merchant. A sale/checkout provider account can differ from a Pix recipient.
// Return only booleans. Never expose merchant CNPJ, payout keys, tokens,
// provider_account_id, metadata or arbitrary PSP recipient claims.
export function couponMerchantRecipientReadiness({merchant,account}={}){
 const merchantId=String(merchant?.id??"");
 // Brazil began issuing alphanumeric CNPJs in July 2026. The database
 // already accepts 12 ASCII letters/digits followed by 2 check digits.
 // Never strip letters from an issued CNPJ or mislabel it as absent.
 // This is document-on-file readiness ONLY, not validated legal ownership
 // or independent evidence of the Pix payout beneficiary.
 const legalId=String(merchant?.cnpj??"").trim().toUpperCase();
 const rawCnpj=/^[A-Z0-9]{12}[0-9]{2}$/;
 const maskedCnpj=/^[A-Z0-9]{2}\.[A-Z0-9]{3}\.[A-Z0-9]{3}\/[A-Z0-9]{4}-[0-9]{2}$/;
 const legalDocumentOnFile=!!merchantId&&
   (rawCnpj.test(legalId)||maskedCnpj.test(legalId));
 const merchantProviderAccountPresent=!!merchantId&&
   String(account?.merchant_id??"")===merchantId&&
   account?.provider==="mercadopago";
 const merchantProviderAccountConnected=merchantProviderAccountPresent&&
   account?.status==="active"&&
   account?.verification_level==="provider"&&
   ["oauth","api_credentials"].includes(String(account?.connection_mode??""))&&
   typeof account?.provider_account_id==="string"&&
   account.provider_account_id.trim().length>=2&&
   Number.isFinite(Date.parse(String(account?.connected_at??"")))&&
   !account?.revoked_at;
 const blockingReasons=[
   ...(!legalDocumentOnFile?["COUPON_PAYOUT_MERCHANT_LEGAL_ID_MISSING"]:[]),
   ...(!merchantProviderAccountPresent?["COUPON_PAYOUT_MERCHANT_PROVIDER_ACCOUNT_MISSING"]:
       !merchantProviderAccountConnected?["COUPON_PAYOUT_MERCHANT_PROVIDER_ACCOUNT_NOT_VERIFIED"]:[]),
   "COUPON_PAYOUT_BENEFICIARY_IDENTITY_REQUIRED",
   "COUPON_PAYOUT_INDEPENDENT_BANK_CREDIT_PROOF_REQUIRED"
 ];
 return {
   // Status of EXISTING merchant onboarding, never payout identity.
   legalDocumentOnFile,merchantProviderAccountPresent,
   merchantProviderAccountConnected:Boolean(merchantProviderAccountConnected),
   // No provider-backed statement naming the Pix payee and matching the
   // order-specific transaction has been ingested in this read-only path.
   payoutRecipientVerified:false,
   independentBankCreditVerified:false,
   eligibleForFinancialWrite:false,
   blockingReasons
 };
}
