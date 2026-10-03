-- Chama São Gabriel — scheduling, comparison savings and referral growth v1.35

alter table public.merchants
  add column if not exists accepts_scheduled_orders boolean not null default false;

alter table public.quotes
  add column if not exists delivery_window_start timestamptz,
  add column if not exists delivery_window_end timestamptz,
  add column if not exists comparison_reference_cents integer;

alter table public.quotes
  drop constraint if exists quotes_delivery_window_pair,
  add constraint quotes_delivery_window_pair check (
    (delivery_window_start is null and delivery_window_end is null)
    or
    (
      delivery_window_start is not null
      and delivery_window_end is not null
      and delivery_window_end>delivery_window_start
      and delivery_window_end-delivery_window_start between interval '1 hour' and interval '4 hours'
    )
  ),
  drop constraint if exists quotes_comparison_reference_check,
  add constraint quotes_comparison_reference_check check (
    comparison_reference_cents is null
    or comparison_reference_cents>=gross_total_cents
  );

alter table public.orders
  add column if not exists delivery_window_start timestamptz,
  add column if not exists delivery_window_end timestamptz,
  add column if not exists comparison_selected_total_cents integer,
  add column if not exists comparison_reference_cents integer,
  add column if not exists comparison_savings_cents integer not null default 0;

alter table public.orders
  drop constraint if exists orders_delivery_window_pair,
  add constraint orders_delivery_window_pair check (
    (delivery_window_start is null and delivery_window_end is null)
    or
    (
      delivery_window_start is not null
      and delivery_window_end is not null
      and delivery_window_end>delivery_window_start
      and delivery_window_end-delivery_window_start between interval '1 hour' and interval '4 hours'
    )
  ),
  drop constraint if exists orders_comparison_savings_snapshot,
  add constraint orders_comparison_savings_snapshot check (
    (
      comparison_selected_total_cents is null
      and comparison_reference_cents is null
      and comparison_savings_cents=0
    )
    or
    (
      comparison_selected_total_cents is not null
      and comparison_reference_cents is not null
      and comparison_selected_total_cents>=0
      and comparison_reference_cents>=comparison_selected_total_cents
      and comparison_savings_cents=comparison_reference_cents-comparison_selected_total_cents
    )
  );

create index if not exists orders_scheduled_window_idx
  on public.orders(delivery_window_start)
  where delivery_window_start is not null
    and status in ('OFFERED_TO_MERCHANT','MERCHANT_ACCEPTED','PREPARING','AT_RISK');

create or replace function public.scheduled_delivery_timing_guard()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_eta integer;
  v_dispatch_open timestamptz;
begin
  if new.delivery_window_start is null then
    return new;
  end if;

  select m.base_eta_minutes
  into v_eta
  from public.merchants m
  where m.id=new.merchant_id;

  v_eta:=greatest(5,least(180,coalesce(v_eta,30)));

  if old.status='OFFERED_TO_MERCHANT'
     and new.status='PREPARING' then
    new.dispatch_due_at:=greatest(
      clock_timestamp()+interval '3 minutes',
      new.delivery_window_start-make_interval(mins=>v_eta)
    );
    new.promised_by:=new.delivery_window_end;
  end if;

  if old.status in ('PREPARING','AT_RISK')
     and new.status='OUT_FOR_DELIVERY' then
    v_dispatch_open:=new.delivery_window_start-make_interval(mins=>v_eta+30);
    if clock_timestamp()<v_dispatch_open then
      raise exception 'SCHEDULED_DISPATCH_TOO_EARLY' using errcode='40001';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.scheduled_delivery_timing_guard()
from public, anon, authenticated;
grant execute on function public.scheduled_delivery_timing_guard()
to postgres, service_role;

drop trigger if exists scheduled_delivery_timing_before_order_update
on public.orders;

