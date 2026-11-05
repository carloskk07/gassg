import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {
  createClient } from "npm:@supabase/supabase-js@2.117.2";
import { DomainError,
  readJsonBody,
  enforceApiQuota
} from "../_shared/domain.js";
import { safeMercadoPagoUrl } from "../_shared/mercadopago.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const publishableKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const PUBLISHABLE_KEY=publishableKeys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const MERCHANT_DIRECT_PAYMENTS_ENABLED=
  String(Deno.env.get("MERCHANT_DIRECT_PAYMENTS_ENABLED")??"").trim()==="1";
const CUSTOMER_ALLOWED_ORIGIN=(Deno.env.get("CUSTOMER_ALLOWED_ORIGIN")??"https://chama-sg-cliente.netlify.app").trim();
const CUSTOMER_PRIMARY_ORIGINS=new Set([
  "https://tamao-sg-cliente.pages.dev",
  "https://tamao.com.br",
  "https://www.tamao.com.br",
  CUSTOMER_ALLOWED_ORIGIN
].filter(Boolean));
const MERCHANT_ALLOWED_ORIGIN=(Deno.env.get("MERCHANT_ALLOWED_ORIGIN")??"").trim();
const MERCHANT_PRIMARY_ORIGINS=new Set([
  "https://tamao-sg-revenda.pages.dev",
  "https://parceiro.tamao.com.br",
  MERCHANT_ALLOWED_ORIGIN
].filter(Boolean));
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function localOrigin(origin:string|null){
  return !!origin&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
function customerOriginAllowed(origin:string|null){
  if(!origin)return true;
  if(localOrigin(origin))return true;
  return CUSTOMER_PRIMARY_ORIGINS.has(origin);
}
function merchantOriginAllowed(origin:string|null){
  if(!origin)return true;
  if(localOrigin(origin))return true;
  return MERCHANT_PRIMARY_ORIGINS.has(origin);
}
function originAllowed(origin:string|null){
  return customerOriginAllowed(origin)||merchantOriginAllowed(origin);
}
function cors(origin:string|null){
  const fallback="https://tamao-sg-cliente.pages.dev";
  const allowed=origin&&originAllowed(origin)?origin:fallback;
  return {
    "Access-Control-Allow-Origin":allowed,
    "Access-Control-Allow-Headers":"authorization, apikey, content-type",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Vary":"Origin"
  };
}
function json(body:unknown,status=200,origin:string|null=null){
  return new Response(JSON.stringify(body),{
    status,
    headers:{...cors(origin),"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
  });
}
async function authenticatedUser(req:Request){
  const authHeader=req.headers.get("Authorization");
  if(!authHeader?.startsWith("Bearer "))throw new DomainError("UNAUTHORIZED","Autenticação obrigatória.",401);
  const token=authHeader.slice("Bearer ".length);
  const client=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await client.auth.getUser(token);
  if(error||!data.user)throw new DomainError("UNAUTHORIZED","Sessão inválida ou expirada.",401);
  return data.user;
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  if(!originAllowed(origin))return json({error:"ORIGIN_NOT_ALLOWED"},403,origin);
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405,origin);

  try{
    const user=await authenticatedUser(req);
    const body=await readJsonBody(req);
    const orderId=String(body.orderId??"");
    if(!UUID_RE.test(orderId))throw new DomainError("INVALID_ORDER","Pedido inválido.",400);

    const admin=createClient(SUPABASE_URL,SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    await enforceApiQuota(admin,{userId:user.id,actionName:"get-order",limit:120,windowSeconds:60});
    const {data:order,error:orderError}=await admin
      .from("orders")
      .select("id,public_code,customer_id,merchant_id,status,financial_state,financial_reversed_at,financial_reversal_reason,address_text,postal_code,customer_phone_digits,address_complement,delivery_reference,delivery_notes,delivery_pii_redacted_at,payment_method,payment_timing,cash_tender_cents,gross_total_cents,cashback_reserved_cents,total_cents,proposed_total_cents,delivery_window_start,delivery_window_end,comparison_selected_total_cents,comparison_reference_cents,comparison_savings_cents,supplier_name_snapshot,risk_reason,offer_expires_at,accepted_at,dispatch_due_at,dispatched_at,arriving_at,promised_by,delivered_at,settled_at,payment_confirmed_at,pin_failures,version,assigned_delivery_user_id,delivery_assigned_at,delivery_assigned_by,created_at,updated_at")
      .eq("id",orderId)
      .maybeSingle();

    if(orderError)throw orderError;
    if(!order)return json({error:"ORDER_NOT_FOUND",message:"Pedido não encontrado."},404,origin);

    let role:"customer"|"merchant"|null=null;
    let memberRole:string|null=null;

    if(order.customer_id===user.id){
      role="customer";
    }else if(order.merchant_id&&!["REASSIGNING","REQUOTE_REQUIRED","CANCELLED"].includes(order.status)){
      const {data:membership,error:membershipError}=await admin
        .from("merchant_members")
        .select("member_role,active")
        .eq("merchant_id",order.merchant_id)
        .eq("user_id",user.id)
        .eq("active",true)
        .maybeSingle();
      if(membershipError)throw membershipError;
      if(
        membership
        &&(
          ["owner","manager","operator"].includes(membership.member_role)
          ||(
            membership.member_role==="driver"
            && order.assigned_delivery_user_id===user.id
          )
        )
      ){
        role="merchant";
        memberRole=membership.member_role;
      }
    }

    if(!role)return json({error:"ORDER_NOT_FOUND",message:"Pedido não encontrado."},404,origin);
    if(role==="customer"&&!customerOriginAllowed(origin)){
      return json({error:"CUSTOMER_ORIGIN_REQUIRED",message:"O acesso real do cliente exige uma origem dedicada."},403,origin);
    }
    if(role==="merchant"&&!merchantOriginAllowed(origin)){
      return json({error:"MERCHANT_ORIGIN_REQUIRED",message:"O acesso operacional da revenda exige uma origem dedicada."},403,origin);
    }

    const [{data:items,error:itemError},{data:events,error:eventError}]=await Promise.all([
      admin.from("order_items")
        .select("product_code,product_name,quantity,unit_price_cents,line_total_cents")
        .eq("order_id",order.id)
        .order("product_code"),
      admin.from("order_events")
        .select("event_type,title,detail,created_at")
        .eq("order_id",order.id)
        .order("created_at",{ascending:true})
    ]);
    if(itemError)throw itemError;
    if(eventError)throw eventError;

    let feedback:any=null;
    let supportCases:any[]=[];
    if(role==="customer"){
      const [
        {data:feedbackRow,error:feedbackError},
        {data:supportRows,error:supportError}
      ]=await Promise.all([
        admin.from("order_feedback")
          .select("rating,tags,note,created_at,updated_at")
          .eq("order_id",order.id)
          .eq("customer_id",user.id)
          .maybeSingle(),
        admin.from("support_cases")
          .select("id,category,status,created_at,resolved_at")
          .eq("order_id",order.id)
          .eq("customer_id",user.id)
          .order("created_at",{ascending:false})
          .limit(10)
      ]);
      if(feedbackError)throw feedbackError;
      if(supportError)throw supportError;
      feedback=feedbackRow??null;
      supportCases=supportRows??[];
    }

    let deliveryPin:string|null=null;
    if(role==="customer"&&["OUT_FOR_DELIVERY","ARRIVING"].includes(order.status)){
      const {data:secret,error:secretError}=await admin
        .from("order_delivery_secrets")
        .select("pin_code,revealed_at,consumed_at")
        .eq("order_id",order.id)
        .maybeSingle();
      if(secretError)throw secretError;
      if(secret&&!secret.consumed_at){
        deliveryPin=secret.pin_code;
        if(!secret.revealed_at){
          await admin.from("order_delivery_secrets")
            .update({revealed_at:new Date().toISOString()})
            .eq("order_id",order.id)
            .is("revealed_at",null);
        }
      }
    }

    let onlinePayment:any={
      provider:null,
      paymentRouteId:null,
      verificationLevel:null,
      available:false,
      canStart:false,
      status:"not_available",
      checkoutUrl:null,
      approvedAt:null,
      refundedAt:null,
      amountCents:Number(order.total_cents||0),
      fundsOwner:"merchant",
      tamaoReceivesSaleProceeds:false
    };
    if(
      order.merchant_id
      &&order.payment_timing==="prepaid"
      &&["pix","card"].includes(String(order.payment_method??""))
    ){
      let routeQuery=admin
        .from("merchant_payment_routes")
        .select("id,payment_method,provider,connection_id,verification_mode,priority")
        .eq("merchant_id",order.merchant_id)
        .eq("active",true)
        .eq("channel","online")
        .eq("verification_mode","provider_api");
      routeQuery=order.payment_method==="card"
        ?routeQuery.in("payment_method",["card","card_credit","card_debit"])
        :routeQuery.eq("payment_method",order.payment_method);
      const [
        {data:routes,error:routesError},
        {data:providerAccounts,error:providerAccountsError},
        {data:paymentAttempt,error:paymentAttemptError}
      ]=await Promise.all([
        routeQuery.order("priority",{ascending:true}).limit(20),
        admin.from("merchant_payment_provider_accounts")
          .select("id,provider,status,capabilities")
          .eq("merchant_id",order.merchant_id)
          .eq("status","active"),
        admin.from("merchant_sale_payment_attempts")
          .select("status,provider,payment_route_id,verification_level,checkout_url,expires_at,approved_at,refunded_at,amount_cents,merchant_id")
          .eq("order_id",order.id)
          .order("created_at",{ascending:false})
          .limit(1)
          .maybeSingle()
      ]);
      if(routesError)throw routesError;
      if(providerAccountsError)throw providerAccountsError;
      if(paymentAttemptError)throw paymentAttemptError;

      const providerKeys=[...new Set((routes??[]).map((x:any)=>String(x.provider||"")).filter(Boolean))];
      let catalogRows:any[]=[];
      if(providerKeys.length){
        const {data,error}=await admin
          .from("payment_provider_catalog")
          .select("provider_key,adapter_status,verification_level")
          .in("provider_key",providerKeys);
        if(error)throw error;
        catalogRows=data??[];
      }
      const accountById=new Map((providerAccounts??[]).map((x:any)=>[String(x.id),x]));
      const catalogByProvider=new Map(catalogRows.map((x:any)=>[String(x.provider_key),x]));
      const selectedRoute=(routes??[]).find((route:any)=>{
        const account=accountById.get(String(route.connection_id||""));
        const provider=catalogByProvider.get(String(route.provider||""));
        return account
          &&account.provider===route.provider
          &&account.capabilities?.directSalePaymentsEnabled===true
          &&account.capabilities?.canValidateProviderTransactions===true
          &&provider?.adapter_status==="implemented";
      })??null;

      const orderEligible=[
        "MERCHANT_ACCEPTED","PREPARING","AT_RISK",
        "OUT_FOR_DELIVERY","ARRIVING"
      ].includes(order.status);
      const attemptStatus=String(paymentAttempt?.status??"not_started");
      const attemptProvider=String(paymentAttempt?.provider??selectedRoute?.provider??"");
      const checkoutUrl=
        role==="customer"
        &&attemptProvider==="mercadopago"
        &&["checkout_ready","pending"].includes(attemptStatus)
          ?safeMercadoPagoUrl(paymentAttempt?.checkout_url)
          :null;
      const terminalRetryable=["rejected","cancelled","expired"].includes(attemptStatus);
      const noAttempt=attemptStatus==="not_started";
      const routeAvailable=Boolean(selectedRoute);
      onlinePayment={
        provider:attemptProvider||null,
        paymentRouteId:paymentAttempt?.payment_route_id??selectedRoute?.id??null,
        verificationLevel:paymentAttempt?.verification_level
          ??catalogByProvider.get(String(selectedRoute?.provider||""))?.verification_level
          ??null,
        available:
          MERCHANT_DIRECT_PAYMENTS_ENABLED
          &&routeAvailable
          &&orderEligible,
        canStart:
          MERCHANT_DIRECT_PAYMENTS_ENABLED
          &&routeAvailable
          &&orderEligible
          &&(noAttempt||terminalRetryable),
        status:attemptStatus,
        checkoutUrl,
        expiresAt:role==="customer"?paymentAttempt?.expires_at??null:null,
        approvedAt:paymentAttempt?.approved_at??null,
        refundedAt:paymentAttempt?.refunded_at??null,
        amountCents:Number(paymentAttempt?.amount_cents??order.total_cents??0),
        fundsOwner:"merchant",
        tamaoReceivesSaleProceeds:false
      };
    }

    // V1.181: the original merchant may be detached during reassign/cancellation.
    // Read only the authenticated customer's own order's latest recorded payment attempt.
    // A payment attempt is not a receipt or a live banking balance.
    if(
      role==="customer"
      &&["CANCELLED","REASSIGNING"].includes(order.status)
      &&order.payment_timing==="prepaid"
      &&["pix","card"].includes(String(order.payment_method??""))
    ){
      const {data:attempt,error:attemptError}=await admin
        .from("merchant_sale_payment_attempts")
        .select("status,provider,verification_level,approved_at,refunded_at,amount_cents")
        .eq("order_id",order.id)
        .order("created_at",{ascending:false})
        .limit(1)
        .maybeSingle();
      if(attemptError)throw attemptError;
      const state=String(attempt?.status??"not_available");
      const visibleStates=new Set(["approved","refunded","review_required"]);
      const safeState=visibleStates.has(state)?state:"not_available";
      onlinePayment={
        ...onlinePayment,
        available:false,
        canStart:false,
        checkoutUrl:null,
        status:safeState,
        provider:attempt?.provider==="mercadopago"?"mercadopago":null,
        verificationLevel:attempt?.verification_level??null,
        approvedAt:attempt?.approved_at??null,
        refundedAt:attempt?.refunded_at??null,
        amountCents:Number(attempt?.amount_cents??order.total_cents??0),
        fundsOwner:"merchant",
        tamaoReceivesSaleProceeds:false
      };
    }

    const {data:partnerBenefit,error:partnerBenefitError}=await admin
      .from("merchant_welcome_order_uses_v1_843")
      .select("amount_cents,merchant_id,customer_id,gross_cents,net_cents,fee_bps_snapshot,terms_version")
      .eq("order_id",order.id).maybeSingle();
    if(partnerBenefitError)throw partnerBenefitError;
    if(partnerBenefit&&(
      partnerBenefit.merchant_id!==order.merchant_id||
      partnerBenefit.customer_id!==order.customer_id||
      partnerBenefit.gross_cents!==order.gross_total_cents||
      partnerBenefit.net_cents!==order.total_cents||
      partnerBenefit.amount_cents!==100||
      partnerBenefit.terms_version!==1||
      order.cashback_reserved_cents!==100))
      throw new DomainError("PARTNER_WELCOME_READBACK_MISMATCH",
        "Os valores do benefício não puderam ser reconciliados.",503);

    // #846: only report a partner-funded paid coupon when its immutable
    // application proves this exact order, merchant, customer and NET amount.
    const {data:partnerCoupon,error:partnerCouponError}=await admin
      .from("clube_partner_coupon_order_uses_v1_846")
      .select("voucher_id,invoice_id,merchant_id,customer_id,gross_cents,net_cents,face_cents,fee_bps_snapshot,buyer_terms_version")
      .eq("order_id",order.id).maybeSingle();
    if(partnerCouponError)throw partnerCouponError;
    if(partnerCoupon&&(
      partnerBenefit||
      partnerCoupon.merchant_id!==order.merchant_id||
      partnerCoupon.customer_id!==order.customer_id||
      partnerCoupon.gross_cents!==order.gross_total_cents||
      partnerCoupon.net_cents!==order.total_cents||
      partnerCoupon.face_cents!==order.cashback_reserved_cents||
      !Number.isSafeInteger(partnerCoupon.face_cents)||
      partnerCoupon.face_cents<100||partnerCoupon.face_cents>500||
      partnerCoupon.buyer_terms_version!=="clube_partner_coupon_terms_v1_846"||
      !Number.isSafeInteger(partnerCoupon.fee_bps_snapshot)))
      throw new DomainError("PARTNER_COUPON_READBACK_MISMATCH",
        "Os valores do cupom financiado pela revenda não puderam ser conciliados.",503);

    // #847: only after a committed cancellation/reversal can the coupon
    // return be displayed. No return is ever described as ordinary cashback.
    let couponReturn:{disposition:string;cause:string}|null=null;
    if(partnerCoupon&&(order.status==="CANCELLED"||order.financial_reversed_at)){
      const {data:returned,error:returnError}=await admin
        .from("clube_partner_coupon_returns_v1_847")
        .select("order_id,voucher_id,invoice_id,customer_id,amount_cents,disposition,cause")
        .eq("order_id",order.id).maybeSingle();
      if(returnError)throw returnError;
      if(!returned||returned.voucher_id!==partnerCoupon.voucher_id||
        returned.invoice_id!==partnerCoupon.invoice_id||
        returned.customer_id!==order.customer_id||
        returned.amount_cents!==partnerCoupon.face_cents||
        !["reissued","manual_review"].includes(String(returned.disposition))||
        !["order_cancelled","post_settlement_financial_reversal"].includes(String(returned.cause)))
        throw new DomainError("PARTNER_COUPON_RETURN_UNVERIFIED",
          "A devolução deste cupom ainda não pôde ser reconciliada.",503);
      couponReturn={disposition:returned.disposition,cause:returned.cause};
    }

    const deliveryDetailsVisible=role==="customer"||order.status!=="OFFERED_TO_MERCHANT";

    const safeOrder={
      orderId:order.id,
      publicCode:order.public_code,
      role,
      memberRole:role==="merchant"?memberRole:null,
      status:order.status,
      financialState:order.financial_state,
      financialReversedAt:role==="customer"?order.financial_reversed_at:null,
      financialReversalReason:role==="customer"&&order.financial_reversal_reason?"Reversão financeira confirmada pela administração.":null,
      version:order.version,
      address:deliveryDetailsVisible?order.address_text:null,
      postalCode:deliveryDetailsVisible?order.postal_code:null,
      addressVisible:deliveryDetailsVisible,
      deliveryDetailsVisible,
      customerPhone:deliveryDetailsVisible?order.customer_phone_digits:null,
      addressComplement:deliveryDetailsVisible?order.address_complement:null,
      deliveryReference:deliveryDetailsVisible?order.delivery_reference:null,
      deliveryNotes:deliveryDetailsVisible?order.delivery_notes:null,
      deliveryDataRedacted:order.delivery_pii_redacted_at!=null,
      deliveryDataRedactedAt:role==="customer"?order.delivery_pii_redacted_at:null,
      paymentMethod:order.payment_method,
      paymentTiming:order.payment_timing,
      onlinePayment,
      cashTenderCents:order.cash_tender_cents,
      deliveryWindowStart:order.delivery_window_start,
      deliveryWindowEnd:order.delivery_window_end,
      comparisonSelectedTotalCents:order.comparison_selected_total_cents,
      comparisonReferenceCents:order.comparison_reference_cents,
      comparisonSavingsCents:Number(order.comparison_savings_cents??0),
      grossTotalCents:order.gross_total_cents,
      cashbackReservedCents:order.cashback_reserved_cents,
      partnerFundedDiscountCents:partnerBenefit?.amount_cents??0,
      partnerCouponFundedCents:partnerCoupon?.face_cents??0,
      couponFundingModel:partnerCoupon?'partner_funded':null,
      partnerCouponTermsVersion:partnerCoupon?.buyer_terms_version??null,
      partnerCouponReturnDisposition:couponReturn?.disposition??null,
      partnerCouponReturnCause:couponReturn?.cause??null,
      partnerWelcomeTermsVersion:partnerBenefit?.terms_version??null,
      partnerFeeBpsSnapshot:role==="merchant"&&["owner","manager"].includes(memberRole||"")
        ?partnerBenefit?.fee_bps_snapshot??partnerCoupon?.fee_bps_snapshot??null:null,
      totalCents:order.total_cents,
      proposedTotalCents:role==="customer"&&order.status==="REQUOTE_REQUIRED"?order.proposed_total_cents:null,
      supplierName:order.supplier_name_snapshot,
      riskReason:order.risk_reason,
      offerExpiresAt:order.offer_expires_at,
      acceptedAt:order.accepted_at,
      dispatchDueAt:order.dispatch_due_at,
      dispatchedAt:order.dispatched_at,
      arrivingAt:order.arriving_at,
      promisedBy:order.promised_by,
      hasAssignedDelivery:order.delivery_assigned_at!=null,
      deliveryAssignedAt:order.delivery_assigned_at,
      assignedDeliveryUserId:role==="merchant"?order.assigned_delivery_user_id:null,
      deliveredAt:order.delivered_at,
      settledAt:order.settled_at,
      paymentConfirmedAt:order.payment_confirmed_at,
      pinFailures:role==="merchant"?order.pin_failures:null,
      deliveryPin,
      feedback:role==="customer"&&feedback?{
        rating:Number(feedback.rating),
        tags:feedback.tags??[],
        note:feedback.note??null,
        createdAt:feedback.created_at,
        updatedAt:feedback.updated_at
      }:null,
      supportCases:role==="customer"?supportCases.map((x)=>({
        id:x.id,
        category:x.category,
        status:x.status,
        createdAt:x.created_at,
        resolvedAt:x.resolved_at
      })):[],
      items:items??[],
      events:(events??[]).map((e)=>({
        type:e.event_type,
        title:e.title,
        detail:e.detail,
        createdAt:e.created_at
      })),
      createdAt:order.created_at,
      updatedAt:order.updated_at
    };

    return json(safeOrder,200,origin);
  }catch(error){
    if(error instanceof DomainError)return json({error:error.code,message:error.message},error.status,origin);
    console.error("get-order failed",error instanceof Error?error.message:String(error));
    return json({error:"INTERNAL_ERROR",message:"Não foi possível carregar o pedido."},500,origin);
  }
});
