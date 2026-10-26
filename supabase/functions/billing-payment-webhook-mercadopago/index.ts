import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { sha256Hex as billingEvidenceHash } from "../_shared/domain.js";
import {
  decryptPaymentSecret,
  paymentEncryptionConfigured,
  sha256Hex as paymentEvidenceHash
} from "../_shared/payment-secrets.js";
import {
  mercadoPagoConfigured,
  mercadoPagoFetch,
  readMercadoPagoJson,
  moneyToCents,
  verifyMercadoPagoWebhook
} from "../_shared/mercadopago.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES=65536;
const WEBHOOK_PROBE_RE=/^TAMAO-WEBHOOK-PROBE-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store"
    }
  });
}
function safeOccurredAt(...values:unknown[]){
  const now=Date.now();
  for(const value of values){
    const parsed=Date.parse(String(value??""));
    if(Number.isFinite(parsed)&&parsed<=now+5*60_000&&parsed>=now-180*86400_000){
      return new Date(parsed).toISOString();
    }
  }
  return new Date(now).toISOString();
}
function orderPayments(order:any){
  return Array.isArray(order?.transactions?.payments)
    ?order.transactions.payments
    :[];
}
function primaryPayment(order:any){
  return orderPayments(order)[0]??null;
}
function billingPixPayment(order:any){
  const payments=orderPayments(order);
  return payments.find((p:any)=>
    String(p?.payment_method?.id??"").toLowerCase()==="pix"
    &&String(p?.payment_method?.type??"").toLowerCase()==="bank_transfer"
  )??payments[0]??null;
}
function refundedCents(order:any){
  const refunds=Array.isArray(order?.transactions?.refunds)
    ?order.transactions.refunds
    :[];
  return refunds.reduce((sum:number,item:any)=>{
    const status=String(item?.status??"").trim().toLowerCase();
    if(status&&!["processed","approved","refunded"].includes(status))return sum;
    return sum+(moneyToCents(item?.amount)??0);
  },0);
}
function merchantProviderStatus(order:any,payment:any){
  const candidates=[
    payment?.status,
    order?.status
  ].map((x)=>String(x??"").trim().toLowerCase()).filter(Boolean);
  const priority=[
    "refunded","partially_refunded","processed","failed",
    "canceled","expired","processing","action_required"
  ];
  for(const status of priority){
    if(candidates.includes(status))return status;
  }
  return candidates[0]??"unknown";
}
async function fetchProviderOrder(accessToken:string,orderId:string){
  const response=await mercadoPagoFetch(
    "/v1/orders/"+encodeURIComponent(orderId),
    {accessToken}
  );
  const data=await readMercadoPagoJson(response);
  return {response,data};
}
async function ingestPlatformPayment(
  admin:any,
  order:any,
  charge:any,
  occurredAt:string
){
  const orderId=String(order?.id??"").trim();
  const payment=billingPixPayment(order);
  const paymentId=String(payment?.id??"").trim();
  const amountCents=moneyToCents(order?.total_amount);
  if(!orderId||!paymentId||amountCents!==Number(charge.amount_cents)){
    throw new Error("MERCADOPAGO_ORDER_PAYMENT_MISMATCH");
  }
  const reconciliationKey="mp-order:"+orderId;
  const evidenceHash=await billingEvidenceHash({
    provider:"mercadopago",
    orderId,
    externalReference:String(order?.external_reference??""),
    amountCents,
    paymentId,
    paymentMethod:"pix"
  });
  const {data,error}=await admin.rpc("ingest_merchant_billing_payment_event",{
    p_provider:"mercadopago",
    p_provider_event_id:"order:"+orderId+":accredited",
    p_reconciliation_key:reconciliationKey,
    p_payment_method:"pix",
    p_amount_cents:amountCents,
    p_currency:"BRL",
    p_occurred_at:occurredAt,
    p_raw_payload_sha256:evidenceHash,
    p_payer_reference:null,
    p_provider_correlation_id:String(order.external_reference)
  });
  if(error)throw error;
  return {data,reconciliationKey,paymentId};
}
async function ingestPlatformRefunds(
  admin:any,
  order:any,
  originalReconciliationKey:string,
  occurredAt:string
){
  const refunds=Array.isArray(order?.transactions?.refunds)
    ?order.transactions.refunds
    :[];
  const results=[];
  for(const refund of refunds){
    if(String(refund?.status??"").toLowerCase()!=="processed")continue;
    const refundId=String(refund?.id??"").trim();
    const amountCents=moneyToCents(refund?.amount);
    if(!refundId||!amountCents)continue;
    const refundKey="mp-refund:"+refundId;
    const evidenceHash=await billingEvidenceHash({
      provider:"mercadopago",
      orderId:String(order?.id??""),
      refundId,
      transactionId:String(refund?.transaction_id??""),
      amountCents
    });
    const {data,error}=await admin.rpc("ingest_merchant_billing_payment_refund",{
      p_provider:"mercadopago",
      p_provider_event_id:"refund:"+refundId,
      p_original_reconciliation_key:originalReconciliationKey,
      p_refund_reconciliation_key:refundKey,
      p_amount_cents:amountCents,
      p_currency:"BRL",
      p_occurred_at:occurredAt,
      p_raw_payload_sha256:evidenceHash
    });
    if(error)throw error;
    results.push({refundId,result:data});
  }
  return results;
}
async function handleMerchantSaleOrder(
  admin:any,
  attempt:any,
  dataId:string,
  body:any,
  encryptionKey:string
){
  if(!paymentEncryptionConfigured(encryptionKey)){
    return json({error:"MERCHANT_PAYMENT_WEBHOOK_NOT_CONFIGURED"},503);
  }

  const {data:account,error:accountError}=await admin
    .from("merchant_payment_provider_accounts")
    .select("provider_account_id,status,access_token_ciphertext,access_token_nonce")
    .eq("merchant_id",attempt.merchant_id)
    .eq("provider","mercadopago")
    .maybeSingle();
  if(accountError)throw accountError;
  if(
    !account
    ||account.status!=="active"
    ||!account.access_token_ciphertext
    ||!account.access_token_nonce
  ){
    await admin
      .from("merchant_sale_payment_attempts")
      .update({
        status:"review_required",
        last_error_code:"MERCHANT_PROVIDER_CONNECTION_UNAVAILABLE",
        last_error_at:new Date().toISOString(),
        updated_at:new Date().toISOString()
      })
      .eq("id",attempt.id)
      .neq("status","refunded");
    return json({error:"MERCHANT_PROVIDER_CONNECTION_UNAVAILABLE"},409);
  }

  const accessToken=await decryptPaymentSecret(
    account.access_token_ciphertext,
    account.access_token_nonce,
    encryptionKey,
    "provider-account:"+attempt.merchant_id+":mercadopago:access"
  );
  const {response,data:order}=await fetchProviderOrder(accessToken,dataId);
  if(!response.ok){
    throw new Error("MERCADOPAGO_MERCHANT_ORDER_LOOKUP_HTTP_"+response.status);
  }

  const orderId=String(order?.id??"").trim();
  const externalReference=String(order?.external_reference??"").trim();
  const amountCents=moneyToCents(order?.total_amount);
  const providerAccountId=String(account.provider_account_id??"").trim();
  const providerUserId=String(order?.user_id??"").trim();
  if(
    orderId!==dataId
    ||externalReference!==attempt.external_reference
    ||amountCents!==Number(attempt.amount_cents)
    ||attempt.currency!=="BRL"
    ||!providerAccountId
    ||providerUserId!==providerAccountId
  ){
    await admin
      .from("merchant_sale_payment_attempts")
      .update({
        status:"review_required",
        last_error_code:"MERCHANT_PROVIDER_ORDER_MISMATCH",
        last_error_at:new Date().toISOString(),
        updated_at:new Date().toISOString()
      })
      .eq("id",attempt.id)
      .neq("status","refunded");
    return json({error:"MERCHANT_PROVIDER_ORDER_MISMATCH"},409);
  }

  const payment=primaryPayment(order);
  const paymentId=String(payment?.id??"").trim()||null;
  const refundTotalCents=refundedCents(order);
  const orderState=String(order?.status??"").trim().toLowerCase();
  const paymentState=String(payment?.status??"").trim().toLowerCase();
  const detailStates=[
    String(order?.status_detail??"").trim().toLowerCase(),
    String(payment?.status_detail??"").trim().toLowerCase()
  ];
  const adverseDetails=["refunded","partially_refunded","charged_back",
    "chargeback","disputed","in_mediation","reimbursed","failed"];
  const saleEvidenceConflicted=order?.live_mode===false
    ||(order?.currency_id&&order.currency_id!=="BRL")
    ||refundTotalCents>Number(attempt.amount_cents);
  if(saleEvidenceConflicted){
    const now=new Date().toISOString();
    const {error:reviewError}=await admin
      .from("merchant_sale_payment_attempts")
      .update({
        status:"review_required",
        last_error_code:"MERCHANT_PROVIDER_SALE_EVIDENCE_CONFLICT",
        last_error_at:now,
        updated_at:now
      })
      .eq("id",attempt.id)
      .neq("status","refunded");
    if(reviewError)throw reviewError;
    return json({
      ok:true,route:"merchant_sale",provider:"mercadopago",orderId,
      salePaymentStatus:"review_required",
      reason:"MERCHANT_PROVIDER_SALE_EVIDENCE_CONFLICT",
      tamaoReceivesSaleProceeds:false
    },200);
  }

  let status=merchantProviderStatus(order,payment);
  // A successful ORDER by itself is not a successful PAYMENT. The two PSP
  // objects can diverge; a prior helper prioritized "processed" over "failed".
  // Never call the SQL approval RPC on inconsistent or reversed evidence.
  if(status==="processed"&&(
    orderState!=="processed"||paymentState!=="processed"
    ||detailStates.some((value:string)=>adverseDetails.includes(value))
    ||(payment?.amount!=null
      &&moneyToCents(payment.amount)!==Number(attempt.amount_cents))
  )){
    const now=new Date().toISOString();
    const {error:reviewError}=await admin
      .from("merchant_sale_payment_attempts")
      .update({
        status:"review_required",
        last_error_code:"MERCHANT_PROVIDER_PAYMENT_STATUS_CONFLICT",
        last_error_at:now,updated_at:now
      })
      .eq("id",attempt.id)
      .neq("status","refunded");
    if(reviewError)throw reviewError;
    return json({
      ok:true,route:"merchant_sale",provider:"mercadopago",orderId,
      salePaymentStatus:"review_required",
      reason:"MERCHANT_PROVIDER_PAYMENT_STATUS_CONFLICT",
      tamaoReceivesSaleProceeds:false
    },200);
  }

  if(refundTotalCents>=Number(attempt.amount_cents)){
    status="refunded";
  }else if(refundTotalCents>0){
    const now=new Date().toISOString();
    const {error:partialError}=await admin
      .from("merchant_sale_payment_attempts")
      .update({
        status:"review_required",
        last_error_code:"PARTIAL_REFUND_REVIEW_REQUIRED",
        last_error_at:now,
        updated_at:now
      })
      .eq("id",attempt.id);
    if(partialError)throw partialError;
    return json({
      ok:true,
      route:"merchant_sale",
      provider:"mercadopago",
      orderId,
      salePaymentStatus:"review_required",
      reason:"PARTIAL_REFUND_REVIEW_REQUIRED",
      tamaoReceivesSaleProceeds:false
    },200);
  }

  if(status==="processed"&&!paymentId){
    const now=new Date().toISOString();
    const {error:paymentIdError}=await admin
      .from("merchant_sale_payment_attempts")
      .update({
        status:"review_required",
        last_error_code:"PROVIDER_PAYMENT_ID_MISSING",
        last_error_at:now,
        updated_at:now
      })
      .eq("id",attempt.id);
    if(paymentIdError)throw paymentIdError;
    return json({
      ok:true,
      route:"merchant_sale",
      provider:"mercadopago",
      orderId,
      salePaymentStatus:"review_required",
      reason:"PROVIDER_PAYMENT_ID_MISSING",
      tamaoReceivesSaleProceeds:false
    },200);
  }

  const statusDetail=String(
    payment?.status_detail??order?.status_detail??""
  ).trim().slice(0,240)||null;
  const normalizedEvent={
    provider:"mercadopago",
    providerOrderId:orderId,
    providerPaymentId:paymentId,
    externalReference,
    status,
    statusDetail,
    amountCents,
    refundTotalCents,
    providerAccountId
  };
  const eventHash=await paymentEvidenceHash(JSON.stringify(normalizedEvent));
  const {data:applied,error:applyError}=await admin.rpc(
    "apply_merchant_sale_payment_event",
    {
      p_provider_event_id:"order-state:"+eventHash.slice(0,64),
      p_provider_order_id:orderId,
      p_provider_payment_id:paymentId,
      p_event_type:"order."+status,
      p_provider_status:status,
      p_amount_cents:amountCents,
      p_currency:"BRL",
      p_occurred_at:safeOccurredAt(
        body?.date_created,
        order?.last_updated_date,
        order?.date_last_updated,
        order?.created_date
      ),
      p_raw_payload_sha256:eventHash
    }
  );
  if(applyError)throw applyError;

  if(statusDetail){
    const {error:detailError}=await admin
      .from("merchant_sale_payment_attempts")
      .update({
        provider_status_detail:statusDetail,
        updated_at:new Date().toISOString()
      })
      .eq("id",attempt.id);
    if(detailError)throw detailError;
  }

  return json({
    ok:true,
    route:"merchant_sale",
    provider:"mercadopago",
    orderId,
    salePaymentStatus:applied?.status??status,
    tamaoReceivesSaleProceeds:false
  },200);
}
async function handlePlatformBillingOrder(
  admin:any,
  dataId:string,
  body:any,
  accessToken:string
){
  if(!mercadoPagoConfigured(accessToken)){
    return json({error:"MERCADOPAGO_PLATFORM_BILLING_NOT_CONFIGURED"},503);
  }

  const {response,data:order}=await fetchProviderOrder(accessToken,dataId);
  if(!response.ok){
    // A seller-owned order can notify us before its provider_order_id is
    // committed locally. Returning 503 preserves delivery retry instead of
    // acknowledging and losing the financial state.
    if(response.status===404||response.status===403){
      return json({error:"MERCADOPAGO_ORDER_ROUTE_NOT_READY"},503);
    }
    throw new Error("MERCADOPAGO_PLATFORM_ORDER_LOOKUP_HTTP_"+response.status);
  }

  const orderId=String(order?.id??"").trim();
  const externalReference=String(order?.external_reference??"").trim();
  if(orderId!==dataId){
    return json({error:"MERCADOPAGO_ORDER_ID_MISMATCH"},409);
  }
  // Mercado Pago can notify before the Pix creation response commits its
  // provider_order_id. Recover only if the remote order names an existing,
  // prepared coupon invoice AND has the exact snapshotted amount/payment.
  // Never credit based solely on external_reference or an unverified webhook.
  if(UUID_RE.test(externalReference)){
    const {data:pendingCoupon,error:pendingError}=await admin
      .from("clube_coupon_paid_invoices")
      .select("id,sale_price_cents,provider_order_id,status")
      .eq("id",externalReference)
      .maybeSingle();
    if(pendingError&&pendingError.code!=="42P01")throw pendingError;
    if(pendingCoupon){
      if(pendingCoupon.provider_order_id&&pendingCoupon.provider_order_id!==dataId){
        return json({error:"COUPON_PROVIDER_REFERENCE_MISMATCH"},409);
      }
      const pix=billingPixPayment(order);
      if(moneyToCents(order?.total_amount)!==Number(pendingCoupon.sale_price_cents)||
         String(pix?.payment_method?.id??"")!=="pix"||
         String(pix?.payment_method?.type??"")!=="bank_transfer"||
         !pix?.id){
        return json({error:"COUPON_EARLY_PAYMENT_MISMATCH"},409);
      }
      if(!pendingCoupon.provider_order_id&&pendingCoupon.status==="prepared"){
        const {error:linkError}=await admin.from("clube_coupon_paid_invoices")
          .update({provider_order_id:dataId,provider_payment_id:String(pix.id),
            status:"awaiting_payment",updated_at:new Date().toISOString()})
          .eq("id",pendingCoupon.id).eq("status","prepared").is("provider_order_id",null);
        if(linkError)throw linkError;
      }
      return await handlePaidCouponOrder(admin,dataId,pendingCoupon,accessToken);
    }
  }
  if(!UUID_RE.test(externalReference)){
    return json({ok:true,ignored:true,reason:"FOREIGN_PLATFORM_ORDER"},202);
  }

  const {data:charge,error:chargeError}=await admin
    .from("merchant_billing_provider_charges")
    .select("id,payment_request_id,merchant_id,provider,correlation_id,provider_charge_id,amount_cents,currency,status")
    .eq("provider","mercadopago")
    .eq("correlation_id",externalReference)
    .maybeSingle();
  if(chargeError)throw chargeError;
  if(!charge){
    return json({ok:true,ignored:true,reason:"FOREIGN_PLATFORM_ORDER_REFERENCE"},202);
  }
  if(
    charge.currency!=="BRL"
    ||(charge.provider_charge_id&&String(charge.provider_charge_id)!==orderId)
  ){
    return json({error:"MERCADOPAGO_CHARGE_BINDING_MISMATCH"},409);
  }

  const totalCents=moneyToCents(order?.total_amount);
  if(totalCents!==Number(charge.amount_cents)){
    await admin.rpc("merchant_billing_provider_charge_record_error",{
      p_charge_id:charge.id,
      p_error_code:"MERCADOPAGO_ORDER_AMOUNT_MISMATCH"
    });
    return json({error:"MERCADOPAGO_ORDER_AMOUNT_MISMATCH"},409);
  }

  const status=String(order?.status??"").trim().toLowerCase();
  const statusDetail=String(order?.status_detail??"").trim().toLowerCase();
  const occurredAt=safeOccurredAt(
    body?.date_created,
    order?.last_updated_date,
    order?.created_date
  );

  if(["processed","refunded"].includes(status)){
    // A signed webhook is not evidence of settlement by itself. Ingest only
    // after querying the PSP and checking BOTH the order and Pix transaction.
    // Never mistake a sandbox payment or a non-Pix first transaction for money.
    const payment=billingPixPayment(order);
    const paymentStatus=String(payment?.status??"").trim().toLowerCase();
    const paymentDetail=String(payment?.status_detail??"").trim().toLowerCase();
    const method=payment?.payment_method??{};
    const paymentAmount=payment?.amount==null?Number(charge.amount_cents)
      :moneyToCents(payment.amount);
    if(order?.live_mode===false||(order?.currency_id&&order.currency_id!=="BRL")
      ||String(method.id??"").toLowerCase()!=="pix"
      ||String(method.type??"").toLowerCase()!=="bank_transfer"
      ||!String(payment?.id??"").trim()
      ||paymentAmount!==Number(charge.amount_cents)){
      await admin.rpc("merchant_billing_provider_charge_record_error",{
        p_charge_id:charge.id,p_error_code:"MERCADOPAGO_PAYMENT_BINDING_MISMATCH"
      });
      return json({error:"MERCADOPAGO_PAYMENT_BINDING_MISMATCH"},409);
    }

    const verifiedRefunds=(Array.isArray(order?.transactions?.refunds)
      ?order.transactions.refunds:[]).filter((refund:any)=>
        String(refund?.status??"").toLowerCase()==="processed"
        &&Boolean(String(refund?.id??"").trim())
        &&Boolean(moneyToCents(refund?.amount)));
    const refundTotal=verifiedRefunds.reduce((sum:number,refund:any)=>
      sum+(moneyToCents(refund?.amount)??0),0);
    const adverse=["refunded","partially_refunded","charged_back","chargeback",
      "disputed","in_mediation","reimbursed","failed","canceled","expired"];
    const reversalObserved=status==="refunded"||refundTotal>0
      ||adverse.includes(statusDetail)||adverse.includes(paymentDetail)
      ||adverse.includes(paymentStatus);
    if(reversalObserved){
      // Never create a NEW positive payment event from a refunded or disputed
      // snapshot. Verified provider refund IDs enter the existing quarantine/
      // recovery RPC (which can match prior events); otherwise require review.
      if(refundTotal===0||refundTotal>Number(charge.amount_cents)){
        await admin.rpc("merchant_billing_provider_charge_record_error",{
          p_charge_id:charge.id,p_error_code:"MERCADOPAGO_REVERSAL_REVIEW_REQUIRED"
        });
        return json({error:"MERCADOPAGO_REVERSAL_REVIEW_REQUIRED"},409);
      }
      const refunds=await ingestPlatformRefunds(
        admin,order,"mp-order:"+orderId,occurredAt
      );
      return json({
        ok:true,route:"platform_billing",provider:"mercadopago",orderId,
        status,statusDetail,refundsProcessed:refunds.length,
        paymentResult:null,reviewRequired:true,tamaoReceivesPlatformBilling:false
      },200);
    }
    if(status!=="processed"||paymentStatus!=="processed"
      ||(statusDetail&&statusDetail!=="accredited")
      ||(paymentDetail&&paymentDetail!=="accredited")){
      await admin.rpc("merchant_billing_provider_charge_record_error",{
        p_charge_id:charge.id,p_error_code:"MERCADOPAGO_PAYMENT_NOT_ACCREDITED"
      });
      return json({error:"MERCADOPAGO_PAYMENT_NOT_ACCREDITED"},409);
    }
    const original=await ingestPlatformPayment(admin,order,charge,occurredAt);
    return json({
      ok:true,
      route:"platform_billing",
      provider:"mercadopago",
      orderId,
      status,
      statusDetail,
      paymentResult:original.data,
      refundsProcessed:0,
      tamaoReceivesPlatformBilling:true
    },200);
  }

  if(["expired","canceled","failed"].includes(status)){
    const now=new Date().toISOString();
    const nextStatus=status==="expired"?"expired":"cancelled";
    const patch:any={
      status:nextStatus,
      updated_at:now,
      last_error_code:null,
      last_error_at:null
    };
    if(nextStatus==="expired")patch.expired_at=now;
    const {error:updateError}=await admin
      .from("merchant_billing_provider_charges")
      .update(patch)
      .eq("id",charge.id)
      .in("status",["preparing","active"]);
    if(updateError)throw updateError;
    return json({
      ok:true,
      route:"platform_billing",
      provider:"mercadopago",
      orderId,
      status,
      statusDetail
    },200);
  }

  return json({
    ok:true,
    route:"platform_billing",
    provider:"mercadopago",
    orderId,
    status,
    statusDetail,
    pending:true
  },200);
}

