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
  v_action public.action_requests%rowtype;
  v_quote public.quotes%rowtype;
  v_merchant public.merchants%rowtype;
  v_active integer:=0;
  v_result jsonb;
  v_order_id uuid;
  v_total integer;
  v_replay_cash_tender integer;
begin
  select * into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key;

  if found and v_action.completed_at is not null then
    if v_action.user_id<>p_user_id
       or v_action.action_name<>'create-order'
       or v_action.request_hash<>p_request_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
    end if;
    v_result:=v_action.result_json;
    v_order_id:=(v_result->>'orderId')::uuid;
    select o.cash_tender_cents
    into v_replay_cash_tender
    from public.orders o
    where o.id=v_order_id and o.customer_id=p_user_id;
    return v_result||jsonb_build_object('cashTenderCents',v_replay_cash_tender);
  end if;

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
  where (
    o.merchant_id=v_quote.merchant_id
    and o.status in (
      'OFFERED_TO_MERCHANT','MERCHANT_ACCEPTED','PREPARING',
      'AT_RISK','OUT_FOR_DELIVERY','ARRIVING'
    )
  ) or (
    o.proposed_merchant_id=v_quote.merchant_id
    and o.status='REQUOTE_REQUIRED'
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

create or replace function public.clear_invalid_cash_tender()
returns trigger
language plpgsql
set search_path = pg_catalog
as $
begin
  if new.cash_tender_cents is not null
     and (
       new.payment_method<>'cash'
       or new.cash_tender_cents<new.total_cents
     ) then
    new.cash_tender_cents:=null;
  end if;
  return new;
end;
$;

revoke all on function public.clear_invalid_cash_tender()
from public, anon, authenticated;
grant execute on function public.clear_invalid_cash_tender()
to postgres, service_role;

drop trigger if exists clear_invalid_cash_tender_before_order_update
on public.orders;

create trigger clear_invalid_cash_tender_before_order_update
before update of payment_method,total_cents,cash_tender_cents on public.orders
for each row
execute function public.clear_invalid_cash_tender();

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


-- Capacity-aware automatic rescue v1.34

-- Capacity-aware load: a requote held for customer approval reserves one slot
-- until it is accepted, cancelled or expires.
create or replace function public.merchant_offer_load(
  p_merchant_ids uuid[]
)
returns table(
  merchant_id uuid,
  active_orders integer,
  recent_orders_7d integer
)
language sql
security definer
set search_path = pg_catalog
as $$
  with requested as (
    select unnest(coalesce(p_merchant_ids,'{}'::uuid[])) as merchant_id
  ),
  active as (
    select x.merchant_id,count(*)::integer as n
    from (
      select o.id,o.merchant_id
      from public.orders o
      where o.merchant_id=any(coalesce(p_merchant_ids,'{}'::uuid[]))
        and o.status in (
          'OFFERED_TO_MERCHANT','MERCHANT_ACCEPTED','PREPARING',
          'AT_RISK','OUT_FOR_DELIVERY','ARRIVING'
        )
      union all
      select o.id,o.proposed_merchant_id as merchant_id
      from public.orders o
      where o.proposed_merchant_id=any(coalesce(p_merchant_ids,'{}'::uuid[]))
        and o.status='REQUOTE_REQUIRED'
    ) x
    group by x.merchant_id
  ),
  recent as (
    select o.merchant_id,count(*)::integer as n
    from public.orders o
    where o.merchant_id=any(coalesce(p_merchant_ids,'{}'::uuid[]))
      and o.created_at>=clock_timestamp()-interval '7 days'
      and o.status<>'CANCELLED'
    group by o.merchant_id
  )
  select r.merchant_id,
         coalesce(a.n,0)::integer,
         coalesce(x.n,0)::integer
  from requested r
  left join active a using(merchant_id)
  left join recent x using(merchant_id);
$$;

revoke all on function public.merchant_offer_load(uuid[])
from public, anon, authenticated;
grant execute on function public.merchant_offer_load(uuid[])
to service_role;

-- Chama São Gabriel — atomic rescue candidate locking v1.9.5
-- Rescue now locks and revalidates the candidate merchant and every requested
-- SKU before changing supplier or freezing a requote.

create or replace function public.system_rescue_order(
  p_order_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
  v_candidate_id uuid;
  v_candidate_merchant public.merchants%rowtype;
  v_candidate_gross integer:=0;
  v_candidate_fee integer:=0;
  v_candidate_valid boolean:=false;
  v_expected_items integer:=0;
  v_locked_items integer:=0;
  v_capacity_used integer:=0;
  v_item record;
  v_ci public.catalog_items%rowtype;
  v_new_reserved integer;
  v_release_diff integer;
  v_key text;
  v_result jsonb;
begin
  if p_reason is null or char_length(p_reason)<2 or char_length(p_reason)>120 then
    raise exception 'INVALID_RESCUE_REASON' using errcode='22023';
  end if;

  select *
  into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  if v_order.status<>'REASSIGNING' then
    raise exception 'INVALID_RESCUE_STATE' using errcode='40001';
  end if;

  v_key:='system-rescue:'||replace(v_order.id::text,'-','')||':'||v_order.version::text;

  select count(*)
  into v_expected_items
  from public.order_items
  where order_id=v_order.id;

  for v_candidate_id in
    select m.id
    from public.merchants m
    join public.order_items oi
      on oi.order_id=v_order.id
    join public.catalog_items ci
      on ci.merchant_id=m.id
     and ci.product_code=oi.product_code
     and ci.active
     and ci.available_stock>=oi.quantity
     and ci.price_confirmed_at is not null
     and ci.price_confirmed_at>=clock_timestamp()-interval '24 hours'
    where m.status='active'
      and public.merchant_operational_compliance_current(m.id)
      and m.online
      and m.accepts_citywide
      and m.last_seen_at>=clock_timestamp()-interval '10 minutes'
      and m.delivery_fee_confirmed_at is not null
      and m.delivery_fee_confirmed_at>=clock_timestamp()-interval '24 hours'
      and not (m.id=any(v_order.attempted_merchant_ids))
      and (
        select count(*)
        from public.orders cap
        where (
          cap.merchant_id=m.id
          and cap.status in (
            'OFFERED_TO_MERCHANT','MERCHANT_ACCEPTED','PREPARING',
            'AT_RISK','OUT_FOR_DELIVERY','ARRIVING'
          )
        ) or (
          cap.proposed_merchant_id=m.id
          and cap.status='REQUOTE_REQUIRED'
        )
      ) < m.max_active_orders
      and public.merchant_cart_delivery_compatible(
        m.id,
        array(
          select oi2.product_code
          from public.order_items oi2
          where oi2.order_id=v_order.id
          order by oi2.product_code
        )
      )
    group by m.id,m.delivery_fee_cents,m.base_eta_minutes,m.trust_score
    having count(*)=v_expected_items
    order by
      (sum(ci.price_cents*oi.quantity)+m.delivery_fee_cents) asc,
      m.base_eta_minutes asc,
      m.trust_score desc
    limit 20
  loop
    v_candidate_valid:=true;
    v_candidate_gross:=0;
    v_locked_items:=0;

    perform pg_advisory_xact_lock(
      hashtextextended('merchant-capacity:'||v_candidate_id::text,0)
    );

    select *
    into v_candidate_merchant
    from public.merchants
    where id=v_candidate_id
    for update skip locked;

    if not found
       or v_candidate_merchant.status<>'active'
       or not public.merchant_operational_compliance_current(v_candidate_id)
       or not v_candidate_merchant.online
       or not v_candidate_merchant.accepts_citywide
       or v_candidate_merchant.last_seen_at is null
       or v_candidate_merchant.last_seen_at<clock_timestamp()-interval '10 minutes'
       or v_candidate_merchant.delivery_fee_confirmed_at is null
       or v_candidate_merchant.delivery_fee_confirmed_at<clock_timestamp()-interval '24 hours'
       or not public.merchant_cart_delivery_compatible(
         v_candidate_id,
         array(
           select oi2.product_code
           from public.order_items oi2
           where oi2.order_id=v_order.id
           order by oi2.product_code
         )
       ) then
      v_candidate_valid:=false;
    end if;

    if v_candidate_valid then
      select count(*)::integer
      into v_capacity_used
      from public.orders cap
      where (
        cap.merchant_id=v_candidate_id
        and cap.status in (
          'OFFERED_TO_MERCHANT','MERCHANT_ACCEPTED','PREPARING',
          'AT_RISK','OUT_FOR_DELIVERY','ARRIVING'
        )
      ) or (
        cap.proposed_merchant_id=v_candidate_id
        and cap.status='REQUOTE_REQUIRED'
      );

      if v_capacity_used>=v_candidate_merchant.max_active_orders then
        v_candidate_valid:=false;
      end if;
    end if;

    if v_candidate_valid then
      v_candidate_fee:=v_candidate_merchant.delivery_fee_cents;
      v_candidate_gross:=v_candidate_fee;

      for v_item in
        select oi.product_code,oi.quantity
        from public.order_items oi
        where oi.order_id=v_order.id
        order by oi.product_code
      loop
        v_ci:=null;

        select ci.*
        into v_ci
        from public.catalog_items ci
        where ci.merchant_id=v_candidate_id
          and ci.product_code=v_item.product_code
        for update skip locked;

        if not found
           or not coalesce(v_ci.active,false)
           or coalesce(v_ci.available_stock,0)<v_item.quantity
           or v_ci.price_confirmed_at is null
           or v_ci.price_confirmed_at<clock_timestamp()-interval '24 hours' then
          v_candidate_valid:=false;
          exit;
        end if;

        v_candidate_gross:=v_candidate_gross+(v_ci.price_cents*v_item.quantity);
        v_locked_items:=v_locked_items+1;
      end loop;

      if v_locked_items<>v_expected_items then
        v_candidate_valid:=false;
      end if;
    end if;

    if v_candidate_valid then
      exit;
    end if;

    v_candidate_id:=null;
  end loop;

  if v_candidate_id is null or not v_candidate_valid then
    update public.orders
    set status='CANCELLED',
        supplier_name_snapshot=null,
        proposed_merchant_id=null,
        proposed_gross_total_cents=null,
        proposed_total_cents=null,
        proposed_delivery_fee_cents=null,
        risk_reason=p_reason,
        offer_expires_at=null,
        dispatch_due_at=null,
        promised_by=null,
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    if v_order.cashback_reserved_cents>0 then
      insert into public.wallet_entries(
        user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
      )
      values(
        v_order.customer_id,v_order.id,'cashback','cashback_release',
        v_order.cashback_reserved_cents,
        v_key||':cashback-release',
        jsonb_build_object('reason',p_reason)
      )
      on conflict(idempotency_key) do nothing;
    end if;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      v_order.id,null,'system','CANCELLED',
      'Pedido cancelado',
      'Nenhuma outra revenda elegível, estável e logisticamente compatível conseguiu assumir o pedido.',
      jsonb_build_object('reason',p_reason)
    );

    return jsonb_build_object(
      'ok',true,'orderId',v_order.id,'status','CANCELLED','version',v_order.version
    );
  end if;

  v_new_reserved:=least(v_order.cashback_reserved_cents,v_candidate_gross);
  v_release_diff:=v_order.cashback_reserved_cents-v_new_reserved;

  if v_release_diff>0 then
    insert into public.wallet_entries(
      user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
    )
    values(
      v_order.customer_id,v_order.id,'cashback','cashback_release',
      v_release_diff,
      v_key||':cashback-rebalance',
      jsonb_build_object('reason',p_reason)
    )
    on conflict(idempotency_key) do nothing;
  end if;

  if v_candidate_gross<=v_order.gross_total_cents then
    update public.orders
    set merchant_id=v_candidate_id,
        supplier_name_snapshot=null,
        gross_total_cents=v_candidate_gross,
        cashback_reserved_cents=v_new_reserved,
        total_cents=v_candidate_gross-v_new_reserved,
        proposed_merchant_id=null,
        proposed_gross_total_cents=null,
        proposed_total_cents=null,
        proposed_delivery_fee_cents=null,
        status='OFFERED_TO_MERCHANT',
        attempted_merchant_ids=array_append(attempted_merchant_ids,v_candidate_id),
        offer_expires_at=clock_timestamp()+interval '3 minutes',
        accepted_at=null,
        dispatch_due_at=null,
        promised_by=null,
        risk_reason=null,
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      v_order.id,null,'system','OFFERED_TO_MERCHANT',
      'Nova revenda acionada',
      'Outra revenda compatível recebeu o pedido sem aumento de preço; preço e estoque foram revalidados atomicamente.',
      jsonb_build_object('reason',p_reason)
    );

    v_result:=jsonb_build_object(
      'ok',true,'orderId',v_order.id,'status',v_order.status,'version',v_order.version,
      'totalCents',v_order.total_cents,'offerExpiresAt',v_order.offer_expires_at
    );
  else
    update public.orders
    set status='REQUOTE_REQUIRED',
        supplier_name_snapshot=null,
        proposed_merchant_id=v_candidate_id,
        proposed_gross_total_cents=v_candidate_gross,
        proposed_total_cents=v_candidate_gross-v_new_reserved,
        proposed_delivery_fee_cents=v_candidate_fee,
        offer_expires_at=clock_timestamp()+interval '5 minutes',
        accepted_at=null,
        dispatch_due_at=null,
        promised_by=null,
        risk_reason=p_reason,
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      v_order.id,null,'system','REQUOTE_REQUIRED',
      'Nova confirmação necessária',
      'A alternativa compatível possui preço diferente; preço e estoque foram revalidados e a condição fica reservada por até 5 minutos.',
      jsonb_build_object('reason',p_reason,'expiresAt',v_order.offer_expires_at)
    );

    v_result:=jsonb_build_object(
      'ok',true,'orderId',v_order.id,'status',v_order.status,'version',v_order.version,
      'proposedTotalCents',v_order.proposed_total_cents,
      'offerExpiresAt',v_order.offer_expires_at
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.system_rescue_order(uuid,text)
from public, anon, authenticated;
grant execute on function public.system_rescue_order(uuid,text)
to postgres, service_role;


-- Admin business observability without exposing raw operational tables to the browser.
create or replace function public.platform_business_metrics()
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  with settled_30 as (
    select o.*
    from public.orders o
    where o.status='SETTLED'
      and o.financial_state='settled'
      and coalesce(o.settled_at,o.updated_at)>=clock_timestamp()-interval '30 days'
  ),
  settled_90 as (
    select o.*
    from public.orders o
    where o.status='SETTLED'
      and o.financial_state='settled'
      and coalesce(o.settled_at,o.updated_at)>=clock_timestamp()-interval '90 days'
  ),
  orders_30 as (
    select o.*
    from public.orders o
    where o.created_at>=clock_timestamp()-interval '30 days'
  ),
  active_customers as (
    select distinct s.customer_id
    from settled_30 s
  ),
  repeat_customers as (
    select a.customer_id
    from active_customers a
    where (
      select count(*)
      from public.orders o
      where o.customer_id=a.customer_id
        and o.status='SETTLED'
        and o.financial_state='settled'
    )>=2
  ),
  support as (
    select count(*)::integer as open_count
    from public.support_cases sc
    where sc.status in ('open','in_review')
  ),
  fees as (
    select coalesce(sum(pr.platform_fee_cents),0)::bigint as generated
    from public.platform_receivables pr
    where pr.created_at>=clock_timestamp()-interval '30 days'
      and pr.status<>'reversed'
  ),
  cashback as (
    select coalesce(sum(g.cashback_cents),0)::bigint as granted
    from public.order_reward_grants g
    where g.created_at>=clock_timestamp()-interval '30 days'
      and g.reversed_at is null
  )
  select jsonb_build_object(
    'settledOrders30d',(select count(*) from settled_30),
    'gmvCents30d',(select coalesce(sum(gross_total_cents),0) from settled_30),
    'averageTicketCents30d',(
      select coalesce(round(avg(gross_total_cents)),0)::bigint from settled_30
    ),
    'activeCustomers30d',(select count(*) from active_customers),
    'repeatCustomers30d',(select count(*) from repeat_customers),
    'repeatRate30d',(
      select case when count(*)=0 then null
        else round(
          (select count(*)::numeric from repeat_customers)/count(*)::numeric,
          4
        )
      end
      from active_customers
    ),
    'createdOrders30d',(select count(*) from orders_30),
    'cancelledOrders30d',(select count(*) from orders_30 where status='CANCELLED'),
    'cancellationRate30d',(
      select case when count(*)=0 then null
        else round(
          count(*) filter (where status='CANCELLED')::numeric/count(*)::numeric,
          4
        )
      end
      from orders_30
    ),
    'settledOrders90d',(select count(*) from settled_90),
    'onTimeRate90d',(
      select case when count(*) filter (
        where delivered_at is not null and promised_by is not null
      )=0 then null
      else round(
        count(*) filter (
          where delivered_at is not null
            and promised_by is not null
            and delivered_at<=promised_by
        )::numeric
        /
        count(*) filter (
          where delivered_at is not null and promised_by is not null
        )::numeric,
        4
      ) end
      from settled_90
    ),
    'platformFeeGeneratedCents30d',(select generated from fees),
    'cashbackGrantedCents30d',(select granted from cashback),
    'openSupportCases',(select open_count from support)
  );
$$;

revoke all on function public.platform_business_metrics()
from public, anon, authenticated;
grant execute on function public.platform_business_metrics()
to service_role;


create or replace function public.admin_support_case_action(
  p_actor_user_id uuid,
  p_case_id uuid,
  p_status text,
  p_resolution_note text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_action public.action_requests%rowtype;
  v_case public.support_cases%rowtype;
  v_result jsonb;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_status not in ('in_review','resolved','closed') then
    raise exception 'INVALID_SUPPORT_STATUS' using errcode='22023';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null
     or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;
  if p_status in ('resolved','closed')
     and (
       p_resolution_note is null
       or char_length(trim(p_resolution_note))<3
       or char_length(trim(p_resolution_note))>1000
     ) then
    raise exception 'SUPPORT_RESOLUTION_NOTE_REQUIRED' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_actor_user_id,'admin-ops:support-case-status',p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if not found then
    raise exception 'IDEMPOTENCY_STATE_INVALID' using errcode='40001';
  end if;
  if v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'admin-ops:support-case-status'
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select *
  into v_case
  from public.support_cases
  where id=p_case_id
  for update;

  if not found then
    raise exception 'SUPPORT_CASE_NOT_FOUND' using errcode='P0002';
  end if;

  if v_case.status='closed' then
    raise exception 'SUPPORT_CASE_ALREADY_CLOSED' using errcode='40001';
  end if;
  if v_case.status='resolved' and p_status<>'closed' then
    raise exception 'INVALID_SUPPORT_TRANSITION' using errcode='40001';
  end if;

  update public.support_cases
  set status=p_status,
      resolution_note=case
        when p_resolution_note is null then resolution_note
        else left(trim(p_resolution_note),1000)
      end,
      resolved_at=case
        when p_status in ('resolved','closed')
          then coalesce(resolved_at,clock_timestamp())
        else null
      end,
      updated_at=clock_timestamp()
  where id=v_case.id
  returning * into v_case;

  insert into public.order_events(
    order_id,actor_user_id,actor_type,event_type,title,detail,metadata
  )
  values(
    v_case.order_id,p_actor_user_id,'admin','SUPPORT_CASE_UPDATED',
    case
      when p_status='in_review' then 'Atendimento em análise'
      when p_status='resolved' then 'Atendimento resolvido'
      else 'Atendimento encerrado'
    end,
    coalesce(v_case.resolution_note,'O status do atendimento foi atualizado.'),
    jsonb_build_object('supportCaseId',v_case.id,'status',v_case.status)
  );

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    'support-case-status',
    'support_case',
    v_case.id,
    jsonb_build_object(
      'orderId',v_case.order_id,
      'status',v_case.status
    )
  );

  v_result:=jsonb_build_object(
    'ok',true,
    'caseId',v_case.id,
    'orderId',v_case.order_id,
    'status',v_case.status,
    'resolvedAt',v_case.resolved_at
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.admin_support_case_action(
  uuid,uuid,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.admin_support_case_action(
  uuid,uuid,text,text,text,text
) to service_role;
