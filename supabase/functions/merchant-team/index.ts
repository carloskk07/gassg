import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {
  DomainError,
  assertPermanentMerchantUser,
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
const MERCHANT_ALLOWED_ORIGIN=(Deno.env.get("MERCHANT_ALLOWED_ORIGIN")??"https://chama-sg-revenda.netlify.app").trim();
const MERCHANT_PRIMARY_ORIGINS=new Set([
  "https://tamao-sg-revenda.pages.dev",
  "https://parceiro.tamao.com.br",
  MERCHANT_ALLOWED_ORIGIN
].filter(Boolean));
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function originAllowed(origin:string|null){
  if(!origin)return true;
  if(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return true;
  return MERCHANT_PRIMARY_ORIGINS.has(origin);
}
function cors(origin:string|null){
  const allowed=origin&&originAllowed(origin)?origin:("https://tamao-sg-revenda.pages.dev");
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
    MERCHANT_ACCESS_DENIED:[403,"Seu papel não permite gerenciar esta equipe."],
    INVALID_EMAIL:[400,"Informe um e-mail válido."],
    INVALID_MEMBER_ROLE:[400,"Papel de equipe inválido."],
    INVALID_DISPLAY_NAME:[400,"Nome operacional inválido."],
    SELF_TEAM_INVITE:[400,"Sua própria conta já faz parte da equipe."],
    MEMBER_ALREADY_ACTIVE:[409,"Esta conta já está ativa na equipe com outro papel."],
    SELF_ACCESS_CHANGE:[400,"Você não pode revogar o próprio acesso por esta tela."],
    MEMBER_HAS_ACTIVE_DELIVERY:[409,"Este membro está responsável por uma entrega que já saiu. Conclua ou transfira a operação antes de revogar o acesso."],
    INVITE_NOT_FOUND:[404,"Convite não encontrado."],
    INVITE_ALREADY_ACCEPTED:[409,"Este convite já foi aceito. Revogue o membro em vez do convite."],
    IDEMPOTENCY_CONFLICT:[409,"A mesma chave foi usada para outra operação."]
  };
  for(const [code,[status,text]] of Object.entries(map)){
    if(message.includes(code))return {code,status,message:text};
  }
  return {code:"MERCHANT_TEAM_FAILED",status:500,message:"Não foi possível atualizar a equipe."};
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  if(!originAllowed(origin))return json({error:"ORIGIN_NOT_ALLOWED"},403,origin);
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405,origin);

  try{
    const user=await authenticatedUser(req);
    const body=await readJsonBody(req);
    const action=String(body.action??"list");
    const merchantId=String(body.merchantId??"");
    if(!UUID_RE.test(merchantId))throw new DomainError("INVALID_MERCHANT","Revenda inválida.",400);
    if(!["list","invite","revoke-member","revoke-invite"].includes(action)){
      throw new DomainError("INVALID_ACTION","Ação de equipe inválida.",400);
    }

    const admin=createClient(SUPABASE_URL,SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    await enforceApiQuota(admin,{userId:user.id,actionName:"merchant-team",limit:90,windowSeconds:60});

    if(action==="list"){
      const {data,error}=await admin.rpc("merchant_team_snapshot",{
        p_actor_user_id:user.id,
        p_merchant_id:merchantId
      });
      if(error){
        const mapped=mapRpcError(error);
        return json({error:mapped.code,message:mapped.message},mapped.status,origin);
      }
      return json(data??{actorRole:null,members:[],pendingInvites:[]},200,origin);
    }

    const idempotencyKey=validateIdempotencyKey(req.headers.get("Idempotency-Key"));
    const email=action==="invite"?String(body.email??"").trim().toLowerCase():null;
    const memberRole=action==="invite"?String(body.memberRole??"").trim().toLowerCase():null;
    const displayName=action==="invite"?String(body.displayName??"").trim().replace(/\s+/g," "):null;
    const targetUserId=action==="revoke-member"?String(body.targetUserId??""):null;
    const inviteId=action==="revoke-invite"?String(body.inviteId??""):null;

    if(action==="invite"){
      if(email!.length<3||email!.length>160||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email!)){
        throw new DomainError("INVALID_EMAIL","Informe um e-mail válido.",400);
      }
      if(!["manager","operator","driver"].includes(memberRole!)){
        throw new DomainError("INVALID_MEMBER_ROLE","Papel de equipe inválido.",400);
      }
      if(displayName&&displayName.length>60){
        throw new DomainError("INVALID_DISPLAY_NAME","Nome operacional inválido.",400);
      }
    }
    if(action==="revoke-member"&&!UUID_RE.test(targetUserId!)){
      throw new DomainError("INVALID_MEMBER","Membro inválido.",400);
    }
    if(action==="revoke-invite"&&!UUID_RE.test(inviteId!)){
      throw new DomainError("INVALID_INVITE","Convite inválido.",400);
    }

    const requestHash=await requestFingerprint("merchant-team:"+action,{
      merchantId,action,email,memberRole,displayName:displayName||null,targetUserId,inviteId
    });

    const {data,error}=await admin.rpc("merchant_team_mutate",{
      p_actor_user_id:user.id,
      p_merchant_id:merchantId,
      p_action:action,
      p_email:email,
      p_member_role:memberRole,
      p_display_name:displayName||null,
      p_target_user_id:targetUserId,
      p_invite_id:inviteId,
      p_idempotency_key:idempotencyKey,
      p_request_hash:requestHash
    });
    if(error){
      const mapped=mapRpcError(error);
      console.error("merchant-team rpc failed",mapped.code);
      return json({error:mapped.code,message:mapped.message},mapped.status,origin);
    }
    return json(data,200,origin);
  }catch(error){
    if(error instanceof DomainError)return json({error:error.code,message:error.message},error.status,origin);
    console.error("merchant-team failed",error instanceof Error?error.message:String(error));
    return json({error:"INTERNAL_ERROR",message:"Não foi possível atualizar a equipe."},500,origin);
  }
});
