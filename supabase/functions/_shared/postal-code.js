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

export function normalizeAddressNumber(value){
  const addressNumber=String(value??"").trim().toUpperCase().replace(/\s+/g,"");
  if(!/^[0-9]{1,6}[A-Z]?$/.test(addressNumber)){
    throw new DomainError(
      "INVALID_ADDRESS_NUMBER",
      "Informe o número do endereço usando números e, se necessário, uma letra.",
      400
    );
  }
  return addressNumber;
}

function normalizePlace(value){
  return String(value??"")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/\s+/g," ")
    .toUpperCase();
}

function normalizeText(value,max){
  return String(value??"").trim().replace(/\s+/g," ").slice(0,max);
}

function locationAllowed(city,state){
  return normalizePlace(city)===TARGET_CITY&&normalizePlace(state)===TARGET_STATE;
}
// Supplier evidence, not registration or ANP prospecting, opens new municipalities.
// Existing original-city postal verification is retained for an empty marketplace.
async function cityServiceEligible(admin,city,state){
  if(locationAllowed(city,state))return true;
  const {data,error}=await admin.rpc("market_city_ready",{
    p_city:String(city||""),p_state:String(state||"")
  });
  if(error)throw new DomainError("MARKET_CITY_GATE_UNAVAILABLE","Não foi possível confirmar a cobertura desta cidade.",503);
  return data===true;
}

