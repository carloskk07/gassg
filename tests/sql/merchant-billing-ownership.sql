\set ON_ERROR_STOP on
begin;
do $test$
declare actor uuid; before_actions bigint; before_charges bigint;
begin
 select count(*) into before_actions from public.action_requests;
 select count(*) into before_charges from public.merchant_billing_provider_charges;
 foreach actor in array array[null::uuid,gen_random_uuid()] loop
  begin
   perform public.merchant_billing_pix_charge_prepare_provider(
    actor,gen_random_uuid(),'credit_01990',null,null,'mercadopago',
    'isolated-owner-denial-'||gen_random_uuid()::text,repeat('a',64));
   raise exception 'missing membership was accepted';
  exception when insufficient_privilege then
   if sqlerrm<>'MERCHANT_FINANCE_PERMISSION_DENIED' then raise;end if;
  end;
 end loop;
 if before_actions<>(select count(*) from public.action_requests)
  or before_charges<>(select count(*) from public.merchant_billing_provider_charges) then
  raise exception 'denied actor left a financial reservation';
 end if;
 if has_function_privilege('anon',
  'public.merchant_billing_pix_charge_prepare_provider(uuid,uuid,text,uuid,uuid,text,text,text)','execute')
  or has_function_privilege('authenticated',
  'public.merchant_billing_pix_charge_prepare_provider(uuid,uuid,text,uuid,uuid,text,text,text)','execute') then
  raise exception 'provider prepare was exposed to browser roles';
 end if;
end $test$;
rollback;
\echo 'PASS: null and foreign billing actors denied before reservations, preserved private RPC ACL.'
