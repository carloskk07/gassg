import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

// TAMÃO V1.281 — a small, isolated, read-only endpoint.
// This function never edits products, inventory, prices, payments or audit rows.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const PUBLIC_KEY = publishableKeys.default ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SECRET_KEY = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ORIGINS = new Set([
  "https://parceiro.tamao.com.br",
  "https://tamao-sg-revenda.pages.dev",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCT_RE = /^[A-Z][A-Z0-9_]{1,31}$/;

function allowed(origin: string | null): boolean {
  return !origin || ORIGINS.has(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
function respond(payload: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Vary": "Origin",
      "Access-Control-Allow-Methods": "OPTIONS, POST",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type",
      ...(origin && allowed(origin) ? {"Access-Control-Allow-Origin": origin} : {}),
    },
  });
}
function failure(code: string, status: number, origin: string | null): Response {
  return respond({error: code, message: "Não foi possível consultar este histórico."}, status, origin);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (!allowed(origin)) return failure("ORIGIN_NOT_ALLOWED", 403, null);
  if (req.method === "OPTIONS") return respond({ok: true}, 200, origin);
  if (req.method !== "POST") return failure("METHOD_NOT_ALLOWED", 405, origin);
  const bearer = req.headers.get("Authorization");
  if (!bearer?.startsWith("Bearer ")) return failure("UNAUTHORIZED", 401, origin);
  if (!SUPABASE_URL || !PUBLIC_KEY || !SECRET_KEY) return failure("SERVICE_UNAVAILABLE", 503, origin);

  try {
    const raw = await req.text();
    if (raw.length > 1600) return failure("INVALID_BODY", 400, origin);
    const body = JSON.parse(raw);
    if (!body || Array.isArray(body) || typeof body !== "object")
      return failure("INVALID_BODY", 400, origin);
    const merchantId = typeof body.merchantId === "string" ? body.merchantId : "";
    const action = body.action;
    const productCode = body.productCode == null ? "" : body.productCode;
    const beforeId = body.beforeId == null ? null : body.beforeId;
    if (action !== "catalog-history" || !UUID_RE.test(merchantId))
      return failure("INVALID_REQUEST", 400, origin);
    if (typeof productCode !== "string" ||
      (productCode && !PRODUCT_RE.test(productCode)))
      return failure("INVALID_PRODUCT", 400, origin);
    if (beforeId !== null &&
      (typeof beforeId !== "number" || !Number.isSafeInteger(beforeId) || beforeId <= 0))
      return failure("INVALID_CURSOR", 400, origin);

    const publicClient = createClient(SUPABASE_URL, PUBLIC_KEY,
      {auth: {persistSession: false, autoRefreshToken: false}});
    const {data: userData, error: authError} =
      await publicClient.auth.getUser(bearer.slice("Bearer ".length));
    const user = userData.user;
    if (authError || !user || user.is_anonymous)
      return failure("UNAUTHORIZED", 401, origin);

    const admin = createClient(SUPABASE_URL, SECRET_KEY,
      {auth: {persistSession: false, autoRefreshToken: false}});
    const {data: membership, error: membershipError} = await admin
      .from("merchant_members")
      .select("member_role")
      .eq("merchant_id", merchantId)
      .eq("user_id", user.id)
      .eq("active", true)
      .maybeSingle();
    if (membershipError) return failure("SERVICE_UNAVAILABLE", 503, origin);
    if (!membership || !["owner", "manager"].includes(membership.member_role))
      return failure("MERCHANT_ACCESS_DENIED", 403, origin);

    let query = admin.from("merchant_catalog_change_events")
      .select("id,product_code,actor_user_id,actor_role,actor_display_name,change_kind,old_price_cents,new_price_cents,old_available_stock,new_available_stock,old_active,new_active,old_pricing_mode,new_pricing_mode,old_min_price_cents,new_min_price_cents,old_max_price_cents,new_max_price_cents,old_pricing_strategy,new_pricing_strategy,old_price_confirmed_at,new_price_confirmed_at,recorded_at")
      .eq("merchant_id", merchantId);
    if (productCode) query = query.eq("product_code", productCode);
    if (beforeId !== null) query = query.lt("id", beforeId);
    const {data: rows, error: readError} =
      await query.order("id", {ascending: false}).limit(31);
    if (readError) return failure("HISTORY_UNAVAILABLE", 503, origin);
    const page = (rows ?? []).slice(0, 30);
    const hasMore = (rows ?? []).length > 30;
    return respond({
      source: "merchant_catalog_history_v1_280",
      merchantId, productCode, readOnly: true, hasMore,
      nextBeforeId: hasMore ? Number(page[page.length - 1].id) : null,
      events: page.map(item => ({
        id: item.id,
        productCode: item.product_code,
        actorId: item.actor_user_id,
        actorRole: item.actor_role,
        actorName: item.actor_display_name,
        action: item.change_kind,
        oldPriceCents: item.old_price_cents,
        newPriceCents: item.new_price_cents,
        oldStock: item.old_available_stock,
        newStock: item.new_available_stock,
        oldActive: item.old_active,
        newActive: item.new_active,
        oldPricingMode: item.old_pricing_mode,
        newPricingMode: item.new_pricing_mode,
        oldMinPriceCents: item.old_min_price_cents,
        newMinPriceCents: item.new_min_price_cents,
        oldMaxPriceCents: item.old_max_price_cents,
        newMaxPriceCents: item.new_max_price_cents,
        oldPricingStrategy: item.old_pricing_strategy,
        newPricingStrategy: item.new_pricing_strategy,
        oldPriceConfirmedAt: item.old_price_confirmed_at,
        newPriceConfirmedAt: item.new_price_confirmed_at,
        recordedAt: item.recorded_at,
      })),
    }, 200, origin);
  } catch {
    return failure("HISTORY_UNAVAILABLE", 503, origin);
  }
});
