-- TAMÃO — Payment-request closure retires provider Pix charges v1.95
-- A financial request is the authority for whether a generated provider charge
-- may remain payable. Leaving pending retires every still-open provider charge.
-- External PSP deletion is performed best-effort by the Edge action that caused
-- the transition; the database state itself never depends on that network call.

create or replace function public.retire_open_provider_charges_on_request_resolution()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  if old.status='pending'
     and new.status in ('approved','rejected','cancelled')
     and old.status is distinct from new.status then
    update public.merchant_billing_provider_charges charge
    set status='cancelled',
        last_error_code='PROVIDER_CANCEL_REQUIRED',
        last_error_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where charge.payment_request_id=new.id
      and charge.status in ('preparing','active');
  end if;

  return new;
end;
$$;

revoke all on function public.retire_open_provider_charges_on_request_resolution()
from public,anon,authenticated;
grant execute on function public.retire_open_provider_charges_on_request_resolution()
to postgres,service_role;

drop trigger if exists retire_open_provider_charges_on_request_resolution_trg
on public.merchant_billing_payment_requests;

create trigger retire_open_provider_charges_on_request_resolution_trg
after update of status
on public.merchant_billing_payment_requests
for each row execute function public.retire_open_provider_charges_on_request_resolution();

create index if not exists merchant_billing_provider_charges_cancel_retry_idx
  on public.merchant_billing_provider_charges(
    provider,
    last_error_code,
    updated_at
  )
  where status='cancelled'
    and last_error_code in ('PROVIDER_CANCEL_REQUIRED','PROVIDER_CANCEL_FAILED');
