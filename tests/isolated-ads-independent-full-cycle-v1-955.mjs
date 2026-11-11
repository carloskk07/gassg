import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

// A single, continuous proof of the existing independent paid-ad flow.
// NEVER connect to production: the isolated CI PostgreSQL fixture is mandatory.
// Provider approval and reversal below are synthetic facts in ROLLBACK, NOT money.
assert.equal(process.env.CI,'true');
for (const key of [
  'SUPABASE_ACCESS_TOKEN','SUPABASE_DB_PASSWORD','SUPABASE_SERVICE_ROLE_KEY',
  'MERCADOPAGO_ACCESS_TOKEN','ADS_MP_ACCESS_TOKEN'
]) assert.equal(process.env[key]||'','', 'No commercial credentials in disposable tests');
const query=sql=>execFileSync('psql',[
  '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
  '--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet',
  '--command='+sql
],{
  encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},
  timeout:120000,stdio:['ignore','pipe','pipe']
}).trim();
assert.equal(query('select current_database()'),'postgres');
const tables=[
  'ads_independent_campaigns_v1_884','ads_independent_checkouts_v1_886',
  'ads_independent_payment_events_v1_886','ads_independent_challenges_v1_884',
  'ads_independent_view_signals_v1_884','ads_independent_refund_cases_v1_887',
  'ads_independent_refund_executions_v1_888'
];
const before=query('SELECT '+tables.map(t=>'(SELECT count(*) FROM public.'+t+')').join('||\':\'||'));
const txn=`BEGIN;
DO $v955$
DECLARE
  v_admin uuid;v_campaign uuid;v_case uuid;
  v_reply jsonb;v_paid jsonb;v_check jsonb;
  v_ref text;v_challenge uuid;v_version integer;
  v_key text;v_rejected boolean;v_error text;v_count integer;
BEGIN
  SELECT user_id INTO v_admin FROM public.platform_admins
    WHERE active AND admin_role='superadmin' LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'V955_ADMIN_FIXTURE_MISSING'; END IF;
  UPDATE auth.users SET email_confirmed_at=clock_timestamp(),is_anonymous=false
    WHERE id=v_admin;
  UPDATE public.merchants SET online=false;
  IF (SELECT sales_enabled FROM public.ads_independent_sales_controls_v1_886 WHERE singleton)
    OR (SELECT delivery_enabled FROM public.ads_independent_controls_v1_884 WHERE singleton)
    OR (SELECT billing_enabled FROM public.ads_independent_controls_v1_884 WHERE singleton)
  THEN RAISE EXCEPTION 'V955_UNSAFE_INITIAL_FLAGS'; END IF;

  -- Actual stored procedures. An advertiser can submit without any live revenda.
  v_reply:=public.ads_independent_submit_v1_884(
    v_admin,gen_random_uuid(),'Anunciante independente',
    'Campanha regional de teste isolado',
    'Criativo seguro com preço fixo, vigência e cancelamento.',
    'São Gabriel','RS','https://example.com/promocao',1990,7);
  v_campaign:=(v_reply->>'campaignId')::uuid;
  IF v_campaign IS NULL OR v_reply->>'paymentCreated'<>'false'
  THEN RAISE EXCEPTION 'V955_PUBLIC_SUBMIT'; END IF;
  PERFORM public.admin_ads_independent_action_v1_884(
    v_admin,'approve',v_campaign,1,'Análise isolada do criativo');

  v_rejected:=false;
  BEGIN
    PERFORM public.ads_independent_checkout_reserve_v1_886(
      v_admin,v_campaign,gen_random_uuid());
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected:=true; END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'V955_PREAPPROVAL_CHARGE'; END IF;

  SELECT version INTO v_version FROM public.ads_independent_sales_controls_v1_886
    WHERE singleton;
  v_reply:=public.admin_ads_independent_homologation_v1_892(
    v_admin,v_campaign,true,v_version,
    'Teste local restrito a uma campanha e sem credenciais externas','HOMOLOGAR');
  IF v_reply->>'homologationAuthorized'<>'true'
    OR v_reply->>'salesEnabled'<>'false'
  THEN RAISE EXCEPTION 'V955_HOMOLOGATION_SCOPE'; END IF;

  v_reply:=public.ads_independent_checkout_reserve_v1_886(
    v_admin,v_campaign,gen_random_uuid());
  IF v_reply->>'created'<>'true' OR v_reply->>'amountCents'<>'1990'
  THEN RAISE EXCEPTION 'V955_RESERVE'; END IF;
  v_ref:=v_reply->>'externalReference';
  v_check:=public.ads_independent_checkout_reserve_v1_886(
    v_admin,v_campaign,gen_random_uuid());
  IF v_check->>'created'<>'false'
    OR v_check->>'externalReference'<>v_ref
  THEN RAISE EXCEPTION 'V955_DUPLICATE_CHECKOUT'; END IF;
  v_reply:=public.ads_independent_checkout_attach_v1_886(
    v_campaign,v_ref,'pref-v955-test',
    'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-v955-test');
  IF v_reply->>'status'<>'checkout_ready'
  THEN RAISE EXCEPTION 'V955_CHECKOUT_LINK'; END IF;

  -- Invalid/sandbox payment cannot publish or be accepted.
  v_rejected:=false;
  BEGIN
    PERFORM public.ads_independent_payment_fact_v1_886(
      repeat('1',64),v_ref,'955001','955002',1990,'BRL',
      'approved','accredited',false);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected:=true; END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'V955_SANDBOX_LAUNDERED'; END IF;
  v_rejected:=false;
  BEGIN
    PERFORM public.ads_independent_payment_fact_v1_886(
      repeat('2',64),v_ref,'955001','955002',1991,'BRL',
      'approved','accredited',true);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected:=true; END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'V955_BAD_PRICE_ACCEPTED'; END IF;

  -- Synthetic PSP facts allowed ONLY here to prove server state transitions.
  v_paid:=public.ads_independent_payment_fact_v1_886(
    repeat('3',64),v_ref,'955001','955002',1990,'BRL',
    'approved','accredited',true);
  IF v_paid->>'paymentApproved'<>'true'
    OR v_paid->>'autoPublished'<>'false'
    OR v_paid->>'netSettlementVerified'<>'false'
  THEN RAISE EXCEPTION 'V955_FALSE_FINANCIAL_SETTLEMENT'; END IF;
  v_check:=public.ads_independent_payment_fact_v1_886(
    repeat('3',64),v_ref,'955001','955002',1990,'BRL',
    'approved','accredited',true);
  IF v_check->>'recorded'<>'false'
  THEN RAISE EXCEPTION 'V955_DOUBLE_PAYMENT'; END IF;

  PERFORM public.admin_ads_independent_action_v1_884(
    v_admin,'enable_delivery',null,null,'Entrega apenas em ROLLBACK');
  v_reply:=public.admin_ads_independent_action_v1_884(
    v_admin,'publish',v_campaign,2,'Criativo aprovado e pagamento sintético reconciliado');
  IF v_reply->>'status'<>'active'
  THEN RAISE EXCEPTION 'V955_PAID_PUBLICATION'; END IF;

  -- Viewability is a deduplicated diagnostic, never billed CPM revenue.
  v_reply:=public.ads_independent_issue_v1_884(
    'São Gabriel','RS',repeat('e',64));
  v_challenge:=(v_reply->'slot'->>'challenge')::uuid;
  IF v_challenge IS NULL OR v_reply->>'billingEnabled'<>'false'
  THEN RAISE EXCEPTION 'V955_NOT_DELIVERED'; END IF;
  UPDATE public.ads_independent_challenges_v1_884
    SET issued_at=clock_timestamp()-interval '2 seconds'
    WHERE token=v_challenge;
  v_reply:=public.ads_independent_confirm_v1_884(
    v_challenge,repeat('e',64),1500,60);
  IF v_reply->>'countedForDiagnostics'<>'true'
    OR v_reply->>'billable'<>'false'
  THEN RAISE EXCEPTION 'V955_VIEWABILITY'; END IF;
  v_reply:=public.ads_independent_confirm_v1_884(
    v_challenge,repeat('e',64),1500,60);
  IF v_reply->>'countedForDiagnostics'<>'false'
  THEN RAISE EXCEPTION 'V955_REPLAYED_IMPRESSION'; END IF;
  IF EXISTS(SELECT 1 FROM public.ads_independent_view_signals_v1_884
    WHERE campaign_id=v_campaign AND billable)
  THEN RAISE EXCEPTION 'V955_CPM_REVENUE_INVENTED'; END IF;

  -- Buyer cancellation freezes the live placement and creates one refund case.
  v_reply:=public.ads_independent_refund_request_v1_887(
    v_admin,v_campaign,gen_random_uuid(),'Cancelamento do anúncio de teste');
  v_case:=(v_reply->>'caseId')::uuid;
  IF v_case IS NULL OR v_reply->>'refundIssued'<>'false'
    OR (SELECT status FROM public.ads_independent_campaigns_v1_884
        WHERE id=v_campaign)<>'paused'
  THEN RAISE EXCEPTION 'V955_REFUND_NOT_PAUSED'; END IF;
  IF (public.ads_independent_issue_v1_884(
    'São Gabriel','RS',repeat('f',64))->'slot')<>'null'::jsonb
  THEN RAISE EXCEPTION 'V955_REFUND_STILL_SERVING'; END IF;
  v_reply:=public.ads_independent_refund_request_v1_887(
    v_admin,v_campaign,gen_random_uuid(),'Repetição idempotente');
  IF v_reply->>'replayed'<>'true'
    OR (v_reply->>'caseId')::uuid<>v_case
  THEN RAISE EXCEPTION 'V955_REFUND_DUPLICATED'; END IF;

  v_reply:=public.admin_ads_independent_refund_action_v1_887(
    v_admin,v_case,1,'review','Analisar pedido sem movimentação');
  IF v_reply->>'status'<>'reviewing'
  THEN RAISE EXCEPTION 'V955_REVIEW'; END IF;
  v_reply:=public.admin_ads_independent_refund_execution_v1_888(
    v_admin,v_case,2,'execute','Reservar solicitação única do PSP');
  v_key:=v_reply->>'idempotencyKey';
  IF v_reply->>'created'<>'true' OR v_reply->>'moneyMoved'<>'false'
    OR v_key NOT LIKE 'tamao-ads-ind-refund-%'
  THEN RAISE EXCEPTION 'V955_REFUND_TRANSFER_INVENTED'; END IF;
  v_check:=public.admin_ads_independent_refund_execution_v1_888(
    v_admin,v_case,2,'execute','Repetição da reserva de estorno');
  IF v_check->>'created'<>'false' OR v_check->>'idempotencyKey'<>v_key
  THEN RAISE EXCEPTION 'V955_DOUBLE_REFUND'; END IF;
  v_rejected:=false;
  BEGIN
    PERFORM public.admin_ads_independent_refund_execution_complete_v1_888(
      v_admin,v_case,2);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected:=true; END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'V955_FALSE_REFUND_COMPLETION'; END IF;

  PERFORM public.ads_independent_payment_fact_v1_886(
    repeat('4',64),v_ref,'955001','955002',1990,'BRL','refunded','refunded',true);
  v_reply:=public.admin_ads_independent_refund_action_v1_887(
    v_admin,v_case,2,'record_provider_reversal',
    'Reversão fictícia somente no banco descartável');
  IF v_reply->>'status'<>'provider_reversed'
    OR v_reply->>'moneyMoved'<>'false'
  THEN RAISE EXCEPTION 'V955_REAL_BANK_REFUND_FABRICATED'; END IF;
  v_version:=(v_reply->>'version')::integer;
  v_reply:=public.admin_ads_independent_refund_execution_complete_v1_888(
    v_admin,v_case,v_version);
  IF v_reply->>'recorded'<>'true'
    OR v_reply->>'moneyMoved'<>'false'
  THEN RAISE EXCEPTION 'V955_REFUND_AUDIT_MISSING'; END IF;
  IF (SELECT count(*) FROM public.ads_independent_refund_executions_v1_888
      WHERE case_id=v_case)<>1
  THEN RAISE EXCEPTION 'V955_DUPLICATE_PROVIDER_REFUND'; END IF;
  IF EXISTS(SELECT 1 FROM public.ads_independent_campaigns_v1_884
      WHERE id=v_campaign AND status='active')
  THEN RAISE EXCEPTION 'V955_REVERSED_CAMPAIGN_ACTIVE'; END IF;
  IF has_function_privilege('authenticated',
    'public.ads_independent_payment_fact_v1_886(text,text,text,text,integer,text,text,text,boolean)','EXECUTE')
  THEN RAISE EXCEPTION 'V955_UNAUTHORIZED_PSP_WRITER'; END IF;
END;
$v955$;
ROLLBACK;`;
query(txn);
const after=query('SELECT '+tables.map(t=>'(SELECT count(*) FROM public.'+t+')').join('||\':\'||'));
assert.equal(after,before,'Disposable paid-ad lifecycle must not persist synthetic data');
console.log('V1.955 PASS — advertiser -> approval -> one checkout -> synthetic PSP paid -> published/viewed -> cancellation -> one synthetic PSP reversal; ROLLBACK/zero commercial money.');
