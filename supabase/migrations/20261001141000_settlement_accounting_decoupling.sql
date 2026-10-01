-- Chama São Gabriel — settlement accounting decoupling v1.9.8
-- Platform receivables and merchant cashback reimbursement are financial
-- settlement records, not optional rewards. They are created independently
-- from cashback/referral processing and retried on their own queue.

create table if not exists public.settlement_accounting_failures (
  order_id uuid primary key references public.orders(id) on delete cascade,
  attempts integer not null default 1 check (attempts between 1 and 1000000),
  last_sqlstate text,
  last_error text not null check (char_length(last_error) between 1 and 2000),
  next_retry_at timestamptz,
  last_attempt_at timestamptz,
  dead_lettered_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not (resolved_at is not null and dead_lettered_at is not null))
);

alter table public.settlement_accounting_failures enable row level security;
revoke all on table public.settlement_accounting_failures from anon, authenticated;
grant all on table public.settlement_accounting_failures to service_role;

create index if not exists settlement_accounting_failures_retry_idx
  on public.settlement_accounting_failures(next_retry_at)
  where resolved_at is null
    and dead_lettered_at is null
    and next_retry_at is not null;

create index if not exists settlement_accounting_failures_dead_letter_idx
  on public.settlement_accounting_failures(dead_lettered_at)
  where resolved_at is null
    and dead_lettered_at is not null;

