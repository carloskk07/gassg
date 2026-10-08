-- TAMÃO — Refund recovery exposure cap v1.99
-- Multiple partial PSP refunds can never create recovery obligations above
-- the original payment. Excess provider facts remain immutable and visible,
-- but the excess amount is quarantined instead of becoming merchant debt.

do $$
begin
  if exists(
    select 1
    from public.merchant_billing_refund_recoveries rr
    join public.merchant_billing_payment_refunds r
      on r.id=rr.refund_id
    group by rr.original_payment_request_id
    having sum(rr.amount_cents)>max(r.original_payment_amount_cents)
  ) then
    raise exception 'V199_EXISTING_REFUND_RECOVERY_EXPOSURE_EXCEEDS_ORIGINAL'
      using errcode='40001';
  end if;
end $$;

alter table public.merchant_billing_payment_refunds
  drop constraint if exists merchant_billing_payment_refunds_status_check,
  drop constraint if exists merchant_billing_payment_refunds_resolution_shape;

alter table public.merchant_billing_payment_refunds
  add constraint merchant_billing_payment_refunds_status_check
  check (
    status in (
      'review_required','resolved_recovered',
      'ignored_unrelated','resolved_excess'
    )
  ),
  add constraint merchant_billing_payment_refunds_resolution_shape
  check (
    (
      status='review_required'
      and resolved_at is null
      and resolved_by is null
      and resolution_reference is null
    )
    or
    (
      status in ('resolved_recovered','ignored_unrelated','resolved_excess')
      and resolved_at is not null
      and resolved_by is not null
      and resolution_reference is not null
    )
  );

create or replace function public.guard_refund_recovery_exposure_cap()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_refund public.merchant_billing_payment_refunds%rowtype;
  v_allocated bigint:=0;
begin
  select *
  into v_refund
  from public.merchant_billing_payment_refunds
  where id=new.refund_id
  for share;

  if not found
     or v_refund.payment_request_id is distinct from new.original_payment_request_id
     or v_refund.merchant_id is distinct from new.merchant_id
     or v_refund.original_payment_amount_cents is null
     or new.amount_cents>v_refund.amount_cents then
    raise exception 'REFUND_RECOVERY_EXPOSURE_FACT_MISMATCH'
      using errcode='40001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'refund-recovery-exposure:'||new.original_payment_request_id::text,
      0
    )
  );

  select coalesce(sum(rr.amount_cents),0)
  into v_allocated
  from public.merchant_billing_refund_recoveries rr
  where rr.original_payment_request_id=new.original_payment_request_id
    and rr.id is distinct from new.id;

  if v_allocated+new.amount_cents>v_refund.original_payment_amount_cents then
    raise exception 'REFUND_RECOVERY_EXPOSURE_CAP_EXCEEDED'
      using errcode='23514';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_refund_recovery_exposure_cap()
from public,anon,authenticated;
grant execute on function public.guard_refund_recovery_exposure_cap()
to postgres,service_role;

drop trigger if exists guard_refund_recovery_exposure_cap_trg
on public.merchant_billing_refund_recoveries;
create trigger guard_refund_recovery_exposure_cap_trg
before insert or update of
  refund_id,merchant_id,original_payment_request_id,amount_cents
on public.merchant_billing_refund_recoveries
for each row execute function public.guard_refund_recovery_exposure_cap();

create or replace function public.ensure_provider_refund_recovery_obligation()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_recovery public.merchant_billing_refund_recoveries%rowtype;
  v_allocated bigint:=0;
  v_remaining bigint:=0;
  v_recoverable bigint:=0;
