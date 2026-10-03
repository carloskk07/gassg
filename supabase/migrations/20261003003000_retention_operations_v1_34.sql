-- Chama São Gabriel — retention and operational reliability v1.34
-- Adds merchant capacity authority, cash-change intent, customer feedback/support,
-- objective merchant performance aggregates, and an atomic create-order v2 wrapper.

alter table public.merchants
  add column if not exists max_active_orders smallint not null default 8;

alter table public.merchants
  drop constraint if exists merchants_max_active_orders_check,
  add constraint merchants_max_active_orders_check
    check (max_active_orders between 1 and 100);

alter table public.orders
  add column if not exists cash_tender_cents integer;

alter table public.orders
  drop constraint if exists orders_cash_tender_check,
  add constraint orders_cash_tender_check
    check (
      cash_tender_cents is null
      or (
        payment_method='cash'
        and cash_tender_cents between 1 and 1000000
      )
    );

create table if not exists public.order_feedback (
  order_id uuid primary key references public.orders(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete restrict,
  merchant_id uuid not null references public.merchants(id) on delete restrict,
  rating smallint not null check (rating in (1,5)),
  tags text[] not null default '{}'::text[],
  note text check (note is null or char_length(note)<=500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(tags)<=8)
);

alter table public.order_feedback enable row level security;
revoke all on table public.order_feedback from anon, authenticated;
grant all on table public.order_feedback to service_role;

create index if not exists order_feedback_merchant_created_idx
  on public.order_feedback(merchant_id,created_at desc);

create table if not exists public.support_cases (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  customer_id uuid not null references auth.users(id) on delete restrict,
  merchant_id uuid references public.merchants(id) on delete restrict,
  category text not null
    check (category in ('late','wrong_item','price_payment','no_show','delivery','other')),
  status text not null default 'open'
    check (status in ('open','in_review','resolved','closed')),
  message text check (message is null or char_length(message)<=1000),
  request_idempotency_key text not null unique
    check (char_length(request_idempotency_key) between 12 and 120),
  request_hash text not null
    check (request_hash~'^[0-9a-f]{64}$'),
  resolved_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(resolution_note)<=1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status in ('resolved','closed') and resolved_at is not null)
    or
    (status in ('open','in_review') and resolved_at is null)
  )
);

alter table public.support_cases enable row level security;
revoke all on table public.support_cases from anon, authenticated;
grant all on table public.support_cases to service_role;

create index if not exists support_cases_customer_created_idx
  on public.support_cases(customer_id,created_at desc);

create index if not exists support_cases_order_created_idx
  on public.support_cases(order_id,created_at desc);

create index if not exists support_cases_open_idx
  on public.support_cases(created_at)
  where status in ('open','in_review');

create unique index if not exists support_cases_one_open_category_idx
  on public.support_cases(customer_id,order_id,category)
  where status in ('open','in_review');

create or replace function public.create_order_from_quote_v2(
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
  v_active integer:=0;
  v_result jsonb;
  v_order_id uuid;
  v_total integer;
begin
  if p_payment_method not in ('pix','card','cash') then
    raise exception 'INVALID_PAYMENT_METHOD' using errcode='22023';
  end if;

  if p_payment_method<>'cash' and p_cash_tender_cents is not null then
    raise exception 'CASH_TENDER_REQUIRES_CASH' using errcode='22023';
  end if;

  if p_cash_tender_cents is not null
     and (p_cash_tender_cents<1 or p_cash_tender_cents>1000000) then
    raise exception 'INVALID_CASH_TENDER' using errcode='22023';
  end if;

  select * into v_quote
  from public.quotes
  where id=p_quote_id and customer_id=p_user_id;

  if not found then
    raise exception 'QUOTE_NOT_FOUND' using errcode='P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('merchant-capacity:'||v_quote.merchant_id::text,0)
  );

  select * into v_merchant
  from public.merchants
  where id=v_quote.merchant_id;

  if not found then
    raise exception 'QUOTE_STALE' using errcode='40001';
  end if;

  select count(*)::integer
  into v_active
  from public.orders o
  where o.merchant_id=v_quote.merchant_id
    and o.status in (
      'OFFERED_TO_MERCHANT','MERCHANT_ACCEPTED','PREPARING',
      'AT_RISK','OUT_FOR_DELIVERY','ARRIVING'
    );

  if v_active>=v_merchant.max_active_orders then
    raise exception 'MERCHANT_AT_CAPACITY' using errcode='40001';
  end if;

  v_result:=public.create_order_from_quote(
    p_user_id,
    p_quote_id,
    p_payment_method,
    p_use_cashback,
    p_idempotency_key,
    p_request_hash,
    p_referral_code
  );

  v_order_id:=(v_result->>'orderId')::uuid;
  v_total:=(v_result->>'totalCents')::integer;

  if p_payment_method='cash'
     and p_cash_tender_cents is not null
     and p_cash_tender_cents<v_total then
    raise exception 'INVALID_CASH_TENDER' using errcode='22023';
  end if;

  update public.orders
  set cash_tender_cents=p_cash_tender_cents
  where id=v_order_id
    and customer_id=p_user_id;

  return v_result||jsonb_build_object('cashTenderCents',p_cash_tender_cents);
