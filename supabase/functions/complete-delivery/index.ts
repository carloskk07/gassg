import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {
  createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  DomainError,
  assertPermanentMerchantUser,
  asPositiveInt,
  validateDeliveryPin,
  validateIdempotencyKey,
  requestFingerprint,
  readJsonBody,
  enforceApiQuota
} from "../_shared/domain.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const publishableKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const PUBLISHABLE_KEY=publishableKeys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const PROD_ORIGIN="https://carloskk07.github.io";
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function originAllowed(origin:string|null){
  if(!origin)return true;
  if(origin===PROD_ORIGIN)return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
function cors(origin:string|null){
  const allowed=origin&&originAllowed(origin)?origin:PROD_ORIGIN;
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
  if(!authHeader?.startsWith("Bearer "))throw new DomainError("UNAUTHORIZED","Autenticação obrigatória.",401);
  const token=authHeader.slice("Bearer ".length);
  const client=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await client.auth.getUser(token);
  if(error||!data.user)throw new DomainError("UNAUTHORIZED","Sessão inválida ou expirada.",401);
  return assertPermanentMerchantUser(data.user);
}
function mapRpcError(error:{message?:string}|null){
  const message=String(error?.message??"");
  const map:Record<string,[number,string]>={
    ORDER_NOT_FOUND:[404,"Pedido não encontrado."],
    MERCHANT_ACCESS_DENIED:[403,"Você não possui acesso a este pedido."],
    VERSION_CONFLICT:[409,"O pedido mudou. Atualize antes de tentar novamente."],
    INVALID_TRANSITION:[409,"O pedido ainda não está pronto para confirmar entrega."],
    PIN_LOCKED:[423,"PIN bloqueado após muitas tentativas."],
    PIN_UNAVAILABLE:[409,"PIN indisponível para este pedido."],
    IDEMPOTENCY_CONFLICT:[409,"A mesma chave foi usada para outra requisição."]
  };
  for(const [code,[status,text]] of Object.entries(map)){
    if(message.includes(code))return {code,status,message:text};
  }
  return {code:"COMPLETE_DELIVERY_FAILED",status:500,message:"Não foi possível concluir a entrega."};
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  if(!originAllowed(origin))return json({error:"ORIGIN_NOT_ALLOWED"},403,origin);
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405,origin);

  try{
    const user=await authenticatedUser(req);
    const idempotencyKey=validateIdempotencyKey(req.headers.get("Idempotency-Key"));
    const body=await readJsonBody(req);
    const orderId=String(body.orderId??"");
    if(!UUID_RE.test(orderId))throw new DomainError("INVALID_ORDER","Pedido inválido.",400);

    const pin=validateDeliveryPin(body.pin);
    if(body.paymentConfirmed!==true){
      throw new DomainError("PAYMENT_CONFIRMATION_REQUIRED","Confirme o recebimento do pagamento antes de concluir.",400);
    }
    const expectedVersion=asPositiveInt(body.expectedVersion,"expectedVersion",{min:1,max:Number.MAX_SAFE_INTEGER});
    const requestHash=await requestFingerprint("complete-delivery",{orderId,pin,expectedVersion,paymentConfirmed:true});

    const admin=createClient(SUPABASE_URL,SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    await enforceApiQuota(admin,{userId:user.id,actionName:"complete-delivery",limit:20,windowSeconds:60});
    const {data,error}=await admin.rpc("complete_order_delivery",{
      p_user_id:user.id,
      p_order_id:orderId,
      p_pin_code:pin,
      p_expected_version:expectedVersion,
      p_idempotency_key:idempotencyKey,
      p_request_hash:requestHash
    });

    if(error){
      const mapped=mapRpcError(error);
      console.error("complete-delivery rpc failed",mapped.code);
      return json({error:mapped.code,message:mapped.message},mapped.status,origin);
    }

    if(data?.ok===false){
      const status=data.error==="PIN_LOCKED"?423:422;
      return json(data,status,origin);
    }

    return json(data,200,origin);
  }catch(error){
    if(error instanceof DomainError)return json({error:error.code,message:error.message},error.status,origin);
    console.error("complete-delivery failed",error instanceof Error?error.message:String(error));
    return json({error:"INTERNAL_ERROR",message:"Não foi possível concluir a entrega."},500,origin);
  }
});
