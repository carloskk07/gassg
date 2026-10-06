import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {
  createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  DomainError,
  assertPermanentMerchantUser,
  asNonNegativeCents,
  asPositiveInt,
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
function canOperate(role:string){return ["owner","manager","operator"].includes(role)}
function canManage(role:string){return ["owner","manager"].includes(role)}
function configExpectedAt(value:unknown){
  const raw=String(value??"").trim();
  if(!raw||!Number.isFinite(Date.parse(raw))){
    throw new DomainError("CONFIG_VERSION_REQUIRED","Atualize o painel antes de salvar esta configuração.",409);
  }
  return raw;
}
function mutationIdempotencyKey(req:Request){
  const key=String(req.headers.get("Idempotency-Key")??"").trim();
  if(key.length<12||key.length>120||!/^[A-Za-z0-9._:-]+$/.test(key)){
    throw new DomainError("INVALID_IDEMPOTENCY_KEY","Chave idempotente obrigatória para salvar configuração.",400);
  }
  return key;
}
async function applyMerchantConfig(admin:any,{
  req,userId,merchantId,action,expectedUpdatedAt,payload
}:{
  req:Request,userId:string,merchantId:string,action:string,expectedUpdatedAt:string,payload:Record<string,unknown>
}){
  const idempotencyKey=mutationIdempotencyKey(req);
  const requestHash=await requestFingerprint(action,{merchantId,expectedUpdatedAt,payload});
  const {data,error}=await admin.rpc("merchant_config_action",{
    p_user_id:userId,
    p_merchant_id:merchantId,
    p_action:action,
    p_expected_updated_at:expectedUpdatedAt,
    p_payload:payload,
    p_idempotency_key:idempotencyKey,
    p_request_hash:requestHash
  });
  if(error){
    const message=String(error.message??error);
    if(message.includes("CONFIG_VERSION_REQUIRED")){
      throw new DomainError("CONFIG_VERSION_REQUIRED","Atualize o painel antes de salvar esta configuração.",409);
    }
    if(message.includes("CONFIG_VERSION_CONFLICT")){
      throw new DomainError("CONFIG_VERSION_CONFLICT","A configuração mudou em outra aba. O painel foi atualizado; revise antes de salvar novamente.",409);
    }
    if(message.includes("IDEMPOTENCY_CONFLICT")){
      throw new DomainError("IDEMPOTENCY_CONFLICT","Esta tentativa já foi usada com outro conteúdo.",409);
    }
    if(message.includes("IDEMPOTENCY_STATE_INVALID")){
      throw new DomainError("IDEMPOTENCY_STATE_INVALID","Não foi possível confirmar a gravação idempotente.",409);
    }
    throw error;
  }
  return data;
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  if(!originAllowed(origin))return json({error:"ORIGIN_NOT_ALLOWED"},403,origin);
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405,origin);

  try{
    const user=await authenticatedUser(req);
    const body=await readJsonBody(req);
    const merchantId=String(body.merchantId??"");
    const action=String(body.action??"");
    if(!UUID_RE.test(merchantId))throw new DomainError("INVALID_MERCHANT","Revenda inválida.",400);
    if(!["heartbeat","set-online","update-product","update-logistics","update-capacity","update-scheduling","update-payment-methods","update-member-profile"].includes(action)){
      throw new DomainError("INVALID_ACTION","Ação inválida.",400);
    }

    const admin=createClient(SUPABASE_URL,SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    await enforceApiQuota(admin,{userId:user.id,actionName:"merchant-ops",limit:180,windowSeconds:60});
    const {data:membership,error:membershipError}=await admin
      .from("merchant_members")
      .select("member_role,active")
      .eq("merchant_id",merchantId)
      .eq("user_id",user.id)
      .eq("active",true)
      .maybeSingle();
    if(membershipError)throw membershipError;
    if(!membership)throw new DomainError("MERCHANT_ACCESS_DENIED","Você não possui acesso a esta revenda.",403);

    const role=membership.member_role;
    const now=new Date().toISOString();

    if(action==="update-member-profile"){
      const displayName=String(body.displayName??"").trim().replace(/\s+/g," ");
      if(displayName.length<2||displayName.length>60||/[\u0000-\u001F\u007F]/.test(displayName)){
        throw new DomainError("INVALID_DISPLAY_NAME","Informe um nome operacional entre 2 e 60 caracteres.",400);
      }
      const {data,error}=await admin
        .from("merchant_members")
        .update({display_name:displayName})
        .eq("merchant_id",merchantId)
        .eq("user_id",user.id)
        .eq("active",true)
        .select("member_role,display_name")
        .single();
      if(error)throw error;
      return json({
        ok:true,
        memberRole:data.member_role,
        displayName:data.display_name
      },200,origin);
    }

    if(action==="heartbeat"){
      if(!canOperate(role))throw new DomainError("MERCHANT_ACCESS_DENIED","Seu papel não pode manter a operação ativa.",403);
      const {error}=await admin.from("merchants").update({last_seen_at:now}).eq("id",merchantId);
      if(error)throw error;
      return json({ok:true,lastSeenAt:now},200,origin);
    }

    if(action==="set-online"){
      if(!canOperate(role))throw new DomainError("MERCHANT_ACCESS_DENIED","Seu papel não pode alterar a operação.",403);
      const online=body.online===true;

      if(online){
        const {data:merchant,error:merchantError}=await admin
          .from("merchants")
          .select("status,delivery_fee_confirmed_at,accepts_citywide")
          .eq("id",merchantId)
          .maybeSingle();
        if(merchantError)throw merchantError;
        if(!merchant||merchant.status!=="active"){
          throw new DomainError("MERCHANT_NOT_ACTIVE","A revenda ainda não está ativa.",409);
        }
        const feeConfirmedAt=Date.parse(merchant.delivery_fee_confirmed_at??"");
        if(!Number.isFinite(feeConfirmedAt)||Date.now()-feeConfirmedAt>24*60*60*1000){
          throw new DomainError("DELIVERY_FEE_CONFIRMATION_REQUIRED","Confirme a taxa de entrega antes de ficar online.",409);
        }
        if(merchant.accepts_citywide!==true){
          throw new DomainError(
            "DELIVERY_AREA_REQUIRED",
            "Ative o atendimento em São Gabriel antes de ficar online neste piloto.",
            409
          );
        }

        const {count:paymentCount,error:paymentError}=await admin
          .from("merchant_payment_methods")
          .select("*",{count:"exact",head:true})
          .eq("merchant_id",merchantId)
          .eq("active",true);
        if(paymentError)throw paymentError;
        if(!paymentCount){
          throw new DomainError(
            "PAYMENT_METHOD_REQUIRED",
            "Ative pelo menos uma forma de pagamento antes de ficar online.",
            409
          );
        }

        const {data:available,error:availableError}=await admin
          .from("catalog_items")
          .select("product_code,price_confirmed_at")
          .eq("merchant_id",merchantId)
          .eq("active",true)
          .gt("available_stock",0);
        if(availableError)throw availableError;
        if(!available?.length)throw new DomainError("NO_AVAILABLE_STOCK","Nenhum produto possui estoque disponível.",409);
        const stale=available.filter((item)=>{
          const ts=Date.parse(item.price_confirmed_at??"");
          return !Number.isFinite(ts)||Date.now()-ts>24*60*60*1000;
        });
        if(stale.length){
          throw new DomainError(
            "PRICE_CONFIRMATION_REQUIRED",
            "Confirme o preço de todos os produtos com estoque antes de ficar online.",
            409
          );
        }
      }

      let onlineUpdate=admin
        .from("merchants")
        .update({online,last_seen_at:now})
        .eq("id",merchantId);
      if(online)onlineUpdate=onlineUpdate.eq("accepts_citywide",true);
      const {data,error}=await onlineUpdate
        .select("online,last_seen_at")
        .maybeSingle();
      if(error)throw error;
      if(!data&&online){
        throw new DomainError(
          "DELIVERY_AREA_REQUIRED",
          "A área de entrega mudou em outra ação. Atualize o painel antes de ficar online.",
          409
        );
      }
      if(!data)throw new DomainError("MERCHANT_NOT_FOUND","Revenda não encontrada.",404);
      return json({ok:true,...data},200,origin);
    }

    if(action==="update-product"){
      if(!canManage(role))throw new DomainError("MERCHANT_ACCESS_DENIED","Somente owner/manager pode alterar catálogo.",403);
      const productCode=String(body.productCode??"").trim().toUpperCase();
      if(!/^[A-Z][A-Z0-9_]{1,31}$/.test(productCode)){
        throw new DomainError("INVALID_PRODUCT","Produto inválido.",400);
      }
      const {data:productProfile,error:productProfileError}=await admin
        .from("product_delivery_profiles")
        .select("product_code,product_name,category_key,active,merchant_add_allowed")
        .eq("product_code",productCode)
        .eq("active",true)
        .eq("merchant_add_allowed",true)
        .maybeSingle();
      if(productProfileError)throw productProfileError;
      if(!productProfile){
        throw new DomainError("INVALID_PRODUCT","Este produto não está disponível para inclusão no catálogo.",400);
      }
      const {data:productCategory,error:productCategoryError}=await admin
        .from("product_categories")
        .select("category_key,active")
        .eq("category_key",productProfile.category_key)
        .eq("active",true)
        .maybeSingle();
      if(productCategoryError)throw productCategoryError;
      if(!productCategory){
        throw new DomainError("INVALID_PRODUCT","A categoria deste produto está pausada.",400);
      }
      const productName=String(productProfile.product_name);
      const priceCents=asPositiveInt(body.priceCents,"priceCents",{min:1,max:1000000});
      const availableStock=asPositiveInt(body.availableStock,"availableStock",{min:0,max:100000});
      const active=body.active!==false;

      const {data:existingCatalog,error:existingCatalogError}=await admin
        .from("catalog_items")
        .select("price_cents,pricing_mode,min_price_cents,max_price_cents,pricing_strategy,available_stock,active,price_confirmed_at,updated_at")
        .eq("merchant_id",merchantId)
        .eq("product_code",productCode)
        .maybeSingle();
      if(existingCatalogError)throw existingCatalogError;

      const pricingMode=body.pricingMode==null
        ? String(existingCatalog?.pricing_mode??"fixed")
        : String(body.pricingMode).trim().toLowerCase();
      if(!["fixed","range"].includes(pricingMode)){
        throw new DomainError("INVALID_PRICING_MODE","Modo de preço inválido.",400);
      }

      const pricingStrategy=body.pricingStrategy==null
        ? String(existingCatalog?.pricing_strategy??"balanced")
        : String(body.pricingStrategy).trim().toLowerCase();
      if(!["volume","balanced","margin"].includes(pricingStrategy)){
        throw new DomainError("INVALID_PRICING_STRATEGY","Estratégia de preço inválida.",400);
      }

      let minPriceCents=priceCents;
      let maxPriceCents=priceCents;
      if(pricingMode==="range"){
        minPriceCents=body.minPriceCents==null
          ? asPositiveInt(existingCatalog?.min_price_cents??priceCents,"minPriceCents",{min:1,max:1000000})
          : asPositiveInt(body.minPriceCents,"minPriceCents",{min:1,max:1000000});
        maxPriceCents=body.maxPriceCents==null
          ? asPositiveInt(existingCatalog?.max_price_cents??priceCents,"maxPriceCents",{min:1,max:1000000})
          : asPositiveInt(body.maxPriceCents,"maxPriceCents",{min:1,max:1000000});
        if(minPriceCents>priceCents||priceCents>maxPriceCents){
          throw new DomainError(
            "INVALID_PRICE_RANGE",
            "O preço normal precisa ficar entre o mínimo e o máximo autorizados.",
            400
          );
        }
      }

      const expectedUpdatedAt=existingCatalog
        ? String(body.expectedUpdatedAt??"").trim()
        : null;
      if(existingCatalog&&(!expectedUpdatedAt||!Number.isFinite(Date.parse(expectedUpdatedAt)))){
        throw new DomainError(
          "CATALOG_VERSION_REQUIRED",
          "Atualize o painel antes de salvar este produto.",
          409
        );
      }

      const catalogPayload={
        productCode,
        priceCents,
        pricingMode,
        minPriceCents,
        maxPriceCents,
        pricingStrategy,
        availableStock,
        active
      };
      const idempotencyKey=mutationIdempotencyKey(req);
      const requestHash=await requestFingerprint("update-product",{
        merchantId,
        expectedUpdatedAt,
        ...catalogPayload
      });
      const {data,error}=await admin.rpc("merchant_catalog_action",{
        p_user_id:user.id,
        p_merchant_id:merchantId,
        p_product_code:productCode,
        p_expected_updated_at:expectedUpdatedAt,
        p_price_cents:priceCents,
        p_pricing_mode:pricingMode,
        p_min_price_cents:minPriceCents,
        p_max_price_cents:maxPriceCents,
        p_pricing_strategy:pricingStrategy,
        p_available_stock:availableStock,
        p_active:active,
        p_idempotency_key:idempotencyKey,
        p_request_hash:requestHash
      });
      if(error){
        const message=String(error.message??error);
        if(message.includes("CATALOG_VERSION_REQUIRED")){
          throw new DomainError("CATALOG_VERSION_REQUIRED","Atualize o painel antes de salvar este produto.",409);
        }
        if(message.includes("CATALOG_VERSION_CONFLICT")){
          throw new DomainError("CATALOG_VERSION_CONFLICT","O estoque ou preço mudou em outra ação. Atualize o painel antes de salvar novamente.",409);
        }
        if(message.includes("IDEMPOTENCY_CONFLICT")){
          throw new DomainError("IDEMPOTENCY_CONFLICT","Esta tentativa já foi usada com outro conteúdo.",409);
        }
        if(message.includes("IDEMPOTENCY_STATE_INVALID")){
          throw new DomainError("IDEMPOTENCY_STATE_INVALID","Não foi possível confirmar a gravação idempotente.",409);
        }
        if(message.includes("INVALID_PRODUCT")){
          throw new DomainError("INVALID_PRODUCT","Este produto ou categoria não está disponível para alteração.",409);
        }
        throw error;
      }
      if(!data?.product)throw new DomainError("CATALOG_UPDATE_FAILED","Não foi possível confirmar a atualização do catálogo.",500);
      return json(data,200,origin);
    }

    if(action==="update-payment-methods"){
      if(!canManage(role))throw new DomainError("MERCHANT_ACCESS_DENIED","Somente owner/manager pode alterar formas de pagamento.",403);
      const methods={
        pix:body.pix===true,
        card:body.card===true,
        cash:body.cash===true
      };
      if(!Object.values(methods).some(Boolean)){
        throw new DomainError("PAYMENT_METHOD_REQUIRED","Ative pelo menos uma forma de pagamento.",400);
      }
      const data=await applyMerchantConfig(admin,{
        req,userId:user.id,merchantId,action,
        expectedUpdatedAt:configExpectedAt(body.expectedUpdatedAt),
        payload:methods
      });
      return json(data,200,origin);
    }

    if(action==="update-scheduling"){
      if(!canManage(role))throw new DomainError("MERCHANT_ACCESS_DENIED","Somente owner/manager pode alterar agendamento.",403);
      const payload={acceptsScheduledOrders:body.acceptsScheduledOrders===true};
      const data=await applyMerchantConfig(admin,{
        req,userId:user.id,merchantId,action,
        expectedUpdatedAt:configExpectedAt(body.expectedUpdatedAt),
        payload
      });
      return json(data,200,origin);
    }

    if(action==="update-capacity"){
      if(!canManage(role))throw new DomainError("MERCHANT_ACCESS_DENIED","Somente owner/manager pode alterar capacidade.",403);
      const payload={
        maxActiveOrders:asPositiveInt(body.maxActiveOrders,"maxActiveOrders",{min:1,max:100})
      };
      const data=await applyMerchantConfig(admin,{
        req,userId:user.id,merchantId,action,
        expectedUpdatedAt:configExpectedAt(body.expectedUpdatedAt),
        payload
      });
      return json(data,200,origin);
    }

    if(action==="update-logistics"){
      if(!canManage(role))throw new DomainError("MERCHANT_ACCESS_DENIED","Somente owner/manager pode alterar logística.",403);
      const deliveryFeeCents=asNonNegativeCents(body.deliveryFeeCents,"deliveryFeeCents");
      if(deliveryFeeCents>100000)throw new DomainError("INVALID_DELIVERY_FEE","Taxa de entrega inválida.",400);
      const payload={
        deliveryFeeCents,
        baseEtaMinutes:asPositiveInt(body.baseEtaMinutes,"baseEtaMinutes",{min:5,max:180}),
        acceptsCitywide:body.acceptsCitywide===true
      };
      const data=await applyMerchantConfig(admin,{
        req,userId:user.id,merchantId,action,
        expectedUpdatedAt:configExpectedAt(body.expectedUpdatedAt),
        payload
      });
      return json(data,200,origin);
    }

    return json({error:"INVALID_ACTION"},400,origin);
  }catch(error){
    if(error instanceof DomainError)return json({error:error.code,message:error.message},error.status,origin);
    const message=error instanceof Error?error.message:String(error);
    if(message.includes("CNPJ_REVERIFICATION_REQUIRED")){
      return json({error:"CNPJ_REVERIFICATION_REQUIRED",message:"A verificação de CNPJ venceu. Solicite nova validação antes de ficar online."},409,origin);
    }
    if(message.includes("ANP_REVERIFICATION_REQUIRED")){
      return json({error:"ANP_REVERIFICATION_REQUIRED",message:"A verificação ANP do GLP venceu. Solicite nova validação antes de ficar online."},409,origin);
    }
    if(message.includes("GLP_REGULATORY_VERIFICATION_REQUIRED")){
      return json({error:"ANP_VERIFICATION_REQUIRED",message:"Este produto GLP exige validação ANP válida."},409,origin);
    }
    console.error("merchant-ops failed",message);
    return json({error:"INTERNAL_ERROR",message:"Não foi possível atualizar a operação."},500,origin);
  }
});
