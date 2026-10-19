-- Run only in the isolated PostgreSQL 17 CI job AFTER the coupon funding
-- and quote test fixtures. This provides a minimal, explicitly FAKE checkout
-- implementation to exercise the real coupon-paid wrapper in a transaction.
-- It is NOT a substitute for full create_order_from_quote_v8 E2E.
create table public.merchants(
 id uuid primary key
);
alter table public.quotes add column merchant_id uuid;
create table public.orders(
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null,
 merchant_id uuid,
 proposed_merchant_id uuid,
 gross_total_cents integer not null,
 cashback_reserved_cents integer not null,
 total_cents integer not null,
 constraint atomic_mock_money_check
   check(total_cents=gross_total_cents-cashback_reserved_cents)
);
create table public.action_requests(
 idempotency_key text primary key,
 user_id uuid not null,
 action_name text not null,
 request_hash text not null,
 result_json jsonb,
 completed_at timestamptz
);
create table public.wallet_entries(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null,
 order_id uuid,
 bucket text not null,
 entry_type text not null,
 amount_cents integer not null,
 idempotency_key text not null unique,
 metadata jsonb not null default '{}'::jsonb
);
create function public.cashback_position(p_user_id uuid)
 returns jsonb language sql security definer set search_path=pg_catalog
as $$
 select pg_catalog.jsonb_build_object('spendableCents',
  pg_catalog.greatest(0,pg_catalog.coalesce(
   (select sum(amount_cents) from public.wallet_entries
     where user_id=p_user_id and bucket='cashback'),0)));
$$;
create function public.create_order_from_quote_v8(
 p_user_id uuid,p_quote_id uuid,p_payment_method text,p_use_cashback boolean,
 p_idempotency_key text,p_request_hash text,p_referral_code text default null,
 p_cash_tender_cents integer default null,p_customer_phone text default null,
 p_address_complement text default null,p_delivery_reference text default null,
 p_delivery_notes text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog
as $$
declare
 v_q public.quotes%rowtype;
 v_cash integer;
 v_order_id uuid;
 v_result jsonb;
begin
 select * into v_q from public.quotes
 where id=p_quote_id and customer_id=p_user_id for update;
 if not found or v_q.consumed_at is not null
    or v_q.expires_at<=clock_timestamp()
 then raise exception 'QUOTE_NOT_AVAILABLE';end if;
 v_cash:=case when p_use_cashback then
  least(v_q.gross_total_cents,
   (public.cashback_position(p_user_id)->>'spendableCents')::integer)
  else 0 end;
 insert into public.orders(
  customer_id,merchant_id,proposed_merchant_id,gross_total_cents,
  cashback_reserved_cents,total_cents)
 values(p_user_id,null,v_q.merchant_id,v_q.gross_total_cents,v_cash,
  v_q.gross_total_cents-v_cash) returning id into v_order_id;
 if v_cash>0 then
  insert into public.wallet_entries(
   user_id,order_id,bucket,entry_type,amount_cents,idempotency_key)
  values(p_user_id,v_order_id,'cashback','cashback_reserve',-v_cash,
   'order:'||v_order_id::text||':reserve');
 end if;
 update public.quotes set consumed_at=clock_timestamp() where id=p_quote_id;
 v_result:=pg_catalog.jsonb_build_object('orderId',v_order_id,
  'totalCents',v_q.gross_total_cents-v_cash,'cashbackReservedCents',v_cash);
 insert into public.action_requests(idempotency_key,user_id,action_name,
  request_hash,result_json,completed_at)
 values(p_idempotency_key,p_user_id,'create-order',p_request_hash,
  v_result,clock_timestamp());
 return v_result;
end
$$;

-- Run the real migration after the fake merchant, order, wallet and v8 contract.
-- The CI workflow invokes the migration between this fixture and assertion file.
