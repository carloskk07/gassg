-- Chama São Gabriel — payment capabilities + GLP container SKUs v1.36

create table if not exists public.merchant_payment_methods (
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  payment_method text not null check (payment_method in ('pix','card','cash')),
  active boolean not null default false,
  confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (merchant_id,payment_method)
);

alter table public.merchant_payment_methods enable row level security;
revoke all on table public.merchant_payment_methods from public, anon, authenticated;
grant all on table public.merchant_payment_methods to service_role;

create index if not exists merchant_payment_methods_active_idx
  on public.merchant_payment_methods(payment_method,merchant_id)
  where active;

create or replace function public.merchant_accepts_payment_method(
  p_merchant_id uuid,
  p_payment_method text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists(
    select 1
    from public.merchant_payment_methods p
    where p.merchant_id=p_merchant_id
      and p.payment_method=p_payment_method
      and p.active
  );
$$;

revoke all on function public.merchant_accepts_payment_method(uuid,text)
from public, anon, authenticated;
grant execute on function public.merchant_accepts_payment_method(uuid,text)
to service_role, postgres;

alter table public.quotes
  add column if not exists payment_method_requested text;

alter table public.quotes
  drop constraint if exists quotes_payment_method_requested_check,
  add constraint quotes_payment_method_requested_check
    check (
      payment_method_requested is null
      or payment_method_requested in ('pix','card','cash')
    );

create or replace function public.is_glp_container_product_code(
  p_product_code text
)
returns boolean
language sql
immutable
security definer
set search_path = pg_catalog
as $$
  select upper(trim(coalesce(p_product_code,'')))
    ~ '^P([1-9][0-9]?)_CONTAINER$'
  and substring(
    upper(trim(coalesce(p_product_code,'')))
    from '^P([1-9][0-9]?)_CONTAINER$'
  )::integer between 1 and 90;
$$;

revoke all on function public.is_glp_container_product_code(text)
from public, anon, authenticated;
grant execute on function public.is_glp_container_product_code(text)
to service_role, postgres;

create or replace function public.merchant_cart_delivery_compatible(
  p_merchant_id uuid,
  p_product_codes text[]
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_requested integer;
  v_covered integer;
  v_has_glp_family boolean;
  v_has_non_glp boolean;
begin
  if p_merchant_id is null
     or p_product_codes is null
     or cardinality(p_product_codes)<1 then
    return false;
  end if;

  with requested as (
    select distinct upper(trim(x)) product_code
    from unnest(p_product_codes) x
    where trim(x)<>''
  ),
  classified as (
    select
      r.product_code,
      (
        p.product_code is not null
        or public.is_glp_product_code(r.product_code)
        or public.is_glp_container_product_code(r.product_code)
      ) as covered,
      (
        public.is_glp_product_code(r.product_code)
        or public.is_glp_container_product_code(r.product_code)
        or p.delivery_class in ('regulated_glp','regulated_glp_container')
      ) as glp_family
    from requested r
    left join public.product_delivery_profiles p
      on p.product_code=r.product_code
     and p.active
  )
  select
    count(*),
    count(*) filter (where covered),
    coalesce(bool_or(glp_family),false),
    coalesce(bool_or(covered and not glp_family),false)
  into
    v_requested,
    v_covered,
    v_has_glp_family,
    v_has_non_glp
  from classified;

  if v_requested<1 or v_covered<>v_requested then
    return false;
  end if;

  if not (v_has_glp_family and v_has_non_glp) then
    return true;
  end if;

  return exists(
    select 1
    from public.merchant_delivery_capabilities c
    where c.merchant_id=p_merchant_id
      and c.capability_code='regulated_glp_mixed_load_verified'
      and c.active
      and c.verified_at is not null
  );
end;
$$;

revoke all on function public.merchant_cart_delivery_compatible(uuid,text[])
from public, anon, authenticated;
grant execute on function public.merchant_cart_delivery_compatible(uuid,text[])
to service_role, postgres;

create or replace function public.payment_method_accept_guard()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.status='OFFERED_TO_MERCHANT'
     and new.status='PREPARING'
     and not public.merchant_accepts_payment_method(
       new.merchant_id,
       new.payment_method
     ) then
    raise exception 'PAYMENT_METHOD_UNAVAILABLE' using errcode='40001';
  end if;
  return new;
end;
$$;

revoke all on function public.payment_method_accept_guard()
from public, anon, authenticated;
grant execute on function public.payment_method_accept_guard()
to postgres, service_role;

drop trigger if exists payment_method_accept_before_order_update
on public.orders;

create trigger payment_method_accept_before_order_update
before update of status,merchant_id,payment_method
on public.orders
for each row
execute function public.payment_method_accept_guard();

create or replace function public.create_order_from_quote_v4(
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
  v_order public.orders%rowtype;
  v_result jsonb;
  v_order_id uuid;
begin
  select *
  into v_action
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

    select *
    into v_order
    from public.orders o
    where o.id=v_order_id
      and o.customer_id=p_user_id;

    return v_result||jsonb_build_object(
      'cashTenderCents',v_order.cash_tender_cents,
      'deliveryWindowStart',v_order.delivery_window_start,
      'deliveryWindowEnd',v_order.delivery_window_end,
      'comparisonSavingsCents',v_order.comparison_savings_cents
    );
  end if;

  select *
  into v_quote
  from public.quotes q
  where q.id=p_quote_id
    and q.customer_id=p_user_id;

  if not found then
    raise exception 'QUOTE_NOT_FOUND' using errcode='P0002';
  end if;

  if v_quote.payment_method_requested is null
     or v_quote.payment_method_requested<>p_payment_method then
    raise exception 'PAYMENT_METHOD_MISMATCH' using errcode='22023';
  end if;

  if not public.merchant_accepts_payment_method(
    v_quote.merchant_id,
    p_payment_method
  ) then
    raise exception 'PAYMENT_METHOD_UNAVAILABLE' using errcode='40001';
  end if;

  return public.create_order_from_quote_v3(
    p_user_id,
    p_quote_id,
    p_payment_method,
    p_use_cashback,
    p_idempotency_key,
    p_request_hash,
    p_referral_code,
    p_cash_tender_cents
  );
end;
$$;

revoke all on function public.create_order_from_quote_v4(
  uuid,uuid,text,boolean,text,text,text,integer
) from public, anon, authenticated;
grant execute on function public.create_order_from_quote_v4(
  uuid,uuid,text,boolean,text,text,text,integer
) to service_role;

-- Payment-aware automatic rescue.
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
      and public.merchant_accepts_payment_method(m.id,v_order.payment_method)
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
       or not public.merchant_accepts_payment_method(v_candidate_id,v_order.payment_method)
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
