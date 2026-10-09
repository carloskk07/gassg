import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync(
  new URL('../supabase/migrations/20261009231500_payment_route_metadata_invariants_v1_140.sql',import.meta.url),
  'utf8'
);
const merchant=fs.readFileSync(new URL('../js/merchant.js',import.meta.url),'utf8');

assert.ok(
  migration.includes('merchant_payment_routes_metadata_shape_check')
  &&migration.includes("jsonb_typeof(metadata)='object'")
  &&migration.includes("octet_length(metadata::text)<=8192"),
  'metadata de rota precisa ser objeto JSON pequeno e delimitado'
);

for(const key of [
  'autoManaged',
  'merchantDeclaredProvider',
  'manualProviderFallback',
  'automaticVerification'
]){
  assert.ok(
    migration.includes("metadata ? '"+key+"'")
    &&migration.includes("jsonb_typeof(metadata->'"+key+"')='boolean'"),
    key+' precisa permanecer booleano quando presente'
  );
}

assert.ok(
  migration.includes("metadata->>'fundsOwner'='merchant'")
  &&migration.includes("jsonb_typeof(metadata->'fundsOwner')='string'"),
  'metadata nunca pode declarar outro dono dos fundos'
);

assert.ok(
  migration.includes('merchant_payment_routes_declared_provider_metadata_check')
  &&migration.includes("provider<>'manual'")
  &&migration.includes("verification_mode='merchant_confirmed'")
  &&migration.includes('connection_id is null')
  &&migration.includes("channel='external'")
  &&migration.includes("metadata->>'manualProviderFallback','false'")
  &&migration.includes("metadata->>'automaticVerification','false'"),
  'declaração manual de PSP precisa ser externa, sem conexão e sem autoridade automática'
);

assert.ok(
  migration.includes('merchant_payment_routes_auto_managed_metadata_check')
  &&migration.includes("verification_mode in ('provider_api','device')")
  &&migration.includes('connection_id is not null'),
  'autoManaged só pode descrever rota com conexão automática real'
);

assert.ok(
  merchant.includes('merchantDeclaredProvider:true')
  &&merchant.includes('manualProviderFallback:true')
  &&merchant.includes('automaticVerification:false')
  &&merchant.includes("fundsOwner:'merchant'"),
  'V1.138 precisa continuar emitindo metadata compatível com os novos invariantes'
);

console.log('V1.140 passou: metadata não pode promover fallback manual, alterar funds owner ou simular automação.');
