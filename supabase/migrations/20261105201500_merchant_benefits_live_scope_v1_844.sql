-- TAMÃO #844: comunicação da capacidade efetivamente implantada na #843.
-- NÃO altera termos aceitos, adesões, pedidos, taxas, cupons, saldo ou comércio.
-- Os dois campos legados genéricos continuam false: não liberar TODOS os benefícios.
-- Somente o presente de boas-vindas de R$1 em PRODUTOS está implementado,
-- com Flex 8% exclusivamente quando o desconto for aplicado e conciliado.
-- Os cupons pagos e o cashback pré-existente conservam o fluxo de ressarcimento.
DO $guard$
BEGIN
 IF pg_catalog.to_regclass('public.merchant_welcome_order_uses_v1_843') IS NULL
    OR pg_catalog.to_regprocedure('public.create_product_welcome_order_v1_843(uuid,uuid,text,text,text,text,integer,text,text,text,text)') IS NULL
 THEN RAISE EXCEPTION 'PARTNER_WELCOME_IMPLEMENTATION_REQUIRED' USING ERRCODE='P0001'; END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.merchant_benefits_contract_v1_842(
 p_actor uuid,p_merchant uuid,p_operation text,
 p_terms_version integer default null,
 p_expected_version integer default null,
 p_request_id uuid default null,
 p_consent boolean default false
) returns jsonb language plpgsql security definer set search_path=pg_catalog
as $func$
declare
 v_role text;
 v_plan text;
 v_terms public.merchant_benefit_terms_v1_842%rowtype;
 v_state public.merchant_benefit_participations_v1_842%rowtype;
 v_previous public.merchant_benefit_events_v1_842%rowtype;
 v_current_version integer:=0;
 v_replayed boolean:=false;
