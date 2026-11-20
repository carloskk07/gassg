-- TAMÃO V1.1087 — read-only aggregated regional prices for visitors.
-- Public browsing must not create an anonymous Auth identity. This is the
-- EXISTING city-wide estimate RPC: no CEP-specific quotation, order, wallet,
-- merchant identity, or customer data are returned.
-- Fail closed if the reviewed SECURITY DEFINER / search_path contract drifts.
do $guard$
declare
  v_def text;
  v_is_definer boolean;
  v_search_path text[];
begin
  select pg_get_functiondef(p.oid), p.prosecdef, p.proconfig
    into v_def, v_is_definer, v_search_path
  from pg_proc p
  where p.oid=to_regprocedure('public.public_city_price_board_v1_341(text,text)');
  if v_def is null
    or v_is_definer is distinct from true
    or not ('search_path=pg_catalog'=any(v_search_path))
    or position('market_city_offer_scope' in v_def)=0
    or position('merchant_basket_compliance_current' in v_def)=0
    or position('notAQuote' in v_def)=0
    or position('jsonb_build_object' in v_def)=0 then
    raise exception 'TAMAO_GUEST_CITY_BOARD_CONTRACT_DRIFT';
  end if;
end;
$guard$;

-- No table SELECT or write grants. No access to get-offers or create-order.
revoke all on function public.public_city_price_board_v1_341(text,text) from public;
grant execute on function public.public_city_price_board_v1_341(text,text) to anon;

do $proof$
begin
  if not has_function_privilege('anon',
    'public.public_city_price_board_v1_341(text,text)','EXECUTE')
    or not has_function_privilege('authenticated',
    'public.public_city_price_board_v1_341(text,text)','EXECUTE')
    or not has_function_privilege('service_role',
    'public.public_city_price_board_v1_341(text,text)','EXECUTE') then
    raise exception 'TAMAO_GUEST_CITY_BOARD_ACL_PROOF_FAILED';
  end if;
end;
$proof$;
