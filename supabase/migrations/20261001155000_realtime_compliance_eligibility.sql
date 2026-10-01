-- Chama São Gabriel — real-time compliance eligibility v1.15.5
-- Compliance expiry is enforced on every critical path, not only by the daily watchdog.

create or replace function public.merchant_operational_compliance_current(
  p_merchant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    public.merchant_cnpj_compliance_current(p_merchant_id)
    and public.merchant_anp_compliance_current(p_merchant_id);
$$;

revoke all on function public.merchant_operational_compliance_current(uuid)
from public, anon, authenticated;
grant execute on function public.merchant_operational_compliance_current(uuid)
to postgres, service_role;

create or replace function public.enforce_glp_catalog_compliance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_status text;
  v_anp_current boolean:=false;
begin
  if not new.active
     or not public.is_glp_product_code(new.product_code) then
    return new;
  end if;

  select m.status
  into v_status
  from public.merchants m
  where m.id=new.merchant_id;

  if not found then
    raise exception 'MERCHANT_NOT_FOUND' using errcode='P0002';
  end if;

  if v_status='active' then
    if not public.merchant_cnpj_compliance_current(new.merchant_id) then
      raise exception 'CNPJ_REVERIFICATION_REQUIRED' using errcode='23514';
    end if;

    select coalesce(
      c.anp_status='verified'
      and c.anp_verified_at is not null
      and c.anp_verified_at>=clock_timestamp()-make_interval(days=>p.anp_max_age_days),
      false
    )
    into v_anp_current
    from public.merchant_compliance c
    cross join public.merchant_compliance_policy p
    where c.merchant_id=new.merchant_id
      and p.policy_key='default';

    if not coalesce(v_anp_current,false) then
      raise exception 'ANP_REVERIFICATION_REQUIRED' using errcode='23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_glp_catalog_compliance()
from public, anon, authenticated;
grant execute on function public.enforce_glp_catalog_compliance()
to postgres, service_role;

CREATE OR REPLACE FUNCTION public.create_quote_snapshot(p_user_id uuid, p_merchant_id uuid, p_address text, p_delivery_fee_cents integer, p_eta_min_minutes integer, p_eta_max_minutes integer, p_expires_at timestamp with time zone, p_items jsonb, p_fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_quote public.quotes%rowtype;
  v_merchant public.merchants%rowtype;
  v_expected_count integer;
  v_catalog_count integer;
  v_subtotal bigint;
  v_gross integer;
begin
  if p_user_id is null or p_merchant_id is null then
    raise exception 'INVALID_QUOTE_OWNER' using errcode='22023';
  end if;

  if p_address is null
     or char_length(trim(p_address))<5
     or char_length(trim(p_address))>240 then
    raise exception 'INVALID_ADDRESS' using errcode='22023';
  end if;

  if p_delivery_fee_cents is null or p_delivery_fee_cents<0 then
    raise exception 'INVALID_DELIVERY_FEE' using errcode='22023';
  end if;

  if p_eta_min_minutes is null
     or p_eta_min_minutes<1
     or p_eta_max_minutes is null
     or p_eta_max_minutes<p_eta_min_minutes
     or p_eta_max_minutes>240 then
    raise exception 'INVALID_ETA' using errcode='22023';
  end if;

  if p_expires_at is null
     or p_expires_at<=clock_timestamp()+interval '30 seconds'
     or p_expires_at>clock_timestamp()+interval '10 minutes' then
    raise exception 'INVALID_QUOTE_EXPIRY' using errcode='22023';
  end if;

  if p_fingerprint is null or p_fingerprint!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_QUOTE_FINGERPRINT' using errcode='22023';
  end if;

  if p_items is null
     or jsonb_typeof(p_items)<>'array'
     or jsonb_array_length(p_items)<1
     or jsonb_array_length(p_items)>10 then
    raise exception 'INVALID_QUOTE_ITEMS' using errcode='22023';
  end if;

  if not public.merchant_operational_compliance_current(p_merchant_id) then
    raise exception 'QUOTE_SOURCE_STALE' using errcode='40001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_user_id::text||':'||p_merchant_id::text||':'||p_fingerprint,
      0
    )
  );

  select *
  into v_quote
  from public.quotes
  where customer_id=p_user_id
    and merchant_id=p_merchant_id
    and snapshot_fingerprint=p_fingerprint
    and consumed_at is null
    and expires_at>clock_timestamp()+interval '60 seconds'
  order by expires_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'quoteId',v_quote.id,
      'grossTotalCents',v_quote.gross_total_cents,
      'etaMinMinutes',v_quote.eta_min_minutes,
      'etaMaxMinutes',v_quote.eta_max_minutes,
      'expiresAt',v_quote.expires_at,
      'reused',true
    );
  end if;

  select *
  into v_merchant
  from public.merchants
  where id=p_merchant_id
  for share;

  if not found
     or v_merchant.status<>'active'
     or not v_merchant.online
     or not v_merchant.accepts_citywide
     or v_merchant.last_seen_at is null
     or v_merchant.last_seen_at<clock_timestamp()-interval '10 minutes'
     or v_merchant.delivery_fee_confirmed_at is null
     or v_merchant.delivery_fee_confirmed_at<clock_timestamp()-interval '24 hours'
     or v_merchant.delivery_fee_cents<>p_delivery_fee_cents then
    raise exception 'QUOTE_SOURCE_STALE' using errcode='40001';
  end if;

  with requested as (
    select
      upper(trim(x.product_code)) product_code,
      x.quantity,
      x.unit_price_cents
    from jsonb_to_recordset(p_items) as x(
      product_code text,
      quantity integer,
      unit_price_cents integer
    )
  )
  select
    count(*),
    count(distinct product_code)
  into
    v_expected_count,
    v_catalog_count
  from requested
  where product_code is not null
    and quantity between 1 and 99
    and unit_price_cents>0;

  if v_expected_count<>jsonb_array_length(p_items)
     or v_catalog_count<>v_expected_count then
    raise exception 'INVALID_QUOTE_ITEMS' using errcode='22023';
  end if;

  -- Lock the exact catalog rows while the quote snapshot is built. This keeps
  -- price/stock confirmation stable until quote + quote_items are committed.
  perform ci.product_code
  from jsonb_to_recordset(p_items) as x(
    product_code text,
    quantity integer,
    unit_price_cents integer
  )
  join public.catalog_items ci
    on ci.merchant_id=p_merchant_id
   and ci.product_code=upper(trim(x.product_code))
  order by ci.product_code
  for share of ci;

  with requested as (
    select
      upper(trim(x.product_code)) product_code,
      x.quantity,
      x.unit_price_cents
    from jsonb_to_recordset(p_items) as x(
      product_code text,
      quantity integer,
      unit_price_cents integer
    )
  )
  select
    count(*),
    coalesce(sum(ci.price_cents*r.quantity),0)
  into
    v_catalog_count,
    v_subtotal
  from requested r
  join public.catalog_items ci
    on ci.merchant_id=p_merchant_id
   and ci.product_code=r.product_code
   and ci.active
   and ci.available_stock>=r.quantity
   and ci.price_cents=r.unit_price_cents
   and ci.price_confirmed_at is not null
   and ci.price_confirmed_at>=clock_timestamp()-interval '24 hours';

  if v_catalog_count<>v_expected_count then
    raise exception 'QUOTE_SOURCE_STALE' using errcode='40001';
  end if;

  v_gross:=(v_subtotal+p_delivery_fee_cents)::integer;

  insert into public.quotes(
    customer_id,merchant_id,address_text,gross_total_cents,delivery_fee_cents,
    eta_min_minutes,eta_max_minutes,expires_at,snapshot_fingerprint
  )
  values(
    p_user_id,p_merchant_id,trim(p_address),v_gross,p_delivery_fee_cents,
    p_eta_min_minutes,p_eta_max_minutes,p_expires_at,p_fingerprint
  )
  returning * into v_quote;

  insert into public.quote_items(
    quote_id,product_code,product_name,quantity,unit_price_cents,line_total_cents
  )
  select
    v_quote.id,
    ci.product_code,
    ci.product_name,
    r.quantity,
    ci.price_cents,
    ci.price_cents*r.quantity
  from (
    select
      upper(trim(x.product_code)) product_code,
      x.quantity,
      x.unit_price_cents
    from jsonb_to_recordset(p_items) as x(
      product_code text,
      quantity integer,
      unit_price_cents integer
    )
  ) r
  join public.catalog_items ci
    on ci.merchant_id=p_merchant_id
   and ci.product_code=r.product_code
   and ci.active
   and ci.available_stock>=r.quantity
   and ci.price_cents=r.unit_price_cents
   and ci.price_confirmed_at is not null
   and ci.price_confirmed_at>=clock_timestamp()-interval '24 hours'
  order by ci.product_code;

  return jsonb_build_object(
    'quoteId',v_quote.id,
    'grossTotalCents',v_quote.gross_total_cents,
    'etaMinMinutes',v_quote.eta_min_minutes,
    'etaMaxMinutes',v_quote.eta_max_minutes,
    'expiresAt',v_quote.expires_at,
    'reused',false
  );
