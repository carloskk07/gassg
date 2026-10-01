-- Chama São Gabriel — reversal-aware customer summary v1.6.5

create or replace function public.customer_financial_summary(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_referral_code text;
  v_cashback bigint:=0;
  v_pending bigint:=0;
  v_available bigint:=0;
  v_settled_orders bigint:=0;
  v_reversed_orders bigint:=0;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode='42501';
  end if;

  select p.referral_code
  into v_referral_code
  from public.profiles p
  where p.user_id=p_user_id;

  select
    coalesce(sum(w.amount_cents) filter (where w.bucket='cashback'),0),
    coalesce(sum(w.amount_cents) filter (where w.bucket='commission_pending'),0),
    coalesce(sum(w.amount_cents) filter (where w.bucket='commission_available'),0)
  into
    v_cashback,
    v_pending,
    v_available
  from public.wallet_entries w
  where w.user_id=p_user_id;

  select
    count(*) filter (where o.financial_state='settled'),
    count(*) filter (where o.financial_state='reversed')
  into
    v_settled_orders,
    v_reversed_orders
  from public.orders o
  where o.customer_id=p_user_id
    and o.status='SETTLED';

  return jsonb_build_object(
    'referralCode',v_referral_code,
    'cashbackCents',greatest(0,v_cashback),
    'commissionPendingCents',greatest(0,v_pending),
    'commissionAvailableCents',greatest(0,v_available),
    'settledOrders',v_settled_orders,
    'reversedOrders',v_reversed_orders
  );
end;
$$;

revoke all on function public.customer_financial_summary(uuid)
from public, anon, authenticated;
grant execute on function public.customer_financial_summary(uuid)
to service_role;
