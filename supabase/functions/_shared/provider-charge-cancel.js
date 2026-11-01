import {
  mercadoPagoConfigured,
  mercadoPagoFetch,
  readMercadoPagoJson,
  moneyToCents
} from "./mercadopago.js";

const WOOVI_ALLOWED_BASES=new Set([
  "https://api.woovi.com",
  "https://api.woovi-sandbox.com"
]);
const PROVIDER_CANCEL_TIMEOUT_MS=4500;

function wooviSettings(){
  const appId=String(Deno.env.get("WOOVI_APP_ID")??"").trim();
  const apiBase=String(
    Deno.env.get("WOOVI_API_BASE_URL")??"https://api.woovi.com"
  ).trim().replace(/\/$/,"");
  return {
    appId,
    apiBase,
    configured:appId.length>=12&&WOOVI_ALLOWED_BASES.has(apiBase)
  };
}

async function cancelWooviCharge(correlationId){
  const settings=wooviSettings();
  if(!settings.configured){
    return {ok:false,reason:"WOOVI_CANCEL_NOT_CONFIGURED",httpStatus:null};
  }

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),PROVIDER_CANCEL_TIMEOUT_MS);
  try{
    const response=await fetch(
      settings.apiBase+"/api/v1/charge/"+encodeURIComponent(correlationId),
      {
        method:"DELETE",
        headers:{
          "Accept":"application/json",
          "Authorization":settings.appId
        },
        signal:controller.signal
      }
    );
    try{await response.body?.cancel()}catch{}
    return {
      ok:response.status===200,
      reason:response.status===200?null:"WOOVI_CANCEL_HTTP_"+response.status,
      httpStatus:response.status
    };
  }catch(error){
    return {
      ok:false,
      reason:error instanceof Error
        ?"WOOVI_CANCEL_"+error.name.toUpperCase()
        :"WOOVI_CANCEL_FAILED",
      httpStatus:null
    };
  }finally{
    clearTimeout(timer);
  }
}

async function fetchMercadoPagoOrder(accessToken,providerChargeId){
  const response=await mercadoPagoFetch(
    "/v1/orders/"+encodeURIComponent(providerChargeId),
    {accessToken,timeoutMs:PROVIDER_CANCEL_TIMEOUT_MS}
  );
  const data=await readMercadoPagoJson(response);
  return {response,data};
}

// A terminal-looking Order is not proof that its individual Pix was
// cancelled. A single paid/foreign/ambiguous transaction must quarantine
// cancellation instead of letting a stale Order state hide received money.
function mercadoPagoPixCancelEvidence(order,expectedAmountCents){
  const payments=order?.transactions?.payments;
  if(!Array.isArray(payments)||payments.length!==1){
    return {ok:false,reason:"MERCADOPAGO_CANCEL_PIX_NOT_UNIQUE"};
  }
  const payment=payments[0];
  const method=payment?.payment_method??{};
  const expected=Number(expectedAmountCents);
  const currencies=[order?.currency_id,order?.currency]
    .filter(x=>x!=null).map(x=>String(x).toUpperCase());
  const receivedTotal=order?.total_paid_amount==null
    ?0:Number(order.total_paid_amount);
  if(!String(payment?.id??"").trim()
    ||moneyToCents(payment?.amount)!==expected
    ||String(method.id??"").toLowerCase()!=="pix"
    ||String(method.type??"").toLowerCase()!=="bank_transfer"
    ||currencies.some(x=>x!=="BRL")
    ||!Number.isFinite(receivedTotal)||receivedTotal<0
    ||order?.live_mode===false||payment?.live_mode===false){
    return {ok:false,reason:"MERCADOPAGO_CANCEL_PIX_BINDING_MISMATCH"};
  }
  if(Array.isArray(order?.transactions?.refunds)&&order.transactions.refunds.length>0){
    return {ok:false,reason:"MERCADOPAGO_CANCEL_REFUND_REVIEW_REQUIRED"};
  }
  const orderStatus=String(order?.status??"").trim().toLowerCase();
  const paymentStatus=String(payment?.status??"").trim().toLowerCase();
  const details=[
    String(order?.status_detail??"").trim().toLowerCase(),
    String(payment?.status_detail??"").trim().toLowerCase()
  ];
  const received=["processed","approved","refunded","partially_refunded",
    "charged_back","chargeback","disputed","in_mediation","reimbursed"];
  if(received.includes(orderStatus)||received.includes(paymentStatus)
    ||details.some(x=>received.includes(x))
    ||Number(order?.total_paid_amount??0)>0){
    return {ok:false,reason:"MERCADOPAGO_PAYMENT_ALREADY_RECEIVED"};
  }
  // Failed or reversed statuses are not a clean prepaid charge either.
  if(details.some(x=>["failed","canceled","cancelled","expired"].includes(x))
    &&!["canceled","cancelled","expired"].includes(orderStatus)){
    return {ok:false,reason:"MERCADOPAGO_CANCEL_STATUS_CONFLICT"};
  }
  if(["canceled","cancelled","expired"].includes(orderStatus)){
    if(!["canceled","cancelled","expired","failed"].includes(paymentStatus)){
      return {ok:false,reason:"MERCADOPAGO_CANCEL_STATUS_CONFLICT"};
    }
    return {ok:true,terminal:true};
  }
  if(["action_required","processing"].includes(orderStatus)
    &&["pending","in_process","action_required","processing"].includes(paymentStatus)){
    return {ok:true,terminal:false};
  }
  return {ok:false,reason:"MERCADOPAGO_CANCEL_STATUS_CONFLICT"};
}

