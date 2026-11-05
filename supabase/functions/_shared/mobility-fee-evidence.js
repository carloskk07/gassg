import {sha256Hex} from "./domain.js";

// Shared proof digest used by both the authenticated driver inquiry and the
// HMAC-verified Mercado Pago webhook. Identical states must be exact replays.
export async function mobilityFeeEvidenceHash(input){
 const orderId=String(input?.orderId??"");
 const paymentId=String(input?.paymentId??"");
 const externalReference=String(input?.externalReference??"");
 const amountCents=Number(input?.amountCents);
 const state=String(input?.state??"");
 if(!orderId||!paymentId||!/^mobility-fee:[0-9a-f-]{36}$/.test(externalReference)
   ||!Number.isSafeInteger(amountCents)||amountCents<100||amountCents>1000000
   ||!["paid","expired","review_required"].includes(state)){
  throw new Error("MOBILITY_FEE_EVIDENCE_INVALID");
 }
 return sha256Hex({
  provider:"mercadopago",purpose:"mobility_platform_fee",
  orderId,paymentId,amountCents,externalReference,state
 });
}
