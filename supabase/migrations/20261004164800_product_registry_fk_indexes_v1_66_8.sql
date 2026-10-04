-- TAMÃO v1.66.8 — índices de apoio das FKs do registro canônico de produto.
create index if not exists catalog_items_product_code_idx
  on public.catalog_items(product_code);
create index if not exists quote_items_product_code_idx
  on public.quote_items(product_code);
create index if not exists order_items_product_code_idx
  on public.order_items(product_code);
create index if not exists order_requote_items_product_code_idx
  on public.order_requote_items(product_code);
