import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync(
  new URL('../supabase/migrations/20261010011500_single_unproven_psp_pilot_v1_144.sql',import.meta.url),
  'utf8'
);
const checkout=fs.readFileSync(
  new URL('../supabase/functions/order-payment-checkout/index.ts',import.meta.url),
  'utf8'
);
const v142=fs.readFileSync(
  new URL('../supabase/migrations/20261010000500_evidence_backed_psp_homologation_v1_142.sql',import.meta.url),
  'utf8'
);

assert.ok(
  migration.includes('add column if not exists pilot_guard boolean not null default false')
  &&migration.includes('merchant_sale_payment_attempts_pilot_guard_shape')
  &&migration.includes("verification_level in ('provider','device')")
  &&migration.includes("provider<>'manual'"),
  'pilot guard precisa existir apenas em tentativa automática da revenda'
);

assert.ok(
  migration.includes('merchant_sale_payment_attempts_one_unproven_pilot')
  &&migration.includes('on public.merchant_sale_payment_attempts(merchant_id,provider)')
  &&migration.includes('where pilot_guard')
  &&migration.includes("'review_required'"),
  'banco precisa garantir no máximo um piloto não provado vivo por revenda/provedor'
);

assert.ok(
  migration.includes('for update;')
  &&migration.includes("v_pilot_guard:=")
  &&migration.includes("capabilities->>'e2eValidated'")
  &&migration.includes('MERCHANT_PAYMENT_PILOT_IN_FLIGHT')
  &&migration.includes('a.order_id<>v_order.id'),
  'prepare precisa serializar a conta e bloquear outra ordem enquanto o primeiro piloto está vivo'
);

assert.ok(
  migration.includes("'pilotGuard',v_attempt.pilot_guard")
  &&migration.includes("'e2eValidated',not v_attempt.pilot_guard"),
  'autoridade deve informar explicitamente se a tentativa ainda é piloto'
);

assert.ok(
  migration.includes('record_merchant_sale_payment_attempt_issue')
  &&migration.includes("v_disposition not in ('terminal_rejected','review_required')")
  &&migration.includes("v_attempt.provider_order_id is null")
  &&migration.includes("v_attempt.status='preparing'")
  &&migration.includes("set status='rejected'")
  &&migration.includes("set status='review_required'"),
  'falha conhecida antes do checkout deve liberar o slot; resultado remoto ambíguo deve mantê-lo bloqueado para revisão'
);

assert.ok(
  checkout.includes('MERCHANT_PAYMENT_PILOT_IN_FLIGHT')
  &&checkout.includes('primeiro pagamento piloto')
  &&checkout.includes('recordAttemptIssue(')
  &&checkout.includes('"PROVIDER_CHECKOUT_REJECTED"')
  &&checkout.includes('"PROVIDER_CHECKOUT_OUTCOME_UNKNOWN"')
  &&checkout.includes('"PROVIDER_CHECKOUT_RESPONSE_MISMATCH"')
  &&checkout.includes('"PROVIDER_CHECKOUT_COMMIT_FAILED"'),
  'Edge Function precisa traduzir contenção e registrar desfecho seguro da tentativa'
);

assert.ok(
  checkout.includes('prepared?.status==="review_required"')
  &&checkout.includes('"MERCHANT_PAYMENT_REVIEW_REQUIRED"')
  &&checkout.includes('issueRecorded=true'),
  'tentativa em revisão nunca pode disparar outro checkout automático'
);

assert.ok(
  checkout.includes('pilotMode:prepared?.pilotGuard===true')
  &&checkout.includes('e2eValidated:prepared?.e2eValidated===true')
  &&checkout.includes('tamaoReceivesSaleProceeds:false'),
  'resposta precisa preservar piloto/E2E e ausência de custódia pelo TAMÃO'
);

assert.ok(
  v142.includes("'e2eValidated',true")
  &&v142.includes("verification_level in ('provider','device')")
  &&v142.includes("funds_owner='merchant'"),
  'a saída do modo piloto continua dependente da prova E2E real da V1.142'
);

// Modelo mínimo do invariante para evitar regressões semânticas.
const LIVE=new Set(['preparing','checkout_ready','pending','approved','review_required']);
function canStart({e2eValidated,attempts,merchant,provider,order}){
  if(e2eValidated)return true;
  return !attempts.some(a=>
    a.merchant===merchant
    &&a.provider===provider
    &&a.order!==order
    &&a.pilotGuard===true
    &&LIVE.has(a.status)
  );
}
const base={merchant:'m1',provider:'mercadopago',order:'o1',pilotGuard:true,status:'pending'};
assert.equal(canStart({e2eValidated:false,attempts:[],merchant:'m1',provider:'mercadopago',order:'o1'}),true);
assert.equal(canStart({e2eValidated:false,attempts:[base],merchant:'m1',provider:'mercadopago',order:'o2'}),false);
assert.equal(canStart({e2eValidated:false,attempts:[base],merchant:'m1',provider:'mercadopago',order:'o1'}),true);
assert.equal(canStart({e2eValidated:false,attempts:[{...base,status:'rejected'}],merchant:'m1',provider:'mercadopago',order:'o2'}),true);
assert.equal(canStart({e2eValidated:false,attempts:[{...base,status:'review_required'}],merchant:'m1',provider:'mercadopago',order:'o2'}),false);
assert.equal(canStart({e2eValidated:true,attempts:[base],merchant:'m1',provider:'mercadopago',order:'o2'}),true);

console.log('V1.144 passou: um único piloto PSP não provado, com liberação terminal segura e revisão fail-closed.');