end;
$function$;

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

create or replace function public.merchant_order_action(
  p_user_id uuid,
  p_order_id uuid,
  p_action text,
  p_expected_version integer,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_action public.action_requests%rowtype;
  v_order public.orders%rowtype;
  v_merchant public.merchants%rowtype;
  v_member_role text;
  v_item record;
  v_locked_stock integer;
  v_locked_active boolean;
  v_product_codes text[];
  v_accept_issue text:=null;
  v_dispatch_minutes integer;
  v_pin_bytes bytea;
  v_pin_seed integer;
  v_pin_code text;
  v_pin_hash text;
  v_result jsonb;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode='42501';
  end if;

  if p_action not in ('accept','reject','dispatch','arriving') then
    raise exception 'INVALID_ACTION' using errcode='22023';
  end if;

  if p_expected_version is null or p_expected_version<1 then
    raise exception 'INVALID_VERSION' using errcode='22023';
  end if;

  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;

  if p_request_hash is null
     or char_length(p_request_hash)<>64
     or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_user_id,'merchant-action:'||p_action,p_request_hash
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

  if v_action.user_id<>p_user_id
     or v_action.action_name<>'merchant-action:'||p_action
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select *
  into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  select mm.member_role
  into v_member_role
  from public.merchant_members mm
  where mm.merchant_id=v_order.merchant_id
    and mm.user_id=p_user_id
    and mm.active
  limit 1;

  if not found
     or v_member_role not in ('owner','manager','operator') then
    raise exception 'MERCHANT_ACCESS_DENIED' using errcode='42501';
  end if;

  if v_order.version<>p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode='40001';
  end if;

  select *
  into v_merchant
  from public.merchants
  where id=v_order.merchant_id
  for share;

  if not found then
    raise exception 'MERCHANT_NOT_FOUND' using errcode='P0002';
  end if;

  if p_action='accept' then
    if v_order.status<>'OFFERED_TO_MERCHANT' then
      raise exception 'INVALID_TRANSITION' using errcode='40001';
    end if;

    if v_order.offer_expires_at is null
       or v_order.offer_expires_at<=clock_timestamp() then
      v_result:=public.system_reassign_expired_order(v_order.id)
        ||jsonb_build_object(
          'accepted',false,
          'autoRescued',true,
          'rescueReason','offer_expired'
        );

    else
      if not public.merchant_operational_compliance_current(v_order.merchant_id) then
        v_accept_issue:='merchant_compliance_expired_before_accept';
      elsif v_merchant.status<>'active'
         or not v_merchant.online
         or v_merchant.last_seen_at is null
         or v_merchant.last_seen_at<clock_timestamp()-interval '10 minutes' then
        v_accept_issue:='merchant_unavailable_before_accept';
      end if;

      select array_agg(oi.product_code order by oi.product_code)
      into v_product_codes
      from public.order_items oi
      where oi.order_id=v_order.id;

      if v_accept_issue is null
         and not public.merchant_cart_delivery_compatible(
           v_order.merchant_id,
           coalesce(v_product_codes,array[]::text[])
         ) then
        v_accept_issue:='delivery_capability_changed_before_accept';
      end if;

      if v_accept_issue is null then
        for v_item in
          select oi.product_code,oi.quantity
          from public.order_items oi
          where oi.order_id=v_order.id
          order by oi.product_code
        loop
          v_locked_stock:=null;
          v_locked_active:=null;

          select ci.available_stock,ci.active
          into v_locked_stock,v_locked_active
          from public.catalog_items ci
          where ci.merchant_id=v_order.merchant_id
            and ci.product_code=v_item.product_code
          for update;

          if not found
             or not coalesce(v_locked_active,false)
             or coalesce(v_locked_stock,0)<v_item.quantity then
            v_accept_issue:='stock_changed_before_accept';
            exit;
          end if;
        end loop;
      end if;

      if v_accept_issue is not null then
        v_result:=public.rescue_offered_order_now(
          v_order.id,
          v_accept_issue,
          p_user_id,
          'ACCEPT_PRECONDITION_CHANGED',
          'Pedido redirecionado',
          'Uma condição necessária mudou antes do aceite; o sistema iniciou resgate automático.'
        );

      else
        for v_item in
          select oi.product_code,oi.quantity
          from public.order_items oi
          where oi.order_id=v_order.id
          order by oi.product_code
        loop
          update public.catalog_items
          set available_stock=available_stock-v_item.quantity,
              updated_at=clock_timestamp()
          where merchant_id=v_order.merchant_id
            and product_code=v_item.product_code;
        end loop;

        v_dispatch_minutes:=greatest(
          3,
          least(10,ceil(v_merchant.base_eta_minutes*0.35)::integer)
        );

        update public.orders
        set status='PREPARING',
            supplier_name_snapshot=v_merchant.name,
            accepted_at=clock_timestamp(),
            dispatch_due_at=clock_timestamp()+make_interval(mins=>v_dispatch_minutes),
            promised_by=clock_timestamp()+make_interval(mins=>v_merchant.base_eta_minutes+7),
            offer_expires_at=null,
            risk_reason=null,
            version=version+1,
            updated_at=clock_timestamp()
        where id=v_order.id
        returning * into v_order;

        insert into public.order_events(
          order_id,actor_user_id,actor_type,event_type,title,detail
        )
        values
          (
            v_order.id,p_user_id,'merchant','MERCHANT_ACCEPTED',
            'Revenda confirmou',
            'A revenda confirmou itens, preço, capacidade e compatibilidade de entrega.'
          ),
          (
            v_order.id,p_user_id,'merchant','PREPARING',
            'Em preparação',
            'Estoque reservado e entrega sendo preparada.'
          );

        v_result:=jsonb_build_object(
          'orderId',v_order.id,
          'status',v_order.status,
          'version',v_order.version,
          'supplierName',v_order.supplier_name_snapshot,
          'dispatchDueAt',v_order.dispatch_due_at,
          'promisedBy',v_order.promised_by,
          'accepted',true,
          'autoRescued',false
        );
      end if;
    end if;

  elsif p_action='reject' then
    if v_order.status<>'OFFERED_TO_MERCHANT' then
      raise exception 'INVALID_TRANSITION' using errcode='40001';
    end if;

    v_result:=public.rescue_offered_order_now(
      v_order.id,
      'merchant_rejected',
      p_user_id,
      'MERCHANT_REJECTED',
      'Revenda não consegue atender',
      'A revenda recusou antes do aceite e o sistema iniciou resgate automático.'
    );

  elsif p_action='dispatch' then
    if v_order.status not in ('PREPARING','AT_RISK') then
      raise exception 'INVALID_TRANSITION' using errcode='40001';
    end if;

    if not public.merchant_operational_compliance_current(v_order.merchant_id) then
      v_result:=public.system_release_and_rescue_accepted_order(
        v_order.id,
        'merchant_compliance_expired_before_dispatch',
        p_user_id,
        'Compliance venceu antes da saída',
        'A evidência regulatória deixou de estar vigente antes da saída; o estoque foi devolvido e o pedido entrou em rescue.'
      ) || jsonb_build_object(
        'dispatched',false,
        'autoRescued',true,
        'rescueReason','merchant_compliance_expired_before_dispatch'
      );

      update public.action_requests
      set result_json=v_result,completed_at=clock_timestamp()
      where idempotency_key=p_idempotency_key;
      return v_result;
    end if;

    if v_merchant.status<>'active'
       or v_merchant.last_seen_at is null
       or v_merchant.last_seen_at<clock_timestamp()-interval '10 minutes' then
      v_result:=public.system_release_and_rescue_accepted_order(
        v_order.id,
        'merchant_unavailable_before_dispatch',
        p_user_id,
        'Revenda indisponível antes da saída',
        'A revenda deixou de estar elegível ou perdeu conexão antes da saída; o estoque foi devolvido e o pedido entrou em rescue.'
      ) || jsonb_build_object(
        'dispatched',false,
        'autoRescued',true,
        'rescueReason','merchant_unavailable_before_dispatch'
      );

      update public.action_requests
      set result_json=v_result,completed_at=clock_timestamp()
      where idempotency_key=p_idempotency_key;
      return v_result;
    end if;

    select array_agg(oi.product_code order by oi.product_code)
    into v_product_codes
    from public.order_items oi
    where oi.order_id=v_order.id;

    if not public.merchant_cart_delivery_compatible(
      v_order.merchant_id,
      coalesce(v_product_codes,array[]::text[])
    ) then
      v_result:=public.system_release_and_rescue_accepted_order(
        v_order.id,
        'delivery_capability_changed_before_dispatch',
        p_user_id,
        'Capacidade logística mudou antes da saída',
        'A capacidade necessária deixou de ser válida antes da saída; o estoque foi devolvido e o pedido entrou em rescue.'
      ) || jsonb_build_object(
        'dispatched',false,
        'autoRescued',true,
        'rescueReason','delivery_capability_changed_before_dispatch'
      );

      update public.action_requests
      set result_json=v_result,completed_at=clock_timestamp()
      where idempotency_key=p_idempotency_key;
      return v_result;
    end if;

    v_pin_bytes:=extensions.gen_random_bytes(2);
    v_pin_seed:=get_byte(v_pin_bytes,0)*256+get_byte(v_pin_bytes,1);
    v_pin_code:=lpad((1000+(v_pin_seed%9000))::text,4,'0');
    v_pin_hash:=encode(extensions.digest(v_pin_code,'sha256'),'hex');

    insert into public.order_delivery_secrets(order_id,pin_code)
    values(v_order.id,v_pin_code)
    on conflict(order_id) do update
      set pin_code=excluded.pin_code,
          created_at=clock_timestamp(),
          revealed_at=null,
          consumed_at=null;

    update public.orders
    set status='OUT_FOR_DELIVERY',
        pin_hash=v_pin_hash,
        dispatched_at=clock_timestamp(),
        risk_reason=null,
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail
    )
    values(
      v_order.id,p_user_id,'merchant','OUT_FOR_DELIVERY',
      'Saiu para entrega',
      'A revenda confirmou explicitamente a saída.'
    );

    v_result:=jsonb_build_object(
      'orderId',v_order.id,
      'status',v_order.status,
      'version',v_order.version,
      'dispatchedAt',v_order.dispatched_at
    );

  elsif p_action='arriving' then
    if v_order.status<>'OUT_FOR_DELIVERY' then
      raise exception 'INVALID_TRANSITION' using errcode='40001';
    end if;

    update public.orders
    set status='ARRIVING',
        arriving_at=clock_timestamp(),
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail
    )
    values(
      v_order.id,p_user_id,'merchant','ARRIVING',
      'Entregador chegando',
      'A chegada próxima foi confirmada.'
    );

    v_result:=jsonb_build_object(
      'orderId',v_order.id,
      'status',v_order.status,
      'version',v_order.version,
      'arrivingAt',v_order.arriving_at
    );
  end if;

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

