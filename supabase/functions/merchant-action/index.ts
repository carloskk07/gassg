import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {
  createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  DomainError,
  assertPermanentMerchantUser,
  asPositiveInt,
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
const MERCHANT_ALLOWED_ORIGIN=(Deno.env.get("MERCHANT_ALLOWED_ORIGIN")??"").trim();
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function originAllowed(origin:string|null){
  if(!origin)return true;
  if(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return true;
  return MERCHANT_ALLOWED_ORIGIN.length>0&&origin===MERCHANT_ALLOWED_ORIGIN;
}
function cors(origin:string|null){
  const allowed=origin&&originAllowed(origin)?origin:(MERCHANT_ALLOWED_ORIGIN||"null");
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
    MERCHANT_ACCESS_DENIED:[403,"Você não possui acesso operacional a este pedido."],
    VERSION_CONFLICT:[409,"O pedido mudou. Atualize antes de agir."],
    INVALID_TRANSITION:[409,"Esta ação não é válida no estado atual do pedido."],
    OFFER_EXPIRED:[409,"O prazo para aceitar este pedido expirou."],
    MERCHANT_UNAVAILABLE:[409,"A revenda está indisponível para aceitar novos pedidos."],
    INSUFFICIENT_STOCK:[409,"O estoque mudou antes do aceite."],
    STOCK_RESTORE_FAILED:[409,"Não foi possível recompor o estoque reservado com segurança."],
    INVALID_RESCUE_STATE:[409,"O pedido não está em estado seguro para reatribuição."],
    DELIVERY_INCOMPATIBLE:[409,"Esta cesta exige uma capacidade logística que a revenda não possui ou não está mais verificada."],
    IDEMPOTENCY_CONFLICT:[409,"A mesma chave foi usada para outra requisição."]
  };
  for(const [code,[status,text]] of Object.entries(map)){
    if(message.includes(code))return {code,status,message:text};
  }
  return {code:"MERCHANT_ACTION_FAILED",status:500,message:"Não foi possível atualizar o pedido."};
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

    const action=String(body.action??"");
    if(!["accept","reject","dispatch","arriving","cannot-fulfill"].includes(action)){
      throw new DomainError("INVALID_ACTION","Ação inválida.",400);
    }
    const expectedVersion=asPositiveInt(body.expectedVersion,"expectedVersion",{min:1,max:Number.MAX_SAFE_INTEGER});
    const failureReasons=new Set(["stock_issue","vehicle_issue","staffing_issue","other_operational"]);
    const reason=action==="cannot-fulfill"?String(body.reason??"other_operational"):"";
    if(action==="cannot-fulfill"&&!failureReasons.has(reason)){
      throw new DomainError("INVALID_FAILURE_REASON","Motivo operacional inválido.",400);
    }
    const requestHash=await requestFingerprint("merchant-action:"+action,{orderId,action,expectedVersion,reason});

    const admin=createClient(SUPABASE_URL,SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    await enforceApiQuota(admin,{userId:user.id,actionName:"merchant-action",limit:80,windowSeconds:60});
    const rpcName=action==="cannot-fulfill"?"merchant_fail_before_dispatch":"merchant_order_action";
    const rpcArgs=action==="cannot-fulfill"
      ? {
          p_user_id:user.id,
          p_order_id:orderId,
          p_expected_version:expectedVersion,
          p_idempotency_key:idempotencyKey,
          p_request_hash:requestHash,
          p_reason:reason
        }
      : {
          p_user_id:user.id,
          p_order_id:orderId,
          p_action:action,
          p_expected_version:expectedVersion,
          p_idempotency_key:idempotencyKey,
          p_request_hash:requestHash
        };
    const {data,error}=await admin.rpc(rpcName,rpcArgs);

    if(error){
      const mapped=mapRpcError(error);
      console.error("merchant-action rpc failed",mapped.code);
      return json({error:mapped.code,message:mapped.message},mapped.status,origin);
    }
    return json(data,200,origin);
  }catch(error){
    if(error instanceof DomainError)return json({error:error.code,message:error.message},error.status,origin);
    console.error("merchant-action failed",error instanceof Error?error.message:String(error));
    return json({error:"INTERNAL_ERROR",message:"Não foi possível atualizar o pedido."},500,origin);
  }
});
