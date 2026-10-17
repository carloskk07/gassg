-- TAMÃO V1.399: historical SQL provenance checkpoint — read-only.
-- Execute as a privileged diagnostic query against Supabase.
-- NEVER infer from function presence that the original migration is safe to replay.
with historical(pr_number,version,legacy_filename,original_function,current_candidate) as (
  values
  (38, '20261003060000', 'pilot_assisted_activation_v1_44.sql',
    'admin_approve_pilot_application', 'admin_assisted_merchant_onboarding_v2'),
  (82, '20261005120500', 'pilot_rescue_boundary_reconciliation_v1_70_9.sql',
    'merchant_allowed_in_operation_mode', 'merchant_allowed_in_operation_mode'),
  (205, '20261011043000', 'delivery_first_payment_boundary_v1_158_1.sql',
    'merchant_delivery_payment_allowed', 'merchant_delivery_payment_allowed'),
  (207, '20261011063000', 'merchant_basket_compliance_v1_158_2.sql',
    'merchant_basket_compliance_current', 'merchant_basket_compliance_current'),
  (208, '20261011073000', 'settlement_daily_due_alignment_v1_158_3.sql',
    'merchant_settlement_daily_due_at', 'merchant_settlement_daily_due_at'),
  (209, '20261011083000', 'merchant_representation_authority_v1_158_4.sql',
    'admin_merchant_representation_action', 'admin_merchant_representation_action')
)
select h.pr_number,h.version,h.legacy_filename,h.original_function,h.current_candidate,
  exists (
    select 1 from supabase_migrations.schema_migrations m
    where m.version=h.version
  ) as migration_registered,
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=h.original_function
  ) as original_function_exists,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=h.current_candidate) as current_overloads,
  (select bool_or(has_function_privilege('anon',p.oid,'EXECUTE'))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=h.current_candidate) as current_anon_exec,
  (select bool_or(has_function_privilege('authenticated',p.oid,'EXECUTE'))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=h.current_candidate) as current_authenticated_exec,
  (select bool_and(has_function_privilege('service_role',p.oid,'EXECUTE'))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=h.current_candidate) as current_service_role_exec
from historical h order by h.pr_number;
