import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";

// V1.289: one-time P-256 VAPID generation inside Supabase Edge.
// The private scalar is sent ONLY to a privileged Supabase RPC which stores
// it in encrypted Vault, and is never returned, logged or published.
const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const secrets=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const SERVICE_KEY=secrets.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
function reply(obj:Record<string,unknown>,status=200):Response{
 return new Response(JSON.stringify(obj),{
  status,headers:{"Content-Type":"application/json; charset=utf-8",
   "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}
 });
}
function base64url(bytes:Uint8Array):string{
 return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-")
  .replace(/\//g,"_").replace(/=+$/,"");
}
async function hash(value:string):Promise<string>{
 const raw=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
 return [...new Uint8Array(raw)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return reply({error:"METHOD_NOT_ALLOWED"},405);
 if(!SUPABASE_URL||SERVICE_KEY.length<20)return reply({error:"NOT_CONFIGURED"},503);
 try{
  const token=req.headers.get("X-Tamao-Cron-Token");
  if(req.headers.has("Authorization")||!token||!/^[0-9a-f]{64}$/.test(token))
   return reply({error:"UNAUTHORIZED"},401);
  const raw=await req.text();
  if(raw.length>100)return reply({error:"INVALID_BODY"},400);
  let body:unknown;
  try{body=JSON.parse(raw)}catch{return reply({error:"INVALID_BODY"},400)}
  if(!body||typeof body!=="object"||Array.isArray(body)||
     (body as Record<string,unknown>).source!=="vapid_setup_v1_289")
    return reply({error:"INVALID_BODY"},400);
  const admin=createClient(SUPABASE_URL,SERVICE_KEY,
   {auth:{persistSession:false,autoRefreshToken:false}});
  const {data:authorized,error:authError}=await admin.rpc(
   "merchant_push_bootstrap_authorize",{p_token_sha:await hash(token)});
  if(authError||authorized!==true)return reply({error:"UNAUTHORIZED"},401);
  const {data:current,error:stateError}=await admin.rpc("merchant_push_public_config");
  if(stateError)return reply({error:"NOT_CONFIGURED"},503);
  if(current?.publicKey&&current?.available===true)
   return reply({ok:true,installed:true,publicKey:current.publicKey,testMode:true});

  // Non-extractable user tokens and signing keys are unrelated. This one-time
  // key pair is extractable briefly solely to import the scalar into Vault.
  const pair=await crypto.subtle.generateKey(
   {name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
  const publicRaw=new Uint8Array(await crypto.subtle.exportKey("raw",pair.publicKey));
  const privateJwk=await crypto.subtle.exportKey("jwk",pair.privateKey);
  const publicKey=base64url(publicRaw);
  if(publicRaw.length!==65||publicRaw[0]!==4||publicKey.length!==87||
     !privateJwk.d||!/^[A-Za-z0-9_-]{43}$/.test(privateJwk.d))
    return reply({error:"INVALID_KEY_FORMAT"},503);
  const {data:installed,error:storeError}=await admin.rpc(
   "merchant_push_install_vapid",{
    p_public_key:publicKey,p_private_key:privateJwk.d,
    p_subject:"https://tamao.com.br"
   });
  if(storeError||installed?.installed!==true)
    return reply({error:"KEY_INSTALL_FAILED"},503);
  return reply({ok:true,installed:true,publicKey:installed.publicKey,testMode:true});
 }catch{
  // Never expose keys or provider errors in responses or logs.
  return reply({error:"SETUP_UNAVAILABLE"},503);
 }
});
