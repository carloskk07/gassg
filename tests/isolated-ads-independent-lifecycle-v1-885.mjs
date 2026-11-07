import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.CI,'true');
for(const k of ['SUPABASE_ACCESS_TOKEN','SUPABASE_DB_PASSWORD','SUPABASE_SERVICE_ROLE_KEY','MERCADOPAGO_ACCESS_TOKEN'])
 assert.equal(process.env[k]||'','');
const sql=q=>execFileSync('psql',['--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet','--command='+q],
 {encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},timeout:120000}).trim();
assert.equal(sql('select current_database()'),'postgres');
const before=sql('select count(*) from public.ads_independent_campaigns_v1_884');
sql(`BEGIN;
DO $exercise$
DECLARE
 v_actor uuid;
 v_result jsonb;
 v_id uuid;
 v_version integer;
 v_expires timestamptz;
 v_denied boolean;
BEGIN
 SELECT user_id INTO v_actor FROM public.platform_admins
 WHERE active AND admin_role='superadmin' LIMIT 1;
 IF v_actor IS NULL THEN RAISE EXCEPTION 'V885_ADMIN_REQUIRED';END IF;
 UPDATE auth.users SET email_confirmed_at=clock_timestamp(),is_anonymous=false WHERE id=v_actor;
 v_result:=public.ads_independent_submit_v1_884(v_actor,gen_random_uuid(),
  'Anunciante independente exemplo','Campanha local sem pagamento',
  'Campanha independente com pausa, retomada e encerramento seguro.',
  'São Gabriel','RS','https://example.com/campanha',1990,7);
 v_id:=(v_result->>'campaignId')::uuid;
 PERFORM public.admin_ads_independent_action_v1_884(v_actor,'approve',v_id,1,
  'Aprovação exclusiva de campanha para ensaio isolado');
 PERFORM public.admin_ads_independent_action_v1_884(v_actor,'enable_delivery',null,null,
  'Ativar entrega exclusivamente na transação descartável');
 PERFORM public.admin_ads_independent_action_v1_884(v_actor,'publish',v_id,2,
  'Publicação isolada sem qualquer cobrança monetária');
 SELECT run_ends_at INTO v_expires FROM public.ads_independent_campaigns_v1_884 WHERE id=v_id;
 v_result:=public.admin_ads_independent_action_v1_884(v_actor,'pause',v_id,3,
  'Pausar campanha para testar retomada de calendário');
 IF v_result->>'status'<>'paused' THEN RAISE EXCEPTION 'V885_PAUSE_FAILED';END IF;
 IF (public.ads_independent_issue_v1_884('São Gabriel','RS',repeat('a',64))->'slot')<>'null'::jsonb
 THEN RAISE EXCEPTION 'V885_PAUSE_SERVING';END IF;
 v_result:=public.admin_ads_independent_action_v1_884(v_actor,'resume',v_id,4,
  'Retomar campanha sem reiniciar seu prazo original');
 IF v_result->>'status'<>'active' THEN RAISE EXCEPTION 'V885_RESUME_FAILED';END IF;
 IF (SELECT run_ends_at FROM public.ads_independent_campaigns_v1_884 WHERE id=v_id)<>v_expires
 THEN RAISE EXCEPTION 'V885_EXPIRY_EXTENDED';END IF;
 PERFORM public.admin_ads_independent_action_v1_884(v_actor,'pause',v_id,5,
  'Pausa para ensaio de prazo expirado sem extensão');
 UPDATE public.ads_independent_campaigns_v1_884
 SET run_started_at=clock_timestamp()-interval '8 days',
     run_ends_at=clock_timestamp()-interval '1 second' WHERE id=v_id;
 v_denied:=false;
 BEGIN
  PERFORM public.admin_ads_independent_action_v1_884(v_actor,'resume',v_id,6,
   'Tentativa indevida de retomada após expiração');
 EXCEPTION WHEN SQLSTATE '40001' THEN v_denied:=true;
 END;
 IF NOT v_denied THEN RAISE EXCEPTION 'V885_EXPIRED_RESUME_ACCEPTED';END IF;
 IF (SELECT jsonb_array_length(
   public.admin_ads_independent_read_v1_884(v_actor)->'rows'))<1
 THEN RAISE EXCEPTION 'V885_ADMIN_READ_FAILED';END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(
   public.admin_ads_independent_read_v1_884(v_actor)->'rows') x
   WHERE x->>'id'=v_id::text AND x->>'effectiveStatus'='ended')
 THEN RAISE EXCEPTION 'V885_EXPIRED_STATUS_FALSE';END IF;
 v_result:=public.admin_ads_independent_action_v1_884(v_actor,'end',v_id,6,
  'Encerrar definitivamente campanha após prazo esgotado');
 IF v_result->>'status'<>'ended' THEN RAISE EXCEPTION 'V885_END_FAILED';END IF;
 v_denied:=false;
 BEGIN
  PERFORM public.admin_ads_independent_action_v1_884(v_actor,'resume',v_id,7,
   'Tentativa indevida de reabrir uma campanha encerrada');
 EXCEPTION WHEN SQLSTATE '40001' THEN v_denied:=true;
 END;
 IF NOT v_denied THEN RAISE EXCEPTION 'V885_FINAL_REOPEN_ACCEPTED';END IF;
 IF (SELECT billing_enabled FROM public.ads_independent_controls_v1_884 WHERE singleton)
 THEN RAISE EXCEPTION 'V885_BILLING_UNLOCKED';END IF;
 IF (SELECT count(*) FROM public.ads_independent_view_signals_v1_884 WHERE billable)>0
 THEN RAISE EXCEPTION 'V885_FALSE_BILLING';END IF;
END;
$exercise$;
ROLLBACK;`);
assert.equal(sql('select count(*) from public.ads_independent_campaigns_v1_884'),before);
console.log('V1.885 PASS: active -> paused -> active -> paused/expired -> ended; expiry immutable and zero billables (ROLLBACK).');
