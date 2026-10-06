-- TAMÃO V1.70.19 — online state must match the delivery boundary used by matching.
-- The current marketplace only offers merchants that accept citywide São Gabriel coverage.
-- Enforce the same invariant at the database boundary so concurrent tabs cannot leave
-- online=true after another action removes that delivery capability.

update public.merchants
set online=false
where online=true
  and accepts_citywide is not true;

alter table public.merchants
  drop constraint if exists merchants_online_delivery_area_check;

alter table public.merchants
  add constraint merchants_online_delivery_area_check
  check (not online or accepts_citywide is true);