begin
 if p_actor is null or p_merchant is null or (p_operation is null or p_operation not in ('view','accept','revoke'))
    or not exists(select 1 from auth.users u where u.id=p_actor and u.is_anonymous=false)
 then raise exception 'MERCHANT_BENEFIT_INVALID_REQUEST' using errcode='22023';end if;
 select mm.member_role into v_role from public.merchant_members mm
 where mm.merchant_id=p_merchant and mm.user_id=p_actor and mm.active=true;
 if v_role not in ('owner','manager') or v_role is null
 then raise exception 'MERCHANT_BENEFIT_ACCESS_DENIED' using errcode='42501'; end if;
 select * into v_terms from public.merchant_benefit_terms_v1_842
 where terms_version=1 and enabled=true;
 if not found then raise exception 'MERCHANT_BENEFIT_TERMS_UNAVAILABLE' using errcode='42501';end if;
 if (select platform_fee_bps from public.merchant_billing_plans
      where plan_key='flex_daily' and active) is distinct from v_terms.flex_standard_fee_bps
 then raise exception 'MERCHANT_BENEFIT_FLEX_RATE_CHANGED' using errcode='40001';end if;
 select a.plan_key into v_plan from public.merchant_billing_accounts a
 where a.merchant_id=p_merchant;
 v_plan:=coalesce(v_plan,'flex_daily');
 if p_operation='view' then
   select * into v_state from public.merchant_benefit_participations_v1_842
    where merchant_id=p_merchant;
 else
   if v_role<>'owner' then
     raise exception 'MERCHANT_BENEFIT_OWNER_REQUIRED' using errcode='42501';end if;
   if p_terms_version is distinct from v_terms.terms_version
      or p_expected_version is null or p_expected_version not between 0 and 2147483600
      or p_request_id is null
      or (p_operation='accept' and p_consent is distinct from true)
   then raise exception 'MERCHANT_BENEFIT_ACCEPTANCE_INVALID' using errcode='22023';end if;
   -- A mesma revenda serializa duas abas e o uso concorrente do mesmo request_id.
   perform 1 from public.merchants where id=p_merchant for update;
   if not found then raise exception 'MERCHANT_BENEFIT_NOT_FOUND' using errcode='P0002';end if;
   select * into v_state from public.merchant_benefit_participations_v1_842
    where merchant_id=p_merchant for update;
   v_current_version:=coalesce(v_state.version,0);
   select * into v_previous from public.merchant_benefit_events_v1_842
    where request_id=p_request_id;
   if found then
     if v_previous.merchant_id<>p_merchant
       or v_previous.actor_user_id<>p_actor
       or v_previous.operation<>p_operation
       or v_previous.terms_version<>p_terms_version
       or v_previous.contract_version<>v_current_version
       or v_state.opted_in is distinct from (p_operation='accept')
     then raise exception 'MERCHANT_BENEFIT_REPLAY_CONFLICT' using errcode='23505';end if;
     v_replayed:=true;
   else
     if p_expected_version<>v_current_version
     then raise exception 'MERCHANT_BENEFIT_VERSION_STALE' using errcode='40001';end if;
     if (p_operation='accept' and coalesce(v_state.opted_in,false))
       or (p_operation='revoke' and not coalesce(v_state.opted_in,false))
     then raise exception 'MERCHANT_BENEFIT_STATE_CONFLICT' using errcode='40001';end if;
     if p_operation='accept' then
       insert into public.merchant_benefit_participations_v1_842(
         merchant_id,opted_in,terms_version,accepted_by,accepted_at,revoked_at,version)
       values(p_merchant,true,v_terms.terms_version,p_actor,clock_timestamp(),null,1)
       on conflict(merchant_id) do update set
         opted_in=true,terms_version=excluded.terms_version,
         accepted_by=excluded.accepted_by,accepted_at=excluded.accepted_at,
         revoked_at=null,version=public.merchant_benefit_participations_v1_842.version+1,
         updated_at=clock_timestamp()
       returning * into v_state;
     else
       update public.merchant_benefit_participations_v1_842
       set opted_in=false,revoked_at=clock_timestamp(),version=version+1,
           updated_at=clock_timestamp()
       where merchant_id=p_merchant returning * into v_state;
     end if;
     insert into public.merchant_benefit_events_v1_842(
       request_id,merchant_id,actor_user_id,operation,terms_version,
       contract_version,flex_standard_fee_bps,flex_benefit_fee_bps,
       max_welcome_discount_cents,terms_text_snapshot)
     values(p_request_id,p_merchant,p_actor,p_operation,v_terms.terms_version,
       v_state.version,v_terms.flex_standard_fee_bps,v_terms.flex_benefit_fee_bps,
       v_terms.max_welcome_discount_cents,v_terms.terms_text);
   end if;
 end if;
 return jsonb_build_object(
  'source','merchant_benefits_contract_v1_842','merchantId',p_merchant,
  'readOnly',p_operation='view','replayed',v_replayed,
  'optedIn',coalesce(v_state.opted_in,false),
  'version',coalesce(v_state.version,0),
  'termsVersion',v_terms.terms_version,
  'termsText',v_terms.terms_text,
  'normalFlexFeeBps',v_terms.flex_standard_fee_bps,
  'memberFlexFeeBps',v_terms.flex_benefit_fee_bps,
  'maxWelcomeDiscountCents',v_terms.max_welcome_discount_cents,
  'acceptedAt',v_state.accepted_at,'revokedAt',v_state.revoked_at,
  'currentPlanKey',v_plan,
  'checkoutBenefitsEnabled',false,
  'feeReductionEnabled',false,
  'noCurrentFinancialMutation',true,
  'productWelcomeCheckoutEnabled',true,
  'productWelcomeFeeReductionEnabled',true,
  'productWelcomeOnlyWhenApplied',true,
  'partnerFundedPaidCouponsEnabled',false,
  'partnerFundedOtherCashbackEnabled',false,
  'legacyCouponRightsPreserved',true);
end;
$func$;
revoke all on function public.merchant_benefits_contract_v1_842(
 uuid,uuid,text,integer,integer,uuid,boolean) from public,anon,authenticated;
grant execute on function public.merchant_benefits_contract_v1_842(
 uuid,uuid,text,integer,integer,uuid,boolean) to service_role;
