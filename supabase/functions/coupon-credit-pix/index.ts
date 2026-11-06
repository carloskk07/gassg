import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {
  mercadoPagoConfigured,mercadoPagoFetch,readMercadoPagoJson,
  safeMercadoPagoUrl,mercadoPagoQrDataUri,moneyToCents,mercadoPagoPixDeadline
} from "../_shared/mercadopago.js";
import {validatePixBrCode} from "../_shared/pix-brcode.js";
import {validateServicePostalCode} from "../_shared/postal-code.js";
import {enforceApiQuota,readJsonBody,platformCommerceAllowed,platformCouponSalesAllowed} from "../_shared/domain.js";

// Uses the SAME MERCADOPAGO_ACCESS_TOKEN as merchant-billing-pix. New coupons
// cannot be sold unless sponsor funding, legal terms and settlement rules
// have been verified and the private release switch enabled server-side.
// Merchant enrollment is NOT a prerequisite to prepare or activate package
// sales; only actual voucher redemption needs an operational merchant.
// No customer-provided monetary amount, merchant or benefit is trusted.
const URL_BASE=Deno.env.get("SUPABASE_URL")??"";
const PUBLISHABLE=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}").default
  ??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}").default
  ??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const MP_TOKEN=String(Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")??"").trim();
// Checkout uses a versioned customer acceptance recorded on the invoice.
// This is not an operator's legal attestation and does not mark a package
// legally approved merely because a customer checked the box.
const COUPON_TERMS_VERSION="clube_coupon_terms_v1_813";

const PARTNER_BUYER_TERMS_VERSION="clube_partner_coupon_terms_v1_846";
const PARTNER_PACKAGE_KEY="partner_general_3x5_849";
// Two independent, verified database gates. Neither an environment variable
// nor a client assertion is allowed to authorize a partner-funded sale.
async function partnerSaleReadiness(admin:any){
 const {data,error}=await admin.rpc("clube_partner_coupon_sale_readiness_v1_849",{
  p_package:PARTNER_PACKAGE_KEY
 });
 if(error)throw error;
 if(data?.source!=="clube_partner_coupon_sale_readiness_v1_849"||
   data?.packageKey!==PARTNER_PACKAGE_KEY)
  throw new Error("PARTNER_COUPON_READINESS_UNVERIFIED");
 return data;
}
async function partnerSignedSeller(admin:any){
 const {data,error}=await admin.from("clube_partner_coupon_sale_agreements_v1_849")
  .select("package_key,terms_version,sales_authorized,seller_name,seller_tax_document,seller_address,seller_support_email,owner_accepts_refund,owner_accepts_partner_nonreimbursement")
  .eq("package_key",PARTNER_PACKAGE_KEY)
  .order("signed_at",{ascending:false}).limit(1).maybeSingle();
 if(error)throw error;
 if(!data||data.package_key!==PARTNER_PACKAGE_KEY||
   data.terms_version!==PARTNER_BUYER_TERMS_VERSION||
   data.sales_authorized!==true||data.owner_accepts_refund!==true||
   data.owner_accepts_partner_nonreimbursement!==true||
   !/^\d{11}$|^\d{14}$/.test(String(data.seller_tax_document??""))||
   String(data.seller_name??"").trim().length<5||
   String(data.seller_address??"").trim().length<20||
   !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(data.seller_support_email??"")))
  return null;
 return data;
}
async function partnerBuyerTerms(admin:any){
 const {data,error}=await admin.from("clube_partner_coupon_buyer_terms_v1_849")
  .select("terms_version,contract_text")
  .eq("terms_version",PARTNER_BUYER_TERMS_VERSION).maybeSingle();
 if(error)throw error;
 if(data?.terms_version!==PARTNER_BUYER_TERMS_VERSION||
    String(data.contract_text??"").length<600)
   throw new Error("PARTNER_COUPON_BUYER_TERMS_NOT_VERIFIED");
 return data.contract_text;
}

// #850: verify buyer-selected CEP against canonical street validation and
// the EXACT same city/stock/compliance merchant scope as get-offers.
async function partnerBuyerSupply(admin:any,value:unknown){
 const postal=await validateServicePostalCode(admin,value);
 const {data,error}=await admin.rpc("clube_partner_coupon_postal_supply_v1_850",{
  p_postal:postal.postalCode
 });
 if(error)throw error;
 if(data?.source!=="clube_partner_coupon_postal_supply_v1_850"||
   data?.postalCode!==postal.postalCode||
   data?.verified!==true||
   typeof data?.ready!=="boolean"||
   !Number.isSafeInteger(data.merchantCount)||
   data.merchantCount<0||data.merchantCount>100000||
   data.city!==postal.city||data.state!==postal.state)
   throw new Error("PARTNER_COUPON_POSTAL_READBACK_CONFLICT");
 return data;
}

