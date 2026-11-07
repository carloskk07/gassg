import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.CI,'true');
for(const k of ['SUPABASE_ACCESS_TOKEN','SUPABASE_DB_PASSWORD','SUPABASE_SERVICE_ROLE_KEY',
 'MERCADOPAGO_ACCESS_TOKEN','ADS_MP_ACCESS_TOKEN'])assert.equal(process.env[k]||'','');
const sql=q=>execFileSync('psql',['--host=127.0.0.1','--port=54322','--username=postgres',
 '--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only',
 '--no-align','--quiet','--command='+q],
 {encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},timeout:120000}).trim();
const count=sql('select count(*) from public.ads_independent_refund_cases_v1_887');
sql(`BEGIN;
DO $exercise$
DECLARE
 v_actor uuid;v_campaign uuid;v_case uuid;v_result jsonb;v_reference text;
 v_bad boolean;v_reason text;v_version integer;
BEGIN
 SELECT user_id INTO v_actor FROM public.platform_admins WHERE active AND admin_role='superadmin' LIMIT 1;
 IF v_actor IS NULL THEN RAISE EXCEPTION 'V887_ADMIN_REQUIRED';END IF;
 UPDATE auth.users SET email_confirmed_at=clock_timestamp(),is_anonymous=false WHERE id=v_actor;
 v_result:=public.ads_independent_submit_v1_884(v_actor,gen_random_uuid(),
  'Marca independente de teste','Publicidade regional remunerada',
  'Divulgação temporária de serviços locais mediante valor e prazo definidos.',
  'São Gabriel','RS','https://example.com/campanha',1990,7);
 v_campaign:=(v_result->>'campaignId')::uuid;
 PERFORM public.admin_ads_independent_action_v1_884(v_actor,'approve',v_campaign,1,
  'Aprovar criativo apenas na transação isolada');
 PERFORM public.admin_ads_independent_sales_toggle_v1_886(v_actor,true,1,
  'Ativar venda somente no ensaio transacional isolado');
 PERFORM public.admin_ads_independent_action_v1_884(v_actor,'enable_delivery',null,null,
  'Ativar exibição sintética sem acesso comercial');
 v_result:=public.ads_independent_checkout_reserve_v1_886(v_actor,v_campaign,gen_random_uuid());
 v_reference:=v_result->>'externalReference';
 PERFORM public.ads_independent_checkout_attach_v1_886(v_campaign,v_reference,
  'pref-abc123','https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-abc123');
 PERFORM public.ads_independent_payment_fact_v1_886(repeat('a',64),v_reference,
  '123456789','123456',1990,'BRL','approved','accredited',true);
 PERFORM public.admin_ads_independent_action_v1_884(v_actor,'publish',v_campaign,2,
  'Publicação paga para ensaio transacional descartável');
 v_bad:=false;
 BEGIN
  PERFORM public.ads_independent_refund_request_v1_887(gen_random_uuid(),v_campaign,gen_random_uuid(),
   'Tentativa de pedir reembolso por conta alheia');
 EXCEPTION WHEN SQLSTATE '42501' THEN v_bad:=true;
 END;
 IF NOT v_bad THEN RAISE EXCEPTION 'V887_FOREIGN_REFUND_ALLOWED';END IF;
 v_result:=public.ads_independent_refund_request_v1_887(v_actor,v_campaign,gen_random_uuid(),
  'Solicitação de cancelamento e análise de devolução do valor');
 v_case:=(v_result->>'caseId')::uuid;
 IF v_case IS NULL OR v_result->>'refundIssued'<>'false'
  OR (SELECT status FROM public.ads_independent_campaigns_v1_884 WHERE id=v_campaign)<>'paused'
 THEN RAISE EXCEPTION 'V887_PAUSE_OR_PROOF_INVALID';END IF;
 v_result:=public.ads_independent_refund_request_v1_887(v_actor,v_campaign,gen_random_uuid(),
  'Solicitação reapresentada sem cobrança adicional');
 IF v_result->>'replayed'<>'true' OR (v_result->>'caseId')::uuid<>v_case
 THEN RAISE EXCEPTION 'V887_REFUND_REPLAY_DUPLICATED';END IF;
 v_bad:=false;
 BEGIN
  PERFORM public.admin_ads_independent_action_v1_884(v_actor,'resume',v_campaign,4,
   'Retomada indevida com solicitação de reembolso em aberto');
 EXCEPTION WHEN SQLSTATE '42501' THEN
  GET STACKED DIAGNOSTICS v_reason=MESSAGE_TEXT;
  v_bad:=v_reason='ADS_REFUND_CASE_OPEN';
 END;
 IF NOT v_bad THEN RAISE EXCEPTION 'V887_PENDING_REFUND_RESUME';END IF;
 v_bad:=false;
 BEGIN
  PERFORM public.admin_ads_independent_refund_action_v1_887(gen_random_uuid(),v_case,1,
   'review','Tentativa de aprovar como administrador inexistente');
 EXCEPTION WHEN SQLSTATE '42501' THEN v_bad:=true;
 END;
 IF NOT v_bad THEN RAISE EXCEPTION 'V887_REFUND_ADMIN_LEAK';END IF;
 v_result:=public.admin_ads_independent_refund_action_v1_887(v_actor,v_case,1,
  'review','Revisão formal da solicitação sem qualquer devolução');
 IF v_result->>'status'<>'reviewing' THEN RAISE EXCEPTION 'V887_REVIEW_FAILED';END IF;
 v_bad:=false;
 BEGIN
  PERFORM public.admin_ads_independent_refund_action_v1_887(v_actor,v_case,2,
   'record_provider_reversal','Tentativa de declarar crédito sem reversão do PSP');
 EXCEPTION WHEN SQLSTATE '42501' THEN v_bad:=true;
 END;
 IF NOT v_bad THEN RAISE EXCEPTION 'V887_REFUND_FICTITIOUS';END IF;
 PERFORM public.ads_independent_payment_fact_v1_886(repeat('b',64),v_reference,
  '123456789','123456',1990,'BRL','refunded','refunded',true);
 v_result:=public.admin_ads_independent_refund_action_v1_887(v_actor,v_case,2,
  'record_provider_reversal','Registrar reversão oficial do provedor sem afirmar crédito bancário');
 IF v_result->>'status'<>'provider_reversed' OR v_result->>'moneyMoved'<>'false'
 THEN RAISE EXCEPTION 'V887_UNVERIFIED_REFUND';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ads_independent_refund_events_v1_887
  WHERE campaign_id=v_campaign AND action='record_provider_reversal')
 THEN RAISE EXCEPTION 'V887_REFUND_AUDIT_MISSING';END IF;
 IF has_function_privilege('authenticated',
  'public.ads_independent_refund_request_v1_887(uuid,uuid,uuid,text)','EXECUTE')
  OR has_table_privilege('anon','public.ads_independent_refund_cases_v1_887','SELECT')
 THEN RAISE EXCEPTION 'V887_RLS_LEAK';END IF;
 IF EXISTS(SELECT 1 FROM public.ads_independent_view_signals_v1_884 WHERE billable)
 THEN RAISE EXCEPTION 'V887_CPM_UNLOCKED';END IF;
END;
$exercise$;
ROLLBACK;`);
assert.equal(sql('select count(*) from public.ads_independent_refund_cases_v1_887'),count);
console.log('V1.887 PASS: owner-only refund request, campaign pause, open-case gate and provider reversal audit (ROLLBACK).');
