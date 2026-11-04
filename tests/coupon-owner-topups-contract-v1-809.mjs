import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const schema=read('supabase/migrations/20261104170100_clube_owner_coupon_budget_topups_v1_809.sql');
const funding=read('supabase/migrations/20261104170000_clube_owner_personal_guarantee_v1_808.sql');
const api=read('supabase/functions/admin-ops/index.ts');
const customer=read('supabase/functions/coupon-credit-pix/index.ts');
const ui=read('js/admin-acquisition.js');
for(const term of [
 'clube_sponsor_authorized_cap_v1_809',
 'authorized_cents BETWEEN 10000 AND 10000000',
 'owner_guaranteed_cents BETWEEN 0 AND 10000000',
 'CREATE TABLE public.platform_clube_sponsor_topups_v1_809',
 'request_id uuid PRIMARY KEY',
 'REFERENCES auth.users(id)',
 'ENABLE ROW LEVEL SECURITY',
 'REVOKE ALL ON public.platform_clube_sponsor_topups_v1_809',
 'CREATE FUNCTION public.admin_clube_sponsor_topup_v1_809',
 "a.admin_role='superadmin'",
 'p_amount_cents NOT BETWEEN 100 AND 1000000',
 'FOR UPDATE','COUPON_OWNER_TOPUP_REPLAY_CONFLICT',
 'COUPON_OWNER_TOPUP_STALE_VERSION',
 'COUPON_OWNER_TOPUP_TOTAL_CAP',
 'COUPON_OWNER_TOPUP_POOL_DRIFT',
 'authorized_cents=authorized_cents+p_amount_cents',
 'owner_guaranteed_cents=owner_guaranteed_cents+p_amount_cents',
 'platform_admin_audit',
 "'vouchersIssued',0"
])assert.ok(schema.includes(term),'missing atomic owner topup protection '+term);
assert.doesNotMatch(schema,/INSERT INTO public\.clube_coupon_paid_issuances|INSERT INTO public\.clube_coupon_paid_invoices|UPDATE public\.platform_launch_control/,
 'budget topups must NEVER create vouchers, invoices or silently open commerce');
assert.match(schema,/REVOKE ALL ON FUNCTION public\.admin_clube_sponsor_topup_v1_809/);
assert.match(schema,/GRANT EXECUTE ON FUNCTION public\.admin_clube_sponsor_topup_v1_809/);
assert.match(funding,/owner_guaranteed_cents=10000/);
assert.match(api,/if\(action==="clube-sponsor-topup"\)/);
assert.match(api,/adminAccess\.admin_role\)!=="superadmin"/);
assert.match(api,/admin_clube_sponsor_topup_v1_809/);
assert.match(api,/amountCents:cents|p_amount_cents:cents/);
assert.match(api,/Number\.isSafeInteger\(cents\)/);
assert.match(api,/data\.vouchersIssued!==0/);
assert.match(api,/data\.bankDeposit!==false/);
assert.match(api,/potentialGasPacks:Math\.floor/);
assert.match(api,/potentialWaterPacks:Math\.floor/);
assert.match(customer,/CLUBE_COUPON_PAID_SALES_ENABLED/);
assert.match(customer,/platformCommerceAllowed\(admin\)/);
assert.match(ui,/adminClubeSponsorTopupFromUi/);
assert.match(ui,/Confirmar reforço de cupons/);
assert.match(ui,/Não somar os dois totais/);
assert.match(ui,/O reforço não vende nem emite vouchers sozinho/);
assert.match(ui,/crypto\.randomUUID\(\)/);
assert.match(ui,/adminClubeTopupAttempt\.requestId/);
const a=ui.indexOf('function adminClubeParseTopupCents(raw){');
const b=ui.indexOf('async function adminClubeSponsorTopupFromUi(){',a);
assert.ok(a>=0&&b>a);
const sandbox=vm.createContext({Number,String});
new vm.Script(ui.slice(a,b)).runInContext(sandbox);
for(const [input,amount] of [['100',10000],['100,00',10000],['12.45',1245],['1,5',150],['10000',1000000],['1',100]]) {
 assert.equal(sandbox.adminClubeParseTopupCents(input),amount,'parsed '+input);
}
for(const bad of ['0','0,99','0.01','-5','1e3','10000,01','100000','20,999','1,234','100abc','','1.234,56']){
 assert.equal(sandbox.adminClubeParseTopupCents(bad),null,'blocked invalid '+bad);
}
console.log('V1.809 PASS — superadmin-owned, finite atomic topup and accurate BRL entry; no fake voucher.');
