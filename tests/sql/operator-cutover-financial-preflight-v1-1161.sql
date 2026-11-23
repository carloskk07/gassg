-- V1.1161 — verifying financial-preflight ACL and fail-closed activation.
-- Disposable PostgreSQL integration; read-only checks, no synthetic payment.
begin;
do $test$
declare
  v_message text;
  fn text:=pg_get_functiondef('public.platform_operator_financial_preflight_v1_1161(uuid)'::regprocedure);
  cutover text:=pg_get_functiondef('public.platform_operator_transition_activate_v1_1159(uuid,bigint,text)'::regprocedure);
begin
  if has_function_privilege('anon',
       'public.platform_operator_financial_preflight_v1_1161(uuid)','EXECUTE')
    or has_function_privilege('authenticated',
       'public.platform_operator_financial_preflight_v1_1161(uuid)','EXECUTE')
    or not has_function_privilege('service_role',
       'public.platform_operator_financial_preflight_v1_1161(uuid)','EXECUTE')
  then raise exception 'V1161_PRIVATE_FINANCE_PREFLIGHT_EXPOSED';end if;
  if fn not like '%platform_operator_transition_assert_owner_v1_1159%'
    or fn not like '%network_manual_payout_requests_v1_1034%'
    or fn not like '%network_payout_jobs_v1_1033%'
    or fn not like '%network_fee_payout_reservations_v1_1031%'
    or fn not like '%ads_independent_refund_cases_v1_887%'
    or fn not like '%clube_coupon_refund_requests_v1_814%'
    or fn not like '%agenda_payment_refunds%'
    or fn not like '%merchant_billing_payment_refunds%'
    or fn not like '%externalReconciliationVerified%'
    or fn not like '%moneyMoved%'
  then raise exception 'V1161_INCOMPLETE_FINANCIAL_PREFLIGHT';end if;
  if cutover not like '%OPERATOR_TRANSITION_FINANCIAL_ITEMS_OPEN%'
    or cutover not like '%platform_operator_financial_preflight_v1_1161%'
    or cutover not like '%OPERATOR_TRANSITION_MANUAL_PAYOUTS_OPEN%'
    or cutover not like '%CONFIRMO ATIVACAO PJ%'
  then raise exception 'V1161_ACTIVATION_NOT_GUARDED';end if;
  begin
    perform public.platform_operator_financial_preflight_v1_1161(null);
    raise exception 'V1161_MISSING_SUPERADMIN_CHECK';
  exception when others then
    get stacked diagnostics v_message=message_text;
    if v_message is distinct from 'OPERATOR_TRANSITION_SUPERADMIN_REQUIRED'
    then raise exception 'V1161_UNEXPECTED_OWNER_RESULT: %',v_message;end if;
  end;
  if exists(select 1 from public.platform_operator_transition_v1_1159
    where singleton and (stage<>'not_started' or entity_kind<>'individual'
       or candidate_cnpj is not null or activated_at is not null))
  then raise exception 'V1161_COMPANY_SYNTHETICALLY_ACTIVATED';end if;
end $test$;
rollback;
