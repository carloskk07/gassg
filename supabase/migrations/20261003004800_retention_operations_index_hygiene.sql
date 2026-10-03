-- Chama São Gabriel — retention operations index hygiene v1.34.1
-- Cover new foreign-key access paths reported by Supabase advisors.

create index if not exists order_feedback_customer_created_idx
  on public.order_feedback(customer_id,created_at desc);

create index if not exists support_cases_merchant_created_idx
  on public.support_cases(merchant_id,created_at desc);
