import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261104170400_clube_coupon_refund_request_v1_814.sql');
const edge=read('supabase/functions/coupon-credit-pix/index.ts');
const shop=read('js/clube-coupon-shop.js'),growth=read('js/growth.js');
new vm.Script(shop);new vm.Script(growth);
for(const term of [
 'CREATE TABLE public.clube_coupon_refund_requests_v1_814',
 'ENABLE ROW LEVEL SECURITY','REVOKE ALL',
 'CREATE FUNCTION public.clube_coupon_refund_request_v1_814(',
 'WHERE id=p_invoice FOR UPDATE','inv.customer_user_id IS DISTINCT FROM p_customer',
 'CREATE TRIGGER clube_coupon_refund_block_reservation_v1_814',
 'CREATE TRIGGER clube_coupon_refund_block_order_v1_814',
 'COUPON_REFUND_PENDING',
 "GRANT EXECUTE ON FUNCTION public.clube_coupon_refund_request_v1_814"
]) assert.ok(migration.includes(term),'missing SQL invariant: '+term);
assert.match(migration,/status IN \('requested','in_review','refunded','closed'\)/);
assert.doesNotMatch(migration,/UPDATE public\.clube_coupon_paid_packages|UPDATE public\.platform_launch_control|mercadoPagoFetch/i);
assert.match(edge,/if\(operation==="request-refund"\)/);
assert.match(edge,/actionName:"coupon-refund-request"/);
assert.match(edge,/p_customer:user\.id,p_invoice:invoiceId/);
assert.match(edge,/refundStatus:refundByInvoice/);
assert.ok(edge.indexOf('if(operation==="request-refund")')<
 edge.indexOf('if(operation!=="purchase")'), 'refund works when sales disabled');
assert.match(shop,/clubeCouponRefundAsk/);
assert.match(growth,/clubeCouponPurchasesPanel/);
assert.match(shop,/Solicitar cancelamento \/ reembolso/);
console.log('V1.814 PASS — authenticated refund request, owned invoice, immutable protocols and transactional coupon freeze.');
