import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261104170000_clube_owner_personal_guarantee_v1_808.sql');
const edge=read('supabase/functions/coupon-credit-pix/index.ts');
const admin=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-acquisition.js');

assert.match(migration,/ADD COLUMN owner_guaranteed_cents integer NOT NULL DEFAULT 0/);
assert.match(migration,/reconciled_cents\+owner_guaranteed_cents<=authorized_cents/);
assert.match(migration,/encumbered_cents<=reconciled_cents\+owner_guaranteed_cents/);
assert.match(migration,/owner_guaranteed_cents=10000/);
assert.match(migration,/owner_direct_instruction_2026-11-04_issue_493/);
assert.match(migration,/reconciled_cents=0 AND encumbered_cents=0/);
assert.match(migration,/pool\.reconciled_cents\+pool\.owner_guaranteed_cents/);
assert.match(migration,/p\.reconciled_cents\+p\.owner_guaranteed_cents/);
assert.match(migration,/COUPON_SPONSOR_BANK_RECONCILIATION_REVOKED/);
assert.match(migration,/REVOKE ALL ON FUNCTION public\.clube_coupon_sponsor_invoice_before_v1_807/);
const initialState=migration.slice(0,migration.indexOf('-- Preserve existing bank-revocation checks'));
assert.doesNotMatch(initialState,/SET reconciled_cents=10000|INSERT INTO public\.platform_clube_sponsor_receipts|INSERT INTO public\.clube_coupon_paid_issuances|INSERT INTO public\.clube_coupon_paid_invoices|UPDATE public\.platform_launch_control/,
 'owner guarantee must not reconcile bank money, issue a voucher or activate commerce');
assert.match(edge,/\.select\("reconciled_cents,owner_guaranteed_cents,encumbered_cents"\)/);
assert.match(edge,/Number\(pool\?\.owner_guaranteed_cents\?\?0\)/);
assert.match(edge,/CLUBE_COUPON_PAID_SALES_ENABLED/);
assert.match(edge,/platformCommerceAllowed\(admin\)/);
assert.match(admin,/ownerGuaranteedCents:data\.owner_guaranteed_cents/);
assert.match(admin,/remainingCents:data\.reconciled_cents\+data\.owner_guaranteed_cents-data\.encumbered_cents/);
assert.match(admin,/data\.reconciled_cents\+data\.owner_guaranteed_cents>data\.authorized_cents/);
assert.match(ui,/Garantido pelo proprietário/);
assert.match(ui,/não depósito bancário e não receita contabilizada/);
assert.match(ui,/A venda pública ainda exige revenda apta/);
assert.match(migration,/AND reconciled_cents=0 AND encumbered_cents=0/);
console.log('PASS V1.808 — personal guarantee independent of bank, R$100 initial guarantee and audited optional budget topups, sales still closed.');
