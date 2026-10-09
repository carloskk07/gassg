#!/usr/bin/env bash
set -euo pipefail

if find supabase/functions -type f -name '*.ts' | grep -q .; then
  deno check $(find supabase/functions -type f -name '*.ts' | sort)
fi

if grep -RInE 'sb_secret_[A-Za-z0-9_-]+|SUPABASE_SERVICE_ROLE_KEY[[:space:]]*=[[:space:]]*["'\'' ]*[A-Za-z0-9._-]+' supabase/functions --include='*.ts' --include='*.js'; then
  echo "Secret-like value detected in Edge Function source"
  exit 1
fi

ADMIN_AUTH='supabase/functions/admin-auth/index.ts'
grep -q 'const ADMIN_LIVE_ORIGIN="https://admin.tamao.com.br"' "$ADMIN_AUTH" || { echo "admin-auth missing official origin"; exit 1; }
grep -q 'const ADMIN_PAGES_ORIGIN="https://tamao-sg-admin.pages.dev"' "$ADMIN_AUTH" || { echo "admin-auth missing Cloudflare Pages origin"; exit 1; }
if grep -qE 'localhost|127\\.0\\.0\\.1|ADMIN_ALLOWED_ORIGIN|chama-sg-admin\\.netlify\\.app' "$ADMIN_AUTH"; then
  echo "admin-auth contains non-production or legacy admin origin"
  exit 1
fi

