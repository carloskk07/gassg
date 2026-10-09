
alter table public.merchant_sale_payment_attempts
  add column if not exists released_for_order_change_at timestamptz,
  add column if not exists release_action text;

alter table public.merchant_sale_payment_attempts
  drop constraint if exists merchant_sale_payment_attempts_release_shape;

alter table public.merchant_sale_payment_attempts
  add constraint merchant_sale_payment_attempts_release_shape
  check (
    (
      released_for_order_change_at is null
      and release_action is null
    )
    or (
      released_for_order_change_at is not null
      and release_action in ('cancel','refund','local_cancel')
      and status in ('cancelled','expired','refunded','rejected')
    )
  );

drop index if exists public.merchant_sale_payment_attempts_one_live_per_order;

create unique index merchant_sale_payment_attempts_one_live_per_order
  on public.merchant_sale_payment_attempts(order_id)
  where status in (
    'preparing','checkout_ready','pending','approved','review_required'
  );

create or replace function public.guard_merchant_sale_payment_attempt_insert()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_order_status text;
  v_order_merchant uuid;
begin
  select status,merchant_id
  into v_order_status,v_order_merchant
  from public.orders
  where id=new.order_id
  for share;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  if v_order_merchant is distinct from new.merchant_id then
    raise exception 'SALE_PAYMENT_ATTEMPT_MERCHANT_MISMATCH'
      using errcode='40001';
  end if;

  if exists(
    select 1
    from public.merchant_sale_payment_attempts a
    where a.order_id=new.order_id
      and a.merchant_id=new.merchant_id
      and a.status='review_required'
  ) then
    raise exception 'SALE_PAYMENT_REVIEW_REQUIRED' using errcode='40001';
  end if;

  if v_order_status not in ('CANCELLED','SETTLED')
     and exists(
       select 1
       from public.merchant_sale_payment_attempts a
       where a.order_id=new.order_id
         and a.merchant_id=new.merchant_id
         and a.released_for_order_change_at is not null
     ) then
    raise exception 'SALE_PAYMENT_ORDER_CHANGE_PENDING'
      using errcode='40001';
  end if;

  return new;
end;
$function$;

drop trigger if exists guard_merchant_sale_payment_attempt_insert_trg
  on public.merchant_sale_payment_attempts;

create trigger guard_merchant_sale_payment_attempt_insert_trg
before insert on public.merchant_sale_payment_attempts
for each row
execute function public.guard_merchant_sale_payment_attempt_insert();

revoke all on function public.guard_merchant_sale_payment_attempt_insert()
  from public,anon,authenticated;
grant execute on function public.guard_merchant_sale_payment_attempt_insert()
  to service_role;