async function cancelMercadoPagoCharge(providerChargeId,correlationId,amountCents){
  const accessToken=String(Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")??"").trim();
  if(!mercadoPagoConfigured(accessToken)){
    return {ok:false,reason:"MERCADOPAGO_CANCEL_NOT_CONFIGURED",httpStatus:null};
  }
  const orderId=String(providerChargeId??"").trim();
  const expectedCorrelation=String(correlationId??"").trim();
  const expectedAmount=Number(amountCents);
  if(!orderId||!expectedCorrelation||!Number.isSafeInteger(expectedAmount)||expectedAmount<=0){
    return {ok:false,reason:"MERCADOPAGO_CANCEL_IDENTITY_MISSING",httpStatus:null};
  }

  try{
    let {response,data}=await fetchMercadoPagoOrder(accessToken,orderId);
    if(!response.ok){
      return {
        ok:false,
        reason:"MERCADOPAGO_CANCEL_LOOKUP_HTTP_"+response.status,
        httpStatus:response.status
      };
    }

    const providerCorrelation=String(data?.external_reference??"").trim();
    const providerAmount=moneyToCents(data?.total_amount);
    if(String(data?.id??"").trim()!==orderId
      ||providerCorrelation!==expectedCorrelation||providerAmount!==expectedAmount){
      return {ok:false,reason:"MERCADOPAGO_CANCEL_BINDING_MISMATCH",httpStatus:409};
    }

    const verified=mercadoPagoPixCancelEvidence(data,expectedAmount);
    if(!verified.ok){
      return {ok:false,reason:verified.reason,httpStatus:409};
    }
    if(verified.terminal){
      return {ok:true,reason:null,httpStatus:200};
    }

    const cancel=await mercadoPagoFetch(
      "/v1/orders/"+encodeURIComponent(orderId)+"/cancel",
      {
        accessToken,
        method:"POST",
        idempotencyKey:"billing-cancel-"+expectedCorrelation,
        timeoutMs:PROVIDER_CANCEL_TIMEOUT_MS
      }
    );
    try{await readMercadoPagoJson(cancel)}catch{}
    if(!cancel.ok&&cancel.status!==409){
      return {
        ok:false,
        reason:"MERCADOPAGO_CANCEL_HTTP_"+cancel.status,
        httpStatus:cancel.status
      };
    }

    ({response,data}=await fetchMercadoPagoOrder(accessToken,orderId));
    if(!response.ok){
      return {
        ok:false,
        reason:"MERCADOPAGO_CANCEL_VERIFY_HTTP_"+response.status,
        httpStatus:response.status
      };
    }
    if(
      String(data?.id??"").trim()!==orderId
      ||String(data?.external_reference??"").trim()!==expectedCorrelation
      ||moneyToCents(data?.total_amount)!==expectedAmount
    ){
      return {ok:false,reason:"MERCADOPAGO_CANCEL_VERIFY_MISMATCH",httpStatus:409};
    }

    const afterCancel=mercadoPagoPixCancelEvidence(data,expectedAmount);
    if(!afterCancel.ok){
      return {ok:false,reason:afterCancel.reason,httpStatus:409};
    }
    if(afterCancel.terminal){
      return {ok:true,reason:null,httpStatus:200};
    }
    return {ok:false,reason:"MERCADOPAGO_CANCEL_NOT_CONFIRMED",httpStatus:409};
  }catch(error){
    return {
      ok:false,
      reason:error instanceof Error
        ?"MERCADOPAGO_CANCEL_"+error.name.toUpperCase()
        :"MERCADOPAGO_CANCEL_FAILED",
      httpStatus:null
    };
  }
}

export async function cancelProviderChargesForPaymentRequest(
  admin,
  paymentRequestId,
  {limit=8}={}
){
  const {data,error}=await admin
    .from("merchant_billing_provider_charges")
    .select("id,provider,correlation_id,provider_charge_id,amount_cents,last_error_code")
    .eq("payment_request_id",paymentRequestId)
    .eq("status","cancelled")
    .in("last_error_code",["PROVIDER_CANCEL_REQUIRED","PROVIDER_CANCEL_FAILED"])
    .order("updated_at",{ascending:true})
    .limit(limit);

  if(error)throw error;

  const rows=data??[];
  let cancelled=0;
  let failed=0;
  const results=[];

  for(const charge of rows){
    let outcome;
    if(charge.provider==="woovi"){
      outcome=await cancelWooviCharge(String(charge.correlation_id??""));
    }else if(charge.provider==="mercadopago"){
      outcome=await cancelMercadoPagoCharge(
        charge.provider_charge_id,
        charge.correlation_id,
        charge.amount_cents
      );
    }else{
      outcome={ok:false,reason:"UNSUPPORTED_PROVIDER_CANCEL",httpStatus:null};
    }

    const now=new Date().toISOString();
    const {error:updateError}=await admin
      .from("merchant_billing_provider_charges")
      .update({
        last_error_code:outcome.ok?null:"PROVIDER_CANCEL_FAILED",
        last_error_at:outcome.ok?null:now,
        updated_at:now
      })
      .eq("id",charge.id)
      .eq("status","cancelled");

    if(updateError){
      failed++;
      results.push({
        chargeId:charge.id,
        provider:charge.provider,
        ok:false,
        reason:"CANCEL_STATE_UPDATE_FAILED"
      });
    }else if(outcome.ok){
      cancelled++;
      results.push({
        chargeId:charge.id,
        provider:charge.provider,
        ok:true,
        reason:null
      });
    }else{
      failed++;
      results.push({
        chargeId:charge.id,
        provider:charge.provider,
        ok:false,
        reason:outcome.reason
      });
    }
  }

  return {
    attempted:rows.length,
    cancelled,
    failed,
    results
  };
}
