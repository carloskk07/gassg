-- TAMÃO: keep merchant-wide ANP gate as strict as per-basket enforcement.
-- Covers active regulated GLP, empty cylinders and registered regulated classes.
-- Merchant identity, statuses, dates, billing and public city authority unchanged.
CREATE OR REPLACE FUNCTION public.merchant_anp_compliance_current(p_merchant_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_has_glp boolean:=false;
begin
  select exists(
    select 1
    from public.catalog_items ci
    left join public.product_delivery_profiles p
      on p.product_code=upper(trim(ci.product_code)) and p.active
    where ci.merchant_id=p_merchant_id
      and ci.active
      and (
        public.is_glp_product_code(ci.product_code)
        or public.is_glp_container_product_code(ci.product_code)
        or coalesce(p.delivery_class in ('regulated_glp','regulated_glp_container'),false)
      )
  )
  into v_has_glp;

  if not v_has_glp then
    return true;
  end if;

  return public.merchant_anp_verification_current(p_merchant_id);
end;
$function$;

-- Preserve the original service-only RPC boundary.
revoke all on function public.merchant_anp_compliance_current(uuid) from public,anon,authenticated;
grant execute on function public.merchant_anp_compliance_current(uuid) to service_role;
