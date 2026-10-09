const MP_API_BASE="https://api.mercadopago.com";
const MP_TIMEOUT_MS=8000;
const MAX_JSON_BYTES=300000;

function bytesToHex(bytes){
  return [...bytes].map((b)=>b.toString(16).padStart(2,"0")).join("");
}
function hexToBytes(hex){
  if(!/^[0-9a-f]+$/i.test(hex)||hex.length%2!==0)return null;
  const out=new Uint8Array(hex.length/2);
  for(let i=0;i<out.length;i++)out[i]=Number.parseInt(hex.slice(i*2,i*2+2),16);
  return out;
}
function constantTimeEqualHex(a,b){
  const left=hexToBytes(String(a??"").trim());
  const right=hexToBytes(String(b??"").trim());
  if(!left||!right||left.length!==right.length)return false;
  let diff=0;
  for(let i=0;i<left.length;i++)diff|=left[i]^right[i];
  return diff===0;
}
export function mercadoPagoConfigured(accessToken){
  const token=String(accessToken??"").trim();
  return token.length>=20&&!/[\u0000-\u001f\u007f\s]/.test(token);
}
/**
 * @param {string} path
 * @param {{
 *   accessToken: string,
 *   method?: string,
 *   body?: unknown,
 *   idempotencyKey?: string | null,
 *   timeoutMs?: number
 * }} options
 */
export async function mercadoPagoFetch(path,options){
  const {
    accessToken,
    method="GET",
    body=null,
    idempotencyKey=null,
    timeoutMs=MP_TIMEOUT_MS
  }=options;
  if(!mercadoPagoConfigured(accessToken))throw new Error("MERCADOPAGO_ACCESS_TOKEN_INVALID");
  const safePath=String(path??"");
  if(!safePath.startsWith("/")||safePath.includes("://"))throw new Error("MERCADOPAGO_PATH_INVALID");
  const headers=new Headers({
    "Accept":"application/json",
    "Authorization":"Bearer "+String(accessToken).trim()
  });
  if(body!=null)headers.set("Content-Type","application/json");
  if(idempotencyKey){
    const key=String(idempotencyKey).trim();
    if(key.length<8||key.length>120||!/^[A-Za-z0-9._:-]+$/.test(key)){
      throw new Error("MERCADOPAGO_IDEMPOTENCY_KEY_INVALID");
    }
    headers.set("X-Idempotency-Key",key);
  }
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    return await fetch(MP_API_BASE+safePath,{
      method,
      headers,
      body:body==null?undefined:JSON.stringify(body),
      signal:controller.signal
    });
  }finally{
    clearTimeout(timer);
  }
}
export async function readMercadoPagoJson(response){
  const text=await response.text();
  if(new TextEncoder().encode(text).byteLength>MAX_JSON_BYTES){
    throw new Error("MERCADOPAGO_RESPONSE_TOO_LARGE");
  }
  if(!text)return {};
  try{return JSON.parse(text)}catch{throw new Error("MERCADOPAGO_INVALID_JSON")}
}
export function safeMercadoPagoUrl(value){
  const raw=String(value??"").trim();
  if(!raw)return null;
  try{
    const url=new URL(raw);
    if(url.protocol!=="https:"||url.username||url.password)return null;
    const host=url.hostname.toLowerCase();
    if(
      host==="mercadopago.com"
      ||host.endsWith(".mercadopago.com")
      ||host==="mercadopago.com.br"
      ||host.endsWith(".mercadopago.com.br")
    )return url.toString();
  }catch{}
  return null;
}
export function mercadoPagoQrDataUri(value){
  const raw=String(value??"").trim();
  if(!raw||raw.length>550000||!/^[A-Za-z0-9+/=\r\n]+$/.test(raw))return null;
  return "data:image/png;base64,"+raw.replace(/[\r\n]/g,"");
}
export function moneyToCents(value){
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0)return null;
  const cents=Math.round(n*100);
  if(!Number.isSafeInteger(cents)||Math.abs(n*100-cents)>0.0001)return null;
  return cents;
}
export function parseMercadoPagoDate(value){
  const raw=String(value??"").trim();
  if(!raw||!Number.isFinite(Date.parse(raw)))return null;
  return new Date(raw).toISOString();
}
function parseSignatureHeader(value){
  const parts=new Map();
  for(const piece of String(value??"").split(",")){
    const idx=piece.indexOf("=");
    if(idx<=0)continue;
    parts.set(piece.slice(0,idx).trim(),piece.slice(idx+1).trim());
  }
  return {ts:parts.get("ts")??"",v1:parts.get("v1")??""};
}
export async function verifyMercadoPagoWebhook(req,secret,dataId){
  const key=String(secret??"").trim();
  const requestId=String(req.headers.get("x-request-id")??"").trim();
  const signature=String(req.headers.get("x-signature")??"").trim();
  const normalizedId=String(dataId??"").trim().toLowerCase();
  if(key.length<16||!requestId||!signature||!normalizedId)return false;
  const {ts,v1}=parseSignatureHeader(signature);
  if(!/^\d{9,16}$/.test(ts)||!v1||!/^[0-9a-f]{64}$/i.test(v1))return false;
  const manifest=`id:${normalizedId};request-id:${requestId};ts:${ts};`;
  const cryptoKey=await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    {name:"HMAC",hash:"SHA-256"},
    false,
    ["sign"]
  );
  const digest=await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(manifest)
  );
  return constantTimeEqualHex(bytesToHex(new Uint8Array(digest)),v1.toLowerCase());
}