begin
  if new.status='review_required'
     and new.merchant_id is not null
     and new.payment_request_id is not null then

    if new.original_payment_amount_cents is null
       or new.original_payment_amount_cents<=0 then
      raise exception 'REFUND_RECOVERY_ORIGINAL_AMOUNT_MISSING'
        using errcode='40001';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'refund-recovery-exposure:'||new.payment_request_id::text,
        0
      )
    );

    select *
    into v_recovery
    from public.merchant_billing_refund_recoveries
    where refund_id=new.id
    for update;

    if found then
      if v_recovery.merchant_id is distinct from new.merchant_id
         or v_recovery.original_payment_request_id is distinct from new.payment_request_id
         or v_recovery.amount_cents>new.amount_cents
         or v_recovery.currency is distinct from new.currency then
        raise exception 'REFUND_RECOVERY_OBLIGATION_MISMATCH'
          using errcode='40001';
      end if;

      if new.match_reason<>'refund_total_exceeds_original'
         and v_recovery.amount_cents is distinct from new.amount_cents then
        raise exception 'REFUND_RECOVERY_OBLIGATION_MISMATCH'
          using errcode='40001';
      end if;

      return new;
    end if;

    select coalesce(sum(rr.amount_cents),0)
    into v_allocated
    from public.merchant_billing_refund_recoveries rr
    where rr.original_payment_request_id=new.payment_request_id;

    v_remaining:=greatest(new.original_payment_amount_cents-v_allocated,0);
    v_recoverable:=least(new.amount_cents,v_remaining);

    if v_recoverable<new.amount_cents
       and new.match_reason<>'refund_total_exceeds_original' then
      raise exception 'REFUND_RECOVERY_CAP_ALLOCATION_MISMATCH'
        using errcode='40001';
    end if;

    if v_recoverable>0 then
      insert into public.merchant_billing_refund_recoveries(
        refund_id,merchant_id,original_payment_request_id,
        amount_cents,currency,status
      )
      values(
        new.id,new.merchant_id,new.payment_request_id,
        v_recoverable,new.currency,'open'
      )
      returning * into v_recovery;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.ensure_provider_refund_recovery_obligation()
from public,anon,authenticated;
grant execute on function public.ensure_provider_refund_recovery_obligation()
to postgres,service_role;

