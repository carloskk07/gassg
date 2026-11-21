// V1.1105 commercial release: execute the real six-cent prepaid billing lifecycle
// inside disposable Postgres only. No provider, production state or fabricated view.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.CI,'true','Only CI disposable database may run financial fixtures');
for(const name of ['SUPABASE_ACCESS_TOKEN','SUPABASE_DB_PASSWORD',
 'SUPABASE_SERVICE_ROLE_KEY','ADS_MP_ACCESS_TOKEN','MERCADOPAGO_ACCESS_TOKEN'])
 assert.equal(process.env[name]||'','',name+' may not be present in the test worker');
const psql=sql=>execFileSync('psql',['-h','127.0.0.1','-p','54322','-U','postgres',
 '-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1','-c',sql],{
 encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},timeout:120000});
const before=psql(`select (select count(*) from public.ads_credit_wallets_v1_1097)||
 ':'||(select count(*) from public.ads_credit_campaigns_v1_1098)||
 ':'||(select count(*) from public.ads_credit_view_receipts_v1_1098)||
 ':'||(select count(*) from public.ads_credit_ledger_v1_1097)`).trim();
psql(String.raw`
BEGIN;
DO $commercial$
DECLARE
 own uuid; campaign uuid; token uuid; r jsonb; price integer; v integer:=1;
 balance bigint; n integer; viewer text;
BEGIN
 SELECT user_id INTO STRICT own FROM public.platform_admins
  WHERE active AND admin_role='superadmin' LIMIT 1;
 UPDATE auth.users SET email_confirmed_at=clock_timestamp(),is_anonymous=false
  WHERE id=own;
 -- No implicit commercial launch from schema installation.
 IF EXISTS(SELECT 1 FROM public.ads_credit_controls_v1_1097
   WHERE singleton AND (recharge_enabled OR view_debit_enabled OR evidence_audited))
 THEN RAISE EXCEPTION 'ADS_COMMERCIAL_DEFAULT_OPEN';END IF;
 IF has_function_privilege('anon','public.ads_credit_confirm_v1_1098(uuid,text,integer,integer,uuid)','execute')
   OR has_table_privilege('authenticated','public.ads_credit_ledger_v1_1097','insert')
 THEN RAISE EXCEPTION 'ADS_VIEW_PUBLIC_MONEY_WRITER'; END IF;
 r:=public.ads_credit_campaign_submit_v1_1098(own,gen_random_uuid(),
  'Comércio do teste controlado','Conheça novidades desta empresa',
  'Conheça produtos locais e os canais oficiais desta empresa.',
  'São Gabriel','RS','https://example.com/empresa');
 campaign:=(r->>'campaignId')::uuid;
 PERFORM public.ads_credit_admin_action_v1_1098(own,campaign,v,'approve',
  'Conteúdo revisado antes da divulgação.');v:=v+1;
 -- The real balance cannot be fabricated for real users; this synthetic
 -- wallet exists only in an automatically rolled back disposable database.
 INSERT INTO public.ads_credit_wallets_v1_1097
  (owner_user_id,balance_cents,total_loaded_cents) VALUES(own,6,6);
 UPDATE public.ads_credit_controls_v1_1097
  SET recharge_enabled=true,view_debit_enabled=true,evidence_audited=true
  WHERE singleton;
 SELECT cents_per_view INTO price FROM public.ads_credit_controls_v1_1097
  WHERE singleton;
 IF price<>2 THEN RAISE EXCEPTION 'ADS_WRONG_PUBLIC_PRICE';END IF;
 PERFORM public.ads_credit_admin_action_v1_1098(own,campaign,v,'publish',
  'Campanha publicada somente em banco descartável.');v:=v+1;
 r:=public.ads_credit_issue_v1_1098('Porto Alegre','RS',repeat('1',64),NULL);
 IF r->'slot'<>'null'::jsonb THEN RAISE EXCEPTION 'ADS_OUTSIDE_REGION_ISSUED';END IF;
 r:=public.ads_credit_issue_v1_1098('São Gabriel','RS',repeat('2',64),own);
 IF r->'slot'<>'null'::jsonb THEN RAISE EXCEPTION 'ADS_OWNER_CHARGED_BY_ISSUE';END IF;
 FOR n IN 1..3 LOOP
  viewer:=repeat(n::text,64);
  r:=public.ads_credit_issue_v1_1098('São Gabriel','RS',viewer,NULL);
  IF r->>'billingEnabled'<>'true' OR r->>'pricingMode'<>'prepaid_per_view'
    OR r->'slot'->>'campaignId'<>campaign::text
  THEN RAISE EXCEPTION 'ADS_REAL_INVENTORY_MISSING';END IF;
  token:=(r->'slot'->>'challenge')::uuid;
  IF n=1 THEN
   r:=public.ads_credit_confirm_v1_1098(token,viewer,1600,75,NULL);
   IF r->>'charged'<>'false' THEN RAISE EXCEPTION 'ADS_PREMATURE_CHARGED';END IF;
   r:=public.ads_credit_confirm_v1_1098(token,viewer,1600,49,NULL);
   IF r->>'charged'<>'false' THEN RAISE EXCEPTION 'ADS_INVALID_VISIBILITY_CHARGED';END IF;
   r:=public.ads_credit_confirm_v1_1098(token,repeat('f',64),1600,75,NULL);
   IF r->>'charged'<>'false' THEN RAISE EXCEPTION 'ADS_DIFFERENT_VIEWER_CHARGED';END IF;
  END IF;
  UPDATE public.ads_credit_challenges_v1_1098
   SET issued_at=clock_timestamp()-interval '2 seconds' WHERE token=token;
  r:=public.ads_credit_confirm_v1_1098(token,viewer,1600,75,NULL);
  IF r->>'charged'<>'true' OR r->>'chargedCents'<>'2'
  THEN RAISE EXCEPTION 'ADS_ELIGIBLE_VIEW_NOT_CHARGED_ONCE';END IF;
  r:=public.ads_credit_confirm_v1_1098(token,viewer,1600,75,NULL);
  IF r->>'charged'<>'false' OR r->>'reason'<>'replay'
  THEN RAISE EXCEPTION 'ADS_SAME_TOKEN_CHARGED_TWICE';END IF;
  IF n=1 THEN
   r:=public.ads_credit_issue_v1_1098('São Gabriel','RS',viewer,NULL);
   IF r->'slot'<>'null'::jsonb THEN RAISE EXCEPTION 'ADS_24H_DEDUP_FAILED';END IF;
  END IF;
 END LOOP;
 SELECT balance_cents INTO balance FROM public.ads_credit_wallets_v1_1097
  WHERE owner_user_id=own;
 IF balance<>0 OR (SELECT total_spent_cents FROM public.ads_credit_wallets_v1_1097
 WHERE owner_user_id=own)<>6
 THEN RAISE EXCEPTION 'ADS_WALLET_OVERDRAFT_OR_WRONG_TOTAL';END IF;
 IF (SELECT status FROM public.ads_credit_campaigns_v1_1098 WHERE id=campaign)<>'paused'
 THEN RAISE EXCEPTION 'ADS_CAMPAIGN_DID_NOT_STOP_ON_EMPTY_WALLET';END IF;
 r:=public.ads_credit_issue_v1_1098('São Gabriel','RS',repeat('4',64),NULL);
 IF r->'slot'<>'null'::jsonb THEN RAISE EXCEPTION 'ADS_ZERO_BALANCE_DELIVERY';END IF;
 IF (SELECT count(*) FROM public.ads_credit_view_receipts_v1_1098
 WHERE campaign_id=campaign)<>3
 OR (SELECT count(*) FROM public.ads_credit_ledger_v1_1097
 WHERE owner_user_id=own AND operation='view')<>3
 OR (SELECT sum(delta_cents) FROM public.ads_credit_ledger_v1_1097
 WHERE owner_user_id=own AND operation='view')<>-6
 THEN RAISE EXCEPTION 'ADS_INVOICE_AND_LEDGER_NOT_IDENTICAL';END IF;
 RAISE NOTICE 'PASS: price, city, owner, early/invalid claims, three unique debits, replay, dedup, zero balance and automatic pause';
END;$commercial$;
ROLLBACK;
`);
const after=psql(`select (select count(*) from public.ads_credit_wallets_v1_1097)||
 ':'||(select count(*) from public.ads_credit_campaigns_v1_1098)||
 ':'||(select count(*) from public.ads_credit_view_receipts_v1_1098)||
 ':'||(select count(*) from public.ads_credit_ledger_v1_1097)`).trim();
assert.equal(after,before,'all synthetic records must be rolled back');
console.log('PASS V1.1105: commercial Ads ledger exact, safe view limits, zero overspend and ROLLBACK.');
