import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.CI,'true');
for(const k of ['SUPABASE_ACCESS_TOKEN','SUPABASE_DB_PASSWORD','SUPABASE_SERVICE_ROLE_KEY','MERCADOPAGO_ACCESS_TOKEN','ADS_MP_ACCESS_TOKEN'])
 assert.equal(process.env[k]||'','');
const sql=q=>execFileSync('psql',['--host=127.0.0.1','--port=54322',
 '--username=postgres','--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1',
 '--tuples-only','--no-align','--quiet','--command='+q],{
 encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},timeout:120000}).trim();
assert.equal(sql('select current_database()'),'postgres');
const initial=sql('select count(*) from public.ads_independent_checkouts_v1_886');
sql(`BEGIN;
DO $test$
DECLARE
 v_actor uuid;v_campaign uuid;v_result jsonb;v_reference text;
 v_err text;v_denied boolean;v_id uuid;
BEGIN
 SELECT user_id INTO v_actor FROM public.platform_admins
 WHERE admin_role='superadmin' AND active LIMIT 1;
 IF v_actor IS NULL THEN RAISE EXCEPTION 'V886_ADMIN_REQUIRED';END IF;
 UPDATE auth.users SET email_confirmed_at=clock_timestamp(),is_anonymous=false WHERE id=v_actor;
 IF (SELECT sales_enabled FROM public.ads_independent_sales_controls_v1_886 WHERE singleton)
 THEN RAISE EXCEPTION 'V886_SALES_DEFAULT_ON';END IF;
 v_result:=public.ads_independent_submit_v1_884(v_actor,gen_random_uuid(),
   'Anunciante independente real','Campanha local com valor fixo',
   'Peça regional independente para ensaio de checkout em banco descartável.',
   'São Gabriel','RS','https://example.com/campanha',1990,7);
 v_campaign:=(v_result->>'campaignId')::uuid;
 PERFORM public.admin_ads_independent_action_v1_884(v_actor,'approve',v_campaign,1,
   'Aprovar peça em ensaio descartável sem publicação');
 v_denied:=false;
 BEGIN
  PERFORM public.ads_independent_checkout_reserve_v1_886(v_actor,v_campaign,gen_random_uuid());
 EXCEPTION WHEN SQLSTATE '42501' THEN
  GET STACKED DIAGNOSTICS v_err=MESSAGE_TEXT;
  v_denied:=v_err='ADS_SALES_DISABLED';
 END;
 IF NOT v_denied THEN RAISE EXCEPTION 'V886_SALES_OFF_FAILED';END IF;
 v_denied:=false;
 BEGIN
  PERFORM public.admin_ads_independent_sales_toggle_v1_886(gen_random_uuid(),true,1,
   'Tentativa não autorizada de liberar vendas');
 EXCEPTION WHEN SQLSTATE '42501' THEN v_denied:=true;
 END;
 IF NOT v_denied THEN RAISE EXCEPTION 'V886_ADMIN_ROLE_LEAK';END IF;
 PERFORM public.admin_ads_independent_sales_toggle_v1_886(v_actor,true,1,
  'Habilitar checkout apenas na transação descartável');
 PERFORM public.admin_ads_independent_action_v1_884(v_actor,'enable_delivery',null,null,
  'Habilitar veiculação em cenário isolado temporário');
 v_denied:=false;
 BEGIN
  PERFORM public.admin_ads_independent_action_v1_884(v_actor,'publish',v_campaign,2,
   'Tentativa de publicação comercial sem pagamento');
 EXCEPTION WHEN SQLSTATE '42501' THEN
  GET STACKED DIAGNOSTICS v_err=MESSAGE_TEXT;
  v_denied:=v_err='ADS_PAID_CAMPAIGN_REQUIRED';
 END;
 IF NOT v_denied THEN RAISE EXCEPTION 'V886_FREE_PUBLICATION_ALLOWED';END IF;
 v_id:=gen_random_uuid();
 v_result:=public.ads_independent_checkout_reserve_v1_886(v_actor,v_campaign,v_id);
 IF v_result->>'created'<>'true' OR v_result->>'amountCents'<>'1990'
 THEN RAISE EXCEPTION 'V886_RESERVE_FAILED';END IF;
 v_reference:=v_result->>'externalReference';
 IF v_reference NOT LIKE 'tamao-ads-ind-%' THEN RAISE EXCEPTION 'V886_REFERENCE_INVALID';END IF;
 v_result:=public.ads_independent_checkout_reserve_v1_886(v_actor,v_campaign,gen_random_uuid());
 IF v_result->>'created'<>'false' OR
 (SELECT count(*) FROM public.ads_independent_checkouts_v1_886 WHERE campaign_id=v_campaign)<>1
 THEN RAISE EXCEPTION 'V886_DOUBLE_CHARGE_RESERVATION';END IF;
 v_denied:=false;
 BEGIN
  PERFORM public.ads_independent_checkout_attach_v1_886(
   v_campaign,v_reference,'pref-123456','https://example.org/not-a-psp');
 EXCEPTION WHEN SQLSTATE '22023' THEN v_denied:=true;
 END;
 IF NOT v_denied THEN RAISE EXCEPTION 'V886_INVALID_PAYMENT_URL';END IF;
 v_result:=public.ads_independent_checkout_attach_v1_886(
   v_campaign,v_reference,'pref-123456',
   'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-123456');
 IF v_result->>'status'<>'checkout_ready' THEN RAISE EXCEPTION 'V886_ATTACH_FAILED';END IF;
 v_denied:=false;
 BEGIN
  PERFORM public.ads_independent_payment_fact_v1_886(repeat('b',64),
   v_reference,'123456789','123456',1990,'BRL','approved','accredited',false);
 EXCEPTION WHEN SQLSTATE '42501' THEN v_denied:=true;
 END;
 IF NOT v_denied THEN RAISE EXCEPTION 'V886_SANDBOX_BECAME_LIVE';END IF;
 v_denied:=false;
 BEGIN
  PERFORM public.ads_independent_payment_fact_v1_886(repeat('b',64),
   v_reference,'123456789','123456',4990,'BRL','approved','accredited',true);
 EXCEPTION WHEN SQLSTATE '42501' THEN v_denied:=true;
 END;
 IF NOT v_denied THEN RAISE EXCEPTION 'V886_WRONG_AMOUNT_ACCEPTED';END IF;
 v_result:=public.ads_independent_payment_fact_v1_886(repeat('c',64),
   v_reference,'123456789','123456',1990,'BRL','approved','accredited',true);
 IF v_result->>'paymentApproved'<>'true' OR v_result->>'autoPublished'<>'false' OR
 v_result->>'netSettlementVerified'<>'false' THEN
 RAISE EXCEPTION 'V886_FALSE_SETTLEMENT';END IF;
 v_result:=public.ads_independent_payment_fact_v1_886(repeat('c',64),
   v_reference,'123456789','123456',1990,'BRL','approved','accredited',true);
 IF v_result->>'recorded'<>'false' THEN RAISE EXCEPTION 'V886_REPLAY_COUNTED';END IF;
 PERFORM public.admin_ads_independent_action_v1_884(v_actor,'publish',v_campaign,2,
  'Publicação autorizada depois da confirmação do provedor');
 IF (SELECT status FROM public.ads_independent_campaigns_v1_884 WHERE id=v_campaign)<>'active'
 THEN RAISE EXCEPTION 'V886_PAID_NOT_PUBLISHED';END IF;
 v_result:=public.ads_independent_payment_fact_v1_886(repeat('d',64),
  v_reference,'123456789','123456',1990,'BRL','refunded','refunded',true);
 IF v_result->>'status'<>'payment_reversed' OR
 (SELECT status FROM public.ads_independent_campaigns_v1_884 WHERE id=v_campaign)<>'paused'
 THEN RAISE EXCEPTION 'V886_REVERSAL_DID_NOT_PAUSE';END IF;
 v_denied:=false;
 BEGIN
  PERFORM public.admin_ads_independent_action_v1_884(v_actor,'resume',v_campaign,4,
   'Tentativa de reabrir campanha revertida');
 EXCEPTION WHEN SQLSTATE '42501' THEN
  GET STACKED DIAGNOSTICS v_err=MESSAGE_TEXT;
  v_denied:=v_err='ADS_PAID_CAMPAIGN_REQUIRED';
 END;
 IF NOT v_denied THEN RAISE EXCEPTION 'V886_REVERSED_RESUME';END IF;
 PERFORM public.admin_ads_independent_sales_toggle_v1_886(v_actor,false,2,
  'Encerrar novas cobranças mantendo auditoria intacta');
 IF (SELECT billing_enabled FROM public.ads_independent_controls_v1_884 WHERE singleton)
 OR EXISTS(SELECT 1 FROM public.ads_independent_view_signals_v1_884 WHERE billable)
 THEN RAISE EXCEPTION 'V886_CPM_UNINTENTIONALLY_ENABLED';END IF;
 IF has_table_privilege('anon','public.ads_independent_checkouts_v1_886','SELECT')
 OR has_function_privilege('authenticated',
 'public.ads_independent_payment_fact_v1_886(text,text,text,text,integer,text,text,text,boolean)','EXECUTE')
 THEN RAISE EXCEPTION 'V886_DATA_EXPOSED';END IF;
END;
$test$;
ROLLBACK;`);
assert.equal(sql('select count(*) from public.ads_independent_checkouts_v1_886'),initial);
console.log('V1.886 PASS: owner checkout, idempotency, authentic live payment, paid-only delivery, reversal pause; zero persisted (ROLLBACK).');
