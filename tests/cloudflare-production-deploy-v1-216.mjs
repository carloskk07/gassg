import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const workflow=read('.github/workflows/cloudflare-production-deploy.yml');
const builder=read('scripts/build-cloudflare-portal.mjs');
const docs=read('CLOUDFLARE_PORTALS.md');
const audit=read('.github/workflows/audit.yml');

assert.match(workflow,/name: TAMÃO Cloudflare official production deploy/);
assert.match(workflow,/push:\s*\n\s*branches: \[main\]/);
assert.match(workflow,/workflow_dispatch:/);
assert.match(workflow,/concurrency:\s*\n\s*group: tamao-cloudflare-official-production/);
assert.match(workflow,/cancel-in-progress: true/);
assert.match(workflow,/CLOUDFLARE_API_TOKEN/);
assert.match(workflow,/CLOUDFLARE_ACCOUNT_ID/);
assert.match(workflow,/exit 1/);
assert.match(workflow,/if: needs\.credential-gate\.outputs\.enabled == 'true'/);
assert.match(workflow,/timeout-minutes: 15/);
assert.match(workflow,/\$GITHUB_REF.*refs\/heads\/main/);
assert.match(workflow,/\$GITHUB_REPOSITORY.*carloskk07\/gassg/);
assert.match(workflow,/git rev-parse FETCH_HEAD/);
assert.match(workflow,/\$GITHUB_SHA/);

for(const [project,role,domain] of [
 ['tamao-sg-cliente','customer','https://tamao.com.br'],
 ['tamao-sg-revenda','merchant','https://parceiro.tamao.com.br'],
 ['tamao-sg-admin','admin','https://admin.tamao.com.br']
]){
 const re=new RegExp('- project: '+project+'\\s*\\n\\s*portalRole: '+role);
 assert.match(workflow,re);
 assert.ok(builder.includes("'"+project+"'"),'Builder must know '+project);
 assert.ok(builder.includes("role:'"+role+"'"),'Builder role '+role);
 assert.ok(workflow.includes('node scripts/build-cloudflare-portal.mjs'));
 assert.ok(docs.includes(project)&&docs.includes(domain));
}
assert.match(workflow,/CHAMA_CLOUDFLARE_PROJECT: \$\{\{ matrix\.project \}\}/);
assert.match(workflow,/CHAMA_SOURCE_SHA: \$\{\{ github\.sha \}\}/);
assert.match(workflow,/manifest\.sourceSha,process\.env\.CHAMA_SOURCE_SHA/);
assert.match(workflow,/manifest\.portalRole,role/);
assert.match(workflow,/manifest\.customerOrigin,'https:\/\/tamao\.com\.br'/);
assert.match(workflow,/manifest\.merchantOrigin,'https:\/\/parceiro\.tamao\.com\.br'/);
assert.match(workflow,/manifest\.adminOrigin,'https:\/\/admin\.tamao\.com\.br'/);
assert.match(workflow,/cloudflare\/wrangler-action@v4/);
assert.match(workflow,/wranglerVersion: '4\.136\.3'/);
assert.match(workflow,/pages deploy dist\/cloudflare-portal/);
assert.match(workflow,/--branch=main --commit-hash=\$\{\{ github\.sha \}\}/);
assert.match(workflow,/Confirm same SHA on all official portals/);
assert.match(workflow,/needs: \[credential-gate, publish\]/);
assert.match(workflow,/always\(\).*credential-gate\.outputs\.alreadyCurrent/);
assert.match(workflow,/needs\.publish\.result == 'success'/);
assert.match(workflow,/id: native-check/);
assert.match(workflow,/continue-on-error: true/);
assert.match(workflow,/NATIVE_PUBLISH_STATUS: \$\{\{ steps\.native-check\.outcome \}\}/);
assert.match(workflow,/NATIVE_PUBLISH_STATUS.*==.*success/);
assert.match(workflow,/alreadyCurrent=true/);
assert.match(workflow,/No Cloudflare token or duplicate upload required/);
assert.match(workflow,/alreadyCurrent=false/);
assert.match(workflow,/TAMAO_REQUIRE_LIVE_PORTALS: '1'/);
assert.match(workflow,/TAMAO_EXPECTED_SOURCE_SHA: \$\{\{ github\.sha \}\}/);
assert.match(workflow,/node tests\/remote-admin-readiness\.mjs/);
assert.ok(!workflow.includes('secrets.CLOUDFLARE_API_TOKEN ||'));
assert.ok(!workflow.includes('pull_request:'));
assert.ok(!workflow.includes('deprecation'));
assert.ok(!workflow.includes('github-pages'));
assert.ok(!workflow.includes('CF_ACCOUNT_ID="$'));
assert.match(docs,/Pages Write/);
assert.match(audit,/node tests\/cloudflare-production-deploy-v1-216\.mjs/);
console.log('V1.216 OK: three canonical projects, SHA proof, role isolation, restricted credentials, no PR deploy, strict official origins and fail-closed readiness.');
