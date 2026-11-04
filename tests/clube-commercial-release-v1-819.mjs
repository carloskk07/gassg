import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261104190000_clube_commercial_release_v1_819.sql');
const edge=read('supabase/functions/coupon-credit-pix/index.ts');
const admin=read('supabase/functions/admin-ops/index.ts');
const page=read('js/admin.js');
const panel=read('js/admin-clube-commercial.js');
const shop=read('js/clube-coupon-shop.js');
new vm.Script(page);new vm.Script(panel);new vm.Script(shop);
for(const term of [
 'CREATE TABLE public.clube_coupon_commercial_release_v1_819',
 'ENABLE ROW LEVEL SECURITY',
 'owner_accepts_refund boolean NOT NULL CHECK(owner_accepts_refund)',
 'owner_accepts_merchant_reimbursement boolean NOT NULL CHECK(owner_accepts_merchant_reimbursement)',
 'owner_accepts_no_merchant_yet boolean NOT NULL CHECK(owner_accepts_no_merchant_yet)',
 'seller_tax_document','seller_address','seller_support_email',
 'CREATE FUNCTION public.admin_clube_coupon_commercial_release_v1_819(',
 'admin_role=\'superadmin\'',
 'owner_guaranteed_cents<10000','p_accept_no_merchant_yet IS DISTINCT FROM TRUE',
 'CREATE FUNCTION public.admin_clube_coupon_commercial_suspend_v1_819(',
 'GRANT EXECUTE ON FUNCTION public.admin_clube_coupon_commercial_release_v1_819',
 'COUPON_SELLER_SNAPSHOT_IMMUTABLE'
])assert.ok(migration.includes(term),'Missing commercial release SQL condition '+term);
assert.match(edge,/async function couponSaleRelease\(admin:any\)/);
assert.match(edge,/couponSaleRelease\(admin\)/);
assert.match(edge,/release\.seller_tax_document/);
assert.match(edge,/seller_name:release\.seller_name/);
assert.match(edge,/packageKey!==release\.package_key/);
assert.match(edge,/seller:safe\.length/);
assert.match(admin,/couponSellerTaxDocumentValid/);
assert.match(admin,/action==="clube-coupon-commercial-status"/);
assert.match(admin,/mercadoPagoFetch\("\/users\/me"/);
assert.match(admin,/ownerProfile\?\.test_user===true/);
assert.match(admin,/admin_clube_coupon_commercial_release_v1_819/);
assert.match(admin,/admin_clube_coupon_commercial_suspend_v1_819/);
assert.match(panel,/adminClubeCommercialActivate/);
assert.match(panel,/adminClubeCommercialSuspend/);
assert.match(panel,/acceptNoMerchantYet:true/);
assert.match(shop,/COUPON_SELLER_NOT_DISCLOSED/);
assert.match(shop,/Quem vende os cupons/);
assert.doesNotMatch(migration,/UPDATE public\.platform_clube_sponsor_pool_v1_807 SET reconciled_cents/);
assert.doesNotMatch(admin,/action==="clube-coupon-commercial-release"[\s\S]*?net_proceeds_verified_at:clock_timestamp\(\)/);
console.log('V1.819 PASS — seller authorization is signed and scoped, no merchant needed, no fabricated financial evidence.');
