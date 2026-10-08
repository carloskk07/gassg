-- TAMÃO — Provider cancellation audit trail v1.96
-- Provider-side cancellation is operational evidence, not a financial authority.
-- Every attempt is persisted with actor, outcome and provider response metadata.

alter table public.merchant_billing_provider_charges
  add column if not exists provider_cancel_attempts integer not null default 0,
  add column if not exists provider_cancel_last_attempt_at timestamptz,
  add column if not exists provider_cancel_last_reason text,
  add column if not exists provider_cancel_last_http_status integer,
  add column if not exists provider_cancel_last_actor_kind text,
  add column if not exists provider_cancel_last_actor_user_id uuid
    references auth.users(id) on delete set null,
  add column if not exists provider_cancelled_at timestamptz;

alter table public.merchant_billing_provider_charges
  add constraint merchant_billing_provider_charges_cancel_attempts_check
    check (provider_cancel_attempts>=0),
  add constraint merchant_billing_provider_charges_cancel_http_status_check
    check (
      provider_cancel_last_http_status is null
      or provider_cancel_last_http_status between 100 and 599
    ),
  add constraint merchant_billing_provider_charges_cancel_actor_kind_check
    check (
      provider_cancel_last_actor_kind is null
      or provider_cancel_last_actor_kind in ('merchant','admin','system')
    ),
  add constraint merchant_billing_provider_charges_cancel_reason_check
    check (
      provider_cancel_last_reason is null
      or (
        char_length(provider_cancel_last_reason) between 3 and 160
        and provider_cancel_last_reason ~ '^[A-Z0-9_:-]+$'
      )
    );

create index if not exists merchant_billing_provider_charges_cancel_actor_idx
  on public.merchant_billing_provider_charges(provider_cancel_last_actor_user_id)
  where provider_cancel_last_actor_user_id is not null;

create table if not exists public.merchant_billing_provider_cancel_attempts (
  id uuid primary key default gen_random_uuid(),
  provider_charge_id uuid not null
    references public.merchant_billing_provider_charges(id) on delete restrict,
  payment_request_id uuid not null
    references public.merchant_billing_payment_requests(id) on delete restrict,
  merchant_id uuid not null
    references public.merchants(id) on delete restrict,
  provider text not null,
  correlation_id text not null,
  attempt_no integer not null check (attempt_no>0),
  actor_kind text not null
    check (actor_kind in ('merchant','admin','system')),
  actor_user_id uuid references auth.users(id) on delete set null,
  success boolean not null,
  reason text,
  http_status integer,
  created_at timestamptz not null default clock_timestamp(),
  constraint merchant_billing_provider_cancel_attempt_reason_shape check (
    (success and reason is null)
    or (
      not success
      and reason is not null
      and char_length(reason) between 3 and 160
      and reason ~ '^[A-Z0-9_:-]+$'
    )
  ),
  constraint merchant_billing_provider_cancel_attempt_http_status_check check (
    http_status is null or http_status between 100 and 599
  ),
  constraint merchant_billing_provider_cancel_attempt_actor_shape check (
    (actor_kind='system' and actor_user_id is null)
    or (actor_kind in ('merchant','admin') and actor_user_id is not null)
  ),
  unique(provider_charge_id,attempt_no)
);

alter table public.merchant_billing_provider_cancel_attempts enable row level security;
revoke all on table public.merchant_billing_provider_cancel_attempts
from public,anon,authenticated;
grant all on table public.merchant_billing_provider_cancel_attempts
to service_role,postgres;

create index if not exists merchant_billing_provider_cancel_attempts_request_idx
  on public.merchant_billing_provider_cancel_attempts(
    payment_request_id,created_at desc
  );

create index if not exists merchant_billing_provider_cancel_attempts_merchant_idx
  on public.merchant_billing_provider_cancel_attempts(
    merchant_id,created_at desc
  );

create index if not exists merchant_billing_provider_cancel_attempts_actor_idx
  on public.merchant_billing_provider_cancel_attempts(
    actor_user_id,created_at desc
  )
  where actor_user_id is not null;

