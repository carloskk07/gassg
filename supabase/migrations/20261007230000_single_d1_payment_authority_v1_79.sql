-- TAMÃO — Single D+1 payment authority v1.79
-- Any positive daily statement that becomes paid must, by COMMIT time,
-- have one exact approved payment request. This closes the legacy direct-pay bypass.

create or replace function public.require_approved_payment_request_for_paid_statement()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  if new.status='paid'
     and old.status is distinct from new.status
     and new.amount_due_cents>0 then

    if not exists(
      select 1
      from public.merchant_billing_payment_requests r
      where r.statement_id=new.id
        and r.merchant_id=new.merchant_id
        and r.request_kind='statement_payment'
        and r.status='approved'
        and r.expected_amount_cents=new.amount_due_cents
        and r.received_amount_cents=new.amount_due_cents
        and r.payment_method is not null
        and r.resolved_by is not null
        and r.resolved_at is not null
        and r.admin_reference is not null
    ) then
      raise exception 'STATEMENT_APPROVED_PAYMENT_REQUEST_REQUIRED'
        using errcode='42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.require_approved_payment_request_for_paid_statement()
from public, anon, authenticated;
grant execute on function public.require_approved_payment_request_for_paid_statement()
to postgres, service_role;

drop trigger if exists require_approved_payment_request_for_paid_statement_trg
on public.merchant_daily_statements;

create constraint trigger require_approved_payment_request_for_paid_statement_trg
after update of status on public.merchant_daily_statements
deferrable initially deferred
for each row
execute function public.require_approved_payment_request_for_paid_statement();
