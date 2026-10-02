-- Chama São Gabriel — bounded reward retry and dead-letter v1.9.6
-- Delivery remains authoritative even when rewards fail. Automatic retries use
-- bounded backoff; permanent/stuck failures become explicit operational debt.

alter table public.reward_processing_failures
  alter column next_retry_at drop not null;

alter table public.reward_processing_failures
  add column if not exists last_attempt_at timestamptz,
  add column if not exists dead_lettered_at timestamptz;

alter table public.reward_processing_failures
  drop constraint if exists reward_processing_failure_terminal_state_check;

alter table public.reward_processing_failures
  add constraint reward_processing_failure_terminal_state_check
  check (not (resolved_at is not null and dead_lettered_at is not null));

drop index if exists public.reward_processing_failures_retry_idx;
create index reward_processing_failures_retry_idx
  on public.reward_processing_failures(next_retry_at)
  where resolved_at is null
    and dead_lettered_at is null
    and next_retry_at is not null;

create index if not exists reward_processing_failures_dead_letter_idx
  on public.reward_processing_failures(dead_lettered_at)
  where dead_lettered_at is not null
    and resolved_at is null;

create or replace function public.record_reward_processing_failure(
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
    raise exception 'INVALID_REWARD_ERROR' using errcode='22023';
  end if;

  v_permanent:=
    p_error like '%REWARD_BUDGET_INVARIANT_FAILED%'
    or p_error like '%ORDER_NOT_ELIGIBLE_FOR_REWARDS%'
    or p_error like '%FINANCIAL_POLICY_MISSING%'
    or p_error like '%ORDER_NOT_FOUND%';

  insert into public.reward_processing_failures(
    order_id,attempts,last_sqlstate,last_error,next_retry_at,
    last_attempt_at,resolved_at,dead_lettered_at,updated_at
  )
  values(
    p_order_id,1,p_sqlstate,left(p_error,2000),null,
    clock_timestamp(),null,null,clock_timestamp()
  )
  on conflict(order_id) do update
  set attempts=public.reward_processing_failures.attempts+1,
      last_sqlstate=excluded.last_sqlstate,
      last_error=excluded.last_error,
      last_attempt_at=clock_timestamp(),
      resolved_at=null,
      updated_at=clock_timestamp()
  returning attempts into v_attempts;

  v_dead_letter:=v_permanent or v_attempts>=8;

  if v_dead_letter then
    update public.reward_processing_failures
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

    update public.reward_processing_failures
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

revoke all on function public.record_reward_processing_failure(uuid,text,text)
from public, anon, authenticated;
grant execute on function public.record_reward_processing_failure(uuid,text,text)
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

create or replace function public.process_deferred_order_rewards()
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
    left join public.order_reward_grants g on g.order_id=o.id
    left join public.reward_processing_failures f on f.order_id=o.id
    where o.status='SETTLED'
      and o.financial_state='settled'
      and o.financial_reversed_at is null
      and o.payment_confirmed_at is not null
      and o.delivered_at is not null
      and g.order_id is null
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
      perform public.grant_order_rewards(v_order_id);

      update public.reward_processing_failures
      set resolved_at=clock_timestamp(),
          next_retry_at=null,
          dead_lettered_at=null,
          updated_at=clock_timestamp()
      where order_id=v_order_id
        and resolved_at is null;

      v_processed:=v_processed+1;
    exception when others then
      v_failure:=public.record_reward_processing_failure(
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

revoke all on function public.process_deferred_order_rewards()
from public, anon, authenticated;
grant execute on function public.process_deferred_order_rewards()
to postgres, service_role;

create or replace function public.resolve_reward_processing_failure()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if tg_table_name='order_reward_grants' then
    update public.reward_processing_failures
    set resolved_at=clock_timestamp(),
        next_retry_at=null,
        dead_lettered_at=null,
        updated_at=clock_timestamp()
    where order_id=new.order_id
      and resolved_at is null;
  elsif tg_table_name='order_financial_reversals' then
    update public.reward_processing_failures
    set resolved_at=clock_timestamp(),
        next_retry_at=null,
        dead_lettered_at=null,
        updated_at=clock_timestamp()
    where order_id=new.order_id
      and resolved_at is null;
  end if;

  return new;
end;
$$;

revoke all on function public.resolve_reward_processing_failure()
from public, anon, authenticated;
grant execute on function public.resolve_reward_processing_failure()
to postgres, service_role;
