-- Provider-verified package and statement payments use the EXISTING resolver.
-- Automatic applications have explicit machine provenance; no human is impersonated.
-- No receipt, balance or financial evidence is created by this migration.
create schema if not exists tamao_billing_private;
revoke all on schema tamao_billing_private from public,anon,authenticated,service_role;

alter table public.merchant_billing_payment_requests
 add column auto_applied boolean not null default false;
alter table public.merchant_billing_payment_events
 add column auto_applied boolean not null default false;

alter table public.merchant_billing_payment_requests
 drop constraint merchant_billing_payment_requests_approved_exact_payment,
 add constraint merchant_billing_payment_requests_approved_exact_payment check (
  status<>'approved' or (received_amount_cents=expected_amount_cents
   and payment_method is not null and resolved_at is not null
   and admin_reference is not null and char_length(trim(admin_reference)) between 3 and 240
   and ((not auto_applied and resolved_by is not null)
    or (auto_applied and resolved_by is null and approval_source='provider_event'
      and provider_payment_event_id is not null)))),
 add constraint merchant_billing_payment_requests_auto_shape check (
  not auto_applied or (approval_source is not distinct from 'provider_event' and provider_payment_event_id is not null
   and resolved_by is null and request_kind in ('package_purchase','statement_payment')));
alter table public.merchant_billing_payment_events
 drop constraint merchant_billing_payment_events_applied_shape,
 add constraint merchant_billing_payment_events_applied_shape check (
  status<>'applied' or (applied_at is not null and
    ((not auto_applied and applied_by is not null) or (auto_applied and applied_by is null)))),
 add constraint merchant_billing_payment_events_auto_shape check (
  not auto_applied or (provider='mercadopago' and applied_by is null and applied_at is not null
   and payment_request_id is not null and status in ('applied','already_applied','refunded')));

create table public.merchant_billing_auto_applications (
 payment_request_id uuid primary key references public.merchant_billing_payment_requests(id),
 payment_event_id uuid not null unique references public.merchant_billing_payment_events(id),
 charge_id uuid not null unique references public.merchant_billing_provider_charges(id),
 merchant_id uuid not null references public.merchants(id),
 amount_cents bigint not null check(amount_cents>0),
 request_kind text not null check(request_kind in ('package_purchase','statement_payment')),
 applied_at timestamptz not null default clock_timestamp()
);
alter table public.merchant_billing_auto_applications enable row level security;
revoke all on public.merchant_billing_auto_applications from public,anon,authenticated,service_role;
grant select on public.merchant_billing_auto_applications to service_role;
create function tamao_billing_private.guard_billing_auto_application() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin raise exception 'AUTOMATIC_BILLING_AUDIT_IMMUTABLE' using errcode='42501';end $$;
revoke all on function tamao_billing_private.guard_billing_auto_application() from public,anon,authenticated,service_role;
create trigger billing_auto_application_immutable before update or delete
 on public.merchant_billing_auto_applications for each row execute function tamao_billing_private.guard_billing_auto_application();
create trigger billing_auto_application_no_truncate before truncate
 on public.merchant_billing_auto_applications for each statement execute function tamao_billing_private.guard_billing_auto_application();

