// ANP GLP: official response shape documented at gov.br/anp.
const ANP_BASE="https://revendedoresapi.anp.gov.br/v1/glp";
const MAX_PAGES=3; // fail closed rather than silently importing only page 1
const MAX_BYTES=8_000_000;
const MAX_CITY_LENGTH=120;
const VALID_STATES=new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));
export function cityKey(value){
  return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^A-Za-z0-9 ]/g," ").replace(/\s+/g," ").trim().toUpperCase().slice(0,MAX_CITY_LENGTH);
}
export function checkedCity(value,state){
  const name=String(value||"").trim().replace(/\s+/g," ").slice(0,MAX_CITY_LENGTH);
  const uf=String(state||"").trim().toUpperCase();
  const key=cityKey(name);
  if(name.length<2||!VALID_STATES.has(uf)||!/^[A-Z0-9 ]{2,120}$/.test(key))throw Error("INVALID_CITY");
  return {city:name,state:uf,cityKey:key};
}
const val=(obj,...names)=>{
  for(const name of names){const v=obj?.[name];if(v!=null&&String(v).trim())return String(v).trim()}
  return "";
};
const count=(value)=>Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
export function parseAnpPage(payload,{city,state,cityKey:key,page}){
  if(payload?.status!==200||payload?.succeeded!==true||!Array.isArray(payload?.data)){
    throw Error("ANP_RESPONSE_FORMAT_UNKNOWN");
  }
  const meta=payload.searchPageFilter;
  const pages=count(meta?.totalPagina),records=count(meta?.totalRegistro),current=count(meta?.numeroPagina);
  if(pages===null||records===null||current!==page||pages>MAX_PAGES||pages<1||records>MAX_PAGES*5000){
    throw Error("ANP_PAGINATION_INVALID_OR_OVERSIZED");
  }
  if(payload.data.length>5000||payload.data.length>records){
    throw Error("ANP_PAGE_INCONSISTENT");
  }
  const rows=[];
  const seen=new Set();
  for(const row of payload.data){
    const cnpj=val(row,"cnpj","CNPJ").replace(/\D/g,"");
    const name=val(row,"razaoSocial","RazaoSocial");
    const uf=val(row,"uf","UF").toUpperCase();
    const municipality=val(row,"municipio","Municipio");
    if(!/^[0-9]{14}$/.test(cnpj)||!name||uf!==state||cityKey(municipality)!==key){
      throw Error("ANP_ROW_INVALID_OR_WRONG_CITY");
    }
    if(seen.has(cnpj))continue;
    seen.add(cnpj);
    rows.push({
      cnpj,state,city_key:key,city_name:city,
      legal_name:name.slice(0,240),
      address_text:val(row,"endereco","Endereco").slice(0,240)||null,
      distributor:val(row,"distribuidora","Distribuidora").slice(0,160)||null,
      anp_authorization:val(row,"autorizacao","Autorizacao").slice(0,120)||null,
      sigaf_status:val(row,"statusSIGAF","statusSigaf","situacaoSigaf").slice(0,100)||null,
      source_checked_at:new Date().toISOString()
    });
  }
  if(!rows.length&&records>0&&payload.data.length>0)throw Error("ANP_ROWS_NOT_RECOGNIZED");
  return {rows,pages,records};
}
async function getPage({cityKey:key,state},page){
  const query=new URLSearchParams({municipio:key,uf:state,numeropagina:String(page)});
  const controller=new AbortController();
  const abort=setTimeout(()=>controller.abort(),7500);
  try{
    const response=await fetch(ANP_BASE+"?"+query.toString(),{
      method:"GET",headers:{"Accept":"application/json","User-Agent":"TAMAO-Prospects/1.0"},
      signal:controller.signal,redirect:"error"
    });
    if(!response.ok)throw Error("ANP_HTTP_"+response.status);
    const text=await response.text();
    if(text.length>MAX_BYTES)throw Error("ANP_RESPONSE_TOO_LARGE");
    let payload;
    try{payload=JSON.parse(text)}catch{throw Error("ANP_INVALID_JSON")}
    return payload;
  }finally{clearTimeout(abort)}
}
export async function refreshAnpProspects(admin,cityInput,stateInput,{force=false}={}){
  const region=checkedCity(cityInput,stateInput);
  const {error:cityError}=await admin.from("market_cities").upsert({
    state:region.state,city_key:region.cityKey,city_name:region.city
  },{onConflict:"state,city_key",ignoreDuplicates:true});
  if(cityError)throw cityError;
  const {data:previous,error:prevError}=await admin.from("anp_prospect_refreshes")
    .select("last_checked_at,last_count,status")
    .eq("state",region.state).eq("city_key",region.cityKey).maybeSingle();
  if(prevError)throw prevError;
  const elapsed=Date.now()-Date.parse(previous?.last_checked_at||"");
  const retryWindowMs=previous?.status==="unavailable"?60*60*1000:24*60*60*1000;
  if(Number.isFinite(elapsed)&&elapsed<(force?15*60*1000:retryWindowMs)){
    return {...region,updated:false,status:previous.status,lastCount:Number(previous?.last_count||0)};
  }
  try{
    const first=parseAnpPage(await getPage(region,1),{...region,page:1});
    const all=[...first.rows];
    for(let page=2;page<=first.pages;page++){
      const item=parseAnpPage(await getPage(region,page),{...region,page});
      if(item.pages!==first.pages||item.records!==first.records)throw Error("ANP_PAGINATION_CHANGED");
      all.push(...item.rows);
    }
    if(all.length!==first.records){
      // ANP's totalRegistro is an exact response count, never infer completeness.
      throw Error("ANP_INCOMPLETE_RESULT");
    }
    for(let offset=0;offset<all.length;offset+=100){
      const {error}=await admin.rpc("upsert_anp_prospect_batch",{
        p_rows:all.slice(offset,offset+100)
      });
      if(error)throw error;
    }
    const {error}=await admin.from("anp_prospect_refreshes").upsert({
      state:region.state,city_key:region.cityKey,
      last_checked_at:new Date().toISOString(),last_count:all.length,
      status:"ok",last_error:null
    },{onConflict:"state,city_key"});
    if(error)throw error;
    return {...region,updated:true,status:"ok",lastCount:all.length};
  }catch(err){
    const errorName=String(err instanceof Error?err.message:"ANP_UNAVAILABLE").slice(0,120);
    const {error}=await admin.from("anp_prospect_refreshes").upsert({
      state:region.state,city_key:region.cityKey,
      last_checked_at:new Date().toISOString(),last_count:Number(previous?.last_count||0),
      status:"unavailable",last_error:errorName
    },{onConflict:"state,city_key"});
    if(error)throw error;
    return {...region,updated:false,status:"unavailable",lastCount:Number(previous?.last_count||0),error:errorName};
  }
}
