import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import {
  createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  DomainError,
  validateIdempotencyKey,
  requestFingerprint,
  readJsonBody,
  enforceApiQuota,
  platformCommerceAllowed
} from "../_shared/domain.js";

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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function originAllowed(origin: string | null) {
  if (!origin) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return CUSTOMER_PRIMARY_ORIGINS.has(origin);
}

function cors(origin: string | null) {
  const allowed = origin && originAllowed(origin) ? origin : ("https://tamao-sg-cliente.pages.dev");
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, idempotency-key",
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

function mapRpcError(error: { message?: string; code?: string } | null) {
  const message = String(error?.message ?? "");
  const known: Record<string, { status: number; message: string }> = {
    QUOTE_NOT_FOUND: { status: 404, message: "Cotação não encontrada." },
    QUOTE_ALREADY_USED: { status: 409, message: "Esta cotação já foi utilizada." },
    QUOTE_EXPIRED: { status: 409, message: "Esta cotação expirou. Atualize as ofertas." },
    QUOTE_STALE: { status: 409, message: "A disponibilidade mudou. Atualize as ofertas." },
    ACTIVE_ORDER_EXISTS: { status: 409, message: "Você já possui um pedido em andamento." },
    IDEMPOTENCY_CONFLICT: { status: 409, message: "A mesma chave foi usada para outra requisição." },
    INVALID_PAYMENT_METHOD: { status: 400, message: "Forma de pagamento inválida." },
    INVALID_CASH_TENDER: { status: 400, message: "O valor para troco precisa cobrir o total do pedido." },
    CASH_TENDER_REQUIRES_CASH: { status: 400, message: "Valor para troco só pode ser usado em pagamento em dinheiro." },
    MERCHANT_AT_CAPACITY: { status: 409, message: "O parceiro atingiu a capacidade de pedidos agora. Atualize as opções." },
    INVALID_DELIVERY_WINDOW: { status: 400, message: "A janela de entrega não é mais válida. Escolha outro horário." },
    SCHEDULED_DELIVERY_UNAVAILABLE: { status: 409, message: "Este parceiro não está mais aceitando pedidos agendados." },
    PAYMENT_METHOD_MISMATCH: { status: 409, message: "A forma de pagamento mudou depois da cotação. Atualize as opções." },
    PAYMENT_METHOD_UNAVAILABLE: { status: 409, message: "Este parceiro não aceita mais esta forma de pagamento. Atualize as opções." },
    ORDER_DELIVERY_PAYMENT_ROUTE_NOT_AUTHORIZED: { status: 409, message: "A revenda não aceita mais esta modalidade na entrega. Atualize as ofertas." },
    INVALID_CUSTOMER_PHONE: { status: 400, message: "Informe um telefone válido com DDD." },
    INVALID_ADDRESS_COMPLEMENT: { status: 400, message: "Complemento de endereço inválido." },
    INVALID_DELIVERY_REFERENCE: { status: 400, message: "Referência de entrega inválida." },
    INVALID_DELIVERY_NOTES: { status: 400, message: "Instruções de entrega inválidas." },
    POSTAL_CODE_UNVERIFIED: { status: 409, message: "A validação do CEP desta oferta expirou. Atualize as opções antes de pedir." },
    POSTAL_CODE_OUTSIDE_SERVICE_AREA: { status: 409, message: "Este CEP não pertence mais à área atendida." },
    QUOTE_ADDRESS_NOT_CANONICAL: { status: 409, message: "O endereço desta oferta precisa ser validado novamente." },
    COMMERCE_NOT_ENABLED: { status: 409, message: "Os pedidos reais ainda não foram liberados. Aguarde a abertura oficial do TAMÃO." },
    PILOT_MERCHANT_NOT_ALLOWED: { status: 409, message: "Esta oferta não está mais disponível para esta operação. Atualize as opções." },
    COUPON_PAID_NET_FUNDS_REQUIRED: { status: 409, message: "O pagamento e a compensação deste cupom ainda não foram confirmados." },
    COUPON_AND_CASHBACK_EXCEED_QUOTE: { status: 409, message: "Escolha uma cesta maior ou atualize os benefícios antes de aplicar o cupom." },
    COUPON_ORDER_MONEY_MISMATCH: { status: 409, message: "Os valores do cupom e do pedido precisam ser atualizados." },
    COUPON_NOT_AVAILABLE: { status: 409, message: "Este cupom não está disponível para esta cotação." },
    COUPON_INVALID_OR_SPENT: { status: 409, message: "Cupom utilizado, expirado ou indisponível." },
    COUPON_QUOTE_INVALID: { status: 409, message: "Atualize sua cotação antes de usar o cupom." },
    COUPON_NOT_OWNED: { status: 403, message: "Cupom não pertence a esta conta." }
  };

  for (const [code, meta] of Object.entries(known)) {
    if (message.includes(code)) return { code, ...meta };
  }
  if (message.includes("orders_one_active_per_customer_idx")) {
    return { code: "ACTIVE_ORDER_EXISTS", status: 409, message: "Você já possui um pedido em andamento." };
  }
  return { code: "CREATE_ORDER_FAILED", status: 500, message: "Não foi possível criar o pedido." };
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

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");

  if (!originAllowed(origin)) {
    return json({ error: "ORIGIN_NOT_ALLOWED", message: "Origem não autorizada." }, 403, origin);
  }

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, origin);

  try {
    const user = await authenticatedUser(req);
    const idempotencyKey = validateIdempotencyKey(req.headers.get("Idempotency-Key"));
    const body = await readJsonBody(req);

    const quoteId = String(body.quoteId ?? "");
    if (!UUID_RE.test(quoteId)) {
      throw new DomainError("INVALID_QUOTE", "Identificador de cotação inválido.", 400);
    }

    const paymentMethod = String(body.paymentMethod ?? "pix");
    if (!["pix", "card", "cash"].includes(paymentMethod)) {
      throw new DomainError("INVALID_PAYMENT_METHOD", "Forma de pagamento inválida.", 400);
    }

    const useCashback = body.useCashback === true;
    const couponVoucherId=body.couponVoucherId==null?"":String(body.couponVoucherId).trim();
    if(couponVoucherId&&!UUID_RE.test(couponVoucherId))
      throw new DomainError("COUPON_INVALID","Cupom inválido.",400);
    if(couponVoucherId&&!useCashback)
      throw new DomainError("COUPON_REQUIRES_CASHBACK","Ative os benefícios TAMÃO para usar o cupom.",400);
    // Existing regular checkout remains untouched. Paid-coupon checkout
    // cannot run until both sale and net-settlement E2E gates are enabled.
    if(couponVoucherId&&Deno.env.get("CLUBE_COUPON_CHECKOUT_ENABLED")!=="true")
      throw new DomainError("COUPON_CHECKOUT_NOT_ENABLED","Uso de cupons indisponível no momento.",423);
    const rawCashTender = body.cashTenderCents;
    const cashTenderCents = rawCashTender == null || rawCashTender === ""
      ? null
      : Number(rawCashTender);
    if (cashTenderCents != null && (!Number.isInteger(cashTenderCents) || cashTenderCents < 1 || cashTenderCents > 1000000)) {
      throw new DomainError("INVALID_CASH_TENDER", "Valor para troco inválido.", 400);
    }
    if (paymentMethod !== "cash" && cashTenderCents != null) {
      throw new DomainError("CASH_TENDER_REQUIRES_CASH", "Troco só se aplica ao pagamento em dinheiro.", 400);
    }

    const referralCode = body.referralCode == null
      ? null
      : String(body.referralCode).trim().toUpperCase().slice(0, 20);

    // Optional acquisition UTM is not a payment parameter and cannot authorize benefits.
    const campaignTag = typeof body.campaignTag==="string" &&
      /^tam-(?:customer_cashback|customer_referral|merchant_referral|clube_coupons)-\d{6}-[a-z0-9_-]{8,80}$/.test(body.campaignTag)
        ?body.campaignTag:null;

    const customerPhoneDigits = String(body.customerPhone ?? "").replace(/\D/g, "");
    if (!/^[0-9]{10,11}$/.test(customerPhoneDigits)) {
      throw new DomainError("INVALID_CUSTOMER_PHONE", "Informe um telefone válido com DDD.", 400);
    }

    const cleanOptionalText = (value: unknown, max: number, code: string, message: string) => {
      const text = String(value ?? "").trim().replace(/\s+/g, " ");
      if (!text) return null;
      if (text.length > max || /[\u0000-\u001F\u007F]/.test(text)) {
        throw new DomainError(code, message, 400);
      }
      return text;
    };
    const addressComplement = cleanOptionalText(body.addressComplement, 120, "INVALID_ADDRESS_COMPLEMENT", "Complemento de endereço inválido.");
    const deliveryReference = cleanOptionalText(body.deliveryReference, 160, "INVALID_DELIVERY_REFERENCE", "Referência de entrega inválida.");
    const deliveryNotes = cleanOptionalText(body.deliveryNotes, 240, "INVALID_DELIVERY_NOTES", "Instruções de entrega inválidas.");

    const fingerprintPayload = {
      quoteId,
      paymentMethod,
      useCashback,
      referralCode,
      cashTenderCents,
      customerPhoneDigits,
      addressComplement,
      deliveryReference,
      deliveryNotes,
      ...(couponVoucherId?{couponVoucherId}:{}),
      ...(campaignTag?{campaignTag}:{})
    };
    const requestHash = await requestFingerprint("create-order", fingerprintPayload);

    const admin = createClient(SUPABASE_URL, SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    // Defense in depth. Ordinary checkout continues using its established
    // DB gate; the special prepaid-coupon rail must additionally respect
    // the central commercial switch, independent of its own env flag.
    if(couponVoucherId&&!await platformCommerceAllowed(admin))
      throw new DomainError("COMMERCE_NOT_ENABLED",
        "A operação comercial do TAMÃO ainda não está liberada.",423);
    await enforceApiQuota(admin,{userId:user.id,actionName:"create-order",limit:12,windowSeconds:600});

    const baseOrderArgs={
      p_user_id: user.id,
      p_quote_id: quoteId,
      p_payment_method: paymentMethod,
      p_idempotency_key: idempotencyKey,
      p_request_hash: requestHash,
      p_referral_code: referralCode,
      p_cash_tender_cents: cashTenderCents,
      p_customer_phone: customerPhoneDigits,
      p_address_complement: addressComplement,
      p_delivery_reference: deliveryReference,
      p_delivery_notes: deliveryNotes
    };
    const { data, error } = couponVoucherId
      ?await admin.rpc("clube_coupon_paid_create_order",{
        ...baseOrderArgs,p_voucher_id:couponVoucherId
       })
      :await admin.rpc("create_order_from_quote_v8",{
        ...baseOrderArgs,p_use_cashback:useCashback
       });

    if (error) {
      const mapped = mapRpcError(error);
      console.error("create-order rpc failed", mapped.code);
      return json({ error: mapped.code, message: mapped.message }, mapped.status, origin);
    }

    // Best effort only: order creation and its idempotency are authoritative.
    // A missing/invalid campaign never blocks a purchase or changes a payment.
    if(campaignTag && UUID_RE.test(String(data?.orderId||""))){
      try{
        const {data:linked,error:linkError}=await admin.rpc("owner_order_campaign_bind_v1_252",{
          p_customer:user.id,p_order:data.orderId,p_tag:campaignTag
        });
        if(linkError||linked?.source!=="owner_order_attribution_v1_252"||
          linked?.recorded!==true||linked?.noCharge!==true||
          linked?.spendableCents!==0)
          console.warn("owner campaign attribution unavailable");
      }catch{
        console.warn("owner campaign attribution unavailable");
      }
    }

    return json(data, 201, origin);
  } catch (error) {
    if (error instanceof DomainError) {
      return json({ error: error.code, message: error.message }, error.status, origin);
    }
    console.error("create-order failed", error instanceof Error ? error.message : String(error));
    return json({ error: "INTERNAL_ERROR", message: "Não foi possível criar o pedido." }, 500, origin);
  }
});