// A signed, owner-controlled DB release replaces the absent private
// environment toggle. An explicit value 'false' remains a hard emergency
// stop; an environment flag alone can NEVER impersonate seller approval.
async function couponSaleRelease(admin:any){
 if(Deno.env.get("CLUBE_COUPON_SALES_EMERGENCY_STOP")==="true")return null;
 const {data,error}=await admin.from("clube_coupon_commercial_release_v1_819")
  .select("package_key,enabled,seller_name,seller_tax_document,seller_address,seller_support_email,signed_terms_version,owner_accepts_refund,owner_accepts_merchant_reimbursement,owner_accepts_no_merchant_yet")
  .eq("package_key","all_products_3x5_sponsor").maybeSingle();
 if(error)throw error;
 return data?.enabled===true&&data.signed_terms_version===COUPON_TERMS_VERSION&&
    data.owner_accepts_refund===true&&data.owner_accepts_merchant_reimbursement===true&&
    data.owner_accepts_no_merchant_yet===true&&
    /^\d{11}$|^\d{14}$/.test(String(data.seller_tax_document??""))&&
    String(data.seller_name??"").trim().length>=5&&
    String(data.seller_address??"").trim().length>=20&&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(data.seller_support_email??""))
  ?data:null;
}

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
// The payment provider can omit QR payload on a later GET while preserving
// its own official Pix payment page. Accept ONLY the original HTTPS ticket
// tied to the PSP-confirmed pending Order; never manufacture a BR Code.
function couponOfficialPixTicket(value:any){
 const ticket=safeMercadoPagoUrl(value);
 if(!ticket)return null;
 const url=new URL(ticket);
 if(url.hostname.toLowerCase().split(".").includes("sandbox")
   ||url.pathname.toLowerCase().split("/").includes("sandbox"))return null;
 return ticket;
}
// Fail closed for old/prepared invoices and stale idempotent retries.
// Never show a stored BR code after the provider-backed deadline or the
// conservative 24-hour ceiling from the durable invoice creation time.
function couponInvoiceCanPresent(row:any,nowMs=Date.now()){
 if(row?.status!=="awaiting_payment")return false;
 const anchor=Date.parse(String(row?.created_at??""));
 const expiry=Date.parse(String(row?.expires_at??""));
 const rawTicket=String(row?.payment_url??"").trim();
 const ticket=couponOfficialPixTicket(rawTicket);
 const hasBr=typeof row?.pix_br_code==="string"&&row.pix_br_code.length>=30;
 // Invalid or sandbox payment URL contradicts even a stored QR.
 return Number.isFinite(anchor)&&Number.isFinite(expiry)
   &&Number.isFinite(nowMs)&&expiry<=anchor+86_400_000
   &&expiry>nowMs+60_000
   &&(!rawTicket||Boolean(ticket))&&
   (hasBr||Boolean(ticket));
}
function couponProviderPixPayable(order:any,payment:any){
 const status=String(order?.status??"").trim().toLowerCase();
 const payStatus=String(payment?.status??"").trim().toLowerCase();
 // The order total is NOT proof that its individual Pix is for that amount.
 // Require the independently supplied PSP transaction amount on fresh issue
 // AND on idempotent re-open. The Orders API documents payment.amount.
 return order?.live_mode!==false&&payment?.live_mode!==false
   &&(!order?.currency_id||order.currency_id==="BRL")
   &&(!order?.currency||order.currency==="BRL")
   &&Boolean(String(payment?.id??"").trim())
   &&payment?.payment_method?.id==="pix"
   &&payment?.payment_method?.type==="bank_transfer"
   &&moneyToCents(payment?.amount)!==null
   &&moneyToCents(payment?.amount)===moneyToCents(order?.total_amount)
   &&["action_required","processing"].includes(status)
   &&["","pending","in_process","action_required","processing"].includes(payStatus);
}
// A paid gross Pix is NOT a voucher that can be spent. The existing
// 20261019180000 checkout migration requires PSP-reconciled NET proceeds,
// provider binding and evidence before using that voucher for an order.
function couponInvoiceNetCovered(row:any){
 const face=Number(row?.coupon_face_cents);
 const count=Number(row?.coupons_per_pack);
 const net=row?.net_proceeds_cents;
 // Reserved before the Pix and captured by the payment-confirmation RPC.
 // SQL independently checks this backing on every order / quote reservation.
 const sponsor=Number(row?.sponsor_covered_cents??0);
 const faceTotal=face*count;
 const legacyNetCovered=Number.isSafeInteger(net)&&net>=face*count;
 const partnerNetCovered=row?.funding_mode_v1_846==="partner_funded"&&
   row?.funding_terms_version_v1_846==="clube_partner_coupon_terms_v1_846"&&
   row?.terms_version==="clube_partner_coupon_terms_v1_846"&&
   Boolean(row?.terms_accepted_at)&&
   String(row?.package_key??"").startsWith("partner_")&&
   Number(row?.min_order_cents)>=1000&&
   face<=500&&count<=15&&Number(row?.sponsor_covered_cents)===0;
 // For a NEW partner-funded invoice the PSP NET finances the package sale,
 // while the signed merchant agreement finances the coupon discount.
 // All historical platform-reimbursed coupons keep their existing test.
 const ref=String(row?.net_proceeds_reference??"").trim();
 return row?.status==="paid"&&Boolean(row?.paid_at)&&
   Boolean(row?.provider_order_id)&&Boolean(row?.provider_payment_id)&&
   Number.isSafeInteger(face)&&face>0&&Number.isSafeInteger(count)&&count>0&&
   Number.isSafeInteger(sponsor)&&sponsor>=0&&sponsor<=10000&&
   Number.isSafeInteger(net)&&net>0&&
   (legacyNetCovered||sponsor===faceTotal||partnerNetCovered)&&
   net<=row.sale_price_cents&&
   Number.isFinite(Date.parse(String(row?.net_proceeds_verified_at??"")))&&
   ref.length>=8;
}
function publicInvoice(row:any){
 const payable=couponInvoiceCanPresent(row);
 const covered=couponInvoiceNetCovered(row);
 return {invoiceId:row.id,status:row.status,amountCents:row.sale_price_cents,
  settlementReviewReason:row.status==="review_required"?row.coupon_settlement_hold_reason_v1_853:null,
   provider:"mercadopago",pixCode:payable?row.pix_br_code:null,
   paymentUrl:payable?couponOfficialPixTicket(row.payment_url):null,
   pixPayable:payable,
   // Paid receipt is not proof the vouchers are spendable; show zero until
   // the same funding conditions used by the atomic checkout are satisfied.
   expiresAt:row.expires_at??null,issuedCoupons:covered?row.coupons_per_pack:0,
   fundingPending:row.status==="paid"&&!covered,
   fundingModel:row.funding_mode_v1_846==='partner_funded'?'partner_funded':'platform_reimbursed',
   seller:row.seller_name?{
     name:row.seller_name,taxDocument:row.seller_tax_document,
     address:row.seller_address,supportEmail:row.seller_support_email
   }:null};
}
// A replay cannot trust the local invoice alone: payment may have been
// processed/cancelled at Mercado Pago while the webhook is still delayed.
async function couponPixStillPayable(invoice:any){
 if(!couponInvoiceCanPresent(invoice)||!invoice.provider_order_id
   ||!invoice.provider_payment_id)return false;
 const result=await mercadoPagoFetch("/v1/orders/"+encodeURIComponent(String(invoice.provider_order_id)),
   {accessToken:MP_TOKEN});
 if(!result.ok)return false;
 const order=await readMercadoPagoJson(result);
 const payment=findPix(order);
 const code=String(payment?.payment_method?.qr_code??"").trim();
 const deadline=mercadoPagoPixDeadline(order,payment,invoice.created_at);
 const originalTicket=couponOfficialPixTicket(invoice.payment_url);
 const rawRemoteTicket=String(payment?.payment_method?.ticket_url??"").trim();
 const remoteTicket=couponOfficialPixTicket(rawRemoteTicket);
 const ticketContradicts=Boolean(rawRemoteTicket)&&(!remoteTicket||
   Boolean(originalTicket&&remoteTicket!==originalTicket));
 // If the provider returns a QR different from the original, never reuse
 // a saved ticket as an alternative to the conflicting BR Code.
 const brContradicts=Boolean(code&&invoice.pix_br_code&&
   code!==invoice.pix_br_code);
 const originalBr=Boolean(code)&&code===invoice.pix_br_code
   &&validatePixBrCode(code,{expectedAmountCents:invoice.sale_price_cents}).valid;
 const originalLink=Boolean(originalTicket)&&!brContradicts
   &&(!rawRemoteTicket||remoteTicket===originalTicket);
 return String(order?.id??"")===String(invoice.provider_order_id)
   &&String(order?.external_reference??"")===String(invoice.id)
   &&moneyToCents(order?.total_amount)===invoice.sale_price_cents
   &&String(payment?.id??"")===String(invoice.provider_payment_id)
   &&couponProviderPixPayable(order,payment)
   &&deadline!==null&&Date.parse(String(invoice.expires_at))<=Date.parse(deadline)
   &&!ticketContradicts&&(originalBr||originalLink);
}
// A partner-funded pending Pix is not payable merely because Mercado Pago
// still calls the Order pending. Recheck current signed commercial release,
// live merchant supply at the ORIGINAL immutable CEP and global sales stop.
// This does not alter historical owner-sponsored invoices or paid receipts.
async function partnerPendingInvoiceSafe(admin:any,invoice:any){
 const postal=String(invoice?.buyer_postal_code_v1_850??"");
 if(!admin||!/^[0-9]{8}$/.test(postal))return false;
 try{
  const readiness=await partnerSaleReadiness(admin);
  if(readiness?.ready!==true||!await platformCouponSalesAllowed(admin))
   return false;
  const supply=await partnerBuyerSupply(admin,postal);
  return supply?.ready===true&&supply?.verified===true
    &&supply?.postalCode===postal;
 }catch(error){
  console.warn("partner coupon pending Pix supply review required",
    String(error instanceof Error?error.message:error));
  return false;
 }
}
// Every replay route shares the same fail-closed policy (invoice-status,
// idempotent partner-purchase and concurrent order-update recovery).
async function couponVerifiedReplay(invoice:any,admin:any){
 if(invoice?.funding_mode_v1_846==="partner_funded"&&
    ["prepared","awaiting_payment"].includes(String(invoice?.status))&&
    !await partnerPendingInvoiceSafe(admin,invoice)){
  return {ok:false,error:"PARTNER_COUPON_PENDING_SUPPLY_UNAVAILABLE",
    ...publicInvoice({...invoice,pix_br_code:null,payment_url:null}),
    recheckRequired:true};
 }
 if(invoice.status==="prepared"||
    (invoice.status==="awaiting_payment"&&!await couponPixStillPayable(invoice))){
  return {ok:false,error:"COUPON_PIX_REVIEW_REQUIRED",
    ...publicInvoice({...invoice,pix_br_code:null,payment_url:null}),
    recheckRequired:true};
 }
 return {ok:true,...publicInvoice(invoice)};
}
// Independent GET proof of a completed, full Mercado Pago Orders API refund.
// A successful refund POST, mutable invoice flag or unverified provider status
// cannot substitute for this exact Pix/order/amount/refund binding.
function couponFullRefundVerified(order:any,invoice:any){
 const payment=findPix(order);
 const refunds=Array.isArray(order?.transactions?.refunds)?order.transactions.refunds:[];
 if(!invoice||!payment||!refunds.length||order?.live_mode===false||
    payment?.live_mode===false||String(order?.id??"")!==String(invoice.provider_order_id)||
    String(order?.external_reference??"")!==String(invoice.id)||
    moneyToCents(order?.total_amount)!==Number(invoice.sale_price_cents)||
    moneyToCents(payment?.amount)!==Number(invoice.sale_price_cents)||
    String(payment?.id??"")!==String(invoice.provider_payment_id)||
    payment?.payment_method?.id!=="pix"||
    payment?.payment_method?.type!=="bank_transfer")return false;
 let total=0;
 for(const refund of refunds){
  if(!["processed","approved","refunded"].includes(String(refund?.status??"").toLowerCase())||
     !String(refund?.id??"").trim()||
     String(refund?.transaction_id??"")!==String(invoice.provider_payment_id))
    return false;
  const amount=moneyToCents(refund?.amount);
  if(amount===null||amount<=0)return false;
  total+=amount;
 }
 return total===Number(invoice.sale_price_cents);
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
  // Stream-bounded JSON parsing: req.text() would buffer an attacker-sized
  // payload BEFORE checking the 4KB limit.
  let body:any;
  try{body=await readJsonBody(req,{maxBytes:4096})}
  catch(error){
    if((error as any)?.code==="PAYLOAD_TOO_LARGE")
      return respond({error:"PAYLOAD_TOO_LARGE"},413,origin);
    if((error as any)?.code==="INVALID_JSON")
      return respond({error:"INVALID_JSON"},400,origin);
    throw error;
  }
  const operation=String(body.action??"purchase");
  const admin=createClient(URL_BASE,SECRET,{auth:{persistSession:false,autoRefreshToken:false}});
  if(operation==="my-vouchers"){
    // Authenticated, read-only reconciliation, available even when coupon
    // sales are disabled. No customer can choose or query another user ID.
    await enforceApiQuota(admin,{
      userId:user.id,actionName:"coupon-credit-pix-read",limit:12,windowSeconds:600
    });
    let {data:invoices,error:invoiceError}=await admin
      .from("clube_coupon_paid_invoices")
      .select("id,package_key,request_id,status,sale_price_cents,created_at,paid_at,provider_order_id,provider_payment_id,net_proceeds_cents,net_proceeds_verified_at,net_proceeds_reference,coupon_face_cents,coupons_per_pack,sponsor_covered_cents,min_order_cents,seller_name,seller_tax_document,seller_address,seller_support_email,funding_mode_v1_846,funding_terms_version_v1_846,terms_version,terms_accepted_at,buyer_postal_code_v1_850,coupon_settlement_hold_reason_v1_853")
      .eq("customer_user_id",user.id)
      .order("created_at",{ascending:false}).limit(25);
    if(invoiceError&&String(invoiceError.code)==="42703"){
      // Old invoices remain readable until the V1.810 migration is deployed.
      const legacy=await admin.from("clube_coupon_paid_invoices")
        .select("id,package_key,request_id,status,sale_price_cents,created_at,paid_at,provider_order_id,provider_payment_id,net_proceeds_cents,net_proceeds_verified_at,net_proceeds_reference,coupon_face_cents,coupons_per_pack,sponsor_covered_cents")
        .eq("customer_user_id",user.id)
        .order("created_at",{ascending:false}).limit(25);
      invoices=(legacy.data??[]).map((row:any)=>({...row,min_order_cents:0}));
      invoiceError=legacy.error;
    }
    if(invoiceError)throw invoiceError;
    const {data:refunds,error:refundError}=await admin
      .from("clube_coupon_refund_requests_v1_814")
      .select("invoice_id,status,request_id,received_at")
      .eq("customer_user_id",user.id)
      .order("received_at",{ascending:false}).limit(25);
    if(refundError)throw refundError;
    const refundByInvoice=new Map((refunds||[]).map((r:any)=>[String(r.invoice_id),r]));
    const paidInvoices=new Map((invoices||[])
      .filter((row:any)=>couponInvoiceNetCovered(row))
      .map((row:any)=>[String(row.id),row]));
    const paidIds=new Set(paidInvoices.keys());
    const {data:rows,error:issuanceError}=await admin
      .from("clube_coupon_paid_issuances")
      .select("id,invoice_id,ordinal,face_cents,status,expires_at")
      .eq("customer_user_id",user.id)
      .order("expires_at",{ascending:true}).limit(100);
    if(issuanceError)throw issuanceError;
    return respond({
      ok:true,source:"clube_coupon_paid_my_vouchers_v1",
      purchases:(invoices||[]).map((row:any)=>({
        invoiceId:row.id,packageKey:row.package_key,requestId:row.request_id,status:row.status,
        amountCents:row.sale_price_cents,createdAt:row.created_at,
        servicePostalCode:row.funding_mode_v1_846==='partner_funded'?row.buyer_postal_code_v1_850:null,
        paidAt:row.paid_at,
        settlementReviewReason:row.status==="review_required"?row.coupon_settlement_hold_reason_v1_853:null,
        fundingModel:row.funding_mode_v1_846==='partner_funded'?'partner_funded':'platform_reimbursed',
        fundingPending:row.status==="paid"&&!couponInvoiceNetCovered(row),
        seller:row.seller_name?{
          name:row.seller_name,taxDocument:row.seller_tax_document,
          address:row.seller_address,supportEmail:row.seller_support_email
        }:null,
        refundStatus:refundByInvoice.get(String(row.id))?.status??null,
        refundRequestedAt:refundByInvoice.get(String(row.id))?.received_at??null
      })),
      vouchers:(rows||[]).filter((row:any)=>paidIds.has(String(row.invoice_id)))
        .map((row:any)=>({
          voucherId:row.id,invoiceId:row.invoice_id,ordinal:row.ordinal,
          faceCents:row.face_cents,status:row.status,expiresAt:row.expires_at,
          minOrderCents:paidInvoices.get(String(row.invoice_id))?.min_order_cents??0,
          fundingModel:paidInvoices.get(String(row.invoice_id))?.funding_mode_v1_846==='partner_funded'?'partner_funded':'platform_reimbursed'
        })),
      couponSalesEnabled:
        Boolean(await couponSaleRelease(admin))&&mercadoPagoConfigured(MP_TOKEN)&&
        MP_TOKEN.startsWith("APP_USR-")&&await platformCouponSalesAllowed(admin),
      couponCheckoutEnabled:
        Deno.env.get("CLUBE_COUPON_CHECKOUT_ENABLED")==="true"&&
        await platformCommerceAllowed(admin)
    },200,origin);
  }
  if(operation==="request-refund"){
    const invoiceId=String(body.invoiceId??"");
    const requestId=String(body.requestId??"");
    const reason=String(body.reason??"");
    if(!UUID_RE.test(invoiceId)||!UUID_RE.test(requestId)||
       !["arrependimento","sem_atendimento","outro"].includes(reason))
      return respond({error:"COUPON_REFUND_INVALID_INPUT"},400,origin);
    await enforceApiQuota(admin,{
      userId:user.id,actionName:"coupon-refund-request",limit:4,windowSeconds:3600
    });
    const {data,error}=await admin.rpc("clube_coupon_refund_request_v1_814",{
      p_customer:user.id,p_invoice:invoiceId,p_request:requestId,p_reason:reason
    });
    if(error){
      if(error.code==="42501")return respond({error:"COUPON_REFUND_NOT_OWNED"},403,origin);
      throw error;
    }
    if(data?.ok!==true||data?.invoiceId!==invoiceId||
       !UUID_RE.test(String(data?.requestId??""))||
       !["requested","in_review","refunded","closed"].includes(String(data?.status??"")))
      return respond({error:"COUPON_REFUND_NOT_CONFIRMED"},503,origin);
    // If the paid package has NO used/reserved vouchers, attempt a full
    // provider refund with the same immutable request UUID. A second request
    // replays exactly the same Mercado Pago idempotency key.
    // Never return 'refunded' from a POST acknowledgement alone.
    let remoteRefundVerified=false;
    if(data.status==="requested"&&mercadoPagoConfigured(MP_TOKEN)){
      try{
        const {data:invoice,error:invoiceErr}=await admin.from("clube_coupon_paid_invoices")
          .select("id,status,customer_user_id,sale_price_cents,provider_order_id,provider_payment_id")
          .eq("id",invoiceId).eq("customer_user_id",user.id).maybeSingle();
        if(invoiceErr)throw invoiceErr;
        if(invoice?.status==="paid"&&invoice?.provider_order_id&&invoice?.provider_payment_id){
          const {data:vouchers,error:voucherErr}=await admin.from("clube_coupon_paid_issuances")
            .select("status").eq("invoice_id",invoiceId).limit(20);
          if(voucherErr)throw voucherErr;
          const eligible=Array.isArray(vouchers)&&vouchers.length>0&&
            vouchers.every((v:any)=>v.status==="issued"||v.status==="void");
          if(eligible){
            const orderId=String(invoice.provider_order_id);
            const endpoint="/v1/orders/"+encodeURIComponent(orderId);
            const load=await mercadoPagoFetch(endpoint,{accessToken:MP_TOKEN});
            if(load.ok){
              const order=await readMercadoPagoJson(load);
              const payment=findPix(order);
              const correctlyBound=order?.live_mode!==false&&payment?.live_mode!==false&&
                String(order?.id??"")===orderId&&
                String(order?.external_reference??"")===invoiceId&&
                moneyToCents(order?.total_amount)===invoice.sale_price_cents&&
                String(payment?.id??"")===String(invoice.provider_payment_id)&&
                moneyToCents(payment?.amount)===invoice.sale_price_cents&&
                order?.status==="processed"&&payment?.status==="processed";
              const hasRefunds=Array.isArray(order?.transactions?.refunds)&&
                order.transactions.refunds.length>0;
              if(correctlyBound&&!hasRefunds){
                await mercadoPagoFetch(endpoint+"/refund",{
                  accessToken:MP_TOKEN,method:"POST",
                  idempotencyKey:String(data.requestId)
                });
              }
              const fresh=await mercadoPagoFetch(endpoint,{accessToken:MP_TOKEN});
              if(fresh.ok){
                const proof=await readMercadoPagoJson(fresh);
                if(couponFullRefundVerified(proof,invoice)){
                  const done=await admin.rpc("clube_coupon_paid_payment_refund",{
                    p_invoice_id:invoiceId,p_provider_order_id:orderId
                  });
                  if(done.error)throw done.error;
                  remoteRefundVerified=done.data?.ok===true&&done.data?.refunded===true;
                }
              }
            }
          }
        }
      }catch(error){
        // Never turn a confirmed cancellation request into HTTP failure:
        // network/PSP ambiguity must be reviewed, not labelled as refunded.
        console.warn("coupon refund provider review required",String((error as any)?.message??error));
      }
    }
    return respond({ok:true,source:"clube_coupon_refund_request_v1_814",
      invoiceId:data.invoiceId,requestId:data.requestId,
      status:remoteRefundVerified?"refunded":data.status,receivedAt:data.receivedAt,
      refundConfirmed:remoteRefundVerified||data.refundConfirmed===true
    },200,origin);
  }
  if(operation==="partner-catalog"){
    // This independent catalog never inherits the historical sponsored owner
    // release. It stays EMPTY until real supply, separate owner acceptance,
    // signed buyer terms, legal seller identity and DB sale switches all pass.
    await enforceApiQuota(admin,{
      userId:user.id,actionName:"partner-coupon-catalog-v1-849",
      limit:15,windowSeconds:600
    });
    const readiness=await partnerSaleReadiness(admin);
    const enabled=readiness.ready===true &&
      await platformCouponSalesAllowed(admin) &&
      mercadoPagoConfigured(MP_TOKEN)&&MP_TOKEN.startsWith("APP_USR-");
    if(!enabled)return respond({ok:true,source:"clube_partner_coupon_catalog_v1_849",
      packages:[],couponSalesEnabled:false},200,origin);
    // Do not advertise a purchasable coupon until an actual customer CEP
    // has at least one independently verified accepting merchant.
    if(!/^[0-9]{8}$/.test(String(body.postalCode??"")))
      return respond({ok:true,source:"clube_partner_coupon_catalog_v1_849",
        packages:[],couponSalesEnabled:false,postalRequired:true},200,origin);
    const buyerSupply=await partnerBuyerSupply(admin,body.postalCode);
    if(!buyerSupply.ready)
      return respond({ok:true,source:"clube_partner_coupon_catalog_v1_849",
        packages:[],couponSalesEnabled:false,postalRequired:false,
        postalVerified:true,regionAvailable:false},200,origin);
    const seller=await partnerSignedSeller(admin);
    if(!seller)return respond({ok:true,source:"clube_partner_coupon_catalog_v1_849",
      packages:[],couponSalesEnabled:false},200,origin);
    const termsText=await partnerBuyerTerms(admin);
    const {data:pkg,error:pkgError}=await admin.from("clube_coupon_paid_packages")
      .select("package_key,title,sale_price_cents,coupon_face_cents,coupons_per_pack,valid_days,min_order_cents,sale_enabled,funding_verified,legal_terms_verified,redeem_settlement_verified,sponsored_by_owner")
      .eq("package_key",PARTNER_PACKAGE_KEY).maybeSingle();
    if(pkgError)throw pkgError;
    if(!pkg||pkg.sale_enabled!==true||pkg.funding_verified!==true||
       pkg.legal_terms_verified!==true||pkg.redeem_settlement_verified!==true||
       pkg.sponsored_by_owner!==false||pkg.sale_price_cents!==890||
       pkg.coupon_face_cents!==500||pkg.coupons_per_pack!==3||
       pkg.valid_days!==180||pkg.min_order_cents!==1000)
      return respond({ok:true,source:"clube_partner_coupon_catalog_v1_849",
        packages:[],couponSalesEnabled:false},200,origin);
    return respond({ok:true,source:"clube_partner_coupon_catalog_v1_849",
      couponSalesEnabled:true,
      packages:[{packageKey:pkg.package_key,title:pkg.title,
        priceCents:pkg.sale_price_cents,faceCents:pkg.coupon_face_cents,
        couponCount:pkg.coupons_per_pack,validDays:pkg.valid_days,
        minOrderCents:pkg.min_order_cents,eligibleProducts:"participating_merchants_only",
        eligiblePostalCode:buyerSupply.postalCode,serviceCity:buyerSupply.city,
        serviceState:buyerSupply.state,
        termsVersion:PARTNER_BUYER_TERMS_VERSION,termsText,
        fundingModel:"partner_funded",
        seller:{name:seller.seller_name,taxDocument:seller.seller_tax_document,
          address:seller.seller_address,supportEmail:seller.seller_support_email}}]
    },200,origin);
  }
  if(operation==="catalog"){
    // Only a signed owner release + actual backing may be shown as an offer.
    const release=await couponSaleRelease(admin);
    const enabled=Boolean(release)&&mercadoPagoConfigured(MP_TOKEN)&&
      MP_TOKEN.startsWith("APP_USR-")&&await platformCouponSalesAllowed(admin);
    if(!enabled)return respond({ok:true,source:"clube_paid_catalog_v1_807",
      packages:[],couponSalesEnabled:false},200,origin);
    const {data:packages,error:catalogError}=await admin
      .from("clube_coupon_paid_packages")
      .select("package_key,title,sale_price_cents,coupon_face_cents,coupons_per_pack,valid_days,sponsored_by_owner,min_order_cents")
      .eq("sale_enabled",true).eq("funding_verified",true)
      .eq("legal_terms_verified",true).eq("redeem_settlement_verified",true)
      .order("package_key").limit(20);
    if(catalogError)throw catalogError;
    const {data:pool,error:poolError}=await admin
      .from("platform_clube_sponsor_pool_v1_807")
      .select("reconciled_cents,owner_guaranteed_cents,encumbered_cents")
      .eq("benefit_key","clube_coupons").maybeSingle();
    if(poolError)throw poolError;
    // The owner personally guarantees the discount out of the same account
    // receiving customer Pix; this is NOT a bank-reconciled transfer.
    const available=Math.max(0,Number(pool?.reconciled_cents??0)
      +Number(pool?.owner_guaranteed_cents??0)
      -Number(pool?.encumbered_cents??0));
    const safe=(packages??[]).filter((p:any)=>{
      if(p.package_key!==release?.package_key)return false;
      const face=Number(p.coupon_face_cents)*Number(p.coupons_per_pack);
      return Number.isSafeInteger(face)&&face>0
        &&Number.isSafeInteger(p.sale_price_cents)&&p.sale_price_cents>=100
        &&(p.sponsored_by_owner===true?available>=face:p.sale_price_cents>=face);
    });
    return respond({ok:true,source:"clube_paid_catalog_v1_807",
      couponSalesEnabled:true,
      seller:safe.length?{
        name:release.seller_name,taxDocument:release.seller_tax_document,
        address:release.seller_address,supportEmail:release.seller_support_email
      }:null,
      packages:safe.map((p:any)=>({
        packageKey:p.package_key,title:p.title,
        priceCents:p.sale_price_cents,faceCents:p.coupon_face_cents,
        couponCount:p.coupons_per_pack,validDays:p.valid_days,
        minOrderCents:p.min_order_cents,eligibleProducts:"all",
        termsVersion:COUPON_TERMS_VERSION
      }))},200,origin);
  }
  if(operation==="invoice-status"){
    const invoiceId=String(body.invoiceId??"");
    if(!UUID_RE.test(invoiceId))return respond({error:"COUPON_INVOICE_ID_INVALID"},400,origin);
    await enforceApiQuota(admin,{
      userId:user.id,actionName:"coupon-credit-pix-status",limit:18,windowSeconds:600
    });
    const {data:invoice,error:invoiceError}=await admin
      .from("clube_coupon_paid_invoices").select("*")
      .eq("id",invoiceId).eq("customer_user_id",user.id).maybeSingle();
    if(invoiceError)throw invoiceError;
    if(!invoice)return respond({error:"COUPON_INVOICE_NOT_FOUND"},404,origin);
    // A pending cancellation freezes even a previously saved/reopened Pix.
    // The original provider charge may still require refund/reconciliation,
    // but the customer must not be instructed to pay it again.
    const {data:refund,error:refundError}=await admin
      .from("clube_coupon_refund_requests_v1_814")
      .select("status").eq("invoice_id",invoice.id)
      .eq("customer_user_id",user.id).maybeSingle();
    if(refundError)throw refundError;
    if(refund&&refund.status!=="closed")
      return respond({error:"COUPON_REFUND_REQUESTED",invoiceId:invoice.id,
        status:invoice.status,pixCode:null,paymentUrl:null,pixPayable:false,
        refundStatus:refund.status},409,origin);
    if(invoice.status==="prepared"||invoice.status==="awaiting_payment"){
      const replay=await couponVerifiedReplay(invoice,admin);
      return respond(replay,replay.ok?200:409,origin);
    }
    return respond({ok:true,...publicInvoice(invoice)},200,origin);
  }
  if(operation!=="purchase"&&operation!=="partner-purchase")
    return respond({error:"COUPON_ACTION_INVALID"},400,origin);
  const partnerPurchase=operation==="partner-purchase";
  // An explicit merchant-funded buyer contract can NEVER be sold under the
  // historical owner-funded product's legal reimbursement authorization.
  const readiness=partnerPurchase?await partnerSaleReadiness(admin):null;
  if(partnerPurchase&&readiness?.ready!==true)
    return respond({error:"PARTNER_COUPON_NO_ELIGIBLE_SUPPLY",pixPayable:false},423,origin);
  // Must check the buyer's own delivery area BEFORE creating an invoice
  // and again in its DB insert guard; no supplier from another city is valid.
  let selectedSupply:any=null;
  if(partnerPurchase){
    if(!/^[0-9]{8}$/.test(String(body.postalCode??"")))
      return respond({error:"PARTNER_COUPON_POSTAL_REQUIRED",pixPayable:false},400,origin);
    selectedSupply=await partnerBuyerSupply(admin,body.postalCode);
    if(!selectedSupply.ready)
      return respond({error:"PARTNER_COUPON_NO_SERVICE_AT_CEP",pixPayable:false},409,origin);
  }
  const release=partnerPurchase?await partnerSignedSeller(admin):await couponSaleRelease(admin);
  if(!release)return respond({error:partnerPurchase?
    "PARTNER_COUPON_BUYER_CONTRACT_NOT_RELEASED":"COUPON_SALES_NOT_ENABLED",
    pixPayable:false},423,origin);
  // Sales of a digital coupon package may be prepared and authorized in
  // PRELAUNCH, even with zero merchants. Global PAUSED remains a hard stop;
  // the independent private sale flag and each package approval remain required.
  // This does NOT relax redemption or the ordinary physical-order gate.
  if(!await platformCouponSalesAllowed(admin))
    return respond({error:"COUPON_SALES_OPERATION_PAUSED"},423,origin);
  if(!mercadoPagoConfigured(MP_TOKEN)||!MP_TOKEN.startsWith("APP_USR-"))
    return respond({error:"MERCADOPAGO_LIVE_NOT_CONFIGURED"},503,origin);
  const packageKey=String(body.packageKey||"");
  const requestId=String(body.requestId||"");
  if(packageKey!==(partnerPurchase?PARTNER_PACKAGE_KEY:release.package_key))
    return respond({error:"COUPON_PACKAGE_NOT_RELEASED"},409,origin);
  if(!/^[a-z][a-z0-9_]{2,39}$/.test(packageKey)||!UUID_RE.test(requestId)){
   return respond({error:"COUPON_REQUEST_INVALID"},400,origin);
  }
  await enforceApiQuota(admin,{userId:user.id,actionName:"coupon-credit-pix",limit:5,windowSeconds:3600});
  const {data:pkg,error:packageError}=await admin.from("clube_coupon_paid_packages")
    .select("package_key,sale_price_cents,coupon_face_cents,coupons_per_pack,valid_days,sale_enabled,funding_verified,legal_terms_verified,redeem_settlement_verified,sponsored_by_owner,min_order_cents")
    .eq("package_key",packageKey).maybeSingle();
  if(packageError)throw packageError;
  if(!pkg||pkg.sale_enabled!==true||pkg.funding_verified!==true||
    pkg.legal_terms_verified!==true||pkg.redeem_settlement_verified!==true||
    !Number.isSafeInteger(pkg.sale_price_cents)||
    !Number.isSafeInteger(pkg.coupon_face_cents)||
    !Number.isSafeInteger(pkg.coupons_per_pack)||
    (partnerPurchase?(
       pkg.sponsored_by_owner!==false||pkg.sale_price_cents!==890||
       pkg.coupon_face_cents!==500||pkg.coupons_per_pack!==3||
       pkg.valid_days!==180||pkg.min_order_cents!==1000
     ):(pkg.sponsored_by_owner!==true&&
       pkg.sale_price_cents<pkg.coupon_face_cents*pkg.coupons_per_pack)))
   return respond({error:"COUPON_PACKAGE_NOT_AVAILABLE"},409,origin);
  // A purchase is a distinct contract, even before the first merchant joins.
  // The customer must accept the public coupon conditions before ANY invoice
  // or Mercado Pago order is created; there is no prechecked consent.
  if(body.termsAccepted!==true||
     body.termsVersion!==(partnerPurchase?PARTNER_BUYER_TERMS_VERSION:COUPON_TERMS_VERSION))
    return respond({error:"COUPON_TERMS_ACCEPTANCE_REQUIRED"},400,origin);
  const details={
   customer_user_id:user.id,package_key:packageKey,request_id:requestId,
   sale_price_cents:pkg.sale_price_cents,coupon_face_cents:pkg.coupon_face_cents,
   coupons_per_pack:pkg.coupons_per_pack,valid_days:pkg.valid_days,
   terms_version:partnerPurchase?PARTNER_BUYER_TERMS_VERSION:COUPON_TERMS_VERSION,
   terms_accepted_at:new Date().toISOString(),
   ...(partnerPurchase?{
     funding_mode_v1_846:"partner_funded",
     funding_terms_version_v1_846:PARTNER_BUYER_TERMS_VERSION,
     min_order_cents:pkg.min_order_cents,sponsor_covered_cents:0,
     buyer_postal_code_v1_850:selectedSupply.postalCode
   }:{}),
   seller_name:release.seller_name,
   seller_tax_document:release.seller_tax_document,
   seller_address:release.seller_address,
   seller_support_email:release.seller_support_email
  };
  const {error:insertError}=await admin.from("clube_coupon_paid_invoices").insert(details);
  // A duplicate may be the same request; always re-read and compare snapshots.
  if(insertError&&!String(insertError.code).includes("23505"))throw insertError;
  const {data:invoice,error:readError}=await admin.from("clube_coupon_paid_invoices")
   .select("*").eq("customer_user_id",user.id).eq("request_id",requestId).single();
  if(readError||!invoice)throw readError??new Error("INVOICE_NOT_FOUND");
  const {data:refund,error:refundError}=await admin
    .from("clube_coupon_refund_requests_v1_814")
    .select("status").eq("invoice_id",invoice.id)
    .eq("customer_user_id",user.id).maybeSingle();
  if(refundError)throw refundError;
  if(refund&&refund.status!=="closed")
    return respond({error:"COUPON_REFUND_REQUESTED",invoiceId:invoice.id,
      pixCode:null,paymentUrl:null,pixPayable:false},409,origin);
  if(invoice.package_key!==packageKey||invoice.sale_price_cents!==pkg.sale_price_cents||
     invoice.coupon_face_cents!==pkg.coupon_face_cents||
     invoice.coupons_per_pack!==pkg.coupons_per_pack||
     invoice.terms_version!==(partnerPurchase?PARTNER_BUYER_TERMS_VERSION:COUPON_TERMS_VERSION)||
     invoice.funding_mode_v1_846!==(partnerPurchase?"partner_funded":"platform_reimbursed")||
     (partnerPurchase&&(invoice.funding_terms_version_v1_846!==PARTNER_BUYER_TERMS_VERSION||
       invoice.min_order_cents!==pkg.min_order_cents||
       invoice.seller_tax_document!==release.seller_tax_document||
       invoice.buyer_postal_code_v1_850!==selectedSupply.postalCode))){
   return respond({error:"COUPON_REQUEST_REPLAY_CONFLICT"},409,origin);
  }
  if(invoice.status!=="prepared"){
   const replay=await couponVerifiedReplay(invoice,admin);
   return respond(replay,replay.ok?200:409,origin);
  }
  // A city can pause or a revenda can withdraw between the invoice read
  // and the Pix request. Do not create a real PSP charge without rechecking.
  if(partnerPurchase){
    const renewed=await partnerBuyerSupply(admin,invoice.buyer_postal_code_v1_850);
    if(!renewed.ready||renewed.postalCode!==selectedSupply.postalCode)
      return respond({error:"PARTNER_COUPON_SUPPLY_CHANGED_BEFORE_PIX",
        pixPayable:false},409,origin);
  }
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
   const rawTicket=String(payment?.payment_method?.ticket_url??"").trim();
   const ticket=couponOfficialPixTicket(rawTicket);
   if(order?.id&&order.external_reference===invoice.id&&
     moneyToCents(order.total_amount)===invoice.sale_price_cents&&
     payment?.id&&(rawCode||ticket)){
    if(!couponProviderPixPayable(order,payment))
     throw new Error("MERCADOPAGO_COUPON_ORDER_NOT_PAYABLE");
    if(rawTicket&&!ticket)
     throw new Error("MERCADOPAGO_COUPON_TICKET_INVALID");
    const expiresAt=mercadoPagoPixDeadline(order,payment,invoice.created_at);
    if(!expiresAt)throw new Error("MERCADOPAGO_COUPON_PIX_EXPIRED_OR_UNVERIFIED");
    if(rawCode&&!validatePixBrCode(rawCode,{expectedAmountCents:invoice.sale_price_cents}).valid)
     throw new Error("MERCADOPAGO_COUPON_PIX_INVALID");
    if(!rawCode&&!ticket)throw new Error("MERCADOPAGO_COUPON_PIX_UNVERIFIED");
    const patch={provider_order_id:String(order.id),provider_payment_id:String(payment.id),
     pix_br_code:rawCode||null,payment_url:ticket,
     status:"awaiting_payment",expires_at:expiresAt,
     updated_at:new Date().toISOString()};
    const {data:committed,error:commitError}=await admin.from("clube_coupon_paid_invoices")
     .update(patch).eq("id",invoice.id).eq("status","prepared").select("*").maybeSingle();
    if(commitError)throw commitError;
    if(!committed){
      const {data:existing,error:existingError}=await admin.from("clube_coupon_paid_invoices")
       .select("*").eq("id",invoice.id).single();
      if(existingError||!existing)throw existingError??new Error("INVOICE_STATE_CONFLICT");
      const replay=await couponVerifiedReplay(existing,admin);
      return respond(replay,replay.ok?200:409,origin);
    }
    return respond({ok:true,...publicInvoice(committed),
      qrImageDataUri:rawCode?mercadoPagoQrDataUri(payment.payment_method.qr_code_base64):null},200,origin);
   }
   const id=String(order?.id??"");
   if(!id)throw new Error("MERCADOPAGO_COUPON_ORDER_INVALID");
   const lookup=await mercadoPagoFetch("/v1/orders/"+encodeURIComponent(id),{accessToken:MP_TOKEN});
   order=await readMercadoPagoJson(lookup);
   if(!lookup.ok)throw new Error("MERCADOPAGO_COUPON_LOOKUP_FAILED");
  }
  throw new Error("MERCADOPAGO_COUPON_PIX_NOT_READY");
 }catch(error){
  const cause=String((error as any)?.message??error);
  if(cause.includes("COUPON_SPONSOR_FUNDS_NOT_VERIFIED_OR_EXHAUSTED")||
     cause.includes("COUPON_SPONSOR_PACKAGE_NOT_READY")){
    return respond({error:"COUPON_SPONSOR_BUDGET_UNAVAILABLE",credited:false},409,origin);
  }
  console.error("coupon-credit-pix fail closed",cause);
  return respond({error:"COUPON_PIX_NOT_CONFIRMED",credited:false},503,origin);
 }
});
