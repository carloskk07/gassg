import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync(
  new URL('../supabase/migrations/20261010014500_first_real_psp_pilot_preflight_v1_146.sql',import.meta.url),
  'utf8'
);
const adminOps=fs.readFileSync(
  new URL('../supabase/functions/admin-ops/index.ts',import.meta.url),
  'utf8'
);
const admin=fs.readFileSync(
  new URL('../js/admin.js',import.meta.url),
  'utf8'
);
const v144=fs.readFileSync(
  new URL('../supabase/migrations/20261010011500_single_unproven_psp_pilot_v1_144.sql',import.meta.url),
  'utf8'
);

assert.ok(
  migration.includes('admin_merchant_provider_payment_preflight')
  &&migration.includes("'readyForCapabilityActivation',v_ready")
  &&migration.includes("'preflightVersion','v1.146'")
  &&migration.includes("'fundsOwner','merchant'")
  &&migration.includes("'tamaoReceivesSaleProceeds',false"),
  'preflight deve ser autoridade server-side, versionada e sem custódia TAMÃO'
);

for(const required of [
  "'adapter-implemented'",
  "'merchant-direct-funds'",
  "'merchant-active'",
  "'account-connected'",
  "'account-active'",
  "'provider-account-bound'",
  "'validation-capable'",
  "'connection-fresh'",
  "'account-healthy'",
  "'automated-route'",
  "'payment-review-clear'",
  "'pilot-slot-clear'"
]){
  assert.ok(migration.includes(required),'gate obrigatório ausente: '+required);
}

assert.ok(
  migration.includes("v_account.token_expires_at>clock_timestamp()+interval '10 minutes'")
  &&migration.includes("v_account.last_error_code is null")
  &&migration.includes("verification_mode in ('provider_api','device')")
  &&migration.includes('connection_id=v_account.id'),
  'preflight deve exigir credencial fresca, conta saudável e rota automática vinculada'
);

assert.ok(
  migration.includes("status='review_required'")
  &&migration.includes('pilot_guard')
  &&migration.includes("'preparing','checkout_ready','pending','approved','review_required'"),
  'preflight deve manter revisão e piloto vivo como bloqueadores'
);

assert.ok(
  migration.includes("for update;")
  &&migration.includes("for share;")
  &&migration.includes('MERCHANT_PAYMENT_AUTOMATED_ROUTE_REQUIRED')
  &&migration.includes('MERCHANT_PAYMENT_PILOT_IN_FLIGHT')
  &&migration.includes('MERCHANT_PAYMENT_MERCHANT_NOT_ACTIVE'),
  'activation RPC precisa revalidar com locks, sem confiar no preflight do navegador'
);

assert.ok(
  migration.includes("'activate_merchant_payment_pilot'")
  &&migration.includes("'reactivate_merchant_direct_payment'")
  &&migration.includes("'pilotGuardRequired',p_enabled and not v_e2e_validated")
  &&migration.includes("'routeId',case when p_enabled then v_route.id else null end"),
  'auditoria precisa distinguir primeiro piloto de reativação e registrar rota/proteção'
);

assert.ok(
  migration.includes('revoke all on function public.admin_merchant_provider_payment_preflight')
  &&migration.includes('from public,anon,authenticated')
  &&migration.includes('to service_role'),
  'RPC de preflight não pode virar API privilegiada para browser'
);

assert.ok(
  adminOps.includes('"merchant-payment-preflight"')
  &&adminOps.includes('merchantPaymentRuntimeReadiness')
  &&adminOps.includes('"runtime-webhook-secret"')
  &&adminOps.includes('"runtime-encryption"')
  &&adminOps.includes('"global-kill-switch"')
  &&adminOps.includes('readyForActivation:data?.readyForCapabilityActivation===true&&runtime.ok'),
  'gateway deve combinar preflight do banco com runtime e kill-switch'
);

assert.ok(
  adminOps.includes('if(preflight.readyForActivation!==true)')
  &&adminOps.includes('"MERCHANT_PAYMENT_PREFLIGHT_FAILED"'),
  'mutation administrativa deve falhar se o preflight não estiver totalmente verde'
);

assert.ok(
  admin.includes('Verificar ativação')
  &&admin.includes('Verificação de ativação aprovada.')
  &&admin.includes('Ativação bloqueada.')
  &&admin.includes('adminRunMerchantPaymentPreflight')
  &&admin.includes('disabled title="Conclua a verificação antes da ativação"'),
  'Admin deve exigir verificação visível antes de habilitar a confirmação automática'
);

assert.ok(
  admin.includes("const typed=activationKind==='pilot'?'ATIVAR PAGAMENTOS':'REATIVAR'")
  &&admin.includes('const fresh=await adminRunMerchantPaymentPreflight')
  &&admin.includes('O estado mudou depois da confirmação. A ativação permaneceu bloqueada.'),
  'ativação deve usar confirmação reforçada e revalidar imediatamente antes da escrita'
);

assert.ok(
  v144.includes('merchant_sale_payment_attempts_one_unproven_pilot')
  &&v144.includes('MERCHANT_PAYMENT_PILOT_IN_FLIGHT'),
  'V1.146 não pode substituir ou enfraquecer a contenção física da V1.144'
);

// Modelo do gate composto: banco + runtime + kill-switch precisam estar verdes.
function ready(dbGates,runtimeGates){
  return dbGates.every(Boolean)&&runtimeGates.every(Boolean);
}
assert.equal(ready([true,true,true],[true,true,true]),true);
assert.equal(ready([true,true,true],[true,true,false]),false);
assert.equal(ready([true,false,true],[true,true,true]),false);

console.log('V1.146 passou: primeiro piloto exige preflight visível, runtime verde e revalidação atômica.');
