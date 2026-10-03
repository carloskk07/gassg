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


-- Scheduled rescue compatibility v1.35
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
      and (v_order.delivery_window_start is null or m.accepts_scheduled_orders)
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
       or (v_order.delivery_window_start is not null and not v_candidate_merchant.accepts_scheduled_orders)
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
