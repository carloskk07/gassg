import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261111020000_coupon_owner_sponsor_spendable_v1_942.sql');
const edge=read('supabase/functions/coupon-credit-pix/index.ts');
const admin=read('js/admin.js');

for(const clause of [
 'i.status=\'paid\'', "i.provider='mercadopago'",
 "i.funding_mode_v1_846='platform_reimbursed'",
 'i.sponsor_covered_cents::bigint=',
 "r.status<>'closed'",
 'clube_coupon_sponsor_covered_v1_807',
 'clube_coupon_owner_sponsor_spendable_v1_942(v_invoice.id)',
 'clube_coupon_paid_quote_reserve',
 'clube_coupon_paid_create_order',
 'clube_coupon_paid_order_reconciliation',
 'owner-sponsor:',
 'v_invoice.net_proceeds_verified_at is null',
 "'netProceedsReference',v_invoice.net_proceeds_reference",
])assert.ok(sql.includes(clause),'missing sponsor or financial guard: '+clause);
assert.match(sql,/revoke all on function public\.clube_coupon_owner_sponsor_spendable_v1_942\(uuid\)/i);
assert.match(sql,/grant execute on function public\.clube_coupon_owner_sponsor_spendable_v1_942\(uuid\) to service_role/i);
assert.doesNotMatch(sql,/update public\.clube_coupon_paid_invoices set\s+net_proceeds_cents/i,
 'sponsor path must never claim NET proof');
assert.doesNotMatch(sql,/insert into public\.platform_clube_sponsor_pool_v1_807/i,
 'no synthetic money may enter the sponsor pool');
assert.match(edge,/\.filter\(\(row:any\)=>couponInvoiceNetCovered\(row\)\)/);
assert.match(edge,/ownerSponsorVerified:await couponOwnerSponsorSpendable\(admin,row\)/);
assert.match(edge,/ownerSponsorVerified:await couponOwnerSponsorSpendable\(admin,invoice\)/);
assert.match(admin,/adminFinanceRealCouponWatch/);
const a=edge.indexOf('async function couponOwnerSponsorSpendable');
const b=edge.indexOf('function publicInvoice(',a);
assert.ok(a>0&&b>a,'owner funding logic needs to be directly exercised');
const source=edge.slice(a,b)
 .replace('admin:any,row:any','admin,row')
 .replace('row:any','row');
const ctx=vm.createContext({Number,String,Boolean,Date});
vm.runInContext(source+'\nthis.couponCovered=couponInvoiceNetCovered;'+
 '\nthis.ownerSpendable=couponOwnerSponsorSpendable;',ctx);
const row={
 id:'11111111-1111-4111-8111-111111111111',
 status:'paid',paid_at:'2026-11-10T20:00:00Z',
 provider_order_id:'ORDER',provider_payment_id:'PAYMENT',
 provider:'mercadopago',funding_mode_v1_846:'platform_reimbursed',
 coupon_face_cents:500,coupons_per_pack:3,sponsor_covered_cents:1500,
 sale_price_cents:890,net_proceeds_cents:null,
 net_proceeds_reference:null,net_proceeds_verified_at:null
};
let calls=0;
const backend={rpc:async(name,params)=>{
 calls++;assert.equal(name,'clube_coupon_owner_sponsor_spendable_v1_942');
 assert.equal(params.p_invoice,row.id);
 return {data:true,error:null};
}};
assert.equal(ctx.couponCovered(row),false,'unverified sponsor never substitutes NET proof');
assert.equal(await ctx.ownerSpendable(backend,row),true);
assert.equal(calls,1);
assert.equal(ctx.couponCovered({...row,ownerSponsorVerified:true}),true,
 'verified owner-sponsored voucher is spendable without a NET report');
for(const partial of [
 {status:'review_required'},{status:'refunded'},{provider_order_id:null},
 {provider_payment_id:null},{paid_at:null},
 {funding_mode_v1_846:'partner_funded'},
 {sponsor_covered_cents:1499},{sponsor_covered_cents:0}
])assert.equal(ctx.couponCovered({...row,ownerSponsorVerified:true,...partial}),false,
 'never release unverified or non-owner benefit: '+JSON.stringify(partial));
assert.equal(await ctx.ownerSpendable({rpc:async()=>({data:false,error:null})},row),false);
assert.equal(await ctx.ownerSpendable({rpc:async()=>({data:true,error:'unavailable'})},row),false);
const before=calls;
assert.equal(await ctx.ownerSpendable(backend,{...row,status:'refunded'}),false);
assert.equal(await ctx.ownerSpendable(backend,{...row,funding_mode_v1_846:'partner_funded'}),false);
assert.equal(calls,before,'unauthorized funding modes must not reach RPC');
const net={...row,ownerSponsorVerified:false,net_proceeds_cents:1500,
 sale_price_cents:1600,net_proceeds_reference:'mp-release:report:pay',
 net_proceeds_verified_at:'2026-11-10T21:00:00Z'};
assert.equal(ctx.couponCovered(net),true,'old NET-funded path remains valid');
assert.equal(ctx.couponCovered({...net,net_proceeds_reference:null}),false,
 'old unsponsored path still needs authenticated NET evidence');
console.log('V1.942 PASS: owner escrow and paid Pix release independently of MP NET report; all other modes fail closed.');