CREATE OR REPLACE FUNCTION tamao_billing_private.resolve_merchant_billing_payment_request(p_actor_user_id uuid, p_payment_request_id uuid, p_action text, p_reference text, p_idempotency_key text, p_request_hash text, p_automatic_event_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_role text;
  v_action public.action_requests%rowtype;
  v_request public.merchant_billing_payment_requests%rowtype;
  v_plan public.merchant_billing_plans%rowtype;
  v_statement public.merchant_daily_statements%rowtype;
  v_recovery public.merchant_billing_refund_recoveries%rowtype;
  v_refund public.merchant_billing_payment_refunds%rowtype;
  v_kind text:=lower(trim(coalesce(p_action,'')));
  v_reference text:=nullif(trim(p_reference),'');
  v_result jsonb;
begin
  if p_automatic_event_id is null then
    v_role:=public.platform_admin_role(p_actor_user_id);
    if v_role is null or v_role not in ('superadmin','finance') then
      raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
    end if;
  elsif p_actor_user_id is not null or v_kind<>'approve' then
    raise exception 'INVALID_AUTOMATIC_BILLING_APPLICATION' using errcode='42501';
  end if;

  if p_payment_request_id is null then
    raise exception 'PAYMENT_REQUEST_ID_REQUIRED' using errcode='22023';
  end if;

  if v_kind not in ('approve','reject') then
    raise exception 'INVALID_PAYMENT_REQUEST_ACTION' using errcode='22023';
  end if;

  if v_reference is null
     or char_length(v_reference)<3
     or char_length(v_reference)>240 then
    raise exception 'FINANCIAL_REFERENCE_REQUIRED' using errcode='22023';
  end if;

  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;

  if p_request_hash is null or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  if p_automatic_event_id is null then
  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_actor_user_id,
    'admin-ops:merchant-billing-payment-request:'||v_kind,
    p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if v_action.user_id<>p_actor_user_id
     or v_action.action_name<>
        'admin-ops:merchant-billing-payment-request:'||v_kind
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
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

  if v_request.status<>'pending' then
    raise exception 'PAYMENT_REQUEST_ALREADY_RESOLVED' using errcode='40001';
  end if;

  if p_automatic_event_id is not null and (
       not v_request.auto_applied
       or v_request.approval_source is distinct from 'provider_event'
       or v_request.provider_payment_event_id is distinct from p_automatic_event_id
       or v_request.request_kind not in ('package_purchase','statement_payment')
       or not exists(select 1 from public.merchant_billing_payment_events e
         where e.id=p_automatic_event_id and e.status='matched_exact'
           and e.payment_request_id=v_request.id and e.merchant_id=v_request.merchant_id
           and e.amount_cents=v_request.expected_amount_cents
           and e.payment_method='pix' and e.provider='mercadopago')) then
    raise exception 'AUTOMATIC_BILLING_EVENT_NOT_VERIFIED' using errcode='42501';
  end if;

  if v_kind='reject' then
    update public.merchant_billing_payment_requests
    set status='rejected',
        resolved_by=p_actor_user_id,
        resolved_at=clock_timestamp(),
        admin_reference=v_reference,
        updated_at=clock_timestamp()
    where id=v_request.id
    returning * into v_request;

  elsif v_request.request_kind='package_purchase' then
    select *
    into v_plan
    from public.merchant_billing_plans
    where plan_key=v_request.plan_key
      and active
      and billing_mode='prepaid_credit'
    for share;

    if not found
       or v_plan.purchase_amount_cents is distinct from v_request.expected_amount_cents
       or v_plan.credit_grant_cents is distinct from v_request.credit_grant_cents_snapshot
       or v_plan.platform_fee_bps is distinct from v_request.platform_fee_bps_snapshot then
      raise exception 'PACKAGE_TERMS_CHANGED' using errcode='40001';
    end if;

    insert into public.merchant_billing_accounts(merchant_id,plan_key)
    values(v_request.merchant_id,'flex_daily')
    on conflict(merchant_id) do nothing;

    perform pg_advisory_xact_lock(
      hashtextextended('merchant-fee-credit:'||v_request.merchant_id::text,0)
    );

    update public.merchant_billing_accounts
    set plan_key=v_plan.plan_key,
        credit_balance_cents=
          credit_balance_cents+v_request.credit_grant_cents_snapshot,
        updated_at=clock_timestamp()
    where merchant_id=v_request.merchant_id;

    insert into public.merchant_fee_credit_ledger(
      merchant_id,entry_type,amount_cents,plan_key,
      reference,created_by,payment_request_id
    )
    values(
      v_request.merchant_id,'package_credit',
      v_request.credit_grant_cents_snapshot,v_request.plan_key,
      v_reference,p_actor_user_id,v_request.id
    );

    update public.merchant_billing_payment_requests
    set status='approved',
        resolved_by=p_actor_user_id,
        resolved_at=clock_timestamp(),
        admin_reference=v_reference,
        updated_at=clock_timestamp()
    where id=v_request.id
    returning * into v_request;

  elsif v_request.request_kind='statement_payment' then
    select *
    into v_statement
    from public.merchant_daily_statements
    where id=v_request.statement_id
      and merchant_id=v_request.merchant_id
    for update;

    if not found then
      raise exception 'STATEMENT_NOT_FOUND' using errcode='P0002';
    end if;

    if v_statement.status not in ('open','overdue')
       or v_statement.amount_due_cents is distinct from
          v_request.expected_amount_cents then
      raise exception 'STATEMENT_TERMS_CHANGED' using errcode='40001';
    end if;

    update public.merchant_daily_statements
    set status='paid',
        paid_at=clock_timestamp(),
        waived_at=null,
        resolved_by=p_actor_user_id,
        resolution_reference=v_reference,
        updated_at=clock_timestamp()
    where id=v_statement.id;

    update public.platform_receivables
    set status='paid',
        paid_at=clock_timestamp(),
        waived_at=null,
        resolved_by=p_actor_user_id,
        resolution_reference=v_reference,
        updated_at=clock_timestamp()
    where daily_statement_id=v_statement.id
      and status='open';

    update public.merchant_billing_payment_requests
    set status='approved',
        resolved_by=p_actor_user_id,
        resolved_at=clock_timestamp(),
        admin_reference=v_reference,
        updated_at=clock_timestamp()
    where id=v_request.id
    returning * into v_request;

  elsif v_request.request_kind='refund_recovery' then
    select rr.*
    into v_recovery
    from public.merchant_billing_refund_recoveries rr
    where rr.id=v_request.refund_recovery_id
      and rr.merchant_id=v_request.merchant_id
    for update;

    if not found
       or v_recovery.status<>'payment_pending'
       or v_recovery.recovery_payment_request_id is distinct from v_request.id
       or v_request.expected_amount_cents<=0
       or v_request.expected_amount_cents>v_recovery.outstanding_cents then
      raise exception 'REFUND_RECOVERY_TERMS_CHANGED' using errcode='40001';
    end if;

    select *
    into v_refund
    from public.merchant_billing_payment_refunds
    where id=v_recovery.refund_id
      and merchant_id=v_request.merchant_id
    for update;

    if not found or v_refund.status<>'review_required' then
      raise exception 'REFUND_RECOVERY_TERMS_CHANGED' using errcode='40001';
    end if;

    update public.merchant_billing_payment_requests
    set status='approved',
        resolved_by=p_actor_user_id,
        resolved_at=clock_timestamp(),
        admin_reference=v_reference,
        updated_at=clock_timestamp()
    where id=v_request.id
    returning * into v_request;

    update public.merchant_billing_refund_recoveries
    set outstanding_cents=outstanding_cents-v_request.expected_amount_cents,
        status=case
          when outstanding_cents-v_request.expected_amount_cents=0
            then 'recovered'
          else 'open'
        end,
        recovery_payment_request_id=case
          when outstanding_cents-v_request.expected_amount_cents=0
            then v_request.id
          else null
        end,
        recovered_by=case
          when outstanding_cents-v_request.expected_amount_cents=0
            then p_actor_user_id
          else null
        end,
        recovered_at=case
          when outstanding_cents-v_request.expected_amount_cents=0
            then clock_timestamp()
          else null
        end,
        updated_at=clock_timestamp()
    where id=v_recovery.id
    returning * into v_recovery;

    if v_recovery.outstanding_cents=0 then
      update public.merchant_billing_payment_refunds
      set status='resolved_recovered',
          resolved_by=p_actor_user_id,
          resolved_at=clock_timestamp(),
          resolution_reference=
            'recovery-payment-request:'||v_request.id::text,
          updated_at=clock_timestamp()
      where id=v_refund.id;
    else
      update public.merchant_billing_payment_refunds
      set status='review_required',
          resolved_by=null,
          resolved_at=null,
          resolution_reference=null,
          updated_at=clock_timestamp()
      where id=v_refund.id;
    end if;

  else
    raise exception 'INVALID_PAYMENT_REQUEST_KIND' using errcode='40001';
  end if;

  perform public.process_merchant_billing_enforcement();

  v_result:=jsonb_build_object(
    'ok',true,
    'paymentRequestId',v_request.id,
    'requestKind',v_request.request_kind,
    'status',v_request.status,
    'merchantId',v_request.merchant_id,
    'refundRecoveryId',v_request.refund_recovery_id,
    'position',public.merchant_financial_position(v_request.merchant_id)
  );

  if p_automatic_event_id is null then
  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    'merchant_billing_payment_request_'||v_kind,
    'merchant_billing_payment_request',
    v_request.id::text,
    jsonb_build_object(
      'merchantId',v_request.merchant_id,
      'requestKind',v_request.request_kind,
      'planKey',v_request.plan_key,
      'statementId',v_request.statement_id,
      'refundRecoveryId',v_request.refund_recovery_id,
      'expectedAmountCents',v_request.expected_amount_cents,
      'reference',v_reference
    )
  );

  end if;

  return v_result;
