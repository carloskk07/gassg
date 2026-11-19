import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {readJsonBody,enforceApiQuota,DomainError} from "../_shared/domain.js";

// V1.1072 — one real public page per authorized participant or published listing.
// Public reads contain only allowlisted information from approved business sources.
// All owner writes require auth.getUser and a fresh owner/manager relationship.
// No purchases, commissions, money movement or referral writes occur here.
const URL_BASE=Deno.env.get("SUPABASE_URL")||"";
const keys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}");
const secrets=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
const PUB=keys.default||Deno.env.get("SUPABASE_ANON_KEY")||"";
const SECRET=secrets.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const ORIGINS=new Set([
 "https://tamao.com.br","https://www.tamao.com.br",
 "https://parceiro.tamao.com.br","https://admin.tamao.com.br"
]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KINDS=new Set(["merchant","customer","listing","agenda","driver","advertiser"]);
const THEMES=new Set(["clean","gold","rose"]);
const TABLE="participant_pages_v1_1072";

class PageError extends Error {
 constructor(public code:string,public status:number=400){super(code);}
}
function allowed(origin:string|null){
 return !origin||ORIGINS.has(origin)||/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin);
}
function headers(origin:string|null){
 return {
  "Access-Control-Allow-Origin":origin&&allowed(origin)?origin:"https://tamao.com.br",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Cache-Control":"no-store",
  "Vary":"Origin",
  "Content-Type":"application/json; charset=utf-8",
  "X-Content-Type-Options":"nosniff"
 };
}
function reply(data:unknown,status=200,origin:string|null=null){
 return new Response(JSON.stringify(data),{status,headers:headers(origin)});
}
const clean=(s:unknown,max:number)=>String(s??"").trim().slice(0,max);
function safeText(value:unknown,max:number){
 const text=clean(value,max);
 if(/[\u0000-\u001f<>]/.test(text))throw new PageError("INVALID_TEXT");
 return text;
}
function normalizeSlug(value:string){
 return value.normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
   .toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")
   .slice(0,55).replace(/-+$/,"")||"participante";
}
function cleanUUID(value:unknown){
 const id=clean(value,40).toLowerCase();
 if(!UUID.test(id))throw new PageError("INVALID_SUBJECT");
 return id;
}
function imageKeys(keys:unknown){
 if(!Array.isArray(keys))return [];
 return [...new Set(keys.filter(x=>typeof x==="string"&&
  /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|jpeg|png|webp)$/.test(x)))].slice(0,6);
}
const admin=createClient(URL_BASE,SECRET,{auth:{persistSession:false,autoRefreshToken:false}});
const auth=createClient(URL_BASE,PUB,{auth:{persistSession:false,autoRefreshToken:false}});

