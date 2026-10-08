const ALLOWED_WOOVI_BASES=new Set([
  "https://api.woovi.com",
  "https://api.woovi-sandbox.com"
]);

function wooviProviderConfig(){
  const appId=String(Deno.env.get("WOOVI_APP_ID")??"").trim();
  const apiBase=String(
    Deno.env.get("WOOVI_API_BASE_URL")??"https://api.woovi.com"
  ).trim().replace(/\/$/,"");
  return {
    appId,
    apiBase,
    valid:appId.length>=12&&ALLOWED_WOOVI_BASES.has(apiBase)
  };
}

async function persistCancellationResult(admin:any,id:string,ok:boolean){
  const now=new Date().toISOString();
  const {error}=await admin
    .from("merchant_billing_provider_charges")
    .update({
      last_error_code:ok?null:"PROVIDER_CANCEL_FAILED",
      last_error_at:ok?null:now,
      updated_at:now
    })
    .eq("id",id)
    .eq("status","cancelled")
    .in("last_error_code",["PROVIDER_CANCEL_REQUIRED","PROVIDER_CANCEL_FAILED"]);
  if(error)throw error;
}

async function deleteWooviCharge(apiBase:string,appId:string,correlationId:string){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),4500);
  try{
    const response=await fetch(
      apiBase+"/api/v1/charge/"+encodeURIComponent(correlationId),
      {
        method:"DELETE",
        headers:{
          "Accept":"application/json",
          "Authorization":appId
        },
        signal:controller.signal
      }
    );
    try{await response.body?.cancel()}catch{}
    return response.ok;
  }catch{
    return false;
  }finally{
    clearTimeout(timer);
  }
}

export async function cancelWooviProviderCharges(
  admin:any,
  {
    paymentRequestId=null,
    merchantId=null,
    includeFailed=false,
    limit=10
  }:{
    paymentRequestId?:string|null,
    merchantId?:string|null,
    includeFailed?:boolean,
    limit?:number
  }={}
){
  if(!paymentRequestId&&!merchantId){
    return {attempted:0,cancelled:0,failed:0,skipped:true};
  }

  let query=admin
    .from("merchant_billing_provider_charges")
    .select("id,correlation_id,last_error_code")
    .eq("provider","woovi")
    .eq("status","cancelled")
    .in(
      "last_error_code",
      includeFailed
        ?["PROVIDER_CANCEL_REQUIRED","PROVIDER_CANCEL_FAILED"]
        :["PROVIDER_CANCEL_REQUIRED"]
    )
    .order("updated_at",{ascending:true})
    .limit(Math.max(1,Math.min(25,Number(limit)||10)));

  if(paymentRequestId)query=query.eq("payment_request_id",paymentRequestId);
  if(merchantId)query=query.eq("merchant_id",merchantId);

  const {data,error}=await query;
  if(error)throw error;

  const rows=data??[];
  if(!rows.length)return {attempted:0,cancelled:0,failed:0};

  const config=wooviProviderConfig();
  let cancelled=0;
  let failed=0;

  for(const row of rows){
    const correlationId=String(row.correlation_id??"").trim();
    const ok=config.valid&&correlationId.length>=6
      ?await deleteWooviCharge(config.apiBase,config.appId,correlationId)
      :false;

    try{
      await persistCancellationResult(admin,String(row.id),ok);
    }catch(error){
      console.error(
        "woovi cancellation state persistence failed",
        String(error instanceof Error?error.message:error)
      );
      failed++;
      continue;
    }

    if(ok)cancelled++;
    else failed++;
  }

  return {
    attempted:rows.length,
    cancelled,
    failed,
    providerConfigured:config.valid
  };
}