async function fetchJson(url){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),PROVIDER_TIMEOUT_MS);
  try{
    const response=await fetch(url,{
      method:"GET",
      headers:{"Accept":"application/json","User-Agent":"TAMAO/1.0"},
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
  const city=normalizeText(data.city,120);
  const state=normalizeText(data.state,2).toUpperCase();
  const street=normalizeText(data.street,180);
  const neighborhood=normalizeText(data.neighborhood,160)||null;
  if(!city||!state)return {kind:"unavailable"};
  const ibgeCode=String(data.ibge?.city??"").replace(/\D/g,"")||null;
  return {
    kind:"resolved",
    provider:"brasilapi",
    city,
    state,
    street:street||null,
    neighborhood,
    ibgeCode:/^[0-9]{7}$/.test(ibgeCode??"")?ibgeCode:null
  };
}

async function resolveViaCep(postalCode){
  const result=await fetchJson("https://viacep.com.br/ws/"+encodeURIComponent(postalCode)+"/json/");
  if(result.kind!=="ok")return result;
  const data=result.data??{};
  if(data.erro===true||data.erro==="true")return {kind:"not-found"};
  const city=normalizeText(data.localidade,120);
  const state=normalizeText(data.uf,2).toUpperCase();
  const street=normalizeText(data.logradouro,180);
  const neighborhood=normalizeText(data.bairro,160)||null;
  if(!city||!state)return {kind:"unavailable"};
  const rawIbge=String(data.ibge??"").replace(/\D/g,"");
  return {
    kind:"resolved",
    provider:"viacep",
    city,
    state,
    street:street||null,
    neighborhood,
    ibgeCode:/^[0-9]{7}$/.test(rawIbge)?rawIbge:null
  };
}

async function resolveExternally(postalCode){
  const first=await resolveBrasilApi(postalCode);
  if(first.kind==="resolved"&&first.street)return first;

  const second=await resolveViaCep(postalCode);
  if(second.kind==="resolved"&&second.street)return second;

  const resolved=first.kind==="resolved"?first:(second.kind==="resolved"?second:null);
  if(resolved){
    throw new DomainError(
      "POSTAL_CODE_NOT_STREET_LEVEL",
      "Este CEP não identifica uma rua específica. Informe o CEP do logradouro.",
      422
    );
  }

  if(first.kind==="not-found"&&second.kind==="not-found"){
    throw new DomainError("POSTAL_CODE_NOT_FOUND","CEP não encontrado.",400);
  }
  throw new DomainError(
    "POSTAL_CODE_VALIDATION_UNAVAILABLE",
    "Não foi possível validar o CEP agora. Tente novamente em instantes.",
    503
  );
}

export function canonicalAddress(postal,addressNumberValue){
  const addressNumber=normalizeAddressNumber(addressNumberValue);
  const street=normalizeText(postal?.street,180);
  if(!street){
    throw new DomainError(
      "POSTAL_STREET_UNVERIFIED",
      "Não foi possível confirmar a rua deste CEP.",
      409
    );
  }
  const city=normalizeText(postal?.city,120);
  const state=String(postal?.state??"").toUpperCase();
  const neighborhood=normalizeText(postal?.neighborhood,160);
  const postalDisplay=String(postal?.postalCode??"").replace(/^(\d{5})(\d{3})$/,"$1-$2");
  const base=street+", "+addressNumber;
  const suffix=", "+city+" - "+state+", CEP "+postalDisplay;
  if((base+suffix).length>240){
    throw new DomainError(
      "CANONICAL_ADDRESS_TOO_LONG",
      "Não foi possível representar este endereço com segurança.",
      409
    );
  }
  if(!neighborhood)return base+suffix;
  const available=240-base.length-suffix.length-3;
  return available>=2
    ? base+" - "+neighborhood.slice(0,available)+suffix
    : base+suffix;
}

export async function validateServicePostalCode(admin,value){
  if(!admin?.from)throw new DomainError("POSTAL_CACHE_BACKEND_INVALID","Validação de CEP indisponível.",503);
  const postalCode=normalizePostalCode(value);
  const cutoff=new Date(Date.now()-CACHE_FRESH_MS).toISOString();

  const {data:cached,error:cacheError}=await admin
    .from("postal_code_validation_cache")
    .select("postal_code,city,state,ibge_code,provider,service_area_allowed,street,neighborhood,verified_at")
    .eq("postal_code",postalCode)
    .gte("verified_at",cutoff)
    .maybeSingle();

  if(cacheError){
    throw new DomainError("POSTAL_CACHE_BACKEND_FAILED","Não foi possível validar o CEP agora.",503);
  }

  if(cached&&String(cached.street??"").trim()){
    const allowed=await cityServiceEligible(admin,cached.city,cached.state);
    if(cached.service_area_allowed!==allowed){
      const {error:scopeError}=await admin.from("postal_code_validation_cache")
        .update({service_area_allowed:allowed,updated_at:new Date().toISOString()})
        .eq("postal_code",postalCode);
      if(scopeError)throw new DomainError("POSTAL_CACHE_BACKEND_FAILED","Não foi possível confirmar a cobertura agora.",503);
    }
    if(!allowed)throw new DomainError("POSTAL_CODE_OUTSIDE_SERVICE_AREA",
      "Ainda não há atendimento habilitado neste CEP. Registre seu interesse para ser avisado.",422);
    return {
      postalCode,
      city:cached.city,
      state:cached.state,
      ibgeCode:cached.ibge_code??null,
      provider:cached.provider,
      street:cached.street,
      neighborhood:cached.neighborhood??null,
      cached:true
    };
  }

  const resolved=await resolveExternally(postalCode);
  const allowed=await cityServiceEligible(admin,resolved.city,resolved.state);
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
      street:resolved.street,
      neighborhood:resolved.neighborhood,
      verified_at:now,
      updated_at:now
    },{onConflict:"postal_code"});

  if(writeError){
    throw new DomainError("POSTAL_CACHE_BACKEND_FAILED","Não foi possível confirmar o CEP agora.",503);
  }

  if(!allowed){
    throw new DomainError("POSTAL_CODE_OUTSIDE_SERVICE_AREA","Ainda não há atendimento habilitado neste CEP. Registre seu interesse para ser avisado.",422);
  }

  return {
    postalCode,
    city:resolved.city,
    state:resolved.state,
    ibgeCode:resolved.ibgeCode,
    provider:resolved.provider,
    street:resolved.street,
    neighborhood:resolved.neighborhood??null,
    cached:false
  };
}
