-- Chama v1.31 — keep cart arithmetic inside PostgreSQL int4 bounds.
-- normalizeItems accepts at most 20 lines and 99 units per product. With a
-- maximum unit price of 1,000,000 cents and delivery <= 100,000 cents, the
-- worst supported cart remains below 2,147,483,647 cents.
alter table public.catalog_items
  add constraint catalog_items_unit_price_int4_safe
  check (price_cents between 1 and 1000000);

alter table public.quote_items
  add constraint quote_items_unit_price_int4_safe
  check (unit_price_cents between 1 and 1000000);

alter table public.order_items
  add constraint order_items_unit_price_int4_safe
  check (unit_price_cents between 1 and 1000000);
