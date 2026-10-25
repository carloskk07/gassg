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
 payoutId,transactionId,transaction,reimbursement,application,order,invoice
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
 if(!reimbursement||!application||!order||!invoice
  ||String(reimbursement.order_id)!==expectedOrder
  ||String(application.order_id)!==expectedOrder
  ||String(application.invoice_id)!==String(invoice.id)
  ||String(reimbursement.merchant_id)!==String(order.merchant_id)
  ||String(application.quoted_merchant_id)!==String(order.merchant_id)
  ||Number(reimbursement.cashback_cents)!==Number(order.cashback_reserved_cents)
  ||Number(application.face_cents)>expectedReimbursement
  ||order.status!=="SETTLED"||order.financial_state!=="settled"
  ||order.financial_reversed_at
  ||invoice.status!=="paid"||!invoice.net_proceeds_verified_at)
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
 const legalId=String(merchant?.cnpj??"").replace(/[^0-9]/g,"");
 const legalDocumentOnFile=!!merchantId&&legalId.length===14;
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
