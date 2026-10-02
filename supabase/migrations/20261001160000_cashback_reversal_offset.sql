-- Chama São Gabriel — cashback reversal offset v1.20.2
-- Full financial reversal must never create a hidden negative cashback bucket.
-- Reversed reward grants form a durable clawback offset against future cashback.

create or replace function public.cashback_position(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_ledger bigint:=0;
  v_reversed_rewards bigint:=0;
  v_net bigint:=0;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode='42501';
  end if;

  -- Legacy cashback_reversal rows are intentionally excluded. From v1.20.2
  -- onward, full financial reversals are represented by reversed reward grants.
  select coalesce(sum(w.amount_cents),0)
  into v_ledger
  from public.wallet_entries w
  where w.user_id=p_user_id
    and w.bucket='cashback'
    and w.entry_type<>'cashback_reversal';

  select coalesce(sum(g.cashback_cents),0)
  into v_reversed_rewards
  from public.order_reward_grants g
  where g.customer_id=p_user_id
    and g.reversed_at is not null
    and g.cashback_cents>0;

  v_net:=v_ledger-v_reversed_rewards;

  return jsonb_build_object(
    'spendableCents',greatest(0,v_net),
    'debtCents',greatest(0,-v_net),
    'ledgerCents',v_ledger,
    'reversedRewardCents',v_reversed_rewards
  );
end;
$$;

revoke all on function public.cashback_position(uuid)
from public, anon, authenticated;
grant execute on function public.cashback_position(uuid)
to postgres, service_role;


create or replace function public.create_order_from_quote(
  p_user_id uuid,
  p_quote_id uuid,
  p_payment_method text,
  p_use_cashback boolean,
  p_idempotency_key text,
  p_request_hash text,
  p_referral_code text default null
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
  v_order_id uuid;
  v_public_code text;
  v_cashback_balance bigint := 0;
  v_reserved integer := 0;
  v_total integer := 0;
  v_offer_expires_at timestamptz;
  v_result jsonb;
  v_referrer uuid;
  v_prior_order_count integer:=0;
  v_product_codes text[];
begin
  if p_user_id is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  if p_payment_method not in ('pix','card','cash') then
    raise exception 'INVALID_PAYMENT_METHOD' using errcode='22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key)<12 or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null or char_length(p_request_hash)<>64 then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(idempotency_key,user_id,action_name,request_hash)
  values(p_idempotency_key,p_user_id,'create-order',p_request_hash)
  on conflict(idempotency_key) do nothing;

  select * into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if v_action.user_id<>p_user_id or v_action.action_name<>'create-order' or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    if v_action.result_json is null then raise exception 'IDEMPOTENCY_RESULT_MISSING'; end if;
    return v_action.result_json;
  end if;

  select * into v_quote
  from public.quotes
  where id=p_quote_id and customer_id=p_user_id
  for update;

  if not found then raise exception 'QUOTE_NOT_FOUND' using errcode='P0002'; end if;
  if v_quote.consumed_at is not null then raise exception 'QUOTE_ALREADY_USED' using errcode='23505'; end if;
  if v_quote.expires_at<=clock_timestamp() then raise exception 'QUOTE_EXPIRED' using errcode='22023'; end if;

  select * into v_merchant
  from public.merchants
  where id=v_quote.merchant_id
  for share;

  if not found
     or v_merchant.status<>'active'
     or not v_merchant.online
     or not v_merchant.accepts_citywide
     or v_merchant.last_seen_at is null
     or v_merchant.last_seen_at<clock_timestamp()-interval '10 minutes' then
    raise exception 'QUOTE_STALE' using errcode='40001';
  end if;

  if not public.merchant_operational_compliance_current(v_quote.merchant_id) then
    raise exception 'QUOTE_STALE' using errcode='40001';
  end if;

  select array_agg(qi.product_code order by qi.product_code)
  into v_product_codes
  from public.quote_items qi
  where qi.quote_id=v_quote.id;

  if coalesce(cardinality(v_product_codes),0)<1
     or not public.merchant_cart_delivery_compatible(
       v_quote.merchant_id,
       v_product_codes
     ) then
    raise exception 'QUOTE_STALE' using errcode='40001';
  end if;

  if exists(
    select 1
    from public.quote_items qi
    left join public.catalog_items ci
      on ci.merchant_id=v_quote.merchant_id and ci.product_code=qi.product_code
    where qi.quote_id=v_quote.id
      and (ci.merchant_id is null or not ci.active or ci.available_stock<qi.quantity)
  ) then
    raise exception 'QUOTE_STALE' using errcode='40001';
  end if;

  if exists(
    select 1 from public.orders
    where customer_id=p_user_id and status not in ('SETTLED','CANCELLED')
  ) then
    raise exception 'ACTIVE_ORDER_EXISTS' using errcode='23505';
  end if;

  select count(*)
  into v_prior_order_count
  from public.orders
  where customer_id=p_user_id;

  if p_referral_code is not null
     and char_length(trim(p_referral_code)) between 6 and 20
     and v_prior_order_count=0 then
    select user_id into v_referrer
    from public.profiles
    where referral_code=upper(trim(p_referral_code))
    limit 1;

    if v_referrer is not null and v_referrer<>p_user_id then
      insert into public.referrals(referred_user_id,referrer_user_id,referral_code)
      values(p_user_id,v_referrer,upper(trim(p_referral_code)))
      on conflict(referred_user_id) do nothing;
    end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('cashback-user:'||p_user_id::text,0)
  );

  select (public.cashback_position(p_user_id)->>'spendableCents')::bigint
  into v_cashback_balance;

  if p_use_cashback then
    v_reserved:=least(v_quote.gross_total_cents,v_cashback_balance)::integer;
  end if;

  v_total:=v_quote.gross_total_cents-v_reserved;
  v_order_id:=gen_random_uuid();
  v_public_code:='SG-'||upper(substr(replace(v_order_id::text,'-',''),1,12));
  v_offer_expires_at:=clock_timestamp()+interval '3 minutes';

  insert into public.orders(
    id,public_code,customer_id,merchant_id,status,address_text,payment_method,
    gross_total_cents,cashback_reserved_cents,total_cents,pin_hash,
    attempted_merchant_ids,offer_expires_at
  ) values(
    v_order_id,v_public_code,p_user_id,v_quote.merchant_id,'OFFERED_TO_MERCHANT',
    v_quote.address_text,p_payment_method,v_quote.gross_total_cents,v_reserved,v_total,
    null,array[v_quote.merchant_id],v_offer_expires_at
  );

  insert into public.order_items(
    order_id,product_code,product_name,quantity,unit_price_cents,line_total_cents
  )
  select v_order_id,product_code,product_name,quantity,unit_price_cents,line_total_cents
  from public.quote_items where quote_id=v_quote.id;

  if v_reserved>0 then
    insert into public.wallet_entries(
      user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
    ) values(
      p_user_id,v_order_id,'cashback','cashback_reserve',-v_reserved,
      p_idempotency_key||':cashback-reserve',
      jsonb_build_object('quoteId',v_quote.id)
    );
  end if;

  insert into public.order_events(order_id,actor_user_id,actor_type,event_type,title,detail)
  values
    (v_order_id,p_user_id,'customer','CREATED','Pedido recebido','Pedido criado a partir de uma cotação válida.'),
    (v_order_id,p_user_id,'system','QUOTE_LOCKED','Preço protegido','Preço, itens e endereço foram congelados para este pedido.'),
    (v_order_id,p_user_id,'system','OFFERED_TO_MERCHANT','Aguardando confirmação da revenda','A revenda precisa aceitar antes de o pedido ser considerado confirmado.');

  update public.quotes set consumed_at=clock_timestamp() where id=v_quote.id;

  v_result:=jsonb_build_object(
    'orderId',v_order_id,'publicCode',v_public_code,'status','OFFERED_TO_MERCHANT',
    'grossTotalCents',v_quote.gross_total_cents,'cashbackReservedCents',v_reserved,
    'totalCents',v_total,'offerExpiresAt',v_offer_expires_at
  );

  update public.action_requests
  set result_json=v_result,completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.create_order_from_quote(uuid,uuid,text,boolean,text,text,text)
from public, anon, authenticated;
grant execute on function public.create_order_from_quote(uuid,uuid,text,boolean,text,text,text)
to service_role;

create or replace function public.customer_financial_summary(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_referral_code text;
  v_cashback bigint:=0;
  v_cashback_debt bigint:=0;
  v_pending bigint:=0;
  v_available bigint:=0;
  v_settled_orders bigint:=0;
  v_reversed_orders bigint:=0;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode='42501';
  end if;

  select p.referral_code
  into v_referral_code
  from public.profiles p
  where p.user_id=p_user_id;

  select
    (public.cashback_position(p_user_id)->>'spendableCents')::bigint,
    (public.cashback_position(p_user_id)->>'debtCents')::bigint
  into
    v_cashback,
    v_cashback_debt;

  select
    coalesce(sum(w.amount_cents) filter (where w.bucket='commission_pending'),0),
    coalesce(sum(w.amount_cents) filter (where w.bucket='commission_available'),0)
  into
    v_pending,
    v_available
  from public.wallet_entries w
  where w.user_id=p_user_id;

  select
    count(*) filter (where o.financial_state='settled'),
    count(*) filter (where o.financial_state='reversed')
  into
    v_settled_orders,
    v_reversed_orders
  from public.orders o
  where o.customer_id=p_user_id
    and o.status='SETTLED';

  return jsonb_build_object(
    'referralCode',v_referral_code,
    'cashbackCents',greatest(0,v_cashback),
    'cashbackDebtCents',greatest(0,v_cashback_debt),
    'commissionPendingCents',greatest(0,v_pending),
    'commissionAvailableCents',greatest(0,v_available),
    'settledOrders',v_settled_orders,
    'reversedOrders',v_reversed_orders
  );
end;
$$;

revoke all on function public.customer_financial_summary(uuid)
from public, anon, authenticated;
grant execute on function public.customer_financial_summary(uuid)
to service_role;

create or replace function public.reverse_settled_order_financials(
  p_order_id uuid,
  p_reason text,
  p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
  v_grant public.order_reward_grants%rowtype;
  v_receivable public.platform_receivables%rowtype;
  v_reimbursement public.merchant_cashback_reimbursements%rowtype;
  v_existing public.order_financial_reversals%rowtype;
  v_result jsonb;
begin
  if p_reason is null
     or char_length(trim(p_reason))<3
     or char_length(trim(p_reason))>240 then
    raise exception 'INVALID_REVERSAL_REASON' using errcode='22023';
  end if;

  if p_reference is not null
     and (char_length(trim(p_reference))<3 or char_length(trim(p_reference))>120) then
    raise exception 'INVALID_REVERSAL_REFERENCE' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('reward:'||p_order_id::text,0)
  );

  select *
  into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('cashback-user:'||v_order.customer_id::text,0)
  );

  select *
  into v_existing
  from public.order_financial_reversals
  where order_id=v_order.id;

  if found then
    return jsonb_build_object(
      'ok',true,
      'orderId',v_order.id,
      'financialState','reversed',
      'alreadyReversed',true,
      'reversedAt',v_existing.created_at
    );
  end if;

  if v_order.status<>'SETTLED'
     or v_order.financial_state<>'settled'
     or v_order.settled_at is null then
    raise exception 'ORDER_NOT_REVERSIBLE' using errcode='40001';
  end if;

  insert into public.order_financial_reversals(order_id,reason,reference)
  values(v_order.id,trim(p_reason),nullif(trim(p_reference),''))
  returning * into v_existing;

  select *
  into v_grant
  from public.order_reward_grants
  where order_id=v_order.id
  for update;

  if found and v_grant.reversed_at is null then
    if v_grant.referral_pending_cents>0
       and v_grant.referrer_user_id is not null then
      if v_grant.matured_at is null then
        insert into public.wallet_entries(
          user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
        )
        values(
          v_grant.referrer_user_id,v_order.id,'commission_pending',
          'referral_pending_release',-v_grant.referral_pending_cents,
          'reversal:'||replace(v_order.id::text,'-','')||':referral-pending',
          jsonb_build_object('reason',trim(p_reason),'reference',p_reference)
        )
        on conflict(idempotency_key) do nothing;
      else
        insert into public.wallet_entries(
          user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
        )
        values(
          v_grant.referrer_user_id,v_order.id,'commission_available',
          'referral_reversal',-v_grant.referral_pending_cents,
          'reversal:'||replace(v_order.id::text,'-','')||':referral-available',
          jsonb_build_object('reason',trim(p_reason),'reference',p_reference)
        )
        on conflict(idempotency_key) do nothing;
      end if;
    end if;

    update public.order_reward_grants
    set reversed_at=clock_timestamp(),
        reversal_reason=trim(p_reason)
    where order_id=v_order.id
      and reversed_at is null;
  end if;

  update public.referrals
  set qualified_order_id=null
  where qualified_order_id=v_order.id;

  select *
  into v_receivable
  from public.platform_receivables
  where order_id=v_order.id
  for update;

  if found then
    if v_receivable.status='paid' and v_receivable.platform_fee_cents>0 then
      insert into public.platform_settlement_adjustments(
        order_id,merchant_id,adjustment_type,direction,amount_cents,status,reason,reference
      )
      values(
        v_order.id,v_receivable.merchant_id,'platform_fee_refund_due',
        'platform_owes_merchant',v_receivable.platform_fee_cents,
        'open',trim(p_reason),nullif(trim(p_reference),'')
      )
      on conflict(order_id,adjustment_type) do nothing;
    end if;

    update public.platform_receivables
    set status='reversed',
        reversed_at=coalesce(reversed_at,clock_timestamp()),
        updated_at=clock_timestamp()
    where order_id=v_order.id
      and status<>'reversed';
  end if;

  select *
  into v_reimbursement
  from public.merchant_cashback_reimbursements
  where order_id=v_order.id
  for update;

  if found then
    if v_reimbursement.status='paid'
       and v_reimbursement.cashback_cents>0 then
      insert into public.platform_settlement_adjustments(
        order_id,merchant_id,adjustment_type,direction,amount_cents,
        status,reason,reference
      )
      values(
        v_order.id,v_reimbursement.merchant_id,
        'cashback_reimbursement_recovery_due','merchant_owes_platform',
        v_reimbursement.cashback_cents,'open',
        trim(p_reason),nullif(trim(p_reference),'')
      )
      on conflict(order_id,adjustment_type) do nothing;
    end if;

    update public.merchant_cashback_reimbursements
    set status='reversed',
        reversed_at=coalesce(reversed_at,clock_timestamp()),
        updated_at=clock_timestamp()
    where order_id=v_order.id
      and status<>'reversed';
  end if;

  update public.orders
  set financial_state='reversed',
      financial_reversed_at=clock_timestamp(),
      financial_reversal_reason=trim(p_reason),
      financial_reversal_reference=nullif(trim(p_reference),''),
      version=version+1,
      updated_at=clock_timestamp()
  where id=v_order.id
  returning * into v_order;

  insert into public.order_events(
    order_id,actor_user_id,actor_type,event_type,title,detail,metadata
  )
  values(
    v_order.id,null,'system','FINANCIAL_REVERSED',
    'Liquidação financeira revertida',
    'Benefícios e recebíveis da plataforma foram estornados após confirmação da reversão.',
    jsonb_build_object(
      'reason',trim(p_reason),
      'reference',p_reference,
      'operationalStatus',v_order.status,
      'cashbackClawbackCents',coalesce(v_grant.cashback_cents,0),
      'cashbackClawbackMode','effective_balance_offset'
    )
  );

  v_result:=jsonb_build_object(
    'ok',true,
    'orderId',v_order.id,
    'status',v_order.status,
    'financialState',v_order.financial_state,
    'version',v_order.version,
    'alreadyReversed',false,
    'reversedAt',v_order.financial_reversed_at
  );

  return v_result;
end;
$$;

revoke all on function public.reverse_settled_order_financials(uuid,text,text)
from public, anon, authenticated;
grant execute on function public.reverse_settled_order_financials(uuid,text,text)
to postgres, service_role;