create or replace function public.process_order_timeouts()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_row record;
  v_offer_count integer:=0;
  v_requote_count integer:=0;
  v_accepted_rescue_count integer:=0;
  v_rescue jsonb;
  v_risk_count integer:=0;
  v_eta_count integer:=0;
begin
  for v_row in
    select id
    from public.orders
    where status='OFFERED_TO_MERCHANT'
      and offer_expires_at is not null
      and offer_expires_at<=clock_timestamp()
    order by offer_expires_at
    limit 100
  loop
    perform public.system_reassign_expired_order(v_row.id);
    v_offer_count:=v_offer_count+1;
  end loop;

  for v_row in
    select id
    from public.orders
    where status='REQUOTE_REQUIRED'
      and offer_expires_at is not null
      and offer_expires_at<=clock_timestamp()
    order by offer_expires_at
    limit 100
  loop
    perform public.system_expire_requote(v_row.id);
    v_requote_count:=v_requote_count+1;
  end loop;

  for v_row in
    select
      o.id,
      case
        when not public.merchant_operational_compliance_current(o.merchant_id)
          then 'merchant_compliance_expired_before_dispatch'
        when m.status<>'active' then 'merchant_inactive_before_dispatch'
        when m.last_seen_at is null
          or m.last_seen_at<clock_timestamp()-interval '10 minutes'
          then 'merchant_offline_before_dispatch'
        else 'delivery_capability_changed_before_dispatch'
      end as rescue_reason
    from public.orders o
    join public.merchants m on m.id=o.merchant_id
    where o.status in ('PREPARING','AT_RISK')
      and o.dispatched_at is null
      and (
        not public.merchant_operational_compliance_current(o.merchant_id)
        or m.status<>'active'
        or m.last_seen_at is null
        or m.last_seen_at<clock_timestamp()-interval '10 minutes'
        or not public.merchant_cart_delivery_compatible(
          o.merchant_id,
          array(
            select oi.product_code
            from public.order_items oi
            where oi.order_id=o.id
            order by oi.product_code
          )
        )
      )
    order by o.updated_at
    limit 100
  loop
    v_rescue:=public.system_release_and_rescue_accepted_order(
      v_row.id,
      v_row.rescue_reason,
      null,
      'Pedido redirecionado antes da saída',
      'A revenda ficou indisponível antes da saída; o estoque foi devolvido e o matching automático foi reexecutado.'
    );
    if coalesce((v_rescue->>'ok')::boolean,false) then
      v_accepted_rescue_count:=v_accepted_rescue_count+1;
    end if;
  end loop;

  for v_row in
    update public.orders
    set status='AT_RISK',
        risk_reason='Saída ainda não confirmada',
        version=version+1,
        updated_at=clock_timestamp()
    where status='PREPARING'
      and dispatch_due_at is not null
      and dispatch_due_at<=clock_timestamp()
    returning id
  loop
    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail
    )
    values(
      v_row.id,null,'system','AT_RISK',
      'Saída ainda não confirmada',
      'A janela de preparação terminou sem confirmação real de saída.'
    );
    v_risk_count:=v_risk_count+1;
  end loop;

  for v_row in
    update public.orders
    set risk_reason='Entrega fora da janela prevista',
        version=version+1,
        updated_at=clock_timestamp()
    where status in ('OUT_FOR_DELIVERY','ARRIVING')
      and promised_by is not null
      and promised_by<=clock_timestamp()
      and risk_reason is distinct from 'Entrega fora da janela prevista'
    returning id
  loop
    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail
    )
    values(
      v_row.id,null,'system','ETA_RISK',
      'Entrega fora da janela prevista',
      'O prazo máximo estimado foi ultrapassado; o pedido continua ativo e monitorado.'
    );
    v_eta_count:=v_eta_count+1;
  end loop;

  return jsonb_build_object(
    'expiredOffersProcessed',v_offer_count,
    'expiredRequotesProcessed',v_requote_count,
    'acceptedOrdersRescued',v_accepted_rescue_count,
    'preparingRisked',v_risk_count,
    'etaRisked',v_eta_count
  );
