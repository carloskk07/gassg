import assert from 'node:assert/strict';
import fs from 'node:fs';

const admin=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
const migration=fs.readFileSync(
  new URL('../supabase/migrations/20261010000500_evidence_backed_psp_homologation_v1_142.sql',import.meta.url),
  'utf8'
);

assert.ok(
  admin.includes("const e2eValidated=account?.capabilities?.e2eValidated===true")
  &&admin.includes("const pilotActive=connected&&directEnabled&&canValidate&&!e2eValidated")
  &&admin.includes("const homologated=connected&&directEnabled&&canValidate&&e2eValidated"),
  'UI precisa separar automação ativa de integração verificada por evidência'
);

assert.ok(
  admin.includes("'AUTOMAÇÃO ATIVA'")
  &&admin.includes("'PRONTO PARA ATIVAR'")
  &&admin.includes('Ativar confirmação automática')
  &&admin.includes('integração verificada: <strong>'),
  'admin precisa mostrar explicitamente o ciclo ativação → evidência → integração verificada'
);

assert.ok(
  admin.includes('Integração de pagamento verificada.')
  &&admin.includes('uma venda liquidada gerar evidência verificada do próprio provedor/terminal')
  &&admin.includes('e2eValidated=true'),
  'integração verificada não pode ser apenas um rótulo de conexão/capability'
);

assert.ok(
  migration.includes('create or replace function public.record_order_payment_verification()')
  &&migration.includes("v_provider_evidence boolean:=false")
  &&migration.includes("v_provider_evidence:=true"),
  'promoção E2E precisa nascer do trigger que já registra evidência de liquidação'
);

assert.ok(
  migration.includes("'e2eValidated',true")
  &&migration.includes("'e2eValidatedAt',v_verified_at")
  &&migration.includes("'e2eEvidenceOrderId',new.id::text")
  &&migration.includes("'e2eEvidenceSha256',v_hash")
  &&migration.includes("'e2eVerificationLevel',v_level"),
  'conta PSP precisa persistir prova E2E derivada da evidência transacional'
);

assert.ok(
  migration.includes("where merchant_id=new.merchant_id")
  &&migration.includes("and provider=v_provider")
  &&migration.includes("and status='active'"),
  'prova E2E só pode promover a conta ativa correspondente à revenda/provedor'
);

assert.ok(
  migration.includes("verification_level in ('provider','device')")
  &&migration.includes("provider<>'manual'")
  &&migration.includes("funds_owner='merchant'"),
  'backfill só pode considerar evidência real do provedor/terminal e fundos da revenda'
);

assert.ok(
  !migration.includes("verification_level='merchant'"),
  'confirmação manual nunca pode conceder homologação E2E'
);

console.log('V1.142 passou: homologação PSP depende de evidência real; primeira automação permanece piloto controlado.');
