import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261009210000_oidc_portal_attestation_v1_136.sql');
const attestor=read('supabase/functions/portal-readiness-attestor/index.ts');
const config=read('supabase/config.toml');
const workflow=read('.github/workflows/launch-readiness.yml');

assert.ok(
  migration.includes('create table if not exists public.platform_portal_attestations')
  &&migration.includes("attestation_source text not null default 'github_oidc_edge'")
  &&migration.includes("repository='carloskk07/gassg'")
  &&migration.includes("repository_id='1399072319'")
  &&migration.includes("repository_owner_id='171106109'"),
  'atestado automático precisa de trilha própria e identidade imutável do repositório'
);
assert.ok(
  migration.includes('alter table public.platform_portal_attestations enable row level security')
  &&migration.includes('revoke all on table public.platform_portal_attestations from public,anon,authenticated')
  &&migration.includes('grant select,insert on table public.platform_portal_attestations to service_role'),
  'atestado de máquina precisa permanecer server-only'
);
assert.ok(
  migration.includes('record_automated_portal_attestation')
  &&migration.includes("coalesce((p_evidence->>'allPortalsReady')::boolean,false)<>true")
  &&migration.includes("coalesce((p_evidence->>'expectedSourceMatches')::boolean,false)<>true")
  &&migration.includes('portals_verified_at=clock_timestamp()')
  &&migration.includes('customer_portal_ok=true')
  &&migration.includes('merchant_portal_ok=true')
  &&migration.includes('admin_portal_ok=true'),
  'RPC automático só pode atualizar o atestado factual depois de prova completa'
);
assert.ok(
  !migration.includes('commerce_enabled=true')
  &&!migration.includes("operation_mode='LIVE'")
  &&!migration.includes('platform_launch_confirmations'),
  'atestado automático nunca pode habilitar comércio, mudar modo ou confirmar warnings'
);

assert.ok(
  attestor.includes('https://token.actions.githubusercontent.com/.well-known/jwks')
  &&attestor.includes('https://token.actions.githubusercontent.com')
  &&attestor.includes('tamao-portal-attestor')
  &&attestor.includes('RSASSA-PKCS1-v1_5')
  &&attestor.includes('crypto.subtle.verify'),
  'endpoint precisa validar assinatura e audiência do GitHub OIDC'
);
assert.ok(
  attestor.includes('repository!==REPOSITORY')
  &&attestor.includes('repository_id')
  &&attestor.includes('repository_owner_id')
  &&attestor.includes('workflow_ref')
  &&attestor.includes('refs/heads/main')
  &&attestor.includes('runner_environment'),
  'claims OIDC precisam prender repo, IDs imutáveis, workflow, branch e runner'
);
assert.ok(
  attestor.includes('https://api.github.com/repos/carloskk07/gassg/commits/main')
  &&attestor.includes('canonicalSha!==expectedSourceSha'),
  'OIDC sozinho não basta: endpoint precisa revalidar o SHA canônico do main'
);
for(const origin of [
  'https://tamao.com.br',
  'https://parceiro.tamao.com.br',
  'https://admin.tamao.com.br'
]){
  assert.ok(attestor.includes(origin),'endpoint precisa provar portal oficial '+origin);
}
assert.ok(
  attestor.includes('/portal-build.json?attest=')
  &&attestor.includes('/js/runtime-config.js?attest=')
  &&attestor.includes('data-chama-portal=')
  &&attestor.includes('TEST_TURNSTILE_KEYS'),
  'prova remota precisa validar build, runtime, HTML isolado e Turnstile não-demo'
);
assert.ok(
  attestor.includes('readJsonBody(req,{maxBytes:4096})')
  &&attestor.includes('record_automated_portal_attestation')
  &&!attestor.includes('admin_operation_mode_action')
  &&!attestor.includes('platform_launch_confirmations'),
  'boundary OIDC precisa ser limitado e incapaz de elevar estado operacional'
);
assert.ok(
  config.includes('[functions.portal-readiness-attestor]')
  &&config.includes('verify_jwt = false'),
  'gateway Supabase deve permitir GitHub OIDC chegar ao verificador customizado'
);

assert.ok(
  workflow.includes("cron: '7,27,47 * * * *'")
  &&workflow.includes('id-token: write')
  &&workflow.includes('audience=tamao-portal-attestor')
  &&workflow.includes('ACTIONS_ID_TOKEN_REQUEST_TOKEN')
  &&workflow.includes('portal-readiness-attestor')
  &&workflow.includes('.readiness.portalsFresh == true')
  &&workflow.includes('.readiness.portalsSourceSha == $sha'),
  'workflow deve renovar a prova antes do TTL de 60 minutos e exigir persistência real'
);
assert.ok(
  workflow.indexOf('Strict remote live portal readiness')
    <workflow.indexOf('Persist OIDC-backed live portal attestation'),
  'persistência só pode ocorrer depois da prova remota estrita'
);

console.log('Portal OIDC attestation V1.136 passou: identidade de máquina, SHA canônico, três portais, least privilege e renovação contínua protegidos.');