end;
$$;

create or replace function public.admin_set_delivery_capability(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_active boolean,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_merchant public.merchants%rowtype;
  v_compliance public.merchant_compliance%rowtype;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_merchant_id is null then
    raise exception 'INVALID_MERCHANT' using errcode='22023';
  end if;

  if p_notes is not null and char_length(trim(p_notes))>1000 then
    raise exception 'NOTES_TOO_LONG' using errcode='22023';
  end if;

  select *
  into v_merchant
  from public.merchants
  where id=p_merchant_id
  for update;

  if not found then
    raise exception 'MERCHANT_NOT_FOUND' using errcode='P0002';
  end if;

  select *
  into v_compliance
  from public.merchant_compliance
  where merchant_id=p_merchant_id
  for share;

  if p_active then
    if not public.merchant_cnpj_compliance_current(p_merchant_id) then
      raise exception 'CNPJ_REVERIFICATION_REQUIRED' using errcode='40001';
    end if;

    if not public.merchant_anp_compliance_current(p_merchant_id) then
      raise exception 'ANP_REVERIFICATION_REQUIRED' using errcode='40001';
    end if;
  end if;

  insert into public.merchant_delivery_capabilities(
    merchant_id,capability_code,active,verified_at,verified_by,notes,updated_at
  )
  values(
    p_merchant_id,
    'regulated_glp_mixed_load_verified',
    p_active,
    clock_timestamp(),
    p_actor_user_id,
    nullif(trim(p_notes),''),
    clock_timestamp()
  )
  on conflict(merchant_id,capability_code) do update
  set active=excluded.active,
      verified_at=excluded.verified_at,
      verified_by=excluded.verified_by,
      notes=excluded.notes,
      updated_at=clock_timestamp();

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    case when p_active
      then 'delivery_capability_verified'
      else 'delivery_capability_revoked'
    end,
    'merchant',
    p_merchant_id::text,
    jsonb_build_object(
      'capabilityCode','regulated_glp_mixed_load_verified',
      'active',p_active,
      'notes',p_notes
    )
  );

  return jsonb_build_object(
    'ok',true,
    'merchantId',p_merchant_id,
    'capabilityCode','regulated_glp_mixed_load_verified',
    'active',p_active,
    'verifiedAt',clock_timestamp()
  );
end;
$$;
