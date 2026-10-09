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
      grep -q 'constantTimeEqualHex' supabase/functions/_shared/mercadopago.js || { echo "$f missing constant-time signature comparison"; exit 1; }
      grep -q 'merchant_sale_payment_attempts' "$f" || { echo "$f missing exact merchant-sale route authority"; exit 1; }
      grep -q 'decryptPaymentSecret' "$f" || { echo "$f missing seller-owned token decryption"; exit 1; }
      grep -q 'apply_merchant_sale_payment_event' "$f" || { echo "$f missing merchant-sale reconciliation authority"; exit 1; }
      grep -q 'ingest_merchant_billing_payment_event' "$f" || { echo "$f missing TAMÃO billing reconciliation authority"; exit 1; }
      grep -q 'ingest_merchant_billing_payment_refund' "$f" || { echo "$f missing TAMÃO billing refund authority"; exit 1; }
      grep -q 'route:"merchant_sale"' "$f" || { echo "$f missing explicit merchant-sale result route"; exit 1; }
      grep -q 'route:"platform_billing"' "$f" || { echo "$f missing explicit platform-billing result route"; exit 1; }
      grep -q 'providerUserId!==providerAccountId' "$f" || { echo "$f missing exact seller-account binding"; exit 1; }
      grep -q 'MERCADOPAGO_ORDER_ROUTE_NOT_READY' "$f" || { echo "$f must fail retryable on early unknown seller order"; exit 1; }
      grep -q 'MAX_BODY_BYTES=65536' "$f" || { echo "$f missing payload cap"; exit 1; }
      grep -q '\[functions.billing-payment-webhook-mercadopago\]' supabase/config.toml || { echo "$f missing config.toml entry"; exit 1; }
      ! grep -q '\[functions.merchant-sale-payment-webhook-mercadopago\]' supabase/config.toml || { echo "Mercado Pago must use one production Order webhook ingress"; exit 1; }
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
    supabase/functions/merchant-payment-connect/index.ts)
      grep -q 'auth.getUser' "$f" || { echo "$f missing explicit merchant authentication"; exit 1; }
      grep -q 'merchant_payment_oauth_states' "$f" || { echo "$f missing one-time OAuth state persistence"; exit 1; }
      grep -q 'code_challenge_method","S256"' "$f" || { echo "$f missing OAuth PKCE S256"; exit 1; }
      grep -q 'encryptPaymentSecret' "$f" || { echo "$f missing encrypted PKCE verifier"; exit 1; }
      grep -q 'https://auth.mercadopago.com/authorization' "$f" || { echo "$f missing official Mercado Pago authorization endpoint"; exit 1; }
      grep -q '\[functions.merchant-payment-connect\]' supabase/config.toml || { echo "$f missing config.toml entry"; exit 1; }
      ;;
    supabase/functions/merchant-payment-oauth-callback/index.ts)
      grep -q 'consume_merchant_payment_oauth_state' "$f" || { echo "$f missing one-time OAuth state consumption"; exit 1; }
      grep -q 'https://api.mercadopago.com/oauth/token' "$f" || { echo "$f missing server-side OAuth token exchange"; exit 1; }
      grep -q 'https://api.mercadolibre.com/users/me' "$f" || { echo "$f missing seller token/account verification"; exit 1; }
      grep -q 'encryptPaymentSecret' "$f" || { echo "$f missing encrypted seller token storage"; exit 1; }
      grep -q 'directSalePaymentsEnabled:false' "$f" || { echo "$f must connect sellers with direct payments disabled"; exit 1; }
      grep -q '\[functions.merchant-payment-oauth-callback\]' supabase/config.toml || { echo "$f missing config.toml entry"; exit 1; }
      ;;
    supabase/functions/order-payment-checkout/index.ts)
      grep -q 'auth.getUser' "$f" || { echo "$f missing customer authentication"; exit 1; }
      grep -q 'MERCHANT_DIRECT_PAYMENTS_ENABLED' "$f" || { echo "$f missing global direct-payment kill switch"; exit 1; }
      grep -q 'directSalePaymentsEnabled' "$f" || { echo "$f missing per-merchant direct-payment approval"; exit 1; }
      grep -q 'prepare_merchant_sale_payment_attempt' "$f" || { echo "$f missing exact order/merchant/amount DB authority"; exit 1; }
      grep -q 'decryptPaymentSecret' "$f" || { echo "$f missing merchant-owned provider credential use"; exit 1; }
      grep -q 'processing_mode:"manual"' "$f" || { echo "$f missing hosted Checkout Pro mode"; exit 1; }
      grep -q 'providerUserId!==seller.providerAccountId' "$f" || { echo "$f missing exact seller binding"; exit 1; }
      ! grep -q 'marketplace_fee' "$f" || { echo "$f cannot collect/split merchant sale proceeds in PF phase"; exit 1; }
      grep -q 'tamaoReceivesSaleProceeds:false' "$f" || { echo "$f missing explicit no-repass contract"; exit 1; }
      grep -q '\[functions.order-payment-checkout\]' supabase/config.toml || { echo "$f missing config.toml entry"; exit 1; }
      ;;
    supabase/functions/portal-readiness-attestor/index.ts)
      grep -q 'https://token.actions.githubusercontent.com/.well-known/jwks' "$f" || { echo "$f missing GitHub OIDC JWKS"; exit 1; }
      grep -q 'tamao-portal-attestor' "$f" || { echo "$f missing dedicated OIDC audience"; exit 1; }
      grep -q 'RSASSA-PKCS1-v1_5' "$f" || { echo "$f missing OIDC RSA verification"; exit 1; }
      grep -q 'crypto.subtle.verify' "$f" || { echo "$f missing OIDC signature verification"; exit 1; }
      grep -q 'repository!==REPOSITORY' "$f" || { echo "$f missing exact repository claim binding"; exit 1; }
      grep -q 'repository_id' "$f" || { echo "$f missing immutable repository id binding"; exit 1; }
      grep -q 'repository_owner_id' "$f" || { echo "$f missing immutable owner id binding"; exit 1; }
      grep -q 'workflow_ref' "$f" || { echo "$f missing exact workflow claim binding"; exit 1; }
      grep -q 'https://api.github.com/repos/carloskk07/gassg/commits/main' "$f" || { echo "$f missing independent GitHub main proof"; exit 1; }
      grep -q 'record_automated_portal_attestation' "$f" || { echo "$f missing server-only portal attestation authority"; exit 1; }
      grep -q 'readJsonBody(req,{maxBytes:4096})' "$f" || { echo "$f missing small payload cap"; exit 1; }
      ! grep -q 'admin_operation_mode_action' "$f" || { echo "$f must not mutate operation mode"; exit 1; }
      ! grep -q 'platform_launch_confirmations' "$f" || { echo "$f must not confirm launch warnings"; exit 1; }
      grep -q '\[functions.portal-readiness-attestor\]' supabase/config.toml || { echo "$f missing config.toml entry"; exit 1; }
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


# Mercado Pago provider cancellation authority: local cancellation must not
# leave a remotely payable Order behind, including late-create races.
CANCEL_HELPER="supabase/functions/_shared/provider-charge-cancel.js"
grep -q 'cancelMercadoPagoCharge' "$CANCEL_HELPER" || { echo "Mercado Pago provider cancellation authority missing"; exit 1; }
grep -q 'MERCADOPAGO_CANCEL_BINDING_MISMATCH' "$CANCEL_HELPER" || { echo "Mercado Pago cancellation missing binding proof"; exit 1; }
grep -q 'MERCADOPAGO_PAYMENT_ALREADY_RECEIVED' "$CANCEL_HELPER" || { echo "Mercado Pago cancellation must refuse paid orders"; exit 1; }
grep -q '"/v1/orders/"' "$CANCEL_HELPER" || { echo "Mercado Pago cancellation missing authoritative Orders API lookup"; exit 1; }
grep -q 'charge.provider==="mercadopago"' "$CANCEL_HELPER" || { echo "Mercado Pago cancellation not wired into provider dispatcher"; exit 1; }
