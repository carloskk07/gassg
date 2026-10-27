import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow=fs.readFileSync(new URL('../.github/workflows/isolated-supabase-integration.yml',import.meta.url),'utf8');
const audit=fs.readFileSync(new URL('../.github/workflows/audit.yml',import.meta.url),'utf8');
const old='version: 2.84.2';
const current='version: 2.122.0';
const boot=workflow.split('      - name: Boot ephemeral Postgres using canonical baseline followed by migrations')[1]?.split('      - name: Verify real schema')[0];
assert.ok(boot&&boot.length>2000,'integration must retain canonical baseline and migration normalization');
assert.ok(!workflow.includes(old),'deprecated local CLI pinned to a single throttled GHCR registry');
assert.ok(workflow.includes(current),'validated specific CLI release supports multi-registry image fallback');
assert.ok(boot.includes('env -u SUPABASE_INTERNAL_IMAGE_REGISTRY'),'must remove setup-cli GHCR-only registry override on start');
assert.ok(boot.includes('supabase start -x realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,logflare,vector,supavisor'));
assert.ok(boot.includes('cp supabase/schema.sql "$ephemeral"'),'must still boot disposable canonical schema');
assert.ok(workflow.includes("SUPABASE_ACCESS_TOKEN: ''")&&workflow.includes("SUPABASE_DB_PASSWORD: ''"),'never use production credentials');
assert.ok(workflow.includes('node tests/isolated-supabase-coupon-full-schema.mjs'),'must actually exercise coupon invoice/net/v8/order settlement in disposable DB');
assert.ok(workflow.includes('supabase stop --no-backup || true'),'dispose of local containers even after a failed test');
assert.ok(audit.includes('node tests/isolated-supabase-registry-fallback-contract.mjs'),'CI must detect future regression back to single registry');
console.log('PASS: isolated coupon full-schema E2E uses pinned multi-registry CLI, disposable DB and no hosted credentials.');
