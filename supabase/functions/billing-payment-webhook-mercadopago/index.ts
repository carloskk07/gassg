import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { sha256Hex } from "../_shared/domain.js";
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
function safeOccurredAt(value:unknown){
  const parsed=Date.parse(String(value??""));
  const now=Date.now();
  if(Number.isFinite(parsed)&&parsed<=now+5*60_000&&parsed>=now-89*86400_000){
    return new Date(parsed).toISOString();
  }
  return new Date(now).toISOString();
}
function orderPayment(order:any){
  const payments=Array.isArray(order?.transactions?.payments)
    ?order.transactions.payments
    :[];
  return payments.find((p:any)=>
    String(p?.payment_method?.id??"").toLowerCase()==="pix"
    &&String(p?.payment_method?.type??"").toLowerCase()==="bank_transfer"
  )??payments[0]??null;
}
async function fetchOrder(accessToken:string,orderId:string){
  const response=await mercadoPagoFetch(
    "/v1/orders/"+encodeURIComponent(orderId),
    {accessToken}
  );
  const data=await readMercadoPagoJson(response);
  if(!response.ok){
    throw new Error("MERCADOPAGO_ORDER_LOOKUP_HTTP_"+response.status);
  }
  return data;
}
async function ingestOriginalPayment(
  admin:any,
  order:any,
  charge:any,
  occurredAt:string
){
  const orderId=String(order?.id??"").trim();
  const payment=orderPayment(order);
  const paymentId=String(payment?.id??"").trim();
  const amountCents=moneyToCents(order?.total_amount);
  if(!orderId||!paymentId||amountCents!==Number(charge.amount_cents)){
    throw new Error("MERCADOPAGO_ORDER_PAYMENT_MISMATCH");
  }
  const reconciliationKey="mp-order:"+orderId;
  const evidenceHash=await sha256Hex({
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
async function ingestRefunds(
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
    const evidenceHash=await sha256Hex({
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

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);

  const accessToken=String(Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")??"").trim();
  const webhookSecret=String(Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET")??"").trim();
  if(!mercadoPagoConfigured(accessToken)||webhookSecret.length<16){
    return json({error:"MERCADOPAGO_ADAPTER_NOT_CONFIGURED"},503);
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
    try{body=raw?JSON.parse(raw):{}}catch{return json({error:"INVALID_JSON"},400)}

    const url=new URL(req.url);
    const dataId=String(
      url.searchParams.get("data.id")
      ??body?.data?.id
      ??""
    ).trim();
    const signed=await verifyMercadoPagoWebhook(req,webhookSecret,dataId);
    if(!signed)return json({error:"INVALID_MERCADOPAGO_SIGNATURE"},401);

    const topic=String(
      url.searchParams.get("type")
      ??body?.type
      ??""
    ).trim().toLowerCase();
    if(topic!=="order"){
      return json({ok:true,ignored:true,reason:"UNSUPPORTED_TOPIC"},202);
    }
    if(dataId.length<6||dataId.length>180||/[\u0000-\u001f\u007f]/.test(dataId)){
      return json({error:"INVALID_ORDER_ID"},400);
    }

    const order=await fetchOrder(accessToken,dataId);
    const orderId=String(order?.id??"").trim();
    const externalReference=String(order?.external_reference??"").trim();
    if(orderId!==dataId){
      return json({error:"MERCADOPAGO_ORDER_ID_MISMATCH"},409);
    }
    if(!UUID_RE.test(externalReference)){
      return json({ok:true,ignored:true,reason:"FOREIGN_ORDER"},202);
    }

    const admin=createClient(SUPABASE_URL,SECRET_KEY,{
      auth:{persistSession:false,autoRefreshToken:false}
    });
    const {data:charge,error:chargeError}=await admin
      .from("merchant_billing_provider_charges")
      .select("id,payment_request_id,merchant_id,provider,correlation_id,provider_charge_id,amount_cents,currency,status")
      .eq("provider","mercadopago")
      .eq("correlation_id",externalReference)
      .maybeSingle();
    if(chargeError)throw chargeError;
    if(!charge){
      return json({ok:true,ignored:true,reason:"FOREIGN_ORDER_REFERENCE"},202);
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
      body?.date_created
      ??order?.last_updated_date
      ??order?.created_date
    );

    if(["processed","refunded"].includes(status)){
      const original=await ingestOriginalPayment(admin,order,charge,occurredAt);
      const refunds=await ingestRefunds(
        admin,order,original.reconciliationKey,occurredAt
      );
      return json({
        ok:true,
        provider:"mercadopago",
        orderId,
        status,
        statusDetail,
        paymentResult:original.data,
        refundsProcessed:refunds.length
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
      return json({ok:true,provider:"mercadopago",orderId,status,statusDetail},200);
    }

    return json({
      ok:true,
      provider:"mercadopago",
      orderId,
      status,
      statusDetail,
      pending:true
    },200);
  }catch(error){
    console.error(
      "billing-payment-webhook-mercadopago failed",
      error instanceof Error?error.message:String(error)
    );
    return json({error:"MERCADOPAGO_WEBHOOK_FAILED"},500);
  }
});
