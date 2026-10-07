-- TAMÃO — Payment event review lifecycle v1.84
-- Finance can re-evaluate review events or close false/unmatchable events as ignored.
-- Events are never deleted: ignored decisions keep actor, timestamp, reason and audit trail.

alter table public.merchant_billing_payment_events
  add column if not exists ignored_at timestamptz,
  add column if not exists ignored_by uuid references auth.users(id) on delete set null,
  add column if not exists ignore_reason text;

alter table public.merchant_billing_payment_events
  add constraint merchant_billing_payment_events_ignore_reason_check
    check (
      ignore_reason is null
      or char_length(trim(ignore_reason)) between 3 and 240
    ),
  add constraint merchant_billing_payment_events_ignored_shape check (
    status<>'ignored'
    or (
      ignored_at is not null
      and ignored_by is not null
      and ignore_reason is not null
    )
  );

create index if not exists merchant_billing_payment_events_ignored_by_idx
  on public.merchant_billing_payment_events(ignored_by)
  where ignored_by is not null;

create or replace function public.admin_merchant_billing_payment_event_action(
  p_actor_user_id uuid,
  p_event_id uuid,
  p_action text,
  p_reason text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_role text;
  v_kind text:=lower(trim(coalesce(p_action,'')));
  v_reason text:=nullif(trim(coalesce(p_reason,'')),'');
  v_action public.action_requests%rowtype;
  v_event public.merchant_billing_payment_events%rowtype;
  v_result jsonb;
begin
  v_role:=public.platform_admin_role(p_actor_user_id);
  if v_role not in ('superadmin','finance') then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;

  if v_kind not in ('recheck','ignore') then
    raise exception 'INVALID_PAYMENT_EVENT_ACTION' using errcode='22023';
  end if;

  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;

  if p_request_hash is null or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  if v_kind='ignore'
     and (
       v_reason is null
       or char_length(v_reason)<3
       or char_length(v_reason)>240
     ) then
    raise exception 'PAYMENT_EVENT_IGNORE_REASON_REQUIRED' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_actor_user_id,
    'admin-ops:merchant-billing-payment-event:'||v_kind,
    p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'admin-ops:merchant-billing-payment-event:'||v_kind
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select *
  into v_event
  from public.merchant_billing_payment_events
  where id=p_event_id
  for update;

  if not found then
    raise exception 'PAYMENT_EVENT_NOT_FOUND' using errcode='P0002';
  end if;

  if v_kind='recheck' then
    if v_event.status in ('applied','already_applied','ignored') then
      v_result:=jsonb_build_object(
        'ok',true,
        'eventId',v_event.id,
        'status',v_event.status,
        'matchReason',v_event.match_reason,
        'terminal',true
      );
    else
      v_result:=public.reconcile_merchant_billing_payment_event(v_event.id)
        ||jsonb_build_object('ok',true,'terminal',false);
    end if;

    insert into public.platform_admin_audit(
      actor_user_id,action,target_type,target_id,metadata
    )
    values(
      p_actor_user_id,
      'merchant_billing_payment_event_rechecked',
      'merchant_billing_payment_event',
      v_event.id::text,
      jsonb_build_object(
        'provider',v_event.provider,
        'providerEventId',v_event.provider_event_id,
        'amountCents',v_event.amount_cents,
        'resultStatus',v_result->>'status',
        'matchReason',v_result->>'matchReason'
      )
    );

  else
    if v_event.status='matched_exact' then
      raise exception 'PAYMENT_EVENT_MATCHED_CANNOT_IGNORE'
        using errcode='40001';
    end if;

    if v_event.status<>'review_required' then
      raise exception 'PAYMENT_EVENT_NOT_REVIEWABLE'
        using errcode='40001';
    end if;

    update public.merchant_billing_payment_events
    set status='ignored',
        payment_request_id=null,
        merchant_id=null,
        match_reason='ignored_by_finance',
        ignored_at=clock_timestamp(),
        ignored_by=p_actor_user_id,
        ignore_reason=v_reason,
        updated_at=clock_timestamp()
    where id=v_event.id
    returning * into v_event;

    insert into public.platform_admin_audit(
      actor_user_id,action,target_type,target_id,metadata
    )
    values(
      p_actor_user_id,
      'merchant_billing_payment_event_ignored',
      'merchant_billing_payment_event',
      v_event.id::text,
      jsonb_build_object(
        'provider',v_event.provider,
        'providerEventId',v_event.provider_event_id,
        'reconciliationKey',v_event.reconciliation_key,
        'amountCents',v_event.amount_cents,
        'reason',v_reason
      )
    );

    v_result:=jsonb_build_object(
      'ok',true,
      'eventId',v_event.id,
      'status',v_event.status,
      'matchReason',v_event.match_reason,
      'ignoredAt',v_event.ignored_at
    );
  end if;

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.admin_merchant_billing_payment_event_action(
  uuid,uuid,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.admin_merchant_billing_payment_event_action(
  uuid,uuid,text,text,text,text
) to service_role, postgres;
