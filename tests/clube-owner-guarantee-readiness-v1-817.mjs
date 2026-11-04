import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../supabase/migrations/20261104173100_clube_owner_coupon_funding_readiness_v1_817.sql',import.meta.url),'utf8');
for(const x of ['owner_guaranteed_cents<>10000','reconciled_cents<>0',
 'owner_guaranteed_at IS NULL','owner_guarantee_source IS NULL',
 "package_key='all_products_3x5_sponsor'",
 'p.sale_price_cents<>890','p.coupon_face_cents<>500',
 'p.coupons_per_pack<>3','p.min_order_cents<>5000',
 'p.sale_enabled OR p.funding_verified OR p.legal_terms_verified',
 'p.redeem_settlement_verified',
 'EXISTS(SELECT 1 FROM public.clube_coupon_paid_invoices',
 'SET funding_verified=true'])
 assert.ok(source.includes(x),'missing guarded owner guarantee evidence: '+x);
assert.doesNotMatch(source,/\b(?:UPDATE|INSERT INTO)\s+public\.(?:clube_coupon_paid_invoices|clube_coupon_paid_issuances|platform_clube_sponsor_pool_v1_807|platform_launch_control)\b/i);
assert.doesNotMatch(source,/\bsale_enabled\s*=\s*true|legal_terms_verified\s*=\s*true|redeem_settlement_verified\s*=\s*true/i);
console.log('V1.817 PASS — R$100 verified OWNER guarantee, no bank receipt invented, no commercial sale toggled.');
