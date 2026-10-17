import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
// Historical migrations that Supabase has already recorded must be immutable.
// Apply any future repairs in *new* migrations, never by silently changing these.
const canonical=[
  {pr:205,original:'20261011043000',applied:'20261012042111',
    file:'20261012042111_delivery_first_payment_boundary_v1_158_1.sql',
    gitBlob:'b619fbbed979bd83e45e64c1b1256b10d0b54eb5'},
  {pr:207,original:'20261011063000',applied:'20261012042134',
    file:'20261012042134_merchant_basket_compliance_v1_158_2.sql',
    gitBlob:'3830d831fdfcb36cf45a8dbfa85fd9d75c90bcfd'},
  {pr:208,original:'20261011073000',applied:'20261012042157',
    file:'20261012042157_settlement_daily_due_alignment_v1_158_3.sql',
    gitBlob:'24edaf9e8a761ae49bcc5769e5062bf9d545a2e4'},
  {pr:209,original:'20261011083000',applied:'20261012042201',
    file:'20261012042201_merchant_representation_authority_v1_158_4.sql',
    gitBlob:'707aef25826b97869b6b06ecab3db420a9696bef'}
];
const diag=read('scripts/audit-legacy-sql-provenance-v1-399.sql');
const dossier=read('docs/legacy-sql-provenance-2026-10-17.md');
const workflow=read('.github/workflows/audit.yml');
for(const item of canonical){
  const content=read('supabase/migrations/'+item.file);
  const blob=createHash('sha1').update('blob '+Buffer.byteLength(content)+'\0').update(content).digest('hex');
  assert.equal(blob,item.gitBlob,
    'Previously applied migration was rewritten: '+item.file+'; create a NEW migration instead');
  assert.ok(diag.includes(item.original)&&diag.includes(item.applied),
    'SQL diagnostic must compare original and applied version for PR #'+item.pr);
  assert.ok(dossier.includes(item.file),
    'Historical discrepancy must be documented: '+item.file);
}
assert.ok(diag.includes('canonical_migration_registered'),
  'Read-only diagnostic must verify the canonical migration is actually registered');
assert.ok(workflow.includes('node tests/legacy-canonical-sql-v1-400.mjs'));
for(const id of ['delivery-first-payment-v1-158-1','merchant-basket-compliance-v1-158-2',
  'settlement-daily-integrity-v1-158-3','merchant-representation-v1-158-4']){
  assert.ok(workflow.includes('node tests/'+id+'.mjs'),'Missing live source regression '+id);
}
// Old rescue PR #82: retain the original fail-closed PILOT guard while preserving
// newer regulatory basket checks. These are source contracts, not live SQL E2E.
const pilot=read('supabase/migrations/20261005071000_pilot_operation_boundary_v1_70_5.sql');
const basket=read('supabase/migrations/20261012042134_merchant_basket_compliance_v1_158_2.sql');
for(const fragment of ['create or replace function public.merchant_allowed_in_operation_mode',
  "operation_mode='PILOT'","onboarding_status='converted'"])
  assert.ok(pilot.toLowerCase().includes(fragment.toLowerCase()),'Pilot authority missing: '+fragment);
for(const fragment of ['create or replace function public.system_rescue_order',
  'merchant_allowed_in_operation_mode(m.id)',
  'merchant_allowed_in_operation_mode(v_candidate_id)',
  'pg_advisory_xact_lock',
  'for update skip locked',
  'v_locked_items<>v_expected_items',
  'merchant_basket_compliance_current'])
  assert.ok(basket.toLowerCase().includes(fragment.toLowerCase()),'Rescue authority missing: '+fragment);
console.log('V1.400: four immutable applied migrations mapped; pilot rescue source authority retained.');
