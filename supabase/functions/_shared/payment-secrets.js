function bytesToBase64Url(bytes){
  let binary="";
  for(const b of bytes)binary+=String.fromCharCode(b);
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function base64UrlToBytes(value){
  const raw=String(value??"").trim().replace(/-/g,"+").replace(/_/g,"/");
  if(!raw)return null;
  const padded=raw+"=".repeat((4-raw.length%4)%4);
  try{
    const binary=atob(padded);
    const out=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);
    return out;
  }catch{return null}
}
async function encryptionKey(secret){
  const bytes=base64UrlToBytes(secret);
  if(!bytes||bytes.length!==32)throw new Error("PAYMENT_TOKEN_ENCRYPTION_KEY_INVALID");
  return await crypto.subtle.importKey(
    "raw",bytes,{name:"AES-GCM"},false,["encrypt","decrypt"]
  );
}
export function randomBase64Url(bytes=32){
  const out=new Uint8Array(bytes);
  crypto.getRandomValues(out);
  return bytesToBase64Url(out);
}
export async function sha256Base64Url(value){
  const digest=await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(value))
  );
  return bytesToBase64Url(new Uint8Array(digest));
}
export async function sha256Hex(value){
  const digest=await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(value))
  );
  return [...new Uint8Array(digest)]
    .map((b)=>b.toString(16).padStart(2,"0"))
    .join("");
}
export async function encryptPaymentSecret(secret,keyMaterial,aad){
  const key=await encryptionKey(keyMaterial);
  const nonce=new Uint8Array(12);
  crypto.getRandomValues(nonce);
  const encrypted=await crypto.subtle.encrypt(
    {
      name:"AES-GCM",
      iv:nonce,
      additionalData:new TextEncoder().encode(String(aad??""))
    },
    key,
    new TextEncoder().encode(String(secret))
  );
  return {
    ciphertext:bytesToBase64Url(new Uint8Array(encrypted)),
    nonce:bytesToBase64Url(nonce)
  };
}
export async function decryptPaymentSecret(ciphertext,nonce,keyMaterial,aad){
  const key=await encryptionKey(keyMaterial);
  const cipherBytes=base64UrlToBytes(ciphertext);
  const nonceBytes=base64UrlToBytes(nonce);
  if(!cipherBytes||!nonceBytes||nonceBytes.length!==12){
    throw new Error("PAYMENT_SECRET_CIPHERTEXT_INVALID");
  }
  const plain=await crypto.subtle.decrypt(
    {
      name:"AES-GCM",
      iv:nonceBytes,
      additionalData:new TextEncoder().encode(String(aad??""))
    },
    key,
    cipherBytes
  );
  return new TextDecoder().decode(plain);
}
export function paymentEncryptionConfigured(value){
  const bytes=base64UrlToBytes(value);
  return bytes?.length===32;
}
