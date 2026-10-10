import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  DomainError,
  readJsonBody,
  enforceApiQuota,
  requestFingerprint
} from "../_shared/domain.js";
import {
  decryptPaymentSecret,
  paymentEncryptionConfigured
} from "../_shared/payment-secrets.js";
import {
  mercadoPagoFetch,
  readMercadoPagoJson,
  safeMercadoPagoUrl,
  moneyToCents
} from "../_shared/mercadopago.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const publishableKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const PUBLISHABLE_KEY=publishableKeys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const CUSTOMER_ALLOWED_ORIGIN=(Deno.env.get("CUSTOMER_ALLOWED_ORIGIN")??"").trim();
const CUSTOMER_ORIGINS=new Set([
  "https://tamao.com.br",
  "https://tamao-sg-cliente.pages.dev",
  CUSTOMER_ALLOWED_ORIGIN
].filter(Boolean));
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function originAllowed(origin:string|null){
  if(!origin)return true;
  if(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return true;
  return CUSTOMER_ORIGINS.has(origin);
}
function cors(origin:string|null){
  const allowed=origin&&originAllowed(origin)?origin:"https://tamao.com.br";
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
  return data.user;
}
function idempotencyKey(req:Request){
  const key=String(req.headers.get("Idempotency-Key")??"").trim();
  if(key.length<12||key.length>120||!/^[A-Za-z0-9._:-]+$/.test(key)){
    throw new DomainError(
      "INVALID_IDEMPOTENCY_KEY",
      "Chave idempotente obrigatória.",
      400
    );
  }
  return key;
}
function directPaymentsEnabled(){
  return String(Deno.env.get("MERCHANT_DIRECT_PAYMENTS_ENABLED")??"")
    .trim()==="1";
}
function encryptionKey(){
  const key=String(Deno.env.get("MERCHANT_PAYMENT_TOKEN_ENCRYPTION_KEY")??"").trim();
  if(!paymentEncryptionConfigured(key)){
    throw new DomainError(
      "MERCHANT_PAYMENT_ENCRYPTION_NOT_CONFIGURED",
      "Conexões de recebimento ainda não estão disponíveis.",
      503
    );
  }
  return key;
}
async function mercadoPagoSellerAccessToken(admin:any,merchantId:string,key:string){
  const {data,error}=await admin
    .from("merchant_payment_provider_accounts")
    .select("provider_account_id,status,access_token_ciphertext,access_token_nonce,token_expires_at,capabilities")
    .eq("merchant_id",merchantId)
    .eq("provider","mercadopago")
    .maybeSingle();
  if(error)throw error;
  if(
    !data
    ||data.status!=="active"
    ||data.capabilities?.directSalePaymentsEnabled!==true
    ||!data.access_token_ciphertext
    ||!data.access_token_nonce
  ){
    throw new DomainError(
      "MERCHANT_DIRECT_PAYMENT_NOT_ENABLED",
      "Esta revenda ainda não habilitou pagamento online direto.",
      409
    );
  }
  const expiry=Date.parse(String(data.token_expires_at??""));
  if(Number.isFinite(expiry)&&expiry<=Date.now()+5*60_000){
    throw new DomainError(
      "MERCHANT_PAYMENT_CONNECTION_REFRESH_REQUIRED",
      "A conexão de recebimento da revenda precisa ser renovada.",
      409
    );
  }
  const accessToken=await decryptPaymentSecret(
    data.access_token_ciphertext,
    data.access_token_nonce,
    key,
    "provider-account:"+merchantId+":mercadopago:access"
  );
  return {
    accessToken,
    providerAccountId:String(data.provider_account_id??"").trim()
  };
}
function checkoutReturnUrl(orderId:string,result:string){
  const url=new URL("https://tamao.com.br/");
  url.searchParams.set("order",orderId);
  url.searchParams.set("payment",result);
  return url.toString();
}
async function recordAttemptIssue(
  admin:any,
  attemptId:string|null,
  errorCode:string,
  disposition:"terminal_rejected"|"review_required"
){
  if(!attemptId)return null;
  const {data,error}=await admin.rpc(
    "record_merchant_sale_payment_attempt_issue",
    {
      p_attempt_id:attemptId,
      p_error_code:errorCode,
      p_disposition:disposition
    }
  );
  if(error){
    console.error("merchant sale payment issue recording failed",String(error.message??error));
    return null;
  }
  return data??null;
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  if(!originAllowed(origin))return json({error:"ORIGIN_NOT_ALLOWED"},403,origin);
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405,origin);

  let admin:any=null;
  let preparedAttemptId:string|null=null;
  let providerRequestStarted=false;
  let issueRecorded=false;

  try{
    if(!directPaymentsEnabled()){
      throw new DomainError(
        "MERCHANT_DIRECT_PAYMENTS_NOT_LAUNCHED",
        "Pagamento online direto à revenda está temporariamente indisponível.",
        503
      );
    }
    const user=await authenticatedUser(req);
    const body=await readJsonBody(req);
    const orderId=String(body.orderId??"").trim();
    const requestedRouteId=body.paymentRouteId==null
      ?null:String(body.paymentRouteId).trim();
    if(!UUID_RE.test(orderId)){
      throw new DomainError("INVALID_ORDER","Pedido inválido.",400);
    }
    if(requestedRouteId&&!UUID_RE.test(requestedRouteId)){
      throw new DomainError("INVALID_PAYMENT_ROUTE","Forma de pagamento inválida.",400);
    }
    const key=idempotencyKey(req);
    admin=createClient(SUPABASE_URL,SECRET_KEY,{
      auth:{persistSession:false,autoRefreshToken:false}
    });
    await enforceApiQuota(admin,{
      userId:user.id,
      actionName:"order-payment-checkout",
      limit:15,
      windowSeconds:60
    });

    const {data:orderAuthority,error:orderAuthorityError}=await admin
      .from("orders")
      .select("id,merchant_id,payment_method,customer_id")
      .eq("id",orderId)
      .eq("customer_id",user.id)
      .maybeSingle();
    if(orderAuthorityError)throw orderAuthorityError;
    if(!orderAuthority?.merchant_id){
      throw new DomainError("ORDER_NOT_FOUND","Pedido não encontrado.",404);
    }

    let routeQuery=admin
      .from("merchant_payment_routes")
      .select("id,merchant_id,payment_method,provider,connection_id,channel,verification_mode,active,priority")
      .eq("merchant_id",orderAuthority.merchant_id)
      .eq("active",true)
      .in("verification_mode",["provider_api","device"]);
    if(requestedRouteId){
      routeQuery=routeQuery.eq("id",requestedRouteId);
    }else if(orderAuthority.payment_method==="card"){
      routeQuery=routeQuery.in("payment_method",["card","card_credit","card_debit"]);
    }else{
      routeQuery=routeQuery.eq("payment_method",orderAuthority.payment_method);
    }
    const {data:routeRows,error:routeError}=await routeQuery
      .order("priority",{ascending:true})
      .limit(10);
    if(routeError)throw routeError;
    const route=(routeRows??[])[0]??null;
    if(!route){
      throw new DomainError(
        "NO_AUTOMATED_PAYMENT_ROUTE",
        "Esta revenda aceita o pagamento, mas ainda não possui confirmação automática disponível para este meio.",
        409
      );
    }

    const {data:providerDefinition,error:providerDefinitionError}=await admin
      .from("payment_provider_catalog")
      .select("provider_key,display_name,adapter_status,connection_mode,verification_level")
      .eq("provider_key",route.provider)
      .maybeSingle();
    if(providerDefinitionError)throw providerDefinitionError;
    if(!providerDefinition||providerDefinition.adapter_status!=="implemented"){
      throw new DomainError(
        "PAYMENT_ADAPTER_NOT_IMPLEMENTED",
        "A confirmação automática ainda não está disponível para este provedor. Use outra forma de pagamento cadastrada pela revenda.",
        409
      );
    }

    const requestHash=await requestFingerprint(
      "merchant-sale-payment-checkout:v2",
      {orderId,paymentRouteId:route.id,provider:route.provider}
    );
    const {data:prepared,error:prepareError}=await admin.rpc(
      "prepare_merchant_sale_payment_attempt_v2",
      {
        p_actor_user_id:user.id,
        p_order_id:orderId,
        p_payment_route_id:route.id,
        p_idempotency_key:key,
        p_request_hash:requestHash
      }
    );
    if(prepareError){
      const message=String(prepareError.message??prepareError);
      if(message.includes("ORDER_NOT_FOUND")){
        throw new DomainError("ORDER_NOT_FOUND","Pedido não encontrado.",404);
      }
      if(message.includes("ORDER_NOT_PAYABLE")){
        throw new DomainError("ORDER_NOT_PAYABLE","O pedido ainda não pode receber pagamento online.",409);
      }
      if(message.includes("PAYMENT_ROUTE_NOT_AVAILABLE")||message.includes("ORDER_PAYMENT_ROUTE_MISMATCH")){
        throw new DomainError("NO_AUTOMATED_PAYMENT_ROUTE","A rota automática escolhida não está disponível para este pedido.",409);
      }
      if(message.includes("PAYMENT_ROUTE_NOT_AUTOMATED")||message.includes("PAYMENT_ROUTE_CONNECTION_REQUIRED")){
        throw new DomainError("NO_AUTOMATED_PAYMENT_ROUTE","Esta forma de pagamento exige confirmação manual ou uma conexão ativa.",409);
      }
      if(message.includes("MERCHANT_DIRECT_PAYMENT_NOT_ENABLED")){
        throw new DomainError("MERCHANT_DIRECT_PAYMENT_NOT_ENABLED","Esta revenda ainda não habilitou pagamento online direto.",409);
      }
      if(message.includes("MERCHANT_PAYMENT_PILOT_IN_FLIGHT")){
        throw new DomainError(
          "MERCHANT_PAYMENT_PILOT_IN_FLIGHT",
          "Esta revenda possui uma transação automática em validação neste provedor. Use outra forma de pagamento enquanto a confirmação é concluída.",
          409
        );
      }
      if(message.includes("IDEMPOTENCY_CONFLICT")){
        throw new DomainError("IDEMPOTENCY_CONFLICT","Esta tentativa já foi usada com outro pedido.",409);
      }
      throw prepareError;
    }

    const attemptId=String(prepared?.attemptId??"");
    const merchantId=String(prepared?.merchantId??"");
    const externalReference=String(prepared?.externalReference??"");
    const amountCents=Number(prepared?.amountCents??0);
    if(
      !UUID_RE.test(attemptId)
      ||!UUID_RE.test(merchantId)
      ||!UUID_RE.test(externalReference)
      ||!Number.isSafeInteger(amountCents)
      ||amountCents<=0
    ){
      throw new DomainError("SALE_PAYMENT_PREPARE_INVALID","Não foi possível preparar o pagamento.",503);
    }
    preparedAttemptId=attemptId;
    if(prepared?.status==="review_required"){
      issueRecorded=true;
      throw new DomainError(
        "MERCHANT_PAYMENT_REVIEW_REQUIRED",
        "Este pagamento está em revisão para evitar uma segunda tentativa automática antes de confirmar o resultado do provedor.",
        409
      );
    }
    if(prepared?.status==="approved"){
      return json({
        ok:true,
        alreadyPaid:true,
        attemptId,
        orderId,
        status:"approved"
      },200,origin);
    }
    const existingUrl=safeMercadoPagoUrl(prepared?.checkoutUrl);
    if(existingUrl&&["checkout_ready","pending"].includes(String(prepared?.status??""))){
      return json({
        ok:true,
        recovered:true,
        attemptId,
        orderId,
        checkoutUrl:existingUrl,
        expiresAt:prepared?.expiresAt??null
      },200,origin);
    }

    const providerKey=String(prepared?.provider??"").trim().toLowerCase();
    if(providerKey!=="mercadopago"){
      throw new DomainError(
        "PAYMENT_ADAPTER_NOT_IMPLEMENTED",
        "O checkout automático ainda não está disponível para este provedor.",
        409
      );
    }
    const secret=encryptionKey();
    const seller=await mercadoPagoSellerAccessToken(admin,merchantId,secret);
    const {data:orderMeta,error:orderError}=await admin
      .from("orders")
      .select("public_code,supplier_name_snapshot")
      .eq("id",orderId)
      .eq("customer_id",user.id)
      .maybeSingle();
    if(orderError)throw orderError;
    if(!orderMeta)throw new DomainError("ORDER_NOT_FOUND","Pedido não encontrado.",404);

    const total=(amountCents/100).toFixed(2);
    providerRequestStarted=true;
    let response:Response;
    try{
      response=await mercadoPagoFetch("/v1/orders",{
      accessToken:seller.accessToken,
      method:"POST",
      idempotencyKey:externalReference,
      body:{
        type:"online",
        processing_mode:"manual",
        capture_mode:"automatic_async",
        total_amount:total,
        external_reference:externalReference,
        expiration_time:"P1D",
        description:"Pedido TAMÃO "+String(orderMeta.public_code??orderId).slice(0,32),
        config:{
          online:{
            success_url:checkoutReturnUrl(orderId,"success"),
            failure_url:checkoutReturnUrl(orderId,"failure"),
            pending_url:checkoutReturnUrl(orderId,"pending"),
            auto_return:"all"
          }
        }
      }
    });
    }catch(providerError){
      await recordAttemptIssue(
        admin,
        preparedAttemptId,
        "PROVIDER_CHECKOUT_OUTCOME_UNKNOWN",
        "review_required"
      );
      issueRecorded=true;
      throw providerError;
    }
    const provider=await readMercadoPagoJson(response);
    if(!response.ok){
      await recordAttemptIssue(
        admin,
        preparedAttemptId,
        "PROVIDER_CHECKOUT_REJECTED",
        "terminal_rejected"
      );
      issueRecorded=true;
      console.error(
        "merchant sale checkout provider failure",
        "HTTP_"+response.status
      );
      throw new DomainError(
        "MERCHANT_CHECKOUT_PROVIDER_UNAVAILABLE",
        "Não foi possível abrir o checkout da revenda agora.",
        503
      );
    }

    const providerOrderId=String(provider?.id??"").trim();
    const checkoutUrl=safeMercadoPagoUrl(provider?.checkout_url);
    const providerExternalReference=String(provider?.external_reference??"").trim();
    const providerAmount=moneyToCents(provider?.total_amount);
    const providerUserId=String(provider?.user_id??"").trim();
    if(
      providerOrderId.length<6
      ||!checkoutUrl
      ||providerExternalReference!==externalReference
      ||providerAmount!==amountCents
      ||!seller.providerAccountId
      ||providerUserId!==seller.providerAccountId
    ){
      await recordAttemptIssue(
        admin,
        preparedAttemptId,
        "PROVIDER_CHECKOUT_RESPONSE_MISMATCH",
        "review_required"
      );
      issueRecorded=true;
      throw new DomainError(
        "MERCHANT_CHECKOUT_PROVIDER_MISMATCH",
        "O checkout retornou dados divergentes e foi bloqueado para revisão.",
        503
      );
    }
    const expiresAt=new Date(Date.now()+86400_000).toISOString();
    const {data:committed,error:commitError}=await admin.rpc(
      "commit_merchant_sale_payment_checkout",
      {
        p_attempt_id:attemptId,
        p_provider_order_id:providerOrderId,
        p_checkout_url:checkoutUrl,
        p_expires_at:expiresAt
      }
    );
    if(commitError){
      await recordAttemptIssue(
        admin,
        preparedAttemptId,
        "PROVIDER_CHECKOUT_COMMIT_FAILED",
        "review_required"
      );
      issueRecorded=true;
      throw commitError;
    }

    return json({
      ok:true,
      attemptId,
      orderId,
      provider:providerKey,
      paymentRouteId:prepared?.paymentRouteId??route.id,
      verificationLevel:prepared?.verificationLevel??providerDefinition.verification_level,
      pilotMode:prepared?.pilotGuard===true,
      e2eValidated:prepared?.e2eValidated===true,
      fundsOwner:"merchant",
      status:committed?.status??"checkout_ready",
      checkoutUrl:committed?.checkoutUrl??checkoutUrl,
      expiresAt:committed?.expiresAt??expiresAt,
      tamaoReceivesSaleProceeds:false
    },200,origin);
  }catch(error){
    if(admin&&preparedAttemptId&&!issueRecorded){
      await recordAttemptIssue(
        admin,
        preparedAttemptId,
        providerRequestStarted
          ?"PROVIDER_CHECKOUT_OUTCOME_UNKNOWN"
          :"LOCAL_CHECKOUT_PREPARATION_FAILED",
        providerRequestStarted?"review_required":"terminal_rejected"
      );
      issueRecorded=true;
    }
    if(error instanceof DomainError){
      return json({error:error.code,message:error.message},error.status,origin);
    }
    console.error(
      "order-payment-checkout failed",
      error instanceof Error?error.message:String(error)
    );
    return json({
      error:"MERCHANT_CHECKOUT_UNAVAILABLE",
      message:"Não foi possível iniciar o pagamento online agora."
    },503,origin);
  }
});
