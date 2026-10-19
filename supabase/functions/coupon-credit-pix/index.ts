import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {
  mercadoPagoConfigured,mercadoPagoFetch,readMercadoPagoJson,
  safeMercadoPagoUrl,mercadoPagoQrDataUri,moneyToCents
} from "../_shared/mercadopago.js";
import {validatePixBrCode} from "../_shared/pix-brcode.js";
import {enforceApiQuota} from "../_shared/domain.js";

// Uses the SAME MERCADOPAGO_ACCESS_TOKEN as merchant-billing-pix. New coupons
// cannot be sold unless verified funding, legal terms and merchant settlement
// already exist and the release switch was expressly enabled server-side.
// No customer-provided monetary amount, merchant or benefit is trusted.
const URL_BASE=Deno.env.get("SUPABASE_URL")??"";
const PUBLISHABLE=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}").default
  ??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}").default
  ??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const MP_TOKEN=String(Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")??"").trim();
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORIGINS=new Set(["https://tamao.com.br","https://www.tamao.com.br",
  "https://tamao-sg-cliente.pages.dev"]);
function cors(origin:string|null){
  const allowed=origin&&ORIGINS.has(origin)?origin:"https://tamao.com.br";
  return {"Access-Control-Allow-Origin":allowed,
    "Access-Control-Allow-Headers":"authorization,apikey,content-type",
    "Access-Control-Allow-Methods":"POST,OPTIONS","Vary":"Origin"};
}
function respond(data:any,status=200,origin:string|null=null){
 return new Response(JSON.stringify(data),{status,headers:{...cors(origin),
  "Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
}
function findPix(order:any){
 const payments=Array.isArray(order?.transactions?.payments)?order.transactions.payments:[];
 return payments.find((p:any)=>p?.payment_method?.id==="pix"
   &&p?.payment_method?.type==="bank_transfer")??null;
}
function publicInvoice(row:any){
 return {invoiceId:row.id,status:row.status,amountCents:row.sale_price_cents,
   provider:"mercadopago",pixCode:row.status==="awaiting_payment"?row.pix_br_code:null,
   paymentUrl:row.status==="awaiting_payment"?row.payment_url:null,
   expiresAt:row.expires_at??null,issuedCoupons:row.status==="paid"?row.coupons_per_pack:0};
}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin");
 if(origin&&!ORIGINS.has(origin))return respond({error:"ORIGIN_NOT_ALLOWED"},403,origin);
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
 if(req.method!=="POST")return respond({error:"METHOD_NOT_ALLOWED"},405,origin);
 if(!URL_BASE||!SECRET||!PUBLISHABLE){
   return respond({error:"COUPON_BACKEND_NOT_CONFIGURED"},503,origin);
 }
 try{
  const token=String(req.headers.get("authorization")??"").replace(/^Bearer /i,"");
  if(!token||token.length>10000)return respond({error:"AUTH_REQUIRED"},401,origin);
  const client=createClient(URL_BASE,PUBLISHABLE,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await client.auth.getUser(token);
  if(authError||!user||!user.email)return respond({error:"AUTH_REQUIRED"},401,origin);
  const raw=await req.text();
  if(new TextEncoder().encode(raw).byteLength>4000)return respond({error:"PAYLOAD_TOO_LARGE"},413,origin);
  let body:any={};
  try{body=JSON.parse(raw||"{}")}catch{return respond({error:"INVALID_JSON"},400,origin)}
  const operation=String(body.action??"purchase");
  const admin=createClient(URL_BASE,SECRET,{auth:{persistSession:false,autoRefreshToken:false}});
  if(operation==="my-vouchers"){
    // Authenticated, read-only reconciliation, available even when coupon
    // sales are disabled. No customer can choose or query another user ID.
    await enforceApiQuota(admin,{
      userId:user.id,actionName:"coupon-credit-pix-read",limit:12,windowSeconds:600
    });
    const {data:invoices,error:invoiceError}=await admin
      .from("clube_coupon_paid_invoices")
      .select("id,package_key,status,sale_price_cents,created_at,paid_at,net_proceeds_cents,net_proceeds_verified_at,coupon_face_cents,coupons_per_pack")
      .eq("customer_user_id",user.id)
      .order("created_at",{ascending:false}).limit(25);
    if(invoiceError)throw invoiceError;
    const paidIds=new Set((invoices||[])
      .filter((row:any)=>row.status==="paid"&&
        row.net_proceeds_verified_at!=null&&
        Number.isSafeInteger(row.net_proceeds_cents)&&
        row.net_proceeds_cents>=row.coupon_face_cents*row.coupons_per_pack)
      .map((row:any)=>String(row.id)));
    const {data:rows,error:issuanceError}=await admin
      .from("clube_coupon_paid_issuances")
      .select("id,invoice_id,ordinal,face_cents,status,expires_at")
      .eq("customer_user_id",user.id)
      .order("expires_at",{ascending:true}).limit(100);
    if(issuanceError)throw issuanceError;
    return respond({
      ok:true,source:"clube_coupon_paid_my_vouchers_v1",
      purchases:(invoices||[]).map((row:any)=>({
        invoiceId:row.id,packageKey:row.package_key,status:row.status,
        amountCents:row.sale_price_cents,createdAt:row.created_at,
        paidAt:row.paid_at
      })),
      vouchers:(rows||[]).filter((row:any)=>paidIds.has(String(row.invoice_id)))
        .map((row:any)=>({
          voucherId:row.id,invoiceId:row.invoice_id,ordinal:row.ordinal,
          faceCents:row.face_cents,status:row.status,expiresAt:row.expires_at
        })),
      couponSalesEnabled:Deno.env.get("CLUBE_COUPON_PAID_SALES_ENABLED")==="true",
      couponCheckoutEnabled:Deno.env.get("CLUBE_COUPON_CHECKOUT_ENABLED")==="true"
    },200,origin);
  }
  if(operation!=="purchase")return respond({error:"COUPON_ACTION_INVALID"},400,origin);
  // Do not receive money until redemption and merchant compensation have
  // been validated end-to-end, even if credentials already exist.
  if(Deno.env.get("CLUBE_COUPON_PAID_SALES_ENABLED")!=="true")
    return respond({error:"COUPON_SALES_NOT_ENABLED"},423,origin);
  if(!mercadoPagoConfigured(MP_TOKEN))
    return respond({error:"MERCADOPAGO_NOT_CONFIGURED"},503,origin);
  const packageKey=String(body.packageKey||"");
  const requestId=String(body.requestId||"");
  if(!/^[a-z][a-z0-9_]{2,39}$/.test(packageKey)||!UUID_RE.test(requestId)){
   return respond({error:"COUPON_REQUEST_INVALID"},400,origin);
  }
  await enforceApiQuota(admin,{userId:user.id,actionName:"coupon-credit-pix",limit:5,windowSeconds:3600});
  const {data:pkg,error:packageError}=await admin.from("clube_coupon_paid_packages")
    .select("package_key,sale_price_cents,coupon_face_cents,coupons_per_pack,valid_days,sale_enabled,funding_verified,legal_terms_verified,redeem_settlement_verified")
    .eq("package_key",packageKey).maybeSingle();
  if(packageError)throw packageError;
  if(!pkg||pkg.sale_enabled!==true||pkg.funding_verified!==true||
    pkg.legal_terms_verified!==true||pkg.redeem_settlement_verified!==true||
    !Number.isSafeInteger(pkg.sale_price_cents)||
    !Number.isSafeInteger(pkg.coupon_face_cents)||
    !Number.isSafeInteger(pkg.coupons_per_pack)||
    pkg.sale_price_cents<pkg.coupon_face_cents*pkg.coupons_per_pack)
   return respond({error:"COUPON_PACKAGE_NOT_AVAILABLE"},409,origin);
  const details={
   customer_user_id:user.id,package_key:packageKey,request_id:requestId,
   sale_price_cents:pkg.sale_price_cents,coupon_face_cents:pkg.coupon_face_cents,
   coupons_per_pack:pkg.coupons_per_pack,valid_days:pkg.valid_days
  };
  const {error:insertError}=await admin.from("clube_coupon_paid_invoices").insert(details);
  // A duplicate may be the same request; always re-read and compare snapshots.
  if(insertError&&!String(insertError.code).includes("23505"))throw insertError;
  const {data:invoice,error:readError}=await admin.from("clube_coupon_paid_invoices")
   .select("*").eq("customer_user_id",user.id).eq("request_id",requestId).single();
  if(readError||!invoice)throw readError??new Error("INVOICE_NOT_FOUND");
  if(invoice.package_key!==packageKey||invoice.sale_price_cents!==pkg.sale_price_cents||
     invoice.coupon_face_cents!==pkg.coupon_face_cents||
     invoice.coupons_per_pack!==pkg.coupons_per_pack){
   return respond({error:"COUPON_REQUEST_REPLAY_CONFLICT"},409,origin);
  }
  if(invoice.status!=="prepared")return respond({ok:true,...publicInvoice(invoice)},200,origin);
  const amount=(Number(invoice.sale_price_cents)/100).toFixed(2);
  const orderRequest={
   type:"online",total_amount:amount,external_reference:invoice.id,
   processing_mode:"automatic",transactions:{payments:[{
    amount,payment_method:{id:"pix",type:"bank_transfer"},
    expiration_time:"P1D"
   }]},payer:{email:user.email}
  };
  const create=await mercadoPagoFetch("/v1/orders",{
    accessToken:MP_TOKEN,method:"POST",idempotencyKey:invoice.id,body:orderRequest
  });
  let order=await readMercadoPagoJson(create);
  if(!create.ok)throw new Error("MERCADOPAGO_COUPON_ORDER_FAILED");
  // Do not return a QR until Mercado Pago's order has a verified BR code.
  for(let attempt=0;attempt<3;attempt++){
   const payment=findPix(order);
   const rawCode=String(payment?.payment_method?.qr_code??"").trim();
   if(order?.id&&order.external_reference===invoice.id&&
     moneyToCents(order.total_amount)===invoice.sale_price_cents&&
     payment?.id&&rawCode){
    if(!validatePixBrCode(rawCode,{expectedAmountCents:invoice.sale_price_cents}).valid)
     throw new Error("MERCADOPAGO_COUPON_PIX_INVALID");
    const patch={provider_order_id:String(order.id),provider_payment_id:String(payment.id),
     pix_br_code:rawCode,payment_url:safeMercadoPagoUrl(payment.payment_method.ticket_url),
     status:"awaiting_payment",expires_at:new Date(Date.now()+86400000).toISOString(),
     updated_at:new Date().toISOString()};
    const {data:committed,error:commitError}=await admin.from("clube_coupon_paid_invoices")
     .update(patch).eq("id",invoice.id).eq("status","prepared").select("*").maybeSingle();
    if(commitError)throw commitError;
    if(!committed){
      const {data:existing,error:existingError}=await admin.from("clube_coupon_paid_invoices")
       .select("*").eq("id",invoice.id).single();
      if(existingError||!existing)throw existingError??new Error("INVOICE_STATE_CONFLICT");
      return respond({ok:true,...publicInvoice(existing)},200,origin);
    }
    return respond({ok:true,...publicInvoice(committed),
      qrImageDataUri:mercadoPagoQrDataUri(payment.payment_method.qr_code_base64)},200,origin);
   }
   const id=String(order?.id??"");
   if(!id)throw new Error("MERCADOPAGO_COUPON_ORDER_INVALID");
   const lookup=await mercadoPagoFetch("/v1/orders/"+encodeURIComponent(id),{accessToken:MP_TOKEN});
   order=await readMercadoPagoJson(lookup);
   if(!lookup.ok)throw new Error("MERCADOPAGO_COUPON_LOOKUP_FAILED");
  }
  throw new Error("MERCADOPAGO_COUPON_PIX_NOT_READY");
 }catch(error){
  console.error("coupon-credit-pix fail closed",error instanceof Error?error.message:String(error));
  return respond({error:"COUPON_PIX_NOT_CONFIRMED",credited:false},503,origin);
 }
});
