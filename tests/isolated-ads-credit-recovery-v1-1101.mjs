import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

assert.equal(process.env.CI,'true');
for(const name of ['SUPABASE_ACCESS_TOKEN','SUPABASE_DB_PASSWORD','SUPABASE_SERVICE_ROLE_KEY',
 'ADS_MP_ACCESS_TOKEN','MERCADOPAGO_ACCESS_TOKEN'])assert.equal(process.env[name]||'','');
const psql=sql=>execFileSync('psql',['-h','127.0.0.1','-p','54322','-U','postgres','-d','postgres',
 '-X','-qAt','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},timeout:120000}).trim();
const baseline=psql('SELECT count(*) FROM public.ads_credit_topups_v1_1097');
psql(`
BEGIN;
SET LOCAL plpgsql.check_asserts=on;
SAVEPOINT private_pilot;
DO $pilot$
DECLARE own uuid; first jsonb; duplicate jsonb; result jsonb; id uuid; blocked boolean:=false;
BEGIN
 SELECT user_id INTO STRICT own FROM public.platform_admins WHERE active AND admin_role='superadmin' LIMIT 1;
 UPDATE auth.users SET is_anonymous=false,email_confirmed_at=now() WHERE id=own;
 first:=public.admin_ads_credit_pilot_v1_1101(own,'read');
 ASSERT first->>'status'='idle' AND first->>'canStart'='true','Closed commercial gate must allow reading pilot readiness';
 ASSERT NOT EXISTS(SELECT 1 FROM public.ads_credit_topups_v1_1097) AND NOT EXISTS(
  SELECT 1 FROM public.ads_credit_wallets_v1_1097),'Opening Admin initiated money';
 BEGIN PERFORM public.admin_ads_credit_pilot_v1_1101(gen_random_uuid(),'prepare');
 EXCEPTION WHEN SQLSTATE '42501' THEN blocked:=true;END;
 ASSERT blocked,'Only verified active superadmin can start';
 first:=public.admin_ads_credit_pilot_v1_1101(own,'prepare');
 id:=(first->>'topupId')::uuid;
 ASSERT first->>'amountCents'='1990' AND first->>'status'='reserved','Pilot did not reserve exact R$19.90';
 duplicate:=public.admin_ads_credit_pilot_v1_1101(own,'prepare');
 ASSERT duplicate->>'requestId'=first->>'requestId','Double click reserved another Pix';
 blocked:=false;
 BEGIN PERFORM public.ads_credit_topup_reserve_v1_1097(own,(first->>'requestId')::uuid,1990);
 EXCEPTION WHEN SQLSTATE '42501' THEN blocked:=true;END;
 ASSERT blocked,'Commercial endpoint could use Admin permission';
 result:=public.ads_credit_topup_claim_v1_1097(own,id);
 ASSERT result->>'canCreate'='true','Restricted pilot could not test provider';
 result:=public.ads_credit_topup_claim_v1_1097(own,id);
 ASSERT result->>'canCreate'='false','Pilot claimed another POST';
 result:=public.ads_credit_apply_payment_v1_1101(repeat('e',64),first->>'externalReference','99000000000','1234567',
  1990,'approved','accredited',true,0);
 ASSERT result->>'balanceCents'='1990','Pilot did not credit actual wallet contract';
 duplicate:=public.admin_ads_credit_pilot_v1_1101(own,'prepare',id);
 ASSERT duplicate->>'canStart'='false' AND duplicate->>'status'='approved','Another paid pilot was offered';
 ASSERT (SELECT count(*)=1 FROM public.ads_credit_topups_v1_1097 WHERE admin_pilot);
 ASSERT NOT (SELECT recharge_enabled OR view_debit_enabled OR evidence_audited
    FROM public.ads_credit_controls_v1_1097 WHERE singleton),'Pilot enabled commercial billing';
 ASSERT NOT has_function_privilege('authenticated','public.admin_ads_credit_pilot_v1_1101(uuid,text,uuid)','EXECUTE');
END;$pilot$;
ROLLBACK TO private_pilot;
UPDATE public.ads_credit_controls_v1_1097 SET recharge_enabled=true,view_debit_enabled=true,evidence_audited=true WHERE singleton;
CREATE FUNCTION pg_temp.reserve_claim(owner_id uuid,req uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
 r:=public.ads_credit_topup_reserve_v1_1097(owner_id,req,1990);
 PERFORM public.ads_credit_topup_claim_v1_1097(owner_id,(r->>'topupId')::uuid);
 RETURN r->>'externalReference';
END;$$;
CREATE FUNCTION pg_temp.fact(ref text,ev text,st text,detail text,refunded integer DEFAULT null)
RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.ads_credit_apply_payment_v1_1101(repeat(ev,64),ref,'88888888888','1234567',1990,
  st,detail,true,refunded);
$$;
SAVEPOINT clean;
DO $early$
DECLARE owner_id uuid; req uuid:=gen_random_uuid(); ref text; credit_id uuid; result jsonb; balance jsonb;
BEGIN
 SELECT user_id INTO STRICT owner_id FROM public.platform_admins WHERE active AND admin_role='superadmin' LIMIT 1;
 UPDATE auth.users SET is_anonymous=false,email_confirmed_at=now() WHERE id=owner_id;
 ref:=pg_temp.reserve_claim(owner_id,req);
 SELECT t.id INTO credit_id FROM public.ads_credit_topups_v1_1097 t WHERE t.external_reference=ref;
 result:=pg_temp.fact(ref,'1','approved','accredited',0);
 ASSERT result->>'balanceCents'='1990','Paid before initial QR was lost';
 result:=public.ads_credit_topup_attach_v1_1097(owner_id,credit_id,'88888888888','1234567',repeat('Q',100),now()+interval '1 day');
 ASSERT result->>'status'='approved' AND result->>'pixCode' IS NULL,'Late QR reopened paid request';
 result:=pg_temp.fact(ref,'2','cancelled','expired');
 ASSERT result->>'status'='approved','Late cancellation erased credited receipt';
 result:=pg_temp.fact(ref,'3','approved','partially_refunded',500);
 ASSERT result->>'balanceCents'='1490' AND result->>'status'='review_required','Partial refund debited wrong amount';
 result:=pg_temp.fact(ref,'4','approved','partially_refunded',500);
 ASSERT result->>'balanceCents'='1490','Repeated partial refund charged twice';
 result:=pg_temp.fact(ref,'5','approved','partially_refunded',800);
 ASSERT result->>'balanceCents'='1190','Second cumulative total was applied as incremental';
 result:=pg_temp.fact(ref,'6','approved','partially_refunded',500);
 ASSERT result->>'balanceCents'='1190','Out-of-order refund restored balance';
 result:=pg_temp.fact(ref,'7','refunded','refunded',1990);
 ASSERT result->>'balanceCents'='0' AND result->>'status'='reversed','Total refund missed difference';
 result:=pg_temp.fact(ref,'8','approved','accredited',0);
 ASSERT result->>'balanceCents'='0' AND result->>'status'='reversed','Late approval resurrected refund';
 balance:=public.ads_credit_balance_v1_1097(owner_id);
 ASSERT balance->>'frozen'='true' AND balance->'topups'->0->>'requestId'=req::text,'Owner recovery missing';
 ASSERT (SELECT count(*)=4 FROM public.ads_credit_ledger_v1_1097 WHERE topup_id=credit_id),'Unexpected ledger entries';
END;$early$;
ROLLBACK TO clean;
DO $unpaid$
DECLARE own uuid; req uuid:=gen_random_uuid(); ref text; topup uuid; r jsonb; denied boolean:=false;
BEGIN
 SELECT user_id INTO STRICT own FROM public.platform_admins WHERE active AND admin_role='superadmin' LIMIT 1;
 UPDATE auth.users SET is_anonymous=false,email_confirmed_at=now() WHERE id=own;
 ref:=pg_temp.reserve_claim(own,req);
 SELECT id INTO STRICT topup FROM public.ads_credit_topups_v1_1097 WHERE external_reference=ref;
 r:=public.ads_credit_close_unissued_v1_1101(own,topup);
 ASSERT r->>'status'='creating','Transient empty provider search released another Pix';
 UPDATE public.ads_credit_topups_v1_1097 SET created_at=now()-interval '4 days' WHERE id=topup;
 BEGIN PERFORM public.ads_credit_topup_reserve_v1_1097(own,gen_random_uuid(),4990);
 EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true; END;
 ASSERT denied,'Clock alone cleared a previously claimed Pix';
 r:=public.ads_credit_close_unissued_v1_1101(own,topup);
 ASSERT r->>'status'='closed_unissued','Independently empty expired intention stayed locked';
 r:=pg_temp.fact(ref,'a','cancelled','expired');
 ASSERT r->>'status'='unpaid' AND r->>'balanceCents'='0','Cancelled payment still pending';
 r:=public.ads_credit_topup_reserve_v1_1097(own,gen_random_uuid(),4990);
 ASSERT r->>'status'='reserved','Confirmed nonpayment blocked new load';
 ASSERT (SELECT count(*)=0 FROM public.ads_credit_ledger_v1_1097 WHERE owner_user_id=own),'Spurious ledger for unpaid Pix';
END;$unpaid$;
ROLLBACK TO clean;
DO $initial_partial$
DECLARE own uuid; ref text; r jsonb;
BEGIN
 SELECT user_id INTO STRICT own FROM public.platform_admins WHERE active AND admin_role='superadmin' LIMIT 1;
 UPDATE auth.users SET is_anonymous=false,email_confirmed_at=now() WHERE id=own;
 ref:=pg_temp.reserve_claim(own,gen_random_uuid());
 r:=pg_temp.fact(ref,'b','approved','partially_refunded',400);
 ASSERT r->>'balanceCents'='1590' AND r->>'status'='review_required','First partial proof did not reconcile gross and adjustment';
 ASSERT (SELECT count(*)=2 FROM public.ads_credit_ledger_v1_1097 WHERE owner_user_id=own),'First partial not journaled atomically';
END;$initial_partial$;
ROLLBACK TO clean;
DO $reversal_first$
DECLARE own uuid; ref text; r jsonb;
BEGIN
 SELECT user_id INTO STRICT own FROM public.platform_admins WHERE active AND admin_role='superadmin' LIMIT 1;
 UPDATE auth.users SET is_anonymous=false,email_confirmed_at=now() WHERE id=own;
 ref:=pg_temp.reserve_claim(own,gen_random_uuid());
 r:=pg_temp.fact(ref,'c','charged_back','charged_back',0);
 ASSERT r->>'balanceCents'='0' AND r->>'status'='reversed','Reversal without prior credit';
 r:=pg_temp.fact(ref,'d','approved','accredited',0);
 ASSERT r->>'status'='reversed' AND r->>'balanceCents'='0','Old approval resurrected chargeback';
 ASSERT NOT has_function_privilege('authenticated',
  'public.ads_credit_apply_payment_v1_1101(text,text,text,text,integer,text,text,boolean,integer)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.ads_credit_close_unissued_v1_1101(uuid,uuid)','EXECUTE');
END;$reversal_first$;
ROLLBACK;`);
assert.equal(psql('SELECT count(*) FROM public.ads_credit_topups_v1_1097'),baseline);
console.log('PASS V1.1101 PostgreSQL: early settlement, recoverable expiry, successive partial and full reversals, replay, immutable accounting, ROLLBACK.');
