import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

// REAL SQL on the disposable CI PostgreSQL fixture, with a complete ROLLBACK.
// No Mercado Pago, production project or user balance is ever touched here.
assert.equal(process.env.CI,'true');
for(const name of ['SUPABASE_ACCESS_TOKEN','SUPABASE_DB_PASSWORD',
 'SUPABASE_SERVICE_ROLE_KEY','ADS_MP_ACCESS_TOKEN','MERCADOPAGO_ACCESS_TOKEN'])
 assert.equal(process.env[name]||'','');
const psql=sql=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
 '--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet',
 '--command='+sql
],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},timeout:120000}).trim();
assert.equal(psql('select current_database()'),'postgres');
const before=psql('SELECT count(*) FROM public.ads_credit_ledger_v1_1097');
const test=String.raw`
BEGIN;
DO $wallet$
DECLARE
 owner_id uuid;
 request_id uuid:=gen_random_uuid();
 topup_id uuid;
 reference text;
 event_result jsonb;
 replay jsonb;
 verified_id uuid;
 balance bigint;
 rejected boolean;
BEGIN
 SELECT user_id INTO owner_id FROM public.platform_admins
  WHERE active AND admin_role='superadmin' LIMIT 1;
 IF owner_id IS NULL THEN RAISE EXCEPTION 'V1097_OWNER_FIXTURE_MISSING';END IF;
 UPDATE auth.users SET email_confirmed_at=clock_timestamp(),is_anonymous=false WHERE id=owner_id;
 IF (SELECT recharge_enabled OR view_debit_enabled OR evidence_audited
  FROM public.ads_credit_controls_v1_1097 WHERE singleton)
 THEN RAISE EXCEPTION 'V1097_DEFAULT_GATES_NOT_SAFE';END IF;
 IF has_function_privilege('anon','public.ads_credit_balance_v1_1097(uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.ads_credit_topup_reserve_v1_1097(uuid,uuid,integer)','EXECUTE')
 THEN RAISE EXCEPTION 'V1097_UNAUTHORIZED_RPC_ACCESS';END IF;
 event_result:=public.ads_credit_balance_v1_1097(owner_id);
 IF event_result->>'balanceCents'<>'0' THEN RAISE EXCEPTION 'V1097_NONZERO_START';END IF;
 rejected:=false;
 BEGIN
  PERFORM public.ads_credit_topup_reserve_v1_1097(owner_id,request_id,1990);
 EXCEPTION WHEN SQLSTATE '42501' THEN rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'V1097_DISABLED_TOPUP_ALLOWED';END IF;
 rejected:=false;
 BEGIN
  PERFORM public.ads_credit_debit_verified_v1_1097(gen_random_uuid());
 EXCEPTION WHEN SQLSTATE '42501' THEN rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'V1097_UNPROVEN_VIEW_ALLOWED';END IF;

 -- Allow money flow ONLY inside this ROLLBACK fixture.
 UPDATE public.ads_credit_controls_v1_1097
  SET recharge_enabled=true,evidence_audited=true,view_debit_enabled=true WHERE singleton;
 event_result:=public.ads_credit_topup_reserve_v1_1097(owner_id,request_id,1990);
 topup_id:=(event_result->>'topupId')::uuid;
 reference:=event_result->>'externalReference';
 replay:=public.ads_credit_topup_reserve_v1_1097(owner_id,request_id,1990);
 IF replay->>'topupId'<>topup_id::text THEN RAISE EXCEPTION 'V1097_RESERVE_NOT_IDEMPOTENT';END IF;
 rejected:=false;
 BEGIN
  PERFORM public.ads_credit_topup_reserve_v1_1097(owner_id,request_id,4990);
 EXCEPTION WHEN SQLSTATE '40001' THEN rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'V1097_REQUEST_CONFLICT';END IF;
 event_result:=public.ads_credit_topup_claim_v1_1097(owner_id,topup_id);
 IF event_result->>'canCreate'<>'true' THEN RAISE EXCEPTION 'V1097_CLAIM_FAIL';END IF;
 replay:=public.ads_credit_topup_claim_v1_1097(owner_id,topup_id);
 IF replay->>'canCreate'<>'false' THEN RAISE EXCEPTION 'V1097_DUPLICATE_CREATE';END IF;
 event_result:=public.ads_credit_topup_attach_v1_1097(owner_id,topup_id,
  '123456789012','1234567',repeat('A',150),clock_timestamp()+interval '1 day');
 IF event_result->>'status'<>'pix_pending' THEN RAISE EXCEPTION 'V1097_PIX_ATTACH_FAIL';END IF;
 event_result:=public.ads_credit_payment_fact_v1_1097(
  repeat('a',64),reference,'123456789012','1234567',1990,
  'approved','accredited',true);
 IF event_result->>'balanceCents'<>'1990' THEN RAISE EXCEPTION 'V1097_CREDIT_NOT_APPLIED';END IF;
 replay:=public.ads_credit_payment_fact_v1_1097(
  repeat('a',64),reference,'123456789012','1234567',1990,
  'approved','accredited',true);
 IF replay->>'replayed'<>'true' THEN RAISE EXCEPTION 'V1097_PAYMENT_REPLAY';END IF;
 SELECT balance_cents INTO balance FROM public.ads_credit_wallets_v1_1097 WHERE owner_user_id=owner_id;
 IF balance<>1990 THEN RAISE EXCEPTION 'V1097_DUPLICATE_CREDIT';END IF;
 INSERT INTO public.ads_credit_verified_views_v1_1097(
  owner_user_id,campaign_id,issued_token,viewer_hash,eligible,reviewed_by,reviewed_at)
 VALUES(owner_id,gen_random_uuid(),gen_random_uuid(),repeat('a',64),true,owner_id,clock_timestamp())
 RETURNING id INTO verified_id;
 event_result:=public.ads_credit_debit_verified_v1_1097(verified_id);
 IF event_result->>'balanceCents'<>'1988' OR event_result->>'chargedCents'<>'2'
 THEN RAISE EXCEPTION 'V1097_DEBIT_WRONG';END IF;
 replay:=public.ads_credit_debit_verified_v1_1097(verified_id);
 IF replay->>'replayed'<>'true' THEN RAISE EXCEPTION 'V1097_VIEW_REPLAY';END IF;
 SELECT balance_cents INTO balance FROM public.ads_credit_wallets_v1_1097 WHERE owner_user_id=owner_id;
 IF balance<>1988 THEN RAISE EXCEPTION 'V1097_DUPLICATE_DEBIT';END IF;
 event_result:=public.ads_credit_payment_fact_v1_1097(
  repeat('b',64),reference,'123456789012','1234567',1990,
  'refunded','refunded',true);
 SELECT balance_cents INTO balance FROM public.ads_credit_wallets_v1_1097 WHERE owner_user_id=owner_id;
 IF balance<>0 OR NOT (SELECT frozen FROM public.ads_credit_wallets_v1_1097 WHERE owner_user_id=owner_id)
 THEN RAISE EXCEPTION 'V1097_REFUND_NOT_FROZEN';END IF;
 rejected:=false;
 BEGIN
  PERFORM public.ads_credit_topup_reserve_v1_1097(owner_id,gen_random_uuid(),4990);
 EXCEPTION WHEN SQLSTATE '42501' THEN rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'V1097_FROZEN_ACCEPTED_TOPUP';END IF;
 IF (SELECT count(*) FROM public.ads_credit_ledger_v1_1097
  WHERE owner_user_id=owner_id)<>3 THEN
  RAISE EXCEPTION 'V1097_LEDGER_NOT_EXACTLY_THREE';END IF;
 RAISE NOTICE 'PASS V1.1097 approved, one-view debit, refund freeze, no duplicate, protected ACL';
END;$wallet$;
ROLLBACK;
`;
const output=psql(test);
assert.equal(psql('SELECT count(*) FROM public.ads_credit_ledger_v1_1097'),before);
console.log('PASS V1.1097 disposable SQL ledger: zero starts, disabled gates, Pix idempotency, approved balance, debit once, freeze on provider reversal, ROLLBACK.');
