import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  DomainError,
  assertPermanentMerchantUser,
  readJsonBody,
  enforceApiQuota,
  requestFingerprint
} from "../_shared/domain.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const publishableKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const PUBLISHABLE_KEY=publishableKeys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const MERCHANT_ALLOWED_ORIGIN=(Deno.env.get("MERCHANT_ALLOWED_ORIGIN")??"https://chama-sg-revenda.netlify.app").trim();
const MERCHANT_PRIMARY_ORIGINS=new Set([
  "https://tamao-sg-revenda.pages.dev",
  "https://parceiro.tamao.com.br",
  MERCHANT_ALLOWED_ORIGIN
].filter(Boolean));
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WOOVI_BASES=new Set([
  "https://api.woovi.com",
  "https://api.woovi-sandbox.com"
]);
const WOOVI_TIMEOUT_MS=8000;
const MAX_QR_IMAGE_BYTES=260000;

function originAllowed(origin:string|null){
  if(!origin)return true;
  if(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return true;
  return MERCHANT_PRIMARY_ORIGINS.has(origin);
}
function cors(origin:string|null){
  const allowed=origin&&originAllowed(origin)?origin:"https://tamao-sg-revenda.pages.dev";
  return {
    "Access-Control-Allow-Origin":allowed,
    "Access-Control-Allow-Headers":"authorization, apikey, content-type, idempotency-key",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Vary":"Origin"
  };
}
function json(body:unknown,status=200,origin:string|null=null){
  return new Response(JSON.stringify(body),{
    status,
    headers:{...cors(origin),"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
  });
}
async function authenticatedUser(req:Request){
  const authHeader=req.headers.get("Authorization");
  if(!authHeader?.startsWith("Bearer ")){
    throw new DomainError("UNAUTHORIZED","Autenticação obrigatória.",401);
  }
  const token=authHeader.slice("Bearer ".length);
  const client=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{
    auth:{persistSession:false,autoRefreshToken:false}
  });
  const {data,error}=await client.auth.getUser(token);
  if(error||!data.user){
    throw new DomainError("UNAUTHORIZED","Sessão inválida ou expirada.",401);
  }
  return assertPermanentMerchantUser(data.user);
}
function idempotencyKey(req:Request){
  const key=String(req.headers.get("Idempotency-Key")??"").trim();
  if(key.length<12||key.length>120||!/^[A-Za-z0-9._:-]+$/.test(key)){
    throw new DomainError(
      "INVALID_IDEMPOTENCY_KEY",
      "Chave idempotente obrigatória para gerar a cobrança Pix.",
      400
    );
  }
  return key;
}
function wooviBase(){
  const raw=String(Deno.env.get("WOOVI_API_BASE_URL")??"https://api.woovi.com")
    .trim()
    .replace(/\/$/,"");
  if(!WOOVI_BASES.has(raw)){
    throw new DomainError(
      "WOOVI_API_BASE_INVALID",
      "Ambiente Woovi inválido no servidor.",
      503
    );
  }
  return raw;
}
function parseIso(value:unknown){
  const raw=String(value??"").trim();
  if(!raw||!Number.isFinite(Date.parse(raw)))return null;
  return new Date(raw).toISOString();
}
function cleanText(value:unknown,max:number){
  const raw=String(value??"").trim();
  if(!raw||raw.length>max||/[\u0000-\u001f\u007f]/.test(raw))return null;
  return raw;
}
function safeWooviUrl(value:unknown,kind:"image"|"payment"){
  const raw=String(value??"").trim();
  if(!raw)return null;
  if(kind==="image"&&raw.startsWith("data:image/png;base64,")){
    return raw.length<=600000?raw:null;
  }
  try{
    const url=new URL(raw);
    if(url.protocol!=="https:"||url.username||url.password)return null;
    const host=url.hostname.toLowerCase();
    if(kind==="image"){
      if(!["api.woovi.com","api.woovi-sandbox.com"].includes(host))return null;
    }else{
      if(!["woovi.com","www.woovi.com","woovi-sandbox.com","www.woovi-sandbox.com"].includes(host))return null;
    }
    return url.toString();
  }catch{
    return null;
  }
}
function bytesToBase64(bytes:Uint8Array){
  let binary="";
  const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk){
    binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+chunk,bytes.length)));
  }
  return btoa(binary);
}
async function qrDataUri(value:unknown){
  const safe=safeWooviUrl(value,"image");
  if(!safe)return null;
  if(safe.startsWith("data:image/png;base64,"))return safe;

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),WOOVI_TIMEOUT_MS);
  try{
    const res=await fetch(safe,{
      method:"GET",
      headers:{"Accept":"image/png"},
      signal:controller.signal
    });
    if(!res.ok)return null;
    const type=String(res.headers.get("content-type")??"").toLowerCase();
    if(!type.startsWith("image/png"))return null;
    const declared=Number(res.headers.get("content-length")??0);
    if(Number.isFinite(declared)&&declared>MAX_QR_IMAGE_BYTES)return null;
    const bytes=new Uint8Array(await res.arrayBuffer());
    if(!bytes.length||bytes.length>MAX_QR_IMAGE_BYTES)return null;
    return "data:image/png;base64,"+bytesToBase64(bytes);
  }catch{
    return null;
  }finally{
    clearTimeout(timer);
  }
}
async function wooviFetch(url:string,init:RequestInit){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),WOOVI_TIMEOUT_MS);
  try{
    return await fetch(url,{...init,signal:controller.signal});
  }finally{
    clearTimeout(timer);
  }
}
async function readWooviJson(res:Response){
  const text=await res.text();
  if(text.length>250000)throw new Error("WOOVI_RESPONSE_TOO_LARGE");
  if(!text)return {};
  try{return JSON.parse(text)}catch{throw new Error("WOOVI_INVALID_JSON")}
}
function normalizeCharge(data:any,correlationId:string,expectedAmountCents:number){
  const charge=data?.charge;
  if(!charge||typeof charge!=="object"||Array.isArray(charge)){
    throw new Error("WOOVI_CHARGE_MISSING");
  }
  const correlation=String(charge.correlationID??data?.correlationID??"").trim();
  const amount=Number(charge.value);
  const status=String(charge.status??"").trim().toUpperCase();
  const brCode=cleanText(charge.brCode??data?.brCode,8192);
  if(correlation!==correlationId)throw new Error("WOOVI_CORRELATION_MISMATCH");
  if(!Number.isSafeInteger(amount)||amount!==expectedAmountCents){
    throw new Error("WOOVI_AMOUNT_MISMATCH");
  }
  if(!["ACTIVE","COMPLETED"].includes(status))throw new Error("WOOVI_CHARGE_NOT_ACTIVE");
  if(!brCode||brCode.length<20)throw new Error("WOOVI_BR_CODE_MISSING");

  const providerChargeId=cleanText(
    charge.globalID
      ??charge.identifier
      ??charge.transactionID
      ??charge.paymentLinkID
      ??charge.correlationID,
    240
  );
  if(!providerChargeId)throw new Error("WOOVI_CHARGE_ID_MISSING");

  return {
    status:status.toLowerCase(),
    correlationId:correlation,
    amountCents:amount,
    providerChargeId,
    providerTransactionId:cleanText(charge.transactionID??charge.identifier,240),
    brCode,
    qrCodeImage:safeWooviUrl(charge.qrCodeImage,"image"),
    paymentLinkUrl:safeWooviUrl(charge.paymentLinkUrl,"payment"),
    expiresAt:parseIso(charge.expiresDate)
  };
}
async function getWooviCharge(base:string,appId:string,correlationId:string,expectedAmountCents:number){
  const res=await wooviFetch(
    base+"/api/v1/charge/"+encodeURIComponent(correlationId),
    {method:"GET",headers:{"Accept":"application/json","Authorization":appId}}
  );
  if(!res.ok){
    return {found:false,status:res.status,data:await readWooviJson(res)};
  }
  return {
    found:true,
    status:res.status,
    charge:normalizeCharge(await readWooviJson(res),correlationId,expectedAmountCents)
  };
}
async function createWooviCharge(
  base:string,
  appId:string,
  correlationId:string,
  expectedAmountCents:number,
  comment:string
){
  const res=await wooviFetch(base+"/api/v1/charge",{
    method:"POST",
    headers:{
      "Accept":"application/json",
      "Content-Type":"application/json",
      "Authorization":appId
    },
    body:JSON.stringify({
      correlationID:correlationId,
      value:expectedAmountCents,
      comment:comment.slice(0,140),
      expiresIn:86400
    })
  });
  const data=await readWooviJson(res);
  if(!res.ok)return {ok:false,status:res.status,data};
  return {
    ok:true,
    status:res.status,
    charge:normalizeCharge(data,correlationId,expectedAmountCents)
  };
}
function publicCharge(row:any){
  if(!row)return null;
  return {
    id:row.id,
    paymentRequestId:row.payment_request_id,
    provider:row.provider,
    correlationId:row.correlation_id,
    amountCents:Number(row.amount_cents||0),
    status:row.status,
    brCode:row.br_code??null,
    qrCodeDataUri:row.qr_code_data_uri??null,
    paymentLinkUrl:row.payment_link_url??null,
    expiresAt:row.expires_at??null,
    completedAt:row.completed_at??null,
    paidAmountCents:row.paid_amount_cents==null?null:Number(row.paid_amount_cents),
    endToEndId:row.end_to_end_id??null
  };
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  if(!originAllowed(origin))return json({error:"ORIGIN_NOT_ALLOWED"},403,origin);
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405,origin);

  try{
    const appId=String(Deno.env.get("WOOVI_APP_ID")??"").trim();
    if(appId.length<12){
      throw new DomainError(
        "PIX_PROVIDER_NOT_CONFIGURED",
        "A cobrança Pix automática ainda não está configurada.",
        503
      );
    }

    const user=await authenticatedUser(req);
    const body=await readJsonBody(req);
    const merchantId=String(body.merchantId??"").trim();
    const planKey=body.planKey==null?null:String(body.planKey).trim().toLowerCase();
    const statementId=body.statementId==null?null:String(body.statementId).trim();

    if(!UUID_RE.test(merchantId)){
      throw new DomainError("INVALID_MERCHANT","Revenda inválida.",400);
    }
    if((planKey==null)===(statementId==null)){
      throw new DomainError(
        "PIX_CHARGE_TARGET_REQUIRED",
        "Informe o pacote ou o fechamento que será pago.",
        400
      );
    }
    if(planKey!=null&&!/^[a-z][a-z0-9_]{1,39}$/.test(planKey)){
      throw new DomainError("INVALID_BILLING_PLAN","Pacote de crédito inválido.",400);
    }
    if(statementId!=null&&!UUID_RE.test(statementId)){
      throw new DomainError("INVALID_STATEMENT","Fechamento diário inválido.",400);
    }

    const key=idempotencyKey(req);
    const admin=createClient(SUPABASE_URL,SECRET_KEY,{
      auth:{persistSession:false,autoRefreshToken:false}
    });
    await enforceApiQuota(admin,{
      userId:user.id,
      actionName:"merchant-billing-pix",
      limit:30,
      windowSeconds:60
    });

    const requestHash=await requestFingerprint("merchant-billing-pix-charge",{
      merchantId,planKey,statementId
    });

    const {data:prepared,error:prepareError}=await admin.rpc(
      "merchant_billing_pix_charge_prepare",
      {
        p_actor_user_id:user.id,
        p_merchant_id:merchantId,
        p_plan_key:planKey,
        p_statement_id:statementId,
        p_idempotency_key:key,
        p_request_hash:requestHash
      }
    );
    if(prepareError){
      const message=String(prepareError.message??prepareError);
      if(message.includes("MERCHANT_FINANCE_PERMISSION_DENIED")){
        throw new DomainError(
          "MERCHANT_FINANCE_PERMISSION_DENIED",
          "Somente owner ou gerente pode gerar cobranças Pix.",
          403
        );
      }
      if(message.includes("PACKAGE_REQUEST_ALREADY_PENDING")){
        throw new DomainError(
          "PACKAGE_REQUEST_ALREADY_PENDING",
          "Já existe outro pacote aguardando pagamento.",
          409
        );
      }
      if(message.includes("STATEMENT_NOT_PAYABLE")){
        throw new DomainError(
          "STATEMENT_NOT_PAYABLE",
          "Este fechamento já foi resolvido ou não possui saldo a pagar.",
          409
        );
      }
      if(message.includes("IDEMPOTENCY_CONFLICT")){
        throw new DomainError(
          "IDEMPOTENCY_CONFLICT",
          "Esta tentativa já foi usada com outro conteúdo.",
          409
        );
      }
      throw prepareError;
    }

    const chargeId=String(prepared?.chargeId??"");
    const correlationId=String(prepared?.correlationId??"");
    const paymentRequestId=String(prepared?.paymentRequestId??"");
    const expectedAmountCents=Number(prepared?.expectedAmountCents??0);
    if(!UUID_RE.test(chargeId)
       ||!UUID_RE.test(paymentRequestId)
       ||!UUID_RE.test(correlationId)
       ||!Number.isSafeInteger(expectedAmountCents)
       ||expectedAmountCents<=0){
      throw new DomainError(
        "PIX_CHARGE_PREPARE_INVALID",
        "O servidor não conseguiu preparar a cobrança Pix.",
        503
      );
    }

    const {data:existing,error:existingError}=await admin
      .from("merchant_billing_provider_charges")
      .select("id,payment_request_id,provider,correlation_id,amount_cents,status,br_code,qr_code_data_uri,payment_link_url,expires_at,completed_at,paid_amount_cents,end_to_end_id")
      .eq("id",chargeId)
      .eq("merchant_id",merchantId)
      .maybeSingle();
    if(existingError)throw existingError;

    if(existing?.br_code&&["active","completed"].includes(existing.status)){
      return json({
        ok:true,
        paymentRequestId,
        recovered:true,
        charge:publicCharge(existing)
      },200,origin);
    }

    const base=wooviBase();
    let providerCharge:any=null;

    const recovered=await getWooviCharge(
      base,appId,correlationId,expectedAmountCents
    );
    if(recovered.found){
      providerCharge=recovered.charge;
    }else{
      const created=await createWooviCharge(
        base,
        appId,
        correlationId,
        expectedAmountCents,
        planKey
          ? "TAMÃO • pacote de crédito "+planKey
          : "TAMÃO • fechamento "+String(statementId).slice(0,8)
      );

      if(created.ok){
        providerCharge=created.charge;
      }else{
        const recoveredAfterCreate=await getWooviCharge(
          base,appId,correlationId,expectedAmountCents
        );
        if(recoveredAfterCreate.found){
          providerCharge=recoveredAfterCreate.charge;
        }else{
          await admin.rpc("merchant_billing_provider_charge_record_error",{
            p_charge_id:chargeId,
            p_error_code:"WOOVI_CHARGE_CREATE_FAILED"
          });
          throw new DomainError(
            "PIX_CHARGE_CREATE_FAILED",
            "Não foi possível gerar o Pix agora. Tente novamente; a tentativa é idempotente.",
            503
          );
        }
      }
    }

    const qr=await qrDataUri(providerCharge.qrCodeImage);

    const {data:committed,error:commitError}=await admin.rpc(
      "merchant_billing_provider_charge_commit",
      {
        p_charge_id:chargeId,
        p_provider_charge_id:providerCharge.providerChargeId,
        p_provider_transaction_id:providerCharge.providerTransactionId,
        p_br_code:providerCharge.brCode,
        p_qr_code_data_uri:qr,
        p_payment_link_url:providerCharge.paymentLinkUrl,
        p_expires_at:providerCharge.expiresAt,
        p_status:providerCharge.status
      }
    );
    if(commitError)throw commitError;

    return json({
      ok:true,
      paymentRequestId,
      recovered:recovered.found===true,
      charge:{
        id:committed?.chargeId,
        paymentRequestId:committed?.paymentRequestId,
        provider:committed?.provider,
        correlationId:committed?.correlationId,
        amountCents:Number(committed?.amountCents||0),
        status:committed?.status,
        brCode:committed?.brCode??null,
        qrCodeDataUri:committed?.qrCodeDataUri??null,
        paymentLinkUrl:committed?.paymentLinkUrl??null,
        expiresAt:committed?.expiresAt??null
      }
    },200,origin);
  }catch(error){
    if(error instanceof DomainError){
      return json({error:error.code,message:error.message},error.status,origin);
    }
    console.error("merchant-billing-pix failed",String(error));
    return json({
      error:"PIX_CHARGE_UNAVAILABLE",
      message:"Não foi possível gerar a cobrança Pix agora."
    },503,origin);
  }
});
