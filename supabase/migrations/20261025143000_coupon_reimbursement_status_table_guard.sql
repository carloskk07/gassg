-- Reuse the existing financial fact trigger for status integrity.
-- This is a temporary fail-closed rule for coupon-backed reimbursements;
-- an independently verified provider/bank payee path is not yet present.
-- Non-coupon and reversal fact paths are unchanged.
CREATE OR REPLACE FUNCTION public.validate_cashback_reimbursement_fact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_order public.orders%rowtype;
  v_expected_due timestamptz;
begin
  if tg_op='UPDATE' and (
    new.order_id is distinct from old.order_id
    or new.merchant_id is distinct from old.merchant_id
    or new.cashback_cents is distinct from old.cashback_cents
    or new.due_at is distinct from old.due_at
  ) then
    raise exception 'FINANCIAL_FACT_IMMUTABLE' using errcode='23514';
  end if;

  -- Direct service-role writes must not bypass admin_financial_action.
  -- Neither a reference typed into Admin nor success/accredited without
  -- recipient identity proves that a coupon-funded merchant has been paid.
  if new.status in ('paid','offset') and exists (
    select 1 from public.clube_coupon_paid_order_applications
    where order_id=new.order_id
  ) then
    raise exception 'COUPON_REIMBURSEMENT_EXTERNAL_PROOF_REQUIRED'
      using errcode='23514';
  end if;

  if tg_op='INSERT' then
    select * into v_order
    from public.orders
    where id=new.order_id
    for share;

    if not found then
      raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
    end if;

    if v_order.status<>'SETTLED'
       or v_order.financial_state<>'settled'
       or v_order.financial_reversed_at is not null
       or v_order.merchant_id is null
       or v_order.settled_at is null
       or v_order.delivered_at is null
       or v_order.payment_confirmed_at is null
       or v_order.cashback_reserved_cents<=0 then
      raise exception 'ORDER_NOT_ELIGIBLE_FOR_CASHBACK_REIMBURSEMENT' using errcode='40001';
    end if;

    v_expected_due:=public.merchant_settlement_daily_due_at(v_order.settled_at);

    if new.merchant_id<>v_order.merchant_id
       or new.cashback_cents<>v_order.cashback_reserved_cents
       or new.due_at<>v_expected_due then
      raise exception 'CASHBACK_REIMBURSEMENT_MISMATCH' using errcode='23514';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_cashback_reimbursement_fact()
from public, anon, authenticated;
grant execute on function public.validate_cashback_reimbursement_fact()
to postgres, service_role;

drop trigger if exists validate_cashback_reimbursement_fact
on public.merchant_cashback_reimbursements;
create trigger validate_cashback_reimbursement_fact
before insert or update of order_id,merchant_id,cashback_cents,due_at,status,paid_at,offset_at
on public.merchant_cashback_reimbursements
for each row execute function public.validate_cashback_reimbursement_fact();