create trigger scheduled_delivery_timing_before_order_update
before update of status,merchant_id,delivery_window_start,delivery_window_end
on public.orders
for each row
execute function public.scheduled_delivery_timing_guard();

create or replace function public.create_order_from_quote_v3(
  p_user_id uuid,
  p_quote_id uuid,
  p_payment_method text,
  p_use_cashback boolean,
  p_idempotency_key text,
  p_request_hash text,
  p_referral_code text default null,
  p_cash_tender_cents integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_quote public.quotes%rowtype;
  v_merchant public.merchants%rowtype;
  v_result jsonb;
  v_order_id uuid;
  v_reference integer;
  v_savings integer;
begin
  select *
  into v_quote
  from public.quotes
  where id=p_quote_id
    and customer_id=p_user_id;

  if not found then
    raise exception 'QUOTE_NOT_FOUND' using errcode='P0002';
  end if;

  if (v_quote.delivery_window_start is null)<>(v_quote.delivery_window_end is null) then
    raise exception 'INVALID_DELIVERY_WINDOW' using errcode='22023';
  end if;

  if v_quote.delivery_window_start is not null then
    if v_quote.delivery_window_start<clock_timestamp()+interval '30 minutes'
       or v_quote.delivery_window_start>clock_timestamp()+interval '72 hours'
       or v_quote.delivery_window_end<=v_quote.delivery_window_start
       or v_quote.delivery_window_end-v_quote.delivery_window_start not between interval '1 hour' and interval '4 hours' then
      raise exception 'INVALID_DELIVERY_WINDOW' using errcode='22023';
    end if;

    select *
    into v_merchant
    from public.merchants
    where id=v_quote.merchant_id;

    if not found
       or not v_merchant.accepts_scheduled_orders then
      raise exception 'SCHEDULED_DELIVERY_UNAVAILABLE' using errcode='40001';
    end if;
  end if;

  v_result:=public.create_order_from_quote_v2(
    p_user_id,
    p_quote_id,
    p_payment_method,
    p_use_cashback,
    p_idempotency_key,
    p_request_hash,
    p_referral_code,
    p_cash_tender_cents
  );

  v_order_id:=(v_result->>'orderId')::uuid;
  v_reference:=greatest(
    v_quote.gross_total_cents,
    coalesce(v_quote.comparison_reference_cents,v_quote.gross_total_cents)
  );
  v_savings:=greatest(0,v_reference-v_quote.gross_total_cents);

  update public.orders
  set delivery_window_start=v_quote.delivery_window_start,
      delivery_window_end=v_quote.delivery_window_end,
      comparison_selected_total_cents=v_quote.gross_total_cents,
      comparison_reference_cents=v_reference,
      comparison_savings_cents=v_savings
  where id=v_order_id
    and customer_id=p_user_id;

  return v_result||jsonb_build_object(
    'deliveryWindowStart',v_quote.delivery_window_start,
    'deliveryWindowEnd',v_quote.delivery_window_end,
    'comparisonSavingsCents',v_savings
  );
end;
$$;

revoke all on function public.create_order_from_quote_v3(
  uuid,uuid,text,boolean,text,text,text,integer
) from public, anon, authenticated;
grant execute on function public.create_order_from_quote_v3(
  uuid,uuid,text,boolean,text,text,text,integer
) to service_role;


create or replace function public.customer_benefit_totals(
  p_user_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'comparisonSavingsCents',
      coalesce((
        select sum(o.comparison_savings_cents)
        from public.orders o
        where o.customer_id=p_user_id
          and o.status='SETTLED'
          and o.financial_state='settled'
      ),0),
    'cashbackEarnedCents',
      coalesce((
        select sum(g.cashback_cents)
        from public.order_reward_grants g
        where g.customer_id=p_user_id
          and g.reversed_at is null
      ),0)
  );
$$;

revoke all on function public.customer_benefit_totals(uuid)
from public, anon, authenticated;
grant execute on function public.customer_benefit_totals(uuid)
to service_role;
