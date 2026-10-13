import assert from 'node:assert/strict';
import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20261013230000_growth_referral_review_v1_230.sql',import.meta.url),'utf8');
for(const term of [
 'growth_referral_reviews_v1_230','admin_review_growth_referral_v1_230',
 'admin_growth_referral_review_queue_v1_230',
 "admin_role in ('superadmin','compliance')",
 "v_app.status<>'approved'","v_app.cnpj<>v_attr.cnpj",
 "mm.user_id=v_app.applicant_user_id","mm.member_role='owner' and mm.active",
 "decision <> 'verified_identity'","reward_eligible boolean not null default false check(reward_eligible=false)",
 "grant select on table public.growth_referral_reviews_v1_230 to service_role",
 "grant execute on function public.admin_review_growth_referral_v1_230",
 "'noPayout',true","'rewardEligible',false"
])assert.ok(sql.includes(term),'missing invariant: '+term);
assert.ok(!/grant\s+(insert|update|delete|all)\s+on\s+table\s+public\.growth_referral_reviews_v1_230\s+to\s+service_role/i.test(sql));
assert.ok(!/update\s+public\.growth_merchant_application_attributions_v1_229/i.test(sql));
assert.ok(!/insert\s+into\s+public\.(merchant_fee_credit_ledger|merchant_billing_accounts|platform_receivables)/i.test(sql));
console.log('V1.230 PASS — admin review design, evidence gates, append-only audit, no payouts');
