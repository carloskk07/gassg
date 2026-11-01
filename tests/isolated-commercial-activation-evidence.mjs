import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';

// #493: a human acknowledgement is not proof of real eligible supply.
// Exercise the actual PostgreSQL RPCs ONLY in disposable GitHub CI.
// Never issue live requests, alter a production merchant or create money.
assert.equal(process.env.CI,'true');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const migration=fs.readFileSync(
  new URL('../supabase/migrations/20261101141000_commercial_activation_requires_eligible_supply_v1_493.sql',import.meta.url),'utf8');
assert.match(migration,/'readyToEnable',v_database_ready and cardinality\(v_security\)=0/);
assert.match(migration,/'canActivateOperation',v_database_ready and cardinality\(v_security\)=0/);
assert.match(migration,/LAUNCH_ELIGIBLE_SUPPLY_REQUIRED/);
const sql=query=>execFileSync('psql',[
  '--host=127.0.0.1','--port=54322','--username=postgres',
  '--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1',
  '--tuples-only','--no-align','--quiet','--command='+query
],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},timeout:60000}).trim();
assert.equal(sql('select current_database()'),'postgres');
assert.equal(sql('select inet_server_port()'),'5432');

const before=sql("SELECT operation_mode||':'||commerce_enabled::text FROM public.platform_launch_control WHERE singleton");
const exercise=`
BEGIN;
DO $homologate$
DECLARE
  v_actor uuid;
  v_current jsonb;
  v_requirement text;
  v_rejected boolean:=false;
  v_result jsonb;
BEGIN
  SELECT user_id INTO v_actor FROM public.platform_admins
  WHERE active AND admin_role='superadmin' LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'ISOLATED_SUPERADMIN_REQUIRED'; END IF;

  -- Force no offerable merchant without touching the real database.
  UPDATE public.merchants SET online=false;
  UPDATE public.platform_launch_control
    SET operation_mode='PRELAUNCH',commerce_enabled=false,
        portals_verified_at=clock_timestamp(),
        portals_source_sha=repeat('a',40),
        customer_portal_ok=true,merchant_portal_ok=true,admin_portal_ok=true
    WHERE singleton;

  v_current:=public.platform_launch_readiness();
  IF coalesce((v_current->>'databaseReady')::boolean,true)
     OR coalesce((v_current->>'offerReadyMerchantCount')::integer,1)>0
  THEN RAISE EXCEPTION 'SUPPLY_FIXTURE_NOT_BLOCKED'; END IF;

  -- Explicitly acknowledge EVERY outstanding business warning. This is a
  -- negative test of the OLD waiver path, not permission to ship or sell.
  FOR v_requirement IN
    SELECT jsonb_array_elements_text(v_current->'warnings')
  LOOP
    INSERT INTO public.platform_launch_confirmations
      (requirement_key,status,reason,actor_user_id,expires_at)
    VALUES(v_requirement,'confirmed',
      'Apenas ensaio de homologacao no banco descartavel',v_actor,
      clock_timestamp()+interval '1 hour');
  END LOOP;

  v_current:=public.platform_launch_readiness();
  IF v_current->>'allWarningsConfirmed'<>'true' THEN
    RAISE EXCEPTION 'WARNINGS_NOT_CONFIRMED_IN_FIXTURE';END IF;
  IF v_current->>'portalsFresh'<>'true'
     OR jsonb_array_length(v_current->'securityBlockers')<>0 THEN
    RAISE EXCEPTION 'ISOLATED_PORTAL_SECURITY_NOT_READY';END IF;
  IF v_current->>'databaseReady'<>'false'
     OR v_current->>'readyToEnable'<>'false'
     OR v_current->>'canActivateOperation'<>'false' THEN
    RAISE EXCEPTION 'CONFIRMED_WARNINGS_BYPASSED_REAL_SUPPLY';END IF;

  BEGIN
    PERFORM public.admin_operation_mode_action(
      v_actor,'PILOT','Ensaio CI: rejeitar ativacao sem oferta real',
      null,'ci-hard-gate-'||gen_random_uuid()::text,repeat('b',64));
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM='LAUNCH_ELIGIBLE_SUPPLY_REQUIRED' THEN
      v_rejected:=true;
    ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'PILOT_ACTIVATED_WITHOUT_SUPPLY'; END IF;
  IF (SELECT commerce_enabled FROM public.platform_launch_control WHERE singleton) THEN
    RAISE EXCEPTION 'UNEXPECTED_COMMERCE_ACTIVATION';END IF;

  -- Emergency pause must remain possible even if the supplier goes offline.
  UPDATE public.platform_launch_control
    SET operation_mode='LIVE',commerce_enabled=true WHERE singleton;
  v_result:=public.admin_operation_mode_action(
    v_actor,'PAUSED','Ensaio CI: pausa segura',
    null,'ci-pause-'||gen_random_uuid()::text,repeat('c',64));
  IF v_result->>'operationMode'<>'PAUSED'
     OR v_result->>'commerceEnabled'<>'false' THEN
    RAISE EXCEPTION 'EMERGENCY_PAUSE_REGRESSION';END IF;
END
$homologate$;
ROLLBACK;
`;
sql(exercise);
assert.equal(sql("SELECT operation_mode||':'||commerce_enabled::text FROM public.platform_launch_control WHERE singleton"),
 before,'all proof fixtures must roll back exactly');
console.log('PASS #493: confirmed business warnings cannot enable PILOT without eligible supply; emergency PAUSED still works (disposable PG17).');
