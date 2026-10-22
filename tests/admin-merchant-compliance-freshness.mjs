import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261022155032_admin_merchant_compliance_current.sql');
const admin=read('js/admin.js'),edge=read('supabase/functions/admin-ops/index.ts');
assert.match(migration,/CREATE OR REPLACE FUNCTION public\.admin_merchant_readiness_snapshot\(/);
assert.match(migration,/perform public\.require_platform_admin\(p_actor_user_id\)/);
assert.match(migration,/STABLE SECURITY DEFINER\s+SET search_path TO 'pg_catalog'/);
assert.match(migration,/public\.merchant_cnpj_compliance_current\(m.id\) as cnpj_verification_current/);
assert.match(migration,/public\.merchant_anp_compliance_current\(m.id\) as anp_verification_current/);
assert.match(migration,/'cnpjVerificationCurrent',n\.cnpj_verification_current/);
assert.match(migration,/'anpVerificationCurrent',n\.anp_verification_current/);
for(const part of ["'complianceReady',n.compliance_ready","'paymentReady',n.payment_ready",
 "'offerReady',n.offer_ready","'nextAction',case"]) {
 assert.ok(migration.includes(part),'Preserve existing admin JSON response field: '+part);
}
assert.match(migration,/revoke all on function public\.admin_merchant_readiness_snapshot\(uuid\) from public,anon,authenticated/);
assert.match(migration,/grant execute on function public\.admin_merchant_readiness_snapshot\(uuid\) to service_role/);
assert.match(edge,/readiness:merchantReadinessById\.get\(m.id\)\?\?null/,
 'Admin edge must forward current RPC result by merchant id');
assert.match(admin,/m\.readiness\?\.cnpjVerificationCurrent/);
assert.match(admin,/m\.readiness\?\.anpVerificationCurrent/);
assert.doesNotMatch(admin,/cnpj_max_age_days\s*=/);
assert.doesNotMatch(admin,/anp_max_age_days\s*=/);
assert.match(read('.github/workflows/audit.yml'),/node tests\/admin-merchant-compliance-freshness\.mjs/);
console.log('PASS — canonical server CNPJ/ANP validity, unchanged ACL and RPC interface.');
