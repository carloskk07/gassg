import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  DomainError,
  assertPermanentMerchantUser,
  readJsonBody,
  enforceApiQuota,
  requestFingerprint
} from "../_shared/domain.js";
import { cancelProviderChargesForPaymentRequest } from "../_shared/provider-charge-cancel.js";
import {
  mercadoPagoConfigured,
  mercadoPagoFetch,
  readMercadoPagoJson,
  safeMercadoPagoUrl,
  mercadoPagoQrDataUri,
  moneyToCents
} from "../_shared/mercadopago.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const publishableKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const PUBLISHABLE_KEY=publishableKeys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const MERCHANT_ALLOWED_ORIGIN=(Deno.env.get("MERCHANT_ALLOWED_ORIGIN")??"").trim();
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
function billingProvider(){
  const provider=String(Deno.env.get("BILLING_PIX_PROVIDER")??"mercadopago")
    .trim().toLowerCase();
  if(!["mercadopago","woovi"].includes(provider)){
    throw new DomainError(
      "PIX_PROVIDER_INVALID",
      "O provedor Pix configurado no servidor é inválido.",
      503
    );
  }
  return provider;
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
function wooviBase(){
  const raw=String(Deno.env.get("WOOVI_API_BASE_URL")??"https://api.woovi.com")
    .trim()
    .replace(/\/$/,"");
  if(!WOOVI_BASES.has(raw)){
    throw new DomainError("WOOVI_API_BASE_INVALID","Ambiente Woovi inválido no servidor.",503);
  }
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
    }else if(!["woovi.com","www.woovi.com","woovi-sandbox.com","www.woovi-sandbox.com"].includes(host)){
      return null;
    }
    return url.toString();
  }catch{return null}
}
function bytesToBase64(bytes:Uint8Array){
  let binary="";
  const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk){
    binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+chunk,bytes.length)));
  }
  return btoa(binary);
}
async function wooviQrDataUri(value:unknown){
  const safe=safeWooviUrl(value,"image");
  if(!safe)return null;
  if(safe.startsWith("data:image/png;base64,"))return safe;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),WOOVI_TIMEOUT_MS);
  try{
    const res=await fetch(safe,{method:"GET",headers:{"Accept":"image/png"},signal:controller.signal});
    if(!res.ok)return null;
    const type=String(res.headers.get("content-type")??"").toLowerCase();
    if(!type.startsWith("image/png"))return null;
    const declared=Number(res.headers.get("content-length")??0);
    if(Number.isFinite(declared)&&declared>MAX_QR_IMAGE_BYTES)return null;
    const bytes=new Uint8Array(await res.arrayBuffer());
    if(!bytes.length||bytes.length>MAX_QR_IMAGE_BYTES)return null;
    return "data:image/png;base64,"+bytesToBase64(bytes);
  }catch{return null}
  finally{clearTimeout(timer)}
}
async function wooviFetch(url:string,init:RequestInit){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),WOOVI_TIMEOUT_MS);
  try{return await fetch(url,{...init,signal:controller.signal})}
  finally{clearTimeout(timer)}
}
async function readWooviJson(res:Response){
  const text=await res.text();
  if(text.length>250000)throw new Error("WOOVI_RESPONSE_TOO_LARGE");
  if(!text)return {};
  try{return JSON.parse(text)}catch{throw new Error("WOOVI_INVALID_JSON")}
}
function normalizeWooviCharge(data:any,correlationId:string,expectedAmountCents:number){
  const charge=data?.charge;
  if(!charge||typeof charge!=="object"||Array.isArray(charge))throw new Error("WOOVI_CHARGE_MISSING");
  const correlation=String(charge.correlationID??data?.correlationID??"").trim();
  const amount=Number(charge.value);
  const status=String(charge.status??"").trim().toUpperCase();
  const brCode=cleanText(charge.brCode??data?.brCode,8192);
  if(correlation!==correlationId)throw new Error("WOOVI_CORRELATION_MISMATCH");
  if(!Number.isSafeInteger(amount)||amount!==expectedAmountCents)throw new Error("WOOVI_AMOUNT_MISMATCH");
  if(!["ACTIVE","COMPLETED"].includes(status))throw new Error("WOOVI_CHARGE_NOT_ACTIVE");
  if(!brCode||brCode.length<20)throw new Error("WOOVI_BR_CODE_MISSING");
  const providerChargeId=cleanText(
    charge.globalID??charge.identifier??charge.transactionID??charge.paymentLinkID??charge.correlationID,
    240
  );
  if(!providerChargeId)throw new Error("WOOVI_CHARGE_ID_MISSING");
  return {
    provider:"woovi",
    status:status.toLowerCase(),
    correlationId:correlation,
    amountCents:amount,
    providerChargeId,
    providerTransactionId:cleanText(charge.transactionID??charge.identifier,240),
    brCode,
    qrCodeImage:safeWooviUrl(charge.qrCodeImage,"image"),
    qrCodeDataUri:null,
    paymentLinkUrl:safeWooviUrl(charge.paymentLinkUrl,"payment"),
    expiresAt:parseIso(charge.expiresDate)
  };
}
async function getWooviCharge(base:string,appId:string,correlationId:string,expectedAmountCents:number){
  const res=await wooviFetch(
    base+"/api/v1/charge/"+encodeURIComponent(correlationId),
    {method:"GET",headers:{"Accept":"application/json","Authorization":appId}}
  );
  if(!res.ok)return {found:false,status:res.status,data:await readWooviJson(res)};
  return {found:true,status:res.status,charge:normalizeWooviCharge(await readWooviJson(res),correlationId,expectedAmountCents)};
}
async function createWooviCharge(
  base:string,appId:string,correlationId:string,expectedAmountCents:number,comment:string
){
  const res=await wooviFetch(base+"/api/v1/charge",{
    method:"POST",
    headers:{"Accept":"application/json","Content-Type":"application/json","Authorization":appId},
    body:JSON.stringify({
      correlationID:correlationId,
      value:expectedAmountCents,
      comment:comment.slice(0,140),
      expiresIn:86400
    })
  });
  const data=await readWooviJson(res);
  if(!res.ok)return {ok:false,status:res.status,data};
  return {ok:true,status:res.status,charge:normalizeWooviCharge(data,correlationId,expectedAmountCents)};
}
function mpPayment(order:any){
  const payments=Array.isArray(order?.transactions?.payments)?order.transactions.payments:[];
  return payments.find((p:any)=>
    String(p?.payment_method?.id??"").toLowerCase()==="pix"
    &&String(p?.payment_method?.type??"").toLowerCase()==="bank_transfer"
  )??payments[0]??null;
}
function normalizeMercadoPagoOrder(order:any,correlationId:string,expectedAmountCents:number){
  const orderId=cleanText(order?.id,240);
  const externalReference=String(order?.external_reference??"").trim();
  const amountCents=moneyToCents(order?.total_amount);
  const status=String(order?.status??"").trim().toLowerCase();
  const payment=mpPayment(order);
  const paymentId=cleanText(payment?.id,240);
  const method=payment?.payment_method??{};
  const brCode=cleanText(method?.qr_code,8192);
  if(!orderId)throw new Error("MERCADOPAGO_ORDER_ID_MISSING");
  if(externalReference!==correlationId)throw new Error("MERCADOPAGO_CORRELATION_MISMATCH");
  if(amountCents!==expectedAmountCents)throw new Error("MERCADOPAGO_AMOUNT_MISMATCH");
  if(!paymentId)throw new Error("MERCADOPAGO_PAYMENT_ID_MISSING");
  if(String(method?.id??"").toLowerCase()!=="pix"
    ||String(method?.type??"").toLowerCase()!=="bank_transfer"){
    throw new Error("MERCADOPAGO_PAYMENT_METHOD_MISMATCH");
  }
  if(!["action_required","processing","processed"].includes(status)){
    throw new Error("MERCADOPAGO_ORDER_NOT_PAYABLE");
  }
  if(status!=="processed"&&(!brCode||brCode.length<20)){
    throw new Error("MERCADOPAGO_QR_NOT_READY");
  }
  return {
    provider:"mercadopago",
    status:"active",
    correlationId,
    amountCents,
    providerChargeId:orderId,
    providerTransactionId:paymentId,
    brCode:brCode??"",
    qrCodeImage:null,
    qrCodeDataUri:mercadoPagoQrDataUri(method?.qr_code_base64),
    paymentLinkUrl:safeMercadoPagoUrl(method?.ticket_url),
    expiresAt:new Date(Date.now()+86400_000).toISOString()
  };
}
async function createMercadoPagoOrder(
  accessToken:string,
  correlationId:string,
  expectedAmountCents:number,
  payerEmail:string
){
  const amount=(expectedAmountCents/100).toFixed(2);
  const response=await mercadoPagoFetch("/v1/orders",{
    accessToken,
    method:"POST",
    idempotencyKey:correlationId,
    body:{
      type:"online",
      total_amount:amount,
      external_reference:correlationId,
      processing_mode:"automatic",
      transactions:{
        payments:[{
          amount,
          payment_method:{id:"pix",type:"bank_transfer"},
          expiration_time:"P1D"
        }]
      },
      payer:{email:payerEmail}
    }
  });
  const data=await readMercadoPagoJson(response);
  if(!response.ok)return {ok:false,status:response.status,data};
  let order=data;
  for(let attempt=0;attempt<3;attempt++){
    try{
      return {ok:true,status:response.status,charge:normalizeMercadoPagoOrder(order,correlationId,expectedAmountCents)};
    }catch(error){
      if(!(error instanceof Error)||error.message!=="MERCADOPAGO_QR_NOT_READY")throw error;
      const orderId=String(order?.id??"").trim();
      if(!orderId)throw error;
      await new Promise((resolve)=>setTimeout(resolve,250*(attempt+1)));
      const lookup=await mercadoPagoFetch("/v1/orders/"+encodeURIComponent(orderId),{accessToken});
      order=await readMercadoPagoJson(lookup);
      if(!lookup.ok)throw new Error("MERCADOPAGO_ORDER_LOOKUP_FAILED");
    }
  }
  throw new Error("MERCADOPAGO_QR_NOT_READY");
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
function chargeComment(planKey:string|null,statementId:string|null,refundRecoveryId:string|null){
  return planKey
    ?"TAMÃO • pacote de crédito "+planKey
    :statementId
      ?"TAMÃO • fechamento "+String(statementId).slice(0,8)
      :"TAMÃO • recuperação de refund "+String(refundRecoveryId).slice(0,8);
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  if(!originAllowed(origin))return json({error:"ORIGIN_NOT_ALLOWED"},403,origin);
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405,origin);

  try{
    const provider=billingProvider();
    const mercadoPagoAccessToken=String(Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")??"").trim();
    const wooviAppId=String(Deno.env.get("WOOVI_APP_ID")??"").trim();
    if(
      (provider==="mercadopago"&&!mercadoPagoConfigured(mercadoPagoAccessToken))
      ||(provider==="woovi"&&wooviAppId.length<12)
    ){
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
    const refundRecoveryId=body.refundRecoveryId==null?null:String(body.refundRecoveryId).trim();

    if(!UUID_RE.test(merchantId))throw new DomainError("INVALID_MERCHANT","Revenda inválida.",400);
    const targetCount=[planKey,statementId,refundRecoveryId].filter((value)=>value!=null).length;
    if(targetCount!==1){
      throw new DomainError("PIX_CHARGE_TARGET_REQUIRED","Informe exatamente uma cobrança financeira.",400);
    }
    if(planKey!=null&&!/^[a-z][a-z0-9_]{1,39}$/.test(planKey)){
      throw new DomainError("INVALID_BILLING_PLAN","Pacote de crédito inválido.",400);
    }
    if(statementId!=null&&!UUID_RE.test(statementId)){
      throw new DomainError("INVALID_STATEMENT","Fechamento diário inválido.",400);
    }
    if(refundRecoveryId!=null&&!UUID_RE.test(refundRecoveryId)){
      throw new DomainError("INVALID_REFUND_RECOVERY","Obrigação de recuperação inválida.",400);
    }

    const key=idempotencyKey(req);
    const admin=createClient(SUPABASE_URL,SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    await enforceApiQuota(admin,{userId:user.id,actionName:"merchant-billing-pix",limit:30,windowSeconds:60});

    const requestHash=await requestFingerprint("merchant-billing-pix-charge",{
      merchantId,planKey,statementId,refundRecoveryId,provider
    });
    const {data:prepared,error:prepareError}=await admin.rpc(
      "merchant_billing_pix_charge_prepare_provider",
      {
        p_actor_user_id:user.id,
        p_merchant_id:merchantId,
        p_plan_key:planKey,
        p_statement_id:statementId,
        p_refund_recovery_id:refundRecoveryId,
        p_provider:provider,
        p_idempotency_key:key,
        p_request_hash:requestHash
      }
    );
    if(prepareError){
      const message=String(prepareError.message??prepareError);
      if(message.includes("MERCHANT_FINANCE_PERMISSION_DENIED")){
        throw new DomainError("MERCHANT_FINANCE_PERMISSION_DENIED","Somente owner ou gerente pode gerar cobranças Pix.",403);
      }
      if(message.includes("PACKAGE_REQUEST_ALREADY_PENDING")){
        throw new DomainError("PACKAGE_REQUEST_ALREADY_PENDING","Já existe outro pacote aguardando pagamento.",409);
      }
      if(message.includes("STATEMENT_NOT_PAYABLE")){
        throw new DomainError("STATEMENT_NOT_PAYABLE","Este fechamento já foi resolvido ou não possui saldo a pagar.",409);
      }
      if(message.includes("REFUND_RECOVERY_NOT_FOUND")){
        throw new DomainError("REFUND_RECOVERY_NOT_FOUND","A obrigação de recuperação não foi encontrada.",404);
      }
      if(message.includes("REFUND_RECOVERY_NOT_PAYABLE")){
        throw new DomainError("REFUND_RECOVERY_NOT_PAYABLE","Esta recuperação já foi resolvida ou não está mais disponível para pagamento.",409);
      }
      if(message.includes("IDEMPOTENCY_CONFLICT")){
        throw new DomainError("IDEMPOTENCY_CONFLICT","Esta tentativa já foi usada com outro conteúdo.",409);
      }
      throw prepareError;
    }

    const chargeId=String(prepared?.chargeId??"");
    const correlationId=String(prepared?.correlationId??"");
    const paymentRequestId=String(prepared?.paymentRequestId??"");
    const expectedAmountCents=Number(prepared?.expectedAmountCents??0);
    if(
      !UUID_RE.test(chargeId)
      ||!UUID_RE.test(paymentRequestId)
      ||!UUID_RE.test(correlationId)
      ||!Number.isSafeInteger(expectedAmountCents)
      ||expectedAmountCents<=0
    ){
      throw new DomainError("PIX_CHARGE_PREPARE_INVALID","O servidor não conseguiu preparar a cobrança Pix.",503);
    }

    const {data:existing,error:existingError}=await admin
      .from("merchant_billing_provider_charges")
      .select("id,payment_request_id,provider,correlation_id,provider_charge_id,amount_cents,status,br_code,qr_code_data_uri,payment_link_url,expires_at,completed_at,paid_amount_cents,end_to_end_id")
      .eq("id",chargeId)
      .eq("merchant_id",merchantId)
      .maybeSingle();
    if(existingError)throw existingError;

    if(existing?.br_code&&["active","completed"].includes(existing.status)){
      return json({ok:true,paymentRequestId,recovered:true,charge:publicCharge(existing)},200,origin);
    }
    if(existing?.status==="completed"){
      return json({ok:true,paymentRequestId,recovered:true,charge:publicCharge(existing)},200,origin);
    }

    let providerCharge:any=null;
    let recovered=false;
    if(provider==="mercadopago"){
      const email=String(user.email??"").trim().toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
        throw new DomainError(
          "BILLING_PAYER_EMAIL_REQUIRED",
          "A conta da revenda precisa ter um e-mail válido para gerar o Pix.",
          409
        );
      }
      const created=await createMercadoPagoOrder(
        mercadoPagoAccessToken,
        correlationId,
        expectedAmountCents,
        email
      );
      if(!created.ok){
        await admin.rpc("merchant_billing_provider_charge_record_error",{
          p_charge_id:chargeId,
          p_error_code:"MERCADOPAGO_ORDER_CREATE_FAILED"
        });
        throw new DomainError(
          "PIX_CHARGE_CREATE_FAILED",
          "Não foi possível gerar o Pix agora. Tente novamente; a tentativa é idempotente.",
          503
        );
      }
      providerCharge=created.charge;
      recovered=existing?.provider_charge_id!=null;
    }else{
      const base=wooviBase();
      const found=await getWooviCharge(base,wooviAppId,correlationId,expectedAmountCents);
      if(found.found){
        providerCharge=found.charge;
        recovered=true;
      }else{
        const created=await createWooviCharge(
          base,wooviAppId,correlationId,expectedAmountCents,
          chargeComment(planKey,statementId,refundRecoveryId)
        );
        if(created.ok){
          providerCharge=created.charge;
        }else{
          const after=await getWooviCharge(base,wooviAppId,correlationId,expectedAmountCents);
          if(after.found){
            providerCharge=after.charge;
            recovered=true;
          }else{
            await admin.rpc("merchant_billing_provider_charge_record_error",{
              p_charge_id:chargeId,p_error_code:"WOOVI_CHARGE_CREATE_FAILED"
            });
            throw new DomainError(
              "PIX_CHARGE_CREATE_FAILED",
              "Não foi possível gerar o Pix agora. Tente novamente; a tentativa é idempotente.",
              503
            );
          }
        }
      }
    }

    const qr=provider==="woovi"
      ?await wooviQrDataUri(providerCharge.qrCodeImage)
      :providerCharge.qrCodeDataUri;

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
        p_status:"active"
      }
    );
    if(commitError)throw commitError;

    if(committed?.status==="cancelled"){
      try{await cancelProviderChargesForPaymentRequest(admin,paymentRequestId)}
      catch(cancelError){console.error("late Pix creation cancellation failed",String(cancelError))}
      throw new DomainError(
        "PIX_REQUEST_CANCELLED",
        "A solicitação financeira foi cancelada enquanto o Pix era gerado. O QR não deve ser usado.",
        409
      );
    }

    return json({
      ok:true,
      provider,
      paymentRequestId,
      recovered,
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
    console.error("merchant-billing-pix failed",error instanceof Error?error.message:String(error));
    return json({error:"PIX_CHARGE_UNAVAILABLE",message:"Não foi possível gerar a cobrança Pix agora."},503,origin);
  }
});
