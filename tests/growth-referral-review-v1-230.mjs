import assert from 'node:assert/strict';
import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20261013230000_growth_referral_review_v1_230.sql',import.meta.url),'utf8');
for(const term of [
 'growth_referral_reviews_v1_230','admin_review_growth_referral_v1_230',
 'admin_growth_referral_review_queue_v1_230',
 "admin_role in ('superadmin','compliance')",
 "v_app.status='approved'","v_app.cnpj<>v_attr.cnpj",
 "mm.user_id=v_app.applicant_user_id","mm.member_role='owner' and mm.active",
 "decision <> 'verified_identity'","reward_eligible boolean not null default false check(reward_eligible=false)",
 "grant select on table public.growth_referral_reviews_v1_230 to service_role",
 "grant execute on function public.admin_review_growth_referral_v1_230",
 "'noPayout',true","'rewardEligible',false"
])assert.ok(sql.includes(term),'missing invariant: '+term);
assert.ok(!/grant\s+(insert|update|delete|all)\s+on\s+table\s+public\.growth_referral_reviews_v1_230\s+to\s+service_role/i.test(sql));
assert.ok(!/update\s+public\.growth_merchant_application_attributions_v1_229/i.test(sql));
assert.ok(!/insert\s+into\s+public\.(merchant_fee_credit_ledger|merchant_billing_accounts|platform_receivables)/i.test(sql));
const edge=fs.readFileSync(new URL('../supabase/functions/admin-ops/index.ts',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../js/admin-acquisition.js',import.meta.url),'utf8');
const vm=await import('node:vm');
new vm.Script(ui,{filename:'admin-acquisition.js'});
for(const x of ['action==="growth-referral-review-queue"','action==="growth-referral-review"','admin_review_growth_referral_v1_230','admin_growth_referral_review_queue_v1_230','p_actor_user_id:user.id','p_request_id:uuid(body.reviewRequestId'])assert.ok(edge.includes(x),'missing auth integration '+x);
for(const x of ['adminGrowthReferralReviewSection()','adminLoadGrowthReferralReviewQueue','adminReviewGrowthReferral','growth-referral-review-queue'])assert.ok(ui.includes(x),'missing UI '+x);
for(const term of [
 'growth_internal_v1_230.admin_review_growth_referral_v1_230',
 'security definer',
 'security invoker',
 'pg_advisory_xact_lock',
 "request_id uuid not null unique",
 "where decision in ('verified_identity','rejected')",
 "REFERRAL_REVIEW_ALREADY_FINAL",
 "REFERRAL_REVIEW_REQUEST_ID_REUSED",
 "i.invite_code=v_attr.referral_code",
 "upper(p.referral_code)=v_attr.referral_code",
 "mm.user_id=v_app.applicant_user_id and mm.active",
 "v_cnpj_ok and v_owner_ok and v_inviter_ok",
 "REFERRAL_REVIEW_EFFECTIVE_ACL_DRIFT",
 "has_function_privilege('anon'",
]) assert.ok(sql.includes(term),'missing server-side safety: '+term);
assert.ok(!edge.includes('p_cnpj_match:body.cnpjMatch'));
assert.ok(!edge.includes('p_inviter_valid:body.inviterValid'));
assert.ok(!edge.includes('p_owner_match:body.ownerMatch'));
assert.ok(ui.includes('reviewRequestId:crypto.randomUUID()'));
assert.ok(!ui.includes('cnpjMatch=ownerMatch=inviterValid=true'));
assert.ok(ui.includes("!['verified_identity','rejected'].includes(x.latestDecision)"));

console.log('V1.230 PASS — admin review design, evidence gates, append-only audit, no payouts');