end;
$$;

revoke all on function public.create_order_from_quote_v2(
  uuid,uuid,text,boolean,text,text,text,integer
) from public, anon, authenticated;
grant execute on function public.create_order_from_quote_v2(
  uuid,uuid,text,boolean,text,text,text,integer
) to service_role;

create or replace function public.merchant_public_performance(
  p_merchant_ids uuid[]
)
returns table(
  merchant_id uuid,
  completed_orders integer,
  completion_rate numeric,
  on_time_rate numeric,
  avg_accept_seconds integer,
  feedback_count integer,
  positive_feedback_rate numeric
)
language sql
security definer
set search_path = pg_catalog
as $$
  with requested as (
    select unnest(coalesce(p_merchant_ids,'{}'::uuid[])) as merchant_id
  ),
  orders_90d as (
    select
      o.merchant_id,
      count(*) filter (where o.status='SETTLED')::integer as completed_orders,
      count(*) filter (
        where o.accepted_at is not null
          and o.status in ('SETTLED','CANCELLED')
      )::integer as terminal_after_accept,
      count(*) filter (
        where o.accepted_at is not null
          and o.status='SETTLED'
      )::integer as settled_after_accept,
      count(*) filter (
        where o.status='SETTLED'
          and o.delivered_at is not null
          and o.promised_by is not null
      )::integer as timed_deliveries,
      count(*) filter (
        where o.status='SETTLED'
          and o.delivered_at is not null
          and o.promised_by is not null
          and o.delivered_at<=o.promised_by
      )::integer as on_time_deliveries,
      round(avg(extract(epoch from (o.accepted_at-o.created_at)))
        filter (where o.accepted_at is not null))::integer as avg_accept_seconds
    from public.orders o
    where o.merchant_id=any(coalesce(p_merchant_ids,'{}'::uuid[]))
      and o.created_at>=clock_timestamp()-interval '90 days'
    group by o.merchant_id
  ),
  feedback as (
    select
      f.merchant_id,
      count(*)::integer as feedback_count,
      count(*) filter (where f.rating=5)::integer as positive_feedback
    from public.order_feedback f
    where f.merchant_id=any(coalesce(p_merchant_ids,'{}'::uuid[]))
      and f.created_at>=clock_timestamp()-interval '180 days'
    group by f.merchant_id
  )
  select
    r.merchant_id,
    coalesce(o.completed_orders,0)::integer,
    case when coalesce(o.terminal_after_accept,0)>0
      then round(o.settled_after_accept::numeric/o.terminal_after_accept,4)
      else null end,
    case when coalesce(o.timed_deliveries,0)>0
      then round(o.on_time_deliveries::numeric/o.timed_deliveries,4)
      else null end,
    o.avg_accept_seconds,
    coalesce(f.feedback_count,0)::integer,
    case when coalesce(f.feedback_count,0)>0
      then round(f.positive_feedback::numeric/f.feedback_count,4)
      else null end
  from requested r
  left join orders_90d o using(merchant_id)
  left join feedback f using(merchant_id);
$$;

revoke all on function public.merchant_public_performance(uuid[])
from public, anon, authenticated;
grant execute on function public.merchant_public_performance(uuid[])
to service_role;
