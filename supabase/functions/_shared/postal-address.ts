import {DomainError} from "./domain.js";

const FRESH_CACHE_MS=30*24*60*60*1000;
const STALE_FALLBACK_MS=365*24*60*60*1000;
const PROVIDER_TIMEOUT_MS=4500;

function normalizeText(value:unknown,max:number){
  return String(value??"").trim().replace(/\s+/g," ").slice(0,max);
}

export function normalizePostalCode(value:unknown){
  const postalCode=String(value??"").replace(/\D/g,"");
  if(!/^[0-9]{8}$/.test(postalCode)){
    throw new DomainError("INVALID_POSTAL_CODE","Informe um CEP válido com 8 números.",400);
  }
  return postalCode;
}

export function normalizeAddressNumber(value:unknown){
  const addressNumber=String(value??"").trim().toUpperCase().replace(/\s+/g,"");
  if(!/^[0-9]{1,6}[A-Z]?$/.test(addressNumber)){
    throw new DomainError("INVALID_ADDRESS_NUMBER","Informe o número do endereço usando apenas números e, se necessário, uma letra.",400);
  }
  return addressNumber;
}

function cacheAgeMs(row:any){
  const checked=Date.parse(String(row?.source_checked_at??""));
  return Number.isFinite(checked)?Math.max(0,Date.now()-checked):Number.POSITIVE_INFINITY;
}

function canonicalAddress(row:any,addressNumber:string){
  const neighborhood=normalizeText(row.neighborhood,160);
  const middle=neighborhood?` - ${neighborhood}`:"";
  const postal=String(row.postal_code).replace(/^(\d{5})(\d{3})$/,"$1-$2");
  return `${normalizeText(row.street,180)}, ${addressNumber}${middle}, ${normalizeText(row.city_name,120)} - ${String(row.uf).toUpperCase()}, CEP ${postal}`;
}

async function viaCepLookup(postalCode:string){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),PROVIDER_TIMEOUT_MS);
  try{
    const response=await fetch(`https://viacep.com.br/ws/${postalCode}/json/`,{
      method:"GET",
      headers:{"Accept":"application/json"},
      signal:controller.signal
    });
    if(!response.ok){
      if(response.status===400){
        throw new DomainError("INVALID_POSTAL_CODE","CEP inválido.",400);
      }
      throw new Error("VIACEP_HTTP_"+response.status);
    }
    const payload=await response.json();
    if(payload?.erro===true){
      throw new DomainError("POSTAL_CODE_NOT_FOUND","CEP não encontrado.",400);
    }

    const street=normalizeText(payload?.logradouro,180);
    const city=normalizeText(payload?.localidade,120);
    const uf=normalizeText(payload?.uf,2).toUpperCase();
    const ibge=String(payload?.ibge??"").replace(/\D/g,"");
    const neighborhood=normalizeText(payload?.bairro,160)||null;

    if(!street){
      throw new DomainError(
        "POSTAL_CODE_NOT_STREET_LEVEL",
        "Use o CEP específico da rua para confirmar a entrega.",
        400
      );
    }
    if(!city||!/^[A-Z]{2}$/.test(uf)||!/^[0-9]{7}$/.test(ibge)){
      throw new Error("VIACEP_INCOMPLETE_RESPONSE");
    }

    return {
      postal_code:postalCode,
      street,
      neighborhood,
      city_name:city,
      uf,
      ibge_code:ibge,
      source:"viacep",
      source_checked_at:new Date().toISOString()
    };
  }finally{
    clearTimeout(timeout);
  }
}

export async function resolveDeliveryAddress(admin:any,input:{postalCode:unknown,addressNumber:unknown}){
  const postalCode=normalizePostalCode(input.postalCode);
  const addressNumber=normalizeAddressNumber(input.addressNumber);

  const {data:cached,error:cacheError}=await admin
    .from("postal_code_cache")
    .select("postal_code,street,neighborhood,city_name,uf,ibge_code,source,source_checked_at")
    .eq("postal_code",postalCode)
    .maybeSingle();
  if(cacheError)throw cacheError;

  let resolved:any=cached??null;
  let staleFallback=false;

  if(!resolved||cacheAgeMs(resolved)>FRESH_CACHE_MS){
    try{
      const fresh=await viaCepLookup(postalCode);
      const {error:upsertError}=await admin
        .from("postal_code_cache")
        .upsert({
          ...fresh,
          updated_at:new Date().toISOString()
        },{onConflict:"postal_code"});
      if(upsertError)throw upsertError;
      resolved=fresh;
    }catch(error){
      if(error instanceof DomainError)throw error;
      if(resolved&&cacheAgeMs(resolved)<=STALE_FALLBACK_MS){
        staleFallback=true;
      }else{
        throw new DomainError(
          "ADDRESS_LOOKUP_UNAVAILABLE",
          "Não foi possível validar o CEP agora. Tente novamente em instantes.",
          503
        );
      }
    }
  }

  const {data:serviceArea,error:serviceAreaError}=await admin
    .from("service_areas")
    .select("ibge_code,city_name,uf,active")
    .eq("ibge_code",resolved.ibge_code)
    .eq("active",true)
    .maybeSingle();
  if(serviceAreaError)throw serviceAreaError;

  return {
    postalCode,
    addressNumber,
    street:normalizeText(resolved.street,180),
    neighborhood:normalizeText(resolved.neighborhood,160)||null,
    city:normalizeText(resolved.city_name,120),
    uf:String(resolved.uf).toUpperCase(),
    ibgeCode:String(resolved.ibge_code),
    serviceable:Boolean(serviceArea),
    canonical:canonicalAddress(resolved,addressNumber),
    cacheFresh:!staleFallback,
    source:"viacep"
  };
}
