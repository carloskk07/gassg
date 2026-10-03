-- Chama São Gabriel — delivery contact/details v1.39

alter table public.orders
  add column if not exists customer_phone_digits text,
  add column if not exists address_complement text,
  add column if not exists delivery_reference text,
  add column if not exists delivery_notes text;

alter table public.orders
  drop constraint if exists orders_customer_phone_digits_check,
  add constraint orders_customer_phone_digits_check check (
    customer_phone_digits is null
    or customer_phone_digits~'^[0-9]{10,11}$'
  ),
  drop constraint if exists orders_address_complement_check,
  add constraint orders_address_complement_check check (
    address_complement is null
    or (
      char_length(address_complement) between 1 and 120
      and address_complement=trim(address_complement)
    )
  ),
  drop constraint if exists orders_delivery_reference_check,
  add constraint orders_delivery_reference_check check (
    delivery_reference is null
    or (
      char_length(delivery_reference) between 1 and 160
      and delivery_reference=trim(delivery_reference)
    )
  ),
  drop constraint if exists orders_delivery_notes_check,
  add constraint orders_delivery_notes_check check (
    delivery_notes is null
    or (
      char_length(delivery_notes) between 1 and 240
      and delivery_notes=trim(delivery_notes)
    )
  );

create or replace function public.create_order_from_quote_v5(
  p_user_id uuid,
  p_quote_id uuid,
  p_payment_method text,
  p_use_cashback boolean,
  p_idempotency_key text,
  p_request_hash text,
  p_referral_code text default null,
  p_cash_tender_cents integer default null,
  p_customer_phone text default null,
  p_address_complement text default null,
  p_delivery_reference text default null,
  p_delivery_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_phone text;
  v_complement text;
  v_reference text;
  v_notes text;
begin
  v_phone:=regexp_replace(coalesce(p_customer_phone,''),'[^0-9]','','g');
  v_complement:=nullif(trim(coalesce(p_address_complement,'')),'');
  v_reference:=nullif(trim(coalesce(p_delivery_reference,'')),'');
  v_notes:=nullif(trim(coalesce(p_delivery_notes,'')),'');

  if v_phone!~'^[0-9]{10,11}$' then
    raise exception 'INVALID_CUSTOMER_PHONE' using errcode='22023';
  end if;

  if v_complement is not null and char_length(v_complement)>120 then
    raise exception 'INVALID_ADDRESS_COMPLEMENT' using errcode='22023';
  end if;
  if v_reference is not null and char_length(v_reference)>160 then
    raise exception 'INVALID_DELIVERY_REFERENCE' using errcode='22023';
  end if;
  if v_notes is not null and char_length(v_notes)>240 then
    raise exception 'INVALID_DELIVERY_NOTES' using errcode='22023';
  end if;

  if v_complement is not null and v_complement~'[[:cntrl:]]' then
    raise exception 'INVALID_ADDRESS_COMPLEMENT' using errcode='22023';
  end if;
  if v_reference is not null and v_reference~'[[:cntrl:]]' then
    raise exception 'INVALID_DELIVERY_REFERENCE' using errcode='22023';
  end if;
  if v_notes is not null and v_notes~'[[:cntrl:]]' then
    raise exception 'INVALID_DELIVERY_NOTES' using errcode='22023';
  end if;

  v_result:=public.create_order_from_quote_v4(
    p_user_id,
    p_quote_id,
    p_payment_method,
    p_use_cashback,
    p_idempotency_key,
    p_request_hash,
    p_referral_code,
    p_cash_tender_cents
  );

  v_order_id:=(v_result->>'orderId')::uuid;

  update public.orders
  set customer_phone_digits=v_phone,
      address_complement=v_complement,
      delivery_reference=v_reference,
      delivery_notes=v_notes,
      updated_at=clock_timestamp()
  where id=v_order_id
    and customer_id=p_user_id;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  return v_result||jsonb_build_object(
    'deliveryDetailsCaptured',true
  );
end;
$$;

revoke all on function public.create_order_from_quote_v5(
  uuid,uuid,text,boolean,text,text,text,integer,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.create_order_from_quote_v5(
  uuid,uuid,text,boolean,text,text,text,integer,text,text,text,text
) to service_role;

-- Enforce delivery contact at commit time so legacy internal wrappers cannot bypass V5.
create or replace function public.require_order_delivery_contact()
returns trigger
language plpgsql
set search_path = pg_catalog
as $
declare
  v_phone text;
begin
  select o.customer_phone_digits
  into v_phone
  from public.orders o
  where o.id=new.id;

  if v_phone is null or v_phone!~'^[0-9]{10,11} then
    raise exception 'ORDER_DELIVERY_CONTACT_REQUIRED' using errcode='23514';
  end if;

  return null;
end;
$;

revoke all on function public.require_order_delivery_contact()
from public, anon, authenticated;
grant execute on function public.require_order_delivery_contact()
to postgres, service_role;

drop trigger if exists require_order_delivery_contact_commit
on public.orders;

create constraint trigger require_order_delivery_contact_commit
after insert or update of customer_phone_digits
on public.orders
deferrable initially deferred
for each row
execute function public.require_order_delivery_contact();