// The SAME production Mercado Pago webhook handles coupon purchases after
// signature verification. Never accept a client-generated 'paid' callback.
async function handlePaidCouponOrder(
  admin:any,dataId:string,invoice:any,accessToken:string
){
 if(!mercadoPagoConfigured(accessToken))return json({error:"MP_NOT_CONFIGURED"},503);
 const {response,data:order}=await fetchProviderOrder(accessToken,dataId);
 if(!response.ok)return json({error:"COUPON_PROVIDER_LOOKUP_FAILED"},503);
 const pix=billingPixPayment(order);
 const amount=moneyToCents(order?.total_amount);
 if(String(order?.id??"")!==dataId||
    String(order?.external_reference??"")!==String(invoice.id)||
    amount!==Number(invoice.sale_price_cents)||
    (order?.currency_id&&order.currency_id!=="BRL")||
    String(pix?.payment_method?.id??"")!=="pix"||
    String(pix?.payment_method?.type??"")!=="bank_transfer"){
  return json({error:"COUPON_ORDER_BINDING_MISMATCH"},409);
 }
 // Refunds and chargebacks outrank 'processed' on any replay. A paid coupon
 // is never left spendable after a verified refund without an explicit hold.
 const refunds=Array.isArray(order?.transactions?.refunds)?order.transactions.refunds:[];
 const providerStatus=String(order?.status??"").trim().toLowerCase();
 const paymentStatus=String(pix?.status??"").trim().toLowerCase();
 const providerDetail=String(order?.status_detail??"").trim().toLowerCase();
 const paymentDetail=String(pix?.status_detail??"").trim().toLowerCase();
 // Mercado Pago also reports partial refunds as status='processed' with
 // status_detail='partially_refunded'. Inspect BOTH levels of the provider
 // order AND payment before keeping already-paid vouchers spendable.
 const providerStates=[providerStatus,paymentStatus,providerDetail,paymentDetail];
 const reversalStates=["refunded","partially_refunded","charged_back","chargeback",
   "disputed","in_mediation","reimbursed"];
 const failedStates=["canceled","cancelled","failed","expired"];
 const hasRefund=refunds.some((r:any)=>
  ["processed","approved","refunded"].includes(String(r?.status??"").toLowerCase()))
  ||providerStates.some(state=>reversalStates.includes(state))
  ||(invoice.status==="paid"&&(providerStates.some(state=>failedStates.includes(state))||
    providerStatus!=="processed"||
    !["processed","accredited","approved"].includes(paymentStatus)||
    (providerDetail!==""&&providerDetail!=="accredited")||
    (paymentDetail!==""&&paymentDetail!=="accredited")));
 if(hasRefund){
  const refunded=refunds.reduce((total:number,r:any)=>{
    if(!["processed","approved","refunded"].includes(String(r?.status??"").toLowerCase()))
      return total;
    return total+(moneyToCents(r.amount)??0);
  },0);
  // A partial refund, status inconsistency or chargeback needs manual
  // allocation review. It may never be treated as a full paid voucher.
  const unsafeToClassifyFull=["partially_refunded","charged_back","chargeback",
    "disputed","in_mediation","reimbursed","canceled","cancelled","failed","expired"];
  const fullRefund=refunded===Number(invoice.sale_price_cents)&&
    refunded>0&&!providerStates.some(state=>unsafeToClassifyFull.includes(state));
  const rpc=fullRefund?"clube_coupon_paid_payment_refund":
    "clube_coupon_paid_payment_review";
  const {data,error}=await admin.rpc(rpc,{
   p_invoice_id:invoice.id,p_provider_order_id:dataId
  });
  if(error)throw error;
  // A full provider refund can STILL require manual merchant compensation
  // when a voucher was reserved/redeemed. Never tell the caller it is
  // financially closed if the authoritative SQL RPC retained the review.
  const reviewRequired=!fullRefund||data?.reviewRequired===true||
    data?.ok===false||data?.refunded===false;
  return json({ok:true,route:"coupon_funding",provider:"mercadopago",
   status:reviewRequired?"review_required":"refunded",
   reviewRequired},200);
 }
 // Never resurrect a previously refunded invoice or release a finance-review
 // hold when a delayed provider replay reports "processed" with no reversal
 // details. The reversal above still receives priority when fresh proof exists.
 // The original signed Order ID/amount/Pix binding was checked above.
 if(invoice.status==="review_required"||invoice.status==="refunded"){
  return json({ok:true,route:"coupon_funding",provider:"mercadopago",
   status:invoice.status,reviewRequired:invoice.status==="review_required",
   replayed:true},200);
 }
 if(providerStatus==="processed"&&
    ["processed","accredited","approved"].includes(paymentStatus)){
  const {data,error}=await admin.rpc("clube_coupon_paid_payment_verify",{
   p_invoice_id:invoice.id,p_provider_order_id:dataId,
   p_payment_id:String(pix.id??""),p_amount_cents:amount
  });
  if(error)throw error;
  return json({ok:true,route:"coupon_funding",provider:"mercadopago",
   status:"paid",replayed:data?.replayed===true},200);
 }
 if(["expired","canceled","failed"].includes(providerStatus)){
  const next=providerStatus==="expired"?"expired":"cancelled";
  const {error}=await admin.from("clube_coupon_paid_invoices")
   .update({status:next,updated_at:new Date().toISOString()})
   .eq("id",invoice.id).in("status",["prepared","awaiting_payment"]);
  if(error)throw error;
 }
 return json({ok:true,route:"coupon_funding",provider:"mercadopago",
  status:providerStatus,pending:true},200);
}

