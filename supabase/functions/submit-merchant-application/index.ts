import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {
  createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  DomainError,
  assertPermanentMerchantUser,
  normalizeAddress,
  normalizeCnpj,
  isValidCnpj,
  readJsonBody,
  enforceApiQuota
} from "../_shared/domain.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const publishableKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const PUBLISHABLE_KEY=publishableKeys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const MERCHANT_ALLOWED_ORIGIN=(Deno.env.get("MERCHANT_ALLOWED_ORIGIN")??"").trim();

function originAllowed(origin:string|null){
  if(!origin)return true;
  if(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return true;
  return MERCHANT_ALLOWED_ORIGIN.length>0&&origin===MERCHANT_ALLOWED_ORIGIN;
}
function cors(origin:string|null){
  const allowed=origin&&originAllowed(origin)?origin:(MERCHANT_ALLOWED_ORIGIN||"null");
  return {
    "Access-Control-Allow-Origin":allowed,
    "Access-Control-Allow-Headers":"authorization, apikey, content-type",
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

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  if(!originAllowed(origin))return json({error:"ORIGIN_NOT_ALLOWED"},403,origin);
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405,origin);

  try{
    const user=await authenticatedUser(req);
    const body=await readJsonBody(req);

    const cnpj=normalizeCnpj(body.cnpj);
    if(!isValidCnpj(cnpj))throw new DomainError("INVALID_CNPJ","CNPJ inválido no formato atual.",400);

    const companyName=String(body.companyName??"").trim().replace(/\s+/g," ");
    const responsibleName=String(body.responsibleName??"").trim().replace(/\s+/g," ");
    const phone=String(body.phone??"").replace(/\D/g,"");
    const address=normalizeAddress(body.address);

    if(companyName.length<2||companyName.length>120)throw new DomainError("INVALID_COMPANY","Nome da empresa inválido.",400);
    if(responsibleName.length<2||responsibleName.length>120)throw new DomainError("INVALID_RESPONSIBLE","Responsável inválido.",400);
    if(phone.length<10||phone.length>13)throw new DomainError("INVALID_PHONE","WhatsApp inválido.",400);

    const admin=createClient(SUPABASE_URL,SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    await enforceApiQuota(admin,{userId:user.id,actionName:"submit-merchant-application",limit:5,windowSeconds:3600});
    const {data:existing,error:existingError}=await admin
      .from("merchant_applications")
      .select("id,cnpj,company_name,status,created_at")
      .eq("applicant_user_id",user.id)
      .eq("cnpj",cnpj)
      .maybeSingle();
    if(existingError)throw existingError;

    if(existing?.status==="approved"){
      return json({
        error:"APPLICATION_ALREADY_APPROVED",
        message:"Este cadastro já foi aprovado. Use o painel da revenda ou solicite suporte para o vínculo."
      },409,origin);
    }

    if(existing){
      const {data,error}=await admin
        .from("merchant_applications")
        .update({
          company_name:companyName,
          responsible_name:responsibleName,
          phone,
          address_text:address,
          status:"pending",
          updated_at:new Date().toISOString()
        })
        .eq("id",existing.id)
        .eq("applicant_user_id",user.id)
        .select("id,cnpj,company_name,status,created_at,updated_at")
        .single();

      if(error){
        if(String(error.code)==="23505"){
          return json({error:"APPLICATION_EXISTS",message:"Este CNPJ já possui outro cadastro pendente ou aprovado."},409,origin);
        }
        throw error;
      }

      return json({
        applicationId:data.id,
        cnpj:data.cnpj,
        companyName:data.company_name,
        status:data.status,
        createdAt:data.created_at,
        updatedAt:data.updated_at,
        reused:true,
        resubmitted:existing.status==="rejected"
      },200,origin);
    }

    const {data,error}=await admin
      .from("merchant_applications")
      .insert({
        applicant_user_id:user.id,
        cnpj,
        company_name:companyName,
        responsible_name:responsibleName,
        phone,
        address_text:address,
        status:"pending"
      })
      .select("id,cnpj,company_name,status,created_at")
      .single();

    if(error){
      if(String(error.code)==="23505"){
        // A retry can race with the first successful request. If the same
        // applicant already owns the pending row, return it instead of turning
        // a lost ACK into a false failure.
        const {data:retryExisting}=await admin
          .from("merchant_applications")
          .select("id,cnpj,company_name,status,created_at")
          .eq("applicant_user_id",user.id)
          .eq("cnpj",cnpj)
          .maybeSingle();
        if(retryExisting?.status==="pending"){
          return json({
            applicationId:retryExisting.id,
            cnpj:retryExisting.cnpj,
            companyName:retryExisting.company_name,
            status:retryExisting.status,
            createdAt:retryExisting.created_at,
            reused:true,
            resubmitted:false
          },200,origin);
        }
        return json({error:"APPLICATION_EXISTS",message:"Este CNPJ já possui cadastro pendente ou aprovado."},409,origin);
      }
      throw error;
    }

    return json({
      applicationId:data.id,
      cnpj:data.cnpj,
      companyName:data.company_name,
      status:data.status,
      createdAt:data.created_at,
      reused:false,
      resubmitted:false
    },201,origin);
  }catch(error){
    if(error instanceof DomainError)return json({error:error.code,message:error.message},error.status,origin);
    console.error("submit-merchant-application failed",error instanceof Error?error.message:String(error));
    return json({error:"INTERNAL_ERROR",message:"Não foi possível enviar o cadastro."},500,origin);
  }
});