for f in $(find supabase/functions -mindepth 2 -maxdepth 2 -name 'index.ts' | sort); do
  case "$f" in
    supabase/functions/capture-prelaunch-lead/index.ts)
      grep -q 'ALLOWED_ORIGINS' "$f" || { echo "$f missing explicit origin allowlist"; exit 1; }
      grep -q 'capture_prelaunch_lead_idempotent' "$f" || { echo "$f missing transactional lead authority"; exit 1; }
      grep -q 'consume_prelaunch_lead_quota' supabase/migrations/20261006153000_lead_retry_ordering_v1_70_26.sql || { echo "$f transactional authority missing server-side rate limit"; exit 1; }
      grep -q 'body.consent!==true' "$f" || { echo "$f missing explicit consent gate"; exit 1; }
      grep -q 'body.website' "$f" || { echo "$f missing honeypot"; exit 1; }
      grep -q 'raw.length>16000' "$f" || { echo "$f missing payload cap"; exit 1; }
      ;;
    supabase/functions/submit-public-request/index.ts)
      grep -q 'ALLOWED_ORIGINS' "$f" || { echo "$f missing explicit origin allowlist"; exit 1; }
      grep -q 'consume_prelaunch_lead_quota' "$f" || { echo "$f missing server-side rate limit"; exit 1; }
      grep -q 'body.acknowledged!==true' "$f" || { echo "$f missing acknowledgement gate"; exit 1; }
      grep -q 'body.website' "$f" || { echo "$f missing honeypot"; exit 1; }
      grep -q 'raw.length>16000' "$f" || { echo "$f missing payload cap"; exit 1; }
      ;;
    supabase/functions/capture-marketing-event/index.ts)
      grep -q 'ALLOWED_ORIGINS' "$f" || { echo "$f missing explicit origin allowlist"; exit 1; }
      grep -q 'consume_prelaunch_lead_quota' "$f" || { echo "$f missing server-side rate limit"; exit 1; }
      grep -q 'EVENT_TYPES' "$f" || { echo "$f missing event allowlist"; exit 1; }
      grep -q 'raw.length>6000' "$f" || { echo "$f missing payload cap"; exit 1; }
      grep -q 'record_prelaunch_marketing_event' "$f" || { echo "$f missing aggregate RPC"; exit 1; }
      ;;
    supabase/functions/billing-payment-webhook/index.ts)
      grep -q 'x-tamao-signature' "$f" || { echo "$f missing webhook signature header"; exit 1; }
      grep -q 'hmacSha256Hex' "$f" || { echo "$f missing HMAC verification"; exit 1; }
      grep -q 'constantTimeEqualHex' "$f" || { echo "$f missing constant-time signature comparison"; exit 1; }
      grep -q 'MAX_SKEW_SECONDS=300' "$f" || { echo "$f missing anti-replay time window"; exit 1; }
      grep -q 'MAX_BODY_BYTES=16384' "$f" || { echo "$f missing payload cap"; exit 1; }
      grep -q 'BILLING_PAYMENT_WEBHOOK_SECRETS' "$f" || { echo "$f missing provider secret map"; exit 1; }
      grep -q 'ingest_merchant_billing_payment_event' "$f" || { echo "$f missing server-side payment event authority"; exit 1; }
      grep -q '\[functions.billing-payment-webhook\]' supabase/config.toml || { echo "$f missing config.toml entry"; exit 1; }
      ;;
    supabase/functions/billing-payment-webhook-mercadopago/index.ts)
      grep -q 'MERCADOPAGO_WEBHOOK_SECRET' "$f" || { echo "$f missing Mercado Pago webhook secret gate"; exit 1; }
      grep -q 'verifyMercadoPagoWebhook' "$f" || { echo "$f missing Mercado Pago HMAC validation"; exit 1; }
      grep -q 'x-request-id' supabase/functions/_shared/mercadopago.js || { echo "$f missing signed request-id binding"; exit 1; }
      grep -q 'x-signature' supabase/functions/_shared/mercadopago.js || { echo "$f missing signature header parsing"; exit 1; }
      grep -q 'HMAC' supabase/functions/_shared/mercadopago.js || { echo "$f missing HMAC-SHA256 primitive"; exit 1; }
      grep -q 'constantTimeEqualHex' supabase/functions/_shared/mercadopago.js || { echo "$f missing constant-time signature comparison"; exit 1; }
      grep -q '"/v1/orders/"' "$f" || { echo "$f missing authoritative provider order lookup"; exit 1; }
      grep -q 'ingest_merchant_billing_payment_event' "$f" || { echo "$f missing generic payment reconciliation authority"; exit 1; }
      grep -q 'ingest_merchant_billing_payment_refund' "$f" || { echo "$f missing generic refund reconciliation authority"; exit 1; }
      grep -q 'FOREIGN_ORDER_REFERENCE' "$f" || { echo "$f must ignore unrelated Mercado Pago account traffic"; exit 1; }
      grep -q 'MAX_BODY_BYTES=65536' "$f" || { echo "$f missing payload cap"; exit 1; }
      grep -q '\[functions.billing-payment-webhook-mercadopago\]' supabase/config.toml || { echo "$f missing config.toml entry"; exit 1; }
      ;;
    supabase/functions/billing-payment-webhook-woovi/index.ts)
      grep -q 'x-webhook-signature' "$f" || { echo "$f missing Woovi RSA signature header"; exit 1; }
      grep -q 'WOOVI_WEBHOOK_AUTHORIZATION' "$f" || { echo "$f missing private webhook authorization binding"; exit 1; }
      grep -q 'WOOVI_COMPANY_ID' "$f" || { echo "$f missing company binding"; exit 1; }
      grep -q 'RSASSA-PKCS1-v1_5' "$f" || { echo "$f missing RSA-SHA256 verification"; exit 1; }
      grep -q 'webhook/public-keys' "$f" || { echo "$f missing Woovi public-key rotation endpoint"; exit 1; }
      grep -q 'OPENPIX:TRANSACTION_RECEIVED' "$f" || { echo "$f missing Pix-received event allowlist"; exit 1; }
      grep -q 'OPENPIX:CHARGE_COMPLETED' "$f" || { echo "$f missing completed-charge event allowlist"; exit 1; }
      grep -q 'OPENPIX:CHARGE_EXPIRED' "$f" || { echo "$f missing expired-charge event allowlist"; exit 1; }
      grep -q 'PIX_TRANSACTION_REFUND_SENT_CONFIRMED' "$f" || { echo "$f missing confirmed refund-sent event allowlist"; exit 1; }
      grep -q 'merchant_billing_provider_charge_expire' "$f" || { echo "$f missing server-side expiry authority"; exit 1; }
      grep -q 'ingest_merchant_billing_payment_refund' "$f" || { echo "$f missing server-side refund authority"; exit 1; }
      grep -q 'retireWooviSiblingCharges' "$f" || { echo "$f missing regenerated sibling cancellation"; exit 1; }
      grep -q 'method:"DELETE"' "$f" || { echo "$f missing provider-side sibling cancellation"; exit 1; }
      grep -q 'PROVIDER_CANCEL_FAILED' "$f" || { echo "$f missing cancellation failure evidence"; exit 1; }
      grep -q 'endToEndId' "$f" || { echo "$f missing Pix reconciliation identifier"; exit 1; }
      grep -q 'charge.correlationID' "$f" || { echo "$f missing TAMÃO/provider charge correlation"; exit 1; }
      grep -q 'p_provider_correlation_id' "$f" || { echo "$f missing provider correlation transport"; exit 1; }
      grep -q 'MAX_BODY_BYTES=65536' "$f" || { echo "$f missing raw payload cap"; exit 1; }
      grep -q 'ingest_merchant_billing_payment_event' "$f" || { echo "$f missing server-side payment event authority"; exit 1; }
      grep -q '\[functions.billing-payment-webhook-woovi\]' supabase/config.toml || { echo "$f missing config.toml entry"; exit 1; }
      ;;
    supabase/functions/merchant-billing-pix/index.ts)
      grep -q 'auth.getUser' "$f" || { echo "$f missing explicit JWT user validation"; exit 1; }
      grep -q 'BILLING_PIX_PROVIDER' "$f" || { echo "$f missing explicit PSP routing authority"; exit 1; }
      grep -q 'MERCADOPAGO_ACCESS_TOKEN' "$f" || { echo "$f missing Mercado Pago credential gate"; exit 1; }
      grep -q '"/v1/orders"' "$f" || { echo "$f missing Mercado Pago Orders API creation"; exit 1; }
      grep -q 'merchant_billing_pix_charge_prepare_provider' "$f" || { echo "$f missing provider-neutral transactional Pix prepare authority"; exit 1; }
      grep -q 'merchant_billing_provider_charge_commit' "$f" || { echo "$f missing Pix provider commit authority"; exit 1; }
      grep -q 'idempotencyKey:correlationId' "$f" || { echo "$f missing provider idempotency binding"; exit 1; }
      grep -q 'WOOVI_APP_ID' "$f" || { echo "$f must preserve Woovi migration fallback"; exit 1; }
      grep -q 'getWooviCharge' "$f" || { echo "$f must preserve Woovi recovery fallback"; exit 1; }
      grep -q 'enforceApiQuota' "$f" || { echo "$f missing server-side rate limit"; exit 1; }
      grep -q '\[functions.merchant-billing-pix\]' supabase/config.toml || { echo "$f missing config.toml entry"; exit 1; }
      ;;
    *)
      grep -q 'auth.getUser' "$f" || { echo "$f missing explicit JWT user validation"; exit 1; }
      ;;
  esac
  case "$f" in
    supabase/functions/merchant-ops/index.ts|supabase/functions/admin-ops/index.ts|supabase/functions/merchant-billing-pix/index.ts)
      grep -q 'provider-charge-cancel.js' "$f" || { echo "$f missing shared provider cancellation authority"; exit 1; }
      ;;
  esac
done
