import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {
  createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  DomainError,
  normalizeItems,
  anonymizeOffer,
  hasMerchantLeak,
  requestFingerprint,
  readJsonBody,
  enforceApiQuota
} from "../_shared/domain.js";
import {chooseOffers} from "../_shared/offer-ranking.js";
import {effectiveUnitPrice} from "../_shared/pricing-policy.js";
import {validateServicePostalCode,normalizeAddressNumber,canonicalAddress} from "../_shared/postal-code.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const PUBLISHABLE_KEY = publishableKeys.default ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SECRET_KEY = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CUSTOMER_ALLOWED_ORIGIN=(Deno.env.get("CUSTOMER_ALLOWED_ORIGIN")??"https://chama-sg-cliente.netlify.app").trim();
const CUSTOMER_PRIMARY_ORIGINS=new Set([
  "https://tamao-sg-cliente.pages.dev",
  "https://tamao.com.br",
  "https://www.tamao.com.br",
  CUSTOMER_ALLOWED_ORIGIN
].filter(Boolean));
const QUOTE_TTL_MS = 5 * 60 * 1000;
const PRICE_FRESH_MS = 24 * 60 * 60 * 1000;
const HEARTBEAT_FRESH_MS = 10 * 60 * 1000;
const MIN_SCHEDULE_LEAD_MS = 30 * 60 * 1000;
const MAX_SCHEDULE_HORIZON_MS = 72 * 60 * 60 * 1000;
const MIN_SCHEDULE_WINDOW_MS = 60 * 60 * 1000;
const MAX_SCHEDULE_WINDOW_MS = 4 * 60 * 60 * 1000;

function normalizeDeliveryWindow(body:Record<string,unknown>){
  const rawStart=body.deliveryWindowStart;
  const rawEnd=body.deliveryWindowEnd;
  if(rawStart==null&&rawEnd==null)return null;
  if(rawStart==null||rawEnd==null){
    throw new DomainError("INVALID_DELIVERY_WINDOW","A janela de entrega está incompleta.",400);
  }
  const start=Date.parse(String(rawStart));
  const end=Date.parse(String(rawEnd));
  const now=Date.now();
  if(!Number.isFinite(start)||!Number.isFinite(end)
     || start<now+MIN_SCHEDULE_LEAD_MS
     || start>now+MAX_SCHEDULE_HORIZON_MS
     || end<=start
     || end-start<MIN_SCHEDULE_WINDOW_MS
     || end-start>MAX_SCHEDULE_WINDOW_MS){
    throw new DomainError("INVALID_DELIVERY_WINDOW","Escolha uma janela entre 1 e 4 horas, com pelo menos 30 minutos de antecedência e até 72 horas.",400);
  }
  return {
    start:new Date(start).toISOString(),
    end:new Date(end).toISOString()
  };
}

function originAllowed(origin: string | null) {
  if (!origin) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return CUSTOMER_PRIMARY_ORIGINS.has(origin);
}

function cors(origin: string | null) {
  const allowed = origin && originAllowed(origin) ? origin : ("https://tamao-sg-cliente.pages.dev");
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
}

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function fail(error: unknown, origin: string | null) {
  if (error instanceof DomainError) {
    return json({ error: error.code, message: error.message }, error.status, origin);
  }
  console.error("get-offers failed", error instanceof Error ? error.message : String(error));
  return json({ error: "INTERNAL_ERROR", message: "Não foi possível calcular as ofertas agora." }, 500, origin);
}

async function authenticatedUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new DomainError("UNAUTHORIZED", "Autenticação obrigatória.", 401);
  }

  const token = authHeader.slice("Bearer ".length);
  const authClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    throw new DomainError("UNAUTHORIZED", "Sessão inválida ou expirada.", 401);
  }
  return data.user;
}

type CatalogRow = {
  merchant_id: string;
  product_code: string;
  product_name: string;
  price_cents: number;
  pricing_mode: "fixed"|"range";
  min_price_cents: number;
  max_price_cents: number;
  pricing_strategy: "volume"|"balanced"|"margin";
  available_stock: number;
  price_confirmed_at: string | null;
};

