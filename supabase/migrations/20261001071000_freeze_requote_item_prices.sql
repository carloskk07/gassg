-- Preserve per-item price integrity when an order is rescued to another merchant.

create table if not exists public.order_requote_items (
  order_id uuid not null references public.orders(id) on delete cascade,
  product_code text not null,
  product_name text not null,
  quantity integer not null check (quantity between 1 and 99),
  unit_price_cents integer not null check (unit_price_cents > 0),
  line_total_cents integer not null check (line_total_cents = quantity * unit_price_cents),
  primary key (order_id, product_code)
);

alter table public.order_requote_items enable row level security;
revoke all on table public.order_requote_items from anon, authenticated;
grant all on table public.order_requote_items to service_role;

drop policy if exists "deny authenticated requote items" on public.order_requote_items;
create policy "deny authenticated requote items"
on public.order_requote_items for all to authenticated
using (false) with check (false);

create or replace function public.sync_order_item_prices_on_supplier_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_count integer;
  v_expected integer;
  v_actual integer;
begin
  if new.proposed_merchant_id is distinct from old.proposed_merchant_id
     and new.proposed_merchant_id is not null then

    delete from public.order_requote_items where order_id=new.id;

    insert into public.order_requote_items(
      order_id,product_code,product_name,quantity,unit_price_cents,line_total_cents
    )
    select
      oi.order_id,oi.product_code,ci.product_name,oi.quantity,
      ci.price_cents,oi.quantity*ci.price_cents
    from public.order_items oi
    join public.catalog_items ci
      on ci.merchant_id=new.proposed_merchant_id
     and ci.product_code=oi.product_code
     and ci.active
    where oi.order_id=new.id;

    select count(*) into v_count
    from public.order_requote_items where order_id=new.id;

    select count(*) into v_expected
    from public.order_items where order_id=new.id;

    if v_count<>v_expected then
      raise exception 'REQUOTE_ITEM_SNAPSHOT_INCOMPLETE' using errcode='40001';
    end if;

    select coalesce(sum(line_total_cents),0)
    into v_actual
    from public.order_requote_items
    where order_id=new.id;

    select v_actual+m.delivery_fee_cents
    into v_actual
    from public.merchants m
    where m.id=new.proposed_merchant_id;

    if v_actual<>new.proposed_gross_total_cents then
      raise exception 'REQUOTE_TOTAL_MISMATCH' using errcode='40001';
    end if;
  end if;

  if new.merchant_id is distinct from old.merchant_id
     and new.merchant_id is not null then

    if exists(select 1 from public.order_requote_items ri where ri.order_id=new.id) then
      update public.order_items oi
      set product_name=ri.product_name,
          unit_price_cents=ri.unit_price_cents,
          line_total_cents=ri.line_total_cents
      from public.order_requote_items ri
      where oi.order_id=new.id
        and ri.order_id=new.id
        and ri.product_code=oi.product_code;

      delete from public.order_requote_items where order_id=new.id;
    else
      update public.order_items oi
      set product_name=ci.product_name,
          unit_price_cents=ci.price_cents,
          line_total_cents=oi.quantity*ci.price_cents
      from public.catalog_items ci
      where oi.order_id=new.id
        and ci.merchant_id=new.merchant_id
        and ci.product_code=oi.product_code
        and ci.active;
    end if;

    select coalesce(sum(line_total_cents),0)
    into v_actual
    from public.order_items
    where order_id=new.id;

    select v_actual+m.delivery_fee_cents
    into v_actual
    from public.merchants m
    where m.id=new.merchant_id;

    if v_actual<>new.gross_total_cents then
      raise exception 'ORDER_ITEM_TOTAL_MISMATCH' using errcode='40001';
    end if;
  end if;

  if new.proposed_merchant_id is null
     and old.proposed_merchant_id is not null
     and new.merchant_id is not distinct from old.merchant_id then
    delete from public.order_requote_items where order_id=new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_order_item_prices_on_supplier_change()
from public, anon, authenticated;
grant execute on function public.sync_order_item_prices_on_supplier_change()
to postgres, service_role;

drop trigger if exists sync_order_item_prices_on_supplier_change on public.orders;
create trigger sync_order_item_prices_on_supplier_change
after update of merchant_id, proposed_merchant_id on public.orders
for each row execute function public.sync_order_item_prices_on_supplier_change();
