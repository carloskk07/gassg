import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261009213000_mp_webhook_remote_proof_v1_137.sql');
const webhook=read('supabase/functions/billing-payment-webhook-mercadopago/index.ts');
const adminOps=read('supabase/functions/admin-ops/index.ts');
const admin=read('js/admin.js');

assert.ok(
  migration.includes('create table if not exists public.payment_webhook_probes')
  &&migration.includes("provider in ('mercadopago')")
  &&migration.includes("'TAMAO-WEBHOOK-PROBE-'||gen_random_uuid()::text")
  &&migration.includes("interval '15 minutes'")
  &&migration.includes("expires_at<=requested_at+interval '30 minutes'"),
  'prova deve usar namespace reservado, TTL curto e provider explícito'
);
assert.ok(
  migration.includes('alter table public.payment_webhook_probes enable row level security')
  &&migration.includes('revoke all on table public.payment_webhook_probes from public,anon,authenticated')
  &&migration.includes('grant select,insert,update on table public.payment_webhook_probes to service_role'),
  'provas de webhook devem permanecer server-only'
);
assert.ok(
  migration.includes('admin_create_payment_webhook_probe')
  &&migration.includes("v_role not in ('superadmin','finance')")
  &&migration.includes('action_requests')
  &&migration.includes("'create_payment_webhook_probe'")
  &&migration.includes("'financialMutationAllowed',false"),
  'somente Financeiro/Superadmin pode criar prova auditável e não financeira'
);
assert.ok(
  migration.includes('consume_payment_webhook_probe')
  &&migration.includes("status='verified'")
  &&migration.includes("'signatureVerified',true")
  &&migration.includes("'financialMutationAttempted',false"),
  'consumo deve registrar assinatura comprovada e ausência de mutação financeira'
);

const consumeStart=migration.indexOf('create or replace function public.consume_payment_webhook_probe');
const consumeEnd=migration.indexOf('revoke all on function public.consume_payment_webhook_probe',consumeStart);
const consume=migration.slice(consumeStart,consumeEnd);
for(const forbidden of [
  'merchant_billing_provider_charges',
  'merchant_billing_payment_events',
  'merchant_fee_credit_ledger',
  'merchant_daily_statements',
  'merchant_sale_payment_attempts',
  'merchant_sale_payment_events'
]){
  assert.ok(!consume.includes(forbidden),'consumo da prova não pode tocar '+forbidden);
}

const serve=webhook.slice(webhook.indexOf('Deno.serve'));
const signatureAt=serve.indexOf('verifyMercadoPagoWebhook(req,webhookSecret,dataId)');
const probeRouteAt=serve.indexOf('WEBHOOK_PROBE_RE.test(dataId)');
assert.ok(signatureAt>=0&&probeRouteAt>=0&&signatureAt<probeRouteAt,
  'HMAC oficial deve ser validado antes de reconhecer o namespace de prova');
assert.ok(
  webhook.includes('handleWebhookProbe')
  &&webhook.includes('consume_payment_webhook_probe')
  &&webhook.includes('route:"webhook_probe"')
  &&webhook.includes('signatureVerified:true')
  &&webhook.includes('financialMutationAttempted:false'),
  'webhook deve consumir prova assinada sem alegar pagamento'
);
const helperStart=webhook.indexOf('async function handleWebhookProbe');
const helperEnd=webhook.indexOf('Deno.serve',helperStart);
const helper=webhook.slice(helperStart,helperEnd);
for(const forbidden of [
  'fetchProviderOrder',
  'ingest_merchant_billing_payment_event',
  'ingest_merchant_billing_payment_refund',
  'apply_merchant_sale_payment_event',
  'merchant_billing_provider_charges',
  'merchant_sale_payment_attempts'
]){
  assert.ok(!helper.includes(forbidden),'rota de prova não pode executar '+forbidden);
}

assert.ok(
  adminOps.includes('"create-billing-webhook-probe"')
  &&adminOps.includes('admin_create_payment_webhook_probe')
  &&adminOps.includes('latestVerifiedWebhookProbe')
  &&adminOps.includes('remoteWebhookRegistrationVerified')
  &&adminOps.includes('remoteWebhookProofFreshHours:24'),
  'control plane precisa criar prova e refletir apenas evidência assinada recente'
);
assert.ok(
  adminOps.includes('.from("payment_webhook_probes")')
  &&adminOps.includes('webhookProbes:billingWebhookProbes.data??[]'),
  'summary financeiro precisa persistir estado sanitizado da prova'
);
assert.ok(
  admin.includes('Gerar prova Webhook')
  &&admin.includes('adminGenerateBillingWebhookProbe')
  &&admin.includes('Order (Mercado Pago)')
  &&admin.includes('Data ID')
  &&admin.includes('Webhook remoto comprovado criptograficamente.')
  &&admin.includes('Esta prova confirma transporte + assinatura, não um pagamento.'),
  'Admin deve guiar o simulador sem confundir transporte assinado com pagamento E2E'
);
assert.ok(
  admin.includes("pspE2E=adminBillingE2EState(d)")
  &&admin.includes("events.find")
  &&!admin.includes("webhookProbes.find(x=>String(x.provider"),
  'selo E2E financeiro deve continuar dependente de evento financeiro, não da prova de transporte'
);
assert.ok(
  admin.includes('Os dois testes são não financeiros: não criam Pix, cobrança, saldo ou crédito.'),
  'UX deve declarar explicitamente a ausência de mutação financeira'
);

console.log('Mercado Pago webhook remote proof V1.137 passou: HMAC-before-probe, TTL, server-only, zero-finance e separação E2E protegidos.');
