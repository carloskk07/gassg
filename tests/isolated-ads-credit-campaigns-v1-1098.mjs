import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.CI,'true');
for(const key of ['SUPABASE_ACCESS_TOKEN','SUPABASE_DB_PASSWORD',
 'SUPABASE_SERVICE_ROLE_KEY','MERCADOPAGO_ACCESS_TOKEN','ADS_MP_ACCESS_TOKEN'])
 assert.equal(process.env[key]||'','');
const query=sql=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
 '--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet',
 '--command='+sql],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},
 timeout:120000,stdio:['ignore','pipe','pipe']}).trim();
assert.equal(query('select current_database()'),'postgres');
const campaignsBefore=query('select count(*) from public.ads_credit_campaigns_v1_1098');
const legacyBefore=query('select count(*) from public.ads_independent_campaigns_v1_884');
const test=String.raw`
BEGIN;
DO $ads1098$
DECLARE
 actor uuid; campaign uuid; request_id uuid:=gen_random_uuid(); challenge_id uuid;
 msg jsonb; next jsonb; version integer:=1; balance bigint; blocked boolean;
BEGIN
 SELECT user_id INTO actor FROM public.platform_admins
  WHERE active AND admin_role='superadmin' LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'ADS_OWNER_FIXTURE_MISSING';END IF;
 UPDATE auth.users SET email_confirmed_at=clock_timestamp(),is_anonymous=false
 WHERE id=actor;
 IF EXISTS(SELECT 1 FROM public.ads_credit_controls_v1_1097
 WHERE singleton AND (recharge_enabled OR view_debit_enabled OR evidence_audited))
 THEN RAISE EXCEPTION 'ADS_UNSAFE_DEFAULT';END IF;
 IF has_function_privilege('anon',
 'public.ads_credit_confirm_v1_1098(uuid,text,integer,integer,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'ADS_ANON_CAN_DEBIT';END IF;
 msg:=public.ads_credit_campaign_submit_v1_1098(
 actor,request_id,'Comércio local',
 'Conheça novidades no comércio',
 'Produtos, serviços e novidades da empresa nesta cidade.',
 'São Gabriel','RS','https://example.com/anuncio');
 campaign:=(msg->>'campaignId')::uuid;
 IF campaign IS NULL THEN RAISE EXCEPTION 'ADS_SUBMIT_MISSING';END IF;
 next:=public.ads_credit_campaign_submit_v1_1098(
 actor,request_id,'Comércio local',
 'Conheça novidades no comércio',
 'Produtos, serviços e novidades da empresa nesta cidade.',
 'São Gabriel','RS','https://example.com/anuncio');
 IF next->>'replayed'<>'true' THEN RAISE EXCEPTION 'ADS_SUBMIT_NOT_IDEMPOTENT';END IF;
 blocked:=false;
 BEGIN
  PERFORM public.ads_credit_admin_action_v1_1098(
   actor,campaign,version,'publish','Anúncio preparado para publicação.');
 EXCEPTION WHEN SQLSTATE '40001' THEN blocked:=true;END;
 IF NOT blocked THEN RAISE EXCEPTION 'ADS_PUBLISHED_BEFORE_APPROVAL';END IF;
 PERFORM public.ads_credit_admin_action_v1_1098(
   actor,campaign,version,'approve','Anúncio revisado pela administração.');
 version:=version+1;
 blocked:=false;
 BEGIN
  PERFORM public.ads_credit_admin_action_v1_1098(
   actor,campaign,version,'publish','Anúncio preparado para exibição.');
 EXCEPTION WHEN SQLSTATE '42501' THEN blocked:=true;END;
 IF NOT blocked THEN RAISE EXCEPTION 'ADS_PUBLISHED_WITHOUT_BALANCE';END IF;
 INSERT INTO public.ads_credit_wallets_v1_1097(owner_user_id,balance_cents,total_loaded_cents)
 VALUES(actor,10,10);
 UPDATE public.ads_credit_controls_v1_1097
 SET recharge_enabled=true,view_debit_enabled=true,evidence_audited=true WHERE singleton;
 PERFORM public.ads_credit_admin_action_v1_1098(
 actor,campaign,version,'publish','Anúncio aprovado com saldo em banco de teste.');
 version:=version+1;
 msg:=public.ads_credit_issue_v1_1098('São Gabriel','RS',repeat('a',64),null);
 IF msg->>'billingEnabled'<>'true' OR msg->>'pricingMode'<>'prepaid_per_view'
 OR msg->'slot'->>'campaignId'<>campaign::text
 THEN RAISE EXCEPTION 'ADS_PREPAID_NOT_ISSUED';END IF;
 challenge_id:=(msg->'slot'->>'challenge')::uuid;
 UPDATE public.ads_credit_challenges_v1_1098
 SET issued_at=clock_timestamp()-interval '2 seconds'
 WHERE token=challenge_id;
 msg:=public.ads_credit_confirm_v1_1098(challenge_id,repeat('a',64),1600,75,null);
 IF msg->>'charged'<>'true' OR msg->>'chargedCents'<>'2'
 THEN RAISE EXCEPTION 'ADS_VIEW_NOT_CHARGED';END IF;
 next:=public.ads_credit_confirm_v1_1098(challenge_id,repeat('a',64),1600,75,null);
 IF next->>'charged'<>'false' THEN RAISE EXCEPTION 'ADS_VIEW_REPLAY_CHARGED';END IF;
 SELECT balance_cents INTO balance FROM public.ads_credit_wallets_v1_1097 WHERE owner_user_id=actor;
 IF balance<>8 THEN RAISE EXCEPTION 'ADS_WRONG_BALANCE';END IF;
 msg:=public.ads_credit_issue_v1_1098('São Gabriel','RS',repeat('a',64),null);
 IF msg->'slot'<>'null'::jsonb THEN RAISE EXCEPTION 'ADS_DUPLICATE_VIEWER_24H';END IF;
 msg:=public.ads_credit_issue_v1_1098('São Gabriel','RS',repeat('b',64),actor);
 IF msg->'slot'<>'null'::jsonb THEN RAISE EXCEPTION 'ADS_OWNER_SELF_VIEW';END IF;
 PERFORM public.ads_credit_campaign_owner_action_v1_1098(actor,campaign,version,'pause');
 version:=version+1;
 msg:=public.ads_credit_issue_v1_1098('São Gabriel','RS',repeat('c',64),null);
 IF msg->'slot'<>'null'::jsonb THEN RAISE EXCEPTION 'ADS_PAUSED_STILL_DELIVERED';END IF;
 PERFORM public.ads_credit_campaign_owner_action_v1_1098(actor,campaign,version,'resume');
 version:=version+1;
 UPDATE public.ads_credit_wallets_v1_1097 SET balance_cents=1 WHERE owner_user_id=actor;
 msg:=public.ads_credit_issue_v1_1098('São Gabriel','RS',repeat('d',64),null);
 IF msg->'slot'<>'null'::jsonb THEN RAISE EXCEPTION 'ADS_ZERO_CAPACITY_DELIVERED';END IF;
 PERFORM public.ads_credit_admin_action_v1_1098(
 actor,campaign,version,'end','Encerramento da campanha após teste financeiro.');
 IF (SELECT status FROM public.ads_credit_campaigns_v1_1098 WHERE id=campaign)<>'ended'
 THEN RAISE EXCEPTION 'ADS_END_FAILED';END IF;
 IF (SELECT count(*) FROM public.ads_credit_view_receipts_v1_1098 WHERE campaign_id=campaign)<>1
 OR (SELECT count(*) FROM public.ads_credit_ledger_v1_1097 WHERE owner_user_id=actor)<>1
 THEN RAISE EXCEPTION 'ADS_LEDGER_DUPLICATED';END IF;
 RAISE NOTICE 'PASS ADS V1.1098: review, delivery, view, debit, replay, owner, insufficient and pause';
END;$ads1098$;
ROLLBACK;
`;
query(test);
assert.equal(query('select count(*) from public.ads_credit_campaigns_v1_1098'),campaignsBefore);
assert.equal(query('select count(*) from public.ads_independent_campaigns_v1_884'),legacyBefore);
console.log('PASS: prepaid credit campaigns and atomic charge in disposable PostgreSQL ROLLBACK.');