create or replace function public.record_merchant_billing_provider_cancel_attempt(
  p_charge_id uuid,
  p_actor_kind text,
  p_actor_user_id uuid,
  p_success boolean,
  p_reason text,
  p_http_status integer
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_charge public.merchant_billing_provider_charges%rowtype;
  v_actor_kind text:=lower(trim(coalesce(p_actor_kind,'')));
  v_reason text:=nullif(upper(trim(coalesce(p_reason,''))),'');
  v_attempt integer;
  v_now timestamptz:=clock_timestamp();
begin
  if p_charge_id is null then
    raise exception 'PROVIDER_CHARGE_ID_REQUIRED' using errcode='22023';
  end if;

  if v_actor_kind not in ('merchant','admin','system') then
    raise exception 'INVALID_PROVIDER_CANCEL_ACTOR_KIND' using errcode='22023';
  end if;

  if v_actor_kind='system' and p_actor_user_id is not null then
    raise exception 'INVALID_PROVIDER_CANCEL_SYSTEM_ACTOR' using errcode='22023';
  end if;

  if v_actor_kind in ('merchant','admin') and p_actor_user_id is null then
    raise exception 'PROVIDER_CANCEL_ACTOR_REQUIRED' using errcode='22023';
  end if;

  if p_success is null then
    raise exception 'PROVIDER_CANCEL_OUTCOME_REQUIRED' using errcode='22023';
  end if;

  if p_success and v_reason is not null then
    raise exception 'PROVIDER_CANCEL_SUCCESS_REASON_FORBIDDEN' using errcode='22023';
  end if;

  if not p_success
     and (
       v_reason is null
       or char_length(v_reason)<3
       or char_length(v_reason)>160
       or v_reason!~'^[A-Z0-9_:-]+$'
     ) then
    raise exception 'INVALID_PROVIDER_CANCEL_FAILURE_REASON' using errcode='22023';
  end if;

  if p_http_status is not null
     and (p_http_status<100 or p_http_status>599) then
    raise exception 'INVALID_PROVIDER_CANCEL_HTTP_STATUS' using errcode='22023';
  end if;

  select *
  into v_charge
  from public.merchant_billing_provider_charges
  where id=p_charge_id
  for update;

  if not found then
    raise exception 'PROVIDER_CHARGE_NOT_FOUND' using errcode='P0002';
  end if;

  if v_charge.status<>'cancelled' then
    raise exception 'PROVIDER_CHARGE_NOT_CANCELLED'
      using errcode='40001';
  end if;

  if v_actor_kind='merchant'
     and not exists(
       select 1
       from public.merchant_members mm
       where mm.merchant_id=v_charge.merchant_id
         and mm.user_id=p_actor_user_id
         and mm.active
         and mm.member_role in ('owner','manager')
     ) then
    raise exception 'MERCHANT_FINANCE_PERMISSION_DENIED'
      using errcode='42501';
  end if;

  if v_actor_kind='admin'
     and public.platform_admin_role(p_actor_user_id)
         not in ('superadmin','finance') then
    raise exception 'ADMIN_PERMISSION_DENIED'
      using errcode='42501';
  end if;

  v_attempt:=v_charge.provider_cancel_attempts+1;

  insert into public.merchant_billing_provider_cancel_attempts(
    provider_charge_id,payment_request_id,merchant_id,
    provider,correlation_id,attempt_no,
    actor_kind,actor_user_id,success,reason,http_status,created_at
  )
  values(
    v_charge.id,v_charge.payment_request_id,v_charge.merchant_id,
    v_charge.provider,v_charge.correlation_id,v_attempt,
    v_actor_kind,p_actor_user_id,p_success,v_reason,p_http_status,v_now
  );

  update public.merchant_billing_provider_charges
  set provider_cancel_attempts=v_attempt,
      provider_cancel_last_attempt_at=v_now,
      provider_cancel_last_reason=case when p_success then null else v_reason end,
      provider_cancel_last_http_status=p_http_status,
      provider_cancel_last_actor_kind=v_actor_kind,
      provider_cancel_last_actor_user_id=p_actor_user_id,
      provider_cancelled_at=case
        when p_success then coalesce(provider_cancelled_at,v_now)
        else provider_cancelled_at
      end,
      last_error_code=case
        when p_success then null
        else 'PROVIDER_CANCEL_FAILED'
      end,
      last_error_at=case
        when p_success then null
        else v_now
      end,
      updated_at=v_now
  where id=v_charge.id
  returning * into v_charge;

  return jsonb_build_object(
    'ok',true,
    'chargeId',v_charge.id,
    'paymentRequestId',v_charge.payment_request_id,
    'attemptNo',v_attempt,
    'success',p_success,
    'reason',case when p_success then null else v_reason end,
    'httpStatus',p_http_status,
    'providerCancelledAt',v_charge.provider_cancelled_at
  );
end;
$$;

revoke all on function public.record_merchant_billing_provider_cancel_attempt(
  uuid,text,uuid,boolean,text,integer
) from public,anon,authenticated;
grant execute on function public.record_merchant_billing_provider_cancel_attempt(
  uuid,text,uuid,boolean,text,integer
) to service_role,postgres;