type Candidate = {
  merchantId: string;
  trustScore: number;
  deliveryFeeCents: number;
  etaMinMinutes: number;
  etaMaxMinutes: number;
  totalCents: number;
  items: Array<{
    productCode: string;
    productName: string;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
  }>;
  rankScore: number;
  activeOrders: number;
  recentOrders7d: number;
  completedOrders: number;
  completionRate: number | null;
  onTimeRate: number | null;
  avgAcceptSeconds: number | null;
  feedbackCount: number;
  positiveFeedbackRate: number | null;
  recommendationScore: number;
  maxActiveOrders: number;
  demandLevel: "normal"|"elevated"|"high";
};

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");

  if (!originAllowed(origin)) {
    return json({ error: "ORIGIN_NOT_ALLOWED", message: "Origem não autorizada." }, 403, origin);
  }

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, origin);

  try {
    const user = await authenticatedUser(req);
    const body = await readJsonBody(req);
    const addressNumber=normalizeAddressNumber(body.addressNumber);
    const items = normalizeItems(body.items);
    const deliveryWindow=normalizeDeliveryWindow(body as Record<string,unknown>);
    const paymentMethod=String(body.paymentMethod??"pix").trim().toLowerCase();
    if(!["pix","card","cash"].includes(paymentMethod)){
      throw new DomainError("INVALID_PAYMENT_METHOD","Forma de pagamento inválida.",400);
    }

    const now = Date.now();
    const priceCutoff = new Date(now - PRICE_FRESH_MS).toISOString();
    const heartbeatCutoff = new Date(now - HEARTBEAT_FRESH_MS).toISOString();

    const admin = createClient(SUPABASE_URL, SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    await enforceApiQuota(admin,{userId:user.id,actionName:"get-offers",limit:20,windowSeconds:60});
    await enforceApiQuota(admin,{userId:user.id,actionName:"get-offers-hour",limit:120,windowSeconds:3600});

    const requestedProductCodes=[...new Set(items.map((x)=>x.productCode))];
    const {data:registeredProducts,error:registeredProductsError}=await admin
      .from("product_delivery_profiles")
      .select("product_code,category_key")
      .in("product_code",requestedProductCodes)
      .eq("active",true);
    if(registeredProductsError)throw registeredProductsError;

    const registeredCodes=new Set((registeredProducts??[]).map((row)=>String(row.product_code)));
    if(requestedProductCodes.some((code)=>!registeredCodes.has(code))){
      throw new DomainError("INVALID_PRODUCT","Um ou mais produtos não estão ativos no catálogo TAMÃO.",400);
    }

    const categoryKeys=[...new Set((registeredProducts??[]).map((row)=>String(row.category_key)).filter(Boolean))];
    const {data:activeCategories,error:activeCategoriesError}=categoryKeys.length
      ? await admin
          .from("product_categories")
          .select("category_key")
          .in("category_key",categoryKeys)
          .eq("active",true)
      : {data:[],error:null};
    if(activeCategoriesError)throw activeCategoriesError;
    const activeCategorySet=new Set((activeCategories??[]).map((row)=>String(row.category_key)));
    if((registeredProducts??[]).some((row)=>!activeCategorySet.has(String(row.category_key)))){
      throw new DomainError("INVALID_PRODUCT","Uma categoria solicitada está pausada.",400);
    }

    const {data:launchStatus,error:launchStatusError}=await admin.rpc("commerce_launch_status");
    if(launchStatusError)throw launchStatusError;
    if(launchStatus?.commerceEnabled!==true){
      return json({
        offers:[],
        commerceLaunchBlocked:true,
        launchMode:String(launchStatus?.operationMode??"PRELAUNCH").toLowerCase()
      },200,origin);
    }
    const operationMode=String(launchStatus?.operationMode??"LIVE").trim().toUpperCase();

    const postal=await validateServicePostalCode(admin,body.postalCode);
    const address=canonicalAddress(postal,addressNumber);
    const addressMeta={
      canonicalAddress:address,
      postalValidated:true,
      postalCode:postal.postalCode,
      addressNumber,
      street:postal.street,
      neighborhood:postal.neighborhood??null,
      serviceCity:postal.city,
      serviceState:postal.state
    };

    const { data: merchants, error: merchantError } = await admin
      .from("merchants")
      .select("id,trust_score,delivery_fee_cents,base_eta_minutes,max_active_orders,accepts_scheduled_orders")
      .eq("status", "active")
      .eq("online", true)
      .eq("accepts_citywide", true)
      .gte("delivery_fee_confirmed_at", priceCutoff)
      .gte("last_seen_at", heartbeatCutoff);

    if (merchantError) throw merchantError;

    let modeEligibleMerchants=merchants??[];
    if(operationMode==="PILOT"&&modeEligibleMerchants.length){
      const {data:pilotRows,error:pilotError}=await admin
        .from("pilot_partner_drafts")
        .select("merchant_id")
        .eq("onboarding_status","converted")
        .in("merchant_id",modeEligibleMerchants.map((m)=>m.id));
      if(pilotError)throw pilotError;
      const pilotMerchantIds=new Set((pilotRows??[]).map((row)=>row.merchant_id).filter(Boolean));
      modeEligibleMerchants=modeEligibleMerchants.filter((m)=>pilotMerchantIds.has(m.id));
    }

    if (!modeEligibleMerchants.length) return json({
      offers:[],
      pilotRestricted:operationMode==="PILOT",
      ...addressMeta
    },200,origin);

    const scheduleEligibleMerchants=deliveryWindow
      ? modeEligibleMerchants.filter((m)=>m.accepts_scheduled_orders===true)
      : modeEligibleMerchants;
    if(!scheduleEligibleMerchants.length){
      return json({
        offers:[],
        scheduledDeliveryUnavailable:deliveryWindow!==null,
        ...addressMeta
      },200,origin);
    }

    const scheduledMerchantIds = scheduleEligibleMerchants.map((m) => m.id);
    const {data:paymentRows,error:paymentError}=await admin
      .from("merchant_payment_methods")
      .select("merchant_id")
      .in("merchant_id",scheduledMerchantIds)
      .eq("payment_method",paymentMethod)
      .eq("active",true);
    if(paymentError)throw paymentError;
    const paymentSet=new Set((paymentRows??[]).map((row)=>row.merchant_id));
    const paymentEligibleMerchants=scheduleEligibleMerchants.filter((m)=>paymentSet.has(m.id));
    if(!paymentEligibleMerchants.length){
      return json({
        offers:[],
        paymentMethodUnavailable:true,
        paymentMethod,
        ...addressMeta
      },200,origin);
    }

    const merchantIds = paymentEligibleMerchants.map((m) => m.id);
    const productCodes = items.map((x) => x.productCode);

    const {data:compatibleMerchantIds,error:compatibilityError}=await admin.rpc(
      "filter_delivery_compatible_merchants",
      {p_merchant_ids:merchantIds,p_product_codes:productCodes}
    );
    if(compatibilityError)throw compatibilityError;

    const compatibleSet=new Set((compatibleMerchantIds??[]) as string[]);
    const compatibleMerchants=paymentEligibleMerchants.filter((m)=>compatibleSet.has(m.id));
    if(!compatibleMerchants.length){
      return json({
        offers:[],
        deliveryCompatibilityBlocked:true,
        ...addressMeta
      },200,origin);
    }
    const compatibleIds=compatibleMerchants.map((m)=>m.id);

    const { data: catalog, error: catalogError } = await admin
      .from("catalog_items")
      .select("merchant_id,product_code,product_name,price_cents,pricing_mode,min_price_cents,max_price_cents,pricing_strategy,available_stock,price_confirmed_at")
      .in("merchant_id", compatibleIds)
      .in("product_code", productCodes)
      .eq("active", true)
      .gte("price_confirmed_at", priceCutoff);

    if (catalogError) throw catalogError;

    const {data:loadRows,error:loadError}=await admin.rpc("merchant_offer_load",{
      p_merchant_ids:compatibleIds
    });
    if(loadError)throw loadError;
    const loadByMerchant=new Map(
      ((loadRows??[]) as Array<{merchant_id:string;active_orders:number;recent_orders_7d:number}>)
        .map((row)=>[row.merchant_id,row])
    );

    const {data:performanceRows,error:performanceError}=await admin.rpc(
      "merchant_public_performance",
      {p_merchant_ids:compatibleIds}
    );
    if(performanceError)throw performanceError;
    const performanceByMerchant=new Map(
      ((performanceRows??[]) as Array<{
        merchant_id:string;
        completed_orders:number;
        completion_rate:number|null;
        on_time_rate:number|null;
        avg_accept_seconds:number|null;
        feedback_count:number;
        positive_feedback_rate:number|null;
      }>).map((row)=>[row.merchant_id,row])
    );

    const byMerchant = new Map<string, Map<string, CatalogRow>>();
    for (const row of (catalog ?? []) as CatalogRow[]) {
      if (!byMerchant.has(row.merchant_id)) byMerchant.set(row.merchant_id, new Map());
      byMerchant.get(row.merchant_id)!.set(row.product_code, row);
    }

    const candidates: Candidate[] = [];
    for (const merchant of compatibleMerchants) {
      const merchantCatalog = byMerchant.get(merchant.id);
      if (!merchantCatalog) continue;
      const load=loadByMerchant.get(merchant.id);
      const activeOrders=Number(load?.active_orders??0);
      const recentOrders7d=Number(load?.recent_orders_7d??0);
      const maxActiveOrders=Math.max(1,Number(merchant.max_active_orders??8));
      if(activeOrders>=maxActiveOrders)continue;
      const loadRatio=activeOrders/maxActiveOrders;
      const demandLevel:Candidate["demandLevel"]=loadRatio>=0.75?"high":loadRatio>=0.5?"elevated":"normal";
      const performance=performanceByMerchant.get(merchant.id);

      const snapshotItems: Candidate["items"] = [];
      let subtotal = 0;
      let eligible = true;

      for (const requested of items) {
        const row = merchantCatalog.get(requested.productCode);
        if (!row || row.available_stock < requested.quantity || row.price_cents <= 0) {
          eligible = false;
          break;
        }

        const unitPriceCents=effectiveUnitPrice({
          pricingMode:row.pricing_mode,
          pricingStrategy:row.pricing_strategy,
          minPriceCents:row.min_price_cents,
          preferredPriceCents:row.price_cents,
          maxPriceCents:row.max_price_cents,
          availableStock:row.available_stock,
          requestedQuantity:requested.quantity,
          activeOrders,
          recentOrders7d
        });
        const lineTotal = unitPriceCents * requested.quantity;
        subtotal += lineTotal;
        snapshotItems.push({
          productCode: requested.productCode,
          productName: row.product_name,
          quantity: requested.quantity,
          unitPriceCents,
          lineTotalCents: lineTotal
        });
      }

      if (!eligible) continue;

      const fee = Number(merchant.delivery_fee_cents ?? 0);
      const eta = Number(merchant.base_eta_minutes ?? 30);

      candidates.push({
        merchantId: merchant.id,
        trustScore: Number(merchant.trust_score ?? 80),
        deliveryFeeCents: fee,
        etaMinMinutes: eta,
        etaMaxMinutes: eta + 7,
        totalCents: subtotal + fee,
        items: snapshotItems,
        rankScore: 0,
        activeOrders,
        recentOrders7d,
        completedOrders:Number(performance?.completed_orders??0),
        completionRate:performance?.completion_rate==null?null:Number(performance.completion_rate),
        onTimeRate:performance?.on_time_rate==null?null:Number(performance.on_time_rate),
        avgAcceptSeconds:performance?.avg_accept_seconds==null?null:Number(performance.avg_accept_seconds),
        feedbackCount:Number(performance?.feedback_count??0),
        positiveFeedbackRate:performance?.positive_feedback_rate==null?null:Number(performance.positive_feedback_rate),
        recommendationScore:0,
        maxActiveOrders,
        demandLevel
      });
    }

    const chosen = chooseOffers(candidates) as Array<{candidate:Candidate;label:string}>;
    if (!chosen.length) return json({
      offers:[],
      ...addressMeta
    },200,origin);

    const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString();
    const publicOffers: any[] = [];
    const quoteRecords:Array<{quoteId:string;totalCents:number;safe:any}>=[];

    for (const { candidate, label } of chosen) {
      const fingerprint=await requestFingerprint("quote-snapshot",{
        address,
        postalCode:postal.postalCode,
        addressNumber,
        merchantId:candidate.merchantId,
        deliveryFeeCents:candidate.deliveryFeeCents,
        etaMinMinutes:candidate.etaMinMinutes,
        etaMaxMinutes:candidate.etaMaxMinutes,
        items:candidate.items.map((item)=>({
          productCode:item.productCode,
          quantity:item.quantity,
          unitPriceCents:item.unitPriceCents
        })),
        deliveryWindowStart:deliveryWindow?.start??null,
        deliveryWindowEnd:deliveryWindow?.end??null,
        paymentMethod
      });

      const {data:quote,error:quoteError}=await admin.rpc("create_quote_snapshot_v3",{
        p_user_id:user.id,
        p_merchant_id:candidate.merchantId,
        p_postal_code:postal.postalCode,
        p_address_number:addressNumber,
        p_delivery_fee_cents:candidate.deliveryFeeCents,
        p_eta_min_minutes:candidate.etaMinMinutes,
        p_eta_max_minutes:candidate.etaMaxMinutes,
        p_expires_at:expiresAt,
        p_items:candidate.items.map((item)=>({
          product_code:item.productCode,
          quantity:item.quantity,
          unit_price_cents:item.unitPriceCents
        })),
        p_fingerprint:fingerprint
      });

      if(quoteError){
        const message=String(quoteError.message??"");
        if(message.includes("QUOTE_SOURCE_STALE")||message.includes("DELIVERY_INCOMPATIBLE"))continue;
        throw quoteError;
      }
      if(!quote)throw new Error("Quote snapshot failed");

      const {error:windowUpdateError}=await admin
        .from("quotes")
        .update({
          delivery_window_start:deliveryWindow?.start??null,
          delivery_window_end:deliveryWindow?.end??null,
          payment_method_requested:paymentMethod
        })
        .eq("id",quote.quoteId)
        .eq("customer_id",user.id);
      if(windowUpdateError)throw windowUpdateError;

      const safe:any=anonymizeOffer({
        id:quote.quoteId,
        label,
        total_cents:Number(quote.grossTotalCents),
        eta_min_minutes:Number(quote.etaMinMinutes),
        eta_max_minutes:Number(quote.etaMaxMinutes),
        expires_at:quote.expiresAt,
        trust_score:candidate.trustScore
      });

      safe.completedOrders=candidate.completedOrders;
      safe.completionRate=candidate.completionRate;
      safe.onTimeRate=candidate.onTimeRate;
      safe.avgAcceptSeconds=candidate.avgAcceptSeconds;
      safe.feedbackCount=candidate.feedbackCount;
      safe.positiveFeedbackRate=candidate.positiveFeedbackRate;
      safe.demandLevel=candidate.demandLevel;
      safe.deliveryWindowStart=deliveryWindow?.start??null;
      safe.deliveryWindowEnd=deliveryWindow?.end??null;

      if(hasMerchantLeak(safe))throw new Error("Merchant identity leak detected");
      quoteRecords.push({
        quoteId:String(quote.quoteId),
        totalCents:Number(quote.grossTotalCents),
        safe
      });
    }

    if(quoteRecords.length){
      const comparisonReferenceCents=Math.max(...quoteRecords.map((x)=>x.totalCents));
      const {error:comparisonError}=await admin
        .from("quotes")
        .update({comparison_reference_cents:comparisonReferenceCents})
        .in("id",quoteRecords.map((x)=>x.quoteId))
        .eq("customer_id",user.id);
      if(comparisonError)throw comparisonError;
      for(const record of quoteRecords){
        record.safe.comparisonSavingsCents=Math.max(0,comparisonReferenceCents-record.totalCents);
        publicOffers.push(record.safe);
      }
    }

    return json({
      offers:publicOffers,
      marketMode:candidates.length===1?"single_supplier":"marketplace",
      eligibleMerchantCount:candidates.length,
      displayedOfferCount:publicOffers.length,
      distributionPolicy:candidates.length===1?"single_supplier":"quality_first_balanced",
      ...addressMeta
    }, 200, origin);
  } catch (error) {
    return fail(error, origin);
  }
});
