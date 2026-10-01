-- Chama São Gabriel — restore spent cashback on financial reversal v1.7.4
-- A full post-settlement financial reversal must return cashback that the
-- customer spent on that order, in addition to reversing rewards earned.

create or replace function public.restore_spent_cashback_on_financial_reversal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
begin
  select *
  into v_order
  from public.orders
  where id=new.order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  if v_order.cashback_reserved_cents>0 then
    insert into public.wallet_entries(
      user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
    )
    values(
      v_order.customer_id,
      v_order.id,
      'cashback',
      'cashback_release',
      v_order.cashback_reserved_cents,
      'reversal:'||replace(v_order.id::text,'-','')||':cashback-spent-return',
      jsonb_build_object(
        'reason','post_settlement_financial_reversal',
        'reversalReason',new.reason,
        'reference',new.reference
      )
    )
    on conflict(idempotency_key) do nothing;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      v_order.id,
      null,
      'system',
      'CASHBACK_RESTORED',
      'Cashback usado devolvido',
      'O cashback utilizado como parte do pagamento foi devolvido após a reversão financeira.',
      jsonb_build_object(
        'amountCents',v_order.cashback_reserved_cents,
        'reference',new.reference
      )
    );
  end if;

  return new;
end;
$$;

revoke all on function public.restore_spent_cashback_on_financial_reversal()
from public, anon, authenticated;
grant execute on function public.restore_spent_cashback_on_financial_reversal()
to postgres, service_role;

drop trigger if exists restore_spent_cashback_after_financial_reversal
on public.order_financial_reversals;

create trigger restore_spent_cashback_after_financial_reversal
after insert on public.order_financial_reversals
for each row
execute function public.restore_spent_cashback_on_financial_reversal();
