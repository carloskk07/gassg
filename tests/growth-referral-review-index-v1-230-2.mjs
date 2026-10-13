import assert from 'node:assert/strict';
import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20261013233000_growth_referral_review_reviewer_index_v1_230_2.sql',import.meta.url),'utf8');
const workflow=fs.readFileSync(new URL('../.github/workflows/audit.yml',import.meta.url),'utf8');
assert.match(sql,/create index if not exists growth_referral_reviews_reviewer_v1_230_2\s+on public\.growth_referral_reviews_v1_230\(reviewer_user_id\)/i);
assert.doesNotMatch(sql,/\b(drop|delete|update|truncate)\b/i);
assert.match(workflow,/\- name: Referral review V1\.230 security and idempotency contract\s+run: node tests\/growth-referral-review-v1-230\.mjs/);
assert.match(workflow,/\- name: Referral reviewer FK index V1\.230\.2 contract\s+run: node tests\/growth-referral-review-index-v1-230-2\.mjs/);
console.log('V1.230.2 PASS — independent CI security step and covering reviewer FK index');
