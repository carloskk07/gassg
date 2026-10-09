import assert from 'node:assert/strict';
import fs from 'node:fs';

const admin=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
const checkout=fs.readFileSync(new URL('../supabase/functions/order-payment-checkout/index.ts',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../supabase/migrations/20261009231500_payment_route_metadata_invariants_v1_140.sql',import.meta.url),'utf8');

assert.ok(
  admin.includes('function adminMerchantPspHomologationQueue(d)')
  &&admin.includes('HOMOLOGAÇÃO MULTI-PSP')
  &&admin.includes('Fila técnica de provedores'),
  'admin precisa ter uma fila explícita de homologação multi-PSP'
);

for(const stage of [
  'AÇÃO IMEDIATA',
  'HOMOLOGADO',
  'PRONTO PARA E2E',
  'CONECTADO',
  'IMPLEMENTADO',
  'PREPARADO',
  'MANUAL',
  'PLANEJADO'
]){
  assert.ok(admin.includes("stage='"+stage+"'"),'fila precisa representar estágio '+stage);
}

assert.ok(
  admin.includes("row.account?.capabilities?.directSalePaymentsEnabled===true")
  &&admin.includes("row.account?.capabilities?.canValidateProviderTransactions===true")
  &&admin.includes("homologated=connected&&directEnabled&&canValidate"),
  'HOMOLOGADO exige conta ativa e as duas capabilities financeiras'
);

assert.ok(
  admin.includes("directEnabled&&!canValidate")
  &&admin.includes("statusLabel=!connected")
  &&admin.includes("'INCONSISTENTE'")
  &&admin.includes('Suspenda a automação e revise a homologação'),
  'estado parcial não pode aparecer como homologado'
);

assert.ok(
  admin.includes("priority='P0'")
  &&admin.includes("declaredMerchants>=2")
  &&admin.includes("declaredMerchants===1")
  &&admin.includes("priority='P2'")
  &&admin.includes("priority='P3'"),
  'prioridade precisa ser determinística e orientada por risco/demanda'
);

assert.ok(
  admin.includes('Sem demanda, o TAMÃO não força integração nem troca de PSP.')
  &&admin.includes('Conectar não significa homologar.')
  &&admin.includes('O dinheiro continua pertencendo à revenda.'),
  'fila não pode sugerir lock-in, custódia ou homologação implícita'
);

assert.ok(
  checkout.includes('.in("verification_mode",["provider_api","device"])'),
  'checkout automático continua limitado a rotas com autoridade automática'
);

assert.ok(
  migration.includes('merchant_payment_routes_declared_provider_metadata_check')
  &&migration.includes("verification_mode='merchant_confirmed'")
  &&migration.includes('connection_id is null'),
  'fallback manual permanece protegido no banco enquanto a fila evolui'
);

console.log('V1.141 passou: fila de homologação multi-PSP é determinística, fail-closed e sem custódia.');
