-- V1.205.1: index the private actor relationship without exposing history rows.
create index if not exists admin_city_commercial_history_actor_recent_v1_205
  on public.admin_city_commercial_history_v1_205(actor_user_id,captured_at desc);
