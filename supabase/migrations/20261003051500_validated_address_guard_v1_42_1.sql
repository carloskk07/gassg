-- Chama São Gabriel — validated address commit guard v1.42.1
-- Applied after create-order has been switched to V6 in production.

create or replace function public.require_order_validated_address()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_status text;
  v_redacted_at timestamptz;
  v_postal_code text;
  v_address_number text;
begin
  select
    o.status,
    o.delivery_pii_redacted_at,
    o.delivery_postal_code,
    o.delivery_address_number
  into
    v_status,
    v_redacted_at,
    v_postal_code,
    v_address_number
  from public.orders o
  where o.id=new.id;

  if v_postal_code is null
     or v_postal_code!~'^[0-9]{8}$'
     or v_address_number is null
     or v_address_number!~'^[0-9]{1,6}[A-Za-z]?$' then
    if not (
      v_status in ('SETTLED','CANCELLED')
      and v_redacted_at is not null
    ) then
      raise exception 'ORDER_VALIDATED_ADDRESS_REQUIRED' using errcode='23514';
    end if;
  end if;

  return null;
end;
$$;

revoke all on function public.require_order_validated_address()
from public, anon, authenticated;
grant execute on function public.require_order_validated_address()
to postgres, service_role;

drop trigger if exists require_order_validated_address_commit
on public.orders;

create constraint trigger require_order_validated_address_commit
after insert or update of delivery_postal_code,delivery_address_number,delivery_pii_redacted_at,status
on public.orders
deferrable initially deferred
for each row
execute function public.require_order_validated_address();
