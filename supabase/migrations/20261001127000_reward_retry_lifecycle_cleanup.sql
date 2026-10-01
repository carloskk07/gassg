-- Chama São Gabriel — reward retry lifecycle cleanup v1.7.9
-- A failure row is operational debt only while rewards are still eligible and
-- missing. Successful grant or financial reversal resolves it automatically.

create or replace function public.resolve_reward_processing_failure()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order_id uuid;
begin
  if tg_table_name='order_reward_grants' then
    v_order_id:=new.order_id;
  elsif tg_table_name='orders' then
    v_order_id:=new.id;

    if new.financial_state<>'reversed' then
      return new;
    end if;
  else
    return new;
  end if;

  update public.reward_processing_failures
  set resolved_at=coalesce(resolved_at,clock_timestamp()),
      updated_at=clock_timestamp()
  where order_id=v_order_id
    and resolved_at is null;

  return new;
end;
$$;

revoke all on function public.resolve_reward_processing_failure()
from public, anon, authenticated;
grant execute on function public.resolve_reward_processing_failure()
to postgres, service_role;

drop trigger if exists resolve_reward_failure_after_grant
on public.order_reward_grants;

create trigger resolve_reward_failure_after_grant
after insert on public.order_reward_grants
for each row
execute function public.resolve_reward_processing_failure();

drop trigger if exists resolve_reward_failure_after_reversal
on public.orders;

create trigger resolve_reward_failure_after_reversal
after update of financial_state on public.orders
for each row
when (
  new.financial_state='reversed'
  and old.financial_state is distinct from new.financial_state
)
execute function public.resolve_reward_processing_failure();
