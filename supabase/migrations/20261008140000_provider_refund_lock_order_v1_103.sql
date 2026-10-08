-- TAMÃO — Provider payment/refund lock order v1.103
-- Provider-backed Finance approval must use the same row-lock order as
-- payment/refund ingestion: payment_event -> payment_request.
-- This removes the direct deadlock cycle at the exact approval/refund race.
-- Manual approval has no provider event and continues locking only the request.

create or replace function public.admin_merchant_billing_payment_request_action(
  p_actor_user_id uuid,
  p_payment_request_id uuid,
  p_action text,
  p_reference text,
  p_received_amount_cents bigint,
  p_payment_method text,
  p_reconciliation_key text,
  p_payment_event_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_kind text:=lower(trim(coalesce(p_action,'')));
  v_method text:=lower(trim(coalesce(p_payment_method,'')));
  v_key text:=nullif(trim(p_reconciliation_key),'');
  v_request public.merchant_billing_payment_requests%rowtype;
  v_event public.merchant_billing_payment_events%rowtype;
begin
  if v_kind not in ('approve','reject') then
    raise exception 'INVALID_PAYMENT_REQUEST_ACTION' using errcode='22023';
  end if;

  if v_kind='approve' then
    if p_received_amount_cents is null or p_received_amount_cents<=0 then
      raise exception 'PAYMENT_AMOUNT_MISMATCH' using errcode='40001';
    end if;

    if v_method not in ('pix','bank_transfer','cash','card','other') then
      raise exception 'INVALID_PAYMENT_METHOD' using errcode='22023';
    end if;

    if v_key is null
       or char_length(v_key)<6
       or char_length(v_key)>160
       or v_key~'[[:cntrl:]]' then
      raise exception 'INVALID_RECONCILIATION_KEY' using errcode='22023';
    end if;

    -- Canonical provider-backed order: event first, request second.
    -- Refund ingestion already uses this order. Holding the event across the
    -- request transition also makes the later applied-status trigger reentrant
    -- instead of competing for the same pair in reverse.
    if p_payment_event_id is not null then
      select *
      into v_event
      from public.merchant_billing_payment_events
      where id=p_payment_event_id
      for update;

      if not found then
        raise exception 'PAYMENT_EVENT_NOT_FOUND' using errcode='P0002';
      end if;
    end if;
  end if;

  select *
  into v_request
  from public.merchant_billing_payment_requests
  where id=p_payment_request_id
  for update;

  if not found then
    raise exception 'PAYMENT_REQUEST_NOT_FOUND' using errcode='P0002';
  end if;

  if v_kind='approve' then
    if p_received_amount_cents<>v_request.expected_amount_cents then
      raise exception 'PAYMENT_AMOUNT_MISMATCH' using errcode='40001';
    end if;

    if p_payment_event_id is not null then
      if v_event.status<>'matched_exact'
         or v_event.payment_request_id is distinct from v_request.id
         or v_event.merchant_id is distinct from v_request.merchant_id then
        raise exception 'PAYMENT_EVENT_NOT_MATCHED_TO_REQUEST'
          using errcode='40001';
      end if;

      if v_event.amount_cents is distinct from p_received_amount_cents
         or v_event.payment_method is distinct from v_method
         or lower(trim(v_event.reconciliation_key))
            is distinct from lower(v_key) then
        raise exception 'PAYMENT_EVENT_APPROVAL_MISMATCH'
          using errcode='40001';
      end if;

      update public.merchant_billing_payment_requests
      set approval_source='provider_event',
          provider_payment_event_id=v_event.id,
          updated_at=clock_timestamp()
      where id=v_request.id;

    else
      update public.merchant_billing_payment_requests
      set approval_source='manual',
          provider_payment_event_id=null,
          updated_at=clock_timestamp()
      where id=v_request.id;
    end if;
  end if;

  return public.admin_merchant_billing_payment_request_action(
    p_actor_user_id,
    p_payment_request_id,
    v_kind,
    p_reference,
    p_received_amount_cents,
    v_method,
    v_key,
    p_idempotency_key,
    p_request_hash
  );
end;
$$;

revoke all on function public.admin_merchant_billing_payment_request_action(
  uuid,uuid,text,text,bigint,text,text,uuid,text,text
) from public,anon,authenticated;
grant execute on function public.admin_merchant_billing_payment_request_action(
  uuid,uuid,text,text,bigint,text,text,uuid,text,text
) to service_role,postgres;
