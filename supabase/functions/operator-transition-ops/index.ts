import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {DomainError,readJsonBody,enforceApiQuota} from "../_shared/domain.js";
import {isValidOperatorCnpj,normalizeOperatorCnpj} from "../_shared/operator-cnpj-v1-1159.mjs";

// V1.1159 — preparação PJ exclusiva do superadmin.
// Não cria CNPJ, não muda configuração do PSP e não transfere dinheiro.
const url=Deno.env.get("SUPABASE_URL")??"";
const publicKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const publishable=publicKeys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const secret=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const ORIGINS=new Set(["https://admin.tamao.com.br","https://tamao-sg-admin.pages.dev"]);
function originAllowed(v:string|null){
  return !v||ORIGINS.has(v)||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(v);
}
function headers(v:string|null){return {
  "Access-Control-Allow-Origin":v&&originAllowed(v)?v:"https://admin.tamao.com.br",
  "Access-Control-Allow-Headers":"authorization,apikey,content-type",
  "Access-Control-Allow-Methods":"POST,OPTIONS",
  "Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
  "Vary":"Origin"
}}
function respond(body:unknown,status=200,origin:string|null=null){
  return new Response(JSON.stringify(body),{status,headers:headers(origin)});
}
function revision(v:unknown){
  const n=Number(v);
  if(!Number.isSafeInteger(n)||n<0)throw new DomainError(
    "OPERATOR_REVISION_INVALID","Atualize o painel e tente novamente.",400);
  return n;
}
function shortText(v:unknown,min:number,max:number,label:string){
  const s=String(v??"").trim().replace(/\s+/g," ");
  if(s.length<min||s.length>max||/[<>\u0000-\u001f]/.test(s))
    throw new DomainError("OPERATOR_FIELD_INVALID","Campo inválido: "+label+".",400);
  return s;
}
Deno.serve(async req=>{
  const origin=req.headers.get("Origin");
  if(!originAllowed(origin))return respond({error:"ORIGIN_DENIED"},403,origin);
  if(req.method==="OPTIONS")return new Response("ok",{headers:headers(origin)});
  if(req.method!=="POST")return respond({error:"METHOD_NOT_ALLOWED"},405,origin);
  try{
    const auth=String(req.headers.get("Authorization")??"");
    if(!auth.startsWith("Bearer "))throw new DomainError("UNAUTHORIZED","Sessão administrativa obrigatória.",401);
    const pub=createClient(url,publishable,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await pub.auth.getUser(auth.slice(7));
    if(error||!data.user||data.user.is_anonymous===true||!data.user.email_confirmed_at)
      throw new DomainError("UNAUTHORIZED","Conta administrativa permanente obrigatória.",401);
    const actor=data.user.id;
    const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:permission,error:permissionError}=await admin.from("platform_admins")
      .select("admin_role").eq("user_id",actor).eq("active",true).maybeSingle();
    if(permissionError)throw permissionError;
    if(permission?.admin_role!=="superadmin")
      throw new DomainError("OPERATOR_SUPERADMIN_ONLY","Acesso exclusivo ao responsável administrativo.",403);
    await enforceApiQuota(admin,{userId:actor,actionName:"operator-transition-ops",limit:25,windowSeconds:60});
    const payload=await readJsonBody(req);
    const action=String(payload.action??"");
    const rpc=async(name:string,args:Record<string,unknown>)=>{
      const {data,error}=await admin.rpc(name,args);
      if(error)throw error;
      if(data?.source!=="platform_operator_transition_v1_1159"
        ||data?.moneyMoved!==false)
        throw Error("OPERATOR_TRANSITION_RESPONSE_INVALID");
      return data;
    };
    if(action==="read"){
      const data=await rpc("platform_operator_transition_read_v1_1159",{p_actor:actor});
      if(data?.readOnly!==true||data?.pspChanged!==false||
        !Array.isArray(data?.gates))throw Error("OPERATOR_TRANSITION_READBACK_INVALID");
      return respond(data,200,origin);
    }
    if(action==="stage"){
      const cnpj=normalizeOperatorCnpj(payload.cnpj);
      if(!isValidOperatorCnpj(cnpj))
        throw new DomainError("OPERATOR_CNPJ_INVALID","CNPJ inválido: confira os dois dígitos verificadores.",400);
      const data=await rpc("platform_operator_transition_stage_v1_1159",{
        p_actor:actor,p_expected_revision:revision(payload.revision),
        p_cnpj:cnpj,
        p_legal_name:shortText(payload.legalName,3,160,"razão social"),
        p_trade_name:shortText(payload.tradeName,2,120,"nome fantasia"),
        p_public_address:shortText(payload.publicAddress,10,240,"endereço público"),
        p_contact_email:shortText(payload.contactEmail,6,180,"e-mail de suporte"),
        p_confirmation:payload.confirmation
      });
      if(data.stage!=="draft"||data.pspChanged!==false)
        throw Error("OPERATOR_TRANSITION_STAGE_INVALID");
      return respond(data,200,origin);
    }
    if(action==="gate"){
      const gate=shortText(payload.gateKey,3,80,"verificação");
      const checked=payload.verified===true;
      if(typeof payload.verified!=="boolean")
        throw new DomainError("OPERATOR_GATE_INVALID","Selecione um resultado válido.",400);
      const data=await rpc("platform_operator_transition_gate_v1_1159",{
        p_actor:actor,p_expected_revision:revision(payload.revision),
        p_gate_key:gate,p_verified:checked,
        p_evidence_reference:checked?shortText(payload.evidenceReference,16,200,"referência real"):null,
        p_confirmation:checked?payload.confirmation:null
      });
      if(data.gateKey!==gate||data.verified!==checked)
        throw Error("OPERATOR_TRANSITION_GATE_INVALID");
      return respond(data,200,origin);
    }
    if(action==="activate"){
      if(payload.confirmation!=="CONFIRMO ATIVACAO PJ")
        throw new DomainError("OPERATOR_ACTIVATION_CONFIRM_REQUIRED",
          "É necessária autorização explícita de troca de identidade.",409);
      const data=await rpc("platform_operator_transition_activate_v1_1159",{
        p_actor:actor,p_expected_revision:revision(payload.revision),
        p_confirmation:payload.confirmation
      });
      if(data.stage!=="active"||data.pspChanged!==false||
        data.historicalLedgerRewritten!==false)
        throw Error("OPERATOR_TRANSITION_ACTIVATION_INVALID");
      return respond(data,200,origin);
    }
    throw new DomainError("OPERATOR_ACTION_INVALID","Operação não reconhecida.",400);
  }catch(e){
    if(e instanceof DomainError)return respond({error:e.code,message:e.message},e.status,origin);
    const msg=String((e as Error)?.message??e);
    if(msg.startsWith("OPERATOR_TRANSITION_"))
      return respond({error:"OPERATOR_TRANSITION_NOT_READY",
        message:"Cadastro, versão ou comprovações ainda não permitem a operação. Atualize e confira."},409,origin);
    console.error("operator transition internal error",e instanceof Error?e.name:"UNKNOWN");
    return respond({error:"OPERATOR_INTERNAL_ERROR",message:"Não foi possível conferir a migração."},500,origin);
  }
});
