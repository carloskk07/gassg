-- TAMÃO V1.229.1 — restrict service-role attribution to INSERT/SELECT.
-- public schema default grants can leave UPDATE/DELETE/TRUNCATE available
-- even when anon/authenticated privileges are revoked.
-- First-touch inviter, CNPJ and lead evidence must be append-only.
revoke all on table public.growth_merchant_application_attributions_v1_229
  from service_role;
grant select,insert on table public.growth_merchant_application_attributions_v1_229
  to service_role;
do $check$
begin
  if has_table_privilege('anon',
      'public.growth_merchant_application_attributions_v1_229','SELECT')
     or has_table_privilege('authenticated',
      'public.growth_merchant_application_attributions_v1_229','INSERT')
     or not has_table_privilege('service_role',
      'public.growth_merchant_application_attributions_v1_229','SELECT')
     or not has_table_privilege('service_role',
      'public.growth_merchant_application_attributions_v1_229','INSERT')
     or has_table_privilege('service_role',
      'public.growth_merchant_application_attributions_v1_229','UPDATE')
     or has_table_privilege('service_role',
      'public.growth_merchant_application_attributions_v1_229','DELETE')
     or has_table_privilege('service_role',
      'public.growth_merchant_application_attributions_v1_229','TRUNCATE')
  then raise exception 'GROWTH_CNPJ_FIRST_TOUCH_ACL_DRIFT'
    using errcode='42501';
  end if;
end
$check$;
