import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261108030000_ads_independent_refund_execution_v1_888.sql');
const admin=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-ads-independent.js');
for(const s of [
 'ads_independent_refund_executions_v1_888','ENABLE ROW LEVEL SECURITY',
 'REVOKE ALL ON public.ads_independent_refund_executions_v1_888',
 'UNIQUE REFERENCES public.ads_independent_campaigns_v1_884',
 'idempotency_key text NOT NULL UNIQUE',
 'ADS_REFUND_EXEC_ADMIN_DENIED','ADS_REFUND_EXEC_REVIEW_REQUIRED',
 'ADS_REFUND_EXEC_PAID_PROOF_REQUIRED','ADS_REFUND_EXEC_ALREADY_REVERSED',
 'admin_ads_independent_refund_execution_v1_888',
 'admin_ads_independent_refund_execution_complete_v1_888',
 'ADS_REFUND_COMPLETE_UNCONFIRMED_CASE','ADS_REFUND_COMPLETE_UNCONFIRMED_PSP',
 'refundProviderAttempt',
])assert.ok(sql.includes(s),'V1.888 missing SQL guard '+s);
assert.match(sql,/status text NOT NULL DEFAULT 'reserved'/);
assert.match(sql,/p_operation NOT IN\('execute','verify'\)/);
assert.match(sql,/admin_role='superadmin'/);
assert.match(sql,/p_expected_version/);
assert.doesNotMatch(sql,/UPDATE public\.merchants|INSERT INTO public\.merchants/i);
assert.match(admin,/if\(action==="ads-independent-refund-provider"\)/);
assert.match(admin,/confirmation!=="DEVOLVER"/);
assert.match(admin,/mercadoPagoFetch\("\/v1\/payments\/"\+paymentId\+"\/refunds"/);
assert.match(admin,/mercadoPagoFetch\("\/v1\/payments\/"\+paymentId,/);
assert.match(admin,/reserved\.created===true/);
assert.match(admin,/providerStatus!=="refunded"/);
assert.match(admin,/fact\?\.status!=="payment_reversed"/);
assert.match(admin,/review\?\.status!=="provider_reversed"/);
assert.match(admin,/sha256Hex\("ads888-refund/);
assert.match(admin,/bankCreditVerified:false/);
assert.match(ui,/adminIndependentRefundProvider/);
assert.match(ui,/Solicitar reembolso integral ao Mercado Pago/);
assert.match(ui,/Verificar devolução no provedor/);
assert.match(ui,/refundProviderAttempt/);
assert.doesNotThrow(()=>new vm.Script(ui),'Admin JS syntactically valid');
console.log('V1.888 PASS: one authorized refund request, no duplicate POST, provider-only proof and restricted finance case.');