create or replace function public.ensure_order_settlement_accounting(
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
  v_platform_fee integer:=0;
begin
  select *
  into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  if v_order.status<>'SETTLED'
     or v_order.financial_state<>'settled'
     or v_order.financial_reversed_at is not null
     or v_order.merchant_id is null
     or v_order.payment_confirmed_at is null
     or v_order.delivered_at is null then
    raise exception 'ORDER_NOT_ELIGIBLE_FOR_ACCOUNTING' using errcode='40001';
  end if;

  v_platform_fee:=floor(
    (v_order.gross_total_cents::numeric*v_order.platform_fee_bps_snapshot)/10000
  )::integer;

  insert into public.platform_receivables(
    order_id,merchant_id,gross_total_cents,
    platform_fee_bps,platform_fee_cents,status,due_at
  )
  values(
    v_order.id,v_order.merchant_id,v_order.gross_total_cents,
    v_order.platform_fee_bps_snapshot,v_platform_fee,
    'open',clock_timestamp()+interval '7 days'
  )
  on conflict(order_id) do nothing;

  if v_order.cashback_reserved_cents>0 then
    insert into public.merchant_cashback_reimbursements(
      order_id,merchant_id,cashback_cents,status,due_at
    )
    values(
      v_order.id,v_order.merchant_id,v_order.cashback_reserved_cents,
      'open',clock_timestamp()+interval '7 days'
    )
    on conflict(order_id) do nothing;
  end if;

  update public.settlement_accounting_failures
  set resolved_at=clock_timestamp(),
      next_retry_at=null,
      dead_lettered_at=null,
      updated_at=clock_timestamp()
  where order_id=v_order.id
    and resolved_at is null;

  return jsonb_build_object(
    'ok',true,
    'orderId',v_order.id,
    'platformFeeCents',v_platform_fee,
    'cashbackReimbursementCents',v_order.cashback_reserved_cents
  );
end;
$$;

revoke all on function public.ensure_order_settlement_accounting(uuid)
from public, anon, authenticated;
grant execute on function public.ensure_order_settlement_accounting(uuid)
to postgres, service_role;

create or replace function public.record_settlement_accounting_failure(
  p_order_id uuid,
  p_sqlstate text,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_attempts integer;
  v_delay_minutes integer;
  v_permanent boolean:=false;
  v_dead_letter boolean:=false;
  v_next_retry timestamptz;
begin
  if p_order_id is null then
    raise exception 'INVALID_ORDER' using errcode='22023';
  end if;

  if p_error is null or char_length(trim(p_error))<1 then
    raise exception 'INVALID_ACCOUNTING_ERROR' using errcode='22023';
  end if;

  v_permanent:=
    p_error like '%ORDER_NOT_ELIGIBLE_FOR_ACCOUNTING%'
    or p_error like '%ORDER_NOT_FOUND%';

  insert into public.settlement_accounting_failures(
    order_id,attempts,last_sqlstate,last_error,next_retry_at,
    last_attempt_at,resolved_at,dead_lettered_at,updated_at
  )
  values(
    p_order_id,1,p_sqlstate,left(p_error,2000),null,
    clock_timestamp(),null,null,clock_timestamp()
  )
  on conflict(order_id) do update
  set attempts=public.settlement_accounting_failures.attempts+1,
      last_sqlstate=excluded.last_sqlstate,
      last_error=excluded.last_error,
      last_attempt_at=clock_timestamp(),
      resolved_at=null,
      updated_at=clock_timestamp()
  returning attempts into v_attempts;

  v_dead_letter:=v_permanent or v_attempts>=8;

  if v_dead_letter then
    update public.settlement_accounting_failures
    set next_retry_at=null,
        dead_lettered_at=coalesce(dead_lettered_at,clock_timestamp()),
        updated_at=clock_timestamp()
    where order_id=p_order_id;
    v_next_retry:=null;
  else
    v_delay_minutes:=case v_attempts
      when 1 then 5
      when 2 then 15
      when 3 then 30
      when 4 then 60
      when 5 then 120
      when 6 then 240
      else 360
    end;

    v_next_retry:=clock_timestamp()+make_interval(mins=>v_delay_minutes);

    update public.settlement_accounting_failures
    set next_retry_at=v_next_retry,
        dead_lettered_at=null,
        updated_at=clock_timestamp()
    where order_id=p_order_id;
  end if;

  return jsonb_build_object(
    'orderId',p_order_id,
    'attempts',v_attempts,
    'deadLettered',v_dead_letter,
    'nextRetryAt',v_next_retry,
    'permanent',v_permanent
  );
end;
$$;

revoke all on function public.record_settlement_accounting_failure(uuid,text,text)
from public, anon, authenticated;
grant execute on function public.record_settlement_accounting_failure(uuid,text,text)
to postgres, service_role;

create or replace function public.on_order_settled_grant_rewards()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.status='SETTLED'
     and old.status is distinct from new.status then

    begin
      perform public.ensure_order_settlement_accounting(new.id);
    exception when others then
      perform public.record_settlement_accounting_failure(
        new.id,sqlstate,sqlerrm
      );
    end;

    begin
      perform public.grant_order_rewards(new.id);

      update public.reward_processing_failures
      set resolved_at=clock_timestamp(),
          next_retry_at=null,
          dead_lettered_at=null,
          updated_at=clock_timestamp()
      where order_id=new.id
        and resolved_at is null;
    exception when others then
      perform public.record_reward_processing_failure(
        new.id,sqlstate,sqlerrm
      );
    end;
  end if;

  return new;
end;
$$;

revoke all on function public.on_order_settled_grant_rewards()
from public, anon, authenticated;
grant execute on function public.on_order_settled_grant_rewards()
to postgres, service_role;

create or replace function public.process_deferred_settlement_accounting()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order_id uuid;
  v_failure jsonb;
  v_processed integer:=0;
  v_failed integer:=0;
  v_dead_lettered integer:=0;
begin
  for v_order_id in
    select o.id
    from public.orders o
    left join public.platform_receivables pr on pr.order_id=o.id
    left join public.settlement_accounting_failures f on f.order_id=o.id
    where o.status='SETTLED'
      and o.financial_state='settled'
      and o.financial_reversed_at is null
      and o.payment_confirmed_at is not null
      and o.delivered_at is not null
      and pr.order_id is null
      and (
        f.order_id is null
        or (
          f.resolved_at is null
          and f.dead_lettered_at is null
          and f.next_retry_at is not null
          and f.next_retry_at<=clock_timestamp()
        )
      )
    order by o.settled_at nulls last,o.created_at
    limit 100
  loop
    begin
      perform public.ensure_order_settlement_accounting(v_order_id);
      v_processed:=v_processed+1;
    exception when others then
      v_failure:=public.record_settlement_accounting_failure(
        v_order_id,sqlstate,sqlerrm
      );
      if coalesce((v_failure->>'deadLettered')::boolean,false) then
        v_dead_lettered:=v_dead_lettered+1;
      else
        v_failed:=v_failed+1;
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'processed',v_processed,
    'failed',v_failed,
    'deadLettered',v_dead_lettered
  );
end;
$$;

revoke all on function public.process_deferred_settlement_accounting()
from public, anon, authenticated;
grant execute on function public.process_deferred_settlement_accounting()
to postgres, service_role;

create or replace function public.resolve_settlement_accounting_failure()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  update public.settlement_accounting_failures
  set resolved_at=clock_timestamp(),
      next_retry_at=null,
      dead_lettered_at=null,
      updated_at=clock_timestamp()
  where order_id=new.order_id
    and resolved_at is null;

  return new;
end;
$$;

revoke all on function public.resolve_settlement_accounting_failure()
from public, anon, authenticated;
grant execute on function public.resolve_settlement_accounting_failure()
to postgres, service_role;

drop trigger if exists resolve_accounting_failure_after_receivable
on public.platform_receivables;
create trigger resolve_accounting_failure_after_receivable
after insert on public.platform_receivables
for each row
execute function public.resolve_settlement_accounting_failure();

drop trigger if exists resolve_accounting_failure_after_reversal
on public.order_financial_reversals;
create trigger resolve_accounting_failure_after_reversal
after insert on public.order_financial_reversals
for each row
execute function public.resolve_settlement_accounting_failure();

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname='chama-settlement-accounting-retry';

  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  perform cron.schedule(
    'chama-settlement-accounting-retry',
    '*/5 * * * *',
    'select public.process_deferred_settlement_accounting();'
  );
end;
$$;
