import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {
  createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  DomainError,
  normalizeAddress,
  normalizeItems,
  anonymizeOffer,
  hasMerchantLeak,
  requestFingerprint,
  readJsonBody,
  enforceApiQuota
} from "../_shared/domain.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const PUBLISHABLE_KEY = publishableKeys.default ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SECRET_KEY = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CUSTOMER_ALLOWED_ORIGIN=(Deno.env.get("CUSTOMER_ALLOWED_ORIGIN")??"").trim();
const QUOTE_TTL_MS = 5 * 60 * 1000;
const PRICE_FRESH_MS = 24 * 60 * 60 * 1000;
const HEARTBEAT_FRESH_MS = 10 * 60 * 1000;

function originAllowed(origin: string | null) {
  if (!origin) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return CUSTOMER_ALLOWED_ORIGIN.length>0&&origin===CUSTOMER_ALLOWED_ORIGIN;
}

function cors(origin: string | null) {
  const allowed = origin && originAllowed(origin) ? origin : (CUSTOMER_ALLOWED_ORIGIN||"null");
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
};

function chooseOffers(candidates: Candidate[]) {
  if (!candidates.length) return [];

  const minTotal = Math.min(...candidates.map((x) => x.totalCents));
  const maxTotal = Math.max(...candidates.map((x) => x.totalCents));
  const minEta = Math.min(...candidates.map((x) => x.etaMinMinutes));
  const maxEta = Math.max(...candidates.map((x) => x.etaMinMinutes));

  for (const c of candidates) {
    const priceNorm = maxTotal === minTotal ? 0 : (c.totalCents - minTotal) / (maxTotal - minTotal);
    const etaNorm = maxEta === minEta ? 0 : (c.etaMinMinutes - minEta) / (maxEta - minEta);
    const trustPenalty = (100 - c.trustScore) / 100;
    c.rankScore = priceNorm * 0.40 + etaNorm * 0.35 + trustPenalty * 0.25;
  }

  const recommended = [...candidates].sort((a, b) => a.rankScore - b.rankScore || a.totalCents - b.totalCents)[0];
  const cheapest = [...candidates].sort((a, b) => a.totalCents - b.totalCents || a.etaMinMinutes - b.etaMinMinutes)[0];
  const fastest = [...candidates].sort((a, b) => a.etaMinMinutes - b.etaMinMinutes || a.totalCents - b.totalCents)[0];

  const selected: Array<{ candidate: Candidate; label: string }> = [];
  const pushUnique = (candidate: Candidate | undefined, label: string) => {
    if (candidate && !selected.some((x) => x.candidate.merchantId === candidate.merchantId)) {
      selected.push({ candidate, label });
    }
  };

  pushUnique(recommended, "recommended");
  pushUnique(cheapest, "cheapest");
  pushUnique(fastest, "fastest");

  for (const candidate of [...candidates].sort((a, b) => a.rankScore - b.rankScore)) {
    if (selected.length >= 3) break;
    pushUnique(candidate, "alternative");
  }

  return selected.slice(0, 3);
}

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
    const address = normalizeAddress(body.address);
    const items = normalizeItems(body.items);

    const now = Date.now();
    const priceCutoff = new Date(now - PRICE_FRESH_MS).toISOString();
    const heartbeatCutoff = new Date(now - HEARTBEAT_FRESH_MS).toISOString();

    const admin = createClient(SUPABASE_URL, SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    await enforceApiQuota(admin,{userId:user.id,actionName:"get-offers",limit:20,windowSeconds:60});
    await enforceApiQuota(admin,{userId:user.id,actionName:"get-offers-hour",limit:120,windowSeconds:3600});

    const { data: merchants, error: merchantError } = await admin
      .from("merchants")
      .select("id,trust_score,delivery_fee_cents,base_eta_minutes")
      .eq("status", "active")
      .eq("online", true)
      .eq("accepts_citywide", true)
      .gte("delivery_fee_confirmed_at", priceCutoff)
      .gte("last_seen_at", heartbeatCutoff)
      .limit(40);

    if (merchantError) throw merchantError;
    if (!merchants?.length) return json({ offers: [] }, 200, origin);

    const merchantIds = merchants.map((m) => m.id);
    const productCodes = items.map((x) => x.productCode);

    const {data:compatibleMerchantIds,error:compatibilityError}=await admin.rpc(
      "filter_delivery_compatible_merchants",
      {p_merchant_ids:merchantIds,p_product_codes:productCodes}
    );
    if(compatibilityError)throw compatibilityError;

    const compatibleSet=new Set((compatibleMerchantIds??[]) as string[]);
    const compatibleMerchants=merchants.filter((m)=>compatibleSet.has(m.id));
    if(!compatibleMerchants.length){
      return json({offers:[],deliveryCompatibilityBlocked:true},200,origin);
    }
    const compatibleIds=compatibleMerchants.map((m)=>m.id);

    const { data: catalog, error: catalogError } = await admin
      .from("catalog_items")
      .select("merchant_id,product_code,product_name,price_cents,available_stock,price_confirmed_at")
      .in("merchant_id", compatibleIds)
      .in("product_code", productCodes)
      .eq("active", true)
      .gte("price_confirmed_at", priceCutoff);

    if (catalogError) throw catalogError;

    const byMerchant = new Map<string, Map<string, CatalogRow>>();
    for (const row of (catalog ?? []) as CatalogRow[]) {
      if (!byMerchant.has(row.merchant_id)) byMerchant.set(row.merchant_id, new Map());
      byMerchant.get(row.merchant_id)!.set(row.product_code, row);
    }

    const candidates: Candidate[] = [];
    for (const merchant of compatibleMerchants) {
      const merchantCatalog = byMerchant.get(merchant.id);
      if (!merchantCatalog) continue;

      const snapshotItems: Candidate["items"] = [];
      let subtotal = 0;
      let eligible = true;

      for (const requested of items) {
        const row = merchantCatalog.get(requested.productCode);
        if (!row || row.available_stock < requested.quantity || row.price_cents <= 0) {
          eligible = false;
          break;
        }

        const lineTotal = row.price_cents * requested.quantity;
        subtotal += lineTotal;
        snapshotItems.push({
          productCode: requested.productCode,
          productName: row.product_name,
          quantity: requested.quantity,
          unitPriceCents: row.price_cents,
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
        rankScore: 0
      });
    }

    const chosen = chooseOffers(candidates);
    if (!chosen.length) return json({ offers: [] }, 200, origin);

    const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString();
    const publicOffers: unknown[] = [];

    for (const { candidate, label } of chosen) {
      const fingerprint=await requestFingerprint("quote-snapshot",{
        address,
        merchantId:candidate.merchantId,
        deliveryFeeCents:candidate.deliveryFeeCents,
        etaMinMinutes:candidate.etaMinMinutes,
        etaMaxMinutes:candidate.etaMaxMinutes,
        items:candidate.items.map((item)=>({
          productCode:item.productCode,
          quantity:item.quantity,
          unitPriceCents:item.unitPriceCents
        }))
      });

      const {data:quote,error:quoteError}=await admin.rpc("create_quote_snapshot",{
        p_user_id:user.id,
        p_merchant_id:candidate.merchantId,
        p_address:address,
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

      const safe=anonymizeOffer({
        id:quote.quoteId,
        label,
        total_cents:Number(quote.grossTotalCents),
        eta_min_minutes:Number(quote.etaMinMinutes),
        eta_max_minutes:Number(quote.etaMaxMinutes),
        expires_at:quote.expiresAt,
        trust_score:candidate.trustScore
      });

      if(hasMerchantLeak(safe))throw new Error("Merchant identity leak detected");
      publicOffers.push(safe);
    }

    return json({ offers: publicOffers }, 200, origin);
  } catch (error) {
    return fail(error, origin);
  }
});
