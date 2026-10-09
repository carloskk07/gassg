import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  decryptPaymentSecret,
  paymentEncryptionConfigured,
  sha256Hex
} from "../_shared/payment-secrets.js";
import {
  mercadoPagoFetch,
  readMercadoPagoJson,
  moneyToCents,
  verifyMercadoPagoWebhook
} from "../_shared/mercadopago.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
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
function occurredAt(body:any,order:any){
  const candidates=[
    body?.date_created,
    order?.last_updated_date,
    order?.date_last_updated,
    order?.created_date
  ];
  const now=Date.now();
  for(const value of candidates){
    const parsed=Date.parse(String(value??""));
    if(
      Number.isFinite(parsed)
      &&parsed<=now+5*60_000
      &&parsed>=now-180*86400_000
    ){
      return new Date(parsed).toISOString();
    }
  }
  return new Date(now).toISOString();
}
function primaryPayment(order:any){
  const payments=Array.isArray(order?.transactions?.payments)
    ?order.transactions.payments
    :[];
  return payments[0]??null;
}
function providerStatus(order:any,payment:any){
  const candidates=[
    payment?.status,
    order?.status
  ].map((x)=>String(x??"").trim().toLowerCase()).filter(Boolean);
  const terminalPriority=[
    "refunded","partially_refunded","processed","failed",
    "canceled","expired","processing","action_required"
  ];
  for(const status of terminalPriority){
    if(candidates.includes(status))return status;
  }
  return candidates[0]??"unknown";
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);

  const webhookSecret=String(
    Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET")??""
  ).trim();
  const encryptionKey=String(
    Deno.env.get("MERCHANT_PAYMENT_TOKEN_ENCRYPTION_KEY")??""
  ).trim();
  if(webhookSecret.length<16||!paymentEncryptionConfigured(encryptionKey)){
    return json({error:"MERCHANT_PAYMENT_WEBHOOK_NOT_CONFIGURED"},503);
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

    const signed=await verifyMercadoPagoWebhook(
      req,webhookSecret,dataId
    );
    if(!signed){
      return json({error:"INVALID_MERCADOPAGO_SIGNATURE"},401);
    }

    const topic=String(
      url.searchParams.get("type")
      ??body?.type
      ??""
    ).trim().toLowerCase();
    if(topic!=="order"){
      return json({ok:true,ignored:true,reason:"UNSUPPORTED_TOPIC"},202);
    }

    const admin=createClient(SUPABASE_URL,SECRET_KEY,{
      auth:{persistSession:false,autoRefreshToken:false}
    });

    const {data:attempt,error:attemptError}=await admin
      .from("merchant_sale_payment_attempts")
      .select("id,order_id,merchant_id,external_reference,amount_cents,currency,status,provider_order_id")
      .eq("provider","mercadopago")
      .eq("provider_order_id",dataId)
      .maybeSingle();
    if(attemptError)throw attemptError;
    if(!attempt){
      return json({
        ok:true,
        ignored:true,
        reason:"FOREIGN_MERCHANT_ORDER"
      },202);
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
      return json({
        error:"MERCHANT_PROVIDER_CONNECTION_UNAVAILABLE"
      },409);
    }

    const accessToken=await decryptPaymentSecret(
      account.access_token_ciphertext,
      account.access_token_nonce,
      encryptionKey,
      "provider-account:"+attempt.merchant_id+":mercadopago:access"
    );

    const response=await mercadoPagoFetch(
      "/v1/orders/"+encodeURIComponent(dataId),
      {accessToken}
    );
    const order=await readMercadoPagoJson(response);
    if(!response.ok){
      throw new Error("MERCADOPAGO_ORDER_LOOKUP_HTTP_"+response.status);
    }

    const orderId=String(order?.id??"").trim();
    const externalReference=String(
      order?.external_reference??""
    ).trim();
    const amountCents=moneyToCents(order?.total_amount);
    if(
      orderId!==dataId
      ||externalReference!==attempt.external_reference
      ||amountCents!==Number(attempt.amount_cents)
      ||attempt.currency!=="BRL"
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
    const status=providerStatus(order,payment);
    const statusDetail=String(
      payment?.status_detail
      ??order?.status_detail
      ??""
    ).trim().slice(0,240)||null;

    const normalizedEvent={
      provider:"mercadopago",
      providerOrderId:orderId,
      providerPaymentId:paymentId,
      externalReference,
      status,
      statusDetail,
      amountCents
    };
    const eventHash=await sha256Hex(JSON.stringify(normalizedEvent));
    const providerEventId="order-state:"+eventHash.slice(0,64);
    const {data:applied,error:applyError}=await admin.rpc(
      "apply_merchant_sale_payment_event",
      {
        p_provider_event_id:providerEventId,
        p_provider_order_id:orderId,
        p_provider_payment_id:paymentId,
        p_event_type:"order."+status,
        p_provider_status:status,
        p_amount_cents:amountCents,
        p_currency:"BRL",
        p_occurred_at:occurredAt(body,order),
        // The durable evidence hash is derived from the authoritative provider
        // snapshot, not the delivery wrapper, so repeated webhook deliveries of
        // the same financial state collapse idempotently.
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
      provider:"mercadopago",
      orderId,
      salePaymentStatus:applied?.status??status,
      tamaoReceivesSaleProceeds:false
    },200);
  }catch(error){
    console.error(
      "merchant-sale-payment-webhook-mercadopago failed",
      error instanceof Error?error.message:String(error)
    );
    return json({error:"MERCHANT_PAYMENT_WEBHOOK_FAILED"},500);
  }
});
