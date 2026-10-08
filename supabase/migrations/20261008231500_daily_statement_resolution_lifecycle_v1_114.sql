-- TAMÃO — Daily statement resolution lifecycle v1.114
-- Makes the resolution instant of a D+1 statement authoritative.
--
-- Why this exists:
-- * open/overdue statements are live net positions and may still be adjusted;
-- * paid/waived statements are terminal accounting events;
-- * automatic fully-prepaid and net-zero paths previously could set status=paid
--   without stamping paid_at, making pre/post-resolution reversals ambiguous.
--
-- This migration does NOT try to infer the historical snapshot equation yet.
-- It first makes the lifecycle boundary explicit and immutable so a later proof
-- can classify reversals without heuristics.

do $function$
begin
  if exists(
    select 1
    from public.merchant_daily_statements s
    where
      (s.status in ('open','overdue')
       and (s.paid_at is not null or s.waived_at is not null))
      or (s.status='paid' and s.waived_at is not null)
      or (s.status='waived' and s.paid_at is not null)
  ) then
    raise exception 'DAILY_STATEMENT_RESOLUTION_LIFECYCLE_EXISTING_DRIFT'
      using errcode='23514';
  end if;
end;
$function$;

-- Legacy resolved rows that predate the lifecycle authority receive the best
-- existing server timestamp. Production currently has no statement rows, but
-- keeping this backfill makes the migration deterministic for replicas/branches.
update public.merchant_daily_statements
set paid_at=coalesce(paid_at,updated_at,closed_at,created_at,clock_timestamp())
where status='paid'
  and paid_at is null;

update public.merchant_daily_statements
set waived_at=coalesce(waived_at,updated_at,closed_at,created_at,clock_timestamp())
where status='waived'
  and waived_at is null;

alter table public.merchant_daily_statements
  drop constraint if exists merchant_daily_statements_resolution_timestamp_shape;

alter table public.merchant_daily_statements
  add constraint merchant_daily_statements_resolution_timestamp_shape
  check (
    (
      status in ('open','overdue')
      and paid_at is null
      and waived_at is null
    )
    or (
      status='paid'
      and paid_at is not null
      and waived_at is null
    )
    or (
      status='waived'
      and paid_at is null
      and waived_at is not null
    )
  );

create or replace function public.enforce_merchant_daily_statement_resolution_lifecycle()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $function$
begin
  -- A resolved statement is a terminal accounting fact. Normal user cleanup
  -- of resolved_by remains possible because that column is intentionally not
  -- part of this trigger (its FK uses ON DELETE SET NULL).
  if tg_op='UPDATE'
     and old.status in ('paid','waived') then
    if new.status is distinct from old.status
       or new.paid_at is distinct from old.paid_at
       or new.waived_at is distinct from old.waived_at then
      raise exception 'DAILY_STATEMENT_RESOLUTION_IMMUTABLE:%',
        old.id
        using errcode='23514';
    end if;
    return new;
  end if;

  if new.status='paid' then
    -- Ignore caller-supplied timestamps on the transition. The database clock
    -- is the authority for the resolution boundary.
    new.paid_at:=clock_timestamp();
    new.waived_at:=null;
  elsif new.status='waived' then
    new.waived_at:=clock_timestamp();
    new.paid_at:=null;
  else
    if new.paid_at is not null or new.waived_at is not null then
      raise exception 'DAILY_STATEMENT_UNRESOLVED_TIMESTAMP_FORBIDDEN:%',
        new.id
        using errcode='23514';
    end if;
    new.paid_at:=null;
    new.waived_at:=null;
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_merchant_daily_statement_resolution_lifecycle()
from public,anon,authenticated;
grant execute on function public.enforce_merchant_daily_statement_resolution_lifecycle()
to postgres,service_role;

drop trigger if exists enforce_daily_statement_resolution_lifecycle_trg
on public.merchant_daily_statements;

create trigger enforce_daily_statement_resolution_lifecycle_trg
before insert or update of status,paid_at,waived_at
on public.merchant_daily_statements
for each row
execute function public.enforce_merchant_daily_statement_resolution_lifecycle();

-- Final fail-closed proof after backfill + constraint installation.
do $function$
begin
  if exists(
    select 1
    from public.merchant_daily_statements s
    where not (
      (
        s.status in ('open','overdue')
        and s.paid_at is null
        and s.waived_at is null
      )
      or (
        s.status='paid'
        and s.paid_at is not null
        and s.waived_at is null
      )
      or (
        s.status='waived'
        and s.paid_at is null
        and s.waived_at is not null
      )
    )
  ) then
    raise exception 'DAILY_STATEMENT_RESOLUTION_LIFECYCLE_PROOF_FAILED'
      using errcode='23514';
  end if;
end;
$function$;
