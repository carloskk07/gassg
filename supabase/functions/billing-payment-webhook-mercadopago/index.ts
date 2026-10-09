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
  let status=merchantProviderStatus(order,payment);

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
    const original=await ingestPlatformPayment(admin,order,charge,occurredAt);
    const refunds=await ingestPlatformRefunds(
      admin,order,original.reconciliationKey,occurredAt
    );
    return json({
      ok:true,
      route:"platform_billing",
      provider:"mercadopago",
      orderId,
      status,
      statusDetail,
      paymentResult:original.data,
      refundsProcessed:refunds.length,
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
