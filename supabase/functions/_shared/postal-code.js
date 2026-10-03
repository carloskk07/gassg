import {DomainError} from "./domain.js";

const CACHE_FRESH_MS=30*24*60*60*1000;
const PROVIDER_TIMEOUT_MS=3500;
const TARGET_CITY="SAO GABRIEL";
const TARGET_STATE="RS";

export function normalizePostalCode(value){
  const postalCode=String(value??"").replace(/\D/g,"");
  if(!/^[0-9]{8}$/.test(postalCode)){
    throw new DomainError("INVALID_POSTAL_CODE","Informe um CEP válido com 8 dígitos.",400);
  }
  return postalCode;
}

function normalizePlace(value){
  return String(value??"")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/\s+/g," ")
    .toUpperCase();
}

function locationAllowed(city,state){
  return normalizePlace(city)===TARGET_CITY&&normalizePlace(state)===TARGET_STATE;
}

async function fetchJson(url){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),PROVIDER_TIMEOUT_MS);
  try{
    const response=await fetch(url,{
      method:"GET",
      headers:{"Accept":"application/json","User-Agent":"Chama-Sao-Gabriel/1.0"},
      signal:controller.signal
    });
    if(response.status===404)return {kind:"not-found"};
    if(!response.ok)return {kind:"unavailable",status:response.status};
    const data=await response.json();
    return {kind:"ok",data};
  }catch(error){
    return {
      kind:error instanceof DOMException&&error.name==="AbortError"?"timeout":"unavailable"
    };
  }finally{
    clearTimeout(timer);
  }
}

async function resolveBrasilApi(postalCode){
  const result=await fetchJson("https://brasilapi.com.br/api/cep/v1/"+encodeURIComponent(postalCode));
  if(result.kind!=="ok")return result;
  const data=result.data??{};
  const city=String(data.city??"").trim();
  const state=String(data.state??"").trim().toUpperCase();
  if(!city||!state)return {kind:"unavailable"};
  const ibgeCode=String(data.ibge?.city??"").replace(/\D/g,"")||null;
  return {
    kind:"resolved",
    provider:"brasilapi",
    city,
    state,
    ibgeCode:/^[0-9]{7}$/.test(ibgeCode??"")?ibgeCode:null
  };
}

async function resolveViaCep(postalCode){
  const result=await fetchJson("https://viacep.com.br/ws/"+encodeURIComponent(postalCode)+"/json/");
  if(result.kind!=="ok")return result;
  const data=result.data??{};
  if(data.erro===true||data.erro==="true")return {kind:"not-found"};
  const city=String(data.localidade??"").trim();
  const state=String(data.uf??"").trim().toUpperCase();
  if(!city||!state)return {kind:"unavailable"};
  const rawIbge=String(data.ibge??"").replace(/\D/g,"");
  return {
    kind:"resolved",
    provider:"viacep",
    city,
    state,
    ibgeCode:/^[0-9]{7}$/.test(rawIbge)?rawIbge:null
  };
}

async function resolveExternally(postalCode){
  const first=await resolveBrasilApi(postalCode);
  if(first.kind==="resolved")return first;

  const second=await resolveViaCep(postalCode);
  if(second.kind==="resolved")return second;

  if(first.kind==="not-found"&&second.kind==="not-found"){
    throw new DomainError("POSTAL_CODE_NOT_FOUND","CEP não encontrado.",400);
  }
  throw new DomainError(
    "POSTAL_CODE_VALIDATION_UNAVAILABLE",
    "Não foi possível validar o CEP agora. Tente novamente em instantes.",
    503
  );
}

export async function validateServicePostalCode(admin,value){
  if(!admin?.from)throw new DomainError("POSTAL_CACHE_BACKEND_INVALID","Validação de CEP indisponível.",503);
  const postalCode=normalizePostalCode(value);
  const cutoff=new Date(Date.now()-CACHE_FRESH_MS).toISOString();

  const {data:cached,error:cacheError}=await admin
    .from("postal_code_validation_cache")
    .select("postal_code,city,state,ibge_code,provider,service_area_allowed,verified_at")
    .eq("postal_code",postalCode)
    .gte("verified_at",cutoff)
    .maybeSingle();

  if(cacheError){
    throw new DomainError("POSTAL_CACHE_BACKEND_FAILED","Não foi possível validar o CEP agora.",503);
  }

  if(cached){
    if(cached.service_area_allowed!==true){
      throw new DomainError("POSTAL_CODE_OUTSIDE_SERVICE_AREA","Este CEP não pertence à área atendida em São Gabriel/RS.",422);
    }
    return {
      postalCode,
      city:cached.city,
      state:cached.state,
      ibgeCode:cached.ibge_code??null,
      provider:cached.provider,
      cached:true
    };
  }

  const resolved=await resolveExternally(postalCode);
  const allowed=locationAllowed(resolved.city,resolved.state);
  const now=new Date().toISOString();
  const {error:writeError}=await admin
    .from("postal_code_validation_cache")
    .upsert({
      postal_code:postalCode,
      city:resolved.city,
      state:resolved.state,
      ibge_code:resolved.ibgeCode,
      provider:resolved.provider,
      service_area_allowed:allowed,
      verified_at:now,
      updated_at:now
    },{onConflict:"postal_code"});

  if(writeError){
    throw new DomainError("POSTAL_CACHE_BACKEND_FAILED","Não foi possível confirmar o CEP agora.",503);
  }

  if(!allowed){
    throw new DomainError("POSTAL_CODE_OUTSIDE_SERVICE_AREA","Este CEP não pertence à área atendida em São Gabriel/RS.",422);
  }

  return {
    postalCode,
    city:resolved.city,
    state:resolved.state,
    ibgeCode:resolved.ibgeCode,
    provider:resolved.provider,
    cached:false
  };
}
