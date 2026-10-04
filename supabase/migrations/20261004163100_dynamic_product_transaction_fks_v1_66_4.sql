-- TAMÃO v1.66.4 — todas as superfícies transacionais referenciam o registro canônico de produtos.

alter table public.quote_items
  drop constraint if exists quote_items_product_code_check;
alter table public.order_items
  drop constraint if exists order_items_product_code_check;
alter table public.order_requote_items
  drop constraint if exists order_requote_items_product_code_check;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conname='quote_items_product_code_registry_fkey'
      and conrelid='public.quote_items'::regclass
  ) then
    alter table public.quote_items
      add constraint quote_items_product_code_registry_fkey
      foreign key(product_code)
      references public.product_delivery_profiles(product_code)
      on update cascade on delete restrict;
  end if;

  if not exists(
    select 1 from pg_constraint
    where conname='order_items_product_code_registry_fkey'
      and conrelid='public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_product_code_registry_fkey
      foreign key(product_code)
      references public.product_delivery_profiles(product_code)
      on update cascade on delete restrict;
  end if;

  if not exists(
    select 1 from pg_constraint
    where conname='order_requote_items_product_code_registry_fkey'
      and conrelid='public.order_requote_items'::regclass
  ) then
    alter table public.order_requote_items
      add constraint order_requote_items_product_code_registry_fkey
      foreign key(product_code)
      references public.product_delivery_profiles(product_code)
      on update cascade on delete restrict;
  end if;
end
$$;
