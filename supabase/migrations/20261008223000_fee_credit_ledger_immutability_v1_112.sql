-- TAMÃO — Fee-credit ledger immutability v1.112
-- The merchant fee-credit ledger is an append-only financial fact log.
-- Business facts cannot be updated, deleted or truncated after insertion.
-- Only technical provenance redaction is allowed:
--   order_id   -> NULL (order retention / FK ON DELETE SET NULL)
--   created_by -> NULL (auth user deletion / FK ON DELETE SET NULL)
-- Merchant deletion may cascade ledger rows only as part of the parent delete.

create or replace function public.guard_merchant_fee_credit_ledger_immutable()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $function$
begin
  if tg_op='TRUNCATE' then
    raise exception 'MERCHANT_FEE_CREDIT_LEDGER_TRUNCATE_FORBIDDEN'
      using errcode='23514';
  end if;

  if tg_op='DELETE' then
    -- Preserve the existing merchant FK ON DELETE CASCADE contract, while
    -- rejecting standalone deletion of a financial fact.
    if pg_catalog.pg_trigger_depth()>1
       and not exists(
         select 1
         from public.merchants m
         where m.id=old.merchant_id
       ) then
      return old;
    end if;

    raise exception 'MERCHANT_FEE_CREDIT_LEDGER_DELETE_FORBIDDEN:%',
      old.id
      using errcode='23514';
  end if;

  if tg_op='UPDATE' then
    if new.id is distinct from old.id
       or new.merchant_id is distinct from old.merchant_id
       or new.entry_type is distinct from old.entry_type
       or new.amount_cents is distinct from old.amount_cents
       or new.plan_key is distinct from old.plan_key
       or new.reference is distinct from old.reference
       or new.payment_request_id is distinct from old.payment_request_id
       or new.created_at is distinct from old.created_at then
      raise exception 'MERCHANT_FEE_CREDIT_LEDGER_FACT_IMMUTABLE:%',
        old.id
        using errcode='23514';
    end if;

    if new.order_id is distinct from old.order_id
       and not (old.order_id is not null and new.order_id is null) then
      raise exception 'MERCHANT_FEE_CREDIT_LEDGER_ORDER_LINK_IMMUTABLE:%',
        old.id
        using errcode='23514';
    end if;

    if new.created_by is distinct from old.created_by
       and not (old.created_by is not null and new.created_by is null) then
      raise exception 'MERCHANT_FEE_CREDIT_LEDGER_ACTOR_LINK_IMMUTABLE:%',
        old.id
        using errcode='23514';
    end if;

    return new;
  end if;

  return new;
end;
$function$;

revoke all on function public.guard_merchant_fee_credit_ledger_immutable()
from public,anon,authenticated;
grant execute on function public.guard_merchant_fee_credit_ledger_immutable()
to postgres,service_role;

drop trigger if exists guard_merchant_fee_credit_ledger_update_delete_trg
on public.merchant_fee_credit_ledger;
create trigger guard_merchant_fee_credit_ledger_update_delete_trg
before update or delete
on public.merchant_fee_credit_ledger
for each row execute function public.guard_merchant_fee_credit_ledger_immutable();

drop trigger if exists guard_merchant_fee_credit_ledger_truncate_trg
on public.merchant_fee_credit_ledger;
create trigger guard_merchant_fee_credit_ledger_truncate_trg
before truncate
on public.merchant_fee_credit_ledger
for each statement execute function public.guard_merchant_fee_credit_ledger_immutable();

-- The service role only needs to append/read this ledger. Financial updates
-- are performed as append-only facts through privileged database authorities.
revoke all on table public.merchant_fee_credit_ledger
from public,anon,authenticated,service_role;
grant select,insert on table public.merchant_fee_credit_ledger
to service_role;

-- Fail closed if an unexpected browser grant survives from an older schema.
do $function$
begin
  if has_table_privilege('anon','public.merchant_fee_credit_ledger','SELECT')
     or has_table_privilege('anon','public.merchant_fee_credit_ledger','INSERT')
     or has_table_privilege('anon','public.merchant_fee_credit_ledger','UPDATE')
     or has_table_privilege('anon','public.merchant_fee_credit_ledger','DELETE')
     or has_table_privilege('authenticated','public.merchant_fee_credit_ledger','SELECT')
     or has_table_privilege('authenticated','public.merchant_fee_credit_ledger','INSERT')
     or has_table_privilege('authenticated','public.merchant_fee_credit_ledger','UPDATE')
     or has_table_privilege('authenticated','public.merchant_fee_credit_ledger','DELETE') then
    raise exception 'MERCHANT_FEE_CREDIT_LEDGER_BROWSER_GRANT_DRIFT'
      using errcode='42501';
  end if;

  if not has_table_privilege(
       'service_role','public.merchant_fee_credit_ledger','SELECT'
     )
     or not has_table_privilege(
       'service_role','public.merchant_fee_credit_ledger','INSERT'
     )
     or has_table_privilege(
       'service_role','public.merchant_fee_credit_ledger','UPDATE'
     )
     or has_table_privilege(
       'service_role','public.merchant_fee_credit_ledger','DELETE'
     )
     or has_table_privilege(
       'service_role','public.merchant_fee_credit_ledger','TRUNCATE'
     ) then
    raise exception 'MERCHANT_FEE_CREDIT_LEDGER_SERVICE_ROLE_ACL_DRIFT'
      using errcode='42501';
  end if;
end;
$function$;
