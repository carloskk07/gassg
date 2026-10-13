-- TAMÃO Ads V1.232.1 — index FK references used by voluntary Ads interest audit.
create index if not exists merchant_ads_interest_updated_by_v1_232_1
 on public.merchant_ads_interest_v1_232(updated_by);
create index if not exists merchant_ads_interest_events_actor_v1_232_1
 on public.merchant_ads_interest_events_v1_232(actor_user_id);
