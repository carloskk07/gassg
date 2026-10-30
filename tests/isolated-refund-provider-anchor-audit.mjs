import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

// Runs only on disposable full-schema Supabase after local checkout fixture.
// No hosted project credentials, PSP keys or production accounting writes.
assert.equal(process.env.CI,'true','disposable CI only');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');

const script=String.raw`
BEGIN;
DO $audit_fixture$
declare
  v_admin uuid;
  v_merchant uuid:='00000000-0000-4000-8000-000000000026';
  v_manual uuid;
  v_other uuid;
  v_refund uuid;
  v_key text:='CI-REFUND-ANCHOR-'||replace(gen_random_uuid()::text,'-','');
  v_refund_key text:='CI-REFUND-E2E-'||replace(gen_random_uuid()::text,'-','');
  v_event_key text:='CI-PAID-EVT-'||replace(gen_random_uuid()::text,'-','');
  v_count integer;
begin
  select user_id into v_admin from public.platform_admins
  where active=true and admin_role='superadmin' limit 1;
  if v_admin is null then raise exception 'MISSING_LOCAL_SUPERADMIN'; end if;
  if not exists(select 1 from public.merchants where id=v_merchant)
  then raise exception 'MISSING_LOCAL_MERCHANT'; end if;

  -- Fixture-only manual record. No real Pix, provider observation or credit.
  insert into public.merchant_billing_payment_requests(
    merchant_id,request_kind,plan_key,expected_amount_cents,
    platform_fee_bps_snapshot,credit_grant_cents_snapshot,
    merchant_reference,status,received_amount_cents,payment_method,
    reconciliation_key,approval_source,resolved_by,resolved_at,
    admin_reference
  ) values(
    v_merchant,'package_purchase','credit_300',30000,
    750,30000,'CI-FAKE-MANUAL-RECEIPT','approved',30000,'pix',
    v_key,'manual',v_admin,clock_timestamp(),'CI-LOCAL-NOT-BANK-PROOF'
  ) returning id into v_manual;

  insert into public.merchant_billing_payment_requests(
    merchant_id,request_kind,plan_key,expected_amount_cents,
    platform_fee_bps_snapshot,credit_grant_cents_snapshot,
    merchant_reference,status
  ) values(
    v_merchant,'package_purchase','credit_300',30000,750,30000,
    'CI-OTHER-PENDING-REQUEST','pending'
  ) returning id into v_other;

  -- A legitimate old/manual linkage is immutable, as designed.
  insert into public.merchant_billing_payment_refunds(
    provider,provider_event_id,original_reconciliation_key,
    refund_reconciliation_key,amount_cents,currency,occurred_at,
    raw_payload_sha256,status,payment_request_id,merchant_id,
    original_payment_amount_cents,cumulative_refunded_cents,match_reason
  ) values(
    'mercadopago',v_refund_key,v_key,
    'CI-REVERSAL-'||replace(gen_random_uuid()::text,'-',''),
    5000,'BRL',clock_timestamp(),repeat('a',64),
    'review_required',v_manual,v_merchant,30000,5000,
    'partial_refund_confirmed'
  ) returning id into v_refund;

  select count(*) into v_count
  from jsonb_array_elements(
    public.admin_merchant_billing_reconciliation(v_admin)->'issues'
  ) issue
  where issue->>'issueType'='refund_provider_anchor_request_conflict'
    and issue->>'entityId'=v_refund::text;
  if v_count<>0 then
    raise exception 'FALSE_PROVIDER_CONFLICT_WITHOUT_PROVIDER_EVENT: %',v_count;
  end if;

  -- Provider source and manual refund now name DIFFERENT payment requests.
  -- No automatic money movement or reassignment must occur.
  insert into public.merchant_billing_payment_events(
    provider,provider_event_id,reconciliation_key,payment_method,
    amount_cents,currency,occurred_at,raw_payload_sha256,
    status,payment_request_id,merchant_id,match_reason
  ) values(
    'mercadopago',v_event_key,v_key,'pix',30000,'BRL',
    clock_timestamp(),repeat('b',64),
    'matched_exact',v_other,v_merchant,'ci_provider_exact'
  );

  select count(*) into v_count
  from jsonb_array_elements(
    public.admin_merchant_billing_reconciliation(v_admin)->'issues'
  ) issue
  where issue->>'severity'='critical'
    and issue->>'issueType'='refund_provider_anchor_request_conflict'
    and issue->>'entityId'=v_refund::text
    and issue->>'merchantId'=v_merchant::text;
  if v_count<>1 then
    raise exception 'CONFLICT_MISSING_OR_DUPLICATED: %',v_count;
  end if;

  if not exists(
    select 1 from public.merchant_billing_payment_refunds
    where id=v_refund and payment_request_id=v_manual
      and payment_event_id is null and status='review_required'
  ) then raise exception 'IMMUTABLE_REFUND_FACT_CHANGED'; end if;
end;
$audit_fixture$;
-- Force every deferred financial provenance/ledger trigger before rollback.
SET CONSTRAINTS ALL IMMEDIATE;
SELECT 'ISOLATED_REFUND_ANCHOR_CONFLICT_PASS';
ROLLBACK;
`;

const output=execFileSync('psql',[
  '--host=127.0.0.1','--port=54322','--username=postgres',
  '--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1',
  '--tuples-only','--no-align','--quiet','--command='+script
],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},
  timeout:120000,stdio:['ignore','pipe','pipe']}).trim();
assert.match(output,/ISOLATED_REFUND_ANCHOR_CONFLICT_PASS/);
console.log('PASS: refund provisional anchor conflict visible in existing Admin Finance; historical facts retained; transaction rolled back.');
