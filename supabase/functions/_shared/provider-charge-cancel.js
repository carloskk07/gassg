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

export async function cancelProviderChargesForPaymentRequest(
  admin,
  paymentRequestId,
  {
    limit=8,
    actorKind="system",
    actorUserId=null
  }={}
){
  const {data,error}=await admin
    .from("merchant_billing_provider_charges")
    .select("id,provider,correlation_id,last_error_code")
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
    }else{
      outcome={ok:false,reason:"UNSUPPORTED_PROVIDER_CANCEL",httpStatus:null};
    }

    const {data:auditResult,error:auditError}=await admin.rpc(
      "record_merchant_billing_provider_cancel_attempt",
      {
        p_charge_id:charge.id,
        p_actor_kind:actorKind,
        p_actor_user_id:actorUserId,
        p_success:outcome.ok===true,
        p_reason:outcome.ok?null:String(outcome.reason||"PROVIDER_CANCEL_FAILED"),
        p_http_status:outcome.httpStatus
      }
    );

    if(auditError){
      failed++;
      results.push({
        chargeId:charge.id,
        provider:charge.provider,
        ok:false,
        reason:"CANCEL_AUDIT_COMMIT_FAILED"
      });
    }else if(outcome.ok){
      cancelled++;
      results.push({
        chargeId:charge.id,
        provider:charge.provider,
        ok:true,
        reason:null,
        attemptNo:Number(auditResult?.attemptNo||0)
      });
    }else{
      failed++;
      results.push({
        chargeId:charge.id,
        provider:charge.provider,
        ok:false,
        reason:outcome.reason,
        attemptNo:Number(auditResult?.attemptNo||0)
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
