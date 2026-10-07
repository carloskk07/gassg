-- TAMÃO — Billing review SLA control tower v1.85
-- Measures financial-review latency without auto-expiring real payment claims.

create or replace function public.admin_merchant_billing_review_sla_metrics(
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_role text;
  v_pending_24_count bigint:=0;
  v_pending_24_cents bigint:=0;
  v_pending_48_count bigint:=0;
  v_pending_48_cents bigint:=0;
  v_oldest_pending timestamptz;
  v_matched_count bigint:=0;
  v_matched_cents bigint:=0;
  v_matched_2h_count bigint:=0;
  v_matched_2h_cents bigint:=0;
  v_oldest_matched timestamptz;
  v_review_count bigint:=0;
  v_review_cents bigint:=0;
  v_review_24_count bigint:=0;
  v_review_24_cents bigint:=0;
  v_oldest_review timestamptz;
  v_applied_24_count bigint:=0;
  v_applied_24_cents bigint:=0;
  v_ignored_24_count bigint:=0;
begin
  v_role:=public.platform_admin_role(p_actor_user_id);
  if v_role not in ('superadmin','finance','readonly') then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;

  select
    count(*) filter (
      where status='pending'
        and requested_at<clock_timestamp()-interval '24 hours'
    ),
    coalesce(sum(expected_amount_cents) filter (
      where status='pending'
        and requested_at<clock_timestamp()-interval '24 hours'
    ),0),
    count(*) filter (
      where status='pending'
        and requested_at<clock_timestamp()-interval '48 hours'
    ),
    coalesce(sum(expected_amount_cents) filter (
      where status='pending'
        and requested_at<clock_timestamp()-interval '48 hours'
    ),0),
    min(requested_at) filter (where status='pending')
  into
    v_pending_24_count,
    v_pending_24_cents,
    v_pending_48_count,
    v_pending_48_cents,
    v_oldest_pending
  from public.merchant_billing_payment_requests;

  select
    count(*) filter (where status='matched_exact'),
    coalesce(sum(amount_cents) filter (where status='matched_exact'),0),
    count(*) filter (
      where status='matched_exact'
        and received_at<clock_timestamp()-interval '2 hours'
    ),
    coalesce(sum(amount_cents) filter (
      where status='matched_exact'
        and received_at<clock_timestamp()-interval '2 hours'
    ),0),
    min(received_at) filter (where status='matched_exact'),
    count(*) filter (where status='review_required'),
    coalesce(sum(amount_cents) filter (where status='review_required'),0),
    count(*) filter (
      where status='review_required'
        and received_at<clock_timestamp()-interval '24 hours'
    ),
    coalesce(sum(amount_cents) filter (
      where status='review_required'
        and received_at<clock_timestamp()-interval '24 hours'
    ),0),
    min(received_at) filter (where status='review_required'),
    count(*) filter (
      where status='applied'
        and applied_at>=clock_timestamp()-interval '24 hours'
    ),
    coalesce(sum(amount_cents) filter (
      where status='applied'
        and applied_at>=clock_timestamp()-interval '24 hours'
    ),0),
    count(*) filter (
      where status='ignored'
        and ignored_at>=clock_timestamp()-interval '24 hours'
    )
  into
    v_matched_count,
    v_matched_cents,
    v_matched_2h_count,
    v_matched_2h_cents,
    v_oldest_matched,
    v_review_count,
    v_review_cents,
    v_review_24_count,
    v_review_24_cents,
    v_oldest_review,
    v_applied_24_count,
    v_applied_24_cents,
    v_ignored_24_count
  from public.merchant_billing_payment_events;

  return jsonb_build_object(
    'generatedAt',clock_timestamp(),
    'needsAttention',
      v_pending_24_count>0
      or v_matched_2h_count>0
      or v_review_24_count>0,
    'pendingOver24hCount',v_pending_24_count,
    'pendingOver24hCents',v_pending_24_cents,
    'pendingOver48hCount',v_pending_48_count,
    'pendingOver48hCents',v_pending_48_cents,
    'oldestPendingRequestedAt',v_oldest_pending,
    'matchedAwaitingApprovalCount',v_matched_count,
    'matchedAwaitingApprovalCents',v_matched_cents,
    'matchedOver2hCount',v_matched_2h_count,
    'matchedOver2hCents',v_matched_2h_cents,
    'oldestMatchedReceivedAt',v_oldest_matched,
    'reviewRequiredCount',v_review_count,
    'reviewRequiredCents',v_review_cents,
    'reviewOver24hCount',v_review_24_count,
    'reviewOver24hCents',v_review_24_cents,
    'oldestReviewReceivedAt',v_oldest_review,
    'appliedLast24hCount',v_applied_24_count,
    'appliedLast24hCents',v_applied_24_cents,
    'ignoredLast24hCount',v_ignored_24_count
  );
end;
$$;

revoke all on function public.admin_merchant_billing_review_sla_metrics(uuid)
from public, anon, authenticated;
grant execute on function public.admin_merchant_billing_review_sla_metrics(uuid)
to service_role, postgres;