async function owner(req:Request){
 const token=String(req.headers.get("Authorization")||"").replace(/^Bearer\s+/,"").trim();
 if(!token)throw new PageError("LOGIN_REQUIRED",401);
 const {data,error}=await auth.auth.getUser(token);
 if(error||!data?.user||!UUID.test(data.user.id)||data.user.is_anonymous===true)throw new PageError("LOGIN_REQUIRED",401);
 return data.user.id;
}
async function sourceFor(kind:string,subject:string,actor:string|null,publishing:boolean){
 if(kind==="customer"){
  if(actor&&actor!==subject)throw new PageError("NOT_OWNER",403);
  return {title:"Meu TAMÃO",kind,subjectId:subject,ownerId:actor,canPublish:true};
 }
 if(kind==="merchant"){
  if(actor){
   const {data:membership,error}=await admin.from("merchant_members")
    .select("user_id,member_role,active")
    .eq("merchant_id",subject).eq("user_id",actor).eq("active",true)
    .in("member_role",["owner","manager"]).maybeSingle();
   if(error)throw error;
   if(!membership)throw new PageError("NOT_OWNER",403);
  }
  const {data:m,error}=await admin.from("merchants")
   .select("id,name,status").eq("id",subject).maybeSingle();
  if(error)throw error;
  if(!m||m.status==="rejected")throw new PageError("NOT_FOUND",404);
  if(publishing&&m.status!=="active")throw new PageError("NOT_PUBLISHED",409);
  return {title:clean(m.name,120),kind,subjectId:subject,ownerId:actor,
    canPublish:m.status==="active"};
 }
 if(kind==="driver"){
  // Mobility providers are already approved professional listings. A driver
  // page never creates a second identity or bypasses the city activation.
  const {data:l,error}=await admin.from("discovery_listings")
   .select("id,owner_id,title,vertical,status,state_code,city_key")
   .eq("id",subject).maybeSingle();
  if(error)throw error;
  if(!l||l.vertical!=="professionals")throw new PageError("NOT_FOUND",404);
  if(actor&&l.owner_id!==actor)throw new PageError("NOT_OWNER",403);
  const {data:d,error:detailError}=await admin.from("discovery_professional_details")
   .select("occupation").eq("listing_id",subject).maybeSingle();
  if(detailError)throw detailError;
  const occupation=String(d?.occupation||"");
  const moto=/(motot[aá]xi|moto.?taxi)/i.test(occupation);
  const carro=!moto&&/(motorista|t[aá]xi|taxista)/i.test(occupation);
  if(!moto&&!carro)throw new PageError("NOT_FOUND",404);
  const {data:city,error:cityError}=await admin.from("discovery_vertical_cities")
   .select("enabled").eq("vertical","professionals")
   .eq("state_code",l.state_code).eq("city_key",l.city_key).maybeSingle();
  if(cityError)throw cityError;
  const canPublish=l.status==="published"&&city?.enabled===true;
  if(publishing&&!canPublish)throw new PageError("NOT_PUBLISHED",409);
  return {title:clean(l.title,120),kind,subjectId:subject,ownerId:l.owner_id,
   canPublish,vertical:"professionals",driverMode:moto?"moto":"carro"};
 }
 if(kind==="advertiser"){
  // Independent Ads already have a verified owner and an Admin-moderated
  // campaign. Inactive, paused and expired campaigns cannot expose pages.
  const {data:c,error}=await admin.from("ads_independent_campaigns_v1_884")
   .select("id,owner_user_id,advertiser_name,title,description,city,state,destination_url,status,run_started_at,run_ends_at")
   .eq("id",subject).maybeSingle();
  if(error)throw error;
  if(!c)throw new PageError("NOT_FOUND",404);
  if(actor&&c.owner_user_id!==actor)throw new PageError("NOT_OWNER",403);
  const now=Date.now();
  const canPublish=c.status==="active"&&
   Number.isFinite(Date.parse(String(c.run_started_at||"")))&&
   Date.parse(String(c.run_started_at))<=now&&
   Date.parse(String(c.run_ends_at||""))>now&&
   Boolean(safeAdvertiserURL(c.destination_url));
  if(publishing&&!canPublish)throw new PageError("NOT_PUBLISHED",409);
  return {title:clean(c.advertiser_name,120),kind,subjectId:subject,
   ownerId:c.owner_user_id,canPublish,advertiser:c};
 }
 if(kind==="listing"){
  const {data:l,error}=await admin.from("discovery_listings")
   .select("id,owner_id,title,vertical,status").eq("id",subject).maybeSingle();
  if(error)throw error;
  if(!l||l.vertical==="stays")throw new PageError("NOT_FOUND",404);
  if(actor&&l.owner_id!==actor)throw new PageError("NOT_OWNER",403);
  if(publishing&&l.status!=="published")throw new PageError("NOT_PUBLISHED",409);
  return {title:clean(l.title,120),kind,subjectId:subject,
    ownerId:l.owner_id,canPublish:l.status==="published",vertical:l.vertical};
 }
 if(kind==="agenda"){
  const {data:a,error}=await admin.from("agenda_pages")
   .select("id,owner_id,title,published,slug").eq("id",subject).maybeSingle();
  if(error)throw error;
  if(!a)throw new PageError("NOT_FOUND",404);
  if(actor&&a.owner_id!==actor)throw new PageError("NOT_OWNER",403);
  if(publishing&&!a.published)throw new PageError("NOT_PUBLISHED",409);
  return {title:clean(a.title,120),kind,subjectId:subject,
    ownerId:a.owner_id,canPublish:a.published,agendaSlug:a.slug};
 }
 throw new PageError("INVALID_KIND");
}
// Merchant TMR... codes invite OTHER merchants only; the checkout intentionally
// rejects TMR for customer referrals. A storefront therefore uses the verified
// participating account's CUSTOMER network code, while sellerId separately
// binds the store. This preserves old reward rules instead of fabricating grants.
async function refFor(kind:string,subjectId:string,ownerId:string){
 if(kind==="merchant"){
  const {data:member,error:memberError}=await admin.from("merchant_members")
   .select("user_id").eq("merchant_id",subjectId).eq("user_id",ownerId)
   .eq("active",true).in("member_role",["owner","manager"]).maybeSingle();
  if(memberError)throw memberError;
  if(!member)return "";
 }
 const {data,error}=await admin.from("profiles")
  .select("referral_code").eq("user_id",ownerId).maybeSingle();
 if(error)throw error;
 const code=clean(data?.referral_code,40).toUpperCase();
 return /^[A-Z0-9]{5,40}$/.test(code)&&!/^TMR[A-F0-9]{24}$/.test(code)?code:"";
}
function safeAdvertiserURL(raw:unknown){
 const value=String(raw||"").trim();
 if(value.length<15||value.length>300||/[<>\s@\\]/.test(value))return "";
 try{
  const u=new URL(value),host=u.hostname.toLowerCase();
  return u.protocol==="https:"&&!u.username&&!u.password&&(!u.port||u.port==="443")
   &&host.includes(".")&&!host.endsWith(".local")&&!host.endsWith(".internal")
   &&!host.endsWith(".localhost")&&host!=="localhost"
   &&!/^\d+\.\d+\.\d+\.\d+$/.test(host)&&!host.startsWith("[")
   &&u.href.length<=300?u.href:"";
 }catch{return ""}
}
function publicURL(slug:string){return "https://tamao.com.br/p/"+slug+"/";}
async function view(slug:string){
 if(slug.length<4||slug.length>80||!SLUG.test(slug))throw new PageError("NOT_FOUND",404);
 const {data:page,error}=await admin.from(TABLE)
  .select("kind,subject_id,owner_id,slug,template,headline,tagline,published")
  .eq("slug",slug).eq("published",true).maybeSingle();
 if(error)throw error;
 if(!page)throw new PageError("NOT_FOUND",404);
 const source=await sourceFor(page.kind,page.subject_id,null,true);
 if(!source.canPublish)throw new PageError("NOT_FOUND",404);
 // A changed owner must not inherit the previous owner's first-touch code.
 // Merchant managers are checked independently in refFor().
 if(!["merchant","customer"].includes(page.kind)&&source.ownerId!==page.owner_id)
  throw new PageError("NOT_FOUND",404);
 const code=await refFor(page.kind,page.subject_id,page.owner_id);
 // A published link must never silently lose its verified first-touch identity
 // when the original manager's privileges or referral eligibility changes.
 if(!code)throw new PageError('NOT_FOUND',404);
 const base={
  source:"participant_native_page_v1_1072",
  kind:page.kind,slug:page.slug,url:publicURL(page.slug),
  name:source.title,
  headline:clean(page.headline,110)||source.title,
  tagline:clean(page.tagline,320),
  theme:THEMES.has(page.template)?page.template:"clean",
  referralCode:code,
  items:[] as Array<{code:string,name:string}>,photos:[] as string[],
  city:"",state:"",details:"",agendaSlug:"",listingId:"",vertical:"",merchantId:"",
  driverMode:"",campaignId:"",destinationUrl:""
 };
 if(page.kind==="merchant"){
  base.merchantId=page.subject_id;
  const {data:info,error:infoError}=await admin.from("merchant_business_details")
    .select("trade_name,city,state").eq("merchant_id",page.subject_id).maybeSingle();
  if(infoError)throw infoError;
  // Public merchant identity is the approved merchant name; never legal name,
  // owner, CNPJ, delivery address, personal phone or financial state.
  const tradeName=clean(info?.trade_name,120);
  if(tradeName){
   base.name=tradeName;
   if(!clean(page.headline,110))base.headline=tradeName;
  }
  base.city=clean(info?.city,100);base.state=clean(info?.state,2);
  const {data:catalog,error:catalogError}=await admin.from("catalog_items")
    .select("product_code,product_name").eq("merchant_id",page.subject_id)
    .eq("active",true).order("product_code",{ascending:true}).limit(20);
  if(catalogError)throw catalogError;
  base.items=(catalog||[]).filter(i=>/^[A-Z][A-Z0-9_]{1,31}$/.test(i.product_code))
   .map(i=>({code:i.product_code,name:clean(i.product_name,80)}));
 }
 if(page.kind==="advertiser"){
  const c=source.advertiser;
  if(!c||!safeAdvertiserURL(c.destination_url))throw new PageError("NOT_FOUND",404);
  base.name=clean(c.advertiser_name,120);
  if(!clean(page.headline,110))base.headline=clean(c.title,80);
  base.city=clean(c.city,100);base.state=clean(c.state,2);
  base.details=clean(c.description,240);
  base.campaignId=page.subject_id;
  base.destinationUrl=safeAdvertiserURL(c.destination_url);
 }
 if(page.kind==="listing"||page.kind==="driver"){
  const {data:list,error:listError}=await admin.rpc("discovery_public_search",{
   p_listing_id:page.subject_id,
   p_vertical:source.vertical,
   p_limit:1
  });
  if(listError)throw listError;
  const listing=Array.isArray(list)?list.find(x=>x?.id===page.subject_id):null;
  if(!listing)throw new PageError("NOT_FOUND",404);
  if(page.kind==="driver"){
   const occupation=String(listing.occupation||"");
   const moto=/(motot[aá]xi|moto.?taxi)/i.test(occupation);
   const carro=!moto&&/(motorista|t[aá]xi|taxista)/i.test(occupation);
   if((source.driverMode==="moto"&&!moto)||(source.driverMode==="carro"&&!carro))
    throw new PageError("NOT_FOUND",404);
   base.driverMode=source.driverMode;
  }
  base.listingId=page.subject_id;base.vertical=source.vertical;
  base.name=clean(listing.title,120)||source.title;
  base.city=clean(listing.city_name,120);base.state=clean(listing.state_code,2);
  base.details=clean(listing.description,2000);
  base.photos=imageKeys(listing.photo_urls);
 }
 if(page.kind==="agenda"){
  const {data:a,error:aErr}=await admin.from("agenda_pages")
   .select("slug,about,city,photo_paths").eq("id",page.subject_id).eq("published",true).maybeSingle();
  if(aErr)throw aErr;
  if(!a)throw new PageError("NOT_FOUND",404);
  base.agendaSlug=String(a.slug||"");base.city=clean(a.city,100);
  base.details=clean(a.about,1000);
  // Agenda already publishes these owner-uploaded photos in the same public
  // approved photo bucket; reuse only strict storage keys, never signed URLs.
  base.photos=imageKeys(a.photo_paths);
 }
 return base;
}
async function save(body:Record<string,unknown>,actor:string){
 const kind=clean(body.kind,25),subject=kind==="customer"?actor:cleanUUID(body.subjectId);
 if(!KINDS.has(kind))throw new PageError("INVALID_KIND");
 const published=body.published===true;
 const source=await sourceFor(kind,subject,actor,published);
 // The same page must be a usable network link, never a silent untracked
 // landing. Existing verified attribution codes are reused, not fabricated.
 if(published&&!(await refFor(kind,subject,source.ownerId||actor))){
  throw new PageError("NO_REFERRAL_CODE",409);
 }
 const template=clean(body.theme,25)||"clean";
 if(!THEMES.has(template))throw new PageError("INVALID_THEME");
 const headline=safeText(body.headline,110),tagline=safeText(body.tagline,320);
 const {data:existing,error:readError}=await admin.from(TABLE)
  .select("id,slug,owner_id").eq("kind",kind).eq("subject_id",subject).maybeSingle();
 if(readError)throw readError;
 const slug=existing?.slug||normalizeSlug(source.title)+"-"+subject.replace(/-/g,"").slice(0,12);
 if(!SLUG.test(slug)||slug.length>80)throw new PageError("INVALID_SLUG");
 const input={
  // An authorized new manager can take over a store page after a prior
  // manager leaves; keep the permanent slug but refresh its referral owner.
  kind,subject_id:subject,owner_id:actor,slug,template,
  headline,tagline,published,updated_at:new Date().toISOString()
 };
 const {data,error}=await admin.from(TABLE).upsert(input,{onConflict:"kind,subject_id"})
  .select("kind,subject_id,slug,template,headline,tagline,published").single();
 if(error)throw error;
 return {source:"participant_native_page_v1_1072",page:{
  kind:data.kind,subjectId:data.subject_id,slug:data.slug,url:publicURL(data.slug),
  theme:data.template,headline:data.headline,tagline:data.tagline,published:data.published
 }};
}
async function mine(body:Record<string,unknown>,actor:string){
 const kind=clean(body.kind,25),subject=kind==="customer"?actor:cleanUUID(body.subjectId);
 if(!KINDS.has(kind))throw new PageError("INVALID_KIND");
 await sourceFor(kind,subject,actor,false);
 const {data,error}=await admin.from(TABLE)
  .select("kind,subject_id,slug,template,headline,tagline,published")
  .eq("kind",kind).eq("subject_id",subject).maybeSingle();
 if(error)throw error;
 return {source:"participant_native_page_v1_1072",page:data?{
  kind:data.kind,subjectId:data.subject_id,slug:data.slug,url:publicURL(data.slug),
  theme:data.template,headline:data.headline,tagline:data.tagline,published:data.published
 }:null};
}

Deno.serve(async req=>{
 const origin=req.headers.get("Origin");
 if(!allowed(origin))return reply({error:"ORIGIN_NOT_ALLOWED"},403,origin);
 if(req.method==="OPTIONS")return new Response("ok",{headers:headers(origin)});
 if(req.method!=="POST")return reply({error:"METHOD_NOT_ALLOWED"},405,origin);
 try{
  const body=await readJsonBody(req,{maxBytes:6000}) as Record<string,unknown>;
  const action=clean(body.action,20);
  if(action==="view")return reply(await view(clean(body.slug,82).toLowerCase()),200,origin);
  if(action!=="save"&&action!=="mine")throw new PageError("INVALID_ACTION");
  const user=await owner(req);
  await enforceApiQuota(admin,{userId:user,actionName:"participant-pages-owner",limit:30,windowSeconds:60});
  return reply(action==="save"?await save(body,user):await mine(body,user),200,origin);
 }catch(e){
  if(e instanceof PageError)return reply({error:e.code},e.status,origin);
  if(e instanceof DomainError)return reply({error:e.code},e.status,origin);
  console.error("participant-pages failed",e instanceof Error?e.message:String(e));
  return reply({error:"UNAVAILABLE"},503,origin);
 }
});
