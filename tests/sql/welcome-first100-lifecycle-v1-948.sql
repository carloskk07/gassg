-- V1.948: no external URLs, credentials or paid PSP; canonical local PostgreSQL.
-- All users, wallet entries, owner actions and campaign changes ROLLBACK.
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,is_sso_user,is_anonymous,email,email_confirmed_at)
SELECT
 ('f9480000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '00000000-0000-0000-0000-000000000000'::uuid,
 'authenticated','authenticated',false,false,
 'welcome-948-'||n||'@example.invalid',clock_timestamp()
FROM generate_series(1,101) n;
INSERT INTO auth.users(id,instance_id,aud,role,is_sso_user,is_anonymous,email,email_confirmed_at)
VALUES
 ('f9481000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated',false,false,'old-948@example.invalid',clock_timestamp()-interval '5 days'),
 ('f9481000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated',false,false,'unconfirmed-948@example.invalid',null),
 ('f9481000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated',false,true,'anonymous-948@example.invalid',clock_timestamp()),
 ('f9482000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated',false,false,'admin-948@example.invalid',clock_timestamp()),
 ('f9482000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated',false,false,'finance-948@example.invalid',clock_timestamp());
INSERT INTO public.platform_admins(user_id,active,admin_role)
VALUES
 ('f9482000-0000-4000-8000-000000000001',true,'superadmin'),
 ('f9482000-0000-4000-8000-000000000002',true,'finance');
UPDATE public.platform_welcome_campaign_v1_815
 SET enabled=true,starts_at=clock_timestamp()-interval '1 day',ended_at=null,
     awarded_count=0,awarded_cents=0
 WHERE campaign_key='welcome_2026_815';

SET LOCAL ROLE authenticated;
DO $regression$
DECLARE
 i integer;
 result jsonb;
 uid uuid;
BEGIN
 -- Old, anonymous and unconfirmed accounts cannot consume the first slots.
 FOREACH uid IN ARRAY ARRAY[
   'f9481000-0000-4000-8000-000000000001'::uuid,
   'f9481000-0000-4000-8000-000000000002'::uuid,
   'f9481000-0000-4000-8000-000000000003'::uuid]
 LOOP
   PERFORM set_config('request.jwt.claim.sub',uid::text,true);
   result:=public.claim_welcome_bonus_v1_815();
   IF (result->>'granted')::boolean IS NOT FALSE OR
      result->>'reason'<>'ineligible' THEN
      RAISE EXCEPTION 'INELIGIBLE_BONUS_GRANT: %',result;
   END IF;
 END LOOP;

 FOR i IN 1..100 LOOP
   uid:=('f9480000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
   PERFORM set_config('request.jwt.claim.sub',uid::text,true);
   result:=public.claim_welcome_bonus_v1_815();
   IF (result->>'granted')::boolean IS DISTINCT FROM TRUE OR
      (result->>'alreadyGranted')::boolean IS DISTINCT FROM FALSE THEN
     RAISE EXCEPTION 'WELCOME_EXPECTED_GRANT_%: %',i,result;
   END IF;
   IF i=1 THEN
      result:=public.claim_welcome_bonus_v1_815();
      IF (result->>'alreadyGranted')::boolean IS DISTINCT FROM TRUE THEN
         RAISE EXCEPTION 'DUPLICATE_GRANT_NOT_IDEMPOTENT: %',result;
      END IF;
   END IF;
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub',
   'f9480000-0000-4000-8000-000000000101',true);
 result:=public.claim_welcome_bonus_v1_815();
 IF (result->>'granted')::boolean IS DISTINCT FROM FALSE OR
    result->>'reason'<>'closed' THEN
    RAISE EXCEPTION 'AWARD_101_WAS_NOT_BLOCKED: %',result;
 END IF;
END;
$regression$;

SET LOCAL ROLE postgres;
DO $proof$
DECLARE
 c public.platform_welcome_campaign_v1_815%rowtype;
 readback jsonb;
 result jsonb;
 denied boolean:=false;
BEGIN
 SELECT * INTO STRICT c FROM public.platform_welcome_campaign_v1_815
 WHERE campaign_key='welcome_2026_815';
 IF c.awarded_count<>100 OR c.awarded_cents<>10000 OR c.max_awards<>100 OR
    (SELECT count(*) FROM public.platform_welcome_grants_v1_815
      WHERE campaign_key='welcome_2026_815')<>100 OR
    (SELECT count(*) FROM public.wallet_entries
      WHERE idempotency_key LIKE 'welcome_2026_815:%')<>100 THEN
    RAISE EXCEPTION 'WELCOME_100_LEDGER_MISMATCH';
 END IF;
 readback:=public.admin_welcome_campaign_read_v1_948(
  'f9482000-0000-4000-8000-000000000001');
 IF readback->>'source'<>'admin_welcome_campaign_read_v1_948' OR
    (readback->>'remainingAwards')::integer<>0 OR
    (readback->>'awardedCents')::integer<>10000 OR
    (readback->>'lotRemainingCents')::integer<>10000 OR
    readback->>'pspCashVerified'<>'false' THEN
   RAISE EXCEPTION 'WELCOME_READBACK_NOT_VERIFIED: %',readback;
 END IF;
 IF has_function_privilege('authenticated',
   'public.admin_welcome_campaign_manage_v1_948(uuid,text,integer,boolean,uuid)',
   'EXECUTE') OR has_function_privilege('anon',
   'public.admin_welcome_campaign_read_v1_948(uuid)','EXECUTE') THEN
   RAISE EXCEPTION 'WELCOME_ADMIN_PRIVILEGE_EXPOSED';
 END IF;
 BEGIN
  PERFORM public.admin_welcome_campaign_manage_v1_948(
   'f9482000-0000-4000-8000-000000000002',
   'end',100,true,'f9483000-0000-4000-8000-000000000001');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'FINANCE_ROLE_END_ALLOWED'; END IF;

 result:=public.admin_welcome_campaign_manage_v1_948(
   'f9482000-0000-4000-8000-000000000001',
   'pause',100,true,'f9483000-0000-4000-8000-000000000002');
 IF result->>'enabled'<>'false' OR
    result->>'replayed'<>'false' THEN
   RAISE EXCEPTION 'PAUSE_FAILED: %',result;
 END IF;
 result:=public.admin_welcome_campaign_manage_v1_948(
   'f9482000-0000-4000-8000-000000000001',
   'pause',100,true,'f9483000-0000-4000-8000-000000000002');
 IF result->>'replayed'<>'true' THEN
   RAISE EXCEPTION 'ADMIN_ACTION_REPLAY_FAILED: %',result;
 END IF;

 -- Temporarily permit resume by leaving one unawarded slot. This modified
 -- counter is only a local fixture; no new bonus grant is created here.
 UPDATE public.platform_welcome_campaign_v1_815
 SET max_awards=101,budget_cents=10100
 WHERE campaign_key='welcome_2026_815';
 result:=public.admin_welcome_campaign_manage_v1_948(
   'f9482000-0000-4000-8000-000000000001',
   'resume',100,false,'f9483000-0000-4000-8000-000000000003');
 IF result->>'enabled'<>'true' THEN RAISE EXCEPTION 'RESUME_FAILED'; END IF;
 -- The original 100-person budget is restored before the final gate;
 -- the production route never offers a cap increase.
 UPDATE public.platform_welcome_campaign_v1_815
 SET max_awards=100,budget_cents=10000
 WHERE campaign_key='welcome_2026_815';

 result:=public.admin_welcome_campaign_manage_v1_948(
   'f9482000-0000-4000-8000-000000000001',
   'end',100,true,'f9483000-0000-4000-8000-000000000004');
 IF result->>'ended'<>'true' OR result->>'enabled'<>'false' THEN
   RAISE EXCEPTION 'END_FAILED: %',result;
 END IF;
 denied:=false;
 BEGIN
   PERFORM public.admin_welcome_campaign_manage_v1_948(
     'f9482000-0000-4000-8000-000000000001',
     'resume',100,false,'f9483000-0000-4000-8000-000000000005');
 EXCEPTION WHEN serialization_failure THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'PERMANENT_END_CAN_BE_RESUMED'; END IF;

 readback:=public.admin_welcome_campaign_read_v1_948(
  'f9482000-0000-4000-8000-000000000001');
 IF jsonb_array_length(readback->'history')<>3 THEN
   RAISE EXCEPTION 'WELCOME_AUDIT_EVENTS_MISSING: %',readback;
 END IF;
 IF (SELECT count(*) FROM public.platform_admin_audit
      WHERE action='welcome_campaign_control_v1_948')<>3 THEN
   RAISE EXCEPTION 'WELCOME_ACTION_DUPLICATED';
 END IF;
 RAISE NOTICE 'WELCOME_100_CLAIMS_PASS';
END;
$proof$;
SELECT 'WELCOME_100_CLAIMS_PASS' AS proof;
ROLLBACK;