end;
$function$;

revoke all on function tamao_billing_private.resolve_merchant_billing_payment_request(uuid,uuid,text,text,text,text,uuid)
 from public,anon,authenticated,service_role;
create or replace function public.admin_merchant_billing_payment_request_action(
 p_actor_user_id uuid,p_payment_request_id uuid,p_action text,p_reference text,
 p_idempotency_key text,p_request_hash text) returns jsonb
language sql security definer set search_path=pg_catalog as $$
 select tamao_billing_private.resolve_merchant_billing_payment_request(p_actor_user_id,p_payment_request_id,
  p_action,p_reference,p_idempotency_key,p_request_hash,null);
$$;
revoke all on function public.admin_merchant_billing_payment_request_action(uuid,uuid,text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.admin_merchant_billing_payment_request_action(uuid,uuid,text,text,text,text)
 to service_role,postgres;

CREATE OR REPLACE FUNCTION public.require_approved_payment_request_for_paid_statement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
        and (r.resolved_by is not null or (r.auto_applied
          and r.approval_source='provider_event' and r.provider_payment_event_id is not null))
        and r.resolved_at is not null
        and r.admin_reference is not null
    ) then
      raise exception 'STATEMENT_APPROVED_PAYMENT_REQUEST_REQUIRED'
        using errcode='42501';
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.audit_exact_billing_payment_confirmation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if old.status='pending' and new.status='approved' and not new.auto_applied then
    insert into public.platform_admin_audit(
      actor_user_id,action,target_type,target_id,metadata
    )
    values(
      new.resolved_by,
      'merchant_billing_payment_exact_confirmed',
      'merchant_billing_payment_request',
      new.id::text,
      jsonb_build_object(
        'merchantId',new.merchant_id,
        'requestKind',new.request_kind,
        'expectedAmountCents',new.expected_amount_cents,
        'receivedAmountCents',new.received_amount_cents,
        'paymentMethod',new.payment_method,
        'reconciliationKey',new.reconciliation_key,
        'approvalSource',new.approval_source,
        'providerPaymentEventId',new.provider_payment_event_id,
        'reference',new.admin_reference
      )
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_reconciled_payment_event_applied()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.status='approved'
     and old.status is distinct from new.status
     and new.reconciliation_key is not null then

    if new.approval_source='provider_event'
       and new.provider_payment_event_id is not null then
      update public.merchant_billing_payment_events e
      set status='applied',
          payment_request_id=new.id,
          merchant_id=new.merchant_id,
          match_reason='approved_payment_request_applied',
          applied_at=clock_timestamp(),
          applied_by=new.resolved_by,
          auto_applied=new.auto_applied,
          updated_at=clock_timestamp()
      where e.id=new.provider_payment_event_id
        and e.status='matched_exact'
        and e.payment_request_id=new.id
        and e.amount_cents=new.received_amount_cents
        and lower(trim(e.reconciliation_key))=
            lower(trim(new.reconciliation_key));

    elsif new.approval_source='manual' then
      update public.merchant_billing_payment_events e
      set status='already_applied',
          payment_request_id=new.id,
          merchant_id=new.merchant_id,
          match_reason='manual_approval_payment_already_confirmed',
          applied_at=null,
          applied_by=null,
          updated_at=clock_timestamp()
      where e.status='matched_exact'
        and e.payment_request_id=new.id
        and e.amount_cents=new.received_amount_cents
        and lower(trim(e.reconciliation_key))=
            lower(trim(new.reconciliation_key));
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.require_provider_event_approval_consistency()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_event public.merchant_billing_payment_events%rowtype;
begin
  if new.status='approved'
     and new.approval_source='provider_event' then
    select *
    into v_event
    from public.merchant_billing_payment_events
    where id=new.provider_payment_event_id;

    if not found
       or v_event.status<>'applied'
       or v_event.auto_applied is distinct from new.auto_applied
       or v_event.applied_by is distinct from new.resolved_by
       or v_event.payment_request_id is distinct from new.id
       or v_event.merchant_id is distinct from new.merchant_id
       or v_event.amount_cents is distinct from new.received_amount_cents
       or v_event.payment_method is distinct from new.payment_method
       or lower(trim(v_event.reconciliation_key))
          is distinct from lower(trim(new.reconciliation_key)) then
      raise exception 'PROVIDER_PAYMENT_EVENT_APPROVAL_INCONSISTENT'
        using errcode='42501';
    end if;
  end if;

  if new.status='approved' and new.auto_applied and not exists (
    select 1 from public.merchant_billing_auto_applications a
    where a.payment_request_id=new.id and a.payment_event_id=new.provider_payment_event_id
      and a.merchant_id=new.merchant_id and a.amount_cents=new.received_amount_cents
      and a.request_kind=new.request_kind) then
    raise exception 'AUTOMATIC_BILLING_AUDIT_REQUIRED' using errcode='42501';
  end if;
  return new;
end;
$function$;

-- Service-only capability, called after a fresh PSP lookup by the canonical handler.
create function public.apply_verified_merchant_billing_payment(p_event_id uuid,p_charge_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
 e public.merchant_billing_payment_events%rowtype;
 c public.merchant_billing_provider_charges%rowtype;
 r public.merchant_billing_payment_requests%rowtype;
 result jsonb;
 ref text;
begin
 select * into e from public.merchant_billing_payment_events where id=p_event_id for update;
 if not found then raise exception 'PAYMENT_EVENT_NOT_FOUND' using errcode='P0002';end if;
 perform pg_advisory_xact_lock(hashtextextended('merchant-billing-payment:'||lower(trim(e.reconciliation_key)),0));
 select * into c from public.merchant_billing_provider_charges where id=p_charge_id for update;
 if not found then raise exception 'PIX_CHARGE_NOT_FOUND' using errcode='P0002';end if;
 select * into r from public.merchant_billing_payment_requests where id=c.payment_request_id for update;
 if not found then raise exception 'PAYMENT_REQUEST_NOT_FOUND' using errcode='P0002';end if;
 if e.provider is distinct from 'mercadopago' or c.provider is distinct from e.provider
  or e.payment_method is distinct from 'pix' or e.currency is distinct from 'BRL' or c.currency is distinct from 'BRL'
  or c.provider_charge_id is null or c.provider_charge_id not like 'ORD%' or c.provider_charge_id like 'ORDTST%'
  or e.provider_event_id is distinct from 'order:'||c.provider_charge_id||':accredited'
  or e.reconciliation_key is distinct from 'mp-order:'||c.provider_charge_id
  or e.provider_correlation_id is distinct from c.correlation_id
  or c.status is distinct from 'completed' or c.paid_amount_cents is distinct from e.amount_cents
  or c.end_to_end_id is distinct from e.reconciliation_key
  or e.payment_request_id is distinct from r.id or e.merchant_id is distinct from r.merchant_id
  or c.merchant_id is distinct from r.merchant_id or c.amount_cents is distinct from r.expected_amount_cents
  or e.amount_cents is distinct from r.expected_amount_cents then
  raise exception 'AUTOMATIC_BILLING_BINDING_MISMATCH' using errcode='42501';
 end if;
 if exists(select 1 from public.merchant_billing_payment_refunds f where f.provider=e.provider
    and (f.payment_request_id=r.id or lower(trim(f.original_reconciliation_key))=lower(trim(e.reconciliation_key))))
  or exists(select 1 from public.merchant_billing_payment_events sibling where sibling.id<>e.id
    and lower(trim(sibling.reconciliation_key))=lower(trim(e.reconciliation_key))
    and sibling.status not in ('ignored','superseded')) then
  raise exception 'AUTOMATIC_BILLING_REVERSAL_OR_DUPLICATE_REVIEW' using errcode='40001';
 end if;
 if r.status='approved' and r.provider_payment_event_id=e.id and e.status='applied'
   and r.received_amount_cents=e.amount_cents and r.reconciliation_key=e.reconciliation_key then
  return jsonb_build_object('applied',true,'replayed',true,'paymentRequestId',r.id,
    'eventId',e.id,'merchantId',r.merchant_id,'status',r.status);
 end if;
 if r.status<>'pending' or e.status<>'matched_exact' then
  raise exception 'AUTOMATIC_BILLING_NOT_APPLICABLE' using errcode='40001';
 end if;
 if r.request_kind not in ('package_purchase','statement_payment') then
  return jsonb_build_object('applied',false,'reviewRequired',true,'reason','AUTOMATIC_REQUEST_KIND_REVIEW_REQUIRED');
 end if;
 ref:='provider-auto:'||e.id::text;
 update public.merchant_billing_payment_requests set
  received_amount_cents=e.amount_cents,payment_method=e.payment_method,reconciliation_key=e.reconciliation_key,
  approval_source='provider_event',provider_payment_event_id=e.id,auto_applied=true,updated_at=clock_timestamp()
 where id=r.id;
 result:=tamao_billing_private.resolve_merchant_billing_payment_request(null,r.id,'approve',ref,
  'provider-auto:'||r.id::text,encode(extensions.digest(e.id::text||':'||r.id::text,'sha256'),'hex'),e.id);
 insert into public.merchant_billing_auto_applications(payment_request_id,payment_event_id,charge_id,
  merchant_id,amount_cents,request_kind) values(r.id,e.id,c.id,r.merchant_id,e.amount_cents,r.request_kind);
 return result||jsonb_build_object('applied',true,'replayed',false,'eventId',e.id);
end $$;
revoke all on function public.apply_verified_merchant_billing_payment(uuid,uuid) from public,anon,authenticated;
grant execute on function public.apply_verified_merchant_billing_payment(uuid,uuid) to service_role,postgres;

-- Provider-paid D+1 receivables need a matching approved request at COMMIT.
alter table public.platform_receivables drop constraint platform_receivables_resolution_lifecycle;
alter table public.platform_receivables add constraint platform_receivables_resolution_lifecycle check (
 (status='open' and paid_at is null and waived_at is null and reversed_at is null and resolved_by is null and resolution_reference is null)
 or (status='paid' and paid_at is not null and waived_at is null and reversed_at is null and (
   (resolved_by is not null and resolution_reference is not null)
   or (resolved_by is null and resolution_reference='prepaid-credit' and prepaid_credit_applied_cents>=platform_fee_cents)
   or (resolved_by is null and resolution_reference ~ '^provider-auto:[0-9a-f-]{36}$' and daily_statement_id is not null)))
 or (status='waived' and paid_at is null and waived_at is not null and reversed_at is null and resolved_by is not null and resolution_reference is not null)
 or (status='reversed' and reversed_at is not null));
create function tamao_billing_private.require_auto_paid_receivable() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if new.status='paid' and new.resolved_by is null and new.resolution_reference like 'provider-auto:%'
  and not exists(select 1 from public.merchant_billing_payment_requests r
   join public.merchant_billing_auto_applications a on a.payment_request_id=r.id
   where r.statement_id=new.daily_statement_id and r.merchant_id=new.merchant_id
    and r.status='approved' and r.auto_applied and r.request_kind='statement_payment'
    and r.admin_reference=new.resolution_reference and r.provider_payment_event_id=a.payment_event_id) then
  raise exception 'AUTO_PAID_RECEIVABLE_PROOF_REQUIRED' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function tamao_billing_private.require_auto_paid_receivable() from public,anon,authenticated,service_role;
create constraint trigger auto_paid_receivable_proof after insert or update on public.platform_receivables
 deferrable initially deferred for each row execute function tamao_billing_private.require_auto_paid_receivable();
