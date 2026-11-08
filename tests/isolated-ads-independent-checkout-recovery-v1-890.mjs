import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.CI,'true');
for(const name of ['SUPABASE_ACCESS_TOKEN','SUPABASE_DB_PASSWORD',
 'SUPABASE_SERVICE_ROLE_KEY','ADS_MP_ACCESS_TOKEN','MERCADOPAGO_ACCESS_TOKEN'])
 assert.equal(process.env[name]||'','');
const sql=q=>execFileSync('psql',['--host=127.0.0.1','--port=54322',
 '--username=postgres','--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1',
 '--tuples-only','--no-align','--quiet','--command='+q],{
  encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},timeout:120000
 }).trim();
const original=sql('select count(*) from public.ads_independent_checkouts_v1_886');
sql(BEGIN;
DO $test$
DECLARE
 v_owner uuid;v_campaign uuid;v_request uuid;v_reference text;
 v_one jsonb;v_two jsonb;v_attached jsonb;
 v_expiry timestamptz;
BEGIN
 SELECT user_id INTO v_owner FROM public.platform_admins
 WHERE active AND admin_role='superadmin' LIMIT 1;
 IF v_owner IS NULL THEN RAISE EXCEPTION 'V890_OWNER_MISSING';END IF;
 UPDATE auth.users SET email_confirmed_at=clock_timestamp(),is_anonymous=false WHERE id=v_owner;
 v_one:=public.ads_independent_submit_v1_884(v_owner,gen_random_uuid(),
  'Anunciante sem fornecedor','Publicidade independente durante uma semana',
  'Exibição local com preço fixo e nenhum faturamento por CPM.',
  'São Gabriel','RS','https://example.com/ad',1990,7);
 v_campaign:=(v_one->>'campaignId')::uuid;
 PERFORM public.admin_ads_independent_action_v1_884(v_owner,'approve',v_campaign,1,
  'Aprovar campanha apenas no banco descartável');
 PERFORM public.admin_ads_independent_sales_toggle_v1_886(v_owner,true,1,
  'Ativar somente o teste de cobrança no banco descartável');
 v_request:=gen_random_uuid();
 v_one:=public.ads_independent_checkout_reserve_v1_886(v_owner,v_campaign,v_request);
 IF v_one->>'created'<>'true' OR v_one->>'status'<>'reserved'
 THEN RAISE EXCEPTION 'V890_RESERVATION_NOT_CREATED';END IF;
 v_reference:=v_one->>'externalReference';
 v_expiry:=(v_one->>'expiresAt')::timestamptz;
 IF v_expiry<clock_timestamp()+interval '71 hours'
   OR v_expiry>clock_timestamp()+interval '73 hours'
 THEN RAISE EXCEPTION 'V890_72H_EXPIRY_MISMATCH';END IF;
 v_two:=public.ads_independent_checkout_reserve_v1_886(v_owner,v_campaign,gen_random_uuid());
 IF v_two->>'created'<>'false' OR v_two->>'status'<>'reserved'
   OR (v_two->>'expiresAt')::timestamptz IS DISTINCT FROM v_expiry
   OR v_two->>'externalReference'<>v_reference
 THEN RAISE EXCEPTION 'V890_RETRY_CHANGED_RESERVATION';END IF;
 IF (SELECT count(*) FROM public.ads_independent_checkouts_v1_886
  WHERE campaign_id=v_campaign)<>1
 THEN RAISE EXCEPTION 'V890_DOUBLE_CHECKOUT_ROW';END IF;
 v_attached:=public.ads_independent_checkout_attach_v1_886(
  v_campaign,v_reference,'pref-recovered-12345',
  'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-recovered-12345');
 IF v_attached->>'status'<>'checkout_ready'
 THEN RAISE EXCEPTION 'V890_RECOVER_ATTACH_FAILED';END IF;
 v_two:=public.ads_independent_checkout_reserve_v1_886(v_owner,v_campaign,gen_random_uuid());
 IF v_two->>'status'<>'checkout_ready' OR v_two->>'created'<>'false'
   OR (v_two->>'expiresAt')::timestamptz IS DISTINCT FROM v_expiry
   OR v_two->>'checkoutUrl' NOT LIKE 'https://www.mercadopago.com.br/%'
 THEN RAISE EXCEPTION 'V890_RECOVERY_NOT_READABLE';END IF;
 IF has_function_privilege('authenticated',
  'public.ads_independent_checkout_reserve_v1_886(uuid,uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'V890_RESERVATION_PUBLIC_LEAK';END IF;
 IF (SELECT billing_enabled FROM public.ads_independent_controls_v1_884 WHERE singleton)
 THEN RAISE EXCEPTION 'V890_CPM_CHARGE_WRONGLY_ENABLED';END IF;
END;
$test$;
ROLLBACK;);
assert.equal(sql('select count(*) from public.ads_independent_checkouts_v1_886'),original);
console.log('V1.890 PASS: 72h server TTL, exact retry identity, single recovery, rollback.');