async function handleWebhookProbe(
  admin:any,
  req:Request,
  dataId:string,
  topic:string,
  body:any
){
  const requestId=String(req.headers.get("x-request-id")??"").trim();
  const evidenceHash=await billingEvidenceHash({
    provider:"mercadopago",
    purpose:"remote_webhook_registration_proof",
    resourceId:dataId,
    requestId,
    topic,
    action:String(body?.action??"").trim(),
    applicationId:String(body?.application_id??"").trim(),
    liveMode:body?.live_mode===true
  });
  const {data,error}=await admin.rpc("consume_payment_webhook_probe",{
    p_provider:"mercadopago",
    p_resource_id:dataId,
    p_provider_request_id:requestId||null,
    p_evidence_sha256:evidenceHash,
    p_metadata:{
      topic,
      action:String(body?.action??"").trim()||null,
      applicationId:String(body?.application_id??"").trim()||null,
      liveMode:body?.live_mode===true,
      providerRequestIdPresent:Boolean(requestId)
    }
  });
  if(error){
    const message=String(error.message??error);
    if(message.includes("WEBHOOK_PROBE_NOT_FOUND")){
      return json({
        error:"WEBHOOK_PROBE_NOT_FOUND",
        financialMutationAttempted:false
      },404);
    }
    if(message.includes("WEBHOOK_PROBE_EXPIRED")){
      return json({
        error:"WEBHOOK_PROBE_EXPIRED",
        financialMutationAttempted:false
      },410);
    }
    if(message.includes("WEBHOOK_PROBE_INVALID")){
      return json({
        error:"WEBHOOK_PROBE_INVALID",
        financialMutationAttempted:false
      },400);
    }
    throw error;
  }
  return json({
    ok:true,
    route:"webhook_probe",
    provider:"mercadopago",
    status:"verified",
    probeId:data?.probeId??null,
    verifiedAt:data?.verifiedAt??null,
    replayed:data?.replayed===true,
    signatureVerified:true,
    financialMutationAttempted:false
  },200);
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);

  const webhookSecret=String(Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET")??"").trim();
  if(webhookSecret.length<16){
    return json({error:"MERCADOPAGO_WEBHOOK_NOT_CONFIGURED"},503);
  }

  try{
    const declared=Number(req.headers.get("content-length")??0);
    if(Number.isFinite(declared)&&declared>MAX_BODY_BYTES){
      return json({error:"PAYLOAD_TOO_LARGE"},413);
    }
    const raw=await req.text();
    if(new TextEncoder().encode(raw).byteLength>MAX_BODY_BYTES){
      return json({error:"PAYLOAD_TOO_LARGE"},413);
    }
    let body:any={};
    try{body=raw?JSON.parse(raw):{}}
    catch{return json({error:"INVALID_JSON"},400)}

    const url=new URL(req.url);
    const dataId=String(
      url.searchParams.get("data.id")
      ??body?.data?.id
      ??""
    ).trim();
    if(dataId.length<6||dataId.length>240||/[\u0000-\u001f\u007f]/.test(dataId)){
      return json({error:"INVALID_PROVIDER_ORDER_ID"},400);
    }

    const signed=await verifyMercadoPagoWebhook(req,webhookSecret,dataId);
    if(!signed)return json({error:"INVALID_MERCADOPAGO_SIGNATURE"},401);

    const topic=String(
      url.searchParams.get("type")
      ??body?.type
      ??""
    ).trim().toLowerCase();
    if(!["order","orders"].includes(topic)){
      return json({ok:true,ignored:true,reason:"UNSUPPORTED_TOPIC"},202);
    }

    const admin=createClient(SUPABASE_URL,SECRET_KEY,{
      auth:{persistSession:false,autoRefreshToken:false}
    });

    // Provider-signed simulator proof. The reserved resource ID namespace can
    // never be treated as a financial Order. Signature verification already
    // succeeded above, and the RPC can only consume a short-lived admin probe.
    if(WEBHOOK_PROBE_RE.test(dataId)){
      return await handleWebhookProbe(admin,req,dataId,topic,body);
    }

    // Route by an exact local provider-order binding first. This allows one
    // Mercado Pago production webhook URL for platform billing and every
    // OAuth-connected merchant without ever guessing which token owns an order.
    const {data:merchantAttempt,error:attemptError}=await admin
      .from("merchant_sale_payment_attempts")
      .select("id,order_id,merchant_id,external_reference,amount_cents,currency,status,provider_order_id")
      .eq("provider","mercadopago")
      .eq("provider_order_id",dataId)
      .maybeSingle();
    if(attemptError)throw attemptError;

    if(merchantAttempt){
      return await handleMerchantSaleOrder(
        admin,
        merchantAttempt,
        dataId,
        body,
        String(Deno.env.get("MERCHANT_PAYMENT_TOKEN_ENCRYPTION_KEY")??"").trim()
      );
    }

    // Strict provider-order binding prevents mixing coupon charges with
    // existing merchant-billing and merchant-OAuth payments.
    const {data:couponInvoice,error:couponLookupError}=await admin
      .from("clube_coupon_paid_invoices")
      .select("id,provider_order_id,sale_price_cents,status")
      .eq("provider","mercadopago")
      .eq("provider_order_id",dataId)
      .maybeSingle();
    // No coupon tables on older deployments: preserve all existing routes.
    if(couponLookupError&&couponLookupError.code!=="42P01")throw couponLookupError;
    if(couponInvoice){
      return await handlePaidCouponOrder(admin,dataId,couponInvoice,
        String(Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")??"").trim());
    }

    return await handlePlatformBillingOrder(
      admin,
      dataId,
      body,
      String(Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")??"").trim()
    );
  }catch(error){
    console.error(
      "billing-payment-webhook-mercadopago failed",
      error instanceof Error?error.message:String(error)
    );
    return json({error:"MERCADOPAGO_WEBHOOK_FAILED"},500);
  }
});
