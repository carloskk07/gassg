import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {DomainError,readJsonBody,enforceApiQuota} from "../_shared/domain.js";
import {normalizePixCpf,assertCreatePayoutResponse,
  assertGetPayoutTransaction,serializePayoutBody} from "../_shared/network-payout-protocol.js";

// This function cannot auto-pay. Every outgoing Pix needs a superadmin
// authorization, an independent recipient proof and its own explicit click.
// Production is FAIL-CLOSED unless the Payouts-specific credentials and
// operator-approved feature gates have been configured separately.
const url=Deno.env.get("SUPABASE_URL")??"";
const publishable=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const secrets=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const anon=publishable.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const service=secrets.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const api="https://api.mercadopago.com";
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const sha64=/^[a-f0-9]{64}$/;
const allowed=new Set(["https://admin.tamao.com.br","https://tamao-sg-admin.pages.dev","https://tamao.com.br","https://parceiro.tamao.com.br"]);
function originAllowed(v:string|null){
  return !v||allowed.has(v)||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(v);
}
function cors(v:string|null){return {
  "Access-Control-Allow-Origin":v&&originAllowed(v)?v:"https://admin.tamao.com.br",
  "Access-Control-Allow-Headers":"authorization,apikey,content-type,idempotency-key",
  "Access-Control-Allow-Methods":"POST,OPTIONS","Vary":"Origin"
}}
function respond(body:unknown,status=200,origin:string|null=null){
  return new Response(JSON.stringify(body),{status,headers:{
    ...cors(origin),"Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store"
  }});
}
function requiredUuid(value:unknown,name:string){
  const x=String(value??"");
  if(!uuid.test(x))throw new DomainError("PAYOUT_INVALID_ID",name+" inválido.",400);
  return x;
}
function requiredSha(value:unknown){
  const x=String(value??"").trim().toLowerCase();
  if(!sha64.test(x))throw new DomainError("PAYOUT_INVALID_PROOF","Hash de comprovante SHA-256 obrigatório.",400);
  return x;
}
function reference(value:unknown){
  const x=String(value??"").trim().replace(/\s+/g," ");
  if(x.length<20||x.length>200||/[\u0000-\u001f\u007f<>]/.test(x))
    throw new DomainError("PAYOUT_INVALID_REFERENCE","Comprovante e referência verificável são obrigatórios.",400);
  return x;
}
function amountCents(value:unknown){
  const x=Number(value);
  if(!Number.isSafeInteger(x)||x<100||x>10000000)
    throw new DomainError("PAYOUT_INVALID_AMOUNT","Valor inválido para saque.",400);
  return x;
}
function idempotency(req:Request){
  const value=String(req.headers.get("Idempotency-Key")??"");
  if(!/^[A-Za-z0-9_-]{16,80}$/.test(value))
    throw new DomainError("PAYOUT_IDEMPOTENCY_REQUIRED","Chave idempotente obrigatória.",400);
  return value;
}
async function actor(req:Request){
  const header=req.headers.get("Authorization")||"";
  if(!header.startsWith("Bearer "))throw new DomainError("UNAUTHORIZED","Sessão obrigatória.",401);
  const pub=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await pub.auth.getUser(header.slice(7));
  if(error||!data.user||data.user.is_anonymous||!data.user.email_confirmed_at)
    throw new DomainError("UNAUTHORIZED","Autenticação permanente necessária.",401);
  return data.user.id;
}
function base64Bytes(value:string){
  const clean=value.trim().replace(/\s/g,"");
  if(!/^[a-z0-9+/]+={0,2}$/i.test(clean))throw Error("PAYOUT_CRYPTO_KEY_INVALID");
  const raw=atob(clean);
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
function bytesBase64(value:Uint8Array){
  let s="";for(let i=0;i<value.length;i++)s+=String.fromCharCode(value[i]);
  return btoa(s);
}
async function aesKey(){
  const raw=base64Bytes(Deno.env.get("NETWORK_PAYOUT_DATA_KEY_B64")??"");
  if(raw.length!==32)throw new DomainError("PAYOUT_ENCRYPTION_NOT_CONFIGURED",
    "A criptografia de destinatários não está configurada.",503);
  return crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["encrypt","decrypt"]);
}
async function hashKey(){
  const raw=base64Bytes(Deno.env.get("NETWORK_PAYOUT_HASH_KEY_B64")??"");
  if(raw.length!==32)throw new DomainError("PAYOUT_HASH_NOT_CONFIGURED",
    "A proteção dos identificadores não está configurada.",503);
  return crypto.subtle.importKey("raw",raw,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
}
async function recipientHash(cpf:string){
  const raw=await crypto.subtle.sign("HMAC",await hashKey(),new TextEncoder().encode("tamao-pix-cpf:"+cpf));
  return [...new Uint8Array(raw)].map(n=>n.toString(16).padStart(2,"0")).join("");
}
function validCpf(value:unknown){
  try{return normalizePixCpf(value)}
  catch{throw new DomainError("PAYOUT_PIX_CPF_INVALID","Chave CPF inválida ou inconsistente.",400)}
}
async function encryptCpf(cpf:string){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const payload=await crypto.subtle.encrypt({name:"AES-GCM",iv},await aesKey(),
    new TextEncoder().encode(cpf));
  return {encrypted:bytesBase64(new Uint8Array(payload)),iv:bytesBase64(iv)};
}
async function decryptCpf(encrypted:string,iv:string){
  const raw=await crypto.subtle.decrypt({name:"AES-GCM",iv:base64Bytes(iv)},await aesKey(),
    base64Bytes(encrypted));
  return validCpf(new TextDecoder().decode(raw));
}
function providerConfig(){
  if(Deno.env.get("NETWORK_PAYOUT_LIVE_ENABLED")!=="true"||
     Deno.env.get("NETWORK_PAYOUT_MP_REGISTRATION_CONFIRMED")!=="true")
    throw new DomainError("PAYOUT_PROVIDER_NOT_AUTHORIZED",
      "A execução real ainda não foi habilitada no provedor.",503);
  const token=(Deno.env.get("MERCADOPAGO_PAYOUTS_WRITE_ACCESS_TOKEN")??"").trim();
  const pem=(Deno.env.get("MERCADOPAGO_PAYOUTS_ED25519_PRIVATE_KEY_PEM")??"").trim();
  if(!token.startsWith("APP_USR-")||token.length<30||
     !pem.includes("-----BEGIN PRIVATE KEY-----")||
     !pem.includes("-----END PRIVATE KEY-----"))
    throw new DomainError("PAYOUT_CREDENTIALS_NOT_CONFIGURED",
      "Credenciais exclusivas de Payouts em produção não disponíveis.",503);
  return {token,pem};
}
function providerReadToken(){
  const token=(Deno.env.get("MERCADOPAGO_PAYOUTS_READ_ACCESS_TOKEN")??
    Deno.env.get("MERCADOPAGO_PAYOUTS_WRITE_ACCESS_TOKEN")??"").trim();
  if(!token.startsWith("APP_USR-")||token.length<30)
    throw new DomainError("PAYOUT_READ_CREDENTIAL_MISSING",
      "Credencial de consulta de saques não está configurada.",503);
  // Reconciliation remains possible when new transfers are suspended.
  return token;
}
async function signatureKey(pem:string){
  const body=pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g,"");
  const raw=base64Bytes(body);
  return crypto.subtle.importKey("pkcs8",raw,{name:"Ed25519"},false,["sign"]);
}
async function signedPayoutBody(privateKey:CryptoKey,body:string){
  const data=new TextEncoder().encode(body);
  return bytesBase64(new Uint8Array(await crypto.subtle.sign("Ed25519",privateKey,data)));
}
async function providerRequest(token:string,path:string,options:RequestInit){
  if(!/^\/v1\/payouts(?:\/[A-Za-z0-9_-]+(?:\/transactions\/[A-Za-z0-9_-]+)?)?$/.test(path))
    throw Error("PAYOUT_ENDPOINT_INVALID");
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),9000);
  try{
    const res=await fetch(api+path,{...options,signal:controller.signal});
    const body=await res.text();
    if(body.length>150000)throw Error("PAYOUT_PROVIDER_RESPONSE_TOO_LARGE");
    let data:any={};
    try{data=body?JSON.parse(body):{}}catch{throw Error("PAYOUT_PROVIDER_INVALID_JSON")}
    return {status:res.status,data};
  }finally{clearTimeout(timer)}
}
function providerIds(x:any,reference:string,cents:number){
  return assertCreatePayoutResponse(x,reference,cents);
}
function exactTransaction(x:any,job:any){
  return assertGetPayoutTransaction(x,job);
}
Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  if(!originAllowed(origin))return respond({error:"ORIGIN_DENIED"},403,origin);
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST")return respond({error:"METHOD_NOT_ALLOWED"},405,origin);
  try{
    const user=await actor(req);
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    await enforceApiQuota(admin,{userId:user,actionName:"network-payout-ops",limit:40,windowSeconds:60});
    const body=await readJsonBody(req);
    const action=String(body.action??"");
    const rpc=async(name:string,args:Record<string,unknown>)=>{
      const {data,error}=await admin.rpc(name,args);
      if(error)throw error;
      return data;
    };
    // Authenticated permanent participant only. No admin privilege is needed
    // to see one own request or reserve verified awards. The PostgreSQL RPCs
    // are service-only and the subject is ALWAYS the validated JWT user ID.
    if(action==="manual-status"){
      const data=await rpc("network_manual_payout_status_v1_1034",{p_user:user});
      if(data?.source!=="network_manual_payout_status_v1_1034"||
        data?.readOnly!==true||data?.mode!=="manual"||
        data?.automaticPayouts!==false)
        throw Error("MANUAL_PAYOUT_STATUS_UNVERIFIED");
      return respond(data,200,origin);
    }
    if(action==="manual-request"){
      const key=idempotency(req);
      const data=await rpc("network_manual_payout_request_v1_1034",{
        p_user:user,p_key:key
      });
      if(data?.source!=="network_manual_request_v1_1034"||
        data?.moneyMoved!==false||!uuid.test(String(data.requestId||"")))
        throw Error("MANUAL_PAYOUT_REQUEST_UNVERIFIED");
      return respond(data,200,origin);
    }
    const {data:permission,error:pe}=await admin.from("platform_admins")
      .select("admin_role,active").eq("user_id",user).eq("active",true).maybeSingle();
    if(pe)throw pe;
    if(!permission||permission.admin_role!=="superadmin")
      throw new DomainError("PAYOUT_SUPERADMIN_REQUIRED","Acesso restrito ao administrador responsável.",403);
    if(action==="manual-queue"){
      const data=await rpc("network_manual_payout_queue_v1_1034",{p_actor:user});
      if(data?.source!=="network_manual_queue_v1_1034"||
        data?.readOnly!==true||data?.manualOnly!==true||
        !Array.isArray(data.items))
        throw Error("MANUAL_PAYOUT_QUEUE_UNVERIFIED");
      return respond(data,200,origin);
    }
    if(action==="manual-set-minimum"){
      const amount=body.minimumCents===null?null:amountCents(body.minimumCents);
      const data=await rpc("network_manual_payout_policy_set_v1_1034",{
        p_actor:user,p_minimum_cents:amount,p_confirm:body.confirmation
      });
      if(data?.source!=="network_manual_policy_v1_1034"||
        data?.automaticPayouts!==false||data?.moneyMoved!==false)
        throw Error("MANUAL_PAYOUT_MINIMUM_UNVERIFIED");
      return respond(data,200,origin);
    }
    if(action==="manual-approve"){
      const data=await rpc("network_manual_payout_approve_v1_1034",{
        p_actor:user,p_request:requiredUuid(body.requestId,"Solicitação"),
        p_confirm:body.confirmation
      });
      if(data?.source!=="network_manual_approval_v1_1034"||
        data?.state!=="approved"||data?.moneyMoved!==false)
        throw Error("MANUAL_PAYOUT_APPROVAL_UNVERIFIED");
      return respond(data,200,origin);
    }
    if(action==="manual-paid"){
      const data=await rpc("network_manual_payout_mark_paid_v1_1034",{
        p_actor:user,p_request:requiredUuid(body.requestId,"Solicitação"),
        p_amount_cents:amountCents(body.amountCents),
        p_expected_pix_hash:requiredSha(body.recipientPixHash),
        p_bank_reference:reference(body.bankReference),
        p_receipt_sha256:requiredSha(body.receiptSha256),
        p_confirm:body.confirmation
      });
      if(data?.source!=="network_manual_paid_record_v1_1034"||
        data?.state!=="paid"||data?.manualEvidenceRecorded!==true||
        data?.providerApiCalled!==false)
        throw Error("MANUAL_PAYOUT_PAID_UNVERIFIED");
      return respond(data,200,origin);
    }
    if(action==="manual-cancel"){
      const data=await rpc("network_manual_payout_cancel_v1_1034",{
        p_actor:user,p_request:requiredUuid(body.requestId,"Solicitação"),
        p_confirm:body.confirmation
      });
      if(data?.source!=="network_manual_cancel_v1_1034"||
        data?.state!=="cancelled"||data?.bankTransferMade!==false)
        throw Error("MANUAL_PAYOUT_CANCEL_UNVERIFIED");
      return respond(data,200,origin);
    }
    if(action==="overview"){
      const data=await rpc("network_payout_overview_v1_1033",{p_actor:user});
      if(data?.source!=="network_payout_executor_v1_1033"||data?.readOnly!==true)
        throw new Error("PAYOUT_OVERVIEW_UNVERIFIED");
      return respond(data,200,origin);
    }
    if(action==="job"){
      const result=await rpc("network_payout_job_read_v1_1033",{
        p_actor:user,p_job:requiredUuid(body.jobId,"Saque")});
      if(result?.source!=="network_payout_job_v1_1033")throw Error("PAYOUT_JOB_UNVERIFIED");
      return respond(result,200,origin);
    }
    if(action==="beneficiary"){
      if(String(body.confirmation??"")!=="IDENTIDADE E CPF VERIFICADOS")
        throw new DomainError("PAYOUT_IDENTITY_REQUIRED","Confirme a identidade do destinatário fora do TAMÃO.",409);
      const cpf=validCpf(body.cpfPixKey);
      const userId=requiredUuid(body.userId,"Beneficiário");
      const cipher=await encryptCpf(cpf);
      const fingerprint=await recipientHash(cpf);
      const result=await rpc("network_payout_beneficiary_register_v1_1033",{
        p_actor:user,p_user:userId,p_encrypted:cipher.encrypted,p_iv:cipher.iv,
        p_key_hash:fingerprint,p_proof_hash:requiredSha(body.identityProofSha256),
        p_proof_reference:reference(body.identityProofReference)
      });
      if(result?.source!=="network_payout_beneficiary_v1_1033"||result?.verified!==true||
        result?.userId!==userId||result?.pixKeyHash!==fingerprint)
        throw Error("PAYOUT_BENEFICIARY_NOT_VERIFIED");
      return respond({ok:true,source:result.source,userId,verified:true,rawPixReturned:false},200,origin);
    }
    if(action==="reserve"){
      const result=await rpc("network_fee_payout_reserve_v1_1031",{
        p_actor:user,p_user:requiredUuid(body.userId,"Beneficiário"),
        p_amount_cents:amountCents(body.amountCents),p_key:idempotency(req)
      });
      if(result?.source!=="network_payout_reservation_v1_1031"||result?.moneyMoved!==false)
        throw Error("PAYOUT_RESERVATION_UNVERIFIED");
      return respond(result,200,origin);
    }
    if(action==="prepare"){
      const result=await rpc("network_payout_prepare_v1_1033",{
        p_actor:user,p_reservation:requiredUuid(body.reservationId,"Reserva")});
      if(result?.source!=="network_payout_job_v1_1033"||result?.moneyMoved!==false)
        throw Error("PAYOUT_PREPARE_UNVERIFIED");
      return respond(result,200,origin);
    }
    if(action==="cancel-prepared"){
      const result=await rpc("network_payout_cancel_prepared_v1_1033",{
        p_actor:user,p_job:requiredUuid(body.jobId,"Saque")});
      if(result?.state!=="cancelled"||result?.providerCalled!==false)
        throw Error("PAYOUT_CANCEL_UNVERIFIED");
      return respond(result,200,origin);
    }
    if(action==="enable"){
      if(body.enabled===true){
        providerConfig();await aesKey();await hashKey();
        await signatureKey(providerConfig().pem);
        if(body.confirmation!=="AUTORIZO EXECUCAO FINANCEIRA")
          throw new DomainError("PAYOUT_ACTIVATION_DENIED","É necessária autorização financeira expressa.",409);
      }
      const result=await rpc("network_payout_set_execution_v1_1033",{
        p_actor:user,p_enabled:body.enabled===true,
        p_reference:body.enabled===true?reference(body.approvalReference):null
      });
      if(result?.source!=="network_payout_execution_policy_v1_1033")
        throw Error("PAYOUT_ENABLE_UNVERIFIED");
      return respond(result,200,origin);
    }
    if(action==="authorize"){
      const result=await rpc("network_payout_authorize_v1_1033",{
        p_actor:user,p_job:requiredUuid(body.jobId,"Saque"),
        p_expected_amount:amountCents(body.expectedAmountCents),
        p_expected_hash:requiredSha(body.expectedPixKeyHash),
        p_confirm:body.confirmation
      });
      if(result?.authorized!==true||result?.moneyMoved!==false)
        throw Error("PAYOUT_AUTHORIZATION_UNVERIFIED");
      return respond(result,200,origin);
    }
    if(action==="execute"){
      // All provider and crypto capability checks occur BEFORE the
      // irreversible persisted dispatching transition.
      const cfg=providerConfig();
      const signing=await signatureKey(cfg.pem);
      await aesKey();await hashKey();
      const jobId=requiredUuid(body.jobId,"Saque");
      if(body.confirmation!=="ENVIAR PIX")
        throw new DomainError("PAYOUT_DISPATCH_CONFIRMATION_REQUIRED","Confirme o envio do Pix.",409);
      const r=await rpc("network_payout_dispatch_begin_v1_1033",{
        p_actor:user,p_job:jobId
      });
      if(r?.source!=="network_payout_dispatch_v1_1033"||
        r?.jobId!==jobId||r?.pixType!=="CPF"||r?.moneyMoved!==false)
        throw new Error("PAYOUT_DISPATCH_READBACK_INVALID");
      const cpf=await decryptCpf(String(r.encryptedPixKey),String(r.pixIv));
      if(await recipientHash(cpf)!==r.pixKeyHash)
        throw new Error("PAYOUT_DESTINATION_CIPHERTEXT_MISMATCH");
      const cents=amountCents(r.amountCents);
      const external=String(r.externalReference||"");
      if(!/^TAMAONET[A-F0-9]{32}$/.test(external))
        throw new Error("PAYOUT_EXTERNAL_REFERENCE_INVALID");
      const payoutBody=serializePayoutBody({cpf,cents,reference:external});
      const signature=await signedPayoutBody(signing,payoutBody);
      let result:any=null;
      try{
        result=await providerRequest(cfg.token,"/v1/payouts",{
          method:"POST",
          headers:{
            "Authorization":"Bearer "+cfg.token,
            "Content-Type":"application/json",
            "X-Idempotency-Key":String(r.transferIdempotencyKey),
            "X-enforce-signature":"true",
            "X-signature":signature
          },
          body:payoutBody
        });
        if(result.status!==202)throw new Error("PAYOUT_PROVIDER_NOT_ACCEPTED");
        const ids=providerIds(result.data,external,cents);
        const saved=await rpc("network_payout_dispatch_result_v1_1033",{
          p_actor:user,p_job:jobId,
          p_payout:ids.payoutId,p_transaction:ids.transactionId,p_unknown:false
        });
        if(saved?.state!=="submitted")throw Error("PAYOUT_DISPATCH_ACK_PERSISTENCE_FAILED");
        return respond({source:"network_payout_execution_v1_1033",
          jobId,state:"submitted",providerAccepted:true,recipientCredited:false,
          payoutId:ids.payoutId,transactionId:ids.transactionId},200,origin);
      }catch(error){
        // After a POST may have been sent, never assume failure means
        // no debit; NEVER retry it with another idempotency key.
        try{await rpc("network_payout_dispatch_result_v1_1033",{
          p_actor:user,p_job:jobId,p_payout:null,p_transaction:null,p_unknown:true
        })}catch{/* retain dispatching state, still never repost */}
        console.error("payout ambiguous dispatch; reconcile manually",jobId,
          error instanceof Error?error.name:"UNKNOWN");
        return respond({source:"network_payout_execution_v1_1033",
          jobId,state:"uncertain",providerAccepted:null,recipientCredited:false,
          message:"Envio com resultado incerto. Não tente pagar novamente; reconcilie com o provedor."},409,origin);
      }
    }
    if(action==="recover"){
      // A timeout/ambiguous result is NEVER replayed as a new transfer.
      // The owner must retrieve POP/TOP IDs from the official provider portal.
      const token=providerReadToken();
      const jobId=requiredUuid(body.jobId,"Saque");
      const payoutId=String(body.providerPayoutId??"").trim();
      const transactionId=String(body.providerTransactionId??"").trim();
      if(!/^POP[A-Za-z0-9_-]{8,75}$/.test(payoutId)||
         !/^TOP[A-Za-z0-9_-]{8,75}$/.test(transactionId))
        throw new DomainError("PAYOUT_RECOVERY_IDS_REQUIRED",
          "Informe IDs oficiais do lote POP e transação TOP.",400);
      const job=await rpc("network_payout_job_read_v1_1033",{
        p_actor:user,p_job:jobId
      });
      if(!["uncertain","dispatching","submitted"].includes(job?.state))
        throw new DomainError("PAYOUT_RECOVERY_INVALID_STATE",
          "Este saque não necessita recuperação de lote.",409);
      const path="/v1/payouts/"+encodeURIComponent(payoutId)+
        "/transactions/"+encodeURIComponent(transactionId);
      const data=await providerRequest(token,path,{
        method:"GET",headers:{"Authorization":"Bearer "+token}
      });
      if(data.status!==200)
        throw new DomainError("PAYOUT_RECOVERY_PROVIDER_NOT_VERIFIED",
          "Não foi possível localizar os IDs informados no provedor.",409);
      const matching=exactTransaction(data.data,{...job,
        providerTransactionId:transactionId});
      const bound=await rpc("network_payout_bind_ambiguous_v1_1033",{
        p_actor:user,p_job:jobId,p_payout:payoutId,p_transaction:transactionId
      });
      if(bound?.source!=="network_payout_recovery_v1_1033"||
        bound?.providerBound!==true)throw Error("PAYOUT_RECOVERY_NOT_BOUND");
      const observed=await rpc("network_payout_observe_v1_1033",{
        p_actor:user,p_job:jobId,p_payout:payoutId,p_transaction:transactionId,
        p_status:matching.status,p_detail:matching.detail
      });
      if(observed?.source!=="network_payout_observation_v1_1033")
        throw Error("PAYOUT_RECOVERY_OBSERVATION_FAILED");
      return respond({source:"network_payout_recovered_v1_1033",
        jobId,state:observed.state,recipientCredited:observed.state==="credited_unverified",
        bankReceiptVerified:false,postRetried:false},200,origin);
    }
    if(action==="reconcile"){
      const token=providerReadToken();
      const jobId=requiredUuid(body.jobId,"Saque");
      const job=await rpc("network_payout_job_read_v1_1033",{
        p_actor:user,p_job:jobId
      });
      if(job?.source!=="network_payout_job_v1_1033"||
        !job.providerPayoutId||!job.providerTransactionId)
        throw new DomainError("PAYOUT_RECONCILIATION_UNAVAILABLE",
          "Falta identificação do lote no provedor. Não reenvie o Pix.",409);
      const path="/v1/payouts/"+encodeURIComponent(job.providerPayoutId)+
        "/transactions/"+encodeURIComponent(job.providerTransactionId);
      const data=await providerRequest(token,path,{
        method:"GET",headers:{"Authorization":"Bearer "+token}
      });
      if(data.status!==200)throw new DomainError("PAYOUT_PROVIDER_QUERY_FAILED",
        "Não foi possível conferir a transação na API de Payouts.",503);
      const clean=exactTransaction(data.data,job);
      const result=await rpc("network_payout_observe_v1_1033",{
        p_actor:user,p_job:jobId,p_payout:job.providerPayoutId,
        p_transaction:job.providerTransactionId,
        p_status:clean.status,p_detail:clean.detail
      });
      if(result?.source!=="network_payout_observation_v1_1033")
        throw Error("PAYOUT_RECONCILIATION_NOT_PERSISTED");
      return respond(result,200,origin);
    }
    if(action==="confirm-bank"){
      if(body.confirmation!=="CONFERI COMPROVANTE E TITULAR")
        throw new DomainError("PAYOUT_BANK_REVIEW_REQUIRED",
          "É necessário conferir titular e comprovante independentemente.",409);
      const result=await rpc("network_payout_bank_confirm_v1_1033",{
        p_actor:user,p_job:requiredUuid(body.jobId,"Saque"),
        p_reference:reference(body.receiptReference),
        p_sha256:requiredSha(body.receiptSha256)
      });
      if(result?.state!=="paid"||result?.evidenceRecorded!==true)
        throw Error("PAYOUT_PROOF_NOT_VERIFIED");
      return respond(result,200,origin);
    }
    throw new DomainError("PAYOUT_INVALID_ACTION","Ação inválida.",400);
  }catch(e){
    if(e instanceof DomainError)
      return respond({error:e.code,message:e.message},e.status,origin);
    const code=String((e as any)?.message??e);
    // Do not send financial data, raw Pix keys or exception details to clients.
    if(/NETWORK_PAYOUT_|PAYOUT_/.test(code))
      return respond({error:"PAYOUT_BLOCKED",message:"A operação não passou nas verificações de segurança. Consulte o Financeiro."},409,origin);
    console.error("network-payout-ops failed",e instanceof Error?e.name:"UNKNOWN");
    return respond({error:"INTERNAL_ERROR",message:"Não foi possível validar a operação financeira."},500,origin);
  }
});
