-- TAMÃO — Provider charge cancellation coupling v1.95
-- Financial request resolution and provider QR lifecycle must not diverge.
-- Merchant cancellation is blocked after provider payment evidence exists.
-- Pending provider charges are retired locally and queued for best-effort
-- cancellation at the PSP. Terminal local states cannot be resurrected by
-- a late create-charge HTTP response.

create or replace function public.guard_merchant_payment_request_cancel_after_provider_payment()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  if old.status='pending'
     and new.status='cancelled'
     and new.admin_reference='cancelled-by-merchant' then

    if exists(
      select 1
      from public.merchant_billing_provider_charges c
      where c.payment_request_id=old.id
        and c.status='completed'
    )
    or exists(
      select 1
      from public.merchant_billing_payment_events e
      where e.payment_request_id=old.id
        and e.status in ('matched_exact','applied','already_applied')
    ) then
      raise exception 'PAYMENT_REQUEST_PAYMENT_ALREADY_RECEIVED'
        using errcode='40001';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_merchant_payment_request_cancel_after_provider_payment()
from public,anon,authenticated;
grant execute on function public.guard_merchant_payment_request_cancel_after_provider_payment()
to postgres,service_role;

drop trigger if exists guard_merchant_payment_request_cancel_after_provider_payment_trg
on public.merchant_billing_payment_requests;
create trigger guard_merchant_payment_request_cancel_after_provider_payment_trg
before update of status,admin_reference
on public.merchant_billing_payment_requests
for each row execute function public.guard_merchant_payment_request_cancel_after_provider_payment();

create or replace function public.retire_provider_charges_after_payment_request_resolution()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  if old.status='pending'
     and new.status in ('cancelled','rejected') then
    update public.merchant_billing_provider_charges c
    set status='cancelled',
        last_error_code='PROVIDER_CANCEL_REQUIRED',
        last_error_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where c.payment_request_id=new.id
      and c.status in ('preparing','active');
  end if;

  return new;
end;
$$;

revoke all on function public.retire_provider_charges_after_payment_request_resolution()
from public,anon,authenticated;
grant execute on function public.retire_provider_charges_after_payment_request_resolution()
to postgres,service_role;

drop trigger if exists retire_provider_charges_after_payment_request_resolution_trg
on public.merchant_billing_payment_requests;
create trigger retire_provider_charges_after_payment_request_resolution_trg
after update of status
on public.merchant_billing_payment_requests
for each row execute function public.retire_provider_charges_after_payment_request_resolution();

create or replace function public.guard_provider_charge_terminal_reopen()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  if old.status='completed'
     and new.status is distinct from 'completed' then
    new.status:='completed';
    new.completed_at:=old.completed_at;
    new.paid_amount_cents:=old.paid_amount_cents;
    new.end_to_end_id:=old.end_to_end_id;
  elsif old.status='expired'
     and new.status in ('preparing','active') then
    new.status:='expired';
    new.expired_at:=old.expired_at;
  elsif old.status='cancelled'
     and new.status in ('preparing','active') then
    new.status:='cancelled';
    new.last_error_code:=old.last_error_code;
    new.last_error_at:=old.last_error_at;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_provider_charge_terminal_reopen()
from public,anon,authenticated;
grant execute on function public.guard_provider_charge_terminal_reopen()
to postgres,service_role;

drop trigger if exists guard_provider_charge_terminal_reopen_trg
on public.merchant_billing_provider_charges;
create trigger guard_provider_charge_terminal_reopen_trg
before update of status
on public.merchant_billing_provider_charges
for each row execute function public.guard_provider_charge_terminal_reopen();

create index if not exists merchant_billing_provider_charges_cancel_retry_idx
  on public.merchant_billing_provider_charges(
    payment_request_id,
    updated_at
  )
  where status='cancelled'
    and last_error_code in ('PROVIDER_CANCEL_REQUIRED','PROVIDER_CANCEL_FAILED');
