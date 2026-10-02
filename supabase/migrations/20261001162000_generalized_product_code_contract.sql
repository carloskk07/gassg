-- Chama São Gabriel — generalized product-code contract v1.22
-- Aligns storage with the already-generalized GLP regulatory/delivery model.
-- Fixed non-GLP SKUs remain closed-world; GLP accepts P1..P90 only.

begin;

alter table public.catalog_items
  drop constraint if exists catalog_items_product_code_check;
alter table public.catalog_items
  add constraint catalog_items_product_code_check
  check (
    product_code in ('WATER20','CHARCOAL4','WOOD','ICE5')
    or product_code ~ '^P([1-9]|[1-8][0-9]|90)$'
  );

alter table public.quote_items
  drop constraint if exists quote_items_product_code_check;
alter table public.quote_items
  add constraint quote_items_product_code_check
  check (
    product_code in ('WATER20','CHARCOAL4','WOOD','ICE5')
    or product_code ~ '^P([1-9]|[1-8][0-9]|90)$'
  );

alter table public.order_items
  drop constraint if exists order_items_product_code_check;
alter table public.order_items
  add constraint order_items_product_code_check
  check (
    product_code in ('WATER20','CHARCOAL4','WOOD','ICE5')
    or product_code ~ '^P([1-9]|[1-8][0-9]|90)$'
  );

alter table public.order_requote_items
  drop constraint if exists order_requote_items_product_code_check;
alter table public.order_requote_items
  add constraint order_requote_items_product_code_check
  check (
    product_code in ('WATER20','CHARCOAL4','WOOD','ICE5')
    or product_code ~ '^P([1-9]|[1-8][0-9]|90)$'
  );

commit;
