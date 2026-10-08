import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {
  createClient } from "npm:@supabase/supabase-js@2.117.2";
import { DomainError,
  assertPermanentMerchantUser,
  readJsonBody,
  enforceApiQuota
} from "../_shared/domain.js";
import {
  isOperationalMerchantRole,
  operationalMerchantMemberships,
  selectMerchantMembership
} from "../_shared/merchant-membership.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const publishableKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const PUBLISHABLE_KEY=publishableKeys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const MERCHANT_ALLOWED_ORIGIN=(Deno.env.get("MERCHANT_ALLOWED_ORIGIN")??"https://chama-sg-revenda.netlify.app").trim();
const MERCHANT_PRIMARY_ORIGINS=new Set([
  "https://tamao-sg-revenda.pages.dev",
  "https://parceiro.tamao.com.br",
  MERCHANT_ALLOWED_ORIGIN
].filter(Boolean));
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_STATUSES=[
  "OFFERED_TO_MERCHANT","MERCHANT_ACCEPTED","PREPARING","AT_RISK",
  "OUT_FOR_DELIVERY","ARRIVING"
];

function originAllowed(origin:string|null){
  if(!origin)return true;
  if(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return true;
  return MERCHANT_PRIMARY_ORIGINS.has(origin);
}
function cors(origin:string|null){
  const allowed=origin&&originAllowed(origin)?origin:("https://tamao-sg-revenda.pages.dev");
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
  return assertPermanentMerchantUser(data.user);
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  if(!originAllowed(origin))return json({error:"ORIGIN_NOT_ALLOWED"},403,origin);
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405,origin);

  try{
    const user=await authenticatedUser(req);
    const body=await readJsonBody(req);
    const requestedMerchantId=body.merchantId==null?null:String(body.merchantId);
    if(requestedMerchantId&&!UUID_RE.test(requestedMerchantId)){
      throw new DomainError("INVALID_MERCHANT","Revenda inválida.",400);
    }

    const admin=createClient(SUPABASE_URL,SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    await enforceApiQuota(admin,{userId:user.id,actionName:"merchant-orders",limit:120,windowSeconds:60});

    const {error:claimInviteError}=await admin.rpc("claim_merchant_team_invites",{
      p_user_id:user.id
    });
    if(claimInviteError){
      console.error("merchant team invite claim failed",String(claimInviteError.message??"claim_failed"));
      throw new DomainError("TEAM_INVITE_CLAIM_FAILED","Não foi possível validar os convites desta conta.",503);
    }

    const {data:memberships,error:membershipError}=await admin
      .from("merchant_members")
      .select("merchant_id,member_role,display_name,active")
      .eq("user_id",user.id)
      .eq("active",true);
    if(membershipError)throw membershipError;
    if(!memberships?.length)return json({error:"NO_MERCHANT_ACCESS",message:"Sua conta ainda não está vinculada a uma revenda."},403,origin);

    const selected=selectMerchantMembership(memberships,requestedMerchantId);
    if(!selected)return json({error:"MERCHANT_ACCESS_DENIED",message:"Você não possui acesso a esta revenda."},403,origin);

    if(selected.member_role==="driver"){
      const {data:merchant,error:merchantError}=await admin
        .from("merchants")
        .select("id,name,status,base_eta_minutes,last_seen_at")
        .eq("id",selected.merchant_id)
        .maybeSingle();
      if(merchantError)throw merchantError;
      if(!merchant)return json({error:"MERCHANT_NOT_FOUND"},404,origin);

      const {data:driverOrders,error:driverOrdersError}=await admin
        .from("orders")
        .select("id,public_code,status,address_text,postal_code,customer_phone_digits,address_complement,delivery_reference,delivery_notes,payment_method,cash_tender_cents,gross_total_cents,cashback_reserved_cents,total_cents,delivery_window_start,delivery_window_end,supplier_name_snapshot,risk_reason,dispatch_due_at,dispatched_at,arriving_at,promised_by,pin_failures,version,assigned_delivery_user_id,delivery_assigned_at,delivery_assigned_by,created_at,updated_at")
        .eq("merchant_id",selected.merchant_id)
        .eq("assigned_delivery_user_id",user.id)
        .in("status",["PREPARING","AT_RISK","OUT_FOR_DELIVERY","ARRIVING"])
        .order("created_at",{ascending:true})
        .limit(100);
      if(driverOrdersError)throw driverOrdersError;

      const driverIds=(driverOrders??[]).map((o)=>o.id);
      let driverItems:any[]=[];
      if(driverIds.length){
        const {data,error}=await admin
          .from("order_items")
          .select("order_id,product_code,product_name,quantity,unit_price_cents,line_total_cents")
          .in("order_id",driverIds)
          .order("product_code");
        if(error)throw error;
        driverItems=data??[];
      }
      const driverByOrder=new Map<string,any[]>();
      for(const item of driverItems){
        if(!driverByOrder.has(item.order_id))driverByOrder.set(item.order_id,[]);
        driverByOrder.get(item.order_id)!.push({
          productCode:item.product_code,
          productName:item.product_name,
          quantity:item.quantity,
          unitPriceCents:item.unit_price_cents,
          lineTotalCents:item.line_total_cents
        });
      }

      return json({
        merchant:{
          merchantId:merchant.id,
          name:merchant.name,
          memberRole:"driver",
          memberDisplayName:selected.display_name??null,
          status:merchant.status,
          baseEtaMinutes:Number(merchant.base_eta_minutes??30),
          lastSeenAt:merchant.last_seen_at
        },
        memberships:[{
          merchantId:merchant.id,
          memberRole:"driver",
          name:merchant.name
        }],
        deliveryTeam:[],
        catalog:[],
        orders:(driverOrders??[]).map((o)=>({
          orderId:o.id,
          publicCode:o.public_code,
          status:o.status,
          address:o.address_text,
          postalCode:o.postal_code,
          addressVisible:true,
          deliveryDetailsVisible:true,
          customerPhone:o.customer_phone_digits,
          addressComplement:o.address_complement,
          deliveryReference:o.delivery_reference,
          deliveryNotes:o.delivery_notes,
          paymentMethod:o.payment_method,
          cashTenderCents:o.cash_tender_cents,
          deliveryWindowStart:o.delivery_window_start,
          deliveryWindowEnd:o.delivery_window_end,
          grossTotalCents:o.gross_total_cents,
          cashbackReservedCents:o.cashback_reserved_cents,
          totalCents:o.total_cents,
          supplierName:o.supplier_name_snapshot,
          riskReason:o.risk_reason,
          dispatchDueAt:o.dispatch_due_at,
          dispatchedAt:o.dispatched_at,
          arrivingAt:o.arriving_at,
          promisedBy:o.promised_by,
          pinFailures:o.pin_failures,
          version:o.version,
          assignedDeliveryUserId:o.assigned_delivery_user_id,
          deliveryAssignedAt:o.delivery_assigned_at,
          deliveryAssignedBy:o.delivery_assigned_by,
          items:driverByOrder.get(o.id)??[],
          createdAt:o.created_at,
          updatedAt:o.updated_at
        }))
      },200,origin);
    }

    if(!isOperationalMerchantRole(selected.member_role)){
      return json({error:"MERCHANT_ROLE_NOT_ENABLED",message:"Este papel ainda não possui painel operacional no piloto."},403,origin);
    }

    const membershipMerchantIds=operationalMerchantMemberships(memberships)
      .map((m)=>m.merchant_id);
    const {data:membershipMerchants,error:membershipMerchantsError}=await admin
      .from("merchants")
      .select("id,name")
      .in("id",membershipMerchantIds);
    if(membershipMerchantsError)throw membershipMerchantsError;
    const merchantNames=new Map((membershipMerchants??[]).map((m)=>[m.id,m.name]));

    const {data:merchant,error:merchantError}=await admin
      .from("merchants")
      .select("id,name,status,online,trust_score,delivery_fee_cents,delivery_fee_confirmed_at,base_eta_minutes,accepts_citywide,accepts_scheduled_orders,max_active_orders,last_seen_at,updated_at")
      .eq("id",selected.merchant_id)
      .maybeSingle();
    if(merchantError)throw merchantError;
    if(!merchant)return json({error:"MERCHANT_NOT_FOUND"},404,origin);

    const {data:catalog,error:catalogError}=await admin
      .from("catalog_items")
      .select("product_code,product_name,price_cents,pricing_mode,min_price_cents,max_price_cents,pricing_strategy,available_stock,active,price_confirmed_at,updated_at")
      .eq("merchant_id",selected.merchant_id)
      .order("product_code");
    if(catalogError)throw catalogError;

    const {data:registryProducts,error:registryProductsError}=await admin
      .from("product_delivery_profiles")
      .select("product_code,product_name,category_key,sort_order")
      .eq("active",true)
      .eq("merchant_add_allowed",true)
      .eq("delivery_class","household_general")
      .order("sort_order",{ascending:true})
      .order("product_name",{ascending:true});
    if(registryProductsError)throw registryProductsError;
    const registryCategoryKeys=[...new Set((registryProducts??[]).map((x)=>String(x.category_key)).filter(Boolean))];
    const {data:registryCategories,error:registryCategoriesError}=registryCategoryKeys.length
      ? await admin
          .from("product_categories")
          .select("category_key,category_name,sort_order")
          .in("category_key",registryCategoryKeys)
          .eq("active",true)
      : {data:[],error:null};
    if(registryCategoriesError)throw registryCategoriesError;
    const registryCategoryByKey=new Map(
      (registryCategories??[]).map((x)=>[String(x.category_key),x])
    );
    const availableProducts=(registryProducts??[])
      .filter((x)=>registryCategoryByKey.has(String(x.category_key)))
      .map((x)=>{
        const category:any=registryCategoryByKey.get(String(x.category_key));
        return {
          productCode:String(x.product_code),
          productName:String(x.product_name),
          categoryKey:String(x.category_key),
          categoryName:String(category?.category_name??x.category_key),
          sortOrder:Number(x.sort_order??100)
        };
      });

    const [
      {data:compliance,error:complianceError},
      {data:compliancePolicy,error:compliancePolicyError},
      {data:cnpjCurrent,error:cnpjCurrentError},
      {data:anpCurrent,error:anpCurrentError}
    ]=await Promise.all([
      admin
        .from("merchant_compliance")
        .select("cnpj_status,anp_status,cnpj_verified_at,anp_verified_at")
        .eq("merchant_id",selected.merchant_id)
        .maybeSingle(),
      admin
        .from("merchant_compliance_policy")
        .select("cnpj_max_age_days,anp_max_age_days")
        .eq("policy_key","default")
        .maybeSingle(),
      admin.rpc("merchant_cnpj_compliance_current",{p_merchant_id:selected.merchant_id}),
      admin.rpc("merchant_anp_compliance_current",{p_merchant_id:selected.merchant_id})
    ]);
    if(complianceError)throw complianceError;
    if(compliancePolicyError)throw compliancePolicyError;
    if(cnpjCurrentError)throw cnpjCurrentError;
    if(anpCurrentError)throw anpCurrentError;

    const {data:orders,error:ordersError}=await admin
      .from("orders")
      .select("id,public_code,status,address_text,postal_code,customer_phone_digits,address_complement,delivery_reference,delivery_notes,payment_method,cash_tender_cents,gross_total_cents,cashback_reserved_cents,total_cents,delivery_window_start,delivery_window_end,comparison_savings_cents,supplier_name_snapshot,risk_reason,offer_expires_at,accepted_at,dispatch_due_at,dispatched_at,arriving_at,promised_by,pin_failures,version,assigned_delivery_user_id,delivery_assigned_at,delivery_assigned_by,created_at,updated_at")
      .eq("merchant_id",selected.merchant_id)
      .in("status",ACTIVE_STATUSES)
      .order("created_at",{ascending:true})
      .limit(100);
    if(ordersError)throw ordersError;

    const ids=(orders??[]).map((o)=>o.id);
    let items:any[]=[];
    if(ids.length){
      const {data,error}=await admin
        .from("order_items")
        .select("order_id,product_code,product_name,quantity,unit_price_cents,line_total_cents")
        .in("order_id",ids)
        .order("product_code");
      if(error)throw error;
      items=data??[];
    }

    const {data:performanceRows,error:performanceError}=await admin.rpc(
      "merchant_public_performance",
      {p_merchant_ids:[selected.merchant_id]}
    );
    if(performanceError)throw performanceError;
    const performance=(performanceRows??[])[0]??null;

    const {data:paymentRows,error:paymentError}=await admin
      .from("merchant_payment_methods")
      .select("payment_method,active")
      .eq("merchant_id",selected.merchant_id);
    if(paymentError)throw paymentError;
    const paymentMethods={pix:false,card:false,cash:false};
    for(const row of paymentRows??[]){
      if(row.payment_method in paymentMethods){
        paymentMethods[row.payment_method as keyof typeof paymentMethods]=row.active===true;
      }
    }

    let billing:any={
      plan:null,
      account:null,
      openStatements:[],
      plans:[],
      paymentRequests:[],
      providerCharges:[],
      refundRecoveries:[],
      pixProviderReady:false
    };
    if(["owner","manager"].includes(selected.member_role)){
      const [
        {data:billingAccount,error:billingAccountError},
        {data:billingPlans,error:billingPlansError},
        {data:billingStatements,error:billingStatementsError},
        {data:billingPaymentRequests,error:billingPaymentRequestsError}
      ]=await Promise.all([
        admin.from("merchant_billing_accounts")
          .select("merchant_id,plan_key,credit_balance_cents,credit_reserved_cents,sales_hold,sales_hold_reason,sales_hold_at,last_daily_close_date,updated_at")
          .eq("merchant_id",selected.merchant_id)
          .maybeSingle(),
        admin.from("merchant_billing_plans")
          .select("plan_key,display_name,billing_mode,platform_fee_bps,purchase_amount_cents,credit_grant_cents,active,sort_order")
          .eq("active",true)
          .order("sort_order",{ascending:true}),
        admin.from("merchant_daily_statements")
          .select("id,business_date,gross_sales_cents,gross_fee_cents,prepaid_credit_applied_cents,amount_due_cents,status,due_at,closed_at,paid_at,waived_at,resolution_reference")
          .eq("merchant_id",selected.merchant_id)
          .in("status",["open","overdue"])
          .order("business_date",{ascending:false})
          .limit(31),
        admin.from("merchant_billing_payment_requests")
          .select("id,request_kind,plan_key,statement_id,refund_recovery_id,expected_amount_cents,merchant_reference,status,requested_at,resolved_at,admin_reference,received_amount_cents,payment_method,reconciliation_key,approval_source")
          .eq("merchant_id",selected.merchant_id)
          .order("requested_at",{ascending:false})
          .limit(30)
      ]);
      if(billingAccountError)throw billingAccountError;
      if(billingPlansError)throw billingPlansError;
      if(billingStatementsError)throw billingStatementsError;
      if(billingPaymentRequestsError)throw billingPaymentRequestsError;

      const {data:billingProviderCharges,error:billingProviderChargesError}=await admin
        .from("merchant_billing_provider_charges")
        .select("id,payment_request_id,provider,correlation_id,amount_cents,status,br_code,qr_code_data_uri,payment_link_url,expires_at,expired_at,completed_at,paid_amount_cents,end_to_end_id,last_error_code,updated_at")
        .eq("merchant_id",selected.merchant_id)
        .order("created_at",{ascending:false})
        .limit(30);
      if(billingProviderChargesError)throw billingProviderChargesError;

      const {data:billingRefundRecoveries,error:billingRefundRecoveriesError}=await admin
        .from("merchant_billing_refund_recoveries")
        .select("id,refund_id,amount_cents,outstanding_cents,currency,status,recovery_payment_request_id,recovered_at,created_at,updated_at")
        .eq("merchant_id",selected.merchant_id)
        .order("created_at",{ascending:false})
        .limit(30);
      if(billingRefundRecoveriesError)throw billingRefundRecoveriesError;

      const currentPlan=(billingPlans??[]).find((p:any)=>p.plan_key===billingAccount?.plan_key)??null;
      billing={
        plan:currentPlan?{
          planKey:currentPlan.plan_key,
          displayName:currentPlan.display_name,
          billingMode:currentPlan.billing_mode,
          platformFeeBps:Number(currentPlan.platform_fee_bps||0)
        }:null,
        account:billingAccount?{
          creditBalanceCents:Number(billingAccount.credit_balance_cents||0),
          creditReservedCents:Number(billingAccount.credit_reserved_cents||0),
          creditAvailableCents:Math.max(0,Number(billingAccount.credit_balance_cents||0)-Number(billingAccount.credit_reserved_cents||0)),
          salesHold:billingAccount.sales_hold===true,
          salesHoldReason:billingAccount.sales_hold_reason??null,
          salesHoldAt:billingAccount.sales_hold_at??null,
          lastDailyCloseDate:billingAccount.last_daily_close_date??null,
          updatedAt:billingAccount.updated_at??null
        }:null,
        openStatements:(billingStatements??[]).map((s:any)=>({
          id:s.id,
          businessDate:s.business_date,
          grossSalesCents:Number(s.gross_sales_cents||0),
          grossFeeCents:Number(s.gross_fee_cents||0),
          prepaidCreditAppliedCents:Number(s.prepaid_credit_applied_cents||0),
          amountDueCents:Number(s.amount_due_cents||0),
          status:s.status,
          dueAt:s.due_at,
          closedAt:s.closed_at,
          paidAt:s.paid_at,
          waivedAt:s.waived_at,
          resolutionReference:s.resolution_reference
        })),
        plans:(billingPlans??[]).map((p:any)=>({
          planKey:p.plan_key,
          displayName:p.display_name,
          billingMode:p.billing_mode,
          platformFeeBps:Number(p.platform_fee_bps||0),
          purchaseAmountCents:p.purchase_amount_cents==null?null:Number(p.purchase_amount_cents),
          creditGrantCents:p.credit_grant_cents==null?null:Number(p.credit_grant_cents)
        })),
        paymentRequests:(billingPaymentRequests??[]).map((r:any)=>({
          id:r.id,
          requestKind:r.request_kind,
          planKey:r.plan_key,
          statementId:r.statement_id,
          refundRecoveryId:r.refund_recovery_id,
          expectedAmountCents:Number(r.expected_amount_cents||0),
          merchantReference:r.merchant_reference,
          status:r.status,
          requestedAt:r.requested_at,
          resolvedAt:r.resolved_at,
          adminReference:r.admin_reference,
          receivedAmountCents:r.received_amount_cents==null?null:Number(r.received_amount_cents),
          paymentMethod:r.payment_method,
          reconciliationKey:r.reconciliation_key,
          approvalSource:r.approval_source,
          pixCharge:(()=>{
            const charges:any[]=(billingProviderCharges??[]).filter(
              (x:any)=>x.payment_request_id===r.id&&x.provider==="woovi"
            );
            const charge:any=
              charges.find((x:any)=>x.status==="completed")
              ??charges.find((x:any)=>["active","preparing"].includes(x.status))
              ??charges[0]
              ??null;
            if(!charge)return null;
            return {
              id:charge.id,
              provider:charge.provider,
              correlationId:charge.correlation_id,
              amountCents:Number(charge.amount_cents||0),
              status:charge.status,
              brCode:charge.br_code??null,
              qrCodeDataUri:charge.qr_code_data_uri??null,
              paymentLinkUrl:charge.payment_link_url??null,
              expiresAt:charge.expires_at??null,
              expiredAt:charge.expired_at??null,
              completedAt:charge.completed_at??null,
              paidAmountCents:charge.paid_amount_cents==null?null:Number(charge.paid_amount_cents),
              endToEndId:charge.end_to_end_id??null,
              lastErrorCode:charge.last_error_code??null,
              updatedAt:charge.updated_at??null
            };
          })()
        })),
        providerCharges:(billingProviderCharges??[]).map((charge:any)=>({
          id:charge.id,
          paymentRequestId:charge.payment_request_id,
          provider:charge.provider,
          correlationId:charge.correlation_id,
          amountCents:Number(charge.amount_cents||0),
          status:charge.status,
          expiresAt:charge.expires_at??null,
          expiredAt:charge.expired_at??null,
          completedAt:charge.completed_at??null,
          paidAmountCents:charge.paid_amount_cents==null?null:Number(charge.paid_amount_cents),
          endToEndId:charge.end_to_end_id??null,
          lastErrorCode:charge.last_error_code??null
        })),
        refundRecoveries:(billingRefundRecoveries??[]).map((recovery:any)=>({
          id:recovery.id,
          refundId:recovery.refund_id,
          amountCents:Number(recovery.amount_cents||0),
          outstandingCents:Number(recovery.outstanding_cents??recovery.amount_cents??0),
          currency:recovery.currency,
          status:recovery.status,
          recoveryPaymentRequestId:recovery.recovery_payment_request_id??null,
          recoveredAt:recovery.recovered_at??null,
          createdAt:recovery.created_at,
          updatedAt:recovery.updated_at
        })),
        pixProviderReady:
          String(Deno.env.get("WOOVI_APP_ID")??"").trim().length>=12
          &&["https://api.woovi.com","https://api.woovi-sandbox.com"].includes(
            String(Deno.env.get("WOOVI_API_BASE_URL")??"https://api.woovi.com")
              .trim().replace(/\/$/,"")
          )
      };
    }else{
      const {data:billingAccount,error:billingAccountError}=await admin
        .from("merchant_billing_accounts")
        .select("sales_hold,sales_hold_reason,sales_hold_at")
        .eq("merchant_id",selected.merchant_id)
        .maybeSingle();
      if(billingAccountError)throw billingAccountError;
      billing={
        plan:null,
        account:billingAccount?{
          salesHold:billingAccount.sales_hold===true,
          salesHoldReason:billingAccount.sales_hold_reason??null,
          salesHoldAt:billingAccount.sales_hold_at??null
        }:null,
        openStatements:[],
        plans:[],
        paymentRequests:[],
        providerCharges:[],
        refundRecoveries:[],
        pixProviderReady:false
      };
    }

    const {data:deliveryMembers,error:deliveryMembersError}=await admin
      .from("merchant_members")
      .select("user_id,member_role,display_name,created_at")
      .eq("merchant_id",selected.merchant_id)
      .eq("active",true)
      .in("member_role",["owner","manager","operator","driver"])
      .order("created_at",{ascending:true});
    if(deliveryMembersError)throw deliveryMembersError;
    const deliveryTeam=(deliveryMembers??[]).map((member,index)=>({
      userId:member.user_id,
      memberRole:member.member_role,
      displayName:member.display_name
        ??(`${member.member_role==="driver"?"Entregador":"Membro"} ${index+1} • ${String(member.user_id).slice(-6).toUpperCase()}`)
    }));

    const byOrder=new Map<string,any[]>();
    for(const item of items){
      if(!byOrder.has(item.order_id))byOrder.set(item.order_id,[]);
      byOrder.get(item.order_id)!.push({
        productCode:item.product_code,
        productName:item.product_name,
        quantity:item.quantity,
        unitPriceCents:item.unit_price_cents,
        lineTotalCents:item.line_total_cents
      });
    }

    return json({
      merchant:{
        merchantId:merchant.id,
        name:merchant.name,
        memberRole:selected.member_role,
        status:merchant.status,
        online:merchant.online,
        trustScore:merchant.trust_score,
        deliveryFeeCents:merchant.delivery_fee_cents,
        baseEtaMinutes:merchant.base_eta_minutes,
        acceptsCitywide:merchant.accepts_citywide,
        acceptsScheduledOrders:merchant.accepts_scheduled_orders===true,
        paymentMethods,
        maxActiveOrders:Number(merchant.max_active_orders??8),
        deliveryFeeConfirmedAt:merchant.delivery_fee_confirmed_at,
        configUpdatedAt:merchant.updated_at,
        performance:{
          completedOrders:Number(performance?.completed_orders??0),
          completionRate:performance?.completion_rate==null?null:Number(performance.completion_rate),
          onTimeRate:performance?.on_time_rate==null?null:Number(performance.on_time_rate),
          avgAcceptSeconds:performance?.avg_accept_seconds==null?null:Number(performance.avg_accept_seconds),
          feedbackCount:Number(performance?.feedback_count??0),
          positiveFeedbackRate:performance?.positive_feedback_rate==null?null:Number(performance.positive_feedback_rate)
        },
        lastSeenAt:merchant.last_seen_at,
        compliance:{
          cnpjStatus:compliance?.cnpj_status??"pending",
          anpStatus:compliance?.anp_status??"pending",
          cnpjVerifiedAt:compliance?.cnpj_verified_at??null,
          anpVerifiedAt:compliance?.anp_verified_at??null,
          cnpjCurrent:cnpjCurrent===true,
          anpCurrent:anpCurrent===true,
          cnpjMaxAgeDays:Number(compliancePolicy?.cnpj_max_age_days??30),
          anpMaxAgeDays:Number(compliancePolicy?.anp_max_age_days??7)
        }
      },
      memberships:memberships
        .filter((m)=>["owner","manager","operator"].includes(m.member_role))
        .map((m)=>({
          merchantId:m.merchant_id,
          memberRole:m.member_role,
          name:merchantNames.get(m.merchant_id)??"Revenda"
        })),
      deliveryTeam,
      billing,
      availableProducts,
      catalog:(catalog??[]).map((item)=>({
        productCode:item.product_code,
        productName:item.product_name,
        priceCents:item.price_cents,
        pricingMode:item.pricing_mode,
        minPriceCents:item.min_price_cents,
        maxPriceCents:item.max_price_cents,
        pricingStrategy:item.pricing_strategy,
        availableStock:item.available_stock,
        active:item.active,
        priceConfirmedAt:item.price_confirmed_at,
        updatedAt:item.updated_at
      })),
      orders:(orders??[]).map((o)=>({
        orderId:o.id,
        publicCode:o.public_code,
        status:o.status,
        address:o.status==="OFFERED_TO_MERCHANT"?null:o.address_text,
        postalCode:o.status==="OFFERED_TO_MERCHANT"?null:o.postal_code,
        addressVisible:o.status!=="OFFERED_TO_MERCHANT",
        deliveryDetailsVisible:o.status!=="OFFERED_TO_MERCHANT",
        customerPhone:o.status==="OFFERED_TO_MERCHANT"?null:o.customer_phone_digits,
        addressComplement:o.status==="OFFERED_TO_MERCHANT"?null:o.address_complement,
        deliveryReference:o.status==="OFFERED_TO_MERCHANT"?null:o.delivery_reference,
        deliveryNotes:o.status==="OFFERED_TO_MERCHANT"?null:o.delivery_notes,
        paymentMethod:o.payment_method,
        cashTenderCents:o.cash_tender_cents,
        deliveryWindowStart:o.delivery_window_start,
        deliveryWindowEnd:o.delivery_window_end,
        comparisonSavingsCents:Number(o.comparison_savings_cents??0),
        grossTotalCents:o.gross_total_cents,
        cashbackReservedCents:o.cashback_reserved_cents,
        totalCents:o.total_cents,
        supplierName:o.supplier_name_snapshot,
        riskReason:o.risk_reason,
        offerExpiresAt:o.offer_expires_at,
        acceptedAt:o.accepted_at,
        dispatchDueAt:o.dispatch_due_at,
        dispatchedAt:o.dispatched_at,
        arrivingAt:o.arriving_at,
        promisedBy:o.promised_by,
        pinFailures:o.pin_failures,
        version:o.version,
        assignedDeliveryUserId:o.assigned_delivery_user_id,
        deliveryAssignedAt:o.delivery_assigned_at,
        deliveryAssignedBy:o.delivery_assigned_by,
        items:byOrder.get(o.id)??[],
        createdAt:o.created_at,
        updatedAt:o.updated_at
      }))
    },200,origin);
  }catch(error){
    if(error instanceof DomainError)return json({error:error.code,message:error.message},error.status,origin);
    console.error("merchant-orders failed",error instanceof Error?error.message:String(error));
    return json({error:"INTERNAL_ERROR",message:"Não foi possível carregar os pedidos da revenda."},500,origin);
  }
});
