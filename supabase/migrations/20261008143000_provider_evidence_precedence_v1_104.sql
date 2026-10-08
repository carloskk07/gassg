-- TAMÃO — Provider evidence precedence v1.104
-- When an exact provider event already exists for a pending payment request,
-- Finance must approve using that event. Manual approval remains available
-- only when no matched_exact provider evidence exists.

create or replace function public.block_manual_approval_when_provider_event_matched()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  if old.status='pending'
     and new.status='approved'
     and new.approval_source='manual'
     and exists(
       select 1
       from public.merchant_billing_payment_events e
       where e.payment_request_id=new.id
         and e.merchant_id=new.merchant_id
         and e.status='matched_exact'
     ) then
    raise exception 'PAYMENT_EVENT_MATCHED_REQUIRES_PROVIDER_APPROVAL'
      using errcode='40001';
  end if;

  return new;
end;
$$;

revoke all on function public.block_manual_approval_when_provider_event_matched()
from public,anon,authenticated;
grant execute on function public.block_manual_approval_when_provider_event_matched()
to postgres,service_role;

drop trigger if exists block_manual_approval_when_provider_event_matched_trg
on public.merchant_billing_payment_requests;
create trigger block_manual_approval_when_provider_event_matched_trg
before update of status,approval_source
on public.merchant_billing_payment_requests
for each row execute function public.block_manual_approval_when_provider_event_matched();
