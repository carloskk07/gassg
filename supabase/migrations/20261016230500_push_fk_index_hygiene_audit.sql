-- Audit 2026-10-16: cover push subsystem foreign-key lookups used by
-- parent deletion checks and operational joins.
-- Additive only: no changes to RLS, notifications, sessions, or commerce.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index if not exists merchant_push_deliveries_subscription_fk_idx
  on public.merchant_push_deliveries (subscription_id);

create index if not exists merchant_push_outbox_order_fk_idx
  on public.merchant_push_outbox (order_id);

create index if not exists merchant_push_outbox_user_fk_idx
  on public.merchant_push_outbox (user_id);

create index if not exists merchant_push_subscriptions_user_fk_idx
  on public.merchant_push_subscriptions (user_id);

create index if not exists merchant_push_test_runs_merchant_fk_idx
  on public.merchant_push_test_runs (merchant_id);

create index if not exists merchant_push_test_runs_subscription_fk_idx
  on public.merchant_push_test_runs (subscription_id);
