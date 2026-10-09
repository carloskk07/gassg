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
    if(providerCorrelation!==expectedCorrelation||providerAmount!==expectedAmount){
      return {ok:false,reason:"MERCADOPAGO_CANCEL_BINDING_MISMATCH",httpStatus:409};
    }

    let status=String(data?.status??"").trim().toLowerCase();
    const totalPaid=Number(data?.total_paid_amount??0);
    if(["processed","approved"].includes(status)||totalPaid>0){
      return {ok:false,reason:"MERCADOPAGO_PAYMENT_ALREADY_RECEIVED",httpStatus:409};
    }
    if(["canceled","cancelled","expired","refunded"].includes(status)){
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
      String(data?.external_reference??"").trim()!==expectedCorrelation
      ||moneyToCents(data?.total_amount)!==expectedAmount
    ){
      return {ok:false,reason:"MERCADOPAGO_CANCEL_VERIFY_MISMATCH",httpStatus:409};
    }

    status=String(data?.status??"").trim().toLowerCase();
    if(["canceled","cancelled","expired","refunded"].includes(status)){
      return {ok:true,reason:null,httpStatus:200};
    }
    if(["processed","approved"].includes(status)||Number(data?.total_paid_amount??0)>0){
      return {ok:false,reason:"MERCADOPAGO_PAYMENT_ALREADY_RECEIVED",httpStatus:409};
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