create or replace function public.admin_merchant_billing_refund_action(
  p_actor_user_id uuid,
  p_refund_id uuid,
  p_action text,
  p_reference text,
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
  v_reference text:=nullif(trim(coalesce(p_reference,'')),'');
  v_action public.action_requests%rowtype;
  v_refund public.merchant_billing_payment_refunds%rowtype;
  v_result jsonb;
begin
  v_role:=public.platform_admin_role(p_actor_user_id);
  if v_role not in ('superadmin','finance') then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;

  if v_kind not in ('mark-recovered','dismiss-unrelated','dismiss-excess') then
    raise exception 'INVALID_PAYMENT_REFUND_ACTION' using errcode='22023';
  end if;

  if v_reference is null
     or char_length(v_reference)<3
     or char_length(v_reference)>240 then
    raise exception 'PAYMENT_REFUND_REFERENCE_REQUIRED' using errcode='22023';
  end if;

  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;

  if p_request_hash is null or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_actor_user_id,
    'admin-ops:merchant-billing-refund:'||v_kind,
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
        'admin-ops:merchant-billing-refund:'||v_kind
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select *
  into v_refund
  from public.merchant_billing_payment_refunds
  where id=p_refund_id
  for update;

  if not found then
    raise exception 'PAYMENT_REFUND_NOT_FOUND' using errcode='P0002';
  end if;

  if v_refund.status<>'review_required' then
    raise exception 'PAYMENT_REFUND_ALREADY_RESOLVED' using errcode='40001';
  end if;

  if v_kind='mark-recovered' then
    raise exception 'PAYMENT_REFUND_RECOVERY_PAYMENT_REQUIRED'
      using errcode='40001';
  end if;

  if v_kind='dismiss-unrelated' then
    if v_refund.payment_request_id is not null
       or v_refund.merchant_id is not null then
      raise exception 'PAYMENT_REFUND_LINKED_CANNOT_DISMISS'
        using errcode='40001';
    end if;

    update public.merchant_billing_payment_refunds
    set status='ignored_unrelated',
        resolved_by=p_actor_user_id,
        resolved_at=clock_timestamp(),
        resolution_reference=v_reference,
        updated_at=clock_timestamp()
    where id=v_refund.id
    returning * into v_refund;

  elsif v_kind='dismiss-excess' then
    if v_refund.payment_request_id is null
       or v_refund.merchant_id is null
       or v_refund.match_reason<>'refund_total_exceeds_original' then
      raise exception 'PAYMENT_REFUND_EXCESS_NOT_ELIGIBLE'
        using errcode='40001';
    end if;

    if exists(
      select 1
      from public.merchant_billing_refund_recoveries rr
      where rr.refund_id=v_refund.id
    ) then
      raise exception 'PAYMENT_REFUND_EXCESS_HAS_RECOVERY'
        using errcode='40001';
    end if;

    update public.merchant_billing_payment_refunds
    set status='resolved_excess',
        resolved_by=p_actor_user_id,
        resolved_at=clock_timestamp(),
        resolution_reference=v_reference,
        updated_at=clock_timestamp()
    where id=v_refund.id
    returning * into v_refund;
  end if;

  perform public.process_merchant_billing_enforcement();

  v_result:=jsonb_build_object(
    'ok',true,
    'refundId',v_refund.id,
    'status',v_refund.status,
    'merchantId',v_refund.merchant_id,
    'paymentRequestId',v_refund.payment_request_id,
    'resolutionReference',v_refund.resolution_reference
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    'merchant_billing_refund_'||replace(v_kind,'-','_'),
    'merchant_billing_payment_refund',
    v_refund.id::text,
    jsonb_build_object(
      'merchantId',v_refund.merchant_id,
      'paymentRequestId',v_refund.payment_request_id,
      'originalEndToEndId',v_refund.original_reconciliation_key,
      'refundEndToEndId',v_refund.refund_reconciliation_key,
      'amountCents',v_refund.amount_cents,
      'reference',v_reference
    )
  );

  return v_result;
end;
$$;



revoke all on function public.admin_merchant_billing_refund_action(
  uuid,uuid,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.admin_merchant_billing_refund_action(
  uuid,uuid,text,text,text,text
) to service_role,postgres;

create or replace function public.admin_merchant_billing_reconciliation(
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_role text;
  v_issue_count bigint:=0;
  v_critical_count bigint:=0;
  v_warning_count bigint:=0;
  v_stale_pending_count bigint:=0;
  v_matched_sla_breach_count bigint:=0;
  v_event_review_sla_breach_count bigint:=0;
  v_refund_recovery_sla_breach_count bigint:=0;
  v_finance_sla_breach_count bigint:=0;
  v_oldest_stale timestamptz;
  v_oldest_finance_sla timestamptz;
  v_issues jsonb:='[]'::jsonb;
begin
  v_role:=public.platform_admin_role(p_actor_user_id);
  if v_role not in ('superadmin','finance','readonly') then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;

  with
  ledger_balance as (
    select
      merchant_id,
      coalesce(sum(
        case
          when entry_type in ('package_credit','fee_consumption','admin_adjustment')
            then amount_cents
          else 0
        end
      ),0)::bigint as expected_balance_cents
    from public.merchant_fee_credit_ledger
    group by merchant_id
  ),
  order_reservations as (
    select
      merchant_id,
      coalesce(sum(prepaid_fee_reserved_cents_snapshot),0)::bigint
        as expected_reserved_cents
    from public.orders
    where prepaid_fee_reserved_cents_snapshot>0
      and prepaid_fee_credit_consumed_at is null
      and prepaid_fee_credit_released_at is null
      and status<>'CANCELLED'
    group by merchant_id
  ),
  refund_recovery_expected as (
    select
      r.id as refund_id,
      r.merchant_id,
      r.payment_request_id as original_payment_request_id,
      r.amount_cents as refund_amount_cents,
      r.currency,
      r.match_reason,
      greatest(
        least(
          r.amount_cents,
          coalesce(r.original_payment_amount_cents,0)
          -coalesce((
            select sum(rr2.amount_cents)
            from public.merchant_billing_refund_recoveries rr2
            where rr2.original_payment_request_id=r.payment_request_id
              and rr2.refund_id<>r.id
          ),0)
        ),
        0
      )::bigint as expected_recovery_cents
    from public.merchant_billing_payment_refunds r
    where r.status='review_required'
      and r.merchant_id is not null
      and r.payment_request_id is not null
  ),
  issue_rows as (
    select
      'critical'::text as severity,
      'account_ledger_balance_mismatch'::text as issue_type,
      a.merchant_id,
      a.merchant_id::text as entity_id,
      coalesce(l.expected_balance_cents,0)::bigint as expected_cents,
      a.credit_balance_cents::bigint as actual_cents,
      null::numeric as age_hours
    from public.merchant_billing_accounts a
    left join ledger_balance l on l.merchant_id=a.merchant_id
    where a.credit_balance_cents is distinct from coalesce(l.expected_balance_cents,0)

    union all

    select
      'critical','account_reserved_order_mismatch',
      a.merchant_id,a.merchant_id::text,
      coalesce(r.expected_reserved_cents,0)::bigint,
      a.credit_reserved_cents::bigint,
      null::numeric
    from public.merchant_billing_accounts a
    left join order_reservations r on r.merchant_id=a.merchant_id
    where a.credit_reserved_cents is distinct from coalesce(r.expected_reserved_cents,0)

    union all

    select
      'critical','flex_with_prepaid_credit',
      a.merchant_id,a.merchant_id::text,
      0::bigint,
      (a.credit_balance_cents+a.credit_reserved_cents)::bigint,
      null::numeric
    from public.merchant_billing_accounts a
    join public.merchant_billing_plans p on p.plan_key=a.plan_key
    where p.billing_mode='postpaid_daily'
      and (a.credit_balance_cents>0 or a.credit_reserved_cents>0)

    union all

    select
      'critical','approved_package_without_ledger_credit',
      r.merchant_id,r.id::text,
      r.credit_grant_cents_snapshot::bigint,
      coalesce(l.amount_cents,0)::bigint,
      extract(epoch from (clock_timestamp()-r.resolved_at))/3600
    from public.merchant_billing_payment_requests r
    left join public.merchant_fee_credit_ledger l
      on l.payment_request_id=r.id
     and l.entry_type='package_credit'
    where r.request_kind='package_purchase'
      and r.status='approved'
      and (
        l.id is null
        or l.merchant_id is distinct from r.merchant_id
        or l.amount_cents is distinct from r.credit_grant_cents_snapshot
      )

    union all

    select
      'critical','linked_package_credit_not_approved',
      l.merchant_id,l.id::text,
      coalesce(r.credit_grant_cents_snapshot,0)::bigint,
      l.amount_cents::bigint,
      null::numeric
    from public.merchant_fee_credit_ledger l
    left join public.merchant_billing_payment_requests r
      on r.id=l.payment_request_id
    where l.entry_type='package_credit'
      and l.payment_request_id is not null
      and (
        r.id is null
        or r.status<>'approved'
        or r.request_kind<>'package_purchase'
        or r.merchant_id is distinct from l.merchant_id
        or r.credit_grant_cents_snapshot is distinct from l.amount_cents
      )

    union all

    select
      'critical','approved_statement_not_paid',
      r.merchant_id,r.id::text,
      r.expected_amount_cents::bigint,
      coalesce(s.amount_due_cents,0)::bigint,
      extract(epoch from (clock_timestamp()-r.resolved_at))/3600
    from public.merchant_billing_payment_requests r
    left join public.merchant_daily_statements s on s.id=r.statement_id
    where r.request_kind='statement_payment'
      and r.status='approved'
      and (
        s.id is null
        or s.merchant_id is distinct from r.merchant_id
        or s.status<>'paid'
        or s.amount_due_cents is distinct from r.expected_amount_cents
      )

    union all

    select
      'warning','pending_statement_terms_changed',
      r.merchant_id,r.id::text,
      r.expected_amount_cents::bigint,
      coalesce(s.amount_due_cents,0)::bigint,
      extract(epoch from (clock_timestamp()-r.requested_at))/3600
    from public.merchant_billing_payment_requests r
    left join public.merchant_daily_statements s on s.id=r.statement_id
    where r.request_kind='statement_payment'
      and r.status='pending'
      and (
        s.id is null
        or s.merchant_id is distinct from r.merchant_id
        or s.status not in ('open','overdue')
        or s.amount_due_cents is distinct from r.expected_amount_cents
      )

    union all

    select
      'critical','resolved_statement_has_open_receivable',
      s.merchant_id,s.id::text,
      0::bigint,
      coalesce(sum(
        greatest(pr.platform_fee_cents-pr.prepaid_credit_applied_cents,0)
      ) filter (where pr.status='open'),0)::bigint,
      null::numeric
    from public.merchant_daily_statements s
    join public.platform_receivables pr on pr.daily_statement_id=s.id
    where s.status in ('paid','waived')
    group by s.id,s.merchant_id
    having count(*) filter (
      where pr.status='open'
        and pr.platform_fee_cents-pr.prepaid_credit_applied_cents>0
    )>0

    union all

    select
      'warning','overdue_without_sales_hold',
      s.merchant_id,s.id::text,
      s.amount_due_cents::bigint,
      0::bigint,
      extract(epoch from (clock_timestamp()-s.due_at))/3600
    from public.merchant_daily_statements s
    join public.merchant_billing_accounts a on a.merchant_id=s.merchant_id
    where s.status='overdue'
      and s.amount_due_cents>0
      and not a.sales_hold

    union all

    select
      'warning','sales_hold_without_overdue_statement',
      a.merchant_id,a.merchant_id::text,
      0::bigint,
      0::bigint,
      case when a.sales_hold_at is null then null
        else extract(epoch from (clock_timestamp()-a.sales_hold_at))/3600
      end
    from public.merchant_billing_accounts a
    where a.sales_hold
      and a.sales_hold_reason='daily_statement_overdue'
      and not exists(
        select 1
        from public.merchant_daily_statements s
        where s.merchant_id=a.merchant_id
          and s.status='overdue'
          and s.amount_due_cents>0
      )

    union all

    select
      'critical','refund_review_recovery_mismatch',
      x.merchant_id,x.refund_id::text,
      x.expected_recovery_cents::bigint,
      coalesce(rr.amount_cents,0)::bigint,
      extract(epoch from (clock_timestamp()-r.created_at))/3600
    from refund_recovery_expected x
    join public.merchant_billing_payment_refunds r
      on r.id=x.refund_id
    left join public.merchant_billing_refund_recoveries rr
      on rr.refund_id=x.refund_id
    where (
      x.expected_recovery_cents>0
      and (
        rr.id is null
        or rr.merchant_id is distinct from x.merchant_id
        or rr.original_payment_request_id is distinct from x.original_payment_request_id
        or rr.amount_cents is distinct from x.expected_recovery_cents
        or rr.currency is distinct from x.currency
        or rr.status not in ('open','payment_pending')
      )
    )
    or (
      x.expected_recovery_cents=0
      and rr.id is not null
    )

    union all

    select
      'critical','refund_recovery_exposure_cap_exceeded',
      rr.merchant_id,rr.original_payment_request_id::text,
      max(r.original_payment_amount_cents)::bigint,
      sum(rr.amount_cents)::bigint,
      null::numeric
    from public.merchant_billing_refund_recoveries rr
    join public.merchant_billing_payment_refunds r
      on r.id=rr.refund_id
    group by rr.merchant_id,rr.original_payment_request_id
    having sum(rr.amount_cents)>max(r.original_payment_amount_cents)

    union all

    select
      'critical','resolved_excess_with_recovery_obligation',
      r.merchant_id,r.id::text,
      0::bigint,
      coalesce(rr.amount_cents,0)::bigint,
      case when r.resolved_at is null then null
        else extract(epoch from (clock_timestamp()-r.resolved_at))/3600
      end
    from public.merchant_billing_payment_refunds r
    left join public.merchant_billing_refund_recoveries rr
      on rr.refund_id=r.id
    where r.status='resolved_excess'
      and (
        r.match_reason<>'refund_total_exceeds_original'
        or r.payment_request_id is null
        or r.merchant_id is null
        or rr.id is not null
      )

    union all

    select
      'critical','refund_recovery_request_mismatch',
      rr.merchant_id,rr.id::text,
      rr.amount_cents::bigint,
      coalesce(pr.expected_amount_cents,0)::bigint,
      extract(epoch from (clock_timestamp()-rr.updated_at))/3600
    from public.merchant_billing_refund_recoveries rr
    left join public.merchant_billing_payment_requests pr
      on pr.id=rr.recovery_payment_request_id
    where (
      rr.status='payment_pending'
      and (
        pr.id is null
        or pr.request_kind<>'refund_recovery'
        or pr.refund_recovery_id is distinct from rr.id
        or pr.merchant_id is distinct from rr.merchant_id
        or pr.expected_amount_cents is distinct from rr.amount_cents
        or pr.status<>'pending'
      )
    )
    or (
      rr.status='recovered'
      and (
        pr.id is null
        or pr.request_kind<>'refund_recovery'
        or pr.refund_recovery_id is distinct from rr.id
        or pr.merchant_id is distinct from rr.merchant_id
        or pr.expected_amount_cents is distinct from rr.amount_cents
        or pr.status<>'approved'
      )
    )

    union all

    select
      'critical','resolved_refund_without_recovered_obligation',
      r.merchant_id,r.id::text,
      r.amount_cents::bigint,
      coalesce(rr.amount_cents,0)::bigint,
      case when r.resolved_at is null then null
        else extract(epoch from (clock_timestamp()-r.resolved_at))/3600
      end
    from public.merchant_billing_payment_refunds r
    left join public.merchant_billing_refund_recoveries rr
      on rr.refund_id=r.id
    left join public.merchant_billing_payment_requests pr
      on pr.id=rr.recovery_payment_request_id
    where r.status='resolved_recovered'
      and (
        rr.id is null
        or rr.status<>'recovered'
        or pr.id is null
        or pr.status<>'approved'
        or pr.request_kind<>'refund_recovery'
        or r.resolution_reference is distinct from
          'recovery-payment-request:'||pr.id::text
      )

    union all

    select
      'critical','recovered_obligation_refund_not_resolved',
      rr.merchant_id,rr.id::text,
      rr.amount_cents::bigint,
      r.amount_cents::bigint,
      extract(epoch from (clock_timestamp()-rr.recovered_at))/3600
    from public.merchant_billing_refund_recoveries rr
    join public.merchant_billing_payment_refunds r
      on r.id=rr.refund_id
    where rr.status='recovered'
      and r.status<>'resolved_recovered'

    union all

    select
      'critical','refund_review_without_sales_hold',
      r.merchant_id,r.id::text,
      r.amount_cents::bigint,
      0::bigint,
      extract(epoch from (clock_timestamp()-r.created_at))/3600
    from public.merchant_billing_payment_refunds r
    left join public.merchant_billing_accounts a
      on a.merchant_id=r.merchant_id
    where r.status='review_required'
      and r.merchant_id is not null
      and r.payment_request_id is not null
      and coalesce(a.sales_hold,false)=false

    union all

    select
      'warning','refund_hold_without_review',
      a.merchant_id,a.merchant_id::text,
      0::bigint,0::bigint,
      case when a.sales_hold_at is null then null
        else extract(epoch from (clock_timestamp()-a.sales_hold_at))/3600
      end
    from public.merchant_billing_accounts a
    where a.sales_hold
      and a.sales_hold_reason='provider_payment_refund_review'
      and not exists(
        select 1
        from public.merchant_billing_payment_refunds r
        where r.merchant_id=a.merchant_id
          and r.status='review_required'
      )

    union all

    select
      'warning','refund_recovery_open_over_24h',
      rr.merchant_id,rr.id::text,
      rr.amount_cents::bigint,
      rr.amount_cents::bigint,
      extract(epoch from (clock_timestamp()-rr.created_at))/3600
    from public.merchant_billing_refund_recoveries rr
    where rr.status='open'
      and rr.created_at<clock_timestamp()-interval '24 hours'

    union all

    select
      'warning','pending_payment_review_over_24h',
      r.merchant_id,r.id::text,
      r.expected_amount_cents::bigint,
      r.expected_amount_cents::bigint,
      extract(epoch from (clock_timestamp()-r.requested_at))/3600
    from public.merchant_billing_payment_requests r
    where r.status='pending'
      and r.requested_at<clock_timestamp()-interval '24 hours'
      and not exists(
        select 1
        from public.merchant_billing_payment_events e
        where e.payment_request_id=r.id
          and e.status='matched_exact'
      )

    union all

    select
      'warning','matched_payment_approval_sla_over_2h',
      r.merchant_id,e.id::text,
      r.expected_amount_cents::bigint,
      e.amount_cents::bigint,
      extract(epoch from (clock_timestamp()-e.updated_at))/3600
    from public.merchant_billing_payment_events e
    join public.merchant_billing_payment_requests r
      on r.id=e.payment_request_id
    where e.status='matched_exact'
      and r.status='pending'
      and e.updated_at<clock_timestamp()-interval '2 hours'

    union all

    select
      'warning','payment_event_review_sla_over_4h',
      e.merchant_id,e.id::text,
      e.amount_cents::bigint,
      e.amount_cents::bigint,
      extract(epoch from (clock_timestamp()-e.updated_at))/3600
    from public.merchant_billing_payment_events e
    where e.status='review_required'
      and e.updated_at<clock_timestamp()-interval '4 hours'
  ),
  numbered as (
    select
      *,
      row_number() over(
        order by
          case severity when 'critical' then 0 else 1 end,
          case issue_type
            when 'matched_payment_approval_sla_over_2h' then 0
            when 'payment_event_review_sla_over_4h' then 1
            when 'refund_recovery_open_over_24h' then 2
            when 'pending_payment_review_over_24h' then 3
            else 4
          end,
          age_hours desc nulls last,
          merchant_id,
          entity_id
      ) as rn
    from issue_rows
  )
  select
    count(*),
    count(*) filter (where severity='critical'),
    count(*) filter (where severity='warning'),
    count(*) filter (where issue_type='pending_payment_review_over_24h'),
    count(*) filter (where issue_type='matched_payment_approval_sla_over_2h'),
    count(*) filter (where issue_type='payment_event_review_sla_over_4h'),
    count(*) filter (where issue_type='refund_recovery_open_over_24h'),
    count(*) filter (
      where issue_type in (
        'pending_payment_review_over_24h',
        'matched_payment_approval_sla_over_2h',
        'payment_event_review_sla_over_4h',
        'refund_recovery_open_over_24h'
      )
    ),
    min(
      clock_timestamp()-(coalesce(age_hours,0)*interval '1 hour')
    ) filter (where issue_type='pending_payment_review_over_24h'),
    min(
      clock_timestamp()-(coalesce(age_hours,0)*interval '1 hour')
    ) filter (
      where issue_type in (
        'pending_payment_review_over_24h',
        'matched_payment_approval_sla_over_2h',
        'payment_event_review_sla_over_4h',
        'refund_recovery_open_over_24h'
      )
    ),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'severity',severity,
          'issueType',issue_type,
          'merchantId',merchant_id,
          'entityId',entity_id,
          'expectedCents',expected_cents,
          'actualCents',actual_cents,
          'ageHours',case when age_hours is null then null else round(age_hours,2) end
        )
        order by rn
      ) filter (where rn<=100),
      '[]'::jsonb
    )
  into
    v_issue_count,
    v_critical_count,
    v_warning_count,
    v_stale_pending_count,
    v_matched_sla_breach_count,
    v_event_review_sla_breach_count,
    v_refund_recovery_sla_breach_count,
    v_finance_sla_breach_count,
    v_oldest_stale,
    v_oldest_finance_sla,
    v_issues
  from numbered;

  return jsonb_build_object(
    'generatedAt',clock_timestamp(),
    'healthy',v_issue_count=0,
    'issueCount',v_issue_count,
    'criticalCount',v_critical_count,
    'warningCount',v_warning_count,
    'stalePendingReviewCount',v_stale_pending_count,
    'oldestStalePendingAt',v_oldest_stale,
    'matchedApprovalSlaBreachCount',v_matched_sla_breach_count,
    'paymentEventReviewSlaBreachCount',v_event_review_sla_breach_count,
    'refundRecoveryOpenSlaBreachCount',v_refund_recovery_sla_breach_count,
    'financeQueueSlaBreachCount',v_finance_sla_breach_count,
    'oldestFinanceSlaBreachAt',v_oldest_finance_sla,
    'slaTargets',jsonb_build_object(
      'matchedApprovalHours',2,
      'paymentEventReviewHours',4,
      'refundRecoveryOpenHours',24,
      'pendingPaymentHours',24
    ),
    'issues',v_issues
  );
end;
$$;



revoke all on function public.admin_merchant_billing_reconciliation(uuid)
from public,anon,authenticated;
grant execute on function public.admin_merchant_billing_reconciliation(uuid)
to service_role,postgres;
